import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AutomationSchedulerService } from "../automation/automation-scheduler.service";
import { CatalogService } from "../catalog/catalog.service";
import { DesignPlatformClient } from "../integrations/design-platform/design-platform.client";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import {
  assertExactOperationReplay,
  createOperationFingerprint,
  deterministicOperationId,
  isUniqueConstraintError,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
} from "../shared/operation-idempotency";
import { AgentsService } from "./agents.service";
import {
  agentSkillExecutionPolicy,
  type AgentSkillActionKey,
  type AgentSkillExecutionPolicy,
} from "./agent-skill-actions";

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type ExecuteAgentSkillInput = IdentityFilter & {
  operationKey?: unknown;
  confirmation?: unknown;
};

type AgentRecord = {
  id: string;
  key?: string;
  name?: string;
  skills?: SkillRecord[];
};

type SkillRecord = {
  id: string;
  agentId?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  version?: number;
};

type ReviewLogRecord = {
  id: string;
  targetType: string;
  targetId: string;
  decision: string;
  reviewer: string;
  note?: string | null;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  metadata?: unknown;
  createdAt: string | Date;
};

type JsonRecord = Record<string, unknown>;

const EXECUTION_TARGET_TYPE = "agent_skill_execution";
const EXECUTION_STALE_GRACE_MS = 30_000;
const ALLOWED_PAYLOAD_KEYS = new Set([
  "operationKey",
  "confirmation",
  "wechatAccountId",
  "conversationId",
  "customerId",
]);

@Injectable()
export class AgentSkillExecutorService {
  constructor(
    private readonly agents: AgentsService,
    private readonly localStore: LocalStoreService,
    private readonly prisma: PrismaService,
    private readonly designPlatform: DesignPlatformClient,
    private readonly catalog: CatalogService,
    private readonly automationScheduler: AutomationSchedulerService,
  ) {}

  async execute(
    agentId: string,
    skillId: string,
    payload: ExecuteAgentSkillInput,
    reviewer: string,
  ) {
    this.assertExactPayload(payload);
    const identity = normalizeIdentity(payload);
    const { agent, skill } = await this.findAgentSkill(agentId, skillId, identity);
    const policy = agentSkillExecutionPolicy({
      ...skill,
      agentKey: agent.key,
    });
    if (!policy.canExecute) {
      throw new ConflictException({
        code: "AGENT_SKILL_DISABLED",
        message: policy.blockedReason,
      });
    }
    if (payload.confirmation !== policy.confirmationText) {
      throw new BadRequestException({
        code: "AGENT_SKILL_CONFIRMATION_REQUIRED",
        message: "请先在界面确认本次白名单只读执行。",
      });
    }

    const operationKey = normalizeOperationKey(payload.operationKey, "agent skill execution operationKey");
    const effectKey = `agent-skill-execution:${agent.id}:${skill.id}:${operationKey}`;
    const executionId = deterministicOperationId("review", effectKey);
    const fingerprint = createOperationFingerprint(
      "agent-skill-execution",
      identity,
      {
        agentId: agent.id,
        skillId: skill.id,
        skillVersion: Number(skill.version || 1),
        actionKey: policy.actionKey,
      },
    );
    const operation = requestOperationMetadata(operationKey, fingerprint);
    const existing = await this.getReviewLog(executionId);
    if (existing) {
      const replay = await this.handleExistingExecution(existing, operation, policy);
      if (replay) return replay;
    }

    const claimId = randomUUID();
    const startedAt = new Date().toISOString();
    const running = await this.createReviewLog({
      id: executionId,
      targetType: EXECUTION_TARGET_TYPE,
      targetId: skill.id,
      decision: "execute_agent_skill",
      reviewer,
      note: `${policy.label}：白名单只读执行。`,
      beforeStatus: "confirmed",
      afterStatus: "running",
      metadata: {
        effectKey,
        requestOperation: operation,
        claimId,
        agentId: agent.id,
        agentName: safeText(agent.name, 120),
        skillId: skill.id,
        skillName: safeText(skill.name, 120),
        skillVersion: Number(skill.version || 1),
        actionKey: policy.actionKey,
        actionLabel: policy.label,
        riskLevel: policy.riskLevel,
        sideEffects: policy.sideEffects,
        rollbackMode: policy.rollbackMode,
        startedAt,
        ...identity,
      },
    });

    const runningMetadata = asRecord(running.metadata);
    if (runningMetadata.claimId !== claimId) {
      const replay = await this.handleExistingExecution(running, operation, policy);
      if (replay) return replay;
      throw executionInProgress(running.id);
    }

    try {
      const result = await withTimeout(
        this.runAllowedAction(policy.actionKey, agent, skill),
        policy.timeoutMs,
      );
      const completedAt = new Date().toISOString();
      const response = {
        executionId,
        status: "completed" as const,
        replayed: false,
        policy,
        result,
        startedAt,
        completedAt,
      };
      await this.updateReviewLog(executionId, {
        afterStatus: "completed",
        metadata: {
          ...runningMetadata,
          response,
          resultSummary: executionResultSummary(policy.actionKey, result),
          completedAt,
        },
      });
      return response;
    } catch (error) {
      const failedAt = new Date().toISOString();
      await this.updateReviewLog(executionId, {
        afterStatus: "failed",
        metadata: {
          ...runningMetadata,
          failedAt,
          error: safeExecutionError(error),
        },
      });
      throw new InternalServerErrorException({
        code: "AGENT_SKILL_EXECUTION_FAILED",
        message: "安全动作执行失败，系统已记录审计；请检查对应服务后重试。",
        executionId,
      });
    }
  }

