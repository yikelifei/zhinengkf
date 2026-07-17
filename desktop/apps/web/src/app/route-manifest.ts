import type { WorkspaceSectionId } from "../components/workbench-shell/types";

export type TrainingWorkbenchView = "import" | "history" | "review" | "batch" | "skills";
export type WechatWorkbenchView = "channels" | "flow" | "config";
export type PersonalWechatRouteView = "instances" | "control" | "inbound" | "safety";
export type AccountWorkbenchView = "wechat" | "access";
export type SendWorkbenchView = "queue" | "blocked" | "diagnostics";
export type ReviewWorkbenchView = "handoff" | "design" | "quote" | "order" | "logs";
export type SalesWorkbenchView = "overview" | "actions" | "quotes" | "orders";
export type SkuWorkbenchView = "catalog" | "repair" | "editor";
export type CatalogWorkbenchView = "import" | "preview" | "audit" | "bundle";
export type AutomationWorkbenchView = "automation" | "control" | "issues" | "history";

export type WorkbenchRouteSelection = {
  training?: TrainingWorkbenchView;
  wechat?: WechatWorkbenchView;
  personalWechat?: PersonalWechatRouteView;
  account?: AccountWorkbenchView;
  send?: SendWorkbenchView;
  review?: ReviewWorkbenchView;
  sales?: SalesWorkbenchView;
  sku?: SkuWorkbenchView;
  catalog?: CatalogWorkbenchView;
  automation?: AutomationWorkbenchView;
};

export type WorkbenchRouteDefinition = {
  id: string;
  href: `/${string}`;
  sectionId: WorkspaceSectionId;
  title: string;
  responsibility: string;
  primaryAction: string;
  legacyHash: string;
  showInModuleNav?: boolean;
  initialView?: WorkbenchRouteSelection;
};

