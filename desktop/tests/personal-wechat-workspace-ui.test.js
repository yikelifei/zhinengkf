const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps/web/src/components/personal-wechat-workspace/personal-wechat-workspace.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "apps/web/src/components/personal-wechat-workspace/personal-wechat-workspace.module.css"), "utf8");

test("personal WeChat workspace composes three independent modules", () => {
  assert.match(source, /PersonalWechatControlCenter/);
  assert.match(source, /VoiceAssistCenter/);
  assert.match(source, /MessageSafetyGovernance/);
  assert.match(source, /账号控制台/);
  assert.match(source, /语音辅助/);
  assert.match(source, /发送治理/);
});
test("personal WeChat workspace is fail-closed and truthfully marks missing live capabilities", () => {
  assert.match(source, /globalSendMode="disabled"/);
  assert.match(source, /globallyStopped/);
  assert.match(source, /真实发送保持关闭/);
  assert.match(source, /待实时心跳/);
  assert.match(source, /麦克风与 STT 提供商尚未接入/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("personal WeChat workspace contains no automatic retry or hidden voice identity behavior", () => {
  assert.match(source, /禁止自动重试/);
  assert.match(source, /neutral-synthetic/);
  assert.doesNotMatch(source, /setTimeout|setInterval|speechSynthesis|MediaRecorder/);
});

test("personal WeChat workspace keeps a compact responsive module switcher", () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /var\(--wk-accent/);
});
