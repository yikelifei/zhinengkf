import { Prisma, PrismaClient } from "@prisma/client";
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
    sendTasks: rows(data, "sendTasks").length,
    sendAttempts: rows(data, "sendAttempts").length,
  };
  console.log(JSON.stringify({ sourcePath, dryRun, summary }, null, 2));
  if (dryRun) return;

  await batch(rows(data, "wechatAccounts").map((item: any) => prisma.wechatAccount.upsert({
    where: { id: item.id },
    create: {
      id: item.id,
      displayName: item.displayName || item.alias || item.id,
      alias: item.alias || null,
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
      wechatId: item.wechatId || null,
      phone: item.phone || null,
      tags: json(item.tags || []),
      notes: item.notes || null,
      source: item.source || "local_json_import",
      createdAt: asDate(item.createdAt),
      updatedAt: asDate(item.updatedAt),
    },
    update: {
      name: item.name || item.wechatId || item.id,
      wechatId: item.wechatId || null,
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
      createdAt: asDate(item.createdAt),
    },
    update: {
      direction: item.direction || "inbound",
      text: item.text || "",
      attachments: json(item.attachments || []),
      metadata: json(item.metadata || {}),
      externalId: item.externalId || null,
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
    const values = {
      sendTaskId: item.sendTaskId,
      adapter: item.adapter || "dry_run",
      status: item.status || "started",
      guardStatus: item.guardStatus || null,
      windowSnapshotId: item.windowSnapshotId || null,
      payloadSummary: json(item.payloadSummary || {}),
      errorMessage: item.errorMessage || null,
      metadata: json(item.metadata || {}),
      startedAt: asDate(item.startedAt) || new Date(),
      completedAt: asDate(item.completedAt) || null,
    };
    return prisma.wechatSendAttempt.upsert({
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
