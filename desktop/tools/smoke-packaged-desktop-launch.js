"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { validateApiHealthResponse } = require("../apps/electron/packaged-runtime");
const { requestUrl } = require("./smoke-packaged-api");
const {
  cleanupPrivateTemp,
  createPrivateTemp,
  selectEvidenceProcessEnvironment,
  terminateProcessTree,
} = require("./windows-evidence-chain");

const root = path.resolve(__dirname, "..");
const outputDir = path.resolve(process.env.PACKAGED_DESKTOP_SMOKE_OUTPUT_DIR || path.join(root, "release", "windows"));
const executable = path.join(outputDir, "win-unpacked", "Smart Kefu.exe");
const reportFile = path.resolve(
  process.env.PACKAGED_DESKTOP_SMOKE_REPORT_FILE
    || path.join(outputDir, "verification", "packaged-desktop-launch-smoke.json"),
);
const DEFAULT_API_PORT = 3200;
const DEFAULT_WEB_PORT = 3100;
const MAX_CAPTURE_BYTES = 256 * 1024;

if (require.main === module) {
  main().catch((error) => {
    writeReport({ status: "FAIL", error: String(error?.message || error) });
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main() {
  if (process.platform !== "win32") throw new Error("packaged desktop launch smoke requires Windows");
  if (!fs.existsSync(executable)) throw new Error(`packaged desktop executable is missing: ${executable}`);

  const smokeTemp = createPrivateTemp("smart-kefu-packaged-smoke-");
  const userDataPath = path.join(smokeTemp.tempRoot, "user-data");
  const runtimeLockPath = path.join(smokeTemp.tempRoot, "electron-runtime");
  const statusFile = path.join(userDataPath, "runtime", "packaged-runtime-status.json");
  fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });

  const blockers = [];
  let desktop = null;
  let runtimeStatus = null;
  try {
    blockers.push(await makePortUnavailable(DEFAULT_WEB_PORT));
    blockers.push(await makePortUnavailable(DEFAULT_API_PORT));

    desktop = spawn(executable, [`--user-data-dir=${userDataPath}`], {
      cwd: path.dirname(executable),
      env: selectDesktopLaunchEnvironment({
        DESKTOP_INSTANCE_ID: "package-launch-smoke",
        DESKTOP_RUNTIME_DIR: runtimeLockPath,
      }, path.join(smokeTemp.tempRoot, "process-environment")),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    captureOutput(desktop);

    runtimeStatus = await waitForRuntimeReady(statusFile, desktop, 90_000);
    assertDynamicEndpoints(runtimeStatus);

    const overview = await requestUrl(runtimeStatus.webOverviewUrl);
    if (overview.statusCode !== 200) {
      throw new Error(`desktop-launched overview returned ${overview.statusCode}, expected 200`);
    }
    const proxyHealth = await requestUrl(runtimeStatus.proxyHealthUrl);
    const proxyBody = parseJson(proxyHealth.body);
    if (proxyHealth.statusCode !== 403 || proxyBody?.code !== "desktop_session_proof_missing") {
      throw new Error(`desktop-launched Web API proxy did not fail closed without Electron proof (${proxyHealth.statusCode})`);
    }
    const apiHealth = await requestUrl(runtimeStatus.apiHealthUrl);
    if (apiHealth.statusCode !== 200 || !validateApiHealthResponse(apiHealth)) {
      throw new Error(`desktop-launched API health was not ready (${apiHealth.statusCode})`);
    }
    const companyProfileResponse = await requestUrl(
      new URL("/api/company-profile", runtimeStatus.apiHealthUrl).toString(),
    );
    const companyProfile = parseJson(companyProfileResponse.body);
    if (
      companyProfileResponse.statusCode !== 200
      || companyProfile?.organization?.displayName !== "臻希礼业"
      || companyProfile?.wechatWork?.accountDisplayName !== "禮想礼品"
      || companyProfile?.workspace?.ownership !== "company"
      || companyProfile?.runtimeBinding?.credentialsEmbedded !== false
    ) {
      throw new Error(`desktop-launched company profile was not bound safely (${companyProfileResponse.statusCode})`);
    }

    await delay(1_500);
    if (desktop.exitCode !== null) throw new Error(`desktop process exited after readiness with code ${desktop.exitCode}`);

    const report = {
      status: "PASS",
      executable,
      desktopPid: desktop.pid,
      servicePids: runtimeStatus.servicePids,
      ports: { api: runtimeStatus.apiPort, web: runtimeStatus.webPort },
      defaultPortConditions: blockers.map(({ port, mode }) => ({ port, mode })),
      overview: { statusCode: overview.statusCode },
      companyProfile: { statusCode: companyProfileResponse.statusCode, organization: companyProfile.organization.displayName },
      proxyHealth: { statusCode: proxyHealth.statusCode, mode: "external_no_cookie_fail_closed" },
      apiHealth: { statusCode: apiHealth.statusCode, mode: "public_readiness_without_internal_token" },
      processStayedAliveAfterReadiness: true,
      userData: "isolated temporary directory",
    };
    writeReport(report);
    console.log(
      `[PASS] packaged desktop launched with defaults unavailable: API=${runtimeStatus.apiPort}, Web=${runtimeStatus.webPort}`,
    );
    return report;
  } catch (error) {
    const output = desktop
      ? ` stdout=${redact(desktop.stdoutText)} stderr=${redact(desktop.stderrText)}`
      : "";
    throw new Error(`${error.message}${output}`);
  } finally {
    await stopKnownProcesses(runtimeStatus, desktop);
    await Promise.allSettled(blockers.map((blocker) => blocker.release()));
    cleanupPrivateTemp(smokeTemp);
  }
}

function selectDesktopLaunchEnvironment(overrides, privateRoot) {
  const selected = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (isSensitiveDesktopEnvironmentKey(key)) continue;
    selected[key] = value;
  }
  const isolated = selectEvidenceProcessEnvironment({}, privateRoot);
  selected.TEMP = isolated.TEMP;
  selected.TMP = isolated.TMP;
  return { ...selected, ...overrides };
}

function isSensitiveDesktopEnvironmentKey(key) {
  return /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|DATABASE_URL|REDIS_URL|WECHAT|ZHENXI|OPENAI|ANTHROPIC|AZURE|AWS|GITHUB|GITLAB|SENTRY|SMTP|COOKIE|SESSION|AUTH|CSC_LINK|WIN_CSC|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|DESKTOP_|INTERNAL_API|WEB_URL|API_PORT|WEB_PORT|^PORT$)/i.test(String(key || ""));
}

function makePortUnavailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        finish(resolve, { port, mode: "preexisting_listener", release: async () => {} });
      } else {
        finish(reject, error);
      }
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      finish(resolve, {
        port,
        mode: "test_reservation",
        release: () => new Promise((releaseResolve) => server.close(() => releaseResolve())),
      });
    });
  });
}

