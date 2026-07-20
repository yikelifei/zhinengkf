"use strict";

const zlib = require("node:zlib");
const { TextDecoder } = require("node:util");

const MEBIBYTE = 1024 * 1024;
const SKU_IMPORT_LIMITS = Object.freeze({
  maxInputBytes: 8 * MEBIBYTE,
  maxZipEntries: 256,
  maxZipEntryCompressedBytes: 8 * MEBIBYTE,
  maxZipEntryUncompressedBytes: 12 * MEBIBYTE,
  maxZipTotalUncompressedBytes: 24 * MEBIBYTE,
  maxSharedStrings: 20000,
  maxWorksheetRows: 5000,
  maxWorksheetCells: 100000,
  maxWorksheetColumns: 256,
  maxXmlTagBytes: 16 * 1024,
  maxTextRunsPerCell: 4096,
  maxCellTextBytes: 256 * 1024,
  maxFinalTextBytes: 2 * MEBIBYTE,
});

const XML_SCANNER_CONTRACT = Object.freeze({
  strategy: "forward-only-index-scanner",
  materializesMatchArrays: false,
  rejectsElementNPlusOneBeforeBodyScan: true,
});

class SkuImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SkuImportError";
    this.code = code;
  }
}

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
  const inputText = String(text || "");
  if (Buffer.byteLength(inputText, "utf8") > SKU_IMPORT_LIMITS.maxFinalTextBytes) {
    return skuImportFailure("SKU_IMPORT_TEXT_TOO_LARGE", "导入文本超过允许大小");
  }
  if (countLinesAboveLimit(inputText, SKU_IMPORT_LIMITS.maxWorksheetRows)) {
    return skuImportFailure("SKU_IMPORT_ROW_LIMIT", "导入文本行数超过允许上限");
  }

  const lines = inputText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { ok: false, rows: [], errors: [{ line: 0, message: "没有读取到商品数据" }], fieldMapping: [], unmappedHeaders: [], missingRequiredFields: getSkuImportFieldGuide().filter((field) => field.required) };
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitLine(lines[0], delimiter).map((header) => String(header || "").trim());
  if (rawHeaders.length > SKU_IMPORT_LIMITS.maxWorksheetColumns) {
    return skuImportFailure("SKU_IMPORT_COLUMN_LIMIT", "导入文本列数超过允许上限");
  }
  const headers = rawHeaders.map(normalizeHeader);
  const indexes = mapHeaders(headers);
  const mapping = describeSkuHeaderMapping(rawHeaders, indexes);
  const rows = [];
  const errors = [];
  let cellCount = rawHeaders.length;

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitLine(lines[index], delimiter);
    if (values.length > SKU_IMPORT_LIMITS.maxWorksheetColumns) {
      return skuImportFailure("SKU_IMPORT_COLUMN_LIMIT", "导入文本列数超过允许上限");
    }
    cellCount += values.length;
    if (cellCount > SKU_IMPORT_LIMITS.maxWorksheetCells) {
      return skuImportFailure("SKU_IMPORT_CELL_LIMIT", "导入文本单元格数量超过允许上限");
    }
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
  let buffer;
  try {
    buffer = decodeSkuImportPayload(input);
  } catch (error) {
    return skuImportFailureFromError(error, fileName);
  }
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
    return skuImportFailureFromError(error, fileName);
  }
}

function decodeSkuImportPayload(input) {
  if (Buffer.isBuffer(input)) {
    assertInputSize(input.length);
    return input;
  }

  const encoded = String(input.dataBase64 || "");
  if (!encoded) return Buffer.alloc(0);
  const maxEncodedLength = Math.ceil(SKU_IMPORT_LIMITS.maxInputBytes / 3) * 4;
  if (encoded.length > maxEncodedLength) {
    throw new SkuImportError("SKU_IMPORT_INPUT_TOO_LARGE", "导入文件超过允许大小");
  }
  if (!isCanonicalBase64(encoded)) {
    throw new SkuImportError("SKU_IMPORT_INVALID_BASE64", "导入文件必须使用规范 Base64 编码");
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedLength = (encoded.length / 4) * 3 - padding;
  assertInputSize(decodedLength);
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length !== decodedLength || buffer.toString("base64") !== encoded) {
    throw new SkuImportError("SKU_IMPORT_INVALID_BASE64", "导入文件必须使用规范 Base64 编码");
  }
  return buffer;
}

