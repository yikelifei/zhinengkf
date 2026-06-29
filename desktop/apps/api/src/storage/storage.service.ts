import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import axios from "axios";
import { appConfig } from "../shared/app-config";

@Injectable()
export class StorageService {
  async saveDesignImage(jobId: string, imageId: string, downloadUrl: string): Promise<string> {
    const sourceUrl = normalizeDownloadUrl(downloadUrl);
    const dir = path.join(appConfig.localStorageRoot, "design-jobs", jobId);
    await fs.mkdir(dir, { recursive: true });
    const ext = extensionFromUrl(sourceUrl) || ".png";
    const localPath = path.join(dir, `${safeName(imageId)}${ext}`);
    const response = await axios.get<ArrayBuffer>(sourceUrl, { responseType: "arraybuffer" });
    await fs.writeFile(localPath, Buffer.from(response.data));
    return localPath;
  }

  async saveAssetFromBase64(params: {
    ownerType: string;
    ownerId: string;
    fileName: string;
    base64: string;
  }): Promise<{ localPath: string; sizeBytes: number }> {
    const buffer = decodeBase64(params.base64);
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
    const response = await axios.get<ArrayBuffer>(params.url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    const fallbackName = `asset${extensionFromUrl(params.url) || ".bin"}`;
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
  const commaIndex = raw.indexOf(",");
  const payload = raw.startsWith("data:") && commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
  return Buffer.from(payload, "base64");
}
