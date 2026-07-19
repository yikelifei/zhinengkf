import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "../shared/app-config";
import { fingerprintImageBytes, fingerprintImageFile, readBoundedRegularFile } from "../shared/image-fingerprint";

export const MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES = 2 * 1024 * 1024;

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
