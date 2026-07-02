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
  autoProcessLowValue,
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
  DesignJob,
  DesignPlatformHealth,
  DesignPlatformConfigSummary,
  DesignPlatformReadiness,
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
  loginDesignPlatform,
  markAllNotificationsRead,
  markNotificationRead,
  markManualReview,
  mergeAutomationStatusRun,
  NotificationItem,
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
  reviseQuoteSelection,
  redeemDesignPlatformActivation,
  requeueSendTask,
  requestDesignRevision,
  reviewDesignJob,
  reviewTrainingSample,
  ReviewCenter,
  ReviewLog,
  reviewQuote,
  retryDesignJob,
  restoreSku,
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
  SendAdapterInfo,
  SendAttempt,
  SendTask,
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
  validateSendTask,
  validateSendTaskCurrentWindow,
  WechatAccount,
  WechatChannelKey,
  WechatChannelStatus,
  WechatWindowSnapshot,
  WindowObserverStatus,
} from "../lib/api";

const WINDOW_SNAPSHOT_MAX_AGE_SECONDS = 30;
const AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES = 2;
const AUTO_SELECT_SKILL_SUGGESTION_MIN_CONFIDENCE = 80;
const TRAINING_SAMPLE_PAGE_SIZE = 12;
const TRAINING_SAMPLE_BATCH_REVIEW_LIMIT = 100;