function isCanonicalBase64(value) {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function assertInputSize(size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > SKU_IMPORT_LIMITS.maxInputBytes) {
    throw new SkuImportError("SKU_IMPORT_INPUT_TOO_LARGE", "导入文件超过允许大小");
  }
}

function skuImportFailure(code, message, sourceFileName = "") {
  return {
    ok: false,
    rows: [],
    errors: [{ line: 0, message: `${code}: ${message}` }],
    importedCount: 0,
    skippedCount: 1,
    fieldMapping: [],
    unmappedHeaders: [],
    missingRequiredFields: getSkuImportFieldGuide().filter((field) => field.required),
    ...(sourceFileName ? { sourceFileName } : {}),
  };
}

function skuImportFailureFromError(error, sourceFileName) {
  if (error instanceof SkuImportError) {
    return skuImportFailure(error.code, error.message, sourceFileName);
  }
  return skuImportFailure("SKU_IMPORT_PARSE_FAILED", "文件格式无效或已损坏", sourceFileName);
}

function countLinesAboveLimit(text, limit) {
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10 && ++lines > limit) return true;
  }
  return false;
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
  const content = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.subarray(3)
    : buffer;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new SkuImportError("SKU_IMPORT_TEXT_ENCODING", "文本文件不是有效 UTF-8 编码");
  }
}

function isZipBuffer(buffer) {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function xlsxBufferToDelimitedText(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(decodeXmlEntry(entries.get("xl/sharedStrings.xml")));
  const sheetName = resolveFirstWorksheetName(entries);
  const sheetXml = decodeXmlEntry(entries.get(sheetName));
  if (!sheetXml) throw new Error("没有找到工作表数据");
  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  if (!rows.length) throw new Error("工作表没有可导入的行");
  const text = rows.map((row) => row.map((cell) => String(cell || "").replace(/\t/g, " ").trim()).join("\t")).join("\n");
  if (Buffer.byteLength(text, "utf8") > SKU_IMPORT_LIMITS.maxFinalTextBytes) {
    throw new SkuImportError("SKU_IMPORT_TEXT_TOO_LARGE", "工作表提取文本超过允许大小");
  }
  return text;
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "不是有效的 xlsx/zip 文件");
  ensureZipRange(buffer, eocdOffset, 22);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new SkuImportError("SKU_IMPORT_ZIP_MULTIDISK", "不支持多磁盘 ZIP 文件");
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SkuImportError("SKU_IMPORT_ZIP64_UNSUPPORTED", "不支持 ZIP64 工作簿");
  }
  if (totalEntries > SKU_IMPORT_LIMITS.maxZipEntries) {
    throw new SkuImportError("SKU_IMPORT_ZIP_ENTRY_LIMIT", "ZIP 条目数量超过允许上限");
  }
  if (eocdOffset + 22 + commentLength !== buffer.length) {
    throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "ZIP 结束目录或注释边界无效");
  }
  if (
    centralOffset > eocdOffset
    || centralSize > eocdOffset - centralOffset
    || centralOffset + centralSize !== eocdOffset
  ) {
    throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "ZIP 中央目录边界无效");
  }

  const centralEnd = centralOffset + centralSize;
  const entries = new Map();
  const normalizedNames = new Set();
  const localOffsets = new Set();
  const localRanges = [];
  let declaredTotal = 0;
  let actualTotal = 0;
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    ensureZipRange(buffer, offset, 46, centralEnd);
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "ZIP 中央目录损坏");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc32 = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new SkuImportError("SKU_IMPORT_ZIP64_UNSUPPORTED", "不支持 ZIP64 条目");
    }
    if (diskStart !== 0) throw new SkuImportError("SKU_IMPORT_ZIP_MULTIDISK", "不支持多磁盘 ZIP 条目");
    if ((flags & 0x0001) !== 0) throw new SkuImportError("SKU_IMPORT_ZIP_ENCRYPTED", "不支持加密 ZIP 条目");
    if (method !== 0 && method !== 8) {
      throw new SkuImportError("SKU_IMPORT_ZIP_METHOD", `不支持的 xlsx 压缩方式：${method}`);
    }
    if (compressedSize > SKU_IMPORT_LIMITS.maxZipEntryCompressedBytes) {
      throw new SkuImportError("SKU_IMPORT_ZIP_COMPRESSED_LIMIT", "ZIP 单个条目压缩数据超过允许上限");
    }
    if (uncompressedSize > SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes) {
      throw new SkuImportError("SKU_IMPORT_ZIP_UNCOMPRESSED_LIMIT", "ZIP 单个条目声明解压大小超过允许上限");
    }
    declaredTotal += uncompressedSize;
    if (declaredTotal > SKU_IMPORT_LIMITS.maxZipTotalUncompressedBytes) {
      throw new SkuImportError("SKU_IMPORT_ZIP_TOTAL_LIMIT", "ZIP 声明累计解压大小超过允许上限");
    }

    const recordLength = 46 + fileNameLength + extraLength + commentLength;
    ensureZipRange(buffer, offset, recordLength, centralEnd);
    const rawName = decodeZipName(buffer.subarray(offset + 46, offset + 46 + fileNameLength));
    const fileName = normalizeAndValidateZipPath(rawName);
    const nameKey = fileName.toLowerCase();
    if (normalizedNames.has(nameKey)) {
      throw new SkuImportError("SKU_IMPORT_ZIP_DUPLICATE", "ZIP 包含重复或大小写冲突的条目");
    }
    normalizedNames.add(nameKey);
    if (localOffsets.has(localHeaderOffset)) {
      throw new SkuImportError("SKU_IMPORT_ZIP_DUPLICATE", "ZIP 条目复用了本地文件偏移");
    }
    localOffsets.add(localHeaderOffset);

    const localEntry = readZipEntryData(buffer, {
      localHeaderOffset,
      compressedSize,
      uncompressedSize,
      expectedCrc32,
      method,
      flags,
      fileName,
      upperBound: centralOffset,
    });
    if (localRanges.some((range) => localEntry.start < range.end && range.start < localEntry.end)) {
      throw new SkuImportError("SKU_IMPORT_ZIP_LOCAL_OVERLAP", "ZIP 本地条目区域发生重叠");
    }
    localRanges.push({ start: localEntry.start, end: localEntry.end });
    const data = localEntry.data;
    actualTotal += data.length;
    if (actualTotal > SKU_IMPORT_LIMITS.maxZipTotalUncompressedBytes) {
      throw new SkuImportError("SKU_IMPORT_ZIP_TOTAL_LIMIT", "ZIP 实际累计解压大小超过允许上限");
    }
    if (!fileName.endsWith("/")) entries.set(fileName, data);
    offset += recordLength;
  }

  if (offset !== centralEnd) {
    throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "ZIP 中央目录长度与条目不一致");
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

