const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourceUrl = "https://developer.work.weixin.qq.com/document/path/92109";
const documentEndpoint = "https://developer.work.weixin.qq.com/docFetch/fetchCnt";
const serverApiCategoryId = 90135;
const relevantCategoryIds = new Set([94637, 92108]);
const outputDirectory = path.join(projectRoot, ".verification", "wechat-work-official-api");
const auditPath = path.join(outputDirectory, "audit.json");
const concurrency = Math.max(1, Math.min(4, Number(process.env.WECOM_DOC_AUDIT_CONCURRENCY || 1)));
const requestDelayMs = Math.max(250, Number(process.env.WECOM_DOC_AUDIT_DELAY_MS || 900));
const maxFetchesPerRun = Math.max(1, Number(process.env.WECOM_DOC_AUDIT_MAX_FETCHES || 80));
const refreshAll = process.env.WECOM_DOC_AUDIT_REFRESH_ALL === "1";

async function main() {
  const startedAt = new Date().toISOString();
  const previousAudit = readJson(auditPath);
  let entries;
  let navigationMode = "live";
  try {
    const navigationHtml = await fetchText(sourceUrl);
    entries = parseNavigation(navigationHtml);
    if (entries.length < 500) throw new Error(`Official navigation returned only ${entries.length} entries`);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, "navigation.json"), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  } catch (error) {
    const cachedNavigation = readJson(path.join(outputDirectory, "navigation.json"));
    entries = Array.isArray(cachedNavigation) && cachedNavigation.length >= 500
      ? cachedNavigation
      : navigationFromPreviousAudit(previousAudit);
    navigationMode = "cache";
    if (entries.length < 500) throw error;
    console.warn(`Official navigation is temporarily unavailable; using ${entries.length} cached entries.`);
  }
  const categoryById = new Map(entries.map((entry) => [entry.categoryId, entry]));
  const serverApiEntries = descendants(entries, serverApiCategoryId);
  const documents = serverApiEntries
    .filter((entry) => entry.type === 1 && entry.docId > 0 && entry.status === 2)
    .sort((left, right) => Number(isEntryRelevant(right, categoryById)) - Number(isEntryRelevant(left, categoryById)) || left.pathId - right.pathId);

  if (documents.length < 500) {
    throw new Error(`Official document navigation is incomplete: only ${documents.length} server API documents were found`);
  }

  const previousDocuments = new Map((previousAudit?.documents || []).map((document) => [document.pathId, document]));
  console.log(`Reading ${documents.length} official Enterprise WeChat server API documents with concurrency ${concurrency} and ${requestDelayMs}ms pacing...`);
  let completed = 0;
  let fetches = 0;
  let rateLimited = false;
  const auditedDocuments = await concurrentMap(documents, concurrency, async (entry) => {
    const previous = previousDocuments.get(entry.pathId);
    if (previous?.readable && !refreshAll) {
      completed += 1;
      return sanitizeCachedDocument(previous);
    }
    if (rateLimited) {
      completed += 1;
      return previous || summarizeDocument(entry, { readable: false, error: "deferred_after_official_rate_limit" }, categoryById);
    }
    if (fetches >= maxFetchesPerRun) {
      completed += 1;
      return previous || summarizeDocument(entry, { readable: false, error: "deferred_by_run_fetch_budget" }, categoryById);
    }
    fetches += 1;
    await sleep(requestDelayMs);
    const result = await fetchDocument(entry).catch((error) => {
      if (error instanceof OfficialRateLimitError) rateLimited = true;
      return {
        readable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    });
    completed += 1;
    if (completed % 25 === 0 || completed === documents.length) {
      console.log(`Read ${completed}/${documents.length}`);
    }
    return summarizeDocument(entry, result, categoryById);
  });

  const codeInventory = inventoryImplementedEndpoints(path.join(projectRoot, "apps"));
  const officialEndpointIndex = indexOfficialEndpoints(auditedDocuments);
  const relevantDocuments = auditedDocuments.filter((document) => document.relevantToCustomerService);
  const relevantEndpoints = uniqueSorted(relevantDocuments.flatMap((document) => document.endpoints));
  const implementedEndpointSet = new Set(codeInventory.map((item) => item.endpoint));
  const implementedRelevantEndpoints = relevantEndpoints.filter((endpoint) => implementedEndpointSet.has(endpoint));
  const missingRelevantEndpoints = relevantEndpoints.filter((endpoint) => !implementedEndpointSet.has(endpoint));
  const undocumentedCodeEndpoints = codeInventory.filter((item) => !officialEndpointIndex.has(item.endpoint));

  const categorySummary = summarizeCategories(auditedDocuments);
  const result = {
    schemaVersion: 1,
    source: {
      navigation: sourceUrl,
      documentEndpoint,
      fetchedAt: startedAt,
      rootCategoryId: serverApiCategoryId,
      navigationMode,
      rateLimited,
      fetches,
      maxFetchesPerRun,
    },
    totals: {
      officialDocuments: auditedDocuments.length,
      readableDocuments: auditedDocuments.filter((document) => document.readable).length,
      unavailableDocuments: auditedDocuments.filter((document) => !document.readable).length,
      officialEndpoints: officialEndpointIndex.size,
      customerServiceDocuments: relevantDocuments.length,
      customerServiceEndpoints: relevantEndpoints.length,
      implementedCodeEndpoints: codeInventory.length,
      implementedRelevantEndpoints: implementedRelevantEndpoints.length,
      missingRelevantEndpoints: missingRelevantEndpoints.length,
    },
    proofBoundary: "Documentation and source coverage do not prove Enterprise WeChat acceptance or customer-phone receipt.",
    categorySummary,
    implementedRelevantEndpoints,
    missingRelevantEndpoints,
    undocumentedCodeEndpoints,
    codeInventory,
    documents: auditedDocuments,
  };

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(auditPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDirectory, "summary.md"), renderMarkdown(result), "utf8");
  console.log(`Wrote ${path.join(outputDirectory, "summary.md")}`);
  console.log(JSON.stringify(result.totals, null, 2));
}

