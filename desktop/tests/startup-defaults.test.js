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
  assert.equal(pkg.scripts["ports:launch"], "node tools/ports-stack-starter.js --mock-design");
  assert.equal(pkg.scripts["ports:launch:mock"], "node tools/ports-stack-starter.js --mock-design");
  assert.equal(pkg.scripts["ports:launch:real"], "node tools/ports-stack-starter.js --real-design");
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
  assert.match(startDevPorts, /const realModeLockFile = path\.join\(runtimeDir, "real-mode\.lock"\);/);
  assert.match(startDevPorts, /assertRealDesignStartAllowed\(\);/);
  assert.match(startDevPorts, /assertMockDesignStartAllowed\(\);/);
  assert.match(startDevPorts, /writeRealModeLockIfNeeded\(\);/);
  assert.match(startDevPorts, /const existing = readRuntimeDesignPlatformConfig\(\);/);
  assert.match(startDevPorts, /\.\.\.existing,/);
  assert.match(startDevPorts, /function assertRealDesignStartAllowed\(\)/);
  assert.match(startDevPorts, /function assertMockDesignStartAllowed\(\)/);
  assert.match(startDevPorts, /function writeRealModeLockIfNeeded\(\)/);
  assert.match(startDevPorts, /startModeLockHeartbeat\(\);/);
  assert.match(startDevPorts, /function startModeLockHeartbeat\(\)/);
  assert.match(startDevPorts, /setInterval\(writeRealModeLockIfNeeded, 5000\)/);
  assert.match(startDevPorts, /Real design startup is blocked because mock mode is locked/);
  assert.match(startDevPorts, /Mock design startup is blocked because real mode is active or locked/);
  assert.match(startDevPorts, /findConflictingDesignLaunchers\("real"\)/);
  assert.match(startDevPorts, /Run npm\.cmd run ports:stop before switching to real design mode/);
  assert.match(startDevPorts, /const keepAliveLauncher = args\.has\("--keep-alive"\);/);
  assert.match(startDevPorts, /const managedChildren = \[\];/);
  assert.match(startDevPorts, /const keepAliveTimers = \[\];/);
  assert.match(startDevPorts, /const serviceRestartGraceUntil = new Map\(\);/);
  assert.match(startDevPorts, /const allowMockDesignStart = process\.env\.ALLOW_MOCK_DESIGN_START === "1";/);
  assert.match(startDevPorts, /Use npm\.cmd run ports:stop to stop them/);
  assert.match(startDevPorts, /const shouldReuseRealDesignMode =/);
  assert.match(startDevPorts, /existingDesignPlatformAdapter === "art_image_local"/);
  assert.match(startDevPorts, /runtimeConfigLooksReal \|\| allowMockDesignStart/);
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
  assert.match(startDevPorts, /commandArgs: \[webStandaloneServerPath\]/);
  assert.match(startDevPorts, /await buildWebIfNeeded\(\);/);
  assert.match(startDevPorts, /async function buildWebIfNeeded\(\)/);
  assert.match(startDevPorts, /runPackageScript\("build:web"\)/);
  assert.match(startDevPorts, /function resolvedNpmCommand\(\)/);
  assert.match(startDevPorts, /const besideNode = path\.join\(path\.dirname\(process\.execPath\), "npm\.cmd"\);/);
  assert.match(startDevPorts, /if \(!resolvedNpmCommand\(\)\) missing\.push\(npmCommandName\(\)\);/);
  assert.match(startDevPorts, /function resolvedNpmCliPath\(\)/);
  assert.match(startDevPorts, /const npmCliPath = process\.platform === "win32" \? resolvedNpmCliPath\(\) : "";/);
  assert.match(startDevPorts, /command: process\.execPath, args: \[npmCliPath, \.\.\.args\]/);
  assert.match(startDevPorts, /const result = spawnSync\(packageCommand\.command, packageCommand\.args, \{/);
  assert.match(startDevPorts, /shell: false/);
  assert.match(startDevPorts, /windowsSafeEnv\(process\.env\)/);
  assert.match(startDevPorts, /function webBuildIsStale\(\)/);
  assert.match(startDevPorts, /pathHasFileNewerThan\(item, builtAt\)/);
  assert.match(startDevPorts, /const launcherLogPath = path\.join\(logsDir, `\$\{service\.name\}\.launcher\.log`\);/);
  assert.match(startDevPorts, /removeLogFileIfUnlocked\(stdoutPath\)/);
  assert.match(startDevPorts, /removeLogFileIfUnlocked\(stderrPath\)/);
  assert.match(startDevPorts, /removeLogFileIfUnlocked\(launcherLogPath\)/);
  assert.match(startDevPorts, /function removeLogFileIfUnlocked\(filePath\)/);
  assert.match(startDevPorts, /error\?\.code === "EPERM" \|\| error\?\.code === "EBUSY"/);
  assert.match(startDevPorts, /Log file is locked, keeping existing file/);
  assert.match(startDevPorts, /fs\.writeFileSync\(wrapperPath, buildWindowsServiceWrapper/);
  assert.match(startDevPorts, /function buildWindowsServiceWrapper\(service,/);
  assert.match(startDevPorts, /function cmdSetEnv\(key, value\)/);
  assert.match(startDevPorts, /if \(keepAliveLauncher\) \{/);
  assert.match(startDevPorts, /function startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath\)/);
  assert.match(startDevPorts, /function startManagedChild[\s\S]+const envAssignments = Object\.entries\(serviceDefaultEnv\(\)\)/);
  assert.match(startDevPorts, /function startManagedChild[\s\S]+\`\$\{envAssignments\}; `/);
  assert.match(startDevPorts, /return startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath\);/);
  assert.match(startDevPorts, /managedChildren\.push\(child\);/);
  assert.match(startDevPorts, /serviceRestartGraceUntil\.set\(service\.name, Date\.now\(\) \+ serviceReadyTimeoutMs\(service\)\)/);
  assert.match(startDevPorts, /managed process exited code=\$\{code \?\? ""\} signal=\$\{signal \?\? ""\}/);
  assert.match(startDevPorts, /serviceRestartGraceUntil\.get\(service\.name\)/);
  assert.doesNotMatch(startDevPorts, /const restarted = startManagedChild\(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath\);/);
  assert.match(startDevPorts, /launched managed child \$\{child\.pid \|\| "unknown"\} via direct service command/);
  assert.match(startDevPorts, /function scheduleServiceRecordRefresh\(service, childPid\)/);
  assert.match(startDevPorts, /function refreshServiceRecord\(service, childPid\)/);
  assert.match(startDevPorts, /pid: numberOrUndefined\(portOwners\[0\]\) \|\| records\[service\.name\]\?\.pid/);
  assert.match(startDevPorts, /function startManagedChild[\s\S]+detached: false/);
  const managedChildSource = startDevPorts.slice(
    startDevPorts.indexOf("function startManagedChild("),
    startDevPorts.indexOf("function startService("),
  );
  assert.doesNotMatch(managedChildSource, /child\.unref\(\);/);
  assert.match(startDevPorts, /restarting \$\{service\.name\}/);
  assert.match(startDevPorts, /}, 2000\);/);
  assert.match(startDevPorts, /timer\.ref\(\);/);
  assert.match(startDevPorts, /keepAliveTimers\.push\(timer\);/);
  assert.match(startDevPorts, /Keeping launcher alive so managed services can recover/);
  assert.match(startDevPorts, /echo \[%date% %time%\] launching \$\{service\.name\}/);
  assert.match(startDevPorts, /const runLine = `\$\{command\} >> \$\{cmdQuote\(stdoutPath\)\} 2>> \$\{cmdQuote\(stderrPath\)\}`;/);
  assert.match(startDevPorts, /const envAssignments = Object\.entries\(serviceDefaultEnv\(\)\)/);
  assert.match(startDevPorts, /function windowsServiceLaunchCommand\(service, wrapperPath\)/);
  assert.match(startDevPorts, /return \{ command: service\.command, commandArgs: service\.commandArgs, usesOwnRedirection: false \};/);
  assert.doesNotMatch(startDevPorts, /"-NoExit"/);
  assert.match(startDevPorts, /Start-Process -FilePath \$\{psQuote\(launchCommand\.command\)\}/);
  assert.match(startDevPorts, /-ArgumentList \$\{psArray\(launchCommand\.commandArgs\)\}/);
  assert.match(startDevPorts, /const redirectArgs = launchCommand\.usesOwnRedirection/);
  assert.match(startDevPorts, /\$\{redirectArgs\}-PassThru/);
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
  assert.match(startDevPorts, /supervise-real\.cmd/);
  assert.match(startDevPorts, /supervise-mock\.cmd/);
  assert.match(startDevPorts, /stable-supervise-real\.cmd/);
  assert.match(startDevPorts, /stable-supervise-mock\.cmd/);
  assert.match(startDevPorts, /Run npm\.cmd run ports:stop, then start with only one design mode/);
  assert.match(startDevPorts, /PORT: String\(webPort\)/);

  const checkDevStartup = readText("tools/check-dev-startup.js");
  assert.match(checkDevStartup, /const requestedRealDesignMode = args\.has\("--real-design"\);/);
  assert.match(checkDevStartup, /const realDesignMode = requestedRealDesignMode && !forceMockDesignMode;/);
  assert.match(checkDevStartup, /const mockDesignMode = !realDesignMode;/);
  assert.match(checkDevStartup, /requestUrlWithRetry\(service\.url, 20, 1000\)/);
  assert.match(checkDevStartup, /requestUrlWithRetry\(integrationHealthUrl, 5, 700\)/);
  assert.match(checkDevStartup, /function sleep\(ms\)/);

  const repairDevStartup = readText("tools/repair-dev-startup.js");
  assert.match(repairDevStartup, /"tools\/start-dev-ports\.js", "--mock-design", "--preflight", "--require-free-ports"/);
  assert.match(repairDevStartup, /DESIGN_PLATFORM_ADAPTER: "standard_v1"/);
  assert.match(repairDevStartup, /DESIGN_PLATFORM_BASE_URL: "http:\/\/127\.0\.0\.1:3700"/);
  assert.match(repairDevStartup, /START_MOCK_DESIGN_PLATFORM: "true"/);

  const desktopServiceSupervisor = readText("tools/desktop-service-supervisor.js");
  assert.match(desktopServiceSupervisor, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
  assert.match(desktopServiceSupervisor, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
  assert.match(desktopServiceSupervisor, /removed stale real mode lock before mock launch/);

  const appConfig = readText("apps/api/src/shared/app-config.ts");
  assert.match(appConfig, /const defaultDesignPlatformAdapter = "standard_v1";/);
  assert.match(appConfig, /const defaultDesignPlatformBaseUrl = "http:\/\/127\.0\.0\.1:3700";/);
});

test("stop script recognizes child service command lines", () => {
  const stopDevPorts = readText("tools/stop-dev-ports.js");
  assert.match(stopDevPorts, /const protectedPids = new Set/);
  assert.match(stopDevPorts, /const protectedStarterMode =/);
  assert.match(stopDevPorts, /process\.env\.PORTS_STACK_STARTER_PID/);
  assert.match(stopDevPorts, /process\.env\.PORTS_STACK_STARTER_PARENT_PID/);
  assert.match(stopDevPorts, /process\.env\.PORTS_STACK_STARTER_MODE/);
  assert.match(stopDevPorts, /PRESERVE_REAL_MODE_LOCK/);
  assert.match(stopDevPorts, /const designPlatformConfigFile = path\.join\(runtimeDir, "design-platform-config\.json"\);/);
  assert.match(stopDevPorts, /clearRuntimeDesignModeConfig\(\);/);
  assert.match(stopDevPorts, /function clearRuntimeDesignModeConfig\(\)/);
  assert.match(stopDevPorts, /delete config\[key\]/);
  assert.match(stopDevPorts, /designPlatformAccessToken/);
  assert.match(stopDevPorts, /if \(protectedPids\.has\(pid\)\) return false;/);
  assert.match(stopDevPorts, /if \(protectedPids\.has\(pid\)\) continue;/);
  assert.match(stopDevPorts, /function normalizePathText\(value\)/);
  assert.match(stopDevPorts, /tools\/mock-design-platform\.js/);
  assert.match(stopDevPorts, /dist\/apps\/api\/main\.js/);
  assert.match(stopDevPorts, /apps\\\/web\\\/\\\.next\\\/standalone\\\/apps\\\/web\\\/server\\\.js/);
  assert.match(stopDevPorts, /node\(\?:\\\.exe\)\?"\?\\s\+\.\*apps\\\/web/);
  assert.match(stopDevPorts, /next\/dist\/server\/lib\/start-server\.js/);
  assert.match(stopDevPorts, /node_modules\/next\/dist\/bin\/next/);
  assert.match(stopDevPorts, /function stopManagedWrapperProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedWrapperPids\(\)/);
  assert.match(stopDevPorts, /const standaloneWebWrapperPattern =/);
  assert.match(stopDevPorts, /standaloneWebWrapperPattern\.test\(commandLine\)/);
  assert.match(stopDevPorts, /function stopManagedLauncherProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedLauncherPids\(\)/);
  assert.match(stopDevPorts, /const normalizedRoot = normalizePathText\(desktopRoot\);/);
  assert.match(stopDevPorts, /function stopManagedKeeperProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedKeeperPids\(\)/);
  assert.match(stopDevPorts, /function stopManagedDirectShellProcesses\(stoppedPids, attemptedPids\)/);
  assert.match(stopDevPorts, /function findManagedDirectShellPids\(\)/);
  assert.match(stopDevPorts, /name = 'powershell\.exe'/);
  assert.match(stopDevPorts, /tools\/start-dev-ports\.js/);
  assert.doesNotMatch(stopDevPorts, /\$cmd\.Contains\('--keep-alive'\)/);
  assert.match(stopDevPorts, /start-sleep -seconds 3600/);
  assert.match(stopDevPorts, /mock-mode\.lock/);
  assert.match(stopDevPorts, /real-mode\.lock/);
  assert.match(stopDevPorts, /if \(!preserveRealModeLock\) fs\.rmSync\(realModeLockFile, \{ force: true \}\)/);
  assert.match(stopDevPorts, /web\|api\|mock\)-direct/);
  assert.match(stopDevPorts, /node_modules\/next\/dist\/bin\/next dev apps\/web -p/);
  assert.match(stopDevPorts, /tools\/mock-design-platform\.js/);
  assert.match(stopDevPorts, /start-process/);
  assert.match(stopDevPorts, /server\\\.js\\b/);
  assert.match(stopDevPorts, /commandLine\.includes\("tools\/start-dev-ports\.js"\)/);
  assert.match(stopDevPorts, /commandLine\.includes\("tools\/ports-stack-starter\.js"\)/);
  assert.match(stopDevPorts, /commandLine\.includes\("tools\/desktop-service-supervisor\.js"\)/);
  assert.match(stopDevPorts, /commandLine\.includes\("--supervisor-child"\)/);
  assert.match(stopDevPorts, /starterMode !== protectedStarterMode/);
  assert.match(stopDevPorts, /npm\(\?:\\\.cmd\|\\\/bin\\\/npm-cli\\\.js\)"\? run ports:\(start\|launch\|keepalive\)\(:mock\|:real\)\?/);
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
  assert.match(defaultBat, /npm\.cmd run ports:keepalive:mock/);
  assert.match(defaultBat, /stable foreground mode/);
  assert.match(defaultBat, /Keep this window open/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run ports:launch:mock/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run ports:doctor:mock/);
  assert.doesNotMatch(defaultBat, /npm\.cmd run dev:stack(\s|\r|\n|$)/);

  const realDesignBat = fs.readFileSync(path.join(root, "..", "run_desktop_real_design.bat"), "utf8");
  assert.match(realDesignBat, /npm\.cmd run ports:keepalive:real/);
  assert.match(realDesignBat, /stable foreground mode/);
  assert.match(realDesignBat, /Keep this window open/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run ports:launch:real/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run ports:doctor:real/);
  assert.doesNotMatch(realDesignBat, /npm\.cmd run dev:stack:real/);
});

test("port stack launcher clears stale mode locks and starts supervised services", () => {
  const launcher = readText("tools/ports-stack-starter.js");
  assert.match(launcher, /const realModeLockFile = path\.join\(runtimeDir, "real-mode\.lock"\);/);
  assert.match(launcher, /const designPlatformConfigFile = path\.join\(runtimeDir, "design-platform-config\.json"\);/);
  assert.match(launcher, /const http = require\("node:http"\);/);
  assert.match(launcher, /main\(\)\.catch/);
  assert.match(launcher, /async function main\(\)/);
  assert.match(launcher, /Mock design launch is blocked because real design mode is active/);
  assert.match(launcher, /activeApiLooksRealDesignMode\(\)/);
  assert.match(launcher, /const activeApiRealMode = mockDesignMode \? await activeApiLooksRealDesignMode\(\) : false;/);
  assert.match(launcher, /runtimeConfigLooksRealDesignMode\(\)/);
  assert.match(launcher, /if \(mockDesignMode && activeApiRealMode\) \{/);
  assert.match(launcher, /fs\.existsSync\(realModeLockFile\) \|\| runtimeConfigRealMode/);
  assert.match(launcher, /clearRuntimeDesignModeConfig\(\);/);
  assert.match(launcher, /function clearRuntimeDesignModeConfig\(\)/);
  assert.match(launcher, /removed stale real design mode state before mock design launch/);
  assert.match(launcher, /designPlatformAdapter === "art_image_local"/);
  assert.match(launcher, /health\?\.adapter === "art_image_local"/);
  assert.match(launcher, /api\/integrations\/design-platform\/health/);
  assert.match(launcher, /function getJson\(url, timeoutMs = 1500\)/);
  assert.match(launcher, /fs\.writeFileSync\(realModeLockFile/);
  assert.match(launcher, /PRESERVE_REAL_MODE_LOCK: realDesignMode \? "1" : ""/);
  assert.match(launcher, /managedPortsAreFree\(\)/);
  assert.match(launcher, /stale process race, but managed ports are free/);
  assert.match(launcher, /function getPortOwnerPids\(port\)/);
  assert.match(launcher, /const realDesignMode = args\.has\("--real-design"\);/);
  assert.match(launcher, /const modeArg = realDesignMode \? "--real-design" : "--mock-design";/);
  assert.match(launcher, /const conflictMode = realDesignMode \? "mock" : "real";/);
  assert.match(launcher, /if \(realDesignMode && fs\.existsSync\(mockModeLockFile\)\) \{/);
  assert.doesNotMatch(launcher, /Real design launch is blocked because mock mode is locked/);
  assert.match(launcher, /fs\.rmSync\(mockModeLockFile, \{ force: true \}\);/);
  assert.match(launcher, /removed stale mock mode lock before real design launch/);
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
  assert.match(launcher, /env\.ALLOW_MOCK_DESIGN_START = "1";/);
  assert.match(launcher, /env\.DESIGN_PLATFORM_ADAPTER = "standard_v1";/);
  assert.match(launcher, /env\.DESIGN_PLATFORM_BASE_URL = "http:\/\/127\.0\.0\.1:3700";/);
  assert.match(launcher, /env\.ALLOW_REAL_DESIGN_START = "1";/);
  assert.match(launcher, /spawnSync\(process\.execPath, \["tools\/desktop-service-supervisor\.js", modeArg\]/);
  assert.match(launcher, /removed stale real design mode state before mock design launch/);
  assert.doesNotMatch(launcher, /mockDesignMode && \(fs\.existsSync\(realModeLockFile\) \|\| activeApiLooksRealDesignMode\(\) \|\| runtimeConfigLooksRealDesignMode\(\)\)/);

  const supervisorPs1 = readText("tools/desktop-service-supervisor.ps1");
  assert.match(supervisorPs1, /\$RealModeLockFile = Join-Path \$RuntimeDir "real-mode\.lock"/);
  assert.match(supervisorPs1, /\$StableConflictingLauncherCmd = Join-Path \$RuntimeDir/);
  assert.match(supervisorPs1, /stable-supervise-mock\.cmd/);
  assert.match(supervisorPs1, /stable-supervise-real\.cmd/);
  assert.match(supervisorPs1, /Mock design launch is blocked because real mode is active/);
  assert.match(supervisorPs1, /Find-ConflictingDesignLaunchers -TargetMode "real"/);
  assert.match(supervisorPs1, /\$DesignPlatformConfigFile = Join-Path \$RuntimeDir "design-platform-config\.json"/);
  assert.match(supervisorPs1, /function Test-RuntimeConfigRealMode/);
  assert.match(supervisorPs1, /\$env:ALLOW_MOCK_DESIGN_START -ne "1"/);
  assert.match(supervisorPs1, /function Update-RealModeLock/);
  assert.match(supervisorPs1, /Update-RealModeLock/);
  assert.match(supervisorPs1, /Set-Content -Path \$StableConflictingLauncherCmd/);
  assert.match(supervisorPs1, /\$nodeLine = .+tools\/start-dev-ports\.js.+\$ModeArg.+--keep-alive/);
  assert.match(supervisorPs1, /Write-Output "\[supervisor\] node tools\/start-dev-ports\.js \$ModeArg --keep-alive pid=/);
  assert.match(supervisorPs1, /\$env:PORTS_STACK_STARTER_PID = \[string\]\$PID/);
  assert.match(supervisorPs1, /\$env:PORTS_STACK_STARTER_MODE = \$Mode/);
  assert.match(supervisorPs1, /\$env:PRESERVE_REAL_MODE_LOCK = "1"/);
  const supervisorMain = supervisorPs1.slice(supervisorPs1.indexOf("New-Item -ItemType Directory"));
  assert.ok(
    supervisorMain.indexOf("Assert-ModeSwitchAllowed") < supervisorMain.indexOf("Stop-ConflictingDesktopServices"),
    "desktop-service-supervisor.ps1 must check mode locks before stopping conflicting services",
  );

  const supervisorJs = readText("tools/desktop-service-supervisor.js");
  assert.match(supervisorJs, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
  assert.match(supervisorJs, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
  assert.match(supervisorJs, /removed stale real mode lock before mock launch/);
  assert.match(supervisorJs, /const stableConflictingLauncherCmd = path\.join/);
  assert.match(supervisorJs, /const legacyLauncherCmd = path\.join/);
  assert.match(supervisorJs, /const stableLauncherCmd = path\.join/);
  assert.match(supervisorJs, /stable-supervise-mock\.cmd/);
  assert.match(supervisorJs, /stable-supervise-real\.cmd/);
  assert.match(supervisorJs, /findConflictingDesignLaunchers\("real"\)\.length/);
  assert.match(supervisorJs, /const designPlatformConfigFile = path\.join\(runtimeDir, "design-platform-config\.json"\);/);
  assert.match(supervisorJs, /runtimeConfigLooksRealDesignMode\(\) && process\.env\.ALLOW_MOCK_DESIGN_START !== "1"/);
  assert.match(supervisorJs, /\[conflictingLauncherCmd, legacyConflictingLauncherCmd, stableConflictingLauncherCmd\]/);
  assert.match(supervisorJs, /writeActiveLaunchers\(\);/);
  assert.match(supervisorJs, /function writeActiveLaunchers\(\)/);
  assert.match(supervisorJs, /\[launcherCmd, legacyLauncherCmd, stableLauncherCmd\]/);
  assert.match(supervisorJs, /PORTS_STACK_STARTER_PID: String\(process\.pid\)/);
  assert.match(supervisorJs, /PORTS_STACK_STARTER_PARENT_PID: String\(process\.ppid\)/);
  assert.match(supervisorJs, /PORTS_STACK_STARTER_MODE: realDesignMode \? "real" : "mock"/);
  assert.match(supervisorJs, /PRESERVE_REAL_MODE_LOCK: realDesignMode \? "1" : ""/);
  assert.match(supervisorJs, /const launcherResult = spawnSync\(/);
  assert.match(supervisorJs, /Start-Process -FilePath \$\{psQuote\(launcherCmd\)\}/);
  assert.match(supervisorJs, /\[supervisor\] \$\{path\.basename\(launcherCmd\)\} pid=\$\{launcherPid\}/);
  assert.ok(
    supervisorJs.indexOf("const launcherResult = spawnSync(") < supervisorJs.indexOf("Invoke-CimMethod -ClassName Win32_Process"),
    "desktop-service-supervisor.js must try the cmd launcher before Win32_Process fallback",
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

  for (const legacyLauncher of ["tools/launch-dev-ports-stable.js", "tools/launch-dev-ports-keeper.js"]) {
    const source = readText(legacyLauncher);
    assert.match(source, /const realModeLockFile = path\.join\(runtimeDir, "real-mode\.lock"\);/);
    assert.match(source, /Mock design launch is blocked because real mode is locked/);
    assert.match(source, /\["tools\/start-dev-ports\.js", "--real-design", "--keep-alive"\]/);
    assert.match(source, /\["tools\/start-dev-ports\.js", "--mock-design", "--keep-alive"\]/);
  }
});

test("web build script refuses to build while dev web port is occupied", () => {
  const buildWeb = readText("tools/build-web.js");
  const syncStandaloneAssets = readText("tools/sync-web-standalone-assets.js");
  assert.match(buildWeb, /getPortOwnerPids\(webPort\)/);
  assert.match(buildWeb, /Stop the desktop services before building web assets/);
  assert.match(buildWeb, /tools\/sync-web-standalone-assets\.js/);
  assert.match(syncStandaloneAssets, /function syncStandaloneNextBuild\(\)/);
  assert.match(syncStandaloneAssets, /const excludedNextEntries = new Set\(\["cache", "dev", "diagnostics", "standalone", "trace"\]\);/);
  assert.match(syncStandaloneAssets, /fs\.rmSync\(standaloneNextRoot, \{ force: true, recursive: true \}\);/);
  assert.match(syncStandaloneAssets, /if \(excludedNextEntries\.has\(entry\.name\)\) continue;/);
  assert.match(syncStandaloneAssets, /copyFile\(source, target\)/);
  assert.match(syncStandaloneAssets, /Synced web standalone public and production build assets/);
});

test("Next dev server allows local app browser origin", () => {
  const nextConfig = readText("apps/web/next.config.js");
  assert.match(nextConfig, /allowedDevOrigins:\s*\["127\.0\.0\.1", "localhost"\]/);
});
