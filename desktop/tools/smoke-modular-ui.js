"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const VIEWPORTS = Object.freeze([
  Object.freeze({ id: "desktop", width: 1440, height: 900, mobile: false }),
  Object.freeze({ id: "mobile", width: 390, height: 844, mobile: true }),
]);
const REPORT_FILE = "modular-ui-smoke-report.json";
const DEFAULT_DELAY_MS = 1500;
const SAFE_NAVIGATION_SELECTOR = "nav a[href], [role=\"navigation\"] a[href]";
const DANGEROUS_NAVIGATION_PATTERN =
  /(?:logout|signout|delete|remove|destroy|send-now|queue-send|approve|reject|submit|confirm|save|publish|dispatch|execute|run-now)(?:[\/?#:_-]|$)/i;

const DOM_PROBE_SOURCE = String.raw`(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  };
  const roots = [document];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  const overlaySelectors = [
    "[data-nextjs-dialog-overlay]",
    "[data-nextjs-error-feedback]",
    "[data-nextjs-toast-errors]",
    "[data-next-badge-root][data-error]",
  ];
  const overlayMarkers = [];
  for (const root of roots) {
    for (const selector of overlaySelectors) {
      if (Array.from(root.querySelectorAll(selector)).some(visible)) overlayMarkers.push(selector);
    }
  }
  const portalText = Array.from(document.querySelectorAll("nextjs-portal"))
    .map((portal) => (portal.innerText || "") + " " + (portal.shadowRoot?.textContent || ""))
    .join(" ");
  if (/Unhandled Runtime Error|Runtime Error|Build Error|Failed to compile|Application error: a client-side exception has occurred/i.test(portalText)) {
    overlayMarkers.push("nextjs-portal:error-text");
  }
  const bodyTextLength = (document.body?.innerText || "").trim().length;
  const main = document.querySelector("main");
  const mainTextLength = (main?.innerText || "").trim().length;
  const documentWidth = document.documentElement?.scrollWidth || 0;
  const bodyWidth = document.body?.scrollWidth || 0;
  const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
  return {
    url: location.href,
    title: document.title || "",
    h1Count: document.querySelectorAll("h1").length,
    mainCount: document.querySelectorAll("main").length,
    bodyTextLength,
    mainTextLength,
    documentWidth,
    bodyWidth,
    viewportWidth,
    horizontalOverflow: Math.max(documentWidth, bodyWidth) > viewportWidth + 1,
    nextErrorOverlay: overlayMarkers.length > 0,
    overlayMarkers: Array.from(new Set(overlayMarkers)),
    readyState: document.readyState,
  };
})()`;

const SAFE_NAVIGATION_SOURCE = String.raw`(() => {
  const selector = ${JSON.stringify(SAFE_NAVIGATION_SELECTOR)};
  const dangerous = ${DANGEROUS_NAVIGATION_PATTERN.toString()};
  const current = new URL(location.href);
  const links = Array.from(document.querySelectorAll(selector));
  const link = links.find((candidate) => {
    if (!(candidate instanceof HTMLAnchorElement)) return false;
    if (!candidate.closest("nav, [role=\"navigation\"]")) return false;
    if (candidate.hasAttribute("download")) return false;
    if (candidate.target && candidate.target !== "_self") return false;
    const target = new URL(candidate.href, location.href);
    if (target.origin !== current.origin || target.href === current.href) return false;
    if (!/^https?:$/.test(target.protocol)) return false;
    const semantics = [target.pathname, target.search, candidate.dataset.actionId || "", candidate.getAttribute("aria-label") || ""]
      .join(" ")
      .toLowerCase();
    return !dangerous.test(semantics);
  });
  if (!link) return null;
  const target = new URL(link.href, location.href);
  const result = {
    href: target.href,
    pathname: target.pathname,
    actionId: link.dataset.actionId || null,
  };
  link.click();
  return result;
})()`;

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizeText(error?.stack || error, 1000));
    process.exitCode = 1;
  });
}

