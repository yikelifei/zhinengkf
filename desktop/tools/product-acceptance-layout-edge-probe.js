"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const WebSocket = globalThis.WebSocket || require("next/dist/compiled/ws");

const webUrl = String(process.env.RESPONSIVE_QA_WEB_URL || process.env.ACCEPTANCE_WEB_URL || "").trim();
const outputPath = path.resolve(
  process.env.RESPONSIVE_QA_PROBE_OUTPUT
    || path.join(process.cwd(), ".runtime", "responsive-qa", "edge-probe.json"),
);
const screenshotDir = path.resolve(process.env.RESPONSIVE_QA_SCREENSHOT_DIR || path.dirname(outputPath));
const viewports = [
  { name: "desktop-1536", width: 1536, height: 960, mobile: false },
  { name: "mobile-390", width: 390, height: 844, mobile: true },
];
const desktopSessionProof = String(process.env.DESKTOP_WEB_SESSION_PROOF || "").trim();
const edgeRuntime = {
  exitCode: null,
  exitSignal: null,
  stderrTail: "",
};
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: "blocked",
  passed: false,
  renderer: "Microsoft Edge CDP",
  url: webUrl,
  title: "",
  stage: "starting",
  diagnostics: buildDiagnostics(),
  viewports: [],
  blockers: [],
  failures: [],
  consoleErrors: [],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });
writeProbe();
run().catch(block);