export const WORKBENCH_ROUTES = {
  overview: {
    id: "overview",
    href: "/overview",
    sectionId: "overview-center",
    title: "运营总览",
    responsibility: "查看渠道、会话、发送与自动化的真实运营状态。",
    primaryAction: "刷新运营数据",
    legacyHash: "overview-center",
  },
  conversations: {
    id: "conversations",
    href: "/conversations",
    sectionId: "conversation-center",
    title: "会话管理",
    responsibility: "处理客户会话、人工回复、分配和 SLA。",
    primaryAction: "刷新消息",
    legacyHash: "conversation-center",
  },
  conversationDetail: {
    id: "conversationDetail",
    href: "/conversations/[id]",
    sectionId: "conversation-center",
    title: "会话详情",
    responsibility: "处理一条客户会话及其人工接管、分配与回复入队。",
    primaryAction: "人工回复入队",
    legacyHash: "conversation-center:detail",
  },
  routing: {
    id: "routing",
    href: "/routing",
    sectionId: "routing-center",
    title: "路由与分配",
    responsibility: "检查消息意图、身份绑定与处理路由。",
    primaryAction: "执行路由决策",
    legacyHash: "routing-center",
  },
  sendQueue: {
    id: "sendQueue",
    href: "/send/queue",
    sectionId: "send-center",
    title: "发送队列",
    responsibility: "查看并处理通过安全校验的待发送任务。",
    primaryAction: "处理安全队列",
    legacyHash: "send-center:queue",
    initialView: { send: "queue" },
  },
  sendBlocked: {
    id: "sendBlocked",
    href: "/send/blocked",
    sectionId: "send-center",
    title: "发送阻断",
    responsibility: "处理身份、人工锁、通道与策略阻断。",
    primaryAction: "扫描异常",
    legacyHash: "send-center:blocked",
    initialView: { send: "blocked" },
  },
  sendDiagnostics: {
    id: "sendDiagnostics",
    href: "/send/diagnostics",
    sectionId: "send-center",
    title: "发送诊断",
    responsibility: "核查发送适配器、桥接回执和失败尝试。",
    primaryAction: "扫描回执",
    legacyHash: "send-center:diagnostics",
    initialView: { send: "diagnostics" },
  },
  integrationChannels: {
    id: "integrationChannels",
    href: "/integrations/channels",
    sectionId: "wechat-channel-center",
    title: "接入通道",
    responsibility: "查看所有接入通道的状态并导航到对应配置或验收页。",
    primaryAction: "刷新通道",
    legacyHash: "wechat-channel-center",
    initialView: { wechat: "channels" },
  },
  wechatWorkChannels: {
    id: "wechatWorkChannels",
    href: "/integrations/wechat-work",
    sectionId: "wechat-channel-center",
    title: "企业微信生产预检",
    responsibility: "运行企业微信本地配置、运行环境和外部验收前置条件的只读检查。",
    primaryAction: "运行只读预检",
    legacyHash: "wechat-channel-center:channels",
    initialView: { wechat: "channels" },
  },
  wechatWorkFlow: {
    id: "wechatWorkFlow",
    href: "/integrations/wechat-work/flow",
    sectionId: "wechat-channel-center",
    title: "企业微信流程",
    responsibility: "核对回调、入站、路由与发送流程。",
    primaryAction: "检查接入流程",
    legacyHash: "wechat-channel-center:flow",
    initialView: { wechat: "flow" },
    showInModuleNav: false,
  },
  wechatWorkSettings: {
    id: "wechatWorkSettings",
    href: "/integrations/wechat-work/settings",
    sectionId: "wechat-channel-center",
    title: "企业微信配置",
    responsibility: "维护企业微信渠道配置和生产就绪检查。",
    primaryAction: "检查配置",
    legacyHash: "wechat-channel-center:config",
    initialView: { wechat: "config" },
    showInModuleNav: false,
  },
  personalWechatInstances: {
    id: "personalWechatInstances",
    href: "/integrations/personal-wechat/instances",
    sectionId: "personal-wechat-center",
    title: "个人微信实例",
    responsibility: "查看个人微信实例、端点、登录身份与实时状态。",
    primaryAction: "刷新实例状态",
    legacyHash: "personal-wechat-center:instances",
    initialView: { personalWechat: "instances" },
  },
  personalWechatControl: {
    id: "personalWechatControl",
    href: "/integrations/personal-wechat/control",
    sectionId: "personal-wechat-center",
    title: "个人微信账号控制",
    responsibility: "查看实例状态、待处理发送任务和人工接管边界。",
    primaryAction: "刷新账号控制状态",
    legacyHash: "personal-wechat-center:control",
    initialView: { personalWechat: "control" },
  },
  personalWechatInbound: {
    id: "personalWechatInbound",
    href: "/integrations/personal-wechat/window-inbound",
    sectionId: "personal-wechat-center",
    title: "窗口与入站验证",
    responsibility: "采集真实微信窗口证据并执行带完整身份的受控入站验证。",
    primaryAction: "采集当前窗口",
    legacyHash: "personal-wechat-center:inbound",
    initialView: { personalWechat: "inbound" },
  },
  personalWechatSafety: {
    id: "personalWechatSafety",
    href: "/integrations/personal-wechat/safety",
    sectionId: "personal-wechat-center",
    title: "个人微信发送治理",
    responsibility: "查看全局停止、敏感内容、配额和人工审核状态。",
    primaryAction: "检查发送治理",
    legacyHash: "personal-wechat-center:safety",
    initialView: { personalWechat: "safety" },
  },
  designSettings: {
    id: "designSettings",
    href: "/design/settings",
    sectionId: "design-platform-config",
    title: "设计平台配置",
    responsibility: "配置设计平台连接，并检查健康、回调和正式出图就绪状态。",
    primaryAction: "检测设计平台",
    legacyHash: "design-platform-config",
  },
  designActivation: {
    id: "designActivation",
    href: "/design/activation",
    sectionId: "design-platform-config",
    title: "设备激活",
    responsibility: "生成本机设备 ID，并使用后台激活码绑定这台客服设备。",
    primaryAction: "激活设备",
    legacyHash: "design-platform-config:activation",
  },
  designAccount: {
    id: "designAccount",
    href: "/design/account",
    sectionId: "design-platform-config",
    title: "平台账号",
    responsibility: "在设备激活后登录设计平台账号。",
    primaryAction: "登录账号",
    legacyHash: "design-platform-config:account",
  },
  designAssets: {
    id: "designAssets",
    href: "/design/assets",
    sectionId: "asset-center",
    title: "设计素材",
    responsibility: "上传、选择和复用设计任务素材。",
    primaryAction: "上传素材",
    legacyHash: "asset-center",
  },
  designJobs: {
    id: "designJobs",
    href: "/design/jobs",
    sectionId: "design-center",
    title: "设计任务",
    responsibility: "创建、预检、提交并跟踪出图任务。",
    primaryAction: "提交出图",
    legacyHash: "design-center",
  },
  designJobDetail: {
    id: "designJobDetail",
    href: "/design/jobs/[id]",
    sectionId: "design-center",
    title: "设计任务详情",
    responsibility: "完成一条设计任务的预检、提交、轮询、选图、改图或取消。",
    primaryAction: "提交当前任务",
    legacyHash: "design-center:detail",
  },
  reviewInbox: {
    id: "reviewInbox",
    href: "/reviews/inbox",
    sectionId: "review-center",
    title: "人工接管队列",
    responsibility: "处理需要人工接管的会话、阻塞发送和超时任务。",
    primaryAction: "处理第一项",
    legacyHash: "review-center:handoff",
    initialView: { review: "handoff" },
  },
  reviewDesign: {
    id: "reviewDesign",
    href: "/reviews/design",
    sectionId: "review-center",
    title: "效果图审核",
    responsibility: "审核效果图、修改意见与发送资格。",
    primaryAction: "审核效果图",
    legacyHash: "review-center:design",
    initialView: { review: "design" },
  },
  reviewQuotes: {
    id: "reviewQuotes",
    href: "/reviews/quotes",
    sectionId: "review-center",
    title: "报价审核",
    responsibility: "审核报价利润、身份和客户确认状态。",
    primaryAction: "审核报价",
    legacyHash: "review-center:quote",
    initialView: { review: "quote" },
  },
  reviewOrders: {
    id: "reviewOrders",
    href: "/reviews/orders",
    sectionId: "review-center",
    title: "订单审核",
    responsibility: "审核付款、选图、生产和交付前置条件。",
    primaryAction: "审核订单",
    legacyHash: "review-center:order",
    initialView: { review: "order" },
  },
  reviewLogs: {
    id: "reviewLogs",
    href: "/reviews/logs",
    sectionId: "review-center",
    title: "审核日志",
    responsibility: "查看人工审核与状态变更记录。",
    primaryAction: "刷新日志",
    legacyHash: "review-center:logs",
    initialView: { review: "logs" },
  },
  catalogProducts: {
    id: "catalogProducts",
    href: "/catalog/products",
    sectionId: "sku-library",
    title: "商品库",
    responsibility: "查看真实商品、库存、成本与可用状态。",
    primaryAction: "刷新商品",
    legacyHash: "sku-library:catalog",
    initialView: { sku: "catalog" },
  },
  catalogRepair: {
    id: "catalogRepair",
    href: "/catalog/repair",
    sectionId: "sku-library",
    title: "商品修复",
    responsibility: "修复商品图片、规格、库存和搭配阻断。",
    primaryAction: "处理首个问题",
    legacyHash: "sku-library:repair",
    initialView: { sku: "repair" },
  },
  catalogEditor: {
    id: "catalogEditor",
    href: "/catalog/editor",
    sectionId: "sku-library",
    title: "商品编辑",
    responsibility: "新增或编辑单个商品的业务字段。",
    primaryAction: "保存商品",
    legacyHash: "sku-library:editor",
    initialView: { sku: "editor" },
    showInModuleNav: false,
  },
  catalogImport: {
    id: "catalogImport",
    href: "/catalog/import",
    sectionId: "catalog-center",
    title: "商品导入",
    responsibility: "导入商品数据并进行字段预检。",
    primaryAction: "预检导入",
    legacyHash: "catalog-center:import",
    initialView: { catalog: "import" },
  },
  catalogPreview: {
    id: "catalogPreview",
    href: "/catalog/preview",
    sectionId: "catalog-center",
    title: "导入预览",
    responsibility: "确认导入字段、错误和待写入记录。",
    primaryAction: "确认导入",
    legacyHash: "catalog-center:preview",
    initialView: { catalog: "preview" },
    showInModuleNav: false,
  },
  catalogAudit: {
    id: "catalogAudit",
    href: "/catalog/audit",
    sectionId: "catalog-center",
    title: "目录审计",
    responsibility: "审计商品完整性、库存、利润和自动化资格。",
    primaryAction: "刷新审计",
    legacyHash: "catalog-center:audit",
    initialView: { catalog: "audit" },
  },
  catalogBundles: {
    id: "catalogBundles",
    href: "/catalog/bundles",
    sectionId: "catalog-center",
    title: "搭配推荐",
    responsibility: "根据预算、场景和规则生成真实商品搭配。",
    primaryAction: "生成搭配",
    legacyHash: "catalog-center:bundle",
    initialView: { catalog: "bundle" },
  },
  salesOverview: {
    id: "salesOverview",
    href: "/sales/overview",
    sectionId: "quote-center",
    title: "销售总览",
    responsibility: "查看报价、订单、付款和下一步动作。",
    primaryAction: "推进成交",
    legacyHash: "quote-center:overview",
    initialView: { sales: "overview" },
    showInModuleNav: false,
  },
  salesActions: {
    id: "salesActions",
    href: "/sales/actions",
    sectionId: "quote-center",
    title: "销售动作",
    responsibility: "处理报价、确认、付款、建单和生产动作。",
    primaryAction: "执行下一步",
    legacyHash: "quote-center:actions",
    initialView: { sales: "actions" },
  },
  salesQuotes: {
    id: "salesQuotes",
    href: "/sales/quotes",
    sectionId: "quote-center",
    title: "报价管理",
    responsibility: "创建、预览、审核和发送报价。",
    primaryAction: "生成报价预览",
    legacyHash: "quote-center:quotes",
    initialView: { sales: "quotes" },
  },
  salesQuoteDetail: {
    id: "salesQuoteDetail",
    href: "/sales/quotes/[id]",
    sectionId: "quote-center",
    title: "报价详情",
    responsibility: "处理一条报价的修订、证据核验、发送或建单。",
    primaryAction: "发送当前报价",
    legacyHash: "quote-center:quotes:detail",
    initialView: { sales: "quotes" },
  },
  salesOrders: {
    id: "salesOrders",
    href: "/sales/orders",
    sectionId: "quote-center",
    title: "订单管理",
    responsibility: "确认订单、付款、选图、生产与交付状态。",
    primaryAction: "确认订单",
    legacyHash: "quote-center:orders",
    initialView: { sales: "orders" },
  },
  salesOrderDetail: {
    id: "salesOrderDetail",
    href: "/sales/orders/[id]",
    sectionId: "quote-center",
    title: "订单详情",
    responsibility: "按真实前置条件推进一条订单的确认、付款、生产和交付。",
    primaryAction: "执行当前可用下一步",
    legacyHash: "quote-center:orders:detail",
    initialView: { sales: "orders" },
  },
  notifications: {
    id: "notifications",
    href: "/notifications",
    sectionId: "notice-center",
    title: "通知中心",
    responsibility: "查看业务提醒、未读状态和需要人工处理的通知。",
    primaryAction: "全部标记已读",
    legacyHash: "notice-center",
  },
  automationRuns: {
    id: "automationRuns",
    href: "/automation/runs",
    sectionId: "notice-center",
    title: "自动化状态",
    responsibility: "只查看自动化当前状态、就绪结论和责任页面入口。",
    primaryAction: "刷新状态",
    legacyHash: "notice-center:automation",
    initialView: { automation: "automation" },
  },
  automationControl: {
    id: "automationControl",
    href: "/automation/control",
    sectionId: "notice-center",
    title: "运行控制",
    responsibility: "经人工确认后启动、停止或执行一次自动化。",
    primaryAction: "执行一次",
    legacyHash: "notice-center:automation:control",
    initialView: { automation: "control" },
  },
  automationHistory: {
    id: "automationHistory",
    href: "/automation/history",
    sectionId: "notice-center",
    title: "运行历史",
    responsibility: "查看服务端真实运行结果、耗时、推进、阻断和错误。",
    primaryAction: "刷新记录",
    legacyHash: "notice-center:automation:history",
    initialView: { automation: "history" },
  },
  automationIssues: {
    id: "automationIssues",
    href: "/automation/issues",
    sectionId: "notice-center",
    title: "自动化问题",
    responsibility: "处理阻断自动化的身份、商品、设计与发送问题。",
    primaryAction: "处理首个问题",
    legacyHash: "notice-center:issues",
    initialView: { automation: "issues" },
  },
  agents: {
    id: "agents",
    href: "/agents",
    sectionId: "agent-center",
    title: "智能客服 Agent",
    responsibility: "定位智能体并查看启用状态、场景和训练摘要。",
    primaryAction: "打开智能体详情",
    legacyHash: "agent-center",
  },
  agentDetail: {
    id: "agentDetail",
    href: "/agents/[id]",
    sectionId: "agent-center",
    title: "智能体详情",
    responsibility: "查看一个智能体的职责、训练覆盖和技能状态。",
    primaryAction: "返回智能体目录",
    legacyHash: "agent-center:detail",
  },
  trainingImport: {
    id: "trainingImport",
    href: "/training/import",
    sectionId: "training-center",
    title: "训练导入",
    responsibility: "导入聊天记录并生成可追溯训练样本。",
    primaryAction: "导入聊天记录",
    legacyHash: "training-center:import",
    initialView: { training: "import" },
  },
  trainingImportHistory: {
    id: "trainingImportHistory",
    href: "/training/import/history",
    sectionId: "training-center",
    title: "导入历史",
    responsibility: "查看聊天记录导入结果、解析数量和警告。",
    primaryAction: "刷新记录",
    legacyHash: "training-center:import:history",
    initialView: { training: "history" },
  },
  trainingReview: {
    id: "trainingReview",
    href: "/training/review",
    sectionId: "training-center",
    title: "样本队列",
    responsibility: "筛选并定位需要复核的训练样本。",
    primaryAction: "打开样本详情",
    legacyHash: "training-center:review",
    initialView: { training: "review" },
  },
  trainingReviewBatch: {
    id: "trainingReviewBatch",
    href: "/training/review/batch",
    sectionId: "training-center",
    title: "批量复核",
    responsibility: "仅对人工勾选的多条样本提交同一复核结论。",
    primaryAction: "提交所选复核",
    legacyHash: "training-center:review:batch",
    initialView: { training: "batch" },
  },
  trainingReviewDetail: {
    id: "trainingReviewDetail",
    href: "/training/review/[id]",
    sectionId: "training-center",
    title: "单条样本复核",
    responsibility: "核对并复核地址指定的一条训练样本。",
    primaryAction: "提交当前样本复核",
    legacyHash: "training-center:review:detail",
    initialView: { training: "review" },
  },
  trainingSkills: {
    id: "trainingSkills",
    href: "/training/skills",
    sectionId: "training-center",
    title: "技能建议",
    responsibility: "审核并应用从真实样本产生的技能建议。",
    primaryAction: "应用技能建议",
    legacyHash: "training-center:skills",
    initialView: { training: "skills" },
  },
  settingsAccounts: {
    id: "settingsAccounts",
    href: "/settings/accounts",
    sectionId: "account-center",
    title: "账号设置",
    responsibility: "管理个人微信实例和本地账号配置。",
    primaryAction: "保存账号",
    legacyHash: "account-center:wechat",
    initialView: { account: "wechat" },
    showInModuleNav: false,
  },
  settingsAccess: {
    id: "settingsAccess",
    href: "/settings/access",
    sectionId: "account-center",
    title: "访问控制",
    responsibility: "查看角色、能力矩阵和可信本地会话状态。",
    primaryAction: "刷新权限状态",
    legacyHash: "account-center:access",
    initialView: { account: "access" },
  },
} as const satisfies Record<string, WorkbenchRouteDefinition>;