async function main() {
  const rawOptions = parseArgs(process.argv.slice(2));
  if (rawOptions.help) {
    process.stdout.write(usage());
    return null;
  }
  const options = normalizeOptions(rawOptions);
  let report;
  try {
    report = await runSmoke(options);
  } catch (error) {
    report = buildRunnerFailureReport(options, error);
    fs.mkdirSync(options.outputDir, { recursive: true });
    writeJsonAtomic(path.join(options.outputDir, REPORT_FILE), redactReport(report));
  }
  process.stdout.write(`modular-ui-report=${REPORT_FILE}\n`);
  process.stdout.write(`modular-ui-result=${report.ok ? "PASS" : "FAIL"}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

function buildRunnerFailureReport(options, error) {
  const message = sanitizeText(error?.message || error);
  return {
    schemaVersion: "smart_kefu_modular_ui_smoke_v1",
    generatedAt: new Date().toISOString(),
    ok: false,
    baseUrl: redactUrl(options.baseUrl),
    viewports: VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })),
    routeCount: options.routes.length,
    routes: [],
    navigation: null,
    screenshots: [],
    routeContract: summarizeRouteContract(options.routeInventory),
    failures: [{ stage: "runner", checks: ["runner"], error: message }],
  };
}

function usage() {
  return [
    "Usage:",
    "  node tools/smoke-modular-ui.js --base-url URL --output-dir DIR [--routes /overview,/conversations]",
    "  node tools/smoke-modular-ui.js --base-url URL --output-dir DIR [--route /overview --route /routing]",
    "",
    "When routes are omitted, static routes are merged from route-manifest.ts and apps/web/src/app/**/page.tsx.",
    "The smoke only clicks a same-origin navigation link; it never clicks business action buttons.",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const result = { routes: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      result.routes.push(argument);
      continue;
    }
    const [flag, inlineValue] = argument.split(/=(.*)/s, 2);
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value.`);
      index += 1;
      return next;
    };
    if (flag === "--base-url") result.baseUrl = readValue();
    else if (flag === "--output-dir") result.outputDir = readValue();
    else if (flag === "--delay-ms") result.delayMs = Number(readValue());
    else if (flag === "--route") result.routes.push(readValue());
    else if (flag === "--routes") {
      result.routes.push(...readValue().split(",").map((route) => route.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  return result;
}

function normalizeOptions(rawOptions, appRoot = path.resolve(__dirname, "../apps/web/src/app")) {
  if (!rawOptions.baseUrl) throw new Error("--base-url is required.");
  if (!rawOptions.outputDir) throw new Error("--output-dir is required.");
  const baseUrl = new URL(rawOptions.baseUrl);
  if (!/^https?:$/.test(baseUrl.protocol)) throw new Error("--base-url must use http or https.");
  if (baseUrl.username || baseUrl.password) throw new Error("Credentials are not allowed in --base-url.");
  baseUrl.hash = "";

  const suppliedRoutes = Array.isArray(rawOptions.routes) ? rawOptions.routes : [];
  const routeInventory = suppliedRoutes.length ? null : discoverRouteInventory(appRoot);
  const requestedRoutes = suppliedRoutes.length ? suppliedRoutes : routeInventory.routes;
  if (!requestedRoutes.length) throw new Error("No routes were provided or discovered.");
  const seen = new Set();
  const routes = [];
  for (const route of requestedRoutes) {
    const resolved = resolveRoute(baseUrl, route);
    if (seen.has(resolved.url)) continue;
    seen.add(resolved.url);
    routes.push(resolved);
  }

  const delayMs = rawOptions.delayMs === undefined ? DEFAULT_DELAY_MS : rawOptions.delayMs;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10000) {
    throw new Error("--delay-ms must be between 0 and 10000.");
  }
  return {
    baseUrl,
    outputDir: path.resolve(rawOptions.outputDir),
    delayMs,
    routes,
    routeInventory,
  };
}

function discoverDefaultRoutes(appRoot) {
  return discoverRouteInventory(appRoot).routes;
}

function discoverRouteInventory(appRoot) {
  if (!fs.existsSync(appRoot)) throw new Error(`Next app directory was not found: ${appRoot}`);
  const pageRoutes = [];
  walkFiles(appRoot, (filePath) => {
    if (path.basename(filePath) !== "page.tsx") return;
    const relativeDirectory = path.relative(appRoot, path.dirname(filePath));
    const rawSegments = relativeDirectory === "" ? [] : relativeDirectory.split(path.sep);
    if (rawSegments.some((segment) => segment.startsWith("[") || segment.startsWith("@") || segment.startsWith("_"))) {
      return;
    }
    const segments = rawSegments.filter((segment) => !/^\(.+\)$/.test(segment));
    pageRoutes.push(segments.length ? `/${segments.join("/")}` : "/");
  });

  const manifestPath = path.join(appRoot, "route-manifest.ts");
  const manifestRoutes = fs.existsSync(manifestPath)
    ? Array.from(fs.readFileSync(manifestPath, "utf8").matchAll(/\bhref:\s*["'`]([^"'`]+)["'`]/g))
      .map((match) => match[1])
      .filter((route) => route.startsWith("/") && !route.includes("["))
    : [];
  const uniquePages = Array.from(new Set(pageRoutes));
  const uniqueManifest = Array.from(new Set(manifestRoutes));
  const pageSet = new Set(uniquePages);
  const manifestSet = new Set(uniqueManifest);
  const routes = Array.from(new Set([...uniquePages, ...uniqueManifest])).sort((left, right) => {
    if (left === "/") return -1;
    if (right === "/") return 1;
    return left.localeCompare(right, "en");
  });
  return {
    routes,
    pageRoutes: uniquePages.sort((left, right) => left.localeCompare(right, "en")),
    manifestRoutes: uniqueManifest.sort((left, right) => left.localeCompare(right, "en")),
    manifestWithoutPage: uniqueManifest
      .filter((route) => !pageSet.has(route))
      .sort((left, right) => left.localeCompare(right, "en")),
    pageOnlyRoutes: uniquePages
      .filter((route) => !manifestSet.has(route))
      .sort((left, right) => left.localeCompare(right, "en")),
  };
}

function walkFiles(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(entryPath, visit);
    else if (entry.isFile()) visit(entryPath);
  }
}

function resolveRoute(baseUrl, route) {
  const rawRoute = String(route || "").trim();
  if (!rawRoute) throw new Error("Routes cannot be empty.");
  const url = new URL(rawRoute, baseUrl);
  if (url.origin !== baseUrl.origin) throw new Error(`Cross-origin route is not allowed: ${redactUrl(url)}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`Unsafe route protocol: ${url.protocol}`);
  if (url.username || url.password) throw new Error("Credentials are not allowed in routes.");
  url.hash = "";
  return {
    url: url.href,
    route: redactRoute(url),
  };
}

async function runSmoke(options) {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-modular-ui-"));
  let edge;
  let session;

  try {
    const edgePath = findEdgePath();
    const port = await getFreePort();
    edge = spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-features=Translate,BackForwardCache",
        "--remote-allow-origins=*",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "about:blank",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    let spawnError = null;
    edge.once("error", (error) => {
      spawnError = error;
    });

    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 80, 250, () => spawnError);
    const page = await createPage(port, "about:blank");
    const websocketUrl = page.webSocketDebuggerUrl || version.webSocketDebuggerUrl;
    if (!websocketUrl) throw new Error("Edge DevTools websocket URL was not available.");
    session = await CdpSession.connect(websocketUrl);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Network.enable");
    await session.send("Log.enable");

    const report = await exerciseRoutes(session, options);
    writeJsonAtomic(path.join(options.outputDir, REPORT_FILE), redactReport(report));
    return report;
  } finally {
    if (session) session.close();
    if (edge?.pid) terminateProcessTree(edge.pid);
    await removeTemporaryProfile(profileDir);
  }
}

async function exerciseRoutes(session, options) {
  const startedAt = new Date().toISOString();
  const routeResults = [];
  const screenshots = [];
  const representative = chooseRepresentativeRoute(options.routes);

  for (const viewport of VIEWPORTS) {
    await applyViewport(session, viewport);
    for (const route of options.routes) {
      let result;
      try {
        result = await inspectRoute(session, route, viewport, options.delayMs);
      } catch (error) {
        result = failedRouteResult(route, viewport, error);
      }
      routeResults.push(result);
      if (route.url === representative.url) {
        try {
          const file = screenshotFileName(route, viewport);
          await captureScreenshot(session, path.join(options.outputDir, file));
          screenshots.push({ viewport: viewport.id, route: route.route, file });
        } catch (error) {
          result.ok = false;
          result.checks.screenshot = false;
          result.screenshotError = sanitizeText(error?.message || error);
        }
      }
    }
  }

  let navigation;
  try {
    navigation = await exerciseNavigationHistory(session, representative, options.delayMs);
  } catch (error) {
    navigation = {
      ok: false,
      route: representative.route,
      checks: {
        linkFound: false,
        linkNavigated: false,
        historyBack: false,
        historyForward: false,
        nextErrorOverlay: false,
        runtimeExceptions: false,
      },
      error: sanitizeText(error?.message || error),
    };
  }

  const failures = routeResults
    .filter((result) => !result.ok)
    .map((result) => ({
      viewport: result.viewport,
      route: result.route,
      checks: Object.entries(result.checks).filter(([, passed]) => !passed).map(([name]) => name),
    }));
  if (!navigation.ok) {
    failures.push({
      viewport: "desktop",
      route: navigation.route,
      checks: Object.entries(navigation.checks).filter(([, passed]) => !passed).map(([name]) => `navigation.${name}`),
    });
  }
  const routeContract = summarizeRouteContract(options.routeInventory);
  if (routeContract && !routeContract.ok) {
    failures.push({
      viewport: "source",
      route: "route-manifest",
      checks: ["routeContract.manifestRoutesHavePages"],
    });
  }

  return {
    schemaVersion: "smart_kefu_modular_ui_smoke_v1",
    generatedAt: startedAt,
    ok: failures.length === 0,
    baseUrl: redactUrl(options.baseUrl),
    viewports: VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })),
    routeCount: options.routes.length,
    routes: routeResults,
    navigation,
    screenshots,
    routeContract,
    failures,
  };
}

