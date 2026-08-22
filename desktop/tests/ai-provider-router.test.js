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
  customerServiceReplyPriorityProviders,
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

test("adaptive ordering keeps OpenAI as the high-cost last fallback", () => {
  const tracker = new AiProviderPerformanceTracker();
  const adaptiveRuntime = runtime([
    provider("dashscope", "https://dashscope.invalid/v1"),
    provider("zhipu", "https://zhipu.invalid/v1"),
    provider("zhenxi_ai", "https://zhenxi.invalid/v1", "quality"),
    provider("openai", "https://openai.invalid/v1", "quality"),
  ]);

  tracker.recordSuccess("openai", 120);
  tracker.recordSuccess("dashscope", 900);
  tracker.recordSuccess("zhipu", 700);
  tracker.recordSuccess("zhenxi_ai", 2_800);

  assert.deepEqual(
    tracker.order(adaptiveRuntime, ["dashscope", "zhipu", "zhenxi_ai", "openai"]),
    ["zhipu", "dashscope", "zhenxi_ai", "openai"],
  );
  assert.deepEqual(
    tracker.order(adaptiveRuntime, ["zhenxi_ai", "openai"]),
    ["zhenxi_ai", "openai"],
  );
  assert.deepEqual(
    tracker.order(runtime([provider("openai", "https://openai.invalid/v1", "quality")]), ["openai"]),
    ["openai"],
  );
});

