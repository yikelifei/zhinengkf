import { Prisma } from "@prisma/client";
import path from "node:path";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
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
import {
  conversationTimelineTaskPartStatus,
  conversationTimelineTaskParts,
  conversationTimelineMessagePresentation,
  normalizeConversationTimelineAttachments,
} from "../shared/conversation-message-presentation";

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

const { getToolDefinition } = require(path.join(process.cwd(), "packages", "rules"));

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

const agentTaskInclude = {
  steps: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  approvals: { orderBy: [{ requestedAt: "desc" }, { id: "desc" }] },
  toolExecutions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} as const;

/**
 * Keeps the existing local-json contract while making the same WeChat records
 * durable in PostgreSQL. Business validation remains in WechatDispatchService;
 * this class owns persistence, hydration and short database transactions only.
 */
@Injectable()
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
        const expectedWechatAccountId = String(payload.wechatAccountId || "").trim();
        if (!expectedWechatAccountId) {
          throw new BadRequestException("inbound message commit requires a WeChat account binding");
        }
        const lockTime = new Date();
        const accountLock = await tx.wechatAccount.updateMany({
          where: { id: expectedWechatAccountId },
          data: { updatedAt: lockTime },
        });
        if (accountLock.count !== 1) {
          throw new BadRequestException("inbound message WeChat account binding changed before commit");
        }
        const conversationLock = await tx.conversation.updateMany({
          where: { id: payload.conversationId, wechatAccountId: expectedWechatAccountId },
          data: { updatedAt: lockTime },
        });
        if (conversationLock.count !== 1) {
          throw new BadRequestException("inbound message conversation binding changed before commit");
        }
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

  async getInboundMessageOperation(wechatAccountId: string, externalId: string) {
    if (this.isLocal) {
      return this.localStore.getInboundMessageOperation(wechatAccountId, externalId);
    }
    return (this.prisma as any).inboundMessageOperation.findUnique({
      where: { wechatAccountId_externalId: { wechatAccountId, externalId } },
    });
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
    const [candidates, rpaAudits] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
      (this.prisma as any).personalWechatRpaAuditLog.findMany({
        where: { conversationId, messageId: { not: null } },
        select: { messageId: true },
        take: 500,
      }),
    ]);
    const rpaMessageIds = new Set<string>(
      rpaAudits.map((item: any) => String(item.messageId || "")).filter(Boolean),
    );
    const message = candidates.find((item: any) => isTrustedTimelineMessage(item, rpaMessageIds)) || null;
    if (!message) return null;
    const conversation = await this.getConversation(conversationId);
    return this.hydrateMessage(message, conversation);
  }

  async listConversationTimeline(filter: IdentityFilter & { limit?: number }) {
    if (this.isLocal) return this.localStore.listConversationTimeline(filter as any);
    const conversation = await this.requireConversationIdentity(filter, "message history");
    const limit = Math.max(1, Math.min(Number(filter.limit || 300), 500));
    const [messages, tasks, rpaAudits] = await Promise.all([
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
      (this.prisma as any).personalWechatRpaAuditLog.findMany({
        where: { conversationId: conversation.id, messageId: { not: null } },
        select: { messageId: true },
        take: Math.max(limit, 500),
      }),
    ]);
    const rpaMessageIds = new Set<string>(
      rpaAudits.map((item: any) => String(item.messageId || "")).filter(Boolean),
    );
    const taskAssetIds = [
      ...new Set(
        tasks.flatMap((task: any) => Array.isArray(task?.payload?.assetIds) ? task.payload.assetIds.map(String) : []),
      ),
    ];
    const timelineAssets = taskAssetIds.length
      ? await (this.prisma as any).designAsset.findMany({ where: { id: { in: taskAssetIds } } })
      : [];
    const timelineAttempts = tasks.length
      ? await (this.prisma as any).wechatSendAttempt.findMany({
          where: { sendTaskId: { in: tasks.map((task: any) => task.id) } },
          orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        })
      : [];
    const latestAttemptByTask = new Map<string, any>();
    for (const attempt of timelineAttempts) {
      if (!latestAttemptByTask.has(String(attempt.sendTaskId))) {
        latestAttemptByTask.set(String(attempt.sendTaskId), attempt);
      }
    }
    return [
      ...messages
        .filter((message: any) => isTrustedTimelineMessage(message, rpaMessageIds))
        .map((message: any) => {
          const presentation = conversationTimelineMessagePresentation(message);
          return {
            ...message,
            source: "message",
            customerId: conversation.customerId,
            wechatAccountId: conversation.wechatAccountId,
            text: presentation.displayText,
            messageType: presentation.messageType,
            content: presentation.content,
            status: message.direction === "inbound" ? (message.readAt ? "read" : "unread") : "sent",
            attachments: this.timelineAttachments(message.attachments, message.readAt ? "read" : "received"),
          };
        }),
      ...tasks
        .filter((task: any) => !isSyntheticTimelineText(task.payload?.text || task.payload?.textBeforeImages || task.payload?.textBeforeFiles))
        .flatMap((task: any) => {
          const parts = conversationTimelineTaskParts(task.payload);
          const latestAttempt = latestAttemptByTask.get(String(task.id));
          const base = {
            source: "send_task",
            sendTaskId: task.id,
            conversationId: conversation.id,
            customerId: conversation.customerId,
            wechatAccountId: conversation.wechatAccountId,
            direction: "outbound",
            status: task.status || "queued",
            errorMessage: task.errorMessage || "",
            createdAt: task.queuedAt || task.createdAt,
            updatedAt: task.updatedAt || task.createdAt,
            sentAt: task.sentAt || null,
            metadata: { kind: task.payload?.kind || "text", manualReply: task.payload?.source === "manual_reply" },
          };
          if (!parts.length) return [{
            ...base,
            id: `send-task:${task.id}`,
            text: String(task.payload?.text || task.payload?.textBeforeImages || task.payload?.textBeforeFiles || ""),
            attachments: this.timelineTaskAttachments(task, timelineAssets),
          }];
          return parts.map((part, index) => {
            const partStatus = conversationTimelineTaskPartStatus(task.status, latestAttempt?.metadata, index);
            return {
              ...base,
              id: `send-task:${task.id}:${String(index + 1).padStart(2, "0")}`,
              text: part.text,
              messageType: part.messageType,
              content: part.content,
              status: partStatus,
              errorMessage: partStatus === "sent" ? "" : base.errorMessage,
              attachments: this.timelineAttachments(part.attachments, partStatus),
            };
          });
        }),
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

  async listRouteEvaluations(filter: IdentityFilter = {}) {
    if (this.isLocal) return this.localStore.listRouteEvaluations(filter);
    return (this.prisma as any).routeEvaluation.findMany({
      where: {
        ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
        ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      include: { agent: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async listAgentTasks(filter: IdentityFilter & { status?: string; limit?: number } = {}) {
    if (this.isLocal) return this.localStore.listAgentTasks(filter);
    const where: any = {
      ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
      ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const rows = await (this.prisma as any).agentTask.findMany({
      where,
      include: agentTaskInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(Number(filter.limit || 100), 500)),
    });
    return rows.map((task: any) => this.hydrateAgentTask(task));
  }

  async getAgentTask(id: string) {
    if (this.isLocal) return this.localStore.getAgentTask(id);
    const task = await (this.prisma as any).agentTask.findUnique({
      where: { id: String(id || "") },
      include: agentTaskInclude,
    });
    return task ? this.hydrateAgentTask(task) : null;
  }

  async createAgentTask(payload: any = {}) {
    if (this.isLocal) return this.localStore.createAgentTask(payload);
    const operationKey = normalizeOperationKey(payload.operationKey || payload.id || "agent-task", "agent task operationKey");
    const taskId = String(payload.id || deterministicOperationId("agent_task", operationKey));
    const prisma = this.prisma as any;
    const existing = await prisma.agentTask.findUnique({ where: { operationKey }, include: agentTaskInclude });
    if (existing) {
      this.assertAgentTaskReplay(existing, payload, operationKey);
      return this.hydrateAgentTask(existing);
    }
    const identity = payload.identity || payload;
    try {
      const task = await prisma.$transaction(async (tx: any) => {
        const replay = await tx.agentTask.findUnique({ where: { operationKey }, include: agentTaskInclude });
        if (replay) {
          this.assertAgentTaskReplay(replay, payload, operationKey);
          return replay;
        }
        return tx.agentTask.create({
          data: {
            id: taskId,
            operationKey,
            status: String(payload.status || "created"),
            taskType: String(payload.taskType || "customer_service"),
            lane: payload.lane || null,
            routeAction: payload.routeAction || null,
            planType: payload.planType || null,
            reason: payload.reason || null,
            objective: payload.objective || null,
            wechatAccountId: identity.wechatAccountId || null,
            conversationId: identity.conversationId || null,
            customerId: identity.customerId || null,
            routeId: payload.createdFrom?.routeId || payload.routeId || null,
            inboundMessageId: payload.createdFrom?.inboundMessageId || payload.inboundMessageId || null,
            currentStep: payload.nextStep || payload.currentStep || null,
            payload: this.jsonOrNull(payload.payload || payload),
            handoff: this.jsonOrNull(payload.handoff),
            steps: {
              create: (Array.isArray(payload.steps) ? payload.steps : []).map((step: any) => ({
                id: deterministicOperationId("agent_step", `${taskId}:${String(step.key || "step")}`),
                stepKey: String(step.key || "step"),
                status: String(step.status || "planned"),
                mode: step.mode || null,
                toolName: step.tool || step.toolName || null,
                idempotencyKey: step.idempotencyKey || null,
                input: this.jsonOrNull(step.input),
                output: this.jsonOrNull(step.output),
              })),
            },
            toolExecutions: {
              create: (Array.isArray(payload.steps) ? payload.steps : [])
                .filter((step: any) => String(step.tool || step.toolName || "").trim())
                .map((step: any) => {
                  const toolName = String(step.tool || step.toolName || "").trim();
                  const definition = getToolDefinition(toolName) || {};
                  const toolOperationKey = `${operationKey}:${String(step.key || "step")}:tool`;
                  return {
                    id: deterministicOperationId("agent_tool_execution", toolOperationKey),
                    stepKey: String(step.key || "step"),
                    operationKey: toolOperationKey,
                    toolName,
                    toolVersion: String(definition.version || "1"),
                    effect: String(definition.effect || "unknown"),
                    capability: definition.requiredCapability || null,
                    status: String(step.status || "planned") === "completed" ? "succeeded" : "planned",
                    idempotencyKey: step.idempotencyKey || null,
                    input: this.jsonOrNull(step.input),
                    output: this.jsonOrNull(step.output),
                  };
                }),
            },
            ...(String(payload.status || "created") === "awaiting_approval"
              ? {
                  approvals: {
                    create: {
                      id: deterministicOperationId("agent_approval", taskId),
                      status: "pending",
                      policy: String(payload.approvalPolicy || payload.approval?.policy || "human"),
                      requestedBy: String(payload.approval?.requestedBy || "agent"),
                      metadata: this.jsonOrNull(payload.approval?.metadata || { reason: payload.reason, lane: payload.lane }),
                    },
                  },
                }
              : {}),
          },
          include: agentTaskInclude,
        });
      });
      return this.hydrateAgentTask(task);
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const replay = await prisma.agentTask.findUnique({ where: { operationKey }, include: agentTaskInclude });
      if (!replay) throw error;
      this.assertAgentTaskReplay(replay, payload, operationKey);
      return this.hydrateAgentTask(replay);
    }
  }

  async updateAgentTask(id: string, patch: any = {}) {
    if (this.isLocal) return this.localStore.updateAgentTask(id, patch);
    const data: any = {};
    for (const key of ["status", "currentStep", "errorCode", "errorMessage"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) data[key] = patch[key];
    }
    if (Object.prototype.hasOwnProperty.call(patch, "completedAt")) {
      data.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "payload")) data.payload = this.jsonOrNull(patch.payload);
    if (Object.prototype.hasOwnProperty.call(patch, "handoff")) data.handoff = this.jsonOrNull(patch.handoff);
    const task = await (this.prisma as any).agentTask.update({
      where: { id: String(id || "") },
      data,
      include: agentTaskInclude,
    });
    return this.hydrateAgentTask(task);
  }

  async createAgentTaskApproval(taskId: string, payload: any = {}) {
    if (this.isLocal) return this.localStore.createAgentTaskApproval(taskId, payload);
    const prisma = this.prisma as any;
    const approvalKey = normalizeOperationKey(
      payload.operationKey || `${String(taskId || "")}:${String(payload.toolExecutionId || "tool")}`,
      "agent task approval operationKey",
    );
    const approvalId = String(payload.id || deterministicOperationId("agent_approval", approvalKey));
    const now = new Date();
    try {
      await prisma.$transaction(async (tx: any) => {
        const task = await tx.agentTask.findUnique({ where: { id: String(taskId || "") } });
        if (!task) throw new BadRequestException(`agent task not found: ${taskId}`);
        const existing = await tx.agentTaskApproval.findUnique({ where: { id: approvalId } });
        if (existing) return;
        await tx.agentTaskApproval.create({
          data: {
            id: approvalId,
            taskId: task.id,
            status: "pending",
            policy: String(payload.policy || "human"),
            requestedBy: String(payload.requestedBy || "agent"),
            metadata: this.jsonOrNull(payload.metadata || {}),
            requestedAt: now,
          },
        });
        await tx.agentTask.update({
          where: { id: task.id },
          data: {
            status: "awaiting_approval",
            currentStep: String(payload.currentStep || `approval.${String(payload.toolExecutionId || "tool")}`),
            completedAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
      });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
    }
    return this.getAgentTask(taskId);
  }

  async decideAgentTaskApproval(taskId: string, approvalId: string, payload: any = {}) {
    if (this.isLocal) return this.localStore.decideAgentTaskApproval(taskId, approvalId, payload);
    const decision = String(payload.decision || "").trim().toLowerCase();
    if (!["approved", "rejected"].includes(decision)) {
      throw new BadRequestException("agent task approval decision must be approved or rejected");
    }
    const prisma = this.prisma as any;
    const result = await prisma.$transaction(async (tx: any) => {
      const approval = await tx.agentTaskApproval.findUnique({ where: { id: String(approvalId || "") } });
      if (!approval || approval.taskId !== String(taskId || "")) {
        throw new BadRequestException(`agent task approval not found: ${approvalId}`);
      }
      if (approval.status !== "pending") {
        if (approval.status === decision) return { taskId: approval.taskId };
        throw new ConflictException("agent task approval has already been decided");
      }
      const now = new Date();
      const note = String(payload.note || "").trim() || null;
      await tx.agentTaskApproval.update({
        where: { id: approval.id },
        data: {
          status: decision,
          reviewer: String(payload.reviewer || "人工客服"),
          decisionNote: note,
          decidedAt: now,
        },
      });
      await tx.agentTaskStep.updateMany({
        where: { taskId: approval.taskId, mode: "approval", status: "pending" },
        data: { status: decision, completedAt: now },
      });
      await tx.agentTask.update({
        where: { id: approval.taskId },
        data: {
          status: decision === "approved" ? "ready" : "failed",
          currentStep: decision === "approved" ? "reply.compose" : "approval.rejected",
          errorMessage: decision === "rejected" ? `审批拒绝${note ? `：${note}` : ""}` : null,
          ...(decision === "rejected" ? { completedAt: now } : { completedAt: null }),
        },
      });
      return { taskId: approval.taskId };
    });
    return this.getAgentTask(result.taskId);
  }

  async listAgentTaskToolExecutions(filter: IdentityFilter & { taskId?: string; status?: string; limit?: number } = {}) {
    if (this.isLocal) return this.localStore.listAgentTaskToolExecutions(filter);
    const rows = await (this.prisma as any).agentTaskToolExecution.findMany({
      where: {
        ...(filter.taskId ? { taskId: filter.taskId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...((filter.wechatAccountId || filter.conversationId || filter.customerId)
          ? { task: {
              ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
              ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
              ...(filter.customerId ? { customerId: filter.customerId } : {}),
            } }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(Number(filter.limit || 100), 500)),
    });
    return rows;
  }

  async getAgentTaskToolExecution(id: string) {
    if (this.isLocal) return this.localStore.getAgentTaskToolExecution(id);
    return (this.prisma as any).agentTaskToolExecution.findUnique({ where: { id: String(id || "") } });
  }

  async updateAgentTaskToolExecution(id: string, patch: any = {}) {
    if (this.isLocal) return this.localStore.updateAgentTaskToolExecution(id, patch);
    const data: any = {};
    for (const key of ["status", "errorCode", "errorMessage", "idempotencyKey"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) data[key] = patch[key];
    }
    if (Object.prototype.hasOwnProperty.call(patch, "input")) data.input = this.jsonOrNull(patch.input);
    if (Object.prototype.hasOwnProperty.call(patch, "output")) data.output = this.jsonOrNull(patch.output);
    for (const key of ["startedAt", "completedAt"]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) data[key] = patch[key] ? new Date(patch[key]) : null;
    }
    return (this.prisma as any).agentTaskToolExecution.update({ where: { id: String(id || "") }, data });
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
    if (this.isLocal) {
      const task = this.localStore.createSendTask(payload);
      await this.syncAgentTaskFromSendTask(task);
      return task;
    }
    const prisma = this.prisma as any;
    const operationKey = payload.operationKey ? normalizeOperationKey(payload.operationKey) : null;
    const taskId = operationKey ? deterministicOperationId("send", operationKey) : payload.id;
    if (taskId && operationKey) {
      const existing = await prisma.wechatSendTask.findUnique({ where: { id: taskId }, include: taskInclude });
      if (existing) {
        this.assertSendTaskReplay(existing, payload, operationKey);
        const hydrated = (await this.attachQuotes([existing]))[0];
        await this.syncAgentTaskFromSendTask(hydrated);
        return hydrated;
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
      const hydrated = (await this.attachQuotes([task]))[0];
      await this.syncAgentTaskFromSendTask(hydrated);
      return hydrated;
    } catch (error) {
      if (operationKey && taskId && isUniqueConstraintError(error)) {
        const winner = await prisma.wechatSendTask.findUnique({ where: { id: taskId }, include: taskInclude });
        if (winner) {
          this.assertSendTaskReplay(winner, payload, operationKey);
          const hydrated = (await this.attachQuotes([winner]))[0];
          await this.syncAgentTaskFromSendTask(hydrated);
          return hydrated;
        }
      }
      throw error;
    }
  }

  async updateSendTask(id: string, patch: any) {
    if (this.isLocal) {
      const task = this.localStore.updateSendTask(id, patch);
      await this.syncAgentTaskFromSendTask(task);
      return task;
    }
    const data = this.sendTaskPatch(patch);
    const task = await (this.prisma as any).wechatSendTask.update({
      where: { id },
      data,
      include: taskInclude,
    });
    const hydrated = (await this.attachQuotes([task]))[0];
    await this.syncAgentTaskFromSendTask(hydrated);
    return hydrated;
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
      const result = this.localStore.completeSendAttemptAndTask(params);
      if (result?.task) await this.syncAgentTaskFromSendTask(result.task);
      return result;
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
    const completedTask = await this.getSendTask(params.taskId);
    const result = {
      task: completedTask,
      attempt: await (this.prisma as any).wechatSendAttempt.findUnique({
        where: { id: params.attemptId },
        include: attemptInclude,
      }),
    };
    if (result.task) await this.syncAgentTaskFromSendTask(result.task);
    return result;
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
    if (this.isLocal) {
      const task = this.localStore.updateSendTask(params.taskId, params.taskPatch);
      await this.syncAgentTaskFromSendTask(task);
      return task;
    }
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
    const task = await this.getSendTask(params.taskId);
    if (task) await this.syncAgentTaskFromSendTask(task);
    return task;
  }

  async claimQueuedTaskAndCreateAttempt(params: {
    taskId: string;
    taskPatch: any;
    attempt: any;
    claimGuard?: {
      requireAccountQueueHead?: boolean;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
      latestInboundMessageId?: string;
    };
  }) {
    if (this.isLocal) {
      const result = this.localStore.claimQueuedSendTaskAndCreateAttempt(params);
      if (result?.task) await this.syncAgentTaskFromSendTask(result.task);
      return result;
    }
    const prisma = this.prisma as any;
    const claimResult = await prisma.$transaction(async (tx: any) => {
      const currentTask = await tx.wechatSendTask.findUnique({ where: { id: params.taskId } });
      if (!currentTask || currentTask.status !== "queued") return null;
      const guard = params.claimGuard || {};
      if (
        (guard.wechatAccountId && currentTask.wechatAccountId !== guard.wechatAccountId)
        || (guard.conversationId && currentTask.conversationId !== guard.conversationId)
      ) return null;
      const lockTime = new Date();
      if (guard.requireAccountQueueHead) {
        const accountLock = await tx.wechatAccount.updateMany({
          where: { id: currentTask.wechatAccountId },
          data: { updatedAt: lockTime },
        });
        if (accountLock.count !== 1) return null;
      }
      const conversationLock = await tx.conversation.updateMany({
        where: { id: currentTask.conversationId, wechatAccountId: currentTask.wechatAccountId },
        data: { updatedAt: lockTime },
      });
      if (conversationLock.count !== 1) return null;
      const conversation = await tx.conversation.findUnique({
        where: { id: currentTask.conversationId },
        select: { customerId: true },
      });
      if (!conversation || (guard.customerId && String(conversation.customerId || "") !== guard.customerId)) return null;
      if (guard.requireAccountQueueHead) {
        const anotherSendingTask = await tx.wechatSendTask.findFirst({
          where: {
            id: { not: currentTask.id },
            wechatAccountId: currentTask.wechatAccountId,
            status: "sending",
          },
          select: { id: true },
        });
        if (anotherSendingTask) return null;
        const queueHead = await tx.wechatSendTask.findFirst({
          where: { wechatAccountId: currentTask.wechatAccountId, status: "queued" },
          orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (!queueHead || queueHead.id !== currentTask.id) return null;
      }
      if (guard.latestInboundMessageId) {
        const latestInbound = await tx.message.findFirst({
          where: { conversationId: currentTask.conversationId, direction: "inbound" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (!latestInbound || latestInbound.id !== guard.latestInboundMessageId) return null;
      }
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
    if (!claimResult) return null;
    const resultTask = await this.getSendTask(params.taskId);
    const result = {
      task: resultTask,
      attempt: await (this.prisma as any).wechatSendAttempt.findUnique({
        where: { id: claimResult.attemptId },
        include: attemptInclude,
      }),
    };
    if (result.task) await this.syncAgentTaskFromSendTask(result.task);
    return result;
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
      await this.syncAgentTaskFromSendTask(task);
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
    const resultTask = await this.getSendTask(params.taskId);
    const result = {
      task: resultTask,
      attempt: params.attemptId
        ? await prisma.wechatSendAttempt.findUnique({ where: { id: params.attemptId }, include: attemptInclude })
        : null,
    };
    if (result.task) await this.syncAgentTaskFromSendTask(result.task);
    return result;
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

  async upsertWechatWorkAccount(payload: { openKfid: string; name?: string; avatar?: string }) {
    if (this.isLocal) return this.localStore.upsertWechatWorkAccount(payload);
    const openKfid = String(payload.openKfid || "").trim();
    if (!openKfid) throw new BadRequestException("wechat work account requires openKfid");
    const officialName = String(payload.name || "").trim();
    const accountId = deterministicOperationId("wwacct", this.wechatWorkCanonicalKey("account", openKfid));
    const displayName = officialName || `企业微信客服 ${shortExternalId(openKfid)}`;
    return (this.prisma as any).wechatAccount.upsert({
      where: { id: accountId },
      create: {
        id: accountId,
        displayName,
        alias: shortExternalId(openKfid),
        isActive: true,
      },
      update: {
        ...(officialName ? { displayName: officialName } : {}),
        isActive: true,
      },
    });
  }

  async upsertWechatWorkBinding(payload: {
    openKfid: string;
    externalUserId: string;
    sendTime?: number;
    customerProfile?: { nickname?: string; avatar?: string };
  }) {
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
          this.upsertCanonicalWechatWorkBinding(tx, {
            openKfid,
            externalUserId,
            lastInboundAt,
            customerProfile: payload.customerProfile,
          }),
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
    payload: {
      openKfid: string;
      externalUserId: string;
      lastInboundAt: Date | null;
      customerProfile?: { nickname?: string; avatar?: string };
    },
  ) {
    const { openKfid, externalUserId, lastInboundAt } = payload;
    const profileName = String(payload.customerProfile?.nickname || "").trim();
    const profileAvatar = String(payload.customerProfile?.avatar || "").trim();
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
      if (profileName || profileAvatar) {
        const previousName = String(existing.customer?.name || "");
        await tx.customer.update({
          where: { id: customerId },
          data: {
            ...(profileName ? { name: profileName } : {}),
            ...(profileAvatar ? { avatarUrl: profileAvatar } : {}),
          },
        });
        if (profileName && (
          existing.conversation?.title === previousName
          || isWechatWorkPlaceholderName(existing.conversation?.title)
        )) {
          await tx.conversation.update({
            where: { id: existing.conversationId },
            data: { title: profileName },
          });
        }
      }
      if (!lastInboundAt) {
        if (!profileName && !profileAvatar) return existing;
        const profiled = await tx.wechatWorkBinding.findUnique({ where: { id: existing.id }, include });
        if (!profiled) throw new BadRequestException("wechat work canonical binding disappeared during profile refresh");
        return profiled;
      }
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
          name: profileName || `企业微信客户 ${shortExternalId(externalUserId)}`,
          avatarUrl: profileAvatar || null,
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

  async upsertWechatWorkAudit(payload: Record<string, unknown>) {
    if (this.isLocal) return this.localStore.upsertWechatWorkAudit(payload);
    const recordId = String(payload.id || "").trim();
    if (!recordId) return this.recordWechatWorkAudit(payload);
    const knownKeys = new Set([
      "id", "action", "status", "msgid", "callbackId", "event", "openKfid", "externalUserId",
      "wechatAccountId", "customerId", "conversationId", "messageId", "sendTaskId", "sendAttemptId",
      "errorMessage", "createdAt",
    ]);
    const metadata = Object.fromEntries(Object.entries(payload).filter(([key]) => !knownKeys.has(key)));
    const data = {
      action: String(payload.action || "unknown"),
      status: String(payload.status || "unknown"),
      ...this.auditScalarFields(payload),
      metadata: Object.keys(metadata).length ? this.jsonOrNull(metadata) : undefined,
    };
    return (this.prisma as any).wechatWorkAuditLog.upsert({
      where: { id: recordId },
      create: {
        id: recordId,
        ...data,
        ...(payload.createdAt ? { createdAt: new Date(String(payload.createdAt)) } : {}),
      },
      update: data,
    });
  }

  async getWechatWorkAuditLog(id: string) {
    if (this.isLocal) return this.localStore.getWechatWorkAuditLog(id);
    const record = await (this.prisma as any).wechatWorkAuditLog.findUnique({ where: { id } });
    if (!record) return null;
    return {
      ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
      ...record,
    };
  }

  async getWechatWorkCustomerUpgrade(id: string) {
    if (this.isLocal) return this.localStore.getWechatWorkCustomerUpgrade(id);
    return (this.prisma as any).wechatWorkCustomerUpgrade.findUnique({ where: { id } });
  }

  async findWechatWorkCustomerUpgradeByState(state: string) {
    if (this.isLocal) return this.localStore.findWechatWorkCustomerUpgradeByState(state);
    return (this.prisma as any).wechatWorkCustomerUpgrade.findUnique({ where: { state } });
  }

  async findWechatWorkCustomerUpgradeByMsgId(msgid: string) {
    if (this.isLocal) return this.localStore.findWechatWorkCustomerUpgradeByMsgId(msgid);
    return (this.prisma as any).wechatWorkCustomerUpgrade.findFirst({
      where: { OR: [{ textMsgId: msgid }, { imageMsgId: msgid }] },
    });
  }

  async findPendingWechatWorkCustomerUpgrade(openKfid: string, externalUserId: string) {
    if (this.isLocal) return this.localStore.findPendingWechatWorkCustomerUpgrade(openKfid, externalUserId);
    return (this.prisma as any).wechatWorkCustomerUpgrade.findFirst({
      where: {
        openKfid,
        externalUserId,
        status: { in: ["partial", "failed", "async_failed"] },
        NOT: { imageStatus: "api_accepted" },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async claimWechatWorkCustomerUpgrade(payload: Record<string, any>) {
    if (this.isLocal) return this.localStore.claimWechatWorkCustomerUpgrade(payload);
    const prisma = this.prisma as any;
    const recordId = String(payload.id || "").trim();
    const claimToken = String(payload.claimToken || "").trim();
    if (!recordId || !claimToken) throw new BadRequestException("customer upgrade claim requires id and claimToken");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await prisma.$transaction(async (tx: any) => {
          const now = new Date();
          const bindingLock = await tx.wechatWorkBinding.updateMany({
            where: {
              openKfid: String(payload.openKfid),
              externalUserId: String(payload.externalUserId),
            },
            data: { updatedAt: now },
          });
          if (bindingLock.count !== 1) {
            throw new BadRequestException("customer upgrade binding changed before specialist selection");
          }
          const binding = await tx.wechatWorkBinding.findUnique({
            where: {
              openKfid_externalUserId: {
                openKfid: String(payload.openKfid),
                externalUserId: String(payload.externalUserId),
              },
            },
          });
          if (
            !binding
            || String(binding.wechatAccountId || "") !== String(payload.wechatAccountId || "")
            || String(binding.conversationId || "") !== String(payload.conversationId || "")
            || String(binding.customerId || "") !== String(payload.customerId || "")
          ) {
            throw new BadRequestException("customer upgrade identity changed before specialist selection");
          }

          const current = await tx.wechatWorkCustomerUpgrade.findUnique({ where: { id: recordId } });
          if (current && ["ready", "queued", "sending", "partial", "api_accepted", "async_failed", "half_added_pending", "identity_unverified", "added_confirmed"].includes(String(current.status || ""))) {
            await this.supersedeOtherWechatWorkCustomerUpgrades(tx, payload, recordId);
            return { mode: "resume", record: current };
          }
          if (
            current?.status === "creating"
            && String(current.claimToken || "") !== claimToken
            && Number(new Date(current.claimExpiresAt || 0)) > now.getTime()
          ) {
            return { mode: "in_progress", record: current };
          }
          const data = {
            corpId: String(payload.corpId),
            openKfid: String(payload.openKfid),
            externalUserId: String(payload.externalUserId),
            wechatAccountId: String(payload.wechatAccountId),
            conversationId: String(payload.conversationId),
            customerId: String(payload.customerId),
            memberUserId: String(payload.memberUserId),
            state: String(payload.state),
            sourceUnionId: String(payload.sourceUnionId || "").trim() || null,
            status: "creating",
            claimToken,
            claimExpiresAt: new Date(now.getTime() + 2 * 60 * 1000),
            version: Math.max(0, Number(current?.version || 0)) + 1,
          };
          if (!current) {
            const record = await tx.wechatWorkCustomerUpgrade.create({ data: { id: recordId, ...data } });
            await this.supersedeOtherWechatWorkCustomerUpgrades(tx, payload, recordId);
            return { mode: "claimed", record };
          }
          const claimed = await tx.wechatWorkCustomerUpgrade.updateMany({
            where: { id: recordId, version: current.version },
            data,
          });
          if (claimed.count !== 1) return null;
          await this.supersedeOtherWechatWorkCustomerUpgrades(tx, payload, recordId);
          return {
            mode: "claimed",
            record: await tx.wechatWorkCustomerUpgrade.findUnique({ where: { id: recordId } }),
          };
        });
        if (result) return result;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    const winner = await prisma.wechatWorkCustomerUpgrade.findUnique({ where: { id: recordId } });
    return { mode: "in_progress", record: winner };
  }

  private async supersedeOtherWechatWorkCustomerUpgrades(prisma: any, payload: Record<string, any>, recordId: string) {
    await prisma.wechatWorkCustomerUpgrade.updateMany({
      where: {
        id: { not: recordId },
        openKfid: String(payload.openKfid || ""),
        externalUserId: String(payload.externalUserId || ""),
        status: { in: ["creating", "ready", "queued", "sending", "partial", "failed", "async_failed", "api_accepted", "half_added_pending"] },
      },
      data: {
        status: "superseded",
        errorMessage: "客户已选择新的长期服务专员，此二维码不再自动恢复。",
        claimToken: null,
        claimExpiresAt: null,
        version: { increment: 1 },
      },
    });
  }

  async updateWechatWorkCustomerUpgrade(
    id: string,
    patch: Record<string, any>,
    expected: { claimToken?: string; version?: number } = {},
  ) {
    if (this.isLocal) return this.localStore.updateWechatWorkCustomerUpgrade(id, patch, expected);
    const prisma = this.prisma as any;
    const dateFields = new Set([
      "claimExpiresAt", "apiAcceptedAt", "asyncFailedAt", "halfAddedAt", "identityVerifiedAt", "addedAt",
    ]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await prisma.wechatWorkCustomerUpgrade.findUnique({ where: { id } });
      if (!current) return null;
      if (expected.claimToken && current.claimToken !== expected.claimToken) return null;
      if (expected.version != null && Number(current.version || 0) !== Number(expected.version)) return null;
      const data = Object.fromEntries(Object.entries(patch).map(([key, value]) => [
        key,
        dateFields.has(key) && value ? new Date(String(value)) : value,
      ]));
      if (current.status === "added_confirmed" && data.status !== "added_confirmed") data.status = "added_confirmed";
      const updated = await prisma.wechatWorkCustomerUpgrade.updateMany({
        where: {
          id,
          version: current.version,
          ...(expected.claimToken ? { claimToken: expected.claimToken } : {}),
        },
        data: { ...data, version: current.version + 1 },
      });
      if (updated.count === 1) return prisma.wechatWorkCustomerUpgrade.findUnique({ where: { id } });
      if (expected.version != null) return null;
    }
    return null;
  }

  async createWechatWorkEventSendTaskFromCredential(params: {
    credentialId: string;
    operationKey: string;
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
    binding: { openKfid: string; externalUserId: string };
    payload: Record<string, unknown>;
    guardSnapshot: Record<string, unknown>;
  }) {
    if (this.isLocal) return this.localStore.createWechatWorkEventSendTaskFromCredential(params);
    const prisma = this.prisma as any;
    const recordId = String(params.credentialId || "").trim();
    const operationKey = normalizeOperationKey(params.operationKey, "operationKey");
    const taskId = deterministicOperationId("send", operationKey);
    const now = new Date();
    const nowIso = now.toISOString();
    const result = await prisma.$transaction(async (tx: any) => {
      const existingTask = await tx.wechatSendTask.findUnique({ where: { id: taskId }, include: taskInclude });
      if (existingTask) {
        throw new BadRequestException("企业微信事件响应发送任务已存在，不能重复创建");
      }
      const record = await tx.wechatWorkAuditLog.findUnique({ where: { id: recordId } });
      if (!record) return null;
      const credential = {
        ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
        ...record,
      };
      if (credential.action !== "event_reply_credential") {
        throw new BadRequestException("企业微信事件响应凭证不存在或已不可用");
      }
      if (
        credential.wechatAccountId !== params.identity.wechatAccountId ||
        credential.conversationId !== params.identity.conversationId ||
        credential.customerId !== params.identity.customerId ||
        credential.openKfid !== params.binding.openKfid ||
        credential.externalUserId !== params.binding.externalUserId
      ) {
        throw new BadRequestException("企业微信事件响应凭证与当前客户身份不一致");
      }
      if (credential.status !== "pending") return null;
      const originalSecret = credential.eventCodeSecret;
      if (!originalSecret || !credential.eventCodeHash) {
        throw new BadRequestException("企业微信事件响应凭证缺少加密体");
      }
      const expiresAt = Date.parse(String(credential.expiresAt || ""));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        const expiredMetadata = {
          ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
          expiredAt: nowIso,
          eventCredentialSecretClearedAt: nowIso,
          eventCredentialSecretStored: false,
        };
        delete expiredMetadata.eventCodeSecret;
        await tx.wechatWorkAuditLog.updateMany({
          where: { id: recordId, action: "event_reply_credential", status: "pending" },
          data: { status: "expired", metadata: this.jsonOrNull(expiredMetadata) },
        });
        return { expired: true };
      }
      const conversation = await tx.conversation.findUnique({ where: { id: params.identity.conversationId } });
      if (!conversation) {
        throw new BadRequestException(`conversation not found: ${params.identity.conversationId}`);
      }
      if (conversation.wechatAccountId !== params.identity.wechatAccountId) {
        throw new BadRequestException("send task conversation binding invalid: wechat account does not match conversation");
      }
      if (conversation.customerId !== params.identity.customerId) {
        throw new BadRequestException("send task customer binding invalid: customer does not match conversation");
      }
      const taskPayload = {
        ...params.payload,
        eventCredentialId: credential.id,
        eventCodeHash: credential.eventCodeHash,
        eventCodeSecret: originalSecret,
        eventCredentialExpiresAt: credential.expiresAt,
      };
      const eventGuardSnapshot = {
        ...params.guardSnapshot,
        eventCredentialId: credential.id,
        eventCodeHash: credential.eventCodeHash,
        eventCredentialExpiresAt: credential.expiresAt,
      };
      const requestOperation = requestOperationMetadata(
        operationKey,
        createSendTaskOperationFingerprint({
          operationKey,
          wechatAccountId: params.identity.wechatAccountId,
          conversationId: params.identity.conversationId,
          customerId: params.identity.customerId,
          payload: taskPayload,
          guardSnapshot: eventGuardSnapshot,
        }, {
          conversationId: params.identity.conversationId,
          customerId: params.identity.customerId,
          wechatAccountId: params.identity.wechatAccountId,
        }),
      );
      const consumedMetadata = {
        ...(record.metadata && typeof record.metadata === "object" ? record.metadata : {}),
        consumedAt: nowIso,
        consumedOperationKey: operationKey,
        eventCredentialSecretClearedAt: nowIso,
        eventCredentialSecretStored: false,
      };
      delete consumedMetadata.eventCodeSecret;
      const claimed = await tx.wechatWorkAuditLog.updateMany({
        where: {
          id: recordId,
          action: "event_reply_credential",
          status: "pending",
          wechatAccountId: params.identity.wechatAccountId,
          conversationId: params.identity.conversationId,
          customerId: params.identity.customerId,
          openKfid: params.binding.openKfid,
          externalUserId: params.binding.externalUserId,
        },
        data: {
          status: "consumed",
          sendTaskId: taskId,
          metadata: this.jsonOrNull(consumedMetadata),
        },
      });
      if (claimed.count !== 1) return null;
      const task = await tx.wechatSendTask.create({
        data: {
          id: taskId,
          status: "queued",
          wechatAccountId: params.identity.wechatAccountId,
          conversationId: params.identity.conversationId,
          designJobId: null,
          quoteDraftId: null,
          payload: taskPayload,
          guardSnapshot: {
            ...(eventGuardSnapshot || { status: "pending", checks: [] }),
            binding: {
              conversationId: params.identity.conversationId,
              customerId: params.identity.customerId,
              wechatAccountId: params.identity.wechatAccountId,
            },
            requestOperation,
          },
          errorMessage: null,
          queuedAt: now,
          sentAt: null,
        },
        include: taskInclude,
      });
      return {
        credential: {
          ...credential,
          status: "consumed",
          sendTaskId: taskId,
          consumedAt: nowIso,
          consumedOperationKey: operationKey,
          eventCredentialSecretClearedAt: nowIso,
          eventCredentialSecretStored: false,
          eventCodeSecret: originalSecret,
        },
        task,
      };
    });
    if (result?.expired) {
      throw new BadRequestException("企业微信事件响应凭证已过期，请等待客户新事件后再发送");
    }
    if (!result) return null;
    return {
      credential: result.credential,
      task: (await this.attachQuotes([result.task]))[0],
    };
  }

  async hasWechatWorkAuditMsgId(msgid: string) {
    if (this.isLocal) return this.localStore.hasWechatWorkAuditMsgId(msgid);
    return Boolean(await (this.prisma as any).wechatWorkAuditLog.findFirst({
      where: {
        msgid,
        OR: [
          { action: "inbound_processed", status: "processed" },
          { action: "inbound_ignored", status: "ignored" },
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

  private assertAgentTaskReplay(existing: any, payload: any, operationKey: string) {
    if (String(existing.operationKey || "") !== operationKey) {
      throw new BadRequestException(`agent task replay changed operationKey: ${operationKey}`);
    }
    const requestedIdentity = payload.identity || payload;
    const storedIdentity = {
      wechatAccountId: existing.wechatAccountId,
      conversationId: existing.conversationId,
      customerId: existing.customerId,
    };
    assertStoredOperationIdentityReplay(storedIdentity, requestedIdentity, "agent task create");
    const expectedObjective = String(payload.objective || "");
    if (expectedObjective && String(existing.objective || "") && expectedObjective !== String(existing.objective)) {
      throw new BadRequestException(`agent task replay changed objective: ${operationKey}`);
    }
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

  private hydrateAgentTask(task: any) {
    return {
      ...task,
      steps: Array.isArray(task?.steps) ? task.steps : [],
      approvals: Array.isArray(task?.approvals) ? task.approvals : [],
      toolExecutions: Array.isArray(task?.toolExecutions) ? task.toolExecutions : [],
    };
  }

  private async syncAgentTaskFromSendTask(task: any) {
    const agentTaskId = String(task?.payload?.agentTaskId || "").trim();
    if (!agentTaskId) return task;
    if (!(await this.getAgentTask(agentTaskId))) return task;
    const sendStatus = String(task?.status || "");
    const status = sendStatus === "sent"
      ? "succeeded"
      : ["uncertain", "unknown_outcome"].includes(sendStatus)
        ? "unknown_outcome"
        : ["failed", "blocked", "cancelled", "dry_run"].includes(sendStatus)
          ? "failed"
          : ["queued", "sending", "pending_ack"].includes(sendStatus)
            ? "executing"
            : null;
    if (!status) return task;
    await this.updateAgentTask(agentTaskId, {
      status,
      currentStep: status === "succeeded" ? "reply.sent" : status === "failed" ? "reply.failed" : "reply.send",
      ...(status === "failed" ? { errorMessage: String(task?.errorMessage || "") || null } : {}),
      ...(status === "unknown_outcome" ? { errorMessage: String(task?.errorMessage || "发送结果未知") } : {}),
    });
    return task;
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
    return normalizeConversationTimelineAttachments(value, status);
  }

  private timelineTaskAttachments(task: any, designAssets: any[]) {
    const imagePaths = Array.isArray(task?.payload?.imagePaths) ? task.payload.imagePaths : [];
    const filePaths = Array.isArray(task?.payload?.filePaths) ? task.payload.filePaths : [];
    const assetIds = Array.isArray(task?.payload?.assetIds) ? task.payload.assetIds.map(String) : [];
    const assetsById = new Map(designAssets.map((asset: any) => [String(asset?.id || ""), asset]));
    const orderedAssets = assetIds.map((assetId: string) => assetsById.get(assetId)).filter(Boolean) as any[];
    const imageAssets = orderedAssets.filter((asset: any) => ["image/jpeg", "image/png"].includes(String(asset?.mimeType || "").toLowerCase()));
    const fileAssets = orderedAssets.filter((asset: any) => !imageAssets.includes(asset));
    return this.timelineAttachments(
      [
        ...imagePaths.map((localPath: string, index: number) => ({
          localPath,
          kind: "image",
          assetId: imageAssets[index]?.id,
          name: imageAssets[index]?.fileName,
          mimeType: imageAssets[index]?.mimeType,
        })),
        ...filePaths.map((localPath: string, index: number) => ({
          localPath,
          kind: "file",
          assetId: fileAssets[index]?.id,
          name: fileAssets[index]?.fileName,
          mimeType: fileAssets[index]?.mimeType,
        })),
      ],
      task?.status || "queued",
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

function isWechatWorkPlaceholderName(value: unknown) {
  return /^企业微信客户(?:\s|$)/.test(String(value || "").trim());
}

const TRUSTED_RPA_TIMELINE_SOURCES = new Set(["uia_accessibility", "ocr_verified_bubble"]);

function isTrustedTimelineMessage(message: any, rpaMessageIds: Set<string>) {
  if (isSyntheticTimelineText(message?.text)) return false;
  if (message?.direction !== "inbound" || !rpaMessageIds.has(String(message?.id || ""))) return true;
  return TRUSTED_RPA_TIMELINE_SOURCES.has(String(message?.metadata?.inboundCaptureSource || ""));
}

function isSyntheticTimelineText(value: unknown) {
  const text = String(value || "").trim();
  return text === "你的回复内容" || /^RPA入站测试(?:-|$)/i.test(text);
}
