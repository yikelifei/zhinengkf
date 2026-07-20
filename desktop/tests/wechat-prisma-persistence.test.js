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

test("Prisma sync idempotency only accepts explicit inbound terminal action-status pairs", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const queries = [];
  const prisma = {
    wechatWorkAuditLog: {
      async findFirst(query) {
        queries.push(query);
        return null;
      },
    },
  };
  const persistence = new WechatPersistence(prisma, new LocalStoreService());
  assert.equal(await persistence.hasWechatWorkAuditMsgId("shared-id"), false);
  assert.equal(await persistence.hasWechatWorkCallbackId("callback-id"), false);
  const inbound = queries[0].where;
  assert.equal(inbound.msgid, "shared-id");
  assert.ok(inbound.OR.some((item) => item.action === "inbound_processed" && item.status === "processed"));
  assert.ok(inbound.OR.some((item) => item.action === "inbound_failed" && item.status === "permanent_manual_review"));
  assert.equal(inbound.OR.some((item) => String(item.action || "").startsWith("callback_")), false);
  assert.deepEqual(queries[1].where.action.in, ["callback_accepted", "callback_ignored", "callback_duplicate"]);
});

test("Prisma sync cursor uses compare-and-swap and rejects stale expected cursors", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  let row = { id: "cursor-row", openKfid: "wk-db-cursor", nextCursor: "cursor-1" };
  const cursorModel = {
    async findUnique() { return row; },
    async updateMany({ where, data }) {
      if (!row || row.openKfid !== where.openKfid || row.nextCursor !== where.nextCursor) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    },
    async create({ data }) { row = { id: "created", ...data }; return row; },
  };
  const prisma = {
    wechatWorkSyncCursor: cursorModel,
    async $transaction(callback) { return callback({ wechatWorkSyncCursor: cursorModel }); },
  };
  const persistence = new WechatPersistence(prisma, new LocalStoreService());
  const committed = await persistence.commitWechatWorkSyncCursor({
    openKfid: "wk-db-cursor",
    expectedCursor: "cursor-1",
    nextCursor: "cursor-2",
  });
  assert.equal(committed.nextCursor, "cursor-2");
  await assert.rejects(
    () => persistence.commitWechatWorkSyncCursor({
      openKfid: "wk-db-cursor",
      expectedCursor: "cursor-1",
      nextCursor: "stale",
    }),
    /stale cursor commit/,
  );
});

test("Prisma mode creates isolated Enterprise WeChat identity bindings without touching local JSON", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const calls = [];
  let account = null;
  let customer = null;
  let conversation = null;
  const tx = {
    wechatWorkBinding: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async (args) => {
        calls.push(["binding", args]);
        return {
          ...args.data,
          wechatAccount: account,
          customer,
          conversation,
        };
      },
    },
    wechatAccount: {
      findUnique: async () => null,
      create: async (args) => { calls.push(["account", args]); account = args.data; return account; },
    },
    customer: {
      findUnique: async () => null,
      create: async (args) => { calls.push(["customer", args]); customer = args.data; return customer; },
    },
    conversation: {
      findUnique: async () => null,
      create: async (args) => { calls.push(["conversation", args]); conversation = args.data; return conversation; },
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
  const bindingCreate = calls.find(([name]) => name === "binding")[1].data;
  assert.deepEqual(
    [bindingCreate.openKfid, bindingCreate.externalUserId, bindingCreate.wechatAccountId, bindingCreate.customerId, bindingCreate.conversationId],
    ["wk-db", "wm-db", account.id, customer.id, conversation.id],
  );
  assert.match(account.id, /^wwacct_/);
  assert.match(customer.id, /^wwcust_/);
  assert.match(conversation.id, /^wwconv_/);
  assert.match(result.id, /^wwbind_/);
});

test("Prisma Enterprise WeChat canonical binding stays stable under concurrent first contact", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const database = createCanonicalBindingPrisma();
  const persistence = new WechatPersistence(database.prisma, {});

  const sameAccount = await Promise.all([
    persistence.upsertWechatWorkBinding({ openKfid: "wk-shared", externalUserId: "wm-one" }),
    persistence.upsertWechatWorkBinding({ openKfid: "wk-shared", externalUserId: "wm-two" }),
  ]);
  assert.equal(new Set(sameAccount.map((item) => item.wechatAccountId)).size, 1);

  const sameCustomer = await Promise.all([
    persistence.upsertWechatWorkBinding({ openKfid: "wk-a", externalUserId: "wm-shared" }),
    persistence.upsertWechatWorkBinding({ openKfid: "wk-b", externalUserId: "wm-shared" }),
  ]);
  assert.equal(new Set(sameCustomer.map((item) => item.customerId)).size, 1);

  const samePair = await Promise.all(Array.from({ length: 6 }, () =>
    persistence.upsertWechatWorkBinding({ openKfid: "wk-race", externalUserId: "wm-race" }),
  ));
  assert.equal(new Set(samePair.map((item) => item.id)).size, 1);
  assert.equal(new Set(samePair.map((item) => item.conversationId)).size, 1);
  assert.equal(database.state.bindings.size, 5);
});

