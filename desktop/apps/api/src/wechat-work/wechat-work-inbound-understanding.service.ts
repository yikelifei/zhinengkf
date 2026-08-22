import { Injectable, Optional } from "@nestjs/common";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AiProviderService, type AiCompletionResult } from "../ai/ai-provider.service";
import { loadAiProviderRuntime } from "../ai/ai-provider-config";
import { appConfig } from "../shared/app-config";
import { readBoundedRegularFile } from "../shared/image-fingerprint";
import {
  MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES,
  maxWechatWorkInboundMediaBytes,
} from "./wechat-work-inbound-media";

const UNDERSTANDING_CACHE_VERSION = 2;
const MAX_TRANSCRIPTION_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_MEDIA_PROCESS_SECONDS = 600;
const PROCESS_TIMEOUT_MS = 30_000;

export type WechatWorkMediaUnderstanding = {
  version: 2;
  status: "understood" | "manual_review";
  kind: "image" | "voice" | "video" | "file";
  contextText?: string;
  visualSummary?: string;
  transcript?: string;
  provider?: string;
  model?: string;
  models?: Array<{ task: "vision" | "transcription"; provider: string; model: string }>;
  sourceFingerprint?: string;
  cacheHit: boolean;
  elapsedMs: number;
  reason?: string;
  createdAt: string;
};

type EnrichmentInput = {
  msgtype: string;
  text: string;
  attachments: Array<Record<string, unknown>>;
};

@Injectable()
export class WechatWorkInboundUnderstandingService {
  constructor(@Optional() private readonly aiProviders?: AiProviderService) {}

  async enrich(input: EnrichmentInput): Promise<EnrichmentInput & { understanding?: WechatWorkMediaUnderstanding }> {
    const kind = normalizedKind(input.msgtype);
    if (!kind) return input;
    const startedAt = Date.now();
    const attachment = input.attachments.find((item) => String(item?.msgtype || "") === kind) || input.attachments[0];
    const sourceFingerprint = String(attachment?.fingerprint || "").trim();
    const localPath = String(attachment?.localPath || "").trim();
    if (kind === "file") {
      return this.manualReview(input, kind, sourceFingerprint, startedAt, "document_understanding_not_configured");
    }
    if (!this.aiProviders || !localPath || String(attachment?.status || "") !== "ready") {
      return this.manualReview(input, kind, sourceFingerprint, startedAt, !this.aiProviders
        ? "multimodal_model_unavailable"
        : "media_file_not_ready");
    }

    try {
      const safePath = await verifiedInboundMediaPath(localPath, kind);
      const cached = await readUnderstandingCache(safePath, kind, sourceFingerprint);
      if (cached) return applyUnderstanding(input, { ...cached, cacheHit: true, elapsedMs: Date.now() - startedAt });
      const understanding = kind === "image"
        ? await this.understandImage(safePath, sourceFingerprint, startedAt)
        : kind === "voice"
          ? await this.understandVoice(safePath, sourceFingerprint, startedAt)
          : await this.understandVideo(safePath, sourceFingerprint, startedAt);
      await writeUnderstandingCache(safePath, understanding);
      return applyUnderstanding(input, understanding);
    } catch (error) {
      return this.manualReview(input, kind, sourceFingerprint, startedAt, publicMediaError(error));
    }
  }

  private async understandImage(filePath: string, sourceFingerprint: string, startedAt: number) {
    const bytes = await readBoundedRegularFile(filePath, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES);
    const mimeType = path.extname(filePath).toLowerCase() === ".png" ? "image/png" as const : "image/jpeg" as const;
    const result = await this.aiProviders!.understandImages({
      images: [{ bytes, mimeType }],
      prompt: visionPrompt("客户发送的图片"),
    });
    const visualSummary = boundedModelText(result.text);
    return successUnderstanding({
      kind: "image",
      sourceFingerprint,
      startedAt,
      visualSummary,
      contextText: `客户发送图片。视觉模型提取到：${visualSummary}`,
      results: [{ task: "vision" as const, result }],
    });
  }