function summarizeRouteContract(inventory) {
  if (!inventory) return null;
  return {
    ok: inventory.manifestWithoutPage.length === 0,
    checks: {
      manifestRoutesHavePages: inventory.manifestWithoutPage.length === 0,
    },
    pageRouteCount: inventory.pageRoutes.length,
    manifestRouteCount: inventory.manifestRoutes.length,
    unionRouteCount: inventory.routes.length,
    manifestWithoutPage: inventory.manifestWithoutPage,
    pageOnlyRoutes: inventory.pageOnlyRoutes,
  };
}

function chooseRepresentativeRoute(routes) {
  return routes.find((route) => new URL(route.url).pathname === "/overview") || routes[0];
}

async function inspectRoute(session, route, viewport, delayMs) {
  const responseMarker = session.responses.length;
  const diagnosticMarker = session.diagnosticMarker();
  const navigation = await navigateAndSettle(session, route.url, delayMs);
  const dom = await session.evaluate(DOM_PROBE_SOURCE);
  const documentResponses = session.responses.slice(responseMarker)
    .filter((response) => response.type === "Document")
    .filter((response) => !navigation.frameId || response.frameId === navigation.frameId);
  const loaderResponses = navigation.loaderId
    ? documentResponses.filter((response) => response.loaderId === navigation.loaderId)
    : [];
  const responses = loaderResponses.length ? loaderResponses : documentResponses;
  const response = responses.at(-1) || null;
  const diagnostics = session.diagnosticsSince(diagnosticMarker);
  return summarizeInspection({
    route: route.route,
    viewport: viewport.id,
    httpStatus: response?.status ?? null,
    dom,
    runtimeExceptions: diagnostics.runtimeExceptions,
    consoleErrors: diagnostics.consoleErrors,
  });
}

