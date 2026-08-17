"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Enterprise WeChat workspace renders official conversations inside Smart Kefu", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-workspace-page.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const route = read("apps/web/src/app/integrations/wechat-work/workspace/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");

  assert.match(route, /routeId="wechatWorkWorkspace"/);
  assert.match(route, /WechatWorkWorkspacePage/);
  assert.match(manifest, /wechatWorkWorkspace:[\s\S]*?href: "\/integrations\/wechat-work\/workspace"/);
  assert.match(page, /useConversationsController\(api \|\| conversationsFeatureApi, null, "detail"\)/);
  assert.match(page, /onChannelChange\("work_wechat"\)/);
  assert.match(page, /ConversationThreadPane/);
  assert.match(page, /variant="wecom"/);
  assert.match(page, /getWechatWorkCallbackEventStatus/);
  assert.match(page, /window\.setInterval\(\(\) => void refreshEventStatus\(\), 2_000\)/);
  assert.match(page, /官方回调 \+ sync_msg/);
  assert.match(page, /kf\/send_msg 安全队列/);
  assert.match(page, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(page, /aria-keyshortcuts="Control\+F Meta\+F"/);
  assert.match(page, /href="\/integrations\/wechat-work\/settings"/);
  assert.match(api, /fetch\(`\$\{API_BASE\}\/wechat-work\/events\/status`/);
});

test("Enterprise WeChat workspace uses WeCom-style reply keyboard behavior without fake attachment actions", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-workspace-page.tsx");
  const thread = read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx");
  const composer = read("apps/web/src/components/conversation-workbench/conversation-assistant-composer.tsx");
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");

  assert.match(thread, /variant\?: "default" \| "wecom"/);
  assert.match(composer, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.nativeEvent\.isComposing/);
  assert.match(composer, /Enter 发送 · Shift\+Enter 换行/);
  assert.match(composer, /conversations\.suggestion\.use-compact/);
  assert.match(composer, /conversations\.composer-tool-emoji\.open/);
  assert.match(composer, /accept="image\/jpeg,image\/png/);
  assert.match(composer, /accept="application\/pdf,text\/plain/);
  assert.match(composer, /actions\.onAttachFiles/);
  assert.match(composer, /!composer\.value\.trim\(\) && !\(composer\.attachments\?\.length\)/);
  assert.match(composer, /if \(!sendDisabled\) actions\.onSendReply\(\)/);
  assert.match(composer, /replyBytes > 2048/);
  assert.match(thread, /thread\.messages\.map\(\(message\) => <TimelineMessage/);
  assert.match(thread, /newMessageCount \? `\$\{newMessageCount\} 条新消息` : "回到最新"/);
  assert.match(controller, /replyDraftsRef\.current\.get\(selectedIdentityKey\)/);
  assert.match(controller, /draftPreview/);
  assert.match(page, /草稿：\$\{conversation\.draftPreview\}/);
});

test("Enterprise WeChat timeline exposes only identity-bound local attachment previews", () => {
  const model = read("apps/web/src/features/conversations/model.ts");
  const api = read("apps/web/src/lib/api.ts");
  const controller = read("apps/api/src/assets/assets.controller.ts");
  const service = read("apps/api/src/assets/assets.service.ts");
  const localStore = read("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /localAssetByIdUrl/);
  assert.match(api, /\/assets\/\$\{encodeURIComponent\(value\)\}\/local-file/);
  assert.match(model, /localAssetByIdUrl\(attachment\.assetId, attachmentIdentity\)/);
  assert.match(controller, /@Get\(":id\/local-file"\)/);
  assert.match(controller, /readLocalAssetById/);
  assert.match(service, /assertExpectedIdentity\(asset, expected, "local asset"\)/);
  assert.match(service, /local customer asset requires conversation identity/);
  assert.match(localStore, /timelineTaskAttachments\(task, data\.designAssets\)/);
});

test("Enterprise WeChat workspace no longer controls or overlays WXWork.exe", () => {
  const main = read("apps/electron/main.js");
  const preload = read("apps/electron/preload.js");
  const builder = read("electron-builder.yml");
  const page = read("apps/web/src/features/integrations/wechat-work-workspace-page.tsx");

  assert.doesNotMatch(main, /wecom-native|WecomNativeWindowHost|WXWork\.exe/);
  assert.doesNotMatch(preload, /wecomNative|wecom-native/);
  assert.doesNotMatch(builder, /wecom-native-window-host/);
  assert.doesNotMatch(page, /<iframe|SetParent|GWLP_HWNDPARENT|WXWork\.exe|nativeWindow|wecomNative/i);
  assert.equal(fs.existsSync(path.join(root, "apps/electron/wecom-native-window-host.js")), false);
  assert.equal(fs.existsSync(path.join(root, "apps/electron/wecom-native-window-host.ps1")), false);
});
