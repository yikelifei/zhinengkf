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
  const importer = fs.readFileSync(path.join(root, "tools", "migrate-wechat-local-json-to-prisma.ts"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(schema, /@@unique\(\[conversationId, externalId\]\)/);
  assert.match(schema, /@@unique\(\[wechatAccountId, externalChatId\]\)/);
  assert.match(schema, /@@index\(\[status, queuedAt\]\)/);
  assert.match(schema, /windowSnapshot\s+WechatWindowSnapshot\?/);
  assert.match(source, /\$transaction\(async \(tx/);
  assert.match(source, /where: \{ id: params\.taskId, status: "queued" \}/);
  assert.match(source, /completeAttemptAndTask/);
  assert.match(importer, /prisma\.\$transaction\(actions\.slice/);
  assert.match(pkg.scripts["prisma:wechat:import"], /migrate-wechat-local-json-to-prisma/);
  assert.match(pkg.scripts["prisma:migrate:deploy"], /prisma migrate deploy/);
});