  async listExecutions(agentId: string, skillId: string, identity: IdentityFilter = {}) {
    const normalizedIdentity = normalizeIdentity(identity);
    await this.findAgentSkill(agentId, skillId, normalizedIdentity);
    const logs = await this.listReviewLogs(skillId);
    return logs
      .filter((log) => log.targetType === EXECUTION_TARGET_TYPE && log.targetId === skillId)
      .filter((log) => metadataMatchesIdentity(log.metadata, normalizedIdentity))
      .slice(0, 50)
      .map(publicExecutionLog);
  }

  private async findAgentSkill(agentId: string, skillId: string, identity: IdentityFilter) {
    const rows = await Promise.resolve(this.agents.listAgents(identity)) as AgentRecord[];
    const agent = rows.find((item) => item.id === agentId);
    const skill = agent?.skills?.find((item) => item.id === skillId);
    if (!agent || !skill) {
      throw new NotFoundException({
        code: "AGENT_SKILL_NOT_FOUND",
        message: "未找到当前身份范围内的 Agent Skill。",
      });
    }
    return { agent, skill };
  }

  private async handleExistingExecution(
    existing: ReviewLogRecord,
    operation: ReturnType<typeof requestOperationMetadata>,
    policy: AgentSkillExecutionPolicy,
  ) {
    const metadata = asRecord(existing.metadata);
    assertExactOperationReplay(
      readRequestOperationMetadata(metadata),
      operation,
      "agent skill execution",
    );
    if (existing.afterStatus === "completed" && isRecord(metadata.response)) {
      return {
        ...metadata.response,
        replayed: true,
      };
    }
    if (existing.afterStatus === "running") {
      const startedAt = Date.parse(String(metadata.startedAt || existing.createdAt || ""));
      const staleAfterMs = policy.timeoutMs + EXECUTION_STALE_GRACE_MS;
      if (Number.isFinite(startedAt) && Date.now() - startedAt <= staleAfterMs) {
        throw executionInProgress(existing.id);
      }
      await this.updateReviewLog(existing.id, {
        afterStatus: "failed",
        metadata: {
          ...metadata,
          failedAt: new Date().toISOString(),
          error: {
            code: "STALE_EXECUTION_RECOVERED",
            message: "上一次执行中断，已关闭旧执行记录；请使用新的操作编号重试。",
          },
        },
      });
    }
    throw new ConflictException({
      code: "AGENT_SKILL_EXECUTION_NOT_REPLAYABLE",
      message: "该操作编号已有失败或中断记录，请重新点击执行生成新的操作编号。",
      executionId: existing.id,
    });
  }