  private async understandVoice(filePath: string, sourceFingerprint: string, startedAt: number) {
    const directory = await createAnalysisDirectory(filePath);
    try {
      const wavPath = path.join(directory, "voice.wav");
      await transcodeAudio(filePath, wavPath);
      const transcript = await this.transcribeWav(wavPath);
      return successUnderstanding({
        kind: "voice",
        sourceFingerprint,
        startedAt,
        transcript: boundedModelText(transcript.text),
        contextText: `客户语音转写（可能存在少量识别误差）：${boundedModelText(transcript.text)}`,
        results: [{ task: "transcription" as const, result: transcript }],
      });
    } finally {
      await removeAnalysisDirectory(directory);
    }
  }

  private async understandVideo(filePath: string, sourceFingerprint: string, startedAt: number) {
    const directory = await createAnalysisDirectory(filePath);
    try {
      const runtime = loadAiProviderRuntime();
      const durationSeconds = await probeDuration(filePath);
      const framePaths = await extractVideoFrames(filePath, directory, durationSeconds, runtime.multimodal.videoFrameCount);
      const wavPath = path.join(directory, "video-audio.wav");
      const [visionOutcome, transcriptionOutcome] = await Promise.all([
        framePaths.length
          ? this.understandVideoFrames(framePaths).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error }))
          : Promise.resolve({ ok: false as const, error: new Error("video frames unavailable") }),
        transcodeAudio(filePath, wavPath)
          .then(() => this.transcribeWav(wavPath))
          .then((value) => ({ ok: true as const, value }))
          .catch((error) => ({ ok: false as const, error })),
      ]);
      if (!visionOutcome.ok && !transcriptionOutcome.ok) {
        throw new Error(`video understanding failed: ${publicMediaError(visionOutcome.error)}; ${publicMediaError(transcriptionOutcome.error)}`);
      }
      const visualSummary = visionOutcome.ok ? boundedModelText(visionOutcome.value.text) : "";
      const transcript = transcriptionOutcome.ok ? boundedModelText(transcriptionOutcome.value.text) : "";
      const contextText = [
        "客户发送视频。",
        visualSummary ? `画面理解：${visualSummary}` : "",
        transcript ? `视频语音转写（可能存在少量识别误差）：${transcript}` : "",
      ].filter(Boolean).join(" ");
      const results = [
        ...(visionOutcome.ok ? [{ task: "vision" as const, result: visionOutcome.value }] : []),
        ...(transcriptionOutcome.ok ? [{ task: "transcription" as const, result: transcriptionOutcome.value }] : []),
      ];
      return successUnderstanding({
        kind: "video",
        sourceFingerprint,
        startedAt,
        visualSummary,
        transcript,
        contextText,
        results,
      });
    } finally {
      await removeAnalysisDirectory(directory);
    }
  }

  private async understandVideoFrames(framePaths: string[]) {
    const images = await Promise.all(framePaths.slice(0, 5).map(async (framePath) => ({
      bytes: await readBoundedRegularFile(framePath, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES),
      mimeType: "image/jpeg" as const,
    })));
    return this.aiProviders!.understandImages({ images, prompt: visionPrompt("客户发送的视频代表画面") });
  }

  private async transcribeWav(wavPath: string) {
    const bytes = await readBoundedRegularFile(wavPath, MAX_TRANSCRIPTION_UPLOAD_BYTES);
    return this.aiProviders!.transcribeAudio({
      bytes,
      mimeType: "audio/wav",
      fileName: "customer-message.wav",
      prompt: "伴手礼、礼盒、腰封、卡片、风吕敷、教师节、中秋节、医师节、瑜伽、普拉提、预算、数量、Logo、打样、发货",
    });
  }

  private manualReview(
    input: EnrichmentInput,
    kind: "image" | "voice" | "video" | "file",
    sourceFingerprint: string,
    startedAt: number,
    reason: string,
  ) {
    const understanding: WechatWorkMediaUnderstanding = {
      version: UNDERSTANDING_CACHE_VERSION,
      status: "manual_review",
      kind,
      sourceFingerprint,
      cacheHit: false,
      elapsedMs: Date.now() - startedAt,
      reason: boundedReason(reason),
      createdAt: new Date().toISOString(),
    };
    return applyUnderstanding(input, understanding);
  }
}

