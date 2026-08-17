"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const SCHEMA_VERSION = "smart_kefu_delivery_full_automation_v1";

const desktopRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(desktopRoot, ".runtime");
const reportRoot = path.join(runtimeRoot, "delivery-full-automation");

function parseArgs(argv = []) {
  const options = {
    executeStagingReadiness: false,
    executeDatabaseRecovery: false,
    databaseConfirmation: "",
    validateExternalEvidence: false,
    evidenceRoot: "",
    stagingReport: "",
    recoveryReport: "",
    windowsReport: "",
    restartMock: true,
    skipReleaseGate: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--execute-staging-readiness") options.executeStagingReadiness = true;
    else if (arg === "--execute-database-recovery") options.executeDatabaseRecovery = true;
    else if (arg === "--database-confirm") options.databaseConfirmation = readRequired(argv, ++index, arg);
    else if (arg === "--evidence-root") options.evidenceRoot = readRequired(argv, ++index, arg);
    else if (arg === "--staging-report") options.stagingReport = readRequired(argv, ++index, arg);
    else if (arg === "--recovery-report") options.recoveryReport = readRequired(argv, ++index, arg);
    else if (arg === "--windows-report") options.windowsReport = readRequired(argv, ++index, arg);
    else if (arg === "--no-restart-mock") options.restartMock = false;
    else if (arg === "--skip-release-gate") options.skipReleaseGate = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.validateExternalEvidence = Boolean(options.evidenceRoot || options.stagingReport || options.recoveryReport || options.windowsReport);
  if (options.executeDatabaseRecovery && !options.databaseConfirmation) {
    throw new Error("--execute-database-recovery requires --database-confirm");
  }
  if (options.validateExternalEvidence) {
    const missing = ["evidenceRoot", "stagingReport", "recoveryReport", "windowsReport"].filter((key) => !options[key]);
    if (missing.length) throw new Error(`external evidence validation requires: ${missing.join(", ")}`);
  }
  return options;
}

function readRequired(argv, index, flag) {
  const value = String(argv[index] || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function npmExecutable() {
  return process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
}

function npmStep(id, title, script, args = [], options = {}) {
  const npmArgs = ["run", script, ...(args.length ? ["--", ...args] : [])];
  return {
    id,
    title,
    command: npmExecutable(),
    args: process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd", ...npmArgs] : npmArgs,
    reportPath: options.reportPath || "",
    reportPathResolver: options.reportPathResolver || null,
    expectedBlocked: options.expectedBlocked === true,
    safetyClass: options.safetyClass || "local",
  };
}

function stopPortsStep(id, title) {
  return {
    ...npmStep(id, title, "ports:stop"),
    verifyManagedPortsStopped: true,
    maxAttempts: 3,
  };
}

function nodeStep(id, title, args, options = {}) {
  return {
    id,
    title,
    command: process.execPath,
    args,
    reportPath: options.reportPath || "",
    reportPathResolver: options.reportPathResolver || null,
    expectedBlocked: options.expectedBlocked === true,
    safetyClass: options.safetyClass || "local",
  };
}

function buildDeliveryAutomationPlan(options = {}) {
  const steps = [
    stopPortsStep("ports.stop_before_acceptance", "Stop local mock stack before isolated acceptance"),
    npmStep("acceptance.local_safe", "Run local-safe product acceptance", "delivery:acceptance", [], {
      reportPathResolver: latestAcceptanceReportPath,
    }),
    npmStep("audit.project_completion", "Refresh project completion audit", "delivery:audit", [], {
      reportPath: path.join(runtimeRoot, "project-completion-audit", "latest.json"),
      expectedBlocked: true,
    }),
  ];

  if (options.executeDatabaseRecovery) {
    steps.push(nodeStep(
      "database.recovery_execute",
      "Execute guarded isolated database recovery rehearsal",
      ["tools/database-recovery-rehearsal.js", "--execute", "--confirm", options.databaseConfirmation],
      {
        reportPath: path.join(runtimeRoot, "database-recovery-rehearsal", "latest.json"),
        expectedBlocked: true,
        safetyClass: "guarded-database-recovery",
      },
    ));
  } else {
    steps.push(npmStep("database.recovery_plan", "Refresh database recovery plan", "database:recovery:plan", [], {
      reportPath: path.join(runtimeRoot, "database-recovery-rehearsal", "latest.json"),
      expectedBlocked: true,
      safetyClass: "offline-plan",
    }));
  }

  steps.push(npmStep(
    "staging.readiness",
    options.executeStagingReadiness ? "Run read-only staging readiness probes" : "Refresh offline staging readiness inventory",
    "delivery:staging-readiness",
    options.executeStagingReadiness ? ["--execute"] : [],
    {
      reportPath: path.join(runtimeRoot, "staging-readiness-evidence", "latest.json"),
      expectedBlocked: true,
      safetyClass: options.executeStagingReadiness ? "read-only-external" : "offline-inventory",
    },
  ));

  steps.push(
    npmStep("windows.package_preflight", "Refresh Windows package preflight", "delivery:windows-package-preflight", [], {
      reportPath: path.join(runtimeRoot, "windows-package-verification", "latest.json"),
      expectedBlocked: true,
      safetyClass: "offline-preflight",
    }),
    stopPortsStep("ports.stop_before_gate", "Stop local mock stack before release gate"),
  );

  if (!options.skipReleaseGate) {
    steps.push(npmStep("release.gate", "Run production release gate", "release:gate", [], {
      reportPath: path.join(runtimeRoot, "production-release-gate", "latest.json"),
      expectedBlocked: true,
    }));
  }

  steps.push(
    npmStep("handoff.initial", "Refresh delivery handoff bundle", "delivery:handoff", [], {
      reportPath: path.join(runtimeRoot, "delivery-handoff", "latest.json"),
      expectedBlocked: true,
    }),
    npmStep("freeze.plan", "Refresh release candidate freeze plan", "delivery:freeze-plan", [], {
      reportPath: path.join(runtimeRoot, "release-candidate-freeze-plan", "latest.json"),
      expectedBlocked: true,
    }),
    npmStep("handoff.final", "Refresh final delivery handoff bundle", "delivery:handoff", [], {
      reportPath: path.join(runtimeRoot, "delivery-handoff", "latest.json"),
      expectedBlocked: true,
    }),
  );

  if (options.validateExternalEvidence) {
    steps.push(npmStep("external.evidence_bundle", "Validate external evidence bundle", "external:evidence:bundle", [
      "--evidence-root", options.evidenceRoot,
      "--staging-report", options.stagingReport,
      "--recovery-report", options.recoveryReport,
      "--windows-report", options.windowsReport,
    ], { expectedBlocked: true, safetyClass: "local-validation" }));
  }

  if (options.restartMock) {
    steps.push(
      npmStep("mock.restart", "Restart local mock stack", "ports:start:mock"),
      npmStep("mock.final_status", "Check final local mock stack", "ports:status:mock"),
    );
  }

  return steps;
}

function runDeliveryAutomation(options = {}) {
  const steps = buildDeliveryAutomationPlan(options);
  const results = [];
  for (const step of steps) {
    process.stdout.write(`[delivery-full] ${step.title}...\n`);
    const result = runStep(step);
    results.push(result);
    process.stdout.write(`[${result.status}] ${step.title} (${Math.ceil(result.durationMs / 1000)}s)\n`);
    if (result.status === STATUS.FAIL) break;
  }
  if (options.restartMock !== false && results.some((item) => item.status === STATUS.FAIL)) {
    for (const step of steps.filter((item) => item.id === "mock.restart" || item.id === "mock.final_status")) {
      if (results.some((item) => item.id === step.id)) continue;
      process.stdout.write(`[delivery-full] ${step.title} after failure...\n`);
      const result = runStep(step);
      results.push({ ...result, recoveryAfterFailure: true });
      process.stdout.write(`[${result.status}] ${step.title} (${Math.ceil(result.durationMs / 1000)}s)\n`);
    }
  }
  const report = createAutomationReport(options, steps, results);
  const artifacts = writeReports(report);
  process.stdout.write(`[delivery-full] overall=${report.status} localCodeDefects=${report.localVerdict.localCodeDefectCount} externalBlockers=${report.localVerdict.externalBlockerCount}\n`);
  process.stdout.write(`[delivery-full] report=${artifacts.latestMarkdown}\n`);
  return report;
}

function runStep(step) {
  if (step.verifyManagedPortsStopped) return runManagedPortsStopStep(step);
  const startedAt = Date.now();
  const executed = spawnSync(step.command, step.args, {
    cwd: desktopRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: step.id === "release.gate" ? 700_000 : 300_000,
  });
  return summarizeStepResult(step, executed, Date.now() - startedAt);
}

function runManagedPortsStopStep(step) {
  const startedAt = Date.now();
  let lastResult = null;
  const maxAttempts = Number.isInteger(step.maxAttempts) ? step.maxAttempts : 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    writeSupervisorStopRequests();
    disableRuntimeSupervisorCommands();
    const executed = spawnSync(step.command, step.args, {
      cwd: desktopRoot,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", FORCE_PORTS_SWEEP: "1" },
      timeout: 90_000,
    });
    sleepSync(1500);
    let stopState = collectManagedStopState();
    if (!stopState.clear) {
      terminateManagedProcesses(stopState.managedProcesses);
      sleepSync(1500);
      stopState = collectManagedStopState();
    }
    const result = summarizeStepResult(step, executed, Date.now() - startedAt);
    if (stopState.clear) {
      sleepSync(3000);
      const stableStopState = collectManagedStopState();
      if (!stableStopState.clear) {
        stopState = stableStopState;
      } else {
        stopState = stableStopState;
      }
    }
    if (stopState.clear) {
      return {
        ...result,
        status: STATUS.PASS,
        durationMs: Date.now() - startedAt,
        summary: `managed ports and keep-alive processes stopped after ${attempt} attempt(s)`,
        evidence: stopState,
      };
    }
    lastResult = {
      ...result,
      status: STATUS.FAIL,
      durationMs: Date.now() - startedAt,
      summary: `${stopState.summary}; attempt ${attempt}/${maxAttempts}`,
      evidence: stopState,
    };
    sleepSync(1000);
  }
  return lastResult || {
    id: step.id,
    title: step.title,
    status: STATUS.FAIL,
    expectedBlocked: step.expectedBlocked,
    safetyClass: step.safetyClass,
    command: [step.command, ...step.args].join(" "),
    exitCode: null,
    signal: "",
    durationMs: Date.now() - startedAt,
    reportPath: "",
    summary: "managed port stop did not execute",
  };
}

function summarizeStepResult(step, executed, durationMs) {
  const reportPath = typeof step.reportPathResolver === "function" ? step.reportPathResolver() : step.reportPath;
  const report = readJson(reportPath);
  const reportStatus = deriveReportStatus(report);
  const exitCode = typeof executed.status === "number" ? executed.status : null;
  const status = summarizeCommandStatus(exitCode, executed.error, reportStatus);
  return {
    id: step.id,
    title: step.title,
    status,
    expectedBlocked: step.expectedBlocked,
    safetyClass: step.safetyClass,
    command: [step.command, ...step.args].join(" "),
    exitCode,
    signal: executed.signal || "",
    durationMs,
    reportPath: relativeToDesktop(reportPath),
    summary: report ? reportSummary(report) : commandSummary(executed),
  };
}

function collectManagedStopState() {
  const portOwners = listManagedPortOwners();
  const managedProcesses = mergeManagedProcesses([
    ...readKeepAliveManagedProcesses(),
    ...listManagedRuntimeProcesses(),
    ...portOwners.map((item) => managedPortOwnerForPid(item)).filter(Boolean),
  ]);
  const summaryParts = [];
  if (portOwners.length) {
    summaryParts.push(`ports still occupied: ${portOwners.map((item) => `${item.port}/pid=${item.pid}`).join(", ")}`);
  }
  if (managedProcesses.length) {
    summaryParts.push(`managed runtime processes still running: ${managedProcesses.map((item) => `pid=${item.pid}`).join(", ")}`);
  }
  return {
    clear: portOwners.length === 0 && managedProcesses.length === 0,
    portOwners,
    keepAliveProcesses: managedProcesses,
    managedProcesses,
    summary: summaryParts.join("; ") || "managed ports are stopped",
  };
}

function readKeepAliveManagedProcesses() {
  const heartbeat = readJson(path.join(runtimeRoot, "keep-alive.json"));
  const pid = String(heartbeat?.pid || "");
  if (!/^\d+$/.test(pid)) return [];
  if (!processExists(pid)) return [];
  return [{
    pid,
    commandLine: truncateText(`keep-alive heartbeat pid=${pid} mode=${heartbeat?.mode || "unknown"}`, 160),
    source: "keep-alive-heartbeat",
  }];
}

function processExists(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function mergeManagedProcesses(processes) {
  const seen = new Set();
  const merged = [];
  for (const item of processes || []) {
    const pid = String(item?.pid || "");
    if (!/^\d+$/.test(pid) || seen.has(pid)) continue;
    seen.add(pid);
    merged.push(item);
  }
  return merged;
}

function listManagedPortOwners() {
  return [3100, 3200, 3700].flatMap((port) => getPortOwnerPids(port).map((pid) => ({ port, pid })));
}

function getPortOwnerPids(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !result.stdout) return [];
  const suffix = `:${port}`;
  const pids = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (String(parts[0]).toUpperCase() !== "TCP") continue;
    if (!String(parts[1] || "").endsWith(suffix)) continue;
    if (!/LISTENING/i.test(String(parts[3] || ""))) continue;
    const pid = String(parts[4] || "");
    if (/^\d+$/.test(pid) && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

function listManagedRuntimeProcesses() {
  if (process.platform !== "win32") return [];
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name = 'node.exe' OR name = 'cmd.exe' OR name = 'powershell.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const normalizedRoot = normalizePathText(desktopRoot);
  return (Array.isArray(rows) ? rows : [rows])
    .map((item) => ({ pid: String(item?.ProcessId || ""), commandLine: String(item?.CommandLine || "") }))
    .filter((item) => /^\d+$/.test(item.pid) && item.pid !== String(process.pid))
    .filter((item) => {
      const commandLine = normalizePathText(item.commandLine);
      return isManagedRuntimeCommandLine(commandLine, normalizedRoot);
    })
    .map((item) => ({
      pid: item.pid,
      commandLine: truncateText(item.commandLine, 160),
    }));
}

function managedProcessForPid(pid) {
  const commandLine = readProcessCommandLine(pid);
  if (!commandLine) return null;
  if (!isManagedRuntimeCommandLine(normalizePathText(commandLine), normalizePathText(desktopRoot))) return null;
  return { pid: String(pid), commandLine: truncateText(commandLine, 160) };
}

function managedPortOwnerForPid(owner) {
  const pid = String(owner?.pid || "");
  if (!/^\d+$/.test(pid)) return null;
  const commandLine = readProcessCommandLine(pid);
  const normalizedCommand = normalizePathText(commandLine);
  const normalizedRoot = normalizePathText(desktopRoot);
  if (commandLine && isManagedRuntimeCommandLine(normalizedCommand, normalizedRoot)) {
    return { pid, port: owner.port, commandLine: truncateText(commandLine, 160), source: "managed-port-owner" };
  }
  if (commandLine && !/node(?:\.exe)?|next|nestjs|mock-design-platform|server\.js/i.test(commandLine)) return null;
  return {
    pid,
    port: owner.port,
    commandLine: truncateText(commandLine || `unreadable command line for managed port ${owner.port}`, 160),
    source: "managed-port-owner",
  };
}

function readProcessCommandLine(pid) {
  if (process.platform !== "win32" || !/^\d+$/.test(String(pid || ""))) return "";
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function isManagedRuntimeCommandLine(commandLine, normalizedRoot) {
  const belongsToDesktop = commandLine.includes(normalizedRoot);
  const relativeKeepAlive = commandLine.includes("tools/start-dev-ports.js") && commandLine.includes("--keep-alive");
  if (!belongsToDesktop && !relativeKeepAlive) return false;
  return (
    relativeKeepAlive ||
    (commandLine.includes("tools/desktop-service-supervisor.js") && commandLine.includes("--supervisor-child")) ||
    commandLine.includes("node_modules/next/dist/bin/next dev apps/web") ||
    commandLine.includes("node_modules/next/dist/server/lib/start-server.js") ||
    commandLine.includes("tools/mock-design-platform.js") ||
    commandLine.includes("dist/apps/api/main.js") ||
    commandLine.includes(".runtime/web-standalone-server.js") ||
    commandLine.includes(".runtime/supervise-mock.cmd") ||
    commandLine.includes(".runtime/supervise-real.cmd") ||
    commandLine.includes(".runtime/launch-mock.cmd") ||
    commandLine.includes(".runtime/launch-real.cmd")
  );
}

function terminateManagedProcesses(processes) {
  if (process.platform !== "win32") return;
  const pids = [...new Set((processes || []).map((item) => String(item?.pid || "")).filter((pid) => /^\d+$/.test(pid)))];
  for (const pid of pids) {
    if (pid === String(process.pid)) continue;
    terminateProcessTree(pid);
  }
}

function terminateProcessTree(pid) {
  const taskkill = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
  if (taskkill.status === 0) return true;
  const powershell = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return powershell.status === 0;
}

function writeSupervisorStopRequests() {
  const value = `${new Date().toISOString()}\n`;
  for (const name of ["desktop-supervisor-stop-request", "stable-runtime-stop-request"]) {
    try {
      fs.mkdirSync(runtimeRoot, { recursive: true });
      fs.writeFileSync(path.join(runtimeRoot, name), value, "utf8");
    } catch {
      // The underlying ports:stop command will report any remaining process state.
    }
  }
}

function disableRuntimeSupervisorCommands() {
  for (const name of ["launch-mock.cmd", "supervise-mock.cmd", "stable-supervise-mock.cmd", "launch-real.cmd", "supervise-real.cmd", "stable-supervise-real.cmd"]) {
    const filePath = path.join(runtimeRoot, name);
    try {
      if (!fs.existsSync(filePath)) continue;
      fs.writeFileSync(filePath, "@echo off\r\nexit /b 0\r\n", "utf8");
    } catch {
      // Generated launcher files are best-effort guards; process checks remain authoritative.
    }
  }
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function summarizeCommandStatus(exitCode, error, reportStatus) {
  if (error) return STATUS.FAIL;
  if (exitCode === 0) return reportStatus || STATUS.PASS;
  if (exitCode === EXIT_CODE.BLOCKED) return reportStatus === STATUS.FAIL ? STATUS.FAIL : STATUS.BLOCKED;
  return STATUS.FAIL;
}

function normalizeReportStatus(value) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, value) ? value : "";
}

function deriveReportStatus(report) {
  const direct = normalizeReportStatus(report?.status);
  if (direct) return direct;
  const fail = Number(report?.summary?.fail ?? report?.summary?.failed ?? report?.counts?.FAIL ?? 0);
  if (fail > 0) return STATUS.FAIL;
  const blocked = Number(report?.summary?.blocked ?? report?.counts?.BLOCKED ?? 0);
  if (blocked > 0) return STATUS.BLOCKED;
  const pass = Number(report?.summary?.pass ?? report?.summary?.passed ?? report?.counts?.PASS ?? 0);
  const total = Number(report?.summary?.total ?? report?.counts?.total ?? 0);
  return pass > 0 || total > 0 ? STATUS.PASS : "";
}

function reportSummary(report) {
  if (report?.localDeliveryVerdict?.summary) return String(report.localDeliveryVerdict.summary);
  if (report?.completionVerdict?.summary) return String(report.completionVerdict.summary);
  if (report?.summary && typeof report.summary === "object") {
    const pass = report.summary.pass ?? report.summary.passed ?? report.counts?.PASS ?? "-";
    const blocked = report.summary.blocked ?? report.counts?.BLOCKED ?? "-";
    const fail = report.summary.fail ?? report.summary.failed ?? report.counts?.FAIL ?? "-";
    return `pass=${pass} blocked=${blocked} fail=${fail}`;
  }
  return `status=${report.status || "unknown"}`;
}

function commandSummary(executed) {
  if (executed.error) return executed.error.message;
  if (executed.status === 0) return "command passed";
  return `command exited with code ${executed.status ?? "unknown"}`;
}

function createAutomationReport(options, plannedSteps, stepResults) {
  const reports = readCurrentReports();
  const localVerdict = buildLocalVerdict(reports);
  const status = computeAutomationStatus(stepResults, localVerdict);
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    runId: `delivery-full-${generatedAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${process.pid}`,
    status,
    mode: {
      executeStagingReadiness: options.executeStagingReadiness === true,
      executeDatabaseRecovery: options.executeDatabaseRecovery === true,
      validateExternalEvidence: options.validateExternalEvidence === true,
      releaseGateSkipped: options.skipReleaseGate === true,
      restartMock: options.restartMock !== false,
    },
    safety: {
      realMessageSendAttempted: false,
      paymentMutationAttempted: false,
      externalPaymentMutationAttempted: false,
      designJobSubmitted: false,
      databaseRecoveryExecuted: options.executeDatabaseRecovery === true,
      stagingReadOnlyExecuteRequested: options.executeStagingReadiness === true,
      secretsIncluded: false,
    },
    summary: {
      planned: plannedSteps.length,
      executed: stepResults.length,
      pass: stepResults.filter((item) => item.status === STATUS.PASS).length,
      blocked: stepResults.filter((item) => item.status === STATUS.BLOCKED).length,
      fail: stepResults.filter((item) => item.status === STATUS.FAIL).length,
    },
    localVerdict,
    reports: summarizeReports(reports),
    steps: stepResults,
    nextExternalCommands: buildNextExternalCommands(),
  };
}

function computeAutomationStatus(stepResults, localVerdict) {
  if (stepResults.some((item) => item.status === STATUS.FAIL) || localVerdict.localCodeDefectCount > 0) return STATUS.FAIL;
  if (stepResults.some((item) => item.status === STATUS.BLOCKED) || localVerdict.externalBlockerCount > 0 || localVerdict.releaseScopeFrozen === false) return STATUS.BLOCKED;
  return STATUS.PASS;
}

function readCurrentReports() {
  return {
    projectAudit: readJson(path.join(runtimeRoot, "project-completion-audit", "latest.json")),
    acceptance: readJson(latestAcceptanceReportPath()),
    releaseGate: readJson(path.join(runtimeRoot, "production-release-gate", "latest.json")),
    handoff: readJson(path.join(runtimeRoot, "delivery-handoff", "latest.json")),
    freezePlan: readJson(path.join(runtimeRoot, "release-candidate-freeze-plan", "latest.json")),
    staging: readJson(path.join(runtimeRoot, "staging-readiness-evidence", "latest.json")),
    databaseRecovery: readJson(path.join(runtimeRoot, "database-recovery-rehearsal", "latest.json")),
    windowsPackage: readJson(path.join(runtimeRoot, "windows-package-verification", "latest.json")),
  };
}

function buildLocalVerdict(reports) {
  const handoffVerdict = reports.handoff?.localDeliveryVerdict || {};
  const projectVerdict = reports.projectAudit?.completionVerdict || {};
  const releaseFailures = Array.isArray(reports.releaseGate?.results)
    ? reports.releaseGate.results.filter((item) => item?.status === STATUS.FAIL)
    : [];
  const acceptanceFailures = Number(reports.acceptance?.summary?.failed || 0);
  const safetyViolations = Array.isArray(reports.acceptance?.safety?.actual?.safetyViolations)
    ? reports.acceptance.safety.actual.safetyViolations.length
    : 0;
  const localCodeDefectCount = Number(handoffVerdict.localCodeDefectCount ?? projectVerdict.localCodeDefectCount ?? 0)
    + releaseFailures.length
    + acceptanceFailures
    + safetyViolations;
  const externalBlockerIds = Array.isArray(handoffVerdict.externalBlockerIds)
    ? handoffVerdict.externalBlockerIds.map(String)
    : Array.isArray(projectVerdict.externalBlockerIds) ? projectVerdict.externalBlockerIds.map(String) : [];
  return {
    state: String(handoffVerdict.state || projectVerdict.state || "unknown"),
    localEvidenceReady: handoffVerdict.localEvidenceReady === true || projectVerdict.localCodeDefectCount === 0,
    releaseScopeFrozen: reports.freezePlan?.localDeliveryVerdict?.releaseScopeFrozen === true,
    productionReleaseAllowed: handoffVerdict.productionReleaseAllowed === true,
    localCodeDefectCount,
    externalBlockerCount: Number(handoffVerdict.externalBlockerCount ?? projectVerdict.externalBlockerCount ?? externalBlockerIds.length),
    externalBlockerIds,
  };
}

function summarizeReports(reports) {
  return Object.entries(reports).map(([id, report]) => ({
    id,
    status: deriveReportStatus(report) || "MISSING",
    generatedAt: String(report?.generatedAt || report?.finishedAt || ""),
    summary: report ? reportSummary(report) : "report missing",
  }));
}

function buildNextExternalCommands() {
  return [
    {
      id: "staging.read_only_execute",
      command: "npm.cmd run delivery:full -- --execute-staging-readiness",
      requiredBeforeRun: ["staging API URL/secrets", "Prisma PostgreSQL", "Redis durable automation", "public HTTPS base URL"],
    },
    {
      id: "database.recovery_execute",
      command: "npm.cmd run delivery:full -- --execute-database-recovery --database-confirm \"RESTORE ISOLATED REHEARSAL DATABASE: <database>\"",
      requiredBeforeRun: ["DATABASE_RECOVERY_REHEARSAL_URL must target an isolated rehearsal/sandbox database", "operator confirmation phrase bound to the target database"],
    },
    {
      id: "external.evidence_bundle",
      command: "npm.cmd run delivery:full -- --evidence-root <dir> --staging-report <json> --recovery-report <json> --windows-report <json>",
      requiredBeforeRun: ["read-only staging PASS report", "database recovery execute report", "signed Windows package verification report"],
    },
  ];
}

function latestAcceptanceReportPath(root = path.join(runtimeRoot, "acceptance")) {
  if (!fs.existsSync(root)) return "";
  const matches = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name === "product-acceptance-report.json") {
        matches.push({ filePath: target, mtimeMs: fs.statSync(target).mtimeMs });
      }
    }
  }
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0]?.filePath || "";
}

