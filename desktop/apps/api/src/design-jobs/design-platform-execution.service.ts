import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import type { ArtImageLocalGenerationOutcome } from "../integrations/design-platform/design-platform.client";
import type {
  DesignExecutionAvailableResolution,
  DesignPlatformExecutionView,
} from "./design-jobs.types";

export type BeginDesignPlatformExecutionInput = {
  designJobId: string;
  designRevisionId?: string | null;
  attemptNo: number;
  retryCount?: number;
  revisionRetryCount?: number;
  revisionNumber?: number;
};

const ACTIVE_EXECUTION_STATUSES = ["prepared", "dispatching", "generating", "cancel_requested"] as const;
const RETRY_SAFE_REFUND_STATUSES = ["refunded", "not_required", "credit_bypass"] as const;
const PUBLIC_EXECUTION_STATUSES = new Set([
  "prepared", "dispatching", "generating", "completed", "explicit_failed", "outcome_unknown", "cancel_requested", "cancelled",
]);
const PUBLIC_ACCEPTANCE_STATUSES = new Set(["pending", "accepting", "accepted", "rejected", "manual_review"]);
const PUBLIC_REFUND_STATUSES = new Set(["pending", "refunded", "not_required", "credit_bypass", "failed", "unknown"]);
const PUBLIC_ERROR_CATEGORIES = new Set([
  "explicit_remote_failure",
  "local_pre_dispatch_failure",
  "timeout_unknown",
  "connection_reset_unknown",
  "remote_acceptance_unknown",
  "transport_outcome_unknown",
  "acceptance_failure",
]);

function retryBlockingWhere(designJobId: string) {
  return {
    designJobId,
    OR: [
      { status: { in: [...ACTIVE_EXECUTION_STATUSES] } },
      { status: "outcome_unknown" },
      { status: "completed", acceptanceStatus: { notIn: ["accepted", "rejected"] } },
      {
        status: "explicit_failed",
        refundStatus: { notIn: [...RETRY_SAFE_REFUND_STATUSES] },
      },
    ],
  };
}

function retryBlockMessage(execution: any) {
  if (ACTIVE_EXECUTION_STATUSES.includes(execution?.status)) {
    return "active design platform execution is still in progress; retry would risk duplicate generation and charging";
  }
  if (execution?.status === "explicit_failed") {
    return "design platform refund outcome requires explicit manual verification before retry";
  }
  return "design platform execution outcome requires explicit manual resolution before retry";
}

