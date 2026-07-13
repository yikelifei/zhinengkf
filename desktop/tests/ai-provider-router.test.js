"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { OpenAiCompatibleRouter } = require("../apps/api/src/ai/ai-provider.service");

function provider(name, baseUrl) {
  return { name, enabled: true, configured: true, issues: [], apiKey: `${name}-key`, baseUrl, model: `${name}-model`, requestFormat: "openai", temperature: 0.2, maxTokens: 100, apiEndpoint: "/chat/completions" };
}

function runtime(providers, overrides = {}) {
  return { enabled: true, primary: "primary", fallbackChain: ["backup"], timeoutSeconds: 1, maxRetries: 1, promptKey: "", settingsPath: "test", envPath: "test", providers, ...overrides };
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("OpenAI-compatible router retries primary then falls back", async (t) => {
  let primaryCalls = 0;
  let backupCalls = 0;
  const { server, url } = await listen((request, response) => {
    if (request.url.startsWith("/primary/")) {
      primaryCalls += 1;
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"busy"}');
      return;
    }
    backupCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"choices":[{"message":{"content":"备用模型回复"}}]}');
  });
  t.after(() => server.close());
  const router = new OpenAiCompatibleRouter(runtime([provider("primary", `${url}/primary`), provider("backup", `${url}/backup`)]), { sleep: async () => {} });
  const result = await router.complete([{ role: "user", content: "hello" }]);
  assert.equal(result.text, "备用模型回复");
  assert.equal(result.provider, "backup");
  assert.equal(primaryCalls, 2);
  assert.equal(backupCalls, 1);
});

test("OpenAI-compatible router times out and uses fallback", async (t) => {
  const { server, url } = await listen((request, response) => {
    if (request.url.startsWith("/primary/")) {
      setTimeout(() => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"choices":[{"message":{"content":"late"}}]}'); }, 150);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"choices":[{"message":{"content":"fast fallback"}}]}');
  });
  t.after(() => server.close());
  const router = new OpenAiCompatibleRouter(runtime([provider("primary", `${url}/primary`), provider("backup", `${url}/backup`)], { timeoutSeconds: 0.05, maxRetries: 0 }));
  const result = await router.complete([{ role: "user", content: "hello" }]);
  assert.equal(result.provider, "backup");
  assert.equal(result.text, "fast fallback");
});
