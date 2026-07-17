export type PersonalWechatWorkspaceAccount = {
  id: string;
  displayName: string;
  endpoint: string;
  enabled: boolean;
  tokenConfigured: boolean;
  updatedAt?: string | null;
  windowsSessionId?: string | null;
};
export type PersonalWechatWorkspaceTask = {
  id: string;
  accountId: string;
  customerLabel: string;
  summary: string;
  status: string;
  createdAt: string;
  deliveryState?: string | null;
};

export type PersonalWechatWorkspaceView = "accounts" | "voice" | "safety";

export type PersonalWechatWorkspaceProps = {
  accounts: PersonalWechatWorkspaceAccount[];
  tasks: PersonalWechatWorkspaceTask[];
  updatedAtLabel?: string | null;
  operatorLabel?: string;
  organizationLabel?: string;
  busy?: boolean;
  activeView?: PersonalWechatWorkspaceView;
  onActiveViewChange?: (view: PersonalWechatWorkspaceView) => void;
  onRefresh: () => void;
  onOpenInstanceSettings: (accountId?: string) => void;
  onOpenTask: (taskId: string) => void;
  onStatusMessage?: (message: string) => void;
  fixedView?: PersonalWechatWorkspaceView;
  onOpenSafetyPolicy?: () => void;
};
