"use strict";

const IMAGE_ISSUE_CODES = [
  "missing_main_image",
  "local_main_image_missing",
  "invalid_main_image_type",
  "invalid_angle_image_type",
  "local_angle_image_missing",
];

const NON_BLOCKING_REPAIR_CODES = new Set([
  "duplicate_name",
  "invalid_angle_image_type",
  "invalid_replacement_sku",
  "local_angle_image_missing",
  "missing_supplier",
  "missing_scene_tags",
  "low_stock",
  "long_lead_time",
  "missing_dimensions",
  "incomplete_dimensions",
  "invalid_dimensions",
  "missing_weight",
  "invalid_weight",
  "self_replacement_sku",
]);

const ISSUE_REPAIR_GUIDE = {
  missing_sku_code: { field: "skuCode", label: "SKU编号", priority: 100, action: "补 SKU 编号，否则无法绑定库存、报价和设计任务" },
  duplicate_sku_code: { field: "skuCode", label: "SKU编号", priority: 98, action: "合并或重命名重复 SKU，避免库存、报价和出图绑定到错误商品" },
  unsafe_sku_code: { field: "skuCode", label: "SKU编号", priority: 88, action: "SKU 建议只用大写字母、数字、中横线、下划线和点号，避免自动匹配失败" },
  sku_code_whitespace: { field: "skuCode", label: "SKU编号", priority: 86, action: "删除 SKU 编号首尾空格，避免导入、替代品和搭配规则匹配不上" },
  missing_name: { field: "name", label: "商品名称", priority: 95, action: "补商品名称，方便客服识别和对客户报价" },
  missing_sku_type: { field: "type", label: "商品类型", priority: 92, action: "补商品类型，只能是礼盒、内搭或配件，否则自动搭配会分错商品角色" },
  invalid_sku_type: { field: "type", label: "商品类型", priority: 92, action: "商品类型只能是 gift_box、item、accessory，请改成礼盒、内搭或配件" },
  invalid_sale_price: { field: "salePrice", label: "售价", priority: 90, action: "补正确售价，售价必须大于 0 才能参与预算搭配" },
  invalid_cost_price: { field: "costPrice", label: "成本价", priority: 82, action: "补正确成本价，否则利润、报价和高价值判断都会不准" },
  negative_margin: { field: "costPrice", label: "成本价/售价", priority: 80, action: "核对成本价和售价，避免系统推荐亏损组合" },
  low_margin_rate: { field: "costPrice", label: "毛利率", priority: 32, action: "毛利率较低，自动报价前建议人工确认是否有足够利润空间" },
  duplicate_name: { field: "name", label: "商品名称", priority: 72, action: "核对同名商品是否真的是同一款，必要时在名称中加入规格、颜色或供应商" },
  invalid_replacement_sku: { field: "replacementSkuCodes", label: "替代 SKU", priority: 68, action: "替代 SKU 不存在，请改成商品库里真实存在的 SKU，否则库存不足时无法自动替换" },
  self_replacement_sku: { field: "replacementSkuCodes", label: "替代 SKU", priority: 45, action: "替代 SKU 不能指向自己，请填写另一款可替代商品" },
  invalid_matching_rule_sku: { field: "matchingRules", label: "搭配规则", priority: 66, action: "搭配规则引用了不存在的 SKU，请改成商品库里真实存在的 SKU" },
  self_matching_rule_sku: { field: "matchingRules", label: "搭配规则", priority: 42, action: "搭配规则不需要引用自己，请删除自指 SKU" },
  missing_main_image: { field: "mainImagePath", label: "商品主图", priority: 75, action: "上传真实商品主图，设计出图必须用真实 SKU 图片" },
  invalid_main_image_type: { field: "mainImagePath", label: "商品主图", priority: 76, action: "重新上传主图，当前主图不像图片文件" },
  local_main_image_missing: { field: "mainImagePath", label: "商品主图", priority: 75, action: "重新上传主图，当前本地图片路径已经失效" },
  invalid_angle_image_type: { field: "angleImages", label: "多角度图", priority: 48, action: "删除或重新上传异常多角度图，保留真实商品图片" },
  local_angle_image_missing: { field: "angleImages", label: "多角度图", priority: 46, action: "重新上传失效的多角度图，避免设计平台拿不到商品细节" },
  missing_supplier: { field: "supplier", label: "供应商", priority: 62, action: "补供应商，方便采购、补货和售后追踪" },
  missing_scene_tags: { field: "sceneTags", label: "场景标签", priority: 60, action: "补适用场景，比如员工福利、客户拜访、节日礼赠" },
  out_of_stock: { field: "stock", label: "库存", priority: 58, action: "补库存或下架，避免推荐无法交付的商品" },
  low_stock: { field: "stock", label: "库存", priority: 35, action: "确认库存是否足够，不足时补替代 SKU" },
  invalid_lead_time: { field: "leadTimeDays", label: "交期", priority: 38, action: "交期必须大于 0 天，请核对供应商交付周期" },
  long_lead_time: { field: "leadTimeDays", label: "交期", priority: 18, action: "交期较长，报价和回复客户前需要人工确认是否能接受" },
  missing_dimensions: { field: "dimensions", label: "尺寸", priority: 25, action: "补长宽高，方便礼盒包装和物流判断" },
  incomplete_dimensions: { field: "dimensions", label: "尺寸", priority: 24, action: "补完整长宽高，避免礼盒包装、摆拍比例和物流判断不准" },
  invalid_dimensions: { field: "dimensions", label: "尺寸", priority: 40, action: "尺寸必须大于 0，请核对商品规格" },
  missing_weight: { field: "weightGram", label: "重量", priority: 20, action: "补重量，方便估算物流和交付成本" },
  invalid_weight: { field: "weightGram", label: "重量", priority: 36, action: "重量必须大于 0，请核对商品克重或物流重量" },
};

