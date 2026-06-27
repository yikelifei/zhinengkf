import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { rules } from "../shared/rules";
import { WechatSendAdapterService } from "./wechat-send-adapter.service";

const {
  buildConversationManualLockTransition,
  buildAgentReplyDraft,
  buildDemoWechatWindowSnapshot,
  buildSendQueueSkipAdvice,
  buildInboundReplyText,
  buildOrderConfirmationCustomerMessage,
  buildOrderFollowupCustomerMessage,
  diagnoseWechatWindowSnapshot,
  evaluateSendTaskRequeue,
  evaluateAgentRoute,
  evaluateLowValueOrderConfirmationSend,
  evaluateLowValueOrderFollowupSend,
  findPendingSceneClarificationContext,
  normalizeWechatWindowSnapshot,
  planInboundAutomation,
  planInboundQuoteAcceptance,
  planCustomerImageSelection,
  recommendBundle,
  validateInboundConversationBinding,
  validateBridgeAckBinding,
  validateOrderDraftQuoteBinding,
  validateSendGuard,
  validateSendTaskBinding,
} = rules;

const BRIDGE_OUTBOX_VERSION = "wechat_bridge_outbox_v1";

@Injectable()
export class WechatDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly sendAdapter: WechatSendAdapterService,
    private readonly notifications: NotificationsService,
    private readonly orders: OrdersService,
  ) {}

  async enqueueDesignImages(params: {
    wechatAccountId: string;
    conversationId: string;
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
    if (appConfig.useLocalStore) {
      return this.createLocalSendTask({
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        designJobId: params.designJobId,
        payload: {
          kind: "design_images",
          textBeforeImages: params.textBeforeImages || "",
          imagePaths: params.imagePaths,
        },
        guardSnapshot,
      });
    }
    return this.prisma.wechatSendTask.create({
      data: {
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        designJobId: params.designJobId,
        status: "queued",
        payload: {
          kind: "design_images",
          textBeforeImages: params.textBeforeImages || "",
          imagePaths: params.imagePaths,
        },
        guardSnapshot: guardSnapshot as any,
      },
    });
  }

  async enqueueQuoteMessage(params: {
    wechatAccountId: string;
    conversationId: string;
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

    if (appConfig.useLocalStore) {
      return this.createLocalSendTask({
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        designJobId: binding.designJobId || params.designJobId,
        quoteDraftId: params.quoteDraftId,
        payload,
        guardSnapshot,
      });
    }
    return (this.prisma as any).wechatSendTask.create({
      data: {
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        designJobId: binding.designJobId || params.designJobId,
        quoteDraftId: params.quoteDraftId,
        status: "queued",
        payload,
        guardSnapshot,
      },
    });
  }

  async enqueueTextMessage(params: {
    wechatAccountId: string;
    conversationId: string;
    designJobId?: string;
    quoteDraftId?: string;
    text: string;
    reason?: string;
    automation?: Prisma.InputJsonObject;
  }) {
    await this.assertConversationCanQueueSend(params.conversationId);
    const binding = await this.assertSendTaskBinding({
      wechatAccountId: params.wechatAccountId,
      conversationId: params.conversationId,
      designJobId: params.designJobId,
      quoteDraftId: params.quoteDraftId,
    });
    const guardSnapshot: Prisma.InputJsonObject = {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      binding,
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.automation ? { automation: params.automation } : {}),
    };
    const payload = { kind: "text", text: params.text };

    if (appConfig.useLocalStore) {
      return this.createLocalSendTask({
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        designJobId: binding.designJobId || params.designJobId,
        quoteDraftId: params.quoteDraftId,
        payload,
        guardSnapshot,
      });
    }
    return (this.prisma as any).wechatSendTask.create({
      data: {
        wechatAccountId: params.wechatAccountId,
        conversationId: params.conversationId,
        designJobId: binding.designJobId || params.designJobId,
        quoteDraftId: params.quoteDraftId,
        status: "queued",
        payload,
        guardSnapshot,
      },
    });
  }

  async queueOrderConfirmation(
    orderDraftId: string,
    payload: { owner?: string; note?: string; reason?: string; automation?: Prisma.InputJsonObject } = {},
  ) {
    const order = await this.orders.getById(orderDraftId);
    if (!order) throw new BadRequestException(`order draft not found: ${orderDraftId}`);
    if (order.status === "cancelled") {
      throw new BadRequestException("cancelled order draft cannot queue confirmation");
    }
    if (!order.wechatAccountId || !order.conversationId) {
      throw new BadRequestException("order draft has no wechat account or conversation");
    }

    const designJob = order.designJob || order.quoteDraft?.designJob || null;
    const binding = validateOrderDraftQuoteBinding({
      orderDraft: order,
      quoteDraft: order.quoteDraft,
      designJob,
      conversation: order.conversation || designJob?.conversation,
      selectedImage: order.selectedImage || order.quoteDraft?.selectedImage,
    });
    if (!binding.ok) {
      throw new BadRequestException(`order confirmation binding invalid: ${binding.reason}`);
    }

    const bundleSnapshot = order.bundleSnapshot || {};
    const items = Array.isArray(designJob?.bundle?.items)
      ? designJob.bundle.items
      : Array.isArray((bundleSnapshot as any).items)
        ? (bundleSnapshot as any).items
        : [];
    const message = buildOrderConfirmationCustomerMessage({
      customerName: order.customer?.name || order.quoteDraft?.customer?.name,
      scene: designJob?.scene,
      quantity: order.quantity,
      totalPrice: order.totalPrice,
      paymentStatus: order.paymentStatus,
      items,
    });
    const sendTask = await this.enqueueTextMessage({
      wechatAccountId: order.wechatAccountId,
      conversationId: order.conversationId,
      designJobId: order.designJobId,
      quoteDraftId: order.quoteDraftId,
      text: message,
      reason: payload.reason || "order-confirmation",
      automation: {
        source: "order_confirmation",
        orderDraftId: order.id,
        quoteDraftId: order.quoteDraftId,
        paymentStatus: order.paymentStatus,
        queuedBy: payload.owner || "manual_operator",
        ...(payload.automation || {}),
      },
    });
    const updatedOrder = await this.orders.update(order.id, {
      owner: payload.owner || order.owner || "人工客服",
      customerNotes: payload.note || order.customerNotes || "订单确认已进入微信安全发送队列。",
    });
    await this.notifications.create(
      "info",
      "订单确认已入队",
      "系统已根据订单草稿生成客户确认话术，并放入微信安全发送队列。",
      {
        orderDraftId: order.id,
        quoteDraftId: order.quoteDraftId,
        designJobId: order.designJobId,
        sendTaskId: sendTask.id,
      },
    );

    return { orderDraft: updatedOrder, sendTask, message };
  }

  async queueOrderFollowup(
    orderDraftId: string,
    payload: {
      type?: "production" | "delivery";
      owner?: string;
      reason?: string;
      automation?: Prisma.InputJsonObject;
    } = {},
  ) {
    const order = await this.orders.getById(orderDraftId);
    if (!order) throw new BadRequestException(`order draft not found: ${orderDraftId}`);
    if (order.status === "cancelled") {
      throw new BadRequestException("cancelled order draft cannot queue follow-up");
    }
    if (!order.wechatAccountId || !order.conversationId) {
      throw new BadRequestException("order draft has no wechat account or conversation");
    }

    const designJob = order.designJob || order.quoteDraft?.designJob || null;
    const binding = validateOrderDraftQuoteBinding({
      orderDraft: order,
      quoteDraft: order.quoteDraft,
      designJob,
      conversation: order.conversation || designJob?.conversation,
      selectedImage: order.selectedImage || order.quoteDraft?.selectedImage,
    });
    if (!binding.ok) {
      throw new BadRequestException(`order follow-up binding invalid: ${binding.reason}`);
    }

    const context = this.buildOrderMessageContext(order);
    const followupType = payload.type || (order.status === "fulfilled" ? "delivery" : "production");
    const message = buildOrderFollowupCustomerMessage({
      type: followupType,
      customerName: context.customerName,
      scene: context.scene,
      quantity: order.quantity,
      totalPrice: order.totalPrice,
      paymentStatus: order.paymentStatus,
      leadTimeDays: this.maxLeadTimeDays(context.items),
      items: context.items,
    });
    const sendTask = await this.enqueueTextMessage({
      wechatAccountId: order.wechatAccountId,
      conversationId: order.conversationId,
      designJobId: order.designJobId,
      quoteDraftId: order.quoteDraftId,
      text: message,
      reason: payload.reason || "order-followup",
      automation: {
        source: "order_followup",
        followupType,
        orderDraftId: order.id,
        quoteDraftId: order.quoteDraftId,
        paymentStatus: order.paymentStatus,
        queuedBy: payload.owner || "manual_operator",
        ...(payload.automation || {}),
      },
    });
    await this.notifications.create(
      "info",
      followupType === "delivery" ? "订单交期说明已入队" : "订单生产通知已入队",
      "系统已根据订单草稿生成客户跟进话术，并放入微信安全发送队列。",
      {
        orderDraftId: order.id,
        quoteDraftId: order.quoteDraftId,
        designJobId: order.designJobId,
        sendTaskId: sendTask.id,
        followupType,
      },
    );

    return { orderDraft: await this.orders.getById(order.id), sendTask, message };
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

  private async listOrderFollowupTypes(order: any) {
    const tasks = await this.listOrderRelatedSendTasks(order);
    return [
      ...new Set(
        tasks
          .filter((task: any) => this.isOrderFollowupTask(task, order))
          .map((task: any) => task?.guardSnapshot?.automation?.followupType || "any")
          .filter(Boolean)
          .map(String),
      ),
    ];
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
    const automation = task?.guardSnapshot?.automation || {};
    if (order.id && automation.orderDraftId === order.id) return true;
    return Boolean(order.quoteDraftId && task?.quoteDraftId === order.quoteDraftId);
  }

  private isOrderFollowupTask(task: any, order: any) {
    if (!this.isOrderRelatedSendTask(task, order)) return false;
    const automation = task?.guardSnapshot?.automation || {};
    return automation.source === "order_followup" || task?.guardSnapshot?.reason === "order-followup";
  }

  async scanLowValueOrderConfirmations(params: { orderDrafts?: any[] } = {}) {
    const orders = Array.isArray(params.orderDrafts) ? params.orderDrafts : await this.orders.list();
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
          await this.queueOrderConfirmation(order.id, {
            owner: "low_value_automation",
            note: "低价值订单确认已自动进入微信安全发送队列。",
            reason: "low_value_order_confirmation",
            automation: {
              valueLevel: "low",
              queuedBy: "low_value_automation",
            },
          }),
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

  async scanLowValueOrderFollowups(params: { orderDrafts?: any[] } = {}) {
    const orders = Array.isArray(params.orderDrafts) ? params.orderDrafts : await this.orders.list();
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
      const decision = evaluateLowValueOrderFollowupSend(order, {
        highValueAmountCny: appConfig.highValueAmountCny,
        existingFollowupTypes,
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
          await this.queueOrderFollowup(order.id, {
            type: decision.followupType,
            owner: "low_value_automation",
            reason: "low_value_order_followup",
            automation: {
              valueLevel: "low",
              queuedBy: "low_value_automation",
            },
          }),
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
    if (!appConfig.useLocalStore) throw new Error("wechat account prisma mode is not implemented yet");
    return this.localStore.listWechatAccounts();
  }

  listConversations(wechatAccountId?: string) {
    if (!appConfig.useLocalStore) throw new Error("wechat conversation prisma mode is not implemented yet");
    return this.localStore.listConversations(wechatAccountId);
  }

  async setConversationManualLock(
    id: string,
    payload: { locked?: boolean; reviewer?: string; reason?: string; note?: string } = {},
  ) {
    const before = appConfig.useLocalStore
      ? this.localStore.listConversations().find((conversation: any) => conversation.id === id)
      : await this.prisma.conversation.findUnique({ where: { id } });
    if (!before) throw new BadRequestException(`conversation not found: ${id}`);

    const transition = buildConversationManualLockTransition({
      locked: payload.locked,
      wasLocked: before.manualLocked,
      reason: payload.reason,
      source: "conversation_manual_lock",
    });
    const updated = appConfig.useLocalStore
      ? this.localStore.updateConversation(id, { manualLocked: transition.locked })
      : await this.prisma.conversation.update({
          where: { id },
          data: { manualLocked: transition.locked },
        });
    const blockedSendTasks = transition.locked
      ? await this.blockQueuedSendTasksForManualLock(before, payload.reviewer || "人工客服")
      : [];
    const inFlightSendTasks = transition.locked
      ? this.cancelInFlightSendTasksForManualLock(id, payload.reviewer || "人工客服")
      : [];
    const note =
      payload.note ||
      (transition.locked ? "人工已接管该会话，自动回复暂停。" : "人工处理已完成，该会话可恢复自动化判断。");
    const lockNoticeParts = [note];
    if (blockedSendTasks.length) lockNoticeParts.push(`已暂停 ${blockedSendTasks.length} 个待发送任务。`);
    if (inFlightSendTasks.length) lockNoticeParts.push(`已取消 ${inFlightSendTasks.length} 个发送中任务。`);
    const log = await this.createReviewLog({
      targetType: "conversation",
      targetId: id,
      decision: transition.decision,
      reviewer: payload.reviewer || "人工客服",
      note,
      beforeStatus: transition.beforeStatus,
      afterStatus: transition.afterStatus,
      metadata: {
        ...transition.metadata,
        wechatAccountId: before.wechatAccountId || null,
        customerId: before.customerId || null,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        cancelledInFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
      },
    });
    await this.notifications.create(
      transition.locked ? "warning" : "info",
      transition.locked ? "会话已锁定人工处理" : "会话已解除人工锁定",
      transition.locked ? lockNoticeParts.join(" ") : note,
      {
        conversationId: id,
        customerId: before.customerId,
        wechatAccountId: before.wechatAccountId,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        cancelledInFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
      },
    );
    if (inFlightSendTasks.length) {
      await this.notifications.create(
        "warning",
        "发送中任务已因人工接管取消",
        `${before.title || id} 有 ${inFlightSendTasks.length} 个发送中任务已取消；如桥接程序已开始操作，请人工核查微信窗口是否已经发出。`,
        {
          conversationId: id,
          customerId: before.customerId,
          wechatAccountId: before.wechatAccountId,
          sendTaskIds: inFlightSendTasks.map((task: any) => task.id),
          cancelledInFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        },
      );
    }
    return { conversation: updated, log, blockedSendTasks, inFlightSendTasks };
  }

  async processInboundMessage(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    text: string;
    externalId?: string;
    assetIds?: string[];
    attachments?: Array<Record<string, unknown>>;
  }) {
    if (!appConfig.useLocalStore) throw new Error("inbound message prisma mode is not implemented yet");
    const conversation = this.resolveInboundConversation(payload);
    const assetIds = normalizeAssetIds([...(payload.assetIds || []), ...(payload.attachments || [])]);
    const message = this.localStore.createMessage({
      conversationId: conversation.id,
      direction: "inbound",
      text: payload.text || "",
      externalId: payload.externalId,
      attachments: payload.attachments || [],
      metadata: { assetIds },
    });
    const clarificationContext = this.findLatestSceneClarification(conversation.id);
    const routeBase = evaluateAgentRoute(
      {
        text: payload.text || "",
        channel: conversation.channel || "wechat",
        customerId: conversation.customerId,
        conversationId: conversation.id,
        clarificationContext,
      },
      { highValueAmountCny: appConfig.highValueAmountCny },
    );
    const agent = this.localStore.getAgentByKey(routeBase.agentKey);
    const skills = agent?.id ? this.localStore.listAgentSkills(agent.id) : [];
    const knowledgeEntries = agent?.id ? this.localStore.listKnowledgeEntries(agent.id) : [];
    const draft = buildAgentReplyDraft(routeBase, {
      agentId: agent?.id,
      skills,
      knowledgeEntries,
    });
    const route = this.localStore.createRouteEvaluation(
      {
        channel: conversation.channel || "wechat",
        text: payload.text || "",
        customerId: conversation.customerId,
        conversationId: conversation.id,
      },
      {
        ...routeBase,
        suggestedReply: draft.suggestedReply,
        appliedSkills: draft.appliedSkills,
        knowledgeMatches: draft.knowledgeMatches,
        replyDraft: draft.replyDraft,
      },
    );
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
      result.notification = await this.notifications.create(
        "warning",
        "人工接管会话收到新消息",
        `${conversation.title}：客户有新消息，请人工继续处理。`,
        {
          conversationId: conversation.id,
          customerId: conversation.customerId,
          routeId: route.id,
          reason: plan.reason,
        },
      );
      return result;
    }

    const imageSelectionResult = await this.handleInboundImageSelection({
      conversation,
      message,
      route,
      payload,
    });
    if (imageSelectionResult) return imageSelectionResult;

    const quoteAcceptanceResult = await this.handleInboundQuoteAcceptance({
      conversation,
      message,
      route,
      payload,
    });
    if (quoteAcceptanceResult) return quoteAcceptanceResult;

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
      result.manualLock = await this.lockConversationForManualReview(conversation, {
        reviewer: "system",
        reason: plan.reason,
      });
      result.notification = await this.notifications.create(
        "warning",
        "客户消息需要人工处理",
        result.manualLock.blockedSendTasks.length
          ? `${conversation.title}：${plan.reason}。已暂停 ${result.manualLock.blockedSendTasks.length} 个待发送任务。`
          : `${conversation.title}：${plan.reason}`,
        {
          conversationId: conversation.id,
          customerId: conversation.customerId,
          routeId: route.id,
          reason: plan.reason,
          blockedSendTaskIds: result.manualLock.blockedSendTasks.map((task: any) => task.id),
          inFlightSendTaskIds: result.manualLock.inFlightSendTasks.map((task: any) => task.id),
        },
      );
      return result;
    }

    if (plan.shouldCreateDesignJob) {
      result.designJob = this.createDesignDraftFromInbound({
        conversation,
        route,
        assetIds,
        bundleRecommendation,
        customerText: payload.text || "",
      });
    }

    if (plan.shouldQueueReply) {
      result.sendTask = this.createLocalSendTask({
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        designJobId: result.designJob?.id,
        payload: {
          kind: "text",
          text: buildInboundReplyText(route, plan),
          routeId: route.id,
          inboundMessageId: message.id,
          automationPlan: plan.type,
        },
        guardSnapshot: {
          requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
          policy: "single-account-serial-queue",
          reason: `inbound-${plan.reason}`,
        },
      });
    }

    return result;
  }

  listWindowSnapshots() {
    if (!appConfig.useLocalStore) throw new Error("wechat window snapshot prisma mode is not implemented yet");
    return this.localStore.listWechatWindowSnapshots();
  }

  getWindowObserverStatus() {
    if (!appConfig.useLocalStore) throw new Error("wechat window observer status prisma mode is not implemented yet");
    const statusFile = appConfig.wechatWindowObserverStatusFile;
    if (!fs.existsSync(statusFile)) {
      return {
        ok: false,
        status: "not_started",
        statusFile,
        ageSeconds: null,
        message: "window observer has not written a status file yet",
      };
    }

    const stat = fs.statSync(statusFile);
    const ageSeconds = Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 1000));
    try {
      const data = JSON.parse(fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""));
      return {
        ...data,
        statusFile,
        ageSeconds,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        status: "invalid_status_file",
        statusFile,
        ageSeconds,
        modifiedAt: stat.mtime.toISOString(),
        errorMessage: error instanceof Error ? error.message : "invalid window observer status json",
      };
    }
  }

  captureWindowObserverOnce() {
    if (!appConfig.useLocalStore) throw new Error("wechat window observer capture prisma mode is not implemented yet");
    const observerScript = path.join(process.cwd(), "tools", "wechat-window-observer.js");
    if (!fs.existsSync(observerScript)) {
      throw new BadRequestException(`window observer script not found: ${observerScript}`);
    }

    const result = spawnSync(process.execPath, [observerScript, "--once"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: appConfig.wechatWindowSnapshotInboxDir,
        WECHAT_WINDOW_OBSERVER_STATUS_FILE: appConfig.wechatWindowObserverStatusFile,
      },
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

    const scan = this.scanWindowSnapshotInbox();
    return {
      status: this.getWindowObserverStatus(),
      scan,
      stdout: String(result.stdout || "").trim(),
    };
  }

  createWindowSnapshot(payload: Record<string, unknown>) {
    if (!appConfig.useLocalStore) throw new Error("wechat window snapshot prisma mode is not implemented yet");
    const snapshot = normalizeWechatWindowSnapshot(payload || {});
    const account = this.localStore.listWechatAccounts().find((item) => item.id === snapshot.wechatAccountId) || null;
    const conversations = this.localStore.listConversations(snapshot.wechatAccountId || undefined);
    const diagnostic = diagnoseWechatWindowSnapshot({ snapshot, account, conversations });
    return this.localStore.createWechatWindowSnapshot({
      ...snapshot,
      diagnostic,
    });
  }

  scanWindowSnapshotInbox() {
    if (!appConfig.useLocalStore) throw new Error("wechat window snapshot inbox prisma mode is not implemented yet");
    const inboxDir = appConfig.wechatWindowSnapshotInboxDir;
    const entries = listJsonInboxFiles(inboxDir);
    const processed: any[] = [];
    const failed: any[] = [];

    for (const entry of entries) {
      try {
        const data = readJsonFile(entry.filePath);
        const snapshots = normalizeWindowSnapshotInboxPayload(data);
        if (!snapshots.length) {
          throw new Error("window snapshot inbox file must contain a snapshot object or snapshots array");
        }

        const created = snapshots.map((snapshot, index) => {
          if (!isPlainObject(snapshot)) {
            throw new Error(`snapshot[${index}] must be a JSON object`);
          }
          return this.createWindowSnapshot({
            source: "window_snapshot_inbox",
            ...snapshot,
          });
        });
        const archivedPath = moveJsonInboxFile(entry.filePath, inboxDir, "processed");
        processed.push({
          ...entry,
          snapshotCount: created.length,
          archivedPath,
          snapshots: created,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown window snapshot inbox error";
        const archivedPath = moveJsonInboxFile(entry.filePath, inboxDir, "failed");
        failed.push({ ...entry, archivedPath, errorMessage });
      }
    }

    return {
      inboxDir,
      scanned: entries.length,
      processed,
      failed,
    };
  }

  createDemoWindowSnapshot(payload: { mode?: "correct" | "wrong_chat" | "offline"; wechatAccountId?: string; conversationId?: string }) {
    if (!appConfig.useLocalStore) throw new Error("wechat window snapshot prisma mode is not implemented yet");
    if (!payload?.wechatAccountId) {
      throw new BadRequestException("wechatAccountId is required for demo window snapshot");
    }
    if (!payload?.conversationId) {
      throw new BadRequestException("conversationId is required for demo window snapshot");
    }
    const accounts = this.localStore.listWechatAccounts();
    const account = accounts.find((item) => item.id === payload.wechatAccountId);
    if (!account) throw new BadRequestException("wechat account not found for demo window snapshot");
    const conversations = this.localStore.listConversations(account.id);
    const conversation = conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) {
      throw new BadRequestException("conversation does not belong to selected wechat account");
    }
    const otherConversation = this.localStore
      .listConversations()
      .find((item) => item.id !== conversation?.id);
    const snapshot = buildDemoWechatWindowSnapshot({
      mode: payload?.mode || "correct",
      account,
      conversation,
      otherConversation,
    });
    const diagnostic = diagnoseWechatWindowSnapshot({
      snapshot,
      account,
      conversations: this.localStore.listConversations(account.id),
    });
    return this.localStore.createWechatWindowSnapshot({
      ...snapshot,
      diagnostic,
    });
  }

  listSendTasks() {
    if (!appConfig.useLocalStore) throw new Error("send task prisma mode is not implemented yet");
    return this.localStore.listSendTasks();
  }

  listSendAttempts(sendTaskId?: string) {
    if (!appConfig.useLocalStore) throw new Error("send attempt prisma mode is not implemented yet");
    return this.localStore.listSendAttempts({ sendTaskId });
  }

  getSendAdapter(adapter?: string) {
    return this.sendAdapter.describe(adapter);
  }

  getBridgeStatus() {
    if (!appConfig.useLocalStore) throw new Error("wechat bridge status prisma mode is not implemented yet");
    const outbox = this.listBridgeOutbox();
    const inboxPending = this.sendAdapter.listBridgeInbox().map((entry) => this.buildBridgeInboxListItem(entry));
    const locks = this.sendAdapter.listBridgeLocks();
    const worker = this.sendAdapter.getBridgeWorkerStatus();

    return {
      adapter: this.getSendAdapter("windows_bridge"),
      worker,
      outbox: {
        outboxDir: outbox.outboxDir,
        pendingCount: outbox.pending.length,
        ignoredCount: outbox.ignored.length,
        pending: outbox.pending,
      },
      inbox: {
        inboxDir: appConfig.wechatBridgeInboxDir,
        pendingCount: inboxPending.length,
        pending: inboxPending,
      },
      locks: {
        lockDir: appConfig.wechatBridgeLockDir,
        activeCount: locks.length,
        staleCount: locks.filter((lock) => lock.stale).length,
        active: locks,
      },
    };
  }

  listBridgeOutbox() {
    if (!appConfig.useLocalStore) throw new Error("wechat bridge outbox prisma mode is not implemented yet");
    const entries = this.sendAdapter.listBridgeOutbox();
    const pending: any[] = [];
    const ignored: any[] = [];

    for (const entry of entries) {
      const task = entry.taskId ? this.localStore.getSendTask(entry.taskId) : null;
      const attempt = entry.taskId
        ? this.localStore.getLatestSendAttempt(entry.taskId, { adapter: "windows_bridge", status: "started" })
        : null;
      const item = this.buildBridgeOutboxListItem(entry, task, attempt);
      if (!entry.errorMessage && task?.status === "sending" && attempt) pending.push(item);
      else {
        ignored.push({
          ...item,
          ignoreReason: entry.errorMessage || (!task ? "task_not_found" : task.status !== "sending" ? "task_not_sending" : "pending_bridge_attempt_missing"),
        });
      }
    }

    return {
      outboxDir: appConfig.wechatBridgeOutboxDir,
      pending,
      ignored,
    };
  }

  private buildBridgeOutboxListItem(entry: any, task: any, attempt: any) {
    return {
      fileName: entry.fileName,
      filePath: entry.filePath,
      taskId: entry.taskId,
      wechatAccountId: entry.wechatAccountId,
      conversationId: entry.conversationId,
      payloadKind: entry.payloadKind,
      actionCount: entry.actionCount,
      createdAt: entry.createdAt,
      modifiedAt: entry.modifiedAt,
      ageSeconds: entry.ageSeconds,
      errorMessage: entry.errorMessage,
      taskStatus: task?.status || null,
      attemptId: attempt?.id || null,
      conversationTitle: task?.conversation?.title || "",
      accountDisplayName: task?.wechatAccount?.displayName || "",
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
      accountDisplayName: task?.wechatAccount?.displayName || target.accountDisplayName || "",
      conversationId: entry?.conversationId || task?.conversationId || target.conversationId || "",
      conversationTitle: task?.conversation?.title || target.conversationTitle || "",
      customerId: task?.conversation?.customerId || target.customerId || "",
      customerName: task?.conversation?.customer?.name || target.customerName || "",
      payloadKind: entry?.payloadKind || sendPlan.kind || task?.payload?.kind || "",
      actionCount: Number.isFinite(Number(entry?.actionCount)) ? Number(entry.actionCount) : actions.length,
      textActionCount: textActions.length,
      imageActionCount: imageActions.length,
      textLength: text.length,
      textPreview: bridgeTextPreview(text),
      imageFileNames: imageActions.map((action: any) => bridgeFileName(action?.filePath)).filter(Boolean).slice(0, 6),
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
      filePath: entry?.filePath || "",
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

  scanBridgeInbox() {
    if (!appConfig.useLocalStore) throw new Error("wechat bridge inbox prisma mode is not implemented yet");
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

      try {
        const result = this.acknowledgeBridgeSend(taskId, {
          status: status as "sent" | "failed",
          version: typeof data.version === "string" ? data.version : undefined,
          protocolVersion: typeof data.protocolVersion === "string" ? data.protocolVersion : undefined,
          ackToken: typeof data.ackToken === "string" ? data.ackToken : undefined,
          bridgeAckToken: typeof data.bridgeAckToken === "string" ? data.bridgeAckToken : undefined,
          attemptId: typeof data.attemptId === "string" ? data.attemptId : undefined,
          wechatAccountId: typeof data.wechatAccountId === "string" ? data.wechatAccountId : undefined,
          conversationId: typeof data.conversationId === "string" ? data.conversationId : undefined,
          outboxFileName: typeof data.outboxFileName === "string" ? data.outboxFileName : undefined,
          outboxFile: typeof data.outboxFile === "string" ? data.outboxFile : undefined,
          errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
          metadata: {
            source: "bridge_inbox",
            fileName: entry.fileName,
            ...(isPlainObject(data.metadata) ? data.metadata : {}),
          },
          sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined,
        });
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
        const archivedPath = this.sendAdapter.moveBridgeInboxFile(entry.filePath, "failed");
        failed.push(this.buildBridgeInboxListItem(entry, { archivedPath, errorMessage }));
      }
    }

    return {
      inboxDir: appConfig.wechatBridgeInboxDir,
      scanned: entries.length,
      processed,
      failed,
    };
  }

  async scanSendOperations() {
    if (!appConfig.useLocalStore) throw new Error("send operation scan prisma mode is not implemented yet");
    const now = new Date();
    const tasks = this.localStore.listSendTasks();
    const bridgeTimedOut: any[] = [];
    const alerted: any[] = [];
    const staleQueued: any[] = [];

    for (const task of tasks) {
      if (task.status === "sending" && this.isBridgeAckTimedOut(task, now)) {
        const reason = `Windows 桥接回执超过 ${appConfig.sendBridgeAckTimeoutMinutes} 分钟未返回`;
        const ack = this.acknowledgeBridgeSend(task.id, {
          status: "failed",
          errorMessage: reason,
          metadata: { source: "send_ops_scan" },
        });
        bridgeTimedOut.push(ack.task);
        await this.notifications.create("warning", "微信桥接回执超时", `${task.conversation?.title || task.conversationId} 的发送任务已转失败，请人工处理。`, {
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

      if (["blocked", "failed"].includes(task.status) && task.guardSnapshot?.opsAlertedStatus !== task.status) {
        this.localStore.updateSendTask(task.id, {
          guardSnapshot: {
            ...(task.guardSnapshot || {}),
            opsAlertedStatus: task.status,
            opsAlertedAt: now.toISOString(),
          },
        });
        await this.notifications.create(
          task.status === "failed" ? "error" : "warning",
          task.status === "failed" ? "发送任务失败" : "发送任务被安全拦截",
          task.errorMessage || "需要客服检查微信窗口、客户会话或桥接状态。",
          {
            sendTaskId: task.id,
            wechatAccountId: task.wechatAccountId,
            conversationId: task.conversationId,
          },
        );
        alerted.push(task);
      }
    }

    return {
      scanned: tasks.length,
      bridgeTimedOut: bridgeTimedOut.length,
      staleQueued: staleQueued.length,
      alerted: alerted.length,
      tasks: {
        bridgeTimedOut,
        staleQueued,
        alerted,
      },
    };
  }

  async processSafeSendQueue(params: { adapter?: string; limit?: number; automationOnly?: boolean } = {}) {
    if (!appConfig.useLocalStore) throw new Error("safe send queue prisma mode is not implemented yet");
    const limit = Math.max(1, Math.min(Number(params.limit || 20), 100));
    const queued = this.localStore
      .listSendTasks()
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

      if (freshTask.conversation?.manualLocked) {
        const advice = buildSendQueueSkipAdvice({
          reason: "conversation_manual_locked",
          task: freshTask,
        });
        const blockedTask = this.blockSendTask(freshTask.id, "会话已人工接管，自动发送暂停", {
          failedKeys: ["conversationManualUnlocked"],
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

      try {
        const result = this.executeSend(freshTask.id, { adapter: params.adapter });
        if (result.task.status === "blocked") blocked.push(result);
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

  createDemoSendTask(payload: { wechatAccountId?: string; conversationId?: string; text?: string }) {
    if (!appConfig.useLocalStore) throw new Error("send task prisma mode is not implemented yet");
    if (!payload.conversationId) {
      throw new BadRequestException("conversationId is required for demo send task");
    }
    const conversations = this.localStore.listConversations(payload.wechatAccountId);
    const conversation = conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) throw new BadRequestException("no local conversation available");
    return this.createLocalSendTask({
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
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

  private createLocalSendTask(payload: any) {
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
    designJobId?: string | null;
    quoteDraftId?: string | null;
  }) {
    const context = await this.loadSendTaskBindingContext(params);
    const designJobId = params.designJobId || context.quoteDraft?.designJobId || undefined;
    const result = validateSendTaskBinding({
      task: {
        ...params,
        designJobId,
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

  private async assertConversationCanQueueSend(conversationId: string) {
    const conversation = appConfig.useLocalStore
      ? this.localStore.listConversations().find((item) => item.id === conversationId)
      : await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new BadRequestException(`conversation not found: ${conversationId}`);
    if (conversation.manualLocked) {
      throw new BadRequestException("会话已人工接管，解除锁定后才能创建新的发送任务。");
    }
  }

  validateSendTask(id: string, params: { mode?: "correct" | "wrong_chat"; activeWindow?: Record<string, unknown> } = {}) {
    if (!appConfig.useLocalStore) throw new Error("send guard prisma mode is not implemented yet");
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);

    const activeWindow = params.activeWindow || this.buildWindowState(task, params.mode || "correct");
    const result = validateSendGuard({
      task,
      account: task.wechatAccount,
      conversation: task.conversation,
      customer: task.conversation?.customer,
      recentMessage: this.localStore.getRecentMessage(task.conversationId),
      activeWindow,
      accountQueueTaskIds: this.localStore.listAccountQueueTaskIds(task.wechatAccountId),
    });

    return this.localStore.updateSendTask(task.id, {
      status: result.ok ? task.status : "blocked",
      errorMessage: result.ok ? "" : result.reason,
      guardSnapshot: {
        ...(task.guardSnapshot || {}),
        ...result,
        activeWindow,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  validateSendTaskWithCurrentWindow(id: string) {
    if (!appConfig.useLocalStore) throw new Error("send guard prisma mode is not implemented yet");
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const latestWindow = this.localStore.getLatestWechatWindowSnapshot(task.wechatAccountId);
    if (!latestWindow) {
      return this.blockSendTask(id, "没有可用的微信窗口快照", {
        status: "blocked",
        failedKeys: ["windowSnapshotMissing"],
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
        windowSnapshotId: latestWindow.id,
      });
    }

    const result = validateSendGuard({
      task,
      account: task.wechatAccount,
      conversation: task.conversation,
      customer: task.conversation?.customer,
      recentMessage: this.localStore.getRecentMessage(task.conversationId),
      activeWindow: latestWindow,
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

  executeDryRunSend(id: string) {
    return this.executeSend(id, { adapter: "dry_run" });
  }

  executeSend(id: string, params: { adapter?: string } = {}) {
    if (!appConfig.useLocalStore) throw new Error("send execution prisma mode is not implemented yet");
    const adapter = this.sendAdapter.describe(params.adapter);
    const validated = this.validateSendTaskWithCurrentWindow(id);
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

    this.localStore.updateSendTask(id, {
      status: "sending",
      errorMessage: "",
    });
    const adapterResult = this.sendAdapter.execute(
      validated,
      { guardStatus, windowSnapshotId, payloadSummary },
      params.adapter,
    );
    const attempt = this.localStore.createSendAttempt({
      sendTaskId: id,
      adapter: adapterResult.adapter,
      status: adapterResult.status,
      guardStatus,
      windowSnapshotId,
      payloadSummary,
      errorMessage: adapterResult.errorMessage || "",
      metadata: {
        adapter,
        ...(adapterResult.metadata || {}),
        guardSnapshot: validated.guardSnapshot || null,
      },
      startedAt,
      completedAt: adapterResult.status === "started" ? null : new Date().toISOString(),
    });
    const taskStatus = adapterResult.status === "failed"
      ? "failed"
      : adapterResult.status === "started"
        ? "sending"
        : adapterResult.status === "dry_run"
          ? "dry_run"
          : "sent";
    const task = this.localStore.updateSendTask(id, {
      status: taskStatus,
      sentAt: taskStatus === "sent" ? new Date().toISOString() : null,
      errorMessage: adapterResult.errorMessage || (taskStatus === "sending" ? "等待 Windows 桥接回执" : ""),
    });
    if (taskStatus === "sent") this.markLinkedQuoteSent(task);
    return { task, attempt, adapter };
  }

  acknowledgeBridgeSend(id: string, payload: {
    status: "sent" | "failed";
    version?: string;
    protocolVersion?: string;
    ackToken?: string;
    bridgeAckToken?: string;
    attemptId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    outboxFileName?: string;
    outboxFile?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
    sentAt?: string;
  }) {
    if (!appConfig.useLocalStore) throw new Error("send bridge ack prisma mode is not implemented yet");
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const status = payload.status === "sent" ? "sent" : "failed";
    const pendingAttempt = this.resolveBridgeAckAttempt(task, payload);
    const binding = validateBridgeAckBinding({ task, attempt: pendingAttempt, payload });
    if (!binding.ok) {
      throw new BadRequestException(`bridge ack binding invalid: ${binding.reason}`);
    }

    const now = new Date().toISOString();
    const outboxFileName = this.resolveBridgeAckOutboxFileName(payload, pendingAttempt);
    const outboxPayloadValidation = status === "sent"
      ? this.validateSentBridgeAckOutboxPayload(task, pendingAttempt, payload, outboxFileName)
      : null;
    const archivedOutboxPath = outboxFileName
      ? this.archiveBridgeOutboxFile(outboxFileName, status === "sent" ? "processed" : "failed")
      : null;
    const attempt = this.localStore.updateSendAttempt(pendingAttempt.id, {
      status,
      errorMessage: payload.errorMessage || "",
      metadata: {
        ...(isPlainObject(pendingAttempt.metadata) ? pendingAttempt.metadata : {}),
        bridgeAck: payload.metadata || {},
        bridgeAckIdentity: {
          wechatAccountId: payload.wechatAccountId || "",
          conversationId: payload.conversationId || "",
        },
        bridgeAckAt: now,
        bridgeAckOutboxFileName: outboxFileName,
        bridgeOutboxPayloadValidation: outboxPayloadValidation
          ? {
              ok: outboxPayloadValidation.ok,
              fileName: outboxFileName,
              checkedAt: now,
            }
          : undefined,
        archivedOutboxPath,
      },
      completedAt: now,
    });
    const sentAt = status === "sent" ? payload.sentAt || now : null;
    const updatedTask = this.localStore.updateSendTask(id, {
      status,
      sentAt,
      errorMessage: status === "failed" ? payload.errorMessage || "Windows 桥接发送失败" : "",
    });
    if (status === "sent") this.markLinkedQuoteSent(updatedTask);
    else this.markLinkedQuoteFailed(updatedTask, payload.errorMessage || "Windows 桥接发送失败");
    return { task: this.localStore.getSendTask(id), attempt, binding };
  }

  requeueSendTask(id: string, payload: { reason?: string } = {}) {
    if (!appConfig.useLocalStore) throw new Error("send task requeue prisma mode is not implemented yet");
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    const decision = evaluateSendTaskRequeue({ task });
    if (!decision.ok) {
      if (decision.reason === "sent_task") throw new BadRequestException("sent task cannot be requeued");
      throw new BadRequestException(decision.message || decision.reason || "send task cannot be requeued");
    }
    const now = new Date().toISOString();
    const updated = this.localStore.updateSendTask(id, {
      status: "queued",
      queuedAt: now,
      sentAt: null,
      errorMessage: "",
      guardSnapshot: {
        requiredChecks: task.guardSnapshot?.requiredChecks || ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
        policy: task.guardSnapshot?.policy || "single-account-serial-queue",
        status: "pending",
        checks: [],
        requeuedAt: now,
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
    });
    this.markLinkedQuoteRequeued(updated, payload.reason || "发送任务已重新排队");
    return updated;
  }

  cancelSendTask(id: string, payload: { reason?: string } = {}) {
    if (!appConfig.useLocalStore) throw new Error("send task cancel prisma mode is not implemented yet");
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    if (task.status === "sent") throw new Error("sent task cannot be cancelled");
    const now = new Date().toISOString();
    const reason = payload.reason || "人工取消发送任务";
    const pendingBridgeAttempt = this.localStore.getLatestSendAttempt(id, {
      adapter: "windows_bridge",
      status: "started",
    });
    if (pendingBridgeAttempt) {
      const outboxFileName = this.resolveBridgeAckOutboxFileName({}, pendingBridgeAttempt);
      const archivedOutboxPath = outboxFileName
        ? this.archiveBridgeOutboxFile(outboxFileName, "cancelled")
        : null;
      this.localStore.updateSendAttempt(pendingBridgeAttempt.id, {
        status: "failed",
        errorMessage: reason,
        metadata: {
          cancelledAt: now,
          cancelReason: reason,
          bridgeAckOutboxFileName: outboxFileName,
          archivedOutboxPath,
        },
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
        history: [
          ...this.guardHistory(task),
          {
            action: "cancel",
            fromStatus: task.status,
            reason,
            at: now,
          },
        ],
      },
    });
    this.markLinkedQuoteFailed(updated, reason);
    return updated;
  }

  private blockSendTask(id: string, reason: string, guardSnapshot: Record<string, unknown>) {
    const task = this.localStore.getSendTask(id);
    if (!task) throw new Error(`send task not found: ${id}`);
    return this.localStore.updateSendTask(id, {
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

  private resolveInboundConversation(payload: { wechatAccountId?: string; conversationId?: string }) {
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
    return conversation;
  }

  private findLatestSceneClarification(conversationId: string) {
    return findPendingSceneClarificationContext(this.localStore.listRouteEvaluations(), conversationId);
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
    conversation: any;
    route: any;
    assetIds: string[];
    bundleRecommendation: any;
    customerText: string;
  }) {
    const giftBox = params.bundleRecommendation?.items?.find((item: any) => item.type === "gift_box") || null;
    const job = this.localStore.createDesignJob({
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
        warnings: params.bundleRecommendation?.warnings || [],
      },
      assetIds: params.assetIds,
      assets: params.assetIds.map((assetId) => ({ assetId, type: "customer_asset" })),
      requirements: {
        useRealSkuImages: true,
        showAllItems: true,
        noWatermark: true,
        highResolution: true,
      },
      status: "draft",
    });
    return job;
  }

  private async handleInboundImageSelection(params: {
    conversation: any;
    message: any;
    route: any;
    payload: {
      text?: string;
      attachments?: Array<Record<string, unknown>>;
    };
  }) {
    const job = this.findLatestSelectableDesignJob(params.conversation.id);
    const candidates = job ? [...(job.images || [])].sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0)) : [];
    const selectionPlan = planCustomerImageSelection({
      ...this.buildInboundSelectionInput(params.payload),
      candidates,
    });

    if (selectionPlan.action === "skip") return null;

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
        reason: "selection_without_active_design_job",
        title: "客户疑似选图但没有可匹配设计任务",
        body: "客户消息像是在选择效果图，但当前会话没有已发送的候选图，需要人工确认。",
      });
      return result;
    }

    if (!selectionPlan.ok || selectionPlan.reviewRequired || !selectionPlan.result?.candidate) {
      result.notification = await this.createInboundSelectionReview(params.conversation, params.route, {
        reason: selectionPlan.reason || "selection_uncertain",
        title: "客户选图需要人工确认",
        body: "客户表达了选图意图，但系统没有高置信匹配到具体候选图。",
        designJobId: job.id,
      });
      return result;
    }

    const selectedImageId = selectionPlan.result.candidate.id || selectionPlan.result.candidate.imageId;
    const feedback = this.inboundSelectionFeedback(params.payload, selectionPlan.result);
    this.localStore.selectDesignImage(job.id, selectedImageId, feedback);

    if (this.shouldManualReviewSelectedJob(job)) {
      const updated = this.localStore.updateDesignJob(job.id, {
        status: "manual_review",
        manualQcRequired: true,
      });
      result.manualLock = await this.lockConversationForManualReview(params.conversation, {
        reviewer: "system",
        reason: "high_value_customer_selected_image",
      });
      this.localStore.createReviewLog({
        targetType: "design_job",
        targetId: job.id,
        decision: "high_value_customer_selected_image",
        reviewer: "system",
        note: "High-value customer selected a design image; manual quote review is required.",
        beforeStatus: job.status || "",
        afterStatus: "manual_review",
        metadata: {
          source: "inbound_image_selection",
          selectedImageId,
          routeId: params.route.id,
          conversationId: params.conversation.id,
          blockedSendTaskIds: result.manualLock.blockedSendTasks.map((task: any) => task.id),
          inFlightSendTaskIds: result.manualLock.inFlightSendTasks.map((task: any) => task.id),
        },
      });
      result.designJob = updated;
      result.notification = await this.notifications.create(
        "warning",
        "高价值客户已选图，转人工报价",
        "客户已明确选择效果图，请人工确认报价、交期和后续跟进。",
        {
          designJobId: job.id,
          selectedImageId,
          conversationId: params.conversation.id,
          customerId: params.conversation.customerId,
          blockedSendTaskIds: result.manualLock.blockedSendTasks.map((task: any) => task.id),
          inFlightSendTaskIds: result.manualLock.inFlightSendTasks.map((task: any) => task.id),
        },
      );
      result.plan.shouldNotifyHuman = true;
      result.plan.reason = "high_value_customer_selected_image";
      return result;
    }

    const existingQuote = this.localStore
      .listQuoteDrafts()
      .find((quote: any) => quote.designJobId === job.id);
    if (existingQuote?.sendTaskId || existingQuote?.status === "sent") {
      result.notification = await this.createInboundSelectionReview(params.conversation, params.route, {
        reason: "quote_already_queued_or_sent",
        title: "客户在报价后再次选图",
        body: "该设计任务已有报价发送记录，客户再次选图需要人工确认是否改报价。",
        designJobId: job.id,
        selectedImageId,
      });
      result.plan.reason = "quote_already_queued_or_sent";
      return result;
    }

    const quote = existingQuote
      ? this.localStore.updateQuoteDraft(existingQuote.id, {
          selectedImageId,
          status: "auto_sent",
          customerNotes: "Customer selected a design image from inbound message.",
        })
      : this.localStore.createQuoteFromDesignJob(job.id, selectedImageId);
    const updatedJob = this.localStore.updateDesignJob(job.id, { status: "quote_created" });
    result.quote = quote;
    result.designJob = updatedJob;
    result.plan = {
      ...result.plan,
      type: "select_design_image_and_create_quote",
      reason: "low_value_customer_selected_image",
      shouldNotifyHuman: false,
    };
    result.notification = await this.notifications.create(
      "info",
      "低价值客户已选图，已生成报价草稿",
      "客户选图置信度高，系统已绑定候选图并生成报价草稿，后台低价值自动化会继续处理报价发送队列。",
      {
        designJobId: job.id,
        quoteDraftId: quote.id,
        selectedImageId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
      },
    );
    return result;
  }

  private async handleInboundQuoteAcceptance(params: {
    conversation: any;
    message: any;
    route: any;
    payload: { text?: string };
  }) {
    const quote = this.findLatestQuoteForConversation(params.conversation.id);
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

    if (acceptancePlan.reason === "no_quote_acceptance_intent") return null;
    if (!quote && acceptancePlan.reason === "missing_active_quote") return null;

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
      result.notification = await this.createInboundQuoteReview(params.conversation, params.route, quote, {
        reason: acceptancePlan.reason,
        title: "客户疑似确认报价，需要人工核查",
        body: "客户消息像是在确认报价或付款，但当前报价状态不适合自动成单，需要人工确认。",
      });
      return result;
    }

    const updatedQuote = this.localStore.updateQuoteDraft(quote.id, acceptancePlan.quotePatch);
    result.quote = updatedQuote;
    result.orderDraft = await this.orders.createFromQuote(updatedQuote.id);
    const confirmation = await this.queueOrderConfirmation(result.orderDraft.id, {
      owner: "low_value_automation",
      note: "低价值客户确认后，订单确认已自动进入微信安全发送队列。",
      reason: "low_value_order_confirmation",
      automation: {
        source: "low_value_quote_acceptance",
        valueLevel: "low",
        reason: acceptancePlan.reason,
        quoteDraftId: updatedQuote.id,
        orderDraftId: result.orderDraft.id,
        queuedBy: "low_value_automation",
      },
    });
    result.orderDraft = confirmation.orderDraft;
    result.sendTask = confirmation.sendTask;
    result.plan.shouldQueueReply = true;
    result.notification = await this.notifications.create(
      "info",
      acceptancePlan.quotePatch.paymentStatus === "paid" || acceptancePlan.quotePatch.paymentStatus === "deposit_paid"
        ? "低价值客户已确认付款，订单草稿已生成"
        : "低价值客户已确认报价，订单草稿已生成",
      "系统已根据客户确认消息更新报价、生成订单草稿，并把确认回复放入微信安全发送队列。",
      {
        quoteDraftId: updatedQuote.id,
        orderDraftId: result.orderDraft.id,
        sendTaskId: result.sendTask.id,
        designJobId: updatedQuote.designJobId,
        conversationId: params.conversation.id,
        customerId: params.conversation.customerId,
        routeId: params.route.id,
        reason: acceptancePlan.reason,
      },
    );
    return result;
  }

  private findLatestQuoteForConversation(conversationId: string) {
    return this.localStore
      .listQuoteDrafts()
      .find((quote: any) => quote.designJob?.conversationId === conversationId && quote.selectedImageId);
  }

  private async createInboundQuoteReview(
    conversation: any,
    route: any,
    quote: any,
    options: {
      reason: string;
      title: string;
      body: string;
    },
  ) {
    const manualLock = await this.lockConversationForManualReview(conversation, {
      reviewer: "system",
      reason: options.reason,
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
        source: "inbound_quote_acceptance",
        routeId: route.id,
        conversationId: conversation.id,
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
      quoteDraftId: quote?.id,
      designJobId: quote?.designJobId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      routeId: route.id,
      reason: options.reason,
      blockedSendTaskIds: manualLock.blockedSendTasks.map((task: any) => task.id),
      inFlightSendTaskIds: manualLock.inFlightSendTasks.map((task: any) => task.id),
      },
    );
  }

  private findLatestSelectableDesignJob(conversationId: string) {
    const selectableStatuses = new Set(["sent"]);
    return this.localStore
      .listDesignJobs()
      .filter((job: any) => job.conversationId === conversationId)
      .filter((job: any) => selectableStatuses.has(job.status))
      .filter((job: any) => Array.isArray(job.images) && job.images.length > 0)[0] || null;
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

  private shouldManualReviewSelectedJob(job: any) {
    if (job.isHighValue) return true;
    const threshold = Number(appConfig.highValueAmountCny || 10000);
    const budget = job.budget || {};
    const amount = Number(budget.amount || 0);
    const quantity = Math.max(1, Number(budget.quantity || 1));
    const total = budget.mode === "total" ? amount : amount * quantity;
    return amount >= threshold || total >= threshold;
  }

  private async createInboundSelectionReview(
    conversation: any,
    route: any,
    options: {
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
        source: "inbound_image_selection",
        routeId: route.id,
        conversationId: conversation.id,
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
      designJobId: options.designJobId,
      selectedImageId: options.selectedImageId,
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
    options: { reviewer?: string; reason?: string } = {},
  ) {
    const manualLock = await this.setConversationManualLock(conversation.id, {
      locked: true,
      reviewer: options.reviewer || "system",
      reason: options.reason || "manual_review",
      note: "Manual review is required; automation and queued sends are paused for this conversation.",
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
        .filter((task) => task.conversationId === conversation.id && task.status === "queued");
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

  private listInFlightSendTasksForConversation(conversationId: string) {
    if (!appConfig.useLocalStore) return [];
    return this.localStore
      .listSendTasks()
      .filter((task) => task.conversationId === conversationId && task.status === "sending");
  }

  private cancelInFlightSendTasksForManualLock(conversationId: string, reviewer: string) {
    if (!appConfig.useLocalStore) return [];
    const reason = `会话已人工接管，发送中任务已取消，避免自动内容继续发送。操作人：${reviewer}`;
    return this.listInFlightSendTasksForConversation(conversationId).map((task) =>
      this.cancelSendTask(task.id, { reason }),
    );
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

  private markLinkedQuoteSent(task: any) {
    const quoteDraftId = task?.quoteDraftId || task?.payload?.quoteDraftId;
    if (!quoteDraftId) return;
    if (appConfig.useLocalStore) {
      this.localStore.updateQuoteDraft(quoteDraftId, {
        status: "sent",
        customerNotes: "报价已通过微信发送安全流程。",
      });
      return;
    }
    void (this.prisma as any).quoteDraft.update({
      where: { id: quoteDraftId },
      data: {
        status: "sent",
        customerNotes: "报价已通过微信发送安全流程。",
      },
    });
  }

  private markLinkedQuoteFailed(task: any, reason: string) {
    const quoteDraftId = task?.quoteDraftId || task?.payload?.quoteDraftId;
    if (!quoteDraftId) return;
    if (appConfig.useLocalStore) {
      this.localStore.updateQuoteDraft(quoteDraftId, {
        status: "manual_review",
        customerNotes: `报价发送失败，需要人工处理：${reason}`,
      });
    }
  }

  private markLinkedQuoteRequeued(task: any, reason: string) {
    const quoteDraftId = task?.quoteDraftId || task?.payload?.quoteDraftId;
    if (!quoteDraftId) return;
    if (appConfig.useLocalStore) {
      this.localStore.updateQuoteDraft(quoteDraftId, {
        status: "send_queued",
        customerNotes: reason,
      });
    }
  }

  private guardHistory(task: any) {
    const history = task?.guardSnapshot?.history;
    return Array.isArray(history) ? history.slice(-20) : [];
  }

  private isBridgeAckTimedOut(task: any, now: Date) {
    const latestAttempt = task.latestAttempt || task.attempts?.[0];
    return latestAttempt?.adapter === "windows_bridge" &&
      latestAttempt.status === "started" &&
      isOlderThan(latestAttempt.startedAt || latestAttempt.createdAt, now, appConfig.sendBridgeAckTimeoutMinutes);
  }

  private validateSentBridgeAckOutboxPayload(task: any, attempt: any, payload: any, outboxFileName: string) {
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
    const guardSnapshot = isPlainObject(data.guardSnapshot) ? data.guardSnapshot : {};
    const context = isPlainObject(data.context) ? data.context : {};
    const guardPassed = guardSnapshot.status === "passed" || guardSnapshot.ok === true || context.guardStatus === "passed";
    const outboxAckToken = typeof data.ackToken === "string" ? data.ackToken : "";
    const ackToken = typeof payload?.ackToken === "string"
      ? payload.ackToken
      : typeof payload?.bridgeAckToken === "string"
        ? payload.bridgeAckToken
        : "";

    const checks = [
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
          String(target.conversationId || "") === String(task?.conversationId || ""),
      },
      {
        key: "sendPlanTargetIdentity",
        passed:
          String(sendPlanTarget.wechatAccountId || "") === String(task?.wechatAccountId || "") &&
          String(sendPlanTarget.conversationId || "") === String(task?.conversationId || ""),
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
        key: "sendPlanConstraints",
        passed:
          constraints.singleAccountLock === true &&
          constraints.requireActiveWindowMatch === true &&
          constraints.requireRecentCustomerMatch === true &&
          constraints.doNotMarkSentWithoutAck === true,
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

  private resolveBridgeAckAttempt(task: any, payload: { attemptId?: string }) {
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

  private buildWindowState(task: any, mode: "correct" | "wrong_chat") {
    if (mode === "wrong_chat") {
      const otherConversation = this.localStore
        .listConversations()
        .find((conversation) => conversation.id !== task.conversationId);
      return {
        wechatAccountId: task.wechatAccountId,
        chatTitle: otherConversation?.title || "错误客户会话",
        recentCustomerId: otherConversation?.customerId || "wrong_customer",
      };
    }

    return {
      wechatAccountId: task.wechatAccountId,
      chatTitle: task.conversation?.title || "",
      recentCustomerId: task.conversation?.customerId || "",
    };
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

function isOlderThan(value: unknown, now: Date, minutes: number) {
  const time = new Date(String(value || ""));
  if (Number.isNaN(time.getTime())) return false;
  return now.getTime() - time.getTime() > minutes * 60 * 1000;
}

function bridgeFileName(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/[\\/]/).filter(Boolean).pop() || "";
}

function bridgeTextPreview(value: unknown) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function readJsonFile(filePath: string) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function normalizeWindowSnapshotInboxPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isPlainObject(data) && Array.isArray(data.snapshots)) return data.snapshots;
  return [data];
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

function isLowValueAutomationTask(task: any) {
  const automation = task?.guardSnapshot?.automation || {};
  if (automation.valueLevel !== "low") return false;
  if (task?.designJob?.isHighValue === true) return false;
  if (task?.quoteDraft?.designJob?.isHighValue === true) return false;
  return true;
}
