"use strict";

const zlib = require("node:zlib");

const HEADER_MAP = {
  skuCode: ["sku", "sku编号", "sku编码", "商品编号", "商品编码", "编码", "货号", "sku缂栧彿", "sku缂栫爜", "鍟嗗搧缂栧彿", "缂栫爜", "璐у彿"],
  name: ["商品名称", "名称", "品名", "商品名", "name", "鍟嗗搧鍚嶇О", "鍚嶇О", "鍝佸悕"],
  type: ["商品类型", "类型", "type", "鍟嗗搧绫诲瀷", "绫诲瀷"],
  category: ["分类", "类目", "品类", "category", "鍒嗙被", "绫荤洰"],
  sceneTags: ["场景标签", "标签", "适用场景", "使用场景", "sceneTags", "鍦烘櫙鏍囩", "鏍囩", "閫傜敤鍦烘櫙"],
  costPrice: ["成本价", "成本", "进价", "cost", "costPrice", "鎴愭湰浠?", "鎴愭湰"],
  salePrice: ["售价", "销售价", "价格", "报价", "salePrice", "price", "鍞环", "閿€鍞环", "浠锋牸"],
  stock: ["库存", "可用库存", "stock", "搴撳瓨"],
  dimensions: ["尺寸", "长宽高", "规格尺寸", "dimensions"],
  lengthCm: ["长", "长度", "长cm", "length", "lengthCm"],
  widthCm: ["宽", "宽度", "宽cm", "width", "widthCm"],
  heightCm: ["高", "高度", "高cm", "height", "heightCm"],
  weightGram: ["重量", "重量g", "克重", "毛重", "weight", "weightGram"],
  material: ["材质", "材料", "material", "鏉愯川"],
  supplier: ["供应商", "供货商", "厂家", "supplier", "渚涘簲鍟?"],
  leadTimeDays: ["交期", "交期天数", "发货天数", "生产周期", "leadTimeDays", "浜ゆ湡", "浜ゆ湡澶╂暟"],
  mainImagePath: ["主图", "主图url", "商品图片", "图片", "图片地址", "mainImagePath", "image", "imageUrl"],
  angleImages: ["多角度图", "角度图", "细节图", "图片组", "angleImages"],
  matchingRules: ["搭配规则", "组合规则", "禁配规则", "matchingRules"],
  replacementSkuCodes: ["替代品", "替代sku", "替代SKU", "replacementSkuCodes", "鏇夸唬鍝?", "鏇夸唬sku"],
};

const SKU_IMPORT_FIELD_DEFINITIONS = [
  { field: "skuCode", label: "SKU编号", required: true, example: "BOX-001", description: "商品唯一编号，后续库存、报价、设计出图都靠它绑定商品。" },
  { field: "name", label: "商品名称", required: true, example: "红金礼盒", description: "给客服和客户看的商品名称。" },
  { field: "type", label: "商品类型", required: false, example: "礼盒 / 内搭 / 配件", description: "礼盒会作为外包装，内搭和配件会进入礼盒组合。" },
  { field: "category", label: "分类", required: false, example: "茶叶", description: "商品类目，用于筛选和运营管理。" },
  { field: "costPrice", label: "成本价", required: false, example: "42", description: "用于计算利润，不填会按 0 处理。" },
  { field: "salePrice", label: "售价", required: true, example: "88", description: "用于预算搭配和报价，必须大于 0。" },
  { field: "stock", label: "库存", required: false, example: "30", description: "用于判断是否可推荐，不填会按 0 处理。" },
  { field: "sceneTags", label: "场景标签", required: false, example: "员工福利、客户拜访", description: "告诉智能体这个商品适合什么送礼场景。" },
  { field: "mainImagePath", label: "主图", required: false, example: "C:\\products\\box-main.jpg", description: "真实 SKU 主图，本地路径或图片 URL。" },
  { field: "angleImages", label: "多角度图", required: false, example: "C:\\products\\box-side.jpg、C:\\products\\box-open.jpg", description: "多张图用顿号、逗号或分号分隔。" },
  { field: "dimensions", label: "尺寸", required: false, example: "30*22*9", description: "长宽高，单位默认厘米。" },
  { field: "weightGram", label: "重量g", required: false, example: "650", description: "商品重量，单位克。" },
  { field: "material", label: "材质", required: false, example: "特种纸", description: "材质信息，辅助客服判断质感和包装。" },
  { field: "supplier", label: "供应商", required: false, example: "杭州礼盒厂", description: "供货来源，方便采购和售后追踪。" },
  { field: "leadTimeDays", label: "交期天数", required: false, example: "5", description: "预计交付天数，第一期先用于提醒客服。" },
  { field: "replacementSkuCodes", label: "替代SKU", required: false, example: "BOX-B", description: "库存不足时优先推荐的替代商品编号，多个用顿号分隔。" },
  { field: "matchingRules", label: "搭配规则", required: false, example: "{\"mustWith\":[\"CARD-001\"]}", description: "可写文字备注，也可写 JSON，后续用于更精细的组合规则。" },
];