function auditSkuCatalog(skus = [], options = {}) {
  const lowStockThreshold = Number(options.lowStockThreshold || 10);
  const skuList = Array.isArray(skus) ? skus : [];
  const issues = [];
  const duplicateSkuCodes = duplicateValues(skuList.map((sku) => sku.skuCode));
  const duplicateNames = duplicateValues(skuList.map((sku) => sku.name));
  const skuCodeSet = new Set(skuList.map((sku) => normalizeDuplicateValue(sku.skuCode)).filter(Boolean));

  for (const [index, sku] of skuList.entries()) {
    const rowKey = `sku-${index}`;
    const addSkuIssue = (severity, code, message, details = {}) => addIssue(issues, sku, severity, code, message, { rowKey, ...details });
    const salePrice = Number(sku.salePrice || 0);
    const costPrice = Number(sku.costPrice || 0);
    const stock = Number(sku.stock || 0);
    const sceneTags = Array.isArray(sku.sceneTags) ? sku.sceneTags : [];
    const dimensions = sku.dimensions && typeof sku.dimensions === "object" ? sku.dimensions : {};

    if (sku.skuCode && duplicateSkuCodes.has(normalizeDuplicateValue(sku.skuCode))) {
      addSkuIssue("error", "duplicate_sku_code", `SKU 编号重复：${sku.skuCode}`, { field: "skuCode" });
    }
    if (sku.skuCode && sku.skuCode !== String(sku.skuCode).trim()) {
      addSkuIssue("warning", "sku_code_whitespace", `SKU 编号含首尾空格：${sku.skuCode}`, { field: "skuCode" });
    }
    if (sku.skuCode && !isSafeSkuCode(sku.skuCode)) {
      addSkuIssue("warning", "unsafe_sku_code", `SKU 编号含不建议字符：${sku.skuCode}`, { field: "skuCode" });
    }
    if (sku.name && duplicateNames.has(normalizeDuplicateValue(sku.name))) {
      addSkuIssue("warning", "duplicate_name", `商品名称重复：${sku.name}`, { field: "name" });
    }
    if (!sku.skuCode) addSkuIssue("error", "missing_sku_code", "缺少 SKU 编号");
    if (!sku.name) addSkuIssue("error", "missing_name", "缺少商品名称");
    if (!sku.type) addSkuIssue("error", "missing_sku_type", "缺少商品类型", { field: "type" });
    else if (!["gift_box", "item", "accessory"].includes(String(sku.type))) {
      addSkuIssue("error", "invalid_sku_type", `商品类型无效：${sku.type}`, { field: "type" });
    }
    if (!salePrice || salePrice <= 0) addSkuIssue("error", "invalid_sale_price", "售价必须大于 0");
    if (salePrice > 0 && costPrice <= 0) addSkuIssue("warning", "invalid_cost_price", "成本价必须大于 0", { field: "costPrice" });
    if (salePrice > 0 && costPrice > salePrice) addSkuIssue("warning", "negative_margin", "成本高于售价", { field: "costPrice" });
    if (salePrice > 0 && costPrice > 0 && costPrice <= salePrice) {
      const marginRate = (salePrice - costPrice) / salePrice;
      if (marginRate < 0.15) addSkuIssue("info", "low_margin_rate", `毛利率低于 15%：${Math.round(marginRate * 100)}%`, { field: "costPrice" });
    }
    for (const replacementCode of Array.isArray(sku.replacementSkuCodes) ? sku.replacementSkuCodes : []) {
      const normalizedReplacement = normalizeDuplicateValue(replacementCode);
      if (!normalizedReplacement) continue;
      if (normalizedReplacement === normalizeDuplicateValue(sku.skuCode)) {
        addSkuIssue("warning", "self_replacement_sku", `替代 SKU 指向自己：${replacementCode}`, { field: "replacementSkuCodes" });
      } else if (!skuCodeSet.has(normalizedReplacement)) {
        addSkuIssue("warning", "invalid_replacement_sku", `替代 SKU 不存在：${replacementCode}`, { field: "replacementSkuCodes" });
      }
    }
    for (const ruleRef of collectMatchingRuleSkuCodes(sku.matchingRules)) {
      const normalizedRuleSku = normalizeDuplicateValue(ruleRef.skuCode);
      if (!normalizedRuleSku) continue;
      if (normalizedRuleSku === normalizeDuplicateValue(sku.skuCode)) {
        addSkuIssue("info", "self_matching_rule_sku", `搭配规则 ${ruleRef.key} 指向自己：${ruleRef.skuCode}`, { field: "matchingRules" });
      } else if (!skuCodeSet.has(normalizedRuleSku)) {
        addSkuIssue("warning", "invalid_matching_rule_sku", `搭配规则 ${ruleRef.key} 引用了不存在的 SKU：${ruleRef.skuCode}`, { field: "matchingRules" });
      }
    }
    if (!sku.mainImagePath) {
      addSkuIssue("warning", "missing_main_image", "缺少商品主图", {
        field: "mainImagePath",
        imageRole: "main",
        path: "",
      });
    } else if (sku.mainImageInvalidType) {
      addSkuIssue("warning", "invalid_main_image_type", "商品主图不是支持的图片格式", {
        field: "mainImagePath",
        imageRole: "main",
        path: sku.mainImagePath,
      });
    } else if (sku.mainImageFileMissing) {
      addSkuIssue("warning", "local_main_image_missing", "商品主图文件不存在", {
        field: "mainImagePath",
        imageRole: "main",
        path: sku.mainImagePath,
      });
    }
    for (const imageIssue of Array.isArray(sku.angleImageIssues) ? sku.angleImageIssues : []) {
      if (imageIssue.invalidType) {
        addSkuIssue("warning", "invalid_angle_image_type", `多角度图不是支持的图片格式：${imageIssue.path || Number(imageIssue.index || 0) + 1}`, {
          field: "angleImages",
          imageRole: "angle",
          imageIndex: imageIssue.index,
          path: imageIssue.path || "",
        });
      } else if (imageIssue.fileMissing) {
        addSkuIssue("warning", "local_angle_image_missing", `多角度图文件不存在：${imageIssue.path || Number(imageIssue.index || 0) + 1}`, {
          field: "angleImages",
          imageRole: "angle",
          imageIndex: imageIssue.index,
          path: imageIssue.path || "",
        });
      }
    }
    if (!sku.supplier) addSkuIssue("warning", "missing_supplier", "缺少供应商");
    if (!sceneTags.length) addSkuIssue("warning", "missing_scene_tags", "缺少适用场景标签");
    if (!stock) addSkuIssue("warning", "out_of_stock", "库存为 0");
    else if (stock <= lowStockThreshold) addSkuIssue("info", "low_stock", `库存不高于 ${lowStockThreshold}`);
    if (sku.leadTimeDays !== undefined && sku.leadTimeDays !== null && sku.leadTimeDays !== "") {
      const leadTimeDays = Number(sku.leadTimeDays);
      if (!Number.isFinite(leadTimeDays) || leadTimeDays <= 0) {
        addSkuIssue("warning", "invalid_lead_time", "交期必须大于 0 天", { field: "leadTimeDays" });
      } else if (leadTimeDays > 45) {
        addSkuIssue("info", "long_lead_time", `交期较长：${leadTimeDays} 天`, { field: "leadTimeDays" });
      }
    }
    const dimensionIssue = skuDimensionIssue(dimensions);
    if (dimensionIssue === "missing") addSkuIssue("info", "missing_dimensions", "缺少尺寸", { field: "dimensions" });
    if (dimensionIssue === "incomplete") addSkuIssue("info", "incomplete_dimensions", "尺寸不完整，需要长宽高", { field: "dimensions" });
    if (dimensionIssue === "invalid") addSkuIssue("warning", "invalid_dimensions", "尺寸必须大于 0", { field: "dimensions" });
    if (sku.weightGram === undefined || sku.weightGram === null || sku.weightGram === "") {
      addSkuIssue("info", "missing_weight", "缺少重量", { field: "weightGram" });
    } else if (Number(sku.weightGram) <= 0) {
      addSkuIssue("warning", "invalid_weight", "重量必须大于 0", { field: "weightGram" });
    }
  }

  const issueRowKeys = new Set(issues.filter(isBlockingRepairIssue).map((issue) => issue.rowKey || issue.skuCode || issue.name));
  const repairQueue = buildSkuRepairQueue(skuList, issues);
  const imageProblems = buildSkuImageProblems(issues);
  const availableRoleCounts = countAvailableSkuRoles(skuList);
  const catalogStructureIssueCount = Number(availableRoleCounts.giftBoxCount === 0) + Number(availableRoleCounts.itemCount === 0);
  const coverage = summarizeAvailableSkuCoverage(skuList);
  const catalogCoverageIssueCount = Number(coverage.sceneTagCount === 0) + Number(coverage.categoryCount === 0);
  const bundleReadiness = summarizeBundleReadiness(skuList, {
    quantityCheckpoints: normalizeQuantityCheckpoints(options.quantityCheckpoints),
  });
  const budgetBandCoverage = summarizeBudgetBandCoverage(skuList, options);
  const budgetCoverageIssueCount = budgetBandCoverage.filter((band) => !band.available).length;
  const sceneBundleCoverage = summarizeSceneBundleCoverage(skuList, options);
  const sceneBundleCoverageIssueCount = sceneBundleCoverage.filter((scene) => !scene.available).length;
  const bundleMarginRiskCount = [
    ...budgetBandCoverage,
    ...sceneBundleCoverage,
  ].filter((item) => item.available && item.combinationCount > 0 && item.lowMarginCombinationCount >= item.combinationCount).length;
  const bundleDeliveryRiskCount = [
    ...budgetBandCoverage,
    ...sceneBundleCoverage,
  ].filter((item) => item.available && item.combinationCount > 0 && item.deliveryRiskCombinationCount >= item.combinationCount).length;
  const bundleSpecRiskCount = [
    ...budgetBandCoverage,
    ...sceneBundleCoverage,
  ].filter((item) => item.available && item.combinationCount > 0 && item.specReadyCombinationCount <= 0).length;
  const bundleSizeRiskCount = [
    ...budgetBandCoverage,
    ...sceneBundleCoverage,
  ].filter((item) => item.available && item.combinationCount > 0 && item.sizeRiskCombinationCount >= item.combinationCount).length;
  const bundleAutomationRiskCount = [
    ...budgetBandCoverage,
    ...sceneBundleCoverage,
  ].filter((item) => item.available && item.combinationCount > 0 && item.automationReadyCombinationCount <= 0).length;
  const blockingRepairCount = repairQueue.filter((item) => item.blocking).length;
  const commercialReadiness = buildCommercialReadiness({
    total: skuList.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    blockingRepairCount,
    missingImageCount: issues.filter((issue) => ["missing_main_image", "local_main_image_missing", "invalid_main_image_type"].includes(issue.code)).length,
    negativeMarginCount: issues.filter((issue) => ["invalid_cost_price", "negative_margin", "low_margin_rate"].includes(issue.code)).length,
    catalogStructureIssueCount,
    catalogCoverageIssueCount,
    bundleReadiness,
    budgetBandCoverage,
    budgetCoverageIssueCount,
    sceneBundleCoverage,
    sceneBundleCoverageIssueCount,
    bundleMarginRiskCount,
    bundleDeliveryRiskCount,
    bundleSpecRiskCount,
    bundleSizeRiskCount,
    bundleAutomationRiskCount,
  });
  const dataReadiness = options.includeDataReadiness
    ? summarizeSkuDataReadiness(skuList, options.changeLogs)
    : undefined;
  return {
    total: skuList.length,
    readyCount: Math.max(0, skuList.length - issueRowKeys.size),
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length,
    missingImageCount: issues.filter((issue) => ["missing_main_image", "local_main_image_missing", "invalid_main_image_type"].includes(issue.code)).length,
    imageIssueCount: issues.filter((issue) => IMAGE_ISSUE_CODES.includes(issue.code)).length,
    invalidImageCount: issues.filter((issue) => ["invalid_main_image_type", "invalid_angle_image_type"].includes(issue.code)).length,
    missingAngleImageCount: issues.filter((issue) => issue.code === "local_angle_image_missing").length,
    imageProblems,
    lowStockCount: issues.filter((issue) => ["low_stock", "out_of_stock"].includes(issue.code)).length,
    negativeMarginCount: issues.filter((issue) => ["invalid_cost_price", "negative_margin", "low_margin_rate"].includes(issue.code)).length,
    duplicateSkuCodeCount: issues.filter((issue) => issue.code === "duplicate_sku_code").length,
    duplicateNameCount: issues.filter((issue) => issue.code === "duplicate_name").length,
    unsafeSkuCodeCount: issues.filter((issue) => ["unsafe_sku_code", "sku_code_whitespace"].includes(issue.code)).length,
    typeIssueCount: issues.filter((issue) => ["missing_sku_type", "invalid_sku_type"].includes(issue.code)).length,
    invalidReplacementCount: issues.filter((issue) => ["invalid_replacement_sku", "self_replacement_sku"].includes(issue.code)).length,
    invalidMatchingRuleCount: issues.filter((issue) => ["invalid_matching_rule_sku", "self_matching_rule_sku"].includes(issue.code)).length,
    leadTimeIssueCount: issues.filter((issue) => ["invalid_lead_time", "long_lead_time"].includes(issue.code)).length,
    specificationIssueCount: issues.filter((issue) => ["missing_dimensions", "incomplete_dimensions", "invalid_dimensions", "missing_weight", "invalid_weight"].includes(issue.code)).length,
    availableGiftBoxCount: availableRoleCounts.giftBoxCount,
    availableItemCount: availableRoleCounts.itemCount,
    availableAccessoryCount: availableRoleCounts.accessoryCount,
    catalogStructureIssueCount,
    availableSceneTagCount: coverage.sceneTagCount,
    availableCategoryCount: coverage.categoryCount,
    topSceneTags: coverage.topSceneTags,
    topCategories: coverage.topCategories,
    catalogCoverageIssueCount,
    minGiftBoxPrice: bundleReadiness.minGiftBoxPrice,
    minItemPrice: bundleReadiness.minItemPrice,
    minBundleBudget: bundleReadiness.minBundleBudget,
    availableGiftBoxStock: bundleReadiness.availableGiftBoxStock,
    availableItemStock: bundleReadiness.availableItemStock,
    basicBundleCapacity: bundleReadiness.basicBundleCapacity,
    bundleCapacityBottleneck: bundleReadiness.capacityBottleneck,
    bundleCapacityBottleneckLabel: bundleReadiness.capacityBottleneckLabel,
    bundleCapacityChecks: bundleReadiness.capacityChecks,
    bundleCapacityRiskCount: bundleReadiness.capacityRiskCount,
    bundleReadinessIssueCount: bundleReadiness.issueCount,
    bundleReadinessWarnings: bundleReadiness.warnings,
    budgetBandCoverage,
    budgetCoverageIssueCount,
    sceneBundleCoverage,
    sceneBundleCoverageIssueCount,
    bundleMarginRiskCount,
    bundleDeliveryRiskCount,
    bundleSpecRiskCount,
    bundleSizeRiskCount,
    bundleAutomationRiskCount,
    repairQueueCount: repairQueue.length,
    blockingRepairCount,
    commercialReadiness,
    ...(dataReadiness ? { dataReadiness } : {}),
    repairQueue,
    issues,
  };
}

