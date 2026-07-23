export const CONVERSATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const CONVERSATION_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export const CONVERSATION_SLA_STATES = ["no_sla", "on_track", "overdue", "closed", "invalid"] as const;

export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type ConversationSlaState = (typeof CONVERSATION_SLA_STATES)[number];

export type ConversationOperationsIdentity = {
  wechatAccountId: string;
  conversationId: string;
  customerId: string;
};

export type ConversationOperationsQuery = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
  assignee?: string;
  priority?: string;
  status?: string;
  slaState?: string;
  overdue?: string | boolean;
  slaDueAt?: string;
  firstResponseDueAt?: string;
  slaDueBefore?: string;
  firstResponseDueBefore?: string;
  limit?: string | number;
  offset?: string | number;
};

export type ConversationOperationsUpdatePayload = {
  expectedWechatAccountId?: string;
  expectedConversationId?: string;
  expectedCustomerId?: string;
  assignee?: string | null;
  priority?: string;
  status?: string;
  slaDueAt?: string | null;
  firstResponseDueAt?: string | null;
  operator?: string;
  reason?: string;
};
