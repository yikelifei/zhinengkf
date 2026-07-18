"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  commandLineReferencesNestedLegacyRuntime,
} = require("../tools/stable-runtime-process-classifier");

const currentRoot = "d:/zhinengkefu/.runtime/ui-rearchitecture/decompose-integration/desktop";
const legacyMarker = "/.runtime/";

test("current services are not legacy when the active worktree itself is under .runtime", () => {
  for (const relativePath of [
    "dist/apps/api/main.js",
    "tools/mock-design-platform.js",
    "tools/wechat-window-observer.js",
    "tools/wechat-bridge-worker.js",
    "tools/personal-wechat-bridge.js",
  ]) {
    const commandLine = `node ${currentRoot}/${relativePath}`;
    assert.equal(
      commandLineReferencesNestedLegacyRuntime(commandLine, currentRoot, legacyMarker),
      false,
      relativePath,
    );
  }
});

test("a legacy runtime nested below the active root is still classified for cleanup", () => {
  assert.equal(
    commandLineReferencesNestedLegacyRuntime(
      `node ${currentRoot}/.runtime/old-stack/api.js`,
      currentRoot,
      legacyMarker,
    ),
    true,
  );
});

test("the stable runtime directory remains excluded from legacy classification", () => {
  assert.equal(
    commandLineReferencesNestedLegacyRuntime(
      "node d:/zhinengkefu/desktop/.runtime-stable/web-standalone-server.js",
      currentRoot,
      legacyMarker,
    ),
    false,
  );
});

test("the stable doctor executes its generated PowerShell classifier without a parser error", { skip: process.platform !== "win32" }, () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "stable-doctor-classifier-"));
  try {
    const result = spawnSync(process.execPath, ["tools/stable-desktop-doctor.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        DESKTOP_RUNTIME_DIR: runtimeDir,
        WEB_PORT: "61991",
        API_PORT: "61992",
        MOCK_DESIGN_PLATFORM_PORT: "61993",
      },
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    assert.match(result.stdout, /Stale runtime processes:/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ParserError|-or;/);
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});
