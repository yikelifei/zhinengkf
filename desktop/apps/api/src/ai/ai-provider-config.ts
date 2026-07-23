import fs from "node:fs";
import path from "node:path";
import {
  AI_PROVIDER_PRESET_MAP,
  AI_PROVIDER_PRESETS,
  AiProviderProtocol,
  defaultEndpoint,
} from "./ai-provider-presets";

const yaml = require("js-yaml") as { load(source: string): unknown };

export type AiProviderConfig = {
  id: string;
  label: string;
  vendor: string;
  description: string;
  enabled: boolean;
  apiKey: string;
  hasApiKey: boolean;
  apiKeyRequired: boolean;
  isLocal: boolean;
  baseUrl: string;
  model: string;
  protocol: AiProviderProtocol;
  temperature: number;
  maxTokens: number;
  apiEndpoint: string;
  configured: boolean;
  issues: string[];
  modelSuggestions: string[];
};

export type AiProviderRuntimeConfig = {
  schemaVersion: number;
  enabled: boolean;
  primary: string;
  fallbackChain: string[];
  timeoutSeconds: number;
  maxRetries: number;
  providers: AiProviderConfig[];
  settingsPath: string;
  runtimeConfigPath: string;
};

export type AiProviderSettingsPatch = {
  enabled?: boolean;
  primary?: string;
  fallbackChain?: string[];
  timeoutSeconds?: number;
  maxRetries?: number;
  providers?: Record<
    string,
    {
      enabled?: boolean;
      apiKey?: string;
      clearApiKey?: boolean;
      baseUrl?: string;
      model?: string;
      protocol?: AiProviderProtocol;
      temperature?: number;
      maxTokens?: number;
    }
  >;
};

type LoadOptions = {
  settingsPath?: string;
  runtimeConfigPath?: string;
  env?: NodeJS.ProcessEnv;
};

type StoredProvider = {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  protocol?: AiProviderProtocol;
  temperature?: number;
  maxTokens?: number;
};

type StoredSettings = {
  schemaVersion?: number;
  enabled?: boolean;
  primary?: string;
  fallbackChain?: string[];
  timeoutSeconds?: number;
  maxRetries?: number;
  providers?: Record<string, StoredProvider>;
};

