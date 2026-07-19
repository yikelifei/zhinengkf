"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { PersonalWechatRpaPersistence } = require("../apps/api/src/personal-wechat-rpa/personal-wechat-rpa.persistence");
const { PersonalWechatRpaService } = require("../apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service");

function bindingInput(overrides = {}) {
  return {
    wechatAccountId: "account_1",
    accountNickname: "客服一号",
    ownerWxId: "wxid_owner_1",
    chatTitle: "客户甲",
    conversationType: "direct",
    senderName: "客户甲",
    receivedAt: "2026-07-19T10:00:00.000Z",
    ...overrides,
  };
}

function buildFakePrisma(seed = {}) {
  const now = new Date("2026-07-19T00:00:00.000Z");
  const state = {
    accounts: new Map((seed.accounts || []).map((row) => [row.id, { ...row }])),
    customers: new Map(),
    conversations: new Map(),
    bindings: new Map(),
    audits: new Map(),
    writes: [],
  };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const client = {
    async $transaction(callback) {
      return callback(client);
    },
    wechatAccount: {
      async findUnique({ where }) {
        if (where.id) return state.accounts.get(where.id) || null;
        if (where.personalWechatOwnerWxId) {
          return [...state.accounts.values()].find((row) => row.personalWechatOwnerWxId === where.personalWechatOwnerWxId) || null;
        }
        return null;
      },
      async upsert({ where, update, create }) {
        const current = state.accounts.get(where.id);
        if (current) return Object.assign(current, update);
        const row = {
          ...create,
          windowHandle: "host-window-must-not-leak",
          processId: 9988,
          lastSeenAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.writes.push({ model: "WechatAccount", data: create });
        state.accounts.set(row.id, row);
        return row;
      },
    },
    customer: {
      async findUnique({ where }) {
        return [...state.customers.values()].find((row) => row.personalWechatRpaBindingKey === where.personalWechatRpaBindingKey) || null;
      },
      async upsert({ where, update, create }) {
        const current = [...state.customers.values()].find((row) => row.personalWechatRpaBindingKey === where.personalWechatRpaBindingKey);
        if (current) return Object.assign(current, update);
        const row = { id: nextId("customer"), ...create, createdAt: now, updatedAt: now };
        state.writes.push({ model: "Customer", data: create });
        state.customers.set(row.id, row);
        return row;
      },
    },
    conversation: {
      async findUnique({ where }) {
        if (where.id) return state.conversations.get(where.id) || null;
        const key = where.wechatAccountId_externalChatId;
        return [...state.conversations.values()].find(
          (row) => row.wechatAccountId === key.wechatAccountId && row.externalChatId === key.externalChatId,
        ) || null;
      },
      async upsert({ where, update, create }) {
        const key = where.wechatAccountId_externalChatId;
        const current = [...state.conversations.values()].find(
          (row) => row.wechatAccountId === key.wechatAccountId && row.externalChatId === key.externalChatId,
        );
        if (current) return Object.assign(current, update);
        const row = { id: nextId("conversation"), ...create, createdAt: now, updatedAt: now };
        state.writes.push({ model: "Conversation", data: create });
        state.conversations.set(row.id, row);
        return row;
      },
      async update({ where, data }) {
        return Object.assign(state.conversations.get(where.id), data, { updatedAt: now });
      },
    },
    personalWechatRpaBinding: {
      async findUnique({ where }) {
        if (where.id) return state.bindings.get(where.id) || null;
        return [...state.bindings.values()].find((row) => row.bindingKey === where.bindingKey) || null;
      },
      async findFirst({ where }) {
        return [...state.bindings.values()].find((row) =>
          row.wechatAccountId === where.wechatAccountId &&
          row.chatTitle === where.chatTitle &&
          row.bindingKey !== where.NOT.bindingKey
        ) || null;
      },
      async upsert({ where, update, create }) {
        let row = [...state.bindings.values()].find((item) => item.bindingKey === where.bindingKey);
        if (row) Object.assign(row, update, { updatedAt: now });
        else {
          row = { id: nextId("binding"), ...create, createdAt: now, updatedAt: now };
          state.writes.push({ model: "PersonalWechatRpaBinding", data: create });
          state.bindings.set(row.id, row);
        }
        return hydrate(row);
      },
      async findMany({ where, take }) {
        return [...state.bindings.values()]
          .filter((row) => row.wechatAccountId === where.wechatAccountId)
          .slice(0, take)
          .map(hydrate);
      },
    },
    personalWechatRpaAuditLog: {
      async create({ data }) {
        const row = { id: nextId("audit"), ...data };
        state.writes.push({ model: "PersonalWechatRpaAuditLog", data });
        state.audits.set(row.id, row);
        return row;
      },
      async findUnique({ where }) {
        return state.audits.get(where.id) || null;
      },
      async findMany({ where, take }) {
        return [...state.audits.values()].filter((row) => row.wechatAccountId === where.wechatAccountId).slice(0, take);
      },
    },
  };

  function hydrate(binding) {
    return {
      ...binding,
      wechatAccount: state.accounts.get(binding.wechatAccountId),
      customer: state.customers.get(binding.customerId),
      conversation: state.conversations.get(binding.conversationId),
    };
  }

  return { prisma: client, state };
}

function createLocalStore(tempDir) {
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  return localStore;
}

function forbiddenLocalStore() {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(`production attempted LocalStore fallback: ${String(property)}`);
    },
  });
}