test("Prisma Enterprise WeChat binding lastInboundAt advances monotonically", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const database = createCanonicalBindingPrisma();
  const persistence = new WechatPersistence(database.prisma, {});
  const identity = { openKfid: "wk-time", externalUserId: "wm-time" };

  await persistence.upsertWechatWorkBinding({ ...identity, sendTime: 100 });
  const newest = await persistence.upsertWechatWorkBinding({ ...identity, sendTime: 300 });
  const writesAfterNewest = database.state.writeCount;
  const stale = await persistence.upsertWechatWorkBinding({ ...identity, sendTime: 200 });
  const absent = await persistence.upsertWechatWorkBinding(identity);
  const notANumber = await persistence.upsertWechatWorkBinding({ ...identity, sendTime: Number.NaN });

  assert.equal(newest.lastInboundAt.toISOString(), new Date(300_000).toISOString());
  assert.equal(stale.lastInboundAt.toISOString(), newest.lastInboundAt.toISOString());
  assert.equal(absent.lastInboundAt.toISOString(), newest.lastInboundAt.toISOString());
  assert.equal(notANumber.lastInboundAt.toISOString(), newest.lastInboundAt.toISOString());
  assert.equal(database.state.writeCount, writesAfterNewest);
  await assert.rejects(
    () => persistence.upsertWechatWorkBinding({ ...identity, sendTime: Number.POSITIVE_INFINITY }),
    /sendTime is invalid/,
  );
});

test("Prisma Enterprise WeChat binding rejects a stale event that commits after a newer event", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  let releaseStale;
  let staleReached;
  const staleReachedPromise = new Promise((resolve) => { staleReached = resolve; });
  const releaseStalePromise = new Promise((resolve) => { releaseStale = resolve; });
  const database = createCanonicalBindingPrisma({
    async beforeBindingUpdateMany({ data }) {
      if (data.lastInboundAt.getTime() !== 200_000) return;
      staleReached();
      await releaseStalePromise;
    },
  });
  const persistence = new WechatPersistence(database.prisma, {});
  const identity = { openKfid: "wk-race-time", externalUserId: "wm-race-time" };
  await persistence.upsertWechatWorkBinding({ ...identity, sendTime: 100 });

  const staleWrite = persistence.upsertWechatWorkBinding({ ...identity, sendTime: 200 });
  await staleReachedPromise;
  const newest = await persistence.upsertWechatWorkBinding({ ...identity, sendTime: 300 });
  releaseStale();
  const staleWinner = await staleWrite;

  assert.equal(newest.lastInboundAt.toISOString(), new Date(300_000).toISOString());
  assert.equal(staleWinner.lastInboundAt.toISOString(), newest.lastInboundAt.toISOString());
  const stored = [...database.state.bindings.values()].find((item) => item.openKfid === identity.openKfid);
  assert.equal(stored.lastInboundAt.toISOString(), newest.lastInboundAt.toISOString());
});

test("LocalStore Enterprise WeChat binding lastInboundAt advances monotonically", () => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-local-timestamp-"));
  const previousFile = process.env.LOCAL_STORE_FILE;
  process.env.LOCAL_STORE_FILE = path.join(localRoot, "store.json");
  try {
    const localStore = new LocalStoreService();
    const identity = { openKfid: "wk-local-time", externalUserId: "wm-local-time" };
    localStore.upsertWechatWorkBinding({ ...identity, sendTime: 100 });
    const newest = localStore.upsertWechatWorkBinding({ ...identity, sendTime: 300 });
    const stale = localStore.upsertWechatWorkBinding({ ...identity, sendTime: 200 });
    const absent = localStore.upsertWechatWorkBinding(identity);
    const notANumber = localStore.upsertWechatWorkBinding({ ...identity, sendTime: Number.NaN });

    assert.equal(newest.lastInboundAt, new Date(300_000).toISOString());
    assert.equal(stale.lastInboundAt, newest.lastInboundAt);
    assert.equal(absent.lastInboundAt, newest.lastInboundAt);
    assert.equal(notANumber.lastInboundAt, newest.lastInboundAt);
    assert.throws(
      () => localStore.upsertWechatWorkBinding({ ...identity, sendTime: Number.POSITIVE_INFINITY }),
      /sendTime is invalid/,
    );
  } finally {
    if (previousFile === undefined) delete process.env.LOCAL_STORE_FILE;
    else process.env.LOCAL_STORE_FILE = previousFile;
    fs.rmSync(localRoot, { recursive: true, force: true });
  }
});

