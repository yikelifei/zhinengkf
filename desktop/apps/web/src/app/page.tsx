"use client";

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type {
  AutomationRun,
  AutomationReadiness,
  BundleRecommendation,
  LowValueAutomationResult,
  LowValueOrderDraftResult,
  LowValueOrderFollowupResult,
  LowValueOrderSendResult,
} from "../lib/api";
import {
  AlertTriangle,
  Bell,
  Bot,
  Boxes,
  Brain,
  Building2,
  Ban,
  Check,
  ClipboardList,
  CircleDollarSign,
  CreditCard,
  Download,
  FileUp,
  Image as ImageIcon,
  Layers,
  LockKeyhole,
  MessageCircle,
  Monitor,
  Network,
  Route,
  PackageSearch,
  Pencil,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Store,
  Workflow,
  X,
} from "lucide-react";
import {
  Agent,
  applySkillSuggestions,
  AutomationStatus,
  attachDesignJobAssets,
  autoSubmitDesignDrafts,
  batchReviewTrainingSamples,
  batchUpdateSkus,
  bulkUpsertSkus,
  ChatImport,
  cancelDesignJob,
  cancelSendTask,
  Conversation,
  captureWindowObserverOnce,
  correctRouteEvaluation,
  createDemoDesignJob,
  createDemoCustomerLogo,
  createDemoSkuImages,
  createFailureDemoJob,
  createDemoSendTask,
  createDemoWindowSnapshot,
  createOrderDraftFromQuote,
  createTimeoutDemoJob,
  createQuote,
  deactivateSku,
  DesignAsset,
  DesignImageSelectionResult,
  DesignJob,
  DesignPlatformHealth,
  DesignPlatformConfigSummary,
  DesignPlatformReadiness,
  DesignPlatformSmokeTestResult,
  DesignJobPreflightResult,
  downloadSkuImportTemplate,
  executeDryRunSend,
  executeSendTask,
  evaluateRoute,
  getAgents,
  getAutomationStatus,
  getAutomationReadiness,
  getBridgeOutbox,
  getBridgeStatus,
  getChatImports,
  getDesignJobs,
  getDesignPlatformHealth,
  getDesignPlatformConfig,
  getDesignPlatformReadiness,
  getAssets,
  getNotifications,
  getOrderConfirmationPreview,
  getOrderDrafts,
  getQuotePreview,
  getQuotes,
  getReviewCenter,
  getRouteEvaluations,
  getSendAdapter,
  getSendAttempts,
  getSendTasks,
  getSkuCatalogAudit,
  getSkuChangeLogs,
  getSkuImportFields,
  getSkus,
  getSkillSuggestions,
  getTrainingOverview,
  getTrainingSamples,
  getWechatAccounts,
  getWechatChannelStatus,
  getWechatConversations,
  getWechatWindowSnapshots,
  getWindowObserverStatus,
  importChatTranscript,
  identityExpectation,
  localAssetUrl,
  localDesignImageUrl,
  loginDesignPlatform,
  markAllNotificationsRead,
  markNotificationRead,
  markManualReview,
  mergeAutomationStatusRun,
  NotificationItem,
  OrderConfirmationPreview,
  OrderDraft,
  preflightDesignJob,
  previewSkuImportFile,
  previewSkuImportText,
  pollActiveDesignResults,
  pollDesignJob,
  processInboundMessage,
  processSafeSendQueue,
  QuoteDraft,
  QuotePreview,
  queueOrderConfirmation,
  queueOrderFollowup,
  queueQuoteSend,
  quickConfirmSend,
  recommendBundle,
  reviseOrderSelection,
  reviseQuoteSelection,
  redeemDesignPlatformActivation,
  requeueSendTask,
  requestDesignRevision,
  reviewDesignJob,
  reviewTrainingSample,
  ReviewCenter,
  ReviewDesignJobResult,
  ReviewLog,
  ReviewOrderResult,
  ReviewQuoteResult,
  reviewOrder,
  reviewQuote,
  retryDesignJob,
  restoreSku,
  runDesignPlatformSmokeTest,
  RouteEvaluation,
  runAutomationOnce,
  scanBridgeInbox,
  scanDesignTimeouts,
  scanHighValueHandoffs,
  scanSendOperations,
  scanWindowSnapshotInbox,
  selectDesignImage,
  setConversationManualLock,
  SafeSendQueueResult,
  SendOperationsScanResult,
  SendAdapterInfo,
  SendAttempt,
  SendTask,
  BridgeDispatchEntry,
  BridgeOutboxEntry,
  BridgeOutboxResult,
  BridgeStatusResult,
  Sku,
  SkuCatalogAudit,
  SkuChangeLog,
  SkuImageProblem,
  SkuImportField,
  SkuImportResult,
  SkuRepairQueueItem,
  SkuPayload,
  SkillSuggestionApplyBlocked,
  SkillSuggestion,
  startAutomation,
  stopAutomation,
  submitDesignJob,
  testWechatChannelInbound,
  TrainingSample,
  TrainingOverview,
  updateOrderDraft,
  updateDesignPlatformConfig,
  updateQuote,
  upsertSku,
  uploadAsset,
  verifyQuotePaymentProofAndQueueConfirmation,
  validateSendTask,
  validateSendTaskCurrentWindow,
  WechatAccount,
  WechatChannelKey,
  WechatChannelStatus,
  WechatChannelStatusItem,
  WechatWindowSnapshot,
  WindowObserverStatus,
  WindowSnapshotInboxScanResult,
} from "../lib/api";

const WINDOW_SNAPSHOT_MAX_AGE_SECONDS = 30;
const AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES = 2;
const AUTO_SELECT_SKILL_SUGGESTION_MIN_CONFIDENCE = 80;
const TRAINING_SAMPLE_PAGE_SIZE = 12;
const TRAINING_SAMPLE_BATCH_REVIEW_LIMIT = 100;

function windowSnapshotScanSummary(result: WindowSnapshotInboxScanResult) {
  const pending = Number(result.pending || 0);
  const total = Number(result.total || result.scanned || 0);
  const limit = Number(result.limit || 0);
  const batchText = limit && total > result.scanned ? `本轮最多 ${limit} 个，` : "";
  const pendingText = pending > 0 ? `，剩余 ${pending} 个排队分批扫描` : "";
  return `${batchText}扫描 ${result.scanned} 个文件，成功 ${result.processed.length} 个，失败 ${result.failed.length} 个${pendingText}`;
}

function isSkillSuggestionAutoSelected(suggestion: SkillSuggestion) {
  if (isSkillSuggestionBlocked(suggestion)) return false;
  if (suggestion.quality) return !suggestion.quality.needsReview;
  return (
    Number(suggestion.sampleCount || 0) >= AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES &&
    Number(suggestion.confidence || 0) >= AUTO_SELECT_SKILL_SUGGESTION_MIN_CONFIDENCE
  );
}

function isSkillSuggestionBlocked(suggestion: SkillSuggestion) {
  return Boolean(
    suggestion.quality?.blocked ||
      suggestion.quality?.level === "blocked" ||
      suggestion.scope?.level === "mixed",
  );
}

function readableScene(value: unknown, fallback = "未识别场景") {
  const text = String(value || "").trim();
  if (!text || /^[?？\s]+$/.test(text) || /\?{2,}|�/.test(text)) return fallback;
  return text;
}

function firstReadableScene(values: unknown[], fallback = "未填写场景") {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text && readableScene(text, "") !== "") return text;
  }
  return fallback;
}

const statusLabel: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  generating: "出图中",
  completed: "已完成",
  quick_confirm: "待快速确认",
  manual_review: "待人工审核",
  sent: "已发送",
  customer_selected: "客户已选择",
  quote_created: "已生成报价",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
};

function designStatusLabel(status: string) {
  return statusLabel[status] || status;
}

const skuTypeOptions = [
  { value: "all", label: "全部" },
  { value: "gift_box", label: "礼盒" },
  { value: "item", label: "内搭" },
  { value: "accessory", label: "配件" },
];

const skuIssueOptions = [
  { value: "all", label: "全部资料" },
  { value: "ready", label: "可用" },
  { value: "problem", label: "有问题" },
  { value: "error", label: "严重" },
  { value: "warning", label: "警告" },
  { value: "missing_image", label: "图片问题" },
  { value: "low_stock", label: "库存异常" },
  { value: "negative_margin", label: "利润异常" },
  { value: "duplicate", label: "重复资料" },
  { value: "type", label: "类型异常" },
  { value: "replacement", label: "替代异常" },
  { value: "matching_rule", label: "搭配异常" },
  { value: "lead_time", label: "交期异常" },
  { value: "specification", label: "规格异常" },
];

const skuRepairFilterOptions = [
  { value: "all", label: "全部待补" },
  { value: "blocking", label: "影响自动化" },
  { value: "review", label: "待复核" },
  { value: "image", label: "图片" },
  { value: "price_stock", label: "价格库存" },
  { value: "spec_delivery", label: "规格交期" },
  { value: "rules", label: "搭配规则" },
];

const skuRepairSortOptions = [
  { value: "priority", label: "优先级" },
  { value: "issue_count", label: "问题数" },
  { value: "name", label: "商品名" },
];

const skuChangeImpactFilterOptions = [
  { value: "all", label: "全部变更" },
  { value: "commercial", label: "报价/搭配" },
  { value: "image", label: "真实出图" },
  { value: "specification", label: "包装物流" },
  { value: "active", label: "上下架" },
];

const skuImageProblemSeverityOptions = [
  { value: "all", label: "全部图片" },
  { value: "error", label: "严重缺图" },
  { value: "warning", label: "待复核" },
];

const skuImageProblemPathOptions = [
  { value: "all", label: "全部路径" },
  { value: "has_path", label: "有路径" },
  { value: "missing_path", label: "未填路径" },
];

const skuImageProblemActionOptions = [
  { value: "all", label: "全部处理" },
  { value: "upload_main", label: "补主图" },
  { value: "upload_angle", label: "补多角度图" },
  { value: "review_invalid", label: "核对失效路径" },
];

const skuImageProblemSortOptions = [
  { value: "severity", label: "严重程度" },
  { value: "product_issue_count", label: "同商品问题数" },
  { value: "path_state", label: "路径状态" },
  { value: "image_role", label: "图片位置" },
  { value: "name", label: "商品名" },
];
const SKU_IMAGE_PROBLEM_PAGE_SIZE = 5;

const highValueOrderReviewFilterOptions = [
  { value: "all", label: "全部" },
  { value: "send_attention", label: "发送异常" },
  { value: "payment", label: "待收款" },
  { value: "confirmation", label: "待发确认" },
  { value: "delivery", label: "交付跟进" },
  { value: "overdue", label: "已到跟进" },
] as const;

const quoteStatusOptions = [
  { value: "all", label: "全部报价" },
  { value: "draft", label: "草稿" },
  { value: "auto_sent", label: "自动报价" },
  { value: "send_queued", label: "待发送" },
  { value: "manual_review", label: "待人工" },
  { value: "sent", label: "已发送" },
  { value: "accepted", label: "已成交" },
  { value: "cancelled", label: "已取消" },
];

const paymentStatusOptions = [
  { value: "all", label: "全部付款" },
  { value: "unpaid", label: "未付款" },
  { value: "deposit_paid", label: "已付定金" },
  { value: "paid", label: "已付款" },
  { value: "refunded", label: "已退款" },
];

const orderStatusOptions = [
  { value: "all", label: "全部订单" },
  { value: "draft", label: "草稿" },
  { value: "confirmed", label: "已确认" },
  { value: "processing", label: "生产中" },
  { value: "fulfilled", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

const dealNextStepFilterOptions = [
  { value: "all", label: "全部下一步" },
  { value: "actionable", label: "可执行" },
  { value: "blocked", label: "需处理" },
];

const dealProgressFilterOptions = [
  { value: "all", label: "全部阶段" },
  { value: "quote", label: "报价" },
  { value: "confirm", label: "等确认" },
  { value: "payment", label: "待收款" },
  { value: "order", label: "待建单" },
  { value: "production", label: "排产" },
  { value: "finish", label: "完成/终止" },
];

const workspaceNavItems = [
  { id: "design-platform-config", label: "平台配置", Icon: Settings2 },
  { id: "asset-center", label: "素材", Icon: FileUp },
  { id: "conversation-center", label: "消息", Icon: MessageCircle },
  { id: "wechat-channel-center", label: "微信接入", Icon: Network },
  { id: "design-center", label: "设计中心", Icon: ImageIcon },
  { id: "sku-library", label: "商品库", Icon: Store },
  { id: "notice-center", label: "提醒", Icon: Bell },
  { id: "catalog-center", label: "导入搭配", Icon: Layers },
  { id: "agent-center", label: "Agent", Icon: Bot },
  { id: "training-center", label: "训练", Icon: Brain },
  { id: "account-center", label: "账号", Icon: LockKeyhole },
  { id: "send-center", label: "发送", Icon: ShieldCheck },
  { id: "routing-center", label: "路由", Icon: Route },
  { id: "review-center", label: "审核", Icon: ShieldAlert },
  { id: "quote-center", label: "报价", Icon: ClipboardList },
] as const;

const workspaceSectionLabels = new Map<string, string>([
  ...workspaceNavItems.map((item) => [item.id, item.label] as [string, string]),
]);
const workspaceSectionIds = new Set(workspaceSectionLabels.keys());

type SkuForm = {
  skuCode: string;
  name: string;
  type: "gift_box" | "item" | "accessory";
  category: string;
  costPrice: string;
  salePrice: string;
  stock: string;
  sceneTags: string;
  mainImagePath: string;
  angleImages: string;
  dimensions: string;
  weightGram: string;
  material: string;
  supplier: string;
  leadTimeDays: string;
  replacementSkuCodes: string;
  matchingRules: string;
};

type SkuFormImageWarning = {
  field: "mainImagePath" | "angleImages";
  severity: "error" | "warning";
  message: string;
  path: string;
};

type SkuFormReadinessWarning = {
  field: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
};

type DesignPlatformConfigForm = {
  adapter: "art_image_local" | "standard_v1";
  baseUrl: string;
  accessToken: string;
  cookie: string;
  deviceId: string;
};

type DesignPlatformLoginForm = {
  email: string;
  password: string;
  deviceId: string;
};

type DesignPlatformActivationForm = {
  code: string;
  deviceId: string;
  deviceLabel: string;
};

type TrainingSampleEdit = {
  agentKey: string;
  scene: string;
  customerText: string;
  idealReply: string;
  score: string;
  skillHints: string;
};

type TrainingSampleQualityFilter =
  | "all"
  | "trainable"
  | "not_trainable"
  | "safe"
  | "review"
  | "risk"
  | "blocked"
  | "missing_required"
  | "needs_attention"
  | "scene_uncertain"
  | "anti_wrong_reply"
  | "route_memory"
  | "reply_skill"
  | "route_and_reply";

type HighValueManualStep = {
  tone: string;
  label: string;
  detail: string;
  nextAction: string;
  priority: number;
};

const skuFormTypeOptions: Array<{ value: SkuForm["type"]; label: string }> = [
  { value: "gift_box", label: "礼盒" },
  { value: "item", label: "内搭" },
  { value: "accessory", label: "配件" },
];

const emptySkuForm: SkuForm = {
  skuCode: "",
  name: "",
  type: "item",
  category: "",
  costPrice: "",
  salePrice: "",
  stock: "0",
  sceneTags: "",
  mainImagePath: "",
  angleImages: "",
  dimensions: "",
  weightGram: "",
  material: "",
  supplier: "",
  leadTimeDays: "",
  replacementSkuCodes: "",
  matchingRules: "",
};

const ART_IMAGE_LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const STANDARD_V1_DEFAULT_BASE_URL = "http://127.0.0.1:3700";

const emptyDesignPlatformConfigForm: DesignPlatformConfigForm = {
  adapter: "art_image_local",
  baseUrl: ART_IMAGE_LOCAL_DEFAULT_BASE_URL,
  accessToken: "",
  cookie: "",
  deviceId: "",
};

const emptyDesignPlatformLoginForm: DesignPlatformLoginForm = {
  email: "",
  password: "",
  deviceId: "",
};

const emptyDesignPlatformActivationForm: DesignPlatformActivationForm = {
  code: "",
  deviceId: "",
  deviceLabel: "智能客服工作台",
};

function designPlatformConfigSummaryToForm(
  config: DesignPlatformConfigSummary,
  current: DesignPlatformConfigForm = emptyDesignPlatformConfigForm,
): DesignPlatformConfigForm {
  const adapter = config.adapter === "standard_v1" ? "standard_v1" : "art_image_local";
  return {
    adapter,
    baseUrl: config.baseUrl || designPlatformDefaultBaseUrl(adapter),
    accessToken: current.accessToken,
    cookie: current.cookie,
    deviceId: current.deviceId,
  };
}

function buildDesignPlatformConfigPayload(form: DesignPlatformConfigForm) {
  return {
    adapter: form.adapter,
    baseUrl: form.baseUrl.trim() || undefined,
    accessToken: form.accessToken.trim() || undefined,
    cookie: form.cookie.trim() || undefined,
    deviceId: form.deviceId.trim() || undefined,
  };
}

function sampleToEdit(sample: TrainingSample): TrainingSampleEdit {
  return {
    agentKey: sample.agentKey || "general",
    scene: sample.scene || "未分类",
    customerText: sample.customerText || "",
    idealReply: sample.idealReply || "",
    score: String(sample.score ?? 70),
    skillHints: (sample.skillHints || []).join("、"),
  };
}

function buildSkuPayload(form: SkuForm): SkuPayload {
  return {
    skuCode: form.skuCode.trim(),
    name: form.name.trim(),
    type: form.type,
    category: form.category.trim() || undefined,
    costPrice: parseMoney(form.costPrice),
    salePrice: parseMoney(form.salePrice),
    stock: parseInteger(form.stock),
    sceneTags: splitTextList(form.sceneTags),
    dimensions: parseDimensionsText(form.dimensions),
    weightGram: optionalInteger(form.weightGram),
    material: form.material.trim() || undefined,
    supplier: form.supplier.trim() || undefined,
    leadTimeDays: optionalInteger(form.leadTimeDays),
    mainImagePath: form.mainImagePath.trim() || undefined,
    angleImages: splitTextList(form.angleImages),
    matchingRules: parseMatchingRulesText(form.matchingRules),
    replacementSkuCodes: splitTextList(form.replacementSkuCodes),
  };
}

function skuToForm(sku: Sku): SkuForm {
  return {
    skuCode: sku.skuCode,
    name: sku.name,
    type: sku.type,
    category: sku.category || "",
    costPrice: String(sku.costPrice ?? ""),
    salePrice: String(sku.salePrice ?? ""),
    stock: String(sku.stock ?? 0),
    sceneTags: (sku.sceneTags || []).join("、"),
    mainImagePath: sku.mainImagePath || "",
    angleImages: (sku.angleImages || []).join("、"),
    dimensions: dimensionsToText(sku.dimensions),
    weightGram: sku.weightGram ? String(sku.weightGram) : "",
    material: sku.material || "",
    supplier: sku.supplier || "",
    leadTimeDays: sku.leadTimeDays ? String(sku.leadTimeDays) : "",
    replacementSkuCodes: (sku.replacementSkuCodes || []).join("、"),
    matchingRules: matchingRulesToText(sku.matchingRules),
  };
}

function buildSkuFormImageChangeSummary(form: SkuForm, originalSku: Sku | null | undefined) {
  if (!originalSku?.skuCode || form.skuCode.trim() !== originalSku.skuCode) return "";
  const originalMainImage = String(originalSku.mainImagePath || "").trim();
  const nextMainImage = form.mainImagePath.trim();
  const originalAngleImages = originalSku.angleImages || [];
  const nextAngleImages = splitTextList(form.angleImages);
  const removedImages = [
    ...(originalMainImage && originalMainImage !== nextMainImage ? [originalMainImage] : []),
    ...originalAngleImages.filter((imagePath) => !nextAngleImages.includes(imagePath)),
  ];
  const addedImages = [
    ...(nextMainImage && nextMainImage !== originalMainImage ? [nextMainImage] : []),
    ...nextAngleImages.filter((imagePath) => !originalAngleImages.includes(imagePath)),
  ];
  if (!removedImages.length && !addedImages.length) return "";
  const parts = [
    removedImages.length ? `移除 ${removedImages.length} 条旧图片路径` : "",
    addedImages.length ? `新增 ${addedImages.length} 条图片路径` : "",
  ].filter(Boolean);
  return `待保存图片变更：${parts.join("，")}。保存商品后才会生效，保存后请刷新商品审核确认图片问题减少。`;
}

function buildSkuFormImageChangeCopyText(form: SkuForm, originalSku: Sku | null | undefined) {
  const summary = buildSkuFormImageChangeSummary(form, originalSku);
  if (!summary || !originalSku) return "";
  const originalMainImage = String(originalSku.mainImagePath || "").trim();
  const nextMainImage = form.mainImagePath.trim();
  const originalAngleImages = originalSku.angleImages || [];
  const nextAngleImages = splitTextList(form.angleImages);
  const removedImages = [
    ...(originalMainImage && originalMainImage !== nextMainImage ? [`主图：${originalMainImage}`] : []),
    ...originalAngleImages
      .map((imagePath, index) => ({ imagePath, index }))
      .filter(({ imagePath }) => !nextAngleImages.includes(imagePath))
      .map(({ imagePath, index }) => `多角度图原第 ${index + 1} 张：${imagePath}`),
  ];
  const addedImages = [
    ...(nextMainImage && nextMainImage !== originalMainImage ? [`主图：${nextMainImage}`] : []),
    ...nextAngleImages
      .map((imagePath, index) => ({ imagePath, index }))
      .filter(({ imagePath }) => !originalAngleImages.includes(imagePath))
      .map(({ imagePath, index }) => `多角度图新第 ${index + 1} 张：${imagePath}`),
  ];
  return [
    `SKU 图片待保存变更：${form.skuCode.trim()}｜${form.name.trim() || originalSku.name || "未命名商品"}`,
    summary,
    "复核口径：只核对图片路径变更，不改价格、库存、搭配规则和商品上下架状态。",
    "移除路径：",
    ...(removedImages.length ? removedImages.map((item, index) => `${index + 1}. ${item}`) : ["无"]),
    "新增路径：",
    ...(addedImages.length ? addedImages.map((item, index) => `${index + 1}. ${item}`) : ["无"]),
    "下一步：确认路径无误后点击“保存商品”，再点击“刷新商品审核”确认图片问题减少。",
  ].join("\n");
}

function splitTextList(value: string) {
  return String(value || "")
    .split(/[、,，;；|/\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateSkuFormImages(form: SkuForm): SkuFormImageWarning[] {
  const warnings: SkuFormImageWarning[] = [];
  const mainImagePath = form.mainImagePath.trim();
  if (!mainImagePath) {
    warnings.push({
      field: "mainImagePath",
      severity: "error",
      message: "请上传或填写真实商品主图",
      path: "",
    });
  } else {
    const message = imageReferenceProblem(mainImagePath, "主图");
    if (message) warnings.push({ field: "mainImagePath", severity: "error", message, path: mainImagePath });
  }

  for (const [index, imagePath] of splitTextList(form.angleImages).entries()) {
    const message = imageReferenceProblem(imagePath, `第 ${index + 1} 张多角度图`);
    if (message) warnings.push({ field: "angleImages", severity: "error", message, path: imagePath });
  }
  return warnings;
}

function validateSkuFormReadiness(form: SkuForm): SkuFormReadinessWarning[] {
  const warnings: SkuFormReadinessWarning[] = validateSkuFormImages(form).map((warning) => ({
    field: warning.field,
    severity: warning.severity,
    message: warning.message,
    path: warning.path,
  }));
  const salePrice = parseMoney(form.salePrice);
  const costPrice = parseMoney(form.costPrice);
  const stock = parseInteger(form.stock);
  const sceneTags = splitTextList(form.sceneTags);
  const dimensions = parseDimensionsText(form.dimensions);
  const weightGram = optionalInteger(form.weightGram);

  if (salePrice > 0 && costPrice > salePrice) {
    warnings.push({ field: "costPrice", severity: "warning", message: "成本价高于售价，自动搭配可能推荐亏损商品" });
  }
  if (!costPrice || costPrice <= 0) {
    warnings.push({ field: "costPrice", severity: "info", message: "缺成本价，报价和利润核算不完整" });
  }
  if (stock <= 0) {
    warnings.push({ field: "stock", severity: "warning", message: "库存为 0，自动搭配不应推荐这个商品" });
  }
  if (!form.supplier.trim()) {
    warnings.push({ field: "supplier", severity: "warning", message: "缺供应商，后续采购、补货和售后追踪会困难" });
  }
  if (!sceneTags.length) {
    warnings.push({ field: "sceneTags", severity: "warning", message: "缺场景标签，智能体难以判断适合哪些客户需求" });
  }
  if (!Object.keys(dimensions).length) {
    warnings.push({ field: "dimensions", severity: "info", message: "缺尺寸，礼盒搭配和物流判断不完整" });
  }
  if (!weightGram) {
    warnings.push({ field: "weightGram", severity: "info", message: "缺重量，物流成本估算不完整" });
  }
  return warnings;
}

function skuFormAutomationPreview(form: SkuForm, warnings: SkuFormReadinessWarning[]) {
  if (!form.skuCode.trim() || !form.name.trim()) {
    return {
      tone: "draft",
      label: "资料草稿",
      detail: "先填写 SKU 编号和商品名称，再判断能否进入自动搭配。",
      chips: ["待编号", "待命名"],
    };
  }
  const errors = warnings.filter((warning) => warning.severity === "error");
  if (errors.length) {
    return {
      tone: "blocked",
      label: "不能自动",
      detail: errors.slice(0, 2).map((warning) => warning.message).join("；"),
      chips: [`严重 ${errors.length}`],
    };
  }
  const warningsOnly = warnings.filter((warning) => warning.severity === "warning");
  const infoOnly = warnings.filter((warning) => warning.severity === "info");
  if (warningsOnly.length) {
    return {
      tone: "review",
      label: "保存后需复核",
      detail: warningsOnly.slice(0, 2).map((warning) => warning.message).join("；"),
      chips: [`警告 ${warningsOnly.length}`, infoOnly.length ? `提醒 ${infoOnly.length}` : "可先保存"],
    };
  }
  if (infoOnly.length) {
    return {
      tone: "partial",
      label: "基本可用",
      detail: "可参与销售流程，但尺寸、重量或成本等资料补齐后自动报价更稳。",
      chips: [`提醒 ${infoOnly.length}`, "可先保存"],
    };
  }
  return {
    tone: "ready",
    label: "可自动",
    detail: "保存后可参与自动搭配、真实出图预检和报价利润核算。",
    chips: ["可搭配", "可出图", "可报价"],
  };
}

function skuSavedOutcomeMessage(
  skuCode: string,
  automationStatus: ReturnType<typeof skuFormAutomationPreview>,
  warnings: SkuFormReadinessWarning[],
) {
  const nextActions = warnings
    .filter((warning) => warning.severity !== "error")
    .slice(0, 3)
    .map((warning) => warning.message);
  const nextActionText = nextActions.length ? nextActions.join("；") : automationStatus.detail;

  if (automationStatus.tone === "ready") {
    return `商品 ${skuCode} 已保存。保存后状态：${automationStatus.label}，可进入自动搭配、真实出图预检和报价利润核算。`;
  }
  if (automationStatus.tone === "review") {
    return `商品 ${skuCode} 已保存，已标记为需复核。下一步处理：${nextActionText}`;
  }
  if (automationStatus.tone === "partial") {
    return `商品 ${skuCode} 已保存。保存后状态：${automationStatus.label}；下一步补齐：${nextActionText}`;
  }
  return `商品 ${skuCode} 已保存。保存后状态：${automationStatus.label}；${automationStatus.detail}`;
}

function skuFormPricingPreview(form: SkuForm) {
  const salePrice = parseMoney(form.salePrice);
  const costPrice = parseMoney(form.costPrice);
  const profit = salePrice - costPrice;
  const marginRate = salePrice > 0 ? profit / salePrice : 0;
  if (salePrice <= 0) {
    return {
      tone: "draft",
      label: "待填售价",
      detail: "先填写售价，系统才能判断毛利和自动报价风险。",
      salePrice,
      costPrice,
      profit,
      marginRate,
    };
  }
  if (costPrice <= 0) {
    return {
      tone: "review",
      label: "缺成本",
      detail: "没有成本价，报价能发但利润核算不完整。",
      salePrice,
      costPrice,
      profit,
      marginRate,
    };
  }
  if (profit < 0) {
    return {
      tone: "blocked",
      label: "亏损风险",
      detail: "成本高于售价，自动报价前必须人工复核。",
      salePrice,
      costPrice,
      profit,
      marginRate,
    };
  }
  if (marginRate < 0.15) {
    return {
      tone: "review",
      label: "低毛利",
      detail: "毛利率偏低，自动推荐时会更谨慎。",
      salePrice,
      costPrice,
      profit,
      marginRate,
    };
  }
  return {
    tone: "ready",
    label: "利润健康",
    detail: "售价、成本和毛利可以支撑自动报价判断。",
    salePrice,
    costPrice,
    profit,
    marginRate,
  };
}

function skuFormSpecificationPreview(form: SkuForm) {
  const dimensions = parseDimensionsText(form.dimensions);
  const dimensionValues = [dimensions.lengthCm, dimensions.widthCm, dimensions.heightCm].filter((value) => Number(value || 0) > 0);
  const weightGram = optionalInteger(form.weightGram) || 0;
  const leadTimeDays = optionalInteger(form.leadTimeDays) || 0;
  const hasSupplier = Boolean(form.supplier.trim());
  const chips = [
    dimensionValues.length === 3 ? `${dimensions.lengthCm}x${dimensions.widthCm}x${dimensions.heightCm}cm` : "尺寸待补",
    weightGram > 0 ? `${weightGram}g` : "重量待补",
    leadTimeDays > 0 ? `${leadTimeDays}天交期` : "交期待补",
    hasSupplier ? "有供应商" : "缺供应商",
  ];
  if (form.dimensions.trim() && dimensionValues.length < 3) {
    return {
      tone: "blocked",
      label: "规格不完整",
      detail: "尺寸需要长、宽、高都填完整，否则礼盒装配和真实摆拍比例容易出错。",
      chips,
    };
  }
  if (form.weightGram.trim() && weightGram <= 0) {
    return {
      tone: "blocked",
      label: "重量异常",
      detail: "重量必须大于 0，物流成本和交付判断才可信。",
      chips,
    };
  }
  if (form.leadTimeDays.trim() && leadTimeDays <= 0) {
    return {
      tone: "blocked",
      label: "交期异常",
      detail: "交期必须大于 0 天，避免客服给客户承诺错误时间。",
      chips,
    };
  }
  if (!dimensionValues.length || weightGram <= 0 || leadTimeDays <= 0 || !hasSupplier) {
    return {
      tone: "review",
      label: "交付资料待补",
      detail: "补齐尺寸、重量、交期和供应商后，系统才能更稳地做装盒、物流和报价判断。",
      chips,
    };
  }
  if (leadTimeDays > 45) {
    return {
      tone: "review",
      label: "交期偏长",
      detail: "交期超过 45 天，自动报价或回复客户前建议人工确认能否接受。",
      chips,
    };
  }
  return {
    tone: "ready",
    label: "规格可用",
    detail: "包装尺寸、物流重量、供应商和交期已具备真实业务判断基础。",
    chips,
  };
}

function skuImportRowReadiness(row: SkuPayload, issues: SkuCatalogAudit["issues"] = []) {
  const issueMessages = issues.slice(0, 2).map((issue) => issue.message).filter(Boolean);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const salePrice = Number(row.salePrice || 0);
  const costPrice = Number(row.costPrice || 0);
  const profit = salePrice - costPrice;
  const dimensions = row.dimensions || {};
  const dimensionReady = [dimensions.lengthCm, dimensions.widthCm, dimensions.heightCm].every((value) => Number(value || 0) > 0);
  const chips = [
    row.mainImagePath ? "有主图" : "缺主图",
    Number(row.stock || 0) > 0 ? `库存 ${row.stock}` : "无库存",
    salePrice > 0 && costPrice > 0 && profit >= 0 ? `毛利 ${formatMoney(profit)}` : "利润待核",
    dimensionReady ? "尺寸完整" : "尺寸待补",
    Number(row.leadTimeDays || 0) > 0 ? `${row.leadTimeDays}天交期` : "交期待补",
  ];
  if (errorCount) {
    return {
      tone: "blocked",
      label: "入库会阻塞",
      detail: issueMessages.join("；") || "存在严重资料问题，先修正再入库。",
      chips,
    };
  }
  if (warningCount || salePrice <= 0 || costPrice <= 0 || profit < 0 || !row.mainImagePath || !dimensionReady) {
    return {
      tone: "review",
      label: "入库后复核",
      detail: issueMessages.join("；") || "价格、图片、库存或规格还不完整，入库后需要补齐。",
      chips,
    };
  }
  return {
    tone: "ready",
    label: "可入库自动用",
    detail: "基础经营资料完整，入库后可进入自动搭配、出图和报价判断。",
    chips,
  };
}

function skuImportIssuesForRow(row: SkuPayload, issues: SkuCatalogAudit["issues"] = []) {
  return issues.filter((issue) => (
    (row.skuCode && issue.skuCode === row.skuCode) || (!row.skuCode && row.name && issue.name === row.name)
  ));
}

function skuImportPreviewReadinessSummary(rows: SkuPayload[] = [], issues: SkuCatalogAudit["issues"] = []) {
  const counts = { ready: 0, review: 0, blocked: 0 };
  for (const row of rows) {
    const readiness = skuImportRowReadiness(row, skuImportIssuesForRow(row, issues));
    counts[readiness.tone as keyof typeof counts] += 1;
  }
  const total = rows.length;
  const tone = counts.blocked ? "blocked" : counts.review ? "review" : total ? "ready" : "muted";
  const label = counts.blocked ? "先修阻塞项" : counts.review ? "建议复核后入库" : total ? "可直接入库" : "暂无预览";
  const detail = total
    ? `本批 ${total} 个商品：可自动用 ${counts.ready} 个，需复核 ${counts.review} 个，阻塞 ${counts.blocked} 个。`
    : "粘贴或选择商品表格后，系统会统计这批商品能否直接进入自动化。";
  return { ...counts, total, tone, label, detail };
}

function imageReferenceProblem(value: string, label: string) {
  const pathValue = value.trim();
  if (!pathValue) return "";
  const dataUriMatch = pathValue.match(/^data:([^;,]+)[;,]/i);
  if (dataUriMatch) return dataUriMatch[1].toLowerCase().startsWith("image/") ? "" : `${label}不是图片 data URI`;
  const withoutQuery = pathValue.split(/[?#]/)[0] || pathValue;
  const extensionMatch = withoutQuery.match(/\.([a-z0-9]+)$/i);
  if (!extensionMatch) return "";
  const extension = extensionMatch[1].toLowerCase();
  const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif"]);
  return imageExtensions.has(extension) ? "" : `${label}不是支持的图片格式`;
}

function parseMoney(value: string) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseInteger(value: string) {
  const number = parseMoney(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function optionalInteger(value: string) {
  const trimmed = String(value || "").trim();
  return trimmed ? parseInteger(trimmed) : undefined;
}

function parseDimensionsText(value: string): Record<string, number> {
  const numbers = String(value || "").match(/\d+(?:\.\d+)?/g) || [];
  if (!numbers.length) return {};
  return {
    lengthCm: Number(numbers[0]),
    widthCm: Number(numbers[1] || 0),
    heightCm: Number(numbers[2] || 0),
  };
}

function dimensionsToText(value?: Record<string, unknown>) {
  if (!value) return "";
  const length = value.lengthCm ?? value.length ?? "";
  const width = value.widthCm ?? value.width ?? "";
  const height = value.heightCm ?? value.height ?? "";
  return [length, width, height].filter((item) => item !== "").join("*");
}

function parseMatchingRulesText(value: string): Record<string, unknown> {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { notes: text };
  } catch {
    return { notes: text };
  }
}

function matchingRuleListText(value: string, key: "mustWith" | "preferWith" | "cannotWith") {
  const rules = parseMatchingRulesText(value);
  return unknownListToText(rules[key]);
}

function withMatchingRuleList(value: string, key: "mustWith" | "preferWith" | "cannotWith", nextText: string) {
  const rules = parseMatchingRulesText(value);
  const nextList = splitTextList(nextText);
  if (nextList.length) {
    rules[key] = nextList;
  } else {
    delete rules[key];
  }
  return matchingRulesToText(rules);
}

function appendSkuCodeTextList(value: string, skuCode: string) {
  const nextCode = skuCode.trim();
  if (!nextCode) return value;
  const items = splitTextList(value);
  if (!items.includes(nextCode)) items.push(nextCode);
  return items.join("、");
}

function withAppendedMatchingRuleSku(value: string, key: "mustWith" | "preferWith" | "cannotWith", skuCode: string) {
  return withMatchingRuleList(value, key, appendSkuCodeTextList(matchingRuleListText(value, key), skuCode));
}

function unknownListToText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("、");
  if (typeof value === "string") return splitTextList(value).join("、");
  return "";
}

function validateSkuFormReferences(form: SkuForm, knownSkuCodes: Set<string>) {
  const currentSkuCode = form.skuCode.trim();
  const warnings: Array<{ field: string; skuCode: string; message: string }> = [];
  const checkCodes = (field: string, label: string, codes: string[]) => {
    for (const skuCode of codes) {
      if (!skuCode) continue;
      if (currentSkuCode && skuCode === currentSkuCode) {
        warnings.push({ field, skuCode, message: `${label}不能指向自己：${skuCode}` });
      } else if (!knownSkuCodes.has(skuCode)) {
        warnings.push({ field, skuCode, message: `${label}里找不到这个 SKU：${skuCode}` });
      }
    }
  };
  checkCodes("replacementSkuCodes", "替代 SKU", splitTextList(form.replacementSkuCodes));
  checkCodes("mustWith", "必须同搭", splitTextList(matchingRuleListText(form.matchingRules, "mustWith")));
  checkCodes("preferWith", "推荐同搭", splitTextList(matchingRuleListText(form.matchingRules, "preferWith")));
  checkCodes("cannotWith", "禁止同搭", splitTextList(matchingRuleListText(form.matchingRules, "cannotWith")));
  return warnings;
}

function skuFormReferenceSummary(form: SkuForm, skuNameByCode: Map<string, string>) {
  const currentSkuCode = form.skuCode.trim();
  const collect = (field: string, label: string, codes: string[]) =>
    codes
      .filter((skuCode) => skuCode && skuCode !== currentSkuCode && skuNameByCode.has(skuCode))
      .map((skuCode) => ({
        field,
        skuCode,
        label,
        name: skuNameByCode.get(skuCode) || skuCode,
      }));
  return [
    ...collect("replacementSkuCodes", "替代", splitTextList(form.replacementSkuCodes)),
    ...collect("mustWith", "必须同搭", splitTextList(matchingRuleListText(form.matchingRules, "mustWith"))),
    ...collect("preferWith", "推荐同搭", splitTextList(matchingRuleListText(form.matchingRules, "preferWith"))),
    ...collect("cannotWith", "禁止同搭", splitTextList(matchingRuleListText(form.matchingRules, "cannotWith"))),
  ];
}

function skuAutomationSummary(sku: Sku, issues: SkuCatalogAudit["issues"]) {
  if (sku.isActive === false) {
    return { tone: "muted", label: "已下架", detail: "不会参与自动搭配和报价" };
  }
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  if (blockingIssues.length) {
    return { tone: "blocked", label: "不能自动", detail: blockingIssues.slice(0, 2).map((issue) => issue.message).join("；") };
  }
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  if (warningIssues.length) {
    return { tone: "review", label: "需复核", detail: warningIssues.slice(0, 2).map((issue) => issue.message).join("；") };
  }
  const details = [
    sku.mainImagePath ? "可出图" : "待补图",
    Number(sku.stock || 0) > 0 ? `库存 ${sku.stock}` : "无库存",
    Number(sku.salePrice || 0) > Number(sku.costPrice || 0) ? "有毛利" : "毛利待核",
  ];
  return { tone: "ready", label: "可自动", detail: details.join(" · ") };
}

function skuRepairItemMatchesFilter(item: SkuRepairQueueItem, filter: string) {
  if (filter === "all") return true;
  if (filter === "blocking") return item.blocking || item.severity === "error";
  if (filter === "review") return !item.blocking && item.severity !== "error";
  const issueCodes = new Set(item.issues.map((issue) => issue.code));
  const missingFields = new Set(item.missingFields.map((field) => field.field));
  if (filter === "image") {
    return ["mainImagePath", "angleImages"].some((field) => missingFields.has(field)) ||
      item.issues.some((issue) => Boolean(issue.imageRole) || issue.code.includes("image"));
  }
  if (filter === "price_stock") {
    return ["costPrice", "salePrice", "stock"].some((field) => missingFields.has(field)) ||
      ["invalid_cost_price", "negative_margin", "low_margin_rate", "low_stock", "out_of_stock"].some((code) => issueCodes.has(code));
  }
  if (filter === "spec_delivery") {
    return ["dimensions", "weightGram", "supplier", "leadTimeDays"].some((field) => missingFields.has(field)) ||
      ["missing_dimensions", "incomplete_dimensions", "invalid_dimensions", "missing_weight", "invalid_weight", "invalid_lead_time", "long_lead_time"].some((code) => issueCodes.has(code));
  }
  if (filter === "rules") {
    return ["replacementSkuCodes", "matchingRules", "type", "skuCode", "name"].some((field) => missingFields.has(field)) ||
      ["invalid_replacement_sku", "self_replacement_sku", "invalid_matching_rule_sku", "self_matching_rule_sku", "missing_sku_type", "invalid_sku_type", "duplicate_sku_code", "duplicate_name", "unsafe_sku_code", "sku_code_whitespace"].some((code) => issueCodes.has(code));
  }
  return true;
}

function skuRepairItemMatchesSearch(item: SkuRepairQueueItem, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return [
    item.skuCode,
    item.name,
    item.type,
    skuSeverityLabel(item.severity),
    item.recommendedAction,
    item.blocking ? "影响自动化 出图 报价" : "待复核",
    ...item.missingFields.flatMap((field) => [
      field.field,
      field.label,
      field.action,
      skuFieldLabel(field.field),
    ]),
    ...item.issues.flatMap((issue) => [
      issue.code,
      issue.field,
      issue.message,
      issue.imageRole,
      skuFieldLabel(issue.field || ""),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(keyword);
}

function sortSkuRepairQueue(items: SkuRepairQueueItem[], sortBy: string) {
  const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return [...items].sort((left, right) => {
    if (sortBy === "issue_count") {
      return (right.issueCount || 0) - (left.issueCount || 0) || (left.priority || 0) - (right.priority || 0);
    }
    if (sortBy === "name") {
      return (left.name || left.skuCode || "").localeCompare(right.name || right.skuCode || "", "zh-Hans-CN");
    }
    return (
      (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) ||
      (left.priority || 0) - (right.priority || 0) ||
      (right.issueCount || 0) - (left.issueCount || 0)
    );
  });
}

function skuImageProblemMatchesSearch(problem: SkuImageProblem, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return [
    problem.skuCode,
    problem.name,
    problem.code,
    problem.field,
    problem.message,
    problem.path,
    problem.imageRole,
    skuImageProblemTrackingId(problem),
    skuSeverityLabel(problem.severity),
    skuFieldLabel(problem.field),
    skuImageRoleLabel(problem),
    skuImageProblemAction(problem),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(keyword);
}

function skuImageProblemMatchesSeverity(problem: SkuImageProblem, filter: string) {
  if (filter === "all") return true;
  return problem.severity === filter;
}

function skuImageProblemMatchesPath(problem: SkuImageProblem, filter: string) {
  if (filter === "all") return true;
  if (filter === "has_path") return Boolean(problem.path);
  if (filter === "missing_path") return !problem.path;
  return true;
}

function skuImageProblemMatchesAction(problem: SkuImageProblem, filter: string) {
  if (filter === "all") return true;
  if (filter === "upload_main") return problem.imageRole === "main" && !problem.code.includes("invalid");
  if (filter === "upload_angle") return problem.imageRole === "angle" && !problem.code.includes("invalid");
  if (filter === "review_invalid") return problem.code.includes("invalid");
  return true;
}

function sortSkuImageProblems(problems: SkuImageProblem[], sortBy: string, countByProduct = new Map<string, number>()) {
  const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const roleRank: Record<string, number> = { main: 0, angle: 1 };
  return [...problems].sort((left, right) => {
    if (sortBy === "product_issue_count") {
      return (
        (countByProduct.get(right.skuCode || right.name) || 0) - (countByProduct.get(left.skuCode || left.name) || 0) ||
        (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) ||
        (left.skuCode || "").localeCompare(right.skuCode || "", "zh-Hans-CN") ||
        (roleRank[left.imageRole || ""] ?? 9) - (roleRank[right.imageRole || ""] ?? 9)
      );
    }
    if (sortBy === "image_role") {
      return (
        (roleRank[left.imageRole || ""] ?? 9) - (roleRank[right.imageRole || ""] ?? 9) ||
        (left.imageIndex ?? -1) - (right.imageIndex ?? -1) ||
        (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9)
      );
    }
    if (sortBy === "path_state") {
      return (
        Number(Boolean(left.path)) - Number(Boolean(right.path)) ||
        (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) ||
        (left.skuCode || "").localeCompare(right.skuCode || "", "zh-Hans-CN") ||
        (roleRank[left.imageRole || ""] ?? 9) - (roleRank[right.imageRole || ""] ?? 9)
      );
    }
    if (sortBy === "name") {
      return (left.name || left.skuCode || "").localeCompare(right.name || right.skuCode || "", "zh-Hans-CN");
    }
    return (
      (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) ||
      (left.skuCode || "").localeCompare(right.skuCode || "", "zh-Hans-CN") ||
      (roleRank[left.imageRole || ""] ?? 9) - (roleRank[right.imageRole || ""] ?? 9)
    );
  });
}

function skuFormFieldTargetId(field: string) {
  const normalized = field.trim();
  const aliases: Record<string, string> = {
    type: "sku-form-type",
    matchingRules: "sku-form-matching-rules",
    mustWith: "sku-form-matching-must-with",
    preferWith: "sku-form-matching-prefer-with",
    cannotWith: "sku-form-matching-cannot-with",
  };
  return aliases[normalized] || `sku-form-${normalized}`;
}

function skuFormFieldHasUsableValue(form: SkuForm, field: string) {
  if (field === "skuCode") return Boolean(form.skuCode.trim());
  if (field === "name") return Boolean(form.name.trim());
  if (field === "type") return Boolean(form.type);
  if (field === "category") return Boolean(form.category.trim());
  if (field === "salePrice") return parseMoney(form.salePrice) > 0;
  if (field === "costPrice") return parseMoney(form.costPrice) > 0;
  if (field === "stock") return parseInteger(form.stock) > 0;
  if (field === "sceneTags") return splitTextList(form.sceneTags).length > 0;
  if (field === "mainImagePath") return Boolean(form.mainImagePath.trim());
  if (field === "angleImages") return splitTextList(form.angleImages).length > 0;
  if (field === "dimensions") return Object.keys(parseDimensionsText(form.dimensions)).length > 0;
  if (field === "weightGram") return (optionalInteger(form.weightGram) || 0) > 0;
  if (field === "material") return Boolean(form.material.trim());
  if (field === "supplier") return Boolean(form.supplier.trim());
  if (field === "leadTimeDays") return (optionalInteger(form.leadTimeDays) || 0) > 0;
  if (field === "replacementSkuCodes") return true;
  if (field === "matchingRules") return true;
  if (field === "mustWith") return true;
  if (field === "preferWith") return true;
  if (field === "cannotWith") return true;
  return true;
}

function matchingRulesToText(value?: Record<string, unknown>) {
  if (!value || !Object.keys(value).length) return "";
  if (typeof value.notes === "string" && Object.keys(value).length === 1) return value.notes;
  return JSON.stringify(value);
}

function designPlatformAdapterLabel(adapter?: string) {
  if (adapter === "art_image_local") return "真实设计平台";
  if (adapter === "standard_v1") return "标准接口/mock";
  if (adapter === "unknown") return "未知配置";
  return adapter || "未配置";
}

function designPlatformDefaultBaseUrl(adapter?: string) {
  return adapter === "art_image_local" ? ART_IMAGE_LOCAL_DEFAULT_BASE_URL : STANDARD_V1_DEFAULT_BASE_URL;
}

function shouldUseDesignPlatformDefaultBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim();
  return !normalized || normalized === ART_IMAGE_LOCAL_DEFAULT_BASE_URL || normalized === STANDARD_V1_DEFAULT_BASE_URL;
}

function buildDesignPlatformOperationGuide(options: {
  config?: DesignPlatformConfigSummary | null;
  form: DesignPlatformConfigForm;
  health?: DesignPlatformHealth | null;
  readiness?: DesignPlatformReadiness | null;
}): { tone: "info" | "warning"; title: string; detail: string; meta: string } | null {
  const adapter = options.readiness?.adapter || options.config?.adapter || options.form.adapter;
  const baseUrl =
    options.readiness?.baseUrl ||
    options.health?.baseUrl ||
    options.config?.baseUrl ||
    options.form.baseUrl ||
    designPlatformDefaultBaseUrl(adapter);
  if (adapter === "standard_v1") {
    return {
      tone: "info",
      title: "当前是流程联调模式",
      detail:
        `现在连接 ${baseUrl}，可以验证客服平台出图流程，但不会调用真实设计平台。要真实出图，请先启动 run_desktop_real_design.bat，或在 desktop 目录执行 npm.cmd run ports:launch:real:confirmed。`,
      meta: "Mock 模式不需要设计平台登录、设备激活和真实图片账号。",
    };
  }
  if (options.readiness && !options.readiness.canSubmitFormalGeneration) {
    const nextStep =
      options.readiness.nextSteps[0] ||
      options.health?.errorMessage ||
      "设计平台没有通过登录态、设备激活或健康检查。";
    return {
      tone: "warning",
      title: "真实出图还没就绪",
      detail:
        `先确认真实设计平台已在 ${baseUrl} 打开，再运行 run_desktop_real_design.bat；如果只想用命令行启动，在 desktop 目录执行 npm.cmd run ports:launch:real:confirmed。`,
      meta: nextStep,
    };
  }
  if (options.health && !options.health.ok) {
    return {
      tone: "warning",
      title: "设计平台连接失败",
      detail:
        `当前真实平台地址是 ${baseUrl}。请先启动真实设计平台，再运行 run_desktop_real_design.bat 或 npm.cmd run ports:launch:real:confirmed 后重新检测。`,
      meta: options.health.errorMessage || "健康检查失败。",
    };
  }
  return null;
}

function runtimeConfigDisplayName(path?: string) {
  if (!path) return "运行时配置未加载";
  const parts = path.split(/[\\/]/).filter(Boolean);
  const fileName = parts[parts.length - 1] || "design-platform-config.json";
  return `本地运行配置 · ${fileName}`;
}

function createDesignPlatformDeviceId() {
  const randomUuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : randomHexToken(16);
  return `smart-kefu-${randomUuid}`.toLowerCase();
}

function randomHexToken(byteLength: number) {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export default function HomePage() {
  function designImageSendBlockReason(job: DesignJob, options: { allowHighValueManualApproval?: boolean } = {}) {
    const images = job.images || [];
    const localImageCount = images.filter((image) => Boolean(image.localPath)).length;
    if (!images.length) return "还没有候选图";
    if (localImageCount !== images.length) return `还有 ${images.length - localImageCount} 张图没有本地文件`;
    if (!job.wechatAccountId || !job.customerId || !job.conversationId) return "缺少微信账号、客户或会话绑定";
    if (isHighValueDesignJob(job) && !options.allowHighValueManualApproval) return "高价值客户需要人工审核后再发送";
    if (["failed", "timeout", "cancelled"].includes(job.status)) return "任务状态不允许直接发图";
    return "";
  }

  const [jobs, setJobs] = useState<DesignJob[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [catalogAudit, setCatalogAudit] = useState<SkuCatalogAudit | null>(null);
  const [skuCatalogAuditRefreshSummary, setSkuCatalogAuditRefreshSummary] = useState<string>("");
  const [skuCatalogAuditRefreshAt, setSkuCatalogAuditRefreshAt] = useState<string>("");
  const [skuChangeLogs, setSkuChangeLogs] = useState<SkuChangeLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chatImports, setChatImports] = useState<ChatImport[]>([]);
  const [trainingSamples, setTrainingSamples] = useState<TrainingSample[]>([]);
  const [latestTrainingCorrectionSamples, setLatestTrainingCorrectionSamples] = useState<TrainingSample[]>([]);
  const [trainingOverview, setTrainingOverview] = useState<TrainingOverview | null>(null);
  const [skillSuggestions, setSkillSuggestions] = useState<SkillSuggestion[]>([]);
  const [selectedSkillSuggestionKeys, setSelectedSkillSuggestionKeys] = useState<string[]>([]);
  const [skillSuggestionAgentFilter, setSkillSuggestionAgentFilter] = useState<string>("all");
  const [skillSuggestionSafetyFilter, setSkillSuggestionSafetyFilter] = useState<"all" | "safe" | "review" | "blocked">("all");
  const [skillApplySummary, setSkillApplySummary] = useState<string>("");
  const [trainingSampleQualityFilter, setTrainingSampleQualityFilter] = useState<TrainingSampleQualityFilter>("all");
  const [trainingSampleImportFilterId, setTrainingSampleImportFilterId] = useState<string>("");
  const [trainingSampleLimit, setTrainingSampleLimit] = useState<number>(TRAINING_SAMPLE_PAGE_SIZE);
  const [skuChangeImpactFilter, setSkuChangeImpactFilter] = useState<string>("all");
  const [skuChangeSearch, setSkuChangeSearch] = useState<string>("");
  const [editingSampleId, setEditingSampleId] = useState<string>("");
  const [sampleEdit, setSampleEdit] = useState<TrainingSampleEdit | null>(null);
  const [selectedTrainingSampleIds, setSelectedTrainingSampleIds] = useState<string[]>([]);
  const [wechatAccounts, setWechatAccounts] = useState<WechatAccount[]>([]);
  const [wechatChannelStatus, setWechatChannelStatus] = useState<WechatChannelStatus | null>(null);
  const [trainingWorkbenchView, setTrainingWorkbenchView] = useState<"import" | "review" | "skills">("import");
  const [wechatWorkbenchView, setWechatWorkbenchView] = useState<"channels" | "flow" | "config">("channels");
  const [sendWorkbenchView, setSendWorkbenchView] = useState<"queue" | "blocked" | "diagnostics">("queue");
  const [reviewWorkbenchView, setReviewWorkbenchView] = useState<"handoff" | "design" | "quote" | "order" | "logs">("handoff");
  const [highValueOrderReviewFilter, setHighValueOrderReviewFilter] = useState<(typeof highValueOrderReviewFilterOptions)[number]["value"]>("all");
  const [quoteWorkbenchView, setQuoteWorkbenchView] = useState<"overview" | "actions" | "quotes" | "orders">("overview");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sendTasks, setSendTasks] = useState<SendTask[]>([]);
  const [sendAttempts, setSendAttempts] = useState<SendAttempt[]>([]);
  const [sendAdapter, setSendAdapter] = useState<SendAdapterInfo | null>(null);
  const [bridgeOutbox, setBridgeOutbox] = useState<BridgeOutboxResult | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusResult | null>(null);
  const [windowSnapshots, setWindowSnapshots] = useState<WechatWindowSnapshot[]>([]);
  const [windowObserverStatus, setWindowObserverStatus] = useState<WindowObserverStatus | null>(null);
  const [routeEvaluations, setRouteEvaluations] = useState<RouteEvaluation[]>([]);
  const [quotes, setQuotes] = useState<QuoteDraft[]>([]);
  const [orderDrafts, setOrderDrafts] = useState<OrderDraft[]>([]);
  const [activeQuotePreview, setActiveQuotePreview] = useState<QuotePreview | null>(null);
  const [quoteCenterPreviewId, setQuoteCenterPreviewId] = useState("");
  const [quoteCenterPreview, setQuoteCenterPreview] = useState<QuotePreview | null>(null);
  const [orderConfirmationPreviewId, setOrderConfirmationPreviewId] = useState("");
  const [orderConfirmationPreview, setOrderConfirmationPreview] = useState<OrderConfirmationPreview | null>(null);
  const [quoteEdit, setQuoteEdit] = useState({
    quantity: "",
    unitPrice: "",
    totalCost: "",
    customerNotes: "",
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [reviewCenter, setReviewCenter] = useState<ReviewCenter>({ designJobs: [], quoteDrafts: [], orderDrafts: [], logs: [] });
  const [designAssets, setDesignAssets] = useState<DesignAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [platformHealth, setPlatformHealth] = useState<DesignPlatformHealth | null>(null);
  const [platformReadiness, setPlatformReadiness] = useState<DesignPlatformReadiness | null>(null);
  const [platformConfig, setPlatformConfig] = useState<DesignPlatformConfigSummary | null>(null);
  const [platformConfigForm, setPlatformConfigForm] = useState<DesignPlatformConfigForm>(emptyDesignPlatformConfigForm);
  const [platformLoginForm, setPlatformLoginForm] = useState<DesignPlatformLoginForm>(emptyDesignPlatformLoginForm);
  const [platformActivationForm, setPlatformActivationForm] =
    useState<DesignPlatformActivationForm>(emptyDesignPlatformActivationForm);
  const [platformSmokeTest, setPlatformSmokeTest] = useState<DesignPlatformSmokeTestResult | null>(null);
  const [preflightResult, setPreflightResult] = useState<DesignJobPreflightResult | null>(null);
  const [designAutoRefreshSummary, setDesignAutoRefreshSummary] = useState<string>("");
  const [designAutoRefreshAt, setDesignAutoRefreshAt] = useState<string>("");
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [automationReadiness, setAutomationReadiness] = useState<AutomationReadiness | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState<string>("本地演示模式：先创建任务，再提交出图，约 3 秒后刷新候选图。");
  const [chatText, setChatText] = useState<string>(`客户：端午礼盒预算180，先看效果图。
客服：按员工福利场景搭配礼盒。
客服：出真实摆拍效果图给您挑。
客户：快递一直不动怎么办？
客服：先查物流，停滞就催件或补发。`);
  const [routeText, setRouteText] = useState<string>("端午员工福利礼盒，每盒180元，做50份，想看真实摆拍效果图，logo已发");
  const [inboundSummary, setInboundSummary] = useState<string>("");
  const [selectionText, setSelectionText] = useState<string>("我选第1张");
  const [revisionText, setRevisionText] = useState<string>("把Logo放大一点，背景换成更清爽的浅色，礼盒整体摆放更高级");
  const [skuSearch, setSkuSearch] = useState<string>("");
  const [skuTypeFilter, setSkuTypeFilter] = useState<string>("all");
  const [skuIssueFilter, setSkuIssueFilter] = useState<string>("all");
  const [skuRepairFilter, setSkuRepairFilter] = useState<string>("all");
  const [skuRepairSearch, setSkuRepairSearch] = useState<string>("");
  const [skuRepairSort, setSkuRepairSort] = useState<string>("priority");
  const [skuImageProblemSeverityFilter, setSkuImageProblemSeverityFilter] = useState<string>("all");
  const [skuImageProblemPathFilter, setSkuImageProblemPathFilter] = useState<string>("all");
  const [skuImageProblemActionFilter, setSkuImageProblemActionFilter] = useState<string>("all");
  const [skuImageProblemSearch, setSkuImageProblemSearch] = useState<string>("");
  const [skuImageProblemSort, setSkuImageProblemSort] = useState<string>("severity");
  const [skuImageProblemProductScope, setSkuImageProblemProductScope] = useState<string>("all");
  const [skuImageProblemVisibleLimit, setSkuImageProblemVisibleLimit] = useState<number>(SKU_IMAGE_PROBLEM_PAGE_SIZE);
  const [skuForm, setSkuForm] = useState<SkuForm>(emptySkuForm);
  const [skuWorkbenchView, setSkuWorkbenchView] = useState<"catalog" | "repair" | "editor">("catalog");
  const [catalogWorkbenchView, setCatalogWorkbenchView] = useState<"import" | "preview" | "audit" | "bundle">("import");
  const [includeInactiveSkus, setIncludeInactiveSkus] = useState<boolean>(false);
  const [selectedSkuCodes, setSelectedSkuCodes] = useState<string[]>([]);
  const [skuBatchStock, setSkuBatchStock] = useState<string>("");
  const [skuBatchSalePrice, setSkuBatchSalePrice] = useState<string>("");
  const [skuBatchSupplier, setSkuBatchSupplier] = useState<string>("");
  const [quoteCenterSearch, setQuoteCenterSearch] = useState<string>("");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>("all");
  const [quotePaymentFilter, setQuotePaymentFilter] = useState<string>("all");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");
  const [orderPaymentFilter, setOrderPaymentFilter] = useState<string>("all");
  const [dealNextStepFilter, setDealNextStepFilter] = useState<string>("all");
  const [dealProgressFilter, setDealProgressFilter] = useState<string>("all");
  const [activeWorkspaceSection, setActiveWorkspaceSection] = useState<string>("design-center");
  const [noticeWorkbenchView, setNoticeWorkbenchView] = useState<"automation" | "issues" | "history">("automation");
  const [activeAutomationIssueKey, setActiveAutomationIssueKey] = useState<string>("");
  const [skuImportText, setSkuImportText] = useState<string>(`SKU编号\t商品名称\t商品类型\t分类\t成本价\t售价\t库存\t场景标签\t主图\t多角度图\t尺寸\t重量g\t材质\t供应商\t交期天数\t替代SKU\t搭配规则
BOX-B\t雅黑礼盒B\t礼盒\t礼盒\t40\t80\t20\t员工福利、客户拜访\tC:\\products\\box-b-main.jpg\tC:\\products\\box-b-side.jpg、C:\\products\\box-b-open.jpg\t30*22*9\t650\t特种纸\t杭州礼盒厂\t5\tBOX-A\t{"preferWith":["TEA-C","CARD-B"]}
TEA-C\t乌龙茶C\t内搭\t茶叶\t55\t120\t15\t员工福利\tC:\\products\\tea-c-main.jpg\tC:\\products\\tea-c-detail.jpg\t12*8*18\t300\t茶叶\t福建茶业供应商\t3\t\t适合与礼盒和感谢卡搭配
CARD-B\t感谢卡B\t配件\t贺卡\t3\t12\t200\t客户拜访\tC:\\products\\card-b-main.jpg\t\t10*15\t20\t纸张\t本地印刷厂\t2\t\t{"mustWith":["BOX-B"]}`);
  const [skuImportFields, setSkuImportFields] = useState<SkuImportField[]>([]);
  const [skuImportPreview, setSkuImportPreview] = useState<SkuImportResult | null>(null);
  const [bundleResult, setBundleResult] = useState<BundleRecommendation | null>(null);

  function orderFollowupBlockReason(order: OrderDraft, type: "production" | "delivery") {
    if (order.status === "cancelled") return "订单已取消，不能发送跟进消息。";
    if (orderStrictIdentityMissing(order)) return orderStrictIdentityBlockReason("发送跟进消息");
    if (!orderPaymentReady(order)) return "订单未记录定金或全款，先核验付款凭证后再发送跟进消息。";
    if (!orderSelectedImageIdValue(order)) return "订单未绑定客户选中的效果图，不能发送跟进消息。";
    if (type === "production" && !["confirmed", "processing", "fulfilled"].includes(order.status)) {
      return "订单还未确认，先确认订单或收款后再发生产通知。";
    }
    if (type === "delivery" && !["processing", "fulfilled"].includes(order.status)) {
      return "订单还未进入生产/交付阶段，先更新到生产中后再发交期说明。";
    }
    const task = orderFollowupTask(order, type);
    if (task && !["failed", "cancelled"].includes(task.status)) {
      return `跟进消息${sendStatusLabel(task.status)}，不能重复入队。`;
    }
    return "";
  }

  function orderFollowupButtonTitle(order: OrderDraft, type: "production" | "delivery") {
    const task = orderFollowupTask(order, type);
    if (canRequeueOrderFollowupTask(order, type)) {
      return `${orderFollowupStageLabel(type)}任务${sendStatusLabel(task?.status || "")}，点击重新排队`;
    }
    return orderFollowupBlockReason(order, type) || (type === "delivery" ? "生成交期说明并放入微信安全发送队列" : "生成生产进度通知并放入微信安全发送队列");
  }

  async function load(identityFilterOverride?: { wechatAccountId?: string; conversationId?: string; customerId?: string } | null) {
    const activeConversationFilter =
      identityFilterOverride === undefined && activeConversationId
        ? conversations.find((conversation) => conversation.id === activeConversationId)
        : null;
    const identityFilters =
      identityFilterOverride === null
        ? {}
        : identityFilterOverride ||
          (activeConversationFilter
            ? {
                wechatAccountId: activeConversationFilter.wechatAccountId,
                conversationId: activeConversationFilter.id,
                customerId: activeConversationFilter.customerId,
              }
            : {});
    const [jobRows, skuRows, auditRows, skuLogRows, agentRows, importRows, sampleRows, correctionSampleRows, overviewRows, suggestionRows, accountRows, channelStatusRows, conversationRows, sendRows, attemptRows, adapterInfo, bridgeRows, bridgeStatusRows, windowRows, windowObserverRows, routeRows, quoteRows, orderRows, noticeRows, reviewRows, health, readiness, configResult, automation, automationReadinessResult] = await Promise.all([
      getDesignJobs(identityFilters),
      getSkus(includeInactiveSkus),
      getSkuCatalogAudit(),
      getSkuChangeLogs(30),
      getAgents(identityFilters),
      getChatImports(identityFilters),
      getTrainingSamples({
        ...identityFilters,
        quality: trainingSampleApiQualityFilter(trainingSampleQualityFilter),
        importId: trainingSampleImportFilterId || undefined,
        limit: trainingSampleLimit,
      }),
      getTrainingSamples({ ...identityFilters, sourceType: "route_correction", limit: 3 }),
      getTrainingOverview(identityFilters),
      getSkillSuggestions(identityFilters),
      getWechatAccounts(),
      getWechatChannelStatus(identityFilters).catch(() => null as WechatChannelStatus | null),
      getWechatConversations(),
      getSendTasks(identityFilters),
      getSendAttempts(undefined, identityFilters),
      getSendAdapter(),
      getBridgeOutbox(identityFilters).catch(() => ({ pending: [], ignored: [] })),
      getBridgeStatus(identityFilters).catch(() => ({
        adapter: {
          name: "windows_bridge",
          label: "Windows 微信桥接适配器",
          realSend: true,
          description: "桥接状态暂不可用。",
        },
        worker: { ok: false, status: "unavailable", message: "桥接状态接口不可用" },
        outbox: { pendingCount: 0, ignoredCount: 0, pending: [] },
        inbox: { pendingCount: 0, pending: [] },
        locks: { activeCount: 0, staleCount: 0, active: [] },
      })),
      getWechatWindowSnapshots(identityFilters),
      getWindowObserverStatus().catch(() => ({
        ok: false,
        status: "unavailable",
        ageSeconds: null,
        message: "窗口观察器状态接口不可用",
      })),
      getRouteEvaluations(identityFilters),
      getQuotes(identityFilters),
      getOrderDrafts(identityFilters),
      getNotifications(false, identityFilters),
      getReviewCenter(identityFilters),
      getDesignPlatformHealth().catch((error) => ({
        ok: false,
        latencyMs: 0,
        baseUrl: "",
        adapter: "unknown",
        errorMessage: error instanceof Error ? error.message : "设计平台健康检查失败",
      })),
      getDesignPlatformReadiness().catch((error) => ({
        ok: false,
        canSubmitFormalGeneration: false,
        latencyMs: 0,
        baseUrl: "",
        adapter: "unknown",
        checks: [],
        nextSteps: [error instanceof Error ? error.message : "设计平台正式出图就绪检查失败"],
        config: { hasApiKey: false, hasAccessToken: false, hasCookie: false, hasDeviceId: false },
      })),
      getDesignPlatformConfig().catch(() => ({
        ok: false,
        config: {
          adapter: "unknown",
          baseUrl: "",
          hasApiKey: false,
          hasAccessToken: false,
          hasCookie: false,
          hasDeviceId: false,
        },
      })),
      getAutomationStatus(),
      getAutomationReadiness(),
    ]);
    setJobs(jobRows);
    setSkus(skuRows);
    setCatalogAudit(auditRows);
    setSkuChangeLogs(skuLogRows);
    setAgents(agentRows);
    setChatImports(importRows);
    setTrainingSamples(sampleRows);
    setLatestTrainingCorrectionSamples(correctionSampleRows);
    setTrainingOverview(overviewRows);
    const typedSuggestionRows = suggestionRows as SkillSuggestion[];
    setSkillSuggestions(typedSuggestionRows);
    setSkillSuggestionAgentFilter((current) =>
      current === "all" || typedSuggestionRows.some((suggestion) => skillSuggestionAgentFilterKey(suggestion) === current)
        ? current
        : "all",
    );
    setSelectedSkillSuggestionKeys((current) => {
      const nextKeys = typedSuggestionRows.map(skillSuggestionKey);
      const safeKeys = typedSuggestionRows.filter(isSkillSuggestionAutoSelected).map(skillSuggestionKey);
      const validKeys = new Set(nextKeys);
      const blockedKeys = new Set(typedSuggestionRows.filter(isSkillSuggestionBlocked).map(skillSuggestionKey));
      const kept = current.filter((key) => validKeys.has(key) && !blockedKeys.has(key));
      return kept.length ? kept : safeKeys;
    });
    setWechatAccounts(accountRows);
    if (channelStatusRows) setWechatChannelStatus(channelStatusRows);
    setConversations(conversationRows);
    setSendTasks(sendRows);
    setSendAttempts(attemptRows);
    setSendAdapter(adapterInfo);
    setBridgeOutbox(bridgeRows);
    setBridgeStatus(bridgeStatusRows);
    setWindowSnapshots(windowRows);
    setWindowObserverStatus(windowObserverRows);
    setRouteEvaluations(routeRows);
    setQuotes(quoteRows);
    setOrderDrafts(orderRows);
    setNotifications(noticeRows);
    setReviewCenter(reviewRows);
    setSelectedSkuCodes((current) => current.filter((skuCode) => skuRows.some((sku) => sku.skuCode === skuCode)));
    setPlatformHealth(health);
    setPlatformReadiness(readiness);
    setPlatformConfig(configResult.config);
    setPlatformConfigForm((current) => designPlatformConfigSummaryToForm(configResult.config, current));
    setAutomationStatus(automation);
    setAutomationReadiness(automationReadinessResult);
    setActiveId((current) => current || jobRows[0]?.id || "");
    setActiveConversationId((current) => {
      if (identityFilterOverride === null) return "";
      if (current && conversationRows.some((conversation) => conversation.id === current)) return current;
      return conversationRows[0]?.id || "";
    });
  }

  function activeIdentityFilters() {
    const conversation = activeConversationId ? conversations.find((item) => item.id === activeConversationId) : null;
    return conversation
      ? {
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
        }
      : {};
  }

  async function loadWechatChannelStatusOnly(
    identityFilterOverride?: { wechatAccountId?: string; conversationId?: string; customerId?: string } | null,
  ) {
    const identityFilters = identityFilterOverride === null ? {} : identityFilterOverride || activeIdentityFilters();
    const status = await getWechatChannelStatus(identityFilters);
    setWechatChannelStatus(status);
    return status;
  }

  async function refreshSkuCatalogAuditOnly() {
    const beforeIssueCount = catalogAudit?.issueCount ?? 0;
    const beforeImageIssueCount = catalogAudit?.imageIssueCount ?? catalogAudit?.missingImageCount ?? 0;
    let nextAudit: SkuCatalogAudit | null = null;
    await runAction(
      "刷新商品审核",
      async () => {
        nextAudit = await getSkuCatalogAudit();
        setCatalogAudit(nextAudit);
      },
      () => {
        const afterIssueCount = nextAudit?.issueCount ?? 0;
        const afterImageIssueCount = nextAudit?.imageIssueCount ?? nextAudit?.missingImageCount ?? 0;
        const issueDelta = afterIssueCount - beforeIssueCount;
        const imageDelta = afterImageIssueCount - beforeImageIssueCount;
        const issueText = issueDelta === 0 ? "总问题数无变化" : `总问题数${issueDelta > 0 ? "增加" : "减少"} ${Math.abs(issueDelta)} 个`;
        const imageText = imageDelta === 0 ? "图片问题无变化" : `图片问题${imageDelta > 0 ? "增加" : "减少"} ${Math.abs(imageDelta)} 个`;
        const summary = `${issueText}，${imageText}；当前图片问题 ${afterImageIssueCount} 个`;
        setSkuCatalogAuditRefreshSummary(summary);
        setSkuCatalogAuditRefreshAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
        setMessage(`商品审核已刷新：${summary}。`);
      },
    );
  }

  async function refreshWechatWorkspaceStatus() {
    let summary = "";
    await runAction(
      "刷新微信接入",
      async () => {
        const status = await loadWechatChannelStatusOnly(null);
        summary = status
          ? `微信接入已刷新：${status.summary.ready}/${status.summary.total} 个通道就绪，${status.summary.pendingSendTasks} 个待安全发送，${status.summary.needsConfig} 个待配置。`
          : "微信接入状态暂不可用，请确认 API 服务后重试。";
      },
      () => setMessage(summary || "微信接入状态已刷新。"),
    );
  }

  function conversationIdentityExpectation(conversation: Conversation) {
    return {
      expectedWechatAccountId: conversation.wechatAccountId,
      expectedConversationId: conversation.id,
      expectedCustomerId: conversation.customerId,
    };
  }

  async function changeActiveConversation(conversationId: string) {
    const conversation = conversationId
      ? conversations.find((item) => item.id === conversationId)
      : null;
    setActiveConversationId(conversationId);
    await load(
      conversation
        ? {
            wechatAccountId: conversation.wechatAccountId,
            conversationId: conversation.id,
            customerId: conversation.customerId,
          }
        : null,
    );
  }

  async function focusConversation(conversationId: string, sectionId: string) {
    await changeActiveConversation(conversationId);
    scrollToWorkspaceSection(sectionId);
  }

  async function runAction(label: string, action: () => Promise<unknown>, after?: () => void) {
    try {
      setBusy(label);
      setMessage(`${label}中...`);
      await action();
      await load();
      setMessage(`${label}完成。`);
      after?.();
    } catch (error) {
      setMessage(`${label}失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  async function changeTrainingSampleQualityFilter(filter: TrainingSampleQualityFilter, importId = "") {
    const nextLimit = TRAINING_SAMPLE_PAGE_SIZE;
    setTrainingSampleQualityFilter(filter);
    setTrainingSampleImportFilterId(importId);
    setTrainingSampleLimit(nextLimit);
    setEditingSampleId("");
    setSampleEdit(null);
    setSelectedTrainingSampleIds([]);
    const rows = await getTrainingSamples({
      ...activeIdentityFilters(),
      quality: trainingSampleApiQualityFilter(filter),
      importId: importId || undefined,
      limit: nextLimit,
    });
    setTrainingSamples(rows);
  }

  async function changeTrainingSampleQualityFilterInReviewScope(filter: TrainingSampleQualityFilter) {
    await changeTrainingSampleQualityFilter(filter, trainingSampleImportFilterId);
  }

  async function loadMoreTrainingSamples() {
    const nextLimit = Math.min(
      filteredTrainingSampleTotal,
      Math.max(trainingSampleLimit, trainingSamples.length) + TRAINING_SAMPLE_PAGE_SIZE,
    );
    if (nextLimit <= trainingSamples.length) return;
    try {
      setBusy("加载更多训练样本");
      setMessage("加载更多训练样本中...");
      const rows = await getTrainingSamples({
        ...activeIdentityFilters(),
        quality: trainingSampleApiQualityFilter(trainingSampleQualityFilter),
        importId: trainingSampleImportFilterId || undefined,
        limit: nextLimit,
      });
      setTrainingSampleLimit(nextLimit);
      setTrainingSamples(rows);
      setMessage(`已加载 ${rows.length} / ${filteredTrainingSampleTotal} 条训练样本。`);
    } catch (error) {
      setMessage(`加载更多训练样本失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  async function createDemo() {
    if (!activeConversation) {
      setMessage("请先选择要创建演示任务的客户会话。");
      return;
    }
    await runAction("创建演示任务", async () => {
      let assetIds = selectedAssetIds.filter((assetId) => designAssets.some((asset) => asset.id === assetId));
      if (!assetIds.length) {
        const asset = await createDemoCustomerLogo(activeConversation.customerId, conversationIdentityExpectation(activeConversation));
        assetIds = [asset.id];
        setDesignAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        setSelectedAssetIds((current) => [...new Set([...current, asset.id])]);
      }
      const job = await createDemoDesignJob(
        {
          wechatAccountId: activeConversation.wechatAccountId,
          customerId: activeConversation.customerId,
          conversationId: activeConversation.id,
        },
        assetIds,
      );
      setActiveId(job.id);
    });
  }

  async function prepareDemoDesignMaterials() {
    if (!activeConversation) {
      setMessage("请先选择要处理的客户会话，系统不会默认使用第一个客户。");
      return;
    }
    let summary = "";
    await runAction(
      "准备演示出图材料",
      async () => {
        const [skuResult, asset] = await Promise.all([
          createDemoSkuImages(),
          createDemoCustomerLogo(activeConversation.customerId, conversationIdentityExpectation(activeConversation)),
        ]);
        setDesignAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        setSelectedAssetIds((current) => [...new Set([...current, asset.id])]);
        summary = `已生成 ${skuResult.count} 个演示 SKU 主图，并创建 1 个 PNG 客户素材；商业使用前请替换为真实商品图。`;
      },
      () => {
        setMessage(summary || "演示出图材料已准备。");
      },
    );
  }

  async function createLogoAsset() {
    if (!activeConversation) {
      setMessage("请先选择要生成素材的客户会话。");
      return;
    }
    await runAction("生成演示Logo素材", async () => {
      const asset = await createDemoCustomerLogo(activeConversation.customerId, conversationIdentityExpectation(activeConversation));
      setDesignAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setSelectedAssetIds((current) => [...new Set([...current, asset.id])]);
    });
  }

  async function uploadCustomerAsset(file?: File) {
    if (!file) return;
    if (!activeConversation) {
      setMessage("请先选择要上传素材的客户会话。");
      return;
    }
    const base64 = await readFileAsDataUrl(file);
    await runAction("上传客户素材", async () => {
        const asset = await uploadAsset({
          ...conversationIdentityExpectation(activeConversation),
          ownerType: "customer",
          ownerId: activeConversation.customerId,
        role: file.type.startsWith("image/") ? "reference" : "customer_file",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        source: "customer_upload",
        base64,
      });
      setDesignAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setSelectedAssetIds((current) => [...new Set([...current, asset.id])]);
    });
  }

  async function attachAssetsToActiveJob() {
    if (!activeJob || !selectedAssetIds.length) return;
    if (!activeConversation || activeJob.conversationId !== activeConversation.id) {
      setMessage("当前任务和当前客户会话不一致，不能绑定素材。");
      return;
    }
    await runAction("绑定素材到任务", () => attachDesignJobAssets(activeJob.id, selectedAssetIds, identityExpectation(activeJob)));
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  }

  async function createTimeoutDemo() {
    const targetConversation = conversations.find((conversation) => conversation.id === activeConversationId);
    if (!targetConversation) {
      setMessage("请先选择要创建演示任务的客户会话。");
      return;
    }
    await runAction("创建超时演示任务", async () => {
      const job = await createTimeoutDemoJob(targetConversation.id, conversationIdentityExpectation(targetConversation));
      setActiveId(job.id);
    });
  }

  async function createFailureDemo() {
    const targetConversation = conversations.find((conversation) => conversation.id === activeConversationId);
    if (!targetConversation) {
      setMessage("请先选择要创建演示任务的客户会话。");
      return;
    }
    await runAction("创建失败演示任务", async () => {
      const job = await createFailureDemoJob(targetConversation.id, conversationIdentityExpectation(targetConversation));
      setActiveId(job.id);
    });
  }

  async function checkDesignPlatform() {
    let summary = "";
    await runAction(
      "检测设计平台",
      async () => {
        const [health, readiness, configResult] = await Promise.all([
          getDesignPlatformHealth(),
          getDesignPlatformReadiness(),
          getDesignPlatformConfig(),
        ]);
        const adapterLabel = designPlatformAdapterLabel(health.adapter);
        setPlatformHealth(health);
        setPlatformReadiness(readiness);
        setPlatformConfig(configResult.config);
        setPlatformConfigForm((current) => designPlatformConfigSummaryToForm(configResult.config, current));
        summary = readiness.canSubmitFormalGeneration
          ? `设计平台可正式出图：${adapterLabel}，${health.baseUrl}，延迟 ${health.latencyMs}ms。`
          : readiness.nextSteps[0] ||
            (health.ok ? "设计平台在线，但正式出图就绪检查未通过。请查看顶部就绪提示。" : `设计平台离线：${health.errorMessage || "未知错误"}`);
      },
      () => setMessage(summary || "设计平台检查完成。"),
    );
  }

  async function smokeTestDesignPlatform() {
    let summary = "";
    await runAction(
      "设计平台试跑出图",
      async () => {
        const result = await runDesignPlatformSmokeTest();
        setPlatformSmokeTest(result);
        if (!result.ok) {
          throw new Error(result.errorMessage || "设计平台试跑失败");
        }
        summary = `试跑成功：上传 ${result.assetUploadCount} 个素材，返回 ${result.candidateCount} 张图，已保存 ${result.savedImageCount} 张。`;
      },
      () => setMessage(summary || "设计平台试跑出图完成。"),
    );
  }

  async function saveDesignPlatformConfig() {
    const baseUrl = platformConfigForm.baseUrl.trim();
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
      setMessage("设计平台 Base URL 需要以 http:// 或 https:// 开头。");
      return;
    }

    let summary = "";
    await runAction(
      "保存设计平台配置",
      async () => {
        const result = await updateDesignPlatformConfig(buildDesignPlatformConfigPayload(platformConfigForm));
        setPlatformConfig(result.config);
        setPlatformConfigForm(designPlatformConfigSummaryToForm(result.config));
        if (result.readiness) setPlatformReadiness(result.readiness);
        summary = `设计平台配置已保存：${designPlatformAdapterLabel(result.config.adapter)}，${result.config.baseUrl || "未设置地址"}。`;
      },
      () => setMessage(summary || "设计平台配置已保存。"),
    );
  }

  function generateDesignPlatformDeviceId() {
    const deviceId = createDesignPlatformDeviceId();
    setPlatformConfigForm((current) => ({ ...current, adapter: "art_image_local", deviceId }));
    setPlatformActivationForm((current) => ({ ...current, deviceId }));
    setPlatformLoginForm((current) => ({ ...current, deviceId }));
    setMessage("已生成客服平台设备 ID。拿这个设备 ID 对应的激活码完成激活后，再登录设计平台账号。");
  }

  async function redeemDesignPlatformDevice() {
    const code = platformActivationForm.code.trim();
    const deviceId =
      platformActivationForm.deviceId.trim() || platformConfigForm.deviceId.trim() || platformLoginForm.deviceId.trim();
    const deviceLabel = platformActivationForm.deviceLabel.trim() || "智能客服工作台";
    if (!deviceId) {
      setMessage("请先生成或填写设备 ID。设计平台需要用设备 ID 绑定激活码。");
      return;
    }
    if (!code) {
      setMessage("请填写设计平台激活码。激活码需要在设计平台后台生成。");
      return;
    }

    let summary = "";
    await runAction(
      "激活设计平台设备",
      async () => {
        const result = await redeemDesignPlatformActivation({
          code,
          deviceId,
          deviceLabel,
        });
        setPlatformConfig(result.config);
        setPlatformConfigForm(designPlatformConfigSummaryToForm(result.config));
        if (result.readiness) setPlatformReadiness(result.readiness);
        setPlatformActivationForm((current) => ({ ...current, code: "", deviceId: "" }));
        setPlatformLoginForm((current) => ({ ...current, deviceId: "" }));
        summary = result.readiness?.canSubmitFormalGeneration
          ? "设备已激活，设计平台已可正式出图。"
          : "设备激活已提交。下一步登录设计平台账号，或查看就绪提示继续补齐。";
      },
      () => setMessage(summary || "设备激活处理完成。"),
    );
  }

  async function loginDesignPlatformAccount() {
    const email = platformLoginForm.email.trim();
    const password = platformLoginForm.password;
    const deviceId = platformLoginForm.deviceId.trim() || platformConfigForm.deviceId.trim();
    if (!email || !password) {
      setMessage("请填写设计平台邮箱和密码。");
      return;
    }
    if (!deviceId && !platformConfig?.hasDeviceId) {
      setMessage("请先生成或填写设备 ID。没有设备 ID 时设计平台不会允许登录。");
      return;
    }

    let summary = "";
    await runAction(
      "登录设计平台",
      async () => {
        const result = await loginDesignPlatform({
          email,
          password,
          deviceId,
        });
        setPlatformConfig(result.config);
        setPlatformConfigForm(designPlatformConfigSummaryToForm(result.config));
        if (result.readiness) setPlatformReadiness(result.readiness);
        setPlatformLoginForm((current) => ({ ...current, password: "", deviceId: "" }));
        summary = result.user?.email ? `设计平台已登录：${result.user.email}` : "设计平台已登录，凭证已保存。";
      },
      () => setMessage(summary || "设计平台登录完成。"),
    );
  }

  async function clearDesignPlatformCredentials() {
    let summary = "";
    await runAction(
      "清空设计平台凭证",
      async () => {
        const result = await updateDesignPlatformConfig({
          accessToken: "",
          cookie: "",
          deviceId: "",
        });
        setPlatformConfig(result.config);
        setPlatformConfigForm(designPlatformConfigSummaryToForm(result.config));
        if (result.readiness) setPlatformReadiness(result.readiness);
        summary = "设计平台 Token、Cookie 和设备 ID 已清空。";
      },
      () => setMessage(summary || "设计平台凭证已清空。"),
    );
  }

    async function scanTimeouts() {
      await runAction("扫描出图超时", async () => {
        const result = await scanDesignTimeouts(activeIdentityFilters());
        setMessage(
          `扫描完成：检查 ${result.scanned} 个任务，找回 ${result.recovered || 0} 个，超时 ${result.timedOut} 个，轮询错误 ${
            result.pollErrors?.length || 0
          } 个。`,
        );
      });
    }

  async function autoSubmitDrafts() {
    let firstSubmittedId = "";
    let summary = "";
    await runAction(
        "自动提交设计草稿",
        async () => {
          const result = await autoSubmitDesignDrafts(activeIdentityFilters());
          firstSubmittedId = result.submitted[0]?.id || "";
          summary = `检查 ${result.scanned} 个草稿，提交 ${result.submitted.length} 个，跳过 ${result.skipped.length} 个，失败 ${result.failed.length} 个。`;
        },
      () => {
        if (firstSubmittedId) setActiveId(firstSubmittedId);
        setMessage(summary || "自动提交设计草稿完成。");
        if (firstSubmittedId) {
          window.setTimeout(() => {
            load();
            setMessage("已刷新自动提交后的设计结果；如果还没完成，可以稍后再刷新。");
          }, 3200);
        }
      },
    );
  }

  async function runLowValueAutomation() {
    const latestReadiness = automationReadiness || (await getAutomationReadiness());
    if (latestReadiness) setAutomationReadiness(latestReadiness);
    const firstBlocker = latestReadiness?.blockers[0];
    if (firstBlocker) {
      setMessage(`低价值自动处理暂未启动：${firstBlocker.detail}。请先处理该问题。`);
      await handleAutomationReadinessCheck(firstBlocker);
      return;
    }
    let summary = "";
    await runAction(
      "低价值自动处理",
      async () => {
        const result = await runAutomationOnce(activeIdentityFilters());
        const lowValue = result.results.lowValueAutomation as LowValueAutomationResult | undefined;
        const sendQueue = result.results.processLowValueSendQueue as SafeSendQueueResult | undefined;
        const orderDraft = result.results.scanLowValueOrderDrafts as LowValueOrderDraftResult | undefined;
        const orderConfirmation =
          result.results.scanLowValueOrderConfirmations as LowValueOrderSendResult | undefined;
        const orderFollowup =
          result.results.scanLowValueOrderFollowups as LowValueOrderFollowupResult | undefined;
        const orderCreated = (lowValue?.orderDraft?.created.length || 0) + (orderDraft?.created.length || 0);
        const orderConfirmationQueued =
          (lowValue?.orderConfirmation?.queued.length || 0) + (orderConfirmation?.queued.length || 0);
        const orderFollowupQueued =
          (lowValue?.orderFollowup?.queued.length || 0) + (orderFollowup?.queued.length || 0);
        const queueHeadBlocked = sendQueue?.skipped.filter((item) => item.reason === "not_account_queue_head").length || 0;
        const queueAdvice = queueHeadBlocked ? `，其中 ${queueHeadBlocked} 个被前序发送任务卡住` : "";
        const failedCount =
          (lowValue?.imageSend.failed.length || 0) +
          (lowValue?.quoteSend?.failed.length || 0) +
          (lowValue?.orderDraft?.failed.length || 0) +
          (orderDraft?.failed.length || 0) +
          (orderConfirmation?.failed.length || 0) +
          (orderFollowup?.failed.length || 0);
        summary = `低价值自动处理完成：草稿提交 ${lowValue?.autoSubmit.submitted.length || 0} 个，跳过 ${lowValue?.autoSubmit.skipped.length || 0} 个；出图发送入队 ${lowValue?.imageSend.queued.length || 0} 个；报价入队 ${lowValue?.quoteSend?.queued.length || 0} 个；安全发送处理 ${sendQueue?.processed.length || 0} 个，跳过 ${sendQueue?.skipped.length || 0} 个${queueAdvice}；订单草稿 ${orderCreated} 个（不会自动标记收款）；订单确认 ${orderConfirmationQueued} 个，订单跟进 ${orderFollowupQueued} 个，失败 ${failedCount} 个。`;
        setAutomationStatus((current) => mergeAutomationStatusRun(current, result, { incrementRunCount: !result.skipped }));
      },
      () => {
        setMessage(summary || "低价值自动处理完成。");
      },
    );
  }

  async function runAutomationCycle() {
    let summary = "";
    await runAction(
      "后台自动化跑一轮",
      async () => {
        const result = await runAutomationOnce(activeIdentityFilters());
        const lowValue = result.results.lowValueAutomation as LowValueAutomationResult | undefined;
        const sendQueue = result.results.processLowValueSendQueue as SafeSendQueueResult | undefined;
        const orderDraft = result.results.scanLowValueOrderDrafts as LowValueOrderDraftResult | undefined;
        const orderConfirmation =
          result.results.scanLowValueOrderConfirmations as LowValueOrderSendResult | undefined;
        const orderFollowup =
          result.results.scanLowValueOrderFollowups as LowValueOrderFollowupResult | undefined;
        const queueHeadBlocked = sendQueue?.skipped.filter((item) => item.reason === "not_account_queue_head").length || 0;
        const queueAdvice = queueHeadBlocked ? `，${queueHeadBlocked} 个被前序发送任务卡住` : "";
        const orderCreated = (lowValue?.orderDraft?.created.length || 0) + (orderDraft?.created.length || 0);
        const orderConfirmationQueued =
          (lowValue?.orderConfirmation?.queued.length || 0) + (orderConfirmation?.queued.length || 0);
        const orderFollowupQueued =
          (lowValue?.orderFollowup?.queued.length || 0) + (orderFollowup?.queued.length || 0);
        const orderQueueAdvice =
          orderConfirmationQueued || orderFollowupQueued
            ? `，确认入队 ${orderConfirmationQueued} 个，跟进入队 ${orderFollowupQueued} 个`
            : "";
        summary = `后台自动化完成：低价值提交 ${lowValue?.autoSubmit.submitted.length || 0} 个，图片入队 ${lowValue?.imageSend.queued.length || 0} 个，报价入队 ${lowValue?.quoteSend?.queued.length || 0} 个，安全发送处理 ${sendQueue?.processed.length || 0} 个，跳过 ${sendQueue?.skipped.length || 0} 个，订单草稿 ${orderCreated} 个（不会自动标记收款）${orderQueueAdvice}，拦截 ${sendQueue?.blocked.length || 0} 个${queueAdvice}。`;
        setAutomationStatus((current) => mergeAutomationStatusRun(current, result, { incrementRunCount: !result.skipped }));
      },
      () => {
        setMessage(summary || "后台自动化已跑完一轮。");
      },
    );
  }

  async function toggleAutomationActive() {
    const shouldStop = Boolean(automationStatus?.active);
    await runAction(
      shouldStop ? "暂停低价值后台自动化" : "开启低价值后台自动化",
      async () => {
        const nextStatus = shouldStop ? await stopAutomation() : await startAutomation();
        setAutomationStatus(nextStatus);
      },
      () => {
        setMessage(shouldStop ? "低价值后台自动化已暂停。" : "低价值后台自动化已开启，会按间隔自动推进低价值客户。");
      },
    );
  }

  async function handoffHighValueJobs() {
    let firstHandedOffId = "";
    let summary = "";
    await runAction(
        "高价值转人工",
        async () => {
          const result = await scanHighValueHandoffs(activeIdentityFilters());
          firstHandedOffId = result.handedOff[0]?.id || "";
          summary = `检查 ${result.scanned} 个高价值任务，转人工 ${result.handedOff.length} 个，跳过 ${result.skipped.length} 个。`;
        },
      () => {
        if (firstHandedOffId) setActiveId(firstHandedOffId);
        setMessage(summary || "高价值转人工扫描完成。");
      },
    );
  }

  async function readNotice(notice: NotificationItem) {
    if (notice.readAt) return;
    await runAction("标记提醒已读", async () => {
      const updated = await markNotificationRead(notice.id, identityExpectation(notice));
      upsertNotificationState(updated);
    });
  }

  async function readAllNotices() {
    await runAction("全部提醒已读", async () => {
      await markAllNotificationsRead(activeIdentityFilters());
      const readAt = new Date().toISOString();
      setNotifications((items) => items.map((notice) => (notice.readAt ? notice : { ...notice, readAt })));
    });
  }

  async function focusNoticeTarget(notice: NotificationItem) {
    const target = notice.target || {};
    const orderDraftId = String(target.orderDraftId || "");
    const quoteDraftId = String(target.quoteDraftId || "");
    const designJobId = String(target.designJobId || "");
    const sendTaskId = String(target.sendTaskId || "");
    const conversationId = String(target.conversationId || "");
    const reason = String(target.reason || "");
    if (!notice.readAt) {
      const updated = await markNotificationRead(notice.id, identityExpectation(notice));
      upsertNotificationState(updated);
    }
    if (orderDraftId) {
      const order = [...orderDrafts, ...(reviewCenter.orderDrafts || [])].find((item) => item.id === orderDraftId);
      if (order) {
        focusHighValueOrderReview(order);
        setMessage(`已定位到订单 ${orderDraftId}。`);
      } else {
        setReviewWorkbenchView("order");
        scrollToWorkspaceSection("review-center");
        setMessage(`已切换到订单审核列表，请查找订单 ${orderDraftId}。`);
      }
      return;
    }
    if (quoteDraftId) {
      focusQuoteCenter(quoteDraftId);
      if (reason === "payment_proof_needs_manual_verification") {
        setReviewWorkbenchView("quote");
        setMessage(`已定位到报价 ${quoteDraftId}。客户发送了付款凭证，请先人工核验金额，再标记定金或全款。`);
      }
      return;
    }
    if (sendTaskId) {
      setSendWorkbenchView("queue");
      scrollToWorkspaceSection("send-center");
      setMessage(`已定位到发送队列，请查找任务 ${sendTaskId}。`);
      return;
    }
    if (designJobId) {
      setActiveId(designJobId);
      scrollToWorkspaceSection("design-center");
      setMessage(`已定位到设计任务 ${designJobId}。`);
      return;
    }
    if (conversationId) {
      await focusConversation(conversationId, "conversation-center");
      return;
    }
    setMessage("这条提醒没有绑定可定位的订单、报价、设计任务、发送任务或会话。");
  }

  async function preflightActiveJob() {
    if (!activeJob) return;
    await runAction("出图预检", async () => {
      const result = await runDesignJobPreflight(activeJob);
      setMessage(
        result.ok
          ? designJobPreflightSuccessMessage(result)
          : `出图预检未通过：${designJobPreflightFailureMessage(result)}`,
      );
    });
  }

  async function submitActiveJob() {
    if (!activeJob) return;
    const job = activeJob;
    await runAction("提交出图", async () => {
      const preflight = await runDesignJobPreflight(job);
      if (!preflight.ok) {
        throw new Error(`提交已停止，${designJobPreflightFailureMessage(preflight)}`);
      }
      await submitDesignJob(job.id, identityExpectation(job));
    }, () => {
      window.setTimeout(() => {
        load();
        setMessage("已自动刷新设计结果；如果还未完成，可以再点刷新。");
      }, 3200);
    });
  }

  async function runDesignJobPreflight(job: DesignJob) {
    const result = await preflightDesignJob(job.id, identityExpectation(job));
    setPreflightResult(result);
    return result;
  }

  function designJobPreflightSuccessMessage(result: DesignJobPreflightResult) {
    const warnings = result.checks.filter((check) => !check.ok && check.severity === "warning");
    return `出图预检通过：${result.adapter}，可用图片 ${result.usableReferenceCount} 个。${
      warnings.length ? `提醒：${warnings.map((item) => item.detail || item.label).join("；")}` : ""
    }`;
  }

  function designJobPreflightFailureMessage(result: DesignJobPreflightResult) {
    const failed = result.checks.filter((check) => !check.ok && check.severity === "error");
    return failed.map((item) => item.detail || item.label).join("；") || "请先处理出图预检中的错误项。";
  }

  async function selectFromCustomerText() {
    if (!activeJob) return;
    const customerSelectionText = selectionText.trim();
    if (!customerSelectionText) {
      setMessage("请先粘贴客户选图原话。");
      return;
    }
    if (!confirmDesignImageSelection(activeJob, customerSelectionText, "识别客户选图")) {
      setMessage("已取消识别客户选图。");
      return;
    }
    let summary = "";
    await runAction(
      "识别客户选图",
      async () => {
        const result = await selectDesignImage(activeJob.id, customerSelectionText, identityExpectation(activeJob));
        applyDesignImageSelectionResult(activeJob, result);
        summary = designImageSelectionSummary(result);
      },
      () => {
        if (summary) setMessage(summary);
      },
    );
  }

  async function selectDesignImageForJob(job: DesignJob, input: Parameters<typeof selectDesignImage>[1], label = "选择候选图") {
    let summary = "";
    if (!confirmDesignImageSelection(job, input, label)) {
      setMessage(`已取消${label}。`);
      return;
    }
    setActiveId(job.id);
    await runAction(
      label,
      async () => {
        const result = await selectDesignImage(job.id, input, identityExpectation(job));
        applyDesignImageSelectionResult(job, result);
        summary = designImageSelectionSummary(result);
      },
      () => {
        if (summary) setMessage(summary);
      },
    );
  }

  function applyDesignImageSelectionResult(job: DesignJob, result: DesignImageSelectionResult) {
    const selectedImageKey = String(
      result.result?.candidate?.id ||
        result.result?.candidate?.imageId ||
        result.result?.imageId ||
        "",
    );
    const nextJob =
      selectedImageKey || result.nextStatus
        ? {
            ...job,
            status: result.nextStatus || job.status,
            images: job.images?.map((image) => ({
              ...image,
              selected: selectedImageKey ? [image.id, image.imageId].includes(selectedImageKey) : image.selected,
            })),
          }
        : null;
    upsertDesignJobState(nextJob);
    upsertReviewDesignJobState(nextJob);
    if (result.quote) {
      upsertQuoteState(result.quote);
      upsertReviewQuoteState(result.quote);
    }
  }

  function componentDesignImageRevisionRound(image?: NonNullable<DesignJob["images"]>[number] | null) {
    if (!image) return 0;
    const imageIdMatch = /^r(\d+)-/.exec(String(image.imageId || ""));
    if (imageIdMatch) return Number(imageIdMatch[1]) || 0;
    const position = Number(image.position || 0);
    return position >= 100 ? Math.floor(position / 100) : 0;
  }

  function componentLatestDesignImageRound(images?: NonNullable<DesignJob["images"]> | null) {
    return (images || []).reduce((max, image) => Math.max(max, componentDesignImageRevisionRound(image)), 0);
  }

  function componentDesignImagesForRound(images: NonNullable<DesignJob["images"]>, round: number) {
    return [...images]
      .filter((image) => componentDesignImageRevisionRound(image) === round)
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
  }

  async function selectFirstImage() {
    if (!activeJob) return;
    const images = activeJob.images || [];
    const target = componentDesignImagesForRound(images, componentLatestDesignImageRound(images))[0] || activeJob.images?.[0];
    if (!target) return;
    await selectDesignImageForJob(activeJob, { referencedImageId: target.id }, "模拟客户选图");
  }

  async function selectByReference() {
    if (!activeJob?.images?.length) return;
    const target = activeJob.images.find((image) => image.selected) || activeJob.images[0];
    await selectDesignImageForJob(activeJob, { referencedImageId: target.id }, "引用图片选图");
  }

  async function selectByScreenshot() {
    if (!activeJob?.images?.length) return;
    const target = activeJob.images.find((image) => image.selected) || activeJob.images[0];
    await selectDesignImageForJob(activeJob, { screenshotFingerprint: target.fingerprint || "" }, "截图匹配选图");
  }

  async function selectByUnclearScreenshot() {
    if (!activeJob) return;
    await selectDesignImageForJob(activeJob, { screenshotFingerprint: "00000000000000000000000000000000" }, "截图不确定转人工");
  }

  function designJobSelectedImage(job: DesignJob) {
    return job.images?.find((image) => image.selected) || null;
  }

  function designJobCustomerName(job: DesignJob) {
    return job.customer?.name || job.conversation?.title || job.customerId || "客户";
  }

  function designJobIdentityConfirmLines(job: DesignJob) {
    const wechatAccountLabel = job.wechatAccountId || job.conversation?.wechatAccountId || "未绑定";
    const customerLabel = job.customerId || job.conversation?.customerId || "未绑定";
    const conversationLabel = job.conversation?.title || job.conversationId || "未绑定";
    return [`设计任务ID：${job.id}`, `微信账号：${wechatAccountLabel}`, `客户ID：${customerLabel}`, `会话：${conversationLabel}`];
  }

  function confirmDesignImageSelection(job: DesignJob, input: Parameters<typeof selectDesignImage>[1], label: string) {
    const identityLines = designJobIdentityConfirmLines(job);
    const candidate =
      typeof input === "object" && input && "referencedImageId" in input
        ? job.images?.find((image) => [image.id, image.imageId].includes(String(input.referencedImageId || "")))
        : null;
    const screenshotFingerprint = typeof input === "object" && input && "screenshotFingerprint" in input ? String(input.screenshotFingerprint || "") : "";
    const rawText = typeof input === "string" ? input.trim() : "";
    const clippedText = rawText.length > 260 ? `${rawText.slice(0, 260)}...` : rawText;
    const lines = [
      `确认为「${designJobCustomerName(job)}」执行${label}吗？`,
      "",
      ...identityLines,
      "",
      candidate?.position ? `候选图：第 ${candidate.position} 张` : "候选图：由系统识别",
      rawText ? `客户原话：${clippedText}` : "",
      screenshotFingerprint ? `截图指纹：${screenshotFingerprint.slice(0, 12)}${screenshotFingerprint.length > 12 ? "..." : ""}` : "",
      "",
      "确认后会把选图结果绑定到当前设计任务，并可能继续触发报价或人工审核。",
    ].filter(Boolean);
    return window.confirm(lines.join("\n"));
  }

  function designJobBudgetText(job: DesignJob) {
    const quantity = Number(job.budget?.quantity || 0);
    const perUnit = Number(job.budget?.perUnitAmount || 0);
    const total = Number(job.budget?.totalAmount || 0);
    if (perUnit && quantity) return `${formatMoney(perUnit)} 元/份，共 ${quantity} 份`;
    if (perUnit) return `${formatMoney(perUnit)} 元/份`;
    if (total && quantity) return `总预算 ${formatMoney(total)} 元，共 ${quantity} 份`;
    if (total) return `总预算 ${formatMoney(total)} 元`;
    return "未填写预算";
  }

  function confirmDesignImageQuickSend(job: DesignJob) {
    const selectedImage = designJobSelectedImage(job);
    if (!selectedImage) {
      setMessage("先让客户明确选择一张效果图，再快速确认发送。");
      return false;
    }
    const identityLines = designJobIdentityConfirmLines(job);
    const lines = [
      `确认把「${designJobCustomerName(job)}」的效果图加入微信安全发送队列吗？`,
      "",
      ...identityLines,
      "",
      `选图：第 ${selectedImage.position || "-"} 张`,
      `场景：${readableScene(job.scene, "未填写场景")}`,
      `预算：${designJobBudgetText(job)}`,
      "",
      "系统会继续通过账号、聊天对象、最近消息三重校验后再发送。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function confirmDesignJobQuoteCreation(job: DesignJob) {
    const selectedImage = designJobSelectedImage(job);
    if (!selectedImage) {
      setMessage("先让客户明确选择一张效果图，再生成报价。");
      return false;
    }
    const identityLines = designJobIdentityConfirmLines(job);
    const lines = [
      `确认按「${designJobCustomerName(job)}」当前选图生成报价草稿吗？`,
      "",
      ...identityLines,
      "",
      `选图：第 ${selectedImage.position || "-"} 张`,
      `场景：${readableScene(job.scene, "未填写场景")}`,
      `预算：${designJobBudgetText(job)}`,
      "",
      "系统会按当前礼盒组合、数量、售价、成本和利润生成报价草稿。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function confirmDesignRevisionRequest(job: DesignJob, instruction: string, selectedImage?: NonNullable<DesignJob["images"]>[number] | null) {
    const identityLines = designJobIdentityConfirmLines(job);
    const clippedInstruction = instruction.length > 260 ? `${instruction.slice(0, 260)}...` : instruction;
    const lines = [
      `确认为「${designJobCustomerName(job)}」提交客户改图吗？`,
      "",
      ...identityLines,
      "",
      selectedImage?.position ? `当前选图：第 ${selectedImage.position} 张` : "当前选图：未识别",
      `已改图次数：${job.revisionCount || job.revisions?.length || 0}`,
      job.revisionPolicy?.chargeRequired ? "改图策略：已进入收费/人工确认" : "改图策略：低预算默认 2 次免费",
      "",
      "客户改图要求：",
      clippedInstruction,
      "",
      "确认后会把这条改图要求提交给设计平台，并继续绑定当前微信账号、客户和会话。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function confirmDesignJobRetry(job: DesignJob) {
    const identityLines = designJobIdentityConfirmLines(job);
    const lines = [
      `确认重试「${designJobCustomerName(job)}」的设计任务吗？`,
      "",
      ...identityLines,
      "",
      `当前状态：${designStatusLabel(job.status)}`,
      job.errorMessage ? `失败原因：${operatorStatusMessage(job.errorMessage, job.errorMessage)}` : "失败原因：未记录",
      "",
      "确认后会重新提交出图，原候选图、选图、报价和订单记录不会被自动改掉。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function confirmDesignJobCancel(job: DesignJob) {
    const identityLines = designJobIdentityConfirmLines(job);
    const selectedImage = designJobSelectedImage(job);
    const lines = [
      `确认取消「${designJobCustomerName(job)}」的设计任务吗？`,
      "",
      ...identityLines,
      "",
      `当前状态：${designStatusLabel(job.status)}`,
      selectedImage?.position ? `当前选图：第 ${selectedImage.position} 张` : "当前选图：未识别",
      "",
      "取消后不会继续出图或发图；如果客户仍需要，需要重新创建或重试任务。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function designJobQuoteBlockReason(job: DesignJob | null | undefined) {
    if (!job?.id) return "设计任务不存在，不能生成报价。";
    if (!job.customerId) return "设计任务缺少客户绑定，不能生成报价。";
    if (!job.wechatAccountId || !job.conversationId) return "设计任务缺少微信账号或客户会话，不能生成报价。";
    if (job.conversation?.customerId && job.customerId !== job.conversation.customerId) {
      return "设计任务客户和当前会话客户不一致，不能生成报价。";
    }
    if (job.conversation?.wechatAccountId && job.wechatAccountId !== job.conversation.wechatAccountId) {
      return "设计任务微信账号和当前会话账号不一致，不能生成报价。";
    }
    const selectedImage = designJobSelectedImage(job);
    if (!selectedImage) return "先让客户明确选择一张效果图，再生成报价。";
    const selectedImageDesignJobId = "designJobId" in selectedImage ? String((selectedImage as { designJobId?: string }).designJobId || "") : "";
    if (selectedImageDesignJobId && selectedImageDesignJobId !== job.id) {
      return "客户选中的效果图不属于当前设计任务，不能生成报价。";
    }
    return "";
  }

  async function quickConfirmActiveJob() {
    if (!activeJob) return;
    if (activeDesignImageSendRisk) {
      setMessage(`快速确认前检查未通过：${activeDesignImageSendRisk}`);
      return;
    }
    if (!confirmDesignImageQuickSend(activeJob)) return;
    await runAction("快速确认发送", () => quickConfirmSend(activeJob.id, identityExpectation(activeJob)));
  }

  async function quoteActiveJob() {
    if (!activeJob) return;
    await createQuoteForJob(activeJob);
  }

  async function createQuoteForJob(job: DesignJob) {
    const blocker = designJobQuoteBlockReason(job);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    if (!confirmDesignJobQuoteCreation(job)) return;
    await runAction("生成报价", async () => {
      const quote = await createQuote(job.id, identityExpectation(job));
      upsertQuoteState(quote);
      upsertReviewQuoteState(quote);
    });
  }

  async function runActiveConversationDealNextStep() {
    if (activeConversationLatestOrderDraft) {
      await runOrderDealNextStep(activeConversationLatestOrderDraft);
      return;
    }
    if (activeConversationLatestQuote) {
      await runQuoteDealNextStep(
        activeConversationLatestQuote,
        activeConversationLatestOrderDraft,
        activeConversationLatestQuoteSendRisk,
      );
      return;
    }
    if (activeConversationLatestDesignJob && activeConversationActualSelectedDesignImage) {
      await createQuoteForJob(activeConversationLatestDesignJob);
      return;
    }
    setMessage("当前客户还没有明确选图，不能推进报价。");
  }

  async function manualReviewActiveJob() {
    if (!activeJob) return;
    await runAction("转人工", () => markManualReview(activeJob.id, identityExpectation(activeJob)));
  }

  async function pollDesignJobIntoState(job: DesignJob) {
    const result = await pollDesignJob(job.id, identityExpectation(job));
    upsertDesignJobState(result.job);
    upsertReviewDesignJobState(result.job);
    setMessage(
      result.remoteStatus === "terminal"
        ? "设计平台状态：任务已进入客户确认后的终态，已跳过轮询。"
        : result.autoRetried
          ? "设计平台状态：已自动重试，正在重新出图。"
          : `设计平台状态：${result.remoteStatus}`,
    );
    return result;
  }

  async function pollActiveJob() {
    if (!activeJob) return;
    await runAction("轮询设计结果", () => pollDesignJobIntoState(activeJob));
  }

  async function pollAllActiveDesignResults() {
    let summary = "";
    await runAction(
        "批量轮询设计结果",
        async () => {
          const result = await pollActiveDesignResults(activeIdentityFilters());
          mergeDesignActivePollResult(result);
          summary = `轮询 ${result.scanned} 个出图中任务：完成 ${result.completed.length} 个，失败 ${result.failed.length} 个，自动重试 ${result.retried?.length || 0} 个，仍在生成 ${result.generating.length} 个，取消 ${result.cancelled.length} 个，错误 ${result.errors.length} 个。`;
        },
      () => {
        load();
        setMessage(summary || "已批量轮询设计结果。");
      },
    );
  }

  async function retryActiveJob() {
    if (!activeJob) return;
    if (!confirmDesignJobRetry(activeJob)) {
      setMessage("已取消重试设计任务。");
      return;
    }
    await runAction("重试设计任务", () => retryDesignJob(activeJob.id, identityExpectation(activeJob)));
  }

  async function requestRevisionForJob(job: DesignJob | null | undefined, label = "提交客户改图") {
    if (!job) return;
    const instruction = revisionText.trim();
    if (!instruction) {
      setMessage("请先输入客户具体想改哪里。");
      return;
    }
    const selectedImage = job.images?.find((image) => image.selected);
    if (!confirmDesignRevisionRequest(job, instruction, selectedImage)) {
      setMessage("已取消提交客户改图。");
      return;
    }
    await runAction(label, async () => {
      const result = await requestDesignRevision(job.id, {
        ...identityExpectation(job),
        instruction,
        sourceText: instruction,
        selectedImageId: selectedImage?.id,
      });
      upsertDesignJobState(result.job);
      upsertReviewDesignJobState(result.job);
    });
  }

  async function requestRevisionForActiveJob() {
    await requestRevisionForJob(activeJob, "提交客户改图");
  }

  async function cancelActiveJob() {
    if (!activeJob) return;
    if (!confirmDesignJobCancel(activeJob)) {
      setMessage("已取消设计任务取消操作。");
      return;
    }
    await runAction("取消设计任务", () => cancelDesignJob(activeJob.id, identityExpectation(activeJob)));
  }

  async function importChat() {
    if (!chatText.trim()) {
      setMessage("请先粘贴聊天记录，格式建议为“客户：... / 客服：...”。");
      return;
    }
    let importSummary = "";
    let sceneUncertainCount = 0;
    let importReviewCount = 0;
    let importedChatId = "";
    let importedChatFilter: TrainingSampleQualityFilter = "all";
    await runAction(
      "导入聊天记录",
      async () => {
        const result = await importChatTranscript({
          name: "手动粘贴聊天训练",
          source: "manual_text",
          channel: "wechat",
          ...activeIdentityFilters(),
          text: chatText,
        });
        importedChatId = result.id;
        sceneUncertainCount = (result.samples || []).filter((sample) => isSceneUncertainTrainingSample(sample)).length;
        importReviewCount = chatImportReviewCount(result);
        importedChatFilter = chatImportPreferredQualityFilter(result);
        importSummary = chatImportSceneSummary(result);
      },
      () => {
        setTrainingWorkbenchView("review");
        if (sceneUncertainCount > 0 || importReviewCount > 0 || importedChatId) {
          void changeTrainingSampleQualityFilter(importedChatFilter, importedChatId);
        }
        setMessage(importSummary || "导入聊天记录完成。");
      },
    );
  }

  async function compileTrainingSkills(explicitSuggestionKeys?: string[], scopeLabel = "已选") {
    const validKeys = new Set(skillSuggestions.map(skillSuggestionKey));
    const sourceKeys = explicitSuggestionKeys || selectedSkillSuggestionKeys;
    const suggestionKeys = [...new Set(sourceKeys.filter((key) => validKeys.has(key)))];
    const suggestionKeySet = new Set(suggestionKeys);
    if (!suggestionKeys.length) {
      setMessage(`请先勾选要应用的${scopeLabel} Skill 建议。`);
      return;
    }
    const selectedSuggestions = skillSuggestions.filter((suggestion) => suggestionKeySet.has(skillSuggestionKey(suggestion)));
    const selectedBlockedSkillSuggestions = selectedSuggestions.filter(isSkillSuggestionBlocked);
    if (selectedBlockedSkillSuggestions.length > 0) {
      const blockedPreview = selectedBlockedSkillSuggestions.slice(0, 3).map(skillSuggestionReviewSummary).join("\n");
      const moreText = selectedBlockedSkillSuggestions.length > 3 ? `\n还有 ${selectedBlockedSkillSuggestions.length - 3} 条身份冲突建议未展示。` : "";
      setMessage(`${scopeLabel}里有 ${selectedBlockedSkillSuggestions.length} 条身份冲突/混合来源 Skill 建议，不能应用。请先回到样本复核里拆分客户、账号或会话来源。`);
      window.alert(`${scopeLabel}里有 ${selectedBlockedSkillSuggestions.length} 条身份冲突/混合来源 Skill 建议，系统已禁止应用：\n${blockedPreview}${moreText}`);
      return;
    }
    const selectedNeedsReviewSkillSuggestions = selectedSuggestions.filter((suggestion) => !isSkillSuggestionAutoSelected(suggestion));
    const includeNeedsReview = selectedNeedsReviewSkillSuggestions.length > 0;
    if (selectedNeedsReviewSkillSuggestions.length > 0) {
      const reviewPreview = selectedNeedsReviewSkillSuggestions.slice(0, 3).map(skillSuggestionReviewSummary).join("\n");
      const moreText = selectedNeedsReviewSkillSuggestions.length > 3 ? `\n还有 ${selectedNeedsReviewSkillSuggestions.length - 3} 条需复核建议未展示。` : "";
      if (!window.confirm(`${scopeLabel}里有 ${selectedNeedsReviewSkillSuggestions.length} 条需人工判断的 Skill 建议：\n${reviewPreview}${moreText}\n确认已经看过证据并继续应用吗？`)) {
        return;
      }
    }
    let summary = "";
    await runAction(
      `应用${scopeLabel} Agent Skill`,
      async () => {
        const result = await applySkillSuggestions({ ...activeIdentityFilters(), minScore: 70, suggestionKeys, includeNeedsReview });
        const blockedText = skillApplyBlockedSummary(result);
        const detailText = skillApplyChangeSummary(result);
        summary = `${scopeLabel} ${result.selected ?? suggestionKeys.length} 条建议，实际应用 ${result.applied ?? result.selected ?? suggestionKeys.length} 条，新增 ${result.created.length} 个 Skill，更新 ${result.updated.length} 个 Skill，跳过 ${result.skipped.length} 个无变化项${blockedText}。${detailText}`;
      },
      () => {
        setSkillApplySummary(summary);
        setMessage(summary || "Agent Skill 应用完成。");
        const appliedKeySet = new Set(suggestionKeys);
        setSelectedSkillSuggestionKeys((current) => current.filter((key) => !appliedKeySet.has(key)));
        getTrainingOverview(activeIdentityFilters()).then(setTrainingOverview).catch(() => setTrainingOverview(null));
      },
    );
  }

  function confirmNeedsReviewSkillSuggestion(suggestion: SkillSuggestion) {
    if (isSkillSuggestionBlocked(suggestion)) {
      window.alert(`这条 Skill 建议存在身份冲突/混合来源，不能选中应用：\n${skillSuggestionReviewSummary(suggestion)}\n请先拆分或修正训练样本来源。`);
      return false;
    }
    if (isSkillSuggestionAutoSelected(suggestion)) return true;
    return window.confirm(`这条 Skill 建议需要人工判断：\n${skillSuggestionReviewSummary(suggestion)}\n确认选中后再人工复核吗？`);
  }

  function toggleSkillSuggestion(key: string, checked: boolean, suggestion?: SkillSuggestion) {
    if (checked && suggestion && !confirmNeedsReviewSkillSuggestion(suggestion)) return;
    setSelectedSkillSuggestionKeys((current) => {
      if (checked) return [...new Set([...current, key])];
      return current.filter((item) => item !== key);
    });
  }

  function isNestedControlTarget(target: EventTarget | null) {
    return target instanceof Element
      ? Boolean(target.closest("button, input, select, textarea, a, label"))
      : false;
  }

  function toggleSkillSuggestionFromRow(
    event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>,
    suggestion: SkillSuggestion,
  ) {
    if (isNestedControlTarget(event.target)) return;
    const key = skillSuggestionKey(suggestion);
    toggleSkillSuggestion(key, !selectedSkillSuggestionKeys.includes(key), suggestion);
  }

  function handleSkillSuggestionRowKeyDown(event: KeyboardEvent<HTMLDivElement>, suggestion: SkillSuggestion) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleSkillSuggestionFromRow(event, suggestion);
  }

  function selectAllSkillSuggestions() {
    const selectableSuggestions = filteredSkillSuggestions.filter((suggestion) => !isSkillSuggestionBlocked(suggestion));
    if (filteredUnselectedNeedsReviewSkillSuggestionCount > 0) {
      const reviewSuggestions = selectableSuggestions.filter(
        (suggestion) => !isSkillSuggestionAutoSelected(suggestion) && !selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
      );
      const reviewPreview = reviewSuggestions.slice(0, 3).map(skillSuggestionReviewSummary).join("\n");
      const moreText = reviewSuggestions.length > 3 ? `\n还有 ${reviewSuggestions.length - 3} 条需复核建议未展示。` : "";
      if (!window.confirm(`当前筛选有 ${filteredUnselectedNeedsReviewSkillSuggestionCount} 条需人工判断的 Skill 建议：\n${reviewPreview}${moreText}\n确认一起选中吗？`)) {
        return;
      }
    }
    const keys = selectableSuggestions.map(skillSuggestionKey);
    setSelectedSkillSuggestionKeys((current) => [...new Set([...current, ...keys])]);
  }

  function selectSafeSkillSuggestions() {
    const keys = filteredSkillSuggestions.filter(isSkillSuggestionAutoSelected).map(skillSuggestionKey);
    setSelectedSkillSuggestionKeys((current) => [...new Set([...current, ...keys])]);
  }

  function clearSkillSuggestions() {
    const keys = new Set(filteredSkillSuggestions.map(skillSuggestionKey));
    setSelectedSkillSuggestionKeys((current) => current.filter((key) => !keys.has(key)));
  }

  function clearHiddenSkillSuggestions() {
    const keys = new Set(filteredSkillSuggestions.map(skillSuggestionKey));
    setSelectedSkillSuggestionKeys((current) => current.filter((key) => keys.has(key)));
  }

  function compileFilteredTrainingSkills() {
    const keys = filteredSkillSuggestions
      .map(skillSuggestionKey)
      .filter((key) => selectedSkillSuggestionKeySet.has(key));
    void compileTrainingSkills(keys, "当前筛选已选");
  }

  function compileAllSelectedTrainingSkills() {
    if (hiddenSelectedSkillSuggestionCount > 0) {
      if (hiddenBlockedSkillSuggestionCount > 0) {
        const hiddenBlockedPreview = hiddenBlockedSkillSuggestions.slice(0, 3).map(skillSuggestionReviewSummary).join("\n");
        const hiddenBlockedMoreText = hiddenBlockedSkillSuggestionCount > 3 ? `\n还有 ${hiddenBlockedSkillSuggestionCount - 3} 条身份冲突建议未展示。` : "";
        window.alert(`还有 ${hiddenBlockedSkillSuggestionCount} 条其他 Agent 已选建议存在身份冲突/混合来源，不能应用：\n${hiddenBlockedPreview}${hiddenBlockedMoreText}\n请先清空其他已选或修正训练样本来源。`);
        return;
      }
      const hiddenReviewPreview = hiddenNeedsReviewSkillSuggestions.slice(0, 3).map(skillSuggestionReviewSummary).join("\n");
      const hiddenMoreText = hiddenNeedsReviewSkillSuggestionCount > 3 ? `\n还有 ${hiddenNeedsReviewSkillSuggestionCount - 3} 条需复核建议未展示。` : "";
      const hiddenReviewText = hiddenNeedsReviewSkillSuggestionCount
        ? `\n其中 ${hiddenNeedsReviewSkillSuggestionCount} 条需人工判断：\n${hiddenReviewPreview}${hiddenMoreText}`
        : "";
      if (!window.confirm(`还有 ${hiddenSelectedSkillSuggestionCount} 条其他 Agent 已选建议，会一起应用到 Skill。${hiddenReviewText}\n确认继续吗？`)) {
        return;
      }
    }
    void compileTrainingSkills();
  }

  function focusChatImportSkillSuggestions(item: ChatImport) {
    const agentFilter = chatImportSkillSuggestionFilter(item, skillSuggestions);
    const targetSuggestions =
      agentFilter === "all"
        ? skillSuggestions
        : skillSuggestions.filter((suggestion) => skillSuggestionAgentFilterKey(suggestion) === agentFilter);
    const safeKeys = targetSuggestions.filter(isSkillSuggestionAutoSelected).map(skillSuggestionKey);
    setSkillSuggestionAgentFilter(agentFilter);
    setSkillSuggestionSafetyFilter("all");
    if (safeKeys.length) {
      setSelectedSkillSuggestionKeys((current) => [...new Set([...current, ...safeKeys])]);
    }
    setTrainingWorkbenchView("skills");
  }

  function toggleTrainingSampleSelection(sampleId: string, checked: boolean) {
    setSelectedTrainingSampleIds((current) => {
      if (checked) return [...new Set([...current, sampleId])];
      return current.filter((item) => item !== sampleId);
    });
  }

  function trainingSampleSelectionRiskSummary(samples: TrainingSample[], options: { includeNeedsAttention?: boolean } = {}) {
    const parts: string[] = [];
    const missingRequiredCount = samples.filter((sample) => trainingSampleReadyBlockingReasons(sample).length).length;
    const needsAttentionCount = options.includeNeedsAttention
      ? samples.filter(isTrainingSampleNeedingManualReview).length
      : 0;
    const sceneUncertainCount = samples.filter(isSceneUncertainTrainingSample).length;
    if (missingRequiredCount) parts.push(`${missingRequiredCount} 条缺必填项`);
    if (needsAttentionCount) parts.push(`${needsAttentionCount} 条需处理`);
    if (sceneUncertainCount) parts.push(`${sceneUncertainCount} 条场景待确认`);
    return parts.length ? `，其中 ${parts.join("，")}` : "";
  }
  function selectVisibleTrainingSamples() {
    const samples = visibleTrainingSamples.slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    const ids = samples.map((sample) => sample.id);
    setSelectedTrainingSampleIds((current) => [...new Set([...current, ...ids])]);
    const riskText = trainingSampleSelectionRiskSummary(samples, { includeNeedsAttention: true });
    const overflowText =
      visibleTrainingSampleIds.length > ids.length
        ? `，本次只选择前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条，避免一次误处理过多`
        : "";
    setMessage(`已选择 ${samples.length} 条当前显示样本${riskText}${overflowText}。`);
  }

  function selectTrainingSamplesMissingRequired() {
    const matchingSamples = visibleTrainingSamples.filter((sample) => trainingSampleReadyBlockingReasons(sample).length);
    const samples = matchingSamples.slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    if (!samples.length) {
      setMessage("当前显示样本里没有缺必填项的训练样本。");
      return;
    }
    setSelectedTrainingSampleIds((current) => [...new Set([...current, ...samples.map((sample) => sample.id)])]);
    const overflowText =
      matchingSamples.length > samples.length
        ? `，本次只选择前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条`
        : "";
    setMessage(`已选择 ${samples.length} 条缺必填项样本${overflowText}，请先逐条补齐后再确认训练。`);
  }
  function selectTrainingSamplesNeedingReview() {
    const matchingSamples = visibleTrainingSamples.filter(isTrainingSampleNeedingManualReview);
    const samples = matchingSamples.slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    if (!samples.length) {
      setMessage("当前显示样本里没有需要优先人工处理的训练样本。");
      return;
    }
    setSelectedTrainingSampleIds((current) => [...new Set([...current, ...samples.map((sample) => sample.id)])]);
    const sceneRiskText = trainingSampleSelectionRiskSummary(samples, { includeNeedsAttention: false });
    const overflowText =
      matchingSamples.length > samples.length
        ? `，本次只选择前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条`
        : "";
    setMessage(`已智能选择 ${samples.length} 条需处理训练样本${sceneRiskText}${overflowText}。`);
  }

  function selectSceneUncertainTrainingSamples() {
    const matchingSamples = visibleTrainingSamples.filter(isSceneUncertainTrainingSample);
    const samples = matchingSamples.slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    if (!samples.length) {
      setMessage("当前显示样本里没有场景待确认的导入样本。");
      return;
    }
    setSelectedTrainingSampleIds((current) => [...new Set([...current, ...samples.map((sample) => sample.id)])]);
    const overflowText =
      matchingSamples.length > samples.length
        ? `，本次只选择前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条`
        : "";
    setMessage(`已选择 ${samples.length} 条场景待确认样本${overflowText}，请逐条核对 Agent 和场景后再确认训练。`);
  }

  function clearSelectedTrainingSamples() {
    const visibleIds = new Set(visibleTrainingSampleIds);
    setSelectedTrainingSampleIds((current) => current.filter((sampleId) => !visibleIds.has(sampleId)));
  }

  function trainingSampleReadyBlockingReasons(sample: TrainingSample) {
    return trainingSampleRequiredFieldBlockingReasons(sample);
  }

  function trainingSampleBatchBlockingSummary(samples: TrainingSample[]) {
    const blockedSamples = samples
      .map((sample) => ({ sample, reasons: trainingSampleReadyBlockingReasons(sample) }))
      .filter(({ reasons }) => reasons.length);
    if (!blockedSamples.length) return "";
    const preview = blockedSamples
      .slice(0, 3)
      .map(({ sample, reasons }, index) => {
        const title = sample.scene || skillSuggestionEvidencePreview(sample.customerText) || sample.id;
        return `${index + 1}. ${title}：${reasons.join("、")}`;
      })
      .join("\n");
    const moreText = blockedSamples.length > 3 ? `\n还有 ${blockedSamples.length - 3} 条缺项样本未展示。` : "";
    return `本批有 ${blockedSamples.length} 条训练样本缺少必填信息，不能批量确认进入训练。\n请先逐条编辑补齐 Agent、场景、客户问题、标准回复和 Skill 提示。\n\n缺项预览：\n${preview}${moreText}`;
  }
  function confirmTrainingSampleReady(sample: TrainingSample) {
    const blockingReasons = trainingSampleReadyBlockingReasons(sample);
    if (blockingReasons.length) {
      window.alert(`这条训练样本还不能进入训练：${blockingReasons.join("、")}。请补齐后再确认。`);
      return false;
    }
    const needsAttention = isTrainingSampleNeedingManualReview(sample);
    const sceneUncertain = isSceneUncertainTrainingSample(sample);
    if (!needsAttention && !sceneUncertain) return true;
    const attentionText = needsAttention ? `\n需处理：${trainingSampleAttentionReviewSummary(sample)}` : "";
    const sceneText = sceneUncertain ? `\n场景待确认：${trainingSampleSceneReviewSummary(sample)}` : "";
    return window.confirm(
      `这条训练样本仍有风险，确认直接进入训练吗？${attentionText}${sceneText}\n请确认客户原话、客服回复、Agent 和场景都正确。`,
    );
  }
  async function updateTrainingSampleStatus(sample: TrainingSample, status: "ready" | "review" | "rejected") {
    if (status === "ready" && !confirmTrainingSampleReady(sample)) return;
    const label = status === "ready" ? "确认训练样本" : status === "rejected" ? "禁用训练样本" : "退回复核样本";
    await runAction(
      label,
      () =>
        reviewTrainingSample(sample.id, {
          ...identityExpectation(sample),
          status,
          reviewer: "人工客服",
          note: sampleReviewNote(status),
        }),
      () => setSelectedTrainingSampleIds((current) => current.filter((sampleId) => sampleId !== sample.id)),
    );
  }

  async function batchUpdateTrainingSampleStatus(status: "ready" | "review" | "rejected", scope: "selected" | "visible") {
    const sourceSamples = scope === "selected" ? selectedVisibleTrainingSamples : visibleTrainingSamples;
    if (scope === "selected" && !sourceSamples.length) {
      setMessage("请先勾选要批量处理的训练样本。");
      return;
    }
    const candidates = sourceSamples
      .filter((sample) => String(sample.status || "ready") !== status)
      .slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    if (!candidates.length) {
      setMessage(trainingSampleBatchNoopMessage(status, scope));
      return;
    }
    const filterLabel =
      trainingSampleQualityOptions.find((option) => option.key === trainingSampleQualityFilter)?.label || "当前筛选";
    const actionLabel = trainingSampleBatchActionLabel(status);
    const scopeLabel = scope === "selected" ? "已选" : `「${filterLabel}」下当前显示的`;
    const overflowText =
      sourceSamples.length > candidates.length
        ? `\n\n为避免误操作，本次只处理前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条${scope === "selected" ? "已选" : "当前显示"}样本。`
        : "";
    const blockingSummary = status === "ready" ? trainingSampleBatchBlockingSummary(candidates) : "";
    if (blockingSummary) {
      window.alert(blockingSummary);
      setMessage("已拦截批量确认：请先补齐缺少必填信息的训练样本。");
      return;
    }
    const needsAttentionSamples = candidates.filter(isTrainingSampleNeedingManualReview);
    const needsAttentionWarning =
      status === "ready" && needsAttentionSamples.length
        ? trainingSampleNeedsAttentionBatchWarning(needsAttentionSamples.length, needsAttentionSamples)
        : "";
    const sceneUncertainSamples = candidates.filter(isSceneUncertainTrainingSample);
    const sceneUncertainCount = sceneUncertainSamples.length;
    const sceneUncertainWarning =
      status === "ready" && sceneUncertainCount
        ? trainingSampleSceneBatchWarning(sceneUncertainCount, sceneUncertainSamples)
        : "";
    const confirmed = window.confirm(
      trainingSampleBatchConfirmQuestion(status, scopeLabel, candidates.length, `${needsAttentionWarning}${sceneUncertainWarning}${overflowText}`),
    );
    if (!confirmed) {
      setMessage(`已取消${actionLabel}。`);
      return;
    }
    let summary = "";
    await runAction(
      actionLabel,
      async () => {
        const result = await batchReviewTrainingSamples({
          sampleIds: candidates.map((sample) => sample.id),
          expectedBySampleId: Object.fromEntries(candidates.map((sample) => [sample.id, identityExpectation(sample)])),
          status,
          reviewer: "人工客服",
          note: trainingSampleBatchReviewNote(status, scopeLabel, sceneUncertainCount, needsAttentionSamples.length),
        });
        summary = trainingSampleBatchDoneMessage(status, result.updated);
      },
      () => {
        const changedIds = new Set(candidates.map((sample) => sample.id));
        cancelSampleEdit();
        setSelectedTrainingSampleIds((current) => current.filter((sampleId) => !changedIds.has(sampleId)));
        setMessage(summary || `${actionLabel}完成。`);
      },
    );
  }

  function startSampleEdit(sample: TrainingSample) {
    setEditingSampleId(sample.id);
    setSampleEdit(sampleToEdit(sample));
  }

  function openTrainingSampleFromRow(
    event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>,
    sample: TrainingSample,
  ) {
    if (editingSampleId === sample.id || isNestedControlTarget(event.target)) return;
    startSampleEdit(sample);
    setMessage(`正在编辑训练样本：${sample.scene || sample.id}`);
  }

  function handleTrainingSampleRowKeyDown(event: KeyboardEvent<HTMLDivElement>, sample: TrainingSample) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openTrainingSampleFromRow(event, sample);
  }

  function cancelSampleEdit() {
    setEditingSampleId("");
    setSampleEdit(null);
  }

  function editedTrainingSampleForConfirm(sample: TrainingSample, edit: TrainingSampleEdit, status: "ready" | "review"): TrainingSample {
    return {
      ...sample,
      status,
      agentKey: edit.agentKey,
      scene: edit.scene,
      customerText: edit.customerText,
      idealReply: edit.idealReply,
      score: Number(edit.score),
      skillHints: splitTextList(edit.skillHints),
    };
  }
  async function saveTrainingSampleEdit(sample: TrainingSample, status: "ready" | "review") {
    if (!sampleEdit) return;
    const nextSample = editedTrainingSampleForConfirm(sample, sampleEdit, status);
    if (status === "ready" && !confirmTrainingSampleReady(nextSample)) return;
    const label = status === "ready" ? "保存并确认样本" : "保存样本修改";
    await runAction(
      label,
      () =>
        reviewTrainingSample(sample.id, {
          ...identityExpectation(sample),
          status,
          reviewer: "人工客服",
          note: status === "ready" ? "人工修正样本并确认进入训练。" : "人工修正样本，待进一步复核。",
          agentKey: sampleEdit.agentKey,
          scene: sampleEdit.scene,
          customerText: sampleEdit.customerText,
          idealReply: sampleEdit.idealReply,
          score: Number(sampleEdit.score),
          skillHints: splitTextList(sampleEdit.skillHints),
        }),
      cancelSampleEdit,
    );
  }

  async function createSendTask() {
    const targetConversation = conversations.find((conversation) => conversation.id === activeConversationId);
    if (!targetConversation) {
      setMessage("请先选择要创建发送任务的客户会话。");
      return;
    }
    if (targetConversation.manualLocked) {
      setMessage("该会话已人工接管，先解除接管后再创建演示发送任务。");
      return;
    }
    await runAction("创建发送任务", () =>
      createDemoSendTask(targetConversation.id, targetConversation.wechatAccountId, conversationIdentityExpectation(targetConversation)),
    );
  }

  async function captureDemoWindow(account: WechatAccount, mode: "correct" | "wrong_chat" | "offline") {
    const targetConversation = conversations.find((conversation) => conversation.id === activeConversationId);
    if (!targetConversation) {
      setMessage("请先选择要模拟窗口的客户会话。");
      return;
    }
    if (targetConversation.wechatAccountId !== account.id) {
      setMessage("当前客户会话不属于这个微信账号，不能用它生成窗口快照。");
      return;
    }
    const labels = {
      correct: "模拟正确微信窗口",
      wrong_chat: "模拟错聊微信窗口",
      offline: "模拟微信离线窗口",
    };
    await runAction(labels[mode], () =>
      createDemoWindowSnapshot(mode, account.id, targetConversation.id, conversationIdentityExpectation(targetConversation)),
    );
  }

  async function scanRealWindowSnapshots() {
    let summary = "";
    await runAction(
      "扫描真实微信窗口快照",
      async () => {
        const result = await scanWindowSnapshotInbox();
        summary = windowSnapshotScanSummary(result);
        return result;
      },
      () => setMessage(summary || "真实微信窗口快照扫描完成。"),
    );
  }

  async function captureCurrentWindowOnce() {
    let summary = "";
    await runAction(
      "采集当前微信窗口",
      async () => {
        const result = await captureWindowObserverOnce();
        const status = result.status;
        summary = `观察器 ${status.status}，${windowSnapshotScanSummary(result.scan)}`;
        return result;
      },
      () => setMessage(summary || "当前窗口采集完成。"),
    );
  }

  async function toggleConversationManualLock(conversation: Conversation, locked: boolean) {
    let resolutionNote = "";
    if (!locked) {
      const blockedSendCount = manualLockBlockedSendTaskCount(conversation.id);
      const sendQueueWarning = blockedSendCount
        ? `\n\n注意：该会话还有 ${blockedSendCount} 个发送任务曾因人工接管被暂停。普通解除只恢复后续自动化判断，不会自动发送这些旧任务；需要到发送中心逐条「解除并重排」。`
        : "";
      const confirmed = window.confirm(
        `确认解除「${conversation.title}」的人工接管并恢复自动化判断？\n\n如果客户问题还没处理完，请继续保持人工接管，避免智能体提前回复或发送内容。${sendQueueWarning}`,
      );
      if (!confirmed) {
        setMessage("已取消解除人工接管，该会话仍由人工处理。");
        return;
      }
      resolutionNote = promptManualResolutionNote(conversation.title);
      if (!resolutionNote) {
        setMessage("解除人工接管前必须填写处理结果，该会话仍由人工处理。");
        return;
      }
    }
    await runAction(locked ? "锁定人工会话" : "解除人工锁定", () =>
      setConversationManualLock(conversation.id, {
        ...conversationIdentityExpectation(conversation),
        locked,
        reviewer: "人工客服",
        reason: locked ? "manual_takeover_from_workbench" : "manual_resolution_from_workbench",
        note: locked
          ? "人工客服从工作台接管该会话，暂停自动回复。"
          : resolutionNote,
      }),
    );
  }

  async function validateWrong(task: SendTask) {
    await runAction("错误窗口校验", () => validateSendTask(task.id, "wrong_chat", identityExpectation(task)));
  }

  async function validateCorrect(task: SendTask) {
    await runAction("正确窗口校验", () => validateSendTask(task.id, "correct", identityExpectation(task)));
  }

  async function validateCurrentWindow(task: SendTask) {
    await runAction("当前窗口快照校验", () => validateSendTaskCurrentWindow(task.id, identityExpectation(task)));
  }

  async function executeDryRun(task: SendTask) {
    if (!ensureTaskCanSend(task, "演练发送")) return;
    await runAction("演练发送", () => executeDryRunSend(task.id, identityExpectation(task)));
  }

  async function executeActiveSend(task: SendTask) {
    if (!ensureTaskCanSend(task, "执行当前适配器")) return;
    await runAction("执行当前适配器", () => executeSendTask(task.id, identityExpectation(task)));
  }

  async function requeueTask(task: SendTask) {
    if (!ensureTaskCanSend(task, "重新排队发送")) return;
    if (!confirmSendTaskRequeue(task, "发送任务")) {
      setMessage("已取消重新排队发送任务。");
      return;
    }
    await runAction("重新排队发送", () =>
      requeueSendTask(task.id, {
        ...identityExpectation(task),
        reason: "manual_operator_requeue_from_send_center",
      }),
    );
  }

  async function releaseManualLockAndRequeueTask(task: SendTask) {
    const conversation = task.conversation || conversations.find((row) => row.id === task.conversationId);
    if (!conversation) {
      setMessage("没有找到这条发送任务对应的会话，不能解除人工接管。");
      return;
    }
    if (!isSendTaskConversationLocked(task)) {
      await requeueTask(task);
      return;
    }
    const confirmed = window.confirm(
      `确认「${conversation.title}」的人工问题已处理完，并解除人工接管后重新排队这条发送任务？\n\n如果客户还在人工沟通中，请不要解除，避免智能体提前发送。`,
    );
    if (!confirmed) {
      setMessage("已取消解除接管和重新排队。");
      return;
    }
    const resolutionNote = promptManualResolutionNote(conversation.title, `人工问题已处理完，恢复自动化并重新排队发送任务 ${task.id}。`);
    if (!resolutionNote) {
      setMessage("解除人工接管前必须填写处理结果，发送任务未重新排队。");
      return;
    }
    await runAction("解除接管并重排队", async () => {
      await setConversationManualLock(conversation.id, {
        ...conversationIdentityExpectation(conversation),
        locked: false,
        reviewer: "人工客服",
        reason: "manual_resolution_before_send_requeue",
        note: resolutionNote,
      });
        await requeueSendTask(task.id, {
          ...identityExpectation(task),
          reason: "manual_resolution_before_send_requeue",
        });
      });
    }

  function isSendTaskConversationLocked(task: SendTask) {
    if (task.conversation?.manualLocked) return true;
    return conversations.some((conversation) => conversation.id === task.conversationId && conversation.manualLocked);
  }

  function manualLockBlockedSendTaskCount(conversationId: string) {
    return sendTasks.filter(
      (task) =>
        task.conversationId === conversationId &&
        task.status === "blocked" &&
        Boolean(task.guardSnapshot?.blockedByManualLock || task.guardSnapshot?.blockedBy === "manual_lock"),
    ).length;
  }

  function ensureTaskCanSend(task: SendTask, label: string) {
    if (!isSendTaskConversationLocked(task)) return true;
    setMessage(`${label}已暂停：该会话已人工接管，请先解除接管或取消任务。`);
    return false;
  }

  function sendTaskConfirmLines(task: SendTask, actionLabel: string, scopeLabel: string) {
    const conversationName = task.conversation?.title || task.conversationId || "客户会话";
    const accountName = task.wechatAccount?.displayName || task.wechatAccountId || "微信账号";
    const customerName =
      task.conversation?.customer?.name ||
      task.conversation?.customerId ||
      task.guardSnapshot?.windowDiagnostic?.activeCustomerId ||
      "未绑定";
    const orderDraftId = sendTaskOrderDraftId(task);
    const message = typeof task.payload?.text === "string" ? task.payload.text.trim() : "";
    const lines = [
      `确认${actionLabel}${scopeLabel}吗？`,
      "",
      `会话：${conversationName}`,
      `微信账号：${accountName}`,
      `客户：${customerName}`,
      ...(orderDraftId ? [`订单ID：${orderDraftId}`] : []),
      `任务状态：${sendStatusLabel(task.status)}`,
      `任务 ID：${task.id}`,
      "",
      actionLabel === "取消"
        ? "取消后这条消息不会继续自动发送；如客户仍需要，请重新生成或重新入队。"
        : "重新排队后仍会重新校验微信账号、聊天对象和最近消息，校验通过才会发送。",
    ];
    if (message) {
      const clipped = message.length > 220 ? `${message.slice(0, 220)}...` : message;
      lines.push("", "消息预览：", clipped);
    }
    return lines;
  }

  function confirmSendTaskRequeue(task: SendTask, scopeLabel: string) {
    return window.confirm(sendTaskConfirmLines(task, "重新排队", scopeLabel).join("\n"));
  }

  function confirmSendTaskCancel(task: SendTask, scopeLabel: string) {
    return window.confirm(sendTaskConfirmLines(task, "取消", scopeLabel).join("\n"));
  }

  async function cancelTask(task: SendTask) {
    const reason =
      task.guardSnapshot?.blockedByManualLock || task.guardSnapshot?.blockedBy === "manual_lock"
        ? "manual_takeover_cancel_send_task"
        : "manual_operator_cancel_from_send_center";
    if (!confirmSendTaskCancel(task, "发送任务")) {
      setMessage("已取消发送任务取消操作。");
      return;
    }
    await runAction("取消发送任务", () => cancelSendTask(task.id, { ...identityExpectation(task), reason }));
  }

  async function scanSendOps() {
    let summary = "";
    await runAction(
      "扫描发送异常",
      async () => {
        const result = await scanSendOperations(activeIdentityFilters());
        summary = sendOperationsScanSummary(result);
      },
      () => setMessage(summary || "扫描发送异常完成。"),
    );
  }

  async function refreshBridgeOutbox() {
    let summary = "";
    await runAction(
      "刷新桥接待发送",
      async () => {
        const conversation = activeConversationId
          ? conversations.find((item) => item.id === activeConversationId)
          : null;
        const result = await getBridgeOutbox(
          conversation
            ? {
                wechatAccountId: conversation.wechatAccountId,
                conversationId: conversation.id,
                customerId: conversation.customerId,
              }
            : {},
        );
        summary = `桥接待处理 ${result.pending.length} 个，忽略旧文件 ${result.ignored.length} 个。`;
      },
      () => {
        setMessage(summary || "桥接待发送已刷新。");
      },
    );
  }

  async function scanBridgeAcks() {
    let summary = "";
    await runAction(
      "扫描桥接回执",
      async () => {
        const result = await scanBridgeInbox();
        summary = `扫描 ${result.scanned} 个回执，处理 ${result.processed.length} 个，失败 ${result.failed.length} 个。`;
      },
      () => {
        setMessage(summary || "桥接回执扫描完成。");
      },
    );
  }

  async function processSafeQueue() {
    let summary = "";
    await runAction(
      "安全处理发送队列",
      async () => {
          const result = await processSafeSendQueue(activeIdentityFilters());
        const queueHeadBlocked = result.skipped.filter((item) => item.reason === "not_account_queue_head").length;
        const queueAdvice = queueHeadBlocked ? `其中 ${queueHeadBlocked} 个被前序发送任务卡住。` : "";
        summary = `检查 ${result.scanned} 个待发任务，处理 ${result.processed.length} 个，拦截 ${result.blocked.length} 个，跳过 ${result.skipped.length} 个，失败 ${result.failed.length} 个。${queueAdvice}`;
      },
      () => {
        setMessage(summary || "安全发送队列处理完成。");
      },
    );
  }

  async function progressQuoteDealFlow() {
    const sendableQuotes = dealFlowSendableQuotes;
    const acceptedWithoutOrder = dealFlowAcceptedQuotesWithoutOrder;
    const confirmationCandidates = [...dealFlowConfirmationCandidates];
    const summary = {
      quoteQueued: 0,
      orderCreated: 0,
      confirmationQueued: 0,
      sendProcessed: 0,
      blocked: 0,
      skipped: 0,
      queueHeadBlocked: 0,
      failed: 0,
    };

    await runAction(
      "推进成交链路",
      async () => {
        for (const quote of sendableQuotes) {
          try {
            await queueQuoteAfterPreviewCheck(quote);
            summary.quoteQueued += 1;
          } catch {
            summary.failed += 1;
          }
        }

        for (const quote of acceptedWithoutOrder) {
          try {
            const orderDraft = await createOrderDraftFromQuote(quote.id, identityExpectation(quote));
            upsertOrderDraftState(orderDraft);
            confirmationCandidates.push(orderDraft);
            summary.orderCreated += 1;
          } catch {
            summary.failed += 1;
          }
        }

        for (const order of dedupeOrdersById(confirmationCandidates)) {
          try {
            await queueOrderConfirmationAfterPreviewCheck(order);
            summary.confirmationQueued += 1;
          } catch {
            summary.failed += 1;
          }
        }

        const sendResult = await processSafeSendQueue(activeIdentityFilters());
        summary.sendProcessed = sendResult.processed.length;
        summary.blocked = sendResult.blocked.length;
        summary.skipped = sendResult.skipped.length;
        summary.queueHeadBlocked = sendResult.skipped.filter((item) => item.reason === "not_account_queue_head").length;
        summary.failed += sendResult.failed.length;
      },
      () => {
        const queueAdvice = summary.queueHeadBlocked ? `，其中 ${summary.queueHeadBlocked} 个被前序发送任务卡住` : "";
        setMessage(
          `成交链路推进完成：报价入队 ${summary.quoteQueued} 个，订单草稿 ${summary.orderCreated} 个，订单确认 ${summary.confirmationQueued} 个，安全发送处理 ${summary.sendProcessed} 个，拦截 ${summary.blocked} 个，跳过 ${summary.skipped} 个${queueAdvice}，失败 ${summary.failed} 个。`,
        );
      },
    );
  }

  async function evaluateCustomerRoute() {
    if (!routeText.trim()) {
      setMessage("请先输入客户消息。");
      return;
    }
    const filters = activeIdentityFilters();
    try {
      setBusy("路由决策");
      setMessage("路由决策中...");
      const route = await evaluateRoute(routeText, activeIdentityFilters());
      setRouteEvaluations((rows) => [route, ...rows.filter((item) => item.id !== route.id)]);
      setMessage("路由决策完成。");
      void getRouteEvaluations(filters)
        .then((rows) => setRouteEvaluations(rows))
        .catch(() => undefined);
    } catch (error) {
      setMessage(`路由决策失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  async function correctLatestRoute(route: RouteEvaluation, agent: Agent) {
    await runAction(
      "纠正场景",
      () =>
        correctRouteEvaluation(route.id, {
          ...identityExpectation(route),
          agentKey: agent.key,
          scene: agent.scene,
          reviewer: "人工客服",
          note: `人工确认这条消息应由「${agent.name}」处理。`,
          idealReply: route.suggestedReply,
        }),
      () => setMessage(`已纠正到 ${agent.name}，并生成训练样本。`),
    );
  }

  async function processRouteInbound() {
    const conversation = conversations.find((item) => item.id === activeConversationId);
    if (!conversation) {
      setMessage("请先选择要处理的客户会话，系统不会默认使用第一个客户。");
      return;
    }
    if (!routeText.trim()) {
      setMessage("请先输入客户消息。");
      return;
    }
    let summary = "";
    await runAction(
      "处理客户消息",
      async () => {
        const result = await processInboundMessage({
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          text: routeText,
          assetIds: selectedAssetIds,
        });
        const parts = [`计划 ${result.plan.type}`];
        if (result.designJob) parts.push(`已创建设计草稿 ${result.designJob.id}`);
        if (result.selection?.action === "manual_selection_review") {
          parts.push(`选图需人工确认：${inboundSelectionReasonLabel(result.selection.reason || "")}`);
        } else if (result.selection?.ok) {
          parts.push("已识别客户选图");
        }
        if (result.quoteAcceptance?.ok) {
          parts.push(
            result.quoteAcceptance.quotePatch?.paymentStatus &&
              result.quoteAcceptance.quotePatch.paymentStatus !== "unpaid"
              ? `已识别客户付款：${paymentStatusLabel(result.quoteAcceptance.quotePatch.paymentStatus)}`
              : "已识别客户确认报价",
          );
        } else if (result.plan.type === "quote_payment_proof_manual_review") {
          parts.push("付款凭证待人工核验");
        } else if (result.quoteAcceptance?.hasIntent) {
          parts.push(`报价确认需人工处理：${inboundQuoteAcceptanceReasonLabel(result.quoteAcceptance.reason)}`);
        }
        if (result.quote) parts.push(`报价 ${result.quote.id} ${quoteStatusLabel(result.quote.status)}`);
        if (result.orderDraft) parts.push(`订单草稿 ${result.orderDraft.id}`);
        if (result.sendTask) parts.push(`已进入发送队列 ${result.sendTask.id}`);
        if (result.notification) parts.push("已提醒人工");
        summary = parts.join(" · ");
      },
      () => {
        setInboundSummary(summary);
        setMessage(summary || "客户消息处理完成。");
      },
    );
  }

  async function runWechatChannelInbound(channel: WechatChannelKey) {
    const conversation = conversations.find((item) => item.id === activeConversationId);
    if (!conversation) {
      setMessage("请先在消息中心选择客户会话，再做微信通道入站演练。");
      return;
    }
    const text = routeText.trim() || `来自${wechatChannelLabel(channel)}的客户咨询：想做一批企业礼盒，请帮我推荐方案。`;
    let summary = "";
    await runAction(
      `${wechatChannelLabel(channel)}入站演练`,
      async () => {
          const result = (await testWechatChannelInbound(channel, {
            ...conversationIdentityExpectation(conversation),
            wechatAccountId: conversation.wechatAccountId,
            conversationId: conversation.id,
            customerId: conversation.customerId,
          text,
        })) as any;
        const route = result?.result?.route;
        const plan = result?.result?.plan;
        const sendTask = result?.result?.sendTask;
        const parts = [`已进入 ${conversation.title}`];
        if (route?.agentKey) parts.push(`路由到 ${route.agent?.name || route.agentKey}`);
        if (plan?.type) parts.push(`计划 ${plan.type}`);
        if (sendTask?.id) parts.push(`安全发送任务 ${sendTask.id}`);
        summary = parts.join(" · ");
      },
      () => {
        setInboundSummary(summary);
        setMessage(summary || `${wechatChannelLabel(channel)}入站演练完成。`);
        void load({
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
        });
      },
    );
  }

  async function updateQuoteDraft(quote: QuoteDraft, patch: {
    status?: string;
    paymentStatus?: string;
    owner?: string;
    customerNotes?: string;
    quantity?: number | string;
    unitPrice?: number | string;
    totalCost?: number | string;
  }) {
    const nextPatch = { ...identityExpectation(quote), ...patch };
    await runAction("更新报价", async () => {
      const updated = await updateQuote(quote.id, nextPatch);
      upsertQuoteState(updated);
    });
  }

  async function confirmQuoteManualFollowup(quote: QuoteDraft) {
    const customerName = quote.customer?.name || quote.designJob?.customerId || "客户";
    const identityLines = quoteIdentityConfirmLines(quote);
    const confirmed = window.confirm(
      [
        `确认将「${customerName}」的报价转为人工跟进吗？`,
        "",
        `报价ID：${quote.id}`,
        ...identityLines,
        "",
        `报价金额：${formatMoney(Number(quote.totalPrice || 0))} 元`,
        "系统会保留选图、报价和发送检查记录，后续由人工客服继续处理。",
      ].join("\n"),
    );
    if (!confirmed) {
      setMessage("已取消报价人工跟进操作。");
      return;
    }
    await updateQuoteDraft(quote, { status: "manual_review", owner: "人工客服" });
  }

  function chooseQuoteRevisionImage(quote: QuoteDraft) {
    const images = [...(quote.designJob?.images || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    if (!images.length) {
      window.alert("这条报价没有候选图，无法修订选图。");
      return null;
    }
    const current = quoteSelectedImage(quote);
    const defaultImage = images.find((image) => image.id !== current?.id) || images[0];
    const options = images
      .map((image) => `第 ${image.position} 张${image.id === current?.id ? "（当前）" : ""}`)
      .join("、");
    const raw = window.prompt(`选择修订后的候选图：${options}`, String(defaultImage.position || ""));
    if (raw === null) return null;
    const text = String(raw || "").trim();
    const selected =
      images.find((image) => String(image.position) === text) ||
      images.find((image) => image.id === text || image.imageId === text) ||
      null;
    if (!selected) {
      window.alert("没有找到这个候选图，请输入候选图序号。");
      return null;
    }
    return selected;
  }

  function confirmQuoteSelectionRevision(quote: QuoteDraft, selectedImage: NonNullable<DesignJob["images"]>[number]) {
    const current = quoteSelectedImage(quote);
    const customerName = quote.customer?.name || quote.designJob?.customerId || "客户";
    const identityLines = quoteIdentityConfirmLines(quote);
    const lines = [
      `确认把「${customerName}」的报价选图改为第 ${selectedImage.position || "-"} 张吗？`,
      "",
      `报价ID：${quote.id}`,
      ...identityLines,
      "",
      `原选图：${current?.position ? `第 ${current.position} 张` : "未识别"}`,
      `新选图：第 ${selectedImage.position || "-"} 张`,
      `报价金额：${formatMoney(Number(quote.totalPrice || 0))} 元`,
      "",
      "确认后报价会回到人工审核，已经排队的报价发送会由后端安全检查处理。",
    ];
    return window.confirm(lines.join("\n"));
  }

  async function reviseQuoteDraftSelection(quote: QuoteDraft) {
    const selectedImage = chooseQuoteRevisionImage(quote);
    if (!selectedImage) return;
    if (!confirmQuoteSelectionRevision(quote, selectedImage)) {
      setMessage("已取消报价选图修订。");
      return;
    }
    await runAction("修订报价选图", async () => {
      const updated = await reviseQuoteSelection(quote.id, {
        ...identityExpectation(quote),
        selectedImageId: selectedImage.id,
        owner: "人工客服",
        note: `客户改选第 ${selectedImage.position} 张效果图，报价回到人工审核。`,
      });
      upsertQuoteState(updated);
    });
  }

  function confirmActiveQuoteEditSave(quote: QuoteDraft) {
    const quantity = Number(quoteEdit.quantity || 0);
    const unitPrice = Number(quoteEdit.unitPrice || 0);
    const totalCost = Number(quoteEdit.totalCost || 0);
    const nextTotal = quantity * unitPrice;
    const nextProfit = nextTotal - totalCost;
    const customerName = quote.customer?.name || quote.designJob?.customerId || "客户";
    const identityLines = quoteIdentityConfirmLines(quote);
    const lines = [
      `确认保存「${customerName}」的报价调整吗？`,
      "",
      `报价ID：${quote.id}`,
      ...identityLines,
      "",
      `数量：${Number(quote.quantity || 0) || "-"} -> ${quantity || "-"}`,
      `单价：${formatMoney(Number(quote.unitPrice || 0))} -> ${formatMoney(unitPrice)} 元/份`,
      `总成本：${formatMoney(Number(quote.totalCost || 0))} -> ${formatMoney(totalCost)} 元`,
      `总价：${formatMoney(Number(quote.totalPrice || 0))} -> ${formatMoney(nextTotal)} 元`,
      `预估利润：${formatMoney(Number(quote.profit || 0))} -> ${formatMoney(nextProfit)} 元`,
      "",
      nextProfit < 0
        ? "注意：调整后利润为负，保存后仍需要人工处理，不要直接发送。"
        : "保存后会更新报价草稿，发送前仍会再做利润、选图和身份检查。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function confirmQuoteOrderDraftCreation(quote: QuoteDraft) {
    const existingOrder = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
    const customerName = quote.customer?.name || quote.designJob?.customerId || "客户";
    const selectedImage = quoteSelectedImage(quote);
    const identityLines = quoteIdentityConfirmLines(quote);
    const selectedImageLabel = selectedImage?.position
      ? `选图：第 ${selectedImage.position} 张`
      : quote.selectedImageId
        ? `选图：已绑定（${quote.selectedImageId}）`
        : "选图：未绑定";
    const lines = [
      `确认按「${customerName}」当前报价${existingOrder ? "更新" : "生成"}订单草稿吗？`,
      "",
      `报价ID：${quote.id}`,
      ...identityLines,
      "",
      `报价金额：${formatMoney(Number(quote.totalPrice || 0))} 元`,
      `数量：${Number(quote.quantity || 0) || "-"} 份`,
      selectedImageLabel,
      "",
      existingOrder
        ? "系统会覆盖订单草稿里的报价快照、选图和金额，后续仍需要人工确认收款与交付。"
        : "系统会把报价、选图和客户信息生成订单草稿，后续用于收款、排产和订单确认。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function quoteOrderDraftBlockReason(quote: QuoteDraft) {
    const designJob = quote.designJob as
      | (QuoteDraft["designJob"] & { wechatAccountId?: string | null; conversationId?: string | null })
      | undefined;
    if (!quote.id) return "报价缺少草稿编号，不能生成订单。";
    if (!quote.designJobId) return "报价缺少设计任务绑定，不能生成订单。";
    if (!quote.customerId) return "报价缺少客户绑定，不能生成订单。";
    if (!quote.selectedImageId) return "报价还没有绑定客户选中的效果图，不能生成订单。";
    if (!quoteSelectedImage(quote)) return "报价选中的效果图不在当前设计任务里，不能生成订单。";
    if (!designJob?.conversationId || !designJob?.wechatAccountId) return "报价缺少微信账号或客户会话，不能生成订单。";
    if (quote.designJobId && designJob?.id && quote.designJobId !== designJob.id) return "报价和设计任务绑定不一致，不能生成订单。";
    if (quote.customerId && designJob?.customerId && quote.customerId !== designJob.customerId) return "报价和客户绑定不一致，不能生成订单。";
    if (Number(quote.quantity || 0) <= 0) return "报价数量无效，不能生成订单。";
    if (Number(quote.unitPrice ?? -1) < 0) return "报价单价无效，不能生成订单。";
    if (Number(quote.totalPrice || 0) <= 0) return "报价总价无效，不能生成订单。";
    if (Number(quote.totalCost ?? -1) < 0) return "报价成本无效，不能生成订单。";
    if (!Number.isFinite(Number(quote.profit))) return "报价利润未计算，不能生成订单。";
    if (Number(quote.profit || 0) < 0) return "报价利润为负，不能生成订单。";
    return "";
  }

  function confirmQuoteAcceptanceOrderCreation(quote: QuoteDraft) {
    const existingOrder = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
    const customerName = quote.customer?.name || quote.designJob?.customerId || "客户";
    const selectedImage = quoteSelectedImage(quote);
    const identityLines = quoteIdentityConfirmLines(quote);
    const lines = [
      `确认「${customerName}」已经明确同意这份报价并要生成订单吗？`,
      "",
      `报价ID：${quote.id}`,
      ...identityLines,
      "",
      `报价金额：${formatMoney(Number(quote.totalPrice || 0))} 元`,
      `数量：${Number(quote.quantity || 0) || "-"} 份`,
      `付款状态：${paymentStatusLabel(quote.paymentStatus || "unpaid")}`,
      selectedImage?.position ? `选图：第 ${selectedImage.position} 张` : "选图：未识别",
      existingOrder ? `已有订单草稿：${existingOrder.id}` : "订单草稿：确认后生成",
      "",
      "请确认客户在当前会话里明确说了确认、要这个、可以做或同等意思。",
      "确认后系统会把报价标记为已成交，并生成或更新订单草稿；不会直接发送微信消息。",
    ];
    return window.confirm(lines.join("\n"));
  }

  async function createOrderDraft(quote: QuoteDraft) {
    const blocker = quoteOrderDraftBlockReason(quote);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    if (!confirmQuoteOrderDraftCreation(quote)) {
      setMessage("已取消生成订单草稿操作。");
      return;
    }
    await runAction("生成订单草稿", async () => {
      const orderDraft = await createOrderDraftFromQuote(quote.id, identityExpectation(quote));
      upsertOrderDraftState(orderDraft);
    });
  }

  function confirmQuotePaymentProofVerification(quote: QuoteDraft, paymentStatus: "deposit_paid" | "paid") {
    const paymentLabel = paymentStatus === "paid" ? "全款" : "定金";
    const linkedOrder = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
    const customerName = quote.customer?.name || quote.designJob?.customerId || linkedOrder?.customer?.name || "客户";
    const selectedImage = quoteSelectedImage(quote);
    const identityLines = quoteIdentityConfirmLines(quote);
    const selectedImageLabel = selectedImage?.position
      ? `选图：第 ${selectedImage.position} 张`
      : quote.selectedImageId
        ? `选图：已绑定（${quote.selectedImageId}）`
        : "选图：未绑定";
    const lines = [
      `确认已核验「${customerName}」的${paymentLabel}付款吗？`,
      "",
      `报价ID：${quote.id}`,
      ...identityLines,
      "",
      `报价金额：${formatMoney(Number(quote.totalPrice || linkedOrder?.totalPrice || 0))} 元`,
      `数量：${Number(quote.quantity || linkedOrder?.quantity || 0) || "-"} 份`,
      selectedImageLabel,
      linkedOrder ? `订单草稿：${linkedOrder.id}` : "订单草稿：核验后系统会按报价生成或更新",
      "",
      paymentStatus === "paid"
        ? "确认后会把报价/订单标记为已付款，并可能把订单确认放入微信安全发送队列。"
        : "确认后会把报价/订单标记为已付定金，并可能把订单确认放入微信安全发送队列。",
    ];
    return window.confirm(lines.join("\n"));
  }

  function quotePaymentProofBlockReason(quote: QuoteDraft) {
    const designJob = quote.designJob as
      | (QuoteDraft["designJob"] & { wechatAccountId?: string | null; conversationId?: string | null })
      | undefined;
    if (!quote.selectedImageId) return "报价还没有绑定客户选中的效果图，不能核验付款。";
    if (!designJob?.wechatAccountId || !quote.customerId || !designJob?.conversationId) {
      return "报价缺少微信账号、客户或会话绑定，不能核验付款。";
    }
    return "";
  }

  function orderPaymentProofBlockReason(order: OrderDraft) {
    if (!orderSelectedImageIdValue(order)) {
      return "订单还没有绑定客户选中的效果图，不能核验付款。";
    }
    if (orderStrictIdentityMissing(order)) return orderStrictIdentityBlockReason("核验付款");
    return "";
  }

  function orderProductionBlockReason(order: OrderDraft) {
    if (order.status === "cancelled") return "订单已取消，不能标记生产中。";
    if (order.status === "fulfilled") return "订单已完成，不能重新标记生产中。";
    if (!orderPaymentReady(order)) return "订单未记录定金或全款，不能标记生产中；请先人工核验付款凭证。";
    if (!orderSelectedImageIdValue(order)) return "订单未绑定客户选中的效果图，不能标记生产中。";
    if (orderStrictIdentityMissing(order)) return orderStrictIdentityBlockReason("标记生产中");
    if (Number(order.profit || 0) < 0) return "订单利润为负，不能直接标记生产中。";
    return "";
  }

  function orderFulfillmentBlockReason(order: OrderDraft) {
    if (order.status === "cancelled") return "订单已取消，不能标记完成。";
    if (order.status !== "processing") return "订单还未进入生产中，不能直接标记完成。";
    if (!orderPaymentReady(order)) return "订单未记录定金或全款，不能标记完成；请先人工核验付款凭证。";
    if (!orderSelectedImageIdValue(order)) return "订单未绑定客户选中的效果图，不能标记完成。";
    if (orderStrictIdentityMissing(order)) return orderStrictIdentityBlockReason("标记完成");
    if (Number(order.profit || 0) < 0) return "订单利润为负，不能直接标记完成。";
    return "";
  }

  async function verifyQuotePaymentProof(
    quote: QuoteDraft,
    paymentStatus: "deposit_paid" | "paid",
  ) {
    const paymentLabel = paymentStatus === "paid" ? "全款" : "定金";
    const blocker = quotePaymentProofBlockReason(quote);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    if (!confirmQuotePaymentProofVerification(quote, paymentStatus)) {
      setMessage(`已取消核验${paymentLabel}付款操作。`);
      return;
    }
    let queuedOrder: OrderDraft | null = null;
    let queuedSendTask = false;
    await runAction(`核验${paymentLabel}付款`, async () => {
      const result = await verifyQuotePaymentProofAndQueueConfirmation(
        quote.id,
        paymentStatus,
        identityExpectation(quote),
      );
      upsertQuoteState(result.quote);
      upsertOrderDraftState(result.orderDraft);
      if (result.sendTask?.id) {
        queuedSendTask = true;
        upsertSendTaskState(result.sendTask);
      }
      queuedOrder = result.orderDraft;
    }, () => {
      if (!queuedOrder) return;
      focusOrderDraft(queuedOrder);
      setMessage(
        queuedSendTask
          ? `${paymentLabel}已核验，订单确认已进入微信安全发送队列。`
          : `${paymentLabel}已核验，订单已更新，请人工确认后再发送。`,
      );
    });
  }

  async function verifyOrderPaymentProof(order: OrderDraft, paymentStatus: "deposit_paid" | "paid") {
    const blocker = orderPaymentProofBlockReason(order);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    const quote =
      order.quoteDraft ||
      quotes.find((item) => item.id === order.quoteDraftId) ||
      null;
    if (!quote) {
      setMessage("这条订单没有绑定报价，不能直接标记收款；请先定位原报价或人工补齐报价绑定后再核验付款。");
      return;
    }
    await verifyQuotePaymentProof(quote, paymentStatus);
  }

  function upsertOrderDraftState(order: OrderDraft | null | undefined) {
    if (!order?.id) return;
    setOrderDrafts((items) =>
      items.some((item) => item.id === order.id)
        ? items.map((item) => (item.id === order.id ? order : item))
        : [order, ...items],
    );
  }

  function upsertDesignJobState(job: DesignJob | null | undefined) {
    if (!job?.id) return;
    setJobs((items) =>
      items.some((item) => item.id === job.id)
        ? items.map((item) => (item.id === job.id ? job : item))
        : [job, ...items],
    );
  }

  function upsertQuoteState(quote: QuoteDraft | null | undefined) {
    if (!quote?.id) return;
    setQuotes((items) =>
      items.some((item) => item.id === quote.id)
        ? items.map((item) => (item.id === quote.id ? quote : item))
        : [quote, ...items],
    );
  }

  function upsertSendTaskState(task: SendTask | null | undefined) {
    if (!task?.id) return;
    setSendTasks((items) =>
      items.some((item) => item.id === task.id)
        ? items.map((item) => (item.id === task.id ? task : item))
        : [task, ...items],
    );
  }

  function upsertNotificationState(notice: NotificationItem | null | undefined) {
    if (!notice?.id) return;
    setNotifications((items) =>
      [notice, ...items.filter((item) => item.id !== notice.id)]
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
        .slice(0, 100),
    );
  }

  function upsertReviewLogState(log: ReviewLog | null | undefined) {
    if (!log?.id) return;
    setReviewCenter((current) => ({
      ...current,
      logs: [log, ...current.logs.filter((item) => item.id !== log.id)]
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
        .slice(0, 80),
    }));
  }

  function upsertReviewDesignJobState(job: DesignJob | null | undefined) {
    if (!job?.id) return;
    const visible =
      ["manual_review", "failed", "timeout"].includes(job.status) ||
      (isHighValueDesignJob(job) && ["completed", "quick_confirm"].includes(job.status));
    setReviewCenter((current) => ({
      ...current,
      designJobs: visible
        ? [job, ...current.designJobs.filter((item) => item.id !== job.id)].slice(0, 80)
        : current.designJobs.filter((item) => item.id !== job.id),
    }));
  }

  function mergeDesignActivePollResult(result: Awaited<ReturnType<typeof pollActiveDesignResults>> | null | undefined) {
    if (!result) return;
    const changedJobs = [
      ...(result.completed || []),
      ...(result.failed || []),
      ...(result.retried || []),
      ...(result.generating || []),
      ...(result.cancelled || []),
    ];
    changedJobs.forEach((job) => {
      upsertDesignJobState(job);
      upsertReviewDesignJobState(job);
    });
  }

  function upsertReviewQuoteState(quote: QuoteDraft | null | undefined) {
    if (!quote?.id) return;
    const visible = quote.status === "manual_review" || (!["rejected", "cancelled"].includes(quote.status) && isHighValueQuote(quote));
    setReviewCenter((current) => ({
      ...current,
      quoteDrafts: visible
        ? [quote, ...current.quoteDrafts.filter((item) => item.id !== quote.id)].slice(0, 80)
        : current.quoteDrafts.filter((item) => item.id !== quote.id),
    }));
  }

  function upsertReviewOrderDraftState(order: OrderDraft | null | undefined) {
    if (!order?.id) return;
    setReviewCenter((current) => ({
      ...current,
      orderDrafts: ["fulfilled", "cancelled"].includes(order.status)
        ? current.orderDrafts.filter((item) => item.id !== order.id)
        : [order, ...current.orderDrafts.filter((item) => item.id !== order.id)].slice(0, 80),
    }));
  }

  function applyReviewDesignJobResultState(result: ReviewDesignJobResult | null | undefined) {
    upsertReviewLogState(result?.log);
    upsertNotificationState(result?.notification);
    const payload = result?.result;
    if (!payload || typeof payload !== "object") return;
    const reviewResult = payload as {
      id?: string;
      requestId?: string;
      designJob?: DesignJob | null;
      sendTask?: SendTask | null;
    };
    const job = reviewResult.designJob || (reviewResult.requestId ? (reviewResult as DesignJob) : null);
    upsertDesignJobState(job);
    upsertReviewDesignJobState(job);
    upsertSendTaskState(reviewResult.sendTask);
  }

  function applyReviewQuoteResultState(result: ReviewQuoteResult | null | undefined) {
    upsertReviewLogState(result?.log);
    upsertNotificationState(result?.notification);
    const payload = result?.result;
    if (!payload || typeof payload !== "object") return;
    const reviewResult = payload as {
      id?: string;
      quote?: QuoteDraft | null;
      sendTask?: SendTask | null;
      notification?: NotificationItem | null;
    };
    const quote = reviewResult.quote || (reviewResult.id ? (reviewResult as QuoteDraft) : null);
    upsertQuoteState(quote);
    upsertReviewQuoteState(quote);
    upsertSendTaskState(reviewResult.sendTask);
    upsertNotificationState(reviewResult.notification);
  }

  function applyReviewOrderResultState(result: ReviewOrderResult | null | undefined) {
    upsertReviewLogState(result?.log);
    upsertNotificationState(result?.notification);
    const payload = result?.result;
    if (!payload || typeof payload !== "object") return;
    const reviewResult = payload as {
      id?: string;
      orderDraft?: OrderDraft | null;
      order?: OrderDraft | null;
      sendTask?: SendTask | null;
      notification?: NotificationItem | null;
    };
    const order = reviewResult.orderDraft || reviewResult.order || (reviewResult.id ? (reviewResult as OrderDraft) : null);
    upsertOrderDraftState(order);
    upsertReviewOrderDraftState(order);
    upsertSendTaskState(reviewResult.sendTask);
    upsertNotificationState(reviewResult.notification);
  }

  function conversationForQuoteOrder(quote: QuoteDraft, order: OrderDraft) {
    const conversationId =
      order.conversationId ||
      quote.designJob?.conversationId ||
      quote.designJob?.conversation?.id ||
      "";
    if (!conversationId) return null;
    return conversations.find((conversation) => conversation.id === conversationId) || null;
  }

  async function updateOrderDraftStatus(order: OrderDraft, patch: {
    status?: string;
    paymentStatus?: string;
    customerNotes?: string;
    owner?: string;
  }) {
    await runAction("更新订单草稿", async () => {
      const updated = await updateOrderDraft(order.id, { ...identityExpectation(order), ...patch });
      upsertOrderDraftState(updated);
    });
  }

  async function confirmAndUpdateOrderDraftStatus(order: OrderDraft, status: "fulfilled" | "cancelled") {
    const customerName = order.customer?.name || order.quoteDraft?.customer?.name || "客户";
    const statusText = status === "fulfilled" ? "完成" : "取消";
    const identityLines = orderIdentityConfirmLines(order);
    const blocker = status === "fulfilled" ? orderFulfillmentBlockReason(order) : "";
    if (blocker) {
      setMessage(blocker);
      return;
    }
    const confirmed = window.confirm(
      [
        `确认将「${customerName}」的订单标记为${statusText}吗？`,
        "",
        `订单ID：${order.id}`,
        ...identityLines,
        "",
        `订单金额：${formatMoney(Number(order.totalPrice || 0))} 元`,
        "选图、报价和发送记录会保留，后续如需恢复需要人工重新处理。",
      ].join("\n"),
    );
    if (!confirmed) {
      setMessage(`已取消${statusText}订单操作。`);
      return;
    }
    await updateOrderDraftStatus(order, { status });
  }

  async function confirmAndStartOrderProduction(order: OrderDraft) {
    const customerName = order.customer?.name || order.quoteDraft?.customer?.name || "客户";
    const paymentText = paymentStatusLabel(orderPaymentStatusValue(order));
    const identityLines = orderIdentityConfirmLines(order);
    const blocker = orderProductionBlockReason(order);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    const confirmed = window.confirm(
      [
        `确认将「${customerName}」的订单标记为生产中吗？`,
        "",
        `订单ID：${order.id}`,
        ...identityLines,
        "",
        `订单金额：${formatMoney(Number(order.totalPrice || 0))} 元`,
        `付款状态：${paymentText}`,
        "系统会保留报价、选图和发送记录，后续可继续发送生产通知或交期说明。",
      ].join("\n"),
    );
    if (!confirmed) {
      setMessage("已取消标记生产中操作。");
      return;
    }
    await updateOrderDraftStatus(order, { status: "processing" });
  }

  async function recordHighValueOrderManualFollowup(order: OrderDraft) {
    const step = highValueOrderManualStep(order);
    const identityLines = orderIdentityConfirmLines(order);
    const note = window.prompt(
      [
        `记录「${order.customer?.name || order.quoteDraft?.customer?.name || "客户"}」高价值订单人工处理结果。`,
        "",
        `订单ID：${order.id}`,
        ...identityLines,
        "",
        "请写清楚客户答复、收款/交期/生产承诺和下一步动作。",
      ].join("\n"),
      step.nextAction,
    );
    if (note === null) return;
    const cleanNote = note.trim();
    if (!cleanNote) {
      setMessage("请填写本次人工处理结果，空备注不会保存。");
      return;
    }
    const nextFollowAt = window.prompt("下一次跟进时间，可填“今天18点”“明天上午”“7月5日前”，不确定可留空。", "");
    if (nextFollowAt === null) return;
    const reviewer = order.owner || "人工客服";
    const manualNote = buildHighValueOrderManualNote({
      note: cleanNote,
      nextFollowAt: nextFollowAt.trim(),
      reviewer,
      stepLabel: step.label,
    });
    await runAction("记录订单跟进", async () => {
      const updated = await updateOrderDraft(order.id, {
        ...identityExpectation(order),
        owner: reviewer,
        customerNotes: appendOrderCustomerNotes(order.customerNotes, manualNote),
      });
      upsertOrderDraftState(updated);
      const reviewed = await reviewOrder(order.id, {
        ...identityExpectation(order),
        decision: "request_followup",
        reviewer,
        note: manualNote,
      });
      applyReviewOrderResultState(reviewed);
    });
  }

  async function reviseOrderDraftSelection(order: OrderDraft) {
    const blocker = orderRevisionBlockReason(order);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    const selectedImage = promptOrderRevisionImage(order);
    if (!selectedImage) return;
    if (!confirmOrderSelectionRevision(order, selectedImage)) {
      setMessage("已取消订单选图修订。");
      return;
    }
    await runAction("修订订单选图", () =>
      reviseOrderSelection(order.id, {
        ...identityExpectation(order),
        selectedImageId: selectedImage.id,
        owner: "人工客服",
        note: `客户改选第 ${selectedImage.position} 张效果图，订单回到待确认。`,
      }),
    );
  }

  function confirmHighValueOrderManualRelease(
    order: OrderDraft,
    action: "confirmation" | "production_followup" | "delivery_followup",
  ) {
    if (!isHighValueOrder(order)) return {};
    const identityLines = orderIdentityConfirmLines(order);
    const labels = {
      confirmation: "发送订单确认",
      production_followup: "发送生产进度",
      delivery_followup: "发送交期说明",
    };
    const releaseReasons = {
      confirmation: "manual_approve_order_confirmation",
      production_followup: "manual_approve_order_followup",
      delivery_followup: "manual_approve_order_followup",
    };
    const confirmed = window.confirm(
      [
        `这是高价值订单，确认继续${labels[action]}吗？`,
        "",
        `订单ID：${order.id}`,
        ...identityLines,
        "",
        `订单金额：${formatMoney(Number(order.totalPrice || 0))} 元`,
        `付款状态：${paymentStatusLabel(orderPaymentStatusValue(order))}`,
        "请确认客户、微信账号、金额、付款状态、效果图和交付承诺都已人工核对。",
      ].join("\n"),
    );
    if (!confirmed) {
      setMessage("已取消高价值订单发送，请人工核对后再处理。");
      return null;
    }
    return {
      releaseManualLock: true,
      releaseReason: releaseReasons[action],
      reason: releaseReasons[action],
      note: `高价值订单已人工核对，${labels[action]}已进入微信安全发送队列。`,
    };
  }

  function confirmOrderConfirmationSendQueue(order: OrderDraft, preview: OrderConfirmationPreview) {
    const previewOrder = preview.orderDraft || order;
    const customerName = previewOrder.customer?.name || previewOrder.quoteDraft?.customer?.name || "客户";
    const selectedImage = orderSelectedImage(previewOrder);
    const wechatAccountLabel = previewOrder.wechatAccountId || previewOrder.designJob?.wechatAccountId || "未绑定";
    const customerLabel = previewOrder.customerId || previewOrder.quoteDraft?.customerId || "未绑定";
    const conversationLabel = previewOrder.designJob?.conversation?.title || previewOrder.conversationId || "未绑定";
    const message = String(preview.message || "").trim();
    const lines = [
      `确认把「${customerName}」的订单确认加入微信安全发送队列吗？`,
      "",
      `订单ID：${previewOrder.id || order.id}`,
      `微信账号：${wechatAccountLabel}`,
      `客户ID：${customerLabel}`,
      `会话：${conversationLabel}`,
      selectedImage?.position ? `选图：第 ${selectedImage.position} 张` : "选图：已通过发送前检查",
      "",
      `订单金额：${formatMoney(Number(previewOrder.totalPrice || order.totalPrice || 0))} 元`,
      `数量：${Number(previewOrder.quantity || order.quantity || 0) || "-"} 份`,
      `付款状态：${paymentStatusLabel(orderPaymentStatusValue(previewOrder))}`,
      "",
      "系统会继续通过账号、聊天对象、最近消息三重校验后再发送。",
    ];
    if (message) {
      const clipped = message.length > 220 ? `${message.slice(0, 220)}...` : message;
      lines.push("", "将发送话术预览：", clipped);
    }
    return window.confirm(lines.join("\n"));
  }

  function confirmOrderFollowupSendQueue(order: OrderDraft, type: "production" | "delivery") {
    const customerName = order.customer?.name || order.quoteDraft?.customer?.name || "客户";
    const stageLabel = orderFollowupStageLabel(type);
    const selectedImage = orderSelectedImage(order);
    const wechatAccountLabel = order.wechatAccountId || order.designJob?.wechatAccountId || "未绑定";
    const customerLabel = order.customerId || order.quoteDraft?.customerId || "未绑定";
    const conversationLabel = order.designJob?.conversation?.title || order.conversationId || "未绑定";
    const lines = [
      `确认把「${customerName}」的${stageLabel}加入微信安全发送队列吗？`,
      "",
      `订单ID：${order.id}`,
      `微信账号：${wechatAccountLabel}`,
      `客户ID：${customerLabel}`,
      `会话：${conversationLabel}`,
      selectedImage?.position ? `选图：第 ${selectedImage.position} 张` : "选图：已通过发送前检查",
      "",
      `订单金额：${formatMoney(Number(order.totalPrice || 0))} 元`,
      `订单状态：${orderStatusLabel(order.status)}`,
      `付款状态：${paymentStatusLabel(orderPaymentStatusValue(order))}`,
      "",
      "系统会继续通过账号、聊天对象、最近消息三重校验后再发送。",
    ];
    return window.confirm(lines.join("\n"));
  }

  async function queueOrderDraftConfirmation(order: OrderDraft) {
    if (order.status === "cancelled") {
      setMessage("订单已取消，不能发送确认。");
      return;
    }
    if (canRequeueOrderConfirmationTask(order)) {
      const task = order.confirmationSendTask!;
      if (!confirmSendTaskRequeue(task, "订单确认任务")) {
        setMessage("已取消重新排队订单确认。");
        return;
      }
      await runAction("重新排队订单确认", () => requeueSendTask(order.confirmationSendTask!.id, identityExpectation(order.confirmationSendTask!)));
      return;
    }
    if (hasActiveOrderConfirmationTask(order)) {
      setMessage(`订单确认已在发送队列中：${sendStatusLabel(order.confirmationSendTask?.status || "")}`);
      return;
    }
    const result = await checkOrderReadyForConfirmation(order);
    if (result.preview) {
      setOrderConfirmationPreviewId(order.id);
      setOrderConfirmationPreview(result.preview);
    }
    if (!result.ok) {
      setMessage(`订单确认发送前检查未通过：${result.reason}`);
      return;
    }
    if (!confirmOrderConfirmationSendQueue(order, result.preview)) {
      setMessage("已取消订单确认发送入队。");
      return;
    }
    const manualRelease = confirmHighValueOrderManualRelease(order, "confirmation");
    if (manualRelease === null) return;
    await runAction("订单确认进入发送队列", async () => {
      const result = await queueOrderConfirmation(order.id, identityExpectation(order), manualRelease);
      upsertOrderDraftState(result.orderDraft);
      upsertSendTaskState(result.sendTask);
    });
  }

  function showOrderConfirmationMessage(order: OrderDraft) {
    const text = orderConfirmationText(order);
    if (!text) {
      setMessage("当前订单确认任务没有可预览的话术。");
      return;
    }
    setMessage(`订单确认话术：${text}`);
  }

  async function cancelOrderConfirmation(order: OrderDraft) {
    const task = order.confirmationSendTask;
    if (!task) {
      setMessage("当前订单还没有确认发送任务。");
      return;
    }
    if (!canCancelOrderConfirmationTask(order)) {
      setMessage(`当前确认任务${sendStatusLabel(task.status)}，不能取消。`);
      return;
    }
    if (!confirmSendTaskCancel(task, "订单确认任务")) {
      setMessage("已取消订单确认发送取消操作。");
      return;
    }
    await runAction("取消订单确认发送", () => cancelSendTask(task.id, identityExpectation(task)));
  }

  function showOrderFollowupMessage(order: OrderDraft, type: "production" | "delivery") {
    const text = orderFollowupText(order, type);
    if (!text) {
      setMessage(`当前${orderFollowupStageLabel(type)}任务没有可预览的话术。`);
      return;
    }
    setMessage(`${orderFollowupStageLabel(type)}话术：${text}`);
  }

  async function cancelOrderFollowup(order: OrderDraft, type: "production" | "delivery") {
    const task = orderFollowupTask(order, type);
    if (!task) {
      setMessage(`当前订单还没有${orderFollowupStageLabel(type)}发送任务。`);
      return;
    }
    if (!canCancelOrderFollowupTask(order, type)) {
      setMessage(`当前${orderFollowupStageLabel(type)}任务${sendStatusLabel(task.status)}，不能取消。`);
      return;
    }
    if (!confirmSendTaskCancel(task, `${orderFollowupStageLabel(type)}任务`)) {
      setMessage(`已取消${orderFollowupStageLabel(type)}发送取消操作。`);
      return;
    }
    await runAction(`取消${orderFollowupStageLabel(type)}发送`, () => cancelSendTask(task.id, identityExpectation(task)));
  }

  async function queueOrderFollowupDraft(order: OrderDraft, type: "production" | "delivery") {
    const task = orderFollowupTask(order, type);
    if (canRequeueOrderFollowupTask(order, type) && task) {
      if (!confirmSendTaskRequeue(task, `${orderFollowupStageLabel(type)}任务`)) {
        setMessage(`已取消重新排队${orderFollowupStageLabel(type)}。`);
        return;
      }
      await runAction(`重新排队${orderFollowupStageLabel(type)}`, () => requeueSendTask(task.id, identityExpectation(task)));
      return;
    }
    const blocker = orderFollowupBlockReason(order, type);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    if (!confirmOrderFollowupSendQueue(order, type)) {
      setMessage(`已取消${orderFollowupStageLabel(type)}发送入队。`);
      return;
    }
    const manualRelease = confirmHighValueOrderManualRelease(order, type === "delivery" ? "delivery_followup" : "production_followup");
    if (manualRelease === null) return;
    await runAction(type === "delivery" ? "交期说明进入发送队列" : "生产通知进入发送队列", async () => {
      const result = await queueOrderFollowup(order.id, type, identityExpectation(order), manualRelease);
      upsertOrderDraftState(result.orderDraft);
      upsertSendTaskState(result.sendTask);
    });
  }

  function renderOrderFollowupControls(order: OrderDraft, type: "production" | "delivery") {
    const task = orderFollowupTask(order, type);
    return (
      <>
        <button type="button"
          className="ghost"
          onClick={() => queueOrderFollowupDraft(order, type)}
          disabled={Boolean(busy) || Boolean(orderFollowupBlockReason(order, type))}
          title={orderFollowupButtonTitle(order, type)}
        >
          {type === "delivery" ? <MessageCircle size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {orderFollowupButtonLabel(order, type)}
        </button>
        {task ? (
          <button type="button" className="ghost" onClick={() => showOrderFollowupMessage(order, type)} disabled={Boolean(busy)} title={`查看本次${orderFollowupStageLabel(type)}话术`}>
            <MessageCircle size={16} aria-hidden="true" />话术
          </button>
        ) : null}
        {canCancelOrderFollowupTask(order, type) ? (
          <button type="button" className="ghost danger" onClick={() => cancelOrderFollowup(order, type)} disabled={Boolean(busy)} title={`取消尚未发送的${orderFollowupStageLabel(type)}任务`}>
            <X size={16} aria-hidden="true" />取消{type === "delivery" ? "交期" : "生产"}
          </button>
        ) : null}
      </>
    );
  }

  function focusQuoteCenter(searchTerm: string, view: "quotes" | "orders" = "quotes") {
    setQuoteCenterSearch(searchTerm);
    setQuoteStatusFilter("all");
    setQuotePaymentFilter("all");
    setOrderStatusFilter("all");
    setOrderPaymentFilter("all");
    setDealNextStepFilter("all");
    setDealProgressFilter("all");
    setQuoteWorkbenchView(view);
    scrollToWorkspaceSection("quote-center");
  }

  function focusOrderDraft(order: OrderDraft) {
    focusQuoteCenter(order.quoteDraftId || order.id, "orders");
  }

  function focusSendTaskOrder(task: SendTask) {
    const orderDraftId = sendTaskOrderDraftId(task);
    if (!orderDraftId) {
      setMessage(`发送任务 ${task.id} 没有关联订单，请按会话和发送内容人工核对。`);
      return;
    }
    const order = dedupeOrdersById([...orderDrafts, ...(reviewCenter.orderDrafts || [])]).find((item) => item.id === orderDraftId);
    if (order) {
      focusOrderDraft(order);
      setReviewWorkbenchView("order");
      setHighValueOrderReviewFilter(highValueOrderReviewFilterForOrder(order));
      setMessage(`已定位到订单 ${orderDraftId}，请核对发送任务 ${task.id} 的异常原因。`);
      return;
    }
    focusQuoteCenter(orderDraftId, "orders");
    setReviewWorkbenchView("order");
    setHighValueOrderReviewFilter("send_attention");
    setMessage(`已切到订单列表并搜索 ${orderDraftId}，如列表里没有该订单，请刷新后再核对发送任务 ${task.id}。`);
  }

  function orderSendAttentionTasks(order: OrderDraft) {
    const directTasks = [
      order.confirmationSendTask,
      order.followupSendTask,
      order.productionFollowupSendTask,
      order.deliveryFollowupSendTask,
      ...(order.followupSendTasks || []),
    ].filter(Boolean) as SendTask[];
    const taskIds = new Set<string>(
      [
        order.confirmationSendTaskId,
        order.followupSendTaskId,
        order.productionFollowupSendTaskId,
        order.deliveryFollowupSendTaskId,
        ...directTasks.map((task) => task.id),
      ]
        .filter(Boolean)
        .map((value) => String(value)),
    );
    const matchedTasks = sendTasks.filter((task) => {
      if (taskIds.has(task.id)) return true;
      const automation = (task.guardSnapshot as { automation?: Record<string, unknown> } | undefined)?.automation || {};
      return Boolean(order.id && String(automation.orderDraftId || task.payload?.orderDraftId || "") === order.id);
    });
    const unique = new Map<string, SendTask>();
    for (const task of [...directTasks, ...matchedTasks]) {
      if (task.id && !unique.has(task.id)) unique.set(task.id, task);
    }
    return [...unique.values()];
  }

  function sendTaskNeedsManualAttention(task: SendTask) {
    return ["blocked", "failed", "cancelled", "dry_run"].includes(String(task.status || ""));
  }

  async function focusOrderManualSendAttention(order: OrderDraft) {
    setReviewWorkbenchView("order");
    setHighValueOrderReviewFilter("send_attention");
    const tasks = orderSendAttentionTasks(order);
    const task = tasks.find((item) => sendTaskNeedsManualAttention(item)) || tasks[0] || null;
    setSendWorkbenchView(task && sendTaskNeedsManualAttention(task) ? "blocked" : "queue");
    const conversationId = task?.conversationId || order.conversationId;
    if (conversationId) await focusConversation(conversationId, "send-center");
    else scrollToWorkspaceSection("send-center");
    setMessage(
      task
        ? `已定位到发送中心，请核对发送任务 ${task.id} 的账号、会话、最近消息和失败原因。`
        : `已切到发送中心，但未找到订单 ${order.id} 对应的发送任务；请按客户会话和订单备注人工核对。`,
    );
  }

  function clearQuoteCenterFocus() {
    setQuoteCenterSearch("");
    setQuoteStatusFilter("all");
    setQuotePaymentFilter("all");
    setOrderStatusFilter("all");
    setOrderPaymentFilter("all");
    setDealNextStepFilter("all");
    setDealProgressFilter("all");
  }

  function handleLowValueAutomationIssue(issue: LowValueAutomationIssue) {
    setActiveAutomationIssueKey(issue.key);
    const order =
      (issue.orderDraftId && orderDrafts.find((row) => row.id === issue.orderDraftId)) ||
      (issue.quoteDraftId && orderDrafts.find((row) => row.quoteDraftId === issue.quoteDraftId)) ||
      (issue.designJobId && orderDrafts.find((row) => row.designJobId === issue.designJobId)) ||
      null;
    const quote =
      (issue.quoteDraftId && quotes.find((row) => row.id === issue.quoteDraftId)) ||
      (issue.designJobId && quotes.find((row) => row.designJobId === issue.designJobId)) ||
      null;

    if (issue.reason === "manual_send_attention_required" && order) {
      void focusOrderManualSendAttention(order);
      return;
    }

    if (order && lowValueIssuePrefersQuoteCenter(issue)) {
      focusOrderDraft(order);
      setMessage(`已定位到订单 ${order.id}：${issue.action}`);
      return;
    }

    if (quote && lowValueIssuePrefersQuoteCenter(issue)) {
      focusQuoteCenter(quote.id);
      setMessage(`已定位到报价 ${quote.id}：${issue.action}`);
      return;
    }

    if (issue.orderDraftId || issue.quoteDraftId) {
      focusQuoteCenter(issue.orderDraftId || issue.quoteDraftId || "");
      setMessage(`已切到报价/订单中心：${issue.action}`);
      return;
    }

    if (issue.designJobId) {
      setActiveId(issue.designJobId);
      scrollToWorkspaceSection("design-center");
      const job = jobs.find((row) => row.id === issue.designJobId);
      setMessage(job ? `已定位到设计任务 ${job.id}：${issue.action}` : `已切到设计中心，请刷新后查看任务 ${issue.designJobId}。`);
      return;
    }

    scrollToWorkspaceSection("conversation-center");
    setMessage(`已切到消息中心：${issue.action}`);
  }

  async function handleAutomationReadinessCheck(check: AutomationReadiness["checks"][number]) {
    const guidance = check.action || check.detail;
    if (check.key === "sku_catalog") {
      const firstBlockingRepair = skuRepairQueue.find((item) => item.severity !== "info") || skuRepairQueue[0];
      if (firstBlockingRepair) {
        repairSku(firstBlockingRepair);
        return;
      }
      setSkuIssueFilter(check.ok ? "ready" : "problem");
      scrollToWorkspaceSection("sku-library");
      setMessage(`已切到商品库：${guidance}`);
      return;
    }
    if (check.key === "design_platform") {
      scrollToWorkspaceSection("design-platform-config");
      setMessage(`已切到设计平台配置：${guidance}`);
      return;
    }
    if (check.key === "manual_locks") {
      const firstLockedConversation = prioritizedManualLockedConversations[0];
      if (firstLockedConversation) await changeActiveConversation(firstLockedConversation.id);
      scrollToWorkspaceSection("review-center");
      setMessage(
        firstLockedConversation
          ? `已定位到人工接管会话 ${firstLockedConversation.title}：${guidance}`
          : `已切到审核中心：${guidance}`,
      );
      return;
    }
    if (check.key === "send_queue") {
      const firstPendingTask = sendTasks.find((task) => !["sent", "cancelled"].includes(task.status));
      if (firstPendingTask?.conversationId) await changeActiveConversation(firstPendingTask.conversationId);
      scrollToWorkspaceSection("send-center");
      setMessage(
        firstPendingTask
          ? `已定位到发送任务 ${firstPendingTask.id}：${guidance}`
          : `已切到安全发送队列：${guidance}`,
      );
      return;
    }
    scrollToWorkspaceSection("notice-center");
    setMessage(guidance);
  }

  function getAutomationReadinessPrimaryCheck(readiness: AutomationReadiness | null) {
    if (!readiness) return null;
    return (
      readiness.blockers[0] ||
      readiness.warnings[0] ||
      readiness.checks.find((check) => !check.ok) ||
      readiness.checks[0] ||
      null
    );
  }

  function handleAutomationReadinessPrimaryCheck() {
    const check = getAutomationReadinessPrimaryCheck(automationReadiness);
    if (!check) {
      setMessage("低价值自动化开机检查还没有返回结果，请先刷新检查。");
      return;
    }
    void handleAutomationReadinessCheck(check);
  }

  function handleAutomationRuntimeItem(label: string) {
    if (label === "后台状态") {
      toggleAutomationActive();
      return;
    }
    if (label === "发送队列") {
      processSafeQueue();
      return;
    }
    if (label === "出图轮询") {
      pollAllActiveDesignResults();
      return;
    }
    if (label === "运行间隔") {
      scrollToWorkspaceSection("notice-center");
      setMessage("运行间隔由后台配置控制，这里保持只读；可直接跑一轮验证自动化。");
      return;
    }
    runAutomationCycle();
  }

  function handleLowValueAutomationSummaryMetric(label: string) {
    if (label === "草稿提交") {
      autoSubmitDrafts();
      return;
    }
    if (label === "订单草稿" || label === "订单确认" || label === "订单跟进") {
      progressQuoteDealFlow();
      return;
    }
    if (label === "安全发送" || label === "图片入队" || label === "报价入队") {
      processSafeQueue();
      return;
    }
    if (label === "错误" || label === "拦截") {
      if (lowValueAutomationIssueSummary?.firstIssue) {
        handleLowValueAutomationIssue(lowValueAutomationIssueSummary.firstIssue);
      } else {
        scanSendOps();
      }
      return;
    }
    runLowValueAutomation();
  }

  function handleAutomationStepItem(key: string) {
    if (key === "pollActiveResults") {
      pollAllActiveDesignResults();
      return;
    }
    if (key === "scanTimeouts") {
      scanTimeouts();
      return;
    }
    if (key === "scanSendOperations") {
      scanSendOps();
      return;
    }
    if (key === "processLowValueSendQueue") {
      processSafeQueue();
      return;
    }
    if (key === "scanLowValueOrderDrafts" || key === "scanLowValueOrderConfirmations" || key === "scanLowValueOrderFollowups") {
      progressQuoteDealFlow();
      return;
    }
    runLowValueAutomation();
  }

  function handleAutomationIssueMetric(kind: "errors" | "warnings" | "missing" | "sendTargets" | "manualLocks") {
    const issue = findLowValueAutomationIssueForMetric(lowValueAutomationIssues, kind);
    if (issue) {
      handleLowValueAutomationIssue(issue);
      setMessage(`已定位「${lowValueIssueMetricLabel(kind)}」卡点：${issue.stage} · ${issue.target}。`);
      return;
    }
    if (kind === "manualLocks") {
      scrollToWorkspaceSection("account-center");
      setMessage("当前没有具体人工接管卡点，已切到多账号控制查看人工接管会话。");
      return;
    }
    scrollToWorkspaceSection(kind === "sendTargets" ? "send-center" : "notice-center");
  }

  async function saveActiveQuoteEdit() {
    if (!activeQuote) return;
    if (!confirmActiveQuoteEditSave(activeQuote)) {
      setMessage("已取消保存报价调整。");
      return;
    }
    await runAction("保存报价调整", async () => {
      const updated = await updateQuote(activeQuote.id, {
        ...identityExpectation(activeQuote),
        quantity: quoteEdit.quantity,
        unitPrice: quoteEdit.unitPrice,
        totalCost: quoteEdit.totalCost,
        customerNotes: quoteEdit.customerNotes,
      });
      upsertQuoteState(updated);
    });
  }

  function confirmQuoteSendQueue(quote: QuoteDraft, preview: QuotePreview) {
    const previewQuote = preview.quote || quote;
    const customerName = previewQuote.customer?.name || previewQuote.designJob?.customerId || "客户";
    const selectedImage = quoteSelectedImage(previewQuote);
    const wechatAccountLabel =
      previewQuote.designJob?.conversation?.wechatAccountId || previewQuote.designJob?.wechatAccountId || "未绑定";
    const customerLabel = previewQuote.customerId || previewQuote.designJob?.customerId || "未绑定";
    const conversationLabel = previewQuote.designJob?.conversation?.title || previewQuote.designJob?.conversationId || "未绑定";
    const lines = [
      `确认把「${customerName}」的报价加入微信安全发送队列吗？`,
      "",
      `报价ID：${previewQuote.id || quote.id}`,
      `微信账号：${wechatAccountLabel}`,
      `客户ID：${customerLabel}`,
      `会话：${conversationLabel}`,
      selectedImage?.position ? `选图：第 ${selectedImage.position} 张` : "选图：已通过发送前检查",
      "",
      `报价金额：${formatMoney(Number(previewQuote.totalPrice || quote.totalPrice || 0))} 元`,
      `数量：${Number(previewQuote.quantity || quote.quantity || 0) || "-"} 份`,
      "",
      "系统会继续通过账号、聊天对象、最近消息三重校验后再发送。",
    ];
    const message = String(preview.message || "").trim();
    if (message) {
      const clipped = message.length > 220 ? `${message.slice(0, 220)}...` : message;
      lines.push("", "将发送话术预览：", clipped);
    }
    return window.confirm(lines.join("\n"));
  }

  async function queueQuoteDraft(quote: QuoteDraft) {
    const risk = quote.id === activeQuote?.id ? quoteSendBlockReason(quote, activeQuoteWarnings) : quoteSendBlockReason(quote);
    if (risk) {
      setMessage(`发送前检查未通过：${risk}`);
      return;
    }
    const result = await checkQuoteReadyForSend(quote);
    if (result.preview && quoteCenterPreviewId === quote.id) setQuoteCenterPreview(result.preview);
    if (!result.ok) {
      setMessage(`发送前检查未通过：${result.reason}`);
      return;
    }
    if (!confirmQuoteSendQueue(quote, result.preview)) {
      setMessage("已取消报价发送入队。");
      return;
    }
    await runAction("报价进入发送队列", async () => {
      const queued = await queueQuoteSend(quote.id, identityExpectation(quote));
      upsertQuoteState(queued.quote);
      upsertSendTaskState(queued.sendTask);
    });
  }

  async function checkQuoteReadyForSend(quote: QuoteDraft): Promise<{ ok: true; preview: QuotePreview } | { ok: false; reason: string; preview?: QuotePreview }> {
    try {
      const preview =
        activeQuotePreview?.quote.id === quote.id
          ? activeQuotePreview
          : quoteCenterPreview?.quote.id === quote.id
            ? quoteCenterPreview
            : await getQuotePreview(quote.id, identityExpectation(quote));
      const previewRisk = quoteSendBlockReason(preview.quote, preview.warnings);
      if (previewRisk) return { ok: false, reason: previewRisk, preview };
      return { ok: true, preview };
    } catch {
      return { ok: false, reason: "报价话术预览生成失败，请刷新后重试。" };
    }
  }

  async function queueQuoteAfterPreviewCheck(quote: QuoteDraft) {
    const result = await checkQuoteReadyForSend(quote);
    if (result.preview && quoteCenterPreviewId === quote.id) setQuoteCenterPreview(result.preview);
    if (!result.ok) {
      setMessage(`发送前检查未通过：${result.reason}`);
      throw new Error(result.reason);
    }
    const queued = await queueQuoteSend(quote.id, identityExpectation(quote));
    upsertQuoteState(queued.quote);
    upsertSendTaskState(queued.sendTask);
    return queued;
  }

  async function checkQuoteReadyForManualApproval(
    quote: QuoteDraft,
  ): Promise<{ ok: true; preview: QuotePreview } | { ok: false; reason: string; preview?: QuotePreview }> {
    try {
      const preview =
        activeQuotePreview?.quote.id === quote.id
          ? activeQuotePreview
          : quoteCenterPreview?.quote.id === quote.id
            ? quoteCenterPreview
            : await getQuotePreview(quote.id, identityExpectation(quote));
      const previewRisk = quoteSendBlockReason(preview.quote, preview.warnings, { allowManualReview: true });
      if (previewRisk) return { ok: false, reason: previewRisk, preview };
      return { ok: true, preview };
    } catch {
      return { ok: false, reason: "报价话术预览生成失败，请刷新后重试。" };
    }
  }

  async function checkOrderReadyForConfirmation(
    order: OrderDraft,
  ): Promise<{ ok: true; preview: OrderConfirmationPreview } | { ok: false; reason: string; preview?: OrderConfirmationPreview }> {
    try {
      const preview =
        orderConfirmationPreview?.orderDraft.id === order.id
          ? orderConfirmationPreview
          : await getOrderConfirmationPreview(order.id, identityExpectation(order));
      const previewRisk = orderConfirmationBlockReason(preview.orderDraft, preview.warnings);
      if (previewRisk) return { ok: false, reason: previewRisk, preview };
      return { ok: true, preview };
    } catch {
      return { ok: false, reason: "订单确认话术预览生成失败，请刷新后重试。" };
    }
  }

  async function queueOrderConfirmationAfterPreviewCheck(order: OrderDraft) {
    const result = await checkOrderReadyForConfirmation(order);
    if (result.preview && orderConfirmationPreviewId === order.id) setOrderConfirmationPreview(result.preview);
    if (!result.ok) {
      setMessage(`订单确认发送前检查未通过：${result.reason}`);
      throw new Error(result.reason);
    }
    const manualRelease = confirmHighValueOrderManualRelease(order, "confirmation");
    if (manualRelease === null) throw new Error("高价值订单需要人工确认后才能发送。");
    const confirmation = await queueOrderConfirmation(order.id, identityExpectation(order), manualRelease);
    upsertOrderDraftState(confirmation.orderDraft);
    upsertSendTaskState(confirmation.sendTask);
    return confirmation;
  }

  async function toggleQuoteCenterPreview(quote: QuoteDraft) {
    if (quoteCenterPreviewId === quote.id) {
      setQuoteCenterPreviewId("");
      setQuoteCenterPreview(null);
      return;
    }
    try {
      setBusy("生成报价话术预览");
      setMessage("正在生成报价话术预览...");
      const preview = await getQuotePreview(quote.id, identityExpectation(quote));
      setQuoteCenterPreviewId(quote.id);
      setQuoteCenterPreview(preview);
      setMessage("报价话术预览已生成。");
    } catch {
      setQuoteCenterPreviewId(quote.id);
      setQuoteCenterPreview({
        quote,
        message: "报价预览暂时生成失败，请刷新后重试。",
        warnings: ["preview failed"],
      });
      setMessage("报价话术预览生成失败，请刷新后重试。");
    } finally {
      setBusy("");
    }
  }

  async function copyQuoteCenterPreviewMessage(preview: QuotePreview | null) {
    if (!preview?.message) {
      setMessage("当前没有可复制的话术。");
      return;
    }
    try {
      await navigator.clipboard.writeText(preview.message);
      setMessage("报价话术已复制。");
    } catch {
      setMessage("复制失败，请手动选中文字复制。");
    }
  }

  async function toggleOrderConfirmationPreview(order: OrderDraft) {
    if (orderConfirmationPreviewId === order.id) {
      setOrderConfirmationPreviewId("");
      setOrderConfirmationPreview(null);
      return;
    }
    try {
      setBusy("生成订单确认预览");
      setMessage("正在生成订单确认话术...");
      const preview = await getOrderConfirmationPreview(order.id, identityExpectation(order));
      setOrderConfirmationPreviewId(order.id);
      setOrderConfirmationPreview(preview);
      setMessage("订单确认话术预览已生成。");
    } catch {
      setOrderConfirmationPreviewId(order.id);
      setOrderConfirmationPreview({
        orderDraft: order,
        message: "订单确认预览暂时生成失败，请刷新后重试。",
        warnings: ["preview failed"],
      });
      setMessage("订单确认话术预览生成失败，请刷新后重试。");
    } finally {
      setBusy("");
    }
  }

  async function copyOrderConfirmationPreviewMessage(preview: OrderConfirmationPreview | null) {
    if (!preview?.message) {
      setMessage("当前没有可复制的订单确认话术。");
      return;
    }
    try {
      await navigator.clipboard.writeText(preview.message);
      setMessage("订单确认话术已复制。");
    } catch {
      setMessage("复制失败，请手动选中文字复制。");
    }
  }

  function guardedQuoteDealNextStep(quote: QuoteDraft, order: OrderDraft | null, sendRisk = "") {
    const step = quoteDealNextStep(quote, order, sendRisk);
    const orderDraftBlocker = quoteOrderDraftBlockReason(quote);
    if (orderDraftBlocker && (step.action === "confirm_quote_create_order" || step.action === "create_order")) {
      return { tone: "amber", label: "先补资料", detail: orderDraftBlocker, action: "none" };
    }
    return step;
  }

  function guardedOrderDealNextStep(order: OrderDraft) {
    return orderDealNextStep(order, {
      confirmationBlocker: orderConfirmationBlockReason(order),
      productionBlocker: orderProductionBlockReason(order),
      deliveryFollowupBlocker: orderFollowupBlockReason(order, "delivery"),
    });
  }

  async function runQuoteDealNextStep(quote: QuoteDraft, order: OrderDraft | null, sendRisk = "") {
    const step = guardedQuoteDealNextStep(quote, order, sendRisk);
    if (step.action === "queue_quote") {
      await queueQuoteDraft(quote);
      return;
    }
    if (step.action === "confirm_quote_create_order") {
      const blocker = quoteOrderDraftBlockReason(quote);
      if (blocker) {
        setMessage(blocker);
        return;
      }
      if (!confirmQuoteAcceptanceOrderCreation(quote)) {
        setMessage("已取消客户确认成单操作。");
        return;
      }
      await runAction("客户确认并生成订单", async () => {
        const updatedQuote = await updateQuote(quote.id, { ...identityExpectation(quote), status: "accepted" });
        upsertQuoteState(updatedQuote);
        const orderDraft = await createOrderDraftFromQuote(quote.id, identityExpectation(quote));
        upsertOrderDraftState(orderDraft);
      });
      return;
    }
    if (step.action === "create_order") {
      await createOrderDraft(quote);
      return;
    }
    setMessage(step.detail);
  }

  async function runOrderDealNextStep(order: OrderDraft) {
    const step = guardedOrderDealNextStep(order);
    if (step.action === "queue_order_confirmation") {
      await queueOrderDraftConfirmation(order);
      return;
    }
    if (step.action === "start_production") {
      await confirmAndStartOrderProduction(order);
      return;
    }
    if (step.action === "send_delivery_followup") {
      await queueOrderFollowupDraft(order, "delivery");
      return;
    }
    setMessage(step.detail);
  }

  async function runActiveDealNextStep() {
    if (!activeJob) return;
    if (!activeQuote) {
      if (!activeSelectedImage) {
        setMessage("先让客户明确选择一张效果图，再生成报价。");
        return;
      }
      await quoteActiveJob();
      return;
    }
    if (activeOrderDraft) {
      await runOrderDealNextStep(activeOrderDraft);
      return;
    }
    await runQuoteDealNextStep(activeQuote, activeOrderDraft, activeQuoteSendRisk);
  }

  async function runVisibleActionableDealNextSteps() {
    const items = actionableDealNextStepItems.slice(0, 3);
    if (!items.length) {
      setMessage("当前优先处理列表里没有可直接执行的成交事项。");
      return;
    }
    const confirmed = window.confirm(`将按顺序执行前 ${items.length} 个可执行成交事项。\n\n批量模式只会处理低风险的报价入队和订单确认入队；客户确认成单、生成订单、排产和交期跟进必须逐条人工确认，不会被批量推进。\n\n是否继续？`);
    if (!confirmed) return;

    const summary = {
      quoteQueued: 0,
      orderCreated: 0,
      orderConfirmationQueued: 0,
      productionStarted: 0,
      deliveryQueued: 0,
      skipped: 0,
      failed: 0,
    };

    await runAction(
      "批量推进成交事项",
      async () => {
        for (const item of items) {
          try {
            if (item.action === "queue_quote" && item.quote) {
              await queueQuoteAfterPreviewCheck(item.quote);
              summary.quoteQueued += 1;
              continue;
            }
            if (item.action === "confirm_quote_create_order" && item.quote) {
              summary.skipped += 1;
              continue;
            }
            if (item.action === "create_order" && item.quote) {
              summary.skipped += 1;
              continue;
            }
            if (item.action === "queue_order_confirmation" && item.order) {
              await queueOrderConfirmationAfterPreviewCheck(item.order);
              summary.orderConfirmationQueued += 1;
              continue;
            }
            if (item.action === "start_production" && item.order) {
              summary.skipped += 1;
              continue;
            }
            if (item.action === "send_delivery_followup" && item.order) {
              summary.skipped += 1;
              continue;
            }
            summary.skipped += 1;
          } catch {
            summary.failed += 1;
          }
        }
      },
      () => {
        setMessage(
          `批量推进完成：报价入队 ${summary.quoteQueued} 个，订单草稿 ${summary.orderCreated} 个，订单确认 ${summary.orderConfirmationQueued} 个，排产 ${summary.productionStarted} 个，交付跟进 ${summary.deliveryQueued} 个，跳过 ${summary.skipped} 个，失败 ${summary.failed} 个。`,
        );
      },
    );
  }

  async function reviewJob(job: DesignJob, decision: "approve_images" | "approve_send" | "request_revision" | "reject") {
    if (decision === "approve_send") {
      const risk = designImageSendBlockReason(job, { allowHighValueManualApproval: true });
      if (risk) {
        setMessage(`批准发送前检查未通过：${risk}`);
        return;
      }
    }
    const notes: Record<typeof decision, string> = {
      approve_images: "图片审核通过，可进入快速确认。",
      approve_send: "图片审核通过，进入发送安全队列。",
      request_revision: "图片还需要继续微调。",
      reject: "当前方案不适合直接发给客户。",
    };
    if (
      ["approve_images", "approve_send"].includes(decision) &&
      isHighValueDesignJob(job) &&
      !confirmHighValueManualApproval({
        title: job.customer?.name || job.customerId || "高价值客户",
        reason: highValueDesignReason(job),
        actionLabel: decision === "approve_send" ? "批准发图进入微信安全发送队列" : "图片审核通过，继续人工确认报价",
        nextAction: decision === "approve_send" ? "发送前再次核对微信账号、客户会话、最近消息和候选图。" : "继续人工核对报价、利润、交期和客户话术。",
        identityLines: designJobIdentityConfirmLines(job),
      })
    ) {
      setMessage("已取消高价值设计人工批准。");
      return;
    }
    await runAction("处理设计审核", async () => {
      const reviewed = await reviewDesignJob(job.id, {
        ...identityExpectation(job),
        decision,
        reviewer: "人工客服",
        note: notes[decision],
      });
      applyReviewDesignJobResultState(reviewed);
    });
  }

  function confirmQuoteReviewDecision(quote: QuoteDraft, decision: "approve_quote" | "request_followup" | "reject_quote") {
    const selectedImage = quoteSelectedImage(quote);
    const customerName = quote.customer?.name || quote.designJob?.customerId || "客户";
    const identityLines = quoteIdentityConfirmLines(quote);
    const actionLabels: Record<typeof decision, string> = {
      approve_quote: "通过报价，并在后端检查通过后进入微信安全发送队列",
      request_followup: "转人工继续跟进，不自动发送报价",
      reject_quote: "驳回当前报价，重新核算后再处理",
    };
    const nextActions: Record<typeof decision, string> = {
      approve_quote: "系统仍会校验微信账号、客户会话、最近消息、选图和报价金额，通过后才允许入队。",
      request_followup: "这条报价会保留在人工跟进里，由客服继续确认预算、选图、收款或客户意向。",
      reject_quote: "这条报价不会发送给客户，需要重新调整礼盒组合、价格或选图。",
    };
    const lines = [
      `确认审核「${customerName}」的报价吗？`,
      "",
      `报价ID：${quote.id}`,
      ...identityLines,
      "",
      `操作：${actionLabels[decision]}`,
      `报价金额：${formatMoney(Number(quote.totalPrice || 0))} 元`,
      `数量：${Number(quote.quantity || 0) || "-"} 份`,
      `付款状态：${paymentStatusLabel(quote.paymentStatus || "unpaid")}`,
      selectedImage?.position ? `选图：第 ${selectedImage.position} 张` : "选图：未识别",
      quote.owner ? `跟进人：${quote.owner}` : "跟进人：未指定",
      "",
      nextActions[decision],
    ];
    if (decision === "approve_quote") {
      lines.push("请确认客户、金额、选图、利润和发送对象都已经人工核对。");
    }
    return window.confirm(lines.join("\n"));
  }

  function confirmOrderReviewDecision(
    order: OrderDraft,
    decision: "approve_confirmation" | "approve_followup" | "request_followup" | "reject_order",
    followupType: "production" | "delivery" = "delivery",
  ) {
    const selectedImage = orderSelectedImage(order);
    const identityLines = orderIdentityConfirmLines(order);
    const customerName = order.customer?.name || order.quoteDraft?.customer?.name || "客户";
    const actionLabels: Record<typeof decision, string> = {
      approve_confirmation: "通过订单确认，并在后端检查通过后进入微信安全发送队列",
      approve_followup: `通过${orderFollowupStageLabel(followupType)}，并在后端检查通过后进入微信安全发送队列`,
      request_followup: "转人工继续跟进，不自动发送订单消息",
      reject_order: "驳回订单，当前订单会按后端规则取消或退回处理",
    };
    const nextActions: Record<typeof decision, string> = {
      approve_confirmation: "系统仍会校验微信账号、客户会话、最近消息、付款状态和订单金额，通过后才允许入队。",
      approve_followup: "系统仍会校验订单状态、跟进阶段、客户会话和最近消息，通过后才允许入队。",
      request_followup: "这条订单会保留在人工跟进里，由客服继续确认收款、交期、生产或客户要求。",
      reject_order: "这条订单不会继续自动发送，需要人工重新核对订单、报价和客户需求。",
    };
    const lines = [
      `确认审核「${customerName}」的订单吗？`,
      "",
      `订单ID：${order.id}`,
      ...identityLines,
      "",
      `操作：${actionLabels[decision]}`,
      `订单金额：${formatMoney(Number(order.totalPrice || 0))} 元`,
      `数量：${Number(order.quantity || 0) || "-"} 份`,
      `订单状态：${orderStatusLabel(order.status)}`,
      `付款状态：${paymentStatusLabel(orderPaymentStatusValue(order))}`,
      selectedImage?.position ? `选图：第 ${selectedImage.position} 张` : "选图：未识别",
      order.owner ? `跟进人：${order.owner}` : "跟进人：未指定",
      "",
      nextActions[decision],
    ];
    if (decision === "approve_confirmation" || decision === "approve_followup") {
      lines.push("请确认不会把 A 客户订单或图片发给 B 客户，且收款、金额、交期和发送对象已经人工核对。");
    }
    return window.confirm(lines.join("\n"));
  }

  async function reviewQuoteDraft(quote: QuoteDraft, decision: "approve_quote" | "request_followup" | "reject_quote") {
    const notes: Record<typeof decision, string> = {
      approve_quote: "报价审核通过，可以发给客户确认。",
      request_followup: "报价需要客服继续跟进客户意向。",
      reject_quote: "报价需要重新核算后再发送。",
    };
    if (decision === "approve_quote") {
      if (quoteNeedsPaymentProofReview(quote)) {
        setMessage("这条报价带有付款凭证，不能直接通过并入队；请先人工核验金额和收款账户，再选择定金并确认或全款并确认。");
        return;
      }
      const result = await checkQuoteReadyForManualApproval(quote);
      if (result.preview && quoteCenterPreviewId === quote.id) setQuoteCenterPreview(result.preview);
      if (!result.ok) {
        setMessage(`人工批准报价前检查未通过：${result.reason}`);
        return;
      }
      if (
        (quote.status === "manual_review" || isHighValueQuote(quote)) &&
        !confirmHighValueManualApproval({
          title: quote.customer?.name || quote.designJob?.customerId || "高价值客户",
          reason: highValueQuoteReason(quote),
          actionLabel: "批准报价进入微信安全发送队列",
          nextAction: "发送前再次核对客户身份、选图、金额、利润、话术和微信会话。",
          identityLines: [`报价ID：${quote.id}`, ...quoteIdentityConfirmLines(quote)],
        })
      ) {
        setMessage("已取消高价值报价人工批准。");
        return;
      }
    }
    if (!confirmQuoteReviewDecision(quote, decision)) {
      setMessage("已取消报价审核操作。");
      return;
    }
    await runAction("处理报价审核", async () => {
      const reviewed = await reviewQuote(quote.id, {
        ...identityExpectation(quote),
        decision,
        reviewer: "人工客服",
        note: notes[decision],
      });
      applyReviewQuoteResultState(reviewed);
    });
  }

  async function reviewOrderDraft(
    order: OrderDraft,
    decision: "approve_confirmation" | "approve_followup" | "request_followup" | "reject_order",
    followupType: "production" | "delivery" = "delivery",
  ) {
    const notes: Record<typeof decision, string> = {
      approve_confirmation: "高价值订单已人工核对，订单确认可以进入微信安全发送队列。",
      approve_followup: followupType === "delivery" ? "高价值订单已人工核对，交期说明可以发送。" : "高价值订单已人工核对，生产进度可以发送。",
      request_followup: "高价值订单需要客服继续跟进收款、交期和客户需求。",
      reject_order: "高价值订单暂不适合继续自动发送，请重新核对订单信息。",
    };
    if (decision === "approve_confirmation" || decision === "approve_followup") {
      const blocker = highValueOrderApprovalBlockReason(order);
      if (blocker) {
        setMessage(blocker);
        return;
      }
    }
    if (decision === "approve_confirmation") {
      if (hasActiveOrderConfirmationTask(order)) {
        setMessage(`订单确认已在发送队列中：${sendStatusLabel(order.confirmationSendTask?.status || "")}`);
        return;
      }
      const result = await checkOrderReadyForConfirmation(order);
      if (result.preview) {
        setOrderConfirmationPreviewId(order.id);
        setOrderConfirmationPreview(result.preview);
      }
      if (!result.ok) {
        setMessage(`订单确认发送前检查未通过：${result.reason}`);
        return;
      }
      if (confirmHighValueOrderManualRelease(order, "confirmation") === null) return;
    }
    if (decision === "approve_followup") {
      const blocker = orderFollowupBlockReason(order, followupType);
      if (blocker) {
        setMessage(blocker);
        return;
      }
      if (confirmHighValueOrderManualRelease(order, followupType === "delivery" ? "delivery_followup" : "production_followup") === null) return;
    }
    if (!confirmOrderReviewDecision(order, decision, followupType)) {
      setMessage("已取消订单审核操作。");
      return;
    }
    await runAction("处理订单审核", () =>
      (async () => {
        const reviewed = await reviewOrder(order.id, {
          ...identityExpectation(order),
          decision,
          followupType,
          reviewer: "人工客服",
          note: notes[decision],
        });
        applyReviewOrderResultState(reviewed);
      })(),
    );
  }
  async function downloadSkuTemplate() {
    let fileName = "";
    await runAction(
      "下载SKU模板",
      async () => {
        const template = await downloadSkuImportTemplate("xlsx");
        fileName = template.fileName;
        setSkuImportFields(template.fields || []);
        downloadBase64File(template.fileName, template.mimeType, template.dataBase64);
      },
      () => setMessage(`已生成 ${fileName || "SKU 导入模板"}，可用 Excel 打开后按示例行填写。`),
    );
  }

  function exportSkuRepairQueue() {
    const exportableSkuRepairQueue = visibleSkuRepairQueue;
    if (!exportableSkuRepairQueue.length) {
      setMessage("当前没有待补齐商品资料可导出。");
      return;
    }
    const rows = [
      ["SKU编号", "商品名称", "商品类型", "严重程度", "是否影响自动搭配/出图", "优先级", "问题数", "建议动作", "待补字段", "字段处理建议", "原始问题"],
      ...exportableSkuRepairQueue.map((item) => [
        item.skuCode || "",
        item.name || "",
        item.type || "",
        skuSeverityLabel(item.severity),
        item.blocking ? "是" : "否",
        String(item.priority ?? ""),
        String(item.issueCount ?? 0),
        item.recommendedAction || "",
        item.missingFields.map((field) => field.label || skuFieldLabel(field.field)).join("、"),
        item.missingFields.map((field) => field.action || "").filter(Boolean).join("；"),
        item.issues.map((issue) => `${issue.code}:${issue.message}`).join("；"),
      ]),
    ];
    const fileName = `sku-repair-queue-${formatDateForFile(new Date())}.csv`;
    downloadTextFile(fileName, "text/csv;charset=utf-8", `\uFEFF${toCsv(rows)}`);
    setMessage(`已导出 ${exportableSkuRepairQueue.length} 个待补齐商品，可交给运营按优先级补资料。`);
  }

  function resetSkuRepairView() {
    setSkuRepairFilter("all");
    setSkuRepairSearch("");
    setSkuRepairSort("priority");
    setMessage("已重置商品补齐视图：显示全部待补商品，并按优先级排序。");
  }

  function exportSkuCatalogIssues() {
    const issues = catalogAudit?.issues || [];
    if (!issues.length) {
      setMessage("当前没有商品体检问题可导出。");
      return;
    }
    const rows = [
      ["SKU编号", "商品名称", "严重程度", "问题类型", "字段", "问题说明", "图片位置", "多角度图序号", "原始路径", "是否图片问题"],
      ...issues.map((issue) => [
        issue.skuCode || "",
        issue.name || "",
        skuSeverityLabel(issue.severity),
        issue.code,
        skuFieldLabel(issue.field || ""),
        issue.message || "",
        issue.imageRole ? skuImageRoleLabel({ imageRole: issue.imageRole, imageIndex: issue.imageIndex ?? null }) : "",
        issue.imageRole === "angle" && issue.imageIndex !== null && issue.imageIndex !== undefined
          ? String(Number(issue.imageIndex) + 1)
          : "",
        issue.path || "",
        issue.imageRole ? "是" : "否",
      ]),
    ];
    const fileName = `sku-catalog-issues-${formatDateForFile(new Date())}.csv`;
    downloadTextFile(fileName, "text/csv;charset=utf-8", `\uFEFF${toCsv(rows)}`);
    setMessage(`已导出 ${issues.length} 条商品体检明细，可用于排查每个 SKU 的具体问题。`);
  }

  function exportSkuImageProblems() {
    const exportableSkuImageProblems = visibleSkuImageProblems;
    if (!exportableSkuImageProblems.length) {
      setMessage("当前没有图片问题可导出。");
      return;
    }
    const exportSkuImageProblemPositions = new Map<string, number>();
    const rows = [
      ["SKU编号", "商品名称", "问题标识", "同商品图片问题数", "同商品处理序号", "当前筛选", "审核刷新口径", "处理方式统计", "处理方式", "修复入口", "路径状态", "严重程度", "问题类型", "图片位置", "字段", "多角度图序号", "问题说明", "处理建议", "原始路径"],
      ...exportableSkuImageProblems.map((problem) => {
        const key = problem.skuCode || problem.name || "未归类商品";
        const productProblemCount = skuImageProblemCountByProduct.get(key) || 1;
        const productProblemPosition = (exportSkuImageProblemPositions.get(key) || 0) + 1;
        exportSkuImageProblemPositions.set(key, productProblemPosition);
        return [
          problem.skuCode || "",
          problem.name || "",
          skuImageProblemTrackingId(problem),
          String(productProblemCount),
          `${productProblemPosition}/${productProblemCount}`,
          visibleSkuImageProblemFilterSummary,
          skuImageProblemAuditRefreshContext,
          visibleSkuImageProblemActionSummary,
          skuImageProblemActionGroupLabel(problem),
          skuImageProblemRepairEntry(problem),
          skuImagePathStateLabel(problem.path),
          skuSeverityLabel(problem.severity),
          problem.code,
          skuImageRoleLabel(problem),
          skuFieldLabel(problem.field),
          problem.imageRole === "angle" && problem.imageIndex !== null && problem.imageIndex !== undefined
            ? String(Number(problem.imageIndex) + 1)
            : "",
          problem.message || "",
          skuImageProblemAction(problem),
          problem.path || "",
        ];
      }),
    ];
    const fileName = `sku-image-problems-${formatDateForFile(new Date())}.csv`;
    downloadTextFile(fileName, "text/csv;charset=utf-8", `\uFEFF${toCsv(rows)}`);
    setMessage(`已导出 ${exportableSkuImageProblems.length} 个图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品；${visibleSkuImageProblemActionSummary}；分组涉及商品：${visibleSkuImageProblemActionProductSummary}；下一步：${visibleSkuImageProblemNextStepSummary}；筛选：${visibleSkuImageProblemFilterSummary}；审核：${skuImageProblemAuditRefreshContext}。`);
  }

  async function copyVisibleSkuImageProblemTrackingIds() {
    if (!visibleSkuImageProblems.length) {
      setMessage("当前没有图片问题标识可复制。");
      return;
    }
    const lines = [
      `商品图片问题标识清单：当前筛选 ${visibleSkuImageProblems.length} 个图片问题`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `处理方式统计：${visibleSkuImageProblemActionSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      "",
      ...visibleSkuImageProblems.map((problem, index) => {
        const imageIndex = problem.imageRole === "angle" && problem.imageIndex !== null && problem.imageIndex !== undefined
          ? `第 ${Number(problem.imageIndex) + 1} 张`
          : "";
        return `${index + 1}. ${skuImageProblemTrackingId(problem)}｜${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}｜${skuImageRoleLabel(problem)}${imageIndex ? `（${imageIndex}）` : ""}`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage(`已复制 ${visibleSkuImageProblems.length} 个图片问题标识。`);
    } catch {
      setMessage("复制图片问题标识清单失败，请导出 CSV 后处理。");
    }
  }

  async function copySkuImageProblemHandoff() {
    const handoffProblems = visibleSkuImageProblems;
    if (!handoffProblems.length) {
      setMessage("当前没有图片问题可复制。");
      return;
    }
    const productGroups = new Map<string, SkuImageProblem[]>();
    for (const problem of handoffProblems) {
      const key = problem.skuCode || problem.name || "未归类商品";
      productGroups.set(key, [...(productGroups.get(key) || []), problem]);
    }
    let handoffIndex = 0;
    const groupedLines = Array.from(productGroups.values()).flatMap((problems, productIndex) => {
      const firstProblem = problems[0];
      return [
        `商品 ${productIndex + 1}：${firstProblem.skuCode || "未编号"}｜${firstProblem.name || "未命名商品"}（${problems.length} 个图片问题）`,
        ...problems.map((problem, problemIndex) => {
        handoffIndex += 1;
        const productProblemCount = skuImageProblemCountByProduct.get(problem.skuCode || problem.name) || 1;
        const imageIndex =
          problem.imageRole === "angle" && problem.imageIndex !== null && problem.imageIndex !== undefined
            ? `第 ${Number(problem.imageIndex) + 1} 张`
            : "";
        return [
          `${handoffIndex}. 同商品 ${problemIndex + 1}/${problems.length}`,
          `问题标识：${skuImageProblemTrackingId(problem)}`,
          `位置：${skuImageRoleLabel(problem)}${imageIndex ? `（${imageIndex}）` : ""}`,
          `字段：${skuFieldLabel(problem.field)}`,
          `处理方式：${skuImageProblemActionGroupLabel(problem)}`,
          `修复入口：${skuImageProblemRepairEntry(problem)}`,
          `路径状态：${skuImagePathStateLabel(problem.path)}`,
          `问题：${problem.message || problem.code}`,
          `建议：${skuImageProblemAction(problem)}`,
          `同商品问题数：${productProblemCount}`,
          `原始路径：${problem.path || "未填写"}`,
        ].join("\n");
        }),
      ];
    });
    const lines = [
      `商品图片补图交接清单：当前 ${handoffProblems.length} 个图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品。`,
      `处理方式统计：${visibleSkuImageProblemActionSummary}。`,
      `分组涉及商品：${visibleSkuImageProblemActionProductSummary}。`,
      `下一步：${visibleSkuImageProblemNextStepSummary}。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      `处理口径：优先补真实商品图；确认不再使用的失效路径，再回到商品编辑里移除并保存。`,
      ...groupedLines,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已复制 ${handoffProblems.length} 个图片问题的补图交接清单。`);
    } catch {
      setMessage("复制失败，请导出清单后交给运营处理。");
    }
  }

  async function copySkuImageProblemActionHandoff() {
    const handoffProblems = visibleSkuImageProblems;
    if (!handoffProblems.length) {
      setMessage("当前没有图片问题可分派。");
      return;
    }
    const actionGroups = new Map<string, SkuImageProblem[]>();
    for (const label of ["补主图", "补多角度图", "核对失效路径"]) {
      actionGroups.set(label, []);
    }
    for (const problem of handoffProblems) {
      const label = skuImageProblemActionGroupLabel(problem);
      actionGroups.set(label, [...(actionGroups.get(label) || []), problem]);
    }
    const groupedLines = Array.from(actionGroups.entries())
      .filter(([, problems]) => problems.length)
      .flatMap(([label, problems], groupIndex) => [
        `分派 ${groupIndex + 1}：${label}（${problems.length} 个图片问题）`,
        ...problems.map((problem, problemIndex) => {
          const imageIndex =
            problem.imageRole === "angle" && problem.imageIndex !== null && problem.imageIndex !== undefined
              ? `第 ${Number(problem.imageIndex) + 1} 张`
              : "";
          return [
            `${problemIndex + 1}. ${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}`,
            `问题标识：${skuImageProblemTrackingId(problem)}`,
            `位置：${skuImageRoleLabel(problem)}${imageIndex ? `（${imageIndex}）` : ""}`,
            `字段：${skuFieldLabel(problem.field)}`,
            `修复入口：${skuImageProblemRepairEntry(problem)}`,
            `路径状态：${skuImagePathStateLabel(problem.path)}`,
            `问题：${problem.message || problem.code}`,
            `建议：${skuImageProblemAction(problem)}`,
            `原始路径：${problem.path || "未填写"}`,
          ].join("\n");
        }),
      ]);
    const lines = [
      `商品图片按处理方式分派：当前 ${handoffProblems.length} 个图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品。`,
      `处理方式统计：${visibleSkuImageProblemActionSummary}。`,
      `分组涉及商品：${visibleSkuImageProblemActionProductSummary}。`,
      `下一步：${visibleSkuImageProblemNextStepSummary}。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      `处理口径：补主图和补多角度图优先补真实商品图；核对失效路径时先确认文件是否还在，再决定重传或移除。`,
      ...groupedLines,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已按处理方式复制 ${handoffProblems.length} 个图片问题的分派清单。`);
    } catch {
      setMessage("复制失败，请导出清单后交给运营处理。");
    }
  }

  async function copyVisibleSkuImageProblemActionProducts(actionFilter: "upload_main" | "upload_angle", actionLabel: string) {
    const actionProblems = visibleSkuImageProblems.filter((problem) => skuImageProblemMatchesAction(problem, actionFilter));
    if (!actionProblems.length) {
      setMessage(`当前筛选下没有需要${actionLabel}的商品。`);
      return;
    }
    const products = new Map<string, SkuImageProblem[]>();
    for (const problem of actionProblems) {
      const key = problem.skuCode || problem.name || "未编号商品";
      products.set(key, [...(products.get(key) || []), problem]);
    }
    const lines = [
      `商品图片${actionLabel}商品清单：当前筛选 ${actionProblems.length} 个图片问题，涉及 ${products.size} 个商品。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      `下一步：${visibleSkuImageProblemNextStepSummary}。`,
      `处理口径：逐个商品补真实商品图；补完保存商品，再刷新商品审核确认问题减少。`,
      ...Array.from(products.entries()).map(([key, problems], index) => {
        const firstProblem = problems[0];
        const positions = problems
          .map((problem) => {
            const imageIndex =
              problem.imageRole === "angle" && problem.imageIndex !== null && problem.imageIndex !== undefined
                ? `第 ${Number(problem.imageIndex) + 1} 张`
                : "";
            return `${skuImageRoleLabel(problem)}${imageIndex ? `（${imageIndex}）` : ""}`;
          })
          .join("、");
        return [
          `${index + 1}. ${firstProblem?.skuCode || key}｜${firstProblem?.name || key}`,
          `问题数：${problems.length} 个`,
          `问题标识列表：${problems.map((problem) => skuImageProblemTrackingId(problem)).join("、")}`,
          `图片位置：${positions}`,
          `修复入口：${firstProblem ? skuImageProblemRepairEntry(firstProblem) : key}`,
          `建议：${firstProblem ? skuImageProblemAction(firstProblem) : actionLabel}`,
        ].join("\n");
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已复制 ${products.size} 个商品的${actionLabel}清单。`);
    } catch {
      setMessage(`复制${actionLabel}商品清单失败，请导出清单后处理。`);
    }
  }

  async function copySkuImageProblemProductHandoff(problem: SkuImageProblem) {
    const key = problem.skuCode || problem.name;
    if (!key) {
      setMessage("这个图片问题没有 SKU 或商品名，不能复制单商品交接。");
      return;
    }
    const productProblems = visibleSkuImageProblems.filter((item) => (item.skuCode || item.name) === key);
    if (!productProblems.length) {
      setMessage("当前筛选下没有这个商品的图片问题可复制。");
      return;
    }
    const lines = [
      `单商品补图交接：${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}（${productProblems.length} 个图片问题）`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      `下一步：${buildSkuImageProblemNextStepSummary(productProblems)}。`,
      `处理口径：优先补真实商品图；确认不再使用的失效路径，再回到商品编辑里移除并保存。`,
      ...productProblems.map((item, index) => {
        const imageIndex =
          item.imageRole === "angle" && item.imageIndex !== null && item.imageIndex !== undefined
            ? `第 ${Number(item.imageIndex) + 1} 张`
            : "";
        return [
          `${index + 1}. 同商品 ${index + 1}/${productProblems.length}`,
          `问题标识：${skuImageProblemTrackingId(item)}`,
          `位置：${skuImageRoleLabel(item)}${imageIndex ? `（${imageIndex}）` : ""}`,
          `字段：${skuFieldLabel(item.field)}`,
          `处理方式：${skuImageProblemActionGroupLabel(item)}`,
          `修复入口：${skuImageProblemRepairEntry(item)}`,
          `路径状态：${skuImagePathStateLabel(item.path)}`,
          `问题：${item.message || item.code}`,
          `建议：${skuImageProblemAction(item)}`,
          `原始路径：${item.path || "未填写"}`,
        ].join("\n");
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已复制 ${problem.skuCode || problem.name} 的 ${productProblems.length} 个图片问题。`);
    } catch {
      setMessage("复制失败，请导出清单后交给运营处理。");
    }
  }

  async function copySkuImageProblemPath(problem: SkuImageProblem) {
    if (!problem.path) {
      setMessage("这个图片问题没有可复制的原始路径。");
      return;
    }
    try {
      await navigator.clipboard.writeText(
        [
          `问题标识：${skuImageProblemTrackingId(problem)}`,
          `商品：${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}｜${skuImageRoleLabel(problem)}`,
          `路径：${problem.path}`,
        ].join("\n"),
      );
      setMessage(`已复制 ${problem.skuCode || problem.name || "当前商品"} 的${skuImageRoleLabel(problem)}路径核对信息。`);
    } catch {
      setMessage("复制路径失败，请手动选中路径复制。");
    }
  }

  async function copyVisibleSkuImageProblemPaths() {
    const problemsWithPath = visibleSkuImageProblems.filter((problem) => Boolean(problem.path));
    if (!problemsWithPath.length) {
      setMessage("当前筛选下没有可复制的图片路径。");
      return;
    }
    const lines = [
      `商品图片路径核对清单：当前筛选 ${problemsWithPath.length} 个有路径图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      "回填格式：结果=可用/需重传/已移除；新路径=本地真实图片路径；备注=处理说明。",
      ...problemsWithPath.map((problem, index) =>
        [
          `${index + 1}. ${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}`,
          `问题标识：${skuImageProblemTrackingId(problem)}`,
          `位置：${skuImageRoleLabel(problem)}`,
          `处理方式：${skuImageProblemActionGroupLabel(problem)}`,
          `修复入口：${skuImageProblemRepairEntry(problem)}`,
          `路径：${problem.path}`,
          "回填：结果=；新路径=；备注=",
        ].join("\n"),
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已复制 ${problemsWithPath.length} 条图片路径，供核对失效文件或批量补图。`);
    } catch {
      setMessage("复制路径清单失败，请导出清单后处理。");
    }
  }

  async function copyVisibleSkuImageProblemMissingPaths() {
    const problemsMissingPath = visibleSkuImageProblems.filter((problem) => !problem.path);
    if (!problemsMissingPath.length) {
      setMessage("当前筛选下没有未填路径的图片问题。");
      return;
    }
    const lines = [
      `商品图片补路径清单：当前筛选 ${problemsMissingPath.length} 个未填路径图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      `处理口径：先补真实商品图路径；主图优先，其次补多角度图。`,
      "回填格式：新路径=本地真实图片路径；来源=拍摄/供应商/设计平台；备注=处理说明。",
      ...problemsMissingPath.map((problem, index) =>
        [
          `${index + 1}. ${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}`,
          `问题标识：${skuImageProblemTrackingId(problem)}`,
          `位置：${skuImageRoleLabel(problem)}`,
          `字段：${skuFieldLabel(problem.field)}`,
          `处理方式：${skuImageProblemActionGroupLabel(problem)}`,
          `修复入口：${skuImageProblemRepairEntry(problem)}`,
          `建议：${skuImageProblemAction(problem)}`,
          "回填：新路径=；来源=；备注=",
        ].join("\n"),
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已复制 ${problemsMissingPath.length} 条未填路径补图任务。`);
    } catch {
      setMessage("复制补路径清单失败，请导出清单后处理。");
    }
  }

  async function copyVisibleSkuImageProblemInvalidPaths() {
    const invalidPathProblems = visibleSkuImageProblems.filter(
      (problem) => Boolean(problem.path) && skuImageProblemMatchesAction(problem, "review_invalid"),
    );
    if (!invalidPathProblems.length) {
      setMessage("当前筛选下没有需要核对的失效图片路径。");
      return;
    }
    const lines = [
      `商品图片失效路径核对清单：当前筛选 ${invalidPathProblems.length} 个失效路径图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      "处理口径：先确认文件是否存在；文件存在但不可读就重传真实图；文件不存在就移除旧路径并补新图。",
      "回填格式：结果=文件存在/已重传/已移除并补新图；新路径=本地真实图片路径；备注=处理说明。",
      ...invalidPathProblems.map((problem, index) =>
        [
          `${index + 1}. ${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}`,
          `问题标识：${skuImageProblemTrackingId(problem)}`,
          `位置：${skuImageRoleLabel(problem)}`,
          `字段：${skuFieldLabel(problem.field)}`,
          `修复入口：${skuImageProblemRepairEntry(problem)}`,
          `失效路径：${problem.path}`,
          `建议：${skuImageProblemAction(problem)}`,
          "回填：结果=；新路径=；备注=",
        ].join("\n"),
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setMessage(`已复制 ${invalidPathProblems.length} 条失效图片路径核对任务。`);
    } catch {
      setMessage("复制失效路径清单失败，请导出清单后处理。");
    }
  }

  async function copySkuImageProblemReviewChecklist() {
    if (!visibleSkuImageProblems.length) {
      setMessage("当前没有图片问题可生成复核清单。");
      return;
    }
    const lines = [
      `商品图片修复复核清单：当前筛选 ${visibleSkuImageProblems.length} 个图片问题，涉及 ${visibleSkuImageProblemProductCount} 个商品。`,
      `当前筛选：${visibleSkuImageProblemFilterSummary}。`,
      `处理方式统计：${visibleSkuImageProblemActionSummary}。`,
      `分组涉及商品：${visibleSkuImageProblemActionProductSummary}。`,
      `下一步：${visibleSkuImageProblemNextStepSummary}。`,
      `问题标识列表：${visibleSkuImageProblems.map((problem) => skuImageProblemTrackingId(problem)).join("、")}。`,
      `路径状态：有路径 ${visibleSkuImageProblemPathCount} 个，失效路径 ${visibleSkuImageProblemInvalidPathCount} 个，未填路径 ${visibleSkuImageProblemMissingPathCount} 个。`,
      `审核刷新口径：${skuImageProblemAuditRefreshContext}。`,
      "复核步骤：",
      "1. 在商品编辑里补真实商品图或移除确认不用的失效路径。",
      "2. 点击“保存商品”，确认保存提示里没有阻塞项。",
      "3. 点击“刷新商品审核”，确认图片问题数量减少或归零。",
      "4. 如果仍有图片问题，按当前清单继续处理剩余商品。",
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage(`已复制 ${visibleSkuImageProblems.length} 个图片问题的修复复核清单。`);
    } catch {
      setMessage("复制复核清单失败，请导出清单后处理。");
    }
  }

  async function copySkuImageProblemRepairEntry(problem: SkuImageProblem) {
    const lines = [
      `商品：${problem.skuCode || "未编号"}｜${problem.name || "未命名商品"}`,
      `问题标识：${skuImageProblemTrackingId(problem)}`,
      `位置：${skuImageRoleLabel(problem)}`,
      `字段：${skuFieldLabel(problem.field)}`,
      `处理方式：${skuImageProblemActionGroupLabel(problem)}`,
      `修复入口：${skuImageProblemRepairEntry(problem)}`,
      `路径状态：${skuImagePathStateLabel(problem.path)}`,
      `原始路径：${problem.path || "未填写"}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage(`已复制 ${problem.skuCode || problem.name || "当前商品"} 的图片修复入口。`);
    } catch {
      setMessage("复制修复入口失败，请使用复制此商品或导出清单。");
    }
  }

  async function copySkuImageProblemTrackingId(problem: SkuImageProblem) {
    try {
      await navigator.clipboard.writeText(skuImageProblemTrackingId(problem));
      setMessage(`已复制 ${problem.skuCode || problem.name || "当前商品"} 的图片问题标识。`);
    } catch {
      setMessage("复制图片问题标识失败，请使用复制此商品或导出清单。");
    }
  }

  function resetSkuImageProblemView() {
    setSkuImageProblemSeverityFilter("all");
    setSkuImageProblemPathFilter("all");
    setSkuImageProblemActionFilter("all");
    setSkuImageProblemProductScope("all");
    setSkuImageProblemSearch("");
    setSkuImageProblemSort("severity");
    setSkuImageProblemVisibleLimit(SKU_IMAGE_PROBLEM_PAGE_SIZE);
    setMessage("已重置图片问题清单：显示全部图片问题，并按严重程度排序。");
  }

  function prioritizeSkuImageProblemProducts() {
    setSkuImageProblemSort("product_issue_count");
    setMessage("已按同商品图片问题数排序：优先处理同一商品多处缺图或失效路径。");
  }

  function prioritizeSkuImageMissingPaths() {
    setSkuImageProblemPathFilter("missing_path");
    setSkuImageProblemActionFilter("all");
    setSkuImageProblemProductScope("all");
    setSkuImageProblemSearch("");
    setSkuImageProblemSort("path_state");
    setSkuImageProblemVisibleLimit(SKU_IMAGE_PROBLEM_PAGE_SIZE);
    setMessage("已聚焦未填路径图片问题：先补真实商品图路径，再刷新商品审核。");
  }

  function prioritizeSkuImageInvalidPaths() {
    setSkuImageProblemPathFilter("has_path");
    setSkuImageProblemActionFilter("review_invalid");
    setSkuImageProblemProductScope("all");
    setSkuImageProblemSearch("");
    setSkuImageProblemSort("path_state");
    setSkuImageProblemVisibleLimit(SKU_IMAGE_PROBLEM_PAGE_SIZE);
    setMessage("已聚焦失效路径图片问题：先核对文件是否还在，再决定重传真实图或移除路径。");
  }

  function toggleMultiSkuImageProblemProducts() {
    const nextScope = skuImageProblemProductScope === "multiple" ? "all" : "multiple";
    setSkuImageProblemProductScope(nextScope);
    if (nextScope === "multiple") {
      setSkuImageProblemSort("product_issue_count");
      setMessage("已只显示同一商品有多个图片问题的补图任务。");
    } else {
      setMessage("已恢复显示全部图片问题。");
    }
  }

  function showAllSkuImageProblems() {
    setSkuImageProblemProductScope("all");
    setMessage("已恢复显示全部图片问题。");
  }

  function showMoreSkuImageProblems() {
    const nextLimit = Math.min(visibleSkuImageProblems.length, skuImageProblemVisibleLimit + SKU_IMAGE_PROBLEM_PAGE_SIZE);
    setSkuImageProblemVisibleLimit(nextLimit);
    setMessage(`已显示前 ${nextLimit} 个图片问题，可继续在页面内逐条处理。`);
  }

  function expandAllSkuImageProblems() {
    setSkuImageProblemVisibleLimit(visibleSkuImageProblems.length);
    setMessage(`已展开当前筛选下的 ${visibleSkuImageProblems.length} 个图片问题。`);
  }

  function collapseSkuImageProblems() {
    setSkuImageProblemVisibleLimit(SKU_IMAGE_PROBLEM_PAGE_SIZE);
    setMessage("已收起图片问题清单，只显示前 5 个重点问题。");
  }

  function exportSkuChangeLogs() {
    const exportableSkuChangeLogs = visibleSkuChangeLogs;
    if (!exportableSkuChangeLogs.length) {
      setMessage("当前筛选下没有商品变更可导出。");
      return;
    }
    const rows = [
      ["变更时间", "SKU编号", "商品名称", "动作", "来源", "操作者", "影响类型", "影响说明", "建议下一步", "变更字段", "变更前", "变更后", "备注"],
      ...exportableSkuChangeLogs.flatMap((log) => {
        const impact = skuChangeImpactSummary(log);
        const fields = log.changedFields.length ? log.changedFields : [{ field: "-", before: "", after: "" }];
        return fields.map((field) => [
          formatDateTime(log.createdAt),
          log.skuCode || "",
          log.name || "",
          skuChangeActionLabel(log.action),
          log.source || "",
          log.operator || "system",
          impact.label,
          impact.detail,
          impact.nextAction,
          skuFieldLabel(field.field),
          formatSkuFieldValue(field.before),
          formatSkuFieldValue(field.after),
          log.reason || "",
        ]);
      }),
    ];
    const fileName = `sku-change-logs-${formatDateForFile(new Date())}.csv`;
    downloadTextFile(fileName, "text/csv;charset=utf-8", `\uFEFF${toCsv(rows)}`);
    setMessage(`已导出 ${exportableSkuChangeLogs.length} 条商品变更记录，可用于价格、库存、图片和规格调整复盘。`);
  }

  async function previewSkuImport() {
    if (!skuImportText.trim()) {
      setMessage("请先粘贴商品表格。");
      return;
    }
    let summary = "";
    await runAction(
      "预览商品导入",
      async () => {
        const result = await previewSkuImportText(skuImportText);
        setSkuImportPreview(result);
        setCatalogWorkbenchDetail("preview");
        const firstError = result.errors[0] ? ` 第 ${result.errors[0].line} 行：${result.errors[0].message}` : "";
        summary = `识别 ${result.importedCount} 个商品，跳过 ${result.skippedCount} 行。${skuImportMappingSummary(result)}${firstError}`;
      },
      () => setMessage(summary || "商品导入预览完成。"),
    );
  }

  async function previewSkuImportUpload(file?: File) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setMessage("商品文件不能超过 8MB。");
      return;
    }
    let summary = "";
    await runAction(
      "预览商品文件",
      async () => {
        const dataUrl = await readFileAsDataUrl(file);
        const dataBase64 = dataUrl.split(",")[1] || "";
        const result = await previewSkuImportFile(file.name, dataBase64);
        setSkuImportPreview(result);
        setCatalogWorkbenchDetail("preview");
        const firstError = result.errors[0] ? ` 第 ${result.errors[0].line} 行：${result.errors[0].message}` : "";
        summary = `文件 ${file.name} 识别 ${result.importedCount} 个商品，跳过 ${result.skippedCount} 行。${skuImportMappingSummary(result)}${firstError}`;
      },
      () => setMessage(summary || "商品文件预览完成。"),
    );
  }

  async function confirmImportSkus() {
    const rows = skuImportPreview?.rows || [];
    if (!rows.length) {
      setMessage("请先预览并确认有可导入的商品。");
      return;
    }
    if ((skuImportReadinessSummary?.blocked || 0) > 0) {
      setMessage(`这批商品还有 ${skuImportReadinessSummary?.blocked || 0} 个阻塞项，先修正图片、价格、库存、规格或交期后再入库。`);
      return;
    }

    let summary = "";
    await runAction(
      "确认商品入库",
      async () => {
        const result = await bulkUpsertSkus(rows);
        summary = `已入库 ${result.count} 个商品。`;
      },
      () => {
        setSkuImportPreview(null);
        setCatalogWorkbenchDetail("audit");
        setMessage(summary || "商品已确认入库。");
      },
    );
  }

  function exportSkuImportBlockedRows() {
    const rows = skuImportPreview?.rows || [];
    if (!rows.length) {
      setMessage("请先预览商品表格，再导出阻塞清单。");
      return;
    }
    const blockedRows = rows
      .map((row, index) => {
        const issues = skuImportIssuesForRow(row, skuImportPreview?.audit?.issues || []);
        const readiness = skuImportRowReadiness(row, issues);
        return { row, index, issues, readiness };
      })
      .filter((item) => item.readiness.tone === "blocked");
    if (!blockedRows.length) {
      setMessage("这批商品没有阻塞项，可以确认入库或继续复核提醒项。");
      return;
    }
    const csvRows = [
      ["预览行", "SKU编号", "商品名称", "类型", "分类", "阻塞判断", "阻塞原因", "体检问题", "成本价", "售价", "库存", "主图", "尺寸", "重量g", "供应商", "交期天数", "场景标签"],
      ...blockedRows.map(({ row, index, issues, readiness }) => [
        String(index + 1),
        row.skuCode || "",
        row.name || "",
        row.type || "",
        row.category || "",
        readiness.label,
        readiness.detail,
        issues.map((issue) => `${skuSeverityLabel(issue.severity)}:${issue.message}`).join("；"),
        String(row.costPrice ?? ""),
        String(row.salePrice ?? ""),
        String(row.stock ?? ""),
        row.mainImagePath || "",
        dimensionsToText(row.dimensions),
        String(row.weightGram ?? ""),
        row.supplier || "",
        String(row.leadTimeDays ?? ""),
        (row.sceneTags || []).join("、"),
      ]),
    ];
    const fileName = `sku-import-blocked-${formatDateForFile(new Date())}.csv`;
    downloadTextFile(fileName, "text/csv;charset=utf-8", `\uFEFF${toCsv(csvRows)}`);
    setMessage(`已导出 ${blockedRows.length} 个导入阻塞商品，请修正后重新预览。`);
  }

  function editSku(sku: Sku) {
    setSkuForm(skuToForm(sku));
    setSkuWorkbenchView("editor");
    setMessage(`正在编辑商品 ${sku.skuCode}`);
  }

  function handleSkuChangeImpact(log: SkuChangeLog, impact: ReturnType<typeof skuChangeImpactSummary>) {
    const sku = skus.find((row) => row.skuCode === log.skuCode);
    if (!sku) {
      setSkuSearch(log.skuCode);
      setSkuWorkbenchView("catalog");
      setMessage(`没有在当前商品列表找到 ${log.skuCode}，已按 SKU 编号搜索。`);
      return;
    }
    setSkuSearch(sku.skuCode);
    setSelectedSkuCodes([sku.skuCode]);
    if (impact.repairFilter) {
      setSkuWorkbenchView("repair");
      setSkuRepairFilter(impact.repairFilter);
      setSkuIssueFilter(impact.repairFilter === "image" ? "missing_image" : "problem");
      scrollToWorkspaceSection("sku-library");
      setMessage(`正在处理 ${sku.skuCode}：${impact.nextAction}`);
      return;
    }
    editSku(sku);
    scrollToWorkspaceSection("sku-library");
    setMessage(`正在查看 ${sku.skuCode}：${impact.nextAction}`);
  }

  function focusSkuFormField(field: string, label?: string) {
    if (typeof document === "undefined") return;
    const element = document.getElementById(skuFormFieldTargetId(field));
    if (!element) {
      setMessage(`没有找到字段 ${label || skuFieldLabel(field)} 的输入位置。`);
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus();
        element.select();
      } else if (element instanceof HTMLSelectElement) {
        element.focus();
      } else {
        const focusable = element.querySelector<HTMLElement>("input, textarea, select, button");
        focusable?.focus();
      }
    }, 180);
    setMessage(`已定位到 ${label || skuFieldLabel(field)}，补齐后点击保存商品。`);
  }

  function openSkuFromRow(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>, sku: Sku) {
    if (isNestedControlTarget(event.target)) return;
    setSelectedSkuCodes([sku.skuCode]);
    editSku(sku);
    setMessage(`已选中 ${sku.skuCode}，已切到新增商品视图编辑资料。`);
  }

  function handleSkuRowKeyDown(event: KeyboardEvent<HTMLDivElement>, sku: Sku) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.key === " ") {
      toggleSkuSelection(sku.skuCode);
      return;
    }
    openSkuFromRow(event, sku);
  }

  function repairSku(item: SkuRepairQueueItem) {
    const sku = skus.find((row) => row.skuCode === item.skuCode || row.name === item.name);
    if (!sku) {
      setMessage(`没有找到待补齐商品：${item.skuCode || item.name}`);
      return;
    }
    editSku(sku);
    setSkuSearch(sku.skuCode);
    setSkuIssueFilter(item.severity === "info" ? "all" : "problem");
    setSelectedSkuCodes([sku.skuCode]);
    scrollToWorkspaceSection("sku-library");
    setMessage(`正在补齐 ${sku.skuCode}：${item.recommendedAction}`);
  }

  function editSkuImageProblem(problem: SkuImageProblem) {
    const sku = skus.find((row) => row.skuCode === problem.skuCode || row.name === problem.name);
    if (!sku) {
      setMessage(`没有找到图片问题商品：${problem.skuCode || problem.name}`);
      return;
    }
    editSku(sku);
    setSkuSearch(sku.skuCode);
    setSkuIssueFilter("missing_image");
    setSelectedSkuCodes([sku.skuCode]);
    scrollToWorkspaceSection("sku-library");
    window.setTimeout(() => {
      focusSkuFormField(problem.imageRole === "main" ? "mainImagePath" : "angleImages", skuImageRoleLabel(problem));
    }, 220);
    setMessage(`正在处理 ${sku.skuCode} 的${skuImageRoleLabel(problem)}：${problem.message}`);
  }

  function focusSkuImageProblemProduct(problem: SkuImageProblem) {
    const keyword = problem.skuCode || problem.name;
    if (!keyword) {
      setMessage("这个图片问题没有 SKU 或商品名，不能按商品聚焦。");
      return;
    }
    setSkuImageProblemSearch(keyword);
    setSkuImageProblemSeverityFilter("all");
    setSkuImageProblemPathFilter("all");
    setSkuImageProblemActionFilter("all");
    setSkuImageProblemProductScope("all");
    setSkuImageProblemSort("image_role");
    setMessage(`已聚焦 ${keyword} 的全部图片问题，并按图片位置排序。`);
  }

  function stageSkuImageProblemFix(problem: SkuImageProblem) {
    const sku = skus.find((row) => row.skuCode === problem.skuCode || row.name === problem.name);
    if (!sku) {
      setMessage(`没有找到图片问题商品：${problem.skuCode || problem.name}`);
      return;
    }
    if (!problem.path) {
      setMessage(`这个${skuImageRoleLabel(problem)}问题没有旧路径可移除，请点“编辑图片”补真实图片。`);
      return;
    }
    const angleImages = splitTextList(skuToForm(sku).angleImages);
    const targetImageIndex = problem.imageIndex === null || problem.imageIndex === undefined ? -1 : Number(problem.imageIndex);
    const targetPath =
      problem.path ||
      (problem.imageRole === "main"
        ? sku.mainImagePath || ""
        : targetImageIndex >= 0
          ? angleImages[targetImageIndex] || ""
          : "");
    const confirmed = window.confirm(
      `确认从 ${sku.skuCode} 移除${skuImageRoleLabel(problem)}路径吗？\n\n原路径：${targetPath || "未填写"}\n\n这一步只会先改到商品表单里，确认无误后还需要点击“保存商品”才会生效。`,
    );
    if (!confirmed) {
      setMessage(`已取消移除 ${sku.skuCode} 的${skuImageRoleLabel(problem)}路径。`);
      return;
    }
    const form = skuToForm(sku);
    if (problem.imageRole === "main") {
      form.mainImagePath = "";
    } else {
      const nextImages = angleImages.filter((imagePath, imageIndex) => {
        if (targetImageIndex >= 0) return imageIndex !== targetImageIndex;
        return imagePath !== problem.path;
      });
      form.angleImages = nextImages.join("、");
    }
    setSkuForm(form);
    setSkuWorkbenchView("editor");
    setSkuSearch(sku.skuCode);
    setSkuIssueFilter("missing_image");
    setSelectedSkuCodes([sku.skuCode]);
    scrollToWorkspaceSection("sku-library");
    window.setTimeout(() => {
      focusSkuFormField(problem.imageRole === "main" ? "mainImagePath" : "angleImages", skuImageRoleLabel(problem));
    }, 220);
    setMessage(`已在表单中移除 ${sku.skuCode} 的${skuImageRoleLabel(problem)}旧路径：${targetPath || "未填写"}。确认无误后点击“保存商品”生效。`);
  }

  async function copySkuFormImageChangeSummary() {
    const text = buildSkuFormImageChangeCopyText(skuForm, activeSkuOriginal);
    if (!text) {
      setMessage("当前商品没有待保存的图片变更可复制。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`已复制 ${skuForm.skuCode || "当前商品"} 的待保存图片变更。`);
    } catch {
      setMessage("复制图片变更失败，请手动核对当前商品表单。");
    }
  }

  function resetSkuForm() {
    setSkuForm(emptySkuForm);
    setSkuWorkbenchView("editor");
  }

  async function saveSkuForm() {
    const payload = buildSkuPayload(skuForm);
    const existingSku = skus.find((sku) => sku.skuCode === payload.skuCode);
    if (existingSku?.isActive === false) payload.isActive = false;
    if (!payload.skuCode || !payload.name) {
      setMessage("请填写 SKU 编号和商品名称。");
      return;
    }
    if (!payload.salePrice || payload.salePrice <= 0) {
      setMessage("请填写大于 0 的售价。");
      return;
    }
    const imageErrors = validateSkuFormImages(skuForm).filter((warning) => warning.severity === "error");
    if (imageErrors.length) {
      setMessage(`图片资料还不能保存：${imageErrors[0].message}`);
      return;
    }
    const readinessWarnings = validateSkuFormReadiness(skuForm);
    const blockingWarnings = readinessWarnings.filter((warning) => warning.severity === "error");
    if (blockingWarnings.length) {
      setMessage(`商品还不能保存：${blockingWarnings[0].message}`);
      return;
    }
    const referenceWarnings = validateSkuFormReferences(skuForm, knownSkuCodeSet);
    if (referenceWarnings.length) {
      setMessage(`SKU 引用还不能保存：${referenceWarnings[0].message}`);
      return;
    }
    const reviewWarnings = readinessWarnings.filter((warning) => warning.severity === "warning");
    if (reviewWarnings.length) {
      const confirmed = window.confirm(
        `这个商品保存后需要人工复核：${reviewWarnings.slice(0, 3).map((warning) => warning.message).join("；")}。确认先保存吗？`,
      );
      if (!confirmed) {
        setMessage("已取消保存，请先补齐会影响自动搭配、报价或采购追踪的资料。");
        return;
      }
    }
    const automationStatus = skuFormAutomationPreview(skuForm, readinessWarnings);
    const imageRepairSaveTrace = skuImageProblemSaveTraceSummary(skuImageProblems, payload.skuCode, payload.name);
    const saveOutcomeMessage = [skuSavedOutcomeMessage(payload.skuCode, automationStatus, readinessWarnings), imageRepairSaveTrace]
      .filter(Boolean)
      .join(" ");

    await runAction(
      "保存商品",
      () => upsertSku(payload),
      () => {
        setMessage(saveOutcomeMessage);
        setSkuForm(emptySkuForm);
        setSkuWorkbenchView("catalog");
      },
    );
  }

  async function uploadSkuImage(file: File | undefined, role: "main" | "angle") {
    if (!file) return;
    const skuCode = skuForm.skuCode.trim();
    if (!skuCode) {
      setMessage("请先填写 SKU 编号，再上传商品图片。");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setMessage("请上传 PNG、JPG、WEBP 等图片文件。");
      return;
    }

    let uploadedPath = "";
    await runAction(
      role === "main" ? "上传 SKU 主图" : "上传 SKU 多角度图",
      async () => {
        const base64 = await readFileAsDataUrl(file);
        const asset = await uploadAsset({
          ownerType: "sku",
          ownerId: skuCode,
          role: role === "main" ? "sku_main_image" : "sku_angle_image",
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          source: "sku_upload",
          base64,
        });
        uploadedPath = asset.localPath;
      },
      () => {
        setSkuForm((current) => {
          if (role === "main") return { ...current, mainImagePath: uploadedPath };
          const existing = splitTextList(current.angleImages);
          return { ...current, angleImages: [...existing, uploadedPath].join("、") };
        });
        setMessage(`图片已上传并写入 ${skuCode}。保存商品后生效。`);
      },
    );
  }

  function toggleSkuSelection(skuCode: string) {
    setSelectedSkuCodes((current) =>
      current.includes(skuCode) ? current.filter((item) => item !== skuCode) : [...current, skuCode],
    );
  }

  function selectVisibleSkus() {
    setSelectedSkuCodes((current) => [...new Set([...current, ...visibleSkus.map((sku) => sku.skuCode)])]);
  }

  async function toggleInactiveSkus(next: boolean) {
    setIncludeInactiveSkus(next);
    setBusy("刷新商品");
    try {
      const skuRows = await getSkus(next);
      setSkus(skuRows);
      setSelectedSkuCodes((current) => current.filter((skuCode) => skuRows.some((sku) => sku.skuCode === skuCode)));
      setMessage(next ? "已显示下架商品。" : "已隐藏下架商品。");
    } catch (error) {
      setMessage(`刷新商品失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  async function updateSkuActive(sku: Sku, isActive: boolean) {
    await runAction(
      isActive ? "恢复商品" : "下架商品",
      () => (isActive ? restoreSku(sku.skuCode) : deactivateSku(sku.skuCode)),
      () => {
        setSelectedSkuCodes((current) => current.filter((skuCode) => skuCode !== sku.skuCode));
        setMessage(`商品 ${sku.skuCode} 已${isActive ? "恢复" : "下架"}。`);
      },
    );
  }

  async function batchUpdateSelectedSkus() {
    if (!selectedSkuCodes.length) {
      setMessage("请先选择要批量修改的 SKU。");
      return;
    }
    const patch: Record<string, unknown> = {};
    if (skuBatchStock.trim()) patch.stock = parseInteger(skuBatchStock);
    if (skuBatchSalePrice.trim()) patch.salePrice = parseMoney(skuBatchSalePrice);
    if (skuBatchSupplier.trim()) patch.supplier = skuBatchSupplier.trim();
    if (!Object.keys(patch).length) {
      setMessage("请填写要批量修改的库存、售价或供应商。");
      return;
    }

    let summary = "";
    await runAction(
      "批量修改商品",
      async () => {
        const result = await batchUpdateSkus({ skuCodes: selectedSkuCodes, patch });
        summary = `已更新 ${result.count} 个 SKU，跳过 ${result.skipped.length} 个。`;
      },
      () => {
        setSkuBatchStock("");
        setSkuBatchSalePrice("");
        setSkuBatchSupplier("");
        setSelectedSkuCodes([]);
        setMessage(summary || "批量修改完成。");
      },
    );
  }

  async function batchSetSkuActive(isActive: boolean) {
    if (!selectedSkuCodes.length) {
      setMessage("请先选择要处理的 SKU。");
      return;
    }
    let summary = "";
    await runAction(
      isActive ? "批量恢复商品" : "批量下架商品",
      async () => {
        const result = await batchUpdateSkus({ skuCodes: selectedSkuCodes, patch: { isActive } });
        summary = `已${isActive ? "恢复" : "下架"} ${result.count} 个 SKU，跳过 ${result.skipped.length} 个。`;
      },
      () => {
        setSelectedSkuCodes([]);
        setMessage(summary || "批量状态修改完成。");
      },
    );
  }

  async function recommendGiftBundle() {
    await runAction("推荐礼盒组合", async () => {
      const result = await recommendBundle({
        scene: "员工福利",
        budget: { mode: "per_box", perUnitAmount: 180, quantity: 50, totalAmount: 9000 },
        maxItems: 6,
      });
      setBundleResult(result);
      setCatalogWorkbenchDetail("bundle");
    });
  }

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );

  useEffect(() => {
    let loadInFlight = false;
    const runStartupLoad = () => {
      if (loadInFlight) return;
      loadInFlight = true;
      load()
        .catch((error) => {
          setMessage(error instanceof Error ? `数据服务暂不可用：${error.message}` : "数据服务暂不可用。");
        })
        .finally(() => {
          loadInFlight = false;
        });
      loadWechatChannelStatusOnly(null).catch(() => {
        // Keep the WeChat center usable even when unrelated startup data is unavailable.
      });
    };
    runStartupLoad();
    getSkuImportFields().then(setSkuImportFields).catch(() => setSkuImportFields([]));
    const timers = [1800, 4200, 8500].map((delayMs) =>
      window.setTimeout(() => {
        runStartupLoad();
      }, delayMs),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshAutomationStatus = async () => {
      try {
        const [nextStatus, nextReadiness] = await Promise.all([getAutomationStatus(), getAutomationReadiness()]);
        if (!cancelled && nextStatus) setAutomationStatus(nextStatus);
        if (!cancelled && nextReadiness) setAutomationReadiness(nextReadiness);
      } catch {
        if (!cancelled) setAutomationReadiness(null);
      }
    };
    const timer = window.setInterval(refreshAutomationStatus, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const pollingJobs = jobs.filter(
      (job) => ["submitted", "generating"].includes(job.status) && Boolean(job.externalJobId),
    );
    if (!pollingJobs.length) {
      setDesignAutoRefreshSummary("");
      setDesignAutoRefreshAt("");
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const filters = activeConversation
      ? {
          wechatAccountId: activeConversation.wechatAccountId,
          conversationId: activeConversation.id,
          customerId: activeConversation.customerId,
        }
      : {};

    const refreshDesignResults = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await pollActiveDesignResults(filters);
        if (cancelled) return;
        mergeDesignActivePollResult(result);
        setDesignAutoRefreshSummary(
          `自动刷新 ${result.scanned} 个出图任务：完成 ${result.completed.length}，重试 ${result.retried?.length || 0}，仍在生成 ${result.generating.length}，异常 ${result.failed.length + result.errors.length}`,
        );
        setDesignAutoRefreshAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      } catch (error) {
        if (!cancelled) {
          setDesignAutoRefreshSummary(error instanceof Error ? `自动刷新失败：${error.message}` : "自动刷新失败");
          setDesignAutoRefreshAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
        }
      } finally {
        inFlight = false;
      }
    };

    const firstTimer = window.setTimeout(refreshDesignResults, 1800);
    const interval = window.setInterval(refreshDesignResults, 5500);
    return () => {
      cancelled = true;
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, [jobs, activeConversation?.wechatAccountId, activeConversation?.id, activeConversation?.customerId]);

  useEffect(() => {
    let cancelled = false;
    const customerId = activeConversation?.customerId || "";
    if (!customerId) {
      setDesignAssets([]);
      setSelectedAssetIds([]);
      return;
    }
    getAssets("customer", customerId, {
      wechatAccountId: activeConversation?.wechatAccountId || "",
      conversationId: activeConversation?.id || "",
      customerId,
    })
      .then((assetRows) => {
        if (cancelled) return;
        setDesignAssets(assetRows);
        setSelectedAssetIds((current) => current.filter((assetId) => assetRows.some((asset) => asset.id === assetId)));
      })
      .catch(() => {
        if (cancelled) return;
        setDesignAssets([]);
        setSelectedAssetIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.customerId, activeConversation?.id, activeConversation?.wechatAccountId]);

  useEffect(() => {
    // App-deck mode uses explicit navigation instead of scrollspy.
  }, []);

  useEffect(() => {
    const sampleIds = new Set(trainingSamples.map((sample) => sample.id));
    setSelectedTrainingSampleIds((current) => {
      const next = current.filter((sampleId) => sampleIds.has(sampleId));
      return next.length === current.length ? current : next;
    });
  }, [trainingSamples]);

  useEffect(() => {
    const activeRailButton = document.querySelector<HTMLButtonElement>(
      `.rail button[data-section-id="${activeWorkspaceSection}"]`
    );
    const rail = activeRailButton?.closest<HTMLElement>(".rail");
    if (!activeRailButton || !rail) return;
    const centerActiveRailButton = () => {
      if (window.matchMedia("(max-width: 760px)").matches) {
        rail.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }

      const isHorizontalRail = rail.scrollWidth > rail.clientWidth && rail.clientWidth >= rail.clientHeight;

      if (isHorizontalRail) {
        const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
        const targetLeft =
          activeRailButton.offsetLeft - (rail.clientWidth - activeRailButton.clientWidth) / 2;
        rail.scrollTo({
          top: 0,
          left: Math.min(maxLeft, Math.max(0, targetLeft)),
          behavior: "auto",
        });
        return;
      }

      rail.scrollTo({
        top: activeRailButton.offsetTop - (rail.clientHeight - activeRailButton.clientHeight) / 2,
        left: activeRailButton.offsetLeft - (rail.clientWidth - activeRailButton.clientWidth) / 2,
        behavior: "auto",
      });
    };
    centerActiveRailButton();
    const frame = window.requestAnimationFrame(centerActiveRailButton);
    const timers = [80, 260, 620].map((delay) => window.setTimeout(centerActiveRailButton, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activeWorkspaceSection]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const browserWindow = window as Window & typeof globalThis;
    const getHashSectionId = () => {
      const rawHash = decodeURIComponent(browserWindow.location.hash.replace(/^#/, ""));
      const [sectionId, detailView] = rawHash.split(":");
      if (
        sectionId === "notice-center" &&
        (detailView === "automation" || detailView === "issues" || detailView === "history")
      ) {
        setNoticeWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "sku-library" &&
        (detailView === "catalog" || detailView === "repair" || detailView === "editor")
      ) {
        setSkuWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "catalog-center" &&
        (detailView === "import" || detailView === "preview" || detailView === "audit" || detailView === "bundle")
      ) {
        setCatalogWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "wechat-channel-center" &&
        (detailView === "channels" || detailView === "flow" || detailView === "config")
      ) {
        setWechatWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "training-center" &&
        (detailView === "import" || detailView === "review" || detailView === "skills")
      ) {
        setTrainingWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "send-center" &&
        (detailView === "queue" || detailView === "blocked" || detailView === "diagnostics")
      ) {
        setSendWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "review-center" &&
        (detailView === "handoff" || detailView === "design" || detailView === "quote" || detailView === "order" || detailView === "logs")
      ) {
        setReviewWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "quote-center" &&
        (detailView === "overview" || detailView === "actions" || detailView === "quotes" || detailView === "orders")
      ) {
        setQuoteWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      return workspaceSectionIds.has(sectionId) ? sectionId : null;
    };
    const scrollToHashSection = (behavior: ScrollBehavior = "auto") => {
      const sectionId = getHashSectionId();
      if (!sectionId) return;
      scrollToWorkspaceSection(sectionId, { behavior, syncHash: false });
    };
    let resizeFrame: number | undefined;
    let resizeObserver: ResizeObserver | null = null;
    let resizeObserverStopTimer: number | undefined;
    const stopHashLayoutObserver = () => {
      if (resizeFrame) browserWindow.cancelAnimationFrame(resizeFrame);
      if (resizeObserverStopTimer) browserWindow.clearTimeout(resizeObserverStopTimer);
      resizeFrame = undefined;
      resizeObserverStopTimer = undefined;
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
    const observeHashLayoutUntilStable = () => {
      stopHashLayoutObserver();
      const ResizeObserverConstructor = browserWindow.ResizeObserver;
      if (!getHashSectionId() || !ResizeObserverConstructor || !document.body) return;
      resizeObserver = new ResizeObserverConstructor(() => {
        if (resizeFrame) browserWindow.cancelAnimationFrame(resizeFrame);
        resizeFrame = browserWindow.requestAnimationFrame(() => {
          resizeFrame = undefined;
          scrollToHashSection("auto");
        });
      });
      resizeObserver.observe(document.body);
      resizeObserverStopTimer = browserWindow.setTimeout(stopHashLayoutObserver, 8000);
    };
    const timers = [0, 80, 280, 700, 1300, 2200, 3600, 5200, 7600].map((delay) =>
      browserWindow.setTimeout(() => scrollToHashSection("auto"), delay),
    );
    observeHashLayoutUntilStable();
    const handleHashChange = () => {
      scrollToHashSection("smooth");
      observeHashLayoutUntilStable();
    };
    browserWindow.addEventListener("hashchange", handleHashChange);
    return () => {
      timers.forEach((timer) => browserWindow.clearTimeout(timer));
      stopHashLayoutObserver();
      browserWindow.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const activeJob = useMemo(() => jobs.find((job) => job.id === activeId) || jobs[0], [jobs, activeId]);
  const pendingCount = jobs.filter((job) => ["quick_confirm", "manual_review", "timeout", "failed"].includes(job.status)).length;
  const highValueCount = jobs.filter((job) => isHighValueDesignJob(job)).length;
  const stockWarning = skus.filter((sku) => Number(sku.stock) <= 10).length;
  const trainingSampleTotalCount = trainingOverview?.totalSamples ?? trainingSamples.length;
  const activeTrainingImport = trainingSampleImportFilterId
    ? chatImports.find((item) => item.id === trainingSampleImportFilterId) || null
    : null;
  const scopedTrainingOverview = trainingSampleImportFilterId ? null : trainingOverview;
  const trainingSampleQualityOptions = buildTrainingSampleQualityOptions({ overview: scopedTrainingOverview, samples: trainingSamples });
  const missingRequiredTrainingSamples = trainingSamples.filter((sample) => trainingSampleReadyBlockingReasons(sample).length);
  const filteredTrainingSampleTotal = trainingSampleQualityTotal(
    scopedTrainingOverview,
    trainingSampleQualityFilter,
    trainingSampleQualityFilter === "missing_required" ? missingRequiredTrainingSamples.length : trainingSamples.length,
  );
  const visibleTrainingSamples = trainingSampleQualityFilter === "missing_required" ? missingRequiredTrainingSamples : trainingSamples;
  const visibleTrainingSampleIds = useMemo(() => visibleTrainingSamples.map((sample) => sample.id), [visibleTrainingSamples]);
  const selectedTrainingSampleIdSet = useMemo(() => new Set(selectedTrainingSampleIds), [selectedTrainingSampleIds]);
  const selectedVisibleTrainingSamples = useMemo(
    () => visibleTrainingSamples.filter((sample) => selectedTrainingSampleIdSet.has(sample.id)),
    [visibleTrainingSamples, selectedTrainingSampleIdSet],
  );
  const selectedTrainingSamplesMissingRequired = selectedVisibleTrainingSamples.filter(
    (sample) => trainingSampleReadyBlockingReasons(sample).length,
  );
  const selectedMissingRequiredTrainingSampleCount = selectedTrainingSamplesMissingRequired.length;
  const selectedMissingRequiredTrainingSample = selectedTrainingSamplesMissingRequired[0] || null;
  const selectedNeedsAttentionTrainingSampleCount = selectedVisibleTrainingSamples.filter(isTrainingSampleNeedingManualReview).length;
  const selectedSceneUncertainTrainingSampleCount = selectedVisibleTrainingSamples.filter(isSceneUncertainTrainingSample).length;
  const selectedRiskTrainingSample =
    selectedMissingRequiredTrainingSample ||
    selectedVisibleTrainingSamples.find(isTrainingSampleNeedingManualReview) ||
    selectedVisibleTrainingSamples.find(isSceneUncertainTrainingSample) ||
    null;
  const visibleTrainingSamplesMissingRequired = visibleTrainingSamples.filter((sample) => trainingSampleReadyBlockingReasons(sample).length);
  const visibleMissingRequiredTrainingSampleCount = visibleTrainingSamplesMissingRequired.length;
  const visibleMissingRequiredTrainingSample = visibleTrainingSamplesMissingRequired[0] || null;
  const visibleNeedsAttentionTrainingSampleCount = visibleTrainingSamples.filter(isTrainingSampleNeedingManualReview).length;
  const visibleSceneUncertainTrainingSampleCount = visibleTrainingSamples.filter(isSceneUncertainTrainingSample).length;
  const visibleRiskTrainingSample =
    visibleMissingRequiredTrainingSample ||
    visibleTrainingSamples.find(isTrainingSampleNeedingManualReview) ||
    visibleTrainingSamples.find(isSceneUncertainTrainingSample) ||
    null;
  const hiddenTrainingSampleCount = Math.max(0, filteredTrainingSampleTotal - visibleTrainingSamples.length);
  const latestCorrectionSamples = latestTrainingCorrectionSamples.length
    ? latestTrainingCorrectionSamples
    : trainingSamples.filter((sample) => sample.sourceType === "route_correction" || sample.sourceRouteId).slice(0, 3);
  const topTrainingAgents = (trainingOverview?.byAgent || []).filter((agent) => agent.sampleCount > 0).slice(0, 4);
  const skillSuggestionAgentOptions = buildSkillSuggestionAgentOptions(skillSuggestions, agents);
  const agentFilteredSkillSuggestions =
    skillSuggestionAgentFilter === "all"
      ? skillSuggestions
      : skillSuggestions.filter((suggestion) => skillSuggestionAgentFilterKey(suggestion) === skillSuggestionAgentFilter);
  const agentFilteredSafeSkillSuggestionCount = agentFilteredSkillSuggestions.filter(isSkillSuggestionAutoSelected).length;
  const agentFilteredBlockedSkillSuggestionCount = agentFilteredSkillSuggestions.filter(isSkillSuggestionBlocked).length;
  const agentFilteredNeedsReviewSkillSuggestionCount = agentFilteredSkillSuggestions.filter(
    (suggestion) => !isSkillSuggestionAutoSelected(suggestion) && !isSkillSuggestionBlocked(suggestion),
  ).length;
  const filteredSkillSuggestions = agentFilteredSkillSuggestions.filter((suggestion) => {
    if (skillSuggestionSafetyFilter === "safe") return isSkillSuggestionAutoSelected(suggestion);
    if (skillSuggestionSafetyFilter === "review") return !isSkillSuggestionAutoSelected(suggestion) && !isSkillSuggestionBlocked(suggestion);
    if (skillSuggestionSafetyFilter === "blocked") return isSkillSuggestionBlocked(suggestion);
    return true;
  });
  const visibleSkillSuggestions = filteredSkillSuggestions.slice(0, 12);
  const skillSuggestionEmptyTitle = agentFilteredSkillSuggestions.length ? "当前可信度筛选下没有建议" : "还没有 Skill 建议";
  const skillSuggestionEmptyMessage = agentFilteredSkillSuggestions.length
    ? "可以切回“全部建议”，或换一个 Agent 查看其它 Skill 候选。"
    : "先导入聊天记录，再确认高质量样本，系统会生成可进化的 Skill。";
  const selectedSkillSuggestionKeySet = new Set(selectedSkillSuggestionKeys);
  const selectedSkillSuggestions = skillSuggestions.filter((suggestion) => selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)));
  const selectedSkillSuggestionCount = selectedSkillSuggestions.length;
  const selectedSafeSkillSuggestionCount = selectedSkillSuggestions.filter(isSkillSuggestionAutoSelected).length;
  const selectedBlockedSkillSuggestionCount = selectedSkillSuggestions.filter(isSkillSuggestionBlocked).length;
  const selectedNeedsReviewSkillSuggestionCount = selectedSkillSuggestions.filter(
    (suggestion) => !isSkillSuggestionAutoSelected(suggestion) && !isSkillSuggestionBlocked(suggestion),
  ).length;
  const filteredSelectedSkillSuggestionCount = filteredSkillSuggestions.filter((suggestion) =>
    selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
  ).length;
  const filteredSafeSkillSuggestionCount = filteredSkillSuggestions.filter(isSkillSuggestionAutoSelected).length;
  const filteredUnselectedSafeSkillSuggestionCount = filteredSkillSuggestions.filter(
    (suggestion) => isSkillSuggestionAutoSelected(suggestion) && !selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
  ).length;
  const filteredUnselectedNeedsReviewSkillSuggestionCount = filteredSkillSuggestions.filter(
    (suggestion) =>
      !isSkillSuggestionAutoSelected(suggestion) &&
      !isSkillSuggestionBlocked(suggestion) &&
      !selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
  ).length;
  const filteredBlockedSkillSuggestionCount = filteredSkillSuggestions.filter(isSkillSuggestionBlocked).length;
  const filteredNeedsReviewSkillSuggestionCount = filteredSkillSuggestions.filter(
    (suggestion) => !isSkillSuggestionAutoSelected(suggestion) && !isSkillSuggestionBlocked(suggestion),
  ).length;
  const filteredSelectableSkillSuggestionCount = filteredSkillSuggestions.filter((suggestion) => !isSkillSuggestionBlocked(suggestion)).length;
  const filteredSelectedBlockedSkillSuggestionCount = filteredSkillSuggestions.filter(
    (suggestion) => isSkillSuggestionBlocked(suggestion) && selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
  ).length;
  const filteredUnselectedSkillSuggestionCount = Math.max(
    0,
    filteredSelectableSkillSuggestionCount - filteredSelectedSkillSuggestionCount + filteredSelectedBlockedSkillSuggestionCount,
  );
  const filteredSkillSuggestionKeySet = new Set(filteredSkillSuggestions.map(skillSuggestionKey));
  const hiddenSelectedSkillSuggestions = selectedSkillSuggestions.filter(
    (suggestion) => !filteredSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
  );
  const hiddenSelectedSkillSuggestionCount = hiddenSelectedSkillSuggestions.length;
  const hiddenBlockedSkillSuggestions = hiddenSelectedSkillSuggestions.filter(isSkillSuggestionBlocked);
  const hiddenBlockedSkillSuggestionCount = hiddenBlockedSkillSuggestions.length;
  const hiddenNeedsReviewSkillSuggestions = hiddenSelectedSkillSuggestions.filter(
    (suggestion) => !isSkillSuggestionAutoSelected(suggestion) && !isSkillSuggestionBlocked(suggestion),
  );
  const hiddenNeedsReviewSkillSuggestionCount = hiddenNeedsReviewSkillSuggestions.length;
  const trainingWorkbenchSummary =
    trainingWorkbenchView === "review"
      ? activeTrainingImport
        ? `${activeTrainingImport.name} · ${visibleTrainingSamples.length} 条样本，已选 ${selectedVisibleTrainingSamples.length} 条`
        : `${visibleTrainingSamples.length}/${filteredTrainingSampleTotal} 条样本，已选 ${selectedVisibleTrainingSamples.length} 条`
      : trainingWorkbenchView === "skills"
        ? `${filteredSkillSuggestions.length} 条候选，已选 ${selectedSkillSuggestionCount} 条`
        : `已导入 ${chatImports.length} 批，训练样本 ${trainingSampleTotalCount} 条`;
  const activeConversationSendTasks = activeConversationId
    ? sendTasks.filter((task) => task.conversationId === activeConversationId)
    : [];
  const activeConversationSendTaskCount = activeConversationSendTasks.length;
  const activeConversationDesignJobs = activeConversationId
    ? jobs.filter((job) => job.conversationId === activeConversationId)
    : [];
  const activeConversationDesignJobCount = activeConversationDesignJobs.length;
  const activeConversationLatestDesignJob = activeConversationDesignJobs[0] || null;
  const activeConversationLatestDesignImages = activeConversationLatestDesignJob?.images || [];
  const activeConversationLatestImageRound = componentLatestDesignImageRound(activeConversationLatestDesignImages);
  const activeConversationVisibleDesignImages = componentDesignImagesForRound(
    activeConversationLatestDesignImages,
    activeConversationLatestImageRound,
  );
  const activeConversationOlderDesignImageCount = Math.max(
    0,
    activeConversationLatestDesignImages.length - activeConversationVisibleDesignImages.length,
  );
  const activeConversationActualSelectedDesignImage =
    activeConversationLatestDesignImages.find((image) => image.selected) || null;
  const activeConversationSelectedDesignImage =
    activeConversationActualSelectedDesignImage || activeConversationVisibleDesignImages[0] || activeConversationLatestDesignImages[0] || null;
  const activeConversationLatestRevision = activeConversationLatestDesignJob?.revisions?.length
    ? [...activeConversationLatestDesignJob.revisions].sort((left, right) => Number(right.revisionNumber || 0) - Number(left.revisionNumber || 0))[0]
    : null;
  const activeConversationRevisionCount = Number(
    activeConversationLatestDesignJob?.revisionCount || activeConversationLatestDesignJob?.revisions?.length || 0,
  );
  const activeConversationRevisionPolicy = activeConversationLatestDesignJob?.revisionPolicy || null;
  const activeConversationCanSubmitRevision = Boolean(
    activeConversationLatestDesignJob &&
      activeConversationLatestDesignImages.length &&
      revisionText.trim() &&
      !["cancelled", "failed"].includes(activeConversationLatestDesignJob.status),
  );
  const activeConversationLatestQuote = activeConversationLatestDesignJob
    ? quotes.find((quote) => quote.designJobId === activeConversationLatestDesignJob.id) || null
    : null;
  const activeConversationLatestOrderDraft = activeConversationLatestQuote
    ? orderDrafts.find((order) => order.quoteDraftId === activeConversationLatestQuote.id) || null
    : null;
  const activeConversationLatestQuoteSendRisk = activeConversationLatestQuote
    ? quoteSendBlockReason(activeConversationLatestQuote)
    : "";
  const activeConversationDealNextStep = activeConversationLatestOrderDraft
    ? orderDealNextStep(activeConversationLatestOrderDraft)
    : activeConversationLatestQuote
      ? quoteDealNextStep(
          activeConversationLatestQuote,
          activeConversationLatestOrderDraft,
          activeConversationLatestQuoteSendRisk,
        )
      : activeConversationActualSelectedDesignImage
        ? { tone: "blue", label: "下一步：生成报价", detail: "客户已选图，可以生成报价草稿。", action: "create_quote" }
        : { tone: "amber", label: "等待客户选图", detail: "点击客户选中的候选图后，系统会自动生成或准备报价。", action: "none" };
  const openSendTasks = sendTasks.filter((task) => !["sent", "cancelled"].includes(task.status));
  const prioritizeSendTasks = (tasks: SendTask[], limit = 4) => {
    const taskIds = new Set<string>();
    const ordered: SendTask[] = [];
    for (const task of [...activeConversationSendTasks, ...tasks]) {
      if (!tasks.some((candidate) => candidate.id === task.id)) continue;
      if (taskIds.has(task.id)) continue;
      taskIds.add(task.id);
      ordered.push(task);
      if (ordered.length >= limit) break;
    }
    return ordered;
  };
  const queuedSendTasks = prioritizeSendTasks(
    openSendTasks.filter((task) => !sendTaskNeedsManualAttention(task) && !isSendTaskConversationLocked(task)),
  );
  const blockedSendTasksForView = prioritizeSendTasks(
    sendTasks.filter(
      (task) =>
        task.status !== "sent" &&
        (sendTaskNeedsManualAttention(task) ||
        isSendTaskConversationLocked(task) ||
        Boolean(task.guardSnapshot?.blockedByManualLock) ||
          task.guardSnapshot?.blockedBy === "manual_lock"),
    ),
  );
  const diagnosticSendTasks = prioritizeSendTasks(openSendTasks, 3);
  const visibleSendTasks =
    sendWorkbenchView === "blocked"
      ? blockedSendTasksForView
      : sendWorkbenchView === "diagnostics"
        ? diagnosticSendTasks
        : queuedSendTasks;
  const visibleActiveConversationSendTaskCount = activeConversationId
    ? visibleSendTasks.filter((task) => task.conversationId === activeConversationId).length
    : 0;
  const blockedSendCount = sendTasks.filter((task) => task.status === "blocked").length;
  const manualAttentionSendTaskCount = sendTasks.filter((task) => task.status !== "sent" && sendTaskNeedsManualAttention(task)).length;
  const sendWorkbenchSummary =
    sendWorkbenchView === "blocked"
      ? `${blockedSendTasksForView.length} 个异常任务优先处理，${manualAttentionSendTaskCount} 个需人工处理`
      : sendWorkbenchView === "diagnostics"
        ? `桥接 ${operatorStatusName(bridgeStatus?.worker?.status)}，${sendAttempts.length} 次发送尝试`
        : `${queuedSendTasks.length} 个可处理任务，${openSendTasks.length} 个待发送`;
  const failedAttemptCount = sendAttempts.filter((attempt) => ["blocked", "failed"].includes(attempt.status)).length;
  const latestWindowByAccount = new Map<string, WechatWindowSnapshot>();
  for (const snapshot of windowSnapshots) {
    if (snapshot.wechatAccountId && !latestWindowByAccount.has(snapshot.wechatAccountId)) {
      latestWindowByAccount.set(snapshot.wechatAccountId, snapshot);
    }
  }
  const latestRoute = routeEvaluations[0];
  const activeConversationRoute = activeConversationId
    ? routeEvaluations.find((route) => route.conversationId === activeConversationId) || null
    : latestRoute || null;
  const wechatChannels = wechatChannelStatus?.channels || [];
  const wechatRuntimeIssueChannels = wechatChannels.filter((channel) => channel.status === "needs_runtime");
  const wechatSendAdapterIssueChannels = wechatChannels.filter((channel) => channel.status === "needs_send_adapter");
  const wechatConfigIssueChannels = wechatChannels.filter((channel) => channel.status === "needs_config");
  const activeWechatChannelName = wechatConversationChannelLabel(activeConversation?.channel);
  const activeQuote = activeJob ? quotes.find((quote) => quote.designJobId === activeJob.id) || null : null;
  const activeSelectedImage = activeJob?.images?.find((image) => image.selected) || null;
  const activePreflightResult = preflightResult?.designJobId === activeJob?.id ? preflightResult : null;
  const activeJobImages = activeJob?.images || [];
  const activeJobLocalImageCount = activeJobImages.filter((image) => Boolean(image.localPath)).length;
  const activeDesignImageSendRisk = activeJob ? designImageSendBlockReason(activeJob) : "";
  const activeDesignEscalationNotice = activeJob ? designJobEscalationNotice(activeJob) : null;
  const activeDesignOperatorPlan =
    activeJob && activeDesignEscalationNotice ? designJobOperatorRecoveryPlan(activeJob) : [];
  const activeQuoteCenterFocusText = quoteCenterSearch.trim();
  const quoteCenterSearchTerm = quoteCenterSearch.trim().toLowerCase();
  const filteredQuotes = quotes.filter((quote) => {
    if (quoteStatusFilter !== "all" && quote.status !== quoteStatusFilter) return false;
    if (quotePaymentFilter !== "all" && quote.paymentStatus !== quotePaymentFilter) return false;
    const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
    if (!matchesDealProgressFilter(dealProgressSteps(quote, orderDraft), dealProgressFilter)) return false;
    const step = guardedQuoteDealNextStep(quote, orderDraft, quoteSendBlockReason(quote));
    if (!matchesDealNextStepFilter(step, dealNextStepFilter, quote.status)) return false;
    return matchesQuoteSearch(quote, quoteCenterSearchTerm);
  });
  const filteredOrderDrafts = orderDrafts.filter((order) => {
    if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) return false;
    if (orderPaymentFilter !== "all" && orderPaymentStatusValue(order) !== orderPaymentFilter) return false;
    const linkedQuote = order.quoteDraft || quotes.find((quote) => quote.id === order.quoteDraftId) || null;
    if (linkedQuote && !matchesDealProgressFilter(dealProgressSteps(linkedQuote, order), dealProgressFilter)) return false;
    const step = guardedOrderDealNextStep(order);
    if (!matchesDealNextStepFilter(step, dealNextStepFilter, order.status)) return false;
    return matchesOrderSearch(order, quoteCenterSearchTerm);
  });
  const quoteNextStepCounts = quotes.reduce(
    (counts, quote) => {
      const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
      const step = guardedQuoteDealNextStep(quote, orderDraft, quoteSendBlockReason(quote));
      if (step.action !== "none") counts.actionable += 1;
      else if (matchesDealNextStepFilter(step, "blocked", quote.status)) counts.blocked += 1;
      return counts;
    },
    { actionable: 0, blocked: 0 },
  );
  const orderNextStepCounts = orderDrafts.reduce(
    (counts, order) => {
      const step = guardedOrderDealNextStep(order);
      if (step.action !== "none") counts.actionable += 1;
      else if (matchesDealNextStepFilter(step, "blocked", order.status)) counts.blocked += 1;
      return counts;
    },
    { actionable: 0, blocked: 0 },
  );
  const dealProgressStageCounts = calculateDealProgressStageCounts(quotes, orderDrafts);
  const dealProgressSummaryItems = dealProgressFilterOptions.map((option) => ({
    filter: option.value,
    label: option.label,
    count: option.value === "all" ? quotes.length + orderDrafts.length : dealProgressStageCounts[option.value] || 0,
    detail: dealProgressStageDetail(option.value),
    tone: dealProgressStageTone(option.value),
    view: dealProgressStageView(option.value),
  }));
  const activeDealProgressFilterLabel =
    dealProgressFilterOptions.find((option) => option.value === dealProgressFilter)?.label || "全部阶段";
  const activeDealNextStepFilterLabel =
    dealNextStepFilterOptions.find((option) => option.value === dealNextStepFilter)?.label || "全部下一步";
  const dealNextStepSummaryItems = [
    {
      key: "actionable",
      label: "可执行",
      value: quoteNextStepCounts.actionable + orderNextStepCounts.actionable,
      detail: "现在可以直接点执行推进",
      filter: "actionable",
      tone: "green",
    },
    {
      key: "blocked",
      label: "需处理",
      value: quoteNextStepCounts.blocked + orderNextStepCounts.blocked,
      detail: "缺资料、人工审核或等待客户",
      filter: "blocked",
      tone: "amber",
    },
    {
      key: "quote-actionable",
      label: "报价可执行",
      value: quoteNextStepCounts.actionable,
      detail: "发报价或生成订单",
      filter: "actionable",
      tone: "blue",
    },
    {
      key: "order-actionable",
      label: "订单可执行",
      value: orderNextStepCounts.actionable,
      detail: "发确认、排产或交付",
      filter: "actionable",
      tone: "blue",
    },
  ];
  const dealNextStepInsightItems = [
    ...quotes.map((quote) => {
      const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
      const sendRisk = quoteSendBlockReason(quote);
      const step = guardedQuoteDealNextStep(quote, orderDraft, sendRisk);
      return {
        id: `quote-${quote.id}`,
        kind: "报价",
        title: quote.customer?.name || quote.designJob?.customerId || "未知客户",
        subtitle: `${quoteStatusLabel(quote.status)} · ${quote.totalPrice} 元`,
        tone: step.tone,
        label: step.label,
        detail: step.detail,
        action: step.action,
        status: quote.status,
        quote,
        order: null,
        focus: () => focusQuoteCenter(quote.id),
        execute: () => runQuoteDealNextStep(quote, orderDraft, sendRisk),
      };
    }),
    ...orderDrafts.map((order) => {
      const step = guardedOrderDealNextStep(order);
      return {
        id: `order-${order.id}`,
        kind: "订单",
        title: order.customer?.name || order.quoteDraft?.customer?.name || "未知客户",
        subtitle: `${orderStatusLabel(order.status)} · ${order.totalPrice} 元`,
        tone: step.tone,
        label: step.label,
        detail: step.detail,
        action: step.action,
        status: order.status,
        quote: null,
        order,
        focus: () => focusOrderDraft(order),
        execute: () => runOrderDealNextStep(order),
      };
    }),
  ]
    .filter(
      (item) =>
        item.action !== "none" ||
        matchesDealNextStepFilter({ action: item.action }, "blocked", item.status),
    )
    .sort((left, right) => Number(right.action !== "none") - Number(left.action !== "none"))
    .slice(0, 6);
  const actionableDealNextStepItems = dealNextStepInsightItems.filter((item) => item.action !== "none");
  const firstActionableDealNextStep = actionableDealNextStepItems[0] || null;
  const acceptedQuotesWithoutOrder = quotes.filter((quote) =>
    quote.status === "accepted" && !orderDrafts.some((order) => order.quoteDraftId === quote.id),
  );
  const dealFlowSendableQuotes = quotes.filter((quote) =>
    !isHighValueQuote(quote) && ["draft", "auto_sent"].includes(quote.status) && !quoteSendBlockReason(quote),
  );
  const dealFlowAcceptedQuotesWithoutOrder = acceptedQuotesWithoutOrder.filter((quote) =>
    !isHighValueQuote(quote) && !quoteOrderDraftBlockReason(quote),
  );
  const dealFlowConfirmationCandidates = orderDrafts.filter((order) =>
    guardedOrderDealNextStep(order).action === "queue_order_confirmation",
  );
  const dealFlowQueuedSendCount = sendTasks.filter((task) => !["sent", "cancelled"].includes(task.status)).length;
  const dealFlowPreviewItems = [
    { label: "报价入队", value: dealFlowSendableQuotes.length },
    { label: "生成订单", value: dealFlowAcceptedQuotesWithoutOrder.length },
    { label: "订单确认", value: dealFlowConfirmationCandidates.length },
    { label: "待安全发送", value: dealFlowQueuedSendCount },
  ];
  const dealFlowPreviewTotal = dealFlowPreviewItems.reduce((sum, item) => sum + item.value, 0);
  const quoteDealBoardItems = [
    {
      key: "quote-send",
      label: "待发报价",
      value: quotes.filter((quote) => quote.status === "send_queued" || quote.sendTask?.status === "queued").length,
      note: "报价已生成，等微信安全队列发送",
      tone: "blue",
      onClick: () => {
        setQuoteWorkbenchView("quotes");
        setQuoteStatusFilter("send_queued");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
        setDealProgressFilter("confirm");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "customer-confirm",
      label: "等客户确认",
      value: quotes.filter((quote) => quote.status === "sent" && !orderDrafts.some((order) => order.quoteDraftId === quote.id)).length,
      note: "报价已发出，等客户说可以做",
      tone: "amber",
      onClick: () => {
        setQuoteWorkbenchView("quotes");
        setQuoteStatusFilter("sent");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
        setDealProgressFilter("confirm");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "order-create",
      label: "待建订单",
      value: acceptedQuotesWithoutOrder.length,
      note: "客户已确认，需生成订单草稿",
      tone: "amber",
      onClick: () => {
        setQuoteWorkbenchView("quotes");
        setQuoteStatusFilter("accepted");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
        setDealProgressFilter("order");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "payment",
      label: "待收款",
      value: orderDrafts.filter((order) => ["draft", "confirmed"].includes(order.status) && orderPaymentStatusValue(order) === "unpaid").length,
      note: "订单已建，未记录定金或全款",
      tone: "red",
      onClick: () => {
        setQuoteWorkbenchView("orders");
        setQuoteStatusFilter("all");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("unpaid");
        setDealProgressFilter("payment");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "confirm-send",
      label: "待发确认",
      value: orderDrafts.filter((order) =>
        order.status === "confirmed" && orderPaymentReady(order) && !hasActiveOrderConfirmationTask(order),
      ).length,
      note: "订单确认还没进入发送队列",
      tone: "blue",
      onClick: () => {
        setQuoteWorkbenchView("orders");
        setQuoteStatusFilter("all");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("confirmed");
        setOrderPaymentFilter("all");
        setDealProgressFilter("production");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "send-risk",
      label: "发送异常",
      value: orderDrafts.filter((order) => {
        const status = order.confirmationSendTask?.status;
        return status === "failed" || status === "blocked" || status === "cancelled";
      }).length,
      note: "订单确认发送失败、拦截或取消",
      tone: "red",
      onClick: () => {
        setQuoteWorkbenchView("orders");
        setQuoteStatusFilter("all");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
        setDealProgressFilter("all");
        scrollToWorkspaceSection("quote-center");
      },
    },
  ];
  const quoteWorkbenchSummary =
    quoteWorkbenchView === "actions"
      ? `${actionableDealNextStepItems.length} 个可执行事项`
      : quoteWorkbenchView === "quotes"
        ? `${filteredQuotes.length}/${quotes.length} 个报价`
        : quoteWorkbenchView === "orders"
          ? `${filteredOrderDrafts.length}/${orderDrafts.length} 个订单`
          : `${dealFlowPreviewTotal} 个本轮可推进节点`;
  const activeOrderDraft = activeQuote ? orderDrafts.find((order) => order.quoteDraftId === activeQuote.id) || null : null;
  const activeQuoteWarnings =
    activeQuote && activeQuotePreview?.quote.id === activeQuote.id ? activeQuotePreview.warnings : [];
  const activeQuoteSendRisk = activeQuote ? quoteSendBlockReason(activeQuote, activeQuoteWarnings) : "";
  const activeDealNextStep = activeOrderDraft
    ? guardedOrderDealNextStep(activeOrderDraft)
    : activeQuote
      ? guardedQuoteDealNextStep(activeQuote, activeOrderDraft, activeQuoteSendRisk)
      : activeSelectedImage
        ? { tone: "blue", label: "下一步：生成报价", detail: "客户已经选图，可以生成报价草稿。", action: "create_quote" }
        : { tone: "amber", label: "先让客户选图", detail: "还没有明确选中效果图，不能生成报价。", action: "none" };
  const unreadNoticeCount = notifications.filter((notice) => !notice.readAt).length;
  const lowValueAutomationIssues = useMemo(
    () => buildLowValueAutomationIssueItems(automationStatus?.lastRun),
    [automationStatus?.lastRun],
  );
  const lowValueAutomationIssueSummary = useMemo(
    () => buildLowValueAutomationIssueSummary(lowValueAutomationIssues) ?? EMPTY_LOW_VALUE_AUTOMATION_ISSUE_SUMMARY,
    [lowValueAutomationIssues],
  );
  useEffect(() => {
    if (!activeAutomationIssueKey) return;
    if (lowValueAutomationIssues.some((issue) => issue.key === activeAutomationIssueKey)) return;
    setActiveAutomationIssueKey("");
  }, [activeAutomationIssueKey, lowValueAutomationIssues]);
  const lowValueAutomationSummary = useMemo(
    () => buildLowValueAutomationSummary(automationStatus?.lastRun),
    [automationStatus?.lastRun],
  );
  const lowValueAutomationStepItems = useMemo(
    () => buildAutomationStepItems(automationStatus?.lastRun),
    [automationStatus?.lastRun],
  );
  const lowValueAutomationStepInsight = useMemo(
    () => buildAutomationStepInsight(automationStatus?.lastRun),
    [automationStatus?.lastRun],
  );
  const lowValueAutomationIdentityAudit = automationStatus?.lastRun?.identityAudit || null;
  const lowValueAutomationSkipSummary = useMemo(
    () => buildAutomationSkipSummaryPanel(automationStatus?.lastRun),
    [automationStatus?.lastRun],
  );
  const automationRunHistorySummary = useMemo(
    () => buildAutomationRunHistorySummary(automationStatus?.recentRuns),
    [automationStatus?.recentRuns],
  );
  const automationRunHistoryItems = useMemo(
    () => buildAutomationRunHistoryItems(automationStatus?.recentRuns),
    [automationStatus?.recentRuns],
  );
  const automationRuntimeItems = useMemo(
    () => buildAutomationRuntimeItems(automationStatus),
    [automationStatus],
  );

  useEffect(() => {
    if (!activeQuote) {
      setQuoteEdit({ quantity: "", unitPrice: "", totalCost: "", customerNotes: "" });
      return;
    }
    setQuoteEdit({
      quantity: String(activeQuote.quantity || ""),
      unitPrice: String(activeQuote.unitPrice || ""),
      totalCost: String(activeQuote.totalCost || ""),
      customerNotes: activeQuote.customerNotes || "",
    });
  }, [activeQuote?.id, activeQuote?.quantity, activeQuote?.unitPrice, activeQuote?.totalCost, activeQuote?.customerNotes]);

  useEffect(() => {
    let cancelled = false;
    if (!activeQuote?.id) {
      setActiveQuotePreview(null);
      return;
    }
    setActiveQuotePreview(null);
    getQuotePreview(activeQuote.id, identityExpectation(activeQuote))
      .then((preview) => {
        if (!cancelled) setActiveQuotePreview(preview);
      })
      .catch(() => {
        if (!cancelled) {
          setActiveQuotePreview({
            quote: activeQuote,
            message: "报价预览暂时生成失败，请刷新后重试。",
            warnings: ["preview failed"],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeQuote?.id,
    activeQuote?.quantity,
    activeQuote?.unitPrice,
    activeQuote?.totalPrice,
    activeQuote?.totalCost,
    activeQuote?.profit,
    activeQuote?.status,
    activeQuote?.selectedImageId,
    activeQuote?.sendTaskId,
  ]);

  const catalogIssuesBySku = useMemo(() => {
    const map = new Map<string, SkuCatalogAudit["issues"]>();
    for (const issue of catalogAudit?.issues || []) {
      const key = issue.skuCode || issue.name;
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), issue]);
    }
    return map;
  }, [catalogAudit]);
  const skuImportReadinessSummary = useMemo(
    () => skuImportPreview ? skuImportPreviewReadinessSummary(skuImportPreview.rows, skuImportPreview.audit?.issues || []) : null,
    [skuImportPreview],
  );
  const skuRepairQueue = useMemo(() => catalogAudit?.repairQueue || [], [catalogAudit]);
  const visibleSkuRepairQueue = useMemo(
    () => {
      const filtered = skuRepairQueue.filter(
        (item) =>
          skuRepairItemMatchesFilter(item, skuRepairFilter) &&
          skuRepairItemMatchesSearch(item, skuRepairSearch),
      );
      return sortSkuRepairQueue(filtered, skuRepairSort);
    },
    [skuRepairFilter, skuRepairQueue, skuRepairSearch, skuRepairSort],
  );
  const skuRepairFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of skuRepairFilterOptions) {
      counts[option.value] = skuRepairQueue.filter((item) => skuRepairItemMatchesFilter(item, option.value)).length;
    }
    return counts;
  }, [skuRepairQueue]);
  const skuRepairViewCustomized = skuRepairFilter !== "all" || skuRepairSearch.trim() !== "" || skuRepairSort !== "priority";
  const visibleSkuChangeLogs = useMemo(
    () =>
      skuChangeLogs.filter(
        (log) =>
          skuChangeImpactMatchesFilter(log, skuChangeImpactFilter) &&
          skuChangeMatchesSearch(log, skuChangeSearch),
      ),
    [skuChangeImpactFilter, skuChangeLogs, skuChangeSearch],
  );
  const skuChangeImpactFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of skuChangeImpactFilterOptions) {
      counts[option.value] = skuChangeLogs.filter((log) => skuChangeImpactMatchesFilter(log, option.value)).length;
    }
    return counts;
  }, [skuChangeLogs]);
  const skuImageProblems = useMemo(() => catalogAudit?.imageProblems || [], [catalogAudit]);
  const skuImageProblemCountByProduct = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of skuImageProblems) {
      const key = problem.skuCode || problem.name;
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [skuImageProblems]);
  const skuImageProblemMultiProductCount = useMemo(
    () => Array.from(skuImageProblemCountByProduct.values()).filter((count) => count > 1).length,
    [skuImageProblemCountByProduct],
  );
  const visibleSkuImageProblems = useMemo(
    () => {
    const filtered = skuImageProblems.filter(
      (problem) =>
        skuImageProblemMatchesSeverity(problem, skuImageProblemSeverityFilter) &&
        skuImageProblemMatchesPath(problem, skuImageProblemPathFilter) &&
        skuImageProblemMatchesAction(problem, skuImageProblemActionFilter) &&
        skuImageProblemMatchesSearch(problem, skuImageProblemSearch) &&
        (skuImageProblemProductScope !== "multiple" || (skuImageProblemCountByProduct.get(problem.skuCode || problem.name) || 0) > 1),
    );
    return sortSkuImageProblems(filtered, skuImageProblemSort, skuImageProblemCountByProduct);
  },
  [skuImageProblemActionFilter, skuImageProblemCountByProduct, skuImageProblemPathFilter, skuImageProblemProductScope, skuImageProblemSearch, skuImageProblemSeverityFilter, skuImageProblemSort, skuImageProblems],
);
  useEffect(() => {
    setSkuImageProblemVisibleLimit(SKU_IMAGE_PROBLEM_PAGE_SIZE);
  }, [skuImageProblemActionFilter, skuImageProblemPathFilter, skuImageProblemProductScope, skuImageProblemSearch, skuImageProblemSeverityFilter, skuImageProblemSort]);
  const visibleSkuImageProblemCards = useMemo(
    () => visibleSkuImageProblems.slice(0, skuImageProblemVisibleLimit),
    [skuImageProblemVisibleLimit, visibleSkuImageProblems],
  );
  const remainingSkuImageProblemCount = Math.max(0, visibleSkuImageProblems.length - visibleSkuImageProblemCards.length);
  const skuImageProblemSeverityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of skuImageProblemSeverityOptions) {
      counts[option.value] = skuImageProblems.filter((problem) => skuImageProblemMatchesSeverity(problem, option.value)).length;
    }
    return counts;
  }, [skuImageProblems]);
  const skuImageProblemPathCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of skuImageProblemPathOptions) {
      counts[option.value] = skuImageProblems.filter((problem) => skuImageProblemMatchesPath(problem, option.value)).length;
    }
    return counts;
  }, [skuImageProblems]);
  const skuImageProblemActionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const option of skuImageProblemActionOptions) {
      counts[option.value] = skuImageProblems.filter((problem) => skuImageProblemMatchesAction(problem, option.value)).length;
    }
    return counts;
  }, [skuImageProblems]);
  const visibleSkuImageProblemActionSummary = useMemo(
    () => buildSkuImageProblemActionSummary(visibleSkuImageProblems),
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemActionProductSummary = useMemo(
    () => buildSkuImageProblemActionProductSummary(visibleSkuImageProblems),
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemNextStepSummary = useMemo(
    () => buildSkuImageProblemNextStepSummary(visibleSkuImageProblems),
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemUploadMainCount = useMemo(
    () => visibleSkuImageProblems.filter((problem) => skuImageProblemMatchesAction(problem, "upload_main")).length,
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemUploadAngleCount = useMemo(
    () => visibleSkuImageProblems.filter((problem) => skuImageProblemMatchesAction(problem, "upload_angle")).length,
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemFilterSummary = useMemo(() => {
    const severityLabel = skuImageProblemSeverityOptions.find((option) => option.value === skuImageProblemSeverityFilter)?.label || "全部图片";
    const pathLabel = skuImageProblemPathOptions.find((option) => option.value === skuImageProblemPathFilter)?.label || "全部路径";
    const actionLabel = skuImageProblemActionOptions.find((option) => option.value === skuImageProblemActionFilter)?.label || "全部处理";
    const sortLabel = skuImageProblemSortOptions.find((option) => option.value === skuImageProblemSort)?.label || "严重程度";
    const productScopeLabel = skuImageProblemProductScope === "multiple" ? "只看多问题商品" : "全部商品";
    const keyword = skuImageProblemSearch.trim();
    return [
      `严重程度：${severityLabel}`,
      `路径：${pathLabel}`,
      `处理方式：${actionLabel}`,
      `商品范围：${productScopeLabel}`,
      keyword ? `关键词：${keyword}` : "关键词：未设置",
      `排序：${sortLabel}`,
    ].join("；");
  }, [skuImageProblemActionFilter, skuImageProblemPathFilter, skuImageProblemProductScope, skuImageProblemSearch, skuImageProblemSeverityFilter, skuImageProblemSort,]);
  const skuImageProblemAuditRefreshContext = useMemo(() => {
    if (skuCatalogAuditRefreshSummary) {
      return `最近刷新 ${skuCatalogAuditRefreshAt || "刚刚"}；${skuCatalogAuditRefreshSummary}`;
    }
    const imageIssueCount = catalogAudit?.imageIssueCount ?? catalogAudit?.missingImageCount ?? skuImageProblems.length;
    return `未手动刷新商品审核；当前体检图片问题 ${imageIssueCount} 个`;
  }, [catalogAudit, skuCatalogAuditRefreshAt, skuCatalogAuditRefreshSummary, skuImageProblems.length]);
  const visibleSkuImageProblemProductCount = useMemo(() => {
    const keys = new Set<string>();
    for (const problem of visibleSkuImageProblems) {
      const key = problem.skuCode || problem.name;
      if (key) keys.add(key);
    }
    return keys.size;
  }, [visibleSkuImageProblems]);
  const visibleSkuImageProblemPathCount = useMemo(
    () => visibleSkuImageProblems.filter((problem) => Boolean(problem.path)).length,
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemInvalidPathCount = useMemo(
    () =>
      visibleSkuImageProblems.filter(
        (problem) => Boolean(problem.path) && skuImageProblemMatchesAction(problem, "review_invalid"),
      ).length,
    [visibleSkuImageProblems],
  );
  const visibleSkuImageProblemMissingPathCount = Math.max(0, visibleSkuImageProblems.length - visibleSkuImageProblemPathCount);
  const skuImageProblemViewCustomized =
    skuImageProblemSeverityFilter !== "all" ||
    skuImageProblemPathFilter !== "all" ||
    skuImageProblemActionFilter !== "all" ||
    skuImageProblemProductScope !== "all" ||
    skuImageProblemSearch.trim() !== "" ||
    skuImageProblemSort !== "severity";
  const knownSkuCodeSet = useMemo(() => new Set(skus.map((sku) => sku.skuCode).filter(Boolean)), [skus]);
  const skuNameByCode = useMemo(() => new Map(skus.map((sku) => [sku.skuCode, sku.name])), [skus]);
  const skuReferenceOptions = useMemo(
    () =>
      skus
        .filter((sku) => sku.skuCode)
        .map((sku) => ({
          skuCode: sku.skuCode,
          label: [sku.name, sku.category || sku.type].filter(Boolean).join(" · "),
        })),
    [skus],
  );
  const skuReferenceQuickOptions = useMemo(
    () => skuReferenceOptions.filter((option) => option.skuCode !== skuForm.skuCode.trim()).slice(0, 6),
    [skuForm.skuCode, skuReferenceOptions],
  );
  const skuFormPricingStatus = useMemo(() => skuFormPricingPreview(skuForm), [skuForm]);
  const skuFormSpecificationStatus = useMemo(() => skuFormSpecificationPreview(skuForm), [skuForm]);
  const skuFormReadinessWarnings = useMemo(() => validateSkuFormReadiness(skuForm), [skuForm]);
  const skuFormAutomationStatus = useMemo(() => skuFormAutomationPreview(skuForm, skuFormReadinessWarnings), [skuForm, skuFormReadinessWarnings]);
  const skuFormReferenceWarnings = useMemo(() => validateSkuFormReferences(skuForm, knownSkuCodeSet), [knownSkuCodeSet, skuForm]);
  const skuFormReferenceMatches = useMemo(() => skuFormReferenceSummary(skuForm, skuNameByCode), [skuForm, skuNameByCode]);
  const activeSkuOriginal = useMemo(
    () => skus.find((sku) => sku.skuCode === skuForm.skuCode.trim()) || null,
    [skuForm.skuCode, skus],
  );
  const skuFormImageChangeSummary = useMemo(
    () => buildSkuFormImageChangeSummary(skuForm, activeSkuOriginal),
    [activeSkuOriginal, skuForm],
  );
  const activeSkuRepairItem = useMemo(() => {
    const skuCode = skuForm.skuCode.trim();
    const name = skuForm.name.trim();
    if (!skuCode && !name) return null;
    return skuRepairQueue.find((item) =>
      (skuCode && item.skuCode === skuCode) || (name && item.name === name),
    ) || null;
  }, [skuForm.name, skuForm.skuCode, skuRepairQueue]);
  const activeSkuRepairProgress = useMemo(() => {
    if (!activeSkuRepairItem) return null;
    const warningFields = new Set(skuFormReadinessWarnings.map((warning) => warning.field));
    for (const warning of skuFormReferenceWarnings) {
      warningFields.add(warning.field);
    }
    const resolvedFields = activeSkuRepairItem.missingFields.filter((field) =>
      !warningFields.has(field.field) && skuFormFieldHasUsableValue(skuForm, field.field),
    );
    const unresolvedFields = activeSkuRepairItem.missingFields.filter((field) =>
      warningFields.has(field.field) || !skuFormFieldHasUsableValue(skuForm, field.field),
    );
    const tone =
      skuFormAutomationStatus.tone === "ready"
        ? "ready"
        : skuFormAutomationStatus.tone === "blocked" || skuFormAutomationStatus.tone === "draft"
          ? "blocked"
          : "review";
    const label = unresolvedFields.length
      ? `仍有 ${unresolvedFields.length} 项待补`
      : tone === "ready"
        ? "补齐后可自动"
        : tone === "blocked"
          ? "仍会阻塞"
          : "补齐后需复核";
    const detail = unresolvedFields.length
      ? `优先处理：${unresolvedFields.slice(0, 3).map((field) => field.label || skuFieldLabel(field.field)).join("、")}`
      : skuFormAutomationStatus.detail;
    return { tone, label, detail, resolvedFields, unresolvedFields };
  }, [activeSkuRepairItem, skuForm, skuFormAutomationStatus, skuFormReadinessWarnings, skuFormReferenceWarnings]);
  const visibleSkus = useMemo(() => {
    const query = skuSearch.trim().toLowerCase();
    return skus.filter((sku) => {
      const issueKey = sku.skuCode || sku.name;
      const issues = catalogIssuesBySku.get(issueKey) || [];
      if (skuTypeFilter !== "all" && sku.type !== skuTypeFilter) return false;
      if (skuIssueFilter === "ready" && issues.some((issue) => ["error", "warning"].includes(issue.severity))) return false;
      if (skuIssueFilter === "problem" && !issues.some((issue) => issue.severity !== "info")) return false;
      if (skuIssueFilter === "error" && !issues.some((issue) => issue.severity === "error")) return false;
      if (skuIssueFilter === "warning" && !issues.some((issue) => issue.severity === "warning")) return false;
      if (
        skuIssueFilter === "missing_image" &&
        !issues.some((issue) =>
          ["missing_main_image", "local_main_image_missing", "invalid_main_image_type", "invalid_angle_image_type", "local_angle_image_missing"].includes(issue.code),
        )
      ) return false;
      if (skuIssueFilter === "low_stock" && !issues.some((issue) => ["low_stock", "out_of_stock"].includes(issue.code))) return false;
      if (
        skuIssueFilter === "negative_margin" &&
        !issues.some((issue) => ["invalid_cost_price", "negative_margin", "low_margin_rate"].includes(issue.code))
      ) return false;
      if (skuIssueFilter === "duplicate" && !issues.some((issue) => ["duplicate_sku_code", "duplicate_name", "unsafe_sku_code", "sku_code_whitespace"].includes(issue.code))) return false;
      if (skuIssueFilter === "type" && !issues.some((issue) => ["missing_sku_type", "invalid_sku_type"].includes(issue.code))) return false;
      if (skuIssueFilter === "replacement" && !issues.some((issue) => ["invalid_replacement_sku", "self_replacement_sku"].includes(issue.code))) return false;
      if (skuIssueFilter === "matching_rule" && !issues.some((issue) => ["invalid_matching_rule_sku", "self_matching_rule_sku"].includes(issue.code))) return false;
      if (skuIssueFilter === "lead_time" && !issues.some((issue) => ["invalid_lead_time", "long_lead_time"].includes(issue.code))) return false;
      if (skuIssueFilter === "specification" && !issues.some((issue) => ["missing_dimensions", "incomplete_dimensions", "invalid_dimensions", "missing_weight", "invalid_weight"].includes(issue.code))) return false;
      if (!query) return true;
      return [
        sku.skuCode,
        sku.name,
        sku.category,
        sku.supplier,
        sku.material,
        ...(sku.sceneTags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
      });
  }, [catalogIssuesBySku, skuIssueFilter, skuSearch, skuTypeFilter, skus]);
  function setCatalogWorkbenchDetail(view: "import" | "preview" | "audit" | "bundle") {
    setCatalogWorkbenchView(view);
    if (typeof window === "undefined") return;
    const nextHash = `catalog-center:${view}`;
    const currentHash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (currentHash !== nextHash) {
      window.history.replaceState(null, "", `#${nextHash}`);
    }
  }

  function scrollToWorkspaceSection(
    sectionId: string,
    options: { behavior?: ScrollBehavior; syncHash?: boolean } = {},
  ) {
    const behavior = options.behavior ?? "smooth";
    const syncHash = options.syncHash ?? true;
    setActiveWorkspaceSection(sectionId);
    if (syncHash && typeof window !== "undefined" && window.location.hash !== `#${sectionId}`) {
      window.history.replaceState(null, "", `#${sectionId}`);
    }
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace");
      const targetSection = document.getElementById(sectionId);
      workspace?.scrollTo({ top: 0, behavior });
      targetSection?.scrollTo({ left: 0, top: 0, behavior: "auto" });
      targetSection?.querySelectorAll<HTMLElement>(
        [
          ".quote-panel",
          ".training-panel",
          ".send-panel",
          ".config-status-grid",
          ".config-mode-guide",
          ".config-form-grid",
          ".config-actions",
          ".config-activation-panel",
          ".config-login-panel",
          ".sku-controls",
          ".sku-repair-guide",
          ".sku-batch-bar",
          ".sku-table",
          ".sku-editor",
          ".automation-readiness",
          ".automation-history-list",
          ".automation-issue-panel",
          ".notice-list",
          ".catalog-tools",
          ".sku-import-guide",
          ".import-preview",
          ".catalog-audit",
          ".sku-change-log",
          ".bundle-result",
          ".review-panel",
          ".routing-panel",
          ".route-result",
          ".chat-detail",
          ".agent-list",
          ".wechat-channel-panel-body",
          ".wechat-channel-list",
          ".wechat-visual-panel",
          ".wechat-config-list",
          ".send-panel",
          ".send-task-list",
        ].join(", "),
      ).forEach((pane) => {
        if (pane.scrollLeft || pane.scrollTop) pane.scrollTo({ left: 0, top: 0, behavior: "auto" });
      });
      document.scrollingElement?.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function renderFilterSegment(
    label: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    onChange: (nextValue: string) => void
  ) {
    return (
      <div className="filter-control">
        <span>{label}</span>
        <div className="segmented-control filter-segment" role="group" aria-label={label}>
          {options.map((option) => (
            <button
              aria-pressed={value === option.value}
              className={value === option.value ? "selected" : ""}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderConversationSelect() {
    return (
      <div
        className="conversation-picker"
        aria-label="选择客户会话"
        role="group"
      >
        <button
          aria-pressed={!activeConversationId}
          className={!activeConversationId ? "selected" : ""}
          disabled={Boolean(busy)}
          onClick={() => void changeActiveConversation("")}
          type="button"
        >
          <MessageCircle size={14} aria-hidden="true" />
          <span className="conversation-picker-label">请选择客户会话</span>
        </button>
        {conversations.map((conversation) => (
          <button
            aria-pressed={activeConversationId === conversation.id}
            className={activeConversationId === conversation.id ? "selected" : ""}
            disabled={Boolean(busy)}
            key={conversation.id}
            onClick={() => void changeActiveConversation(conversation.id)}
            title={`${conversation.wechatAccount?.displayName || conversation.wechatAccountId} / ${conversation.title}`}
            type="button"
          >
            <MessageCircle size={14} aria-hidden="true" />
            <span>
              <small>{conversation.wechatAccount?.displayName || conversation.wechatAccountId}</small>
              <strong>{conversation.title}</strong>
            </span>
          </button>
        ))}
      </div>
    );
  }

  const activeWorkspaceLabel = workspaceSectionLabels.get(activeWorkspaceSection) || "工作台";
  const isWechatWorkspace = activeWorkspaceSection === "wechat-channel-center";
  const isSendWorkspace = activeWorkspaceSection === "send-center";
  const isDesignWorkspace = ["design-platform-config", "asset-center", "design-center"].includes(activeWorkspaceSection);
  const isCustomerMessageWorkspace = ["conversation-center", "routing-center"].includes(activeWorkspaceSection);
  const pendingSendTaskCount = sendTasks.filter((task) => !["sent", "cancelled"].includes(task.status)).length;
  const manualReviewJobCount = jobs.filter((job) => job.status === "manual_review").length;
  const manualLockedConversations = conversations.filter((conversation) => conversation.manualLocked);
  const wechatVisualFlowSteps = wechatChannelStatus?.visualFlow?.length
    ? wechatChannelStatus.visualFlow
    : [
        { key: "inbound", label: "消息接入", detail: `${conversations.length} 个会话` },
        { key: "route", label: "智能路由", detail: `${routeEvaluations.length} 次评估` },
        { key: "review", label: "人工接管", detail: `${manualLockedConversations.length} 个锁定会话` },
        { key: "safe_send", label: "安全发送", detail: `${pendingSendTaskCount} 个待处理任务` },
      ];
  const manualLockLogByConversationId = useMemo(() => {
    const entries = new Map<string, ReviewLog>();
    for (const log of reviewCenter.logs) {
      if (log.targetType !== "conversation" || log.decision !== "manual_lock") continue;
      const conversationId = String(log.metadata?.conversationId || log.targetId || "");
      if (!conversationId || entries.has(conversationId)) continue;
      entries.set(conversationId, log);
    }
    return entries;
  }, [reviewCenter.logs]);
  const manualLockBlockedSendCountByConversationId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of sendTasks) {
      if (["sent", "cancelled"].includes(task.status)) continue;
      if (!task.guardSnapshot?.blockedByManualLock && task.guardSnapshot?.blockedBy !== "manual_lock") continue;
      counts.set(task.conversationId, (counts.get(task.conversationId) || 0) + 1);
    }
    return counts;
  }, [sendTasks]);
  const prioritizedManualLockedConversations = useMemo(
    () =>
      [...manualLockedConversations].sort((left, right) => {
        const leftTime = Date.parse(manualLockLogByConversationId.get(left.id)?.createdAt || "") || 0;
        const rightTime = Date.parse(manualLockLogByConversationId.get(right.id)?.createdAt || "") || 0;
        return rightTime - leftTime;
      }),
    [manualLockedConversations, manualLockLogByConversationId],
  );
  const hiddenManualLockedConversationCount = Math.max(0, prioritizedManualLockedConversations.length - 5);
  const activeConversationReviewLogs = useMemo(() => {
    if (!activeConversationId) return [];
    return reviewCenter.logs.filter((log) => reviewLogMatchesConversation(log, activeConversationId)).slice(0, 3);
  }, [reviewCenter.logs, activeConversationId]);
  const activeConversationBlockedSendCount = activeConversationId ? manualLockBlockedSendTaskCount(activeConversationId) : 0;
  const activeConversationDesignJobIds = new Set(activeConversationDesignJobs.map((job) => job.id));
  const activeConversationPendingReviewDesignJobs = activeConversationDesignJobs.filter(
    (job) =>
      job.status === "manual_review" ||
      (isHighValueDesignJob(job) && ["completed", "quick_confirm", "timeout", "failed"].includes(job.status)),
  );
  const activeConversationPendingReviewQuotes = activeConversationId
    ? quotes.filter(
        (quote) =>
          (quote.designJob?.conversationId === activeConversationId || activeConversationDesignJobIds.has(quote.designJobId)) &&
          !orderDrafts.some((order) => order.quoteDraftId === quote.id) &&
          (quote.status === "manual_review" || isHighValueQuote(quote)),
      )
    : [];
  const activeConversationPendingReviewOrders = activeConversationId
    ? dedupeOrdersById([...orderDrafts, ...(reviewCenter.orderDrafts || [])]).filter(
        (order) =>
          order.conversationId === activeConversationId &&
          (isHighValueOrder(order) || orderNeedsManualSendAttention(order)) &&
          !["fulfilled", "cancelled"].includes(order.status),
      )
    : [];
  const activeConversationReviewActionItems = [
    ...(activeConversationPendingReviewDesignJobs.length
      ? (() => {
          const job = activeConversationPendingReviewDesignJobs[0];
          const identityMissing = highValueQueueIdentityMissing(
            job.wechatAccountId || job.conversation?.wechatAccountId,
            job.customerId || job.customer?.name || job.conversation?.customerId,
            job.conversationId || job.conversation?.id || job.conversation?.title,
          );
          return [
            {
              key: "design",
              label: identityMissing ? "补身份" : "审设计",
              count: activeConversationPendingReviewDesignJobs.length,
              tone: identityMissing ? "red" : "blue",
              identityMissing,
              detail: identityMissing ? highValueQueueIdentityMissingNextAction() : "定位到当前客户待审核设计。",
              run: () => {
                setActiveId(job.id);
                setReviewWorkbenchView("design");
                scrollToWorkspaceSection("review-center");
                if (identityMissing) setMessage("当前客户设计任务缺少微信账号、客户或会话绑定，请先补齐身份。");
              },
            },
          ];
        })()
      : []),
    ...(activeConversationPendingReviewQuotes.length
      ? (() => {
          const quote = activeConversationPendingReviewQuotes[0];
          const identityMissing = highValueQueueIdentityMissing(
            quote.designJob?.wechatAccountId || quote.designJob?.conversation?.wechatAccountId,
            quote.customerId || quote.designJob?.customerId || quote.customer?.name || quote.designJob?.customer?.name,
            quote.designJob?.conversationId || quote.designJob?.conversation?.id || quote.designJob?.conversation?.title,
          );
          return [
            {
              key: "quote",
              label: identityMissing ? "补身份" : "审报价",
              count: activeConversationPendingReviewQuotes.length,
              tone: identityMissing ? "red" : "amber",
              identityMissing,
              detail: identityMissing ? highValueQueueIdentityMissingNextAction() : "定位到当前客户待审核报价。",
              run: () => {
                setReviewWorkbenchView("quote");
                focusQuoteCenter(quote.id);
                if (identityMissing) setMessage("当前客户报价缺少微信账号、客户或会话绑定，请先补齐身份。");
              },
            },
          ];
        })()
      : []),
    ...(activeConversationPendingReviewOrders.length
      ? (() => {
          const order = activeConversationPendingReviewOrders[0];
          const identityMissing = orderStrictIdentityMissing(order);
          return [
            {
              key: "order",
              label: identityMissing ? "补身份" : "审订单",
              count: activeConversationPendingReviewOrders.length,
              tone: "red",
              identityMissing,
              detail: identityMissing ? highValueQueueIdentityMissingNextAction() : "定位到当前客户待审核订单。",
              run: () => {
                focusHighValueOrderReview(order);
                if (identityMissing) setMessage("当前客户订单缺少微信账号、客户或会话绑定，已拦截后续批准动作，请先补齐身份。");
              },
            },
          ];
        })()
      : []),
  ];
  const orderDraftByQuoteId = new Map(orderDrafts.map((order) => [order.quoteDraftId, order]));
  const reviewOrderDrafts = dedupeOrdersById([...orderDrafts, ...(reviewCenter.orderDrafts || [])]);
  const highValueReviewOrderDrafts = sortHighValueReviewOrderDrafts(
    reviewOrderDrafts.filter(
      (order) => (isHighValueOrder(order) || orderNeedsManualSendAttention(order)) && !["fulfilled", "cancelled"].includes(order.status),
    ),
  );
  const highValueOrderReviewFilterCounts = highValueOrderReviewFilterOptions.reduce<Record<string, number>>((counts, option) => {
    counts[option.value] = highValueReviewOrderDrafts.filter((order) => highValueOrderMatchesReviewFilter(order, option.value)).length;
    return counts;
  }, {});
  const filteredHighValueReviewOrderDrafts = highValueReviewOrderDrafts.filter((order) =>
    highValueOrderMatchesReviewFilter(order, highValueOrderReviewFilter),
  );
  const visibleHighValueReviewOrderDrafts =
    reviewWorkbenchView === "order" ? filteredHighValueReviewOrderDrafts : filteredHighValueReviewOrderDrafts.slice(0, 2);
  function focusHighValueOrderReview(order: OrderDraft) {
    setReviewWorkbenchView("order");
    setHighValueOrderReviewFilter(highValueOrderReviewFilterForOrder(order));
    focusOrderDraft(order);
  }
  type HighValueManualQueueItem = {
    id: string;
    kind: string;
    title: string;
    subtitle: string;
    accountLabel: string;
    customerLabel: string;
    conversationLabel: string;
    identityMissing: boolean;
    isActiveConversation: boolean;
    reason: string;
    label: string;
    detail: string;
    nextAction: string;
    tone: string;
    priority: number;
    primaryLabel: string;
    reviewFilterLabel?: string;
    nextFollowLabel?: string;
    order?: OrderDraft;
    focus: () => void;
    run: () => void;
  };
  const highValueManualQueueItems = [
    ...jobs
      .filter((job) =>
        job.status === "manual_review" ||
        (isHighValueDesignJob(job) && ["completed", "quick_confirm", "timeout", "failed"].includes(job.status)),
      )
      .map((job) => {
        const step = highValueDesignManualStep(job);
        const accountIdentity = job.wechatAccountId || job.conversation?.wechatAccountId;
        const customerIdentity = job.customer?.name || job.customerId || job.conversation?.customerId;
        const conversationIdentity = job.conversationId || job.conversation?.id || job.conversation?.title;
        const identityMissing = highValueQueueIdentityMissing(accountIdentity, customerIdentity, conversationIdentity);
        return {
          id: `design-${job.id}`,
          kind: "设计",
          title: job.customer?.name || job.customerId || "未知客户",
          subtitle: `${readableScene(job.scene, "未填写场景")} · ${statusLabel[job.status] || job.status}`,
          accountLabel: highValueQueueAccountLabel(accountIdentity),
          customerLabel: highValueQueueCustomerLabel(customerIdentity),
          conversationLabel: highValueQueueConversationLabel(job.conversation?.title || job.conversationId),
          identityMissing,
          isActiveConversation: Boolean(activeConversationId && job.conversationId === activeConversationId),
          reason: highValueDesignReason(job),
          label: identityMissing ? "身份缺失" : step.label,
          detail: identityMissing ? highValueQueueIdentityMissingDetail() : step.detail,
          nextAction: identityMissing ? highValueQueueIdentityMissingNextAction() : step.nextAction,
          tone: identityMissing ? "red" : step.tone,
          priority: identityMissing ? 6 : step.priority,
          primaryLabel: identityMissing ? "补身份" : "审设计",
          focus: () => {
            setActiveId(job.id);
            setReviewWorkbenchView("design");
            scrollToWorkspaceSection("review-center");
          },
          run: () => {
            setActiveId(job.id);
            setReviewWorkbenchView("design");
            scrollToWorkspaceSection("review-center");
          },
        };
      }),
    ...quotes
      .filter((quote) => !orderDraftByQuoteId.has(quote.id) && (quote.status === "manual_review" || isHighValueQuote(quote)))
      .map((quote) => {
        const orderDraft = orderDraftByQuoteId.get(quote.id) || null;
        const step = highValueQuoteManualStep(quote, orderDraft);
        const accountIdentity = quote.designJob?.wechatAccountId || quote.designJob?.conversation?.wechatAccountId;
        const customerIdentity = quote.customer?.name || quote.customerId || quote.designJob?.customerId;
        const conversationIdentity =
          quote.designJob?.conversationId || quote.designJob?.conversation?.id || quote.designJob?.conversation?.title;
        const identityMissing = highValueQueueIdentityMissing(accountIdentity, customerIdentity, conversationIdentity);
        return {
          id: `quote-${quote.id}`,
          kind: "报价",
          title: quote.customer?.name || quote.designJob?.customerId || "未知客户",
          subtitle: `${quote.totalPrice} 元 · ${quote.quantity} 份 · 利润 ${quote.profit} 元`,
          accountLabel: highValueQueueAccountLabel(accountIdentity),
          customerLabel: highValueQueueCustomerLabel(customerIdentity),
          conversationLabel: highValueQueueConversationLabel(quote.designJob?.conversation?.title || quote.designJob?.conversationId),
          identityMissing,
          isActiveConversation: Boolean(activeConversationId && quote.designJob?.conversationId === activeConversationId),
          reason: highValueQuoteReason(quote),
          label: identityMissing ? "身份缺失" : step.label,
          detail: identityMissing ? highValueQueueIdentityMissingDetail() : step.detail,
          nextAction: identityMissing ? highValueQueueIdentityMissingNextAction() : step.nextAction,
          tone: identityMissing ? "red" : step.tone,
          priority: identityMissing ? 6 : step.priority,
          primaryLabel: identityMissing ? "补身份" : "审报价",
          focus: () => {
            setReviewWorkbenchView("quote");
            focusQuoteCenter(quote.id);
          },
          run: () => {
            setReviewWorkbenchView("quote");
            focusQuoteCenter(quote.id);
          },
        };
      }),
    ...highValueReviewOrderDrafts
      .map((order) => {
        const step = highValueOrderManualStep(order);
        const action = highValueOrderManualPrimaryAction(order);
        const reviewFilter = highValueOrderReviewFilterForOrder(order);
        const nextFollowLabel = highValueOrderNextFollowLabel(order);
        const accountIdentity = order.wechatAccountId;
        const customerIdentity = order.customerId;
        const conversationIdentity = order.conversationId;
        const identityMissing = orderStrictIdentityMissing(order);
        return {
          id: `order-${order.id}`,
          kind: "订单",
          title: order.customer?.name || order.quoteDraft?.customer?.name || "未知客户",
          subtitle: `${order.totalPrice} 元 · ${order.quantity} 份 · ${paymentStatusLabel(orderPaymentStatusValue(order))}`,
          accountLabel: highValueQueueAccountLabel(accountIdentity),
          customerLabel: highValueQueueCustomerLabel(customerIdentity),
          conversationLabel: highValueQueueConversationLabel(order.conversationId ? order.designJob?.conversation?.title || order.conversationId : ""),
          identityMissing,
          isActiveConversation: Boolean(activeConversationId && order.conversationId === activeConversationId),
          reason: highValueOrderReason(order),
          label: identityMissing ? "身份缺失" : step.label,
          detail: identityMissing ? highValueQueueIdentityMissingDetail() : step.detail,
          nextAction: identityMissing ? highValueQueueIdentityMissingNextAction() : step.nextAction,
          tone: identityMissing ? "red" : step.tone,
          priority: identityMissing ? 6 : step.priority,
          primaryLabel: identityMissing ? "补身份" : action.label,
          reviewFilterLabel: highValueOrderReviewFilterOptionLabel(reviewFilter),
          nextFollowLabel,
          order,
          focus: () => {
            if (orderNeedsManualSendAttention(order)) {
              void focusOrderManualSendAttention(order);
              return;
            }
            focusHighValueOrderReview(order);
          },
          run: () => {
            if (identityMissing) {
              focusHighValueOrderReview(order);
              setMessage("该高价值订单缺少微信账号、客户或会话绑定，已拦截批准动作，请先补齐身份。");
              return;
            }
            setReviewWorkbenchView("order");
            setHighValueOrderReviewFilter(highValueOrderReviewFilterForOrder(order));
            if (action.type === "queue_confirmation") {
              void reviewOrderDraft(order, "approve_confirmation");
              return;
            }
            if (action.type === "queue_delivery") {
              void reviewOrderDraft(order, "approve_followup", "delivery");
              return;
            }
            if (orderNeedsManualSendAttention(order)) {
              void focusOrderManualSendAttention(order);
              return;
            }
            focusHighValueOrderReview(order);
          },
        };
      }),
    ...prioritizedManualLockedConversations.map((conversation) => {
      const blockedSendCount = manualLockBlockedSendCountByConversationId.get(conversation.id) || 0;
      const accountIdentity = conversation.wechatAccount?.displayName || conversation.wechatAccountId;
      const customerIdentity = conversation.customer?.name || conversation.customerId;
      const conversationIdentity = conversation.id || conversation.title;
      const identityMissing = highValueQueueIdentityMissing(accountIdentity, customerIdentity, conversationIdentity);
      return {
        id: `conversation-${conversation.id}`,
        kind: "会话",
        title: conversation.customer?.name || conversation.title,
        subtitle: `${conversation.wechatAccount?.displayName || conversation.wechatAccountId} · ${conversation.title}`,
        accountLabel: highValueQueueAccountLabel(accountIdentity),
        customerLabel: highValueQueueCustomerLabel(customerIdentity),
        conversationLabel: highValueQueueConversationLabel(conversation.title || conversation.id),
        identityMissing,
        isActiveConversation: Boolean(activeConversationId && conversation.id === activeConversationId),
        reason: blockedSendCount ? "发送任务被人工接管拦截" : "会话已人工接管",
        label: identityMissing ? "身份缺失" : blockedSendCount ? "发送已暂停" : "人工接管中",
        detail: identityMissing
          ? highValueQueueIdentityMissingDetail()
          : blockedSendCount
            ? `已有 ${blockedSendCount} 个发送任务被人工接管拦截，先确认客户上下文再解除。`
            : "自动回复和自动发送已暂停，人工处理完成后再解除接管。",
        nextAction: identityMissing
          ? highValueQueueIdentityMissingNextAction()
          : blockedSendCount
            ? "核对客户、微信账号、最近消息和待发内容，再决定重排或取消发送。"
            : "人工处理完问题后，填写处理说明再解除接管。",
        tone: "red",
        priority: identityMissing ? 6 : blockedSendCount ? 15 : 80,
        primaryLabel: identityMissing ? "补身份" : "看会话",
        focus: () => void focusConversation(conversation.id, "conversation-center"),
        run: () => void focusConversation(conversation.id, blockedSendCount ? "send-center" : "conversation-center"),
      };
    }),
  ].sort((left, right) => left.priority - right.priority).slice(0, 8) as HighValueManualQueueItem[];
  const firstReadinessProblem =
    platformReadiness?.checks.find((check) => !check.ok && check.severity === "error")?.label ||
    platformReadiness?.nextSteps[0] ||
    "";
  const designPlatformOperationGuide = buildDesignPlatformOperationGuide({
    config: platformConfig,
    form: platformConfigForm,
    health: platformHealth,
    readiness: platformReadiness,
  });
  const showStandaloneDesignPlatformGuide =
    isDesignWorkspace && Boolean(designPlatformOperationGuide) && !(platformReadiness && !platformReadiness.canSubmitFormalGeneration);
  const platformPillTone = platformReadiness
    ? platformReadiness.canSubmitFormalGeneration
      ? "online"
      : "warning"
    : platformHealth?.ok
      ? "online"
      : "offline";
  const platformStateText = platformReadiness
    ? platformReadiness.canSubmitFormalGeneration
      ? `正式出图就绪 ${designPlatformAdapterLabel(platformReadiness.adapter)} ${platformReadiness.latencyMs}ms`
      : `正式出图需处理${firstReadinessProblem ? `：${firstReadinessProblem}` : ""}`
    : platformHealth?.ok
      ? `${designPlatformAdapterLabel(platformHealth.adapter)} ${platformHealth.latencyMs}ms`
      : "离线";
  const platformPillText = platformReadiness
    ? platformReadiness.canSubmitFormalGeneration
      ? `设计 ${platformReadiness.latencyMs}ms`
      : "设计待处理"
    : platformHealth?.ok
      ? `设计 ${platformHealth.latencyMs}ms`
      : "设计离线";
  const automationPillText = automationStatus?.running
    ? "自动运行"
    : automationStatus?.active
      ? `自动 ${Math.round((automationStatus.intervalMs || 0) / 1000)}s`
      : "自动暂停";
  const automationPillTitle = automationStatus?.running
    ? "低价值自动化运行中"
    : automationStatus?.active
      ? `低价值自动化已开启，间隔 ${Math.round((automationStatus.intervalMs || 0) / 1000)} 秒`
      : "低价值自动化未开启";
  const automationStateText = automationStatus?.active ? "自动化运行中" : "自动化暂停";
  const queueStateText = pendingSendTaskCount ? `${pendingSendTaskCount} 个待校验发送` : "发送队列空闲";
  const wechatTopPillTone = !wechatChannelStatus
    ? "offline"
    : wechatChannelStatus.summary.ready >= wechatChannelStatus.summary.total
      ? "online"
      : "warning";
  const wechatTopPillText = wechatChannelStatus
    ? `微信 ${wechatChannelStatus.summary.ready}/${wechatChannelStatus.summary.total}`
    : "微信待刷新";
  const wechatTopPillTitle = wechatChannelStatus
    ? `个人微信、企业微信、小程序：${wechatChannelStatus.summary.ready}/${wechatChannelStatus.summary.total} 个通道就绪`
    : "点击刷新微信接入状态";
  const bridgeTopPillTone = bridgeStatus?.worker?.ok ? "online" : bridgeStatus ? "warning" : "offline";
  const bridgeTopPillText = `桥接 ${operatorStatusName(bridgeStatus?.worker?.status)}`;
  const bridgeTopPillTitle = bridgeStatus?.worker?.message || bridgeStatus?.worker?.errorMessage || "Windows 微信桥接 worker 状态";
  const queueTopPillTone = pendingSendTaskCount ? "warning" : "online";
  const reviewStateText =
    manualReviewJobCount || highValueReviewOrderDrafts.length || manualLockedConversations.length
      ? `${manualReviewJobCount} 个设计待人工审核 · ${highValueReviewOrderDrafts.length} 个订单待人工 · ${manualLockedConversations.length} 个人工接管`
      : "审核中心空闲";
  const highValueOrderReviewFilterLabel = highValueOrderReviewFilterOptionLabel(highValueOrderReviewFilter);
  const reviewWorkbenchSummary =
    reviewWorkbenchView === "design"
      ? `${reviewCenter.designJobs.length} 个设计待审`
      : reviewWorkbenchView === "quote"
        ? `${reviewCenter.quoteDrafts.length} 个报价待审`
        : reviewWorkbenchView === "order"
          ? `${filteredHighValueReviewOrderDrafts.length}/${highValueReviewOrderDrafts.length} 个待人工订单 · ${highValueOrderReviewFilterLabel}`
          : reviewWorkbenchView === "logs"
            ? `${reviewCenter.logs.length} 条审核记录`
          : `${manualLockedConversations.length} 个人工接管`;
  const automationReadinessPrimaryCheck = getAutomationReadinessPrimaryCheck(automationReadiness);

  function renderTopStatusPills() {
    if (isWechatWorkspace) {
      return (
        <>
          <span className="platform-pill current-section-pill" aria-live="polite">
            当前 {activeWorkspaceLabel}
          </span>
          <span className={`platform-pill wechat-health-pill ${wechatTopPillTone}`} title={wechatTopPillTitle}>
            {wechatTopPillText}
          </span>
          <span className={`platform-pill bridge-health-pill ${bridgeTopPillTone}`} title={bridgeTopPillTitle}>
            {bridgeTopPillText}
          </span>
          <span className={`platform-pill queue-health-pill ${queueTopPillTone}`} title={queueStateText}>
            待发 {pendingSendTaskCount}
          </span>
        </>
      );
    }
    if (isSendWorkspace) {
      return (
        <>
          <span className="platform-pill current-section-pill" aria-live="polite">
            当前 {activeWorkspaceLabel}
          </span>
          <span className={`platform-pill queue-health-pill ${queueTopPillTone}`} title={queueStateText}>
            待发 {pendingSendTaskCount}
          </span>
          <span className={`platform-pill bridge-health-pill ${bridgeTopPillTone}`} title={bridgeTopPillTitle}>
            {bridgeTopPillText}
          </span>
          <span className={`platform-pill ${failedAttemptCount ? "warning" : "online"}`} title={`${sendAttempts.length} 次发送尝试`}>
            异常 {failedAttemptCount}
          </span>
        </>
      );
    }
    return (
      <>
        <span className="platform-pill current-section-pill" aria-live="polite">
          当前 {activeWorkspaceLabel}
        </span>
        {isDesignWorkspace ? (
          <span className={`platform-pill platform-health-pill ${platformPillTone}`} title={platformReadiness?.nextSteps[0] || platformStateText}>
            {platformPillText}
          </span>
        ) : (
          <span className={`platform-pill queue-health-pill ${queueTopPillTone}`} title={queueStateText}>
            {queueStateText}
          </span>
        )}
        <span className={`platform-pill automation-pill ${automationStatus?.active ? "online" : "warning"}`} title={automationPillTitle}>
          {automationPillText}
        </span>
      </>
    );
  }

  function renderTopContextActions() {
    if (isWechatWorkspace) {
      return (
        <>
          <div className="toolbar-group context-toolbar view-context-toolbar wechat-workspace-toolbar" data-toolbar-scope="wechat-view">
            <button
              type="button"
              className={`ghost ${wechatWorkbenchView === "channels" ? "selected" : ""}`}
              aria-pressed={wechatWorkbenchView === "channels"}
              onClick={() => setWechatWorkbenchView("channels")}
              disabled={Boolean(busy)}
            >
              <Network size={16} aria-hidden="true" />通道
            </button>
            <button
              type="button"
              className={`ghost ${wechatWorkbenchView === "flow" ? "selected" : ""}`}
              aria-pressed={wechatWorkbenchView === "flow"}
              onClick={() => setWechatWorkbenchView("flow")}
              disabled={Boolean(busy)}
            >
              <Workflow size={16} aria-hidden="true" />客服图
            </button>
            <button
              type="button"
              className={`ghost ${wechatWorkbenchView === "config" ? "selected" : ""}`}
              aria-pressed={wechatWorkbenchView === "config"}
              onClick={() => setWechatWorkbenchView("config")}
              disabled={Boolean(busy)}
            >
              <Check size={16} aria-hidden="true" />配置
            </button>
          </div>
          <div className="toolbar-group context-toolbar command-context-toolbar wechat-workspace-toolbar" data-toolbar-scope="wechat-actions">
            <button type="button" className="ghost" onClick={refreshWechatWorkspaceStatus} disabled={Boolean(busy)}>
              <RefreshCw size={16} aria-hidden="true" />刷新通道
            </button>
            <button type="button" className="ghost" onClick={captureCurrentWindowOnce} disabled={Boolean(busy)}>
              <Search size={16} aria-hidden="true" />采集窗口
            </button>
            <button type="button" className="ghost" onClick={scanBridgeAcks} disabled={Boolean(busy)}>
              <ShieldCheck size={16} aria-hidden="true" />扫描回执
            </button>
            <button type="button" className="primary" onClick={processSafeQueue} disabled={Boolean(busy)}>
              <Send size={16} aria-hidden="true" />安全发送
            </button>
          </div>
        </>
      );
    }

    if (isSendWorkspace) {
      return (
        <div className="toolbar-group context-toolbar command-context-toolbar send-workspace-toolbar" data-toolbar-scope="send-actions">
          <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw size={16} aria-hidden="true" />刷新队列
          </button>
          <button type="button" className="ghost" onClick={scanSendOps} disabled={Boolean(busy)}>
            <ShieldAlert size={16} aria-hidden="true" />扫描异常
          </button>
          <button type="button" className="ghost" onClick={scanBridgeAcks} disabled={Boolean(busy)}>
            <ShieldCheck size={16} aria-hidden="true" />扫描回执
          </button>
          <button type="button" className="primary" onClick={processSafeQueue} disabled={Boolean(busy)}>
            <Send size={16} aria-hidden="true" />处理队列
          </button>
        </div>
      );
    }

    if (isCustomerMessageWorkspace) {
      return (
        <div className="toolbar-group context-toolbar command-context-toolbar message-workspace-toolbar" data-toolbar-scope="message-actions">
          <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw size={16} aria-hidden="true" />刷新消息
          </button>
          <button type="button" className="ghost" onClick={evaluateCustomerRoute} disabled={Boolean(busy)}>
            <Route size={16} aria-hidden="true" />路由决策
          </button>
          <button type="button" className="primary" onClick={processRouteInbound} disabled={Boolean(busy)}>
            <Bot size={16} aria-hidden="true" />处理消息
          </button>
        </div>
      );
    }

    if (activeWorkspaceSection === "quote-center") {
      return (
        <div className="toolbar-group context-toolbar command-context-toolbar quote-workspace-toolbar" data-toolbar-scope="quote-actions">
          <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw size={16} aria-hidden="true" />刷新报价
          </button>
          <button type="button" className="ghost" onClick={processSafeQueue} disabled={Boolean(busy)}>
            <Send size={16} aria-hidden="true" />处理发送
          </button>
          <button type="button" className="primary" onClick={progressQuoteDealFlow} disabled={Boolean(busy)}>
            <ClipboardList size={16} aria-hidden="true" />推进成交
          </button>
        </div>
      );
    }

    if (activeWorkspaceSection === "review-center") {
      return (
        <div className="toolbar-group context-toolbar command-context-toolbar review-workspace-toolbar" data-toolbar-scope="review-actions">
          <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw size={16} aria-hidden="true" />刷新审核
          </button>
          <button type="button" className="ghost" onClick={handoffHighValueJobs} disabled={Boolean(busy)}>
            <ShieldAlert size={16} aria-hidden="true" />高价值转人工
          </button>
          <button type="button" className="primary" onClick={processSafeQueue} disabled={Boolean(busy)}>
            <Send size={16} aria-hidden="true" />处理发送
          </button>
        </div>
      );
    }

    if (isDesignWorkspace) {
      return (
        <>
          <div className="toolbar-group context-toolbar command-context-toolbar design-platform-toolbar" data-toolbar-scope="design-platform">
            <button type="button" className="ghost" onClick={checkDesignPlatform} disabled={Boolean(busy)}>
              <RefreshCw size={16} aria-hidden="true" />检测平台
            </button>
            <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}>
              <RefreshCw size={16} aria-hidden="true" />刷新
            </button>
          </div>
          <div className="toolbar-group context-toolbar command-context-toolbar design-workspace-toolbar" data-toolbar-scope="design-actions">
            <button type="button" className="ghost" onClick={createDemo} disabled={Boolean(busy)}>
              <Boxes size={16} aria-hidden="true" />新建演示任务
            </button>
            <button type="button" className="ghost" onClick={preflightActiveJob} disabled={!activeJob || Boolean(busy)}>
              <ShieldCheck size={16} aria-hidden="true" />出图预检
            </button>
            <button type="button" className="primary" onClick={submitActiveJob} disabled={!activeJob || Boolean(busy)}>
              <Send size={16} aria-hidden="true" />提交出图
            </button>
          </div>
        </>
      );
    }

    return (
      <div className="toolbar-group context-toolbar command-context-toolbar default-workspace-toolbar" data-toolbar-scope="workspace-actions">
        <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}>
          <RefreshCw size={16} aria-hidden="true" />刷新
        </button>
        <button type="button" className="primary" onClick={runAutomationCycle} disabled={Boolean(busy)}>
          <Bot size={16} aria-hidden="true" />后台跑一轮
        </button>
      </div>
    );
  }

  return (
    <main className="shell apple-light-shell" aria-busy={Boolean(busy)} data-busy={busy ? "true" : "false"}>
      <aside className="rail" aria-label="工作台导航">
        <div className="brand" aria-hidden="true">
          <img src="/app-icon.svg" alt="" />
        </div>
        {workspaceNavItems.map((item) => {
          const Icon = item.Icon;
          return (
            <button
              aria-controls={item.id}
              aria-current={activeWorkspaceSection === item.id ? "page" : undefined}
              aria-label={item.label}
              className={activeWorkspaceSection === item.id ? "active" : ""}
              data-section-id={item.id}
              key={item.id}
              onClick={() => scrollToWorkspaceSection(item.id)}
              title={item.label}
              type="button"
            >
              <Icon size={20} aria-hidden="true" />
              <span className="rail-label">{item.label}</span>
            </button>
          );
        })}
      </aside>

      <section className="workspace" data-active-section={activeWorkspaceSection}>
        <header className="topbar">
          <span className="window-controls" aria-hidden="true">
            <span className="close" />
            <span className="minimize" />
            <span className="zoom" />
          </span>
          <div className="top-title">
            <h1>智能体客服工作台</h1>
            <p>微信客户设计需求、礼盒搭配、效果图审核和报价草稿</p>
          </div>
          <div className="top-actions">
            <div className="toolbar-group status-group">
              {renderTopStatusPills()}
            </div>
            <div className="toolbar-group conversation-toolbar">{renderConversationSelect()}</div>
            {renderTopContextActions()}
          </div>
        </header>
        <div className="status-line" data-busy={busy ? "true" : "false"} role="status" aria-live="polite">
          <span className="status-text">{busy ? `${busy}处理中` : message}</span>
        </div>
        <section className="apple-overview" aria-label="工作台系统总览">
          <div className="overview-title">
            <span className="overview-symbol" aria-hidden="true">
              <Bot size={22} />
            </span>
            <div>
              <strong>运营总览</strong>
              <span>出图、报价、发送、训练一屏推进。</span>
            </div>
          </div>
          <div className="overview-flow" role="list">
            <button type="button" role="listitem" onClick={() => scrollToWorkspaceSection("design-center")} aria-controls="design-center">
              <ImageIcon size={17} aria-hidden="true" />
              <span>设计流程</span>
              <strong>{activeJob ? statusLabel[activeJob.status] || activeJob.status : "待创建"}</strong>
            </button>
            <button type="button" role="listitem" onClick={() => scrollToWorkspaceSection("quote-center")} aria-controls="quote-center">
              <ReceiptText size={17} aria-hidden="true" />
              <span>报价成单</span>
              <strong>{activeQuote ? quoteStatusLabel(activeQuote.status) : `${quotes.length} 个草稿`}</strong>
            </button>
            <button type="button" role="listitem" onClick={() => scrollToWorkspaceSection("send-center")} aria-controls="send-center">
              <ShieldCheck size={17} aria-hidden="true" />
              <span>安全发送</span>
              <strong>{queueStateText}</strong>
            </button>
            <button type="button" role="listitem" onClick={() => scrollToWorkspaceSection("review-center")} aria-controls="review-center">
              <ShieldAlert size={17} aria-hidden="true" />
              <span>人工审核</span>
              <strong>{reviewStateText}</strong>
            </button>
            <button
              type="button"
              role="listitem"
              onClick={() => {
                setTrainingWorkbenchView("review");
                scrollToWorkspaceSection("training-center");
              }}
              aria-controls="training-center"
            >
              <Brain size={17} aria-hidden="true" />
              <span>训练进化</span>
              <strong>{trainingSampleTotalCount} 条样本</strong>
            </button>
          </div>
          <div className="overview-actions">
            <button type="button" className="primary" onClick={createDemo} disabled={Boolean(busy)}>
              <Boxes size={16} aria-hidden="true" />新建演示任务
            </button>
            <button type="button" className="ghost" onClick={runAutomationCycle} disabled={Boolean(busy)}>
              <Bot size={16} aria-hidden="true" />后台跑一轮
            </button>
            <button type="button" className="ghost" onClick={processSafeQueue} disabled={Boolean(busy)}>
              <Send size={16} aria-hidden="true" />处理发送队列
            </button>
          </div>
        </section>
        {isDesignWorkspace && platformReadiness && !platformReadiness.canSubmitFormalGeneration ? (
          <div className="readiness-banner warning">
            <ShieldAlert size={17} aria-hidden="true" />
            <strong>{designPlatformOperationGuide?.title || "真实出图暂不可提交"}</strong>
            <span>{designPlatformOperationGuide?.detail || platformReadiness.nextSteps[0] || "设计平台登录态或设备激活还没有通过。"}</span>
            <small>
              {designPlatformOperationGuide?.meta ? `${designPlatformOperationGuide.meta} · ` : ""}凭证{" "}
              {platformReadiness.config.hasAccessToken || platformReadiness.config.hasCookie ? "已配置" : "未配置"} · 设备ID{" "}
              {platformReadiness.config.hasDeviceId ? "已配置" : "未配置"}
            </small>
          </div>
        ) : null}
        {showStandaloneDesignPlatformGuide && designPlatformOperationGuide ? (
          <div className={`readiness-banner platform-mode-guide ${designPlatformOperationGuide.tone}`}>
            <Settings2 size={17} aria-hidden="true" />
            <strong>{designPlatformOperationGuide.title}</strong>
            <span>{designPlatformOperationGuide.detail}</span>
            <small>{designPlatformOperationGuide.meta}</small>
          </div>
        ) : null}

        <section className="design-platform-config" id="design-platform-config" aria-label="设计平台运行配置">
          <div className="config-summary">
            <div>
              <strong>设计平台运行配置</strong>
              <span title={platformConfig?.runtimeConfigPath || undefined}>
                {runtimeConfigDisplayName(platformConfig?.runtimeConfigPath)}
              </span>
            </div>
            <div className="config-status-grid" role="list" aria-label="设计平台凭证状态">
              <span role="listitem" className={platformConfig?.hasAccessToken ? "ready" : ""}>
                Token {platformConfig?.hasAccessToken ? "已配置" : "未配置"}
              </span>
              <span role="listitem" className={platformConfig?.hasCookie ? "ready" : ""}>
                Cookie {platformConfig?.hasCookie ? "已配置" : "未配置"}
              </span>
              <span role="listitem" className={platformConfig?.hasDeviceId ? "ready" : ""}>
                设备 {platformConfig?.hasDeviceId ? `已绑定${platformConfig.deviceIdSuffix ? ` · ${platformConfig.deviceIdSuffix}` : ""}` : "未绑定"}
              </span>
              <span role="listitem" className={platformConfig?.hasCallbackApiKey ? "ready" : ""}>
                回调签名 {platformConfig?.hasCallbackApiKey ? "已配置" : "未配置"}
              </span>
            </div>
            {platformConfig?.callbackUrl ? (
              <div className="config-callback-endpoint">
                <strong>出图完成回调地址</strong>
                <code>{platformConfig.callbackUrl}</code>
                <span>真实设计平台完成或失败后 POST 到这里；轮询仍会继续兜底。</span>
              </div>
            ) : null}
            {designPlatformOperationGuide ? (
              <div className={`config-mode-guide ${designPlatformOperationGuide.tone}`}>
                <strong>{designPlatformOperationGuide.title}</strong>
                <span>{designPlatformOperationGuide.detail}</span>
              </div>
            ) : null}
            {platformSmokeTest ? (
              <div className={`platform-smoke-result ${platformSmokeTest.ok ? "ok" : "error"}`} aria-label="设计平台试跑结果">
                <strong>{platformSmokeTest.ok ? "试跑出图通过" : "试跑出图失败"}</strong>
                <span>
                  {designPlatformAdapterLabel(platformSmokeTest.adapter)} · {platformSmokeTest.latencyMs}ms · 素材{" "}
                  {platformSmokeTest.assetUploadCount} · 候选图 {platformSmokeTest.candidateCount}/
                  {platformSmokeTest.expectedCandidateCount || 1} · 已保存 {platformSmokeTest.savedImageCount}
                </span>
                {platformSmokeTest.externalJobId ? <small>任务 {platformSmokeTest.externalJobId}</small> : null}
                {platformSmokeTest.errorMessage ? <small>{platformSmokeTest.errorMessage}</small> : null}
                {(platformSmokeTest.savedImagePreviews || []).length ? (
                  <div className="platform-smoke-gallery" aria-label="试跑生成图预览">
                    {(platformSmokeTest.savedImagePreviews || []).slice(0, 3).map((preview, index) => (
                      <figure key={`${preview.imageId}-${index}`}>
                        <SafeImagePreview
                          src={preview.dataUrl}
                          alt={`试跑候选图 ${index + 1}`}
                          fallbackLabel="预览不可用"
                          iconSize={18}
                        />
                        <figcaption>{index + 1}号</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                <div className="platform-smoke-steps" role="list">
                  {platformSmokeTest.steps.map((step) => (
                    <span key={step.key} className={step.ok ? "ok" : "error"} role="listitem" title={step.detail || step.label}>
                      {step.label}
                    </span>
                  ))}
                </div>
                {platformSmokeTest.contractChecks?.length ? (
                  <div className="platform-smoke-contract" role="list" aria-label="设计平台接口契约检查">
                    {platformSmokeTest.contractChecks.map((check) => (
                      <span key={check.key} className={check.ok ? "ok" : "error"} role="listitem" title={check.detail || check.label}>
                        <b>{check.label}</b>
                        <small>{check.detail || `${check.actual ?? "-"} / ${check.expected ?? "-"}`}</small>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="config-form-grid">
            <div className="field-control field-control-inline">
              <span>适配器</span>
              <div className="segmented-control adapter-segment" role="group" aria-label="设计平台适配器">
                {[
                  { value: "art_image_local" as const, label: "真实平台" },
                  { value: "standard_v1" as const, label: "标准接口" },
                ].map((option) => (
                  <button
                    aria-pressed={platformConfigForm.adapter === option.value}
                    className={platformConfigForm.adapter === option.value ? "selected" : ""}
                    disabled={Boolean(busy)}
                    key={option.value}
                    onClick={() =>
                      setPlatformConfigForm((current) => ({
                        ...current,
                        adapter: option.value,
                        baseUrl: shouldUseDesignPlatformDefaultBaseUrl(current.baseUrl)
                          ? designPlatformDefaultBaseUrl(option.value)
                          : current.baseUrl,
                      }))
                    }
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-control">
              <span>Base URL</span>
              <input
                autoComplete="off"
                value={platformConfigForm.baseUrl}
                onChange={(event) => setPlatformConfigForm({ ...platformConfigForm, baseUrl: event.target.value })}
                placeholder={designPlatformDefaultBaseUrl(platformConfigForm.adapter)}
              />
            </label>
            <label className="field-control">
              <span>Access Token</span>
              <input
                autoComplete="off"
                type="password"
                value={platformConfigForm.accessToken}
                onChange={(event) => setPlatformConfigForm({ ...platformConfigForm, accessToken: event.target.value })}
                placeholder="留空保持当前 Token"
              />
            </label>
            <label className="field-control">
              <span>Cookie</span>
              <input
                autoComplete="off"
                type="password"
                value={platformConfigForm.cookie}
                onChange={(event) => setPlatformConfigForm({ ...platformConfigForm, cookie: event.target.value })}
                placeholder="留空保持当前 Cookie"
              />
            </label>
            <label className="field-control">
              <span>设备 ID</span>
              <input
                autoComplete="off"
                value={platformConfigForm.deviceId}
                onChange={(event) => setPlatformConfigForm({ ...platformConfigForm, deviceId: event.target.value })}
                placeholder={platformConfig?.deviceIdSuffix ? `留空保持当前 · ${platformConfig.deviceIdSuffix}` : "留空保持当前设备"}
              />
            </label>
            <div className="config-actions">
              <button type="button" className="primary" onClick={saveDesignPlatformConfig} disabled={Boolean(busy)}>
                <Save size={16} aria-hidden="true" />保存配置
              </button>
              <button type="button" className="ghost" onClick={generateDesignPlatformDeviceId} disabled={Boolean(busy)}>
                <RefreshCw size={16} aria-hidden="true" />生成设备 ID
              </button>
              <button type="button" className="ghost" onClick={smokeTestDesignPlatform} disabled={Boolean(busy)}>
                <ImageIcon size={16} aria-hidden="true" />试跑出图
              </button>
              <button type="button" className="ghost danger" onClick={clearDesignPlatformCredentials} disabled={Boolean(busy)}>
                <Ban size={16} aria-hidden="true" />清空凭证
              </button>
            </div>
            <div className="config-activation-panel" aria-label="设计平台设备激活">
              <label className="field-control">
                <span>激活码</span>
                <input
                  autoComplete="one-time-code"
                  value={platformActivationForm.code}
                  onChange={(event) => setPlatformActivationForm({ ...platformActivationForm, code: event.target.value })}
                  placeholder="设计平台后台生成的激活码"
                />
              </label>
              <label className="field-control">
                <span>激活设备 ID</span>
                <input
                  autoComplete="off"
                  value={platformActivationForm.deviceId}
                  onChange={(event) => setPlatformActivationForm({ ...platformActivationForm, deviceId: event.target.value })}
                  placeholder={platformConfig?.hasDeviceId ? "留空使用已保存设备" : "先生成或粘贴设备 ID"}
                />
              </label>
              <label className="field-control">
                <span>设备名称</span>
                <input
                  autoComplete="off"
                  value={platformActivationForm.deviceLabel}
                  onChange={(event) => setPlatformActivationForm({ ...platformActivationForm, deviceLabel: event.target.value })}
                  placeholder="智能客服工作台"
                />
              </label>
              <button type="button" className="primary" onClick={redeemDesignPlatformDevice} disabled={Boolean(busy)}>
                <ShieldCheck size={16} aria-hidden="true" />激活设备
              </button>
            </div>
            <div className="config-login-panel" aria-label="设计平台账号登录">
              <label className="field-control">
                <span>登录邮箱</span>
                <input
                  autoComplete="username"
                  inputMode="email"
                  value={platformLoginForm.email}
                  onChange={(event) => setPlatformLoginForm({ ...platformLoginForm, email: event.target.value })}
                  placeholder="设计平台账号邮箱"
                />
              </label>
              <label className="field-control">
                <span>登录密码</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={platformLoginForm.password}
                  onChange={(event) => setPlatformLoginForm({ ...platformLoginForm, password: event.target.value })}
                  placeholder="只用于本次登录"
                />
              </label>
              <label className="field-control">
                <span>登录设备 ID</span>
                <input
                  autoComplete="off"
                  value={platformLoginForm.deviceId}
                  onChange={(event) => setPlatformLoginForm({ ...platformLoginForm, deviceId: event.target.value })}
                  placeholder={platformConfig?.hasDeviceId ? "留空使用已保存设备" : "已激活的设计平台设备 ID"}
                />
              </label>
              <button type="button" className="primary" onClick={loginDesignPlatformAccount} disabled={Boolean(busy)}>
                <LockKeyhole size={16} aria-hidden="true" />登录并保存
              </button>
            </div>
          </div>
        </section>

        <nav className="dock-strip" aria-label="工作台状态概览">
          <button
            aria-controls="design-center"
            aria-current={activeWorkspaceSection === "design-center" ? "page" : undefined}
            className={`dock-item ${activeWorkspaceSection === "design-center" ? "active" : ""}`}
            onClick={() => scrollToWorkspaceSection("design-center")}
            title="跳转到设计中心"
            type="button"
          >
            <ImageIcon size={18} aria-hidden="true" />
            <span>设计</span>
            <strong>{pendingCount}</strong>
          </button>
          <button
            aria-controls="sku-library"
            aria-current={activeWorkspaceSection === "sku-library" ? "page" : undefined}
            className={`dock-item ${activeWorkspaceSection === "sku-library" ? "active" : ""}`}
            onClick={() => scrollToWorkspaceSection("sku-library")}
            title="跳转到商品库"
            type="button"
          >
            <Store size={18} aria-hidden="true" />
            <span>商品</span>
            <strong>{visibleSkus.length}</strong>
          </button>
          <button
            aria-controls="training-center"
            aria-current={activeWorkspaceSection === "training-center" ? "page" : undefined}
            className={`dock-item ${activeWorkspaceSection === "training-center" ? "active" : ""}`}
            onClick={() => {
              setTrainingWorkbenchView("review");
              scrollToWorkspaceSection("training-center");
            }}
            title="跳转到训练中心"
            type="button"
          >
            <Brain size={18} aria-hidden="true" />
            <span>训练</span>
            <strong>{trainingSampleTotalCount}</strong>
          </button>
          <button
            aria-controls="send-center"
            aria-current={activeWorkspaceSection === "send-center" ? "page" : undefined}
            className={`dock-item warning ${activeWorkspaceSection === "send-center" ? "active" : ""}`}
            onClick={() => scrollToWorkspaceSection("send-center")}
            title="跳转到发送安全队列"
            type="button"
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <span>发送</span>
            <strong>{blockedSendCount}</strong>
          </button>
          <button
            aria-controls="quote-center"
            aria-current={activeWorkspaceSection === "quote-center" ? "page" : undefined}
            className={`dock-item ${activeWorkspaceSection === "quote-center" ? "active" : ""}`}
            onClick={() => scrollToWorkspaceSection("quote-center")}
            title="跳转到报价/订单草稿"
            type="button"
          >
            <ReceiptText size={18} aria-hidden="true" />
            <span>报价</span>
            <strong>{quotes.length}</strong>
          </button>
        </nav>

        <section className="metrics">
          <Metric
            icon={<ImageIcon size={22} aria-hidden="true" />}
            label="待处理设计"
            value={pendingCount}
            tone="red"
            ariaControls="design-center"
            onClick={() => scrollToWorkspaceSection("design-center")}
          />
          <Metric
            icon={<ShieldAlert size={22} aria-hidden="true" />}
            label="高价值人工"
            value={highValueCount}
            tone="amber"
            ariaControls="review-center"
            onClick={() => scrollToWorkspaceSection("review-center")}
          />
          <Metric
            icon={<Boxes size={22} aria-hidden="true" />}
            label="SKU总数"
            value={skus.length}
            tone="blue"
            ariaControls="sku-library"
            onClick={() => scrollToWorkspaceSection("sku-library")}
          />
          <Metric
            icon={<PackageSearch size={22} aria-hidden="true" />}
            label="低库存提醒"
            value={stockWarning}
            tone="green"
            ariaControls="sku-library"
            onClick={() => {
              setSkuIssueFilter("low_stock");
              scrollToWorkspaceSection("sku-library");
            }}
          />
          <Metric
            icon={<AlertTriangle size={22} aria-hidden="true" />}
            label="商品资料问题"
            value={catalogAudit?.issueCount || 0}
            tone="amber"
            ariaControls="sku-library"
            onClick={() => {
              setSkuIssueFilter("problem");
              scrollToWorkspaceSection("sku-library");
            }}
          />
          <Metric
            icon={<Bell size={22} aria-hidden="true" />}
            label="未读提醒"
            value={unreadNoticeCount}
            tone="red"
            ariaControls="notice-center"
            onClick={() => scrollToWorkspaceSection("notice-center")}
          />
        </section>

        <section className="asset-grid">
          <section className="panel" id="asset-center">
            <div className="panel-head">
              <div>
                <h2><FileUp size={17} aria-hidden="true" />客户素材</h2>
                <span>Logo、参考图、产品图先进入素材库，再绑定到设计任务</span>
              </div>
              <div className="asset-actions">
                <button type="button" className="ghost" onClick={createLogoAsset} disabled={Boolean(busy)}>
                  <ImageIcon size={16} aria-hidden="true" />演示Logo
                </button>
                <label className="ghost file-button">
                  <FileUp size={16} aria-hidden="true" />上传素材
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      uploadCustomerAsset(file);
                    }}
                  />
                </label>
                <button type="button" className="primary" onClick={attachAssetsToActiveJob} disabled={!activeJob || !selectedAssetIds.length || Boolean(busy)}>
                  <Layers size={16} aria-hidden="true" />绑定当前任务
                </button>
              </div>
            </div>
            <div className="asset-list">
              {designAssets.length ? (
                designAssets.slice(0, 8).map((asset) => (
                  <button
                    aria-pressed={selectedAssetIds.includes(asset.id)}
                    className={`asset-row ${selectedAssetIds.includes(asset.id) ? "selected" : ""}`}
                    key={asset.id}
                    onClick={() => toggleAsset(asset.id)}
                    disabled={Boolean(busy)}
                    type="button"
                  >
                    <span>{asset.mimeType?.startsWith("image/") ? <ImageIcon size={18} aria-hidden="true" /> : <FileUp size={18} aria-hidden="true" />}</span>
                    <div>
                      <strong>{asset.fileName}</strong>
                      <small>{asset.role || "reference"} · {Math.ceil(Number(asset.sizeBytes || 0) / 1024)} KB</small>
                    </div>
                    <em>{selectedAssetIds.includes(asset.id) ? "已选择" : "选择"}</em>
                  </button>
                ))
              ) : (
                <div className="empty empty-cta" role="status">
                  <strong>还没有客户素材</strong>
                  <span>先生成演示 Logo 或上传本机图片，随后可绑定到当前设计任务。</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={createLogoAsset} disabled={Boolean(busy)}>
                      <ImageIcon size={16} aria-hidden="true" />生成演示 Logo
                    </button>
                    <label className="ghost file-button">
                      <FileUp size={16} aria-hidden="true" />上传素材
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          uploadCustomerAsset(file);
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </section>
        </section>

        <section className="wechat-channel-grid">
          <section className={`panel wechat-channel-panel wechat-mode-${wechatWorkbenchView}`} id="wechat-channel-center">
            <div className="panel-head">
              <div>
                <h2><Network size={17} aria-hidden="true" />微信接入中心</h2>
                <span>个人微信、企业微信、小程序分区接入，统一进入智能客服管线</span>
              </div>
              <div className="segmented-control wechat-view-switcher" role="tablist" aria-label="微信接入中心视图">
                <button
                  type="button"
                  className={wechatWorkbenchView === "channels" ? "selected" : ""}
                  aria-pressed={wechatWorkbenchView === "channels"}
                  onClick={() => setWechatWorkbenchView("channels")}
                >
                  接入通道
                </button>
                <button
                  type="button"
                  className={wechatWorkbenchView === "flow" ? "selected" : ""}
                  aria-pressed={wechatWorkbenchView === "flow"}
                  onClick={() => setWechatWorkbenchView("flow")}
                >
                  可视化客服
                </button>
                <button
                  type="button"
                  className={wechatWorkbenchView === "config" ? "selected" : ""}
                  aria-pressed={wechatWorkbenchView === "config"}
                  onClick={() => setWechatWorkbenchView("config")}
                >
                  配置检查
                </button>
              </div>
              <div className="panel-actions">
                <button type="button" className="ghost compact-button" onClick={() => void loadWechatChannelStatusOnly()} disabled={Boolean(busy)}>
                  <RefreshCw size={14} aria-hidden="true" />刷新状态
                </button>
              </div>
            </div>
            <div className="wechat-channel-panel-body">
              <div className="wechat-channel-summary">
                <div>
                  <strong>{wechatChannelStatus ? `${wechatChannelStatus.summary.ready}/${wechatChannelStatus.summary.total}` : "0/3"}</strong>
                  <span>通道就绪</span>
                </div>
                <div>
                  <strong>{wechatChannelStatus?.summary.pendingSendTasks ?? pendingSendTaskCount}</strong>
                  <span>待安全发送</span>
                </div>
                <div>
                  <strong>{wechatChannelStatus?.summary.needsSendAdapter ?? wechatSendAdapterIssueChannels.length}</strong>
                  <span>待发送器</span>
                </div>
                <div>
                  <strong>{wechatChannelStatus?.summary.manualLockedConversations ?? manualLockedConversations.length}</strong>
                  <span>人工接管</span>
                </div>
                <div>
                  <strong>{wechatChannelStatus?.summary.needsConfig ?? 0}</strong>
                  <span>待配置</span>
                </div>
              </div>
              {wechatWorkbenchView === "channels" ? (
                <div className="wechat-channel-list" aria-label="微信通道列表">
                  {wechatChannelStatus?.channels.length ? (
                    wechatChannelStatus.channels.map((channel) => (
                      <article className={`wechat-channel-card ${channel.status}`} key={channel.key}>
                        <div className="wechat-channel-card-head">
                          <span aria-hidden="true">
                            {channel.key === "work_wechat" ? (
                              <Building2 size={18} />
                            ) : channel.key === "mini_program" ? (
                              <Smartphone size={18} />
                            ) : (
                              <Monitor size={18} />
                            )}
                          </span>
                          <div>
                            <strong>{channel.label}</strong>
                            <small>{wechatChannelKindLabel(channel.kind)}</small>
                          </div>
                          <em>{wechatChannelStatusLabel(channel.status)}</em>
                        </div>
                        <p>{channel.description}</p>
                        <div className={`wechat-channel-next-step ${channel.status}`}>
                          <strong>{wechatChannelStatusLabel(channel.status)}</strong>
                          <span>{wechatChannelNextStep(channel)}</span>
                        </div>
                        <div className="wechat-channel-metrics" aria-label={`${channel.label}指标`}>
                          {Object.entries(channel.metrics).slice(0, 4).map(([key, value]) => (
                            <span key={key}>
                              <b>{value}</b>
                              <small>{wechatChannelMetricLabel(key)}</small>
                            </span>
                          ))}
                        </div>
                        <div className="wechat-channel-actions" aria-label={`${channel.label}操作矩阵`}>
                          {channel.key === "personal_wechat" ? (
                            <>
                              <div className="wechat-action-group">
                                <small>采集</small>
                                <div className="wechat-action-buttons">
                                  <button type="button" className="ghost" onClick={captureCurrentWindowOnce} disabled={Boolean(busy)}>
                                    <Search size={15} aria-hidden="true" />采集窗口
                                  </button>
                                  <button type="button" className="ghost" onClick={scanRealWindowSnapshots} disabled={Boolean(busy)}>
                                    <RefreshCw size={15} aria-hidden="true" />扫描快照
                                  </button>
                                </div>
                              </div>
                              <div className="wechat-action-group">
                                <small>发送</small>
                                <div className="wechat-action-buttons">
                                  <button type="button" className="primary" onClick={processSafeQueue} disabled={Boolean(busy)}>
                                    <ShieldCheck size={15} aria-hidden="true" />处理队列
                                  </button>
                                </div>
                              </div>
                              <div className="wechat-action-group">
                                <small>配置</small>
                                <div className="wechat-action-buttons">
                                  <button type="button" className="ghost" onClick={() => setWechatWorkbenchView("config")} disabled={Boolean(busy)}>
                                    <Check size={15} aria-hidden="true" />配置检查
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="wechat-action-group">
                                <small>演练</small>
                                <div className="wechat-action-buttons">
                                  <button type="button" className="primary" onClick={() => runWechatChannelInbound(channel.key)} disabled={Boolean(busy)}>
                                    <MessageCircle size={15} aria-hidden="true" />入站演练
                                  </button>
                                </div>
                              </div>
                              <div className="wechat-action-group">
                                <small>路由</small>
                                <div className="wechat-action-buttons">
                                  <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("routing-center")} disabled={Boolean(busy)}>
                                    <Route size={15} aria-hidden="true" />查看路由
                                  </button>
                                </div>
                              </div>
                              <div className="wechat-action-group">
                                <small>{channel.status === "needs_config" ? "配置" : "发送"}</small>
                                <div className="wechat-action-buttons">
                                  {channel.status === "needs_config" ? (
                                    <button type="button" className="ghost" onClick={() => setWechatWorkbenchView("config")} disabled={Boolean(busy)}>
                                      <Check size={15} aria-hidden="true" />配置检查
                                    </button>
                                  ) : (
                                    <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("send-center")} disabled={Boolean(busy)}>
                                      <Send size={15} aria-hidden="true" />发送队列
                                    </button>
                                  )}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty empty-cta" role="status">
                      <strong>微信通道状态暂不可用</strong>
                      <span>刷新后会读取后端真实通道状态；接入状态不再由前端静态假设。</span>
                      <div className="empty-actions">
                        <button type="button" className="primary" onClick={() => void loadWechatChannelStatusOnly()} disabled={Boolean(busy)}>
                          <RefreshCw size={16} aria-hidden="true" />刷新状态
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {wechatWorkbenchView === "flow" ? (
                <div className="wechat-visual-panel" aria-label="可视化智能客服流程">
                  <div className="wechat-visual-head">
                    <span aria-hidden="true"><Workflow size={18} /></span>
                    <div>
                      <strong>可视化智能客服</strong>
                      <small>接入、路由、设计报价、人工审核、安全发送一条链</small>
                    </div>
                    <div className="wechat-visual-readiness" aria-label="通道运行摘要">
                      <span><strong>{wechatChannelStatus?.summary.ready ?? 0}</strong> 已就绪</span>
                      <span><strong>{wechatRuntimeIssueChannels.length}</strong> 待运行</span>
                      <span><strong>{wechatChannelStatus?.summary.needsSendAdapter ?? wechatSendAdapterIssueChannels.length}</strong> 待发送器</span>
                      <span><strong>{wechatConfigIssueChannels.length}</strong> 待配置</span>
                    </div>
                  </div>
                  <div className="wechat-service-canvas">
                    <div className="wechat-intake-lane" aria-label="接入通道">
                      <div className="wechat-lane-title">
                        <Network size={15} aria-hidden="true" />
                        <div>
                          <strong>接入通道</strong>
                          <span>消息先统一进入入站管线</span>
                        </div>
                      </div>
                      <div className="wechat-lane-card-list">
                        {wechatChannels.length ? (
                          wechatChannels.map((channel) => (
                            <button
                              type="button"
                              className={`wechat-lane-card ${channel.status}`}
                              key={channel.key}
                              onClick={() => setWechatWorkbenchView(["needs_config", "needs_send_adapter"].includes(channel.status) ? "config" : "channels")}
                              disabled={Boolean(busy)}
                              aria-label={`${channel.label}：${wechatChannelStatusLabel(channel.status)}`}
                            >
                              <span aria-hidden="true">
                                {channel.key === "work_wechat" ? (
                                  <Building2 size={16} />
                                ) : channel.key === "mini_program" ? (
                                  <Smartphone size={16} />
                                ) : (
                                  <Monitor size={16} />
                                )}
                              </span>
                              <strong>{channel.label}</strong>
                              <small>{wechatChannelStatusLabel(channel.status)}</small>
                            </button>
                          ))
                        ) : (
                          <div className="wechat-lane-empty">等待后端通道状态</div>
                        )}
                      </div>
                      <div className="wechat-visual-action-strip" aria-label="接入通道操作分组">
                        <div className="wechat-visual-action-group" aria-label="个人微信采集">
                          <small>个人微信采集</small>
                          <div className="wechat-visual-action-buttons">
                            <button type="button" className="ghost" onClick={captureCurrentWindowOnce} disabled={Boolean(busy)}>
                              <Search size={14} aria-hidden="true" />采集微信
                            </button>
                            <button type="button" className="ghost" onClick={scanRealWindowSnapshots} disabled={Boolean(busy)}>
                              <RefreshCw size={14} aria-hidden="true" />扫描快照
                            </button>
                          </div>
                        </div>
                        <div className="wechat-visual-action-group" aria-label="通道配置">
                          <small>通道配置</small>
                          <div className="wechat-visual-action-buttons">
                            <button type="button" className="ghost" onClick={() => setWechatWorkbenchView("config")} disabled={Boolean(busy)}>
                              <Check size={14} aria-hidden="true" />配置检查
                            </button>
                            <button type="button" className="ghost" onClick={() => void loadWechatChannelStatusOnly()} disabled={Boolean(busy)}>
                              <RefreshCw size={14} aria-hidden="true" />刷新状态
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="wechat-flow-lane" aria-label="智能客服处理链路">
                      <div className="wechat-lane-title">
                        <Bot size={15} aria-hidden="true" />
                        <div>
                          <strong>客服处理链路</strong>
                          <span>路由、设计、报价、审核和发送分步推进</span>
                        </div>
                      </div>
                      <div className="wechat-flow">
                        {wechatVisualFlowSteps.map((step, index) => (
                          <button
                            className="wechat-flow-step"
                            key={step.key}
                            type="button"
                            onClick={() => {
                              if (step.key === "route") scrollToWorkspaceSection("routing-center");
                              else if (step.key === "design") scrollToWorkspaceSection("design-center");
                              else if (step.key === "review") scrollToWorkspaceSection("review-center");
                              else if (step.key === "safe_send") scrollToWorkspaceSection("send-center");
                              else scrollToWorkspaceSection("conversation-center");
                            }}
                            disabled={Boolean(busy)}
                          >
                            <i>{index + 1}</i>
                            <div>
                              <strong>{step.label}</strong>
                              <span>{step.detail}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="wechat-live-lane" aria-label="当前客服现场">
                      <div className="wechat-lane-title">
                        <MessageCircle size={15} aria-hidden="true" />
                        <div>
                          <strong>当前客服现场</strong>
                          <span>{activeConversation ? activeWechatChannelName : "选择会话后显示实时链路"}</span>
                        </div>
                      </div>
                      <div className="wechat-agent-live">
                        <div>
                          <span>当前会话</span>
                          <strong>{activeConversation?.title || "未选择客户"}</strong>
                        </div>
                        <div>
                          <span>匹配 Agent</span>
                          <strong>{activeConversationRoute ? `${agentNameByKey(agents, activeConversationRoute.agentKey)} · ${readableScene(activeConversationRoute.scene, "未识别")}` : "暂无路由"}</strong>
                        </div>
                        <div>
                          <span>设计/发送负载</span>
                          <strong>{activeConversationDesignJobCount} 个设计任务 · {activeConversationSendTaskCount} 个发送任务</strong>
                        </div>
                        <div>
                          <span>处理摘要</span>
                          <strong>{inboundSummary || "等待客户消息进入"}</strong>
                        </div>
                      </div>
                      <div className="wechat-live-action-card" aria-label="当前客服推荐动作">
                        <span>当前建议</span>
                        <strong>{activeConversation ? (activeConversationRoute ? "核对当前客服现场" : "先处理客户消息") : "先选择客户会话"}</strong>
                        <p>
                          {activeConversation
                            ? activeConversationRoute
                              ? "已匹配客服路由，继续核对设计、报价、人工接管和发送队列。"
                              : "不会默认处理第一个客户，请在当前会话上执行消息处理。"
                            : "从消息中心选定客户后，这里会显示实时路由和下一步动作。"}
                        </p>
                        <div className="wechat-live-action-groups" aria-label="当前客服动作分组">
                          <div className="wechat-live-action-group primary-action" aria-label="会话处理">
                            <small>会话处理</small>
                            <button
                              type="button"
                              className="primary"
                              onClick={activeConversation ? processRouteInbound : () => scrollToWorkspaceSection("conversation-center")}
                              disabled={Boolean(busy)}
                            >
                              {activeConversation ? <Bot size={15} aria-hidden="true" /> : <MessageCircle size={15} aria-hidden="true" />}
                              {activeConversation ? "处理当前消息" : "选择会话"}
                            </button>
                          </div>
                          <div className="wechat-live-action-group" aria-label="审核发送">
                            <small>审核发送</small>
                            <div className="wechat-live-secondary-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setReviewWorkbenchView("handoff");
                                  scrollToWorkspaceSection("review-center");
                                }}
                                disabled={Boolean(busy)}
                              >
                                <ShieldAlert size={15} aria-hidden="true" />人工接管
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setSendWorkbenchView("queue");
                                  scrollToWorkspaceSection("send-center");
                                }}
                                disabled={Boolean(busy)}
                              >
                                <Send size={15} aria-hidden="true" />发送队列
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {wechatWorkbenchView === "config" ? (
                <div className="wechat-config-list" aria-label="微信通道配置检查">
                  {wechatChannelStatus?.channels.length ? (
                    wechatChannelStatus.channels.map((channel) => (
                      <article className={`wechat-config-card ${channel.status}`} key={channel.key}>
                        <div className="wechat-channel-card-head">
                          <span aria-hidden="true">
                            {channel.key === "work_wechat" ? (
                              <Building2 size={18} />
                            ) : channel.key === "mini_program" ? (
                              <Smartphone size={18} />
                            ) : (
                              <Monitor size={18} />
                            )}
                          </span>
                          <div>
                            <strong>{channel.label}</strong>
                            <small>{wechatChannelKindLabel(channel.kind)}</small>
                          </div>
                          <em>{wechatChannelStatusLabel(channel.status)}</em>
                        </div>
                        <div className="wechat-config-sections" aria-label={`${channel.label}真实接入配置分区`}>
                          <section className="wechat-config-section" aria-label={`${channel.label}检查结果`}>
                            <div className="wechat-config-section-head">
                              <strong>检查结果</strong>
                              <small>只展示后端读取到的运行、凭证和发送器状态</small>
                            </div>
                            <div className="wechat-channel-checks" aria-label={`${channel.label}检查项`}>
                              {channel.checks.map((check) => (
                                <span className={check.passed ? "ok" : "warn"} key={check.key} title={check.detail || check.label}>
                                  {check.passed ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                                  <strong>{check.label}</strong>
                                  <small>{check.detail}</small>
                                </span>
                              ))}
                            </div>
                          </section>
                          <section className="wechat-config-section" aria-label={`${channel.label}落地配置`}>
                            <div className="wechat-config-section-head">
                              <strong>落地配置</strong>
                              <small>按当前通道类型补齐真实接入条件</small>
                            </div>
                            <div className="wechat-config-runbook" aria-label={`${channel.label}下一步配置`}>
                              <strong>{wechatChannelNextStep(channel)}</strong>
                              {wechatChannelSetupRows(channel).map((row) => (
                                <span className={row.done ? "done" : "todo"} key={row.key}>
                                  <small>{row.label}</small>
                                  <code>{row.key}</code>
                                </span>
                              ))}
                            </div>
                          </section>
                          <section className="wechat-config-section" aria-label={`${channel.label}真实入口`}>
                            <div className="wechat-config-section-head">
                              <strong>真实入口</strong>
                              <small>复用现有后端入口和本机桥接脚本，不新增假接口</small>
                            </div>
                            <div className="wechat-config-entrypoints" aria-label={`${channel.label}真实接入入口`}>
                              {Object.entries(channel.entrypoints).map(([key, value]) => (
                                <span key={key}>
                                  <small>{wechatChannelMetricLabel(key)}</small>
                                  <code>{String(value)}</code>
                                </span>
                              ))}
                            </div>
                          </section>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty empty-cta" role="status">
                      <strong>还没有通道配置状态</strong>
                      <span>刷新后会读取个人微信、企业微信和小程序的真实后端配置检查结果。</span>
                      <div className="empty-actions">
                        <button type="button" className="primary" onClick={() => void loadWechatChannelStatusOnly()} disabled={Boolean(busy)}>
                          <RefreshCw size={16} aria-hidden="true" />刷新状态
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </section>

        <section className="main-grid">
          <section className="panel conversation-panel" id="conversation-center">
            <div className="panel-head">
              <div>
                <h2><MessageCircle size={17} aria-hidden="true" />聊天侧栏</h2>
                <span>{activeJob?.conversation?.title || "未选择会话"}</span>
              </div>
              {activeJob && isHighValueDesignJob(activeJob) ? <strong className="tag danger">高价值</strong> : <strong className="tag">低预算快审</strong>}
            </div>

            {activeJob ? (
              <div className="chat-detail">
                <div className="customer-row">
                  <div>
                    <span>客户</span>
                    <strong>{activeJob.customer?.name || "未命名客户"}</strong>
                  </div>
                  <div>
                    <span>场景</span>
                    <strong>{readableScene(activeJob.scene, "未填写")}</strong>
                  </div>
                </div>
                <div className="budget-box">
                  <span>预算</span>
                  <strong>
                    {activeJob.budget.perUnitAmount ? `${activeJob.budget.perUnitAmount} 元/份` : "-"}
                    {activeJob.budget.quantity ? ` x ${activeJob.budget.quantity} 份` : ""}
                  </strong>
                  <small>总额 {activeJob.budget.totalAmount || "-"} 元</small>
                </div>
                <div className="conversation-service-console" aria-label="智能客服消息处理台">
                  <div className="conversation-service-list">
                    <div className="conversation-service-title">
                      <strong>客户会话</strong>
                      <span>{conversations.length} 个会话</span>
                    </div>
                    <div className="conversation-service-items">
                      {conversations.length ? conversations.map((conversation) => {
                        const lockedTaskCount = manualLockBlockedSendCountByConversationId.get(conversation.id) || 0;
                        const conversationTaskCount = sendTasks.filter((task) => task.conversationId === conversation.id && !["sent", "cancelled"].includes(task.status)).length;
                        return (
                          <button
                            aria-pressed={activeConversationId === conversation.id}
                            className={activeConversationId === conversation.id ? "selected" : ""}
                            disabled={Boolean(busy)}
                            key={conversation.id}
                            onClick={() => void changeActiveConversation(conversation.id)}
                            type="button"
                          >
                            <span>
                              <strong>{conversation.title}</strong>
                              <small>{conversation.wechatAccount?.displayName || conversation.wechatAccountId}</small>
                            </span>
                            <em className={conversation.manualLocked ? "danger" : "ok"}>
                              {conversation.manualLocked ? "人工" : "自动"}
                            </em>
                            {conversationTaskCount || lockedTaskCount ? (
                              <mark>{lockedTaskCount ? `拦截 ${lockedTaskCount}` : `待发 ${conversationTaskCount}`}</mark>
                            ) : null}
                          </button>
                        );
                      }) : (
                        <div className="conversation-service-empty" role="status">
                          <strong>还没有会话</strong>
                          <span>接入微信通道后，客户会话会出现在这里。</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="conversation-service-detail">
                    <div className="conversation-service-status">
                      <div>
                        <span>当前客户</span>
                        <strong>{activeConversation?.customer?.name || activeJob.customer?.name || "未选择"}</strong>
                        <small>{activeConversation?.title || activeJob.conversation?.title || "先选择客户会话"}</small>
                      </div>
                      <div>
                        <span>微信账号</span>
                        <strong>{activeConversation?.wechatAccount?.displayName || activeConversation?.wechatAccountId || "未绑定"}</strong>
                        <small>{activeConversation?.channel || "wechat"}</small>
                      </div>
                      <div>
                        <span>处理状态</span>
                        <strong>{activeConversation?.manualLocked ? "人工接管" : "自动路由"}</strong>
                        <small>{activeConversationSendTaskCount} 个发送任务 · {activeConversationDesignJobCount} 个设计任务</small>
                      </div>
                    </div>
                    <label className="conversation-message-composer">
                      <span>客户最新消息</span>
                      <textarea
                        value={routeText}
                        onChange={(event) => setRouteText(event.target.value)}
                        placeholder="粘贴客户最新一句话，例如：端午礼盒每盒180元，做50份，想看效果图"
                      />
                    </label>
                    <div className="conversation-service-actions">
                      <button type="button" className="primary" onClick={processRouteInbound} disabled={Boolean(busy) || !activeConversation}>
                        <Bot size={15} aria-hidden="true" />处理当前消息
                      </button>
                      {activeConversation ? (
                        <button
                          type="button"
                          className={`ghost ${activeConversation.manualLocked ? "" : "danger"}`}
                          onClick={() => toggleConversationManualLock(activeConversation, !activeConversation.manualLocked)}
                          disabled={Boolean(busy)}
                        >
                          <LockKeyhole size={15} aria-hidden="true" />{activeConversation.manualLocked ? "解除接管" : "人工接管"}
                        </button>
                      ) : null}
                      <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("routing-center")} disabled={Boolean(busy)}>
                        <Route size={15} aria-hidden="true" />查看路由
                      </button>
                      <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("design-center")} disabled={Boolean(busy)}>
                        <ImageIcon size={15} aria-hidden="true" />转到设计
                      </button>
                      <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("send-center")} disabled={Boolean(busy)}>
                        <Send size={15} aria-hidden="true" />发送队列
                      </button>
                    </div>
                    {activeConversationLatestDesignJob ? (
                      <div className="conversation-design-brief" aria-label="当前客户设计任务">
                        <div className="conversation-design-brief-head">
                          <div>
                            <span>设计任务</span>
                            <strong>{statusLabel[activeConversationLatestDesignJob.status] || activeConversationLatestDesignJob.status}</strong>
                            <small>
                              {readableScene(activeConversationLatestDesignJob.scene, "未填写场景")} · {designImageRoundLabel(activeConversationLatestImageRound)}
                              · 本轮 {activeConversationVisibleDesignImages.length} 张 / 共 {activeConversationLatestDesignImages.length} 张
                              {activeConversationOlderDesignImageCount ? ` · 旧图 ${activeConversationOlderDesignImageCount} 张` : ""}
                              {activeConversationSelectedDesignImage
                                ? ` · 当前${designImageSelectionRoundSummary(activeConversationSelectedDesignImage)}`
                                : ""}
                            </small>
                          </div>
                          <div className="conversation-design-brief-actions">
                            <button
                              type="button"
                              className="ghost compact-button"
                              onClick={() => {
                                setActiveId(activeConversationLatestDesignJob.id);
                                scrollToWorkspaceSection("design-center");
                              }}
                              disabled={Boolean(busy)}
                            >
                              <ImageIcon size={14} aria-hidden="true" />打开设计
                            </button>
                            <button
                              type="button"
                              className="ghost compact-button"
                              onClick={() => void runAction("轮询当前客户设计", () => pollDesignJobIntoState(activeConversationLatestDesignJob))}
                              disabled={!activeConversationLatestDesignJob.externalJobId || Boolean(busy)}
                            >
                              <RefreshCw size={14} aria-hidden="true" />轮询
                            </button>
                          </div>
                        </div>
                        {activeConversationVisibleDesignImages.length ? (
                          <div className="conversation-design-thumbs">
                            {activeConversationVisibleDesignImages.slice(0, 4).map((image) => (
                              <button
                                type="button"
                                key={image.id}
                                className={`conversation-design-thumb ${image.selected ? "selected" : ""}`}
                                aria-pressed={Boolean(image.selected)}
                                onClick={() =>
                                  void selectDesignImageForJob(
                                    activeConversationLatestDesignJob,
                                    { referencedImageId: image.id },
                                    "当前客户选图",
                                  )
                                }
                                disabled={Boolean(busy)}
                              >
                                <SafeImagePreview
                                  src={designImagePreviewSrc(activeConversationLatestDesignJob, image)}
                                  alt={`当前客户${designImageSelectionRoundSummary(image)}候选图`}
                                  fallbackLabel={image.localPath || image.downloadUrl ? "图片未连接" : "等待出图"}
                                  iconSize={18}
                                />
                                <span>{designImageDisplayNumber(image)}号</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <small className="conversation-design-empty">
                            已绑定设计任务，等待出图后这里会显示候选图。
                          </small>
                        )}
                        <div className={`conversation-design-deal ${activeConversationDealNextStep.tone}`}>
                          <div>
                            <span>报价/订单</span>
                            <strong>
                              {activeConversationLatestOrderDraft
                                ? `${orderStatusLabel(activeConversationLatestOrderDraft.status)} · ${activeConversationLatestOrderDraft.totalPrice} 元`
                                : activeConversationLatestQuote
                                  ? `${quoteStatusLabel(activeConversationLatestQuote.status)} · ${activeConversationLatestQuote.totalPrice} 元`
                                  : activeConversationActualSelectedDesignImage
                                    ? "已选图，待生成报价"
                                    : "等待客户选图"}
                            </strong>
                            <small>{activeConversationDealNextStep.detail}</small>
                          </div>
                          <div className="conversation-design-deal-actions">
                            {activeConversationLatestOrderDraft ? (
                              <button
                                type="button"
                                className="ghost compact-button"
                                onClick={() => focusOrderDraft(activeConversationLatestOrderDraft)}
                                disabled={Boolean(busy)}
                              >
                                <ClipboardList size={14} aria-hidden="true" />处理订单
                              </button>
                            ) : activeConversationLatestQuote ? (
                              <button
                                type="button"
                                className="ghost compact-button"
                                onClick={() => focusQuoteCenter(activeConversationLatestQuote.id)}
                                disabled={Boolean(busy)}
                              >
                                <ReceiptText size={14} aria-hidden="true" />处理报价
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="primary compact-button"
                              onClick={() => void runActiveConversationDealNextStep()}
                              disabled={Boolean(busy) || activeConversationDealNextStep.action === "none"}
                              title={activeConversationDealNextStep.detail}
                            >
                              <Bot size={14} aria-hidden="true" />执行下一步
                            </button>
                          </div>
                        </div>
                        <div
                          className={`conversation-design-revision ${
                            activeConversationLatestRevision?.status === "failed"
                              ? "red"
                              : activeConversationRevisionPolicy?.chargeRequired
                                ? "amber"
                                : ""
                          }`}
                        >
                          <div className="conversation-design-revision-head">
                            <div>
                              <span>客户改图</span>
                              <strong>
                                {activeConversationLatestRevision
                                  ? `第 ${activeConversationLatestRevision.revisionNumber} 次 · ${revisionStatusLabel(activeConversationLatestRevision.status)}`
                                  : activeConversationRevisionCount
                                    ? `已记录 ${activeConversationRevisionCount} 次`
                                    : "还没有改图记录"}
                              </strong>
                              <small>
                                {activeConversationLatestRevision?.instruction ||
                                  activeConversationRevisionPolicy?.reason ||
                                  (activeConversationActualSelectedDesignImage
                                    ? "基于当前选图提交改图，设计平台会重新出图并绑定到这个客户。"
                                    : "客户选中候选图后，再按他的修改要求提交给设计平台。")}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="ghost compact-button"
                              onClick={() => void requestRevisionForJob(activeConversationLatestDesignJob, "当前客户改图")}
                              disabled={Boolean(busy) || !activeConversationCanSubmitRevision}
                              title={
                                !activeConversationLatestDesignImages.length
                                  ? "候选图生成后才能提交改图"
                                  : !revisionText.trim()
                                    ? "请先填写客户改图要求"
                                    : activeConversationRevisionPolicy?.reason || "提交当前客户改图"
                              }
                            >
                              <RefreshCw size={14} aria-hidden="true" />提交改图
                            </button>
                          </div>
                          <textarea
                            className="conversation-design-revision-input"
                            aria-label="当前客户改图要求"
                            value={revisionText}
                            onChange={(event) => setRevisionText(event.target.value)}
                            placeholder="粘贴客户改图要求，例如：Logo再大一点、背景浅一点、商品摆放更商务"
                          />
                          <div className="conversation-design-revision-actions">
                            <small>
                              {activeConversationActualSelectedDesignImage
                                ? `当前按第 ${activeConversationActualSelectedDesignImage.position || "-"} 张候选图改。`
                                : "未明确选图时，系统会带上客户文字要求，必要时转人工确认。"}
                            </small>
                            <button
                              type="button"
                              className="ghost compact-button"
                              onClick={() => {
                                setActiveId(activeConversationLatestDesignJob.id);
                                scrollToWorkspaceSection("design-center");
                              }}
                              disabled={Boolean(busy)}
                            >
                              <Pencil size={14} aria-hidden="true" />查看记录
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="conversation-service-insight">
                      <div>
                        <span>最近路由</span>
                        <strong>{activeConversationRoute ? agentNameByKey(agents, activeConversationRoute.agentKey) : "暂无路由"}</strong>
                        <small>
                          {activeConversationRoute?.sceneDecision?.reason ||
                            (activeConversationRoute ? `${readableScene(activeConversationRoute.scene, "未识别场景")} · ${(activeConversationRoute.matchedKeywords || []).join("、") || "无关键词"}` : "处理客户消息后会生成路由理由和处理计划。")}
                        </small>
                      </div>
                      <div>
                        <span>处理摘要</span>
                        <strong>{inboundSummary || "等待客户消息进入"}</strong>
                        <small>消息中心只处理客户对话；设计、报价、发送进入各自中心。</small>
                      </div>
                    </div>
                  </div>
                </div>
                <PreflightPanel
                  job={activeJob}
                  preflight={activePreflightResult}
                  platformHealth={platformHealth}
                  onPreflight={preflightActiveJob}
                  disabled={Boolean(busy)}
                />
                {activeDesignEscalationNotice ? (
                  <div
                    className={`design-escalation-notice ${activeDesignEscalationNotice.tone}`}
                    role="status"
                    aria-live="polite"
                  >
                    <div>
                      <strong>{activeDesignEscalationNotice.label}</strong>
                      <span>{activeDesignEscalationNotice.detail}</span>
                      <small>下一步：{activeDesignEscalationNotice.nextAction}</small>
                      {activeDesignOperatorPlan.length ? (
                        <ol className="design-escalation-plan" aria-label="设计异常处理路径">
                          {activeDesignOperatorPlan.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                    <div className="design-escalation-actions">
                      {activeJob.status === "timeout" ? (
                        <button
                          type="button"
                          className="ghost compact-button"
                          onClick={pollActiveJob}
                          disabled={!activeJob.externalJobId || Boolean(busy)}
                          title={!activeJob.externalJobId ? "任务缺少设计平台任务号，不能轮询" : "先轮询一次，确认是否只是回调丢失"}
                        >
                          <RefreshCw size={14} aria-hidden="true" />轮询结果
                        </button>
                      ) : null}
                      <button type="button" className="ghost compact-button" onClick={preflightActiveJob} disabled={Boolean(busy)}>
                        <ShieldCheck size={14} aria-hidden="true" />预检
                      </button>
                      {canRetryDesignJobFromUi(activeJob) ? (
                        <button type="button" className="primary compact-button" onClick={retryActiveJob} disabled={Boolean(busy)}>
                          <RefreshCw size={14} aria-hidden="true" />重新提交
                        </button>
                      ) : null}
                      {activeJob.status !== "manual_review" ? (
                        <button type="button" className="ghost compact-button danger" onClick={manualReviewActiveJob} disabled={Boolean(busy)}>
                          <ShieldAlert size={14} aria-hidden="true" />转人工接管
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost compact-button"
                        onClick={() => {
                          setReviewWorkbenchView("design");
                          scrollToWorkspaceSection("review-center");
                        }}
                        disabled={Boolean(busy)}
                      >
                        <ShieldAlert size={14} aria-hidden="true" />去人工审核
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="image-strip">
                  {(activeJob.images || []).length ? (
                    activeJob.images?.map((image) => (
                      <button
                        aria-pressed={Boolean(image.selected)}
                        className={`image-tile ${image.selected ? "selected" : ""}`}
                        key={image.id}
                        onClick={() => void selectDesignImageForJob(activeJob, { referencedImageId: image.id })}
                        disabled={Boolean(busy)}
                        type="button"
                      >
                        <SafeImagePreview
                          src={designImagePreviewSrc(activeJob, image)}
                          alt={`${designImageSelectionRoundSummary(image)}候选图`}
                          fallbackLabel={image.localPath || image.downloadUrl ? "图片未连接" : "等待出图"}
                          iconSize={24}
                        />
                        <span>{designImageSelectionRoundSummary(image)}</span>
                        {image.fingerprint ? <small>指纹 {image.fingerprint.slice(0, 6)}</small> : null}
                        {image.selected ? <Check size={16} aria-hidden="true" /> : null}
                      </button>
                    ))
                  ) : (
                    <div className="empty empty-cta" role="status">
                      <strong>还没有候选图</strong>
                      <span>提交出图后这里会展示候选图，并支持客户选图、截图匹配和快速确认。</span>
                      <div className="empty-actions">
                        <button type="button" className="primary" onClick={submitActiveJob} disabled={Boolean(busy)}>
                          <Send size={16} aria-hidden="true" />提交出图
                        </button>
                        <button type="button" className="ghost" onClick={pollActiveJob} disabled={!activeJob.externalJobId || Boolean(busy)}>
                          <RefreshCw size={16} aria-hidden="true" />轮询结果
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="selection-box">
                  <div className="selection-summary">
                    <strong>客户选图原话</strong>
                    <span>识别成功后，普通客户会自动生成报价草稿；高价值客户转人工报价。</span>
                  </div>
                  <div className="selection-input">
                    <input
                      aria-label="客户选图原话"
                      value={selectionText}
                      onChange={(event) => setSelectionText(event.target.value)}
                      placeholder="例如：我选第2张 / 就这个 / 要3号图"
                    />
                    <button type="button" className="primary" onClick={selectFromCustomerText} disabled={!activeJob.images?.length || Boolean(busy)}>
                      <ReceiptText size={16} aria-hidden="true" />识别并报价
                    </button>
                  </div>
                </div>
                <div className="active-quote-box">
                  <div className="active-quote-head">
                    <div>
                      <strong>当前选图与报价</strong>
                      <span>
                        {activeSelectedImage ? `已选第 ${activeSelectedImage.position} 张候选图` : "客户还没有明确选图"}
                      </span>
                    </div>
                    <em>{activeQuote ? quoteStatusLabel(activeQuote.status) : "未生成报价"}</em>
                  </div>
                  <div className={`deal-next-step active ${activeDealNextStep.tone}`}>
                    <div>
                      <strong>{activeDealNextStep.label}</strong>
                      <span>{activeDealNextStep.detail}</span>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      onClick={runActiveDealNextStep}
                      disabled={Boolean(busy) || activeDealNextStep.action === "none"}
                      title={activeDealNextStep.detail}
                    >
                      <Bot size={16} aria-hidden="true" />执行下一步
                    </button>
                  </div>
                  {activeQuote ? (
                    <>
                      <div className="active-quote-money">
                        <div>
                          <span>单价</span>
                          <strong>{activeQuote.unitPrice} 元/份</strong>
                        </div>
                        <div>
                          <span>数量</span>
                          <strong>{activeQuote.quantity} 份</strong>
                        </div>
                        <div>
                          <span>总价</span>
                          <strong>{activeQuote.totalPrice} 元</strong>
                        </div>
                        <div>
                          <span>利润</span>
                          <strong>{activeQuote.profit} 元</strong>
                        </div>
                      </div>
                      <div className="quote-tags compact">
                        <span>{paymentStatusLabel(activeQuote.paymentStatus)}</span>
                        {quoteNeedsPaymentProofReview(activeQuote) ? <span>付款凭证待核验</span> : null}
                        <span>利润率 {Math.round(Number(activeQuote.profitRate || 0) * 100)}%</span>
                        {activeQuote.sendTaskId ? <span>已入发送队列</span> : null}
                        {activeOrderDraft ? <span>订单 {orderStatusLabel(activeOrderDraft.status)}</span> : null}
                        {activeOrderDraft?.confirmationSendTask ? (
                          <span>确认{sendStatusLabel(activeOrderDraft.confirmationSendTask.status)}</span>
                        ) : null}
                      </div>
                      <div className="deal-progress" aria-label="成交进度">
                        {dealProgressSteps(activeQuote, activeOrderDraft).map((step) => (
                          <span className={step.state} key={step.key}>
                            <i>{step.index}</i>
                            <b>{step.label}</b>
                          </span>
                        ))}
                      </div>
                      <div className="quote-edit-grid">
                        <label>
                          <span>数量</span>
                          <input
                            value={quoteEdit.quantity}
                            onChange={(event) => setQuoteEdit((current) => ({ ...current, quantity: event.target.value }))}
                            inputMode="numeric"
                          />
                        </label>
                        <label>
                          <span>单价</span>
                          <input
                            value={quoteEdit.unitPrice}
                            onChange={(event) => setQuoteEdit((current) => ({ ...current, unitPrice: event.target.value }))}
                            inputMode="decimal"
                          />
                        </label>
                        <label>
                          <span>总成本</span>
                          <input
                            value={quoteEdit.totalCost}
                            onChange={(event) => setQuoteEdit((current) => ({ ...current, totalCost: event.target.value }))}
                            inputMode="decimal"
                          />
                        </label>
                        <label className="wide">
                          <span>内部备注</span>
                          <input
                            value={quoteEdit.customerNotes}
                            onChange={(event) => setQuoteEdit((current) => ({ ...current, customerNotes: event.target.value }))}
                            placeholder="例如：客户要先看效果，报价已按端午员工福利方案调整"
                          />
                        </label>
                        <button type="button" className="ghost" onClick={saveActiveQuoteEdit} disabled={Boolean(busy)}>
                          <ReceiptText size={16} aria-hidden="true" />保存调整
                        </button>
                      </div>
                      <div className="quote-preview">
                        <strong>发送话术预览</strong>
                        <p>{activeQuotePreview?.quote.id === activeQuote.id ? activeQuotePreview.message : "正在生成报价预览..."}</p>
                        {activeQuoteWarnings.length ? (
                          <div className="quote-preview-warnings">
                            {activeQuoteWarnings.map((warning) => (
                              <span key={warning}>{quoteWarningLabel(warning)}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {activeOrderDraft ? (
                        <>
                          {orderConfirmationPreviewId === activeOrderDraft.id && orderConfirmationPreview ? (
                            <div className="quote-preview quote-row-preview">
                              <strong>订单确认话术预览</strong>
                              <p>{orderConfirmationPreview.message}</p>
                              {orderConfirmationPreview.warnings.length ? (
                                <div className="quote-preview-warnings">
                                  {orderConfirmationPreview.warnings.map((warning) => (
                                    <span key={warning}>{orderWarningLabel(warning)}</span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="active-order-card">
                            <div>
                              <span>订单草稿</span>
                              <strong>{activeOrderDraft.id}</strong>
                              <small>
                                {activeOrderDraft.customer?.name || "未知客户"} · {activeOrderDraft.quantity} 份 · {paymentStatusLabel(activeOrderDraft.paymentStatus)}
                                {activeOrderDraft.confirmationSendTask ? ` · 确认${sendStatusLabel(activeOrderDraft.confirmationSendTask.status)}` : ""}
                                {orderFollowupStatusText(activeOrderDraft) ? ` · ${orderFollowupStatusText(activeOrderDraft)}` : ""}
                              </small>
                            </div>
                            <div className="order-total">
                              <span>成交金额</span>
                              <strong>{activeOrderDraft.totalPrice} 元</strong>
                              <small>{formatDateTime(activeOrderDraft.updatedAt)}</small>
                            </div>
                          </div>
                          <OrderSendPreflightPanel order={activeOrderDraft} />
                          <div className="quote-actions compact">
                          <button type="button" className="ghost" onClick={() => focusOrderDraft(activeOrderDraft)} disabled={Boolean(busy)}>
                            <ReceiptText size={16} aria-hidden="true" />进入订单处理
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => toggleOrderConfirmationPreview(activeOrderDraft)}
                            disabled={Boolean(busy)}
                            title={orderConfirmationPreviewId === activeOrderDraft.id ? "隐藏订单确认话术" : "发送前查看订单确认话术"}
                          >
                            <MessageCircle size={16} aria-hidden="true" />{orderConfirmationPreviewId === activeOrderDraft.id ? "隐藏确认话术" : "预览确认话术"}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => copyOrderConfirmationPreviewMessage(orderConfirmationPreview)}
                            disabled={Boolean(busy) || orderConfirmationPreviewId !== activeOrderDraft.id || !orderConfirmationPreview?.message}
                            title="复制当前订单确认话术"
                          >
                            <ClipboardList size={16} aria-hidden="true" />复制确认
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => reviseOrderDraftSelection(activeOrderDraft)}
                            disabled={Boolean(busy) || Boolean(orderRevisionBlockReason(activeOrderDraft))}
                            title={orderRevisionBlockReason(activeOrderDraft) || "按客户新选择修订订单选图"}
                          >
                            <ImageIcon size={16} aria-hidden="true" />修订订单选图
                          </button>
                          <button type="button"
                            className="ghost"
                            onClick={() => queueOrderDraftConfirmation(activeOrderDraft)}
                              disabled={
                                Boolean(busy) ||
                                Boolean(orderConfirmationBlockReason(activeOrderDraft))
                              }
                            title={orderConfirmationButtonTitle(activeOrderDraft)}
                          >
                            <Send size={16} aria-hidden="true" />{orderConfirmationButtonLabel(activeOrderDraft)}
                          </button>
                          {activeOrderDraft.confirmationSendTask ? (
                            <button type="button" className="ghost" onClick={() => showOrderConfirmationMessage(activeOrderDraft)} disabled={Boolean(busy)} title="查看本次订单确认话术">
                              <MessageCircle size={16} aria-hidden="true" />查看话术
                            </button>
                          ) : null}
                          {canCancelOrderConfirmationTask(activeOrderDraft) ? (
                            <button type="button" className="ghost danger" onClick={() => cancelOrderConfirmation(activeOrderDraft)} disabled={Boolean(busy)} title="取消尚未发送的订单确认任务">
                              <X size={16} aria-hidden="true" />取消确认
                            </button>
                          ) : null}
                          <button type="button" className="ghost" onClick={() => verifyOrderPaymentProof(activeOrderDraft, "deposit_paid")} disabled={Boolean(busy) || Boolean(orderPaymentProofBlockReason(activeOrderDraft))} title={orderPaymentProofBlockReason(activeOrderDraft) || "核验定金并确认订单"}>
                            <CreditCard size={16} aria-hidden="true" />核验定金并确认
                          </button>
                            <button type="button" className="ghost" onClick={() => verifyOrderPaymentProof(activeOrderDraft, "paid")} disabled={Boolean(busy) || Boolean(orderPaymentProofBlockReason(activeOrderDraft))} title={orderPaymentProofBlockReason(activeOrderDraft) || "核验全款并确认订单"}>
                              <Check size={16} aria-hidden="true" />核验全款并确认
                            </button>
                            <button type="button" className="ghost" onClick={() => confirmAndStartOrderProduction(activeOrderDraft)} disabled={Boolean(busy) || Boolean(orderProductionBlockReason(activeOrderDraft))} title={orderProductionBlockReason(activeOrderDraft) || "核验付款和选图后标记生产中"}>
                              <PackageSearch size={16} aria-hidden="true" />生产中
                            </button>
                            {renderOrderFollowupControls(activeOrderDraft, "production")}
                            {renderOrderFollowupControls(activeOrderDraft, "delivery")}
                            <button type="button" className="ghost" onClick={() => confirmAndUpdateOrderDraftStatus(activeOrderDraft, "fulfilled")} disabled={Boolean(busy) || Boolean(orderFulfillmentBlockReason(activeOrderDraft))} title={orderFulfillmentBlockReason(activeOrderDraft) || "生产完成后标记订单完成"}>
                              <ShieldCheck size={16} aria-hidden="true" />完成
                            </button>
                            <button type="button" className="ghost danger" onClick={() => confirmAndUpdateOrderDraftStatus(activeOrderDraft, "cancelled")} disabled={Boolean(busy)}>
                              <Ban size={16} aria-hidden="true" />取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="quote-preview">
                          <strong>订单草稿</strong>
                          <p>客户确认选图或付款后，可从当前报价生成订单草稿，后续用于排产、收款和人工跟进。</p>
                        </div>
                      )}
                      <div className="quote-actions compact">
                        <button type="button"
                          className="ghost"
                          onClick={() => queueQuoteDraft(activeQuote)}
                          disabled={Boolean(busy) || Boolean(activeQuoteSendRisk)}
                          title={activeQuoteSendRisk || "发送报价"}
                        >
                          <Send size={16} aria-hidden="true" />发送报价
                        </button>
                        <button type="button" className="ghost" onClick={() => verifyQuotePaymentProof(activeQuote, "deposit_paid")} disabled={Boolean(busy) || Boolean(quotePaymentProofBlockReason(activeQuote))} title={quotePaymentProofBlockReason(activeQuote) || "核验定金并确认订单"}>
                          <CreditCard size={16} aria-hidden="true" />核验定金并确认
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => reviseQuoteDraftSelection(activeQuote)}
                          disabled={Boolean(busy) || activeQuote.status === "accepted" || Boolean(activeOrderDraft) || !(activeQuote.designJob?.images?.length)}
                          title={
                            activeQuote.status === "accepted"
                              ? "已成交报价不能直接修订选图"
                              : activeOrderDraft
                                ? "已生成订单草稿，不能直接修订报价选图"
                                : "按客户新选择修订报价选图"
                          }
                        >
                          <ImageIcon size={16} aria-hidden="true" />修订选图
                        </button>
                        <button type="button" className="ghost" onClick={() => createOrderDraft(activeQuote)} disabled={Boolean(busy) || Boolean(quoteOrderDraftBlockReason(activeQuote))} title={quoteOrderDraftBlockReason(activeQuote) || "按当前报价生成或更新订单草稿"}>
                          <ClipboardList size={16} aria-hidden="true" />{activeOrderDraft ? "更新订单" : "生成订单"}
                        </button>
                        <button type="button" className="primary" onClick={() => verifyQuotePaymentProof(activeQuote, "paid")} disabled={Boolean(busy) || Boolean(quotePaymentProofBlockReason(activeQuote))} title={quotePaymentProofBlockReason(activeQuote) || "核验全款并确认订单"}>
                          <Check size={16} aria-hidden="true" />核验全款并确认
                        </button>
                        <button type="button" className="ghost danger" onClick={() => confirmQuoteManualFollowup(activeQuote)} disabled={Boolean(busy)}>
                          <ShieldAlert size={16} aria-hidden="true" />人工跟进
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="active-quote-empty">
                      <span>{activeSelectedImage ? "已选图，可以生成报价草稿。" : "先识别客户选图，再生成报价。"}</span>
                        <button type="button" className="ghost" onClick={quoteActiveJob} disabled={Boolean(busy) || Boolean(designJobQuoteBlockReason(activeJob))} title={designJobQuoteBlockReason(activeJob) || "按当前选图生成报价草稿"}>
                          <ClipboardList size={16} aria-hidden="true" />生成报价
                        </button>
                    </div>
                  )}
                </div>
                <div className="action-row">
                  <button type="button" className="ghost" onClick={selectFirstImage} disabled={!activeJob.images?.length || Boolean(busy)}><ImageIcon size={16} aria-hidden="true" />客户选第1张</button>
                  <button type="button" className="ghost" onClick={selectByReference} disabled={!activeJob.images?.length || Boolean(busy)}><ImageIcon size={16} aria-hidden="true" />引用图片选图</button>
                  <button type="button" className="ghost" onClick={selectByScreenshot} disabled={!activeJob.images?.length || Boolean(busy)}><ImageIcon size={16} aria-hidden="true" />截图匹配</button>
                  <button type="button" className="ghost danger" onClick={selectByUnclearScreenshot} disabled={!activeJob.images?.length || Boolean(busy)}><ShieldAlert size={16} aria-hidden="true" />截图不确定</button>
                  <button type="button" className="ghost" onClick={pollActiveJob} disabled={!activeJob.externalJobId || Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />轮询结果</button>
                  <button type="button" className="ghost" onClick={retryActiveJob} disabled={!canRetryDesignJobFromUi(activeJob) || Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />重试</button>
                  <button
                    type="button"
                    className="primary"
                    onClick={quickConfirmActiveJob}
                    disabled={Boolean(activeDesignImageSendRisk) || Boolean(busy)}
                    title={activeDesignImageSendRisk || "快速确认发送"}
                  >
                    <Check size={16} aria-hidden="true" />快速确认
                  </button>
                  <button type="button" className="ghost" onClick={quoteActiveJob} disabled={Boolean(busy) || Boolean(designJobQuoteBlockReason(activeJob))} title={designJobQuoteBlockReason(activeJob) || "按当前选图生成报价草稿"}><ClipboardList size={16} aria-hidden="true" />生成报价</button>
                  <button type="button" className="ghost danger" onClick={cancelActiveJob} disabled={["sent", "customer_selected", "quote_created", "cancelled"].includes(activeJob.status) || Boolean(busy)}><Ban size={16} aria-hidden="true" />取消</button>
                  <button type="button" className="ghost danger" onClick={manualReviewActiveJob} disabled={Boolean(busy)}><ShieldAlert size={16} aria-hidden="true" />转人工</button>
                </div>
                <div className="revision-box">
                  <div className="revision-summary">
                    <strong>客户改图</strong>
                    <span>
                      已记录 {activeJob.revisionCount || activeJob.revisions?.length || 0} 次
                      {activeJob.revisionPolicy?.chargeRequired ? " · 已进入收费/人工确认" : " · 低预算默认 2 次免费"}
                    </span>
                  </div>
                  <textarea
                    aria-label="客户改图要求"
                    value={revisionText}
                    onChange={(event) => setRevisionText(event.target.value)}
                    placeholder="粘贴客户改图要求，例如：Logo再大一点、背景浅一点、商品摆放更商务"
                  />
                  <div className="action-row">
                    <button type="button" className="primary" onClick={requestRevisionForActiveJob} disabled={!activeJob.images?.length || Boolean(busy)}>
                      <RefreshCw size={16} aria-hidden="true" />提交改图
                    </button>
                    {activeJob.revisionPolicy?.reason ? <small>{activeJob.revisionPolicy.reason}</small> : null}
                  </div>
                  <div className="revision-list">
                    {(activeJob.revisions || []).length ? (
                      activeJob.revisions?.slice(-4).map((revision) => (
                        <div className="revision-item" key={revision.id}>
                          <strong>第 {revision.revisionNumber} 次 · {revisionStatusLabel(revision.status)}</strong>
                          <span>{revision.instruction}</span>
                          {revision.chargeRequired ? <em>需人工确认收费</em> : null}
                        </div>
                      ))
                    ) : (
                        <div className="empty empty-cta small" role="status">
                          <strong>还没有改图记录</strong>
                          <span>填写客户改图要求后，可以直接提交并保留处理状态。</span>
                          <div className="empty-actions">
                            <button type="button" className="primary" onClick={requestRevisionForActiveJob} disabled={!activeJob.images?.length || Boolean(busy)}>
                              <RefreshCw size={16} aria-hidden="true" />提交改图
                            </button>
                          </div>
                        </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
                <div className="empty empty-cta" role="status">
                  <strong>暂无设计任务</strong>
                  <span>先创建一条演示任务，完整体验素材绑定、出图、选图、报价和发送流程。</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={createDemo} disabled={Boolean(busy)}>
                      <Boxes size={16} aria-hidden="true" />新建演示任务
                    </button>
                    <button type="button" className="ghost" onClick={prepareDemoDesignMaterials} disabled={Boolean(busy)}>
                      <ImageIcon size={16} aria-hidden="true" />准备出图材料
                    </button>
                  </div>
                </div>
            )}
          </section>

          <section className="panel design-center" id="design-center">
            <div className="panel-head">
              <div>
                <h2><Layers size={17} aria-hidden="true" />设计中心</h2>
                <span>待提交、出图中、待确认、失败和超时任务</span>
              </div>
              <div className="panel-actions">
                {designAutoRefreshSummary ? (
                  <span className="design-auto-refresh-note">
                    {designAutoRefreshSummary}
                    {designAutoRefreshAt ? ` · ${designAutoRefreshAt}` : ""}
                  </span>
                ) : null}
                <button type="button" className="ghost compact-button" onClick={pollAllActiveDesignResults} disabled={Boolean(busy)}>
                  <RefreshCw size={14} aria-hidden="true" />批量轮询结果
                </button>
              </div>
            </div>
            <div className="job-list">
              {jobs.length ? jobs.map((job) => {
                const escalation = designJobEscalationNotice(job);
                return (
                  <button
                    aria-pressed={job.id === activeJob?.id}
                    className={`job-row ${job.status} ${job.id === activeJob?.id ? "selected" : ""}`}
                    key={job.id}
                    onClick={() => setActiveId(job.id)}
                    type="button"
                  >
                    <span className={`dot ${isHighValueDesignJob(job) ? "danger" : ""}`} />
                    <div>
                      <strong>{job.customer?.name || "未命名客户"}</strong>
                      <small>{readableScene(job.scene, "未填写场景")} · {job.outputCount} 张候选</small>
                      {job.retryCount ? <small>已重试 {job.retryCount} 次</small> : null}
                      {job.errorMessage ? (
                        <small className="error-text" title={job.errorMessage}>
                          {operatorStatusMessage(job.errorMessage, job.errorMessage)}
                        </small>
                      ) : null}
                      {escalation ? <small className="job-next-action">下一步：{escalation.nextAction}</small> : null}
                    </div>
                    <em>{statusLabel[job.status] || job.status}</em>
                  </button>
                );
              }) : (
                <div className="empty empty-cta" role="status">
                  <strong>设计中心为空</strong>
                  <span>创建演示任务后，这里会变成可点击任务列表，支持切换当前任务。</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={createDemo} disabled={Boolean(busy)}>
                      <Boxes size={16} aria-hidden="true" />新建演示任务
                    </button>
                    <button type="button" className="ghost" onClick={pollAllActiveDesignResults} disabled={Boolean(busy)}>
                      <RefreshCw size={16} aria-hidden="true" />轮询结果
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </section>

        <section className="bottom-grid">
          <section className={`panel sku-mode-${skuWorkbenchView}`} id="sku-library">
            <div className="panel-head">
              <div>
                <h2><Store size={17} aria-hidden="true" />商品库</h2>
                <span>礼盒、内搭物品、配件、供应商、图片和交期</span>
              </div>
              <div className="segmented-control sku-view-switcher" role="tablist" aria-label="商品库工作区视图">
                <button
                  type="button"
                  className={skuWorkbenchView === "catalog" ? "selected" : ""}
                  aria-pressed={skuWorkbenchView === "catalog"}
                  onClick={() => setSkuWorkbenchView("catalog")}
                >
                  商品列表
                </button>
                <button
                  type="button"
                  className={skuWorkbenchView === "repair" ? "selected" : ""}
                  aria-pressed={skuWorkbenchView === "repair"}
                  onClick={() => setSkuWorkbenchView("repair")}
                >
                  资料补齐
                </button>
                <button
                  type="button"
                  className={skuWorkbenchView === "editor" ? "selected" : ""}
                  aria-pressed={skuWorkbenchView === "editor"}
                  onClick={() => setSkuWorkbenchView("editor")}
                >
                  新增商品
                </button>
              </div>
            </div>
            {skuWorkbenchView === "catalog" ? (
            <div className="sku-controls">
              <div className="search-field">
                <Search size={15} aria-hidden="true" />
                <input
                  value={skuSearch}
                  onChange={(event) => setSkuSearch(event.target.value)}
                  placeholder="搜索 SKU、名称、供应商、场景"
                  aria-label="搜索商品库"
                />
              </div>
              <div className="segmented-control" role="group" aria-label="商品类型筛选">
                {skuTypeOptions.map((option) => (
                  <button
                    className={skuTypeFilter === option.value ? "selected" : ""}
                    key={option.value}
                    onClick={() => setSkuTypeFilter(option.value)}
                    aria-pressed={skuTypeFilter === option.value}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="segmented-control wide" role="group" aria-label="商品资料状态筛选">
                {skuIssueOptions.map((option) => (
                  <button
                    className={skuIssueFilter === option.value ? "selected" : ""}
                    key={option.value}
                    onClick={() => setSkuIssueFilter(option.value)}
                    aria-pressed={skuIssueFilter === option.value}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span>显示 {visibleSkus.length} / {skus.length}</span>
            </div>
            ) : null}
            {skuWorkbenchView === "repair" ? (
            <div className="sku-repair-guide">
              <div className="sku-repair-head">
                <div>
                  <strong>商品资料补齐向导</strong>
                  <span>
                    待补齐 {skuRepairQueue.length} 个 · 当前筛选 {visibleSkuRepairQueue.length} 个 · 影响自动搭配/出图 {catalogAudit?.blockingRepairCount || 0} 个
                  </span>
                </div>
                <div className="sku-repair-actions">
                  <button
                    type="button"
                    className="ghost compact-button"
                    onClick={() => {
                      setSkuIssueFilter("problem");
                      setSkuRepairFilter("blocking");
                    }}
                    disabled={!skuRepairQueue.length}
                  >
                    <AlertTriangle size={14} aria-hidden="true" />只看关键问题
                  </button>
                  <button
                    type="button"
                    className="ghost compact-button"
                    onClick={() => {
                      setSkuIssueFilter("missing_image");
                      setSkuRepairFilter("image");
                    }}
                    disabled={!skuRepairQueue.length}
                  >
                    <ImageIcon size={14} aria-hidden="true" />只看图片问题
                  </button>
                  <button type="button" className="ghost compact-button" onClick={exportSkuRepairQueue} disabled={!skuRepairQueue.length || Boolean(busy)}>
                    <Download size={14} aria-hidden="true" />导出补齐表
                  </button>
                  <button type="button" className="ghost compact-button" onClick={resetSkuRepairView} disabled={!skuRepairViewCustomized || Boolean(busy)}>
                    <RefreshCw size={14} aria-hidden="true" />重置视图
                  </button>
                  <button type="button" className="ghost compact-button" onClick={exportSkuCatalogIssues} disabled={!catalogAudit?.issues.length || Boolean(busy)}>
                    <Download size={14} aria-hidden="true" />导出体检明细
                  </button>
                </div>
              </div>
              <div className="sku-repair-filter" role="group" aria-label="商品补齐任务筛选">
                {skuRepairFilterOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={skuRepairFilter === option.value ? "selected" : ""}
                    aria-pressed={skuRepairFilter === option.value}
                    onClick={() => setSkuRepairFilter(option.value)}
                    disabled={!skuRepairQueue.length}
                  >
                    <span>{option.label}</span>
                    <strong>{skuRepairFilterCounts[option.value] || 0}</strong>
                  </button>
                ))}
              </div>
              <label className="sku-repair-search">
                <Search size={14} aria-hidden="true" />
                <input
                  aria-label="搜索待补齐商品"
                  value={skuRepairSearch}
                  onChange={(event) => setSkuRepairSearch(event.target.value)}
                  placeholder="搜索 SKU / 商品 / 待补字段 / 问题"
                />
              </label>
              <label className="sku-repair-sort">
                <span>排序</span>
                <select aria-label="待补齐商品排序" value={skuRepairSort} onChange={(event) => setSkuRepairSort(event.target.value)}>
                  {skuRepairSortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {catalogAudit ? (
                <>
                <div className={`sku-commercial-readiness ${catalogAudit.commercialReadiness?.level || "blocked"}`}>
                  <div>
                    <small>商业可用度</small>
                    <strong>{catalogAudit.commercialReadiness?.score ?? 0} 分</strong>
                  </div>
                  <p>{catalogAudit.commercialReadiness?.summary || "正在计算商品库是否适合自动化。"}</p>
                  <div className="sku-commercial-flags" aria-label="商品库自动化能力">
                    <span className={catalogAudit.commercialReadiness?.canAutoBundle ? "ok" : "blocked"}>自动搭配</span>
                    <span className={catalogAudit.commercialReadiness?.canSubmitDesign ? "ok" : "blocked"}>设计出图</span>
                    <span className={catalogAudit.commercialReadiness?.canAutoQuote ? "ok" : "blocked"}>自动报价</span>
                  </div>
                  <button
                    type="button"
                    className="ghost compact-button"
                    onClick={() => setMessage([
                      ...(catalogAudit.commercialReadiness?.blockers || []),
                      ...(catalogAudit.commercialReadiness?.nextActions || []),
                    ].join("；") || "商品库当前没有明确阻塞项。")}
                  >
                    查看下一步
                  </button>
                  {catalogAudit.budgetBandCoverage?.length ? (
                    <div className="sku-budget-bands" aria-label="预算档位覆盖">
                      {catalogAudit.budgetBandCoverage.map((band) => (
                        <button
                          type="button"
                          key={band.key}
                          className={band.available ? "ok" : "blocked"}
                          onClick={() => setMessage(`${band.label}：${band.available ? "可承接" : "缺组合"}；预算范围 ${band.max === null ? `${band.min} 元以上` : `${band.min}-${band.max} 元`}；可用组合 ${band.combinationCount} 个；可自动组合 ${band.automationReadyCombinationCount || 0} 个；推荐自动组合：${automationExampleSummary(band.automationReadyExamples)}；不能自动原因：${automationBlockerSummary(band.automationBlockerCounts)}；最低成套 ${band.minBundlePrice || 0} 元；最低毛利率 ${Math.round((band.minMarginRate || 0) * 100)}%；低毛利组合 ${band.lowMarginCombinationCount || 0} 个；最长交期 ${band.maxLeadTimeDays || 0} 天；交期风险组合 ${band.deliveryRiskCombinationCount || 0} 个；规格完整组合 ${band.specReadyCombinationCount || 0} 个；尺寸匹配组合 ${band.sizeReadyCombinationCount || 0} 个；尺寸风险组合 ${band.sizeRiskCombinationCount || 0} 个；可承接约 ${band.capacity || 0} 份。${band.examples?.length ? `示例：${band.examples.map((item) => `${item.giftBoxSkuCode}+${item.itemSkuCode}=售价${item.totalPrice}元/成本${item.costPrice || 0}元/毛利${item.profit || 0}元/毛利率${Math.round((item.marginRate || 0) * 100)}%/交期${item.leadTimeKnown ? `${item.leadTimeDays || 0}天` : "未填"}/重量${item.weightGram || 0}g/${item.specReady ? "规格完整" : "规格待补"}/${item.sizeReady ? "尺寸匹配" : item.sizeRisk ? "尺寸风险" : "尺寸待核"}/${item.automationReady ? "可自动" : `需人工${item.autoQuoteBlockers?.length ? `(${automationBlockerListLabel(item.autoQuoteBlockers)})` : ""}`}${item.deliveryRisk ? "/交期需确认" : ""}`).join("、")}` : "请补礼盒或内搭商品。"}`)}
                        >
                          <small>{band.label}</small>
                          <strong>{band.available ? "可承接" : "缺口"}</strong>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {catalogAudit.sceneBundleCoverage?.length ? (
                    <div className="sku-scene-bundles" aria-label="场景组合覆盖">
                      {catalogAudit.sceneBundleCoverage.slice(0, 6).map((scene) => (
                        <button
                          type="button"
                          key={scene.scene}
                          className={scene.available ? "ok" : "blocked"}
                          onClick={() => setMessage(`${scene.scene}：${scene.available ? "可自动选品" : "缺少真实组合"}；礼盒 ${scene.giftBoxCount} 个，内搭 ${scene.itemCount} 个，组合 ${scene.combinationCount} 个；可自动组合 ${scene.automationReadyCombinationCount || 0} 个；推荐自动组合：${automationExampleSummary(scene.automationReadyExamples)}；不能自动原因：${automationBlockerSummary(scene.automationBlockerCounts)}；最低成套 ${scene.minBundlePrice || 0} 元；最低毛利率 ${Math.round((scene.minMarginRate || 0) * 100)}%；低毛利组合 ${scene.lowMarginCombinationCount || 0} 个；最长交期 ${scene.maxLeadTimeDays || 0} 天；交期风险组合 ${scene.deliveryRiskCombinationCount || 0} 个；规格完整组合 ${scene.specReadyCombinationCount || 0} 个；尺寸匹配组合 ${scene.sizeReadyCombinationCount || 0} 个；尺寸风险组合 ${scene.sizeRiskCombinationCount || 0} 个；可承接约 ${scene.capacity || 0} 份。${scene.examples?.length ? `示例：${scene.examples.map((item) => `${item.giftBoxSkuCode}+${item.itemSkuCode}=售价${item.totalPrice}元/成本${item.costPrice || 0}元/毛利${item.profit || 0}元/毛利率${Math.round((item.marginRate || 0) * 100)}%/交期${item.leadTimeKnown ? `${item.leadTimeDays || 0}天` : "未填"}/重量${item.weightGram || 0}g/${item.specReady ? "规格完整" : "规格待补"}/${item.sizeReady ? "尺寸匹配" : item.sizeRisk ? "尺寸风险" : "尺寸待核"}/${item.automationReady ? "可自动" : `需人工${item.autoQuoteBlockers?.length ? `(${automationBlockerListLabel(item.autoQuoteBlockers)})` : ""}`}${item.deliveryRisk ? "/交期需确认" : ""}`).join("、")}` : "请给该场景补内搭商品，或给礼盒补通用/场景标签。"}`)}
                        >
                          <small>{scene.scene}</small>
                          <strong>{scene.available ? "有组合" : "缺组合"}</strong>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="sku-audit-strip" aria-label="商品体检概览">
                  <button type="button" onClick={() => setSkuIssueFilter("ready")} aria-pressed={skuIssueFilter === "ready"}>
                    <small>可用商品</small><strong>{catalogAudit.readyCount}/{catalogAudit.total}</strong>
                  </button>
                  <button type="button" className={catalogAudit.errorCount ? "error" : ""} onClick={() => setSkuIssueFilter("error")} aria-pressed={skuIssueFilter === "error"}>
                    <small>严重</small><strong>{catalogAudit.errorCount}</strong>
                  </button>
                  <button type="button" className={catalogAudit.warningCount ? "warning" : ""} onClick={() => setSkuIssueFilter("warning")} aria-pressed={skuIssueFilter === "warning"}>
                    <small>警告</small><strong>{catalogAudit.warningCount}</strong>
                  </button>
                  <button type="button" onClick={() => setSkuIssueFilter("problem")} aria-pressed={skuIssueFilter === "problem"}>
                    <small>有问题</small><strong>{catalogAudit.errorCount + catalogAudit.warningCount}</strong>
                  </button>
                  <button type="button" className={catalogAudit.imageIssueCount ? "warning" : ""} onClick={() => setSkuIssueFilter("missing_image")} aria-pressed={skuIssueFilter === "missing_image"}>
                    <small>图片问题</small><strong>{catalogAudit.imageIssueCount ?? catalogAudit.missingImageCount}</strong>
                  </button>
                  <button type="button" className={catalogAudit.lowStockCount ? "warning" : ""} onClick={() => setSkuIssueFilter("low_stock")} aria-pressed={skuIssueFilter === "low_stock"}>
                    <small>库存异常</small><strong>{catalogAudit.lowStockCount}</strong>
                  </button>
                  <button type="button" className={catalogAudit.negativeMarginCount ? "error" : ""} onClick={() => setSkuIssueFilter("negative_margin")} aria-pressed={skuIssueFilter === "negative_margin"}>
                    <small>利润异常</small><strong>{catalogAudit.negativeMarginCount}</strong>
                  </button>
                  <button type="button" className={(catalogAudit.duplicateSkuCodeCount || catalogAudit.duplicateNameCount || catalogAudit.unsafeSkuCodeCount) ? "error" : ""} onClick={() => setSkuIssueFilter("duplicate")} aria-pressed={skuIssueFilter === "duplicate"}>
                    <small>重复资料</small><strong>{(catalogAudit.duplicateSkuCodeCount || 0) + (catalogAudit.duplicateNameCount || 0) + (catalogAudit.unsafeSkuCodeCount || 0)}</strong>
                  </button>
                  <button type="button" className={catalogAudit.typeIssueCount ? "error" : ""} onClick={() => setSkuIssueFilter("type")} aria-pressed={skuIssueFilter === "type"}>
                    <small>类型异常</small><strong>{catalogAudit.typeIssueCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.invalidReplacementCount ? "warning" : ""} onClick={() => setSkuIssueFilter("replacement")} aria-pressed={skuIssueFilter === "replacement"}>
                    <small>替代异常</small><strong>{catalogAudit.invalidReplacementCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.invalidMatchingRuleCount ? "warning" : ""} onClick={() => setSkuIssueFilter("matching_rule")} aria-pressed={skuIssueFilter === "matching_rule"}>
                    <small>搭配异常</small><strong>{catalogAudit.invalidMatchingRuleCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.leadTimeIssueCount ? "warning" : ""} onClick={() => setSkuIssueFilter("lead_time")} aria-pressed={skuIssueFilter === "lead_time"}>
                    <small>交期异常</small><strong>{catalogAudit.leadTimeIssueCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.specificationIssueCount ? "warning" : ""} onClick={() => setSkuIssueFilter("specification")} aria-pressed={skuIssueFilter === "specification"}>
                    <small>规格异常</small><strong>{catalogAudit.specificationIssueCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.catalogStructureIssueCount ? "error" : ""} onClick={() => setMessage(`商品库结构：可用礼盒 ${catalogAudit.availableGiftBoxCount || 0} 个，可用内搭 ${catalogAudit.availableItemCount || 0} 个，可用配件 ${catalogAudit.availableAccessoryCount || 0} 个。自动搭配至少需要 1 个可用礼盒和 1 个可用内搭。`)} aria-pressed={false}>
                    <small>库结构</small><strong>{catalogAudit.catalogStructureIssueCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.catalogCoverageIssueCount ? "warning" : ""} onClick={() => setMessage(`场景覆盖：可用商品覆盖 ${catalogAudit.availableSceneTagCount || 0} 个场景标签、${catalogAudit.availableCategoryCount || 0} 个分类。常见场景：${(catalogAudit.topSceneTags || []).map((item) => `${item.name} ${item.count}`).join("、") || "暂无"}。常见分类：${(catalogAudit.topCategories || []).map((item) => `${item.name} ${item.count}`).join("、") || "暂无"}。`)} aria-pressed={false}>
                    <small>场景覆盖</small><strong>{catalogAudit.catalogCoverageIssueCount || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.bundleReadinessIssueCount ? "error" : ""} onClick={() => setMessage(`基础搭配：最低成套预算 ${catalogAudit.minBundleBudget || 0} 元/份；可承接约 ${catalogAudit.basicBundleCapacity || 0} 份；瓶颈：${catalogAudit.bundleCapacityBottleneckLabel || "未计算"}。${(catalogAudit.bundleCapacityChecks || []).map((item) => `${item.quantity}份${item.enough ? "够" : `缺${item.shortage}`}`).join("、") || "暂无数量检查"}。最低礼盒 ${catalogAudit.minGiftBoxPrice || 0} 元、礼盒库存 ${catalogAudit.availableGiftBoxStock || 0}；最低内搭 ${catalogAudit.minItemPrice || 0} 元、内搭库存 ${catalogAudit.availableItemStock || 0}。${(catalogAudit.bundleReadinessWarnings || []).join(" ") || "当前商品库可以组出基础礼盒组合。"}`)} aria-pressed={false}>
                    <small>基础搭配</small><strong>{catalogAudit.basicBundleCapacity || 0}</strong>
                  </button>
                  <button type="button" className={catalogAudit.blockingRepairCount ? "error" : ""} onClick={() => setSkuIssueFilter("problem")} aria-pressed={skuIssueFilter === "problem"}>
                    <small>影响自动化</small><strong>{catalogAudit.blockingRepairCount || 0}</strong>
                  </button>
                </div>
                </>
              ) : null}
              {visibleSkuRepairQueue.length ? (
                <div className="sku-repair-list">
                  {visibleSkuRepairQueue.slice(0, 8).map((item) => (
                    <div className={`sku-repair-item ${item.severity}`} key={`${item.skuCode || item.name}-${item.priority}`}>
                      <div>
                        <strong>{item.name || "未命名商品"}</strong>
                        <span>{item.skuCode || "缺 SKU 编号"} · {skuSeverityLabel(item.severity)} · {item.issueCount} 个问题</span>
                      </div>
                      <p>{item.recommendedAction}</p>
                      <div className="sku-repair-fields">
                        {item.missingFields.slice(0, 4).map((field) => (
                          <span key={field.field}>{field.label}</span>
                        ))}
                      </div>
                      <button type="button" className="primary compact-button" onClick={() => repairSku(item)} disabled={Boolean(busy)}>
                        <Pencil size={14} aria-hidden="true" />补齐
                      </button>
                    </div>
                  ))}
                  {visibleSkuRepairQueue.length > 8 ? <small>当前筛选还有 {visibleSkuRepairQueue.length - 8} 个待补齐商品，可导出补齐表后批量处理。</small> : null}
                </div>
              ) : (
                <div className="sku-repair-empty">
                  <Check size={16} aria-hidden="true" />
                  <span>{skuRepairQueue.length ? (skuRepairSearch.trim() ? "当前搜索下没有待补齐商品，换个关键词或清空搜索。" : "当前筛选下没有待补齐商品，可以切换其它补齐类型。") : "当前商品资料没有发现待补齐项，可以继续用于搭配和出图。"}</span>
                </div>
              )}
              {skuImageProblems.length ? (
                <div className="sku-image-problem-list">
                  <div className="sku-image-problem-head">
                    <div className="sku-image-problem-title">
                      <strong>图片问题清单</strong>
                      <span>共 {skuImageProblems.length} 个 · 涉及商品 {skuImageProblemCountByProduct.size} 个 · 多问题商品 {skuImageProblemMultiProductCount} 个 · 有路径 {skuImageProblemPathCounts.has_path || 0} 个 · 未填路径 {skuImageProblemPathCounts.missing_path || 0} 个 · 当前涉及商品 {visibleSkuImageProblemProductCount} 个 · 当前搜索 {visibleSkuImageProblems.length} 个 · 当前有路径 {visibleSkuImageProblemPathCount} 个 · 当前失效路径 {visibleSkuImageProblemInvalidPathCount} 个 · 当前未填路径 {visibleSkuImageProblemMissingPathCount} 个 · 定位到主图或具体多角度图</span>
                    </div>
                    <div className="sku-image-problem-head-actions">
                      <button
                        type="button"
                        className={`ghost compact-button ${skuImageProblemProductScope === "multiple" ? "selected" : ""}`}
                        onClick={toggleMultiSkuImageProblemProducts}
                        disabled={!skuImageProblems.length || Boolean(busy)}
                        aria-pressed={skuImageProblemProductScope === "multiple"}
                      >
                        <Search size={14} aria-hidden="true" />只看多问题 {skuImageProblemMultiProductCount}
                      </button>
                      <button type="button" className="ghost compact-button" onClick={prioritizeSkuImageProblemProducts} disabled={!visibleSkuImageProblems.length || Boolean(busy)}>
                        <Search size={14} aria-hidden="true" />多问题优先
                      </button>
                      <button type="button" className="ghost compact-button" onClick={prioritizeSkuImageMissingPaths} disabled={!visibleSkuImageProblemMissingPathCount || Boolean(busy)}>
                        <Search size={14} aria-hidden="true" />补路径优先
                      </button>
                      <button type="button" className="ghost compact-button" onClick={prioritizeSkuImageInvalidPaths} disabled={!skuImageProblemActionCounts.review_invalid || Boolean(busy)}>
                        <Search size={14} aria-hidden="true" />核路径优先
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copySkuImageProblemHandoff} disabled={!visibleSkuImageProblems.length || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制交接
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copySkuImageProblemActionHandoff} disabled={!visibleSkuImageProblems.length || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制分派
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copyVisibleSkuImageProblemTrackingIds} disabled={!visibleSkuImageProblems.length || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制标识清单
                      </button>
                      <button type="button" className="ghost compact-button" onClick={() => copyVisibleSkuImageProblemActionProducts("upload_main", "补主图")} disabled={!visibleSkuImageProblemUploadMainCount || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制补主图
                      </button>
                      <button type="button" className="ghost compact-button" onClick={() => copyVisibleSkuImageProblemActionProducts("upload_angle", "补多角度图")} disabled={!visibleSkuImageProblemUploadAngleCount || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制补多角度
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copyVisibleSkuImageProblemPaths} disabled={!visibleSkuImageProblemPathCount || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制路径清单
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copyVisibleSkuImageProblemInvalidPaths} disabled={!visibleSkuImageProblemInvalidPathCount || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制失效路径
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copyVisibleSkuImageProblemMissingPaths} disabled={!visibleSkuImageProblemMissingPathCount || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制补路径
                      </button>
                      <button type="button" className="ghost compact-button" onClick={copySkuImageProblemReviewChecklist} disabled={!visibleSkuImageProblems.length || Boolean(busy)}>
                        <ClipboardList size={14} aria-hidden="true" />复制复核
                      </button>
                      <button type="button" className="ghost compact-button" onClick={exportSkuImageProblems} disabled={!visibleSkuImageProblems.length || Boolean(busy)}>
                        <Download size={14} aria-hidden="true" />导出清单
                      </button>
                      <button type="button" className="ghost compact-button" onClick={resetSkuImageProblemView} disabled={!skuImageProblemViewCustomized || Boolean(busy)}>
                        <RefreshCw size={14} aria-hidden="true" />重置图片
                      </button>
                    </div>
                  </div>
                  <label className="sku-image-problem-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      aria-label="搜索图片问题"
                      value={skuImageProblemSearch}
                      onChange={(event) => setSkuImageProblemSearch(event.target.value)}
                      placeholder="搜索 SKU / 问题标识 / 图片位置 / 路径 / 问题"
                    />
                  </label>
                  <label className="sku-image-problem-sort">
                    <span>排序</span>
                    <select aria-label="图片问题排序" value={skuImageProblemSort} onChange={(event) => setSkuImageProblemSort(event.target.value)}>
                      {skuImageProblemSortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="sku-image-problem-filter" role="group" aria-label="图片问题严重程度筛选">
                    {skuImageProblemSeverityOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={skuImageProblemSeverityFilter === option.value ? "selected" : ""}
                        onClick={() => setSkuImageProblemSeverityFilter(option.value)}
                        aria-pressed={skuImageProblemSeverityFilter === option.value}
                      >
                        <span>{option.label}</span>
                        <strong>{skuImageProblemSeverityCounts[option.value] || 0}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="sku-image-problem-filter" role="group" aria-label="图片问题路径状态筛选">
                    {skuImageProblemPathOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={skuImageProblemPathFilter === option.value ? "selected" : ""}
                        onClick={() => setSkuImageProblemPathFilter(option.value)}
                        aria-pressed={skuImageProblemPathFilter === option.value}
                      >
                        <span>{option.label}</span>
                        <strong>{skuImageProblemPathCounts[option.value] || 0}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="sku-image-problem-filter" role="group" aria-label="图片问题处理方式筛选">
                    {skuImageProblemActionOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={skuImageProblemActionFilter === option.value ? "selected" : ""}
                        onClick={() => setSkuImageProblemActionFilter(option.value)}
                        aria-pressed={skuImageProblemActionFilter === option.value}
                      >
                        <span>{option.label}</span>
                        <strong>{skuImageProblemActionCounts[option.value] || 0}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="sku-image-problem-action-summary" aria-label="当前图片问题处理方式统计">
                    <span>当前处理方式统计</span>
                    <strong>{visibleSkuImageProblemActionSummary}</strong>
                    <small>分组涉及商品：{visibleSkuImageProblemActionProductSummary}</small>
                    <small>下一步：{visibleSkuImageProblemNextStepSummary}</small>
                    <small>{visibleSkuImageProblemFilterSummary}</small>
                    <small>审核刷新口径：{skuImageProblemAuditRefreshContext}</small>
                  </div>
                  {visibleSkuImageProblems.length ? (
                    <>
                      {visibleSkuImageProblemCards.map((problem, index) => {
                        const productProblemCount = skuImageProblemCountByProduct.get(problem.skuCode || problem.name) || 1;
                        const productProblemPosition = visibleSkuImageProblems
                          .slice(0, index + 1)
                          .filter((item) => (item.skuCode || item.name) === (problem.skuCode || problem.name)).length;
                        return (
                          <div className={`sku-image-problem-item ${problem.severity}`} key={`${problem.skuCode}-${problem.code}-${problem.imageIndex ?? "main"}-${index}`}>
                            <div>
                              <strong>{problem.skuCode || "未编号"} · {skuImageRoleLabel(problem)}</strong>
                              <span>{problem.name || "未命名商品"}</span>
                              <span className={`sku-image-problem-count ${productProblemCount > 1 ? "multiple" : ""}`}>
                                {"\u540c\u5546\u54c1 "}{productProblemCount}{" \u4e2a\u56fe\u7247\u95ee\u9898"}
                              </span>
                              <span className="sku-image-problem-field">
                                字段：{skuFieldLabel(problem.field)}
                              </span>
                              <span className="sku-image-problem-tracking-id">
                                问题标识：{skuImageProblemTrackingId(problem)}
                              </span>
                              <span className="sku-image-problem-action-group">
                                处理方式：{skuImageProblemActionGroupLabel(problem)}
                              </span>
                              <span className={`sku-image-problem-path-state ${problem.path ? "has-path" : "missing-path"}`}>
                                {skuImagePathStateLabel(problem.path)}
                              </span>
                              {productProblemCount > 1 ? (
                                <span className="sku-image-problem-position">
                                  同商品第 {productProblemPosition}/{productProblemCount} 个
                                </span>
                              ) : null}
                            </div>
                            <p>{problem.message}</p>
                            <div className={`sku-image-problem-advice ${problem.severity}`}>
                              <span>{skuSeverityLabel(problem.severity)}</span>
                              <strong>{skuImageProblemAction(problem)}</strong>
                            </div>
                            <div className="sku-image-problem-entry">
                              <span>修复入口</span>
                              <strong>{skuImageProblemRepairEntry(problem)}</strong>
                            </div>
                            <small>{problem.path || "未填写图片路径"}</small>
                            <div className="sku-image-problem-actions">
                              <button type="button" className="ghost compact-button" onClick={() => focusSkuImageProblemProduct(problem)} disabled={Boolean(busy)}>
                                <Search size={14} aria-hidden="true" />只看此商品
                              </button>
                              <button type="button" className="ghost compact-button" onClick={() => copySkuImageProblemProductHandoff(problem)} disabled={Boolean(busy)}>
                                <ClipboardList size={14} aria-hidden="true" />复制此商品
                              </button>
                              <button type="button" className="ghost compact-button" onClick={() => copySkuImageProblemTrackingId(problem)} disabled={Boolean(busy)}>
                                <ClipboardList size={14} aria-hidden="true" />复制标识
                              </button>
                              <button type="button" className="ghost compact-button" onClick={() => copySkuImageProblemPath(problem)} disabled={!problem.path || Boolean(busy)}>
                                <ClipboardList size={14} aria-hidden="true" />复制路径
                              </button>
                              <button type="button" className="ghost compact-button" onClick={() => copySkuImageProblemRepairEntry(problem)} disabled={Boolean(busy)}>
                                <ClipboardList size={14} aria-hidden="true" />复制入口
                              </button>
                              <button type="button" className="ghost compact-button" onClick={() => editSkuImageProblem(problem)} disabled={Boolean(busy)}>
                                <Pencil size={14} aria-hidden="true" />编辑图片
                              </button>
                              <button
                                type="button"
                                className="ghost danger compact-button"
                                onClick={() => stageSkuImageProblemFix(problem)}
                                disabled={!problem.path || Boolean(busy)}
                                title={problem.path ? `移除旧路径：${problem.path}` : "没有旧路径可移除，请先编辑图片补真实图"}
                              >
                                <X size={14} aria-hidden="true" />移除路径
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {remainingSkuImageProblemCount > 0 || skuImageProblemVisibleLimit > SKU_IMAGE_PROBLEM_PAGE_SIZE ? (
                        <div className="sku-image-problem-pager">
                          <small>已显示 {visibleSkuImageProblemCards.length} / {visibleSkuImageProblems.length} 个图片问题，当前筛选还剩 {remainingSkuImageProblemCount} 个。</small>
                          <div>
                            {remainingSkuImageProblemCount > 0 ? (
                              <>
                                <button type="button" className="ghost compact-button" onClick={showMoreSkuImageProblems} disabled={Boolean(busy)}>
                                  <Search size={14} aria-hidden="true" />再显示 {Math.min(SKU_IMAGE_PROBLEM_PAGE_SIZE, remainingSkuImageProblemCount)} 个
                                </button>
                                <button type="button" className="ghost compact-button" onClick={expandAllSkuImageProblems} disabled={Boolean(busy)}>
                                  <Search size={14} aria-hidden="true" />显示全部
                                </button>
                              </>
                            ) : null}
                            {skuImageProblemVisibleLimit > SKU_IMAGE_PROBLEM_PAGE_SIZE ? (
                              <button type="button" className="ghost compact-button" onClick={collapseSkuImageProblems} disabled={Boolean(busy)}>
                                <RefreshCw size={14} aria-hidden="true" />收起前 5 个
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="sku-image-problem-empty">
                      <Check size={16} aria-hidden="true" />
                      <span>
                        {skuImageProblemSearch.trim()
                          ? "当前搜索下没有图片问题，换个关键词或清空搜索。"
                          : skuImageProblemActionFilter !== "all"
                            ? "当前处理方式下没有图片问题，可切换其它处理方式或重置图片筛选。"
                          : skuImageProblemProductScope === "multiple"
                            ? "当前没有同商品多处图片问题，可关闭“只看多问题”查看全部补图任务。"
                            : "当前筛选下没有图片问题，切换严重程度查看其它补图任务。"}
                      </span>
                      {skuImageProblemProductScope === "multiple" && !skuImageProblemSearch.trim() ? (
                        <button type="button" className="ghost compact-button" onClick={showAllSkuImageProblems} disabled={Boolean(busy)}>
                          <RefreshCw size={14} aria-hidden="true" />查看全部图片问题
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            ) : null}
            {skuWorkbenchView === "catalog" ? (
            <>
            <div className="sku-batch-bar">
              <label>
                <input
                  type="checkbox"
                  checked={includeInactiveSkus}
                  onChange={(event) => toggleInactiveSkus(event.target.checked)}
                  aria-label="显示下架商品"
                />
                显示下架商品
              </label>
              <button type="button" className="ghost compact-button" onClick={selectVisibleSkus} disabled={!visibleSkus.length || Boolean(busy)}><Check size={14} aria-hidden="true" />选择当前列表</button>
              <button type="button" className="ghost compact-button" onClick={() => setSelectedSkuCodes([])} disabled={!selectedSkuCodes.length || Boolean(busy)}><RefreshCw size={14} aria-hidden="true" />清空选择</button>
              <button type="button" className="ghost compact-button" onClick={prepareDemoDesignMaterials} disabled={Boolean(busy)}><ImageIcon size={14} aria-hidden="true" />准备演示出图材料</button>
              <input aria-label="批量库存" value={skuBatchStock} onChange={(event) => setSkuBatchStock(event.target.value)} placeholder="批量库存" inputMode="numeric" />
              <input aria-label="批量售价" value={skuBatchSalePrice} onChange={(event) => setSkuBatchSalePrice(event.target.value)} placeholder="批量售价" inputMode="decimal" />
              <input aria-label="批量供应商" value={skuBatchSupplier} onChange={(event) => setSkuBatchSupplier(event.target.value)} placeholder="批量供应商" />
              <button type="button" className="primary compact-button" onClick={batchUpdateSelectedSkus} disabled={!selectedSkuCodes.length || Boolean(busy)}><Check size={14} aria-hidden="true" />批量修改</button>
              <button type="button" className="ghost danger compact-button" onClick={() => batchSetSkuActive(false)} disabled={!selectedSkuCodes.length || Boolean(busy)}><Ban size={14} aria-hidden="true" />批量下架</button>
              <button type="button" className="ghost compact-button" onClick={() => batchSetSkuActive(true)} disabled={!selectedSkuCodes.length || Boolean(busy)}><RefreshCw size={14} aria-hidden="true" />批量恢复</button>
              <span>已选 {selectedSkuCodes.length}</span>
            </div>
            <div className="sku-table" role="table" aria-label="商品库 SKU 列表">
              <div className="sku-row-header" role="row">
                <span role="columnheader">选择</span>
                <span role="columnheader">图片</span>
                <span role="columnheader">商品</span>
                <span role="columnheader">价格</span>
                <span role="columnheader">库存</span>
                <span role="columnheader">供应</span>
                <span role="columnheader">资料</span>
                <span role="columnheader">编辑</span>
                <span role="columnheader">状态</span>
              </div>
              {visibleSkus.map((sku) => {
                const issues = catalogIssuesBySku.get(sku.skuCode) || [];
                const profit = Number(sku.salePrice || 0) - Number(sku.costPrice || 0);
                const imageUrl = localAssetUrl(sku.mainImagePath);
                const automationSummary = skuAutomationSummary(sku, issues);
                return (
                  <div
                    aria-selected={selectedSkuCodes.includes(sku.skuCode)}
                    aria-label={`编辑商品 ${sku.name}`}
                    className={`sku-row ${sku.isActive === false ? "inactive" : ""}`}
                    key={sku.id}
                    onClick={(event) => openSkuFromRow(event, sku)}
                    onKeyDown={(event) => handleSkuRowKeyDown(event, sku)}
                    role="row"
                    tabIndex={0}
                    title="点击编辑商品，按空格切换选择"
                  >
                    <div className="sku-check" role="cell">
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedSkuCodes.includes(sku.skuCode)}
                          onChange={() => toggleSkuSelection(sku.skuCode)}
                          aria-label={`选择 ${sku.name}`}
                        />
                      </label>
                    </div>
                    <div className="sku-thumb" role="cell">
                      {imageUrl ? (
                        <SafeImagePreview src={imageUrl} alt={sku.name} fallbackLabel="图片不可用" iconSize={18} />
                      ) : (
                        <PackageSearch size={18} aria-hidden="true" />
                      )}
                    </div>
                    <strong role="cell">
                      {sku.name}
                      <small>{sku.category || sku.type} · {sku.skuCode}{sku.isActive === false ? " · 已下架" : ""}</small>
                    </strong>
                    <span role="cell">{formatMoney(Number(sku.salePrice || 0))} 元 / 成本 {formatMoney(Number(sku.costPrice || 0))}</span>
                    <span role="cell">利润 {formatMoney(profit)} · 库存 {sku.stock}</span>
                    <span role="cell">{sku.supplier || "缺供应商"} · 交期 {sku.leadTimeDays || "-"} 天</span>
                    <span role="cell">
                      {sku.mainImagePath ? "有主图" : "缺主图"} · {(sku.sceneTags || []).slice(0, 2).join("、") || "缺场景"}
                      <small className={`sku-automation-pill ${automationSummary.tone}`}>{automationSummary.label} · {automationSummary.detail}</small>
                    </span>
                    <span className="sku-action-cell" role="cell">
                      <button type="button" className="ghost compact-button" onClick={() => editSku(sku)} disabled={Boolean(busy)}><ClipboardList size={14} aria-hidden="true" />编辑</button>
                      {sku.isActive === false ? (
                        <button type="button" className="ghost compact-button" onClick={() => updateSkuActive(sku, true)} disabled={Boolean(busy)}><RefreshCw size={14} aria-hidden="true" />恢复</button>
                      ) : (
                        <button type="button" className="ghost danger compact-button" onClick={() => updateSkuActive(sku, false)} disabled={Boolean(busy)}><Ban size={14} aria-hidden="true" />下架</button>
                      )}
                    </span>
                    <span
                      className={`sku-status-cell ${issues.length ? "warning" : sku.isActive === false ? "muted" : "ok"}`}
                      role="cell"
                      title={issues.length ? issues.map((issue) => issue.message).join("；") : undefined}
                    >
                      <strong>{issues.length ? `${issues.length}项待补` : sku.isActive === false ? "已下架" : "可销售"}</strong>
                      <small>{issues.length ? issues.slice(0, 2).map((issue) => issue.message).join("；") : "资料就绪"}</small>
                    </span>
                  </div>
                );
              })}
              {!visibleSkus.length ? (
                <div className="empty empty-cta sku-table-empty" role="row">
                  <div role="cell" aria-colspan={9}>
                    <strong>没有匹配的商品</strong>
                    <span>可以清空筛选，或切到新增商品视图录入真实 SKU。</span>
                    <div className="empty-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          setSkuSearch("");
                          setSkuTypeFilter("all");
                          setSkuIssueFilter("all");
                        }}
                      >
                        <RefreshCw size={16} aria-hidden="true" />清空筛选
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          resetSkuForm();
                          setSkuWorkbenchView("editor");
                        }}
                        disabled={Boolean(busy)}
                      >
                        <Pencil size={16} aria-hidden="true" />新增 SKU
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            </>
            ) : null}
            {skuWorkbenchView === "editor" ? (
            <div className="sku-editor">
              <div className="sku-editor-head">
                <strong>{skuForm.skuCode ? "编辑/新增商品" : "新增真实商品"}</strong>
                <span>保存后立即进入 SKU 库，并参与搭配、体检和报价计算</span>
              </div>
              <div className="catalog-actions sku-editor-toolbar">
                <button type="button" className="primary" onClick={saveSkuForm} disabled={Boolean(busy)}>
                  <Check size={16} aria-hidden="true" />保存商品
                </button>
                <button type="button" className="ghost" onClick={resetSkuForm} disabled={Boolean(busy)}>
                  <RefreshCw size={16} aria-hidden="true" />清空表单
                </button>
              </div>
              {activeSkuRepairItem ? (
                <div className={`sku-active-repair-brief ${activeSkuRepairItem.severity}`} role="status" aria-label="当前商品补齐说明">
                  <div className="sku-active-repair-head">
                    <div>
                      <small>当前商品补齐</small>
                      <strong>{activeSkuRepairItem.name || skuForm.name || "未命名商品"}</strong>
                      <span>
                        {activeSkuRepairItem.skuCode || skuForm.skuCode || "缺 SKU 编号"} · {skuSeverityLabel(activeSkuRepairItem.severity)}
                        · 优先级 {activeSkuRepairItem.priority} · {activeSkuRepairItem.issueCount} 个问题
                      </span>
                    </div>
                    <em>{activeSkuRepairItem.blocking ? "会阻塞自动化" : "保存后复核"}</em>
                  </div>
                  <p>{activeSkuRepairItem.recommendedAction}</p>
                  <div className="sku-active-repair-impact">
                    <span>{activeSkuRepairItem.blocking ? "补齐后才建议进入自动搭配、真实出图和自动报价。" : "补齐后商品会更适合自动搭配和客服报价。"}</span>
                    <button type="button" className="ghost compact-button" onClick={() => setSkuWorkbenchView("repair")}>
                      <Search size={14} aria-hidden="true" />回到补齐队列
                    </button>
                  </div>
                  {activeSkuRepairProgress ? (
                    <div className={`sku-active-repair-progress ${activeSkuRepairProgress.tone}`} role="status" aria-label="补齐进度判断">
                      <div>
                        <small>当前填写后判断</small>
                        <strong>{activeSkuRepairProgress.label}</strong>
                        <span>{activeSkuRepairProgress.detail}</span>
                      </div>
                      <p>
                        <span className="done">已补 {activeSkuRepairProgress.resolvedFields.length}</span>
                        <span className="pending">待补 {activeSkuRepairProgress.unresolvedFields.length}</span>
                        <span>保存后 {skuFormAutomationStatus.label}</span>
                      </p>
                    </div>
                  ) : null}
                  {activeSkuRepairItem.missingFields.length ? (
                    <div className="sku-active-repair-fields" aria-label="需要补齐的字段">
                      {activeSkuRepairItem.missingFields.slice(0, 6).map((field) => (
                        <button
                          type="button"
                          key={field.field}
                          onClick={() => focusSkuFormField(field.field, field.label)}
                          title={`定位到${field.label || skuFieldLabel(field.field)}`}
                        >
                          <strong>{field.label || skuFieldLabel(field.field)}</strong>
                          <small>{field.action || "补齐这个字段后保存商品。"}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {activeSkuRepairItem.issues.length ? (
                    <div className="sku-active-repair-issues" aria-label="当前商品体检问题">
                      {activeSkuRepairItem.issues.slice(0, 4).map((issue, index) => (
                        <span className={issue.severity} key={`${issue.code}-${issue.field || "field"}-${index}`}>
                          {skuSeverityLabel(issue.severity)} · {skuFieldLabel(issue.field || "")} · {issue.message}
                        </span>
                      ))}
                      {activeSkuRepairItem.issues.length > 4 ? <small>还有 {activeSkuRepairItem.issues.length - 4} 个体检问题，保存后会重新计算。</small> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className={`sku-form-automation-preview ${skuFormAutomationStatus.tone}`} role="status">
                <div>
                  <small>保存后自动化预估</small>
                  <strong>{skuFormAutomationStatus.label}</strong>
                  <span>{skuFormAutomationStatus.detail}</span>
                </div>
                <p>
                  {skuFormAutomationStatus.chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </p>
              </div>
              <div className={`sku-form-pricing-preview ${skuFormPricingStatus.tone}`} role="status">
                <div>
                  <small>价格利润预览</small>
                  <strong>{skuFormPricingStatus.label}</strong>
                  <span>{skuFormPricingStatus.detail}</span>
                </div>
                <p>
                  <span>售价 {formatMoney(skuFormPricingStatus.salePrice)} 元</span>
                  <span>成本 {formatMoney(skuFormPricingStatus.costPrice)} 元</span>
                  <span>毛利 {formatMoney(skuFormPricingStatus.profit)} 元</span>
                  <span>毛利率 {Math.round(skuFormPricingStatus.marginRate * 100)}%</span>
                </p>
              </div>
              <div className={`sku-form-specification-preview ${skuFormSpecificationStatus.tone}`} role="status">
                <div>
                  <small>规格交付预览</small>
                  <strong>{skuFormSpecificationStatus.label}</strong>
                  <span>{skuFormSpecificationStatus.detail}</span>
                </div>
                <p>
                  {skuFormSpecificationStatus.chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </p>
              </div>
              {skuFormReferenceWarnings.length ? (
                <div className="sku-form-reference-warning" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>SKU 引用检查</strong>
                    {skuFormReferenceWarnings.slice(0, 3).map((warning) => (
                      <span key={`${warning.field}-${warning.skuCode}`}>{warning.message}</span>
                    ))}
                    {skuFormReferenceWarnings.length > 3 ? <small>还有 {skuFormReferenceWarnings.length - 3} 个引用问题，保存后商品体检也会继续提示。</small> : null}
                  </div>
                </div>
              ) : null}
              {skuFormReferenceMatches.length ? (
                <div className="sku-form-reference-matches" role="status" aria-label="已识别 SKU 引用">
                  <strong>已识别引用</strong>
                  <p>
                    {skuFormReferenceMatches.slice(0, 8).map((match) => (
                      <span key={`${match.field}-${match.skuCode}`}>{match.label} · {match.skuCode} · {match.name}</span>
                    ))}
                  </p>
                  {skuFormReferenceMatches.length > 8 ? <small>还有 {skuFormReferenceMatches.length - 8} 个引用已识别。</small> : null}
                </div>
              ) : null}
              {skuFormImageChangeSummary ? (
                <div className="sku-form-readiness-warning sku-form-image-change-summary" role="status">
                  <ImageIcon size={16} aria-hidden="true" />
                  <div>
                    <strong>待保存图片变更</strong>
                    <span>{skuFormImageChangeSummary}</span>
                    <button type="button" className="ghost compact-button" onClick={copySkuFormImageChangeSummary} disabled={Boolean(busy)}>
                      <ClipboardList size={14} aria-hidden="true" />复制变更
                    </button>
                  </div>
                </div>
              ) : null}
              {skuFormReadinessWarnings.length ? (
                <div className="sku-form-readiness-warning sku-form-readiness-summary">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    <strong>保存前资料检查</strong>
                    {skuFormReadinessWarnings.slice(0, 2).map((warning, index) => (
                      <span key={`${warning.field}-${warning.path}-${index}`}>
                        {warning.message}{warning.path ? `：${warning.path}` : ""}
                      </span>
                    ))}
                    {skuFormReadinessWarnings.length > 2 ? <small>还有 {skuFormReadinessWarnings.length - 2} 个资料提醒，保存后商品体检会继续列出。</small> : null}
                  </div>
                </div>
              ) : null}
              <div className="sku-form-grid">
                <label className="field-control">
                  <span>SKU 编号</span>
                  <input id="sku-form-skuCode" value={skuForm.skuCode} onChange={(event) => setSkuForm({ ...skuForm, skuCode: event.target.value })} placeholder="BOX-001" />
                </label>
                <label className="field-control">
                  <span>商品名称</span>
                  <input id="sku-form-name" value={skuForm.name} onChange={(event) => setSkuForm({ ...skuForm, name: event.target.value })} placeholder="端午茶礼盒" />
                </label>
                <div className="field-control field-control-inline" id="sku-form-type">
                  <span>商品类型</span>
                  <div className="segmented-control sku-type-picker" role="group" aria-label="商品类型">
                    {skuFormTypeOptions.map((option) => (
                      <button
                        className={skuForm.type === option.value ? "selected" : ""}
                        key={option.value}
                        onClick={() => setSkuForm({ ...skuForm, type: option.value })}
                        aria-pressed={skuForm.type === option.value}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field-control">
                  <span>分类</span>
                  <input id="sku-form-category" value={skuForm.category} onChange={(event) => setSkuForm({ ...skuForm, category: event.target.value })} placeholder="茶叶 / 贺卡" />
                </label>
                <label className="field-control">
                  <span>售价</span>
                  <input id="sku-form-salePrice" value={skuForm.salePrice} onChange={(event) => setSkuForm({ ...skuForm, salePrice: event.target.value })} placeholder="180" inputMode="decimal" />
                </label>
                <label className="field-control">
                  <span>成本价</span>
                  <input id="sku-form-costPrice" value={skuForm.costPrice} onChange={(event) => setSkuForm({ ...skuForm, costPrice: event.target.value })} placeholder="120" inputMode="decimal" />
                </label>
                <label className="field-control">
                  <span>库存</span>
                  <input id="sku-form-stock" value={skuForm.stock} onChange={(event) => setSkuForm({ ...skuForm, stock: event.target.value })} placeholder="300" inputMode="numeric" />
                </label>
                <label className="field-control">
                  <span>场景标签</span>
                  <input id="sku-form-sceneTags" value={skuForm.sceneTags} onChange={(event) => setSkuForm({ ...skuForm, sceneTags: event.target.value })} placeholder="端午、员工福利" />
                </label>
                <label className="field-control">
                  <span>主图路径</span>
                  <input id="sku-form-mainImagePath" value={skuForm.mainImagePath} onChange={(event) => setSkuForm({ ...skuForm, mainImagePath: event.target.value })} placeholder="本地路径或 URL" />
                </label>
                <label className="field-control">
                  <span>多角度图</span>
                  <input id="sku-form-angleImages" value={skuForm.angleImages} onChange={(event) => setSkuForm({ ...skuForm, angleImages: event.target.value })} placeholder="用顿号分隔" />
                </label>
                <label className="field-control">
                  <span>尺寸</span>
                  <input id="sku-form-dimensions" value={skuForm.dimensions} onChange={(event) => setSkuForm({ ...skuForm, dimensions: event.target.value })} placeholder="30*22*9" />
                </label>
                <label className="field-control">
                  <span>重量</span>
                  <input id="sku-form-weightGram" value={skuForm.weightGram} onChange={(event) => setSkuForm({ ...skuForm, weightGram: event.target.value })} placeholder="克" inputMode="numeric" />
                </label>
                <label className="field-control">
                  <span>材质</span>
                  <input id="sku-form-material" value={skuForm.material} onChange={(event) => setSkuForm({ ...skuForm, material: event.target.value })} placeholder="纸盒 / 棉麻 / 金属" />
                </label>
                <label className="field-control">
                  <span>供应商</span>
                  <input id="sku-form-supplier" value={skuForm.supplier} onChange={(event) => setSkuForm({ ...skuForm, supplier: event.target.value })} placeholder="供应商名称" />
                </label>
                <label className="field-control">
                  <span>交期</span>
                  <input id="sku-form-leadTimeDays" value={skuForm.leadTimeDays} onChange={(event) => setSkuForm({ ...skuForm, leadTimeDays: event.target.value })} placeholder="天数" inputMode="numeric" />
                </label>
                <label className="field-control">
                  <span>替代 SKU</span>
                  <input id="sku-form-replacementSkuCodes" list="sku-reference-options" value={skuForm.replacementSkuCodes} onChange={(event) => setSkuForm({ ...skuForm, replacementSkuCodes: event.target.value })} placeholder="用顿号分隔" />
                  {skuReferenceQuickOptions.length ? (
                    <div className="sku-reference-quick-picks" aria-label="快速追加替代 SKU">
                      {skuReferenceQuickOptions.map((option) => (
                        <button
                          type="button"
                          key={`replacement-${option.skuCode}`}
                          onClick={() => setSkuForm({ ...skuForm, replacementSkuCodes: appendSkuCodeTextList(skuForm.replacementSkuCodes, option.skuCode) })}
                          title={option.label}
                        >
                          {option.skuCode}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </label>
              </div>
              <datalist id="sku-reference-options">
                {skuReferenceOptions.map((option) => (
                  <option key={option.skuCode} value={option.skuCode} label={option.label} />
                ))}
              </datalist>
              <div className="sku-image-tools">
                <label className="file-button">
                  <ImageIcon size={16} aria-hidden="true" />上传主图
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      uploadSkuImage(event.currentTarget.files?.[0], "main");
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <label className="file-button">
                  <FileUp size={16} aria-hidden="true" />上传多角度图
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      uploadSkuImage(event.currentTarget.files?.[0], "angle");
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <small>图片保存到本地素材库，保存商品后会参与 SKU 搭配和设计出图。</small>
              </div>
              <div className="sku-matching-rule-editor">
                <div className="sku-matching-rule-head">
                  <strong>搭配规则</strong>
                  <span>填写 SKU 编号，多个用顿号或逗号分隔；系统推荐礼盒组合时会按这些规则避坑。</span>
                </div>
                <div className="sku-matching-rule-grid">
                  <label className="field-control">
                    <span>必须同搭</span>
                    <input
                      id="sku-form-matching-must-with"
                      list="sku-reference-options"
                      value={matchingRuleListText(skuForm.matchingRules, "mustWith")}
                      onChange={(event) =>
                        setSkuForm({
                          ...skuForm,
                          matchingRules: withMatchingRuleList(skuForm.matchingRules, "mustWith", event.target.value),
                        })
                      }
                      placeholder="例如 CARD-B"
                    />
                    {skuReferenceQuickOptions.length ? (
                      <div className="sku-reference-quick-picks" aria-label="快速追加必须同搭 SKU">
                        {skuReferenceQuickOptions.map((option) => (
                          <button
                            type="button"
                            key={`mustWith-${option.skuCode}`}
                            onClick={() => setSkuForm({ ...skuForm, matchingRules: withAppendedMatchingRuleSku(skuForm.matchingRules, "mustWith", option.skuCode) })}
                            title={option.label}
                          >
                            {option.skuCode}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label className="field-control">
                    <span>推荐同搭</span>
                    <input
                      id="sku-form-matching-prefer-with"
                      list="sku-reference-options"
                      value={matchingRuleListText(skuForm.matchingRules, "preferWith")}
                      onChange={(event) =>
                        setSkuForm({
                          ...skuForm,
                          matchingRules: withMatchingRuleList(skuForm.matchingRules, "preferWith", event.target.value),
                        })
                      }
                      placeholder="例如 TEA-C"
                    />
                    {skuReferenceQuickOptions.length ? (
                      <div className="sku-reference-quick-picks" aria-label="快速追加推荐同搭 SKU">
                        {skuReferenceQuickOptions.map((option) => (
                          <button
                            type="button"
                            key={`preferWith-${option.skuCode}`}
                            onClick={() => setSkuForm({ ...skuForm, matchingRules: withAppendedMatchingRuleSku(skuForm.matchingRules, "preferWith", option.skuCode) })}
                            title={option.label}
                          >
                            {option.skuCode}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label className="field-control">
                    <span>禁止同搭</span>
                    <input
                      id="sku-form-matching-cannot-with"
                      list="sku-reference-options"
                      value={matchingRuleListText(skuForm.matchingRules, "cannotWith")}
                      onChange={(event) =>
                        setSkuForm({
                          ...skuForm,
                          matchingRules: withMatchingRuleList(skuForm.matchingRules, "cannotWith", event.target.value),
                        })
                      }
                      placeholder="例如 SNACK-A"
                    />
                    {skuReferenceQuickOptions.length ? (
                      <div className="sku-reference-quick-picks" aria-label="快速追加禁止同搭 SKU">
                        {skuReferenceQuickOptions.map((option) => (
                          <button
                            type="button"
                            key={`cannotWith-${option.skuCode}`}
                            onClick={() => setSkuForm({ ...skuForm, matchingRules: withAppendedMatchingRuleSku(skuForm.matchingRules, "cannotWith", option.skuCode) })}
                            title={option.label}
                          >
                            {option.skuCode}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                </div>
                <label className="field-control field-control-wide">
                  <span>高级规则 / 备注</span>
                  <textarea
                    id="sku-form-matching-rules"
                    value={skuForm.matchingRules}
                    onChange={(event) => setSkuForm({ ...skuForm, matchingRules: event.target.value })}
                    placeholder='可写文字，也可写 JSON，例如 {"mustWith":["CARD-B"],"preferWith":["TEA-C"],"cannotWith":["SNACK-A"]}'
                  />
                </label>
              </div>
            </div>
            ) : null}
          </section>

          <section className="panel" id="notice-center">
            <div className="panel-head">
              <div>
                <h2><Bell size={17} aria-hidden="true" />提醒</h2>
                <span>生成完成、失败、超时、高价值转人工</span>
              </div>
              <div className="notice-view-switcher segmented-control" role="group" aria-label="提醒中心视图">
                <button
                  type="button"
                  className={noticeWorkbenchView === "automation" ? "selected" : ""}
                  aria-pressed={noticeWorkbenchView === "automation"}
                  onClick={() => setNoticeWorkbenchView("automation")}
                >
                  后台控制
                </button>
                <button
                  type="button"
                  className={noticeWorkbenchView === "issues" ? "selected" : ""}
                  aria-pressed={noticeWorkbenchView === "issues"}
                  onClick={() => setNoticeWorkbenchView("issues")}
                >
                  待处理
                </button>
                <button
                  type="button"
                  className={noticeWorkbenchView === "history" ? "selected" : ""}
                  aria-pressed={noticeWorkbenchView === "history"}
                  onClick={() => setNoticeWorkbenchView("history")}
                >
                  运行记录
                </button>
              </div>
              <div className="notice-actions">
                {noticeWorkbenchView === "automation" ? (
                  <>
                    <button type="button" className="primary" onClick={runAutomationCycle} disabled={Boolean(busy)}><Bot size={16} aria-hidden="true" />后台跑一轮</button>
                    <button type="button" className="ghost" onClick={toggleAutomationActive} disabled={Boolean(busy) || !automationStatus?.enabled}>
                      {automationStatus?.active ? <Ban size={16} aria-hidden="true" /> : <Bot size={16} aria-hidden="true" />}
                      {automationStatus?.active ? "暂停后台" : "开启后台"}
                    </button>
                    <button type="button" className="primary" onClick={runLowValueAutomation} disabled={Boolean(busy)}><Check size={16} aria-hidden="true" />低价值自动处理</button>
                    <button type="button" className="ghost" onClick={autoSubmitDrafts} disabled={Boolean(busy)}><Send size={16} aria-hidden="true" />自动提交草稿</button>
                    <button type="button" className="ghost" onClick={scanTimeouts} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />扫描超时</button>
                  </>
                ) : null}
                {noticeWorkbenchView === "issues" ? (
                  <>
                    <button type="button" className="primary" onClick={runLowValueAutomation} disabled={Boolean(busy)}><Check size={16} aria-hidden="true" />处理低价值</button>
                    <button type="button" className="ghost danger" onClick={handoffHighValueJobs} disabled={Boolean(busy)}><ShieldAlert size={16} aria-hidden="true" />高价值转人工</button>
                    <button type="button" className="ghost" onClick={readAllNotices} disabled={!unreadNoticeCount || Boolean(busy)}><Bell size={16} aria-hidden="true" />全部已读</button>
                  </>
                ) : null}
                {noticeWorkbenchView === "history" ? (
                  <>
                    <button type="button" className="ghost" onClick={scanTimeouts} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />扫描超时</button>
                    <button type="button" className="ghost" onClick={createTimeoutDemo} disabled={Boolean(busy)}><AlertTriangle size={16} aria-hidden="true" />超时演示</button>
                    <button type="button" className="ghost" onClick={createFailureDemo} disabled={Boolean(busy)}><Ban size={16} aria-hidden="true" />失败演示</button>
                  </>
                ) : null}
              </div>
            </div>
            {noticeWorkbenchView === "automation" && automationRuntimeItems.length ? (
              <div className="automation-runtime-strip" aria-label="低价值后台自动化运行状态">
                {automationRuntimeItems.map((item) => (
                  <button
                    type="button"
                    className={item.tone}
                    key={item.label}
                    onClick={() => handleAutomationRuntimeItem(item.label)}
                    disabled={Boolean(busy) || (item.label === "后台状态" && !automationStatus?.enabled)}
                    title={`${item.label}：${item.value}`}
                  >
                    <small>{item.label}</small>
                    <b>{item.value}</b>
                  </button>
                ))}
              </div>
            ) : null}
            {noticeWorkbenchView === "automation" && automationReadiness ? (
              <div className={`automation-readiness ${automationReadiness.tone}`} aria-label="低价值自动化开机检查">
                <div className="automation-readiness-head">
                  <div>
                    <strong>{automationReadiness.ready ? "低价值自动化可开启" : "低价值自动化暂不建议开启"}</strong>
                    <span>{automationReadiness.summary} · {formatDateTime(automationReadiness.checkedAt)}</span>
                  </div>
                  <button type="button" className="ghost compact-button" onClick={() => void load()} disabled={Boolean(busy)}>
                    <RefreshCw size={14} aria-hidden="true" />刷新检查
                  </button>
                  <button
                    type="button"
                    className={`primary compact-button ${automationReadiness.ready ? "soft" : ""}`}
                    onClick={handleAutomationReadinessPrimaryCheck}
                    disabled={Boolean(busy) || !automationReadinessPrimaryCheck}
                    title={automationReadinessPrimaryCheck?.action || automationReadinessPrimaryCheck?.detail || "处理首个问题"}
                  >
                    <AlertTriangle size={14} aria-hidden="true" />
                    {automationReadiness.ready ? "查看检查" : "处理首个问题"}
                  </button>
                </div>
                <div className="automation-readiness-metrics">
                  <span><small>草稿</small><b>{automationReadiness.metrics.lowValueDrafts}</b></span>
                  <span><small>待发图</small><b>{automationReadiness.metrics.quickConfirmJobs}</b></span>
                  <span><small>发送队列</small><b>{automationReadiness.metrics.pendingSendTasks}</b></span>
                  <span><small>人工接管</small><b>{automationReadiness.metrics.manualLockedConversations}</b></span>
                  <span><small>商品可用</small><b>{automationReadiness.metrics.catalogReadyCount}</b></span>
                  <span><small>商品阻断</small><b>{automationReadiness.metrics.catalogBlockingRepairCount}</b></span>
                </div>
                <div className="automation-readiness-checks">
                  {automationReadiness.checks.map((check) => (
                    <button
                      type="button"
                      className={check.severity}
                      key={check.key}
                      onClick={() => void handleAutomationReadinessCheck(check)}
                      disabled={Boolean(busy)}
                      title={check.action || check.detail}
                    >
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                      <em>{check.ok ? "查看" : "去处理"}</em>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "history" && automationRunHistorySummary ? (
              <div className={`automation-history-summary ${automationRunHistorySummary.tone}`}>
                <div>
                  <strong>{automationRunHistorySummary.title}</strong>
                  <span>{automationRunHistorySummary.detail}</span>
                </div>
                <div className="automation-history-grid">
                  {automationRunHistorySummary.metrics.map((metric) => (
                    <button
                      type="button"
                      className={metric.tone || ""}
                      key={metric.label}
                      onClick={() => scrollToWorkspaceSection("notice-center")}
                      disabled={Boolean(busy)}
                      title="查看最近运行记录"
                    >
                      <small>{metric.label}</small>
                      <b>{metric.value}</b>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "history" && automationRunHistoryItems.length ? (
              <div className="automation-history-list" aria-label="最近低价值后台自动化运行记录">
                <div className="automation-history-list-head">
                  <strong>最近运行记录</strong>
                  <span>最多保留 10 轮，最新在最前面。</span>
                </div>
                {automationRunHistoryItems.map((item) => (
                  <div className={`automation-history-row ${item.tone}`} key={item.key}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                    </div>
                    <span>
                      <small>结果</small>
                      <b>{item.result}</b>
                    </span>
                    <span>
                      <small>耗时</small>
                      <b>{item.duration}</b>
                    </span>
                    <span>
                      <small>失败步骤</small>
                      <b>{item.failedStep}</b>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {noticeWorkbenchView === "history" && lowValueAutomationIdentityAudit ? (
              <div className={`automation-identity-audit ${lowValueAutomationIdentityAudit.status}`} aria-label="上一轮自动化身份审计">
                <div>
                  <strong>{lowValueAutomationIdentityAudit.status === "warning" ? "上一轮身份审计有警告" : "上一轮身份审计通过"}</strong>
                  <span>
                    涉及 {lowValueAutomationIdentityAudit.identityCount} 个客户会话，
                    警告 {lowValueAutomationIdentityAudit.warnings.length} 个。
                  </span>
                </div>
                <div className="automation-identity-grid">
                  {lowValueAutomationIdentityAudit.warnings.slice(0, 3).map((warning) => (
                    <span className="warning" key={`${warning.step}:${warning.path}:${warning.reason}`}>
                      <small>{automationStepLabel(warning.step)}</small>
                      <b>{automationIdentityWarningLabel(warning.reason, warning.fields)}</b>
                    </span>
                  ))}
                  {!lowValueAutomationIdentityAudit.warnings.length
                    ? lowValueAutomationIdentityAudit.identities.slice(0, 4).map((identity) => (
                        <span className="ok" key={identity.key}>
                          <small>{identity.wechatAccountId || "全局账号"}</small>
                          <b>{identity.conversationId || identity.customerId || "未绑定会话"}</b>
                        </span>
                      ))
                    : null}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "history" && lowValueAutomationSkipSummary ? (
              <div className="automation-skip-summary" aria-label="上一轮自动化跳过原因汇总">
                <div>
                  <strong>{lowValueAutomationSkipSummary.title}</strong>
                  <span>{lowValueAutomationSkipSummary.detail}</span>
                </div>
                <div className="automation-skip-grid">
                  {lowValueAutomationSkipSummary.reasons.map((item) => (
                    <span className={item.tone} key={item.reason}>
                      <small>{item.steps}</small>
                      <b>{item.label} · {item.count}</b>
                      <em>{item.sampleTargets}</em>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "automation" && lowValueAutomationSummary ? (
              <div className={`automation-summary ${lowValueAutomationSummary.tone}`}>
                <div>
                  <strong>{lowValueAutomationSummary.title}</strong>
                  <span>{lowValueAutomationSummary.subtitle}</span>
                </div>
                <div className="automation-summary-grid">
                  {lowValueAutomationSummary.metrics.map((item) => (
                    <button
                      type="button"
                      key={item.label}
                      onClick={() => handleLowValueAutomationSummaryMetric(item.label)}
                      disabled={Boolean(busy)}
                      title={`${item.label}：${item.value}`}
                    >
                      <small>{item.label}</small>
                      <b>{item.value}</b>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "history" && lowValueAutomationStepItems.length ? (
              <div className="automation-step-panel" aria-label="上一轮低价值自动化步骤">
                <div className="automation-step-head">
                  <strong>上一轮执行步骤</strong>
                  <span>每一步都单独记录，哪一步失败不会吞掉其他步骤。</span>
                </div>
                {lowValueAutomationStepInsight ? (
                  <div className={`automation-step-insight ${lowValueAutomationStepInsight.tone}`}>
                    <div>
                      <strong>{lowValueAutomationStepInsight.title}</strong>
                      <span>{lowValueAutomationStepInsight.detail}</span>
                    </div>
                    <div className="automation-step-insight-grid">
                      {lowValueAutomationStepInsight.metrics.map((metric) => (
                        <button
                          type="button"
                          className={metric.tone || ""}
                          key={metric.label}
                          onClick={() => scrollToWorkspaceSection("notice-center")}
                          disabled={Boolean(busy)}
                          title="查看上一轮步骤"
                        >
                          <small>{metric.label}</small>
                          <b>{metric.value}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="automation-step-list">
                  {lowValueAutomationStepItems.map((item) => (
                    <button
                      type="button"
                      className={item.tone}
                      key={item.key}
                      onClick={() => handleAutomationStepItem(item.key)}
                      disabled={Boolean(busy)}
                      title={`${item.label}：${item.detail}`}
                    >
                      <small>{item.label}</small>
                      <b>{item.detail}</b>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "history" && !automationRunHistorySummary && !automationRunHistoryItems.length && !lowValueAutomationStepItems.length ? (
              <div className="empty empty-cta notice-history-empty" role="status">
                <strong>暂无运行记录</strong>
                <span>后台自动化跑完后会在这里显示结果、耗时和失败步骤。</span>
                <div className="empty-actions">
                  <button type="button" className="primary" onClick={runAutomationCycle} disabled={Boolean(busy)}>
                    <Bot size={16} aria-hidden="true" />后台跑一轮
                  </button>
                  <button type="button" className="ghost" onClick={createTimeoutDemo} disabled={Boolean(busy)}>
                    <AlertTriangle size={16} aria-hidden="true" />超时演示
                  </button>
                  <button type="button" className="ghost" onClick={createFailureDemo} disabled={Boolean(busy)}>
                    <Ban size={16} aria-hidden="true" />失败演示
                  </button>
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "issues" && lowValueAutomationIssues.length ? (
              <div className="automation-issue-panel">
                {lowValueAutomationIssueSummary ? (
                  <div className="automation-issue-summary">
                    <div>
                      <strong>本轮有 {lowValueAutomationIssueSummary.total} 个卡点</strong>
                      <span>先处理错误和缺发送对象，处理完再重新跑低价值自动化。</span>
                    </div>
                    <div className="automation-issue-summary-grid">
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.errors ? "error" : ""}
                        onClick={() => handleAutomationIssueMetric("errors")}
                        disabled={Boolean(busy) || !lowValueAutomationIssueSummary.errors}
                      >
                        <small>错误</small>
                        <b>{lowValueAutomationIssueSummary.errors}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.warnings ? "warning" : ""}
                        onClick={() => handleAutomationIssueMetric("warnings")}
                        disabled={Boolean(busy) || !lowValueAutomationIssueSummary.warnings}
                      >
                        <small>提醒</small>
                        <b>{lowValueAutomationIssueSummary.warnings}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.missingFields ? "warning" : ""}
                        onClick={() => handleAutomationIssueMetric("missing")}
                        disabled={Boolean(busy) || !lowValueAutomationIssueSummary.missingFields}
                      >
                        <small>缺字段</small>
                        <b>{lowValueAutomationIssueSummary.missingFields}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.sendTargets ? "error" : ""}
                        onClick={() => handleAutomationIssueMetric("sendTargets")}
                        disabled={Boolean(busy) || !lowValueAutomationIssueSummary.sendTargets}
                      >
                        <small>发送对象</small>
                        <b>{lowValueAutomationIssueSummary.sendTargets}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.manualLocks ? "warning" : ""}
                        onClick={() => handleAutomationIssueMetric("manualLocks")}
                        disabled={Boolean(busy) || !lowValueAutomationIssueSummary.manualLocks}
                      >
                        <small>人工接管</small>
                        <b>{lowValueAutomationIssueSummary.manualLocks}</b>
                      </button>
                    </div>
                    {lowValueAutomationIssueSummary.firstIssue ? (
                      <button
                        type="button"
                        className="primary compact-button"
                        onClick={() => {
                          const firstIssue = lowValueAutomationIssueSummary.firstIssue;
                          if (firstIssue) handleLowValueAutomationIssue(firstIssue);
                        }}
                        disabled={Boolean(busy)}
                      >
                        <Search size={14} aria-hidden="true" />处理第一个卡点
                      </button>
                    ) : null}
                    <div className="automation-issue-resolution">
                      <strong>{lowValueAutomationIssueSummary.resolutionLabel}</strong>
                      <span>{lowValueAutomationIssueSummary.resolutionDetail}</span>
                      <button
                        type="button"
                        className="ghost compact-button"
                        onClick={lowValueAutomationIssueSummary.resolutionAction === "scan_send_ops" ? scanSendOps : runLowValueAutomation}
                        disabled={Boolean(busy)}
                      >
                        {lowValueAutomationIssueSummary.resolutionAction === "scan_send_ops" ? (
                          <ShieldAlert size={14} aria-hidden="true" />
                        ) : (
                          <Check size={14} aria-hidden="true" />
                        )}
                        {lowValueAutomationIssueSummary.resolutionButtonLabel}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="automation-issue-head">
                  <div>
                    <strong>低价值自动化待处理</strong>
                    <span>最近一轮低价值自动处理链路里需要人工补齐的问题</span>
                  </div>
                  <em>{lowValueAutomationIssues.length} 项</em>
                </div>
                <div className="automation-issue-list">
                  {lowValueAutomationIssues.map((issue) => {
                    const nextStep = lowValueIssueNextStep(issue);
                    const priority = lowValueIssuePriority(issue);
                    const issueSelected = activeAutomationIssueKey === issue.key;
                    return (
                      <div
                        aria-current={issueSelected ? "true" : undefined}
                        className={`automation-issue-item ${issue.tone} ${issueSelected ? "selected" : ""}`}
                        key={issue.key}
                      >
                        <div>
                          <strong>{issue.stage}</strong>
                          <span>{issue.target}</span>
                          <em className={`automation-issue-priority ${priority.tone}`}>{priority.label}</em>
                        </div>
                        <p>
                          <strong>{issue.title}</strong>
                          <span>{issue.detail || issue.reason}</span>
                        </p>
                        <div className="automation-issue-fields">
                          {issue.missing.length ? issue.missing.map((field) => <span key={field}>{lowValueMissingFieldLabel(field)}</span>) : <span>无字段缺失</span>}
                        </div>
                        <div className="automation-issue-next">
                          <strong>{nextStep.label}</strong>
                          <span>{nextStep.detail}</span>
                          <small>{issue.action}</small>
                        </div>
                        <button className="ghost compact-button" onClick={() => handleLowValueAutomationIssue(issue)} disabled={Boolean(busy)} type="button">
                          <Search size={14} aria-hidden="true" />{nextStep.buttonLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {noticeWorkbenchView === "issues" ? (
              <div className="notice-list">
                {notifications.length ? (
                  notifications.slice(0, 6).map((notice) => (
                    <article
                      className={`notice ${noticeTone(notice.level)} ${notice.readAt ? "read" : ""}`}
                      key={notice.id}
                    >
                      <span />
                      <button
                        type="button"
                        className="notice-main"
                        onClick={() => readNotice(notice)}
                        disabled={Boolean(busy)}
                        title={notice.readAt ? "已读提醒" : "标记为已读"}
                      >
                        <strong>{notice.title}</strong>
                        {notice.body ? <small>{notice.body}</small> : null}
                        {noticeTargetSummary(notice) ? <em>{noticeTargetSummary(notice)}</em> : null}
                      </button>
                      <div className="notice-target-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => focusNoticeTarget(notice)}
                          disabled={Boolean(busy) || !noticeHasTarget(notice)}
                          title={noticeHasTarget(notice) ? "定位到这条提醒绑定的业务记录" : "这条提醒没有可定位目标"}
                        >
                          <Search size={14} aria-hidden="true" />定位
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty empty-cta" role="status">
                    <strong>暂无提醒</strong>
                    <span>可以主动跑一轮后台自动化，或创建超时/失败演示来验证提醒链路。</span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={runAutomationCycle} disabled={Boolean(busy)}>
                        <Bot size={16} aria-hidden="true" />后台跑一轮
                      </button>
                      <button type="button" className="ghost" onClick={createTimeoutDemo} disabled={Boolean(busy)}>
                        <AlertTriangle size={16} aria-hidden="true" />超时演示
                      </button>
                      <button type="button" className="ghost" onClick={createFailureDemo} disabled={Boolean(busy)}>
                        <Ban size={16} aria-hidden="true" />失败演示
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </section>

        <section className="catalog-grid">
          <section className={`panel catalog-workbench catalog-mode-${catalogWorkbenchView}`} id="catalog-center">
            <div className="panel-head">
              <div>
                <h2><PackageSearch size={17} aria-hidden="true" />商品导入与搭配</h2>
                <span>下载模板或粘贴 CSV，导入后参与预算搭配</span>
              </div>
              <div className="segmented-control catalog-view-switcher" role="tablist" aria-label="商品导入与搭配工作区视图">
                <button
                  type="button"
                  className={catalogWorkbenchView === "import" ? "selected" : ""}
                  aria-pressed={catalogWorkbenchView === "import"}
                  onClick={() => setCatalogWorkbenchDetail("import")}
                >
                  导入
                </button>
                <button
                  type="button"
                  className={catalogWorkbenchView === "preview" ? "selected" : ""}
                  aria-pressed={catalogWorkbenchView === "preview"}
                  onClick={() => setCatalogWorkbenchDetail("preview")}
                >
                  预览
                </button>
                <button
                  type="button"
                  className={catalogWorkbenchView === "audit" ? "selected" : ""}
                  aria-pressed={catalogWorkbenchView === "audit"}
                  onClick={() => setCatalogWorkbenchDetail("audit")}
                >
                  体检
                </button>
                <button
                  type="button"
                  className={catalogWorkbenchView === "bundle" ? "selected" : ""}
                  aria-pressed={catalogWorkbenchView === "bundle"}
                  onClick={() => setCatalogWorkbenchDetail("bundle")}
                >
                  搭配
                </button>
              </div>
              <span className="catalog-view-status">
                {catalogWorkbenchView === "import"
                  ? "录入表格"
                  : catalogWorkbenchView === "preview"
                    ? `预览 ${skuImportPreview?.importedCount || 0} 个`
                    : catalogWorkbenchView === "audit"
                      ? `问题 ${catalogAudit?.issueCount || 0} 个`
                      : bundleResult
                        ? `${bundleResult.totals.salePrice} 元/份`
                        : "待推荐"}
              </span>
              <Layers size={20} aria-hidden="true" />
            </div>
            <div className="catalog-tools">
              <textarea
                aria-label="粘贴 SKU 导入表格"
                value={skuImportText}
                onChange={(event) => {
                  setSkuImportText(event.target.value);
                  setSkuImportPreview(null);
                }}
                placeholder={"SKU编号\t商品名称\t商品类型\t分类\t成本价\t售价\t库存\t场景标签"}
              />
              <div className="catalog-actions catalog-import-actions">
                <button type="button" className="primary" onClick={previewSkuImport} disabled={Boolean(busy)}>
                  <FileUp size={16} aria-hidden="true" />预览导入
                </button>
                <label className="ghost file-button">
                  <FileUp size={16} aria-hidden="true" />选择文件预览
                  <input
                    type="file"
                    accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain"
                    onChange={(event) => {
                      previewSkuImportUpload(event.currentTarget.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button type="button" className="ghost" onClick={downloadSkuTemplate} disabled={Boolean(busy)}>
                  <Download size={16} aria-hidden="true" />下载标准模板
                </button>
                <span>当前 SKU {skus.length} 个</span>
              </div>
              {skuImportFields.length ? (
                <div className="sku-import-guide">
                  <div>
                    <strong>导入字段</strong>
                    <span>带 * 的表头必须有；其它字段缺了也能预览，但会在体检里提示补齐。</span>
                  </div>
                  <div className="sku-import-field-grid">
                    {skuImportFields.map((field) => (
                      <span className={field.required ? "required" : ""} key={field.field} title={field.description}>
                        <strong>{field.label}{field.required ? " *" : ""}</strong>
                        <small>{field.example}</small>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="sku-import-guide catalog-import-loading" role="status">
                  <div>
                    <strong>导入字段</strong>
                    <span>正在读取字段规范，仍可先粘贴表格预览。</span>
                  </div>
                  <div className="sku-import-field-grid">
                    {["SKU编号 *", "商品名称 *", "售价 *", "库存", "主图", "供应商"].map((label) => (
                      <span key={label}>
                        <strong>{label}</strong>
                        <small>标准模板字段</small>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {skuImportPreview ? (
                <div className="import-preview">
                  <div className="import-preview-head">
                    <strong>预览 {skuImportPreview.importedCount} 个商品</strong>
                    <span>跳过 {skuImportPreview.skippedCount} 行 · 预览问题 {skuImportPreview.audit?.issueCount || 0} 个</span>
                  </div>
                  {skuImportPreview.fieldMapping?.length ? (
                    <div className="import-mapping">
                      <strong>表头识别</strong>
                      <div>
                        {skuImportPreview.fieldMapping.filter((field) => field.matched).slice(0, 10).map((field) => (
                          <span key={field.field}>{field.label} ← {field.sourceHeader}</span>
                        ))}
                        {skuImportPreview.missingRequiredFields?.map((field) => (
                          <span className="danger" key={`missing-${field.field}`}>缺 {field.label}</span>
                        ))}
                        {skuImportPreview.unmappedHeaders?.slice(0, 6).map((header) => (
                          <span className="warning" key={`unmapped-${header}`}>未识别 {header}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {skuImportPreview.audit?.commercialReadiness ? (
                    <div className={`import-commercial-readiness ${skuImportPreview.audit.commercialReadiness.level}`} role="status">
                      <div>
                        <small>入库后自动化预估</small>
                        <strong>{skuImportPreview.audit.commercialReadiness.score} 分</strong>
                        <span>{skuImportPreview.audit.commercialReadiness.summary}</span>
                      </div>
                      <div className="import-commercial-flags" aria-label="导入后自动化能力">
                        <span className={skuImportPreview.audit.commercialReadiness.canAutoBundle ? "ok" : "blocked"}>自动搭配</span>
                        <span className={skuImportPreview.audit.commercialReadiness.canSubmitDesign ? "ok" : "blocked"}>设计出图</span>
                        <span className={skuImportPreview.audit.commercialReadiness.canAutoQuote ? "ok" : "blocked"}>自动报价</span>
                      </div>
                      <p>
                        <span>可用 {skuImportPreview.audit.readyCount}/{skuImportPreview.audit.total}</span>
                        <span>基础容量 {skuImportPreview.audit.basicBundleCapacity || 0} 份</span>
                        <span>最低成套 {skuImportPreview.audit.minBundleBudget || 0} 元</span>
                        <span>图片问题 {skuImportPreview.audit.imageIssueCount ?? skuImportPreview.audit.missingImageCount}</span>
                        <span>利润异常 {skuImportPreview.audit.negativeMarginCount || 0}</span>
                        <span>交期异常 {skuImportPreview.audit.leadTimeIssueCount || 0}</span>
                        <span>规格异常 {skuImportPreview.audit.specificationIssueCount || 0}</span>
                      </p>
                      {(skuImportPreview.audit.commercialReadiness.blockers?.length || skuImportPreview.audit.commercialReadiness.nextActions?.length) ? (
                        <button
                          type="button"
                          className="ghost compact-button"
                          onClick={() => setMessage([
                            ...(skuImportPreview.audit?.commercialReadiness?.blockers || []),
                            ...(skuImportPreview.audit?.commercialReadiness?.nextActions || []),
                          ].join("；") || "这批商品导入后没有明确自动化阻塞项。")}
                        >
                          查看导入建议
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {skuImportReadinessSummary ? (
                    <div className={`import-readiness-summary ${skuImportReadinessSummary.tone}`} role="status">
                      <div>
                        <small>本批入库风险</small>
                        <strong>{skuImportReadinessSummary.label}</strong>
                        <span>{skuImportReadinessSummary.detail}</span>
                      </div>
                      <p>
                        <span className="ready">可自动用 {skuImportReadinessSummary.ready}</span>
                        <span className="review">需复核 {skuImportReadinessSummary.review}</span>
                        <span className="blocked">阻塞 {skuImportReadinessSummary.blocked}</span>
                      </p>
                    </div>
                  ) : null}
                  <div className="import-preview-list">
                    {skuImportPreview.rows.slice(0, 6).map((row, index) => {
                      const rowIssues = skuImportIssuesForRow(row, skuImportPreview.audit?.issues || []);
                      const rowReadiness = skuImportRowReadiness(row, rowIssues);
                      return (
                        <div className={`preview-row ${rowReadiness.tone}`} key={`${row.skuCode || index}-${index}`}>
                          <strong>{row.name || "未命名商品"}</strong>
                          <span>{row.skuCode || "未编号"} · {row.category || row.type} · 售价 {formatMoney(Number(row.salePrice || 0))}</span>
                          <small>{row.mainImagePath ? "有主图" : "缺主图"} · 库存 {row.stock || 0} · {row.supplier || "缺供应商"}</small>
                          <div className={`preview-row-readiness ${rowReadiness.tone}`} title={rowReadiness.detail}>
                            <strong>{rowReadiness.label}</strong>
                            <span>{rowReadiness.detail}</span>
                            <p>
                              {rowReadiness.chips.map((chip) => (
                                <em key={chip}>{chip}</em>
                              ))}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {skuImportPreview.rows.length > 6 ? <small>还有 {skuImportPreview.rows.length - 6} 个商品，确认入库时会一起保存。</small> : null}
                  </div>
                  <div className="import-preview-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={confirmImportSkus}
                      disabled={Boolean(busy) || !skuImportPreview.rows.length || Boolean(skuImportReadinessSummary?.blocked)}
                      title={skuImportReadinessSummary?.blocked ? `还有 ${skuImportReadinessSummary.blocked} 个阻塞项，先修正后再入库` : "确认把这批商品写入商品库"}
                    >
                      <Check size={16} aria-hidden="true" />确认入库
                    </button>
                    <button type="button" className="ghost" onClick={() => setCatalogWorkbenchDetail("audit")}>
                      <AlertTriangle size={16} aria-hidden="true" />查看体检
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={exportSkuImportBlockedRows}
                      disabled={Boolean(busy) || !skuImportReadinessSummary?.blocked}
                      title={skuImportReadinessSummary?.blocked ? "导出本批不能直接入库的商品清单" : "当前没有导入阻塞项"}
                    >
                      <Download size={16} aria-hidden="true" />导出阻塞清单
                    </button>
                  </div>
                  {skuImportPreview.errors.length ? (
                    <div className="import-errors">
                      {skuImportPreview.errors.slice(0, 5).map((error) => (
                        <span key={`${error.line}-${error.message}`}>第 {error.line} 行：{error.message}</span>
                      ))}
                    </div>
                  ) : null}
                  {skuImportPreview.audit?.issues.length ? (
                    <div className="catalog-issues">
                      {skuImportPreview.audit.issues.slice(0, 6).map((issue, index) => (
                        <span className={issue.severity} key={`preview-${issue.skuCode}-${issue.code}-${index}`}>
                          {issue.skuCode || "未编号"}：{issue.message}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {catalogAudit ? (
                <div className="catalog-audit">
                  <div>
                    <strong>可用商品 {catalogAudit.readyCount} / {catalogAudit.total}</strong>
                    <span>
                      问题 {catalogAudit.issueCount} 个 · 图片问题 {catalogAudit.imageIssueCount ?? catalogAudit.missingImageCount}
                      {catalogAudit.invalidImageCount ? ` · 格式异常 ${catalogAudit.invalidImageCount}` : ""}
                      {catalogAudit.missingAngleImageCount ? ` · 多角度图失效 ${catalogAudit.missingAngleImageCount}` : ""}
                      · 库存异常 {catalogAudit.lowStockCount} · 利润异常 {catalogAudit.negativeMarginCount}
                    </span>
                  </div>
                  <button type="button" className="ghost compact-button" onClick={refreshSkuCatalogAuditOnly} disabled={Boolean(busy)}>
                    <RefreshCw size={14} aria-hidden="true" />刷新商品审核
                  </button>
                  {skuCatalogAuditRefreshSummary ? (
                    <div className="catalog-audit-refresh-note" role="status">
                      <span>最近刷新 {skuCatalogAuditRefreshAt || "刚刚"}</span>
                      <strong>{skuCatalogAuditRefreshSummary}</strong>
                    </div>
                  ) : null}
                  <div className="catalog-issues">
                    {catalogAudit.issues.slice(0, 6).map((issue, index) => (
                      <span className={issue.severity} key={`${issue.skuCode}-${issue.code}-${index}`}>
                        {issue.skuCode || "未编号"}：{issue.message}
                      </span>
                    ))}
                    {!catalogAudit.issues.length ? <span className="ok">商品资料完整，可以参与自动搭配</span> : null}
                  </div>
                </div>
              ) : null}
              <div className="sku-change-log">
                <div className="sku-change-log-head">
                  <div>
                    <strong>最近商品变更</strong>
                    <span>记录库存、售价、成本、供应商和上下架变化</span>
                  </div>
                  <button type="button" className="ghost compact-button" onClick={exportSkuChangeLogs} disabled={!visibleSkuChangeLogs.length || Boolean(busy)}>
                    <Download size={14} aria-hidden="true" />导出变更
                  </button>
                </div>
                {skuChangeLogs.length ? (
                  <>
                    <div className="sku-change-filter" role="group" aria-label="商品变更影响筛选">
                      {skuChangeImpactFilterOptions.map((option) => (
                        <button
                          type="button"
                          className={skuChangeImpactFilter === option.value ? "selected" : ""}
                          aria-pressed={skuChangeImpactFilter === option.value}
                          onClick={() => setSkuChangeImpactFilter(option.value)}
                          disabled={!skuChangeLogs.length}
                          key={option.value}
                        >
                          <span>{option.label}</span>
                          <strong>{skuChangeImpactFilterCounts[option.value] || 0}</strong>
                        </button>
                      ))}
                    </div>
                    <label className="sku-change-search">
                      <Search size={14} aria-hidden="true" />
                      <input
                        aria-label="搜索商品变更"
                        value={skuChangeSearch}
                        onChange={(event) => setSkuChangeSearch(event.target.value)}
                        placeholder="搜索 SKU / 商品 / 操作者 / 来源"
                      />
                    </label>
                    {visibleSkuChangeLogs.length ? (
                  visibleSkuChangeLogs.slice(0, 6).map((log) => {
                    const impact = skuChangeImpactSummary(log);
                    return (
                      <div className={`sku-change-item ${impact.tone}`} key={log.id}>
                        <div className="sku-change-item-head">
                          <strong>{log.skuCode} · {log.name || "未命名商品"}</strong>
                          <span>{skuChangeActionLabel(log.action)} · {log.operator || "system"} · {formatDateTime(log.createdAt)}</span>
                        </div>
                        <div className="sku-change-impact-row">
                          <span className={`sku-change-impact ${impact.tone}`}>{impact.label}</span>
                          <small>{impact.detail}</small>
                          <button type="button" className="ghost compact-button" onClick={() => handleSkuChangeImpact(log, impact)}>
                            <Search size={14} aria-hidden="true" />{impact.nextAction}
                          </button>
                        </div>
                        <p>
                          {log.changedFields.slice(0, 4).map((field) => (
                            <span key={`${log.id}-${field.field}`}>
                              {skuFieldLabel(field.field)}：{formatSkuFieldValue(field.before)} → {formatSkuFieldValue(field.after)}
                            </span>
                          ))}
                        </p>
                      </div>
                    );
                  })
                    ) : (
                      <div className="empty compact" role="status">
                        <strong>当前筛选下没有变更</strong>
                        <span>{skuChangeSearch.trim() ? "换个关键词，或清空搜索查看全部变更。" : "切换筛选项查看其他商品变更影响。"}</span>
                      </div>
                    )}
                  </>
                ) : (
                <div className="empty empty-cta compact" role="status">
                  <strong>还没有商品变更</strong>
                  <span>保存、导入、批量修改或上下架商品后，会在这里留下变更记录。</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={saveSkuForm} disabled={Boolean(busy)}>
                      <Check size={16} aria-hidden="true" />保存当前商品
                    </button>
                    <button type="button" className="ghost" onClick={previewSkuImport} disabled={Boolean(busy)}>
                      <FileUp size={16} aria-hidden="true" />预览导入
                    </button>
                  </div>
                </div>
                )}
              </div>
              <div className="catalog-bundle-tools">
                <div>
                  <strong>预算搭配</strong>
                  <span>按员工福利场景、180 元单盒预算和 50 份需求生成可报价组合。</span>
                </div>
                <button type="button" className="primary" onClick={recommendGiftBundle} disabled={Boolean(busy)}>
                  <PackageSearch size={16} aria-hidden="true" />按180元推荐组合
                </button>
                {!bundleResult ? (
                  <p>还没有生成组合。点击推荐后会显示单份售价、成本、利润、库存承接量和瓶颈商品。</p>
                ) : null}
              </div>
              {bundleResult ? (
                <div className="bundle-result">
                  <div className="bundle-total">
                    <strong>{bundleResult.totals.salePrice} 元/份</strong>
                    <span>成本 {bundleResult.totals.cost} 元 · 利润 {bundleResult.totals.profit} 元</span>
                  </div>
                  {bundleResult.fulfillment ? (
                    <div className={bundleResult.fulfillment.enough ? "bundle-capacity ok" : "bundle-capacity warning"}>
                      <span>{bundleResult.fulfillment.requestedQuantity} 份需求</span>
                      <strong>{bundleResult.fulfillment.enough ? "库存够" : "库存不足"}</strong>
                      <span>
                        可承接约 {bundleResult.fulfillment.capacity} 份
                        {bundleResult.fulfillment.bottleneckSkuCode ? ` · 瓶颈 ${bundleResult.fulfillment.bottleneckSkuCode}` : ""}
                      </span>
                    </div>
                  ) : null}
                  {bundleResult.automation ? (
                    <div className={bundleResult.automation.ready ? "bundle-capacity ok" : "bundle-capacity warning"}>
                      <span>自动化判断</span>
                      <strong>{bundleResult.automation.ready ? "可进低价自动化" : "需要人工确认"}</strong>
                      <span>
                        {bundleResult.automation.ready
                          ? "利润、交期、规格和装盒尺寸满足自动出图/报价要求"
                          : `阻塞项：${bundleResult.automation.blockers.map(automationBlockerLabel).join("、") || "未说明"}`}
                      </span>
                    </div>
                  ) : null}
                  <div className="bundle-items">
                    {bundleResult.items.map((item, index) => (
                      <span key={`${item.skuCode || index}`}>{String(item.name || item.skuCode || "未命名商品")}</span>
                    ))}
                  </div>
                  {bundleResult.warnings.length ? <p>{bundleResult.warnings.join("；")}</p> : null}
                </div>
              ) : null}
            </div>
          </section>
        </section>

        <section className="training-grid">
          <section className="panel" id="agent-center">
            <div className="panel-head">
              <div>
                <h2><Bot size={17} aria-hidden="true" />Agent 中心</h2>
                <span>不同场景由不同智能体和 Skill 处理</span>
              </div>
              <Bot size={20} aria-hidden="true" />
            </div>
            <div className="agent-list">
              {agents.length ? agents.map((agent) => {
                const agentSuggestionKey = skillSuggestions.some((suggestion) => skillSuggestionAgentFilterKey(suggestion) === agent.id)
                  ? agent.id
                  : agent.key;
                const isAgentSelected =
                  skillSuggestionAgentFilter === agentSuggestionKey ||
                  skillSuggestionAgentFilter === agent.id ||
                  skillSuggestionAgentFilter === agent.key;
                return (
                <button
                  aria-controls="training-center"
                  aria-pressed={isAgentSelected}
                  className={`agent-card ${isAgentSelected ? "selected" : ""}`}
                  key={agent.id}
                  onClick={() => {
                    setSkillSuggestionAgentFilter(agentSuggestionKey);
                    setSkillSuggestionSafetyFilter("all");
                    setTrainingWorkbenchView("skills");
                    scrollToWorkspaceSection("training-center");
                  }}
                  title={`查看 ${agent.name} 的训练样本和 Skill 建议`}
                  type="button"
                >
                  <div className="agent-title">
                    <strong>{agent.name}</strong>
                    <span>{agent.trainingSampleCount} 条样本</span>
                  </div>
                  <p>{agent.scene}</p>
                  <div className="skill-row">
                    {agent.skills.slice(0, 3).map((skill) => (
                      <span className={`agent-skill-pill ${agentSkillScopeTone(skill.scope?.level)}`} key={skill.id} title={skill.scope?.reason || ""}>
                        {skill.name}
                        {skill.scope?.label ? <small>{skill.scope.label}</small> : null}
                      </span>
                    ))}
                  </div>
                  <small className="agent-card-action">查看训练与 Skill</small>
                </button>
                );
              }) : (
                <div className="empty empty-cta agent-empty" role="status">
                  <strong>还没有可展示的 Agent</strong>
                  <span>导入聊天记录后，系统会按场景沉淀样本，并在这里展示可训练的 Agent 与 Skill。</span>
                  <div className="empty-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setTrainingWorkbenchView("import");
                        scrollToWorkspaceSection("training-center");
                      }}
                    >
                      <FileUp size={16} aria-hidden="true" />导入聊天记录
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setSkillSuggestionAgentFilter("all");
                        setSkillSuggestionSafetyFilter("all");
                        setTrainingWorkbenchView("skills");
                        scrollToWorkspaceSection("training-center");
                      }}
                    >
                      <Brain size={16} aria-hidden="true" />查看 Skill 进化
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className={`panel training-workbench training-mode-${trainingWorkbenchView}`} id="training-center">
            <div className="panel-head">
              <div>
                <h2><Brain size={17} aria-hidden="true" />训练中心</h2>
                <span>导入聊天记录，沉淀高情商客服样本</span>
              </div>
              <div className="segmented-control training-view-switcher" role="tablist" aria-label="训练中心视图">
                <button
                  type="button"
                  className={trainingWorkbenchView === "import" ? "selected" : ""}
                  aria-pressed={trainingWorkbenchView === "import"}
                  onClick={() => setTrainingWorkbenchView("import")}
                >
                  导入训练
                </button>
                <button
                  type="button"
                  className={trainingWorkbenchView === "review" ? "selected" : ""}
                  aria-pressed={trainingWorkbenchView === "review"}
                  onClick={() => setTrainingWorkbenchView("review")}
                >
                  样本复核
                </button>
                <button
                  type="button"
                  className={trainingWorkbenchView === "skills" ? "selected" : ""}
                  aria-pressed={trainingWorkbenchView === "skills"}
                  onClick={() => setTrainingWorkbenchView("skills")}
                >
                  Skill 进化
                </button>
              </div>
              <span className="training-view-status" role="status">{trainingWorkbenchSummary}</span>
            </div>
            <div className="training-panel">
              <textarea
                aria-label="粘贴训练聊天记录"
                cols={24}
                wrap="hard"
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder={"客户：问题内容\n客服：高质量回复"}
              />
              <div className="training-actions">
                <button type="button" className="primary" onClick={importChat} disabled={Boolean(busy)}>
                  <FileUp size={16} aria-hidden="true" />导入训练
                </button>
                <span>已导入 {chatImports.length} 批，训练样本 {trainingSampleTotalCount} 条</span>
                <button type="button" className="ghost" onClick={compileAllSelectedTrainingSkills} disabled={Boolean(busy) || !selectedSkillSuggestionCount}>
                  <Brain size={16} aria-hidden="true" />应用全部已选 Skill
                </button>
              </div>
              {chatImports.length ? (
                <div className="training-import-history" aria-label="最近导入训练记录">
                  <div className="training-import-history-head">
                    <strong>最近导入</strong>
                    <button
                      type="button"
                      onClick={() => {
                        setTrainingWorkbenchView("review");
                        changeTrainingSampleQualityFilter("scene_uncertain");
                      }}
                      disabled={Boolean(busy) || !chatImports.some((item) => chatImportSceneUncertainCount(item) > 0)}
                    >
                      查看待确认
                    </button>
                  </div>
                  {chatImports.slice(0, 4).map((item) => (
                    <button
                      type="button"
                      className={`training-import-row ${chatImportNeedsReview(item) ? "needs-review" : "clear"}`}
                      key={item.id}
                      onClick={() => {
                        setTrainingWorkbenchView("review");
                        changeTrainingSampleQualityFilter(chatImportPreferredQualityFilter(item), item.id);
                      }}
                      disabled={Boolean(busy)}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{formatDateTime(item.createdAt)} · {item.pairCount} 组对话</small>
                      </span>
                      <em>{chatImportSceneSummaryLabel(item)}</em>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="training-overview">
                <button
                  type="button"
                  className="training-metric"
                  onClick={() => {
                    setTrainingWorkbenchView("review");
                    changeTrainingSampleQualityFilter("all");
                  }}
                  disabled={Boolean(busy)}
                  aria-controls="training-center"
                >
                  <span>纠错样本</span>
                  <strong>{trainingOverview?.correctionSamples ?? latestCorrectionSamples.length}</strong>
                </button>
                <button
                  type="button"
                  className="training-metric"
                  onClick={() => {
                    setSkillSuggestionAgentFilter("all");
                    setSkillSuggestionSafetyFilter("all");
                    setTrainingWorkbenchView("skills");
                    scrollToWorkspaceSection("training-center");
                  }}
                  disabled={Boolean(busy)}
                  aria-controls="training-center"
                >
                  <span>可生成 Skill</span>
                  <strong>{trainingOverview?.suggestionCount ?? 0}</strong>
                </button>
                <button
                  type="button"
                  className="training-metric"
                  onClick={() => {
                    setTrainingWorkbenchView("review");
                    changeTrainingSampleQualityFilter("review");
                  }}
                  disabled={Boolean(busy)}
                  aria-controls="training-center"
                >
                  <span>待复核</span>
                  <strong>
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "review",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "review")).length,
                    )}
                  </strong>
                </button>
                <button
                  type="button"
                  className="training-metric"
                  onClick={() => {
                    setTrainingWorkbenchView("review");
                    changeTrainingSampleQualityFilter("all");
                  }}
                  disabled={Boolean(busy)}
                  aria-controls="training-center"
                >
                  <span>平均评分</span>
                  <strong>{trainingOverview?.averageScore ?? "-"}</strong>
                </button>
              </div>
              {trainingOverview?.qualitySummary ? (
                <div className="training-quality-strip">
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "trainable" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "trainable"}
                    onClick={() => changeTrainingSampleQualityFilter("trainable")}
                    disabled={Boolean(busy)}
                  >
                    可训练 {trainingOverview.qualitySummary.trainableSamples}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "route_memory" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "route_memory"}
                    onClick={() => changeTrainingSampleQualityFilter("route_memory")}
                    disabled={Boolean(busy)}
                  >
                    场景判断{" "}
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "route_memory",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "route_memory")).length,
                    )}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "scene_uncertain" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "scene_uncertain"}
                    onClick={() => changeTrainingSampleQualityFilter("scene_uncertain")}
                    disabled={Boolean(busy)}
                  >
                    场景待确认{" "}
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "scene_uncertain",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "scene_uncertain")).length,
                    )}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "reply_skill" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "reply_skill"}
                    onClick={() => changeTrainingSampleQualityFilter("reply_skill")}
                    disabled={Boolean(busy)}
                  >
                    客服话术{" "}
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "reply_skill",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "reply_skill")).length,
                    )}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "route_and_reply" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "route_and_reply"}
                    onClick={() => changeTrainingSampleQualityFilter("route_and_reply")}
                    disabled={Boolean(busy)}
                  >
                    判断+话术{" "}
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "route_and_reply",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "route_and_reply")).length,
                    )}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "not_trainable" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "not_trainable"}
                    onClick={() => changeTrainingSampleQualityFilter("not_trainable")}
                    disabled={Boolean(busy)}
                  >
                    不可训练{" "}
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "not_trainable",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "not_trainable")).length,
                    )}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "safe" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "safe"}
                    onClick={() => changeTrainingSampleQualityFilter("safe")}
                    disabled={Boolean(busy)}
                  >
                    正常业务 {trainingOverview.qualitySummary.safeSamples}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "anti_wrong_reply" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "anti_wrong_reply"}
                    onClick={() => changeTrainingSampleQualityFilter("anti_wrong_reply")}
                    disabled={Boolean(busy)}
                  >
                    防乱回复 {trainingOverview.qualitySummary.antiWrongReplySamples}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "needs_attention" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "needs_attention"}
                    onClick={() => changeTrainingSampleQualityFilter("needs_attention")}
                    disabled={Boolean(busy)}
                  >
                    需处理{" "}
                    {trainingSampleQualityTotal(
                      trainingOverview,
                      "needs_attention",
                      trainingSamples.filter((sample) => matchesTrainingSampleQualityFilter(sample, "needs_attention")).length,
                    )}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "risk" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "risk"}
                    onClick={() => changeTrainingSampleQualityFilter("risk")}
                    disabled={Boolean(busy)}
                  >
                    风险 {trainingOverview.qualitySummary.riskSamples}
                  </button>
                  <button
                    type="button"
                    className={trainingSampleQualityFilter === "blocked" ? "selected" : ""}
                    aria-pressed={trainingSampleQualityFilter === "blocked"}
                    onClick={() => changeTrainingSampleQualityFilter("blocked")}
                    disabled={Boolean(busy)}
                  >
                    禁用 {trainingOverview.qualitySummary.blockedSamples}
                  </button>
                </div>
              ) : null}
              {trainingOverview?.qualitySummary?.attentionReasonCounts?.length ? (
                <div className="training-attention-reasons" aria-label="训练样本需处理原因汇总">
                  <strong>需处理原因</strong>
                  {trainingOverview.qualitySummary.attentionReasonCounts.map((reason) => (
                    <button
                      type="button"
                      className="ghost compact"
                      key={reason.code}
                      title={attentionReasonTitle(reason)}
                      onClick={() => changeTrainingSampleQualityFilter(attentionReasonQualityFilter(reason))}
                      disabled={Boolean(busy)}
                    >
                      {attentionReasonLabel(reason)} {reason.count}
                    </button>
                  ))}
                </div>
              ) : null}
              {trainingOverview?.recommendations?.length ? (
                <div className="training-summary">
                  {visibleTrainingRecommendations(trainingOverview.recommendations).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {(trainingOverview.qualitySummary?.sceneUncertainSamples || 0) > 0 ? (
                    <button
                      type="button"
                      className="training-summary-action"
                      onClick={() => {
                        setTrainingWorkbenchView("review");
                        changeTrainingSampleQualityFilter("scene_uncertain");
                      }}
                      disabled={Boolean(busy)}
                    >
                      查看场景待确认
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="skill-suggestion-list">
                <div className="skill-suggestion-head">
                  <div>
                    <strong>Skill 进化预览</strong>
                    <span>
                      当前筛选 {filteredSelectedSkillSuggestionCount} / {filteredSkillSuggestions.length} 条已选，全部已选 {selectedSkillSuggestionCount} 条；
                      已选高可信 {selectedSafeSkillSuggestionCount} 条，已选需复核 {selectedNeedsReviewSkillSuggestionCount} 条，已选禁止 {selectedBlockedSkillSuggestionCount} 条；
                      当前筛选高可信 {filteredSafeSkillSuggestionCount} 条，当前筛选需复核 {filteredNeedsReviewSkillSuggestionCount} 条，当前筛选身份冲突 {filteredBlockedSkillSuggestionCount} 条
                    </span>
                  </div>
                  <div className="skill-suggestion-controls">
                    <div className="segmented-control filter-segment skill-suggestion-agent-segment" role="group" aria-label="Skill 建议 Agent 筛选">
                      <button
                        aria-pressed={skillSuggestionAgentFilter === "all"}
                        className={skillSuggestionAgentFilter === "all" ? "selected" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => setSkillSuggestionAgentFilter("all")}
                        type="button"
                      >
                        全部 Agent
                      </button>
                      {skillSuggestionAgentOptions.map((option) => (
                        <button
                          aria-pressed={skillSuggestionAgentFilter === option.key}
                          className={skillSuggestionAgentFilter === option.key ? "selected" : ""}
                          disabled={Boolean(busy)}
                          key={option.key}
                          onClick={() => setSkillSuggestionAgentFilter(option.key)}
                          type="button"
                        >
                          {option.label}（{option.count}）
                        </button>
                      ))}
                    </div>
                    <div className="segmented-control filter-segment skill-suggestion-safety-segment" role="group" aria-label="Skill 建议可信度筛选">
                      <button
                        aria-pressed={skillSuggestionSafetyFilter === "all"}
                        className={skillSuggestionSafetyFilter === "all" ? "selected" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => setSkillSuggestionSafetyFilter("all")}
                        type="button"
                      >
                        全部建议（{agentFilteredSkillSuggestions.length}）
                      </button>
                      <button
                        aria-pressed={skillSuggestionSafetyFilter === "safe"}
                        className={skillSuggestionSafetyFilter === "safe" ? "selected" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => setSkillSuggestionSafetyFilter("safe")}
                        type="button"
                      >
                        高可信（{agentFilteredSafeSkillSuggestionCount}）
                      </button>
                      <button
                        aria-pressed={skillSuggestionSafetyFilter === "review"}
                        className={skillSuggestionSafetyFilter === "review" ? "selected" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => setSkillSuggestionSafetyFilter("review")}
                        type="button"
                      >
                        需复核（{agentFilteredNeedsReviewSkillSuggestionCount}）
                      </button>
                      <button
                        aria-pressed={skillSuggestionSafetyFilter === "blocked"}
                        className={skillSuggestionSafetyFilter === "blocked" ? "selected" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => setSkillSuggestionSafetyFilter("blocked")}
                        type="button"
                      >
                        身份冲突（{agentFilteredBlockedSkillSuggestionCount}）
                      </button>
                    </div>
                    <button type="button" className="ghost compact" onClick={selectAllSkillSuggestions} disabled={Boolean(busy) || !filteredUnselectedSkillSuggestionCount}>
                      全选当前筛选
                    </button>
                    <button type="button" className="ghost compact" onClick={selectSafeSkillSuggestions} disabled={Boolean(busy) || !filteredUnselectedSafeSkillSuggestionCount}>
                      只选当前筛选高可信
                    </button>
                    <button type="button" className="ghost compact" onClick={clearSkillSuggestions} disabled={Boolean(busy) || !filteredSelectedSkillSuggestionCount}>
                      清空当前筛选
                    </button>
                    <button type="button" className="ghost compact" onClick={clearHiddenSkillSuggestions} disabled={Boolean(busy) || !hiddenSelectedSkillSuggestionCount}>
                      清空其他已选
                    </button>
                    {hiddenSelectedSkillSuggestionCount && filteredSelectedSkillSuggestionCount ? (
                      <button type="button" className="primary compact" onClick={compileFilteredTrainingSkills} disabled={Boolean(busy)}>
                        只应用当前
                      </button>
                    ) : null}
                    <button type="button" className="primary compact" onClick={compileAllSelectedTrainingSkills} disabled={Boolean(busy) || !selectedSkillSuggestionCount}>
                      应用全部已选
                    </button>
                  </div>
                </div>
                {hiddenSelectedSkillSuggestionCount ? (
                  <div className="training-summary skill-suggestion-hint" role="status">
                    <span>
                      还有 {hiddenSelectedSkillSuggestionCount} 条其他 Agent 已选，其中 {hiddenNeedsReviewSkillSuggestionCount} 条需人工判断、{hiddenBlockedSkillSuggestionCount} 条身份冲突；
                      全部已选里有 {selectedNeedsReviewSkillSuggestionCount} 条需人工判断、{selectedBlockedSkillSuggestionCount} 条禁止应用，点击“应用全部已选”会先做身份校验。
                    </span>
                  </div>
                ) : filteredSkillSuggestions.length && !filteredSelectedSkillSuggestionCount ? (
                  <div className="training-summary skill-suggestion-hint" role="status">
                    <span>
                      当前筛选没有已选建议；可先用“只选当前筛选高可信”应用 {filteredUnselectedSafeSkillSuggestionCount} 条，剩余 {filteredNeedsReviewSkillSuggestionCount} 条需人工判断，{filteredBlockedSkillSuggestionCount} 条身份冲突只能查看不能应用。
                    </span>
                  </div>
                ) : filteredUnselectedSkillSuggestionCount ? (
                  <div className="training-summary skill-suggestion-hint" role="status">
                    <span>当前筛选还有 {filteredUnselectedSkillSuggestionCount} 条未选建议，未选项不会进入 Skill。</span>
                  </div>
                ) : null}
                {visibleSkillSuggestions.length ? (
                  visibleSkillSuggestions.map((suggestion) => {
                    const safetyTone = skillSuggestionSafetyTone(suggestion);
                    const scopeTone = skillSuggestionScopeTone(suggestion);
                    const blocked = isSkillSuggestionBlocked(suggestion);
                    return (
                    <div
                      aria-checked={selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion))}
                      aria-disabled={blocked}
                      aria-label={`选择 Skill 建议：${suggestion.name}`}
                      className={`skill-suggestion-row ${safetyTone}${blocked ? " blocked" : ""}`}
                      key={skillSuggestionKey(suggestion)}
                      onClick={(event) => toggleSkillSuggestionFromRow(event, suggestion)}
                      onKeyDown={(event) => handleSkillSuggestionRowKeyDown(event, suggestion)}
                      role="checkbox"
                      tabIndex={0}
                      title={blocked ? "这条建议存在身份冲突，不能应用" : "点击整行切换是否应用这条 Skill 建议"}
                    >
                      <div className="skill-suggestion-title">
                        <label className="skill-suggestion-check">
                          <input
                            type="checkbox"
                            checked={selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion))}
                            onChange={(event) => toggleSkillSuggestion(skillSuggestionKey(suggestion), event.target.checked, suggestion)}
                            disabled={Boolean(busy) || blocked}
                          />
                          <strong>{suggestion.name}</strong>
                        </label>
                        <div className="skill-suggestion-badges">
                          <em>{skillSuggestionActionLabel(suggestion.action)}</em>
                          <span className={`skill-suggestion-safety ${safetyTone}`} title={suggestion.quality?.reason || ""}>
                            {skillSuggestionSafetyLabel(suggestion)}
                          </span>
                          <span className={`skill-suggestion-scope ${scopeTone}`} title={skillSuggestionScopeDetail(suggestion)}>
                            {skillSuggestionScopeLabel(suggestion)}
                          </span>
                        </div>
                      </div>
                      <div className={`skill-suggestion-scope-note ${scopeTone}`} role="note">
                        <strong>作用范围</strong>
                        <span>{skillSuggestionScopeDetail(suggestion)}</span>
                      </div>
                      {blocked ? (
                        <div className="skill-suggestion-review-note blocked" role="note">
                          <strong>禁止应用</strong>
                          <span>{suggestion.quality?.reason || "这条建议来自混合客户、账号或会话，不能沉淀为可自动调用的 Skill。"}</span>
                          <span>建议动作：回到训练样本复核，先拆分客户、微信账号或会话来源，再重新生成 Skill。</span>
                        </div>
                      ) : !isSkillSuggestionAutoSelected(suggestion) ? (
                        <div className="skill-suggestion-review-note" role="note">
                          <strong>复核原因</strong>
                          <span>{suggestion.quality?.reason || skillSuggestionSafetyLabel(suggestion)}</span>
                          <span>建议动作：先核对客户原话、客服回复和适用场景，再决定是否应用。</span>
                        </div>
                      ) : null}
                      <p>{suggestion.description}</p>
                      <div className="skill-suggestion-meta">
                        <span>{suggestion.scenes.slice(0, 3).join("、") || "未分类场景"}</span>
                        <span>{suggestion.sampleCount} 条样本</span>
                        <span>置信度 {suggestion.confidence}</span>
                        <span>{skillSuggestionScopeLabel(suggestion)}</span>
                      </div>
                      {suggestion.evidence?.question || suggestion.evidence?.answer ? (
                        <div className="skill-suggestion-evidence">
                          {suggestion.evidence.question ? <span>客户：{suggestion.evidence.question}</span> : null}
                          {suggestion.evidence.answer ? <span>客服：{suggestion.evidence.answer}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    );
                  })
                ) : (
                  <div className="empty empty-cta small" role="status">
                    <strong>{skillSuggestionEmptyTitle}</strong>
                    <span>{skillSuggestionEmptyMessage}</span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={importChat} disabled={Boolean(busy)}>
                        <FileUp size={16} aria-hidden="true" />导入训练
                      </button>
                    </div>
                  </div>
                )}
                {filteredSkillSuggestions.length > visibleSkillSuggestions.length ? (
                  <div className="empty small" role="status">当前筛选还有 {filteredSkillSuggestions.length - visibleSkillSuggestions.length} 条建议未展示；“全选当前筛选”会包含这些未展示建议。</div>
                ) : null}
              </div>
              <div className="coverage-list">
                {topTrainingAgents.length ? (
                  topTrainingAgents.map((agent) => (
                    <button
                      type="button"
                      className="coverage-row"
                      key={agent.agentId || agent.agentKey}
                      onClick={() => {
                        setSkillSuggestionAgentFilter(agent.agentId || agent.agentKey || "all");
                        setSkillSuggestionSafetyFilter("all");
                        setTrainingWorkbenchView("skills");
                        scrollToWorkspaceSection("training-center");
                      }}
                      disabled={Boolean(busy)}
                      aria-controls="training-center"
                    >
                      <div>
                        <strong>{agent.name}</strong>
                        <span>{agent.scene} · 样本 {agent.sampleCount} · 纠错 {agent.correctionCount}</span>
                      </div>
                      <em>{agent.suggestionCount} 个 Skill 建议</em>
                    </button>
                  ))
                ) : (
                  <div className="empty empty-cta small" role="status">
                    <strong>还没有训练覆盖数据</strong>
                    <span>导入样本后，这里会按 Agent 展示覆盖和纠错情况。</span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={importChat} disabled={Boolean(busy)}>
                        <FileUp size={16} aria-hidden="true" />导入训练
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {latestCorrectionSamples.length ? (
                <div className="correction-samples">
                  <strong>最近人工纠错</strong>
                  {latestCorrectionSamples.map((sample) => (
                    <span key={sample.id}>
                      {sample.scene}：{sample.customerText}
                    </span>
                  ))}
                </div>
              ) : null}
              {skillApplySummary ? <div className="training-summary">{skillApplySummary}</div> : null}
              <div className="sample-list-head">
                <div>
                  <strong>训练样本复核</strong>
                  <span>
                    {activeTrainingImport
                      ? `导入批次：${activeTrainingImport.name} · 当前显示 ${visibleTrainingSamples.length} / ${filteredTrainingSampleTotal} 条`
                      : `当前显示 ${visibleTrainingSamples.length} / ${filteredTrainingSampleTotal} 条，全部 ${trainingSampleTotalCount} 条`}
                  </span>
                  <span className="sample-selection-summary">
                    已选 {selectedVisibleTrainingSamples.length} 条
                    {selectedMissingRequiredTrainingSampleCount ? `，${selectedMissingRequiredTrainingSampleCount} 条缺必填项` : ""}
                    {selectedNeedsAttentionTrainingSampleCount ? `，${selectedNeedsAttentionTrainingSampleCount} 条需处理` : ""}
                    {selectedSceneUncertainTrainingSampleCount ? `，其中 ${selectedSceneUncertainTrainingSampleCount} 条场景待确认` : ""}
                  </span>
                  <div className="sample-batch-actions">
                    {activeTrainingImport ? (
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => changeTrainingSampleQualityFilter(trainingSampleQualityFilter)}
                        disabled={Boolean(busy)}
                      >
                        清除批次
                      </button>
                    ) : null}
                    {activeTrainingImport && chatImportReadyForSkill(activeTrainingImport) ? (
                      <button
                        type="button"
                        className="primary compact"
                        onClick={() => focusChatImportSkillSuggestions(activeTrainingImport)}
                        disabled={Boolean(busy)}
                      >
                        查看 Skill 进化
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={selectVisibleTrainingSamples}
                      disabled={Boolean(busy) || !visibleTrainingSamples.length}
                    >
                      选择当前
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={selectTrainingSamplesMissingRequired}
                      disabled={Boolean(busy) || !visibleMissingRequiredTrainingSampleCount}
                    >
                      选择缺项
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={selectTrainingSamplesNeedingReview}
                      disabled={Boolean(busy) || !visibleTrainingSamples.length}
                    >
                      智能选择需处理
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={selectSceneUncertainTrainingSamples}
                      disabled={Boolean(busy) || !visibleTrainingSamples.length}
                    >
                      选择场景待确认
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={clearSelectedTrainingSamples}
                      disabled={Boolean(busy) || !selectedVisibleTrainingSamples.length}
                    >
                      清空选择
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => batchUpdateTrainingSampleStatus("ready", "selected")}
                      disabled={Boolean(busy) || !selectedVisibleTrainingSamples.length || selectedMissingRequiredTrainingSampleCount > 0}
                      title={selectedMissingRequiredTrainingSampleCount ? "请先补齐已选样本的必填信息" : "将已选样本确认进入训练"}
                    >
                      已选确认
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => batchUpdateTrainingSampleStatus("review", "selected")}
                      disabled={Boolean(busy) || !selectedVisibleTrainingSamples.length}
                    >
                      已选退回复核
                    </button>
                    <button
                      type="button"
                      className="ghost compact danger"
                      onClick={() => batchUpdateTrainingSampleStatus("rejected", "selected")}
                      disabled={Boolean(busy) || !selectedVisibleTrainingSamples.length}
                    >
                      已选禁用
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => batchUpdateTrainingSampleStatus("review", "visible")}
                      disabled={Boolean(busy) || !visibleTrainingSamples.length}
                    >
                      当前显示退回复核
                    </button>
                    <button
                      type="button"
                      className="ghost compact danger"
                      onClick={() => batchUpdateTrainingSampleStatus("rejected", "visible")}
                      disabled={Boolean(busy) || !visibleTrainingSamples.length}
                    >
                      当前显示禁用
                    </button>
                  </div>
                </div>
                {selectedMissingRequiredTrainingSampleCount || selectedNeedsAttentionTrainingSampleCount || selectedSceneUncertainTrainingSampleCount ? (
                  <div className="sample-selection-risk" role="status">
                    <strong>{selectedMissingRequiredTrainingSampleCount ? "已选样本缺少必填项" : "已选样本需要复核"}</strong>
                    <span>
                      {selectedMissingRequiredTrainingSampleCount ? `${selectedMissingRequiredTrainingSampleCount} 条缺少 Agent、场景、客户问题、标准回复或 Skill 提示` : ""}
                      {selectedMissingRequiredTrainingSampleCount && (selectedNeedsAttentionTrainingSampleCount || selectedSceneUncertainTrainingSampleCount) ? "；" : ""}
                      {selectedNeedsAttentionTrainingSampleCount ? `${selectedNeedsAttentionTrainingSampleCount} 条仍被标记为需人工处理` : ""}
                      {selectedNeedsAttentionTrainingSampleCount && selectedSceneUncertainTrainingSampleCount ? "；" : ""}
                      {selectedSceneUncertainTrainingSampleCount ? `${selectedSceneUncertainTrainingSampleCount} 条场景还没有完全确认` : ""}
                    </span>
                    <small>
                      {selectedMissingRequiredTrainingSampleCount
                        ? "缺必填项的样本不能进入训练；请先编辑补齐，再点击已选确认。"
                        : "点击“已选确认”会把这些样本写成人工确认记录，再进入训练；不确定就先退回复核。"}
                    </small>
                    <div className="sample-selection-risk-actions">
                      {selectedRiskTrainingSample ? (
                        <button type="button" onClick={() => startSampleEdit(selectedRiskTrainingSample)} disabled={Boolean(busy)}>
                          {selectedMissingRequiredTrainingSample ? "编辑首条缺项" : "编辑首条风险"}
                        </button>
                      ) : null}
                      {selectedMissingRequiredTrainingSampleCount ? (
                        <button type="button" onClick={() => changeTrainingSampleQualityFilterInReviewScope("missing_required")} disabled={Boolean(busy)}>
                          只看缺项
                        </button>
                      ) : null}
                      {selectedNeedsAttentionTrainingSampleCount ? (
                        <button type="button" onClick={() => changeTrainingSampleQualityFilterInReviewScope("needs_attention")} disabled={Boolean(busy)}>
                          只看需处理
                        </button>
                      ) : null}
                      {selectedSceneUncertainTrainingSampleCount ? (
                        <button type="button" onClick={() => changeTrainingSampleQualityFilterInReviewScope("scene_uncertain")} disabled={Boolean(busy)}>
                          只看场景待确认
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : visibleMissingRequiredTrainingSampleCount || visibleNeedsAttentionTrainingSampleCount || visibleSceneUncertainTrainingSampleCount ? (
                  <div className="sample-selection-risk muted" role="status">
                    <strong>{visibleMissingRequiredTrainingSampleCount ? "当前显示里有缺项样本" : "当前显示里有待复核样本"}</strong>
                    <span>
                      {visibleMissingRequiredTrainingSampleCount ? `${visibleMissingRequiredTrainingSampleCount} 条缺必填项` : ""}
                      {visibleMissingRequiredTrainingSampleCount && (visibleNeedsAttentionTrainingSampleCount || visibleSceneUncertainTrainingSampleCount) ? "；" : ""}
                      {visibleNeedsAttentionTrainingSampleCount ? `${visibleNeedsAttentionTrainingSampleCount} 条需处理` : ""}
                      {visibleNeedsAttentionTrainingSampleCount && visibleSceneUncertainTrainingSampleCount ? "；" : ""}
                      {visibleSceneUncertainTrainingSampleCount ? `${visibleSceneUncertainTrainingSampleCount} 条场景待确认` : ""}
                    </span>
                    <small>
                      {visibleMissingRequiredTrainingSampleCount
                        ? "缺必填项的样本不能批量确认进入训练；先编辑补齐，再选择确认。"
                        : "使用“智能选择需处理”或“选择场景待确认”可以先集中处理风险样本。"}
                    </small>
                    <div className="sample-selection-risk-actions">
                      {visibleRiskTrainingSample ? (
                        <button type="button" onClick={() => startSampleEdit(visibleRiskTrainingSample)} disabled={Boolean(busy)}>
                          {visibleMissingRequiredTrainingSample ? "编辑首条缺项" : "编辑首条风险"}
                        </button>
                      ) : null}
                      {visibleMissingRequiredTrainingSampleCount ? (
                        <button type="button" onClick={() => changeTrainingSampleQualityFilterInReviewScope("missing_required")} disabled={Boolean(busy)}>
                          只看缺项
                        </button>
                      ) : null}
                      {visibleMissingRequiredTrainingSampleCount ? (
                        <button type="button" onClick={selectTrainingSamplesMissingRequired} disabled={Boolean(busy)}>
                          选择缺项
                        </button>
                      ) : null}
                      {visibleNeedsAttentionTrainingSampleCount ? (
                        <button type="button" onClick={selectTrainingSamplesNeedingReview} disabled={Boolean(busy)}>
                          选择需处理
                        </button>
                      ) : null}
                      {visibleSceneUncertainTrainingSampleCount ? (
                        <button type="button" onClick={selectSceneUncertainTrainingSamples} disabled={Boolean(busy)}>
                          选择场景待确认
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="segmented-control filter-segment sample-quality-segment" role="group" aria-label="训练样本质量筛选">
                  {trainingSampleQualityOptions.map((option) => (
                    <button
                      aria-pressed={trainingSampleQualityFilter === option.key}
                      className={trainingSampleQualityFilter === option.key ? "selected" : ""}
                      disabled={Boolean(busy)}
                      key={option.key}
                      onClick={() => changeTrainingSampleQualityFilterInReviewScope(option.key)}
                      type="button"
                    >
                      {option.label}（{option.count}）
                    </button>
                  ))}
                </div>
              </div>
              <div className="sample-list">
                {visibleTrainingSamples.length ? (
                  visibleTrainingSamples.map((sample) => {
                    const qualityTone = sampleQualityTone(sample);
                    const attentionReasons = sampleAttentionReasons(sample);
                    const requiredFieldReasons = trainingSampleReadyBlockingReasons(sample);
                    const sceneEvidence = sampleSceneEvidence(sample);
                    const sceneRouteMemoryBadge = sampleSceneRouteMemoryBadge(sample);
                    const isEditingSample = editingSampleId === sample.id && Boolean(sampleEdit);
                    const editingPreviewSample = isEditingSample && sampleEdit ? editedTrainingSampleForConfirm(sample, sampleEdit, "ready") : null;
                    const editingBlockingReasons = editingPreviewSample ? trainingSampleReadyBlockingReasons(editingPreviewSample) : [];
                    const hasEditingReviewRisk = isTrainingSampleNeedingManualReview(sample) || isSceneUncertainTrainingSample(sample);
                    return (
                    <div
                      aria-label={`编辑训练样本：${sample.scene}`}
                      className={`sample-row ${qualityTone}`}
                      key={sample.id}
                      onClick={(event) => openTrainingSampleFromRow(event, sample)}
                      onKeyDown={(event) => handleTrainingSampleRowKeyDown(event, sample)}
                      tabIndex={0}
                      title="点击整行编辑训练样本"
                    >
                      <div className="sample-row-head">
                        <label className="sample-check">
                          <input
                            type="checkbox"
                            checked={selectedTrainingSampleIdSet.has(sample.id)}
                            onChange={(event) => toggleTrainingSampleSelection(sample.id, event.target.checked)}
                            disabled={Boolean(busy)}
                          />
                          <strong>{sample.scene}</strong>
                        </label>
                        <div className="sample-badges">
                          <span className={`sample-status ${sample.status || "ready"}`}>{trainingSampleStatusLabel(sample.status)}</span>
                          <span className={`sample-quality ${qualityTone}`} title={sampleQualityReason(sample)}>
                            {sampleQualityLabel(sample)}
                          </span>
                          <span className={`sample-usage ${sampleUsageTone(sample)}`} title={sampleUsageReason(sample)}>
                            {sampleUsageLabel(sample)}
                          </span>
                        </div>
                      </div>
                      <p>{sample.customerText}</p>
                      <small>
                        评分 {sample.score} · {sampleSourceLabel(sample)} · {sample.skillHints.join("、") || "待补 Skill"}
                      </small>
                      {sampleSceneScore(sample) !== null || sceneEvidence.length ? (
                        <div className="sample-scene-check" aria-label="训练样本场景判断">
                          <strong>场景判断</strong>
                          <span className={sampleSceneCheckTone(sample)} title={sampleSceneCheckTitle(sample)}>
                            {sampleSceneCheckLabel(sample)}
                          </span>
                          {sampleSceneScore(sample) !== null ? <span>分数 {sampleSceneScore(sample)}</span> : null}
                          {sceneRouteMemoryBadge ? (
                            <span className={sceneRouteMemoryBadge.tone} title={sceneRouteMemoryBadge.title}>
                              {sceneRouteMemoryBadge.label}
                            </span>
                          ) : null}
                          {sceneEvidence.slice(0, 4).map((keyword) => (
                            <em key={keyword}>{keyword}</em>
                          ))}
                        </div>
                      ) : null}
                      {requiredFieldReasons.length ? (
                        <div className="sample-required-reasons" aria-label="训练样本缺必填项">
                          <strong>缺必填项</strong>
                          {requiredFieldReasons.map((reason) => (
                            <button
                              type="button"
                              key={reason}
                              title={`点击后只看缺必填项样本：${reason}`}
                              onClick={() => changeTrainingSampleQualityFilterInReviewScope("missing_required")}
                              disabled={Boolean(busy)}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {attentionReasons.length ? (
                        <div className="sample-attention-reasons" aria-label="训练样本需处理原因">
                          <strong>需处理</strong>
                          {attentionReasons.map((reason) => (
                            <button
                              type="button"
                              key={reason.code}
                              title={attentionReasonTitle(reason)}
                              onClick={() => changeTrainingSampleQualityFilterInReviewScope(attentionReasonQualityFilter(reason))}
                              disabled={Boolean(busy)}
                            >
                              {attentionReasonLabel(reason)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {sample.quality?.reason ? <small className="sample-quality-reason">{sample.quality.reason}</small> : null}
                      {sample.quality?.recommendedAction ? (
                        <small className="sample-quality-action">建议：{sample.quality.recommendedAction}</small>
                      ) : null}
                      {sample.reviewNote ? <small>{sample.reviewNote}</small> : null}
                      {isEditingSample && sampleEdit ? (
                        <div className="sample-edit-panel">
                          {editingBlockingReasons.length || hasEditingReviewRisk ? (
                            <div className="sample-edit-risk-note" role="status">
                              <strong>{editingBlockingReasons.length ? "补齐后才能训练" : "保存前先核对"}</strong>
                              <span>
                                {editingBlockingReasons.length
                                  ? "这条样本还缺训练必填信息，补齐后才能保存并确认。"
                                  : "先确认客户原话、客服回复、Agent 和场景都对应同一个客户问题。"}
                              </span>
                              {editingBlockingReasons.length ? (
                                <div className="sample-edit-risk-tags blocking">
                                  {editingBlockingReasons.map((reason) => (
                                    <em key={reason}>{reason}</em>
                                  ))}
                                </div>
                              ) : null}
                              {attentionReasons.length ? (
                                <div className="sample-edit-risk-tags">
                                  {attentionReasons.slice(0, 3).map((reason) => (
                                    <em key={reason.code}>{reason.label}</em>
                                  ))}
                                </div>
                              ) : null}
                              {isSceneUncertainTrainingSample(sample) ? (
                                <small>场景判断：{sampleSceneCheckLabel(sample)}，保存并确认后会按当前 Agent 和场景进入训练。</small>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="sample-edit-grid">
                            <div className="sample-agent-control">
                              <span>Agent</span>
                              <div className="segmented-control filter-segment sample-agent-segment" role="group" aria-label="Agent">
                                {agents.map((agent) => (
                                  <button
                                    aria-pressed={sampleEdit.agentKey === agent.key}
                                    className={sampleEdit.agentKey === agent.key ? "selected" : ""}
                                    key={agent.key}
                                    onClick={() => setSampleEdit({ ...sampleEdit, agentKey: agent.key })}
                                    type="button"
                                  >
                                    {agent.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <label>
                              <span>场景</span>
                              <input
                                value={sampleEdit.scene}
                                onChange={(event) => setSampleEdit({ ...sampleEdit, scene: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>评分</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={sampleEdit.score}
                                onChange={(event) => setSampleEdit({ ...sampleEdit, score: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>Skill 提示</span>
                              <input
                                value={sampleEdit.skillHints}
                                onChange={(event) => setSampleEdit({ ...sampleEdit, skillHints: event.target.value })}
                                placeholder="预算澄清、设计需求确认、高情商话术"
                              />
                            </label>
                          </div>
                          <label>
                            <span>客户问题</span>
                            <textarea
                              value={sampleEdit.customerText}
                              onChange={(event) => setSampleEdit({ ...sampleEdit, customerText: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>标准回复</span>
                            <textarea
                              value={sampleEdit.idealReply}
                              onChange={(event) => setSampleEdit({ ...sampleEdit, idealReply: event.target.value })}
                            />
                          </label>
                          <div className="sample-actions">
                            <button type="button" className="ghost" onClick={() => saveTrainingSampleEdit(sample, "review")} disabled={Boolean(busy)}>
                              <Save size={14} aria-hidden="true" />保存待复核
                            </button>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => saveTrainingSampleEdit(sample, "ready")}
                              disabled={Boolean(busy) || editingBlockingReasons.length > 0}
                              title={editingBlockingReasons.length ? `请先补齐：${editingBlockingReasons.join("、")}` : "保存并确认样本进入训练"}
                            >
                              <Check size={14} aria-hidden="true" />保存并确认
                            </button>
                            <button type="button" className="ghost" onClick={cancelSampleEdit} disabled={Boolean(busy)}>
                              <X size={14} aria-hidden="true" />取消
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="sample-actions">
                        {editingSampleId !== sample.id ? (
                          <button type="button" className="ghost" onClick={() => startSampleEdit(sample)} disabled={Boolean(busy)}>
                            <Pencil size={14} aria-hidden="true" />编辑
                          </button>
                        ) : null}
                        {sample.status !== "ready" ? (
                          <button type="button" className="ghost" onClick={() => updateTrainingSampleStatus(sample, "ready")} disabled={Boolean(busy)}>
                            <Check size={14} aria-hidden="true" />确认训练
                          </button>
                        ) : (
                          <button type="button" className="ghost" onClick={() => updateTrainingSampleStatus(sample, "review")} disabled={Boolean(busy)}>
                            <ShieldAlert size={14} aria-hidden="true" />退回复核
                          </button>
                        )}
                        {sample.status !== "rejected" ? (
                          <button type="button" className="ghost danger" onClick={() => updateTrainingSampleStatus(sample, "rejected")} disabled={Boolean(busy)}>
                            <Ban size={14} aria-hidden="true" />禁用
                          </button>
                        ) : null}
                      </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty empty-cta" role="status">
                    <strong>{trainingSampleTotalCount ? "当前筛选下没有样本" : "还没有训练样本"}</strong>
                    <span>
                      {trainingSampleTotalCount
                        ? "切换上方筛选，或继续导入聊天记录补充更多客服样本。"
                        : "粘贴聊天记录后点击导入，样本会进入可编辑、可确认、可禁用的训练队列。"}
                    </span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={importChat} disabled={Boolean(busy)}>
                        <FileUp size={16} aria-hidden="true" />导入训练
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {hiddenTrainingSampleCount > 0 ? (
                <div className="empty small sample-load-more" role="status">
                  <span>当前筛选还有 {hiddenTrainingSampleCount} 条样本未展示，可继续先处理风险和待复核样本。</span>
                  <button type="button" className="ghost" onClick={loadMoreTrainingSamples} disabled={Boolean(busy)}>
                    <RefreshCw size={14} aria-hidden="true" />加载更多
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </section>

        <section className="send-safety-grid">
          <section className="panel" id="account-center">
            <div className="panel-head">
              <div>
                <h2><LockKeyhole size={17} aria-hidden="true" />多账号控制</h2>
                <span>每个微信账号独立排队，避免焦点混乱</span>
              </div>
              <LockKeyhole size={20} aria-hidden="true" />
            </div>
            <div className="window-actions">
              <button type="button" className="ghost" onClick={captureCurrentWindowOnce} disabled={Boolean(busy)}>
                <Search size={15} aria-hidden="true" />采集当前窗口
              </button>
              <button type="button" className="ghost" onClick={scanRealWindowSnapshots} disabled={Boolean(busy)}>
                <RefreshCw size={15} aria-hidden="true" />扫描真实窗口快照
              </button>
            </div>
            <div className="bridge-summary">
              <strong>
                窗口观察器：{operatorStatusName(windowObserverStatus?.status)}
                {windowObserverStatus?.ok ? " / 正常" : " / 需检查"}
              </strong>
              <span>
                最后更新 {windowObserverStatus?.ageSeconds ?? "-"} 秒前，前台进程 {windowObserverStatus?.result?.processName || "-"}，
                账号 {windowObserverStatus?.result?.wechatAccountId || "未匹配"}
              </span>
              <small>
                微信窗口 {windowObserverStatus?.result?.isOnline ? "已识别" : "未识别"}，置信度{" "}
                {Math.round(Number(windowObserverStatus?.result?.confidence || 0) * 100)}%，自动扫描{" "}
                {windowObserverStatus?.scan ? "开启" : "关闭"}，演练模式 {windowObserverStatus?.dryRun ? "是" : "否"}
              </small>
              {windowObserverStatus?.errorMessage || windowObserverStatus?.message ? (
                <small
                  className="danger-text"
                  title={String(windowObserverStatus?.errorMessage || windowObserverStatus?.message)}
                >
                  {operatorStatusMessage(
                    windowObserverStatus?.errorMessage || windowObserverStatus?.message,
                    "窗口观察器暂不可用，请确认本地安全服务后重试。"
                  )}
                </small>
              ) : null}
            </div>
            <div className="account-list">
              {wechatAccounts.map((account) => {
                const accountConversations = conversations.filter((conversation) => conversation.wechatAccountId === account.id);
                const lockedConversations = accountConversations.filter((conversation) => conversation.manualLocked);
                const accountTasks = sendTasks.filter((task) => task.wechatAccountId === account.id && ["queued", "blocked"].includes(task.status));
                const snapshot = latestWindowByAccount.get(account.id);
                const snapshotAge = windowSnapshotAgeSeconds(snapshot);
                const snapshotStale = isWindowSnapshotStale(snapshot);
                return (
                  <div className="account-card" key={account.id}>
                    <div>
                      <strong>{account.displayName}</strong>
                      <span className={snapshot?.diagnostic?.ok === false || snapshotStale ? "danger" : ""}>
                        {snapshot ? (snapshotStale ? "快照过旧" : windowSnapshotStatus(snapshot)) : account.isActive ? "在线" : "离线"}
                      </span>
                    </div>
                    <p>
                      {accountConversations.length} 个会话 · {lockedConversations.length} 个人工接管 · {accountTasks.length} 个待处理发送
                    </p>
                    <p>
                      当前窗口：{snapshot?.activeConversation?.title || snapshot?.chatTitle || "未采集"}
                      {snapshotAge !== null ? ` · ${snapshotAge} 秒前` : ""}
                      {snapshot?.diagnostic?.reason ? ` · ${snapshot.diagnostic.reason}` : ""}
                    </p>
                    <div className="conversation-lock-list">
                      {accountConversations.slice(0, 3).map((conversation) => (
                        <button type="button"
                          className={`ghost ${conversation.manualLocked ? "danger" : ""}`}
                          key={conversation.id}
                          onClick={() => toggleConversationManualLock(conversation, !conversation.manualLocked)}
                          disabled={Boolean(busy)}
                        >
                          <LockKeyhole size={14} aria-hidden="true" />
                          {conversation.manualLocked ? "解除" : "接管"} · {conversation.title}
                        </button>
                      ))}
                    </div>
                    <div className="window-actions">
                      <button type="button" className="ghost" onClick={() => captureDemoWindow(account, "correct")} disabled={Boolean(busy)}>
                        <ShieldCheck size={15} aria-hidden="true" />正确窗口
                      </button>
                      <button type="button" className="ghost danger" onClick={() => captureDemoWindow(account, "wrong_chat")} disabled={Boolean(busy)}>
                        <AlertTriangle size={15} aria-hidden="true" />错聊窗口
                      </button>
                      <button type="button" className="ghost" onClick={() => captureDemoWindow(account, "offline")} disabled={Boolean(busy)}>
                        <Ban size={15} aria-hidden="true" />离线窗口
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`panel send-workbench send-mode-${sendWorkbenchView}`} id="send-center">
            <div className="panel-head">
              <div>
                <h2><ShieldCheck size={17} aria-hidden="true" />发送安全队列</h2>
                <span>账号、聊天对象、最近消息三重校验</span>
              </div>
              <div className="segmented-control send-view-switcher" role="tablist" aria-label="发送中心视图">
                <button
                  type="button"
                  className={sendWorkbenchView === "queue" ? "selected" : ""}
                  aria-pressed={sendWorkbenchView === "queue"}
                  onClick={() => setSendWorkbenchView("queue")}
                >
                  队列处理
                </button>
                <button
                  type="button"
                  className={sendWorkbenchView === "blocked" ? "selected" : ""}
                  aria-pressed={sendWorkbenchView === "blocked"}
                  onClick={() => setSendWorkbenchView("blocked")}
                >
                  拦截处理
                </button>
                <button
                  type="button"
                  className={sendWorkbenchView === "diagnostics" ? "selected" : ""}
                  aria-pressed={sendWorkbenchView === "diagnostics"}
                  onClick={() => setSendWorkbenchView("diagnostics")}
                >
                  运行诊断
                </button>
              </div>
              <span className="send-view-status" role="status">{sendWorkbenchSummary}</span>
            </div>
            <div className="send-panel">
              <div className={`adapter-banner ${sendAdapter?.realSend ? "live" : "dry"}`}>
                <strong>{sendAdapter?.label || "发送适配器未连接"}</strong>
                <span>{sendAdapter?.description || "当前只允许校验和审计，不会执行真实微信发送。"}</span>
              </div>
              <div className="bridge-summary">
                <strong>
                  发送桥接：{operatorStatusName(bridgeStatus?.worker?.status)}
                  {bridgeStatus?.worker?.ok ? " / 正常" : " / 需检查"}
                </strong>
                <span>
                  模式 {bridgeModeLabel(bridgeStatus?.worker?.mode)}，回执 {bridgeTransportLabel(bridgeStatus?.worker?.ackTransport)}，最后更新 {bridgeStatus?.worker?.ageSeconds ?? "-"} 秒前
                </span>
                <small>
                  待发送 {bridgeStatus?.outbox.pendingCount ?? bridgeOutbox?.pending.length ?? 0} 个，已生成桥接指令 {bridgeStatus?.dispatch?.pendingCount ?? 0} 个，回执待扫 {bridgeStatus?.inbox.pendingCount ?? 0} 个，账号锁 {bridgeStatus?.locks.activeCount ?? 0} 个
                  {bridgeStatus?.dispatch?.staleCount ? `，指令超时 ${bridgeStatus.dispatch.staleCount} 个` : ""}
                  {bridgeStatus?.locks.staleCount ? `，疑似超时锁 ${bridgeStatus.locks.staleCount} 个` : ""}
                </small>
                {bridgeStatus?.worker?.errorMessage || bridgeStatus?.worker?.message ? (
                  <small className="danger-text" title={String(bridgeStatus.worker.errorMessage || bridgeStatus.worker.message)}>
                    {operatorStatusMessage(
                      bridgeStatus.worker.errorMessage || bridgeStatus.worker.message,
                      "发送桥接暂不可用，请确认本地安全服务后重试。"
                    )}
                  </small>
                ) : null}
              </div>
              {sendWorkbenchView === "diagnostics" ? (
                <div className="send-runtime-diagnostics" aria-label="微信安全发送运行诊断">
                  <div className={bridgeStatus?.worker?.ok ? "ok" : "warn"}>
                    <strong>桥接 worker</strong>
                    <span>{operatorStatusName(bridgeStatus?.worker?.status)}</span>
                    <small>
                      {bridgeModeLabel(bridgeStatus?.worker?.mode)} / {bridgeTransportLabel(bridgeStatus?.worker?.ackTransport)}
                    </small>
                  </div>
                  <div className={windowObserverStatus?.ok ? "ok" : "warn"}>
                    <strong>窗口观察器</strong>
                    <span>{operatorStatusName(windowObserverStatus?.status)}</span>
                    <small>最后更新 {windowObserverStatus?.ageSeconds ?? "-"} 秒前</small>
                  </div>
                  <div className={(bridgeStatus?.locks?.activeCount || 0) > 0 ? "warn" : "ok"}>
                    <strong>账号锁</strong>
                    <span>{bridgeStatus?.locks?.activeCount ?? 0} 个</span>
                    <small>{bridgeStatus?.locks?.staleCount ? `${bridgeStatus.locks.staleCount} 个疑似超时` : "无阻塞锁"}</small>
                  </div>
                  <div className={(bridgeStatus?.dispatch?.staleCount || 0) > 0 ? "warn" : "ok"}>
                    <strong>桥接指令</strong>
                    <span>{bridgeStatus?.dispatch?.pendingCount ?? 0} 个</span>
                    <small>{bridgeStatus?.dispatch?.staleCount ? `${bridgeStatus.dispatch.staleCount} 个已超时` : "等待回执正常"}</small>
                  </div>
                </div>
              ) : null}
              <div className="send-actions">
                <button type="button" className="primary send-action-create" onClick={createSendTask} disabled={Boolean(busy)}>
                  <Send size={16} aria-hidden="true" />创建演示发送
                </button>
                <button type="button" className="ghost send-action-scan" onClick={scanSendOps} disabled={Boolean(busy)}>
                  <AlertTriangle size={16} aria-hidden="true" />扫描异常
                </button>
                <button type="button" className="primary send-action-process" onClick={processSafeQueue} disabled={Boolean(busy)}>
                  <ShieldCheck size={16} aria-hidden="true" />安全处理队列
                </button>
                <span className="send-action-summary">{sendTasks.length} 个任务，{blockedSendCount} 个已拦截，{sendAttempts.length} 次尝试，{failedAttemptCount} 次异常</span>
              </div>
              {activeConversationId && visibleActiveConversationSendTaskCount ? (
                <div className="send-focus-hint" role="status">
                  当前视图已优先显示此会话相关任务，共 {visibleActiveConversationSendTaskCount} 个。
                </div>
              ) : null}
              <div className="send-task-list">
                {visibleSendTasks.length ? (
                  visibleSendTasks.map((task) => {
                    const taskConversationLocked = isSendTaskConversationLocked(task);
                    const taskBlockedByManualLock =
                      Boolean(task.guardSnapshot?.blockedByManualLock) || task.guardSnapshot?.blockedBy === "manual_lock";
                    const taskCancelledWithAudit = isAuditedCancelledSendTask(task);
                    const taskBlockedByRoutingPolicy = Boolean(task.guardSnapshot?.blockedByRoutingPolicy);
                    const taskCanBeRequeued =
                      !taskBlockedByRoutingPolicy &&
                      (["blocked", "failed", "dry_run"].includes(task.status) || (task.status === "cancelled" && !taskCancelledWithAudit));
                    const sendDisabled = Boolean(busy) || task.status === "sent" || task.status === "dry_run" || taskConversationLocked;
                    const bridgeEntry = bridgeOutboxEntryForTask(task, bridgeOutbox, bridgeStatus);
                    const bridgeDispatchEntry = bridgeDispatchEntryForTask(task, bridgeStatus);
                    const latestWindow = latestWindowByAccount.get(task.wechatAccountId) || null;
                    const taskOrderDraftId = sendTaskOrderDraftId(task);
                    return (
                      <div className={`send-task ${task.status}`} key={task.id}>
                        <button
                          type="button"
                          className="send-task-head send-task-focus-trigger"
                          onClick={() => void focusConversation(task.conversation?.id || "", "conversation-center")}
                          disabled={Boolean(busy) || !task.conversation?.id}
                          title="定位到这条发送任务对应的会话"
                        >
                          <strong>{task.conversation?.title || "未知会话"}</strong>
                          <span>{sendStatusLabel(task.status)}</span>
                        </button>
                        <p>{task.wechatAccount?.displayName || task.wechatAccountId}</p>
                        {taskBlockedByManualLock ? (
                          <p className="manual-send-block">
                            人工接管拦截：这条发送任务不会自动恢复。请先处理客户，再选择“解除并重排”或“取消任务”。
                          </p>
                        ) : null}
                        {taskConversationLocked ? (
                          <p className="danger-text">会话已人工接管，发送、执行和重新排队已暂停；可先解除接管或取消任务。</p>
                        ) : null}
                        {taskCancelledWithAudit ? (
                          <p className="manual-send-cancelled">
                            任务已取消并留痕，不会重新排队；如仍需发送，请重新生成对应报价、订单确认或跟进任务。
                          </p>
                        ) : null}
                        <SendOrderContext task={task} />
                        <SendRoutingPolicy task={task} />
                        <SendPreflightStatus task={task} latestWindow={latestWindow} />
                        <GuardChecks task={task} />
                        <SendQueueAdvice task={task} />
                        <SendManualAttentionActionHint
                          task={task}
                          canRequeue={taskCanBeRequeued}
                          conversationLocked={taskConversationLocked}
                        />
                        <SendRequeueAudit task={task} />
                        <SendCancelAudit task={task} />
                        <SendAttemptSummary task={task} />
                        <BridgeOutboxPreview entry={bridgeEntry} dispatchEntry={bridgeDispatchEntry} attempt={task.latestAttempt || task.attempts?.[0]} />
                        <div className="send-task-actions" data-send-view={sendWorkbenchView}>
                          {taskOrderDraftId ? (
                            <button type="button" className="ghost" onClick={() => focusSendTaskOrder(task)} disabled={Boolean(busy)}>
                              <Search size={16} aria-hidden="true" />定位订单
                            </button>
                          ) : null}
                          {sendWorkbenchView === "queue" ? (
                            <>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void focusConversation(task.conversation?.id || "", "conversation-center")}
                                disabled={Boolean(busy) || !task.conversation?.id}
                              >
                                <MessageCircle size={16} aria-hidden="true" />定位会话
                              </button>
                              <button type="button" className="ghost" onClick={() => validateCurrentWindow(task)} disabled={Boolean(busy) || task.status === "sent"}>
                                <LockKeyhole size={16} aria-hidden="true" />快照校验
                              </button>
                              <button type="button" className="primary" onClick={() => executeActiveSend(task)} disabled={sendDisabled}>
                                <Send size={16} aria-hidden="true" />执行适配器
                              </button>
                              <button type="button" className="primary" onClick={() => executeDryRun(task)} disabled={sendDisabled}>
                                <Send size={16} aria-hidden="true" />演练发送
                              </button>
                            </>
                          ) : null}
                          {sendWorkbenchView === "blocked" ? (
                            <>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void focusConversation(task.conversation?.id || "", "conversation-center")}
                                disabled={Boolean(busy) || !task.conversation?.id}
                              >
                                <MessageCircle size={16} aria-hidden="true" />定位会话
                              </button>
                              {taskCanBeRequeued ? (
                                <button type="button" className="ghost" onClick={() => requeueTask(task)} disabled={Boolean(busy) || taskConversationLocked}>
                                  <RefreshCw size={16} aria-hidden="true" />重新排队
                                </button>
                              ) : null}
                              {taskConversationLocked && taskCanBeRequeued ? (
                                <button type="button" className="ghost danger" onClick={() => releaseManualLockAndRequeueTask(task)} disabled={Boolean(busy) || !task.conversationId}>
                                  <LockKeyhole size={16} aria-hidden="true" />解除并重排
                                </button>
                              ) : null}
                              {task.status !== "sent" && task.status !== "cancelled" ? (
                                <button type="button" className="ghost danger" onClick={() => cancelTask(task)} disabled={Boolean(busy)}>
                                  <Ban size={16} aria-hidden="true" />取消任务
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          {sendWorkbenchView === "diagnostics" ? (
                            <>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void focusConversation(task.conversation?.id || "", "conversation-center")}
                                disabled={Boolean(busy) || !task.conversation?.id}
                              >
                                <MessageCircle size={16} aria-hidden="true" />定位会话
                              </button>
                              <button type="button" className="ghost danger" onClick={() => validateWrong(task)} disabled={Boolean(busy) || task.status === "sent"}>
                                <AlertTriangle size={16} aria-hidden="true" />错误窗口
                              </button>
                              <button type="button" className="ghost" onClick={() => validateCorrect(task)} disabled={Boolean(busy) || task.status === "sent"}>
                                <ShieldCheck size={16} aria-hidden="true" />正确窗口
                              </button>
                              <button type="button" className="ghost" onClick={() => validateCurrentWindow(task)} disabled={Boolean(busy) || task.status === "sent"}>
                                <LockKeyhole size={16} aria-hidden="true" />当前快照
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty empty-cta" role="status">
                    <strong>{sendWorkbenchView === "blocked" ? "没有需要人工处理的拦截任务" : sendWorkbenchView === "diagnostics" ? "没有可诊断的发送任务" : "发送队列为空"}</strong>
                    <span>{sendWorkbenchView === "blocked" ? "当前没有被人工接管或安全守卫拦截的发送任务。" : sendWorkbenchView === "diagnostics" ? "创建或接收发送任务后，可以在这里验证窗口、桥接和回执。" : "创建演示发送后，可继续做快照校验、适配器执行和演练发送。"}</span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={createSendTask} disabled={Boolean(busy)}>
                        <Send size={16} aria-hidden="true" />创建演示发送
                      </button>
                      <button type="button" className="ghost" onClick={scanSendOps} disabled={Boolean(busy)}>
                        <AlertTriangle size={16} aria-hidden="true" />扫描异常
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </section>

        <section className="routing-grid">
          <section className="panel" id="routing-center">
            <div className="panel-head">
              <div>
                <h2><Route size={17} aria-hidden="true" />路由决策中心</h2>
                <span>识别场景、价值等级、处理方式和缺失信息</span>
              </div>
              <Route size={20} aria-hidden="true" />
            </div>
            <div className="routing-panel">
              <div className="routing-workbench" aria-label="路由决策工作台">
                <div className="routing-composer-card" aria-label="客户消息与执行">
                  <div className="routing-actions">
                    {renderConversationSelect()}
                    <button type="button" className="ghost" onClick={processRouteInbound} disabled={Boolean(busy)}>
                      <MessageCircle size={16} aria-hidden="true" />处理客户消息
                    </button>
                  </div>
                  <textarea
                    aria-label="客户最新消息"
                    value={routeText}
                    onChange={(event) => setRouteText(event.target.value)}
                    placeholder="粘贴客户最新一句话，例如：端午礼盒每盒180元，做50份，想看效果图"
                  />
                  <div className="routing-actions routing-runbar">
                    <button type="button" className="primary" onClick={evaluateCustomerRoute} disabled={Boolean(busy)}>
                      <Route size={16} aria-hidden="true" />判断谁来处理
                    </button>
                    <span>已评估 {routeEvaluations.length} 次</span>
                  </div>
                  {inboundSummary ? <div className="training-summary">{inboundSummary}</div> : null}
                </div>
                <div className="routing-decision-card" aria-label="路由判断结果">
                  {latestRoute ? (
                    <RouteResult route={latestRoute} agents={agents} onCorrect={correctLatestRoute} />
                  ) : (
                    <div className="empty empty-cta" role="status">
                      <strong>还没有路由评估</strong>
                      <span>输入客户最新消息后，可以判断应该由哪个 Agent 处理，并生成建议回复。</span>
                      <div className="empty-actions">
                        <button type="button" className="primary" onClick={evaluateCustomerRoute} disabled={Boolean(busy)}>
                          <Route size={16} aria-hidden="true" />判断谁来处理
                        </button>
                        <button type="button" className="ghost" onClick={processRouteInbound} disabled={Boolean(busy)}>
                          <MessageCircle size={16} aria-hidden="true" />处理客户消息
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </section>

        <section className="review-grid">
          <section className={`panel review-workbench review-mode-${reviewWorkbenchView}`} id="review-center">
            <div className="panel-head">
              <div>
                <h2><ShieldAlert size={17} aria-hidden="true" />人工审核中心</h2>
                <span>高价值客户、失败任务、超时任务、待审核报价和订单统一处理</span>
              </div>
              <div className="segmented-control review-view-switcher" role="tablist" aria-label="人工审核中心视图">
                <button
                  type="button"
                  className={reviewWorkbenchView === "handoff" ? "selected" : ""}
                  aria-pressed={reviewWorkbenchView === "handoff"}
                  onClick={() => setReviewWorkbenchView("handoff")}
                >
                  人工接管
                </button>
                <button
                  type="button"
                  className={reviewWorkbenchView === "design" ? "selected" : ""}
                  aria-pressed={reviewWorkbenchView === "design"}
                  onClick={() => setReviewWorkbenchView("design")}
                >
                  设计审核
                </button>
                <button
                  type="button"
                  className={reviewWorkbenchView === "quote" ? "selected" : ""}
                  aria-pressed={reviewWorkbenchView === "quote"}
                  onClick={() => setReviewWorkbenchView("quote")}
                >
                  报价审核
                </button>
                <button
                  type="button"
                  className={reviewWorkbenchView === "order" ? "selected" : ""}
                  aria-pressed={reviewWorkbenchView === "order"}
                  onClick={() => setReviewWorkbenchView("order")}
                >
                  订单审核
                </button>
                <button
                  type="button"
                  className={reviewWorkbenchView === "logs" ? "selected" : ""}
                  aria-pressed={reviewWorkbenchView === "logs"}
                  onClick={() => setReviewWorkbenchView("logs")}
                >
                  审核记录
                </button>
              </div>
              <span className="review-view-status">{reviewWorkbenchSummary}</span>
            </div>
            <div className="review-panel">
              <div className="review-summary">
                <Metric
                  icon={<ShieldAlert size={20} aria-hidden="true" />}
                  label="待审设计"
                  value={reviewCenter.designJobs.length}
                  tone="amber"
                  ariaControls="review-center"
                  onClick={() => {
                    setReviewWorkbenchView("design");
                    scrollToWorkspaceSection("review-center");
                  }}
                />
                <Metric
                  icon={<ReceiptText size={20} aria-hidden="true" />}
                  label="待审报价"
                  value={reviewCenter.quoteDrafts.length}
                  tone="blue"
                  ariaControls="review-center"
                  onClick={() => {
                    setReviewWorkbenchView("quote");
                    scrollToWorkspaceSection("review-center");
                  }}
                />
                <Metric
                  icon={<ClipboardList size={20} aria-hidden="true" />}
                  label="待审订单"
                  value={highValueReviewOrderDrafts.length}
                  tone="amber"
                  ariaControls="review-center"
                  onClick={() => {
                    setReviewWorkbenchView("order");
                    scrollToWorkspaceSection("review-center");
                  }}
                />
                <Metric
                  icon={<LockKeyhole size={20} aria-hidden="true" />}
                  label="人工接管"
                  value={manualLockedConversations.length}
                  tone="red"
                  ariaControls="review-center"
                  onClick={() => {
                    setReviewWorkbenchView("handoff");
                    scrollToWorkspaceSection("review-center");
                  }}
                />
                <Metric
                  icon={<Check size={20} aria-hidden="true" />}
                  label="审核记录"
                  value={reviewCenter.logs.length}
                  tone="green"
                  ariaControls="review-center"
                  onClick={() => {
                    setReviewWorkbenchView("logs");
                    scrollToWorkspaceSection("review-center");
                  }}
                />
              </div>
              {activeConversation ? (
                <div className="review-conversation-trace" aria-label="当前客户审核轨迹">
                  <div className="review-conversation-trace-head">
                    <div>
                      <span>当前客户轨迹</span>
                      <strong>{activeConversation.customer?.name || activeConversation.title}</strong>
                      <small>{activeConversation.wechatAccount?.displayName || activeConversation.wechatAccountId} · {activeConversation.title}</small>
                      {activeConversation.manualLocked ? <em>人工接管中，智能体自动回复和自动发送已暂停。</em> : null}
                    </div>
                    <div className="review-conversation-trace-actions">
                      <button type="button" className="ghost compact-button" onClick={() => void focusConversation(activeConversation.id, "conversation-center")} disabled={Boolean(busy)}>
                        <MessageCircle size={14} aria-hidden="true" />会话
                      </button>
                      {activeConversationBlockedSendCount ? (
                        <button type="button" className="ghost compact-button danger" onClick={() => scrollToWorkspaceSection("send-center")} disabled={Boolean(busy)}>
                          <Send size={14} aria-hidden="true" />待发 {activeConversationBlockedSendCount}
                        </button>
                      ) : null}
                      {activeConversation.manualLocked ? (
                        <button type="button" className="primary compact-button" onClick={() => void toggleConversationManualLock(activeConversation, false)} disabled={Boolean(busy)}>
                          <Check size={14} aria-hidden="true" />处理完成
                        </button>
                      ) : null}
                      <button type="button" className="ghost compact-button" onClick={() => setReviewWorkbenchView("logs")} disabled={Boolean(busy)}>
                        <Search size={14} aria-hidden="true" />记录
                      </button>
                    </div>
                  </div>
                  {activeConversationBlockedSendCount ? (
                    <div className="review-conversation-trace-warning" role="status">
                      该客户还有 {activeConversationBlockedSendCount} 个发送任务因人工接管暂停。解除接管不会自动发送旧任务，需要到发送中心逐条核对后重排。
                    </div>
                  ) : null}
                  {activeConversationReviewActionItems.length ? (
                    <div className="review-conversation-next-actions" aria-label="当前客户待处理事项">
                      {activeConversationReviewActionItems.map((item) => (
                        <button
                          type="button"
                          className={`review-conversation-action ${item.tone}`}
                          key={item.key}
                          onClick={() => item.run()}
                          disabled={Boolean(busy)}
                          title={item.detail}
                        >
                          {item.key === "design" ? <ImageIcon size={14} aria-hidden="true" /> : null}
                          {item.key === "quote" ? <ReceiptText size={14} aria-hidden="true" /> : null}
                          {item.key === "order" ? <ClipboardList size={14} aria-hidden="true" /> : null}
                          <span>{item.label}</span>
                          <strong>{item.count}</strong>
                          {item.identityMissing ? <em>身份缺失</em> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {activeConversationReviewLogs.length ? (
                    <div className="review-conversation-trace-list">
                      {activeConversationReviewLogs.map((log) => (
                        <article className="review-conversation-trace-item" key={log.id}>
                          <strong>{reviewDecisionLabel(log.decision)}</strong>
                          <span>{formatDateTime(log.createdAt)} · {log.reviewer || "system"}</span>
                          <p>{reviewLogSummary(log)}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="review-conversation-trace-empty">当前客户还没有人工审核记录。</p>
                  )}
                </div>
              ) : null}
              <div className="deal-attention-list high-value-handoff-list" aria-label="人工跟进队列">
                <div className="deal-attention-head">
                  <strong>高价值 / 发送异常人工跟进</strong>
                  <div className="deal-attention-head-actions">
                    <span>
                      {highValueManualQueueItems.length
                        ? "先审高价值设计和报价，发送异常先核查微信账号、客户会话和发送记录"
                        : "暂无人工事项"}
                    </span>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => highValueManualQueueItems[0]?.run()}
                      disabled={Boolean(busy) || !highValueManualQueueItems.length}
                      title={highValueManualQueueItems[0]?.detail || "暂无人工事项"}
                    >
                      <ShieldAlert size={14} aria-hidden="true" />处理第一项
                    </button>
                  </div>
                </div>
                {highValueManualQueueItems.length ? (
                  <div className="deal-attention-grid">
                    {highValueManualQueueItems.map((item) => (
                      <article
                        className={`deal-attention-item ${item.tone} ${item.isActiveConversation ? "active-conversation" : ""}`}
                        key={item.id}
                      >
                        <button
                          type="button"
                          className="deal-attention-main"
                          onClick={item.focus}
                          disabled={Boolean(busy)}
                          title={item.detail}
                        >
                          <span>{item.kind}</span>
                          <strong>{item.title}</strong>
                          <small>{item.subtitle}</small>
                          <div className="deal-attention-identity" aria-label="高价值事项身份校验">
                            <mark>{item.accountLabel}</mark>
                            <mark>{item.customerLabel}</mark>
                            <mark>{item.conversationLabel}</mark>
                            {item.identityMissing ? <mark className="danger">身份缺失</mark> : null}
                            {item.isActiveConversation ? <mark className="active">当前会话</mark> : null}
                          </div>
                          <small>{item.reason}</small>
                          {item.reviewFilterLabel ? <small>订单阶段：{item.reviewFilterLabel}</small> : null}
                          {item.nextFollowLabel ? <small>{item.nextFollowLabel}</small> : null}
                          <em>{item.label}</em>
                          <p>{item.detail}</p>
                          <p>下一步：{item.nextAction}</p>
                        </button>
                        {item.order ? <OrderSendPreflightPanel order={item.order} /> : null}
                        <div className="deal-attention-actions">
                          <button type="button" className="primary" onClick={item.run} disabled={Boolean(busy)}>
                            <Search size={14} aria-hidden="true" />{item.primaryLabel}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
              {manualLockedConversations.length ? (
                <div className="manual-lock-review-list">
                  {prioritizedManualLockedConversations.slice(0, 5).map((conversation) => {
                    const manualLockLog = manualLockLogByConversationId.get(conversation.id);
                    const blockedSendCount = manualLockBlockedSendCountByConversationId.get(conversation.id) || 0;
                    const manualLockLogText = manualLockLog ? reviewLogSummary(manualLockLog) : "人工接管中，自动发送已暂停。";
                    const manualLockDisplayText = operatorStatusMessage(manualLockLogText, "人工接管中，自动发送已暂停。");
                    return (
                      <article className="manual-lock-review-item" key={conversation.id}>
                        <button
                          type="button"
                          className="manual-lock-review-main"
                          onClick={() => void focusConversation(conversation.id, "conversation-center")}
                          disabled={Boolean(busy)}
                          title="定位到这条人工接管会话"
                        >
                          <strong>{conversation.title}</strong>
                          <span>
                            {conversation.wechatAccount?.displayName || conversation.wechatAccountId} ·{" "}
                            {conversation.customer?.name || conversation.customerId}
                          </span>
                          <small title={manualLockLogText}>{manualLockDisplayText}</small>
                          {blockedSendCount ? <mark>已拦截 {blockedSendCount} 个发送任务</mark> : null}
                          {manualLockLog ? <em>接管时间：{formatDateTime(manualLockLog.createdAt)}</em> : null}
                        </button>
                        <div className="manual-lock-review-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => void focusConversation(conversation.id, "send-center")}
                            disabled={Boolean(busy)}
                          >
                            <Send size={15} aria-hidden="true" />看发送
                          </button>
                          <button
                            type="button"
                            className="ghost danger"
                            onClick={() => toggleConversationManualLock(conversation, false)}
                            disabled={Boolean(busy)}
                          >
                            <LockKeyhole size={15} aria-hidden="true" />解除
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {hiddenManualLockedConversationCount ? (
                    <div className="manual-lock-review-more" role="status">
                      还有 {hiddenManualLockedConversationCount} 个人工接管会话未展开，请先处理上方最近接管的客户。
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="review-columns">
                <div className="review-list">
                  <h3><ShieldCheck size={16} aria-hidden="true" />设计审核</h3>
                  {reviewCenter.designJobs.length ? (
                    <>
                    {reviewCenter.designJobs.slice(0, 2).map((job) => {
                      const totalImages = job.images?.length || 0;
                      const localImageCount = (job.images || []).filter((image) => Boolean(image.localPath)).length;
                      return (
                      <div className={`review-card ${job.status}`} key={job.id}>
                        <button
                          type="button"
                          className="review-card-main"
                          onClick={() => {
                            setActiveId(job.id);
                            scrollToWorkspaceSection("design-center");
                          }}
                          disabled={Boolean(busy)}
                          title="定位到这条设计任务"
                        >
                          <strong>{job.customer?.name || "未知客户"} · {readableScene(job.scene, "未填写场景")}</strong>
                          <p>
                            {statusLabel[job.status] || job.status} · {totalImages} 张图 · 本地可发 {localImageCount}/{totalImages} ·{" "}
                            {isHighValueDesignJob(job) ? "高价值" : "普通"}
                          </p>
                          {job.errorMessage ? (
                            <small title={job.errorMessage}>{operatorStatusMessage(job.errorMessage, job.errorMessage)}</small>
                          ) : null}
                        </button>
                        <div className="review-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setActiveId(job.id);
                              scrollToWorkspaceSection("design-center");
                            }}
                            disabled={Boolean(busy)}
                          >
                            <Search size={16} aria-hidden="true" />定位任务
                          </button>
                          <button type="button" className="ghost" onClick={() => reviewJob(job, "approve_images")} disabled={Boolean(busy)}>
                            <Check size={16} aria-hidden="true" />通过
                          </button>
                          <button type="button" className="primary" onClick={() => reviewJob(job, "approve_send")} disabled={!job.images?.length || Boolean(busy)}>
                            <Send size={16} aria-hidden="true" />批准发送
                          </button>
                          <button type="button" className="ghost" onClick={() => reviewJob(job, "request_revision")} disabled={Boolean(busy)}>
                            <RefreshCw size={16} aria-hidden="true" />要求改图
                          </button>
                          <button type="button" className="ghost danger" onClick={() => reviewJob(job, "reject")} disabled={Boolean(busy)}>
                            <Ban size={16} aria-hidden="true" />驳回
                          </button>
                        </div>
                      </div>
                      );
                    })}
                    {reviewCenter.designJobs.length > 2 ? (
                      <button
                        type="button"
                        className="review-list-more"
                        onClick={() => scrollToWorkspaceSection("design-center")}
                        disabled={Boolean(busy)}
                      >
                        还有 {reviewCenter.designJobs.length - 2} 个设计任务，请进入设计中心连续处理
                      </button>
                    ) : null}
                    </>
                  ) : (
                <div className="empty empty-cta" role="status">
                  <strong>暂无待审核设计任务</strong>
                  <span>可以扫描高价值转人工，或创建失败/超时演示任务来验证审核流程。</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={handoffHighValueJobs} disabled={Boolean(busy)}>
                      <ShieldAlert size={16} aria-hidden="true" />高价值转人工
                    </button>
                    <button type="button" className="ghost" onClick={createFailureDemo} disabled={Boolean(busy)}>
                      <Ban size={16} aria-hidden="true" />失败演示
                    </button>
                  </div>
                </div>
                  )}
                </div>
                <div className="review-list">
                  <h3><ReceiptText size={16} aria-hidden="true" />报价审核</h3>
                  {reviewCenter.quoteDrafts.length ? (
                    <>
                    {reviewCenter.quoteDrafts.slice(0, 2).map((quote) => (
                      <div className="review-card quote" key={quote.id}>
                        <button
                          type="button"
                          className="review-card-main"
                          onClick={() => focusQuoteCenter(quote.id)}
                          disabled={Boolean(busy)}
                          title="定位到这条报价"
                        >
                          <strong>{quote.customer?.name || "未知客户"} · {quote.totalPrice} 元</strong>
                          <p>{quote.quantity} 份 · 单价 {quote.unitPrice} 元 · 利润 {quote.profit} 元</p>
                          {quoteNeedsPaymentProofReview(quote) ? <small>付款凭证待核验，先核对金额和收款账户</small> : null}
                          {quote.owner ? <small>跟进人 {quote.owner}</small> : null}
                          {quote.sendTaskId ? <small>发送任务 {quote.sendTaskId}</small> : null}
                        </button>
                        <div className="review-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => focusQuoteCenter(quote.id)}
                            disabled={Boolean(busy)}
                          >
                            <Search size={16} aria-hidden="true" />定位报价
                          </button>
                          <button
                            type="button"
                            className="primary"
                            onClick={() => reviewQuoteDraft(quote, "approve_quote")}
                            disabled={Boolean(busy) || quoteNeedsPaymentProofReview(quote)}
                            title={quoteNeedsPaymentProofReview(quote) ? "付款凭证单需要先核验收款，不能按普通报价通过" : "报价审核通过并进入微信安全发送队列"}
                          >
                            <Check size={16} aria-hidden="true" />通过并入队
                          </button>
                          <button type="button" className="ghost" onClick={() => verifyQuotePaymentProof(quote, "deposit_paid")} disabled={Boolean(busy) || Boolean(quotePaymentProofBlockReason(quote))} title={quotePaymentProofBlockReason(quote) || "核验定金并确认订单"}>
                            <CreditCard size={16} aria-hidden="true" />定金并确认
                          </button>
                          <button type="button" className="ghost" onClick={() => verifyQuotePaymentProof(quote, "paid")} disabled={Boolean(busy) || Boolean(quotePaymentProofBlockReason(quote))} title={quotePaymentProofBlockReason(quote) || "核验全款并确认订单"}>
                            <Check size={16} aria-hidden="true" />全款并确认
                          </button>
                          <button type="button" className="ghost" onClick={() => reviewQuoteDraft(quote, "request_followup")} disabled={Boolean(busy)}>
                            <ShieldAlert size={16} aria-hidden="true" />继续跟进
                          </button>
                          <button type="button" className="ghost danger" onClick={() => reviewQuoteDraft(quote, "reject_quote")} disabled={Boolean(busy)}>
                            <Ban size={16} aria-hidden="true" />驳回报价
                          </button>
                        </div>
                      </div>
                    ))}
                    {reviewCenter.quoteDrafts.length > 2 ? (
                      <button
                        type="button"
                        className="review-list-more"
                        onClick={() => scrollToWorkspaceSection("quote-center")}
                        disabled={Boolean(busy)}
                      >
                        还有 {reviewCenter.quoteDrafts.length - 2} 个报价草稿，请进入报价中心连续处理
                      </button>
                    ) : null}
                    </>
                  ) : (
                <div className="empty empty-cta" role="status">
                  <strong>暂无待审核报价</strong>
                  <span>从设计任务生成报价并转人工后，这里会出现可通过、跟进或驳回的报价卡片。</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={createDemo} disabled={Boolean(busy)}>
                      <Boxes size={16} aria-hidden="true" />新建演示任务
                    </button>
                    <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("quote-center")} disabled={Boolean(busy)}>
                      <ReceiptText size={16} aria-hidden="true" />查看报价区
                    </button>
                  </div>
                </div>
                  )}
                </div>
                <div className="review-list">
                  <h3><ClipboardList size={16} aria-hidden="true" />订单审核</h3>
                  {highValueReviewOrderDrafts.length ? (
                    <div className="segmented-control filter-segment high-value-order-filter" role="group" aria-label="人工订单处理筛选">
                      {highValueOrderReviewFilterOptions.map((option) => (
                        <button
                          type="button"
                          className={highValueOrderReviewFilter === option.value ? "selected" : ""}
                          aria-pressed={highValueOrderReviewFilter === option.value}
                          onClick={() => setHighValueOrderReviewFilter(option.value)}
                          disabled={Boolean(busy)}
                          key={option.value}
                        >
                          {option.label}<span>{highValueOrderReviewFilterCounts[option.value] || 0}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {filteredHighValueReviewOrderDrafts.length ? (
                    <>
                    {visibleHighValueReviewOrderDrafts.map((order) => {
                      const action = highValueOrderManualPrimaryAction(order);
                      const step = highValueOrderManualStep(order);
                      const followupStatus = orderFollowupStatusText(order);
                      const latestManualNote = latestHighValueOrderManualNote(order.customerNotes);
                      const manualAttentionTask = orderSendAttentionTasks(order).find((task) => sendTaskNeedsManualAttention(task)) || null;
                      const manualAttentionSummary = manualAttentionTask ? sendTaskManualAttentionSummary(manualAttentionTask) : null;
                      return (
                        <div className={`review-card order ${step.tone}`} key={order.id}>
                          <button
                            type="button"
                            className="review-card-main"
                            onClick={() => focusOrderDraft(order)}
                            disabled={Boolean(busy)}
                            title="定位到这条订单"
                          >
                            <strong>{order.customer?.name || order.quoteDraft?.customer?.name || "未知客户"} · {formatMoney(Number(order.totalPrice || 0))} 元</strong>
                            <p>{order.quantity} 份 · 单价 {formatMoney(Number(order.unitPrice || 0))} 元 · {paymentStatusLabel(orderPaymentStatusValue(order))} · {orderStatusLabel(order.status)}</p>
                            <small>{highValueOrderReason(order)}</small>
                            <small>{step.detail}</small>
                            {order.owner ? <small>跟进人 {order.owner}</small> : null}
                            {latestManualNote ? <small>{latestManualNote}</small> : null}
                            {manualAttentionSummary ? <small>{manualAttentionSummary}</small> : null}
                            {order.confirmationSendTask ? <small>确认发送 {sendStatusLabel(order.confirmationSendTask.status)}</small> : null}
                            {followupStatus ? <small>{followupStatus}</small> : null}
                          </button>
                          <OrderSendPreflightPanel order={order} />
                          <div className="review-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => focusOrderDraft(order)}
                              disabled={Boolean(busy)}
                            >
                              <Search size={16} aria-hidden="true" />定位订单
                            </button>
                            {orderNeedsManualSendAttention(order) ? (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void focusOrderManualSendAttention(order)}
                                disabled={Boolean(busy)}
                              >
                                <Send size={16} aria-hidden="true" />查发送
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="primary"
                              onClick={() => reviewOrderDraft(order, "approve_confirmation")}
                              disabled={Boolean(busy) || action.type !== "queue_confirmation"}
                              title={action.type !== "queue_confirmation" ? action.label : "人工审核订单确认并进入微信安全发送队列"}
                            >
                              <Check size={16} aria-hidden="true" />审核发确认
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => reviewOrderDraft(order, "approve_followup", "delivery")}
                              disabled={Boolean(busy) || action.type !== "queue_delivery"}
                              title={action.type !== "queue_delivery" ? action.label : "人工审核交期说明并进入微信安全发送队列"}
                            >
                              <MessageCircle size={16} aria-hidden="true" />审核发交期
                            </button>
                            <button type="button" className="ghost" onClick={() => reviewOrderDraft(order, "request_followup")} disabled={Boolean(busy)}>
                              <ShieldAlert size={16} aria-hidden="true" />继续跟进
                            </button>
                            <button type="button" className="ghost" onClick={() => recordHighValueOrderManualFollowup(order)} disabled={Boolean(busy)}>
                              <ClipboardList size={16} aria-hidden="true" />记录跟进
                            </button>
                            <button type="button" className="ghost danger" onClick={() => reviewOrderDraft(order, "reject_order")} disabled={Boolean(busy)}>
                              <Ban size={16} aria-hidden="true" />驳回订单
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {reviewWorkbenchView !== "order" && filteredHighValueReviewOrderDrafts.length > visibleHighValueReviewOrderDrafts.length ? (
                      <button
                        type="button"
                        className="review-list-more"
                        onClick={() => scrollToWorkspaceSection("quote-center")}
                        disabled={Boolean(busy)}
                      >
                        还有 {filteredHighValueReviewOrderDrafts.length - visibleHighValueReviewOrderDrafts.length} 个待人工订单，请进入订单区连续处理
                      </button>
                    ) : null}
                    </>
                  ) : (
                <div className="empty empty-cta" role="status">
                  <strong>{highValueReviewOrderDrafts.length ? "当前筛选下没有待人工订单" : "暂无待审核订单"}</strong>
                  <span>{highValueReviewOrderDrafts.length ? "可以切回全部，或换一个处理阶段继续看。" : "客户选图生成高价值订单，或低价值订单发送异常后，这里会出现可处理的订单卡片。"}</span>
                  <div className="empty-actions">
                    <button type="button" className="primary" onClick={highValueReviewOrderDrafts.length ? () => setHighValueOrderReviewFilter("all") : () => scrollToWorkspaceSection("quote-center")} disabled={Boolean(busy)}>
                      <ClipboardList size={16} aria-hidden="true" />{highValueReviewOrderDrafts.length ? "查看全部" : "查看订单区"}
                    </button>
                    <button type="button" className="ghost" onClick={createDemo} disabled={Boolean(busy)}>
                      <Boxes size={16} aria-hidden="true" />新建演示任务
                    </button>
                  </div>
                </div>
                  )}
                </div>
              </div>
              <div className="review-log-list">
                {reviewCenter.logs.slice(0, 4).map((log) => {
                  const traceItems = reviewLogTraceItems(log);
                  return (
                    <article className="review-log-item" key={log.id}>
                      <div className="review-log-head">
                        <strong>{reviewDecisionLabel(log.decision)}</strong>
                        <span>{reviewLogSubject(log)} · {log.reviewer || "system"} · {formatDateTime(log.createdAt)}</span>
                      </div>
                      <p>{reviewLogSummary(log)}</p>
                      {traceItems.length ? (
                        <div className="review-log-trace" aria-label="审核处理轨迹">
                          {traceItems.map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        </section>

        <section className="quote-grid">
          <section className={`panel quote-workbench quote-mode-${quoteWorkbenchView}`} id="quote-center">
            <div className="panel-head">
              <div>
                <h2><ReceiptText size={17} aria-hidden="true" />报价/订单草稿</h2>
                <span>客户选图后生成报价，跟进付款和成交状态</span>
              </div>
              <div className="segmented-control quote-view-switcher" role="tablist" aria-label="报价订单工作台视图">
                <button
                  type="button"
                  className={quoteWorkbenchView === "overview" ? "selected" : ""}
                  aria-pressed={quoteWorkbenchView === "overview"}
                  onClick={() => setQuoteWorkbenchView("overview")}
                >
                  概览
                </button>
                <button
                  type="button"
                  className={quoteWorkbenchView === "actions" ? "selected" : ""}
                  aria-pressed={quoteWorkbenchView === "actions"}
                  onClick={() => setQuoteWorkbenchView("actions")}
                >
                  优先处理
                </button>
                <button
                  type="button"
                  className={quoteWorkbenchView === "quotes" ? "selected" : ""}
                  aria-pressed={quoteWorkbenchView === "quotes"}
                  onClick={() => setQuoteWorkbenchView("quotes")}
                >
                  报价列表
                </button>
                <button
                  type="button"
                  className={quoteWorkbenchView === "orders" ? "selected" : ""}
                  aria-pressed={quoteWorkbenchView === "orders"}
                  onClick={() => setQuoteWorkbenchView("orders")}
                >
                  订单跟进
                </button>
              </div>
              <span className="quote-view-status">{quoteWorkbenchSummary}</span>
              <div className="panel-actions">
                <button type="button" className="primary" onClick={progressQuoteDealFlow} disabled={Boolean(busy)}>
                  <Bot size={16} aria-hidden="true" />推进成交链路
                </button>
                <button type="button" className="ghost" onClick={processSafeQueue} disabled={Boolean(busy)}>
                  <Send size={16} aria-hidden="true" />处理发送队列
                </button>
              </div>
            </div>
            <div className="quote-panel">
              <div className="quote-summary">
                <Metric
                  icon={<ReceiptText size={20} aria-hidden="true" />}
                  label="报价草稿"
                  value={quotes.length}
                  tone="blue"
                  ariaControls="quote-center"
                  onClick={() => {
                    setQuoteWorkbenchView("quotes");
                    setQuoteStatusFilter("all");
                    scrollToWorkspaceSection("quote-center");
                  }}
                />
                <Metric
                  icon={<CreditCard size={20} aria-hidden="true" />}
                  label="已付款"
                  value={quotes.filter((quote) => quote.paymentStatus === "paid").length}
                  tone="green"
                  ariaControls="quote-center"
                  onClick={() => {
                    setQuoteWorkbenchView("quotes");
                    setQuotePaymentFilter("paid");
                    scrollToWorkspaceSection("quote-center");
                  }}
                />
                <Metric
                  icon={<ShieldAlert size={20} aria-hidden="true" />}
                  label="待核验凭证"
                  value={quotes.filter(quoteNeedsPaymentProofReview).length}
                  tone="red"
                  ariaControls="quote-center"
                  onClick={() => {
                    setQuoteWorkbenchView("quotes");
                    setQuoteStatusFilter("manual_review");
                    setQuotePaymentFilter("unpaid");
                    scrollToWorkspaceSection("quote-center");
                  }}
                />
                <Metric
                  icon={<ClipboardList size={20} aria-hidden="true" />}
                  label="订单草稿"
                  value={orderDrafts.length}
                  tone="blue"
                  ariaControls="quote-center"
                  onClick={() => {
                    setQuoteWorkbenchView("orders");
                    setOrderStatusFilter("all");
                    scrollToWorkspaceSection("quote-center");
                  }}
                />
                <Metric
                  icon={<CircleDollarSign size={20} aria-hidden="true" />}
                  label="待人工审核"
                  value={quotes.filter((quote) => quote.status === "manual_review").length}
                  tone="amber"
                  ariaControls="quote-center"
                  onClick={() => {
                    setQuoteWorkbenchView("actions");
                    setQuoteStatusFilter("manual_review");
                    scrollToWorkspaceSection("quote-center");
                  }}
                />
              </div>
              <div className="deal-pipeline" aria-label="成交流程看板">
                {quoteDealBoardItems.map((item) => (
                  <button
                    type="button"
                    className={`deal-pipeline-item ${item.tone}`}
                    key={item.key}
                    onClick={item.onClick}
                    disabled={Boolean(busy)}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.note}</small>
                  </button>
                ))}
              </div>
              <div className="deal-flow-preview" aria-label="推进成交链路预览">
                <strong>{dealFlowPreviewTotal ? "本轮将处理" : "暂无可自动推进"}</strong>
                {dealFlowPreviewItems.map((item) => (
                  <span key={item.label}>
                    {item.label} <b>{item.value}</b>
                  </span>
                ))}
              </div>
              <div className="deal-progress-summary" aria-label="成交阶段数量概览">
                {dealProgressSummaryItems.map((item) => (
                  <button
                    type="button"
                    className={`${item.tone} ${dealProgressFilter === item.filter ? "active" : ""}`}
                    key={item.filter}
                    onClick={() => {
                      setDealProgressFilter(item.filter);
                      setDealNextStepFilter("all");
                      setQuoteStatusFilter("all");
                      setQuotePaymentFilter("all");
                      setOrderStatusFilter("all");
                      setOrderPaymentFilter("all");
                      setQuoteWorkbenchView(item.view);
                    }}
                    disabled={Boolean(busy)}
                    title={item.detail}
                  >
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                    <small>{item.detail}</small>
                  </button>
                ))}
              </div>
              <div className="deal-next-summary" aria-label="下一步处理概览">
                {dealNextStepSummaryItems.map((item) => (
                  <button
                    type="button"
                    className={`${item.tone} ${dealNextStepFilter === item.filter ? "active" : ""}`}
                    key={item.key}
                    onClick={() => {
                      setDealNextStepFilter(item.filter);
                      setQuoteWorkbenchView("actions");
                    }}
                    disabled={Boolean(busy)}
                    title={item.detail}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </button>
                ))}
                <button
                  type="button"
                  className={dealNextStepFilter === "all" ? "active" : ""}
                  onClick={() => {
                    setDealNextStepFilter("all");
                    setQuoteWorkbenchView("actions");
                  }}
                  disabled={Boolean(busy)}
                  title="显示全部报价和订单"
                >
                  <span>全部</span>
                  <strong>{quotes.length + orderDrafts.length}</strong>
                  <small>显示全部报价和订单</small>
                </button>
              </div>
              <div className="deal-attention-list" aria-label="成交优先处理提醒">
                <div className="deal-attention-head">
                  <strong>优先处理</strong>
                  <div className="deal-attention-head-actions">
                    <span>{dealNextStepInsightItems.length ? "按可执行事项优先排序" : "当前没有需要立即处理的成交事项"}</span>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => firstActionableDealNextStep?.execute()}
                      disabled={Boolean(busy) || !firstActionableDealNextStep}
                      title={firstActionableDealNextStep?.detail || "当前没有可执行事项"}
                    >
                      <Bot size={14} aria-hidden="true" />执行第一项
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={runVisibleActionableDealNextSteps}
                      disabled={Boolean(busy) || !actionableDealNextStepItems.length}
                      title={
                        actionableDealNextStepItems.length
                          ? `批量执行前 ${Math.min(actionableDealNextStepItems.length, 3)} 个可执行事项`
                          : "当前没有可批量执行事项"
                      }
                    >
                      <Send size={14} aria-hidden="true" />执行前三项
                    </button>
                  </div>
                </div>
                {dealNextStepInsightItems.length ? (
                  <div className="deal-attention-grid">
                    {dealNextStepInsightItems.map((item) => (
                      <article
                        className={`deal-attention-item ${item.tone}`}
                        key={item.id}
                      >
                        <button
                          type="button"
                          className="deal-attention-main"
                          onClick={item.focus}
                          disabled={Boolean(busy)}
                          title={item.detail}
                        >
                          <span>{item.kind}</span>
                          <strong>{item.title}</strong>
                          <small>{item.subtitle}</small>
                          <em>{item.label}</em>
                          <p>{item.detail}</p>
                        </button>
                        <div className="deal-attention-actions">
                          <button
                            type="button"
                            className={item.action === "none" ? "ghost" : "primary"}
                            onClick={item.execute}
                            disabled={Boolean(busy) || item.action === "none"}
                            title={item.detail}
                          >
                            <Bot size={14} aria-hidden="true" />执行
                          </button>
                          <button type="button" className="ghost" onClick={item.focus} disabled={Boolean(busy)}>
                            定位
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="quote-filter-bar">
                <label className="search-field quote-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    aria-label="搜索客户、场景、报价、订单"
                    value={quoteCenterSearch}
                    onChange={(event) => setQuoteCenterSearch(event.target.value)}
                    placeholder="搜索客户、场景、报价、订单"
                  />
                </label>
                {renderFilterSegment("报价状态", quoteStatusOptions, quoteStatusFilter, setQuoteStatusFilter)}
                {renderFilterSegment("报价付款", paymentStatusOptions, quotePaymentFilter, setQuotePaymentFilter)}
                {renderFilterSegment("成交阶段", dealProgressFilterOptions, dealProgressFilter, setDealProgressFilter)}
                {renderFilterSegment("下一步", dealNextStepFilterOptions, dealNextStepFilter, setDealNextStepFilter)}
              </div>
              {activeQuoteCenterFocusText ? (
                <div className="quote-focus-strip" aria-label="当前报价订单聚焦条件">
                  <span>正在聚焦：{activeQuoteCenterFocusText}</span>
                  <button type="button" className="ghost compact-button" onClick={clearQuoteCenterFocus} disabled={Boolean(busy)} title="清除当前聚焦和筛选">
                    <X size={14} aria-hidden="true" />清除聚焦
                  </button>
                </div>
              ) : null}
              <div className="quote-section-head">
                <strong>报价列表</strong>
                <div className="quote-section-meta">
                  <span>显示 {filteredQuotes.length} / {quotes.length} 个</span>
                  {dealProgressFilter !== "all" ? (
                    <button
                      type="button"
                      className="active-filter-chip"
                      onClick={() => setDealProgressFilter("all")}
                      disabled={Boolean(busy)}
                      title="清除成交阶段筛选"
                    >
                      阶段：{activeDealProgressFilterLabel}
                      <X size={12} aria-hidden="true" />
                    </button>
                  ) : null}
                  {dealNextStepFilter !== "all" ? (
                    <button
                      type="button"
                      className="active-filter-chip"
                      onClick={() => setDealNextStepFilter("all")}
                      disabled={Boolean(busy)}
                      title="清除下一步筛选"
                    >
                      下一步：{activeDealNextStepFilterLabel}
                      <X size={12} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="quote-list">
                {filteredQuotes.length ? (
                  filteredQuotes.map((quote) => {
                    const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
                    const selectedImage = quoteSelectedImage(quote);
                    const rowPreview = quoteCenterPreviewId === quote.id ? quoteCenterPreview : null;
                    const rowPreviewWarnings = rowPreview?.warnings || [];
                    const rowSendRisk = quoteSendBlockReason(quote, rowPreviewWarnings);
                      const nextStep = guardedQuoteDealNextStep(quote, orderDraft, rowSendRisk);
                    const rowProgressSteps = dealProgressSteps(quote, orderDraft);
                    const rowRiskItems = dealRiskItemsForQuote(quote, rowSendRisk);
                    const rowCustomerNote = customerNoteSummary(quote.customerNotes);
                    return (
                    <div className={`quote-row ${quote.status}`} key={quote.id}>
                      <button
                        type="button"
                        className="quote-main quote-focus-trigger"
                        onClick={() => focusQuoteCenter(quote.id)}
                        disabled={Boolean(busy)}
                        title="聚焦这条报价和对应订单"
                      >
                        <div className="quote-identity">
                          <SelectedImageThumb job={quote.designJob} image={selectedImage} label="报价选图" />
                          <div>
                            <strong>{quote.customer?.name || "未知客户"}</strong>
                            <p>{readableScene(quote.designJob?.scene, "未填写场景")} · {quote.quantity} 份 · {quote.unitPrice} 元/份</p>
                          </div>
                        </div>
                        <div className="quote-money">
                          <strong>{quote.totalPrice} 元</strong>
                          <span>利润 {quote.profit} 元</span>
                        </div>
                      </button>
                      <div className="quote-tags">
                        <span>{quoteStatusLabel(quote.status)}</span>
                        <span>{paymentStatusLabel(quote.paymentStatus)}</span>
                        <span>{selectedImage ? `选中第 ${selectedImage.position || "-"} 张` : "未选图"}</span>
                        {quoteNeedsPaymentProofReview(quote) ? <span>付款凭证待核验</span> : null}
                        <span>利润率 {Math.round(Number(quote.profitRate || 0) * 100)}%</span>
                        {quote.owner ? <span>跟进人 {quote.owner}</span> : null}
                        {quote.sendTask ? <span>发送{sendStatusLabel(quote.sendTask.status)}</span> : null}
                        {quote.sendTaskId && !quote.sendTask ? <span>任务 {quote.sendTaskId}</span> : null}
                        {orderDraft ? <span>订单 {orderStatusLabel(orderDraft.status)}</span> : null}
                        {orderDraft?.confirmationSendTask ? <span>确认{sendStatusLabel(orderDraft.confirmationSendTask.status)}</span> : null}
                        {orderDraft ? orderFollowupStatusItems(orderDraft).map((item) => <span key={item.key}>{item.label}</span>) : null}
                        {rowSendRisk && !quote.sendTaskId ? <span>发送检查 {rowSendRisk}</span> : null}
                      </div>
                      <div className="commercial-review-strip" aria-label="报价商业核对">
                        {commercialReviewItems(quote).map((item) => (
                          <span className={item.tone} key={item.label}>
                            <b>{item.label}</b>
                            <strong>{item.value}</strong>
                          </span>
                        ))}
                      </div>
                      {rowRiskItems.length ? (
                        <div className="deal-risk-strip" aria-label="报价风险提示">
                          {rowRiskItems.map((item) => (
                            <span className={item.tone} key={item.label}>{item.label}</span>
                          ))}
                        </div>
                      ) : null}
                      {rowCustomerNote ? (
                        <div className="quote-note-strip" aria-label="报价备注">
                          <span>备注</span>
                          <p>{rowCustomerNote}</p>
                        </div>
                      ) : null}
                      <div className="deal-progress compact" aria-label="报价成交进度">
                        {rowProgressSteps.map((step) => (
                          <span className={step.state} key={step.key} title={step.label}>
                            <i>{step.index}</i>
                            <b>{step.label}</b>
                          </span>
                        ))}
                      </div>
                      <div className={`deal-next-step inline ${nextStep.tone}`}>
                        <div>
                          <strong>{nextStep.label}</strong>
                          <span>{nextStep.detail}</span>
                        </div>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => runQuoteDealNextStep(quote, orderDraft, rowSendRisk)}
                          disabled={Boolean(busy) || nextStep.action === "none"}
                          title={nextStep.detail}
                        >
                          <Bot size={16} aria-hidden="true" />执行
                        </button>
                      </div>
                      {rowPreview ? (
                        <div className="quote-preview quote-row-preview">
                          <strong>发送话术预览</strong>
                          <p>{rowPreview.message}</p>
                          {rowPreviewWarnings.length ? (
                            <div className="quote-preview-warnings">
                              {rowPreviewWarnings.map((warning) => (
                                <span key={warning}>{quoteWarningLabel(warning)}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="quote-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => toggleQuoteCenterPreview(quote)}
                          disabled={Boolean(busy)}
                          title={rowPreview ? "隐藏报价发送话术" : "查看报价发送话术"}
                        >
                          <ReceiptText size={16} aria-hidden="true" />{rowPreview ? "隐藏话术" : "查看话术"}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => copyQuoteCenterPreviewMessage(rowPreview)}
                          disabled={Boolean(busy) || !rowPreview?.message}
                          title="复制当前报价话术"
                        >
                          <ClipboardList size={16} aria-hidden="true" />复制话术
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => reviseQuoteDraftSelection(quote)}
                          disabled={Boolean(busy) || quote.status === "accepted" || Boolean(orderDraft) || !(quote.designJob?.images?.length)}
                          title={
                            quote.status === "accepted"
                              ? "已成交报价不能直接修订选图"
                              : orderDraft
                                ? "已生成订单草稿，不能直接修订报价选图"
                                : "按客户新选择修订报价选图"
                          }
                        >
                          <ImageIcon size={16} aria-hidden="true" />修订选图
                        </button>
                        <button type="button" className="ghost" onClick={() => queueQuoteDraft(quote)} disabled={Boolean(busy) || Boolean(rowSendRisk)} title={rowSendRisk || "发送报价"}>
                          <Send size={16} aria-hidden="true" />发送报价
                        </button>
                        <button type="button" className="ghost" onClick={() => verifyQuotePaymentProof(quote, "deposit_paid")} disabled={Boolean(busy) || Boolean(quotePaymentProofBlockReason(quote))} title={quotePaymentProofBlockReason(quote) || "核验定金并确认订单"}>
                          <CreditCard size={16} aria-hidden="true" />核验定金并确认
                        </button>
                        {orderDraft ? (
                          <button type="button" className="ghost" onClick={() => focusOrderDraft(orderDraft)} disabled={Boolean(busy)} title="只显示这条报价和对应订单">
                            <ReceiptText size={16} aria-hidden="true" />定位订单
                          </button>
                        ) : null}
                        <button type="button" className="ghost" onClick={() => createOrderDraft(quote)} disabled={Boolean(busy) || Boolean(quoteOrderDraftBlockReason(quote))} title={quoteOrderDraftBlockReason(quote) || "按当前报价生成或更新订单草稿"}>
                          <ClipboardList size={16} aria-hidden="true" />{orderDraft ? "更新订单" : "生成订单"}
                        </button>
                        <button type="button" className="primary" onClick={() => verifyQuotePaymentProof(quote, "paid")} disabled={Boolean(busy) || Boolean(quotePaymentProofBlockReason(quote))} title={quotePaymentProofBlockReason(quote) || "核验全款并确认订单"}>
                          <Check size={16} aria-hidden="true" />核验全款并确认
                        </button>
                        <button type="button" className="ghost danger" onClick={() => confirmQuoteManualFollowup(quote)} disabled={Boolean(busy)}>
                          <ShieldAlert size={16} aria-hidden="true" />人工跟进
                        </button>
                      </div>
                    </div>
                    );
                  })
                ) : (
                  <div className="empty empty-cta" role="status">
                    <strong>{quotes.length ? "当前筛选下没有报价" : "还没有报价草稿"}</strong>
                    <span>{quotes.length ? "可以调整关键词、报价状态或付款状态。" : "先创建演示任务并完成选图，再生成报价草稿。"}</span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={createDemo} disabled={Boolean(busy)}>
                        <Boxes size={16} aria-hidden="true" />新建演示任务
                      </button>
                      <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("design-center")} disabled={Boolean(busy)}>
                        <Layers size={16} aria-hidden="true" />去设计中心
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="order-panel">
                <div className="order-panel-head">
                  <div>
                    <strong>订单草稿</strong>
                    <span>成交后进入排产、收款和人工跟进的工作台</span>
                  </div>
                  <div className="quote-section-meta">
                    <em>{filteredOrderDrafts.length} / {orderDrafts.length} 个</em>
                    {dealProgressFilter !== "all" ? (
                      <button
                        type="button"
                        className="active-filter-chip"
                        onClick={() => setDealProgressFilter("all")}
                        disabled={Boolean(busy)}
                        title="清除成交阶段筛选"
                      >
                        阶段：{activeDealProgressFilterLabel}
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                    {dealNextStepFilter !== "all" ? (
                      <button
                        type="button"
                        className="active-filter-chip"
                        onClick={() => setDealNextStepFilter("all")}
                        disabled={Boolean(busy)}
                        title="清除下一步筛选"
                      >
                        下一步：{activeDealNextStepFilterLabel}
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="order-filter-bar">
                  <label className="search-field quote-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      aria-label="搜索客户、场景、订单"
                      value={quoteCenterSearch}
                      onChange={(event) => setQuoteCenterSearch(event.target.value)}
                      placeholder="搜索客户、场景、订单"
                    />
                  </label>
                  {renderFilterSegment("订单状态", orderStatusOptions, orderStatusFilter, setOrderStatusFilter)}
                  {renderFilterSegment("订单付款", paymentStatusOptions, orderPaymentFilter, setOrderPaymentFilter)}
                  {renderFilterSegment("成交阶段", dealProgressFilterOptions, dealProgressFilter, setDealProgressFilter)}
                  {renderFilterSegment("下一步", dealNextStepFilterOptions, dealNextStepFilter, setDealNextStepFilter)}
                </div>
                {activeQuoteCenterFocusText ? (
                  <div className="quote-focus-strip" aria-label="当前订单聚焦条件">
                    <span>正在聚焦：{activeQuoteCenterFocusText}</span>
                    <button type="button" className="ghost compact-button" onClick={clearQuoteCenterFocus} disabled={Boolean(busy)} title="清除当前聚焦和筛选">
                      <X size={14} aria-hidden="true" />清除聚焦
                    </button>
                  </div>
                ) : null}
                <div className="order-list">
                  {filteredOrderDrafts.length ? (
                    filteredOrderDrafts.map((order) => {
                      const selectedImage = orderSelectedImage(order);
                      const nextStep = guardedOrderDealNextStep(order);
                      const linkedQuote = order.quoteDraft || quotes.find((quote) => quote.id === order.quoteDraftId) || null;
                      const rowProgressSteps = linkedQuote ? dealProgressSteps(linkedQuote, order) : [];
                      const rowRiskItems = dealRiskItemsForOrder(order);
                      const rowCustomerNote = customerNoteSummary(order.customerNotes || order.quoteDraft?.customerNotes);
                      return (
                      <div className={`order-row ${order.status}`} key={order.id}>
                        <button
                          type="button"
                          className="order-row-main quote-focus-trigger"
                          onClick={() => focusOrderDraft(order)}
                        disabled={Boolean(busy)}
                          title="聚焦这条订单和对应报价"
                        >
                          <div className="quote-identity">
                            <SelectedImageThumb job={order.designJob || order.quoteDraft?.designJob || null} image={selectedImage} label="订单选图" />
                            <div>
                              <strong>{order.customer?.name || order.quoteDraft?.customer?.name || "未知客户"}</strong>
                              <p>{firstReadableScene([order.designJob?.scene, order.quoteDraft?.designJob?.scene])} · {order.quantity} 份 · {order.unitPrice} 元/份</p>
                            </div>
                          </div>
                          <div className="order-total">
                            <strong>{order.totalPrice} 元</strong>
                            <span>利润 {order.profit} 元</span>
                          </div>
                        </button>
                        <div className="quote-tags order-tags">
                          <span>{orderStatusLabel(order.status)}</span>
                          <span>{paymentStatusLabel(orderPaymentStatusValue(order))}</span>
                          <span>{selectedImage ? `选中第 ${selectedImage.position || "-"} 张` : "未选图"}</span>
                          {order.confirmationSendTask ? <span>确认{sendStatusLabel(order.confirmationSendTask.status)}</span> : null}
                          {orderFollowupStatusItems(order).map((item) => <span key={item.key}>{item.label}</span>)}
                          <span>报价 {order.quoteDraftId}</span>
                          {order.owner ? <span>跟进人 {order.owner}</span> : null}
                          <span>{formatDateTime(order.updatedAt)}</span>
                        </div>
                        <div className="commercial-review-strip" aria-label="订单商业核对">
                          {commercialReviewItems(order).map((item) => (
                            <span className={item.tone} key={item.label}>
                              <b>{item.label}</b>
                              <strong>{item.value}</strong>
                            </span>
                          ))}
                        </div>
                        {rowRiskItems.length ? (
                          <div className="deal-risk-strip" aria-label="订单风险提示">
                            {rowRiskItems.map((item) => (
                              <span className={item.tone} key={item.label}>{item.label}</span>
                            ))}
                          </div>
                        ) : null}
                        {rowCustomerNote ? (
                          <div className="quote-note-strip" aria-label="订单备注">
                            <span>备注</span>
                            <p>{rowCustomerNote}</p>
                          </div>
                        ) : null}
                        {rowProgressSteps.length ? (
                          <div className="deal-progress compact" aria-label="订单成交进度">
                            {rowProgressSteps.map((step) => (
                              <span className={step.state} key={step.key} title={step.label}>
                                <i>{step.index}</i>
                                <b>{step.label}</b>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <OrderSendPreflightPanel order={order} />
                        <div className={`deal-next-step inline ${nextStep.tone}`}>
                          <div>
                            <strong>{nextStep.label}</strong>
                            <span>{nextStep.detail}</span>
                          </div>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => runOrderDealNextStep(order)}
                            disabled={Boolean(busy) || nextStep.action === "none"}
                            title={nextStep.detail}
                          >
                            <Bot size={16} aria-hidden="true" />执行
                          </button>
                        </div>
                        {orderConfirmationPreviewId === order.id && orderConfirmationPreview ? (
                          <div className="quote-preview quote-row-preview">
                            <strong>订单确认话术预览</strong>
                            <p>{orderConfirmationPreview.message}</p>
                            {orderConfirmationPreview.warnings.length ? (
                              <div className="quote-preview-warnings">
                                {orderConfirmationPreview.warnings.map((warning) => (
                                  <span key={warning}>{orderWarningLabel(warning)}</span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="quote-actions compact">
                          <button type="button" className="ghost" onClick={() => focusOrderDraft(order)} disabled={Boolean(busy)} title="只显示这条订单和对应报价">
                            <ReceiptText size={16} aria-hidden="true" />查看报价
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => toggleOrderConfirmationPreview(order)}
                            disabled={Boolean(busy)}
                            title={orderConfirmationPreviewId === order.id ? "隐藏订单确认话术" : "发送前查看订单确认话术"}
                          >
                            <MessageCircle size={16} aria-hidden="true" />{orderConfirmationPreviewId === order.id ? "隐藏话术" : "预览话术"}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => copyOrderConfirmationPreviewMessage(orderConfirmationPreview)}
                            disabled={Boolean(busy) || orderConfirmationPreviewId !== order.id || !orderConfirmationPreview?.message}
                            title="复制当前订单确认话术"
                          >
                            <ClipboardList size={16} aria-hidden="true" />复制确认
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => reviseOrderDraftSelection(order)}
                            disabled={Boolean(busy) || Boolean(orderRevisionBlockReason(order))}
                            title={orderRevisionBlockReason(order) || "按客户新选择修订订单选图"}
                          >
                            <ImageIcon size={16} aria-hidden="true" />修订选图
                          </button>
                          <button type="button"
                            className="ghost"
                            onClick={() => queueOrderDraftConfirmation(order)}
                              disabled={
                                Boolean(busy) ||
                                Boolean(orderConfirmationBlockReason(order))
                              }
                            title={orderConfirmationButtonTitle(order)}
                          >
                            <Send size={16} aria-hidden="true" />{orderConfirmationButtonLabel(order)}
                          </button>
                          {order.confirmationSendTask ? (
                            <button type="button" className="ghost" onClick={() => showOrderConfirmationMessage(order)} disabled={Boolean(busy)} title="查看本次订单确认话术">
                              <MessageCircle size={16} aria-hidden="true" />话术
                            </button>
                          ) : null}
                          {canCancelOrderConfirmationTask(order) ? (
                            <button type="button" className="ghost danger" onClick={() => cancelOrderConfirmation(order)} disabled={Boolean(busy)} title="取消尚未发送的订单确认任务">
                              <X size={16} aria-hidden="true" />取消确认
                            </button>
                          ) : null}
                          <button type="button" className="ghost" onClick={() => verifyOrderPaymentProof(order, "deposit_paid")} disabled={Boolean(busy) || Boolean(orderPaymentProofBlockReason(order))} title={orderPaymentProofBlockReason(order) || "核验定金并确认订单"}>
                            <CreditCard size={16} aria-hidden="true" />核验定金并确认
                          </button>
                          <button type="button" className="ghost" onClick={() => verifyOrderPaymentProof(order, "paid")} disabled={Boolean(busy) || Boolean(orderPaymentProofBlockReason(order))} title={orderPaymentProofBlockReason(order) || "核验全款并确认订单"}>
                            <Check size={16} aria-hidden="true" />核验全款并确认
                          </button>
                          <button type="button" className="ghost" onClick={() => confirmAndStartOrderProduction(order)} disabled={Boolean(busy) || Boolean(orderProductionBlockReason(order))} title={orderProductionBlockReason(order) || "核验付款和选图后标记生产中"}>
                            <PackageSearch size={16} aria-hidden="true" />生产中
                          </button>
                          {renderOrderFollowupControls(order, "production")}
                          {renderOrderFollowupControls(order, "delivery")}
                          <button type="button" className="ghost" onClick={() => confirmAndUpdateOrderDraftStatus(order, "fulfilled")} disabled={Boolean(busy) || Boolean(orderFulfillmentBlockReason(order))} title={orderFulfillmentBlockReason(order) || "生产完成后标记订单完成"}>
                            <ShieldCheck size={16} aria-hidden="true" />完成
                          </button>
                          <button type="button" className="ghost danger" onClick={() => confirmAndUpdateOrderDraftStatus(order, "cancelled")} disabled={Boolean(busy)}>
                            <Ban size={16} aria-hidden="true" />取消
                          </button>
                        </div>
                      </div>
                      );
                    })
                  ) : (
                    <div className="empty empty-cta small" role="status">
                      <strong>{orderDrafts.length ? "当前筛选下没有订单草稿" : "暂无订单草稿"}</strong>
                      <span>{orderDrafts.length ? "可以调整关键词、订单状态或付款状态。" : "从报价行点击“生成订单”后会显示在这里。"}</span>
                      <div className="empty-actions">
                        <button type="button" className="primary" onClick={createDemo} disabled={Boolean(busy)}>
                          <Boxes size={16} aria-hidden="true" />新建演示任务
                        </button>
                        <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("quote-center")} disabled={Boolean(busy)}>
                          <ReceiptText size={16} aria-hidden="true" />查看报价
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </section>

        <footer className="system-footer" aria-label="系统状态栏">
          <span>
            <ImageIcon size={14} aria-hidden="true" />
            <i className={`footer-dot ${platformHealth?.ok ? "online" : "offline"}`} aria-hidden="true" />
            {platformStateText}
          </span>
          <span>
            <Bot size={14} aria-hidden="true" />
            <i className={`footer-dot ${automationStatus?.active ? "online" : "warning"}`} aria-hidden="true" />
            {automationStateText}
          </span>
          <span>
            <Send size={14} aria-hidden="true" />
            <i className={`footer-dot ${pendingSendTaskCount ? "warning" : "online"}`} aria-hidden="true" />
            {queueStateText}
          </span>
          <span>
            <ShieldAlert size={14} aria-hidden="true" />
            <i className={`footer-dot ${manualReviewJobCount ? "warning" : "online"}`} aria-hidden="true" />
            {reviewStateText}
          </span>
          <strong className={busy ? "busy" : undefined}>{busy ? `${busy}处理中` : "本地工作台已就绪"}</strong>
        </footer>
      </section>
    </main>
  );
}

function PreflightPanel({
  job,
  preflight,
  platformHealth,
  onPreflight,
  disabled,
}: {
  job: DesignJob;
  preflight: DesignJobPreflightResult | null;
  platformHealth: DesignPlatformHealth | null;
  onPreflight: () => void;
  disabled?: boolean;
}) {
  const checks = preflight?.checks || [];
  const readinessMissing = job.readiness?.missing || [];
  const referenceCount = (job.images?.length || 0) + (job.assets?.length || 0);
  const totalImages = job.images?.length || 0;
  const localImageCount = (job.images || []).filter((image) => Boolean(image.localPath)).length;
  const remoteOnlyImageCount = (job.images || []).filter((image) => !image.localPath && Boolean(image.downloadUrl)).length;
  const failedChecks = checks.filter((check) => !check.ok);
  const errors = failedChecks.filter((check) => check.severity === "error");
  const warnings = failedChecks.filter((check) => check.severity === "warning");
  const bundleAutomation = job.bundle?.automation || null;
  const bundleAutomationBlocked = bundleAutomation?.ready === false;
  const tone = preflight ? (errors.length ? "error" : warnings.length ? "warning" : "ok") : readinessMissing.length ? "warning" : "idle";
  const platformText = platformHealth?.ok
    ? `${designPlatformAdapterLabel(platformHealth.adapter)} ${platformHealth.latencyMs}ms`
    : "未连接";
  const compactRequestId = formatCompactRequestId(job.requestId);
  const outputRange = preflight?.requiredOutputCountRange;
  const outputCountText = outputRange
    ? `${preflight?.outputCount ?? job.outputCount} / 要求${outputRange.min}-${outputRange.max}张`
    : `${job.outputCount || 0}张`;
  const callbackText = preflight?.callback
    ? `${preflight.callback.fallbackPolling ? "回调+轮询" : "仅回调"}${
        preflight.callback.hasAuthorization ? " / 已签名" : " / 未签名"
      }`
    : "";

  return (
    <div className={`preflight-panel ${tone}`}>
      <div className="preflight-head">
        <div>
          <strong>{preflight ? (preflight.ok ? "出图预检通过" : "出图预检未通过") : "出图提交前预检"}</strong>
          <span title={`任务 ${job.requestId}`}>
            任务 {compactRequestId} · {isHighValueDesignJob(job) ? "高价值人工审核" : "普通客户快速确认"}
          </span>
        </div>
        <button
          type="button"
          className="ghost compact-button"
          onClick={onPreflight}
          disabled={disabled}
          aria-label="执行出图预检"
          title="执行出图预检"
        >
          <ShieldCheck size={15} aria-hidden="true" />预检
        </button>
      </div>
      <div className="preflight-metrics">
        <span>平台：{platformText}</span>
        <span>任务状态：{statusLabel[job.status] || job.status}</span>
        <span>候选图：{outputCountText}</span>
        <span>图片/素材：{preflight?.usableReferenceCount ?? referenceCount}</span>
        <span>本地可发：{localImageCount}/{totalImages}</span>
        {callbackText ? <span>结果回传：{callbackText}</span> : null}
        {bundleAutomation ? <span>组合自动化：{bundleAutomation.ready ? "可自动" : "需人工"}</span> : null}
        {remoteOnlyImageCount ? <span>待本地保存：{remoteOnlyImageCount}</span> : null}
        {preflight ? <span>不可用引用：{preflight.unusableReferenceCount}</span> : null}
      </div>
      {bundleAutomation ? (
        <div className="preflight-checks">
          <span className={bundleAutomationBlocked ? "error" : "passed"}>
            {bundleAutomationBlocked ? "错误" : "通过"} · 商品组合自动化：
            {bundleAutomationBlocked
              ? `阻塞项 ${automationBlockerListLabel(bundleAutomation.blockers || []) || "未说明"}`
              : "利润、交期、规格和装盒尺寸满足自动出图/报价要求"}
          </span>
        </div>
      ) : null}
      {preflight ? (
        <div className="preflight-checks">
          {checks.slice(0, 6).map((check) => (
            <span className={check.ok ? "passed" : check.severity} key={check.key}>
              {check.ok ? "通过" : check.severity === "error" ? "错误" : "提醒"} · {check.label}
              {check.detail ? `：${check.detail}` : ""}
            </span>
          ))}
        </div>
      ) : readinessMissing.length ? (
        <div className="preflight-checks">
          {readinessMissing.slice(0, 6).map((missing) => (
            <span className="warning" key={missing}>待补齐 · {fieldLabel(missing)}</span>
          ))}
        </div>
      ) : (
        <p>提交前会检查设计平台、客户素材、SKU真实图片和任务身份，避免把不完整需求发去出图。</p>
      )}
    </div>
  );
}

function formatCompactRequestId(value: string) {
  const compact = value.replace(/[^a-zA-Z0-9]/g, "");
  if (!compact) return "未编号";
  return compact.length > 8 ? compact.slice(0, 8) : compact;
}

function Metric({
  icon,
  label,
  value,
  tone,
  onClick,
  ariaControls,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
  onClick?: () => void;
  ariaControls?: string;
}) {
  const content = (
    <>
      <span aria-hidden="true">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        aria-controls={ariaControls}
        className={`metric ${tone} actionable`}
        onClick={onClick}
        title={`打开${label}`}
        type="button"
      >
        {content}
      </button>
    );
  }
  return <div className={`metric ${tone}`}>{content}</div>;
}

function noticeTone(level: string) {
  if (level === "error") return "red";
  if (level === "warning") return "amber";
  return "blue";
}

function noticeHasTarget(notice: NotificationItem) {
  const target = notice.target || {};
  return Boolean(target.orderDraftId || target.quoteDraftId || target.designJobId || target.sendTaskId || target.conversationId);
}

function noticeTargetSummary(notice: NotificationItem) {
  const target = notice.target || {};
  const parts: string[] = [];
  const reason = String(target.reason || "");
  if (reason) parts.push(inboundSelectionReasonLabel(reason));
  if (target.orderDraftId) parts.push(`订单 ${target.orderDraftId}`);
  if (target.quoteDraftId) parts.push(`报价 ${target.quoteDraftId}`);
  if (target.designJobId) parts.push(`设计任务 ${target.designJobId}`);
  if (target.sendTaskId) parts.push(`发送任务 ${target.sendTaskId}`);
  if (target.selectedImageId) parts.push(`客户想选图 ${target.selectedImageId}`);
  if (target.conversationId) parts.push(`会话 ${target.conversationId}`);
  return parts.join(" · ");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function downloadBase64File(fileName: string, mimeType: string, dataBase64: string) {
  const binary = window.atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "sku-import-template.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(fileName: string, mimeType: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType || "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "export.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatDateForFile(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

function skuImportMappingSummary(result: SkuImportResult) {
  const missing = result.missingRequiredFields?.map((field) => field.label).filter(Boolean) || [];
  const unmapped = result.unmappedHeaders?.filter(Boolean) || [];
  const parts = [];
  if (missing.length) parts.push(`缺必填表头：${missing.join("、")}。`);
  if (unmapped.length) parts.push(`未识别表头：${unmapped.slice(0, 5).join("、")}。`);
  return parts.join("");
}

function GuardChecks({ task }: { task: SendTask }) {
  const checks = task.guardSnapshot?.checks || [];
  if (!checks.length) {
    return <small className="guard-empty">尚未校验</small>;
  }
  return (
    <div className="guard-checks">
      {checks.map((check) => (
        <span className={check.passed ? "passed" : "failed"} key={check.key}>
          {check.label}
        </span>
      ))}
    </div>
  );
}

function SendPreflightStatus({ task, latestWindow }: { task: SendTask; latestWindow?: WechatWindowSnapshot | null }) {
  const checks = task.guardSnapshot?.checks || [];
  const failedChecks = checks.filter((check) => !check.passed);
  const latestAttempt = task.latestAttempt || task.attempts?.[0] || null;
  const guardStatus = String(task.guardSnapshot?.status || latestAttempt?.guardStatus || "").trim();
  const latestWindowDiagnostic = latestWindow?.diagnostic;
  const storedWindowDiagnostic = task.guardSnapshot?.windowDiagnostic || null;
  const effectiveWindowDiagnostic = latestWindowDiagnostic || storedWindowDiagnostic;
  const latestWindowChatTitle = latestWindow?.activeChatTitle || latestWindow?.chatTitle || "";
  const windowDiagnosticReason = effectiveWindowDiagnostic?.reason || "";
  const windowDiagnosticKeys = (effectiveWindowDiagnostic?.failedKeys || [])
    .filter(Boolean)
    .slice(0, 3)
    .map((key) => sendWindowDiagnosticKeyLabel(key))
    .join("、");
  const status = sendPreflightStatus(task, guardStatus, failedChecks.length, latestWindow || null);
  const failedSummary = failedChecks
    .slice(0, 3)
    .map((check) => sendGuardCheckLabel(check))
    .join("、");
  const windowSummary = latestWindow
    ? `当前窗口：${latestWindowChatTitle || "未识别聊天"}${latestWindow.recentCustomerId ? ` / 最近客户 ${latestWindow.recentCustomerId}` : ""}`
    : "当前窗口：还没有可用快照";
  return (
    <div className={`send-preflight-status ${status.tone}`} aria-label="发送前实时校验状态">
      <div>
        <strong>{status.label}</strong>
        <span>{status.detail}</span>
      </div>
      <small>{failedSummary ? `失败项：${failedSummary}` : windowSummary}</small>
      {windowDiagnosticReason ? <small>窗口诊断：{windowDiagnosticReason}</small> : null}
      {windowDiagnosticKeys ? <small>诊断失败项：{windowDiagnosticKeys}</small> : null}
      <small>{status.nextAction}</small>
    </div>
  );
}

function SendQueueAdvice({ task }: { task: SendTask }) {
  const advice = task.guardSnapshot?.queueBlockedAdvice;
  if (!advice) return null;
  return (
    <div className={`queue-advice ${advice.severity || "info"}`}>
      <strong>自动发送暂缓</strong>
      <span>{advice.message}</span>
      <small>{advice.recommendedAction}</small>
      {advice.blockingTaskId ? <small>前序任务：{advice.blockingTaskId}</small> : null}
    </div>
  );
}

function SendRoutingPolicy({ task }: { task: SendTask }) {
  const policy = task.payload?.routingPolicy;
  if (!policy) return null;
  return (
    <div className={`queue-advice ${policy.manualRequired ? "warning" : "info"}`} aria-label="路由处理策略">
      <strong>路由策略：{routingPolicyLaneLabel(policy.lane || "")}</strong>
      {policy.reason ? <span>{policy.reason}</span> : null}
      {policy.nextStep ? <small>{policy.nextStep}</small> : null}
      <div className="route-evidence-tags">
        <span className={policy.manualRequired ? "warn" : "pass"}>{policy.handler === "human" ? "人工处理" : "智能体处理"}</span>
        <span>{policy.valueTier === "high" ? "高价值" : "普通价值"}</span>
        <span className={policy.canQueueAutoReply ? "pass" : "warn"}>
          {policy.canQueueAutoReply ? "允许排队回复" : "不自动排队"}
        </span>
        {policy.safeguards?.slice(0, 4).map((item) => (
          <span key={item}>{routingPolicySafeguardLabel(item)}</span>
        ))}
      </div>
    </div>
  );
}

function SendManualAttentionActionHint({
  task,
  canRequeue,
  conversationLocked,
}: {
  task: SendTask;
  canRequeue: boolean;
  conversationLocked: boolean;
}) {
  const hint = sendManualAttentionActionHint(task, canRequeue, conversationLocked);
  if (!hint) return null;
  return (
    <div className={`queue-advice ${hint.tone}`} aria-label="人工处理下一步">
      <strong>{hint.title}</strong>
      <span>{hint.detail}</span>
      <small>{hint.action}</small>
    </div>
  );
}

function SendRequeueAudit({ task }: { task: SendTask }) {
  const history = task.guardSnapshot?.history || [];
  let requeueEvent: (typeof history)[number] | undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.action === "requeue") {
      requeueEvent = history[index];
      break;
    }
  }
  const reason = task.guardSnapshot?.requeueReason || requeueEvent?.reason;
  const at = task.guardSnapshot?.requeuedAt || requeueEvent?.at;
  if (!reason && !at) return null;
  return (
    <div className="send-requeue-audit">
      <strong>最近重排</strong>
      <span>{reason ? sendRequeueReasonLabel(reason) : "人工重新排队"}</span>
      {at ? <small>{formatDateTime(at)}</small> : null}
    </div>
  );
}

function SendOrderContext({ task }: { task: SendTask }) {
  const context = sendOrderContext(task);
  if (!context) return null;
  return (
    <div className="send-order-context" aria-label="订单发送上下文">
      <strong>{context.label}</strong>
      <span>{context.detail}</span>
      <small>{context.stage}</small>
    </div>
  );
}

function SendCancelAudit({ task }: { task: SendTask }) {
  const history = task.guardSnapshot?.history || [];
  let cancelEvent: (typeof history)[number] | undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.action === "cancel") {
      cancelEvent = history[index];
      break;
    }
  }
  const reason = task.guardSnapshot?.cancelReason || cancelEvent?.reason;
  const at = task.guardSnapshot?.cancelledAt || cancelEvent?.at;
  if (!reason && !at) return null;
  return (
    <div className="send-cancel-audit">
      <strong>取消记录</strong>
      <span>{reason ? sendCancelReasonLabel(reason) : "人工取消发送任务"}</span>
      {at ? <small>{formatDateTime(at)}</small> : null}
    </div>
  );
}

function sendOrderContext(task: SendTask) {
  const automation = (task.guardSnapshot as { automation?: Record<string, unknown> } | undefined)?.automation || {};
  const orderDraftId = sendTaskOrderDraftId(task);
  if (!orderDraftId) return null;
  const source = String(automation.source || task.payload?.source || "").trim();
  const followupType = String(automation.followupType || task.payload?.followupType || "").trim();
  const valueLevel = String(automation.valueLevel || task.payload?.valueLevel || "").trim();
  const label = source === "order_followup" || followupType
    ? "订单跟进发送"
    : "订单确认发送";
  const stage = followupType === "production"
    ? "生产进度"
    : followupType === "delivery"
      ? "交付/签收"
      : source === "low_value_quote_acceptance"
        ? "报价接受后确认"
        : "确认客户已付款或已确认";
  const detailParts = [`订单 ${orderDraftId}`];
  if (valueLevel === "low") detailParts.push("低价值自动化");
  if (valueLevel === "high") detailParts.push("高价值人工审核");
  if (source) detailParts.push(sendAutomationSourceLabel(source));
  return {
    label,
    detail: detailParts.join(" · "),
    stage,
  };
}

function sendTaskOrderDraftId(task: SendTask) {
  const automation = (task.guardSnapshot as { automation?: Record<string, unknown> } | undefined)?.automation || {};
  return String(automation.orderDraftId || task.payload?.orderDraftId || "").trim();
}

function sendTaskManualAttentionSummary(task: SendTask) {
  const guardReason = String(task.guardSnapshot?.reason || "").trim();
  const attemptReason = String(task.latestAttempt?.errorMessage || task.attempts?.[0]?.errorMessage || "").trim();
  const failedKeys = (task.guardSnapshot?.failedKeys || [])
    .filter(Boolean)
    .map((key) => sendGuardCheckLabel({ key }))
    .join("、");
  const reason = task.errorMessage || guardReason || attemptReason || failedKeys || "请打开发送中心查看校验记录";
  return `发送任务 ${task.id}：${sendStatusLabel(task.status)}，${operatorStatusMessage(reason, reason)}`;
}

function sendManualAttentionActionHint(task: SendTask, canRequeue: boolean, conversationLocked: boolean) {
  const status = String(task.status || "");
  if (!["blocked", "failed", "cancelled", "dry_run"].includes(status)) return null;
  if (task.guardSnapshot?.blockedByRoutingPolicy) {
    return {
      tone: "warning",
      title: "路由策略转人工",
      detail: "系统已判断这条发送不适合直接重排，避免高价值、风险或不确定场景被智能体继续发送。",
      action: "请人工核对客户价值、场景、话术和下一步动作；需要发送时重新生成新的发送任务。",
    };
  }
  if (status === "cancelled") {
    return {
      tone: "info",
      title: "人工留痕",
      detail: "任务已取消，不会自动重排。",
      action: "如仍需发送，请重新生成报价、订单确认或跟进任务。",
    };
  }
  if (conversationLocked && canRequeue) {
    return {
      tone: "warning",
      title: "先解除人工锁",
      detail: "会话仍在人工接管中，智能体不会自动继续发送。",
      action: "确认客户问题处理完后，再点“解除并重排”。",
    };
  }
  if (status === "dry_run") {
    return {
      tone: "info",
      title: "演练已留痕",
      detail: "演练不会真实发送给客户。",
      action: "确认窗口和内容无误后，从队列执行正式发送。",
    };
  }
  if (canRequeue) {
    return {
      tone: "info",
      title: "可重新排队",
      detail: "先核对微信账号、聊天对象、最近消息和订单/付款状态。",
      action: "确认无误后，可点“重新排队”。",
    };
  }
  return {
    tone: "error",
    title: "保持人工处理",
    detail: "当前任务不适合自动重排。",
    action: "请在订单或会话里继续人工跟进，并重新生成任务。",
  };
}

function sendAutomationSourceLabel(source: string) {
  const labels: Record<string, string> = {
    order_confirmation: "订单确认",
    order_followup: "订单跟进",
    low_value_quote_acceptance: "低价值报价成交",
  };
  return labels[source] || source;
}

function SendAttemptSummary({ task }: { task: SendTask }) {
  const attempt = task.latestAttempt || task.attempts?.[0];
  if (!attempt) {
    return <small className="guard-empty">尚未执行发送尝试</small>;
  }
  const rejectedAck = sendAttemptBridgeAckRejected(attempt);
  return (
    <div className={`attempt-summary ${attempt.status}`}>
      <span>{sendAttemptStatusLabel(attempt.status)}</span>
      <small>
        {sendAdapterName(attempt.adapter)} · {sendPayloadKindLabel(attempt.payloadSummary?.kind)} · 文本 {attempt.payloadSummary?.textLength || 0} 字 · 图片 {attempt.payloadSummary?.imageCount || 0} 张
      </small>
      {attempt.errorMessage ? (
        <small title={attempt.errorMessage}>{operatorStatusMessage(attempt.errorMessage, attempt.errorMessage)}</small>
      ) : null}
      {rejectedAck ? (
        <div className="attempt-audit-note">
          <strong>回执被拒绝</strong>
          <small title={rejectedAck.fileName || undefined}>
            {rejectedAck.sourceLabel}
            {rejectedAck.fileName ? ` · ${rejectedAck.fileName}` : ""}
          </small>
          {rejectedAck.reason ? <small title={rejectedAck.reason}>{operatorStatusMessage(rejectedAck.reason, rejectedAck.reason)}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function BridgeOutboxPreview({
  entry,
  dispatchEntry,
  attempt,
}: {
  entry?: BridgeOutboxEntry | null;
  dispatchEntry?: BridgeDispatchEntry | null;
  attempt?: SendAttempt | null;
}) {
  const preview = entry?.preview;
  const outboxFile = preview?.outboxFileName || entry?.fileName || sendAttemptOutboxFileName(attempt);
  const dispatchFile = dispatchEntry?.fileName || "";
  if (!outboxFile && attempt?.adapter !== "windows_bridge") return null;

  return (
    <div className="bridge-preview">
      <div className="bridge-preview-head">
        <strong>桥接发送确认</strong>
        <span title={outboxFile || undefined}>{outboxFile ? "桥接文件已生成" : "等待桥接文件"}</span>
      </div>
      {dispatchFile ? (
        <small title={dispatchFile}>
          桥接指令已生成，等待外部微信桥发送后回执 · {dispatchFile}
        </small>
      ) : null}
      {dispatchEntry?.ackFileNameHint ? (
        <small title={dispatchEntry.ackFileNameHint}>
          回执建议文件 · {dispatchEntry.ackFileNameHint}
        </small>
      ) : null}
      {dispatchEntry?.expiresAt ? (
        <small className={dispatchEntry.expired ? "danger-text" : undefined}>
          指令有效期至 {formatDateTime(dispatchEntry.expiresAt)}
          {dispatchEntry.expired ? "，已过期请重新生成" : ""}
        </small>
      ) : null}
      {dispatchEntry?.preflight?.requiredBeforeSend?.length ? (
        <small>
          发送前校验 {dispatchEntry.preflight.requiredBeforeSend.length} 项 ·
          {dispatchEntry.preflight.rejectIfAnyCheckFails ? " 任一失败即停止" : " 需人工确认"}
        </small>
      ) : null}
      <small>
        账号 {preview?.wechatAccountId || entry?.wechatAccountId || dispatchEntry?.wechatAccountId || "-"} · 会话{" "}
        {preview?.conversationId || entry?.conversationId || dispatchEntry?.conversationId || "-"} · 客户{" "}
        {preview?.customerId || entry?.customerId || dispatchEntry?.preflight?.expectedCustomerId || "-"}
      </small>
      <small>
        动作 {preview?.actionCount ?? entry?.actionCount ?? dispatchEntry?.actionCount ?? 0} 个 · 文字 {preview?.textActionCount ?? 0} 段/{preview?.textLength ?? 0} 字 · 图片{" "}
        {preview?.imageActionCount ?? 0} 张
      </small>
      <small>
        窗口快照 {preview?.windowSnapshotId || attempt?.windowSnapshotId || "-"} · 守卫 {preview?.guardStatus || attempt?.guardStatus || "-"}
      </small>
      <small>协议 {preview?.protocolVersion || dispatchEntry?.protocolVersion || "-"}</small>
    </div>
  );
}

function bridgeOutboxEntryForTask(
  task: SendTask,
  bridgeOutbox?: BridgeOutboxResult | null,
  bridgeStatus?: BridgeStatusResult | null,
) {
  const latestAttempt = task.latestAttempt || task.attempts?.[0] || null;
  const outboxFileName = sendAttemptOutboxFileName(latestAttempt);
  const entries = [
    ...(bridgeStatus?.outbox?.pending || []),
    ...(bridgeOutbox?.pending || []),
  ];
  return entries.find((entry) =>
    entry.taskId === task.id ||
    (latestAttempt?.id && entry.attemptId === latestAttempt.id) ||
    (outboxFileName && entry.fileName === outboxFileName),
  ) || null;
}

function bridgeDispatchEntryForTask(task: SendTask, bridgeStatus?: BridgeStatusResult | null) {
  const latestAttempt = task.latestAttempt || task.attempts?.[0] || null;
  const entries = bridgeStatus?.dispatch?.pending || [];
  return entries.find((entry) =>
    entry.taskId === task.id ||
    (latestAttempt?.id && entry.attemptId === latestAttempt.id),
  ) || null;
}

function sendStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "待校验",
    blocked: "已拦截",
    sending: "发送中",
    dry_run: "干跑已审计",
    sent: "已发送",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] || status;
}

function sendRequeueReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    manual_operator_requeue_from_send_center: "人工从发送中心重新排队",
    manual_resolution_before_send_requeue: "人工处理完成后解除接管并重排",
  };
  return labels[reason] || reviewReasonLabel(reason);
}

function sendCancelReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    manual_operator_cancel_from_send_center: "人工从发送中心取消任务",
    manual_takeover_cancel_send_task: "人工接管后取消自动发送任务",
  };
  return labels[reason] || reviewReasonLabel(reason);
}

function sendPreflightStatus(task: SendTask, guardStatus: string, failedCheckCount: number, latestWindow: WechatWindowSnapshot | null) {
  if (task.status === "sent") {
    return {
      tone: "ok",
      label: "已发送",
      detail: "任务已经完成，保留校验和发送记录用于复盘。",
      nextAction: "如客户反馈未收到，先查发送尝试和桥接回执，不要重复发给错误会话。",
    };
  }
  if (task.status === "cancelled") {
    return {
      tone: "idle",
      label: "已取消",
      detail: "这条任务不会重新排队或自动发送。",
      nextAction: "如仍需发送，请重新生成对应报价、订单确认或跟进任务。",
    };
  }
  if (failedCheckCount > 0 || ["blocked", "failed"].includes(task.status) || ["blocked", "failed"].includes(guardStatus)) {
    return {
      tone: "danger",
      label: "不可发送",
      detail: "账号、聊天对象或最近客户校验没有通过。",
      nextAction: "先定位会话并确认微信窗口是同一个客户；仍不一致时转人工处理。",
    };
  }
  if (task.status === "sending") {
    return {
      tone: "warning",
      label: "等待回执",
      detail: "任务已经交给发送适配器或桥接指令，正在等待回执。",
      nextAction: "不要重复点击执行；先等桥接回执或扫描发送异常。",
    };
  }
  if (guardStatus === "passed") {
    return {
      tone: "ok",
      label: "校验通过",
      detail: "最近一次三重校验通过，可以继续按安全发送流程执行。",
      nextAction: "执行前仍会再次校验当前窗口，避免 A 客户内容发给 B 客户。",
    };
  }
  if (latestWindow?.diagnostic?.ok === false || task.guardSnapshot?.windowDiagnostic?.ok === false) {
    return {
      tone: "warning",
      label: "窗口待处理",
      detail: "最新窗口快照没有通过诊断。",
      nextAction: "先切到正确微信账号和客户聊天，再点当前快照校验。",
    };
  }
  return {
    tone: "idle",
    label: "待校验",
    detail: "还没有基于当前窗口完成三重校验。",
    nextAction: "先点当前快照校验，确认账号、聊天对象和最近客户都一致后再执行。",
  };
}

function sendGuardCheckLabel(check: { key?: string; label?: string }) {
  if (check.label) return check.label;
  const labels: Record<string, string> = {
    wechatAccount: "微信账号",
    activeChatTitle: "聊天对象",
    recentMessageOrCustomerId: "最近客户",
    queueHead: "账号队列头",
    manualLock: "人工接管",
    conversationManualUnlocked: "会话未被人工接管",
    conversationManualLocked: "会话已人工接管",
    binding: "任务绑定",
    routingPolicyManualRequired: "路由策略要求人工处理",
    routingPolicyQueueDisabled: "路由策略禁止自动排队",
  };
  return labels[String(check.key || "")] || String(check.key || "未知检查");
}

function sendWindowDiagnosticKeyLabel(key: string) {
  const labels: Record<string, string> = {
    windowSnapshotMissing: "无窗口快照",
    windowDiagnosticFailed: "窗口诊断失败",
    wechatAccountMissing: "微信账号缺失",
    wechatAccountMismatch: "微信账号不一致",
    activeChatTitleMissing: "聊天对象缺失",
    activeChatTitleMismatch: "聊天对象不一致",
    recentCustomerMissing: "最近客户缺失",
    recentCustomerMismatch: "最近客户不一致",
    conversationNotFound: "未匹配会话",
    windowOffline: "微信离线",
    staleWindowSnapshot: "快照过期",
  };
  return labels[String(key || "")] || String(key || "未知诊断");
}

function promptManualResolutionNote(conversationTitle: string, fallback = "") {
  const text = window.prompt(
    `请填写「${conversationTitle}」人工处理结果。\n\n例如：已电话确认预算和款式，客户同意恢复自动报价。`,
    fallback,
  );
  return String(text || "").trim();
}

function hasActiveOrderConfirmationTask(order: OrderDraft) {
  const task = order.confirmationSendTask;
  return Boolean(task && !["failed", "cancelled"].includes(task.status));
}

function orderPaymentReady(order: OrderDraft) {
  return ["deposit_paid", "paid"].includes(orderPaymentStatusValue(order));
}

function orderPaymentStatusValue(order: OrderDraft) {
  return order.paymentStatus || order.quoteDraft?.paymentStatus || "unpaid";
}

function orderSelectedImageIdValue(order: OrderDraft) {
  return order.selectedImageId || order.quoteDraft?.selectedImageId || "";
}

function orderStrictIdentityMissing(order: OrderDraft) {
  return !order.wechatAccountId || !order.customerId || !order.conversationId;
}

function orderStrictIdentityWarning() {
  return "缺少微信账号、客户或会话绑定";
}

function orderStrictIdentityBlockReason(actionLabel: string) {
  return `订单${orderStrictIdentityWarning()}，不能${actionLabel}。`;
}

function orderRevisionBlockReason(order: OrderDraft) {
  if (!["draft", "confirmed"].includes(order.status)) {
    return "订单已进入生产、完成或取消阶段，不能直接修订选图。";
  }
  if (!(order.designJob?.images?.length || order.quoteDraft?.designJob?.images?.length)) {
    return "订单没有候选图，不能修订选图。";
  }
  const tasks = [
    order.confirmationSendTask,
    order.followupSendTask,
    order.productionFollowupSendTask,
    order.deliveryFollowupSendTask,
    ...(order.followupSendTasks || []),
  ].filter(Boolean) as SendTask[];
  const lockedTask = tasks.find((task) => !["failed", "cancelled", "dry_run"].includes(task.status));
  if (lockedTask) {
    return `订单已有${sendStatusLabel(lockedTask.status)}的确认或跟进消息，不能直接改图。`;
  }
  return "";
}

function isAuditedCancelledSendTask(task?: SendTask | null) {
  return Boolean(task?.status === "cancelled" && (task.guardSnapshot?.cancelledAt || task.guardSnapshot?.cancelReason));
}

function canRequeueOrderConfirmationTask(order: OrderDraft) {
  const task = order.confirmationSendTask;
  const status = task?.status;
  if (isAuditedCancelledSendTask(task)) return false;
  return status === "failed" || status === "cancelled" || status === "dry_run";
}

function canCancelOrderConfirmationTask(order: OrderDraft) {
  const status = order.confirmationSendTask?.status;
  return status === "queued" || status === "blocked" || status === "sending";
}

function orderConfirmationText(order: OrderDraft) {
  const text = order.confirmationSendTask?.payload?.text;
  return typeof text === "string" ? text : "";
}

function orderConfirmationButtonLabel(order: OrderDraft) {
  if (order.status === "cancelled") return "已取消";
  if (canRequeueOrderConfirmationTask(order)) return "重发确认";
  if (!orderPaymentReady(order)) return "待收款";
  if (!hasActiveOrderConfirmationTask(order)) return "发送确认";
  return order.confirmationSendTask?.status === "sent" ? "确认已发" : "确认已入队";
}

function orderConfirmationButtonTitle(order: OrderDraft) {
  if (order.status === "cancelled") return "订单已取消，不能发送确认";
  const blocker = orderConfirmationBlockReason(order);
  if (blocker) return blocker;
  const task = order.confirmationSendTask;
  if (canRequeueOrderConfirmationTask(order)) return `订单确认任务${sendStatusLabel(task?.status || "")}，点击重新排队`;
  if (!task || ["failed", "cancelled"].includes(task.status)) return "生成订单确认话术并放入微信安全发送队列";
  return `订单确认消息${sendStatusLabel(task.status)}，任务 ${task.id}`;
}

function sendTaskFollowupType(task?: SendTask | null): "production" | "delivery" | "any" {
  const automation = (task?.guardSnapshot as { automation?: Record<string, unknown> } | undefined)?.automation;
  const type = automation?.followupType || task?.payload?.followupType;
  return type === "production" || type === "delivery" ? type : "any";
}

function orderFollowupTask(order: OrderDraft, type: "production" | "delivery") {
  const direct = type === "delivery" ? order.deliveryFollowupSendTask : order.productionFollowupSendTask;
  if (direct) return direct;
  return (order.followupSendTasks || []).find((task) => sendTaskFollowupType(task) === type) || null;
}

function orderFollowupStageLabel(type: "production" | "delivery") {
  return type === "delivery" ? "交期说明" : "生产通知";
}

function orderFollowupText(order: OrderDraft, type: "production" | "delivery") {
  const text = orderFollowupTask(order, type)?.payload?.text;
  return typeof text === "string" ? text : "";
}

function canRequeueOrderFollowupTask(order: OrderDraft, type: "production" | "delivery") {
  const task = orderFollowupTask(order, type);
  const status = task?.status;
  if (isAuditedCancelledSendTask(task)) return false;
  return status === "failed" || status === "cancelled" || status === "dry_run";
}

function canCancelOrderFollowupTask(order: OrderDraft, type: "production" | "delivery") {
  const status = orderFollowupTask(order, type)?.status;
  return status === "queued" || status === "blocked" || status === "sending";
}

function orderFollowupButtonLabel(order: OrderDraft, type: "production" | "delivery") {
  const task = orderFollowupTask(order, type);
  if (canRequeueOrderFollowupTask(order, type)) return type === "delivery" ? "重发交期" : "重发生产";
  if (!task || ["failed", "cancelled"].includes(task.status)) return orderFollowupStageLabel(type);
  if (task.status === "sent") return type === "delivery" ? "交期已发" : "生产已发";
  return type === "delivery" ? "交期已入队" : "生产已入队";
}

function orderFollowupStatusItems(order: OrderDraft) {
  const items: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const productionTask = orderFollowupTask(order, "production");
  const deliveryTask = orderFollowupTask(order, "delivery");
  if (productionTask) {
    seen.add(productionTask.id);
    items.push({ key: productionTask.id, label: `生产${sendStatusLabel(productionTask.status)}` });
  }
  if (deliveryTask) {
    seen.add(deliveryTask.id);
    items.push({ key: deliveryTask.id, label: `交期${sendStatusLabel(deliveryTask.status)}` });
  }
  const genericTask = order.followupSendTask;
  if (genericTask && !seen.has(genericTask.id)) {
    items.push({ key: genericTask.id, label: `跟进${sendStatusLabel(genericTask.status)}` });
  }
  return items;
}

function orderFollowupStatusText(order: OrderDraft) {
  return orderFollowupStatusItems(order).map((item) => item.label).join(" · ");
}

type LowValueAutomationIssue = {
  key: string;
  tone: "error" | "warning";
  stage: string;
  target: string;
  title: string;
  reason: string;
  detail?: string;
  action: string;
  missing: string[];
  orderDraftId?: string;
  quoteDraftId?: string;
  designJobId?: string;
  requestId?: string;
};

type LowValueSkippedItem = {
  orderDraftId?: string;
  quoteDraftId?: string;
  designJobId?: string;
  requestId?: string;
  reason: string;
  followupType?: string;
  missing?: string[];
};

type LowValueFailedItem = {
  orderDraftId?: string;
  quoteDraftId?: string;
  designJobId?: string;
  requestId?: string;
  followupType?: string;
  errorMessage: string;
};

type LowValueIssueSource = {
  skipped?: LowValueSkippedItem[];
  failed?: LowValueFailedItem[];
};

type LowValueAutomationSummary = {
  title: string;
  subtitle: string;
  tone: "idle" | "ok" | "warning" | "error";
  metrics: Array<{ label: string; value: string | number }>;
};

type LowValueAutomationIssueSummary = {
  total: number;
  errors: number;
  warnings: number;
  missingFields: number;
  manualLocks: number;
  sendTargets: number;
  resolutionAction: "run_low_value" | "scan_send_ops";
  resolutionLabel: string;
  resolutionDetail: string;
  resolutionButtonLabel: string;
  firstIssue?: LowValueAutomationIssue;
};

const EMPTY_LOW_VALUE_AUTOMATION_ISSUE_SUMMARY: LowValueAutomationIssueSummary = {
  total: 0,
  errors: 0,
  warnings: 0,
  missingFields: 0,
  manualLocks: 0,
  sendTargets: 0,
  resolutionAction: "run_low_value",
  resolutionLabel: "",
  resolutionDetail: "",
  resolutionButtonLabel: "",
};

type AutomationStepItem = {
  key: string;
  label: string;
  detail: string;
  tone: "ok" | "warning" | "error" | "idle";
};

type AutomationStepInsight = {
  title: string;
  detail: string;
  tone: "ok" | "warning" | "error";
  metrics: Array<{ label: string; value: string | number; tone?: "ok" | "warning" | "error" }>;
};

type AutomationRunHistorySummary = {
  tone: "ok" | "warning" | "error";
  title: string;
  detail: string;
  metrics: Array<{ label: string; value: string | number; tone?: "ok" | "warning" | "error" }>;
};

type AutomationRunHistoryItem = {
  key: string;
  title: string;
  subtitle: string;
  result: string;
  duration: string;
  failedStep: string;
  tone: "ok" | "warning" | "error";
};

type AutomationSkipSummaryPanel = {
  total: number;
  title: string;
  detail: string;
  reasons: Array<{
    reason: string;
    label: string;
    count: number;
    steps: string;
    sampleTargets: string;
    tone: "ok" | "warning" | "error";
  }>;
};

const LOW_VALUE_NORMAL_SKIP_REASONS = new Set([
  "already_queued",
  "already_has_order_draft",
  "quote_not_accepted",
  "status_not_ready",
  "order_cancelled",
]);

function buildAutomationRuntimeItems(status?: AutomationStatus | null) {
  if (!status) return [];
  const intervalSeconds = Math.max(3, Math.round((status.intervalMs || 0) / 1000));
  return [
    {
      label: "后台状态",
      value: status.running ? "正在执行" : status.active ? "已开启" : status.enabled ? "已暂停" : "未启用",
      tone: status.running || status.active ? "ok" : status.enabled ? "warning" : "error",
    },
    {
      label: "下次运行",
      value: status.running
        ? status.runningStartedAt
          ? `本轮 ${formatDateTime(status.runningStartedAt)} 开始`
          : "本轮执行中"
        : status.active && status.nextRunAt
          ? formatDateTime(status.nextRunAt)
          : "暂无定时",
      tone: status.running || status.active ? "ok" : "warning",
    },
    {
      label: "运行间隔",
      value: `${intervalSeconds}s`,
      tone: "idle",
    },
    {
      label: "发送队列",
      value: status.processSendQueue ? `每轮最多 ${status.sendQueueLimit}` : "只入队不发送",
      tone: status.processSendQueue ? "ok" : "warning",
    },
    {
      label: "出图轮询",
      value: `每轮最多 ${status.pollLimit}`,
      tone: "idle",
    },
    {
      label: "已跑轮次",
      value: status.runCount,
      tone: "idle",
    },
  ];
}

function buildAutomationRunHistorySummary(runs?: AutomationRun[] | null): AutomationRunHistorySummary | null {
  const recentRuns = (runs || []).filter(Boolean).slice(0, 10);
  if (!recentRuns.length) return null;
  const failedRuns = recentRuns.filter((run) => run.skipped || (run.errors || []).length || (run.steps || []).some((step) => step.status === "failed"));
  const completedRuns = recentRuns.filter((run) => !run.skipped);
  const totalDuration = completedRuns.reduce((sum, run) => sum + Math.max(0, Number(run.durationMs || 0)), 0);
  const averageDuration = completedRuns.length ? totalDuration / completedRuns.length : 0;
  const latest = recentRuns[0];
  const latestFailed = failedRuns[0] === latest;
  const tone = latestFailed ? "error" : failedRuns.length ? "warning" : "ok";
  const title = latestFailed
    ? "最近一轮自动化异常"
    : failedRuns.length
      ? `最近 ${recentRuns.length} 轮有 ${failedRuns.length} 轮异常`
      : `最近 ${recentRuns.length} 轮运行稳定`;
  const detail = latestFailed
    ? "先查看上一轮步骤和卡点，再决定是否继续开启后台。"
    : failedRuns.length
      ? "异常不是每轮都出现，优先观察失败步骤是否集中在同一环节。"
      : "最近运行没有失败记录，可以继续观察业务结果。";

  return {
    tone,
    title,
    detail,
    metrics: [
      { label: "记录轮次", value: recentRuns.length },
      { label: "异常轮次", value: failedRuns.length, tone: failedRuns.length ? "warning" : "ok" },
      { label: "平均耗时", value: formatDurationValue(averageDuration), tone: averageDuration >= 3000 ? "warning" : "ok" },
      { label: "最新结果", value: latestFailed ? "异常" : latest.skipped ? "跳过" : "正常", tone: latestFailed ? "error" : latest.skipped ? "warning" : "ok" },
    ],
  };
}

function buildAutomationRunHistoryItems(runs?: AutomationRun[] | null): AutomationRunHistoryItem[] {
  return (runs || []).filter(Boolean).slice(0, 10).map((run, index) => {
    const failedSteps = (run.steps || []).filter((step) => step.status === "failed");
    const hasError = Boolean(run.skipped || run.errors?.length || failedSteps.length);
    const tone: AutomationRunHistoryItem["tone"] = hasError ? (run.skipped ? "warning" : "error") : "ok";
    const triggerLabels: Record<string, string> = {
      startup: "启动",
      interval: "定时",
      manual: "手动",
    };
    const failedStep = failedSteps[0]?.step || run.errors?.[0]?.step || "";
    return {
      key: `${run.startedAt || index}-${run.trigger}`,
      title: `${triggerLabels[run.trigger] || run.trigger}运行 ${index + 1}`,
      subtitle: formatDateTime(run.completedAt || run.startedAt),
      result: run.skipped ? lowValueRunSkipReasonLabel(run.reason) : hasError ? "异常" : "正常",
      duration: run.skipped ? "未执行" : formatDurationValue(Number(run.durationMs || 0)),
      failedStep: failedStep ? automationStepLabel(failedStep) : "无",
      tone,
    };
  });
}

function lowValueRunSkipReasonLabel(reason?: string) {
  const labels: Record<string, string> = {
    automation_already_running: "已有任务运行中",
  };
  return labels[reason || ""] || reason || "已跳过";
}

function buildAutomationStepItems(run?: AutomationRun | null): AutomationStepItem[] {
  if (!run || run.skipped) return [];
  const errors = new Map((run.errors || []).map((error) => [error.step, error.errorMessage]));
  const stepRecords = new Map((run.steps || []).map((step) => [step.step, step]));
  const results = run.results || {};
  const stepDefs: Array<{ key: string; label: string; detail: (result: unknown) => string }> = [
    { key: "scanTimeouts", label: "超时扫描", detail: describeTimeoutScanStep },
    { key: "pollActiveResults", label: "出图轮询", detail: describePollActiveStep },
    { key: "lowValueAutomation", label: "低价值主链路", detail: describeLowValueAutomationStep },
    { key: "scanLowValueOrderDrafts", label: "订单草稿", detail: describeOrderDraftStep },
    { key: "scanLowValueOrderConfirmations", label: "订单确认", detail: describeQueuedStep },
    { key: "scanLowValueOrderFollowups", label: "订单跟进", detail: describeQueuedStep },
    { key: "scanSendOperations", label: "发送回执", detail: describeSendOpsStep },
    { key: "processLowValueSendQueue", label: "安全发送队列", detail: describeSafeSendQueueStep },
  ];

  return stepDefs.map((step) => {
    const stepRecord = stepRecords.get(step.key);
    const errorMessage = stepRecord?.errorMessage || errors.get(step.key);
    if (errorMessage) {
      return {
        key: step.key,
        label: step.label,
        detail: `${errorMessage}${formatStepDuration(stepRecord?.durationMs)}`,
        tone: "error",
      };
    }
    if (!Object.prototype.hasOwnProperty.call(results, step.key)) {
      return {
        key: step.key,
        label: step.label,
        detail: "未执行",
        tone: "idle",
      };
    }
    const detail = step.detail(results[step.key]);
    return {
      key: step.key,
      label: step.label,
      detail: `${detail}${formatStepDuration(stepRecord?.durationMs)}`,
      tone: detail.includes("失败") || detail.includes("拦截") ? "warning" : "ok",
    };
  });
}

function buildAutomationStepInsight(run?: AutomationRun | null): AutomationStepInsight | null {
  if (!run || run.skipped || !run.steps?.length) return null;
  const steps = run.steps.filter((step) => typeof step.durationMs === "number" && Number.isFinite(step.durationMs));
  if (!steps.length) return null;
  const failedSteps = steps.filter((step) => step.status === "failed");
  const slowestStep = [...steps].sort((a, b) => b.durationMs - a.durationMs)[0];
  const totalStepDuration = steps.reduce((sum, step) => sum + Math.max(0, step.durationMs), 0);
  const slowestLabel = automationStepLabel(slowestStep.step);
  const slowestDuration = formatDurationValue(slowestStep.durationMs);
  const tone: AutomationStepInsight["tone"] = failedSteps.length ? "error" : slowestStep.durationMs >= 3000 ? "warning" : "ok";
  const title = failedSteps.length
    ? `${automationStepLabel(failedSteps[0].step)}执行失败`
    : slowestStep.durationMs >= 3000
      ? `${slowestLabel}耗时偏长`
      : "本轮步骤耗时正常";
  const detail = failedSteps.length
    ? failedSteps[0].errorMessage || "先处理失败步骤，再重新跑低价值自动化。"
    : slowestStep.durationMs >= 3000
      ? "优先检查这个环节对应的外部服务、队列或数据量。"
      : "没有发现明显慢步骤，可继续观察后续轮次。";

  return {
    title,
    detail,
    tone,
    metrics: [
      { label: "最慢步骤", value: slowestLabel, tone: slowestStep.durationMs >= 3000 ? "warning" : "ok" },
      { label: "最慢耗时", value: slowestDuration, tone: slowestStep.durationMs >= 3000 ? "warning" : "ok" },
      { label: "失败步骤", value: failedSteps.length, tone: failedSteps.length ? "error" : "ok" },
      { label: "步骤总耗时", value: formatDurationValue(totalStepDuration) },
    ],
  };
}

function automationStepLabel(step: string) {
  const labels: Record<string, string> = {
    pollActiveResults: "出图轮询",
    lowValueAutomation: "低价值主链路",
    scanTimeouts: "超时扫描",
    scanSendOperations: "发送回执",
    processLowValueSendQueue: "安全发送队列",
    scanLowValueOrderDrafts: "订单草稿",
    scanLowValueOrderConfirmations: "订单确认",
    scanLowValueOrderFollowups: "订单跟进",
  };
  return labels[step] || step;
}

function automationIdentityWarningLabel(reason: string, fields: string[] = []) {
  if (reason === "identity_field_conflict") {
    return fields.length ? `身份字段冲突：${fields.map(identityFieldLabel).join("、")}` : "身份字段冲突";
  }
  if (reason === "missing_identity") return "缺少账号/会话身份";
  return reason || "身份审计警告";
}

function buildAutomationSkipSummaryPanel(run?: AutomationRun | null): AutomationSkipSummaryPanel | null {
  const summary = run?.skipSummary;
  if (!summary || !summary.total || !summary.reasons?.length) return null;
  const topReason = summary.reasons[0];
  const reasons = summary.reasons.slice(0, 4).map((item) => ({
    reason: item.reason,
    label: lowValueReasonLabel(item.reason),
    count: item.count,
    steps: item.steps?.map(automationStepLabel).join("、") || "未定位步骤",
    sampleTargets: item.sampleTargets?.slice(0, 3).join("、") || "无样例",
    tone: (LOW_VALUE_NORMAL_SKIP_REASONS.has(item.reason) ? "ok" : lowValueIssueTone(item.reason)) as "error" | "warning" | "ok",
  }));
  return {
    total: summary.total,
    title: `上一轮跳过 ${summary.total} 项`,
    detail: `主要原因：${lowValueReasonLabel(topReason.reason)} ${topReason.count} 项。`,
    reasons,
  };
}

function identityFieldLabel(field: string) {
  const labels: Record<string, string> = {
    wechatAccountId: "微信账号",
    conversationId: "客户会话",
    customerId: "客户",
  };
  return labels[field] || field;
}

function formatStepDuration(durationMs?: number) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return "";
  return ` · ${formatDurationValue(durationMs)}`;
}

function formatDurationValue(durationMs: number) {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function describePollActiveStep(result: unknown) {
  const row = result as Awaited<ReturnType<typeof pollActiveDesignResults>> | undefined;
  if (!row) return "已检查";
  const completed = row.completed?.length || 0;
  const failed = row.failed?.length || 0;
  const generating = row.generating?.length || 0;
  const errors = row.errors?.length || 0;
  return `完成 ${completed}，失败 ${failed + errors}，出图中 ${generating}`;
}

function describeTimeoutScanStep(result: unknown) {
  const row = result as Awaited<ReturnType<typeof scanDesignTimeouts>> | undefined;
  if (!row) return "已检查";
  const pollErrors = row.pollErrors?.length || 0;
  return `检查 ${row.scanned || 0}，找回 ${row.recovered || 0}，超时 ${row.timedOut || 0}，轮询错误 ${pollErrors}`;
}

function describeLowValueAutomationStep(result: unknown) {
  const row = result as LowValueAutomationResult | undefined;
  if (!row) return "已检查";
  const submitted = row.autoSubmit?.submitted.length || 0;
  const imageQueued = row.imageSend?.queued.length || 0;
  const quoteQueued = row.quoteSend?.queued.length || 0;
  const orderCreated = row.orderDraft?.created.length || 0;
  const failed =
    (row.imageSend?.failed.length || 0) +
    (row.quoteSend?.failed.length || 0) +
    (row.orderDraft?.failed.length || 0) +
    (row.orderConfirmation?.failed.length || 0) +
    (row.orderFollowup?.failed.length || 0);
  return `提交 ${submitted}，图片 ${imageQueued}，报价 ${quoteQueued}，订单 ${orderCreated}，失败 ${failed}`;
}

function describeSendOpsStep(result: unknown) {
  const row = result as SendOperationsScanResult | undefined;
  if (!row) return "已检查";
  return sendOperationsScanSummary(row);
}

function sendOperationsScanSummary(row: SendOperationsScanResult) {
  return `扫描 ${row.scanned || 0} 个任务，自动重试 ${row.autoRetriedLowValue || 0} 个，回执超时 ${row.bridgeTimedOut || 0} 个，指令过期 ${row.bridgeDispatchExpired || 0} 个，出站文件异常 ${row.bridgeOutboxBroken || 0} 个，排队过久 ${row.staleQueued || 0} 个，已提醒 ${row.alerted || 0} 个`;
}

function describeSafeSendQueueStep(result: unknown) {
  const row = result as SafeSendQueueResult | undefined;
  if (!row) return "已检查";
  const queueHeadBlocked = row.skipped?.filter((item) => item.reason === "not_account_queue_head").length || 0;
  const queueAdvice = queueHeadBlocked ? `，前序任务卡住 ${queueHeadBlocked}` : "";
  return `处理 ${row.processed?.length || 0}，拦截 ${row.blocked?.length || 0}，跳过 ${row.skipped?.length || 0}${queueAdvice}，失败 ${row.failed?.length || 0}`;
}

function describeOrderDraftStep(result: unknown) {
  const row = result as LowValueOrderDraftResult | undefined;
  if (!row) return "已检查";
  return `创建 ${row.created?.length || 0}，跳过 ${row.skipped?.length || 0}，失败 ${row.failed?.length || 0}；订单草稿不会自动标记收款`;
}

function describeQueuedStep(result: unknown) {
  const row = result as LowValueOrderSendResult | LowValueOrderFollowupResult | undefined;
  if (!row) return "已检查";
  return `入队 ${row.queued?.length || 0}，跳过 ${row.skipped?.length || 0}，失败 ${row.failed?.length || 0}`;
}

function describeCountStep(countKey: string, label: string) {
  return (result: unknown) => {
    const row = result as Record<string, unknown> | undefined;
    const count = Array.isArray(row?.[countKey]) ? (row?.[countKey] as unknown[]).length : Number(row?.[countKey] || 0);
    return `${label} ${Number.isFinite(count) ? count : 0}`;
  };
}

function buildLowValueAutomationSummary(run?: AutomationRun | null): LowValueAutomationSummary | null {
  if (!run) return null;
  if (run.skipped) {
    return {
      title: "上一轮自动化未执行",
      subtitle: lowValueRunSubtitle(run),
      tone: "warning",
      metrics: [
        { label: "原因", value: run.reason || "已跳过" },
        { label: "错误", value: run.errors?.length || 0 },
      ],
    };
  }

  if (run.stageSummary) {
    const stageByKey = new Map(run.stageSummary.stages.map((stage) => [stage.key, stage]));
    const designStage = stageByKey.get("design");
    const imageStage = stageByKey.get("imageSend");
    const quoteStage = stageByKey.get("quote");
    const orderStage = stageByKey.get("order");
    const orderConfirmationStage = stageByKey.get("orderConfirmation");
    const orderFollowupStage = stageByKey.get("orderFollowup");
    const safeSendStage = stageByKey.get("safeSend");
    return {
      title: run.stageSummary.progressed ? `上一轮推进 ${run.stageSummary.progressed} 个动作` : "上一轮暂无可推进任务",
      subtitle: `${lowValueRunSubtitle(run)} · ${run.stageSummary.nextAction}`,
      tone: run.stageSummary.failed ? "error" : run.stageSummary.blocked ? "warning" : run.stageSummary.progressed ? "ok" : "idle",
      metrics: [
        { label: "草稿提交", value: designStage?.completed || 0 },
        { label: "图片入队", value: imageStage?.completed || 0 },
        { label: "报价入队", value: quoteStage?.completed || 0 },
        { label: "订单草稿", value: orderStage?.completed || 0 },
        { label: "订单确认", value: orderConfirmationStage?.completed || 0 },
        { label: "订单跟进", value: orderFollowupStage?.completed || 0 },
        { label: "安全发送", value: safeSendStage?.completed || 0 },
        { label: "拦截", value: run.stageSummary.blocked },
        { label: "错误", value: run.stageSummary.failed },
      ],
    };
  }

  const results = run.results || {};
  const lowValue = results.lowValueAutomation as LowValueAutomationResult | undefined;
  const sendQueue = results.processLowValueSendQueue as SafeSendQueueResult | undefined;
  const directOrderDraft = results.scanLowValueOrderDrafts as LowValueOrderDraftResult | undefined;
  const directConfirmation = results.scanLowValueOrderConfirmations as LowValueOrderSendResult | undefined;
  const directFollowup = results.scanLowValueOrderFollowups as LowValueOrderFollowupResult | undefined;
  const submitted = lowValue?.autoSubmit?.submitted.length || 0;
  const imageQueued = lowValue?.imageSend?.queued.length || 0;
  const quoteQueued = lowValue?.quoteSend?.queued.length || 0;
  const orderCreated = (lowValue?.orderDraft?.created.length || 0) + (directOrderDraft?.created.length || 0);
  const confirmationQueued = (lowValue?.orderConfirmation?.queued.length || 0) + (directConfirmation?.queued.length || 0);
  const followupQueued = (lowValue?.orderFollowup?.queued.length || 0) + (directFollowup?.queued.length || 0);
  const sendProcessed = sendQueue?.processed.length || 0;
  const sendBlocked = sendQueue?.blocked.length || 0;
  const failed =
    (run.errors?.length || 0) +
    (lowValue?.imageSend?.failed.length || 0) +
    (lowValue?.quoteSend?.failed.length || 0) +
    (lowValue?.orderDraft?.failed.length || 0) +
    (lowValue?.orderConfirmation?.failed.length || 0) +
    (lowValue?.orderFollowup?.failed.length || 0) +
    (directOrderDraft?.failed.length || 0) +
    (directConfirmation?.failed.length || 0) +
    (directFollowup?.failed.length || 0) +
    (sendQueue?.failed.length || 0);
  const progressed = submitted + imageQueued + quoteQueued + orderCreated + confirmationQueued + followupQueued + sendProcessed;

  return {
    title: progressed ? `上一轮推进 ${progressed} 个动作` : "上一轮暂无可推进任务",
    subtitle: lowValueRunSubtitle(run),
    tone: failed ? "error" : sendBlocked ? "warning" : progressed ? "ok" : "idle",
    metrics: [
      { label: "草稿提交", value: submitted },
      { label: "图片入队", value: imageQueued },
      { label: "报价入队", value: quoteQueued },
      { label: "订单草稿", value: orderCreated },
      { label: "订单确认", value: confirmationQueued },
      { label: "订单跟进", value: followupQueued },
      { label: "安全发送", value: sendProcessed },
      { label: "拦截", value: sendBlocked },
      { label: "错误", value: failed },
    ],
  };
}

function lowValueRunSubtitle(run: AutomationRun) {
  const triggerLabels: Record<string, string> = {
    startup: "启动自动跑",
    interval: "后台定时",
    manual: "手动触发",
  };
  const trigger = triggerLabels[run.trigger] || run.trigger;
  const duration = typeof run.durationMs === "number" ? `，耗时 ${Math.max(0, Math.round(run.durationMs))}ms` : "";
  return `${trigger} · ${formatDateTime(run.completedAt || run.startedAt)}${duration}`;
}

function buildLowValueAutomationIssueSummary(issues: LowValueAutomationIssue[]): LowValueAutomationIssueSummary | null {
  if (!issues.length) return null;
  const missingFields = new Set<string>();
  for (const issue of issues) {
    for (const field of issue.missing) missingFields.add(field);
  }
  const resolution = lowValueIssueResolutionPlan(issues);
  return {
    total: issues.length,
    errors: issues.filter((issue) => issue.tone === "error").length,
    warnings: issues.filter((issue) => issue.tone === "warning").length,
    missingFields: missingFields.size,
    manualLocks: issues.filter((issue) => issue.reason === "conversation_manual_locked" || issue.missing.includes("manualLocked")).length,
    sendTargets: issues.filter((issue) => issue.reason.includes("send_target") || issue.missing.includes("wechatAccountId") || issue.missing.includes("conversationId")).length,
    ...resolution,
    firstIssue: issues.find((issue) => issue.tone === "error") || issues[0],
  };
}

function findLowValueAutomationIssueForMetric(
  issues: LowValueAutomationIssue[],
  kind: "errors" | "warnings" | "missing" | "sendTargets" | "manualLocks",
) {
  if (kind === "errors") return issues.find((issue) => issue.tone === "error") || null;
  if (kind === "warnings") return issues.find((issue) => issue.tone === "warning") || null;
  if (kind === "missing") return issues.find((issue) => issue.missing.length) || null;
  if (kind === "sendTargets") {
    return issues.find((issue) =>
      issue.reason.includes("send_target") ||
      issue.reason.includes("order_target") ||
      issue.missing.includes("wechatAccountId") ||
      issue.missing.includes("conversationId"),
    ) || null;
  }
  if (kind === "manualLocks") {
    return issues.find((issue) => issue.reason === "conversation_manual_locked" || issue.missing.includes("manualLocked")) || null;
  }
  return null;
}

function lowValueIssueMetricLabel(kind: "errors" | "warnings" | "missing" | "sendTargets" | "manualLocks") {
  const labels = {
    errors: "错误",
    warnings: "提醒",
    missing: "缺字段",
    sendTargets: "发送对象",
    manualLocks: "人工接管",
  };
  return labels[kind];
}

function lowValueIssueResolutionPlan(issues: LowValueAutomationIssue[]) {
  const hasSendAttention = issues.some((issue) => issue.reason === "manual_send_attention_required" || issue.reason === "failed");
  const hasOnlySendAttention = hasSendAttention && issues.every((issue) => issue.reason === "manual_send_attention_required" || issue.reason === "failed");
  if (hasOnlySendAttention) {
    return {
      resolutionAction: "scan_send_ops" as const,
      resolutionLabel: "处理后先扫发送异常",
      resolutionDetail: "这些卡点都集中在发送任务；处理完窗口、人工锁或重排后，先扫描发送异常刷新状态。",
      resolutionButtonLabel: "扫发送异常",
    };
  }
  return {
    resolutionAction: "run_low_value" as const,
    resolutionLabel: hasSendAttention ? "先补资料，再复跑低价值" : "处理后复跑低价值",
    resolutionDetail: hasSendAttention
      ? "本轮既有发送异常，也有资料/付款/选图问题；先按卡片处理，再跑一轮低价值自动化继续推进。"
      : "补齐资料、付款、选图或发送对象后，跑一轮低价值自动化让系统继续处理。",
    resolutionButtonLabel: "复跑低价值",
  };
}

function buildLowValueAutomationIssueItems(run?: AutomationRun | null): LowValueAutomationIssue[] {
  const results = run?.results || {};
  const lowValue = results.lowValueAutomation as LowValueAutomationResult | undefined;
  const directConfirmation = results.scanLowValueOrderConfirmations as LowValueOrderSendResult | undefined;
  const directFollowup = results.scanLowValueOrderFollowups as LowValueOrderFollowupResult | undefined;
  const issues: LowValueAutomationIssue[] = [];

  collectLowValueIssueSource(issues, lowValue?.autoSubmit, "设计草稿提交");
  collectLowValueIssueSource(issues, lowValue?.imageSend, "效果图发送");
  collectLowValueIssueSource(issues, lowValue?.quoteSend, "报价发送");
  collectLowValueIssueSource(issues, lowValue?.orderDraft, "订单草稿");
  collectLowValueIssueSource(issues, lowValue?.orderConfirmation, "订单确认");
  collectLowValueIssueSource(issues, directConfirmation, "订单确认");
  collectLowValueFollowupIssues(issues, lowValue?.orderFollowup);
  collectLowValueFollowupIssues(issues, directFollowup);

  const seen = new Set<string>();
  const dedupedIssues = issues.filter((issue) => {
    const key = `${issue.stage}:${issue.target}:${issue.reason}:${issue.detail || ""}:${issue.missing.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return dedupedIssues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => lowValueIssueSortRank(left.issue) - lowValueIssueSortRank(right.issue) || left.index - right.index)
    .slice(0, 8)
    .map((item) => item.issue);
}

function collectLowValueIssueSource(
  issues: LowValueAutomationIssue[],
  result: LowValueIssueSource | undefined,
  stage: string,
) {
  if (!result) return;
  for (const item of result.skipped || []) pushLowValueSkippedIssue(issues, stage, item);
  for (const item of result.failed || []) pushLowValueFailedIssue(issues, stage, item);
}

function collectLowValueFollowupIssues(
  issues: LowValueAutomationIssue[],
  result: LowValueOrderFollowupResult | undefined,
) {
  if (!result) return;
  for (const item of result.skipped || []) pushLowValueSkippedIssue(issues, lowValueFollowupStageLabel(item.followupType), item);
  for (const item of result.failed || []) pushLowValueFailedIssue(issues, lowValueFollowupStageLabel(item.followupType), item);
}

function pushLowValueSkippedIssue(
  issues: LowValueAutomationIssue[],
  stage: string,
  item: LowValueSkippedItem,
) {
  if (LOW_VALUE_NORMAL_SKIP_REASONS.has(item.reason)) return;
  const missing = item.missing || [];
  issues.push({
    key: `${stage}:${lowValueIssueTarget(item)}:${item.reason}:${missing.join(",")}`,
    tone: lowValueIssueTone(item.reason),
    stage,
    target: lowValueIssueTarget(item),
    title: lowValueReasonLabel(item.reason),
    reason: item.reason,
    action: lowValueReasonAction(item.reason),
    missing,
    orderDraftId: item.orderDraftId,
    quoteDraftId: item.quoteDraftId,
    designJobId: item.designJobId,
    requestId: item.requestId,
  });
}

function pushLowValueFailedIssue(
  issues: LowValueAutomationIssue[],
  stage: string,
  item: LowValueFailedItem,
) {
  issues.push({
    key: `${stage}:${lowValueIssueTarget(item)}:failed:${item.errorMessage}`,
    tone: "error",
    stage,
    target: lowValueIssueTarget(item),
    title: "入队失败",
    reason: "failed",
    detail: item.errorMessage,
    action: "先刷新数据再重试；如果仍失败，转人工处理并保留错误信息。",
    missing: [],
    orderDraftId: item.orderDraftId,
    quoteDraftId: item.quoteDraftId,
    designJobId: item.designJobId,
    requestId: item.requestId,
  });
}

function lowValueIssueTarget(item: LowValueSkippedItem | LowValueFailedItem) {
  if (item.orderDraftId) return `订单 ${item.orderDraftId}`;
  if (item.quoteDraftId) return `报价 ${item.quoteDraftId}`;
  if (item.designJobId) return `设计任务 ${item.designJobId}`;
  if (item.requestId) return `请求 ${item.requestId}`;
  return "未定位对象";
}

function lowValueFollowupStageLabel(type?: string) {
  if (type === "delivery") return "交期说明";
  if (type === "production") return "生产通知";
  return "订单跟进";
}

function lowValueIssuePrefersQuoteCenter(issue: LowValueAutomationIssue) {
  return Boolean(
    issue.orderDraftId ||
      issue.quoteDraftId ||
      ["invalid_quote", "invalid_order_draft", "missing_selected_image", "negative_profit", "payment_not_ready", "missing_order_target"].includes(issue.reason),
  );
}

function lowValueIssueTone(reason: string): "error" | "warning" {
  return [
    "failed",
    "invalid_job",
    "invalid_quote",
    "invalid_order_draft",
    "missing_images",
    "negative_profit",
    "missing_design_job",
    "missing_send_target",
    "missing_order_target",
  ].includes(reason)
    ? "error"
    : "warning";
}

function lowValueReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    invalid_job: "设计任务无效",
    invalid_quote: "报价无效",
    invalid_order_draft: "订单草稿无效",
    missing_images: "效果图文件缺失",
    missing_selected_image: "客户选图缺失",
    negative_profit: "利润为负",
    missing_design_job: "缺少设计任务绑定",
    manual_review_required: "达到人工审核条件",
    manual_send_attention_required: "发送异常需人工处理",
    conversation_manual_locked: "会话已人工接管",
    missing_send_target: "缺少微信发送对象",
    missing_order_target: "缺少订单发送对象",
    payment_not_ready: "付款状态未就绪",
  };
  return labels[reason] || reason;
}

function lowValueReasonAction(reason: string) {
  const actions: Record<string, string> = {
    invalid_job: "打开设计中心，确认任务是否还存在，必要时重新创建设计任务。",
    invalid_quote: "打开报价中心，确认报价是否存在，必要时重新生成报价。",
    invalid_order_draft: "打开订单草稿，确认报价、客户、会话、选图是否完整。",
    missing_images: "回到设计中心补齐本地候选图，或重新提交设计平台出图。",
    missing_selected_image: "先让客户明确选择效果图，或由人工在报价/订单里标记选中图。",
    negative_profit: "检查成本、售价和数量，利润为负时不要自动发送，先人工改价。",
    missing_design_job: "检查报价和订单是否绑定到正确设计任务，避免把 A 客户内容发给 B 客户。",
    manual_review_required: "保持人工接管，人工确认图片、报价和跟进节奏后再发送。",
    manual_send_attention_required: "打开订单和发送中心，先核对失败/拦截原因；确认客户、微信窗口和付款状态后，由人工重排或继续人工跟进。",
    conversation_manual_locked: "如果人工问题已处理完，再解除会话人工锁；否则继续人工跟进。",
    missing_send_target: "补齐微信账号和客户会话，发送前必须能定位到正确聊天窗口。",
    missing_order_target: "给报价/订单补齐微信账号和客户会话，再重新跑低价值自动处理。",
    payment_not_ready: "确认已收定金或全款后，把订单付款状态标记为定金/已付。",
  };
  return actions[reason] || "查看设计任务、报价、订单和发送队列，确认后手动处理或转人工。";
}

function lowValueIssueNextStep(issue: LowValueAutomationIssue) {
  if (issue.reason === "manual_send_attention_required") {
    return {
      label: "先看发送中心",
      detail: "找到同一订单的异常发送任务，按任务提示重排、解除人工锁或继续人工处理。",
      buttonLabel: "定位发送",
    };
  }
  if (issue.reason === "conversation_manual_locked" || issue.missing.includes("manualLocked")) {
    return {
      label: "先处理人工接管",
      detail: "客户还在人工沟通时不要解除；确认问题结束后再解除人工锁并重跑自动化。",
      buttonLabel: "定位会话",
    };
  }
  if (issue.reason.includes("send_target") || issue.reason.includes("order_target")) {
    return {
      label: "先补发送对象",
      detail: "补齐微信账号、客户和会话绑定，避免把 A 客户内容发到 B 客户窗口。",
      buttonLabel: "补对象",
    };
  }
  if (issue.reason === "payment_not_ready") {
    return {
      label: "先核验付款",
      detail: "低价值订单也不能跳过收款校验；先标记定金或全款，再排队订单确认。",
      buttonLabel: "去订单",
    };
  }
  if (issue.reason === "missing_selected_image") {
    return {
      label: "先确认选图",
      detail: "让客户明确选择第几张图，或由人工在报价/订单里标记选中效果图。",
      buttonLabel: "去选图",
    };
  }
  if (issue.reason === "negative_profit") {
    return {
      label: "先改价格",
      detail: "成本、售价或数量导致利润为负时，不允许自动报价或自动确认订单。",
      buttonLabel: "去报价",
    };
  }
  if (issue.reason === "missing_images") {
    return {
      label: "先补效果图",
      detail: "候选图必须能找到本地文件；缺图时重新出图或重新绑定图片。",
      buttonLabel: "去设计",
    };
  }
  if (issue.orderDraftId) {
    return {
      label: "先看订单",
      detail: "从订单草稿核对付款、选图、客户会话和发送任务状态。",
      buttonLabel: "去订单",
    };
  }
  if (issue.quoteDraftId) {
    return {
      label: "先看报价",
      detail: "从报价草稿核对选图、利润、客户会话和发送状态。",
      buttonLabel: "去报价",
    };
  }
  return {
    label: "先定位来源",
    detail: "查看设计任务、报价、订单和发送队列，确认后手动处理或转人工。",
    buttonLabel: "定位处理",
  };
}

function lowValueIssuePriority(issue: LowValueAutomationIssue) {
  if (issue.reason === "manual_send_attention_required" || issue.reason === "failed") {
    return { tone: "error" as const, label: "先处理发送" };
  }
  if (issue.reason === "conversation_manual_locked" || issue.missing.includes("manualLocked")) {
    return { tone: "warning" as const, label: "人工接管中" };
  }
  if (issue.tone === "error") {
    return { tone: "error" as const, label: "阻断自动化" };
  }
  return { tone: "warning" as const, label: "人工确认" };
}

function lowValueIssueSortRank(issue: LowValueAutomationIssue) {
  if (issue.reason === "manual_send_attention_required" || issue.reason === "failed") return 0;
  if (issue.tone === "error") return 1;
  if (issue.reason === "conversation_manual_locked" || issue.missing.includes("manualLocked")) return 2;
  return 3;
}

function lowValueMissingFieldLabel(field: string) {
  const labels: Record<string, string> = {
    job: "设计任务",
    quote: "报价",
    orderDraft: "订单草稿",
    status: "状态",
    images: "候选图",
    selectedImageId: "选中效果图",
    profit: "利润",
    designJob: "设计任务",
    manualReview: "人工审核",
    manualLocked: "人工锁定",
    paymentStatus: "付款状态",
    wechatAccountId: "微信账号",
    conversationId: "客户会话",
    sendTaskId: "发送任务",
    confirmationSendTask: "确认发送任务",
    acceptedQuoteOrPayment: "客户确认或付款",
    productionFollowupSendTask: "生产通知任务",
    deliveryFollowupSendTask: "交期说明任务",
  };
  return labels[field] || fieldLabel(field);
}

function trainingSampleStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    ready: "可训练",
    review: "待复核",
    rejected: "已禁用",
  };
  return labels[status || "ready"] || status || "可训练";
}

function trainingSampleApiQualityFilter(filter: TrainingSampleQualityFilter) {
  return filter === "all" || filter === "missing_required" ? undefined : filter;
}

function trainingSampleQualityTotal(
  overview: TrainingOverview | null | undefined,
  filter: TrainingSampleQualityFilter,
  fallbackCount: number,
) {
  const summary = overview?.qualitySummary;
  if (!summary) return fallbackCount;
  const totals: Record<TrainingSampleQualityFilter, number> = {
    all: overview?.totalSamples ?? fallbackCount,
    trainable: summary.trainableSamples,
    not_trainable: Math.max(0, (overview?.totalSamples ?? fallbackCount) - summary.trainableSamples),
    safe: summary.safeSamples,
    review: Math.max(0, summary.reviewQualitySamples - summary.antiWrongReplySamples),
    risk: summary.riskSamples,
    blocked: summary.blockedSamples,
    missing_required: fallbackCount,
    needs_attention: summary.needsAttentionSamples ?? fallbackCount,
    scene_uncertain: summary.sceneUncertainSamples ?? fallbackCount,
    anti_wrong_reply: summary.antiWrongReplySamples,
    route_memory: summary.routeMemorySamples ?? fallbackCount,
    reply_skill: summary.replySkillSamples ?? fallbackCount,
    route_and_reply: summary.routeAndReplySamples ?? fallbackCount,
  };
  return totals[filter] ?? fallbackCount;
}

function visibleTrainingRecommendations(recommendations: string[] = []) {
  const rows = Array.isArray(recommendations) ? recommendations.filter(Boolean) : [];
  return rows
    .map((text, index) => ({
      text,
      index,
      priority: trainingRecommendationPriority(text),
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .slice(0, 3)
    .map((item) => item.text);
}

function trainingRecommendationPriority(text: string) {
  if (/聊天导入样本的场景不够确定|自动分流记忆/.test(text)) return 0;
  if (/风险|低分|缺回复/.test(text)) return 1;
  if (/人工复核/.test(text)) return 2;
  return 3;
}

function buildTrainingSampleQualityOptions({
  overview,
  samples,
}: {
  overview: TrainingOverview | null | undefined;
  samples: TrainingSample[];
}): Array<{ key: TrainingSampleQualityFilter; label: string; count: number }> {
  const keys: Array<{ key: TrainingSampleQualityFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "trainable", label: "可训练" },
    { key: "route_memory", label: "场景判断" },
    { key: "reply_skill", label: "客服话术" },
    { key: "route_and_reply", label: "判断+话术" },
    { key: "scene_uncertain", label: "场景待确认" },
    { key: "missing_required", label: "缺必填项" },
    { key: "not_trainable", label: "不可训练" },
    { key: "safe", label: "正常业务" },
    { key: "anti_wrong_reply", label: "防乱回复" },
    { key: "needs_attention", label: "需处理" },
    { key: "review", label: "待复核" },
    { key: "risk", label: "风险" },
    { key: "blocked", label: "已禁用" },
  ];
  return keys.map((item) => ({
    ...item,
    count: trainingSampleQualityTotal(
      overview,
      item.key,
      samples.filter((sample) => matchesTrainingSampleQualityFilter(sample, item.key)).length,
    ),
  }));
}

function trainingSampleRequiredFieldBlockingReasons(sample: TrainingSample) {
  const reasons: string[] = [];
  if (!String(sample.agentKey || sample.agentId || "").trim()) reasons.push("缺少 Agent");
  if (!String(sample.scene || "").trim()) reasons.push("缺少场景");
  if (!String(sample.customerText || "").trim()) reasons.push("缺少客户问题");
  if (!String(sample.idealReply || "").trim()) reasons.push("缺少标准回复");
  if (!(sample.skillHints || []).some((hint) => String(hint || "").trim())) reasons.push("缺少 Skill 提示");
  return reasons;
}
function matchesTrainingSampleQualityFilter(sample: TrainingSample, filter: TrainingSampleQualityFilter) {
  if (filter === "all") return true;
  if (filter === "trainable") return sample.quality?.trainable === true;
  if (filter === "not_trainable") return sample.quality?.trainable === false;
  if (filter === "route_memory") return sample.quality?.usage?.routeMemory === true;
  if (filter === "reply_skill") return sample.quality?.usage?.replySkill === true;
  if (filter === "route_and_reply") {
    return sample.quality?.usage?.routeMemory === true && sample.quality?.usage?.replySkill === true;
  }
  if (filter === "missing_required") return trainingSampleRequiredFieldBlockingReasons(sample).length > 0;
  if (filter === "needs_attention") return isTrainingSampleNeedingManualReview(sample);
  if (filter === "scene_uncertain") return isSceneUncertainTrainingSample(sample);
  if (filter === "anti_wrong_reply") return isAntiWrongReplyTrainingSample(sample);
  if (filter === "review") return sampleQualityTone(sample) === "review" && !isAntiWrongReplyTrainingSample(sample);
  return sampleQualityTone(sample) === filter;
}

function isSceneUncertainTrainingSample(sample: TrainingSample) {
  const sourceType = sample.sourceType || (sample.sourceRouteId ? "route_correction" : sample.importId ? "chat_import" : "");
  if (sourceType !== "chat_import") return false;
  const status = sample.sceneCheck?.status || "";
  if (status === "weak" || status === "ambiguous" || status === "unmatched") return true;
  return sampleAttentionFlags(sample).some((flag) => /^scene_(weak|ambiguous|unmatched)$/.test(flag));
}

function chatImportSceneSummary(result: ChatImport) {
  const samples = result.samples || [];
  const sceneUncertainCount = samples.filter((sample) => isSceneUncertainTrainingSample(sample)).length;
  const reviewCount = chatImportReviewCount(result);
  const clearSceneCount = samples.filter((sample) => sample.sceneCheck?.status === "clear").length;
  const base = `导入 ${result.pairCount || samples.length} 组对话，生成 ${samples.length} 条训练样本。`;
  const warningText = result.warnings?.length ? ` 解析提醒 ${result.warnings.length} 条。` : "";
  if (sceneUncertainCount > 0) {
    return `${base} ${sceneUncertainCount} 条场景待确认，已切到复核列表；确认前不会进入自动分流记忆。${warningText}`;
  }
  if (reviewCount > 0) {
    return `${base} ${reviewCount} 条待复核，已切到本次导入列表；确认前不会进入训练。${warningText}`;
  }
  if (samples.length) {
    return `${base} 场景清晰 ${clearSceneCount} 条，可继续复核客服话术和 Skill。${warningText}`;
  }
  return `${base} 没有生成可训练样本，请检查是否包含“客户：/客服：”成对内容。${warningText}`;
}

function chatImportSceneUncertainCount(item: ChatImport) {
  if (item.sceneSummary) return Number(item.sceneSummary.sceneUncertainCount || 0);
  return (item.samples || []).filter((sample) => isSceneUncertainTrainingSample(sample)).length;
}

function chatImportReviewCount(item: ChatImport) {
  if (item.sceneSummary?.reviewCount !== undefined) return Number(item.sceneSummary.reviewCount || 0);
  return (item.samples || []).filter((sample) => String(sample.status || "ready") === "review").length;
}

function chatImportRejectedCount(item: ChatImport) {
  if (item.sceneSummary?.rejectedCount !== undefined) return Number(item.sceneSummary.rejectedCount || 0);
  return (item.samples || []).filter((sample) => String(sample.status || "ready") === "rejected").length;
}

function chatImportReadyCount(item: ChatImport) {
  if (item.sceneSummary?.readyCount !== undefined) return Number(item.sceneSummary.readyCount || 0);
  return (item.samples || []).filter((sample) => String(sample.status || "ready") === "ready").length;
}

function chatImportNeedsReview(item: ChatImport) {
  return chatImportSceneUncertainCount(item) > 0 || chatImportReviewCount(item) > 0;
}

function chatImportReadyForSkill(item: ChatImport) {
  return !chatImportNeedsReview(item) && chatImportReadyCount(item) > 0;
}

function chatImportSkillSuggestionFilter(item: ChatImport, suggestions: SkillSuggestion[]) {
  const readyAgentKeys = new Set(
    (item.samples || [])
      .filter((sample) => String(sample.status || "ready") === "ready")
      .map((sample) => sample.agentId || sample.agentKey || "")
      .filter(Boolean),
  );
  if (readyAgentKeys.size !== 1) return "all";
  const [agentKey] = [...readyAgentKeys];
  return suggestions.some((suggestion) => skillSuggestionAgentFilterKey(suggestion) === agentKey) ? agentKey : "all";
}

function chatImportPreferredQualityFilter(item: ChatImport): TrainingSampleQualityFilter {
  if (chatImportSceneUncertainCount(item) > 0) return "scene_uncertain";
  if (chatImportReviewCount(item) > 0) return "review";
  return "all";
}

function chatImportSceneSummaryLabel(item: ChatImport) {
  const summary = item.sceneSummary;
  const uncertainCount = chatImportSceneUncertainCount(item);
  const reviewCount = chatImportReviewCount(item);
  const rejectedCount = chatImportRejectedCount(item);
  const readyCount = chatImportReadyCount(item);
  const clearCount = Number(summary?.clearCount || 0);
  const sampleCount = Number(summary?.sampleCount || item.samples?.length || item.pairCount || 0);
  const warningCount = item.warnings?.length || 0;
  if (uncertainCount > 0) return `${uncertainCount} 条场景待确认 / ${sampleCount} 条样本`;
  if (reviewCount > 0) return `${reviewCount} 条待复核 / ${sampleCount} 条样本`;
  if (readyCount > 0 && rejectedCount > 0) return `已确认 ${readyCount} 条 / 禁用 ${rejectedCount} 条`;
  if (readyCount > 0) return `已确认 ${readyCount} 条，可生成 Skill`;
  if (rejectedCount > 0) return `已禁用 ${rejectedCount} 条 / ${sampleCount} 条样本`;
  if (warningCount > 0) return `${warningCount} 条解析提醒 / ${sampleCount} 条样本`;
  return `场景清晰 ${clearCount || sampleCount} 条`;
}

function isAntiWrongReplyTrainingSample(sample: TrainingSample) {
  return Boolean(sample.quality?.flags?.includes("anti_wrong_reply_only"));
}

function sampleQualityTone(sample: TrainingSample) {
  if (sample.quality?.level) return sample.quality.level;
  if (sample.status === "rejected") return "blocked";
  if (sample.status === "review") return "review";
  if (Number(sample.score || 0) < 70) return "risk";
  return "safe";
}

function sampleQualityLabel(sample: TrainingSample) {
  if (sample.quality?.label) return sample.quality.label;
  if (sample.status === "rejected") return "已禁用";
  if (sample.status === "review") return "待人工复核";
  if (Number(sample.score || 0) < 70) return "低分需复核";
  return "可训练";
}

function sampleQualityReason(sample: TrainingSample) {
  if (sample.quality?.reason) return sample.quality.reason;
  if (sample.status === "rejected") return "人工已禁用，不参与 Skill 和知识匹配。";
  if (sample.status === "review") return "样本待复核，暂不参与训练。";
  return "样本状态正常。";
}

function sampleUsageLabel(sample: TrainingSample) {
  return sample.quality?.usage?.label || "用途待判断";
}

function sampleUsageReason(sample: TrainingSample) {
  return sample.quality?.usage?.reason || "系统还没有给这个样本生成训练用途标记。";
}

function sampleUsageTone(sample: TrainingSample) {
  const scope = sample.quality?.usage?.scope;
  if (scope === "route_and_reply") return "route-and-reply";
  if (scope === "route_memory") return "route-memory";
  if (scope === "reply_only") return "reply-only";
  if (scope === "anti_wrong_reply") return "anti-wrong";
  if (scope === "review") return "review";
  return "blocked";
}

function sampleSceneScore(sample: TrainingSample) {
  const score = Number(sample.sceneScore);
  return Number.isFinite(score) ? score : null;
}

function sampleSceneCheckTone(sample: TrainingSample) {
  const status = sample.sceneCheck?.status || "clear";
  if (status === "clear") return "clear";
  if (status === "weak") return "weak";
  if (status === "ambiguous") return "ambiguous";
  return "unmatched";
}

function sampleSceneCheckLabel(sample: TrainingSample) {
  const labels: Record<string, string> = {
    clear: "场景清晰",
    weak: "信号偏弱",
    ambiguous: "多场景混合",
    unmatched: "未识别",
  };
  return labels[sample.sceneCheck?.status || "clear"] || "待确认";
}

function sampleSceneCheckTitle(sample: TrainingSample) {
  const status = sample.sceneCheck?.status || "clear";
  const titles: Record<string, string> = {
    clear: "可以作为场景判断训练的候选，但仍受样本状态和评分约束。",
    weak: "命中词太少，先人工确认场景，避免把客户问题分错智能体。",
    ambiguous: "同时像多个场景，先人工确认主场景。",
    unmatched: "没有识别到明确场景，不能直接训练自动路由。",
  };
  return titles[status] || sample.sceneCheck?.reason || "场景判断待确认。";
}

function sampleSceneRouteMemoryBadge(sample: TrainingSample) {
  const sourceType = sample.sourceType || (sample.sourceRouteId ? "route_correction" : sample.importId ? "chat_import" : "");
  if (sourceType !== "chat_import") return null;
  const status = sample.sceneCheck?.status || "";
  if (status === "clear") {
    const humanConfirmed = sample.sceneCheck?.reason === "human_confirmed_scene";
    return {
      tone: "route-memory-ok",
      label: humanConfirmed ? "人工已确认" : "可训练分流",
      title: humanConfirmed
        ? "客服已确认这条导入样本的场景和 Agent，可以作为后续自动分流记忆。"
        : "场景判断清晰，样本状态和评分达标后可以用于自动分流记忆。",
    };
  }
  if (status === "weak" || status === "ambiguous" || status === "unmatched") {
    return {
      tone: "route-memory-blocked",
      label: "确认后才分流",
      title: "这条导入样本当前不能训练自动分流。需要人工确认场景和 Agent 后，才会进入路由记忆。",
    };
  }
  const score = sampleSceneScore(sample);
  if (score !== null && score < 14) {
    return {
      tone: "route-memory-blocked",
      label: "确认后才分流",
      title: "场景分数偏低，先人工确认后再用于自动分流。",
    };
  }
  return {
    tone: "route-memory-ok",
    label: "可训练分流",
    title: "旧样本没有场景复核记录，仍按样本状态、评分和用途规则判断是否可用于分流。",
  };
}

function sampleSceneEvidence(sample: TrainingSample) {
  const keywords = sample.matchedKeywords?.length
    ? sample.matchedKeywords
    : sample.sceneCheck?.topScene?.matchedKeywords || [];
  return [...new Set(keywords.filter(Boolean))];
}

function sampleAttentionFlags(sample: TrainingSample) {
  return [
    ...new Set([
      ...(sample.quality?.flags || []),
      ...(sample.quality?.usage?.flags || []),
    ]),
  ];
}

function attentionReasonLabel(reason: { code?: string; label?: string }) {
  const labels: Record<string, string> = {
    manual_review_required: "人工复核",
    low_score: "低分",
    missing_answer: "缺回复",
    missing_customer_text: "缺客户问题",
    missing_skill_hints: "缺 Skill",
    quality_risk: "质量风险",
    quality_review: "质量复核",
    not_trainable: "不可训练",
    usage_review: "用途待复核",
    usage_none: "不可用样本",
    usage_unknown: "用途未判定",
    scene_weak: "场景偏弱",
    scene_ambiguous: "场景混合",
    scene_unmatched: "未识别场景",
  };
  return labels[reason.code || ""] || reason.label || reason.code || "需处理";
}

function attentionReasonTitle(reason: { code?: string; detail?: string; action?: string }) {
  const titles: Record<string, string> = {
    scene_weak: "场景判断信号偏弱，先人工确认场景和 Agent。",
    scene_ambiguous: "客户问题同时像多个场景，先人工确认主场景。",
    scene_unmatched: "没有识别到明确场景，不能直接用于自动路由记忆。",
  };
  return titles[reason.code || ""] || `${reason.detail || ""} ${reason.action || ""}`.trim();
}

function attentionReasonQualityFilter(reason: { code?: string }): TrainingSampleQualityFilter {
  const sceneReasonCodes = new Set(["scene_weak", "scene_ambiguous", "scene_unmatched"]);
  if (sceneReasonCodes.has(reason.code || "")) return "scene_uncertain";
  return "needs_attention";
}

function sampleAttentionReasons(sample: TrainingSample) {
  if (sample.quality?.attention?.reasons?.length) return sample.quality.attention.reasons;
  if (!isTrainingSampleNeedingManualReview(sample)) return [];
  const flags = sampleAttentionFlags(sample);
  const usageScope = sample.quality?.usage?.scope;
  const reasons: Array<{ code: string; label: string; detail: string; action: string }> = [];
  const add = (code: string, label: string, detail: string, action: string) => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, label, detail, action });
  };
  if (sample.status === "review" || flags.includes("manual_review_required")) {
    add("manual_review_required", "人工复核", "样本还在待复核状态。", "人工检查后再确认训练。");
  }
  if (flags.includes("low_score")) {
    add("low_score", "低分", "样本评分低或有风险。", "重写标准回复后再确认。");
  }
  if (flags.includes("missing_answer")) add("missing_answer", "缺回复", "缺少客服标准回复。", "补上客服应该怎么回。");
  if (flags.includes("missing_customer_text")) add("missing_customer_text", "缺客户问题", "缺少客户原话。", "补上客户真实问题。");
  if (flags.includes("missing_skill_hints")) add("missing_skill_hints", "缺 Skill", "缺少 Skill 提示。", "补 1 到 3 个明确 Skill。");
  if (flags.includes("scene_weak")) add("scene_weak", "场景偏弱", "场景判断信号偏弱。", "人工确认场景和 Agent。");
  if (flags.includes("scene_ambiguous")) add("scene_ambiguous", "场景混合", "客户问题同时像多个场景。", "人工确认主场景。");
  if (flags.includes("scene_unmatched")) add("scene_unmatched", "未识别场景", "没有识别到明确场景。", "补充或修正场景。");
  if (sampleQualityTone(sample) === "risk" && !reasons.length) {
    add("quality_risk", "质量风险", "样本被判定为风险。", "先修正样本内容后再确认训练。");
  }
  if (usageScope === "review") add("usage_review", "用途待复核", "训练用途待确认。", "确认用于场景判断还是客服话术。");
  if (usageScope === "none") add("usage_none", "不可用样本", "样本当前不能训练。", "补齐内容或禁用样本。");
  if (usageScope === undefined) add("usage_unknown", "用途未判定", "系统还没有用途标记。", "重新保存或复核样本。");
  return reasons;
}

function isTrainingSampleNeedingManualReview(sample: TrainingSample) {
  if (sample.status === "rejected") return false;
  if (isAntiWrongReplyTrainingSample(sample) && sample.status !== "review") return false;
  if (sample.quality?.attention) return sample.quality.attention.needsAttention;
  const qualityTone = sampleQualityTone(sample);
  const usageScope = sample.quality?.usage?.scope;
  const flags = sampleAttentionFlags(sample);
  return (
    sample.status === "review" ||
    qualityTone === "review" ||
    qualityTone === "risk" ||
    sample.quality?.trainable === false ||
    usageScope === "review" ||
    usageScope === "none" ||
    usageScope === undefined ||
    flags.includes("low_score") ||
    flags.includes("missing_answer") ||
    flags.includes("missing_customer_text") ||
    flags.includes("missing_skill_hints") ||
    flags.some((flag) => /^scene_(weak|ambiguous|unmatched)$/.test(flag)) ||
    flags.includes("manual_review_required")
  );
}

function skillSuggestionActionLabel(action?: string) {
  return action === "update" ? "更新 Skill" : "新增 Skill";
}

function skillSuggestionSafetyTone(suggestion: SkillSuggestion) {
  if (suggestion.quality?.level) return suggestion.quality.level;
  if (isSkillSuggestionAutoSelected(suggestion)) return "safe";
  if (Number(suggestion.confidence || 0) >= 70) return "review";
  return "risk";
}

function skillSuggestionSafetyLabel(suggestion: SkillSuggestion) {
  if (suggestion.quality?.label) return suggestion.quality.label;
  if (isSkillSuggestionAutoSelected(suggestion)) return "高可信默认选中";
  if (Number(suggestion.sampleCount || 0) < AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES) return "样本少需复核";
  return "低置信需复核";
}

function skillSuggestionScopeTone(suggestion: SkillSuggestion) {
  const level = String(suggestion.scope?.level || "");
  if (level === "mixed") return "risk";
  if (level === "global") return "safe";
  return "review";
}

function agentSkillScopeTone(level?: string) {
  const value = String(level || "");
  if (value === "global") return "global";
  if (value === "mixed") return "risk";
  return "private";
}

function skillSuggestionScopeLabel(suggestion: SkillSuggestion) {
  return suggestion.scope?.label || "范围待确认";
}

function skillSuggestionScopeDetail(suggestion: SkillSuggestion) {
  const scope = suggestion.scope;
  if (!scope) return "这条建议还没有范围信息，应用前需要先核对样本来源。";
  const parts = [
    scope.wechatAccountId ? `微信 ${scope.wechatAccountId}` : "",
    scope.customerId ? `客户 ${scope.customerId}` : "",
    scope.conversationId ? `会话 ${scope.conversationId}` : "",
  ].filter(Boolean);
  const detail = parts.length ? `${scope.reason} ${parts.join(" / ")}` : scope.reason;
  return `${detail}，避免把 A 客户经验写给 B 客户。`;
}

function skillSuggestionEvidencePreview(value?: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 36 ? `${text.slice(0, 36)}...` : text;
}

function skillSuggestionReviewSummary(suggestion: SkillSuggestion) {
  const reason = suggestion.quality?.reason || skillSuggestionSafetyLabel(suggestion);
  const question = skillSuggestionEvidencePreview(suggestion.evidence?.question);
  const answer = skillSuggestionEvidencePreview(suggestion.evidence?.answer);
  const evidence = question ? `｜客户 ${question}` : answer ? `｜客服 ${answer}` : "";
  return `${suggestion.name}｜${skillSuggestionScopeLabel(suggestion)}｜${reason}｜样本 ${suggestion.sampleCount} 条｜置信度 ${suggestion.confidence}${evidence}`;
}

function skillApplyBlockedSummary(result: { requiresReview?: number; blocked?: SkillSuggestionApplyBlocked[] }) {
  const blockedRows = result.blocked || [];
  const identityBlockedCount = blockedRows.filter(skillApplyBlockedByIdentity).length;
  const reviewBlockedCount = Math.max(0, Number(result.requiresReview || blockedRows.length || 0) - identityBlockedCount);
  const parts = [
    identityBlockedCount ? `身份冲突禁止 ${identityBlockedCount} 条` : "",
    reviewBlockedCount ? `需复核未应用 ${reviewBlockedCount} 条` : "",
  ].filter(Boolean);
  return parts.length ? `，拦截 ${parts.join("，")}` : "";
}

function skillApplyBlockedByIdentity(row: SkillSuggestionApplyBlocked) {
  const quality = row.quality || null;
  return row.reason === "identity_scope_blocked" || quality?.blocked === true || quality?.level === "blocked";
}

function skillApplyChangeSummary(result: { created?: Array<Record<string, unknown>>; updated?: Array<Record<string, unknown>>; skipped?: Array<Record<string, unknown>> }) {
  const parts = [
    skillApplyNamesLabel("新增", result.created || []),
    skillApplyNamesLabel("更新", result.updated || []),
    skillApplyNamesLabel("无变化", result.skipped || []),
  ].filter(Boolean);
  return parts.length ? ` 明细：${parts.join("；")}。` : "";
}

function skillApplyNamesLabel(label: string, rows: Array<Record<string, unknown>>) {
  const names = rows
    .map((row) => String(row?.name || row?.suggestionKey || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!names.length) return "";
  const extraCount = Math.max(0, rows.length - names.length);
  return `${label} ${names.join("、")}${extraCount ? ` 等 ${rows.length} 个` : ""}`;
}

function skillSuggestionKey(suggestion: SkillSuggestion) {
  return (
    suggestion.suggestionKey ||
    `${suggestion.agentId || suggestion.agentKey || "general"}::${String(suggestion.name || "")
      .replace(/\s+/g, "")
      .toLowerCase()}`
  );
}

function skillSuggestionAgentFilterKey(suggestion: SkillSuggestion) {
  return suggestion.agentId || suggestion.agentKey || "general";
}

function buildSkillSuggestionAgentOptions(suggestions: SkillSuggestion[], agents: Agent[]) {
  const agentLabels = new Map<string, string>();
  for (const agent of agents) {
    agentLabels.set(agent.id, agent.name);
    agentLabels.set(agent.key, agent.name);
  }
  const buckets = new Map<string, { key: string; label: string; count: number }>();
  for (const suggestion of suggestions) {
    const key = skillSuggestionAgentFilterKey(suggestion);
    const label = agentLabels.get(key) || suggestion.agentKey || "通用 Agent";
    const current = buckets.get(key);
    if (current) current.count += 1;
    else buckets.set(key, { key, label, count: 1 });
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hans-CN"));
}

function sampleReviewNote(status: "ready" | "review" | "rejected") {
  if (status === "ready") return "人工确认样本可进入 Skill 训练。";
  if (status === "rejected") return "人工禁用样本，不参与 Skill 和知识匹配。";
  return "人工退回复核，暂不参与 Skill 和知识匹配。";
}

function trainingSampleBatchActionLabel(status: "ready" | "review" | "rejected") {
  if (status === "ready") return "批量确认训练";
  if (status === "rejected") return "批量禁用样本";
  return "批量退回复核";
}

function trainingSampleBatchConfirmQuestion(
  status: "ready" | "review" | "rejected",
  scopeLabel: string,
  count: number,
  suffix = "",
) {
  if (status === "ready") return `确认将${scopeLabel} ${count} 条训练样本设为可训练？${suffix}`;
  if (status === "rejected") return `确认禁用${scopeLabel} ${count} 条训练样本？${suffix}`;
  return `确认将${scopeLabel} ${count} 条训练样本退回复核？${suffix}`;
}

function trainingSampleAttentionReviewSummary(sample: TrainingSample) {
  const customerText = skillSuggestionEvidencePreview(sample.customerText);
  const reason = sampleAttentionReasons(sample)[0]?.label || sampleQualityReason(sample);
  const textSuffix = customerText ? `｜客户 ${customerText}` : "";
  return `${sample.agentKey || sample.agentId || "general"}｜${sample.scene || "未分类"}｜${reason}${textSuffix}`;
}

function trainingSampleNeedsAttentionBatchWarning(count: number, samples: TrainingSample[] = []) {
  const preview = samples.slice(0, 3).map(trainingSampleAttentionReviewSummary).join("\n");
  const previewText = preview ? `\n\n本次需处理样本预览：\n${preview}` : "";
  const moreText = count > 3 ? `\n还有 ${count - 3} 条需处理样本未展示。` : "";
  return `\n\n注意：其中 ${count} 条仍被系统标记为「需人工处理」。确认后会直接进入训练，请先核对客户原话、客服回复和 Skill 提示，避免低质量样本污染智能体。${previewText}${moreText}`;
}
function trainingSampleSceneReviewSummary(sample: TrainingSample) {
  const customerText = skillSuggestionEvidencePreview(sample.customerText);
  const keywordText = sampleSceneEvidence(sample).slice(0, 3).join("、");
  const keywordSuffix = keywordText ? `｜命中词 ${keywordText}` : "";
  const textSuffix = customerText ? `｜客户 ${customerText}` : "";
  return `${sample.agentKey || sample.agentId || "general"}｜${sample.scene || "未分类"}｜${sampleSceneCheckLabel(sample)}${keywordSuffix}${textSuffix}`;
}

function trainingSampleSceneBatchWarning(count: number, samples: TrainingSample[] = []) {
  const preview = samples.slice(0, 3).map(trainingSampleSceneReviewSummary).join("\n");
  const previewText = preview ? `\n\n本次待确认样本预览：\n${preview}` : "";
  const moreText = count > 3 ? `\n还有 ${count - 3} 条场景待确认样本未展示。` : "";
  return `\n\n注意：其中 ${count} 条是「场景待确认」导入样本。确认后会把当前 Agent 和场景视为人工确认，并可能用于后续自动分流。请先逐条打开核对，避免把 A 客户场景训练给 B 智能体。${previewText}${moreText}`;
}

function trainingSampleBatchNoopMessage(status: "ready" | "review" | "rejected", scope: "selected" | "visible") {
  const scopeLabel = scope === "selected" ? "已选样本" : "当前显示的样本";
  if (status === "ready") return `${scopeLabel}已经都是可训练状态。`;
  if (status === "rejected") return `${scopeLabel}已经都是禁用状态。`;
  return `${scopeLabel}已经都是待复核状态。`;
}

function trainingSampleBatchReviewNote(
  status: "ready" | "review" | "rejected",
  scopeLabel: string,
  sceneUncertainCount = 0,
  needsAttentionCount = 0,
) {
  if (status === "ready") {
    const riskParts = [
      needsAttentionCount > 0 ? `${needsAttentionCount} 条需人工处理样本已人工确认` : "",
      sceneUncertainCount > 0 ? `${sceneUncertainCount} 条场景待确认样本已按当前 Agent 和场景人工确认` : "",
    ].filter(Boolean);
    return riskParts.length
      ? `按${scopeLabel}批量确认进入训练，其中 ${riskParts.join("，")}。`
      : `按${scopeLabel}批量确认进入训练。`;
  }
  if (status === "rejected") return `按${scopeLabel}批量禁用，不参与训练和场景记忆。`;
  return `按${scopeLabel}批量退回复核，等待人工确认是否参与训练。`;
}

function trainingSampleBatchDoneMessage(status: "ready" | "review" | "rejected", count: number) {
  if (status === "ready") return `已确认 ${count} 条训练样本进入训练。`;
  if (status === "rejected") return `已禁用 ${count} 条训练样本。`;
  return `已将 ${count} 条训练样本退回复核。`;
}

function sampleSourceLabel(sample: TrainingSample) {
  if (sample.sourceType === "route_correction" || sample.sourceRouteId) return "场景纠错";
  if (sample.sourceType === "chat_import" || sample.importId) return "聊天导入";
  return "手动样本";
}

function sendAttemptStatusLabel(status: string) {
  const labels: Record<string, string> = {
    started: "已开始",
    dry_run: "干跑通过",
    sent: "已发送",
    failed: "发送失败",
    blocked: "已拦截",
  };
  return labels[status] || status;
}

function sendAttemptOutboxFileName(attempt?: SendAttempt | null) {
  const metadata = attempt?.metadata || {};
  const value = metadata.outboxFileName || metadata.outboxFile || (metadata.adapter as Record<string, unknown> | undefined)?.outboxFile;
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/[\\/]/).filter(Boolean).pop() || "";
}

function sendAttemptBridgeAckRejected(attempt?: SendAttempt | null) {
  const raw = attempt?.metadata?.bridgeAckRejected;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rejected = raw as Record<string, unknown>;
  const source = String(rejected.source || "").trim();
  const fileName = String(rejected.fileName || "").trim().split(/[\\/]/).filter(Boolean).pop() || "";
  const reason = String(rejected.reason || "").trim();
  return {
    source,
    sourceLabel: bridgeAckRejectedSourceLabel(source),
    fileName,
    reason,
  };
}

function bridgeAckRejectedSourceLabel(source: string) {
  const labels: Record<string, string> = {
    direct_ack: "直接回执",
    bridge_inbox: "回执文件",
  };
  return labels[source] || "未知来源";
}

function windowSnapshotStatus(snapshot: WechatWindowSnapshot) {
  if (!snapshot.isOnline) return "窗口离线";
  if (snapshot.diagnostic?.ok === false) return "需人工确认";
  if (isWindowSnapshotStale(snapshot)) return "快照过旧";
  return "窗口就绪";
}

function windowSnapshotAgeSeconds(snapshot?: WechatWindowSnapshot | null) {
  const value = snapshot?.capturedAt || snapshot?.createdAt;
  const time = new Date(String(value || ""));
  if (Number.isNaN(time.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - time.getTime()) / 1000));
}

function isWindowSnapshotStale(snapshot?: WechatWindowSnapshot | null) {
  const ageSeconds = windowSnapshotAgeSeconds(snapshot);
  return ageSeconds !== null && ageSeconds > WINDOW_SNAPSHOT_MAX_AGE_SECONDS;
}

function wechatChannelLabel(channel: WechatChannelKey) {
  const labels: Record<WechatChannelKey, string> = {
    personal_wechat: "个人微信",
    work_wechat: "企业微信",
    mini_program: "微信小程序",
  };
  return labels[channel] || channel;
}

function wechatConversationChannelLabel(channel?: string | null) {
  const labels: Record<string, string> = {
    wechat: "个人微信",
    personal_wechat: "个人微信",
    work_wechat: "企业微信",
    mini_program: "微信小程序",
  };
  const key = String(channel || "").trim();
  return key ? labels[key] || key : "未绑定通道";
}

function wechatChannelStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "已就绪",
    needs_runtime: "需运行",
    needs_send_adapter: "待发送器",
    needs_config: "待配置",
  };
  return labels[status] || status;
}

function wechatChannelCheckPassed(channel: WechatChannelStatusItem, key: string) {
  return Boolean(channel.checks.find((check) => check.key === key)?.passed);
}

function wechatChannelNextStep(channel: WechatChannelStatusItem) {
  if (channel.status === "ready") return "通道已通过当前本地检查，继续在智能客服管线里处理消息、路由和发送队列。";
  if (channel.status === "needs_runtime") return "先启动本机窗口观察器和 Windows 文件桥接 worker，再刷新通道状态。";
  if (channel.status === "needs_send_adapter") return "观察和文件桥接已就绪；启用真实 Windows 发送桥接器并等待回执后，才能标记为真实发送。";
  if (channel.key === "work_wechat") return "补齐企业微信应用凭证和回调 Token，再用入站演练验证消息进入同一套客服管线。";
  if (channel.key === "mini_program") return "补齐微信小程序 AppID 和消息 Token，再用入站演练验证客服消息进入会话和路由。";
  return "补齐账号、运行状态或凭证后刷新状态。";
}

function wechatChannelSetupRows(channel: WechatChannelStatusItem) {
  if (channel.key === "personal_wechat") {
    return [
      { key: "npm.cmd run wechat:safe:start", label: "观察器/桥接 worker", done: wechatChannelCheckPassed(channel, "window_observer") && wechatChannelCheckPassed(channel, "windows_bridge") },
      { key: "WECHAT_SEND_ADAPTER=windows_bridge", label: "真实发送适配器", done: wechatChannelCheckPassed(channel, "safe_send_queue") },
      { key: channel.entrypoints.send || "/api/wechat/send-tasks/:id/execute", label: "安全发送入口", done: true },
    ];
  }
  if (channel.key === "work_wechat") {
    return [
      { key: "WECHAT_WORK_CORP_ID", label: "企业 ID", done: wechatChannelCheckPassed(channel, "corp_id") },
      { key: "WECHAT_WORK_AGENT_ID", label: "应用 Agent", done: wechatChannelCheckPassed(channel, "agent_id") },
      { key: "WECHAT_WORK_TOKEN", label: "回调 Token", done: wechatChannelCheckPassed(channel, "callback_token") },
      { key: channel.entrypoints.inbound || "/api/wechat/inbound/messages", label: "统一入站入口", done: wechatChannelCheckPassed(channel, "normalized_inbound") },
    ];
  }
  return [
    { key: "WECHAT_MINI_APP_ID", label: "小程序 AppID", done: wechatChannelCheckPassed(channel, "app_id") },
    { key: "WECHAT_MINI_TOKEN", label: "消息 Token", done: wechatChannelCheckPassed(channel, "callback_token") },
    { key: channel.entrypoints.inbound || "/api/wechat/inbound/messages", label: "统一入站入口", done: wechatChannelCheckPassed(channel, "normalized_inbound") },
    { key: channel.entrypoints.safeSend || "/api/wechat/send-tasks", label: "客服发送队列", done: wechatChannelCheckPassed(channel, "safe_send_queue") },
  ];
}

function wechatChannelKindLabel(kind: string) {
  const labels: Record<string, string> = {
    desktop_bridge: "桌面桥接",
    official_account_callback: "官方回调",
    mini_program_customer_message: "客服消息",
  };
  return labels[kind] || kind;
}

function wechatChannelMetricLabel(key: string) {
  const labels: Record<string, string> = {
    accounts: "账号",
    activeAccounts: "在线账号",
    conversations: "会话",
    pendingSendTasks: "待发送",
    manualLockedConversations: "接管",
    bridgeOutboxPending: "出站",
    bridgeDispatchPending: "指令",
    bridgeDispatchStale: "超时指令",
    bridgeInboxPending: "回执",
    latestRoutes: "路由",
  };
  return labels[key] || key;
}

function agentNameByKey(agents: Agent[], agentKey?: string | null) {
  const key = String(agentKey || "").trim();
  if (!key) return "未分配";
  return agents.find((agent) => agent.key === key)?.name || key;
}

function revisionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    requested: "已记录",
    submitted: "已提交",
    generating: "出图中",
    completed: "已完成",
    failed: "失败",
    manual_review: "待人工",
  };
  return labels[status] || status;
}

function reviewDecisionLabel(decision: string) {
  const labels: Record<string, string> = {
    approve_images: "图片通过",
    approve_send: "批准发送",
    request_revision: "要求改图",
    reject: "驳回设计",
    approve_quote: "报价通过",
    reject_quote: "驳回报价",
    manual_lock: "人工接管",
    manual_release: "解除接管",
    manual_approve_send: "人工批准发图",
    manual_approve_quote: "人工批准报价",
    approve_confirmation: "批准订单确认",
    approve_followup: "批准订单跟进",
    request_followup: "继续人工跟进",
    reject_order: "驳回订单",
  };
  return labels[decision] || decision;
}

function reviewLogSubject(log: ReviewLog) {
  const metadata = log.metadata || {};
  if (log.targetType === "conversation") {
    return `会话 ${String(metadata.conversationTitle || metadata.conversationId || log.targetId)}`;
  }
  if (metadata.orderDraftId) return `订单 ${String(metadata.orderDraftId)}`;
  if (metadata.quoteDraftId) return `报价 ${String(metadata.quoteDraftId)}`;
  if (metadata.designJobId) return `设计任务 ${String(metadata.designJobId)}`;
  if (metadata.sendTaskId) return `发送任务 ${String(metadata.sendTaskId)}`;
  if (metadata.conversationId) return `${reviewTargetLabel(log.targetType)} · 会话 ${String(metadata.conversationId)}`;
  return `${reviewTargetLabel(log.targetType)} ${log.targetId}`;
}

function reviewLogSummary(log: ReviewLog) {
  const metadata = log.metadata || {};
  const parts: string[] = [];
  const reason = String(metadata.reason || "").trim();
  const blockedCount = Array.isArray(metadata.blockedSendTaskIds) ? metadata.blockedSendTaskIds.length : 0;
  const cancelledCount = Array.isArray(metadata.cancelledInFlightSendTaskIds)
    ? metadata.cancelledInFlightSendTaskIds.length
    : Array.isArray(metadata.inFlightSendTaskIds)
      ? metadata.inFlightSendTaskIds.length
      : 0;

  if (log.note) parts.push(log.note);
  if (reason) parts.push(`原因：${reviewReasonLabel(reason)}`);
  if (blockedCount) parts.push(`暂停待发送 ${blockedCount} 个`);
  if (cancelledCount) parts.push(`取消发送中 ${cancelledCount} 个`);
  if (metadata.followupType) parts.push(`跟进类型：${orderFollowupTypeLabel(String(metadata.followupType))}`);
  if (metadata.orderDraftId) parts.push(`订单：${String(metadata.orderDraftId)}`);
  if (metadata.quoteDraftId) parts.push(`报价：${String(metadata.quoteDraftId)}`);
  if (metadata.designJobId) parts.push(`设计任务：${String(metadata.designJobId)}`);
  if (metadata.sendTaskId) parts.push(`发送任务：${String(metadata.sendTaskId)}`);
  if (log.beforeStatus || log.afterStatus) parts.push(`${reviewStatusLabel(log.beforeStatus)} → ${reviewStatusLabel(log.afterStatus)}`);
  return parts.join("；") || "已记录审核操作。";
}

function reviewLogMatchesConversation(log: ReviewLog, conversationId: string) {
  if (!conversationId) return false;
  const metadata = log.metadata || {};
  return (
    String(metadata.conversationId || "") === conversationId ||
    (log.targetType === "conversation" && log.targetId === conversationId)
  );
}

function reviewLogTraceItems(log: ReviewLog) {
  const metadata = log.metadata || {};
  const items: string[] = [];
  const wechatAccount = String(metadata.wechatAccountName || metadata.wechatAccountId || "").trim();
  const customer = String(metadata.customerName || metadata.customerId || "").trim();
  const conversation = String(metadata.conversationTitle || metadata.conversationId || "").trim();
  const statusTrace = log.beforeStatus || log.afterStatus
    ? `${reviewStatusLabel(log.beforeStatus)} -> ${reviewStatusLabel(log.afterStatus)}`
    : "";

  if (wechatAccount) items.push(`账号 ${reviewTraceValue(wechatAccount)}`);
  if (customer) items.push(`客户 ${reviewTraceValue(customer)}`);
  if (conversation) items.push(`会话 ${reviewTraceValue(conversation)}`);
  if (statusTrace) items.push(`状态 ${statusTrace}`);
  if (metadata.followupType) items.push(`跟进 ${orderFollowupTypeLabel(String(metadata.followupType))}`);
  if (metadata.selectedImageId) items.push(`选图 ${reviewTraceValue(String(metadata.selectedImageId))}`);
  if (metadata.orderDraftId) items.push(`订单 ${reviewTraceValue(String(metadata.orderDraftId))}`);
  if (metadata.quoteDraftId) items.push(`报价 ${reviewTraceValue(String(metadata.quoteDraftId))}`);
  if (metadata.designJobId) items.push(`设计 ${reviewTraceValue(String(metadata.designJobId))}`);
  if (metadata.sendTaskId) items.push(`发送 ${reviewTraceValue(String(metadata.sendTaskId))}`);
  return items.slice(0, 8);
}

function reviewTraceValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "-";
  return trimmed.length > 18 ? `${trimmed.slice(0, 8)}…${trimmed.slice(-6)}` : trimmed;
}

function reviewTargetLabel(targetType: string) {
  const labels: Record<string, string> = {
    conversation: "客户会话",
    design_job: "设计任务",
    quote: "报价",
    quote_draft: "报价",
    order_draft: "订单",
    training_sample: "训练样本",
    route_evaluation: "路由记录",
  };
  return labels[targetType] || targetType;
}

function reviewStatusLabel(status?: string) {
  if (!status) return "-";
  const labels: Record<string, string> = {
    auto_allowed: "自动化可运行",
    manual_locked: "人工接管中",
    manual_review: "待人工审核",
    quick_confirm: "待快速确认",
    send_queued: "待安全发送",
    sent: "已发送",
    failed: "失败",
  };
  return labels[status] || status;
}

function reviewReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    high_value_customer: "高价值客户",
    high_value_customer_selected_image: "高价值客户已选图",
    manual_takeover_from_workbench: "工作台人工接管",
    manual_resolution_from_workbench: "工作台人工处理完成",
    manual_approve_send: "人工审核后批准发图",
    manual_approve_quote: "人工审核后批准报价",
    manual_order_review: "高价值订单人工审核",
  };
  return labels[reason] || reason;
}

function orderFollowupTypeLabel(type: string) {
  const labels: Record<string, string> = {
    delivery: "交期说明",
    production: "生产进度",
  };
  return labels[type] || type;
}

function RouteResult({
  route,
  agents = [],
  onCorrect,
}: {
  route: RouteEvaluation;
  agents?: Agent[];
  onCorrect?: (route: RouteEvaluation, agent: Agent) => void;
}) {
  const rankedScenes = (route.sceneScores || []).filter((item) => item.score > 0).slice(0, 4);
  const correctionAgents = agents.filter((agent) => agent.enabled !== false && agent.key !== route.agentKey);
  const hasTrainingEvidence = Boolean(
    route.appliedSkills?.length || route.knowledgeMatches?.length || route.replyDraft?.safetyChecks?.length,
  );
  return (
    <div className={`route-result ${route.action}`}>
      <div className="route-primary-decision">
        <div className="route-summary">
          <div>
            <small>匹配 Agent</small>
            <strong>{route.agent?.name || route.agentKey}</strong>
          </div>
          <div>
            <small>处理方式</small>
            <strong>{routeActionLabel(route.action)}</strong>
          </div>
          <div>
            <small>置信度</small>
            <strong>{route.confidence}</strong>
          </div>
          <div>
            <small>客户价值</small>
            <strong>{route.isHighValue ? "高价值" : "普通"}</strong>
          </div>
        </div>
        <div className="route-tags">
          <span>{route.scene}</span>
          {route.sceneDecision ? <span>{sceneDecisionLabel(route.sceneDecision.status)}</span> : null}
          {route.sceneScore ? <span>场景分 {route.sceneScore}</span> : null}
          {route.budget?.perUnitAmount ? <span>{route.budget.perUnitAmount} 元/份</span> : null}
          {route.budget?.totalAmount ? <span>总额 {route.budget.totalAmount} 元</span> : null}
          {route.matchedKeywords?.slice(0, 8).map((keyword) => <span key={keyword}>命中 {keyword}</span>)}
          {route.missingFields.map((field) => <span className="warn" key={field}>缺 {fieldLabel(field)}</span>)}
          {route.riskFlags.map((flag) => <span className="danger" key={flag}>{flag}</span>)}
        </div>
        <div className="suggested-reply">
          <small>建议回复</small>
          <p>{route.suggestedReply}</p>
        </div>
      </div>
      <div className="route-evidence-stack">
        {route.sceneAudit ? (
          <div className={`route-evidence compact scene-audit ${route.sceneAudit.level || "review"}`}>
            <small>场景判断审计 · {route.sceneAudit.label || "待确认"}</small>
            {route.sceneAudit.summary ? <p>{route.sceneAudit.summary}</p> : null}
            {route.sceneAudit.nextStep ? <p><strong>下一步</strong><span>{route.sceneAudit.nextStep}</span></p> : null}
            {route.sceneAudit.evidence?.length ? (
              <div className="route-evidence-tags">
                {route.sceneAudit.evidence.slice(0, 5).map((item) => (
                  <span className="pass" key={item}>{item}</span>
                ))}
              </div>
            ) : null}
            {route.sceneAudit.warnings?.length ? (
              <div className="route-evidence-tags">
                {route.sceneAudit.warnings.slice(0, 5).map((item) => (
                  <span className="warn" key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {route.routingPolicy ? (
          <div className={`route-evidence compact scene-audit ${route.routingPolicy.manualRequired ? "manual" : "pass"}`}>
            <small>处理策略 · {routingPolicyLaneLabel(route.routingPolicy.lane || "")}</small>
            {route.routingPolicy.reason ? <p>{route.routingPolicy.reason}</p> : null}
            {route.routingPolicy.nextStep ? <p><strong>下一步</strong><span>{route.routingPolicy.nextStep}</span></p> : null}
            <div className="route-evidence-tags">
              <span className={route.routingPolicy.manualRequired ? "warn" : "pass"}>
                {route.routingPolicy.handler === "human" ? "人工处理" : "智能体处理"}
              </span>
              <span>{route.routingPolicy.valueTier === "high" ? "高价值" : "普通价值"}</span>
              <span className={route.routingPolicy.canQueueAutoReply ? "pass" : "warn"}>
                {route.routingPolicy.canQueueAutoReply ? "允许自动排队回复" : "不自动排队"}
              </span>
              {route.routingPolicy.canAskClarification ? <span>先追问补齐</span> : null}
              {route.routingPolicy.safeguards?.slice(0, 5).map((item) => (
                <span key={item}>{routingPolicySafeguardLabel(item)}</span>
              ))}
            </div>
          </div>
        ) : null}
        {route.correction?.corrected ? (
          <div className="route-evidence compact">
            <small>人工已纠正</small>
            <p>
              原判「{route.correction.before?.scene || route.correction.before?.agentKey || "未知"}」，已由
              {route.correction.reviewer || "人工客服"}纠正为「{route.scene}」。
            </p>
          </div>
        ) : correctionAgents.length && onCorrect ? (
          <div className="route-evidence compact">
            <small>人工纠正场景</small>
            <div className="route-evidence-tags">
              {correctionAgents.slice(0, 6).map((agent) => (
                <button type="button" className="ghost compact-button" key={agent.key} onClick={() => onCorrect(route, agent)}>
                  <Route size={14} aria-hidden="true" />改为 {agent.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {route.clarificationResolution ? (
          <div className="route-evidence compact">
            <small>客户已澄清场景</small>
            <p>已按「{route.clarificationResolution.label || route.clarificationResolution.scene || route.clarificationResolution.agentKey}」继续处理。</p>
            {route.clarificationResolution.matchedKeywords?.length ? (
              <div className="route-evidence-tags">
                {route.clarificationResolution.matchedKeywords.slice(0, 6).map((keyword) => (
                  <span key={keyword}>澄清词 {keyword}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {route.sceneClarification?.question ? (
          <div className="route-evidence compact">
            <small>场景确认</small>
            <p>{route.sceneClarification.question}</p>
            {route.sceneClarification.options?.length ? (
              <div className="route-evidence-tags">
                {route.sceneClarification.options.map((option) => (
                  <span key={option.agentKey}>
                    {option.label || option.scene}
                    {option.score ? ` · ${option.score}` : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {rankedScenes.length ? (
          <div className="route-evidence compact">
            <small>
              候选场景判断
              {route.sceneDecision ? ` · ${sceneDecisionReasonLabel(route.sceneDecision.reason)} · 分差 ${route.sceneDecision.scoreGap}` : ""}
            </small>
            <div className="route-evidence-tags">
              {rankedScenes.map((item) => (
                <span key={item.agentKey}>
                  {item.scene} · {item.score}
                  {item.matchedKeywords.length ? ` · ${item.matchedKeywords.slice(0, 3).join("/")}` : ""}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {hasTrainingEvidence ? (
          <details className="route-evidence-drawer">
            <summary>训练与安全依据</summary>
            {route.appliedSkills?.length ? (
              <div className="route-evidence compact">
                <small>命中的 Skill</small>
                <div className="route-evidence-tags">
                  {route.appliedSkills.slice(0, 5).map((skill) => (
                    <span key={skill.id || skill.name}>
                      {skill.name}
                      {skill.sampleCount ? ` · ${skill.sampleCount} 样本` : ""}
                      {skill.scope?.label ? ` · ${skill.scope.label}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {route.knowledgeMatches?.length ? (
              <div className="route-evidence compact">
                <small>参考训练样本</small>
                {route.knowledgeMatches.slice(0, 2).map((item) => (
                  <p key={item.id || item.title}>
                    <strong>{item.title}</strong>
                    {item.excerpt ? <span>{item.excerpt}</span> : null}
                  </p>
                ))}
              </div>
            ) : null}
            {route.replyDraft?.safetyChecks?.length ? (
              <div className="route-evidence compact">
                <small>回复安全检查</small>
                <div className="route-evidence-tags">
                  {route.replyDraft.safetyChecks.map((check) => (
                    <span className={check.passed ? "pass" : "warn"} key={check.key}>{check.label}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </details>
        ) : null}
      </div>
    </div>
  );
}

function routeActionLabel(action: string) {
  const labels: Record<string, string> = {
    auto_agent: "智能体处理",
    collect_info: "先补信息",
    manual_review: "转人工",
  };
  return labels[action] || action;
}

function routingPolicyLaneLabel(lane: string) {
  const labels: Record<string, string> = {
    high_value_human: "高价值人工",
    risk_human: "风险人工",
    manual_review: "人工确认",
    scene_clarification: "先确认场景",
    info_collection: "先补信息",
    low_value_agent: "低价值智能体",
  };
  return labels[lane] || lane || "待判断";
}

function routingPolicySafeguardLabel(key: string) {
  const labels: Record<string, string> = {
    identity_binding_required: "客户身份绑定",
    no_cross_conversation_reply: "防 A 发 B",
    use_agent_skills_and_knowledge: "使用 Skill/知识",
    human_approval_required: "需人工批准",
    wechat_send_guard_required: "微信发送守卫",
    ask_before_answering_uncertain_scene: "不确定先问",
    price_image_and_order_manual_review: "图片报价订单人工核对",
  };
  return labels[key] || key;
}

function inboundSelectionReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    missing_candidates: "当前会话没有可匹配的候选图",
    selection_without_active_design_job: "客户像是在选图，但没有找到对应设计任务",
    text_selection_unmatched: "文字里有选图意图，但没有匹配到具体第几张",
    image_reference_unmatched: "客户引用了图片，但没有匹配到候选图",
    screenshot_uncertain: "截图相似度不够，需要人工确认",
    fingerprint_uncertain: "截图指纹相似度不够，需要人工确认",
    quote_already_queued_or_sent: "报价已发送或已排队，再选图需要人工确认是否改价",
  };
  return labels[reason] || reason || "需要人工确认";
}

function inboundQuoteAcceptanceReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    missing_active_quote: "当前会话没有可推进的报价",
    already_has_order_draft: "已经有订单草稿",
    quote_not_sent: "报价还没有确认发送，不能只凭一句话成单",
    missing_selected_image: "报价缺少客户选中的效果图",
    negative_profit: "利润为负，需要人工改价",
    missing_design_job: "报价没有绑定设计任务",
    manual_review_required: "达到高价值或人工审核条件",
    conversation_manual_locked: "该会话已人工接管",
    missing_order_target: "缺少微信账号或客户会话绑定",
    payment_proof_needs_manual_verification: "客户发送了付款凭证，需要人工核验金额",
  };
  return labels[reason] || reason || "需要人工确认";
}

function sceneDecisionLabel(status: string) {
  const labels: Record<string, string> = {
    clear: "场景清晰",
    weak: "场景信号弱",
    ambiguous: "多场景接近",
    unmatched: "未命中场景",
  };
  return labels[status] || status;
}

function sceneDecisionReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    top_scene_confident: "最高分明确",
    only_weak_scene_signal: "只命中弱信号",
    multiple_scene_signals_close: "多个场景分数接近",
    no_scene_keyword_hit: "没有命中关键词",
    customer_scene_clarified: "客户已澄清",
    human_corrected_scene: "人工已纠正",
  };
  return labels[reason] || reason;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function operatorStatusMessage(value: unknown, fallback = "状态暂不可用，请稍后重试。") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized.includes("fetch failed") || normalized.includes("failed to fetch") || normalized.includes("econnrefused")) {
    return "本地安全服务暂不可用，请确认桌面服务已启动后重试。";
  }
  if (normalized.includes("restore manual lock")) {
    return "人工接管恢复保护已触发，系统已暂停自动发送，请人工确认后再解除接管。";
  }
  if (normalized.includes("smoke test")) {
    return "演示校验已触发安全保护，请重新扫描后再继续。";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "服务响应超时，请刷新状态后重试。";
  }
  return raw;
}

function operatorStatusName(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "未检测";
  const labels: Record<string, string> = {
    ok: "正常",
    ready: "就绪",
    active: "运行中",
    running: "运行中",
    idle: "空闲",
    offline: "离线",
    failed: "异常",
    error: "异常",
    unavailable: "不可用",
    stale: "待刷新",
  };
  return labels[raw.toLowerCase()] || raw;
}

function bridgeModeLabel(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const labels: Record<string, string> = {
    noop: "安全演练",
    safe_noop: "安全演练",
    real: "真实发送",
    disabled: "已停用",
  };
  return raw ? labels[raw.toLowerCase()] || raw : "-";
}

function bridgeTransportLabel(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const labels: Record<string, string> = {
    file_scan: "文件回执",
    file: "文件回执",
    http: "接口回执",
    none: "未启用",
  };
  return raw ? labels[raw.toLowerCase()] || raw : "-";
}

function sendAdapterName(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const labels: Record<string, string> = {
    windows_bridge: "桌面桥接",
    noop: "安全演练",
    dry_run: "演练发送",
    local: "本地发送",
  };
  return raw ? labels[raw.toLowerCase()] || raw : "发送适配器";
}

function sendPayloadKindLabel(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const labels: Record<string, string> = {
    text: "文本",
    image: "图片",
    images: "图片",
    quote: "报价",
    order: "订单",
    design_image: "设计图",
    unknown: "待识别内容",
  };
  return raw ? labels[raw.toLowerCase()] || raw : "待识别内容";
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function commercialReviewItems(record: Pick<QuoteDraft | OrderDraft, "quantity" | "unitPrice" | "totalPrice" | "totalCost" | "profit" | "profitRate">) {
  const quantity = Number(record.quantity || 0);
  const unitPrice = Number(record.unitPrice || 0);
  const totalPrice = Number(record.totalPrice || 0);
  const totalCost = Number(record.totalCost || 0);
  const profit = Number(record.profit || 0);
  const rawProfitRate = Number(record.profitRate);
  const calculatedProfitRate = totalPrice > 0 ? profit / totalPrice : 0;
  const profitRate = Number.isFinite(rawProfitRate) ? rawProfitRate : calculatedProfitRate;
  const profitRatePercent = Math.round(profitRate * 100);
  const profitTone = profit < 0 ? "danger" : profitRate < 0.15 ? "warning" : "good";
  return [
    { label: "数量", value: `${formatMoney(quantity)} 份`, tone: "" },
    { label: "单价", value: `${formatMoney(unitPrice)} 元/份`, tone: "" },
    { label: "总价", value: `${formatMoney(totalPrice)} 元`, tone: "" },
    { label: "成本", value: `${formatMoney(totalCost)} 元`, tone: "" },
    { label: "利润", value: `${formatMoney(profit)} 元`, tone: profitTone },
    { label: "利润率", value: `${Number.isFinite(profitRatePercent) ? profitRatePercent : 0}%`, tone: profitTone },
  ];
}

function dealRiskItemsForQuote(quote: QuoteDraft, sendRisk = "") {
  const items: Array<{ label: string; tone: string }> = [];
  const designJob = quote.designJob as
    | (QuoteDraft["designJob"] & { wechatAccountId?: string | null; conversationId?: string | null })
    | undefined;
  if (isHighValueQuote(quote)) items.push({ label: highValueQuoteReason(quote), tone: "warning" });
  if (quote.status === "manual_review") items.push({ label: "正在人工审核", tone: "warning" });
  if (sendRisk) items.push({ label: sendRisk, tone: "warning" });
  if (!quote.selectedImageId) items.push({ label: "未选图，不能报价发送", tone: "danger" });
  if (quoteNeedsPaymentProofReview(quote)) items.push({ label: "付款凭证待人工核验", tone: "warning" });
  if (!designJob?.wechatAccountId || !quote.customerId || !designJob?.conversationId) items.push({ label: "缺少微信账号、客户或会话绑定", tone: "danger" });
  if (Number(quote.profit || 0) < 0) items.push({ label: "利润为负，需要人工确认", tone: "danger" });
  return dedupeDealRiskItems(items);
}

function dealRiskItemsForOrder(order: OrderDraft) {
  const items: Array<{ label: string; tone: string }> = [];
  if (isHighValueOrder(order)) items.push({ label: highValueOrderReason(order), tone: "warning" });
  if (!orderSelectedImageIdValue(order)) items.push({ label: "订单未选图，不能发确认", tone: "danger" });
  if (!orderPaymentReady(order)) items.push({ label: "未核验定金或全款", tone: "warning" });
  if (orderStrictIdentityMissing(order)) items.push({ label: orderStrictIdentityWarning(), tone: "danger" });
  if (hasActiveOrderConfirmationTask(order)) items.push({ label: `订单确认${sendStatusLabel(order.confirmationSendTask?.status || "")}`, tone: "warning" });
  if (Number(order.profit || 0) < 0) items.push({ label: "利润为负，需要人工确认", tone: "danger" });
  return dedupeDealRiskItems(items);
}

function orderSendPreflightItems(order: OrderDraft) {
  const selectedImage = orderSelectedImage(order);
  const paymentReady = orderPaymentReady(order);
  const highValue = isHighValueOrder(order);
  const activeConfirmation = hasActiveOrderConfirmationTask(order);
  const profit = Number(order.profit || 0);
  return [
    {
      key: "wechat-account",
      label: "微信账号",
      detail: order.wechatAccountId ? reviewTraceValue(order.wechatAccountId) : "未绑定",
      tone: order.wechatAccountId ? "passed" : "error",
    },
    {
      key: "customer",
      label: "客户",
      detail: order.customerId ? order.customer?.name || reviewTraceValue(order.customerId) : "未绑定",
      tone: order.customerId ? "passed" : "error",
    },
    {
      key: "conversation",
      label: "会话",
      detail: order.conversationId ? reviewTraceValue(order.conversationId) : "未绑定",
      tone: order.conversationId ? "passed" : "error",
    },
    {
      key: "selected-image",
      label: "选图",
      detail: selectedImage ? `第 ${selectedImage.position || "-"} 张` : "未绑定",
      tone: selectedImage ? "passed" : "error",
    },
    {
      key: "payment",
      label: "付款",
      detail: paymentStatusLabel(orderPaymentStatusValue(order)),
      tone: paymentReady ? "passed" : "error",
    },
    {
      key: "amount",
      label: "金额",
      detail: `${formatMoney(Number(order.totalPrice || 0))} 元`,
      tone: profit < 0 ? "error" : "passed",
    },
    {
      key: "high-value",
      label: "高价值",
      detail: highValue ? "需人工确认" : "低风险自动推进",
      tone: highValue ? "warning" : "passed",
    },
    {
      key: "send-task",
      label: "发送队列",
      detail: activeConfirmation ? sendStatusLabel(order.confirmationSendTask?.status || "") : "未入队",
      tone: activeConfirmation ? "warning" : "passed",
    },
  ];
}

function OrderSendPreflightPanel({ order }: { order: OrderDraft }) {
  const items = orderSendPreflightItems(order);
  const errors = items.filter((item) => item.tone === "error");
  const warnings = items.filter((item) => item.tone === "warning");
  const tone = errors.length ? "error" : warnings.length ? "warning" : "ok";
  const blockReason = orderConfirmationBlockReason(order);
  const title = errors.length
    ? "订单确认发前检查未通过"
    : warnings.length
      ? "订单确认发前需要人工核对"
      : "订单确认发前检查通过";
  const summary = blockReason || "账号、客户、会话、选图、付款和金额已具备入队条件。";
  return (
    <div className={`preflight-panel order-send-preflight ${tone}`} aria-label="订单确认发送前核对">
      <div className="preflight-head">
        <div>
          <strong>{title}</strong>
          <span>{summary}</span>
        </div>
        <span className={`order-send-preflight-badge ${tone}`}>
          {errors.length ? `${errors.length} 项需处理` : warnings.length ? `${warnings.length} 项需复核` : "可入队"}
        </span>
      </div>
      <div className="preflight-checks order-send-preflight-checks">
        {items.map((item) => (
          <span className={item.tone} key={item.key} title={`${item.label}：${item.detail}`}>
            {item.label}：{item.detail}
          </span>
        ))}
      </div>
    </div>
  );
}

function dedupeDealRiskItems(items: Array<{ label: string; tone: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const label = item.label.trim();
    if (!label || seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

function customerNoteSummary(notes?: string | null) {
  const text = String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

function skuChangeActionLabel(action: string) {
  const labels: Record<string, string> = {
    create: "新增商品",
    update: "编辑商品",
    batch_update: "批量修改",
    status_change: "上下架变更",
    manual_create: "手动新增",
    manual_upsert: "手动保存",
  };
  return labels[action] || action || "变更";
}

function skuSeverityLabel(severity: string) {
  const labels: Record<string, string> = {
    error: "严重",
    warning: "警告",
    info: "提醒",
  };
  return labels[severity] || severity;
}

function skuImageRoleLabel(problem: Pick<SkuImageProblem, "imageRole" | "imageIndex">) {
  if (problem.imageRole === "angle") {
    return problem.imageIndex === null || problem.imageIndex === undefined
      ? "多角度图"
      : `第 ${Number(problem.imageIndex) + 1} 张多角度图`;
  }
  return "主图";
}

function skuImageProblemAction(problem: Pick<SkuImageProblem, "code" | "imageRole">) {
  const role = problem.imageRole === "main" ? "主图" : "多角度图";
  if (problem.code === "missing_main_image") return "上传真实商品主图";
  if (problem.code.includes("invalid")) return `删除或重新上传真实${role}`;
  if (problem.code.includes("missing")) return `重新上传真实${role}，确认不用时再移除失效路径`;
  return `核对并补齐真实${role}`;
}

function skuImageProblemActionGroupLabel(problem: Pick<SkuImageProblem, "code" | "imageRole">) {
  if (problem.code.includes("invalid")) return "核对失效路径";
  return problem.imageRole === "main" ? "补主图" : "补多角度图";
}

function skuImageProblemRepairEntry(problem: Pick<SkuImageProblem, "code" | "imageRole" | "path">) {
  const role = problem.imageRole === "main" ? "主图" : "多角度图";
  if (problem.code.includes("invalid")) {
    return problem.path
      ? `先复制路径核对文件；确认不用时点“移除路径”，需要保留时点“编辑图片”重传真实${role}`
      : `点“编辑图片”核对并重传真实${role}`;
  }
  return `点“编辑图片”，在商品表单补真实${role}后保存商品`;
}

function skuImageProblemTrackingId(
  problem: Pick<SkuImageProblem, "skuCode" | "name" | "field" | "imageRole" | "imageIndex" | "code">,
) {
  const productKey = problem.skuCode || problem.name || "unknown-product";
  const imagePosition =
    problem.imageRole === "angle"
      ? `angle-${problem.imageIndex === null || problem.imageIndex === undefined ? "unknown" : Number(problem.imageIndex) + 1}`
      : "main";
  return `${productKey}::${problem.field}::${imagePosition}::${problem.code}`;
}

function skuImageProblemSaveTraceSummary(problems: SkuImageProblem[], skuCode: string, name: string) {
  const matchedProblems = problems.filter((problem) => problem.skuCode === skuCode || problem.name === name);
  if (!matchedProblems.length) return "";
  return `图片修复追踪：保存前该商品有 ${matchedProblems.length} 个图片问题，${buildSkuImageProblemActionSummary(matchedProblems)}；保存后请刷新商品审核确认是否归零。`;
}

function buildSkuImageProblemActionSummary(problems: SkuImageProblem[]) {
  const counts = new Map<string, number>();
  for (const problem of problems) {
    const label = skuImageProblemActionGroupLabel(problem);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return ["补主图", "补多角度图", "核对失效路径"]
    .map((label) => `${label} ${counts.get(label) || 0} 个`)
    .join(" · ");
}

function buildSkuImageProblemActionProductSummary(problems: SkuImageProblem[]) {
  const productKeysByAction = new Map<string, Set<string>>();
  for (const problem of problems) {
    const label = skuImageProblemActionGroupLabel(problem);
    const productKey = problem.skuCode || problem.name;
    if (!productKey) continue;
    const keys = productKeysByAction.get(label) || new Set<string>();
    keys.add(productKey);
    productKeysByAction.set(label, keys);
  }
  return ["补主图", "补多角度图", "核对失效路径"]
    .map((label) => `${label} ${productKeysByAction.get(label)?.size || 0} 个商品`)
    .join(" · ");
}

function buildSkuImageProblemNextStepSummary(problems: SkuImageProblem[]) {
  if (!problems.length) return "当前筛选没有图片问题，刷新商品审核后继续看剩余问题。";
  const mainProblems = problems.filter((problem) => skuImageProblemMatchesAction(problem, "upload_main"));
  const invalidProblems = problems.filter((problem) => skuImageProblemMatchesAction(problem, "review_invalid"));
  const angleProblems = problems.filter((problem) => skuImageProblemMatchesAction(problem, "upload_angle"));
  const countProducts = (items: SkuImageProblem[]) =>
    new Set(items.map((problem) => problem.skuCode || problem.name).filter(Boolean)).size;
  if (mainProblems.length) {
    return `先补 ${countProducts(mainProblems)} 个商品的真实主图，主图不完整时先不要自动出图。`;
  }
  if (invalidProblems.length) {
    return `先核对 ${invalidProblems.length} 条失效图片路径，确认文件不存在就移除旧路径并补新图。`;
  }
  if (angleProblems.length) {
    return `补 ${countProducts(angleProblems)} 个商品的多角度图，让设计平台能看清包装、材质和比例。`;
  }
  return "按当前筛选逐条复核图片问题，处理后刷新商品审核确认数量减少。";
}

function skuImagePathStateLabel(path?: string | null) {
  return path ? "有路径可核对" : "未填写路径";
}

function skuFieldLabel(field: string) {
  const labels: Record<string, string> = {
    skuCode: "SKU",
    name: "名称",
    type: "类型",
    category: "分类",
    costPrice: "成本价",
    salePrice: "售价",
    stock: "库存",
    supplier: "供应商",
    leadTimeDays: "交期",
    sceneTags: "场景标签",
    mainImagePath: "主图",
    angleImages: "多角度图",
    dimensions: "尺寸",
    weightGram: "重量",
    material: "材质",
    matchingRules: "搭配规则",
    replacementSkuCodes: "替代 SKU",
    isActive: "状态",
  };
  return labels[field] || field;
}

function formatSkuFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.map(formatSkuFieldValue).join("、") : "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function skuChangeImpactSummary(log: SkuChangeLog) {
  const changedFields = log.changedFields || [];
  const fieldNames = changedFields.map((field) => field.field);
  const commercialFields = ["salePrice", "costPrice", "stock", "supplier", "leadTimeDays", "sceneTags", "matchingRules", "replacementSkuCodes"];
  const imageFields = ["mainImagePath", "angleImages"];
  const specificationFields = ["dimensions", "weightGram", "material", "category", "type"];
  const commercialHits = fieldNames.filter((field) => commercialFields.includes(field));
  const imageHits = fieldNames.filter((field) => imageFields.includes(field));
  const specificationHits = fieldNames.filter((field) => specificationFields.includes(field));
  const isActiveChange = changedFields.find((field) => field.field === "isActive");

  if (log.action === "create" || log.action === "manual_create") {
    return {
      tone: "create",
      label: "新增入库",
      detail: "新商品已进入商品库，下一步看自动化预估和图片资料是否完整。",
      nextAction: "检查资料",
      repairFilter: "all",
    };
  }
  if (isActiveChange) {
    return {
      tone: isActiveChange.after === false ? "inactive" : "active",
      label: isActiveChange.after === false ? "已下架" : "已上架",
      detail: isActiveChange.after === false ? "该商品不会继续参与自动搭配和报价。" : "该商品恢复参与自动搭配、出图预检和报价。",
      nextAction: isActiveChange.after === false ? "查看商品" : "复核资料",
      repairFilter: isActiveChange.after === false ? "" : "all",
    };
  }
  if (commercialHits.length) {
    return {
      tone: "commercial",
      label: "影响报价/搭配",
      detail: `改动了 ${commercialHits.slice(0, 3).map(skuFieldLabel).join("、")}，需要关注自动报价、库存承接和利润判断。`,
      nextAction: "处理报价风险",
      repairFilter: "price_stock",
    };
  }
  if (imageHits.length) {
    return {
      tone: "image",
      label: "影响真实出图",
      detail: `改动了 ${imageHits.map(skuFieldLabel).join("、")}，需要确认设计平台使用的是真实商品图片。`,
      nextAction: "处理图片",
      repairFilter: "image",
    };
  }
  if (specificationHits.length) {
    return {
      tone: "specification",
      label: "影响包装/物流",
      detail: `改动了 ${specificationHits.slice(0, 3).map(skuFieldLabel).join("、")}，会影响礼盒装箱、重量和物流估算。`,
      nextAction: "处理规格交期",
      repairFilter: "spec_delivery",
    };
  }
  return {
    tone: "routine",
    label: "资料更新",
    detail: changedFields.length ? "这次变更已留痕，可在需要时回查字段前后值。" : "这次保存没有检测到关键字段变化。",
    nextAction: "查看商品",
    repairFilter: "",
  };
}

function skuChangeImpactMatchesFilter(log: SkuChangeLog, filter: string) {
  if (filter === "all") return true;
  const impact = skuChangeImpactSummary(log);
  if (filter === "active") return impact.tone === "active" || impact.tone === "inactive";
  return impact.tone === filter;
}

function skuChangeMatchesSearch(log: SkuChangeLog, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  const impact = skuChangeImpactSummary(log);
  const changedFieldText = (log.changedFields || [])
    .map((field) =>
      [
        field.field,
        skuFieldLabel(field.field),
        formatSkuFieldValue(field.before),
        formatSkuFieldValue(field.after),
      ].join(" "),
    )
    .join(" ");
  return [
    log.skuCode,
    log.name,
    log.action,
    skuChangeActionLabel(log.action),
    log.source,
    log.operator,
    log.reason,
    impact.label,
    impact.detail,
    impact.nextAction,
    changedFieldText,
  ]
    .join(" ")
    .toLowerCase()
    .includes(keyword);
}

function isStaleLocalDesignFileUrl(src?: string | null) {
  if (!src) return false;
  try {
    const url = new URL(src, "http://127.0.0.1:3100");
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return isLocalHost && url.pathname.startsWith("/files/") && Boolean(url.port) && url.port !== "3700";
  } catch {
    return false;
  }
}

type DesignImageCandidate = NonNullable<DesignJob["images"]>[number];

function designImageRevisionRound(image?: DesignImageCandidate | null) {
  if (!image) return 0;
  const imageIdMatch = /^r(\d+)-/.exec(String(image.imageId || ""));
  if (imageIdMatch) return Number(imageIdMatch[1]) || 0;
  const position = Number(image.position || 0);
  return position >= 100 ? Math.floor(position / 100) : 0;
}

function latestDesignImageRound(images?: DesignImageCandidate[] | null) {
  return (images || []).reduce((max, image) => Math.max(max, designImageRevisionRound(image)), 0);
}

function designImagesForRound(images: DesignImageCandidate[], round: number) {
  return [...images]
    .filter((image) => designImageRevisionRound(image) === round)
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
}

function latestDesignRoundImages(images: DesignImageCandidate[]) {
  return designImagesForRound(images, latestDesignImageRound(images));
}

function designImageRoundLabel(round: number) {
  return round > 0 ? `第 ${round} 次改图` : "首轮出图";
}

function designImageDisplayNumber(image?: DesignImageCandidate | null) {
  if (!image) return "-";
  const round = designImageRevisionRound(image);
  const position = Number(image.position || 0);
  if (round > 0 && position >= round * 100) return String(position - round * 100);
  return String(position || "-");
}

function designImageSelectionRoundSummary(image?: DesignImageCandidate | null) {
  if (!image) return "第 - 张";
  return `${designImageRoundLabel(designImageRevisionRound(image))}第 ${designImageDisplayNumber(image)} 张`;
}

function designImagePreviewSrc(job: DesignJob, image?: NonNullable<DesignJob["images"]>[number] | null) {
  if (!image) return "";
  return localDesignImageUrl(job.id, image, identityExpectation(job)) || image.downloadUrl || "";
}

function designImageSelectionSummary(result: DesignImageSelectionResult) {
  if (!result.matched) {
    if (!result.reviewRequired && result.reason === "no_selection_intent") {
      return "没有识别到明确选图意图，系统未绑定候选图，也没有生成报价。";
    }
    return "没有识别到明确候选图，已转人工确认。";
  }
  if (result.autoQuoteCreated && result.quote) {
    return `已识别客户选图，并生成报价草稿 ${result.quote.id || ""}，金额 ${result.quote.totalPrice || "-"} 元。`;
  }
  if (result.reviewRequired) {
    return "已识别客户选图，但该任务需要人工报价或人工确认。";
  }
  return "已识别客户选图。";
}

function SafeImagePreview({
  src,
  alt,
  fallbackLabel,
  iconSize = 18,
}: {
  src?: string | null;
  alt: string;
  fallbackLabel: string;
  iconSize?: number;
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  useEffect(() => {
    setImageLoadFailed(false);
  }, [src]);
  if (src && !imageLoadFailed && !isStaleLocalDesignFileUrl(src)) {
    return <img src={src} alt={alt} loading="lazy" onError={() => setImageLoadFailed(true)} />;
  }
  return (
    <span className="safe-image-fallback" role="img" aria-label={fallbackLabel}>
      <ImageIcon size={iconSize} aria-hidden="true" />
      <small>{fallbackLabel}</small>
    </span>
  );
}

function SelectedImageThumb({
  job,
  image,
  label,
}: {
  job?: DesignJob | null;
  image?: NonNullable<DesignJob["images"]>[number] | null;
  label: string;
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const src = job ? designImagePreviewSrc(job, image) : image?.downloadUrl || "";
  useEffect(() => {
    setImageLoadFailed(false);
  }, [src]);
  const title = image ? `${label}：第 ${image.position || "-"} 张` : `${label}：未选图`;
  const canShowImage = Boolean(src && !imageLoadFailed && !isStaleLocalDesignFileUrl(src));
  return (
    <div className={`selected-image-thumb ${canShowImage ? "" : "empty"}`} title={title} aria-label={title}>
      {canShowImage ? (
        <img src={src} alt={title} onError={() => setImageLoadFailed(true)} />
      ) : (
        <ImageIcon size={18} aria-hidden="true" />
      )}
      {image?.position ? <span>{image.position}</span> : null}
    </div>
  );
}

function quoteSelectedImage(quote: QuoteDraft) {
  return (
    quote.selectedImage ||
    quote.designJob?.images?.find((image) =>
      [image.id, image.imageId].includes(String(quote.selectedImageId || "")) || image.selected,
    ) ||
    null
  );
}

function quoteIdentityConfirmLines(quote: QuoteDraft) {
  const wechatAccountLabel = quote.designJob?.conversation?.wechatAccountId || quote.designJob?.wechatAccountId || "未绑定";
  const customerLabel = quote.customerId || quote.designJob?.customerId || "未绑定";
  const conversationLabel = quote.designJob?.conversation?.title || quote.designJob?.conversationId || "未绑定";
  return [`微信账号：${wechatAccountLabel}`, `客户ID：${customerLabel}`, `会话：${conversationLabel}`];
}

function snapshotDesignImage(snapshot?: Record<string, unknown> | null): NonNullable<DesignJob["images"]>[number] | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const id = String(snapshot.id || snapshot.imageId || "").trim();
  const imageId = String(snapshot.imageId || snapshot.id || "").trim();
  const rawPosition = Number(snapshot.position || 0);
  const localPath = typeof snapshot.localPath === "string" ? snapshot.localPath : undefined;
  const downloadUrl = typeof snapshot.downloadUrl === "string" ? snapshot.downloadUrl : undefined;
  const fingerprint = typeof snapshot.fingerprint === "string" ? snapshot.fingerprint : undefined;
  if (!id && !imageId && !rawPosition && !localPath && !downloadUrl && !fingerprint) return null;
  return {
    id: id || imageId || "selected-image-snapshot",
    imageId: imageId || id || "selected-image-snapshot",
    position: Number.isFinite(rawPosition) && rawPosition > 0 ? rawPosition : 0,
    localPath,
    downloadUrl,
    fingerprint,
    selected: true,
  };
}

function promptQuoteRevisionImage(quote: QuoteDraft) {
  const images = [...(quote.designJob?.images || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  if (!images.length) {
    window.alert("这条报价没有候选图，无法修订选图。");
    return null;
  }
  const current = quoteSelectedImage(quote);
  const defaultImage = images.find((image) => image.id !== current?.id) || images[0];
  const options = images
    .map((image) => `第 ${image.position} 张${image.id === current?.id ? "（当前）" : ""}`)
    .join("、");
  const raw = window.prompt(`选择修订后的候选图：${options}`, String(defaultImage.position || ""));
  if (raw === null) return null;
  const text = String(raw || "").trim();
  const selected =
    images.find((image) => String(image.position) === text) ||
    images.find((image) => image.id === text || image.imageId === text) ||
    null;
  if (!selected) {
    window.alert("没有找到这个候选图，请输入候选图序号。");
    return null;
  }
  return selected;
}

function promptOrderRevisionImage(order: OrderDraft) {
  const images = [...(order.designJob?.images || order.quoteDraft?.designJob?.images || [])].sort(
    (a, b) => Number(a.position || 0) - Number(b.position || 0),
  );
  if (!images.length) {
    window.alert("这条订单没有候选图，无法修订选图。");
    return null;
  }
  const current = orderSelectedImage(order);
  const defaultImage = images.find((image) => image.id !== current?.id) || images[0];
  const options = images
    .map((image) => `第 ${image.position} 张${image.id === current?.id ? "（当前）" : ""}`)
    .join("、");
  const raw = window.prompt(`选择订单修订后的候选图：${options}`, String(defaultImage.position || ""));
  if (raw === null) return null;
  const text = String(raw || "").trim();
  const selected =
    images.find((image) => String(image.position) === text) ||
    images.find((image) => image.id === text || image.imageId === text) ||
    null;
  if (!selected) {
    window.alert("没有找到这个候选图，请输入候选图序号。");
    return null;
  }
  return selected;
}

function confirmOrderSelectionRevision(order: OrderDraft, selectedImage: NonNullable<DesignJob["images"]>[number]) {
  const current = orderSelectedImage(order);
  const customerName = order.customer?.name || order.quoteDraft?.customer?.name || "客户";
  const identityLines = orderIdentityConfirmLines(order);
  const lines = [
    `确认把「${customerName}」的订单选图改为第 ${selectedImage.position || "-"} 张吗？`,
    "",
    `订单ID：${order.id}`,
    ...identityLines,
    "",
    `原选图：${current?.position ? `第 ${current.position} 张` : "未识别"}`,
    `新选图：第 ${selectedImage.position || "-"} 张`,
    `订单金额：${formatMoney(Number(order.totalPrice || 0))} 元`,
    `付款状态：${paymentStatusLabel(orderPaymentStatusValue(order))}`,
    "",
    "确认后订单会回到待确认，发送订单确认前仍会再做身份、付款和选图检查。",
  ];
  return window.confirm(lines.join("\n"));
}

function orderIdentityConfirmLines(order: OrderDraft) {
  const wechatAccountLabel = order.wechatAccountId || order.designJob?.wechatAccountId || order.quoteDraft?.designJob?.wechatAccountId || "未绑定";
  const customerLabel = order.customerId || order.quoteDraft?.customerId || order.designJob?.customerId || "未绑定";
  const conversationLabel =
    order.designJob?.conversation?.title ||
    order.quoteDraft?.designJob?.conversation?.title ||
    order.conversationId ||
    order.designJob?.conversationId ||
    order.quoteDraft?.designJob?.conversationId ||
    "未绑定";
  return [`微信账号：${wechatAccountLabel}`, `客户ID：${customerLabel}`, `会话：${conversationLabel}`];
}

function orderSelectedImage(order: OrderDraft) {
  const selectedImageId = String(orderSelectedImageIdValue(order));
  return (
    order.selectedImage ||
    order.quoteDraft?.selectedImage ||
    order.designJob?.images?.find((image) =>
      [image.id, image.imageId].includes(selectedImageId) || image.selected,
    ) ||
    order.quoteDraft?.designJob?.images?.find((image) =>
      [image.id, image.imageId].includes(selectedImageId) || image.selected,
    ) ||
    snapshotDesignImage(order.selectedImageSnapshot) ||
    null
  );
}

function matchesQuoteSearch(quote: QuoteDraft, term: string) {
  if (!term) return true;
  return [
    quote.id,
    quote.designJobId,
    quote.selectedImageId,
    quote.sendTaskId,
    quote.customer?.name,
    quote.designJob?.scene,
    quote.designJob?.conversation?.title,
    quote.owner,
    quote.customerNotes,
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

function matchesOrderSearch(order: OrderDraft, term: string) {
  if (!term) return true;
  return [
    order.id,
    order.quoteDraftId,
    order.designJobId,
    order.selectedImageId,
    order.quoteDraft?.selectedImageId,
    order.customer?.name,
    order.quoteDraft?.customer?.name,
    order.designJob?.scene,
    order.quoteDraft?.designJob?.scene,
    order.designJob?.conversation?.title,
    order.owner,
    order.customerNotes,
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

function dealProgressSteps(quote: QuoteDraft, order: OrderDraft | null) {
  const quoteSent = Boolean(quote.sendTaskId) || ["send_queued", "sent", "accepted"].includes(quote.status);
  const paymentStatus = order ? orderPaymentStatusValue(order) : quote.paymentStatus;
  const paid = ["deposit_paid", "paid"].includes(paymentStatus);
  const fullyPaid = paymentStatus === "paid";
  const orderCreated = Boolean(order?.id);
  const processing = ["processing", "fulfilled"].includes(order?.status || "");
  const fulfilled = order?.status === "fulfilled";
  const cancelled = order?.status === "cancelled" || quote.status === "cancelled" || quote.status === "rejected";
  const rawSteps = [
    { key: "quote", label: quoteSent ? "报价已发" : "报价草稿", done: quoteSent || orderCreated, current: !quoteSent && !orderCreated },
    { key: "confirm", label: quote.status === "accepted" || orderCreated ? "客户已确认" : "等客户确认", done: quote.status === "accepted" || orderCreated, current: quoteSent && quote.status !== "accepted" && !orderCreated },
    { key: "payment", label: fullyPaid ? "已付款" : paid ? "已收定金" : "待收款", done: paid, current: orderCreated && !paid },
    { key: "order", label: orderCreated ? "订单已建" : "待建订单", done: orderCreated, current: quote.status === "accepted" && !orderCreated },
    { key: "production", label: processing ? "生产处理中" : "待排产", done: processing, current: orderCreated && !processing && !cancelled },
    { key: "finish", label: fulfilled ? "已完成" : cancelled ? "已终止" : "待完成", done: fulfilled, current: cancelled },
  ];
  return rawSteps.map((step, index) => ({
    ...step,
    index: index + 1,
    state: cancelled && step.key !== "finish" ? "blocked" : step.done ? "done" : step.current ? "current" : "todo",
  }));
}

function quoteDealNextStep(quote: QuoteDraft, order: OrderDraft | null, sendRisk = "", orderDraftBlocker = "") {
  if (quote.status === "cancelled" || quote.status === "rejected") {
    return { tone: "red", label: "已终止", detail: "这条报价不用再自动推进，需要重新沟通后再建新报价。", action: "none" };
  }
  if (quote.status === "manual_review" || isHighValueQuote(quote)) {
    return { tone: "amber", label: "人工处理", detail: "高价值或待审核报价不要自动发，先由人工确认价格、图片和话术。", action: "none" };
  }
  if (sendRisk) {
    return { tone: "amber", label: "先补资料", detail: sendRisk, action: "none" };
  }
  if (!quote.sendTaskId && !["send_queued", "sent", "accepted"].includes(quote.status)) {
    return { tone: "blue", label: "下一步：发报价", detail: "报价检查通过后，可以放入微信安全发送队列。", action: "queue_quote" };
  }
  if (quote.status === "send_queued" || quote.sendTask?.status === "queued" || quote.sendTask?.status === "sending") {
    return { tone: "blue", label: "等待安全发送", detail: "报价已经入队，等待微信账号窗口校验后发送。", action: "none" };
  }
  if (!order && quote.status !== "accepted") {
    if (orderDraftBlocker) {
      return { tone: "amber", label: "先补资料", detail: orderDraftBlocker, action: "none" };
    }
    return { tone: "blue", label: "下一步：客户确认成单", detail: "客户明确回复确认、要这个、可以做后，点击这里生成订单草稿。", action: "confirm_quote_create_order" };
  }
  if (!order) {
    if (orderDraftBlocker) {
      return { tone: "amber", label: "先补资料", detail: orderDraftBlocker, action: "none" };
    }
    return { tone: "green", label: "下一步：生成订单", detail: "客户已经确认报价，可以生成订单草稿并进入收款/排产。", action: "create_order" };
  }
  if (!["deposit_paid", "paid"].includes(orderPaymentStatusValue(order))) {
    return { tone: "blue", label: "下一步：收款", detail: "订单已建，继续跟进定金或全款。", action: "none" };
  }
  return { tone: "green", label: "订单已衔接", detail: "报价已经进入订单链路，后续在订单草稿里处理确认、生产和交付。", action: "none" };
}

function orderSendFailureStep(order: OrderDraft) {
  if (orderNeedsManualSendAttention(order)) {
    return {
      tone: "red",
      label: "人工处理",
      detail: "订单确认或跟进发送失败，先由人工核对微信账号、客户会话、付款状态和发送记录。",
      action: "none",
    };
  }
  const failedConfirmation = order.confirmationSendTask && ["blocked", "failed", "cancelled"].includes(order.confirmationSendTask.status)
    ? order.confirmationSendTask
    : null;
  if (failedConfirmation) {
    return {
      tone: "red",
      label: "人工处理",
      detail: `订单确认发送${sendStatusLabel(failedConfirmation.status)}，先由人工核对微信账号、客户会话、付款状态和发送记录。`,
      action: "none",
    };
  }
  const failedFollowup = [
    order.followupSendTask,
    order.productionFollowupSendTask,
    order.deliveryFollowupSendTask,
    ...(order.followupSendTasks || []),
  ].find((task) => task && ["blocked", "failed", "cancelled"].includes(task.status));
  if (failedFollowup) {
    return {
      tone: "red",
      label: "人工处理",
      detail: `订单跟进发送${sendStatusLabel(failedFollowup.status)}，先由人工核对交付阶段、客户会话和发送记录。`,
      action: "none",
    };
  }
  return null;
}

function orderDealNextStep(
  order: OrderDraft,
  blockers: { confirmationBlocker?: string; productionBlocker?: string; deliveryFollowupBlocker?: string } = {},
) {
  if (order.status === "cancelled") {
    return { tone: "red", label: "已取消", detail: "这条订单已终止，不再发送确认或跟进。", action: "none" };
  }
  const failedSendStep = orderSendFailureStep(order);
  if (failedSendStep) return failedSendStep;
  if (isHighValueOrder(order)) {
    return { tone: "amber", label: "人工处理", detail: "高价值订单需要人工确认收款、交付和客户承诺。", action: "none" };
  }
  if (!orderPaymentReady(order)) {
    return { tone: "blue", label: "下一步：收款", detail: "订单已建，先跟进定金或全款，人工核验付款凭证后再发订单确认。", action: "none" };
  }
  const commercialBlocker = orderCommercialBlockReason(order);
  if (commercialBlocker) {
    return { tone: "amber", label: "先补资料", detail: commercialBlocker, action: "none" };
  }
  if (!hasActiveOrderConfirmationTask(order)) {
    if (blockers.confirmationBlocker) {
      return { tone: "amber", label: "先补资料", detail: blockers.confirmationBlocker, action: "none" };
    }
    return { tone: "blue", label: "下一步：发订单确认", detail: "把订单明细放入微信安全发送队列，让客户确认数量、金额和效果图。", action: "queue_order_confirmation" };
  }
  if (order.confirmationSendTask?.status === "queued" || order.confirmationSendTask?.status === "sending") {
    return { tone: "blue", label: "等待确认发送", detail: "订单确认已入队，等待微信账号窗口校验后发送。", action: "none" };
  }
  if (!orderPaymentReady(order)) {
    return { tone: "blue", label: "下一步：收款", detail: "确认已发，继续跟进定金或全款。", action: "none" };
  }
  if (order.status === "draft" || order.status === "confirmed") {
    if (blockers.productionBlocker) {
      return { tone: "amber", label: "先补资料", detail: blockers.productionBlocker, action: "none" };
    }
    return { tone: "green", label: "下一步：排产", detail: "客户已付款，可以标记生产中并发送生产通知。", action: "start_production" };
  }
  if (order.status === "processing") {
    if (blockers.deliveryFollowupBlocker) {
      return { tone: "amber", label: "先补资料", detail: blockers.deliveryFollowupBlocker, action: "none" };
    }
    return { tone: "green", label: "下一步：交付", detail: "生产处理中，准备交期说明或完成订单。", action: "send_delivery_followup" };
  }
  return { tone: "green", label: "已完成", detail: "订单流程已完成，保留报价、选图和发送记录方便复盘。", action: "none" };
}

function orderCommercialBlockReason(order: OrderDraft) {
  if (!orderSelectedImageIdValue(order)) return "订单未绑定客户选中的效果图，不能继续自动推进。";
  if (orderStrictIdentityMissing(order)) return orderStrictIdentityBlockReason("继续自动推进");
  if (Number(order.profit || 0) < 0) return "订单利润为负，需要人工确认报价和成本后再推进。";
  return "";
}

function matchesDealNextStepFilter(step: { action: string }, filter: string, status: string) {
  if (filter === "actionable") return step.action !== "none";
  if (filter === "blocked") return step.action === "none" && !["fulfilled", "cancelled", "rejected"].includes(status);
  return true;
}

function matchesDealProgressFilter(
  steps: Array<{ key: string; state: string }>,
  filter: string,
) {
  if (filter === "all") return true;
  return steps.some((step) => {
    if (step.key !== filter) return false;
    if (filter === "finish") return step.state === "done" || step.state === "current";
    return step.state === "current";
  });
}

function currentDealProgressStage(steps: Array<{ key: string; state: string }>) {
  const current = steps.find((step) => step.state === "current");
  if (current) return current.key;
  const finished = steps.find((step) => step.key === "finish" && step.state === "done");
  return finished ? "finish" : "all";
}

function calculateDealProgressStageCounts(quotes: QuoteDraft[], orders: OrderDraft[]) {
  const counts: Record<string, number> = {};
  for (const quote of quotes) {
    const order = orders.find((item) => item.quoteDraftId === quote.id) || null;
    const stage = currentDealProgressStage(dealProgressSteps(quote, order));
    counts[stage] = (counts[stage] || 0) + 1;
  }
  for (const order of orders) {
    const quote = order.quoteDraft || quotes.find((item) => item.id === order.quoteDraftId) || null;
    if (!quote) continue;
    const stage = currentDealProgressStage(dealProgressSteps(quote, order));
    counts[stage] = (counts[stage] || 0) + 1;
  }
  return counts;
}

function dealProgressStageDetail(stage: string) {
  const details: Record<string, string> = {
    all: "查看全部报价和订单记录",
    quote: "报价还没有进入发送或成交链路",
    confirm: "报价已发，等待客户明确确认",
    payment: "订单已建，等待定金或全款核验",
    order: "客户已确认报价，等待生成订单草稿",
    production: "订单已建或已付款，等待排产和交付",
    finish: "已经完成或终止的成交记录",
  };
  return details[stage] || "查看这个成交阶段";
}

function dealProgressStageTone(stage: string) {
  if (stage === "payment" || stage === "finish") return "amber";
  if (stage === "order" || stage === "production") return "green";
  return "blue";
}

function dealProgressStageView(stage: string): "overview" | "actions" | "quotes" | "orders" {
  if (stage === "all") return "overview";
  if (stage === "payment" || stage === "production" || stage === "finish") return "orders";
  return "quotes";
}

function calculateDealNextStepCounts(quotes: QuoteDraft[], orders: OrderDraft[]) {
  return quotes.reduce(
    (counts, quote) => {
      const order = orders.find((item) => item.quoteDraftId === quote.id) || null;
      const step = quoteDealNextStep(quote, order, quoteSendBlockReason(quote));
      if (step.action !== "none") counts.actionable += 1;
      else if (matchesDealNextStepFilter(step, "blocked", quote.status)) counts.blocked += 1;
      return counts;
    },
    { actionable: 0, blocked: 0 },
  );
}

function calculateOrderNextStepCounts(orders: OrderDraft[]) {
  return orders.reduce(
    (counts, order) => {
      const step = orderDealNextStep(order);
      if (step.action !== "none") counts.actionable += 1;
      else if (matchesDealNextStepFilter(step, "blocked", order.status)) counts.blocked += 1;
      return counts;
    },
    { actionable: 0, blocked: 0 },
  );
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    budget: "预算",
    quantity: "数量",
    customer_assets: "素材",
    usage_scene: "用途",
    order_or_tracking: "订单/单号",
    height: "身高",
    weight: "体重",
    order_or_evidence: "凭证",
    order_or_payment_info: "订单/付款信息",
    scene_clarification: "处理重点",
  };
  return labels[field] || field;
}

function quoteStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    auto_sent: "自动报价",
    send_queued: "待安全发送",
    manual_review: "待人工审核",
    sent: "已发送",
    accepted: "已成交",
    rejected: "已拒绝",
    cancelled: "已取消",
  };
  return labels[status] || status;
}

function quoteNeedsPaymentProofReview(quote: QuoteDraft) {
  if (!quote || quote.status !== "manual_review") return false;
  if (["deposit_paid", "paid"].includes(quote.paymentStatus || "")) return false;
  const notes = String(quote.customerNotes || "");
  return /付款凭证|支付凭证|转账|打款|付款截图|收款截图|收款账户|收款状态|人工核验金额|deposit|payment|paid/i.test(notes);
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unpaid: "未付款",
    deposit_paid: "已付定金",
    paid: "已付款",
    refunded: "已退款",
  };
  return labels[status] || status;
}

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    confirmed: "已确认",
    processing: "处理中",
    fulfilled: "已完成",
    cancelled: "已取消",
  };
  return labels[status] || status;
}

const HIGH_VALUE_AMOUNT_CNY = 10000;

function designImageSendBlockReason(job: DesignJob) {
  const images = job.images || [];
  const localImageCount = images.filter((image) => Boolean(image.localPath)).length;
  if (!images.length) return "还没有候选图";
  if (localImageCount !== images.length) {
    return `还有 ${images.length - localImageCount} 张候选图没有保存到本地，请先轮询结果或重试出图。`;
  }
  if (!job.wechatAccountId || !job.customerId || !job.conversationId) return "缺少微信账号、客户或会话绑定";
  return "";
}

function confirmHighValueManualApproval(options: {
  title: string;
  reason: string;
  actionLabel: string;
  nextAction: string;
  identityLines?: string[];
}) {
  return window.confirm(
    [
      `确认人工批准：${options.title}`,
      ...(options.identityLines?.length ? ["", ...options.identityLines] : []),
      "",
      `原因：${options.reason}`,
      `动作：${options.actionLabel}`,
      `下一步：${options.nextAction}`,
      "请确认不会把 A 客户内容发给 B 客户，并且图片、报价、利润和客户身份已经人工核对。",
    ].join("\n"),
  );
}

function quoteSendBlockReason(quote: QuoteDraft, previewWarnings: string[] = [], options: { allowManualReview?: boolean } = {}) {
  const warnings = previewWarnings.length ? previewWarnings.map(quoteWarningLabel) : [];
  const designJob = quote.designJob as
    | (QuoteDraft["designJob"] & { wechatAccountId?: string | null; conversationId?: string | null })
    | undefined;
  if (!warnings.length) {
    if (quote.sendTaskId) warnings.push("已进入发送队列");
    if (!quote.selectedImageId) warnings.push("还没有选图");
    if (quoteNeedsPaymentProofReview(quote)) warnings.push("付款凭证需要先人工核验金额和收款账户");
    if (quote.status === "manual_review" && !options.allowManualReview) warnings.push("正在等待人工审核");
    if (isHighValueQuote(quote) && !options.allowManualReview) warnings.push("达到高价值线，需要人工批准");
    if (Number(quote.profit || 0) < 0) warnings.push("利润为负，需要人工确认");
    if (!designJob?.wechatAccountId || !quote.customerId || !designJob?.conversationId) warnings.push("缺少微信账号、客户或会话绑定");
  }
  return warnings.join("；");
}

function orderConfirmationBlockReason(order: OrderDraft, previewWarnings: string[] = []) {
  const warnings = previewWarnings.length ? previewWarnings.map(orderWarningLabel) : [];
  if (!warnings.length) {
    if (order.status === "cancelled") warnings.push("订单已取消");
    if (hasActiveOrderConfirmationTask(order)) warnings.push(`订单确认${sendStatusLabel(order.confirmationSendTask?.status || "")}`);
    if (!orderSelectedImageIdValue(order)) warnings.push("订单还没有选图");
    if (!orderPaymentReady(order)) warnings.push("未记录定金或全款，先核验付款凭证");
    if (orderStrictIdentityMissing(order)) warnings.push(orderStrictIdentityWarning());
    if (isHighValueOrder(order)) warnings.push("达到高价值线，需要人工确认订单");
    if (Number(order.profit || 0) < 0) warnings.push("利润为负，需要人工确认");
  }
  return warnings.join("；");
}

function isHighValueQuote(quote: QuoteDraft) {
  return (
    quote.designJob?.isHighValue === true ||
    isHighValueBudget(quote.designJob?.budget) ||
    isHighValueAmount(quote.totalPrice, quote.unitPrice)
  );
}

function isHighValueOrder(order: OrderDraft) {
  return (
    order.designJob?.isHighValue === true ||
    order.quoteDraft?.designJob?.isHighValue === true ||
    isHighValueBudget(order.designJob?.budget || order.quoteDraft?.designJob?.budget) ||
    isHighValueAmount(order.totalPrice, order.unitPrice) ||
    isHighValueAmount(order.quoteDraft?.totalPrice, order.quoteDraft?.unitPrice)
  );
}

function orderNeedsManualSendAttention(order: OrderDraft) {
  const owner = String(order.owner || "").trim();
  const customerNotes = String(order.customerNotes || "");
  return (
    owner === "\u4eba\u5de5\u5ba2\u670d" &&
    customerNotes.includes("[\u53d1\u9001\u4efb\u52a1:") &&
    customerNotes.includes("\u53d1\u9001\u5931\u8d25") &&
    customerNotes.includes("\u9700\u8981\u4eba\u5de5\u5904\u7406")
  );
}

function highValueDesignReason(job: DesignJob) {
  if (isHighValueDesignJob(job)) return highValueBudgetReason(job.budget);
  return "已进入人工审核状态";
}

function highValueQuoteReason(quote: QuoteDraft) {
  const totalPrice = Number(quote.totalPrice || 0);
  const unitPrice = Number(quote.unitPrice || 0);
  const amountReason = highValueAmountReason(totalPrice, unitPrice, quote.quantity);
  if (amountReason) return amountReason;
  if (isHighValueQuote(quote)) return highValueBudgetReason(quote.designJob?.budget);
  return "报价已进入人工审核状态";
}

function highValueOrderReason(order: OrderDraft) {
  if (orderNeedsManualSendAttention(order)) return "订单发送异常，需要人工核对发送记录";
  const totalPrice = Number(order.totalPrice || 0);
  const unitPrice = Number(order.unitPrice || 0);
  const amountReason = highValueAmountReason(totalPrice, unitPrice, order.quantity);
  if (amountReason) return amountReason;
  const budget = order.designJob?.budget || order.quoteDraft?.designJob?.budget;
  if (isHighValueOrder(order)) return highValueBudgetReason(budget);
  return "订单已进入人工跟进状态";
}

function highValueBudgetReason(budget?: DesignJob["budget"]) {
  const totalAmount = Number(budget?.totalAmount || 0);
  const perUnitAmount = Number(budget?.perUnitAmount || 0);
  const quantity = Number(budget?.quantity || 0);
  const amountReason = highValueAmountReason(totalAmount, perUnitAmount, quantity);
  if (amountReason) return amountReason;
  const parts = [
    totalAmount > 0 ? `总额 ${formatMoney(totalAmount)} 元` : "",
    perUnitAmount > 0 ? `单份 ${formatMoney(perUnitAmount)} 元` : "",
    quantity > 0 ? `${formatMoney(quantity)} 份` : "",
  ].filter(Boolean);
  return parts.length ? `后端已标记高价值：${parts.join(" · ")}` : "后端已标记为高价值客户";
}

function highValueAmountReason(totalAmount: number, perUnitAmount: number, quantity?: number) {
  const parts = [
    Number.isFinite(totalAmount) && totalAmount > 0 ? `总额 ${formatMoney(totalAmount)} 元` : "",
    Number.isFinite(perUnitAmount) && perUnitAmount > 0 ? `单份 ${formatMoney(perUnitAmount)} 元` : "",
    Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? `${formatMoney(Number(quantity))} 份` : "",
  ].filter(Boolean);
  if (isHighValueAmount(totalAmount, perUnitAmount)) {
    return `达到高价值线：${parts.join(" · ")}`;
  }
  return "";
}

function isHighValueAmount(totalAmount?: number | string | null, perUnitAmount?: number | string | null) {
  const total = Number(totalAmount || 0);
  const perUnit = Number(perUnitAmount || 0);
  return total >= HIGH_VALUE_AMOUNT_CNY || perUnit >= HIGH_VALUE_AMOUNT_CNY;
}

function isHighValueBudget(budget?: DesignJob["budget"]) {
  return isHighValueAmount(budget?.totalAmount, budget?.perUnitAmount);
}

function isHighValueDesignJob(job: DesignJob) {
  return job.isHighValue === true || isHighValueBudget(job.budget);
}

function canRetryDesignJobFromUi(job: DesignJob) {
  return ["failed", "timeout"].includes(job.status) || (job.status === "manual_review" && Boolean(job.errorMessage));
}

function designJobEscalationNotice(job: DesignJob): HighValueManualStep | null {
  const readableError = job.errorMessage ? operatorStatusMessage(job.errorMessage, job.errorMessage) : "";
  if (job.status === "manual_review" && readableError) {
    return {
      tone: "red",
      label: "提交失败已转人工",
      detail: `失败原因：${readableError}`,
      nextAction: "先预检设计平台和素材，修好后重新提交；如果客户在等图，先人工解释正在处理。",
      priority: 8,
    };
  }
  if (job.status === "failed") {
    return {
      tone: "red",
      label: "出图失败",
      detail: readableError ? `失败原因：${readableError}` : "设计平台返回失败，不能继续自动发图或报价。",
      nextAction: "先预检设计平台和素材，确认无误后重新提交；仍失败就保持人工跟进。",
      priority: 10,
    };
  }
  if (job.status === "timeout") {
    return {
      tone: "red",
      label: "出图超时",
      detail: readableError ? `超时原因：${readableError}` : "出图等待时间过长，客户侧需要温和解释。",
      nextAction: "先轮询结果或重新提交，同时人工告知客户正在处理，避免长时间无回应。",
      priority: 12,
    };
  }
  if (job.status === "manual_review") {
    return highValueDesignManualStep(job);
  }
  return null;
}

function designJobOperatorRecoveryPlan(job: DesignJob) {
  if (job.status === "timeout") {
    return [
      "先点轮询结果，确认设计平台是否已完成但回调丢失。",
      "仍无结果再点预检，检查设计平台在线、客户素材和 SKU 真实图片。",
      "预检通过后重新提交；客户正在等图时先转人工接管并解释正在处理。",
    ];
  }
  if (job.status === "failed" || (job.status === "manual_review" && job.errorMessage)) {
    return [
      "先看失败原因，再点预检，确认设计平台、客户素材和 SKU 图片都可用。",
      "预检通过后重新提交；再次失败不要自动发图，继续人工接管。",
      "重试前核对微信账号、客户和会话，避免把 A 客户结果处理到 B 客户。",
    ];
  }
  if (job.status === "manual_review") {
    return [
      "先核对预算、数量、客户素材和礼盒组合是否完整。",
      "已有候选图时逐张检查真实 SKU、Logo、礼盒组合和质感。",
      "确认无误后再批准发图或生成报价，高价值客户继续人工跟进。",
    ];
  }
  return [];
}

function highValueDesignManualStep(job: DesignJob): HighValueManualStep {
  if (job.status === "failed") {
    return {
      tone: "red",
      label: "出图失败",
      detail: "先看失败原因，决定重试出图、改需求，还是人工联系客户解释。",
      nextAction: "打开设计任务，查看失败信息和客户原始需求，必要时先发人工安抚话术。",
      priority: 10,
    };
  }
  if (job.status === "timeout") {
    return {
      tone: "red",
      label: "出图超时",
      detail: "先安抚客户并检查设计平台状态，避免高价值客户长时间无回应。",
      nextAction: "先联系客户说明正在处理，再检查设计平台健康状态和任务是否需要重提。",
      priority: 12,
    };
  }
  if (job.images?.length) {
    return {
      tone: "amber",
      label: "先审图片",
      detail: "人工确认图片是否使用真实 SKU、是否完整展示商品，再决定发图或要求改图。",
      nextAction: "逐张检查 SKU、Logo、礼盒组合和质感，通过后再进入报价或发送。",
      priority: 30,
    };
  }
  return {
    tone: "amber",
    label: "待人工判断",
    detail: "高价值客户不要自动发送，先确认需求、素材、预算和设计任务状态。",
    nextAction: "补齐预算、数量、用途、素材和礼盒搭配，再决定是否提交设计平台。",
    priority: 40,
  };
}

function highValueQuoteManualStep(quote: QuoteDraft, order: OrderDraft | null): HighValueManualStep {
  if (order) {
    return {
      tone: "green",
      label: "已进订单",
      detail: "报价已生成订单，继续在订单里确认收款、交期和客户承诺。",
      nextAction: "转到订单卡片，继续核验付款、交期、排产和客户承诺。",
      priority: 70,
    };
  }
  if (!quote.selectedImageId) {
    return {
      tone: "amber",
      label: "先确认选图",
      detail: "客户还没有明确选中效果图，人工先确认图片编号或截图，避免报错图。",
      nextAction: "回到会话确认客户选的是哪张图，确认后再计算报价。",
      priority: 25,
    };
  }
  if (Number(quote.profit || 0) < 0) {
    return {
      tone: "red",
      label: "利润异常",
      detail: "报价利润为负，必须人工复核成本、售价、赠品和优惠。",
      nextAction: "先调整成本、售价或组合，利润恢复正常前不要发给客户。",
      priority: 14,
    };
  }
  if (quote.status === "manual_review" || isHighValueQuote(quote)) {
    return {
      tone: "amber",
      label: "审价再发",
      detail: "高价值报价先确认数量、单价、利润、话术和发送对象，再放入安全发送队列。",
      nextAction: "人工核对价格、利润、选图和客户身份，再决定是否批准发送。",
      priority: 35,
    };
  }
  return {
    tone: "blue",
    label: "可继续跟进",
    detail: "报价信息基本完整，人工确认后再推进发送或成单。",
    nextAction: "人工确认无误后，选择发送报价或生成订单草稿。",
    priority: 60,
  };
}

function highValueQueueAccountLabel(value?: string | null) {
  return `账号 ${reviewTraceValue(String(value || "未绑定"))}`;
}

function highValueQueueCustomerLabel(value?: string | null) {
  return `客户 ${reviewTraceValue(String(value || "未绑定"))}`;
}

function highValueQueueConversationLabel(value?: string | null) {
  return `会话 ${reviewTraceValue(String(value || "未绑定"))}`;
}

function highValueQueueIdentityMissing(account?: string | null, customer?: string | null, conversation?: string | null) {
  return !String(account || "").trim() || !String(customer || "").trim() || !String(conversation || "").trim();
}

function highValueQueueIdentityMissingDetail() {
  return "缺少微信账号、客户或会话绑定，先补齐身份再继续人工审核、报价、订单确认或发送。";
}

function highValueQueueIdentityMissingNextAction() {
  return "先定位到客户会话或业务记录，补齐微信账号、客户和会话绑定；未补齐前不要批准发送。";
}

function highValueOrderManualStep(order: OrderDraft): HighValueManualStep {
  if (orderNeedsManualSendAttention(order)) {
    return {
      tone: "red",
      label: "发送异常",
      detail: "订单确认或跟进发送失败，需要人工核对微信账号、客户会话、付款状态和发送记录。",
      nextAction: "先打开发送中心查看失败/拦截原因，确认不是 A 客户内容发给 B 客户后，再决定重排或人工跟进。",
      priority: 12,
    };
  }
  const approvalBlocker = highValueOrderApprovalBlockReason(order, { includePayment: false });
  if (approvalBlocker) {
    return {
      tone: "red",
      label: "先补资料",
      detail: approvalBlocker,
      nextAction: "先补齐选图、付款、客户身份和利润确认；这些条件没过时，不要批准订单确认或跟进发送。",
      priority: 16,
    };
  }
  if (!orderPaymentReady(order)) {
    return {
      tone: "red",
      label: "先跟收款",
      detail: "高价值订单未记录定金或全款，先由人工确认付款凭证，不要自动承诺排产。",
      nextAction: "联系客户确认付款安排，收到凭证后人工核验金额再改付款状态。",
      priority: 18,
    };
  }
  if (!hasActiveOrderConfirmationTask(order)) {
    return {
      tone: "amber",
      label: "发前确认",
      detail: "付款已确认，人工核对订单金额、效果图、交期和客户会话后再发送订单确认。",
      nextAction: "确认订单对象、效果图、数量、金额和交期，再创建订单确认发送任务。",
      priority: 28,
    };
  }
  if (order.status === "processing") {
    return {
      tone: "green",
      label: "跟交付",
      detail: "订单已进入生产，人工跟进生产进度、交期说明和异常通知。",
      nextAction: "按交期节点更新客户，出现库存、物流或设计修改异常时及时人工说明。",
      priority: 45,
    };
  }
  return {
    tone: "amber",
    label: "人工跟单",
    detail: "继续人工核对付款、排产、发货和客户承诺，避免自动漏跟。",
    nextAction: "检查订单当前状态，补齐下一次人工跟进动作和负责人。",
    priority: 50,
  };
}

function sortHighValueReviewOrderDrafts(orders: OrderDraft[]) {
  const now = Date.now();
  return [...orders].sort((left, right) => {
    const leftStep = highValueOrderManualStep(left);
    const rightStep = highValueOrderManualStep(right);
    const leftNextFollow = highValueOrderNextFollowTime(left);
    const rightNextFollow = highValueOrderNextFollowTime(right);
    const leftAmount = Math.max(Number(left.totalPrice || 0), Number(left.unitPrice || 0));
    const rightAmount = Math.max(Number(right.totalPrice || 0), Number(right.unitPrice || 0));
    return (
      leftStep.priority - rightStep.priority ||
      highValueOrderFollowRank(leftNextFollow, now) - highValueOrderFollowRank(rightNextFollow, now) ||
      rightAmount - leftAmount ||
      orderUpdatedTime(left) - orderUpdatedTime(right)
    );
  });
}

function highValueOrderFollowRank(nextFollowAt: number, now: number) {
  if (!nextFollowAt) return 2;
  return nextFollowAt <= now ? 0 : 1;
}

function highValueOrderNextFollowTime(order: OrderDraft) {
  const lines = String(order.customerNotes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    const match = line.match(/下次跟进：([^；\n]+)/);
    const timestamp = match ? Date.parse(match[1].trim()) : 0;
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return 0;
}

function orderUpdatedTime(order: OrderDraft) {
  return Date.parse(order.updatedAt || order.createdAt || "") || 0;
}

function highValueOrderMatchesReviewFilter(order: OrderDraft, filter: (typeof highValueOrderReviewFilterOptions)[number]["value"]) {
  if (filter === "all") return true;
  if (filter === "send_attention") return orderNeedsManualSendAttention(order);
  if (filter === "payment") return !orderPaymentReady(order);
  if (filter === "confirmation") {
    return orderPaymentReady(order) && !highValueOrderApprovalBlockReason(order, { includePayment: false }) && !hasActiveOrderConfirmationTask(order);
  }
  if (filter === "delivery") {
    return order.status === "processing" && !highValueOrderApprovalBlockReason(order, { includePayment: false });
  }
  if (filter === "overdue") {
    const nextFollowAt = highValueOrderNextFollowTime(order);
    return nextFollowAt > 0 && nextFollowAt <= Date.now();
  }
  return true;
}

function highValueOrderReviewFilterForOrder(order: OrderDraft): (typeof highValueOrderReviewFilterOptions)[number]["value"] {
  if (highValueOrderMatchesReviewFilter(order, "send_attention")) return "send_attention";
  if (highValueOrderMatchesReviewFilter(order, "payment")) return "payment";
  if (highValueOrderMatchesReviewFilter(order, "confirmation")) return "confirmation";
  if (highValueOrderMatchesReviewFilter(order, "delivery")) return "delivery";
  if (highValueOrderMatchesReviewFilter(order, "overdue")) return "overdue";
  return "all";
}

function highValueOrderReviewFilterOptionLabel(filter: (typeof highValueOrderReviewFilterOptions)[number]["value"]) {
  return highValueOrderReviewFilterOptions.find((option) => option.value === filter)?.label || "全部";
}

function highValueOrderNextFollowLabel(order: OrderDraft) {
  const nextFollowAt = highValueOrderNextFollowTime(order);
  if (!nextFollowAt) return "";
  const label = formatDateTime(new Date(nextFollowAt).toISOString());
  return nextFollowAt <= Date.now() ? `已到跟进：${label}` : `下次跟进：${label}`;
}

function highValueOrderApprovalBlockReason(order: OrderDraft, options: { includePayment?: boolean } = {}) {
  if (!orderSelectedImageIdValue(order)) return "高价值订单未绑定客户选中的效果图，不能批准订单确认或跟进发送。";
  if (orderStrictIdentityMissing(order)) return `高价值${orderStrictIdentityBlockReason("批准订单确认或跟进发送")}`;
  if (options.includePayment !== false && !orderPaymentReady(order)) return "高价值订单未核验定金或全款，不能批准订单确认或跟进发送。";
  if (Number(order.profit || 0) < 0) return "高价值订单利润为负，必须人工确认报价和成本后再批准发送。";
  return "";
}

function highValueOrderManualPrimaryAction(order: OrderDraft): { type: "focus" | "queue_confirmation" | "queue_delivery"; label: string } {
  if (orderNeedsManualSendAttention(order)) return { type: "focus", label: "查发送" };
  if (highValueOrderApprovalBlockReason(order, { includePayment: false })) return { type: "focus", label: "补资料" };
  if (!orderPaymentReady(order)) return { type: "focus", label: "去收款" };
  if (!hasActiveOrderConfirmationTask(order)) return { type: "queue_confirmation", label: "核验并发确认" };
  if (order.status === "processing") return { type: "queue_delivery", label: "发交期说明" };
  return { type: "focus", label: "跟订单" };
}

function buildHighValueOrderManualNote(input: { note: string; nextFollowAt?: string; reviewer: string; stepLabel: string }) {
  const parts = [
    `[高价值订单人工跟进] ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    `处理人：${input.reviewer}`,
    `阶段：${input.stepLabel}`,
    `结果：${input.note}`,
  ];
  if (input.nextFollowAt) parts.push(`下次跟进：${input.nextFollowAt}`);
  return parts.join("；");
}

function appendOrderCustomerNotes(current: string | undefined | null, entry: string) {
  const existing = String(current || "").trim();
  return existing ? `${existing}\n${entry}` : entry;
}

function latestHighValueOrderManualNote(notes?: string | null) {
  const lines = String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...lines].reverse().find((line) => line.includes("[高价值订单人工跟进]")) || lines[lines.length - 1] || "";
}

function dedupeOrdersById(orders: OrderDraft[]) {
  const seen = new Set<string>();
  return orders.filter((order) => {
    if (seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
}

function automationBlockerSummary(counts: Array<{ code: string; count: number }> = []) {
  if (!counts.length) return "无";
  return counts.map((item) => `${automationBlockerLabel(item.code)} ${item.count} 个`).join("、");
}

function automationExampleSummary(examples: Array<{
  giftBoxSkuCode: string;
  itemSkuCode: string;
  totalPrice: number;
  profit?: number;
  marginRate?: number;
  leadTimeDays?: number;
  leadTimeKnown?: boolean;
}> = []) {
  if (!examples.length) return "暂无";
  return examples.map((item) =>
    `${item.giftBoxSkuCode}+${item.itemSkuCode}=售价${item.totalPrice}元/毛利${item.profit || 0}元/毛利率${Math.round((item.marginRate || 0) * 100)}%/交期${item.leadTimeKnown ? `${item.leadTimeDays || 0}天` : "未填"}`,
  ).join("、");
}

function automationBlockerListLabel(codes: string[] = []) {
  if (!codes.length) return "";
  return codes.map(automationBlockerLabel).join("、");
}

function automationBlockerLabel(code: string) {
  const labels: Record<string, string> = {
    low_margin: "低毛利",
    delivery_risk: "交期风险",
    spec_incomplete: "规格不完整",
    size_mismatch: "尺寸不匹配",
    size_unknown: "尺寸待核",
  };
  return labels[code] || code;
}

function quoteWarningLabel(warning: string) {
  const labels: Record<string, string> = {
    "preview failed": "报价预览生成失败",
    "quote already has a send task": "已进入发送队列",
    "quote has no selected image": "还没有选图",
    "quote design job has no wechat account": "缺少微信账号",
    "quote has no customer": "缺少客户绑定",
    "quote design job has no conversation": "缺少客户会话",
    "quote is waiting for manual review": "正在等待人工审核",
    "quote profit is negative": "利润为负，需要人工确认",
  };
  return labels[warning] || warning;
}

function orderWarningLabel(warning: string) {
  const labels: Record<string, string> = {
    "preview failed": "订单确认预览生成失败",
    "order is cancelled": "订单已取消",
    "order already has a confirmation send task": "确认消息已进入发送队列",
    "order has no selected image": "订单还没有选图",
    "order has no wechat account": "缺少微信账号",
    "order has no customer": "缺少客户绑定",
    "order has no conversation": "缺少客户会话",
    "order profit is negative": "利润为负，需要人工确认",
  };
  if (warning.startsWith("order binding invalid:") || warning.startsWith("订单绑定校验异常：")) return "订单绑定校验异常，需要人工确认";
  return labels[warning] || warning;
}