function isSkillSuggestionAutoSelected(suggestion: SkillSuggestion) {
  if (suggestion.quality) return !suggestion.quality.needsReview;
  return (
    Number(suggestion.sampleCount || 0) >= AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES &&
    Number(suggestion.confidence || 0) >= AUTO_SELECT_SKILL_SUGGESTION_MIN_CONFIDENCE
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
  | "needs_attention"
  | "anti_wrong_reply"
  | "route_memory"
  | "reply_skill"
  | "route_and_reply";

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

const emptyDesignPlatformConfigForm: DesignPlatformConfigForm = {
  adapter: "art_image_local",
  baseUrl: "http://127.0.0.1:3000",
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
    baseUrl: config.baseUrl || (adapter === "art_image_local" ? "http://127.0.0.1:3000" : "http://127.0.0.1:3700"),
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
  const [jobs, setJobs] = useState<DesignJob[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [catalogAudit, setCatalogAudit] = useState<SkuCatalogAudit | null>(null);
  const [skuChangeLogs, setSkuChangeLogs] = useState<SkuChangeLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chatImports, setChatImports] = useState<ChatImport[]>([]);
  const [trainingSamples, setTrainingSamples] = useState<TrainingSample[]>([]);
  const [latestTrainingCorrectionSamples, setLatestTrainingCorrectionSamples] = useState<TrainingSample[]>([]);
  const [trainingOverview, setTrainingOverview] = useState<TrainingOverview | null>(null);
  const [skillSuggestions, setSkillSuggestions] = useState<SkillSuggestion[]>([]);
  const [selectedSkillSuggestionKeys, setSelectedSkillSuggestionKeys] = useState<string[]>([]);
  const [skillSuggestionAgentFilter, setSkillSuggestionAgentFilter] = useState<string>("all");
  const [skillApplySummary, setSkillApplySummary] = useState<string>("");
  const [trainingSampleQualityFilter, setTrainingSampleQualityFilter] = useState<TrainingSampleQualityFilter>("all");
  const [trainingSampleLimit, setTrainingSampleLimit] = useState<number>(TRAINING_SAMPLE_PAGE_SIZE);
  const [editingSampleId, setEditingSampleId] = useState<string>("");
  const [sampleEdit, setSampleEdit] = useState<TrainingSampleEdit | null>(null);
  const [selectedTrainingSampleIds, setSelectedTrainingSampleIds] = useState<string[]>([]);
  const [wechatAccounts, setWechatAccounts] = useState<WechatAccount[]>([]);
  const [wechatChannelStatus, setWechatChannelStatus] = useState<WechatChannelStatus | null>(null);
  const [wechatWorkbenchView, setWechatWorkbenchView] = useState<"channels" | "flow" | "config">("channels");
  const [sendWorkbenchView, setSendWorkbenchView] = useState<"queue" | "blocked" | "diagnostics">("queue");
  const [reviewWorkbenchView, setReviewWorkbenchView] = useState<"handoff" | "design" | "quote" | "logs">("handoff");
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
  const [quoteEdit, setQuoteEdit] = useState({
    quantity: "",
    unitPrice: "",
    totalCost: "",
    customerNotes: "",
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [reviewCenter, setReviewCenter] = useState<ReviewCenter>({ designJobs: [], quoteDrafts: [], logs: [] });
  const [designAssets, setDesignAssets] = useState<DesignAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [platformHealth, setPlatformHealth] = useState<DesignPlatformHealth | null>(null);
  const [platformReadiness, setPlatformReadiness] = useState<DesignPlatformReadiness | null>(null);
  const [platformConfig, setPlatformConfig] = useState<DesignPlatformConfigSummary | null>(null);
  const [platformConfigForm, setPlatformConfigForm] = useState<DesignPlatformConfigForm>(emptyDesignPlatformConfigForm);
  const [platformLoginForm, setPlatformLoginForm] = useState<DesignPlatformLoginForm>(emptyDesignPlatformLoginForm);
  const [platformActivationForm, setPlatformActivationForm] =
    useState<DesignPlatformActivationForm>(emptyDesignPlatformActivationForm);
  const [preflightResult, setPreflightResult] = useState<DesignJobPreflightResult | null>(null);
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
  const [skuForm, setSkuForm] = useState<SkuForm>(emptySkuForm);
  const [skuWorkbenchView, setSkuWorkbenchView] = useState<"catalog" | "repair" | "editor">("catalog");
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
  const [activeWorkspaceSection, setActiveWorkspaceSection] = useState<string>("design-center");
  const [noticeWorkbenchView, setNoticeWorkbenchView] = useState<"automation" | "issues" | "history">("automation");
  const [skuImportText, setSkuImportText] = useState<string>(`SKU编号\t商品名称\t商品类型\t分类\t成本价\t售价\t库存\t场景标签\t主图\t多角度图\t尺寸\t重量g\t材质\t供应商\t交期天数\t替代SKU\t搭配规则
BOX-B\t雅黑礼盒B\t礼盒\t礼盒\t40\t80\t20\t员工福利、客户拜访\tC:\\products\\box-b-main.jpg\tC:\\products\\box-b-side.jpg、C:\\products\\box-b-open.jpg\t30*22*9\t650\t特种纸\t杭州礼盒厂\t5\tBOX-A\t{"preferWith":["TEA-C","CARD-B"]}
TEA-C\t乌龙茶C\t内搭\t茶叶\t55\t120\t15\t员工福利\tC:\\products\\tea-c-main.jpg\tC:\\products\\tea-c-detail.jpg\t12*8*18\t300\t茶叶\t福建茶业供应商\t3\t\t适合与礼盒和感谢卡搭配
CARD-B\t感谢卡B\t配件\t贺卡\t3\t12\t200\t客户拜访\tC:\\products\\card-b-main.jpg\t\t10*15\t20\t纸张\t本地印刷厂\t2\t\t{"mustWith":["BOX-B"]}`);
  const [skuImportFields, setSkuImportFields] = useState<SkuImportField[]>([]);
  const [skuImportPreview, setSkuImportPreview] = useState<SkuImportResult | null>(null);
  const [bundleResult, setBundleResult] = useState<BundleRecommendation | null>(null);

  function orderFollowupBlockReason(order: OrderDraft, type: "production" | "delivery") {
    if (order.status === "cancelled") return "订单已取消，不能发送跟进消息。";
    if (!order.wechatAccountId || !order.conversationId) return "订单缺少微信账号或会话，不能发送跟进消息。";
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
      getAgents(),
      getChatImports(),
      getTrainingSamples({ quality: trainingSampleApiQualityFilter(trainingSampleQualityFilter), limit: trainingSampleLimit }),
      getTrainingSamples({ sourceType: "route_correction", limit: 3 }),
      getTrainingOverview(),
      getSkillSuggestions(),
      getWechatAccounts(),
      getWechatChannelStatus(identityFilters),
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
      getRouteEvaluations(),
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
      const kept = current.filter((key) => validKeys.has(key));
      return kept.length ? kept : safeKeys;
    });
    setWechatAccounts(accountRows);
    setWechatChannelStatus(channelStatusRows);
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

  async function changeTrainingSampleQualityFilter(filter: TrainingSampleQualityFilter) {
    const nextLimit = TRAINING_SAMPLE_PAGE_SIZE;
    setTrainingSampleQualityFilter(filter);
    setTrainingSampleLimit(nextLimit);
    setEditingSampleId("");
    setSampleEdit(null);
    setSelectedTrainingSampleIds([]);
    const rows = await getTrainingSamples({
      quality: trainingSampleApiQualityFilter(filter),
      limit: nextLimit,
    });
    setTrainingSamples(rows);
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
        quality: trainingSampleApiQualityFilter(trainingSampleQualityFilter),
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
        const asset = await createDemoCustomerLogo(activeConversation.customerId);
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
        const [skuResult, asset] = await Promise.all([createDemoSkuImages(), createDemoCustomerLogo(activeConversation.customerId)]);
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
      const asset = await createDemoCustomerLogo(activeConversation.customerId);
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
    if (!activeConversationId) {
      setMessage("请先选择要创建演示任务的客户会话。");
      return;
    }
    await runAction("创建超时演示任务", async () => {
      const job = await createTimeoutDemoJob(activeConversationId);
      setActiveId(job.id);
    });
  }

  async function createFailureDemo() {
    if (!activeConversationId) {
      setMessage("请先选择要创建演示任务的客户会话。");
      return;
    }
    await runAction("创建失败演示任务", async () => {
      const job = await createFailureDemoJob(activeConversationId);
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
      const result = await scanDesignTimeouts();
      setMessage(`扫描完成：检查 ${result.scanned} 个任务，超时 ${result.timedOut} 个。`);
    });
  }

  async function autoSubmitDrafts() {
    let firstSubmittedId = "";
    let summary = "";
    await runAction(
      "自动提交设计草稿",
      async () => {
        const result = await autoSubmitDesignDrafts();
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
    let diagnosticRun: AutomationRun | null = null;
    await runAction(
      "低价值自动处理",
      async () => {
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        const result = await autoProcessLowValue();
        const orderConfirmationQueued = result.orderConfirmation?.queued.length || 0;
        const orderFollowupQueued = result.orderFollowup?.queued.length || 0;
        summary = `草稿提交 ${result.autoSubmit.submitted.length} 个，跳过 ${result.autoSubmit.skipped.length} 个；出图发送入队 ${result.imageSend.queued.length} 个；报价入队 ${result.quoteSend?.queued.length || 0} 个；订单草稿 ${result.orderDraft?.created.length || 0} 个；订单确认 ${orderConfirmationQueued} 个，订单跟进 ${orderFollowupQueued} 个，失败 ${(result.imageSend.failed.length || 0) + (result.quoteSend?.failed.length || 0) + (result.orderDraft?.failed.length || 0)} 个。`;
        diagnosticRun = {
          trigger: "manual",
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          steps: [{ step: "lowValueAutomation", status: "completed", durationMs: Date.now() - startedMs }],
          errors: [],
          results: { lowValueAutomation: result },
        };
      },
      () => {
        if (diagnosticRun) {
          setAutomationStatus((current) => mergeAutomationStatusRun(current, diagnosticRun));
        }
        setMessage(summary || "低价值自动处理完成。");
      },
    );
  }

  async function runAutomationCycle() {
    let summary = "";
    await runAction(
      "后台自动化跑一轮",
      async () => {
        const result = await runAutomationOnce();
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
        summary = `后台自动化完成：低价值提交 ${lowValue?.autoSubmit.submitted.length || 0} 个，图片入队 ${lowValue?.imageSend.queued.length || 0} 个，报价入队 ${lowValue?.quoteSend?.queued.length || 0} 个，安全发送处理 ${sendQueue?.processed.length || 0} 个，订单草稿 ${orderCreated} 个${orderQueueAdvice}，拦截 ${sendQueue?.blocked.length || 0} 个${queueAdvice}。`;
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
        const result = await scanHighValueHandoffs();
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
    await runAction("标记提醒已读", () => markNotificationRead(notice.id, identityExpectation(notice)));
  }

  async function readAllNotices() {
    await runAction("全部提醒已读", () => markAllNotificationsRead(activeIdentityFilters()));
  }

  async function focusNoticeTarget(notice: NotificationItem) {
    const target = notice.target || {};
    const quoteDraftId = String(target.quoteDraftId || "");
    const designJobId = String(target.designJobId || "");
    const conversationId = String(target.conversationId || "");
    if (!notice.readAt) await markNotificationRead(notice.id, identityExpectation(notice));
    if (quoteDraftId) {
      focusQuoteCenter(quoteDraftId);
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
    setMessage("这条提醒没有绑定可定位的报价、设计任务或会话。");
  }

  async function preflightActiveJob() {
    if (!activeJob) return;
    await runAction("出图预检", async () => {
      const result = await preflightDesignJob(activeJob.id, identityExpectation(activeJob));
      setPreflightResult(result);
      const failed = result.checks.filter((check) => !check.ok && check.severity === "error");
      const warnings = result.checks.filter((check) => !check.ok && check.severity === "warning");
      setMessage(
        result.ok
          ? `出图预检通过：${result.adapter}，可用图片 ${result.usableReferenceCount} 个。${warnings.length ? `提醒：${warnings.map((item) => item.detail || item.label).join("；")}` : ""}`
          : `出图预检未通过：${failed.map((item) => item.detail || item.label).join("；")}`,
      );
    });
  }

  async function submitActiveJob() {
    if (!activeJob) return;
    await runAction("提交出图", () => submitDesignJob(activeJob.id, identityExpectation(activeJob)), () => {
      window.setTimeout(() => {
        load();
        setMessage("已自动刷新设计结果；如果还未完成，可以再点刷新。");
      }, 3200);
    });
  }

  async function selectFromCustomerText() {
    if (!activeJob) return;
    if (!selectionText.trim()) {
      setMessage("请先粘贴客户选图原话。");
      return;
    }
    let summary = "";
    await runAction(
      "识别客户选图",
      async () => {
        const result = await selectDesignImage(activeJob.id, selectionText.trim(), identityExpectation(activeJob)) as {
          matched?: boolean;
          reviewRequired?: boolean;
          autoQuoteCreated?: boolean;
          quote?: { id?: string; totalPrice?: number; status?: string } | null;
          errorMessage?: string;
          reason?: string;
        };
        if (!result.matched) {
          if (!result.reviewRequired && result.reason === "no_selection_intent") {
            summary = "没有识别到明确选图意图，系统未绑定候选图，也没有生成报价。";
            return;
          }
          summary = "没有识别到明确候选图，已转人工确认。";
          return;
        }
        if (result.autoQuoteCreated && result.quote) {
          summary = `已识别客户选图，并生成报价草稿 ${result.quote.id || ""}，金额 ${result.quote.totalPrice || "-"} 元。`;
          return;
        }
        if (result.reviewRequired) {
          summary = "已识别客户选图，但该任务需要人工报价或人工确认。";
          return;
        }
        summary = "已识别客户选图。";
      },
      () => {
        if (summary) setMessage(summary);
      },
    );
  }

  async function selectFirstImage() {
    if (!activeJob) return;
    await runAction("模拟客户选图", () => selectDesignImage(activeJob.id, "我选第1张", identityExpectation(activeJob)));
  }

  async function selectByReference() {
    if (!activeJob?.images?.length) return;
    const target = activeJob.images.find((image) => image.selected) || activeJob.images[0];
    await runAction("引用图片选图", () => selectDesignImage(activeJob.id, { referencedImageId: target.id }, identityExpectation(activeJob)));
  }

  async function selectByScreenshot() {
    if (!activeJob?.images?.length) return;
    const target = activeJob.images.find((image) => image.selected) || activeJob.images[0];
    await runAction("截图匹配选图", () =>
      selectDesignImage(activeJob.id, { screenshotFingerprint: target.fingerprint || "" }, identityExpectation(activeJob)),
    );
  }

  async function selectByUnclearScreenshot() {
    if (!activeJob) return;
    await runAction("截图不确定转人工", () =>
      selectDesignImage(activeJob.id, { screenshotFingerprint: "00000000000000000000000000000000" }, identityExpectation(activeJob)),
    );
  }

  async function quickConfirmActiveJob() {
    if (!activeJob) return;
    if (activeDesignImageSendRisk) {
      setMessage(`快速确认前检查未通过：${activeDesignImageSendRisk}`);
      return;
    }
    await runAction("快速确认发送", () => quickConfirmSend(activeJob.id, identityExpectation(activeJob)));
  }

  async function quoteActiveJob() {
    if (!activeJob) return;
    await runAction("生成报价", () => createQuote(activeJob.id, identityExpectation(activeJob)));
  }

  async function manualReviewActiveJob() {
    if (!activeJob) return;
    await runAction("转人工", () => markManualReview(activeJob.id, identityExpectation(activeJob)));
  }

  async function pollActiveJob() {
    if (!activeJob) return;
    await runAction("轮询设计结果", async () => {
      const result = await pollDesignJob(activeJob.id, identityExpectation(activeJob));
      setMessage(`设计平台状态：${result.remoteStatus}`);
    });
  }

  async function pollAllActiveDesignResults() {
    let summary = "";
    await runAction(
      "批量轮询设计结果",
      async () => {
        const result = await pollActiveDesignResults();
        summary = `轮询 ${result.scanned} 个出图中任务：完成 ${result.completed.length} 个，失败 ${result.failed.length} 个，仍在生成 ${result.generating.length} 个，取消 ${result.cancelled.length} 个，错误 ${result.errors.length} 个。`;
      },
      () => {
        load();
        setMessage(summary || "已批量轮询设计结果。");
      },
    );
  }

  async function retryActiveJob() {
    if (!activeJob) return;
    await runAction("重试设计任务", () => retryDesignJob(activeJob.id, identityExpectation(activeJob)));
  }

  async function requestRevisionForActiveJob() {
    if (!activeJob) return;
    if (!revisionText.trim()) {
      setMessage("请先输入客户具体想改哪里。");
      return;
    }
    const selectedImage = activeJob.images?.find((image) => image.selected);
    await runAction("提交客户改图", () =>
      requestDesignRevision(activeJob.id, {
        ...identityExpectation(activeJob),
        instruction: revisionText,
        sourceText: revisionText,
        selectedImageId: selectedImage?.id,
      }),
    );
  }

  async function cancelActiveJob() {
    if (!activeJob) return;
    await runAction("取消设计任务", () => cancelDesignJob(activeJob.id, identityExpectation(activeJob)));
  }

  async function importChat() {
    if (!chatText.trim()) {
      setMessage("请先粘贴聊天记录，格式建议为“客户：... / 客服：...”。");
      return;
    }
    await runAction("导入聊天记录", () =>
      importChatTranscript({
        name: "手动粘贴聊天训练",
        source: "manual_text",
        channel: "wechat",
        ...activeIdentityFilters(),
        text: chatText,
      }),
    );
  }

  async function compileTrainingSkills() {
    const validKeys = new Set(skillSuggestions.map(skillSuggestionKey));
    const suggestionKeys = selectedSkillSuggestionKeys.filter((key) => validKeys.has(key));
    if (!suggestionKeys.length) {
      setMessage("请先勾选要应用的 Skill 建议。");
      return;
    }
    const selectedSuggestions = skillSuggestions.filter((suggestion) => suggestionKeys.includes(skillSuggestionKey(suggestion)));
    const includeNeedsReview = selectedSuggestions.some((suggestion) => !isSkillSuggestionAutoSelected(suggestion));
    let summary = "";
    await runAction(
      "应用已选 Agent Skill",
      async () => {
        const result = await applySkillSuggestions({ minScore: 70, suggestionKeys, includeNeedsReview });
        const blockedText = result.requiresReview ? `，拦截 ${result.requiresReview} 条需复核建议` : "";
        summary = `已选 ${result.selected ?? suggestionKeys.length} 条建议，实际应用 ${result.applied ?? result.selected ?? suggestionKeys.length} 条，新增 ${result.created.length} 个 Skill，更新 ${result.updated.length} 个 Skill，跳过 ${result.skipped.length} 个无变化项${blockedText}。`;
      },
      () => {
        setSkillApplySummary(summary);
        setMessage(summary || "Agent Skill 应用完成。");
        getTrainingOverview().then(setTrainingOverview).catch(() => setTrainingOverview(null));
      },
    );
  }

  function toggleSkillSuggestion(key: string, checked: boolean) {
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
    toggleSkillSuggestion(key, !selectedSkillSuggestionKeys.includes(key));
  }

  function handleSkillSuggestionRowKeyDown(event: KeyboardEvent<HTMLDivElement>, suggestion: SkillSuggestion) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleSkillSuggestionFromRow(event, suggestion);
  }

  function selectAllSkillSuggestions() {
    const keys = filteredSkillSuggestions.map(skillSuggestionKey);
    setSelectedSkillSuggestionKeys((current) => [...new Set([...current, ...keys])]);
  }

  function clearSkillSuggestions() {
    const keys = new Set(filteredSkillSuggestions.map(skillSuggestionKey));
    setSelectedSkillSuggestionKeys((current) => current.filter((key) => !keys.has(key)));
  }

  function toggleTrainingSampleSelection(sampleId: string, checked: boolean) {
    setSelectedTrainingSampleIds((current) => {
      if (checked) return [...new Set([...current, sampleId])];
      return current.filter((item) => item !== sampleId);
    });
  }

  function selectVisibleTrainingSamples() {
    const ids = visibleTrainingSampleIds.slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    setSelectedTrainingSampleIds((current) => [...new Set([...current, ...ids])]);
    if (visibleTrainingSampleIds.length > ids.length) {
      setMessage(`已选择前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条当前显示样本，避免一次误处理过多。`);
    }
  }

  function selectTrainingSamplesNeedingReview() {
    const samples = visibleTrainingSamples.filter(isTrainingSampleNeedingManualReview).slice(0, TRAINING_SAMPLE_BATCH_REVIEW_LIMIT);
    if (!samples.length) {
      setMessage("当前显示样本里没有需要优先人工处理的训练样本。");
      return;
    }
    setSelectedTrainingSampleIds((current) => [...new Set([...current, ...samples.map((sample) => sample.id)])]);
    const overflowText =
      visibleTrainingSamples.filter(isTrainingSampleNeedingManualReview).length > samples.length
        ? `，本次只选择前 ${TRAINING_SAMPLE_BATCH_REVIEW_LIMIT} 条`
        : "";
    setMessage(`已智能选择 ${samples.length} 条需处理训练样本${overflowText}。`);
  }

  function clearSelectedTrainingSamples() {
    const visibleIds = new Set(visibleTrainingSampleIds);
    setSelectedTrainingSampleIds((current) => current.filter((sampleId) => !visibleIds.has(sampleId)));
  }

  async function updateTrainingSampleStatus(sample: TrainingSample, status: "ready" | "review" | "rejected") {
    const label = status === "ready" ? "确认训练样本" : status === "rejected" ? "禁用训练样本" : "退回复核样本";
    await runAction(
      label,
      () =>
        reviewTrainingSample(sample.id, {
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
    const confirmed = window.confirm(trainingSampleBatchConfirmQuestion(status, scopeLabel, candidates.length, overflowText));
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
          status,
          reviewer: "人工客服",
          note: trainingSampleBatchReviewNote(status, scopeLabel),
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

  async function saveTrainingSampleEdit(sample: TrainingSample, status: "ready" | "review") {
    if (!sampleEdit) return;
    const label = status === "ready" ? "保存并确认样本" : "保存样本修改";
    await runAction(
      label,
      () =>
        reviewTrainingSample(sample.id, {
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
    await runAction("创建发送任务", () => createDemoSendTask(targetConversation.id, targetConversation.wechatAccountId));
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
    await runAction(labels[mode], () => createDemoWindowSnapshot(mode, account.id, targetConversation.id));
  }

  async function scanRealWindowSnapshots() {
    let summary = "";
    await runAction(
      "扫描真实微信窗口快照",
      async () => {
        const result = await scanWindowSnapshotInbox();
        summary = `扫描 ${result.scanned} 个文件，成功 ${result.processed.length} 个，失败 ${result.failed.length} 个`;
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
        summary = `观察器 ${status.status}，扫描 ${result.scan.scanned} 个文件，成功 ${result.scan.processed.length} 个，失败 ${result.scan.failed.length} 个`;
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
    await runAction("错误窗口校验", () => validateSendTask(task.id, "wrong_chat"));
  }

  async function validateCorrect(task: SendTask) {
    await runAction("正确窗口校验", () => validateSendTask(task.id, "correct"));
  }

  async function validateCurrentWindow(task: SendTask) {
    await runAction("当前窗口快照校验", () => validateSendTaskCurrentWindow(task.id));
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

  async function cancelTask(task: SendTask) {
    const reason =
      task.guardSnapshot?.blockedByManualLock || task.guardSnapshot?.blockedBy === "manual_lock"
        ? "manual_takeover_cancel_send_task"
        : "manual_operator_cancel_from_send_center";
    await runAction("取消发送任务", () => cancelSendTask(task.id, { ...identityExpectation(task), reason }));
  }

  async function scanSendOps() {
    await runAction("扫描发送异常", () => scanSendOperations());
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
        const result = await processSafeSendQueue();
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
            confirmationCandidates.push(orderDraft);
            summary.orderCreated += 1;
          } catch {
            summary.failed += 1;
          }
        }

        for (const order of dedupeOrdersById(confirmationCandidates)) {
          try {
            await queueOrderConfirmation(order.id, identityExpectation(order));
            summary.confirmationQueued += 1;
          } catch {
            summary.failed += 1;
          }
        }

        const sendResult = await processSafeSendQueue();
        summary.sendProcessed = sendResult.processed.length;
        summary.blocked = sendResult.blocked.length;
        summary.skipped = sendResult.skipped.length;
        summary.failed += sendResult.failed.length;
      },
      () => {
        setMessage(
          `成交链路推进完成：报价入队 ${summary.quoteQueued} 个，订单草稿 ${summary.orderCreated} 个，订单确认 ${summary.confirmationQueued} 个，安全发送处理 ${summary.sendProcessed} 个，拦截 ${summary.blocked} 个，跳过 ${summary.skipped} 个，失败 ${summary.failed} 个。`,
        );
      },
    );
  }

  async function evaluateCustomerRoute() {
    if (!routeText.trim()) {
      setMessage("请先输入客户消息。");
      return;
    }
    await runAction("路由决策", () => evaluateRoute(routeText, activeIdentityFilters()));
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
    await runAction("更新报价", () => updateQuote(quote.id, { ...identityExpectation(quote), ...patch }));
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

  async function reviseQuoteDraftSelection(quote: QuoteDraft) {
    const selectedImage = chooseQuoteRevisionImage(quote);
    if (!selectedImage) return;
    await runAction("修订报价选图", () =>
      reviseQuoteSelection(quote.id, {
        ...identityExpectation(quote),
        selectedImageId: selectedImage.id,
        owner: "人工客服",
        note: `客户改选第 ${selectedImage.position} 张效果图，报价回到人工审核。`,
      }),
    );
  }

  async function createOrderDraft(quote: QuoteDraft) {
    await runAction("生成订单草稿", () => createOrderDraftFromQuote(quote.id, identityExpectation(quote)));
  }

  async function markPaidAndCreateOrder(quote: QuoteDraft) {
    await runAction("已付成交并生成订单", async () => {
      await updateQuote(quote.id, { ...identityExpectation(quote), paymentStatus: "paid", status: "accepted" });
      await createOrderDraftFromQuote(quote.id, identityExpectation(quote));
    });
  }

  async function updateOrderDraftStatus(order: OrderDraft, patch: {
    status?: string;
    paymentStatus?: string;
    customerNotes?: string;
    owner?: string;
  }) {
    await runAction("更新订单草稿", () => updateOrderDraft(order.id, { ...identityExpectation(order), ...patch }));
  }

  async function queueOrderDraftConfirmation(order: OrderDraft) {
    if (order.status === "cancelled") {
      setMessage("订单已取消，不能发送确认。");
      return;
    }
    if (canRequeueOrderConfirmationTask(order)) {
      await runAction("重新排队订单确认", () => requeueSendTask(order.confirmationSendTask!.id, identityExpectation(order.confirmationSendTask!)));
      return;
    }
    if (hasActiveOrderConfirmationTask(order)) {
      setMessage(`订单确认已在发送队列中：${sendStatusLabel(order.confirmationSendTask?.status || "")}`);
      return;
    }
    await runAction("订单确认进入发送队列", () => queueOrderConfirmation(order.id, identityExpectation(order)));
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
    await runAction(`取消${orderFollowupStageLabel(type)}发送`, () => cancelSendTask(task.id, identityExpectation(task)));
  }

  async function queueOrderFollowupDraft(order: OrderDraft, type: "production" | "delivery") {
    const task = orderFollowupTask(order, type);
    if (canRequeueOrderFollowupTask(order, type) && task) {
      await runAction(`重新排队${orderFollowupStageLabel(type)}`, () => requeueSendTask(task.id, identityExpectation(task)));
      return;
    }
    const blocker = orderFollowupBlockReason(order, type);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    await runAction(type === "delivery" ? "交期说明进入发送队列" : "生产通知进入发送队列", () =>
      queueOrderFollowup(order.id, type, identityExpectation(order)),
    );
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

  function focusQuoteCenter(searchTerm: string) {
    setQuoteCenterSearch(searchTerm);
    setQuoteStatusFilter("all");
    setQuotePaymentFilter("all");
    setOrderStatusFilter("all");
    setOrderPaymentFilter("all");
    setDealNextStepFilter("all");
    scrollToWorkspaceSection("quote-center");
  }

  function focusOrderDraft(order: OrderDraft) {
    focusQuoteCenter(order.quoteDraftId || order.id);
  }

  function handleLowValueAutomationIssue(issue: LowValueAutomationIssue) {
    const order =
      (issue.orderDraftId && orderDrafts.find((row) => row.id === issue.orderDraftId)) ||
      (issue.quoteDraftId && orderDrafts.find((row) => row.quoteDraftId === issue.quoteDraftId)) ||
      (issue.designJobId && orderDrafts.find((row) => row.designJobId === issue.designJobId)) ||
      null;
    const quote =
      (issue.quoteDraftId && quotes.find((row) => row.id === issue.quoteDraftId)) ||
      (issue.designJobId && quotes.find((row) => row.designJobId === issue.designJobId)) ||
      null;

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
    if (label === "订单草稿" || label === "确认/跟进") {
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
    if (kind === "manualLocks") {
      scrollToWorkspaceSection("account-center");
      setMessage("已切到多账号控制，可查看人工接管会话。");
      return;
    }
    if (lowValueAutomationIssueSummary?.firstIssue) {
      handleLowValueAutomationIssue(lowValueAutomationIssueSummary.firstIssue);
      return;
    }
    scrollToWorkspaceSection(kind === "sendTargets" ? "send-center" : "notice-center");
  }

  async function saveActiveQuoteEdit() {
    if (!activeQuote) return;
    await runAction("保存报价调整", () =>
      updateQuote(activeQuote.id, {
        ...identityExpectation(activeQuote),
        quantity: quoteEdit.quantity,
        unitPrice: quoteEdit.unitPrice,
        totalCost: quoteEdit.totalCost,
        customerNotes: quoteEdit.customerNotes,
      }),
    );
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
    await runAction("报价进入发送队列", () => queueQuoteSend(quote.id, identityExpectation(quote)));
  }

  async function checkQuoteReadyForSend(quote: QuoteDraft): Promise<{ ok: true; preview: QuotePreview } | { ok: false; reason: string; preview?: QuotePreview }> {
    try {
      const preview =
        activeQuotePreview?.quote.id === quote.id
          ? activeQuotePreview
          : quoteCenterPreview?.quote.id === quote.id
            ? quoteCenterPreview
            : await getQuotePreview(quote.id);
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
    return queueQuoteSend(quote.id, identityExpectation(quote));
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
      const preview = await getQuotePreview(quote.id);
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

  async function runQuoteDealNextStep(quote: QuoteDraft, order: OrderDraft | null, sendRisk = "") {
    const step = quoteDealNextStep(quote, order, sendRisk);
    if (step.action === "queue_quote") {
      await queueQuoteDraft(quote);
      return;
    }
    if (step.action === "confirm_quote_create_order") {
      await runAction("客户确认并生成订单", async () => {
        await updateQuote(quote.id, { ...identityExpectation(quote), status: "accepted" });
        await createOrderDraftFromQuote(quote.id, identityExpectation(quote));
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
    const step = orderDealNextStep(order);
    if (step.action === "queue_order_confirmation") {
      await queueOrderDraftConfirmation(order);
      return;
    }
    if (step.action === "start_production") {
      await updateOrderDraftStatus(order, { status: "processing" });
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
    const confirmed = window.confirm(`将按顺序执行前 ${items.length} 个可执行成交事项。高价值、人工审核和缺资料事项不会被批量推进。是否继续？`);
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
              await updateQuote(item.quote.id, { ...identityExpectation(item.quote), status: "accepted" });
              await createOrderDraftFromQuote(item.quote.id, identityExpectation(item.quote));
              summary.orderCreated += 1;
              continue;
            }
            if (item.action === "create_order" && item.quote) {
              await createOrderDraftFromQuote(item.quote.id, identityExpectation(item.quote));
              summary.orderCreated += 1;
              continue;
            }
            if (item.action === "queue_order_confirmation" && item.order) {
              await queueOrderConfirmation(item.order.id, identityExpectation(item.order));
              summary.orderConfirmationQueued += 1;
              continue;
            }
            if (item.action === "start_production" && item.order) {
              await updateOrderDraft(item.order.id, { ...identityExpectation(item.order), status: "processing" });
              summary.productionStarted += 1;
              continue;
            }
            if (item.action === "send_delivery_followup" && item.order) {
              await queueOrderFollowup(item.order.id, "delivery", identityExpectation(item.order));
              summary.deliveryQueued += 1;
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
    const notes: Record<typeof decision, string> = {
      approve_images: "图片审核通过，可进入快速确认。",
      approve_send: "图片审核通过，进入发送安全队列。",
      request_revision: "图片还需要继续微调。",
      reject: "当前方案不适合直接发给客户。",
    };
    await runAction("处理设计审核", () =>
      reviewDesignJob(job.id, {
        ...identityExpectation(job),
        decision,
        reviewer: "人工客服",
        note: notes[decision],
      }),
    );
  }

  async function reviewQuoteDraft(quote: QuoteDraft, decision: "approve_quote" | "request_followup" | "reject_quote") {
    const notes: Record<typeof decision, string> = {
      approve_quote: "报价审核通过，可以发给客户确认。",
      request_followup: "报价需要客服继续跟进客户意向。",
      reject_quote: "报价需要重新核算后再发送。",
    };
    await runAction("处理报价审核", () =>
      reviewQuote(quote.id, {
        ...identityExpectation(quote),
        decision,
        reviewer: "人工客服",
        note: notes[decision],
      }),
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
    if (!skuRepairQueue.length) {
      setMessage("当前没有待补齐商品资料可导出。");
      return;
    }
    const rows = [
      ["SKU编号", "商品名称", "商品类型", "严重程度", "是否影响自动搭配/出图", "优先级", "问题数", "建议动作", "待补字段", "字段处理建议", "原始问题"],
      ...skuRepairQueue.map((item) => [
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
    setMessage(`已导出 ${skuRepairQueue.length} 个待补齐商品，可交给运营按优先级补资料。`);
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
    if (!skuImageProblems.length) {
      setMessage("当前没有图片问题可导出。");
      return;
    }
    const rows = [
      ["SKU编号", "商品名称", "严重程度", "问题类型", "图片位置", "字段", "多角度图序号", "问题说明", "处理建议", "原始路径"],
      ...skuImageProblems.map((problem) => [
        problem.skuCode || "",
        problem.name || "",
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
      ]),
    ];
    const fileName = `sku-image-problems-${formatDateForFile(new Date())}.csv`;
    downloadTextFile(fileName, "text/csv;charset=utf-8", `\uFEFF${toCsv(rows)}`);
    setMessage(`已导出 ${skuImageProblems.length} 个图片问题，可交给运营逐条补图或确认移除路径。`);
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

    let summary = "";
    await runAction(
      "确认商品入库",
      async () => {
        const result = await bulkUpsertSkus(rows);
        summary = `已入库 ${result.count} 个商品。`;
      },
      () => {
        setSkuImportPreview(null);
        setMessage(summary || "商品已确认入库。");
      },
    );
  }

  function editSku(sku: Sku) {
    setSkuForm(skuToForm(sku));
    setSkuWorkbenchView("editor");
    setMessage(`正在编辑商品 ${sku.skuCode}`);
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
    setMessage(`正在处理 ${sku.skuCode} 的${skuImageRoleLabel(problem)}：${problem.message}`);
  }

  function stageSkuImageProblemFix(problem: SkuImageProblem) {
    const sku = skus.find((row) => row.skuCode === problem.skuCode || row.name === problem.name);
    if (!sku) {
      setMessage(`没有找到图片问题商品：${problem.skuCode || problem.name}`);
      return;
    }
    const form = skuToForm(sku);
    if (problem.imageRole === "main") {
      form.mainImagePath = "";
    } else {
      const angleImages = splitTextList(form.angleImages);
      const index = problem.imageIndex === null || problem.imageIndex === undefined ? -1 : Number(problem.imageIndex);
      const nextImages = angleImages.filter((imagePath, imageIndex) => {
        if (index >= 0) return imageIndex !== index;
        return imagePath !== problem.path;
      });
      form.angleImages = nextImages.join("、");
    }
    setSkuForm(form);
    setSkuSearch(sku.skuCode);
    setSkuIssueFilter("missing_image");
    setSelectedSkuCodes([sku.skuCode]);
    scrollToWorkspaceSection("sku-library");
    setMessage(`已在表单中处理 ${sku.skuCode} 的${skuImageRoleLabel(problem)}，确认无误后点击“保存商品”生效。`);
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

    await runAction(
      "保存商品",
      () => upsertSku(payload),
      () => {
        setMessage(`商品 ${payload.skuCode} 已保存。`);
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
    });
  }

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );

  useEffect(() => {
    load().catch((error) => {
      setMessage(error instanceof Error ? `数据服务暂不可用：${error.message}` : "数据服务暂不可用。");
    });
    getSkuImportFields().then(setSkuImportFields).catch(() => setSkuImportFields([]));
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
    let cancelled = false;
    const customerId = activeConversation?.customerId || "";
    if (!customerId) {
      setDesignAssets([]);
      setSelectedAssetIds([]);
      return;
    }
    getAssets("customer", customerId)
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
  }, [activeConversation?.customerId]);

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
        sectionId === "wechat-channel-center" &&
        (detailView === "channels" || detailView === "flow" || detailView === "config")
      ) {
        setWechatWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "send-center" &&
        (detailView === "queue" || detailView === "blocked" || detailView === "diagnostics")
      ) {
        setSendWorkbenchView((current) => (current === detailView ? current : detailView));
      }
      if (
        sectionId === "review-center" &&
        (detailView === "handoff" || detailView === "design" || detailView === "quote" || detailView === "logs")
      ) {
        setReviewWorkbenchView((current) => (current === detailView ? current : detailView));
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
  const highValueCount = jobs.filter((job) => job.isHighValue).length;
  const stockWarning = skus.filter((sku) => Number(sku.stock) <= 10).length;
  const trainingSampleTotalCount = trainingOverview?.totalSamples ?? trainingSamples.length;
  const trainingSampleQualityOptions = buildTrainingSampleQualityOptions({ overview: trainingOverview, samples: trainingSamples });
  const filteredTrainingSampleTotal = trainingSampleQualityTotal(
    trainingOverview,
    trainingSampleQualityFilter,
    trainingSamples.length,
  );
  const visibleTrainingSamples = trainingSamples;
  const visibleTrainingSampleIds = useMemo(() => visibleTrainingSamples.map((sample) => sample.id), [visibleTrainingSamples]);
  const selectedTrainingSampleIdSet = useMemo(() => new Set(selectedTrainingSampleIds), [selectedTrainingSampleIds]);
  const selectedVisibleTrainingSamples = useMemo(
    () => visibleTrainingSamples.filter((sample) => selectedTrainingSampleIdSet.has(sample.id)),
    [visibleTrainingSamples, selectedTrainingSampleIdSet],
  );
  const hiddenTrainingSampleCount = Math.max(0, filteredTrainingSampleTotal - visibleTrainingSamples.length);
  const latestCorrectionSamples = latestTrainingCorrectionSamples.length
    ? latestTrainingCorrectionSamples
    : trainingSamples.filter((sample) => sample.sourceType === "route_correction" || sample.sourceRouteId).slice(0, 3);
  const topTrainingAgents = (trainingOverview?.byAgent || []).filter((agent) => agent.sampleCount > 0).slice(0, 4);
  const skillSuggestionAgentOptions = buildSkillSuggestionAgentOptions(skillSuggestions, agents);
  const filteredSkillSuggestions =
    skillSuggestionAgentFilter === "all"
      ? skillSuggestions
      : skillSuggestions.filter((suggestion) => skillSuggestionAgentFilterKey(suggestion) === skillSuggestionAgentFilter);
  const visibleSkillSuggestions = filteredSkillSuggestions.slice(0, 12);
  const selectedSkillSuggestionKeySet = new Set(selectedSkillSuggestionKeys);
  const selectedSkillSuggestionCount = skillSuggestions.filter((suggestion) => selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion))).length;
  const filteredSelectedSkillSuggestionCount = filteredSkillSuggestions.filter((suggestion) =>
    selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion)),
  ).length;
  const autoSelectedSkillSuggestionCount = skillSuggestions.filter(isSkillSuggestionAutoSelected).length;
  const filteredNeedsReviewSkillSuggestionCount = filteredSkillSuggestions.filter((suggestion) => !isSkillSuggestionAutoSelected(suggestion)).length;
  const activeConversationSendTasks = activeConversationId
    ? sendTasks.filter((task) => task.conversationId === activeConversationId)
    : [];
  const activeConversationSendTaskCount = activeConversationSendTasks.length;
  const activeConversationDesignJobs = activeConversationId
    ? jobs.filter((job) => job.conversationId === activeConversationId)
    : [];
  const activeConversationDesignJobCount = activeConversationDesignJobs.length;
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
    openSendTasks.filter((task) => task.status !== "blocked" && !isSendTaskConversationLocked(task)),
  );
  const blockedSendTasksForView = prioritizeSendTasks(
    openSendTasks.filter(
      (task) =>
        task.status === "blocked" ||
        isSendTaskConversationLocked(task) ||
        Boolean(task.guardSnapshot?.blockedByManualLock) ||
        task.guardSnapshot?.blockedBy === "manual_lock",
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
  const sendWorkbenchSummary =
    sendWorkbenchView === "blocked"
      ? `${blockedSendTasksForView.length} 个拦截任务优先处理，${blockedSendCount} 个总拦截`
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
  const wechatConfigIssueChannels = wechatChannels.filter((channel) => channel.status === "needs_config");
  const activeWechatChannelName = wechatConversationChannelLabel(activeConversation?.channel);
  const activeQuote = activeJob ? quotes.find((quote) => quote.designJobId === activeJob.id) || null : null;
  const activeSelectedImage = activeJob?.images?.find((image) => image.selected) || null;
  const activePreflightResult = preflightResult?.designJobId === activeJob?.id ? preflightResult : null;
  const activeJobImages = activeJob?.images || [];
  const activeJobLocalImageCount = activeJobImages.filter((image) => Boolean(image.localPath)).length;
  const activeDesignImageSendRisk = !activeJobImages.length
    ? "还没有候选图"
    : activeJobLocalImageCount !== activeJobImages.length
      ? `还有 ${activeJobImages.length - activeJobLocalImageCount} 张候选图没有保存到本地，请先轮询结果或重试出图。`
      : "";
  const quoteCenterSearchTerm = quoteCenterSearch.trim().toLowerCase();
  const filteredQuotes = quotes.filter((quote) => {
    if (quoteStatusFilter !== "all" && quote.status !== quoteStatusFilter) return false;
    if (quotePaymentFilter !== "all" && quote.paymentStatus !== quotePaymentFilter) return false;
    const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
    const step = quoteDealNextStep(quote, orderDraft, quoteSendBlockReason(quote));
    if (!matchesDealNextStepFilter(step, dealNextStepFilter, quote.status)) return false;
    return matchesQuoteSearch(quote, quoteCenterSearchTerm);
  });
  const filteredOrderDrafts = orderDrafts.filter((order) => {
    if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) return false;
    if (orderPaymentFilter !== "all" && order.paymentStatus !== orderPaymentFilter) return false;
    const step = orderDealNextStep(order);
    if (!matchesDealNextStepFilter(step, dealNextStepFilter, order.status)) return false;
    return matchesOrderSearch(order, quoteCenterSearchTerm);
  });
  const quoteNextStepCounts = calculateDealNextStepCounts(quotes, orderDrafts);
  const orderNextStepCounts = calculateOrderNextStepCounts(orderDrafts);
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
      const step = quoteDealNextStep(quote, orderDraft, sendRisk);
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
      const step = orderDealNextStep(order);
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
  const dealFlowAcceptedQuotesWithoutOrder = acceptedQuotesWithoutOrder.filter((quote) => !isHighValueQuote(quote));
  const dealFlowConfirmationCandidates = orderDrafts.filter((order) =>
    !isHighValueOrder(order) && order.status === "confirmed" && !hasActiveOrderConfirmationTask(order),
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
        setQuoteStatusFilter("send_queued");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
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
        setQuoteStatusFilter("sent");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
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
        setQuoteStatusFilter("accepted");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "payment",
      label: "待收款",
      value: orderDrafts.filter((order) => ["draft", "confirmed"].includes(order.status) && order.paymentStatus === "unpaid").length,
      note: "订单已建，未记录定金或全款",
      tone: "red",
      onClick: () => {
        setQuoteStatusFilter("all");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("unpaid");
        scrollToWorkspaceSection("quote-center");
      },
    },
    {
      key: "confirm-send",
      label: "待发确认",
      value: orderDrafts.filter((order) =>
        order.status === "confirmed" && !hasActiveOrderConfirmationTask(order),
      ).length,
      note: "订单确认还没进入发送队列",
      tone: "blue",
      onClick: () => {
        setQuoteStatusFilter("all");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("confirmed");
        setOrderPaymentFilter("all");
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
        setQuoteStatusFilter("all");
        setQuotePaymentFilter("all");
        setOrderStatusFilter("all");
        setOrderPaymentFilter("all");
        scrollToWorkspaceSection("quote-center");
      },
    },
  ];
  const activeOrderDraft = activeQuote ? orderDrafts.find((order) => order.quoteDraftId === activeQuote.id) || null : null;
  const activeQuoteWarnings =
    activeQuote && activeQuotePreview?.quote.id === activeQuote.id ? activeQuotePreview.warnings : [];
  const activeQuoteSendRisk = activeQuote ? quoteSendBlockReason(activeQuote, activeQuoteWarnings) : "";
  const activeDealNextStep = activeOrderDraft
    ? orderDealNextStep(activeOrderDraft)
    : activeQuote
      ? quoteDealNextStep(activeQuote, activeOrderDraft, activeQuoteSendRisk)
      : activeSelectedImage
        ? { tone: "blue", label: "下一步：生成报价", detail: "客户已经选图，可以生成报价草稿。", action: "create_quote" }
        : { tone: "amber", label: "先让客户选图", detail: "还没有明确选中效果图，不能生成报价。", action: "none" };
  const unreadNoticeCount = notifications.filter((notice) => !notice.readAt).length;
  const lowValueAutomationIssues = useMemo(
    () => buildLowValueAutomationIssueItems(automationStatus?.lastRun),
    [automationStatus?.lastRun],
  );
  const lowValueAutomationIssueSummary = useMemo(
    () => buildLowValueAutomationIssueSummary(lowValueAutomationIssues),
    [lowValueAutomationIssues],
  );
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
    getQuotePreview(activeQuote.id)
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
  const skuRepairQueue = useMemo(() => catalogAudit?.repairQueue || [], [catalogAudit]);
  const skuImageProblems = useMemo(() => catalogAudit?.imageProblems || [], [catalogAudit]);
  const skuFormReadinessWarnings = useMemo(() => validateSkuFormReadiness(skuForm), [skuForm]);
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
  const firstReadinessProblem =
    platformReadiness?.checks.find((check) => !check.ok && check.severity === "error")?.label ||
    platformReadiness?.nextSteps[0] ||
    "";
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
  const reviewStateText =
    manualReviewJobCount || manualLockedConversations.length
      ? `${manualReviewJobCount} 个设计待人工审核 · ${manualLockedConversations.length} 个人工接管`
      : "审核中心空闲";
  const reviewWorkbenchSummary =
    reviewWorkbenchView === "design"
      ? `${reviewCenter.designJobs.length} 个设计待审`
      : reviewWorkbenchView === "quote"
        ? `${reviewCenter.quoteDrafts.length} 个报价待审`
        : reviewWorkbenchView === "logs"
          ? `${reviewCenter.logs.length} 条审核记录`
          : `${manualLockedConversations.length} 个人工接管`;
  const automationReadinessPrimaryCheck = getAutomationReadinessPrimaryCheck(automationReadiness);

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
              <span className="platform-pill current-section-pill" aria-live="polite">
                当前 {activeWorkspaceLabel}
              </span>
              <span className={`platform-pill platform-health-pill ${platformPillTone}`} title={platformReadiness?.nextSteps[0] || platformStateText}>
                {platformPillText}
              </span>
              <span className={`platform-pill automation-pill ${automationStatus?.active ? "online" : "warning"}`} title={automationPillTitle}>
                {automationPillText}
              </span>
            </div>
            <div className="toolbar-group">{renderConversationSelect()}</div>
            <div className="toolbar-group">
              <button type="button" className="ghost" onClick={checkDesignPlatform} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />检测设计平台</button>
              <button type="button" className="ghost" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />刷新</button>
            </div>
            <div className="toolbar-group">
              <button type="button" className="ghost" onClick={createDemo} disabled={Boolean(busy)}><Boxes size={16} aria-hidden="true" />新建演示任务</button>
              <button type="button" className="ghost" onClick={preflightActiveJob} disabled={!activeJob || Boolean(busy)}><ShieldCheck size={16} aria-hidden="true" />出图预检</button>
              <button type="button" className="primary" onClick={submitActiveJob} disabled={!activeJob || Boolean(busy)}><Send size={16} aria-hidden="true" />提交出图</button>
            </div>
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
            <button type="button" role="listitem" onClick={() => scrollToWorkspaceSection("training-center")} aria-controls="training-center">
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
        {platformReadiness && !platformReadiness.canSubmitFormalGeneration ? (
          <div className="readiness-banner warning">
            <ShieldAlert size={17} aria-hidden="true" />
            <strong>真实出图暂不可提交</strong>
            <span>{platformReadiness.nextSteps[0] || "设计平台登录态或设备激活还没有通过。"}</span>
            <small>
              凭证 {platformReadiness.config.hasAccessToken || platformReadiness.config.hasCookie ? "已配置" : "未配置"} · 设备ID{" "}
              {platformReadiness.config.hasDeviceId ? "已配置" : "未配置"}
            </small>
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
            </div>
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
                        baseUrl:
                          current.baseUrl ||
                          (option.value === "art_image_local" ? "http://127.0.0.1:3000" : "http://127.0.0.1:3700"),
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
                placeholder="http://127.0.0.1:3000"
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
            onClick={() => scrollToWorkspaceSection("training-center")}
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
                <button type="button" className="ghost compact-button" onClick={() => void load()} disabled={Boolean(busy)}>
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
                        <div className="wechat-channel-metrics" aria-label={`${channel.label}指标`}>
                          {Object.entries(channel.metrics).slice(0, 4).map(([key, value]) => (
                            <span key={key}>
                              <b>{value}</b>
                              <small>{wechatChannelMetricLabel(key)}</small>
                            </span>
                          ))}
                        </div>
                        <div className="wechat-channel-actions">
                          {channel.key === "personal_wechat" ? (
                            <>
                              <button type="button" className="ghost" onClick={captureCurrentWindowOnce} disabled={Boolean(busy)}>
                                <Search size={15} aria-hidden="true" />采集窗口
                              </button>
                              <button type="button" className="ghost" onClick={scanRealWindowSnapshots} disabled={Boolean(busy)}>
                                <RefreshCw size={15} aria-hidden="true" />扫描快照
                              </button>
                              <button type="button" className="primary" onClick={processSafeQueue} disabled={Boolean(busy)}>
                                <ShieldCheck size={15} aria-hidden="true" />处理队列
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="primary" onClick={() => runWechatChannelInbound(channel.key)} disabled={Boolean(busy)}>
                                <MessageCircle size={15} aria-hidden="true" />入站演练
                              </button>
                              <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("routing-center")} disabled={Boolean(busy)}>
                                <Route size={15} aria-hidden="true" />查看路由
                              </button>
                              <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("send-center")} disabled={Boolean(busy)}>
                                <Send size={15} aria-hidden="true" />发送队列
                              </button>
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
                        <button type="button" className="primary" onClick={() => void load()} disabled={Boolean(busy)}>
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
                              onClick={() => setWechatWorkbenchView(channel.status === "needs_config" ? "config" : "channels")}
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
                    </div>
                  </div>
                  <div className="wechat-visual-actions">
                    <button type="button" className="primary" onClick={processRouteInbound} disabled={Boolean(busy)}>
                      <Bot size={15} aria-hidden="true" />处理当前消息
                    </button>
                    <button type="button" className="ghost" onClick={() => setWechatWorkbenchView("config")} disabled={Boolean(busy)}>
                      <Check size={15} aria-hidden="true" />配置检查
                    </button>
                    <button type="button" className="ghost" onClick={() => scrollToWorkspaceSection("review-center")} disabled={Boolean(busy)}>
                      <ShieldAlert size={15} aria-hidden="true" />人工审核
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
                      <Send size={15} aria-hidden="true" />安全发送
                    </button>
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
                        <div className="wechat-channel-checks" aria-label={`${channel.label}检查项`}>
                          {channel.checks.map((check) => (
                            <span className={check.passed ? "ok" : "warn"} key={check.key} title={check.detail || check.label}>
                              {check.passed ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                              <strong>{check.label}</strong>
                              <small>{check.detail}</small>
                            </span>
                          ))}
                        </div>
                        <div className="wechat-config-entrypoints">
                          {Object.entries(channel.entrypoints).map(([key, value]) => (
                            <span key={key}>
                              <small>{wechatChannelMetricLabel(key)}</small>
                              <code>{String(value)}</code>
                            </span>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty empty-cta" role="status">
                      <strong>还没有通道配置状态</strong>
                      <span>刷新后会读取个人微信、企业微信和小程序的真实后端配置检查结果。</span>
                      <div className="empty-actions">
                        <button type="button" className="primary" onClick={() => void load()} disabled={Boolean(busy)}>
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
              {activeJob?.isHighValue ? <strong className="tag danger">高价值</strong> : <strong className="tag">低预算快审</strong>}
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
                <div className="image-strip">
                  {(activeJob.images || []).length ? (
                    activeJob.images?.map((image) => (
                      <button
                        aria-pressed={Boolean(image.selected)}
                        className={`image-tile ${image.selected ? "selected" : ""}`}
                        key={image.id}
                        onClick={() => runAction("选择候选图", () => selectDesignImage(activeJob.id, `我选第${image.position}张`, identityExpectation(activeJob)))}
                        disabled={Boolean(busy)}
                        type="button"
                      >
                        <SafeImagePreview
                          src={image.downloadUrl}
                          alt={`${image.position}号候选图`}
                          fallbackLabel={image.downloadUrl ? "图片未连接" : "等待出图"}
                          iconSize={24}
                        />
                        <span>{image.position}号图</span>
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
                          <div className="quote-actions compact">
                          <button type="button" className="ghost" onClick={() => focusOrderDraft(activeOrderDraft)} disabled={Boolean(busy)}>
                            <ReceiptText size={16} aria-hidden="true" />进入订单处理
                          </button>
                          <button type="button"
                            className="ghost"
                            onClick={() => queueOrderDraftConfirmation(activeOrderDraft)}
                            disabled={Boolean(busy) || activeOrderDraft.status === "cancelled" || hasActiveOrderConfirmationTask(activeOrderDraft)}
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
                          <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(activeOrderDraft, { paymentStatus: "deposit_paid" })} disabled={Boolean(busy)}>
                            <CreditCard size={16} aria-hidden="true" />订单定金
                          </button>
                            <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(activeOrderDraft, { paymentStatus: "paid", status: "confirmed" })} disabled={Boolean(busy)}>
                              <Check size={16} aria-hidden="true" />订单已付
                            </button>
                            <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(activeOrderDraft, { status: "processing" })} disabled={Boolean(busy)}>
                              <PackageSearch size={16} aria-hidden="true" />生产中
                            </button>
                            {renderOrderFollowupControls(activeOrderDraft, "production")}
                            {renderOrderFollowupControls(activeOrderDraft, "delivery")}
                            <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(activeOrderDraft, { status: "fulfilled" })} disabled={Boolean(busy)}>
                              <ShieldCheck size={16} aria-hidden="true" />完成
                            </button>
                            <button type="button" className="ghost danger" onClick={() => updateOrderDraftStatus(activeOrderDraft, { status: "cancelled" })} disabled={Boolean(busy)}>
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
                        <button type="button" className="ghost" onClick={() => updateQuoteDraft(activeQuote, { paymentStatus: "deposit_paid" })} disabled={Boolean(busy)}>
                          <CreditCard size={16} aria-hidden="true" />定金
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
                        <button type="button" className="ghost" onClick={() => createOrderDraft(activeQuote)} disabled={Boolean(busy)} title="按当前报价生成或更新订单草稿">
                          <ClipboardList size={16} aria-hidden="true" />{activeOrderDraft ? "更新订单" : "生成订单"}
                        </button>
                        <button type="button" className="primary" onClick={() => markPaidAndCreateOrder(activeQuote)} disabled={Boolean(busy)}>
                          <Check size={16} aria-hidden="true" />已付成单
                        </button>
                        <button type="button" className="ghost danger" onClick={() => updateQuoteDraft(activeQuote, { status: "manual_review", owner: "人工客服" })} disabled={Boolean(busy)}>
                          <ShieldAlert size={16} aria-hidden="true" />人工跟进
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="active-quote-empty">
                      <span>{activeSelectedImage ? "已选图，可以生成报价草稿。" : "先识别客户选图，再生成报价。"}</span>
                      <button type="button" className="ghost" onClick={quoteActiveJob} disabled={!activeSelectedImage || Boolean(busy)}>
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
                  <button type="button" className="ghost" onClick={retryActiveJob} disabled={!["failed", "timeout"].includes(activeJob.status) || Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />重试</button>
                  <button
                    type="button"
                    className="primary"
                    onClick={quickConfirmActiveJob}
                    disabled={Boolean(activeDesignImageSendRisk) || Boolean(busy)}
                    title={activeDesignImageSendRisk || "快速确认发送"}
                  >
                    <Check size={16} aria-hidden="true" />快速确认
                  </button>
                  <button type="button" className="ghost" onClick={quoteActiveJob} disabled={Boolean(busy)}><ClipboardList size={16} aria-hidden="true" />生成报价</button>
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
                <button type="button" className="ghost compact-button" onClick={pollAllActiveDesignResults} disabled={Boolean(busy)}>
                  <RefreshCw size={14} aria-hidden="true" />批量轮询结果
                </button>
              </div>
            </div>
            <div className="job-list">
              {jobs.length ? jobs.map((job) => (
                <button
                  aria-pressed={job.id === activeJob?.id}
                  className={`job-row ${job.status} ${job.id === activeJob?.id ? "selected" : ""}`}
                  key={job.id}
                  onClick={() => setActiveId(job.id)}
                  type="button"
                >
                  <span className={`dot ${job.isHighValue ? "danger" : ""}`} />
                  <div>
                    <strong>{job.customer?.name || "未命名客户"}</strong>
                    <small>{readableScene(job.scene, "未填写场景")} · {job.outputCount} 张候选</small>
                    {job.retryCount ? <small>已重试 {job.retryCount} 次</small> : null}
                    {job.errorMessage ? (
                      <small className="error-text" title={job.errorMessage}>
                        {operatorStatusMessage(job.errorMessage, job.errorMessage)}
                      </small>
                    ) : null}
                  </div>
                  <em>{statusLabel[job.status] || job.status}</em>
                </button>
              )) : (
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
                    待补齐 {skuRepairQueue.length} 个 · 影响自动搭配/出图 {catalogAudit?.blockingRepairCount || 0} 个
                  </span>
                </div>
                <div className="sku-repair-actions">
                  <button type="button" className="ghost compact-button" onClick={() => setSkuIssueFilter("problem")} disabled={!skuRepairQueue.length}>
                    <AlertTriangle size={14} aria-hidden="true" />只看关键问题
                  </button>
                  <button type="button" className="ghost compact-button" onClick={() => setSkuIssueFilter("missing_image")} disabled={!skuRepairQueue.length}>
                    <ImageIcon size={14} aria-hidden="true" />只看图片问题
                  </button>
                  <button type="button" className="ghost compact-button" onClick={exportSkuRepairQueue} disabled={!skuRepairQueue.length || Boolean(busy)}>
                    <Download size={14} aria-hidden="true" />导出补齐表
                  </button>
                  <button type="button" className="ghost compact-button" onClick={exportSkuCatalogIssues} disabled={!catalogAudit?.issues.length || Boolean(busy)}>
                    <Download size={14} aria-hidden="true" />导出体检明细
                  </button>
                </div>
              </div>
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
              {skuRepairQueue.length ? (
                <div className="sku-repair-list">
                  {skuRepairQueue.slice(0, 5).map((item) => (
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
                </div>
              ) : (
                <div className="sku-repair-empty">
                  <Check size={16} aria-hidden="true" />
                  <span>当前商品资料没有发现待补齐项，可以继续用于搭配和出图。</span>
                </div>
              )}
              {skuImageProblems.length ? (
                <div className="sku-image-problem-list">
                  <div className="sku-image-problem-head">
                    <div className="sku-image-problem-title">
                      <strong>图片问题清单</strong>
                      <span>定位到主图或具体多角度图</span>
                    </div>
                    <button type="button" className="ghost compact-button" onClick={exportSkuImageProblems} disabled={Boolean(busy)}>
                      <Download size={14} aria-hidden="true" />导出清单
                    </button>
                  </div>
                  {skuImageProblems.slice(0, 5).map((problem, index) => (
                    <div className={`sku-image-problem-item ${problem.severity}`} key={`${problem.skuCode}-${problem.code}-${problem.imageIndex ?? "main"}-${index}`}>
                      <div>
                        <strong>{problem.skuCode || "未编号"} · {skuImageRoleLabel(problem)}</strong>
                        <span>{problem.name || "未命名商品"}</span>
                      </div>
                      <p>{problem.message}</p>
                      <small>{problem.path || "未填写图片路径"}</small>
                      <div className="sku-image-problem-actions">
                        <button type="button" className="ghost compact-button" onClick={() => editSkuImageProblem(problem)} disabled={Boolean(busy)}>
                          <Pencil size={14} aria-hidden="true" />编辑图片
                        </button>
                        <button type="button" className="ghost danger compact-button" onClick={() => stageSkuImageProblemFix(problem)} disabled={Boolean(busy)}>
                          <X size={14} aria-hidden="true" />移除路径
                        </button>
                      </div>
                    </div>
                  ))}
                  {skuImageProblems.length > 5 ? <small>还有 {skuImageProblems.length - 5} 个图片问题，可点击“只看图片问题”继续处理。</small> : null}
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
                    <span role="cell">{sku.mainImagePath ? "有主图" : "缺主图"} · {(sku.sceneTags || []).slice(0, 2).join("、") || "缺场景"}</span>
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
                  <input value={skuForm.skuCode} onChange={(event) => setSkuForm({ ...skuForm, skuCode: event.target.value })} placeholder="BOX-001" />
                </label>
                <label className="field-control">
                  <span>商品名称</span>
                  <input value={skuForm.name} onChange={(event) => setSkuForm({ ...skuForm, name: event.target.value })} placeholder="端午茶礼盒" />
                </label>
                <div className="field-control field-control-inline">
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
                  <input value={skuForm.category} onChange={(event) => setSkuForm({ ...skuForm, category: event.target.value })} placeholder="茶叶 / 贺卡" />
                </label>
                <label className="field-control">
                  <span>售价</span>
                  <input value={skuForm.salePrice} onChange={(event) => setSkuForm({ ...skuForm, salePrice: event.target.value })} placeholder="180" inputMode="decimal" />
                </label>
                <label className="field-control">
                  <span>成本价</span>
                  <input value={skuForm.costPrice} onChange={(event) => setSkuForm({ ...skuForm, costPrice: event.target.value })} placeholder="120" inputMode="decimal" />
                </label>
                <label className="field-control">
                  <span>库存</span>
                  <input value={skuForm.stock} onChange={(event) => setSkuForm({ ...skuForm, stock: event.target.value })} placeholder="300" inputMode="numeric" />
                </label>
                <label className="field-control">
                  <span>场景标签</span>
                  <input value={skuForm.sceneTags} onChange={(event) => setSkuForm({ ...skuForm, sceneTags: event.target.value })} placeholder="端午、员工福利" />
                </label>
                <label className="field-control">
                  <span>主图路径</span>
                  <input value={skuForm.mainImagePath} onChange={(event) => setSkuForm({ ...skuForm, mainImagePath: event.target.value })} placeholder="本地路径或 URL" />
                </label>
                <label className="field-control">
                  <span>多角度图</span>
                  <input value={skuForm.angleImages} onChange={(event) => setSkuForm({ ...skuForm, angleImages: event.target.value })} placeholder="用顿号分隔" />
                </label>
                <label className="field-control">
                  <span>尺寸</span>
                  <input value={skuForm.dimensions} onChange={(event) => setSkuForm({ ...skuForm, dimensions: event.target.value })} placeholder="30*22*9" />
                </label>
                <label className="field-control">
                  <span>重量</span>
                  <input value={skuForm.weightGram} onChange={(event) => setSkuForm({ ...skuForm, weightGram: event.target.value })} placeholder="克" inputMode="numeric" />
                </label>
                <label className="field-control">
                  <span>材质</span>
                  <input value={skuForm.material} onChange={(event) => setSkuForm({ ...skuForm, material: event.target.value })} placeholder="纸盒 / 棉麻 / 金属" />
                </label>
                <label className="field-control">
                  <span>供应商</span>
                  <input value={skuForm.supplier} onChange={(event) => setSkuForm({ ...skuForm, supplier: event.target.value })} placeholder="供应商名称" />
                </label>
                <label className="field-control">
                  <span>交期</span>
                  <input value={skuForm.leadTimeDays} onChange={(event) => setSkuForm({ ...skuForm, leadTimeDays: event.target.value })} placeholder="天数" inputMode="numeric" />
                </label>
                <label className="field-control">
                  <span>替代 SKU</span>
                  <input value={skuForm.replacementSkuCodes} onChange={(event) => setSkuForm({ ...skuForm, replacementSkuCodes: event.target.value })} placeholder="用顿号分隔" />
                </label>
              </div>
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
              <label className="field-control field-control-wide">
                <span>搭配规则</span>
                <textarea
                  value={skuForm.matchingRules}
                  onChange={(event) => setSkuForm({ ...skuForm, matchingRules: event.target.value })}
                  placeholder='可写文字，也可写 JSON，例如 {"mustWith":["CARD-B"]}'
                />
              </label>
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
                        disabled={Boolean(busy)}
                      >
                        <small>错误</small>
                        <b>{lowValueAutomationIssueSummary.errors}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.warnings ? "warning" : ""}
                        onClick={() => handleAutomationIssueMetric("warnings")}
                        disabled={Boolean(busy)}
                      >
                        <small>提醒</small>
                        <b>{lowValueAutomationIssueSummary.warnings}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.missingFields ? "warning" : ""}
                        onClick={() => handleAutomationIssueMetric("missing")}
                        disabled={Boolean(busy)}
                      >
                        <small>缺字段</small>
                        <b>{lowValueAutomationIssueSummary.missingFields}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.sendTargets ? "error" : ""}
                        onClick={() => handleAutomationIssueMetric("sendTargets")}
                        disabled={Boolean(busy)}
                      >
                        <small>发送对象</small>
                        <b>{lowValueAutomationIssueSummary.sendTargets}</b>
                      </button>
                      <button
                        type="button"
                        className={lowValueAutomationIssueSummary.manualLocks ? "warning" : ""}
                        onClick={() => handleAutomationIssueMetric("manualLocks")}
                        disabled={Boolean(busy)}
                      >
                        <small>人工接管</small>
                        <b>{lowValueAutomationIssueSummary.manualLocks}</b>
                      </button>
                    </div>
                    {lowValueAutomationIssueSummary.firstIssue ? (
                      <button
                        type="button"
                        className="primary compact-button"
                        onClick={() => handleLowValueAutomationIssue(lowValueAutomationIssueSummary.firstIssue!)}
                        disabled={Boolean(busy)}
                      >
                        <Search size={14} aria-hidden="true" />处理第一个卡点
                      </button>
                    ) : null}
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
                  {lowValueAutomationIssues.map((issue) => (
                    <div className={`automation-issue-item ${issue.tone}`} key={issue.key}>
                      <div>
                        <strong>{issue.stage}</strong>
                        <span>{issue.target}</span>
                      </div>
                      <p>
                        <strong>{issue.title}</strong>
                        <span>{issue.detail || issue.reason}</span>
                      </p>
                      <div className="automation-issue-fields">
                        {issue.missing.length ? issue.missing.map((field) => <span key={field}>{lowValueMissingFieldLabel(field)}</span>) : <span>无字段缺失</span>}
                      </div>
                      <small>{issue.action}</small>
                      <button className="ghost compact-button" onClick={() => handleLowValueAutomationIssue(issue)} disabled={Boolean(busy)} type="button">
                        <Search size={14} aria-hidden="true" />定位处理
                      </button>
                    </div>
                  ))}
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
          <section className="panel" id="catalog-center">
            <div className="panel-head">
              <div>
                <h2><PackageSearch size={17} aria-hidden="true" />商品导入与搭配</h2>
                <span>下载模板或粘贴 CSV，导入后参与预算搭配</span>
              </div>
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
              <div className="catalog-actions">
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
                <button type="button" className="ghost" onClick={confirmImportSkus} disabled={Boolean(busy) || !skuImportPreview?.rows.length}>
                  <Check size={16} aria-hidden="true" />确认入库
                </button>
                <button type="button" className="ghost" onClick={recommendGiftBundle} disabled={Boolean(busy)}>
                  <PackageSearch size={16} aria-hidden="true" />按180元推荐组合
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
              ) : null}
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
                  <div className="import-preview-list">
                    {skuImportPreview.rows.slice(0, 6).map((row, index) => (
                      <div className="preview-row" key={`${row.skuCode || index}-${index}`}>
                        <strong>{row.name || "未命名商品"}</strong>
                        <span>{row.skuCode || "未编号"} · {row.category || row.type} · 售价 {formatMoney(Number(row.salePrice || 0))}</span>
                        <small>{row.mainImagePath ? "有主图" : "缺主图"} · 库存 {row.stock || 0} · {row.supplier || "缺供应商"}</small>
                      </div>
                    ))}
                    {skuImportPreview.rows.length > 6 ? <small>还有 {skuImportPreview.rows.length - 6} 个商品，确认入库时会一起保存。</small> : null}
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
                  <strong>最近商品变更</strong>
                  <span>记录库存、售价、成本、供应商和上下架变化</span>
                </div>
                {skuChangeLogs.length ? (
                  skuChangeLogs.slice(0, 6).map((log) => (
                    <div className="sku-change-item" key={log.id}>
                      <div>
                        <strong>{log.skuCode} · {log.name || "未命名商品"}</strong>
                        <span>{skuChangeActionLabel(log.action)} · {log.operator || "system"} · {formatDateTime(log.createdAt)}</span>
                      </div>
                      <p>
                        {log.changedFields.slice(0, 4).map((field) => (
                          <span key={`${log.id}-${field.field}`}>
                            {skuFieldLabel(field.field)}：{formatSkuFieldValue(field.before)} → {formatSkuFieldValue(field.after)}
                          </span>
                        ))}
                      </p>
                    </div>
                  ))
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
                      <span key={skill.id}>{skill.name}</span>
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
                      onClick={() => scrollToWorkspaceSection("training-center")}
                    >
                      <FileUp size={16} aria-hidden="true" />导入聊天记录
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setSkillSuggestionAgentFilter("all");
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

          <section className="panel" id="training-center">
            <div className="panel-head">
              <div>
                <h2><Brain size={17} aria-hidden="true" />训练中心</h2>
                <span>导入聊天记录，沉淀高情商客服样本</span>
              </div>
              <Brain size={20} aria-hidden="true" />
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
                <button type="button" className="ghost" onClick={compileTrainingSkills} disabled={Boolean(busy) || !selectedSkillSuggestionCount}>
                  <Brain size={16} aria-hidden="true" />应用已选 Skill
                </button>
              </div>
              <div className="training-overview">
                <button
                  type="button"
                  className="training-metric"
                  onClick={() => changeTrainingSampleQualityFilter("all")}
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
                  onClick={() => changeTrainingSampleQualityFilter("review")}
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
                  onClick={() => changeTrainingSampleQualityFilter("all")}
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
                      onClick={() => changeTrainingSampleQualityFilter("needs_attention")}
                      disabled={Boolean(busy)}
                    >
                      {attentionReasonLabel(reason)} {reason.count}
                    </button>
                  ))}
                </div>
              ) : null}
              {trainingOverview?.recommendations?.length ? (
                <div className="training-summary">
                  {trainingOverview.recommendations.slice(0, 2).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}
              <div className="skill-suggestion-list">
                <div className="skill-suggestion-head">
                  <div>
                    <strong>Skill 进化预览</strong>
                    <span>
                      当前 {filteredSelectedSkillSuggestionCount} / {filteredSkillSuggestions.length} 条已选，全部已选 {selectedSkillSuggestionCount} 条；
                      默认高可信 {autoSelectedSkillSuggestionCount} 条，当前需复核 {filteredNeedsReviewSkillSuggestionCount} 条
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
                    <button type="button" className="ghost compact" onClick={selectAllSkillSuggestions} disabled={Boolean(busy) || !filteredSkillSuggestions.length}>
                      全选当前
                    </button>
                    <button type="button" className="ghost compact" onClick={clearSkillSuggestions} disabled={Boolean(busy) || !filteredSelectedSkillSuggestionCount}>
                      清空当前
                    </button>
                  </div>
                </div>
                {visibleSkillSuggestions.length ? (
                  visibleSkillSuggestions.map((suggestion) => {
                    const safetyTone = skillSuggestionSafetyTone(suggestion);
                    return (
                    <div
                      aria-checked={selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion))}
                      aria-label={`选择 Skill 建议：${suggestion.name}`}
                      className={`skill-suggestion-row ${safetyTone}`}
                      key={skillSuggestionKey(suggestion)}
                      onClick={(event) => toggleSkillSuggestionFromRow(event, suggestion)}
                      onKeyDown={(event) => handleSkillSuggestionRowKeyDown(event, suggestion)}
                      role="checkbox"
                      tabIndex={0}
                      title="点击整行切换是否应用这条 Skill 建议"
                    >
                      <div className="skill-suggestion-title">
                        <label className="skill-suggestion-check">
                          <input
                            type="checkbox"
                            checked={selectedSkillSuggestionKeySet.has(skillSuggestionKey(suggestion))}
                            onChange={(event) => toggleSkillSuggestion(skillSuggestionKey(suggestion), event.target.checked)}
                            disabled={Boolean(busy)}
                          />
                          <strong>{suggestion.name}</strong>
                        </label>
                        <div className="skill-suggestion-badges">
                          <em>{skillSuggestionActionLabel(suggestion.action)}</em>
                          <span className={`skill-suggestion-safety ${safetyTone}`} title={suggestion.quality?.reason || ""}>
                            {skillSuggestionSafetyLabel(suggestion)}
                          </span>
                        </div>
                      </div>
                      <p>{suggestion.description}</p>
                      <div className="skill-suggestion-meta">
                        <span>{suggestion.scenes.slice(0, 3).join("、") || "未分类场景"}</span>
                        <span>{suggestion.sampleCount} 条样本</span>
                        <span>置信度 {suggestion.confidence}</span>
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
                    <strong>还没有 Skill 建议</strong>
                    <span>先导入聊天记录，再确认高质量样本，系统会生成可进化的 Skill。</span>
                    <div className="empty-actions">
                      <button type="button" className="primary" onClick={importChat} disabled={Boolean(busy)}>
                        <FileUp size={16} aria-hidden="true" />导入训练
                      </button>
                    </div>
                  </div>
                )}
                {filteredSkillSuggestions.length > visibleSkillSuggestions.length ? (
                  <div className="empty small" role="status">当前 Agent 还有 {filteredSkillSuggestions.length - visibleSkillSuggestions.length} 条建议未展示，可继续分批确认。</div>
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
                    当前显示 {visibleTrainingSamples.length} / {filteredTrainingSampleTotal} 条，全部 {trainingSampleTotalCount} 条
                  </span>
                  <span className="sample-selection-summary">已选 {selectedVisibleTrainingSamples.length} 条</span>
                  <div className="sample-batch-actions">
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
                      onClick={selectTrainingSamplesNeedingReview}
                      disabled={Boolean(busy) || !visibleTrainingSamples.length}
                    >
                      智能选择需处理
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
                      disabled={Boolean(busy) || !selectedVisibleTrainingSamples.length}
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
                <div className="segmented-control filter-segment sample-quality-segment" role="group" aria-label="训练样本质量筛选">
                  {trainingSampleQualityOptions.map((option) => (
                    <button
                      aria-pressed={trainingSampleQualityFilter === option.key}
                      className={trainingSampleQualityFilter === option.key ? "selected" : ""}
                      disabled={Boolean(busy)}
                      key={option.key}
                      onClick={() => changeTrainingSampleQualityFilter(option.key)}
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
                    const sceneEvidence = sampleSceneEvidence(sample);
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
                          {sceneEvidence.slice(0, 4).map((keyword) => (
                            <em key={keyword}>{keyword}</em>
                          ))}
                        </div>
                      ) : null}
                      {attentionReasons.length ? (
                        <div className="sample-attention-reasons" aria-label="训练样本需处理原因">
                          <strong>需处理</strong>
                          {attentionReasons.map((reason) => (
                            <span key={reason.code} title={attentionReasonTitle(reason)}>
                              {attentionReasonLabel(reason)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {sample.quality?.reason ? <small className="sample-quality-reason">{sample.quality.reason}</small> : null}
                      {sample.quality?.recommendedAction ? (
                        <small className="sample-quality-action">建议：{sample.quality.recommendedAction}</small>
                      ) : null}
                      {sample.reviewNote ? <small>{sample.reviewNote}</small> : null}
                      {editingSampleId === sample.id && sampleEdit ? (
                        <div className="sample-edit-panel">
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
                            <button type="button" className="primary" onClick={() => saveTrainingSampleEdit(sample, "ready")} disabled={Boolean(busy)}>
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
                  待发送 {bridgeStatus?.outbox.pendingCount ?? bridgeOutbox?.pending.length ?? 0} 个，回执待扫 {bridgeStatus?.inbox.pendingCount ?? 0} 个，账号锁 {bridgeStatus?.locks.activeCount ?? 0} 个
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
                    const taskCanBeRequeued =
                      ["blocked", "failed", "dry_run"].includes(task.status) || (task.status === "cancelled" && !taskCancelledWithAudit);
                    const sendDisabled = Boolean(busy) || task.status === "sent" || task.status === "dry_run" || taskConversationLocked;
                    const bridgeEntry = bridgeOutboxEntryForTask(task, bridgeOutbox, bridgeStatus);
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
                        <GuardChecks task={task} />
                        <SendQueueAdvice task={task} />
                        <SendRequeueAudit task={task} />
                        <SendCancelAudit task={task} />
                        <SendAttemptSummary task={task} />
                        <BridgeOutboxPreview entry={bridgeEntry} attempt={task.latestAttempt || task.attempts?.[0]} />
                        <div className="send-task-actions" data-send-view={sendWorkbenchView}>
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
              <div className="routing-actions">
                <button type="button" className="primary" onClick={evaluateCustomerRoute} disabled={Boolean(busy)}>
                  <Route size={16} aria-hidden="true" />判断谁来处理
                </button>
                <span>已评估 {routeEvaluations.length} 次</span>
              </div>
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
              {inboundSummary ? <div className="training-summary">{inboundSummary}</div> : null}
            </div>
          </section>
        </section>

        <section className="review-grid">
          <section className={`panel review-workbench review-mode-${reviewWorkbenchView}`} id="review-center">
            <div className="panel-head">
              <div>
                <h2><ShieldAlert size={17} aria-hidden="true" />人工审核中心</h2>
                <span>高价值客户、失败任务、超时任务和待审核报价统一处理</span>
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
                            {job.isHighValue ? "高价值" : "普通"}
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
                          <button type="button" className="primary" onClick={() => reviewQuoteDraft(quote, "approve_quote")} disabled={Boolean(busy)}>
                            <Check size={16} aria-hidden="true" />通过并入队
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
              </div>
              <div className="review-log-list">
                {reviewCenter.logs.slice(0, 4).map((log) => (
                  <article className="review-log-item" key={log.id}>
                    <div>
                      <strong>{reviewDecisionLabel(log.decision)}</strong>
                      <span>{reviewLogSubject(log)} · {log.reviewer || "system"} · {formatDateTime(log.createdAt)}</span>
                    </div>
                    <p>{reviewLogSummary(log)}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </section>

        <section className="quote-grid">
          <section className="panel" id="quote-center">
            <div className="panel-head">
              <div>
                <h2><ReceiptText size={17} aria-hidden="true" />报价/订单草稿</h2>
                <span>客户选图后生成报价，跟进付款和成交状态</span>
              </div>
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
                    setQuotePaymentFilter("paid");
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
              <div className="deal-next-summary" aria-label="下一步处理概览">
                {dealNextStepSummaryItems.map((item) => (
                  <button
                    type="button"
                    className={`${item.tone} ${dealNextStepFilter === item.filter ? "active" : ""}`}
                    key={item.key}
                    onClick={() => setDealNextStepFilter(item.filter)}
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
                  onClick={() => setDealNextStepFilter("all")}
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
                {renderFilterSegment("订单状态", orderStatusOptions, orderStatusFilter, setOrderStatusFilter)}
                {renderFilterSegment("订单付款", paymentStatusOptions, orderPaymentFilter, setOrderPaymentFilter)}
                {renderFilterSegment("下一步", dealNextStepFilterOptions, dealNextStepFilter, setDealNextStepFilter)}
              </div>
              <div className="quote-section-head">
                <strong>报价列表</strong>
                <span>显示 {filteredQuotes.length} / {quotes.length} 个</span>
              </div>
              <div className="quote-list">
                {filteredQuotes.length ? (
                  filteredQuotes.map((quote) => {
                    const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
                    const selectedImage = quoteSelectedImage(quote);
                    const rowPreview = quoteCenterPreviewId === quote.id ? quoteCenterPreview : null;
                    const rowPreviewWarnings = rowPreview?.warnings || [];
                    const rowSendRisk = quoteSendBlockReason(quote, rowPreviewWarnings);
                    const nextStep = quoteDealNextStep(quote, orderDraft, rowSendRisk);
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
                          <SelectedImageThumb image={selectedImage} label="报价选图" />
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
                        <span>利润率 {Math.round(Number(quote.profitRate || 0) * 100)}%</span>
                        {quote.owner ? <span>跟进人 {quote.owner}</span> : null}
                        {quote.sendTask ? <span>发送{sendStatusLabel(quote.sendTask.status)}</span> : null}
                        {quote.sendTaskId && !quote.sendTask ? <span>任务 {quote.sendTaskId}</span> : null}
                        {orderDraft ? <span>订单 {orderStatusLabel(orderDraft.status)}</span> : null}
                        {orderDraft?.confirmationSendTask ? <span>确认{sendStatusLabel(orderDraft.confirmationSendTask.status)}</span> : null}
                        {orderDraft ? orderFollowupStatusItems(orderDraft).map((item) => <span key={item.key}>{item.label}</span>) : null}
                        {rowSendRisk && !quote.sendTaskId ? <span>发送检查 {rowSendRisk}</span> : null}
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
                        <button type="button" className="ghost" onClick={() => updateQuoteDraft(quote, { paymentStatus: "deposit_paid" })} disabled={Boolean(busy)}>
                          <CreditCard size={16} aria-hidden="true" />定金
                        </button>
                        {orderDraft ? (
                          <button type="button" className="ghost" onClick={() => focusOrderDraft(orderDraft)} disabled={Boolean(busy)} title="只显示这条报价和对应订单">
                            <ReceiptText size={16} aria-hidden="true" />定位订单
                          </button>
                        ) : null}
                        <button type="button" className="ghost" onClick={() => createOrderDraft(quote)} disabled={Boolean(busy)} title="按当前报价生成或更新订单草稿">
                          <ClipboardList size={16} aria-hidden="true" />{orderDraft ? "更新订单" : "生成订单"}
                        </button>
                        <button type="button" className="primary" onClick={() => markPaidAndCreateOrder(quote)} disabled={Boolean(busy)}>
                          <Check size={16} aria-hidden="true" />已付成单
                        </button>
                        <button type="button" className="ghost danger" onClick={() => updateQuoteDraft(quote, { status: "manual_review", owner: "人工客服" })} disabled={Boolean(busy)}>
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
                  <em>{filteredOrderDrafts.length} / {orderDrafts.length} 个</em>
                </div>
                <div className="order-list">
                  {filteredOrderDrafts.length ? (
                    filteredOrderDrafts.map((order) => {
                      const selectedImage = orderSelectedImage(order);
                      const nextStep = orderDealNextStep(order);
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
                            <SelectedImageThumb image={selectedImage} label="订单选图" />
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
                          <span>{paymentStatusLabel(order.paymentStatus)}</span>
                          {order.confirmationSendTask ? <span>确认{sendStatusLabel(order.confirmationSendTask.status)}</span> : null}
                          {orderFollowupStatusItems(order).map((item) => <span key={item.key}>{item.label}</span>)}
                          <span>报价 {order.quoteDraftId}</span>
                          {order.owner ? <span>跟进人 {order.owner}</span> : null}
                          <span>{formatDateTime(order.updatedAt)}</span>
                        </div>
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
                        <div className="quote-actions compact">
                          <button type="button" className="ghost" onClick={() => focusOrderDraft(order)} disabled={Boolean(busy)} title="只显示这条订单和对应报价">
                            <ReceiptText size={16} aria-hidden="true" />查看报价
                          </button>
                          <button type="button"
                            className="ghost"
                            onClick={() => queueOrderDraftConfirmation(order)}
                            disabled={Boolean(busy) || order.status === "cancelled" || hasActiveOrderConfirmationTask(order)}
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
                          <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(order, { paymentStatus: "deposit_paid" })} disabled={Boolean(busy)}>
                            <CreditCard size={16} aria-hidden="true" />定金
                          </button>
                          <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(order, { paymentStatus: "paid", status: "confirmed" })} disabled={Boolean(busy)}>
                            <Check size={16} aria-hidden="true" />已付
                          </button>
                          <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(order, { status: "processing" })} disabled={Boolean(busy)}>
                            <PackageSearch size={16} aria-hidden="true" />生产中
                          </button>
                          {renderOrderFollowupControls(order, "production")}
                          {renderOrderFollowupControls(order, "delivery")}
                          <button type="button" className="ghost" onClick={() => updateOrderDraftStatus(order, { status: "fulfilled" })} disabled={Boolean(busy)}>
                            <ShieldCheck size={16} aria-hidden="true" />完成
                          </button>
                          <button type="button" className="ghost danger" onClick={() => updateOrderDraftStatus(order, { status: "cancelled" })} disabled={Boolean(busy)}>
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
  const tone = preflight ? (errors.length ? "error" : warnings.length ? "warning" : "ok") : readinessMissing.length ? "warning" : "idle";
  const platformText = platformHealth?.ok
    ? `${designPlatformAdapterLabel(platformHealth.adapter)} ${platformHealth.latencyMs}ms`
    : "未连接";
  const compactRequestId = formatCompactRequestId(job.requestId);

  return (
    <div className={`preflight-panel ${tone}`}>
      <div className="preflight-head">
        <div>
          <strong>{preflight ? (preflight.ok ? "出图预检通过" : "出图预检未通过") : "出图提交前预检"}</strong>
          <span title={`任务 ${job.requestId}`}>
            任务 {compactRequestId} · {job.isHighValue ? "高价值人工审核" : "普通客户快速确认"}
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
        <span>图片/素材：{preflight?.usableReferenceCount ?? referenceCount}</span>
        <span>本地可发：{localImageCount}/{totalImages}</span>
        {remoteOnlyImageCount ? <span>待本地保存：{remoteOnlyImageCount}</span> : null}
        {preflight ? <span>不可用引用：{preflight.unusableReferenceCount}</span> : null}
      </div>
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
  return Boolean(target.quoteDraftId || target.designJobId || target.conversationId);
}

function noticeTargetSummary(notice: NotificationItem) {
  const target = notice.target || {};
  const parts: string[] = [];
  const reason = String(target.reason || "");
  if (reason) parts.push(inboundSelectionReasonLabel(reason));
  if (target.quoteDraftId) parts.push(`报价 ${target.quoteDraftId}`);
  if (target.designJobId) parts.push(`设计任务 ${target.designJobId}`);
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

function SendAttemptSummary({ task }: { task: SendTask }) {
  const attempt = task.latestAttempt || task.attempts?.[0];
  if (!attempt) {
    return <small className="guard-empty">尚未执行发送尝试</small>;
  }
  return (
    <div className={`attempt-summary ${attempt.status}`}>
      <span>{sendAttemptStatusLabel(attempt.status)}</span>
      <small>
        {sendAdapterName(attempt.adapter)} · {sendPayloadKindLabel(attempt.payloadSummary?.kind)} · 文本 {attempt.payloadSummary?.textLength || 0} 字 · 图片 {attempt.payloadSummary?.imageCount || 0} 张
      </small>
      {attempt.errorMessage ? (
        <small title={attempt.errorMessage}>{operatorStatusMessage(attempt.errorMessage, attempt.errorMessage)}</small>
      ) : null}
    </div>
  );
}

function BridgeOutboxPreview({
  entry,
  attempt,
}: {
  entry?: BridgeOutboxEntry | null;
  attempt?: SendAttempt | null;
}) {
  const preview = entry?.preview;
  const outboxFile = preview?.outboxFileName || entry?.fileName || sendAttemptOutboxFileName(attempt);
  if (!outboxFile && attempt?.adapter !== "windows_bridge") return null;

  return (
    <div className="bridge-preview">
      <div className="bridge-preview-head">
        <strong>桥接发送确认</strong>
        <span title={outboxFile || undefined}>{outboxFile ? "桥接文件已生成" : "等待桥接文件"}</span>
      </div>
      <small>
        账号 {preview?.wechatAccountId || entry?.wechatAccountId || "-"} · 会话 {preview?.conversationId || entry?.conversationId || "-"}
      </small>
      <small>
        动作 {preview?.actionCount ?? entry?.actionCount ?? 0} 个 · 文字 {preview?.textActionCount ?? 0} 段/{preview?.textLength ?? 0} 字 · 图片{" "}
        {preview?.imageActionCount ?? 0} 张
      </small>
      <small>
        窗口快照 {preview?.windowSnapshotId || attempt?.windowSnapshotId || "-"} · 守卫 {preview?.guardStatus || attempt?.guardStatus || "-"}
      </small>
      <small>协议 {preview?.protocolVersion || "-"}</small>
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
  if (!hasActiveOrderConfirmationTask(order)) return "发送确认";
  return order.confirmationSendTask?.status === "sent" ? "确认已发" : "确认已入队";
}

function orderConfirmationButtonTitle(order: OrderDraft) {
  if (order.status === "cancelled") return "订单已取消，不能发送确认";
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
  firstIssue?: LowValueAutomationIssue;
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
    { key: "pollActiveResults", label: "出图轮询", detail: describePollActiveStep },
    { key: "lowValueAutomation", label: "低价值主链路", detail: describeLowValueAutomationStep },
    { key: "scanTimeouts", label: "超时扫描", detail: describeCountStep("timedOut", "超时") },
    { key: "scanSendOperations", label: "发送回执", detail: describeSendOpsStep },
    { key: "processLowValueSendQueue", label: "安全发送队列", detail: describeSafeSendQueueStep },
    { key: "scanLowValueOrderDrafts", label: "订单草稿", detail: describeOrderDraftStep },
    { key: "scanLowValueOrderConfirmations", label: "订单确认", detail: describeQueuedStep },
    { key: "scanLowValueOrderFollowups", label: "订单跟进", detail: describeQueuedStep },
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
  const tone = failedSteps.length ? "error" : slowestStep.durationMs >= 3000 ? "warning" : "ok";
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
  const row = result as { scanned?: number; fixed?: unknown[]; timedOut?: unknown[]; failed?: unknown[] } | undefined;
  if (!row) return "已检查";
  return `扫描 ${row.scanned || 0}，修复 ${(row.fixed || []).length}，超时 ${(row.timedOut || []).length}，失败 ${(row.failed || []).length}`;
}

function describeSafeSendQueueStep(result: unknown) {
  const row = result as SafeSendQueueResult | undefined;
  if (!row) return "已检查";
  return `处理 ${row.processed?.length || 0}，拦截 ${row.blocked?.length || 0}，失败 ${row.failed?.length || 0}`;
}

function describeOrderDraftStep(result: unknown) {
  const row = result as LowValueOrderDraftResult | undefined;
  if (!row) return "已检查";
  return `创建 ${row.created?.length || 0}，跳过 ${row.skipped?.length || 0}，失败 ${row.failed?.length || 0}`;
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
      { label: "确认/跟进", value: confirmationQueued + followupQueued },
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
  return {
    total: issues.length,
    errors: issues.filter((issue) => issue.tone === "error").length,
    warnings: issues.filter((issue) => issue.tone === "warning").length,
    missingFields: missingFields.size,
    manualLocks: issues.filter((issue) => issue.reason === "conversation_manual_locked" || issue.missing.includes("manualLocked")).length,
    sendTargets: issues.filter((issue) => issue.reason.includes("send_target") || issue.missing.includes("wechatAccountId") || issue.missing.includes("conversationId")).length,
    firstIssue: issues.find((issue) => issue.tone === "error") || issues[0],
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
  return issues.filter((issue) => {
    const key = `${issue.stage}:${issue.target}:${issue.reason}:${issue.detail || ""}:${issue.missing.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
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
    conversation_manual_locked: "如果人工问题已处理完，再解除会话人工锁；否则继续人工跟进。",
    missing_send_target: "补齐微信账号和客户会话，发送前必须能定位到正确聊天窗口。",
    missing_order_target: "给报价/订单补齐微信账号和客户会话，再重新跑低价值自动处理。",
    payment_not_ready: "确认已收定金或全款后，把订单付款状态标记为定金/已付。",
  };
  return actions[reason] || "查看设计任务、报价、订单和发送队列，确认后手动处理或转人工。";
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
  return filter === "all" ? undefined : filter;
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
    needs_attention: summary.needsAttentionSamples ?? fallbackCount,
    anti_wrong_reply: summary.antiWrongReplySamples,
    route_memory: summary.routeMemorySamples ?? fallbackCount,
    reply_skill: summary.replySkillSamples ?? fallbackCount,
    route_and_reply: summary.routeAndReplySamples ?? fallbackCount,
  };
  return totals[filter] ?? fallbackCount;
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

function matchesTrainingSampleQualityFilter(sample: TrainingSample, filter: TrainingSampleQualityFilter) {
  if (filter === "all") return true;
  if (filter === "trainable") return sample.quality?.trainable === true;
  if (filter === "not_trainable") return sample.quality?.trainable === false;
  if (filter === "route_memory") return sample.quality?.usage?.routeMemory === true;
  if (filter === "reply_skill") return sample.quality?.usage?.replySkill === true;
  if (filter === "route_and_reply") {
    return sample.quality?.usage?.routeMemory === true && sample.quality?.usage?.replySkill === true;
  }
  if (filter === "needs_attention") return isTrainingSampleNeedingManualReview(sample);
  if (filter === "anti_wrong_reply") return isAntiWrongReplyTrainingSample(sample);
  if (filter === "review") return sampleQualityTone(sample) === "review" && !isAntiWrongReplyTrainingSample(sample);
  return sampleQualityTone(sample) === filter;
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

function trainingSampleBatchNoopMessage(status: "ready" | "review" | "rejected", scope: "selected" | "visible") {
  const scopeLabel = scope === "selected" ? "已选样本" : "当前显示的样本";
  if (status === "ready") return `${scopeLabel}已经都是可训练状态。`;
  if (status === "rejected") return `${scopeLabel}已经都是禁用状态。`;
  return `${scopeLabel}已经都是待复核状态。`;
}

function trainingSampleBatchReviewNote(status: "ready" | "review" | "rejected", scopeLabel: string) {
  if (status === "ready") return `按${scopeLabel}批量确认进入训练。`;
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
    needs_config: "待配置",
  };
  return labels[status] || status;
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
    request_followup: "继续跟进",
    reject_quote: "驳回报价",
    manual_lock: "人工接管",
    manual_release: "解除接管",
    manual_approve_send: "人工批准发图",
    manual_approve_quote: "人工批准报价",
  };
  return labels[decision] || decision;
}

function reviewLogSubject(log: ReviewLog) {
  const metadata = log.metadata || {};
  if (log.targetType === "conversation") {
    return `会话 ${String(metadata.conversationTitle || metadata.conversationId || log.targetId)}`;
  }
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
  if (log.beforeStatus || log.afterStatus) parts.push(`${reviewStatusLabel(log.beforeStatus)} → ${reviewStatusLabel(log.afterStatus)}`);
  return parts.join("；") || "已记录审核操作。";
}

function reviewTargetLabel(targetType: string) {
  const labels: Record<string, string> = {
    conversation: "客户会话",
    design_job: "设计任务",
    quote: "报价",
    quote_draft: "报价",
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
  };
  return labels[reason] || reason;
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
  return (
    <div className={`route-result ${route.action}`}>
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
      <div className="suggested-reply">
        <small>建议回复</small>
        <p>{route.suggestedReply}</p>
      </div>
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
      {route.appliedSkills?.length ? (
        <div className="route-evidence">
          <small>命中的 Skill</small>
          <div className="route-evidence-tags">
            {route.appliedSkills.slice(0, 5).map((skill) => (
              <span key={skill.id || skill.name}>
                {skill.name}
                {skill.sampleCount ? ` · ${skill.sampleCount} 样本` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {route.knowledgeMatches?.length ? (
        <div className="route-evidence">
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
  image,
  label,
}: {
  image?: NonNullable<DesignJob["images"]>[number] | null;
  label: string;
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  useEffect(() => {
    setImageLoadFailed(false);
  }, [image?.downloadUrl]);
  const title = image ? `${label}：第 ${image.position || "-"} 张` : `${label}：未选图`;
  const canShowImage = Boolean(image?.downloadUrl && !imageLoadFailed && !isStaleLocalDesignFileUrl(image.downloadUrl));
  return (
    <div className={`selected-image-thumb ${canShowImage ? "" : "empty"}`} title={title} aria-label={title}>
      {canShowImage ? (
        <img src={image?.downloadUrl} alt={title} onError={() => setImageLoadFailed(true)} />
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

function orderSelectedImage(order: OrderDraft) {
  return (
    order.selectedImage ||
    order.quoteDraft?.selectedImage ||
    order.designJob?.images?.find((image) =>
      [image.id, image.imageId].includes(String(order.selectedImageId || "")) || image.selected,
    ) ||
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
  const paid = ["deposit_paid", "paid"].includes(order?.paymentStatus || quote.paymentStatus);
  const fullyPaid = (order?.paymentStatus || quote.paymentStatus) === "paid";
  const orderCreated = Boolean(order?.id);
  const processing = ["processing", "fulfilled"].includes(order?.status || "");
  const fulfilled = order?.status === "fulfilled";
  const cancelled = order?.status === "cancelled" || quote.status === "cancelled" || quote.status === "rejected";
  const rawSteps = [
    { key: "quote", label: quoteSent ? "报价已发" : "报价草稿", done: quoteSent || orderCreated, current: !quoteSent && !orderCreated },
    { key: "confirm", label: quote.status === "accepted" || orderCreated ? "客户已确认" : "等客户确认", done: quote.status === "accepted" || orderCreated, current: quoteSent && quote.status !== "accepted" && !orderCreated },
    { key: "payment", label: fullyPaid ? "已付款" : paid ? "已收定金" : "待收款", done: paid, current: (quote.status === "accepted" || orderCreated) && !paid },
    { key: "order", label: orderCreated ? "订单已建" : "待建订单", done: orderCreated, current: paid && !orderCreated },
    { key: "production", label: processing ? "生产处理中" : "待排产", done: processing, current: orderCreated && !processing && !cancelled },
    { key: "finish", label: fulfilled ? "已完成" : cancelled ? "已终止" : "待完成", done: fulfilled, current: cancelled },
  ];
  return rawSteps.map((step, index) => ({
    ...step,
    index: index + 1,
    state: cancelled && step.key !== "finish" ? "blocked" : step.done ? "done" : step.current ? "current" : "todo",
  }));
}

function quoteDealNextStep(quote: QuoteDraft, order: OrderDraft | null, sendRisk = "") {
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
    return { tone: "blue", label: "下一步：客户确认成单", detail: "客户明确回复确认、要这个、可以做后，点击这里生成订单草稿。", action: "confirm_quote_create_order" };
  }
  if (!order) {
    return { tone: "green", label: "下一步：生成订单", detail: "客户已经确认报价，可以生成订单草稿并进入收款/排产。", action: "create_order" };
  }
  if (!["deposit_paid", "paid"].includes(order.paymentStatus || quote.paymentStatus)) {
    return { tone: "blue", label: "下一步：收款", detail: "订单已建，继续跟进定金或全款。", action: "none" };
  }
  return { tone: "green", label: "订单已衔接", detail: "报价已经进入订单链路，后续在订单草稿里处理确认、生产和交付。", action: "none" };
}

function orderDealNextStep(order: OrderDraft) {
  if (order.status === "cancelled") {
    return { tone: "red", label: "已取消", detail: "这条订单已终止，不再发送确认或跟进。", action: "none" };
  }
  if (isHighValueOrder(order)) {
    return { tone: "amber", label: "人工处理", detail: "高价值订单需要人工确认收款、交付和客户承诺。", action: "none" };
  }
  if (!hasActiveOrderConfirmationTask(order)) {
    return { tone: "blue", label: "下一步：发订单确认", detail: "把订单明细放入微信安全发送队列，让客户确认数量、金额和效果图。", action: "queue_order_confirmation" };
  }
  if (order.confirmationSendTask?.status === "queued" || order.confirmationSendTask?.status === "sending") {
    return { tone: "blue", label: "等待确认发送", detail: "订单确认已入队，等待微信账号窗口校验后发送。", action: "none" };
  }
  if (!["deposit_paid", "paid"].includes(order.paymentStatus)) {
    return { tone: "blue", label: "下一步：收款", detail: "确认已发，继续跟进定金或全款。", action: "none" };
  }
  if (order.status === "draft" || order.status === "confirmed") {
    return { tone: "green", label: "下一步：排产", detail: "客户已付款，可以标记生产中并发送生产通知。", action: "start_production" };
  }
  if (order.status === "processing") {
    return { tone: "green", label: "下一步：交付", detail: "生产处理中，准备交期说明或完成订单。", action: "send_delivery_followup" };
  }
  return { tone: "green", label: "已完成", detail: "订单流程已完成，保留报价、选图和发送记录方便复盘。", action: "none" };
}

function matchesDealNextStepFilter(step: { action: string }, filter: string, status: string) {
  if (filter === "actionable") return step.action !== "none";
  if (filter === "blocked") return step.action === "none" && !["fulfilled", "cancelled", "rejected"].includes(status);
  return true;
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

function quoteSendBlockReason(quote: QuoteDraft, previewWarnings: string[] = []) {
  const warnings = previewWarnings.length ? previewWarnings.map(quoteWarningLabel) : [];
  const designJob = quote.designJob as
    | (QuoteDraft["designJob"] & { wechatAccountId?: string | null; conversationId?: string | null })
    | undefined;
  if (!warnings.length) {
    if (quote.sendTaskId) warnings.push("已进入发送队列");
    if (!quote.selectedImageId) warnings.push("还没有选图");
    if (quote.status === "manual_review") warnings.push("正在等待人工审核");
    if (Number(quote.profit || 0) < 0) warnings.push("利润为负，需要人工确认");
    if (!designJob?.wechatAccountId || !designJob?.conversationId) warnings.push("缺少微信账号或客户会话");
  }
  return warnings.join("；");
}

function isHighValueQuote(quote: QuoteDraft) {
  return quote.designJob?.isHighValue === true;
}

function isHighValueOrder(order: OrderDraft) {
  return order.designJob?.isHighValue === true || order.quoteDraft?.designJob?.isHighValue === true;
}

function dedupeOrdersById(orders: OrderDraft[]) {
  const seen = new Set<string>();
  return orders.filter((order) => {
    if (seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
}

function quoteWarningLabel(warning: string) {
  const labels: Record<string, string> = {
    "preview failed": "报价预览生成失败",
    "quote already has a send task": "已进入发送队列",
    "quote has no selected image": "还没有选图",
    "quote design job has no wechat account": "缺少微信账号",
    "quote design job has no conversation": "缺少客户会话",
    "quote is waiting for manual review": "正在等待人工审核",
    "quote profit is negative": "利润为负，需要人工确认",
  };
  return labels[warning] || warning;
}