export type WorkbenchRouteId = keyof typeof WORKBENCH_ROUTES;
export type WorkbenchRoute = WorkbenchRouteDefinition & { id: WorkbenchRouteId };

export const WORKBENCH_ROUTE_LIST = Object.values(WORKBENCH_ROUTES) as WorkbenchRoute[];

const DEFAULT_ROUTE_BY_SECTION: Record<WorkspaceSectionId, WorkbenchRouteId> = {
  "overview-center": "overview",
  "conversation-center": "conversations",
  "routing-center": "routing",
  "send-center": "sendQueue",
  "wechat-channel-center": "integrationChannels",
  "personal-wechat-center": "personalWechatControl",
  "design-platform-config": "designSettings",
  "asset-center": "designAssets",
  "design-center": "designJobs",
  "review-center": "reviewInbox",
  "sku-library": "catalogProducts",
  "catalog-center": "catalogImport",
  "quote-center": "salesOverview",
  "notice-center": "automationRuns",
  "agent-center": "agents",
  "training-center": "trainingImport",
  "account-center": "settingsAccess",
};

const SEND_ROUTE_BY_VIEW: Record<SendWorkbenchView, WorkbenchRouteId> = {
  queue: "sendQueue",
  blocked: "sendBlocked",
  diagnostics: "sendDiagnostics",
};
const WECHAT_ROUTE_BY_VIEW: Record<WechatWorkbenchView, WorkbenchRouteId> = {
  channels: "wechatWorkChannels",
  flow: "wechatWorkFlow",
  config: "wechatWorkSettings",
};
const PERSONAL_WECHAT_ROUTE_BY_VIEW: Record<PersonalWechatRouteView, WorkbenchRouteId> = {
  instances: "personalWechatInstances",
  control: "personalWechatControl",
  inbound: "personalWechatInbound",
  safety: "personalWechatSafety",
};
const REVIEW_ROUTE_BY_VIEW: Record<ReviewWorkbenchView, WorkbenchRouteId> = {
  handoff: "reviewInbox",
  design: "reviewDesign",
  quote: "reviewQuotes",
  order: "reviewOrders",
  logs: "reviewLogs",
};
const SALES_ROUTE_BY_VIEW: Record<SalesWorkbenchView, WorkbenchRouteId> = {
  overview: "salesOverview",
  actions: "salesActions",
  quotes: "salesQuotes",
  orders: "salesOrders",
};
const SKU_ROUTE_BY_VIEW: Record<SkuWorkbenchView, WorkbenchRouteId> = {
  catalog: "catalogProducts",
  repair: "catalogRepair",
  editor: "catalogEditor",
};
const CATALOG_ROUTE_BY_VIEW: Record<CatalogWorkbenchView, WorkbenchRouteId> = {
  import: "catalogImport",
  preview: "catalogPreview",
  audit: "catalogAudit",
  bundle: "catalogBundles",
};
const AUTOMATION_ROUTE_BY_VIEW: Record<AutomationWorkbenchView, WorkbenchRouteId> = {
  automation: "automationRuns",
  control: "automationControl",
  issues: "automationIssues",
  history: "automationHistory",
};
const TRAINING_ROUTE_BY_VIEW: Record<TrainingWorkbenchView, WorkbenchRouteId> = {
  import: "trainingImport",
  history: "trainingImportHistory",
  review: "trainingReview",
  batch: "trainingReviewBatch",
  skills: "trainingSkills",
};
const ACCOUNT_ROUTE_BY_VIEW: Record<AccountWorkbenchView, WorkbenchRouteId> = {
  wechat: "settingsAccounts",
  access: "settingsAccess",
};

