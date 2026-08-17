"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const {
  AiProviderPerformanceTracker,
  AiProviderService,
  OpenAiCompatibleRouter,
  buildFastSuggestionMessages,
  buildSuggestionMessages,
  classifySuggestionComplexity,
  providerOrderForTier,
} = require("../apps/api/src/ai/ai-provider.service");

function provider(name, baseUrl, routingTier = "economy") {
  return { name, enabled: true, configured: true, issues: [], apiKey: `${name}-key`, baseUrl, model: `${name}-model`, requestFormat: "openai", temperature: 0.2, maxTokens: 100, apiEndpoint: "/chat/completions", routingTier };
}

function runtime(providers, overrides = {}) {
  return {
    enabled: true,
    primary: "primary",
    fallbackChain: ["backup"],
    timeoutSeconds: 1,
    maxRetries: 1,
    promptKey: "",
    routing: { enabled: false, complexityThreshold: 4, economyChain: [], qualityChain: [] },
    settingsPath: "test",
    envPath: "test",
    providers,
    ...overrides,
  };
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

test("deadline-aware routing reserves time for a fast fallback", async (t) => {
  const { server, url } = await listen((request, response) => {
    if (request.url.startsWith("/slow/")) {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"choices":[{"message":{"content":"too late"}}]}');
      }, 4000);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"choices":[{"message":{"content":"fast model"}}]}');
  });
  t.after(() => server.close());
  const router = new OpenAiCompatibleRouter(runtime([
    provider("slow", `${url}/slow`),
    provider("fast", `${url}/fast`),
  ], { primary: "slow", fallbackChain: ["fast"], timeoutSeconds: 8, maxRetries: 0 }));

  const startedAt = Date.now();
  const result = await router.complete(
    [{ role: "user", content: "hello" }],
    { deadlineAt: Date.now() + 3500, maxRetries: 0 },
  );

  assert.equal(result.provider, "fast");
  assert.ok(Date.now() - startedAt < 3400);
});

test("measured primary keeps the usable budget when the measured fallback cannot fit", async (t) => {
  const { server, url } = await listen((request, response) => {
    if (request.url.startsWith("/primary/")) {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"choices":[{"message":{"content":"measured primary"}}]}');
      }, 2500);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"choices":[{"message":{"content":"quality fallback"}}]}');
  });
  t.after(() => server.close());
  const tracker = new AiProviderPerformanceTracker();
  tracker.recordSuccess("primary", 2600);
  tracker.recordSuccess("backup", 5500);
  const router = new OpenAiCompatibleRouter(runtime([
    provider("primary", `${url}/primary`, "economy"),
    provider("backup", `${url}/backup`, "quality"),
  ], { timeoutSeconds: 8, maxRetries: 0 }), { performanceTracker: tracker });

  const result = await router.complete(
    [{ role: "user", content: "hello" }],
    { deadlineAt: Date.now() + 3500, maxRetries: 0 },
  );

  assert.equal(result.provider, "primary");
  assert.equal(result.text, "measured primary");
});

test("adaptive ordering prefers measured fast providers and opens a circuit after repeated failures", () => {
  let now = Date.parse("2026-08-16T00:00:00.000Z");
  const tracker = new AiProviderPerformanceTracker(() => now);
  const adaptiveRuntime = runtime([
    provider("slow", "https://slow.invalid/v1"),
    provider("fast", "https://fast.invalid/v1"),
  ], { primary: "slow", fallbackChain: ["fast"], maxRetries: 0 });

  tracker.recordSuccess("slow", 2200);
  tracker.recordSuccess("fast", 320);
  assert.deepEqual(tracker.order(adaptiveRuntime, ["slow", "fast"]), ["fast", "slow"]);

  tracker.recordFailure("fast", 900);
  tracker.recordFailure("fast", 900);
  assert.equal(tracker.snapshot("fast").circuitState, "open");
  assert.deepEqual(tracker.order(adaptiveRuntime, ["slow", "fast"]), ["slow"]);

  now += 16_000;
  assert.equal(tracker.snapshot("fast").circuitState, "half_open");
  tracker.recordSuccess("fast", 350);
  assert.equal(tracker.snapshot("fast").circuitState, "closed");
  assert.deepEqual(tracker.order(adaptiveRuntime, ["slow", "fast"]), ["fast", "slow"]);
});

