"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

process.env.DESIGN_PLATFORM_ADAPTER = "art_image_local";
process.env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3000";

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { DesignPlatformClient } = require("../apps/api/src/integrations/design-platform/design-platform.client");
const { appConfig } = require("../apps/api/src/shared/app-config");

const serverPath = path.resolve(__dirname, "../packages/mcp/zhenxi-ai-server.mjs");
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

test("bundled MCP exposes release-only health and generation tools", async (t) => {
  const requests = [];
  const mock = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (request.method === "GET" && request.url === "/api/health") {
      return json(response, 200, {
        ok: true,
        data: {
          status: "ok",
          service: "zhenxi-ai",
          version: "0.1.43",
          runtime: { channel: "customer", generationBackend: "server", localWorkspace: false },
          ai: { imageModel: "gpt-image-2", imageConfigured: true, imageApiType: "openai_images" },
          localDemo: { externalGenerateEnabled: true },
        },
      });
    }
    if (request.method === "POST" && request.url === "/api/local-assets") {
      return json(response, 200, {
        ok: true,
        data: { url: "/local-assets/reference.png", fileName: "reference.png", mimeType: "image/png" },
      });
    }
    if (request.method === "POST" && request.url === "/api/local-generate") {
      const input = JSON.parse(body.toString("utf8"));
      if (input.type === "image") {
        return ndjson(response, [
          { type: "ready", total: 2 },
          { type: "image", index: 0, result: { status: "success", url: "/generated/one.png" } },
          { type: "image", index: 1, result: { status: "success", url: "/generated/two.png" } },
          { type: "done", total: 2, successCount: 2, failedCount: 0, refund: { status: "not_required" } },
        ]);
      }
      return json(response, 200, {
        ok: true,
        data: {
          prompts: [`臻希文本模型生成的图片文案：${input.prompt}`],
          mode: "desktop",
          failedCount: 0,
          fallbackCount: 0,
          refund: { status: "not_required" },
        },
      });
    }
    if (request.method === "POST" && request.url === "/api/external/v1/images/generate") {
      return json(response, 200, {
        ok: true,
        data: {
          images: [
            { status: "success", url: "/generated/one.png" },
            { status: "success", url: "/generated/two.png" },
          ],
          refund: { status: "not_required" },
        },
      });
    }
    return json(response, 404, { error: { code: "NOT_FOUND" } });
  });
  await listen(mock);
  t.after(() => new Promise((resolve) => mock.close(resolve)));

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhenxi-mcp-release-"));
  const referencePath = path.join(fixtureRoot, "reference.png");
  const activeUserPath = path.join(fixtureRoot, "external-active-user.json");
  fs.writeFileSync(referencePath, PNG_BYTES);
  fs.writeFileSync(activeUserPath, JSON.stringify({
    userId: "release-user",
    accessToken: "test-active-release-session",
    deviceId: "release-device",
    updatedAt: new Date().toISOString(),
  }));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const address = mock.address();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: path.dirname(serverPath),
    stderr: "pipe",
    env: compactEnv({
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_PATH: process.env.NODE_PATH,
      ZHENXI_BASE_URL: `http://127.0.0.1:${address.port}`,
      ZHENXI_API_KEY: "test-release-key",
      ZHENXI_ACTIVE_USER_FILE: activeUserPath,
      ZHENXI_MCP_ALLOW_TEST_PORT: "1",
      ZHENXI_REQUEST_TIMEOUT_MS: "10000",
    }),
  });
  const client = new Client({ name: "smart-kefu-test", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "zhenxi_generate_copy",
    "zhenxi_generate_design",
    "zhenxi_generate_images",
    "zhenxi_health",
  ]);
  assert.equal(tools.tools.find((tool) => tool.name === "zhenxi_health").annotations.readOnlyHint, true);

  const health = await client.callTool({ name: "zhenxi_health", arguments: {} });
  assert.equal(health.isError, undefined);
  assert.equal(health.structuredContent.result.target, "installed_release");
  assert.equal(health.structuredContent.result.version, "0.1.43");

  const generated = await client.callTool({
    name: "zhenxi_generate_design",
    arguments: {
      brief: "保持参考产品真实外观，生成两张礼盒产品摄影图。",
      count: 2,
      size: "1024x1024",
      ratio: "1:1",
      reference_paths: [referencePath],
      request_id: "release-mcp-request-0001",
    },
  });
  assert.equal(generated.isError, undefined);
  assert.equal(generated.structuredContent.result.requestedCount, 2);
  assert.equal(generated.structuredContent.result.successCount, 2);
  assert.match(generated.structuredContent.result.generatedCopy, /^臻希文本模型生成的图片文案：/);
  assert.match(generated.structuredContent.result.images[0].url, /^http:\/\/127\.0\.0\.1:\d+\/generated\/one\.png$/);

  const localGenerateRequests = requests.filter((request) => request.url === "/api/local-generate");
  const copyRequest = localGenerateRequests.find((request) => JSON.parse(request.body.toString("utf8")).type === "prompt");
  const generationRequest = localGenerateRequests.find((request) => JSON.parse(request.body.toString("utf8")).type === "image");
  const uploadRequest = requests.find((request) => request.url === "/api/local-assets");
  assert.ok(copyRequest);
  assert.ok(uploadRequest);
  assert.ok(generationRequest);
  assert.equal(copyRequest.headers.authorization, "Bearer test-active-release-session");
  assert.equal(copyRequest.headers["x-art-device-id"], "release-device");
  assert.equal(uploadRequest.headers.authorization, "Bearer test-active-release-session");
  assert.ok(requests.indexOf(copyRequest) < requests.indexOf(generationRequest));
  assert.equal(generationRequest.headers.authorization, "Bearer test-active-release-session");
  assert.equal(generationRequest.headers.origin, `http://127.0.0.1:${address.port}`);
  assert.equal(generationRequest.headers.referer, `http://127.0.0.1:${address.port}/`);
  assert.equal(generationRequest.headers["sec-fetch-site"], "same-origin");
  const imageInput = JSON.parse(generationRequest.body.toString("utf8"));
  assert.equal(imageInput.count, 2);
  assert.equal(imageInput.stream, true);
  assert.equal(generationRequest.headers.accept, "application/x-ndjson");
  assert.match(imageInput.prompt, /^臻希文本模型生成的图片文案：/);
  assert.deepEqual(imageInput.objectRefs, ["/local-assets/reference.png"]);
  assert.equal(requests.some((request) => request.url === "/api/external/v1/images/generate"), false);
});

