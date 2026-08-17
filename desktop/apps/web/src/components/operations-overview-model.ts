import {
  AlertTriangle,
  CircleCheck,
  CircleDot,
  Clock3,
} from "lucide-react";

export type OverviewTone = "ready" | "warning" | "danger" | "muted";

export type OverviewChannel = {
  id: string;
  label: string;
  detail: string;
  statusLabel: string;
  tone: OverviewTone;
  metrics?: string;
};

export type OverviewAction = {
  id: string;
  label: string;
  detail: string;
  count?: number;
  tone: OverviewTone;
  onClick: () => void;
};

export type OverviewMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone?: OverviewTone;
};

export type OverviewConversation = {
  id: string;
  customer: string;
  channel: string;
  account: string;
  state: string;
  stateTone: OverviewTone;
  preview: string;
  updatedAt: string;
  unreadCount: number;
  onOpen: () => void;
};

export type OverviewLaunchItem = {
  id: string;
  title: string;
  detail: string;
  statusLabel: string;
  tone: OverviewTone;
  phaseLabel: string;
  ownerLabel: string;
  action: string;
};

export type OperationsOverviewProps = {
  updatedAt?: string;
  channels: OverviewChannel[];
  channelsLoaded: boolean;
  actions: OverviewAction[];
  actionsLoaded: boolean;
  metrics: OverviewMetric[];
  conversations: OverviewConversation[];
  conversationsLoaded: boolean;
  launchLoaded: boolean;
  launchPhaseLabel: string;
  launchRecommendedAction: string;
  launchTone: OverviewTone;
  launchItems: OverviewLaunchItem[];
  automationLabel: string;
  automationDetail: string;
  automationTone: OverviewTone;
  onRefresh: () => void;
  onOpenConversations: () => void;
  onOpenChannels: () => void;
  onOpenLaunchPlan: () => void;
  onRunAutomation: () => void;
  busy?: boolean;
};

export const toneIcon = {
  ready: CircleCheck,
  warning: Clock3,
  danger: AlertTriangle,
  muted: CircleDot,
} as const;

export function formatOverviewTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
