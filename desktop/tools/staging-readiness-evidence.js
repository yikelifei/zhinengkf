"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRepositoryRevision } = require("./repository-provenance");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const SCHEMA_VERSION = "smart_kefu_staging_readiness_v2";
const READ_ONLY_ROUTES = Object.freeze([
  "/health",
  "/wechat-work/status",
  "/wechat-work/kf/audit?limit=100",
  "/integrations/design-platform/readiness",
  "/ai/providers/status",
  "/automation/status",
  "/automation/readiness",
]);
const LEGACY_PERSONAL_WECHAT_READ_ONLY_ROUTES = Object.freeze([
  "/wechat/channels/status",
  "/wechat/bridge/status",
]);
const AUTOMATION_QUEUE_NAME = "low-value-automation";
const AUTOMATION_SCHEDULER_ID = "low-value-automation-schedule-v1";
const AUTOMATION_COUNT_KEYS = Object.freeze(["waiting", "active", "delayed", "completed", "failed"]);
const PRIVATE_DNS_SUFFIX_PATTERN = /(?:^|\.)(?:corp|internal|intranet|lan|localdomain)$/i;

const desktopRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(desktopRoot, "..");
const reportRoot = path.join(desktopRoot, ".runtime", "staging-readiness-evidence");

function result(id, title, status, summary, options = {}) {
  if (!(status in STATUS_RANK)) throw new Error(`unsupported staging readiness status: ${status}`);
  return {
    id,
    title,
    status,
    summary,
    blockers: Array.isArray(options.blockers) ? options.blockers : [],
    evidence: options.evidence && typeof options.evidence === "object" ? options.evidence : {},
  };
}

function computeOverallStatus(results) {
  return results.reduce(
    (current, item) => (STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current),
    STATUS.PASS,
  );
}

function configured(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/(?:^|[-_.])(replace|placeholder|changeme|example|dummy|mock|your)(?:$|[-_.])/i.test(text);
}

function explicitFalse(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function legacyPersonalWechatEnabled(env) {
  return String(env?.WECHAT_PRODUCT_MODE || "enterprise_wechat_only").trim() === "legacy_personal_wechat";
}

function readOnlyRoutesFor(env) {
  return legacyPersonalWechatEnabled(env)
    ? [...READ_ONLY_ROUTES, ...LEGACY_PERSONAL_WECHAT_READ_ONLY_ROUTES]
    : [...READ_ONLY_ROUTES];
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (value.length >= 2 && value[0] === value.at(-1) && ["'", '"'].includes(value[0])) value = value.slice(1, -1);
    parsed[key] = value;
  }
  return parsed;
}

function readEffectiveEnvironment(root = repositoryRoot, inherited = process.env, envFile = "") {
  const fileEnvironment = envFile
    ? parseEnvFile(path.resolve(envFile))
    : {
        ...parseEnvFile(path.join(root, ".env")),
        ...parseEnvFile(path.join(root, "desktop", ".env")),
      };
  return { ...fileEnvironment, ...inherited };
}

function readJsonObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { present: false, valid: true, value: {} };
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? { present: true, valid: true, value }
      : { present: true, valid: false, value: {} };
  } catch {
    return { present: true, valid: false, value: {} };
  }
}

function resolveDesignRuntimeConfig(env, root = desktopRoot) {
  const runtimeRootValue = String(env.DESKTOP_RUNTIME_DIR || "").trim();
  const runtimeRoot = runtimeRootValue
    ? (path.isAbsolute(runtimeRootValue) ? runtimeRootValue : path.resolve(root, runtimeRootValue))
    : path.join(root, ".runtime");
  const configValue = String(env.DESIGN_PLATFORM_RUNTIME_CONFIG || "").trim();
  const configPath = configValue
    ? (path.isAbsolute(configValue) ? configValue : path.resolve(root, configValue))
    : path.join(runtimeRoot, "design-platform-config.json");
  return { configPath, ...readJsonObject(configPath) };
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(host) || host.endsWith(".local") || host.endsWith(".localhost") || PRIVATE_DNS_SUFFIX_PATTERN.test(host)) return true;
  if (host.includes(":")) return /^(?:fc|fd|fe[89ab]|0*:0*:0*:0*:0*:0*:0*:1$)/i.test(host);
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return !host.includes(".");
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function inspectUrl(value, policy = {}) {
  const text = String(value || "").trim();
  if (!configured(text)) return { configured: false, safe: false, reason: "missing", scheme: null, hostClass: null };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { configured: true, safe: false, reason: "invalid_url", scheme: null, hostClass: null };
  }
  const loopback = isLoopbackHost(parsed.hostname);
  const privateHost = isPrivateHost(parsed.hostname);
  const hostClass = loopback ? "loopback" : privateHost ? "private" : "public";
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { configured: true, safe: false, reason: "http_or_https_required", scheme: parsed.protocol, hostClass };
  }
  if (parsed.username || parsed.password) {
    return { configured: true, safe: false, reason: "url_must_not_embed_credentials", scheme: parsed.protocol, hostClass };
  }
  if (policy.loopbackOnly && !loopback) {
    return { configured: true, safe: false, reason: "loopback_required", scheme: parsed.protocol, hostClass };
  }
  if (policy.publicHttps && (parsed.protocol !== "https:" || privateHost)) {
    return { configured: true, safe: false, reason: "public_https_required", scheme: parsed.protocol, hostClass };
  }
  if (policy.httpsUnlessLoopback && parsed.protocol !== "https:" && !loopback) {
    return { configured: true, safe: false, reason: "https_required_for_non_loopback", scheme: parsed.protocol, hostClass };
  }
  if (policy.https && parsed.protocol !== "https:") {
    return { configured: true, safe: false, reason: "https_required", scheme: parsed.protocol, hostClass };
  }
  return { configured: true, safe: true, reason: "", scheme: parsed.protocol, hostClass };
}

function isMockDesignPlatformBaseUrl(value, env = {}) {
  const text = String(value || "").trim();
  if (!configured(text)) return false;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return false;
  }
  if (!isLoopbackHost(parsed.hostname)) return false;
  const mockPort = Number(env.MOCK_DESIGN_PLATFORM_PORT || 3700);
  const actualPort = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  return Number.isFinite(mockPort) && mockPort > 0 && actualPort === mockPort;
}

