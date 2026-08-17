export const AGENT_SKILL_ACTION_KEYS = [
  "skill.instruction_preview",
  "design_platform.health_check",
  "catalog.audit",
  "automation.readiness_check",
] as const;

export type AgentSkillActionKey = (typeof AGENT_SKILL_ACTION_KEYS)[number];

export type AgentSkillExecutionPolicy = Readonly<{
  actionKey: AgentSkillActionKey;
  label: string;
  description: string;
  mode: "allowlist_read_only";
  riskLevel: "read_only";
  sideEffects: "none";
  timeoutMs: number;
  confirmationRequired: true;
  confirmationText: string;
  rollbackMode: "not_required_read_only";
  canExecute: boolean;
  blockedReason: string | null;
}>;

type AgentSkillPolicyInput = {
  id: string;
  agentId?: string;
  agentKey?: string;
  name?: string;
  enabled?: boolean;
};

type ActionDefinition = Omit<
  AgentSkillExecutionPolicy,
  "confirmationText" | "canExecute" | "blockedReason"
>;

const DEFAULT_ACTION: ActionDefinition = Object.freeze({
  actionKey: "skill.instruction_preview",
  label: "预览 Skill 指令",
  description: "读取当前 Skill 的用途和指令，不调用外部服务。",
  mode: "allowlist_read_only",
  riskLevel: "read_only",
  sideEffects: "none",
  timeoutMs: 2_000,
  confirmationRequired: true,
  rollbackMode: "not_required_read_only",
});

const SPECIAL_ACTIONS = new Map<string, ActionDefinition>([
  [
    policyKey("gift_design", "设计需求确认"),
    Object.freeze({
      actionKey: "design_platform.health_check",
      label: "检查臻希 AI 连接",
      description: "只读取臻希 AI 健康状态，不生成图片、不扣费。",
      mode: "allowlist_read_only",
      riskLevel: "read_only",
      sideEffects: "none",
      timeoutMs: 5_000,
      confirmationRequired: true,
      rollbackMode: "not_required_read_only",
    }),
  ],
  [
    policyKey("gift_design", "预算澄清"),
    Object.freeze({
      actionKey: "catalog.audit",
      label: "检查商品库完整性",
      description: "只统计商品库问题，不修改价格、库存或图片。",
      mode: "allowlist_read_only",
      riskLevel: "read_only",
      sideEffects: "none",
      timeoutMs: 8_000,
      confirmationRequired: true,
      rollbackMode: "not_required_read_only",
    }),
  ],
  [
    policyKey("pre_sales", "转化推进"),
    Object.freeze({
      actionKey: "automation.readiness_check",
      label: "检查自动化就绪状态",
      description: "只读取自动化和队列状态，不启动任务、不发送消息。",
      mode: "allowlist_read_only",
      riskLevel: "read_only",
      sideEffects: "none",
      timeoutMs: 8_000,
      confirmationRequired: true,
      rollbackMode: "not_required_read_only",
    }),
  ],
]);

export function agentSkillExecutionPolicy(skill: AgentSkillPolicyInput): AgentSkillExecutionPolicy {
  const scopeKey = normalizedAgentKey(skill.agentKey, skill.agentId);
  const definition =
    SPECIAL_ACTIONS.get(policyKey(scopeKey, skill.name)) ||
    [...SPECIAL_ACTIONS.entries()].find(([key]) => key.endsWith(`:${String(skill.name || "").trim()}`))?.[1] ||
    DEFAULT_ACTION;
  const canExecute = skill.enabled !== false;
  return Object.freeze({
    ...definition,
    confirmationText: `EXECUTE_AGENT_SKILL:${skill.id}`,
    canExecute,
    blockedReason: canExecute ? null : "Skill 已停用，不能执行。",
  });
}

function policyKey(agentId?: string, name?: string) {
  return `${String(agentId || "").trim()}:${String(name || "").trim()}`;
}

function normalizedAgentKey(agentKey?: string, agentId?: string) {
  const explicitKey = String(agentKey || "").trim();
  if (explicitKey) return explicitKey;
  const id = String(agentId || "").trim();
  return id.startsWith("agent_") ? id.slice("agent_".length) : id;
}
