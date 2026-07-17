import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceSectionId =
  | "overview-center"
  | "conversation-center"
  | "routing-center"
  | "send-center"
  | "wechat-channel-center"
  | "personal-wechat-center"
  | "design-platform-config"
  | "asset-center"
  | "design-center"
  | "review-center"
  | "sku-library"
  | "catalog-center"
  | "quote-center"
  | "notice-center"
  | "agent-center"
  | "training-center"
  | "account-center";

export type WorkbenchNavigationGroupId =
  | "workbench"
  | "messages"
  | "wechat"
  | "design"
  | "commerce"
  | "automation"
  | "system";

export type WorkbenchNavigationItem = {
  id: WorkspaceSectionId;
  href: `/${string}`;
  label: string;
  icon: LucideIcon;
  controlsId?: string;
  mobilePriority?: number;
  badge?: number | string;
  badgeTone?: "neutral" | "warning" | "danger";
  disabled?: boolean;
};

export type WorkbenchNavigationGroup = {
  id: WorkbenchNavigationGroupId;
  label: string;
  items: WorkbenchNavigationItem[];
};

export type WorkbenchHealthTone = "ready" | "warning" | "danger" | "muted";

export type WorkbenchHealthItem = {
  id: string;
  label: string;
  count?: number | string;
  tone: WorkbenchHealthTone;
};

export type AppSidebarProps = {
  activeSectionId: WorkspaceSectionId | string;
  onSelect?: (sectionId: WorkspaceSectionId) => void;
  groups?: WorkbenchNavigationGroup[];
  brandLabel?: string;
  brandSubtitle?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export type AppTopbarProps = {
  title: string;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  onRefresh?: () => void;
  busy?: boolean;
  healthItems?: WorkbenchHealthItem[];
  onOpenHealth?: () => void;
  actions?: ReactNode;
};

export type WorkbenchShellProps = {
  className?: string;
  activeSectionId: WorkspaceSectionId | string;
  onSelectSection?: (sectionId: WorkspaceSectionId) => void;
  children: ReactNode;
  navigationGroups?: WorkbenchNavigationGroup[];
  sidebar?: Omit<AppSidebarProps, "activeSectionId" | "onSelect" | "groups">;
  topbar?: AppTopbarProps;
  contentLabel?: string;
};
