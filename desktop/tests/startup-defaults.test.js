const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("developer startup scripts default to the current design mode", () => {
  const pkg = JSON.parse(readText("package.json"));
  const smokeDevStack = readText("tools/smoke-dev-stack.js");
  const checkDevStartup = readText("tools/check-dev-startup.js");
  assert.equal(pkg.scripts["ports:start"], "node tools/ports-stack-starter.js");
  assert.equal(pkg.scripts["ports:start:mock"], "node tools/ports-stack-starter.js --mock-design");
  assert.equal(pkg.scripts["ports:start:real"], "node tools/ports-stack-starter.js --real-design");
  assert.equal(pkg.scripts["ports:once"], "node tools/start-dev-ports.js");
  assert.equal(pkg.scripts["ports:once:mock"], "node tools/start-dev-ports.js --mock-design");
  assert.equal(pkg.scripts["ports:once:real"], "node tools/start-dev-ports.js --real-design");
  assert.equal(pkg.scripts["ports:status"], "node tools/start-dev-ports.js --status");
  assert.equal(pkg.scripts["ports:preflight"], "node tools/start-dev-ports.js --mock-design --preflight");
  assert.equal(pkg.scripts["ports:doctor"], "node tools/check-dev-startup.js --mock-design");
  assert.equal(pkg.scripts["ports:launch"], "node tools/ports-stack-starter.js");
  assert.equal(pkg.scripts["ports:launch:mock"], "node tools/ports-stack-starter.js --mock-design");
  assert.equal(pkg.scripts["ports:launch:real"], "node tools/ports-stack-starter.js --real-design");
  assert.equal(
    pkg.scripts["ports:launch:real:confirmed"],
    "set ALLOW_REAL_DESIGN_LAUNCH=1&& set CONFIRM_REAL_DESIGN_SWITCH=1&& node tools/ports-stack-starter.js --real-design",
  );
  assert.equal(
    pkg.scripts["ports:keepalive:real:confirmed"],
    "set ALLOW_REAL_DESIGN_LAUNCH=1&& set ALLOW_REAL_DESIGN_START=1&& set CONFIRM_REAL_DESIGN_SWITCH=1&& node tools/start-dev-ports.js --real-design --keep-alive",
  );
  assert.equal(pkg.scripts["ports:status:real"], "node tools/start-dev-ports.js --real-design --status");
  assert.match(pkg.scripts["dev:web"], /--webpack/);
  assert.match(pkg.scripts["dev:stack"], /--webpack/);
  assert.match(pkg.scripts["dev:stack:real"], /--webpack/);
  assert.equal(pkg.scripts["build:web"], "node tools/build-web.js");
  assert.equal(pkg.scripts["release:gate"], "node tools/production-release-gate.js");
  assert.equal(pkg.scripts["release:gate:isolated"], "node tools/production-release-gate.js --isolated-worktree");
  assert.equal(pkg.scripts["wechat:bridge:once"], "node tools/wechat-bridge-worker.js --once");
  assert.equal(pkg.scripts["wechat:bridge:watch"], "node tools/wechat-bridge-worker.js --watch");
  assert.equal(pkg.scripts["wechat:bridge:dispatch"], "node tools/wechat-bridge-worker.js --once --mode dispatch");
  assert.equal(pkg.scripts["wechat:bridge:dispatch:watch"], "node tools/wechat-bridge-worker.js --watch --mode dispatch");
  assert.equal(pkg.scripts["wechat:safe:start"], "node tools/start-wechat-safe-workers.js");
  assert.equal(pkg.scripts["wechat:safe:dispatch:start"], "node tools/start-wechat-safe-workers.js --dispatch");
  assert.equal(pkg.scripts["wechat:safe:status"], "node tools/start-wechat-safe-workers.js --status");
  assert.equal(pkg.scripts["wechat:safe:stop"], "node tools/start-wechat-safe-workers.js --stop");
  assert.doesNotMatch(pkg.scripts["ports:start"], /wechat/i);
  assert.match(pkg.scripts["dev:stack:real"], /start-dev-ports\.js --real-design --preflight/);
  assert.match(pkg.scripts["dev:stack:real"], /concurrently -k -n web,api/);
  assert.match(smokeDevStack, /url: `http:\/\/127\.0\.0\.1:\$\{webPort\}\/`/);
  assert.match(smokeDevStack, /"dev", "apps\/web", "-p", String\(webPort\), "--hostname", "127\.0\.0\.1"/);
  assert.match(checkDevStartup, /const wechatSnapshotsUrl = `http:\/\/127\.0\.0\.1:\$\{apiPort\}\/api\/wechat\/window-snapshots`;/);
  assert.match(checkDevStartup, /readWechatWindowObserverProofToken/);
  assert.match(checkDevStartup, /if \(url !== wechatSnapshotsUrl\) return \{\};/);
  assert.match(checkDevStartup, /"x-wechat-window-observer-token": readWechatWindowObserverProofToken\(observerProofFile\)/);
  assert.doesNotMatch(checkDevStartup, /createWechatWindowObserverProofSession|ensureWechatWindowObserverProofSession/);
  assert.match(checkDevStartup, /MAX_WECHAT_SNAPSHOT_LATENCY_MS/);
  assert.match(checkDevStartup, /function printWechatWorkerProcesses\(\)/);
  assert.match(checkDevStartup, /function findKeepAliveSupervisorProcesses\(\)/);
  assert.match(checkDevStartup, /const keepAliveHeartbeatFile = path\.join\(runtimeDir, "keep-alive\.json"\);/);
  assert.match(checkDevStartup, /const stableRuntimeDir = path\.join\(desktopRoot, "\.runtime-stable"\);/);
  assert.match(checkDevStartup, /const stableKeepAliveHeartbeatFile = path\.join\(stableRuntimeDir, "keep-alive\.json"\);/);
  assert.match(checkDevStartup, /waitForKeepAliveSupervisorProcesses\(45, 1000\)/);
  assert.match(checkDevStartup, /async function waitForKeepAliveSupervisorProcesses\(attempts, delayMs\)/);
  assert.match(checkDevStartup, /function findStableRuntimeHeartbeatProcess\(\)/);
  assert.match(checkDevStartup, /findStableRuntimeHeartbeatProcess\(\)/);
  assert.match(checkDevStartup, /tools\/stable-runtime-launcher\.js/);
  assert.match(checkDevStartup, /function findKeepAliveHeartbeatProcess\(\)/);
  assert.match(checkDevStartup, /Date\.now\(\) - updatedAt > 30_000/);
  assert.match(checkDevStartup, /Keep-alive supervisor/);
  assert.match(checkDevStartup, /ports:repair so the app is started and supervised/);
  assert.match(checkDevStartup, /tools\/wechat-window-observer\.js/);
  assert.match(readText("apps/api/src/shared/app-config.ts"), /wechatBridgeDispatchDir: path\.resolve\(process\.env\.WECHAT_BRIDGE_DISPATCH_DIR \|\| runtimePath\("wechat-dispatch"\)\)/);
  const stableDoctor = readText("tools/stable-desktop-doctor.js");
  assert.match(stableDoctor, /path\.join\(desktopRoot, "\.runtime-stable"\)/);
  assert.match(stableDoctor, /repair-stable-desktop\.cmd/);
  assert.match(stableDoctor, /start-stable-desktop-foreground\.cmd/);
  assert.match(stableDoctor, /stop-stable-desktop\.cmd/);
  assert.match(stableDoctor, /const webStandaloneServerPath = path\.join\(desktopRoot, "apps", "web", "\.next", "standalone", "apps", "web", "server\.js"\)/);
  assert.match(stableDoctor, /const wechatBridgeWorkerStatusFile = path\.join\(runtimeDir, "wechat-bridge-worker-status\.json"\)/);
  assert.match(stableDoctor, /const wechatWindowObserverStatusFile = path\.join\(runtimeDir, "wechat-window-observer-status\.json"\)/);
  assert.match(stableDoctor, /stableRuntimeLauncherFromHeartbeat\(\)/);
  assert.match(stableDoctor, /fs\.readFileSync\(keepAliveHeartbeatFile, "utf8"\)/);
  assert.match(stableDoctor, /const heartbeatIsFresh = Number\.isFinite\(ageMs\) && ageMs <= 30000;/);
  assert.match(stableDoctor, /heartbeatIsFresh && processIsRunning\(pid\)/);
  assert.match(stableDoctor, /severity: ok \? undefined : "warn"/);
  assert.match(stableDoctor, /return \{ ok: true, severity: "warn", label, detail:/);
  assert.doesNotMatch(stableDoctor, /readFileSync\(heartbeatFile/);
  assert.match(stableDoctor, /const nextCliPath = path\.join\(desktopRoot, "node_modules", "next", "dist", "bin", "next"\)/);
  assert.match(stableDoctor, /const nextStartServerPath = path\.join\(desktopRoot, "node_modules", "next", "dist", "server", "lib", "start-server\.js"\)/);
  assert.match(stableDoctor, /function checkWebStartable\(\)/);
  assert.match(stableDoctor, /checkWechatWorkerStatus\("WeChat bridge worker", wechatBridgeWorkerStatusFile, "tools\/wechat-bridge-worker\.js"/);
  assert.match(stableDoctor, /mode === "noop" \|\| mode === "dispatch"/);
  assert.match(stableDoctor, /checkWechatWorkerStatus\("WeChat window observer", wechatWindowObserverStatusFile, "tools\/wechat-window-observer\.js"\)/);
  assert.match(stableDoctor, /function checkWechatWorkerStatus\(label, statusFile, commandMarker/);
  assert.match(stableDoctor, /standalone build missing; Next dev fallback available/);
  assert.match(stableDoctor, /expected = \[webRuntimeServerPath, nextCliPath, nextStartServerPath\]\.map\(normalizePathText\)/);
  assert.match(stableDoctor, /path\.join\(report\.runtimeDir, "logs"\)/);
  assert.match(stableDoctor, /missingPorts/);
  assert.match(stableDoctor, /service ports are not ready/);
  assert.match(stableDoctor, /heartbeat unavailable and service ports are not ready/);
  assert.match(stableDoctor, /stale or wrong heartbeat and service ports are not ready/);
  assert.match(stableDoctor, /function processIsRunning\(pid\)/);
  assert.match(stableDoctor, /fresh heartbeat pid=\$\{heartbeat\.pid\} is not running/);
  assert.match(stableDoctor, /function checkStaleScheduledTasks\(\)/);
  assert.match(stableDoctor, /path\.join\(process\.env\.SystemRoot \|\| "C:\\\\Windows", "System32", "Tasks", taskName\)/);
  assert.match(stableDoctor, /zhinengkefu_desktop_supervisor_keep_mock_4219d0b8/);
  assert.match(stableDoctor, /xml\.includes\("zhinengkefu_restore_work"\)/);
  assert.match(stableDoctor, /<Enabled>\\s\*true\\s\*<\\\/Enabled>/);
  assert.match(stableDoctor, /old desktop supervisor tasks are absent or disabled/);
  assert.match(stableDoctor, /function staleScheduledTaskXmlLooksEnabled\(taskName\)/);
  assert.match(stableDoctor, /function checkStaleRuntimeProcesses\(\)/);
  assert.match(stableDoctor, /function checkStableRuntimeVersion\(portOwners = new Map\(\)\)/);
  assert.match(stableDoctor, /old launcher process is still running/);
  assert.match(stableDoctor, /parsePowerShellJsonDate/);
  assert.match(stableDoctor, /function findStaleRuntimeProcesses\(\)/);
  assert.match(stableDoctor, /zhinengkefu_restore_work\|runtime-d-repo/);
  assert.match(stableDoctor, /old restore\/runtime-d-repo processes are not running/);
  assert.match(stableDoctor, /check\.severity === "warn" \? "\[warn\]" : check\.ok \? "\[ok\]" : "\[fail\]"/);
});

test("startup tools keep explicit design mode and preserve current real mode for raw starts", () => {
  const startDevPorts = readText("tools/start-dev-ports.js");
  const portsStackStarter = readText("tools/ports-stack-starter.js");
  const desktopServiceSupervisor = readText("tools/desktop-service-supervisor.js");
  const repairDevStartupSource = readText("tools/repair-dev-startup.js");
  assert.match(startDevPorts, /const requestedMockDesignMode = args\.has\("--mock-design"\);/);
  assert.match(startDevPorts, /const requestedRealDesignMode = args\.has\("--real-design"\);/);
  assert.match(startDevPorts, /main\(\)\.catch\(\(error\) => \{\s+logFatal\("main", error, \{ exit: false \}\);/);
  assert.match(startDevPorts, /stableDesktopGuardActive/);
  assert.match(startDevPorts, /stable desktop runtime is active; legacy start-dev-ports skipped/);
  assert.match(startDevPorts, /stableKeepAliveHeartbeatFile/);
  assert.match(
    startDevPorts,
    /process\.on\("uncaughtException", \(error\) => \{\s+if \(isBrokenPipeError\(error\)\) return;\s+logFatal\("uncaughtException", error\);/,
  );
  assert.match(
    startDevPorts,
    /process\.stdout\?\.on\?\.\("error", \(error\) => \{\s+if \(!isBrokenPipeError\(error\)\) logFatal\("stdout", error, \{ exit: false \}\);/,
  );
  assert.match(
    startDevPorts,
    /process\.stderr\?\.on\?\.\("error", \(error\) => \{\s+if \(!isBrokenPipeError\(error\)\) logFatal\("stderr", error, \{ exit: false \}\);/,
  );
  assert.match(
    startDevPorts,
    /function isBrokenPipeError\(error\) \{\s+return error && \(error\.code === "EPIPE" \|\| String\(error\.message \|\| ""\)\.includes\("EPIPE"\)\);/,
  );
  assert.match(startDevPorts, /const mockModeLockFile = path\.join\(runtimeDir, "mock-mode\.lock"\);/);
  assert.match(startDevPorts, /const realModeLockFile = path\.join\(runtimeDir, "real-mode\.lock"\);/);
  assert.match(startDevPorts, /const preferredDesignModeFile = path\.join\(runtimeDir, "preferred-design-mode\.json"\);/);
  assert.match(startDevPorts, /fileFresh\(stableStartingLockFile, 10 \* 60_000\)/);
  assert.match(startDevPorts, /assertRealDesignStartAllowed\(\);/);
  assert.match(startDevPorts, /assertMockDesignStartAllowed\(\);/);
  assert.match(startDevPorts, /writeRealModeLockIfNeeded\(\);/);
  assert.match(startDevPorts, /writePreferredDesignMode\(\);/);
  assert.match(startDevPorts, /const existing = readRuntimeDesignPlatformConfig\(\);/);
  assert.match(startDevPorts, /\.\.\.existing,/);
  assert.match(startDevPorts, /function assertRealDesignStartAllowed\(\)/);
  assert.match(startDevPorts, /ALLOW_REAL_DESIGN_START/);
  assert.match(startDevPorts, /ports:launch:real/);
  assert.match(startDevPorts, /ALLOW_REAL_DESIGN_LAUNCH/);
  assert.match(startDevPorts, /CONFIRM_REAL_DESIGN_SWITCH/);
  assert.match(startDevPorts, /Real design startup is disabled by default/);
  assert.match(startDevPorts, /run_desktop_real_design\.bat/);
  assert.match(startDevPorts, /ports:launch:real:confirmed/);
  assert.match(startDevPorts, /stale raw keep-alive launchers cannot steal the default mock startup/);
  assert.match(startDevPorts, /mockRepairLockIsFresh\(\)/);
  assert.match(startDevPorts, /function mockRuntimeStateIsActive\(\)/);
  assert.match(startDevPorts, /existingDesignPlatformAdapter === "standard_v1"/);
  assert.match(startDevPorts, /preferredDesignMode === "mock"/);
  assert.match(startDevPorts, /function findMockRepairProcesses\(\)/);
  assert.match(startDevPorts, /return findMockRepairProcesses\(\)\.length > 0;/);
  assert.match(portsStackStarter, /function findMockRepairProcesses\(\)/);
  assert.match(portsStackStarter, /return findMockRepairProcesses\(\)\.length > 0;/);
  assert.match(desktopServiceSupervisor, /const stableRuntimeDir = path\.join\(process\.cwd\(\), "\.runtime-stable"\);/);
  assert.match(desktopServiceSupervisor, /stableDesktopGuardActive\(\)/);
  assert.match(desktopServiceSupervisor, /legacy supervisor skipped/);
  assert.doesNotMatch(desktopServiceSupervisor, /if exist \$\{cmdQuote\(stableStartingLockFile\)\} exit \/b 0/);
  assert.doesNotMatch(desktopServiceSupervisor, /if exist \$\{cmdQuote\(stableKeepAliveHeartbeatFile\)\} exit \/b 0/);
  assert.doesNotMatch(desktopServiceSupervisor, /"ALLOW_LEGACY_START_WITH_STABLE"/);
  assert.match(repairDevStartupSource, /clearMockRepairLock\(\);/);
  assert.match(repairDevStartupSource, /function clearMockRepairLock\(\)/);
  assert.match(startDevPorts, /default mock startup repair is in progress/);
  assert.match(startDevPorts, /function assertMockDesignStartAllowed\(\)/);
  assert.match(startDevPorts, /function writeRealModeLockIfNeeded\(\)/);
  assert.match(startDevPorts, /writeRuntimeFileWithRetry\(mockModeLockFile/);
  assert.match(startDevPorts, /writeRuntimeFileWithRetry\(realModeLockFile/);
  assert.match(startDevPorts, /writeRuntimeFileWithRetry\(\s+preferredDesignModeFile/);
  assert.match(startDevPorts, /function writeRuntimeFileWithRetry\(filePath, content\)/);
  assert.match(startDevPorts, /\["EPERM", "EBUSY", "EACCES"\]\.includes\(error\?\.code\)/);
  assert.match(startDevPorts, /function sleepSync\(ms\)/);
  assert.match(startDevPorts, /function writePreferredDesignMode\(\)/);
  assert.match(startDevPorts, /function readPreferredDesignMode\(\)/);
  assert.match(startDevPorts, /startModeLockHeartbeat\(\);/);
  assert.match(startDevPorts, /function startModeLockHeartbeat\(\)/);
  assert.match(startDevPorts, /setInterval\(writeRealModeLockIfNeeded, 5000\)/);
  assert.match(startDevPorts, /Real design startup is blocked because mock mode is locked/);
  assert.match(startDevPorts, /findConflictingDesignLaunchers\("mock"\)/);
  assert.match(startDevPorts, /!getPortOwnerPids\(mockPort\)\.length/);
  assert.match(startDevPorts, /!getPortOwnerPids\(apiPort\)\.length/);
  assert.match(startDevPorts, /removed stale mock mode lock before real design startup/);
  assert.match(startDevPorts, /Mock design startup is blocked because real mode is active, preferred, or locked/);
  assert.match(startDevPorts, /findConflictingDesignLaunchers\("real"\)/);
  assert.match(startDevPorts, /Run npm\.cmd run ports:stop before switching to real design mode/);
  assert.match(startDevPorts, /const keepAliveLauncher = args\.has\("--keep-alive"\);/);
  assert.doesNotMatch(startDevPorts, /keep-alive refused for stale runtime/);
  assert.match(startDevPorts, /command: process\.execPath/);
  assert.match(startDevPorts, /let webDevServerFallback = false;/);
  assert.doesNotMatch(startDevPorts, /let webDevServerFallback = keepAliveLauncher;/);
  assert.doesNotMatch(startDevPorts, /configureWebDevServerFallback\("keep-alive local startup uses Next dev server"\);/);
  assert.match(startDevPorts, /useWebDevServerFallback\(retryError, "web build retry failed"\)/);
  assert.match(startDevPorts, /if \(!keepAliveLauncher\) return false;\s+configureWebDevServerFallback\(`\$\{reason\}: \$\{error instanceof Error \? error\.message : String\(error\)\}`\);\s+return true;/);
  assert.match(startDevPorts, /configureWebDevServerFallback\(`web standalone exited with code \$\{code \?\? "unknown"\}`\)/);
  assert.match(
    startDevPorts,
    /"node_modules\/next\/dist\/bin\/next",\s+"dev",\s+"apps\/web",\s+"-H",\s+"127\.0\.0\.1",\s+"-p",\s+String\(webPort\),\s+"--webpack"/,
  );
  assert.match(startDevPorts, /if \(webDevServerFallback\) return;/);
  assert.match(startDevPorts, /const net = require\("node:net"\);/);
  assert.match(startDevPorts, /const managedChildren = \[\];/);
  assert.match(startDevPorts, /const keepAliveTimers = \[\];/);
  assert.match(startDevPorts, /const keepAliveHeartbeatFile = path\.join\(runtimeDir, "keep-alive\.json"\);/);
  assert.match(startDevPorts, /const keepAliveHeartbeatTimers = \[\];/);
  assert.match(startDevPorts, /const keepAliveServers = \[\];/);
  assert.match(startDevPorts, /const serviceRestartGraceUntil = new Map\(\);/);
  assert.match(startDevPorts, /let startedAnyService = false;/);
  assert.match(startDevPorts, /const allowMockDesignStart = process\.env\.FORCE_MOCK_DESIGN_START === "1";/);
  assert.match(startDevPorts, /Use npm\.cmd run ports:stop to stop them/);
  assert.match(startDevPorts, /!startedAnyService && allReady && findSameModeKeepAliveLaunchers\(\)\.length/);
  assert.match(startDevPorts, /function findSameModeKeepAliveLaunchers\(\)/);
  assert.match(startDevPorts, /tools\/start-dev-ports\.js/);
  assert.match(startDevPorts, /--keep-alive/);
  assert.match(startDevPorts, /tools\/desktop-service-supervisor\.js/);
  assert.match(startDevPorts, /--supervisor-child/);
  assert.match(startDevPorts, /Services are already owned by another launcher; exiting duplicate keep-alive/);
  assert.match(startDevPorts, /const shouldReuseRealDesignMode =/);
  assert.match(startDevPorts, /existingDesignPlatformAdapter === "art_image_local"/);
  assert.match(startDevPorts, /preferredDesignMode === "real"/);
  assert.match(startDevPorts, /fs\.existsSync\(realModeLockFile\)/);
  assert.match(startDevPorts, /const preferredRealMode = preferredDesignMode === "real";/);
  assert.match(startDevPorts, /const realModeLocked = fs\.existsSync\(realModeLockFile\);/);
  assert.match(startDevPorts, /const realLaunchers = findConflictingDesignLaunchers\("real"\);/);
  assert.doesNotMatch(startDevPorts, /removed stale real design mode state before explicit mock design startup/);
  assert.doesNotMatch(startDevPorts, /function clearStaleRealDesignRuntimeState\(\)/);
  assert.doesNotMatch(portsStackStarter, /removed stale real design mode state before explicit mock design launch/);
  assert.doesNotMatch(portsStackStarter, /const staleRealStateCanBeOverridden =/);
  assert.match(startDevPorts, /\(\(!runtimeConfigLooksReal && !preferredRealMode\) \|\| allowMockDesignStart\)/);
  assert.match(
    startDevPorts,
    /\(requestedRealDesignMode \|\| shouldReuseRealDesignMode\) && !forceMockDesignMode \? "art_image_local" : "standard_v1";/,
  );
  assert.match(startDevPorts, /waitForStableServiceReady\(service, serviceReadyTimeoutMs\(service\)\)/);
  assert.match(startDevPorts, /async function waitForStableServiceReady\(service, timeoutMs\)/);
  assert.match(startDevPorts, /function serviceReadyTimeoutMs\(service\)/);
  assert.match(startDevPorts, /if \(service\.name === "api"\) return 90000;/);
  assert.match(startDevPorts, /if \(service\.name === "web"\) return 60000;/);
  assert.match(startDevPorts, /await isServiceReadyForCurrentConfig\(service\)/);
  assert.match(startDevPorts, /const ok = await waitForStableServiceReady\(service, serviceReadyTimeoutMs\(service\)\)/);
  assert.match(startDevPorts, /const reachable = await isHealthyWithRetry\(service\.url, 10, 500\);/);
  assert.match(startDevPorts, /const apiReachable = await isHealthyWithRetry\(apiHealthUrl, 2, 250\);/);
  assert.match(startDevPorts, /const integrationHealth = apiReachable \? await getJsonWithRetry\(integrationHealthUrl, 10, 500\) : null;/);
  assert.match(startDevPorts, /async function isHealthyWithRetry\(url, attempts, delayMs\)/);
  assert.match(startDevPorts, /async function getJsonWithRetry\(url, attempts, delayMs\)/);
  assert.match(startDevPorts, /const ok = reachable && !configMismatch && !runtimeMismatch && !ownerMismatch && !webRuntimeMismatch;/);
  assert.match(startDevPorts, /function apiHealthUsesRuntimeDir\(apiHealth\)/);
  assert.match(startDevPorts, /function webPortRuntimeMismatchReason\(pids\)/);
  assert.match(startDevPorts, /web port is running from a different runtime PID/);
  assert.match(startDevPorts, /API local store is outside current runtime/);
  assert.match(startDevPorts, /status: ok \? "running" : configMismatch \? "wrong_mode" : runtimeMismatch \|\| webRuntimeMismatch \? "wrong_runtime" : "down"/);
  assert.match(startDevPorts, /status: "wrong_mode"/);
  assert.match(startDevPorts, /current adapter=\$\{integrationHealth\.adapter \|\| "unknown"\} base=\$\{integrationHealth\.baseUrl \|\| "unknown"\}/);
  assert.match(startDevPorts, /API build failed once/);
  assert.match(startDevPorts, /sleepMs\(2000\);/);
  assert.match(startDevPorts, /await assertNoActiveApiModeConflict\(\);/);
  assert.match(startDevPorts, /async function assertNoActiveApiModeConflict\(\)/);
  assert.match(startDevPorts, /Runtime design platform config was not changed/);
  assert.match(startDevPorts, /Active API design mode does not match requested startup mode/);
  assert.match(startDevPorts, /if \(!statusOnly && !preflightOnly\) \{/);
  assert.match(startDevPorts, /const wrapperPath = path\.join\(runtimeDir, `run-\$\{service\.name\}\.cmd`\);/);
  assert.match(startDevPorts, /const webStandaloneServer = path\.join\("apps", "web", "\.next", "standalone", "apps", "web", "server\.js"\);/);
  assert.match(startDevPorts, /const webRuntimeServerPath = path\.join\(runtimeDir, "web-standalone-server\.js"\);/);
  assert.match(startDevPorts, /commandArgs: \[webRuntimeServerPath\]/);
  assert.match(startDevPorts, /cwd: desktopRoot/);
  assert.match(startDevPorts, /const normalizedOwnerRoots = \[desktopRoot, runtimeDir\]\.map\(normalizePathText\)\.filter\(Boolean\);/);
  assert.match(startDevPorts, /!normalizedOwnerRoots\.some\(\(ownerRoot\) => commandLine\.includes\(ownerRoot\)\)/);
  assert.doesNotMatch(startDevPorts, /commandArgs: keepAliveLauncher/);
  assert.doesNotMatch(startDevPorts, /cwd: keepAliveLauncher \? desktopRoot : path\.dirname\(webStandaloneServerPath\)/);
  assert.match(startDevPorts, /function serviceCwd\(service\)/);
  assert.match(startDevPorts, /cwd: serviceCwd\(service\)/);
  assert.match(startDevPorts, /cd \/d \$\{cmdQuote\(serviceCwd\(service\)\)\}/);
  assert.match(startDevPorts, /await buildWebIfNeeded\(\);/);
  assert.match(startDevPorts, /async function buildWebIfNeeded\(\)/);
  assert.match(startDevPorts, /runPackageScript\("build:web"\)/);
  assert.match(startDevPorts, /const hadExistingWebStandalone = fs\.existsSync\(webRuntimeServerPath\);/);
  assert.match(startDevPorts, /useExistingWebStandaloneAfterBuildFailure\(error, hadExistingWebStandalone\)/);
  assert.match(startDevPorts, /function useExistingWebStandaloneAfterBuildFailure\(error, hadExistingWebStandalone\)/);
  assert.match(startDevPorts, /Starting with the existing standalone build/);
  assert.match(startDevPorts, /const webRequiredServerFilesPath = path\.join/);
  assert.match(startDevPorts, /required-server-files\.json/);
  assert.match(startDevPorts, /webProductionBuildReadyForStartup\(\)/);
  assert.match(startDevPorts, /web standalone build incomplete; rebuilding web before start/);
  assert.match(startDevPorts, /function resolvedNpmCommand\(\)/);
  assert.match(startDevPorts, /const besideNode = path\.join\(path\.dirname\(process\.execPath\), "npm\.cmd"\);/);
  assert.match(startDevPorts, /if \(!resolvedNpmCommand\(\)\) missing\.push\(npmCommandName\(\)\);/);
  assert.match(startDevPorts, /function resolvedNpmCliPath\(\)/);
  assert.match(startDevPorts, /const npmCliPath = process\.platform === "win32" \? resolvedNpmCliPath\(\) : "";/);
  assert.match(startDevPorts, /command: process\.execPath, args: \[npmCliPath, \.\.\.args\]/);
  assert.match(startDevPorts, /const result = spawnSync\(packageCommand\.command, packageCommand\.args, \{/);
  assert.match(startDevPorts, /shell: false/);
  assert.match(startDevPorts, /env: packageScriptEnv\(\)/);
  assert.match(startDevPorts, /function packageScriptEnv\(\)/);
  assert.match(startDevPorts, /FORCE_WEB_CLEAN_BUILD: "0"/);
  assert.match(startDevPorts, /function webBuildIsStale\(\)/);
  assert.match(startDevPorts, /pathHasFileNewerThan\(item, builtAt\)/);
  assert.match(startDevPorts, /const launcherLogPath = path\.join\(logsDir, `\$\{service\.name\}\.launcher\.log`\);/);
  assert.match(startDevPorts, /removeLogFileIfUnlocked\(stdoutPath\)/);
  assert.match(startDevPorts, /removeLogFileIfUnlocked\(stderrPath\)/);
  assert.match(startDevPorts, /removeLogFileIfUnlocked\(launcherLogPath\)/);
  assert.match(startDevPorts, /function removeLogFileIfUnlocked\(filePath\)/);
  assert.match(startDevPorts, /function openServiceLogForAppend\(filePath, launcherLogPath, serviceName, streamName\)/);
  assert.match(startDevPorts, /log was locked; using \$\{fallbackPath\}/);
  assert.match(startDevPorts, /return "ignore";/);
  assert.match(startDevPorts, /function closeLogFd\(value\)/);
  assert.match(startDevPorts, /error\?\.code === "EPERM" \|\| error\?\.code === "EBUSY"/);
  assert.match(startDevPorts, /Log file is locked, keeping existing file/);
  assert.match(startDevPorts, /fs\.writeFileSync\(wrapperPath, buildWindowsServiceWrapper/);
  assert.match(startDevPorts, /function buildWindowsServiceWrapper\(service,/);
  assert.match(startDevPorts, /renderWindowsWrapperEnvironment\(service\.name, serviceEnv\(service\)\)/);
  assert.match(startDevPorts, /LOW_VALUE_AUTOMATION_ENABLED: process\.env\.LOW_VALUE_AUTOMATION_ENABLED \|\| "true"/);
  assert.match(startDevPorts, /LOW_VALUE_AUTOMATION_RUN_ON_START: process\.env\.LOW_VALUE_AUTOMATION_RUN_ON_START \|\| "true"/);
  assert.match(startDevPorts, /function cmdSetEnv\(key, value\)/);
  assert.match(startDevPorts, /if \(keepAliveLauncher\) \{/);
  assert.match(startDevPorts, /function startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath, launchCommandOverride\)/);
  assert.match(startDevPorts, /const launchCommand = launchCommandOverride \|\| \{ command: service\.command, commandArgs: service\.commandArgs, usesOwnRedirection: false \}/);
  assert.match(startDevPorts, /function windowsServiceLaunchCommand\(service, wrapperPath\)/);
  assert.match(startDevPorts, /return startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath, launchCommand\);/);
  assert.match(startDevPorts, /managedChildren\.push\(child\);/);
  assert.match(startDevPorts, /serviceRestartGraceUntil\.set\(service\.name, Date\.now\(\) \+ serviceReadyTimeoutMs\(service\)\)/);
  assert.match(startDevPorts, /managed process exited code=\$\{code \?\? ""\} signal=\$\{signal \?\? ""\}/);
  assert.match(startDevPorts, /serviceRestartGraceUntil\.get\(service\.name\)/);
  assert.doesNotMatch(startDevPorts, /const restarted = startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath\);/);
  assert.match(startDevPorts, /launched managed child \$\{child\.pid \|\| "unknown"\} via \$\{/);
  assert.match(startDevPorts, /launchCommand\.usesOwnRedirection \? "wrapper command" : "direct service command"/);
  assert.match(startDevPorts, /wrapper kept at \$\{wrapperPath\}/);
  assert.match(startDevPorts, /function scheduleServiceRecordRefresh\(service, childPid\)/);
  assert.match(startDevPorts, /function refreshServiceRecord\(service, childPid\)/);
  assert.match(startDevPorts, /const childProcessPid = processIsRunning\(childPid\) \? numberOrUndefined\(childPid\) : undefined;/);
  assert.match(startDevPorts, /const recordedPid = processIsRunning\(records\[service\.name\]\?\.pid\) \? numberOrUndefined\(records\[service\.name\]\?\.pid\) : undefined;/);
  assert.match(startDevPorts, /function processIsRunning\(pid\)/);
  assert.match(startDevPorts, /function startManagedChild[\s\S]+detached: process\.platform === "win32"/);
  const managedChildSource = startDevPorts.slice(
    startDevPorts.indexOf("function startManagedChild("),
    startDevPorts.indexOf("function startService("),
  );
  assert.match(managedChildSource, /if \(process\.platform === "win32"\) child\.unref\(\);/);
  assert.match(startDevPorts, /restarting \$\{service\.name\}/);
  assert.match(startDevPorts, /}, 2000\);/);
  assert.match(startDevPorts, /timer\.ref\(\);/);
  assert.match(startDevPorts, /keepAliveTimers\.push\(timer\);/);
  assert.match(startDevPorts, /function startKeepAliveServerAnchor\(\)/);
  assert.match(startDevPorts, /function startKeepAliveHeartbeat\(\)/);
  assert.match(startDevPorts, /if \(keepAliveLauncher\) \{\s+startKeepAliveHeartbeat\(\);\s+startKeepAliveAnchor\(\);\s+\}/);
  assert.match(startDevPorts, /function writeKeepAliveHeartbeat\(\)/);
  assert.match(startDevPorts, /writeKeepAliveHeartbeat\(\);/);
  assert.match(startDevPorts, /mode: realDesignMode \? "real" : "mock"/);
  assert.match(startDevPorts, /net\.createServer/);
  assert.match(startDevPorts, /server\.listen\(0, "127\.0\.0\.1"/);
  assert.match(startDevPorts, /keepAliveServers\.push\(server\)/);
  assert.match(startDevPorts, /Keeping launcher alive so managed services can recover/);
  assert.match(startDevPorts, /echo \[%date% %time%\] launching \$\{service\.name\}/);
  assert.match(startDevPorts, /const runLine = `\$\{command\} >> \$\{cmdQuote\(stdoutPath\)\} 2>> \$\{cmdQuote\(stderrPath\)\}`;/);
  assert.match(startDevPorts, /function windowsServiceLaunchCommand\(service, wrapperPath\)/);
  assert.match(startDevPorts, /function windowsServiceLaunchCommand\(service, wrapperPath\)/);
  assert.match(startDevPorts, /command: "powershell\.exe"/);
  assert.match(startDevPorts, /Start-Process -FilePath \$\{psQuote\(wrapperPath\)\}/);
  assert.match(startDevPorts, /-WorkingDirectory \$\{psQuote\(desktopRoot\)\}/);
  assert.match(startDevPorts, /WindowStyle Minimized/);
  assert.doesNotMatch(startDevPorts, /start "" \/min \$\{cmdQuote\(wrapperPath\)\}/);
  assert.doesNotMatch(startDevPorts, /const cmdArguments = \["\/d", "\/s", "\/c", wrapperPath\];/);
  assert.doesNotMatch(startDevPorts, /-ArgumentList \$\{psArray\(\s+cmdArguments/);
  assert.match(startDevPorts, /usesOwnRedirection: true/);
  assert.doesNotMatch(startDevPorts, /"-NoExit"/);
  assert.match(startDevPorts, /const startServicesThroughWrappers = process\.env\.START_SERVICES_THROUGH_WRAPPERS === "1"/);
  assert.match(startDevPorts, /wrapper prepared at \$\{wrapperPath\}; launching direct service process for keep-alive supervision/);
  assert.match(startDevPorts, /wrapper prepared at \$\{wrapperPath\}; launching detached Windows service wrapper for keep-alive supervision/);
  assert.match(startDevPorts, /wrapper prepared at \$\{wrapperPath\}; launching detached Windows service wrapper through PowerShell Start-Process for stable supervision/);
  assert.match(startDevPorts, /const launchCommand = keepAliveLauncher && !startServicesThroughWrappers\s+\?/);
  assert.match(startDevPorts, /\? \{ command: service\.command, commandArgs: service\.commandArgs, usesOwnRedirection: false \}/);
  assert.match(startDevPorts, /: windowsServiceLaunchCommand\(service, wrapperPath\);/);
  assert.doesNotMatch(startDevPorts, /const workerPath = path\.join\(runtimeDir, `run-\$\{service\.name\}-worker\.cmd`\);/);
  assert.doesNotMatch(startDevPorts, /function buildWindowsServiceWorker\(service, stdoutPath, stderrPath\)/);
  assert.doesNotMatch(startDevPorts, /const commandLine = `cmd\.exe \/d \/c \$\{cmdQuote\(wrapperPath\)\}`;/);
  assert.doesNotMatch(startDevPorts, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(startDevPorts, /const integrationHealth = await getJson\(integrationHealthUrl\);/);
  assert.match(startDevPorts, /return integrationMatchesCurrentConfig\(integrationHealth\);/);
  assert.match(startDevPorts, /const webRuntimeMismatch = service\.name === "web" \? webPortRuntimeMismatchReason\(portOwners\) : "";/);
  assert.match(startDevPorts, /const ok = reachable && !configMismatch && !runtimeMismatch && !ownerMismatch && !webRuntimeMismatch;/);
  assert.match(startDevPorts, /runtimeMismatch \|\| webRuntimeMismatch/);
  const printStatusBody = startDevPorts.slice(startDevPorts.indexOf("async function printStatus()"), startDevPorts.indexOf("async function printPreflight()"));
  assert.doesNotMatch(printStatusBody, /writePidFile\(records\)/);
  assert.match(startDevPorts, /assertNoConflictingDesignLauncher\(\);/);
  assert.match(startDevPorts, /function findConflictingDesignLaunchers\(mode\)/);
  assert.match(startDevPorts, /start-dev-ports\.js/);
  assert.match(startDevPorts, /desktop-service-supervisor\.js/);
  assert.match(startDevPorts, /launch-real\.cmd/);
  assert.match(startDevPorts, /launch-mock\.cmd/);
  assert.match(startDevPorts, /supervise-real\.cmd/);
  assert.match(startDevPorts, /supervise-mock\.cmd/);
  assert.match(startDevPorts, /stable-supervise-real\.cmd/);
  assert.match(startDevPorts, /stable-supervise-mock\.cmd/);
  assert.match(startDevPorts, /Run npm\.cmd run ports:stop, then start with only one design mode/);
  assert.match(startDevPorts, /PORT: String\(service\?\.port \|\| webPort\)/);

  const checkDevStartup = readText("tools/check-dev-startup.js");
  assert.match(checkDevStartup, /const requestedRealDesignMode = args\.has\("--real-design"\);/);
  assert.match(checkDevStartup, /const realDesignMode = requestedRealDesignMode && !forceMockDesignMode;/);
  assert.match(checkDevStartup, /const mockDesignMode = !realDesignMode;/);
  assert.match(checkDevStartup, /requestUrlWithRetry\(service\.url, 20, 1000\)/);
  assert.match(checkDevStartup, /requestUrlWithRetry\(integrationHealthUrl, 5, 700\)/);
  assert.match(checkDevStartup, /tools\/start-dev-ports\.js/);
  assert.match(checkDevStartup, /--keep-alive/);
  assert.match(checkDevStartup, /tools\/desktop-service-supervisor\.js/);
  assert.match(checkDevStartup, /--supervisor-child/);
  assert.match(checkDevStartup, /function normalizePathText\(value\)/);
  assert.match(checkDevStartup, /function sleep\(ms\)/);

  const repairDevStartup = readText("tools/repair-dev-startup.js");
  assert.match(repairDevStartup, /function clearDefaultMockModeLocks\(\)/);
  assert.match(repairDevStartup, /const mockRepairLockFile = path\.join\(runtimeDir, "mock-repair\.lock"\);/);
  assert.match(repairDevStartup, /fs\.writeFileSync\(mockRepairLockFile/);
  assert.match(repairDevStartup, /fs\.rmSync\(realModeLockFile, \{ force: true \}\)/);
  assert.match(repairDevStartup, /FORCE_MOCK_DESIGN_START: "1"/);
  assert.match(repairDevStartup, /"tools\/start-dev-ports\.js", "--mock-design", "--preflight", "--require-free-ports"/);
  assert.match(repairDevStartup, /== Repair default desktop startup ==/);
  assert.match(repairDevStartup, /Repair will clean ports, verify defaults, build the API, and start supervised desktop services/);
  assert.match(repairDevStartup, /failed = !runSteps\(resetSteps\);/);
  assert.doesNotMatch(repairDevStartup, /Check current default startup/);
  assert.doesNotMatch(repairDevStartup, /healthyStartupSteps/);
  assert.match(repairDevStartup, /packageScript: "ports:launch:mock"/);
  assert.doesNotMatch(repairDevStartup, /verifyStartup: true/);
  assert.doesNotMatch(repairDevStartup, /runStartupDoctorWithRetry/);
  assert.match(repairDevStartup, /Desktop services are running at http:\/\/127\.0\.0\.1:3100\//);
  assert.doesNotMatch(repairDevStartup, /Run run_desktop\.bat to start/);
  assert.match(repairDevStartup, /DESIGN_PLATFORM_ADAPTER: "standard_v1"/);
  assert.match(repairDevStartup, /DESIGN_PLATFORM_BASE_URL: "http:\/\/127\.0\.0\.1:3700"/);
  assert.match(repairDevStartup, /START_MOCK_DESIGN_PLATFORM: "true"/);

  assert.match(desktopServiceSupervisor, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
  assert.match(desktopServiceSupervisor, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
  assert.match(desktopServiceSupervisor, /--supervisor-child/);
  assert.match(desktopServiceSupervisor, /Real design supervisor must be launched through npm\.cmd run ports:launch:real/);
  assert.match(desktopServiceSupervisor, /CONFIRM_REAL_DESIGN_SWITCH/);
  assert.match(desktopServiceSupervisor, /stale real supervisors cannot steal the default mock startup/);
  assert.match(desktopServiceSupervisor, /mockRepairLockIsFresh\(\)/);
  assert.match(desktopServiceSupervisor, /function mockRuntimeStateIsActive\(\)/);
  assert.match(desktopServiceSupervisor, /function runtimeConfigLooksMockDesignMode\(\)/);
  assert.match(desktopServiceSupervisor, /function preferredDesignModeIsMock\(\)/);
  assert.match(desktopServiceSupervisor, /start-dev-ports exited with 0, continuing supervision/);
  assert.doesNotMatch(desktopServiceSupervisor, /start-dev-ports exited with 0, supervisor exiting/);
  assert.doesNotMatch(desktopServiceSupervisor, /removed stale real mode lock before mock launch/);
  const desktopServiceSupervisorMain = desktopServiceSupervisor.slice(
    desktopServiceSupervisor.indexOf("function main()"),
    desktopServiceSupervisor.indexOf("function spawnSupervisorChildDetached()"),
  );
  assert.ok(
    desktopServiceSupervisorMain.indexOf("const supervisorCreateResult = createWindowsProcess(supervisorCommandLine);") <
      desktopServiceSupervisorMain.indexOf("const supervisorChildResult = startSupervisorChild();"),
    "desktop-service-supervisor.js must try Win32_Process supervisor before PowerShell Start-Process fallback",
  );
  assert.match(desktopServiceSupervisor, /Real design launch is blocked because mock mode is locked/);
  assert.match(desktopServiceSupervisor, /removed stale mock mode lock before real design startup/);

  const appConfig = readText("apps/api/src/shared/app-config.ts");
  assert.match(appConfig, /const defaultDesignPlatformAdapter = "standard_v1";/);
  assert.match(appConfig, /const defaultDesignPlatformBaseUrl = "http:\/\/127\.0\.0\.1:3700";/);
});

test("stop script recognizes child service command lines", () => {
  const stopDevPorts = readText("tools/stop-dev-ports.js");
  assert.match(stopDevPorts, /const protectedPids = buildProtectedPids\(\);/);
  assert.match(stopDevPorts, /function buildProtectedPids\(\)/);
  assert.match(stopDevPorts, /const forceProcessSweep = process\.env\.FORCE_PORTS_SWEEP === "1";/);
  assert.match(stopDevPorts, /!forceProcessSweep && !hasManagedRuntimeState\(\)/);
  assert.match(stopDevPorts, /function hasManagedRuntimeState\(\)/);
  assert.match(stopDevPorts, /fs\.existsSync\(mockModeLockFile\) \|\| fs\.existsSync\(realModeLockFile\)/);
  assert.match(stopDevPorts, /const protectedStarterMode =/);
  assert.match(stopDevPorts, /const skipStackStarterLaunchers = process\.env\.PORTS_STOP_SKIP_STACK_STARTERS === "1";/);
  assert.match(stopDevPorts, /const skipStableServiceWrappers = process\.env\.PORTS_STOP_SKIP_STABLE_SERVICE_WRAPPERS === "1";/);
  assert.match(stopDevPorts, /\.runtime\\\/\(launch\|supervise\|stable-supervise\)-\(mock\|real\)\\\.cmd/);
  assert.match(stopDevPorts, /process\.env\.PORTS_STACK_STARTER_PID/);
  assert.match(stopDevPorts, /process\.env\.PORTS_STACK_STARTER_PARENT_PID/);
  assert.match(stopDevPorts, /process\.env\.PORTS_STACK_STARTER_MODE/);
  assert.match(stopDevPorts, /PRESERVE_REAL_MODE_LOCK/);
  assert.match(stopDevPorts, /PRESERVE_MOCK_REPAIR_LOCK/);
  assert.match(stopDevPorts, /const designPlatformConfigFile = path\.join\(runtimeDir, "design-platform-config\.json"\);/);
  assert.match(stopDevPorts, /const preferredDesignModeFile = path\.join\(runtimeDir, "preferred-design-mode\.json"\);/);
  assert.match(stopDevPorts, /const keepAliveHeartbeatFile = path\.join\(runtimeDir, "keep-alive\.json"\);/);
  assert.match(stopDevPorts, /const wechatBridgeWorkerStatusFile = path\.join\(runtimeDir, "wechat-bridge-worker-status\.json"\);/);
  assert.match(stopDevPorts, /const wechatWindowObserverStatusFile = path\.join\(runtimeDir, "wechat-window-observer-status\.json"\);/);
  assert.match(stopDevPorts, /const stackStarterRealLockFile = path\.join\(runtimeDir, "ports-stack-starter-real\.lock"\);/);
  assert.match(stopDevPorts, /const stackStarterMockLockFile = path\.join\(runtimeDir, "ports-stack-starter-mock\.lock"\);/);
  assert.match(stopDevPorts, /markWechatWorkerStatusesStopped\(\);/);
  assert.match(stopDevPorts, /function markWechatWorkerStatusesStopped\(\)/);
  assert.match(stopDevPorts, /status: "stopped"/);
  assert.match(stopDevPorts, /was stopped by ports:stop/);
  assert.match(stopDevPorts, /could not mark \$\{label\} stopped/);
  assert.match(stopDevPorts, /fs\.rmSync\(keepAliveHeartbeatFile, \{ force: true \}\);/);
  assert.match(stopDevPorts, /fs\.rmSync\(stackStarterRealLockFile, \{ force: true \}\);/);
  assert.match(stopDevPorts, /fs\.rmSync\(stackStarterMockLockFile, \{ force: true \}\);/);
  assert.match(stopDevPorts, /clearRuntimeDesignModeConfig\(\);/);
  assert.match(stopDevPorts, /function clearRuntimeDesignModeConfig\(\)/);
  assert.match(stopDevPorts, /delete config\[key\]/);
  assert.match(stopDevPorts, /designPlatformAccessToken/);
  assert.match(stopDevPorts, /if \(protectedPids\.has\(pid\)\) return false;/);
  assert.match(stopDevPorts, /if \(protectedPids\.has\(pid\)\) continue;/);
  assert.match(stopDevPorts, /const processTree = parentByPid\.size \? parentByPid : null;/);
  assert.match(stopDevPorts, /collectAncestorPids\(seed, processTree\)/);
  assert.match(stopDevPorts, /function findStoppablePortOwnerAncestorPids\(pid\)/);
  assert.match(stopDevPorts, /\[stop:port-parent\] port=\$\{port\} pid=\$\{ancestorPid\}/);
  assert.match(stopDevPorts, /run-design-platform-mock\.cmd/);
  assert.match(stopDevPorts, /keepalive-stable-desktop\.cmd/);
  assert.match(stopDevPorts, /tools\/stable-runtime-launcher\.js/);
  assert.match(stopDevPorts, /stable-runtime-launcher-local\.js/);
  assert.match(stopDevPorts, /const stableRuntimeTaskName = "zhinengkefu_stable_runtime"/);
  assert.match(stopDevPorts, /SystemRoot \|\| "C:\\\\Windows", "System32", "schtasks\.exe"/);
  assert.match(stopDevPorts, /\[\"\/End\", \"\/TN\", stableRuntimeTaskName\]/);
  assert.match(stopDevPorts, /\[\"\/Delete\", \"\/TN\", stableRuntimeTaskName, \"\/F\"\]/);
  assert.match(stopDevPorts, /start-stable-desktop\(\?:-foreground\)\?/);
  assert.match(stopDevPorts, /if \(skipStableServiceWrappers && stableServiceWrapperPattern\.test\(commandLine\)\) return false;/);
  assert.match(stopDevPorts, /function normalizePathText\(value\)/);
  assert.match(stopDevPorts, /tools\/mock-design-platform\.js/);
  assert.match(stopDevPorts, /dist\/apps\/api\/main\.js/);
  assert.match(stopDevPorts, /\.runtime\/web-standalone-server\.js/);
  assert.match(stopDevPorts, /apps\\\/web\\\/\\\.next\\\/standalone\\\/apps\\\/web\\\/server\\\.js/);
  assert.match(stopDevPorts, /node\(\?:\\\.exe\)\?"\?\\s\+\.\*apps\\\/web/);
  assert.match(stopDevPorts, /next\/dist\/server\/lib\/start-server\.js/);
  assert.match(stopDevPorts, /node_modules\\\/next\\\/dist\\\/bin\\\/next/);
  assert.match(stopDevPorts, /node_modules\\\/next\\\/dist\\\/bin\\\/next build apps\\\/web/);
  assert.match(stopDevPorts, /function stopManagedWrapperProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /stopRecordedDescendantProcesses\(stoppedPids, attemptedPids, recordedPids\)/);
  assert.match(stopDevPorts, /function stopRecordedDescendantProcesses\(stoppedPids, attemptedPids, recordedPids\)/);
  assert.match(stopDevPorts, /function findDescendantPids\(rootPids\)/);
  assert.match(stopDevPorts, /if \(rootPids\.has\(current\)\)/);
  assert.match(stopDevPorts, /\[stop:child\] pid=\$\{pid\}/);
  assert.match(stopDevPorts, /function findManagedWrapperPids\(\)/);
  assert.match(stopDevPorts, /const standaloneWebWrapperPattern =/);
  assert.match(stopDevPorts, /const runtimeWebWrapperPattern =/);
  assert.match(stopDevPorts, /standaloneWebWrapperPattern\.test\(commandLine\)/);
  assert.match(stopDevPorts, /function stopManagedLauncherProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedLauncherPids\(\)/);
  assert.match(stopDevPorts, /const normalizedRoot = normalizePathText\(desktopRoot\);/);
  assert.match(stopDevPorts, /function stopManagedKeeperProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedKeeperPids\(\)/);
  assert.match(stopDevPorts, /function stopManagedDirectShellProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedDirectShellPids\(\)/);
  assert.match(stopDevPorts, /function stopManagedWechatWorkerProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedWechatWorkerPids\(\)/);
  assert.match(stopDevPorts, /if \(findManagedWechatWorkerPids\(\)\.length\) return true;/);
  assert.match(stopDevPorts, /tools\/wechat-window-observer\.js/);
  assert.match(stopDevPorts, /tools\/wechat-bridge-worker\.js/);
  assert.match(stopDevPorts, /name = 'powershell\.exe'/);
  assert.match(stopDevPorts, /tools\/start-dev-ports\.js/);
  assert.match(stopDevPorts, /\$cmd\.Contains\('--keep-alive'\)/);
  assert.match(stopDevPorts, /start-sleep -seconds 3600/);
  assert.match(stopDevPorts, /mock-mode\.lock/);
  assert.match(stopDevPorts, /real-mode\.lock/);
  assert.match(stopDevPorts, /if \(!preserveRealModeLock\) fs\.rmSync\(realModeLockFile, \{ force: true \}\)/);
  assert.match(stopDevPorts, /if \(!preserveRealModeLock\) fs\.rmSync\(preferredDesignModeFile, \{ force: true \}\)/);
  assert.match(stopDevPorts, /if \(!preserveMockRepairLock\) fs\.rmSync\(mockRepairLockFile, \{ force: true \}\)/);
  assert.match(stopDevPorts, /web\|api\|mock\)-direct/);
  assert.match(stopDevPorts, /node_modules\/next\/dist\/bin\/next dev apps\/web -p/);
  assert.match(stopDevPorts, /npm\\\.cmd"\? run build:\(api\|web\)/);
  assert.match(stopDevPorts, /tools\/mock-design-platform\.js/);
  assert.match(stopDevPorts, /start-process/);
  assert.match(stopDevPorts, /server\\\.js\\b/);
  assert.match(stopDevPorts, /commandLine\.includes\("tools\/start-dev-ports\.js"\)/);
  assert.match(stopDevPorts, /commandLine\.includes\("--keep-alive"\)/);
  assert.match(stopDevPorts, /commandLine\.includes\("tools\/ports-stack-starter\.js"\)/);
  assert.match(stopDevPorts, /commandLine\.includes\("tools\/desktop-service-supervisor\.js"\)/);
  assert.match(stopDevPorts, /const npmPortsMatch = commandLine\.match/);
  assert.match(stopDevPorts, /const npmMode = npmPortsMatch\[2\] === ":real" \? "real" : npmPortsMatch\[2\] === ":mock" \? "mock" : "";/);
  assert.match(stopDevPorts, /return !protectedStarterMode \|\| !npmMode \|\| npmMode !== protectedStarterMode;/);
  assert.match(stopDevPorts, /commandLine\.includes\("--supervisor-child"\)/);
  assert.match(stopDevPorts, /if \(stackStarterMode\) return !protectedStarterMode \|\| stackStarterMode !== protectedStarterMode;/);
  assert.match(stopDevPorts, /if \(skipStackStarterLaunchers && stackStarterMode\) return false;/);
  assert.match(stopDevPorts, /npm\(\?:\\\.cmd\|\\\/bin\\\/npm-cli\\\.js\)"\? run ports:\(start\|launch\|keepalive\|once\)\(:mock\|:real\)\?/);
  assert.match(stopDevPorts, /run-\[\^" \]\+\(-worker\)\?\\\.cmd/);
  assert.match(stopDevPorts, /\(web\|api\|mock\)-persist/);
  assert.match(stopDevPorts, /const launcherPattern = \/\(launch\|supervise\|stable-supervise\)-\(mock\|real\)\\\.cmd\//);
  assert.match(stopDevPorts, /function stopPidWithPowerShell\(pid\)/);
  assert.match(stopDevPorts, /Stop-Process -Id \$id -Force -ErrorAction Stop/);
  assert.match(stopDevPorts, /Get-CimInstance Win32_Process/);
  assert.match(stopDevPorts, /function Add-Descendants/);
  assert.match(stopDevPorts, /\$ordered\.Add\(\$targetId\)/);
  assert.match(stopDevPorts, /function getParentCommandLine\(pid\)/);
  assert.match(stopDevPorts, /normalizedParentCommand\.includes\("apps\/web\/\.next\/standalone\/apps\/web"\)/);
});

test("wechat safe worker launcher is explicit and defaults to no real send", () => {
  const launcher = readText("tools/start-wechat-safe-workers.js");
  const bridgeWorker = readText("tools/wechat-bridge-worker.js");
  const windowObserver = readText("tools/wechat-window-observer.js");

  assert.match(launcher, /process\.env\.DESKTOP_RUNTIME_DIR \? path\.resolve\(process\.env\.DESKTOP_RUNTIME_DIR\) : path\.join\(desktopRoot, "\.runtime"\)/);
  assert.match(bridgeWorker, /process\.env\.DESKTOP_RUNTIME_DIR \? path\.resolve\(process\.env\.DESKTOP_RUNTIME_DIR\) : path\.join\(desktopRoot, "\.runtime"\)/);
  assert.match(windowObserver, /process\.env\.DESKTOP_RUNTIME_DIR \? path\.resolve\(process\.env\.DESKTOP_RUNTIME_DIR\) : path\.join\(desktopRoot, "\.runtime"\)/);
  assert.match(launcher, /"tools\/wechat-window-observer\.js", "--watch", "--scan"/);
  assert.match(launcher, /"tools\/wechat-bridge-worker\.js", "--watch"/);
  assert.match(launcher, /const requestedBridgeMode = resolveBridgeMode\(\)/);
  assert.match(launcher, /BRIDGE_MODE: requestedBridgeMode/);
  assert.match(launcher, /args\.has\("--dispatch"\)/);
  assert.match(launcher, /args\.has\("--noop"\)/);
  assert.match(launcher, /return "noop"/);
  assert.match(launcher, /assertExistingWorkerMode\(service\)/);
  assert.match(launcher, /already running with BRIDGE_MODE=/);
  assert.match(launcher, /wechat:safe:stop before starting/);
  assert.match(launcher, /mode: service\.env\.BRIDGE_MODE \|\| ""/);
  assert.match(launcher, /mode=\$\{status\.mode \|\| records\[service\.name\]\?\.mode\}/);
  assert.match(launcher, /BRIDGE_ACK_TRANSPORT: process\.env\.BRIDGE_ACK_TRANSPORT \|\| "file_scan"/);
  assert.match(launcher, /API is not reachable/);
  assert.match(launcher, /assertApiReadyForSafeWorkers\(\)/);
  assert.match(launcher, /waitForStableJson\(`\$\{apiBase\}\/health`, 2500, "API health"\)/);
  assert.match(launcher, /consecutiveOk >= 2/);
  assert.match(launcher, /WECHAT_SAFE_API_READY_TIMEOUT_MS/);
  assert.match(launcher, /wechat\/bridge\/status/);
  assert.match(launcher, /windows_bridge/);
  assert.match(launcher, /integrations\/design-platform\/health/);
  assert.match(launcher, /Design platform config mismatch/);
  assert.match(launcher, /wechat-safe-workers\.json/);
  assert.match(launcher, /direct detached node process/);
  assert.match(launcher, /spawn\(process\.execPath, service\.commandArgs/);
  assert.match(launcher, /child\.unref\(\)/);
  assert.match(launcher, /status\.result\?\.failedCount/);
  assert.match(launcher, /staleStatusPid/);
  assert.match(launcher, /message\.slice\(0, 160\)/);
  assert.match(launcher, /const failures = \[\];/);
  assert.match(launcher, /Some WeChat safe workers could not be stopped/);
  assert.match(launcher, /writeWorkerStoppedStatus\(service, pid\)/);
  assert.match(launcher, /writeWorkerStoppedStatus\(service, pid \|\| Number\(readJson\(service\.statusFile\)\.pid\) \|\| null\)/);
  assert.match(launcher, /function writeWorkerStoppedStatus\(service, pid\)/);
  assert.match(launcher, /status: "stopped"/);
  assert.match(launcher, /stoppedAt: now/);
  assert.match(launcher, /was stopped by wechat:safe:stop/);
  assert.match(launcher, /could not mark \$\{service\.label\} stopped/);
  assert.match(bridgeWorker, /if \(!config\.watch\) throw error;/);
  assert.match(bridgeWorker, /headers: bridgeServiceHeaders\(config\)/);
  assert.match(bridgeWorker, /"x-wechat-bridge-token": token/);
  assert.match(bridgeWorker, /throw new Error\(`\$\{method\} \$\{url\} failed: \$\{causeMessage\}`\)/);
  assert.match(bridgeWorker, /Default mode is noop/);
  assert.match(bridgeWorker, /does not mark anything sent/);
  assert.match(bridgeWorker, /preflight:\s*\{/);
  assert.match(bridgeWorker, /requiredBeforeSend:\s*\[/);
  assert.match(bridgeWorker, /"dispatchNotExpired"/);
  assert.match(bridgeWorker, /expectedWechatAccountId/);
  assert.match(bridgeWorker, /expectedConversationId/);
  assert.match(bridgeWorker, /expectedCustomerId: dispatchTarget\.customerId/);
  assert.match(bridgeWorker, /requiredCustomerId: dispatchTarget\.customerId/);
  assert.match(bridgeWorker, /customerId: String\(entry\.customerId \|\| target\.customerId \|\| ""\)/);
  assert.match(bridgeWorker, /const customerId = resolveEntryCustomerId\(entry\)/);
  assert.match(bridgeWorker, /\{ key: "customerId", passed: Boolean\(customerId\) \}/);
  assert.match(bridgeWorker, /preview\.customerId === customerId/);
  assert.match(bridgeWorker, /const entryCustomerId = resolveEntryCustomerId\(entry\)/);
  assert.match(bridgeWorker, /!payload\.customerId \|\| String\(payload\.customerId \|\| ""\) === entryCustomerId/);
  assert.match(bridgeWorker, /String\(target\.customerId \|\| ""\) === entryCustomerId/);
  assert.match(bridgeWorker, /String\(sendPlanTarget\.customerId \|\| ""\) === entryCustomerId/);
  assert.match(bridgeWorker, /rejectIfWindowChanged: true/);
  assert.match(bridgeWorker, /rejectIfOutboxMissing: true/);
  assert.match(windowObserver, /if \(!config\.watch\) throw error;/);
  assert.match(windowObserver, /await fetchWithContext\(url,/);
});

test("double click startup bat files use stable launcher scripts", () => {
  const defaultBat = fs.readFileSync(path.join(root, "..", "run_desktop.bat"), "utf8");
  assert.match(defaultBat, /DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\\.runtime-stable/);
  assert.match(defaultBat, /start-stable-desktop-foreground\.cmd/);
  assert.match(defaultBat, /stable foreground mode/);
  assert.match(defaultBat, /Keep this window open/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run ports:keepalive:mock/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run ports:launch:mock/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run ports:doctor:mock/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run dev:stack(\s|\r|\n|$)/);

  const realDesignBat = fs.readFileSync(path.join(root, "..", "run_desktop_real_design.bat"), "utf8");
  assert.match(realDesignBat, /npm\.cmd run ports:keepalive:real/);
  assert.match(realDesignBat, /set "ALLOW_REAL_DESIGN_LAUNCH=1"/);
  assert.match(realDesignBat, /set "ALLOW_REAL_DESIGN_START=1"/);
  assert.match(realDesignBat, /set "CONFIRM_REAL_DESIGN_SWITCH=1"/);
  assert.match(realDesignBat, /stable foreground mode/);
  assert.match(realDesignBat, /Keep this window open/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run ports:launch:real/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run ports:doctor:real/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run dev:stack:real/);

  const verifyBat = fs.readFileSync(path.join(root, "..", "verify_desktop.bat"), "utf8");
  assert.match(verifyBat, /DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\\.runtime-stable/);
  assert.match(verifyBat, /stable:doctor/);
  assert.doesNotMatch(verifyBat, /ports:smoke/);
  assert.doesNotMatch(verifyBat, /DESIGN_PLATFORM_RUNTIME_CONFIG=%DESKTOP_DIR%\\.runtime\\design-platform-config\.json/);

  const checkBat = fs.readFileSync(path.join(root, "..", "check_desktop.bat"), "utf8");
  assert.match(checkBat, /DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\\.runtime-stable/);
  assert.match(checkBat, /stable:doctor/);
  assert.doesNotMatch(checkBat, /ports:doctor:mock/);

  const stopBat = fs.readFileSync(path.join(root, "..", "stop_desktop.bat"), "utf8");
  assert.match(stopBat, /DESKTOP_RUNTIME_DIR=%DESKTOP_DIR%\\.runtime-stable/);
  assert.match(stopBat, /FORCE_PORTS_SWEEP=1/);
  assert.match(stopBat, /ports:stop/);
  assert.match(stopBat, /stable:doctor/);
  assert.doesNotMatch(stopBat, /ports:status/);

  const repairBat = fs.readFileSync(path.join(root, "..", "repair_desktop.bat"), "utf8");
  assert.match(repairBat, /repair-stable-desktop\.cmd/);
  assert.doesNotMatch(repairBat, /ports:repair/);

  const stableForeground = readText("start-stable-desktop-foreground.cmd");
  assert.match(stableForeground, /DESKTOP_ROOT=%%~fI/);
  assert.match(stableForeground, /if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\\\.runtime-stable"/);
  assert.match(stableForeground, /ports:stop/);
  assert.doesNotMatch(stableForeground, /call npm\.cmd run build:web/);
  assert.match(stableForeground, /web standalone missing; runtime will use Next dev fallback/);
  assert.match(stableForeground, /keepalive-stable-desktop\.cmd/);
  assert.doesNotMatch(stableForeground, /ports:keepalive:mock/);
  const stableStart = readText("start-stable-desktop.cmd");
  assert.match(stableStart, /STABLE_SERVICE_WINDOW/);
  assert.match(stableStart, /tools\\start-stable-keepalive\.ps1/);
  assert.doesNotMatch(stableStart, /explorer\.exe "D:\\zhinengkefu\\desktop\\run-stable-service-window\.cmd"/);
  assert.doesNotMatch(stableStart, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.doesNotMatch(stableStart, /start "Smart Kefu Services" \/min/);
  assert.match(stableStart, /stable-service-window\.log/);
  assert.match(stableStart, /stable-starting\.lock/);
  assert.match(stableStart, /stable-runtime-stop-request/);
  assert.match(stableStart, /failed to start stable keepalive/);
  assert.match(stableStart, /service window entered/);
  assert.match(stableStart, /entering keepalive/);
  assert.match(stableStart, /skip ports:stop inside service window/);
  assert.doesNotMatch(stableStart, /ports:stop >> "%STABLE_SERVICE_LOG%" 2>>&1/);
  assert.doesNotMatch(stableStart, /stable:doctor -- --wait/);
  assert.match(stableStart, /node tools\\stable-start-needed\.js/);
  const stableStartNeeded = readText("tools/stable-start-needed.js");
  assert.match(stableStartNeeded, /requiredPorts = \[3100, 3200, 3700\]/);
  assert.match(stableStartNeeded, /netstat/);
  assert.match(stableStartNeeded, /DESKTOP_RUNTIME_DIR/);
  assert.match(stableStartNeeded, /apiHealth\?\.localStore\?\.path/);
  assert.match(stableStartNeeded, /mock-design-platform/);
  assert.match(stableStartNeeded, /const heartbeatFile = path\.join\(runtimeDir, "keep-alive\.json"\)/);
  assert.match(stableStartNeeded, /Date\.now\(\) - heartbeatUpdatedAt > 30000/);
  assert.match(stableStartNeeded, /isStableRuntimeLauncherPid\(heartbeatPid\)/);
  assert.match(stableStart, /if errorlevel 1/);
  assert.match(stableStart, /if not exist "%DESKTOP_ROOT%\\dist\\apps\\api\\main\.js" call npm\.cmd run build:api/);
  assert.doesNotMatch(stableStart, /call npm\.cmd run build:web/);
  assert.match(stableStart, /web standalone missing; runtime will use Next dev fallback/);
  assert.doesNotMatch(stableStart, /stable:doctor -- --wait --wait-ms=15000 --interval-ms=3000/);
  assert.match(stableStart, /call "%DESKTOP_ROOT%\\keepalive-stable-desktop\.cmd"/);
  const startDevPorts = readText("tools/start-dev-ports.js");
  assert.match(startDevPorts, /SKIP_EXISTING_WEB_BUILD === "1"/);
  assert.match(startDevPorts, /web rebuild skipped for stable startup/);
  assert.match(startDevPorts, /useWebDevServerFallback\(new Error\("web production build is unavailable"\)/);
  assert.doesNotMatch(stableStart, /run-stable-service-window\.cmd/);
  assert.doesNotMatch(stableStart, /SKIP_EXISTING_API_BUILD=1/);
  const stableServiceWindow = readText("run-stable-service-window.cmd");
  assert.match(stableServiceWindow, /set "STABLE_SERVICE_WINDOW=1"/);
  assert.match(stableServiceWindow, /start-stable-desktop\.cmd/);
  const stableKeepalive = readText("keepalive-stable-desktop.cmd");
  assert.match(stableKeepalive, /DESKTOP_ROOT=%%~fI/);
  assert.match(stableKeepalive, /if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\\\.runtime-stable"/);
  assert.match(stableKeepalive, /if not exist "%DESKTOP_ROOT%\\dist\\apps\\api\\main\.js" call npm\.cmd run build:api/);
  assert.match(stableKeepalive, /stable-runtime-launcher\.js/);
  assert.match(stableKeepalive, /set STABLE_RUNTIME_EXIT_CODE=%ERRORLEVEL%/);
  assert.match(stableKeepalive, /if %STABLE_RUNTIME_EXIT_CODE% EQU 0 \(/);
  assert.match(stableKeepalive, /node tools\\stable-start-needed\.js/);
  assert.match(stableKeepalive, /stable-runtime exited cleanly while services are healthy; continuing guard/);
  assert.doesNotMatch(stableKeepalive, /ports:keepalive:mock/);
  const stableKeepalivePs1 = readText("tools/start-stable-keepalive.ps1");
  assert.match(stableKeepalivePs1, /\$Root = \(Resolve-Path \(Join-Path \$PSScriptRoot "\.\."\)\)\.Path/);
  assert.match(stableKeepalivePs1, /\$StableRuntimeLauncherScript = Join-Path \$Root "tools\\stable-runtime-launcher\.js"/);
  assert.match(stableKeepalivePs1, /\$StableRuntimeLauncherArgument = "tools\\stable-runtime-launcher\.js"/);
  assert.match(stableKeepalivePs1, /-FilePath \$NodeExe/);
  assert.match(stableKeepalivePs1, /-ArgumentList @\(\$StableRuntimeLauncherArgument\)/);
  assert.match(stableKeepalivePs1, /-RedirectStandardOutput \$KeepAliveOutLog/);
  assert.match(stableKeepalivePs1, /-RedirectStandardError \$KeepAliveErrLog/);
  assert.match(stableKeepalivePs1, /\$env:STABLE_WECHAT_BRIDGE_MODE = "dispatch"/);
  assert.match(stableKeepalivePs1, /\$env:STABLE_PERSONAL_WECHAT_SEND = "0"/);
  assert.doesNotMatch(stableKeepalivePs1, /if \(\$env:STABLE_PERSONAL_WECHAT_SEND\)/);
  assert.match(stableKeepalivePs1, /function Normalize-ProcessPathEnvironment/);
  assert.match(stableKeepalivePs1, /SetEnvironmentVariable\("Path", \$pathValue, "Process"\)/);
  assert.doesNotMatch(stableKeepalivePs1, /-UseNewEnvironment/);
  assert.doesNotMatch(stableKeepalivePs1, /-FilePath "cmd\.exe"/);
  assert.match(stableKeepalivePs1, /\$StopRequestFile = Join-Path \$RuntimeDir "stable-runtime-stop-request"/);
  assert.match(stableKeepalivePs1, /Remove-Item -Force -ErrorAction Stop -Path \$StopRequestFile/);
  assert.match(stableKeepalivePs1, /stable stop request cleanup unavailable/);
  assert.doesNotMatch(stableKeepalivePs1, /function Write-StableSupervisorCmd/);
  assert.doesNotMatch(stableKeepalivePs1, /tools\\start-dev-ports\.js/);
  assert.doesNotMatch(stableKeepalivePs1, /--mock-design --keep-alive/);
  assert.match(stableKeepalivePs1, /Start-Process `[\s\S]*-FilePath \$NodeExe/);
  assert.match(stableKeepalivePs1, /-ArgumentList @\(\$StableRuntimeLauncherArgument\)/);
  assert.doesNotMatch(stableKeepalivePs1, /-ArgumentList @\("\/d", "\/k"/);
  assert.match(stableKeepalivePs1, /-WindowStyle Hidden[\s\S]*-PassThru/);
  assert.doesNotMatch(stableKeepalivePs1, /\[regex\]::Escape\(\$StableSupervisorCmd\)/);
  assert.match(stableKeepalivePs1, /\$HeartbeatFile = Join-Path \$RuntimeDir "keep-alive\.json"/);
  assert.doesNotMatch(stableKeepalivePs1, /stable supervisor process was not found/);
  assert.match(stableKeepalivePs1, /stable-start\.log/);
  assert.match(stableKeepalivePs1, /\$StableStartingLock = Join-Path \$RuntimeDir "stable-starting\.lock"/);
  assert.match(stableKeepalivePs1, /Set-Content -Path \$StableStartingLock/);
  assert.match(stableKeepalivePs1, /Add-Content -Path \$StartLog[\s\S]*-ErrorAction Stop/);
  assert.match(stableKeepalivePs1, /stable start log unavailable/);
  assert.match(stableKeepalivePs1, /function Find-KeepAliveProcess/);
  assert.match(stableKeepalivePs1, /stable launcher process lookup unavailable/);
  assert.doesNotMatch(stableKeepalivePs1, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(stableKeepalivePs1, /Get-Content -Raw -Path \$HeartbeatFile \| ConvertFrom-Json/);
  assert.match(stableKeepalivePs1, /Get-Process -Id \$processId -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(stableKeepalivePs1, /Get-CimInstance Win32_Process/);
  assert.match(stableKeepalivePs1, /function Wait-StableRuntimeReady/);
  assert.match(stableKeepalivePs1, /AddSeconds\(180\)/);
  assert.match(stableKeepalivePs1, /\$reportedProcessExit = \$false/);
  assert.match(stableKeepalivePs1, /continuing health wait/);
  assert.match(stableKeepalivePs1, /function Test-StableRuntimeHealthy/);
  assert.match(stableKeepalivePs1, /function Start-StableRuntimeProcess/);
  assert.match(stableKeepalivePs1, /\$SupervisorMode = \$env:STABLE_KEEPALIVE_SUPERVISOR -eq "1"/);
  assert.match(stableKeepalivePs1, /function Start-StableSupervisorProcess/);
  assert.match(stableKeepalivePs1, /STABLE_KEEPALIVE_SUPERVISOR = "1"/);
  assert.match(stableKeepalivePs1, /function Invoke-StableSupervisorLoop/);
  assert.match(stableKeepalivePs1, /stable runtime launcher missing; restarting/);
  assert.match(stableKeepalivePs1, /if \(\$SupervisorMode\)/);
  assert.match(stableKeepalivePs1, /Start-StableSupervisorProcess/);
  assert.doesNotMatch(stableKeepalivePs1, /\$LASTEXITCODE -eq 0 -or \(Test-StableRuntimeHealthy\)/);
  assert.match(stableKeepalivePs1, /RedirectStandardOutput/);
  assert.match(stableKeepalivePs1, /RedirectStandardError/);
  assert.match(stableKeepalivePs1, /Test-StableHttp "http:\/\/127\.0\.0\.1:3100\/overview"/);
  assert.match(stableKeepalivePs1, /Test-StableHttp "http:\/\/127\.0\.0\.1:3200\/api\/health"/);
  assert.match(stableKeepalivePs1, /Test-StableHttp "http:\/\/127\.0\.0\.1:3700\/v1\/health"/);
  assert.match(stableKeepalivePs1, /curl\.exe -s -o NUL -w "%\{http_code\}" --max-time 3 \$Url/);
  assert.doesNotMatch(stableKeepalivePs1, /Invoke-WebRequest -UseBasicParsing -TimeoutSec 2/);
  assert.match(stableKeepalivePs1, /stable keepalive supervisor ready pid=/);
  assert.match(stableKeepalivePs1, /stable runtime did not become healthy/);
  assert.doesNotMatch(stableKeepalivePs1, /"-NoExit"/);
  assert.doesNotMatch(stableKeepalivePs1, /"-NoExit"/);
  assert.doesNotMatch(stableKeepalivePs1, /System\.Diagnostics\.ProcessStartInfo/);
  const stableStatus = readText("status-stable-desktop.cmd");
  assert.match(stableStatus, /if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\\\.runtime-stable"/);
  assert.match(stableStatus, /stable:doctor/);
  assert.doesNotMatch(stableStatus, /ports:status:mock/);
  const stableStop = readText("stop-stable-desktop.cmd");
  assert.match(stableStop, /if not defined DESKTOP_RUNTIME_DIR set "DESKTOP_RUNTIME_DIR=%DESKTOP_ROOT%\\\.runtime-stable"/);
  assert.match(stableStop, /FORCE_PORTS_SWEEP=1/);
  assert.match(stableStop, /schtasks\.exe \/Delete \/TN zhinengkefu_stable_runtime \/F/);
  assert.match(stableStop, /ports:stop/);
  const stableRepair = readText("repair-stable-desktop.cmd");
  assert.match(stableRepair, /stop-stable-desktop\.cmd/);
  assert.match(stableRepair, /start-stable-desktop-foreground\.cmd/);
  assert.match(stableRepair, /Keep this window open/);
  const stableLaunch = readText("launch-stable-desktop-app.cmd");
  assert.match(stableLaunch, /start-stable-desktop\.cmd/);
  assert.match(stableLaunch, /repair-stable-desktop\.cmd/);
  assert.doesNotMatch(stableLaunch, /keep that service window open/);
  assert.match(stableLaunch, /pause/);
  assert.match(stableLaunch, /node tools\\launch-stable-electron\.js/);
  const stableLogs = readText("logs-stable-desktop.cmd");
  assert.match(stableLogs, /set "LOG_DIR=%DESKTOP_RUNTIME_DIR%\\logs"/);
  assert.match(stableLogs, /Get-ChildItem/);
  assert.match(stableLogs, /Get-Content/);
  assert.match(stableLogs, /-Tail 40/);

  const projectRoot = path.join(root, "..");
  const desktopStableForeground = fs.readFileSync(path.join(projectRoot, "start-stable-desktop-foreground.cmd"), "utf8");
  assert.match(desktopStableForeground, /%PROJECT_ROOT%\\desktop\\start-stable-desktop-foreground\.cmd/);
  const desktopStableStatus = fs.readFileSync(path.join(projectRoot, "status-stable-desktop.cmd"), "utf8");
  assert.match(desktopStableStatus, /%PROJECT_ROOT%\\desktop\\status-stable-desktop\.cmd/);
  const desktopStableRepair = fs.readFileSync(path.join(projectRoot, "repair-stable-desktop.cmd"), "utf8");
  assert.match(desktopStableRepair, /%PROJECT_ROOT%\\desktop\\repair-stable-desktop\.cmd/);
  const desktopStableLaunch = fs.readFileSync(path.join(projectRoot, "launch-stable-desktop-app.cmd"), "utf8");
  assert.match(desktopStableLaunch, /%PROJECT_ROOT%\\desktop\\launch-stable-desktop-app\.cmd/);
  const desktopStableLogs = fs.readFileSync(path.join(projectRoot, "logs-stable-desktop.cmd"), "utf8");
  assert.match(desktopStableLogs, /%PROJECT_ROOT%\\desktop\\logs-stable-desktop\.cmd/);
  const desktopStableStart = fs.readFileSync(path.join(projectRoot, "start-stable-desktop.cmd"), "utf8");
  assert.match(desktopStableStart, /%PROJECT_ROOT%\\desktop\\start-stable-desktop\.cmd/);
  assert.doesNotMatch(desktopStableStart, /stable-runtime-launcher-local\.js/);
});

test("stable startup entrypoints resolve the active worktree and stay fail-closed", () => {
  const projectRoot = path.resolve(root, "..");
  const readProjectText = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const projectEntrypoints = [
    "launch-stable-desktop-app.cmd",
    "start-stable-desktop.cmd",
    "start-stable-desktop-foreground.cmd",
    "status-stable-desktop.cmd",
    "repair-stable-desktop.cmd",
    "logs-stable-desktop.cmd",
    "run_desktop.bat",
    "verify_desktop.bat",
    "check_desktop.bat",
    "repair_desktop.bat",
    "stop_desktop.bat",
  ];
  const desktopEntrypoints = [
    "launch-stable-desktop-app.cmd",
    "start-stable-desktop.cmd",
    "keepalive-stable-desktop.cmd",
    "start-stable-desktop-foreground.cmd",
    "status-stable-desktop.cmd",
    "stop-stable-desktop.cmd",
    "repair-stable-desktop.cmd",
    "run-stable-service-window.cmd",
    "logs-stable-desktop.cmd",
    "tools/start-stable-keepalive.ps1",
    "apps/electron/main.js",
  ];
  const allEntrypoints = [
    ...projectEntrypoints.map((relativePath) => [relativePath, readProjectText(relativePath)]),
    ...desktopEntrypoints.map((relativePath) => [`desktop/${relativePath}`, readText(relativePath)]),
  ];

  for (const [relativePath, source] of allEntrypoints) {
    assert.doesNotMatch(source, /D:\\zhinengkefu\\desktop|C:\\Users\\27808\\Desktop\\zhinengkefu/i, relativePath);
  }

  for (const relativePath of desktopEntrypoints.filter((value) => value.endsWith(".cmd"))) {
    const source = readText(relativePath);
    assert.match(source, /DESKTOP_ROOT=%%~fI/, relativePath);
    assert.match(source, /if not defined DESKTOP_RUNTIME_DIR/, relativePath);
  }

  for (const relativePath of projectEntrypoints.slice(0, 6)) {
    const source = readProjectText(relativePath);
    assert.match(source, /PROJECT_ROOT=%%~fI/, relativePath);
    assert.match(source, /%PROJECT_ROOT%\\desktop\\/, relativePath);
  }

  for (const relativePath of ["run_desktop.bat", "verify_desktop.bat", "check_desktop.bat", "stop_desktop.bat"]) {
    assert.match(readProjectText(relativePath), /if not defined DESKTOP_RUNTIME_DIR/, relativePath);
  }

  const stableLaunch = readText("launch-stable-desktop-app.cmd");
  const stableStart = readText("start-stable-desktop.cmd");
  const stableKeepalive = readText("keepalive-stable-desktop.cmd");
  const stableForeground = readText("start-stable-desktop-foreground.cmd");
  const stableKeepalivePs1 = readText("tools/start-stable-keepalive.ps1");
  const electronMain = readText("apps/electron/main.js");
  const dependencyResolver = readText("tools/resolve-worktree-node-modules.js");
  const dependencyBootstrap = readText("prepare-stable-dependencies.cmd");
  assert.match(stableLaunch, /WEB_URL=http:\/\/127\.0\.0\.1:3100\/overview/);
  assert.match(electronMain, /process\.env\.WEB_URL \|\| "http:\/\/127\.0\.0\.1:3100\/overview"/);
  assert.match(stableKeepalivePs1, /Test-StableHttp "http:\/\/127\.0\.0\.1:3100\/overview"/);

  for (const [relativePath, source] of [
    ["launch-stable-desktop-app.cmd", stableLaunch],
    ["start-stable-desktop.cmd", stableStart],
    ["keepalive-stable-desktop.cmd", stableKeepalive],
    ["start-stable-desktop-foreground.cmd", stableForeground],
  ]) {
    assert.match(source, /STABLE_WECHAT_BRIDGE_MODE=dispatch/, relativePath);
    assert.match(source, /STABLE_PERSONAL_WECHAT_SEND=0/, relativePath);
  }
  assert.match(stableKeepalivePs1, /\$env:STABLE_WECHAT_BRIDGE_MODE = "dispatch"/);
  assert.match(stableKeepalivePs1, /\$env:STABLE_PERSONAL_WECHAT_SEND = "0"/);
  assert.doesNotMatch(stableKeepalivePs1, /if \(\$env:STABLE_PERSONAL_WECHAT_SEND\)/);
  for (const source of [stableLaunch, stableStart, stableKeepalive, stableForeground]) {
    assert.match(source, /prepare-stable-dependencies\.cmd/);
  }
  assert.match(dependencyBootstrap, /resolve-worktree-node-modules\.js/);
  assert.match(dependencyResolver, /function resolveWorktreeNodeModules\(root\)/);
  assert.doesNotMatch(dependencyResolver, /D:\\zhinengkefu|C:\\Users\\27808/i);
  assert.match(stableLaunch, /node tools\\launch-stable-electron\.js/);
});

test("stable runtime launcher owns one stable runtime and required services", () => {
  const stableRuntime = readText("tools/stable-runtime-launcher.js");
  assert.match(stableRuntime, /const \{ spawn, spawnSync \} = require\("node:child_process"\)/);
  assert.match(stableRuntime, /path\.join\(root, "\.runtime-stable"\)/);
  assert.match(stableRuntime, /const heartbeatFile = path\.join\(runtimeDir, "keep-alive\.json"\)/);
  assert.match(stableRuntime, /stable-runtime-stop-request/);
  assert.match(stableRuntime, /stop request exists; exiting/);
  assert.match(stableRuntime, /installProcessHandlers\(\);/);
  assert.match(stableRuntime, /const runtimeKeepAlive = setInterval\(\(\) => undefined, 60000\);/);
  assert.match(stableRuntime, /runtimeKeepAlive\.ref\(\);/);
  assert.match(stableRuntime, /function installProcessHandlers\(\)/);
  assert.match(stableRuntime, /process\.on\("uncaughtException"/);
  assert.match(stableRuntime, /const specs = \[/);
  assert.match(stableRuntime, /const webStandaloneServerPath = path\.join\(root, "apps", "web", "\.next", "standalone", "apps", "web", "server\.js"\)/);
  assert.match(stableRuntime, /detached: process\.platform === "win32"/);
  assert.match(stableRuntime, /if \(process\.platform === "win32"\) child\.unref\(\)/);
  assert.match(stableRuntime, /const webNextDir = path\.join\(root, "apps", "web", "\.next"\)/);
  assert.match(stableRuntime, /const nextCliPath = path\.join\(root, "node_modules", "next", "dist", "bin", "next"\)/);
  assert.match(stableRuntime, /webServiceSpec\(\)/);
  assert.match(stableRuntime, /function webServiceSpec\(\)/);
  assert.match(stableRuntime, /webStandaloneBuildReady\(\)/);
  assert.match(stableRuntime, /function webStandaloneBuildReady\(\)/);
  assert.match(stableRuntime, /path\.join\(webNextDir, "BUILD_ID"\)/);
  assert.match(stableRuntime, /path\.join\(webNextDir, "required-server-files\.json"\)/);
  assert.match(stableRuntime, /args: \[nextCliPath, "dev", "apps\/web", "-H", "127\.0\.0\.1", "-p", String\(ports\.web\), "--webpack"\]/);
  assert.match(stableRuntime, /expected: \[normalize\(nextCliPath\), "next\/dist\/server\/lib\/start-server\.js"\]/);
  assert.match(stableRuntime, /web standalone build incomplete; using Next dev server fallback/);
  assert.match(stableRuntime, /\{ name: "design-platform-mock", command: process\.execPath, args: \[path\.join\(root, "tools", "mock-design-platform\.js"\)\], port: ports\.mock, expected: normalize\(path\.join\(root, "tools", "mock-design-platform\.js"\)\) \}/);
  assert.match(stableRuntime, /\{ name: "api", command: process\.execPath, args: \[path\.join\(root, "dist", "apps", "api", "main\.js"\)\], port: ports\.api, expected: normalize\(path\.join\(root, "dist", "apps", "api", "main\.js"\)\) \}/);
  assert.match(stableRuntime, /processServiceSpec\("wechat-window-observer", \[path\.join\(root, "tools", "wechat-window-observer\.js"\), "--watch", "--scan"\]/);
  assert.match(stableRuntime, /processServiceSpec\("wechat-bridge-worker", \[path\.join\(root, "tools", "wechat-bridge-worker\.js"\), "--watch"\]/);
  assert.match(stableRuntime, /BRIDGE_MODE: process\.env\.STABLE_WECHAT_BRIDGE_MODE \|\| "dispatch"/);
  assert.match(stableRuntime, /BRIDGE_ACK_TRANSPORT: process\.env\.BRIDGE_ACK_TRANSPORT \|\| "file_scan"/);
  assert.match(stableRuntime, /processServiceSpec\("personal-wechat-bridge", \[path\.join\(root, "tools", "personal-wechat-bridge\.js"\), "--watch"\]/);
  assert.match(stableRuntime, /PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE: path\.join\(runtimeDir, "personal-wechat-accounts\.json"\)/);
  assert.match(stableRuntime, /PERSONAL_WECHAT_SEND: process\.env\.STABLE_PERSONAL_WECHAT_SEND \|\| process\.env\.PERSONAL_WECHAT_SEND \|\| "0"/);
  assert.match(stableRuntime, /for \(const spec of specs\) ensureService\(spec\);/);
  assert.match(stableRuntime, /killStaleRuntimeProcesses\(\);/);
  assert.match(stableRuntime, /setInterval\(\(\) => \{[\s\S]*stop request received; stopping[\s\S]*killStaleRuntimeProcesses\(\);[\s\S]*for \(const spec of specs\) ensureService\(spec\);[\s\S]*\}, 5000\);/);
  assert.match(stableRuntime, /function ensureService\(spec\)/);
  assert.match(stableRuntime, /if \(spec\.type === "process"\)/);
  assert.match(stableRuntime, /function ensureProcessService\(spec\)/);
  assert.match(stableRuntime, /if \(process\.platform === "win32" && spec\.port\)/);
  assert.match(stableRuntime, /existing && isPidAlive\(existing\.pid\) && process\.platform === "win32" && spec\.port/);
  assert.match(stableRuntime, /function startWindowsWrappedPortService\(spec\)/);
  assert.match(stableRuntime, /function buildWindowsPortServiceWrapper\(spec\)/);
  assert.match(stableRuntime, /const windowsProcessQueryTimeoutMs = positiveNumber\(process\.env\.WINDOWS_PROCESS_QUERY_TIMEOUT_MS, 1000\)/);
  assert.match(stableRuntime, /function findLegacyRuntimeProcesses\(\)[\s\S]*timeout: windowsProcessQueryTimeoutMs/);
  assert.match(stableRuntime, /check-loopback-port\.js/);
  assert.match(stableRuntime, /\$\{spec\.port\}/);
  assert.doesNotMatch(stableRuntime, /netstat\.exe -ano -p TCP/);
  assert.doesNotMatch(stableRuntime, /Get-NetTCPConnection -LocalAddress 127\.0\.0\.1/);
  assert.match(stableRuntime, /:restart/);
  assert.match(stableRuntime, /goto restart/);
  const stableSessionDoctor = readText("tools/stable-desktop-doctor.js");
  assert.match(stableSessionDoctor, /readDesktopWebSessionProof\(desktopWebSessionFile\)/);
  assert.match(stableSessionDoctor, /smart_kefu_desktop_session=\$\{proof\}/);
  assert.match(stableSessionDoctor, /Verified desktop session/);
  assert.match(stableRuntime, /SERVICE_EXIT_CODE/);
  assert.match(stableRuntime, /if exist \$\{cmdQuote\(stopRequestFile\)\} exit \/b 0/);
  assert.match(stableRuntime, /const out = openServiceLogForAppend\(spec\.name, "out"\)/);
  assert.match(stableRuntime, /const err = openServiceLogForAppend\(spec\.name, "err"\)/);
  assert.match(stableRuntime, /function openServiceLogForAppend\(name, streamName\)/);
  assert.match(stableRuntime, /return "ignore"/);
  assert.match(stableRuntime, /function append\(name, message\)[\s\S]*catch \{\}/);
  assert.match(stableRuntime, /function processServiceSpec\(name, args, env = \{\}\)/);
  assert.match(stableRuntime, /LOW_VALUE_AUTOMATION_ENABLED: "true"/);
  assert.match(stableRuntime, /LOW_VALUE_AUTOMATION_RUN_ON_START: "true"/);
  assert.match(stableRuntime, /WECHAT_BRIDGE_OUTBOX_DIR: path\.join\(runtimeDir, "wechat-outbox"\)/);
  assert.match(stableRuntime, /WECHAT_BRIDGE_INBOX_DIR: path\.join\(runtimeDir, "wechat-inbox"\)/);
  assert.match(stableRuntime, /WECHAT_BRIDGE_DISPATCH_DIR: path\.join\(runtimeDir, "wechat-dispatch"\)/);
  assert.match(stableRuntime, /WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: path\.join\(runtimeDir, "wechat-window-snapshots"\)/);
  assert.match(stableRuntime, /DESIGN_PLATFORM_ADAPTER: "standard_v1"/);
  assert.match(stableRuntime, /DESIGN_PLATFORM_BASE_URL: `http:\/\/127\.0\.0\.1:\$\{ports\.mock\}`/);
  assert.match(stableRuntime, /writeWebRuntimeServer\(\)/);
  assert.match(stableRuntime, /writeDesignConfig\(\)/);
  assert.match(stableRuntime, /writeHeartbeat\(\)/);
  assert.match(stableRuntime, /const existing = children\.get\(spec\.name\);/);
  assert.match(stableRuntime, /if \(existing && owners\.includes\(existing\.pid\)\) return;/);
  assert.match(stableRuntime, /const match = ownerMatches\(pid, spec\.expected\);/);
  assert.match(stableRuntime, /match === "unknown" && portHealthMatches\(spec\)/);
  assert.match(stableRuntime, /accepted by health check/);
  assert.match(stableRuntime, /port \$\{spec\.port\} owned by wrong pid\(s\)/);
  assert.match(stableRuntime, /wrongOwners\.join\(","\)/);
  assert.match(stableRuntime, /for \(const pid of wrongOwners\) killPid\(pid\);/);
  assert.match(stableRuntime, /if \(!existing && owners\.length && portHealthMatches\(spec\)\)/);
  assert.match(stableRuntime, /adopting externally managed service/);
  assert.match(stableRuntime, /const unmanagedOwners = owners\.filter\(\(pid\) => \{/);
  assert.match(stableRuntime, /ownerMatches\(pid, spec\.expected\) === true && isDescendantPid\(pid, existing\.pid\)/);
  assert.match(stableRuntime, /owned by unmanaged matching pid\(s\)/);
  assert.match(stableRuntime, /killing for runtime isolation/);
  assert.match(stableRuntime, /function ownerMatches\(pid, expected\)/);
  assert.match(stableRuntime, /const expectedMarkers = Array\.isArray\(expected\) \? expected : \[expected\]/);
  assert.match(stableRuntime, /expectedMarkers\.some\(\(marker\) => commandLine\.includes\(marker\)\)/);
  assert.match(stableRuntime, /function portHealthMatches\(spec\)/);
  assert.match(stableRuntime, /normalize\(json\?\.localStore\?\.path\) === normalize\(localStoreFile\)/);
  assert.match(stableRuntime, /smart_kefu_desktop_session=\$\{desktopWebSession\.proof\}/);
  assert.match(stableRuntime, /function requestJson\(url, headers = \[\]\)/);
  assert.match(stableRuntime, /function requestOk\(url\)/);
  assert.match(stableRuntime, /function commandLineForPid\(pid\)/);
  assert.match(stableRuntime, /function isDescendantPid\(pid, ancestorPid\)/);
  assert.match(stableRuntime, /function parentPidForPid\(pid\)/);
  assert.match(stableRuntime, /ParentProcessId/);
  assert.match(stableRuntime, /function killPid\(pid\)/);
  assert.match(stableRuntime, /function closeFd\(value\)/);
  assert.match(stableRuntime, /removed stale launcher pid file/);
  assert.match(stableRuntime, /if \(!isPidAlive\(existingPid\)\)/);
  assert.match(stableRuntime, /function openServiceLogForAppend\(name, streamName\)/);
  assert.match(stableRuntime, /return "ignore";/);
  assert.match(stableRuntime, /function append\(name, message\) \{[\s\S]*try \{[\s\S]*fs\.appendFileSync/);
  assert.match(stableRuntime, /catch \{\}/);
  assert.match(stableRuntime, /function killStaleRuntimeProcesses\(\)/);
  assert.match(stableRuntime, /function findLegacyRuntimeProcesses\(\)/);
  assert.match(stableRuntime, /killing legacy runtime process pid\(s\)/);
  assert.match(stableRuntime, /ports:keepalive:mock/);
  assert.match(stableRuntime, /tools\/start-dev-ports\.js/);
  assert.match(stableRuntime, /commandLine\.includes\(stableMarker\)/);
  assert.match(stableRuntime, /require\("\.\/stable-runtime-process-classifier"\)/);
  assert.match(stableRuntime, /commandLineReferencesNestedLegacyRuntime\(commandLine, normalizedRoot, legacyRuntimeMarker\)/);
  const stableDoctor = readText("tools/stable-desktop-doctor.js");
  assert.match(stableDoctor, /checkStableRuntimeVersion\(portOwners\)/);
  assert.match(stableDoctor, /direct service mode healthy pid=/);
  assert.match(stableDoctor, /directServicePids\.length >= 3/);
  assert.match(stableDoctor, /\$outsideCurrentRoot = \$normalizedCommand\.Replace\(\$root, ''\)/);
  assert.match(stableDoctor, /\$outsideCurrentRoot\.Contains\('\/\.runtime\/'\)/);
  assert.match(stableDoctor, /\$isNamedLegacyRuntime -or \$isNestedLegacyRuntime/);
  assert.doesNotMatch(stableDoctor, /"\s+\([^"\r\n]+\) -or",/);
});

test("electron startup failure points beginners to stable repair script", () => {
  const electronMain = readText("apps/electron/main.js");
  assert.match(electronMain, /const APP_TITLE = process\.env\.DESKTOP_APP_TITLE \|\| "智能体客服工作台";/);
  assert.match(electronMain, /normalizeDesktopInstanceId\(process\.env\.DESKTOP_INSTANCE_ID\)/);
  assert.match(electronMain, /persist:smart-kefu-desktop-\$\{DESKTOP_INSTANCE_ID\}/);
  assert.match(electronMain, /DESKTOP_INSTANCE_ID === "default"[\s\S]*app\.requestSingleInstanceLock\(\)[\s\S]*acquireNamedInstanceLock\(\)/);
  assert.match(electronMain, /fs\.openSync\(lockFile, "wx", 0o600\)/);
  assert.match(electronMain, /releaseNamedInstanceLock\(\)/);
  const stableElectron = readText("tools/launch-stable-electron.js");
  assert.match(stableElectron, /electron-user-data", instanceId/);
  assert.match(stableElectron, /electronArgs\.push\(`--user-data-dir=\$\{userDataDir\}`\)/);
  assert.match(stableElectron, /spawn\(electronPath, electronArgs/);
  assert.match(electronMain, /repair-stable-desktop\.cmd/);
  assert.match(electronMain, /保持服务窗口打开/);
  assert.doesNotMatch(electronMain, /璇峰厛杩愯 start-stable-desktop\.cmd/);
});

test("modular desktop has an isolated named runtime entrypoint", () => {
  const launch = readText("launch-isolated-modular-desktop.cmd");
  const status = readText("status-isolated-modular-desktop.cmd");
  const stop = readText("stop-isolated-modular-desktop.cmd");
  const resolver = readText("tools/resolve-ui-version-runtime.js");
  assert.match(launch, /resolve-ui-version-runtime\.js" modular/);
  assert.match(launch, /WEB_PORT=3110/);
  assert.match(launch, /API_PORT=3210/);
  assert.match(launch, /MOCK_DESIGN_PLATFORM_PORT=3710/);
  assert.match(launch, /DESKTOP_INSTANCE_ID=modular/);
  assert.match(launch, /launch-stable-desktop-app\.cmd/);
  assert.match(status, /status-stable-desktop\.cmd/);
  assert.match(stop, /stop-stable-desktop\.cmd/);
  assert.match(resolver, /--git-common-dir/);
  assert.match(resolver, /"\.runtime", "ui-versions", `runtime-\$\{profile\}`/);
});

test("port stack launcher blocks mock when real mode is active and starts supervised services", () => {
  const launcher = readText("tools/ports-stack-starter.js");
  assert.match(launcher, /const realModeLockFile = path\.join\(runtimeDir, "real-mode\.lock"\);/);
  assert.match(launcher, /const designPlatformConfigFile = path\.join\(runtimeDir, "design-platform-config\.json"\);/);
  assert.match(launcher, /const preferredDesignModeFile = path\.join\(runtimeDir, "preferred-design-mode\.json"\);/);
  assert.match(launcher, /const stackStarterLockFile = path\.join\(runtimeDir, `ports-stack-starter-\$\{supervisorMode\}\.lock`\);/);
  assert.match(launcher, /let stackStarterLockHeld = false;/);
  assert.match(launcher, /const http = require\("node:http"\);/);
  assert.match(launcher, /const normalizedOwnerRoots = \[desktopRoot, runtimeDir\]\.map\(normalizePathText\)\.filter\(Boolean\);/);
  assert.match(launcher, /!normalizedOwnerRoots\.some\(\(ownerRoot\) => commandLine\.includes\(ownerRoot\)\)/);
  assert.match(launcher, /main\(\)\.catch/);
  assert.match(launcher, /async function main\(\)/);
  assert.match(launcher, /activeApiLooksRealDesignMode\(\)/);
  assert.match(launcher, /const activeApiRealMode = mockDesignMode \? await activeApiLooksRealDesignMode\(\) : false;/);
  assert.match(launcher, /const activeRealLaunchers = mockDesignMode \? findConflictingDesignLaunchers\("real"\) : \[\];/);
  assert.doesNotMatch(launcher, /const staleRealStateCanBeOverridden =/);
  assert.match(launcher, /runtimeConfigLooksRealDesignMode\(\)/);
  assert.match(launcher, /writeRealDesignRuntimeConfig\(\);/);
  assert.match(launcher, /function writeRealDesignRuntimeConfig\(\)/);
  assert.match(launcher, /function readRuntimeDesignPlatformConfig\(\)/);
  assert.match(launcher, /writePreferredDesignMode\(realDesignMode \? "real" : "mock"\);/);
  assert.match(launcher, /function writePreferredDesignMode\(mode\)/);
  assert.match(launcher, /function readPreferredDesignMode\(\)/);
  assert.match(launcher, /function realDesignBaseUrl\(\)/);
  assert.match(launcher, /designPlatformAdapter: "art_image_local"/);
  assert.match(launcher, /designPlatformBaseUrl: realDesignBaseUrl\(\)/);
  assert.match(launcher, /mock design launch is blocked because real design mode is locked, configured, or preferred/);
  assert.match(launcher, /Set FORCE_MOCK_DESIGN_START=1 before switching to mock design mode/);
  assert.match(launcher, /active API is using the real design platform/);
  assert.match(launcher, /if \(mockDesignMode && activeApiRealMode && !allowMockDesignStart\) \{/);
  assert.match(launcher, /a real design launcher is still running/);
  assert.doesNotMatch(launcher, /removed stale real design mode state before explicit mock design launch/);
  assert.match(launcher, /fs\.existsSync\(realModeLockFile\) \|\| runtimeConfigRealMode \|\| preferredRealMode/);
  assert.doesNotMatch(launcher, /function clearStaleRealDesignRuntimeState\(\)/);
  assert.match(launcher, /designPlatformAdapter === "art_image_local"/);
  assert.match(launcher, /health\?\.adapter === "art_image_local"/);
  assert.match(launcher, /api\/integrations\/design-platform\/health/);
  assert.match(launcher, /function getJson\(url, timeoutMs = 1500\)/);
  assert.match(launcher, /if \(await activeStackMatchesRequestedMode\(\)\) \{/);
  assert.match(launcher, /design stack is already running; skipping duplicate launch/);
  assert.match(launcher, /if \(!\(await acquireStackStarterLockOrWait\(\)\)\) return;/);
  assert.match(launcher, /finally \{\s+releaseStackStarterLock\(\);/);
  assert.match(launcher, /async function activeStackMatchesRequestedMode\(\)/);
  assert.match(launcher, /return \(await activeStackReadiness\(\)\)\.ok && keepAliveHeartbeatIsFresh\(\);/);
  assert.match(launcher, /async function activeStackReadiness\(\)/);
  assert.match(launcher, /const webRuntimeMismatch = webPortRuntimeMismatchReason\(webPids\);/);
  assert.match(launcher, /api local store is outside current runtime/);
  assert.match(launcher, /function webPortRuntimeMismatchReason\(pids\)/);
  assert.match(launcher, /function apiHealthUsesRuntimeDir\(apiHealth, expectedRuntimeDir = runtimeDir\)/);
  assert.match(launcher, /async function acquireStackStarterLockOrWait\(\)/);
  assert.match(launcher, /design stack startup is already running under PID/);
  assert.match(launcher, /function windowsProcessLooksLikeStackStarter\(pid\)/);
  assert.match(launcher, /Get-CimInstance Win32_Process -Filter "ProcessId = \$\{Number\(pid\)\}"/);
  assert.match(launcher, /commandLine\.includes\(normalizePathText\(desktopRoot\)\)/);
  assert.match(launcher, /function releaseStackStarterLock\(\)/);
  assert.match(launcher, /process\.once\("exit", releaseStackStarterLock\)/);
  assert.match(launcher, /function httpOk\(url, timeoutMs = 1500\)/);
  assert.match(launcher, /fs\.writeFileSync\(realModeLockFile/);
  assert.match(launcher, /PRESERVE_REAL_MODE_LOCK: realDesignMode \? "1" : ""/);
  assert.match(launcher, /PRESERVE_MOCK_REPAIR_LOCK: mockRepairLockIsFresh\(\) \? "1" : ""/);
  assert.match(launcher, /managedPortsAreFree\(\)/);
  assert.match(launcher, /stale process race, but managed ports are free/);
  assert.match(launcher, /function getPortOwnerPids\(port\)/);
  assert.match(launcher, /const requestedRealDesignMode = args\.has\("--real-design"\);/);
  assert.match(launcher, /const preferredDesignMode = readPreferredDesignMode\(\);/);
  assert.match(launcher, /const stableRuntimeDir = path\.join\(desktopRoot, "\.runtime-stable"\);/);
  assert.match(launcher, /const stableStartingLockFile = path\.join\(stableRuntimeDir, "stable-starting\.lock"\);/);
  assert.match(launcher, /const stableKeepAliveHeartbeatFile = path\.join\(stableRuntimeDir, "keep-alive\.json"\);/);
  assert.match(launcher, /const stableRuntimeLauncherPidFile = path\.join\(stableRuntimeDir, "stable-runtime-launcher\.pid"\);/);
  assert.match(launcher, /if \(await stableDesktopGuardActive\(\)\)/);
  assert.match(launcher, /async function stableDesktopGuardActive\(\)/);
  assert.match(launcher, /ALLOW_LEGACY_START_WITH_STABLE/);
  assert.match(launcher, /stableStartingLockActive\(\) \|\| heartbeatFresh\(stableKeepAliveHeartbeatFile, 3_600_000\)/);
  assert.match(launcher, /stable desktop runtime guard is active; legacy start-dev-ports skipped/);
  assert.match(launcher, /async function stableRuntimeServicesHealthy\(\)/);
  assert.match(launcher, /apiHealthUsesRuntimeDir\(apiHealth, stableRuntimeDir\)/);
  assert.match(launcher, /function apiHealthUsesRuntimeDir\(apiHealth, expectedRuntimeDir = runtimeDir\)/);
  assert.match(launcher, /function stableStartingLockActive\(\)/);
  assert.match(launcher, /fileFresh\(stableStartingLockFile, 10 \* 60_000\)/);
  assert.match(launcher, /if \(!fileFresh\(stableStartingLockFile, 3600000\)\) return false;/);
  assert.match(launcher, /stableRuntimeLauncherProcessActive\(readNumericFile\(stableRuntimeLauncherPidFile\)\)/);
  assert.match(launcher, /function stableRuntimeLauncherProcessActive\(pid\)/);
  assert.match(launcher, /tools\/stable-runtime-launcher\.js/);
  assert.match(launcher, /function findStableRuntimeLauncherProcesses\(\)/);
  assert.match(launcher, /const realDesignMode =\s+requestedRealDesignMode \|\|/);
  assert.match(launcher, /const modeArg = realDesignMode \? "--real-design" : "--mock-design";/);
  assert.match(launcher, /const mockRepairLockFile = path\.join\(runtimeDir, "mock-repair\.lock"\);/);
  assert.match(launcher, /ALLOW_REAL_DESIGN_LAUNCH/);
  assert.match(launcher, /CONFIRM_REAL_DESIGN_SWITCH/);
  assert.match(launcher, /real design launch is disabled by default/);
  assert.match(launcher, /run_desktop_real_design\.bat/);
  assert.match(launcher, /ports:launch:real:confirmed/);
  assert.match(launcher, /real design launch is blocked because default mock startup repair is in progress/);
  assert.match(launcher, /function mockRuntimeStateIsActive\(\)/);
  assert.match(launcher, /real design launch is blocked because mock design mode is active/);
  assert.match(launcher, /const conflictMode = realDesignMode \? "mock" : "real";/);
  assert.match(launcher, /if \(realDesignMode && fs\.existsSync\(mockModeLockFile\)\) \{/);
  assert.match(launcher, /Real design launch is blocked because mock mode is locked/);
  assert.doesNotMatch(launcher, /removed stale mock mode lock before real design launch/);
  assert.match(launcher, /disableConflictingLaunchers\(\);/);
  assert.match(launcher, /function disableConflictingLaunchers\(\)/);
  assert.match(launcher, /`launch-\$\{conflictMode\}\.cmd`/);
  assert.match(launcher, /`supervise-\$\{conflictMode\}\.cmd`/);
  assert.match(launcher, /`stable-supervise-\$\{conflictMode\}\.cmd`/);
  assert.match(launcher, /blocked stale \$\{conflictMode\}-design launcher/);
  assert.match(launcher, /spawnSync\(process\.execPath, \["tools\/stop-dev-ports\.js"\]/);
  assert.match(launcher, /PORTS_STACK_STARTER_PID: String\(process\.pid\)/);
  assert.match(launcher, /PORTS_STACK_STARTER_PARENT_PID: String\(process\.ppid\)/);
  assert.match(launcher, /PORTS_STACK_STARTER_MODE: realDesignMode \? "real" : "mock"/);
  assert.match(launcher, /PORTS_STOP_SKIP_STACK_STARTERS: "1"/);
  assert.match(launcher, /if \(allowMockDesignStart\) env\.FORCE_MOCK_DESIGN_START = "1";/);
  assert.doesNotMatch(launcher, /allowMockDesignStart = .*requestedMockDesignMode/);
  assert.match(launcher, /env\.DESIGN_PLATFORM_ADAPTER = "standard_v1";/);
  assert.match(launcher, /env\.DESIGN_PLATFORM_BASE_URL = "http:\/\/127\.0\.0\.1:3700";/);
  assert.match(launcher, /env\.DESIGN_PLATFORM_ADAPTER = "art_image_local";/);
  assert.match(launcher, /env\.DESIGN_PLATFORM_BASE_URL = realDesignBaseUrl\(\);/);
  assert.match(launcher, /env\.ALLOW_REAL_DESIGN_START = "1";/);
  assert.match(launcher, /spawn\(process\.execPath, \["tools\/start-dev-ports\.js", modeArg, "--keep-alive"\]/);
  assert.match(launcher, /detached: true/);
  assert.match(launcher, /child\.unref\(\)/);
  assert.match(launcher, /await waitForStartedStack\(\);/);
  assert.match(launcher, /supervisor readiness failed; falling back to direct keep-alive/);
  assert.match(launcher, /supervisor did not produce a ready stack; falling back to direct keep-alive startup/);
  assert.match(launcher, /PORTS_STACK_SUPERVISOR_READY_TIMEOUT_MS/);
  assert.match(launcher, /waitForStartedStack\(numberEnv\("PORTS_STACK_SUPERVISOR_READY_TIMEOUT_MS", 15000\)\)/);
  assert.match(launcher, /launchDirectKeepAlive\(env\);[\s\S]*await waitForStartedStack\(\);/);
  assert.match(launcher, /async function waitForStartedStack\(timeoutMs = numberEnv\("PORTS_STACK_READY_TIMEOUT_MS", 120000\)\)/);
  assert.match(launcher, /const stack = await activeStackReadiness\(\);/);
  assert.match(launcher, /const heartbeat = keepAliveHeartbeatReadiness\(\);/);
  assert.match(launcher, /waiting for \$\{realDesignMode \? "real" : "mock"\} design stack/);
  assert.match(launcher, /lastReason/);
  assert.match(launcher, /function keepAliveHeartbeatIsFresh\(\)/);
  assert.match(launcher, /function keepAliveHeartbeatReadiness\(\)/);
  assert.match(launcher, /PORTS_STACK_READY_TIMEOUT_MS/);
  assert.match(launcher, /function sleep\(ms\)/);
  assert.match(launcher, /const child = spawn\(process\.execPath, \["tools\/start-dev-ports\.js", modeArg, "--keep-alive"\]/);
  assert.match(launcher, /activeStackMatchesRequestedMode\(\)/);
  assert.match(launcher, /skipping duplicate launch/);
  assert.doesNotMatch(launcher, /process\.exit\(0\);/);
  assert.match(launcher, /process\.exitCode = result\.status \|\| 1;/);
  assert.match(launcher, /process\.exitCode = stopResult\.status \|\| 1;/);
  assert.match(launcher, /finally \{\s+releaseStackStarterLock\(\);\s+\}/);
  assert.match(launcher, /process\.exit\(1\);/);
  assert.doesNotMatch(launcher, /mockDesignMode && \(fs\.existsSync\(realModeLockFile\) \|\| activeApiLooksRealDesignMode\(\) \|\| runtimeConfigLooksRealDesignMode\(\)\)/);

  const supervisorPs1 = readText("tools/desktop-service-supervisor.ps1");
  assert.match(supervisorPs1, /\$RealModeLockFile = Join-Path \$RuntimeDir "real-mode\.lock"/);
  assert.match(supervisorPs1, /\$StableConflictingLauncherCmd = Join-Path \$RuntimeDir/);
  assert.match(supervisorPs1, /stable-supervise-mock\.cmd/);
  assert.match(supervisorPs1, /stable-supervise-real\.cmd/);
  assert.match(supervisorPs1, /Mock design launch is blocked because real mode is active/);
  assert.match(supervisorPs1, /Find-ConflictingDesignLaunchers -TargetMode "real"/);
  assert.match(supervisorPs1, /\$DesignPlatformConfigFile = Join-Path \$RuntimeDir "design-platform-config\.json"/);
  assert.match(supervisorPs1, /\$PreferredDesignModeFile = Join-Path \$RuntimeDir "preferred-design-mode\.json"/);
  assert.match(supervisorPs1, /function Test-RuntimeConfigRealMode/);
  assert.match(supervisorPs1, /function Test-PreferredDesignModeReal/);
  assert.match(supervisorPs1, /function Write-PreferredDesignMode/);
  assert.match(supervisorPs1, /Write-PreferredDesignMode "real"/);
  assert.match(supervisorPs1, /Write-PreferredDesignMode "mock"/);
  assert.match(supervisorPs1, /\$env:FORCE_MOCK_DESIGN_START -ne "1"/);
  assert.match(supervisorPs1, /function Update-RealModeLock/);
  assert.match(supervisorPs1, /Update-RealModeLock/);
  assert.match(supervisorPs1, /Set-Content -Path \$StableConflictingLauncherCmd/);
  assert.match(supervisorPs1, /\$nodeLine = .+tools\/start-dev-ports\.js.+\$ModeArg.+--keep-alive/);
  assert.match(supervisorPs1, /":restart"/);
  assert.match(supervisorPs1, /"goto restart"/);
  assert.match(supervisorPs1, /Write-Output "\[supervisor\] node tools\/start-dev-ports\.js \$ModeArg --keep-alive pid=/);
  assert.match(supervisorPs1, /\$env:PORTS_STACK_STARTER_PID = \[string\]\$PID/);
  assert.match(supervisorPs1, /\$env:PORTS_STACK_STARTER_MODE = \$Mode/);
  assert.match(supervisorPs1, /\$env:PRESERVE_REAL_MODE_LOCK = "1"/);
  assert.match(supervisorPs1, /ConvertTo-CmdEnvLine "ALLOW_REAL_DESIGN_START" "1"/);
  assert.match(supervisorPs1, /ConvertTo-CmdEnvLine "ALLOW_REAL_DESIGN_LAUNCH" "1"/);
  assert.match(supervisorPs1, /ConvertTo-CmdEnvLine "CONFIRM_REAL_DESIGN_SWITCH" "1"/);
  const supervisorPs1Main = supervisorPs1.slice(supervisorPs1.indexOf("New-Item -ItemType Directory"));
  assert.ok(
    supervisorPs1Main.indexOf("Assert-ModeSwitchAllowed") < supervisorPs1Main.indexOf("Stop-ConflictingDesktopServices"),
    "desktop-service-supervisor.ps1 must check mode locks before stopping conflicting services",
  );

  const supervisorJs = readText("tools/desktop-service-supervisor.js");
  assert.match(supervisorJs, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
  assert.match(supervisorJs, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
  assert.match(supervisorJs, /--supervisor-child/);
  assert.match(supervisorJs, /main\(\)\.catch/);
  assert.match(supervisorJs, /stableDesktopGuardActive/);
  assert.match(supervisorJs, /if \(await stableDesktopGuardActive\(\)\)/);
  assert.match(supervisorJs, /await runSupervisorLoop\(\)/);
  assert.match(supervisorJs, /async function runSupervisorLoop\(\)/);
  assert.match(supervisorJs, /if \(await stableDesktopGuardActive\(\)\)[\s\S]*stable desktop runtime became active/);
  assert.match(supervisorJs, /async function stableDesktopGuardActive\(\)/);
  assert.match(supervisorJs, /const processActive = stableStartingLockActive\(\) \|\| heartbeatFresh\(stableKeepAliveHeartbeatFile, 3_600_000\)/);
  assert.match(supervisorJs, /if \(await stableRuntimeServicesHealthy\(\)\) return true/);
  assert.match(supervisorJs, /ignored stale stable desktop runtime guard/);
  assert.match(supervisorJs, /async function stableRuntimeServicesHealthy\(\)/);
  assert.match(supervisorJs, /fileFresh\(stableStartingLockFile, 10 \* 60_000\)/);
  assert.doesNotMatch(supervisorJs, /if exist \$\{cmdQuote\(stableStartingLockFile\)\} exit \/b 0/);
  assert.doesNotMatch(supervisorJs, /if exist \$\{cmdQuote\(stableKeepAliveHeartbeatFile\)\} exit \/b 0/);
  assert.match(supervisorJs, /stable desktop runtime is active; legacy supervisor skipped/);
  assert.doesNotMatch(supervisorJs, /removed stale real mode lock before mock launch/);
  assert.match(supervisorJs, /removed stale mock mode lock before real design startup/);
  assert.match(supervisorJs, /const stableConflictingLauncherCmd = path\.join/);
  assert.match(supervisorJs, /const legacyLauncherCmd = path\.join/);
  assert.match(supervisorJs, /const stableLauncherCmd = path\.join/);
  assert.match(supervisorJs, /stable-supervise-mock\.cmd/);
  assert.match(supervisorJs, /stable-supervise-real\.cmd/);
  assert.match(supervisorJs, /findConflictingDesignLaunchers\("real"\)\.length/);
  assert.match(supervisorJs, /desktop-service-supervisor\.js/);
  assert.match(supervisorJs, /const designPlatformConfigFile = path\.join\(runtimeDir, "design-platform-config\.json"\);/);
  assert.match(supervisorJs, /const preferredDesignModeFile = path\.join\(runtimeDir, "preferred-design-mode\.json"\);/);
  assert.match(supervisorJs, /const keepAliveHeartbeatFile = path\.join\(runtimeDir, "keep-alive\.json"\);/);
  assert.match(supervisorJs, /\(\(runtimeConfigLooksRealDesignMode\(\) \|\| preferredDesignModeIsReal\(\)\) && process\.env\.FORCE_MOCK_DESIGN_START !== "1"\)/);
  assert.match(supervisorJs, /function preferredDesignModeIsReal\(\)/);
  assert.match(supervisorJs, /function writePreferredDesignMode\(mode\)/);
  assert.match(supervisorJs, /writePreferredDesignMode\("real"\)/);
  assert.match(supervisorJs, /writePreferredDesignMode\("mock"\)/);
  assert.match(supervisorJs, /\[conflictingLauncherCmd, legacyConflictingLauncherCmd, stableConflictingLauncherCmd\]/);
  assert.match(supervisorJs, /writeActiveLaunchers\(\);/);
  assert.match(supervisorJs, /function writeActiveLaunchers\(\)/);
  assert.match(supervisorJs, /\[launcherCmd, legacyLauncherCmd, stableLauncherCmd\]/);
  assert.match(supervisorJs, /PORTS_STACK_STARTER_PID: String\(process\.pid\)/);
  assert.match(supervisorJs, /PORTS_STACK_STARTER_PARENT_PID: String\(process\.ppid\)/);
  assert.match(supervisorJs, /PORTS_STACK_STARTER_MODE: realDesignMode \? "real" : "mock"/);
  assert.match(supervisorJs, /PRESERVE_REAL_MODE_LOCK: realDesignMode \? "1" : ""/);
  assert.match(supervisorJs, /PRESERVE_MOCK_REPAIR_LOCK: mockRepairLockIsFresh\(\) \? "1" : ""/);
  assert.match(supervisorJs, /const detachedSupervisorChild = spawnSupervisorChildDetached\(\);/);
  assert.match(supervisorJs, /function spawnSupervisorChildDetached\(\)/);
  assert.match(supervisorJs, /detached: true/);
  assert.match(supervisorJs, /const supervisorChildResult = startSupervisorChild\(\);/);
  assert.match(supervisorJs, /function startSupervisorChild\(\)/);
  assert.match(supervisorJs, /function startSupervisorChildScheduled\(\)/);
  assert.match(supervisorJs, /New-ScheduledTaskAction/);
  assert.match(supervisorJs, /Register-ScheduledTask/);
  assert.match(supervisorJs, /Start-ScheduledTask/);
  assert.match(supervisorJs, /Unregister-ScheduledTask/);
  assert.match(supervisorJs, /function spawnPowerShell\(script\)/);
  assert.match(supervisorJs, /function processIdFromResult\(result\)/);
  assert.match(supervisorJs, /function waitForDurableSupervisorPid\(pid\)/);
  assert.match(supervisorJs, /function processIsRunning\(pid\)/);
  assert.match(supervisorJs, /function keepAliveHeartbeatIsFresh\(\)/);
  assert.match(supervisorJs, /if \(keepAliveHeartbeatIsFresh\(\)\) return true;/);
  assert.match(supervisorJs, /SUPERVISOR_DURABILITY_CHECK_MS/);
  assert.match(supervisorJs, /function nonDurableSupervisorFallbackAllowed\(\)/);
  assert.match(supervisorJs, /ALLOW_NON_DURABLE_SUPERVISOR_FALLBACK/);
  assert.match(supervisorJs, /Durable Windows supervisor launch failed/);
  assert.match(supervisorJs, /function scheduledTaskStartTime\(\)/);
  assert.match(supervisorJs, /"tools\/desktop-service-supervisor\.js"/);
  assert.match(supervisorJs, /"--supervisor-child"/);
  assert.match(supervisorJs, /Start-Process -FilePath \$\{psQuote\(process\.execPath\)\}/);
  assert.match(supervisorJs, /-ArgumentList \$\{psArray\(/);
  assert.match(supervisorJs, /function psArray\(values\)/);
  assert.match(supervisorJs, /const launcherCommandLine = `cmd\.exe \/d \/c \$\{cmdQuote\(launcherCmd\)\}`;/);
  assert.match(supervisorJs, /const launcherCreateResult = createWindowsProcess\(launcherCommandLine\);/);
  assert.match(supervisorJs, /const supervisorCommandLine = buildSupervisorCommandLine\(\);/);
  assert.match(supervisorJs, /function buildSupervisorCommandLine\(\)/);
  assert.match(supervisorJs, /\.\.\.launcherModeEnv\(\)/);
  assert.match(supervisorJs, /\.\.\.launcherEnvKeys\(\)/);
  assert.match(supervisorJs, /process\.env\.ALLOW_REAL_DESIGN_LAUNCH = "1";/);
  assert.match(supervisorJs, /process\.env\.CONFIRM_REAL_DESIGN_SWITCH = "1";/);
  assert.match(supervisorJs, /cmdSetArg\("ALLOW_REAL_DESIGN_LAUNCH", "1"\)/);
  assert.match(supervisorJs, /cmdSetArg\("CONFIRM_REAL_DESIGN_SWITCH", "1"\)/);
  assert.match(supervisorJs, /const supervisorCreateResult = createWindowsProcess\(supervisorCommandLine\);/);
  assert.match(supervisorJs, /if \(waitForDurableSupervisorPid\(pid\)\) \{/);
  assert.match(supervisorJs, /Win32_Process node supervisor pid=\$\{pid \|\| "unknown"\} exited before durable startup; trying fallback/);
  assert.match(supervisorJs, /if \(waitForDurableSupervisorPid\(launcherPid\)\) \{/);
  assert.match(supervisorJs, /Start-Process launcher pid=\$\{launcherPid \|\| "unknown"\} exited before durable startup; trying fallback/);
  assert.match(supervisorJs, /if \(waitForDurableSupervisorPid\(childPid\)\) \{/);
  assert.match(supervisorJs, /Start-Process supervisor child pid=\$\{childPid \|\| "unknown"\} exited before durable startup; trying fallback/);
  assert.match(supervisorJs, /function createWindowsProcess\(commandLine\)/);
  assert.match(supervisorJs, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(supervisorJs, /const launcherResult = startLauncherProcess\(launcherCmd\);/);
  assert.ok(supervisorJs.includes("const isCmd = /\\.cmd$/i.test(filePath);"));
  assert.ok(supervisorJs.includes('const file = isCmd ? "cmd.exe" : filePath;'));
  assert.ok(supervisorJs.includes('const argumentList = isCmd ? ["/d", "/c", filePath] : [];'));
  assert.ok(supervisorJs.includes("Start-Process -FilePath ${psQuote(file)}${argumentListScript}"));
  assert.match(supervisorJs, /\[supervisor\] \$\{path\.basename\(launcherCmd\)\} pid=\$\{launcherPid\}/);
  const supervisorJsMain = supervisorJs.slice(
    supervisorJs.indexOf("function main()"),
    supervisorJs.indexOf("function spawnSupervisorChildDetached()"),
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorCommandLine = buildSupervisorCommandLine();") <
      supervisorJsMain.indexOf("const launcherResult = startLauncherProcess(launcherCmd);"),
    "desktop-service-supervisor.js must try direct supervisor child before generated launcher cmd on Windows",
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorCreateResult = createWindowsProcess(supervisorCommandLine);") <
      supervisorJsMain.indexOf("const launcherResult = startLauncherProcess(launcherCmd);"),
    "desktop-service-supervisor.js must try Win32_Process node supervisor before generated launcher cmd",
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorCreateResult = createWindowsProcess(supervisorCommandLine);") <
      supervisorJsMain.indexOf("const scheduledSupervisorResult = startSupervisorChildScheduled();"),
    "desktop-service-supervisor.js must try Win32_Process node supervisor before scheduled task fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const scheduledSupervisorResult = startSupervisorChildScheduled();") <
      supervisorJsMain.indexOf("const supervisorChildResult = startSupervisorChild();"),
    "desktop-service-supervisor.js must try scheduled task before PowerShell Start-Process fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorCreateResult = createWindowsProcess(supervisorCommandLine);") <
      supervisorJsMain.indexOf("const supervisorChildResult = startSupervisorChild();"),
    "desktop-service-supervisor.js must try Win32_Process node supervisor before PowerShell Start-Process fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorChildResult = startSupervisorChild();") <
      supervisorJsMain.indexOf("if (!nonDurableSupervisorFallbackAllowed())"),
    "desktop-service-supervisor.js must try PowerShell Start-Process supervisor child before non-durable fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const launcherResult = startLauncherProcess(launcherCmd);") <
      supervisorJsMain.indexOf("const detachedSupervisorChild = spawnSupervisorChildDetached();"),
    "desktop-service-supervisor.js must try Start-Process launcher before detached Node fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const detachedSupervisorChild = spawnSupervisorChildDetached();") <
      supervisorJsMain.indexOf("const launcherCommandLine = `cmd.exe /d /c ${cmdQuote(launcherCmd)}`;"),
    "desktop-service-supervisor.js must try detached Node fallback before Win32_Process cmd launcher wrapper fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const launcherResult = startLauncherProcess(launcherCmd);") <
      supervisorJsMain.indexOf("const launcherCommandLine = `cmd.exe /d /c ${cmdQuote(launcherCmd)}`;"),
    "desktop-service-supervisor.js must try stable Start-Process launcher before Win32_Process cmd launcher fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorCreateResult = createWindowsProcess(supervisorCommandLine);") <
      supervisorJsMain.indexOf("const launcherCreateResult = createWindowsProcess(launcherCommandLine);"),
    "desktop-service-supervisor.js must try Win32_Process node supervisor before Win32_Process cmd launcher fallback",
  );
  assert.ok(
    supervisorJsMain.indexOf("const supervisorChildResult = startSupervisorChild();") <
      supervisorJsMain.indexOf("const launcherCreateResult = createWindowsProcess(launcherCommandLine);"),
    "desktop-service-supervisor.js must try PowerShell Start-Process supervisor child before Win32_Process cmd launcher fallback",
  );
  const supervisorLoop = supervisorJs.slice(supervisorJs.indexOf("function runSupervisorLoop()"));
  assert.ok(
    supervisorLoop.indexOf("assertModeSwitchAllowed();") < supervisorLoop.indexOf("updateMockModeLock();"),
    "desktop-service-supervisor.js must check mode locks before writing supervisor mode locks",
  );
  assert.ok(
    supervisorLoop.indexOf("assertModeSwitchAllowed();", supervisorLoop.indexOf("for (;;)")) > supervisorLoop.indexOf("for (;;)"),
    "desktop-service-supervisor.js must re-check mode locks before each child restart",
  );
  assert.match(supervisorLoop, /if \(result\.status === 0\) \{/);
  assert.match(supervisorLoop, /start-dev-ports exited with 0, continuing supervision/);
  assert.match(supervisorLoop, /sleep\(2000\);\s*continue;/);
  assert.match(supervisorLoop, /start-dev-ports exited with \$\{result\.status \?\? "unknown"\}, restarting/);
  assert.doesNotMatch(supervisorLoop, /start-dev-ports exited with 0, supervisor exiting/);
  assert.match(supervisorJs, /function openLauncherLogForAppend\(streamName\)/);
  assert.match(supervisorJs, /launcher log was locked; using fallback log/);
  assert.match(supervisorJs, /error\?\.code !== "EPERM" && error\?\.code !== "EBUSY"/);
  assert.match(supervisorJs, /function closeLogFd\(value\)/);
  assert.doesNotMatch(supervisorJs, /if %ERRORLEVEL% EQU 0 exit \/b 0/);
  assert.match(supervisorJs, /start-dev-ports exited with 0, continuing supervision/);

  for (const legacyLauncher of ["tools/launch-dev-ports-stable.js", "tools/launch-dev-ports-keeper.js"]) {
    const source = readText(legacyLauncher);
    assert.match(source, /const realModeLockFile = path\.join\(runtimeDir, "real-mode\.lock"\);/);
    assert.match(source, /const preferredDesignModeFile = path\.join\(runtimeDir, "preferred-design-mode\.json"\);/);
    assert.match(source, /Mock design launch is blocked because real mode is preferred or locked/);
    assert.match(source, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
    assert.match(source, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
    assert.match(source, /updateRealModeLock\(\);/);
    assert.match(source, /function updateRealModeLock\(\)/);
    assert.match(source, /function preferredDesignModeIsReal\(\)/);
    assert.match(source, /function writePreferredDesignMode\(mode\)/);
    assert.match(source, /fs\.writeFileSync\(realModeLockFile/);
  }
});

test("wechat window observer proof is runtime-generated and scoped only to API plus observer", () => {
  const session = readText("tools/wechat-window-observer-session.js");
  const startDev = readText("tools/start-dev-ports.js");
  const stackStarter = readText("tools/ports-stack-starter.js");
  const stableRuntime = readText("tools/stable-runtime-launcher.js");
  const safeWorkers = readText("tools/start-wechat-safe-workers.js");
  const acceptance = readText("tools/run-product-acceptance.js");

  assert.match(session, /randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(session, /TRUSTED_SERVICE_NAMES = new Set\(\["api", "wechat-window-observer"\]\)/);
  assert.match(session, /withoutWechatWindowObserverProof/);
  assert.match(startDev, /wechatWindowObserverServiceEnv\(internalEnv, service\?\.name, observerProofSession\.tokenFile\)/);
  assert.match(stackStarter, /createWechatWindowObserverProofSession\(runtimeDir/);
  assert.match(stableRuntime, /createWechatWindowObserverProofSession\(runtimeDir/);
  assert.match(safeWorkers, /readWechatWindowObserverProofToken\(observerProofFile\)/);
  assert.match(acceptance, /wechatWindowObserverServiceEnv\(serviceEnv, "api", observerProofSession\.tokenFile\)/);
  assert.match(acceptance, /withoutWechatWindowObserverProof\(process\.env\)/);
});

test("wechat bridge runtime token is generated separately and scoped away from Web and observer", () => {
  const session = readText("tools/wechat-bridge-service-session.js");
  const startDev = readText("tools/start-dev-ports.js");
  const stackStarter = readText("tools/ports-stack-starter.js");
  const stableRuntime = readText("tools/stable-runtime-launcher.js");
  const safeWorkers = readText("tools/start-wechat-safe-workers.js");
  const bridgeWorker = readText("tools/wechat-bridge-worker.js");
  const personalBridge = readText("tools/personal-wechat-bridge.js");

  assert.match(session, /randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(session, /TRUSTED_SERVICE_NAMES = new Set\(\["api", "wechat-bridge-worker", "personal-wechat-bridge"\]\)/);
  assert.match(session, /withoutWechatBridgeServiceToken/);
  assert.match(startDev, /ensureWechatBridgeServiceSession\(runtimeDir\)/);
  assert.match(startDev, /wechatBridgeServiceEnv\(observerEnv, service\?\.name, bridgeServiceSession\.tokenFile\)/);
  assert.match(stackStarter, /WECHAT_BRIDGE_SERVICE_TOKEN_FILE: bridgeServiceSession\.tokenFile/);
  assert.match(stableRuntime, /createWechatBridgeServiceSession\(runtimeDir/);
  assert.match(safeWorkers, /wechatBridgeServiceEnv\(observerEnv, service\.name, bridgeServiceSession\.tokenFile\)/);
  assert.match(bridgeWorker, /readWechatBridgeServiceToken\(config\.bridgeServiceTokenFile\)/);
  assert.match(personalBridge, /readWechatBridgeServiceToken\(config\.bridgeServiceTokenFile\)/);
  assert.doesNotMatch(session, /INTERNAL_API_TOKEN/);
});

test("web build script refuses to build while dev web port is occupied", () => {
  const buildWeb = readText("tools/build-web.js");
  const syncStandaloneAssets = readText("tools/sync-web-standalone-assets.js");
  assert.match(buildWeb, /getPortOwnerPids\(webPort\)/);
  assert.match(buildWeb, /"build", "apps\/web", "--webpack"/);
  assert.match(buildWeb, /Stop the desktop services before building web assets/);
  assert.match(buildWeb, /let activeBuildPids = findProjectNextBuildPids\(\);/);
  assert.match(buildWeb, /waitForProjectNextBuildPidsToExit\(30\)/);
  assert.match(buildWeb, /Next build is already running for this project/);
  assert.match(buildWeb, /const buildLockFile = path\.join\(runtimeDir, "web-build\.lock"\);/);
  assert.match(buildWeb, /function acquireBuildLock\(\)/);
  assert.match(buildWeb, /fs\.openSync\(buildLockFile, "wx"\)/);
  assert.match(buildWeb, /Web build is already running under PID/);
  assert.match(buildWeb, /function removeBuildLockForCurrentProcess\(\)/);
  assert.match(buildWeb, /function isProjectWebBuildProcessAlive\(pid\)/);
  assert.match(buildWeb, /ProcessId = \$\{Number\(pid\)\}/);
  assert.match(buildWeb, /commandLine\.includes\("tools\/build-web\.js"\)/);
  assert.match(buildWeb, /process\.on\("exit", releaseBuildLock\)/);
  assert.match(buildWeb, /stableStartingLockIsFresh\(\)/);
  assert.match(buildWeb, /stableRuntimeHeartbeatIsFresh\(\)/);
  assert.match(buildWeb, /const stableRuntimeLauncherPidFile = path\.join\(root, "\.runtime-stable", "stable-runtime-launcher\.pid"\);/);
  assert.match(buildWeb, /stableRuntimeLauncherProcessActive\(readNumericFile\(stableRuntimeLauncherPidFile\)\)/);
  assert.match(buildWeb, /function stableRuntimeLauncherProcessActive\(pid\)/);
  assert.match(buildWeb, /function keepAliveLauncherProcessActive\(pid\)/);
  assert.match(buildWeb, /function projectProcessMatches\(pid, markers\)/);
  assert.match(buildWeb, /function findStableRuntimeLauncherPids\(\)/);
  assert.match(buildWeb, /Date\.now\(\) - stat\.mtimeMs > 3600000/);
  assert.match(buildWeb, /Date\.now\(\) - updatedAt > 3600000/);
  assert.match(buildWeb, /removeStaleNextBuildLock\(\);/);
  assert.match(buildWeb, /process\.env\.FORCE_WEB_CLEAN_BUILD === "1"/);
  assert.match(buildWeb, /resetNextBuildState\(\);/);
  assert.match(buildWeb, /runNextBuild\(\);/);
  assert.match(buildWeb, /\["node_modules\/next\/dist\/bin\/next", "build", "apps\/web", "--webpack"\]/);
  assert.match(buildWeb, /function runNextBuild\(\)/);
  assert.match(buildWeb, /function runWithInheritedOutput\(command, args\)/);
  assert.match(buildWeb, /function runWithCapturedOutput\(command, args\)/);
  assert.match(buildWeb, /function isRetryableNextBuildRace\(result\)/);
  assert.match(buildWeb, /function hasNextBuildErrorOutput\(result\)/);
  assert.match(buildWeb, /Next build failed or exited before standalone output was complete; retrying once/);
  assert.match(buildWeb, /ENOENT/);
  assert.match(buildWeb, /function standaloneServerExists\(\)/);
  assert.match(buildWeb, /const result = runWithCapturedOutput\(process\.execPath, args\);/);
  assert.match(buildWeb, /const retry = runWithCapturedOutput\(process\.execPath, args\);/);
  assert.match(buildWeb, /function productionBuildReady\(\)/);
  assert.match(buildWeb, /function readBuildId\(\)/);
  assert.match(buildWeb, /function webBuildIsStale\(\)/);
  assert.match(buildWeb, /function pathHasFileNewerThan\(target, timestamp\)/);
  assert.match(buildWeb, /after existing standalone sync/);
  assert.match(buildWeb, /path\.join\("static", buildId, "_ssgManifest\.js"\)/);
  assert.match(buildWeb, /path\.join\("server", "pages-manifest\.json"\)/);
  assert.match(buildWeb, /run\(process\.execPath, \["tools\/sync-web-standalone-assets\.js"\]\)/);
  assert.doesNotMatch(buildWeb, /function writeStandaloneFallbackServer\(\)/);
  assert.match(buildWeb, /function removeStaleNextBuildLock\(\)/);
  assert.match(buildWeb, /function resetNextBuildState\(options = \{\}\)/);
  assert.match(buildWeb, /Removed stale Next build lock/);
  assert.match(buildWeb, /Removed previous Next build directory/);
  assert.match(buildWeb, /function waitForProjectNextBuildPidsToExit\(timeoutSeconds = 60\)/);
  assert.match(buildWeb, /function findProjectNextBuildPids\(\)/);
  assert.match(buildWeb, /function isProjectNextBuildProcess\(commandLine, normalizedRoot\)/);
  assert.match(buildWeb, /pid === process\.pid/);
  assert.match(buildWeb, /if \(!commandLine\.includes\(normalizedRoot\)\) return false;/);
  assert.match(buildWeb, /function isNextBuildCommand\(commandLine\)/);
  assert.match(buildWeb, /node_modules\/next\/dist\/compiled\/jest-worker\/processchild\.js/);
  assert.match(buildWeb, /typescript\/bin\/tsc/);
  assert.match(buildWeb, /tools\/sync-web-standalone-assets\.js/);
  assert.match(syncStandaloneAssets, /function syncStandaloneNextBuild\(\)/);
  assert.match(syncStandaloneAssets, /const standaloneServer = path\.join\(standaloneWebRoot, "server\.js"\);/);
  assert.match(syncStandaloneAssets, /Missing standalone server entry/);
  assert.match(syncStandaloneAssets, /function copyDirectory\(source, target, options = \{\}\)/);
  assert.match(syncStandaloneAssets, /if \(options\.optional\) \{\s+console\.log\(`\[warn\] Optional source directory disappeared during sync:/);
  assert.match(syncStandaloneAssets, /const excludedNextEntries = new Set\(\["cache", "dev", "diagnostics", "standalone", "trace"\]\);/);
  assert.doesNotMatch(syncStandaloneAssets, /fs\.rmSync\(standaloneNextRoot/);
  assert.match(syncStandaloneAssets, /fs\.mkdirSync\(standaloneNextRoot, \{ recursive: true \}\);/);
  assert.match(syncStandaloneAssets, /for \(const entry of fs\.readdirSync\(nextRoot, \{ withFileTypes: true \}\)\)/);
  assert.match(syncStandaloneAssets, /if \(excludedNextEntries\.has\(entry\.name\)\) continue;/);
  assert.match(syncStandaloneAssets, /copyFile\(source, target\)/);
  assert.match(syncStandaloneAssets, /copyDirectory\(source, target, \{ optional: true \}\)/);
  assert.match(syncStandaloneAssets, /function writeStableStandaloneServer\(\)/);
  assert.match(syncStandaloneAssets, /if \(!fs\.existsSync\(standaloneWebRoot\) && productionBuildReady\(\)\) \{\s+writeStableStandaloneServer\(\);/);
  assert.match(syncStandaloneAssets, /if \(!fs\.existsSync\(standaloneServer\)\) \{\s+if \(productionBuildReady\(\)\) \{\s+writeStableStandaloneServer\(\);/);
  assert.doesNotMatch(syncStandaloneAssets, /function writeStandaloneFallbackServer\(\)/);
  assert.doesNotMatch(syncStandaloneAssets, /next\(\{ dev: false/);
  assert.doesNotMatch(syncStandaloneAssets, /writeStandaloneFallbackServer\(\);/);
  assert.match(syncStandaloneAssets, /Synced web standalone public and production build assets/);

  const startDevPorts = readText("tools/start-dev-ports.js");
  assert.match(startDevPorts, /if \(!commandLine\.includes\(normalizedRoot\)\) return false;/);
});

test("Next dev server allows local app browser origin", () => {
  const nextConfig = readText("apps/web/next.config.js");
  assert.match(nextConfig, /allowedDevOrigins:\s*\["127\.0\.0\.1", "localhost"\]/);
});