function parseSkuImportText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { ok: false, rows: [], errors: [{ line: 0, message: "没有读取到商品数据" }], fieldMapping: [], unmappedHeaders: [], missingRequiredFields: getSkuImportFieldGuide().filter((field) => field.required) };
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitLine(lines[0], delimiter).map((header) => String(header || "").trim());
  const headers = rawHeaders.map(normalizeHeader);
  const indexes = mapHeaders(headers);
  const mapping = describeSkuHeaderMapping(rawHeaders, indexes);
  const rows = [];
  const errors = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitLine(lines[index], delimiter);
    const row = buildSkuRow(values, indexes);
    const rowErrors = validateSkuRow(row);
    if (rowErrors.length) {
      errors.push({ line: index + 1, message: rowErrors.join("；") });
      continue;
    }
    rows.push(row);
  }

  return {
    ok: rows.length > 0 && errors.length === 0,
    rows,
    errors,
    importedCount: rows.length,
    skippedCount: errors.length,
    fieldMapping: mapping.fieldMapping,
    unmappedHeaders: mapping.unmappedHeaders,
    missingRequiredFields: getMissingRequiredFields(indexes),
  };
}

function parseSkuImportFile(input = {}) {
  const fileName = String(input.fileName || "").trim();
  const buffer = Buffer.isBuffer(input)
    ? input
    : Buffer.from(String(input.dataBase64 || ""), "base64");
  if (!buffer.length) {
    return { ok: false, rows: [], errors: [{ line: 0, message: "没有读取到商品文件数据" }], importedCount: 0, skippedCount: 1 };
  }

  try {
    const workbookText = /\.xlsx$/i.test(fileName) || isZipBuffer(buffer)
      ? xlsxBufferToDelimitedText(buffer)
      : decodeTextBuffer(buffer);
    return {
      ...parseSkuImportText(workbookText),
      sourceFileName: fileName,
      sourceType: /\.xlsx$/i.test(fileName) || isZipBuffer(buffer) ? "xlsx" : "text",
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      errors: [{ line: 0, message: `文件解析失败：${error.message || error}` }],
      importedCount: 0,
      skippedCount: 1,
      sourceFileName: fileName,
    };
  }
}

function detectDelimiter(headerLine) {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(",")) return ",";
  return /\s{2,}/.test(headerLine) ? "multi-space" : ",";
}

function splitLine(line, delimiter) {
  if (delimiter === "\t") return line.split("\t").map((item) => item.trim());
  if (delimiter === "multi-space") return line.split(/\s{2,}/).map((item) => item.trim());
  return splitCsv(line);
}

function splitCsv(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizeHeader(header) {
  return String(header || "")
    .replace(/\s+/g, "")
    .replace(/[()（）]/g, "")
    .toLowerCase();
}

function mapHeaders(headers) {
  const indexes = {};
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const index = headers.findIndex((header) => normalizedAliases.includes(header));
    if (index >= 0) indexes[field] = index;
  }
  return indexes;
}

function describeSkuHeaderMapping(rawHeaders, indexes) {
  const usedIndexes = new Set(Object.values(indexes));
  return {
    fieldMapping: getSkuImportFieldGuide().map((definition) => {
      const index = indexes[definition.field];
      return {
        ...definition,
        sourceHeader: index === undefined ? "" : rawHeaders[index] || "",
        column: index === undefined ? null : index + 1,
        matched: index !== undefined,
      };
    }),
    unmappedHeaders: rawHeaders
      .map((header, index) => ({ header, index }))
      .filter((item) => item.header && !usedIndexes.has(item.index))
      .map((item) => item.header),
  };
}