function successUnderstanding(input: {
  kind: "image" | "voice" | "video" | "file";
  sourceFingerprint: string;
  startedAt: number;
  contextText: string;
  visualSummary?: string;
  transcript?: string;
  results: Array<{ task: "vision" | "transcription"; result: AiCompletionResult }>;
}): WechatWorkMediaUnderstanding {
  const first = input.results[0]?.result;
  return {
    version: UNDERSTANDING_CACHE_VERSION,
    status: "understood",
    kind: input.kind,
    contextText: boundedModelText(input.contextText, 3_000),
    ...(input.visualSummary ? { visualSummary: input.visualSummary } : {}),
    ...(input.transcript ? { transcript: input.transcript } : {}),
    provider: first?.provider,
    model: first?.model,
    models: input.results.map((item) => ({ task: item.task, provider: item.result.provider, model: item.result.model })),
    sourceFingerprint: input.sourceFingerprint,
    cacheHit: false,
    elapsedMs: Date.now() - input.startedAt,
    createdAt: new Date().toISOString(),
  };
}

function applyUnderstanding(input: EnrichmentInput, understanding: WechatWorkMediaUnderstanding) {
  const attachments = input.attachments.map((attachment, index) => index === 0
    ? {
        ...attachment,
        mediaUnderstanding: understanding,
        reviewRequired: understanding.status !== "understood",
        ...(understanding.status === "manual_review" ? { understandingStatus: "manual_review" } : { understandingStatus: "understood" }),
      }
    : attachment);
  return {
    ...input,
    text: understanding.status === "understood" && understanding.contextText
      ? understanding.contextText
      : `[${mediaLabel(understanding.kind)}处理失败，需要人工查看原始${mediaLabel(understanding.kind)}]`,
    attachments,
    understanding,
  };
}

async function verifiedInboundMediaPath(localPath: string, kind: "image" | "voice" | "video") {
  const storageRoot = await fs.realpath(path.resolve(appConfig.localStorageRoot));
  const requested = path.resolve(localPath);
  const lstat = await fs.lstat(requested);
  if (lstat.isSymbolicLink() || !lstat.isFile()) throw new Error("inbound media path is not a regular file");
  const realPath = await fs.realpath(requested);
  assertInside(storageRoot, realPath, "inbound media file");
  const stat = await fs.stat(realPath);
  if (stat.size <= 0 || stat.size > maxWechatWorkInboundMediaBytes(kind)) throw new Error("inbound media size is invalid");
  return realPath;
}

async function createAnalysisDirectory(filePath: string) {
  const directory = await fs.mkdtemp(path.join(path.dirname(filePath), ".multimodal-"));
  assertInside(path.dirname(filePath), directory, "multimodal analysis directory");
  return directory;
}

async function removeAnalysisDirectory(directory: string) {
  assertInside(path.dirname(directory), directory, "multimodal analysis directory");
  await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

async function transcodeAudio(inputPath: string, outputPath: string) {
  await runMediaProcess(ffmpegCommand(), [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn", "-t", String(MAX_MEDIA_PROCESS_SECONDS), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    outputPath,
  ]);
}

async function probeDuration(filePath: string) {
  const result = await runMediaProcess(ffprobeCommand(), [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("video duration could not be read");
  return Math.min(duration, MAX_MEDIA_PROCESS_SECONDS);
}

async function extractVideoFrames(filePath: string, directory: string, durationSeconds: number, frameCount: number) {
  const count = Math.max(1, Math.min(5, Math.floor(frameCount || 3)));
  const points = Array.from({ length: count }, (_value, index) => Math.max(0, durationSeconds * ((index + 0.5) / count)));
  const results = await Promise.all(points.map(async (seconds, index) => {
    const outputPath = path.join(directory, `frame-${index + 1}.jpg`);
    try {
      await runMediaProcess(ffmpegCommand(), [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", seconds.toFixed(3), "-i", filePath, "-frames:v", "1",
        "-vf", "scale=1280:-2:force_original_aspect_ratio=decrease", "-q:v", "3", outputPath,
      ]);
      return outputPath;
    } catch {
      return "";
    }
  }));
  return results.filter(Boolean);
}

function runMediaProcess(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("media processor timeout"));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(-64_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-64_000); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error && (error as NodeJS.ErrnoException).code === "ENOENT" ? "media processor unavailable" : "media processor failed"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`media processor exited with code ${code}`));
    });
  });
}