function summarizeSkuDataReadiness(skus = [], changeLogs = []) {
  const activeSkus = (Array.isArray(skus) ? skus : []).filter((sku) => sku?.isActive !== false);
  const operatorSources = new Set(["manual_form", "import_confirm", "manual_create", "manual_upsert", "bulk_import"]);
  const operatorProvidedCodes = new Set(
    (Array.isArray(changeLogs) ? changeLogs : [])
      .filter((log) => operatorSources.has(String(log?.source || "")))
      .map((log) => String(log?.skuCode || "").trim())
      .filter(Boolean),
  );
  const demoImageCodes = new Set(
    activeSkus
      .filter((sku) => [sku?.mainImagePath, ...(Array.isArray(sku?.angleImages) ? sku.angleImages : [])]
        .some(isDemoSkuImageReference))
      .map((sku) => String(sku?.skuCode || "").trim())
      .filter(Boolean),
  );
  const operatorProvidedCount = activeSkus.filter((sku) => operatorProvidedCodes.has(String(sku?.skuCode || "").trim())).length;
  const customerReplyEligibleSkuCodes = activeSkus.filter((sku) => {
    const code = String(sku?.skuCode || "").trim();
    return operatorProvidedCodes.has(code)
      && Boolean(String(sku?.mainImagePath || "").trim())
      && !demoImageCodes.has(code);
  }).map((sku) => String(sku?.skuCode || "").trim());
  const customerReplyEligibleCount = customerReplyEligibleSkuCodes.length;
  const demoImageCount = demoImageCodes.size;
  const unverifiedCount = Math.max(0, activeSkus.length - customerReplyEligibleCount);
  const level = activeSkus.length === 0
    ? "empty"
    : customerReplyEligibleCount === activeSkus.length
      ? "verified"
      : customerReplyEligibleCount > 0
        ? "partial"
        : "test_only";
  const blockers = [];
  if (!activeSkus.length) blockers.push("商品库为空");
  if (operatorProvidedCount < activeSkus.length) blockers.push(`${activeSkus.length - operatorProvidedCount} 个 SKU 没有人工表单或导入来源记录`);
  if (demoImageCount) blockers.push(`${demoImageCount} 个 SKU 仍使用演示图片`);
  const nextActions = [];
  if (operatorProvidedCount < activeSkus.length) nextActions.push("通过商品导入页写入真实 SKU、售价、库存、供应商和交期");
  if (demoImageCount) nextActions.push("替换演示图片为真实商品主图和多角度图");
  return {
    level,
    totalCount: activeSkus.length,
    operatorProvidedCount,
    demoImageCount,
    customerReplyEligibleCount,
    customerReplyEligibleSkuCodes,
    unverifiedCount,
    internalTestReady: activeSkus.length > 0,
    customerReplyReady: activeSkus.length > 0 && customerReplyEligibleCount === activeSkus.length,
    summary: level === "verified"
      ? "全部在售 SKU 均有人工导入来源且未使用演示图片，可进入客户回复验收。"
      : level === "partial"
        ? "部分商品已具备真实数据来源，其余商品仍只适合内部测试。"
        : level === "test_only"
          ? "目录结构可用于员工测试，但没有 SKU 完成真实数据来源与真实图片验收。"
          : "商品库为空，不能进行商品事实回复。",
    blockers,
    nextActions,
  };
}