test("Prisma Enterprise WeChat canonical binding retries every P2002 create boundary", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  for (const model of ["wechatAccount", "customer", "conversation", "wechatWorkBinding"]) {
    const database = createCanonicalBindingPrisma({ failOnceAt: model });
    const persistence = new WechatPersistence(database.prisma, {});
    const result = await persistence.upsertWechatWorkBinding({
      openKfid: `wk-${model}`,
      externalUserId: `wm-${model}`,
    });
    assert.match(result.id, /^wwbind_/);
    assert.equal(database.state.failures.get(model), 1);
  }
});

test("Prisma Enterprise WeChat canonical binding fails closed on inconsistent history", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const database = createCanonicalBindingPrisma();
  const persistence = new WechatPersistence(database.prisma, {});
  await persistence.upsertWechatWorkBinding({ openKfid: "wk-conflict", externalUserId: "wm-one" });

  database.seedBinding({
    id: "legacy-conflict-binding",
    openKfid: "wk-conflict",
    externalUserId: "wm-legacy",
    wechatAccountId: "legacy-conflict-account",
    customerId: "legacy-conflict-customer",
    conversationId: "legacy-conflict-conversation",
  });
  const writesBefore = database.state.writeCount;
  await assert.rejects(
    () => persistence.upsertWechatWorkBinding({ openKfid: "wk-conflict", externalUserId: "wm-new" }),
    /openKfid maps to multiple WeChat accounts/,
  );
  assert.equal(database.state.writeCount, writesBefore);
});

test("Prisma Enterprise WeChat canonical binding rejects conflicting customer history without writes", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const database = createCanonicalBindingPrisma();
  const persistence = new WechatPersistence(database.prisma, {});
  await persistence.upsertWechatWorkBinding({ openKfid: "wk-one", externalUserId: "wm-conflict" });

  database.seedBinding({
    id: "legacy-customer-conflict-binding",
    openKfid: "wk-legacy",
    externalUserId: "wm-conflict",
    wechatAccountId: "legacy-customer-conflict-account",
    customerId: "legacy-customer-conflict-customer",
    conversationId: "legacy-customer-conflict-conversation",
  });
  const writesBefore = database.state.writeCount;
  await assert.rejects(
    () => persistence.upsertWechatWorkBinding({ openKfid: "wk-new", externalUserId: "wm-conflict" }),
    /externalUserId maps to multiple customers/,
  );
  assert.equal(database.state.writeCount, writesBefore);
});