export function getWorkbenchRoute(routeId: WorkbenchRouteId): WorkbenchRoute {
  return WORKBENCH_ROUTES[routeId];
}

export function getWorkbenchRouteSelection(route: WorkbenchRoute): WorkbenchRouteSelection {
  return { ...(route.initialView || {}) };
}

export function getWorkbenchRouteForSection(
  sectionId: WorkspaceSectionId,
  selection: WorkbenchRouteSelection = {},
): WorkbenchRoute {
  let routeId = DEFAULT_ROUTE_BY_SECTION[sectionId];
  if (sectionId === "send-center" && selection.send) routeId = SEND_ROUTE_BY_VIEW[selection.send];
  if (sectionId === "wechat-channel-center" && selection.wechat) routeId = WECHAT_ROUTE_BY_VIEW[selection.wechat];
  if (sectionId === "personal-wechat-center" && selection.personalWechat) {
    routeId = PERSONAL_WECHAT_ROUTE_BY_VIEW[selection.personalWechat];
  }
  if (sectionId === "review-center" && selection.review) routeId = REVIEW_ROUTE_BY_VIEW[selection.review];
  if (sectionId === "quote-center" && selection.sales) routeId = SALES_ROUTE_BY_VIEW[selection.sales];
  if (sectionId === "sku-library" && selection.sku) routeId = SKU_ROUTE_BY_VIEW[selection.sku];
  if (sectionId === "catalog-center" && selection.catalog) routeId = CATALOG_ROUTE_BY_VIEW[selection.catalog];
  if (sectionId === "notice-center" && selection.automation) routeId = AUTOMATION_ROUTE_BY_VIEW[selection.automation];
  if (sectionId === "training-center" && selection.training) routeId = TRAINING_ROUTE_BY_VIEW[selection.training];
  if (sectionId === "account-center" && selection.account) routeId = ACCOUNT_ROUTE_BY_VIEW[selection.account];
  return getWorkbenchRoute(routeId);
}

