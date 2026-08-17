"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const outputDir = path.resolve(options.outputDir || path.join(desktopRoot, ".runtime", "responsive-qa", stamp()));
  const reportPath = path.join(outputDir, "responsive-layout-report.json");
  const markdownPath = path.join(outputDir, "responsive-layout-report.zh-CN.md");
  const probePath = path.join(outputDir, "electron-probe.json");
  const edgeProbePath = path.join(outputDir, "edge-probe.json");
  const screenshotDir = path.join(outputDir, "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const base = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "blocked",
    passed: false,
    url: options.url,
    renderer: "Electron Chromium",
    requestedViewports: [
      { name: "desktop-1536", width: 1536, height: 960 },
      { name: "mobile-390", width: 390, height: 844 },
    ],
    viewports: [],
    blockers: [],
    failures: [],
    process: null,
    artifacts: { jsonReport: reportPath, markdownReport: markdownPath, probeReport: probePath, electronProbeReport: probePath, edgeProbeReport: edgeProbePath, screenshotDir },
  };
  writeReports(base, reportPath, markdownPath);

  try {
    validateLoopbackUrl(options.url);
    await preflightUrl(options.url, options.preflightTimeoutMs);
    await delay(500);

    const edgePrimaryResult = await runEdgeProbe({
      cwd: desktopRoot,
      env: {
        ...process.env,
        RESPONSIVE_QA_WEB_URL: options.url,
        RESPONSIVE_QA_PROBE_OUTPUT: edgeProbePath,
        RESPONSIVE_QA_SCREENSHOT_DIR: screenshotDir,
      },
      timeoutMs: options.timeoutMs,
    });
    const edgePrimaryParsed = readProbeFile(edgeProbePath);
    if (!edgePrimaryParsed.error) {
      const edgePrimaryProbe = edgePrimaryParsed.probe;
      const edgePrimaryStatus = normalizeProbeStatus(edgePrimaryProbe);
      if (edgePrimaryStatus !== "blocked") {
        const edgePrimaryBlockers = probeBlockers(edgePrimaryStatus, edgePrimaryProbe, edgePrimaryResult, options.timeoutMs, "Edge CDP renderer");
        return finish(base, {
          status: edgePrimaryStatus,
          passed: edgePrimaryStatus === "passed",
          renderer: edgePrimaryProbe?.renderer || "Microsoft Edge CDP",
          title: edgePrimaryProbe?.title || "",
          viewports: edgePrimaryProbe?.viewports || [],
          blockers: edgePrimaryBlockers,
          failures: edgePrimaryProbe?.failures || [],
          consoleErrors: edgePrimaryProbe?.consoleErrors || [],
          process: { edge: childProcessEvidence(edgePrimaryResult) },
          artifacts: { ...base.artifacts, probeReport: edgeProbePath },
        }, reportPath, markdownPath, edgePrimaryStatus === "passed" ? 0 : 1);
      }
    }

    let electronExecutable;
    let electronLoadError = null;
    try {
      electronExecutable = require("electron");
    } catch (error) {
      electronLoadError = error;
    }

    let probe = null;
    let finalProbePath = probePath;
    let status = "blocked";
    let blockers = [];
    let failures = [];
    let consoleErrors = [];
    let processEvidence;

    if (electronExecutable) {
      const childResult = await runProbeChild(
        electronExecutable,
        [path.join(desktopRoot, "tools", "product-acceptance-layout-probe.js")],
        {
          cwd: desktopRoot,
          outputDir,
          probePath,
          timeoutMs: options.timeoutMs,
          env: {
            ...process.env,
            RESPONSIVE_QA_WEB_URL: options.url,
            RESPONSIVE_QA_PROBE_OUTPUT: probePath,
            RESPONSIVE_QA_SCREENSHOT_DIR: screenshotDir,
            ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
          },
        },
      );

      processEvidence = childProcessEvidence(childResult);
      const parsed = readProbeFile(probePath);
      if (parsed.error) {
        blockers = [childResult.timedOut
          ? `Electron renderer did not finish within ${options.timeoutMs}ms`
          : `Electron probe report is unavailable after ${(childResult.attempts || []).length || 1} attempt(s): ${parsed.error}`];
      } else {
        probe = parsed.probe;
        status = normalizeProbeStatus(probe);
        blockers = probeBlockers(status, probe, childResult, options.timeoutMs, "Electron renderer");
        failures = probe.failures || [];
        consoleErrors = probe.consoleErrors || [];
      }
    } else {
      processEvidence = {
        code: null,
        signal: null,
        timedOut: false,
        stdoutTail: "",
        stderrTail: electronLoadError?.message || String(electronLoadError || "Electron runtime is unavailable"),
        attempts: [],
      };
      blockers = ["Electron runtime is unavailable; run npm.cmd ci in desktop first"];
    }

    if (shouldRunEdgeFallback(status, probe, processEvidence)) {
      const edgeResult = edgePrimaryResult || await runEdgeProbe({
        cwd: desktopRoot,
        env: {
          ...process.env,
          RESPONSIVE_QA_WEB_URL: options.url,
          RESPONSIVE_QA_PROBE_OUTPUT: edgeProbePath,
          RESPONSIVE_QA_SCREENSHOT_DIR: screenshotDir,
        },
        timeoutMs: options.timeoutMs,
      });
      base.process = {
        electron: processEvidence,
        edge: childProcessEvidence(edgeResult),
      };
      const parsed = readProbeFile(edgeProbePath);
      if (parsed.error) {
        const edgeBlocker = edgeResult.timedOut
          ? `Edge CDP fallback did not finish within ${options.timeoutMs}ms`
          : `Edge CDP fallback probe report is unavailable: ${parsed.error}`;
        return finish(base, {
          status: "blocked",
          passed: false,
          blockers: [...blockers, edgeBlocker],
          failures,
          consoleErrors,
        }, reportPath, markdownPath, 2);
      }
      probe = parsed.probe;
      finalProbePath = edgeProbePath;
      status = normalizeProbeStatus(probe);
      blockers = probeBlockers(status, probe, edgeResult, options.timeoutMs, "Edge CDP fallback");
      failures = probe.failures || [];
      consoleErrors = probe.consoleErrors || [];
    } else {
      base.process = processEvidence;
    }

    const exitCode = status === "passed" ? 0 : status === "failed" ? 1 : 2;
    return finish(base, {
      status,
      passed: status === "passed",
      renderer: probe?.renderer || base.renderer,
      title: probe?.title || "",
      viewports: probe?.viewports || [],
      blockers,
      failures,
      consoleErrors,
      artifacts: { ...base.artifacts, probeReport: finalProbePath },
    }, reportPath, markdownPath, exitCode);
  } catch (error) {
    return finish(base, {
      blockers: [error instanceof Error ? error.message : String(error)],
    }, reportPath, markdownPath, 2);
  }
}