export function loadAiProviderRuntime(options: LoadOptions = {}): AiProviderRuntimeConfig {
  const settingsPath = resolveAiSettingsPath(options.settingsPath);
  const runtimeConfigPath = resolveAiRuntimeConfigPath(options.runtimeConfigPath);
  const envPath = path.resolve(path.dirname(settingsPath), "..", ".env");
  const env = { ...readEnvFile(envPath), ...(options.env || process.env) };
  const settings = readYamlObject(settingsPath);
  const engine = isPlainObject(settings.ai_engine) ? settings.ai_engine : {};
  const legacyProviders = isPlainObject(engine.providers) ? engine.providers : {};
  const stored = readJsonObject(runtimeConfigPath) as StoredSettings;
  const storedProviders = isPlainObject(stored.providers) ? stored.providers : {};

  const providers = AI_PROVIDER_PRESETS.map((preset) => {
    const legacy = selectLegacyProvider(preset.id, legacyProviders, engine);
    const saved = isPlainObject(storedProviders[preset.id]) ? storedProviders[preset.id] : {};
    const protocol = normalizeProtocol(saved.protocol || legacy.request_format, preset.protocol);
    const apiKey = saved.apiKey !== undefined ? text(saved.apiKey) : expandEnv(text(legacy.api_key), env);
    const baseUrl = trimTrailingSlash(
      saved.baseUrl !== undefined ? text(saved.baseUrl) : expandEnv(text(legacy.base_url), env) || preset.defaultBaseUrl,
    );
    const model = saved.model !== undefined ? text(saved.model) : expandEnv(text(legacy.model), env) || preset.defaultModel;
    const enabled = booleanValue(saved.enabled, booleanValue(legacy.enabled, preset.id === "geeknow" && mapLegacyPrimary(engine.primary) === "geeknow"));
    const issues = providerIssues({
      enabled,
      apiKey,
      apiKeyRequired: preset.apiKeyRequired,
      baseUrl,
      model,
    });
    return {
      id: preset.id,
      label: preset.label,
      vendor: preset.vendor,
      description: preset.description,
      enabled,
      apiKey,
      hasApiKey: !looksUnset(apiKey),
      apiKeyRequired: preset.apiKeyRequired,
      isLocal: preset.isLocal,
      baseUrl,
      model,
      protocol,
      temperature: boundedNumber(saved.temperature ?? legacy.temperature, 0.4, 0, 2),
      maxTokens: boundedInteger(saved.maxTokens ?? legacy.max_tokens, 500, 32, 32000),
      apiEndpoint: defaultEndpoint(protocol),
      configured: enabled && issues.length === 0,
      issues,
      modelSuggestions: preset.modelSuggestions,
    } satisfies AiProviderConfig;
  });

  const configuredPrimary = text(stored.primary) || mapLegacyPrimary(engine.primary) || "geeknow";
  const primary = AI_PROVIDER_PRESET_MAP.has(configuredPrimary) ? configuredPrimary : "geeknow";
  const legacyFallback = stringList(engine.fallback_chain).map(mapLegacyPrimary);
  const fallbackChain = uniqueStrings(stored.fallbackChain || legacyFallback).filter(
    (id) => id !== primary && AI_PROVIDER_PRESET_MAP.has(id),
  );

  return {
    schemaVersion: 1,
    enabled: booleanValue(stored.enabled, booleanValue(engine.enabled, true)),
    primary,
    fallbackChain,
    timeoutSeconds: boundedInteger(stored.timeoutSeconds ?? engine.timeout_seconds, 15, 2, 120),
    maxRetries: boundedInteger(stored.maxRetries ?? engine.max_retries, 1, 0, 5),
    providers,
    settingsPath,
    runtimeConfigPath,
  };
}

