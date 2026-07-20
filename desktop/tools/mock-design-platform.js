"use strict";

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const port = Number(process.env.MOCK_DESIGN_PLATFORM_PORT || 3700);
const jobs = new Map();
const jobsByRequestId = new Map();
const assets = new Map();
const keepAlive = setInterval(() => undefined, 60_000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/v1/health") {
    return json(res, { ok: true, service: "mock-design-platform" });
  }

  if (req.method === "POST" && url.pathname === "/v1/design-jobs") {
    const body = await readJson(req);
    const requestId = String(body.requestId || "").trim();
    if (!requestId) return json(res, { error: "requestId is required" }, 400);
    const requestFingerprint = stableJson(body);
    const replay = jobsByRequestId.get(requestId);
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        return json(res, { error: "requestId was already used with a different payload" }, 409);
      }
      return json(res, { externalJobId: replay.job.externalJobId, status: replay.job.status });
    }
    const externalJobId = `mock-${randomUUID()}`;
    const job = {
      externalJobId,
      requestId: body.requestId,
      status: "generating",
      createdAt: new Date().toISOString(),
      images: Array.from({ length: body.outputCount || 6 }, (_, index) => ({
        imageId: String(index + 1),
        downloadUrl: `http://127.0.0.1:${port}/files/${externalJobId}/${index + 1}.png`,
        width: 1024,
        height: 1024,
      })),
    };
    jobs.set(externalJobId, job);
    jobsByRequestId.set(requestId, { job, requestFingerprint });
    setTimeout(() => {
      const current = jobs.get(externalJobId);
      if (current) {
        current.status = "completed";
        void notifyCallback(current, body.callback);
      }
    }, 1500);
    return json(res, { externalJobId, status: "generating" });
  }

  if (req.method === "POST" && url.pathname === "/v1/assets/upload") {
    const body = await readJson(req);
    const assetId = `mock-asset-${randomUUID()}`;
    const fileName = String(body.fileName || `${assetId}.png`);
    const asset = {
      assetId,
      sourceAssetId: body.assetId,
      remoteAssetId: assetId,
      fileName,
      mimeType: body.mimeType || "image/png",
      role: body.role || "reference",
      source: body.source,
      sourceRef: body.sourceRef,
      skuCode: body.skuCode,
      name: body.name,
      localPath: body.localPath,
      sizeBytes: body.sizeBytes,
      url: `http://127.0.0.1:${port}/assets/${assetId}/${encodeURIComponent(fileName)}`,
      createdAt: new Date().toISOString(),
    };
    assets.set(assetId, asset);
    return json(res, asset);
  }

  const jobMatch = url.pathname.match(/^\/v1\/design-jobs\/([^/]+)$/);
  if (req.method === "GET" && jobMatch) {
    const job = jobs.get(decodeURIComponent(jobMatch[1]));
    return job ? json(res, job) : json(res, { error: "not found" }, 404);
  }

  const resultMatch = url.pathname.match(/^\/v1\/design-jobs\/([^/]+)\/results$/);
  if (req.method === "GET" && resultMatch) {
    const job = jobs.get(decodeURIComponent(resultMatch[1]));
    return job ? json(res, { externalJobId: job.externalJobId, status: job.status, images: job.images }) : json(res, { error: "not found" }, 404);
  }

  const cancelMatch = url.pathname.match(/^\/v1\/design-jobs\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const job = jobs.get(decodeURIComponent(cancelMatch[1]));
    if (job) job.status = "cancelled";
    return json(res, { ok: true, status: "cancelled" });
  }

  if (req.method === "GET" && url.pathname.startsWith("/files/")) {
    return image(res);
  }

  const assetMatch = url.pathname.match(/^\/assets\/([^/]+)\//);
  if (req.method === "GET" && assetMatch) {
    const asset = assets.get(decodeURIComponent(assetMatch[1]));
    if (!asset) return json(res, { error: "asset not found" }, 404);
    if (asset.localPath && fs.existsSync(asset.localPath)) {
      const data = fs.readFileSync(asset.localPath);
      res.writeHead(200, { "Content-Type": asset.mimeType || "application/octet-stream", "Content-Length": data.length });
      return res.end(data);
    }
    return image(res);
  }

  return json(res, { error: "not found" }, 404);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock design platform listening on http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  console.error("[mock-design-platform] server error", error);
  clearInterval(keepAlive);
  process.exit(1);
});

server.on("close", () => {
  console.error("[mock-design-platform] server closed");
  clearInterval(keepAlive);
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("beforeExit", (code) => console.error(`[mock-design-platform] beforeExit code=${code}`));
process.on("exit", (code) => console.error(`[mock-design-platform] exit code=${code}`));
process.on("uncaughtException", (error) => {
  console.error("[mock-design-platform] uncaughtException", error);
  clearInterval(keepAlive);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[mock-design-platform] unhandledRejection", reason);
  clearInterval(keepAlive);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`[mock-design-platform] received ${signal}, shutting down`);
  clearInterval(keepAlive);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

function json(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function image(res, mimeType = "image/png") {
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
  res.writeHead(200, { "Content-Type": mimeType, "Content-Length": png1x1.length });
  res.end(png1x1);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function notifyCallback(job, callback) {
  const url = String(callback?.url || "").trim();
  const events = Array.isArray(callback?.events) ? callback.events : [];
  if (!url || (events.length && !events.includes("completed"))) return Promise.resolve();

  const payload = {
    requestId: job.requestId,
    externalJobId: job.externalJobId,
    status: "completed",
    images: job.images,
    errorMessage: "",
  };
  return postJson(url, payload, callback?.headers).catch((error) => {
    console.error(`[mock-design-platform] callback failed ${url}: ${error.message || error}`);
  });
}

function postJson(targetUrl, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const body = Buffer.from(JSON.stringify(payload));
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      {
        method: "POST",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        timeout: 3000,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": body.length,
          ...(headers && typeof headers === "object" ? headers : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("callback timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
