"use strict";

const ISSUE_REPAIR_GUIDE = {
  missing_sku_code: { field: "skuCode", label: "SKU编号", priority: 100, action: "补 SKU 编号，否则无法绑定库存、报价和设计任务" },
  missing_name: { field: "name", label: "商品名称", priority: 95, action: "补商品名称，方便客服识别和对客报价" },
  invalid_sale_price: { field: "salePrice", label: "售价", priority: 90, action: "补正确售价，售价必须大于 0 才能参与预算搭配" },
  negative_margin: { field: "costPrice", label: "成本价/售价", priority: 80, action: "核对成本价和售价，避免系统推荐亏损组合" },
  missing_main_image: { field: "mainImagePath", label: "商品主图", priority: 75, action: "上传真实商品主图，设计出图必须用真实 SKU 图片" },
  invalid_main_image_type: { field: "mainImagePath", label: "商品主图", priority: 76, action: "重新上传主图，当前主图不像图片文件" },
  local_main_image_missing: { field: "mainImagePath", label: "商品主图", priority: 75, action: "重新上传主图，当前本地图片路径已经失效" },
  invalid_angle_image_type: { field: "angleImages", label: "多角度图", priority: 48, action: "删除或重新上传异常多角度图，保留真实商品图片" },
  local_angle_image_missing: { field: "angleImages", label: "多角度图", priority: 46, action: "重新上传失效的多角度图，避免设计平台拿不到商品细节" },
  missing_supplier: { field: "supplier", label: "供应商", priority: 62, action: "补供应商，方便采购、补货和售后追踪" },
  missing_scene_tags: { field: "sceneTags", label: "场景标签", priority: 60, action: "补适用场景，比如员工福利、客户拜访、节日礼赠" },
  out_of_stock: { field: "stock", label: "库存", priority: 58, action: "补库存或下架，避免推荐无法交付的商品" },
  low_stock: { field: "stock", label: "库存", priority: 35, action: "确认库存是否足够，不足时补替代 SKU" },
  missing_dimensions: { field: "dimensions", label: "尺寸", priority: 25, action: "补长宽高，方便礼盒包装和物流判断" },
  missing_weight: { field: "weightGram", label: "重量", priority: 20, action: "补重量，方便估算物流和交付成本" },
};

function auditSkuCatalog(skus = [], options = {}) {
  const lowStockThreshold = Number(options.lowStockThreshold || 10);
  const issues = [];

  for (const sku of Array.isArray(skus) ? skus : []) {
    const salePrice = Number(sku.salePrice || 0);
    const costPrice = Number(sku.costPrice || 0);
    const stock = Number(sku.stock || 0);
    const sceneTags = Array.isArray(sku.sceneTags) ? sku.sceneTags : [];
    const dimensions = sku.dimensions && typeof sku.dimensions === "object" ? sku.dimensions : {};

    if (!sku.skuCode) addIssue(issues, sku, "error", "missing_sku_code", "缺少 SKU 编号");
    if (!sku.name) addIssue(issues, sku, "error", "missing_name", "缺少商品名称");
    if (!salePrice || salePrice <= 0) addIssue(issues, sku, "error", "invalid_sale_price", "售价必须大于 0");
    if (salePrice > 0 && costPrice > salePrice) addIssue(issues, sku, "warning", "negative_margin", "成本高于售价");
    if (!sku.mainImagePath) {
      addIssue(issues, sku, "warning", "missing_main_image", "缺少商品主图", {
        field: "mainImagePath",
        imageRole: "main",
        path: "",
      });
    } else if (sku.mainImageInvalidType) {
      addIssue(issues, sku, "warning", "invalid_main_image_type", "商品主图不是支持的图片格式", {
        field: "mainImagePath",
        imageRole: "main",
        path: sku.mainImagePath,
      });
    } else if (sku.mainImageFileMissing) {
      addIssue(issues, sku, "warning", "local_main_image_missing", "商品主图文件不存在", {
        field: "mainImagePath",
        imageRole: "main",
        path: sku.mainImagePath,
      });
    }
    for (const imageIssue of Array.isArray(sku.angleImageIssues) ? sku.angleImageIssues : []) {
      if (imageIssue.invalidType) {
        addIssue(issues, sku, "warning", "invalid_angle_image_type", `多角度图不是支持的图片格式：${imageIssue.path || imageIssue.index + 1}`, {
          field: "angleImages",
          imageRole: "angle",
          imageIndex: imageIssue.index,
          path: imageIssue.path || "",
        });
      } else if (imageIssue.fileMissing) {
        addIssue(issues, sku, "warning", "local_angle_image_missing", `多角度图文件不存在：${imageIssue.path || imageIssue.index + 1}`, {
          field: "angleImages",
          imageRole: "angle",
          imageIndex: imageIssue.index,
          path: imageIssue.path || "",
        });
      }
    }
    if (!sku.supplier) addIssue(issues, sku, "warning", "missing_supplier", "缺少供应商");
    if (!sceneTags.length) addIssue(issues, sku, "warning", "missing_scene_tags", "缺少适用场景标签");
    if (!stock) addIssue(issues, sku, "warning", "out_of_stock", "库存为 0");
    else if (stock <= lowStockThreshold) addIssue(issues, sku, "info", "low_stock", `库存不高于 ${lowStockThreshold}`);
    if (!Object.keys(dimensions).length) addIssue(issues, sku, "info", "missing_dimensions", "缺少尺寸");
    if (!sku.weightGram) addIssue(issues, sku, "info", "missing_weight", "缺少重量");
  }

  const issueSkuCodes = new Set(issues.filter((issue) => issue.severity !== "info").map((issue) => issue.skuCode));
  const repairQueue = buildSkuRepairQueue(skus, issues);
  const imageProblems = buildSkuImageProblems(issues);
  return {
    total: Array.isArray(skus) ? skus.length : 0,
    readyCount: Math.max(0, (Array.isArray(skus) ? skus.length : 0) - issueSkuCodes.size),
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length,
    missingImageCount: issues.filter((issue) => ["missing_main_image", "local_main_image_missing", "invalid_main_image_type"].includes(issue.code)).length,
    imageIssueCount: issues.filter((issue) =>
      ["missing_main_image", "local_main_image_missing", "invalid_main_image_type", "invalid_angle_image_type", "local_angle_image_missing"].includes(issue.code),
    ).length,
    invalidImageCount: issues.filter((issue) => ["invalid_main_image_type", "invalid_angle_image_type"].includes(issue.code)).length,
    missingAngleImageCount: issues.filter((issue) => issue.code === "local_angle_image_missing").length,
    imageProblems,
    lowStockCount: issues.filter((issue) => ["low_stock", "out_of_stock"].includes(issue.code)).length,
    negativeMarginCount: issues.filter((issue) => issue.code === "negative_margin").length,
    repairQueueCount: repairQueue.length,
    blockingRepairCount: repairQueue.filter((item) => item.blocking).length,
    repairQueue,
    issues,
  };
}