function readZipEntryData(buffer, entry) {
  ensureZipRange(buffer, entry.localHeaderOffset, 30, entry.upperBound);
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "ZIP 本地文件头损坏");
  }
  const localFlags = buffer.readUInt16LE(entry.localHeaderOffset + 6);
  const localMethod = buffer.readUInt16LE(entry.localHeaderOffset + 8);
  const localCrc32 = buffer.readUInt32LE(entry.localHeaderOffset + 14);
  const localCompressedSize = buffer.readUInt32LE(entry.localHeaderOffset + 18);
  const localUncompressedSize = buffer.readUInt32LE(entry.localHeaderOffset + 22);
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  if (localFlags !== entry.flags || localMethod !== entry.method) {
    throw new SkuImportError("SKU_IMPORT_ZIP_LOCAL_MISMATCH", "ZIP 本地文件头与中央目录不一致");
  }
  const usesDataDescriptor = (entry.flags & 0x0008) !== 0;
  if (!usesDataDescriptor && (
    localCrc32 !== entry.expectedCrc32
    || localCompressedSize !== entry.compressedSize
    || localUncompressedSize !== entry.uncompressedSize
  )) {
    throw new SkuImportError("SKU_IMPORT_ZIP_SIZE_MISMATCH", "ZIP 本地文件大小与中央目录不一致");
  }
  if (usesDataDescriptor && (
    ![0, entry.expectedCrc32].includes(localCrc32)
    || ![0, entry.compressedSize].includes(localCompressedSize)
    || ![0, entry.uncompressedSize].includes(localUncompressedSize)
  )) {
    throw new SkuImportError("SKU_IMPORT_ZIP_DESCRIPTOR", "ZIP data descriptor 本地声明无效");
  }

  const headerLength = 30 + nameLength + extraLength;
  ensureZipRange(buffer, entry.localHeaderOffset, headerLength, entry.upperBound);
  const localName = normalizeAndValidateZipPath(decodeZipName(
    buffer.subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + nameLength),
  ));
  if (localName !== entry.fileName) {
    throw new SkuImportError("SKU_IMPORT_ZIP_LOCAL_MISMATCH", "ZIP 本地文件名与中央目录不一致");
  }
  const dataStart = entry.localHeaderOffset + headerLength;
  ensureZipRange(buffer, dataStart, entry.compressedSize, entry.upperBound);
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  let entryEnd = dataStart + entry.compressedSize;
  if (usesDataDescriptor) {
    ensureZipRange(buffer, entryEnd, 12, entry.upperBound);
    const hasSignature = buffer.readUInt32LE(entryEnd) === 0x08074b50;
    const descriptorOffset = entryEnd + (hasSignature ? 4 : 0);
    ensureZipRange(buffer, descriptorOffset, 12, entry.upperBound);
    const descriptorCrc32 = buffer.readUInt32LE(descriptorOffset);
    const descriptorCompressedSize = buffer.readUInt32LE(descriptorOffset + 4);
    const descriptorUncompressedSize = buffer.readUInt32LE(descriptorOffset + 8);
    if (
      descriptorCrc32 !== entry.expectedCrc32
      || descriptorCompressedSize !== entry.compressedSize
      || descriptorUncompressedSize !== entry.uncompressedSize
    ) {
      throw new SkuImportError("SKU_IMPORT_ZIP_DESCRIPTOR", "ZIP data descriptor 与中央目录不一致");
    }
    entryEnd = descriptorOffset + 12;
  }
  let output;
  if (entry.method === 0) {
    output = Buffer.from(compressed);
  } else {
    try {
      output = zlib.inflateRawSync(compressed, {
        maxOutputLength: SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes,
      });
    } catch (error) {
      if (error?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|larger than/i.test(String(error?.message || ""))) {
        throw new SkuImportError("SKU_IMPORT_ZIP_INFLATE_LIMIT", "ZIP 条目实际解压数据超过允许上限");
      }
      throw new SkuImportError("SKU_IMPORT_ZIP_DATA", "ZIP 压缩数据无效");
    }
  }
  if (output.length > SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes) {
    throw new SkuImportError("SKU_IMPORT_ZIP_INFLATE_LIMIT", "ZIP 条目实际解压数据超过允许上限");
  }
  if (output.length !== entry.uncompressedSize) {
    throw new SkuImportError("SKU_IMPORT_ZIP_SIZE_MISMATCH", "ZIP 条目声明大小与实际解压大小不一致");
  }
  if (crc32(output) !== entry.expectedCrc32) {
    throw new SkuImportError("SKU_IMPORT_ZIP_CRC", "ZIP 条目校验和无效");
  }
  return { data: output, start: entry.localHeaderOffset, end: entryEnd };
}

