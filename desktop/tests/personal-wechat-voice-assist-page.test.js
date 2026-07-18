"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const featurePath = path.join(
  desktopRoot,
  "apps/web/src/features/integrations/personal-wechat-voice-assist-page.tsx",
);
const source = fs.readFileSync(featurePath, "utf8");

test("personal WeChat voice assist is an independent fail-closed feature", () => {
  assert.match(source, /export function PersonalWechatVoiceAssistPage/);
  assert.match(source, /enabled = false/);
  assert.match(source, /recordingAuthorization: "missing"/);
  assert.match(source, /neutralVoiceAuthorization: "pending"/);
  assert.match(source, /previewStatus: "unavailable"/);
  assert.match(source, /真实发送关闭/);
  assert.match(source, /本页没有发送按钮/);
});

test("recording, transcript, preview and approval remain controlled callbacks", () => {
  for (const callback of [
    "onStartRecording",
    "onPauseRecording",
    "onResumeRecording",
    "onStopRecording",
    "onTranscriptChange",
    "onApproveTranscript",
    "onStartPreview",
    "onPausePreview",
    "onStopPreview",
    "onApproveVoice",
    "onRevokeApproval",
  ]) {
    assert.match(source, new RegExp(`${callback}:`), `${callback} must stay in the controlled action contract`);
    assert.match(source, new RegExp(`actions\\.${callback}`), `${callback} must be wired by the page`);
  }

  assert.doesNotMatch(source, /\buseState\s*\(|\buseEffect\s*\(|\buseTransition\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /MediaRecorder|getUserMedia|XMLHttpRequest|FormData/);
});

test("recording authorization, AI disclosure and manual listening are mandatory boundaries", () => {
  assert.match(source, /必须先取得当前操作员本次录音授权/);
  assert.match(source, /只能录制当前操作员主动口述/);
  assert.match(source, /禁止后台采集客户通话、克隆第三方声音或冒充真人/);
  assert.match(source, /PERSONAL_WECHAT_AI_VOICE_DISCLOSURE = "AI 合成语音"/);
  assert.ok(
    (source.match(/PERSONAL_WECHAT_AI_VOICE_DISCLOSURE/g) || []).length >= 3,
    "AI disclosure must be reused across the page",
  );
  assert.match(source, /!model\.previewListened && "操作员必须完整人工试听后才能审批"/);
  assert.match(source, /不能跳过试听直接审批/);
  assert.match(source, /披露标识不可隐藏/);
});

test("the feature cannot execute or disguise a real send", () => {
  assert.doesNotMatch(
    source,
    /queueManualConversationReply|executeSendTask|processSafeSendQueue|createSendTask|sendMessage|onSend\b/,
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:lib\/api|features\/send|send-policy)["']/);
  assert.match(source, /不导入发送 API、不创建发送任务，也没有真实发送按钮/);
  assert.match(source, /独立发送页面重新核对客户、账号和窗口身份/);
});

test("every action button exposes a stable id and a readable disabled reason contract", () => {
  const button = source.match(/<button\b[\s\S]*?>/)?.[0] || "";
  assert.match(button, /data-action-id=\{actionId\}/);
  assert.match(button, /data-disabled-reason=\{disabledReason \?\? "无"\}/);
  assert.match(button, /aria-label=\{label\}/);
  assert.match(button, /aria-describedby=\{reasonId\}/);
  assert.match(button, /title=\{disabledReason \?\?/);
  assert.match(button, /disabled=\{Boolean\(disabledReason\)\}/);

  for (const actionId of [
    "integrations.personal-wechat.voice.record.start",
    "integrations.personal-wechat.voice.record.pause",
    "integrations.personal-wechat.voice.record.resume",
    "integrations.personal-wechat.voice.record.stop",
    "integrations.personal-wechat.voice.transcript.approve",
    "integrations.personal-wechat.voice.preview.play",
    "integrations.personal-wechat.voice.preview.pause",
    "integrations.personal-wechat.voice.preview.stop",
    "integrations.personal-wechat.voice.approval.approve",
    "integrations.personal-wechat.voice.approval.revoke",
  ]) {
    assert.match(source, new RegExp(actionId.replaceAll(".", "\\.")), `${actionId} must remain stable`);
  }
  assert.match(source, /禁用原因：/);
});

test("the page reuses the modular integration design system without route coupling", () => {
  assert.match(source, /FeaturePage/);
  assert.match(source, /FeatureNotice/);
  assert.match(source, /integration-pages\.module\.css/);
  assert.match(source, /styles\.flowList/);
  assert.match(source, /styles\.buttonRow/);
  assert.doesNotMatch(source, /route-manifest|WorkspaceSectionId|legacy-workbench|modular-workbench-shell/);
});
