const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("developer startup scripts default to mock design platform", () => {
  const pkg = JSON.parse(readText("package.json"));
  assert.equal(pkg.scripts["ports:start"], "node tools/start-dev-ports.js --mock-design");
  assert.equal(pkg.scripts["ports:status"], "node tools/start-dev-ports.js --mock-design --status");
  assert.equal(pkg.scripts["ports:preflight"], "node tools/start-dev-ports.js --mock-design --preflight");
  assert.equal(pkg.scripts["ports:doctor"], "node tools/check-dev-startup.js --mock-design");
  assert.equal(pkg.scripts["ports:launch"], "node tools/launch-dev-ports-keeper.js --mock-design");
  assert.equal(pkg.scripts["ports:launch:mock"], "node tools/launch-dev-ports-keeper.js --mock-design");
  assert.equal(pkg.scripts["ports:launch:real"], "node tools/launch-dev-ports-keeper.js --real-design");
  assert.equal(pkg.scripts["ports:start:real"], "node tools/start-dev-ports.js --real-design");
  assert.equal(pkg.scripts["ports:status:real"], "node tools/start-dev-ports.js --real-design --status");
  assert.match(pkg.scripts["dev:web"], /--webpack/);
  assert.match(pkg.scripts["dev:stack"], /--webpack/);
  assert.match(pkg.scripts["dev:stack:real"], /--webpack/);
  assert.equal(pkg.scripts["build:web"], "node tools/build-web.js");
  assert.equal(pkg.scripts["wechat:safe:start"], "node tools/start-wechat-safe-workers.js");
  assert.equal(pkg.scripts["wechat:safe:status"], "node tools/start-wechat-safe-workers.js --status");
  assert.equal(pkg.scripts["wechat:safe:stop"], "node tools/start-wechat-safe-workers.js --stop");
  assert.doesNotMatch(pkg.scripts["ports:start"], /wechat/i);
  assert.match(pkg.scripts["dev:stack:real"], /start-dev-ports\.js --real-design --preflight/);
  assert.match(pkg.scripts["dev:stack:real"], /concurrently -k -n web,api/);
});