async function run() {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?/i.test(webUrl)) {
    throw new Error("RESPONSIVE_QA_WEB_URL must be an explicit loopback HTTP URL");
  }

  const edgePath = findEdgePath();
  const port = await getFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-layout-edge-"));
  fs.mkdirSync(profileDir, { recursive: true });
  setStage("launching-edge");
  const edgeBrowserEnv = buildEdgeBrowserEnv();
  report.diagnostics.edgeBrowserEnvKeys = Object.keys(edgeBrowserEnv).length;
  report.diagnostics.edgeBrowserEnvSanitized = true;
  writeProbe();
  const edge = spawn(edgePath, [
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
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: edgeBrowserEnv });
  edge.stderr?.on("data", (chunk) => {
    edgeRuntime.stderrTail = tail(`${edgeRuntime.stderrTail}\n${chunk.toString("utf8")}`, 30);
    report.diagnostics.edgeRuntime = { ...edgeRuntime };
  });
  edge.once("exit", (code, signal) => {
    edgeRuntime.exitCode = code;
    edgeRuntime.exitSignal = signal;
    report.diagnostics.edgeRuntime = { ...edgeRuntime };
    writeProbe();
  });

  let session = null;
  try {
    setStage("waiting-for-devtools");
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 80, 250);
    const websocketUrl = normalizeDebuggerWebsocketUrl(version.webSocketDebuggerUrl, port);
    setStage("connecting-browser-devtools");
    session = await CdpSession.connect(websocketUrl);
    setStage("creating-page-target");
    await createAttachedPage(session, "about:blank");
    setStage("enabling-page");
    await session.send("Page.enable");
    setStage("enabling-runtime");
    await session.send("Runtime.enable");
    setStage("enabling-network");
    await session.send("Network.enable");
    setStage("enabling-log");
    await session.send("Log.enable");
    setStage("installing-desktop-session-cookie");
    await installDesktopSessionCookie(session, webUrl);

    for (const viewport of viewports) {
      setStage(`inspecting-${viewport.name}`);
      const result = await inspectViewport(session, viewport);
      report.viewports.push(result);
      report.consoleErrors.push(...result.consoleErrors.map((message) => `${viewport.name}: ${message}`));
      report.failures.push(...result.failures.map((name) => `${viewport.name}: ${name}`));
      report.title ||= result.title;
      writeProbe();
    }

    report.status = report.failures.length === 0 ? "passed" : "failed";
    report.passed = report.status === "passed";
    report.finishedAt = new Date().toISOString();
    writeProbe();
    process.exit(report.passed ? 0 : 1);
  } finally {
    if (session) session.close();
    terminateProcessTree(edge.pid);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

async function installDesktopSessionCookie(session, url) {
  if (!/^[a-f0-9]{64}$/i.test(desktopSessionProof)) return false;
  const target = new URL(url);
  const result = await session.send("Network.setCookie", {
    url: target.origin,
    name: "smart_kefu_desktop_session",
    value: desktopSessionProof,
    path: "/api",
    httpOnly: true,
    sameSite: "Strict",
    secure: target.protocol === "https:",
  });
  if (result.success === false) throw new Error("Edge CDP could not install the desktop session cookie.");
  return true;
}

async function inspectViewport(session, spec) {
  await applyViewport(session, spec);
  const marker = session.diagnosticMarker();
  await navigateAndSettle(session, webUrl, 500);
  await waitFor(
    session,
    `document.querySelector('main') && document.querySelector('[data-route-id]') && document.body.innerText.trim().length > 100`,
    60_000,
  );
  await delay(500);

  const interaction = spec.mobile
    ? await runMobileNavigationInteraction(session)
    : await runDesktopNavigationInteraction(session);
  await waitFor(
    session,
    `location.pathname === '/send/queue' && document.querySelector('[data-route-id="sendQueue"]')`,
    30_000,
  );
  await delay(700);

  const inspection = await session.evaluate(`(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const root = document.documentElement;
    const body = document.body;
    const main = document.querySelector('main');
    const pane = document.querySelector('[data-route-id="sendQueue"]');
    const desktopNavigation = document.querySelector('#workbench-desktop-navigation');
    const mobileNavigation = Array.from(document.querySelectorAll('nav')).find((item) => item.querySelector('button[aria-controls="workbench-mobile-navigation"]'));
    const activeDesktopLink = document.querySelector('a[data-section-id="send-center"][aria-current="page"]');
    const mobileTrigger = document.querySelector('button[aria-controls="workbench-mobile-navigation"]');
    const mainRect = main?.getBoundingClientRect();
    const paneRect = pane?.getBoundingClientRect();
    const desktopRect = desktopNavigation?.getBoundingClientRect();
    const mobileRect = mobileNavigation?.getBoundingClientRect();
    const triggerRect = mobileTrigger?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;
    const frameworkOverlay = Boolean(document.querySelector('[data-nextjs-toast], nextjs-portal [data-nextjs-error-overlay]'));
    const visible = (rect) => Boolean(rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < viewport.width && rect.bottom > 0 && rect.top < viewport.height);
    const mobile = ${spec.mobile ? "true" : "false"};
    const navigationAvailable = mobile
      ? visible(mobileRect) && visible(triggerRect) && getComputedStyle(mobileNavigation).display !== 'none'
      : visible(desktopRect) && visible(activeDesktopLink?.getBoundingClientRect()) && getComputedStyle(desktopNavigation).display !== 'none';
    const bottomPadding = mainStyle ? Number.parseFloat(mainStyle.paddingBottom) || 0 : 0;
    const checks = {
      exactViewport: viewport.width === ${spec.width} && viewport.height === ${spec.height},
      pageHasContent: body.innerText.trim().length > 100,
      noFrameworkErrorOverlay: !frameworkOverlay && !/Application error|Unhandled Runtime Error/i.test(body.innerText),
      noPageHorizontalOverflow: root.scrollWidth <= root.clientWidth + 1 && body.scrollWidth <= body.clientWidth + 1,
      navigationAvailable,
      primaryPaneVisible: visible(mainRect) && visible(paneRect),
      interactionReachable: location.pathname === '/send/queue' && pane?.getAttribute('data-route-id') === 'sendQueue',
      mobileNavigationDoesNotCoverContent: !mobile || bottomPadding + 2 >= (mobileRect?.height || 0),
    };
    return {
      url: location.href,
      title: document.title,
      viewport,
      documentMetrics: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        mainClientWidth: main?.clientWidth || 0,
        mainScrollWidth: main?.scrollWidth || 0,
      },
      navigation: {
        mode: mobile ? 'mobile-bottom-and-drawer' : 'desktop-sidebar',
        activeDesktopLink: Boolean(activeDesktopLink),
        mobileTriggerExpanded: mobileTrigger?.getAttribute('aria-expanded') || null,
        bottomPadding,
        mobileNavigationHeight: mobileRect?.height || 0,
      },
      checks,
    };
  })()`);

  const screenshotPath = path.join(screenshotDir, `${spec.name}.png`);
  await captureScreenshot(session, screenshotPath);
  const diagnostics = session.diagnosticsSince(marker);
  const consoleErrors = [
    ...diagnostics.consoleErrors,
    ...diagnostics.runtimeExceptions.map((message) => `runtime exception: ${message}`),
  ];
  const failures = Object.entries(inspection.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (consoleErrors.length) failures.push("rendererConsoleErrors");
  return {
    name: spec.name,
    ...inspection,
    interaction,
    screenshotPath,
    consoleErrors,
    failures,
    passed: failures.length === 0,
  };
}

async function runDesktopNavigationInteraction(session) {
  return session.evaluate(`(() => {
    const target = document.querySelector('a[data-section-id="send-center"]');
    if (!target) throw new Error('desktop send-center navigation link is missing');
    const rect = target.getBoundingClientRect();
    target.focus();
    target.click();
    return {
      target: 'a[data-section-id="send-center"]',
      wasVisible: rect.width > 0 && rect.height > 0,
      focusedBeforeClick: document.activeElement === target,
    };
  })()`);
}

async function runMobileNavigationInteraction(session) {
  const opened = await session.evaluate(`(() => {
    const trigger = document.querySelector('button[aria-controls="workbench-mobile-navigation"]');
    if (!trigger) throw new Error('mobile all-features trigger is missing');
    const rect = trigger.getBoundingClientRect();
    trigger.focus();
    trigger.click();
    return {
      target: 'button[aria-controls="workbench-mobile-navigation"]',
      wasVisible: rect.width > 0 && rect.height > 0,
      focusedBeforeClick: document.activeElement === trigger,
    };
  })()`);
  await waitFor(session, `document.querySelector('#workbench-mobile-navigation[role="dialog"]')`, 10_000);
  const selected = await session.evaluate(`(() => {
    const drawer = document.querySelector('#workbench-mobile-navigation[role="dialog"]');
    const target = drawer?.querySelector('a[href="/send/queue"]');
    if (!target) throw new Error('send queue link is missing from mobile drawer');
    const rect = target.getBoundingClientRect();
    target.focus();
    target.click();
    return {
      target: '#workbench-mobile-navigation a[href="/send/queue"]',
      drawerVisible: Boolean(drawer && drawer.getBoundingClientRect().height > 0),
      targetVisible: rect.width > 0 && rect.height > 0,
      focusedBeforeClick: document.activeElement === target,
    };
  })()`);
  return { ...opened, drawerSelection: selected };
}

async function navigateAndSettle(session, url, delayMs) {
  const loaded = session.waitForEvent((event) => event.method === "Page.loadEventFired", 25_000);
  void loaded.catch(() => {});
  const navigation = await session.send("Page.navigate", { url });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  await loaded;
  await waitForReadyState(session, 10_000);
  await delay(delayMs);
}

async function applyViewport(session, viewport) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
}

async function waitFor(session, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await session.evaluate(`Boolean(${expression})`)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`renderer wait timed out: ${expression}${lastError ? ` (${lastError.message})` : ""}`);
}