function inspectDatabaseUrl(value) {
  const text = String(value || "").trim();
  if (!configured(text)) {
    return { configured: false, safe: false, status: STATUS.BLOCKED, blockers: ["DATABASE_URL"] };
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { configured: true, safe: false, status: STATUS.FAIL, blockers: ["DATABASE_URL is not a valid URL"] };
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return { configured: true, safe: false, status: STATUS.FAIL, blockers: ["DATABASE_URL must use PostgreSQL"] };
  }
  const blockers = [];
  let status = STATUS.PASS;
  if (!parsed.username || !parsed.password || !parsed.pathname || parsed.pathname === "/") {
    blockers.push("DATABASE_URL must include an application user, password and database name");
    status = STATUS.BLOCKED;
  }
  const loweredUser = decodeURIComponent(parsed.username || "").toLowerCase();
  const loweredPassword = decodeURIComponent(parsed.password || "").toLowerCase();
  if (["postgres", "admin", "root"].includes(loweredUser) && ["postgres", "admin", "root", "password", "123456"].includes(loweredPassword)) {
    blockers.push("DATABASE_URL uses obvious default administrator credentials");
    status = STATUS.FAIL;
  }
  const remote = !isLoopbackHost(parsed.hostname);
  const sslMode = String(parsed.searchParams.get("sslmode") || "").toLowerCase();
  if (remote && !["require", "verify-ca", "verify-full"].includes(sslMode)) {
    blockers.push("remote DATABASE_URL needs explicit sslmode=require or stronger evidence");
    if (status !== STATUS.FAIL) status = STATUS.BLOCKED;
  }
  return {
    configured: true,
    safe: status === STATUS.PASS,
    status,
    blockers,
    evidence: { provider: "postgresql", hostClass: isLoopbackHost(parsed.hostname) ? "loopback" : isPrivateHost(parsed.hostname) ? "private" : "public", tlsModeConfigured: Boolean(sslMode) },
  };
}

function validWechatAesKey(value) {
  const text = String(value || "").trim();
  if (!configured(text) || text.length !== 43) return false;
  try {
    return Buffer.from(`${text}=`, "base64").length === 32;
  } catch {
    return false;
  }
}

function doctorComponent(report, id) {
  return Array.isArray(report?.components) ? report.components.find((item) => item?.id === id) : null;
}

function summarizeDoctor(report) {
  return (Array.isArray(report?.components) ? report.components : []).map((component) => ({
    id: String(component?.id || ""),
    status: String(component?.status || "blocked"),
    missingCount: Array.isArray(component?.missing) ? component.missing.length : 0,
  }));
}

