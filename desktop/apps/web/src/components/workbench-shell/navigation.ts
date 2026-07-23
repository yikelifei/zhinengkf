import {
  Bell,
  Bot,
  BrainCircuit,
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
} from "lucide-react";
import type { WorkbenchNavigationGroup } from "./types";

export const DEFAULT_WORKBENCH_NAVIGATION: WorkbenchNavigationGroup[] = [
  {
    id: "workbench",
    label: "工作台",
    items: [
      {
        id: "overview-center",
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
        label: "会话管理",
        icon: MessagesSquare,
        controlsId: "conversation-center",
        mobilePriority: 2,
      },
      { id: "routing-center", label: "路由与分配", icon: Route, controlsId: "routing-center" },
      { id: "send-center", label: "消息发送", icon: Send, controlsId: "send-center" },
    ],
  },
  {
    id: "wechat",
    label: "微信接入",
    items: [
      {
        id: "wechat-channel-center",
        label: "微信接入",
        icon: Cable,
        controlsId: "wechat-channel-center",
        mobilePriority: 3,
      },
      {
        id: "personal-wechat-center",
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
        label: "平台配置",
        icon: SlidersHorizontal,
        controlsId: "design-platform-config",
      },
      { id: "asset-center", label: "素材管理", icon: Image, controlsId: "asset-center" },
      {
        id: "design-center",
        label: "设计任务",
        icon: Palette,
        controlsId: "design-center",
        mobilePriority: 4,
      },
      { id: "review-center", label: "效果图审核", icon: CheckCircle, controlsId: "review-center" },
    ],
  },
  {
    id: "commerce",
    label: "商品与订单",
    items: [
      { id: "sku-library", label: "商品库", icon: Package, controlsId: "sku-library" },
      { id: "catalog-center", label: "搭配目录", icon: Library, controlsId: "catalog-center" },
      { id: "quote-center", label: "报价管理", icon: FileText, controlsId: "quote-center" },
    ],
  },
  {
    id: "automation",
    label: "自动化与训练",
    items: [
      { id: "notice-center", label: "提醒中心", icon: Bell, controlsId: "notice-center" },
      { id: "agent-center", label: "智能客服 Agent", icon: Bot, controlsId: "agent-center" },
      { id: "training-center", label: "模型训练", icon: GraduationCap, controlsId: "training-center" },
    ],
  },
  {
    id: "system",
    label: "系统管理",
    items: [
      { id: "ai-model-settings", label: "大模型中心", icon: BrainCircuit, controlsId: "ai-model-settings" },
      { id: "account-center", label: "账号与权限", icon: Shield, controlsId: "account-center" },
    ],
  },
];
