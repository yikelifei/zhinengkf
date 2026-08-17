const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const testFiles = args.length ? args : ["tests/*.test.js"];
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...testFiles],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      USE_LOCAL_STORE: "true",
      DESIGN_PLATFORM_BASE_URL: "http://127.0.0.1:3700",
    },
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  },
);

if (result.error) {
  process.stderr.write(`[tests] unable to start Node tests: ${result.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
