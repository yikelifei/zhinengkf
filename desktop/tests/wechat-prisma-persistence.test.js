"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-prisma-contract-"));
process.env.LOCAL_STORE_FILE = path.join(tempRoot, "local-store.json");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { WechatPersistence } = require("../apps/api/src/wechat/wechat-persistence");

test("local-json and Prisma expose the same account/conversation identity shape", async (t) => {
  t.after(() => {
    appConfig.useLocalStore = true;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const localStore = new LocalStoreService();
  appConfig.useLocalStore = true;
  const local = new WechatPersistence({}, localStore);
  const localAccounts = await local.listAccounts();
  const localConversations = await local.listConversations();
  assert.ok(localAccounts.length > 0 && localConversations.length > 0);

  const rawConversations = localConversations.map(({ customer, wechatAccount, ...conversation }) => conversation);
  const prisma = {
    wechatAccount: { findMany: async () => localAccounts },
    customer: { findMany: async () => localConversations.map((item) => item.customer) },
    conversation: {
      findMany: async () => rawConversations.map((conversation) => ({
        ...conversation,
        customer: localConversations.find((item) => item.id === conversation.id).customer,
        wechatAccount: localAccounts.find((item) => item.id === conversation.wechatAccountId) || null,
      })),
    },
  };
  appConfig.useLocalStore = false;
  const postgres = new WechatPersistence(prisma, localStore);
  const prismaAccounts = await postgres.listAccounts();
  const prismaConversations = await postgres.listConversations();
  assert.deepEqual(prismaAccounts.map((item) => item.id), localAccounts.map((item) => item.id));
  assert.deepEqual(
    prismaConversations.map((item) => [item.id, item.customer.id, item.wechatAccount?.id]),
    localConversations.map((item) => [item.id, item.customer.id, item.wechatAccount?.id]),
  );
});

test("Prisma WeChat persistence keeps idempotency, indexes, transactions and switch commands", () => {
  const root = path.join(__dirname, "..");
  const schema = fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
  const source = fs.readFileSync(path.join(root, "apps", "api", "src", "wechat", "wechat-persistence.ts"), "utf8");
  const dispatch = fs.readFileSync(path.join(root, "apps", "api", "src", "wechat", "wechat-dispatch.service.ts"), "utf8");
  const workService = fs.readFileSync(path.join(root, "apps", "api", "src", "wechat-work", "wechat-work.service.ts"), "utf8");
  const importer = fs.readFileSync(path.join(root, "tools", "migrate-wechat-local-json-to-prisma.ts"), "utf8");
  const readStateMigration = fs.readFileSync(
    path.join(root, "prisma", "migrations", "20260713090000_add_message_read_state", "migration.sql"),
    "utf8",
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(schema, /@@unique\(\[conversationId, externalId\]\)/);
  assert.match(schema, /@@unique\(\[wechatAccountId, externalChatId\]\)/);
  assert.match(schema, /@@index\(\[status, queuedAt\]\)/);
  assert.match(schema, /windowSnapshot\s+WechatWindowSnapshot\?/);
  assert.match(schema, /model WechatWorkBinding/);
  assert.match(schema, /@@unique\(\[openKfid, externalUserId\]\)/);
  assert.match(schema, /model WechatWorkAuditLog/);
  assert.match(schema, /@@index\(\[msgid\]\)/);
  assert.match(source, /\$transaction\(async \(tx/);
  assert.match(source, /where: \{ id: params\.taskId, status: "queued" \}/);
  assert.match(source, /completeAttemptAndTask/);
  assert.match(source, /expectedTaskStatus/);
  assert.match(source, /cancelTaskAndAttempt/);
  assert.match(source, /upsertWechatWorkBinding/);
  assert.match(source, /recordWechatWorkAudit/);
  assert.match(source, /findWechatWorkSendAttemptByMsgId/);
  assert.match(dispatch, /validatePrismaWechatWorkKfSendTask/);
  assert.match(dispatch, /completePrismaWechatWorkKfSend/);
  assert.match(workService, /new WechatPersistence\(prisma, localStore\)/);
  assert.doesNotMatch(workService, /Prisma mode is not implemented for this integration/);
  assert.match(importer, /prisma\.\$transaction\(actions\.slice/);
  assert.match(importer, /prisma\.wechatWorkBinding\.upsert/);
  assert.match(importer, /prisma\.wechatWorkAuditLog\.upsert/);
  assert.match(readStateMigration, /TIMESTAMP\(3\)/);
  assert.doesNotMatch(readStateMigration, /DATETIME/);
  assert.match(pkg.scripts["prisma:wechat:import"], /migrate-wechat-local-json-to-prisma/);
  assert.match(pkg.scripts["prisma:migrate:deploy"], /prisma migrate deploy/);
});

test("Prisma mode creates isolated Enterprise WeChat identity bindings without touching local JSON", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const calls = [];
  const account = { id: "wa-db", displayName: "企业微信客服 wk-db" };
  const customer = { id: "customer-db", name: "企业微信客户 wm-db" };
  const conversation = {
    id: "conversation-db",
    channel: "work_wechat",
    externalChatId: "wechat_work_kf:wk-db:wm-db",
    wechatAccountId: account.id,
    customerId: customer.id,
  };
  const binding = {
    id: "binding-db",
    openKfid: "wk-db",
    externalUserId: "wm-db",
    wechatAccountId: account.id,
    customerId: customer.id,
    conversationId: conversation.id,
    wechatAccount: account,
    customer,
    conversation,
  };
  const tx = {
    wechatWorkBinding: {
      findUnique: async () => null,
      findFirst: async () => null,
      upsert: async (args) => { calls.push(["binding", args]); return binding; },
    },
    wechatAccount: {
      create: async (args) => { calls.push(["account", args]); return account; },
    },
    customer: {
      create: async (args) => { calls.push(["customer", args]); return customer; },
    },
    conversation: {
      upsert: async (args) => { calls.push(["conversation", args]); return conversation; },
    },
  };
  const prisma = { $transaction: async (callback) => callback(tx) };
  const localStore = new Proxy({}, {
    get() { throw new Error("local JSON must not be accessed in Prisma mode"); },
  });
  const persistence = new WechatPersistence(prisma, localStore);
  const result = await persistence.upsertWechatWorkBinding({
    openKfid: "wk-db",
    externalUserId: "wm-db",
    sendTime: 1710000000,
  });

  assert.equal(result.conversationId, conversation.id);
  assert.deepEqual(calls.map(([name]) => name), ["account", "customer", "conversation", "binding"]);
  const bindingCreate = calls.find(([name]) => name === "binding")[1].create;
  assert.deepEqual(
    [bindingCreate.openKfid, bindingCreate.externalUserId, bindingCreate.wechatAccountId, bindingCreate.customerId, bindingCreate.conversationId],
    ["wk-db", "wm-db", account.id, customer.id, conversation.id],
  );
});