test("release client rejects development ports unless the isolated test gate is explicit", async () => {
  const { ZhenxiReleaseClient, ZhenxiReleaseError } = await import("../packages/mcp/zhenxi-ai-release-client.mjs");
  assert.throws(
    () => new ZhenxiReleaseClient({ ZHENXI_BASE_URL: "http://127.0.0.1:3000" }),
    (error) => error instanceof ZhenxiReleaseError && error.code === "ZHENXI_RELEASE_PORT_REQUIRED",
  );
  assert.doesNotThrow(() => new ZhenxiReleaseClient({ ZHENXI_BASE_URL: "http://127.0.0.1:31870" }));
});

test("customer health model flags do not override the authenticated remote image runtime", async (t) => {
  let generationCalls = 0;
  const mock = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      return json(response, 200, {
        ok: true,
        data: {
          status: "ok",
          runtime: { channel: "customer", localWorkspace: false },
          ai: { imageModel: null, imageConfigured: false },
        },
      });
    }
    if (request.url === "/api/local-assets") {
      return json(response, 200, { ok: true, data: { url: "/local-assets/reference.png" } });
    }
    generationCalls += 1;
    return ndjson(response, [
      { type: "ready", total: 1 },
      { type: "image", index: 0, result: { status: "success", url: "/generated/cloud-model.png" } },
      { type: "done", total: 1, successCount: 1, failedCount: 0, refund: { status: "not_required" } },
    ]);
  });
  await listen(mock);
  t.after(() => new Promise((resolve) => mock.close(resolve)));
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhenxi-mcp-model-"));
  const referencePath = path.join(fixtureRoot, "reference.png");
  const activeUserPath = path.join(fixtureRoot, "external-active-user.json");
  fs.writeFileSync(referencePath, PNG_BYTES);
  fs.writeFileSync(activeUserPath, JSON.stringify({
    userId: "release-user",
    accessToken: "test-active-release-session",
    deviceId: "release-device",
    updatedAt: new Date().toISOString(),
  }));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const { ZhenxiReleaseClient } = await import("../packages/mcp/zhenxi-ai-release-client.mjs");
  const client = new ZhenxiReleaseClient({
    ZHENXI_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    ZHENXI_API_KEY: "test-key",
    ZHENXI_ACTIVE_USER_FILE: activeUserPath,
    ZHENXI_MCP_ALLOW_TEST_PORT: "1",
  });
  const result = await client.generateImages({
    prompt: "使用成品软件远程配置生成一张测试图片。",
    count: 1,
    referencePaths: [referencePath],
    requestId: "release-mcp-cloud-0001",
  });
  assert.equal(result.successCount, 1);
  assert.equal(generationCalls, 1);
});

