import type { ReactNode } from "react";

export type ConversationWorkbenchPane = "inbox" | "thread" | "context";

export type ConversationWorkbenchTone = "neutral" | "brand" | "success" | "warning" | "danger";

export type ConversationWorkbenchOption = {
  value: string;
  label: string;
  count?: number;
};

export type ConversationWorkbenchAvatar = {
  imageUrl?: string | null;
  fallback: string;
  alt: string;
};

export type ConversationWorkbenchConversation = {
  id: string;
  title: string;
  subtitle?: string;
  avatar: ConversationWorkbenchAvatar;
  channelLabel: string;
  channelTone: ConversationWorkbenchTone;
  preview: string;
  updatedAtLabel: string;
  unreadCount?: number;
  stateLabel?: string;
  stateTone?: ConversationWorkbenchTone;
};

export type ConversationWorkbenchInbox = {
  title: string;
  total: number;
  pendingCount: number;
  search: string;
  searchPlaceholder?: string;
  scope: string;
  scopeOptions: ConversationWorkbenchOption[];
  channel: string;
  channelOptions: ConversationWorkbenchOption[];
  status: string;
  statusOptions: ConversationWorkbenchOption[];
  sort: string;
  sortOptions: ConversationWorkbenchOption[];
  conversations: ConversationWorkbenchConversation[];
  selectedConversationId?: string | null;
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions?: number[];
  loading?: boolean;
  error?: string;
  emptyTitle?: string;
  emptyDetail?: string;
};

export type ConversationWorkbenchParticipant = {
  name: string;
  avatar: ConversationWorkbenchAvatar;
  accountLabel: string;
  channelLabel: string;
  channelTone: ConversationWorkbenchTone;
  onlineLabel?: string;
  online?: boolean;
};

export type ConversationWorkbenchAttachment = {
  id: string;
  name: string;
  kind: "image" | "file";
  detail?: string;
};

export type ConversationWorkbenchMessage = {
  id: string;
  direction: "inbound" | "outbound" | "system";
  senderName?: string;
  avatar?: ConversationWorkbenchAvatar;
  text?: string;
  createdAtLabel: string;
  statusLabel?: string;
  statusTone?: ConversationWorkbenchTone;
  attachments?: ConversationWorkbenchAttachment[];
};

export type ConversationWorkbenchIncident = {
  id: string;
  tone: "warning" | "danger";
  title: string;
  occurredAtLabel?: string;
  detail: string;
  reason?: string;
  policyActionLabel?: string;
  retryActionLabel?: string;
  retryDisabled?: boolean;
};

export type ConversationWorkbenchNotice = {
  id: string;
  tone: "warning" | "danger";
  text: string;
  detail?: string;
  dismissible?: boolean;
};

export type ConversationWorkbenchSuggestion = {
  activeTab: string;
  tabs: ConversationWorkbenchOption[];
  title: string;
  verificationLabel?: string;
  text?: string;
  sourceDetail?: string;
  loading?: boolean;
  error?: string;
  useActionLabel?: string;
  regenerateActionLabel?: string;
};

export type ConversationWorkbenchSafetyCheck = {
  id: string;
  label: string;
  statusLabel: string;
  tone: "success" | "warning" | "danger";
};

export type ConversationWorkbenchComposerTool = {
  id: "emoji" | "image" | "file" | "note" | "knowledge" | "script" | "customer" | "order" | string;
  label: string;
  iconOnly?: boolean;
};

export type ConversationWorkbenchComposer = {
  value: string;
  placeholder?: string;
  maxLength: number;
  disabled?: boolean;
  sending?: boolean;
  sendLabel?: string;
  tools: ConversationWorkbenchComposerTool[];
  feedback?: string;
  feedbackTone?: ConversationWorkbenchTone;
};