@Injectable()
export class DesignPlatformExecutionService {
  readonly processRunId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
  ) {}

  operationKey(input: BeginDesignPlatformExecutionInput) {
    return [input.designJobId, input.designRevisionId || "initial", String(input.attemptNo)].join(":");
  }

  externalJobId(operationKey: string) {
    return `art_${createHash("sha256").update(operationKey, "utf8").digest("hex").slice(0, 28)}`;
  }

  async begin(input: BeginDesignPlatformExecutionInput) {
    const operationKey = this.operationKey(input);
    const externalJobId = this.externalJobId(operationKey);
    const requestId = externalJobId;
    const scopeKey = [input.designJobId, input.designRevisionId || "initial"].join(":");
    const payload = { ...input, operationKey, externalJobId, requestId, scopeKey, processRunId: this.processRunId };
    if (appConfig.useLocalStore) return this.localStore.beginDesignPlatformExecution(payload);

    const prisma = this.prisma as any;
    try {
      return await prisma.$transaction(async (tx: any) => {
      const existing = await tx.designPlatformExecution.findUnique({ where: { operationKey } });
      if (existing) return { execution: existing, created: false };
      const job = await tx.designJob.findUnique({ where: { id: input.designJobId } });
      if (!job) throw new Error(`design job not found: ${input.designJobId}`);
      if (job.status === "cancelled") throw new Error("cancelled design job cannot start a platform execution");
      const retryBlocker = await tx.designPlatformExecution.findFirst({
        where: retryBlockingWhere(input.designJobId),
      });
      if (retryBlocker) throw new Error(retryBlockMessage(retryBlocker));

      let revision: any = null;
      if (input.designRevisionId) {
        revision = await tx.designRevision.findUnique({ where: { id: input.designRevisionId } });
        if (!revision || revision.designJobId !== job.id) throw new Error("design platform execution revision binding invalid");
        if (
          Number(revision.revisionNumber || 0) !== Number(job.revisionCount || 0) &&
          Number(revision.revisionNumber || 0) !== Number(job.revisionCount || 0) + 1
        ) {
          throw new Error("stale design revision cannot start a platform execution");
        }
      }

      const execution = await tx.designPlatformExecution.create({
        data: {
          operationKey,
          externalJobId,
          requestId,
          scopeKey,
          adapter: "art_image_local",
          designJobId: job.id,
          designRevisionId: revision?.id || null,
          attemptNo: input.attemptNo,
          processRunId: this.processRunId,
        },
      });
      const jobChanged = await tx.designJob.updateMany({
        where: {
          id: job.id,
          status: job.status,
          updatedAt: job.updatedAt,
          externalJobId: job.externalJobId,
        },
        data: {
          externalJobId,
          status: "submitted",
          submittedAt: new Date(),
          errorMessage: null,
          ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
          ...(input.revisionNumber !== undefined ? { revisionCount: input.revisionNumber } : {}),
        },
      });
      if (jobChanged.count !== 1) throw new Error("design job changed while beginning platform execution");
      if (revision) {
        const revisionChanged = await tx.designRevision.updateMany({
          where: { id: revision.id, status: revision.status, updatedAt: revision.updatedAt },
          data: {
            externalJobId,
            status: "submitted",
            ...(input.revisionRetryCount !== undefined ? { retryCount: input.revisionRetryCount } : {}),
          },
        });
        if (revisionChanged.count !== 1) throw new Error("design revision changed while beginning platform execution");
      }
        return { execution, created: true };
      });
    } catch (error) {
      if ((error as any)?.code !== "P2002") throw error;
      const existing = await prisma.designPlatformExecution.findUnique({ where: { operationKey } });
      if (!existing) throw error;
      return { execution: existing, created: false };
    }
  }

  async claimDispatch(executionId: string) {
    if (appConfig.useLocalStore) {
      return this.localStore.claimDesignPlatformExecution(executionId, this.processRunId);
    }
    const prisma = this.prisma as any;
    try {
      return await prisma.$transaction(async (tx: any) => {
        const execution = await tx.designPlatformExecution.findUnique({ where: { id: executionId } });
        if (!execution) return null;
        const now = new Date();
        const jobChanged = await tx.designJob.updateMany({
          where: {
            id: execution.designJobId,
            externalJobId: execution.externalJobId,
            status: { not: "cancelled" },
          },
          data: { updatedAt: now },
        });
        if (jobChanged.count !== 1) throw transitionCasRejected();
        const executionChanged = await tx.designPlatformExecution.updateMany({
          where: {
            id: executionId,
            status: "prepared",
            processRunId: this.processRunId,
          },
          data: { status: "dispatching", dispatchedAt: now },
        });
        if (executionChanged.count !== 1) throw transitionCasRejected();
        return tx.designPlatformExecution.findUnique({ where: { id: executionId } });
      });
    } catch (error) {
      if ((error as any)?.code === "DESIGN_PLATFORM_TRANSITION_CAS_REJECTED") return null;
      throw error;
    }
  }

  async markGenerating(executionId: string) {
    return this.transition(
      executionId,
      { status: "dispatching" },
      { status: "generating" },
      { status: "generating" },
    );
  }

  async takeoverPreparedExecutions(limit = 50) {
    if (appConfig.useLocalStore) {
      return this.localStore.takeoverPreparedDesignPlatformExecutions(this.processRunId, limit);
    }
    const prisma = this.prisma as any;
    const candidates = await prisma.designPlatformExecution.findMany({
      where: {
        status: "prepared",
        processRunId: { not: this.processRunId },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    const claimed = [];
    for (const execution of candidates) {
      const changed = await prisma.designPlatformExecution.updateMany({
        where: {
          id: execution.id,
          status: "prepared",
          processRunId: execution.processRunId,
        },
        data: { processRunId: this.processRunId },
      });
      if (changed.count === 1) claimed.push({ ...execution, processRunId: this.processRunId });
    }
    return claimed;
  }

  async failPrepared(executionId: string, error: unknown) {
    const message = error instanceof Error ? error.message : "failed to rebuild prepared design execution";
    return this.transition(
      executionId,
      { status: "prepared" },
      {
        status: "explicit_failed",
        acceptanceStatus: "manual_review",
        refundStatus: "not_required",
        errorCode: "LOCAL_PREPARED_REBUILD_FAILED",
        errorCategory: "local_pre_dispatch_failure",
        errorMessage: publicExecutionErrorMessage("local_pre_dispatch_failure"),
        completedAt: timestamp(),
      },
      { status: "manual_review", manualQcRequired: true, errorMessage: publicExecutionErrorMessage("local_pre_dispatch_failure") },
    );
  }

  async get(idOrExternalJobId: string) {
    if (appConfig.useLocalStore) return this.localStore.getDesignPlatformExecution(idOrExternalJobId);
    const prisma = this.prisma as any;
    return prisma.designPlatformExecution.findFirst({
      where: { OR: [{ id: idOrExternalJobId }, { externalJobId: idOrExternalJobId }, { operationKey: idOrExternalJobId }] },
    });
  }

  async listPublicForDesignJob(designJobId: string): Promise<DesignPlatformExecutionView[]> {
    const executions = appConfig.useLocalStore
      ? this.localStore.listDesignPlatformExecutions({ designJobId })
      : await (this.prisma as any).designPlatformExecution.findMany({
          where: { designJobId },
          select: {
            id: true,
            attemptNo: true,
            status: true,
            acceptanceStatus: true,
            refundStatus: true,
            imageCount: true,
            errorCategory: true,
            responseHttpStatus: true,
            createdAt: true,
            updatedAt: true,
            completedAt: true,
            resolvedAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
    return executions.slice(0, 100).map(toPublicExecutionView);
  }

  async listCompletedPending(limit = 50) {
    if (appConfig.useLocalStore) {
      return this.localStore
        .listDesignPlatformExecutions({ status: "completed", acceptanceStatus: "pending" })
        .slice(0, limit);
    }
    return (this.prisma as any).designPlatformExecution.findMany({
      where: { status: "completed", acceptanceStatus: "pending" },
      orderBy: { completedAt: "asc" },
      take: limit,
    });
  }

  async recordOutcome(executionId: string, outcome: ArtImageLocalGenerationOutcome) {
    const alreadyCancelled = await this.recordCancelledOutcome(executionId, outcome);
    if (alreadyCancelled) return alreadyCancelled;
    if (outcome.status === "completed") {
      const stored = await this.transition(
        executionId,
        { status: "generating" },
        {
          status: "completed",
          acceptanceStatus: "pending",
          refundStatus: outcome.refundStatus,
          imageCount: outcome.images.length,
          images: sanitizeImages(outcome.images),
          refundSummary: sanitizeRefundSummary(outcome.refundSummary),
          responseHttpStatus: outcome.httpStatus,
          completedAt: timestamp(),
        },
      );
      return stored || this.recordCancelledOutcome(executionId, outcome);
    }
    if (outcome.status === "failed") {
      const stored = await this.transition(
        executionId,
        { status: "generating" },
        {
          status: "explicit_failed",
          acceptanceStatus: "manual_review",
          refundStatus: outcome.refundStatus,
          imageCount: 0,
          images: [],
          refundSummary: sanitizeRefundSummary(outcome.refundSummary),
          errorCode: sanitizeCode(outcome.errorCode || "DESIGN_PLATFORM_FAILED"),
          errorCategory: "explicit_remote_failure",
          errorMessage: publicExecutionErrorMessage("explicit_remote_failure"),
          responseHttpStatus: outcome.httpStatus,
          completedAt: timestamp(),
        },
        {
          status: "manual_review",
          manualQcRequired: true,
          errorMessage: publicExecutionErrorMessage("explicit_remote_failure"),
        },
      );
      return stored || this.recordCancelledOutcome(executionId, outcome);
    }
    const stored = await this.markOutcomeUnknown(executionId, outcome.errorCode, outcome.errorMessage, outcome.httpStatus);
    return stored || this.recordCancelledOutcome(executionId, outcome);
  }

  private async recordCancelledOutcome(executionId: string, outcome: ArtImageLocalGenerationOutcome) {
    const common = {
      acceptanceStatus: "rejected",
      refundStatus: outcome.refundStatus,
      refundSummary: sanitizeRefundSummary((outcome as any).refundSummary),
      responseHttpStatus: outcome.httpStatus,
      completedAt: timestamp(),
      resolvedAt: timestamp(),
    };
    if (outcome.status === "completed") {
      return this.transition(
        executionId,
        { status: "cancel_requested" },
        {
          ...common,
          status: "completed",
          imageCount: outcome.images.length,
          images: sanitizeImages(outcome.images),
          errorCode: "LATE_COMPLETION_AFTER_CANCEL",
          errorCategory: "cancelled_late_completed",
          errorMessage: "design platform completed after local cancellation; result was preserved but rejected",
        },
      );
    }
    if (outcome.status === "failed") {
      return this.transition(
        executionId,
        { status: "cancel_requested" },
        {
          ...common,
          status: "explicit_failed",
          imageCount: 0,
          images: [],
          errorCode: sanitizeCode(outcome.errorCode || "LATE_FAILURE_AFTER_CANCEL"),
          errorCategory: "cancelled_late_explicit_failure",
          errorMessage: "design platform failed after local cancellation; refund evidence was preserved",
        },
      );
    }
    return this.transition(
      executionId,
      { status: "cancel_requested" },
      {
        ...common,
        status: "outcome_unknown",
        refundStatus: "unknown",
        imageCount: 0,
        images: [],
        errorCode: sanitizeCode(outcome.errorCode || "LATE_UNKNOWN_AFTER_CANCEL"),
        errorCategory: "cancelled_late_outcome_unknown",
        errorMessage: "design platform outcome remained unknown after local cancellation",
      },
    );
  }

  async markOutcomeUnknown(executionId: string, code: string, message: string, httpStatus?: number) {
    return this.transition(
      executionId,
      { status: "generating" },
      {
        status: "outcome_unknown",
        acceptanceStatus: "manual_review",
        refundStatus: "unknown",
        imageCount: 0,
        images: [],
        errorCode: sanitizeCode(code),
        errorCategory: uncertainErrorCategory(code),
        errorMessage: publicExecutionErrorMessage(uncertainErrorCategory(code)),
        responseHttpStatus: httpStatus,
        completedAt: timestamp(),
      },
      {
        status: "manual_review",
        manualQcRequired: true,
        errorMessage: "设计平台生成结果未知，必须人工核对扣费和出图结果，禁止普通重试。",
      },
    );
  }

  async recoverStaleExecutions() {
    const leaseCutoff = new Date(Date.now() - Math.max(1, appConfig.designPlatformTimeoutMs) - 5_000);
    if (appConfig.useLocalStore) {
      return this.localStore.recoverStaleDesignPlatformExecutions(this.processRunId, leaseCutoff.toISOString());
    }
    const prisma = this.prisma as any;
    const stale = await prisma.designPlatformExecution.findMany({
        where: {
          status: { in: ["dispatching", "generating", "cancel_requested"] },
          processRunId: { not: this.processRunId },
          updatedAt: { lt: leaseCutoff },
        },
      });
      const recovered = [];
      for (const execution of stale) {
        const wasCancelled = execution.status === "cancel_requested";
        const executionUpdate = {
          where: { id: execution.id, status: execution.status, processRunId: execution.processRunId },
          data: {
            status: "outcome_unknown",
            acceptanceStatus: wasCancelled ? "rejected" : "manual_review",
            refundStatus: "unknown",
            errorCode: wasCancelled ? "CANCELLED_EXECUTION_OUTCOME_UNKNOWN" : "PROCESS_RESTARTED_DURING_DISPATCH",
            errorCategory: wasCancelled ? "cancelled_late_outcome_unknown" : "process_restart_unknown",
            errorMessage: wasCancelled
              ? "cancelled design platform execution has no late outcome evidence after recovery lease"
              : "design platform generation may have been accepted before process restart",
            completedAt: new Date(),
            ...(wasCancelled ? { resolvedAt: new Date() } : {}),
          },
        };
        if (wasCancelled) {
          const changed = await prisma.designPlatformExecution.updateMany(executionUpdate);
          if (changed.count === 1) recovered.push({ ...execution, status: "outcome_unknown" });
          continue;
        }
        try {
          const changed = await prisma.$transaction(async (tx: any) => {
            const jobChanged = await tx.designJob.updateMany({
          where: { id: execution.designJobId, externalJobId: execution.externalJobId, status: { not: "cancelled" } },
          data: {
            status: "manual_review",
            manualQcRequired: true,
            errorMessage: "设计平台生成结果未知，必须人工核对扣费和出图结果，禁止普通重试。",
          },
        });
            if (jobChanged.count !== 1) throw transitionCasRejected();
            const executionChanged = await tx.designPlatformExecution.updateMany(executionUpdate);
            if (executionChanged.count !== 1) throw transitionCasRejected();
            return true;
          });
          if (changed) recovered.push({ ...execution, status: "outcome_unknown" });
        } catch (error) {
          if ((error as any)?.code !== "DESIGN_PLATFORM_TRANSITION_CAS_REJECTED") throw error;
        }
      }
      await prisma.designPlatformExecution.updateMany({
        where: {
          status: "completed",
          acceptanceStatus: "accepting",
          processRunId: { not: this.processRunId },
          updatedAt: { lt: leaseCutoff },
        },
        data: { acceptanceStatus: "pending", processRunId: this.processRunId },
      });
    return recovered;
  }

  async claimAcceptance(executionId: string) {
    if (appConfig.useLocalStore) {
      const execution = this.localStore.getDesignPlatformExecution(executionId);
      if (!execution || execution.status !== "completed" || execution.acceptanceStatus !== "pending") return null;
      const job = this.localStore.getDesignJob(execution.designJobId);
      const revision = execution.designRevisionId
        ? this.localStore.listDesignRevisions(execution.designJobId).find((item: any) => item.id === execution.designRevisionId)
        : null;
      if (!acceptanceBindingIsCurrent(job, revision, execution)) {
        this.localStore.transitionDesignPlatformExecution(
          execution.id,
          { status: "completed", acceptanceStatus: "pending" },
          { acceptanceStatus: "rejected", resolvedAt: timestamp(), errorCode: "STALE_OR_CANCELLED_RESULT" },
        );
        return null;
      }
      return this.localStore.transitionDesignPlatformExecution(
        execution.id,
        { status: "completed", acceptanceStatus: "pending" },
        { acceptanceStatus: "accepting", processRunId: this.processRunId },
      );
    }

    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const execution = await tx.designPlatformExecution.findUnique({ where: { id: executionId } });
      if (!execution || execution.status !== "completed" || execution.acceptanceStatus !== "pending") return null;
      const [job, revision] = await Promise.all([
        tx.designJob.findUnique({ where: { id: execution.designJobId } }),
        execution.designRevisionId
          ? tx.designRevision.findUnique({ where: { id: execution.designRevisionId } })
          : Promise.resolve(null),
      ]);
      if (!acceptanceBindingIsCurrent(job, revision, execution)) {
        await tx.designPlatformExecution.updateMany({
          where: {
            id: execution.id,
            status: "completed",
            acceptanceStatus: "pending",
            processRunId: execution.processRunId,
          },
          data: { acceptanceStatus: "rejected", resolvedAt: new Date(), errorCode: "STALE_OR_CANCELLED_RESULT" },
        });
        return null;
      }
      const changed = await tx.designPlatformExecution.updateMany({
        where: {
          id: execution.id,
          status: "completed",
          acceptanceStatus: "pending",
          processRunId: execution.processRunId,
        },
        data: { acceptanceStatus: "accepting", processRunId: this.processRunId },
      });
      return changed.count === 1 ? { ...execution, acceptanceStatus: "accepting" } : null;
    });
  }

  async finishAcceptance(executionId: string, status: "accepted" | "manual_review" | "pending", errorMessage?: string) {
    return this.transition(
      executionId,
      { status: "completed", acceptanceStatus: "accepting" },
      {
        acceptanceStatus: status,
        ...(status === "accepted" ? { acceptedAt: timestamp() } : {}),
        ...(status === "pending" ? {} : { resolvedAt: timestamp() }),
        ...(errorMessage ? { errorMessage: publicExecutionErrorMessage("acceptance_failure") } : {}),
      },
    );
  }

  async commitAcceptedResult(input: {
    executionId: string;
    images: Array<Record<string, unknown>>;
    resultImageIds: string[];
    nextStatus: string;
  }) {
    if (appConfig.useLocalStore) return this.localStore.commitAcceptedDesignPlatformExecution(input);
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const execution = await tx.designPlatformExecution.findUnique({ where: { id: input.executionId } });
      if (!execution || execution.status !== "completed" || execution.acceptanceStatus !== "accepting") {
        throw new Error("design platform execution is not accepting");
      }
      const job = await tx.designJob.findUnique({ where: { id: execution.designJobId } });
      if (!job || job.status === "cancelled" || job.externalJobId !== execution.externalJobId) {
        throw new Error("design platform acceptance job binding changed");
      }
      const revision = execution.designRevisionId
        ? await tx.designRevision.findUnique({ where: { id: execution.designRevisionId } })
        : null;
      if (
        execution.designRevisionId &&
        (!revision || revision.designJobId !== job.id || Number(revision.revisionNumber || 0) !== Number(job.revisionCount || 0))
      ) throw new Error("design platform acceptance revision binding changed");
      if (!execution.designRevisionId && Number(job.revisionCount || 0) !== 0) {
        throw new Error("initial design platform result became stale");
      }

      for (const image of input.images) {
        await tx.designImageCandidate.upsert({
          where: { designJobId_imageId: { designJobId: job.id, imageId: image.imageId } },
          update: image,
          create: { ...image, designJobId: job.id },
        });
      }
      if (revision) {
        const revisionChanged = await tx.designRevision.updateMany({
          where: { id: revision.id, status: revision.status, updatedAt: revision.updatedAt },
          data: { status: "completed", resultImageIds: input.resultImageIds, errorMessage: null },
        });
        if (revisionChanged.count !== 1) throw new Error("design revision changed during result acceptance");
      }
      const now = new Date();
      const jobChanged = await tx.designJob.updateMany({
        where: {
          id: job.id,
          externalJobId: execution.externalJobId,
          status: job.status,
          updatedAt: job.updatedAt,
          revisionCount: job.revisionCount,
        },
        data: { status: input.nextStatus, completedAt: now, errorMessage: null },
      });
      if (jobChanged.count !== 1) throw new Error("design job changed during result acceptance");
      const accepted = await tx.designPlatformExecution.updateMany({
        where: {
          id: execution.id,
          status: "completed",
          acceptanceStatus: "accepting",
          processRunId: this.processRunId,
        },
        data: { acceptanceStatus: "accepted", acceptedAt: now, resolvedAt: now },
      });
      if (accepted.count !== 1) throw new Error("design platform acceptance CAS failed");
      return tx.designJob.findUnique({ where: { id: job.id }, include: { images: true } });
    });
  }

  async assertRetryAllowed(designJobId: string) {
    const blocked = await this.findRetryBlocker(designJobId);
    if (blocked) throw new Error(retryBlockMessage(blocked));
  }

  async findRetryBlocker(designJobId: string) {
    if (appConfig.useLocalStore) {
      return this.localStore.listDesignPlatformExecutions({ designJobId }).find((item: any) => {
        if (ACTIVE_EXECUTION_STATUSES.includes(item.status)) return true;
        if (item.status === "outcome_unknown") return true;
        if (item.status === "completed" && !["accepted", "rejected"].includes(item.acceptanceStatus)) return true;
        return item.status === "explicit_failed" &&
          !RETRY_SAFE_REFUND_STATUSES.includes(item.refundStatus);
      }) || null;
    }
    return (this.prisma as any).designPlatformExecution.findFirst({
      where: retryBlockingWhere(designJobId),
      orderBy: { createdAt: "desc" },
    });
  }

  async requestCancellation(externalJobId: string) {
    if (appConfig.useLocalStore) {
      return this.localStore.requestDesignPlatformExecutionCancellation(externalJobId);
    }
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const execution = await tx.designPlatformExecution.findUnique({ where: { externalJobId } });
      const jobChanged = await tx.designJob.updateMany({
        where: {
          ...(execution ? { id: execution.designJobId } : {}),
          externalJobId,
          status: { not: "cancelled" },
        },
        data: { status: "cancelled" },
      });
      if (!execution) return null;
      if (jobChanged.count !== 1) {
        const currentJob = await tx.designJob.findUnique({ where: { id: execution.designJobId } });
        if (
          !currentJob ||
          currentJob.externalJobId !== execution.externalJobId ||
          currentJob.status !== "cancelled"
        ) return execution;
      }
      const now = new Date();
      const prepared = await tx.designPlatformExecution.updateMany({
        where: { id: execution.id, status: "prepared" },
        data: {
          status: "cancelled",
          acceptanceStatus: "rejected",
          refundStatus: "not_required",
          imageCount: 0,
          images: [],
          errorCategory: "cancelled_before_dispatch",
          errorCode: "LOCAL_CANCELLED_BEFORE_DISPATCH",
          completedAt: now,
          resolvedAt: now,
        },
      });
      if (prepared.count !== 1) {
        const active = await tx.designPlatformExecution.updateMany({
          where: { id: execution.id, status: { in: ["dispatching", "generating"] } },
          data: {
            status: "cancel_requested",
            acceptanceStatus: "rejected",
            errorCategory: "cancel_requested",
            errorCode: "LOCAL_CANCEL_REQUESTED",
          },
        });
        if (active.count !== 1) {
          await tx.designPlatformExecution.updateMany({
            where: {
              id: execution.id,
              status: "completed",
              acceptanceStatus: { in: ["pending", "accepting", "manual_review"] },
            },
            data: {
              acceptanceStatus: "rejected",
              errorCategory: "cancelled_before_acceptance",
              errorCode: "LOCAL_CANCELLED_BEFORE_ACCEPTANCE",
              resolvedAt: now,
            },
          });
        }
      }
      return tx.designPlatformExecution.findUnique({ where: { externalJobId } });
    });
  }

  async resolveUnknown(executionId: string, resolution: string, reviewer: string) {
    if (appConfig.useLocalStore) {
      return this.localStore.resolveUnknownDesignPlatformExecution(executionId, resolution, reviewer);
    }
    if (resolution !== "confirmed_not_generated_refunded" || !String(reviewer || "").trim()) {
      throw new Error("explicit confirmed_not_generated_refunded resolution and reviewer are required");
    }
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const execution = await tx.designPlatformExecution.findUnique({ where: { id: executionId } });
      if (!execution || execution.status !== "outcome_unknown" || execution.resolvedAt) {
        throw new Error("only unresolved outcome_unknown execution can be resolved");
      }
      const changed = await tx.designPlatformExecution.updateMany({
        where: { id: executionId, status: "outcome_unknown", resolvedAt: null, updatedAt: execution.updatedAt },
        data: {
          status: "explicit_failed",
          acceptanceStatus: "manual_review",
          refundStatus: "refunded",
          refundSummary: mergeRefundResolution(execution.refundSummary, resolution, reviewer),
          resolvedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new Error("only unresolved outcome_unknown execution can be resolved");
      return tx.designPlatformExecution.findUnique({ where: { id: executionId } });
    });
  }

  async resolveUnknownPublic(executionId: string, resolution: string, reviewer: string) {
    return toPublicExecutionView(await this.resolveUnknown(executionId, resolution, reviewer));
  }

  async resolveUnsafeRefund(executionId: string, resolution: string, reviewer: string) {
    if (appConfig.useLocalStore) {
      return this.localStore.resolveUnsafeDesignPlatformRefund(executionId, resolution, reviewer);
    }
    if (resolution !== "confirmed_refunded" || !String(reviewer || "").trim()) {
      throw new Error("explicit confirmed_refunded resolution and reviewer are required");
    }
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const execution = await tx.designPlatformExecution.findUnique({ where: { id: executionId } });
      const resumableCompleted = isResumableCompletedExecution(execution);
      if (!isUnsafeRefundResolutionEligible(execution)) {
        throw new Error("only an eligible unsafe refund can be resolved");
      }
      const changed = await tx.designPlatformExecution.updateMany({
        where: {
          id: executionId,
          status: execution.status,
          acceptanceStatus: execution.acceptanceStatus,
          refundStatus: execution.refundStatus,
          updatedAt: execution.updatedAt,
        },
        data: {
          refundStatus: "refunded",
          ...(resumableCompleted ? { acceptanceStatus: "pending" } : {}),
          refundSummary: mergeRefundResolution(execution.refundSummary, resolution, reviewer),
          resolvedAt: resumableCompleted ? null : new Date(),
        },
      });
      if (changed.count !== 1) throw new Error("only an eligible unsafe refund can be resolved");
      return tx.designPlatformExecution.findUnique({ where: { id: executionId } });
    });
  }

  async resolveUnsafeRefundPublic(executionId: string, resolution: string, reviewer: string) {
    return toPublicExecutionView(await this.resolveUnsafeRefund(executionId, resolution, reviewer));
  }

  private async transition(
    executionId: string,
    expected: { status?: string; acceptanceStatus?: string },
    patch: Record<string, unknown>,
    jobPatch?: Record<string, unknown>,
  ) {
    if (appConfig.useLocalStore) {
      return this.localStore.transitionDesignPlatformExecution(executionId, expected, patch, jobPatch);
    }
    const prisma = this.prisma as any;
    try {
      return await prisma.$transaction(async (tx: any) => {
        const execution = await tx.designPlatformExecution.findUnique({ where: { id: executionId } });
        if (!execution) return null;
        if (jobPatch) {
          const jobChanged = await tx.designJob.updateMany({
            where: { id: execution.designJobId, externalJobId: execution.externalJobId, status: { not: "cancelled" } },
            data: prismaData(jobPatch),
          });
          if (jobChanged.count !== 1) throw transitionCasRejected();
        }
        const changed = await tx.designPlatformExecution.updateMany({
          where: {
            id: executionId,
            ...(expected.status ? { status: expected.status } : {}),
            ...(expected.acceptanceStatus ? { acceptanceStatus: expected.acceptanceStatus } : {}),
          },
          data: prismaData(patch),
        });
        if (changed.count !== 1) throw transitionCasRejected();
        return tx.designPlatformExecution.findUnique({ where: { id: executionId } });
      });
    } catch (error) {
      if ((error as any)?.code === "DESIGN_PLATFORM_TRANSITION_CAS_REJECTED") return null;
      throw error;
    }
  }
}

