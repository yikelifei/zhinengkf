"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { loadAiProviderRuntime } = require("../apps/api/src/ai/ai-provider-config");
const { AiProviderService } = require("../apps/api/src/ai/ai-provider.service");

test("desktop AI config reuses root settings and env provider semantics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-config-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, ".env"), "PRIMARY_KEY=from-root-env\nFALLBACK_KEY=fallback-secret\n", "utf8");
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  primary: primary",
    "  fallback_chain:",
    "    - backup",
    "  timeout_seconds: 9",
    "  max_retries: 1",
    "  routing:",
    "    enabled: true",
    "    complexity_threshold: 5",
    "    economy_chain:",
    "      - cheap",
    "    quality_chain:",
    "      - primary",
    "      - backup",
    "  providers:",
    "    primary:",
    "      enabled: true",
    "      api_key: ${PRIMARY_KEY}",
    "      base_url: https://primary.invalid/v1",
    "      model: primary-model",
    "      request_format: openai",
    "    backup:",
    "      enabled: true",
    "      api_key: ${FALLBACK_KEY}",
    "      base_url: https://backup.invalid/v1/",
    "      model: backup-model",
  ].join("\n"), "utf8");

  const runtime = loadAiProviderRuntime({ settingsPath, env: {} });
  assert.equal(runtime.primary, "primary");
  assert.deepEqual(runtime.fallbackChain, ["backup"]);
  assert.equal(runtime.timeoutSeconds, 9);
  assert.equal(runtime.maxRetries, 1);
  assert.equal(runtime.routing.enabled, true);
  assert.equal(runtime.routing.complexityThreshold, 5);
  assert.deepEqual(runtime.routing.economyChain, ["cheap"]);
  assert.deepEqual(runtime.routing.qualityChain, ["primary", "backup"]);
  assert.equal(runtime.providers[0].apiKey, "from-root-env");
  assert.equal(runtime.providers[1].baseUrl, "https://backup.invalid/v1");
  assert.equal(runtime.providers.every((provider) => provider.configured), true);
});

test("tier routing stays disabled for legacy configuration files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-legacy-routing-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, "ai_engine:\n  primary: demo\n  fallback_chain: [backup]\n", "utf8");

  const runtime = loadAiProviderRuntime({ settingsPath, env: {} });
  assert.equal(runtime.routing.enabled, false);
  assert.equal(runtime.routing.complexityThreshold, 4);
  assert.deepEqual(runtime.routing.economyChain, []);
  assert.deepEqual(runtime.routing.qualityChain, []);
});

test("process environment overrides root env without writing another secret store", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-env-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, ".env"), "PROVIDER_KEY=file-secret\n", "utf8");
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, "ai_engine:\n  providers:\n    demo:\n      enabled: true\n      api_key: ${PROVIDER_KEY}\n      base_url: https://demo.invalid/v1\n      model: demo\n", "utf8");
  const runtime = loadAiProviderRuntime({ settingsPath, env: { PROVIDER_KEY: "runtime-secret" } });
  assert.equal(runtime.providers[0].apiKey, "runtime-secret");
});

test("billing credentials load separately from model API keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-billing-env-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, ".env"), [
    "ALIBABA_CLOUD_ACCESS_KEY_ID=ram-id",
    "ALIBABA_CLOUD_ACCESS_KEY_SECRET=ram-secret",
    "OPENAI_ADMIN_KEY=admin-secret",
  ].join("\n"), "utf8");
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, "ai_engine:\n  providers: {}\n", "utf8");

  const runtime = loadAiProviderRuntime({ settingsPath, env: {} });

  assert.equal(runtime.billingCredentials.alibabaCloudAccessKeyId, "ram-id");
  assert.equal(runtime.billingCredentials.alibabaCloudAccessKeySecret, "ram-secret");
  assert.equal(runtime.billingCredentials.openAiAdminKey, "admin-secret");
  assert.equal(JSON.stringify(runtime.providers).includes("ram-secret"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("billing credential save persists private env values without returning the secrets", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-billing-save-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  include_provider_presets: true",
    "  providers: {}",
  ].join("\n"), "utf8");
  const previous = {
    settingsPath: process.env.AI_ENGINE_SETTINGS_PATH,
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
  };
  t.after(() => {
    if (previous.settingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previous.settingsPath;
    if (previous.accessKeyId === undefined) delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    else process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = previous.accessKeyId;
    if (previous.accessKeySecret === undefined) delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    else process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = previous.accessKeySecret;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;

  const result = await new AiProviderService().saveProviderBillingCredential({
    provider: "dashscope",
    accessKeyId: "saved-ram-id",
    accessKeySecret: "saved-ram-secret",
  });
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");

  assert.match(envText, /^ALIBABA_CLOUD_ACCESS_KEY_ID=saved-ram-id$/m);
  assert.match(envText, /^ALIBABA_CLOUD_ACCESS_KEY_SECRET=saved-ram-secret$/m);
  assert.equal(result.provider.billingCredentialConfigured, true);
  assert.equal(JSON.stringify(result).includes("saved-ram-id"), false);
  assert.equal(JSON.stringify(result).includes("saved-ram-secret"), false);
});

test("customer service can reuse the same Zhenxi AI model and key source without copying the secret", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-zhenxi-shared-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.mkdirSync(path.join(root, "zhenxi"));
  fs.writeFileSync(
    path.join(root, "zhenxi", ".env.local"),
    "AI_API_KEY=zhenxi-shared-secret\nAI_BASE_URL=https://zhenxi-provider.invalid/v1\nAI_TEXT_MODEL=zhenxi-text-model\n",
    "utf8",
  );
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  primary: zhenxi_ai",
    "  providers:",
    "    zhenxi_ai:",
    "      enabled: true",
    "      credential_source: zhenxi_ai_shared",
    "      shared_env_path: ../zhenxi/.env.local",
    "      api_key: ${AI_API_KEY}",
    "      base_url: ${AI_BASE_URL}",
    "      model: ${AI_TEXT_MODEL}",
  ].join("\n"), "utf8");

  const runtime = loadAiProviderRuntime({ settingsPath, env: {} });
  const provider = runtime.providers[0];
  assert.equal(runtime.primary, "zhenxi_ai");
  assert.equal(provider.credentialSource, "zhenxi_ai_shared");
  assert.equal(provider.sharedSourceConfigured, true);
  assert.equal(provider.apiKey, "zhenxi-shared-secret");
  assert.equal(provider.baseUrl, "https://zhenxi-provider.invalid/v1");
  assert.equal(provider.model, "zhenxi-text-model");
  assert.equal(provider.configured, true);
});