function summarizeInspection({ route, viewport, httpStatus, dom, runtimeExceptions = [], consoleErrors = [] }) {
  const checks = {
    httpStatus: Number.isFinite(httpStatus) && httpStatus >= 200 && httpStatus < 400,
    title: Boolean(dom?.title?.trim()),
    singleH1: dom?.h1Count === 1,
    singleMain: dom?.mainCount === 1,
    nonEmpty: (dom?.bodyTextLength || 0) >= 20 && (dom?.mainTextLength || 0) >= 10,
    horizontalOverflow: dom?.horizontalOverflow === false,
    nextErrorOverlay: dom?.nextErrorOverlay === false,
    runtimeExceptions: runtimeExceptions.length === 0,
  };
  return {
    route,
    viewport,
    ok: Object.values(checks).every(Boolean),
    checks,
    httpStatus,
    finalUrl: dom?.url ? redactUrl(dom.url) : null,
    title: sanitizeText(dom?.title || "", 160),
    h1Count: dom?.h1Count ?? null,
    mainCount: dom?.mainCount ?? null,
    bodyTextLength: dom?.bodyTextLength ?? 0,
    mainTextLength: dom?.mainTextLength ?? 0,
    viewportWidth: dom?.viewportWidth ?? null,
    documentWidth: dom?.documentWidth ?? null,
    bodyWidth: dom?.bodyWidth ?? null,
    overlayMarkers: Array.isArray(dom?.overlayMarkers) ? dom.overlayMarkers.map((value) => sanitizeText(value, 120)) : [],
    runtimeExceptionCount: runtimeExceptions.length,
    runtimeExceptions: runtimeExceptions.map((value) => sanitizeText(value, 500)).slice(0, 10),
    consoleErrorCount: consoleErrors.length,
    consoleErrors: consoleErrors.map((value) => sanitizeText(value, 500)).slice(0, 10),
  };
}

