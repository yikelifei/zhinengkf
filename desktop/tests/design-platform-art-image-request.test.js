"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const clientSourcePath = path.join(
  process.cwd(),
  "apps",
  "api",
  "src",
  "integrations",
  "design-platform",
  "design-platform.client.ts",
);
const controllerSourcePath = path.join(
  process.cwd(),
  "apps",
  "api",
  "src",
  "integrations",
  "design-platform",
  "design-platform.controller.ts",
);
const appConfigSourcePath = path.join(process.cwd(), "apps", "api", "src", "shared", "app-config.ts");
const webApiSourcePath = path.join(process.cwd(), "apps", "web", "src", "lib", "api.ts");
const webPageSourcePath = path.join(process.cwd(), "apps", "web", "src", "app", "page.tsx");

test("art image local adapter keeps customer-facing generation prompt in readable Chinese", () => {
  const source = fs.readFileSync(clientSourcePath, "utf8");

  assert.match(source, /客服礼盒出图/);
  assert.match(source, /候选图 \$\{index \+ 1\}：构图、角度和背景/);
  assert.match(source, /生成企业客户礼盒真实产品摆拍效果图/);
  assert.match(source, /必须展示礼盒和全部 SKU 商品/);
  assert.match(source, /不更换商品，不虚构包装/);
  assert.doesNotMatch(source, /瀹㈡湇绀肩洅鍑哄浘/);
  assert.doesNotMatch(source, /鍊欓€夊浘/);
  assert.doesNotMatch(source, /鐢熸垚浼佷笟瀹㈡埛/);
  assert.doesNotMatch(source, /浣犳槸绀肩洅/);
});

test("art image local adapter enforces real references before formal generation", () => {
  const source = fs.readFileSync(clientSourcePath, "utf8");

  assert.match(source, /inspectRealDesignReferences/);
  assert.match(source, /customer reference image is required for real design generation/);
  assert.match(source, /SKU or gift-box image is required for real design generation/);
  assert.match(source, /every SKU and gift-box item must have a usable PNG\/JPG\/WebP image/);
  assert.match(source, /uniqueRefs\(\[\.\.\.assetRefs, \.\.\.bundleRefs\]\)\.slice\(0, 12\)/);
  assert.match(source, /clampInteger\(payload\.outputCount \|\| appConfig\.defaultOutputCount, 1, 6\)/);
});

test("art image local adapter does not cache prompt text from generation results", () => {
  const source = fs.readFileSync(clientSourcePath, "utf8");

  assert.match(source, /sanitizeArtImageLocalRaw\(data\)/);
  assert.match(source, /key\.toLowerCase\(\)\.includes\("prompt"\)/);
  assert.doesNotMatch(source, /job\.raw = data/);
});

test("default design platform card type is readable Chinese", () => {
  const source = fs.readFileSync(appConfigSourcePath, "utf8");

  assert.match(source, /designPlatformCardType: process\.env\.DESIGN_PLATFORM_CARD_TYPE \|\| "礼盒真实产品摆拍"/);
  assert.doesNotMatch(source, /绀肩洅鐪熷疄浜у搧/);
});

test("design platform activation redeem is wired before account login", () => {
  const clientSource = fs.readFileSync(clientSourcePath, "utf8");
  const controllerSource = fs.readFileSync(controllerSourcePath, "utf8");
  const webApiSource = fs.readFileSync(webApiSourcePath, "utf8");
  const webPageSource = fs.readFileSync(webPageSourcePath, "utf8");

  assert.match(clientSource, /redeemArtImageLocalActivation/);
  assert.match(clientSource, /"\/api\/activation\/redeem"/);
  assert.match(clientSource, /"x-art-device-id": deviceId/);
  assert.match(controllerSource, /@Post\("activation\/redeem"\)/);
  assert.match(controllerSource, /updateDesignPlatformRuntimeConfig\(\{\s*adapter: "art_image_local",\s*deviceId,/);
  assert.match(webApiSource, /redeemDesignPlatformActivation/);
  assert.match(webApiSource, /"\/integrations\/design-platform\/activation\/redeem"/);
  assert.match(webPageSource, /createDesignPlatformDeviceId/);
  assert.match(webPageSource, /生成设备 ID/);
  assert.match(webPageSource, /激活设备/);
  assert.match(webPageSource, /设计平台后台生成的激活码/);
});
