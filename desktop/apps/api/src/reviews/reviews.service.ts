import { BadRequestException, Injectable } from "@nestjs/common";
import { DesignJobsService } from "../design-jobs/design-jobs.service";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { QuotesService } from "../quotes/quotes.service";
import { rules } from "../shared/rules";
import { appConfig } from "../shared/app-config";
import {
  ExpectedIdentityPayload,
  assertExpectedIdentity,
  assertRequiredExpectedIdentity,
} from "../shared/identity-expectation";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

const { isHighValueBudget, quoteNeedsPaymentProofReview } = rules;

type ReviewPayload = ExpectedIdentityPayload & {
  decision: string;
  reviewer?: string;
  note?: string;
  followupType?: "production" | "delivery";
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
      const sendTasks =
        typeof this.localStore.listSendTasks === "function"
          ? this.localStore
              .listSendTasks(filter)
              .filter((task: any) => isSendTaskReviewVisible(task))
              .slice(0, 80)
          : [];
      return {
        designJobs,
        quoteDrafts,
        orderDrafts,
        sendTasks,
        logs: filterReviewLogsByIdentity(
          this.localStore.listReviewLogs({ ...filter, limit: hasIdentityFilter(filter) ? 300 : 80 }),
          filter,
          { designJobs, quoteDrafts, orderDrafts, sendTasks },
        ).slice(0, 80),
      };
    }

    const prisma = this.prisma as any;
    const designJobWhere: any = {
      status: { in: ["manual_review", "failed", "timeout", "completed", "quick_confirm"] },
      ...designJobIdentityWhere(filter),
    };
    const quoteDraftWhere: any = {
      status: { in: ["manual_review", "draft", "auto_sent", "send_queued", "sent", "accepted"] },
      ...quoteDraftIdentityWhere(filter),
    };
    const [designJobCandidates, quoteCandidates, orderCandidates, sendTaskCandidates, logs] = await Promise.all([
      this.prisma.designJob.findMany({
        where: designJobWhere,
        include: { customer: true, conversation: true, images: true, assets: true },
        orderBy: { updatedAt: "desc" },
        take: 120,
      }),
      this.prisma.quoteDraft.findMany({
        where: quoteDraftWhere,
        include: { customer: true, designJob: true, selectedImage: true },
        orderBy: { updatedAt: "desc" },
        take: 120,
      }),
      prisma.orderDraft.findMany({
        where: {
          status: { in: ["manual_review", "draft", "confirmed", "processing"] },
          ...orderDraftIdentityWhere(filter),
        },
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
      prisma.wechatSendTask.findMany({
        where: {
          status: "blocked",
          ...sendTaskIdentityWhere(filter),
        },
        include: { conversation: true, designJob: true },
        orderBy: { updatedAt: "desc" },
        take: 300,
      }),
      prisma.reviewLog.findMany({ orderBy: { createdAt: "desc" }, take: hasIdentityFilter(filter) ? 300 : 80 }),
    ]);
    const designJobs = designJobCandidates.filter((job: any) => isDesignJobReviewVisible(job)).slice(0, 80);
    const quoteDrafts = quoteCandidates.filter((quote: any) => isQuoteReviewVisible(quote)).slice(0, 80);
    const orderDrafts = orderCandidates.filter((order: any) => isOrderReviewVisible(order)).slice(0, 80);
    const sendTasks = sendTaskCandidates.filter((task: any) => isSendTaskReviewVisible(task)).slice(0, 80);
    return {
      designJobs,
      quoteDrafts,
      orderDrafts,
      sendTasks,
      logs: filterReviewLogsByIdentity(logs, filter, { designJobs, quoteDrafts, orderDrafts, sendTasks }).slice(0, 80),
    };
  }

  async reviewDesignJob(id: string, payload: ReviewPayload) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertRequiredExpectedIdentity(payload, "design job");
    assertExpectedIdentity(job, payload, "design job");
    const beforeStatus = job.status;
    const decision = payload.decision || "approve_images";
    const designJobTarget = {
      designJobId: id,
      wechatAccountId: job.wechatAccountId,
      conversationId: job.conversationId,
      customerId: job.customerId,
    };
    let result: any;
    let notification: any = null;

    if (decision === "approve_send") {
      const sendTask = await this.designJobs.quickConfirmAndQueueSend(id, {
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
      },
    });
    return { result, log, notification };
  }

  async reviewQuote(id: string, payload: ReviewPayload) {
    const quote = appConfig.useLocalStore
      ? this.localStore.getQuoteDraft(id)
      : await this.prisma.quoteDraft.findUnique({ where: { id }, include: { designJob: true } });
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    assertRequiredExpectedIdentity(payload, "quote draft");
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
    let result: any;
    let notification: any = null;
    let customerNotes: string;
    if (decision === "reject_quote") {
      customerNotes = payload.note || "人工审核驳回报价";
      result = await this.quotes.update(id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        status: "rejected",
        owner: payload.reviewer || "人工客服",
        customerNotes,
      });
    } else if (decision === "request_followup") {
      customerNotes = payload.note || "需要继续跟进客户";
      result = await this.quotes.update(id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
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
        sendTaskId: result?.sendTask?.id,
      },
    });
    return { result, log, notification };
  }

  async reviewOrder(id: string, payload: ReviewPayload) {
    // Older local-store callers injected only the dispatch dependency, while the
    // stricter identity implementation also injects OrdersService. Resolve by
    // capability so both persisted records and legacy local-store records remain
    // reviewable during the migration.
    const dependencies = [this.wechat as any, this.orders as any].filter(Boolean);
    const orderService = dependencies.find((dependency) => typeof dependency?.getById === "function");
    if (
      !this.wechat ||
      (typeof (this.wechat as any).queueOrderConfirmation !== "function" &&
        typeof (this.wechat as any).queueOrderFollowup !== "function")
    ) {
      throw new Error("order review dependencies are not configured");
    }
    const order = orderService
      ? await orderService.getById(id)
      : appConfig.useLocalStore && typeof (this.localStore as any).getOrderDraft === "function"
        ? (this.localStore as any).getOrderDraft(id)
        : await (this.prisma as any).orderDraft.findUnique({ where: { id } });
    if (!order) throw new Error(`order draft not found: ${id}`);
    assertRequiredExpectedIdentity(payload, "order draft");
    assertExpectedIdentity(order, payload, "order draft");

    const beforeStatus = order.status;
    const decision = payload.decision || "request_followup";
    assertHighValueOrderHasCompleteIdentity(order, decision);
    assertHighValueOrderApprovalReady(order, decision);
    const reviewer = payload.reviewer || "人工客服";
    let result: any = { orderDraft: order };
    let notification: any = null;

    if (decision === "approve_confirmation") {
      result = await this.wechat.queueOrderConfirmation(id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: reviewer,
        note: payload.note || "高价值订单已人工审核，订单确认已进入微信安全发送队列。",
        releaseManualLock: true,
        releaseReason: "manual_approve_order_confirmation",
        automation: { source: "manual_order_review", valueLevel: "high" },
      });
      result.orderDraft = await this.updateReviewedOrder(id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: reviewer,
        customerNotes: appendCustomerNote(
          order.customerNotes,
          payload.note || "高价值订单已人工审核，订单确认已进入微信安全发送队列。",
        ),
      });
    } else if (decision === "approve_followup") {
      const followupType = payload.followupType || "delivery";
      result = await this.wechat.queueOrderFollowup(id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: reviewer,
        type: followupType,
        reason: "manual_approve_order_followup",
        releaseManualLock: true,
        releaseReason: "manual_approve_order_followup",
        automation: { source: "manual_order_review", valueLevel: "high", followupType },
      });
      result.orderDraft = await this.updateReviewedOrder(id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
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
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
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
        orderDraftId: id,
        quoteDraftId: order.quoteDraftId || order.quoteDraft?.id,
        designJobId: order.designJobId || order.designJob?.id || order.quoteDraft?.designJobId || order.quoteDraft?.designJob?.id,
        sendTaskId: result?.sendTask?.id,
        followupType: payload.followupType,
        wechatAccountId: order.wechatAccountId,
        conversationId: order.conversationId,
        customerId: order.customerId,
        source: "manual_order_review",
      },
    });
    return { result, log, notification: result?.notification || notification || null };
  }

  private async updateReviewedOrder(
    id: string,
    data: { owner?: string; customerNotes?: string; status?: string } & ExpectedIdentityPayload,
  ) {
    const orderService = [this.orders as any, this.wechat as any].find(
      (dependency) => typeof dependency?.update === "function",
    );
    if (orderService) return orderService.update(id, data);
    const {
      expectedWechatAccountId: _expectedWechatAccountId,
      expectedConversationId: _expectedConversationId,
      expectedCustomerId: _expectedCustomerId,
      ...updateData
    } = data;
    if (appConfig.useLocalStore) {
      return this.localStore.updateOrderDraft(id, updateData);
    }
    return (this.prisma as any).orderDraft.update({
      where: { id },
      data: updateData,
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
    return prisma.reviewLog.create({ data: payload });
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

function hasIdentityFilter(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  return Boolean(filter.wechatAccountId || filter.conversationId || filter.customerId);
}

function designJobIdentityWhere(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  return {
    ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
    ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
  };
}

function quoteDraftIdentityWhere(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  return {
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.wechatAccountId || filter.conversationId
      ? {
          designJob: {
            ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
            ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
          },
        }
      : {}),
  };
}

function orderDraftIdentityWhere(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  return {
    ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
    ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
  };
}

function sendTaskIdentityWhere(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  return {
    ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
    ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
  };
}

function filterReviewLogsByIdentity(
  logs: any[],
  filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {},
  visible: { designJobs: any[]; quoteDrafts: any[]; orderDrafts: any[]; sendTasks?: any[] },
) {
  if (!hasIdentityFilter(filter)) return logs;
  const designJobIds = new Set(visible.designJobs.map((item) => String(item.id || "")).filter(Boolean));
  const quoteDraftIds = new Set(visible.quoteDrafts.map((item) => String(item.id || "")).filter(Boolean));
  const orderDraftIds = new Set(visible.orderDrafts.map((item) => String(item.id || "")).filter(Boolean));
  const sendTaskIds = new Set((visible.sendTasks || []).map((item) => String(item.id || "")).filter(Boolean));
  return logs.filter((log) => {
    const metadata = log?.metadata && typeof log.metadata === "object" ? log.metadata : {};
    if (matchesMetadataIdentity(metadata, filter)) return true;
    if (log.targetType === "design_job" && designJobIds.has(String(log.targetId || ""))) return true;
    if ((log.targetType === "quote" || log.targetType === "quote_draft") && quoteDraftIds.has(String(log.targetId || ""))) return true;
    if (log.targetType === "order_draft" && orderDraftIds.has(String(log.targetId || ""))) return true;
    if (log.targetType === "send_task" && sendTaskIds.has(String(log.targetId || ""))) return true;
    if (metadata.designJobId && designJobIds.has(String(metadata.designJobId))) return true;
    if (metadata.quoteDraftId && quoteDraftIds.has(String(metadata.quoteDraftId))) return true;
    if (metadata.orderDraftId && orderDraftIds.has(String(metadata.orderDraftId))) return true;
    if (metadata.sendTaskId && sendTaskIds.has(String(metadata.sendTaskId))) return true;
    return false;
  });
}

function matchesMetadataIdentity(
  metadata: Record<string, unknown>,
  filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {},
) {
  if (filter.wechatAccountId && String(metadata.wechatAccountId || "") !== String(filter.wechatAccountId)) return false;
  if (filter.conversationId && String(metadata.conversationId || "") !== String(filter.conversationId)) return false;
  if (filter.customerId && String(metadata.customerId || "") !== String(filter.customerId)) return false;
  return Boolean(metadata.wechatAccountId || metadata.conversationId || metadata.customerId);
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
  return status === "manual_review" || isOrderHighValue(order) || orderNeedsManualSendAttention(order);
}

function isSendTaskReviewVisible(task: any) {
  if (task?.status !== "blocked") return false;
  const guardSnapshot = task.guardSnapshot || {};
  const automation = guardSnapshot.automation || {};
  if (automation.manualApproved === true) return false;
  return (
    guardSnapshot.blockedByHighValueReview === true ||
    guardSnapshot.reason === "manual_review_required" ||
    (automation.valueLevel === "high" && automation.queuedBy === "manual_review_flow")
  );
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