function readJson(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function relativeToDesktop(filePath) {
  if (!filePath) return "";
  const relative = path.relative(desktopRoot, path.resolve(filePath));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, "/")
    : String(filePath).replace(/\\/g, "/");
}

function renderMarkdown(report) {
  const lines = [
    "# Delivery Full Automation",
    "",
    `- Status: **${report.status}**`,
    `- Generated: ${report.generatedAt}`,
    `- Local state: \`${report.localVerdict.state}\``,
    `- Local code defects: ${report.localVerdict.localCodeDefectCount}`,
    `- External blockers: ${report.localVerdict.externalBlockerCount}`,
    `- Release scope frozen: ${report.localVerdict.releaseScopeFrozen}`,
    `- Production release allowed: ${report.localVerdict.productionReleaseAllowed}`,
    "- Safety: default run does not send real messages, mutate external payments, submit design jobs, or execute database recovery.",
    "",
    "## Steps",
    "",
    "| Status | Step | Summary |",
    "| --- | --- | --- |",
  ];
  for (const step of report.steps) lines.push(`| ${step.status} | ${escapeMarkdown(step.title)} | ${escapeMarkdown(step.summary)} |`);
  lines.push("", "## Reports", "", "| Status | Report | Summary |", "| --- | --- | --- |");
  for (const item of report.reports) lines.push(`| ${item.status} | ${escapeMarkdown(item.id)} | ${escapeMarkdown(item.summary)} |`);
  lines.push("", "## External Commands", "");
  for (const item of report.nextExternalCommands) {
    lines.push(`- ${item.id}: \`${item.command}\``);
  }
  return `${lines.join("\n")}\n`;
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function writeReports(report, root = reportRoot) {
  fs.mkdirSync(root, { recursive: true });
  const runDirectory = path.join(root, "runs", report.runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  const latestJson = path.join(root, "latest.json");
  const latestMarkdown = path.join(root, "latest.md");
  fs.writeFileSync(path.join(runDirectory, "report.json"), json, "utf8");
  fs.writeFileSync(path.join(runDirectory, "report.md"), markdown, "utf8");
  fs.writeFileSync(latestJson, json, "utf8");
  fs.writeFileSync(latestMarkdown, markdown, "utf8");
  return { latestJson, latestMarkdown, runDirectory };
}

function printHelp() {
  console.log(`Usage: node tools/delivery-full-automation.js [options]

Default mode runs the local/offline delivery chain, coordinates ports around
release gate, refreshes handoff/freeze reports, and restarts the local mock
stack. It may finish BLOCKED when external proof or release-scope freezing is
still required.

Options:
  --execute-staging-readiness     run the staging readiness tool in read-only execute mode
  --execute-database-recovery     run guarded isolated database recovery rehearsal
  --database-confirm <phrase>     confirmation required with --execute-database-recovery
  --evidence-root <dir>           validate an existing external evidence bundle root
  --staging-report <json>         staging report path inside evidence root
  --recovery-report <json>        database recovery report path inside evidence root
  --windows-report <json>         Windows verification report path inside evidence root
  --no-restart-mock               leave the local mock stack stopped after release gate
  --skip-release-gate             skip production release gate during fast local iteration`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const report = runDeliveryAutomation(options);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[delivery-full] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = EXIT_CODE.FAIL;
  }
}

module.exports = {
  EXIT_CODE,
  SCHEMA_VERSION,
  STATUS,
  buildDeliveryAutomationPlan,
  buildLocalVerdict,
  collectManagedStopState,
  createAutomationReport,
  latestAcceptanceReportPath,
  listManagedRuntimeProcesses,
  parseArgs,
  renderMarkdown,
  summarizeStepResult,
  writeReports,
};
