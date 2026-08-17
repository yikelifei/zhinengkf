"use strict";

const KNOWLEDGE_IMPORT_FIELD_DEFINITIONS = [
  { field: "title", label: "知识标题", required: true, example: "报价与预算确认 SOP", description: "客服和 Agent 检索时看到的知识标题。" },
  { field: "content", label: "知识正文", required: true, example: "客户问价格时先确认用途、数量、预算和交付时间。", description: "可执行的 SOP、话术或纠错沉淀，不能只写一个标题。" },
  { field: "agentKey", label: "Agent Key", required: false, example: "pre_sales", description: "可选；如填写会绑定到指定 Agent。" },
  { field: "agentId", label: "Agent ID", required: false, example: "agent_pre_sales", description: "可选；优先级高于 Agent Key。" },
  { field: "tags", label: "场景标签", required: false, example: "报价、预算、客户拜访", description: "用于知识库验收和后续检索。" },
  { field: "source", label: "资料来源", required: false, example: "2026-07 客服 SOP 文档", description: "用于运营追溯，建议填写文件名或负责人。" },
  { field: "qualityScore", label: "质量分", required: false, example: "90", description: "人工确认后的可信度，0-100；不填按待复核处理。" },
];

const HEADER_MAP = {
  title: ["title", "知识标题", "标题", "sop标题", "问题", "主题"],
  content: ["content", "知识正文", "正文", "内容", "sop内容", "话术", "答案", "处理步骤"],
  agentKey: ["agentKey", "agent key", "agent", "智能体key", "智能体", "场景agent"],
  agentId: ["agentId", "agent id", "智能体id"],
  tags: ["tags", "标签", "场景标签", "关键词", "适用场景"],
  source: ["source", "来源", "资料来源", "文件来源", "负责人"],
  qualityScore: ["qualityScore", "score", "质量分", "可信度", "复核分"],
};

function getKnowledgeImportFieldGuide() {
  return KNOWLEDGE_IMPORT_FIELD_DEFINITIONS.map((definition) => ({
    ...definition,
    aliases: HEADER_MAP[definition.field] || [],
  }));
}

