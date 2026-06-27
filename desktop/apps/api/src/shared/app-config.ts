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

function readRuntimeConfig(): Record<string, unknown> {
  const configPath = path.resolve(process.env.DESIGN_PLATFORM_RUNTIME_CONFIG || "./.runtime/design-platform-config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function stringConfig(envName: string, runtimeKey: string, fallback: string): string {
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== "") return envValue;
  const runtimeValue = runtimeConfig[runtimeKey];
  if (typeof runtimeValue === "string" && runtimeValue.trim()) return runtimeValue;
  return fallback;
}

const runtimeConfig = readRuntimeConfig();
const designPlatformAdapter = stringConfig("DESIGN_PLATFORM_ADAPTER", "designPlatformAdapter", "standard_v1");
const designPlatformBaseUrl = stringConfig(
  "DESIGN_PLATFORM_BASE_URL",
  "designPlatformBaseUrl",
  designPlatformAdapter === "art_image_local" ? "http://127.0.0.1:3000" : "http://127.0.0.1:3700",
);

export const appConfig = {
  apiPort: numberEnv("API_PORT", 3200),
  useLocalStore: process.env.USE_LOCAL_STORE !== "false",
  localStorageRoot: path.resolve(process.env.LOCAL_STORAGE_ROOT || "./storage"),
  designPlatformAdapter,
  designPlatformBaseUrl,
  designPlatformApiKey: process.env.DESIGN_PLATFORM_API_KEY || "",
  designPlatformAccessToken: stringConfig("DESIGN_PLATFORM_ACCESS_TOKEN", "designPlatformAccessToken", ""),
  designPlatformCookie: process.env.DESIGN_PLATFORM_COOKIE || "",
  designPlatformDeviceId: stringConfig("DESIGN_PLATFORM_DEVICE_ID", "designPlatformDeviceId", ""),
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
