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
const { WechatPersistence } = require("../apps/api/src/wechat/wechat-persistence");

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
    messages: new Map((seed.messages || []).map((row) => [row.id, { ...row }])),
    inboundOperations: new Map(),
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
      async updateMany({ where, data }) {
        const row = state.conversations.get(where.id);
        if (!row) return { count: 0 };
        const incoming = data.lastMessageAt instanceof Date ? data.lastMessageAt : new Date(data.lastMessageAt);
        const current = row.lastMessageAt ? new Date(row.lastMessageAt) : null;
        if (current && current.getTime() >= incoming.getTime()) return { count: 0 };
        Object.assign(row, data, { updatedAt: now });
        return { count: 1 };
      },
    },
    personalWechatRpaBinding: {
      async findUnique({ where, include }) {
        const row = where.id
          ? state.bindings.get(where.id) || null
          : [...state.bindings.values()].find((item) => item.bindingKey === where.bindingKey) || null;
        return row && include ? hydrate(row) : row;
      },
      async findFirst({ where }) {
        if (where.conversationId || where.customerId) {
          const row = [...state.bindings.values()].find((item) =>
            item.wechatAccountId === where.wechatAccountId &&
            item.conversationId === where.conversationId &&
            item.customerId === where.customerId
          ) || null;
          return row ? hydrate(row) : null;
        }
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
      async updateMany({ where, data }) {
        const row = [...state.bindings.values()].find((item) => item.bindingKey === where.bindingKey) || null;
        if (!row) return { count: 0 };
        const incoming = data.lastInboundAt instanceof Date ? data.lastInboundAt : new Date(data.lastInboundAt);
        const current = row.lastInboundAt ? new Date(row.lastInboundAt) : null;
        if (current && current.getTime() >= incoming.getTime()) return { count: 0 };
        Object.assign(row, data, { updatedAt: now });
        return { count: 1 };
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
    message: {
      async findFirst({ where }) {
        const row = [...state.messages.values()].find((item) => {
          const conversation = state.conversations.get(item.conversationId);
          return item.direction === where.direction &&
            item.externalId === where.externalId &&
            conversation?.wechatAccountId === where.conversation.wechatAccountId;
        }) || null;
        if (!row) return null;
        return { ...row, conversation: state.conversations.get(row.conversationId) || null };
      },
    },
    inboundMessageOperation: {
      async create({ data }) {
        const duplicate = [...state.inboundOperations.values()].find((row) =>
          row.id === data.id ||
          (row.wechatAccountId === data.wechatAccountId && row.externalId === data.externalId)
        );
        if (duplicate) throw Object.assign(new Error("duplicate inbound operation"), { code: "P2002" });
        const row = { status: "processing", stage: "reserved", attemptCount: 1, ...data, createdAt: now, updatedAt: now };
        state.inboundOperations.set(row.id, row);
        return row;
      },
      async findUnique({ where }) {
        if (where.id) return state.inboundOperations.get(where.id) || null;
        const key = where.wechatAccountId_externalId;
        return [...state.inboundOperations.values()].find((row) =>
          row.wechatAccountId === key.wechatAccountId && row.externalId === key.externalId
        ) || null;
      },
      async update({ where, data }) {
        const row = state.inboundOperations.get(where.id);
        if (!row) throw new Error("inbound operation missing");
        Object.assign(row, data, { updatedAt: now });
        return row;
      },
      async updateMany({ where, data }) {
        const row = state.inboundOperations.get(where.id);
        if (!row) return { count: 0 };
        if (where.requestFingerprint && row.requestFingerprint !== where.requestFingerprint) return { count: 0 };
        if (where.status && typeof where.status === "string" && row.status !== where.status) return { count: 0 };
        if (where.status?.not && row.status === where.status.not) return { count: 0 };
        if (where.claimToken && row.claimToken !== where.claimToken) return { count: 0 };
        if (where.stage && row.stage !== where.stage) return { count: 0 };
        if (where.OR) {
          const matches = where.OR.some((condition) => {
            let match = true;
            if (condition.status?.in) match = match && condition.status.in.includes(row.status);
            if (typeof condition.status === "string") match = match && row.status === condition.status;
            if (Object.prototype.hasOwnProperty.call(condition, "leaseExpiresAt")) {
              match = match && (condition.leaseExpiresAt === null
                ? row.leaseExpiresAt == null
                : new Date(row.leaseExpiresAt || 0) < condition.leaseExpiresAt.lt);
            }
            return match;
          });
          if (!matches) return { count: 0 };
        }
        const next = { ...data };
        if (data.attemptCount?.increment) next.attemptCount = Number(row.attemptCount || 0) + data.attemptCount.increment;
        Object.assign(row, next, { updatedAt: now });
        return { count: 1 };
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

test("account-scoped RPA replay conflict is rejected before creating a new binding", async () => {
  const previous = appConfig.useLocalStore;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-preflight-"));
  const configFile = path.join(tempDir, "personal-wechat-rpa.json");
  const secret = "preflight-rpa-token-secret";
  process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE = configFile;
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
    const persistence = new PersonalWechatRpaPersistence(prisma, forbiddenLocalStore());
    const binding = await persistence.upsertBinding(bindingInput({
      chatTitle: "客户甲",
      senderName: "客户甲",
      receivedAt: "2026-07-20T10:00:00.000Z",
    }));
    state.messages.set("message_existing", {
      id: "message_existing",
      conversationId: binding.conversationId,
      direction: "inbound",
      externalId: "external-account-global",
      text: "原始消息",
      attachments: [],
      metadata: {},
      createdAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    const countsBefore = {
      customers: state.customers.size,
      conversations: state.conversations.size,
      bindings: state.bindings.size,
    };
    let dispatchCalls = 0;
    const service = new PersonalWechatRpaService(forbiddenLocalStore(), {
      async processInboundMessage() { dispatchCalls += 1; throw new Error("must not dispatch conflicting replay"); },
    }, prisma);

    await assert.rejects(service.processInbound({
      version: "personal_wechat_rpa_event_v1",
      accountNickname: "客服一号",
      ownerWxId: "wxid_owner_1",
      chatTitle: "客户乙",
      conversationType: "direct",
      senderName: "客户乙",
      message: "冲突消息",
      externalId: "external-account-global",
      createdAt: "2026-07-20T11:00:00.000Z",
      attachments: [],
    }, secret), /duplicate inbound externalId conflict/);
    assert.equal(dispatchCalls, 0);
    assert.deepEqual({
      customers: state.customers.size,
      conversations: state.conversations.size,
      bindings: state.bindings.size,
    }, countsBefore);
    assert.equal([...state.audits.values()].at(-1).status, "failed");
  } finally {
    appConfig.useLocalStore = previous;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("concurrent account-scoped reservation loser creates zero binding side effects", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma();
    const persistence = new PersonalWechatRpaPersistence(prisma, forbiddenLocalStore());
    const common = {
      wechatAccountId: "account_1",
      accountNickname: "客服一号",
      ownerWxId: "wxid_owner_1",
      conversationType: "direct",
      receivedAt: "2026-07-20T10:00:00.000Z",
      externalId: "concurrent-account-event",
      leaseExpiresAt: "2026-07-20T10:05:00.000Z",
    };
    const first = persistence.claimInboundAndBind({
      ...common,
      chatTitle: "客户甲",
      senderName: "客户甲",
      requestFingerprint: "fingerprint-a",
      normalizedPayload: { chatTitle: "客户甲", message: "甲消息" },
      claimToken: "claim-a",
    });
    const second = persistence.claimInboundAndBind({
      ...common,
      chatTitle: "客户乙",
      senderName: "客户乙",
      requestFingerprint: "fingerprint-b",
      normalizedPayload: { chatTitle: "客户乙", message: "乙消息" },
      claimToken: "claim-b",
    });
    const settled = await Promise.allSettled([first, second]);
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
    assert.match(String(settled.find((item) => item.status === "rejected").reason), /duplicate inbound externalId conflict/);
    assert.equal(state.inboundOperations.size, 1);
    assert.equal(state.customers.size, 1);
    assert.equal(state.conversations.size, 1);
    assert.equal(state.bindings.size, 1);
    assert.equal([...state.bindings.values()][0].chatTitle, "客户甲");
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma inbound reservation resumes a failed claim from its durable binding stage", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma();
    const persistence = new PersonalWechatRpaPersistence(prisma, forbiddenLocalStore());
    const claim = {
      ...bindingInput(),
      externalId: "resume-prisma-inbound",
      requestFingerprint: "resume-fingerprint",
      normalizedPayload: { chatTitle: "客户甲", message: "恢复消息" },
      claimToken: "resume-claim-1",
      leaseExpiresAt: "2099-07-20T10:05:00.000Z",
    };
    const first = await persistence.claimInboundAndBind(claim);
    assert.equal(first.operation.stage, "binding_ready");
    const wechatPersistence = new WechatPersistence(prisma, forbiddenLocalStore());
    await wechatPersistence.failInboundOperation(first.operation.id, claim.claimToken, new Error("injected post-binding crash"));
    const failed = state.inboundOperations.get(first.operation.id);
    assert.equal(failed.status, "retryable");
    assert.equal(failed.stage, "binding_ready");

    const resumed = await persistence.claimInboundAndBind({
      ...claim,
      claimToken: "resume-claim-2",
      leaseExpiresAt: "2099-07-20T10:10:00.000Z",
    });
    assert.equal(resumed.claimed, true);
    assert.equal(resumed.operation.status, "processing");
    assert.equal(resumed.operation.stage, "binding_ready");
    assert.equal(resumed.operation.attemptCount, 2);
    assert.equal(state.customers.size, 1);
    assert.equal(state.conversations.size, 1);
    assert.equal(state.bindings.size, 1);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma reservation CAS never reopens an operation completed by a concurrent owner", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma();
    const persistence = new PersonalWechatRpaPersistence(prisma, forbiddenLocalStore());
    const claim = {
      ...bindingInput(),
      externalId: "completed-during-reclaim",
      requestFingerprint: "completed-race-fingerprint",
      normalizedPayload: { message: "竞态消息" },
      claimToken: "race-owner-1",
      leaseExpiresAt: "2026-07-20T10:05:00.000Z",
    };
    const first = await persistence.claimInboundAndBind(claim);
    const operation = state.inboundOperations.get(first.operation.id);
    operation.status = "retryable";
    operation.claimToken = null;
    operation.leaseExpiresAt = null;
    const originalUpdateMany = prisma.inboundMessageOperation.updateMany;
    let raced = false;
    prisma.inboundMessageOperation.updateMany = async (args) => {
      if (!raced) {
        raced = true;
        operation.status = "completed";
        operation.stage = "completed";
        operation.claimToken = null;
        operation.leaseExpiresAt = null;
      }
      return originalUpdateMany(args);
    };
    const replay = await persistence.claimInboundAndBind({
      ...claim,
      claimToken: "race-owner-2",
      leaseExpiresAt: "2099-07-20T10:10:00.000Z",
    });
    assert.equal(replay.completed, true);
    assert.equal(replay.claimed, false);
    assert.equal(operation.status, "completed");
    assert.equal(operation.stage, "completed");
    assert.equal(operation.claimToken, null);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("personal WeChat binding timestamps advance monotonically in Prisma and LocalStore", async () => {
  const previous = appConfig.useLocalStore;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-rpa-monotonic-"));
  try {
    appConfig.useLocalStore = false;
    const database = buildFakePrisma();
    const persistence = new PersonalWechatRpaPersistence(database.prisma, forbiddenLocalStore());
    await persistence.upsertBinding(bindingInput({ receivedAt: "2026-07-20T10:00:00.000Z" }));
    const newest = await persistence.upsertBinding(bindingInput({ receivedAt: "2026-07-20T12:00:00.000Z" }));
    const stale = await persistence.upsertBinding(bindingInput({ receivedAt: "2026-07-20T11:00:00.000Z" }));
    assert.equal(stale.lastInboundAt.toISOString(), newest.lastInboundAt.toISOString());
    assert.equal(stale.conversation.lastMessageAt.toISOString(), newest.conversation.lastMessageAt.toISOString());

    appConfig.useLocalStore = true;
    const localStore = createLocalStore(tempDir);
    localStore.upsertPersonalWechatRpaBinding(bindingInput({ receivedAt: "2026-07-20T10:00:00.000Z" }));
    const localNewest = localStore.upsertPersonalWechatRpaBinding(bindingInput({ receivedAt: "2026-07-20T12:00:00.000Z" }));
    const localStale = localStore.upsertPersonalWechatRpaBinding(bindingInput({ receivedAt: "2026-07-20T11:00:00.000Z" }));
    assert.equal(localStale.lastInboundAt, localNewest.lastInboundAt);
    assert.equal(localStale.conversation.lastMessageAt, localNewest.conversation.lastMessageAt);
  } finally {
    appConfig.useLocalStore = previous;
    fs.rmSync(tempDir, { recursive: true, force: true });
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
  const recoveryMigration = fs.readFileSync(path.join(
    __dirname, "..", "prisma", "migrations", "20260720160000_inbound_message_recovery", "migration.sql",
  ), "utf8");
  assert.match(schema, /model PersonalWechatRpaBinding/);
  assert.match(schema, /model PersonalWechatRpaAuditLog/);
  assert.match(schema, /model InboundMessageOperation/);
  assert.match(schema, /enum ConversationChannel\s*\{[^}]*personal_wechat/s);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'personal_wechat'/);
  assert.match(recoveryMigration, /UNIQUE INDEX "InboundMessageOperation_wechatAccountId_externalId_key"/);
  assert.match(recoveryMigration, /"requestFingerprint" TEXT NOT NULL/);
  const personalModels = schema.match(/model (?:PersonalWechatRpaBinding|PersonalWechatRpaAuditLog|InboundMessageOperation)[\s\S]*?\n\}/g).join("\n");
  assert.doesNotMatch(personalModels, /\btoken\s+String|endpoint|windowHandle|processId|sessionId|localPath/i);
  assert.doesNotMatch(recoveryMigration, /"(?:token|endpoint|windowHandle|processId|sessionId|localPath)"/i);
});
