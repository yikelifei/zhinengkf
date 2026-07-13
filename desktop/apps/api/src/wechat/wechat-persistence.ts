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
          if (existing) return this.hydrateMessage(existing, conversation);
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
        if (existing && conversation) return this.hydrateMessage(existing, conversation);
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
  }) {
    if (this.isLocal) {
      const attempt = this.localStore.updateSendAttempt(params.attemptId, params.attemptPatch);
      const task = this.localStore.updateSendTask(params.taskId, params.taskPatch);
      return { task, attempt };
    }
    const prisma = this.prisma as any;
    await prisma.$transaction(async (tx: any) => {
      await tx.wechatSendAttempt.update({
        where: { id: params.attemptId },
        data: {
          ...params.attemptPatch,
          ...(params.attemptPatch.completedAt
            ? { completedAt: new Date(params.attemptPatch.completedAt) }
            : {}),
        },
      });
      await tx.wechatSendTask.update({
        where: { id: params.taskId },
        data: this.sendTaskPatch(params.taskPatch),
      });
    });
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

  async listAccountQueueTaskIds(wechatAccountId: string) {
    if (this.isLocal) return this.localStore.listAccountQueueTaskIds(wechatAccountId);
    const tasks = await this.prisma.wechatSendTask.findMany({
      where: { wechatAccountId, status: { in: ["queued", "sending"] } },
      select: { id: true },
      orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return tasks.map((task) => task.id);
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
}
