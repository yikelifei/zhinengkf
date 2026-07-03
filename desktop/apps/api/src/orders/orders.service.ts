import path from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";

const {
  buildOrderConfirmationCustomerMessage,
  buildOrderDraftFromQuote,
  cleanOrderDraftPatch,
  evaluateLowValueOrderDraftFromQuote,
  quotePatchForOrderDraft,
  validateOrderDraftQuoteBinding,
} = require(path.join(process.cwd(), "packages", "rules"));

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

  async getById(id: string) {
    return this.getOrderDraft(id);
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

  async createFromQuote(quoteId: string, expected: ExpectedIdentityPayload = {}) {
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new BadRequestException(`没有找到报价草稿：${quoteId}`);
    assertExpectedIdentity(quote, expected, "quote draft");

    const decision = buildOrderDraftFromQuote(quote);
    if (!decision.ok) {
      const missing = decision.missing?.length ? `，缺少：${decision.missing.map(orderDraftMissingLabel).join("、")}` : "";
      throw new BadRequestException(`报价还不能生成订单草稿：${orderDraftDecisionReasonLabel(decision.reason)}${missing}`);
    }

    const orderDraft = appConfig.useLocalStore
      ? this.localStore.upsertOrderDraftFromQuote(quoteId, decision.orderDraft)
      : await this.upsertPrismaOrderDraft(quoteId, decision.orderDraft);

    await this.notifications.create(
      "info",
      "订单草稿已生成",
      `客户 ${quote.customer?.name || quote.customerId} 的报价已生成订单草稿，金额 ${decision.orderDraft.totalPrice} 元。`,
      { orderDraftId: orderDraft.id, quoteDraftId: quoteId, designJobId: quote.designJobId },
    );

    return orderDraft;
  }

  async update(id: string, patch: OrderDraftUpdatePatch & ExpectedIdentityPayload) {
    const current = await this.getOrderDraft(id);
    if (!current) throw new BadRequestException(`没有找到订单草稿：${id}`);
    assertExpectedIdentity(current, patch, "order draft");

    const data = cleanOrderDraftPatch(patch || {});
    if (!Object.keys(data).length) {
      throw new BadRequestException("订单草稿没有可更新的字段，请至少修改状态、付款状态、备注或跟进人。");
    }

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

    const updated = appConfig.useLocalStore
      ? this.localStore.updateOrderDraft(id, data)
      : await (this.prisma as any).orderDraft.update({
          where: { id },
          data,
          include: this.orderInclude(),
        });

    if (current.quoteDraftId && Object.keys(quotePatch).length) {
      await this.updateQuote(current.quoteDraftId, quotePatch);
    }

    await this.notifications.create(
      "info",
      "订单草稿已更新",
      `订单 ${id} 已更新为 ${updated.status} / ${updated.paymentStatus}。`,
      { orderDraftId: id, quoteDraftId: current.quoteDraftId, designJobId: current.designJobId },
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
      selectedImageSnapshot: selectedImage,
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
        },
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
      paymentStatus: order.paymentStatus,
      items: context.items,
      hasSelectedImage: Boolean(context.selectedImage),
      selectedImagePosition: context.selectedImage?.position,
    });
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
      selectedImage: this.orderSelectedImage(order),
    };
  }

  private orderConfirmationPreviewWarnings(order: any) {
    const warnings: string[] = [];
    if (order.status === "cancelled") warnings.push("订单已取消");
    if (order.confirmationSendTaskId || order.confirmationSendTask) warnings.push("订单确认消息已进入发送队列");
    if (!order.selectedImageId && !order.quoteDraft?.selectedImageId) warnings.push("订单还没有选图");
    if (!order.wechatAccountId) warnings.push("订单缺少微信账号");
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
    return order?.selectedImage || order?.quoteDraft?.selectedImage || order?.selectedImageSnapshot || null;
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
      task.guardSnapshot?.reason === "order-confirmation" ||
      task.guardSnapshot?.reason === "low_value_order_confirmation";
    if (automation.orderDraftId === order.id) return isConfirmation;
    if (task.quoteDraftId !== order.quoteDraftId) return false;
    return isConfirmation;
  }

  private isOrderFollowupSendTask(task: any, order: any) {
    const automation = task.guardSnapshot?.automation || {};
    if (automation.orderDraftId !== order.id && task.quoteDraftId !== order.quoteDraftId) return false;
    return (
      automation.source === "order_followup" ||
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
    return (this.prisma as any).reviewLog.create({ data: payload });
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

type OrderDraftUpdatePatch = {
  status?: string;
  paymentStatus?: string;
  customerNotes?: string;
  owner?: string;
};
