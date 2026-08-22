import { Prisma, PrismaClient, SendAttemptStatus } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const sourceArg = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length);
const sourcePath = path.resolve(sourceArg || process.env.LOCAL_STORE_FILE || path.join(process.cwd(), ".runtime", "local-store.json"));
const dryRun = args.includes("--dry-run");

function asDate(value: unknown) {
  return value ? new Date(String(value)) : undefined;
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function rows(data: any, key: string) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function normalizeSendAttemptStatus(value: unknown): SendAttemptStatus {
  const normalized = String(value || "started").trim();
  if (Object.prototype.hasOwnProperty.call(SendAttemptStatus, normalized)) {
    return SendAttemptStatus[normalized as keyof typeof SendAttemptStatus];
  }
  // Older local JSON used `cancelled` for an attempt stopped before a durable
  // outcome. The Prisma task retains cancelled; the attempt records it as a
  // blocked terminal attempt and preserves the original value in metadata.
  if (normalized === "cancelled") return SendAttemptStatus.blocked;
  return SendAttemptStatus.failed;
}

async function batch(actions: Array<Prisma.PrismaPromise<unknown>>, size = 100) {
  for (let index = 0; index < actions.length; index += size) {
    await prisma.$transaction(actions.slice(index, index + size));
  }
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`local store not found: ${sourcePath}`);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, ""));
  const summary = {
    wechatAccounts: rows(data, "wechatAccounts").length,
    customers: rows(data, "customers").length,
    conversations: rows(data, "conversations").length,
    messages: rows(data, "messages").length,
    wechatWindowSnapshots: rows(data, "wechatWindowSnapshots").length,
    designJobs: rows(data, "designJobs").length,
    designImages: rows(data, "designImages").length,
    quoteDrafts: rows(data, "quoteDrafts").length,
    sendTasks: rows(data, "sendTasks").length,
    sendAttempts: rows(data, "sendAttempts").length,
    normalizedCancelledSendAttempts: rows(data, "sendAttempts").filter((item: any) => item.status === "cancelled").length,
    wechatWorkBindings: rows(data, "wechatWorkBindings").length,
    wechatWorkAuditLogs: rows(data, "wechatWorkAuditLogs").length,
    normalizedStructuredAuditEvents: rows(data, "wechatWorkAuditLogs").filter((item: any) =>
      item.event && typeof item.event === "object",
    ).length,
  };
  console.log(JSON.stringify({ sourcePath, dryRun, summary }, null, 2));
  if (dryRun) return;

  await batch(rows(data, "wechatAccounts").map((item: any) => prisma.wechatAccount.upsert({
    where: { id: item.id },
    create: {
      id: item.id,
      displayName: item.displayName || item.alias || item.id,
      alias: item.alias || null,
      personalWechatOwnerWxId: item.personalWechatOwnerWxId || item.personalWechatRpa?.ownerWxId || null,
      personalWechatAccountNickname: item.personalWechatAccountNickname || item.personalWechatRpa?.accountNickname || null,
      windowHandle: item.windowHandle || null,
      processId: Number.isInteger(Number(item.processId)) ? Number(item.processId) : null,
      isActive: item.isActive !== false,
      lastSeenAt: asDate(item.lastSeenAt),
      createdAt: asDate(item.createdAt),
      updatedAt: asDate(item.updatedAt),
    },
    update: {
      displayName: item.displayName || item.alias || item.id,
      alias: item.alias || null,
      personalWechatOwnerWxId: item.personalWechatOwnerWxId || item.personalWechatRpa?.ownerWxId || null,
      personalWechatAccountNickname: item.personalWechatAccountNickname || item.personalWechatRpa?.accountNickname || null,
      windowHandle: item.windowHandle || null,
      processId: Number.isInteger(Number(item.processId)) ? Number(item.processId) : null,
      isActive: item.isActive !== false,
      lastSeenAt: asDate(item.lastSeenAt),
    },
  })));

  await batch(rows(data, "customers").map((item: any) => prisma.customer.upsert({
    where: { id: item.id },
    create: {
      id: item.id,
      name: item.name || item.wechatId || item.id,
      avatarUrl: item.avatarUrl || null,
      wechatId: item.wechatId || null,
      personalWechatRpaBindingKey: item.personalWechatRpaBindingKey || null,
      phone: item.phone || null,
      tags: json(item.tags || []),
      notes: item.notes || null,
      source: item.source || "local_json_import",
      createdAt: asDate(item.createdAt),
      updatedAt: asDate(item.updatedAt),
    },
    update: {
      name: item.name || item.wechatId || item.id,
      avatarUrl: item.avatarUrl || null,
      wechatId: item.wechatId || null,
      personalWechatRpaBindingKey: item.personalWechatRpaBindingKey || null,
      phone: item.phone || null,
      tags: json(item.tags || []),
      notes: item.notes || null,
      source: item.source || "local_json_import",
    },
  })));

  await batch(rows(data, "conversations").map((item: any) => prisma.conversation.upsert({
    where: { id: item.id },
    create: {
      id: item.id,
      channel: item.channel || "wechat",
      externalChatId: item.externalChatId || null,
      title: item.title || item.id,
      customerId: item.customerId,
      wechatAccountId: item.wechatAccountId || null,
      lastMessageAt: asDate(item.lastMessageAt),
      manualLocked: Boolean(item.manualLocked),
      assignee: item.assignee || null,
      priority: item.priority || "normal",
      status: item.status || "open",
      slaDueAt: asDate(item.slaDueAt),
      firstResponseDueAt: asDate(item.firstResponseDueAt),
      createdAt: asDate(item.createdAt),
      updatedAt: asDate(item.updatedAt),
    },
    update: {
      channel: item.channel || "wechat",
      externalChatId: item.externalChatId || null,
      title: item.title || item.id,
      customerId: item.customerId,
      wechatAccountId: item.wechatAccountId || null,
      lastMessageAt: asDate(item.lastMessageAt),
      manualLocked: Boolean(item.manualLocked),
      assignee: item.assignee || null,
      priority: item.priority || "normal",
      status: item.status || "open",
      slaDueAt: asDate(item.slaDueAt),
      firstResponseDueAt: asDate(item.firstResponseDueAt),
    },
  })));

  await batch(rows(data, "wechatWorkBindings").map((item: any) => prisma.wechatWorkBinding.upsert({
    where: { openKfid_externalUserId: { openKfid: item.openKfid, externalUserId: item.externalUserId } },
    create: {
      id: item.id,
      openKfid: item.openKfid,
      externalUserId: item.externalUserId,
      wechatAccountId: item.wechatAccountId,
      customerId: item.customerId,
      conversationId: item.conversationId,
      lastInboundAt: asDate(item.lastInboundAt),
      createdAt: asDate(item.createdAt),
      updatedAt: asDate(item.updatedAt),
    },
    update: {
      wechatAccountId: item.wechatAccountId,
      customerId: item.customerId,
      conversationId: item.conversationId,
      lastInboundAt: asDate(item.lastInboundAt),
    },
  })));

  await batch(rows(data, "messages").map((item: any) => prisma.message.upsert({
    where: { id: item.id },
    create: {
      id: item.id,
      conversationId: item.conversationId,
      direction: item.direction || "inbound",
      text: item.text || "",
      attachments: json(item.attachments || []),
      metadata: json(item.metadata || {}),
      externalId: item.externalId || null,
      readAt: asDate(item.readAt),
      createdAt: asDate(item.createdAt),
    },
    update: {
      direction: item.direction || "inbound",
      text: item.text || "",
      attachments: json(item.attachments || []),
      metadata: json(item.metadata || {}),
      externalId: item.externalId || null,
      readAt: asDate(item.readAt),
    },
  })));

  const conversations = rows(data, "conversations");
  await batch(rows(data, "wechatWindowSnapshots").map((item: any) => {
    const activeConversation = conversations.find((conversation: any) =>
      (!item.wechatAccountId || conversation.wechatAccountId === item.wechatAccountId) &&
      ((item.externalChatId && conversation.externalChatId === item.externalChatId) ||
        (item.chatTitle && conversation.title === item.chatTitle) ||
        (item.recentCustomerId && conversation.customerId === item.recentCustomerId)),
    );
    const values = {
      source: item.source || "local_json_import",
      isOnline: item.isOnline !== false,
      wechatAccountId: item.wechatAccountId || null,
      activeConversationId: activeConversation?.id || null,
      accountDisplayName: item.accountDisplayName || null,
      windowHandle: item.windowHandle || null,
      processId: Number.isInteger(Number(item.processId)) ? Number(item.processId) : null,
      chatTitle: item.chatTitle || null,
      activeChatTitle: item.activeChatTitle || item.chatTitle || null,
      externalChatId: item.externalChatId || null,
      recentCustomerId: item.recentCustomerId || null,
      recentMessageText: item.recentMessageText || null,
      confidence: item.confidence === undefined || item.confidence === null ? null : new Prisma.Decimal(item.confidence),
      diagnostic: json(item.diagnostic),
      raw: json(item.raw || item),
      capturedAt: asDate(item.capturedAt) || new Date(),
    };
    return prisma.wechatWindowSnapshot.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  // Send tasks may retain durable links to design and quote records. Import those
  // dependencies first so PostgreSQL foreign keys reject neither valid history nor
  // a safe rerun after a partially completed import.
  await batch(rows(data, "designJobs").map((item: any) => {
    const values = {
      requestId: item.requestId || item.id,
      externalJobId: item.externalJobId || null,
      status: item.status || "draft",
      designType: item.designType || "bundle_render",
      renderStyle: item.renderStyle || "真实产品摆拍",
      outputCount: Number(item.outputCount || 6),
      budget: json(item.budget || {}),
      bundle: json(item.bundle || {}),
      requirements: json(item.requirements || {}),
      customerText: item.customerText || null,
      scene: item.scene || null,
      isHighValue: Boolean(item.isHighValue),
      manualQcRequired: item.manualQcRequired !== false,
      retryCount: Number(item.retryCount || 0),
      revisionCount: Number(item.revisionCount || 0),
      revisionPolicy: item.revisionPolicy === undefined ? undefined : json(item.revisionPolicy),
      errorMessage: item.errorMessage || null,
      waitMessageSentAt: asDate(item.waitMessageSentAt),
      submitOperationKey: item.submitOperationKey || null,
      submitRequestFingerprint: item.submitRequestFingerprint || null,
      submitOperationIdentity: item.submitOperationIdentity === undefined ? undefined : json(item.submitOperationIdentity),
      submitDispatchStatus: item.submitDispatchStatus || null,
      submitDispatchError: item.submitDispatchError || null,
      callbackOperationKey: item.callbackOperationKey || null,
      callbackRequestFingerprint: item.callbackRequestFingerprint || null,
      callbackStatus: item.callbackStatus || null,
      callbackClaimedAt: asDate(item.callbackClaimedAt),
      callbackSettledAt: asDate(item.callbackSettledAt),
      submittedAt: asDate(item.submittedAt),
      completedAt: asDate(item.completedAt),
      customerId: item.customerId,
      conversationId: item.conversationId,
      wechatAccountId: item.wechatAccountId || null,
      orderId: item.orderId || null,
    };
    return prisma.designJob.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "designImages").map((item: any) => {
    const values = {
      imageId: item.imageId || item.id,
      designJobId: item.designJobId,
      position: Number(item.position || 0),
      downloadUrl: item.downloadUrl || null,
      localPath: item.localPath || null,
      width: item.width === undefined || item.width === null ? null : Number(item.width),
      height: item.height === undefined || item.height === null ? null : Number(item.height),
      fingerprint: item.fingerprint || null,
      legacyIdentityHash: item.legacyIdentityHash || null,
      selected: Boolean(item.selected),
      customerFeedback: item.customerFeedback || null,
    };
    return prisma.designImageCandidate.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  await batch(rows(data, "quoteDrafts").map((item: any) => {
    const values = {
      designJobId: item.designJobId,
      customerId: item.customerId,
      selectedImageId: item.selectedImageId || null,
      quantity: Number(item.quantity || 0),
      unitPrice: new Prisma.Decimal(item.unitPrice || 0),
      totalPrice: new Prisma.Decimal(item.totalPrice || 0),
      totalCost: new Prisma.Decimal(item.totalCost || 0),
      profit: new Prisma.Decimal(item.profit || 0),
      status: item.status || "draft",
      paymentStatus: item.paymentStatus || "unpaid",
      sendTaskId: item.sendTaskId || null,
      customerNotes: item.customerNotes || null,
      owner: item.owner || null,
    };
    return prisma.quoteDraft.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "sendTasks").map((item: any) => {
    const values = {
      status: item.status || "queued",
      wechatAccountId: item.wechatAccountId,
      conversationId: item.conversationId,
      designJobId: item.designJobId || null,
      quoteDraftId: item.quoteDraftId || null,
      payload: json(item.payload || {}),
      guardSnapshot: json(item.guardSnapshot),
      errorMessage: item.errorMessage || null,
      queuedAt: asDate(item.queuedAt) || new Date(),
      sentAt: asDate(item.sentAt) || null,
    };
    return prisma.wechatSendTask.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "sendAttempts").map((item: any) => {
    const originalStatus = String(item.status || "started").trim();
    const importedMetadata = {
      ...(item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}),
      ...(originalStatus === "cancelled" ? { localImportOriginalStatus: originalStatus } : {}),
    };
    const values = {
      sendTaskId: item.sendTaskId,
      adapter: item.adapter || "dry_run",
      status: normalizeSendAttemptStatus(originalStatus),
      guardStatus: item.guardStatus || null,
      windowSnapshotId: item.windowSnapshotId || null,
      payloadSummary: json(item.payloadSummary || {}),
      errorMessage: item.errorMessage || null,
      metadata: json(importedMetadata),
      startedAt: asDate(item.startedAt) || new Date(),
      completedAt: asDate(item.completedAt) || null,
    };
    return prisma.wechatSendAttempt.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  const auditScalarKeys = new Set([
    "id", "action", "status", "msgid", "callbackId", "event", "openKfid", "externalUserId",
    "wechatAccountId", "customerId", "conversationId", "messageId", "sendTaskId", "sendAttemptId",
    "errorMessage", "createdAt",
  ]);
  await batch(rows(data, "wechatWorkAuditLogs").map((item: any) => {
    const structuredEvent = item.event && typeof item.event === "object" ? item.event : null;
    const metadata = {
      ...Object.fromEntries(Object.entries(item).filter(([key]) => !auditScalarKeys.has(key))),
      ...(structuredEvent ? { localImportStructuredEvent: structuredEvent } : {}),
    };
    const values = {
      action: item.action || "unknown",
      status: item.status || "unknown",
      msgid: item.msgid || null,
      callbackId: item.callbackId || null,
      event: typeof item.event === "string"
        ? item.event
        : structuredEvent?.event_type || structuredEvent?.eventType || item.eventType || null,
      openKfid: item.openKfid || null,
      externalUserId: item.externalUserId || null,
      wechatAccountId: item.wechatAccountId || null,
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      messageId: item.messageId || null,
      sendTaskId: item.sendTaskId || null,
      sendAttemptId: item.sendAttemptId || null,
      errorMessage: item.errorMessage || null,
      metadata: json(metadata),
    };
    return prisma.wechatWorkAuditLog.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
