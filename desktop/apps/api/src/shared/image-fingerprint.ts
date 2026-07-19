import fs from "node:fs/promises";
import sharp from "sharp";

export const IMAGE_FINGERPRINT_ALGORITHM = "dhash64:v1";
export const MAX_IMAGE_DECODE_PIXELS = 25_000_000;
export const MAX_IMAGE_FINGERPRINT_BYTES = 20 * 1024 * 1024;

export type ImageFingerprintResult = {
  fingerprint: string;
  format: "jpeg" | "png";
  width: number;
  height: number;
};

export async function fingerprintImageFile(
  filePath: string,
  maxBytes = MAX_IMAGE_FINGERPRINT_BYTES,
): Promise<ImageFingerprintResult> {
  return fingerprintImageBytes(await readBoundedRegularFile(filePath, maxBytes), maxBytes);
}

export async function readBoundedRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("image fingerprint source must be a regular file");
    if (before.size === 0 || before.size > maxBytes) throw new Error("image fingerprint source exceeds the byte limit");
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw new Error("image fingerprint source changed while reading");
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("image fingerprint source changed while reading");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function fingerprintImageBytes(
  bytes: Buffer,
  maxBytes = MAX_IMAGE_FINGERPRINT_BYTES,
): Promise<ImageFingerprintResult> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("image bytes are required");
  if (bytes.length > maxBytes) throw new Error("image bytes exceed the fingerprint byte limit");

  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_DECODE_PIXELS,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  const format = metadata.format === "jpg" ? "jpeg" : metadata.format;
  if (format !== "jpeg" && format !== "png") {
    throw new Error("image must decode as JPEG or PNG");
  }
  const width = Number(metadata.autoOrient?.width || metadata.width || 0);
  const height = Number(metadata.autoOrient?.height || metadata.height || 0);
  if (!width || !height || width * height > MAX_IMAGE_DECODE_PIXELS) {
    throw new Error("image pixel dimensions exceed the safe decode limit");
  }

  const pixels = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_DECODE_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .resize(9, 8, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer();

  if (pixels.length !== 72) throw new Error("image fingerprint transform returned unexpected pixels");
  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits = (bits << 1n) | (pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? 1n : 0n);
    }
  }

  return {
    fingerprint: `${IMAGE_FINGERPRINT_ALGORITHM}:${bits.toString(16).padStart(16, "0")}`,
    format,
    width,
    height,
  };
}