test("fast conversation prompt keeps safety facts while sending substantially fewer input characters", () => {
  const input = {
    customerMessage: "这个礼盒能定制 Logo 吗？",
    ruleSuggestion: "可以定制 Logo，请提供 Logo 文件和采购数量。",
    conversationHistory: [
      { role: "customer", content: "预算每份 50 元" },
      { role: "assistant", content: "可以按这个预算搭配" },
    ],
    knowledgeMatches: [{ title: "Logo 工艺", excerpt: "支持丝印，具体以已确认方案为准。" }],
    requiredTerms: ["Logo", "采购数量"],
    dialoguePlan: { knownFacts: ["预算每份 50 元"], prohibitedQuestions: ["预算是多少"] },
    nextAction: "只确认 Logo 文件和采购数量",
  };
  const full = buildSuggestionMessages(input).map((message) => message.content).join("\n");
  const fast = buildFastSuggestionMessages(input).map((message) => message.content).join("\n");

  assert.ok(fast.length < full.length * 0.65, `fast=${fast.length}, full=${full.length}`);
  assert.match(fast, /禁止编造价格、库存、交期、退款、承诺或身份/);
  assert.match(fast, /预算每份 50 元/);
  assert.match(fast, /必须原样保留：Logo；采购数量/);
  assert.match(fast, /本轮禁止再问：预算是多少/);
});

test("conversation deadline disables retries and returns control within the latency budget", async (t) => {
  let calls = 0;
  const { server, url } = await listen((_request, response) => {
    calls += 1;
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"choices":[{"message":{"content":"too late"}}]}');
    }, 900);
  });
  t.after(() => server.close());
  const router = new OpenAiCompatibleRouter(runtime([provider("primary", `${url}/primary`)], {
    primary: "primary",
    fallbackChain: [],
    timeoutSeconds: 5,
    maxRetries: 2,
  }));
  const startedAt = Date.now();
  await assert.rejects(
    () => router.complete(
      [{ role: "user", content: "hello" }],
      { providerOrder: ["primary"], deadlineAt: Date.now() + 500, maxRetries: 0 },
    ),
    /request timeout|All AI providers failed/,
  );
  const elapsedMs = Date.now() - startedAt;
  assert.equal(calls, 1);
  assert.ok(elapsedMs >= 400 && elapsedMs < 800, `elapsedMs=${elapsedMs}`);
});

test("configured primary never silently falls through to an unrelated provider", async () => {
  let unrelatedCalls = 0;
  const unrelated = provider("unrelated", "https://unrelated.invalid/v1");
  const router = new OpenAiCompatibleRouter(
    runtime([unrelated], { primary: "zhenxi_ai", fallbackChain: [] }),
    { fetchImpl: async () => { unrelatedCalls += 1; throw new Error("must not be called"); } },
  );

  await assert.rejects(
    () => router.complete([{ role: "user", content: "hello" }]),
    /No configured AI provider/,
  );
  assert.equal(unrelatedCalls, 0);
});

