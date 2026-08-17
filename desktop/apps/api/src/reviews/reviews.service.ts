import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DesignJobsService } from "../design-jobs/design-jobs.service";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { QuotesService } from "../quotes/quotes.service";
import { rules } from "../shared/rules";
import { appConfig } from "../shared/app-config";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import {
  assertExactOperationReplay,
  createOperationFingerprint,
  deterministicOperationId,
  isUniqueConstraintError,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
  type RequestOperationMetadata,
} from "../shared/operation-idempotency";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

const { isHighValueBudget, quoteNeedsPaymentProofReview } = rules;

type ReviewPayload = ExpectedIdentityPayload & {
  operationKey?: string;
  decision: string;
  reviewer?: string;
  note?: string;
  followupType?: "production" | "delivery";
};

type ReviewOperation = {
  effectKey: string;
  logId: string;
  operation: RequestOperationMetadata;
  metadata: {
    effectKey: string;
    requestOperation: RequestOperationMetadata;
  };
};

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly designJobs: DesignJobsService,
    private readonly quotes: QuotesService,
    private readonly notifications: NotificationsService,
    private readonly wechat: WechatDispatchService,
    private readonly orders?: OrdersService,
  ) {}

  async list(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) {
      const designJobs = this.localStore
        .listDesignJobs(filter)
        .filter((job: any) => isDesignJobReviewVisible(job))
        .slice(0, 80);
      const quoteDrafts = this.localStore
        .listQuoteDrafts(filter)
        .filter((quote: any) => isQuoteReviewVisible(quote))
        .slice(0, 80);
      const orderDrafts = this.localStore
        .listOrderDrafts(filter)
        .filter((order: any) => isOrderReviewVisible(order))
        .slice(0, 80);
      return {
        designJobs,
        quoteDrafts,
        orderDrafts,
        logs: this.localStore.listReviewLogs({ ...filter, limit: 80 }),
      };
    }

    const prisma = this.prisma as any;
    const [designJobCandidates, quoteCandidates, orderCandidates, logs] = await Promise.all([
      this.prisma.designJob.findMany({
        where: { status: { in: ["manual_review", "failed", "timeout", "completed", "quick_confirm"] } },
        include: { customer: true, conversation: true, images: true, assets: true },
        orderBy: { updatedAt: "desc" },
        take: 120,
      }),
      this.prisma.quoteDraft.findMany({
        where: { status: { in: ["manual_review", "draft", "auto_sent", "send_queued", "sent", "accepted"] } },
        include: { customer: true, designJob: true, selectedImage: true },
        orderBy: { updatedAt: "desc" },
        take: 120,
      }),
      prisma.orderDraft.findMany({
        where: { status: { in: ["draft", "confirmed", "processing"] } },
        include: {
          customer: true,
          conversation: true,
          wechatAccount: true,
          designJob: true,
          quoteDraft: { include: { designJob: true, customer: true, selectedImage: true } },
          selectedImage: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 120,
      }),
      prisma.reviewLog.findMany({ orderBy: { createdAt: "desc" }, take: hasIdentityFilter(filter) ? 240 : 80 }),
    ]);
    const designJobs = designJobCandidates.filter((job: any) => isDesignJobReviewVisible(job)).slice(0, 80);
    const quoteDrafts = quoteCandidates.filter((quote: any) => isQuoteReviewVisible(quote)).slice(0, 80);
    const orderDrafts = orderCandidates.filter((order: any) => isOrderReviewVisible(order)).slice(0, 80);
    return { designJobs, quoteDrafts, orderDrafts, logs: logs.filter((log: any) => matchesReviewLogIdentity(log, filter)).slice(0, 80) };
  }

  async getDesignJob(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({
          where: { id },
          include: { customer: true, conversation: true, images: true, assets: true },
        });
    if (!job) throw new NotFoundException(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    return job;
  }

  async getQuote(id: string, expected: ExpectedIdentityPayload = {}) {
    return this.quotes.getById(id, expected);
  }

  async getOrder(id: string, expected: ExpectedIdentityPayload = {}) {
    if (this.orders) return this.orders.getById(id, expected);
    const order = appConfig.useLocalStore
      ? this.localStore.getOrderDraft(id)
      : await (this.prisma as any).orderDraft.findUnique({
          where: { id },
          include: {
            customer: true,
            conversation: true,
            wechatAccount: true,
            designJob: true,
            quoteDraft: { include: { designJob: true, customer: true, selectedImage: true } },
            selectedImage: true,
          },
        });
    if (!order) throw new NotFoundException(`order draft not found: ${id}`);
    assertExpectedIdentity(order, expected, "order draft");
    return order;
  }

  async reviewDesignJob(id: string, payload: ReviewPayload) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, payload, "design job");
    const beforeStatus = job.status;
    const decision = payload.decision || "approve_images";
    const designJobTarget = {
      designJobId: id,
      wechatAccountId: job.wechatAccountId,
      conversationId: job.conversationId,
      customerId: job.customerId,
    };
    const reviewOperation = this.buildReviewOperation("design_job", id, decision, payload);
    const replayedLog = await this.findReviewReplay(reviewOperation, "design job review");
    if (replayedLog) {
      return { result: { designJob: job }, log: replayedLog, notification: null, replayed: true };
    }
    let result: any;
    let notification: any = null;

    if (decision === "approve_send") {
      const sendTask = await this.designJobs.quickConfirmAndQueueSend(id, {
        operationKey: payload.operationKey,
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        releaseManualLock: true,
        reviewer: payload.reviewer || "人工客服",
        releaseReason: "manual_approve_send",
      });
      const designJob = appConfig.useLocalStore
        ? this.localStore.getDesignJob(id)
        : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
      result = { designJob, sendTask };
      notification = await this.notifications.create("info", "人工审核已批准发送", payload.note || "图片已通过人工审核，已进入安全发送队列。", {
        ...designJobTarget,
        sendTaskId: sendTask?.id,
      });
    } else if (decision === "request_revision") {
      result = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(id, {
            status: "manual_review",
            manualQcRequired: true,
            errorMessage: payload.note || "人工审核要求继续改图",
          })
        : await this.prisma.designJob.update({
            where: { id },
            data: {
              status: "manual_review",
              manualQcRequired: true,
              errorMessage: payload.note || "人工审核要求继续改图",
            },
          });
      notification = await this.notifications.create("warning", "人工审核要求改图", payload.note || "需要继续调整效果图。", {
        ...designJobTarget,
      });
    } else if (decision === "reject") {
      result = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(id, {
            status: "manual_review",
            manualQcRequired: true,
            errorMessage: payload.note || "人工审核未通过",
          })
        : await this.prisma.designJob.update({
            where: { id },
            data: {
              status: "manual_review",
              manualQcRequired: true,
              errorMessage: payload.note || "人工审核未通过",
            },
          });
      notification = await this.notifications.create("error", "人工审核未通过", payload.note || "该设计任务仍需人工处理。", {
        ...designJobTarget,
      });
    } else {
      const keepManualReview = isDesignJobHighValue(job);
      result = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(id, {
            status: keepManualReview ? "manual_review" : "quick_confirm",
            manualQcRequired: keepManualReview,
            errorMessage: "",
          })
        : await this.prisma.designJob.update({
            where: { id },
            data: {
              status: keepManualReview ? "manual_review" : "quick_confirm",
              manualQcRequired: keepManualReview,
              errorMessage: "",
            },
          });
      notification = await this.notifications.create("info", "人工审核已通过", payload.note || "图片可进入快速确认或发送。", {
        ...designJobTarget,
      });
    }

    const afterStatus = result?.status || (decision === "approve_send" ? "sent" : "quick_confirm");
    const log = await this.createLog({
      targetType: "design_job",
      targetId: id,
      decision,
      reviewer: payload.reviewer,
      note: payload.note,
      beforeStatus,
      afterStatus,
      metadata: {
        ...designJobTarget,
        ...reviewOperation?.metadata,
      },
    });
    return { result, log, notification };
  }

  async reviewQuote(id: string, payload: ReviewPayload) {
    const quote = appConfig.useLocalStore
      ? this.localStore.getQuoteDraft(id)
      : await this.prisma.quoteDraft.findUnique({ where: { id }, include: { designJob: true } });
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    assertExpectedIdentity(quote, payload, "quote draft");
    const beforeStatus = quote.status;
    const decision = payload.decision || "approve_quote";
    const quoteTarget = {
      quoteDraftId: id,
      designJobId: quote.designJobId || quote.designJob?.id,
      wechatAccountId: quote.designJob?.wechatAccountId,
      conversationId: quote.designJob?.conversationId,
      customerId: quote.customerId || quote.designJob?.customerId,
    };
    const reviewOperation = this.buildReviewOperation("quote", id, decision, payload);
    const replayedLog = await this.findReviewReplay(reviewOperation, "quote review");
    if (replayedLog) {
      return { result: { quote }, log: replayedLog, notification: null, replayed: true };
    }
    let result: any;
    let notification: any = null;
    let customerNotes: string;
    if (decision === "reject_quote") {
      customerNotes = payload.note || "人工审核驳回报价";
      result = await this.quotes.update(id, {
        status: "rejected",
        owner: payload.reviewer || "人工客服",
        customerNotes,
      });
    } else if (decision === "request_followup") {
      customerNotes = payload.note || "需要继续跟进客户";
      result = await this.quotes.update(id, {
        status: "manual_review",
        owner: payload.reviewer || "人工客服",
        customerNotes,
      });
    } else {
      customerNotes = payload.note || "人工审核通过，报价已进入微信安全发送队列";
      if (quoteNeedsPaymentProofReview(quote)) {
        throw new BadRequestException("付款凭证报价需要先人工核验金额和收款账户，再标记定金或全款，不能按普通报价通过。");
      }
      result = await this.quotes.queueSend(id, {
        operationKey: payload.operationKey,
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: payload.reviewer || "人工客服",
        note: customerNotes,
        releaseManualLock: true,
        releaseReason: "manual_approve_quote",
      });
    }
    const resultQuote = result?.quote || result;
    notification = await this.notifications.create(
      decision === "reject_quote" ? "warning" : "info",
      decision === "reject_quote" ? "报价审核未通过" : "报价审核已处理",
      customerNotes,
      { ...quoteTarget, sendTaskId: result?.sendTask?.id },
    );
    const log = await this.createLog({
      targetType: "quote",
      targetId: id,
      decision,
      reviewer: payload.reviewer,
      note: payload.note,
      beforeStatus,
      afterStatus: resultQuote.status,
      metadata: {
        ...quoteTarget,
        ...reviewOperation?.metadata,
        sendTaskId: result?.sendTask?.id,
      },
    });
    return { result, log, notification };
  }

  async reviewOrder(id: string, payload: ReviewPayload) {
    const order = appConfig.useLocalStore
      ? this.localStore.getOrderDraft(id)
      : await (this.prisma as any).orderDraft.findUnique({
          where: { id },
          include: {
            customer: true,
            conversation: true,
            wechatAccount: true,
            designJob: true,
            quoteDraft: { include: { designJob: true, customer: true, selectedImage: true } },
            selectedImage: true,
          },
        });
    if (!order) throw new Error(`order draft not found: ${id}`);
    assertExpectedIdentity(order, payload, "order draft");

    const beforeStatus = order.status;
    const decision = payload.decision || "request_followup";
    const orderTarget = {
      orderDraftId: id,
      quoteDraftId: order.quoteDraftId || order.quoteDraft?.id,
      designJobId: order.designJobId || order.designJob?.id || order.quoteDraft?.designJobId || order.quoteDraft?.designJob?.id,
      wechatAccountId: order.wechatAccountId,
      conversationId: order.conversationId,
      customerId: order.customerId,
    };
    const reviewOperation = this.buildReviewOperation("order_draft", id, decision, payload);
    const replayedLog = await this.findReviewReplay(reviewOperation, "order review");
    if (replayedLog) {
      return { result: { orderDraft: order }, log: replayedLog, notification: null, replayed: true };
    }
    assertHighValueOrderHasCompleteIdentity(order, decision);
    assertHighValueOrderApprovalReady(order, decision);
    const reviewer = payload.reviewer || "人工客服";
    let result: any = { orderDraft: order };
    let notification: any = null;

    if (decision === "approve_confirmation") {
      result = await this.wechat.queueOrderConfirmation(id, {
        operationKey: payload.operationKey,
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: reviewer,
        note: payload.note || "高价值订单已人工审核，订单确认已进入微信安全发送队列。",
        releaseManualLock: true,
        releaseReason: "manual_approve_order_confirmation",
      });
      result.orderDraft = await this.updateReviewedOrder(id, {
        owner: reviewer,
        customerNotes: appendCustomerNote(
          order.customerNotes,
          payload.note || "高价值订单已人工审核，订单确认已进入微信安全发送队列。",
        ),
      });
    } else if (decision === "approve_followup") {
      const followupType = payload.followupType || "delivery";
      result = await this.wechat.queueOrderFollowup(id, {
        operationKey: payload.operationKey,
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: reviewer,
        type: followupType,
        reason: "manual_approve_order_followup",
        releaseManualLock: true,
        releaseReason: "manual_approve_order_followup",
      });
      result.orderDraft = await this.updateReviewedOrder(id, {
        owner: reviewer,
        customerNotes: appendCustomerNote(
          order.customerNotes,
          payload.note ||
            (followupType === "delivery"
              ? "高价值订单已人工审核，交期说明已进入微信安全发送队列。"
              : "高价值订单已人工审核，生产进度已进入微信安全发送队列。"),
        ),
      });
    } else {
      const note = appendCustomerNote(
        order.customerNotes,
        payload.note ||
          (decision === "reject_order"
            ? "高价值订单审核未通过，已停止自动推进。"
            : "高价值订单已保留在人工处理队列，请客服继续核对客户需求、收款、交期和话术。"),
      );
      result.orderDraft = await this.updateReviewedOrder(id, {
        owner: reviewer,
        customerNotes: note,
        ...(decision === "reject_order" ? { status: "cancelled" } : {}),
      });
      notification = await this.notifications.create(
        decision === "reject_order" ? "warning" : "info",
        decision === "reject_order" ? "高价值订单审核未通过" : "高价值订单继续人工跟进",
        payload.note || "该订单已保留在人工处理队列，请客服继续核对客户需求、收款、交期和话术。",
        {
          orderDraftId: id,
          quoteDraftId: order.quoteDraftId || order.quoteDraft?.id,
          designJobId: order.designJobId || order.designJob?.id || order.quoteDraft?.designJobId || order.quoteDraft?.designJob?.id,
          wechatAccountId: order.wechatAccountId,
          conversationId: order.conversationId,
          customerId: order.customerId,
        },
      );
    }

    const resultOrder = result?.orderDraft || result?.order || result;
    const log = await this.createLog({
      targetType: "order_draft",
      targetId: id,
      decision,
      reviewer: payload.reviewer,
      note: payload.note,
      beforeStatus,
      afterStatus: resultOrder?.status || beforeStatus,
      metadata: {
        ...orderTarget,
        ...reviewOperation?.metadata,
        sendTaskId: result?.sendTask?.id,
        followupType: payload.followupType,
        source: "manual_order_review",
      },
    });
    return { result, log, notification: result?.notification || notification || null };
  }

  private buildReviewOperation(targetType: string, targetId: string, decision: string, payload: ReviewPayload): ReviewOperation | null {
    if (!payload.operationKey) return null;
    const operationKey = normalizeOperationKey(payload.operationKey, `${targetType} review operationKey`);
    const operation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "manual-review",
        { targetType, targetId },
        {
          decision,
          reviewer: payload.reviewer || "",
          note: payload.note || "",
          followupType: payload.followupType || null,
          expectedWechatAccountId: payload.expectedWechatAccountId || null,
          expectedConversationId: payload.expectedConversationId || null,
          expectedCustomerId: payload.expectedCustomerId || null,
        },
      ),
    );
    const effectKey = `manual-review:${targetType}:${targetId}:${operationKey}`;
    return {
      effectKey,
      logId: deterministicOperationId("review", effectKey),
      operation,
      metadata: {
        effectKey,
        requestOperation: operation,
      },
    };
  }

  private async findReviewReplay(reviewOperation: ReviewOperation | null, label: string) {
    if (!reviewOperation) return null;
    const existing = await this.findReviewLogByOperation(reviewOperation);
    if (!existing) return null;
    assertExactOperationReplay(
      readRequestOperationMetadata(existing.metadata),
      reviewOperation.operation,
      label,
    );
    return existing;
  }

  private async findReviewLogByOperation(reviewOperation: ReviewOperation) {
    if (appConfig.useLocalStore) {
      const store = this.localStore as any;
      if (typeof store.getReviewLog === "function") {
        const byId = store.getReviewLog(reviewOperation.logId);
        if (byId) return byId;
      }
      if (typeof store.listReviewLogs === "function") {
        return store
          .listReviewLogs({ limit: 300 })
          .find((log: any) => String(log?.metadata?.effectKey || "") === reviewOperation.effectKey) || null;
      }
      return null;
    }

    const prisma = this.prisma as any;
    return prisma.reviewLog.findUnique({ where: { id: reviewOperation.logId } });
  }

  private async updateReviewedOrder(id: string, data: { owner?: string; customerNotes?: string; status?: string }) {
    if (appConfig.useLocalStore) {
      if (this.orders) return this.orders.update(id, data);
      return this.localStore.updateOrderDraft(id, data);
    }
    return (this.prisma as any).orderDraft.update({
      where: { id },
      data,
      include: {
        customer: true,
        conversation: true,
        wechatAccount: true,
        designJob: true,
        quoteDraft: { include: { designJob: true, customer: true, selectedImage: true } },
        selectedImage: true,
      },
    });
  }

  private async createLog(payload: {
    targetType: string;
    targetId: string;
    decision: string;
    reviewer?: string;
    note?: string;
    beforeStatus?: string;
    afterStatus?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (appConfig.useLocalStore) return this.localStore.createReviewLog(payload);
    const prisma = this.prisma as any;
    const effectKey = String(payload.metadata?.effectKey || "").trim();
    const expectedOperation = readRequestOperationMetadata(payload.metadata);
    const logId = effectKey ? deterministicOperationId("review", effectKey) : "";
    if (logId) {
      const existing = await prisma.reviewLog.findUnique({ where: { id: logId } });
      if (existing) {
        if (expectedOperation) {
          assertExactOperationReplay(readRequestOperationMetadata(existing.metadata), expectedOperation, "review log create");
        }
        return existing;
      }
    }
    try {
      return await prisma.reviewLog.create({ data: logId ? { id: logId, ...payload } : payload });
    } catch (error) {
      if (!logId || !isUniqueConstraintError(error)) throw error;
      const existing = await prisma.reviewLog.findUnique({ where: { id: logId } });
      if (!existing) throw error;
      if (expectedOperation) {
        assertExactOperationReplay(readRequestOperationMetadata(existing.metadata), expectedOperation, "review log create");
      }
      return existing;
    }
  }
}

