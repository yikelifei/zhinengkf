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
const webActivationSourcePath = path.join(process.cwd(), "apps", "web", "src", "features", "design", "design-activation-page.tsx");
const webAccountSourcePath = path.join(process.cwd(), "apps", "web", "src", "features", "design", "design-account-page.tsx");
const webDesignModelSourcePath = path.join(process.cwd(), "apps", "web", "src", "features", "design", "model.ts");

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
  assert.match(source, /const count = CUSTOMER_DESIGN_CANDIDATE_COUNT/);
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
  const webActivationSource = fs.readFileSync(webActivationSourcePath, "utf8");
  const webAccountSource = fs.readFileSync(webAccountSourcePath, "utf8");
  const webDesignModelSource = fs.readFileSync(webDesignModelSourcePath, "utf8");

  assert.match(clientSource, /redeemArtImageLocalActivation/);
  assert.match(clientSource, /"api\/activation\/redeem"/);
  assert.match(clientSource, /"x-art-device-id": deviceId/);
  assert.match(clientSource, /getArtImageLocalAuthSession\(deviceId = ""\)/);
  assert.match(clientSource, /getArtImageLocalActivationStatus\(deviceId = ""\)/);
  assert.match(clientSource, /this\.http\.get\("api\/auth\/session", artImageLocalDeviceHeaders\(deviceId\)\)/);
  assert.match(clientSource, /this\.http\.get\("api\/activation\/status", artImageLocalDeviceHeaders\(deviceId\)\)/);
  assert.match(clientSource, /requestUrl === "api\/auth\/session"/);
  assert.match(clientSource, /requestUrl === "api\/activation\/status"/);
  assert.match(controllerSource, /@Post\("activation\/redeem"\)/);
  assert.match(controllerSource, /@Get\("candidates"\)/);
  assert.match(controllerSource, /requestDesignPlatformCandidateHealth/);
  assert.match(controllerSource, /@Query\("deviceId"\) deviceIdQuery\?: string/);
  assert.match(controllerSource, /getArtImageLocalAuthSession\(explicitDeviceId\)/);
  assert.match(controllerSource, /getArtImageLocalActivationStatus\(explicitDeviceId\)/);
  assert.match(controllerSource, /updateDesignPlatformRuntimeConfig\(\{\s*adapter: "art_image_local",\s*deviceId,/);
  assert.match(webApiSource, /redeemDesignPlatformActivation/);
  assert.match(webApiSource, /localDevUrl\?: string/);
  assert.match(webApiSource, /localPreviewUrl\?: string/);
  assert.match(webApiSource, /localCandidateBaseUrls\?: string\[\]/);
  assert.match(webApiSource, /DesignPlatformCandidateProbeResponse/);
  assert.match(webApiSource, /getDesignPlatformReadiness\(deviceId = ""\)/);
  assert.match(webApiSource, /getDesignPlatformCandidates\(\)/);
  assert.match(webApiSource, /\/integrations\/design-platform\/candidates/);
  assert.match(webApiSource, /deviceId=\$\{encodeURIComponent\(deviceId\.trim\(\)\)\}/);
  assert.match(webApiSource, /"\/integrations\/design-platform\/activation\/redeem"/);
  assert.match(webDesignModelSource, /createDesignPlatformDeviceId/);
  assert.match(webActivationSource, /redeemDesignPlatformActivation/);
  assert.match(webActivationSource, /const statusDeviceId = deviceIdRef\.current\.trim\(\) \|\| readRememberedDesignPlatformDeviceId\(\)/);
  assert.match(webActivationSource, /getDesignPlatformReadiness\(statusDeviceId\)/);
  assert.match(webActivationSource, /生成设备 ID/);
  assert.match(webActivationSource, /激活设备/);
  assert.match(webActivationSource, /设计平台后台生成的激活码/);
  assert.match(webActivationSource, /rememberDesignPlatformDeviceId/);
  assert.doesNotMatch(webActivationSource, /setActivationCode\(""\);\s*setDeviceId\(""\)/);
  assert.match(webAccountSource, /getDesignPlatformConfig/);
  assert.match(webAccountSource, /const statusDeviceId = deviceIdRef\.current\.trim\(\) \|\| readRememberedDesignPlatformDeviceId\(\)/);
  assert.match(webAccountSource, /getDesignPlatformReadiness\(statusDeviceId\)/);
  assert.match(webAccountSource, /hasBoundDevice/);
  assert.match(webAccountSource, /设备 ID（已有绑定时可留空）/);
  assert.match(webAccountSource, /留空则使用当前绑定设备/);
  assert.match(webAccountSource, /readRememberedDesignPlatformDeviceId/);
});

test("customer poster prompt forbids invented products and enforces production typography", () => {
  const source = fs.readFileSync(clientSourcePath, "utf8");

  assert.match(source, /visualContentMode === "graphic_only"/);
  assert.match(source, /不得出现或虚构商品、礼盒、包装/);
  assert.match(source, /只能使用参考素材和已选商品库中的商品/);
  assert.match(source, /指定中文必须使用端正、清晰、结构正确的印刷字形/);
  assert.match(source, /手机缩略图可读/);
  assert.match(source, /禁止出现任何其他汉字、英文、数字、占位文字或装饰性伪文字/);
});