test("startup tools keep explicit design mode and preserve current real mode for raw starts", () => {
  const startDevPorts = readText("tools/start-dev-ports.js");
  assert.match(startDevPorts, /const requestedMockDesignMode = args\.has\("--mock-design"\);/);
  assert.match(startDevPorts, /const requestedRealDesignMode = args\.has\("--real-design"\);/);
  assert.match(startDevPorts, /const mockModeLockFile = path\.join\(runtimeDir, "mock-mode\.lock"\);/);
  assert.match(startDevPorts, /assertRealDesignStartAllowed\(\);/);
  assert.match(startDevPorts, /function assertRealDesignStartAllowed\(\)/);
  assert.match(startDevPorts, /Real design startup is blocked because mock mode is locked/);
  assert.match(startDevPorts, /Run npm\.cmd run ports:stop before switching to real design mode/);
  assert.match(startDevPorts, /const keepAliveLauncher = args\.has\("--keep-alive"\);/);
  assert.match(startDevPorts, /const managedChildren = \[\];/);
  assert.match(startDevPorts, /Use npm\.cmd run ports:stop to stop them/);
  assert.match(startDevPorts, /const shouldReuseRealDesignMode =/);
  assert.match(startDevPorts, /existingDesignPlatformAdapter === "art_image_local"/);
  assert.match(
    startDevPorts,
    /\(requestedRealDesignMode \|\| shouldReuseRealDesignMode\) && !forceMockDesignMode \? "art_image_local" : "standard_v1";/,
  );
  assert.match(startDevPorts, /waitForStableServiceReady\(service, serviceReadyTimeoutMs\(service\)\)/);
  assert.match(startDevPorts, /async function waitForStableServiceReady\(service, timeoutMs\)/);
  assert.match(startDevPorts, /function serviceReadyTimeoutMs\(service\)/);
  assert.match(startDevPorts, /service\.name === "api" \? 90000 : 30000/);
  assert.match(startDevPorts, /await isServiceReadyForCurrentConfig\(service\)/);
  assert.match(startDevPorts, /const ok = await waitForStableServiceReady\(service, serviceReadyTimeoutMs\(service\)\)/);
  assert.match(startDevPorts, /const ok = reachable && !configMismatch;/);
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
  assert.match(startDevPorts, /commandArgs: \[webStandaloneServer\]/);
  assert.match(startDevPorts, /await buildWebIfNeeded\(\);/);
  assert.match(startDevPorts, /async function buildWebIfNeeded\(\)/);
  assert.match(startDevPorts, /runPackageScript\("build:web"\)/);
  assert.match(startDevPorts, /function webBuildIsStale\(\)/);
  assert.match(startDevPorts, /pathHasFileNewerThan\(item, builtAt\)/);
  assert.match(startDevPorts, /const launcherLogPath = path\.join\(logsDir, `\$\{service\.name\}\.launcher\.log`\);/);
  assert.match(startDevPorts, /fs\.writeFileSync\(wrapperPath, buildWindowsServiceWrapper/);
  assert.match(startDevPorts, /function buildWindowsServiceWrapper\(service,/);
  assert.match(startDevPorts, /function cmdSetEnv\(key, value\)/);
  assert.match(startDevPorts, /if \(keepAliveLauncher\) \{/);
  assert.match(startDevPorts, /function startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath\)/);
  assert.match(startDevPorts, /return startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath\);/);
  assert.match(startDevPorts, /managedChildren\.push\(child\);/);
  assert.match(startDevPorts, /detached: true/);
  assert.match(startDevPorts, /child\.unref\(\);/);
  assert.match(startDevPorts, /restarting \$\{service\.name\}/);
  assert.match(startDevPorts, /Keeping launcher alive so managed services can recover/);
  assert.match(startDevPorts, /echo \[%date% %time%\] launching \$\{service\.name\}/);
  assert.match(startDevPorts, /const runLine = `\$\{command\} >> \$\{cmdQuote\(stdoutPath\)\} 2>> \$\{cmdQuote\(stderrPath\)\}`;/);
  assert.match(startDevPorts, /const envAssignments = Object\.entries\(serviceDefaultEnv\(\)\)/);
  assert.match(startDevPorts, /function windowsServiceLaunchCommand\(service\)/);
  assert.match(startDevPorts, /return \{ command: service\.command, commandArgs: service\.commandArgs \};/);
  assert.doesNotMatch(startDevPorts, /"-NoExit"/);
  assert.match(startDevPorts, /Start-Process -FilePath \$\{psQuote\(launchCommand\.command\)\}/);
  assert.match(startDevPorts, /-ArgumentList \$\{psArray\(launchCommand\.commandArgs\)\}/);
  assert.match(startDevPorts, /-RedirectStandardError \$\{psQuote\(stderrPath\)\} -PassThru/);
  assert.doesNotMatch(startDevPorts, /const workerPath = path\.join\(runtimeDir, `run-\$\{service\.name\}-worker\.cmd`\);/);
  assert.doesNotMatch(startDevPorts, /function buildWindowsServiceWorker\(service, stdoutPath, stderrPath\)/);
  assert.doesNotMatch(startDevPorts, /const commandLine = `cmd\.exe \/d \/c \$\{cmdQuote\(wrapperPath\)\}`;/);
  assert.doesNotMatch(startDevPorts, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(startDevPorts, /const integrationHealth = await getJson\(integrationHealthUrl\);/);
  assert.match(startDevPorts, /return integrationMatchesCurrentConfig\(integrationHealth\);/);
  assert.match(startDevPorts, /const statusLabel = ok \? "\[ready\]" : configMismatch \? "\[wrong-mode\]" : "\[down\] ";/);
  assert.match(startDevPorts, /status: ok \? "running" : configMismatch \? "wrong_mode" : "down"/);
  assert.match(startDevPorts, /assertNoConflictingDesignLauncher\(\);/);
  assert.match(startDevPorts, /function findConflictingDesignLaunchers\(mode\)/);
  assert.match(startDevPorts, /start-dev-ports\.js/);
  assert.match(startDevPorts, /launch-real\.cmd/);
  assert.match(startDevPorts, /launch-mock\.cmd/);
  assert.match(startDevPorts, /Run npm\.cmd run ports:stop, then start with only one design mode/);
  assert.match(startDevPorts, /PORT: String\(webPort\)/);

  const checkDevStartup = readText("tools/check-dev-startup.js");
  assert.match(checkDevStartup, /const requestedRealDesignMode = args\.has\("--real-design"\);/);
  assert.match(checkDevStartup, /const realDesignMode = requestedRealDesignMode && !forceMockDesignMode;/);
  assert.match(checkDevStartup, /const mockDesignMode = !realDesignMode;/);
  assert.match(checkDevStartup, /requestUrlWithRetry\(service\.url, 5, 700\)/);
  assert.match(checkDevStartup, /requestUrlWithRetry\(integrationHealthUrl, 5, 700\)/);
  assert.match(checkDevStartup, /function sleep\(ms\)/);

  const repairDevStartup = readText("tools/repair-dev-startup.js");
  assert.match(repairDevStartup, /"tools\/start-dev-ports\.js", "--mock-design", "--preflight", "--require-free-ports"/);
  assert.match(repairDevStartup, /DESIGN_PLATFORM_ADAPTER: "standard_v1"/);
  assert.match(repairDevStartup, /DESIGN_PLATFORM_BASE_URL: "http:\/\/127\.0\.0\.1:3700"/);
  assert.match(repairDevStartup, /START_MOCK_DESIGN_PLATFORM: "true"/);

  const appConfig = readText("apps/api/src/shared/app-config.ts");
  assert.match(appConfig, /const defaultDesignPlatformAdapter = "standard_v1";/);
  assert.match(appConfig, /const defaultDesignPlatformBaseUrl = "http:\/\/127\.0\.0\.1:3700";/);
});

test("stop script recognizes child service command lines", () => {
  const stopDevPorts = readText("tools/stop-dev-ports.js");
  assert.match(stopDevPorts, /function normalizePathText\(value\)/);
  assert.match(stopDevPorts, /tools\/mock-design-platform\.js/);
  assert.match(stopDevPorts, /dist\/apps\/api\/main\.js/);
  assert.match(stopDevPorts, /apps\/web\/\.next\/standalone\/apps\/web\/server\.js/);
  assert.match(stopDevPorts, /next\/dist\/server\/lib\/start-server\.js/);
  assert.match(stopDevPorts, /node_modules\/next\/dist\/bin\/next/);
  assert.match(stopDevPorts, /function stopManagedWrapperProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedWrapperPids\(\)/);
  assert.match(stopDevPorts, /function stopManagedLauncherProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedLauncherPids\(\)/);
  assert.match(stopDevPorts, /function stopManagedKeeperProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedKeeperPids\(\)/);
  assert.match(stopDevPorts, /function stopManagedDirectShellProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedDirectShellPids\(\)/);
  assert.match(stopDevPorts, /name = 'powershell\.exe'/);
  assert.match(stopDevPorts, /start-sleep -seconds 3600/);
  assert.match(stopDevPorts, /mock-mode\.lock/);
  assert.match(stopDevPorts, /web\|api\|mock\)-direct/);
  assert.match(stopDevPorts, /node_modules\/next\/dist\/bin\/next dev apps\/web -p/);
  assert.match(stopDevPorts, /tools\/mock-design-platform\.js/);
  assert.match(stopDevPorts, /start-process/);
  assert.match(stopDevPorts, /server\\\.js\\b/);
  assert.match(stopDevPorts, /start-dev-ports\\\.js --\(mock\|real\)-design/);
  assert.match(stopDevPorts, /npm\\\.cmd"\? run ports:start\(:mock\|:real\)\?/);
  assert.match(stopDevPorts, /run-\[\^" \]\+\(-worker\)\?\\\.cmd/);
  assert.match(stopDevPorts, /launch-\(mock\|real\)\\\.cmd/);
  assert.match(stopDevPorts, /function stopPidWithPowerShell\(pid\)/);
  assert.match(stopDevPorts, /Stop-Process -Id \$\{Number\(pid\)\} -Force -ErrorAction Stop/);
});

test("wechat safe worker launcher is explicit and defaults to no real send", () => {
  const launcher = readText("tools/start-wechat-safe-workers.js");
  const bridgeWorker = readText("tools/wechat-bridge-worker.js");

  assert.match(launcher, /"tools\/wechat-window-observer\.js", "--watch", "--scan"/);
  assert.match(launcher, /"tools\/wechat-bridge-worker\.js", "--watch"/);
  assert.match(launcher, /BRIDGE_MODE: process\.env\.BRIDGE_MODE \|\| "noop"/);
  assert.match(launcher, /BRIDGE_ACK_TRANSPORT: process\.env\.BRIDGE_ACK_TRANSPORT \|\| "file_scan"/);
  assert.match(launcher, /API is not reachable/);
  assert.match(launcher, /assertApiReadyForSafeWorkers\(\)/);
  assert.match(launcher, /wechat\/bridge\/status/);
  assert.match(launcher, /windows_bridge/);
  assert.match(launcher, /integrations\/design-platform\/health/);
  assert.match(launcher, /Design platform config mismatch/);
  assert.match(launcher, /wechat-safe-workers\.json/);
  assert.match(launcher, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(launcher, /cmd\.exe \/d \/c \$\{cmdQuote\(wrapperPath\)\}/);
  assert.match(bridgeWorker, /Default mode is noop/);
  assert.match(bridgeWorker, /does not mark anything sent/);
});

test("double click startup bat files use stable launcher scripts", () => {
  const defaultBat = fs.readFileSync(path.join(root, "..", "run_desktop.bat"), "utf8");
  assert.match(defaultBat, /npm\.cmd run ports:launch:mock/);
  assert.match(defaultBat, /npm\.cmd run ports:doctor:mock/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run dev:stack(\s|\r|\n|$)/);

  const realDesignBat = fs.readFileSync(path.join(root, "..", "run_desktop_real_design.bat"), "utf8");
  assert.match(realDesignBat, /npm\.cmd run ports:launch:real/);
  assert.match(realDesignBat, /npm\.cmd run ports:doctor:real/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run dev:stack:real/);
});

test("detached launcher starts the stable port script outside the current process tree", () => {
  const launcher = readText("tools/launch-dev-ports-keeper.js");
  assert.match(launcher, /const realDesignMode = args\.has\("--real-design"\);/);
  assert.match(launcher, /const mockModeLockFile = path\.join\(runtimeDir, "mock-mode\.lock"\);/);
  assert.match(launcher, /const modeArgs = realDesignMode/);
  assert.match(launcher, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
  assert.match(launcher, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
  assert.match(launcher, /cmd\.exe \/d \/k \$\{cmdQuote\(launcherCmd\)\}/);
  assert.match(launcher, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(launcher, /CurrentDirectory =/);
  assert.match(launcher, /process\.execPath/);
  assert.match(launcher, /cmdQuote\(process\.execPath\)/);
  assert.match(launcher, /modeArgs\.map\(cmdQuote\)\.join\(" "\)/);
  assert.match(launcher, />> \$\{cmdQuote\(launcherLog\)\} 2>>&1/);
  assert.match(launcher, /function cmdQuote\(value\)/);
  assert.match(launcher, /const launcherCmd = path\.join\(runtimeDir, realDesignMode \? "launch-real\.cmd" : "launch-mock\.cmd"\);/);
  assert.match(launcher, /const conflictingLauncherCmd = path\.join\(runtimeDir, realDesignMode \? "launch-mock\.cmd" : "launch-real\.cmd"\);/);
  assert.match(launcher, /function disableConflictingLauncher\(\)/);
  assert.match(launcher, /function updateMockModeLock\(\)/);
  assert.match(launcher, /assertModeSwitchAllowed\(\);/);
  assert.match(launcher, /function assertModeSwitchAllowed\(\)/);
  assert.match(launcher, /Run npm\.cmd run ports:stop before switching to real design mode/);
  assert.match(launcher, /stopConflictingDesktopServices\(\);/);
  assert.match(launcher, /tools\/stop-dev-ports\.js/);
  assert.match(launcher, /function findConflictingDesignLaunchers\(mode\)/);
  assert.match(launcher, /ALLOW_REAL_DESIGN_START", "1"/);
  assert.match(launcher, /blocked stale real-design launcher while mock mode is active/);
  assert.match(launcher, /removeIfPossible\(launcherLog\);/);
  assert.match(launcher, /fs\.writeFileSync\(launcherCmd, buildLauncherCmd\(\), "utf8"\);/);
  assert.match(launcher, /function cmdSetArg\(key, value\)/);
  assert.match(launcher, /function launcherModeEnv\(\)/);
  assert.match(launcher, /DESIGN_PLATFORM_ADAPTER", "standard_v1"/);
  assert.match(launcher, /DESIGN_PLATFORM_BASE_URL", "http:\/\/127\.0\.0\.1:3700"/);
  assert.match(launcher, /if \(realDesignMode\) \{/);
  assert.match(launcher, /keys\.push\("DESIGN_PLATFORM_ADAPTER", "DESIGN_PLATFORM_BASE_URL"\);/);
  assert.match(launcher, /removeIfPossible\(launcherLog\)/);
  assert.match(launcher, /error\?\.code !== "EPERM" && error\?\.code !== "EBUSY"/);
});

test("web build script refuses to build while dev web port is occupied", () => {
  const buildWeb = readText("tools/build-web.js");
  assert.match(buildWeb, /getPortOwnerPids\(webPort\)/);
  assert.match(buildWeb, /Stop the desktop services before building web assets/);
  assert.match(buildWeb, /tools\/sync-web-standalone-assets\.js/);
});

test("Next dev server allows local app browser origin", () => {
  const nextConfig = readText("apps/web/next.config.js");
  assert.match(nextConfig, /allowedDevOrigins:\s*\["127\.0\.0\.1", "localhost"\]/);
});