function ensureZipRange(buffer, offset, length, upperBound = buffer.length) {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || upperBound < 0
    || upperBound > buffer.length
    || offset > upperBound
    || length > upperBound - offset
  ) {
    throw new SkuImportError("SKU_IMPORT_ZIP_BOUNDS", "ZIP 结构偏移或长度越界");
  }
}

function decodeZipName(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new SkuImportError("SKU_IMPORT_ZIP_PATH", "ZIP 条目名称不是有效 UTF-8");
  }
}

function normalizeAndValidateZipPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const pathWithoutTrailingSlash = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  const segments = pathWithoutTrailingSlash.split("/");
  if (
    !pathWithoutTrailingSlash
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || /[\0-\x1f\x7f]/.test(normalized)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new SkuImportError("SKU_IMPORT_ZIP_PATH", "ZIP 包含不安全或含歧义的条目路径");
  }
  return normalized;
}

function decodeXmlEntry(buffer) {
  if (!buffer) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new SkuImportError("SKU_IMPORT_XML_ENCODING", "工作簿 XML 不是有效 UTF-8");
  }
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  let totalBytes = 0;
  scanXmlElements(xml, "si", {
    limit: SKU_IMPORT_LIMITS.maxSharedStrings,
    limitCode: "SKU_IMPORT_SHARED_STRING_LIMIT",
    limitMessage: "共享字符串数量超过允许上限",
  }, (element) => {
    const value = extractXmlTextRuns(xml, element.contentStart, element.contentEnd);
    totalBytes = addDecodedTextBytes(totalBytes, value, "共享字符串文本超过允许大小");
    strings.push(value);
  });
  return strings;
}

