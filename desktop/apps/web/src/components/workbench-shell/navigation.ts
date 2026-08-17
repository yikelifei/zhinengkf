import {
  Bell,
  Bot,
  AppWindow,
  CheckCircle,
  FileText,
  GraduationCap,
  Image,
  LayoutDashboard,
  Library,
  MessagesSquare,
  Package,
  Palette,
  QrCode,
  Route,
  Send,
  Shield,
  Sparkles,
  Workflow,
} from "lucide-react";
import { WORKBENCH_ROUTES } from "../../app/route-manifest";
import type { WorkbenchNavigationGroup } from "./types";

export const DEFAULT_WORKBENCH_NAVIGATION: WorkbenchNavigationGroup[] = [
  {
    id: "workbench",
    label: "今日工作",
    items: [
      {
        id: "overview-center",
        href: WORKBENCH_ROUTES.overview.href,
        label: "运营总览",
        icon: LayoutDashboard,
        mobilePriority: 1,
      },
      {
        id: "wecom-workspace",
        href: WORKBENCH_ROUTES.wechatWorkWorkspace.href,
        label: "企业微信",
        icon: AppWindow,
        controlsId: "wecom-workspace",
        mobilePriority: 2,
      },
      {
        id: "conversation-center",
        href: WORKBENCH_ROUTES.conversations.href,
        label: "会话管理",
        icon: MessagesSquare,
        controlsId: "conversation-center",
        mobilePriority: 3,
      },
      { id: "review-center", href: WORKBENCH_ROUTES.reviewInbox.href, label: "人工审核", icon: CheckCircle, controlsId: "review-center", mobilePriority: 4 },
    ],
  },
  {
    id: "commerce",
    label: "方案与成交",
    items: [
      {
        id: "wechat-channel-center",
        href: WORKBENCH_ROUTES.wechatWorkCustomers.href,
        label: "客户入口",
        icon: QrCode,
        controlsId: "wechat-channel-center",
      },
      { id: "sku-library", href: WORKBENCH_ROUTES.catalogProducts.href, label: "商品库", icon: Package, controlsId: "sku-library" },
      { id: "catalog-center", href: WORKBENCH_ROUTES.catalogBundles.href, label: "AI 搭品", icon: Library, controlsId: "catalog-center" },
      {
        id: "design-center",
        href: WORKBENCH_ROUTES.designJobs.href,
        label: "设计任务",
        icon: Palette,
        controlsId: "design-center",
      },
      { id: "sales-center", href: WORKBENCH_ROUTES.salesQuotes.href, label: "销售管理", icon: FileText, controlsId: "sales-center" },
    ],
  },
  {
    id: "automation",
    label: "运营与提效",
    items: [
      { id: "send-center", href: WORKBENCH_ROUTES.sendQueue.href, label: "消息发送", icon: Send, controlsId: "send-center" },
      { id: "notice-center", href: WORKBENCH_ROUTES.notifications.href, label: "提醒中心", icon: Bell, controlsId: "notice-center" },
      { id: "automation-center", href: WORKBENCH_ROUTES.automationRuns.href, label: "自动化管理", icon: Workflow, controlsId: "automation-center" },
      { id: "training-center", href: WORKBENCH_ROUTES.trainingKnowledge.href, label: "知识库 / Skill", icon: GraduationCap, controlsId: "training-center" },
    ],
  },
  {
    id: "system",
    label: "能力与配置",
    items: [
      {
        id: "design-platform-config",
        href: WORKBENCH_ROUTES.designZhenxiAi.href,
        label: "臻希 AI",
        icon: Sparkles,
        controlsId: "design-platform-config",
      },
      { id: "asset-center", href: WORKBENCH_ROUTES.designAssets.href, label: "素材管理", icon: Image, controlsId: "asset-center" },
      { id: "agent-center", href: WORKBENCH_ROUTES.agents.href, label: "智能客服 Agent", icon: Bot, controlsId: "agent-center" },
      { id: "routing-center", href: WORKBENCH_ROUTES.routing.href, label: "路由与分配", icon: Route, controlsId: "routing-center" },
      { id: "account-center", href: WORKBENCH_ROUTES.settingsDeliveryReadiness.href, label: "系统管理", icon: Shield, controlsId: "account-center" },
    ],
  },
];
