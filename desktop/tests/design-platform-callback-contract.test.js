"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = process.cwd();

test("design platform callback endpoint is surfaced in config UI and submit payload", () => {
  const serviceSource = read("apps", "api", "src", "design-jobs", "design-jobs.service.ts");
  const typesSource = read("apps", "api", "src", "integrations", "design-platform", "design-platform.types.ts");
  const controllerSource = read(
    "apps",
    "api",
    "src",
    "integrations",
    "design-platform",
    "design-platform.controller.ts",
  );
  const appConfigSource = read("apps", "api", "src", "shared", "app-config.ts");
  const webApiSource = read("apps", "web", "src", "lib", "api.ts");
  const webPageSource = read("apps", "web", "src", "app", "page.tsx");
  const mockPlatformSource = read("tools", "mock-design-platform.js");

  assert.match(appConfigSource, /customerServicePublicBaseUrl/);
  assert.match(appConfigSource, /designPlatformCallbackUrl/);
  assert.match(appConfigSource, /callbackUrl:/);
  assert.match(controllerSource, /hasCallbackApiKey/);
  assert.match(typesSource, /callback\?: \{/);
  assert.match(serviceSource, /callback: this\.buildDesignPlatformCallback\(job\.requestId\)/);
  assert.match(serviceSource, /fallbackPolling: true/);
  assert.match(mockPlatformSource, /notifyCallback\(current, body\.callback\)/);
  assert.match(webApiSource, /callbackUrl\?: string/);
  assert.match(webApiSource, /hasCallbackApiKey\?: boolean/);
  assert.match(webPageSource, /出图完成回调地址/);
  assert.match(webPageSource, /回调签名/);
});

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), "utf8");
}