  private async runAllowedAction(
    actionKey: AgentSkillActionKey,
    agent: AgentRecord,
    skill: SkillRecord,
  ): Promise<JsonRecord> {
    switch (actionKey) {
      case "skill.instruction_preview":
        return {
          agentId: agent.id,
          agentName: safeText(agent.name, 120),
          skillId: skill.id,
          skillName: safeText(skill.name, 120),
          instruction: safeText(skill.description, 2_000) || "服务端未提供 Skill 指令正文。",
          version: Number(skill.version || 1),
        };
      case "design_platform.health_check":
        return sanitizeDesignPlatformHealth(await this.designPlatform.health());
      case "catalog.audit":
        return sanitizeCatalogAudit(await this.catalog.auditSkus());
      case "automation.readiness_check":
        return sanitizeAutomationReadiness(await this.automationScheduler.readiness());
    }
  }

  private assertExactPayload(payload: ExecuteAgentSkillInput) {
    if (!isRecord(payload)) throw new BadRequestException("agent skill execution payload must be an object");
    const extraKeys = Object.keys(payload).filter((key) => !ALLOWED_PAYLOAD_KEYS.has(key));
    if (extraKeys.length) {
      throw new BadRequestException({
        code: "AGENT_SKILL_PAYLOAD_REJECTED",
        message: `不支持的执行参数：${extraKeys.join(", ")}`,
      });
    }
  }

  private async getReviewLog(id: string): Promise<ReviewLogRecord | null> {
    if (appConfig.useLocalStore) return this.localStore.getReviewLog(id);
    return this.prisma.reviewLog.findUnique({ where: { id } }) as Promise<ReviewLogRecord | null>;
  }

  private async createReviewLog(payload: JsonRecord): Promise<ReviewLogRecord> {
    if (appConfig.useLocalStore) return this.localStore.createReviewLog(payload);
    try {
      const { id, ...data } = payload;
      return await this.prisma.reviewLog.create({
        data: {
          ...(typeof id === "string" ? { id } : {}),
          ...(data as Omit<Prisma.ReviewLogCreateInput, "id">),
          metadata: jsonValue(data.metadata),
        },
      }) as ReviewLogRecord;
    } catch (error) {
      if (!isUniqueConstraintError(error) || typeof payload.id !== "string") throw error;
      const existing = await this.prisma.reviewLog.findUnique({ where: { id: payload.id } });
      if (!existing) throw error;
      return existing as ReviewLogRecord;
    }
  }

  private async updateReviewLog(id: string, patch: JsonRecord): Promise<ReviewLogRecord> {
    if (appConfig.useLocalStore) return this.localStore.updateReviewLog(id, patch);
    const data = {
      ...patch,
      ...(Object.prototype.hasOwnProperty.call(patch, "metadata")
        ? { metadata: jsonValue(patch.metadata) }
        : {}),
    };
    return this.prisma.reviewLog.update({
      where: { id },
      data: data as Prisma.ReviewLogUpdateInput,
    }) as Promise<ReviewLogRecord>;
  }

