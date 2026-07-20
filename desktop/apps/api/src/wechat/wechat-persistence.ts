import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import {
  assertExactOperationReplay,
  assertStoredOperationIdentityReplay,
  createInboundMessageOperationFingerprint,
  createSendTaskOperationFingerprint,
  deterministicOperationId,
  InboundLeaseLostError,
  isUniqueConstraintError,
  monotonicInboundOperationStage,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
} from "../shared/operation-idempotency";

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
        await this.fenceInboundTransaction(tx, payload.inboundFence, "inbound message commit");
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
        const requestOperation = payload.externalId
          ? requestOperationMetadata(
              String(payload.externalId),
              createInboundMessageOperationFingerprint(payload || {}, {
                conversationId: conversation.id,
                customerId: conversation.customerId,
                wechatAccountId: conversation.wechatAccountId,
              }),
            )
          : null;

        if (payload.externalId) {
          const existing = await tx.message.findFirst({
            where: {
              externalId: payload.externalId,
              conversation: { wechatAccountId: conversation.wechatAccountId },
            },
            include: { conversation: true },
          });
          if (existing) {
            this.assertInboundMessageReplay(existing, existing.conversation, requestOperation!, {
              conversationId: conversation.id,
              customerId: conversation.customerId,
              wechatAccountId: conversation.wechatAccountId,
            });
            return { ...this.hydrateMessage(existing, existing.conversation), deduplicated: true };
          }
        }

        const now = payload.createdAt ? new Date(payload.createdAt) : new Date();
        const message = await tx.message.create({
          data: {
            ...(payload.id
              ? { id: payload.id }
              : payload.externalId
                ? { id: deterministicOperationId("msg", `${conversation.wechatAccountId}:${payload.externalId}`) }
                : {}),
            conversationId: conversation.id,
            direction: payload.direction || "inbound",
            text: payload.text || "",
            attachments: this.jsonOrNull(payload.attachments || []),
            metadata: this.jsonOrNull({
              ...(payload.metadata || {}),
              ...(requestOperation ? { requestOperation } : {}),
            }),
            externalId: payload.externalId || null,
            createdAt: now,
          },
        });
        await tx.conversation.updateMany({
          where: {
            id: conversation.id,
            OR: [
              { lastMessageAt: null },
              { lastMessageAt: { lt: now } },
            ],
          },
          data: { lastMessageAt: now },
        });
        return this.hydrateMessage(message, conversation);
      });
    } catch (error: any) {
      if (payload.externalId && isUniqueConstraintError(error)) {
        const conversation = await this.getConversation(payload.conversationId);
        const existing = conversation ? await prisma.message.findUnique({
          where: { id: deterministicOperationId("msg", `${conversation.wechatAccountId}:${payload.externalId}`) },
          include: { conversation: true },
        }) : null;
        if (existing && conversation) {
          const requestOperation = requestOperationMetadata(
            String(payload.externalId),
            createInboundMessageOperationFingerprint(payload || {}, {
              conversationId: conversation.id,
              customerId: conversation.customerId,
              wechatAccountId: conversation.wechatAccountId,
            }),
          );
          this.assertInboundMessageReplay(existing, existing.conversation, requestOperation, {
            conversationId: conversation.id,
            customerId: conversation.customerId,
            wechatAccountId: conversation.wechatAccountId,
          });
          return { ...this.hydrateMessage(existing, existing.conversation), deduplicated: true };
        }
      }
      throw error;
    }
  }

  async claimInboundOperation(payload: {
    operationId?: string;
    claimToken: string;
    source?: string;
    wechatAccountId: string;
    externalId: string;
    requestFingerprint: string;
    normalizedPayload?: Record<string, unknown>;
    leaseExpiresAt: string;
  }) {
    const id = payload.operationId || deterministicOperationId("inbound", `${payload.wechatAccountId}:${payload.externalId}`);
    if (this.isLocal) {
      if (payload.operationId) {
        const existing = this.localStore.getInboundMessageOperation(payload.wechatAccountId, payload.externalId);
        this.assertInboundOperationReplay(existing, { ...payload, id });
        if (
          existing.status !== "processing" ||
          existing.claimToken !== payload.claimToken ||
          new Date(existing.leaseExpiresAt || 0).getTime() <= Date.now()
        ) {
          throw new BadRequestException("inbound operation is not owned by the supplied claim");
        }
        return { operation: existing, claimed: true, completed: false };
      }
      const claimed = this.localStore.claimInboundMessageOperation({ ...payload, id });
      return claimed;
    }
    const prisma = this.prisma as any;
    if (payload.operationId) {
      const existing = await prisma.inboundMessageOperation.findUnique({ where: { id: payload.operationId } });
      this.assertInboundOperationReplay(existing, { ...payload, id });
      if (
        existing.status !== "processing" ||
        existing.claimToken !== payload.claimToken ||
        new Date(existing.leaseExpiresAt || 0).getTime() <= Date.now()
      ) {
        throw new BadRequestException("inbound operation is not owned by the supplied claim");
      }
      return { operation: existing, claimed: true, completed: false };
    }
    const leaseExpiresAt = new Date(payload.leaseExpiresAt);
    try {
      const operation = await prisma.inboundMessageOperation.create({
        data: {
          id,
          source: payload.source || "wechat",
          wechatAccountId: payload.wechatAccountId,
          externalId: payload.externalId,
          requestFingerprint: payload.requestFingerprint,
          normalizedPayload: this.jsonOrNull(payload.normalizedPayload || {}),
          claimToken: payload.claimToken,
          leaseExpiresAt,
        },
      });
      return { operation, claimed: true, completed: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await prisma.inboundMessageOperation.findUnique({
        where: { wechatAccountId_externalId: { wechatAccountId: payload.wechatAccountId, externalId: payload.externalId } },
      });
      this.assertInboundOperationReplay(existing, { ...payload, id });
      if (existing.status === "completed") return { operation: existing, claimed: false, completed: true };
      const activeLease = existing.status === "processing" && new Date(existing.leaseExpiresAt || 0).getTime() > Date.now();
      if (activeLease) return { operation: existing, claimed: false, completed: false, inProgress: true };
      const claimed = await prisma.inboundMessageOperation.updateMany({
        where: {
          id: existing.id,
          requestFingerprint: payload.requestFingerprint,
          status: { not: "completed" },
          OR: [
            { status: { in: ["retryable", "failed"] } },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          status: "processing",
          claimToken: payload.claimToken,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });
      if (claimed.count !== 1) {
        const current = await prisma.inboundMessageOperation.findUnique({ where: { id: existing.id } });
        if (current?.status === "completed") return { operation: current, claimed: false, completed: true };
        return { operation: current || existing, claimed: false, completed: false, inProgress: true };
      }
      return {
        operation: await prisma.inboundMessageOperation.findUnique({ where: { id: existing.id } }),
        claimed: true,
        completed: false,
      };
    }
  }

  async advanceInboundOperation(id: string, claimToken: string, patch: Record<string, unknown>) {
    if (this.isLocal) return this.localStore.updateInboundMessageOperation(id, claimToken, patch);
    const prisma = this.prisma as any;
    const current = await prisma.inboundMessageOperation.findUnique({ where: { id } });
    if (
      !current ||
      current.status !== "processing" ||
      current.claimToken !== claimToken ||
      new Date(current.leaseExpiresAt || 0).getTime() <= Date.now()
    ) {
      throw new InboundLeaseLostError("inbound operation claim changed before stage commit");
    }
    const nextPatch = { ...patch };
    if ("stage" in nextPatch) {
      nextPatch.stage = monotonicInboundOperationStage(current.stage, nextPatch.stage);
    }
    const updated = await prisma.inboundMessageOperation.updateMany({
      where: { id, status: "processing", claimToken, stage: current.stage, leaseExpiresAt: { gt: new Date() } },
      data: this.jsonOperationPatch(nextPatch),
    });
    if (updated.count !== 1) throw new InboundLeaseLostError("inbound operation claim changed before stage commit");
    return prisma.inboundMessageOperation.findUnique({ where: { id } });
  }

  async renewInboundOperationLease(id: string, claimToken: string, leaseExpiresAt: string) {
    const nextLease = new Date(leaseExpiresAt);
    if (!Number.isFinite(nextLease.getTime()) || nextLease.getTime() <= Date.now()) {
      throw new BadRequestException("inbound operation lease renewal must expire in the future");
    }
    if (this.isLocal) return this.localStore.renewInboundMessageOperationLease(id, claimToken, nextLease.toISOString());
    const prisma = this.prisma as any;
    const renewed = await prisma.inboundMessageOperation.updateMany({
      where: {
        id,
        status: "processing",
        claimToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { leaseExpiresAt: nextLease },
    });
    if (renewed.count !== 1) {
      throw new InboundLeaseLostError("inbound operation lease is no longer owned by this claim");
    }
    return prisma.inboundMessageOperation.findUnique({ where: { id } });
  }

  failInboundOperation(id: string, claimToken: string, error: unknown) {
    return this.advanceInboundOperation(id, claimToken, {
      status: "retryable",
      claimToken: null,
      leaseExpiresAt: null,
      lastError: error instanceof Error ? error.message.slice(0, 500) : "inbound processing failed",
    });
  }

  completeInboundOperation(id: string, claimToken: string, result: Record<string, unknown>) {
    const completedAt = new Date().toISOString();
    return this.advanceInboundOperation(id, claimToken, {
      status: "completed",
      stage: "completed",
      result,
      claimToken: null,
      leaseExpiresAt: null,
      lastError: null,
      completedAt,
    });
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

  async getDesignJob(id: string) {
    if (this.isLocal) return this.localStore.getDesignJob(id);
    return (this.prisma as any).designJob.findUnique({
      where: { id },
      include: { images: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
  }

  async getRouteEvaluation(id: string) {
    if (this.isLocal) return this.localStore.getRouteEvaluation(id);
    return (this.prisma as any).routeEvaluation.findUnique({ where: { id } });
  }

  async getNotification(id: string) {
    if (this.isLocal) return this.localStore.getNotification(id);
    return (this.prisma as any).notification.findUnique({ where: { id } });
  }

  async getQuoteDraft(id: string) {
    if (this.isLocal) return this.localStore.getQuoteDraft(id);
    return (this.prisma as any).quoteDraft.findUnique({
      where: { id },
      include: { customer: true, selectedImage: true, designJob: true, orderDraft: true },
    });
  }

  async getReviewLog(id: string) {
    if (this.isLocal) return this.localStore.listReviewLogs(500).find((item: any) => item.id === id) || null;
    return (this.prisma as any).reviewLog.findUnique({ where: { id } });
  }

  async createSendTask(payload: any) {
    if (this.isLocal) return this.localStore.createSendTask(payload);
    const prisma = this.prisma as any;
    const operationKey = payload.operationKey ? normalizeOperationKey(payload.operationKey) : null;
    const taskId = operationKey ? deterministicOperationId("send", operationKey) : payload.id;
    if (taskId && operationKey) {
      const existing = await prisma.wechatSendTask.findUnique({ where: { id: taskId }, include: taskInclude });
      if (existing) {
        this.assertSendTaskReplay(existing, payload, operationKey);
        return (await this.attachQuotes([existing]))[0];
      }
    }
    const conversation = operationKey
      ? await prisma.conversation.findUnique({ where: { id: payload.conversationId } })
      : null;
    if (operationKey && !conversation) {
      throw new BadRequestException(`conversation not found: ${payload.conversationId}`);
    }
    if (operationKey && conversation.wechatAccountId !== payload.wechatAccountId) {
      throw new BadRequestException("send task conversation binding invalid: wechat account does not match conversation");
    }
    if (operationKey && payload.customerId && conversation.customerId !== payload.customerId) {
      throw new BadRequestException("send task customer binding invalid: customer does not match conversation");
    }
    const requestOperation = operationKey
      ? requestOperationMetadata(
          operationKey,
          createSendTaskOperationFingerprint(payload || {}, {
            conversationId: payload.conversationId,
            customerId: payload.customerId || conversation.customerId,
            wechatAccountId: payload.wechatAccountId,
          }),
        )
      : null;
    try {
      const task = await prisma.wechatSendTask.create({
        data: {
          ...(taskId ? { id: taskId } : {}),
          status: payload.status || "queued",
          wechatAccountId: payload.wechatAccountId,
          conversationId: payload.conversationId,
          designJobId: payload.designJobId || null,
          quoteDraftId: payload.quoteDraftId || null,
          payload: payload.payload || {},
          guardSnapshot: {
            ...(payload.guardSnapshot || { status: "pending", checks: [] }),
            binding: {
              conversationId: payload.conversationId,
              customerId: payload.customerId || conversation?.customerId || null,
              wechatAccountId: payload.wechatAccountId,
              ...((payload.guardSnapshot as any)?.binding || {}),
            },
            ...(requestOperation ? { requestOperation } : {}),
          },
          errorMessage: payload.errorMessage || null,
          queuedAt: payload.queuedAt ? new Date(payload.queuedAt) : new Date(),
          sentAt: payload.sentAt ? new Date(payload.sentAt) : null,
          ...(payload.createdAt ? { createdAt: new Date(payload.createdAt) } : {}),
        },
        include: taskInclude,
      });
      return (await this.attachQuotes([task]))[0];
    } catch (error) {
      if (operationKey && taskId && isUniqueConstraintError(error)) {
        const winner = await prisma.wechatSendTask.findUnique({ where: { id: taskId }, include: taskInclude });
        if (winner) {
          this.assertSendTaskReplay(winner, payload, operationKey);
          return (await this.attachQuotes([winner]))[0];
        }
      }
      throw error;
    }
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
    expectedTaskUpdatedAt?: string | Date;
    expectedAttemptStatus?: string;
    linkedTransition?: {
      model: "quoteDraft" | "orderDraft";
      where: Record<string, unknown>;
      data: Record<string, unknown>;
      required?: boolean;
    } | null;
  }) {
    if (this.isLocal) {
      return this.localStore.completeSendAttemptAndTask(params);
    }
    const prisma = this.prisma as any;
    const completed = await prisma.$transaction(async (tx: any) => {
      if (params.expectedTaskStatus || params.expectedTaskUpdatedAt) {
        const claimed = await tx.wechatSendTask.updateMany({
          where: {
            id: params.taskId,
            ...(params.expectedTaskStatus ? { status: params.expectedTaskStatus } : {}),
            ...(params.expectedTaskUpdatedAt ? { updatedAt: new Date(params.expectedTaskUpdatedAt) } : {}),
          },
          data: this.sendTaskPatch(params.taskPatch),
        });
        if (claimed.count !== 1) return false;
      } else {
        await tx.wechatSendTask.update({
          where: { id: params.taskId },
          data: this.sendTaskPatch(params.taskPatch),
        });
      }
      const attemptData = {
        ...params.attemptPatch,
        ...(params.attemptPatch.completedAt
          ? { completedAt: new Date(params.attemptPatch.completedAt) }
          : {}),
      };
      if (params.expectedAttemptStatus) {
        const claimedAttempt = await tx.wechatSendAttempt.updateMany({
          where: { id: params.attemptId, status: params.expectedAttemptStatus },
          data: attemptData,
        });
        if (claimedAttempt.count !== 1) {
          throw new BadRequestException("send attempt state changed before durable completion");
        }
      } else {
        await tx.wechatSendAttempt.update({
          where: { id: params.attemptId },
          data: attemptData,
        });
      }
      if (params.linkedTransition) {
        const delegate = tx[params.linkedTransition.model];
        const linked = await delegate.updateMany({
          where: params.linkedTransition.where,
          data: params.linkedTransition.data,
        });
        if (params.linkedTransition.required !== false && linked.count !== 1) {
          throw new BadRequestException("linked send state changed before durable completion");
        }
      }
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

  async updateSendTaskWithLinkedTransition(params: {
    taskId: string;
    expectedTaskStatus: string;
    taskPatch: any;
    linkedTransition?: {
      model: "quoteDraft" | "orderDraft";
      where: Record<string, unknown>;
      data: Record<string, unknown>;
      required?: boolean;
    } | null;
  }) {
    if (this.isLocal) return this.localStore.updateSendTask(params.taskId, params.taskPatch);
    const prisma = this.prisma as any;
    const completed = await prisma.$transaction(async (tx: any) => {
      const task = await tx.wechatSendTask.updateMany({
        where: { id: params.taskId, status: params.expectedTaskStatus },
        data: this.sendTaskPatch(params.taskPatch),
      });
      if (task.count !== 1) return false;
      if (params.linkedTransition) {
        const delegate = tx[params.linkedTransition.model];
        const linked = await delegate.updateMany({
          where: params.linkedTransition.where,
          data: params.linkedTransition.data,
        });
        if (params.linkedTransition.required !== false && linked.count !== 1) {
          throw new BadRequestException("linked send state changed before task transition");
        }
      }
      return true;
    });
    if (!completed) return null;
    return this.getSendTask(params.taskId);
  }

  async claimQueuedTaskAndCreateAttempt(params: {
    taskId: string;
    taskPatch: any;
    attempt: any;
  }) {
    if (this.isLocal) {
      return this.localStore.claimQueuedSendTaskAndCreateAttempt(params);
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
    const lastInboundAt = this.normalizeWechatWorkInboundAt(payload.sendTime);
    let lastConflict: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await prisma.$transaction((tx: any) =>
          this.upsertCanonicalWechatWorkBinding(tx, { openKfid, externalUserId, lastInboundAt }),
        );
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict;
  }

  private async upsertCanonicalWechatWorkBinding(
    tx: any,
    payload: { openKfid: string; externalUserId: string; lastInboundAt: Date | null },
  ) {
    const { openKfid, externalUserId, lastInboundAt } = payload;
    const include = { wechatAccount: true, customer: true, conversation: true };
    const [existing, accountHistory, customerHistory] = await Promise.all([
      tx.wechatWorkBinding.findUnique({
        where: { openKfid_externalUserId: { openKfid, externalUserId } },
        include,
      }),
      tx.wechatWorkBinding.findMany({ where: { openKfid }, include: { wechatAccount: true } }),
      tx.wechatWorkBinding.findMany({ where: { externalUserId }, include: { customer: true } }),
    ]);

    const accountId = this.singleWechatWorkHistoryId(
      accountHistory.map((item: any) => item.wechatAccountId),
      "openKfid maps to multiple WeChat accounts",
    ) || deterministicOperationId("wwacct", this.wechatWorkCanonicalKey("account", openKfid));
    const customerId = this.singleWechatWorkHistoryId(
      customerHistory.map((item: any) => item.customerId),
      "externalUserId maps to multiple customers",
    ) || deterministicOperationId("wwcust", this.wechatWorkCanonicalKey("customer", externalUserId));

    if (existing) {
      this.assertCanonicalWechatWorkBinding(existing, { openKfid, externalUserId, accountId, customerId });
      if (!lastInboundAt) return existing;
      await tx.wechatWorkBinding.updateMany({
        where: {
          id: existing.id,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: lastInboundAt } },
          ],
        },
        data: { lastInboundAt },
      });
      const winner = await tx.wechatWorkBinding.findUnique({ where: { id: existing.id }, include });
      if (!winner) {
        throw new BadRequestException("wechat work canonical binding disappeared during timestamp advance");
      }
      this.assertCanonicalWechatWorkBinding(winner, { openKfid, externalUserId, accountId, customerId });
      return winner;
    }

    let account = accountHistory.find((item: any) => item.wechatAccountId === accountId)?.wechatAccount
      || await tx.wechatAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      account = await tx.wechatAccount.create({
        data: {
          id: accountId,
          displayName: `企业微信客服 ${shortExternalId(openKfid)}`,
          alias: shortExternalId(openKfid),
          isActive: true,
        },
      });
    }

    let customer = customerHistory.find((item: any) => item.customerId === customerId)?.customer
      || await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          id: customerId,
          name: `企业微信客户 ${shortExternalId(externalUserId)}`,
          source: "wechat_work_kf",
          tags: ["企业微信客服"],
        },
      });
    }

    const externalChatId = `wechat_work_kf:${openKfid}:${externalUserId}`;
    let conversation = await tx.conversation.findUnique({
      where: { wechatAccountId_externalChatId: { wechatAccountId: accountId, externalChatId } },
    });
    if (conversation) {
      this.assertCanonicalWechatWorkConversation(conversation, { accountId, customerId, externalChatId });
      if (lastInboundAt) {
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: lastInboundAt },
        });
      }
    } else {
      conversation = await tx.conversation.create({
        data: {
          id: deterministicOperationId(
            "wwconv",
            this.wechatWorkCanonicalKey("conversation", `${openKfid}:${externalUserId}`),
          ),
          channel: "work_wechat",
          externalChatId,
          title: customer.name,
          customerId,
          wechatAccountId: accountId,
          lastMessageAt: lastInboundAt,
          manualLocked: false,
        },
      });
    }

    return tx.wechatWorkBinding.create({
      data: {
        id: deterministicOperationId(
          "wwbind",
          this.wechatWorkCanonicalKey("binding", `${openKfid}:${externalUserId}`),
        ),
        openKfid,
        externalUserId,
        wechatAccountId: accountId,
        customerId,
        conversationId: conversation.id,
        lastInboundAt,
      },
      include,
    });
  }

  private singleWechatWorkHistoryId(values: unknown[], conflictMessage: string) {
    const ids = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
    if (ids.length > 1) {
      throw new BadRequestException(`wechat work canonical binding conflict: ${conflictMessage}`);
    }
    return ids[0] || "";
  }

  private normalizeWechatWorkInboundAt(sendTime?: number) {
    if (!sendTime) return null;
    const lastInboundAt = new Date(sendTime * 1000);
    if (Number.isNaN(lastInboundAt.getTime())) {
      throw new BadRequestException("wechat work binding sendTime is invalid");
    }
    return lastInboundAt;
  }

  private wechatWorkCanonicalKey(kind: string, externalIdentity: string) {
    const corpScope = String(appConfig.wechatWorkCorpId || "wechat-work-default").trim();
    return `${corpScope}:${kind}:${externalIdentity}`;
  }

  private assertCanonicalWechatWorkBinding(
    binding: any,
    expected: { openKfid: string; externalUserId: string; accountId: string; customerId: string },
  ) {
    const valid =
      binding.openKfid === expected.openKfid
      && binding.externalUserId === expected.externalUserId
      && binding.wechatAccountId === expected.accountId
      && binding.customerId === expected.customerId
      && binding.conversation?.id === binding.conversationId
      && binding.conversation?.wechatAccountId === expected.accountId
      && binding.conversation?.customerId === expected.customerId;
    if (!valid) {
      throw new BadRequestException("wechat work canonical binding conflict: stored identity is inconsistent");
    }
  }

  private assertCanonicalWechatWorkConversation(
    conversation: any,
    expected: { accountId: string; customerId: string; externalChatId: string },
  ) {
    if (
      conversation.wechatAccountId !== expected.accountId
      || conversation.customerId !== expected.customerId
      || conversation.externalChatId !== expected.externalChatId
      || conversation.channel !== "work_wechat"
    ) {
      throw new BadRequestException("wechat work canonical binding conflict: conversation identity is inconsistent");
    }
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
    const prisma = this.prisma as any;
    const data = {
        ...(payload.id ? { id: String(payload.id) } : {}),
        action: String(payload.action || "unknown"),
        status: String(payload.status || "unknown"),
        ...this.auditScalarFields(payload),
        metadata: Object.keys(metadata).length ? this.jsonOrNull(metadata) : undefined,
        ...(payload.createdAt ? { createdAt: new Date(String(payload.createdAt)) } : {}),
      };
    try {
      return await prisma.wechatWorkAuditLog.create({ data });
    } catch (error) {
      if (payload.id && isUniqueConstraintError(error)) {
        const winner = await prisma.wechatWorkAuditLog.findUnique({ where: { id: String(payload.id) } });
        if (winner) return winner;
      }
      throw error;
    }
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
    return Boolean(await (this.prisma as any).wechatWorkAuditLog.findFirst({
      where: {
        msgid,
        OR: [
          { action: "inbound_processed", status: "processed" },
          { action: "inbound_ignored", status: "ignored" },
          { action: "inbound_duplicate", status: "duplicate" },
          { action: "event_processed", status: "processed" },
          { action: "send_async_failed", status: "processed" },
          { action: "inbound_failed", status: "permanent_manual_review" },
        ],
      },
      select: { id: true },
    }));
  }

  async hasWechatWorkCallbackId(callbackId: string) {
    if (this.isLocal) return this.localStore.hasWechatWorkCallbackId(callbackId);
    return Boolean(await (this.prisma as any).wechatWorkAuditLog.findFirst({
      where: {
        callbackId,
        action: { in: ["callback_accepted", "callback_ignored", "callback_duplicate"] },
      },
      select: { id: true },
    }));
  }

  async countWechatWorkInboundFailures(msgid: string) {
    if (this.isLocal) return this.localStore.countWechatWorkInboundFailures(msgid);
    return (this.prisma as any).wechatWorkAuditLog.count({
      where: {
        msgid,
        action: "inbound_failed",
        status: { notIn: ["processed", "ignored", "duplicate", "permanent_manual_review"] },
      },
    });
  }

  async getWechatWorkSyncCursor(openKfid: string) {
    if (this.isLocal) return this.localStore.getWechatWorkSyncCursor(openKfid);
    return (this.prisma as any).wechatWorkSyncCursor.findUnique({ where: { openKfid } });
  }

  async commitWechatWorkSyncCursor(payload: {
    openKfid: string;
    expectedCursor: string;
    nextCursor: string;
    terminalMessageCount?: number;
    batchFingerprint?: string;
  }) {
    if (this.isLocal) return this.localStore.commitWechatWorkSyncCursor(payload);
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const current = await tx.wechatWorkSyncCursor.findUnique({ where: { openKfid: payload.openKfid } });
      const actualCursor = String(current?.nextCursor || "");
      if (actualCursor !== String(payload.expectedCursor || "")) {
        throw new BadRequestException("wechat work sync cursor changed concurrently; refusing stale cursor commit");
      }
      const data = {
        nextCursor: payload.nextCursor,
        terminalMessageCount: Number(payload.terminalMessageCount || 0),
        batchFingerprint: payload.batchFingerprint || null,
        committedAt: new Date(),
      };
      if (!current) {
        try {
          return await tx.wechatWorkSyncCursor.create({ data: { openKfid: payload.openKfid, ...data } });
        } catch (error: any) {
          if (error?.code === "P2002") {
            throw new BadRequestException("wechat work sync cursor changed concurrently; refusing stale cursor commit");
          }
          throw error;
        }
      }
      const updated = await tx.wechatWorkSyncCursor.updateMany({
        where: { openKfid: payload.openKfid, nextCursor: payload.expectedCursor },
        data,
      });
      if (updated.count !== 1) {
        throw new BadRequestException("wechat work sync cursor changed concurrently; refusing stale cursor commit");
      }
      return tx.wechatWorkSyncCursor.findUnique({ where: { openKfid: payload.openKfid } });
    });
  }

  async findWechatWorkSendAttemptByMsgId(msgid: string) {
    if (this.isLocal) return this.localStore.findWechatWorkSendAttemptByMsgId(msgid);
    const attempt = await (this.prisma as any).wechatSendAttempt.findFirst({
      where: {
        OR: [
          { metadata: { path: ["apiMsgId"], equals: msgid } },
          { metadata: { path: ["wechatWorkMsgId"], equals: msgid } },
          { metadata: { path: ["apiMsgIds"], array_contains: [msgid] } },
          { metadata: { path: ["wechatWorkMsgIds"], array_contains: [msgid] } },
          { metadata: { path: ["acceptedMessageIds"], array_contains: [msgid] } },
        ],
      },
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

  async findInboundMessageByExternalId(wechatAccountId: string, externalId: string) {
    if (this.isLocal) return this.localStore.findInboundMessageByExternalId(wechatAccountId, externalId);
    const message = await (this.prisma as any).message.findFirst({
      where: {
        direction: "inbound",
        externalId,
        conversation: { wechatAccountId },
      },
      include: { conversation: true },
    });
    return message ? this.hydrateMessage(message, message.conversation) : null;
  }

  private assertInboundOperationReplay(existing: any, requested: any) {
    if (
      !existing ||
      existing.id !== requested.id ||
      existing.wechatAccountId !== requested.wechatAccountId ||
      existing.externalId !== requested.externalId ||
      existing.requestFingerprint !== requested.requestFingerprint ||
      existing.source !== (requested.source || "wechat")
    ) {
      throw new BadRequestException("duplicate inbound externalId conflict: operation identity or payload changed");
    }
  }

  private jsonOperationPatch(patch: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...patch };
    for (const key of ["normalizedPayload", "result"]) {
      if (key in data) data[key] = this.jsonOrNull(data[key]);
    }
    for (const key of ["leaseExpiresAt", "completedAt"]) {
      if (typeof data[key] === "string") data[key] = new Date(String(data[key]));
    }
    return data;
  }

  private async fenceInboundTransaction(
    tx: any,
    fence: { operationId?: string; claimToken?: string; leaseExpiresAt?: string } | undefined,
    label: string,
  ) {
    if (!fence) return;
    const operationId = String(fence.operationId || "").trim();
    const claimToken = String(fence.claimToken || "").trim();
    const leaseExpiresAt = new Date(String(fence.leaseExpiresAt || ""));
    if (!operationId || !claimToken || !Number.isFinite(leaseExpiresAt.getTime()) || leaseExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(`${label} requires a complete future inbound operation fence`);
    }
    const fenced = await tx.inboundMessageOperation.updateMany({
      where: {
        id: operationId,
        status: "processing",
        claimToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { leaseExpiresAt },
    });
    if (fenced.count !== 1) throw new InboundLeaseLostError(`inbound operation lease changed before ${label}`);
  }

  private assertInboundMessageReplay(
    existing: any,
    conversation: any,
    requestOperation: any,
    requestedIdentity: Record<string, unknown>,
  ) {
    assertExactOperationReplay(
      readRequestOperationMetadata(existing.metadata),
      requestOperation,
      "inbound message create",
    );
    assertStoredOperationIdentityReplay(
      {
        conversationId: existing.conversationId,
        customerId: conversation?.customerId,
        wechatAccountId: conversation?.wechatAccountId,
      },
      requestedIdentity,
      "inbound message create",
    );
  }

  private assertSendTaskReplay(existing: any, payload: any, operationKey: string) {
    const storedBinding = existing.guardSnapshot?.binding || {};
    const storedIdentity = {
      conversationId: storedBinding.conversationId || existing.conversationId,
      customerId: storedBinding.customerId || null,
      wechatAccountId: storedBinding.wechatAccountId || existing.wechatAccountId,
    };
    const requestedIdentity = {
      conversationId: payload.conversationId,
      customerId: payload.customerId,
      wechatAccountId: payload.wechatAccountId,
    };
    assertStoredOperationIdentityReplay(storedIdentity, requestedIdentity, "send task create");
    assertExactOperationReplay(
      readRequestOperationMetadata(existing.guardSnapshot),
      requestOperationMetadata(
        operationKey,
        createSendTaskOperationFingerprint(payload || {}, storedIdentity),
      ),
      "send task create",
    );
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