function parseNavigation(html) {
  const pattern = /\{"id":(\d+),"category_id":(\d+),"doc_id":(\d+),"parent_id":(\d+),"time":(\d+),(?:"author":"[^"]*",)?"type":(\d+),"status":(\d+),"title":"((?:\\.|[^"\\])*)"/g;
  const unique = new Map();
  for (const match of html.matchAll(pattern)) {
    const entry = {
      pathId: Number(match[1]),
      categoryId: Number(match[2]),
      docId: Number(match[3]),
      parentId: Number(match[4]),
      navigationTime: Number(match[5]),
      type: Number(match[6]),
      status: Number(match[7]),
      title: JSON.parse(`"${match[8]}"`),
    };
    if (!unique.has(entry.categoryId)) unique.set(entry.categoryId, entry);
  }
  return [...unique.values()];
}

function descendants(entries, rootCategoryId) {
  const result = [];
  const queue = [rootCategoryId];
  const visited = new Set(queue);
  while (queue.length) {
    const parentId = queue.shift();
    for (const entry of entries) {
      if (entry.parentId !== parentId || visited.has(entry.categoryId)) continue;
      visited.add(entry.categoryId);
      queue.push(entry.categoryId);
      result.push(entry);
    }
  }
  return result;
}

async function fetchDocument(entry) {
  const body = new URLSearchParams({ doc_id: String(entry.docId) });
  const response = await fetchWithTimeout(documentEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: `https://developer.work.weixin.qq.com/document/path/${entry.pathId}`,
      "user-agent": "Smart-Kefu-WeCom-Documentation-Audit/1.0",
    },
    body,
  });
  if (response.status === 429) throw new OfficialRateLimitError(`Document ${entry.pathId} returned HTTP 429`);
  if (!response.ok) throw new Error(`Document ${entry.pathId} returned HTTP ${response.status}`);
  const payload = await response.json();
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    const message = payload?.result?.humanMessage || "Official document response did not contain data";
    if (/人机验证|频率|too many|rate limit/i.test(message)) throw new OfficialRateLimitError(message);
    return { readable: false, error: message };
  }
  if (data.needLogin || data.denied) {
    return { readable: false, error: data.needLogin ? "login_required" : "permission_denied" };
  }
  return {
    readable: true,
    title: String(data.title || entry.title),
    updatedAtUnix: Number(data.time || 0) || null,
    html: String(data.content_html_v2 || data.content_html || ""),
  };
}

class OfficialRateLimitError extends Error {}

function summarizeDocument(entry, result, categoryById) {
  const categoryPath = buildCategoryPath(entry, categoryById);
  const relevantToCustomerService = isEntryRelevant(entry, categoryById);
  if (!result.readable) {
    return {
      pathId: entry.pathId,
      docId: entry.docId,
      title: entry.title,
      url: `https://developer.work.weixin.qq.com/document/path/${entry.pathId}`,
      categoryPath,
      relevantToCustomerService,
      readable: false,
      error: result.error,
      endpoints: [],
      eventValues: [],
      permissionSignals: [],
      contentHash: null,
    };
  }

  const decoded = decodeHtmlEntities(result.html);
  const plainText = htmlToText(decoded);
  return {
    pathId: entry.pathId,
    docId: entry.docId,
    title: result.title,
    url: `https://developer.work.weixin.qq.com/document/path/${entry.pathId}`,
    categoryPath,
    relevantToCustomerService,
    readable: true,
    updatedAt: result.updatedAtUnix ? new Date(result.updatedAtUnix * 1000).toISOString() : null,
    contentLength: result.html.length,
    contentHash: crypto.createHash("sha256").update(result.html).digest("hex"),
    endpoints: extractEndpoints(decoded),
    eventValues: extractEventValues(decoded),
    permissionSignals: extractPermissionSignals(plainText),
    proofSignals: {
      requiresMemberAction: /需要成员|需成员|成员确认|接待人员确认|管理员确认/.test(plainText),
      hasCallback: /回调|事件通知|接收事件服务器/.test(plainText),
      hasRateOrFrequencyLimit: /频率限制|频率超过|每分钟|每小时|每天|每月|上限/.test(plainText),
      mentionsCustomerReceipt: /客户收到|客户侧|微信客户端|企业微信客户端/.test(plainText),
    },
  };
}

function buildCategoryPath(entry, categoryById) {
  const pathItems = [];
  let current = entry;
  const visited = new Set();
  while (current && !visited.has(current.categoryId)) {
    visited.add(current.categoryId);
    pathItems.unshift({ categoryId: current.categoryId, title: current.title });
    current = categoryById.get(current.parentId);
  }
  return pathItems;
}

function extractEndpoints(content) {
  const endpoints = [];
  for (const match of content.matchAll(/\/cgi-bin\/[A-Za-z0-9_./-]+/g)) {
    const endpoint = normalizeEndpoint(match[0]);
    if (!endpoint.startsWith("/cgi-bin/crm/") && !endpoint.endsWith("/")) endpoints.push(endpoint);
  }
  return uniqueSorted(endpoints);
}

function sanitizeCachedDocument(document) {
  return {
    ...document,
    endpoints: uniqueSorted((document.endpoints || []).filter((endpoint) => (
      !String(endpoint).startsWith("/cgi-bin/crm/") && !String(endpoint).endsWith("/")
    ))),
  };
}

function isEntryRelevant(entry, categoryById) {
  const categoryPath = buildCategoryPath(entry, categoryById);
  return categoryPath.some((item) => relevantCategoryIds.has(item.categoryId))
    || entry.title === "获取access_token"
    || entry.title.includes("临时素材")
    || entry.title === "获取成员";
}

function navigationFromPreviousAudit(previousAudit) {
  if (!Array.isArray(previousAudit?.documents)) return [];
  const entries = new Map();
  for (const document of previousAudit.documents) {
    const categoryPath = Array.isArray(document.categoryPath) ? document.categoryPath : [];
    categoryPath.forEach((item, index) => {
      const isDocument = index === categoryPath.length - 1;
      const parent = categoryPath[index - 1];
      const entry = {
        pathId: isDocument ? Number(document.pathId) : Number(item.categoryId),
        categoryId: Number(item.categoryId),
        docId: isDocument ? Number(document.docId) : 0,
        parentId: parent ? Number(parent.categoryId) : 0,
        navigationTime: 0,
        type: isDocument ? 1 : 0,
        status: 2,
        title: String(item.title || document.title || ""),
      };
      if (!entries.has(entry.categoryId) || isDocument) entries.set(entry.categoryId, entry);
    });
  }
  return [...entries.values()];
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function extractEventValues(content) {
  const values = [];
  const patterns = [
    /<(?:Event|ChangeType)>\s*<!\[CDATA\[([^\]]+)\]\]>\s*<\/(?:Event|ChangeType)>/gi,
    /"(?:event|change_type|event_type)"\s*:\s*"([a-z0-9_-]+)"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) values.push(String(match[1]).trim());
  }
  return uniqueSorted(values);
}

