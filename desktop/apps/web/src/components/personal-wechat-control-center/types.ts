export type PersonalWechatFleetState = "online" | "offline" | "isolated" | "manual";

export type PersonalWechatEndpointState = "ready" | "stale" | "unavailable";

export type PersonalWechatGlobalSendMode = "disabled" | "approval_only" | "operator_assisted";

export type PersonalWechatVoicePolicy = "disabled" | "human_recording" | "ai_disclosed";

export type PersonalWechatWindowIdentity = {
  processId?: number | null;
  windowHandle?: string | null;
  title?: string | null;
  verified: boolean;
  verifiedAtLabel?: string | null;
};

export type PersonalWechatEndpoint = {
  url: string;
  state: PersonalWechatEndpointState;
  stateLabel: string;
  lastSeenLabel?: string | null;
};

export type PersonalWechatAccount = {
  id: string;
  displayName: string;
  maskedAccount?: string | null;
  avatarFallback: string;
  state: PersonalWechatFleetState;
  stateLabel: string;
  stateDetail?: string | null;
  windowsSessionId: string;
  windowsSessionLabel: string;
  endpoint: PersonalWechatEndpoint;
  windowIdentity: PersonalWechatWindowIdentity;
  pendingApprovalCount: number;
  queuedReplyCount: number;
  lastActivityLabel?: string | null;
};

export type PersonalWechatApproval = {
  id: string;
  accountId: string;
  customerLabel: string;
  summary: string;
  requestedAtLabel: string;
  priorityLabel?: string | null;
};

export type PersonalWechatControlCenterActions = {
  onRefresh: () => void;
  onSelectAccount: (accountId: string) => void;
  onGlobalSendModeChange: (mode: PersonalWechatGlobalSendMode) => void;
  onRequestManualTakeover: (accountId: string) => void;
  onReleaseManualTakeover: (accountId: string) => void;
  onIsolateAccount: (accountId: string) => void;
  onRequestReleaseIsolation: (accountId: string) => void;
  onOpenApproval: (approvalId: string) => void;
  onOpenSafetyPolicy?: () => void;
};

export type PersonalWechatControlCenterProps = {
  accounts: PersonalWechatAccount[];
  approvals: PersonalWechatApproval[];
  selectedAccountId?: string | null;
  globalSendMode?: PersonalWechatGlobalSendMode;
  voicePolicy?: PersonalWechatVoicePolicy;
  updatedAtLabel?: string | null;
  busy?: boolean;
  readOnly?: boolean;
  actions: PersonalWechatControlCenterActions;
  className?: string;
};
