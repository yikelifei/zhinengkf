"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AutomationRun,
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
  Route,
  PackageSearch,
  Pencil,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";
import {
  Agent,
  applySkillSuggestions,
  AutomationStatus,
  autoProcessLowValue,
  attachDesignJobAssets,
  autoSubmitDesignDrafts,
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
  getWechatConversations,
  getWechatWindowSnapshots,
  getWindowObserverStatus,
  importChatTranscript,
  localAssetUrl,
  markAllNotificationsRead,
  markNotificationRead,
  markManualReview,
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
  requeueSendTask,
  requestDesignRevision,
  reviewDesignJob,
  reviewTrainingSample,
  ReviewCenter,
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
  submitDesignJob,
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
  WechatWindowSnapshot,
  WindowObserverStatus,
} from "../lib/api";

const WINDOW_SNAPSHOT_MAX_AGE_SECONDS = 30;
const AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES = 2;
const AUTO_SELECT_SKILL_SUGGESTION_MIN_CONFIDENCE = 80;

function isSkillSuggestionAutoSelected(suggestion: SkillSuggestion) {
  if (suggestion.quality) return !suggestion.quality.needsReview;
  return (
    Number(suggestion.sampleCount || 0) >= AUTO_SELECT_SKILL_SUGGESTION_MIN_SAMPLES &&
    Number(suggestion.confidence || 0) >= AUTO_SELECT_SKILL_SUGGESTION_MIN_CONFIDENCE
  );
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
  { value: "problem", label: "有问题" },
  { value: "missing_image", label: "图片问题" },
  { value: "low_stock", label: "库存异常" },
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

const workspaceNavItems = [
  { id: "asset-center", label: "素材", Icon: FileUp },
  { id: "conversation-center", label: "消息", Icon: MessageCircle },
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

type DesignPlatformConfigForm = {
  adapter: "art_image_local" | "standard_v1";
  baseUrl: string;
  accessToken: string;
  cookie: string;
  deviceId: string;
};

type TrainingSampleEdit = {
  agentKey: string;
  scene: string;
  customerText: string;
  idealReply: string;
  score: string;
  skillHints: string;
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

const emptyDesignPlatformConfigForm: DesignPlatformConfigForm = {
  adapter: "art_image_local",
  baseUrl: "http://127.0.0.1:3000",
  accessToken: "",
  cookie: "",
  deviceId: "",
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

export default function HomePage() {
  const [jobs, setJobs] = useState<DesignJob[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [catalogAudit, setCatalogAudit] = useState<SkuCatalogAudit | null>(null);
  const [skuChangeLogs, setSkuChangeLogs] = useState<SkuChangeLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chatImports, setChatImports] = useState<ChatImport[]>([]);
  const [trainingSamples, setTrainingSamples] = useState<TrainingSample[]>([]);
  const [trainingOverview, setTrainingOverview] = useState<TrainingOverview | null>(null);
  const [skillSuggestions, setSkillSuggestions] = useState<SkillSuggestion[]>([]);
  const [selectedSkillSuggestionKeys, setSelectedSkillSuggestionKeys] = useState<string[]>([]);
  const [skillSuggestionAgentFilter, setSkillSuggestionAgentFilter] = useState<string>("all");
  const [skillApplySummary, setSkillApplySummary] = useState<string>("");
  const [editingSampleId, setEditingSampleId] = useState<string>("");
  const [sampleEdit, setSampleEdit] = useState<TrainingSampleEdit | null>(null);
  const [wechatAccounts, setWechatAccounts] = useState<WechatAccount[]>([]);
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
  const [preflightResult, setPreflightResult] = useState<DesignJobPreflightResult | null>(null);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState<string>("本地演示模式：先创建任务，再提交出图，约 3 秒后刷新候选图。");
  const [chatText, setChatText] = useState<string>(`客户：我想做端午礼盒，每盒预算180，能先看效果图吗？
客服：可以的，我先按员工福利场景给您搭一套礼盒，再出几张真实摆拍效果图给您挑。
客户：快递一直不动怎么办？
客服：我帮您查一下物流状态，如果确实停滞会同步安排催件或补发方案。`);
  const [routeText, setRouteText] = useState<string>("端午员工福利礼盒，每盒180元，做50份，想看真实摆拍效果图，logo已发");
  const [inboundSummary, setInboundSummary] = useState<string>("");
  const [selectionText, setSelectionText] = useState<string>("我选第1张");
  const [revisionText, setRevisionText] = useState<string>("把Logo放大一点，背景换成更清爽的浅色，礼盒整体摆放更高级");
  const [skuSearch, setSkuSearch] = useState<string>("");
  const [skuTypeFilter, setSkuTypeFilter] = useState<string>("all");
  const [skuIssueFilter, setSkuIssueFilter] = useState<string>("all");
  const [skuForm, setSkuForm] = useState<SkuForm>(emptySkuForm);
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
  const [activeWorkspaceSection, setActiveWorkspaceSection] = useState<string>("design-center");
  const [skuImportText, setSkuImportText] = useState<string>(`SKU编号\t商品名称\t商品类型\t分类\t成本价\t售价\t库存\t场景标签\t主图\t多角度图\t尺寸\t重量g\t材质\t供应商\t交期天数\t替代SKU\t搭配规则
BOX-B\t雅黑礼盒B\t礼盒\t礼盒\t40\t80\t20\t员工福利、客户拜访\tC:\\products\\box-b-main.jpg\tC:\\products\\box-b-side.jpg、C:\\products\\box-b-open.jpg\t30*22*9\t650\t特种纸\t杭州礼盒厂\t5\tBOX-A\t{"preferWith":["TEA-C","CARD-B"]}
TEA-C\t乌龙茶C\t内搭\t茶叶\t55\t120\t15\t员工福利\tC:\\products\\tea-c-main.jpg\tC:\\products\\tea-c-detail.jpg\t12*8*18\t300\t茶叶\t福建茶业供应商\t3\t\t适合与礼盒和感谢卡搭配
CARD-B\t感谢卡B\t配件\t贺卡\t3\t12\t200\t客户拜访\tC:\\products\\card-b-main.jpg\t\t10*15\t20\t纸张\t本地印刷厂\t2\t\t{"mustWith":["BOX-B"]}`);
  const [skuImportFields, setSkuImportFields] = useState<SkuImportField[]>([]);
  const [skuImportPreview, setSkuImportPreview] = useState<SkuImportResult | null>(null);
  const [bundleResult, setBundleResult] = useState<{
    status: string;
    items: Array<Record<string, unknown>>;
    totals: { cost: number; salePrice: number; profit: number; profitRate: number };
    warnings: string[];
  } | null>(null);

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

  async function load() {
    const [jobRows, skuRows, auditRows, skuLogRows, agentRows, importRows, sampleRows, overviewRows, suggestionRows, accountRows, conversationRows, sendRows, attemptRows, adapterInfo, bridgeRows, bridgeStatusRows, windowRows, windowObserverRows, routeRows, quoteRows, orderRows, noticeRows, reviewRows, health, readiness, configResult, automation] = await Promise.all([
      getDesignJobs(),
      getSkus(includeInactiveSkus),
      getSkuCatalogAudit(),
      getSkuChangeLogs(30),
      getAgents(),
      getChatImports(),
      getTrainingSamples(),
      getTrainingOverview(),
      getSkillSuggestions(),
      getWechatAccounts(),
      getWechatConversations(),
      getSendTasks(),
      getSendAttempts(),
      getSendAdapter(),
      getBridgeOutbox().catch(() => ({ outboxDir: "", pending: [], ignored: [] })),
      getBridgeStatus().catch(() => ({
        adapter: {
          name: "windows_bridge",
          label: "Windows 微信桥接适配器",
          realSend: true,
          description: "桥接状态暂不可用。",
        },
        worker: { ok: false, status: "unavailable", message: "桥接状态接口不可用" },
        outbox: { outboxDir: "", pendingCount: 0, ignoredCount: 0, pending: [] },
        inbox: { inboxDir: "", pendingCount: 0, pending: [] },
        locks: { lockDir: "", activeCount: 0, staleCount: 0, active: [] },
      })),
      getWechatWindowSnapshots(),
      getWindowObserverStatus().catch(() => ({
        ok: false,
        status: "unavailable",
        ageSeconds: null,
        message: "窗口观察器状态接口不可用",
      })),
      getRouteEvaluations(),
      getQuotes(),
      getOrderDrafts(),
      getNotifications(false),
      getReviewCenter(),
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
    ]);
    setJobs(jobRows);
    setSkus(skuRows);
    setCatalogAudit(auditRows);
    setSkuChangeLogs(skuLogRows);
    setAgents(agentRows);
    setChatImports(importRows);
    setTrainingSamples(sampleRows);
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
    setActiveId((current) => current || jobRows[0]?.id || "");
    setActiveConversationId((current) =>
      current && conversationRows.some((conversation) => conversation.id === current) ? current : "",
    );
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
    await runAction("绑定素材到任务", () => attachDesignJobAssets(activeJob.id, selectedAssetIds));
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
          errors: [],
          results: { lowValueAutomation: result },
        };
      },
      () => {
        if (diagnosticRun) {
          setAutomationStatus((current) => current ? { ...current, lastRun: diagnosticRun } : current);
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
        setAutomationStatus((current) => current ? { ...current, lastRun: result, runCount: current.runCount + 1 } : current);
      },
      () => {
        setMessage(summary || "后台自动化已跑完一轮。");
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
    await runAction("标记提醒已读", () => markNotificationRead(notice.id));
  }

  async function readAllNotices() {
    await runAction("全部提醒已读", () => markAllNotificationsRead());
  }

  async function preflightActiveJob() {
    if (!activeJob) return;
    await runAction("出图预检", async () => {
      const result = await preflightDesignJob(activeJob.id);
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
    await runAction("提交出图", () => submitDesignJob(activeJob.id), () => {
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
        const result = await selectDesignImage(activeJob.id, selectionText.trim()) as {
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
    await runAction("模拟客户选图", () => selectDesignImage(activeJob.id, "我选第1张"));
  }

  async function selectByReference() {
    if (!activeJob?.images?.length) return;
    const target = activeJob.images.find((image) => image.selected) || activeJob.images[0];
    await runAction("引用图片选图", () => selectDesignImage(activeJob.id, { referencedImageId: target.id }));
  }

  async function selectByScreenshot() {
    if (!activeJob?.images?.length) return;
    const target = activeJob.images.find((image) => image.selected) || activeJob.images[0];
    await runAction("截图匹配选图", () =>
      selectDesignImage(activeJob.id, { screenshotFingerprint: target.fingerprint || "" }),
    );
  }

  async function selectByUnclearScreenshot() {
    if (!activeJob) return;
    await runAction("截图不确定转人工", () =>
      selectDesignImage(activeJob.id, { screenshotFingerprint: "00000000000000000000000000000000" }),
    );
  }

  async function quickConfirmActiveJob() {
    if (!activeJob) return;
    await runAction("快速确认发送", () => quickConfirmSend(activeJob.id));
  }

  async function quoteActiveJob() {
    if (!activeJob) return;
    await runAction("生成报价", () => createQuote(activeJob.id));
  }

  async function manualReviewActiveJob() {
    if (!activeJob) return;
    await runAction("转人工", () => markManualReview(activeJob.id));
  }

  async function pollActiveJob() {
    if (!activeJob) return;
    await runAction("轮询设计结果", async () => {
      const result = await pollDesignJob(activeJob.id);
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
    await runAction("重试设计任务", () => retryDesignJob(activeJob.id));
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
        instruction: revisionText,
        sourceText: revisionText,
        selectedImageId: selectedImage?.id,
      }),
    );
  }

  async function cancelActiveJob() {
    if (!activeJob) return;
    await runAction("取消设计任务", () => cancelDesignJob(activeJob.id));
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

  function selectAllSkillSuggestions() {
    const keys = filteredSkillSuggestions.map(skillSuggestionKey);
    setSelectedSkillSuggestionKeys((current) => [...new Set([...current, ...keys])]);
  }

  function clearSkillSuggestions() {
    const keys = new Set(filteredSkillSuggestions.map(skillSuggestionKey));
    setSelectedSkillSuggestionKeys((current) => current.filter((key) => !keys.has(key)));
  }

  async function updateTrainingSampleStatus(sample: TrainingSample, status: "ready" | "review" | "rejected") {
    const label = status === "ready" ? "确认训练样本" : status === "rejected" ? "禁用训练样本" : "退回复核样本";
    await runAction(label, () =>
      reviewTrainingSample(sample.id, {
        status,
        reviewer: "人工客服",
        note: sampleReviewNote(status),
      }),
    );
  }

  function startSampleEdit(sample: TrainingSample) {
    setEditingSampleId(sample.id);
    setSampleEdit(sampleToEdit(sample));
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
    await runAction("创建发送任务", () => createDemoSendTask(targetConversation.id));
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
    await runAction(locked ? "锁定人工会话" : "解除人工锁定", () =>
      setConversationManualLock(conversation.id, {
        locked,
        reviewer: "人工客服",
        reason: locked ? "manual_takeover_from_workbench" : "manual_resolution_from_workbench",
        note: locked
          ? "人工客服从工作台接管该会话，暂停自动回复。"
          : "人工客服已处理完该会话，恢复自动化判断。",
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
    if (!ensureTaskCanSend(task, "执行干跑发送")) return;
    await runAction("执行干跑发送", () => executeDryRunSend(task.id));
  }

  async function executeActiveSend(task: SendTask) {
    if (!ensureTaskCanSend(task, "执行当前适配器")) return;
    await runAction("执行当前适配器", () => executeSendTask(task.id));
  }

  async function requeueTask(task: SendTask) {
    if (!ensureTaskCanSend(task, "重新排队发送")) return;
    await runAction("重新排队发送", () => requeueSendTask(task.id));
  }

  function isSendTaskConversationLocked(task: SendTask) {
    if (task.conversation?.manualLocked) return true;
    return conversations.some((conversation) => conversation.id === task.conversationId && conversation.manualLocked);
  }

  function ensureTaskCanSend(task: SendTask, label: string) {
    if (!isSendTaskConversationLocked(task)) return true;
    setMessage(`${label}已暂停：该会话已人工接管，请先解除接管或取消任务。`);
    return false;
  }

  async function cancelTask(task: SendTask) {
    await runAction("取消发送任务", () => cancelSendTask(task.id));
  }

  async function scanSendOps() {
    await runAction("扫描发送异常", () => scanSendOperations());
  }

  async function refreshBridgeOutbox() {
    let summary = "";
    await runAction(
      "刷新桥接 outbox",
      async () => {
        const result = await getBridgeOutbox();
        summary = `桥接待处理 ${result.pending.length} 个，忽略旧文件 ${result.ignored.length} 个。`;
      },
      () => {
        setMessage(summary || "桥接 outbox 已刷新。");
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

  async function evaluateCustomerRoute() {
    if (!routeText.trim()) {
      setMessage("请先输入客户消息。");
      return;
    }
    await runAction("路由决策", () => evaluateRoute(routeText));
  }

  async function correctLatestRoute(route: RouteEvaluation, agent: Agent) {
    await runAction(
      "纠正场景",
      () =>
        correctRouteEvaluation(route.id, {
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

  async function updateQuoteDraft(quote: QuoteDraft, patch: {
    status?: string;
    paymentStatus?: string;
    owner?: string;
    customerNotes?: string;
    quantity?: number | string;
    unitPrice?: number | string;
    totalCost?: number | string;
  }) {
    await runAction("更新报价", () => updateQuote(quote.id, patch));
  }

  async function createOrderDraft(quote: QuoteDraft) {
    await runAction("生成订单草稿", () => createOrderDraftFromQuote(quote.id));
  }

  async function markPaidAndCreateOrder(quote: QuoteDraft) {
    await runAction("已付成交并生成订单", async () => {
      await updateQuote(quote.id, { paymentStatus: "paid", status: "accepted" });
      await createOrderDraftFromQuote(quote.id);
    });
  }

  async function updateOrderDraftStatus(order: OrderDraft, patch: {
    status?: string;
    paymentStatus?: string;
    customerNotes?: string;
    owner?: string;
  }) {
    await runAction("更新订单草稿", () => updateOrderDraft(order.id, patch));
  }

  async function queueOrderDraftConfirmation(order: OrderDraft) {
    if (order.status === "cancelled") {
      setMessage("订单已取消，不能发送确认。");
      return;
    }
    if (canRequeueOrderConfirmationTask(order)) {
      await runAction("重新排队订单确认", () => requeueSendTask(order.confirmationSendTask!.id));
      return;
    }
    if (hasActiveOrderConfirmationTask(order)) {
      setMessage(`订单确认已在发送队列中：${sendStatusLabel(order.confirmationSendTask?.status || "")}`);
      return;
    }
    await runAction("订单确认进入发送队列", () => queueOrderConfirmation(order.id));
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
    await runAction("取消订单确认发送", () => cancelSendTask(task.id));
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
    await runAction(`取消${orderFollowupStageLabel(type)}发送`, () => cancelSendTask(task.id));
  }

  async function queueOrderFollowupDraft(order: OrderDraft, type: "production" | "delivery") {
    const task = orderFollowupTask(order, type);
    if (canRequeueOrderFollowupTask(order, type) && task) {
      await runAction(`重新排队${orderFollowupStageLabel(type)}`, () => requeueSendTask(task.id));
      return;
    }
    const blocker = orderFollowupBlockReason(order, type);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    await runAction(type === "delivery" ? "交期说明进入发送队列" : "生产通知进入发送队列", () =>
      queueOrderFollowup(order.id, type),
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

  async function saveActiveQuoteEdit() {
    if (!activeQuote) return;
    await runAction("保存报价调整", () =>
      updateQuote(activeQuote.id, {
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
    await runAction("报价进入发送队列", () => queueQuoteSend(quote.id));
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
    setMessage(`正在编辑商品 ${sku.skuCode}`);
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

    await runAction(
      "保存商品",
      () => upsertSku(payload),
      () => {
        setMessage(`商品 ${payload.skuCode} 已保存。`);
        setSkuForm(emptySkuForm);
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
    load();
    getSkuImportFields().then(setSkuImportFields).catch(() => setSkuImportFields([]));
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
    if (typeof window === "undefined") return;
    const browserWindow = window as Window & typeof globalThis;

    const updateActiveSection = () => {
      const viewportAnchor = Math.max(120, browserWindow.innerHeight * 0.28);
      let closestSection = "";
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const item of workspaceNavItems) {
        const element = document.getElementById(item.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top - viewportAnchor);
        const isInView = rect.bottom > viewportAnchor && rect.top < browserWindow.innerHeight * 0.82;
        if (isInView && distance < closestDistance) {
          closestDistance = distance;
          closestSection = item.id;
        }
      }

      if (closestSection) {
        setActiveWorkspaceSection((current) => (current === closestSection ? current : closestSection));
      }
    };

    const Observer = browserWindow.IntersectionObserver;
    if (typeof Observer !== "function") {
      browserWindow.addEventListener("scroll", updateActiveSection, { passive: true });
      browserWindow.addEventListener("resize", updateActiveSection);
      updateActiveSection();
      return () => {
        browserWindow.removeEventListener("scroll", updateActiveSection);
        browserWindow.removeEventListener("resize", updateActiveSection);
      };
    }

    const observer = new Observer(updateActiveSection, {
      root: null,
      rootMargin: "-22% 0px -54% 0px",
      threshold: [0.05, 0.2, 0.4, 0.6],
    });

    for (const item of workspaceNavItems) {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    }
    updateActiveSection();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const activeRailButton = document.querySelector<HTMLButtonElement>(
      `.rail button[aria-controls="${activeWorkspaceSection}"]`
    );
    activeRailButton?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeWorkspaceSection]);

  const activeJob = useMemo(() => jobs.find((job) => job.id === activeId) || jobs[0], [jobs, activeId]);
  const pendingCount = jobs.filter((job) => ["quick_confirm", "manual_review", "timeout", "failed"].includes(job.status)).length;
  const highValueCount = jobs.filter((job) => job.isHighValue).length;
  const stockWarning = skus.filter((sku) => Number(sku.stock) <= 10).length;
  const latestSamples = trainingSamples.slice(0, 4);
  const latestCorrectionSamples = trainingSamples
    .filter((sample) => sample.sourceType === "route_correction" || sample.sourceRouteId)
    .slice(0, 3);
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
  const latestSendTasks = sendTasks.slice(0, 4);
  const blockedSendCount = sendTasks.filter((task) => task.status === "blocked").length;
  const failedAttemptCount = sendAttempts.filter((attempt) => ["blocked", "failed"].includes(attempt.status)).length;
  const latestWindowByAccount = new Map<string, WechatWindowSnapshot>();
  for (const snapshot of windowSnapshots) {
    if (snapshot.wechatAccountId && !latestWindowByAccount.has(snapshot.wechatAccountId)) {
      latestWindowByAccount.set(snapshot.wechatAccountId, snapshot);
    }
  }
  const latestRoute = routeEvaluations[0];
  const activeQuote = activeJob ? quotes.find((quote) => quote.designJobId === activeJob.id) || null : null;
  const activeSelectedImage = activeJob?.images?.find((image) => image.selected) || null;
  const activePreflightResult = preflightResult?.designJobId === activeJob?.id ? preflightResult : null;
  const quoteCenterSearchTerm = quoteCenterSearch.trim().toLowerCase();
  const filteredQuotes = quotes.filter((quote) => {
    if (quoteStatusFilter !== "all" && quote.status !== quoteStatusFilter) return false;
    if (quotePaymentFilter !== "all" && quote.paymentStatus !== quotePaymentFilter) return false;
    return matchesQuoteSearch(quote, quoteCenterSearchTerm);
  });
  const filteredOrderDrafts = orderDrafts.filter((order) => {
    if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) return false;
    if (orderPaymentFilter !== "all" && order.paymentStatus !== orderPaymentFilter) return false;
    return matchesOrderSearch(order, quoteCenterSearchTerm);
  });
  const activeOrderDraft = activeQuote ? orderDrafts.find((order) => order.quoteDraftId === activeQuote.id) || null : null;
  const activeQuoteWarnings =
    activeQuote && activeQuotePreview?.quote.id === activeQuote.id ? activeQuotePreview.warnings : [];
  const activeQuoteSendRisk = activeQuote ? quoteSendBlockReason(activeQuote, activeQuoteWarnings) : "";
  const unreadNoticeCount = notifications.filter((notice) => !notice.readAt).length;
  const lowValueAutomationIssues = useMemo(
    () => buildLowValueAutomationIssueItems(automationStatus?.lastRun),
    [automationStatus?.lastRun],
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
  const visibleSkus = useMemo(() => {
    const query = skuSearch.trim().toLowerCase();
    return skus.filter((sku) => {
      const issueKey = sku.skuCode || sku.name;
      const issues = catalogIssuesBySku.get(issueKey) || [];
      if (skuTypeFilter !== "all" && sku.type !== skuTypeFilter) return false;
      if (skuIssueFilter === "problem" && !issues.some((issue) => issue.severity !== "info")) return false;
      if (
        skuIssueFilter === "missing_image" &&
        !issues.some((issue) =>
          ["missing_main_image", "local_main_image_missing", "invalid_main_image_type", "invalid_angle_image_type", "local_angle_image_missing"].includes(issue.code),
        )
      ) return false;
      if (skuIssueFilter === "low_stock" && !issues.some((issue) => ["low_stock", "out_of_stock"].includes(issue.code))) return false;
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

  function scrollToWorkspaceSection(sectionId: string) {
    setActiveWorkspaceSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          onClick={() => setActiveConversationId("")}
          type="button"
        >
          请选择客户会话
        </button>
        {conversations.map((conversation) => (
          <button
            aria-pressed={activeConversationId === conversation.id}
            className={activeConversationId === conversation.id ? "selected" : ""}
            disabled={Boolean(busy)}
            key={conversation.id}
            onClick={() => setActiveConversationId(conversation.id)}
            title={`${conversation.wechatAccount?.displayName || conversation.wechatAccountId} / ${conversation.title}`}
            type="button"
          >
            <span>{conversation.wechatAccount?.displayName || conversation.wechatAccountId}</span>
            <strong>{conversation.title}</strong>
          </button>
        ))}
      </div>
    );
  }

  const activeWorkspaceLabel =
    workspaceNavItems.find((item) => item.id === activeWorkspaceSection)?.label || "工作台";
  const pendingSendTaskCount = sendTasks.filter((task) => !["sent", "cancelled"].includes(task.status)).length;
  const manualReviewJobCount = jobs.filter((job) => job.status === "manual_review").length;
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
      : "设计平台离线";
  const automationStateText = automationStatus?.active ? "自动化运行中" : "自动化暂停";
  const queueStateText = pendingSendTaskCount ? `${pendingSendTaskCount} 个待校验发送` : "发送队列空闲";
  const reviewStateText = manualReviewJobCount ? `${manualReviewJobCount} 个设计待人工审核` : "审核中心空闲";

  return (
    <main className="shell" aria-busy={Boolean(busy)} data-busy={busy ? "true" : "false"}>
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

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>智能体客服工作台</h1>
            <p>微信客户设计需求、礼盒搭配、效果图审核和报价草稿</p>
          </div>
          <div className="top-actions">
            <div className="toolbar-group status-group">
              <span className="platform-pill current-section-pill" aria-live="polite">
                当前 {activeWorkspaceLabel}
              </span>
              <span className={`platform-pill ${platformPillTone}`} title={platformReadiness?.nextSteps[0] || platformStateText}>
                设计平台 {platformStateText}
              </span>
              <span className={`platform-pill ${automationStatus?.active ? "online" : "offline"}`}>
                {automationStatus?.running
                  ? "低价值自动化运行中"
                  : automationStatus?.active
                    ? `低价值自动化已开启 ${Math.round((automationStatus.intervalMs || 0) / 1000)}s`
                    : "低价值自动化未开启"}
              </span>
            </div>
            <div className="toolbar-group">{renderConversationSelect()}</div>
            <div className="toolbar-group">
              <button type="button" className="ghost" onClick={checkDesignPlatform} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />检测设计平台</button>
              <button type="button" className="ghost" onClick={load} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />刷新</button>
            </div>
            <div className="toolbar-group">
              <button type="button" className="ghost" onClick={createDemo} disabled={Boolean(busy)}><Boxes size={16} aria-hidden="true" />新建演示任务</button>
              <button type="button" className="ghost" onClick={preflightActiveJob} disabled={!activeJob || Boolean(busy)}><ShieldCheck size={16} aria-hidden="true" />出图预检</button>
              <button type="button" className="primary" onClick={submitActiveJob} disabled={!activeJob || Boolean(busy)}><Send size={16} aria-hidden="true" />提交出图</button>
            </div>
          </div>
        </header>
        <div className="status-line" data-busy={busy ? "true" : "false"} role="status" aria-live="polite">
          {busy ? `${busy}处理中` : message}
        </div>
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

        <section className="design-platform-config" aria-label="设计平台运行配置">
          <div className="config-summary">
            <div>
              <strong>设计平台运行配置</strong>
              <span>{platformConfig?.runtimeConfigPath || "运行时配置未加载"}</span>
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
              <div className="segmented-control" role="group" aria-label="设计平台适配器">
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
              <button type="button" className="ghost danger" onClick={clearDesignPlatformCredentials} disabled={Boolean(busy)}>
                <Ban size={16} aria-hidden="true" />清空凭证
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
            <strong>{trainingSamples.length}</strong>
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
          <Metric icon={<ImageIcon size={22} aria-hidden="true" />} label="待处理设计" value={pendingCount} tone="red" />
          <Metric icon={<ShieldAlert size={22} aria-hidden="true" />} label="高价值人工" value={highValueCount} tone="amber" />
          <Metric icon={<Boxes size={22} aria-hidden="true" />} label="SKU总数" value={skus.length} tone="blue" />
          <Metric icon={<PackageSearch size={22} aria-hidden="true" />} label="低库存提醒" value={stockWarning} tone="green" />
          <Metric icon={<AlertTriangle size={22} aria-hidden="true" />} label="商品资料问题" value={catalogAudit?.issueCount || 0} tone="amber" />
          <Metric icon={<Bell size={22} aria-hidden="true" />} label="未读提醒" value={unreadNoticeCount} tone="red" />
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
                <div className="empty" role="status">还没有客户素材；可以先生成演示 Logo 或上传本机图片</div>
              )}
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
                    <strong>{activeJob.scene || "未填写"}</strong>
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
                        onClick={() => runAction("选择候选图", () => selectDesignImage(activeJob.id, `我选第${image.position}张`))}
                        disabled={Boolean(busy)}
                        type="button"
                      >
                        {image.downloadUrl ? <img src={image.downloadUrl} alt={`${image.position}号候选图`} /> : <ImageIcon size={24} aria-hidden="true" />}
                        <span>{image.position}号图</span>
                        {image.fingerprint ? <small>指纹 {image.fingerprint.slice(0, 6)}</small> : null}
                        {image.selected ? <Check size={16} aria-hidden="true" /> : null}
                      </button>
                    ))
                  ) : (
                    <div className="empty" role="status">候选图生成后显示在这里</div>
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
                  <button type="button" className="primary" onClick={quickConfirmActiveJob} disabled={!activeJob.images?.length || Boolean(busy)}><Check size={16} aria-hidden="true" />快速确认</button>
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
                        <div className="empty small" role="status">客户提出改图后，会在这里保留记录和处理状态</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
                <div className="empty" role="status">暂无设计任务</div>
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
              {jobs.map((job) => (
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
                    <small>{job.scene || "未填写场景"} · {job.outputCount} 张候选</small>
                    {job.retryCount ? <small>已重试 {job.retryCount} 次</small> : null}
                    {job.errorMessage ? <small className="error-text">{job.errorMessage}</small> : null}
                  </div>
                  <em>{statusLabel[job.status] || job.status}</em>
                </button>
              ))}
            </div>
          </section>
        </section>

        <section className="bottom-grid">
          <section className="panel" id="sku-library">
            <div className="panel-head">
              <div>
                <h2><Store size={17} aria-hidden="true" />商品库</h2>
                <span>礼盒、内搭物品、配件、供应商、图片和交期</span>
              </div>
            </div>
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
                </div>
              </div>
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
                    className={`sku-row ${sku.isActive === false ? "inactive" : ""}`}
                    key={sku.id}
                    role="row"
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
                      {imageUrl ? <img src={imageUrl} alt={sku.name} loading="lazy" /> : <PackageSearch size={18} aria-hidden="true" />}
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
                <div className="empty" role="row">
                  <span role="cell" aria-colspan={9}>没有匹配的商品；可以调整筛选或新增 SKU</span>
                </div>
              ) : null}
            </div>
            <div className="sku-editor">
              <div className="sku-editor-head">
                <strong>{skuForm.skuCode ? "编辑/新增商品" : "新增真实商品"}</strong>
                <span>保存后立即进入 SKU 库，并参与搭配、体检和报价计算</span>
              </div>
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
              <div className="catalog-actions">
                <button type="button" className="primary" onClick={saveSkuForm} disabled={Boolean(busy)}>
                  <Check size={16} aria-hidden="true" />保存商品
                </button>
                <button type="button" className="ghost" onClick={resetSkuForm} disabled={Boolean(busy)}>
                  <RefreshCw size={16} aria-hidden="true" />清空表单
                </button>
              </div>
            </div>
          </section>

          <section className="panel" id="notice-center">
            <div className="panel-head">
              <div>
                <h2><Bell size={17} aria-hidden="true" />提醒</h2>
                <span>生成完成、失败、超时、高价值转人工</span>
              </div>
              <div className="notice-actions">
                <button type="button" className="primary" onClick={runAutomationCycle} disabled={Boolean(busy)}><Bot size={16} aria-hidden="true" />后台跑一轮</button>
                <button type="button" className="primary" onClick={runLowValueAutomation} disabled={Boolean(busy)}><Check size={16} aria-hidden="true" />低价值自动处理</button>
                <button type="button" className="ghost danger" onClick={handoffHighValueJobs} disabled={Boolean(busy)}><ShieldAlert size={16} aria-hidden="true" />高价值转人工</button>
                <button type="button" className="ghost" onClick={autoSubmitDrafts} disabled={Boolean(busy)}><Send size={16} aria-hidden="true" />自动提交草稿</button>
                <button type="button" className="ghost" onClick={createTimeoutDemo} disabled={Boolean(busy)}><AlertTriangle size={16} aria-hidden="true" />超时演示</button>
                <button type="button" className="ghost" onClick={createFailureDemo} disabled={Boolean(busy)}><Ban size={16} aria-hidden="true" />失败演示</button>
                <button type="button" className="ghost" onClick={scanTimeouts} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" />扫描超时</button>
                <button type="button" className="ghost" onClick={readAllNotices} disabled={!unreadNoticeCount || Boolean(busy)}><Bell size={16} aria-hidden="true" />全部已读</button>
              </div>
            </div>
            {lowValueAutomationIssues.length ? (
              <div className="automation-issue-panel">
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
            <div className="notice-list">
              {notifications.length ? (
                notifications.slice(0, 6).map((notice) => (
                  <button type="button"
                    className={`notice ${noticeTone(notice.level)} ${notice.readAt ? "read" : ""}`}
                    key={notice.id}
                    onClick={() => readNotice(notice)}
                    disabled={Boolean(busy)}
                  >
                    <span />
                    <p>
                      <strong>{notice.title}</strong>
                      {notice.body ? <small>{notice.body}</small> : null}
                    </p>
                  </button>
                ))
              ) : (
                <div className="empty" role="status">暂无提醒；出图完成、失败、超时和人工审核会显示在这里</div>
              )}
            </div>
          </section>
        </section>

        <section className="catalog-grid">
          <section className="panel" id="catalog-center">
            <div className="panel-head">
              <div>
                <h2><PackageSearch size={17} aria-hidden="true" />商品导入与搭配</h2>
                <span>下载标准模板，或从 Excel 复制表格/粘贴 CSV，导入后参与预算搭配</span>
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
                <div className="empty compact" role="status">保存、导入、批量修改或上下架商品后，会在这里留下变更记录。</div>
                )}
              </div>
              {bundleResult ? (
                <div className="bundle-result">
                  <div className="bundle-total">
                    <strong>{bundleResult.totals.salePrice} 元/份</strong>
                    <span>成本 {bundleResult.totals.cost} 元 · 利润 {bundleResult.totals.profit} 元</span>
                  </div>
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
              {agents.map((agent) => (
                <div className="agent-card" key={agent.id}>
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
                </div>
              ))}
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
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder={"客户：问题内容\n客服：高质量回复"}
              />
              <div className="training-actions">
                <button type="button" className="primary" onClick={importChat} disabled={Boolean(busy)}>
                  <FileUp size={16} aria-hidden="true" />导入训练
                </button>
                <span>已导入 {chatImports.length} 批，训练样本 {trainingSamples.length} 条</span>
                <button type="button" className="ghost" onClick={compileTrainingSkills} disabled={Boolean(busy) || !selectedSkillSuggestionCount}>
                  <Brain size={16} aria-hidden="true" />应用已选 Skill
                </button>
              </div>
              <div className="training-overview">
                <div className="training-metric">
                  <span>纠错样本</span>
                  <strong>{trainingOverview?.correctionSamples ?? latestCorrectionSamples.length}</strong>
                </div>
                <div className="training-metric">
                  <span>可生成 Skill</span>
                  <strong>{trainingOverview?.suggestionCount ?? 0}</strong>
                </div>
                <div className="training-metric">
                  <span>待复核</span>
                  <strong>{trainingOverview?.reviewSamples ?? trainingSamples.filter((sample) => sample.status === "review").length}</strong>
                </div>
                <div className="training-metric">
                  <span>平均评分</span>
                  <strong>{trainingOverview?.averageScore ?? "-"}</strong>
                </div>
              </div>
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
                    <div className={`skill-suggestion-row ${safetyTone}`} key={skillSuggestionKey(suggestion)}>
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
                  <div className="empty small" role="status">确认高质量样本后，这里会显示可进化的 Skill</div>
                )}
                {filteredSkillSuggestions.length > visibleSkillSuggestions.length ? (
                  <div className="empty small" role="status">当前 Agent 还有 {filteredSkillSuggestions.length - visibleSkillSuggestions.length} 条建议未展示，可继续分批确认。</div>
                ) : null}
              </div>
              <div className="coverage-list">
                {topTrainingAgents.length ? (
                  topTrainingAgents.map((agent) => (
                    <div className="coverage-row" key={agent.agentId || agent.agentKey}>
                      <div>
                        <strong>{agent.name}</strong>
                        <span>{agent.scene} · 样本 {agent.sampleCount} · 纠错 {agent.correctionCount}</span>
                      </div>
                      <em>{agent.suggestionCount} 个 Skill 建议</em>
                    </div>
                  ))
                ) : (
                  <div className="empty small" role="status">还没有智能体训练覆盖数据</div>
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
              <div className="sample-list">
                {latestSamples.length ? (
                  latestSamples.map((sample) => {
                    const qualityTone = sampleQualityTone(sample);
                    return (
                    <div className={`sample-row ${qualityTone}`} key={sample.id}>
                      <div className="sample-row-head">
                        <strong>{sample.scene}</strong>
                        <div className="sample-badges">
                          <span className={`sample-status ${sample.status || "ready"}`}>{trainingSampleStatusLabel(sample.status)}</span>
                          <span className={`sample-quality ${qualityTone}`} title={sampleQualityReason(sample)}>
                            {sampleQualityLabel(sample)}
                          </span>
                        </div>
                      </div>
                      <p>{sample.customerText}</p>
                      <small>
                        评分 {sample.score} · {sampleSourceLabel(sample)} · {sample.skillHints.join("、") || "待补 Skill"}
                      </small>
                      {sample.quality?.reason ? <small className="sample-quality-reason">{sample.quality.reason}</small> : null}
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
                  <div className="empty" role="status">导入聊天记录后，训练样本会显示在这里</div>
                )}
              </div>
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
                窗口观察器：{windowObserverStatus?.status || "未检测"}
                {windowObserverStatus?.ok ? " / 正常" : " / 需检查"}
              </strong>
              <span>
                最后更新 {windowObserverStatus?.ageSeconds ?? "-"} 秒前，前台进程 {windowObserverStatus?.result?.processName || "-"}，
                账号 {windowObserverStatus?.result?.wechatAccountId || "未匹配"}
              </span>
              <small>
                微信窗口 {windowObserverStatus?.result?.isOnline ? "已识别" : "未识别"}，置信度{" "}
                {Math.round(Number(windowObserverStatus?.result?.confidence || 0) * 100)}%，自动扫描{" "}
                {windowObserverStatus?.scan ? "开启" : "关闭"}，dry-run {windowObserverStatus?.dryRun ? "是" : "否"}
              </small>
              {windowObserverStatus?.errorMessage || windowObserverStatus?.message ? (
                <small className="danger-text">{windowObserverStatus?.errorMessage || windowObserverStatus?.message}</small>
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

          <section className="panel" id="send-center">
            <div className="panel-head">
              <div>
                <h2><ShieldCheck size={17} aria-hidden="true" />发送安全队列</h2>
                <span>账号、聊天对象、最近消息三重校验</span>
              </div>
              <ShieldCheck size={20} aria-hidden="true" />
            </div>
            <div className="send-panel">
              <div className={`adapter-banner ${sendAdapter?.realSend ? "live" : "dry"}`}>
                <strong>{sendAdapter?.label || "发送适配器未连接"}</strong>
                <span>{sendAdapter?.description || "当前只允许校验和审计，不会执行真实微信发送。"}</span>
              </div>
              <div className="bridge-summary">
                <strong>
                  桥接 worker：{bridgeStatus?.worker?.status || "未检测"}
                  {bridgeStatus?.worker?.ok ? " / 正常" : " / 需检查"}
                </strong>
                <span>
                  模式 {bridgeStatus?.worker?.mode || "-"}，回执 {bridgeStatus?.worker?.ackTransport || "-"}，最后更新 {bridgeStatus?.worker?.ageSeconds ?? "-"} 秒前
                </span>
                <small>
                  outbox 待处理 {bridgeStatus?.outbox.pendingCount ?? bridgeOutbox?.pending.length ?? 0} 个，inbox 待扫描 {bridgeStatus?.inbox.pendingCount ?? 0} 个，账号锁 {bridgeStatus?.locks.activeCount ?? 0} 个
                  {bridgeStatus?.locks.staleCount ? `，疑似超时锁 ${bridgeStatus.locks.staleCount} 个` : ""}
                </small>
                {bridgeStatus?.worker?.errorMessage || bridgeStatus?.worker?.message ? (
                  <small className="danger-text">{bridgeStatus.worker.errorMessage || bridgeStatus.worker.message}</small>
                ) : null}
              </div>
              <div className="send-actions">
                <button type="button" className="primary" onClick={createSendTask} disabled={Boolean(busy)}>
                  <Send size={16} aria-hidden="true" />创建演示发送
                </button>
                <button type="button" className="ghost" onClick={scanSendOps} disabled={Boolean(busy)}>
                  <AlertTriangle size={16} aria-hidden="true" />扫描异常
                </button>
                <button type="button" className="primary" onClick={processSafeQueue} disabled={Boolean(busy)}>
                  <ShieldCheck size={16} aria-hidden="true" />安全处理队列
                </button>
                <span>{sendTasks.length} 个任务，{blockedSendCount} 个已拦截，{sendAttempts.length} 次尝试，{failedAttemptCount} 次异常</span>
              </div>
              <div className="send-task-list">
                {latestSendTasks.length ? (
                  latestSendTasks.map((task) => {
                    const taskConversationLocked = isSendTaskConversationLocked(task);
                    const sendDisabled = Boolean(busy) || task.status === "sent" || task.status === "dry_run" || taskConversationLocked;
                    const bridgeEntry = bridgeOutboxEntryForTask(task, bridgeOutbox, bridgeStatus);
                    return (
                      <div className={`send-task ${task.status}`} key={task.id}>
                        <div className="send-task-head">
                          <strong>{task.conversation?.title || "未知会话"}</strong>
                          <span>{sendStatusLabel(task.status)}</span>
                        </div>
                        <p>{task.wechatAccount?.displayName || task.wechatAccountId}</p>
                        {taskConversationLocked ? (
                          <p className="danger-text">会话已人工接管，发送、执行和重新排队已暂停；可先解除接管或取消任务。</p>
                        ) : null}
                        <GuardChecks task={task} />
                        <SendQueueAdvice task={task} />
                        <SendAttemptSummary task={task} />
                        <BridgeOutboxPreview entry={bridgeEntry} attempt={task.latestAttempt || task.attempts?.[0]} />
                        <div className="send-task-actions">
                          <button type="button" className="ghost danger" onClick={() => validateWrong(task)} disabled={Boolean(busy) || task.status === "sent"}>
                            <AlertTriangle size={16} aria-hidden="true" />错误窗口校验
                          </button>
                          <button type="button" className="ghost" onClick={() => validateCorrect(task)} disabled={Boolean(busy) || task.status === "sent"}>
                            <ShieldCheck size={16} aria-hidden="true" />正确窗口校验
                          </button>
                          <button type="button" className="ghost" onClick={() => validateCurrentWindow(task)} disabled={Boolean(busy) || task.status === "sent"}>
                            <LockKeyhole size={16} aria-hidden="true" />当前快照校验
                          </button>
                          <button type="button" className="primary" onClick={() => executeActiveSend(task)} disabled={sendDisabled}>
                            <Send size={16} aria-hidden="true" />执行当前适配器
                          </button>
                          <button type="button" className="primary" onClick={() => executeDryRun(task)} disabled={sendDisabled}>
                            <Send size={16} aria-hidden="true" />执行干跑发送
                          </button>
                          {["blocked", "failed", "cancelled", "dry_run"].includes(task.status) ? (
                            <button type="button" className="ghost" onClick={() => requeueTask(task)} disabled={Boolean(busy) || taskConversationLocked}>
                              <RefreshCw size={16} aria-hidden="true" />重新排队
                            </button>
                          ) : null}
                          {task.status !== "sent" && task.status !== "cancelled" ? (
                            <button type="button" className="ghost danger" onClick={() => cancelTask(task)} disabled={Boolean(busy)}>
                              <Ban size={16} aria-hidden="true" />取消任务
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty" role="status">创建演示发送后，安全校验结果会显示在这里</div>
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
                <div className="empty" role="status">评估后会显示 Agent、动作和建议回复</div>
              )}
              {inboundSummary ? <div className="training-summary">{inboundSummary}</div> : null}
            </div>
          </section>
        </section>

        <section className="review-grid">
          <section className="panel" id="review-center">
            <div className="panel-head">
              <div>
                <h2><ShieldAlert size={17} aria-hidden="true" />人工审核中心</h2>
                <span>高价值客户、失败任务、超时任务和待审核报价统一处理</span>
              </div>
              <ShieldCheck size={20} aria-hidden="true" />
            </div>
            <div className="review-panel">
              <div className="review-summary">
                <Metric icon={<ShieldAlert size={20} aria-hidden="true" />} label="待审设计" value={reviewCenter.designJobs.length} tone="amber" />
                <Metric icon={<ReceiptText size={20} aria-hidden="true" />} label="待审报价" value={reviewCenter.quoteDrafts.length} tone="blue" />
                <Metric icon={<Check size={20} aria-hidden="true" />} label="审核记录" value={reviewCenter.logs.length} tone="green" />
              </div>
              <div className="review-columns">
                <div className="review-list">
                  <h3><ShieldCheck size={16} aria-hidden="true" />设计审核</h3>
                  {reviewCenter.designJobs.length ? (
                    reviewCenter.designJobs.slice(0, 5).map((job) => {
                      const totalImages = job.images?.length || 0;
                      const localImageCount = (job.images || []).filter((image) => Boolean(image.localPath)).length;
                      return (
                      <div className={`review-card ${job.status}`} key={job.id}>
                        <div>
                          <strong>{job.customer?.name || "未知客户"} · {job.scene || "未填写场景"}</strong>
                          <p>
                            {statusLabel[job.status] || job.status} · {totalImages} 张图 · 本地可发 {localImageCount}/{totalImages} ·{" "}
                            {job.isHighValue ? "高价值" : "普通"}
                          </p>
                          {job.errorMessage ? <small>{job.errorMessage}</small> : null}
                        </div>
                        <div className="review-actions">
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
                    })
                  ) : (
                <div className="empty" role="status">暂无待审核设计任务</div>
                  )}
                </div>
                <div className="review-list">
                  <h3><ReceiptText size={16} aria-hidden="true" />报价审核</h3>
                  {reviewCenter.quoteDrafts.length ? (
                    reviewCenter.quoteDrafts.slice(0, 5).map((quote) => (
                      <div className="review-card quote" key={quote.id}>
                        <div>
                          <strong>{quote.customer?.name || "未知客户"} · {quote.totalPrice} 元</strong>
                          <p>{quote.quantity} 份 · 单价 {quote.unitPrice} 元 · 利润 {quote.profit} 元</p>
                          {quote.owner ? <small>跟进人 {quote.owner}</small> : null}
                          {quote.sendTaskId ? <small>发送任务 {quote.sendTaskId}</small> : null}
                        </div>
                        <div className="review-actions">
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
                    ))
                  ) : (
                <div className="empty" role="status">暂无待审核报价</div>
                  )}
                </div>
              </div>
              <div className="review-log-list">
                {reviewCenter.logs.slice(0, 4).map((log) => (
                  <span key={log.id}>
                    {reviewDecisionLabel(log.decision)} · {log.reviewer} · {log.afterStatus || "-"}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </section>

        <section className="quote-grid" id="quote-center">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2><ReceiptText size={17} aria-hidden="true" />报价/订单草稿</h2>
                <span>客户选图后生成报价，跟进付款和成交状态</span>
              </div>
              <ReceiptText size={20} aria-hidden="true" />
            </div>
            <div className="quote-panel">
              <div className="quote-summary">
                <Metric icon={<ReceiptText size={20} aria-hidden="true" />} label="报价草稿" value={quotes.length} tone="blue" />
                <Metric icon={<CreditCard size={20} aria-hidden="true" />} label="已付款" value={quotes.filter((quote) => quote.paymentStatus === "paid").length} tone="green" />
                <Metric icon={<ClipboardList size={20} aria-hidden="true" />} label="订单草稿" value={orderDrafts.length} tone="blue" />
                <Metric icon={<CircleDollarSign size={20} aria-hidden="true" />} label="待人工审核" value={quotes.filter((quote) => quote.status === "manual_review").length} tone="amber" />
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
              </div>
              <div className="quote-section-head">
                <strong>报价列表</strong>
                <span>显示 {filteredQuotes.length} / {quotes.length} 个</span>
              </div>
              <div className="quote-list">
                {filteredQuotes.length ? (
                  filteredQuotes.map((quote) => {
                    const sendRisk = quoteSendBlockReason(quote);
                    const orderDraft = orderDrafts.find((order) => order.quoteDraftId === quote.id) || null;
                    const selectedImage = quoteSelectedImage(quote);
                    return (
                    <div className={`quote-row ${quote.status}`} key={quote.id}>
                      <div className="quote-main">
                        <div className="quote-identity">
                          <SelectedImageThumb image={selectedImage} label="报价选图" />
                          <div>
                            <strong>{quote.customer?.name || "未知客户"}</strong>
                            <p>{quote.designJob?.scene || "未填写场景"} · {quote.quantity} 份 · {quote.unitPrice} 元/份</p>
                          </div>
                        </div>
                        <div className="quote-money">
                          <strong>{quote.totalPrice} 元</strong>
                          <span>利润 {quote.profit} 元</span>
                        </div>
                      </div>
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
                        {sendRisk && !quote.sendTaskId ? <span>发送检查 {sendRisk}</span> : null}
                      </div>
                      <div className="quote-actions">
                        <button type="button" className="ghost" onClick={() => queueQuoteDraft(quote)} disabled={Boolean(busy) || Boolean(sendRisk)} title={sendRisk || "发送报价"}>
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
                  <div className="empty" role="status">
                    {quotes.length ? "当前筛选下没有报价；可以调整关键词、报价状态或付款状态" : "客户选图并生成报价后，会显示在这里"}
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
                      return (
                      <div className={`order-row ${order.status}`} key={order.id}>
                        <div className="order-row-main">
                          <div className="quote-identity">
                            <SelectedImageThumb image={selectedImage} label="订单选图" />
                            <div>
                              <strong>{order.customer?.name || order.quoteDraft?.customer?.name || "未知客户"}</strong>
                              <p>{order.designJob?.scene || order.quoteDraft?.designJob?.scene || "未填写场景"} · {order.quantity} 份 · {order.unitPrice} 元/份</p>
                            </div>
                          </div>
                          <div className="order-total">
                            <strong>{order.totalPrice} 元</strong>
                            <span>利润 {order.profit} 元</span>
                          </div>
                        </div>
                        <div className="quote-tags order-tags">
                          <span>{orderStatusLabel(order.status)}</span>
                          <span>{paymentStatusLabel(order.paymentStatus)}</span>
                          {order.confirmationSendTask ? <span>确认{sendStatusLabel(order.confirmationSendTask.status)}</span> : null}
                          {orderFollowupStatusItems(order).map((item) => <span key={item.key}>{item.label}</span>)}
                          <span>报价 {order.quoteDraftId}</span>
                          {order.owner ? <span>跟进人 {order.owner}</span> : null}
                          <span>{formatDateTime(order.updatedAt)}</span>
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
                    <div className="empty small" role="status">
                      {orderDrafts.length ? "当前筛选下没有订单草稿；可以调整关键词、订单状态或付款状态" : "暂无订单草稿；从报价行点击“生成订单”后会显示在这里"}
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
          <strong>{busy ? `${busy}处理中` : "本地工作台已就绪"}</strong>
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

  return (
    <div className={`preflight-panel ${tone}`}>
      <div className="preflight-head">
        <div>
          <strong>{preflight ? (preflight.ok ? "出图预检通过" : "出图预检未通过") : "出图提交前预检"}</strong>
          <span>
            {job.requestId} · {job.isHighValue ? "高价值人工审核" : "普通客户快速确认"}
          </span>
        </div>
        <button type="button" className="ghost compact-button" onClick={onPreflight} disabled={disabled}>
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

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span aria-hidden="true">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function noticeTone(level: string) {
  if (level === "error") return "red";
  if (level === "warning") return "amber";
  return "blue";
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

function SendAttemptSummary({ task }: { task: SendTask }) {
  const attempt = task.latestAttempt || task.attempts?.[0];
  if (!attempt) {
    return <small className="guard-empty">尚未执行发送尝试</small>;
  }
  return (
    <div className={`attempt-summary ${attempt.status}`}>
      <span>{sendAttemptStatusLabel(attempt.status)}</span>
      <small>
        {attempt.adapter} · {attempt.payloadSummary?.kind || "unknown"} · 文本 {attempt.payloadSummary?.textLength || 0} 字 · 图片 {attempt.payloadSummary?.imageCount || 0} 张
      </small>
      {attempt.errorMessage ? <small>{attempt.errorMessage}</small> : null}
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

  const imageNames = preview?.imageFileNames || [];
  return (
    <div className="bridge-preview">
      <div className="bridge-preview-head">
        <strong>桥接发送确认</strong>
        <span>{outboxFile || "等待 outbox 文件"}</span>
      </div>
      <small>
        账号 {preview?.accountDisplayName || entry?.accountDisplayName || preview?.wechatAccountId || entry?.wechatAccountId || "-"} · 会话{" "}
        {preview?.conversationTitle || entry?.conversationTitle || preview?.conversationId || entry?.conversationId || "-"}
      </small>
      <small>
        动作 {preview?.actionCount ?? entry?.actionCount ?? 0} 个 · 文字 {preview?.textActionCount ?? 0} 段/{preview?.textLength ?? 0} 字 · 图片{" "}
        {preview?.imageActionCount ?? 0} 张
      </small>
      {preview?.textPreview ? <p>{preview.textPreview}</p> : null}
      {imageNames.length ? (
        <div className="bridge-preview-images">
          {imageNames.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      ) : null}
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

function hasActiveOrderConfirmationTask(order: OrderDraft) {
  const task = order.confirmationSendTask;
  return Boolean(task && !["failed", "cancelled"].includes(task.status));
}

function canRequeueOrderConfirmationTask(order: OrderDraft) {
  const status = order.confirmationSendTask?.status;
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
  const status = orderFollowupTask(order, type)?.status;
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

const LOW_VALUE_NORMAL_SKIP_REASONS = new Set([
  "already_queued",
  "already_has_order_draft",
  "quote_not_accepted",
  "status_not_ready",
  "order_cancelled",
]);

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
  };
  return labels[decision] || decision;
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

function SelectedImageThumb({
  image,
  label,
}: {
  image?: NonNullable<DesignJob["images"]>[number] | null;
  label: string;
}) {
  const title = image ? `${label}：第 ${image.position || "-"} 张` : `${label}：未选图`;
  return (
    <div className={`selected-image-thumb ${image?.downloadUrl ? "" : "empty"}`} title={title} aria-label={title}>
      {image?.downloadUrl ? <img src={image.downloadUrl} alt={title} /> : <ImageIcon size={18} aria-hidden="true" />}
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
