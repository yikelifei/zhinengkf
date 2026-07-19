import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

const taskInclude = {
  wechatAccount: true,
  conversation: { include: { customer: true, wechatAccount: true } },
  designJob: true,
  attempts: { orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }] },
} as const;

const attemptInclude = {
  sendTask: {
    include: {
      wechatAccount: true,
      conversation: { include: { customer: true, wechatAccount: true } },
    },
  },
  windowSnapshot: true,
} as const;

/**
 * Keeps the existing local-json contract while making the same WeChat records
 * durable in PostgreSQL. Business validation remains in WechatDispatchService;
 * this class owns persistence, hydration and short database transactions only.
 */
export class WechatPersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
  ) {}

  get isLocal() {
    return appConfig.useLocalStore;
  }

  async listAccounts() {
    if (this.isLocal) return this.localStore.listWechatAccounts();
    return this.prisma.wechatAccount.findMany({ orderBy: [{ displayName: "asc" }, { id: "asc" }] });
  }

  async listCustomers() {
    if (this.isLocal) {
      const conversations = this.localStore.listConversations();
      const customers = conversations
        .map((item: any) => item.customer)
        .filter((item: any) => Boolean(item?.id));
      return [...new Map<string, any>(customers.map((item: any) => [item.id, item] as [string, any])).values()];
    }
    return this.prisma.customer.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
  }

  async listConversations(wechatAccountId?: string) {
    if (this.isLocal) return this.localStore.listConversations(wechatAccountId);
    return this.prisma.conversation.findMany({
      where: wechatAccountId ? { wechatAccountId } : undefined,
      include: { customer: true, wechatAccount: true },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    });
  }

  async getConversation(id: string) {
    if (this.isLocal) return this.localStore.listConversations().find((item: any) => item.id === id) || null;
    return this.prisma.conversation.findUnique({
      where: { id },
      include: { customer: true, wechatAccount: true },
    });
  }

  async updateConversation(id: string, patch: Record<string, unknown>) {
    if (this.isLocal) return this.localStore.updateConversation(id, patch);
    return this.prisma.conversation.update({
      where: { id },
      data: patch as Prisma.ConversationUpdateInput,
      include: { customer: true, wechatAccount: true },
    });
  }

  async createMessage(payload: any) {
    if (this.isLocal) return this.localStore.createMessage(payload);
    const prisma = this.prisma as any;
    try {
      return await prisma.$transaction(async (tx: any) => {
        const conversation = await tx.conversation.findUnique({
          where: { id: payload.conversationId },
          include: { customer: true, wechatAccount: true },
        });
        if (!conversation) throw new BadRequestException(`conversation not found: ${payload.conversationId}`);
        if (payload.wechatAccountId && payload.wechatAccountId !== conversation.wechatAccountId) {
          throw new BadRequestException("message conversation binding invalid: wechat account does not match conversation");
        }
        if (payload.customerId && payload.customerId !== conversation.customerId) {
          throw new BadRequestException("message customer binding invalid: customer does not match conversation");
        }

        if (payload.externalId) {
          const existing = await tx.message.findUnique({
            where: {
              conversationId_externalId: {
                conversationId: conversation.id,
                externalId: payload.externalId,
              },
            },
          });
          if (existing) return { ...this.hydrateMessage(existing, conversation), deduplicated: true };
        }

        const now = payload.createdAt ? new Date(payload.createdAt) : new Date();
        const message = await tx.message.create({
          data: {
            ...(payload.id ? { id: payload.id } : {}),
            conversationId: conversation.id,
            direction: payload.direction || "inbound",
            text: payload.text || "",
            attachments: this.jsonOrNull(payload.attachments || []),
            metadata: this.jsonOrNull(payload.metadata || {}),
            externalId: payload.externalId || null,
            createdAt: now,
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now },
        });
        return this.hydrateMessage(message, conversation);
      });
    } catch (error: any) {
      if (payload.externalId && error?.code === "P2002") {
        const existing = await prisma.message.findUnique({
          where: {
            conversationId_externalId: {
              conversationId: payload.conversationId,
              externalId: payload.externalId,
            },
          },
        });
        const conversation = await this.getConversation(payload.conversationId);
        if (existing && conversation) return { ...this.hydrateMessage(existing, conversation), deduplicated: true };
      }
      throw error;
    }
  }

  async getRecentMessage(conversationId: string) {
    if (this.isLocal) return this.localStore.getRecentMessage(conversationId);
    const message = await this.prisma.message.findFirst({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!message) return null;
    const conversation = await this.getConversation(conversationId);
    return this.hydrateMessage(message, conversation);
  }

  async listConversationTimeline(filter: IdentityFilter & { limit?: number }) {
    if (this.isLocal) return this.localStore.listConversationTimeline(filter as any);
    const conversation = await this.requireConversationIdentity(filter, "message history");
    const limit = Math.max(1, Math.min(Number(filter.limit || 300), 500));
    const [messages, tasks] = await Promise.all([
      (this.prisma as any).message.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      (this.prisma as any).wechatSendTask.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ queuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
    ]);
    return [
      ...messages.map((message: any) => ({
        ...message,
        source: "message",
        customerId: conversation.customerId,
        wechatAccountId: conversation.wechatAccountId,
        status: message.direction === "inbound" ? (message.readAt ? "read" : "unread") : "sent",
        attachments: this.timelineAttachments(message.attachments, message.readAt ? "read" : "received"),
      })),
      ...tasks.map((task: any) => ({
        id: `send-task:${task.id}`,
        source: "send_task",
        sendTaskId: task.id,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        wechatAccountId: conversation.wechatAccountId,
        direction: "outbound",
        text: String(task.payload?.text || task.payload?.textBeforeImages || ""),
        attachments: this.timelineAttachments(
          Array.isArray(task.payload?.imagePaths)
            ? task.payload.imagePaths.map((localPath: string) => ({ localPath, kind: "image" }))
            : [],
          task.status || "queued",
        ),
        status: task.status || "queued",
        errorMessage: task.errorMessage || "",
        createdAt: task.queuedAt || task.createdAt,
        updatedAt: task.updatedAt || task.createdAt,
        sentAt: task.sentAt || null,
        metadata: { kind: task.payload?.kind || "text", manualReply: task.payload?.source === "manual_reply" },
      })),
    ]
      .sort((left: any, right: any) => {
        const byTime = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
        return byTime || String(left.id || "").localeCompare(String(right.id || ""));
      })
      .slice(-limit);
  }

  async markConversationMessagesRead(filter: IdentityFilter) {
    if (this.isLocal) return this.localStore.markConversationMessagesRead(filter as any);
    const conversation = await this.requireConversationIdentity(filter, "mark messages read");
    const readAt = new Date();
    const updated = await (this.prisma as any).message.updateMany({
      where: { conversationId: conversation.id, direction: "inbound", readAt: null },
      data: { readAt },
    });
    return {
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      updatedCount: updated.count,
      readAt: readAt.toISOString(),
    };
  }

  async listWindowSnapshots(filter: IdentityFilter & { limit?: number } = {}) {
    if (this.isLocal) return this.localStore.listWechatWindowSnapshots(filter);
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 300));
    const snapshots = await this.prisma.wechatWindowSnapshot.findMany({
      where: {
        ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
        ...(filter.customerId ? { recentCustomerId: filter.customerId } : {}),
        ...(filter.conversationId
          ? { activeConversationId: filter.conversationId }
          : {}),
      },
      include: {
        wechatAccount: true,
        activeConversation: { include: { customer: true, wechatAccount: true } },
      },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return snapshots.map((snapshot: any) => this.normalizeSnapshot(snapshot));
  }

  async getLatestWindowSnapshot(wechatAccountId?: string) {
    if (this.isLocal) return this.localStore.getLatestWechatWindowSnapshot(wechatAccountId);
    const snapshot = await this.prisma.wechatWindowSnapshot.findFirst({
      where: wechatAccountId ? { wechatAccountId } : undefined,
      include: {
        wechatAccount: true,
        activeConversation: { include: { customer: true, wechatAccount: true } },
      },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return snapshot ? this.normalizeSnapshot(snapshot) : null;
  }

  async createWindowSnapshot(payload: any) {
    if (this.isLocal) return this.localStore.createWechatWindowSnapshot(payload);
    const activeConversationId = payload.activeConversationId || payload.diagnostic?.activeConversationId || null;
    const snapshot = await this.prisma.wechatWindowSnapshot.create({
      data: {
        ...(payload.id ? { id: payload.id } : {}),
        source: payload.source || "api",
        isOnline: payload.isOnline !== false,
        wechatAccountId: payload.wechatAccountId || null,
        activeConversationId,
        accountDisplayName: payload.accountDisplayName || null,
        windowHandle: payload.windowHandle || null,
        processId: this.integerOrNull(payload.processId),
        chatTitle: payload.chatTitle || null,
        activeChatTitle: payload.activeChatTitle || payload.chatTitle || null,
        externalChatId: payload.externalChatId || null,
        recentCustomerId: payload.recentCustomerId || null,
        recentMessageText: payload.recentMessageText || null,
        confidence: this.decimalOrNull(payload.confidence),
        diagnostic: this.jsonOrNull(payload.diagnostic),
        raw: this.jsonOrNull(payload.raw || payload),
        capturedAt: payload.capturedAt ? new Date(payload.capturedAt) : new Date(),
        ...(payload.createdAt ? { createdAt: new Date(payload.createdAt) } : {}),
      } as any,
      include: {
        wechatAccount: true,
        activeConversation: { include: { customer: true, wechatAccount: true } },
      },
    });
    return this.normalizeSnapshot(snapshot);
  }

  async listSendTasks(filter: IdentityFilter = {}) {
    if (this.isLocal) return this.localStore.listSendTasks(filter);
    const tasks = await (this.prisma as any).wechatSendTask.findMany({
      where: this.taskWhere(filter),
      include: taskInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return this.attachQuotes(tasks);
  }

  async getSendTask(id: string) {
    if (this.isLocal) return this.localStore.getSendTask(id);
    const task = await (this.prisma as any).wechatSendTask.findUnique({ where: { id }, include: taskInclude });
    if (!task) return null;
    return (await this.attachQuotes([task]))[0];
  }

  async createSendTask(payload: any) {
    if (this.isLocal) return this.localStore.createSendTask(payload);
    const task = await (this.prisma as any).wechatSendTask.create({
      data: {
        ...(payload.id ? { id: payload.id } : {}),
        status: payload.status || "queued",
        wechatAccountId: payload.wechatAccountId,
        conversationId: payload.conversationId,
        designJobId: payload.designJobId || null,
        quoteDraftId: payload.quoteDraftId || null,
        payload: payload.payload || {},
        guardSnapshot: payload.guardSnapshot || { status: "pending", checks: [] },
        errorMessage: payload.errorMessage || null,
        queuedAt: payload.queuedAt ? new Date(payload.queuedAt) : new Date(),
        sentAt: payload.sentAt ? new Date(payload.sentAt) : null,
        ...(payload.createdAt ? { createdAt: new Date(payload.createdAt) } : {}),
      },
      include: taskInclude,
    });
    return (await this.attachQuotes([task]))[0];
  }

  async updateSendTask(id: string, patch: any) {
    if (this.isLocal) return this.localStore.updateSendTask(id, patch);
    const data = this.sendTaskPatch(patch);
    const task = await (this.prisma as any).wechatSendTask.update({
      where: { id },
      data,
      include: taskInclude,
    });
    return (await this.attachQuotes([task]))[0];
  }

  async listSendAttempts(filter: { sendTaskId?: string; limit?: number } & IdentityFilter = {}) {
    if (this.isLocal) return this.localStore.listSendAttempts(filter);
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 300));
    const attempts = await (this.prisma as any).wechatSendAttempt.findMany({
      where: {
        ...(filter.sendTaskId ? { sendTaskId: filter.sendTaskId } : {}),
        ...(filter.wechatAccountId || filter.conversationId || filter.customerId
          ? { sendTask: this.taskWhere(filter) }
          : {}),
      },
      include: attemptInclude,
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return attempts.map((attempt: any) => this.hydrateAttempt(attempt));
  }

  async getLatestSendAttempt(sendTaskId: string, filter: { adapter?: string; status?: string } = {}) {
    if (this.isLocal) return this.localStore.getLatestSendAttempt(sendTaskId, filter);
    const attempt = await (this.prisma as any).wechatSendAttempt.findFirst({
      where: {
        sendTaskId,
        ...(filter.adapter ? { adapter: filter.adapter } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: attemptInclude,
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return attempt ? this.hydrateAttempt(attempt) : null;
  }

  async createSendAttempt(payload: any) {
    if (this.isLocal) return this.localStore.createSendAttempt(payload);
    const attempt = await (this.prisma as any).wechatSendAttempt.create({
      data: {
        ...(payload.id ? { id: payload.id } : {}),
        sendTaskId: payload.sendTaskId,
        adapter: payload.adapter || "dry_run",
        status: payload.status || "started",
        guardStatus: payload.guardStatus || null,
        windowSnapshotId: payload.windowSnapshotId || null,
        payloadSummary: payload.payloadSummary || {},
        errorMessage: payload.errorMessage || null,
        metadata: payload.metadata || {},
        startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
        completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
        ...(payload.createdAt ? { createdAt: new Date(payload.createdAt) } : {}),
      },
      include: attemptInclude,
    });
    return this.hydrateAttempt(attempt);
  }

  async updateSendAttempt(id: string, patch: any) {
    if (this.isLocal) return this.localStore.updateSendAttempt(id, patch);
    const current = await (this.prisma as any).wechatSendAttempt.findUnique({ where: { id } });
    if (!current) throw new Error(`send attempt not found: ${id}`);
    const metadata = patch.metadata
      ? { ...(current.metadata && typeof current.metadata === "object" ? current.metadata : {}), ...patch.metadata }
      : undefined;
    const attempt = await (this.prisma as any).wechatSendAttempt.update({
      where: { id },
      data: {
        ...patch,
        ...(metadata ? { metadata } : {}),
        ...(patch.startedAt ? { startedAt: new Date(patch.startedAt) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "completedAt")
          ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null }
          : {}),
      },
      include: attemptInclude,
    });
    return this.hydrateAttempt(attempt);
  }

  async completeAttemptAndTask(params: {
    taskId: string;
    attemptId: string;
    taskPatch: any;
    attemptPatch: any;
    expectedTaskStatus?: string;
  }) {
    if (this.isLocal) {
      const attempt = this.localStore.updateSendAttempt(params.attemptId, params.attemptPatch);
      const task = this.localStore.updateSendTask(params.taskId, params.taskPatch);
      return { task, attempt };
    }
    const prisma = this.prisma as any;
    const completed = await prisma.$transaction(async (tx: any) => {
      if (params.expectedTaskStatus) {
        const claimed = await tx.wechatSendTask.updateMany({
          where: { id: params.taskId, status: params.expectedTaskStatus },
          data: this.sendTaskPatch(params.taskPatch),
        });
        if (claimed.count !== 1) return false;
      } else {
        await tx.wechatSendTask.update({
          where: { id: params.taskId },
          data: this.sendTaskPatch(params.taskPatch),
        });
      }
      await tx.wechatSendAttempt.update({
        where: { id: params.attemptId },
        data: {
          ...params.attemptPatch,
          ...(params.attemptPatch.completedAt
            ? { completedAt: new Date(params.attemptPatch.completedAt) }
            : {}),
        },
      });
      return true;
    });
    if (!completed) return null;
    return {
      task: await this.getSendTask(params.taskId),
      attempt: await (this.prisma as any).wechatSendAttempt.findUnique({
        where: { id: params.attemptId },
        include: attemptInclude,
      }),
    };
  }

  async claimQueuedTaskAndCreateAttempt(params: {
    taskId: string;
    taskPatch: any;
    attempt: any;
  }) {
    if (this.isLocal) {
      const task = this.localStore.getSendTask(params.taskId);
      if (!task || task.status !== "queued") return null;
      const updatedTask = this.localStore.updateSendTask(params.taskId, params.taskPatch);
      const attempt = this.localStore.createSendAttempt(params.attempt);
      return { task: updatedTask, attempt };
    }
    const prisma = this.prisma as any;
    const result = await prisma.$transaction(async (tx: any) => {
      const claimed = await tx.wechatSendTask.updateMany({
        where: { id: params.taskId, status: "queued" },
        data: this.sendTaskPatch(params.taskPatch),
      });
      if (claimed.count !== 1) return null;
      const attempt = await tx.wechatSendAttempt.create({
        data: {
          sendTaskId: params.taskId,
          adapter: params.attempt.adapter,
          status: params.attempt.status || "started",
          guardStatus: params.attempt.guardStatus || null,
          windowSnapshotId: params.attempt.windowSnapshotId || null,
          payloadSummary: params.attempt.payloadSummary || {},
          errorMessage: params.attempt.errorMessage || null,
          metadata: params.attempt.metadata || {},
          startedAt: params.attempt.startedAt ? new Date(params.attempt.startedAt) : new Date(),
        },
      });
      return { attemptId: attempt.id };
    });
    if (!result) return null;
    return {
      task: await this.getSendTask(params.taskId),
      attempt: await (this.prisma as any).wechatSendAttempt.findUnique({
        where: { id: result.attemptId },
        include: attemptInclude,
      }),
    };
  }

  async cancelTaskAndAttempt(params: {
    taskId: string;
    expectedTaskStatus: string;
    taskPatch: any;
    attemptId?: string;
    attemptPatch?: any;
  }) {
    if (this.isLocal) {
      const current = this.localStore.getSendTask(params.taskId);
      if (!current || current.status !== params.expectedTaskStatus) return null;
      const attempt = params.attemptId && params.attemptPatch
        ? this.localStore.updateSendAttempt(params.attemptId, params.attemptPatch)
        : null;
      const task = this.localStore.updateSendTask(params.taskId, params.taskPatch);
      return { task, attempt };
    }
    const prisma = this.prisma as any;
    const completed = await prisma.$transaction(async (tx: any) => {
      const claimed = await tx.wechatSendTask.updateMany({
        where: { id: params.taskId, status: params.expectedTaskStatus },
        data: this.sendTaskPatch(params.taskPatch),
      });
      if (claimed.count !== 1) return false;
      if (params.attemptId && params.attemptPatch) {
        await tx.wechatSendAttempt.update({
          where: { id: params.attemptId },
          data: {
            ...params.attemptPatch,
            ...(params.attemptPatch.completedAt
              ? { completedAt: new Date(params.attemptPatch.completedAt) }
              : {}),
          },
        });
      }
      return true;
    });
    if (!completed) return null;
    return {
      task: await this.getSendTask(params.taskId),
      attempt: params.attemptId
        ? await prisma.wechatSendAttempt.findUnique({ where: { id: params.attemptId }, include: attemptInclude })
        : null,
    };
  }

  async listAccountQueueTaskIds(wechatAccountId: string) {
    if (this.isLocal) return this.localStore.listAccountQueueTaskIds(wechatAccountId);
    const tasks = await this.prisma.wechatSendTask.findMany({
      where: { wechatAccountId, status: { in: ["queued", "sending"] } },
      select: { id: true },
      orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return tasks.map((task) => task.id);
  }

  async countWechatWorkBindings() {
    if (this.isLocal) {
      const bindings = this.localStore
        .listWechatAccounts()
        .filter((item: any) => item.platform === "wechat_work_kf");
      return bindings.length;
    }
    const rows = await (this.prisma as any).wechatWorkBinding.findMany({
      select: { wechatAccountId: true },
      distinct: ["wechatAccountId"],
    });
    return rows.length;
  }

  async upsertWechatWorkBinding(payload: { openKfid: string; externalUserId: string; sendTime?: number }) {
    if (this.isLocal) return this.localStore.upsertWechatWorkBinding(payload);
    const openKfid = String(payload.openKfid || "").trim();
    const externalUserId = String(payload.externalUserId || "").trim();
    if (!openKfid || !externalUserId) {
      throw new BadRequestException("wechat work binding requires openKfid and externalUserId");
    }
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const existing = await tx.wechatWorkBinding.findUnique({
        where: { openKfid_externalUserId: { openKfid, externalUserId } },
        include: { wechatAccount: true, customer: true, conversation: true },
      });
      const accountSource = existing || await tx.wechatWorkBinding.findFirst({
        where: { openKfid },
        include: { wechatAccount: true },
      });
      const customerSource = existing || await tx.wechatWorkBinding.findFirst({
        where: { externalUserId },
        include: { customer: true },
      });
      const account = accountSource?.wechatAccount || await tx.wechatAccount.create({
        data: {
          displayName: `企业微信客服 ${shortExternalId(openKfid)}`,
          alias: shortExternalId(openKfid),
          isActive: true,
        },
      });
      const customer = customerSource?.customer || await tx.customer.create({
        data: {
          name: `企业微信客户 ${shortExternalId(externalUserId)}`,
          source: "wechat_work_kf",
          tags: ["企业微信客服"],
        },
      });
      const externalChatId = `wechat_work_kf:${openKfid}:${externalUserId}`;
      const conversation = existing?.conversation || await tx.conversation.upsert({
        where: {
          wechatAccountId_externalChatId: {
            wechatAccountId: account.id,
            externalChatId,
          },
        },
        update: {
          customerId: customer.id,
          channel: "work_wechat",
          ...(payload.sendTime ? { lastMessageAt: new Date(payload.sendTime * 1000) } : {}),
        },
        create: {
          channel: "work_wechat",
          externalChatId,
          title: customer.name,
          customerId: customer.id,
          wechatAccountId: account.id,
          lastMessageAt: payload.sendTime ? new Date(payload.sendTime * 1000) : null,
          manualLocked: false,
        },
      });
      return tx.wechatWorkBinding.upsert({
        where: { openKfid_externalUserId: { openKfid, externalUserId } },
        update: {
          wechatAccountId: account.id,
          customerId: customer.id,
          conversationId: conversation.id,
          ...(payload.sendTime ? { lastInboundAt: new Date(payload.sendTime * 1000) } : {}),
        },
        create: {
          openKfid,
          externalUserId,
          wechatAccountId: account.id,
          customerId: customer.id,
          conversationId: conversation.id,
          lastInboundAt: payload.sendTime ? new Date(payload.sendTime * 1000) : null,
        },
        include: { wechatAccount: true, customer: true, conversation: true },
      });
    });
  }

  async getWechatWorkBinding(openKfid: string, externalUserId: string) {
    if (this.isLocal) return this.localStore.getWechatWorkBinding(openKfid, externalUserId);
    return (this.prisma as any).wechatWorkBinding.findUnique({
      where: { openKfid_externalUserId: { openKfid, externalUserId } },
      include: { wechatAccount: true, customer: true, conversation: true },
    });
  }

  async findWechatWorkBindingByIdentity(identity: IdentityFilter = {}) {
    if (this.isLocal) return this.localStore.findWechatWorkBindingByIdentity(identity);
    if (!identity.wechatAccountId && !identity.conversationId && !identity.customerId) return null;
    return (this.prisma as any).wechatWorkBinding.findFirst({
      where: {
        ...(identity.wechatAccountId ? { wechatAccountId: identity.wechatAccountId } : {}),
        ...(identity.conversationId ? { conversationId: identity.conversationId } : {}),
        ...(identity.customerId ? { customerId: identity.customerId } : {}),
      },
      include: { wechatAccount: true, customer: true, conversation: true },
    });
  }

  async findMessageByExternalId(conversationId: string, externalId: string) {
    if (this.isLocal) return this.localStore.findMessageByExternalId(conversationId, externalId);
    return (this.prisma as any).message.findUnique({
      where: { conversationId_externalId: { conversationId, externalId } },
    });
  }

  async recordWechatWorkAudit(payload: Record<string, unknown>) {
    if (this.isLocal) return this.localStore.recordWechatWorkAudit(payload);
    const knownKeys = new Set([
      "id", "action", "status", "msgid", "callbackId", "event", "openKfid", "externalUserId",
      "wechatAccountId", "customerId", "conversationId", "messageId", "sendTaskId", "sendAttemptId",
      "errorMessage", "createdAt",
    ]);
    const metadata = Object.fromEntries(Object.entries(payload).filter(([key]) => !knownKeys.has(key)));
    return (this.prisma as any).wechatWorkAuditLog.create({
      data: {
        ...(payload.id ? { id: String(payload.id) } : {}),
        action: String(payload.action || "unknown"),
        status: String(payload.status || "unknown"),
        ...this.auditScalarFields(payload),
        metadata: Object.keys(metadata).length ? metadata : undefined,
        ...(payload.createdAt ? { createdAt: new Date(String(payload.createdAt)) } : {}),
      },
    });
  }

  async listWechatWorkAuditLogs(limit = 100) {
    if (this.isLocal) return this.localStore.listWechatWorkAuditLogs(limit);
    const safeLimit = Math.max(1, Math.min(Number(limit || 100), 500));
    const records = await (this.prisma as any).wechatWorkAuditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: safeLimit,
    });
    return records.map((record: any) => ({
      ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
      ...record,
    }));
  }

  async hasWechatWorkAuditMsgId(msgid: string) {
    if (this.isLocal) return this.localStore.hasWechatWorkAuditMsgId(msgid);
    return Boolean(await (this.prisma as any).wechatWorkAuditLog.findFirst({ where: { msgid }, select: { id: true } }));
  }

  async findWechatWorkSendAttemptByMsgId(msgid: string) {
    if (this.isLocal) return this.localStore.findWechatWorkSendAttemptByMsgId(msgid);
    const attempt = await (this.prisma as any).wechatSendAttempt.findFirst({
      where: { metadata: { path: ["apiMsgId"], equals: msgid } },
      include: attemptInclude,
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
    return attempt ? this.hydrateAttempt(attempt) : null;
  }

  private hydrateMessage(message: any, conversation: any) {
    return {
      ...message,
      customerId: conversation?.customerId || null,
      wechatAccountId: conversation?.wechatAccountId || null,
      metadata: message?.metadata || {},
    };
  }

  private normalizeSnapshot(snapshot: any) {
    return {
      ...snapshot,
      confidence:
        snapshot?.confidence && typeof snapshot.confidence.toNumber === "function"
          ? snapshot.confidence.toNumber()
          : snapshot?.confidence,
    };
  }

  private hydrateTask(task: any, quoteDraft: any = null) {
    const attempts = Array.isArray(task.attempts) ? task.attempts : [];
    return {
      ...task,
      customerId: task.conversation?.customerId || null,
      quoteDraft,
      attempts,
      attemptCount: attempts.length,
      latestAttempt: attempts[0] || null,
    };
  }

  private hydrateAttempt(attempt: any) {
    const sendTask = attempt.sendTask
      ? { ...attempt.sendTask, customerId: attempt.sendTask.conversation?.customerId || null }
      : null;
    return { ...attempt, sendTask };
  }

  private async attachQuotes(tasks: any[]) {
    if (!tasks.length) return [];
    const taskIds = tasks.map((task) => task.id);
    const quoteIds = tasks.map((task) => task.quoteDraftId).filter(Boolean);
    const quotes = await (this.prisma as any).quoteDraft.findMany({
      where: {
        OR: [
          ...(quoteIds.length ? [{ id: { in: quoteIds } }] : []),
          { sendTaskId: { in: taskIds } },
        ],
      },
    });
    return tasks.map((task) =>
      this.hydrateTask(
        task,
        quotes.find((quote: any) => quote.id === task.quoteDraftId || quote.sendTaskId === task.id) || null,
      ),
    );
  }

  private taskWhere(filter: IdentityFilter) {
    return {
      ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
      ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
      ...(filter.customerId ? { conversation: { customerId: filter.customerId } } : {}),
    };
  }

  private sendTaskPatch(patch: any) {
    return {
      ...patch,
      ...(patch.queuedAt ? { queuedAt: new Date(patch.queuedAt) } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "sentAt")
        ? { sentAt: patch.sentAt ? new Date(patch.sentAt) : null }
        : {}),
    };
  }

  private jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }

  private decimalOrNull(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? new Prisma.Decimal(number) : null;
  }

  private integerOrNull(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  }

  private async requireConversationIdentity(filter: IdentityFilter, label: string) {
    const missing = [
      !filter.wechatAccountId ? "wechatAccountId" : "",
      !filter.conversationId ? "conversationId" : "",
      !filter.customerId ? "customerId" : "",
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`${label} requires complete conversation identity: ${missing.join(", ")}`);
    const conversation = await this.getConversation(filter.conversationId || "");
    if (!conversation) throw new BadRequestException(`${label} conversation not found`);
    if (conversation.wechatAccountId !== filter.wechatAccountId) {
      throw new BadRequestException(`${label} conversation binding invalid: requested account does not match conversation`);
    }
    if (conversation.customerId !== filter.customerId) {
      throw new BadRequestException(`${label} customer binding invalid: requested customer does not match conversation`);
    }
    return conversation;
  }

  private timelineAttachments(value: unknown, status: string) {
    return (Array.isArray(value) ? value : []).map((item: any) =>
      item && typeof item === "object" ? { ...item, status: item.status || status } : { value: item, status },
    );
  }

  private auditScalarFields(payload: Record<string, unknown>) {
    const result: Record<string, string | null> = {};
    for (const key of [
      "msgid", "callbackId", "event", "openKfid", "externalUserId", "wechatAccountId", "customerId",
      "conversationId", "messageId", "sendTaskId", "sendAttemptId", "errorMessage",
    ]) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        result[key] = payload[key] === undefined || payload[key] === null ? null : String(payload[key]);
      }
    }
    return result;
  }
}

function shortExternalId(value: string) {
  const normalized = String(value || "").trim();
  return normalized.length <= 12 ? normalized : `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}
