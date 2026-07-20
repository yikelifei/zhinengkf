import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { deterministicOperationId, isUniqueConstraintError } from "../shared/operation-idempotency";

export type PersonalWechatRpaBindingInput = {
  wechatAccountId: string;
  accountNickname: string;
  ownerWxId: string;
  chatTitle: string;
  conversationType?: string;
  senderName?: string;
  receivedAt?: string;
};

export type PersonalWechatRpaAuditInput = {
  direction: string;
  status: string;
  reason?: unknown;
  accountNickname?: unknown;
  ownerWxId?: unknown;
  chatTitle?: unknown;
  externalId?: unknown;
  wechatAccountId?: unknown;
  customerId?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  sendTaskId?: unknown;
  errorMessage?: unknown;
  createdAt?: unknown;
};

export type PersonalWechatRpaPage = {
  wechatAccountId: string;
  take?: number;
  cursor?: string;
};

export type PersonalWechatRpaInboundClaimInput = PersonalWechatRpaBindingInput & {
  externalId: string;
  requestFingerprint: string;
  normalizedPayload: Record<string, unknown>;
  claimToken: string;
  leaseExpiresAt: string;
};

/**
 * Business records are durable in PostgreSQL when USE_LOCAL_STORE=false.
 * Host registry credentials and Windows process/session bindings never enter this adapter.
 */