function createCanonicalBindingPrisma(options = {}) {
  const state = {
    accounts: new Map(),
    customers: new Map(),
    conversations: new Map(),
    bindings: new Map(),
    failures: new Map(),
    writeCount: 0,
  };
  const failOnceAt = options.failOnceAt || "";
  function p2002() {
    const error = new Error("unique conflict");
    error.code = "P2002";
    return error;
  }
  function maybeFail(model) {
    if (model !== failOnceAt || state.failures.has(model)) return;
    state.failures.set(model, 1);
    throw p2002();
  }
  function hydrate(binding) {
    return {
      ...binding,
      wechatAccount: state.accounts.get(binding.wechatAccountId),
      customer: state.customers.get(binding.customerId),
      conversation: state.conversations.get(binding.conversationId),
    };
  }
  function bindingByPair(openKfid, externalUserId) {
    return [...state.bindings.values()].find((item) =>
      item.openKfid === openKfid && item.externalUserId === externalUserId,
    ) || null;
  }
  function conversationByIdentity(wechatAccountId, externalChatId) {
    return [...state.conversations.values()].find((item) =>
      item.wechatAccountId === wechatAccountId && item.externalChatId === externalChatId,
    ) || null;
  }
  const tx = {
    wechatWorkBinding: {
      async findUnique({ where }) {
        await Promise.resolve();
        if (where.id) return state.bindings.has(where.id) ? hydrate(state.bindings.get(where.id)) : null;
        const pair = where.openKfid_externalUserId;
        const binding = pair ? bindingByPair(pair.openKfid, pair.externalUserId) : null;
        return binding ? hydrate(binding) : null;
      },
      async findMany({ where }) {
        await Promise.resolve();
        return [...state.bindings.values()]
          .filter((item) => !where.openKfid || item.openKfid === where.openKfid)
          .filter((item) => !where.externalUserId || item.externalUserId === where.externalUserId)
          .map(hydrate);
      },
      async create({ data }) {
        maybeFail("wechatWorkBinding");
        if (state.bindings.has(data.id) || bindingByPair(data.openKfid, data.externalUserId)) throw p2002();
        if ([...state.bindings.values()].some((item) => item.conversationId === data.conversationId)) throw p2002();
        state.bindings.set(data.id, { ...data });
        state.writeCount += 1;
        return hydrate(data);
      },
      async update({ where, data }) {
        const current = state.bindings.get(where.id);
        const updated = { ...current, ...data };
        state.bindings.set(where.id, updated);
        state.writeCount += 1;
        return hydrate(updated);
      },
      async updateMany({ where, data }) {
        if (options.beforeBindingUpdateMany) {
          await options.beforeBindingUpdateMany({ where, data, state });
        }
        const current = state.bindings.get(where.id);
        if (!current) return { count: 0 };
        const incoming = data.lastInboundAt;
        const currentTime = current.lastInboundAt == null ? null : new Date(current.lastInboundAt).getTime();
        const acceptsNull = where.OR?.some((condition) => condition.lastInboundAt === null) || false;
        const timestampCondition = where.OR?.find((condition) => condition.lastInboundAt?.lt)?.lastInboundAt;
        const acceptsTimestamp = timestampCondition?.lt instanceof Date
          && currentTime != null
          && currentTime < timestampCondition.lt.getTime();
        if (currentTime == null ? !acceptsNull : !acceptsTimestamp) return { count: 0 };
        state.bindings.set(where.id, { ...current, ...data });
        state.writeCount += 1;
        return { count: 1 };
      },
    },
    wechatAccount: {
      async findUnique({ where }) { await Promise.resolve(); return state.accounts.get(where.id) || null; },
      async create({ data }) {
        maybeFail("wechatAccount");
        if (state.accounts.has(data.id)) throw p2002();
        state.accounts.set(data.id, { ...data });
        state.writeCount += 1;
        return state.accounts.get(data.id);
      },
    },
    customer: {
      async findUnique({ where }) { await Promise.resolve(); return state.customers.get(where.id) || null; },
      async create({ data }) {
        maybeFail("customer");
        if (state.customers.has(data.id)) throw p2002();
        state.customers.set(data.id, { ...data });
        state.writeCount += 1;
        return state.customers.get(data.id);
      },
    },
    conversation: {
      async findUnique({ where }) {
        await Promise.resolve();
        if (where.id) return state.conversations.get(where.id) || null;
        const identity = where.wechatAccountId_externalChatId;
        return identity ? conversationByIdentity(identity.wechatAccountId, identity.externalChatId) : null;
      },
      async create({ data }) {
        maybeFail("conversation");
        if (state.conversations.has(data.id) || conversationByIdentity(data.wechatAccountId, data.externalChatId)) throw p2002();
        state.conversations.set(data.id, { ...data });
        state.writeCount += 1;
        return state.conversations.get(data.id);
      },
      async update({ where, data }) {
        const updated = { ...state.conversations.get(where.id), ...data };
        state.conversations.set(where.id, updated);
        state.writeCount += 1;
        return updated;
      },
    },
  };
  const seedBinding = (binding) => {
    state.accounts.set(binding.wechatAccountId, {
      id: binding.wechatAccountId,
      displayName: binding.wechatAccountId,
    });
    state.customers.set(binding.customerId, { id: binding.customerId, name: binding.customerId });
    state.conversations.set(binding.conversationId, {
      id: binding.conversationId,
      channel: "work_wechat",
      externalChatId: `wechat_work_kf:${binding.openKfid}:${binding.externalUserId}`,
      wechatAccountId: binding.wechatAccountId,
      customerId: binding.customerId,
    });
    state.bindings.set(binding.id, { ...binding });
  };
  return {
    state,
    seedBinding,
    prisma: { async $transaction(callback) { return callback(tx); } },
  };
}