function waitForRuntimeReady(statusFile, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (child.exitCode !== null) return reject(new Error(`desktop process exited with code ${child.exitCode}`));
      const status = readJson(statusFile);
      if (status?.status === "failed") return reject(new Error(`packaged runtime reported failure: ${status.error || "unknown error"}`));
      if (status?.status === "ready") return resolve(status);
      if (Date.now() >= deadline) return reject(new Error("timed out waiting for the packaged desktop runtime"));
      setTimeout(inspect, 200);
    };
    inspect();
  });
}

function assertDynamicEndpoints(status) {
  if (status?.schemaVersion !== "smart_kefu_packaged_runtime_status_v1") {
    throw new Error("packaged desktop runtime status schema is missing or invalid");
  }
  const apiPort = Number(status.apiPort);
  const webPort = Number(status.webPort);
  if (!Number.isInteger(apiPort) || !Number.isInteger(webPort) || apiPort <= 0 || webPort <= 0) {
    throw new Error("packaged desktop did not publish valid service ports");
  }
  if (apiPort === webPort || apiPort === DEFAULT_API_PORT || apiPort === DEFAULT_WEB_PORT
    || webPort === DEFAULT_API_PORT || webPort === DEFAULT_WEB_PORT) {
    throw new Error(`packaged desktop reused an unavailable default port: API=${apiPort}, Web=${webPort}`);
  }
  if (status.apiHealthUrl !== `http://127.0.0.1:${apiPort}/api/health`
    || status.webOverviewUrl !== `http://127.0.0.1:${webPort}/overview`
    || status.proxyHealthUrl !== `http://127.0.0.1:${webPort}/api/health`) {
    throw new Error("packaged desktop endpoint URLs do not match the selected ports");
  }
}

function captureOutput(child) {
  child.stdoutText = "";
  child.stderrText = "";
  let capturedBytes = 0;
  const capture = (target, chunk) => {
    capturedBytes += chunk.length;
    if (capturedBytes > MAX_CAPTURE_BYTES) return target;
    return `${target}${chunk}`.slice(-32_000);
  };
  child.stdout.on("data", (chunk) => { child.stdoutText = capture(child.stdoutText, chunk); });
  child.stderr.on("data", (chunk) => { child.stderrText = capture(child.stderrText, chunk); });
}

async function stopKnownProcesses(status, desktop) {
  const servicePids = Object.values(status?.servicePids || {})
    .map(Number)
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  for (const pid of servicePids.reverse()) {
    await terminateProcessTree({ pid }).catch(() => {});
  }
  if (desktop) await terminateProcessTree(desktop).catch(() => {});
}

function parseJson(value) {
  try {
    return JSON.parse(Buffer.from(value || "").toString("utf8"));
  } catch {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function redact(value) {
  return String(value || "")
    .replace(/[a-f0-9]{64}/gi, "[redacted-token]")
    .replace(/\s+/g, " ")
    .slice(-4000);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  assertDynamicEndpoints,
  isSensitiveDesktopEnvironmentKey,
  main,
  makePortUnavailable,
  selectDesktopLaunchEnvironment,
  waitForRuntimeReady,
};
