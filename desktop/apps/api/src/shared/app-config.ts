import fs from "node:fs";
import path from "node:path";

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

const defaultDesignPlatformAdapter = "standard_v1";
const defaultDesignPlatformBaseUrl = "http://127.0.0.1:3700";
const designPlatformRuntimeConfigPath = path.resolve(
  process.env.DESIGN_PLATFORM_RUNTIME_CONFIG || "./.runtime/design-platform-config.json",
);

function readRuntimeConfig(): Record<string, unknown> {
  const configPath = designPlatformRuntimeConfigPath;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function stringConfig(envName: string, runtimeKey: string, fallback: string, config = runtimeConfig): string {
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== "") return envValue;
  const runtimeValue = config[runtimeKey];
  if (typeof runtimeValue === "string" && runtimeValue.trim()) return runtimeValue;
  return fallback;
}

let runtimeConfig = readRuntimeConfig();

function resolveDesignPlatformRuntime(config = runtimeConfig) {
  const adapter = stringConfig("DESIGN_PLATFORM_ADAPTER", "designPlatformAdapter", defaultDesignPlatformAdapter, config);
  const baseUrl = stringConfig(
    "DESIGN_PLATFORM_BASE_URL",
    "designPlatformBaseUrl",
    adapter === "art_image_local" ? "http://127.0.0.1:3000" : defaultDesignPlatformBaseUrl,
    config,
  );
  return {
    adapter,
    baseUrl,
    accessToken: stringConfig("DESIGN_PLATFORM_ACCESS_TOKEN", "designPlatformAccessToken", "", config),
    cookie: stringConfig("DESIGN_PLATFORM_COOKIE", "designPlatformCookie", "", config),
    deviceId: stringConfig("DESIGN_PLATFORM_DEVICE_ID", "designPlatformDeviceId", "", config),
  };
}

const designPlatformRuntime = resolveDesignPlatformRuntime();

export const appConfig = {
  apiPort: numberEnv("API_PORT", 3200),
  useLocalStore: process.env.USE_LOCAL_STORE !== "false",
  localStorageRoot: path.resolve(process.env.LOCAL_STORAGE_ROOT || "./storage"),
  designPlatformAdapter: designPlatformRuntime.adapter,
  designPlatformBaseUrl: designPlatformRuntime.baseUrl,
  designPlatformApiKey: process.env.DESIGN_PLATFORM_API_KEY || "",
  designPlatformAccessToken: designPlatformRuntime.accessToken,
  designPlatformCookie: designPlatformRuntime.cookie,
  designPlatformDeviceId: designPlatformRuntime.deviceId,
  designPlatformTimeoutMs: numberEnv("DESIGN_PLATFORM_TIMEOUT_MS", 30 * 60 * 1000),
  designPlatformImageSize: process.env.DESIGN_PLATFORM_IMAGE_SIZE || "1024x1024",
  designPlatformImageRatio: process.env.DESIGN_PLATFORM_IMAGE_RATIO || "1:1",
  designPlatformCardType: process.env.DESIGN_PLATFORM_CARD_TYPE || "礼盒真实产品摆拍",
  designResultPollIntervalMs: numberEnv("DESIGN_RESULT_POLL_INTERVAL_MS", 5000),
  designResultPollMaxMs: numberEnv("DESIGN_RESULT_POLL_MAX_MS", 20 * 60 * 1000),
  callbackApiKey: process.env.DESIGN_PLATFORM_CALLBACK_API_KEY || "",
  wechatSendAdapter: process.env.WECHAT_SEND_ADAPTER || "dry_run",
  wechatBridgeOutboxDir: path.resolve(process.env.WECHAT_BRIDGE_OUTBOX_DIR || "./.runtime/wechat-outbox"),
  wechatBridgeInboxDir: path.resolve(process.env.WECHAT_BRIDGE_INBOX_DIR || "./.runtime/wechat-inbox"),
  wechatBridgeLockDir: path.resolve(process.env.WECHAT_BRIDGE_LOCK_DIR || "./.runtime/wechat-bridge-locks"),
  wechatBridgeWorkerStatusFile: path.resolve(process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE || "./.runtime/wechat-bridge-worker-status.json"),
  wechatWindowSnapshotInboxDir: path.resolve(process.env.WECHAT_WINDOW_SNAPSHOT_INBOX_DIR || "./.runtime/wechat-window-snapshots"),
  wechatWindowObserverStatusFile: path.resolve(process.env.WECHAT_WINDOW_OBSERVER_STATUS_FILE || "./.runtime/wechat-window-observer-status.json"),
  wechatWindowSnapshotMaxAgeSeconds: numberEnv("WECHAT_WINDOW_SNAPSHOT_MAX_AGE_SECONDS", 30),
  wechatWorkCorpId: process.env.WECHAT_WORK_CORP_ID || "",
  wechatWorkAgentId: process.env.WECHAT_WORK_AGENT_ID || "",
  wechatWorkToken: process.env.WECHAT_WORK_TOKEN || "",
  wechatMiniAppId: process.env.WECHAT_MINI_APP_ID || "",
  wechatMiniToken: process.env.WECHAT_MINI_TOKEN || "",
  sendBridgeAckTimeoutMinutes: numberEnv("SEND_BRIDGE_ACK_TIMEOUT_MINUTES", 5),
  sendQueueStaleMinutes: numberEnv("SEND_QUEUE_STALE_MINUTES", 10),
  highValueAmountCny: numberEnv("HIGH_VALUE_AMOUNT_CNY", 10000),
  designTimeoutMinutes: numberEnv("DESIGN_TIMEOUT_MINUTES", 20),
  defaultOutputCount: numberEnv("DESIGN_DEFAULT_OUTPUT_COUNT", 6),
  lowValueAutomationEnabled: booleanEnv("LOW_VALUE_AUTOMATION_ENABLED", true),
  lowValueAutomationRunOnStart: booleanEnv("LOW_VALUE_AUTOMATION_RUN_ON_START", true),
  lowValueAutomationIntervalMs: numberEnv("LOW_VALUE_AUTOMATION_INTERVAL_MS", 15000),
  lowValueAutomationPollLimit: numberEnv("LOW_VALUE_AUTOMATION_POLL_LIMIT", 50),
  lowValueAutomationProcessSendQueue: booleanEnv("LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE", true),
  lowValueAutomationSendQueueLimit: numberEnv("LOW_VALUE_AUTOMATION_SEND_QUEUE_LIMIT", 10),
};