function getMissingRequiredFields(indexes) {
  return getSkuImportFieldGuide().filter((field) => field.required && indexes[field.field] === undefined);
}

function getSkuImportFieldGuide() {
  return SKU_IMPORT_FIELD_DEFINITIONS.map((definition) => ({
    ...definition,
    aliases: HEADER_MAP[definition.field] || [],
  }));
}

function buildSkuRow(values, indexes) {
  const get = (field) => (indexes[field] === undefined ? "" : values[indexes[field]] || "");
  const costPrice = toNumber(get("costPrice"));
  const salePrice = toNumber(get("salePrice"));
  return {
    skuCode: get("skuCode"),
    name: get("name"),
    type: normalizeSkuType(get("type")),
    category: get("category") || undefined,
    sceneTags: splitTags(get("sceneTags")),
    costPrice,
    salePrice,
    stock: toInteger(get("stock")) || 0,
    dimensions: parseDimensions({
      text: get("dimensions"),
      lengthCm: get("lengthCm"),
      widthCm: get("widthCm"),
      heightCm: get("heightCm"),
    }),
    weightGram: toInteger(get("weightGram")) || undefined,
    material: get("material") || undefined,
    supplier: get("supplier") || undefined,
    leadTimeDays: toInteger(get("leadTimeDays")) || undefined,
    mainImagePath: get("mainImagePath") || undefined,
    angleImages: splitTags(get("angleImages")),
    matchingRules: parseMatchingRules(get("matchingRules")),
    replacementSkuCodes: splitTags(get("replacementSkuCodes")),
  };
}

function normalizeSkuType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["礼盒", "盒子", "包装盒", "gift_box", "giftbox", "box", "绀肩洅", "鐩掑瓙"].includes(text)) return "gift_box";
  if (["配件", "附件", "accessory", "閰嶄欢", "闄勪欢"].includes(text)) return "accessory";
  return "item";
}

function splitTags(value) {
  return String(value || "")
    .split(/[、,，;；/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDimensions(input) {
  const length = toNumber(input.lengthCm);
  const width = toNumber(input.widthCm);
  const height = toNumber(input.heightCm);
  if (length || width || height) {
    return cleanObject({ lengthCm: length || undefined, widthCm: width || undefined, heightCm: height || undefined });
  }

  const numbers = String(input.text || "").match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return {};
  return cleanObject({
    lengthCm: Number(numbers[0]),
    widthCm: Number(numbers[1]),
    heightCm: numbers[2] ? Number(numbers[2]) : undefined,
  });
}

function parseMatchingRules(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { notes: text };
  } catch {
    return { notes: text };
  }
}

function toNumber(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function toInteger(value) {
  const number = toNumber(value);
  return Number.isFinite(number) ? Math.floor(number) : 0;
}

function validateSkuRow(row) {
  const errors = [];
  if (!row.skuCode) errors.push("缺少 SKU 编号");
  if (!row.name) errors.push("缺少商品名称");
  if (!["gift_box", "item", "accessory"].includes(row.type)) errors.push("商品类型不正确");
  if (!(row.costPrice >= 0)) errors.push("成本价不正确");
  if (!(row.salePrice > 0)) errors.push("售价必须大于 0");
  return errors;
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString("utf8");
  }
  return buffer.toString("utf8");
}

function isZipBuffer(buffer) {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function xlsxBufferToDelimitedText(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const sheetName = resolveFirstWorksheetName(entries);
  const sheetXml = entries.get(sheetName)?.toString("utf8");
  if (!sheetXml) throw new Error("没有找到工作表数据");
  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  if (!rows.length) throw new Error("工作表没有可导入的行");
  return rows.map((row) => row.map((cell) => String(cell || "").replace(/\t/g, " ").trim()).join("\t")).join("\n");
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("不是有效的 xlsx/zip 文件");
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8").replace(/\\/g, "/");
    entries.set(fileName, readZipEntryData(buffer, localHeaderOffset, compressedSize, method));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntryData(buffer, localHeaderOffset, compressedSize, method) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("zip 本地文件头损坏");
  const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`不支持的 xlsx 压缩方式：${method}`);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const items = xml.match(/<si\b[\s\S]*?<\/si>/g) || [];
  for (const item of items) {
    const textParts = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1]));
    strings.push(textParts.join(""));
  }
  return strings;
}