test("an incomplete image stream is outcome-unknown and is never retried", async (t) => {
  let generationCalls = 0;
  const mock = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      return json(response, 200, { ok: true, data: { status: "ok", runtime: { channel: "customer" }, ai: {} } });
    }
    if (request.url === "/api/local-assets") {
      return json(response, 200, { ok: true, data: { url: "/local-assets/reference.png" } });
    }
    generationCalls += 1;
    return ndjson(response, [
      { type: "ready", total: 1 },
      { type: "image_start", index: 0, total: 1 },
    ]);
  });
  await listen(mock);
  t.after(() => new Promise((resolve) => mock.close(resolve)));
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhenxi-mcp-incomplete-"));
  const referencePath = path.join(fixtureRoot, "reference.png");
  const activeUserPath = path.join(fixtureRoot, "external-active-user.json");
  fs.writeFileSync(referencePath, PNG_BYTES);
  fs.writeFileSync(activeUserPath, JSON.stringify({
    userId: "release-user",
    accessToken: "test-active-release-session",
    deviceId: "release-device",
    updatedAt: new Date().toISOString(),
  }));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const { ZhenxiReleaseClient } = await import("../packages/mcp/zhenxi-ai-release-client.mjs");
  const client = new ZhenxiReleaseClient({
    ZHENXI_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    ZHENXI_ACTIVE_USER_FILE: activeUserPath,
    ZHENXI_MCP_ALLOW_TEST_PORT: "1",
  });
  await assert.rejects(
    client.generateImages({
      prompt: "验证图片流中断后不得自动重试。",
      count: 1,
      referencePaths: [referencePath],
      requestId: "release-mcp-incomplete-0001",
    }),
    (error) => error.code === "ZHENXI_STREAM_INCOMPLETE" && error.outcomeUnknown === true,
  );
  assert.equal(generationCalls, 1);
});

test("smart customer service design pipeline uses the bundled MCP client for release mode", async (t) => {
  const previous = {
    adapter: appConfig.designPlatformAdapter,
    baseUrl: appConfig.designPlatformBaseUrl,
    imageSize: appConfig.designPlatformImageSize,
    imageRatio: appConfig.designPlatformImageRatio,
  };
  Object.assign(appConfig, {
    designPlatformAdapter: "zhenxi_external",
    designPlatformBaseUrl: "http://127.0.0.1:31870",
    designPlatformImageSize: "1024x1024",
    designPlatformImageRatio: "1:1",
  });
  t.after(() => Object.assign(appConfig, {
    designPlatformAdapter: previous.adapter,
    designPlatformBaseUrl: previous.baseUrl,
    designPlatformImageSize: previous.imageSize,
    designPlatformImageRatio: previous.imageRatio,
  }));

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zhenxi-mcp-pipeline-"));
  const referencePath = path.join(fixtureRoot, "reference.png");
  fs.writeFileSync(referencePath, PNG_BYTES);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const calls = [];
  const mcp = {
    enabled: () => true,
    health: async () => ({ target: "installed_release", reachable: true }),
    generateDesign: async (input) => {
      calls.push(input);
      return {
        images: [{ status: "success", url: "/generated/from-mcp.png" }],
        refund: { status: "not_required" },
      };
    },
  };
  const client = new DesignPlatformClient(mcp);
  const health = await client.health();
  assert.equal(health.transport, "mcp_stdio");
  assert.equal(health.target, "installed_release");

  const outcome = await client.executeDurableGeneration({
    requestId: "ignored-by-durable-layer",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    assets: [{ localPath: referencePath, fileName: "reference.png", mimeType: "image/png" }],
    outputCount: 1,
    renderStyle: "real product photo",
    requirements: { useRealSkuImages: false },
    customerText: "生成真实产品礼盒效果图",
  }, "release-mcp-durable-0001");
  assert.equal(outcome.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, "release-mcp-durable-0001");
  assert.equal(calls[0].count, 4);
  assert.deepEqual(calls[0].referencePaths, [referencePath]);
});