function staticResults(env, doctorReport, options = {}) {
  const results = [];
  const inventoryValid = doctorReport?.schemaVersion === "smart_kefu_config_readiness_v1";
  results.push(
    inventoryValid
      ? result("config.doctor", "配置 doctor 证据", STATUS.PASS, "现有脱敏配置 doctor 已完成。", {
          evidence: { overall: doctorReport.overall, components: summarizeDoctor(doctorReport), liveChecksPerformed: false },
        })
      : doctorReport
        ? result("config.doctor", "配置 doctor 证据", STATUS.FAIL, "配置 doctor 未返回受支持的报告结构。")
        : result("config.doctor", "配置 doctor 证据", STATUS.BLOCKED, "当前发布包未提供配置 doctor 证据，不能据此判定运行时故障。", {
            blockers: ["configuration doctor evidence unavailable"],
          }),
  );

  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  const environmentBlockers = [];
  let environmentStatus = STATUS.PASS;
  if (!nodeEnv) {
    environmentBlockers.push("NODE_ENV=production or staging");
    environmentStatus = STATUS.BLOCKED;
  } else if (!["production", "staging"].includes(nodeEnv)) {
    environmentBlockers.push("NODE_ENV must not be development or test in staging");
    environmentStatus = STATUS.FAIL;
  }
  if (!Object.prototype.hasOwnProperty.call(env, "USE_LOCAL_STORE")) {
    environmentBlockers.push("USE_LOCAL_STORE=false");
    if (environmentStatus !== STATUS.FAIL) environmentStatus = STATUS.BLOCKED;
  } else if (!explicitFalse(env.USE_LOCAL_STORE)) {
    environmentBlockers.push("staging must use Prisma persistence instead of local JSON");
    environmentStatus = STATUS.FAIL;
  }
  results.push(
    result("config.environment", "预发布运行模式", environmentStatus, environmentStatus === STATUS.PASS ? "已显式启用预发布/生产模式和 Prisma 持久化。" : "运行模式缺失或不符合预发布安全要求。", {
      blockers: environmentBlockers,
      evidence: { environmentClass: ["production", "staging"].includes(nodeEnv) ? nodeEnv : nodeEnv ? "unsafe" : "missing", prismaPersistenceRequested: explicitFalse(env.USE_LOCAL_STORE) },
    }),
  );

  const database = inspectDatabaseUrl(env.DATABASE_URL);
  results.push(
    result("config.database", "PostgreSQL 配置", database.status, database.status === STATUS.PASS ? "PostgreSQL URL 结构正确，未发现明显不安全默认值。" : "PostgreSQL 预发布配置需要处理。", {
      blockers: database.blockers,
      evidence: database.evidence || { provider: "postgresql", configured: database.configured },
    }),
  );

  const automation = doctorComponent(doctorReport, "automation_scheduler");
  const automationDetails = automation?.details && typeof automation.details === "object" ? automation.details : {};
  const automationEnabled = automation
    ? automationDetails.enabled === true
    : ["1", "true", "yes", "on"].includes(String(env.LOW_VALUE_AUTOMATION_ENABLED || "").trim().toLowerCase());
  const automationMode = automation ? automationDetails.mode : String(env.LOW_VALUE_AUTOMATION_MODE || "").trim();
  const automationDurable = automation ? automationDetails.durable === true : automationMode === "durable";
  const automationRedisConfigured = automation
    ? automationDetails.redisUrlConfigured === true
    : configured(env.LOW_VALUE_AUTOMATION_REDIS_URL);
  const automationBlockers = [];
  if (automation && automation.status !== "ready") automationBlockers.push("config doctor automation_scheduler status=ready");
  if (!automationEnabled) automationBlockers.push("LOW_VALUE_AUTOMATION_ENABLED=1");
  if (automationMode !== "durable" || !automationDurable) {
    automationBlockers.push("LOW_VALUE_AUTOMATION_MODE=durable");
  }
  if (!automationRedisConfigured) automationBlockers.push("LOW_VALUE_AUTOMATION_REDIS_URL");
  results.push(
    result(
      "config.automation_queue",
      "BullMQ/Redis 持久调度配置",
      automationBlockers.length ? STATUS.BLOCKED : STATUS.PASS,
      automationBlockers.length ? "自动化持久调度配置尚未满足预发布要求。" : "已请求 durable 模式并配置 Redis；实时连接由只读 API 证据确认。",
      {
        blockers: [...new Set(automationBlockers)],
        evidence: {
          enabled: automationEnabled,
          mode: automationMode === "durable" ? "durable" : "other",
          durable: automationDurable,
          redisUrlConfigured: automationRedisConfigured,
          liveConnectionChecked: false,
        },
      },
    ),
  );

  const apiBase = String(options.apiBase || env.STAGING_API_BASE || env.ACCEPTANCE_API_BASE || "http://127.0.0.1:3200/api");
  const apiUrl = inspectUrl(apiBase, { httpsUnlessLoopback: true });
  const internalTokenConfigured = configured(env.INTERNAL_API_TOKEN);
  const apiBlockers = [];
  let apiStatus = STATUS.PASS;
  if (!apiUrl.safe) {
    apiBlockers.push(`staging API base: ${apiUrl.reason}`);
    apiStatus = apiUrl.configured ? STATUS.FAIL : STATUS.BLOCKED;
  }
  if (!internalTokenConfigured) {
    apiBlockers.push("INTERNAL_API_TOKEN");
    if (apiStatus !== STATUS.FAIL) apiStatus = STATUS.BLOCKED;
  }
  results.push(
    result("config.api_access", "预发布 API 只读访问", apiStatus, apiStatus === STATUS.PASS ? "API URL 策略和内部访问令牌存在性检查通过。" : "预发布 API 只读探测尚不可信。", {
      blockers: apiBlockers,
      evidence: { apiBase: { scheme: apiUrl.scheme, hostClass: apiUrl.hostClass }, internalApiTokenConfigured: internalTokenConfigured },
    }),
  );

  const publicCallback = inspectUrl(env.CUSTOMER_SERVICE_PUBLIC_BASE_URL, { publicHttps: true });
  const wechatApi = inspectUrl(env.WECHAT_WORK_API_BASE_URL || "https://qyapi.weixin.qq.com", { https: true });
  const wechatRequired = ["WECHAT_WORK_CORP_ID", "WECHAT_WORK_SECRET", "WECHAT_WORK_TOKEN"].filter((name) => !configured(env[name]));
  if (!validWechatAesKey(env.WECHAT_WORK_ENCODING_AES_KEY)) wechatRequired.push("WECHAT_WORK_ENCODING_AES_KEY must decode to 32 bytes");
  if (String(env.WECHAT_SEND_ADAPTER || "").trim() !== "wechat_work_kf") wechatRequired.push("WECHAT_SEND_ADAPTER=wechat_work_kf");
  if (!publicCallback.safe) wechatRequired.push(`CUSTOMER_SERVICE_PUBLIC_BASE_URL: ${publicCallback.reason}`);
  if (!wechatApi.safe) wechatRequired.push(`WECHAT_WORK_API_BASE_URL: ${wechatApi.reason}`);
  const wechatUnsafe = (publicCallback.configured && !publicCallback.safe) || (wechatApi.configured && !wechatApi.safe);
  results.push(
    result("config.wechat_work", "企业微信生产配置", wechatRequired.length ? (wechatUnsafe ? STATUS.FAIL : STATUS.BLOCKED) : STATUS.PASS, wechatRequired.length ? "企业微信配置不完整或不安全。" : "企业微信凭据已注入，URL 符合预发布策略。", {
      blockers: wechatRequired,
      evidence: {
        credentialPresence: { corpId: configured(env.WECHAT_WORK_CORP_ID), secret: configured(env.WECHAT_WORK_SECRET), token: configured(env.WECHAT_WORK_TOKEN), encodingAesKey: validWechatAesKey(env.WECHAT_WORK_ENCODING_AES_KEY) },
        publicCallback: { scheme: publicCallback.scheme, hostClass: publicCallback.hostClass },
        officialApi: { scheme: wechatApi.scheme, hostClass: wechatApi.hostClass },
      },
    }),
  );

  const designDoctor = doctorComponent(doctorReport, "design_platform");
  const designRuntime = resolveDesignRuntimeConfig(env, options.desktopRoot || desktopRoot);
  const designAdapter = String(env.DESIGN_PLATFORM_ADAPTER || designRuntime.value.designPlatformAdapter || designDoctor?.details?.adapter || "").trim();
  const designBaseValue = env.DESIGN_PLATFORM_BASE_URL || designRuntime.value.designPlatformBaseUrl || "";
  const designBase = inspectUrl(designBaseValue, { httpsUnlessLoopback: true });
  const designBaseIsMock = isMockDesignPlatformBaseUrl(designBaseValue, env);
  const designBlockers = [];
  let designStatus = STATUS.PASS;
  if (designAdapter !== "art_image_local") {
    designBlockers.push("DESIGN_PLATFORM_ADAPTER=art_image_local");
    designStatus = STATUS.BLOCKED;
  }
  if (!designBase.safe) {
    designBlockers.push(`DESIGN_PLATFORM_BASE_URL: ${designBase.reason}`);
    designStatus = designBase.configured ? STATUS.FAIL : STATUS.BLOCKED;
  }
  if (designBaseIsMock) {
    designBlockers.push("DESIGN_PLATFORM_BASE_URL must point to Zhenxi AI, not MOCK_DESIGN_PLATFORM_PORT");
    designStatus = STATUS.FAIL;
  }
  if (!designRuntime.valid) {
    designBlockers.push("DESIGN_PLATFORM_RUNTIME_CONFIG must contain a JSON object");
    designStatus = STATUS.FAIL;
  }
  const designCredentialConfigured = [
    env.DESIGN_PLATFORM_ACCESS_TOKEN,
    env.DESIGN_PLATFORM_COOKIE,
    env.DESIGN_PLATFORM_API_KEY,
    designRuntime.value.designPlatformAccessToken,
    designRuntime.value.designPlatformCookie,
    designRuntime.value.designPlatformApiKey,
  ].some(configured);
  if (!designCredentialConfigured) {
    designBlockers.push("design platform access credential");
    if (designStatus !== STATUS.FAIL) designStatus = STATUS.BLOCKED;
  }
  const designDeviceConfigured = configured(env.DESIGN_PLATFORM_DEVICE_ID || designRuntime.value.designPlatformDeviceId);
  if (!designDeviceConfigured) {
    designBlockers.push("DESIGN_PLATFORM_DEVICE_ID");
    if (designStatus !== STATUS.FAIL) designStatus = STATUS.BLOCKED;
  }
  results.push(
    result("config.design_platform", "设计平台生产配置", designStatus, designStatus === STATUS.PASS ? "真实设计适配器、凭据和设备证据已配置。" : "设计平台预发布配置不完整或不安全。", {
      blockers: designBlockers,
      evidence: {
        adapter: designAdapter || "missing",
        baseUrl: { scheme: designBase.scheme, hostClass: designBase.hostClass, mockPortSelected: designBaseIsMock },
        credentialConfigured: designCredentialConfigured,
        deviceIdConfigured: designDeviceConfigured,
        runtimeConfigPresent: designRuntime.present,
        runtimeConfigValid: designRuntime.valid,
      },
    }),
  );

  if (legacyPersonalWechatEnabled(env)) {
    const accountsConfig = String(env.PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE || ".runtime/personal-wechat-accounts.json").trim();
    const accountsPath = path.isAbsolute(accountsConfig) ? accountsConfig : path.resolve(options.desktopRoot || desktopRoot, accountsConfig);
    const personalEndpoint = inspectUrl(env.PERSONAL_WECHAT_RPA_ENDPOINT || "http://127.0.0.1:3211", { loopbackOnly: true });
    const personalBlockers = [];
    let personalStatus = STATUS.PASS;
    if (!fs.existsSync(accountsPath)) {
      personalBlockers.push("PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE");
      personalStatus = STATUS.BLOCKED;
    }
    if (!personalEndpoint.safe) {
      personalBlockers.push(`PERSONAL_WECHAT_RPA_ENDPOINT: ${personalEndpoint.reason}`);
      personalStatus = STATUS.FAIL;
    }
    if (String(env.PERSONAL_WECHAT_DRIVER || "windows_uia") === "wechatauto_rpa" && !configured(env.PERSONAL_WECHAT_RPA_TOKEN)) {
      personalBlockers.push("PERSONAL_WECHAT_RPA_TOKEN");
      if (personalStatus !== STATUS.FAIL) personalStatus = STATUS.BLOCKED;
    }
    results.push(
      result("config.personal_wechat", "遗留个人微信桥配置", personalStatus, personalStatus === STATUS.PASS ? "遗留账号绑定配置和回环 RPA 策略通过。" : "遗留个人微信本地绑定证据补齐前保持阻塞。", {
        blockers: personalBlockers,
        evidence: { accountsConfigPresent: fs.existsSync(accountsPath), driver: String(env.PERSONAL_WECHAT_DRIVER || "windows_uia"), rpaEndpoint: { scheme: personalEndpoint.scheme, hostClass: personalEndpoint.hostClass }, defaultSendAdapterSelected: String(env.WECHAT_SEND_ADAPTER || "").trim() === "windows_bridge", realSendEnabled: String(env.PERSONAL_WECHAT_SEND || "") === "1" },
      }),
    );
  }

  const model = doctorComponent(doctorReport, "model_chain");
  results.push(
    model?.status === "ready"
      ? result("config.model_chain", "AI 模型链配置", STATUS.PASS, "现有模型链 doctor 已确认至少一个可用 provider。", { evidence: { status: "ready", configuredAttemptCount: Number(model?.details?.attemptOrder?.length || 0) } })
      : result("config.model_chain", "AI 模型链配置", STATUS.BLOCKED, "现有模型链 doctor 仍缺少 provider 证据。", { blockers: Array.isArray(model?.missing) ? model.missing : ["config doctor model_chain result"], evidence: { status: model?.status || "missing" } }),
  );

  return { results, apiBase, apiUrl };
}