function isDemoSkuImageReference(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").toLowerCase();
  if (!normalized) return false;
  return normalized.includes("/starter-skus/") || /(?:^|[-_.])demo(?:[-_.]|$)/.test(normalized.split("/").pop() || "");
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

function duplicateValues(values = []) {
  const counts = new Map();
  for (const value of values) {
    const normalized = normalizeDuplicateValue(value);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}

function normalizeDuplicateValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isSafeSkuCode(value) {
  return /^[A-Z0-9][A-Z0-9._-]*$/.test(String(value || "").trim());
}

function countAvailableSkuRoles(skus = []) {
  const counts = { giftBoxCount: 0, itemCount: 0, accessoryCount: 0 };
  for (const sku of Array.isArray(skus) ? skus : []) {
    if (sku.isActive === false) continue;
    if (!["gift_box", "item", "accessory"].includes(String(sku.type || ""))) continue;
    if (Number(sku.salePrice || 0) <= 0 || Number(sku.stock || 0) <= 0) continue;
    if (sku.type === "gift_box") counts.giftBoxCount += 1;
    if (sku.type === "item") counts.itemCount += 1;
    if (sku.type === "accessory") counts.accessoryCount += 1;
  }
  return counts;
}

function summarizeAvailableSkuCoverage(skus = []) {
  const sceneTagCounts = new Map();
  const categoryCounts = new Map();
  for (const sku of Array.isArray(skus) ? skus : []) {
    if (sku.isActive === false) continue;
    if (Number(sku.salePrice || 0) <= 0 || Number(sku.stock || 0) <= 0) continue;
    for (const tag of Array.isArray(sku.sceneTags) ? sku.sceneTags : []) {
      const normalized = String(tag || "").trim();
      if (normalized) sceneTagCounts.set(normalized, (sceneTagCounts.get(normalized) || 0) + 1);
    }
    const category = String(sku.category || "").trim();
    if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  return {
    sceneTagCount: sceneTagCounts.size,
    categoryCount: categoryCounts.size,
    topSceneTags: topCountEntries(sceneTagCounts),
    topCategories: topCountEntries(categoryCounts),
  };
}

function summarizeBundleReadiness(skus = [], options = {}) {
  const available = (Array.isArray(skus) ? skus : []).filter((sku) => (
    sku.isActive !== false &&
    Number(sku.salePrice || 0) > 0 &&
    Number(sku.stock || 0) > 0
  ));
  const giftBoxes = available.filter((sku) => sku.type === "gift_box");
  const items = available.filter((sku) => sku.type === "item");
  const minGiftBoxPrice = minSkuPrice(giftBoxes);
  const minItemPrice = minSkuPrice(items);
  const availableGiftBoxStock = sumSkuStock(giftBoxes);
  const availableItemStock = sumSkuStock(items);
  const basicBundleCapacity = Math.min(availableGiftBoxStock, availableItemStock);
  const capacityBottleneck = resolveCapacityBottleneck(availableGiftBoxStock, availableItemStock);
  const capacityBottleneckLabel = capacityBottleneckLabelFor(capacityBottleneck);
  const capacityChecks = (options.quantityCheckpoints || []).map((quantity) => ({
    quantity,
    enough: basicBundleCapacity >= quantity,
    shortage: Math.max(0, quantity - basicBundleCapacity),
  }));
  const warnings = [];
  if (!minGiftBoxPrice) warnings.push("缺少可售且有库存的礼盒，无法自动组出完整礼盒方案。");
  if (!minItemPrice) warnings.push("缺少可售且有库存的内搭商品，无法自动组出完整礼盒方案。");
  for (const check of capacityChecks.filter((item) => !item.enough)) {
    warnings.push(`基础组合容量不足 ${check.quantity} 份，还差约 ${check.shortage} 份。`);
  }
  return {
    minGiftBoxPrice,
    minItemPrice,
    minBundleBudget: minGiftBoxPrice && minItemPrice ? round(minGiftBoxPrice + minItemPrice) : 0,
    availableGiftBoxStock,
    availableItemStock,
    basicBundleCapacity,
    capacityBottleneck,
    capacityBottleneckLabel,
    capacityChecks,
    capacityRiskCount: capacityChecks.filter((item) => !item.enough).length,
    issueCount: warnings.length,
    warnings,
  };
}

function summarizeBudgetBandCoverage(skus = [], options = {}) {
  const bands = normalizeBudgetBands(options.budgetBands);
  const leadTimeWarningDays = normalizeLeadTimeWarningDays(options.deliveryLeadTimeWarningDays);
  const minimumMarginRate = normalizeMinimumMarginRate(options.minimumMarginRate);
  const available = (Array.isArray(skus) ? skus : []).filter((sku) => (
    sku.isActive !== false &&
    Number(sku.salePrice || 0) > 0 &&
    Number(sku.stock || 0) > 0
  ));
  const giftBoxes = available.filter((sku) => sku.type === "gift_box");
  const items = available.filter((sku) => sku.type === "item");

  return bands.map((band) => {
    const combinations = [];
    for (const giftBox of giftBoxes) {
      for (const item of items) {
        const totalPrice = round(Number(giftBox.salePrice || 0) + Number(item.salePrice || 0));
        if (totalPrice < band.min) continue;
        if (band.max !== null && totalPrice > band.max) continue;
        combinations.push(buildBundleCombination(giftBox, item, {
          totalPrice,
          leadTimeWarningDays,
          minimumMarginRate,
        }));
      }
    }
    const sorted = combinations
      .sort((a, b) => a.totalPrice - b.totalPrice || String(a.giftBoxSkuCode).localeCompare(String(b.giftBoxSkuCode)) || String(a.itemSkuCode).localeCompare(String(b.itemSkuCode)));
    const prices = sorted.map((item) => item.totalPrice);
    const marginRates = sorted.map((item) => item.marginRate).filter((value) => Number.isFinite(value));
    const leadTimes = sorted.map((item) => item.leadTimeDays).filter((value) => Number.isFinite(value));
    const automationBlockerCounts = countAutomationBlockers(sorted);
    return {
      key: band.key,
      label: band.label,
      min: band.min,
      max: band.max,
      available: sorted.length > 0,
      combinationCount: sorted.length,
      minBundlePrice: prices.length ? prices[0] : 0,
      maxBundlePrice: prices.length ? prices[prices.length - 1] : 0,
      capacity: sorted.reduce((max, item) => Math.max(max, item.capacity), 0),
      minMarginRate: marginRates.length ? round(Math.min(...marginRates)) : 0,
      lowMarginCombinationCount: sorted.filter((item) => item.marginRate < minimumMarginRate).length,
      maxLeadTimeDays: leadTimes.length ? Math.max(...leadTimes) : 0,
      deliveryRiskCombinationCount: sorted.filter((item) => item.deliveryRisk).length,
      specReadyCombinationCount: sorted.filter((item) => item.specReady).length,
      sizeReadyCombinationCount: sorted.filter((item) => item.sizeReady).length,
      sizeRiskCombinationCount: sorted.filter((item) => item.sizeRisk).length,
      automationReadyCombinationCount: sorted.filter((item) => item.automationReady).length,
      automationBlockerCounts,
      examples: sorted.slice(0, 3).map(bundleCombinationSummary),
      automationReadyExamples: sorted.filter((item) => item.automationReady).slice(0, 3).map(bundleCombinationSummary),
    };
  });
}

function summarizeSceneBundleCoverage(skus = [], options = {}) {
  const leadTimeWarningDays = normalizeLeadTimeWarningDays(options.deliveryLeadTimeWarningDays);
  const minimumMarginRate = normalizeMinimumMarginRate(options.minimumMarginRate);
  const available = (Array.isArray(skus) ? skus : []).filter((sku) => (
    sku.isActive !== false &&
    Number(sku.salePrice || 0) > 0 &&
    Number(sku.stock || 0) > 0
  ));
  const giftBoxes = available.filter((sku) => sku.type === "gift_box");
  const items = available.filter((sku) => sku.type === "item");
  const sceneTags = normalizeTargetSceneTags(options.targetSceneTags, available);

  return sceneTags.map((scene) => {
    const sceneGiftBoxes = giftBoxes.filter((sku) => skuMatchesScene(sku, scene, { allowGeneric: true }));
    const sceneItems = items.filter((sku) => skuMatchesScene(sku, scene, { allowGeneric: false }));
    const combinations = [];
    for (const giftBox of sceneGiftBoxes) {
      for (const item of sceneItems) {
        combinations.push(buildBundleCombination(giftBox, item, {
          leadTimeWarningDays,
          minimumMarginRate,
        }));
      }
    }
    const sorted = combinations
      .sort((a, b) => a.totalPrice - b.totalPrice || String(a.giftBoxSkuCode).localeCompare(String(b.giftBoxSkuCode)) || String(a.itemSkuCode).localeCompare(String(b.itemSkuCode)));
    const prices = sorted.map((item) => item.totalPrice);
    const marginRates = sorted.map((item) => item.marginRate).filter((value) => Number.isFinite(value));
    const leadTimes = sorted.map((item) => item.leadTimeDays).filter((value) => Number.isFinite(value));
    const automationBlockerCounts = countAutomationBlockers(sorted);
    return {
      scene,
      available: sorted.length > 0,
      giftBoxCount: sceneGiftBoxes.length,
      itemCount: sceneItems.length,
      combinationCount: sorted.length,
      minBundlePrice: prices.length ? prices[0] : 0,
      maxBundlePrice: prices.length ? prices[prices.length - 1] : 0,
      capacity: sorted.reduce((max, item) => Math.max(max, item.capacity), 0),
      minMarginRate: marginRates.length ? round(Math.min(...marginRates)) : 0,
      lowMarginCombinationCount: sorted.filter((item) => item.marginRate < minimumMarginRate).length,
      maxLeadTimeDays: leadTimes.length ? Math.max(...leadTimes) : 0,
      deliveryRiskCombinationCount: sorted.filter((item) => item.deliveryRisk).length,
      specReadyCombinationCount: sorted.filter((item) => item.specReady).length,
      sizeReadyCombinationCount: sorted.filter((item) => item.sizeReady).length,
      sizeRiskCombinationCount: sorted.filter((item) => item.sizeRisk).length,
      automationReadyCombinationCount: sorted.filter((item) => item.automationReady).length,
      automationBlockerCounts,
      examples: sorted.slice(0, 3).map(bundleCombinationSummary),
      automationReadyExamples: sorted.filter((item) => item.automationReady).slice(0, 3).map(bundleCombinationSummary),
    };
  });
}

function buildBundleCombination(giftBox, item, options = {}) {
  const totalPrice = round(options.totalPrice ?? (Number(giftBox.salePrice || 0) + Number(item.salePrice || 0)));
  const costPrice = round(Number(giftBox.costPrice || 0) + Number(item.costPrice || 0));
  const profit = round(totalPrice - costPrice);
  const giftBoxLeadTime = normalizePositiveNumber(giftBox.leadTimeDays);
  const itemLeadTime = normalizePositiveNumber(item.leadTimeDays);
  const leadTimeDays = Math.max(giftBoxLeadTime, itemLeadTime);
  const giftBoxWeight = normalizePositiveNumber(giftBox.weightGram);
  const itemWeight = normalizePositiveNumber(item.weightGram);
  const leadTimeWarningDays = normalizeLeadTimeWarningDays(options.leadTimeWarningDays);
  const minimumMarginRate = normalizeMinimumMarginRate(options.minimumMarginRate);
  const specReady = skuDimensionIssue(giftBox.dimensions || {}) === "" &&
    skuDimensionIssue(item.dimensions || {}) === "" &&
    giftBoxWeight > 0 &&
    itemWeight > 0;
  const dimensionsReady = skuDimensionIssue(giftBox.dimensions || {}) === "" &&
    skuDimensionIssue(item.dimensions || {}) === "";
  const sizeReady = dimensionsReady && skuDimensionsFitInside(giftBox.dimensions, item.dimensions);
  const marginRate = totalPrice > 0 ? round(profit / totalPrice) : 0;
  const deliveryRisk = leadTimeDays > leadTimeWarningDays;
  const sizeRisk = dimensionsReady && !sizeReady;
  const autoQuoteBlockers = [];
  if (marginRate < minimumMarginRate) autoQuoteBlockers.push("low_margin");
  if (deliveryRisk) autoQuoteBlockers.push("delivery_risk");
  if (!specReady) autoQuoteBlockers.push("spec_incomplete");
  if (sizeRisk) autoQuoteBlockers.push("size_mismatch");
  if (!dimensionsReady) autoQuoteBlockers.push("size_unknown");
  return {
    giftBoxSkuCode: giftBox.skuCode || "",
    itemSkuCode: item.skuCode || "",
    totalPrice,
    costPrice,
    profit,
    marginRate,
    leadTimeDays,
    leadTimeKnown: giftBoxLeadTime > 0 || itemLeadTime > 0,
    weightGram: round(giftBoxWeight + itemWeight),
    specReady,
    sizeReady,
    sizeRisk,
    deliveryRisk,
    automationReady: autoQuoteBlockers.length === 0,
    autoQuoteBlockers,
    capacity: Math.min(
      Math.max(0, Math.floor(Number(giftBox.stock || 0))),
      Math.max(0, Math.floor(Number(item.stock || 0))),
    ),
  };
}

function normalizeTargetSceneTags(targetSceneTags, skus = []) {
  const values = [];
  for (const tag of Array.isArray(targetSceneTags) ? targetSceneTags : []) {
    const normalized = String(tag || "").trim();
    if (normalized) values.push(normalized);
  }
  for (const sku of Array.isArray(skus) ? skus : []) {
    for (const tag of Array.isArray(sku.sceneTags) ? sku.sceneTags : []) {
      const normalized = String(tag || "").trim();
      if (normalized && !isGenericSceneTag(normalized)) values.push(normalized);
    }
  }
  return [...new Set(values)].slice(0, 8);
}

function countAutomationBlockers(combinations = []) {
  const counts = new Map();
  for (const combination of combinations) {
    for (const blocker of Array.isArray(combination.autoQuoteBlockers) ? combination.autoQuoteBlockers : []) {
      counts.set(blocker, (counts.get(blocker) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([code, count]) => ({ code, count }));
}

function bundleCombinationSummary(combination) {
  const {
    giftBoxSkuCode,
    itemSkuCode,
    totalPrice,
    costPrice,
    profit,
    marginRate,
    leadTimeDays,
    leadTimeKnown,
    weightGram,
    specReady,
    sizeReady,
    sizeRisk,
    deliveryRisk,
    automationReady,
    autoQuoteBlockers,
  } = combination;
  return {
    giftBoxSkuCode,
    itemSkuCode,
    totalPrice,
    costPrice,
    profit,
    marginRate,
    leadTimeDays,
    leadTimeKnown,
    weightGram,
    specReady,
    sizeReady,
    sizeRisk,
    deliveryRisk,
    automationReady,
    autoQuoteBlockers,
  };
}

function skuMatchesScene(sku, scene, options = {}) {
  const tags = Array.isArray(sku.sceneTags) ? sku.sceneTags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  if (tags.some((tag) => normalizeDuplicateValue(tag) === normalizeDuplicateValue(scene))) return true;
  return Boolean(options.allowGeneric && (!tags.length || tags.some(isGenericSceneTag)));
}

function isGenericSceneTag(tag) {
  const normalized = normalizeDuplicateValue(tag);
  return ["通用", "全场景", "不限场景", "general", "all", "universal"].includes(normalized);
}

function normalizeBudgetBands(value) {
  const source = Array.isArray(value) && value.length ? value : [
    { key: "entry", label: "低预算", min: 0, max: 100 },
    { key: "standard", label: "标准预算", min: 100, max: 300 },
    { key: "premium", label: "高预算", min: 300, max: null },
  ];
  return source
    .map((band) => ({
      key: String(band.key || band.label || "").trim(),
      label: String(band.label || band.key || "").trim(),
      min: Math.max(0, Number(band.min || 0)),
      max: band.max === undefined || band.max === null || band.max === "" ? null : Math.max(0, Number(band.max)),
    }))
    .filter((band) => band.key && band.label && Number.isFinite(band.min) && (band.max === null || Number.isFinite(band.max)))
    .sort((a, b) => a.min - b.min);
}

function normalizeLeadTimeWarningDays(value) {
  const days = Number(value || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function normalizeMinimumMarginRate(value) {
  const rate = Number(value ?? 0.15);
  if (!Number.isFinite(rate) || rate < 0) return 0.15;
  return rate > 1 ? rate / 100 : rate;
}

function normalizePositiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function skuDimensionsFitInside(containerDimensions = {}, itemDimensions = {}) {
  const container = sortedPositiveDimensions(containerDimensions);
  const item = sortedPositiveDimensions(itemDimensions);
  if (container.length !== 3 || item.length !== 3) return false;
  return item.every((value, index) => value <= container[index]);
}

function sortedPositiveDimensions(dimensions = {}) {
  const values = ["lengthCm", "widthCm", "heightCm"]
    .map((key) => Number(dimensions[key] || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length === 3 ? values.sort((a, b) => a - b) : [];
}

function minSkuPrice(skus = []) {
  return skus.reduce((min, sku) => {
    const price = Number(sku.salePrice || 0);
    if (price <= 0) return min;
    return min ? Math.min(min, price) : price;
  }, 0);
}

function sumSkuStock(skus = []) {
  return skus.reduce((total, sku) => total + Math.max(0, Math.floor(Number(sku.stock || 0))), 0);
}

function resolveCapacityBottleneck(giftBoxStock, itemStock) {
  if (giftBoxStock <= 0 && itemStock <= 0) return "both";
  if (giftBoxStock <= 0) return "gift_box";
  if (itemStock <= 0) return "item";
  if (giftBoxStock === itemStock) return "balanced";
  return giftBoxStock < itemStock ? "gift_box" : "item";
}

function capacityBottleneckLabelFor(value) {
  const labels = {
    both: "礼盒和内搭都缺",
    gift_box: "礼盒库存限制",
    item: "内搭库存限制",
    balanced: "礼盒与内搭库存均衡",
  };
  return labels[value] || "未知瓶颈";
}

function normalizeQuantityCheckpoints(value) {
  const source = Array.isArray(value) && value.length ? value : [50, 100, 200];
  return [...new Set(source
    .map((item) => Math.floor(Number(item || 0)))
    .filter((item) => Number.isFinite(item) && item > 0))]
    .sort((a, b) => a - b);
}

function buildCommercialReadiness(input) {
  const entryBudgetBand = (input.budgetBandCoverage || []).find((band) => band.key === "entry");
  const lowValueBudgetReady = !entryBudgetBand || entryBudgetBand.available;
  const canAutoBundle = (
    input.total > 0 &&
    input.errorCount === 0 &&
    input.catalogStructureIssueCount === 0 &&
    input.bundleReadiness.minBundleBudget > 0 &&
    input.bundleReadiness.basicBundleCapacity > 0
  );
  const canSubmitDesign = canAutoBundle && input.blockingRepairCount === 0 && input.missingImageCount === 0;
  const canAutoQuote = canSubmitDesign && input.negativeMarginCount === 0 && lowValueBudgetReady;
  const blockers = [];
  const nextActions = [];
  if (!input.total) blockers.push("商品库为空");
  if (input.errorCount) blockers.push(`${input.errorCount} 个严重资料问题`);
  if (input.catalogStructureIssueCount) blockers.push("缺少可售礼盒或内搭");
  if (input.bundleReadiness.basicBundleCapacity <= 0) blockers.push("基础礼盒容量为 0");
  if (input.blockingRepairCount) blockers.push(`${input.blockingRepairCount} 个商品会影响自动搭配或出图`);
  if (input.missingImageCount) blockers.push(`${input.missingImageCount} 个商品图片问题`);
  if (input.negativeMarginCount) blockers.push(`${input.negativeMarginCount} 个利润异常`);
  if (!lowValueBudgetReady) blockers.push("低预算客户没有可自动报价的礼盒组合");
  if (input.catalogCoverageIssueCount) nextActions.push("补场景标签和分类，让智能体能按客户场景选品");
  if (input.bundleReadiness.capacityRiskCount) nextActions.push("补齐礼盒或内搭库存，提升 50/100/200 份订单承接能力");
  for (const band of (input.budgetBandCoverage || []).filter((item) => !item.available)) {
    nextActions.push(`补 ${band.label} 商品组合，让智能体能承接 ${band.max === null ? `${band.min} 元以上` : `${band.min}-${band.max} 元`} 客户`);
  }
  for (const scene of (input.sceneBundleCoverage || []).filter((item) => !item.available)) {
    nextActions.push(`补 ${scene.scene} 场景的礼盒或内搭，让智能体能按真实场景选品`);
  }
  for (const band of (input.budgetBandCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.lowMarginCombinationCount >= item.combinationCount)) {
    nextActions.push(`${band.label} 组合毛利率偏低，自动报价前先调价或补高毛利商品`);
  }
  for (const scene of (input.sceneBundleCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.lowMarginCombinationCount >= item.combinationCount)) {
    nextActions.push(`${scene.scene} 场景组合毛利率偏低，建议补高毛利内搭或礼盒`);
  }
  for (const band of (input.budgetBandCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.deliveryRiskCombinationCount >= item.combinationCount)) {
    nextActions.push(`${band.label} 组合交期偏长，自动报价或回复客户前需要人工确认交付时间`);
  }
  for (const band of (input.budgetBandCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.specReadyCombinationCount <= 0)) {
    nextActions.push(`${band.label} 缺少尺寸重量完整的组合，设计出图和物流报价前先补规格`);
  }
  for (const band of (input.budgetBandCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.sizeRiskCombinationCount >= item.combinationCount)) {
    nextActions.push(`${band.label} 组合尺寸不匹配，内搭可能放不进礼盒，自动推荐前需要换礼盒或换内搭`);
  }
  for (const band of (input.budgetBandCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.automationReadyCombinationCount <= 0)) {
    nextActions.push(`${band.label} 没有可直接自动报价的组合，低价值客户也需要先人工确认商品、交期或毛利`);
  }
  for (const scene of (input.sceneBundleCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.deliveryRiskCombinationCount >= item.combinationCount)) {
    nextActions.push(`${scene.scene} 场景组合交期偏长，适合先转人工确认交期`);
  }
  for (const scene of (input.sceneBundleCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.specReadyCombinationCount <= 0)) {
    nextActions.push(`${scene.scene} 场景缺少规格完整组合，出图比例和物流判断会不准`);
  }
  for (const scene of (input.sceneBundleCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.sizeRiskCombinationCount >= item.combinationCount)) {
    nextActions.push(`${scene.scene} 场景组合尺寸不匹配，先补可装下的礼盒组合`);
  }
  for (const scene of (input.sceneBundleCoverage || []).filter((item) => item.available && item.combinationCount > 0 && item.automationReadyCombinationCount <= 0)) {
    nextActions.push(`${scene.scene} 场景没有可自动处理组合，智能体只能收集需求后转人工`);
  }
  if (input.warningCount) nextActions.push("处理警告项，降低人工审核次数");
  if (!nextActions.length && canAutoQuote) nextActions.push("商品库已满足低价值客户自动搭配、出图和报价的基础要求");

  const score = Math.max(0, Math.min(100, Math.round(
    100 -
    input.errorCount * 12 -
    input.warningCount * 4 -
    input.blockingRepairCount * 15 -
    input.catalogStructureIssueCount * 20 -
    input.catalogCoverageIssueCount * 8 -
    input.budgetCoverageIssueCount * 8 -
    input.sceneBundleCoverageIssueCount * 6 -
    input.bundleMarginRiskCount * 5 -
    input.bundleDeliveryRiskCount * 4 -
    input.bundleSpecRiskCount * 4 -
    input.bundleSizeRiskCount * 5 -
    input.bundleAutomationRiskCount * 5 -
    input.bundleReadiness.issueCount * 10,
  )));
  const level = canAutoQuote ? "ready" : canAutoBundle ? "review" : "blocked";
  const summary = canAutoQuote
    ? "商品库已具备低价值客户自动搭配、出图和报价的基础条件。"
    : canSubmitDesign
      ? "商品库可自动搭配并提交设计出图，报价前仍建议处理利润或资料警告。"
      : canAutoBundle
        ? "商品库可以自动搭配，但出图或报价前还需要补关键商品资料。"
        : "商品库暂不适合自动化，需要先补齐基础商品结构和关键资料。";

  return {
    score,
    level,
    canAutoBundle,
    canSubmitDesign,
    canAutoQuote,
    summary,
    blockers,
    nextActions,
  };
}

function topCountEntries(counts, limit = 5) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function skuDimensionIssue(dimensions = {}) {
  const keys = ["lengthCm", "widthCm", "heightCm"];
  const values = keys.map((key) => dimensions[key]);
  if (!values.some((value) => value !== undefined && value !== null && value !== "")) return "missing";
  if (values.some((value) => value !== undefined && value !== null && value !== "" && Number(value) <= 0)) return "invalid";
  if (values.some((value) => value === undefined || value === null || value === "")) return "incomplete";
  return "";
}

function collectMatchingRuleSkuCodes(matchingRules) {
  if (!matchingRules || typeof matchingRules !== "object" || Array.isArray(matchingRules)) return [];
  const refs = [];
  for (const key of ["mustWith", "preferWith", "cannotWith", "excludeWith", "requires", "avoidWith"]) {
    const raw = matchingRules[key];
    const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[、,，;；/|]+/) : [];
    for (const value of values) {
      const skuCode = String(value || "").trim();
      if (skuCode) refs.push({ key, skuCode });
    }
  }
  return refs;
}

function buildSkuImageProblems(issues = []) {
  return issues
    .filter((issue) => IMAGE_ISSUE_CODES.includes(issue.code))
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
        blocking: sortedIssues.some(isBlockingRepairIssue),
        issueCount: sortedIssues.length,
        missingFields: fields,
        recommendedAction: fields[0]?.action || topIssue.message,
        issues: sortedIssues,
      };
    })
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.priority - a.priority || String(a.skuCode || a.name).localeCompare(String(b.skuCode || b.name)));
}

function isBlockingRepairIssue(issue) {
  if (!issue || issue.severity === "info") return false;
  if (issue.severity === "error") return true;
  return !NON_BLOCKING_REPAIR_CODES.has(issue.code);
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
  summarizeSkuDataReadiness,
};