function parseArgs(argv) {
  const options = {
    url: String(process.env.RESPONSIVE_QA_WEB_URL || "http://127.0.0.1:3100/").trim(),
    outputDir: String(process.env.RESPONSIVE_QA_OUTPUT_DIR || "").trim(),
    timeoutMs: 120_000,
    preflightTimeoutMs: 5_000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--url") options.url = String(argv[++index] || "").trim();
    else if (arg === "--output-dir") options.outputDir = String(argv[++index] || "").trim();
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(argv[++index], "--timeout-ms");
    else if (arg === "--preflight-timeout-ms") options.preflightTimeoutMs = positiveInteger(argv[++index], "--preflight-timeout-ms");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function validateLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("responsive QA URL must be a valid loopback HTTP URL");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("responsive QA URL must be an explicit loopback HTTP URL");
  }
}

function childProcessEvidence(result) {
  return {
    code: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    stdoutTail: tail(result.stdout, 30),
    stderrTail: tail(result.stderr, 30),
    attempts: result.attempts || [],
  };
}

function readProbeFile(probePath) {
  if (!fs.existsSync(probePath)) return { error: "probe report was not written", probe: null };
  try {
    return { error: "", probe: JSON.parse(fs.readFileSync(probePath, "utf8")) };
  } catch (error) {
    return { error: `probe report is unreadable: ${error.message}`, probe: null };
  }
}

