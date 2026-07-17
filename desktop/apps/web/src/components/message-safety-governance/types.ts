export type ConsentState = "granted" | "unsubscribed" | "missing" | "expired";

export type ReviewState = "pending" | "approved" | "rejected";

export type QuarantineState = "isolated" | "reviewing" | "resolved";

export type AuditOutcome = "allowed" | "blocked" | "pending" | "recorded";

export type OperatorIdentity = {
  operatorName: string;
  operatorRole: string;
  organizationName: string;
  businessPurpose: string;
  activeAccountId: string;
};

export type ConsentRecord = {
  customerId: string;
  customerLabel: string;
  state: ConsentState;
  source: string;
  recordedAt: string;
  unsubscribedAt?: string | null;
};

export type AccountBusinessBudget = {
  accountId: string;
  accountLabel: string;
  periodLabel: string;
  limit: number;
  used: number;
  reserved: number;
  resetAt: string;
  enabled: boolean;
};

export type ApprovalItem = {
  id: string;
  accountId: string;
  customerLabel: string;
  contentSummary: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  state: ReviewState;
};

export type SensitiveContentControl = {
  policyVersion: string;
  activeRuleCount: number | null;
  blockedToday: number | null;
  lastEvaluatedAt: string;
  protectedCategories: string[];
};

export type QuarantinedDelivery = {
  id: string;
  accountId: string;
  customerLabel: string;
  contentDigest: string;
  reason: string;
  detectedAt: string;
  state: QuarantineState;
};

export type GovernanceAuditEvent = {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  target: string;
  outcome: AuditOutcome;
  detail: string;
};

export type MessageSafetyGovernanceProps = {
  identity: OperatorIdentity;
  globallyStopped: boolean;
  globalStopReason?: string | null;
  consentRecords: ConsentRecord[];
  accountBudgets: AccountBusinessBudget[];
  approvalQueue: ApprovalItem[];
  sensitiveContent: SensitiveContentControl;
  quarantinedDeliveries: QuarantinedDelivery[];
  auditEvents: GovernanceAuditEvent[];
  busy?: boolean;
  readOnly?: boolean;
  onRequestGlobalStop: () => void;
  onRequestResume: () => void;
  onOpenConsentRecord: (customerId: string) => void;
  onReviewApproval: (approvalId: string) => void;
  onResolveQuarantine: (deliveryId: string) => void;
  onExportAudit: () => void;
};