export function saveAiProviderRuntimePatch(patch: AiProviderSettingsPatch, options: LoadOptions = {}) {
  const current = loadAiProviderRuntime(options);
  const primary = text(patch.primary) || current.primary;
  if (!AI_PROVIDER_PRESET_MAP.has(primary)) throw new Error(`不支持的大模型供应商：${primary}`);

  const requestedFallback = patch.fallbackChain === undefined ? current.fallbackChain : patch.fallbackChain;
  const fallbackChain = uniqueStrings(requestedFallback || []).filter((id) => id !== primary);
  const unsupportedFallback = fallbackChain.find((id) => !AI_PROVIDER_PRESET_MAP.has(id));
  if (unsupportedFallback) throw new Error(`不支持的备用模型供应商：${unsupportedFallback}`);

  const providerPatches = isPlainObject(patch.providers) ? patch.providers : {};
  const unsupportedProvider = Object.keys(providerPatches).find((id) => !AI_PROVIDER_PRESET_MAP.has(id));
  if (unsupportedProvider) throw new Error(`不支持的大模型供应商：${unsupportedProvider}`);

  const providers: Record<string, StoredProvider> = {};
  for (const provider of current.providers) {
    const update = isPlainObject(providerPatches[provider.id]) ? providerPatches[provider.id] : {};
    const protocol = normalizeProtocol(update.protocol, provider.protocol);
    const nextApiKey = update.clearApiKey
      ? ""
      : update.apiKey !== undefined && text(update.apiKey)
        ? text(update.apiKey)
        : provider.apiKey;
    providers[provider.id] = {
      enabled: booleanValue(update.enabled, provider.enabled),
      apiKey: nextApiKey,
      baseUrl: trimTrailingSlash(update.baseUrl !== undefined ? text(update.baseUrl) : provider.baseUrl),
      model: update.model !== undefined ? text(update.model) : provider.model,
      protocol,
      temperature: boundedNumber(update.temperature, provider.temperature, 0, 2),
      maxTokens: boundedInteger(update.maxTokens, provider.maxTokens, 32, 32000),
    };
  }

  const stored: StoredSettings = {
    schemaVersion: 1,
    enabled: booleanValue(patch.enabled, current.enabled),
    primary,
    fallbackChain,
    timeoutSeconds: boundedInteger(patch.timeoutSeconds, current.timeoutSeconds, 2, 120),
    maxRetries: boundedInteger(patch.maxRetries, current.maxRetries, 0, 5),
    providers,
  };
  fs.mkdirSync(path.dirname(current.runtimeConfigPath), { recursive: true });
  fs.writeFileSync(current.runtimeConfigPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return loadAiProviderRuntime({ ...options, runtimeConfigPath: current.runtimeConfigPath });
}

export function toAiProviderSettingsResponse(runtime: AiProviderRuntimeConfig) {
  return {
    schemaVersion: runtime.schemaVersion,
    enabled: runtime.enabled,
    primary: runtime.primary,
    fallbackChain: runtime.fallbackChain,
    timeoutSeconds: runtime.timeoutSeconds,
    maxRetries: runtime.maxRetries,
    providers: runtime.providers.map(({ apiKey: _secret, ...provider }) => provider),
    storage: {
      scope: "local_desktop_runtime",
      keyStorage: "server_only",
    },
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

export function resolveAiRuntimeConfigPath(explicitPath?: string) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.AI_MODEL_SETTINGS_PATH) return path.resolve(process.env.AI_MODEL_SETTINGS_PATH);
  const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
    ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
    : path.resolve(process.cwd(), ".runtime");
  return path.join(runtimeDir, "ai-model-settings.json");
}

function selectLegacyProvider(id: string, providers: Record<string, any>, engine: Record<string, any>) {
  if (id === "geeknow" && mapLegacyPrimary(engine.primary) === "geeknow" && isPlainObject(providers.custom_api_1)) {
    return providers.custom_api_1;
  }
  if (id === "custom" && isPlainObject(providers.custom_api_2)) return providers.custom_api_2;
  return isPlainObject(providers[id]) ? providers[id] : {};
}

function mapLegacyPrimary(value: unknown) {
  const id = text(value);
  if (id === "custom_api_1") return "geeknow";
  if (id === "custom_api_2") return "custom";
  return id;
}

function providerIssues(input: {
  enabled: boolean;
  apiKey: string;
  apiKeyRequired: boolean;
  baseUrl: string;
  model: string;
}) {
  const issues: string[] = [];
  if (!input.enabled) issues.push("provider_disabled");
  if (input.apiKeyRequired && looksUnset(input.apiKey)) issues.push("api_key_unset");
  if (looksUnset(input.baseUrl)) issues.push("base_url_unset");
  else if (!isAllowedBaseUrl(input.baseUrl)) issues.push("base_url_invalid");
  if (looksUnset(input.model)) issues.push("model_unset");
  return issues;
}

function isAllowedBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function readYamlObject(filePath: string): Record<string, any> {
  try {
    const parsed = yaml.load(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readJsonObject(filePath: string): Record<string, any> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
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
  return (
    !normalized ||
    normalized.includes("${") ||
    normalized.startsWith("sk-your-") ||
    normalized.startsWith("your-") ||
    normalized.includes("example.com") ||
    ["changeme", "change-me", "replace-me"].includes(normalized)
  );
}

function normalizeProtocol(value: unknown, fallback: AiProviderProtocol): AiProviderProtocol {
  const normalized = text(value);
  if (normalized === "openai_responses" || normalized === "anthropic_messages" || normalized === "openai_chat") {
    return normalized;
  }
  if (normalized === "anthropic") return "anthropic_messages";
  if (normalized === "responses") return "openai_responses";
  if (normalized === "openai") return "openai_chat";
  return fallback;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map(text));
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
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
