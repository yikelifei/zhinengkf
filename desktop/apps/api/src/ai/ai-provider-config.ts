import fs from "node:fs";
import path from "node:path";
import { AI_PROVIDER_PRESETS, getAiProviderPreset, presetAsRawConfig, providerBaseUrlEnv } from "./ai-provider-presets";

const yaml = require("js-yaml") as { load(source: string): unknown };

export type AiProviderConfig = {
  name: string;
  label: string;
  description: string;
  region: "china" | "global" | "aggregator" | "custom";
  enabled: boolean;
  credentialSource: "environment" | "zhenxi_ai_shared" | "invalid";
  sharedSourceConfigured: boolean;
  sharedEnvPath: string;
  sharedModelEnv: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  visionEnabled: boolean;
  visionModel: string;
  audioInputEnabled: boolean;
  audioInputModel: string;
  transcriptionModel: string;
  transcriptionEndpoint: string;
  requestFormat: string;
  temperature: number;
  maxTokens: number;
  apiEndpoint: string;
  routingTier: AiRoutingTier;
  apiKeyEnv: string;
  enabledEnv: string;
  modelEnv: string;
  baseUrlEnv: string;
  docsUrl: string;
  keyOnlySetup: boolean;
  configured: boolean;
  issues: string[];
};

export type AiRoutingTier = "economy" | "quality";

export type AiTierRoutingConfig = {
  enabled: boolean;
  complexityThreshold: number;
  economyChain: string[];
  qualityChain: string[];
};

export type AiProviderRuntimeConfig = {
  enabled: boolean;
  primary: string;
  fallbackChain: string[];
  timeoutSeconds: number;
  maxRetries: number;
  promptKey: string;
  routing: AiTierRoutingConfig;
  multimodal: {
    enabled: boolean;
    visionChain: string[];
    transcriptionChain: string[];
    visionTimeoutSeconds: number;
    transcriptionTimeoutSeconds: number;
    videoFrameCount: number;
  };
  providers: AiProviderConfig[];
  billingCredentials: {
    alibabaCloudAccessKeyId: string;
    alibabaCloudAccessKeySecret: string;
    openAiAdminKey: string;
  };
  settingsPath: string;
  envPath: string;
};

export function loadAiProviderRuntime(options: { settingsPath?: string; env?: NodeJS.ProcessEnv } = {}): AiProviderRuntimeConfig {
  const settingsPath = resolveAiSettingsPath(options.settingsPath);
  const envPath = path.resolve(path.dirname(settingsPath), "..", ".env");
  const env = { ...readEnvFile(envPath), ...(options.env || process.env) };
  const settings = readYamlObject(settingsPath);
  const engine = isPlainObject(settings.ai_engine) ? settings.ai_engine : {};
  const rawRouting = isPlainObject(engine.routing) ? engine.routing : {};
  const rawMultimodal = isPlainObject(engine.multimodal) ? engine.multimodal : {};
  const rawProviders = isPlainObject(engine.providers) ? engine.providers : {};
  const includeProviderPresets = booleanValue(engine.include_provider_presets, false);
  const declaredNames = new Set(Object.keys(rawProviders));
  const providers = [
    ...Object.entries(rawProviders).map(([name, value]) => {
      const preset = getAiProviderPreset(name);
      return normalizeProvider(
        name,
        preset ? { ...presetAsRawConfig(preset), ...(isPlainObject(value) ? value : {}) } : value,
        env,
        settingsPath,
      );
    }),
    ...(includeProviderPresets ? AI_PROVIDER_PRESETS : [])
      .filter((preset) => !declaredNames.has(preset.name))
      .map((preset) => normalizeProvider(preset.name, presetAsRawConfig(preset), env, settingsPath)),
  ];

  return {
    enabled: booleanValue(engine.enabled, true),
    primary: text(engine.primary),
    fallbackChain: stringList(engine.fallback_chain),
    timeoutSeconds: boundedNumber(engine.timeout_seconds, 15, 1, 120),
    maxRetries: boundedInteger(engine.max_retries, 2, 0, 5),
    promptKey: text(engine.prompt_key),
    routing: {
      enabled: booleanValue(rawRouting.enabled, false),
      complexityThreshold: boundedInteger(rawRouting.complexity_threshold, 4, 1, 20),
      economyChain: stringList(rawRouting.economy_chain),
      qualityChain: stringList(rawRouting.quality_chain),
    },
    multimodal: {
      enabled: booleanValue(rawMultimodal.enabled, true),
      visionChain: stringList(rawMultimodal.vision_chain),
      transcriptionChain: stringList(rawMultimodal.transcription_chain),
      visionTimeoutSeconds: boundedNumber(rawMultimodal.vision_timeout_seconds, 12, 1, 120),
      transcriptionTimeoutSeconds: boundedNumber(rawMultimodal.transcription_timeout_seconds, 20, 1, 120),
      videoFrameCount: boundedInteger(rawMultimodal.video_frame_count, 3, 1, 5),
    },
    providers,
    billingCredentials: {
      alibabaCloudAccessKeyId: cleanSecret(env.ALIBABA_CLOUD_ACCESS_KEY_ID),
      alibabaCloudAccessKeySecret: cleanSecret(env.ALIBABA_CLOUD_ACCESS_KEY_SECRET),
      openAiAdminKey: cleanSecret(env.OPENAI_ADMIN_KEY),
    },
    settingsPath,
    envPath,
  };
}

