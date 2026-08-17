import path from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  assertExactOperationReplay,
  createOperationFingerprint,
  deterministicOperationId,
  isUniqueConstraintError,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
} from "../shared/operation-idempotency";

const {
  buildOrderConfirmationCustomerMessage,
  buildOrderFollowupCustomerMessage,
  buildOrderDraftFromQuote,
  cleanOrderDraftPatch,
  evaluateOrderFulfillmentTransition,
  evaluateLowValueOrderDraftFromQuote,
  isValidCarrier,
  isValidTrackingNo,
  normalizeDesignImageSnapshot,
  normalizeCarrier,
  normalizeTrackingNo,
  quotePatchForOrderDraft,
  validateOrderDraftQuoteBinding,
} = require(path.join(process.cwd(), "packages", "rules"));

const AFTER_SALES_CREATE_DECISION = "after_sales_case_created";
const AFTER_SALES_RESOLVE_DECISION = "after_sales_case_resolved";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) return this.localStore.listOrderDrafts(filter);
    const orders = await (this.prisma as any).orderDraft.findMany({
      where: {
        ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
        ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      include: this.orderInclude(),
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return this.attachOrderSendTasks(orders);
  }

  async getById(id: string, expected: ExpectedIdentityPayload = {}) {
    const order = await this.getOrderDraft(id);
    if (!order) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(order, expected, "order draft");
    return order;
  }

  async confirmationPreview(id: string, expected: ExpectedIdentityPayload = {}) {
    const order = await this.getOrderDraft(id);
    if (!order) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(order, expected, "order draft");
    const warnings = this.orderConfirmationPreviewWarnings(order);
    return {
      orderDraft: order,
      message: this.buildOrderConfirmationMessage(order),
      warnings,
    };
  }

  async followupPreview(id: string, type: "production" | "delivery" = "production", expected: ExpectedIdentityPayload = {}) {
    const order = await this.getOrderDraft(id);
    if (!order) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(order, expected, "order draft");
    const followupType = type === "delivery" ? "delivery" : "production";
    return {
      orderDraft: order,
      type: followupType,
      message: this.buildOrderFollowupMessage(order, followupType),
      warnings: this.orderFollowupPreviewWarnings(order, followupType),
    };
  }

  async listAfterSalesCases(id: string, expected: ExpectedIdentityPayload = {}) {
    const order = await this.getOrderDraft(id);
    if (!order) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(order, expected, "order draft");
    const logs = await this.listAfterSalesReviewLogs(id);
    return buildAfterSalesCasesFromLogs(logs, order);
  }

  async createAfterSalesCase(id: string, payload: AfterSalesCreatePatch & ExpectedIdentityPayload = {}) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "operationKey");
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(current, payload, "order draft");

    const type = normalizeAfterSalesType(payload.type);
    const reason = cleanAfterSalesText(payload.reason, 800);
    if (!reason) throw new BadRequestException("售后申请必须填写客户问题、证据或处理原因。");
    const requestedAmountCny = normalizeAfterSalesAmount(payload.requestedAmountCny);
    if (["refund", "compensation"].includes(type) && (requestedAmountCny === null || requestedAmountCny <= 0)) {
      throw new BadRequestException("退款或补偿售后必须填写大于 0 的申请金额。");
    }

    const paymentSummary = await this.afterSalesPaymentSummary(current);
    if (requestedAmountCny !== null && requestedAmountCny > paymentSummary.refundableAmountCny + 0.0001) {
      throw new BadRequestException(`售后申请金额超过可退金额：可退 ${paymentSummary.refundableAmountCny} 元。`);
    }

    const effectKey = `after-sales-case:${operationKey}`;
    const caseId = deterministicOperationId("after_sales_case", effectKey);
    const requestOperation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "after-sales-case-create",
        afterSalesOperationIdentity(id, current, payload),
        {
          type,
          reason,
          requestedAmountCny,
          evidenceReference: cleanAfterSalesText(payload.evidenceReference, 300),
          desiredResolution: cleanAfterSalesText(payload.desiredResolution, 500),
        },
      ),
    );

    const existing = await this.findReviewLogByEffectKey(effectKey);
    if (existing) {
      assertExactOperationReplay(readRequestOperationMetadata(existing.metadata), requestOperation, "after-sales case");
      return buildAfterSalesCaseFromCreateLog(existing, current);
    }

    const reviewLog = await this.createReviewLog({
      targetType: "order_draft",
      targetId: id,
      decision: AFTER_SALES_CREATE_DECISION,
      reviewer: payload.owner || "人工客服",
      note: `after_sales_created:${type}`,
      beforeStatus: String(current.status || ""),
      afterStatus: "open",
      metadata: {
        effectKey,
        requestOperation,
        source: "manual_order_after_sales",
        caseId,
        status: "open",
        type,
        reason,
        requestedAmountCny,
        evidenceReference: cleanAfterSalesText(payload.evidenceReference, 300),
        desiredResolution: cleanAfterSalesText(payload.desiredResolution, 500),
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId || null,
        designJobId: current.designJobId || null,
        paymentSummary,
      },
    });

    await this.notifications.create(
      "warning",
      "订单售后待处理",
      `订单 ${id} 已创建售后 case，类型：${afterSalesTypeLabel(type)}。`,
      {
        effectKey: `${effectKey}:notification`,
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId,
        designJobId: current.designJobId,
        wechatAccountId: current.wechatAccountId,
        conversationId: current.conversationId,
        customerId: current.customerId,
        afterSalesCaseId: caseId,
      },
    );

    return buildAfterSalesCaseFromCreateLog(reviewLog, current);
  }

  async resolveAfterSalesCase(
    id: string,
    caseId: string,
    payload: AfterSalesResolvePatch & ExpectedIdentityPayload = {},
  ) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "operationKey");
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(current, payload, "order draft");

    const cases = await this.listAfterSalesCases(id, payload);
    const afterSalesCase = cases.find((item: any) => item.id === caseId);
    if (!afterSalesCase) throw new BadRequestException(`没有找到售后 case：${caseId}`);

    const resolutionType = normalizeAfterSalesResolutionType(payload.resolutionType);
    const approvedAmountCny = normalizeAfterSalesAmount(payload.approvedAmountCny);
    const note = cleanAfterSalesText(payload.note, 1000);
    const replacementCarrier = normalizeCarrier(cleanAfterSalesText(payload.replacementCarrier, 120));
    const replacementTrackingNo = normalizeTrackingNo(cleanAfterSalesText(payload.replacementTrackingNo, 120));

    if (["refund", "compensation"].includes(resolutionType) && (approvedAmountCny === null || approvedAmountCny <= 0)) {
      throw new BadRequestException("退款或补偿处理必须填写大于 0 的实际金额。");
    }
    if (["refund", "compensation"].includes(resolutionType) && !cleanAfterSalesText(payload.refundMethod, 120)) {
      throw new BadRequestException("退款或补偿处理必须填写实际退款方式。");
    }
    if (["refund", "compensation"].includes(resolutionType) && !cleanAfterSalesText(payload.refundReference, 160)) {
      throw new BadRequestException("退款或补偿处理必须填写可核验的退款凭证号。");
    }
    if (resolutionType === "replacement" && (!replacementCarrier || !replacementTrackingNo)) {
      throw new BadRequestException("记录补发完成必须填写物流公司和可核验的补发物流单号；尚未发出时请保持 case 待处理。");
    }
    if (resolutionType === "replacement" && (!isValidCarrier(replacementCarrier) || !isValidTrackingNo(replacementTrackingNo))) {
      throw new BadRequestException("补发物流公司或物流单号格式不正确；请填写真实承运方和至少 6 位、包含数字的可核验单号。");
    }

    const paymentSummary = await this.afterSalesPaymentSummary(current);
    if (approvedAmountCny !== null && approvedAmountCny > paymentSummary.refundableAmountCny + 0.0001) {
      throw new BadRequestException(`售后处理金额超过可退金额：可退 ${paymentSummary.refundableAmountCny} 元。`);
    }

    const effectKey = `after-sales-resolve:${caseId}:${operationKey}`;
    const requestOperation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "after-sales-case-resolve",
        afterSalesOperationIdentity(id, current, payload),
        {
          caseId,
          resolutionType,
          approvedAmountCny,
          refundMethod: cleanAfterSalesText(payload.refundMethod, 120),
          refundReference: cleanAfterSalesText(payload.refundReference, 160),
          replacementCarrier,
          replacementTrackingNo,
          note,
        },
      ),
    );

    const existing = await this.findReviewLogByEffectKey(effectKey);
    if (existing) {
      assertExactOperationReplay(readRequestOperationMetadata(existing.metadata), requestOperation, "after-sales resolution");
      return (await this.listAfterSalesCases(id, payload)).find((item: any) => item.id === caseId);
    }
    if (afterSalesCase.status !== "open") throw new BadRequestException("售后 case 已处理，不能重复提交新的处理结论。");

    let paymentEvent: any = null;
    if (["refund", "compensation"].includes(resolutionType) && approvedAmountCny !== null && approvedAmountCny > 0) {
      paymentEvent = await this.recordAfterSalesRefundEvent(current, {
        amountCny: approvedAmountCny,
        idempotencyKey: `after-sales-refund:${caseId}:${operationKey}`,
        method: cleanAfterSalesText(payload.refundMethod, 120),
        proofReference: cleanAfterSalesText(payload.refundReference, 160),
        reviewer: payload.owner || "人工客服",
        note: note || `售后 ${caseId} 已记录${resolutionType === "refund" ? "退款" : "补偿"}。`,
      });
    }

    const status = afterSalesStatusForResolution(resolutionType);
    const reviewLog = await this.createReviewLog({
      targetType: "order_draft",
      targetId: id,
      decision: AFTER_SALES_RESOLVE_DECISION,
      reviewer: payload.owner || "人工客服",
      note: `after_sales_resolved:${resolutionType}`,
      beforeStatus: "open",
      afterStatus: status,
      metadata: {
        effectKey,
        requestOperation,
        source: "manual_order_after_sales_resolution",
        caseId,
        status,
        resolutionType,
        approvedAmountCny,
        refundMethod: cleanAfterSalesText(payload.refundMethod, 120),
        refundReference: cleanAfterSalesText(payload.refundReference, 160),
        replacementCarrier,
        replacementTrackingNo,
        note,
        paymentEventId: paymentEvent?.id || null,
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId || null,
        designJobId: current.designJobId || null,
        paymentSummary: await this.afterSalesPaymentSummary(current),
      },
    });
    assertExactOperationReplay(readRequestOperationMetadata(reviewLog.metadata), requestOperation, "after-sales resolution");

    await this.notifications.create(
      "info",
      "订单售后内部结论已记录",
      `订单 ${id} 的售后 case 已记录内部处理结论：${afterSalesResolutionLabel(resolutionType)}；仍需核对客户回访结果。`,
      {
        effectKey: `${effectKey}:notification`,
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId,
        designJobId: current.designJobId,
        wechatAccountId: current.wechatAccountId,
        conversationId: current.conversationId,
        customerId: current.customerId,
        afterSalesCaseId: caseId,
        paymentEventId: paymentEvent?.id || null,
      },
    );

    return (await this.listAfterSalesCases(id, payload)).find((item: any) => item.id === caseId);
  }

  async createFromQuote(quoteId: string, expected: ExpectedIdentityPayload = {}) {
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new BadRequestException(`没有找到报价草稿：${quoteId}`);
    assertExpectedIdentity(quote, expected, "quote draft");

    const decision = buildOrderDraftFromQuote(quote);
    if (!decision.ok) {
      const missing = decision.missing?.length ? `，缺少：${decision.missing.map(orderDraftMissingLabel).join("、")}` : "";
      throw new BadRequestException(`报价还不能生成订单草稿：${orderDraftDecisionReasonLabel(decision.reason)}${missing}`);
    }
    await this.assertQuotePaymentLedgerForOrderCreation(quote, decision.orderDraft);

    const orderDraft = appConfig.useLocalStore
      ? this.localStore.upsertOrderDraftFromQuote(quoteId, decision.orderDraft)
      : await this.upsertPrismaOrderDraft(quoteId, decision.orderDraft);
    this.assertCreatedOrderDraftBinding(orderDraft, quote);

    await this.notifications.create(
      "info",
      "订单草稿已生成",
      `客户 ${quote.customer?.name || quote.customerId} 的报价已生成订单草稿，金额 ${decision.orderDraft.totalPrice} 元。`,
      {
        orderDraftId: orderDraft.id,
        quoteDraftId: quoteId,
        designJobId: quote.designJobId,
        wechatAccountId: orderDraft.wechatAccountId,
        conversationId: orderDraft.conversationId,
        customerId: orderDraft.customerId,
      },
    );

    return orderDraft;
  }

  async update(id: string, patch: OrderDraftUpdatePatch & ExpectedIdentityPayload) {
    assertGenericOrderUpdatePatch(patch || {});
    return this.updateOrderDraft(id, patch || {});
  }

  async updateFulfillment(id: string, patch: OrderFulfillmentUpdatePatch & ExpectedIdentityPayload) {
    const operationKey = normalizeOperationKey(patch?.operationKey, "operationKey");
    const { operationKey: _operationKey, ...trustedPatch } = patch || {};
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(current, trustedPatch, "order draft");

    const data = cleanOrderDraftPatch(trustedPatch || {});
    if (!Object.keys(data).length) {
      throw new BadRequestException("订单履约保存没有可更新字段");
    }

    const effectKey = `order-fulfillment:${operationKey}`;
    const requestOperation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "order-fulfillment-update",
        {
          orderDraftId: id,
          wechatAccountId: current.wechatAccountId || null,
          conversationId: current.conversationId || null,
          customerId: current.customerId || null,
          expectedWechatAccountId: trustedPatch.expectedWechatAccountId || null,
          expectedConversationId: trustedPatch.expectedConversationId || null,
          expectedCustomerId: trustedPatch.expectedCustomerId || null,
        },
        data,
      ),
    );

    const existing = await this.findReviewLogByEffectKey(effectKey);
    if (existing) {
      assertExactOperationReplay(readRequestOperationMetadata(existing.metadata), requestOperation, "order fulfillment");
      return this.getById(id, trustedPatch);
    }

    const updated = await this.updateOrderDraft(id, trustedPatch, {
      notificationEffectKey: `${effectKey}:notification`,
    });
    const reviewLog = await this.createReviewLog({
      targetType: "order",
      targetId: id,
      decision: "order_fulfillment_update",
      reviewer: data.owner || trustedPatch.owner || "system",
      note: orderFulfillmentReviewNote(data),
      beforeStatus: String(current.status || ""),
      afterStatus: String(updated.status || current.status || ""),
      metadata: {
        effectKey,
        requestOperation,
        source: "manual_order_fulfillment",
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId || null,
        changedFields: Object.keys(data),
        before: orderFulfillmentSnapshot(current),
        after: orderFulfillmentSnapshot(updated),
      },
    });
    assertExactOperationReplay(readRequestOperationMetadata(reviewLog.metadata), requestOperation, "order fulfillment");
    return updated;
  }

  async updateFromAutomation(
    id: string,
    patch: OrderDraftUpdatePatch & ExpectedIdentityPayload,
    options: { notificationEffectKey: string },
  ) {
    const notificationEffectKey = String(options?.notificationEffectKey || "").trim();
    if (!notificationEffectKey) throw new BadRequestException("automation order update requires a notification effect key");
    return this.updateOrderDraft(id, patch || {}, { notificationEffectKey });
  }

  async recordVerifiedPayment(
    id: string,
    patch: {
      paymentStatus: "deposit_paid" | "paid";
      customerNotes?: string;
      owner?: string;
    } & ExpectedIdentityPayload,
  ) {
    if (!patch || !["deposit_paid", "paid"].includes(String(patch.paymentStatus || ""))) {
      throw new BadRequestException("付款凭证核验只允许记录定金或全款。");
    }
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    const status = ["processing", "fulfilled"].includes(String(current.status || "")) ? current.status : "confirmed";
    return this.updateOrderDraft(id, { ...patch, status });
  }

  private async updateOrderDraft(
    id: string,
    patch: OrderDraftUpdatePatch & ExpectedIdentityPayload,
    options: { notificationEffectKey?: string } = {},
  ) {
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(current, patch, "order draft");

    const data = cleanOrderDraftPatch(patch || {});
    if (!Object.keys(data).length) {
      throw new BadRequestException("订单草稿没有可更新的字段，请至少修改状态、备注或跟进人。");
    }
    assertOrderStatusCommercialReady(current, data);
    assertOrderStatusPaymentReady(current, data);
    await this.assertOrderPaymentLedgerForExecution(current, data);
    assertOrderFulfillmentTransition(current, data);

    const quotePatch = quotePatchForOrderDraft(current, data);
    if (current.quoteDraftId && Object.keys(quotePatch).length) {
      const binding = validateOrderDraftQuoteBinding({
        orderDraft: current,
        quoteDraft: current.quoteDraft,
        designJob: current.designJob,
        conversation: current.conversation,
        selectedImage: current.selectedImage,
      });
      if (!binding.ok) {
        throw new BadRequestException(`订单草稿绑定校验失败：${orderBindingReasonLabel(binding.reason)}`);
      }
    }

    let updated: any;
    let cancelledSendTasks: any[] = [];
    if (appConfig.useLocalStore) {
      updated = this.localStore.updateOrderDraft(id, data);
      if (current.quoteDraftId && Object.keys(quotePatch).length) {
        await this.updateQuote(current.quoteDraftId, quotePatch);
      }
      const orderSendInvalidation = this.orderSendInvalidationForUpdate(data, { ...current, ...updated });
      cancelledSendTasks = orderSendInvalidation
        ? this.cancelPendingOrderSendTasksForInvalidatedOrder({ ...current, ...updated }, orderSendInvalidation)
        : [];
    } else {
      const result = await this.updatePrismaOrderAndQuoteWithSendInvalidation(id, data, patch);
      updated = result.updated;
      cancelledSendTasks = result.cancelledSendTasks;
    }

    await this.notifications.create(
      "info",
      "订单草稿已更新",
      `订单 ${id} 已更新为 ${updated.status} / ${orderDraftPaymentStatus({ ...current, ...updated }, data)}。`,
      {
        ...(options.notificationEffectKey ? { effectKey: options.notificationEffectKey } : {}),
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId,
        designJobId: current.designJobId,
        wechatAccountId: current.wechatAccountId,
        conversationId: current.conversationId,
        customerId: current.customerId,
        cancelledSendTaskIds: cancelledSendTasks.map((task: any) => task.id),
      },
    );

    return appConfig.useLocalStore ? this.localStore.getOrderDraft(id) : this.getOrderDraft(id);
  }

  async reviseSelectedImage(
    id: string,
    payload: {
      selectedImageId?: string;
      owner?: string;
      note?: string;
    } & ExpectedIdentityPayload = {},
  ) {
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(current, payload, "order draft");
    if (!["draft", "confirmed"].includes(current.status)) {
      throw new BadRequestException("订单已进入生产、完成或取消状态，不能再修改选中的效果图。");
    }
    const blocker = this.orderRevisionSendTaskBlocker(current);
    if (blocker) {
      throw new BadRequestException(
        `订单选图暂不能修改：${orderSendTaskLabel(blocker.label)} ${blocker.id} 正在${sendTaskStatusLabel(blocker.status)}。请先取消或处理这条发送任务。`,
      );
    }

    const selectedImage = await this.resolveOrderDesignImage(current, payload.selectedImageId);
    if (current.selectedImageId === selectedImage.id && current.status === "draft") return current;

    const note = payload.note || `客户重新选择第 ${selectedImage.position || ""} 张效果图，订单回到待确认。`;
    const orderPatch = {
      selectedImageId: selectedImage.id,
      selectedImageSnapshot: normalizeDesignImageSnapshot(selectedImage),
      status: "draft",
      owner: payload.owner || current.owner || "人工客服",
      customerNotes: note,
    };
    const quotePatch = {
      selectedImageId: selectedImage.id,
      customerNotes: note,
      owner: payload.owner || current.quoteDraft?.owner || current.owner || "人工客服",
    };

    const updated = appConfig.useLocalStore
      ? this.updateLocalOrderAndQuoteSelection(current, orderPatch, quotePatch, selectedImage, note)
      : await this.updatePrismaOrderAndQuoteSelection(id, current.quoteDraftId, current.designJobId, orderPatch, quotePatch, selectedImage, note);

    await this.createReviewLog({
      targetType: "order",
      targetId: id,
      decision: "manual_order_selection_revision",
      reviewer: payload.owner || "人工客服",
      note,
      beforeStatus: current.status || "",
      afterStatus: updated.status,
      metadata: {
        source: "manual_order_selection_revision",
        orderDraftId: id,
        quoteDraftId: current.quoteDraftId,
        designJobId: current.designJobId,
        previousSelectedImageId: current.selectedImageId || null,
        selectedImageId: selectedImage.id,
      },
    });

    await this.notifications.create(
      "warning",
      "订单选图已修订",
      `订单 ${id} 已改为第 ${selectedImage.position || ""} 张效果图，需重新确认后再发送。`,
      { orderDraftId: id, quoteDraftId: current.quoteDraftId, designJobId: current.designJobId },
    );

    return updated;
  }

  async scanLowValueAutoOrderDrafts(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    const [quotes, orders] = await Promise.all([this.listQuotes(filter), this.list(filter)]);
    const orderByQuoteId = new Map((orders as any[]).map((order) => [order.quoteDraftId, order]));
    const result = {
      scanned: quotes.length,
      created: [] as any[],
      skipped: [] as Array<{ quoteDraftId: string; designJobId?: string; reason: string; missing?: string[] }>,
      failed: [] as Array<{ quoteDraftId: string; designJobId?: string; errorMessage: string }>,
    };

    for (const quote of quotes as any[]) {
      const decision = evaluateLowValueOrderDraftFromQuote(quote, {
        highValueAmountCny: appConfig.highValueAmountCny,
        existingOrderDraft: orderByQuoteId.get(quote.id),
      });
      if (!decision.ok) {
        result.skipped.push({
          quoteDraftId: quote.id,
          designJobId: quote.designJobId,
          reason: decision.reason,
          missing: decision.missing || [],
        });
        continue;
      }

      try {
        const orderDraft = await this.createFromQuote(quote.id, this.expectedIdentityFromQuote(quote));
        result.created.push(orderDraft);
        orderByQuoteId.set(quote.id, orderDraft);
      } catch (error) {
        result.failed.push({
          quoteDraftId: quote.id,
          designJobId: quote.designJobId,
          errorMessage: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return result;
  }

  private async getQuote(quoteId: string) {
    if (appConfig.useLocalStore) return this.localStore.getQuoteDraft(quoteId);
    return (this.prisma as any).quoteDraft.findUnique({
      where: { id: quoteId },
      include: {
        customer: true,
        selectedImage: true,
        designJob: {
          include: {
            conversation: true,
            wechatAccount: true,
            images: true,
          },
        },
      },
      paymentEvents: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    });
  }

  private orderInclude() {
    return {
      customer: true,
      conversation: true,
      wechatAccount: true,
      designJob: {
        include: {
          conversation: true,
          wechatAccount: true,
          images: true,
        },
      },
      quoteDraft: {
        include: {
          selectedImage: true,
          customer: true,
          designJob: {
            include: {
              conversation: true,
              wechatAccount: true,
              images: true,
            },
          },
          paymentEvents: {
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      },
      paymentEvents: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      selectedImage: true,
    };
  }

  private async getOrderDraft(id: string) {
    if (appConfig.useLocalStore) return this.localStore.getOrderDraft(id);
    const order = await (this.prisma as any).orderDraft.findUnique({
      where: { id },
      include: this.orderInclude(),
    });
    return this.attachOrderSendTasks(order);
  }

  private buildOrderConfirmationMessage(order: any) {
    const context = this.buildOrderMessageContext(order);
    return buildOrderConfirmationCustomerMessage({
      customerName: context.customerName,
      scene: context.scene,
      quantity: order.quantity,
      totalPrice: order.totalPrice,
      paymentStatus: orderDraftPaymentStatus(order),
      items: context.items,
      hasSelectedImage: Boolean(context.selectedImage),
      selectedImagePosition: context.selectedImage?.position,
    });
  }

  private buildOrderFollowupMessage(order: any, type: "production" | "delivery") {
    const context = this.buildOrderMessageContext(order);
    return buildOrderFollowupCustomerMessage({
      type,
      customerName: context.customerName,
      scene: context.scene,
      quantity: order.quantity,
      totalPrice: order.totalPrice,
      paymentStatus: orderDraftPaymentStatus(order),
      leadTimeDays: maxLeadTimeDays(context.items),
      productionStatus: order.productionStatus,
      productionDueAt: order.productionDueAt,
      carrier: order.carrier,
      trackingNo: order.trackingNo,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      items: context.items,
    });
  }

  private buildOrderMessageContext(order: any) {
    const designJob = order.designJob || order.quoteDraft?.designJob || {};
    const bundleSnapshot = order.bundleSnapshot || {};
    const items = Array.isArray((bundleSnapshot as any).items)
      ? (bundleSnapshot as any).items
      : Array.isArray(designJob?.bundle?.items)
        ? designJob.bundle.items
        : [];
    return {
      customerName: order.customer?.name || order.quoteDraft?.customer?.name,
      scene: designJob?.scene,
      items,
      selectedImage: this.orderSelectedImage(order),
    };
  }

  private orderConfirmationPreviewWarnings(order: any) {
    const warnings = this.orderBasePreviewWarnings(order);
    if (order.confirmationSendTaskId || order.confirmationSendTask) warnings.push("订单确认消息已进入发送队列");
    return warnings;
  }

  private orderFollowupPreviewWarnings(order: any, type: "production" | "delivery") {
    const warnings = this.orderBasePreviewWarnings(order);
    const hasProductionFacts = Boolean(order.productionStatus || order.productionDueAt);
    const hasDeliveryFacts = Boolean(order.carrier || order.trackingNo || order.shippedAt || order.deliveredAt);
    if (type === "production" && !hasProductionFacts) {
      warnings.push("还没有生产状态或预计完成时间，文案会按谨慎的备货/排产跟进表达");
    }
    if (type === "delivery" && !hasDeliveryFacts) {
      warnings.push("还没有物流公司、单号或发货时间，文案不会假装已经发货");
    }
    if (type === "production" && (order.productionFollowupSendTaskId || order.productionFollowupSendTask)) {
      warnings.push("生产跟进消息已进入发送队列");
    }
    if (type === "delivery" && (order.deliveryFollowupSendTaskId || order.deliveryFollowupSendTask)) {
      warnings.push("发货跟进消息已进入发送队列");
    }
    return warnings;
  }

  private orderBasePreviewWarnings(order: any) {
    const warnings: string[] = [];
    if (order.status === "cancelled") warnings.push("订单已取消");
    if (!orderDraftSelectedImageId(order)) warnings.push("订单还没有选图");
    if (!order.wechatAccountId) warnings.push("订单缺少微信账号");
    if (!order.customerId) warnings.push("订单缺少客户绑定");
    if (!order.conversationId) warnings.push("订单缺少客户会话");
    if (Number(order.profit || 0) < 0) warnings.push("订单利润为负，需要人工确认");
    const designJob = order.designJob || order.quoteDraft?.designJob || null;
    if (order.quoteDraftId) {
      const binding = validateOrderDraftQuoteBinding({
        orderDraft: order,
        quoteDraft: order.quoteDraft,
        designJob,
        conversation: order.conversation || designJob?.conversation,
        selectedImage: this.orderSelectedImage(order),
      });
      if (!binding.ok) warnings.push(`订单绑定校验异常：${binding.reason}`);
    }
    return warnings;
  }

  private orderSelectedImage(order: any) {
    return order?.selectedImageSnapshot || order?.selectedImage || order?.quoteDraft?.selectedImage || null;
  }

  private assertCreatedOrderDraftBinding(orderDraft: any, quote: any) {
    const binding = validateOrderDraftQuoteBinding({
      orderDraft,
      quoteDraft: quote,
      designJob: orderDraft?.designJob || quote?.designJob,
      conversation: orderDraft?.conversation || quote?.designJob?.conversation,
      selectedImage: orderDraft?.selectedImage || quote?.selectedImage || orderDraft?.selectedImageSnapshot,
    });
    if (!binding.ok) {
      throw new BadRequestException(`订单草稿生成后绑定校验失败：${orderBindingReasonLabel(binding.reason)}`);
    }
  }

  private expectedIdentityFromQuote(quote: any): ExpectedIdentityPayload {
    return {
      expectedWechatAccountId: quote?.designJob?.wechatAccountId || quote?.wechatAccountId,
      expectedConversationId: quote?.designJob?.conversationId || quote?.conversationId,
      expectedCustomerId: quote?.customerId || quote?.designJob?.customerId,
    };
  }

  private orderRevisionSendTaskBlocker(order: any) {
    const tasks = [
      { label: "order confirmation", task: order.confirmationSendTask },
      { label: "order followup", task: order.followupSendTask },
      { label: "production followup", task: order.productionFollowupSendTask },
      { label: "delivery followup", task: order.deliveryFollowupSendTask },
      ...(Array.isArray(order.followupSendTasks)
        ? order.followupSendTasks.map((task: any) => ({ label: "order followup", task }))
        : []),
    ];
    const seen = new Set<string>();
    for (const item of tasks) {
      const task = item.task;
      if (!task?.id || seen.has(task.id)) continue;
      seen.add(task.id);
      if (!["failed", "cancelled", "dry_run"].includes(task.status)) {
        return { id: task.id, status: task.status, label: item.label };
      }
    }
    return null;
  }

  private orderSendInvalidationForUpdate(patch: OrderDraftUpdatePatch, order: any) {
    if (patch.status === "cancelled") {
      return {
        errorMessage: "order_cancelled_before_send",
        cancelReason: "order_cancelled_before_send",
        orderSendStateReason: "orderCancelledBeforeSend",
      };
    }
    if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) {
      const paymentStatus = orderDraftPaymentStatus(order, patch);
      if (!["deposit_paid", "paid"].includes(paymentStatus)) {
        return {
          errorMessage: "order_payment_not_ready_before_send",
          cancelReason: "order_payment_not_ready_before_send",
          orderSendStateReason: "orderPaymentNotReadyBeforeSend",
        };
      }
    }
    return null;
  }

  private cancelPendingOrderSendTasksForInvalidatedOrder(
    order: any,
    invalidation: { errorMessage: string; cancelReason: string; orderSendStateReason: string },
  ) {
    const now = new Date().toISOString();
    const tasks = this.localStore
      .listSendTasks({
        wechatAccountId: order.wechatAccountId,
        conversationId: order.conversationId,
        customerId: order.customerId,
      })
      .filter((task: any) => this.isPendingOrderSendTaskForOrder(task, order));

    return tasks.map((task: any) => {
      const guardSnapshot = task.guardSnapshot && typeof task.guardSnapshot === "object" ? task.guardSnapshot : {};
      const history = Array.isArray(guardSnapshot.history) ? guardSnapshot.history : [];
      return this.localStore.updateSendTask(
        task.id,
        {
          status: "cancelled",
          sentAt: null,
          errorMessage: invalidation.errorMessage,
          guardSnapshot: {
            ...guardSnapshot,
            status: "cancelled",
            cancelledAt: now,
            cancelReason: invalidation.cancelReason,
            orderSendState: {
              status: "blocked",
              reason: invalidation.orderSendStateReason,
              orderDraftId: order.id,
              checkedAt: now,
            },
            history: [
              ...history,
              {
                action: "cancel",
                fromStatus: task.status,
                reason: invalidation.cancelReason,
                at: now,
              },
            ],
          },
        },
        { skipBindingValidation: true },
      );
    });
  }

  private isPendingOrderSendTaskForOrder(task: any, order: any) {
    if (!["queued", "blocked", "failed"].includes(String(task?.status || ""))) return false;
    return this.isOrderConfirmationSendTask(task, order) || this.isOrderFollowupSendTask(task, order);
  }

  private async resolveOrderDesignImage(order: any, selectedImageId?: string) {
    const id = String(selectedImageId || "").trim();
    if (!id) throw new BadRequestException("请选择要改成哪一张候选图。");
    const designJob =
      order.designJob && Array.isArray(order.designJob.images) ? order.designJob : await this.getDesignJobWithImages(order.designJobId);
    const images = Array.isArray(designJob?.images) ? designJob.images : [];
    const selectedImage = images.find((image: any) => image.id === id || image.imageId === id);
    if (!selectedImage) throw new BadRequestException(`没有找到这张候选图：${id}。请确认输入的是当前订单所属设计任务里的候选图。`);
    if (selectedImage.designJobId && selectedImage.designJobId !== order.designJobId) {
      throw new BadRequestException("这张候选图不属于当前订单的设计任务，不能用于修订订单。");
    }
    return selectedImage;
  }

  private async getDesignJobWithImages(id: string) {
    if (appConfig.useLocalStore) return this.localStore.getDesignJob(id);
    return (this.prisma as any).designJob.findUnique({
      where: { id },
      include: {
        conversation: true,
        wechatAccount: true,
        images: true,
      },
    });
  }

  private updateLocalOrderAndQuoteSelection(current: any, orderPatch: any, quotePatch: any, selectedImage: any, feedback: string) {
    this.localStore.selectDesignImage(current.designJobId, selectedImage.id, feedback);
    if (current.quoteDraftId) this.localStore.updateQuoteDraft(current.quoteDraftId, quotePatch);
    return this.localStore.updateOrderDraft(current.id, orderPatch);
  }

  private async updatePrismaOrderAndQuoteSelection(
    id: string,
    quoteDraftId: string | null,
    designJobId: string,
    orderPatch: any,
    quotePatch: any,
    selectedImage: any,
    feedback: string,
  ) {
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      if (quoteDraftId) await tx.quoteDraft.update({ where: { id: quoteDraftId }, data: quotePatch });
      await tx.designImageCandidate.updateMany({
        where: { designJobId },
        data: { selected: false },
      });
      await tx.designImageCandidate.update({
        where: { id: selectedImage.id },
        data: { selected: true, customerFeedback: feedback },
      });
      return tx.orderDraft.update({
        where: { id },
        data: orderPatch,
        include: this.orderInclude(),
      });
    });
  }

  private async attachOrderSendTasks(input: any) {
    if (!input) return input;
    const orders = Array.isArray(input) ? input : [input];
    const quoteDraftIds = [...new Set(orders.map((order) => order.quoteDraftId).filter(Boolean))];
    if (!quoteDraftIds.length) return input;
    const tasks = await (this.prisma as any).wechatSendTask.findMany({
      where: { quoteDraftId: { in: quoteDraftIds } },
      orderBy: { createdAt: "desc" },
      take: Math.min(quoteDraftIds.length * 10, 500),
    });
    for (const order of orders) {
      order.paymentEvents = mergeOrderPaymentEvents(order);
      const confirmationSendTask = tasks.find((task: any) => this.isOrderConfirmationSendTask(task, order)) || null;
      const followupSendTasks = tasks.filter((task: any) => this.isOrderFollowupSendTask(task, order));
      const followupSendTask = followupSendTasks[0] || null;
      const productionFollowupSendTask =
        followupSendTasks.find((task: any) => this.orderFollowupType(task) === "production") || null;
      const deliveryFollowupSendTask =
        followupSendTasks.find((task: any) => this.orderFollowupType(task) === "delivery") || null;
      order.confirmationSendTaskId = confirmationSendTask?.id || null;
      order.confirmationSendTask = confirmationSendTask;
      order.followupSendTaskId = followupSendTask?.id || null;
      order.followupSendTask = followupSendTask;
      order.followupSendTasks = followupSendTasks;
      order.productionFollowupSendTaskId = productionFollowupSendTask?.id || null;
      order.productionFollowupSendTask = productionFollowupSendTask;
      order.deliveryFollowupSendTaskId = deliveryFollowupSendTask?.id || null;
      order.deliveryFollowupSendTask = deliveryFollowupSendTask;
    }
    return input;
  }

  private isOrderConfirmationSendTask(task: any, order: any) {
    const automation = task.guardSnapshot?.automation || {};
    const isConfirmation =
      automation.source === "order_confirmation" ||
      automation.source === "low_value_quote_acceptance" ||
      (automation.source === "manual_order_review" && !automation.followupType) ||
      task.guardSnapshot?.reason === "order-confirmation" ||
      task.guardSnapshot?.reason === "low_value_order_confirmation";
    if (automation.orderDraftId) return automation.orderDraftId === order.id && isConfirmation;
    if (task.quoteDraftId !== order.quoteDraftId) return false;
    return isConfirmation;
  }

  private isOrderFollowupSendTask(task: any, order: any) {
    const automation = task.guardSnapshot?.automation || {};
    if (automation.orderDraftId && automation.orderDraftId !== order.id) return false;
    if (!automation.orderDraftId && task.quoteDraftId !== order.quoteDraftId) return false;
    return (
      automation.source === "order_followup" ||
      (automation.source === "manual_order_review" && Boolean(automation.followupType)) ||
      task.guardSnapshot?.reason === "order-followup" ||
      task.guardSnapshot?.reason === "low_value_order_followup"
    );
  }

  private orderFollowupType(task: any) {
    const type = task?.guardSnapshot?.automation?.followupType || task?.payload?.followupType;
    return type === "production" || type === "delivery" ? type : "any";
  }

  private async updateQuote(id: string, patch: any) {
    if (appConfig.useLocalStore) return this.localStore.updateQuoteDraft(id, patch);
    return (this.prisma as any).quoteDraft.update({ where: { id }, data: patch });
  }

  private async assertQuotePaymentLedgerForOrderCreation(quote: any, orderDraft: any) {
    const paymentStatus = String(orderDraft?.paymentStatus || quote?.paymentStatus || "unpaid");
    if (paymentStatus === "unpaid") return;
    const paymentEvents = await this.listPaymentEventsForQuote(quote?.id);
    const verifiedAmount = sumVerifiedPaymentEvents(paymentEvents);
    if (verifiedAmount <= 0) {
      throw new BadRequestException("报价付款状态缺少已核验付款流水，不能生成已付款订单；请先从报价页核验付款凭证。");
    }
    if (paymentStatus !== "paid") return;
    const totalPrice = normalizePaymentAmount(orderDraft?.totalPrice ?? quote?.totalPrice);
    if (totalPrice === null || totalPrice <= 0) {
      throw new BadRequestException("报价总额无效，不能生成全款订单。");
    }
    if (verifiedAmount + 0.0001 >= totalPrice) return;
    throw new BadRequestException(`报价全款流水金额不足，订单总额 ${totalPrice} 元，已核验 ${verifiedAmount} 元。`);
  }

  private async assertOrderPaymentLedgerForExecution(current: any, patch: OrderDraftUpdatePatch) {
    const nextStatus = String(patch.status || current?.status || "");
    const nextProductionStatus = String(patch.productionStatus || current?.productionStatus || "not_started");
    const enteringExecution =
      ["processing", "fulfilled"].includes(nextStatus) ||
      ["in_production", "quality_check", "ready_to_ship", "shipped", "delivered"].includes(nextProductionStatus);
    if (!enteringExecution) return;

    const paymentStatus = orderDraftPaymentStatus(current, patch);
    if (!["deposit_paid", "paid"].includes(paymentStatus)) {
      throw new BadRequestException("订单进入生产或交付前必须先核验定金或全款付款凭证。");
    }
    const verifiedAmount = sumVerifiedPaymentEvents(await this.listPaymentEventsForQuote(current?.quoteDraftId));
    if (verifiedAmount <= 0) {
      throw new BadRequestException("订单进入生产或交付前缺少已核验付款流水，不能只依赖付款状态字段。");
    }

    const requiresFullPayment = nextStatus === "fulfilled" || nextProductionStatus === "delivered";
    if (!requiresFullPayment) return;
    if (paymentStatus !== "paid") {
      throw new BadRequestException("订单交付完成前必须核验全款付款凭证。");
    }
    const totalPrice = normalizePaymentAmount(current?.totalPrice ?? current?.quoteDraft?.totalPrice);
    if (totalPrice === null || totalPrice <= 0) {
      throw new BadRequestException("订单总额无效，不能完成交付。");
    }
    if (verifiedAmount + 0.0001 >= totalPrice) return;
    throw new BadRequestException(`订单全款流水金额不足，订单总额 ${totalPrice} 元，已核验 ${verifiedAmount} 元。`);
  }

  private async listPaymentEventsForQuote(quoteDraftId: string) {
    const quoteId = String(quoteDraftId || "").trim();
    if (!quoteId) return [];
    if (appConfig.useLocalStore) {
      if (typeof this.localStore.listPaymentEvents !== "function") return [];
      return this.localStore.listPaymentEvents({ quoteDraftId: quoteId });
    }
    const prisma = this.prisma as any;
    if (typeof prisma.paymentEvent?.findMany !== "function") return [];
    return prisma.paymentEvent.findMany({
      where: { quoteDraftId: quoteId },
      orderBy: { createdAt: "desc" },
    });
  }

  private async afterSalesPaymentSummary(order: any) {
    const events = await this.listPaymentEventsForQuote(order?.quoteDraftId);
    const paidAmountCny = sumVerifiedPaymentEvents(events);
    const refundedAmountCny = sumRefundedPaymentEvents(events);
    return {
      paidAmountCny,
      refundedAmountCny,
      refundableAmountCny: Math.max(0, Math.round((paidAmountCny - refundedAmountCny) * 100) / 100),
    };
  }

  private async recordAfterSalesRefundEvent(order: any, payload: {
    amountCny: number;
    idempotencyKey: string;
    method: string;
    proofReference: string;
    reviewer: string;
    note: string;
  }) {
    const eventPayload = {
      quoteDraftId: order.quoteDraftId,
      orderDraftId: order.id,
      customerId: order.customerId,
      conversationId: order.conversationId,
      wechatAccountId: order.wechatAccountId,
      paymentStatus: "refunded",
      amountCny: payload.amountCny,
      method: payload.method,
      proofReference: payload.proofReference,
      reviewer: payload.reviewer,
      note: payload.note,
      source: "manual_after_sales_refund",
      idempotencyKey: payload.idempotencyKey,
    };
    if (appConfig.useLocalStore) return this.localStore.recordPaymentEvent(eventPayload);

    const prisma = this.prisma as any;
    if (typeof prisma.paymentEvent?.findUnique === "function") {
      const existing = await prisma.paymentEvent.findUnique({ where: { idempotencyKey: payload.idempotencyKey } });
      if (existing) return existing;
    }
    try {
      return await prisma.paymentEvent.create({ data: eventPayload });
    } catch (error) {
      if (!isUniqueConstraintError(error) || typeof prisma.paymentEvent?.findUnique !== "function") throw error;
      const winner = await prisma.paymentEvent.findUnique({ where: { idempotencyKey: payload.idempotencyKey } });
      if (!winner) throw error;
      return winner;
    }
  }

  private async updatePrismaOrderAndQuoteWithSendInvalidation(
    id: string,
    data: OrderDraftUpdatePatch,
    expected: ExpectedIdentityPayload,
  ) {
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const transactionCurrent = await tx.orderDraft.findUnique({
        where: { id },
        include: this.orderInclude(),
      });
      if (!transactionCurrent) throw new BadRequestException(`没有找到订单草稿：${id}`);
      assertExpectedIdentity(transactionCurrent, expected, "order draft");
      assertOrderStatusCommercialReady(transactionCurrent, data);
      assertOrderStatusPaymentReady(transactionCurrent, data);
      await this.assertOrderPaymentLedgerForExecution(transactionCurrent, data);
      assertOrderFulfillmentTransition(transactionCurrent, data);

      const quotePatch = quotePatchForOrderDraft(transactionCurrent, data);
      if (transactionCurrent.quoteDraftId && Object.keys(quotePatch).length) {
        const binding = validateOrderDraftQuoteBinding({
          orderDraft: transactionCurrent,
          quoteDraft: transactionCurrent.quoteDraft,
          designJob: transactionCurrent.designJob,
          conversation: transactionCurrent.conversation,
          selectedImage: transactionCurrent.selectedImage,
        });
        if (!binding.ok) {
          throw new BadRequestException(`订单草稿绑定校验失败：${orderBindingReasonLabel(binding.reason)}`);
        }
      }

      const updated = await tx.orderDraft.update({
        where: { id },
        data,
        include: this.orderInclude(),
      });
      if (transactionCurrent.quoteDraftId && Object.keys(quotePatch).length) {
        await tx.quoteDraft.update({ where: { id: transactionCurrent.quoteDraftId }, data: quotePatch });
      }

      const mergedOrder = { ...transactionCurrent, ...updated };
      const invalidation = this.orderSendInvalidationForUpdate(data, mergedOrder);
      const cancelledSendTasks = invalidation
        ? await this.cancelPendingPrismaOrderSendTasks(tx, mergedOrder, invalidation)
        : [];
      const invalidationStateChanged = Boolean(
        (data.status === "cancelled" && transactionCurrent.status !== updated.status) ||
          (Object.prototype.hasOwnProperty.call(data, "paymentStatus") &&
            orderDraftPaymentStatus(transactionCurrent) !== orderDraftPaymentStatus(updated)),
      );
      if (invalidation && (invalidationStateChanged || cancelledSendTasks.length > 0)) {
        await tx.reviewLog.create({
          data: {
            targetType: "order",
            targetId: id,
            decision: "invalidate_pending_order_send_tasks",
            reviewer: "system_order_invalidation",
            note: `order_send_invalidation:${invalidation.cancelReason};cancelled_count:${cancelledSendTasks.length}`,
            beforeStatus: String(transactionCurrent.status || ""),
            afterStatus: String(updated.status || transactionCurrent.status || ""),
            metadata: {
              source: "prisma_order_update_transaction",
              orderDraftId: id,
              quoteDraftId: transactionCurrent.quoteDraftId || null,
              invalidationReason: invalidation.cancelReason,
              orderSendStateReason: invalidation.orderSendStateReason,
              eligibleStatuses: ["queued", "blocked", "failed"],
              cancelledSendTaskIds: cancelledSendTasks.map((task: any) => task.id),
            },
          },
        });
      }
      return { updated, cancelledSendTasks };
    });
  }

  private async cancelPendingPrismaOrderSendTasks(
    tx: any,
    order: any,
    invalidation: { errorMessage: string; cancelReason: string; orderSendStateReason: string },
  ) {
    if (!order.quoteDraftId || !order.wechatAccountId || !order.conversationId) return [];
    const candidates = await tx.wechatSendTask.findMany({
      where: {
        quoteDraftId: order.quoteDraftId,
        wechatAccountId: order.wechatAccountId,
        conversationId: order.conversationId,
        status: { in: ["queued", "blocked", "failed"] },
      },
      orderBy: { createdAt: "asc" },
    });
    const now = new Date().toISOString();
    const cancelled: any[] = [];
    for (const task of candidates.filter((item: any) => this.isPendingOrderSendTaskForOrder(item, order))) {
      const guardSnapshot = task.guardSnapshot && typeof task.guardSnapshot === "object" ? task.guardSnapshot : {};
      const history = Array.isArray(guardSnapshot.history) ? guardSnapshot.history : [];
      const taskPatch = {
        status: "cancelled",
        sentAt: null,
        errorMessage: invalidation.errorMessage,
        guardSnapshot: {
          ...guardSnapshot,
          status: "cancelled",
          cancelledAt: now,
          cancelReason: invalidation.cancelReason,
          orderSendState: {
            status: "blocked",
            reason: invalidation.orderSendStateReason,
            orderDraftId: order.id,
            checkedAt: now,
          },
          history: [
            ...history,
            {
              action: "cancel",
              fromStatus: task.status,
              reason: invalidation.cancelReason,
              at: now,
            },
          ],
        },
      };
      const claimed = await tx.wechatSendTask.updateMany({
        where: {
          id: task.id,
          quoteDraftId: order.quoteDraftId,
          wechatAccountId: order.wechatAccountId,
          conversationId: order.conversationId,
          status: task.status,
        },
        data: taskPatch,
      });
      if (claimed.count === 1) cancelled.push({ ...task, ...taskPatch });
    }
    return cancelled;
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

  private async findReviewLogByEffectKey(effectKey: string) {
    const id = deterministicOperationId("review", effectKey);
    if (appConfig.useLocalStore) return this.localStore.getReviewLog(id);
    const prisma = this.prisma as any;
    if (typeof prisma.reviewLog.findUnique !== "function") return null;
    return prisma.reviewLog.findUnique({ where: { id } });
  }

  private async listAfterSalesReviewLogs(orderDraftId: string) {
    if (appConfig.useLocalStore) {
      return this.localStore
        .listReviewLogs({ limit: 300 })
        .filter((log: any) => log.targetType === "order_draft")
        .filter((log: any) => log.targetId === orderDraftId)
        .filter((log: any) => [AFTER_SALES_CREATE_DECISION, AFTER_SALES_RESOLVE_DECISION].includes(log.decision));
    }
    const prisma = this.prisma as any;
    if (typeof prisma.reviewLog?.findMany !== "function") return [];
    return prisma.reviewLog.findMany({
      where: {
        targetType: "order_draft",
        targetId: orderDraftId,
        decision: { in: [AFTER_SALES_CREATE_DECISION, AFTER_SALES_RESOLVE_DECISION] },
      },
      orderBy: { createdAt: "asc" },
      take: 300,
    });
  }

  private async listQuotes(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) return this.localStore.listQuoteDrafts(filter);
    return (this.prisma as any).quoteDraft.findMany({
      where: {
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.wechatAccountId || filter.conversationId
          ? {
              designJob: {
                ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
                ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
              },
            }
          : {}),
      },
      include: {
        customer: true,
        selectedImage: true,
        designJob: {
          include: {
            conversation: true,
            wechatAccount: true,
            images: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
  }

  private async upsertPrismaOrderDraft(quoteId: string, draft: any) {
    const data = {
      designJobId: draft.designJobId,
      customerId: draft.customerId,
      conversationId: draft.conversationId,
      wechatAccountId: draft.wechatAccountId,
      selectedImageId: draft.selectedImageId,
      quantity: draft.quantity,
      unitPrice: draft.unitPrice,
      totalPrice: draft.totalPrice,
      totalCost: draft.totalCost,
      profit: draft.profit,
      status: draft.status,
      paymentStatus: draft.paymentStatus,
      productionStatus: draft.productionStatus || "not_started",
      productionDueAt: draft.productionDueAt || "",
      carrier: draft.carrier || "",
      trackingNo: draft.trackingNo || "",
      shippedAt: draft.shippedAt || "",
      deliveredAt: draft.deliveredAt || "",
      customerNotes: draft.customerNotes || "",
      owner: draft.owner || "",
      bundleSnapshot: draft.bundleSnapshot || {},
      selectedImageSnapshot: draft.selectedImageSnapshot || {},
    };
    return (this.prisma as any).orderDraft.upsert({
      where: { quoteDraftId: quoteId },
      create: {
        quoteDraftId: quoteId,
        ...data,
      },
      update: data,
      include: this.orderInclude(),
    });
  }
}

function orderSendTaskLabel(label: string) {
  const labels: Record<string, string> = {
    "order confirmation": "订单确认发送任务",
    "order followup": "订单跟进发送任务",
    "production followup": "生产进度发送任务",
    "delivery followup": "发货跟进发送任务",
  };
  return labels[label] || "订单发送任务";
}

function mergeOrderPaymentEvents(order: any) {
  const byId = new Map<string, any>();
  for (const event of [
    ...(Array.isArray(order?.paymentEvents) ? order.paymentEvents : []),
    ...(Array.isArray(order?.quoteDraft?.paymentEvents) ? order.quoteDraft.paymentEvents : []),
  ]) {
    const key = String(event?.id || event?.idempotencyKey || "");
    if (!key || byId.has(key)) continue;
    byId.set(key, event);
  }
  return [...byId.values()].sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
}

function sumVerifiedPaymentEvents(events: any[]) {
  return Math.round(
    events
      .filter((event) => ["deposit_paid", "paid"].includes(String(event?.paymentStatus || "")))
      .reduce((sum, event) => sum + (normalizePaymentAmount(event?.amountCny) || 0), 0) * 100,
  ) / 100;
}

function sumRefundedPaymentEvents(events: any[]) {
  return Math.round(
    events
      .filter((event) => String(event?.paymentStatus || "") === "refunded")
      .reduce((sum, event) => sum + (normalizePaymentAmount(event?.amountCny) || 0), 0) * 100,
  ) / 100;
}

function normalizePaymentAmount(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

function normalizeAfterSalesAmount(value: unknown) {
  const amount = normalizePaymentAmount(value);
  if (amount === null) return null;
  if (amount < 0) throw new BadRequestException("售后金额必须是非负数字。");
  return amount;
}

function cleanAfterSalesText(value: unknown, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeAfterSalesType(value: unknown) {
  const type = cleanAfterSalesText(value, 40) || "other";
  if (["refund", "replacement", "return", "compensation", "other"].includes(type)) return type;
  throw new BadRequestException("售后类型只能是 refund、replacement、return、compensation 或 other。");
}

function normalizeAfterSalesResolutionType(value: unknown) {
  const type = cleanAfterSalesText(value, 40) || "manual_resolution";
  if (["refund", "replacement", "reject", "compensation", "customer_cancelled", "manual_resolution"].includes(type)) return type;
  throw new BadRequestException("售后处理类型不正确。");
}

function afterSalesStatusForResolution(type: string) {
  if (type === "reject") return "rejected";
  if (type === "customer_cancelled") return "cancelled";
  return "resolved";
}

function afterSalesTypeLabel(type: string) {
  const labels: Record<string, string> = {
    refund: "退款",
    replacement: "补发",
    return: "退货",
    compensation: "补偿",
    other: "其他",
  };
  return labels[type] || type;
}

function afterSalesResolutionLabel(type: string) {
  const labels: Record<string, string> = {
    refund: "已退款",
    replacement: "已补发",
    reject: "已拒绝",
    compensation: "已补偿",
    customer_cancelled: "客户取消",
    manual_resolution: "人工处理",
  };
  return labels[type] || type;
}

function afterSalesOperationIdentity(id: string, order: any, expected: ExpectedIdentityPayload) {
  return {
    orderDraftId: id,
    quoteDraftId: order?.quoteDraftId || null,
    wechatAccountId: order?.wechatAccountId || null,
    conversationId: order?.conversationId || null,
    customerId: order?.customerId || null,
    expectedWechatAccountId: expected?.expectedWechatAccountId || null,
    expectedConversationId: expected?.expectedConversationId || null,
    expectedCustomerId: expected?.expectedCustomerId || null,
  };
}

function buildAfterSalesCasesFromLogs(logs: any[], order: any) {
  const createLogs = logs.filter((log) => log.decision === AFTER_SALES_CREATE_DECISION);
  const resolutionByCaseId = new Map<string, any>();
  for (const log of logs.filter((item) => item.decision === AFTER_SALES_RESOLVE_DECISION)) {
    const caseId = String(log?.metadata?.caseId || "");
    if (!caseId) continue;
    const previous = resolutionByCaseId.get(caseId);
    if (!previous || String(log.createdAt || "").localeCompare(String(previous.createdAt || "")) > 0) {
      resolutionByCaseId.set(caseId, log);
    }
  }
  return createLogs
    .map((log) => buildAfterSalesCaseFromCreateLog(log, order, resolutionByCaseId.get(String(log?.metadata?.caseId || ""))))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function buildAfterSalesCaseFromCreateLog(createLog: any, order: any, resolutionLog?: any) {
  const metadata = createLog?.metadata && typeof createLog.metadata === "object" ? createLog.metadata : {};
  const resolutionMetadata =
    resolutionLog?.metadata && typeof resolutionLog.metadata === "object" ? resolutionLog.metadata : null;
  const type = String(metadata.type || "other");
  const resolutionType = resolutionMetadata ? String(resolutionMetadata.resolutionType || "manual_resolution") : "";
  return {
    id: String(metadata.caseId || createLog.id),
    orderDraftId: String(metadata.orderDraftId || order?.id || createLog.targetId || ""),
    quoteDraftId: metadata.quoteDraftId || order?.quoteDraftId || null,
    designJobId: metadata.designJobId || order?.designJobId || null,
    status: resolutionMetadata?.status || metadata.status || "open",
    type,
    typeLabel: afterSalesTypeLabel(type),
    reason: metadata.reason || "",
    requestedAmountCny: metadata.requestedAmountCny ?? null,
    evidenceReference: metadata.evidenceReference || "",
    desiredResolution: metadata.desiredResolution || "",
    paymentSummary: resolutionMetadata?.paymentSummary || metadata.paymentSummary || null,
    createdBy: createLog.reviewer || "",
    createdAt: toAfterSalesDateString(createLog.createdAt),
    updatedAt: toAfterSalesDateString(resolutionLog?.createdAt || createLog.createdAt),
    resolution: resolutionMetadata
      ? {
          type: resolutionType,
          typeLabel: afterSalesResolutionLabel(resolutionType),
          approvedAmountCny: resolutionMetadata.approvedAmountCny ?? null,
          refundMethod: resolutionMetadata.refundMethod || "",
          refundReference: resolutionMetadata.refundReference || "",
          replacementCarrier: resolutionMetadata.replacementCarrier || "",
          replacementTrackingNo: resolutionMetadata.replacementTrackingNo || "",
          note: resolutionMetadata.note || "",
          paymentEventId: resolutionMetadata.paymentEventId || null,
          resolvedBy: resolutionLog.reviewer || "",
          resolvedAt: toAfterSalesDateString(resolutionLog.createdAt),
        }
      : null,
  };
}

function toAfterSalesDateString(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function sendTaskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "排队中",
    sending: "发送中",
    blocked: "被拦截待处理",
    pending_ack: "等待发送回执",
    sent: "已发送",
  };
  return labels[status] || status || "处理中";
}

function orderDraftDecisionReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    quote_not_found: "报价不存在",
    quote_not_sent_or_accepted: "报价还没有发送或客户还没有确认",
    high_value_requires_manual: "高价值客户需要人工确认后再生成订单",
    missing_required_fields: "订单关键信息还不完整",
    invalid_quote_binding: "报价和客户会话绑定异常",
    quote_profit_negative: "报价利润为负，需要人工确认",
    existing_order_draft: "这个报价已经生成过订单草稿",
    no_selected_image: "报价还没有选定效果图",
    missing_order_fields: "订单关键信息还不完整",
    negative_profit: "报价利润为负，需要人工确认",
    selected_image_not_found: "没有找到报价选中的效果图",
    selected_image_design_job_mismatch: "选中的效果图不属于当前设计任务",
  };
  return labels[reason] || reason || "订单条件还不完整";
}

function orderDraftMissingLabel(field: string) {
  const labels: Record<string, string> = {
    selectedImageId: "客户选中的效果图",
    wechatAccountId: "微信账号",
    conversationId: "客户会话",
    customerId: "客户信息",
    designJobId: "设计任务",
    quantity: "数量",
    unitPrice: "单价",
    totalPrice: "总价",
    totalCost: "总成本",
    profit: "利润",
    bundleSnapshot: "礼盒组合",
    quoteDraftId: "报价草稿",
    designJobIdentity: "设计任务绑定",
    customerIdentity: "客户绑定",
    conversationCustomerIdentity: "会话客户绑定",
    conversationWechatIdentity: "会话微信账号绑定",
    selectedImage: "选中的效果图",
  };
  return labels[field] || field;
}

function orderBindingReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    missing_order_draft: "缺少订单草稿",
    missing_quote_draft: "缺少报价草稿",
    missing_design_job: "缺少设计任务",
    missing_conversation: "缺少客户会话",
    missing_selected_image: "缺少选中的效果图",
    quote_draft_mismatch: "订单绑定的报价不一致",
    design_job_mismatch: "订单、报价和设计任务不一致",
    customer_mismatch: "客户信息不一致",
    wechat_account_mismatch: "微信账号不一致",
    conversation_mismatch: "客户会话不一致",
    selected_image_mismatch: "选中的效果图不一致",
    selected_image_design_job_mismatch: "效果图不属于当前设计任务",
  };
  return labels[reason] || reason || "绑定关系不一致";
}

function assertOrderStatusPaymentReady(current: any, patch: OrderDraftUpdatePatch) {
  const nextStatus = patch.status || current?.status || "";
  if (!["processing", "fulfilled"].includes(nextStatus)) return;
  const nextPaymentStatus = orderDraftPaymentStatus(current, patch);
  if (["deposit_paid", "paid"].includes(nextPaymentStatus)) return;
  const actionLabel = nextStatus === "processing" ? "生产中" : "完成";
  throw new BadRequestException(`订单未记录定金或全款，不能标记为${actionLabel}；请先人工核验付款凭证。`);
}

function orderDraftPaymentStatus(order: any, patch: OrderDraftUpdatePatch = {}) {
  return patch.paymentStatus || order?.paymentStatus || order?.quoteDraft?.paymentStatus || "unpaid";
}

function orderDraftSelectedImageId(order: any) {
  return order?.selectedImageId || order?.quoteDraft?.selectedImageId || "";
}

function orderFulfillmentSnapshot(order: any) {
  return {
    status: order?.status || "",
    paymentStatus: orderDraftPaymentStatus(order),
    productionStatus: order?.productionStatus || "",
    productionDueAt: order?.productionDueAt || "",
    carrier: order?.carrier || "",
    trackingNo: order?.trackingNo || "",
    shippedAt: order?.shippedAt || "",
    deliveredAt: order?.deliveredAt || "",
    customerNotes: order?.customerNotes || "",
    owner: order?.owner || "",
  };
}

function orderFulfillmentReviewNote(data: Record<string, unknown>) {
  const fields = Object.keys(data).filter((field) => field !== "owner");
  return fields.length ? `order_fulfillment_update:${fields.join(",")}` : "order_fulfillment_update";
}

function maxLeadTimeDays(items: any[] = []) {
  return items.reduce((max, item) => {
    const value = Number(item?.leadTimeDays || item?.leadTime || item?.deliveryDays || 0);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
}

function assertOrderStatusCommercialReady(current: any, patch: OrderDraftUpdatePatch) {
  const nextStatus = patch.status || current?.status || "";
  if (!["processing", "fulfilled"].includes(nextStatus)) return;
  const actionLabel = nextStatus === "processing" ? "生产中" : "完成";
  const selectedImageId = orderDraftSelectedImageId(current);
  if (!selectedImageId) {
    throw new BadRequestException(`订单未绑定客户选中的效果图，不能标记为${actionLabel}。`);
  }
  if (!current?.wechatAccountId || !current?.customerId || !current?.conversationId) {
    throw new BadRequestException(`订单缺少微信账号、客户或会话绑定，不能标记为${actionLabel}。`);
  }
  if (Number(current?.profit || 0) < 0) {
    throw new BadRequestException(`订单利润为负，不能标记为${actionLabel}；请先人工确认报价和成本。`);
  }
}

function assertOrderFulfillmentTransition(current: any, patch: OrderDraftUpdatePatch) {
  const decision = evaluateOrderFulfillmentTransition(current, patch);
  if (decision.ok) return;
  const reason = String(decision.reason || "");
  const missing = Array.isArray(decision.missing) && decision.missing.length
    ? `，缺少：${decision.missing.map(orderFulfillmentMissingLabel).join("、")}`
    : "";
  const invalid = Array.isArray(decision.invalid) && decision.invalid.length
    ? `，请检查：${decision.invalid.map(orderFulfillmentMissingLabel).join("、")}`
    : "";
  if (reason === "order_status_regression") {
    throw new BadRequestException(`订单状态不能从 ${decision.currentStatus} 跳转到 ${decision.nextStatus}。`);
  }
  if (reason === "production_status_regression") {
    throw new BadRequestException(
      `生产状态不能从 ${decision.currentProductionStatus} 跳转到 ${decision.nextProductionStatus}。`,
    );
  }
  if (reason === "fulfilled_requires_full_payment") {
    throw new BadRequestException(`订单完成前必须记录全款已付${missing}。`);
  }
  if (reason === "shipment_facts_missing") {
    throw new BadRequestException(`订单发货前必须记录物流事实${missing}。`);
  }
  if (reason === "shipment_facts_invalid") {
    throw new BadRequestException(`订单发货物流信息格式不正确${invalid}。物流单号请填写真实承运方单号；自提可不填物流单号。`);
  }
  if (reason === "delivery_fact_missing") {
    throw new BadRequestException(`订单签收前必须记录交付事实${missing}。`);
  }
  if (reason === "delivery_fact_invalid") {
    throw new BadRequestException(`订单签收时间格式不正确${invalid}。`);
  }
  if (reason === "delivery_before_shipment") {
    throw new BadRequestException("订单签收时间不能早于发货时间。");
  }
  if (reason === "fulfilled_requires_delivery") {
    throw new BadRequestException(`订单完成前必须记录已签收履约事实${missing}。`);
  }
  if (reason === "delivery_package_missing") {
    throw new BadRequestException(`订单完成前必须保留可交付资料包${missing}；请先确认客户选图和商品组合快照。`);
  }
  throw new BadRequestException(`订单履约状态不合法：${reason || "unknown"}`);
}

function orderFulfillmentMissingLabel(field: string) {
  const labels: Record<string, string> = {
    paymentStatus: "全款付款状态",
    productionStatus: "生产状态",
    carrier: "物流公司",
    trackingNo: "物流单号",
    shippedAt: "发货时间",
    deliveredAt: "签收/交付时间",
    selectedImageId: "客户确认效果图",
    selectedImageSnapshot: "客户确认效果图快照",
    bundleSnapshot: "商品组合交付包",
  };
  return labels[field] || field;
}

type OrderDraftUpdatePatch = {
  status?: string;
  paymentStatus?: string;
  productionStatus?: string;
  productionDueAt?: string;
  carrier?: string;
  trackingNo?: string;
  shippedAt?: string;
  deliveredAt?: string;
  customerNotes?: string;
  owner?: string;
};

type OrderFulfillmentUpdatePatch = OrderDraftUpdatePatch & {
  operationKey?: string;
};

type AfterSalesCreatePatch = {
  operationKey?: string;
  type?: string;
  reason?: string;
  requestedAmountCny?: number | string;
  evidenceReference?: string;
  desiredResolution?: string;
  owner?: string;
};

type AfterSalesResolvePatch = {
  operationKey?: string;
  resolutionType?: string;
  approvedAmountCny?: number | string;
  refundMethod?: string;
  refundReference?: string;
  replacementCarrier?: string;
  replacementTrackingNo?: string;
  note?: string;
  owner?: string;
};

function assertGenericOrderUpdatePatch(patch: OrderDraftUpdatePatch) {
  if (Object.prototype.hasOwnProperty.call(patch, "notificationEffectKey")) {
    throw new BadRequestException("notificationEffectKey is reserved for trusted automation");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) {
    throw new BadRequestException("订单付款状态只能通过报价付款凭证核验入口更新。");
  }
  if (patch.status !== undefined && !["draft", "processing", "fulfilled", "cancelled"].includes(String(patch.status))) {
    throw new BadRequestException("通用订单更新不允许直接确认订单；请先核验报价付款凭证。");
  }
}