function failedRouteResult(route, viewport, error) {
  return {
    route: route.route,
    viewport: viewport.id,
    ok: false,
    checks: {
      httpStatus: false,
      title: false,
      singleH1: false,
      singleMain: false,
      nonEmpty: false,
      horizontalOverflow: false,
      nextErrorOverlay: false,
      runtimeExceptions: false,
    },
    error: sanitizeText(error?.message || error),
  };
}

async function exerciseNavigationHistory(session, route, delayMs) {
  const viewport = VIEWPORTS[0];
  await applyViewport(session, viewport);
  await navigateAndSettle(session, route.url, delayMs);
  const startUrl = await currentUrl(session);
  const diagnosticMarker = session.diagnosticMarker();
  const clicked = await session.evaluate(SAFE_NAVIGATION_SOURCE);
  if (!clicked) {
    return {
      ok: false,
      route: route.route,
      checks: {
        linkFound: false,
        linkNavigated: false,
        historyBack: false,
        historyForward: false,
        nextErrorOverlay: true,
        runtimeExceptions: true,
      },
      reason: "No safe same-origin navigation link was available.",
    };
  }

  const linkedUrl = await waitForUrl(session, (url) => url !== startUrl, 15000);
  await waitForReadyState(session, 10000);
  await sleep(delayMs);
  await session.evaluate("history.back(); true");
  const backUrl = await waitForUrl(session, (url) => comparableUrl(url) === comparableUrl(startUrl), 15000);
  await waitForReadyState(session, 10000);
  await session.evaluate("history.forward(); true");
  const forwardUrl = await waitForUrl(session, (url) => comparableUrl(url) === comparableUrl(linkedUrl), 15000);
  await waitForReadyState(session, 10000);
  await sleep(delayMs);

  const diagnostics = session.diagnosticsSince(diagnosticMarker);
  const dom = await session.evaluate(DOM_PROBE_SOURCE);
  const checks = {
    linkFound: true,
    linkNavigated: comparableUrl(linkedUrl) !== comparableUrl(startUrl),
    historyBack: comparableUrl(backUrl) === comparableUrl(startUrl),
    historyForward: comparableUrl(forwardUrl) === comparableUrl(linkedUrl),
    nextErrorOverlay: dom?.nextErrorOverlay === false,
    runtimeExceptions: diagnostics.runtimeExceptions.length === 0,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    route: route.route,
    checks,
    link: {
      route: redactRoute(new URL(clicked.href)),
      actionId: clicked.actionId ? sanitizeText(clicked.actionId, 120) : null,
    },
    startUrl: redactUrl(startUrl),
    linkedUrl: redactUrl(linkedUrl),
    backUrl: redactUrl(backUrl),
    forwardUrl: redactUrl(forwardUrl),
    runtimeExceptions: diagnostics.runtimeExceptions.map((value) => sanitizeText(value, 500)).slice(0, 10),
  };
}

async function navigateAndSettle(session, url, delayMs) {
  const loaded = session.waitForEvent((event) => event.method === "Page.loadEventFired", 25000);
  void loaded.catch(() => {});
  const navigation = await session.send("Page.navigate", { url });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  await loaded;
  await waitForReadyState(session, 10000);
  await sleep(delayMs);
  return navigation;
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

async function waitForReadyState(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await session.evaluate("document.readyState");
    if (state === "complete") return;
    await sleep(100);
  }
  throw new Error("Timed out waiting for document.readyState=complete.");
}

async function currentUrl(session) {
  return session.evaluate("location.href");
}

async function waitForUrl(session, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let value = await currentUrl(session);
  while (Date.now() < deadline) {
    if (predicate(value)) return value;
    await sleep(100);
    value = await currentUrl(session);
  }
  throw new Error(`Timed out waiting for browser history transition from ${redactUrl(value)}.`);
}

function comparableUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
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

