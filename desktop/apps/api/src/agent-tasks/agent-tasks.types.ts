export type AgentTaskApprovalDecisionPayload = {
  decision?: "approved" | "rejected";
  reviewer?: string;
  note?: string;
};

export type AgentTaskToolExecutionPayload = {
  idempotencyKey?: string;
  input?: Record<string, unknown>;
};