export function resolveAiSettingsPath(explicitPath?: string) {
  const configured = explicitPath || process.env.AI_ENGINE_SETTINGS_PATH;
  const candidates = [
    configured ? path.resolve(configured) : "",
    path.resolve(process.cwd(), "config", "settings.yaml"),
    path.resolve(process.cwd(), "..", "config", "settings.yaml"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || path.resolve("config/settings.yaml");
}

function normalizeProvider(
  name: string,
  value: unknown,
  env: NodeJS.ProcessEnv,
  settingsPath: string,
): AiProviderConfig {
  const raw = isPlainObject(value) ? value : {};
  const preset = getAiProviderPreset(name);
  const credentialSourceValue = text(raw.credential_source) || "environment";
  const credentialSource = credentialSourceValue === "zhenxi_ai_shared"
    ? "zhenxi_ai_shared"
    : credentialSourceValue === "environment"
      ? "environment"
      : "invalid";
  const configuredSharedPath = expandEnv(text(raw.shared_env_path), env);
  const sharedEnvPath = credentialSource === "zhenxi_ai_shared" && configuredSharedPath
    ? path.resolve(path.dirname(settingsPath), configuredSharedPath)
    : "";
  const sharedModelEnv = credentialSource === "zhenxi_ai_shared"
    ? exactEnvReference(text(raw.model))
    : "";
  const sharedSourceConfigured = Boolean(sharedEnvPath && isReadableRegularFile(sharedEnvPath));
  const providerEnv = sharedSourceConfigured ? { ...env, ...readEnvFile(sharedEnvPath) } : env;
  const apiKey = expandEnv(text(raw.api_key), providerEnv);
  const baseUrl = trimTrailingSlash(expandEnv(text(raw.base_url), providerEnv));
  const model = expandEnv(text(raw.model), providerEnv);
  const visionEnabled = preset?.visionEnabled === false
    ? false
    : booleanValue(raw.vision_enabled, false);
  const visionModel = expandEnv(text(raw.vision_model), providerEnv) || model;
  const audioInputEnabled = booleanValue(raw.audio_input_enabled, false);
  const audioInputModel = expandEnv(text(raw.audio_input_model), providerEnv) || visionModel || model;
  const transcriptionModel = expandEnv(text(raw.transcription_model), providerEnv);
  const transcriptionEndpoint = text(raw.transcription_endpoint) || "/audio/transcriptions";
  const requestFormat = text(raw.request_format) || "openai";
  const enabledOverride = preset ? env[preset.enabledEnv] : undefined;
  const enabled = enabledOverride === undefined
    ? booleanValue(raw.enabled, false)
    : booleanValue(enabledOverride, false);
  const routingTier = text(raw.routing_tier) === "quality" ? "quality" : "economy";
  const issues: string[] = [];
  if (!enabled) issues.push("provider_disabled");
  if (credentialSource === "invalid") issues.push("credential_source_invalid");
  if (credentialSource === "zhenxi_ai_shared" && !sharedSourceConfigured) issues.push("shared_env_missing");
  if (looksUnset(apiKey)) issues.push("api_key_unset");
  if (looksUnset(baseUrl)) issues.push("base_url_unset");
  else if (!/^https?:\/\//i.test(baseUrl)) issues.push("base_url_invalid");
  if (looksUnset(model)) issues.push("model_unset");
  if (!SUPPORTED_REQUEST_FORMATS.has(requestFormat)) issues.push("request_format_unsupported");
  return {
    name,
    label: preset?.label || name,
    description: preset?.description || "自定义 OpenAI 兼容供应商。",
    region: preset?.region || "custom",
    enabled,
    credentialSource,
    sharedSourceConfigured,
    sharedEnvPath,
    sharedModelEnv,
    apiKey,
    baseUrl,
    model,
    visionEnabled,
    visionModel,
    audioInputEnabled,
    audioInputModel,
    transcriptionModel,
    transcriptionEndpoint,
    requestFormat,
    temperature: boundedNumber(raw.temperature, 0.7, 0, 2),
    maxTokens: boundedInteger(raw.max_tokens, 300, 1, 4000),
    apiEndpoint: text(raw.api_endpoint) || "/chat/completions",
    routingTier,
    apiKeyEnv: preset?.apiKeyEnv || "",
    enabledEnv: preset?.enabledEnv || "",
    modelEnv: preset?.modelEnv || "",
    baseUrlEnv: preset ? providerBaseUrlEnv(preset) : "",
    docsUrl: preset?.docsUrl || "",
    keyOnlySetup: Boolean(preset),
    configured: enabled && issues.length === 0,
    issues,
  };
}

const SUPPORTED_REQUEST_FORMATS = new Set(["openai", "anthropic"]);

function exactEnvReference(value: string) {
  return value.trim().match(/^\$\{([A-Z][A-Z0-9_]*)\}$/)?.[1] || "";
}

function isReadableRegularFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readYamlObject(filePath: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readEnvFile(filePath: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  try {
    for (const rawLine of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) result[key] = value;
    }
  } catch {
    return result;
  }
  return result;
}

function expandEnv(value: string, env: NodeJS.ProcessEnv) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (placeholder, name, fallback) => {
    const resolved = env[name];
    if (resolved !== undefined && resolved !== "") return resolved;
    return fallback !== undefined ? fallback : placeholder;
  });
}

function looksUnset(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized.includes("${") || normalized.startsWith("sk-your-") || normalized.startsWith("your-") ||
    normalized.includes("example.com") || ["changeme", "change-me", "replace-me"].includes(normalized);
}

function cleanSecret(value: unknown) {
  const resolved = text(value);
  return looksUnset(resolved) ? "" : resolved;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))];
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.floor(boundedNumber(value, fallback, min, max));
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
