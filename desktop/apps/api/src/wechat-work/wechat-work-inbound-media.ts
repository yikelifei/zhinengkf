import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "../shared/app-config";
import { fingerprintImageBytes, fingerprintImageFile, readBoundedRegularFile } from "../shared/image-fingerprint";

export const MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_WECHAT_WORK_INBOUND_VOICE_BYTES = 20 * 1024 * 1024;
export const MAX_WECHAT_WORK_INBOUND_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_WECHAT_WORK_INBOUND_FILE_BYTES = 20 * 1024 * 1024;

export type DownloadedWechatWorkMedia = {
  bytes: Buffer;
  contentType: string;
  size: number;
};

export type StoredWechatWorkInboundImage = {
  mediaId: string;
  localPath: string;
  size: number;
  type: "image/jpeg" | "image/png";
  width: number;
  height: number;
  fingerprint: string;
  status: "ready";
};

export type StoredWechatWorkInboundMedia = {
  mediaId: string;
  localPath: string;
  size: number;
  type: string;
  fingerprint: string;
  status: "ready";
  kind: "voice" | "video" | "file";
};

export function maxWechatWorkInboundMediaBytes(kind: "image" | "voice" | "video" | "file") {
  if (kind === "image") return MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES;
  if (kind === "voice") return MAX_WECHAT_WORK_INBOUND_VOICE_BYTES;
  if (kind === "video") return MAX_WECHAT_WORK_INBOUND_VIDEO_BYTES;
  return MAX_WECHAT_WORK_INBOUND_FILE_BYTES;
}