function notExecutedResults(env = {}) {
  const entries = [
    ["evidence.database_migrations", "预发布数据库迁移证据"],
    ["evidence.api_health", "预发布 API 与 Prisma 模式证据"],
    ["evidence.wechat_work", "企业微信回调与审计证据"],
    ["evidence.design_platform", "设计平台实时就绪证据"],
    ["evidence.model_chain", "客服大模型运行配置证据"],
    ["evidence.automation_queue", "BullMQ/Redis 持久调度证据"],
  ];
  if (legacyPersonalWechatEnabled(env)) entries.splice(4, 0, ["evidence.personal_wechat", "遗留个人微信桥就绪证据"]);
  return entries.map(([id, title]) => result(id, title, STATUS.BLOCKED, "尚未执行；请在受控预发布环境显式加入 --execute 重跑。", { blockers: ["explicit --execute approval"] }));
}

function defaultRunCommand(spec) {
  return spawnSync(spec.command, spec.args || [], {
    cwd: spec.cwd,
    env: { ...process.env, ...(spec.env || {}) },
    encoding: "utf8",
    timeout: spec.timeoutMs || 60_000,
    maxBuffer: 1024 * 1024 * 20,
    windowsHide: true,
    shell: false,
  });
}

function doctorCommand(root = repositoryRoot, platform = process.platform, environment = process.env) {
  if (platform === "win32") {
    const scriptPath = path.join(root, "config-readiness-doctor.cmd");
    return { command: environment.ComSpec || "cmd.exe", args: ["/d", "/c", "call", scriptPath, "--json"], scriptPath };
  }
  const scriptPath = path.join(root, "scripts", "config_readiness_doctor.py");
  return { command: environment.PYTHON || "python3", args: [scriptPath, "--json"], scriptPath };
}

function parseJsonOutput(output) {
  const text = String(output || "").replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error("command did not return JSON");
  }
}

function loadDoctorReport(runCommand = defaultRunCommand, root = repositoryRoot, env = process.env) {
  const command = doctorCommand(root);
  if (!fs.existsSync(command.scriptPath)) {
    return { unavailable: "configuration doctor is not packaged in this runtime release" };
  }
  const executed = runCommand({
    id: "config-doctor",
    ...command,
    cwd: root,
    env: { ...env, SMART_KEFU_QUIET_EXIT: "1" },
    timeoutMs: 60_000,
  });
  if (executed?.error || ![0, 2].includes(Number(executed?.status))) {
    return { error: "configuration doctor command failed" };
  }
  try {
    return { report: parseJsonOutput(executed.stdout) };
  } catch {
    return { error: "configuration doctor returned invalid JSON" };
  }
}

