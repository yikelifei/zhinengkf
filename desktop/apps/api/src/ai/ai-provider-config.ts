import fs from "node:fs";
import path from "node:path";

const yaml = require("js-yaml") as { load(source: string): unknown };

export type AiProviderConfig = {
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  requestFormat: string;
  temperature: number;
  maxTokens: number;
  apiEndpoint: string;
  configured: boolean;
  issues: string[];
};

export type AiProviderRuntimeConfig = {
  enabled: boolean;
  primary: string;
  fallbackChain: string[];
  timeoutSeconds: number;
  maxRetries: number;
  promptKey: string;
  providers: AiProviderConfig[];
  settingsPath: string;
  envPath: string;
};

export function loadAiProviderRuntime(options: { settingsPath?: string; env?: NodeJS.ProcessEnv } = {}): AiProviderRuntimeConfig {
  const settingsPath = resolveAiSettingsPath(options.settingsPath);
  const envPath = path.resolve(path.dirname(settingsPath), "..", ".env");
  const env = { ...readEnvFile(envPath), ...(options.env || process.env) };
  const settings = readYamlObject(settingsPath);
  const engine = isPlainObject(settings.ai_engine) ? settings.ai_engine : {};
  const rawProviders = isPlainObject(engine.providers) ? engine.providers : {};
  const providers = Object.entries(rawProviders).map(([name, value]) => normalizeProvider(name, value, env));

  return {
    enabled: booleanValue(engine.enabled, true),
    primary: text(engine.primary),
    fallbackChain: stringList(engine.fallback_chain),
    timeoutSeconds: boundedNumber(engine.timeout_seconds, 15, 1, 120),
    maxRetries: boundedInteger(engine.max_retries, 2, 0, 5),
    promptKey: text(engine.prompt_key),
    providers,
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

function normalizeProvider(name: string, value: unknown, env: NodeJS.ProcessEnv): AiProviderConfig {
  const raw = isPlainObject(value) ? value : {};
  const apiKey = expandEnv(text(raw.api_key), env);
  const baseUrl = trimTrailingSlash(expandEnv(text(raw.base_url), env));
  const model = expandEnv(text(raw.model), env);
  const requestFormat = text(raw.request_format) || "openai";
  const enabled = booleanValue(raw.enabled, false);
  const issues: string[] = [];
  if (!enabled) issues.push("provider_disabled");
  if (looksUnset(apiKey)) issues.push("api_key_unset");
  if (looksUnset(baseUrl)) issues.push("base_url_unset");
  else if (!/^https?:\/\//i.test(baseUrl)) issues.push("base_url_invalid");
  if (looksUnset(model)) issues.push("model_unset");
  if (requestFormat !== "openai") issues.push("request_format_not_openai");
  return {
    name,
    enabled,
    apiKey,
    baseUrl,
    model,
    requestFormat,
    temperature: boundedNumber(raw.temperature, 0.7, 0, 2),
    maxTokens: boundedInteger(raw.max_tokens, 300, 1, 4000),
    apiEndpoint: text(raw.api_endpoint) || "/chat/completions",
    configured: enabled && issues.length === 0,
    issues,
  };
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