test("reference-free customer artwork uses native Zhenxi MCP once with four concurrent slots", async (t) => {
  const previous = {
    adapter: appConfig.designPlatformAdapter,
    baseUrl: appConfig.designPlatformBaseUrl,
    imageSize: appConfig.designPlatformImageSize,
    imageRatio: appConfig.designPlatformImageRatio,
  };
  Object.assign(appConfig, {
    designPlatformAdapter: "zhenxi_external",
    designPlatformBaseUrl: "http://127.0.0.1:31870",
    designPlatformImageSize: "1024x1024",
    designPlatformImageRatio: "1:1",
  });
  t.after(() => Object.assign(appConfig, {
    designPlatformAdapter: previous.adapter,
    designPlatformBaseUrl: previous.baseUrl,
    designPlatformImageSize: previous.imageSize,
    designPlatformImageRatio: previous.imageRatio,
  }));

  const calls = [];
  const mcp = {
    enabled: () => true,
    generateNativeImages: async (input) => {
      calls.push(input);
      return {
        results: Array.from({ length: 4 }, (_, index) => ({
          status: 201,
          body: { result: { file_url: `/generated/native-${index + 1}.png` } },
        })),
      };
    },
    generateDesign: async () => assert.fail("reference-free design must not use the installed-release reference bridge"),
  };
  const client = new DesignPlatformClient(mcp);
  const outcome = await client.executeDurableGeneration({
    requestId: "ignored-by-durable-layer",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    budget: {},
    bundle: {},
    assets: [],
    designType: "zhenxi_image",
    outputCount: 4,
    renderStyle: "海报设计",
    requirements: {
      useRealSkuImages: false,
      zhenxi: {
        prompt: "生成夏日饮品活动海报，不添加任何未提供的品牌和联系方式",
        capability: "海报设计",
        size: "1080x1440",
        ratio: "3:4",
      },
    },
    customerText: "生成夏日饮品活动海报",
  }, "zhenxi-native-image-0001");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].count, 4);
  assert.equal(calls[0].size, "1080x1440");
  assert.equal(calls[0].ratio, "3:4");
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.images.length, 4);
  assert.equal(outcome.images[0].width, 1080);
  assert.equal(outcome.images[0].height, 1440);
});

test("copy generation health-checks Zhenxi and exposes video scripts", async (t) => {
  const previous = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "zhenxi_external";
  t.after(() => { appConfig.designPlatformAdapter = previous; });
  const calls = [];
  const client = new DesignPlatformClient({
    enabled: () => true,
    health: async () => ({ reachable: true }),
    generateCopy: async (input) => {
      calls.push(input);
      return { requestId: input.requestId, prompts: ["真实模型生成的视频脚本"], selectedPrompt: "真实模型生成的视频脚本" };
    },
  });
  const outcome = await client.generateZhenxiCopy({
    prompt: "写一份30秒产品介绍视频脚本",
    requestId: "zhenxi-copy-video-0001",
    module: "video_script",
  });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.selectedPrompt, "真实模型生成的视频脚本");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].module, "video_script");
});

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function ndjson(response, events) {
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.end(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function compactEnv(values) {
  return Object.fromEntries(Object.entries(values).filter((entry) => typeof entry[1] === "string"));
}
