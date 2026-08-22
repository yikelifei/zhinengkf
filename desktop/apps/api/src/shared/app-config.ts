import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { config as loadDotEnv } from "dotenv";

loadDotEnv({
  path: process.env.DESKTOP_ENV_FILE ? path.resolve(process.env.DESKTOP_ENV_FILE) : path.resolve(process.cwd(), ".env"),
  override: false,
  quiet: true,
});

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

function listEnv(name: string): string[] {
  return [...new Set(String(process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

const defaultDesignPlatformAdapter = "standard_v1";
const defaultDesignPlatformBaseUrl = "http://127.0.0.1:3700";
const defaultArtImageLocalBaseUrl = "http://127.0.0.1:3000";
const zhenxiAiLoopbackAdapters = new Set(["art_image_local", "zhenxi_external"]);
const supportedDesignPlatformAdapters = new Set(["art_image_local", "zhenxi_external", "standard_v1"]);
const defaultZhenxiAiLocalPreviewUrl = "http://127.0.0.1:3001";
const defaultZhenxiAiPackagedDesktopUrls = buildLoopbackOrigins(31870, 10);
const defaultZhenxiAiAppUrl = "https://app.zhenxiai.cloud";
const defaultZhenxiAiSiteUrl = "https://zhenxiai.cloud";
const defaultZhenxiAiWwwUrl = "https://www.zhenxiai.cloud";
const apiPort = numberEnv("API_PORT", 3200);
const webPort = numberEnv("WEB_PORT", 3100);
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.resolve("./.runtime");
const zhenxiAiLinks = resolveZhenxiAiLinks();

function runtimePath(...segments: string[]) {
  return path.join(runtimeDir, ...segments);
}

function assertPrivateRegularFileOrMissing(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe runtime file target: ${filePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw error;
  }
}

function readPrivateJsonFile(filePath: string, fallback: Record<string, unknown>) {
  if (!assertPrivateRegularFileOrMissing(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function atomicWritePrivateJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  assertPrivateRegularFileOrMissing(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertPrivateRegularFileOrMissing(filePath);
    fs.renameSync(temporaryPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function readRuntimeSecret(filePath: string): string {
  try {
    const value = String(fs.readFileSync(filePath, "utf8") || "").trim();
    return /^[a-f0-9]{64}$/i.test(value) ? value : "";
  } catch {
    return "";
  }
}

const designPlatformRuntimeConfigPath = path.resolve(
  process.env.DESIGN_PLATFORM_RUNTIME_CONFIG || runtimePath("design-platform-config.json"),
);
const wechatWindowObserverProofFile = path.resolve(
  process.env.WECHAT_WINDOW_OBSERVER_PROOF_FILE || runtimePath("wechat-window-observer-proof.key"),
);
const wechatBridgeServiceTokenFile = path.resolve(
  process.env.WECHAT_BRIDGE_SERVICE_TOKEN_FILE || runtimePath("wechat-bridge-service.key"),
);

function readRuntimeConfig(): Record<string, unknown> {
  return readPrivateJsonFile(designPlatformRuntimeConfigPath, {});
}

function stringConfig(envName: string, runtimeKey: string, fallback: string, config = runtimeConfig): string {
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== "") return envValue;
  const runtimeValue = config[runtimeKey];
  if (typeof runtimeValue === "string" && runtimeValue.trim()) return runtimeValue;
  return fallback;
}

let runtimeConfig = readRuntimeConfig();

type DesignPlatformCredentialOrigins = {
  accessTokenOrigin?: string;
  cookieOrigin?: string;
  apiKeyOrigin?: string;
  deviceIdOrigin?: string;
};

function resolveDesignPlatformRuntime(
  config = runtimeConfig,
  previousCredentialOrigins: DesignPlatformCredentialOrigins = {},
) {
  const adapter = stringConfig("DESIGN_PLATFORM_ADAPTER", "designPlatformAdapter", defaultDesignPlatformAdapter, config);
  const baseUrl = validateDesignPlatformBaseUrl(
    stringConfig(
      "DESIGN_PLATFORM_BASE_URL",
      "designPlatformBaseUrl",
      zhenxiAiLoopbackAdapters.has(adapter) ? defaultArtImageLocalBaseUrl : defaultDesignPlatformBaseUrl,
      config,
    ),
    adapter,
  );
  const baseOrigin = new URL(baseUrl).origin;
  const envBaseOrigin = process.env.DESIGN_PLATFORM_BASE_URL
    ? normalizeHttpOrigin(process.env.DESIGN_PLATFORM_BASE_URL)
    : "";
  const accessToken = stringConfig("DESIGN_PLATFORM_ACCESS_TOKEN", "designPlatformAccessToken", "", config);
  const apiKey = stringConfig("DESIGN_PLATFORM_API_KEY", "designPlatformApiKey", "", config);
  const cookie = stringConfig("DESIGN_PLATFORM_COOKIE", "designPlatformCookie", "", config);
  const deviceId = stringConfig("DESIGN_PLATFORM_DEVICE_ID", "designPlatformDeviceId", "", config);
  const accessTokenFromEnvironment = Boolean(String(process.env.DESIGN_PLATFORM_ACCESS_TOKEN || "").trim());
  const apiKeyFromEnvironment = Boolean(String(process.env.DESIGN_PLATFORM_API_KEY || "").trim());
  const cookieFromEnvironment = Boolean(String(process.env.DESIGN_PLATFORM_COOKIE || "").trim());
  const deviceIdFromEnvironment = Boolean(String(process.env.DESIGN_PLATFORM_DEVICE_ID || "").trim());
  return {
    adapter,
    baseUrl,
    accessToken,
    apiKey,
    cookie,
    deviceId,
    accessTokenOrigin: accessToken
      ? accessTokenFromEnvironment
        ? envBaseOrigin
        : normalizeHttpOrigin(config.designPlatformAccessTokenOrigin) ||
          normalizeHttpOrigin(previousCredentialOrigins.accessTokenOrigin) ||
          baseOrigin
      : "",
    cookieOrigin: cookie
      ? cookieFromEnvironment
        ? envBaseOrigin
        : normalizeHttpOrigin(config.designPlatformCookieOrigin) ||
          normalizeHttpOrigin(previousCredentialOrigins.cookieOrigin) ||
          baseOrigin
      : "",
    apiKeyOrigin: apiKey
      ? apiKeyFromEnvironment
        ? envBaseOrigin || (zhenxiAiLoopbackAdapters.has(adapter) ? baseOrigin : "")
        : normalizeHttpOrigin(config.designPlatformApiKeyOrigin) ||
          normalizeHttpOrigin(previousCredentialOrigins.apiKeyOrigin) ||
          baseOrigin
      : "",
    deviceIdOrigin: deviceId
      ? deviceIdFromEnvironment
        ? envBaseOrigin
        : normalizeHttpOrigin(config.designPlatformDeviceIdOrigin) ||
          normalizeHttpOrigin(previousCredentialOrigins.deviceIdOrigin) ||
          baseOrigin
      : "",
  };
}

const designPlatformRuntime = resolveDesignPlatformRuntime();
const runtimeTarget = String(process.env.SMART_KEFU_RUNTIME_TARGET || "").trim().toLowerCase();
const isDesktopRuntime = runtimeTarget === "desktop";
const lowValueAutomationDefaultMode =
  process.env.NODE_ENV === "production" && !isDesktopRuntime ? "durable" : "interval";
const lowValueAutomationModeRaw = String(
  process.env.LOW_VALUE_AUTOMATION_MODE || lowValueAutomationDefaultMode,
).trim().toLowerCase();
const lowValueAutomationModeCandidate: "interval" | "durable" | "invalid" =
  lowValueAutomationModeRaw === "interval" || lowValueAutomationModeRaw === "durable"
    ? lowValueAutomationModeRaw
    : "invalid";
const lowValueAutomationMode: "interval" | "durable" | "invalid" =
  process.env.NODE_ENV === "production" && !isDesktopRuntime && lowValueAutomationModeCandidate === "interval"
    ? "invalid"
    : lowValueAutomationModeCandidate;

export const appConfig = {
  apiPort,
  webPort,
  internalApiToken: process.env.INTERNAL_API_TOKEN || "",
  useLocalStore: process.env.USE_LOCAL_STORE !== "false",
  localStorageRoot: path.resolve(process.env.LOCAL_STORAGE_ROOT || runtimePath("storage")),
  designPlatformAdapter: designPlatformRuntime.adapter,
  designPlatformBaseUrl: designPlatformRuntime.baseUrl,
  zhenxiAi: zhenxiAiLinks,
  designPlatformApiKey: designPlatformRuntime.apiKey,
  designPlatformAccessToken: designPlatformRuntime.accessToken,
  designPlatformCookie: designPlatformRuntime.cookie,
  designPlatformDeviceId: designPlatformRuntime.deviceId,
  designPlatformAccessTokenOrigin: designPlatformRuntime.accessTokenOrigin,
  designPlatformCookieOrigin: designPlatformRuntime.cookieOrigin,
  designPlatformApiKeyOrigin: designPlatformRuntime.apiKeyOrigin,
  designPlatformDeviceIdOrigin: designPlatformRuntime.deviceIdOrigin,
  designPlatformTimeoutMs: numberEnv("DESIGN_PLATFORM_TIMEOUT_MS", 30 * 60 * 1000),
  designPlatformImageSize: process.env.DESIGN_PLATFORM_IMAGE_SIZE || "1024x1024",
  designPlatformImageRatio: process.env.DESIGN_PLATFORM_IMAGE_RATIO || "1:1",
  designPlatformCardType: process.env.DESIGN_PLATFORM_CARD_TYPE || "礼盒真实产品摆拍",
  acceptanceAllowLoopbackDesignDownloads: process.env.ACCEPTANCE_ALLOW_LOOPBACK_DESIGN_DOWNLOADS === "1",
  allowDemoDataMutations: booleanEnv(
    "ALLOW_DEMO_DATA_MUTATIONS",
    process.env.NODE_ENV !== "production" && process.env.USE_LOCAL_STORE !== "false",
  ),
  designResultPollIntervalMs: numberEnv("DESIGN_RESULT_POLL_INTERVAL_MS", 5000),
  designResultPollMaxMs: numberEnv("DESIGN_RESULT_POLL_MAX_MS", 20 * 60 * 1000),
  designExecutionRecoveryIntervalMs: numberEnv("DESIGN_EXECUTION_RECOVERY_INTERVAL_MS", 15000),
  customerServicePublicBaseUrl: trimTrailingSlash(
    process.env.CUSTOMER_SERVICE_PUBLIC_BASE_URL || `http://127.0.0.1:${apiPort}`,
  ),
  designPlatformCallbackUrl: process.env.DESIGN_PLATFORM_CALLBACK_URL || "",
  callbackApiKey: process.env.DESIGN_PLATFORM_CALLBACK_API_KEY || "",
  wechatSendAdapter: process.env.WECHAT_SEND_ADAPTER || "dry_run",
  wechatBridgeOutboxDir: path.resolve(process.env.WECHAT_BRIDGE_OUTBOX_DIR || runtimePath("wechat-outbox")),
  wechatBridgeInboxDir: path.resolve(process.env.WECHAT_BRIDGE_INBOX_DIR || runtimePath("wechat-inbox")),
  wechatBridgeDispatchDir: path.resolve(process.env.WECHAT_BRIDGE_DISPATCH_DIR || runtimePath("wechat-dispatch")),
  wechatBridgeLockDir: path.resolve(process.env.WECHAT_BRIDGE_LOCK_DIR || runtimePath("wechat-bridge-locks")),
  wechatBridgeWorkerStatusFile: path.resolve(process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE || runtimePath("wechat-bridge-worker-status.json")),
  wechatBridgeServiceTokenFile,
  wechatWindowSnapshotInboxDir: path.resolve(process.env.WECHAT_WINDOW_SNAPSHOT_INBOX_DIR || runtimePath("wechat-window-snapshots")),
  wechatWindowObserverStatusFile: path.resolve(process.env.WECHAT_WINDOW_OBSERVER_STATUS_FILE || runtimePath("wechat-window-observer-status.json")),
  wechatWindowObserverProofFile,
  wechatWindowObserverProofToken: readRuntimeSecret(wechatWindowObserverProofFile),
  wechatWindowSnapshotMaxAgeSeconds: numberEnv("WECHAT_WINDOW_SNAPSHOT_MAX_AGE_SECONDS", 30),
  wechatWindowSnapshotScanLimit: numberEnv("WECHAT_WINDOW_SNAPSHOT_SCAN_LIMIT", 5),
  wechatWorkCorpId: process.env.WECHAT_WORK_CORP_ID || "",
  wechatWorkAgentId: process.env.WECHAT_WORK_AGENT_ID || "",
  wechatWorkSecret: process.env.WECHAT_WORK_SECRET || "",
  wechatWorkExternalContactSecret: process.env.WECHAT_WORK_EXTERNAL_CONTACT_SECRET || "",
  wechatWorkToken: process.env.WECHAT_WORK_TOKEN || "",
  wechatWorkEncodingAesKey: process.env.WECHAT_WORK_ENCODING_AES_KEY || "",
  wechatWorkOpenKfid: process.env.WECHAT_WORK_OPEN_KFID || "",
  wechatWorkApiBaseUrl: trimTrailingSlash(process.env.WECHAT_WORK_API_BASE_URL || "https://qyapi.weixin.qq.com"),
  wechatWorkApiRelayToken: process.env.WECHAT_WORK_API_RELAY_TOKEN || "",
  wechatWorkCallbackProcessingMode:
    String(process.env.WECHAT_WORK_CALLBACK_PROCESSING_MODE || "process").trim().toLowerCase() === "signal_only"
      ? "signal_only" as const
      : "process" as const,
  wechatWorkSuiteId: process.env.WECHAT_WORK_SUITE_ID || "",
  wechatWorkSuiteSecret: process.env.WECHAT_WORK_SUITE_SECRET || "",
  wechatWorkSuiteToken: process.env.WECHAT_WORK_SUITE_TOKEN || "",
  wechatWorkSuiteEncodingAesKey: process.env.WECHAT_WORK_SUITE_ENCODING_AES_KEY || "",
  wechatWorkSuiteStorageKey: process.env.WECHAT_WORK_SUITE_STORAGE_KEY || "",
  wechatWorkSuiteApiBaseUrl: trimTrailingSlash(
    process.env.WECHAT_WORK_SUITE_API_BASE_URL || "https://qyapi.weixin.qq.com",
  ),
  wechatWorkSuiteInstallBaseUrl: process.env.WECHAT_WORK_SUITE_INSTALL_BASE_URL
    || "https://open.work.weixin.qq.com/3rdapp/install",
  wechatWorkSuiteAuthorizationStoreFile: path.resolve(
    process.env.WECHAT_WORK_SUITE_AUTHORIZATION_STORE_FILE
      || runtimePath("wechat-work-suite-authorization.json"),
  ),
  wechatWorkSendMaxAttempts: Math.max(1, numberEnv("WECHAT_WORK_SEND_MAX_ATTEMPTS", 3)),
  wechatWorkSendRetryDelaySeconds: Math.max(1, numberEnv("WECHAT_WORK_SEND_RETRY_DELAY_SECONDS", 30)),
  wechatWorkAutoSyncEnabled: booleanEnv("WECHAT_WORK_AUTO_SYNC_ENABLED", false),
  wechatWorkAutoSyncLimit: Math.max(1, Math.min(1000, numberEnv("WECHAT_WORK_AUTO_SYNC_LIMIT", 100))),
  wechatWorkAutoSyncAccountsPerRun: Math.max(
    1,
    Math.min(100, numberEnv("WECHAT_WORK_AUTO_SYNC_ACCOUNTS_PER_RUN", 1)),
  ),
  wechatWorkAutoSyncRateLimitBackoffMs: Math.max(
    1000,
    numberEnv("WECHAT_WORK_AUTO_SYNC_RATE_LIMIT_BACKOFF_MS", 60 * 1000),
  ),
  wechatWorkRemoteEventUrl: process.env.WECHAT_WORK_REMOTE_EVENT_URL || "",
  wechatWorkRemoteEventToken: process.env.WECHAT_WORK_REMOTE_EVENT_TOKEN || "",
  wechatInternalTestAutoReplyEnabled: booleanEnv("WECHAT_INTERNAL_TEST_AUTO_REPLY_ENABLED", false),
  wechatInternalTestAutoReplyWechatAccountIds: listEnv("WECHAT_INTERNAL_TEST_AUTO_REPLY_WECHAT_ACCOUNT_IDS"),
  wechatInternalTestAutoReplyConversationIds: listEnv("WECHAT_INTERNAL_TEST_AUTO_REPLY_CONVERSATION_IDS"),
  wechatInternalTestAutoReplyCustomerIds: listEnv("WECHAT_INTERNAL_TEST_AUTO_REPLY_CUSTOMER_IDS"),
  wechatMiniAppId: process.env.WECHAT_MINI_APP_ID || "",
  wechatMiniToken: process.env.WECHAT_MINI_TOKEN || "",
  sendBridgeAckTimeoutMinutes: numberEnv("SEND_BRIDGE_ACK_TIMEOUT_MINUTES", 5),
  sendQueueStaleMinutes: numberEnv("SEND_QUEUE_STALE_MINUTES", 10),
  highValueAmountCny: numberEnv("HIGH_VALUE_AMOUNT_CNY", 10000),
  designTimeoutMinutes: numberEnv("DESIGN_TIMEOUT_MINUTES", 20),
  defaultOutputCount: numberEnv("DESIGN_DEFAULT_OUTPUT_COUNT", 4),
  lowValueAutomationEnabled: booleanEnv("LOW_VALUE_AUTOMATION_ENABLED", true),
  lowValueAutomationMode,
  lowValueAutomationRedisUrl: process.env.LOW_VALUE_AUTOMATION_REDIS_URL || "",
  lowValueAutomationRunOnStart: booleanEnv("LOW_VALUE_AUTOMATION_RUN_ON_START", true),
  lowValueAutomationIntervalMs: numberEnv("LOW_VALUE_AUTOMATION_INTERVAL_MS", 15000),
  lowValueAutomationPollLimit: numberEnv("LOW_VALUE_AUTOMATION_POLL_LIMIT", 50),
  lowValueAutomationProcessSendQueue: booleanEnv("LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE", true),
  lowValueAutomationSendQueueLimit: numberEnv("LOW_VALUE_AUTOMATION_SEND_QUEUE_LIMIT", 10),
  lowValueAutomationSendPerAccountLimit: numberEnv("LOW_VALUE_AUTOMATION_SEND_PER_ACCOUNT_LIMIT", 10),
};

export type DesignPlatformRuntimeConfigPatch = {
  adapter?: string;
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  cookie?: string;
  deviceId?: string;
};

export function updateDesignPlatformRuntimeConfig(patch: DesignPlatformRuntimeConfigPatch) {
  const existing = readRuntimeConfig();
  const next = { ...existing };

  if (patch.adapter !== undefined) {
    const adapter = String(patch.adapter || "").trim();
    if (!supportedDesignPlatformAdapters.has(adapter)) {
      throw new Error("design platform adapter must be art_image_local, zhenxi_external, or standard_v1");
    }
    next.designPlatformAdapter = adapter;
  }
  if (patch.baseUrl !== undefined) {
    const adapter = String(next.designPlatformAdapter || appConfig.designPlatformAdapter || defaultDesignPlatformAdapter);
    const fallback = zhenxiAiLoopbackAdapters.has(adapter) ? defaultArtImageLocalBaseUrl : defaultDesignPlatformBaseUrl;
    const requested = String(patch.baseUrl || "").trim() || fallback;
    next.designPlatformBaseUrl = validateDesignPlatformBaseUrl(requested, adapter);
  }

  const previousCredentialOrigins = {
    accessTokenOrigin: appConfig.designPlatformAccessTokenOrigin,
    cookieOrigin: appConfig.designPlatformCookieOrigin,
    apiKeyOrigin: appConfig.designPlatformApiKeyOrigin,
    deviceIdOrigin: appConfig.designPlatformDeviceIdOrigin,
  };
  const candidate = resolveDesignPlatformRuntime(next, previousCredentialOrigins);
  const previousOrigin = normalizeHttpOrigin(appConfig.designPlatformBaseUrl);
  const candidateOrigin = new URL(candidate.baseUrl).origin;
  if (previousOrigin && previousOrigin !== candidateOrigin) {
    delete next.designPlatformApiKey;
    delete next.designPlatformAccessToken;
    delete next.designPlatformCookie;
    delete next.designPlatformApiKeyOrigin;
    delete next.designPlatformAccessTokenOrigin;
    delete next.designPlatformCookieOrigin;
  }
  if (patch.apiKey !== undefined) {
    setRuntimeString(next, "designPlatformApiKey", patch.apiKey);
    setRuntimeCredentialOrigin(next, "designPlatformApiKeyOrigin", patch.apiKey, candidateOrigin);
  }
  if (patch.accessToken !== undefined) {
    setRuntimeString(next, "designPlatformAccessToken", patch.accessToken);
    setRuntimeCredentialOrigin(next, "designPlatformAccessTokenOrigin", patch.accessToken, candidateOrigin);
  }
  if (patch.cookie !== undefined) {
    setRuntimeString(next, "designPlatformCookie", patch.cookie);
    setRuntimeCredentialOrigin(next, "designPlatformCookieOrigin", patch.cookie, candidateOrigin);
  }
  if (patch.deviceId !== undefined) {
    setRuntimeString(next, "designPlatformDeviceId", patch.deviceId);
    setRuntimeCredentialOrigin(next, "designPlatformDeviceIdOrigin", patch.deviceId, candidateOrigin);
  }
  if (next.designPlatformAccessToken && !next.designPlatformAccessTokenOrigin) {
    next.designPlatformAccessTokenOrigin = candidateOrigin;
  }
  if (next.designPlatformApiKey && !next.designPlatformApiKeyOrigin) {
    next.designPlatformApiKeyOrigin = candidateOrigin;
  }
  if (next.designPlatformCookie && !next.designPlatformCookieOrigin) {
    next.designPlatformCookieOrigin = candidateOrigin;
  }
  if (next.designPlatformDeviceId && !next.designPlatformDeviceIdOrigin) {
    next.designPlatformDeviceIdOrigin = previousOrigin || candidateOrigin;
  }

  atomicWritePrivateJson(designPlatformRuntimeConfigPath, next);
  runtimeConfig = next;
  refreshDesignPlatformAppConfig();
  return getDesignPlatformRuntimeConfigSummary();
}

export function refreshDesignPlatformAppConfig() {
  runtimeConfig = readRuntimeConfig();
  const resolved = resolveDesignPlatformRuntime(runtimeConfig, {
    accessTokenOrigin: appConfig.designPlatformAccessTokenOrigin,
    cookieOrigin: appConfig.designPlatformCookieOrigin,
    apiKeyOrigin: appConfig.designPlatformApiKeyOrigin,
    deviceIdOrigin: appConfig.designPlatformDeviceIdOrigin,
  });
  appConfig.designPlatformAdapter = resolved.adapter;
  appConfig.designPlatformBaseUrl = resolved.baseUrl;
  appConfig.designPlatformApiKey = resolved.apiKey;
  appConfig.designPlatformAccessToken = resolved.accessToken;
  appConfig.designPlatformCookie = resolved.cookie;
  appConfig.designPlatformDeviceId = resolved.deviceId;
  appConfig.designPlatformAccessTokenOrigin = resolved.accessTokenOrigin;
  appConfig.designPlatformCookieOrigin = resolved.cookieOrigin;
  appConfig.designPlatformApiKeyOrigin = resolved.apiKeyOrigin;
  appConfig.designPlatformDeviceIdOrigin = resolved.deviceIdOrigin;
  return getDesignPlatformRuntimeConfigSummary();
}

export function getDesignPlatformRuntimeConfigSummary() {
  return {
    adapter: appConfig.designPlatformAdapter,
    baseUrl: appConfig.designPlatformBaseUrl,
    hasApiKey: Boolean(appConfig.designPlatformApiKey),
    hasAccessToken: Boolean(appConfig.designPlatformAccessToken),
    hasCookie: Boolean(appConfig.designPlatformCookie),
    hasDeviceId: Boolean(appConfig.designPlatformDeviceId),
    credentialsBoundToBase: designPlatformCredentialsBoundToBase(),
    hasCallbackApiKey: hasIndependentDesignPlatformCallbackApiKey(),
    customerServicePublicBaseUrl: appConfig.customerServicePublicBaseUrl,
    callbackUrl:
      appConfig.designPlatformCallbackUrl ||
      `${appConfig.customerServicePublicBaseUrl}/api/integrations/design-platform/callback`,
    zhenxiAi: appConfig.zhenxiAi,
    mcp: {
      enabled: appConfig.designPlatformAdapter === "zhenxi_external" && process.env.ZHENXI_MCP_ENABLED !== "0",
      transport: "stdio",
      target: "installed_release",
      workflow: "copy_then_image_stream",
    },
    deviceIdSuffix: appConfig.designPlatformDeviceId ? appConfig.designPlatformDeviceId.slice(-6) : "",
    runtimeConfigPath: designPlatformRuntimeConfigPath,
  };
}

function resolveZhenxiAiLinks() {
  const primaryAppUrl = publicOriginEnv("ZHENXI_AI_APP_URL", defaultZhenxiAiAppUrl);
  const websiteUrl = publicOriginEnv("ZHENXI_AI_SITE_URL", defaultZhenxiAiSiteUrl);
  const wwwWebsiteUrl = publicOriginEnv("ZHENXI_AI_WWW_URL", defaultZhenxiAiWwwUrl);
  const localDevUrl = publicOriginEnv("ZHENXI_AI_LOCAL_DEV_URL", defaultArtImageLocalBaseUrl);
  const localPreviewUrl = publicOriginEnv("ZHENXI_AI_LOCAL_PREVIEW_URL", defaultZhenxiAiLocalPreviewUrl);
  const localConfiguredUrl = process.env.ZHENXI_AI_LOCAL_BASE_URL
    ? publicOriginEnv("ZHENXI_AI_LOCAL_BASE_URL", process.env.ZHENXI_AI_LOCAL_BASE_URL)
    : "";
  const localExtraUrls = String(process.env.ZHENXI_AI_LOCAL_CANDIDATES || "")
    .split(",")
    .map((item) => publicOrigin(item))
    .filter(Boolean);
  return {
    primaryAppUrl,
    websiteUrl,
    wwwWebsiteUrl,
    localDevUrl,
    localPreviewUrl,
    localCandidateBaseUrls: uniqueOrigins([
      localConfiguredUrl,
      ...defaultZhenxiAiPackagedDesktopUrls,
      localDevUrl,
      localPreviewUrl,
      ...localExtraUrls,
    ]),
    authRedirectUrls: buildZhenxiAiAuthRedirectUrls([websiteUrl, wwwWebsiteUrl, primaryAppUrl]),
  };
}

function buildLoopbackOrigins(startPort: number, count: number) {
  return Array.from({ length: count }, (_, index) => `http://127.0.0.1:${startPort + index}`);
}

function uniqueOrigins(origins: string[]) {
  return [...new Set(origins.map((origin) => String(origin || "").trim()).filter(Boolean))];
}

function buildZhenxiAiAuthRedirectUrls(origins: string[]) {
  const urls: string[] = [];
  for (const origin of origins) {
    urls.push(`${origin}/auth/callback`);
    urls.push(`${origin}/auth/reset-password`);
  }
  return urls;
}

function publicOriginEnv(name: string, fallback: string) {
  const text = String(process.env[name] || fallback).trim();
  return publicOrigin(text, name);
}

function publicOrigin(value: string, name = "ZHENXI_AI_LOCAL_CANDIDATES entry") {
  const text = String(value || "").trim();
  if (!text) return "";
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment`);
  }
  if (parsed.protocol === "http:" && !isLiteralLoopbackHost(parsed.hostname)) {
    throw new Error(`${name} must use HTTPS unless it is a loopback development URL`);
  }
  return parsed.origin;
}

function setRuntimeString(target: Record<string, unknown>, key: string, value: string) {
  const text = String(value || "").trim();
  if (text) target[key] = text;
  else delete target[key];
}

function trimTrailingSlash(value: string) {
  return String(value || "").replace(/\/+$/, "");
}

function setRuntimeCredentialOrigin(
  target: Record<string, unknown>,
  key: string,
  credential: string,
  origin: string,
) {
  if (String(credential || "").trim()) target[key] = origin;
  else delete target[key];
}

export function validateDesignPlatformBaseUrl(value: string, adapter: string) {
  const text = String(value || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("design platform base URL must be an absolute HTTP(S) URL");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("design platform base URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("design platform base URL cannot contain credentials, query, or fragment");
  }
  if (parsed.pathname !== "/") {
    throw new Error("design platform base URL must not contain a path");
  }
  const loopback = isLiteralLoopbackHost(parsed.hostname);
  if (zhenxiAiLoopbackAdapters.has(adapter) && !loopback) {
    throw new Error(`${adapter} design platform must use an explicit loopback address`);
  }
  if (parsed.protocol === "http:" && !loopback) {
    throw new Error("remote design platform base URL must use HTTPS");
  }
  if (!loopback && !configuredDesignPlatformAllowedOrigins().has(parsed.origin)) {
    throw new Error(
      "remote design platform base URL origin is not allowlisted; configure DESIGN_PLATFORM_ALLOWED_ORIGINS",
    );
  }
  return parsed.origin;
}

export function configuredDesignPlatformAllowedOrigins() {
  const allowed = new Set<string>();
  const configuredBase = strictHttpOrigin(process.env.DESIGN_PLATFORM_BASE_URL);
  if (configuredBase) allowed.add(configuredBase);
  for (const entry of String(process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS || "").split(",")) {
    const origin = strictHttpOrigin(entry);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

export function hasIndependentDesignPlatformCallbackApiKey() {
  const callbackKey = String(appConfig.callbackApiKey || "").trim();
  if (!callbackKey) return false;
  const reservedSecrets = [
    appConfig.internalApiToken,
    appConfig.designPlatformApiKey,
    appConfig.designPlatformAccessToken,
    appConfig.designPlatformCookie,
    ...cookieSecretValues(appConfig.designPlatformCookie),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return reservedSecrets.every((secret) => !constantTimeSecretEqual(callbackKey, secret));
}

export function constantTimeSecretEqual(left: unknown, right: unknown) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeHttpOrigin(value: unknown) {
  try {
    const parsed = new URL(String(value || "").trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

function strictHttpOrigin(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function isLiteralLoopbackHost(hostname: string) {
  const normalized = String(hostname || "").toLowerCase();
  if (normalized === "[::1]" || normalized === "::1") return true;
  if (!/^127(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  return normalized
    .split(".")
    .slice(1)
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function designPlatformCredentialsBoundToBase() {
  const baseOrigin = normalizeHttpOrigin(appConfig.designPlatformBaseUrl);
  if (appConfig.designPlatformAdapter === "zhenxi_external") {
    return (
      (!appConfig.designPlatformApiKey || appConfig.designPlatformApiKeyOrigin === baseOrigin) &&
      (!appConfig.designPlatformAccessToken || appConfig.designPlatformAccessTokenOrigin === baseOrigin)
    );
  }
  return (
    (!appConfig.designPlatformAccessToken || appConfig.designPlatformAccessTokenOrigin === baseOrigin) &&
    (!appConfig.designPlatformCookie || appConfig.designPlatformCookieOrigin === baseOrigin) &&
    (!appConfig.designPlatformApiKey || appConfig.designPlatformApiKeyOrigin === baseOrigin) &&
    (!appConfig.designPlatformDeviceId || appConfig.designPlatformDeviceIdOrigin === baseOrigin)
  );
}

function cookieSecretValues(cookie: unknown) {
  return String(cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator >= 0 ? part.slice(separator + 1).trim() : part;
    })
    .filter(Boolean);
}