export async function storeWechatWorkInboundImage(input: {
  msgid: string;
  mediaId: string;
  media: DownloadedWechatWorkMedia;
}): Promise<StoredWechatWorkInboundImage> {
  const msgid = requiredIdentifier(input.msgid, "msgid");
  const mediaId = requiredIdentifier(input.mediaId, "mediaId");
  const bytes = input.media?.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("wechat work image download was empty");
  const declaredSize = Number(input.media.size);
  if (!Number.isFinite(declaredSize) || declaredSize !== bytes.length) {
    throw new Error("wechat work image download size failed integrity validation");
  }
  if (bytes.length > MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES) {
    throw new Error("wechat work image exceeds the 2 MB inbound limit");
  }

  const storageRoot = path.resolve(appConfig.localStorageRoot);
  const relativeDirectory = path.join("wechat-work", "inbound", safeSegment(msgid));
  const directory = path.resolve(storageRoot, relativeDirectory);
  assertInside(storageRoot, directory, "wechat work inbound image directory");
  await fs.mkdir(directory, { recursive: true });
  const realRoot = await fs.realpath(storageRoot);
  const realDirectory = await fs.realpath(directory);
  assertInside(realRoot, realDirectory, "wechat work inbound image directory");

  const mediaHash = crypto.createHash("sha256").update(mediaId).digest("hex").slice(0, 20);
  const decodedBytes = await fingerprintImageBytes(bytes, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES);
  const type = decodedBytes.format === "png" ? "image/png" : "image/jpeg";
  const extension = decodedBytes.format === "png" ? ".png" : ".jpg";
  const finalPath = path.join(realDirectory, `${mediaHash}${extension}`);
  const alternatePath = path.join(realDirectory, `${mediaHash}${extension === ".png" ? ".jpg" : ".png"}`);
  assertInside(realRoot, finalPath, "wechat work inbound image file");
  if (await pathExists(alternatePath)) {
    throw new Error("wechat work inbound media identity conflicts with an existing local file");
  }
  const existing = await inspectExistingImage(finalPath, bytes);
  if (existing === "mismatch") {
    throw new Error("wechat work inbound media identity conflicts with an existing local file");
  }
  if (existing) {
    return {
      mediaId,
      localPath: finalPath,
      size: existing.size,
      type,
      width: existing.width,
      height: existing.height,
      fingerprint: existing.fingerprint,
      status: "ready",
    };
  }

  const nonce = crypto.randomUUID();
  const temporaryPath = path.join(realDirectory, `.${mediaHash}-${nonce}.part`);
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    const stat = await fs.stat(temporaryPath);
    if (!stat.isFile() || stat.size !== bytes.length || stat.size > MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES) {
      throw new Error("wechat work image temporary file failed integrity validation");
    }
    const decoded = await fingerprintImageFile(temporaryPath, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES);
    if (decoded.fingerprint !== decodedBytes.fingerprint || decoded.format !== decodedBytes.format) {
      throw new Error("wechat work image changed during atomic storage validation");
    }
    try {
      await fs.link(temporaryPath, finalPath);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const concurrent = await inspectExistingImage(finalPath, bytes);
      if (!concurrent || concurrent === "mismatch") {
        throw new Error("wechat work inbound media identity conflicts with an existing local file");
      }
      return {
        mediaId,
        localPath: finalPath,
        size: concurrent.size,
        type,
        width: concurrent.width,
        height: concurrent.height,
        fingerprint: concurrent.fingerprint,
        status: "ready",
      };
    }
    return {
      mediaId,
      localPath: finalPath,
      size: stat.size,
      type,
      width: decoded.width,
      height: decoded.height,
      fingerprint: decoded.fingerprint,
      status: "ready",
    };
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function storeWechatWorkInboundMedia(input: {
  msgid: string;
  mediaId: string;
  kind: "voice" | "video" | "file";
  media: DownloadedWechatWorkMedia;
}): Promise<StoredWechatWorkInboundMedia> {
  const msgid = requiredIdentifier(input.msgid, "msgid");
  const mediaId = requiredIdentifier(input.mediaId, "mediaId");
  const bytes = input.media?.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("wechat work media download was empty");
  const declaredSize = Number(input.media.size);
  if (!Number.isFinite(declaredSize) || declaredSize !== bytes.length) {
    throw new Error("wechat work media download size failed integrity validation");
  }
  const maximum = maxWechatWorkInboundMediaBytes(input.kind);
  if (bytes.length > maximum) throw new Error(`wechat work ${input.kind} exceeds the inbound size limit`);

  const format = detectStoredMediaFormat(input.kind, bytes, input.media.contentType);
  const storageRoot = path.resolve(appConfig.localStorageRoot);
  const relativeDirectory = path.join("wechat-work", "inbound", safeSegment(msgid));
  const directory = path.resolve(storageRoot, relativeDirectory);
  assertInside(storageRoot, directory, "wechat work inbound media directory");
  await fs.mkdir(directory, { recursive: true });
  const realRoot = await fs.realpath(storageRoot);
  const realDirectory = await fs.realpath(directory);
  assertInside(realRoot, realDirectory, "wechat work inbound media directory");

  const mediaHash = crypto.createHash("sha256").update(mediaId).digest("hex").slice(0, 20);
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const finalPath = path.join(realDirectory, `${mediaHash}-${input.kind}${format.extension}`);
  assertInside(realRoot, finalPath, "wechat work inbound media file");
  const existing = await inspectExistingBinary(finalPath, bytes, maximum);
  if (existing === "mismatch") throw new Error("wechat work inbound media identity conflicts with an existing local file");
  if (existing) {
    return {
      mediaId,
      localPath: finalPath,
      size: existing.size,
      type: format.type,
      fingerprint: `sha256:${existing.hash}`,
      status: "ready",
      kind: input.kind,
    };
  }

  const temporaryPath = path.join(realDirectory, `.${mediaHash}-${crypto.randomUUID()}.part`);
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    const stat = await fs.stat(temporaryPath);
    if (!stat.isFile() || stat.size !== bytes.length || stat.size > maximum) {
      throw new Error("wechat work media temporary file failed integrity validation");
    }
    const storedBytes = await readBoundedRegularFile(temporaryPath, maximum);
    const storedHash = crypto.createHash("sha256").update(storedBytes).digest("hex");
    if (storedHash !== contentHash) throw new Error("wechat work media changed during atomic storage validation");
    try {
      await fs.link(temporaryPath, finalPath);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const concurrent = await inspectExistingBinary(finalPath, bytes, maximum);
      if (!concurrent || concurrent === "mismatch") {
        throw new Error("wechat work inbound media identity conflicts with an existing local file");
      }
      return {
        mediaId,
        localPath: finalPath,
        size: concurrent.size,
        type: format.type,
        fingerprint: `sha256:${concurrent.hash}`,
        status: "ready",
        kind: input.kind,
      };
    }
    return {
      mediaId,
      localPath: finalPath,
      size: stat.size,
      type: format.type,
      fingerprint: `sha256:${contentHash}`,
      status: "ready",
      kind: input.kind,
    };
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

async function pathExists(filePath: string) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function inspectExistingImage(
  filePath: string,
  expectedBytes: Buffer,
): Promise<false | "mismatch" | { size: number; width: number; height: number; fingerprint: string }> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES) return "mismatch";
  const existingBytes = await readBoundedRegularFile(filePath, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES);
  const expectedHash = crypto.createHash("sha256").update(expectedBytes).digest("hex");
  const existingHash = crypto.createHash("sha256").update(existingBytes).digest("hex");
  if (existingHash !== expectedHash) return "mismatch";
  try {
    const decoded = await fingerprintImageBytes(existingBytes, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES);
    return { size: existingBytes.length, width: decoded.width, height: decoded.height, fingerprint: decoded.fingerprint };
  } catch {
    return "mismatch";
  }
}

