import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";
import { rules } from "../shared/rules";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

const { buildQuoteCustomerMessage, calculateTotals, evaluateLowValueQuoteSend, validateQuoteDraftIdentity } = rules;

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly wechatDispatch: WechatDispatchService,
  ) {}

  async createFromDesignJob(designJobId: string, selectedImageId?: string) {
    const existing = await this.findExistingForDesignJob(designJobId);
    if (existing) {
      return this.syncExistingQuoteSelection(existing, selectedImageId);
    }

    if (appConfig.useLocalStore) return this.localStore.createQuoteFromDesignJob(designJobId, selectedImageId);
    const job = await this.prisma.designJob.findUnique({
      where: { id: designJobId },
      include: { images: true, conversation: true },
    });
    if (!job) throw new Error(`design job not found: ${designJobId}`);

    const bundle = job.bundle as { items?: Array<Record<string, unknown>> };
    const totals = calculateTotals(bundle.items || []);
    const budget = job.budget as { quantity?: number | null };
    const quantity = Number(budget.quantity || 1);
    const selectedImage = selectedImageId
      ? job.images.find((item) => item.id === selectedImageId || item.imageId === selectedImageId)
      : job.images.find((item) => item.selected) || job.images[0];

    const totalPrice = Number(totals.salePrice) * quantity;
    const totalCost = Number(totals.cost) * quantity;
    const isAutoQuote = !job.isHighValue;
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
    const current = await this.getQuoteForSend(id);
    if (!current) throw new Error(`quote draft not found: ${id}`);
    this.ensureQuoteIdentity(current);
    assertExpectedIdentity(current, patch, "quote draft");
    const data = cleanQuotePatch(patch, current);
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
        previousSelectedImageId: current.selectedImageId || null,
        selectedImageId: selectedImage.id,
        cancelledSendTaskId: cancelledSendTask?.id || null,
      },
    });
    return updated;
  }

  async preview(id: string) {
    const quote = await this.getQuoteForSend(id);
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    this.ensureQuoteIdentity(quote);
    return {
      quote,
      message: this.buildCustomerMessage(quote),
      warnings: this.quotePreviewWarnings(quote),
    };
  }

  async queueSend(
    id: string,
    options: {
      owner?: string;
      note?: string;
      automation?: Record<string, unknown>;
      releaseManualLock?: boolean;
      releaseReason?: string;
    } & ExpectedIdentityPayload = {},
  ) {
    const quote = await this.getQuoteForSend(id);
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    const designJob = quote.designJob;
    if (!designJob) throw new Error(`quote draft has no design job: ${id}`);
    this.ensureQuoteIdentity(quote);
    assertExpectedIdentity(quote, options, "quote draft");
    this.assertQuoteReadyForSend(quote);

    const text = this.buildCustomerMessage(quote);
    if (options.releaseManualLock && designJob.conversationId) {
      assertManualReleaseReason(options.releaseReason, "quote send manual release");
      await this.wechatDispatch.setConversationManualLock(designJob.conversationId, {
        locked: false,
        reviewer: options.owner || "人工客服",
        reason: options.releaseReason,
        note: "人工已审核通过报价，恢复该会话的发送队列。",
      });
    }

    let sendTask: any;
    try {
      sendTask = await this.wechatDispatch.enqueueQuoteMessage({
        wechatAccountId: designJob.wechatAccountId,
        conversationId: designJob.conversationId,
        designJobId: designJob.id,
        quoteDraftId: quote.id,
        text,
        automation: options.automation as any,
      });
    } catch (error) {
      if (options.releaseManualLock && designJob.conversationId) {
        await this.wechatDispatch.setConversationManualLock(designJob.conversationId, {
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
          designJobId: designJob.id,
          quoteDraftId: quote.id,
          sendTaskId: sendTask.id,
          releaseReason: options.releaseReason,
        },
      });
    }

    return { quote: updated, sendTask };
  }

  async scanLowValueAutoQuoteSends() {
    const quotes = await this.list();
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
          await this.queueSend(quote.id, {
            owner: "低价值自动化",
            note: "客户已选图，低价值报价已自动进入微信安全发送队列。",
            automation: {
              source: "low_value_quote_send",
              valueLevel: "low",
              queuedBy: "low_value_automation",
            },
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

    const designJob = existing.designJob || (await this.getDesignJobForQuote(existing.designJobId));
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
      this.ensureQuoteIdentity({ ...existing, designJob, selectedImage });
      return existing;
    }
    if (this.isQuoteSelectionLocked(existing)) {
      throw new BadRequestException("quote selection is locked after queueing, sending, or acceptance; create a manual revision instead");
    }

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

  private async cancelLinkedQuoteSendTaskForRevision(
    quote: any,
    payload: { owner?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    if (!quote?.sendTaskId) return null;
    if (quote.sendTask?.status === "sent" || quote.status === "sent") return null;
    return this.wechatDispatch.cancelSendTask(quote.sendTaskId, {
      ...payload,
      reason: payload.note || "报价已人工修订，取消旧发送任务",
    });
  }

  private async findOrderDraftForQuote(quoteDraftId: string) {
    if (appConfig.useLocalStore) {
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
      items: Array.isArray(designJob?.bundle?.items) ? designJob.bundle.items : [],
    });
  }

  private quotePreviewWarnings(quote: any) {
    const warnings: string[] = [];
    if (quote.sendTaskId) warnings.push("quote already has a send task");
    if (!quote.selectedImageId) warnings.push("quote has no selected image");
    if (!quote.designJob?.wechatAccountId) warnings.push("quote design job has no wechat account");
    if (!quote.designJob?.conversationId) warnings.push("quote design job has no conversation");
    if (quote.status === "manual_review") warnings.push("quote is waiting for manual review");
    if (Number(quote.profit || 0) < 0) warnings.push("quote profit is negative");
    return warnings;
  }

  private assertQuoteReadyForSend(quote: any) {
    const warnings = this.quotePreviewWarnings(quote);
    if (warnings.length) {
      throw new BadRequestException(`quote is not ready to send: ${warnings.join(", ")}`);
    }
  }

  private async lockQuoteConversationForManualReview(quote: any, reviewer?: string) {
    const designJob = quote.designJob || (await this.getDesignJobForQuote(quote.designJobId));
    const conversationId = designJob?.conversationId;
    if (!conversationId) return null;
    return this.wechatDispatch.setConversationManualLock(conversationId, {
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

function cleanQuotePatch(patch: QuoteUpdatePatch, current: any) {
  const data: Record<string, string | number> = {};
  if (isAllowed(patch.status, ["draft", "auto_sent", "send_queued", "manual_review", "sent", "accepted", "rejected", "cancelled"])) {
    data.status = patch.status as string;
  }
  if (isAllowed(patch.paymentStatus, ["unpaid", "deposit_paid", "paid", "refunded"])) {
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

function assertManualReleaseReason(reason: unknown, context: string) {
  const text = String(reason || "").trim();
  if (!text || !text.startsWith("manual_")) {
    throw new BadRequestException(`${context} requires an explicit manual release reason`);
  }
}
