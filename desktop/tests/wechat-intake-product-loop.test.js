"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("customer entry leads the operator to verify the first inbound message", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-customer-entry-page.tsx");
  const journey = read("apps/web/src/features/integrations/wechat-work-customer-entry-journey.tsx");
  const visible = `${page}\n${journey}`;

  assert.match(visible, /hasInboundEvidence/);
  assert.match(visible, /生成二维码只代表入口可用，不代表消息链路已打通/);
  assert.match(visible, /href="\/integrations\/wechat-work\/workspace"/);
  assert.match(visible, /去会话工作台等待/);
  assert.match(visible, /官方来信证据已出现/);
  assert.match(page, /const nextDiagnosis = await diagnoseWechatWorkConnection\(\)/);
  assert.match(page, /nextDiagnosis\.configuredOpenKfid/);
});

test("Enterprise WeChat workspace exposes identity and manual takeover without sending", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-workspace-page.tsx");

  assert.match(page, /hasCompleteConversationIdentity/);
  assert.match(page, /客服账号、会话、客户身份已绑定/);
  assert.match(page, /当前是微信客服咨询身份；长期客户关系仍需客户确认添加企业微信专员/);
  assert.match(page, /data-action-id="wechat-work\.workspace\.manual-takeover"/);
  assert.match(page, /controller\.requestManualLockChange/);
  assert.match(page, /controller\.confirmManualLockChange/);
  assert.match(page, /controller\.actionError/);
  assert.match(page, /controller\.actionNotice/);
  assert.match(page, /创建客户入口并验证首条来信/);
  assert.doesNotMatch(page, /queueManualConversationReply|executeManualReplyNow|kf\/send_msg\s*\(/);
});

test("conversation scope counts respect the active channel and identity gates risky actions", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const model = read("apps/web/src/features/conversations/model.ts");

  assert.match(controller, /scopeEligibleConversations/);
  assert.match(controller, /\{ \.\.\.filters, scope: "all" \}/);
  assert.match(controller, /pendingCount: scopeEligibleConversations\.filter/);
  assert.match(controller, /count: scopeEligibleConversations\.filter\(\(item\) => item\.manualLocked\)/);
  assert.match(controller, /canReply: canReply && hasCompleteConversationIdentity\(selectedConversation\)/);
  assert.match(controller, /当前会话缺少账号、会话或客户身份，不能人工接管/);
  assert.match(controller, /当前会话缺少账号、会话或客户身份，人工回复没有入队/);
  assert.match(controller, /当前会话身份不完整，不能上传回复附件/);
  assert.match(controller, /setActionNotice\(""\);[\s\S]*?setActionError\(""\);[\s\S]*?setManualLockTarget\(null\)/);
  assert.match(model, /export function hasCompleteConversationIdentity/);
  assert.match(model, /缺少账号、会话或客户身份，已禁用人工回复与接管/);
});