function normalizeProbeStatus(probe) {
  return probe?.status === "passed" ? "passed" : probe?.status === "failed" ? "failed" : "blocked";
}

function probeBlockers(status, probe, childResult, timeoutMs, rendererLabel) {
  const blockers = [...(probe?.blockers || [])];
  if (status !== "blocked" || blockers.length) return blockers;
  if (childResult.timedOut) return [`${rendererLabel} did not finish within ${timeoutMs}ms`];
  return [`${rendererLabel} stopped before completing both viewports after ${(childResult.attempts || []).length || 1} attempt(s) (code=${childResult.code}, signal=${childResult.signal || "none"})`];
}

function shouldRunEdgeFallback(status, probe, processEvidence) {
  if (status !== "blocked") return false;
  if (probe && Array.isArray(probe.viewports) && probe.viewports.length > 0) return false;
  const diagnosticText = [
    processEvidence.stderrTail,
    ...(processEvidence.attempts || []).map((attempt) => attempt.stderrTail),
    ...(probe?.blockers || []),
  ].join("\n");
  if (processEvidence.timedOut) return false;
  return /GPU process|ERR_FAILED|renderer stopped|Electron runtime is unavailable|probe report/i.test(diagnosticText)
    || !probe
    || (Array.isArray(probe.viewports) && probe.viewports.length === 0);
}

async function runEdgeProbe(options) {
  const maxAttempts = 3;
  const attempts = [];
  let lastResult = null;
  const probePath = options.env?.RESPONSIVE_QA_PROBE_OUTPUT;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (probePath) {
      try {
        fs.rmSync(probePath, { force: true });
      } catch {}
    }
    const result = runChildSync(process.execPath, [
      path.join(desktopRoot, "tools", "product-acceptance-layout-edge-probe.js"),
    ], {
      ...options,
      env: {
        ...options.env,
        RESPONSIVE_QA_EDGE_ATTEMPT: String(attempt),
      },
    });
    const probeSummary = probePath ? readProbeSummary(probePath) : { status: "missing", viewportCount: 0 };
    attempts.push({
      attempt,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      probeStatus: probeSummary.status,
      viewportCount: probeSummary.viewportCount,
      stderrTail: tail(result.stderr, 12),
    });
    lastResult = result;
    if (result.code === 0 || result.timedOut || probeSummary.status === "failed" || probeSummary.viewportCount > 0) break;
    if (attempt < maxAttempts) await delay(1_000);
  }
  return { ...lastResult, attempts };
}

function runChildSync(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    code: result.status,
    signal: result.signal,
    timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT"),
    stdout: result.stdout || "",
    stderr: [result.stderr || "", result.error?.stack || result.error?.message || ""].filter(Boolean).join("\n"),
  };
}

async function runProbeChild(command, args, options) {
  const maxAttempts = 2;
  const attempts = [];
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(options.probePath, { force: true });
    } catch {
      // Best effort cleanup; the next probe write will still report the real state.
    }
    const userDataPath = path.join(options.outputDir, `electron-user-data-attempt-${attempt}`);
    const result = await runChild(command, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env: {
        ...options.env,
        RESPONSIVE_QA_ATTEMPT: String(attempt),
        RESPONSIVE_QA_USER_DATA_PATH: userDataPath,
      },
    });
    const probeSummary = readProbeSummary(options.probePath);
    attempts.push({
      attempt,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      probeStatus: probeSummary.status,
      viewportCount: probeSummary.viewportCount,
      stderrTail: tail(result.stderr, 12),
    });
    lastResult = result;

    if (result.code === 0 || result.timedOut || probeSummary.status === "failed" || probeSummary.viewportCount >= 2) break;
    if (attempt < maxAttempts) await delay(1_000);
  }
  return { ...lastResult, attempts };
}