function screenshotFileName(route, viewport) {
  const pathname = new URL(route.url).pathname;
  const slug = pathname === "/"
    ? "root"
    : pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  return `${slug || "page"}-${viewport.id}-${viewport.width}x${viewport.height}.png`;
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Set();
    this.responses = [];
    this.runtimeExceptions = [];
    this.consoleErrors = [];
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => this.failPending(new Error("Edge DevTools websocket closed.")));
    socket.addEventListener("error", () => this.failPending(new Error("Edge DevTools websocket failed.")));
  }

  static async connect(websocketUrl) {
    if (typeof WebSocket !== "function") throw new Error("This tool requires Node.js with built-in WebSocket support.");
    const socket = new WebSocket(websocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {}
        reject(new Error("Timed out connecting to Edge DevTools websocket."));
      }, 10000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      }, { once: true });
    });
    return new CdpSession(socket);
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
    this.recordDiagnostic(message);
    for (const waiter of Array.from(this.waiters)) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  recordDiagnostic(message) {
    if (message.method === "Network.responseReceived") {
      this.responses.push({
        type: message.params?.type,
        status: message.params?.response?.status,
        url: message.params?.response?.url,
        frameId: message.params?.frameId,
        loaderId: message.params?.loaderId,
      });
    } else if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      this.runtimeExceptions.push(
        details?.exception?.description || details?.exception?.value || details?.text || "Runtime exception",
      );
    } else if (message.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(message.params?.type)) {
      this.consoleErrors.push(formatConsoleArguments(message.params?.args));
    } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      this.consoleErrors.push(message.params.entry.text || "Browser log error");
    }
  }

  send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Evaluation failed.");
    }
    return result.result?.value;
  }

  waitForEvent(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error("Timed out waiting for Edge DevTools event."));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  diagnosticMarker() {
    return {
      runtimeExceptions: this.runtimeExceptions.length,
      consoleErrors: this.consoleErrors.length,
    };
  }

  diagnosticsSince(marker) {
    return {
      runtimeExceptions: this.runtimeExceptions.slice(marker.runtimeExceptions),
      consoleErrors: this.consoleErrors.slice(marker.consoleErrors),
    };
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  close() {
    try {
      this.socket.close();
    } catch {}
  }
}

function formatConsoleArguments(argumentsList) {
  return (Array.isArray(argumentsList) ? argumentsList : [])
    .map((argument) => argument.value ?? argument.description ?? argument.type ?? "")
    .join(" ");
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

async function waitForJson(url, attempts, delayMs, getFatalError = () => null) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const fatalError = getFatalError();
    if (fatalError) throw fatalError;
    try {
      return await requestJson(url);
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw lastError || new Error(`Timed out waiting for ${redactUrl(url)}`);
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
          reject(new Error(`HTTP ${response.statusCode} ${redactUrl(url)}`));
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

function terminateProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10000,
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

async function removeTemporaryProfile(profileDir) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.promises.rm(profileDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      if (!fs.existsSync(profileDir)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error("Temporary Edge profile could not be removed.");
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function redactReport(value) {
  if (Array.isArray(value)) return value.map(redactReport);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactReport(item)]));
  }
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return redactUrl(value);
    return sanitizeText(value);
  }
  return value;
}

function redactUrl(value) {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, "<redacted>");
    return url.href;
  } catch {
    return sanitizeText(value);
  }
}

function redactRoute(url) {
  const value = url instanceof URL ? new URL(url.href) : new URL(String(url));
  value.username = "";
  value.password = "";
  value.hash = "";
  for (const key of Array.from(value.searchParams.keys())) value.searchParams.set(key, "<redacted>");
  return `${value.pathname}${value.search}`;
}

function sanitizeText(value, maximumLength = 500) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\b((?:access[_-]?token|refresh[_-]?token|token|secret|password|cookie|authorization|api[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi, "$1<redacted>")
    .replace(/([?&][^=\s&]+)=([^&\s]+)/g, "$1=<redacted>")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "<email>")
    .replace(/\b1[3-9]\d{9}\b/g, "<phone>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/[A-Za-z]:\\(?:[^\\\r\n]+\\)*[^\\\r\n]*/g, "<path>")
    .replace(/\/(?:Users|home)\/[^\s]+/g, "<path>")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  DANGEROUS_NAVIGATION_PATTERN,
  DOM_PROBE_SOURCE,
  REPORT_FILE,
  SAFE_NAVIGATION_SELECTOR,
  SAFE_NAVIGATION_SOURCE,
  VIEWPORTS,
  buildRunnerFailureReport,
  discoverDefaultRoutes,
  discoverRouteInventory,
  normalizeOptions,
  parseArgs,
  redactReport,
  redactRoute,
  redactUrl,
  resolveRoute,
  sanitizeText,
  screenshotFileName,
  summarizeInspection,
  summarizeRouteContract,
  usage,
};