async function inspectExistingBinary(filePath: string, expectedBytes: Buffer, maximum: number) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return false as const;
    throw error;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > maximum) return "mismatch" as const;
  const existingBytes = await readBoundedRegularFile(filePath, maximum);
  const expectedHash = crypto.createHash("sha256").update(expectedBytes).digest("hex");
  const existingHash = crypto.createHash("sha256").update(existingBytes).digest("hex");
  if (existingHash !== expectedHash) return "mismatch" as const;
  return { size: existingBytes.length, hash: existingHash };
}

function detectStoredMediaFormat(kind: "voice" | "video" | "file", bytes: Buffer, rawContentType: string) {
  const declared = String(rawContentType || "").split(";", 1)[0].trim().toLowerCase();
  if (kind === "file") return { type: safeMediaType(declared) || "application/octet-stream", extension: ".bin" };
  if (bytes.subarray(0, 6).toString("ascii") === "#!AMR\n") return { type: "audio/amr", extension: ".amr" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF") {
    const container = bytes.subarray(8, 12).toString("ascii");
    if (container === "WAVE") return { type: "audio/wav", extension: ".wav" };
    if (container === "AVI ") return { type: "video/x-msvideo", extension: ".avi" };
  }
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { type: "audio/mpeg", extension: ".mp3" };
  }
  if (bytes.subarray(0, 4).toString("ascii") === "OggS") return { type: "audio/ogg", extension: ".ogg" };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    return kind === "video"
      ? { type: "video/mp4", extension: ".mp4" }
      : { type: "audio/mp4", extension: ".m4a" };
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return kind === "video"
      ? { type: "video/webm", extension: ".webm" }
      : { type: "audio/webm", extension: ".webm" };
  }
  if (kind === "voice" && (declared.startsWith("audio/") || declared.startsWith("voice/"))) {
    return { type: declared, extension: ".audio" };
  }
  if (kind === "video" && declared.startsWith("video/")) return { type: declared, extension: ".video" };
  throw new Error(`wechat work ${kind} format is unsupported or could not be verified`);
}

function safeMediaType(value: string) {
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value) ? value : "";
}

function requiredIdentifier(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > 512) throw new Error(`${label} exceeds the safe length limit`);
  return text;
}

function safeSegment(value: string) {
  const visible = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "message";
  const suffix = crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${visible}-${suffix}`;
}

function assertInside(root: string, candidate: string, label: string) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside LOCAL_STORAGE_ROOT`);
  }
}
