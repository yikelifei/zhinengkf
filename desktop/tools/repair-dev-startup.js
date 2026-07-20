"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { atomicWritePrivateJson, readPrivateJsonFile, removePrivateRegularFile } = require("./private-runtime-file");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(desktopRoot, ".runtime");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const preferredDesignModeFile = path.join(runtimeDir, "preferred-design-mode.json");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const mockRepairLockFile = path.join(runtimeDir, "mock-repair.lock");
const resetSteps = [
  {
    label: "Stop existing desktop services",
    args: ["tools/stop-dev-ports.js"],
    allowFailure: true,
    captureOutput: true,
  },
  {
    label: "Run default startup preflight",
    args: ["tools/start-dev-ports.js", "--mock-design", "--preflight", "--require-free-ports"],
    allowFailure: false,
    captureOutput: false,
  },
  {
    label: "Build API",
    packageScript: "build:api",
    allowFailure: false,
    captureOutput: false,
  },
  {
    label: "Start default desktop services",
    packageScript: "ports:launch:mock",
    allowFailure: false,
    captureOutput: false,
  },
];
let failed = false;

console.log("");
console.log("== Repair default desktop startup ==");
console.log("[info] Repair will clean ports, verify defaults, build the API, and start supervised desktop services.");
clearDefaultMockModeLocks();
failed = !runSteps(resetSteps);

if (failed) {
  console.log("");
  console.log("[result] Repair failed.");
  process.exitCode = 1;
} else {
  clearMockRepairLock();
  console.log("");
  console.log("[result] Repair completed. Desktop services are running at http://127.0.0.1:3100/");
}

function runSteps(steps) {
  for (const step of steps) {
    console.log("");
    console.log(`== ${step.label} ==`);
    const result = step.packageScript ? runPackageScript(step.packageScript, step.captureOutput) : runNode(step.args, step.captureOutput);
    const output = result.output;
    if (output) console.log(output);

    if (result.status === 0) {
      if (step.label === "Stop existing desktop services") clearDefaultMockModeLocks();
      continue;
    }
    if (step.allowFailure && !cleanupFailureBlocksRepair(output)) {
      console.log("[warn] Cleanup reported a problem. Continuing so the next step can show the current blocker.");
      if (step.label === "Stop existing desktop services") clearDefaultMockModeLocks();
      continue;
    }

    if (step.label === "Stop existing desktop services") {
      console.log("[error] Cleanup could not stop the old desktop services.");
      printAdminHelp();
    } else {
      console.log(`[error] ${step.label} failed.`);
    }
    return false;
  }
  return true;
}

function runNode(args, captureOutput) {
  const result = spawnSync(process.execPath, args, {
    cwd: desktopRoot,
    env: defaultEnv(),
    encoding: "utf8",
    stdio: captureOutput ? "pipe" : "inherit",
  });
  return {
    status: result.status,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  };
}

function runPackageScript(scriptName, captureOutput) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArgs = ["run", scriptName];
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/c", [command, ...commandArgs].join(" ")], {
        cwd: desktopRoot,
        env: defaultEnv(),
        encoding: "utf8",
        stdio: captureOutput ? "pipe" : "inherit",
      })
    : spawnSync(command, commandArgs, {
        cwd: desktopRoot,
        env: defaultEnv(),
        encoding: "utf8",
        stdio: captureOutput ? "pipe" : "inherit",
      });
  return {
    status: result.status,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  };
}

function defaultEnv() {
  return {
    ...process.env,
    FORCE_MOCK_DESIGN_START: "1",
    DESIGN_PLATFORM_ADAPTER: "standard_v1",
    DESIGN_PLATFORM_BASE_URL: "http://127.0.0.1:3700",
    START_MOCK_DESIGN_PLATFORM: "true",
  };
}

function clearDefaultMockModeLocks() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(mockRepairLockFile, `${new Date().toISOString()}\n`, "utf8");
  fs.rmSync(realModeLockFile, { force: true });
  fs.rmSync(preferredDesignModeFile, { force: true });
  if (!fs.existsSync(designPlatformConfigFile)) return;
  const config = readPrivateJsonFile(designPlatformConfigFile, {});
  for (const key of ["designPlatformAdapter", "designPlatformBaseUrl", "launcherPid", "launcherArgs", "updatedAt"]) {
    delete config[key];
  }
  if (Object.keys(config).length) {
    atomicWritePrivateJson(designPlatformConfigFile, config);
  } else {
    removePrivateRegularFile(designPlatformConfigFile);
  }
}

function clearMockRepairLock() {
  fs.rmSync(mockRepairLockFile, { force: true });
}

function cleanupFailureBlocksRepair(output) {
  const text = String(output || "");
  return /access is denied|denied|still occupied|still in use|could not be stopped|refused/i.test(text);
}

function printAdminHelp() {
  console.log("[fix] Close the listed PID in Task Manager, or run repair_desktop.bat and approve the Administrator prompt.");
  console.log("[fix] This is usually needed after switching between default mode and real design platform mode.");
}
