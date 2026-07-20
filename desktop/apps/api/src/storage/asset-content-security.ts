import path from "node:path";
import { TextDecoder } from "node:util";
import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

export type SafeAssetContent = {
  kind: "raster" | "pdf" | "text";
  mimeType: string;
  extension: string;
  inlineSafe: boolean;
};

type RasterDefinition = SafeAssetContent & { sharpFormats: string[]; extensions: string[] };

const RASTER_FORMATS: RasterDefinition[] = [
  { kind: "raster", mimeType: "image/png", extension: ".png", inlineSafe: true, sharpFormats: ["png"], extensions: [".png"] },
  { kind: "raster", mimeType: "image/jpeg", extension: ".jpg", inlineSafe: true, sharpFormats: ["jpeg"], extensions: [".jpg", ".jpeg"] },
  { kind: "raster", mimeType: "image/webp", extension: ".webp", inlineSafe: true, sharpFormats: ["webp"], extensions: [".webp"] },
  { kind: "raster", mimeType: "image/gif", extension: ".gif", inlineSafe: true, sharpFormats: ["gif"], extensions: [".gif"] },
  { kind: "raster", mimeType: "image/bmp", extension: ".bmp", inlineSafe: true, sharpFormats: ["magick", "bmp"], extensions: [".bmp"] },
];
const ACTIVE_TEXT_PATTERN = /(?:<!doctype\s+html|<\s*(?:html|svg|script|iframe|object|embed)\b|<\?xml\b|\bjavascript\s*:)/i;
const ACTIVE_PDF_PATTERN = /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA)\b/i;

export async function inspectSafeAssetContent(
  buffer: Buffer,
  fileName: string,
  options: { allowPdf?: boolean; allowText?: boolean; allowRaster?: boolean; requireExtension?: boolean } = {},
): Promise<SafeAssetContent> {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw unsupportedAsset();
  const allowRaster = options.allowRaster !== false;
  const allowPdf = options.allowPdf !== false;
  const allowText = options.allowText !== false;
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const requireExtension = options.requireExtension !== false;

  const raster = rasterFromMagic(buffer);
  if (raster) {
    if (!allowRaster) throw unsupportedAsset();
    if (requireExtension && !raster.extensions.includes(extension)) throw extensionMismatch();
    let metadata;
    try {
      metadata = await sharp(buffer, { animated: true, limitInputPixels: 100_000_000 }).metadata();
    } catch {
      throw unsupportedAsset();
    }
    if (!metadata.format || !raster.sharpFormats.includes(metadata.format)) throw unsupportedAsset();
    return publicDefinition(raster);
  }

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    if (!allowPdf) throw unsupportedAsset();
    if (requireExtension && extension !== ".pdf") throw extensionMismatch();
    const source = buffer.toString("latin1");
    if (!/^%PDF-1\.[0-7](?:\r?\n|\r)/.test(source)
      || !/%%EOF\s*$/.test(source.slice(-2048))
      || ACTIVE_PDF_PATTERN.test(source)) {
      throw unsupportedAsset();
    }
    return { kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: false };
  }

  if (!allowText || (requireExtension && extension !== ".txt")) throw unsupportedAsset();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw unsupportedAsset();
  }
  if (!text.trim() || ACTIVE_TEXT_PATTERN.test(text) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw unsupportedAsset();
  }
  return { kind: "text", mimeType: "text/plain", extension: ".txt", inlineSafe: false };
}

export function assertDeclaredAssetMimeType(declared: string | undefined, actual: string) {
  const normalized = String(declared || "").split(";", 1)[0].trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return;
  if (normalized !== actual) throw new BadRequestException("asset mimeType does not match file content");
}

function rasterFromMagic(buffer: Buffer): RasterDefinition | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return RASTER_FORMATS[0];
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return RASTER_FORMATS[1];
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return RASTER_FORMATS[2];
  }
  const gif = buffer.subarray(0, 6).toString("ascii");
  if (gif === "GIF87a" || gif === "GIF89a") return RASTER_FORMATS[3];
  if (buffer.length >= 14 && buffer.subarray(0, 2).toString("ascii") === "BM") return RASTER_FORMATS[4];
  return null;
}

function publicDefinition(definition: RasterDefinition): SafeAssetContent {
  return {
    kind: definition.kind,
    mimeType: definition.mimeType,
    extension: definition.extension,
    inlineSafe: definition.inlineSafe,
  };
}

function unsupportedAsset() {
  return new BadRequestException("asset content is not a safe supported raster image, PDF or plain text file");
}

function extensionMismatch() {
  return new BadRequestException("asset fileName extension does not match file content");
}