async function waitForReadyState(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await session.evaluate("document.readyState") === "complete") return;
    await delay(100);
  }
  throw new Error("Timed out waiting for document.readyState=complete.");
}

async function captureScreenshot(session, outputPath) {
  const screenshot = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  if (!screenshot.data) throw new Error("Edge returned an empty screenshot payload.");
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
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

function buildEdgeBrowserEnv() {
  const blocked = [
    /^npm_/i,
    /^NODE_/i,
    /^ELECTRON_/i,
    /^NEXT_/i,
    /^RESPONSIVE_QA_/i,
    /^DESKTOP_WEB_SESSION_PROOF$/i,
    /^INTERNAL_API_TOKEN$/i,
    /^WECHAT_/i,
    /^PERSONAL_WECHAT_/i,
    /^LOW_VALUE_AUTOMATION_/i,
  ];
  const sanitized = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (blocked.some((pattern) => pattern.test(key))) continue;
    sanitized[key] = value;
  }
  return sanitized;
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
      await delay(delayMs);
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
    const created = await requestJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (created?.type === "page" && created.webSocketDebuggerUrl) return created;
  } catch {}
  return waitForPageTarget(port, 40, 250);
}

async function createAttachedPage(session, url) {
  const created = await session.send("Target.createTarget", { url });
  if (!created.targetId) throw new Error("Edge did not return a targetId for the layout page.");
  const attached = await session.send("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true,
  });
  if (!attached.sessionId) throw new Error("Edge did not return a CDP sessionId for the layout page.");
  session.setSessionId(attached.sessionId);
  return { targetId: created.targetId, sessionId: attached.sessionId };
}