function extractPermissionSignals(plainText) {
  const signals = new Set();
  if (/自建应用/.test(plainText)) signals.add("self_built_app");
  if (/可调用接口的应用|可调用应用/.test(plainText)) signals.add("callable_app_configuration");
  if (/可见范围/.test(plainText)) signals.add("application_visibility_scope");
  if (/客户联系功能的成员|使用范围/.test(plainText)) signals.add("customer_contact_member_scope");
  if (/可信IP|可信 IP|IP白名单|IP 白名单/.test(plainText)) signals.add("trusted_ip");
  if (/管理员/.test(plainText)) signals.add("administrator_action");
  if (/客户基础信息/.test(plainText)) signals.add("customer_basic_information_permission");
  return [...signals].sort();
}

function inventoryImplementedEndpoints(root) {
  const findings = new Map();
  for (const file of walkFiles(root)) {
    if (!/\.(?:js|jsx|ts|tsx)$/.test(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/\/cgi-bin\/[A-Za-z0-9_./-]+/g)) {
      const endpoint = normalizeEndpoint(match[0]);
      const item = findings.get(endpoint) || { endpoint, files: [] };
      const relativeFile = path.relative(projectRoot, file).replaceAll("\\", "/");
      if (!item.files.includes(relativeFile)) item.files.push(relativeFile);
      findings.set(endpoint, item);
    }
  }
  return [...findings.values()].sort((left, right) => left.endpoint.localeCompare(right.endpoint));
}

