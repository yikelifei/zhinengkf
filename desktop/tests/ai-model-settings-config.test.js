"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const {
  loadAiProviderRuntime,
  saveAiProviderRuntimePatch,
  toAiProviderSettingsResponse,
} = require("../apps/api/src/ai/ai-provider-config");

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-model-settings-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(
    path.join(root, ".env"),
    "CUSTOM_API_KEY=legacy-secret\nCUSTOM_API_BASE=https://www.geeknow.top/v1\nCUSTOM_API_MODEL=gpt-5\nZHIPU_API_KEY=zhipu-secret\n",
    "utf8",
  );
  const settingsPath = path.join(root, "config", "settings.yaml");
  const runtimeConfigPath = path.join(root, "runtime", "ai-model-settings.json");
  fs.writeFileSync(
    settingsPath,
    [
      "ai_engine:",
      "  enabled: true",
      "  primary: custom_api_1",
      "  fallback_chain:",
      "    - zhipu",
      "  timeout_seconds: 9",
      "  max_retries: 2",
      "  providers:",
      "    custom_api_1:",
      "      enabled: true",
      "      api_key: ${CUSTOM_API_KEY}",
      "      base_url: ${CUSTOM_API_BASE}",
      "      model: ${CUSTOM_API_MODEL}",
      "      request_format: openai",
      "    zhipu:",
      "      enabled: true",
      "      api_key: ${ZHIPU_API_KEY}",
      "      base_url: https://open.bigmodel.cn/api/paas/v4",
      "      model: glm-4.5-flash",
    ].join("\n"),
    "utf8",
  );
  return { settingsPath, runtimeConfigPath };
}

test("model settings expose common providers and inherit the existing GeekNow primary", () => {
  const paths = setup();
  const runtime = loadAiProviderRuntime(paths);
  const providerIds = runtime.providers.map((provider) => provider.id);

  assert.equal(runtime.primary, "geeknow");
  assert.deepEqual(runtime.fallbackChain, ["zhipu"]);
  assert.equal(runtime.timeoutSeconds, 9);
  assert.equal(runtime.maxRetries, 2);
  assert.ok(providerIds.length >= 14);
  for (const id of [
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "qwen",
    "zhipu",
    "moonshot",
    "doubao",
    "minimax",
    "hunyuan",
    "siliconflow",
    "ollama",
    "custom",
  ]) {
    assert.ok(providerIds.includes(id), `missing provider ${id}`);
  }
  const geeknow = runtime.providers.find((provider) => provider.id === "geeknow");
  assert.equal(geeknow.apiKey, "legacy-secret");
  assert.equal(geeknow.configured, true);
});

test("API response masks keys and runtime edits preserve or explicitly clear secrets", () => {
  const paths = setup();
  const initial = loadAiProviderRuntime(paths);
  const response = toAiProviderSettingsResponse(initial);
  assert.equal(JSON.stringify(response).includes("legacy-secret"), false);
  assert.equal(response.providers.find((provider) => provider.id === "geeknow").hasApiKey, true);

  saveAiProviderRuntimePatch(
    {
      primary: "openai",
      fallbackChain: ["zhipu", "deepseek", "zhipu"],
      providers: {
        openai: {
          enabled: true,
          apiKey: "new-openai-secret",
          model: "gpt-test",
          baseUrl: "https://api.openai.com/v1/",
          protocol: "openai_responses",
        },
      },
    },
    paths,
  );

  const saved = saveAiProviderRuntimePatch(
    { providers: { openai: { apiKey: "", model: "gpt-test-2" } } },
    paths,
  );
  const openai = saved.providers.find((provider) => provider.id === "openai");
  assert.equal(saved.primary, "openai");
  assert.deepEqual(saved.fallbackChain, ["zhipu", "deepseek"]);
  assert.equal(openai.apiKey, "new-openai-secret");
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");

  const cleared = saveAiProviderRuntimePatch(
    { providers: { openai: { clearApiKey: true } } },
    paths,
  );
  assert.equal(cleared.providers.find((provider) => provider.id === "openai").hasApiKey, false);
});

test("non-local insecure base URLs are rejected while local Ollama HTTP is allowed", () => {
  const paths = setup();
  const runtime = saveAiProviderRuntimePatch(
    {
      providers: {
        openai: { enabled: true, apiKey: "secret", baseUrl: "http://api.vendor.test/v1", model: "gpt-test" },
        ollama: { enabled: true, baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b" },
      },
    },
    paths,
  );
  const openai = runtime.providers.find((provider) => provider.id === "openai");
  const ollama = runtime.providers.find((provider) => provider.id === "ollama");
  assert.ok(openai.issues.includes("base_url_invalid"));
  assert.equal(ollama.configured, true);
});