export type DesignPlatformRuntimeConfigPatch = {
  adapter?: string;
  baseUrl?: string;
  accessToken?: string;
  cookie?: string;
  deviceId?: string;
};

export function updateDesignPlatformRuntimeConfig(patch: DesignPlatformRuntimeConfigPatch) {
  const existing = readRuntimeConfig();
  const next = { ...existing };

  if (patch.adapter !== undefined) {
    const adapter = String(patch.adapter || "").trim();
    if (adapter !== "art_image_local" && adapter !== "standard_v1") {
      throw new Error("design platform adapter must be art_image_local or standard_v1");
    }
    next.designPlatformAdapter = adapter;
  }
  if (patch.baseUrl !== undefined) setRuntimeString(next, "designPlatformBaseUrl", patch.baseUrl);
  if (patch.accessToken !== undefined) setRuntimeString(next, "designPlatformAccessToken", patch.accessToken);
  if (patch.cookie !== undefined) setRuntimeString(next, "designPlatformCookie", patch.cookie);
  if (patch.deviceId !== undefined) setRuntimeString(next, "designPlatformDeviceId", patch.deviceId);

  fs.mkdirSync(path.dirname(designPlatformRuntimeConfigPath), { recursive: true });
  fs.writeFileSync(designPlatformRuntimeConfigPath, JSON.stringify(next, null, 2), "utf8");
  runtimeConfig = next;
  refreshDesignPlatformAppConfig();
  return getDesignPlatformRuntimeConfigSummary();
}

export function refreshDesignPlatformAppConfig() {
  runtimeConfig = readRuntimeConfig();
  const resolved = resolveDesignPlatformRuntime(runtimeConfig);
  appConfig.designPlatformAdapter = resolved.adapter;
  appConfig.designPlatformBaseUrl = resolved.baseUrl;
  appConfig.designPlatformAccessToken = resolved.accessToken;
  appConfig.designPlatformCookie = resolved.cookie;
  appConfig.designPlatformDeviceId = resolved.deviceId;
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
    deviceIdSuffix: appConfig.designPlatformDeviceId ? appConfig.designPlatformDeviceId.slice(-6) : "",
    runtimeConfigPath: designPlatformRuntimeConfigPath,
  };
}

function setRuntimeString(target: Record<string, unknown>, key: string, value: string) {
  const text = String(value || "").trim();
  if (text) target[key] = text;
  else delete target[key];
}