test("key-only catalog injects the supported provider presets without enabling missing keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-presets-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  include_provider_presets: true",
    "  providers: {}",
  ].join("\n"), "utf8");

  const runtime = loadAiProviderRuntime({
    settingsPath,
    env: {
      ANTHROPIC_API_KEY: "anthropic-test-key",
      AI_PROVIDER_ANTHROPIC_ENABLED: "true",
    },
  });
  const anthropic = runtime.providers.find((provider) => provider.name === "anthropic");
  const dashscope = runtime.providers.find((provider) => provider.name === "dashscope");
  const deepseek = runtime.providers.find((provider) => provider.name === "deepseek");
  const gemini = runtime.providers.find((provider) => provider.name === "gemini");

  assert.equal(runtime.providers.length, 20);
  const geeknow = runtime.providers.find((provider) => provider.name === "geeknow");
  assert.equal(dashscope.model, "qwen3.7-flash");
  assert.equal(dashscope.visionEnabled, true);
  assert.equal(dashscope.visionModel, "qwen3.7-flash");
  assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(deepseek.model, "deepseek-v4-flash");
  assert.equal(deepseek.visionEnabled, false);
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.requestFormat, "anthropic");
  assert.equal(anthropic.apiEndpoint, "/messages");
  assert.equal(anthropic.keyOnlySetup, true);
  assert.equal(anthropic.routingTier, "quality");
  assert.equal(gemini.enabled, false);
  assert.equal(gemini.configured, false);
  assert.equal(geeknow.label, "GeekNow 中转站");
  assert.equal(geeknow.region, "aggregator");
  assert.ok(gemini.issues.includes("provider_disabled"));
  assert.ok(gemini.issues.includes("api_key_unset"));
});

test("server env export is generated from saved provider env values with placeholders for missing keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-server-env-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  include_provider_presets: true",
    "  providers: {}",
  ].join("\n"), "utf8");

  const previous = {
    AI_ENGINE_SETTINGS_PATH: process.env.AI_ENGINE_SETTINGS_PATH,
    DESKTOP_RUNTIME_DIR: process.env.DESKTOP_RUNTIME_DIR,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL: process.env.DASHSCOPE_BASE_URL,
    AI_PROVIDER_DASHSCOPE_ENABLED: process.env.AI_PROVIDER_DASHSCOPE_ENABLED,
    DASHSCOPE_MODEL: process.env.DASHSCOPE_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  try {
    process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
    process.env.DESKTOP_RUNTIME_DIR = path.join(root, ".runtime");
    process.env.DASHSCOPE_API_KEY = "dashscope-secret";
    process.env.DASHSCOPE_BASE_URL = "https://dashscope-proxy.example/v1";
    process.env.AI_PROVIDER_DASHSCOPE_ENABLED = "true";
    process.env.DASHSCOPE_MODEL = "qwen3.7-flash";
    delete process.env.OPENAI_API_KEY;

    const bundle = new AiProviderService().generateServerEnvFile();
    assert.equal(bundle.generated, true);
    assert.ok(fs.existsSync(bundle.filePath));
    assert.match(bundle.envText, /DASHSCOPE_API_KEY=dashscope-secret/);
    assert.match(bundle.envText, /DASHSCOPE_BASE_URL=https:\/\/dashscope-proxy\.example\/v1/);
    assert.match(bundle.envText, /AI_PROVIDER_DASHSCOPE_ENABLED=true/);
    assert.match(bundle.envText, /DASHSCOPE_MODEL=qwen3\.7-flash/);
    assert.match(bundle.envText, /OPENAI_API_KEY=\n/);
    assert.ok(bundle.configuredProviderCount >= 1);
    assert.ok(bundle.missingProviders.some((provider) => provider.apiKeyEnv === "OPENAI_API_KEY"));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
