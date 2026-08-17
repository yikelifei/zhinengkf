import { OperatorCapability, OperatorRole } from "./operator-access.types";

const capabilitySet = (...capabilities: OperatorCapability[]): readonly OperatorCapability[] => Object.freeze(capabilities);

export const OPERATOR_CAPABILITY_MATRIX = Object.freeze({
  admin: capabilitySet(
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
  ),
  supervisor: capabilitySet(
    "view_console",
    "manage_channels",
    "manage_assignments",
    "reply_conversations",
    "approve_send",
    "manage_design_executions",
    "manage_order_fulfillment",
    "manage_training",
    "execute_agent_skills",
  ),
  agent: capabilitySet("view_console", "reply_conversations"),
  read_only: capabilitySet("view_console"),
}) satisfies Readonly<Record<OperatorRole, readonly OperatorCapability[]>>;
