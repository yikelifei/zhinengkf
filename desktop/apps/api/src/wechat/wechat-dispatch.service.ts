import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AiProviderService } from "../ai/ai-provider.service";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { buildWindowObserverChildEnvironment } from "../shared/runtime-child-environment";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  assertExactOperationReplay,
  createInboundMessageOperationFingerprint,
  createOperationFingerprint,
  deterministicOperationId,
  InboundLeaseLostError,
  inboundOperationStageAtLeast,
  isUniqueConstraintError,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
  sanitizeInboundOperationAttachments,
  sanitizeInboundOperationAssetIds,
  stableOperationKey,
} from "../shared/operation-idempotency";
import { rules } from "../shared/rules";
import { resolveWechatWorkImageFile } from "../wechat-work/wechat-work-media";
import {
  WechatBridgeOutboxError,
  WechatSendAdapterService,
  WechatWorkKfDeliveryError,
} from "./wechat-send-adapter.service";
import { WechatPersistence } from "./wechat-persistence";

const WECHAT_WORK_MSGID_BASE_LENGTH = 30;

function createWechatWorkMsgId(sendTaskId: string) {
  const digest = createHash("sha256").update(String(sendTaskId)).digest("hex");
  return `kf_${digest.slice(0, WECHAT_WORK_MSGID_BASE_LENGTH - 3)}`;
}

const {
  buildConversationManualLockTransition,
  buildAgentReplyDraft,
  buildDemoWechatWindowSnapshot,
  buildQuoteCustomerMessage,
  buildSendQueueSkipAdvice,
  buildInboundReplyText,
  buildOrderConfirmationCustomerMessage,
  buildOrderFollowupCustomerMessage,
  classifyTrainingSampleUsage,
  createWechatWindowObserverAttestation,
  diagnoseWechatWindowSnapshot,
  evaluateSendTaskRequeue,
  evaluateAgentRoute,
  evaluateLowValueQuoteSend,
  evaluateLowValueOrderConfirmationSend,
  evaluateLowValueOrderFollowupSend,
  findPendingSceneClarificationContext,
  isHighValueBudget,
  inspectBundleAutomationReadiness,
  latestCandidateRound,
  normalizeWechatWindowSnapshot,
  verifyWechatWindowObserverEvidence,
  planInboundAutomation,
  planInboundQuoteAcceptance,
  planCustomerImageSelection,
  recommendBundle,
  shouldDeferSelectionReviewToQuoteAcceptance,
  validateDesignAssetBinding,
  validateInboundConversationBinding,
  validateBridgeAckBinding,
  validateOrderDraftQuoteBinding,
  validateSendGuard,
  validateSendTaskBinding,
} = rules;

const BRIDGE_OUTBOX_VERSION = "wechat_bridge_outbox_v1";
const BRIDGE_ACK_VERSION = "wechat_bridge_ack_v1";
const INBOUND_OPERATION_LEASE_MS = 5 * 60 * 1000;

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type OrderQueueRequest = {
  operationKey?: string;
  type?: "production" | "delivery";
  owner?: string;
  note?: string;
  reason?: string;
  releaseManualLock?: boolean;
  releaseReason?: string;
} & ExpectedIdentityPayload;

type SendDeliveryResolution = "confirmed_sent" | "confirmed_not_sent";

type SendDeliveryResolutionPayload = {
  resolution: SendDeliveryResolution;
  operationKey: string;
  reason?: string;
} & ExpectedIdentityPayload;

type LowValueOrderAutomationProvenance = {
  source:
    | "order_confirmation"
    | "order_followup"
    | "low_value_quote_payment_update"
    | "low_value_quote_acceptance";
  reason?: string;
};

type WechatChannelKey = "personal_wechat" | "work_wechat" | "mini_program";

function isManualReplySendTask(task: any) {
  return Boolean(
    task?.payload?.source === "manual_reply" &&
      task?.payload?.manualReply === true &&
      task?.guardSnapshot?.manualReply === true,
  );
}

@Injectable()
export class WechatDispatchService {
  private readonly persistence: WechatPersistence;

  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly sendAdapter: WechatSendAdapterService,
    private readonly notifications: NotificationsService,
    private readonly orders: OrdersService,
    @Optional() private readonly aiProviders?: AiProviderService,
  ) {
    this.persistence = new WechatPersistence(prisma, localStore);
  }

  async enqueueDesignImages(params: {
    operationKey: string;
    wechatAccountId: string;
    conversationId: string;
    customerId?: string;
    designJobId: string;
    imagePaths: string[];
    textBeforeImages?: string;
    automation?: Prisma.InputJsonObject;
  }) {
    await this.assertConversationCanQueueSend(params.conversationId);
    const binding = await this.assertSendTaskBinding({
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      designJobId: params.designJobId,
    });
    const guardSnapshot: Prisma.InputJsonObject = {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      binding,
      ...(params.automation ? { automation: params.automation } : {}),
    };
    return this.persistence.createSendTask({
      operationKey: params.operationKey,
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      customerId: params.customerId || binding.customerId,
      designJobId: params.designJobId,
      payload: {
        kind: "design_images",
        textBeforeImages: params.textBeforeImages || "",
        imagePaths: params.imagePaths,
      },
      guardSnapshot,
    });
  }

  async enqueueQuoteMessage(params: {
    operationKey: string;
    wechatAccountId: string;
    conversationId: string;
    customerId?: string;
    quoteDraftId: string;
    designJobId?: string;
    text: string;
    automation?: Prisma.InputJsonObject;
  }) {
    await this.assertConversationCanQueueSend(params.conversationId);
    const binding = await this.assertSendTaskBinding({
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      designJobId: params.designJobId,
      quoteDraftId: params.quoteDraftId,
    });
    const payload = {
      kind: "quote",
      quoteDraftId: params.quoteDraftId,
      text: params.text,
    };
    const guardSnapshot: Prisma.InputJsonObject = {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      reason: "quote-customer-message",
      binding,
      ...(params.automation ? { automation: params.automation } : {}),
    };

    return this.persistence.createSendTask({
      operationKey: params.operationKey,
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      customerId: params.customerId || binding.customerId,
      designJobId: binding.designJobId || params.designJobId,
      quoteDraftId: params.quoteDraftId,
      payload,
      guardSnapshot,
    });
  }

  async enqueueTextMessage(params: {
    operationKey: string;
    wechatAccountId: string;
    conversationId: string;
    customerId?: string;
    designJobId?: string;
    quoteDraftId?: string;
    text: string;
    reason?: string;
    orderContext?: Prisma.InputJsonObject;
    automation?: Prisma.InputJsonObject;
    manualReply?: boolean;
    queuedBy?: string;
  }) {
    await this.assertConversationCanQueueSend(params.conversationId, { allowManualReply: params.manualReply === true });
    const binding = await this.assertSendTaskBinding({
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      customerId: params.customerId,
      designJobId: params.designJobId,
      quoteDraftId: params.quoteDraftId,
      manualReply: params.manualReply,
    });
    const guardSnapshot: Prisma.InputJsonObject = {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      binding,
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.orderContext ? { orderContext: params.orderContext } : {}),
      ...(params.automation ? { automation: params.automation } : {}),
      ...(params.manualReply ? { manualReply: true, queuedBy: params.queuedBy || "manual_operator" } : {}),
    };
    const payload = {
      kind: "text",
      text: params.text,
      ...(params.manualReply
        ? {
            source: "manual_reply",
            manualReply: true,
            queuedBy: params.queuedBy || "manual_operator",
            wechatAccountId: params.wechatAccountId,
            conversationId: params.conversationId,
            customerId: params.customerId || binding.customerId,
          }
        : {}),
    };

    return this.persistence.createSendTask({
      operationKey: params.operationKey,
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      customerId: params.customerId || binding.customerId,
      designJobId: binding.designJobId || params.designJobId,
      quoteDraftId: params.quoteDraftId,
      payload,
      guardSnapshot,
    });
  }

  async queueOrderConfirmation(
    orderDraftId: string,
    payload: OrderQueueRequest = {},
  ) {
    return this.queueOrderConfirmationWithProvenance(orderDraftId, manualOrderQueueRequest(payload), null);
  }

  private queueLowValueOrderConfirmation(
    orderDraftId: string,
    payload: OrderQueueRequest,
    provenance: LowValueOrderAutomationProvenance,
  ) {
    return this.queueOrderConfirmationWithProvenance(
      orderDraftId,
      manualOrderQueueRequest(payload),
      provenance,
    );
  }

  private async queueOrderConfirmationWithProvenance(
    orderDraftId: string,
    payload: OrderQueueRequest,
    provenance: LowValueOrderAutomationProvenance | null,
  ) {
    const order = await this.orders.getById(orderDraftId);
    if (!order) throw new BadRequestException(`order draft not found: ${orderDraftId}`);
    assertExpectedIdentity(order, payload, "order draft");
    if (order.status === "cancelled") {
      throw new BadRequestException("cancelled order draft cannot queue confirmation");
    }
    this.assertOrderConversationUnlocked(order, "order confirmation");
    this.assertOrderPaymentReadyForSend(order, "order confirmation");
    this.assertOrderHasCompleteSendIdentity(order);
    this.assertOrderHasSelectedImageForSend(order, "order confirmation");
    this.assertOrderProfitReadyForSend(order, "order confirmation");

    const designJob = order.designJob || order.quoteDraft?.designJob || null;
    const binding = validateOrderDraftQuoteBinding({
      orderDraft: order,
      quoteDraft: order.quoteDraft,
      designJob,
      conversation: order.conversation || designJob?.conversation,
      selectedImage: this.orderSelectedImage(order),
    });
    if (!binding.ok) {
      throw new BadRequestException(`order confirmation binding invalid: ${binding.reason}`);
    }
    this.assertHighValueOrderHasManualRelease(order, payload, "high value order confirmation");

    const bundleSnapshot = order.bundleSnapshot || {};
    const items = Array.isArray(designJob?.bundle?.items)
      ? designJob.bundle.items
      : Array.isArray((bundleSnapshot as any).items)
        ? (bundleSnapshot as any).items
        : [];
    const paymentStatus = this.orderPaymentStatus(order);
    const operationKey = provenance
      ? stableOperationKey("order-confirm", `${order.id}:order-confirmation`)
      : normalizeOperationKey(payload.operationKey, "operationKey");
    const trustedAutomation = provenance
      ? this.buildLowValueOrderAutomation(order, paymentStatus, provenance)
      : undefined;
    const orderContext = this.buildOrderSendContext(order, paymentStatus, "order_confirmation");
    const message = buildOrderConfirmationCustomerMessage({
      customerName: order.customer?.name || order.quoteDraft?.customer?.name,
      scene: designJob?.scene,
      quantity: order.quantity,
      totalPrice: order.totalPrice,
      paymentStatus,
      items,
      hasSelectedImage: Boolean(this.orderSelectedImage(order)),
      selectedImagePosition: this.orderSelectedImage(order)?.position,
    });
    const sendTask = await this.enqueueTextMessage({
      operationKey,
      wechatAccountId: order.wechatAccountId,
      conversationId: order.conversationId,
      customerId: order.customerId,
      designJobId: order.designJobId,
      quoteDraftId: order.quoteDraftId,
      text: message,
      reason: payload.reason || "order-confirmation",
      orderContext,
      automation: trustedAutomation,
    });
    const updatedOrder = await this.orders.updateFromAutomation(order.id, {
      expectedWechatAccountId: payload.expectedWechatAccountId,
      expectedConversationId: payload.expectedConversationId,
      expectedCustomerId: payload.expectedCustomerId,
      owner: payload.owner || order.owner || "人工客服",
      customerNotes: payload.note || order.customerNotes || "订单确认已进入微信安全发送队列。",
    }, {
      notificationEffectKey: `${operationKey}:order-update-notification`,
    });
    const notification = await this.notifications.create(
      "info",
      "订单确认已入队",
      "系统已根据订单草稿生成客户确认话术，并放入微信安全发送队列。",
      {
        effectKey: `${operationKey}:notification`,
        orderDraftId: order.id,
        quoteDraftId: order.quoteDraftId,
        designJobId: order.designJobId,
        sendTaskId: sendTask.id,
        wechatAccountId: order.wechatAccountId,
        conversationId: order.conversationId,
        customerId: order.customerId,
      },
    );

    return { orderDraft: updatedOrder, sendTask, message, notification };
  }

  async queueOrderFollowup(
    orderDraftId: string,
    payload: OrderQueueRequest = {},
  ) {
    return this.queueOrderFollowupWithProvenance(orderDraftId, manualOrderQueueRequest(payload), null);
  }

  private queueLowValueOrderFollowup(
    orderDraftId: string,
    payload: OrderQueueRequest,
    provenance: LowValueOrderAutomationProvenance,
  ) {
    return this.queueOrderFollowupWithProvenance(
      orderDraftId,
      manualOrderQueueRequest(payload),
      provenance,
    );
  }

  private async queueOrderFollowupWithProvenance(
    orderDraftId: string,
    payload: OrderQueueRequest,
    provenance: LowValueOrderAutomationProvenance | null,
  ) {
    const order = await this.orders.getById(orderDraftId);
    if (!order) throw new BadRequestException(`order draft not found: ${orderDraftId}`);
    assertExpectedIdentity(order, payload, "order draft");
    if (order.status === "cancelled") {
      throw new BadRequestException("cancelled order draft cannot queue follow-up");
    }
    this.assertOrderConversationUnlocked(order, "order follow-up");
    this.assertOrderPaymentReadyForSend(order, "order follow-up");
    this.assertOrderHasCompleteSendIdentity(order);
    this.assertOrderHasSelectedImageForSend(order, "order follow-up");
    this.assertOrderProfitReadyForSend(order, "order follow-up");

    const designJob = order.designJob || order.quoteDraft?.designJob || null;
    const binding = validateOrderDraftQuoteBinding({
      orderDraft: order,
      quoteDraft: order.quoteDraft,
      designJob,
      conversation: order.conversation || designJob?.conversation,
      selectedImage: this.orderSelectedImage(order),
    });
    if (!binding.ok) {
      throw new BadRequestException(`order follow-up binding invalid: ${binding.reason}`);
    }
    this.assertHighValueOrderHasManualRelease(order, payload, "high value order follow-up");

    const context = this.buildOrderMessageContext(order);
    const followupType = payload.type || (order.status === "fulfilled" ? "delivery" : "production");
    const operationKey = provenance
      ? stableOperationKey("order-followup", `${order.id}:${followupType}`)
      : normalizeOperationKey(payload.operationKey, "operationKey");
    const paymentStatus = this.orderPaymentStatus(order);
    const trustedAutomation = provenance
      ? this.buildLowValueOrderAutomation(order, paymentStatus, provenance, followupType)
      : undefined;
    const orderContext = this.buildOrderSendContext(order, paymentStatus, "order_followup", followupType);
    const message = buildOrderFollowupCustomerMessage({
      type: followupType,
      customerName: context.customerName,
      scene: context.scene,
      quantity: order.quantity,
      totalPrice: order.totalPrice,
      paymentStatus,
      leadTimeDays: this.maxLeadTimeDays(context.items),
      items: context.items,
    });
    const sendTask = await this.enqueueTextMessage({
      operationKey,
      wechatAccountId: order.wechatAccountId,
      conversationId: order.conversationId,
      customerId: order.customerId,
      designJobId: order.designJobId,
      quoteDraftId: order.quoteDraftId,
      text: message,
      reason: payload.reason || "order-followup",
      orderContext,
      automation: trustedAutomation,
    });
    const notification = await this.notifications.create(
      "info",
      followupType === "delivery" ? "订单交期说明已入队" : "订单生产通知已入队",
      "系统已根据订单草稿生成客户跟进话术，并放入微信安全发送队列。",
      {
        effectKey: `${operationKey}:notification`,
        orderDraftId: order.id,
        quoteDraftId: order.quoteDraftId,
        designJobId: order.designJobId,
        sendTaskId: sendTask.id,
        followupType,
        wechatAccountId: order.wechatAccountId,
        conversationId: order.conversationId,
        customerId: order.customerId,
      },
    );

    return { orderDraft: await this.orders.getById(order.id), sendTask, message, notification };
  }

  private buildLowValueOrderAutomation(
    order: any,
    paymentStatus: string,
    provenance: LowValueOrderAutomationProvenance,
    followupType?: "production" | "delivery",
  ): Prisma.InputJsonObject {
    return {
      source: provenance.source,
      valueLevel: "low",
      orderDraftId: String(order.id),
      quoteDraftId: String(order.quoteDraftId || ""),
      paymentStatus,
      queuedBy: "low_value_automation",
      ...(followupType ? { followupType } : {}),
      ...(provenance.reason ? { reason: provenance.reason } : {}),
    };
  }

  private buildOrderSendContext(
    order: any,
    paymentStatus: string,
    source: "order_confirmation" | "order_followup",
    followupType?: "production" | "delivery",
  ): Prisma.InputJsonObject {
    return {
      source,
      orderDraftId: String(order.id),
      quoteDraftId: String(order.quoteDraftId || ""),
      paymentStatus,
      ...(followupType ? { followupType } : {}),
    };
  }

  private buildOrderMessageContext(order: any) {
    const designJob = order.designJob || order.quoteDraft?.designJob || {};
    const bundleSnapshot = order.bundleSnapshot || {};
    const items = Array.isArray(designJob?.bundle?.items)
      ? designJob.bundle.items
      : Array.isArray((bundleSnapshot as any).items)
        ? (bundleSnapshot as any).items
        : [];
    return {
      customerName: order.customer?.name || order.quoteDraft?.customer?.name,
      scene: designJob?.scene,
      items,
    };
  }

  private maxLeadTimeDays(items: any[]) {
    return items.reduce((max, item) => {
      const value = Number(item?.leadTimeDays || item?.leadTime || item?.deliveryDays || 0);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
  }

  private orderSelectedImage(order: any) {
    return order?.selectedImage || order?.quoteDraft?.selectedImage || order?.selectedImageSnapshot || null;
  }

  private orderPaymentStatus(order: any) {
    return String(order?.paymentStatus || order?.quoteDraft?.paymentStatus || "unpaid");
  }

  private assertOrderHasCompleteSendIdentity(order: any) {
    const wechatAccountId = String(order?.wechatAccountId || "").trim();
    const customerId = String(order?.customerId || "").trim();
    const conversationId = String(order?.conversationId || "").trim();
    if (wechatAccountId && customerId && conversationId) return;
    throw new BadRequestException("订单缺少微信账号、客户或会话绑定，不能进入微信发送队列。");
  }

  private assertOrderHasSelectedImageForSend(order: any, context: string) {
    if (this.orderSelectedImage(order)) return;
    throw new BadRequestException(`${orderSendContextLabel(context)}需要先绑定客户选中的效果图，不能进入微信发送队列。`);
  }

  private assertOrderPaymentReadyForSend(order: any, context: string) {
    const paymentStatus = this.orderPaymentStatus(order);
    if (paymentStatus === "deposit_paid" || paymentStatus === "paid") return;
    throw new BadRequestException(`${orderSendContextLabel(context)}需要先核验定金或全款，不能进入微信发送队列。`);
  }

  private assertOrderProfitReadyForSend(order: any, context: string) {
    if (Number(order?.profit || 0) >= 0) return;
    throw new BadRequestException(`${orderSendContextLabel(context)}发现订单利润为负，必须人工确认报价和成本后再发送。`);
  }

  private assertOrderConversationUnlocked(order: any, context: string) {
    const conversationId = String(order?.conversationId || order?.conversation?.id || order?.designJob?.conversationId || "");
    const currentConversation =
      appConfig.useLocalStore && conversationId
        ? this.localStore.listConversations().find((conversation: any) => String(conversation.id || "") === conversationId)
        : null;
    const manualLocked = Boolean(
      currentConversation?.manualLocked ||
        order?.conversation?.manualLocked ||
        order?.designJob?.conversation?.manualLocked ||
        order?.quoteDraft?.designJob?.conversation?.manualLocked,
    );
    if (!manualLocked) return;
    throw new BadRequestException(`${context} blocked: 会话已人工接管，自动发送暂停。请先解除人工接管后再排队订单发送。`);
  }

  private assertOrderSendTaskStillQueueable(task: any) {
    const orderContext = this.orderSendContext(task);
    const source = String(orderContext.source || "");
    const orderDraftId = String(orderContext.orderDraftId || "");
    if (!orderDraftId) return;

    const order = this.localStore.getOrderDraft(orderDraftId);
    if (!order) {
      throw new BadRequestException(`order draft not found for send task requeue: ${orderDraftId}`);
    }

    const context =
      source === "order_followup" || orderContext.followupType
        ? "order follow-up requeue"
        : "order confirmation requeue";
    assertExpectedIdentity(
      order,
      {
        expectedWechatAccountId: task.wechatAccountId,
        expectedConversationId: task.conversationId,
        expectedCustomerId: task.conversation?.customerId || task.customerId || order.customerId,
      },
      "order draft",
    );
    this.assertOrderConversationUnlocked(order, context);
    this.assertOrderPaymentReadyForSend(order, context);
    this.assertOrderHasCompleteSendIdentity(order);
    this.assertOrderHasSelectedImageForSend(order, context);
    this.assertOrderProfitReadyForSend(order, context);

    const designJob = order.designJob || order.quoteDraft?.designJob || null;
    const binding = validateOrderDraftQuoteBinding({
      orderDraft: order,
      quoteDraft: order.quoteDraft,
      designJob,
      conversation: order.conversation || designJob?.conversation,
      selectedImage: this.orderSelectedImage(order),
    });
    if (!binding.ok) {
      throw new BadRequestException(`order send task requeue binding invalid: ${binding.reason}`);
    }
  }

  private validateQueuedRoutingPolicySendState(task: any):
    | { ok: true; routingPolicy?: Record<string, unknown> | null }
    | { ok: false; reason: string; message: string; routingPolicy: Record<string, unknown>; lane: string } {
    const routingPolicy = isPlainObject(task?.payload?.routingPolicy) ? task.payload.routingPolicy : null;
    if (!routingPolicy) return { ok: true };

    const manualRequired = routingPolicy.manualRequired === true;
    const canQueueAutoReply = routingPolicy.canQueueAutoReply !== false;
    const canQueueClarificationReply =
      task?.payload?.automationPlan === "queue_reply" && routingPolicy.canAskClarification === true;
    if (!manualRequired && (canQueueAutoReply || canQueueClarificationReply)) return { ok: true, routingPolicy };

    const reason = manualRequired ? "routingPolicyManualRequired" : "routingPolicyQueueDisabled";
    return {
      ok: false,
      reason,
      message: manualRequired
        ? "routing policy requires manual review before sending"
        : "routing policy does not allow queued auto reply",
      routingPolicy,
      lane: String(routingPolicy.lane || ""),
    };
  }

  private expectedIdentityFromOrder(order: any): ExpectedIdentityPayload {
    return {
      expectedWechatAccountId: order?.wechatAccountId,
      expectedConversationId: order?.conversationId,
      expectedCustomerId: order?.customerId,
    };
  }

  private assertHighValueOrderHasManualRelease(
    order: any,
    payload: { releaseManualLock?: boolean; releaseReason?: string },
    context: string,
  ) {
    if (!this.isHighValueOrder(order)) return;
    if (!payload.releaseManualLock) {
      throw new BadRequestException("高价值订单必须先由人工审核，不能走自动或普通发送队列。");
    }
    assertManualReleaseReason(payload.releaseReason, context);
  }

  private isHighValueOrder(order: any) {
    const threshold = Number(appConfig.highValueAmountCny || 10000);
    const quote = order?.quoteDraft || {};
    const designJob = order?.designJob || quote?.designJob || {};
    if (Boolean(order?.isHighValue) || Boolean(quote?.isHighValue) || Boolean(designJob?.isHighValue)) return true;
    if (isHighValueBudget(designJob?.budget, threshold)) return true;
    return isHighValueAmount(order?.totalPrice ?? quote?.totalPrice, order?.unitPrice ?? quote?.unitPrice, threshold);
  }

  private async listOrderFollowupTypes(order: any) {
    const tasks = await this.listOrderRelatedSendTasks(order);
    return [
      ...new Set(
        tasks
          .filter((task: any) => this.isOrderFollowupTask(task, order))
          .filter((task: any) => this.sendTaskCountsAsHandledForAutomation(task))
          .map((task: any) => this.orderSendContext(task).followupType || "any")
          .filter(Boolean)
          .map(String),
      ),
    ];
  }

  private async listOrderAttentionFollowupTypes(order: any) {
    const tasks = await this.listOrderRelatedSendTasks(order);
    return [
      ...new Set(
        tasks
          .filter((task: any) => this.isOrderFollowupTask(task, order))
          .filter((task: any) => this.sendTaskNeedsManualAttentionForAutomation(task))
          .map((task: any) => this.orderSendContext(task).followupType || "any")
          .filter(Boolean)
          .map(String),
      ),
    ];
  }

  private sendTaskNeedsManualAttentionForAutomation(task: any) {
    return ["failed", "blocked", "cancelled", "dry_run"].includes(String(task?.status || ""));
  }

  private sendTaskCountsAsHandledForAutomation(task: any) {
    if (!task) return false;
    if (!task.status) return Boolean(task.id);
    return ["queued", "sending", "sent"].includes(String(task.status));
  }

  private async listOrderRelatedSendTasks(order: any) {
    if (!order?.id && !order?.quoteDraftId) return [];
    if (appConfig.useLocalStore) {
      return this.localStore
        .listSendTasks()
        .filter((task: any) => this.isOrderRelatedSendTask(task, order));
    }
    if (!order.quoteDraftId) return [];
    return (this.prisma as any).wechatSendTask.findMany({
      where: { quoteDraftId: order.quoteDraftId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  private isOrderRelatedSendTask(task: any, order: any) {
    const orderContext = this.orderSendContext(task);
    if (order.id && orderContext.orderDraftId === order.id) return true;
    return Boolean(order.quoteDraftId && task?.quoteDraftId === order.quoteDraftId);
  }

  private isOrderFollowupTask(task: any, order: any) {
    if (!this.isOrderRelatedSendTask(task, order)) return false;
    const orderContext = this.orderSendContext(task);
    return orderContext.source === "order_followup" || task?.guardSnapshot?.reason === "order-followup";
  }

  async scanLowValueOrderConfirmations(params: { orderDrafts?: any[] } & IdentityFilter = {}) {
    const orders = Array.isArray(params.orderDrafts) ? params.orderDrafts : await this.orders.list(params);
    const result = {
      scanned: orders.length,
      queued: [] as any[],
      skipped: [] as Array<{ orderDraftId: string; quoteDraftId?: string; reason: string; missing?: string[] }>,
      failed: [] as Array<{ orderDraftId: string; quoteDraftId?: string; errorMessage: string }>,
    };

    for (const order of orders as any[]) {
      const decision = evaluateLowValueOrderConfirmationSend(order, {
        highValueAmountCny: appConfig.highValueAmountCny,
      });
      if (!decision.ok) {
        result.skipped.push({
          orderDraftId: order.id,
          quoteDraftId: order.quoteDraftId,
          reason: decision.reason,
          missing: decision.missing || [],
        });
        continue;
      }

      try {
        result.queued.push(
          await this.queueLowValueOrderConfirmation(order.id, {
            ...this.expectedIdentityFromOrder(order),
            owner: "low_value_automation",
            note: "低价值订单确认已自动进入微信安全发送队列。",
            reason: "low_value_order_confirmation",
          }, { source: "order_confirmation" }),
        );
      } catch (error) {
        result.failed.push({
          orderDraftId: order.id,
          quoteDraftId: order.quoteDraftId,
          errorMessage: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return result;
  }

  async scanLowValueOrderFollowups(params: { orderDrafts?: any[] } & IdentityFilter = {}) {
    const orders = Array.isArray(params.orderDrafts) ? params.orderDrafts : await this.orders.list(params);
    const result = {
      scanned: orders.length,
      queued: [] as any[],
      skipped: [] as Array<{
        orderDraftId: string;
        quoteDraftId?: string;
        reason: string;
        followupType?: string;
        missing?: string[];
      }>,
      failed: [] as Array<{
        orderDraftId: string;
        quoteDraftId?: string;
        followupType?: string;
        errorMessage: string;
      }>,
    };

    for (const order of orders as any[]) {
      const existingFollowupTypes = await this.listOrderFollowupTypes(order);
      const attentionFollowupTypes = await this.listOrderAttentionFollowupTypes(order);
      const decision = evaluateLowValueOrderFollowupSend(order, {
        highValueAmountCny: appConfig.highValueAmountCny,
        existingFollowupTypes,
        attentionFollowupTypes,
      });
      if (!decision.ok) {
        result.skipped.push({
          orderDraftId: order.id,
          quoteDraftId: order.quoteDraftId,
          reason: decision.reason,
          followupType: decision.followupType,
          missing: decision.missing || [],
        });
        continue;
      }

      try {
        result.queued.push(
          await this.queueLowValueOrderFollowup(order.id, {
            ...this.expectedIdentityFromOrder(order),
            type: decision.followupType,
            owner: "low_value_automation",
            reason: "low_value_order_followup",
          }, { source: "order_followup" }),
        );
      } catch (error) {
        result.failed.push({
          orderDraftId: order.id,
          quoteDraftId: order.quoteDraftId,
          followupType: decision.followupType,
          errorMessage: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return result;
  }

  listAccounts() {
    return appConfig.useLocalStore ? this.localStore.listWechatAccounts() : this.persistence.listAccounts();
  }

  listConversations(wechatAccountId?: string) {
    return appConfig.useLocalStore
      ? this.localStore.listConversations(wechatAccountId)
      : this.persistence.listConversations(wechatAccountId);
  }

  async listConversationTimeline(filter: IdentityFilter & { limit?: number }) {
    const conversation = await this.requireCompleteConversationIdentity(filter, "message history");
    try {
      return this.persistence.listConversationTimeline({
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        limit: filter.limit,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "message history identity invalid");
    }
  }

  async markConversationMessagesRead(filter: IdentityFilter) {
    const conversation = await this.requireCompleteConversationIdentity(filter, "mark messages read");
    try {
      return this.persistence.markConversationMessagesRead({
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "mark messages read identity invalid");
    }
  }

  async enqueueManualReply(payload: IdentityFilter & { text?: string; operator?: string; operationKey?: string }) {
    const conversation = await this.requireCompleteConversationIdentity(payload, "manual reply");
    const text = String(payload.text || "").trim();
    if (!text) throw new BadRequestException("manual reply text is required");
    if (text.length > 2000) throw new BadRequestException("manual reply text exceeds 2000 characters");
    const task = await this.enqueueTextMessage({
      operationKey: normalizeOperationKey(payload.operationKey, "operationKey"),
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      text,
      reason: "manual-agent-reply",
      manualReply: true,
      queuedBy: String(payload.operator || "人工客服").trim() || "人工客服",
    });
    return { queued: true, task };
  }

  async setConversationManualLock(
    id: string,
    payload: { locked?: boolean; reviewer?: string; reason?: string; note?: string; effectKey?: string } & ExpectedIdentityPayload = {},
  ) {
    const before = await this.persistence.getConversation(id);
    if (!before) throw new BadRequestException(`conversation not found: ${id}`);
    assertExpectedIdentity({ ...before, conversationId: before.id }, payload, "conversation");
    if (payload.locked === true) {
      this.assertManualLockTransitionHasExpectedIdentity(payload, "人工接管");
    }
    if (payload.locked === false && before.manualLocked) {
      this.assertManualLockTransitionHasExpectedIdentity(payload, "解除人工接管");
      assertManualReleaseReason(payload.reason, "conversation manual release");
      assertManualReleaseNote(payload.note, "conversation manual release");
    }

    const transition = buildConversationManualLockTransition({
      locked: payload.locked,
      wasLocked: before.manualLocked,
      reason: payload.reason,
      source: "conversation_manual_lock",
    });
    const updated = await this.persistence.updateConversation(id, { manualLocked: transition.locked });
    const blockedSendTasks = transition.locked
      ? await this.blockQueuedSendTasksForManualLock(before, payload.reviewer || "人工客服")
      : [];
    const inFlightSendTasks = transition.locked
      ? await this.protectInFlightSendTasksForManualLock(id, payload.reviewer || "人工客服")
      : [];
    const note =
      payload.note ||
      (transition.locked ? "人工已接管该会话，自动回复暂停。" : "人工处理已完成，该会话可恢复自动化判断。");
    const lockNoticeParts = [note];
    if (blockedSendTasks.length) lockNoticeParts.push(`已暂停 ${blockedSendTasks.length} 个待发送任务。`);
    if (inFlightSendTasks.length) {
      lockNoticeParts.push(`已将 ${inFlightSendTasks.length} 个发送中任务保护为结果未知，需人工核查。`);
    }
    const log = await this.createReviewLog({
      targetType: "conversation",
      targetId: id,
      decision: transition.decision,
      reviewer: payload.reviewer || "人工客服",
      note,
      beforeStatus: transition.beforeStatus,
      afterStatus: transition.afterStatus,
      metadata: {
        ...(payload.effectKey ? { effectKey: `${payload.effectKey}:review` } : {}),
        ...transition.metadata,
        wechatAccountId: before.wechatAccountId || null,
        conversationId: id,
        wechatAccountName: before.wechatAccount?.displayName || before.wechatAccount?.alias || null,
        customerId: before.customerId || null,
        customerName: before.customer?.name || null,
        conversationTitle: before.title || null,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        protectedUnknownInFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        cancelledInFlightSendTaskIds: [],
      },
    });
    await this.notifications.create(
      transition.locked ? "warning" : "info",
      transition.locked ? "会话已锁定人工处理" : "会话已解除人工锁定",
      transition.locked ? lockNoticeParts.join(" ") : note,
      {
        ...(payload.effectKey ? { effectKey: `${payload.effectKey}:notification` } : {}),
        conversationId: id,
        customerId: before.customerId,
        wechatAccountId: before.wechatAccountId,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        protectedUnknownInFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        cancelledInFlightSendTaskIds: [],
      },
    );
    if (inFlightSendTasks.length) {
      await this.notifications.create(
        "warning",
        "发送中任务已进入结果未知保护",
        `${before.title || id} 有 ${inFlightSendTasks.length} 个发送中任务已请求停止，但不能确认是否已经发出；请人工核查后明确结论。`,
        {
          ...(payload.effectKey ? { effectKey: `${payload.effectKey}:inflight-notification` } : {}),
          conversationId: id,
          customerId: before.customerId,
          wechatAccountId: before.wechatAccountId,
          sendTaskIds: inFlightSendTasks.map((task: any) => task.id),
          protectedUnknownInFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
          cancelledInFlightSendTaskIds: [],
        },
      );
    }
    return { conversation: updated, log, blockedSendTasks, inFlightSendTasks };
  }

  private assertManualLockTransitionHasExpectedIdentity(payload: ExpectedIdentityPayload, action: string) {
    const missing = [
      !payload.expectedWechatAccountId ? "expectedWechatAccountId" : "",
      !payload.expectedConversationId ? "expectedConversationId" : "",
      !payload.expectedCustomerId ? "expectedCustomerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`${action}必须带完整会话身份：${missing.join(", ")}`);
    }
  }

  async processInboundMessage(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    text: string;
    externalId: string;
    assetIds?: string[];
    attachments?: Array<Record<string, unknown>>;
    createdAt?: string;
    inboundOperationId?: string;
    inboundClaimToken?: string;
    inboundRequestFingerprint?: string;
  }) {
    const externalId = String(payload.externalId || "").trim();
    if (!externalId) throw new BadRequestException("externalId is required");
    const safeAssetIds = sanitizeInboundOperationAssetIds(payload.assetIds, { rejectInvalid: true });
    if (!appConfig.useLocalStore) return this.processPrismaInboundMessage(payload);
    const conversation = this.resolveInboundConversation(payload);
    const claimToken = payload.inboundClaimToken || randomUUID();
    const requestFingerprint = payload.inboundRequestFingerprint || createInboundMessageOperationFingerprint(payload as any, {
      conversationId: conversation.id,
      customerId: conversation.customerId,
      wechatAccountId: conversation.wechatAccountId,
    });
    const claim = await this.persistence.claimInboundOperation({
      operationId: payload.inboundOperationId,
      claimToken,
      source: payload.inboundOperationId ? "personal_wechat_rpa" : "wechat",
      wechatAccountId: conversation.wechatAccountId,
      externalId,
      requestFingerprint,
      normalizedPayload: this.safeInboundOperationPayload(payload),
      leaseExpiresAt: this.nextInboundLeaseExpiry(),
    });
    if (claim.completed) return this.hydrateCompletedInboundReplay(claim.operation);
    if (!claim.claimed) return this.inProgressInboundReplay(claim.operation);
    const inboundOperation = claim.operation;
    if (inboundOperationStageAtLeast(inboundOperation.stage, "effects_committed")) {
      return this.resumeLocalCommittedInbound(inboundOperation, claimToken);
    }
    try {
    const assetIds = normalizeAssetIds([...safeAssetIds, ...(payload.attachments || [])]);
    const messagePayload = {
      conversationId: conversation.id,
      customerId: payload.customerId || conversation.customerId,
      wechatAccountId: payload.wechatAccountId || conversation.wechatAccountId,
      direction: "inbound",
      text: payload.text || "",
      externalId,
      attachments: payload.attachments || [],
      createdAt: payload.createdAt,
      assetIds,
      metadata: { assetIds },
    };
    this.validateInboundAssetBinding(conversation, assetIds);
    const message = this.localStore.createMessage(messagePayload);
    await this.persistence.advanceInboundOperation(inboundOperation.id, claimToken, {
      stage: "message_persisted",
      messageId: message.id,
      customerId: conversation.customerId,
      conversationId: conversation.id,
    });
    const clarificationContext = this.findLatestSceneClarification(conversation.id);
    const sceneMemory = this.listSceneMemorySamples({
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
    });
    const routeBase = evaluateAgentRoute(
      {
        text: payload.text || "",
        channel: conversation.channel || "wechat",
        wechatAccountId: conversation.wechatAccountId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        clarificationContext,
      },
      { highValueAmountCny: appConfig.highValueAmountCny, sceneMemory },
    );
    const agent = this.localStore.getAgentByKey(routeBase.agentKey);
    const skills = agent?.id
      ? this.localStore.listAgentSkills(agent.id, {
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
        })
      : [];
    const knowledgeEntries = agent?.id
      ? this.localStore.listKnowledgeEntries({
          agentId: agent.id,
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
        })
      : [];
    const draft = buildAgentReplyDraft(routeBase, {
      agentId: agent?.id,
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      skills,
      knowledgeEntries,
    });
    const aiAssistance = await this.buildAiAssistedInboundDraft({
      conversation,
      route: routeBase,
      draft,
      customerText: payload.text || "",
    });
    const route = this.localStore.createRouteEvaluation(
      {
        operationKey: inboundOperation.id,
        channel: conversation.channel || "wechat",
        text: payload.text || "",
        customerId: conversation.customerId,
        conversationId: conversation.id,
      },
      {
        ...routeBase,
        suggestedReply: aiAssistance?.text || draft.suggestedReply,
        appliedSkills: draft.appliedSkills,
        knowledgeMatches: draft.knowledgeMatches,
        replyDraft: {
          ...draft.replyDraft,
          source: aiAssistance?.used ? "ai_assisted" : draft.replyDraft?.source,
          ruleSuggestedReply: draft.suggestedReply,
          aiAssistance,
        },
      },
    );
    await this.persistence.advanceInboundOperation(inboundOperation.id, claimToken, {
      stage: "routed",
      routeEvaluationId: route.id,
    });
    if (conversation.manualLocked) {
      const plan = planInboundAutomation({
        route: { ...route, conversationManualLocked: true },
        conversationManualLocked: true,
      });
      const result: any = {
        message,
        route,
        plan,
        sendTask: null,
        designJob: null,
        notification: null,
        bundleRecommendation: null,
      };
      result.notification = await this.withInboundEffectLease(inboundOperation.id, claimToken, () => this.notifications.create(
        "warning",
        "人工接管会话收到新消息",
        `${conversation.title}：客户有新消息，请人工继续处理。`,
        {
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          routeId: route.id,
          reason: plan.reason,
          effectKey: `${inboundOperation.id}:manual-lock-notification`,
        },
      ));
      return await this.completeInboundProcessing(inboundOperation.id, claimToken, result);
    }

    const imageSelectionResult = await this.withInboundEffectLease(inboundOperation.id, claimToken, () =>
      this.handleInboundImageSelection({
        operationId: inboundOperation.id,
        claimToken,
        operationResult: inboundOperation.result,
        conversation,
        message,
        route,
        payload,
      }));
    if (imageSelectionResult) return await this.completeInboundProcessing(inboundOperation.id, claimToken, imageSelectionResult);

    const quoteAcceptanceResult = await this.withInboundEffectLease(inboundOperation.id, claimToken, () =>
      this.handleInboundQuoteAcceptance({
        operationId: inboundOperation.id,
        claimToken,
        operationResult: inboundOperation.result,
        conversation,
        message,
        route,
        payload,
      }));
    if (quoteAcceptanceResult) return await this.completeInboundProcessing(inboundOperation.id, claimToken, quoteAcceptanceResult);

    const bundleRecommendation =
      route.action === "auto_agent" && route.agentKey === "gift_design"
        ? this.recommendGiftBundle(route, payload.text || "")
        : null;
    const plan = planInboundAutomation({ route, assetIds, bundleRecommendation });
    const result: any = {
      message,
      route,
      plan,
      sendTask: null,
      designJob: null,
      notification: null,
      bundleRecommendation,
    };

    if (plan.shouldNotifyHuman) {
      const effects = await this.withInboundEffectLease(inboundOperation.id, claimToken, async () => {
        const manualLock = await this.lockConversationForManualReview(conversation, {
          reviewer: "system",
          reason: plan.reason,
          effectKey: `${inboundOperation.id}:manual-review-lock`,
        });
        const notification = await this.notifications.create(
          "warning",
          "客户消息需要人工处理",
          manualLock.blockedSendTasks.length
            ? `${conversation.title}：${plan.reason}。已暂停 ${manualLock.blockedSendTasks.length} 个待发送任务。`
            : `${conversation.title}：${plan.reason}`,
          {
            wechatAccountId: conversation.wechatAccountId,
            conversationId: conversation.id,
            customerId: conversation.customerId,
            routeId: route.id,
            reason: plan.reason,
            blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
            inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
            effectKey: `${inboundOperation.id}:manual-review-notification`,
          },
        );
        return { manualLock, notification };
      });
      result.manualLock = effects.manualLock;
      result.notification = effects.notification;
      return await this.completeInboundProcessing(inboundOperation.id, claimToken, result);
    }

    await this.withInboundEffectLease(inboundOperation.id, claimToken, async () => {
      if (plan.shouldCreateDesignJob) {
        result.designJob = this.createDesignDraftFromInbound({
          messageId: message.id,
          conversation,
          route,
          assetIds,
          bundleRecommendation,
          customerText: payload.text || "",
        });
      }

      if (plan.shouldQueueReply) {
        result.sendTask = this.createLocalSendTask({
          operationKey: stableOperationKey("inbound-reply", `${message.id}:auto-reply`),
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          designJobId: result.designJob?.id,
          payload: {
            kind: "text",
            text: buildInboundReplyText(route, plan),
            routeId: route.id,
            inboundMessageId: message.id,
            automationPlan: plan.type,
            routingPolicy: plan.routingPolicy || route.routingPolicy || null,
          },
          guardSnapshot: {
            requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
            policy: "single-account-serial-queue",
            reason: `inbound-${plan.reason}`,
          },
        });
      }
    });

    return await this.completeInboundProcessing(inboundOperation.id, claimToken, result);
    } catch (error) {
      await this.persistence.failInboundOperation(inboundOperation.id, claimToken, error).catch(() => null);
      throw error;
    }
  }

  private safeInboundOperationPayload(payload: any) {
    return {
      conversationId: String(payload?.conversationId || ""),
      customerId: String(payload?.customerId || ""),
      wechatAccountId: String(payload?.wechatAccountId || ""),
      text: String(payload?.text || ""),
      externalId: String(payload?.externalId || ""),
      attachments: sanitizeInboundOperationAttachments(payload?.attachments),
      assetIds: sanitizeInboundOperationAssetIds(payload?.assetIds),
      createdAt: payload?.createdAt || null,
    };
  }

  private nextInboundLeaseExpiry() {
    return new Date(Date.now() + INBOUND_OPERATION_LEASE_MS).toISOString();
  }

  private async withInboundEffectLease<T>(operationId: string, claimToken: string, effect: () => Promise<T> | T) {
    // This is only a preflight owner check for idempotent local effects and
    // stable send-task/notification operations. Prisma business mutations
    // must additionally fence the operation row inside their own transaction.
    await this.persistence.renewInboundOperationLease(
      operationId,
      claimToken,
      this.nextInboundLeaseExpiry(),
    );
    return effect();
  }

  private async completeInboundProcessing(operationId: string, claimToken: string, result: any) {
    const manualLock = result?.manualLock
      ? {
          conversationId: durableEntityId(result.manualLock?.conversation, "manual-lock conversation"),
          blockedSendTaskIds: durableEntityIds(result.manualLock?.blockedSendTasks),
          inFlightSendTaskIds: durableEntityIds(result.manualLock?.inFlightSendTasks),
          reviewLogId: durableEntityId(result.manualLock?.log, "manual-lock review log"),
        }
      : null;
    const durableResult = {
      messageId: result?.message?.id || null,
      routeEvaluationId: result?.route?.id || null,
      sendTaskId: result?.sendTask?.id || null,
      designJobId: result?.designJob?.id || null,
      notificationId: result?.notification?.id || null,
      quoteDraftId: durableEntityId(result?.quote, "quote draft"),
      orderDraftId: durableEntityId(result?.orderDraft, "order draft"),
      outcome: result?.plan?.type || (result?.duplicate ? "duplicate" : "processed"),
      plan: durableJsonSnapshot(result?.plan),
      bundleRecommendation: durableJsonSnapshot(result?.bundleRecommendation),
      selection: durableSelectionSnapshot(result?.selection),
      quoteAcceptance: durableJsonSnapshot(result?.quoteAcceptance),
      manualLock,
    };
    await this.persistence.advanceInboundOperation(operationId, claimToken, {
      stage: "effects_committed",
      messageId: durableResult.messageId,
      routeEvaluationId: durableResult.routeEvaluationId,
      sendTaskId: durableResult.sendTaskId,
      result: durableResult,
    });
    await this.persistence.completeInboundOperation(operationId, claimToken, durableResult);
    return result;
  }

  private async resumeLocalCommittedInbound(operation: any, claimToken: string) {
    const message = this.localStore.findInboundMessageByExternalId(operation.wechatAccountId, operation.externalId);
    if (!message) throw new BadRequestException("effects-committed inbound operation is missing its durable message");
    await this.persistence.completeInboundOperation(operation.id, claimToken, operation.result || {});
    return this.hydrateCompletedInboundReplay(operation, true);
  }

  private async hydrateCompletedInboundReplay(operation: any, recovered = false) {
    const durable = isPlainObject(operation?.result) ? operation.result : {};
    const messageId = String(durable.messageId || operation?.messageId || "").trim();
    const routeEvaluationId = String(durable.routeEvaluationId || operation?.routeEvaluationId || "").trim();
    const sendTaskId = String(durable.sendTaskId || operation?.sendTaskId || "").trim();
    const designJobId = String(durable.designJobId || "").trim();
    const notificationId = String(durable.notificationId || "").trim();
    const quoteDraftId = String(durable.quoteDraftId || "").trim();
    const orderDraftId = String(durable.orderDraftId || "").trim();
    const manualLockRef = isPlainObject(durable.manualLock) ? durable.manualLock : null;
    const manualConversationId = String(manualLockRef?.conversationId || "").trim();
    const manualReviewLogId = String(manualLockRef?.reviewLogId || "").trim();
    const blockedSendTaskIds = durableStringIds(manualLockRef?.blockedSendTaskIds);
    const inFlightSendTaskIds = durableStringIds(manualLockRef?.inFlightSendTaskIds);
    const [message, route, sendTask, designJob, notification, quote, orderDraft, manualConversation, manualReviewLog] = await Promise.all([
      this.persistence.findInboundMessageByExternalId(operation.wechatAccountId, operation.externalId),
      routeEvaluationId ? this.persistence.getRouteEvaluation(routeEvaluationId) : null,
      sendTaskId ? this.persistence.getSendTask(sendTaskId) : null,
      designJobId ? this.persistence.getDesignJob(designJobId) : null,
      notificationId ? this.persistence.getNotification(notificationId) : null,
      quoteDraftId ? this.persistence.getQuoteDraft(quoteDraftId) : null,
      orderDraftId ? this.orders.getById(orderDraftId) : null,
      manualConversationId ? this.persistence.getConversation(manualConversationId) : null,
      manualReviewLogId ? this.persistence.getReviewLog(manualReviewLogId) : null,
    ]);
    if (!message || (messageId && String(message.id || "") !== messageId)) {
      throw new BadRequestException("completed inbound operation is missing its durable message");
    }
    for (const [label, id, value] of [
      ["route evaluation", routeEvaluationId, route],
      ["send task", sendTaskId, sendTask],
      ["design job", designJobId, designJob],
      ["notification", notificationId, notification],
      ["quote draft", quoteDraftId, quote],
      ["order draft", orderDraftId, orderDraft],
      ["manual-lock conversation", manualConversationId, manualConversation],
      ["manual-lock review log", manualReviewLogId, manualReviewLog],
    ] as const) {
      if (id && !value) throw new BadRequestException(`completed inbound operation is missing its durable ${label}`);
    }
    const [blockedSendTasks, inFlightSendTasks] = await Promise.all([
      Promise.all(blockedSendTaskIds.map((id) => this.persistence.getSendTask(id))),
      Promise.all(inFlightSendTaskIds.map((id) => this.persistence.getSendTask(id))),
    ]);
    if (blockedSendTasks.some((item) => !item) || inFlightSendTasks.some((item) => !item)) {
      throw new BadRequestException("completed inbound operation is missing its durable manual-lock send task");
    }
    const canonicalIdentity = completedReplayEntityIdentity("message", message);
    assertCompletedReplayIdentity("operation", {
      wechatAccountId: operation.wechatAccountId,
      conversationId: operation.conversationId,
      customerId: operation.customerId,
    }, canonicalIdentity);
    for (const [label, value] of [
      ["route evaluation", route],
      ["send task", sendTask],
      ["design job", designJob],
      ["notification", notification],
      ["quote draft", quote],
      ["order draft", orderDraft],
      ["manual-lock conversation", manualConversation],
      ["manual-lock review log", manualReviewLog],
    ] as const) {
      if (value) assertCompletedReplayIdentity(label, value, canonicalIdentity);
    }
    for (const task of [...blockedSendTasks, ...inFlightSendTasks]) {
      assertCompletedReplayIdentity("manual-lock send task", task, canonicalIdentity);
    }
    if (manualLockRef && (!manualConversationId || !manualReviewLogId)) {
      throw new BadRequestException("completed inbound operation has an incomplete durable manual-lock reference");
    }
    const outcome = String(durable.outcome || "processed");
    const plan = isPlainObject(durable.plan)
      ? durable.plan
      : {
          type: outcome,
          reason: "inbound_operation_completed",
          shouldQueueReply: Boolean(sendTaskId),
          shouldCreateDesignJob: Boolean(designJobId),
          shouldNotifyHuman: Boolean(notificationId),
        };
    return {
      duplicate: true,
      processing: false,
      recovered,
      message,
      route,
      plan,
      outcome,
      sendTask,
      designJob,
      notification,
      quote,
      orderDraft,
      selection: hydrateDurableSelection(durable.selection, designJob),
      quoteAcceptance: Object.prototype.hasOwnProperty.call(durable, "quoteAcceptance") ? durable.quoteAcceptance : null,
      manualLock: manualLockRef
        ? {
            conversation: manualConversation,
            blockedSendTasks,
            inFlightSendTasks,
            log: manualReviewLog,
          }
        : null,
      bundleRecommendation: durable.bundleRecommendation || null,
      operationId: operation?.id || null,
    };
  }

  private inProgressInboundReplay(operation: any) {
    return {
      duplicate: true,
      processing: true,
      message: null,
      route: null,
      plan: null,
      sendTask: null,
      designJob: null,
      notification: null,
      bundleRecommendation: null,
      operationId: operation?.id || null,
    };
  }

  private async buildAiAssistedInboundDraft(input: { conversation: any; route: any; draft: any; customerText: string }) {
    if (!this.aiProviders || input.conversation.manualLocked || input.route.action !== "auto_agent") return null;
    try {
      const result = await this.aiProviders.generateInboundSuggestion({
        customerMessage: input.customerText,
        ruleSuggestion: input.draft.suggestedReply,
        agentKey: input.route.agentKey,
        scene: input.route.scene,
        nextAction: input.draft.replyDraft?.nextAction,
        knowledgeMatches: (input.draft.knowledgeMatches || []).map((item: any) => ({
          title: item.title,
          excerpt: item.excerpt,
        })),
      });
      return {
        used: true,
        text: result.text,
        provider: result.provider,
        model: result.model,
        attempts: result.attempts,
        authority: "rules_and_scoped_knowledge",
      };
    } catch {
      return {
        used: false,
        reason: "provider_unavailable_or_unsafe",
        authority: "rule_fallback",
      };
    }
  }

  private async processPrismaInboundMessage(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    text: string;
    externalId?: string;
    assetIds?: string[];
    attachments?: Array<Record<string, unknown>>;
    createdAt?: string;
    inboundOperationId?: string;
    inboundClaimToken?: string;
    inboundRequestFingerprint?: string;
  }) {
    if (!payload.conversationId) throw new BadRequestException("conversationId is required in prisma mode");
    const conversation = await this.persistence.getConversation(payload.conversationId);
    if (!conversation) throw new BadRequestException(`conversation not found: ${payload.conversationId}`);
    const binding = validateInboundConversationBinding({
      requestedWechatAccountId: payload.wechatAccountId,
      requestedConversationId: payload.conversationId,
      conversation,
    });
    if (!binding.ok) throw new BadRequestException(`message conversation binding invalid: ${binding.reason}`);
    if (payload.customerId && payload.customerId !== conversation.customerId) {
      throw new BadRequestException("message customer binding invalid: customer does not match conversation");
    }

    const safeAssetIds = sanitizeInboundOperationAssetIds(payload.assetIds, { rejectInvalid: true });
    const assetIds = normalizeAssetIds([...safeAssetIds, ...(payload.attachments || [])]);
    if (assetIds.length) {
      const assets = await (this.prisma as any).designAsset.findMany({ where: { id: { in: assetIds } } });
      for (const assetId of assetIds) {
        const asset = assets.find((item: any) => item.id === assetId);
        const result = validateDesignAssetBinding({ asset, conversation });
        if (!result.ok) throw new BadRequestException(`inbound asset binding invalid: ${result.reason}`);
      }
    }

    const claimToken = payload.inboundClaimToken || randomUUID();
    const externalId = String(payload.externalId || "").trim();
    const requestFingerprint = payload.inboundRequestFingerprint || createInboundMessageOperationFingerprint(payload as any, {
      conversationId: conversation.id,
      customerId: conversation.customerId,
      wechatAccountId: conversation.wechatAccountId,
    });
    const claim = await this.persistence.claimInboundOperation({
      operationId: payload.inboundOperationId,
      claimToken,
      source: payload.inboundOperationId ? "personal_wechat_rpa" : "wechat",
      wechatAccountId: conversation.wechatAccountId,
      externalId,
      requestFingerprint,
      normalizedPayload: this.safeInboundOperationPayload(payload),
      leaseExpiresAt: this.nextInboundLeaseExpiry(),
    });
    if (claim.completed) {
      return this.hydrateCompletedInboundReplay(claim.operation);
    }
    if (!claim.claimed) return this.inProgressInboundReplay(claim.operation);
    const inboundOperation = claim.operation;
    if (inboundOperationStageAtLeast(inboundOperation.stage, "effects_committed")) {
      const message = await this.persistence.findInboundMessageByExternalId(conversation.wechatAccountId, externalId);
      if (!message) throw new BadRequestException("effects-committed inbound operation is missing its durable message");
      await this.persistence.completeInboundOperation(inboundOperation.id, claimToken, inboundOperation.result || {});
      return this.hydrateCompletedInboundReplay(inboundOperation, true);
    }

    try {
    const message = await this.persistence.createMessage({
      inboundFence: {
        operationId: inboundOperation.id,
        claimToken,
        leaseExpiresAt: this.nextInboundLeaseExpiry(),
      },
      conversationId: conversation.id,
      customerId: conversation.customerId,
      wechatAccountId: payload.wechatAccountId,
      direction: "inbound",
      text: payload.text || "",
      externalId: payload.externalId,
      attachments: payload.attachments || [],
      createdAt: payload.createdAt,
      metadata: { assetIds },
    });
    await this.persistence.advanceInboundOperation(inboundOperation.id, claimToken, {
      stage: "message_persisted",
      messageId: message.id,
      customerId: conversation.customerId,
      conversationId: conversation.id,
    });
    const routeBase = evaluateAgentRoute(
      {
        text: payload.text || "",
        channel: conversation.channel || "wechat",
        wechatAccountId: conversation.wechatAccountId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
      },
      { highValueAmountCny: appConfig.highValueAmountCny, sceneMemory: [] },
    );
    const agent = await (this.prisma as any).customerServiceAgent.findUnique({ where: { key: routeBase.agentKey } });
    const [skills, knowledgeEntries] = agent
      ? await Promise.all([
          (this.prisma as any).agentSkill.findMany({ where: { agentId: agent.id, enabled: true }, orderBy: { updatedAt: "desc" } }),
          (this.prisma as any).knowledgeEntry.findMany({ where: { agentId: agent.id }, orderBy: { updatedAt: "desc" }, take: 100 }),
        ])
      : [[], []];
    const draft = buildAgentReplyDraft(routeBase, {
      agentId: agent?.id,
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      skills,
      knowledgeEntries,
    });
    const route = await this.createPrismaInboundRouteEvaluationOnce(inboundOperation.id, claimToken, {
        channel: conversation.channel || "wechat",
        text: payload.text || "",
        wechatAccountId: conversation.wechatAccountId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        agentId: agent?.id || null,
        agentKey: routeBase.agentKey,
        scene: routeBase.scene,
        action: routeBase.action,
        confidence: Math.round(Number(routeBase.confidence || 0)),
        isHighValue: Boolean(routeBase.isHighValue),
        budget: routeBase.budget || Prisma.JsonNull,
        missingFields: routeBase.missingFields || [],
        riskFlags: routeBase.riskFlags || [],
        suggestedReply: draft.suggestedReply,
        appliedSkills: draft.appliedSkills || [],
        knowledgeMatches: draft.knowledgeMatches || [],
        replyDraft: draft.replyDraft || Prisma.JsonNull,
    });
    await this.persistence.advanceInboundOperation(inboundOperation.id, claimToken, {
      stage: "routed",
      routeEvaluationId: route.id,
    });
    const selectionResult = await this.withInboundEffectLease(inboundOperation.id, claimToken, () =>
      this.handlePrismaInboundImageSelection({
        operationId: inboundOperation.id,
        claimToken,
        operationResult: inboundOperation.result,
        conversation,
        message,
        route,
        payload,
      }));
    if (selectionResult) return await this.completeInboundProcessing(inboundOperation.id, claimToken, selectionResult);
    const plan = planInboundAutomation({
      route: conversation.manualLocked ? { ...route, conversationManualLocked: true } : route,
      conversationManualLocked: Boolean(conversation.manualLocked),
      assetIds,
    });
    let sendTask: any = null;
    let notification: any = null;
    await this.withInboundEffectLease(inboundOperation.id, claimToken, async () => {
      if (!conversation.manualLocked && plan.shouldQueueReply) {
        const sendBinding = await this.assertSendTaskBinding({
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
        });
        sendTask = await this.persistence.createSendTask({
          operationKey: stableOperationKey("inbound-reply", `${message.id}:auto-reply`),
          wechatAccountId: conversation.wechatAccountId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          payload: {
            kind: "text",
            text: buildInboundReplyText(route, plan),
            routeId: route.id,
            inboundMessageId: message.id,
            automationPlan: plan.type,
            routingPolicy: plan.routingPolicy || route.routingPolicy || null,
          },
          guardSnapshot: {
            status: "pending",
            checks: [],
            requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
            policy: "single-account-serial-queue",
            reason: `inbound-${plan.reason}`,
            binding: sendBinding,
          },
        });
      }
      if (plan.shouldNotifyHuman || conversation.manualLocked) {
        notification = await this.notifications.create(
          "warning",
          conversation.manualLocked ? "人工接管会话收到新消息" : "客户消息需要人工处理",
          `${conversation.title || conversation.id}：${plan.reason}`,
          {
            wechatAccountId: conversation.wechatAccountId,
            conversationId: conversation.id,
            customerId: conversation.customerId,
            routeId: route.id,
            reason: plan.reason,
            effectKey: `${inboundOperation.id}:human-review-notification`,
          },
        );
      }
    });
    const result = {
      message,
      route,
      plan,
      sendTask,
      designJob: null,
      notification,
      bundleRecommendation: null,
    };
    return await this.completeInboundProcessing(inboundOperation.id, claimToken, result);
    } catch (error) {
      await this.persistence.failInboundOperation(inboundOperation.id, claimToken, error).catch(() => null);
      throw error;
    }
  }

  private async createPrismaInboundRouteEvaluationOnce(
    operationId: string,
    claimToken: string,
    data: Record<string, unknown>,
  ) {
    const prisma = this.prisma as any;
    const id = deterministicOperationId("route", operationId);
    const assertReplay = (existing: any) => {
      if (
        String(existing?.conversationId || "") !== String(data.conversationId || "") ||
        String(existing?.customerId || "") !== String(data.customerId || "") ||
        String(existing?.wechatAccountId || "") !== String(data.wechatAccountId || "") ||
        String(existing?.text || "") !== String(data.text || "")
      ) {
        throw new BadRequestException("inbound route operation replay changed identity or text");
      }
      return existing;
    };
    try {
      return await prisma.$transaction(async (tx: any) => {
        const fenced = await tx.inboundMessageOperation.updateMany({
          where: {
            id: operationId,
            status: "processing",
            claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: { leaseExpiresAt: new Date(this.nextInboundLeaseExpiry()) },
        });
        if (fenced.count !== 1) {
          throw new InboundLeaseLostError("inbound operation lease changed before route evaluation commit");
        }
        const existing = await tx.routeEvaluation.findUnique({ where: { id } });
        if (existing) return assertReplay(existing);
        return tx.routeEvaluation.create({ data: { id, ...data } });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await prisma.routeEvaluation.findUnique({ where: { id } });
      if (!winner) throw error;
      return assertReplay(winner);
    }
  }

  private async handlePrismaInboundImageSelection(params: {
    operationId: string;
    claimToken: string;
    operationResult?: unknown;
    conversation: any;
    message: any;
    route: any;
    payload: { text?: string; attachments?: Array<Record<string, unknown>> };
  }) {
    const recovery = inboundSelectionRecovery(params.operationResult);
    if (recovery) {
      const recoveryJob = await (this.prisma as any).designJob.findUnique({
        where: { id: recovery.designJobId },
        include: { images: true, revisions: true, customer: true, conversation: true },
      });
      if (
        !recoveryJob ||
        String(recoveryJob.wechatAccountId || "") !== String(params.conversation.wechatAccountId || "") ||
        String(recoveryJob.conversationId || "") !== String(params.conversation.id || "") ||
        String(recoveryJob.customerId || "") !== String(params.conversation.customerId || "")
      ) {
        throw new BadRequestException("high-value inbound selection recovery lost its durable design job binding");
      }
      const recoveryCandidate = (recoveryJob.images || []).find(
        (image: any) => String(image.id || "") === recovery.selectedImageId,
      );
      if (!recoveryCandidate) {
        throw new BadRequestException("high-value inbound selection recovery lost its durable image binding");
      }
      const recoveredSelection = {
        action: "select_image",
        ok: true,
        reviewRequired: false,
        reason: recovery.kind === "high_value_image_selection"
          ? "high_value_customer_selected_image"
          : "low_value_customer_selected_image",
        result: { candidate: recoveryCandidate, imageId: recovery.selectedImageId, source: "durable_recovery" },
      };
      if (recovery.kind === "high_value_image_selection") {
        return this.finishPrismaHighValueSelection(params, recoveryJob, recovery.selectedImageId, recoveredSelection);
      }
      const recoveredQuote = await (this.prisma as any).quoteDraft.findFirst({
        where: { designJobId: recovery.designJobId, selectedImageId: recovery.selectedImageId },
        include: { customer: true, selectedImage: true, designJob: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      if (!recoveredQuote) {
        throw new BadRequestException("low-value inbound selection recovery lost its durable quote binding");
      }
      const quoteSend = await this.tryQueuePrismaLowValueQuoteAfterSelection(recoveredQuote, recoveryJob);
      const notification = await this.notifications.create(
        "info",
        "低价值客户已选图，已生成报价草稿",
        "客户选图恢复完成，系统已确认候选图与报价草稿的持久化绑定。",
        {
          effectKey: `${params.operationId}:low-value-selection-notification`,
          designJobId: recoveryJob.id,
          quoteDraftId: quoteSend.quote?.id,
          selectedImageId: recovery.selectedImageId,
          wechatAccountId: params.conversation.wechatAccountId,
          conversationId: params.conversation.id,
          customerId: params.conversation.customerId,
        },
      );
      return {
        message: params.message,
        route: params.route,
        plan: {
          type: "select_design_image_and_create_quote",
          reason: quoteSend.sendTask ? "low_value_customer_selected_image_quote_queued" : "low_value_customer_selected_image",
          shouldNotifyHuman: false,
          shouldCreateDesignJob: false,
          shouldQueueReply: Boolean(quoteSend.sendTask),
        },
        sendTask: quoteSend.sendTask,
        designJob: recoveryJob,
        notification,
        bundleRecommendation: null,
        selection: recoveredSelection,
        quote: quoteSend.quote,
      };
    }
    if (this.hasInboundPaymentProof(params.payload)) return null;
    const identity = {
      wechatAccountId: String(params.conversation?.wechatAccountId || "").trim(),
      conversationId: String(params.conversation?.id || "").trim(),
      customerId: String(params.conversation?.customerId || "").trim(),
    };
    const hasSelectionIntent = planCustomerImageSelection({
      ...this.buildInboundSelectionInput(params.payload),
      candidates: [],
    }).action !== "skip";
    if (!hasSelectionIntent) return null;
    if (!identity.wechatAccountId || !identity.conversationId || !identity.customerId) {
      return this.createPrismaInboundSelectionReview(params, null, "selection_identity_incomplete");
    }

    const prisma = this.prisma as any;
    const job = await prisma.designJob.findFirst({
      where: {
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        status: { in: ["sent", "customer_selected", "quote_created"] },
      },
      include: { images: true, revisions: true, customer: true, conversation: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    const candidates = latestCandidateRound(
      Array.isArray(job?.images)
        ? [...job.images].sort((left: any, right: any) => Number(left.position || 0) - Number(right.position || 0))
        : [],
    );
    const selectionPlan = planCustomerImageSelection({
      ...this.buildInboundSelectionInput(params.payload),
      candidates,
    });
    if (this.shouldLetQuoteAcceptanceHandleSelectionText(params.payload, selectionPlan)) return null;
    if (!job || !selectionPlan.ok || selectionPlan.reviewRequired || !selectionPlan.result?.candidate) {
      return this.createPrismaInboundSelectionReview(
        params,
        job,
        job ? selectionPlan.reason || "selection_uncertain" : "selection_without_active_design_job",
        selectionPlan,
      );
    }

    const selectedImageId = String(selectionPlan.result.candidate.id || "").trim();
    if (!selectedImageId || !candidates.some((candidate: any) => String(candidate.id) === selectedImageId)) {
      return this.createPrismaInboundSelectionReview(params, job, "selection_candidate_outside_latest_revision", selectionPlan);
    }
    const existingQuote = await prisma.quoteDraft.findFirst({
      where: { designJobId: job.id },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    if (existingQuote?.sendTaskId || existingQuote?.status === "sent") {
      return this.createPrismaInboundSelectionReview(params, job, "quote_already_queued_or_sent", selectionPlan);
    }
    const feedback = this.inboundSelectionFeedback(params.payload, selectionPlan.result);
    const highValueReview = this.shouldManualReviewSelectedJob(job);
    const recoveryEffect = {
      kind: highValueReview ? "high_value_image_selection" : "low_value_image_selection",
      phase: "selection_committed",
      designJobId: job.id,
      selectedImageId,
      routeEvaluationId: params.route.id,
    };
    let updatedJob: any;
    let quote: any = null;
    try {
      const initialRevisionSignature = designSelectionRevisionSignature(job);
      const committed = await prisma.$transaction(async (tx: any) => {
        const fenced = await tx.inboundMessageOperation.updateMany({
          where: {
            id: params.operationId,
            status: "processing",
            claimToken: params.claimToken,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            result: {
              ...(isPlainObject(params.operationResult) ? params.operationResult : {}),
              recoveryEffect,
            },
            leaseExpiresAt: new Date(this.nextInboundLeaseExpiry()),
          },
        });
        if (fenced.count !== 1) {
          throw new InboundLeaseLostError("inbound operation lease changed before design selection commit");
        }
        const current = await tx.designJob.findFirst({
          where: {
            id: job.id,
            wechatAccountId: identity.wechatAccountId,
            conversationId: identity.conversationId,
            customerId: identity.customerId,
            status: { in: ["sent", "customer_selected", "quote_created"] },
          },
          include: { images: true, revisions: true },
        });
        if (!current) throw new BadRequestException("design selection identity changed before commit");
        if (designSelectionRevisionSignature(current) !== initialRevisionSignature) {
          throw new BadRequestException("design selection revision changed before commit");
        }
        const currentCandidates = latestCandidateRound(current.images || []);
        if (!currentCandidates.some((candidate: any) => String(candidate.id) === selectedImageId)) {
          throw new BadRequestException("design selection candidate is not in the latest revision");
        }
        await tx.designImageCandidate.updateMany({ where: { designJobId: current.id }, data: { selected: false } });
        await tx.designImageCandidate.update({
          where: { id: selectedImageId },
          data: { selected: true, customerFeedback: feedback },
        });
        const nextJob = await tx.designJob.update({
          where: { id: current.id },
          data: highValueReview
            ? { status: "manual_review", manualQcRequired: true }
            : { status: "quote_created" },
          include: { images: true, revisions: true, customer: true, conversation: true },
        });
        if (highValueReview) {
          return { job: nextJob, quote: null };
        }
        const pricing = prismaQuotePricing(job);
        const quoteStatus = pricing.highValue || !inspectBundleAutomationReadiness(job.bundle || {}).ok
          ? "manual_review"
          : "auto_sent";
        const quoteData = {
          selectedImageId,
          quantity: pricing.quantity,
          unitPrice: pricing.unitPrice,
          totalPrice: pricing.totalPrice,
          totalCost: pricing.totalCost,
          profit: pricing.profit,
          status: quoteStatus,
          paymentStatus: existingQuote?.paymentStatus || "unpaid",
          customerNotes: "客户在会话中选择了这张效果图，系统已绑定为报价图片。",
        };
        const nextQuote = existingQuote
          ? await tx.quoteDraft.update({
              where: { id: existingQuote.id },
              data: quoteData,
              include: { customer: true, selectedImage: true, designJob: true },
            })
          : await tx.quoteDraft.create({
              data: {
                designJobId: current.id,
                customerId: identity.customerId,
                ...quoteData,
              },
              include: { customer: true, selectedImage: true, designJob: true },
            });
        return { job: nextJob, quote: nextQuote };
      });
      updatedJob = committed.job;
      quote = committed.quote;
    } catch (error) {
      if (error instanceof InboundLeaseLostError) throw error;
      if (error instanceof BadRequestException) {
        return this.createPrismaInboundSelectionReview(params, job, "selection_revision_changed_before_commit", selectionPlan);
      }
      throw error;
    }
    if (highValueReview) {
      return this.finishPrismaHighValueSelection(params, updatedJob, selectedImageId, selectionPlan);
    }
    const quoteSend = await this.tryQueuePrismaLowValueQuoteAfterSelection(quote, updatedJob);
    quote = quoteSend.quote;
    const notification = await this.notifications.create(
      "info",
      "低价值客户已选图，已生成报价草稿",
      "客户选图置信度高，系统已绑定候选图并生成报价草稿，后台低价值自动化会继续处理报价发送队列。",
      { effectKey: `${params.operationId}:low-value-selection-notification`, designJobId: job.id, quoteDraftId: quote?.id, selectedImageId, ...identity },
    );
    return {
      message: params.message,
      route: params.route,
      plan: {
        type: "select_design_image_and_create_quote",
        reason: quoteSend.sendTask ? "low_value_customer_selected_image_quote_queued" : "low_value_customer_selected_image",
        shouldNotifyHuman: false,
        shouldCreateDesignJob: false,
        shouldQueueReply: Boolean(quoteSend.sendTask),
      },
      sendTask: quoteSend.sendTask,
      designJob: updatedJob,
      notification,
      bundleRecommendation: null,
      selection: selectionPlan,
      quote,
    };
  }

  private async finishPrismaHighValueSelection(
    params: { operationId: string; conversation: any; message: any; route: any },
    job: any,
    selectedImageId: string,
    selectionPlan: any,
  ) {
    const identity = {
      wechatAccountId: String(params.conversation?.wechatAccountId || "").trim(),
      conversationId: String(params.conversation?.id || "").trim(),
      customerId: String(params.conversation?.customerId || "").trim(),
    };
    const manualLock = await this.lockConversationForManualReview(params.conversation, {
      reviewer: "system",
      reason: "high_value_customer_selected_image",
      effectKey: `${params.operationId}:high-value-selection-lock`,
    });
    await this.createReviewLog({
      targetType: "design_job",
      targetId: job.id,
      decision: "high_value_customer_selected_image",
      reviewer: "system",
      note: "高价值客户已选定效果图，需要人工复核报价、利润和跟进话术后再发送。",
      beforeStatus: job.status || "",
      afterStatus: "manual_review",
      metadata: {
        effectKey: `${params.operationId}:high-value-selection-review`,
        source: "inbound_image_selection",
        selectedImageId,
        routeId: params.route.id,
        ...identity,
      },
    });
    const notification = await this.notifications.create(
      "warning",
      "高价值客户已选图，转人工报价",
      "客户已明确选择效果图，请人工确认报价、交期和后续跟进。",
      {
        effectKey: `${params.operationId}:high-value-selection-notification`,
        designJobId: job.id,
        selectedImageId,
        routeId: params.route.id,
        ...identity,
      },
    );
    return {
      message: params.message,
      route: params.route,
      plan: {
        type: "select_design_image",
        reason: "high_value_customer_selected_image",
        shouldNotifyHuman: true,
        shouldCreateDesignJob: false,
        shouldQueueReply: false,
      },
      sendTask: null,
      designJob: job,
      notification,
      bundleRecommendation: null,
      selection: selectionPlan,
      quote: null,
      manualLock,
    };
  }

  private async tryQueuePrismaLowValueQuoteAfterSelection(quote: any, designJob: any) {
    const decision = evaluateLowValueQuoteSend(quote, { highValueAmountCny: appConfig.highValueAmountCny });
    if (!decision.ok) return { decision, quote, sendTask: null };
    const text = buildQuoteCustomerMessage({
      customerName: quote.customer?.name,
      scene: designJob?.scene,
      quantity: quote.quantity,
      unitPrice: quote.unitPrice,
      totalPrice: quote.totalPrice,
      hasSelectedImage: Boolean(quote.selectedImageId),
      selectedImagePosition: quote.selectedImage?.position,
      items: Array.isArray(designJob?.bundle?.items) ? designJob.bundle.items : [],
    });
    const sendTask = await this.enqueueQuoteMessage({
      operationKey: stableOperationKey("quote-send", `${quote.id}:selected-image`),
      wechatAccountId: designJob.wechatAccountId,
      conversationId: designJob.conversationId,
      customerId: quote.customerId || designJob.customerId,
      designJobId: designJob.id,
      quoteDraftId: quote.id,
      text,
      automation: {
        source: "inbound_image_selection_quote_send",
        valueLevel: "low",
        reason: decision.reason,
        queuedBy: "low_value_automation",
      },
    });
    const updatedQuote = await (this.prisma as any).quoteDraft.update({
      where: { id: quote.id },
      data: {
        status: "send_queued",
        sendTaskId: sendTask.id,
        owner: quote.owner || "low_value_automation",
        customerNotes: "客户选图后，低价值报价已自动进入微信安全发送队列。",
      },
      include: { customer: true, selectedImage: true, designJob: true },
    });
    return { decision, quote: updatedQuote, sendTask };
  }

  private async createPrismaInboundSelectionReview(
    params: { operationId: string; conversation: any; message: any; route: any },
    job: any,
    reason: string,
    selection: any = null,
  ) {
    const manualLock = await this.lockConversationForManualReview(params.conversation, {
      reviewer: "system",
      reason,
      effectKey: `${params.operationId}:selection-review-lock:${reason}`,
    });
    const notification = await this.notifications.create(
      "warning",
      "客户选图需要人工确认",
      "客户消息包含选图意图，但当前生产持久化数据无法在同一身份和最新修订范围内唯一判定候选图。",
      {
        effectKey: `${params.operationId}:selection-review-notification:${reason}`,
        reason,
        designJobId: job?.id || null,
        wechatAccountId: params.conversation.wechatAccountId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
        routeId: params.route.id,
      },
    );
    return {
      message: params.message,
      route: params.route,
      plan: {
        type: "manual_selection_review",
        reason,
        shouldNotifyHuman: true,
        shouldCreateDesignJob: false,
        shouldQueueReply: false,
      },
      sendTask: null,
      designJob: job,
      notification,
      bundleRecommendation: null,
      selection,
      quote: null,
      manualLock,
    };
  }

  listWindowSnapshots(filter: IdentityFilter = {}) {
    if (appConfig.useLocalStore) return this.localStore.listWechatWindowSnapshots(filter);
    return this.persistence.listWindowSnapshots(filter);
  }

  getWindowObserverStatus() {
    const statusFile = appConfig.wechatWindowObserverStatusFile;
    if (!fs.existsSync(statusFile)) {
      return sanitizeWindowObserverStatus({
        ok: false,
        status: "not_started",
        ageSeconds: null,
        message: "window observer has not written a status file yet",
      });
    }

    const stat = fs.statSync(statusFile);
    const ageSeconds = Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 1000));
    try {
      const data = JSON.parse(fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""));
      return sanitizeWindowObserverStatus({
        ...data,
        ageSeconds,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      return sanitizeWindowObserverStatus({
        ok: false,
        status: "invalid_status_file",
        ageSeconds,
        modifiedAt: stat.mtime.toISOString(),
        errorMessage: error instanceof Error ? error.message : "invalid window observer status json",
      });
    }
  }

  captureWindowObserverOnce() {
    if (!appConfig.useLocalStore) return this.capturePrismaWindowObserverOnce();
    const observerScript = path.join(process.cwd(), "tools", "wechat-window-observer.js");
    if (!fs.existsSync(observerScript)) throw new BadRequestException(`window observer script not found: ${observerScript}`);
    const result = spawnSync(process.execPath, [observerScript, "--once"], {
      cwd: process.cwd(),
      env: buildWindowObserverChildEnvironment(process.env, {
        WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: appConfig.wechatWindowSnapshotInboxDir,
        WECHAT_WINDOW_OBSERVER_STATUS_FILE: appConfig.wechatWindowObserverStatusFile,
        WECHAT_WINDOW_OBSERVER_PROOF_FILE: appConfig.wechatWindowObserverProofFile,
      }),
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    if (result.error) throw new BadRequestException(`window observer failed: ${result.error.message}`);
    if (result.status !== 0) throw new BadRequestException(String(result.stderr || result.stdout || "window observer failed").trim());
    const scan = this.scanWindowSnapshotInbox();
    return { status: this.getWindowObserverStatus(), scan, summary: sanitizeWindowObserverStdout(result.stdout) };
  }

  private async capturePrismaWindowObserverOnce() {
    const observerScript = path.join(process.cwd(), "tools", "wechat-window-observer.js");
    if (!fs.existsSync(observerScript)) {
      throw new BadRequestException(`window observer script not found: ${observerScript}`);
    }

    const result = spawnSync(process.execPath, [observerScript, "--once"], {
      cwd: process.cwd(),
      env: buildWindowObserverChildEnvironment(process.env, {
        WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: appConfig.wechatWindowSnapshotInboxDir,
        WECHAT_WINDOW_OBSERVER_STATUS_FILE: appConfig.wechatWindowObserverStatusFile,
        WECHAT_WINDOW_OBSERVER_PROOF_FILE: appConfig.wechatWindowObserverProofFile,
      }),
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });

    if (result.error) {
      throw new BadRequestException(`window observer failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new BadRequestException(String(result.stderr || result.stdout || "window observer failed").trim());
    }

    const scan = await this.scanWindowSnapshotInbox();
    return {
      status: this.getWindowObserverStatus(),
      scan,
      summary: sanitizeWindowObserverStdout(result.stdout),
    };
  }

  private createVerifiedWindowSnapshot(snapshotPayload: Record<string, unknown>, observerEvidence: Record<string, unknown>) {
    const snapshot = normalizeWechatWindowSnapshot(snapshotPayload || {});
    const account = this.localStore.listWechatAccounts().find((item) => item.id === snapshot.wechatAccountId) || null;
    const conversations = this.localStore.listConversations(snapshot.wechatAccountId || undefined);
    const verifiedEvidence = createWechatWindowObserverAttestation(
      snapshot,
      observerEvidence,
      currentWechatWindowObserverProofToken(),
    );
    const diagnostic = {
      ...diagnoseWechatWindowSnapshot({ snapshot, account, conversations }),
      observerEvidence: { ...verifiedEvidence, verifiedAt: new Date().toISOString() },
    };
    return this.localStore.createWechatWindowSnapshot({ ...snapshot, diagnostic });
  }

  private async createVerifiedPrismaWindowSnapshot(
    snapshotPayload: Record<string, unknown>,
    observerEvidence: Record<string, unknown>,
  ) {
    const snapshot = normalizeWechatWindowSnapshot(snapshotPayload || {});
    const accounts = await this.persistence.listAccounts();
    const account = accounts.find((item: any) => item.id === snapshot.wechatAccountId) || null;
    const conversations = await this.persistence.listConversations(snapshot.wechatAccountId || undefined);
    const verifiedEvidence = createWechatWindowObserverAttestation(
      snapshot,
      observerEvidence,
      currentWechatWindowObserverProofToken(),
    );
    const diagnostic = {
      ...diagnoseWechatWindowSnapshot({ snapshot, account, conversations }),
      observerEvidence: { ...verifiedEvidence, verifiedAt: new Date().toISOString() },
    };
    const activeConversation = conversations.find((conversation: any) => {
      if (snapshot.externalChatId && conversation.externalChatId === snapshot.externalChatId) return true;
      if (snapshot.chatTitle && String(conversation.title || "").trim() === String(snapshot.chatTitle || "").trim()) return true;
      return Boolean(snapshot.recentCustomerId && conversation.customerId === snapshot.recentCustomerId);
    });
    return this.persistence.createWindowSnapshot({
      ...snapshot,
      id: `observer_${String(observerEvidence.nonceHash || "")}`,
      activeConversationId: activeConversation?.id || null,
      diagnostic,
    });
  }

  private assertObserverNonceUnused(nonceHash: string) {
    const replayed = this.localStore
      .listWechatWindowSnapshots(500)
      .some((snapshot: any) => snapshot?.diagnostic?.observerEvidence?.nonceHash === nonceHash);
    if (replayed) throw new Error("observer evidence replay rejected");
  }

  private async assertPrismaObserverNonceUnused(nonceHash: string) {
    const snapshots = await this.persistence.listWindowSnapshots({ limit: 300 });
    const replayed = snapshots.some((snapshot: any) => snapshot?.diagnostic?.observerEvidence?.nonceHash === nonceHash);
    if (replayed) throw new Error("observer evidence replay rejected");
  }

  scanWindowSnapshotInbox() {
    if (!appConfig.useLocalStore) return this.scanPrismaWindowSnapshotInbox();
    const inboxDir = appConfig.wechatWindowSnapshotInboxDir;
    const allEntries = listJsonInboxFiles(inboxDir);
    const limit = clampWindowSnapshotScanLimit(appConfig.wechatWindowSnapshotScanLimit);
    const entries = allEntries.slice(0, limit);
    const processed: any[] = [];
    const failed: any[] = [];
    for (const entry of entries) {
      let claimedPath = entry.filePath;
      try {
        claimedPath = claimJsonInboxFile(entry.filePath, inboxDir);
        const data = readJsonFile(claimedPath);
        const snapshots = normalizeWindowSnapshotInboxPayload(data);
        if (snapshots.length !== 1) throw new Error("window snapshot inbox file must contain exactly one observer evidence envelope");
        const created = snapshots.map((evidence, index) => {
          const verified = verifyWechatWindowObserverEvidence(evidence, currentWechatWindowObserverProofToken(), {
            maxAgeSeconds: appConfig.wechatWindowSnapshotMaxAgeSeconds,
          });
          if (!verified.ok) throw new Error(`observer evidence[${index}] rejected: ${verified.reason}`);
          this.assertObserverNonceUnused(verified.evidence.nonceHash);
          return this.createVerifiedWindowSnapshot(trustedObserverSnapshot(verified.snapshot, verified.evidence), verified.evidence);
        });
        moveJsonInboxFile(claimedPath, inboxDir, "processed");
        processed.push({
          fileName: entry.fileName,
          modifiedAt: entry.modifiedAt,
          ageSeconds: entry.ageSeconds,
          snapshotCount: created.length,
          snapshots: created.map(sanitizeWindowSnapshotScanItem),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown window snapshot inbox error";
        if (fs.existsSync(claimedPath)) moveJsonInboxFile(claimedPath, inboxDir, "failed");
        failed.push({ fileName: entry.fileName, modifiedAt: entry.modifiedAt, ageSeconds: entry.ageSeconds, errorMessage });
      }
    }
    return { scanned: entries.length, total: allEntries.length, pending: Math.max(0, allEntries.length - entries.length), limit, processed, failed };
  }

  private async scanPrismaWindowSnapshotInbox() {
    const inboxDir = appConfig.wechatWindowSnapshotInboxDir;
    const allEntries = listJsonInboxFiles(inboxDir);
    const limit = clampWindowSnapshotScanLimit(appConfig.wechatWindowSnapshotScanLimit);
    const entries = allEntries.slice(0, limit);
    const processed: any[] = [];
    const failed: any[] = [];

    for (const entry of entries) {
      let claimedPath = entry.filePath;
      try {
        claimedPath = claimJsonInboxFile(entry.filePath, inboxDir);
        const data = readJsonFile(claimedPath);
        const snapshots = normalizeWindowSnapshotInboxPayload(data);
        if (snapshots.length !== 1) {
          throw new Error("window snapshot inbox file must contain exactly one observer evidence envelope");
        }

        const created = [];
        for (const [index, evidence] of snapshots.entries()) {
          const verified = verifyWechatWindowObserverEvidence(evidence, currentWechatWindowObserverProofToken(), {
            maxAgeSeconds: appConfig.wechatWindowSnapshotMaxAgeSeconds,
          });
          if (!verified.ok) throw new Error(`observer evidence[${index}] rejected: ${verified.reason}`);
          await this.assertPrismaObserverNonceUnused(verified.evidence.nonceHash);
          created.push(await this.createVerifiedPrismaWindowSnapshot(
            trustedObserverSnapshot(verified.snapshot, verified.evidence),
            verified.evidence,
          ));
        }
        moveJsonInboxFile(claimedPath, inboxDir, "processed");
        processed.push({
          fileName: entry.fileName,
          modifiedAt: entry.modifiedAt,
          ageSeconds: entry.ageSeconds,
          snapshotCount: created.length,
          snapshots: created.map(sanitizeWindowSnapshotScanItem),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown window snapshot inbox error";
        if (fs.existsSync(claimedPath)) moveJsonInboxFile(claimedPath, inboxDir, "failed");
        failed.push({
          fileName: entry.fileName,
          modifiedAt: entry.modifiedAt,
          ageSeconds: entry.ageSeconds,
          errorMessage,
        });
      }
    }

    return {
      scanned: entries.length,
      total: allEntries.length,
      pending: Math.max(0, allEntries.length - entries.length),
      limit,
      processed,
      failed,
    };
  }

  createDemoWindowSnapshot(payload: {
    mode?: "correct" | "wrong_chat" | "offline";
    wechatAccountId?: string;
    conversationId?: string;
  } & ExpectedIdentityPayload) {
    if (!appConfig.useLocalStore) return this.createPrismaDemoWindowSnapshot(payload);
    if (!payload?.wechatAccountId) throw new BadRequestException("wechatAccountId is required for demo window snapshot");
    if (!payload?.conversationId) throw new BadRequestException("conversationId is required for demo window snapshot");
    const accounts = this.localStore.listWechatAccounts();
    const account = accounts.find((item) => item.id === payload.wechatAccountId);
    if (!account) throw new BadRequestException("wechat account not found for demo window snapshot");
    const conversations = this.localStore.listConversations(account.id);
    const conversation = conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) throw new BadRequestException("conversation does not belong to selected wechat account");
    this.assertDemoConversationIdentity(conversation, payload, "demo window snapshot");
    const snapshot = buildDemoWechatWindowSnapshot({
      mode: payload?.mode || "correct",
      account,
      conversation,
      otherConversation: conversations.find((item) => item.id !== conversation.id) || null,
    });
    const diagnostic = markWindowDiagnosticNonSendable(
      diagnoseWechatWindowSnapshot({ snapshot, account, conversations }),
      "demo_snapshot",
    );
    return this.localStore.createWechatWindowSnapshot({ ...snapshot, diagnostic });
  }

  private async createPrismaDemoWindowSnapshot(payload: {
    mode?: "correct" | "wrong_chat" | "offline";
    wechatAccountId?: string;
    conversationId?: string;
  } & ExpectedIdentityPayload) {
    if (!payload?.wechatAccountId) {
      throw new BadRequestException("wechatAccountId is required for demo window snapshot");
    }
    if (!payload?.conversationId) {
      throw new BadRequestException("conversationId is required for demo window snapshot");
    }
    const accounts = await this.persistence.listAccounts();
    const account = accounts.find((item) => item.id === payload.wechatAccountId);
    if (!account) throw new BadRequestException("wechat account not found for demo window snapshot");
    const conversations = await this.persistence.listConversations(account.id);
    const conversation = conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) {
      throw new BadRequestException("conversation does not belong to selected wechat account");
    }
    this.assertDemoConversationIdentity(conversation, payload, "demo window snapshot");
    const otherConversation = conversations.find((item) => item.id !== conversation.id) || null;
    const snapshot = buildDemoWechatWindowSnapshot({
      mode: payload?.mode || "correct",
      account,
      conversation,
      otherConversation,
    });
    const diagnostic = markWindowDiagnosticNonSendable(
      diagnoseWechatWindowSnapshot({ snapshot, account, conversations }),
      "demo_snapshot",
    );
    return this.persistence.createWindowSnapshot({
      ...snapshot,
      diagnostic,
    });
  }

  listSendTasks(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return appConfig.useLocalStore ? this.localStore.listSendTasks(filter) : this.persistence.listSendTasks(filter);
  }

  listSendAttempts(filter: { sendTaskId?: string; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) {
      if (filter.sendTaskId) {
        this.assertSendAttemptListIdentity(filter);
        return this.localStore.listSendAttempts({ sendTaskId: filter.sendTaskId });
      }
      return this.localStore.listSendAttempts(filter);
    }
    return this.listPrismaSendAttempts(filter);
  }

  private async listPrismaSendAttempts(filter: { sendTaskId?: string; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (filter.sendTaskId) {
      await this.assertSendAttemptListIdentity(filter);
      return this.persistence.listSendAttempts({ sendTaskId: filter.sendTaskId });
    }
    return this.persistence.listSendAttempts(filter);
  }

  private assertSendAttemptListIdentity(filter: {
    sendTaskId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    if (!appConfig.useLocalStore) return this.assertPrismaSendAttemptListIdentity(filter);
    const task = this.localStore.getSendTask(filter.sendTaskId || "");
    if (!task) throw new Error(`send task not found: ${filter.sendTaskId}`);
    const missing = [
      !filter.wechatAccountId ? "wechatAccountId" : "",
      !filter.conversationId ? "conversationId" : "",
      !filter.customerId ? "customerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`send attempts require conversation identity: ${missing.join(", ")}`);
    }
    assertExpectedIdentity(
      task,
      {
        expectedWechatAccountId: filter.wechatAccountId,
        expectedConversationId: filter.conversationId,
        expectedCustomerId: filter.customerId,
      },
      "send task",
    );
  }

  private async assertPrismaSendAttemptListIdentity(filter: {
    sendTaskId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    const task = await this.persistence.getSendTask(filter.sendTaskId || "");
    if (!task) throw new Error(`send task not found: ${filter.sendTaskId}`);
    const missing = [!filter.wechatAccountId ? "wechatAccountId" : "", !filter.conversationId ? "conversationId" : "", !filter.customerId ? "customerId" : ""].filter(Boolean);
    if (missing.length) throw new BadRequestException(`send attempts require conversation identity: ${missing.join(", ")}`);
    assertExpectedIdentity(task, {
      expectedWechatAccountId: filter.wechatAccountId,
      expectedConversationId: filter.conversationId,
      expectedCustomerId: filter.customerId,
    }, "send task");
  }

  getSendAdapter(adapter?: string) {
    return this.sendAdapter.describe(adapter);
  }

  async getChannelStatus(filter: IdentityFilter = {}) {
    const [accounts, conversations, sendTasks, routeEvaluations, bridge] = await Promise.all([
      this.persistence.listAccounts(),
      this.persistence.listConversations(filter.wechatAccountId),
      this.persistence.listSendTasks(filter),
      appConfig.useLocalStore
        ? Promise.resolve(this.localStore.listRouteEvaluations())
        : (this.prisma as any).routeEvaluation.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      this.getBridgeStatus(filter),
    ]);
    const observer = this.getWindowObserverStatus();
    const configuredSendAdapter = this.getSendAdapter();
    const pendingSendCount = sendTasks.filter((task: any) => !["sent", "cancelled"].includes(task.status)).length;
    const manualLockedCount = conversations.filter((conversation: any) => conversation.manualLocked).length;
    const activeAccountCount = accounts.filter((account: any) => account.isActive !== false).length;

    const personalChecks = [
      channelCheck("wechat_accounts", "本地微信账号", accounts.length > 0, `${accounts.length} 个账号`),
      channelCheck("window_observer", "窗口观察器", Boolean(observer?.ok), operatorStatusName(observer?.status)),
      channelCheck("windows_bridge", "Windows 文件桥接", Boolean(bridge?.worker?.ok), operatorStatusName(bridge?.worker?.status)),
      channelCheck(
        "safe_send_queue",
        "当前发送适配器",
        configuredSendAdapter?.name === "windows_bridge" && Boolean(configuredSendAdapter?.realSend),
        configuredSendAdapter?.label || "未配置",
      ),
    ];
    const workChecks = [
      channelCheck("normalized_inbound", "标准入站管线", true, "回调 + kf/sync_msg 归一化后复用现有入站管线"),
      channelCheck("corp_id", "企业 ID", Boolean(appConfig.wechatWorkCorpId), maskSecret(appConfig.wechatWorkCorpId)),
      channelCheck("customer_service_secret", "微信客服 Secret", Boolean(appConfig.wechatWorkSecret), appConfig.wechatWorkSecret ? "已配置" : "未配置"),
      channelCheck("callback_token", "回调 Token", Boolean(appConfig.wechatWorkToken), appConfig.wechatWorkToken ? "已配置" : "未配置"),
      channelCheck("encoding_aes_key", "回调 EncodingAESKey", Boolean(appConfig.wechatWorkEncodingAesKey), appConfig.wechatWorkEncodingAesKey ? "已配置" : "未配置"),
      channelCheck("public_https", "公网 HTTPS 回调", /^https:\/\//i.test(appConfig.customerServicePublicBaseUrl), appConfig.customerServicePublicBaseUrl),
      channelCheck(
        "official_send_adapter",
        "企业微信官方发送适配器",
        configuredSendAdapter?.name === "wechat_work_kf" && Boolean(configuredSendAdapter?.realSend),
        configuredSendAdapter?.label || "未配置",
      ),
    ];
    const miniChecks = [
      channelCheck("normalized_inbound", "标准入站管线", true, "复用 /api/wechat/inbound/messages"),
      channelCheck("app_id", "小程序 AppID", Boolean(appConfig.wechatMiniAppId), maskSecret(appConfig.wechatMiniAppId)),
      channelCheck("callback_token", "消息 Token", Boolean(appConfig.wechatMiniToken), appConfig.wechatMiniToken ? "已配置" : "未配置"),
      channelCheck("safe_send_queue", "人工/客服发送队列", true, "复用微信安全发送队列"),
    ];

    const personalStatus = channelStatus(personalChecks);
    const workStatus = channelStatus(workChecks);
    const miniStatus = channelStatus(miniChecks);
    const channels = [
      {
        key: "personal_wechat",
        label: "个人微信",
        kind: "desktop_bridge",
        status: personalStatus,
        ready: checksReady(personalChecks),
        description: "个人微信通过本机窗口观察、单账号锁和 Windows 文件桥接落地；真实发送必须等桥接发送器回执。",
        entrypoints: {
          inbound: "/api/wechat/inbound/messages",
          status: "/api/wechat/bridge/status",
          observer: "/api/wechat/window-observer/status",
          send: "/api/wechat/send-tasks/:id/execute",
        },
        metrics: {
          accounts: accounts.length,
          activeAccounts: activeAccountCount,
          conversations: conversations.length,
          pendingSendTasks: pendingSendCount,
          manualLockedConversations: manualLockedCount,
          bridgeOutboxPending: bridge.outbox.pendingCount,
          bridgeDispatchPending: bridge.dispatch.pendingCount,
          bridgeDispatchStale: bridge.dispatch.staleCount,
          bridgeInboxPending: bridge.inbox.pendingCount,
        },
        checks: personalChecks,
      },
      {
        key: "work_wechat",
        label: "企业微信",
        kind: "official_account_callback",
        status: workStatus,
        ready: checksReady(workChecks),
        description: "企业微信官方客服通过回调和 sync_msg 入站，并在既有安全队列通过后调用 kf/send_msg。",
        entrypoints: {
          inbound: "/api/wechat-work/callback",
          status: "/api/wechat-work/status",
          sync: "/api/wechat-work/kf/sync",
          safeSend: "/api/wechat/send-tasks/process-safe-queue",
        },
        metrics: {
          conversations: conversations.filter((conversation: any) => conversation.channel === "work_wechat").length,
          latestRoutes: routeEvaluations.filter((route: any) => route.channel === "work_wechat").length,
          pendingSendTasks: pendingSendCount,
        },
        checks: workChecks,
      },
      {
        key: "mini_program",
        label: "微信小程序",
        kind: "mini_program_customer_message",
        status: miniStatus,
        ready: checksReady(miniChecks),
        description: "小程序客服消息完成 AppID 和 Token 配置后，统一进入会话、路由、审核和发送队列。",
        entrypoints: {
          inbound: "/api/wechat/inbound/messages",
          testInbound: "/api/wechat/channels/mini_program/inbound/test",
          safeSend: "/api/wechat/send-tasks",
        },
        metrics: {
          conversations: conversations.filter((conversation: any) => conversation.channel === "mini_program").length,
          latestRoutes: routeEvaluations.filter((route: any) => route.channel === "mini_program").length,
          pendingSendTasks: pendingSendCount,
        },
        checks: miniChecks,
      },
    ];

    return {
      updatedAt: new Date().toISOString(),
      summary: {
        total: channels.length,
        ready: channels.filter((channel) => channel.ready).length,
        degraded: channels.filter((channel) => ["needs_runtime", "needs_send_adapter"].includes(channel.status)).length,
        needsSendAdapter: channels.filter((channel) => channel.status === "needs_send_adapter").length,
        needsConfig: channels.filter((channel) => channel.status === "needs_config").length,
        pendingSendTasks: pendingSendCount,
        manualLockedConversations: manualLockedCount,
      },
      channels,
      visualFlow: [
        { key: "inbound", label: "消息接入", detail: `${conversations.length} 个会话` },
        { key: "route", label: "智能路由", detail: `${routeEvaluations.length} 次评估` },
        { key: "design", label: "设计/报价", detail: "低风险自动推进，高价值人工审核" },
        { key: "review", label: "人工接管", detail: `${manualLockedCount} 个锁定会话` },
        { key: "safe_send", label: "安全发送", detail: `${pendingSendCount} 个待处理任务` },
      ],
    };
  }

  async processChannelInboundTest(
    channel: WechatChannelKey,
    payload: {
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
      text?: string;
      externalId?: string;
      assetIds?: string[];
      attachments?: Array<Record<string, unknown>>;
    } & ExpectedIdentityPayload,
  ) {
    if (!["personal_wechat", "work_wechat", "mini_program"].includes(channel)) {
      throw new BadRequestException(`unsupported wechat channel: ${channel}`);
    }
    const conversations = this.localStore.listConversations(payload.wechatAccountId);
    const fallbackConversation = payload.conversationId
      ? conversations.find((conversation: any) => conversation.id === payload.conversationId)
      : conversations[0];
    if (!fallbackConversation) {
      throw new BadRequestException("wechat channel inbound test requires at least one local conversation");
    }
    this.assertDemoConversationIdentity(fallbackConversation, payload, "channel inbound test");
    const normalized = {
      wechatAccountId: payload.wechatAccountId || fallbackConversation.wechatAccountId,
      conversationId: payload.conversationId || fallbackConversation.id,
      customerId: payload.customerId || fallbackConversation.customerId,
      text: String(payload.text || "来自微信接入中心的入站演练消息").trim(),
      externalId: payload.externalId || `${channel}-inbound-test-${Date.now()}`,
      assetIds: payload.assetIds || [],
      attachments: payload.attachments || [],
    };
    const result = await this.processInboundMessage(normalized);
    return {
      channel,
      normalized,
      result,
    };
  }

  getBridgeStatus(filter: IdentityFilter = {}) {
    if (!appConfig.useLocalStore) return this.getPrismaBridgeStatus(filter);
    const outbox = this.listBridgeOutbox(filter) as any;
    const inboxPending = this.sendAdapter.listBridgeInbox().filter((entry) => this.matchesBridgeEntryIdentity(entry, null, filter)).map((entry) => this.buildBridgeInboxListItem(entry));
    const dispatchPending = this.sendAdapter.listBridgeDispatch().filter((entry) => this.matchesBridgeEntryIdentity(entry, null, filter)).map((entry) => this.buildBridgeDispatchListItem(entry));
    const locks = this.sendAdapter.listBridgeLocks().filter((lock) => !filter.wechatAccountId || String(lock.accountId || "") === String(filter.wechatAccountId));
    return {
      adapter: this.getSendAdapter("windows_bridge"),
      worker: sanitizeBridgeWorkerStatus(this.sendAdapter.getBridgeWorkerStatus()),
      outbox: { pendingCount: outbox.pending.length, ignoredCount: outbox.ignored.length, pending: outbox.pending },
      inbox: { pendingCount: inboxPending.length, pending: inboxPending },
      dispatch: { pendingCount: dispatchPending.length, staleCount: dispatchPending.filter((entry) => this.isBridgeDispatchEntryStale(entry)).length, pending: dispatchPending },
      locks: { activeCount: locks.length, staleCount: locks.filter((lock) => lock.stale).length, active: locks.map(sanitizeBridgeLockItem) },
    };
  }

  private async getPrismaBridgeStatus(filter: IdentityFilter = {}) {
    const outbox = await this.listBridgeOutbox(filter);
    const inboxPending = this.sendAdapter
      .listBridgeInbox()
      .filter((entry) => this.matchesBridgeEntryIdentity(entry, null, filter))
      .map((entry) => this.buildBridgeInboxListItem(entry));
    const dispatchPending = this.sendAdapter
      .listBridgeDispatch()
      .filter((entry) => this.matchesBridgeEntryIdentity(entry, null, filter))
      .map((entry) => this.buildBridgeDispatchListItem(entry));
    const staleDispatchCount = dispatchPending.filter((entry) => this.isBridgeDispatchEntryStale(entry)).length;
    const locks = this.sendAdapter
      .listBridgeLocks()
      .filter((lock) => !filter.wechatAccountId || String(lock.accountId || "") === String(filter.wechatAccountId));
    const worker = this.sendAdapter.getBridgeWorkerStatus();

    return {
      adapter: this.getSendAdapter("windows_bridge"),
      worker: sanitizeBridgeWorkerStatus(worker),
      outbox: {
        pendingCount: outbox.pending.length,
        ignoredCount: outbox.ignored.length,
        pending: outbox.pending,
      },
      inbox: {
        pendingCount: inboxPending.length,
        pending: inboxPending,
      },
      dispatch: {
        pendingCount: dispatchPending.length,
        staleCount: staleDispatchCount,
        pending: dispatchPending,
      },
      locks: {
        activeCount: locks.length,
        staleCount: locks.filter((lock) => lock.stale).length,
        active: locks.map(sanitizeBridgeLockItem),
      },
    };
  }

  listBridgeDispatch(filter: IdentityFilter = {}) {
    const pending = this.sendAdapter
      .listBridgeDispatch()
      .filter((entry) => this.matchesBridgeEntryIdentity(entry, null, filter))
      .map((entry) => this.buildBridgeDispatchListItem(entry));
    return {
      staleCount: pending.filter((entry) => this.isBridgeDispatchEntryStale(entry)).length,
      pending,
    };
  }

  listBridgeOutbox(filter: IdentityFilter = {}) {
    if (!appConfig.useLocalStore) return this.listPrismaBridgeOutbox(filter);
    const pending: any[] = [];
    const ignored: any[] = [];
    for (const entry of this.sendAdapter.listBridgeOutbox()) {
      const task = entry.taskId ? this.localStore.getSendTask(entry.taskId) : null;
      const attempt = entry.taskId ? this.localStore.getLatestSendAttempt(entry.taskId, { adapter: "windows_bridge", status: "started" }) : null;
      if (!this.matchesBridgeEntryIdentity(entry, task, filter)) continue;
      const item = this.buildBridgeOutboxListItem(entry, task, attempt);
      const deliveryRetryBlocked =
        task?.guardSnapshot?.automaticRetryBlocked === true ||
        task?.guardSnapshot?.deliveryState === "unknown";
      if (!entry.errorMessage && task?.status === "sending" && attempt && !deliveryRetryBlocked) pending.push(item);
      else {
        ignored.push({
          ...item,
          ignoreReason: entry.errorMessage || (!task
            ? "task_not_found"
            : task.status !== "sending"
              ? "task_not_sending"
              : deliveryRetryBlocked
                ? "delivery_unknown_retry_blocked"
                : "pending_bridge_attempt_missing"),
        });
      }
    }
    return { pending, ignored };
  }

  private async listPrismaBridgeOutbox(filter: IdentityFilter = {}) {
    const entries = this.sendAdapter.listBridgeOutbox();
    const pending: any[] = [];
    const ignored: any[] = [];

    for (const entry of entries) {
      const task = entry.taskId ? await this.persistence.getSendTask(entry.taskId) : null;
      const attempt = entry.taskId
        ? await this.persistence.getLatestSendAttempt(entry.taskId, { adapter: "windows_bridge", status: "started" })
        : null;
      if (!this.matchesBridgeEntryIdentity(entry, task, filter)) continue;
      const item = this.buildBridgeOutboxListItem(entry, task, attempt);
      const deliveryRetryBlocked =
        task?.guardSnapshot?.automaticRetryBlocked === true ||
        task?.guardSnapshot?.deliveryState === "unknown";
      if (!entry.errorMessage && task?.status === "sending" && attempt && !deliveryRetryBlocked) pending.push(item);
      else {
        ignored.push({
          ...item,
          ignoreReason: entry.errorMessage || (!task
            ? "task_not_found"
            : task.status !== "sending"
              ? "task_not_sending"
              : deliveryRetryBlocked
                ? "delivery_unknown_retry_blocked"
                : "pending_bridge_attempt_missing"),
        });
      }
    }

    return {
      pending,
      ignored,
    };
  }

  private matchesBridgeEntryIdentity(entry: any, task: any, filter: IdentityFilter = {}) {
    const expectedWechatAccountId = String(filter.wechatAccountId || "").trim();
    const expectedConversationId = String(filter.conversationId || "").trim();
    const expectedCustomerId = String(filter.customerId || "").trim();
    if (!expectedWechatAccountId && !expectedConversationId && !expectedCustomerId) return true;
    const conversation = task?.conversation || null;
    const actualWechatAccountId = String(task?.wechatAccountId || entry?.wechatAccountId || "");
    const actualConversationId = String(task?.conversationId || entry?.conversationId || "");
    const actualCustomerId = String(conversation?.customerId || task?.designJob?.customerId || task?.quoteDraft?.customerId || "");
    if (expectedWechatAccountId && actualWechatAccountId !== expectedWechatAccountId) return false;
    if (expectedConversationId && actualConversationId !== expectedConversationId) return false;
    if (expectedCustomerId && actualCustomerId !== expectedCustomerId) return false;
    return true;
  }

  private buildBridgeOutboxListItem(entry: any, task: any, attempt: any) {
    return {
      fileName: entry.fileName,
      taskId: entry.taskId,
      wechatAccountId: entry.wechatAccountId,
      conversationId: entry.conversationId,
      customerId: task?.conversation?.customerId || entry?.customerId || entry?.data?.target?.customerId || "",
      payloadKind: entry.payloadKind,
      actionCount: entry.actionCount,
      createdAt: entry.createdAt,
      modifiedAt: entry.modifiedAt,
      ageSeconds: entry.ageSeconds,
      errorMessage: entry.errorMessage,
      taskStatus: task?.status || null,
      attemptId: attempt?.id || null,
      preview: this.buildBridgeOutboxPreview(entry, task, attempt),
    };
  }

  private buildBridgeOutboxPreview(entry: any, task: any, attempt: any) {
    const data = entry?.data || {};
    const sendPlan = data.sendPlan || {};
    const target = data.target || sendPlan.target || {};
    const actions = Array.isArray(sendPlan.actions) ? sendPlan.actions : [];
    const textActions = actions.filter((action: any) => String(action?.type || "") === "text");
    const imageActions = actions.filter((action: any) => String(action?.type || "") === "image");
    const text = textActions.map((action: any) => String(action?.text || "").trim()).filter(Boolean).join("\n");
    const context = data.context || {};
    const constraints = sendPlan.constraints && typeof sendPlan.constraints === "object" ? sendPlan.constraints : {};

    return {
      protocolVersion: String(data.version || ""),
      outboxFileName: entry?.fileName || "",
      attemptId: attempt?.id || "",
      wechatAccountId: entry?.wechatAccountId || task?.wechatAccountId || target.wechatAccountId || "",
      conversationId: entry?.conversationId || task?.conversationId || target.conversationId || "",
      customerId: task?.conversation?.customerId || target.customerId || "",
      payloadKind: entry?.payloadKind || sendPlan.kind || task?.payload?.kind || "",
      actionCount: Number.isFinite(Number(entry?.actionCount)) ? Number(entry.actionCount) : actions.length,
      textActionCount: textActions.length,
      imageActionCount: imageActions.length,
      textLength: text.length,
      windowSnapshotId: context.windowSnapshotId || target.windowSnapshotId || attempt?.windowSnapshotId || "",
      guardStatus: context.guardStatus || attempt?.guardStatus || "",
      constraints,
      createdAt: data.createdAt || entry?.createdAt || "",
    };
  }

  private buildBridgeInboxListItem(entry: any, extras: Record<string, unknown> = {}) {
    const data = isPlainObject(entry?.data) ? entry.data : {};
    const metadata = isPlainObject(data.metadata) ? data.metadata : {};
    return {
      fileName: entry?.fileName || "",
      taskId: String(data.taskId || data.sendTaskId || entry?.taskId || ""),
      attemptId: String(data.attemptId || ""),
      wechatAccountId: String(data.wechatAccountId || entry?.wechatAccountId || ""),
      conversationId: String(data.conversationId || entry?.conversationId || ""),
      status: String(data.status || ""),
      protocolVersion: String(data.version || data.protocolVersion || ""),
      outboxFileName: bridgeFileName(data.outboxFileName || data.outboxFile || metadata.outboxFileName || metadata.outboxFile),
      payloadKind: entry?.payloadKind || "",
      actionCount: entry?.actionCount,
      createdAt: entry?.createdAt,
      modifiedAt: entry?.modifiedAt,
      ageSeconds: entry?.ageSeconds,
      hasAckToken: typeof data.ackToken === "string" && data.ackToken.length > 0,
      errorMessage: entry?.errorMessage || "",
      ...extras,
    };
  }

  private buildBridgeDispatchListItem(entry: any) {
    const data = isPlainObject(entry?.data) ? entry.data : {};
    const sendPlan = isPlainObject(data.sendPlan) ? data.sendPlan : {};
    const ack = isPlainObject(data.ack) ? data.ack : {};
    const preflight = isPlainObject(data.preflight) ? data.preflight : {};
    return {
      fileName: entry?.fileName || "",
      taskId: String(data.taskId || entry?.taskId || ""),
      attemptId: String(data.attemptId || ""),
      wechatAccountId: String(data.wechatAccountId || entry?.wechatAccountId || ""),
      conversationId: String(data.conversationId || entry?.conversationId || ""),
      protocolVersion: String(data.version || ""),
      payloadKind: String(sendPlan.kind || entry?.payloadKind || ""),
      actionCount: Number.isFinite(Number(sendPlan.actionCount || entry?.actionCount)) ? Number(sendPlan.actionCount || entry.actionCount) : undefined,
      outboxFileName: bridgeFileName(data.sourceOutboxFileName || ack.requiredOutboxFileName),
      ackFileNameHint: bridgeFileName(ack.fileNameHint),
      failedAckFileNameHint: bridgeFileName(ack.failedFileNameHint),
      preflight: {
        requiredBeforeSend: Array.isArray(preflight.requiredBeforeSend) ? preflight.requiredBeforeSend.map(String) : [],
        expectedWechatAccountId: typeof preflight.expectedWechatAccountId === "string" ? preflight.expectedWechatAccountId : "",
        expectedConversationId: typeof preflight.expectedConversationId === "string" ? preflight.expectedConversationId : "",
        expectedConversationTitle: typeof preflight.expectedConversationTitle === "string" ? preflight.expectedConversationTitle : "",
        expectedCustomerId: typeof preflight.expectedCustomerId === "string" ? preflight.expectedCustomerId : "",
        expectedCustomerName: typeof preflight.expectedCustomerName === "string" ? preflight.expectedCustomerName : "",
        expectedWindowSnapshotId: typeof preflight.expectedWindowSnapshotId === "string" ? preflight.expectedWindowSnapshotId : null,
        rejectIfAnyCheckFails: preflight.rejectIfAnyCheckFails === true,
        rejectIfWindowChanged: preflight.rejectIfWindowChanged === true,
        rejectIfExpired: preflight.rejectIfExpired === true,
        rejectIfOutboxMissing: preflight.rejectIfOutboxMissing === true,
      },
      createdAt: entry?.createdAt,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
      modifiedAt: entry?.modifiedAt,
      ageSeconds: entry?.ageSeconds,
      expired: this.isBridgeDispatchEntryStale({
        expiresAt: data.expiresAt,
        ageSeconds: entry?.ageSeconds,
      }),
      errorMessage: entry?.errorMessage,
    };
  }

  private isBridgeDispatchEntryStale(entry: any) {
    const expiresAt = Date.parse(String(entry?.expiresAt || ""));
    if (Number.isFinite(expiresAt)) return Date.now() > expiresAt;
    return Number(entry?.ageSeconds || 0) > appConfig.sendBridgeAckTimeoutMinutes * 60;
  }

  scanBridgeInbox() {
    if (!appConfig.useLocalStore) return this.scanPrismaBridgeInbox();
    const entries = this.sendAdapter.listBridgeInbox();
    const processed: any[] = [];
    const failed: any[] = [];

    for (const entry of entries) {
      const data = entry.data || {};
      const taskId = String(data.taskId || data.sendTaskId || entry.taskId || "");
      const status = String(data.status || "");
      if (!taskId || !["sent", "failed"].includes(status)) {
        const errorMessage = entry.errorMessage || "bridge inbox ack must include taskId and status sent/failed";
        failed.push(this.buildBridgeInboxListItem(entry, { errorMessage }));
        this.sendAdapter.moveBridgeInboxFile(entry.filePath, "failed");
        continue;
      }

      const ackPayload = {
          status: status as "sent" | "failed",
          version: typeof data.version === "string" ? data.version : undefined,
          protocolVersion: typeof data.protocolVersion === "string" ? data.protocolVersion : undefined,
          ackToken: typeof data.ackToken === "string" ? data.ackToken : undefined,
          bridgeAckToken: typeof data.bridgeAckToken === "string" ? data.bridgeAckToken : undefined,
          taskId: typeof data.taskId === "string" ? data.taskId : typeof data.sendTaskId === "string" ? data.sendTaskId : undefined,
          attemptId: typeof data.attemptId === "string" ? data.attemptId : undefined,
          wechatAccountId: typeof data.wechatAccountId === "string" ? data.wechatAccountId : undefined,
          conversationId: typeof data.conversationId === "string" ? data.conversationId : undefined,
          customerId: typeof data.customerId === "string" ? data.customerId : undefined,
          outboxFileName: typeof data.outboxFileName === "string" ? data.outboxFileName : undefined,
          outboxFile: typeof data.outboxFile === "string" ? data.outboxFile : undefined,
          errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
          metadata: {
            ...(isPlainObject(data.metadata) ? data.metadata : {}),
            source: "bridge_inbox",
            fileName: entry.fileName,
          },
          sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined,
        };

      try {
        const result = this.acknowledgeBridgeSend(taskId, ackPayload) as any;
        const archivedPath = this.sendAdapter.moveBridgeInboxFile(entry.filePath, "processed");
        processed.push(this.buildBridgeInboxListItem(entry, {
          archivedPath,
          result: {
            taskId: result?.task?.id || "",
            taskStatus: result?.task?.status || "",
            attemptId: result?.attempt?.id || "",
            attemptStatus: result?.attempt?.status || "",
          },
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown bridge inbox error";
        const recovery = this.failTaskForRejectedTrustedBridgeAck(taskId, ackPayload, entry, errorMessage);
        const archivedPath = this.sendAdapter.moveBridgeInboxFile(entry.filePath, "failed");
        failed.push(this.buildBridgeInboxListItem(entry, {
          archivedPath,
          errorMessage,
          result: recovery
            ? {
                taskId: recovery.task?.id || "",
                taskStatus: recovery.task?.status || "",
                attemptId: recovery.attempt?.id || "",
                attemptStatus: recovery.attempt?.status || "",
              }
            : undefined,
        }));
      }
    }

    return {
      scanned: entries.length,
      processed,
      failed,
    };
  }

  private async scanPrismaBridgeInbox() {
    const entries = this.sendAdapter.listBridgeInbox();
    const processed: any[] = [];
    const failed: any[] = [];
    for (const entry of entries) {
      const data = entry.data || {};
      const taskId = String(data.taskId || data.sendTaskId || entry.taskId || "");
      const status = String(data.status || "");
      if (!taskId || !["sent", "failed"].includes(status)) {
        const errorMessage = entry.errorMessage || "bridge inbox ack must include taskId and status sent/failed";
        failed.push(this.buildBridgeInboxListItem(entry, { errorMessage }));
        this.sendAdapter.moveBridgeInboxFile(entry.filePath, "failed");
        continue;
      }
      const ackPayload = {
        status: status as "sent" | "failed",
        version: typeof data.version === "string" ? data.version : undefined,
        protocolVersion: typeof data.protocolVersion === "string" ? data.protocolVersion : undefined,
        ackToken: typeof data.ackToken === "string" ? data.ackToken : undefined,
        bridgeAckToken: typeof data.bridgeAckToken === "string" ? data.bridgeAckToken : undefined,
        taskId: typeof data.taskId === "string" ? data.taskId : typeof data.sendTaskId === "string" ? data.sendTaskId : undefined,
        attemptId: typeof data.attemptId === "string" ? data.attemptId : undefined,
        wechatAccountId: typeof data.wechatAccountId === "string" ? data.wechatAccountId : undefined,
        conversationId: typeof data.conversationId === "string" ? data.conversationId : undefined,
        customerId: typeof data.customerId === "string" ? data.customerId : undefined,
        outboxFileName: typeof data.outboxFileName === "string" ? data.outboxFileName : undefined,
        outboxFile: typeof data.outboxFile === "string" ? data.outboxFile : undefined,
        errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
        metadata: { ...(isPlainObject(data.metadata) ? data.metadata : {}), source: "bridge_inbox", fileName: entry.fileName },
        sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined,
      };
      try {
        const result = await this.acknowledgePrismaBridgeSend(taskId, ackPayload);
        const archivedPath = this.sendAdapter.moveBridgeInboxFile(entry.filePath, "processed");
        processed.push(this.buildBridgeInboxListItem(entry, {
          archivedPath,
          result: { taskId: result.task?.id || "", taskStatus: result.task?.status || "", attemptId: result.attempt?.id || "", attemptStatus: result.attempt?.status || "" },
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown bridge inbox error";
        const archivedPath = this.sendAdapter.moveBridgeInboxFile(entry.filePath, "failed");
        failed.push(this.buildBridgeInboxListItem(entry, { archivedPath, errorMessage }));
      }
    }
    return { scanned: entries.length, processed, failed };
  }

  async scanSendOperations(filter: IdentityFilter = {}) {
    if (!appConfig.useLocalStore) return this.scanPrismaSendOperations(filter);
    const now = new Date();
    const tasks = this.localStore.listSendTasks(filter);
    const bridgeTimedOut: any[] = [];
    const bridgeOutboxBroken: any[] = [];
    const bridgeDispatchExpired: any[] = [];
    const wechatWorkDeliveryUnknown: any[] = [];
    const autoRetriedLowValue: any[] = [];
    const alerted: any[] = [];
    const staleQueued: any[] = [];

    for (const task of tasks) {
      if (task.status === "sending") {
        const pendingAttempt = this.localStore.getLatestSendAttempt(task.id, { status: "started" });
        if (pendingAttempt?.adapter === "wechat_work_kf") {
          if (!isOlderThan(
            pendingAttempt.startedAt || pendingAttempt.createdAt,
            now,
            appConfig.sendBridgeAckTimeoutMinutes,
          )) continue;
          const reason = `Enterprise WeChat send attempt exceeded ${appConfig.sendBridgeAckTimeoutMinutes} minutes; delivery is unknown and automatic retry is disabled`;
          const recoveredAt = now.toISOString();
          const alreadyProtected = this.hasUnknownSendDelivery(task, pendingAttempt);
          if (alreadyProtected) {
            wechatWorkDeliveryUnknown.push(task);
            continue;
          }
          const attempt = this.localStore.updateSendAttempt(pendingAttempt.id, {
            status: "started",
            errorMessage: reason,
            completedAt: null,
            metadata: {
              ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
              bridgeState: "delivery_unknown",
              deliveryState: "unknown",
              failureStage: "stale_started_recovery",
              automaticRetryBlocked: true,
              manualReviewRequired: true,
              recoveredAt,
            },
          });
          const protectedTask = this.localStore.updateSendTask(task.id, {
            status: "sending",
            sentAt: null,
            errorMessage: reason,
            guardSnapshot: {
              ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
              status: "sending",
              deliveryState: "unknown",
              wechatWorkDeliveryState: "unknown",
              automaticRetryBlocked: true,
              manualReviewRequired: true,
              staleStartedRecoveredAt: task.guardSnapshot?.staleStartedRecoveredAt || recoveredAt,
            },
          });
          this.localStore.recordWechatWorkAudit({
            action: "send_delivery_unknown",
            status: "unknown",
            sendTaskId: task.id,
            sendAttemptId: attempt.id,
            errorMessage: reason,
            deliveryState: "unknown",
            failureStage: "stale_started_recovery",
            automaticRetryBlocked: true,
          });
          await this.notifications.create("warning", "Enterprise WeChat delivery is unknown", reason, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
          });
          alerted.push(protectedTask);
          wechatWorkDeliveryUnknown.push(protectedTask);
          continue;
        }
        const outboxState = this.inspectPendingBridgeOutbox(task);
        if (!outboxState.ok) {
          const reason = `Windows 桥接待发送文件不可用：${outboxState.reason}`;
          const protectedTask = this.markBridgeDeliveryUnknown(task, "bridge_outbox_unavailable", reason, {
            outboxFileName: outboxState.fileName || undefined,
          });
          bridgeOutboxBroken.push(protectedTask);
          if (task.guardSnapshot?.deliveryUnknownReason !== "bridge_outbox_unavailable") await this.notifications.create("error", "微信桥接待发送文件异常", `${task.conversation?.title || task.conversationId} 的发送结果未知，任务保持发送中并禁止重排；请先人工核查微信窗口。`, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
            reason,
          });
          continue;
        }
        const pendingBridgeAttempt = this.localStore.getLatestSendAttempt(task.id, {
          adapter: "windows_bridge",
          status: "started",
        });
        const dispatchState = pendingBridgeAttempt
          ? this.findPendingBridgeDispatchForTask(task, pendingBridgeAttempt)
          : null;
        if (dispatchState?.expired) {
          const reason = `Windows 桥接发送指令已过期：${dispatchState.expiresAt || dispatchState.fileName || "unknown"}`;
          const protectedTask = this.markBridgeDeliveryUnknown(task, "bridge_dispatch_expired", reason, {
            dispatchFileName: dispatchState.fileName || undefined,
            expiresAt: dispatchState.expiresAt || undefined,
          });
          bridgeDispatchExpired.push(protectedTask);
          if (task.guardSnapshot?.deliveryUnknownReason !== "bridge_dispatch_expired") await this.notifications.create("warning", "微信桥接发送指令过期", `${task.conversation?.title || task.conversationId} 的发送结果未知，任务保持发送中并禁止重排；请先人工核查微信窗口。`, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
            dispatchFileName: dispatchState.fileName,
            expiresAt: dispatchState.expiresAt,
          });
          continue;
        }
      }

      if (task.status === "sending" && this.isBridgeAckTimedOut(task, now)) {
        const reason = `Windows 桥接回执超过 ${appConfig.sendBridgeAckTimeoutMinutes} 分钟未返回`;
        const protectedTask = this.markBridgeDeliveryUnknown(task, "bridge_ack_timeout", reason);
        bridgeTimedOut.push(protectedTask);
        if (task.guardSnapshot?.deliveryUnknownReason !== "bridge_ack_timeout") await this.notifications.create("warning", "微信桥接回执超时", `${task.conversation?.title || task.conversationId} 的发送结果未知，任务保持发送中并禁止重排；请先人工核查微信窗口。`, {
          sendTaskId: task.id,
          wechatAccountId: task.wechatAccountId,
          conversationId: task.conversationId,
        });
        continue;
      }

      if (task.status === "queued" && isOlderThan(task.queuedAt || task.createdAt, now, appConfig.sendQueueStaleMinutes)) {
        staleQueued.push(task);
        if (task.guardSnapshot?.opsAlertedStatus !== "queued_stale") {
          this.localStore.updateSendTask(task.id, {
            guardSnapshot: {
              ...(task.guardSnapshot || {}),
              opsAlertedStatus: "queued_stale",
              opsAlertedAt: now.toISOString(),
            },
          });
          await this.notifications.create("warning", "发送任务排队过久", `${task.conversation?.title || task.conversationId} 的发送任务排队超过 ${appConfig.sendQueueStaleMinutes} 分钟。`, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
          });
          alerted.push(task);
        }
      }

      if (task.status === "failed" && isLowValueAutomationTask(task)) {
        const retryCount = Number(task.guardSnapshot?.lowValueAutoRetryCount || 0);
        if (Number.isFinite(retryCount) && retryCount < 1) {
          const reason = task.errorMessage
            ? `低价值自动发送失败后自动重试：${task.errorMessage}`
            : "低价值自动发送失败后自动重试";
          try {
            const requeued = await this.requeueSendTask(task.id, {
              expectedWechatAccountId: task.wechatAccountId,
              expectedConversationId: task.conversationId,
              expectedCustomerId: task.conversation?.customerId || task.customerId,
              reason,
            });
            const updated = this.localStore.updateSendTask(requeued.id, {
              guardSnapshot: {
                ...(requeued.guardSnapshot || {}),
                lowValueAutoRetryCount: retryCount + 1,
                lowValueAutoRetriedAt: now.toISOString(),
                lowValueAutoRetryReason: reason,
                opsAlertedStatus: "auto_retried",
                opsAlertedAt: now.toISOString(),
              },
            });
            autoRetriedLowValue.push(updated);
            await this.notifications.create("warning", "低价值自动发送已重试", reason, {
              sendTaskId: task.id,
              wechatAccountId: task.wechatAccountId,
              conversationId: task.conversationId,
              customerId: task.conversation?.customerId || task.customerId,
            });
            continue;
          } catch (error) {
            const retryError = error instanceof Error ? error.message : String(error);
            const updated = this.localStore.updateSendTask(task.id, {
              guardSnapshot: {
                ...(task.guardSnapshot || {}),
                lowValueAutoRetryError: retryError,
                lowValueAutoRetryErrorAt: now.toISOString(),
                opsAlertedStatus: task.status,
                opsAlertedAt: now.toISOString(),
              },
            });
            await this.notifications.create(
              "error",
              "低价值自动发送重试失败",
              retryError || task.errorMessage || "自动重试前的发送任务绑定校验失败，需要人工处理。",
              {
                sendTaskId: task.id,
                wechatAccountId: task.wechatAccountId,
                conversationId: task.conversationId,
                customerId: task.conversation?.customerId || task.customerId,
              },
            );
            alerted.push(updated);
            continue;
          }
        }
      }

      if (["blocked", "failed"].includes(task.status) && task.guardSnapshot?.opsAlertedStatus !== task.status) {
        const blockedByRoutingPolicy = Boolean(task.guardSnapshot?.blockedByRoutingPolicy);
        const routingPolicy = isPlainObject(task.guardSnapshot?.routingPolicy) ? task.guardSnapshot.routingPolicy : null;
        const routingPolicyLane = String(task.guardSnapshot?.routingPolicyLane || routingPolicy?.lane || "");
        this.localStore.updateSendTask(task.id, {
          guardSnapshot: {
            ...(task.guardSnapshot || {}),
            opsAlertedStatus: task.status,
            opsAlertedAt: now.toISOString(),
          },
        });
        await this.notifications.create(
          task.status === "failed" ? "error" : "warning",
          blockedByRoutingPolicy
            ? "路由策略转人工处理"
            : task.status === "failed"
              ? "发送任务失败"
              : "发送任务被安全拦截",
          blockedByRoutingPolicy
            ? `${task.conversation?.title || task.conversationId} 的发送任务被路由策略拦截，请人工核对客户价值、场景和下一步话术。`
            : task.errorMessage || "需要客服检查微信窗口、客户会话或桥接状态。",
          {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
            customerId: task.conversation?.customerId || task.customerId,
            ...(blockedByRoutingPolicy
              ? {
                  reason: task.guardSnapshot?.reason,
                  routingPolicyLane,
                  routingPolicy,
                  blockedByRoutingPolicy: true,
                }
              : {}),
          },
        );
        alerted.push(task);
      }
    }

    return {
      scanned: tasks.length,
      bridgeTimedOut: bridgeTimedOut.length,
      bridgeOutboxBroken: bridgeOutboxBroken.length,
      bridgeDispatchExpired: bridgeDispatchExpired.length,
      wechatWorkDeliveryUnknown: wechatWorkDeliveryUnknown.length,
      autoRetriedLowValue: autoRetriedLowValue.length,
      staleQueued: staleQueued.length,
      alerted: alerted.length,
      tasks: {
        bridgeTimedOut,
        bridgeOutboxBroken,
        bridgeDispatchExpired,
        wechatWorkDeliveryUnknown,
        autoRetriedLowValue,
        staleQueued,
        alerted,
      },
    };
  }

  async processSafeSendQueue(params: { adapter?: string; limit?: number; automationOnly?: boolean } & IdentityFilter = {}) {
    if (!appConfig.useLocalStore) return this.processPrismaSafeSendQueue(params);
    const limit = Math.max(1, Math.min(Number(params.limit || 20), 100));
    const queued = this.localStore
      .listSendTasks({
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        customerId: params.customerId,
      })
      .filter((task) => task.status === "queued")
      .filter((task) => !params.automationOnly || isLowValueAutomationTask(task))
      .sort((a, b) => String(a.queuedAt || a.createdAt).localeCompare(String(b.queuedAt || b.createdAt)));
    const seenAccounts = new Set<string>();
    const processed: any[] = [];
    const blocked: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];

    for (const task of queued) {
      if (processed.length + blocked.length + failed.length >= limit) break;
      const freshTask = this.localStore.getSendTask(task.id);
      if (!freshTask || freshTask.status !== "queued") {
        const advice = buildSendQueueSkipAdvice({
          reason: "task_no_longer_queued",
          task,
        });
        skipped.push({
          sendTaskId: task.id,
          wechatAccountId: task.wechatAccountId,
          reason: "task_no_longer_queued",
          advice,
        });
        continue;
      }

      if (isHighValueLowValueAutomationTask(freshTask)) {
        const blockedTask = this.blockSendTask(freshTask.id, "低价值自动化发送任务已达到高价值线，已转人工确认。", {
          failedKeys: ["manualReviewRequired"],
          blockedByHighValueReview: true,
          blockedAt: new Date().toISOString(),
        });
        blocked.push({
          task: blockedTask,
          reason: "manual_review_required",
        });
        continue;
      }

      if (freshTask.conversation?.manualLocked && !isManualReplySendTask(freshTask)) {
        const advice = buildSendQueueSkipAdvice({
          reason: "conversation_manual_locked",
          task: freshTask,
        });
        const blockedTask = this.blockSendTask(freshTask.id, "会话已人工接管，自动发送暂停", {
          failedKeys: ["conversationManualUnlocked", "conversationManualLocked"],
          queueBlockedAdvice: advice,
          blockedByManualLock: true,
          blockedAt: new Date().toISOString(),
        });
        blocked.push({
          task: blockedTask,
          reason: "conversation_manual_locked",
          advice,
        });
        continue;
      }

      if (seenAccounts.has(freshTask.wechatAccountId)) {
        const advice = buildSendQueueSkipAdvice({
          reason: "same_account_already_processed_this_cycle",
          task: freshTask,
        });
        skipped.push({
          sendTaskId: freshTask.id,
          wechatAccountId: freshTask.wechatAccountId,
          reason: "same_account_already_processed_this_cycle",
          advice,
        });
        continue;
      }
      seenAccounts.add(freshTask.wechatAccountId);

      const accountQueueHeadId = this.localStore.listAccountQueueTaskIds(freshTask.wechatAccountId)[0];
      if (accountQueueHeadId !== freshTask.id) {
        const queueHeadTask = accountQueueHeadId ? this.localStore.getSendTask(accountQueueHeadId) : null;
        const advice = buildSendQueueSkipAdvice({
          reason: "not_account_queue_head",
          task: freshTask,
          queueHeadTask,
        });
        await this.alertLowValueQueueBlocked(freshTask, queueHeadTask, advice);
        skipped.push({
          sendTaskId: freshTask.id,
          wechatAccountId: freshTask.wechatAccountId,
          reason: "not_account_queue_head",
          queueHeadId: accountQueueHeadId || null,
          advice,
        });
        continue;
      }

      const nextRetryAt = String(freshTask.guardSnapshot?.wechatWorkNextRetryAt || "");
      if (nextRetryAt && Date.parse(nextRetryAt) > Date.now()) {
        skipped.push({
          sendTaskId: freshTask.id,
          wechatAccountId: freshTask.wechatAccountId,
          reason: "wechat_work_retry_not_due",
          nextRetryAt,
        });
        continue;
      }

      try {
        const result = await this.executeQueuedSend(freshTask.id, { adapter: params.adapter });
        if (result.task.status === "blocked") blocked.push(result);
        else if (result.task.status === "failed" || result.retryScheduled) failed.push(result);
        else processed.push(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        failed.push({
          sendTaskId: freshTask.id,
          wechatAccountId: freshTask.wechatAccountId,
          errorMessage,
        });
        await this.notifications.create("error", "安全发送队列处理失败", errorMessage, {
          sendTaskId: freshTask.id,
          wechatAccountId: freshTask.wechatAccountId,
          conversationId: freshTask.conversationId,
        });
      }
    }

    return {
      scanned: queued.length,
      processed,
      blocked,
      skipped,
      failed,
    };
  }

  private async scanPrismaSendOperations(filter: IdentityFilter = {}) {
    const now = new Date();
    const tasks = await this.persistence.listSendTasks(filter);
    const bridgeTimedOut: any[] = [];
    const bridgeOutboxBroken: any[] = [];
    const bridgeDispatchExpired: any[] = [];
    const wechatWorkDeliveryUnknown: any[] = [];
    const staleQueued: any[] = [];
    const alerted: any[] = [];
    for (const task of tasks) {
      if (task.status === "sending") {
        const pendingAttempt = await this.persistence.getLatestSendAttempt(task.id, { status: "started" });
        if (!pendingAttempt) continue;
        if (pendingAttempt.adapter === "wechat_work_kf") {
          if (!isOlderThan(
            pendingAttempt.startedAt || pendingAttempt.createdAt,
            now,
            appConfig.sendBridgeAckTimeoutMinutes,
          )) continue;
          const reason = `Enterprise WeChat send attempt exceeded ${appConfig.sendBridgeAckTimeoutMinutes} minutes; delivery is unknown and automatic retry is disabled`;
          const recoveredAt = now.toISOString();
          if (this.hasUnknownSendDelivery(task, pendingAttempt)) {
            wechatWorkDeliveryUnknown.push(task);
            continue;
          }
          const completed = await this.persistence.completeAttemptAndTask({
            taskId: task.id,
            attemptId: pendingAttempt.id,
            expectedTaskStatus: "sending",
            expectedTaskUpdatedAt: task.updatedAt,
            expectedAttemptStatus: "started",
            attemptPatch: {
              status: "started",
              errorMessage: reason,
              completedAt: null,
              metadata: {
                ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
                bridgeState: "delivery_unknown",
                deliveryState: "unknown",
                failureStage: "stale_started_recovery",
                automaticRetryBlocked: true,
                manualReviewRequired: true,
                recoveredAt,
              },
            },
            taskPatch: {
              status: "sending",
              sentAt: null,
              errorMessage: reason,
              guardSnapshot: {
                ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
                status: "sending",
                deliveryState: "unknown",
                wechatWorkDeliveryState: "unknown",
                automaticRetryBlocked: true,
                manualReviewRequired: true,
                staleStartedRecoveredAt: recoveredAt,
              },
            },
          });
          if (!completed) continue;
          await this.persistence.recordWechatWorkAudit({
            action: "send_delivery_unknown",
            status: "unknown",
            sendTaskId: task.id,
            sendAttemptId: pendingAttempt.id,
            errorMessage: reason,
            deliveryState: "unknown",
            failureStage: "stale_started_recovery",
            automaticRetryBlocked: true,
          }).catch(() => null);
          await this.notifications.create("warning", "企业微信发送结果未知", reason, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
          });
          wechatWorkDeliveryUnknown.push(completed.task);
          alerted.push(completed.task);
          continue;
        }
        if (pendingAttempt.adapter !== "windows_bridge") continue;
        const outboxState = this.inspectPendingBridgeOutbox(task, pendingAttempt);
        const dispatchState = this.findPendingBridgeDispatchForTask(task, pendingAttempt);
        let recovery: "bridge_outbox_unavailable" | "bridge_dispatch_expired" | "bridge_ack_timeout" | null = null;
        let reason = "";
        if (!outboxState.ok) {
          recovery = "bridge_outbox_unavailable";
          reason = `Windows bridge outbox unavailable: ${outboxState.reason}`;
        } else if (dispatchState?.expired) {
          recovery = "bridge_dispatch_expired";
          reason = `Windows bridge dispatch expired: ${dispatchState.expiresAt || dispatchState.fileName || "unknown"}`;
        } else if (this.isBridgeAckTimedOut(task, now, pendingAttempt)) {
          recovery = "bridge_ack_timeout";
          reason = `Windows bridge ack exceeded ${appConfig.sendBridgeAckTimeoutMinutes} minutes`;
        }
        if (recovery) {
          const protectedResult = await this.markPrismaBridgeDeliveryUnknown(task, pendingAttempt, recovery, reason, {
            source: "send_ops_scan",
          });
          if (!protectedResult) continue;
          if (recovery === "bridge_outbox_unavailable") bridgeOutboxBroken.push(protectedResult.task);
          if (recovery === "bridge_dispatch_expired") bridgeDispatchExpired.push(protectedResult.task);
          if (recovery === "bridge_ack_timeout") bridgeTimedOut.push(protectedResult.task);
          if (protectedResult.changed) await this.notifications.create("warning", "微信发送结果未知", reason, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
          });
          if (protectedResult.changed) alerted.push(protectedResult.task);
          continue;
        }
      }
      if (task.status === "queued" && isOlderThan(task.queuedAt || task.createdAt, now, appConfig.sendQueueStaleMinutes)) {
        staleQueued.push(task);
        if (task.guardSnapshot?.opsAlertedStatus !== "queued_stale") {
          const updated = await this.persistence.updateSendTask(task.id, {
            guardSnapshot: {
              ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
              opsAlertedStatus: "queued_stale",
              opsAlertedAt: now.toISOString(),
            },
          });
          await this.notifications.create("warning", "发送任务排队过久", `发送任务排队超过 ${appConfig.sendQueueStaleMinutes} 分钟。`, {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
          });
          alerted.push(updated);
        }
      }
    }
    return {
      scanned: tasks.length,
      bridgeTimedOut: bridgeTimedOut.length,
      bridgeOutboxBroken: bridgeOutboxBroken.length,
      bridgeDispatchExpired: bridgeDispatchExpired.length,
      wechatWorkDeliveryUnknown: wechatWorkDeliveryUnknown.length,
      autoRetriedLowValue: 0,
      staleQueued: staleQueued.length,
      alerted: alerted.length,
      tasks: { bridgeTimedOut, bridgeOutboxBroken, bridgeDispatchExpired, wechatWorkDeliveryUnknown, autoRetriedLowValue: [], staleQueued, alerted },
    };
  }

  private async processPrismaSafeSendQueue(
    params: { adapter?: string; limit?: number; automationOnly?: boolean } & IdentityFilter = {},
  ) {
    const limit = Math.max(1, Math.min(Number(params.limit || 20), 100));
    const queued = (await this.persistence.listSendTasks(params))
      .filter((task: any) => task.status === "queued")
      .filter((task: any) => !params.automationOnly || isLowValueAutomationTask(task))
      .sort((a: any, b: any) => String(a.queuedAt || a.createdAt).localeCompare(String(b.queuedAt || b.createdAt)));
    const seenAccounts = new Set<string>();
    const processed: any[] = [];
    const blocked: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];
    for (const task of queued) {
      if (processed.length + blocked.length + failed.length >= limit) break;
      const freshTask = await this.persistence.getSendTask(task.id);
      if (!freshTask || freshTask.status !== "queued") {
        skipped.push({ sendTaskId: task.id, reason: "task_no_longer_queued" });
        continue;
      }
      const manualLockBlocksTask = freshTask.conversation?.manualLocked && !isManualReplySendTask(freshTask);
      if (manualLockBlocksTask || isHighValueLowValueAutomationTask(freshTask)) {
        const reason = manualLockBlocksTask
          ? "会话已人工接管，自动发送暂停。"
          : "自动发送任务已达到高价值线，已转人工确认。";
        const updated = await this.persistence.updateSendTask(freshTask.id, {
          status: "blocked",
          errorMessage: reason,
          guardSnapshot: {
            ...(isPlainObject(freshTask.guardSnapshot) ? freshTask.guardSnapshot : {}),
            status: "blocked",
            reason,
            failedKeys: [manualLockBlocksTask ? "conversationManualLocked" : "manualReviewRequired"],
            blockedAt: new Date().toISOString(),
          },
        });
        blocked.push({ task: updated, reason });
        continue;
      }
      const nextRetryAt = String(freshTask.guardSnapshot?.wechatWorkNextRetryAt || "");
      if (nextRetryAt && Date.parse(nextRetryAt) > Date.now()) {
        skipped.push({ sendTaskId: freshTask.id, reason: "wechat_work_retry_not_due", nextRetryAt });
        continue;
      }
      if (seenAccounts.has(freshTask.wechatAccountId)) {
        skipped.push({ sendTaskId: freshTask.id, reason: "same_account_already_processed_this_cycle" });
        continue;
      }
      seenAccounts.add(freshTask.wechatAccountId);
      const queueHeadId = (await this.persistence.listAccountQueueTaskIds(freshTask.wechatAccountId))[0];
      if (queueHeadId !== freshTask.id) {
        skipped.push({ sendTaskId: freshTask.id, reason: "not_account_queue_head", queueHeadId: queueHeadId || null });
        continue;
      }
      try {
        const result = await this.executeQueuedSend(freshTask.id, { adapter: params.adapter });
        if (result.task.status === "blocked") blocked.push(result);
        else processed.push(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        failed.push({ sendTaskId: freshTask.id, wechatAccountId: freshTask.wechatAccountId, errorMessage });
        await this.notifications.create("error", "安全发送队列处理失败", errorMessage, {
          sendTaskId: freshTask.id,
          wechatAccountId: freshTask.wechatAccountId,
          conversationId: freshTask.conversationId,
        });
      }
    }
    return { scanned: queued.length, processed, blocked, skipped, failed };
  }

  createDemoSendTask(
    payload: {
      operationKey: string;
      wechatAccountId?: string;
      conversationId?: string;
      text?: string;
    } & ExpectedIdentityPayload,
  ) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "operationKey");
    const request = { ...(payload || {}), operationKey };
    if (!appConfig.useLocalStore) return this.createPrismaDemoSendTask(request);
    if (!request.conversationId) {
      throw new BadRequestException("conversationId is required for demo send task");
    }
    const conversations = this.localStore.listConversations(request.wechatAccountId);
    const conversation = conversations.find((item) => item.id === request.conversationId);
    if (!conversation) throw new BadRequestException("no local conversation available");
    this.assertDemoConversationIdentity(conversation, request, "demo send task");
    return this.createLocalSendTask({
      operationKey,
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      payload: {
        kind: "text",
        text: payload.text || "这是发送队列安全校验演示消息，不会真的发送到微信。",
      },
      guardSnapshot: {
        requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
        policy: "single-account-serial-queue",
      },
    });
  }

  private assertDemoConversationIdentity(conversation: any, expected: ExpectedIdentityPayload = {}, label = "demo conversation") {
    const missing = [
      !expected.expectedWechatAccountId ? "expectedWechatAccountId" : "",
      !expected.expectedConversationId ? "expectedConversationId" : "",
      !expected.expectedCustomerId ? "expectedCustomerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`${label} requires conversation identity: ${missing.join(", ")}`);
    }
    assertExpectedIdentity({ ...conversation, conversationId: conversation.id }, expected, label);
  }

  private createLocalSendTask(payload: any) {
    const routingPolicyState = this.validateQueuedRoutingPolicySendState(payload);
    if (!routingPolicyState.ok) {
      throw new BadRequestException(routingPolicyState.message);
    }
    try {
      return this.localStore.createSendTask(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "send task create failed";
      if (message.includes("send task binding invalid")) {
        throw new BadRequestException(message);
      }
      throw error;
    }
  }

  private async assertSendTaskBinding(params: {
    wechatAccountId: string;
    conversationId: string;
    customerId?: string | null;
    designJobId?: string | null;
    quoteDraftId?: string | null;
    manualReply?: boolean;
  }, options: { internal?: boolean } = {}) {
    const context = await this.loadSendTaskBindingContext(params);
    const designJobId = params.designJobId || context.quoteDraft?.designJobId || undefined;
    const result = validateSendTaskBinding({
      task: {
        ...params,
        designJobId,
        payload: params.manualReply
          ? {
              source: "manual_reply",
              manualReply: true,
              customerId: params.customerId,
            }
          : {},
        guardSnapshot: params.manualReply ? { manualReply: true } : {},
      },
      conversation: context.conversation,
      designJob: context.designJob,
      quoteDraft: context.quoteDraft,
    });
    if (!result.ok) {
      throw new BadRequestException(`send task binding invalid: ${result.reason}`);
    }
    return {
      ...result,
      designJobId,
    };
  }

  private async loadSendTaskBindingContext(params: {
    conversationId: string;
    designJobId?: string | null;
    quoteDraftId?: string | null;
  }) {
    if (appConfig.useLocalStore) {
      const conversation = this.localStore.listConversations().find((item) => item.id === params.conversationId) || null;
      const quoteDraft = params.quoteDraftId ? this.localStore.getQuoteDraft(params.quoteDraftId) : null;
      const designJobId = params.designJobId || quoteDraft?.designJobId || null;
      const designJob = designJobId ? this.localStore.getDesignJob(designJobId) : null;
      return { conversation, designJob, quoteDraft };
    }

    const prisma = this.prisma as any;
    const conversation = await prisma.conversation.findUnique({ where: { id: params.conversationId } });
    const quoteDraft = params.quoteDraftId
      ? await prisma.quoteDraft.findUnique({ where: { id: params.quoteDraftId } })
      : null;
    const designJobId = params.designJobId || quoteDraft?.designJobId || null;
    const designJob = designJobId ? await prisma.designJob.findUnique({ where: { id: designJobId } }) : null;
    return { conversation, designJob, quoteDraft };
  }

  private async assertConversationCanQueueSend(conversationId: string, options: { allowManualReply?: boolean } = {}) {
    const conversation = appConfig.useLocalStore
      ? this.localStore.listConversations().find((item) => item.id === conversationId)
      : await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new BadRequestException(`conversation not found: ${conversationId}`);
    if (conversation.manualLocked && !options.allowManualReply) {
      throw new BadRequestException("会话已人工接管，解除锁定后才能创建新的发送任务。");
    }
  }

  validateSendTask(id: string, expected: ExpectedIdentityPayload = {}) {
    return this.validateSendTaskWithCurrentWindow(id, expected);
  }

  validateSendTaskWithCurrentWindow(id: string, expected: ExpectedIdentityPayload = {}) {
    if (!appConfig.useLocalStore) return this.validatePrismaSendTask(id, expected);
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(task, expected, "send task");
    const latestWindow = this.localStore.getLatestWechatWindowSnapshot(task.wechatAccountId);
    if (!latestWindow) {
      return this.blockSendTask(id, "没有可用的微信窗口快照", {
        status: "blocked",
        failedKeys: ["windowSnapshotMissing"],
        activeWindow: null,
        windowSnapshotId: null,
        windowDiagnostic: {
          ok: false,
          status: "missing",
          riskLevel: "high",
          reason: "没有可用的微信窗口快照",
          failedKeys: ["windowSnapshotMissing"],
        },
        checks: [
          {
            key: "windowSnapshotMissing",
            label: "缺少微信窗口快照",
            expected: task.wechatAccountId,
            actual: "",
            passed: false,
          },
        ],
      });
    }
    if (latestWindow.diagnostic && latestWindow.diagnostic.ok === false) {
      return this.blockSendTask(id, latestWindow.diagnostic.reason || "微信窗口快照不可用", {
        ...latestWindow.diagnostic,
        activeWindow: latestWindow,
        windowSnapshotId: latestWindow.id,
        windowDiagnostic: latestWindow.diagnostic,
        failedKeys: Array.isArray(latestWindow.diagnostic.failedKeys) ? latestWindow.diagnostic.failedKeys : ["windowDiagnosticFailed"],
      });
    }

    const result = validateSendGuard({
      task,
      account: task.wechatAccount,
      conversation: task.conversation,
      customer: task.conversation?.customer,
      recentMessage: this.localStore.getRecentMessage(task.conversationId),
      activeWindow: latestWindow,
      observerProofToken: currentWechatWindowObserverProofToken(),
      accountQueueTaskIds: this.localStore.listAccountQueueTaskIds(task.wechatAccountId),
      maxWindowSnapshotAgeSeconds: appConfig.wechatWindowSnapshotMaxAgeSeconds,
    });

    return this.localStore.updateSendTask(task.id, {
      status: result.ok ? task.status : "blocked",
      errorMessage: result.ok ? "" : result.reason,
      guardSnapshot: {
        ...(task.guardSnapshot || {}),
        ...result,
        activeWindow: latestWindow,
        windowSnapshotId: latestWindow.id,
        windowDiagnostic: latestWindow.diagnostic || null,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  markSentAfterGuard(id: string, params: { mode?: "correct" | "wrong_chat"; activeWindow?: Record<string, unknown> } = {}) {
    void id;
    void params;
    throw new BadRequestException(
      "Direct mark-sent is disabled. Use /wechat/send-tasks/:id/execute and wait for adapter completion or bridge ack.",
    );
  }

  markSentAfterCurrentWindowGuard(id: string) {
    void id;
    throw new BadRequestException(
      "Direct mark-sent is disabled. Use /wechat/send-tasks/:id/execute and wait for adapter completion or bridge ack.",
    );
  }

  executeDryRunSend(id: string, payload: ExpectedIdentityPayload = {}) {
    return this.executeSend(id, { ...payload, adapter: "dry_run" });
  }

  async executeQueuedSend(id: string, params: { adapter?: string } & ExpectedIdentityPayload = {}) {
    const result = await this.executeSend(id, params);
    if (result.attempt?.adapter !== "wechat_work_kf" || result.task?.status !== "sending") return result;
    return this.completeWechatWorkKfSend(result);
  }

  executeSend(id: string, params: { adapter?: string } & ExpectedIdentityPayload = {}) {
    if (!appConfig.useLocalStore) return this.executePrismaSend(id, params);
    const adapter = this.sendAdapter.describe(params.adapter);
    const taskBeforeValidation = this.localStore.getSendTask(id);
    if (!taskBeforeValidation) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(taskBeforeValidation, params, "send task");
    if (taskBeforeValidation.status !== "queued") {
      throw new BadRequestException(`send task is not queued: ${taskBeforeValidation.status || "unknown"}`);
    }
    const routingPolicyState = this.validateQueuedRoutingPolicySendState(taskBeforeValidation);
    if (!routingPolicyState.ok) {
      const startedAt = new Date().toISOString();
      const blockedTask = this.blockSendTask(id, routingPolicyState.message, {
        failedKeys: [routingPolicyState.reason],
        routingPolicy: routingPolicyState.routingPolicy,
        routingPolicyLane: routingPolicyState.lane,
        routingPolicySendState: routingPolicyState,
        blockedByRoutingPolicy: true,
        blockedAt: startedAt,
      });
      const attempt = this.localStore.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus: routingPolicyState.reason,
        payloadSummary: this.summarizePayload(taskBeforeValidation.payload),
        errorMessage: blockedTask.errorMessage,
        metadata: {
          adapter,
          routingPolicyState,
        },
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return { task: blockedTask, attempt, adapter };
    }
    const orderState = this.validateQueuedOrderSendState(taskBeforeValidation);
    if (!orderState.ok) {
      const startedAt = new Date().toISOString();
      const blockedTask = this.blockSendTask(id, orderState.message, {
        failedKeys: [orderState.reason],
        orderDraftId: orderState.orderDraftId,
        orderSendState: orderState,
        blockedAt: startedAt,
      });
      const attempt = this.localStore.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus: orderState.reason,
        payloadSummary: this.summarizePayload(taskBeforeValidation.payload),
        errorMessage: blockedTask.errorMessage,
        metadata: {
          adapter,
          orderSendState: orderState,
        },
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return { task: blockedTask, attempt, adapter };
    }
    const quoteState = this.validateQueuedQuoteSendState(taskBeforeValidation);
    if (!quoteState.ok) {
      const startedAt = new Date().toISOString();
      const blockedTask = this.blockSendTask(id, quoteState.message, {
        failedKeys: [quoteState.reason],
        quoteDraftId: quoteState.quoteDraftId,
        quoteSendState: quoteState,
        blockedAt: startedAt,
      });
      const attempt = this.localStore.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus: quoteState.reason,
        payloadSummary: this.summarizePayload(taskBeforeValidation.payload),
        errorMessage: blockedTask.errorMessage,
        metadata: {
          adapter,
          quoteSendState: quoteState,
        },
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return { task: blockedTask, attempt, adapter };
    }
    const binding = this.validateExistingSendTaskBinding(taskBeforeValidation);
    if (!binding.ok) {
      const startedAt = new Date().toISOString();
      const blockedTask = this.blockSendTask(id, `send task binding invalid: ${binding.reason}`, {
        ...binding,
        bindingRevalidatedAt: startedAt,
      });
      const attempt = this.localStore.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus: "binding_failed",
        payloadSummary: this.summarizePayload(taskBeforeValidation.payload),
        errorMessage: blockedTask.errorMessage,
        metadata: {
          adapter,
          binding,
        },
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return { task: blockedTask, attempt, adapter };
    }
    const validated = adapter.capabilities.requiresWindowGuard
      ? this.validateSendTaskWithCurrentWindow(id, params)
      : this.validateWechatWorkKfSendTask(id);
    const startedAt = new Date().toISOString();
    const guardStatus = validated.guardSnapshot?.status || "blocked";
    const windowSnapshotId = validated.guardSnapshot?.windowSnapshotId || null;
    const payloadSummary = this.summarizePayload(validated.payload);
    if (guardStatus !== "passed") {
      const attempt = this.localStore.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus,
        windowSnapshotId,
        payloadSummary,
        errorMessage: validated.errorMessage || validated.guardSnapshot?.reason || "send guard blocked",
        metadata: {
          adapter,
          guardSnapshot: validated.guardSnapshot || null,
        },
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return { task: validated, attempt, adapter };
    }

    const claimed = this.localStore.claimQueuedSendTaskAndCreateAttempt({
      taskId: id,
      taskPatch: { status: "sending", errorMessage: "" },
      attempt: {
        sendTaskId: id,
        adapter: adapter.name,
        status: "started",
        guardStatus,
        windowSnapshotId,
        payloadSummary,
        errorMessage: "",
        metadata: {
          adapter,
          guardSnapshot: validated.guardSnapshot || null,
          bridgeState: "adapter_starting",
          deliveryState: "in_flight",
        },
        startedAt,
      },
    });
    if (!claimed) throw new BadRequestException("send task was claimed by another worker");

    let adapterResult: any;
    try {
      adapterResult = this.sendAdapter.execute(
        claimed.task,
        { guardStatus, windowSnapshotId, payloadSummary, attemptId: claimed.attempt.id },
        params.adapter,
      );
    } catch (error) {
      const completedAt = new Date().toISOString();
      const knownNotSent = error instanceof WechatBridgeOutboxError && error.deliveryState === "failed";
      const failureStage = error instanceof WechatBridgeOutboxError ? error.stage : "adapter_execution";
      const errorMessage = error instanceof Error ? error.message : "send adapter failed";
      const deliveryUnknownReason = knownNotSent ? null : "adapter_execution_exception";
      const taskPatch = knownNotSent
        ? {
            status: "failed",
            sentAt: null,
            errorMessage,
            guardSnapshot: this.settledDeliveryGuard(claimed.task, "failed", completedAt, failureStage),
          }
        : {
            status: "sending",
            sentAt: null,
            errorMessage: `${errorMessage}; delivery is unknown and automatic retry is blocked pending manual review`,
            guardSnapshot: {
              ...(isPlainObject(claimed.task.guardSnapshot) ? claimed.task.guardSnapshot : {}),
              status: "sending",
              deliveryState: "unknown",
              deliveryUnknownReason,
              deliveryUnknownAt: completedAt,
              automaticRetryBlocked: true,
              manualReviewRequired: true,
            },
          };
      const completed = this.localStore.completeSendAttemptAndTask({
        taskId: id,
        attemptId: claimed.attempt.id,
        expectedTaskStatus: "sending",
        expectedAttemptStatus: "started",
        attemptPatch: {
          status: knownNotSent ? "failed" : "started",
          errorMessage,
          completedAt: knownNotSent ? completedAt : null,
          metadata: {
            bridgeState: knownNotSent ? "adapter_failed_before_delivery" : "delivery_unknown",
            deliveryState: knownNotSent ? "failed" : "unknown",
            failureStage,
            retrySafe: knownNotSent,
            automaticRetryBlocked: !knownNotSent,
            manualReviewRequired: !knownNotSent,
            ...(error instanceof WechatBridgeOutboxError && error.outboxFile
              ? { outboxFile: error.outboxFile }
              : {}),
          },
        },
        taskPatch,
      });
      if (!completed) throw new BadRequestException("send task state changed before adapter failure was recorded");
      return { task: completed.task, attempt: completed.attempt, adapter };
    }
    const taskStatus = adapterResult.status === "failed"
      ? "failed"
      : adapterResult.status === "started"
        ? "sending"
        : adapterResult.status === "dry_run"
          ? "dry_run"
          : "sent";
    const completed = this.localStore.completeSendAttemptAndTask({
      taskId: id,
      attemptId: claimed.attempt.id,
      expectedTaskStatus: "sending",
      expectedAttemptStatus: "started",
      attemptPatch: {
        status: adapterResult.status,
        errorMessage: adapterResult.errorMessage || "",
        metadata: adapterResult.metadata || {},
        completedAt: adapterResult.status === "started" ? null : new Date().toISOString(),
      },
      taskPatch: {
        status: taskStatus,
        sentAt: taskStatus === "sent" ? new Date().toISOString() : null,
        errorMessage: adapterResult.errorMessage || (taskStatus === "sending" ? "等待 Windows 桥接回执" : ""),
      },
    });
    if (!completed) throw new BadRequestException("send task state changed before adapter completion");
    const { task, attempt } = completed;
    if (taskStatus === "sent") this.markLinkedQuoteSent(task);
    return { task, attempt, adapter };
  }

  private validateWechatWorkKfSendTask(id: string) {
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const binding = this.localStore.findWechatWorkBindingByIdentity({
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.conversation?.customerId || task.customerId,
    });
    const text = String(task.payload?.textBeforeImages || task.payload?.text || "").trim();
    const imagePaths = Array.isArray(task.payload?.imagePaths) ? task.payload.imagePaths.filter(Boolean) : [];
    const imageValidation = validateWechatWorkImagePaths(imagePaths);
    const messageCount = (text ? 1 : 0) + imagePaths.length;
    const checks = [
      { key: "wechatWorkBinding", passed: Boolean(binding), detail: binding ? "mapping found" : "mapping missing" },
      { key: "wechatWorkCorpId", passed: Boolean(appConfig.wechatWorkCorpId), detail: "WECHAT_WORK_CORP_ID" },
      { key: "wechatWorkSecret", passed: Boolean(appConfig.wechatWorkSecret), detail: "WECHAT_WORK_SECRET" },
      { key: "messagePayload", passed: messageCount > 0, detail: "text and/or imagePaths" },
      { key: "textLength", passed: !text || Buffer.byteLength(text, "utf8") <= 2048, detail: "maximum 2048 UTF-8 bytes" },
      { key: "imageFiles", passed: imageValidation.ok, detail: imageValidation.detail },
      { key: "messageCount", passed: messageCount <= 5, detail: "maximum 5 ordered messages" },
    ];
    const failedKeys = checks.filter((item) => !item.passed).map((item) => item.key);
    if (failedKeys.length) {
      return this.blockSendTask(id, `enterprise wechat send guard blocked: ${failedKeys.join(", ")}`, {
        status: "blocked",
        adapter: "wechat_work_kf",
        checks,
        failedKeys,
        binding: binding || null,
        validatedAt: new Date().toISOString(),
      });
    }
    return this.localStore.updateSendTask(id, {
      errorMessage: "",
      guardSnapshot: {
        ...(task.guardSnapshot || {}),
        status: "passed",
        adapter: "wechat_work_kf",
        checks,
        failedKeys: [],
        wechatWorkBindingId: binding.id,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  private async validatePrismaWechatWorkKfSendTask(id: string, expected: ExpectedIdentityPayload = {}) {
    const task = await this.persistence.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(task, expected, "send task");
    const binding = await this.persistence.findWechatWorkBindingByIdentity({
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.conversation?.customerId || task.customerId,
    });
    const text = String(task.payload?.textBeforeImages || task.payload?.text || "").trim();
    const imagePaths = Array.isArray(task.payload?.imagePaths) ? task.payload.imagePaths.filter(Boolean) : [];
    const imageValidation = validateWechatWorkImagePaths(imagePaths);
    const messageCount = (text ? 1 : 0) + imagePaths.length;
    const checks = [
      { key: "wechatWorkBinding", passed: Boolean(binding), detail: binding ? "mapping found" : "mapping missing" },
      { key: "wechatWorkCorpId", passed: Boolean(appConfig.wechatWorkCorpId), detail: "WECHAT_WORK_CORP_ID" },
      { key: "wechatWorkSecret", passed: Boolean(appConfig.wechatWorkSecret), detail: "WECHAT_WORK_SECRET" },
      { key: "messagePayload", passed: messageCount > 0, detail: "text and/or imagePaths" },
      { key: "textLength", passed: !text || Buffer.byteLength(text, "utf8") <= 2048, detail: "maximum 2048 UTF-8 bytes" },
      { key: "imageFiles", passed: imageValidation.ok, detail: imageValidation.detail },
      { key: "messageCount", passed: messageCount <= 5, detail: "maximum 5 ordered messages" },
    ];
    const failedKeys = checks.filter((item) => !item.passed).map((item) => item.key);
    return this.persistence.updateSendTask(id, {
      status: failedKeys.length ? "blocked" : task.status,
      errorMessage: failedKeys.length ? `enterprise wechat send guard blocked: ${failedKeys.join(", ")}` : "",
      guardSnapshot: {
        ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
        status: failedKeys.length ? "blocked" : "passed",
        adapter: "wechat_work_kf",
        checks,
        failedKeys,
        wechatWorkBindingId: binding?.id || null,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  private async validatePrismaSendTask(id: string, expected: ExpectedIdentityPayload = {}) {
    const task = await this.persistence.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(task, expected, "send task");
    const activeWindow = await this.persistence.getLatestWindowSnapshot(task.wechatAccountId);
    if (!activeWindow) {
      return this.persistence.updateSendTask(id, {
        status: "blocked",
        errorMessage: "没有可用的微信窗口快照",
        guardSnapshot: {
          ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
          status: "blocked",
          reason: "没有可用的微信窗口快照",
          failedKeys: ["windowSnapshotMissing"],
          windowSnapshotId: null,
          validatedAt: new Date().toISOString(),
        },
      });
    }
    const [recentMessage, accountQueueTaskIds] = await Promise.all([
      this.persistence.getRecentMessage(task.conversationId),
      this.persistence.listAccountQueueTaskIds(task.wechatAccountId),
    ]);
    const result = validateSendGuard({
      task,
      account: task.wechatAccount,
      conversation: task.conversation,
      customer: task.conversation?.customer,
      recentMessage,
      activeWindow,
      observerProofToken: currentWechatWindowObserverProofToken(),
      accountQueueTaskIds,
      maxWindowSnapshotAgeSeconds: appConfig.wechatWindowSnapshotMaxAgeSeconds,
    });
    return this.persistence.updateSendTask(id, {
      status: result.ok ? task.status : "blocked",
      errorMessage: result.ok ? "" : result.reason,
      guardSnapshot: {
        ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
        ...result,
        activeWindow,
        windowSnapshotId: (activeWindow as any).id || null,
        windowDiagnostic: (activeWindow as any).diagnostic || null,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  private async completeWechatWorkKfSend(result: any) {
    if (!appConfig.useLocalStore) return this.completePrismaWechatWorkKfSend(result);
    const task = this.localStore.getSendTask(result.task.id);
    const binding = this.localStore.findWechatWorkBindingByIdentity({
      wechatAccountId: task?.wechatAccountId,
      conversationId: task?.conversationId,
      customerId: task?.conversation?.customerId || task?.customerId,
    });
    const attemptNumber = this.localStore.listSendAttempts({ sendTaskId: task.id, limit: 300 })
      .filter((attempt: any) => attempt.adapter === "wechat_work_kf").length;
    const wechatWorkMsgId = createWechatWorkMsgId(task.id);
    try {
      if (!binding) throw new Error("wechat work mapping disappeared after send guard");
      const response = await this.sendAdapter.deliverWechatWorkKf(task, binding, wechatWorkMsgId);
      const completedAt = new Date().toISOString();
      const apiMsgIds = Array.isArray(response.apiMsgIds) && response.apiMsgIds.length
        ? response.apiMsgIds
        : [response.msgid || wechatWorkMsgId];
      const liveTask = this.localStore.getSendTask(task.id);
      const liveAttempt = this.localStore.listSendAttempts({ sendTaskId: task.id, limit: 300 })
        .find((item: any) => item.id === result.attempt.id);
      if (!liveTask || liveTask.status !== "sending" || !liveAttempt || liveAttempt.status !== "started") {
        return { ...result, task: liveTask, attempt: liveAttempt, retryScheduled: false, stateChanged: true };
      }
      const attempt = this.localStore.updateSendAttempt(result.attempt.id, {
        status: "sent",
        errorMessage: "",
        completedAt,
        metadata: {
          bridgeState: "api_accepted",
          attemptNumber,
          wechatWorkBindingId: binding.id,
          openKfid: binding.openKfid,
          externalUserId: binding.externalUserId,
          wechatWorkMsgId,
          apiMsgId: apiMsgIds[0],
          apiMsgIds,
          apiResponse: response,
          finalDeliveryPendingFailureEvent: true,
          deliveryState: "sent",
          automaticRetryBlocked: false,
          manualReviewRequired: false,
        },
      });
      const updatedTask = this.localStore.updateSendTask(task.id, {
        status: "sent",
        sentAt: completedAt,
        errorMessage: "",
        guardSnapshot: {
          ...this.settledDeliveryGuard(liveTask, "sent", completedAt, "wechat_work_api"),
          wechatWorkRetryCount: Math.max(0, attemptNumber - 1),
          wechatWorkNextRetryAt: null,
          wechatWorkMsgId: apiMsgIds[0],
          wechatWorkMsgIds: apiMsgIds,
          apiAcceptedAt: completedAt,
        },
      });
      this.markLinkedQuoteSent(updatedTask);
      this.localStore.recordWechatWorkAudit({
        action: "send_api_accepted",
        status: "sent",
        sendTaskId: task.id,
        sendAttemptId: attempt.id,
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        msgid: apiMsgIds[0],
        msgids: apiMsgIds,
        attemptNumber,
      });
      return { ...result, task: updatedTask, attempt, retryScheduled: false };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const deliveryFailure = describeWechatWorkDeliveryFailure(error);
      const liveTask = this.localStore.getSendTask(task.id);
      const liveAttempt = this.localStore.listSendAttempts({ sendTaskId: task.id, limit: 300 })
        .find((item: any) => item.id === result.attempt.id);
      if (!liveTask || liveTask.status !== "sending" || !liveAttempt || liveAttempt.status !== "started") {
        return { ...result, task: liveTask, attempt: liveAttempt, retryScheduled: false, stateChanged: true };
      }
      const retrySuppressed = liveTask.guardSnapshot?.automaticRetryBlocked === true;
      const retryScheduled = !retrySuppressed && deliveryFailure.retrySafe && attemptNumber < appConfig.wechatWorkSendMaxAttempts;
      const deliveryUnknown = !retryScheduled && deliveryFailure.deliveryState !== "failed";
      const nextRetryAt = retryScheduled
        ? new Date(Date.now() + appConfig.wechatWorkSendRetryDelaySeconds * 1000).toISOString()
        : null;
      const attempt = this.localStore.updateSendAttempt(result.attempt.id, {
        status: deliveryUnknown ? "started" : "failed",
        errorMessage,
        completedAt: deliveryUnknown ? null : completedAt,
        metadata: {
          bridgeState: retryScheduled ? "retry_scheduled" : deliveryFailure.deliveryState === "failed" ? "api_failed" : "delivery_unknown",
          attemptNumber,
          maxAttempts: appConfig.wechatWorkSendMaxAttempts,
          retryScheduled,
          nextRetryAt,
          wechatWorkBindingId: binding?.id || null,
          openKfid: binding?.openKfid || null,
          externalUserId: binding?.externalUserId || null,
          wechatWorkMsgId,
          deliveryState: deliveryFailure.deliveryState,
          failureStage: deliveryFailure.stage,
          acceptedMessageIds: deliveryFailure.acceptedMessageIds,
          uploadedMediaIds: deliveryFailure.uploadedMediaIds,
          automaticRetryBlocked: deliveryUnknown || !deliveryFailure.retrySafe,
          manualReviewRequired: deliveryUnknown,
        },
      });
      const updatedTask = this.localStore.updateSendTask(task.id, {
        status: retryScheduled ? "queued" : deliveryUnknown ? "sending" : "failed",
        errorMessage,
        guardSnapshot: {
          ...(liveTask.guardSnapshot || {}),
          wechatWorkRetryCount: attemptNumber,
          wechatWorkNextRetryAt: nextRetryAt,
          wechatWorkLastErrorAt: completedAt,
          wechatWorkDeliveryState: deliveryFailure.deliveryState,
          deliveryState: retryScheduled ? "not_started" : deliveryUnknown ? "unknown" : "failed",
          automaticRetryBlocked: deliveryUnknown || !deliveryFailure.retrySafe,
          manualReviewRequired: deliveryUnknown,
        },
      });
      if (!retryScheduled && !deliveryUnknown) await this.markLinkedQuoteFailed(updatedTask, errorMessage);
      this.localStore.recordWechatWorkAudit({
        action: retryScheduled
          ? "send_retry_scheduled"
          : deliveryFailure.deliveryState === "failed" ? "send_api_failed" : "send_delivery_unknown",
        status: retryScheduled ? "retrying" : deliveryFailure.deliveryState === "failed" ? "failed" : "unknown",
        sendTaskId: task.id,
        sendAttemptId: attempt.id,
        openKfid: binding?.openKfid || null,
        externalUserId: binding?.externalUserId || null,
        msgid: wechatWorkMsgId,
        attemptNumber,
        nextRetryAt,
        errorMessage,
        deliveryState: deliveryFailure.deliveryState,
        failureStage: deliveryFailure.stage,
        acceptedMessageIds: deliveryFailure.acceptedMessageIds,
      });
      return { ...result, task: updatedTask, attempt, retryScheduled, nextRetryAt };
    }
  }

  private async completePrismaWechatWorkKfSend(result: any) {
    const task = await this.persistence.getSendTask(result.task.id);
    if (!task) throw new Error(`send task not found: ${result.task.id}`);
    const binding = await this.persistence.findWechatWorkBindingByIdentity({
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.conversation?.customerId || task.customerId,
    });
    const attempts = await this.persistence.listSendAttempts({ sendTaskId: task.id, limit: 300 });
    const attemptNumber = attempts.filter((attempt: any) => attempt.adapter === "wechat_work_kf").length;
    const wechatWorkMsgId = createWechatWorkMsgId(task.id);
    let acceptedApiMsgIds: string[] = [];
    try {
      if (!binding) throw new Error("wechat work mapping disappeared after send guard");
      const response = await this.sendAdapter.deliverWechatWorkKf(task, binding, wechatWorkMsgId);
      const completedAt = new Date().toISOString();
      const apiMsgIds = Array.isArray(response.apiMsgIds) && response.apiMsgIds.length
        ? response.apiMsgIds
        : [response.msgid || wechatWorkMsgId];
      acceptedApiMsgIds = apiMsgIds;
      const liveTask = await this.persistence.getSendTask(task.id);
      const liveAttempt = await this.persistence.getLatestSendAttempt(task.id, { adapter: "wechat_work_kf" });
      if (
        !liveTask || liveTask.status !== "sending" ||
        !liveAttempt || liveAttempt.id !== result.attempt.id || liveAttempt.status !== "started"
      ) {
        return { ...result, task: liveTask, attempt: liveAttempt, retryScheduled: false, stateChanged: true };
      }
      const preCommitState = await this.validatePrismaLinkedSendState(task.id, { allowManualLock: true });
      if (!preCommitState.ok) {
        await this.persistence.recordWechatWorkAudit({
          action: "send_completion_state_changed",
          status: "unknown",
          sendTaskId: task.id,
          sendAttemptId: result.attempt.id,
          openKfid: binding.openKfid,
          externalUserId: binding.externalUserId,
          msgid: apiMsgIds[0],
          errorMessage: `send API accepted but production state changed: ${preCommitState.message}`,
        }).catch(() => null);
        throw new WechatWorkKfDeliveryError(
          `send API accepted but durable completion was rejected: ${preCommitState.message}`,
          {
            retrySafe: false,
            deliveryState: "unknown",
            stage: "durable_completion_guard",
            acceptedMessageIds: apiMsgIds,
            uploadedMediaIds: [],
          },
        );
      }
      const preCommitTask = preCommitState.task || liveTask;
      const linkedTransition = await this.buildPrismaLinkedTransition(preCommitTask, "sent");
      const completed = await this.persistence.completeAttemptAndTask({
        taskId: task.id,
        attemptId: result.attempt.id,
        expectedTaskStatus: "sending",
        attemptPatch: {
          status: "sent",
          errorMessage: "",
          completedAt,
          metadata: {
            bridgeState: "api_accepted",
            attemptNumber,
            wechatWorkBindingId: binding.id,
            openKfid: binding.openKfid,
            externalUserId: binding.externalUserId,
            wechatWorkMsgId,
            apiMsgId: apiMsgIds[0],
            apiMsgIds,
            apiResponse: response,
            finalDeliveryPendingFailureEvent: true,
            deliveryState: "sent",
            automaticRetryBlocked: false,
            manualReviewRequired: false,
          },
        },
        taskPatch: {
          status: "sent",
          sentAt: completedAt,
          errorMessage: "",
          guardSnapshot: {
            ...this.settledDeliveryGuard(preCommitTask, "sent", completedAt, "wechat_work_api"),
            wechatWorkRetryCount: Math.max(0, attemptNumber - 1),
            wechatWorkNextRetryAt: null,
            wechatWorkMsgId: apiMsgIds[0],
            wechatWorkMsgIds: apiMsgIds,
            apiAcceptedAt: completedAt,
          },
        },
        expectedTaskUpdatedAt: preCommitTask.updatedAt,
        expectedAttemptStatus: "started",
        linkedTransition,
      });
      if (!completed) {
        const currentTask = await this.persistence.getSendTask(task.id);
        const currentAttempt = await this.persistence.getLatestSendAttempt(task.id, { adapter: "wechat_work_kf" });
        if (isPlainObject(currentTask?.guardSnapshot?.manualDeliveryResolution)) {
          return { ...result, task: currentTask, attempt: currentAttempt, retryScheduled: false, stateChanged: true };
        }
        await this.persistence.recordWechatWorkAudit({
          action: "send_completion_state_changed",
          status: "unknown",
          sendTaskId: task.id,
          sendAttemptId: currentAttempt?.id || result.attempt.id,
          openKfid: binding.openKfid,
          externalUserId: binding.externalUserId,
          msgid: apiMsgIds[0],
          msgids: apiMsgIds,
          taskStatus: currentTask?.status || "missing",
          errorMessage: "send API accepted but task left sending state before durable completion",
        }).catch(() => null);
        return { ...result, task: currentTask, attempt: currentAttempt, deliveryState: "unknown", stateChanged: true };
      }
      let auditPersisted = true;
      try {
        await this.persistence.recordWechatWorkAudit({
          action: "send_api_accepted",
          status: "sent",
          sendTaskId: task.id,
          sendAttemptId: completed.attempt.id,
          openKfid: binding.openKfid,
          externalUserId: binding.externalUserId,
          msgid: response.msgid || wechatWorkMsgId,
          attemptNumber,
        });
      } catch {
        auditPersisted = false;
      }
      return { ...result, task: completed.task, attempt: completed.attempt, retryScheduled: false, auditPersisted };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const deliveryFailure = acceptedApiMsgIds.length && !(error instanceof WechatWorkKfDeliveryError)
        ? {
            retrySafe: false,
            deliveryState: "unknown" as const,
            stage: "durable_completion",
            acceptedMessageIds: acceptedApiMsgIds,
            uploadedMediaIds: [] as string[],
          }
        : describeWechatWorkDeliveryFailure(error);
      const liveTask = await this.persistence.getSendTask(task.id);
      const liveAttempt = await this.persistence.getLatestSendAttempt(task.id, { adapter: "wechat_work_kf" });
      if (
        !liveTask || liveTask.status !== "sending" ||
        !liveAttempt || liveAttempt.id !== result.attempt.id || liveAttempt.status !== "started"
      ) {
        return { ...result, task: liveTask, attempt: liveAttempt, retryScheduled: false, stateChanged: true };
      }
      const retrySuppressed = liveTask.guardSnapshot?.automaticRetryBlocked === true;
      const retryScheduled = !retrySuppressed && deliveryFailure.retrySafe && attemptNumber < appConfig.wechatWorkSendMaxAttempts;
      const deliveryUnknown = !retryScheduled && deliveryFailure.deliveryState !== "failed";
      const nextRetryAt = retryScheduled
        ? new Date(Date.now() + appConfig.wechatWorkSendRetryDelaySeconds * 1000).toISOString()
        : null;
      const linkedTransition = !retryScheduled && !deliveryUnknown
        ? await this.buildPrismaLinkedTransition(liveTask, "failed", errorMessage)
        : null;
      const completed = await this.persistence.completeAttemptAndTask({
        taskId: task.id,
        attemptId: result.attempt.id,
        expectedTaskStatus: "sending",
        attemptPatch: {
          status: deliveryUnknown ? "started" : "failed",
          errorMessage,
          completedAt: deliveryUnknown ? null : completedAt,
          metadata: {
            bridgeState: retryScheduled ? "retry_scheduled" : deliveryFailure.deliveryState === "failed" ? "api_failed" : "delivery_unknown",
            attemptNumber,
            maxAttempts: appConfig.wechatWorkSendMaxAttempts,
            retryScheduled,
            nextRetryAt,
            wechatWorkBindingId: binding?.id || null,
            openKfid: binding?.openKfid || null,
            externalUserId: binding?.externalUserId || null,
            wechatWorkMsgId,
            deliveryState: deliveryFailure.deliveryState,
            failureStage: deliveryFailure.stage,
            acceptedMessageIds: deliveryFailure.acceptedMessageIds,
            uploadedMediaIds: deliveryFailure.uploadedMediaIds,
            automaticRetryBlocked: deliveryUnknown || !deliveryFailure.retrySafe,
            manualReviewRequired: deliveryUnknown,
          },
        },
        taskPatch: {
          status: retryScheduled ? "queued" : deliveryUnknown ? "sending" : "failed",
          errorMessage,
          guardSnapshot: {
            ...(isPlainObject(liveTask.guardSnapshot) ? liveTask.guardSnapshot : {}),
            wechatWorkRetryCount: attemptNumber,
            wechatWorkNextRetryAt: nextRetryAt,
            wechatWorkLastErrorAt: completedAt,
            wechatWorkDeliveryState: deliveryFailure.deliveryState,
            deliveryState: retryScheduled ? "not_started" : deliveryUnknown ? "unknown" : "failed",
            automaticRetryBlocked: deliveryUnknown || !deliveryFailure.retrySafe,
            manualReviewRequired: deliveryUnknown,
          },
        },
        expectedTaskUpdatedAt: liveTask.updatedAt,
        expectedAttemptStatus: "started",
        linkedTransition,
      });
      if (!completed) {
        const currentTask = await this.persistence.getSendTask(task.id);
        const currentAttempt = await this.persistence.getLatestSendAttempt(task.id, { adapter: "wechat_work_kf" });
        return { ...result, task: currentTask, attempt: currentAttempt, retryScheduled: false, stateChanged: true };
      }
      await this.persistence.recordWechatWorkAudit({
        action: retryScheduled
          ? "send_retry_scheduled"
          : deliveryFailure.deliveryState === "failed" ? "send_api_failed" : "send_delivery_unknown",
        status: retryScheduled ? "retrying" : deliveryFailure.deliveryState === "failed" ? "failed" : "unknown",
        sendTaskId: task.id,
        sendAttemptId: completed.attempt.id,
        openKfid: binding?.openKfid || null,
        externalUserId: binding?.externalUserId || null,
        msgid: wechatWorkMsgId,
        attemptNumber,
        nextRetryAt,
        errorMessage,
        deliveryState: deliveryFailure.deliveryState,
        failureStage: deliveryFailure.stage,
        acceptedMessageIds: deliveryFailure.acceptedMessageIds,
      });
      return { ...result, task: completed.task, attempt: completed.attempt, retryScheduled, nextRetryAt };
    }
  }

  private async createPrismaDemoSendTask(
    payload: {
      operationKey: string;
      wechatAccountId?: string;
      conversationId?: string;
      text?: string;
    } & ExpectedIdentityPayload,
  ) {
    if (!payload.conversationId) throw new BadRequestException("conversationId is required for demo send task");
    const conversation = await this.persistence.getConversation(payload.conversationId);
    if (!conversation || (payload.wechatAccountId && conversation.wechatAccountId !== payload.wechatAccountId)) {
      throw new BadRequestException("conversation not found for selected wechat account");
    }
    this.assertDemoConversationIdentity(conversation, payload, "demo send task");
    const binding = await this.assertSendTaskBinding({
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
    });
    return this.persistence.createSendTask({
      operationKey: payload.operationKey,
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      payload: { kind: "text", text: payload.text || "Prisma 安全发送演示消息" },
      guardSnapshot: {
        status: "pending",
        checks: [],
        requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
        policy: "single-account-serial-queue",
        binding,
      },
    });
  }

  private async executePrismaSend(id: string, params: { adapter?: string } & ExpectedIdentityPayload = {}) {
    const adapter = this.sendAdapter.describe(params.adapter);
    const taskBeforeValidation = await this.persistence.getSendTask(id);
    if (!taskBeforeValidation) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(taskBeforeValidation, params, "send task");
    if (taskBeforeValidation.status !== "queued") {
      throw new BadRequestException(`send task is not queued: ${taskBeforeValidation.status || "unknown"}`);
    }
    const initialLinkedState = await this.validatePrismaLinkedSendState(taskBeforeValidation);
    if (!initialLinkedState.ok) {
      throw new BadRequestException(`send task production state invalid: ${initialLinkedState.message}`);
    }
    const binding = validateSendTaskBinding({
      task: taskBeforeValidation,
      conversation: taskBeforeValidation.conversation,
      designJob: taskBeforeValidation.designJob,
      quoteDraft: taskBeforeValidation.quoteDraft,
    });
    if (!binding.ok) {
      const now = new Date().toISOString();
      const task = await this.persistence.updateSendTask(id, {
        status: "blocked",
        errorMessage: `send task binding invalid: ${binding.reason}`,
        guardSnapshot: {
          ...(isPlainObject(taskBeforeValidation.guardSnapshot) ? taskBeforeValidation.guardSnapshot : {}),
          ...binding,
          status: "blocked",
          bindingRevalidatedAt: now,
        },
      });
      const attempt = await this.persistence.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus: "binding_failed",
        payloadSummary: this.summarizePayload(taskBeforeValidation.payload),
        errorMessage: task.errorMessage,
        metadata: { adapter, binding },
        startedAt: now,
        completedAt: now,
      });
      return { task, attempt, adapter };
    }

    const validated = adapter.capabilities.requiresWindowGuard
      ? await this.validatePrismaSendTask(id, params)
      : await this.validatePrismaWechatWorkKfSendTask(id, params);
    const startedAt = new Date().toISOString();
    const guardStatus = validated.guardSnapshot?.status || "blocked";
    const windowSnapshotId = validated.guardSnapshot?.windowSnapshotId || null;
    const payloadSummary = this.summarizePayload(validated.payload);
    if (guardStatus !== "passed") {
      const attempt = await this.persistence.createSendAttempt({
        sendTaskId: id,
        adapter: adapter.name,
        status: "blocked",
        guardStatus,
        windowSnapshotId,
        payloadSummary,
        errorMessage: validated.errorMessage || validated.guardSnapshot?.reason || "send guard blocked",
        metadata: { adapter, guardSnapshot: validated.guardSnapshot || null },
        startedAt,
        completedAt: startedAt,
      });
      return { task: validated, attempt, adapter };
    }

    const preClaimState = await this.validatePrismaLinkedSendState(id);
    if (!preClaimState.ok) {
      throw new BadRequestException(`send task changed before claim: ${preClaimState.message}`);
    }

    const claimed = await this.persistence.claimQueuedTaskAndCreateAttempt({
      taskId: id,
      taskPatch: { status: "sending", errorMessage: "" },
      attempt: {
        sendTaskId: id,
        adapter: adapter.name,
        status: "started",
        guardStatus,
        windowSnapshotId,
        payloadSummary,
        metadata: { adapter, guardSnapshot: validated.guardSnapshot || null },
        startedAt,
      },
    });
    if (!claimed) throw new BadRequestException("send task was claimed by another worker");

    const preDispatchState = await this.validatePrismaLinkedSendState(id);
    if (!preDispatchState.ok) {
      const blockedAt = new Date().toISOString();
      const blocked = await this.persistence.completeAttemptAndTask({
        taskId: id,
        attemptId: claimed.attempt.id,
        expectedTaskStatus: "sending",
        attemptPatch: {
          status: "blocked",
          guardStatus: preDispatchState.reason,
          errorMessage: preDispatchState.message,
          completedAt: blockedAt,
        },
        taskPatch: {
          status: "blocked",
          errorMessage: preDispatchState.message,
          guardSnapshot: {
            ...(isPlainObject(claimed.task?.guardSnapshot) ? claimed.task.guardSnapshot : {}),
            status: "blocked",
            failedKeys: [preDispatchState.reason],
            blockedAt,
          },
        },
      });
      if (!blocked) throw new BadRequestException("send task changed while production state was being blocked");
      return { task: blocked.task, attempt: blocked.attempt, adapter };
    }

    let adapterResult: any;
    try {
      adapterResult = this.sendAdapter.execute(
        validated,
        { guardStatus, windowSnapshotId, payloadSummary, attemptId: claimed.attempt.id },
        params.adapter,
      );
    } catch (error) {
      const completedAt = new Date().toISOString();
      const knownNotSent = error instanceof WechatBridgeOutboxError && error.deliveryState === "failed";
      const failureStage = error instanceof WechatBridgeOutboxError ? error.stage : "adapter_execution";
      const errorMessage = error instanceof Error ? error.message : "send adapter failed";
      const deliveryUnknownReason = knownNotSent ? null : "adapter_execution_exception";
      const taskPatch = knownNotSent
        ? {
            status: "failed",
            sentAt: null,
            errorMessage,
            guardSnapshot: this.settledDeliveryGuard(claimed.task, "failed", completedAt, failureStage),
          }
        : {
            status: "sending",
            sentAt: null,
            errorMessage: `${errorMessage}; delivery is unknown and automatic retry is blocked pending manual review`,
            guardSnapshot: {
              ...(isPlainObject(claimed.task.guardSnapshot) ? claimed.task.guardSnapshot : {}),
              status: "sending",
              deliveryState: "unknown",
              deliveryUnknownReason,
              deliveryUnknownAt: completedAt,
              automaticRetryBlocked: true,
              manualReviewRequired: true,
            },
          };
      const linkedTransition = knownNotSent
        ? await this.buildPrismaLinkedTransition(claimed.task, "failed", errorMessage)
        : null;
      const completed = await this.persistence.completeAttemptAndTask({
        taskId: id,
        attemptId: claimed.attempt.id,
        expectedTaskStatus: "sending",
        expectedAttemptStatus: "started",
        attemptPatch: {
          status: knownNotSent ? "failed" : "started",
          errorMessage,
          completedAt: knownNotSent ? completedAt : null,
          metadata: {
            ...(isPlainObject(claimed.attempt.metadata) ? claimed.attempt.metadata : {}),
            bridgeState: knownNotSent ? "adapter_failed_before_delivery" : "delivery_unknown",
            deliveryState: knownNotSent ? "failed" : "unknown",
            failureStage,
            retrySafe: knownNotSent,
            automaticRetryBlocked: !knownNotSent,
            manualReviewRequired: !knownNotSent,
            ...(error instanceof WechatBridgeOutboxError && error.outboxFile
              ? { outboxFile: error.outboxFile }
              : {}),
          },
        },
        taskPatch,
        linkedTransition,
      });
      if (!completed) throw new BadRequestException("send task state changed before adapter failure was recorded");
      return { task: completed.task, attempt: completed.attempt, adapter };
    }
    const taskStatus = adapterResult.status === "failed"
      ? "failed"
      : adapterResult.status === "started"
        ? "sending"
        : adapterResult.status === "dry_run"
          ? "dry_run"
          : "sent";
    const completedAt = adapterResult.status === "started" ? null : new Date().toISOString();
    if (taskStatus === "sent") {
      const preCommitState = await this.validatePrismaLinkedSendState(id);
      if (!preCommitState.ok) {
        throw new BadRequestException(`send task changed before durable completion: ${preCommitState.message}`);
      }
    }
    const linkedTransition = taskStatus === "sent"
      ? await this.buildPrismaLinkedTransition(await this.persistence.getSendTask(id), "sent")
      : taskStatus === "failed"
        ? await this.buildPrismaLinkedTransition(await this.persistence.getSendTask(id), "failed", adapterResult.errorMessage || "发送失败")
        : null;
    const completed = await this.persistence.completeAttemptAndTask({
      taskId: id,
      attemptId: claimed.attempt.id,
      expectedTaskStatus: "sending",
      attemptPatch: {
        status: adapterResult.status,
        errorMessage: adapterResult.errorMessage || "",
        metadata: {
          ...(isPlainObject(claimed.attempt.metadata) ? claimed.attempt.metadata : {}),
          ...(adapterResult.metadata || {}),
        },
        completedAt,
      },
      taskPatch: {
        status: taskStatus,
        sentAt: taskStatus === "sent" ? new Date().toISOString() : null,
        errorMessage: adapterResult.errorMessage || (taskStatus === "sending" ? "等待 Windows 桥接回执" : ""),
      },
      linkedTransition,
    });
    if (!completed) throw new BadRequestException("send task state changed before adapter completion");
    const result = { task: completed.task, attempt: completed.attempt, adapter };
    if (adapter.name === "wechat_work_kf" && completed.task?.status === "sending") {
      return this.completePrismaWechatWorkKfSend(result);
    }
    return result;
  }

  private validateExistingSendTaskBinding(task: any) {
    const conversation = this.localStore.listConversations().find((item: any) => item.id === task.conversationId) || null;
    const quoteDraft = task.quoteDraftId ? this.localStore.getQuoteDraft(task.quoteDraftId) : null;
    const designJobId = task.designJobId || quoteDraft?.designJobId || undefined;
    const designJob = designJobId ? this.localStore.getDesignJob(designJobId) : null;
    return validateSendTaskBinding({
      task: {
        ...task,
        designJobId,
      },
      conversation,
      designJob,
      quoteDraft,
    });
  }

  private validateQueuedOrderSendState(task: any) {
    const orderContext = this.orderSendContext(task);
    const orderDraftId = String(orderContext.orderDraftId || "");
    if (!orderDraftId) return { ok: true as const };
    const order = this.localStore.getOrderDraft(orderDraftId);
    if (!order) {
      return {
        ok: false as const,
        reason: "orderDraftMissing",
        message: `order draft not found before send: ${orderDraftId}`,
        orderDraftId,
      };
    }
    if (String(order.wechatAccountId || "") !== String(task.wechatAccountId || "")) {
      return {
        ok: false as const,
        reason: "orderWechatAccountMismatch",
        message: "order send blocked: wechat account changed before send",
        orderDraftId,
        expectedWechatAccountId: task.wechatAccountId,
        actualWechatAccountId: order.wechatAccountId,
      };
    }
    if (String(order.conversationId || "") !== String(task.conversationId || "")) {
      return {
        ok: false as const,
        reason: "orderConversationMismatch",
        message: "order send blocked: conversation changed before send",
        orderDraftId,
        expectedConversationId: task.conversationId,
        actualConversationId: order.conversationId,
      };
    }
    const paymentStatus = String(order.paymentStatus || order.quoteDraft?.paymentStatus || "");
    if (String(order.status || "") === "cancelled") {
      return {
        ok: false as const,
        reason: "orderCancelledBeforeSend",
        message: "order send blocked: order was cancelled before send",
        orderDraftId,
        orderStatus: order.status,
        paymentStatus,
      };
    }
    if (paymentStatus !== "deposit_paid" && paymentStatus !== "paid") {
      return {
        ok: false as const,
        reason: "orderPaymentNotReadyBeforeSend",
        message: "order send blocked: payment is no longer verified before send",
        orderDraftId,
        orderStatus: order.status,
        paymentStatus,
      };
    }
    return {
      ok: true as const,
      orderDraftId,
      orderStatus: order.status,
      paymentStatus,
    };
  }

  private validateQueuedQuoteSendState(task: any) {
    if (this.hasOrderDraftBinding(task)) return { ok: true as const };
    const quoteDraftId = String(task?.quoteDraftId || task?.payload?.quoteDraftId || "").trim();
    if (!quoteDraftId) return { ok: true as const };
    const quote = this.localStore.getQuoteDraft(quoteDraftId);
    if (!quote) {
      return {
        ok: false as const,
        reason: "quoteDraftMissing",
        message: `quote draft not found before send: ${quoteDraftId}`,
        quoteDraftId,
      };
    }
    if (String(quote.sendTaskId || "") !== String(task.id || "")) {
      return {
        ok: false as const,
        reason: "quoteSendTaskChangedBeforeSend",
        message: "quote send blocked: quote is no longer bound to this send task",
        quoteDraftId,
        expectedSendTaskId: task.id,
        actualSendTaskId: quote.sendTaskId || null,
        quoteStatus: quote.status,
      };
    }
    if (String(quote.status || "") !== "send_queued") {
      return {
        ok: false as const,
        reason: "quoteStatusChangedBeforeSend",
        message: "quote send blocked: quote is no longer waiting to be sent",
        quoteDraftId,
        sendTaskId: task.id,
        quoteStatus: quote.status,
      };
    }
    return {
      ok: true as const,
      quoteDraftId,
      sendTaskId: task.id,
      quoteStatus: quote.status,
    };
  }

  private async validatePrismaLinkedSendState(
    taskOrId: any,
    options: { requireQuoteQueued?: boolean; allowManualLock?: boolean } = { requireQuoteQueued: true },
  ) {
    const task = typeof taskOrId === "string" ? await this.persistence.getSendTask(taskOrId) : taskOrId;
    if (!task) return { ok: false as const, reason: "sendTaskMissing", message: "send task no longer exists" };

    const routingState = this.validateQueuedRoutingPolicySendState(task);
    if (!routingState.ok) return routingState;
    if (!options.allowManualLock && task.conversation?.manualLocked && !isManualReplySendTask(task)) {
      return {
        ok: false as const,
        reason: "conversationManualLocked",
        message: "conversation is manually locked and only an explicit manual reply may be sent",
      };
    }
    if (isHighValueLowValueAutomationTask(task)) {
      return {
        ok: false as const,
        reason: "manualReviewRequired",
        message: "high-value automation requires manual review before send",
      };
    }

    const prisma = this.prisma as any;
    const orderContext = this.orderSendContext(task);
    const orderDraftId = String(orderContext.orderDraftId || task.payload?.orderDraftId || "").trim();
    if (orderDraftId) {
      const order = await prisma.orderDraft.findUnique({ where: { id: orderDraftId }, include: { quoteDraft: true } });
      if (!order) return { ok: false as const, reason: "orderDraftMissing", message: `order draft not found: ${orderDraftId}` };
      if (String(order.wechatAccountId || "") !== String(task.wechatAccountId || "")) {
        return { ok: false as const, reason: "orderWechatAccountMismatch", message: "order no longer belongs to the send account" };
      }
      if (String(order.conversationId || "") !== String(task.conversationId || "")) {
        return { ok: false as const, reason: "orderConversationMismatch", message: "order no longer belongs to the send conversation" };
      }
      if (String(order.status || "") === "cancelled") {
        return { ok: false as const, reason: "orderCancelledBeforeSend", message: "order was cancelled before durable send completion" };
      }
      const paymentStatus = String(order.paymentStatus || order.quoteDraft?.paymentStatus || "");
      if (!["deposit_paid", "paid"].includes(paymentStatus)) {
        return { ok: false as const, reason: "orderPaymentNotReadyBeforeSend", message: "order payment is no longer verified" };
      }
    } else {
      const quoteDraftId = String(task.quoteDraftId || task.payload?.quoteDraftId || "").trim();
      if (quoteDraftId) {
        const quote = await prisma.quoteDraft.findUnique({ where: { id: quoteDraftId } });
        if (!quote) return { ok: false as const, reason: "quoteDraftMissing", message: `quote draft not found: ${quoteDraftId}` };
        if (String(quote.sendTaskId || "") !== String(task.id || "")) {
          return { ok: false as const, reason: "quoteSendTaskChangedBeforeSend", message: "quote is no longer owned by this send task" };
        }
        if (options.requireQuoteQueued !== false && String(quote.status || "") !== "send_queued") {
          return { ok: false as const, reason: "quoteStatusChangedBeforeSend", message: "quote is no longer waiting to be sent" };
        }
      }
    }
    return { ok: true as const, task };
  }

  private async buildPrismaLinkedTransition(
    task: any,
    outcome: "sent" | "failed" | "requeued",
    reason = "",
    options: { allowSentFailure?: boolean } = {},
  ) {
    const prisma = this.prisma as any;
    const orderContext = this.orderSendContext(task);
    const orderDraftId = String(orderContext.orderDraftId || task?.payload?.orderDraftId || "").trim();
    if (orderDraftId) {
      const order = await prisma.orderDraft.findUnique({ where: { id: orderDraftId } });
      if (!order) throw new BadRequestException(`linked order draft not found: ${orderDraftId}`);
      if (outcome === "sent") {
        return {
          model: "orderDraft" as const,
          where: {
            id: orderDraftId,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
            status: { not: "cancelled" },
            paymentStatus: { in: ["deposit_paid", "paid"] },
          },
          data: { customerNotes: order.customerNotes },
          required: true,
        };
      }
      const source = String(orderContext.source || task?.payload?.source || "");
      const stage = source === "order_followup" || orderContext.followupType ? "订单跟进发送" : "订单确认发送";
      const marker = outcome === "requeued" ? `[发送任务:${task.id}:requeue]` : `[发送任务:${task.id}]`;
      if (String(order.customerNotes || "").includes(marker)) return null;
      const note = outcome === "requeued"
        ? `${marker}${stage}已人工重新排队：${reason}`
        : `${marker}${stage}失败，需要人工处理：${reason}`;
      return {
        model: "orderDraft" as const,
        where: {
          id: orderDraftId,
          wechatAccountId: task.wechatAccountId,
          conversationId: task.conversationId,
          customerNotes: order.customerNotes,
          ...(outcome === "requeued"
            ? { status: { not: "cancelled" }, paymentStatus: { in: ["deposit_paid", "paid"] } }
            : {}),
        },
        data: {
          ...(outcome === "failed"
            ? { owner: order.owner && order.owner !== "low_value_automation" ? order.owner : "人工客服" }
            : {}),
          customerNotes: appendCustomerNote(order.customerNotes, note),
        },
        required: true,
      };
    }

    const quoteDraftId = String(task?.quoteDraftId || task?.payload?.quoteDraftId || "").trim();
    if (!quoteDraftId) return null;
    const quote = await prisma.quoteDraft.findUnique({ where: { id: quoteDraftId } });
    if (!quote) throw new BadRequestException(`linked quote draft not found: ${quoteDraftId}`);
    const quoteStatus = String(quote.status || "");
    if (["accepted", "cancelled"].includes(quoteStatus) && outcome !== "sent") return null;
    if (quoteStatus === "sent" && !(outcome === "failed" && options.allowSentFailure)) return null;
    return {
      model: "quoteDraft" as const,
      where: {
        id: quoteDraftId,
        sendTaskId: task.id,
        ...(outcome === "sent"
          ? { status: "send_queued" }
          : outcome === "failed" && options.allowSentFailure
            ? { status: { in: ["send_queued", "sent"] } }
            : { status: { notIn: ["sent", "accepted", "cancelled"] } }),
      },
      data: outcome === "sent"
        ? { status: "sent", customerNotes: "报价已通过微信发送安全流程。" }
        : outcome === "requeued"
          ? { status: "send_queued", customerNotes: reason }
          : { status: "manual_review", customerNotes: `报价发送失败，需要人工处理：${reason}` },
      required: true,
    };
  }

  acknowledgeBridgeSend(id: string, payload: {
    status: "sent" | "failed";
    version?: string;
    protocolVersion?: string;
    ackToken?: string;
    bridgeAckToken?: string;
    taskId?: string;
    attemptId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    outboxFileName?: string;
    outboxFile?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
    sentAt?: string;
  }, options: { internal?: boolean } = {}) {
    if (!appConfig.useLocalStore) return this.acknowledgePrismaBridgeSend(id, payload, options);
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const status = payload.status === "sent" ? "sent" : "failed";
    if (task.status !== "sending") {
      const replay = this.resolveLocalIdempotentBridgeAckReplay(task, payload, status);
      if (replay) return replay;
      throw new BadRequestException(`bridge ack rejected: send task is no longer waiting for bridge ack (${task.status || "unknown"})`);
    }
    const pendingAttempt = this.resolveLocalBridgeAckAttempt(task, payload);
    if (!pendingAttempt || pendingAttempt.status !== "started") {
      throw new BadRequestException("bridge ack rejected: no active bridge send attempt is waiting for ack");
    }
    const dispatchState = this.findPendingBridgeDispatchForTask(task, pendingAttempt);
    const bridgeAttemptMetadata = isPlainObject(pendingAttempt?.metadata) ? pendingAttempt.metadata : {};
    const requiresBridgeDispatch = pendingAttempt.adapter === "windows_bridge" || bridgeAttemptMetadata.requiresBridge === true;
    const protectedUnknown = this.hasUnknownSendDelivery(task, pendingAttempt);
    if (status === "sent" && requiresBridgeDispatch && !dispatchState && !protectedUnknown) {
      throw new BadRequestException("bridge ack rejected: dispatch instruction is required before marking sent");
    }
    if (status === "sent" && dispatchState?.expired && !protectedUnknown) {
      throw new BadRequestException(`bridge ack rejected: dispatch instruction expired (${dispatchState.expiresAt || dispatchState.fileName || "unknown"})`);
    }
    const binding = validateBridgeAckBinding({ task, attempt: pendingAttempt, payload });
    if (!binding.ok) {
      throw new BadRequestException(`bridge ack binding invalid: ${binding.reason}`);
    }
    const currentBinding = this.validateExistingSendTaskBinding(task);
    if (!currentBinding.ok) {
      throw new BadRequestException(`bridge ack send task binding invalid: ${currentBinding.reason}`);
    }
    if (status === "sent") {
      const orderState = this.validateQueuedOrderSendState(task);
      if (!orderState.ok) {
        const errorMessage = `bridge ack order state invalid: ${orderState.message}`;
        this.failTaskForRejectedTrustedBridgeAck(id, payload, { fileName: "direct-bridge-ack", source: "direct_ack" }, errorMessage);
        throw new BadRequestException(errorMessage);
      }
      const quoteState = this.validateQueuedQuoteSendState(task);
      if (!quoteState.ok) {
        const errorMessage = `bridge ack quote state invalid: ${quoteState.message}`;
        this.failTaskForRejectedTrustedBridgeAck(id, payload, { fileName: "direct-bridge-ack", source: "direct_ack" }, errorMessage);
        throw new BadRequestException(errorMessage);
      }
    }

    const now = new Date().toISOString();
    const outboxFileName = this.resolveBridgeAckOutboxFileName(payload, pendingAttempt);
    const shouldValidateOutboxPayload = status === "sent" || !options.internal;
    const outboxPayloadValidation = shouldValidateOutboxPayload
      ? this.validateBridgeAckOutboxPayload(task, pendingAttempt, payload, outboxFileName)
      : null;
    const preparedAttempt = this.localStore.updateSendAttempt(pendingAttempt.id, {
      metadata: {
        ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
        bridgeAck: sanitizeBridgeAckMetadata(payload.metadata),
        bridgeAckIdentity: {
          wechatAccountId: payload.wechatAccountId || "",
          conversationId: payload.conversationId || "",
          customerId: payload.customerId || "",
        },
        bridgeAckAt: now,
        bridgeAckOutboxFileName: outboxFileName,
        bridgeAckTokenHash: hashBridgeAckToken(payload),
        bridgeAckCommitPreparedAt: now,
        bridgeOutboxPayloadValidation: outboxPayloadValidation
          ? {
              ok: outboxPayloadValidation.ok,
              fileName: outboxFileName,
              checkedAt: now,
            }
          : undefined,
      },
    });
    const sentAt = status === "sent" ? payload.sentAt || now : null;
    const updatedTask = this.localStore.updateSendTask(id, {
      status,
      sentAt,
      errorMessage: status === "failed" ? payload.errorMessage || "Windows 桥接发送失败" : "",
      guardSnapshot: this.settledDeliveryGuard(task, status, now, "bridge_ack"),
    });
    if (status === "sent") void this.markLinkedQuoteSent(updatedTask);
    else void this.markLinkedQuoteFailed(updatedTask, payload.errorMessage || "Windows 桥接发送失败");

    const completedAttempt = this.localStore.updateSendAttempt(preparedAttempt.id, {
      status,
      errorMessage: payload.errorMessage || "",
      completedAt: now,
    });
    const archivedOutboxPath = outboxFileName
      ? this.archiveBridgeOutboxFile(outboxFileName, status === "sent" ? "processed" : "failed")
      : null;
    const archivedDispatchPath = this.archiveBridgeDispatchFile(
      task,
      pendingAttempt,
      status === "sent" ? "processed" : "failed",
    );
    const attempt = this.localStore.updateSendAttempt(completedAttempt.id, {
      metadata: {
        ...(isPlainObject(completedAttempt.metadata) ? completedAttempt.metadata : {}),
        archivedOutboxPath,
        archivedDispatchPath,
      },
    });
    return { task: this.localStore.getSendTask(id), attempt, binding, currentBinding };
  }

  private async acknowledgePrismaBridgeSend(id: string, payload: {
    status: "sent" | "failed";
    version?: string;
    protocolVersion?: string;
    ackToken?: string;
    bridgeAckToken?: string;
    taskId?: string;
    attemptId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    outboxFileName?: string;
    outboxFile?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
    sentAt?: string;
  }, options: { internal?: boolean } = {}) {
    const task = await this.persistence.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const status = payload.status === "sent" ? "sent" : "failed";
    if (task.status !== "sending") {
      const replay = await this.resolveIdempotentBridgeAckReplay(task, payload, status);
      if (replay) return replay;
      throw new BadRequestException(`bridge ack rejected: send task is no longer waiting for bridge ack (${task.status || "unknown"})`);
    }
    const pendingAttempt = await this.resolveBridgeAckAttempt(task, payload);
    if (!pendingAttempt || pendingAttempt.status !== "started") {
      throw new BadRequestException("bridge ack rejected: no active bridge send attempt is waiting for ack");
    }
    const dispatchState = this.findPendingBridgeDispatchForTask(task, pendingAttempt);
    const attemptMetadata = isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {};
    const requiresDispatch = pendingAttempt.adapter === "windows_bridge" || attemptMetadata.requiresBridge === true;
    const protectedUnknown = this.hasUnknownSendDelivery(task, pendingAttempt);
    if (status === "sent" && requiresDispatch && !dispatchState && !protectedUnknown) {
      throw new BadRequestException("bridge ack rejected: dispatch instruction is required before marking sent");
    }
    if (status === "sent" && dispatchState?.expired && !protectedUnknown) {
      throw new BadRequestException(`bridge ack rejected: dispatch instruction expired (${dispatchState.expiresAt || dispatchState.fileName || "unknown"})`);
    }
    const binding = validateBridgeAckBinding({ task, attempt: pendingAttempt, payload });
    if (!binding.ok) throw new BadRequestException(`bridge ack binding invalid: ${binding.reason}`);
    const currentBinding = validateSendTaskBinding({
      task,
      conversation: task.conversation,
      designJob: task.designJob,
      quoteDraft: task.quoteDraft,
    });
    if (!currentBinding.ok) {
      throw new BadRequestException(`bridge ack send task binding invalid: ${currentBinding.reason}`);
    }
    if (status === "sent") {
      const linkedState = await this.validatePrismaLinkedSendState(id);
      if (!linkedState.ok) {
        throw new BadRequestException(`bridge ack production state invalid: ${linkedState.message}`);
      }
    }

    const now = new Date().toISOString();
    const outboxFileName = this.resolveBridgeAckOutboxFileName(payload, pendingAttempt);
    const outboxValidation = status === "sent" || !options.internal
      ? this.validateBridgeAckOutboxPayload(task, pendingAttempt, payload, outboxFileName)
      : null;
    const linkedTransition = await this.buildPrismaLinkedTransition(
      task,
      status === "sent" ? "sent" : "failed",
      payload.errorMessage || "Windows 桥接发送失败",
    );
    const completed = await this.persistence.completeAttemptAndTask({
      taskId: id,
      attemptId: pendingAttempt.id,
      expectedTaskStatus: "sending",
      attemptPatch: {
        status,
        errorMessage: payload.errorMessage || "",
        metadata: {
          ...attemptMetadata,
          bridgeAck: sanitizeBridgeAckMetadata(payload.metadata),
          bridgeAckIdentity: {
            wechatAccountId: payload.wechatAccountId || "",
            conversationId: payload.conversationId || "",
            customerId: payload.customerId || "",
          },
          bridgeAckAt: now,
          bridgeAckOutboxFileName: outboxFileName,
          bridgeAckTokenHash: hashBridgeAckToken(payload),
          bridgeOutboxPayloadValidation: outboxValidation
            ? { ok: outboxValidation.ok, fileName: outboxFileName, checkedAt: now }
            : undefined,
        },
        completedAt: now,
      },
      taskPatch: {
        status,
        sentAt: status === "sent" ? payload.sentAt || now : null,
        errorMessage: status === "failed" ? payload.errorMessage || "Windows 桥接发送失败" : "",
        guardSnapshot: this.settledDeliveryGuard(task, status, now, "bridge_ack"),
      },
      linkedTransition,
    });
    if (!completed) throw new BadRequestException("send task state changed before bridge acknowledgement completion");

    // Files remain in place until the task + attempt transition is durably committed.
    const archivedOutboxPath = outboxFileName
      ? this.archiveBridgeOutboxFile(outboxFileName, status === "sent" ? "processed" : "failed")
      : null;
    const archivedDispatchPath = this.archiveBridgeDispatchFile(task, pendingAttempt, status === "sent" ? "processed" : "failed");
    const attempt = await this.persistence.updateSendAttempt(completed.attempt.id, {
      metadata: { archivedOutboxPath, archivedDispatchPath, bridgeAckArchivedAt: new Date().toISOString() },
    });
    return { task: completed.task, attempt, binding, currentBinding };
  }

  async requeueSendTask(id: string, payload: { reason?: string } & ExpectedIdentityPayload = {}) {
    const task = await this.persistence.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(task, payload, "send task");
    const decision = evaluateSendTaskRequeue({ task });
    if (!decision.ok) {
      if (decision.reason === "sent_task") throw new BadRequestException("sent task cannot be requeued");
      throw new BadRequestException(decision.message || decision.reason || "send task cannot be requeued");
    }
    const binding = await this.assertSendTaskBinding({
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.customerId || task.payload?.customerId || null,
      designJobId: task.designJobId,
      quoteDraftId: task.quoteDraftId,
      manualReply: Boolean(task.payload?.manualReply || task.guardSnapshot?.manualReply),
    });
    if (appConfig.useLocalStore) {
      this.assertOrderSendTaskStillQueueable(task);
    } else {
      const productionState = await this.validatePrismaLinkedSendState(task, { requireQuoteQueued: false });
      if (!productionState.ok) throw new BadRequestException(`send task requeue rejected: ${productionState.message}`);
    }
    const now = new Date().toISOString();
    const requeueReason = payload.reason || "发送任务已重新排队";
    const previousGuardSnapshot = isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {};
    const taskPatch = {
      status: "queued",
      queuedAt: now,
      sentAt: null,
      errorMessage: "",
      guardSnapshot: {
        ...previousGuardSnapshot,
        requiredChecks: task.guardSnapshot?.requiredChecks || ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
        policy: task.guardSnapshot?.policy || "single-account-serial-queue",
        status: "pending",
        checks: [],
        binding,
        requeuedAt: now,
        opsAlertedStatus: "requeued",
        opsAlertedAt: now,
        deliveryState: "not_started",
        wechatWorkDeliveryState: "not_started",
        automaticRetryBlocked: false,
        manualReviewRequired: false,
        previousManualDeliveryResolution: isPlainObject(previousGuardSnapshot.manualDeliveryResolution)
          ? previousGuardSnapshot.manualDeliveryResolution
          : previousGuardSnapshot.previousManualDeliveryResolution || null,
        manualDeliveryResolution: null,
        requeueReason: payload.reason || "人工重新排队",
        history: [
          ...this.guardHistory(task),
          {
            action: "requeue",
            fromStatus: task.status,
            reason: payload.reason || "",
            at: now,
          },
        ],
      },
    };
    const updated = appConfig.useLocalStore
      ? await this.persistence.updateSendTask(id, taskPatch)
      : await this.persistence.updateSendTaskWithLinkedTransition({
          taskId: id,
          expectedTaskStatus: task.status,
          taskPatch,
          linkedTransition: await this.buildPrismaLinkedTransition(task, "requeued", requeueReason),
        });
    if (!updated) throw new BadRequestException("send task changed before requeue completion");
    if (appConfig.useLocalStore) {
      await this.markLinkedQuoteRequeued(updated, requeueReason);
      await this.markLinkedOrderSendRequeued(updated, requeueReason);
    }
    return updated;
  }

  cancelSendTask(id: string, payload: { reason?: string } & ExpectedIdentityPayload = {}) {
    if (!appConfig.useLocalStore) return this.cancelPrismaSendTask(id, payload);
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(task, payload, "send task");
    if (task.status === "sent") throw new Error("sent task cannot be cancelled");
    if (task.status === "sending") {
      return this.protectLocalInflightSendFromCancellation(task, payload.reason);
    }
    if (task.status === "cancelled" && (task.guardSnapshot?.cancelledAt || task.guardSnapshot?.cancelReason)) {
      throw new BadRequestException("该发送任务已人工取消并记录审计，不能重复取消或覆盖原处理记录。");
    }
    const now = new Date().toISOString();
    const reason = payload.reason || "人工取消发送任务";
    const pendingBridgeAttempt = this.localStore.getLatestSendAttempt(id, { adapter: "windows_bridge", status: "started" });
    if (pendingBridgeAttempt) {
      const outboxFileName = this.resolveBridgeAckOutboxFileName({}, pendingBridgeAttempt);
      const archivedOutboxPath = outboxFileName ? this.archiveBridgeOutboxFile(outboxFileName, "cancelled") : null;
      const archivedDispatchPath = this.archiveBridgeDispatchFile(task, pendingBridgeAttempt, "cancelled");
      this.localStore.updateSendAttempt(pendingBridgeAttempt.id, {
        status: "failed",
        errorMessage: reason,
        metadata: { cancelledAt: now, cancelReason: reason, bridgeAckOutboxFileName: outboxFileName, archivedOutboxPath, archivedDispatchPath },
        completedAt: now,
      });
    }
    const updated = this.localStore.updateSendTask(id, {
      status: "cancelled",
      sentAt: null,
      errorMessage: reason,
      guardSnapshot: {
        ...(task.guardSnapshot || {}),
        status: "cancelled",
        cancelledAt: now,
        cancelReason: reason,
        history: [...this.guardHistory(task), { action: "cancel", fromStatus: task.status, reason, at: now }],
      },
    });
    this.markLinkedQuoteFailed(updated, reason);
    return updated;
  }

  private async cancelPrismaSendTask(id: string, payload: { reason?: string } & ExpectedIdentityPayload = {}) {
    const task = await this.persistence.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    assertExpectedIdentity(task, payload, "send task");
    if (task.status === "sent") throw new Error("sent task cannot be cancelled");
    if (task.status === "sending") {
      return this.protectPrismaInflightSendFromCancellation(task, payload.reason);
    }
    if (task.status === "cancelled" && (task.guardSnapshot?.cancelledAt || task.guardSnapshot?.cancelReason)) {
      throw new BadRequestException("该发送任务已人工取消并记录审计，不能重复取消或覆盖原处理记录。");
    }
    const now = new Date().toISOString();
    const reason = payload.reason || "人工取消发送任务";
    const pendingAttempt = await this.persistence.getLatestSendAttempt(id, { status: "started" });
    const completed = await this.persistence.cancelTaskAndAttempt({
      taskId: id,
      expectedTaskStatus: task.status,
      taskPatch: {
        status: "cancelled",
        sentAt: null,
        errorMessage: reason,
        guardSnapshot: {
          ...(task.guardSnapshot || {}),
          status: "cancelled",
          cancelledAt: now,
          cancelReason: reason,
          history: [
            ...this.guardHistory(task),
            { action: "cancel", fromStatus: task.status, reason, at: now },
          ],
        },
      },
      attemptId: pendingAttempt?.id,
      attemptPatch: pendingAttempt
        ? {
            status: "failed",
            errorMessage: reason,
            metadata: {
              ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
              cancelledAt: now,
              cancelReason: reason,
              deliveryState: pendingAttempt.adapter === "wechat_work_kf" ? "unknown_after_cancel" : "cancelled",
            },
            completedAt: now,
          }
        : undefined,
    });
    if (!completed) throw new BadRequestException("send task state changed before cancellation completed");
    if (pendingAttempt?.adapter === "windows_bridge") {
      const outboxFileName = this.resolveBridgeAckOutboxFileName({}, pendingAttempt);
      const archivedOutboxPath = outboxFileName ? this.archiveBridgeOutboxFile(outboxFileName, "cancelled") : null;
      const archivedDispatchPath = this.archiveBridgeDispatchFile(task, pendingAttempt, "cancelled");
      await this.persistence.updateSendAttempt(pendingAttempt.id, {
        metadata: {
          bridgeAckOutboxFileName: outboxFileName,
          archivedOutboxPath,
          archivedDispatchPath,
        },
      });
    }
    return completed.task;
  }

  async resolveUnknownSendDelivery(
    id: string,
    payload: SendDeliveryResolutionPayload,
    reviewer = "operator",
  ) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "operationKey");
    if (!payload || !["confirmed_sent", "confirmed_not_sent"].includes(String(payload.resolution || ""))) {
      throw new BadRequestException("resolution must be confirmed_sent or confirmed_not_sent");
    }
    const task = await this.persistence.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const identity = this.requireExactSendTaskIdentity(task, payload);
    const reason = String(payload.reason || "manual delivery verification").trim() || "manual delivery verification";
    const requestOperation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "wechat-send-delivery-resolution",
        identity,
        { resolution: payload.resolution, reason },
      ),
    );
    const storedResolution = isPlainObject(task.guardSnapshot?.manualDeliveryResolution)
      ? task.guardSnapshot.manualDeliveryResolution
      : null;
    if (storedResolution) {
      assertExactOperationReplay(
        readRequestOperationMetadata(storedResolution),
        requestOperation,
        "send delivery resolution",
      );
      await this.recordManualSendDeliveryResolutionAudit(task, storedResolution, operationKey);
      return task;
    }

    const attempt = await this.persistence.getLatestSendAttempt(id);
    if (!this.hasUnknownSendDelivery(task, attempt)) {
      throw new BadRequestException("send task delivery is not unknown or no longer requires manual review");
    }
    if (!attempt) throw new BadRequestException("send task has no persisted attempt to resolve");

    const now = new Date().toISOString();
    const resolution = payload.resolution;
    const taskStatus = resolution === "confirmed_sent" ? "sent" : "failed";
    const manualDeliveryResolution = {
      resolution,
      reason,
      reviewer,
      resolvedAt: now,
      identity,
      requestOperation,
    };
    const linkedTransition = appConfig.useLocalStore
      ? null
      : await this.buildPrismaLinkedTransition(
          task,
          resolution === "confirmed_sent" ? "sent" : "failed",
          reason,
        );
    const completed = await this.persistence.completeAttemptAndTask({
      taskId: task.id,
      attemptId: attempt.id,
      expectedTaskStatus: task.status,
      expectedTaskUpdatedAt: task.updatedAt,
      expectedAttemptStatus: attempt.status,
      attemptPatch: {
        status: taskStatus,
        errorMessage: resolution === "confirmed_not_sent" ? reason : "",
        completedAt: now,
        metadata: {
          ...(isPlainObject(attempt.metadata) ? attempt.metadata : {}),
          deliveryState: resolution,
          automaticRetryBlocked: false,
          manualReviewRequired: false,
          manualDeliveryResolution,
          deliveryResolutionPriority: "manual_audited_terminal",
        },
      },
      taskPatch: {
        status: taskStatus,
        sentAt: resolution === "confirmed_sent" ? now : null,
        errorMessage: resolution === "confirmed_not_sent" ? reason : "",
        guardSnapshot: {
          ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
          status: taskStatus,
          deliveryState: resolution,
          wechatWorkDeliveryState: resolution,
          automaticRetryBlocked: false,
          manualReviewRequired: false,
          manualDeliveryResolution,
          deliveryResolutionPriority: "manual_audited_terminal",
          history: [
            ...this.guardHistory(task),
            { action: "resolve_delivery", fromStatus: task.status, reason, reviewer, resolution, at: now },
          ],
        },
      },
      linkedTransition,
    });
    if (!completed) {
      const winner = await this.persistence.getSendTask(id);
      const winnerResolution = isPlainObject(winner?.guardSnapshot?.manualDeliveryResolution)
        ? winner.guardSnapshot.manualDeliveryResolution
        : null;
      if (!winner || !winnerResolution) {
        throw new BadRequestException("send task state changed before manual delivery resolution completed");
      }
      assertExactOperationReplay(
        readRequestOperationMetadata(winnerResolution),
        requestOperation,
        "send delivery resolution",
      );
      await this.recordManualSendDeliveryResolutionAudit(winner, winnerResolution, operationKey);
      return winner;
    }
    if (appConfig.useLocalStore) {
      if (resolution === "confirmed_sent") await this.markLinkedQuoteSent(completed.task);
      else await this.markLinkedQuoteFailed(completed.task, reason);
    }
    await this.recordManualSendDeliveryResolutionAudit(completed.task, manualDeliveryResolution, operationKey);
    return completed.task;
  }

  async settleWechatWorkAsyncFailure(
    suppliedAttempt: any,
    errorMessage: string,
    details: Record<string, unknown> = {},
  ) {
    const task = await this.persistence.getSendTask(suppliedAttempt?.sendTaskId);
    if (!task) return { task: null, attempt: suppliedAttempt || null, changed: false, reason: "send_task_missing" };
    const attempt = (await this.persistence.listSendAttempts({ sendTaskId: task.id, limit: 300 }))
      .find((item: any) => item.id === suppliedAttempt?.id) || suppliedAttempt;
    const manualResolution = isPlainObject(task.guardSnapshot?.manualDeliveryResolution)
      ? task.guardSnapshot.manualDeliveryResolution
      : null;
    if (manualResolution) {
      return {
        task,
        attempt,
        changed: false,
        reason: `manual_resolution_${String(manualResolution.resolution || "unknown")}_is_terminal`,
      };
    }
    if (task.status === "failed" && attempt?.status === "failed") {
      return { task, attempt, changed: false, reason: "failure_already_settled" };
    }
    if (!attempt || !["started", "sent"].includes(String(attempt.status || ""))) {
      return { task, attempt, changed: false, reason: "attempt_is_already_terminal" };
    }
    if (!["sending", "sent"].includes(String(task.status || ""))) {
      return { task, attempt, changed: false, reason: "task_is_already_terminal" };
    }

    const failedAt = new Date().toISOString();
    const linkedTransition = appConfig.useLocalStore
      ? null
      : await this.buildPrismaLinkedTransition(task, "failed", errorMessage, { allowSentFailure: true });
    const completed = await this.persistence.completeAttemptAndTask({
      taskId: task.id,
      attemptId: attempt.id,
      expectedTaskStatus: task.status,
      expectedTaskUpdatedAt: task.updatedAt,
      expectedAttemptStatus: attempt.status,
      attemptPatch: {
        status: "failed",
        errorMessage,
        completedAt: failedAt,
        metadata: {
          ...(isPlainObject(attempt.metadata) ? attempt.metadata : {}),
          ...details,
          bridgeState: "async_delivery_failed",
          deliveryState: "failed",
          finalDeliveryPendingFailureEvent: false,
          automaticRetryBlocked: false,
          manualReviewRequired: false,
        },
      },
      taskPatch: {
        status: "failed",
        sentAt: null,
        errorMessage,
        guardSnapshot: {
          ...this.settledDeliveryGuard(task, "failed", failedAt, "wechat_work_async_failure"),
          wechatWorkAsyncFailureMsgId: details.failureEventMsgId || null,
          wechatWorkAsyncFailType: details.failType ?? null,
          wechatWorkAsyncFailedAt: failedAt,
        },
      },
      linkedTransition,
    });
    if (!completed) {
      return {
        task: await this.persistence.getSendTask(task.id),
        attempt: await this.persistence.getLatestSendAttempt(task.id, { adapter: "wechat_work_kf" }),
        changed: false,
        reason: "state_changed_before_async_failure_settlement",
      };
    }
    if (appConfig.useLocalStore) {
      await this.markLinkedQuoteFailed(completed.task, errorMessage, { allowSentFailure: true });
    }
    return { ...completed, changed: true, reason: "async_failure_settled" };
  }

  private blockSendTask(id: string, reason: string, guardSnapshot: Record<string, unknown>) {
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const updated = this.localStore.updateSendTask(id, {
      status: "blocked",
      errorMessage: reason,
      guardSnapshot: {
        ...(task.guardSnapshot || {}),
        ...guardSnapshot,
        status: "blocked",
        reason,
        validatedAt: new Date().toISOString(),
      },
    });
    this.markLinkedOrderSendFailed(updated, reason);
    return updated;
  }

  private async alertLowValueQueueBlocked(task: any, queueHeadTask: any, advice: any) {
    if (!isLowValueAutomationTask(task)) return;
    const blockingTaskId = advice?.blockingTaskId || queueHeadTask?.id || "";
    const guardSnapshot = task.guardSnapshot || {};
    if (guardSnapshot.queueBlockedAlertedBy === blockingTaskId) return;
    this.localStore.updateSendTask(task.id, {
      guardSnapshot: {
        ...guardSnapshot,
        queueBlockedAlertedBy: blockingTaskId,
        queueBlockedAlertedAt: new Date().toISOString(),
        queueBlockedAdvice: advice,
      },
    });
    await this.notifications.create(
      "warning",
      "低价值自动发送被前序任务卡住",
      advice?.message || "同一微信账号前面还有待处理任务，当前低价值任务不能插队。",
      {
        sendTaskId: task.id,
        blockingTaskId: blockingTaskId || undefined,
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        recommendedAction: advice?.recommendedAction,
      },
    );
  }

  private resolveInboundConversation(payload: { wechatAccountId?: string; conversationId?: string; customerId?: string }) {
    const allConversations = this.localStore.listConversations();
    const conversation = payload.conversationId
      ? allConversations.find((item) => item.id === payload.conversationId)
      : null;
    const binding = validateInboundConversationBinding({
      requestedWechatAccountId: payload.wechatAccountId,
      requestedConversationId: payload.conversationId,
      conversation,
    });
    if (!binding.ok) {
      throw new BadRequestException(`inbound conversation binding invalid: ${binding.reason}`);
    }
    if (payload.customerId && payload.customerId !== conversation?.customerId) {
      throw new BadRequestException("inbound customer binding invalid: requested customer does not match conversation");
    }
    return conversation;
  }

  private async requireCompleteConversationIdentity(filter: IdentityFilter, label: string) {
    const missing = [
      !String(filter.wechatAccountId || "").trim() ? "wechatAccountId" : "",
      !String(filter.conversationId || "").trim() ? "conversationId" : "",
      !String(filter.customerId || "").trim() ? "customerId" : "",
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`${label} requires complete conversation identity: ${missing.join(", ")}`);
    const conversation = appConfig.useLocalStore
      ? this.localStore
          .listConversations(filter.wechatAccountId)
          .find((item) => item.id === filter.conversationId) || null
      : await this.prisma.conversation.findUnique({ where: { id: filter.conversationId } });
    if (!conversation) throw new BadRequestException(`${label} conversation not found`);
    if (conversation.wechatAccountId !== filter.wechatAccountId) {
      throw new BadRequestException(`${label} wechat account binding invalid`);
    }
    if (conversation.customerId !== filter.customerId) {
      throw new BadRequestException(`${label} customer binding invalid`);
    }
    return conversation;
  }

  private findLatestSceneClarification(conversationId: string) {
    return findPendingSceneClarificationContext(this.localStore.listRouteEvaluations({ conversationId }), conversationId);
  }

  private listSceneMemorySamples(filter: IdentityFilter = {}) {
    return this.localStore
      .listTrainingSamples(filter)
      .filter((sample: any) => isSceneMemorySample(sample))
      .sort((a: any, b: any) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 200);
  }

  private recommendGiftBundle(route: any, text: string) {
    const skus = this.localStore.listSkus().map((sku: any) => ({
      ...sku,
      costPrice: Number(sku.costPrice || 0),
      salePrice: Number(sku.salePrice || 0),
      sceneTags: Array.isArray(sku.sceneTags) ? sku.sceneTags : [],
      replacementSkuCodes: Array.isArray(sku.replacementSkuCodes) ? sku.replacementSkuCodes : [],
    }));
    return recommendBundle({
      skus,
      budget: route.budget || {},
      scene: route.scene || text || "",
      maxItems: 6,
    });
  }

  private createDesignDraftFromInbound(params: {
    messageId: string;
    conversation: any;
    route: any;
    assetIds: string[];
    bundleRecommendation: any;
    customerText: string;
  }) {
    const giftBox = params.bundleRecommendation?.items?.find((item: any) => item.type === "gift_box") || null;
    const operationKey = stableOperationKey(
      "inbound-design",
      `${params.conversation.id}:${params.messageId}`,
    );
    const operation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "inbound-design-job-create",
        {
          customerId: params.conversation.customerId,
          conversationId: params.conversation.id,
          wechatAccountId: params.conversation.wechatAccountId,
        },
        {
          budget: params.route.budget || {},
          scene: params.route.scene || "",
          customerText: params.customerText,
          assetIds: [...params.assetIds].sort(),
          bundleRecommendation: params.bundleRecommendation || null,
        },
      ),
    );
    const job = this.localStore.createDesignJob({
      requestId: operationKey,
      customerId: params.conversation.customerId,
      conversationId: params.conversation.id,
      wechatAccountId: params.conversation.wechatAccountId,
      budget: params.route.budget || {},
      scene: params.route.scene || "",
      customerText: params.customerText,
      designType: "bundle_render",
      outputCount: appConfig.defaultOutputCount,
      bundle: {
        giftBox,
        items: params.bundleRecommendation?.items || [],
        totals: params.bundleRecommendation?.totals || {},
        automation: params.bundleRecommendation?.automation || null,
        warnings: params.bundleRecommendation?.warnings || [],
      },
      assetIds: params.assetIds,
      assets: params.assetIds.map((assetId) => ({ assetId, type: "customer_asset" })),
      requirements: {
        useRealSkuImages: true,
        showAllItems: true,
        noWatermark: true,
        highResolution: true,
        requestOperation: operation,
      },
      status: "draft",
    });
    return job;
  }

  private validateInboundAssetBinding(conversation: any, assetIds: string[]) {
    const requestedAssetIds = [...new Set((assetIds || []).filter(Boolean).map(String))];
    if (!requestedAssetIds.length) return;
    const assets = this.localStore
      .listDesignAssets()
      .filter((asset: any) => requestedAssetIds.includes(asset.id));
    const binding = validateDesignAssetBinding({
      designJob: {
        id: `inbound:${conversation.id}`,
        customerId: conversation.customerId,
      },
      assets,
      requestedAssetIds,
    });
    if (!binding.ok) throw new BadRequestException(`inbound asset binding invalid: ${binding.reason}`);
  }

  private async handleInboundImageSelection(params: {
    operationId: string;
    claimToken: string;
    operationResult?: unknown;
    conversation: any;
    message: any;
    route: any;
    payload: {
      text?: string;
      attachments?: Array<Record<string, unknown>>;
    };
  }) {
    const recovery = inboundSelectionRecovery(params.operationResult);
    if (recovery) {
      const recoveryJob = this.localStore.getDesignJob(recovery.designJobId);
      if (!recoveryJob || !this.jobMatchesConversationIdentity(recoveryJob, params.conversation)) {
        throw new BadRequestException("inbound selection recovery lost its durable design job binding");
      }
      const recoveryCandidate = (recoveryJob.images || []).find(
        (image: any) => String(image.id || image.imageId || "") === recovery.selectedImageId,
      );
      if (!recoveryCandidate) {
        throw new BadRequestException("inbound selection recovery lost its durable image binding");
      }
      const recoveredSelection = {
        action: "select_image",
        ok: true,
        reviewRequired: false,
        reason: recovery.kind === "high_value_image_selection"
          ? "high_value_customer_selected_image"
          : "low_value_customer_selected_image",
        result: { candidate: recoveryCandidate, imageId: recovery.selectedImageId, source: "durable_recovery" },
      };
      if (recovery.kind === "high_value_image_selection") {
        return this.finishLocalHighValueSelection(params, recoveryJob, recovery.selectedImageId, recoveredSelection);
      }
      const recoveredQuote = recovery.quoteDraftId
        ? this.localStore.getQuoteDraft(recovery.quoteDraftId)
        : null;
      if (
        !recoveredQuote ||
        recoveredQuote.designJobId !== recoveryJob.id ||
        recoveredQuote.selectedImageId !== recovery.selectedImageId
      ) {
        throw new BadRequestException("low-value inbound selection recovery lost its durable quote binding");
      }
      return this.finishLocalLowValueSelection(params, recoveryJob, recoveredQuote, recovery.selectedImageId, recoveredSelection);
    }
    const job = this.findLatestSelectableDesignJob(params.conversation);
    const candidates = job ? [...(job.images || [])].sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0)) : [];
    if (this.hasInboundPaymentProof(params.payload)) return null;
    const selectionPlan = planCustomerImageSelection({
      ...this.buildInboundSelectionInput(params.payload),
      candidates,
    });

    if (selectionPlan.action === "skip") return null;
    if (this.shouldLetQuoteAcceptanceHandleSelectionText(params.payload, selectionPlan)) return null;

    const result: any = {
      message: params.message,
      route: params.route,
      plan: {
        type: selectionPlan.action,
        reason: selectionPlan.reason,
        shouldNotifyHuman: Boolean(selectionPlan.reviewRequired),
        shouldCreateDesignJob: false,
        shouldQueueReply: false,
      },
      sendTask: null,
      designJob: job,
      notification: null,
      bundleRecommendation: null,
      selection: selectionPlan,
      quote: null,
    };

    if (!job) {
      result.notification = await this.createInboundSelectionReview(params.conversation, params.route, {
        operationId: params.operationId,
        reason: "selection_without_active_design_job",
        title: "客户疑似选图但没有可匹配设计任务",
        body: "客户消息像是在选择效果图，但当前会话没有已发送的候选图，需要人工确认。",
      });
      return result;
    }

    if (!selectionPlan.ok || selectionPlan.reviewRequired || !selectionPlan.result?.candidate) {
      result.notification = await this.createInboundSelectionReview(params.conversation, params.route, {
        operationId: params.operationId,
        reason: selectionPlan.reason || "selection_uncertain",
        title: "客户选图需要人工确认",
        body: "客户表达了选图意图，但系统没有高置信匹配到具体候选图。",
        designJobId: job.id,
      });
      return result;
    }

    const selectedImageId = selectionPlan.result.candidate.id || selectionPlan.result.candidate.imageId;
    const feedback = this.inboundSelectionFeedback(params.payload, selectionPlan.result);

    if (this.shouldManualReviewSelectedJob(job)) {
      const recoveryEffect = {
        kind: "high_value_image_selection",
        phase: "selection_committed",
        designJobId: job.id,
        selectedImageId: String(selectedImageId),
        routeEvaluationId: params.route.id,
      };
      const updated = this.localStore.commitInboundHighValueSelection({
        operationId: params.operationId,
        claimToken: params.claimToken,
        leaseExpiresAt: this.nextInboundLeaseExpiry(),
        designJobId: job.id,
        selectedImageId: String(selectedImageId),
        feedback,
        recoveryEffect,
      });
      return this.finishLocalHighValueSelection(params, updated, String(selectedImageId), selectionPlan);
    }

    const existingQuote = this.localStore
      .listQuoteDrafts()
      .find((quote: any) => quote.designJobId === job.id);
    if (existingQuote?.sendTaskId || existingQuote?.status === "sent") {
      result.notification = await this.createInboundSelectionReview(params.conversation, params.route, {
        operationId: params.operationId,
        reason: "quote_already_queued_or_sent",
        title: "客户在报价后再次选图",
        body: "该设计任务已有报价发送记录，客户再次选图需要人工确认是否改报价。",
        designJobId: job.id,
        selectedImageId,
      });
      result.plan.reason = "quote_already_queued_or_sent";
      result.plan.shouldNotifyHuman = true;
      return result;
    }

    const recoveryEffect = {
      kind: "low_value_image_selection",
      phase: "selection_committed",
      designJobId: job.id,
      selectedImageId: String(selectedImageId),
      routeEvaluationId: params.route.id,
    };
    const committed = this.localStore.commitInboundLowValueSelection({
      operationId: params.operationId,
      claimToken: params.claimToken,
      leaseExpiresAt: this.nextInboundLeaseExpiry(),
      designJobId: job.id,
      selectedImageId: String(selectedImageId),
      feedback,
      recoveryEffect,
      highValueAmountCny: appConfig.highValueAmountCny,
    });
    return this.finishLocalLowValueSelection(
      params,
      committed.designJob,
      committed.quote,
      String(selectedImageId),
      selectionPlan,
    );
  }

  private async finishLocalLowValueSelection(
    params: { operationId: string; conversation: any; message: any; route: any },
    job: any,
    quote: any,
    selectedImageId: string,
    selectionPlan: any,
  ) {
    let quoteSend: any;
    if (quote.sendTaskId) {
      const sendTask = this.localStore.getSendTask(quote.sendTaskId);
      if (!sendTask) throw new BadRequestException("low-value inbound selection recovery lost its durable send task binding");
      quoteSend = { quote, sendTask };
    } else {
      quoteSend = await this.tryQueueLowValueQuoteAfterSelection(quote);
    }
    const notification = await this.notifications.create(
      "info",
      "低价值客户已选图，已生成报价草稿",
      "客户选图置信度高，系统已绑定候选图并生成报价草稿，后台低价值自动化会继续处理报价发送队列。",
      {
        effectKey: `${params.operationId}:low-value-selection-notification`,
        designJobId: job.id,
        quoteDraftId: quoteSend.quote.id,
        selectedImageId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
      },
    );
    return {
      message: params.message,
      route: params.route,
      plan: {
        type: "select_design_image_and_create_quote",
        reason: quoteSend.sendTask ? "low_value_customer_selected_image_quote_queued" : "low_value_customer_selected_image",
        shouldNotifyHuman: false,
        shouldCreateDesignJob: false,
        shouldQueueReply: Boolean(quoteSend.sendTask),
      },
      sendTask: quoteSend.sendTask,
      designJob: job,
      notification,
      bundleRecommendation: null,
      selection: selectionPlan,
      quote: quoteSend.quote,
    };
  }

  private async finishLocalHighValueSelection(
    params: { operationId: string; conversation: any; message: any; route: any },
    job: any,
    selectedImageId: string,
    selectionPlan: any,
  ) {
    const manualLock = await this.lockConversationForManualReview(params.conversation, {
      reviewer: "system",
      reason: "high_value_customer_selected_image",
      effectKey: `${params.operationId}:high-value-selection-lock`,
    });
    this.localStore.createReviewLog({
      targetType: "design_job",
      targetId: job.id,
      decision: "high_value_customer_selected_image",
      reviewer: "system",
      note: "高价值客户已选定效果图，需要人工复核报价、利润和跟进话术后再发送。",
      beforeStatus: job.status || "",
      afterStatus: "manual_review",
      metadata: {
        effectKey: `${params.operationId}:high-value-selection-review`,
        source: "inbound_image_selection",
        selectedImageId,
        routeId: params.route.id,
        wechatAccountId: params.conversation.wechatAccountId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
        blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    });
    const notification = await this.notifications.create(
      "warning",
      "高价值客户已选图，转人工报价",
      "客户已明确选择效果图，请人工确认报价、交期和后续跟进。",
      {
        effectKey: `${params.operationId}:high-value-selection-notification`,
        designJobId: job.id,
        selectedImageId,
        wechatAccountId: params.conversation.wechatAccountId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
        blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    );
    return {
      message: params.message,
      route: params.route,
      plan: {
        type: selectionPlan?.action || "select_image",
        reason: "high_value_customer_selected_image",
        shouldNotifyHuman: true,
        shouldCreateDesignJob: false,
        shouldQueueReply: false,
      },
      sendTask: null,
      designJob: job,
      notification,
      bundleRecommendation: null,
      selection: selectionPlan,
      quote: null,
      manualLock,
    };
  }

  private async handleInboundQuoteAcceptance(params: {
    operationId: string;
    claimToken: string;
    operationResult?: unknown;
    conversation: any;
    message: any;
    route: any;
    payload: { text?: string; assetIds?: string[]; attachments?: Array<Record<string, unknown>> };
  }) {
    const recovery = inboundQuoteAcceptanceRecovery(params.operationResult);
    if (recovery) {
      const quote = this.localStore.getQuoteDraft(recovery.quoteDraftId);
      const orderDraft = this.localStore.getOrderDraft(recovery.orderDraftId);
      if (!quote || !this.jobMatchesConversationIdentity(quote.designJob, params.conversation)) {
        throw new BadRequestException("inbound quote acceptance recovery lost its durable quote binding");
      }
      if (
        !orderDraft ||
        orderDraft.quoteDraftId !== quote.id ||
        String(orderDraft.wechatAccountId || "") !== String(params.conversation.wechatAccountId || "") ||
        String(orderDraft.conversationId || "") !== String(params.conversation.id || "") ||
        String(orderDraft.customerId || "") !== String(params.conversation.customerId || "")
      ) {
        throw new BadRequestException("inbound quote acceptance recovery lost its durable order binding");
      }
      return this.finishLocalQuoteAcceptance(params, quote, orderDraft, recovery.acceptancePlan);
    }
    const quote = this.findLatestQuoteForConversation(params.conversation);
    const existingOrderDraft = quote
      ? this.localStore.listOrderDrafts().find((order: any) => order.quoteDraftId === quote.id) || null
      : null;
    const acceptancePlan = planInboundQuoteAcceptance(
      {
        text: params.payload.text || "",
        quote,
        existingOrderDraft,
      },
      { highValueAmountCny: appConfig.highValueAmountCny },
    );

    if (acceptancePlan.reason === "no_quote_acceptance_intent") {
      if (!quote || !this.hasInboundPaymentProof(params.payload)) return null;
      const reviewQuote = this.localStore.updateQuoteDraft(quote.id, {
        status: "manual_review",
        owner: quote.owner || "人工客服",
        customerNotes: appendCustomerNote(quote.customerNotes, "客户发送付款凭证，需要人工核验金额和收款状态。"),
      });
      const result: any = {
        message: params.message,
        route: params.route,
        plan: {
          type: "quote_payment_proof_manual_review",
          reason: "payment_proof_needs_manual_verification",
          shouldNotifyHuman: true,
          shouldCreateDesignJob: false,
          shouldQueueReply: false,
        },
        sendTask: null,
        designJob: reviewQuote?.designJob || quote?.designJob || null,
        notification: null,
        bundleRecommendation: null,
        quote: reviewQuote,
        orderDraft: existingOrderDraft,
        quoteAcceptance: {
          ...acceptancePlan,
          hasIntent: true,
          reason: "payment_proof_needs_manual_verification",
        },
      };
      result.notification = await this.createInboundQuoteReview(params.conversation, params.route, quote, {
        operationId: params.operationId,
        reason: "payment_proof_needs_manual_verification",
        title: "客户发送付款凭证，需要人工核验",
        body: "客户消息里带有付款截图、转账凭证或收款相关附件，但文字没有明确说明已付金额。系统未自动改付款状态，请人工核对后再标记定金或全款。",
      });
      return result;
    }
    if (!quote && acceptancePlan.reason === "missing_active_quote") return null;

    if (
      quote &&
      acceptancePlan.ok &&
      this.hasInboundPaymentProof(params.payload) &&
      ["deposit_paid", "paid"].includes(
        acceptancePlan.quotePatch?.paymentStatus || acceptancePlan.orderPatch?.paymentStatus || "",
      )
    ) {
      const reviewQuote = this.localStore.updateQuoteDraft(quote.id, {
        status: "manual_review",
        owner: quote.owner || "人工客服",
        customerNotes: appendCustomerNote(quote.customerNotes, "客户文字说明已付款并发送凭证，需要人工核验金额和收款账户。"),
      });
      const result: any = {
        message: params.message,
        route: params.route,
        plan: {
          type: "quote_payment_proof_manual_review",
          reason: "payment_proof_needs_manual_verification",
          shouldNotifyHuman: true,
          shouldCreateDesignJob: false,
          shouldQueueReply: false,
        },
        sendTask: null,
        designJob: reviewQuote?.designJob || quote?.designJob || null,
        notification: null,
        bundleRecommendation: null,
        quote: reviewQuote,
        orderDraft: existingOrderDraft,
        quoteAcceptance: {
          ...acceptancePlan,
          ok: false,
          hasIntent: true,
          reason: "payment_proof_needs_manual_verification",
          originalReason: acceptancePlan.reason,
        },
      };
      result.notification = await this.createInboundQuoteReview(params.conversation, params.route, quote, {
        operationId: params.operationId,
        reason: "payment_proof_needs_manual_verification",
        title: "客户发送付款凭证，需要人工核验",
        body: "客户文字说明已付款，且消息里带有付款截图、转账凭证或收款相关附件。系统未自动改付款状态，请人工核对金额和收款账户后再标记定金或全款。",
      });
      return result;
    }

    const result: any = {
      message: params.message,
      route: params.route,
      plan: {
        type: acceptancePlan.ok ? "quote_accepted" : "quote_acceptance_manual_review",
        reason: acceptancePlan.reason,
        shouldNotifyHuman: !acceptancePlan.ok,
        shouldCreateDesignJob: false,
        shouldQueueReply: false,
      },
      sendTask: null,
      designJob: quote?.designJob || null,
      notification: null,
      bundleRecommendation: null,
      quote,
      orderDraft: null,
      quoteAcceptance: acceptancePlan,
    };

    if (!acceptancePlan.ok) {
      if (acceptancePlan.reason === "order_payment_already_recorded") return null;
      result.notification = await this.createInboundQuoteReview(params.conversation, params.route, quote, {
        operationId: params.operationId,
        reason: acceptancePlan.reason,
        title: "客户疑似确认报价，需要人工核查",
        body: "客户消息像是在确认报价或付款，但当前报价状态不适合自动成单，需要人工确认。",
      });
      return result;
    }

    if (acceptancePlan.action === "update_existing_order_payment") {
      const orderDraftId = acceptancePlan.orderDraftId || existingOrderDraft?.id;
      const committed = this.localStore.commitInboundQuoteAcceptance({
        operationId: params.operationId,
        claimToken: params.claimToken,
        leaseExpiresAt: this.nextInboundLeaseExpiry(),
        quoteDraftId: quote.id,
        quotePatch: acceptancePlan.quotePatch,
        action: "update_existing_order_payment",
        orderDraftId,
        orderPatch: acceptancePlan.orderPatch,
        recoveryEffect: {
          kind: "low_value_quote_acceptance",
          phase: "quote_and_order_committed",
          action: acceptancePlan.action,
          acceptancePlan: durableJsonSnapshot(acceptancePlan),
          routeEvaluationId: params.route.id,
        },
      });
      return this.finishLocalQuoteAcceptance(params, committed.quote, committed.orderDraft, acceptancePlan);
    }

    const committed = this.localStore.commitInboundQuoteAcceptance({
      operationId: params.operationId,
      claimToken: params.claimToken,
      leaseExpiresAt: this.nextInboundLeaseExpiry(),
      quoteDraftId: quote.id,
      quotePatch: acceptancePlan.quotePatch,
      action: "accept_quote_and_create_order",
      recoveryEffect: {
        kind: "low_value_quote_acceptance",
        phase: "quote_and_order_committed",
        action: acceptancePlan.action,
        acceptancePlan: durableJsonSnapshot(acceptancePlan),
        routeEvaluationId: params.route.id,
      },
    });
    return this.finishLocalQuoteAcceptance(params, committed.quote, committed.orderDraft, acceptancePlan);
  }

  private async finishLocalQuoteAcceptance(
    params: { operationId: string; conversation: any; message: any; route: any },
    quote: any,
    orderDraft: any,
    acceptancePlan: any,
  ) {
    const updatingExistingOrder = acceptancePlan.action === "update_existing_order_payment";
    const result: any = {
      message: params.message,
      route: params.route,
      plan: {
        type: updatingExistingOrder ? "order_payment_updated" : "quote_accepted",
        reason: acceptancePlan.reason,
        shouldNotifyHuman: false,
        shouldCreateDesignJob: false,
        shouldQueueReply: false,
      },
      sendTask: null,
      designJob: quote?.designJob || orderDraft?.designJob || null,
      notification: null,
      bundleRecommendation: null,
      quote,
      orderDraft,
      quoteAcceptance: acceptancePlan,
    };
    if (!updatingExistingOrder) {
      await this.notifications.create(
        "info",
        "订单草稿已生成",
        `客户 ${quote.customer?.name || quote.customerId} 的报价已生成订单草稿，金额 ${orderDraft.totalPrice} 元。`,
        {
          effectKey: `${params.operationId}:order-draft-created-notification`,
          orderDraftId: orderDraft.id,
          quoteDraftId: quote.id,
          designJobId: quote.designJobId,
          wechatAccountId: orderDraft.wechatAccountId,
          conversationId: orderDraft.conversationId,
          customerId: orderDraft.customerId,
        },
      );
    }

    let confirmationDecision = evaluateLowValueOrderConfirmationSend(result.orderDraft, {
      highValueAmountCny: appConfig.highValueAmountCny,
    });
    const existingConfirmationTask = result.orderDraft.confirmationSendTask || null;
    if (existingConfirmationTask && confirmationDecision.reason === "already_queued") {
      const note = updatingExistingOrder
        ? "客户补充付款信息后，订单确认已自动进入微信安全发送队列。"
        : "低价值客户确认付款后，订单确认已自动进入微信安全发送队列。";
      result.orderDraft = await this.orders.updateFromAutomation(result.orderDraft.id, {
        ...this.expectedIdentityFromOrder(result.orderDraft),
        owner: "low_value_automation",
        customerNotes: note,
      } as any, {
        notificationEffectKey: `${stableOperationKey("order-confirm", `${result.orderDraft.id}:order-confirmation`)}:order-update-notification`,
      });
      result.sendTask = existingConfirmationTask;
      result.plan.shouldQueueReply = true;
      confirmationDecision = { ...confirmationDecision, reason: "low_value_order_confirmation_ready" };
      await this.notifications.create(
        "info",
        "订单确认已入队",
        "系统已根据订单草稿生成客户确认话术，并放入微信安全发送队列。",
        {
          effectKey: `${stableOperationKey("order-confirm", `${result.orderDraft.id}:order-confirmation`)}:notification`,
          orderDraftId: result.orderDraft.id,
          quoteDraftId: result.orderDraft.quoteDraftId,
          designJobId: result.orderDraft.designJobId,
          sendTaskId: existingConfirmationTask.id,
          wechatAccountId: result.orderDraft.wechatAccountId,
          conversationId: result.orderDraft.conversationId,
          customerId: result.orderDraft.customerId,
        },
      );
    } else if (confirmationDecision.ok) {
      const confirmation = await this.queueLowValueOrderConfirmation(result.orderDraft.id, {
        ...this.expectedIdentityFromOrder(result.orderDraft),
        owner: "low_value_automation",
        note: updatingExistingOrder
          ? "客户补充付款信息后，订单确认已自动进入微信安全发送队列。"
          : "低价值客户确认付款后，订单确认已自动进入微信安全发送队列。",
        reason: "low_value_order_confirmation",
      }, {
        source: updatingExistingOrder ? "low_value_quote_payment_update" : "low_value_quote_acceptance",
        reason: acceptancePlan.reason,
      });
      result.orderDraft = confirmation.orderDraft;
      result.sendTask = confirmation.sendTask;
      result.plan.shouldQueueReply = true;
    }
    result.notification = await this.notifications.create(
      "info",
      updatingExistingOrder
        ? "客户付款信息已记录"
        : acceptancePlan.quotePatch.paymentStatus === "paid" || acceptancePlan.quotePatch.paymentStatus === "deposit_paid"
          ? "低价值客户已确认付款，订单草稿已生成"
          : "低价值客户已确认报价，订单草稿已生成",
      updatingExistingOrder
        ? result.sendTask
          ? "系统已更新订单付款状态，并把订单确认回复放入微信安全发送队列。"
          : "系统已更新订单付款状态，现有订单确认发送状态保持不变。"
        : result.sendTask
          ? "系统已根据客户确认付款消息更新报价、生成订单草稿，并把确认回复放入微信安全发送队列。"
          : "系统已根据客户确认消息更新报价并生成待付款订单草稿，收到付款凭证并核验后再发送订单确认。",
      {
        effectKey: updatingExistingOrder
          ? `${params.operationId}:payment-update-notification`
          : `${params.operationId}:quote-accepted-notification`,
        quoteDraftId: quote.id,
        orderDraftId: result.orderDraft.id,
        sendTaskId: result.sendTask?.id,
        designJobId: quote.designJobId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
        routeId: params.route.id,
        reason: acceptancePlan.reason,
        confirmationReason: confirmationDecision.reason,
      },
    );
    return result;
  }

  private findLatestQuoteForConversation(conversation: any) {
    return this.localStore
      .listQuoteDrafts()
      .filter((quote: any) => quote.selectedImageId)
      .find((quote: any) => this.jobMatchesConversationIdentity(quote.designJob, conversation));
  }

  private async tryQueueLowValueQuoteAfterSelection(quote: any) {
    const decision = evaluateLowValueQuoteSend(quote, {
      highValueAmountCny: appConfig.highValueAmountCny,
    });
    if (!decision.ok) return { decision, quote, sendTask: null };

    const designJob = quote.designJob || this.localStore.getDesignJob(quote.designJobId);
    const text = buildQuoteCustomerMessage({
      customerName: quote.customer?.name,
      scene: designJob?.scene,
      quantity: quote.quantity,
      unitPrice: quote.unitPrice,
      totalPrice: quote.totalPrice,
      hasSelectedImage: Boolean(quote.selectedImageId),
      selectedImagePosition: quote.selectedImage?.position,
      items: Array.isArray(designJob?.bundle?.items) ? designJob.bundle.items : [],
    });
    const sendTask = await this.enqueueQuoteMessage({
      operationKey: stableOperationKey("quote-send", `${quote.id}:selected-image`),
      wechatAccountId: designJob.wechatAccountId,
      conversationId: designJob.conversationId,
      customerId: quote.customerId || designJob.customerId,
      designJobId: designJob.id,
      quoteDraftId: quote.id,
      text,
      automation: {
        source: "inbound_image_selection_quote_send",
        valueLevel: "low",
        reason: decision.reason,
        queuedBy: "low_value_automation",
      },
    });
    const updatedQuote = this.localStore.updateQuoteDraft(quote.id, {
      status: "send_queued",
      sendTaskId: sendTask.id,
      owner: quote.owner || "low_value_automation",
      customerNotes: "客户选图后，低价值报价已自动进入微信安全发送队列。",
    });
    return { decision, quote: updatedQuote, sendTask };
  }

  private async createInboundQuoteReview(
    conversation: any,
    route: any,
    quote: any,
    options: {
      operationId: string;
      reason: string;
      title: string;
      body: string;
    },
  ) {
    const manualLock = await this.lockConversationForManualReview(conversation, {
      reviewer: "system",
      reason: options.reason,
      effectKey: `${options.operationId}:quote-review-lock:${options.reason}`,
    });
    this.localStore.createReviewLog({
      targetType: quote?.id ? "quote_draft" : "conversation",
      targetId: quote?.id || conversation.id,
      decision: options.reason,
      reviewer: "system",
      note: options.body,
      beforeStatus: quote?.status || "quote_unknown",
      afterStatus: "manual_review",
      metadata: {
        effectKey: `${options.operationId}:quote-review-log:${options.reason}`,
        source: "inbound_quote_acceptance",
        routeId: route.id,
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        quoteDraftId: quote?.id || null,
        blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    });
    return this.notifications.create(
      "warning",
      options.title,
      manualLock.blockedSendTasks.length
        ? `${options.body} 已暂停 ${manualLock.blockedSendTasks.length} 个待发送任务。`
        : options.body,
      {
      effectKey: `${options.operationId}:quote-review-notification:${options.reason}`,
      quoteDraftId: quote?.id,
      designJobId: quote?.designJobId,
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      routeId: route.id,
      reason: options.reason,
      blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
      inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    );
  }

  private hasInboundPaymentProof(payload: { text?: string; assetIds?: string[]; attachments?: Array<Record<string, unknown>> }) {
    const text = String(payload.text || "").trim();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const hasAsset = Boolean((payload.assetIds || []).length || attachments.length);
    if (!hasAsset) return false;
    const paymentTextHint = /(付款|支付|转账|打款|汇款|定金|订金|尾款|全款|凭证|回单|收据|流水)/.test(text);
    if (paymentTextHint) return true;
    return attachments.some((attachment) => {
      const values = [
        attachment?.role,
        attachment?.type,
        attachment?.kind,
        attachment?.label,
        attachment?.fileName,
        attachment?.name,
      ]
        .map((value) => String(value || "").toLowerCase())
        .filter(Boolean);
      return values.some((value) => /payment|pay|paid|receipt|transfer|voucher|proof|付款|支付|转账|凭证|回单|收据/.test(value));
    });
  }

  private findLatestSelectableDesignJob(conversation: any) {
    const selectableStatuses = new Set(["sent", "customer_selected", "quote_created"]);
    return this.localStore
      .listDesignJobs()
      .filter((job: any) => this.jobMatchesConversationIdentity(job, conversation))
      .filter((job: any) => selectableStatuses.has(job.status))
      .filter((job: any) => Array.isArray(job.images) && job.images.length > 0)[0] || null;
  }

  private jobMatchesConversationIdentity(job: any, conversation: any) {
    if (!job || !conversation) return false;
    return (
      String(job.conversationId || "") === String(conversation.id || "") &&
      String(job.wechatAccountId || "") === String(conversation.wechatAccountId || "") &&
      String(job.customerId || "") === String(conversation.customerId || "")
    );
  }

  private buildInboundSelectionInput(payload: { text?: string; attachments?: Array<Record<string, unknown>> }) {
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const sources = [{ ...(payload || {}) }, ...attachments];
    return {
      text: payload.text || "",
      referencedImageId: this.firstStringValue(sources, ["referencedImageId", "referenceImageId", "imageId"]),
      quotedImageId: this.firstStringValue(sources, ["quotedImageId", "quoteImageId"]),
      attachmentImageId: this.firstStringValue(sources, ["attachmentImageId", "assetId", "remoteImageId"]),
      screenshotFingerprint: this.firstStringValue(sources, ["screenshotFingerprint", "imageFingerprint"]),
      attachmentFingerprint: this.firstStringValue(sources, ["attachmentFingerprint", "fingerprint"]),
    };
  }

  private firstStringValue(sources: Array<Record<string, unknown>>, keys: string[]) {
    for (const source of sources) {
      for (const key of keys) {
        const value = source?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return undefined;
  }

  private inboundSelectionFeedback(payload: { text?: string }, result: any) {
    const text = String(payload.text || "").trim();
    const source = result?.source || "text";
    const imageId = result?.imageId || result?.candidate?.id || "";
    return text || `customer_selected_image:${source}:${imageId}`;
  }

  private shouldLetQuoteAcceptanceHandleSelectionText(payload: { text?: string }, selectionPlan: any) {
    return shouldDeferSelectionReviewToQuoteAcceptance({
      text: payload.text || "",
      selectionPlan,
    });
  }

  private shouldManualReviewSelectedJob(job: any) {
    if (job.isHighValue) return true;
    const threshold = Number(appConfig.highValueAmountCny || 10000);
    return isHighValueBudget(job.budget || {}, threshold);
  }

  private async createInboundSelectionReview(
    conversation: any,
    route: any,
    options: {
      operationId: string;
      reason: string;
      title: string;
      body: string;
      designJobId?: string;
      selectedImageId?: string;
    },
  ) {
    const manualLock = await this.lockConversationForManualReview(conversation, {
      reviewer: "system",
      reason: options.reason,
      effectKey: `${options.operationId}:selection-review-lock:${options.reason}`,
    });
    this.localStore.createReviewLog({
      targetType: options.designJobId ? "design_job" : "conversation",
      targetId: options.designJobId || conversation.id,
      decision: options.reason,
      reviewer: "system",
      note: options.body,
      beforeStatus: options.designJobId ? "selection_pending" : "auto_allowed",
      afterStatus: "manual_review",
      metadata: {
        effectKey: `${options.operationId}:selection-review-log:${options.reason}`,
        source: "inbound_image_selection",
        routeId: route.id,
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        selectedImageId: options.selectedImageId || null,
        blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    });
    return this.notifications.create(
      "warning",
      options.title,
      manualLock.blockedSendTasks.length
        ? `${options.body} 已暂停 ${manualLock.blockedSendTasks.length} 个待发送任务。`
        : options.body,
      {
      effectKey: `${options.operationId}:selection-review-notification:${options.reason}`,
      designJobId: options.designJobId,
      selectedImageId: options.selectedImageId,
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      routeId: route.id,
      reason: options.reason,
      blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
      inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    );
  }

  private async lockConversationForManualReview(
    conversation: any,
    options: { reviewer?: string; reason?: string; effectKey?: string } = {},
  ) {
    const manualLock = await this.setConversationManualLock(conversation.id, {
      expectedWechatAccountId: conversation.wechatAccountId,
      expectedConversationId: conversation.id,
      expectedCustomerId: conversation.customerId,
      locked: true,
      reviewer: options.reviewer || "system",
      reason: options.reason || "manual_review",
      note: buildManualReviewLockNote(options.reason),
      effectKey: options.effectKey,
    });
    return {
      conversation: manualLock.conversation,
      blockedSendTasks: manualLock.blockedSendTasks,
      inFlightSendTasks: manualLock.inFlightSendTasks,
      reason: options.reason || "manual_review",
      log: manualLock.log,
    };
  }

  private async blockQueuedSendTasksForManualLock(conversation: any, reviewer: string) {
    const reason = "会话已人工接管，自动发送暂停";
    const now = new Date().toISOString();
    if (appConfig.useLocalStore) {
      const tasks = this.localStore
        .listSendTasks()
        .filter(
          (task) =>
            task.conversationId === conversation.id &&
            task.status === "queued" &&
            !isManualReplySendTask(task),
        );
      return tasks.map((task) => {
        const updated = this.localStore.updateSendTask(task.id, {
          status: "blocked",
          errorMessage: reason,
          guardSnapshot: {
            ...(task.guardSnapshot || {}),
            status: "blocked",
            reason,
            failedKeys: [
              ...new Set([...(task.guardSnapshot?.failedKeys || []), "conversationManualLocked"]),
            ],
            blockedByManualLock: true,
            blockedBy: reviewer,
            blockedAt: now,
            history: [
              ...this.guardHistory(task),
              {
                action: "manual_lock_block",
                fromStatus: task.status,
                reason,
                at: now,
                reviewer,
              },
            ],
          },
        });
        this.markLinkedQuoteFailed(updated, reason);
        return updated;
      });
    }

    const prisma = this.prisma as any;
    const tasks = await prisma.wechatSendTask.findMany({
      where: { conversationId: conversation.id, status: "queued" },
    });
    const blocked: any[] = [];
    for (const task of tasks) {
      blocked.push(
        await prisma.wechatSendTask.update({
          where: { id: task.id },
          data: {
            status: "blocked",
            errorMessage: reason,
            guardSnapshot: {
              ...((task.guardSnapshot as Record<string, unknown>) || {}),
              status: "blocked",
              reason,
              failedKeys: [
                ...new Set([
                  ...(((task.guardSnapshot as any)?.failedKeys as string[]) || []),
                  "conversationManualLocked",
                ]),
              ],
              blockedByManualLock: true,
              blockedBy: reviewer,
              blockedAt: now,
            },
          },
        }),
      );
    }
    return blocked;
  }

  private async listInFlightSendTasksForConversation(conversationId: string) {
    const tasks = await this.persistence.listSendTasks({ conversationId });
    return tasks.filter(
      (task: any) => task.conversationId === conversationId && task.status === "sending" && !isManualReplySendTask(task),
    );
  }

  private async protectInFlightSendTasksForManualLock(conversationId: string, reviewer: string) {
    const reason = `会话已人工接管，已请求停止发送中任务；发送结果必须人工核查。操作人：${reviewer}`;
    const tasks = await this.listInFlightSendTasksForConversation(conversationId);
    return Promise.all(tasks.map((task: any) =>
      this.cancelSendTask(task.id, {
        expectedWechatAccountId: task.wechatAccountId,
        expectedConversationId: task.conversationId,
        expectedCustomerId: task.customerId || task.conversation?.customerId,
        reason,
      }),
    ));
  }

  private summarizePayload(payload: any) {
    const kind = payload?.kind || "unknown";
    const imagePaths = Array.isArray(payload?.imagePaths) ? payload.imagePaths : [];
    const text = String(payload?.text || payload?.textBeforeImages || "");
    return {
      kind,
      textLength: text.length,
      imageCount: imagePaths.length,
      hasText: Boolean(text.trim()),
      hasImages: imagePaths.length > 0,
    };
  }

  private async markLinkedQuoteSent(task: any) {
    if (this.hasOrderDraftBinding(task)) return;
    const quoteDraftId = task?.quoteDraftId || task?.payload?.quoteDraftId;
    if (!quoteDraftId) return;
    if (appConfig.useLocalStore) {
      const quote = this.localStore.getQuoteDraft(quoteDraftId);
      if (String(quote?.sendTaskId || "") !== String(task.id || "")) return;
      this.localStore.updateQuoteDraft(quoteDraftId, {
        status: "sent",
        customerNotes: "报价已通过微信发送安全流程。",
      });
      return;
    }
    await (this.prisma as any).quoteDraft.updateMany({
      where: { id: quoteDraftId, sendTaskId: task.id, status: "send_queued" },
      data: {
        status: "sent",
        customerNotes: "报价已通过微信发送安全流程。",
      },
    });
  }

  private async markLinkedQuoteFailed(task: any, reason: string, options: { allowSentFailure?: boolean } = {}) {
    if (this.hasOrderDraftBinding(task)) {
      await this.markLinkedOrderSendFailed(task, reason);
      return;
    }
    const quoteDraftId = task?.quoteDraftId || task?.payload?.quoteDraftId;
    if (quoteDraftId && appConfig.useLocalStore) {
      const quote = this.localStore.getQuoteDraft(quoteDraftId);
      if (String(quote?.sendTaskId || "") !== String(task.id || "")) return;
      const quoteStatus = String(quote?.status || "");
      if (["accepted", "cancelled"].includes(quoteStatus)) return;
      if (quoteStatus === "sent" && !options.allowSentFailure) return;
      this.localStore.updateQuoteDraft(quoteDraftId, {
        status: "manual_review",
        customerNotes: `报价发送失败，需要人工处理：${reason}`,
      });
      return;
    }
    if (quoteDraftId) {
      await (this.prisma as any).quoteDraft.updateMany({
        where: {
          id: quoteDraftId,
          sendTaskId: task.id,
          status: options.allowSentFailure
            ? { in: ["send_queued", "sent"] }
            : { notIn: ["sent", "accepted", "cancelled"] },
        },
        data: {
          status: "manual_review",
          customerNotes: `报价发送失败，需要人工处理：${reason}`,
        },
      });
    }
  }

  private async markLinkedOrderSendFailed(task: any, reason: string) {
    const orderContext = this.orderSendContext(task);
    const source = String(orderContext.source || task?.payload?.source || "");
    const orderDraftId = String(orderContext.orderDraftId || task?.payload?.orderDraftId || "").trim();
    if (!orderDraftId) return;
    const order = appConfig.useLocalStore
      ? this.localStore.getOrderDraft(orderDraftId)
      : await (this.prisma as any).orderDraft.findUnique({ where: { id: orderDraftId } });
    if (!order) return;
    const stage = source === "order_followup" || orderContext.followupType ? "订单跟进发送" : "订单确认发送";
    const marker = `[发送任务:${task.id}]`;
    const currentNotes = String(order.customerNotes || "");
    if (currentNotes.includes(marker)) return;
    const note = `${marker}${stage}失败，需要人工处理：${reason}`;
    const patch = {
      owner: order.owner && order.owner !== "low_value_automation" ? order.owner : "人工客服",
      customerNotes: appendCustomerNote(order.customerNotes, note),
    };
    if (appConfig.useLocalStore) this.localStore.updateOrderDraft(orderDraftId, patch);
    else {
      await (this.prisma as any).orderDraft.updateMany({
        where: {
          id: orderDraftId,
          wechatAccountId: task.wechatAccountId,
          conversationId: task.conversationId,
          customerNotes: order.customerNotes,
        },
        data: patch,
      });
    }
  }

  private async markLinkedOrderSendRequeued(task: any, reason: string) {
    const orderContext = this.orderSendContext(task);
    const source = String(orderContext.source || task?.payload?.source || "");
    const orderDraftId = String(orderContext.orderDraftId || task?.payload?.orderDraftId || "").trim();
    if (!orderDraftId) return;
    const order = appConfig.useLocalStore
      ? this.localStore.getOrderDraft(orderDraftId)
      : await (this.prisma as any).orderDraft.findUnique({ where: { id: orderDraftId } });
    if (!order) return;
    const stage = source === "order_followup" || orderContext.followupType ? "订单跟进发送" : "订单确认发送";
    const marker = `[发送任务:${task.id}:requeue]`;
    const currentNotes = String(order.customerNotes || "");
    if (currentNotes.includes(marker)) return;
    const note = `${marker}${stage}已人工重新排队：${reason}`;
    const customerNotes = appendCustomerNote(order.customerNotes, note);
    if (appConfig.useLocalStore) this.localStore.updateOrderDraft(orderDraftId, { customerNotes });
    else {
      await (this.prisma as any).orderDraft.updateMany({
        where: {
          id: orderDraftId,
          wechatAccountId: task.wechatAccountId,
          conversationId: task.conversationId,
          customerNotes: order.customerNotes,
        },
        data: { customerNotes },
      });
    }
  }

  private async markLinkedQuoteRequeued(task: any, reason: string) {
    if (this.hasOrderDraftBinding(task)) return;
    const quoteDraftId = task?.quoteDraftId || task?.payload?.quoteDraftId;
    if (!quoteDraftId) return;
    if (appConfig.useLocalStore) {
      this.localStore.updateQuoteDraft(quoteDraftId, {
        status: "send_queued",
        customerNotes: reason,
      });
      return;
    }
    await (this.prisma as any).quoteDraft.updateMany({
      where: {
        id: quoteDraftId,
        sendTaskId: task.id,
        status: { notIn: ["sent", "accepted", "cancelled"] },
      },
      data: { status: "send_queued", customerNotes: reason },
    });
  }

  private settledDeliveryGuard(task: any, status: "sent" | "failed", settledAt: string, source: string) {
    return {
      ...(isPlainObject(task?.guardSnapshot) ? task.guardSnapshot : {}),
      status,
      deliveryState: status,
      wechatWorkDeliveryState: status,
      automaticRetryBlocked: false,
      manualReviewRequired: false,
      deliveryResolvedAt: settledAt,
      deliveryResolutionSource: source,
    };
  }

  private requireExactSendTaskIdentity(task: any, payload: ExpectedIdentityPayload) {
    const storedBinding = isPlainObject(task?.guardSnapshot?.binding) ? task.guardSnapshot.binding : {};
    const identity = {
      wechatAccountId: String(storedBinding.wechatAccountId || task?.wechatAccountId || ""),
      conversationId: String(storedBinding.conversationId || task?.conversationId || ""),
      customerId: String(
        storedBinding.customerId || task?.customerId || task?.conversation?.customerId || task?.designJob?.customerId || "",
      ),
    };
    const supplied = {
      wechatAccountId: String(payload?.expectedWechatAccountId || ""),
      conversationId: String(payload?.expectedConversationId || ""),
      customerId: String(payload?.expectedCustomerId || ""),
    };
    if (!supplied.wechatAccountId || !supplied.conversationId || !supplied.customerId) {
      throw new BadRequestException(
        "manual send delivery resolution requires expectedWechatAccountId, expectedConversationId and expectedCustomerId",
      );
    }
    if (
      supplied.wechatAccountId !== identity.wechatAccountId ||
      supplied.conversationId !== identity.conversationId ||
      supplied.customerId !== identity.customerId
    ) {
      throw new BadRequestException("send task identity mismatch for manual delivery resolution");
    }
    return identity;
  }

  private hasUnknownSendDelivery(task: any, attempt?: any) {
    const guardSnapshot = isPlainObject(task?.guardSnapshot) ? task.guardSnapshot : {};
    const attemptMetadata = isPlainObject(attempt?.metadata) ? attempt.metadata : {};
    const states = [
      guardSnapshot.deliveryState,
      guardSnapshot.wechatWorkDeliveryState,
      attemptMetadata.deliveryState,
    ].map((value) => String(value || "").toLowerCase());
    return states.some((value) => value === "unknown" || value === "partial" || value === "unknown_after_cancel") ||
      (guardSnapshot.manualReviewRequired === true && guardSnapshot.automaticRetryBlocked === true);
  }

  private protectLocalInflightSendFromCancellation(task: any, suppliedReason?: string) {
    const now = new Date().toISOString();
    const reason = String(suppliedReason || "manual cancellation requested while delivery was in flight");
    const pendingAttempt = this.localStore.getLatestSendAttempt(task.id, { status: "started" });
    if (this.hasUnknownSendDelivery(task, pendingAttempt) && task.guardSnapshot?.cancelRequestedAt) return task;
    if (pendingAttempt) {
      this.localStore.updateSendAttempt(pendingAttempt.id, {
        status: "started",
        completedAt: null,
        errorMessage: reason,
        metadata: {
          ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
          deliveryState: "unknown",
          deliveryUnknownReason: "manual_cancel_requested_inflight",
          deliveryUnknownAt: pendingAttempt.metadata?.deliveryUnknownAt || now,
          cancelRequestedAt: now,
          cancelReason: reason,
          automaticRetryBlocked: true,
          manualReviewRequired: true,
        },
      });
    }
    return this.localStore.updateSendTask(task.id, {
      status: "sending",
      sentAt: null,
      errorMessage: `${reason}; delivery is unknown and requires manual verification`,
      guardSnapshot: {
        ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
        status: "sending",
        deliveryState: "unknown",
        wechatWorkDeliveryState: "unknown",
        deliveryUnknownReason: "manual_cancel_requested_inflight",
        deliveryUnknownAt: task.guardSnapshot?.deliveryUnknownAt || now,
        cancelRequestedAt: now,
        cancelReason: reason,
        automaticRetryBlocked: true,
        manualReviewRequired: true,
        history: [
          ...this.guardHistory(task),
          { action: "cancel_inflight_unknown", fromStatus: task.status, reason, at: now },
        ],
      },
    });
  }

  private async protectPrismaInflightSendFromCancellation(task: any, suppliedReason?: string) {
    const now = new Date().toISOString();
    const reason = String(suppliedReason || "manual cancellation requested while delivery was in flight");
    const pendingAttempt = await this.persistence.getLatestSendAttempt(task.id, { status: "started" });
    if (this.hasUnknownSendDelivery(task, pendingAttempt) && task.guardSnapshot?.cancelRequestedAt) return task;
    const taskPatch = {
      status: "sending",
      sentAt: null,
      errorMessage: `${reason}; delivery is unknown and requires manual verification`,
      guardSnapshot: {
        ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
        status: "sending",
        deliveryState: "unknown",
        wechatWorkDeliveryState: "unknown",
        deliveryUnknownReason: "manual_cancel_requested_inflight",
        deliveryUnknownAt: task.guardSnapshot?.deliveryUnknownAt || now,
        cancelRequestedAt: now,
        cancelReason: reason,
        automaticRetryBlocked: true,
        manualReviewRequired: true,
        history: [
          ...this.guardHistory(task),
          { action: "cancel_inflight_unknown", fromStatus: task.status, reason, at: now },
        ],
      },
    };
    const completed = pendingAttempt
      ? await this.persistence.completeAttemptAndTask({
          taskId: task.id,
          attemptId: pendingAttempt.id,
          expectedTaskStatus: "sending",
          expectedTaskUpdatedAt: task.updatedAt,
          expectedAttemptStatus: "started",
          attemptPatch: {
            status: "started",
            completedAt: null,
            errorMessage: reason,
            metadata: {
              ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
              deliveryState: "unknown",
              deliveryUnknownReason: "manual_cancel_requested_inflight",
              deliveryUnknownAt: pendingAttempt.metadata?.deliveryUnknownAt || now,
              cancelRequestedAt: now,
              cancelReason: reason,
              automaticRetryBlocked: true,
              manualReviewRequired: true,
            },
          },
          taskPatch,
        })
      : null;
    if (completed) return completed.task;
    if (!pendingAttempt) {
      const updated = await this.persistence.updateSendTaskWithLinkedTransition({
        taskId: task.id,
        expectedTaskStatus: "sending",
        taskPatch,
      });
      if (updated) return updated;
    }
    const current = await this.persistence.getSendTask(task.id);
    if (current && (current.status !== "sending" || this.hasUnknownSendDelivery(current))) return current;
    throw new BadRequestException("send task state changed before in-flight cancellation protection completed");
  }

  private async recordManualSendDeliveryResolutionAudit(
    task: any,
    resolution: Record<string, unknown>,
    operationKey: string,
  ) {
    const identity = isPlainObject(resolution.identity) ? resolution.identity : {};
    return this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wechat_work_audit", operationKey, "manual-send-delivery-resolution"),
      action: "send_delivery_manual_resolution",
      status: String(resolution.resolution || "unknown"),
      sendTaskId: task.id,
      sendAttemptId: task.latestAttempt?.id || task.attempts?.[0]?.id || null,
      wechatAccountId: identity.wechatAccountId || task.wechatAccountId || null,
      conversationId: identity.conversationId || task.conversationId || null,
      customerId: identity.customerId || task.customerId || task.conversation?.customerId || null,
      reviewer: resolution.reviewer || null,
      reason: resolution.reason || null,
      resolvedAt: resolution.resolvedAt || null,
      operationKey,
    });
  }

  private guardHistory(task: any) {
    const history = task?.guardSnapshot?.history;
    return Array.isArray(history) ? history.slice(-20) : [];
  }

  private isBridgeAckTimedOut(task: any, now: Date, suppliedAttempt?: any) {
    const latestAttempt = suppliedAttempt || task.latestAttempt || task.attempts?.[0];
    return latestAttempt?.adapter === "windows_bridge" &&
      latestAttempt.status === "started" &&
      isOlderThan(latestAttempt.startedAt || latestAttempt.createdAt, now, appConfig.sendBridgeAckTimeoutMinutes);
  }

  private markBridgeDeliveryUnknown(task: any, reasonCode: string, message: string, details: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    const guardSnapshot = isPlainObject(task?.guardSnapshot) ? task.guardSnapshot : {};
    const previousDetails = isPlainObject(guardSnapshot.deliveryUnknownDetails) ? guardSnapshot.deliveryUnknownDetails : {};
    const pendingAttempt = this.localStore.getLatestSendAttempt(task.id, {
      adapter: "windows_bridge",
      status: "started",
    });
    const deliveryUnknownDetails = { ...previousDetails, ...details };
    const protectedTask = this.localStore.updateSendTask(task.id, {
      status: "sending",
      sentAt: null,
      errorMessage: `${message}；发送结果未知，禁止自动或直接重新排队`,
      guardSnapshot: {
        ...guardSnapshot,
        deliveryState: "unknown",
        deliveryUnknownReason: reasonCode,
        deliveryUnknownAt: guardSnapshot.deliveryUnknownAt || now,
        automaticRetryBlocked: true,
        manualReviewRequired: true,
        deliveryUnknownDetails,
      },
    });
    if (previousDetails.archivedDispatchPath || !pendingAttempt) return protectedTask;
    const archivedDispatchPath = this.archiveBridgeDispatchFile(task, pendingAttempt, "uncertain");
    if (!archivedDispatchPath) return protectedTask;
    return this.localStore.updateSendTask(task.id, {
      guardSnapshot: {
        ...(isPlainObject(protectedTask.guardSnapshot) ? protectedTask.guardSnapshot : {}),
        deliveryUnknownDetails: {
          ...deliveryUnknownDetails,
          archivedDispatchPath,
        },
      },
    });
  }

  private async markPrismaBridgeDeliveryUnknown(
    task: any,
    pendingAttempt: any,
    reasonCode: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    if (!task?.updatedAt) return null;
    const guardSnapshot = isPlainObject(task?.guardSnapshot) ? task.guardSnapshot : {};
    const attemptMetadata = isPlainObject(pendingAttempt?.metadata) ? pendingAttempt.metadata : {};
    const alreadyProtected = guardSnapshot.deliveryState === "unknown" &&
      guardSnapshot.deliveryUnknownReason === reasonCode &&
      guardSnapshot.automaticRetryBlocked === true &&
      attemptMetadata.deliveryState === "unknown" &&
      attemptMetadata.deliveryUnknownReason === reasonCode &&
      attemptMetadata.automaticRetryBlocked === true;
    if (alreadyProtected) return { task, attempt: pendingAttempt, changed: false };

    const protectedAt = new Date().toISOString();
    const deliveryUnknownDetails = {
      ...(isPlainObject(guardSnapshot.deliveryUnknownDetails) ? guardSnapshot.deliveryUnknownDetails : {}),
      ...details,
    };
    const completed = await this.persistence.completeAttemptAndTask({
      taskId: task.id,
      attemptId: pendingAttempt.id,
      expectedTaskStatus: "sending",
      expectedTaskUpdatedAt: task.updatedAt,
      expectedAttemptStatus: "started",
      attemptPatch: {
        status: "started",
        errorMessage: message,
        metadata: {
          ...attemptMetadata,
          bridgeState: "delivery_unknown",
          deliveryState: "unknown",
          deliveryUnknownReason: reasonCode,
          deliveryUnknownAt: attemptMetadata.deliveryUnknownAt || protectedAt,
          automaticRetryBlocked: true,
          manualReviewRequired: true,
          deliveryUnknownDetails,
        },
      },
      taskPatch: {
        status: "sending",
        sentAt: null,
        errorMessage: `${message}; delivery is unknown and automatic retry is blocked pending manual review`,
        guardSnapshot: {
          ...guardSnapshot,
          deliveryState: "unknown",
          deliveryUnknownReason: reasonCode,
          deliveryUnknownAt: guardSnapshot.deliveryUnknownAt || protectedAt,
          automaticRetryBlocked: true,
          manualReviewRequired: true,
          deliveryUnknownDetails,
        },
      },
    });
    return completed ? { ...completed, changed: true } : null;
  }

  private hasOrderDraftBinding(task: any) {
    return Boolean(String(this.orderSendContext(task).orderDraftId || ""));
  }

  private orderSendContext(task: any): Record<string, unknown> {
    const context = isPlainObject(task?.guardSnapshot?.orderContext) ? task.guardSnapshot.orderContext : {};
    if (String(context.orderDraftId || "").trim()) return context;
    return isPlainObject(task?.guardSnapshot?.automation) ? task.guardSnapshot.automation : {};
  }

  private inspectPendingBridgeOutbox(task: any, suppliedAttempt?: any) {
    const attempt = suppliedAttempt || this.localStore.getLatestSendAttempt(task.id, {
      adapter: "windows_bridge",
      status: "started",
    });
    if (!attempt) return { ok: true, reason: "not_waiting_for_windows_bridge" };
    const fileName = this.resolveBridgeAckOutboxFileName({}, attempt);
    if (!fileName) return { ok: false, reason: "missing_outbox_file_name", fileName: "" };
    const safeName = path.basename(fileName);
    if (!safeName || safeName !== fileName) return { ok: false, reason: "unsafe_outbox_file_name", fileName };
    const root = path.resolve(appConfig.wechatBridgeOutboxDir);
    const resolved = path.resolve(path.join(root, safeName));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative !== safeName) {
      return { ok: false, reason: "outbox_file_outside_root", fileName: safeName };
    }
    if (!fs.existsSync(resolved)) return { ok: false, reason: "outbox_file_missing", fileName: safeName };
    if (!fs.lstatSync(resolved).isFile()) return { ok: false, reason: "outbox_file_not_regular_file", fileName: safeName };
    try {
      const realRoot = fs.realpathSync(root);
      const realResolved = fs.realpathSync(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        return { ok: false, reason: "outbox_file_resolves_outside_root", fileName: safeName };
      }
      const data = readJsonFile(realResolved);
      if (!isPlainObject(data)) return { ok: false, reason: "outbox_json_root_invalid", fileName: safeName };
      if (data.version !== BRIDGE_OUTBOX_VERSION) return { ok: false, reason: "outbox_protocol_invalid", fileName: safeName };
      if (String(data.taskId || "") !== String(task.id || "")) return { ok: false, reason: "outbox_task_mismatch", fileName: safeName };
      if (String(data.wechatAccountId || "") !== String(task.wechatAccountId || "")) {
        return { ok: false, reason: "outbox_account_mismatch", fileName: safeName };
      }
      if (String(data.conversationId || "") !== String(task.conversationId || "")) {
        return { ok: false, reason: "outbox_conversation_mismatch", fileName: safeName };
      }
      if (!/^[a-f0-9]{64}$/i.test(String(data.ackToken || ""))) return { ok: false, reason: "outbox_ack_token_invalid", fileName: safeName };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "outbox_json_invalid", fileName: safeName };
    }
    return { ok: true, reason: "outbox_ready", fileName: safeName };
  }

  private findPendingBridgeDispatchForTask(task: any, attempt: any) {
    return this.sendAdapter
      .listBridgeDispatch()
      .map((entry) => this.buildBridgeDispatchListItem(entry))
      .find((entry) =>
        entry.taskId === task.id &&
        entry.attemptId === attempt?.id &&
        entry.wechatAccountId === task.wechatAccountId &&
        entry.conversationId === task.conversationId,
      ) || null;
  }

  private failTaskForRejectedTrustedBridgeAck(taskId: string, payload: any, entry: any, errorMessage: string) {
    const task = this.localStore.getSendTask(taskId);
    if (!task || task.status !== "sending") return null;
    if (payload?.status !== "sent") return null;
    const pendingAttempt = this.resolveLocalBridgeAckAttempt(task, payload);
    if (!pendingAttempt || pendingAttempt.status !== "started") return null;
    const binding = validateBridgeAckBinding({ task, attempt: pendingAttempt, payload });
    if (!binding.ok) return null;
    const currentBinding = this.validateExistingSendTaskBinding(task);
    if (!currentBinding.ok) return null;

    const outboxFileName = this.resolveBridgeAckOutboxFileName(payload, pendingAttempt);
    const outboxPayloadValidation = this.validateBridgeAckOutboxPayload(task, pendingAttempt, payload, outboxFileName);
    const now = new Date().toISOString();
    const archivedOutboxPath = outboxFileName ? this.archiveBridgeOutboxFile(outboxFileName, "failed") : null;
    const archivedDispatchPath = this.archiveBridgeDispatchFile(task, pendingAttempt, "failed");
    const failureReason = `Bridge ack rejected after trusted validation: ${errorMessage}`;
    const rejectionSource = entry?.source || (entry?.filePath ? "bridge_inbox" : "direct_ack");
    const attempt = this.localStore.updateSendAttempt(pendingAttempt.id, {
      status: "failed",
      errorMessage: failureReason,
      metadata: {
        ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
        bridgeAckRejected: {
          source: rejectionSource,
          fileName: entry?.fileName || "",
          reason: errorMessage,
          rejectedAt: now,
        },
        bridgeAck: sanitizeBridgeAckMetadata(payload.metadata),
        bridgeAckIdentity: {
          wechatAccountId: payload.wechatAccountId || "",
          conversationId: payload.conversationId || "",
          customerId: payload.customerId || "",
        },
        bridgeAckAt: now,
        bridgeAckOutboxFileName: outboxFileName,
        bridgeOutboxPayloadValidation: {
          ok: outboxPayloadValidation.ok,
          fileName: outboxFileName,
          checkedAt: now,
        },
        archivedOutboxPath,
        archivedDispatchPath,
      },
      completedAt: now,
    });
    const updatedTask = this.localStore.updateSendTask(task.id, {
      status: "failed",
      sentAt: null,
      errorMessage: failureReason,
      guardSnapshot: {
        ...(task.guardSnapshot || {}),
        status: "failed",
        reason: "bridge_ack_rejected_after_trusted_validation",
        bridgeAckRejectedAt: now,
        bridgeAckRejectedFileName: entry?.fileName || "",
        bridgeAckRejectedReason: errorMessage,
      },
    });
    this.markLinkedQuoteFailed(updatedTask, failureReason);
    this.markLinkedOrderSendFailed(updatedTask, failureReason);
    return { task: this.localStore.getSendTask(task.id), attempt, binding, currentBinding };
  }

  private validateBridgeAckOutboxPayload(task: any, attempt: any, payload: any, outboxFileName: string) {
    const safeName = path.basename(String(outboxFileName || ""));
    if (!safeName || safeName !== outboxFileName) {
      throw new BadRequestException("bridge outbox payload invalid: outbox file name is required");
    }

    const filePath = path.join(appConfig.wechatBridgeOutboxDir, safeName);
    const root = path.resolve(appConfig.wechatBridgeOutboxDir);
    const resolved = path.resolve(filePath);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative !== safeName) {
      throw new BadRequestException("bridge outbox payload invalid: outbox file is outside bridge outbox directory");
    }
    if (!fs.existsSync(resolved)) {
      throw new BadRequestException("bridge outbox payload invalid: outbox file does not exist");
    }
    if (!fs.lstatSync(resolved).isFile()) {
      throw new BadRequestException("bridge outbox payload invalid: outbox file must be a regular file");
    }
    const realRoot = fs.realpathSync(root);
    const realResolved = fs.realpathSync(resolved);
    const realRelative = path.relative(realRoot, realResolved);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new BadRequestException("bridge outbox payload invalid: outbox file resolves outside bridge outbox directory");
    }

    let data: unknown;
    try {
      data = readJsonFile(resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid json";
      throw new BadRequestException(`bridge outbox payload invalid: ${message}`);
    }
    if (!isPlainObject(data)) {
      throw new BadRequestException("bridge outbox payload invalid: json root must be an object");
    }

    const sendPlan = isPlainObject(data.sendPlan) ? data.sendPlan : {};
    const target = isPlainObject(data.target) ? data.target : {};
    const sendPlanTarget = isPlainObject(sendPlan.target) ? sendPlan.target : {};
    const constraints = isPlainObject(sendPlan.constraints) ? sendPlan.constraints : {};
    const actions = Array.isArray(sendPlan.actions) ? sendPlan.actions : [];
    const actionCount = Number(sendPlan.actionCount);
    const actionValidation = validateBridgeSendPlanActions(actions);
    const guardSnapshot = isPlainObject(data.guardSnapshot) ? data.guardSnapshot : {};
    const context = isPlainObject(data.context) ? data.context : {};
    const preflight = isPlainObject(data.preflight) ? data.preflight : {};
    const guardPassed = guardSnapshot.status === "passed" || guardSnapshot.ok === true || context.guardStatus === "passed";
    const hasPreflightWindowPolicy = Boolean(preflight.expectedWindowSnapshotId || preflight.rejectIfAnyCheckFails || preflight.rejectIfWindowChanged);
    const expectedWindowSnapshotId = String(preflight.expectedWindowSnapshotId || target.windowSnapshotId || attempt?.windowSnapshotId || "");
    const actualWindowSnapshotId = String(context.windowSnapshotId || target.windowSnapshotId || "");
    const outboxAckToken = typeof data.ackToken === "string" ? data.ackToken : "";
    const ackToken = typeof payload?.ackToken === "string"
      ? payload.ackToken
      : typeof payload?.bridgeAckToken === "string"
        ? payload.bridgeAckToken
        : "";
    const ackProtocolVersion = typeof payload?.version === "string"
      ? payload.version
      : typeof payload?.protocolVersion === "string"
        ? payload.protocolVersion
        : "";
    const taskCustomerId = String(task?.conversation?.customerId || task?.customerId || task?.designJob?.customerId || task?.quoteDraft?.customerId || "");

    const checks = [
      {
        key: "ackProtocolVersion",
        passed: ackProtocolVersion === BRIDGE_ACK_VERSION,
      },
      {
        key: "protocolVersion",
        passed: data.version === BRIDGE_OUTBOX_VERSION,
      },
      {
        key: "outboxAckToken",
        passed: /^[a-f0-9]{64}$/i.test(outboxAckToken),
      },
      {
        key: "ackTokenMatches",
        passed: Boolean(outboxAckToken && ackToken && ackToken === outboxAckToken),
      },
      {
        key: "ackTaskId",
        passed: String(payload?.taskId || "") === String(task?.id || ""),
      },
      {
        key: "ackAttemptId",
        passed: String(payload?.attemptId || "") === String(attempt?.id || ""),
      },
      {
        key: "ackWechatAccountId",
        passed: String(payload?.wechatAccountId || "") === String(task?.wechatAccountId || ""),
      },
      {
        key: "ackConversationId",
        passed: String(payload?.conversationId || "") === String(task?.conversationId || ""),
      },
      {
        key: "ackCustomerId",
        passed: Boolean(taskCustomerId) && String(payload?.customerId || "") === taskCustomerId,
      },
      {
        key: "taskId",
        passed: String(data.taskId || "") === String(task?.id || ""),
      },
      {
        key: "attemptOutboxFile",
        passed: bridgeFileName(attempt?.metadata?.outboxFile || attempt?.metadata?.outboxFileName || attempt?.metadata?.adapter?.outboxFile) === safeName,
      },
      {
        key: "ackOutboxFile",
        passed: bridgeFileName(payload?.outboxFileName || payload?.outboxFile || payload?.metadata?.outboxFileName || payload?.metadata?.outboxFile) === safeName,
      },
      {
        key: "wechatAccountId",
        passed: String(data.wechatAccountId || "") === String(task?.wechatAccountId || ""),
      },
      {
        key: "conversationId",
        passed: String(data.conversationId || "") === String(task?.conversationId || ""),
      },
      {
        key: "targetIdentity",
        passed:
          String(target.wechatAccountId || "") === String(task?.wechatAccountId || "") &&
          String(target.conversationId || "") === String(task?.conversationId || "") &&
          Boolean(taskCustomerId) &&
          String(target.customerId || "") === taskCustomerId,
      },
      {
        key: "sendPlanTargetIdentity",
        passed:
          String(sendPlanTarget.wechatAccountId || "") === String(task?.wechatAccountId || "") &&
          String(sendPlanTarget.conversationId || "") === String(task?.conversationId || "") &&
          Boolean(taskCustomerId) &&
          String(sendPlanTarget.customerId || "") === taskCustomerId,
      },
      {
        key: "sendPlanActions",
        passed: actions.length > 0,
      },
      {
        key: "sendPlanActionCount",
        passed: Number.isFinite(actionCount) && actionCount === actions.length,
      },
      {
        key: "sendPlanActionDetails",
        passed: actionValidation.ok,
      },
      {
        key: "sendPlanConstraints",
        passed:
          constraints.singleAccountLock === true &&
          constraints.requireActiveWindowMatch === true &&
          constraints.requireRecentCustomerMatch === true &&
          constraints.doNotMarkSentWithoutAck === true,
      },
      {
        key: "preflightWindowChangePolicy",
        passed: !hasPreflightWindowPolicy || (preflight.rejectIfAnyCheckFails === true && preflight.rejectIfWindowChanged === true),
      },
      {
        key: "preflightWindowSnapshot",
        passed: Boolean(expectedWindowSnapshotId && actualWindowSnapshotId && expectedWindowSnapshotId === actualWindowSnapshotId),
      },
      {
        key: "guardSnapshot",
        passed: guardPassed,
      },
    ];
    const failedKeys = checks.filter((item) => !item.passed).map((item) => item.key);
    if (failedKeys.length) {
      throw new BadRequestException(`bridge outbox payload invalid: ${failedKeys.join(",")}`);
    }

    return { ok: true, fileName: safeName, filePath: resolved };
  }

  private resolveLocalIdempotentBridgeAckReplay(task: any, payload: any, status: "sent" | "failed") {
    if (String(task?.status || "") !== status) return null;
    const attemptId = String(payload?.attemptId || "");
    if (!attemptId) return null;
    let attempt = this.localStore
      .listSendAttempts({ sendTaskId: task.id, limit: 300 })
      .find((item: any) => item.id === attemptId && item.adapter === "windows_bridge" && ["started", status].includes(item.status));
    if (!attempt) return null;
    const metadata = isPlainObject(attempt.metadata) ? attempt.metadata : {};
    const identity = isPlainObject(metadata.bridgeAckIdentity) ? metadata.bridgeAckIdentity : {};
    const taskCustomerId = String(task?.conversation?.customerId || task?.customerId || task?.designJob?.customerId || task?.quoteDraft?.customerId || "");
    const expectedOutboxFileName = bridgeFileName(metadata.bridgeAckOutboxFileName);
    const checks = [
      payload?.version === BRIDGE_ACK_VERSION || payload?.protocolVersion === BRIDGE_ACK_VERSION,
      String(payload?.taskId || "") === String(task.id || ""),
      String(payload?.wechatAccountId || "") === String(task.wechatAccountId || ""),
      String(payload?.conversationId || "") === String(task.conversationId || ""),
      Boolean(taskCustomerId) && String(payload?.customerId || "") === taskCustomerId,
      String(identity.wechatAccountId || "") === String(task.wechatAccountId || ""),
      String(identity.conversationId || "") === String(task.conversationId || ""),
      String(identity.customerId || "") === taskCustomerId,
      Boolean(expectedOutboxFileName) && bridgeFileName(payload?.outboxFileName || payload?.outboxFile) === expectedOutboxFileName,
      Boolean(metadata.bridgeAckTokenHash) && hashBridgeAckToken(payload) === metadata.bridgeAckTokenHash,
    ];
    if (checks.some((passed) => !passed)) return null;
    if (attempt.status === "started") {
      if (status === "sent") void this.markLinkedQuoteSent(task);
      else void this.markLinkedQuoteFailed(task, payload.errorMessage || "Windows 桥接发送失败");
      const completedAt = new Date().toISOString();
      const completedAttempt = this.localStore.updateSendAttempt(attempt.id, {
        status,
        errorMessage: payload.errorMessage || "",
        completedAt,
      });
      const archivedOutboxPath = expectedOutboxFileName
        ? this.archiveBridgeOutboxFile(expectedOutboxFileName, status === "sent" ? "processed" : "failed")
        : null;
      const archivedDispatchPath = this.archiveBridgeDispatchFile(
        task,
        completedAttempt,
        status === "sent" ? "processed" : "failed",
      );
      attempt = this.localStore.updateSendAttempt(completedAttempt.id, {
        metadata: {
          ...(isPlainObject(completedAttempt.metadata) ? completedAttempt.metadata : {}),
          bridgeAckCommitRecoveredAt: completedAt,
          archivedOutboxPath,
          archivedDispatchPath,
        },
      });
    }
    return {
      task,
      attempt,
      idempotent: true,
      binding: { ok: true, status: "passed", reason: "duplicate bridge ack matches completed attempt" },
      currentBinding: this.validateExistingSendTaskBinding(task),
    };
  }

  private async resolveIdempotentBridgeAckReplay(task: any, payload: any, status: "sent" | "failed") {
    if (String(task?.status || "") !== status) return null;
    const attemptId = String(payload?.attemptId || "");
    if (!attemptId) return null;
    let attempt = (await this.persistence.listSendAttempts({ sendTaskId: task.id, limit: 300 }))
      .find((item: any) => item.id === attemptId && item.adapter === "windows_bridge" && ["started", status].includes(item.status));
    if (!attempt) return null;
    if (!appConfig.useLocalStore && attempt.status === "started") return null;
    const metadata = isPlainObject(attempt.metadata) ? attempt.metadata : {};
    const identity = isPlainObject(metadata.bridgeAckIdentity) ? metadata.bridgeAckIdentity : {};
    const taskCustomerId = String(task?.conversation?.customerId || task?.customerId || task?.designJob?.customerId || task?.quoteDraft?.customerId || "");
    const expectedOutboxFileName = bridgeFileName(metadata.bridgeAckOutboxFileName);
    const checks = [
      payload?.version === BRIDGE_ACK_VERSION || payload?.protocolVersion === BRIDGE_ACK_VERSION,
      String(payload?.taskId || "") === String(task.id || ""),
      String(payload?.wechatAccountId || "") === String(task.wechatAccountId || ""),
      String(payload?.conversationId || "") === String(task.conversationId || ""),
      Boolean(taskCustomerId) && String(payload?.customerId || "") === taskCustomerId,
      String(identity.wechatAccountId || "") === String(task.wechatAccountId || ""),
      String(identity.conversationId || "") === String(task.conversationId || ""),
      String(identity.customerId || "") === taskCustomerId,
      Boolean(expectedOutboxFileName) && bridgeFileName(payload?.outboxFileName || payload?.outboxFile) === expectedOutboxFileName,
      Boolean(metadata.bridgeAckTokenHash) && hashBridgeAckToken(payload) === metadata.bridgeAckTokenHash,
    ];
    if (checks.some((passed) => !passed)) return null;
    if (!appConfig.useLocalStore && attempt.status === status) {
      const archivePatch: Record<string, unknown> = {};
      if (!metadata.archivedOutboxPath && expectedOutboxFileName) {
        const archivedOutboxPath = this.archiveBridgeOutboxFile(
          expectedOutboxFileName,
          status === "sent" ? "processed" : "failed",
        );
        if (archivedOutboxPath) archivePatch.archivedOutboxPath = archivedOutboxPath;
      }
      if (!metadata.archivedDispatchPath) {
        const archivedDispatchPath = this.archiveBridgeDispatchFile(
          task,
          attempt,
          status === "sent" ? "processed" : "failed",
        );
        if (archivedDispatchPath) archivePatch.archivedDispatchPath = archivedDispatchPath;
      }
      if (Object.keys(archivePatch).length > 0) {
        attempt = await this.persistence.updateSendAttempt(attempt.id, {
          metadata: {
            ...archivePatch,
            bridgeAckArchiveRecoveredAt: new Date().toISOString(),
          },
        });
      }
    }
    if (attempt.status === "started" && appConfig.useLocalStore) {
      if (status === "sent") await this.markLinkedQuoteSent(task);
      else await this.markLinkedQuoteFailed(task, payload.errorMessage || "Windows 桥接发送失败");
      const completedAt = new Date().toISOString();
      const completedAttempt = this.localStore.updateSendAttempt(attempt.id, {
        status,
        errorMessage: payload.errorMessage || "",
        completedAt,
      });
      const archivedOutboxPath = expectedOutboxFileName
        ? this.archiveBridgeOutboxFile(expectedOutboxFileName, status === "sent" ? "processed" : "failed")
        : null;
      const archivedDispatchPath = this.archiveBridgeDispatchFile(
        task,
        completedAttempt,
        status === "sent" ? "processed" : "failed",
      );
      attempt = this.localStore.updateSendAttempt(completedAttempt.id, {
        metadata: {
          ...(isPlainObject(completedAttempt.metadata) ? completedAttempt.metadata : {}),
          bridgeAckCommitRecoveredAt: completedAt,
          archivedOutboxPath,
          archivedDispatchPath,
        },
      });
    }
    return {
      task,
      attempt,
      idempotent: true,
      binding: { ok: true, status: "passed", reason: "duplicate bridge ack matches completed attempt" },
      currentBinding: appConfig.useLocalStore
        ? this.validateExistingSendTaskBinding(task)
        : validateSendTaskBinding({ task, conversation: task.conversation, designJob: task.designJob, quoteDraft: task.quoteDraft }),
    };
  }

  private async resolveBridgeAckAttempt(task: any, payload: { attemptId?: string }) {
    if (payload.attemptId) {
      return (await this.persistence.listSendAttempts({ sendTaskId: task.id, limit: 300 }))
        .find((attempt: any) => attempt.id === payload.attemptId) || null;
    }
    return this.persistence.getLatestSendAttempt(task.id, {
      adapter: "windows_bridge",
      status: "started",
    });
  }

  private resolveLocalBridgeAckAttempt(task: any, payload: { attemptId?: string }) {
    if (payload.attemptId) {
      return this.localStore
        .listSendAttempts({ sendTaskId: task.id, limit: 300 })
        .find((attempt: any) => attempt.id === payload.attemptId) || null;
    }
    return this.localStore.getLatestSendAttempt(task.id, {
      adapter: "windows_bridge",
      status: "started",
    });
  }

  private resolveBridgeAckOutboxFileName(payload: { outboxFileName?: string; outboxFile?: string; metadata?: Record<string, unknown> }, attempt: any) {
    return bridgeFileName(
      payload.outboxFileName ||
        payload.outboxFile ||
        payload.metadata?.outboxFileName ||
        payload.metadata?.outboxFile ||
        attempt?.metadata?.outboxFileName ||
        attempt?.metadata?.outboxFile,
    );
  }

  private archiveBridgeOutboxFile(fileName: string, outcome: "processed" | "failed" | "cancelled") {
    const safeName = path.basename(fileName);
    if (!safeName || safeName !== fileName) return null;
    return this.sendAdapter.moveBridgeOutboxFile(path.join(appConfig.wechatBridgeOutboxDir, safeName), outcome);
  }

  private archiveBridgeDispatchFile(task: any, attempt: any, outcome: "processed" | "failed" | "cancelled" | "uncertain") {
    const fileName = this.resolveBridgeDispatchFileName(task, attempt);
    if (!fileName) return null;
    return this.sendAdapter.moveBridgeDispatchFile(path.join(appConfig.wechatBridgeDispatchDir, fileName), outcome);
  }

  private resolveBridgeDispatchFileName(task: any, attempt: any) {
    const metadata = isPlainObject(attempt?.metadata) ? attempt.metadata : {};
    const explicit = bridgeFileName(metadata.dispatchFileName || metadata.dispatchFile || metadata.archivedDispatchFileName);
    if (explicit) return explicit;
    const accountId = safeBridgeFileSegment(task?.wechatAccountId || attempt?.wechatAccountId || "");
    const taskId = safeBridgeFileSegment(task?.id || attempt?.sendTaskId || "");
    const attemptId = safeBridgeFileSegment(attempt?.id || "");
    if (!accountId || !taskId || !attemptId) return "";
    return `${accountId}-${taskId}-${attemptId}.dispatch.json`;
  }

  private async createReviewLog(payload: {
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
    const effectId = effectKey ? deterministicOperationId("review", effectKey) : "";
    if (effectId && typeof prisma.reviewLog.findUnique === "function") {
      const existing = await prisma.reviewLog.findUnique({ where: { id: effectId } });
      if (existing) return existing;
    }
    try {
      return await prisma.reviewLog.create({ data: effectId ? { id: effectId, ...payload } : payload });
    } catch (error) {
      if (!effectId || !isUniqueConstraintError(error) || typeof prisma.reviewLog.findUnique !== "function") throw error;
      const winner = await prisma.reviewLog.findUnique({ where: { id: effectId } });
      if (!winner) throw error;
      return winner;
    }
  }
}

type CompletedReplayIdentity = {
  wechatAccountId: string;
  conversationId: string;
  customerId: string;
};

function completedReplayEntityIdentity(label: string, value: any): CompletedReplayIdentity {
  const source = label === "notification"
    ? value?.target
    : label === "manual-lock review log"
      ? value?.metadata
      : label === "quote draft"
        ? {
            wechatAccountId: value?.designJob?.wechatAccountId,
            conversationId: value?.designJob?.conversationId,
            customerId: value?.customerId || value?.designJob?.customerId,
          }
        : label === "manual-lock conversation"
          ? {
              wechatAccountId: value?.wechatAccountId,
              conversationId: value?.id,
              customerId: value?.customerId,
            }
          : value;
  return {
    wechatAccountId: String(source?.wechatAccountId || "").trim(),
    conversationId: String(source?.conversationId || "").trim(),
    customerId: String(source?.customerId || "").trim(),
  };
}

function assertCompletedReplayIdentity(label: string, value: any, expected: CompletedReplayIdentity) {
  const actual = completedReplayEntityIdentity(label, value);
  if (
    !expected.wechatAccountId ||
    !expected.conversationId ||
    !expected.customerId ||
    actual.wechatAccountId !== expected.wechatAccountId ||
    actual.conversationId !== expected.conversationId ||
    actual.customerId !== expected.customerId
  ) {
    throw new BadRequestException(`completed inbound operation has a foreign or incomplete durable ${label} identity`);
  }
}

function inboundSelectionRecovery(value: unknown) {
  const result = isPlainObject(value) ? value : {};
  const effect = isPlainObject(result.recoveryEffect) ? result.recoveryEffect : {};
  if (
    !["high_value_image_selection", "low_value_image_selection"].includes(String(effect.kind || "")) ||
    effect.phase !== "selection_committed"
  ) return null;
  const designJobId = String(effect.designJobId || "").trim();
  const selectedImageId = String(effect.selectedImageId || "").trim();
  const quoteDraftId = String(effect.quoteDraftId || "").trim();
  if (!designJobId || !selectedImageId) {
    throw new BadRequestException("inbound selection recovery marker is incomplete");
  }
  if (effect.kind === "low_value_image_selection" && !quoteDraftId) {
    throw new BadRequestException("low-value inbound selection recovery marker is missing its quote draft");
  }
  return { kind: String(effect.kind), designJobId, selectedImageId, quoteDraftId: quoteDraftId || null };
}

function inboundQuoteAcceptanceRecovery(value: unknown) {
  const result = isPlainObject(value) ? value : {};
  const effect = isPlainObject(result.recoveryEffect) ? result.recoveryEffect : {};
  if (effect.kind !== "low_value_quote_acceptance" || effect.phase !== "quote_and_order_committed") return null;
  const quoteDraftId = String(effect.quoteDraftId || "").trim();
  const orderDraftId = String(effect.orderDraftId || "").trim();
  const acceptancePlan = isPlainObject(effect.acceptancePlan) ? effect.acceptancePlan : null;
  if (!quoteDraftId || !orderDraftId || !acceptancePlan?.action || !acceptancePlan?.reason) {
    throw new BadRequestException("inbound quote acceptance recovery marker is incomplete");
  }
  if (!["accept_quote_and_create_order", "update_existing_order_payment"].includes(String(acceptancePlan.action))) {
    throw new BadRequestException("inbound quote acceptance recovery marker has an invalid action");
  }
  return { quoteDraftId, orderDraftId, acceptancePlan };
}

function isOlderThan(value: unknown, now: Date, minutes: number) {
  const time = new Date(String(value || ""));
  if (Number.isNaN(time.getTime())) return false;
  return now.getTime() - time.getTime() > minutes * 60 * 1000;
}

function designSelectionRevisionSignature(job: any) {
  const revisions = (Array.isArray(job?.revisions) ? job.revisions : [])
    .map((revision: any) => ({
      id: String(revision.id || ""),
      revisionNumber: Number(revision.revisionNumber || 0),
      status: String(revision.status || ""),
      resultImageIds: Array.isArray(revision.resultImageIds) ? revision.resultImageIds.map(String).sort() : [],
    }))
    .sort((left: any, right: any) => left.revisionNumber - right.revisionNumber || left.id.localeCompare(right.id));
  const candidates = latestCandidateRound(Array.isArray(job?.images) ? job.images : [])
    .map((candidate: any) => ({
      id: String(candidate.id || ""),
      imageId: String(candidate.imageId || ""),
      position: Number(candidate.position || 0),
    }))
    .sort((left: any, right: any) => left.id.localeCompare(right.id));
  return JSON.stringify({ revisionCount: Number(job?.revisionCount || 0), revisions, candidates });
}

function prismaQuotePricing(job: any) {
  const items = Array.isArray(job?.bundle?.items) ? job.bundle.items : [];
  const unitPrice = items.reduce((sum: number, item: any) => sum + Number(item.salePrice || item.price || 0), 0);
  const unitCost = items.reduce((sum: number, item: any) => sum + Number(item.costPrice || item.cost || 0), 0);
  const quantity = Math.max(1, Number(job?.budget?.quantity || 1));
  const totalPrice = unitPrice * quantity;
  const totalCost = unitCost * quantity;
  const threshold = Number(appConfig.highValueAmountCny || 10000);
  return {
    quantity,
    unitPrice,
    totalPrice,
    totalCost,
    profit: totalPrice - totalCost,
    highValue: totalPrice >= threshold || unitPrice >= threshold,
  };
}

function channelCheck(key: string, label: string, passed: boolean, detail?: string) {
  return {
    key,
    label,
    passed,
    detail: detail || (passed ? "ready" : "not ready"),
  };
}

function checksReady(checks: Array<{ passed: boolean }>) {
  return checks.every((check) => check.passed);
}

function channelStatus(checks: Array<{ key: string; passed: boolean }>) {
  if (checksReady(checks)) return "ready";
  const runtimeKeys = new Set(["window_observer", "windows_bridge"]);
  const sendAdapterKeys = new Set(["safe_send_queue"]);
  const failed = checks.filter((check) => !check.passed);
  if (failed.some((check) => runtimeKeys.has(check.key))) return "needs_runtime";
  if (failed.some((check) => !runtimeKeys.has(check.key) && !sendAdapterKeys.has(check.key))) return "needs_config";
  if (failed.some((check) => sendAdapterKeys.has(check.key))) return "needs_send_adapter";
  return "needs_config";
}

function maskSecret(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "未配置";
  if (text.length <= 6) return "已配置";
  return `${text.slice(0, 2)}...${text.slice(-4)}`;
}

function operatorStatusName(value: unknown) {
  const text = String(value || "").trim();
  return text || "unknown";
}

function bridgeFileName(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/[\\/]/).filter(Boolean).pop() || "";
}

function safeBridgeFileSegment(value: unknown) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "";
}

function normalizeAssetIds(value: any[]): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item : item?.assetId || item?.id || item?.designAssetId))
        .filter(Boolean)
        .map(String),
    ),
  ];
}

function manualOrderQueueRequest(payload: OrderQueueRequest | Record<string, unknown> | null | undefined): OrderQueueRequest {
  const value = isPlainObject(payload) ? payload : {};
  const type = value.type === "production" || value.type === "delivery" ? value.type : undefined;
  return {
    operationKey: stringOrUndefined(value.operationKey),
    expectedWechatAccountId: stringOrUndefined(value.expectedWechatAccountId),
    expectedConversationId: stringOrUndefined(value.expectedConversationId),
    expectedCustomerId: stringOrUndefined(value.expectedCustomerId),
    type,
    owner: stringOrUndefined(value.owner),
    note: stringOrUndefined(value.note),
    reason: stringOrUndefined(value.reason),
    releaseManualLock: value.releaseManualLock === true,
    releaseReason: stringOrUndefined(value.releaseReason),
  };
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function durableJsonSnapshot(value: unknown) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new BadRequestException("inbound durable business result is not JSON serializable");
  }
}

function durableEntityIds(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException("inbound durable entity references must be an array");
  const ids = value.map((item: any) => String(item?.id || "").trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new BadRequestException("inbound durable entity references contain a missing or duplicate id");
  }
  return ids;
}

function durableEntityId(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  const entityId = isPlainObject(value) ? String(value.id || "").trim() : "";
  if (!entityId) throw new BadRequestException(`inbound ${label} result is missing its durable id`);
  return entityId;
}

function durableStringIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids = value.map((item) => String(item || "").trim()).filter(Boolean);
  if (ids.length !== value.length || new Set(ids).size !== ids.length) {
    throw new BadRequestException("completed inbound operation has invalid durable entity references");
  }
  return ids;
}

function durableSelectionSnapshot(value: unknown) {
  if (!isPlainObject(value)) return null;
  const result = isPlainObject(value.result) ? value.result : {};
  const candidate = isPlainObject(result.candidate) ? result.candidate : {};
  return {
    action: String(value.action || ""),
    ok: value.ok === true,
    reviewRequired: value.reviewRequired === true,
    reason: String(value.reason || ""),
    result: {
      imageId: String(result.imageId || candidate.id || candidate.imageId || ""),
      source: String(result.source || ""),
      candidateId: String(candidate.id || ""),
    },
  };
}

function hydrateDurableSelection(value: unknown, designJob: any) {
  if (!isPlainObject(value)) return null;
  const result = isPlainObject(value.result) ? value.result : {};
  const candidateId = String(result.candidateId || result.imageId || "").trim();
  const candidates = Array.isArray(designJob?.images) ? designJob.images : [];
  const candidate = candidateId
    ? candidates.find((item: any) => String(item?.id || "") === candidateId || String(item?.imageId || "") === candidateId) || null
    : null;
  if (candidateId && (!designJob || !candidate)) {
    throw new BadRequestException("completed inbound operation is missing its durable selection design job or candidate");
  }
  return {
    action: String(value.action || ""),
    ok: value.ok === true,
    reviewRequired: value.reviewRequired === true,
    reason: String(value.reason || ""),
    result: {
      imageId: String(result.imageId || candidateId),
      source: String(result.source || ""),
      candidate,
    },
  };
}

function assertManualReleaseReason(reason: unknown, context: string) {
  const text = String(reason || "").trim();
  if (!text || !text.startsWith("manual_")) {
    throw new BadRequestException(`${context} 需要填写明确的人工处理原因，原因编码必须以 manual_ 开头。`);
  }
}

function assertManualReleaseNote(note: unknown, context: string) {
  const text = String(note || "").trim();
  if (!text) {
    throw new BadRequestException(`${context} 需要填写人工处理结果，确认客户问题已处理完再解除接管。`);
  }
}

function buildManualReviewLockNote(reason?: string) {
  const label = manualReviewReasonLabel(reason);
  return `已转人工处理：${label}。自动回复和待发送任务已暂停，处理完成后请填写结果再恢复自动化。`;
}

function manualReviewReasonLabel(reason?: string) {
  const key = String(reason || "").trim();
  const labels: Record<string, string> = {
    high_value_customer_selected_image: "高价值客户已选图，需要人工复核报价和跟进策略",
    quote_already_queued_or_sent: "客户在报价进入发送流程后又修改选择，需要人工确认",
    quote_acceptance_uncertain: "客户确认意图不够明确，需要人工判断是否成交",
    quote_acceptance_manual_review: "客户回复涉及报价确认，需要人工复核",
    payment_proof_needs_manual_verification: "客户发送付款凭证，需要人工核验金额和收款状态",
    manual_review: "当前对话需要人工判断后再继续",
  };
  return labels[key] || "当前情况不适合继续自动处理，需要人工判断";
}

function sanitizeBridgeAckMetadata(value: unknown): Record<string, unknown> {
  const sanitized = redactBridgeAckSecrets(isPlainObject(value) ? value : {});
  return isPlainObject(sanitized) ? sanitized : {};
}

function hashBridgeAckToken(payload: any) {
  const token = typeof payload?.ackToken === "string"
    ? payload.ackToken
    : typeof payload?.bridgeAckToken === "string"
      ? payload.bridgeAckToken
      : "";
  return token ? createHash("sha256").update(token).digest("hex") : "";
}

function sanitizeWindowObserverStatus(value: unknown) {
  const data = isPlainObject(value) ? value : {};
  const result = isPlainObject(data.result) ? data.result : null;
  return {
    ok: Boolean(data.ok),
    status: String(data.status || "unknown"),
    ageSeconds: data.ageSeconds ?? null,
    modifiedAt: typeof data.modifiedAt === "string" ? data.modifiedAt : undefined,
    scan: Boolean(data.scan),
    dryRun: Boolean(data.dryRun),
    message: typeof data.message === "string" ? data.message : "",
    errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
    result: result
      ? {
          wroteSnapshot: Boolean(result.wroteSnapshot),
          isOnline: Boolean(result.isOnline),
          wechatAccountId: typeof result.wechatAccountId === "string" ? result.wechatAccountId : "",
          confidence: Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : 0,
          processName: typeof result.processName === "string" ? result.processName : "",
          processId: Number.isFinite(Number(result.processId)) ? Number(result.processId) : null,
          scanScanned: result.scanScanned === null ? null : Number.isFinite(Number(result.scanScanned)) ? Number(result.scanScanned) : null,
          scanProcessed: result.scanProcessed === null ? null : Number.isFinite(Number(result.scanProcessed)) ? Number(result.scanProcessed) : null,
          scanFailed: result.scanFailed === null ? null : Number.isFinite(Number(result.scanFailed)) ? Number(result.scanFailed) : null,
          scanPending: result.scanPending === null ? null : Number.isFinite(Number(result.scanPending)) ? Number(result.scanPending) : null,
          scanTotal: result.scanTotal === null ? null : Number.isFinite(Number(result.scanTotal)) ? Number(result.scanTotal) : null,
          scanLimit: result.scanLimit === null ? null : Number.isFinite(Number(result.scanLimit)) ? Number(result.scanLimit) : null,
        }
      : null,
  };
}

function sanitizeWindowObserverStdout(value: unknown) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    hasOutput: lines.length > 0,
    lineCount: lines.length,
  };
}

function sanitizeWindowSnapshotScanItem(value: unknown) {
  const data = isPlainObject(value) ? value : {};
  const diagnostic = isPlainObject(data.diagnostic) ? data.diagnostic : {};
  return {
    id: typeof data.id === "string" ? data.id : "",
    source: typeof data.source === "string" ? data.source : "",
    isOnline: Boolean(data.isOnline),
    wechatAccountId: typeof data.wechatAccountId === "string" ? data.wechatAccountId : "",
    recentCustomerId: typeof data.recentCustomerId === "string" ? data.recentCustomerId : "",
    confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : 0,
    capturedAt: typeof data.capturedAt === "string" ? data.capturedAt : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    diagnostic: {
      ok: Boolean(diagnostic.ok),
      status: typeof diagnostic.status === "string" ? diagnostic.status : "",
      riskLevel: typeof diagnostic.riskLevel === "string" ? diagnostic.riskLevel : "",
      reason: typeof diagnostic.reason === "string" ? diagnostic.reason : "",
      activeConversationId: typeof diagnostic.activeConversationId === "string" ? diagnostic.activeConversationId : null,
      activeCustomerId: typeof diagnostic.activeCustomerId === "string" ? diagnostic.activeCustomerId : null,
      failedKeys: Array.isArray(diagnostic.failedKeys) ? diagnostic.failedKeys.map(String) : [],
    },
  };
}

function sanitizeBridgeWorkerStatus(value: unknown) {
  const data = isPlainObject(value) ? value : {};
  const result = isPlainObject(data.result) ? data.result : {};
  return {
    ok: Boolean(data.ok),
    status: String(data.status || "unknown"),
    ageSeconds: data.ageSeconds ?? null,
    modifiedAt: typeof data.modifiedAt === "string" ? data.modifiedAt : undefined,
    mode: typeof data.mode === "string" ? data.mode : undefined,
    ackTransport: typeof data.ackTransport === "string" ? data.ackTransport : undefined,
    errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
    message: typeof data.message === "string" ? data.message : "",
    result: {
      scanned: Number(result.scanned || 0),
      processedCount: Number(result.processedCount || 0),
      skippedCount: Number(result.skippedCount || 0),
      failedCount: Number(result.failedCount || 0),
    },
  };
}

function sanitizeBridgeLockItem(lock: unknown) {
  const data = isPlainObject(lock) ? lock : {};
  return {
    fileName: String(data.fileName || ""),
    accountId: typeof data.accountId === "string" ? data.accountId : undefined,
    pid: Number.isFinite(Number(data.pid)) ? Number(data.pid) : undefined,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
    modifiedAt: typeof data.modifiedAt === "string" ? data.modifiedAt : "",
    ageSeconds: Number(data.ageSeconds || 0),
    stale: Boolean(data.stale),
    errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
  };
}

function redactBridgeAckSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactBridgeAckSecrets(item));
  if (!isPlainObject(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const compactKey = normalizedKey.replace(/[^a-z0-9]/g, "");
    if (
      normalizedKey.includes("acktoken") ||
      normalizedKey === "token" ||
      compactKey.includes("token") ||
      compactKey.includes("secret") ||
      compactKey.includes("password") ||
      compactKey.includes("apikey") ||
      normalizedKey === "authorization" ||
      normalizedKey === "cookie" ||
      normalizedKey === "set-cookie"
    ) continue;
    output[key] = redactBridgeAckSecrets(item);
  }
  return output;
}

function validateBridgeSendPlanActions(actions: unknown[]) {
  if (!Array.isArray(actions) || !actions.length) {
    return { ok: false, reason: "send plan must include at least one action" };
  }
  for (const action of actions) {
    if (!isPlainObject(action)) {
      return { ok: false, reason: "send plan action must be an object" };
    }
    const type = String(action.type || "").trim();
    if (type === "text") {
      if (!String(action.text || "").trim()) return { ok: false, reason: "text action must include non-empty text" };
      continue;
    }
    if (type === "image") {
      if (!resolveBridgeLocalStorageFile(action.filePath)) {
        return { ok: false, reason: "image action must use an existing local storage file" };
      }
      continue;
    }
    return { ok: false, reason: `unsupported send action type: ${type || "empty"}` };
  }
  return { ok: true, reason: "send plan actions are valid" };
}

function validateWechatWorkImagePaths(imagePaths: unknown[]) {
  try {
    for (const imagePath of imagePaths) resolveWechatWorkImageFile(imagePath);
    return {
      ok: true,
      detail: imagePaths.length ? `${imagePaths.length} image file(s) passed local storage validation` : "no images",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "wechat work image validation failed",
    };
  }
}

function describeWechatWorkDeliveryFailure(error: unknown) {
  if (error instanceof WechatWorkKfDeliveryError) {
    return {
      retrySafe: error.retrySafe,
      deliveryState: error.deliveryState,
      stage: error.stage,
      acceptedMessageIds: error.acceptedMessageIds,
      uploadedMediaIds: error.uploadedMediaIds,
    };
  }
  return {
    retrySafe: false,
    deliveryState: "unknown" as const,
    stage: "adapter",
    acceptedMessageIds: [] as string[],
    uploadedMediaIds: [] as string[],
  };
}

function appendCustomerNote(current: unknown, next: string) {
  const existing = String(current || "").trim();
  const note = String(next || "").trim();
  if (!note) return existing;
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} ${note}`;
}

function resolveBridgeLocalStorageFile(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return "";
  const storageRoot = path.resolve(appConfig.localStorageRoot);
  const projectRoot = path.dirname(storageRoot);
  const candidates = path.isAbsolute(raw)
    ? [path.resolve(raw)]
    : [path.resolve(projectRoot, raw), path.resolve(storageRoot, raw)];
  for (const candidate of candidates) {
    const relative = path.relative(storageRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      if (!fs.lstatSync(candidate).isFile()) continue;
      const realRoot = fs.realpathSync(storageRoot);
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) continue;
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

function listJsonInboxFiles(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      const stat = fs.statSync(filePath);
      return {
        fileName: entry.name,
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds: Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 1000)),
      };
    })
    .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.fileName.localeCompare(b.fileName));
}

function orderSendContextLabel(context: string) {
  const labels: Record<string, string> = {
    "order confirmation": "订单确认",
    "order follow-up": "订单跟进",
    "order confirmation requeue": "订单确认重新排队",
    "order follow-up requeue": "订单跟进重新排队",
  };
  return labels[context] || "订单发送";
}

function clampWindowSnapshotScanLimit(value: unknown) {
  const limit = Math.floor(Number(value || 5));
  if (!Number.isFinite(limit) || limit <= 0) return 5;
  return Math.max(1, Math.min(limit, 200));
}

function readJsonFile(filePath: string) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function currentWechatWindowObserverProofToken() {
  try {
    const token = String(fs.readFileSync(appConfig.wechatWindowObserverProofFile, "utf8") || "").trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : "";
  } catch {
    return "";
  }
}

function normalizeWindowSnapshotInboxPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isPlainObject(data) && Array.isArray(data.snapshots)) return data.snapshots;
  return [data];
}

function claimJsonInboxFile(filePath: string, inboxDir: string) {
  const root = path.resolve(inboxDir);
  const source = path.resolve(filePath);
  const relative = path.relative(root, source);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("refuse to claim file outside window snapshot inbox");
  }
  const processingDir = path.join(root, "processing");
  fs.mkdirSync(processingDir, { recursive: true });
  const parsed = path.parse(source);
  const target = path.join(processingDir, `${parsed.name}-${process.pid}-${Date.now()}${parsed.ext}`);
  fs.renameSync(source, target);
  return target;
}

function markWindowDiagnosticNonSendable(diagnostic: Record<string, unknown>, reason: string) {
  return {
    ...diagnostic,
    observerEvidence: {
      verified: false,
      reason,
    },
  };
}

function trustedObserverSnapshot(snapshot: Record<string, unknown>, evidence: Record<string, unknown>) {
  const hasAccount = Boolean(String(snapshot.wechatAccountId || snapshot.accountDisplayName || "").trim());
  const hasConversation = Boolean(
    String(snapshot.externalChatId || snapshot.chatTitle || snapshot.recentCustomerId || "").trim(),
  );
  const confidence = Math.min(0.99, (snapshot.isOnline === true ? 0.55 : 0.15) + (hasAccount ? 0.2 : 0) + (hasConversation ? 0.2 : 0));
  return {
    ...snapshot,
    source: "windows_foreground_observer",
    capturedAt: String(evidence.issuedAt || ""),
    confidence: Number(confidence.toFixed(2)),
  };
}

function moveJsonInboxFile(filePath: string, inboxDir: string, status: "processed" | "failed") {
  const root = path.resolve(inboxDir);
  const source = path.resolve(filePath);
  const relative = path.relative(root, source);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refuse to archive file outside window snapshot inbox: ${filePath}`);
  }

  const archiveDir = path.join(root, status);
  fs.mkdirSync(archiveDir, { recursive: true });
  const parsed = path.parse(source);
  const target = path.join(archiveDir, `${parsed.name}-${Date.now()}${parsed.ext}`);
  fs.renameSync(source, target);
  return target;
}

function isSceneMemorySample(sample: any) {
  if (!sample?.agentKey || !sample?.customerText) return false;
  if (String(sample.status || "ready") !== "ready") return false;
  const usage = sample.quality?.usage || classifyTrainingSampleUsage(sample);
  if (usage.routeMemory === false) return false;
  const sourceType = String(sample.sourceType || (sample.sourceRouteId ? "route_correction" : sample.importId ? "chat_import" : ""));
  if (sourceType === "route_correction") return Number(sample.score || 0) >= 70;
  if (sourceType !== "chat_import") return false;
  if (Number(sample.score || 0) < 85) return false;
  if (!isConfirmedChatImportScene(sample)) return false;
  if (sample.quality?.trainable === false) return false;
  if (["review", "risk", "blocked"].includes(String(sample.quality?.level || ""))) return false;
  return true;
}

function isConfirmedChatImportScene(sample: any) {
  const sceneCheck = sample.sceneCheck || sample.sceneDecision || null;
  if (sceneCheck?.status) return sceneCheck.status === "clear";
  if (sample.sceneScore === undefined || sample.sceneScore === null) return true;
  const sceneScore = Number(sample.sceneScore || 0);
  return Number.isFinite(sceneScore) && sceneScore >= 14;
}

function isLowValueAutomationTask(task: any) {
  const automation = task?.guardSnapshot?.automation || {};
  if (automation.valueLevel !== "low") return false;
  if (isHighValueAutomationTask(task)) return false;
  return true;
}

function isHighValueLowValueAutomationTask(task: any) {
  const automation = task?.guardSnapshot?.automation || {};
  return automation.valueLevel === "low" && isHighValueAutomationTask(task);
}

function isHighValueAutomationTask(task: any) {
  const threshold = Number(appConfig.highValueAmountCny || 10000);
  const designJob = task?.designJob || task?.quoteDraft?.designJob || task?.orderDraft?.designJob || task?.orderDraft?.quoteDraft?.designJob || {};
  const quote = task?.quoteDraft || task?.orderDraft?.quoteDraft || {};
  const order = task?.orderDraft || {};
  if (designJob?.isHighValue === true || quote?.isHighValue === true || order?.isHighValue === true) return true;
  if (isHighValueBudget(designJob?.budget, threshold)) return true;
  return isHighValueAmount(order?.totalPrice ?? quote?.totalPrice, order?.unitPrice ?? quote?.unitPrice, threshold);
}

function isHighValueAmount(totalAmount: unknown, unitAmount: unknown, threshold: number) {
  const total = Number(totalAmount || 0);
  const unit = Number(unitAmount || 0);
  return (
    (Number.isFinite(total) && total >= threshold) ||
    (Number.isFinite(unit) && unit >= threshold)
  );
}
