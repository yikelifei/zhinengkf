"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Zhenxi design settings expose the installed-release MCP without requesting an external API key", () => {
  const settings = read("apps/web/src/features/design/design-settings-page.tsx");
  const model = read("apps/web/src/features/design/design-settings-model.ts");
  const statusPanel = read("apps/web/src/features/design/design-settings-status-panel.tsx");
  const quickConnect = read("apps/web/src/features/design/design-settings-zhenxi-quick-connect.tsx");
  const submitPage = read("apps/web/src/features/design/design-job-submit-page.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const designApi = read("apps/web/src/features/design/api.ts");
  const controller = read("apps/api/src/integrations/design-platform/design-platform.controller.ts");
  const service = read("apps/api/src/design-jobs/design-jobs.service.ts");
  const source = `${settings}\n${model}\n${statusPanel}\n${quickConnect}`;

  assert.match(settings, /setAdapter\("art_image_local"\)/);
  assert.match(settings, /setAdapter\("zhenxi_external"\)/);
  assert.match(settings, /const \[apiKey, setApiKey\] = useState\(""\)/);
  assert.doesNotMatch(settings, /ART_EXTERNAL_API_KEY/);
  assert.match(settings, /settingsSaveIntent\(adapter, baseUrl, apiKey, accessToken, cookie, deviceId\)/);
  assert.match(source, /apiKey: normalizedApiKey \|\| undefined/);
  assert.match(settings, /isZhenxiDurable = isArtImageLocal \|\| isZhenxiExternal/);
  assert.match(settings, /smokeDisabled = controlsDisabled \|\| !readinessLoaded \|\| !readiness\?\.ok \|\| isZhenxiDurable/);
  assert.match(settings, /生成保护/);
  assert.match(statusPanel, /!isZhenxiDurable/);
  assert.match(statusPanel, /臻希 AI 本地模式/);
  assert.match(statusPanel, /臻希 AI 成品软件 MCP 模式/);
  assert.doesNotMatch(statusPanel, /\/api\/external\/v1\/images\/generate/);
  assert.match(statusPanel, /hasApiKey/);
  assert.match(statusPanel, /本地同步/);
  assert.match(statusPanel, /MCP：先文案后流式出图/);
  assert.match(statusPanel, /不需要企业微信备案，也不需要配置设计平台 callback/);
  assert.match(source, /DesignSettingsZhenxiQuickConnect/);
  assert.match(quickConnect, /只连接已安装并登录的臻希 AI，不调用源码开发版/);
  assert.match(quickConnect, /31870-31879/);
  assert.match(settings, /getDesignPlatformCandidates\(\)/);
  assert.match(statusPanel, /candidateProbe=\{candidateProbe\}/);
  assert.match(quickConnect, /检测到可用臻希 AI 端口/);
  assert.match(quickConnect, /候选端口正在由客服后台探测/);
  assert.match(quickConnect, /candidateStatus/);
  assert.match(quickConnect, /onUseExternal/);
  assert.match(quickConnect, /design-settings-use-zhenxi-external/);
  assert.match(quickConnect, /成品 MCP/);
  assert.match(api, /DesignPlatformCandidateProbeResponse/);
  assert.match(api, /apiKey\?: string/);
  assert.match(api, /\/integrations\/design-platform\/candidates/);
  assert.match(designApi, /getDesignPlatformCandidates/);
  assert.match(controller, /probeDesignPlatformCandidates/);
  assert.match(controller, /localCandidateBaseUrls/);
  assert.match(controller, /requestDesignPlatformCandidateHealth/);
  assert.doesNotMatch(controller, /@Query\("baseUrl"\)/);
  assert.match(quickConnect, /design-settings-open-zhenxi-ai-app/);
  assert.match(api, /action\?: string/);
  assert.match(statusPanel, /check\.action/);
  assert.match(submitPage, /check\.action/);
  assert.match(service, /先到 \/design\/activation 完成设备激活，再到 \/design\/account 登录臻希 AI 账号/);
  assert.match(service, /回到 \/catalog\/bundles 或任务创建页/);
  assert.match(service, /客户参考图、礼盒和全部 SKU/);
});

test("design platform error text points operators to activation, account, template, and quota fixes", () => {
  const ui = read("apps/web/src/features/design/design-ui.tsx");

  assert.match(ui, /designPlatformActionHint/);
  assert.match(ui, /\/design\/activation 使用当前客服设备 ID 重新激活/);
  assert.match(ui, /\/design\/activation 生成或填写设备 ID/);
  assert.match(ui, /\/design\/account 登录臻希 AI 账号/);
  assert.match(ui, /template_access_denied/);
  assert.match(ui, /开通对应模板权限/);
  assert.match(ui, /积分\|额度\|余额/);
  assert.match(ui, /操作员权限、设备激活和臻希 AI 登录状态/);
  assert.doesNotMatch(ui, /直接调用.*local-generate|绕过.*激活|忽略.*登录/);
});