  private async listReviewLogs(skillId: string): Promise<ReviewLogRecord[]> {
    if (appConfig.useLocalStore) {
      return this.localStore.listReviewLogs(300)
        .filter((log: ReviewLogRecord) => log.targetType === EXECUTION_TARGET_TYPE && log.targetId === skillId);
    }
    return this.prisma.reviewLog.findMany({
      where: { targetType: EXECUTION_TARGET_TYPE, targetId: skillId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }) as Promise<ReviewLogRecord[]>;
  }
}

function normalizeIdentity(value: IdentityFilter): IdentityFilter {
  return Object.fromEntries(
    (["wechatAccountId", "conversationId", "customerId"] as const)
      .map((key) => [key, typeof value?.[key] === "string" ? value[key]!.trim() : ""] as const)
      .filter(([, item]) => Boolean(item)),
  );
}

function sanitizeDesignPlatformHealth(value: unknown): JsonRecord {
  const health = asRecord(value);
  const localDemo = asRecord(health.localDemo);
  const status = safeText(health.status, 40);
  const healthy =
    health.ok === true ||
    health.healthy === true ||
    health.upstreamOk === true ||
    status.toLowerCase() === "ok";
  return {
    healthy,
    adapter: safeText(health.adapter, 80) || "unknown",
    service: safeText(health.service || health.name, 120) || "design-platform",
    version: safeText(health.version, 80) || null,
    localGenerateEnabled:
      typeof localDemo.localGenerateEnabled === "boolean"
        ? localDemo.localGenerateEnabled
        : null,
  };
}

function sanitizeCatalogAudit(value: unknown): JsonRecord {
  const audit = asRecord(value);
  return {
    total: safeNumber(audit.total),
    readyCount: safeNumber(audit.readyCount),
    issueCount: safeNumber(audit.issueCount),
    errorCount: safeNumber(audit.errorCount),
    warningCount: safeNumber(audit.warningCount),
    missingImageCount: safeNumber(audit.missingImageCount),
    lowStockCount: safeNumber(audit.lowStockCount),
    blockingRepairCount: safeNumber(audit.blockingRepairCount),
  };
}

function sanitizeAutomationReadiness(value: unknown): JsonRecord {
  const readiness = asRecord(value);
  const blockers = safeChecks(readiness.blockers);
  const warnings = safeChecks(readiness.warnings);
  return {
    ready: readiness.ready === true,
    tone: safeText(readiness.tone, 40) || (readiness.ready === true ? "ok" : "error"),
    summary: safeText(readiness.summary, 240),
    blockerCount: blockers.length,
    warningCount: warnings.length,
    blockers,
    warnings,
  };
}

function safeChecks(value: unknown) {
  return Array.isArray(value)
    ? value.slice(0, 20).map((item) => {
        const check = asRecord(item);
        return {
          key: safeText(check.key, 80),
          label: safeText(check.label, 120),
          severity: safeText(check.severity, 20),
        };
      })
    : [];
}

function executionResultSummary(actionKey: AgentSkillActionKey, result: JsonRecord): JsonRecord {
  if (actionKey === "skill.instruction_preview") {
    return {
      agentId: result.agentId,
      skillId: result.skillId,
      version: result.version,
      instructionAvailable: Boolean(result.instruction),
    };
  }
  return result;
}

function publicExecutionLog(log: ReviewLogRecord) {
  const metadata = asRecord(log.metadata);
  return {
    executionId: log.id,
    status: safeText(log.afterStatus, 40) || "unknown",
    actionKey: safeText(metadata.actionKey, 120),
    actionLabel: safeText(metadata.actionLabel, 120),
    riskLevel: safeText(metadata.riskLevel, 40),
    sideEffects: safeText(metadata.sideEffects, 40),
    reviewer: safeText(log.reviewer, 120),
    startedAt: safeText(metadata.startedAt || log.createdAt, 80),
    completedAt: safeText(metadata.completedAt || metadata.failedAt, 80) || null,
    resultSummary: isRecord(metadata.resultSummary) ? metadata.resultSummary : null,
    error: isRecord(metadata.error)
      ? {
          code: safeText(metadata.error.code, 80),
          message: safeText(metadata.error.message, 240),
        }
      : null,
  };
}

function metadataMatchesIdentity(metadata: unknown, identity: IdentityFilter) {
  const source = asRecord(metadata);
  return (["wechatAccountId", "conversationId", "customerId"] as const)
    .every((key) => !identity[key] || source[key] === identity[key]);
}

function safeExecutionError(error: unknown) {
  const record = asRecord(error);
  return {
    code: safeText(record.code || record.name, 80) || "ACTION_FAILED",
    message: "白名单只读动作未完成；原始异常仅保留在服务日志中。",
  };
}

function executionInProgress(executionId: string) {
  return new ConflictException({
    code: "AGENT_SKILL_EXECUTION_IN_PROGRESS",
    message: "相同操作编号正在执行，请等待当前结果。",
    executionId,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("ALLOWLIST_ACTION_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null
    ? Prisma.JsonNull
    : value as Prisma.InputJsonValue;
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
