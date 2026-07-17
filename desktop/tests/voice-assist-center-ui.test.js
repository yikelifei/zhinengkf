"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const componentRoot = "apps/web/src/components/voice-assist-center";
const read = (file) => fs.readFileSync(path.join(root, componentRoot, file), "utf8");

const files = {
  component: read("voice-assist-center.tsx"),
  types: read("types.ts"),
  css: read("voice-assist-center.module.css"),
  index: read("index.ts"),
};

test("voice assist center is a controlled presentation module", () => {
  assert.match(files.types, /export type VoiceAssistCenterProps/);
  assert.match(files.types, /model: VoiceAssistCenterModel/);
  assert.match(files.types, /actions: VoiceAssistCenterActions/);
  assert.match(files.component, /export function VoiceAssistCenter\(\{ model, actions/);

  for (const callback of [
    "onStartRecording",
    "onPauseRecording",
    "onStopRecording",
    "onTranscriptChange",
    "onApproveTranscript",
    "onStartPreview",
    "onPausePreview",
    "onStopPreview",
    "onApproveVoice",
    "onRevokeApproval",
  ]) {
    assert.match(files.types, new RegExp(`${callback}:`), `${callback} should be required by the controlled contract`);
    assert.match(files.component, new RegExp(`actions\\.${callback}`), `${callback} should be wired to a native control`);
  }

  const source = [files.component, files.types].join("\n");
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /\buseState\s*\(|\buseEffect\s*\(|\buseTransition\s*\(/);
  assert.doesNotMatch(source, /MediaRecorder|getUserMedia|FormData|XMLHttpRequest/);
  assert.doesNotMatch(source, /queueManualConversationReply|executeSendTask|processSafeSendQueue|sendMessage/);
});

test("workflow separates operator recording, STT review, neutral TTS preview and approval", () => {
  assert.match(files.types, /export type VoiceAssistStage = "record" \| "review" \| "preview" \| "approved"/);
  assert.match(files.types, /voiceStyle: "neutral-synthetic"/);
  assert.match(files.component, /真人口述/);
  assert.match(files.component, /STT 转写草稿/);
  assert.match(files.component, /人工校对/);
  assert.match(files.component, /中性 TTS 预览/);
  assert.match(files.component, /审批此语音/);
  assert.match(files.component, /撤销审批/);
  assert.match(files.component, /停止录音/);
  assert.match(files.component, /停止 AI 合成语音预览/);
  assert.match(files.component, /系统不会自动发送/);
});

test("AI synthesis disclosure is permanent and unsafe impersonation capabilities are absent", () => {
  assert.match(files.component, /export const AI_SYNTHETIC_VOICE_DISCLOSURE = "AI 合成语音"/);
  assert.ok(
    (files.component.match(/AI_SYNTHETIC_VOICE_DISCLOSURE/g) || []).length >= 4,
    "AI disclosure must remain visible across safety, preview and audit surfaces",
  );
  assert.match(files.component, /不支持声音克隆或冒充真人/);
  assert.match(files.component, /该标识不可隐藏/);
  assert.match(files.component, /禁止声音克隆和真人身份冒充/);
  assert.doesNotMatch(files.types, /clone|impersonat|hideDisclosure|removeDisclosure/i);
  assert.doesNotMatch(
    [files.component, files.types].join("\n"),
    /on(?:CloneVoice|Impersonate|HideDisclosure)|voiceCloneEnabled|impersonationEnabled|hideAiDisclosure/i,
  );
});

test("all native controls are explicitly wired and guarded", () => {
  for (const button of files.component.match(/<button\b[\s\S]*?>/g) || []) {
    assert.match(button, /\bonClick=/, `button is missing an explicit callback: ${button.slice(0, 140)}`);
    assert.match(button, /\bdisabled=/, `button is missing an explicit guard: ${button.slice(0, 140)}`);
  }
  assert.match(files.component, /value=\{model\.transcript\.value\}/);
  assert.match(files.component, /onChange=\{\(event\) => actions\.onTranscriptChange\(event\.target\.value\)\}/);
  assert.match(files.component, /disabled=\{disabled \|\| !transcriptReviewed \|\| !previewAuthorized/);
});

test("Tencent-style tokens and responsive module stay compact and gradient-free", () => {
  assert.match(files.css, /--va-brand:\s*var\(--wk-color-brand\)/);
  assert.match(files.css, /--va-border:\s*var\(--wk-color-border\)/);
  assert.match(files.css, /--va-surface:\s*var\(--wk-color-surface\)/);
  assert.match(files.css, /grid-template-columns:\s*minmax\(210px, 0\.8fr\) minmax\(280px, 1\.15fr\) minmax\(300px, 1\.2fr\)/);
  assert.match(files.css, /@media \(max-width: 720px\)/);
  assert.match(files.css, /@media \(max-width: 420px\)/);
  assert.doesNotMatch(files.css, /(?:linear|radial|conic)-gradient\s*\(/);
  assert.match(files.index, /export \{ AI_SYNTHETIC_VOICE_DISCLOSURE, VoiceAssistCenter \}/);
});
