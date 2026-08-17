"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("mock design platform returns a reachable uploaded asset url", async () => {
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-design-platform-"));
  const imagePath = path.join(tempDir, "sku.png");
  const imageBytes = Buffer.from("fake sku image bytes");
  fs.writeFileSync(imagePath, imageBytes);

  const child = spawn(process.execPath, ["tools/mock-design-platform.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, MOCK_DESIGN_PLATFORM_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(port);

    const request = { requestId: "mock-replay-request-1", outputCount: 2 };
    const firstJob = await postJson(port, "/v1/design-jobs", request);
    const replayedJob = await postJson(port, "/v1/design-jobs", { outputCount: 2, requestId: "mock-replay-request-1" });
    assert.equal(replayedJob.externalJobId, firstJob.externalJobId);

    const completion = await postJson(port, "/v1/chat/completions", {
      model: "local-acceptance-text",
      messages: [{
        role: "user",
        content: "规则基准回复：订单已确认，请留意后续进度。\n必须逐字保留的已核实信息：订单号-123456、已付款",
      }],
    });
    assert.equal(
      completion.choices[0].message.content,
      "订单进度已经更新：订单号-123456、已付款。请您留意当前订单和物流记录，有问题可以继续在这里沟通。",
    );
    assert.equal(completion.choices[0].finish_reason, "stop");

    const uploaded = await postJson(port, "/v1/assets/upload", {
      assetId: "sku-asset-1",
      fileName: "sku.png",
      mimeType: "image/png",
      localPath: imagePath,
      role: "sku_image",
      source: "bundle",
      skuCode: "SKU-001",
      name: "Demo SKU",
    });

    assert.equal(uploaded.sourceAssetId, "sku-asset-1");
    assert.equal(uploaded.remoteAssetId, uploaded.assetId);
    assert.equal(uploaded.url, `http://127.0.0.1:${port}/assets/${uploaded.assetId}/sku.png`);
    assert.equal(uploaded.role, "sku_image");
    assert.equal(uploaded.skuCode, "SKU-001");

    const assetResponse = await getBuffer(uploaded.url);
    assert.equal(assetResponse.statusCode, 200);
    assert.equal(assetResponse.headers["content-type"], "image/png");
    assert.deepEqual(assetResponse.body, imageBytes);
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await getJson(port, "/v1/health");
      if (health.ok === true && health.service === "mock-design-platform") return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError || new Error("mock design platform did not become healthy");
}

function getJson(port, pathname) {
  return requestJson({
    method: "GET",
    hostname: "127.0.0.1",
    port,
    path: pathname,
  });
}

function postJson(port, pathname, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return requestJson({
    method: "POST",
    hostname: "127.0.0.1",
    port,
    path: pathname,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
    },
    body,
  });
}

function requestJson(options) {
  return new Promise((resolve, reject) => {
    const body = options.body;
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(text ? JSON.parse(text) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function getBuffer(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