export function getWorkbenchRouteFromPathname(pathname: string): WorkbenchRoute | null {
  const normalized = normalizePathname(pathname);
  return WORKBENCH_ROUTE_LIST.find((route) => matchesRoutePath(route.href, normalized)) || null;
}

export function getWorkbenchRouteFromLegacyHash(hash: string): WorkbenchRoute {
  const rawHash = hash.replace(/^#/, "");
  let normalized = rawHash;
  try {
    normalized = decodeURIComponent(rawHash);
  } catch {
    // Malformed legacy bookmarks must fall back safely instead of breaking the root route.
  }
  normalized = normalized.trim();
  if (!normalized) return WORKBENCH_ROUTES.overview;
  const exactRoute = WORKBENCH_ROUTE_LIST.find((route) => route.legacyHash === normalized);
  if (exactRoute) return exactRoute;
  const sectionId = normalized.split(":", 1)[0] as WorkspaceSectionId;
  const routeId = DEFAULT_ROUTE_BY_SECTION[sectionId];
  return routeId ? getWorkbenchRoute(routeId) : WORKBENCH_ROUTES.overview;
}

function normalizePathname(pathname: string) {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  if (pathOnly === "/") return pathOnly;
  return pathOnly.replace(/\/+$/, "");
}

function matchesRoutePath(routePattern: string, pathname: string) {
  const routeParts = routePattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (routeParts.length !== pathParts.length) return false;
  return routeParts.every((part, index) => /^\[[^\]]+\]$/.test(part) || part === pathParts[index]);
}
