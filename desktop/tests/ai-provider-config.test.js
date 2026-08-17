"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { loadAiProviderRuntime } = require("../apps/api/src/ai/ai-provider-config");

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
  const gemini = runtime.providers.find((provider) => provider.name === "gemini");

  assert.equal(runtime.providers.length, 18);
  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.requestFormat, "anthropic");
  assert.equal(anthropic.apiEndpoint, "/messages");
  assert.equal(anthropic.keyOnlySetup, true);
  assert.equal(anthropic.routingTier, "quality");
  assert.equal(gemini.enabled, false);
  assert.equal(gemini.configured, false);
  assert.ok(gemini.issues.includes("provider_disabled"));
  assert.ok(gemini.issues.includes("api_key_unset"));
});
