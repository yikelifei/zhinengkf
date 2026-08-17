"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { OpenAiCompatibleRouter } = require("../apps/api/src/ai/ai-provider.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  storeWechatWorkInboundImage,
  storeWechatWorkInboundMedia,
} = require("../apps/api/src/wechat-work/wechat-work-inbound-media");
const {
  WechatWorkInboundUnderstandingService,
} = require("../apps/api/src/wechat-work/wechat-work-inbound-understanding.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

function provider(name = "vision") {
  return {
    name,
    enabled: true,
    configured: true,
    issues: [],
    apiKey: `${name}-key`,
    baseUrl: "https://models.invalid/v1",
    model: `${name}-text-model`,
    visionEnabled: true,
    visionModel: `${name}-vision-model`,
    transcriptionModel: `${name}-transcribe-model`,
    transcriptionEndpoint: "/audio/transcriptions",
    requestFormat: "openai",
    temperature: 0.7,
    maxTokens: 900,
    apiEndpoint: "/chat/completions",
    routingTier: "quality",
  };
}

function runtime(modelProvider = provider()) {
  return {
    enabled: true,
    primary: modelProvider.name,
    fallbackChain: [],
    timeoutSeconds: 8,
    maxRetries: 0,
    promptKey: "",
    routing: { enabled: true, complexityThreshold: 4, economyChain: [], qualityChain: [modelProvider.name] },
    multimodal: {
      enabled: true,
      visionChain: [modelProvider.name],
      transcriptionChain: [modelProvider.name],
      visionTimeoutSeconds: 2,
      transcriptionTimeoutSeconds: 2,
      videoFrameCount: 3,
    },
    settingsPath: "test",
    envPath: "test",
    providers: [modelProvider],
  };
}

function wavBytes(seconds = 0.2) {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test("vision router sends bounded image data through an explicitly capable model", async () => {
  let capturedBody;
  const router = new OpenAiCompatibleRouter(runtime(), {
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "图片里是咖色礼盒，腰封写着中秋礼赠" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await router.completeVision({
    images: [{ bytes: VALID_PNG, mimeType: "image/png" }],
    prompt: "只提取可见事实",
  });

  assert.equal(result.model, "vision-vision-model");
  assert.equal(capturedBody.model, "vision-vision-model");
  assert.equal(capturedBody.messages[0].content[0].type, "text");
  assert.match(capturedBody.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(capturedBody.messages[0].content[1].image_url.detail, "low");
});

test("transcription router uses multipart audio/transcriptions without putting the key in the body", async () => {
  let captured;
  const router = new OpenAiCompatibleRouter(runtime(), {
    fetchImpl: async (url, options) => {
      captured = { url: String(url), headers: options.headers, body: options.body };
      return new Response(JSON.stringify({ text: "预算二十五元，先做五百份" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await router.transcribe({
    bytes: wavBytes(),
    mimeType: "audio/wav",
    fileName: "customer.wav",
  });

  assert.equal(result.text, "预算二十五元，先做五百份");
  assert.equal(captured.url, "https://models.invalid/v1/audio/transcriptions");
  assert.equal(captured.body.get("model"), "vision-transcribe-model");
  assert.equal(captured.body.get("language"), "zh");
  assert.equal(String(captured.body).includes("vision-key"), false);
});

test("audio-capable chat models can transcribe WAV input through OpenAI-compatible input_audio", async () => {
  const audioProvider = {
    ...provider("audio-chat"),
    transcriptionModel: "",
    audioInputEnabled: true,
    audioInputModel: "gemini-audio-model",
  };
  let capturedBody;
  const router = new OpenAiCompatibleRouter(runtime(audioProvider), {
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "中秋节要五百份" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await router.transcribe({ bytes: wavBytes(), mimeType: "audio/wav" });

  assert.equal(result.model, "gemini-audio-model");
  assert.equal(capturedBody.model, "gemini-audio-model");
  assert.equal(capturedBody.messages[0].content[1].type, "input_audio");
  assert.equal(capturedBody.messages[0].content[1].input_audio.format, "wav");
  assert.match(capturedBody.messages[0].content[1].input_audio.data, /^[A-Za-z0-9+/=]+$/);
});

test("image understanding enriches the customer message and reuses its durable cache", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-image-understanding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appConfig.localStorageRoot = root;
  const stored = await storeWechatWorkInboundImage({
    msgid: "image-understanding",
    mediaId: "image-media",
    media: { bytes: VALID_PNG, size: VALID_PNG.length, contentType: "image/png" },
  });
  let visionCalls = 0;
  const service = new WechatWorkInboundUnderstandingService({
    async understandImages() {
      visionCalls += 1;
      return { text: "咖色抽屉礼盒，正面有金色 Logo，未看到数量或价格", provider: "stub-vision", model: "vision-fast", attempts: 1 };
    },
  });
  const input = {
    msgtype: "image",
    text: "[图片]",
    attachments: [{ msgtype: "image", status: "ready", localPath: stored.localPath, fingerprint: stored.fingerprint }],
  };

  const first = await service.enrich(input);
  const replay = await service.enrich(input);

  assert.match(first.text, /咖色抽屉礼盒/);
  assert.equal(first.understanding.status, "understood");
  assert.equal(first.attachments[0].reviewRequired, false);
  assert.equal(replay.understanding.cacheHit, true);
  assert.equal(visionCalls, 1);
});

test("voice is normalized with ffmpeg and transcribed into the customer turn", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status !== 0) return t.skip("ffmpeg unavailable");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-voice-understanding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appConfig.localStorageRoot = root;
  const bytes = wavBytes();
  const stored = await storeWechatWorkInboundMedia({
    msgid: "voice-understanding",
    mediaId: "voice-media",
    kind: "voice",
    media: { bytes, size: bytes.length, contentType: "audio/wav" },
  });
  let receivedWav = false;
  const service = new WechatWorkInboundUnderstandingService({
    async transcribeAudio(input) {
      receivedWav = input.mimeType === "audio/wav" && input.bytes.subarray(0, 4).toString("ascii") === "RIFF";
      return { text: "我们酒店开业，要一千份，单价十五元以内", provider: "stub-stt", model: "stt-fast", attempts: 1 };
    },
  });

  const result = await service.enrich({
    msgtype: "voice",
    text: "[语音]",
    attachments: [{ msgtype: "voice", status: "ready", localPath: stored.localPath, fingerprint: stored.fingerprint }],
  });

  assert.equal(receivedWav, true);
  assert.match(result.text, /酒店开业.*一千份.*十五元/);
  assert.equal(result.understanding.status, "understood");
  assert.equal(fs.readdirSync(path.dirname(stored.localPath)).some((name) => name.startsWith(".multimodal-")), false);
});

test("video frames and audio are understood in parallel and merged into one customer context", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status !== 0) return t.skip("ffmpeg unavailable");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-video-understanding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appConfig.localStorageRoot = root;
  const videoPath = path.join(root, "customer-video.mp4");
  const generated = spawnSync("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1",
    "-f", "lavfi", "-i", "sine=frequency=800:duration=1",
    "-shortest", "-c:v", "mpeg4", "-c:a", "aac", videoPath,
  ], { windowsHide: true });
  if (generated.status !== 0) return t.skip("test video encoder unavailable");
  const bytes = fs.readFileSync(videoPath);
  const fingerprint = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  let frameCount = 0;
  let transcriptionCalls = 0;
  const service = new WechatWorkInboundUnderstandingService({
    async understandImages(input) {
      frameCount = input.images.length;
      return { text: "视频里展示蓝色礼盒和白色腰封", provider: "stub-vision", model: "vision-fast", attempts: 1 };
    },
    async transcribeAudio() {
      transcriptionCalls += 1;
      return { text: "这个能不能印我们的 Logo", provider: "stub-stt", model: "stt-fast", attempts: 1 };
    },
  });

  const result = await service.enrich({
    msgtype: "video",
    text: "[视频]",
    attachments: [{ msgtype: "video", status: "ready", localPath: videoPath, fingerprint }],
  });

  assert.ok(frameCount >= 1 && frameCount <= 3);
  assert.equal(transcriptionCalls, 1);
  assert.match(result.text, /蓝色礼盒/);
  assert.match(result.text, /印我们的 Logo/);
  assert.deepEqual(result.understanding.models.map((item) => item.task).sort(), ["transcription", "vision"]);
});

test("unavailable multimodal processing marks the media for manual review instead of replying to a placeholder", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-media-manual-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appConfig.localStorageRoot = root;
  const imagePath = path.join(root, "customer.png");
  fs.writeFileSync(imagePath, VALID_PNG);
  const service = new WechatWorkInboundUnderstandingService();

  const result = await service.enrich({
    msgtype: "image",
    text: "[图片]",
    attachments: [{ msgtype: "image", status: "ready", localPath: imagePath, fingerprint: "dhash64:v1:1234567890abcdef" }],
  });

  assert.equal(result.understanding.status, "manual_review");
  assert.equal(result.attachments[0].reviewRequired, true);
  assert.match(result.text, /处理失败.*人工查看/);
  assert.notEqual(result.text, "[图片]");
});
