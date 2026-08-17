"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const WebSocket = require("next/dist/compiled/ws");

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url || !options.output || !options.width || !options.height) {
    throw new Error("Usage: node tools/capture-page-screenshot.js --url URL --output FILE --width N --height N");
  }
  const edgePath = findEdgePath();
  const port = await getFreePort();
  const desktopRoot = path.resolve(__dirname, "..");
  const profileRoot = path.join(desktopRoot, ".runtime", "edge-profiles");
  const profileDir = options.profileDir || path.join(profileRoot, `edge-cdp-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const edge = spawn(
    edgePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--disable-accelerated-2d-canvas",
      "--disable-accelerated-video-decode",
      "--disable-zero-copy",
      "--disable-crash-reporter",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-features=Translate,BackForwardCache,DawnGraphite,SkiaGraphite,UseSkiaRenderer,Vulkan,WebGPU,VizDisplayCompositor",
      "--use-angle=swiftshader",
      "--use-gl=swiftshader",
      "--no-sandbox",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  edge.unref();

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 60, 250);
    const wsUrl = normalizeDebuggerWebsocketUrl(version.webSocketDebuggerUrl, port);
    await captureWithCdp(wsUrl, options);
  } finally {
    terminateProcessTree(edge.pid);
  }
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = camelCaseOption(arg.slice(2));
    const value = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : "true";
    if (key === "width" || key === "height") result[key] = Number(value);
    else result[key] = value;
  }
  return result;
}

function camelCaseOption(value) {
  return String(value || "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function findEdgePath() {
  const candidates = [
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Microsoft Edge was not found. Set EDGE_PATH to the browser executable.");
  return found;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForJson(url, attempts, delayMs) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await requestJson(url);
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method || "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} ${url}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    request.end();
  });
}

function normalizeDebuggerWebsocketUrl(value, port) {
  if (!value) throw new Error("Edge DevTools websocket URL was not available.");
  const url = new URL(value);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return url.href;
}

async function captureWithCdp(wsUrl, options) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  let sessionId = "";
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : event.data?.toString("utf8");
    const message = JSON.parse(raw);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    if (message.method) events.push(message.method);
  });
  const rejectPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("error", () => {
    rejectPending(new Error("Edge DevTools websocket failed during capture."));
  });
  socket.addEventListener("close", () => {
    rejectPending(new Error("Edge DevTools websocket closed before screenshot capture completed."));
  });

  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });

  const target = await send("Target.createTarget", { url: "about:blank" });
  if (!target.targetId) throw new Error("Edge did not return a targetId for screenshot capture.");
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  if (!attached.sessionId) throw new Error("Edge did not return a CDP sessionId for screenshot capture.");
  sessionId = attached.sessionId;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: options.width,
    height: options.height,
    deviceScaleFactor: 1,
    mobile: options.width <= 600,
  });
  const cookie = parseCookieOption(options.cookie);
  if (cookie) {
    await send("Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      url: new URL(options.url).origin,
    });
  }
  await send("Page.navigate", { url: options.url });
  await waitForEvent(events, "Page.loadEventFired", 80, 250);
  await sleep(Number(options.delay || 2500));
  const expression = readEvaluationExpression(options);
  if (expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: Number(options.evaluateTimeout || 15000),
    });
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails.exception || {};
      const message = exception.description || exception.value || result.exceptionDetails.text || "screenshot evaluation failed";
      throw new Error(message);
    }
    await sleep(Number(options.afterEvaluateDelay || 1500));
  }
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  const buffer = Buffer.from(screenshot.data, "base64");
  fs.writeFileSync(options.output, buffer);
  console.log(`[screenshot] wrote ${path.resolve(options.output)} (${buffer.length} bytes)`);
  if (typeof socket.terminate === "function") socket.terminate();
  else socket.close();
}

function readEvaluationExpression(options) {
  if (options.evaluateFile) return fs.readFileSync(path.resolve(options.evaluateFile), "utf8");
  return String(options.evaluate || "").trim();
}

function parseCookieOption(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const separator = text.indexOf("=");
  if (separator <= 0) return null;
  const name = text.slice(0, separator).trim();
  const cookieValue = text.slice(separator + 1).trim();
  if (!name || !cookieValue) return null;
  return { name, value: cookieValue };
}

async function waitForEvent(events, eventName, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (events.includes(eventName)) return;
    await sleep(delayMs);
  }
}

function terminateProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
