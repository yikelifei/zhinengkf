"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
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
];

let failed = false;

console.log("");
console.log("== Check current default startup ==");
const currentStatus = runNode(["tools/check-dev-startup.js", "--mock-design"], true);
if (currentStatus.output) console.log(currentStatus.output);
if (currentStatus.status === 0) {
  console.log("");
  console.log("[result] Desktop startup is already healthy. Open http://127.0.0.1:3100/");
  process.exit(0);
}
console.log("[info] Current startup is not healthy. Repair will clean ports, verify defaults, and build the API.");
failed = !runSteps(resetSteps);

if (failed) {
  console.log("");
  console.log("[result] Repair failed.");
  process.exitCode = 1;
} else {
  console.log("");
  console.log("[result] Repair completed. Run run_desktop.bat to start the app in foreground mode.");
}

function runSteps(steps) {
  for (const step of steps) {
    console.log("");
    console.log(`== ${step.label} ==`);
    const result = step.packageScript ? runPackageScript(step.packageScript, step.captureOutput) : runNode(step.args, step.captureOutput);
    const output = result.output;
    if (output) console.log(output);

    if (result.status === 0) continue;
    if (step.allowFailure && !cleanupFailureBlocksRepair(output)) {
      console.log("[warn] Cleanup reported a problem. Continuing so the next step can show the current blocker.");
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
    DESIGN_PLATFORM_ADAPTER: "standard_v1",
    DESIGN_PLATFORM_BASE_URL: "http://127.0.0.1:3700",
    START_MOCK_DESIGN_PLATFORM: "true",
  };
}

function cleanupFailureBlocksRepair(output) {
  const text = String(output || "");
  return /access is denied|denied|still occupied|still in use|could not be stopped|refused/i.test(text);
}

function printAdminHelp() {
  console.log("[fix] Close the listed PID in Task Manager, or run repair_desktop.bat and approve the Administrator prompt.");
  console.log("[fix] This is usually needed after switching between default mode and real design platform mode.");
}