function buildKnowledgeImportTemplateCsv() {
  const rows = [
    KNOWLEDGE_IMPORT_FIELD_DEFINITIONS.map((field) => field.label),
    [
      "报价与预算确认 SOP",
      "客户只问价格时，先确认用途、数量、单盒预算、交付时间和是否需要企业 Logo 定制。高价值订单必须人工复核后发送报价。",
      "pre_sales",
      "",
      "报价、预算、企业礼品",
      "客服主管整理的正式 SOP",
      "92",
    ],
  ];
  return `\ufeff${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
}

function parseKnowledgeImportText(text) {
  const input = String(text || "").trim();
  if (!input) return failure("没有读取到知识库数据");
  if (/^\s*[\[{]/.test(input)) return parseKnowledgeImportJson(input);
  return parseKnowledgeImportDelimited(input);
}

function parseKnowledgeImportJson(input) {
  try {
    const parsed = JSON.parse(input);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [];
    if (!rows.length) return failure("JSON 中没有 rows 数组或知识条目数组");
    return normalizeKnowledgeRows(rows.map((row, index) => ({ raw: row, line: index + 1 })), []);
  } catch {
    return failure("JSON 格式无效");
  }
}

function parseKnowledgeImportDelimited(input) {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return failure("没有读取到知识库数据");
  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitLine(lines[0], delimiter).map((header) => header.trim());
  const indexes = mapHeaders(rawHeaders.map(normalizeHeader));
  const missingRequiredFields = getKnowledgeImportFieldGuide().filter((field) => field.required && indexes[field.field] === undefined);
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = splitLine(lines[index], delimiter);
    rows.push({
      line: index + 1,
      raw: {
        title: get(values, indexes.title),
        content: get(values, indexes.content),
        agentKey: get(values, indexes.agentKey),
        agentId: get(values, indexes.agentId),
        tags: get(values, indexes.tags),
        source: get(values, indexes.source),
        qualityScore: get(values, indexes.qualityScore),
      },
    });
  }
  return normalizeKnowledgeRows(rows, missingRequiredFields, describeHeaderMapping(rawHeaders, indexes));
}

function normalizeKnowledgeRows(inputRows, missingRequiredFields = [], mapping = {}) {
  const rows = [];
  const errors = [];
  for (const { raw, line } of inputRows) {
    const row = {
      title: text(raw.title),
      content: text(raw.content),
      agentKey: text(raw.agentKey),
      agentId: text(raw.agentId),
      tags: splitTags(raw.tags),
      source: text(raw.source),
      qualityScore: normalizeScore(raw.qualityScore),
    };
    const rowErrors = validateKnowledgeRow(row);
    if (rowErrors.length) {
      errors.push({ line, message: rowErrors.join("；") });
      continue;
    }
    rows.push(row);
  }
  return {
    ok: rows.length > 0 && errors.length === 0 && !missingRequiredFields.length,
    importedCount: rows.length,
    skippedCount: errors.length,
    rows,
    errors,
    missingRequiredFields,
    fieldMapping: mapping.fieldMapping || [],
    unmappedHeaders: mapping.unmappedHeaders || [],
    acceptance: buildKnowledgeImportAcceptance(rows, errors, missingRequiredFields),
  };
}

function buildKnowledgeImportAcceptance(rows, errors = [], missingRequiredFields = []) {
  const missingAgentCount = rows.filter((row) => !row.agentId && !row.agentKey).length;
  const missingTagsCount = rows.filter((row) => !row.tags.length).length;
  const needsReviewCount = rows.filter((row) => Number(row.qualityScore || 0) < 80).length;
  const shortContentCount = rows.filter((row) => row.content.length < 20).length;
  const blockers = [];
  if (missingRequiredFields.length) blockers.push("缺少必填列");
  if (errors.length) blockers.push("存在无法导入的知识行");
  if (!rows.length) blockers.push("没有可导入知识条目");
  if (shortContentCount) blockers.push("存在正文过短的知识条目");
  return {
    total: rows.length,
    readyCount: rows.length - needsReviewCount - shortContentCount,
    needsReviewCount,
    missingAgentCount,
    missingTagsCount,
    shortContentCount,
    blocked: blockers.length > 0,
    blockers,
    nextActions: [
      ...(missingAgentCount ? ["补齐 Agent 归属，避免知识只能进入通用池"] : []),
      ...(missingTagsCount ? ["补齐场景标签，便于按报价、售后、物流等场景验收"] : []),
      ...(needsReviewCount ? ["低于 80 分或未评分知识需要人工复核后再用于技能应用"] : []),
      ...(shortContentCount ? ["补充可执行 SOP 正文，不能只导入标题"] : []),
    ],
  };
}

function validateKnowledgeRow(row) {
  const errors = [];
  if (!row.title) errors.push("title is required");
  if (!row.content) errors.push("content is required");
  if (row.content && row.content.length < 20) errors.push("content must include actionable SOP text");
  if (row.qualityScore !== undefined && (row.qualityScore < 0 || row.qualityScore > 100)) errors.push("qualityScore must be 0-100");
  return errors;
}

function describeHeaderMapping(rawHeaders, indexes) {
  const usedIndexes = new Set(Object.values(indexes));
  return {
    fieldMapping: getKnowledgeImportFieldGuide().map((definition) => {
      const index = indexes[definition.field];
      return {
        ...definition,
        sourceHeader: index === undefined ? "" : rawHeaders[index] || "",
        column: index === undefined ? null : index + 1,
        matched: index !== undefined,
      };
    }),
    unmappedHeaders: rawHeaders.filter((header, index) => header && !usedIndexes.has(index)),
  };
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

function detectDelimiter(headerLine) {
  if (headerLine.includes("\t")) return "\t";
  return ",";
}

function splitLine(line, delimiter) {
  if (delimiter === "\t") return line.split("\t").map((item) => item.trim());
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

function normalizeHeader(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function get(values, index) {
  return index === undefined ? "" : values[index] || "";
}

function text(value) {
  return String(value || "").trim();
}

function splitTags(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return String(value || "").split(/[,、;；|]/).map(text).filter(Boolean);
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const score = Number(value);
  return Number.isFinite(score) ? Math.round(score) : undefined;
}

function csvEscape(value) {
  const textValue = String(value ?? "");
  return /[",\r\n]/.test(textValue) ? `"${textValue.replace(/"/g, "\"\"")}"` : textValue;
}

function failure(message) {
  return {
    ok: false,
    importedCount: 0,
    skippedCount: 1,
    rows: [],
    errors: [{ line: 0, message }],
    missingRequiredFields: getKnowledgeImportFieldGuide().filter((field) => field.required),
    fieldMapping: [],
    unmappedHeaders: [],
    acceptance: buildKnowledgeImportAcceptance([], [{ line: 0, message }], getKnowledgeImportFieldGuide().filter((field) => field.required)),
  };
}

module.exports = {
  buildKnowledgeImportAcceptance,
  buildKnowledgeImportTemplateCsv,
  getKnowledgeImportFieldGuide,
  parseKnowledgeImportText,
};
