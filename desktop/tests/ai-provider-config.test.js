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
  assert.equal(runtime.providers[0].apiKey, "from-root-env");
  assert.equal(runtime.providers[1].baseUrl, "https://backup.invalid/v1");
  assert.equal(runtime.providers.every((provider) => provider.configured), true);
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