test("Prisma persistence uses the authenticated registry account id and keeps host state out of responses", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-prisma-"));
    const { prisma, state } = buildFakePrisma();
    const persistence = new PersonalWechatRpaPersistence(prisma, forbiddenLocalStore());
    const first = await persistence.upsertBinding(bindingInput());
    const second = await persistence.upsertBinding(bindingInput({ receivedAt: "2026-07-19T11:00:00.000Z" }));

    assert.equal(first.wechatAccountId, "account_1");
    assert.equal(first.wechatAccount.id, "account_1");
    assert.equal(first.wechatAccount.personalWechatRpa.ownerWxId, "wxid_owner_1");
    assert.equal(Object.hasOwn(first.wechatAccount, "windowHandle"), false);
    assert.equal(Object.hasOwn(first.wechatAccount, "processId"), false);
    assert.equal(second.id, first.id);
    assert.equal(state.accounts.size, 1);
    assert.equal(state.customers.size, 1);
    assert.equal(state.conversations.size, 1);
    assert.equal(state.bindings.size, 1);
    assert.equal((await persistence.listBindings({ wechatAccountId: "account_1", take: 900 })).length, 1);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma uniqueness failures propagate without LocalStore fallback", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const prismaError = Object.assign(new Error("unique constraint"), { code: "P2002" });
    const persistence = new PersonalWechatRpaPersistence({
      async $transaction() { throw prismaError; },
    }, forbiddenLocalStore());
    await assert.rejects(persistence.upsertBinding(bindingInput()), (error) => error === prismaError && error.code === "P2002");
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma persistence refuses to claim an existing non-personal account", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-conflict-"));
    const { prisma, state } = buildFakePrisma({
      accounts: [{
        id: "account_1", displayName: "企业微信账号", alias: null, isActive: true,
        personalWechatOwnerWxId: null, personalWechatAccountNickname: null,
      }],
    });
    const persistence = new PersonalWechatRpaPersistence(prisma, createLocalStore(tempDir));
    await assert.rejects(persistence.upsertBinding(bindingInput()), /registry account identity conflicts/);
    assert.equal(state.customers.size, 0);
    assert.equal(state.conversations.size, 0);
    assert.equal(state.bindings.size, 0);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma audit is allowlisted, redacted and pagination cursors are account scoped", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-audit-"));
    const { prisma, state } = buildFakePrisma();
    const persistence = new PersonalWechatRpaPersistence(prisma, createLocalStore(tempDir));
    const secret = "never-store-this-rpa-token";
    const auditA = await persistence.recordAudit({
      direction: "inbound",
      status: "failed",
      wechatAccountId: "account_1",
      token: secret,
      endpoint: "http://127.0.0.1:3211",
      errorMessage: `Bearer ${secret} failed at http://127.0.0.1:3211/send`,
    }, [secret, "http://127.0.0.1:3211"]);
    const auditB = await persistence.recordAudit({ direction: "inbound", status: "processed", wechatAccountId: "account_2" });

    assert.doesNotMatch(JSON.stringify(state.writes), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(auditA), /127\.0\.0\.1|endpoint|token/i);
    await assert.rejects(
      persistence.listAudit({ wechatAccountId: "account_1", cursor: auditB.id }),
      /cursor does not belong to the authenticated WeChat account/,
    );
    await assert.rejects(
      persistence.listBindings({ wechatAccountId: "account_1", cursor: "missing-binding" }),
      /cursor does not belong to the authenticated WeChat account/,
    );
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("production service rejects legacy identity and audits duplicate content drift without local fallback", async () => {
  const previous = appConfig.useLocalStore;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-service-prisma-"));
  const configFile = path.join(tempDir, "personal-wechat-rpa.json");
  const secret = "production-rpa-token-secret";
  process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE = configFile;
  delete process.env.PERSONAL_WECHAT_RPA_TOKEN;
  delete process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME;
  appConfig.useLocalStore = false;
  try {
    fs.writeFileSync(configFile, JSON.stringify({
      instances: [{
        wechatAccountId: "account_1",
        endpoint: "http://127.0.0.1:3211",
        token: secret,
        accountNickname: "客服一号",
        ownerWxId: "wxid_owner_1",
        enabled: true,
      }],
    }), "utf8");
    const { prisma, state } = buildFakePrisma();
    const localStore = createLocalStore(tempDir);
    const dispatch = {
      async processInboundMessage(payload) {
        return {
          deduplicated: true,
          message: {
            id: "message_existing",
            conversationId: payload.conversationId,
            customerId: payload.customerId,
            wechatAccountId: payload.wechatAccountId,
            externalId: payload.externalId,
            text: "changed text",
          },
        };
      },
    };
    const service = new PersonalWechatRpaService(localStore, dispatch, prisma);
    await assert.rejects(service.processInbound({
      version: "personal_wechat_rpa_event_v1",
      accountNickname: "客服一号",
      ownerWxId: "wxid_owner_1",
      chatTitle: "客户甲",
      conversationType: "direct",
      senderName: "客户甲",
      message: "original text",
      externalId: "external_1",
      createdAt: "2026-07-19T10:00:00.000Z",
      attachments: [],
    }, secret), /duplicate inbound externalId conflict/);
    assert.equal([...state.audits.values()].at(-1).status, "failed");
    assert.doesNotMatch(JSON.stringify(state.audits), new RegExp(secret));
    assert.equal(localStore.listPersonalWechatRpaBindings({ wechatAccountId: "account_1" }).length, 0);

    fs.writeFileSync(configFile, JSON.stringify({
      accountNickname: "客服一号",
      ownerWxId: "wxid_owner_1",
      token: secret,
      endpoint: "http://127.0.0.1:3211",
    }), "utf8");
    await assert.rejects(service.getStatus(secret), /requires an explicit registry account id/);
  } finally {
    appConfig.useLocalStore = previous;
    delete process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE;
  }
});

