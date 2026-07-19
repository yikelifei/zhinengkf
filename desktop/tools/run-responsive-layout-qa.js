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
    artifacts: { jsonReport: reportPath, markdownReport: markdownPath, probeReport: probePath, screenshotDir },
  };
  writeReports(base, reportPath, markdownPath);

  try {
    validateLoopbackUrl(options.url);
    await preflightUrl(options.url, options.preflightTimeoutMs);

    let electronExecutable;
    try {
      electronExecutable = require("electron");
    } catch {
      return finish(base, {
        blockers: ["Electron runtime is unavailable; run npm.cmd ci in desktop first"],
      }, reportPath, markdownPath, 2);
    }

    const childResult = await runChild(
      electronExecutable,
      [path.join(desktopRoot, "tools", "product-acceptance-layout-probe.js")],
      {
        cwd: desktopRoot,
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

    base.process = {
      code: childResult.code,
      signal: childResult.signal,
      timedOut: childResult.timedOut,
      stdoutTail: tail(childResult.stdout, 30),
      stderrTail: tail(childResult.stderr, 30),
    };

    if (!fs.existsSync(probePath)) {
      const reason = childResult.timedOut
        ? `Electron renderer did not finish within ${options.timeoutMs}ms`
        : `Electron renderer exited without a probe report (code=${childResult.code}, signal=${childResult.signal || "none"})`;
      return finish(base, { blockers: [reason] }, reportPath, markdownPath, 2);
    }

    let probe;
    try {
      probe = JSON.parse(fs.readFileSync(probePath, "utf8"));
    } catch (error) {
      return finish(base, { blockers: [`Electron probe report is unreadable: ${error.message}`] }, reportPath, markdownPath, 2);
    }

    const status = probe.status === "passed" ? "passed" : probe.status === "failed" ? "failed" : "blocked";
    const blockers = [...(probe.blockers || [])];
    if (status === "blocked" && blockers.length === 0) {
      if (childResult.timedOut) blockers.push(`Electron renderer did not finish within ${options.timeoutMs}ms`);
      else blockers.push(`Electron renderer stopped before completing both viewports (code=${childResult.code}, signal=${childResult.signal || "none"})`);
    }
    const exitCode = status === "passed" ? 0 : status === "failed" ? 1 : 2;
    return finish(base, {
      status,
      passed: status === "passed",
      title: probe.title || "",
      viewports: probe.viewports || [],
      blockers,
      failures: probe.failures || [],
      consoleErrors: probe.consoleErrors || [],
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
