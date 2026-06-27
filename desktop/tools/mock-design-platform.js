"use strict";

const http = require("node:http");
const { randomUUID } = require("node:crypto");

const port = Number(process.env.MOCK_DESIGN_PLATFORM_PORT || 3700);
const jobs = new Map();
const assets = new Map();
const keepAlive = setInterval(() => undefined, 60_000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/v1/health") {
    return json(res, { ok: true, service: "mock-design-platform" });
  }

  if (req.method === "POST" && url.pathname === "/v1/design-jobs") {
    const body = await readJson(req);
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
    setTimeout(() => {
      const current = jobs.get(externalJobId);
      if (current) current.status = "completed";
    }, 1500);
    return json(res, { externalJobId, status: "generating" });
  }

  if (req.method === "POST" && url.pathname === "/v1/assets/upload") {
    const body = await readJson(req);
    const assetId = `mock-asset-${randomUUID()}`;
    const asset = {
      assetId,
      sourceAssetId: body.assetId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      role: body.role || "reference",
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
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png1x1.length });
    return res.end(png1x1);
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