export type ConversationWorkbenchThread = {
  participant: ConversationWorkbenchParticipant;
  serviceStatusLabel: string;
  serviceStatusTone: ConversationWorkbenchTone;
  manualTakeoverLabel?: string;
  safetyNotice?: string;
  timelineLabel?: string;
  messages: ConversationWorkbenchMessage[];
  incidents: ConversationWorkbenchIncident[];
  notices: ConversationWorkbenchNotice[];
  suggestion: ConversationWorkbenchSuggestion;
  safetyChecks: ConversationWorkbenchSafetyCheck[];
  composer: ConversationWorkbenchComposer;
  loading?: boolean;
  error?: string;
  emptyTitle?: string;
  emptyDetail?: string;
};

export type ConversationWorkbenchCustomer = {
  name: string;
  avatar: ConversationWorkbenchAvatar;
  wechatId?: string;
  region?: string;
  source?: string;
  relationLabel?: string;
  relationTone?: ConversationWorkbenchTone;
};

export type ConversationWorkbenchTask = {
  id: string;
  title: string;
  stateLabel: string;
  stateTone: ConversationWorkbenchTone;
  taskNumber?: string;
  createdAtLabel?: string;
  requirements?: string[];
  dueAtLabel?: string;
};

export type ConversationWorkbenchAssignment = {
  assignee: string;
  team?: string;
  joinedAtLabel?: string;
  statusLabel: string;
  statusTone: ConversationWorkbenchTone;
};

export type ConversationWorkbenchSla = {
  stateLabel: string;
  stateTone: ConversationWorkbenchTone;
  priorityLabel?: string;
  lifecycleLabel?: string;
  firstResponseLabel?: string;
  deadlineLabel?: string;
  freshnessLabel?: string;
  freshnessTone?: ConversationWorkbenchTone;
};

export type ConversationWorkbenchSafetyIdentity = {
  accountLabel: string;
  accountStateLabel?: string;
  channelLabel: string;
  windowLabel?: string;
  recentMessageLabel?: string;
  bridgeLabel?: string;
  bridgeTone?: ConversationWorkbenchTone;
};

export type ConversationWorkbenchQuickAction = {
  id: string;
  label: string;
  tone?: ConversationWorkbenchTone;
  disabled?: boolean;
};

export type ConversationWorkbenchContext = {
  customer: ConversationWorkbenchCustomer;
  tags: string[];
  notes?: string;
  noteDateLabel?: string;
  task?: ConversationWorkbenchTask | null;
  assignment: ConversationWorkbenchAssignment;
  sla: ConversationWorkbenchSla;
  operationsSlot?: ReactNode;
  safetyIdentity: ConversationWorkbenchSafetyIdentity;
  quickActions: ConversationWorkbenchQuickAction[];
};

export type ConversationWorkbenchActions = {
  onPaneChange: (pane: ConversationWorkbenchPane) => void;
  onToggleInbox: () => void;
  onSearchChange: (value: string) => void;
  onOpenFilter?: () => void;
  onScopeChange: (value: string) => void;
  onChannelChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onTransfer: () => void;
  onEndConversation?: () => void;
  onMore?: () => void;
  onOpenIncidentPolicy?: (incidentId: string) => void;
  onRetryIncident?: (incidentId: string) => void;
  onDismissNotice?: (noticeId: string) => void;
  onSuggestionTabChange: (value: string) => void;
  onUseSuggestion: () => void;
  onRegenerateSuggestion: () => void;
  onReplyChange: (value: string) => void;
  onComposerTool?: (toolId: string) => void;
  onSendReply: () => void;
  onEditCustomer?: () => void;
  onAddTag?: () => void;
  onEditNotes?: () => void;
  onOpenTask?: (taskId: string) => void;
  onEditAssignment: () => void;
  onToggleSafety?: () => void;
  onQuickAction?: (actionId: string) => void;
};

export type ConversationWorkbenchProps = {
  inbox: ConversationWorkbenchInbox;
  thread: ConversationWorkbenchThread | null;
  context: ConversationWorkbenchContext | null;
  activePane: ConversationWorkbenchPane;
  inboxCollapsed?: boolean;
  actions: ConversationWorkbenchActions;
  className?: string;
};
