import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type DemoPngOptions = {
  label?: string;
  width?: number;
  height?: number;
};

export function createDemoPngBase64(options: DemoPngOptions = {}) {
  return createDemoPngBuffer(options).toString("base64");
}

export function createDemoPngBuffer(options: DemoPngOptions = {}) {
  const width = clampDimension(options.width, 640);
  const height = clampDimension(options.height, 420);
  const seed = hashString(options.label || "demo");
  const accent = hslToRgb(seed % 360, 72, 46);
  const accentDark = hslToRgb(seed % 360, 78, 34);
  const paper = [250, 248, 244];
  const ink = [31, 41, 55];
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      let color = paper;
      if (y < height * 0.18) color = accent;
      if (x > width * 0.76 && y < height * 0.38) color = accentDark;
      if (x > width * 0.1 && x < width * 0.9 && y > height * 0.36 && y < height * 0.78) color = [255, 255, 255];
      if (x > width * 0.16 && x < width * 0.84 && y > height * 0.45 && y < height * 0.68) color = mix([255, 255, 255], accent, 0.18);
      if (Math.abs(x - width * 0.5) < 2 && y > height * 0.38 && y < height * 0.78) color = mix(accentDark, ink, 0.2);
      if (y > height * 0.82 && ((x + seed) % 46) < 18) color = mix(paper, accent, 0.2);
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function clampDimension(value: unknown, fallback: number) {
  const number = Math.floor(Number(value || fallback));
  return Math.max(64, Math.min(number, 2048));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function hslToRgb(h: number, s: number, l: number) {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = h / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  let rgb = [0, 0, 0];
  if (hp >= 0 && hp < 1) rgb = [chroma, x, 0];
  else if (hp < 2) rgb = [x, chroma, 0];
  else if (hp < 3) rgb = [0, chroma, x];
  else if (hp < 4) rgb = [0, x, chroma];
  else if (hp < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const m = lightness - chroma / 2;
  return rgb.map((channel) => Math.round((channel + m) * 255));
}

function mix(left: number[], right: number[], ratio: number) {
  return left.map((value, index) => Math.round(value * (1 - ratio) + right[index] * ratio));
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
