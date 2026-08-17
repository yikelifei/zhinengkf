import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { appConfig } from "../shared/app-config";
import { MAX_IMAGE_DECODE_PIXELS } from "../shared/image-fingerprint";

export const MAX_WECHAT_WORK_IMAGE_BYTES = 2 * 1024 * 1024;
const TARGET_WECHAT_WORK_IMAGE_BYTES = MAX_WECHAT_WORK_IMAGE_BYTES - 64 * 1024;
const MAX_WECHAT_WORK_FILE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WECHAT_WORK_FILE_EXTENSIONS = new Set([".ppt", ".pptx", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".zip"]);

export type WechatWorkImageFile = {
  filePath: string;
  fileName: string;
  contentType: "image/jpeg" | "image/png";
  size: number;
};

export type WechatWorkMaterialFile = {
  filePath: string;
  fileName: string;
  contentType: "application/octet-stream";
  size: number;
};

export type PreparedWechatWorkImage = WechatWorkImageFile & {
  sourcePath: string;
  sourceSize: number;
  optimized: boolean;
  fingerprint: string;
};

export async function prepareWechatWorkImageFile(value: unknown): Promise<PreparedWechatWorkImage> {
  const source = resolveWechatWorkImageSource(value);
  if (source.size <= MAX_WECHAT_WORK_IMAGE_BYTES) {
    return {
      ...resolveWechatWorkImageFile(source.filePath),
      sourcePath: source.filePath,
      sourceSize: source.size,
      optimized: false,
      fingerprint: sha256File(source.filePath),
    };
  }

  const metadata = await sharp(source.filePath, {
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_DECODE_PIXELS,
    sequentialRead: true,
  }).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg"].includes(String(metadata.format || ""))) {
    throw new Error("wechat work image must be a decodable JPG or PNG file");
  }

  const storageRoot = fs.realpathSync(path.resolve(appConfig.localStorageRoot));
  const outputDirectory = path.join(path.dirname(source.filePath), ".wechat-work-send");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const digest = createHash("sha256")
    .update(path.relative(storageRoot, source.filePath))
    .update(String(source.size))
    .update(String(source.mtimeMs))
    .digest("hex")
    .slice(0, 32);
  const outputPath = path.join(outputDirectory, `${digest}.jpg`);
  if (fs.existsSync(outputPath)) {
    const existing = resolveWechatWorkImageFile(outputPath);
    return {
      ...existing,
      sourcePath: source.filePath,
      sourceSize: source.size,
      optimized: true,
      fingerprint: sha256File(existing.filePath),
    };
  }

  const plans = [
    { quality: 90, maxDimension: 0 },
    { quality: 84, maxDimension: 0 },
    { quality: 78, maxDimension: 0 },
    { quality: 76, maxDimension: 2048 },
    { quality: 72, maxDimension: 1600 },
    { quality: 68, maxDimension: 1280 },
  ];
  let output: Buffer | null = null;
  for (const plan of plans) {
    let pipeline = sharp(source.filePath, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_DECODE_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } });
    if (plan.maxDimension > 0) {
      pipeline = pipeline.resize(plan.maxDimension, plan.maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    }
    const candidate = await pipeline
      .jpeg({ quality: plan.quality, progressive: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
    if (candidate.length > 5 && candidate.length <= TARGET_WECHAT_WORK_IMAGE_BYTES) {
      output = candidate;
      break;
    }
  }
  if (!output) throw new Error("wechat work image could not be optimized below the 2 MB limit");

  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, output, { flag: "wx", mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, outputPath);
    } catch (error) {
      if (!fs.existsSync(outputPath)) throw error;
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  const prepared = resolveWechatWorkImageFile(outputPath);
  return {
    ...prepared,
    sourcePath: source.filePath,
    sourceSize: source.size,
    optimized: true,
    fingerprint: sha256File(prepared.filePath),
  };
}

function sha256File(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveWechatWorkImageSource(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new Error("wechat work image must be a local storage file");
  }
  const storageRoot = path.resolve(appConfig.localStorageRoot);
  const projectRoot = path.dirname(storageRoot);
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [path.resolve(projectRoot, raw), path.resolve(storageRoot, raw)];
  const realRoot = fs.realpathSync(storageRoot);
  for (const candidate of candidates) {
    const relative = path.relative(storageRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      if (!fs.lstatSync(candidate).isFile()) continue;
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) continue;
      const stat = fs.statSync(realCandidate);
      if (stat.size <= 5) throw new Error("wechat work image must be larger than 5 bytes");
      return { filePath: realCandidate, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("wechat work image")) throw error;
    }
  }
  throw new Error("wechat work image must resolve to a regular file inside LOCAL_STORAGE_ROOT");
}

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

export function resolveWechatWorkMaterialFile(value: unknown): WechatWorkMaterialFile {
  const raw = String(value || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new Error("wechat work material must be a local storage file");
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
      if (stat.size <= 5 || stat.size > MAX_WECHAT_WORK_FILE_BYTES) {
        throw new Error("wechat work material must be larger than 5 bytes and no larger than 20 MB");
      }
      const extension = path.extname(realCandidate).toLowerCase();
      if (!WECHAT_WORK_FILE_EXTENSIONS.has(extension)) {
        throw new Error("wechat work material type is not allowed");
      }
      assertMaterialSignature(realCandidate, extension);
      return {
        filePath: realCandidate,
        fileName: path.basename(realCandidate),
        contentType: "application/octet-stream",
        size: stat.size,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("wechat work material")) throw error;
    }
  }
  throw new Error("wechat work material must resolve to a regular file inside LOCAL_STORAGE_ROOT");
}

function assertMaterialSignature(filePath: string, extension: string) {
  if ([".csv", ".txt"].includes(extension)) return;
  const signature = Buffer.alloc(8);
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, signature, 0, signature.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const isZip = signature[0] === 0x50 && signature[1] === 0x4b && [0x03, 0x05, 0x07].includes(signature[2]);
  const isOle = signature.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isPdf = signature.subarray(0, 4).toString("ascii") === "%PDF";
  const valid = extension === ".pdf"
    ? isPdf
    : [".pptx", ".docx", ".xlsx", ".zip"].includes(extension)
      ? isZip
      : [".ppt", ".doc", ".xls"].includes(extension) && isOle;
  if (!valid) throw new Error("wechat work material content does not match its extension");
}
