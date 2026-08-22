import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import sharp from "sharp";
import { appConfig } from "../shared/app-config";
import { MAX_IMAGE_FINGERPRINT_BYTES } from "../shared/image-fingerprint";
import { assertDeclaredAssetMimeType, inspectSafeAssetContent } from "./asset-content-security";
import { downloadBoundedBytes, SafeDownloadOptions, SafeDownloadRuntime } from "./safe-download";

@Injectable()
export class StorageService {
  async saveDesignImage(
    jobId: string,
    imageId: string,
    downloadUrl: string,
    runtime: SafeDownloadRuntime = {},
  ): Promise<string> {
    const sourceUrl = normalizeDownloadUrl(downloadUrl);
    const claimedExtension = extensionFromUrl(sourceUrl);
    const buffer = assertAssetSize(await downloadBoundedBytes(sourceUrl, designImageDownloadOptions(), runtime));
    const content = await inspectSafeAssetContent(buffer, `image${claimedExtension}`, {
      allowPdf: false,
      allowText: false,
      requireExtension: Boolean(claimedExtension),
    });
    const dir = path.join(appConfig.localStorageRoot, "design-jobs", jobId);
    const localPath = path.join(dir, `${safeName(imageId)}${content.extension}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(localPath, buffer);
    return localPath;
  }

  async saveAssetFromBase64(params: {
    ownerType: string;
    ownerId: string;
    fileName: string;
    mimeType?: string;
    base64: string;
  }): Promise<{ localPath: string; sizeBytes: number; mimeType: string }> {
    const buffer = assertAssetSize(decodeBase64(params.base64));
    const content = await inspectSafeAssetContent(buffer, params.fileName);
    assertDeclaredAssetMimeType(params.mimeType, content.mimeType);
    assertDeclaredAssetMimeType(dataUrlMimeType(params.base64), content.mimeType);
    const localPath = await this.assetPath(params.ownerType, params.ownerId, params.fileName);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length, mimeType: content.mimeType };
  }

  async saveAssetFromText(params: {
    ownerType: string;
    ownerId: string;
    fileName: string;
    mimeType?: string;
    text: string;
  }): Promise<{ localPath: string; sizeBytes: number; mimeType: string }> {
    const byteLength = Buffer.byteLength(params.text, "utf8");
    assertAssetByteLength(byteLength);
    const buffer = Buffer.from(params.text, "utf8");
    const content = await inspectSafeAssetContent(buffer, params.fileName, { allowPdf: false, allowRaster: false });
    assertDeclaredAssetMimeType(params.mimeType, content.mimeType);
    const localPath = await this.assetPath(params.ownerType, params.ownerId, params.fileName);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length, mimeType: content.mimeType };
  }

  async saveAssetFromUrl(params: {
    ownerType: string;
    ownerId: string;
    fileName?: string;
    mimeType?: string;
    url: string;
  }, runtime: SafeDownloadRuntime = {}): Promise<{ localPath: string; sizeBytes: number; mimeType: string }> {
    const sourceUrl = normalizeAssetUrl(params.url);
    const buffer = assertAssetSize(await downloadBoundedBytes(sourceUrl, assetDownloadOptions(), runtime));
    const claimedName = params.fileName || `asset${extensionFromUrl(sourceUrl)}`;
    const content = await inspectSafeAssetContent(buffer, claimedName, { requireExtension: Boolean(path.extname(claimedName)) });
    assertDeclaredAssetMimeType(params.mimeType, content.mimeType);
    const localPath = await this.assetPath(params.ownerType, params.ownerId, params.fileName || `asset${content.extension}`);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length, mimeType: content.mimeType };
  }

  async saveAssetFromLocalFile(params: {
    ownerType: string;
    ownerId: string;
    filePath: string;
    fileName?: string;
  }): Promise<{ localPath: string; sizeBytes: number; mimeType: string }> {
    const sourcePath = normalizeLocalSourcePath(params.filePath);
    let canonicalPath: string;
    try {
      canonicalPath = await fs.realpath(sourcePath);
    } catch {
      throw new NotFoundException("source image file not found");
    }
    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile()) throw new BadRequestException("source image path must be a file");
    assertAssetByteLength(stat.size);
    const buffer = await fs.readFile(canonicalPath);
    const claimedName = params.fileName || path.basename(canonicalPath);
    const content = await inspectSafeAssetContent(buffer, claimedName, {
      allowPdf: false,
      allowText: false,
      requireExtension: Boolean(path.extname(claimedName)),
    });
    const localPath = await this.assetPath(params.ownerType, params.ownerId, claimedName || `image${content.extension}`);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length, mimeType: content.mimeType };
  }

  async readLocalAsset(localPath: string): Promise<{
    stream: Readable;
    mimeType: string;
    sizeBytes: number;
    fileName: string;
    inlineSafe: boolean;
  }> {
    const resolved = this.resolveStoragePath(localPath);
    let canonicalPath: string;
    try {
      canonicalPath = await fs.realpath(resolved);
    } catch {
      throw new NotFoundException("asset file not found");
    }
    await this.assertCanonicalStoragePath(canonicalPath);
    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile()) throw new NotFoundException("asset file not found");
    assertAssetByteLength(stat.size);
    const buffer = await fs.readFile(canonicalPath);
    const content = await inspectSafeAssetContent(buffer, path.basename(canonicalPath));
    return {
      stream: Readable.from(buffer),
      mimeType: content.mimeType,
      sizeBytes: buffer.length,
      fileName: path.basename(canonicalPath),
      inlineSafe: content.inlineSafe,
    };
  }

  async readLocalImageThumbnail(localPath: string, options: { width?: number; height?: number } = {}): Promise<{
    stream: Readable;
    mimeType: string;
    sizeBytes: number;
    fileName: string;
    inlineSafe: boolean;
  }> {
    const resolved = this.resolveStoragePath(localPath);
    let canonicalPath: string;
    try {
      canonicalPath = await fs.realpath(resolved);
    } catch {
      throw new NotFoundException("asset file not found");
    }
    await this.assertCanonicalStoragePath(canonicalPath);
    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile()) throw new NotFoundException("asset file not found");
    assertAssetByteLength(stat.size);
    const width = normalizeThumbnailDimension(options.width, 360);
    const height = normalizeThumbnailDimension(options.height, 270);
    const baseName = path.basename(canonicalPath, path.extname(canonicalPath)) || "asset";
    const cachePath = thumbnailCachePath(canonicalPath, stat, width, height);
    const cached = await readCachedThumbnail(cachePath, baseName);
    if (cached) return cached;

    const buffer = await fs.readFile(canonicalPath);
    await inspectSafeAssetContent(buffer, path.basename(canonicalPath), {
      allowPdf: false,
      allowText: false,
      allowRaster: true,
    });
    const thumbnail = await sharp(buffer, { animated: false, limitInputPixels: 100_000_000 })
      .rotate()
      .resize(width, height, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
      .webp({ quality: 75, effort: 4 })
      .toBuffer();
    await writeCachedThumbnail(cachePath, thumbnail);
    return {
      stream: Readable.from(thumbnail),
      mimeType: "image/webp",
      sizeBytes: thumbnail.length,
      fileName: `${baseName}-thumb.webp`,
      inlineSafe: true,
    };
  }

  private resolveStoragePath(localPath: string): string {
    const value = String(localPath || "").trim();
    if (!value) throw new BadRequestException("path is required");
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) {
      throw new BadRequestException("only local storage files can be previewed");
    }
    const resolved = path.resolve(value);
    const root = path.resolve(appConfig.localStorageRoot);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ForbiddenException("asset file is outside local storage");
    }
    return resolved;
  }

  private async assertCanonicalStoragePath(canonicalPath: string): Promise<void> {
    const canonicalRoot = await fs.realpath(path.resolve(appConfig.localStorageRoot));
    const relative = path.relative(canonicalRoot, canonicalPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ForbiddenException("asset file is outside local storage");
    }
  }

  private async assetPath(ownerType: string, ownerId: string, fileName: string): Promise<string> {
    const dir = path.join(appConfig.localStorageRoot, "assets", safeName(ownerType), safeName(ownerId));
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(fileName) || ".bin";
    const base = path.basename(fileName, ext);
    return path.join(dir, `${Date.now()}-${safeName(base)}${ext}`);
  }
}

function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext && ext.length <= 8 ? ext : "";
  } catch {
    return "";
  }
}

function normalizeDownloadUrl(url: string): string {
  const value = String(url || "").trim();
  if (!value) throw new BadRequestException("downloadUrl is required");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) {
    return `${appConfig.designPlatformBaseUrl.replace(/\/+$/, "")}${value}`;
  }
  throw new BadRequestException("downloadUrl must be http(s) or design-platform relative path");
}

function designImageDownloadOptions(): SafeDownloadOptions {
  return {
    responseType: "arraybuffer" as const,
    timeout: appConfig.designPlatformTimeoutMs,
    maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES,
    maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES,
    headersForUrl: designPlatformDownloadHeaders,
    allowLoopbackOrigins: acceptanceLoopbackDesignDownloadOrigins(),
  };
}

function assetDownloadOptions(): SafeDownloadOptions {
  return {
    responseType: "arraybuffer" as const,
    timeout: appConfig.designPlatformTimeoutMs,
    maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES,
    maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES,
  };
}

function normalizeAssetUrl(url: string): string {
  const value = String(url || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException("asset URL must use http(s)");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException("asset URL must use http(s)");
  }
  return parsed.toString();
}

function normalizeLocalSourcePath(filePath: string): string {
  const value = String(filePath || "").trim();
  if (!value) throw new BadRequestException("source image path is required");
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) {
    throw new BadRequestException("source image path must be a local file");
  }
  if (!path.isAbsolute(value)) throw new BadRequestException("source image path must be absolute");
  return path.resolve(value);
}

function designPlatformDownloadHeaders(sourceUrl: string): Record<string, string> {
  if (!isDesignPlatformUrl(sourceUrl)) return {};
  const headers: Record<string, string> = {};
  const token = appConfig.designPlatformAccessToken || appConfig.designPlatformApiKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appConfig.designPlatformCookie) headers.Cookie = appConfig.designPlatformCookie;
  if (appConfig.designPlatformDeviceId) headers["x-art-device-id"] = appConfig.designPlatformDeviceId;
  return headers;
}

function acceptanceLoopbackDesignDownloadOrigins(): string[] {
  if (!appConfig.acceptanceAllowLoopbackDesignDownloads) return [];
  try {
    const baseUrl = new URL(appConfig.designPlatformBaseUrl);
    if (!isLoopbackHostname(baseUrl.hostname)) return [];
    return [baseUrl.origin];
  } catch {
    return [];
  }
}

function isLoopbackHostname(value: string): boolean {
  const hostname = String(value || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1" || /^127\./.test(hostname);
}

function isDesignPlatformUrl(sourceUrl: string): boolean {
  try {
    const source = new URL(sourceUrl);
    const base = new URL(appConfig.designPlatformBaseUrl);
    return source.protocol === base.protocol && source.host === base.host;
  } catch {
    return false;
  }
}

function safeName(value: string): string {
  return String(value || "image").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function decodeBase64(value: string): Buffer {
  const raw = String(value || "");
  if (!raw) throw new BadRequestException("asset base64 is required");
  let payload = raw;
  if (/^data:/i.test(raw)) {
    const commaIndex = raw.indexOf(",");
    const metadata = commaIndex >= 0 ? raw.slice(0, commaIndex) : "";
    if (commaIndex < 0 || raw.indexOf(",", commaIndex + 1) >= 0 || !/^data:[^,\r\n]*;base64$/i.test(metadata)) {
      throw new BadRequestException("asset data URL must use strict base64 encoding");
    }
    payload = raw.slice(commaIndex + 1);
  }
  if (!isCanonicalBase64Text(payload)) {
    throw new BadRequestException("asset base64 must use canonical padding and characters");
  }
  const paddingLength = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  assertAssetByteLength((payload.length / 4) * 3 - paddingLength);
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length || buffer.toString("base64") !== payload) {
    throw new BadRequestException("asset base64 must be canonical base64");
  }
  return buffer;
}

function dataUrlMimeType(value: string): string | undefined {
  const match = /^data:([^;,\r\n]*)(?:;[^,\r\n]*)*;base64,/i.exec(String(value || ""));
  return match?.[1] || undefined;
}

function isCanonicalBase64Text(payload: string): boolean {
  if (!payload || payload.length % 4 !== 0) return false;
  const firstPadding = payload.indexOf("=");
  const bodyEnd = firstPadding < 0 ? payload.length : firstPadding;
  const paddingLength = payload.length - bodyEnd;
  if (paddingLength > 2) return false;
  for (let index = bodyEnd; index < payload.length; index += 1) {
    if (payload.charCodeAt(index) !== 61) return false;
  }
  for (let index = 0; index < bodyEnd; index += 1) {
    const code = payload.charCodeAt(index);
    const valid = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47;
    if (!valid) return false;
  }
  return true;
}

function assertAssetSize(buffer: Buffer): Buffer {
  assertAssetByteLength(buffer.length);
  return buffer;
}

function assertAssetByteLength(byteLength: number): void {
  if (byteLength > MAX_IMAGE_FINGERPRINT_BYTES) throw assetSizeException();
}

function normalizeThumbnailDimension(value: unknown, fallback: number) {
  const numeric = Math.floor(Number(value || 0));
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(1024, Math.max(32, numeric));
}

function thumbnailCachePath(canonicalPath: string, stat: { size: number; mtimeMs: number }, width: number, height: number) {
  const root = path.resolve(appConfig.localStorageRoot);
  const relative = path.relative(root, canonicalPath).toLocaleLowerCase("zh-CN");
  const key = createHash("sha256")
    .update(["v1", relative, String(stat.size), String(Math.floor(stat.mtimeMs)), String(width), String(height)].join("\n"))
    .digest("hex");
  return path.join(root, ".cache", "thumbnails", key.slice(0, 2), `${key}.webp`);
}

async function readCachedThumbnail(cachePath: string, baseName: string) {
  try {
    const stat = await fs.stat(cachePath);
    if (!stat.isFile()) return null;
    const thumbnail = await fs.readFile(cachePath);
    return {
      stream: Readable.from(thumbnail),
      mimeType: "image/webp",
      sizeBytes: thumbnail.length,
      fileName: `${baseName}-thumb.webp`,
      inlineSafe: true,
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeCachedThumbnail(cachePath: string, thumbnail: Buffer) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, thumbnail);
  try {
    await fs.rename(tempPath, cachePath);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function assetSizeException(): BadRequestException {
  return new BadRequestException(`asset exceeds maximum size of ${MAX_IMAGE_FINGERPRINT_BYTES} bytes`);
}

export { downloadBoundedBytes, inspectSafeAssetContent };
