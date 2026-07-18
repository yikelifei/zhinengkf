"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const featureRoot = path.join(desktopRoot, "apps/web/src/features/integrations");

function read(name) {
  return fs.readFileSync(path.join(featureRoot, name), "utf8");
}

const files = {
  page: read("personal-wechat-voice-assist-page.tsx"),
  model: read("personal-wechat-voice-assist-model.ts"),
  primitives: read("personal-wechat-voice-assist-primitives.tsx"),
  stages: read("personal-wechat-voice-assist-stages.tsx"),
};
const combined = Object.values(files).join("\n");

test("personal WeChat voice assist is an independent fail-closed feature", () => {
  assert.match(files.page, /export function PersonalWechatVoiceAssistPage/);
  assert.match(files.page, /enabled = false/);
  assert.match(files.model, /recordingAuthorization: "missing"/);
  assert.match(files.model, /neutralVoiceAuthorization: "pending"/);
  assert.match(files.model, /previewStatus: "unavailable"/);
  assert.match(files.page, /真实发送关闭/);
  assert.match(files.stages, /本页没有发送按钮/);
});

test("model, guards, action primitives, stages and page composition remain separated", () => {
  assert.match(files.model, /export function derivePersonalWechatVoiceAssistState/);
  assert.match(files.primitives, /export function VoiceActionButton/);
  assert.match(files.primitives, /export function VoiceStageHeading/);
  for (const stage of [
    "VoiceRecordingStage",
    "VoiceTranscriptStage",
    "VoicePreviewStage",
    "VoiceApprovalStage",
  ]) {
    assert.match(files.stages, new RegExp(`export function ${stage}`));
    assert.match(files.page, new RegExp(`<${stage}\\b`));
  }
  assert.doesNotMatch(files.page, /function firstBlock|function VoiceActionButton|function VoiceStageHeading/);
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
    assert.match(files.model, new RegExp(`${callback}:`), `${callback} must stay in the controlled action contract`);
    assert.match(files.stages, new RegExp(`actions\\.${callback}`), `${callback} must be wired by a stage`);
  }

  assert.doesNotMatch(combined, /\buseState\s*\(|\buseEffect\s*\(|\buseTransition\s*\(/);
  assert.doesNotMatch(combined, /\bfetch\s*\(|\baxios\b|localStorage|sessionStorage/);
  assert.doesNotMatch(combined, /MediaRecorder|getUserMedia|XMLHttpRequest|FormData/);
});

test("recording authorization, AI disclosure and manual listening are mandatory boundaries", () => {
  assert.match(files.model, /必须先取得当前操作员本次录音授权/);
  assert.match(files.page, /只能录制当前操作员主动口述/);
  assert.match(files.page, /禁止后台采集客户通话、克隆第三方声音或冒充真人/);
  assert.match(files.model, /PERSONAL_WECHAT_AI_VOICE_DISCLOSURE = "AI 合成语音"/);
  assert.ok(
    (combined.match(/PERSONAL_WECHAT_AI_VOICE_DISCLOSURE/g) || []).length >= 5,
    "AI disclosure must be exported and reused across the page",
  );
  assert.match(files.model, /!model\.previewListened && "操作员必须完整人工试听后才能审批"/);
  assert.match(files.model, /不能跳过试听直接审批/);
  assert.match(files.page, /披露标识不可隐藏/);
});

test("the feature cannot execute or disguise a real send", () => {
  assert.doesNotMatch(
    combined,
    /queueManualConversationReply|executeSendTask|processSafeSendQueue|createSendTask|sendMessage|onSend\b/,
  );
  assert.doesNotMatch(combined, /from\s+["'][^"']*(?:lib\/api|features\/send|send-policy)["']/);
  assert.match(files.page, /不导入发送 API、不创建发送任务，也没有真实发送按钮/);
  assert.match(files.page, /独立发送页面重新核对客户、账号和窗口身份/);
});

test("every action button exposes a stable id and a readable disabled reason contract", () => {
  const button = files.primitives.match(/<button\b[\s\S]*?>/)?.[0] || "";
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
    assert.match(files.stages, new RegExp(actionId.replaceAll(".", "\\.")), `${actionId} must remain stable`);
  }
  assert.match(combined, /禁用原因：/);
});

test("React modules stay below the production 400-line boundary", () => {
  for (const name of [
    "personal-wechat-voice-assist-page.tsx",
    "personal-wechat-voice-assist-primitives.tsx",
    "personal-wechat-voice-assist-stages.tsx",
  ]) {
    const lineCount = read(name).split(/\r?\n/).length;
    assert.ok(lineCount < 400, `${name} has ${lineCount} lines; expected fewer than 400`);
  }
});

test("the page reuses the modular integration design system without route coupling", () => {
  assert.match(files.page, /FeaturePage/);
  assert.match(files.page, /FeatureNotice/);
  assert.match(combined, /integration-pages\.module\.css/);
  assert.match(files.page, /styles\.flowList/);
  assert.match(files.stages, /styles\.buttonRow/);
  assert.doesNotMatch(combined, /route-manifest|WorkspaceSectionId|legacy-workbench|modular-workbench-shell/);
});