test("registry rejects duplicate nickname, ownerWxId and token before writing secrets", () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-registry-unique-"));
  const configFile = path.join(tempDir, "personal-wechat-rpa.json");
  process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE = configFile;
  try {
    const { prisma } = buildFakePrisma();
    const service = new PersonalWechatRpaService(createLocalStore(tempDir), {}, prisma);
    service.upsertInstance({
      wechatAccountId: "account_1", endpoint: "http://127.0.0.1:3211", token: "secret-one",
      accountNickname: "客服一号", ownerWxId: "wxid_owner_1", enabled: true,
    });
    const before = fs.readFileSync(configFile, "utf8");
    const duplicate = {
      wechatAccountId: "account_2", endpoint: "http://127.0.0.1:3212", token: "secret-one",
      accountNickname: "客服一号", ownerWxId: "wxid_owner_1", enabled: true,
    };
    const validation = service.validateInstance(duplicate);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(" "), /accountNickname must be unique/);
    assert.match(validation.errors.join(" "), /ownerWxId must be unique/);
    assert.match(validation.errors.join(" "), /token must be unique/);
    assert.doesNotMatch(JSON.stringify(validation), /secret-one/);
    assert.throws(() => service.upsertInstance(duplicate), /must be unique/);
    assert.equal(fs.readFileSync(configFile, "utf8"), before);
  } finally {
    appConfig.useLocalStore = previous;
    delete process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE;
  }
});

test("schema and migration persist only personal WeChat business fields", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const migration = fs.readFileSync(path.join(
    __dirname, "..", "prisma", "migrations", "20260719210000_personal_wechat_rpa_persistence", "migration.sql",
  ), "utf8");
  assert.match(schema, /model PersonalWechatRpaBinding/);
  assert.match(schema, /model PersonalWechatRpaAuditLog/);
  assert.match(schema, /enum ConversationChannel\s*\{[^}]*personal_wechat/s);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'personal_wechat'/);
  const personalModels = schema.match(/model PersonalWechatRpaBinding[\s\S]*?\n\}|model PersonalWechatRpaAuditLog[\s\S]*?\n\}/g).join("\n");
  assert.doesNotMatch(personalModels, /token|endpoint|windowHandle|processId|sessionId|localPath/i);
});
