"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

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
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-features=Translate,BackForwardCache",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 60, 250);
    const page = await createPage(port, options.url);
    const wsUrl = page.webSocketDebuggerUrl || version.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error("Edge DevTools websocket URL was not available.");
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
    const key = arg.slice(2);
    const value = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : "true";
    if (key === "width" || key === "height") result[key] = Number(value);
    else result[key] = value;
  }
  return result;
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

async function createPage(port, url) {
  try {
    return await requestJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  } catch {
    const pages = await requestJson(`http://127.0.0.1:${port}/json/list`);
    const page = (Array.isArray(pages) ? pages : []).find((item) => item.type === "page");
    if (!page) throw new Error("No Edge page target was available.");
    return page;
  }
}

async function captureWithCdp(wsUrl, options) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    if (message.method) events.push(message.method);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: options.width,
    height: options.height,
    deviceScaleFactor: 1,
    mobile: options.width <= 600,
  });
  await send("Page.navigate", { url: options.url });
  await waitForEvent(events, "Page.loadEventFired", 80, 250);
  await sleep(Number(options.delay || 2500));
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  fs.writeFileSync(options.output, Buffer.from(screenshot.data, "base64"));
  socket.close();
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
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