function isDesignJobHighValue(job: any) {
  return Boolean(job?.isHighValue) || isHighValueBudget(job?.budget, Number(appConfig.highValueAmountCny || 10000));
}

function appendCustomerNote(current: unknown, next: string) {
  const existing = String(current || "").trim();
  const note = String(next || "").trim();
  if (!note) return existing;
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} ${note}`;
}

function hasIdentityFilter(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string }) {
  return Boolean(filter.wechatAccountId || filter.conversationId || filter.customerId);
}

function matchesReviewLogIdentity(log: any, filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  if (!hasIdentityFilter(filter)) return true;
  const metadata = log?.metadata || {};
  if (filter.wechatAccountId && String(metadata.wechatAccountId || "") !== String(filter.wechatAccountId)) return false;
  if (filter.conversationId && String(metadata.conversationId || "") !== String(filter.conversationId)) return false;
  if (filter.customerId && String(metadata.customerId || "") !== String(filter.customerId)) return false;
  return true;
}

function isDesignJobReviewVisible(job: any) {
  return (
    ["manual_review", "failed", "timeout"].includes(String(job?.status || "")) ||
    (isDesignJobHighValue(job) && ["completed", "quick_confirm"].includes(String(job?.status || "")))
  );
}

function isQuoteReviewVisible(quote: any) {
  const status = String(quote?.status || "");
  if (status === "manual_review") return true;
  if (["rejected", "cancelled"].includes(status)) return false;
  return isQuoteHighValue(quote);
}

function isQuoteHighValue(quote: any) {
  const highValueAmount = Number(appConfig.highValueAmountCny || 10000);
  const totalPrice = Number(quote?.totalPrice ?? 0);
  const unitPrice = Number(quote?.unitPrice ?? 0);
  return (
    Boolean(quote?.isHighValue) ||
    isDesignJobHighValue(quote?.designJob || {}) ||
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  );
}

function isOrderReviewVisible(order: any) {
  const status = String(order?.status || "");
  if (["fulfilled", "cancelled"].includes(status)) return false;
  return isOrderHighValue(order) || orderNeedsManualSendAttention(order);
}

function isOrderHighValue(order: any) {
  const highValueAmount = Number(appConfig.highValueAmountCny || 10000);
  const totalPrice = Number(order?.totalPrice ?? 0);
  const unitPrice = Number(order?.unitPrice ?? 0);
  const quote = order?.quoteDraft || {};
  return (
    Boolean(order?.isHighValue) ||
    isQuoteHighValue(quote) ||
    isDesignJobHighValue(order?.designJob || quote?.designJob || {}) ||
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  );
}

function orderNeedsManualSendAttention(order: any) {
  const owner = String(order?.owner || "").trim();
  const customerNotes = String(order?.customerNotes || "");
  return (
    owner === "\u4eba\u5de5\u5ba2\u670d" &&
    customerNotes.includes("[\u53d1\u9001\u4efb\u52a1:") &&
    customerNotes.includes("\u53d1\u9001\u5931\u8d25") &&
    customerNotes.includes("\u9700\u8981\u4eba\u5de5\u5904\u7406")
  );
}

function assertHighValueOrderHasCompleteIdentity(order: any, decision: string) {
  if (!["approve_confirmation", "approve_followup"].includes(decision)) return;
  if (!isOrderHighValue(order)) return;
  const wechatAccountId = String(order?.wechatAccountId || "").trim();
  const conversationId = String(order?.conversationId || "").trim();
  const customerId = String(order?.customerId || "").trim();
  if (wechatAccountId && conversationId && customerId) return;
  throw new BadRequestException("高价值订单缺少微信账号、客户或会话绑定，不能批准订单确认或跟进发送。");
}

function assertHighValueOrderApprovalReady(order: any, decision: string) {
  if (!["approve_confirmation", "approve_followup"].includes(decision)) return;
  if (!isOrderHighValue(order)) return;
  const selectedImageId = String(order?.selectedImageId || order?.quoteDraft?.selectedImageId || "").trim();
  if (!selectedImageId) {
    throw new BadRequestException("高价值订单未绑定客户选中的效果图，不能批准订单确认或跟进发送。");
  }
  const paymentStatus = String(order?.paymentStatus || order?.quoteDraft?.paymentStatus || "");
  if (!["deposit_paid", "paid"].includes(paymentStatus)) {
    throw new BadRequestException("高价值订单未核验定金或全款，不能批准订单确认或跟进发送。");
  }
  if (Number(order?.profit || 0) < 0) {
    throw new BadRequestException("高价值订单利润为负，必须人工确认报价和成本后再批准发送。");
  }
}
