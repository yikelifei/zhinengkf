import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../shared/app-config";

const MAX_WECHAT_WORK_IMAGE_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type WechatWorkImageFile = {
  filePath: string;
  fileName: string;
  contentType: "image/jpeg" | "image/png";
  size: number;
};

export function resolveWechatWorkImageFile(value: unknown): WechatWorkImageFile {
  const raw = String(value || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new Error("wechat work image must be a local storage file");
  }

  const storageRoot = path.resolve(appConfig.localStorageRoot);
  const projectRoot = path.dirname(storageRoot);
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [path.resolve(projectRoot, raw), path.resolve(storageRoot, raw)];

  for (const candidate of candidates) {
    const relative = path.relative(storageRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      if (!fs.lstatSync(candidate).isFile()) continue;
      const realRoot = fs.realpathSync(storageRoot);
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) continue;

      const stat = fs.statSync(realCandidate);
      if (stat.size <= 5 || stat.size > MAX_WECHAT_WORK_IMAGE_BYTES) {
        throw new Error("wechat work image must be larger than 5 bytes and no larger than 2 MB");
      }
      const signature = Buffer.alloc(8);
      const descriptor = fs.openSync(realCandidate, "r");
      try {
        fs.readSync(descriptor, signature, 0, signature.length, 0);
      } finally {
        fs.closeSync(descriptor);
      }
      const extension = path.extname(realCandidate).toLowerCase();
      const isPng = signature.equals(PNG_SIGNATURE) && extension === ".png";
      const isJpeg = signature[0] === 0xff
        && signature[1] === 0xd8
        && signature[2] === 0xff
        && (extension === ".jpg" || extension === ".jpeg");
      if (!isPng && !isJpeg) {
        throw new Error("wechat work image must be a JPG or PNG file whose content matches its extension");
      }
      return {
        filePath: realCandidate,
        fileName: path.basename(realCandidate),
        contentType: isPng ? "image/png" : "image/jpeg",
        size: stat.size,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("wechat work image")) throw error;
    }
  }
  throw new Error("wechat work image must resolve to a regular file inside LOCAL_STORAGE_ROOT");
}
