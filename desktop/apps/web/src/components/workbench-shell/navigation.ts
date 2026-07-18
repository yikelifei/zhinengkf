import {
  Bell,
  Bot,
  Cable,
  CheckCircle,
  FileText,
  GraduationCap,
  Image,
  LayoutDashboard,
  Library,
  MessagesSquare,
  Package,
  Palette,
  Route,
  Send,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Workflow,
} from "lucide-react";
import { WORKBENCH_ROUTES } from "../../app/route-manifest";
import type { WorkbenchNavigationGroup } from "./types";

export const DEFAULT_WORKBENCH_NAVIGATION: WorkbenchNavigationGroup[] = [
  {
    id: "workbench",
    label: "工作台",
    items: [
      {
        id: "overview-center",
        href: WORKBENCH_ROUTES.overview.href,
        label: "运营总览",
        icon: LayoutDashboard,
        mobilePriority: 1,
      },
    ],
  },
  {
    id: "messages",
    label: "消息",
    items: [
      {
        id: "conversation-center",
        href: WORKBENCH_ROUTES.conversations.href,
        label: "会话管理",
        icon: MessagesSquare,
        controlsId: "conversation-center",
        mobilePriority: 2,
      },
      { id: "routing-center", href: WORKBENCH_ROUTES.routing.href, label: "路由与分配", icon: Route, controlsId: "routing-center" },
      { id: "send-center", href: WORKBENCH_ROUTES.sendQueue.href, label: "消息发送", icon: Send, controlsId: "send-center" },
    ],
  },
  {
    id: "wechat",
    label: "微信接入",
    items: [
      {
        id: "wechat-channel-center",
        href: WORKBENCH_ROUTES.integrationChannels.href,
        label: "微信接入",
        icon: Cable,
        controlsId: "wechat-channel-center",
        mobilePriority: 3,
      },
      {
        id: "personal-wechat-center",
        href: WORKBENCH_ROUTES.personalWechatControl.href,
        label: "个人微信控制台",
        icon: Smartphone,
        controlsId: "personal-wechat-center",
      },
    ],
  },
  {
    id: "design",
    label: "设计中心",
    items: [
      {
        id: "design-platform-config",
        href: WORKBENCH_ROUTES.designSettings.href,
        label: "平台配置",
        icon: SlidersHorizontal,
        controlsId: "design-platform-config",
      },
      { id: "asset-center", href: WORKBENCH_ROUTES.designAssets.href, label: "素材管理", icon: Image, controlsId: "asset-center" },
      {
        id: "design-center",
        href: WORKBENCH_ROUTES.designJobs.href,
        label: "设计任务",
        icon: Palette,
        controlsId: "design-center",
        mobilePriority: 4,
      },
      { id: "review-center", href: WORKBENCH_ROUTES.reviewInbox.href, label: "人工审核", icon: CheckCircle, controlsId: "review-center" },
    ],
  },
  {
    id: "commerce",
    label: "商品与订单",
    items: [
      { id: "sku-library", href: WORKBENCH_ROUTES.catalogProducts.href, label: "商品库", icon: Package, controlsId: "sku-library" },
      { id: "catalog-center", href: WORKBENCH_ROUTES.catalogImport.href, label: "搭配目录", icon: Library, controlsId: "catalog-center" },
      { id: "sales-center", href: WORKBENCH_ROUTES.salesQuotes.href, label: "销售管理", icon: FileText, controlsId: "sales-center" },
    ],
  },
  {
    id: "automation",
    label: "自动化与训练",
    items: [
      { id: "notice-center", href: WORKBENCH_ROUTES.notifications.href, label: "提醒中心", icon: Bell, controlsId: "notice-center" },
      { id: "automation-center", href: WORKBENCH_ROUTES.automationRuns.href, label: "自动化管理", icon: Workflow, controlsId: "automation-center" },
      { id: "agent-center", href: WORKBENCH_ROUTES.agents.href, label: "智能客服 Agent", icon: Bot, controlsId: "agent-center" },
      { id: "training-center", href: WORKBENCH_ROUTES.trainingImport.href, label: "模型训练", icon: GraduationCap, controlsId: "training-center" },
    ],
  },
  {
    id: "system",
    label: "系统管理",
    items: [
      { id: "account-center", href: WORKBENCH_ROUTES.settingsAccess.href, label: "账号与权限", icon: Shield, controlsId: "account-center" },
    ],
  },
];
