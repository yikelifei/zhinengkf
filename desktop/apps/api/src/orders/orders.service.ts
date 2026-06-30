import path from "node:path";
import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";

const {
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
      include: {
        customer: true,
        conversation: true,
        wechatAccount: true,
        designJob: true,
        quoteDraft: true,
        selectedImage: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return this.attachOrderSendTasks(orders);
  }

  async getById(id: string) {
    return this.getOrderDraft(id);
  }

  async createFromQuote(quoteId: string, expected: ExpectedIdentityPayload = {}) {
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new BadRequestException(`quote draft not found: ${quoteId}`);
    assertExpectedIdentity(quote, expected, "quote draft");

    const decision = buildOrderDraftFromQuote(quote);
    if (!decision.ok) {
      const missing = decision.missing?.length ? `: ${decision.missing.join(", ")}` : "";
      throw new BadRequestException(`order draft is not ready: ${decision.reason}${missing}`);
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
    if (!current) throw new BadRequestException(`order draft not found: ${id}`);
    assertExpectedIdentity(current, patch, "order draft");

    const data = cleanOrderDraftPatch(patch || {});
    if (!Object.keys(data).length) {
      throw new BadRequestException("order draft update has no allowed fields");
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
        throw new BadRequestException(`order draft quote binding invalid: ${binding.reason}`);
      }
    }

    const updated = appConfig.useLocalStore
      ? this.localStore.updateOrderDraft(id, data)
      : await (this.prisma as any).orderDraft.update({
          where: { id },
          data,
          include: {
            customer: true,
            conversation: true,
            wechatAccount: true,
            designJob: true,
            quoteDraft: true,
            selectedImage: true,
          },
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

  async scanLowValueAutoOrderDrafts() {
    const [quotes, orders] = await Promise.all([this.listQuotes(), this.list()]);
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
        const orderDraft = await this.createFromQuote(quote.id);
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

  private async getOrderDraft(id: string) {
    if (appConfig.useLocalStore) return this.localStore.getOrderDraft(id);
    const order = await (this.prisma as any).orderDraft.findUnique({
      where: { id },
      include: {
        customer: true,
        conversation: true,
        wechatAccount: true,
        designJob: true,
        quoteDraft: true,
        selectedImage: true,
      },
    });
    return this.attachOrderSendTasks(order);
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

  private async listQuotes() {
    if (appConfig.useLocalStore) return this.localStore.listQuoteDrafts();
    return (this.prisma as any).quoteDraft.findMany({
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
      include: {
        customer: true,
        conversation: true,
        wechatAccount: true,
        designJob: true,
        quoteDraft: true,
        selectedImage: true,
      },
    });
  }
}

type OrderDraftUpdatePatch = {
  status?: string;
  paymentStatus?: string;
  customerNotes?: string;
  owner?: string;
};