function transitionCasRejected() {
  return Object.assign(new Error("design platform transition CAS rejected"), {
    code: "DESIGN_PLATFORM_TRANSITION_CAS_REJECTED",
  });
}

function acceptanceBindingIsCurrent(job: any, revision: any, execution: any) {
  if (!job || job.status === "cancelled" || job.externalJobId !== execution.externalJobId) return false;
  if (execution.designRevisionId) {
    return Boolean(
      revision &&
      revision.designJobId === job.id &&
      revision.externalJobId === execution.externalJobId &&
      Number(revision.revisionNumber || 0) === Number(job.revisionCount || 0),
    );
  }
  return Number(job.revisionCount || 0) === 0;
}

function sanitizeImages(images: any[]) {
  return images.slice(0, 6).map((image, index) => ({
    imageId: sanitizeText(image?.imageId || `candidate_${index + 1}`, 120),
    downloadUrl: sanitizeUrl(image?.downloadUrl),
    ...(Number.isFinite(Number(image?.width)) ? { width: Number(image.width) } : {}),
    ...(Number.isFinite(Number(image?.height)) ? { height: Number(image.height) } : {}),
  }));
}

function sanitizeUrl(value: unknown) {
  const text = String(value || "").trim();
  try {
    const parsed = new URL(text);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sanitizeRefundSummary(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const summary: Record<string, unknown> = {};
  for (const key of ["reason", "requestedCredits", "refundedCredits", "chargedCredits", "mode", "alreadyRefunded"]) {
    const item = source[key];
    if (typeof item === "number" && Number.isFinite(item)) summary[key] = item;
    else if (typeof item === "boolean") summary[key] = item;
    else if (typeof item === "string") summary[key] = sanitizeText(item, 120);
  }
  return Object.keys(summary).length ? summary : null;
}

function mergeRefundResolution(value: unknown, resolution: string, reviewer: string) {
  return {
    ...(sanitizeRefundSummary(value) || {}),
    resolution,
    reviewer: sanitizeText(reviewer, 80),
  };
}

function sanitizeCode(value: unknown) {
  return String(value || "UNKNOWN").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
}

function toPublicExecutionView(execution: any): DesignPlatformExecutionView {
  const availableResolution: DesignExecutionAvailableResolution =
    execution?.status === "outcome_unknown" && !execution?.resolvedAt
      ? "confirmed_not_generated_refunded"
      : isUnsafeRefundResolutionEligible(execution)
        ? "confirmed_refunded"
        : null;
  return {
    id: sanitizeIdentifier(execution?.id),
    attemptNo: safeCount(execution?.attemptNo, 100000),
    status: safePublicCode(execution?.status, PUBLIC_EXECUTION_STATUSES),
    acceptanceStatus: safePublicCode(execution?.acceptanceStatus, PUBLIC_ACCEPTANCE_STATUSES),
    refundStatus: safePublicCode(execution?.refundStatus, PUBLIC_REFUND_STATUSES),
    imageCount: safeCount(execution?.imageCount, 1000),
    errorCategory: execution?.errorCategory
      ? safePublicCode(execution.errorCategory, PUBLIC_ERROR_CATEGORIES, "other_error")
      : null,
    responseHttpStatus:
      Number.isInteger(execution?.responseHttpStatus)
      && execution.responseHttpStatus >= 100
      && execution.responseHttpStatus <= 599
        ? execution.responseHttpStatus
        : null,
    createdAt: safeTimestamp(execution?.createdAt),
    updatedAt: safeTimestamp(execution?.updatedAt),
    completedAt: safeTimestamp(execution?.completedAt),
    resolvedAt: safeTimestamp(execution?.resolvedAt),
    availableResolution,
  };
}

function isUnsafeRefundResolutionEligible(execution: any) {
  return Boolean(
    execution
    && (execution.status === "explicit_failed" || isResumableCompletedExecution(execution))
    && ["failed", "unknown"].includes(execution.refundStatus),
  );
}

function isResumableCompletedExecution(execution: any) {
  return execution?.status === "completed" && execution?.acceptanceStatus === "manual_review";
}

function sanitizeIdentifier(value: unknown) {
  return String(value || "").replace(/[^\p{L}\p{N}_.:-]/gu, "_").slice(0, 160);
}

function safePublicCode(value: unknown, allowed: ReadonlySet<string>, fallback = "unknown") {
  const code = String(value || "");
  return allowed.has(code) ? code : fallback;
}

function safeCount(value: unknown, maximum: number) {
  const count = Number(value);
  return Number.isInteger(count) ? Math.min(maximum, Math.max(0, count)) : 0;
}

function safeTimestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sanitizeText(value: unknown, max = 500) {
  return String(value || "unknown design platform error")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/\b(?:authorization|cookie|token|api[_-]?key|password|secret)\s*[:=]\s*[^\s;,]+/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s;,]+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, max);
}

