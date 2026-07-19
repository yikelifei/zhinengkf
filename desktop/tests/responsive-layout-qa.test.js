"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const runnerPath = path.join(root, "tools", "run-responsive-layout-qa.js");
const probePath = path.join(root, "tools", "product-acceptance-layout-probe.js");
const runner = require(runnerPath);

test("responsive QA accepts loopback only and exposes both required viewports", () => {
  assert.doesNotThrow(() => runner.validateLoopbackUrl("http://127.0.0.1:3100/"));
  assert.throws(() => runner.validateLoopbackUrl("https://example.com/"), /loopback HTTP URL/);

  const source = fs.readFileSync(probePath, "utf8");
  assert.match(source, /name:\s*"desktop-1536",\s*width:\s*1536,\s*height:\s*960/);
  assert.match(source, /name:\s*"mobile-390",\s*width:\s*390,\s*height:\s*844/);
  assert.match(source, /noPageHorizontalOverflow/);
  assert.match(source, /navigationAvailable/);
  assert.match(source, /primaryPaneVisible/);
  assert.match(source, /interactionReachable/);
  assert.match(source, /#workbench-mobile-navigation\[role=\"dialog\"\]/);
});

test("responsive QA writes explicit BLOCKED JSON and Markdown when the web service is unavailable", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-responsive-qa-"));
  try {
    const result = spawnSync(process.execPath, [
      runnerPath,
      "--url",
      "http://127.0.0.1:9/",
      "--output-dir",
      outputDir,
      "--preflight-timeout-ms",
      "500",
    ], { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true });

    assert.equal(result.status, 2, result.stderr || result.stdout);
    const jsonPath = path.join(outputDir, "responsive-layout-report.json");
    const markdownPath = path.join(outputDir, "responsive-layout-report.zh-CN.md");
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(markdownPath), true);
    const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(report.status, "blocked");
    assert.equal(report.passed, false);
    assert.match(report.blockers.join(" "), /web service is unavailable/);
    assert.match(fs.readFileSync(markdownPath, "utf8"), /\*\*BLOCKED\*\*/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("responsive QA describes an early Electron stop instead of leaving a blank blocker", () => {
  const source = fs.readFileSync(runnerPath, "utf8");
  assert.match(source, /Electron renderer stopped before completing both viewports/);
  assert.match(source, /Electron renderer did not finish within/);
});

test("responsive Markdown records pass, failure and artifact evidence", () => {
  const markdown = runner.renderMarkdown({
    status: "failed",
    url: "http://127.0.0.1:3100/",
    renderer: "Electron Chromium",
    startedAt: "2026-07-19T00:00:00.000Z",
    finishedAt: "2026-07-19T00:00:01.000Z",
    viewports: [{
      name: "mobile-390",
      viewport: { width: 390, height: 844 },
      passed: false,
      checks: {
        noPageHorizontalOverflow: false,
        navigationAvailable: true,
        primaryPaneVisible: true,
        interactionReachable: true,
      },
    }],
    blockers: [],
    failures: ["mobile-390: noPageHorizontalOverflow"],
    artifacts: { jsonReport: "report.json", probeReport: "probe.json", screenshotDir: "screenshots" },
  });
  assert.match(markdown, /mobile-390/);
  assert.match(markdown, /FAIL/);
  assert.match(markdown, /report\.json/);
});