function walkFiles(root) {
  const result = [];
  const queue = [root];
  const excluded = new Set(["node_modules", ".next", "dist", "release", "out", ".runtime", ".package-runtime"]);
  while (queue.length) {
    const current = queue.shift();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile()) result.push(fullPath);
    }
  }
  return result;
}

function indexOfficialEndpoints(documents) {
  const index = new Map();
  for (const document of documents) {
    for (const endpoint of document.endpoints) {
      const docs = index.get(endpoint) || [];
      docs.push({ pathId: document.pathId, title: document.title, url: document.url });
      index.set(endpoint, docs);
    }
  }
  return index;
}

function summarizeCategories(documents) {
  const counts = new Map();
  for (const document of documents) {
    const serverApiIndex = document.categoryPath.findIndex((item) => item.categoryId === serverApiCategoryId);
    const category = document.categoryPath[serverApiIndex + 1] || document.categoryPath[0];
    const key = category ? `${category.categoryId}:${category.title}` : "unknown";
    const item = counts.get(key) || { categoryId: category?.categoryId || null, title: category?.title || "unknown", documents: 0, endpoints: new Set() };
    item.documents += 1;
    document.endpoints.forEach((endpoint) => item.endpoints.add(endpoint));
    counts.set(key, item);
  }
  return [...counts.values()]
    .map((item) => ({ categoryId: item.categoryId, title: item.title, documents: item.documents, endpoints: item.endpoints.size }))
    .sort((left, right) => right.documents - left.documents || left.title.localeCompare(right.title));
}

function renderMarkdown(result) {
  const lines = [
    "# 企业微信官方服务端 API 审计",
    "",
    `- 官方目录：${result.source.navigation}`,
    `- 抓取时间：${result.source.fetchedAt}`,
    `- 官方文档：${result.totals.officialDocuments} 篇（可读 ${result.totals.readableDocuments}，受限 ${result.totals.unavailableDocuments}）`,
    `- 官方接口路径：${result.totals.officialEndpoints} 个`,
    `- 微信客服/客户联系相关文档：${result.totals.customerServiceDocuments} 篇`,
    `- 微信客服/客户联系相关接口：${result.totals.customerServiceEndpoints} 个`,
    `- 当前代码接口：${result.totals.implementedCodeEndpoints} 个`,
    `- 已覆盖相关接口：${result.totals.implementedRelevantEndpoints} 个`,
    `- 未覆盖相关接口：${result.totals.missingRelevantEndpoints} 个`,
    "",
    "> 文档读取与代码覆盖不等于企业微信接口受理，也不等于客户手机收到。真实验收必须保留回调、发送审计和客户手机证据。",
    "",
    "## 当前代码已调用的相关接口",
    "",
    ...result.implementedRelevantEndpoints.map((endpoint) => `- \`${endpoint}\``),
    "",
    "## 相关但当前代码未调用的接口",
    "",
    ...result.missingRelevantEndpoints.map((endpoint) => `- \`${endpoint}\``),
    "",
    "## 官方一级目录统计",
    "",
    "| 目录 | 文档 | 接口路径 |",
    "| --- | ---: | ---: |",
    ...result.categorySummary.map((item) => `| ${escapeMarkdown(item.title)} | ${item.documents} | ${item.endpoints} |`),
    "",
    "## 代码中未在当前官方目录匹配的接口",
    "",
    ...(result.undocumentedCodeEndpoints.length
      ? result.undocumentedCodeEndpoints.map((item) => `- \`${item.endpoint}\` (${item.files.join(", ")})`)
      : ["- 无"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function normalizeEndpoint(value) {
  return String(value || "").split("?")[0].replace(/[),.;:'\"]+$/g, "");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ");
}

function htmlToText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeMarkdown(value) {
  return String(value || "").replaceAll("|", "\\|");
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Smart-Kefu-WeCom-Documentation-Audit/1.0" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function concurrentMap(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
