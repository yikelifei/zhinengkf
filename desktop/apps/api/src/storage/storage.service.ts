import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import axios from "axios";
import { appConfig } from "../shared/app-config";
import { MAX_IMAGE_FINGERPRINT_BYTES } from "../shared/image-fingerprint";

@Injectable()
export class StorageService {
  async saveDesignImage(jobId: string, imageId: string, downloadUrl: string): Promise<string> {
    const sourceUrl = normalizeDownloadUrl(downloadUrl);
    const ext = extensionFromUrl(sourceUrl) || ".png";
    const buffer = await downloadBoundedBytes(sourceUrl, designImageDownloadOptions(sourceUrl));
    const dir = path.join(appConfig.localStorageRoot, "design-jobs", jobId);
    const localPath = path.join(dir, `${safeName(imageId)}${ext}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(localPath, buffer);
    return localPath;
  }

  async saveAssetFromBase64(params: {
    ownerType: string;
    ownerId: string;
    fileName: string;
    base64: string;
  }): Promise<{ localPath: string; sizeBytes: number }> {
    const buffer = assertAssetSize(decodeBase64(params.base64));
    const localPath = await this.assetPath(params.ownerType, params.ownerId, params.fileName);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length };
  }

  async saveAssetFromText(params: {
    ownerType: string;
    ownerId: string;
    fileName: string;
    text: string;
  }): Promise<{ localPath: string; sizeBytes: number }> {
    const byteLength = Buffer.byteLength(params.text, "utf8");
    assertAssetByteLength(byteLength);
    const buffer = Buffer.from(params.text, "utf8");
    const localPath = await this.assetPath(params.ownerType, params.ownerId, params.fileName);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length };
  }

  async saveAssetFromUrl(params: {
    ownerType: string;
    ownerId: string;
    fileName?: string;
    url: string;
  }): Promise<{ localPath: string; sizeBytes: number }> {
    const sourceUrl = normalizeAssetUrl(params.url);
    const buffer = await downloadBoundedBytes(sourceUrl, assetDownloadOptions());
    const fallbackName = `asset${extensionFromUrl(sourceUrl) || ".bin"}`;
    const localPath = await this.assetPath(params.ownerType, params.ownerId, params.fileName || fallbackName);
    await fs.writeFile(localPath, buffer);
    return { localPath, sizeBytes: buffer.length };
  }

  async readLocalAsset(localPath: string): Promise<{ stream: ReturnType<typeof createReadStream>; mimeType: string; sizeBytes: number }> {
    const resolved = this.resolveStoragePath(localPath);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      throw new NotFoundException("asset file not found");
    }
    if (!stat.isFile()) throw new NotFoundException("asset file not found");
    return {
      stream: createReadStream(resolved),
      mimeType: mimeTypeFromFileName(resolved),
      sizeBytes: stat.size,
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

function designImageDownloadOptions(sourceUrl: string) {
  const headers = designPlatformDownloadHeaders(sourceUrl);
  return {
    responseType: "arraybuffer" as const,
    timeout: appConfig.designPlatformTimeoutMs,
    maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES,
    maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES,
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

function assetDownloadOptions() {
  return {
    responseType: "arraybuffer" as const,
    timeout: appConfig.designPlatformTimeoutMs,
    maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES,
    maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES,
  };
}

async function downloadBoundedBytes(sourceUrl: string, options: ReturnType<typeof assetDownloadOptions>): Promise<Buffer> {
  try {
    const response = await axios.get<ArrayBuffer>(sourceUrl, options);
    return assertAssetSize(Buffer.from(response.data));
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    if (isDownloadSizeError(error)) throw assetSizeException();
    throw error;
  }
}

function isDownloadSizeError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code || "");
  const message = String(candidate?.message || "");
  return code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED"
    || /max(?:Content|Body)Length|maximum (?:content|body) length|size of \d+ exceeded/i.test(message);
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

function designPlatformDownloadHeaders(sourceUrl: string): Record<string, string> {
  if (!isDesignPlatformUrl(sourceUrl)) return {};
  const headers: Record<string, string> = {};
  const token = appConfig.designPlatformAccessToken || appConfig.designPlatformApiKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appConfig.designPlatformCookie) headers.Cookie = appConfig.designPlatformCookie;
  if (appConfig.designPlatformDeviceId) headers["x-art-device-id"] = appConfig.designPlatformDeviceId;
  return headers;
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

function mimeTypeFromFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
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

function assetSizeException(): BadRequestException {
  return new BadRequestException(`asset exceeds maximum size of ${MAX_IMAGE_FINGERPRINT_BYTES} bytes`);
}
