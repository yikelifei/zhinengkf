"use strict";

const { spawnSync } = require("node:child_process");

const webPort = numberEnv("WEB_PORT", 3100);

main();

function main() {
  const owners = getPortOwnerPids(webPort);
  if (owners.length) {
    console.log(`[blocked] Web port ${webPort} is currently used by PID ${owners.join(", ")}.`);
    console.log("          Stop the desktop services before building web assets:");
    console.log("          npm.cmd run ports:stop");
    process.exitCode = 1;
    return;
  }

  run("node", ["node_modules/next/dist/bin/next", "build", "apps/web"]);
  run(process.execPath, ["tools/sync-web-standalone-assets.js"]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function getPortOwnerPids(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const suffix = `:${port}`;
  const pids = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (String(parts[0]).toUpperCase() !== "TCP") continue;
    const localAddress = parts[1] || "";
    const state = parts[3] || "";
    const pid = parts[4] || "";
    if (!localAddress.endsWith(suffix)) continue;
    if (!/LISTENING/i.test(state)) continue;
    if (/^\d+$/.test(pid) && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