async function waitForPageTarget(port, attempts, delayMs) {
  let lastSeen = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pages = await requestJson(`http://127.0.0.1:${port}/json/list`);
    const existingPage = (Array.isArray(pages) ? pages : []).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (existingPage) return existingPage;
    lastSeen = JSON.stringify(pages).slice(0, 500);
    await delay(delayMs);
  }
  throw new Error(`No Edge page target websocket was available. Last targets: ${lastSeen}`);
}

function normalizeDebuggerWebsocketUrl(value, port) {
  if (!value) throw new Error("Edge DevTools websocket URL was not available.");
  const url = new URL(value);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return url.href;
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.sessionId = "";
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Set();
    this.messages = [];
    this.runtimeExceptions = [];
    this.consoleErrors = [];
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => this.failPending(new Error("Edge DevTools websocket closed.")));
    socket.addEventListener("error", (error) => this.failPending(new Error(`Edge DevTools websocket failed: ${error?.message || error}`)));
  }

  static async connect(websocketUrl) {
    const socket = new WebSocket(websocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {}
        reject(new Error("Timed out connecting to Edge DevTools websocket."));
      }, 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Edge DevTools websocket connection failed: ${error?.message || error}`));
      }, { once: true });
    });
    return new CdpSession(socket);
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
      return;
    }
    if (!message.method) return;
    this.messages.push(message);
    this.recordDiagnostic(message);
    for (const waiter of Array.from(this.waiters)) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  recordDiagnostic(message) {
    if (message.method === "Runtime.exceptionThrown") {
      this.runtimeExceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "runtime exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      this.consoleErrors.push((message.params?.args || []).map((item) => item.value || item.description || "").join(" ").trim() || "console error");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      this.consoleErrors.push(message.params.entry.text || "browser log error");
    }
  }

  send(method, params = {}, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload = { id, method, params };
      if (this.sessionId) payload.sessionId = this.sessionId;
      this.socket.send(JSON.stringify(payload));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime.evaluate failed.");
    }
    return response.result?.value;
  }

  waitForEvent(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      for (const message of this.messages) {
        if (predicate(message)) {
          resolve(message);
          return;
        }
      }
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error("Timed out waiting for browser event."));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  diagnosticMarker() {
    return {
      consoleErrorCount: this.consoleErrors.length,
      runtimeExceptionCount: this.runtimeExceptions.length,
    };
  }

  diagnosticsSince(marker) {
    return {
      consoleErrors: this.consoleErrors.slice(marker.consoleErrorCount),
      runtimeExceptions: this.runtimeExceptions.slice(marker.runtimeExceptionCount),
    };
  }

  close() {
    try {
      this.socket.close();
    } catch {}
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
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

function writeProbe() {
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function setStage(stage) {
  report.stage = stage;
  writeProbe();
}

function block(error) {
  report.status = "blocked";
  report.passed = false;
  report.finishedAt = new Date().toISOString();
  report.blockers.push(error instanceof Error ? error.message : String(error));
  writeProbe();
  console.error(error?.stack || error);
  process.exitCode = 2;
}

function buildDiagnostics() {
  const env = process.env;
  return {
    pid: process.pid,
    ppid: process.ppid,
    node: process.version,
    cwd: process.cwd(),
    websocketImplementation: globalThis.WebSocket ? "node-native" : "next-compiled-ws",
    hasDesktopSessionProof: /^[a-f0-9]{64}$/i.test(String(env.DESKTOP_WEB_SESSION_PROOF || "").trim()),
    hasElectronRunAsNode: Boolean(env.ELECTRON_RUN_AS_NODE),
    hasNodeOptions: Boolean(env.NODE_OPTIONS),
    hasNpmLifecycleEvent: Boolean(env.npm_lifecycle_event),
    pathLength: String(env.Path || env.PATH || "").length,
    edgeRuntime: { ...edgeRuntime },
  };
}

function tail(value, count) {
  return String(value || "").split(/\r?\n/).slice(-count).join("\n").trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