function readProbeSummary(probePath) {
  if (!fs.existsSync(probePath)) return { status: "missing", viewportCount: 0 };
  try {
    const probe = JSON.parse(fs.readFileSync(probePath, "utf8"));
    return {
      status: probe.status || "unknown",
      viewportCount: Array.isArray(probe.viewports) ? probe.viewports.length : 0,
    };
  } catch (error) {
    return { status: `unreadable: ${error.message}`, viewportCount: 0 };
  }
}

async function preflightUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`web service returned HTTP ${response.status}`);
    await response.body?.cancel();
  } catch (error) {
    const detail = error?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : error?.message || String(error);
    throw new Error(`web service is unavailable at ${url}: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

function runChild(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-200_000);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, timedOut, stdout, stderr: `${stderr}\n${error.stack || error}` });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout, stderr });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finish(base, patch, reportPath, markdownPath, exitCode) {
  const report = {
    ...base,
    ...patch,
    finishedAt: new Date().toISOString(),
  };
  writeReports(report, reportPath, markdownPath);
  console.log(`[responsive-qa] status=${report.status}`);
  console.log(`[responsive-qa] json=${reportPath}`);
  console.log(`[responsive-qa] markdown=${markdownPath}`);
  process.exitCode = exitCode;
  return report;
}

function writeReports(report, reportPath, markdownPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
}

function renderMarkdown(report) {
  const lines = [
    "# 桌面工作台响应式验收",
    "",
    `- 状态：**${String(report.status || "blocked").toUpperCase()}**`,
    `- URL：\`${report.url || "未提供"}\``,
    `- 渲染器：${report.renderer}`,
    `- 开始：${report.startedAt}`,
    `- 完成：${report.finishedAt || "运行中"}`,
    "",
    "## 视口结果",
    "",
    "| 视口 | 尺寸 | 状态 | 页面横向溢出 | 导航可用 | 主面板可见 | 交互可达 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const viewport of report.viewports || []) {
    const checks = viewport.checks || {};
    lines.push(`| ${viewport.name} | ${viewport.viewport?.width || "?"}×${viewport.viewport?.height || "?"} | ${viewport.passed ? "PASS" : "FAIL"} | ${mark(checks.noPageHorizontalOverflow)} | ${mark(checks.navigationAvailable)} | ${mark(checks.primaryPaneVisible)} | ${mark(checks.interactionReachable)} |`);
  }
  if (!(report.viewports || []).length) lines.push("| 尚无渲染证据 | - | BLOCKED | - | - | - | - |");
  lines.push("", "## 阻塞与失败", "");
  const issues = [...(report.blockers || []), ...(report.failures || [])];
  if (issues.length) issues.forEach((item) => lines.push(`- ${singleLine(item)}`));
  else lines.push("- 无");
  lines.push("", "## 产物", "", `- JSON：\`${report.artifacts.jsonReport}\``, `- Electron 探针：\`${report.artifacts.probeReport}\``, `- 截图目录：\`${report.artifacts.screenshotDir}\``, "");
  return `${lines.join("\n")}\n`;
}

function mark(value) {
  return value === true ? "PASS" : value === false ? "FAIL" : "-";
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tail(value, count) {
  return String(value || "").split(/\r?\n/).slice(-count).join("\n").trim();
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function printHelp() {
  console.log("Usage: node tools/run-responsive-layout-qa.js [--url http://127.0.0.1:3100/] [--output-dir path] [--timeout-ms 120000]");
  console.log("Exit codes: 0=passed, 1=rendered failure, 2=blocked/unavailable renderer or service");
}

module.exports = {
  main,
  parseArgs,
  renderMarkdown,
  validateLoopbackUrl,
};