function resolveFirstWorksheetName(entries) {
  if (entries.has("xl/workbook.xml") && entries.has("xl/_rels/workbook.xml.rels")) {
    const workbookXml = decodeXmlEntry(entries.get("xl/workbook.xml"));
    const relsXml = decodeXmlEntry(entries.get("xl/_rels/workbook.xml.rels"));
    const sheetMatch = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/);
    if (sheetMatch) {
      const relationship = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(sheetMatch[1])}"[^>]*Target="([^"]+)"`).exec(relsXml);
      if (relationship?.[1]) {
        const rawTarget = xmlUnescape(relationship[1]).replace(/\\/g, "/");
        const packageTarget = rawTarget.startsWith("/") ? rawTarget.slice(1) : rawTarget;
        const target = packageTarget.startsWith("xl/") ? packageTarget : `xl/${packageTarget}`;
        return normalizeAndValidateZipPath(target);
      }
    }
  }
  return [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) || "";
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  let totalCells = 0;
  let totalDecodedBytes = 0;
  scanXmlElements(xml, "row", {
    limit: SKU_IMPORT_LIMITS.maxWorksheetRows,
    limitCode: "SKU_IMPORT_ROW_LIMIT",
    limitMessage: "工作表行数超过允许上限",
  }, (rowElement) => {
    const row = [];
    const occupiedColumns = new Set();
    scanXmlElements(xml, "c", {
      start: rowElement.contentStart,
      end: rowElement.contentEnd,
      limit: SKU_IMPORT_LIMITS.maxWorksheetCells - totalCells,
      limitCode: "SKU_IMPORT_CELL_LIMIT",
      limitMessage: "工作表单元格数量超过允许上限",
    }, (cellElement) => {
      totalCells += 1;
      const ref = readXmlAttribute(xml, cellElement.start, cellElement.openEnd, "r");
      const type = readXmlAttribute(xml, cellElement.start, cellElement.openEnd, "t");
      const index = ref ? columnIndexFromCellRef(ref) : row.length;
      if (index >= SKU_IMPORT_LIMITS.maxWorksheetColumns) {
        throw new SkuImportError("SKU_IMPORT_COLUMN_LIMIT", "工作表列数超过允许上限");
      }
      if (occupiedColumns.has(index)) {
        throw new SkuImportError("SKU_IMPORT_CELL_DUPLICATE", "工作表同一行包含重复单元格引用");
      }
      occupiedColumns.add(index);
      const value = parseCellValue(xml, cellElement.contentStart, cellElement.contentEnd, type, sharedStrings);
      totalDecodedBytes = addDecodedTextBytes(totalDecodedBytes, value, "工作表提取文本超过允许大小");
      row[index] = value;
    });
    const trimmed = trimTrailingEmptyCells(row);
    if (trimmed.some((cell) => String(cell || "").trim())) rows.push(trimmed);
  });
  return rows;
}

function parseCellValue(xml, start, end, type, sharedStrings) {
  if (type === "inlineStr") {
    return extractXmlTextRuns(xml, start, end);
  }
  const value = extractFirstXmlElementText(xml, "v", start, end);
  if (type === "s") {
    if (!/^\d+$/.test(value)) {
      throw new SkuImportError("SKU_IMPORT_SHARED_STRING_INDEX", "共享字符串索引无效");
    }
    const index = Number(value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new SkuImportError("SKU_IMPORT_SHARED_STRING_INDEX", "共享字符串索引越界");
    }
    return sharedStrings[index];
  }
  return value;
}

function scanXmlElements(xml, tagName, options, visitor) {
  const startBoundary = options.start ?? 0;
  const endBoundary = options.end ?? xml.length;
  let cursor = startBoundary;
  let count = 0;
  while (cursor < endBoundary) {
    const start = findNextXmlStartTag(xml, tagName, cursor, endBoundary);
    if (start < 0) break;
    count += 1;
    if (count > options.limit) {
      throw new SkuImportError(options.limitCode, options.limitMessage);
    }
    const openEnd = findXmlTagEnd(xml, start, endBoundary);
    if (isSelfClosingXmlTag(xml, start, openEnd)) {
      visitor({ start, openEnd, contentStart: openEnd + 1, contentEnd: openEnd + 1 });
      cursor = openEnd + 1;
      continue;
    }
    const close = findNextXmlClosingTag(xml, tagName, openEnd + 1, endBoundary);
    if (!close) {
      throw new SkuImportError("SKU_IMPORT_XML_MALFORMED", `工作簿 XML 的 <${tagName}> 标签未闭合`);
    }
    visitor({ start, openEnd, contentStart: openEnd + 1, contentEnd: close.start });
    cursor = close.end + 1;
  }
  return count;
}

function findNextXmlStartTag(xml, tagName, start, end) {
  const needle = `<${tagName}`;
  let cursor = start;
  while (cursor < end) {
    const found = xml.indexOf(needle, cursor);
    if (found < 0 || found >= end) return -1;
    if (isXmlNameBoundary(xml.charCodeAt(found + needle.length))) return found;
    cursor = found + needle.length;
  }
  return -1;
}

function findNextXmlClosingTag(xml, tagName, start, end) {
  const needle = `</${tagName}`;
  let cursor = start;
  while (cursor < end) {
    const found = xml.indexOf(needle, cursor);
    if (found < 0 || found >= end) return null;
    if (isXmlNameBoundary(xml.charCodeAt(found + needle.length))) {
      const closeEnd = findXmlTagEnd(xml, found, end);
      return { start: found, end: closeEnd };
    }
    cursor = found + needle.length;
  }
  return null;
}

function isXmlNameBoundary(code) {
  return code === 9 || code === 10 || code === 13 || code === 32 || code === 47 || code === 62;
}

function findXmlTagEnd(xml, start, end) {
  let quote = 0;
  const hardEnd = Math.min(end, start + SKU_IMPORT_LIMITS.maxXmlTagBytes + 1);
  for (let index = start + 1; index < hardEnd; index += 1) {
    const code = xml.charCodeAt(index);
    if (quote) {
      if (code === quote) quote = 0;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
    } else if (code === 62) {
      if (Buffer.byteLength(xml.slice(start, index + 1), "utf8") > SKU_IMPORT_LIMITS.maxXmlTagBytes) {
        throw new SkuImportError("SKU_IMPORT_XML_TAG_LIMIT", "工作簿 XML 标签超过允许大小");
      }
      return index;
    }
  }
  if (hardEnd < end) {
    throw new SkuImportError("SKU_IMPORT_XML_TAG_LIMIT", "工作簿 XML 标签超过允许大小");
  }
  throw new SkuImportError("SKU_IMPORT_XML_MALFORMED", "工作簿 XML 标签未闭合");
}

function isSelfClosingXmlTag(xml, start, openEnd) {
  let cursor = openEnd - 1;
  while (cursor > start && isXmlWhitespace(xml.charCodeAt(cursor))) cursor -= 1;
  return xml.charCodeAt(cursor) === 47;
}

function isXmlWhitespace(code) {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

function readXmlAttribute(xml, start, openEnd, name) {
  let cursor = start + 1;
  while (cursor < openEnd && !isXmlWhitespace(xml.charCodeAt(cursor))) cursor += 1;
  while (cursor < openEnd) {
    while (cursor < openEnd && isXmlWhitespace(xml.charCodeAt(cursor))) cursor += 1;
    if (cursor >= openEnd || xml.charCodeAt(cursor) === 47) break;
    const nameStart = cursor;
    while (cursor < openEnd && !isXmlWhitespace(xml.charCodeAt(cursor)) && xml.charCodeAt(cursor) !== 61) cursor += 1;
    const attributeName = xml.slice(nameStart, cursor);
    while (cursor < openEnd && isXmlWhitespace(xml.charCodeAt(cursor))) cursor += 1;
    if (xml.charCodeAt(cursor) !== 61) {
      while (cursor < openEnd && !isXmlWhitespace(xml.charCodeAt(cursor))) cursor += 1;
      continue;
    }
    cursor += 1;
    while (cursor < openEnd && isXmlWhitespace(xml.charCodeAt(cursor))) cursor += 1;
    const quote = xml.charCodeAt(cursor);
    if (quote !== 34 && quote !== 39) {
      while (cursor < openEnd && !isXmlWhitespace(xml.charCodeAt(cursor))) cursor += 1;
      continue;
    }
    const valueStart = ++cursor;
    while (cursor < openEnd && xml.charCodeAt(cursor) !== quote) cursor += 1;
    if (cursor >= openEnd) {
      throw new SkuImportError("SKU_IMPORT_XML_MALFORMED", "工作簿 XML 属性未闭合");
    }
    if (attributeName === name) return xmlUnescape(xml.slice(valueStart, cursor));
    cursor += 1;
  }
  return "";
}

function extractXmlTextRuns(xml, start, end) {
  const parts = [];
  let cellBytes = 0;
  scanXmlElements(xml, "t", {
    start,
    end,
    limit: SKU_IMPORT_LIMITS.maxTextRunsPerCell,
    limitCode: "SKU_IMPORT_TEXT_RUN_LIMIT",
    limitMessage: "单元格文本片段数量超过允许上限",
  }, (element) => {
    const part = decodeBoundedXmlText(xml, element.contentStart, element.contentEnd);
    cellBytes += Buffer.byteLength(part, "utf8");
    if (cellBytes > SKU_IMPORT_LIMITS.maxCellTextBytes) {
      throw new SkuImportError("SKU_IMPORT_CELL_TEXT_LIMIT", "单个单元格文本超过允许大小");
    }
    parts.push(part);
  });
  return parts.join("");
}

function extractFirstXmlElementText(xml, tagName, start, end) {
  const elementStart = findNextXmlStartTag(xml, tagName, start, end);
  if (elementStart < 0) return "";
  const openEnd = findXmlTagEnd(xml, elementStart, end);
  if (isSelfClosingXmlTag(xml, elementStart, openEnd)) return "";
  const close = findNextXmlClosingTag(xml, tagName, openEnd + 1, end);
  if (!close) {
    throw new SkuImportError("SKU_IMPORT_XML_MALFORMED", `工作簿 XML 的 <${tagName}> 标签未闭合`);
  }
  return decodeBoundedXmlText(xml, openEnd + 1, close.start);
}

function decodeBoundedXmlText(xml, start, end) {
  if (end - start > SKU_IMPORT_LIMITS.maxCellTextBytes) {
    throw new SkuImportError("SKU_IMPORT_CELL_TEXT_LIMIT", "单个单元格文本超过允许大小");
  }
  const raw = xml.slice(start, end);
  if (Buffer.byteLength(raw, "utf8") > SKU_IMPORT_LIMITS.maxCellTextBytes) {
    throw new SkuImportError("SKU_IMPORT_CELL_TEXT_LIMIT", "单个单元格文本超过允许大小");
  }
  const decoded = xmlUnescape(raw);
  if (Buffer.byteLength(decoded, "utf8") > SKU_IMPORT_LIMITS.maxCellTextBytes) {
    throw new SkuImportError("SKU_IMPORT_CELL_TEXT_LIMIT", "单个单元格文本超过允许大小");
  }
  return decoded;
}

function addDecodedTextBytes(totalBytes, value, message) {
  const cellBytes = Buffer.byteLength(value, "utf8");
  if (cellBytes > SKU_IMPORT_LIMITS.maxCellTextBytes) {
    throw new SkuImportError("SKU_IMPORT_CELL_TEXT_LIMIT", "单个单元格文本超过允许大小");
  }
  const nextTotal = totalBytes + cellBytes;
  if (nextTotal > SKU_IMPORT_LIMITS.maxFinalTextBytes) {
    throw new SkuImportError("SKU_IMPORT_TEXT_TOO_LARGE", message);
  }
  return nextTotal;
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
  SKU_IMPORT_LIMITS,
  buildSkuImportTemplateCsv,
  buildSkuImportTemplateXlsx,
  getSkuImportFieldGuide,
  parseSkuImportFile,
  parseSkuImportText,
};
