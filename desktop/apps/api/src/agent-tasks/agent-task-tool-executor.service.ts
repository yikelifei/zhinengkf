import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import path from "node:path";
import { OrdersService } from "../orders/orders.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import { WechatPersistence } from "../wechat/wechat-persistence";

const {
  TOOL_EFFECT,
  evaluateToolInvocation,
  getToolDefinition,
} = require(path.join(process.cwd(), "packages", "rules"));

const EXECUTION_STALE_GRACE_MS = 30_000;
const TRUSTED_EXECUTION_CAPABILITY = "execute_agent_skills";
const ALLOWED_PAYLOAD_KEYS = new Set(["idempotencyKey", "input"]);
const INPUT_KEYS: Record<string, Set<string>> = {
  "order.query": new Set(["orderDraftId", "orderId", "limit"]),
  "refund.eligibility": new Set(["orderDraftId", "orderId"]),
  "after_sales.case.create": new Set(["orderDraftId", "orderId", "type", "reason", "requestedAmountCny", "evidenceReference", "desiredResolution"]),
  "order.cancel.execute": new Set(["orderDraftId", "orderId"]),
  "refund.execute": new Set(["orderDraftId", "orderId", "amountCny"]),
};

type Identity = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type AgentTaskToolExecutionPayload = {
  idempotencyKey?: string;
  input?: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

/**
 * Executes registered tools for an existing AgentTask.
 *
 * The controller is protected by execute_agent_skills. This service adds the
 * second boundary: it derives the domain capability from the registered tool,
 * binds every query to the persisted task identity, and writes an execution
 * record before and after the business service call.
 */
@Injectable()
export class AgentTaskToolExecutorService {
  constructor(
    private readonly persistence: WechatPersistence,
    private readonly orders: OrdersService,
  ) {}

  async execute(
    taskId: string,
    executionId: string,
    payload: AgentTaskToolExecutionPayload = {},
    operatorId = "local_admin",
  ) {
    this.assertPayload(payload);
    const task = await this.persistence.getAgentTask(taskId);
    if (!task) throw new NotFoundException(`agent task not found: ${taskId}`);
    const execution = await this.persistence.getAgentTaskToolExecution(executionId);
    if (!execution || String(execution.taskId || "") !== String(task.id || "")) {
      throw new NotFoundException(`agent task tool execution not found: ${executionId}`);
    }

    const definition = getToolDefinition(execution.toolName);
    if (!definition) {
      throw new ConflictException({
        code: "AGENT_TOOL_NOT_REGISTERED",
        message: `工具未注册：${execution.toolName}`,
      });
    }
    const identity = normalizeIdentity(task);
    const input = normalizeInput(payload.input);
    this.assertInput(definition.name, input);
    const idempotencyKey = requiredText(payload.idempotencyKey, "idempotencyKey");
    const approvalState = definition.effect === TOOL_EFFECT.READ
      ? null
      : this.findWriteApproval(task, execution.id);
    const evaluation = evaluateToolInvocation(definition.name, {
      identity,
      capabilities: [TRUSTED_EXECUTION_CAPABILITY, definition.requiredCapability],
      idempotencyKey,
      approvalStatus: definition.effect === TOOL_EFFECT.READ ? "approved" : approvalState?.latest?.status,
      routingPolicy: {},
    });
    if (!evaluation.allowed) {
      await this.recordDeniedExecution(execution, input, idempotencyKey, evaluation);
      throw new ConflictException({
        code: `AGENT_TOOL_${String(evaluation.reason || "DENIED").toUpperCase()}`,
        message: evaluation.message,
      });
    }
    if (definition.effect !== TOOL_EFFECT.READ
      && definition.approvalPolicy === "two_person"
      && Number(approvalState?.approved?.length || 0) < 2) {
      await this.recordDeniedExecution(execution, input, idempotencyKey, {
        reason: "two_person_approval_required",
        message: "该工具需要两名独立审批人确认；当前审批数量不足。",
      });
      throw new ConflictException({
        code: "AGENT_TOOL_TWO_PERSON_APPROVAL_REQUIRED",
        message: "该工具需要两名独立审批人确认；当前审批数量不足。",
        executionId: execution.id,
      });
    }

    const replay = this.replayIfCompleted(execution, input, idempotencyKey);
    if (replay) return replay;
    if (String(execution.status || "") === "previewed"
      && (String(execution.idempotencyKey || "") !== idempotencyKey || stableJson(execution.input) !== stableJson(input))) {
      throw new ConflictException({
        code: "AGENT_TOOL_EXECUTION_MISMATCH",
        message: "执行输入必须与已审批的 preview 完全一致。",
        executionId: execution.id,
      });
    }
    this.assertNotInProgress(execution, definition.timeoutMs);

    const startedAt = new Date().toISOString();
    const running = await this.persistence.updateAgentTaskToolExecution(execution.id, {
      status: "executing",
      input,
      idempotencyKey,
      startedAt,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    await this.persistence.updateAgentTask(task.id, {
      status: "executing",
      currentStep: execution.stepKey || definition.name,
      errorCode: null,
      errorMessage: null,
    });

    let result: JsonRecord;
    try {
      result = await withTimeout(
        this.runTool(definition.name, input, identity, operatorId, idempotencyKey),
        Number(definition.timeoutMs || (definition.effect === TOOL_EFFECT.READ ? 5000 : 10000)),
      );
    } catch (error) {
      const failedAt = new Date().toISOString();
      const normalized = executionError(error);
      const updated = await this.persistence.updateAgentTaskToolExecution(execution.id, {
        status: "failed",
        completedAt: failedAt,
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
      await this.persistence.updateAgentTask(task.id, {
        status: "ready",
        currentStep: execution.stepKey || definition.name,
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
      throw new InternalServerErrorException({
        code: "AGENT_TOOL_EXECUTION_FAILED",
        message: "工具执行失败，系统已记录审计；可按业务策略重试或转人工。",
        executionId: execution.id,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        execution: updated,
      });
    }

    const completedAt = new Date().toISOString();
    const response = {
      taskId: task.id,
      executionId: execution.id,
      toolName: definition.name,
      status: "succeeded" as const,
      replayed: false,
      operatorId: safeText(operatorId, 120),
      result,
      startedAt,
      completedAt,
    };
    const updated = await this.persistence.updateAgentTaskToolExecution(execution.id, {
      status: "succeeded",
      output: result,
      completedAt,
    });
    await this.persistence.updateAgentTask(task.id, {
      status: "ready",
      currentStep: "reply.compose",
      errorCode: null,
      errorMessage: null,
    });
    return { ...response, execution: updated };
  }

  async preview(
    taskId: string,
    executionId: string,
    payload: AgentTaskToolExecutionPayload = {},
    operatorId = "local_admin",
  ) {
    this.assertPayload(payload);
    const task = await this.persistence.getAgentTask(taskId);
    if (!task) throw new NotFoundException(`agent task not found: ${taskId}`);
    const execution = await this.persistence.getAgentTaskToolExecution(executionId);
    if (!execution || String(execution.taskId || "") !== String(task.id || "")) {
      throw new NotFoundException(`agent task tool execution not found: ${executionId}`);
    }
    const definition = getToolDefinition(execution.toolName);
    if (!definition || definition.effect === TOOL_EFFECT.READ) {
      throw new ConflictException({
        code: "AGENT_TOOL_WRITE_PREVIEW_REQUIRED",
        message: "当前 preview 入口只接受已注册的写工具；只读工具直接执行即可。",
      });
    }
    const identity = normalizeIdentity(task);
    const input = normalizeInput(payload.input);
    this.assertInput(definition.name, input);
    const idempotencyKey = requiredText(payload.idempotencyKey, "idempotencyKey");
    const evaluation = evaluateToolInvocation(definition.name, {
      identity,
      capabilities: [TRUSTED_EXECUTION_CAPABILITY, definition.requiredCapability],
      idempotencyKey,
      executionPhase: "preview",
      approvalStatus: "preview",
      routingPolicy: {},
    });
    if (!evaluation.allowed) {
      await this.recordDeniedExecution(execution, input, idempotencyKey, evaluation);
      throw new ConflictException({
        code: `AGENT_TOOL_${String(evaluation.reason || "DENIED").toUpperCase()}`,
        message: evaluation.message,
      });
    }
    if (String(execution.status || "") === "previewed") {
      if (String(execution.idempotencyKey || "") !== idempotencyKey || stableJson(execution.input) !== stableJson(input)) {
        throw new ConflictException({ code: "AGENT_TOOL_PREVIEW_MISMATCH", message: "预览不能使用不同的幂等键或输入重放。" });
      }
      return {
        taskId: task.id,
        executionId: execution.id,
        toolName: definition.name,
        status: "previewed" as const,
        replayed: true,
        operatorId: safeText(operatorId, 120),
        result: execution.output || null,
        execution,
      };
    }
    if (["executing", "succeeded"].includes(String(execution.status || ""))) {
      throw new ConflictException({ code: "AGENT_TOOL_PREVIEW_NOT_REPLAYABLE", message: "该工具已进入执行或完成状态，不能回到 preview。" });
    }

    let result: JsonRecord;
    try {
      result = await withTimeout(
        this.runWritePreview(definition.name, input, identity),
        Number(definition.timeoutMs || 10000),
      );
    } catch (error) {
      const normalized = executionError(error);
      await this.persistence.updateAgentTaskToolExecution(execution.id, {
        status: "failed",
        input,
        idempotencyKey,
        completedAt: new Date().toISOString(),
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
      throw error;
    }
    const completedAt = new Date().toISOString();
    const updated = await this.persistence.updateAgentTaskToolExecution(execution.id, {
      status: "previewed",
      input,
      idempotencyKey,
      output: result,
      completedAt,
      errorCode: null,
      errorMessage: null,
    });
    const approvalTask = await this.persistence.createAgentTaskApproval(task.id, {
      operationKey: `${execution.operationKey}:approval`,
      toolExecutionId: execution.id,
      policy: definition.approvalPolicy,
      requestedBy: operatorId,
      currentStep: `approval.${execution.stepKey || definition.name}`,
      metadata: {
        toolExecutionId: execution.id,
        toolName: definition.name,
        toolVersion: definition.version,
        previewedAt: completedAt,
        approvalPolicy: definition.approvalPolicy,
      },
    });
    return {
      taskId: task.id,
      executionId: execution.id,
      toolName: definition.name,
      status: "previewed" as const,
      replayed: false,
      operatorId: safeText(operatorId, 120),
      result,
      completedAt,
      execution: updated,
      task: approvalTask,
      approval: approvalTask?.approvals?.find((item: any) => item.metadata?.toolExecutionId === execution.id)
        || approvalTask?.approvals?.[0]
        || null,
    };
  }

  async verify(taskId: string, executionId: string, operatorId = "local_admin") {
    const task = await this.persistence.getAgentTask(taskId);
    if (!task) throw new NotFoundException(`agent task not found: ${taskId}`);
    const execution = await this.persistence.getAgentTaskToolExecution(executionId);
    if (!execution || String(execution.taskId || "") !== String(task.id || "")) {
      throw new NotFoundException(`agent task tool execution not found: ${executionId}`);
    }
    const definition = getToolDefinition(execution.toolName);
    if (!definition) throw new ConflictException(`工具未注册：${execution.toolName}`);
    if (String(execution.status || "") !== "succeeded") {
      throw new ConflictException({
        code: "AGENT_TOOL_VERIFY_NOT_READY",
        message: "只有已执行成功的工具才能进入 verify；未知或失败结果不能被标记为完成。",
        executionId,
      });
    }
    const identity = normalizeIdentity(task);
    const input = normalizeInput(execution.input);
    try {
      const verification = await withTimeout(
        this.runVerification(definition.name, input, execution.output, identity),
        Number(definition.timeoutMs || 5000),
      );
      const verifiedAt = new Date().toISOString();
      const verificationRecord = {
        ...verification,
        verified: true,
        verifiedAt,
        verifiedBy: safeText(operatorId, 120),
      };
      const updated = await this.persistence.updateAgentTaskToolExecution(execution.id, {
        status: "verified",
        output: { result: execution.output || null, verification: verificationRecord },
        completedAt: verifiedAt,
        errorCode: null,
        errorMessage: null,
      });
      await this.persistence.updateAgentTask(task.id, {
        status: "ready",
        currentStep: "reply.compose",
        errorCode: null,
        errorMessage: null,
      });
      return {
        taskId: task.id,
        executionId: execution.id,
        toolName: definition.name,
        status: "verified" as const,
        verified: true,
        verification: verificationRecord,
        execution: updated,
      };
    } catch (error) {
      const normalized = executionError(error);
      const verification = {
        verified: false,
        verifiedAt: new Date().toISOString(),
        errorCode: normalized.code,
        errorMessage: normalized.message,
      };
      const updated = await this.persistence.updateAgentTaskToolExecution(execution.id, {
        status: "failed",
        output: { result: execution.output || null, verification },
        completedAt: verification.verifiedAt,
        errorCode: "AGENT_TOOL_VERIFY_FAILED",
        errorMessage: normalized.message,
      });
      throw new ConflictException({
        code: "AGENT_TOOL_VERIFY_FAILED",
        message: "业务结果未通过核验，系统不会把执行记录标记为完成。",
        executionId: execution.id,
        verification,
        execution: updated,
      });
    }
  }

  private async runTool(name: string, input: JsonRecord, identity: Identity, operatorId: string, operationKey: string) {
    const definition = getToolDefinition(name);
    if (definition?.effect === TOOL_EFFECT.READ) return this.runReadTool(name, input, identity);
    return this.runWriteTool(name, input, identity, operatorId, operationKey);
  }

  private async runReadTool(name: string, input: JsonRecord, identity: Identity) {
    switch (name) {
      case "order.query": {
        const orderId = oneId(input);
        if (orderId) {
          const order = await this.orders.getById(orderId, expectedIdentity(identity));
          return { order: publicOrderView(order) };
        }
        const limit = normalizeLimit(input.limit);
        const orders = await this.orders.list(completeIdentity(identity));
        return {
          orders: orders.slice(0, limit).map((order: any) => publicOrderView(order)),
          total: orders.length,
          limit,
        };
      }
      case "refund.eligibility": {
        const orderId = oneId(input);
        if (!orderId) throw new BadRequestException("refund.eligibility 必须提供 orderDraftId");
        return this.orders.refundEligibility(orderId, expectedIdentity(identity));
      }
      default:
        throw new ConflictException({
          code: "AGENT_TOOL_EXECUTOR_NOT_IMPLEMENTED",
          message: `只读工具尚未接入业务执行器：${name}`,
        });
    }
  }

  private async runWriteTool(name: string, input: JsonRecord, identity: Identity, operatorId: string, operationKey: string) {
    const orderId = oneId(input);
    if (!orderId) throw new BadRequestException(`${name} 执行必须提供 orderDraftId`);
    const expected = expectedIdentity(identity);
    switch (name) {
      case "after_sales.case.create":
        return this.orders.createAfterSalesCase(orderId, {
          type: input.type as string,
          reason: input.reason as string,
          requestedAmountCny: input.requestedAmountCny as string | number,
          evidenceReference: input.evidenceReference as string,
          desiredResolution: input.desiredResolution as string,
          operationKey,
          ...expected,
          owner: operatorId,
        });
      case "order.cancel.execute":
        return this.orders.updateFulfillment(orderId, {
          status: "cancelled",
          operationKey,
          ...expected,
          owner: operatorId,
        });
      case "refund.execute":
        throw new ConflictException({
          code: "AGENT_REFUND_EXTERNAL_EXECUTOR_NOT_CONFIGURED",
          message: "真实退款通道尚未配置；系统不会把内部记录冒充为外部退款成功。",
        });
      default:
        throw new ConflictException({
          code: "AGENT_TOOL_EXECUTOR_NOT_IMPLEMENTED",
          message: `写工具尚未接入业务执行器：${name}`,
        });
    }
  }

  private async runWritePreview(name: string, input: JsonRecord, identity: Identity) {
    const orderId = oneId(input);
    if (!orderId) throw new BadRequestException(`${name} preview 必须提供 orderDraftId`);
    const expected = expectedIdentity(identity);
    switch (name) {
      case "after_sales.case.create":
        return this.orders.afterSalesCasePreview(orderId, {
          type: input.type as string,
          reason: input.reason as string,
          requestedAmountCny: input.requestedAmountCny as string | number,
          evidenceReference: input.evidenceReference as string,
          desiredResolution: input.desiredResolution as string,
          ...expected,
        });
      case "refund.execute": {
        const eligibility = await this.orders.refundEligibility(orderId, expected);
        const amountCny = numberOrNull(input.amountCny);
        if (amountCny === null || amountCny <= 0) throw new BadRequestException("refund.execute preview 必须提供大于 0 的 amountCny");
        if (amountCny > Number(eligibility.paymentSummary?.refundableAmountCny || 0) + 0.0001) {
          throw new BadRequestException(`退款预览金额超过可退金额：可退 ${eligibility.paymentSummary?.refundableAmountCny || 0} 元。`);
        }
        return {
          phase: "preview",
          noWrite: true,
          orderDraftId: orderId,
          amountCny,
          eligibility,
          approvalPolicy: "two_person",
          requiresHumanReview: true,
        };
      }
      case "order.cancel.execute": {
        const order = await this.orders.getById(orderId, expected);
        return {
          phase: "preview",
          noWrite: true,
          orderDraftId: orderId,
          currentStatus: order.status || null,
          proposedStatus: "cancelled",
          requiresHumanReview: true,
          policySource: "orders.updateFulfillment",
        };
      }
      default:
        throw new ConflictException({
          code: "AGENT_TOOL_PREVIEW_NOT_IMPLEMENTED",
          message: `写工具 preview 尚未接入现有业务校验：${name}`,
        });
    }
  }

  private async runVerification(name: string, input: JsonRecord, output: unknown, identity: Identity) {
    const orderId = oneId(input);
    if (!orderId) throw new BadRequestException(`${name} verify 缺少 orderDraftId`);
    const expected = expectedIdentity(identity);
    switch (name) {
      case "after_sales.case.create": {
        const caseId = safeText((output as any)?.id, 160);
        if (!caseId) throw new ConflictException("售后 case 执行结果缺少 caseId");
        const cases = await this.orders.listAfterSalesCases(orderId, expected);
        const found = cases.find((item: any) => String(item?.id || "") === caseId);
        if (!found) throw new ConflictException("售后 case 未在订单售后记录中找到");
        return { source: "orders.listAfterSalesCases", orderDraftId: orderId, caseId, caseStatus: found.status };
      }
      case "order.cancel.execute": {
        const order = await this.orders.getById(orderId, expected);
        if (String(order?.status || "") !== "cancelled") {
          throw new ConflictException(`订单当前状态不是 cancelled：${order?.status || "unknown"}`);
        }
        return { source: "orders.getById", orderDraftId: orderId, observedStatus: order.status };
      }
      case "refund.execute":
        throw new ConflictException("真实退款通道未配置，禁止 verify 为外部退款成功");
      default:
        throw new ConflictException(`工具尚未接入 verify：${name}`);
    }
  }

  private findWriteApproval(task: any, executionId: string) {
    const approvals = (Array.isArray(task?.approvals) ? task.approvals : [])
      .filter((approval: any) => String(approval?.metadata?.toolExecutionId || "") === String(executionId));
    const approved = approvals.filter((approval: any) => String(approval?.status || "") === "approved");
    return { approvals, approved, latest: approvals[approvals.length - 1] || null };
  }

  private replayIfCompleted(execution: any, input: JsonRecord, idempotencyKey: string) {
    if (!["succeeded", "verified"].includes(String(execution.status || ""))) return null;
    if (String(execution.idempotencyKey || "") !== idempotencyKey || stableJson(execution.input) !== stableJson(input)) {
      throw new ConflictException({
        code: "AGENT_TOOL_REPLAY_MISMATCH",
        message: "已完成的只读工具不能使用不同的幂等键或输入重放。",
        executionId: execution.id,
      });
    }
    return {
      taskId: execution.taskId,
      executionId: execution.id,
      toolName: execution.toolName,
      status: execution.status,
      replayed: true,
      result: execution.status === "verified" && isRecord(execution.output) && Object.prototype.hasOwnProperty.call(execution.output, "result")
        ? execution.output.result
        : execution.output || null,
      verification: execution.status === "verified" && isRecord(execution.output)
        ? execution.output.verification || null
        : null,
      execution,
    };
  }

  private assertNotInProgress(execution: any, timeoutMs: number) {
    if (String(execution.status || "") !== "executing") return;
    const startedAt = Date.parse(String(execution.startedAt || ""));
    const staleAfterMs = Number(timeoutMs || 5000) + EXECUTION_STALE_GRACE_MS;
    if (Number.isFinite(startedAt) && Date.now() - startedAt <= staleAfterMs) {
      throw new ConflictException({
        code: "AGENT_TOOL_EXECUTION_IN_PROGRESS",
        message: "该工具正在执行，请勿重复提交。",
        executionId: execution.id,
      });
    }
    throw new ConflictException({
      code: "AGENT_TOOL_EXECUTION_STALE",
      message: "上一次只读执行已超时，请使用新的幂等键重试。",
      executionId: execution.id,
    });
  }

  private async recordDeniedExecution(execution: any, input: JsonRecord, idempotencyKey: string, evaluation: any) {
    await this.persistence.updateAgentTaskToolExecution(execution.id, {
      status: "failed",
      input,
      idempotencyKey,
      completedAt: new Date().toISOString(),
      errorCode: `POLICY_${String(evaluation.reason || "DENIED").toUpperCase()}`,
      errorMessage: String(evaluation.message || "工具策略拒绝"),
    });
  }

  private assertPayload(payload: AgentTaskToolExecutionPayload) {
    if (!isRecord(payload)) throw new BadRequestException("agent tool execution payload must be an object");
    const extraKeys = Object.keys(payload).filter((key) => !ALLOWED_PAYLOAD_KEYS.has(key));
    if (extraKeys.length) {
      throw new BadRequestException({
        code: "AGENT_TOOL_PAYLOAD_REJECTED",
        message: `不支持的执行参数：${extraKeys.join(", ")}`,
      });
    }
  }

  private assertInput(toolName: string, input: JsonRecord) {
    const allowed = INPUT_KEYS[toolName];
    if (!allowed) return;
    const extraKeys = Object.keys(input).filter((key) => !allowed.has(key));
    if (extraKeys.length) {
      throw new BadRequestException({
        code: "AGENT_TOOL_INPUT_REJECTED",
        message: `工具 ${toolName} 不支持输入参数：${extraKeys.join(", ")}`,
      });
    }
    if (input.orderDraftId && input.orderId && String(input.orderDraftId) !== String(input.orderId)) {
      throw new BadRequestException("orderDraftId 与 orderId 不能指向不同订单");
    }
  }
}

function normalizeIdentity(task: any): Identity {
  return {
    wechatAccountId: safeText(task.wechatAccountId, 160) || undefined,
    conversationId: safeText(task.conversationId, 160) || undefined,
    customerId: safeText(task.customerId, 160) || undefined,
  };
}

function completeIdentity(identity: Identity): Required<Identity> {
  return {
    wechatAccountId: requiredText(identity.wechatAccountId, "task.wechatAccountId"),
    conversationId: requiredText(identity.conversationId, "task.conversationId"),
    customerId: requiredText(identity.customerId, "task.customerId"),
  };
}

function expectedIdentity(identity: Identity): ExpectedIdentityPayload {
  const complete = completeIdentity(identity);
  return {
    expectedWechatAccountId: complete.wechatAccountId,
    expectedConversationId: complete.conversationId,
    expectedCustomerId: complete.customerId,
  };
}

function normalizeInput(input: unknown): JsonRecord {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) throw new BadRequestException("agent tool input must be an object");
  return { ...input };
}

function oneId(input: JsonRecord) {
  return String(input.orderDraftId || input.orderId || "").trim();
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value || 20);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new BadRequestException("order.query limit 必须是正数");
  return Math.min(Math.floor(parsed), 200);
}

function publicOrderView(order: any) {
  return {
    id: safeText(order?.id, 160),
    quoteDraftId: safeText(order?.quoteDraftId, 160) || null,
    designJobId: safeText(order?.designJobId, 160) || null,
    customerId: safeText(order?.customerId, 160) || null,
    conversationId: safeText(order?.conversationId, 160) || null,
    wechatAccountId: safeText(order?.wechatAccountId, 160) || null,
    quantity: numberOrNull(order?.quantity),
    unitPrice: numberOrNull(order?.unitPrice),
    totalPrice: numberOrNull(order?.totalPrice),
    status: safeText(order?.status, 80),
    paymentStatus: safeText(order?.paymentStatus, 80),
    productionStatus: safeText(order?.productionStatus, 80),
    productionDueAt: safeText(order?.productionDueAt, 80) || null,
    carrier: safeText(order?.carrier, 120) || null,
    trackingNo: safeText(order?.trackingNo, 120) || null,
    shippedAt: safeText(order?.shippedAt, 80) || null,
    deliveredAt: safeText(order?.deliveredAt, 80) || null,
    owner: safeText(order?.owner, 120) || null,
    createdAt: dateText(order?.createdAt),
    updatedAt: dateText(order?.updatedAt),
  };
}

function requiredText(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) throw new BadRequestException(`${label} 不能为空`);
  return text;
}

function safeText(value: unknown, max: number) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateText(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as JsonRecord).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonRecord)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = Math.max(1, Number(timeoutMs || 5000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("tool execution timed out"), { code: "TOOL_EXECUTION_TIMEOUT" })), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function executionError(error: unknown) {
  const candidate = error as any;
  return {
    code: safeText(candidate?.code || candidate?.response?.code || "TOOL_EXECUTION_FAILED", 100),
    message: safeText(candidate?.message || candidate?.response?.message || "工具执行失败", 500),
  };
}