test("customer-service reply priority keeps Qwen and Zhipu ahead of faster fallbacks", async () => {
  const calls = [];
  const tracker = new AiProviderPerformanceTracker();
  const dashscope = provider("dashscope", "https://dashscope.invalid/v1");
  const zhipu = provider("zhipu", "https://zhipu.invalid/v1");
  const zhenxi = provider("zhenxi_ai", "https://zhenxi.invalid/v1", "quality");
  tracker.recordSuccess("zhenxi_ai", 80);
  tracker.recordSuccess("dashscope", 900);
  tracker.recordSuccess("zhipu", 700);

  const router = new OpenAiCompatibleRouter(runtime([dashscope, zhipu, zhenxi]), {
    performanceTracker: tracker,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response('{"choices":[{"message":{"content":"千问优先回复"}}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await router.complete(
    [{ role: "user", content: "hello" }],
    {
      providerOrder: ["zhenxi_ai", "dashscope", "zhipu"],
      priorityProviderOrder: ["dashscope", "zhipu"],
      maxRetries: 0,
    },
  );

  assert.equal(result.provider, "zhipu");
  assert.match(calls[0], /zhipu\.invalid/);
});

test("customer-service reply priority skips cooled-down Qwen and Zhipu before normal fallbacks", async () => {
  const calls = [];
  let now = Date.parse("2026-08-18T00:00:00.000Z");
  const tracker = new AiProviderPerformanceTracker(() => now);
  const dashscope = provider("dashscope", "https://dashscope.invalid/v1");
  const zhipu = provider("zhipu", "https://zhipu.invalid/v1");
  const zhenxi = provider("zhenxi_ai", "https://zhenxi.invalid/v1", "quality");
  tracker.recordFailure("dashscope", 1000);
  tracker.recordFailure("dashscope", 1000);
  tracker.recordFailure("zhipu", 1000);
  tracker.recordFailure("zhipu", 1000);

  const router = new OpenAiCompatibleRouter(runtime([dashscope, zhipu, zhenxi]), {
    performanceTracker: tracker,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response('{"choices":[{"message":{"content":"备用回复"}}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await router.complete(
    [{ role: "user", content: "hello" }],
    {
      providerOrder: ["dashscope", "zhipu", "zhenxi_ai"],
      priorityProviderOrder: ["dashscope", "zhipu"],
      maxRetries: 0,
    },
  );

  assert.equal(result.provider, "zhenxi_ai");
  assert.match(calls[0], /zhenxi\.invalid/);
  now += 16_000;
});

test("customer-service text replies include DeepSeek after Qwen and Zhipu", () => {
  const replyRuntime = {
    providers: [
      { name: "deepseek", configured: true },
      { name: "dashscope", configured: true },
      { name: "zhipu", configured: true },
      { name: "openai", configured: true },
    ],
  };

  assert.deepEqual(
    customerServiceReplyPriorityProviders(replyRuntime),
    ["zhipu", "dashscope", "deepseek"],
  );
});

test("DeepSeek V4 Flash receives text only and disables thinking for fast customer replies", async () => {
  let capturedUrl = "";
  let capturedBody;
  const deepseek = {
    ...provider("deepseek", "https://api.deepseek.invalid"),
    model: "deepseek-v4-flash",
    visionEnabled: false,
  };
  const router = new OpenAiCompatibleRouter(runtime([deepseek], {
    primary: "deepseek",
    fallbackChain: [],
  }), {
    fetchImpl: async (url, options) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(options.body));
      return new Response('{"choices":[{"message":{"content":"这款可以定制 Logo，我先按您的数量核算。"}}]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await router.completeWithProvider("deepseek", [
    { role: "user", content: "客户发送图片。视觉模型提取到：咖色抽屉礼盒，正面有金色 Logo。" },
  ], 0);

  assert.equal(result.provider, "deepseek");
  assert.equal(capturedUrl, "https://api.deepseek.invalid/chat/completions");
  assert.equal(capturedBody.model, "deepseek-v4-flash");
  assert.deepEqual(capturedBody.thinking, { type: "disabled" });
  assert.equal(typeof capturedBody.messages[0].content, "string");
  assert.match(capturedBody.messages[0].content, /视觉模型提取到/);
  assert.equal(JSON.stringify(capturedBody).includes("image_url"), false);
});

test("text-only DeepSeek rejects raw image content before any API call", async () => {
  let calls = 0;
  const deepseek = {
    ...provider("deepseek", "https://api.deepseek.invalid"),
    model: "deepseek-v4-flash",
    visionEnabled: false,
  };
  const router = new OpenAiCompatibleRouter(runtime([deepseek], {
    primary: "deepseek",
    fallbackChain: [],
  }), {
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not call DeepSeek with image data");
    },
  });

  await assert.rejects(
    () => router.completeWithProvider("deepseek", [{
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }],
    }], 0),
    /does not support image input: deepseek/,
  );
  assert.equal(calls, 0);
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

test("generateInboundSuggestion pins Qwen and Zhipu for quality customer replies", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-reply-priority-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  max_retries: 0",
    "  routing:",
    "    enabled: true",
    "    complexity_threshold: 1",
    "    economy_chain:",
    "      - dashscope",
    "      - zhipu",
    "    quality_chain:",
    "      - zhenxi_ai",
    "  providers:",
    "    zhenxi_ai:",
    "      enabled: true",
    "      routing_tier: quality",
    "      api_key: zhenxi-key",
    "      base_url: https://zhenxi.invalid/v1",
    "      model: zhenxi-model",
    "    dashscope:",
    "      enabled: true",
    "      routing_tier: economy",
    "      api_key: dashscope-key",
    "      base_url: https://dashscope.invalid/compatible-mode/v1",
    "      model: qwen-plus",
    "    zhipu:",
    "      enabled: true",
    "      routing_tier: economy",
    "      api_key: zhipu-key",
    "      base_url: https://zhipu.invalid/api/paas/v4",
    "      model: glm-4-flash",
  ].join("\n"), "utf8");
  const previousSettingsPath = process.env.AI_ENGINE_SETTINGS_PATH;
  const previousFetch = global.fetch;
  const calls = [];
  t.after(() => {
    if (previousSettingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previousSettingsPath;
    global.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  global.fetch = async (url) => {
    calls.push(String(url));
    return new Response('{"choices":[{"message":{"content":"订单进度我先核对清楚，确认后给您明确回复。"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await new AiProviderService().generateInboundSuggestion({
    customerMessage: "这笔订单为什么还没发货？我已经等很久了。",
    ruleSuggestion: "我先帮您核对订单进度，确认后给您明确回复。",
    agentKey: "transaction_followup_agent",
    scene: "订单异常跟进",
    nextAction: "先核对订单进度，不承诺发货时间",
    requiredTerms: ["订单", "确认"],
    requireNaturalRewrite: true,
    routingHint: "quality",
  });

  const runtimeForPriority = {
    providers: [
      { name: "dashscope", configured: true },
      { name: "zhipu", configured: true },
      { name: "zhenxi_ai", configured: true },
    ],
  };
  assert.deepEqual(customerServiceReplyPriorityProviders(runtimeForPriority), ["zhipu", "dashscope"]);
  assert.equal(result.provider, "zhipu");
  assert.equal(result.requestedTier, "quality");
  assert.equal(result.resolvedTier, "economy");
  assert.match(calls[0], /zhipu\.invalid/);
});

test("provider response test reports link latency speed and reply without leaking secrets", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-response-test-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  max_retries: 0",
    "  providers:",
    "    dashscope:",
    "      enabled: true",
    "      routing_tier: economy",
    "      api_key: dashscope-secret",
    "      base_url: https://dashscope.invalid/compatible-mode/v1",
    "      model: qwen-plus",
  ].join("\n"), "utf8");
  const previousSettingsPath = process.env.AI_ENGINE_SETTINGS_PATH;
  const previousFetch = global.fetch;
  let capturedUrl = "";
  let capturedBody;
  t.after(() => {
    if (previousSettingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previousSettingsPath;
    global.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  global.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(options.body));
    return new Response('{"choices":[{"message":{"content":"客服连接测试通过"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const service = new AiProviderService();
  const result = await service.testProviderResponse("dashscope");
  const persistedStatus = await service.getStatus(false);
  const persisted = persistedStatus.providers.find((provider) => provider.name === "dashscope");
  const observationFile = fs.readFileSync(path.join(root, ".runtime", "ai-provider-observations.json"), "utf8");

  assert.equal(result.available, true);
  assert.equal(result.replyMatched, true);
  assert.equal(result.testUrl, "/api/ai/providers/dashscope/test");
  assert.equal(result.responsePreview, "客服连接测试通过");
  assert.ok(result.latencyMs >= 0);
  assert.ok(result.charactersPerSecond > 0);
  assert.equal(result.balance.supported, false);
  assert.equal(result.balance.status, "unsupported");
  assert.match(result.balance.display, /未接入查询/);
  assert.equal(result.checks.length, 4);
  assert.ok(result.checks.every((check) => check.ok));
  assert.match(capturedUrl, /dashscope\.invalid/);
  assert.match(JSON.stringify(capturedBody), /回应连接测试/);
  assert.equal(JSON.stringify(result).includes("dashscope-secret"), false);
  assert.equal(persisted.latestTest.latencyMs, result.latencyMs);
  assert.equal(persisted.latestTest.charactersPerSecond, result.charactersPerSecond);
  assert.equal(persisted.latestBalance.status, "unsupported");
  assert.equal(observationFile.includes("dashscope-secret"), false);
});

test("provider response test includes shared-base account balance without leaking secrets", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-balance-test-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  max_retries: 0",
    "  providers:",
    "    zhenxi_ai:",
    "      enabled: true",
    "      routing_tier: economy",
    "      api_key: zhenxi-shared-secret",
    "      base_url: https://api.deepseek.com/v1",
    "      model: deepseek-chat",
  ].join("\n"), "utf8");
  const previousSettingsPath = process.env.AI_ENGINE_SETTINGS_PATH;
  const previousFetch = global.fetch;
  const calls = [];
  t.after(() => {
    if (previousSettingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previousSettingsPath;
    global.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: options.body });
    if (String(url).endsWith("/user/balance")) {
      return new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{
          currency: "CNY",
          total_balance: "12.34",
          granted_balance: "2.00",
          topped_up_balance: "10.34",
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response('{"choices":[{"message":{"content":"客服连接测试通过"}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const service = new AiProviderService();
  const status = await service.getStatus(false);
  const zhenxiProvider = status.providers.find((provider) => provider.name === "zhenxi_ai");
  assert.equal(zhenxiProvider.balanceProbeSupported, true);
  assert.match(zhenxiProvider.balanceProbeLabel, /DeepSeek/);

  const result = await service.testProviderResponse("zhenxi_ai");

  assert.equal(result.available, true);
  assert.equal(result.balance.checked, true);
  assert.equal(result.balance.supported, true);
  assert.equal(result.balance.status, "available");
  assert.equal(result.balance.amount, 12.34);
  assert.equal(result.balance.currency, "CNY");
  assert.match(result.balance.display, /12\.34 元/);
  assert.match(result.balance.endpoint, /^https:\/\/api\.deepseek\.com\/user\/balance$/);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/v1\/chat\/completions$/);
  assert.match(calls[1].url, /\/user\/balance$/);
  assert.equal(calls[1].headers.Authorization, "Bearer zhenxi-shared-secret");
  assert.equal(JSON.stringify(result).includes("zhenxi-shared-secret"), false);
});

test("provider balance check reads shared-base balance without sending a model prompt", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-balance-only-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  max_retries: 0",
    "  providers:",
    "    zhenxi_ai:",
    "      enabled: true",
    "      routing_tier: economy",
    "      api_key: zhenxi-shared-secret",
    "      base_url: https://api.deepseek.com/v1",
    "      model: deepseek-chat",
  ].join("\n"), "utf8");
  const previousSettingsPath = process.env.AI_ENGINE_SETTINGS_PATH;
  const previousFetch = global.fetch;
  const calls = [];
  t.after(() => {
    if (previousSettingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previousSettingsPath;
    global.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: options.body });
    return new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{
        currency: "CNY",
        total_balance: "56.78",
        granted_balance: "6.78",
        topped_up_balance: "50.00",
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const service = new AiProviderService();
  const result = await service.getProviderBalance("zhenxi_ai");
  const persistedStatus = await service.getStatus(false);
  const persisted = persistedStatus.providers.find((provider) => provider.name === "zhenxi_ai");

  assert.equal(result.checked, true);
  assert.equal(result.supported, true);
  assert.equal(result.status, "available");
  assert.equal(result.amount, 56.78);
  assert.equal(result.currency, "CNY");
  assert.match(result.endpoint, /^https:\/\/api\.deepseek\.com\/user\/balance$/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/user\/balance$/);
  assert.equal(calls[0].headers.Authorization, "Bearer zhenxi-shared-secret");
  assert.equal(calls[0].body, undefined);
  assert.equal(calls.some((call) => /chat\/completions/.test(call.url)), false);
  assert.equal(JSON.stringify(result).includes("zhenxi-shared-secret"), false);
  assert.equal(persisted.latestBalance.status, "available");
  assert.equal(persisted.latestBalance.amount, 56.78);
});

test("DashScope balance uses the signed Alibaba BSS API with separate RAM credentials", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-alibaba-bss-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  max_retries: 0",
    "  providers:",
    "    dashscope:",
    "      enabled: true",
    "      routing_tier: economy",
    "      api_key: dashscope-model-secret",
    "      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1",
    "      model: qwen3.7-flash",
  ].join("\n"), "utf8");
  const previous = {
    settingsPath: process.env.AI_ENGINE_SETTINGS_PATH,
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    fetch: global.fetch,
  };
  const calls = [];
  t.after(() => {
    if (previous.settingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previous.settingsPath;
    if (previous.accessKeyId === undefined) delete process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    else process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = previous.accessKeyId;
    if (previous.accessKeySecret === undefined) delete process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    else process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = previous.accessKeySecret;
    global.fetch = previous.fetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = "ram-access-id";
  process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = "ram-access-secret";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: options.body });
    return new Response(JSON.stringify({
      Code: "200",
      Message: "success",
      Success: true,
      Data: {
        AvailableAmount: "88.60",
        AvailableCashAmount: "80.00",
        CreditAmount: "8.60",
        MybankCreditAmount: "0.00",
        Currency: "CNY",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const service = new AiProviderService();
  const status = await service.getStatus(false);
  const qwen = status.providers.find((item) => item.name === "dashscope");
  const result = await service.getProviderBalance("dashscope");
  const requestUrl = new URL(calls[0].url);

  assert.equal(qwen.billingCredentialKind, "alibaba_bss");
  assert.equal(qwen.billingCredentialConfigured, true);
  assert.equal(qwen.balanceProbeSupported, true);
  assert.equal(result.metric, "balance");
  assert.equal(result.amount, 88.6);
  assert.equal(result.currency, "CNY");
  assert.match(result.display, /88\.60 元/);
  assert.equal(calls.length, 1);
  assert.equal(requestUrl.origin, "https://business.aliyuncs.com");
  assert.equal(requestUrl.searchParams.get("Action"), "QueryAccountBalance");
  assert.equal(requestUrl.searchParams.get("Version"), "2017-12-14");
  assert.equal(requestUrl.searchParams.get("AccessKeyId"), "ram-access-id");
  assert.ok(requestUrl.searchParams.get("Signature"));
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].url.includes("ram-access-secret"), false);
  assert.equal(JSON.stringify(result).includes("ram-access-secret"), false);
});

test("OpenAI billing uses an Admin Key and reports organization cost instead of fake balance", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-openai-cost-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  max_retries: 0",
    "  providers:",
    "    openai:",
    "      enabled: true",
    "      routing_tier: quality",
    "      api_key: openai-project-model-key",
    "      base_url: https://api.openai.com/v1",
    "      model: gpt-4o-mini",
  ].join("\n"), "utf8");
  const previous = {
    settingsPath: process.env.AI_ENGINE_SETTINGS_PATH,
    adminKey: process.env.OPENAI_ADMIN_KEY,
    fetch: global.fetch,
  };
  const calls = [];
  t.after(() => {
    if (previous.settingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previous.settingsPath;
    if (previous.adminKey === undefined) delete process.env.OPENAI_ADMIN_KEY;
    else process.env.OPENAI_ADMIN_KEY = previous.adminKey;
    global.fetch = previous.fetch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  process.env.OPENAI_ADMIN_KEY = "openai-admin-secret";
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: options.body });
    return new Response(JSON.stringify({
      object: "page",
      data: [{
        object: "bucket",
        start_time: 0,
        end_time: 1,
        results: [
          { amount: { value: 1.25, currency: "usd" } },
          { amount: { value: 0.75, currency: "usd" } },
        ],
      }],
      has_more: false,
      next_page: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const service = new AiProviderService();
  const status = await service.getStatus(false);
  const openai = status.providers.find((item) => item.name === "openai");
  const result = await service.getProviderBalance("openai");
  const requestUrl = new URL(calls[0].url);

  assert.equal(openai.billingCredentialKind, "openai_admin");
  assert.equal(openai.billingCredentialConfigured, true);
  assert.equal(openai.billingQueryKind, "cost");
  assert.equal(openai.balanceProbeSupported, true);
  assert.equal(result.metric, "cost");
  assert.equal(result.status, "available");
  assert.equal(result.amount, 2);
  assert.equal(result.currency, "USD");
  assert.match(result.display, /本月已消费：\$2\.00/);
  assert.match(result.details.find((item) => item.label === "说明").value, /不返回充值后的剩余余额/);
  assert.equal(requestUrl.pathname, "/v1/organization/costs");
  assert.equal(requestUrl.searchParams.get("bucket_width"), "1d");
  assert.equal(requestUrl.searchParams.get("limit"), "31");
  assert.equal(calls[0].headers.Authorization, "Bearer openai-admin-secret");
  assert.equal(calls[0].headers.Authorization.includes("openai-project-model-key"), false);
  assert.equal(JSON.stringify(result).includes("openai-admin-secret"), false);
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
    "ANTHROPIC_BASE_URL",
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
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.AI_PROVIDER_ANTHROPIC_ENABLED;

  const service = new AiProviderService();
  const saved = await service.saveProviderCredential({
    provider: "anthropic",
    apiKey: "secret-anthropic-key",
    baseUrl: "https://anthropic-proxy.example/v1/",
    model: "claude-custom-model",
    enabled: true,
  });
  const persisted = fs.readFileSync(envPath, "utf8");
  const serialized = JSON.stringify(saved);

  assert.match(persisted, /^EXISTING_VALUE=preserved$/m);
  assert.match(persisted, /^ANTHROPIC_API_KEY=secret-anthropic-key$/m);
  assert.match(persisted, /^ANTHROPIC_BASE_URL=https:\/\/anthropic-proxy\.example\/v1$/m);
  assert.match(persisted, /^ANTHROPIC_MODEL=claude-custom-model$/m);
  assert.match(persisted, /^AI_PROVIDER_ANTHROPIC_ENABLED=true$/m);
  assert.equal(saved.restartRequired, false);
  assert.equal(saved.provider.configured, true);
  assert.equal(saved.provider.apiKeyConfigured, true);
  assert.equal(saved.provider.baseUrl, "https://anthropic-proxy.example/v1");
  assert.equal(saved.provider.model, "claude-custom-model");
  assert.equal(saved.provider.performance.circuitState, "unmeasured");
  assert.equal(serialized.includes("secret-anthropic-key"), false);
});

test("standalone GeekNow saves its own credentials without changing Zhenxi AI", { concurrency: false }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-standalone-geeknow-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.mkdirSync(path.join(root, "zhenxi"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  const envPath = path.join(root, ".env");
  const sharedEnvPath = path.join(root, "zhenxi", ".env.local");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  include_provider_presets: true",
    "  providers:",
    "    geeknow:",
    "      enabled: true",
    "      credential_source: environment",
    "      api_key: ${GEEKNOW_API_KEY}",
    "      base_url: ${GEEKNOW_BASE_URL}",
    "      model: ${GEEKNOW_MODEL}",
    "      request_format: openai",
  ].join("\n"), "utf8");
  fs.writeFileSync(envPath, "EXISTING_VALUE=preserved\n", "utf8");
  fs.writeFileSync(sharedEnvPath, [
    "AI_API_KEY=zhenxi-ai-secret-must-stay-unchanged",
    "AI_BASE_URL=https://geeknow.invalid/v1",
    "AI_TEXT_MODEL=old-geeknow-model",
  ].join("\n") + "\n", "utf8");

  const variableNames = [
    "AI_ENGINE_SETTINGS_PATH",
    "GEEKNOW_API_KEY",
    "GEEKNOW_BASE_URL",
    "GEEKNOW_MODEL",
    "AI_PROVIDER_GEEKNOW_ENABLED",
  ];
  const previous = new Map(variableNames.map((name) => [name, process.env[name]]));
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  for (const name of variableNames.slice(1)) delete process.env[name];
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const saved = await new AiProviderService().saveProviderCredential({
    provider: "geeknow",
    apiKey: "standalone-geeknow-secret",
    baseUrl: "https://geeknow.invalid/v1",
    model: "new-geeknow-model",
    enabled: true,
  });
  const sharedEnv = fs.readFileSync(sharedEnvPath, "utf8");
  const localEnv = fs.readFileSync(envPath, "utf8");

  assert.match(sharedEnv, /^AI_API_KEY=zhenxi-ai-secret-must-stay-unchanged$/m);
  assert.match(sharedEnv, /^AI_BASE_URL=https:\/\/geeknow\.invalid\/v1$/m);
  assert.match(sharedEnv, /^AI_TEXT_MODEL=old-geeknow-model$/m);
  assert.match(localEnv, /^GEEKNOW_API_KEY=standalone-geeknow-secret$/m);
  assert.match(localEnv, /^GEEKNOW_BASE_URL=https:\/\/geeknow\.invalid\/v1$/m);
  assert.match(localEnv, /^GEEKNOW_MODEL=new-geeknow-model$/m);
  assert.match(localEnv, /^AI_PROVIDER_GEEKNOW_ENABLED=true$/m);
  assert.equal(saved.provider.credentialSource, "environment");
  assert.equal(saved.provider.model, "new-geeknow-model");
  assert.equal(JSON.stringify(saved).includes("standalone-geeknow-secret"), false);
  assert.equal(JSON.stringify(saved).includes("zhenxi-ai-secret-must-stay-unchanged"), false);
});

test("model synchronization calls the configured upstream once and sanitizes the catalog", { concurrency: false }, async (t) => {
  let calls = 0;
  let authorization = "";
  const upstream = await listen((request, response) => {
    calls += 1;
    authorization = String(request.headers.authorization || "");
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/models");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [
      { id: "qwen-plus", display_name: "Qwen Plus" },
      { id: "qwen-flash", display_name: "Qwen Flash" },
      { id: "qwen-plus", display_name: "duplicate" },
      { id: "bad\nmodel" },
    ] }));
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-provider-model-sync-"));
  fs.mkdirSync(path.join(root, "config"));
  const settingsPath = path.join(root, "config", "settings.yaml");
  fs.writeFileSync(settingsPath, [
    "ai_engine:",
    "  enabled: true",
    "  timeout_seconds: 2",
    "  providers:",
    "    local_catalog:",
    "      enabled: true",
    "      api_key: model-sync-secret",
    `      base_url: ${upstream.url}/v1`,
    "      model: qwen-flash",
  ].join("\n"), "utf8");
  const previousSettingsPath = process.env.AI_ENGINE_SETTINGS_PATH;
  process.env.AI_ENGINE_SETTINGS_PATH = settingsPath;
  t.after(async () => {
    if (previousSettingsPath === undefined) delete process.env.AI_ENGINE_SETTINGS_PATH;
    else process.env.AI_ENGINE_SETTINGS_PATH = previousSettingsPath;
    await new Promise((resolve) => upstream.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = await new AiProviderService().syncProviderModels("local_catalog");

  assert.equal(calls, 1);
  assert.equal(authorization, "Bearer model-sync-secret");
  assert.equal(result.endpoint, `${upstream.url}/v1/models`);
  assert.deepEqual(result.models, [
    { id: "qwen-flash", label: "Qwen Flash" },
    { id: "qwen-plus", label: "Qwen Plus" },
  ]);
  assert.equal(JSON.stringify(result).includes("model-sync-secret"), false);
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

test("tier routing prefers requested tier and keeps the other tier as fallback", () => {
  const tiered = runtime([], {
    routing: {
      enabled: true,
      complexityThreshold: 4,
      economyChain: ["siliconflow", "dashscope"],
      qualityChain: ["zhenxi_ai", "moonshot"],
    },
  });

  assert.deepEqual(providerOrderForTier(tiered, "economy"), ["siliconflow", "dashscope", "zhenxi_ai", "moonshot"]);
  assert.deepEqual(providerOrderForTier(tiered, "quality"), ["zhenxi_ai", "moonshot", "siliconflow", "dashscope"]);
});

test("explicit quality provider order falls back to economy only after quality fails", async () => {
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
        if (String(url).includes("quality.invalid")) {
          qualityCalls += 1;
          return new Response('{"error":{"message":"quality unavailable"}}', {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if (String(url).includes("economy.invalid")) economyCalls += 1;
        return new Response('{"choices":[{"message":{"content":"economy answer"}}]}', {
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
  assert.equal(result.provider, "economy");
  assert.equal(economyCalls, 1);
  assert.equal(qualityCalls, 2);
});
