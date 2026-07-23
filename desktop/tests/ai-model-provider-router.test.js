"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { MultiProviderAiRouter } = require("../apps/api/src/ai/ai-provider.service");

function provider(id, protocol, overrides = {}) {
  const endpoint = protocol === "openai_responses" ? "/responses" : protocol === "anthropic_messages" ? "/v1/messages" : "/chat/completions";
  return {
    id,
    label: id,
    vendor: id,
    description: "test",
    enabled: true,
    apiKey: `${id}-secret`,
    hasApiKey: true,
    apiKeyRequired: true,
    isLocal: false,
    baseUrl: `https://${id}.invalid/v1`,
    model: `${id}-model`,
    protocol,
    temperature: 0.2,
    maxTokens: 120,
    apiEndpoint: endpoint,
    configured: true,
    issues: [],
    modelSuggestions: [],
    ...overrides,
  };
}

function runtime(providers, overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    primary: providers[0].id,
    fallbackChain: providers.slice(1).map((item) => item.id),
    timeoutSeconds: 1,
    maxRetries: 0,
    providers,
    settingsPath: "test",
    runtimeConfigPath: "test",
    ...overrides,
  };
}

test("router emits and parses OpenAI Chat, OpenAI Responses and Anthropic Messages protocols", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (url.includes("responses.invalid")) {
      return new Response(JSON.stringify({ output_text: "responses reply" }), { status: 200 });
    }
    if (url.includes("anthropic.invalid")) {
      return new Response(JSON.stringify({ content: [{ type: "text", text: "anthropic reply" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "chat reply" } }] }), { status: 200 });
  };
  const providers = [
    provider("chat", "openai_chat"),
    provider("responses", "openai_responses"),
    provider("anthropic", "anthropic_messages", { baseUrl: "https://anthropic.invalid" }),
  ];
  const router = new MultiProviderAiRouter(runtime(providers), { fetchImpl });
  const messages = [
    { role: "system", content: "system rule" },
    { role: "user", content: "hello" },
  ];

  assert.equal((await router.completeWithProvider("chat", messages)).text, "chat reply");
  assert.equal((await router.completeWithProvider("responses", messages)).text, "responses reply");
  assert.equal((await router.completeWithProvider("anthropic", messages)).text, "anthropic reply");

  assert.equal(calls[0].body.messages[1].content, "hello");
  assert.equal(calls[0].headers.authorization, "Bearer chat-secret");
  assert.equal(calls[1].body.input[0].role, "system");
  assert.equal(calls[1].body.max_output_tokens, 120);
  assert.equal(calls[2].body.system, "system rule");
  assert.equal(calls[2].body.messages[0].role, "user");
  assert.equal("temperature" in calls[2].body, false);
  assert.equal(calls[2].headers["x-api-key"], "anthropic-secret");
  assert.equal(calls[2].headers["anthropic-version"], "2023-06-01");
});

test("router retries transient primary failure then falls back in configured order", async () => {
  let primaryCalls = 0;
  let backupCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("primary.invalid")) {
      primaryCalls += 1;
      return new Response('{"error":"busy"}', { status: 503 });
    }
    backupCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "备用回复" } }] }), { status: 200 });
  };
  const providers = [provider("primary", "openai_chat"), provider("backup", "openai_chat")];
  const router = new MultiProviderAiRouter(runtime(providers, { maxRetries: 1 }), {
    fetchImpl,
    sleep: async () => {},
  });

  const result = await router.complete([{ role: "user", content: "hello" }]);
  assert.equal(result.provider, "backup");
  assert.equal(result.text, "备用回复");
  assert.equal(primaryCalls, 2);
  assert.equal(backupCalls, 1);
});

test("local Ollama request can use the compatibility bearer token without a saved key", async () => {
  let headers;
  const ollama = provider("ollama", "openai_chat", {
    apiKey: "",
    hasApiKey: false,
    apiKeyRequired: false,
    isLocal: true,
    baseUrl: "http://127.0.0.1:11434/v1",
  });
  const router = new MultiProviderAiRouter(runtime([ollama]), {
    fetchImpl: async (_url, init) => {
      headers = init.headers;
      return new Response(JSON.stringify({ choices: [{ message: { content: "local reply" } }] }), { status: 200 });
    },
  });
  assert.equal((await router.complete([{ role: "user", content: "hello" }])).text, "local reply");
  assert.equal(headers.authorization, "Bearer ollama");
});