async function defaultFetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
  try {
    const response = await fetch(url, { method: "GET", headers: options.headers || {}, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error("read-only staging endpoint did not return 2xx");
      error.status = response.status;
      throw error;
    }
    if (text.length > 2 * 1024 * 1024) throw new Error("read-only staging endpoint response is too large");
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

function joinApiRoute(base, route) {
  return new URL(String(route).replace(/^\/+/, ""), `${String(base).replace(/\/+$/, "")}/`).toString();
}

function blockedExternal(id, title, summary, blockers = []) {
  return result(id, title, STATUS.BLOCKED, summary, { blockers });
}

function safeCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function safeQueueCounts(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(AUTOMATION_COUNT_KEYS.map((key) => [key, safeCount(source[key])]));
}

function evaluateAutomationEvidence(status, readiness) {
  const scheduler = status?.scheduler && typeof status.scheduler === "object" ? status.scheduler : {};
  const durable = scheduler.durableEvidence && typeof scheduler.durableEvidence === "object" ? scheduler.durableEvidence : {};
  const schedulerEvidence = durable.scheduler && typeof durable.scheduler === "object" ? durable.scheduler : {};
  const readinessCheck = Array.isArray(readiness?.checks)
    ? readiness.checks.find((check) => check?.key === "automation_scheduler")
    : null;
  const counts = safeQueueCounts(durable.counts);
  const blockers = [];
  if (status?.mode !== "durable" || scheduler.mode !== "durable") blockers.push("automation mode=durable");
  if (status?.evidenceSource !== "bullmq_redis" || status?.durableEvidenceSource !== "bullmq_redis" || scheduler.evidenceSource !== "bullmq_redis") {
    blockers.push("evidence source=bullmq_redis");
  }
  if (scheduler.enabled !== true) blockers.push("automation enabled=true");
  if (scheduler.active !== true) blockers.push("scheduler active=true");
  if (scheduler.configured !== true) blockers.push("Redis configured=true");
  if (scheduler.connected !== true) blockers.push("Redis connected=true");
  if (scheduler.scheduled !== true) blockers.push("scheduler scheduled=true");
  if (scheduler.workerReady !== true) blockers.push("worker ready=true");
  if (scheduler.queueName !== AUTOMATION_QUEUE_NAME) blockers.push(`queue name=${AUTOMATION_QUEUE_NAME}`);
  if (scheduler.schedulerId !== AUTOMATION_SCHEDULER_ID) blockers.push(`scheduler id=${AUTOMATION_SCHEDULER_ID}`);
  if (scheduler.attempts !== 1) blockers.push("job template attempts=1");
  if (scheduler.maxStalledCount !== 0) blockers.push("max stalled count=0");
  if (scheduler.localConcurrency !== 1) blockers.push("local concurrency=1");
  if (scheduler.globalConcurrency !== 1 || durable.globalConcurrency !== 1) blockers.push("global concurrency=1");
  if (durable.available !== true) blockers.push("durable evidence available=true");
  if (schedulerEvidence.present !== true) blockers.push("fixed scheduler present=true");
  if (!(safeCount(durable.workerCount) >= 1)) blockers.push("worker count>=1");
  if (Object.values(counts).some((value) => value === null)) blockers.push("queue counts available");
  if (readiness?.ready !== true) blockers.push("automation readiness ready=true");
  if (readinessCheck?.ok !== true || readinessCheck?.severity === "error") blockers.push("automation scheduler readiness check ok=true");

  return result(
    "evidence.automation_queue",
    "BullMQ/Redis 持久调度证据",
    blockers.length ? STATUS.BLOCKED : STATUS.PASS,
    blockers.length ? "自动化 durable runtime 的只读证据尚未完整就绪。" : "Redis、固定 scheduler、Worker、并发和失败关闭参数的只读证据齐全。",
    {
      blockers,
      evidence: {
        mode: status?.mode === "durable" && scheduler.mode === "durable" ? "durable" : "other",
        evidenceSource:
          status?.evidenceSource === "bullmq_redis"
          && status?.durableEvidenceSource === "bullmq_redis"
          && scheduler.evidenceSource === "bullmq_redis"
            ? "bullmq_redis"
            : "other",
        enabled: scheduler.enabled === true,
        active: scheduler.active === true,
        configured: scheduler.configured === true,
        connected: scheduler.connected === true,
        scheduled: scheduler.scheduled === true,
        workerReady: scheduler.workerReady === true,
        queueName: scheduler.queueName === AUTOMATION_QUEUE_NAME ? AUTOMATION_QUEUE_NAME : "unexpected",
        schedulerId: scheduler.schedulerId === AUTOMATION_SCHEDULER_ID ? AUTOMATION_SCHEDULER_ID : "unexpected",
        templateAttempts: scheduler.attempts === 1 ? 1 : null,
        maxStalledCount: scheduler.maxStalledCount === 0 ? 0 : null,
        localConcurrency: scheduler.localConcurrency === 1 ? 1 : null,
        globalConcurrency:
          scheduler.globalConcurrency === 1 && durable.globalConcurrency === 1 ? 1 : null,
        durableEvidenceAvailable: durable.available === true,
        schedulerPresent: schedulerEvidence.present === true,
        workerCount: safeCount(durable.workerCount),
        counts,
        readinessReady: readiness?.ready === true,
        readinessCheckOk: readinessCheck?.ok === true && readinessCheck?.severity !== "error",
      },
    },
  );
}

async function executeReadOnlyEvidence({ env, apiBase, apiUrl, runCommand = defaultRunCommand, fetchJson = defaultFetchJson, desktop = desktopRoot }) {
  const results = [];
  const prismaCli = path.join(desktop, "node_modules", "prisma", "build", "index.js");
  let migration = null;
  if (!fs.existsSync(prismaCli)) {
    results.push(result("evidence.database_migrations", "预发布数据库迁移证据", STATUS.FAIL, "仓库锁定版本的 Prisma CLI 缺失；本检查未尝试下载替代包。", { blockers: ["install the locked desktop dependencies before staging checks"] }));
  } else {
    migration = runCommand({ id: "prisma-migrate-status", command: process.execPath, args: [prismaCli, "migrate", "status", "--schema", "prisma/schema.prisma"], cwd: desktop, env: { DATABASE_URL: env.DATABASE_URL, NEXT_TELEMETRY_DISABLED: "1" }, timeoutMs: 120_000 });
  }
  if (!migration) {
    // Missing local tooling was recorded above. Never let a package runner fetch a replacement.
  } else if (migration?.error) {
    results.push(result("evidence.database_migrations", "预发布数据库迁移证据", STATUS.FAIL, "Prisma 迁移状态命令无法启动。", { blockers: ["local Prisma command execution"] }));
  } else if (Number(migration?.status) === 0) {
    results.push(result("evidence.database_migrations", "预发布数据库迁移证据", STATUS.PASS, "只读 prisma migrate status 确认预发布数据库迁移已是最新。", { evidence: { command: "prisma migrate status", exitCode: 0, databaseWriteAttempted: false } }));
  } else {
    results.push(blockedExternal("evidence.database_migrations", "预发布数据库迁移证据", "Prisma 迁移状态未确认预发布数据库已是最新。", ["database reachability, baseline or unapplied migrations"]));
  }

  if (!apiUrl.safe) {
    return results.concat([
      result("evidence.api_health", "预发布 API 与 Prisma 模式证据", STATUS.FAIL, "API Base 违反 URL 安全策略，因此未发出任何 API 请求。"),
      ...notExecutedResults(env).filter((item) => item.id !== "evidence.database_migrations" && item.id !== "evidence.api_health"),
    ]);
  }

  const headers = configured(env.INTERNAL_API_TOKEN) ? { "x-internal-api-token": String(env.INTERNAL_API_TOKEN) } : {};
  const responses = {};
  const errors = {};
  const readOnlyRoutes = readOnlyRoutesFor(env);
  for (const route of readOnlyRoutes) {
    try {
      responses[route] = await fetchJson(joinApiRoute(apiBase, route), { headers, timeoutMs: 20_000, route });
    } catch (error) {
      errors[route] = { status: Number(error?.status || 0) || null, reason: "read_only_probe_failed" };
    }
  }

  const health = responses["/health"];
  if (!health) {
    results.push(blockedExternal("evidence.api_health", "预发布 API 与 Prisma 模式证据", "无法读取现有 /api/health 接口。", ["API reachability or internal access authorization"]));
  } else if (health.ok === true && health.dataMode === "prisma") {
    results.push(result("evidence.api_health", "预发布 API 与 Prisma 模式证据", STATUS.PASS, "API 健康并报告使用 Prisma 持久化。", { evidence: { ok: true, service: health.service === "smart-kefu-desktop-api", dataMode: "prisma" } }));
  } else {
    results.push(result("evidence.api_health", "预发布 API 与 Prisma 模式证据", STATUS.FAIL, "API 健康接口未确认生产 Prisma 数据模式。", { blockers: ["/api/health ok=true and dataMode=prisma"], evidence: { ok: health.ok === true, dataMode: health.dataMode === "prisma" ? "prisma" : "non-prisma" } }));
  }

  const wechat = responses["/wechat-work/status"];
  const audit = responses["/wechat-work/kf/audit?limit=100"];
  const auditRecords = Array.isArray(audit)
    ? audit
    : (Array.isArray(audit?.records) ? audit.records : null);
  if (!wechat || !auditRecords) {
    results.push(blockedExternal("evidence.wechat_work", "企业微信回调与审计证据", "无法读取企业微信状态或脱敏审计证据。", ["/api/wechat-work/status", "/api/wechat-work/kf/audit"]));
  } else {
    const actions = new Set(auditRecords.map((entry) => String(entry?.action || "")));
    const callbackEvidence = actions.has("callback_accepted") || actions.has("callback_verification_accepted");
    const inboundEvidence = actions.has("inbound_processed") || actions.has("event_processed");
    const sendQueueEvidence = actions.has("send_queued") || actions.has("send_dispatch_requested");
    const persistence = wechat.persistence || {};
    const blockers = [];
    if (wechat.ready !== true) blockers.push("WeCom status ready=true");
    if (persistence.mode !== "prisma") blockers.push("WeCom persistence mode=prisma");
    if (Number(persistence.mappedAccounts || 0) < 1) blockers.push("at least one persisted WeCom identity mapping");
    if (!callbackEvidence) blockers.push("historical accepted callback audit");
    if (!inboundEvidence) blockers.push("historical processed inbound audit");
    if (!sendQueueEvidence) blockers.push("historical controlled send-queue audit");
    results.push(result("evidence.wechat_work", "企业微信回调与审计证据", blockers.length ? STATUS.BLOCKED : STATUS.PASS, blockers.length ? "现有企业微信只读接口尚未形成完整预发布证据链。" : "企业微信配置、映射、回调、入站和受控队列证据齐全。", {
      blockers,
      evidence: { ready: wechat.ready === true, persistenceMode: persistence.mode === "prisma" ? "prisma" : "other", mappedAccountCount: Number(persistence.mappedAccounts || 0), auditRecordCount: audit.length, callbackEvidence, inboundEvidence, controlledQueueEvidence: sendQueueEvidence, syncCalled: false, sendCalled: false },
    }));
  }

  const design = responses["/integrations/design-platform/readiness"];
  if (!design) {
    results.push(blockedExternal("evidence.design_platform", "设计平台实时就绪证据", "无法读取现有设计平台 readiness 接口。", ["design platform or API reachability"]));
  } else {
    const failedCheckCount = Array.isArray(design.checks) ? design.checks.filter((check) => check?.ok !== true && check?.severity === "error").length : 0;
    const ready = design.adapter === "art_image_local" && design.canSubmitFormalGeneration === true && failedCheckCount === 0;
    results.push(result("evidence.design_platform", "设计平台实时就绪证据", ready ? STATUS.PASS : STATUS.BLOCKED, ready ? "现有 readiness 接口已确认正式生成前置条件，且未提交任务。" : "设计平台正式生成阻塞项尚未清零。", {
      blockers: ready ? [] : ["adapter=art_image_local and canSubmitFormalGeneration=true"],
      evidence: { adapter: design.adapter === "art_image_local" ? "art_image_local" : "other", canSubmitFormalGeneration: design.canSubmitFormalGeneration === true, failedCheckCount, submittedDesignJob: false },
    }));
  }

  const modelStatus = responses["/ai/providers/status"];
  if (!modelStatus) {
    results.push(blockedExternal(
      "evidence.model_chain",
      "客服大模型运行配置证据",
      "无法读取客服大模型只读状态接口。",
      ["/api/ai/providers/status"],
    ));
  } else {
    const providers = Array.isArray(modelStatus.providers) ? modelStatus.providers : [];
    const enabledProviders = providers.filter((provider) => provider?.enabled === true);
    const configuredProviders = enabledProviders.filter((provider) => provider?.configured === true);
    const primary = providers.find((provider) => provider?.name === modelStatus.primary);
    const fallbackChain = Array.isArray(modelStatus.fallbackChain) ? modelStatus.fallbackChain : [];
    const blockers = [];
    if (modelStatus.enabled !== true) blockers.push("AI engine enabled=true");
    if (!modelStatus.primary) blockers.push("primary provider selected");
    if (primary?.enabled !== true) blockers.push("primary provider enabled=true");
    if (primary?.configured !== true) blockers.push("primary provider configured=true");
    if (configuredProviders.length < 1) blockers.push("at least one configured provider");
    if (modelStatus.probe !== false) blockers.push("status request must remain non-probing");
    results.push(result(
      "evidence.model_chain",
      "客服大模型运行配置证据",
      blockers.length ? STATUS.BLOCKED : STATUS.PASS,
      blockers.length ? "客服大模型运行配置尚未形成可用链路。" : "客服大模型主提供方和至少一个可用提供方已经配置，检查未调用外部模型。",
      {
        blockers,
        evidence: {
          engineEnabled: modelStatus.enabled === true,
          providerCount: providers.length,
          enabledProviderCount: enabledProviders.length,
          configuredProviderCount: configuredProviders.length,
          primarySelected: Boolean(modelStatus.primary),
          primaryEnabled: primary?.enabled === true,
          primaryConfigured: primary?.configured === true,
          fallbackProviderCount: fallbackChain.length,
          externalModelProbeAttempted: false,
        },
      },
    ));
  }

  if (legacyPersonalWechatEnabled(env)) {
    const channels = responses["/wechat/channels/status"];
    const bridge = responses["/wechat/bridge/status"];
    if (!channels || !bridge) {
      results.push(blockedExternal("evidence.personal_wechat", "遗留个人微信桥就绪证据", "无法读取遗留通道或桥状态。", ["/api/wechat/channels/status", "/api/wechat/bridge/status"]));
    } else {
      const personal = Array.isArray(channels.channels) ? channels.channels.find((item) => item?.key === "personal_wechat") : null;
      const staleDispatchCount = Number(bridge.dispatch?.staleCount || 0);
      const staleLockCount = Number(bridge.locks?.staleCount || 0);
      const ignoredOutboxCount = Number(bridge.outbox?.ignoredCount || 0);
      const blockers = [];
      if (Number(personal?.metrics?.accounts || 0) < 1) blockers.push("at least one legacy account binding");
      if (bridge.worker?.ok !== true) blockers.push("legacy bridge worker ok=true");
      if (staleDispatchCount > 0) blockers.push("stale legacy dispatch must be zero");
      if (staleLockCount > 0) blockers.push("stale legacy locks must be zero");
      if (ignoredOutboxCount > 0) blockers.push("ignored/uncertain legacy outbox must be reviewed");
      results.push(result("evidence.personal_wechat", "遗留个人微信桥就绪证据", blockers.length ? STATUS.BLOCKED : STATUS.PASS, blockers.length ? "遗留通道状态中仍有未解决的就绪或恢复证据。" : "遗留通道和桥状态就绪，不存在过期或 ignored 恢复项。", {
        blockers,
        evidence: { boundAccountCount: Number(personal?.metrics?.accounts || 0), channelDefaultAdapterReady: personal?.ready === true, workerReady: bridge.worker?.ok === true, staleDispatchCount, staleLockCount, ignoredOutboxCount, realSendAttempted: false, autoEnterAttempted: false, ackWritten: false },
      }));
    }
  }

  const automationStatus = responses["/automation/status"];
  const automationReadiness = responses["/automation/readiness"];
  if (!automationStatus || !automationReadiness) {
    results.push(blockedExternal(
      "evidence.automation_queue",
      "BullMQ/Redis 持久调度证据",
      "无法读取自动化状态或就绪接口。",
      ["/api/automation/status", "/api/automation/readiness"],
    ));
  } else {
    results.push(evaluateAutomationEvidence(automationStatus, automationReadiness));
  }

  return results;
}

function secretValues(env) {
  return Object.entries(env || {})
    .filter(([name, value]) => /SECRET|TOKEN|PASSWORD|COOKIE|API_KEY|DATABASE_URL|REDIS_URL/i.test(name) && String(value || "").length >= 6)
    .map(([, value]) => String(value));
}

function assertSecretFree(report, env) {
  const serialized = JSON.stringify(report);
  for (const value of secretValues(env)) {
    if (serialized.includes(value)) throw new Error("staging readiness report contains a sensitive configuration value");
  }
}

async function collectStagingReadiness(options = {}) {
  const root = options.repositoryRoot || repositoryRoot;
  const desktop = options.desktopRoot || path.join(root, "desktop");
  const repositoryRevision = resolveRepositoryRevision({
    repositoryRoot: root,
    ...(options.repositoryRevision !== undefined ? { repositoryRevision: options.repositoryRevision } : {}),
    ...(options.runGitCommand ? { runCommand: options.runGitCommand } : {}),
  });
  const env = options.env || readEffectiveEnvironment(
    root,
    options.inheritedEnvironment || process.env,
    options.envFile || "",
  );
  const loadedDoctor = options.doctorReport
    ? { report: options.doctorReport }
    : loadDoctorReport(options.runCommand || defaultRunCommand, root, env);
  const doctorReport = loadedDoctor.report || null;
  const staticEvaluation = staticResults(env, doctorReport, { apiBase: options.apiBase, desktopRoot: desktop });
  if (loadedDoctor.unavailable) {
    staticEvaluation.results[0] = result("config.doctor", "配置 doctor 证据", STATUS.BLOCKED, loadedDoctor.unavailable, {
      blockers: ["configuration doctor evidence unavailable"],
    });
  } else if (loadedDoctor.error) {
    staticEvaluation.results[0] = result("config.doctor", "配置 doctor 证据", STATUS.FAIL, loadedDoctor.error);
  }
  const execute = options.execute === true;
  const evidenceResults = execute
    ? await executeReadOnlyEvidence({ env, apiBase: staticEvaluation.apiBase, apiUrl: staticEvaluation.apiUrl, runCommand: options.runCommand || defaultRunCommand, fetchJson: options.fetchJson || defaultFetchJson, desktop })
    : notExecutedResults(env);
  const results = [...staticEvaluation.results, ...evidenceResults];
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = options.runId || `staging-${generatedAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${process.pid}`;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    repositoryRevision,
    runId,
    generatedAt,
    status: computeOverallStatus(results),
    mode: execute ? "read-only-execute" : "offline-inventory",
    safety: {
      executeExplicitlyEnabled: execute,
      allowedNetworkMethods: execute ? ["GET"] : [],
      allowedRoutes: execute ? readOnlyRoutesFor(env) : [],
      databaseCommand: execute ? "prisma migrate status" : null,
      databaseWriteAttempted: false,
      realMessageSendAttempted: false,
      designJobSubmitted: false,
      paymentMutationAttempted: false,
      externalMutationCount: 0,
      secretsIncluded: false,
    },
    summary: {
      pass: results.filter((item) => item.status === STATUS.PASS).length,
      blocked: results.filter((item) => item.status === STATUS.BLOCKED).length,
      fail: results.filter((item) => item.status === STATUS.FAIL).length,
      total: results.length,
    },
    results,
  };
  assertSecretFree(report, env);
  return report;
}

function markdownEscape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  const lines = [
    "# 预发布就绪与证据报告",
    "",
    `- 状态：**${report.status}**`,
    `- 运行编号：${report.runId}`,
    `- 生成时间：${report.generatedAt}`,
    `- 仓库修订：\`${report.repositoryRevision}\``,
    `- 模式：${report.mode}`,
    `- 安全边界：外部写入 ${report.safety.externalMutationCount} 次；真实发送未执行；报告不含密钥值。`,
    "",
    "## 检查结果",
    "",
    "| 状态 | 检查项 | 结论 |",
    "| --- | --- | --- |",
  ];
  for (const item of report.results) lines.push(`| ${item.status} | ${markdownEscape(item.title)} | ${markdownEscape(item.summary)} |`);
  const findings = report.results.filter((item) => item.blockers.length);
  lines.push("", "## 待处理证据", "");
  if (!findings.length) lines.push("- 无");
  for (const item of findings) {
    lines.push(`### ${item.status} - ${item.title}`, "");
    for (const blocker of item.blockers) lines.push(`- ${blocker}`);
    lines.push("");
  }
  lines.push(
    "## 判定口径",
    "",
    "- `PASS`：本项已取得可重复的配置或只读环境证据。",
    "- `BLOCKED`：缺少凭据、环境连通性、迁移状态或渠道历史证据，禁止发布。",
    "- `FAIL`：存在明确不安全配置、错误运行模式或本地检查故障，禁止发布。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function writeReports(report, root = reportRoot) {
  const runDirectory = path.join(root, "runs", report.runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  fs.writeFileSync(path.join(runDirectory, "report.json"), json, "utf8");
  fs.writeFileSync(path.join(runDirectory, "report.zh-CN.md"), markdown, "utf8");
  fs.writeFileSync(path.join(root, "latest.json"), json, "utf8");
  fs.writeFileSync(path.join(root, "latest.md"), markdown, "utf8");
  return { runDirectory, latestJson: path.join(root, "latest.json"), latestMarkdown: path.join(root, "latest.md") };
}

function parseArgs(argv) {
  const options = {
    execute: false,
    apiBase: "",
    envFile: "",
    doctorReportFile: "",
    repositoryRevision: "",
    repositoryRoot: "",
    desktopRoot: "",
    reportRoot: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--api-base") {
      options.apiBase = String(argv[++index] || "");
      if (!options.apiBase) throw new Error("--api-base requires a URL");
    }
    else if (arg === "--env-file") {
      options.envFile = String(argv[++index] || "");
      if (!options.envFile) throw new Error("--env-file requires a path");
    }
    else if (arg === "--doctor-report") {
      options.doctorReportFile = String(argv[++index] || "");
      if (!options.doctorReportFile) throw new Error("--doctor-report requires a path");
    }
    else if (arg === "--repository-revision") {
      options.repositoryRevision = String(argv[++index] || "");
      if (!options.repositoryRevision) throw new Error("--repository-revision requires a revision");
    }
    else if (arg === "--repository-root") {
      options.repositoryRoot = String(argv[++index] || "");
      if (!options.repositoryRoot) throw new Error("--repository-root requires a path");
    }
    else if (arg === "--desktop-root") {
      options.desktopRoot = String(argv[++index] || "");
      if (!options.desktopRoot) throw new Error("--desktop-root requires a path");
    }
    else if (arg === "--report-root") {
      options.reportRoot = String(argv[++index] || "");
      if (!options.reportRoot) throw new Error("--report-root requires a path");
    }
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/staging-readiness-evidence.js [options]

Options:
  --execute             explicitly run read-only staging checks
  --api-base <url>      existing API base, for example https://staging.example.com/api
  --env-file <path>     load one explicit environment file instead of repository .env files
  --doctor-report <path> use an existing secret-free configuration doctor JSON report
  --repository-revision <sha> bind the report to a 40- or 64-character source revision
  --repository-root <path> locate repository-level evidence in an extracted release
  --desktop-root <path> locate Prisma and desktop runtime files in a release
  --report-root <path>  write reports outside an immutable runtime release
  --help                show this help

Default mode performs local configuration inventory only. --execute adds
prisma migrate status and fixed GET requests; it never sends a message,
submits a design job, changes payment state or deploys a migration.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const doctorReport = options.doctorReportFile
    ? parseJsonOutput(fs.readFileSync(path.resolve(options.doctorReportFile), "utf8"))
    : undefined;
  const report = await collectStagingReadiness({
    ...options,
    ...(doctorReport ? { doctorReport } : {}),
    ...(options.repositoryRevision ? { repositoryRevision: options.repositoryRevision } : {}),
  });
  const artifacts = writeReports(report, options.reportRoot ? path.resolve(options.reportRoot) : reportRoot);
  console.log(`[staging-readiness] status=${report.status} pass=${report.summary.pass} blocked=${report.summary.blocked} fail=${report.summary.fail}`);
  console.log(`[staging-readiness] report=${artifacts.latestMarkdown}`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[staging-readiness] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = EXIT_CODE.FAIL;
  });
}

module.exports = {
  EXIT_CODE,
  LEGACY_PERSONAL_WECHAT_READ_ONLY_ROUTES,
  READ_ONLY_ROUTES,
  SCHEMA_VERSION,
  STATUS,
  collectStagingReadiness,
  computeOverallStatus,
  doctorCommand,
  inspectDatabaseUrl,
  inspectUrl,
  legacyPersonalWechatEnabled,
  parseArgs,
  readEffectiveEnvironment,
  readOnlyRoutesFor,
  renderMarkdown,
  staticResults,
  writeReports,
};
