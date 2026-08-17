"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  createZhenxiDesktopDeviceInfo,
  normalizeZhenxiEmbeddedBounds,
  normalizeZhenxiEmbeddedUrl,
  resolveZhenxiDesktopLayout,
} = require("../apps/electron/zhenxi-embedded-view");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("embedded Zhenxi URL policy accepts only the real app origins and controlled local release ports", () => {
  assert.equal(normalizeZhenxiEmbeddedUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000/");
  assert.equal(normalizeZhenxiEmbeddedUrl("http://localhost:31870/workspace"), "http://localhost:31870/workspace");
  assert.equal(normalizeZhenxiEmbeddedUrl("http://127.0.0.1:31879/"), "http://127.0.0.1:31879/");
  assert.equal(normalizeZhenxiEmbeddedUrl("https://app.zhenxiai.cloud/projects"), "https://app.zhenxiai.cloud/projects");

  for (const rejected of [
    "http://127.0.0.1:3100",
    "http://127.0.0.1:3700",
    "http://192.168.1.8:31870",
    "https://example.com",
    "javascript:alert(1)",
    "http://user:secret@127.0.0.1:31870",
  ]) {
    assert.equal(normalizeZhenxiEmbeddedUrl(rejected), "", rejected);
  }
});

test("embedded bounds reject missing, non-finite, zero-sized, and excessive renderer values", () => {
  assert.deepEqual(normalizeZhenxiEmbeddedBounds({ x: 10.4, y: 20.6, width: 900.2, height: 700.8 }), {
    x: 10,
    y: 21,
    width: 900,
    height: 701,
  });
  assert.equal(normalizeZhenxiEmbeddedBounds(null), null);
  assert.equal(normalizeZhenxiEmbeddedBounds({ x: 0, y: 0, width: 0, height: 1 }), null);
  assert.equal(normalizeZhenxiEmbeddedBounds({ x: 0, y: 0, width: Infinity, height: 1 }), null);
  assert.equal(normalizeZhenxiEmbeddedBounds({ x: -1, y: 0, width: 1, height: 1 }), null);
});

test("embedded Zhenxi reuses the existing deterministic desktop device identity contract", () => {
  assert.deepEqual(createZhenxiDesktopDeviceInfo({
    platform: "win32",
    arch: "x64",
    hostname: "studio-pc",
    username: "artist",
    home: "C:\\Users\\artist",
  }), {
    id: "desktop-bacf8520fe720ae358627306ba227e41",
    label: "studio-pc / win32",
  });
});

test("embedded Zhenxi keeps the formal 1440px desktop viewport inside the narrower customer-service host", () => {
  const layout = resolveZhenxiDesktopLayout({ x: 212, y: 200, width: 1212, height: 701 });
  assert.deepEqual(layout?.bounds, { x: 212, y: 200, width: 1212, height: 701 });
  assert.equal(layout?.logicalViewportWidth, 1440);
  assert.ok(layout && layout.zoomFactor < 1);
  assert.equal(resolveZhenxiDesktopLayout({ x: 0, y: 0, width: 1440, height: 900 })?.zoomFactor, 1);
});

test("Electron hosts Zhenxi in a sandboxed dedicated partition and trusts only the main customer-service renderer", () => {
  const main = read("apps/electron/main.js");
  const preload = read("apps/electron/preload.js");
  const zhenxiPreload = read("apps/electron/zhenxi-embedded-preload.js");
  const builder = read("electron-builder.yml");

  assert.match(main, /new WebContentsView\(\{[\s\S]*?partition: ZHENXI_EMBEDDED_PARTITION/);
  assert.match(main, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true/);
  assert.match(main, /preload: path\.join\(__dirname, "zhenxi-embedded-preload\.js"\)/);
  assert.match(main, /--art-device-id=\$\{encodeURIComponent\(zhenxiDesktopDevice\.id\)\}/);
  assert.match(main, /new URL\("\/api\/activation\/status", normalizedUrl\)/);
  assert.match(main, /"x-art-device-id": zhenxiDesktopDevice\.id/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /normalizeZhenxiEmbeddedUrl\(payload\?\.url\)/);
  assert.match(main, /normalizeZhenxiEmbeddedBounds\(payload\?\.bounds\)/);
  assert.match(main, /applyZhenxiDesktopLayout/);
  assert.match(main, /setZoomFactor\(layout\.zoomFactor\)/);
  assert.match(main, /31870 \+ index/);
  assert.match(main, /data\?\.service === "zhenxi-ai"/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.doesNotMatch(main, /partition: DESKTOP_SESSION_PARTITION,[\s\S]{0,200}zhenxi/i);
  assert.match(preload, /zhenxiEmbedded:[\s\S]*?zhenxi-embedded:discover-desktop[\s\S]*?zhenxi-embedded:open[\s\S]*?zhenxi-embedded:hide/);
  assert.match(zhenxiPreload, /contextBridge\.exposeInMainWorld\("desktopShell"/);
  assert.match(zhenxiPreload, /deviceId: readArgument\("art-device-id"\)/);
  assert.match(builder, /apps\/electron\/zhenxi-embedded-view\.js/);
  assert.match(builder, /apps\/electron\/zhenxi-embedded-preload\.js/);
});

test("design center exposes the real embedded workspace without an iframe or a duplicate generation implementation", () => {
  const page = read("apps/web/src/features/design/design-zhenxi-workspace-page.tsx");
  const route = read("apps/web/src/app/design/zhenxi-ai/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

  assert.match(route, /routeId="designZhenxiAi"/);
  assert.match(manifest, /designZhenxiAi:[\s\S]*?href: "\/design\/zhenxi-ai"/);
  assert.match(navigation, /WORKBENCH_ROUTES\.designZhenxiAi\.href[\s\S]*?label: "臻希 AI"/);
  assert.match(page, /getDesignPlatformCandidates\(\)/);
  assert.match(page, /configuredLocalZhenxiUrl\(nextConfig\)/);
  assert.match(page, /已按当前真实设计通道打开臻希 AI/);
  assert.match(page, /window\.smartKefu\?\.zhenxiEmbedded/);
  assert.match(page, /isZhenxiReleaseDesktopUrl/);
  assert.match(page, /logicalViewportWidth/);
  assert.match(page, /discoverDesktop\(\)/);
  assert.match(page, /设备待激活/);
  assert.match(page, /复用臻希桌面设备身份/);
  assert.match(page, /项目、素材、提示词、任务和生成结果/);
  assert.match(page, /不会重新提交生成任务/);
  assert.doesNotMatch(page, /<iframe|zhenxi_generate|local-generate/i);
});
