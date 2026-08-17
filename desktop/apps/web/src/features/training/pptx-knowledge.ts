import { strFromU8, unzipSync } from "fflate";

const MAX_PPTX_BYTES = 20 * 1024 * 1024;
const MAX_SLIDE_XML_BYTES = 2 * 1024 * 1024;
const MAX_SLIDES = 500;
const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/i;

type KnowledgeRow = {
  title: string;
  content: string;
  agentKey: "pre_sales";
  tags: string[];
  source: string;
  qualityScore: number;
};

export async function readPptxKnowledgeFile(file: File) {
  if (file.size > MAX_PPTX_BYTES) throw new Error("PPTX 超过 20MB，请先压缩或拆分后再导入。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return extractPptxKnowledgeJson(bytes, file.name);
}

export function extractPptxKnowledgeJson(bytes: Uint8Array, fileName: string) {
  if (!bytes.length) throw new Error("PPTX 文件为空。");
  if (bytes.byteLength > MAX_PPTX_BYTES) throw new Error("PPTX 超过 20MB，请先压缩或拆分后再导入。");

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, {
      filter: (entry) => SLIDE_PATH.test(entry.name) && entry.originalSize <= MAX_SLIDE_XML_BYTES,
    });
  } catch {
    throw new Error("PPTX 无法解压，请确认文件没有损坏或加密。");
  }

  const slides = Object.entries(archive)
    .map(([path, data]) => ({ path, data, number: Number(SLIDE_PATH.exec(path)?.[1] || 0) }))
    .filter((entry) => entry.number > 0)
    .sort((left, right) => left.number - right.number);
  if (!slides.length) throw new Error("PPTX 中没有读取到可用幻灯片文字。");
  if (slides.length > MAX_SLIDES) throw new Error(`PPTX 页数超过 ${MAX_SLIDES} 页，请拆分后再导入。`);

  const source = String(fileName || "产品资料.pptx").trim() || "产品资料.pptx";
  const rows: KnowledgeRow[] = [];
  for (const slide of slides) {
    const texts = extractSlideTexts(strFromU8(slide.data));
    const content = texts.join("\n").trim();
    if (content.length < 20) continue;
    const heading = texts[0]?.slice(0, 80).trim() || "产品资料";
    rows.push({
      title: `${source} · 第${slide.number}页 · ${heading}`,
      content,
      agentKey: "pre_sales",
      tags: ["PPT", "产品资料", "伴手礼"],
      source,
      qualityScore: 85,
    });
  }
  if (!rows.length) throw new Error("PPTX 中的文字过少，暂时不能形成可检索的知识条目。");
  return JSON.stringify(rows);
}

function extractSlideTexts(xml: string) {
  const values: string[] = [];
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const value = decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim();
    if (value) values.push(value);
  }
  return values;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(value: number) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}