function addIssue(issues, sku, severity, code, message, details = {}) {
  issues.push({
    skuCode: sku.skuCode || "",
    name: sku.name || "",
    severity,
    code,
    message,
    ...details,
  });
}

function buildSkuImageProblems(issues = []) {
  return issues
    .filter((issue) => ["missing_main_image", "local_main_image_missing", "invalid_main_image_type", "invalid_angle_image_type", "local_angle_image_missing"].includes(issue.code))
    .map((issue) => ({
      skuCode: issue.skuCode || "",
      name: issue.name || "",
      code: issue.code,
      message: issue.message,
      field: issue.field || (issue.code.includes("angle") ? "angleImages" : "mainImagePath"),
      imageRole: issue.imageRole || (issue.code.includes("angle") ? "angle" : "main"),
      imageIndex: issue.imageIndex ?? null,
      path: issue.path || "",
      severity: issue.severity,
    }));
}

function buildSkuRepairQueue(skus = [], issues = []) {
  const skuByKey = new Map();
  for (const sku of Array.isArray(skus) ? skus : []) {
    if (sku.skuCode) skuByKey.set(sku.skuCode, sku);
    if (sku.name) skuByKey.set(sku.name, sku);
  }

  const issueGroups = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const key = issue.skuCode || issue.name;
    if (!key) continue;
    issueGroups.set(key, [...(issueGroups.get(key) || []), issue]);
  }

  return [...issueGroups.entries()]
    .map(([key, group]) => {
      const sku = skuByKey.get(key) || {};
      const sortedIssues = group.slice().sort(compareIssuePriority);
      const topIssue = sortedIssues[0];
      const fields = [...new Map(sortedIssues.map((issue) => {
        const guide = ISSUE_REPAIR_GUIDE[issue.code] || { field: issue.code, label: issue.message, priority: 10, action: issue.message };
        return [guide.field, { field: guide.field, label: guide.label, action: guide.action }];
      })).values()];
      return {
        skuCode: sku.skuCode || topIssue.skuCode || "",
        name: sku.name || topIssue.name || "",
        type: sku.type || "",
        severity: highestSeverity(sortedIssues),
        priority: issuePriority(topIssue),
        blocking: sortedIssues.some((issue) => ["error", "warning"].includes(issue.severity)),
        issueCount: sortedIssues.length,
        missingFields: fields,
        recommendedAction: fields[0]?.action || topIssue.message,
        issues: sortedIssues,
      };
    })
    .sort((a, b) => b.priority - a.priority || Number(b.blocking) - Number(a.blocking) || String(a.skuCode || a.name).localeCompare(String(b.skuCode || b.name)));
}

function compareIssuePriority(a, b) {
  return issuePriority(b) - issuePriority(a) || severityRank(b.severity) - severityRank(a.severity);
}

function issuePriority(issue) {
  return ISSUE_REPAIR_GUIDE[issue.code]?.priority || severityRank(issue.severity) * 10;
}

function highestSeverity(issues) {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  return "info";
}

function severityRank(severity) {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function isLikelyImageBuffer(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length < 4) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return true;
  const ascii12 = bytes.subarray(0, Math.min(bytes.length, 12)).toString("ascii");
  if (ascii12.startsWith("GIF87a") || ascii12.startsWith("GIF89a")) return true;
  if (ascii12.startsWith("BM")) return true;
  if (bytes.length >= 12 && ascii12.startsWith("RIFF") && ascii12.slice(8, 12) === "WEBP") return true;
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();
    if (["avif", "avis"].includes(brand)) return true;
  }
  const text = bytes.subarray(0, Math.min(bytes.length, 512)).toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return true;
  return false;
}

module.exports = {
  auditSkuCatalog,
  buildSkuRepairQueue,
  isLikelyImageBuffer,
};
