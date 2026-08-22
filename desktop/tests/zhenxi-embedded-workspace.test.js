"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  createZhenxiEmbeddedActivationStatus,
  createZhenxiDesktopDeviceInfo,
  normalizeZhenxiEmbeddedBounds,
  normalizeZhenxiEmbeddedUrl,
  resolveZhenxiDesktopLayout,
} = require("../apps/electron/zhenxi-embedded-view");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("embedded Zhenxi URL policy accepts only controlled local desktop ports", () => {
  assert.equal(normalizeZhenxiEmbeddedUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000/");
  assert.equal(normalizeZhenxiEmbeddedUrl("http://localhost:31870/workspace"), "http://localhost:31870/workspace");
  assert.equal(normalizeZhenxiEmbeddedUrl("http://127.0.0.1:31879/"), "http://127.0.0.1:31879/");

  for (const rejected of [
    "http://127.0.0.1:3100",
    "http://127.0.0.1:3700",
    "http://192.168.1.8:31870",
    "https://app.zhenxiai.cloud/projects",
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

test("embedded Zhenxi preserves the deterministic desktop device identity fallback", () => {
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

test("embedded Zhenxi skips activation codes only inside the mirrored desktop view", () => {
  const status = createZhenxiEmbeddedActivationStatus("external-device");
  assert.deepEqual(status, {
    required: false,
    active: true,
    reason: "not_required",
    deviceIdSuffix: "bed7b92a5c",
    activation: null,
  });
});

test("embedded Zhenxi keeps the formal 1440px desktop viewport inside the customer-service host", () => {
  const layout = resolveZhenxiDesktopLayout({ x: 212, y: 200, width: 1212, height: 701 });
  assert.deepEqual(layout?.bounds, { x: 212, y: 200, width: 1212, height: 701 });
  assert.equal(layout?.logicalViewportWidth, 1440);
  assert.ok(layout && layout.zoomFactor < 1);
  assert.equal(resolveZhenxiDesktopLayout({ x: 0, y: 0, width: 1440, height: 900 })?.zoomFactor, 1);
});

test("Electron mirrors only the external Zhenxi session into its sandboxed view", () => {
  const main = read("apps/electron/main.js");
  const preload = read("apps/electron/preload.js");
  const zhenxiPreload = read("apps/electron/zhenxi-embedded-preload.js");
  const builder = read("electron-builder.yml");

  assert.match(main, /new WebContentsView\(\{[\s\S]*?partition: ZHENXI_EMBEDDED_PARTITION/);
  assert.match(main, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true/);
  assert.match(main, /preload: path\.join\(__dirname, "zhenxi-embedded-preload\.js"\)/);
  assert.match(main, /readZhenxiSharedSession\(ZHENXI_SHARED_SESSION_OPTIONS\)/);
  assert.match(main, /zhenxiSharedSessionRecord\?\.deviceId/);
  assert.match(main, /--art-activation-status=/);
  assert.match(main, /applyZhenxiSharedSessionRequestHeaders/);
  assert.match(main, /isZhenxiSessionMutationUrl/);
  assert.match(main, /clearZhenxiEmbeddedLoginCookies/);
  assert.match(main, /cookies\.remove\(origin, ZHENXI_ACCESS_COOKIE\)/);
  assert.match(main, /cookies\.remove\(origin, ZHENXI_REFRESH_COOKIE\)/);
  assert.match(main, /sharedSession: \{ \.\.\.zhenxiSharedSession \}/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /normalizeZhenxiEmbeddedUrl\(payload\?\.url\)/);
  assert.match(main, /normalizeZhenxiEmbeddedBounds\(payload\?\.bounds\)/);
  assert.match(main, /setZoomFactor\(layout\.zoomFactor\)/);
  assert.match(main, /31870 \+ index/);
  assert.match(main, /data\?\.service === "zhenxi-ai"/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(main, /ZHENXI_EMBEDDED_LOAD_TIMEOUT_MS = 20_000/);
  assert.match(main, /render-process-gone/);
  assert.match(preload, /zhenxiEmbedded:[\s\S]*?zhenxi-embedded:discover-desktop[\s\S]*?zhenxi-embedded:open[\s\S]*?zhenxi-embedded:hide/);
  assert.match(zhenxiPreload, /contextBridge\.exposeInMainWorld\("desktopShell"/);
  assert.match(zhenxiPreload, /contextBridge\.executeInMainWorld/);
  assert.match(zhenxiPreload, /localStorage\.setItem\("art_token", "cookie-session"\)/);
  assert.match(zhenxiPreload, /target\.pathname === "\/api\/activation\/status"/);
  assert.match(zhenxiPreload, /target\.pathname !== "\/api\/auth\/session"/);
  assert.match(builder, /apps\/electron\/zhenxi-embedded-view\.js/);
  assert.match(builder, /apps\/electron\/zhenxi-shared-session\.js/);
  assert.match(builder, /apps\/electron\/zhenxi-embedded-preload\.js/);
});

test("design center mirrors the local app and never offers an internal or cloud login fallback", () => {
  const page = read("apps/web/src/features/design/design-zhenxi-workspace-page.tsx");
  const model = read("apps/web/src/features/design/design-zhenxi-embedded-model.ts");
  const route = read("apps/web/src/app/design/zhenxi-ai/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

  assert.match(route, /routeId="designZhenxiAi"/);
  assert.match(manifest, /designZhenxiAi:[\s\S]*?href: "\/design\/zhenxi-ai"/);
  assert.match(navigation, /WORKBENCH_ROUTES\.designZhenxiAi\.href[\s\S]*?label: "臻希 AI"/);
  assert.match(page, /getDesignPlatformCandidates\(\)/);
  assert.match(page, /configuredLocalZhenxiUrl\(configResult\)/);
  assert.match(model, /candidate\.generationReady !== false/);
  assert.match(page, /const nextUrl = releaseDesktop \|\| healthyLocal \|\| configuredLocal/);
  assert.match(page, /界面与登录状态都以外部软件为准/);
  assert.match(page, /登录来源/);
  assert.match(page, /外部臻希 AI 软件/);
  assert.match(page, /不需要在智能客服里再次登录或验证/);
  assert.match(page, /外部会话已镜像/);
  assert.match(page, /账号、项目、素材、任务与生成结果/);
  assert.match(page, /window\.smartKefu\?\.zhenxiEmbedded/);
  assert.match(page, /discoverDesktop\(\)/);
  assert.match(page, /BROWSER_EMBED_HEALTH_URL/);
  assert.match(page, /BROWSER_EMBED_BOOTSTRAP_URL/);
  assert.match(page, /sharedSession\?\.authenticated/);
  assert.match(page, /data-action-id="zhenxi-browser-embedded-frame"/);
  assert.match(page, /<iframe/);
  assert.match(model, /sharedSession:/);
  assert.doesNotMatch(page, /app\.zhenxiai\.cloud|切换到臻希云端|登录表单|zhenxi_generate|local-generate/i);
});