function ffmpegCommand() {
  return String(process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function ffprobeCommand() {
  return String(process.env.FFPROBE_PATH || "ffprobe").trim() || "ffprobe";
}

async function readUnderstandingCache(
  filePath: string,
  kind: "image" | "voice" | "video" | "file",
  sourceFingerprint: string,
): Promise<WechatWorkMediaUnderstanding | null> {
  const cachePath = understandingCachePath(filePath);
  try {
    const stat = await fs.lstat(cachePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64 * 1024) return null;
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (
      parsed?.version !== UNDERSTANDING_CACHE_VERSION
      || parsed?.status !== "understood"
      || parsed?.kind !== kind
      || String(parsed?.sourceFingerprint || "") !== sourceFingerprint
      || !String(parsed?.contextText || "").trim()
    ) return null;
    return parsed as WechatWorkMediaUnderstanding;
  } catch {
    return null;
  }
}

async function writeUnderstandingCache(filePath: string, understanding: WechatWorkMediaUnderstanding) {
  if (understanding.status !== "understood") return;
  const cachePath = understandingCachePath(filePath);
  const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(understanding)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporaryPath, cachePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

function understandingCachePath(filePath: string) {
  const cachePath = path.resolve(`${filePath}.understanding-v${UNDERSTANDING_CACHE_VERSION}.json`);
  assertInside(path.dirname(filePath), cachePath, "media understanding cache");
  return cachePath;
}

function visionPrompt(subject: string) {
  return [
    `请理解${subject}，为伴手礼行业客服提供本轮对话上下文。`,
    "准确提取：产品类型、包装、颜色、材质、尺寸、数量、预算、Logo/文字、使用场景、客户明确提出的问题或修改要求，以及截图中的关键文字。",
    "若画面包含海报、腰封、吊牌或贺卡，必须识别实际物料的类型和成品外轮廓；贺卡请明确写成“贺卡外轮廓：正方形（1:1）”“贺卡外轮廓：横向”“贺卡外轮廓：竖向”或“贺卡外轮廓：无法判断”。",
    "判断物料外轮廓时只看贺卡、腰封或吊牌本身，不要把整张截图、聊天界面、桌面背景或拍摄画面的横竖比例当成物料比例。",
    "看不清的内容明确写看不清；不要猜价格、库存、交期、购买意图或图片外的信息。",
    "只输出一段简短中文事实摘要，不要给客户回复，不要输出分析过程。",
  ].join("\n");
}

function boundedModelText(value: unknown, maximum = 2_000) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maximum);
}

function boundedReason(value: unknown) {
  return String(value || "media_understanding_failed").replace(/[\r\n\0]+/g, " ").trim().slice(0, 300);
}

function publicMediaError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error || "media understanding failed");
  return boundedReason(value.replace(/https?:\/\/\S+/gi, "[url]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]"));
}

function normalizedKind(value: unknown): "image" | "voice" | "video" | "file" | null {
  const kind = String(value || "").trim();
  return kind === "image" || kind === "voice" || kind === "video" || kind === "file" ? kind : null;
}

function mediaLabel(kind: "image" | "voice" | "video" | "file") {
  return kind === "image" ? "图片" : kind === "voice" ? "语音" : kind === "video" ? "视频" : "文件";
}

function assertInside(root: string, candidate: string, label: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escaped its allowed root`);
}