function resolveFirstWorksheetName(entries) {
  if (entries.has("xl/workbook.xml") && entries.has("xl/_rels/workbook.xml.rels")) {
    const workbookXml = entries.get("xl/workbook.xml").toString("utf8");
    const relsXml = entries.get("xl/_rels/workbook.xml.rels").toString("utf8");
    const sheetMatch = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/);
    if (sheetMatch) {
      const relationship = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(sheetMatch[1])}"[^>]*Target="([^"]+)"`).exec(relsXml);
      if (relationship?.[1]) {
        const target = relationship[1].replace(/\\/g, "/").replace(/^\/+/, "");
        return target.startsWith("xl/") ? target : `xl/${target}`;
      }
    }
  }
  return [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) || "";
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const rowMatches = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rowMatches) {
    const row = [];
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) || [];
    for (const cellXml of cellMatches) {
      const ref = (cellXml.match(/\br="([^"]+)"/) || [])[1] || "";
      const type = (cellXml.match(/\bt="([^"]+)"/) || [])[1] || "";
      const index = ref ? columnIndexFromCellRef(ref) : row.length;
      row[index] = parseCellValue(cellXml, type, sharedStrings);
    }
    const trimmed = trimTrailingEmptyCells(row);
    if (trimmed.some((cell) => String(cell || "").trim())) rows.push(trimmed);
  }
  return rows;
}

function parseCellValue(cellXml, type, sharedStrings) {
  if (type === "inlineStr") {
    const textParts = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1]));
    return textParts.join("");
  }
  const value = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "";
  if (type === "s") return sharedStrings[Number(value)] || "";
  return xmlUnescape(value);
}

function columnIndexFromCellRef(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

function trimTrailingEmptyCells(row) {
  const copy = row.slice();
  while (copy.length && !String(copy[copy.length - 1] || "").trim()) copy.pop();
  return copy;
}

function xmlUnescape(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSkuImportTemplateRows() {
  return [
    SKU_IMPORT_FIELD_DEFINITIONS.map((field) => field.label),
    [
      "BOX-001",
      "红金礼盒",
      "礼盒",
      "礼盒",
      "42",
      "88",
      "30",
      "员工福利、客户拜访",
      "C:\\products\\box-001-main.jpg",
      "C:\\products\\box-001-side.jpg、C:\\products\\box-001-open.jpg",
      "30*22*9",
      "650",
      "特种纸",
      "杭州礼盒厂",
      "5",
      "BOX-002",
      "{\"preferWith\":[\"TEA-001\",\"CARD-001\"]}",
    ],
    [
      "TEA-001",
      "乌龙茶礼罐",
      "内搭",
      "茶叶",
      "55",
      "120",
      "15",
      "员工福利、节日礼赠",
      "C:\\products\\tea-001-main.jpg",
      "C:\\products\\tea-001-detail.jpg",
      "12*8*18",
      "300",
      "茶叶",
      "福建茶业供应商",
      "3",
      "",
      "适合与礼盒、贺卡一起搭配",
    ],
    [
      "CARD-001",
      "定制感谢卡",
      "配件",
      "贺卡",
      "3",
      "12",
      "200",
      "客户拜访、企业礼赠",
      "C:\\products\\card-001-main.jpg",
      "",
      "10*15",
      "20",
      "纸张",
      "本地印刷厂",
      "2",
      "",
      "{\"mustWith\":[\"BOX-001\"]}",
    ],
  ];
}

function buildSkuImportTemplateCsv() {
  return `\ufeff${buildSkuImportTemplateRows().map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
}

function buildSkuImportTemplateXlsx() {
  const rows = buildSkuImportTemplateRows();
  return buildZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="商品导入模板" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/worksheets/sheet1.xml": worksheetXml(rows),
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function worksheetXml(rows) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildZip(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;
  const names = Object.keys(entries);

  for (const name of names) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(entries[name], "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    fileRecords.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const centralStart = offset;
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...fileRecords, central, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = {
  buildSkuImportTemplateCsv,
  buildSkuImportTemplateXlsx,
  getSkuImportFieldGuide,
  parseSkuImportFile,
  parseSkuImportText,
};