test("native Anthropic provider uses Messages API headers and response shape", async () => {
  let capturedUrl = "";
  let capturedHeaders;
  let capturedBody;
  const anthropic = {
    ...provider("anthropic", "https://api.anthropic.test/v1"),
    requestFormat: "anthropic",
    apiEndpoint: "/messages",
  };
  const router = new OpenAiCompatibleRouter(
    runtime([anthropic], { primary: "anthropic", fallbackChain: [], maxRetries: 0 }),
    {
      fetchImpl: async (url, options) => {
        capturedUrl = String(url);
        capturedHeaders = options.headers;
        capturedBody = JSON.parse(String(options.body));
        return new Response('{"content":[{"type":"text","text":"natural answer"}]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  const result = await router.complete([
    { role: "system", content: "system guidance" },
    { role: "user", content: "hello" },
  ]);

  assert.equal(result.text, "natural answer");
  assert.equal(capturedUrl, "https://api.anthropic.test/v1/messages");
  assert.equal(capturedHeaders["x-api-key"], "anthropic-key");
  assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
  assert.equal(capturedHeaders.Authorization, undefined);
  assert.equal(capturedBody.system, "system guidance");
  assert.deepEqual(capturedBody.messages, [{ role: "user", content: "hello" }]);
});

test("credential setup persists privately, hot-enables the provider, and never returns the key", { concurrency: false }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-credential-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  const envPath = path.join(root, ".env");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  include_provider_presets: true",
    "  providers: {}",
  ].join("\n"), "utf8");
  fs.writeFileSync(envPath, "EXISTING_VALUE=preserved\n", "utf8");

  const variableNames = [
    "AI_ENGINE_SETTINGS_PATH",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "AI_PROVIDER_ANTHROPIC_ENABLED",
  ];
  const previous = new Map(variableNames.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.AI_PROVIDER_ANTHROPIC_ENABLED;

  const service = new AiProviderService();
  const saved = await service.saveProviderCredential({
    provider: "anthropic",
    apiKey: "secret-anthropic-key",
    enabled: true,
  });
  const persisted = fs.readFileSync(envPath, "utf8");
  const serialized = JSON.stringify(saved);

  assert.match(persisted, /^EXISTING_VALUE=preserved$/m);
  assert.match(persisted, /^ANTHROPIC_API_KEY=secret-anthropic-key$/m);
  assert.match(persisted, /^ANTHROPIC_MODEL=claude-sonnet-4-20250514$/m);
  assert.match(persisted, /^AI_PROVIDER_ANTHROPIC_ENABLED=true$/m);
  assert.equal(saved.restartRequired, false);
  assert.equal(saved.provider.configured, true);
  assert.equal(saved.provider.apiKeyConfigured, true);
  assert.equal(saved.provider.performance.circuitState, "unmeasured");
  assert.equal(serialized.includes("secret-anthropic-key"), false);
});

test("complexity classifier sends short low-risk dialogue to economy and transactional context to quality", () => {
  const simple = classifySuggestionComplexity({
    customerMessage: "你们几点下班？",
    ruleSuggestion: "我们每天 18 点下班。",
    conversationHistory: [],
  }, 4);
  const complex = classifySuggestionComplexity({
    customerMessage: "这笔订单为什么还没发货？我已经等很久了。",
    ruleSuggestion: "订单 20260812 已进入生产，请核对付款和交期后回复。",
    agentKey: "transaction_followup_agent",
    scene: "订单异常跟进",
    conversationHistory: [
      { role: "customer", content: "上周说会安排" },
      { role: "assistant", content: "我帮您核对" },
      { role: "customer", content: "现在怎么样了" },
    ],
    requiredTerms: ["20260812", "生产", "付款", "交期"],
  }, 4);

  assert.equal(simple.tier, "economy");
  assert.equal(complex.tier, "quality");
  assert.ok(complex.score >= 4);
  assert.ok(complex.reasons.includes("sensitive_business_scene"));
});

test("economy routing can upgrade to quality but quality routing never downgrades", () => {
  const tiered = runtime([], {
    routing: {
      enabled: true,
      complexityThreshold: 4,
      economyChain: ["siliconflow", "dashscope"],
      qualityChain: ["zhenxi_ai", "moonshot"],
    },
  });

  assert.deepEqual(providerOrderForTier(tiered, "economy"), ["siliconflow", "dashscope", "zhenxi_ai", "moonshot"]);
  assert.deepEqual(providerOrderForTier(tiered, "quality"), ["zhenxi_ai", "moonshot"]);
});

test("explicit quality provider order never calls a configured economy provider", async () => {
  let economyCalls = 0;
  let qualityCalls = 0;
  const economy = provider("economy", "https://economy.invalid/v1");
  const quality = provider("quality", "https://quality.invalid/v1", "quality");
  const tieredRuntime = runtime([economy, quality], {
    routing: { enabled: true, complexityThreshold: 4, economyChain: ["economy"], qualityChain: ["quality"] },
  });
  const router = new OpenAiCompatibleRouter(
    tieredRuntime,
    {
      fetchImpl: async (url) => {
        if (String(url).includes("economy.invalid")) economyCalls += 1;
        if (String(url).includes("quality.invalid")) qualityCalls += 1;
        return new Response('{"choices":[{"message":{"content":"quality answer"}}]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  const result = await router.complete(
    [{ role: "user", content: "complex" }],
    { providerOrder: providerOrderForTier(tieredRuntime, "quality") },
  );
  assert.equal(result.provider, "quality");
  assert.equal(economyCalls, 0);
  assert.equal(qualityCalls, 1);
});