function timestamp() {
  return appConfig.useLocalStore ? new Date().toISOString() : new Date();
}

function prismaData(value: Record<string, unknown>) {
  const result = { ...value };
  for (const key of ["completedAt", "resolvedAt", "dispatchedAt", "acceptedAt"]) {
    if (typeof result[key] === "string") result[key] = new Date(result[key] as string);
  }
  return result;
}

function uncertainErrorCategory(code: unknown) {
  const value = String(code || "").toUpperCase();
  if (/TIME|ECONNABORTED|ETIMEDOUT/.test(value)) return "timeout_unknown";
  if (/ECONNRESET/.test(value)) return "connection_reset_unknown";
  if (/HTTP_5|MALFORMED/.test(value)) return "remote_acceptance_unknown";
  return "transport_outcome_unknown";
}

function publicExecutionErrorMessage(category: string) {
  const messages: Record<string, string> = {
    explicit_remote_failure: "design platform reported an explicit terminal failure",
    local_pre_dispatch_failure: "design platform request could not be prepared before dispatch",
    timeout_unknown: "design platform request timed out; generation and refund outcome are unknown",
    connection_reset_unknown: "design platform connection reset; generation and refund outcome are unknown",
    remote_acceptance_unknown: "design platform response cannot prove generation or refund outcome",
    transport_outcome_unknown: "design platform transport outcome is unknown",
    acceptance_failure: "generated result is awaiting local acceptance recovery",
  };
  return messages[category] || "design platform execution requires manual review";
}