export class PersonalWechatRpaPersistence {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
  ) {}

  get isLocal() {
    return appConfig.useLocalStore;
  }

  async upsertBinding(payload: PersonalWechatRpaBindingInput) {
    const input = normalizeBindingInput(payload);
    if (this.isLocal) {
      return hydrateBinding(this.localStore.upsertPersonalWechatRpaBinding({
        ...input,
        senderName: input.senderName || undefined,
        receivedAt: input.receivedAt.toISOString(),
      }));
    }

    const prisma = this.prisma as any;
    return prisma.$transaction((tx: any) => this.upsertPrismaBinding(tx, input));
  }

  private async upsertPrismaBinding(tx: any, input: ReturnType<typeof normalizeBindingInput>) {
      const accountByOwner = await tx.wechatAccount.findUnique({
        where: { personalWechatOwnerWxId: input.ownerWxId },
      });
      if (accountByOwner && accountByOwner.id !== input.wechatAccountId) {
        throw identityConflict("ownerWxId is already bound to another WeChat account");
      }

      await tx.wechatAccount.upsert({
        where: { id: input.wechatAccountId },
        update: {},
        create: {
          id: input.wechatAccountId,
          displayName: input.accountNickname,
          alias: input.ownerWxId,
          isActive: true,
          personalWechatOwnerWxId: input.ownerWxId,
          personalWechatAccountNickname: input.accountNickname,
        },
      });
      const account = await tx.wechatAccount.findUnique({ where: { id: input.wechatAccountId } });
      assertAccountIdentity(account, input);

      await tx.customer.upsert({
        where: { personalWechatRpaBindingKey: input.bindingKey },
        update: {},
        create: {
          name: input.chatTitle,
          source: "personal_wechat_rpa",
          personalWechatRpaBindingKey: input.bindingKey,
          tags: [input.conversationType === "group" ? "个人微信群聊" : "个人微信好友"],
        },
      });
      const customer = await tx.customer.findUnique({
        where: { personalWechatRpaBindingKey: input.bindingKey },
      });
      if (!customer || customer.name !== input.chatTitle || customer.source !== "personal_wechat_rpa") {
        throw identityConflict("chat title is already bound to a different customer identity");
      }

      const existingSameTitle = await tx.personalWechatRpaBinding.findFirst({
        where: {
          wechatAccountId: input.wechatAccountId,
          chatTitle: input.chatTitle,
          NOT: { bindingKey: input.bindingKey },
        },
      });
      if (existingSameTitle) {
        throw identityConflict("duplicate chat title requires manual rebind");
      }

      const externalChatId = `personal_wechat_rpa:${input.bindingKey}`;
      await tx.conversation.upsert({
        where: {
          wechatAccountId_externalChatId: {
            wechatAccountId: input.wechatAccountId,
            externalChatId,
          },
        },
        update: {},
        create: {
          channel: "personal_wechat",
          externalChatId,
          title: input.chatTitle,
          customerId: customer.id,
          wechatAccountId: input.wechatAccountId,
          lastMessageAt: input.receivedAt,
          manualLocked: false,
        },
      });
      const conversation = await tx.conversation.findUnique({
        where: {
          wechatAccountId_externalChatId: {
            wechatAccountId: input.wechatAccountId,
            externalChatId,
          },
        },
      });
      if (
        !conversation ||
        conversation.channel !== "personal_wechat" ||
        conversation.title !== input.chatTitle ||
        conversation.customerId !== customer.id ||
        conversation.wechatAccountId !== input.wechatAccountId
      ) {
        throw identityConflict("conversation identity changed; manual rebind is required");
      }

      const existingBinding = await tx.personalWechatRpaBinding.findUnique({
        where: { bindingKey: input.bindingKey },
      });
      if (existingBinding) assertBindingIdentity(existingBinding, input, customer.id, conversation.id);
      if (
        existingBinding &&
        input.conversationType === "direct" &&
        existingBinding.senderName &&
        input.senderName &&
        existingBinding.senderName !== input.senderName
      ) {
        throw identityConflict("direct chat sender changed; duplicate chat title requires manual rebind");
      }

      await tx.conversation.updateMany({
        where: {
          id: conversation.id,
          OR: [
            { lastMessageAt: null },
            { lastMessageAt: { lt: input.receivedAt } },
          ],
        },
        data: { lastMessageAt: input.receivedAt },
      });
      await tx.personalWechatRpaBinding.upsert({
        where: { bindingKey: input.bindingKey },
        update: {
          senderName: input.senderName,
        },
        create: {
          bindingKey: input.bindingKey,
          ownerWxId: input.ownerWxId,
          accountNickname: input.accountNickname,
          chatTitle: input.chatTitle,
          conversationType: input.conversationType,
          senderName: input.senderName,
          wechatAccountId: input.wechatAccountId,
          customerId: customer.id,
          conversationId: conversation.id,
          lastInboundAt: input.receivedAt,
        },
      });
      await tx.personalWechatRpaBinding.updateMany({
        where: {
          bindingKey: input.bindingKey,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: input.receivedAt } },
          ],
        },
        data: { lastInboundAt: input.receivedAt },
      });
      const binding = await tx.personalWechatRpaBinding.findUnique({
        where: { bindingKey: input.bindingKey },
        include: { wechatAccount: true, customer: true, conversation: true },
      });
      if (!binding) throw identityConflict("personal WeChat binding disappeared during timestamp advance");
      return hydrateBinding(binding);
  }

  async claimInboundAndBind(payload: PersonalWechatRpaInboundClaimInput) {
    const input = normalizeBindingInput(payload);
    const externalId = requiredText(payload.externalId, "externalId");
    const requestFingerprint = requiredText(payload.requestFingerprint, "requestFingerprint");
    const claimToken = requiredText(payload.claimToken, "claimToken");
    const leaseExpiresAt = new Date(requiredText(payload.leaseExpiresAt, "leaseExpiresAt"));
    if (!Number.isFinite(leaseExpiresAt.getTime())) throw new BadRequestException("leaseExpiresAt must be an ISO date");
    const operationId = deterministicOperationId("inbound", `${input.wechatAccountId}:${externalId}`);
    const operationInput = {
      id: operationId,
      source: "personal_wechat_rpa",
      wechatAccountId: input.wechatAccountId,
      externalId,
      requestFingerprint,
      normalizedPayload: payload.normalizedPayload,
      bindingKey: input.bindingKey,
      claimToken,
      leaseExpiresAt,
    };

    if (this.isLocal) {
      const claimed = this.localStore.claimInboundMessageOperation({
        ...operationInput,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      });
      if (!claimed.claimed) {
        return { ...claimed, binding: this.bindingForOperationLocal(claimed.operation) };
      }
      if (claimed.operation?.stage && claimed.operation.stage !== "reserved") {
        const binding = this.bindingForOperationLocal(claimed.operation);
        if (!binding) throw new BadRequestException("resumable inbound operation is missing its durable binding");
        return { ...claimed, binding };
      }
      try {
        const binding = await this.upsertBinding(payload);
        const operation = this.localStore.updateInboundMessageOperation(operationId, claimToken, {
          stage: "binding_ready",
          bindingKey: input.bindingKey,
          customerId: binding.customerId,
          conversationId: binding.conversationId,
        });
        return { operation, binding, claimed: true, completed: false };
      } catch (error) {
        this.localStore.updateInboundMessageOperation(operationId, claimToken, {
          status: "retryable",
          claimToken: null,
          leaseExpiresAt: null,
          lastError: error instanceof Error ? error.message : "binding reservation failed",
        });
        throw error;
      }
    }

    const prisma = this.prisma as any;
    try {
      return await prisma.$transaction(async (tx: any) => {
        const operation = await tx.inboundMessageOperation.create({ data: operationInput });
        const binding = await this.upsertPrismaBinding(tx, input);
        const advanced = await tx.inboundMessageOperation.update({
          where: { id: operation.id },
          data: {
            stage: "binding_ready",
            customerId: binding.customerId,
            conversationId: binding.conversationId,
          },
        });
        return { operation: advanced, binding, claimed: true, completed: false };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await prisma.inboundMessageOperation.findUnique({
        where: { wechatAccountId_externalId: { wechatAccountId: input.wechatAccountId, externalId } },
      });
      if (!existing) throw error;
      this.assertInboundOperationReplay(existing, operationInput);
      const binding = await this.bindingForOperationPrisma(existing);
      if (existing.status === "completed") return { operation: existing, binding, claimed: false, completed: true };
      const activeLease = existing.status === "processing" && new Date(existing.leaseExpiresAt || 0).getTime() > Date.now();
      if (activeLease) return { operation: existing, binding, claimed: false, completed: false, inProgress: true };
      const claimed = await prisma.inboundMessageOperation.updateMany({
        where: {
          id: existing.id,
          requestFingerprint,
          status: { not: "completed" },
          OR: [
            { status: { in: ["retryable", "failed"] } },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          status: "processing",
          claimToken,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
          lastError: null,
        },
      });
      if (claimed.count !== 1) {
        const current = await prisma.inboundMessageOperation.findUnique({ where: { id: existing.id } });
        if (current?.status === "completed") {
          return { operation: current, binding, claimed: false, completed: true };
        }
        return { operation: current || existing, binding, claimed: false, completed: false, inProgress: true };
      }
      const operation = await prisma.inboundMessageOperation.findUnique({ where: { id: existing.id } });
      return { operation, binding, claimed: true, completed: false };
    }
  }

  private bindingForOperationLocal(operation: any) {
    if (!operation?.conversationId || !operation?.customerId) return null;
    return this.localStore.findPersonalWechatRpaBindingByIdentity({
      wechatAccountId: operation.wechatAccountId,
      conversationId: operation.conversationId,
      customerId: operation.customerId,
    });
  }

  private async bindingForOperationPrisma(operation: any) {
    if (!operation?.conversationId || !operation?.customerId) return null;
    return this.findBindingByIdentity({
      wechatAccountId: operation.wechatAccountId,
      conversationId: operation.conversationId,
      customerId: operation.customerId,
    });
  }

  private assertInboundOperationReplay(existing: any, requested: any) {
    if (
      existing.source !== requested.source ||
      existing.wechatAccountId !== requested.wechatAccountId ||
      existing.externalId !== requested.externalId ||
      existing.requestFingerprint !== requested.requestFingerprint ||
      String(existing.bindingKey || "") !== String(requested.bindingKey || "")
    ) {
      throw new BadRequestException("duplicate inbound externalId conflict: account, chat identity or payload changed");
    }
  }

  async listBindings(page: PersonalWechatRpaPage) {
    const input = normalizePage(page, 100);
    if (this.isLocal) return this.localStore.listPersonalWechatRpaBindings(input).map(hydrateBinding);
    const model = (this.prisma as any).personalWechatRpaBinding;
    if (input.cursor) {
      const cursor = await model.findUnique({ where: { id: input.cursor }, select: { wechatAccountId: true } });
      assertScopedCursor(cursor, input.wechatAccountId);
    }
    const rows = await model.findMany({
      where: { wechatAccountId: input.wechatAccountId },
      include: { wechatAccount: true, customer: true, conversation: true },
      orderBy: [{ lastInboundAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return rows.map(hydrateBinding);
  }

  async findInboundMessageByExternalId(wechatAccountId: string, externalId: string) {
    const accountId = requiredText(wechatAccountId, "wechatAccountId");
    const messageExternalId = requiredText(externalId, "externalId");
    if (this.isLocal) {
      return this.localStore.findInboundMessageByExternalId(accountId, messageExternalId);
    }
    const message = await (this.prisma as any).message.findFirst({
      where: {
        direction: "inbound",
        externalId: messageExternalId,
        conversation: { wechatAccountId: accountId },
      },
      include: { conversation: true },
    });
    if (!message) return null;
    return {
      ...message,
      customerId: message.conversation?.customerId || null,
      wechatAccountId: message.conversation?.wechatAccountId || null,
      metadata: message.metadata || {},
    };
  }

  async findInboundOperation(wechatAccountId: string, externalId: string) {
    const accountId = requiredText(wechatAccountId, "wechatAccountId");
    const messageExternalId = requiredText(externalId, "externalId");
    if (this.isLocal) return this.localStore.getInboundMessageOperation(accountId, messageExternalId);
    return (this.prisma as any).inboundMessageOperation.findUnique({
      where: { wechatAccountId_externalId: { wechatAccountId: accountId, externalId: messageExternalId } },
    });
  }

  async findBindingByIdentity(identity: { wechatAccountId: string; conversationId: string; customerId: string }) {
    if (this.isLocal) return this.localStore.findPersonalWechatRpaBindingByIdentity(identity);
    const binding = await (this.prisma as any).personalWechatRpaBinding.findFirst({
      where: {
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
      },
      include: { wechatAccount: true, customer: true, conversation: true },
    });
    return binding ? hydrateBinding(binding) : null;
  }

  async recordAudit(payload: PersonalWechatRpaAuditInput, sensitiveValues: unknown[] = []) {
    const record = normalizeAudit(payload, sensitiveValues);
    if (this.isLocal) return this.localStore.recordPersonalWechatRpaAudit(record);
    return (this.prisma as any).personalWechatRpaAuditLog.create({ data: record });
  }

  async listAudit(page: PersonalWechatRpaPage) {
    const input = normalizePage(page, 20);
    if (this.isLocal) return this.localStore.listPersonalWechatRpaAuditLogs(input);
    const model = (this.prisma as any).personalWechatRpaAuditLog;
    if (input.cursor) {
      const cursor = await model.findUnique({ where: { id: input.cursor }, select: { wechatAccountId: true } });
      assertScopedCursor(cursor, input.wechatAccountId);
    }
    return model.findMany({
      where: { wechatAccountId: input.wechatAccountId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
  }
}

function normalizeBindingInput(payload: PersonalWechatRpaBindingInput) {
  const wechatAccountId = requiredText(payload.wechatAccountId, "wechatAccountId");
  const accountNickname = requiredText(payload.accountNickname, "accountNickname");
  const ownerWxId = requiredText(payload.ownerWxId, "ownerWxId");
  const chatTitle = requiredText(payload.chatTitle, "chatTitle");
  const conversationType = String(payload.conversationType || "direct").trim().toLowerCase();
  if (!["direct", "group", "enterprise", "unknown"].includes(conversationType)) {
    throw new BadRequestException("unsupported conversationType");
  }
  const receivedAt = new Date(String(payload.receivedAt || new Date().toISOString()));
  if (!Number.isFinite(receivedAt.getTime())) throw new BadRequestException("receivedAt must be an ISO date");
  return {
    wechatAccountId,
    accountNickname,
    ownerWxId,
    chatTitle,
    conversationType,
    senderName: optionalText(payload.senderName),
    receivedAt,
    bindingKey: personalWechatRpaBindingKey(ownerWxId, chatTitle),
  };
}

function normalizePage(page: PersonalWechatRpaPage, fallback: number) {
  const wechatAccountId = requiredText(page?.wechatAccountId, "wechatAccountId");
  const requested = Number(page?.take ?? fallback);
  const take = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 500)) : fallback;
  return { wechatAccountId, take, cursor: optionalText(page?.cursor) || undefined };
}

function normalizeAudit(payload: PersonalWechatRpaAuditInput, sensitiveValues: unknown[]) {
  const createdAtText = optionalText(payload.createdAt);
  const createdAt = createdAtText ? new Date(createdAtText) : new Date();
  if (!Number.isFinite(createdAt.getTime())) throw new BadRequestException("audit createdAt must be an ISO date");
  return {
    direction: requiredText(payload.direction, "audit direction"),
    status: requiredText(payload.status, "audit status"),
    reason: optionalText(payload.reason),
    accountNickname: optionalText(payload.accountNickname),
    ownerWxId: optionalText(payload.ownerWxId),
    chatTitle: optionalText(payload.chatTitle),
    externalId: optionalText(payload.externalId),
    wechatAccountId: optionalText(payload.wechatAccountId),
    customerId: optionalText(payload.customerId),
    conversationId: optionalText(payload.conversationId),
    messageId: optionalText(payload.messageId),
    sendTaskId: optionalText(payload.sendTaskId),
    errorMessage: sanitizeError(payload.errorMessage, sensitiveValues),
    createdAt,
  };
}

function assertAccountIdentity(account: any, input: ReturnType<typeof normalizeBindingInput>) {
  if (!account) throw identityConflict("canonical WeChat account was not created");
  if (
    account.id !== input.wechatAccountId ||
    account.personalWechatOwnerWxId !== input.ownerWxId ||
    account.personalWechatAccountNickname !== input.accountNickname ||
    account.displayName !== input.accountNickname
  ) {
    throw identityConflict("registry account identity conflicts with the persisted WeChat account");
  }
}

function assertBindingIdentity(binding: any, input: ReturnType<typeof normalizeBindingInput>, customerId: string, conversationId: string) {
  if (
    binding.wechatAccountId !== input.wechatAccountId ||
    binding.ownerWxId !== input.ownerWxId ||
    binding.accountNickname !== input.accountNickname ||
    binding.chatTitle !== input.chatTitle ||
    binding.conversationType !== input.conversationType ||
    binding.customerId !== customerId ||
    binding.conversationId !== conversationId
  ) {
    throw identityConflict("personal WeChat binding identity changed; manual rebind is required");
  }
}

function hydrateBinding(binding: any) {
  const account = binding?.wechatAccount || null;
  return {
    ...binding,
    wechatAccount: account
      ? {
          id: account.id,
          displayName: account.displayName,
          alias: account.alias || null,
          isActive: account.isActive,
          lastSeenAt: account.lastSeenAt || null,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          platform: "personal_wechat_rpa",
          personalWechatRpa: {
            ownerWxId: binding.ownerWxId,
            accountNickname: binding.accountNickname,
          },
        }
      : null,
    conversation: binding?.conversation
      ? {
          ...binding.conversation,
          personalWechatRpa: {
            ownerWxId: binding.ownerWxId,
            chatTitle: binding.chatTitle,
            conversationType: binding.conversationType,
          },
        }
      : null,
  };
}

function sanitizeError(value: unknown, sensitiveValues: unknown[]) {
  let text = optionalText(value);
  if (!text) return null;
  for (const sensitive of sensitiveValues.map((item) => String(item || "").trim()).filter(Boolean)) {
    text = text.split(sensitive).join("[redacted]");
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?[^\s]*/gi, "[local-endpoint]")
    .replace(/([?&](?:token|access_token|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || null;
}

function personalWechatRpaBindingKey(ownerWxId: string, chatTitle: string) {
  return createHash("sha256").update(`${ownerWxId}\n${chatTitle}`, "utf8").digest("hex");
}

function requiredText(value: unknown, field: string) {
  const text = String(value || "").trim();
  if (!text) throw new BadRequestException(`${field} is required`);
  return text;
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function identityConflict(message: string) {
  return new BadRequestException(message);
}

function assertScopedCursor(cursor: any, wechatAccountId: string) {
  if (!cursor || cursor.wechatAccountId !== wechatAccountId) {
    throw new BadRequestException("pagination cursor does not belong to the authenticated WeChat account");
  }
}
