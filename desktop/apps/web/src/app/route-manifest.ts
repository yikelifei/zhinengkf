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
    responsibility: "筛选并选择需要处理的客户会话。",
    primaryAction: "打开一条会话",
    legacyHash: "conversation-center",
  },
  conversationDetail: {
    id: "conversationDetail",
    href: "/conversations/[id]",
    sectionId: "conversation-center",
    title: "会话详情",
    responsibility: "阅读一条会话并提交人工回复。",
    primaryAction: "人工回复入队",
    legacyHash: "conversation-center:detail",
  },
  conversationContext: {
    id: "conversationContext",
    href: "/conversations/[id]/context",
    sectionId: "conversation-center",
    title: "客户与会话资料",
    responsibility: "只读查看一条会话绑定的客户、任务、SLA 和发送身份。",
    primaryAction: "查看会话资料",
    legacyHash: "conversation-center:context",
    showInModuleNav: false,
  },
  conversationAssignment: {
    id: "conversationAssignment",
    href: "/conversations/[id]/assignment",
    sectionId: "conversation-center",
    title: "会话分配与 SLA",
    responsibility: "修改一条会话的负责人、优先级、生命周期和服务时限。",
    primaryAction: "保存分配与 SLA",
    legacyHash: "conversation-center:assignment",
    showInModuleNav: false,
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
  routingProcess: {
    id: "routingProcess",
    href: "/routing/process",
    sectionId: "routing-center",
    title: "处理客户消息",
    responsibility: "写入一条客户消息并执行服务端路由计划。",
    primaryAction: "确认处理客户消息",
    legacyHash: "routing-center:process",
    showInModuleNav: false,
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
  sendQueueTask: {
    id: "sendQueueTask",
    href: "/send/queue/[id]",
    sectionId: "send-center",
    title: "发送任务",
    responsibility: "核对并执行一项已进入安全发送队列的任务。",
    primaryAction: "执行当前发送任务",
    legacyHash: "send-center:queue:task",
    initialView: { send: "queue" },
    showInModuleNav: false,
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
  sendBlockedTask: {
    id: "sendBlockedTask",
    href: "/send/blocked/[id]",
    sectionId: "send-center",
    title: "拦截任务判断",
    responsibility: "判断一项被阻断任务应重新排队还是取消。",
    primaryAction: "提交当前任务判断",
    legacyHash: "send-center:blocked:task",
    initialView: { send: "blocked" },
    showInModuleNav: false,
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
  sendDiagnosticOperations: {
    id: "sendDiagnosticOperations",
    href: "/send/diagnostics/operations",
    sectionId: "send-center",
    title: "发送诊断操作",
    responsibility: "运行桥接回执入库与发送异常扫描。",
    primaryAction: "扫描发送异常",
    legacyHash: "send-center:diagnostics:operations",
    initialView: { send: "diagnostics" },
    showInModuleNav: false,
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
  },
  wechatWorkSettings: {
    id: "wechatWorkSettings",
    href: "/integrations/wechat-work/settings",
    sectionId: "wechat-channel-center",
    title: "企业微信配置",
    responsibility: "只读核对企业微信本机配置、回调地址和固定身份策略。",
    primaryAction: "刷新配置检查",
    legacyHash: "wechat-channel-center:config",
    initialView: { wechat: "config" },
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
  personalWechatInstanceConfig: {
    id: "personalWechatInstanceConfig",
    href: "/integrations/personal-wechat/instances/configure",
    sectionId: "personal-wechat-center",
    title: "个人微信实例配置",
    responsibility: "校验并保存一个个人微信本机 RPA 实例。",
    primaryAction: "保存实例",
    legacyHash: "personal-wechat-center:instance-config",
    showInModuleNav: false,
  },
  personalWechatControl: {
    id: "personalWechatControl",
    href: "/integrations/personal-wechat/control",
    sectionId: "personal-wechat-center",
    title: "个人微信账号控制",
    responsibility: "查看账号可用状态并导航到独立操作页。",
    primaryAction: "刷新账号状态",
    legacyHash: "personal-wechat-center:control",
    initialView: { personalWechat: "control" },
  },
  personalWechatInbound: {
    id: "personalWechatInbound",
    href: "/integrations/personal-wechat/window-inbound",
    sectionId: "personal-wechat-center",
    title: "个人微信窗口证据",
    responsibility: "采集真实微信窗口证据并查看已入库快照。",
    primaryAction: "采集当前窗口",
    legacyHash: "personal-wechat-center:inbound",
    initialView: { personalWechat: "inbound" },
  },
  personalWechatInboundDrill: {
    id: "personalWechatInboundDrill",
    href: "/integrations/personal-wechat/inbound-drill",
    sectionId: "personal-wechat-center",
    title: "个人微信入站演练",
    responsibility: "提交带完整身份的个人微信受控入站演练。",
    primaryAction: "提交入站演练",
    legacyHash: "personal-wechat-center:inbound-drill",
  },
  personalWechatSafety: {
    id: "personalWechatSafety",
    href: "/integrations/personal-wechat/safety",
    sectionId: "personal-wechat-center",
    title: "个人微信发送治理",
    responsibility: "审阅阻断任务与不确定投递证据。",
    primaryAction: "刷新安全证据",
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
    responsibility: "查看并打开真实设计任务，不执行提交或轮询。",
    primaryAction: "查看任务详情",
    legacyHash: "design-center",
  },
  designJobDetail: {
    id: "designJobDetail",
    href: "/design/jobs/[id]",
    sectionId: "design-center",
    title: "设计任务详情",
    responsibility: "只读核对一条设计任务的身份、预算和候选图。",
    primaryAction: "选择后续操作",
    legacyHash: "design-center:detail",
  },
  designJobSubmit: {
    id: "designJobSubmit",
    href: "/design/jobs/[id]/submit",
    sectionId: "design-center",
    title: "提交设计任务",
    responsibility: "预检并正式提交一条设计任务。",
    primaryAction: "确认正式提交",
    legacyHash: "design-center:submit",
    showInModuleNav: false,
  },
  designJobStatus: {
    id: "designJobStatus",
    href: "/design/jobs/[id]/status",
    sectionId: "design-center",
    title: "同步设计状态",
    responsibility: "查询并更新一条设计任务的远端状态。",
    primaryAction: "同步远端状态",
    legacyHash: "design-center:status",
    showInModuleNav: false,
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
  reviewDesignDecision: {
    id: "reviewDesignDecision",
    href: "/reviews/design/[id]",
    sectionId: "review-center",
    title: "设计审核决策",
    responsibility: "核对并提交一项设计任务的审核决策。",
    primaryAction: "提交当前设计决策",
    legacyHash: "review-center:design:decision",
    initialView: { review: "design" },
    showInModuleNav: false,
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
  reviewQuoteDecision: {
    id: "reviewQuoteDecision",
    href: "/reviews/quotes/[id]",
    sectionId: "review-center",
    title: "报价审核决策",
    responsibility: "核对并提交一项报价的审核决策。",
    primaryAction: "提交当前报价决策",
    legacyHash: "review-center:quote:decision",
    initialView: { review: "quote" },
    showInModuleNav: false,
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
  reviewOrderDecision: {
    id: "reviewOrderDecision",
    href: "/reviews/orders/[id]",
    sectionId: "review-center",
    title: "订单审核决策",
    responsibility: "核对并提交一项订单确认或跟进审核决策。",
    primaryAction: "提交当前订单决策",
    legacyHash: "review-center:order:decision",
    initialView: { review: "order" },
    showInModuleNav: false,
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
    responsibility: "查找并打开真实商品，不执行新增或编辑。",
    primaryAction: "查看商品详情",
    legacyHash: "sku-library:catalog",
    initialView: { sku: "catalog" },
  },
  catalogProductDetail: {
    id: "catalogProductDetail",
    href: "/catalog/products/[skuCode]",
    sectionId: "sku-library",
    title: "商品详情",
    responsibility: "只读核对一个 SKU 的价格、库存、供应与状态。",
    primaryAction: "打开商品编辑",
    legacyHash: "sku-library:catalog:detail",
    initialView: { sku: "catalog" },
    showInModuleNav: false,
  },
  catalogRepair: {
    id: "catalogRepair",
    href: "/catalog/repair",
    sectionId: "sku-library",
    title: "商品修复",
    responsibility: "查看审计产生的商品修复队列，不直接修改商品。",
    primaryAction: "打开修复任务",
    legacyHash: "sku-library:repair",
    initialView: { sku: "repair" },
  },
  catalogRepairDetail: {
    id: "catalogRepairDetail",
    href: "/catalog/repair/[skuCode]",
    sectionId: "sku-library",
    title: "修复单个商品",
    responsibility: "只修复一个 SKU 的库存、供应商或交期字段。",
    primaryAction: "确认提交修复",
    legacyHash: "sku-library:repair:detail",
    initialView: { sku: "repair" },
    showInModuleNav: false,
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
    responsibility: "查找并打开报价记录，不执行发送或建单。",
    primaryAction: "查看报价详情",
    legacyHash: "quote-center:quotes",
    initialView: { sales: "quotes" },
  },
  salesQuoteDetail: {
    id: "salesQuoteDetail",
    href: "/sales/quotes/[id]",
    sectionId: "quote-center",
    title: "报价详情",
    responsibility: "只读核对一条报价的金额、身份与状态。",
    primaryAction: "选择后续操作",
    legacyHash: "quote-center:quotes:detail",
    initialView: { sales: "quotes" },
  },
  salesQuoteSend: {
    id: "salesQuoteSend",
    href: "/sales/quotes/[id]/send",
    sectionId: "quote-center",
    title: "发送报价",
    responsibility: "把一条已核对身份的报价加入微信发送队列。",
    primaryAction: "确认报价入队",
    legacyHash: "quote-center:quotes:send",
    initialView: { sales: "quotes" },
    showInModuleNav: false,
  },
  salesQuoteCreateOrder: {
    id: "salesQuoteCreateOrder",
    href: "/sales/quotes/[id]/create-order",
    sectionId: "quote-center",
    title: "创建订单草稿",
    responsibility: "只由一条报价创建订单草稿，不发送客户消息。",
    primaryAction: "确认创建订单",
    legacyHash: "quote-center:quotes:create-order",
    initialView: { sales: "quotes" },
    showInModuleNav: false,
  },
  salesOrders: {
    id: "salesOrders",
    href: "/sales/orders",
    sectionId: "quote-center",
    title: "订单管理",
    responsibility: "查找并打开订单记录，不执行编辑或客户跟进。",
    primaryAction: "查看订单详情",
    legacyHash: "quote-center:orders",
    initialView: { sales: "orders" },
  },
  salesOrderDetail: {
    id: "salesOrderDetail",
    href: "/sales/orders/[id]",
    sectionId: "quote-center",
    title: "订单详情",
    responsibility: "只读核对一条订单的金额、身份、付款与状态。",
    primaryAction: "选择后续操作",
    legacyHash: "quote-center:orders:detail",
    initialView: { sales: "orders" },
  },
  salesOrderEdit: {
    id: "salesOrderEdit",
    href: "/sales/orders/[id]/edit",
    sectionId: "quote-center",
    title: "编辑订单字段",
    responsibility: "只保存一条订单的状态、付款状态、负责人和备注。",
    primaryAction: "确认保存字段",
    legacyHash: "quote-center:orders:edit",
    initialView: { sales: "orders" },
    showInModuleNav: false,
  },
  salesOrderConfirmation: {
    id: "salesOrderConfirmation",
    href: "/sales/orders/[id]/messages/confirmation",
    sectionId: "quote-center",
    title: "发送订单确认",
    responsibility: "只把一条订单的确认消息加入微信发送队列。",
    primaryAction: "确认消息入队",
    legacyHash: "quote-center:orders:confirmation",
    initialView: { sales: "orders" },
    showInModuleNav: false,
  },
  salesOrderProduction: {
    id: "salesOrderProduction",
    href: "/sales/orders/[id]/messages/production",
    sectionId: "quote-center",
    title: "发送生产跟进",
    responsibility: "只把一条订单的生产跟进加入微信发送队列。",
    primaryAction: "确认消息入队",
    legacyHash: "quote-center:orders:production",
    initialView: { sales: "orders" },
    showInModuleNav: false,
  },
  salesOrderDelivery: {
    id: "salesOrderDelivery",
    href: "/sales/orders/[id]/messages/delivery",
    sectionId: "quote-center",
    title: "发送发货跟进",
    responsibility: "只把一条订单的发货跟进加入微信发送队列。",
    primaryAction: "确认消息入队",
    legacyHash: "quote-center:orders:delivery",
    initialView: { sales: "orders" },
    showInModuleNav: false,
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
