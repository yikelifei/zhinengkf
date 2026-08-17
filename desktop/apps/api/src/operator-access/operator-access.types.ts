export const OPERATOR_ROLES = ["admin", "supervisor", "agent", "read_only"] as const;
export const OPERATOR_CAPABILITIES = [
  "view_console",
  "manage_channels",
  "manage_assignments",
  "reply_conversations",
  "approve_send",
  "manage_design_executions",
  "manage_order_fulfillment",
  "manage_training",
  "execute_agent_skills",
  "manage_roles",
] as const;

export type OperatorRole = (typeof OPERATOR_ROLES)[number];
export type OperatorCapability = (typeof OPERATOR_CAPABILITIES)[number];

export type TrustedOperatorPrincipal = Readonly<{
  id: "local_admin";
  displayName: string;
  role: "admin";
  authenticationProvider: "local_desktop_session";
}>;

export type OperatorAccessEvaluationInput = {
  role?: string;
  capability?: string;
};

export type OperatorAccessEvaluation = {
  mode: "preflight_only";
  role: string | null;
  capability: string | null;
  roleKnown: boolean;
  capabilityKnown: boolean;
  policyAllows: boolean;
  authorizationGranted: false;
  enforcementApplied: false;
  trustedPrincipal: false;
  decision: "policy_match" | "policy_denied";
  reason: string;
  notice: string;
};
