import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";
import { rules } from "../shared/rules";
import { OrdersService } from "../orders/orders.service";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

const {
  buildQuoteCustomerMessage,
  calculateTotals,
  evaluateLowValueQuoteSend,
  inspectBundleAutomationReadiness,
  isHighValueBudget,
  latestCandidateRound,
  quoteNeedsPaymentProofReview,
  validateQuoteDraftIdentity,
} = rules;

type QuoteQueueRequest = {
  owner?: string;
  note?: string;
  releaseManualLock?: boolean;
  releaseReason?: string;
} & ExpectedIdentityPayload;

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly orders: OrdersService,
    private readonly wechatDispatch: WechatDispatchService,
  ) {}

  async createFromDesignJob(designJobId: string, selectedImageId?: string) {
    const existing = await this.findExistingForDesignJob(designJobId);
    if (existing) {
      return this.syncExistingQuoteSelection(existing, selectedImageId);
    }

    if (appConfig.useLocalStore) {
      return this.localStore.createQuoteFromDesignJob(designJobId, selectedImageId, {
        highValueAmountCny: appConfig.highValueAmountCny,
      });
    }
    const job = await this.prisma.designJob.findUnique({
      where: { id: designJobId },
      include: { images: true, conversation: true },
    });
    if (!job) throw new Error(`design job not found: ${designJobId}`);

    const bundle = job.bundle as { items?: Array<Record<string, unknown>> };
    const totals = calculateTotals(bundle.items || []);
    const budget = job.budget as { quantity?: number | null };
    const quantity = Number(budget.quantity || 1);
    const latestImages = latestCandidateRound(job.images || []);
    const selectedImage = selectedImageId
      ? job.images.find((item) => item.id === selectedImageId || item.imageId === selectedImageId)
      : latestImages.find((item: any) => item.selected) || null;

    const totalPrice = Number(totals.salePrice) * quantity;
    const totalCost = Number(totals.cost) * quantity;
    const bundleAutomation = inspectBundleAutomationReadiness(job.bundle || {});
    const highValueQuote =
      job.isHighValue ||
      isHighValueBudget(job.budget, appConfig.highValueAmountCny) ||
      (Number.isFinite(totalPrice) && totalPrice >= appConfig.highValueAmountCny) ||
      (Number.isFinite(Number(totals.salePrice)) && Number(totals.salePrice) >= appConfig.highValueAmountCny);
    const isAutoQuote = !highValueQuote && bundleAutomation.ok;
    const identity = validateQuoteDraftIdentity({
      quoteDraft: {
        designJobId: job.id,
        customerId: job.customerId,
        selectedImageId: selectedImage?.id,
      },
      designJob: job,
      conversation: job.conversation,
      selectedImage,
    });
    if (!identity.ok) throw new BadRequestException(`quote draft identity invalid: ${identity.reason}`);

    return this.prisma.quoteDraft.create({
      data: {
        designJobId: job.id,
        customerId: job.customerId,
        selectedImageId: selectedImage?.id,
        quantity,
        unitPrice: totals.salePrice,
        totalPrice,
        totalCost,
        profit: totalPrice - totalCost,
        status: isAutoQuote ? "auto_sent" : "manual_review",
        paymentStatus: "unpaid",
      },
    });
  }

  async list(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) return this.localStore.listQuoteDrafts(filter);
    return this.prisma.quoteDraft.findMany({
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
        designJob: true,
        selectedImage: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
  }

  async update(id: string, patch: QuoteUpdatePatch & ExpectedIdentityPayload) {
    assertGenericQuoteUpdatePatch(patch || {});
    return this.updateQuoteDraft(id, patch || {}, false);
  }

  private async updateQuoteDraft(
    id: string,
    patch: QuoteUpdatePatch & ExpectedIdentityPayload,
    allowVerifiedPayment: boolean,
  ) {
    const current = await this.getQuoteForSend(id);
    if (!current) throw new Error(`quote draft not found: ${id}`);
    this.ensureQuoteIdentity(current);
    assertExpectedIdentity(current, patch, "quote draft");
    const data = cleanQuotePatch(patch, current, allowVerifiedPayment);
    const shouldClearLinkedSendTask =
      this.quoteUpdateInvalidatesPendingSendTask(data) && this.quoteLinkedSendTaskCanBeCleared(current);
    const cancelledSendTask = shouldClearLinkedSendTask
      ? await this.cancelLinkedQuoteSendTaskForRevision(current, {
          ...patch,
          note: patch.customerNotes || `报价状态已改为 ${data.status}，取消旧发送任务。`,
        })
      : null;
    if (shouldClearLinkedSendTask) {
      data.sendTaskId = null;
      const staleSendTaskNote = cancelledSendTask
        ? `原报价发送任务 ${cancelledSendTask.id} 已取消。`
        : current.sendTask?.status === "cancelled"
          ? `原报价发送任务 ${current.sendTaskId} 已经取消，已解除旧发送绑定。`
          : "";
      if (staleSendTaskNote) {
        data.customerNotes = appendCustomerNote(data.customerNotes || current.customerNotes, staleSendTaskNote);
      }
    }
    const updated = appConfig.useLocalStore
      ? this.localStore.updateQuoteDraft(id, data)
      : await this.prisma.quoteDraft.update({
          where: { id },
          data: data as any,
          include: {
            customer: true,
            designJob: true,
            selectedImage: true,
          },
        });
    if (data.status === "manual_review") {
      await this.lockQuoteConversationForManualReview(current, patch.owner || current.owner);
    }
    return updated;
  }

  async reviseSelectedImage(
    id: string,
    payload: {
      selectedImageId?: string;
      owner?: string;
      note?: string;
    } & ExpectedIdentityPayload = {},
  ) {
    const current = await this.getQuoteForSend(id);
    if (!current) throw new Error(`quote draft not found: ${id}`);
    this.ensureQuoteIdentity(current);
    assertExpectedIdentity(current, payload, "quote draft");
    if (current.status === "accepted") {
      throw new BadRequestException("accepted quote cannot be revised; create a new order or quote instead");
    }
    const existingOrder = await this.findOrderDraftForQuote(id);
    if (existingOrder) {
      throw new BadRequestException("quote already has an order draft; revise the order or create a new quote instead");
    }
    const selectedImage = this.resolveQuoteDesignImage(current, payload.selectedImageId);
    if (current.selectedImageId === selectedImage.id && current.status === "manual_review") return current;

    const cancelledSendTask = await this.cancelLinkedQuoteSendTaskForRevision(current, payload);
    const noteParts = [
      payload.note || "客户重新选择效果图，报价已回到人工审核。",
      cancelledSendTask ? `原发送任务 ${cancelledSendTask.id} 已取消。` : "",
    ].filter(Boolean);
    const patch = {
      selectedImageId: selectedImage.id,
      status: "manual_review",
      sendTaskId: null,
      owner: payload.owner || current.owner || "人工客服",
      customerNotes: noteParts.join(" "),
    };
    await this.markDesignImageSelected(current.designJobId, selectedImage, patch.customerNotes);
    const updated = appConfig.useLocalStore
      ? this.localStore.updateQuoteDraft(id, patch)
      : await (this.prisma as any).quoteDraft.update({
          where: { id },
          data: patch,
          include: {
            customer: true,
            selectedImage: true,
            designJob: {
              include: {
                conversation: true,
                images: true,
              },
            },
          },
        });
    this.ensureQuoteIdentity(updated);
    await this.createReviewLog({
      targetType: "quote",
      targetId: id,
      decision: "manual_quote_revision",
      reviewer: payload.owner || "人工客服",
      note: patch.customerNotes,
      beforeStatus: current.status || "",
      afterStatus: updated.status,
      metadata: {
        source: "manual_quote_revision",
        quoteDraftId: id,
        designJobId: current.designJobId,
        wechatAccountId: current.designJob?.wechatAccountId,
        conversationId: current.designJob?.conversationId,
        customerId: current.customerId || current.designJob?.customerId,
        previousSelectedImageId: current.selectedImageId || null,
        selectedImageId: selectedImage.id,
        cancelledSendTaskId: cancelledSendTask?.id || null,
      },
    });
    return updated;
  }

  async preview(id: string, expected: ExpectedIdentityPayload = {}) {
    const quote = await this.getQuoteForSend(id);
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    this.ensureQuoteIdentity(quote);
    assertExpectedIdentity(quote, expected, "quote draft");
    return {
      quote,
      message: this.buildCustomerMessage(quote),
      warnings: this.quotePreviewWarnings(quote),
    };
  }

  async queueSend(
    id: string,
    options: QuoteQueueRequest = {},
  ) {
    return this.queueSendWithProvenance(id, manualQuoteQueueRequest(options), false);
  }

  private queueLowValueSend(id: string, options: QuoteQueueRequest) {
    return this.queueSendWithProvenance(id, manualQuoteQueueRequest(options), true);
  }

  private async queueSendWithProvenance(
    id: string,
    options: QuoteQueueRequest,
    lowValueAutomation: boolean,
  ) {
    const quote = await this.getQuoteForSend(id);
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    const designJob = quote.designJob;
    if (!designJob) throw new Error(`quote draft has no design job: ${id}`);
    this.ensureQuoteIdentity(quote);
    assertExpectedIdentity(quote, options, "quote draft");
    this.assertQuoteHasCompleteSendIdentity(quote);
    this.assertQuoteReadyForSend(quote);
    this.assertHighValueQuoteHasManualRelease(quote, options);

    const text = this.buildCustomerMessage(quote);
    if (options.releaseManualLock && designJob.conversationId) {
      assertManualReleaseReason(options.releaseReason, "quote send manual release");
      await this.wechatDispatch.setConversationManualLock(designJob.conversationId, {
        expectedWechatAccountId: designJob.wechatAccountId,
        expectedConversationId: designJob.conversationId,
        expectedCustomerId: quote.customerId || designJob.customerId,
        locked: false,
        reviewer: options.owner || "人工客服",
        reason: options.releaseReason,
        note: "人工已审核通过报价，恢复该会话的发送队列。",
      });
    }

    let sendTask: any;
    try {
      const trustedAutomation = lowValueAutomation
        ? {
            source: "low_value_quote_send",
            valueLevel: "low",
            quoteDraftId: quote.id,
            queuedBy: "low_value_automation",
          }
        : undefined;
      sendTask = await this.wechatDispatch.enqueueQuoteMessage({
        wechatAccountId: designJob.wechatAccountId,
        conversationId: designJob.conversationId,
        designJobId: designJob.id,
        quoteDraftId: quote.id,
        text,
        automation: trustedAutomation,
      });
    } catch (error) {
      if (options.releaseManualLock && designJob.conversationId) {
        await this.wechatDispatch.setConversationManualLock(designJob.conversationId, {
          expectedWechatAccountId: designJob.wechatAccountId,
          expectedConversationId: designJob.conversationId,
          expectedCustomerId: quote.customerId || designJob.customerId,
          locked: true,
          reviewer: options.owner || "人工客服",
          reason: "manual_approve_quote_queue_failed",
          note: `人工审核报价未能入队，已重新接管会话：${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
      throw error;
    }
    const nextPatch = {
      status: "send_queued",
      sendTaskId: sendTask.id,
      owner: options.owner || quote.owner || "人工客服",
      customerNotes: options.note || quote.customerNotes || "报价已进入微信安全发送队列",
    };
    const updated = appConfig.useLocalStore
      ? this.localStore.updateQuoteDraft(id, nextPatch)
      : await (this.prisma as any).quoteDraft.update({
          where: { id },
          data: nextPatch,
          include: {
            customer: true,
            designJob: true,
            selectedImage: true,
          },
        });
    if (options.releaseManualLock) {
      await this.createReviewLog({
        targetType: "quote",
        targetId: quote.id,
        decision: options.releaseReason || "manual_approve_quote",
        reviewer: options.owner || "人工客服",
        note: "人工审核通过并已创建微信报价发送任务。",
        beforeStatus: quote.status || "",
        afterStatus: updated.status,
        metadata: {
          source: "manual_release_quote_send",
          conversationId: designJob.conversationId,
          wechatAccountId: designJob.wechatAccountId,
          customerId: quote.customerId || designJob.customerId,
          designJobId: designJob.id,
          quoteDraftId: quote.id,
          sendTaskId: sendTask.id,
          releaseReason: options.releaseReason,
        },
      });
    }

    return { quote: updated, sendTask };
  }

  async verifyPaymentProofAndQueueConfirmation(
    id: string,
    payload: {
      paymentStatus?: "deposit_paid" | "paid";
      owner?: string;
      note?: string;
    } & ExpectedIdentityPayload = {},
  ) {
    const paymentStatus = normalizeVerifiedPaymentStatus(payload.paymentStatus);
    const quote = await this.getQuoteForSend(id);
    if (!quote) throw new BadRequestException(`quote draft not found: ${id}`);
    this.ensureQuoteIdentity(quote);
    assertExpectedIdentity(quote, payload, "quote draft");
    this.assertQuoteHasSelectedImageForPaymentProof(quote);

    const paymentLabel = paymentStatus === "paid" ? "全款" : "定金";
    const reviewer = payload.owner || quote.owner || "人工客服";
    const note = payload.note || `人工已核验客户${paymentLabel}付款凭证，报价进入订单跟进。`;
    const quotePatch = {
      status: "accepted",
      paymentStatus,
      owner: reviewer,
      customerNotes: note,
    };
    const updatedQuote = await this.updateQuoteDraft(id, { ...payload, ...quotePatch }, true);
    const orderDraft = await this.orders.createFromQuote(id, {
      expectedWechatAccountId: payload.expectedWechatAccountId,
      expectedConversationId: payload.expectedConversationId,
      expectedCustomerId: payload.expectedCustomerId,
    });
    const confirmedOrder = await this.orders.recordVerifiedPayment(orderDraft.id, {
      expectedWechatAccountId: payload.expectedWechatAccountId,
      expectedConversationId: payload.expectedConversationId,
      expectedCustomerId: payload.expectedCustomerId,
      paymentStatus,
      owner: reviewer,
      customerNotes: note,
    });

    const conversationId = confirmedOrder.conversationId || updatedQuote.designJob?.conversationId;
    if (this.isHighValueQuote(quote)) {
      if (conversationId) {
        await this.wechatDispatch.setConversationManualLock(conversationId, {
          expectedWechatAccountId: payload.expectedWechatAccountId,
          expectedConversationId: payload.expectedConversationId,
          expectedCustomerId: payload.expectedCustomerId,
          locked: true,
          reviewer,
          reason: "manual_payment_proof_high_value",
          note: `${note} 高价值订单已核验付款，保留人工接管；请人工核对订单确认话术后再发送。`,
        });
      }
      await this.createReviewLog({
        targetType: "quote",
        targetId: id,
        decision: "manual_payment_proof_verified_high_value",
        reviewer,
        note,
        beforeStatus: quote.status || "",
        afterStatus: "accepted",
        metadata: {
          source: "manual_payment_proof_verified_high_value",
          quoteDraftId: id,
          orderDraftId: confirmedOrder.id,
          designJobId: quote.designJobId,
          wechatAccountId: confirmedOrder.wechatAccountId || quote.designJob?.wechatAccountId,
          conversationId: confirmedOrder.conversationId || quote.designJob?.conversationId,
          customerId: confirmedOrder.customerId || quote.customerId || quote.designJob?.customerId,
          paymentStatus,
          sendTaskId: null,
        },
      });
      return {
        quote: updatedQuote,
        orderDraft: confirmedOrder,
        sendTask: null,
        message: "高价值订单付款已核验，已保留人工接管；请人工核对订单确认后再发送。",
      };
    }

    if (conversationId) {
      await this.wechatDispatch.setConversationManualLock(conversationId, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        locked: false,
        reviewer,
        reason: "manual_payment_proof_verified",
        note: `${note} 已解除人工接管，订单确认进入安全发送前校验。`,
      });
    }

    try {
      const confirmation = await this.wechatDispatch.queueOrderConfirmation(confirmedOrder.id, {
        expectedWechatAccountId: payload.expectedWechatAccountId,
        expectedConversationId: payload.expectedConversationId,
        expectedCustomerId: payload.expectedCustomerId,
        owner: reviewer,
        note: "订单确认已进入微信安全发送队列。",
        reason: "manual_payment_proof_verified",
      });
      await this.createReviewLog({
        targetType: "quote",
        targetId: id,
        decision: "manual_payment_proof_verified",
        reviewer,
        note,
        beforeStatus: quote.status || "",
        afterStatus: "accepted",
        metadata: {
          source: "manual_payment_proof_verified",
          quoteDraftId: id,
          orderDraftId: confirmedOrder.id,
          designJobId: quote.designJobId,
          wechatAccountId: confirmedOrder.wechatAccountId || quote.designJob?.wechatAccountId,
          conversationId: confirmedOrder.conversationId || quote.designJob?.conversationId,
          customerId: confirmedOrder.customerId || quote.customerId || quote.designJob?.customerId,
          paymentStatus,
          sendTaskId: confirmation.sendTask?.id || null,
        },
      });
      return { quote: updatedQuote, orderDraft: confirmation.orderDraft, sendTask: confirmation.sendTask, message: confirmation.message };
    } catch (error) {
      if (conversationId) {
        await this.wechatDispatch.setConversationManualLock(conversationId, {
          expectedWechatAccountId: payload.expectedWechatAccountId,
          expectedConversationId: payload.expectedConversationId,
          expectedCustomerId: payload.expectedCustomerId,
          locked: true,
          reviewer,
          reason: "manual_payment_proof_queue_failed",
          note: `付款凭证已核验，但订单确认未能入队，已重新人工接管：${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
      throw error;
    }
  }

  async scanLowValueAutoQuoteSends(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    const quotes = await this.list(filter);
    const result = {
      scanned: quotes.length,
      queued: [] as any[],
      skipped: [] as Array<{ quoteDraftId: string; designJobId?: string; reason: string; missing?: string[] }>,
      failed: [] as Array<{ quoteDraftId: string; designJobId?: string; errorMessage: string }>,
    };

    for (const quote of quotes as any[]) {
      const decision = evaluateLowValueQuoteSend(quote, { highValueAmountCny: appConfig.highValueAmountCny });
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
        result.queued.push(
          await this.queueLowValueSend(quote.id, {
            owner: "低价值自动化",
            note: "客户已选图，低价值报价已自动进入微信安全发送队列。",
          }),
        );
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

  private async syncExistingQuoteSelection(existing: any, selectedImageId?: string) {
    if (!selectedImageId) {
      this.ensureQuoteIdentity(existing);
      return existing;
    }

    const designJob =
      existing.designJob && Array.isArray(existing.designJob.images)
        ? existing.designJob
        : await this.getDesignJobForQuote(existing.designJobId);
    const images = Array.isArray(designJob?.images) ? designJob.images : [];
    const selectedImage =
      images.find((image: any) => image.id === selectedImageId || image.imageId === selectedImageId) ||
      images.find((image: any) => image.selected) ||
      null;
    if (!selectedImage) throw new Error(`selected image not found for quote draft: ${selectedImageId}`);
    if (selectedImage.designJobId && selectedImage.designJobId !== existing.designJobId) {
      throw new Error("selected image does not belong to quote design job");
    }
    if (existing.selectedImageId === selectedImage.id) {
      await this.markDesignImageSelected(existing.designJobId, selectedImage, "报价选图已同步。");
      this.ensureQuoteIdentity({ ...existing, designJob, selectedImage });
      return existing;
    }
    if (this.isQuoteSelectionLocked(existing)) {
      throw new BadRequestException("quote selection is locked after queueing, sending, or acceptance; create a manual revision instead");
    }

    await this.markDesignImageSelected(existing.designJobId, selectedImage, "报价选图已同步。");
    const updated = appConfig.useLocalStore
      ? this.localStore.updateQuoteDraft(existing.id, { selectedImageId: selectedImage.id })
      : await (this.prisma as any).quoteDraft.update({
          where: { id: existing.id },
          data: { selectedImageId: selectedImage.id },
          include: {
            customer: true,
            selectedImage: true,
            designJob: {
              include: {
                conversation: true,
                images: true,
              },
            },
          },
        });
    this.ensureQuoteIdentity(updated);
    return updated;
  }

  private resolveQuoteDesignImage(quote: any, selectedImageId?: string) {
    const id = String(selectedImageId || "").trim();
    if (!id) throw new BadRequestException("selectedImageId is required");
    const images = Array.isArray(quote?.designJob?.images) ? quote.designJob.images : [];
    const selectedImage = images.find((image: any) => image.id === id || image.imageId === id);
    if (!selectedImage) throw new BadRequestException(`selected image not found for quote draft: ${id}`);
    if (selectedImage.designJobId && selectedImage.designJobId !== quote.designJobId) {
      throw new BadRequestException("selected image does not belong to quote design job");
    }
    return selectedImage;
  }

  private async markDesignImageSelected(designJobId: string, selectedImage: any, feedback: string) {
    if (!designJobId || !selectedImage?.id) return;
    if (appConfig.useLocalStore) {
      this.localStore.selectDesignImage(designJobId, selectedImage.id, feedback);
      return;
    }
    const prisma = this.prisma as any;
    await prisma.designImageCandidate.updateMany({
      where: { designJobId },
      data: { selected: false },
    });
    await prisma.designImageCandidate.update({
      where: { id: selectedImage.id },
      data: { selected: true, customerFeedback: feedback },
    });
  }

  private async cancelLinkedQuoteSendTaskForRevision(
    quote: any,
    payload: { owner?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    if (!quote?.sendTaskId) return null;
    if (quote.sendTask?.status === "sent" || quote.sendTask?.status === "cancelled" || quote.status === "sent") return null;
    return this.wechatDispatch.cancelSendTask(quote.sendTaskId, {
      ...payload,
      reason: payload.note || "报价已人工修订，取消旧发送任务",
    });
  }

  private quoteUpdateInvalidatesPendingSendTask(data: Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(data, "status")) return false;
    return ["draft", "manual_review", "rejected", "cancelled"].includes(String(data.status || ""));
  }

  private quoteLinkedSendTaskCanBeCleared(quote: any) {
    if (!quote?.sendTaskId) return false;
    if (quote.status === "sent") return false;
    if (quote.sendTask?.status === "sent") return false;
    return true;
  }

  private async findOrderDraftForQuote(quoteDraftId: string) {
    if (appConfig.useLocalStore) {
      if (typeof this.localStore.listOrderDrafts !== "function") return null;
      return this.localStore.listOrderDrafts().find((order: any) => order.quoteDraftId === quoteDraftId) || null;
    }
    return (this.prisma as any).orderDraft.findUnique({ where: { quoteDraftId } });
  }

  private isQuoteSelectionLocked(quote: any) {
    return Boolean(quote?.sendTaskId) || ["send_queued", "sent", "accepted"].includes(String(quote?.status || ""));
  }

  private async getDesignJobForQuote(designJobId: string) {
    if (appConfig.useLocalStore) return this.localStore.getDesignJob(designJobId);
    return (this.prisma as any).designJob.findUnique({
      where: { id: designJobId },
      include: {
        conversation: true,
        images: true,
      },
    });
  }

  private buildCustomerMessage(quote: any) {
    const designJob = quote.designJob;
    return buildQuoteCustomerMessage({
      customerName: quote.customer?.name,
      scene: designJob?.scene,
      quantity: quote.quantity,
      unitPrice: quote.unitPrice,
      totalPrice: quote.totalPrice,
      hasSelectedImage: Boolean(quote.selectedImageId),
      selectedImagePosition: quote.selectedImage?.position,
      items: Array.isArray(designJob?.bundle?.items) ? designJob.bundle.items : [],
    });
  }

  private quotePreviewWarnings(quote: any) {
    const warnings: string[] = [];
    if (quote.sendTaskId) warnings.push("报价已进入发送队列");
    if (!quote.selectedImageId) warnings.push("报价还没有选图");
    if (!quote.designJob?.wechatAccountId) warnings.push("报价缺少微信账号");
    if (!quote.customerId && !quote.designJob?.customerId) warnings.push("报价缺少客户绑定");
    if (!quote.designJob?.conversationId) warnings.push("报价缺少客户会话");
    if (quoteNeedsPaymentProofReview(quote)) warnings.push("付款凭证需要先人工核验金额和收款账户");
    if (quote.status === "manual_review") warnings.push("报价正在等待人工审核");
    if (Number(quote.profit || 0) < 0) warnings.push("报价利润为负，需要人工确认");
    return warnings;
  }

  private assertQuoteReadyForSend(quote: any) {
    const warnings = this.quotePreviewWarnings(quote);
    if (warnings.length) {
      throw new BadRequestException(`报价还不能发送：${warnings.join("；")}`);
    }
  }

  private assertQuoteHasCompleteSendIdentity(quote: any) {
    const wechatAccountId = String(quote?.designJob?.wechatAccountId || "").trim();
    const customerId = String(quote?.customerId || quote?.designJob?.customerId || "").trim();
    const conversationId = String(quote?.designJob?.conversationId || "").trim();
    if (wechatAccountId && customerId && conversationId) return;
    throw new BadRequestException("报价缺少微信账号、客户或会话绑定，不能进入微信发送队列。");
  }

  private assertQuoteHasSelectedImageForPaymentProof(quote: any) {
    if (quote?.selectedImageId) return;
    throw new BadRequestException("quote payment proof verification requires a selected design image");
  }

  private assertHighValueQuoteHasManualRelease(
    quote: any,
    options: { releaseManualLock?: boolean; releaseReason?: string },
  ) {
    if (!this.isHighValueQuote(quote)) return;
    if (!options.releaseManualLock) {
      throw new BadRequestException("高价值报价必须先由人工审核，不能走自动或普通发送队列。");
    }
    assertManualReleaseReason(options.releaseReason, "high value quote manual send");
  }

  private isHighValueQuote(quote: any) {
    const threshold = Number(appConfig.highValueAmountCny || 10000);
    const totalPrice = Number(quote?.totalPrice ?? 0);
    const unitPrice = Number(quote?.unitPrice ?? 0);
    return (
      Boolean(quote?.isHighValue) ||
      Boolean(quote?.designJob?.isHighValue) ||
      isHighValueBudget(quote?.designJob?.budget, threshold) ||
      (Number.isFinite(totalPrice) && totalPrice >= threshold) ||
      (Number.isFinite(unitPrice) && unitPrice >= threshold)
    );
  }

  private async lockQuoteConversationForManualReview(quote: any, reviewer?: string) {
    const designJob = quote.designJob || (await this.getDesignJobForQuote(quote.designJobId));
    const conversationId = designJob?.conversationId;
    if (!conversationId) return null;
    return this.wechatDispatch.setConversationManualLock(conversationId, {
      expectedWechatAccountId: designJob.wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: quote.customerId || designJob.customerId,
      locked: true,
      reviewer: reviewer || "人工客服",
      reason: "quote_manual_review",
      note: "报价已进入人工跟进，暂停该会话自动回复和自动发送。",
    });
  }

  private async getQuoteForSend(id: string) {
    if (appConfig.useLocalStore) return this.localStore.getQuoteDraft(id);
    return (this.prisma as any).quoteDraft.findUnique({
      where: { id },
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
    });
  }

  private async findExistingForDesignJob(designJobId: string) {
    if (appConfig.useLocalStore) {
      return this.localStore.listQuoteDrafts().find((quote) => quote.designJobId === designJobId) || null;
    }
    return (this.prisma as any).quoteDraft.findFirst({
      where: { designJobId },
      include: {
        customer: true,
        designJob: {
          include: {
            conversation: true,
            images: true,
          },
        },
        selectedImage: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private ensureQuoteIdentity(quote: any) {
    const designJob = quote?.designJob;
    const identity = validateQuoteDraftIdentity({
      quoteDraft: quote,
      designJob,
      conversation: designJob?.conversation || null,
      selectedImage: quote?.selectedImage || null,
    });
    if (!identity.ok) throw new BadRequestException(`quote draft identity invalid: ${identity.reason}`);
    return identity;
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
    return prisma.reviewLog.create({ data: payload });
  }
}

type QuoteUpdatePatch = {
  status?: string;
  paymentStatus?: string;
  customerNotes?: string;
  owner?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  totalCost?: number | string;
};

function manualQuoteQueueRequest(payload: QuoteQueueRequest | Record<string, unknown> | null | undefined): QuoteQueueRequest {
  const value = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return {
    expectedWechatAccountId: quoteStringOrUndefined(value.expectedWechatAccountId),
    expectedConversationId: quoteStringOrUndefined(value.expectedConversationId),
    expectedCustomerId: quoteStringOrUndefined(value.expectedCustomerId),
    owner: quoteStringOrUndefined(value.owner),
    note: quoteStringOrUndefined(value.note),
    releaseManualLock: value.releaseManualLock === true,
    releaseReason: quoteStringOrUndefined(value.releaseReason),
  };
}

function quoteStringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function cleanQuotePatch(patch: QuoteUpdatePatch, current: any, allowVerifiedPayment = false) {
  const data: Record<string, string | number | null> = {};
  const allowedStatuses = allowVerifiedPayment
    ? ["accepted"]
    : ["draft", "manual_review", "rejected", "cancelled"];
  if (isAllowed(patch.status, allowedStatuses)) {
    data.status = patch.status as string;
  }
  if (allowVerifiedPayment && isAllowed(patch.paymentStatus, ["deposit_paid", "paid"])) {
    data.paymentStatus = patch.paymentStatus as string;
  }
  if (typeof patch.customerNotes === "string") data.customerNotes = patch.customerNotes;
  if (typeof patch.owner === "string") data.owner = patch.owner;
  if (patch.quantity !== undefined || patch.unitPrice !== undefined || patch.totalCost !== undefined) {
    const oldQuantity = positiveInteger(current?.quantity, 1);
    const quantity = patch.quantity === undefined ? oldQuantity : positiveInteger(patch.quantity, oldQuantity);
    const unitPrice = patch.unitPrice === undefined ? moneyNumber(current?.unitPrice, 0) : moneyNumber(patch.unitPrice, 0);
    const oldUnitCost = oldQuantity > 0 ? moneyNumber(current?.totalCost, 0) / oldQuantity : 0;
    const totalCost =
      patch.totalCost === undefined ? roundMoney(oldUnitCost * quantity) : moneyNumber(patch.totalCost, 0);
    const totalPrice = roundMoney(unitPrice * quantity);

    data.quantity = quantity;
    data.unitPrice = roundMoney(unitPrice);
    data.totalPrice = totalPrice;
    data.totalCost = totalCost;
    data.profit = roundMoney(totalPrice - totalCost);
  }
  return data;
}

function assertGenericQuoteUpdatePatch(patch: QuoteUpdatePatch) {
  if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) {
    throw new BadRequestException("报价付款状态只能通过付款凭证核验入口更新。");
  }
  if (patch.status !== undefined && !isAllowed(patch.status, ["draft", "manual_review", "rejected", "cancelled"])) {
    throw new BadRequestException("通用报价更新不允许推进自动发送、已发送或已接受状态。");
  }
}

function isAllowed(value: unknown, allowed: string[]) {
  return typeof value === "string" && allowed.includes(value);
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.floor(number));
}

function moneyNumber(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return roundMoney(number);
}

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function appendCustomerNote(before: unknown, note: string) {
  const previous = String(before || "").trim();
  return previous ? `${previous}\n${note}` : note;
}

function assertManualReleaseReason(reason: unknown, context: string) {
  const text = String(reason || "").trim();
  if (!text || !text.startsWith("manual_")) {
    throw new BadRequestException(`${context} 需要填写明确的人工处理原因，原因编码必须以 manual_ 开头。`);
  }
}

function normalizeVerifiedPaymentStatus(value: unknown): "deposit_paid" | "paid" {
  if (value === "deposit_paid" || value === "paid") return value;
  throw new BadRequestException("付款凭证核验只允许标记为定金已付或全款已付。");
}
