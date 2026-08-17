"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { PrismaOperationsService } = require("../apps/api/src/prisma/prisma-operations.service");
const { initializePrismaAgentData } = require("../tools/initialize-prisma-agent-data");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { ConversationOperationsService } = require("../apps/api/src/conversation-ops/conversation-operations.service");

function transactional(tx, additions = {}) {
  return {
    ...additions,
    $transaction: async (callback) => callback(tx),
  };
}

function createPrismaKnowledgeHarness(overrides = {}) {
  const state = {
    agents: [{ id: "agent_shipping", key: "shipping", name: "Shipping Agent" }],
    conversations: [{
      id: "conversation_knowledge",
      customerId: "customer_knowledge",
      wechatAccountId: "wechat_knowledge",
    }],
    knowledgeEntries: [],
    reviewLogs: [],
    calls: {
      knowledgeCreate: 0,
      knowledgeUpdate: 0,
      knowledgeUpsert: 0,
      reviewCreate: 0,
    },
    ...overrides,
  };
  const tx = {
    conversation: {
      findUnique: async ({ where }) => state.conversations.find((row) => row.id === where.id) || null,
    },
    customerServiceAgent: {
      findUnique: async ({ where }) => state.agents.find((row) => {
        if (where.id) return row.id === where.id;
        if (where.key) return row.key === where.key;
        return false;
      }) || null,
    },
    knowledgeEntry: {
      findUnique: async ({ where }) => state.knowledgeEntries.find((row) => row.id === where.id) || null,
      findMany: async ({ where } = {}) => {
        const ids = where?.id?.in;
        if (Array.isArray(ids)) return state.knowledgeEntries.filter((row) => ids.includes(row.id));
        return [...state.knowledgeEntries];
      },
      create: async ({ data }) => {
        state.calls.knowledgeCreate += 1;
        const row = {
          id: data.id || `knowledge_${state.knowledgeEntries.length + 1}`,
          ...data,
          createdAt: data.createdAt || new Date("2026-07-29T00:00:00Z"),
          updatedAt: data.updatedAt || new Date("2026-07-29T00:00:00Z"),
        };
        state.knowledgeEntries.push(row);
        return row;
      },
      upsert: async ({ where, create, update }) => {
        state.calls.knowledgeUpsert += 1;
        const existingIndex = state.knowledgeEntries.findIndex((row) => row.id === where.id);
        const existing = state.knowledgeEntries[existingIndex];
        if (existing) {
          const row = { ...existing, ...update, updatedAt: new Date("2026-07-29T00:05:00Z") };
          state.knowledgeEntries[existingIndex] = row;
          return row;
        }
        const row = {
          ...create,
          createdAt: create.createdAt || new Date("2026-07-29T00:00:00Z"),
          updatedAt: create.updatedAt || new Date("2026-07-29T00:00:00Z"),
        };
        state.knowledgeEntries.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        state.calls.knowledgeUpdate += 1;
        const existingIndex = state.knowledgeEntries.findIndex((row) => row.id === where.id);
        const existing = state.knowledgeEntries[existingIndex];
        if (!existing) throw new Error(`missing knowledge entry ${where.id}`);
        const row = { ...existing, ...data, updatedAt: new Date("2026-07-29T00:10:00Z") };
        state.knowledgeEntries[existingIndex] = row;
        return row;
      },
    },
    reviewLog: {
      findFirst: async ({ where } = {}) => {
        const effectKey = String(where?.metadata?.equals || "").trim();
        if (!effectKey) return null;
        return [...state.reviewLogs].reverse().find((row) => row.metadata?.effectKey === effectKey) || null;
      },
      create: async ({ data }) => {
        state.calls.reviewCreate += 1;
        const row = {
          id: data.id || `review_${state.reviewLogs.length + 1}`,
          ...data,
          createdAt: data.createdAt || new Date("2026-07-29T00:00:00Z"),
        };
        state.reviewLogs.push(row);
        return row;
      },
    },
  };
  return { service: new PrismaOperationsService(transactional(tx)), state, tx };
}

test("writes Prisma JSON null sentinels instead of JavaScript null", async () => {
  let data;
  const tx = {
    conversation: { findUnique: async () => null },
    customerServiceAgent: { findUnique: async ({ where }) => ({ id: "agent_general", key: where.key, name: "General" }) },
    routeEvaluation: {
      create: async (input) => {
        data = input.data;
        return { id: "route_1", ...input.data, createdAt: new Date("2026-07-19T00:00:00Z"), updatedAt: new Date("2026-07-19T00:00:00Z") };
      },
    },
  };
  const service = new PrismaOperationsService(transactional(tx));
  await service.createRouteEvaluation({ text: "hello" }, {
    agentKey: "general", scene: "fallback", action: "manual_review", confidence: 10,
    sceneDecision: null, sceneClarification: null, sceneMemory: null, budget: null,
  });
  assert.notEqual(data.sceneDecision, null);
  assert.notEqual(data.sceneClarification, null);
  assert.notEqual(data.sceneMemory, null);
  assert.notEqual(data.identityBinding, null);
});

test("fails closed when account or customer identity is passed without conversation", async () => {
  let createCalled = false;
  const tx = {
    customerServiceAgent: { findUnique: async ({ where }) => ({ id: "agent_general", key: where.key, name: "General" }) },
    routeEvaluation: { create: async () => (createCalled = true) },
  };
  const service = new PrismaOperationsService(transactional(tx));
  await assert.rejects(
    service.createRouteEvaluation({ text: "hello", customerId: "customer_a", wechatAccountId: "wechat_a" }, {
      agentKey: "general", scene: "fallback", action: "manual_review", confidence: 10,
    }),
    /identity binding requires conversationId/,
  );
  assert.equal(createCalled, false);
});

test("hides private Agent Skill when any source sample reference is missing", async () => {
  const prisma = {
    agentSkill: { findMany: async () => [{ id: "skill_1", agentId: "agent_1", name: "预算澄清", sourceSampleIds: ["sample_missing"] }] },
    trainingSample: { findMany: async () => [] },
  };
  const service = new PrismaOperationsService(prisma);
  assert.deepEqual(await service.listAgentSkills("agent_1", { wechatAccountId: "wechat_a" }), []);
});

test("scoped knowledge lookup includes global knowledge and excludes other customer knowledge", async () => {
  const rows = [
    {
      id: "knowledge_global",
      agentId: "agent_pre_sales",
      title: "全局小石话术",
      content: "客户：好贵\n客服：咱这边预算多少，礼品可以调整",
      status: "ready",
      qualityScore: 98,
      trainingSample: null,
    },
    {
      id: "knowledge_current_customer",
      agentId: "agent_pre_sales",
      title: "当前客户知识",
      content: "当前客户可见",
      status: "ready",
      qualityScore: 90,
      wechatAccountId: "wechat_a",
      conversationId: "conversation_a",
      customerId: "customer_a",
      trainingSample: null,
    },
    {
      id: "knowledge_other_customer",
      agentId: "agent_pre_sales",
      title: "其他客户私有知识",
      content: "不得跨客户泄露",
      status: "ready",
      qualityScore: 100,
      wechatAccountId: "wechat_b",
      conversationId: "conversation_b",
      customerId: "customer_b",
      trainingSample: null,
    },
  ];
  const prisma = {
    knowledgeEntry: { findMany: async () => rows },
  };
  const service = new PrismaOperationsService(prisma);

  const visible = await service.listKnowledgeEntries({
    agentId: "agent_pre_sales",
    wechatAccountId: "wechat_a",
    conversationId: "conversation_a",
    customerId: "customer_a",
  });

  assert.deepEqual(visible.map((row) => row.id), ["knowledge_global", "knowledge_current_customer"]);
});

test("training review only refreshes knowledge linked to the reviewed sample", async () => {
  let knowledgeWhere;
  const before = {
    id: "sample_1", agentId: null, agentKey: "general", scene: "scene", customerText: "q", idealReply: "a",
    score: 80, status: "review", skillHints: [], sourceType: "manual", importId: null,
    customerId: "customer_a", conversationId: "conversation_a", wechatAccountId: "wechat_a",
  };
  const tx = {
    trainingSample: {
      findUnique: async () => before,
      update: async ({ data }) => ({ ...before, ...data }),
    },
    knowledgeEntry: {
      findMany: async ({ where }) => (knowledgeWhere = where, []),
      update: async () => { throw new Error("unexpected update"); },
    },
    reviewLog: { create: async ({ data }) => ({ id: "review_1", ...data }) },
  };
  const service = new PrismaOperationsService(transactional(tx));
  await service.reviewTrainingSample("sample_1", { status: "ready", expectedWechatAccountId: "wechat_a" });
  assert.deepEqual(knowledgeWhere.OR[0], { trainingSampleId: "sample_1" });
  assert.deepEqual(knowledgeWhere.OR[1], {
    sourceType: { in: ["chat_import", "route_correction"] },
    sourceId: "sample_1",
  });
});

test("Prisma manual knowledge import stores identity, skips bad rows and replays by operationKey", async () => {
  const { service, state } = createPrismaKnowledgeHarness();
  const identity = {
    conversationId: "conversation_knowledge",
    customerId: "customer_knowledge",
    wechatAccountId: "wechat_knowledge",
  };
  const rows = [
    {
      agentKey: "shipping",
      title: "发货时效 SOP",
      content: "客户询问发货时效时，先确认订单号，再说明仓库截单时间和预计物流节点。",
      tags: ["发货", "物流"],
      qualityScore: 88,
    },
    {
      agentKey: "missing-agent",
      title: "无法归属的知识",
      content: "这条知识没有可用 Agent，导入时必须跳过，不能进入回复检索。",
      tags: ["异常"],
      qualityScore: 80,
    },
  ];

  const first = await service.importKnowledgeEntries(rows, {
    ...identity,
    operationKey: "knowledge-import:33333333-3333-4333-8333-333333333333",
    source: "official-sop.csv",
  });
  const replay = await service.importKnowledgeEntries(rows, {
    ...identity,
    operationKey: "knowledge-import:33333333-3333-4333-8333-333333333333",
    source: "official-sop.csv",
  });

  assert.equal(first.count, 1);
  assert.equal(first.failed, false);
  assert.equal(first.skipped.length, 1);
  assert.equal(first.skipped[0].reason, "agent_not_found");
  assert.equal(replay.count, 1);
  assert.equal(state.calls.knowledgeUpsert, 1);
  assert.equal(state.calls.reviewCreate, 1);
  assert.equal(state.reviewLogs[0].decision, "import_manual_knowledge");
  assert.equal(state.reviewLogs[0].metadata.source, "official-sop.csv");
  assert.deepEqual(state.reviewLogs[0].metadata.knowledgeEntryIds, [state.knowledgeEntries[0].id]);
  assert.equal(state.knowledgeEntries[0].status, "review");
  assert.equal(state.knowledgeEntries[0].agentId, "agent_shipping");
  assert.equal(state.knowledgeEntries[0].wechatAccountId, identity.wechatAccountId);
  assert.equal(state.knowledgeEntries[0].conversationId, identity.conversationId);
  assert.equal(state.knowledgeEntries[0].customerId, identity.customerId);
  assert.deepEqual(state.knowledgeEntries[0].identityBinding, { status: "passed", ...identity });
  assert.ok(state.reviewLogs[0].metadata.effectKey);
  assert.ok(state.reviewLogs[0].metadata.requestOperation);

  await assert.rejects(
    service.importKnowledgeEntries([{ ...rows[0], title: "同 key 改 payload" }], {
      ...identity,
      operationKey: "knowledge-import:33333333-3333-4333-8333-333333333333",
      source: "official-sop.csv",
    }),
    /operationKey was already used with different identity or payload/,
  );
  await assert.rejects(
    service.importKnowledgeEntries(rows, {
      customerId: identity.customerId,
      wechatAccountId: identity.wechatAccountId,
      operationKey: "knowledge-import:no-conversation-33333333",
    }),
    /knowledge import identity binding requires conversationId/,
  );
});

test("Prisma knowledge import failure records retryable blockers idempotently", async () => {
  const { service, state } = createPrismaKnowledgeHarness();
  const identity = {
    conversationId: "conversation_knowledge",
    customerId: "customer_knowledge",
    wechatAccountId: "wechat_knowledge",
  };
  const parsed = {
    ok: false,
    importedCount: 0,
    skippedCount: 2,
    errors: [
      { row: 2, reason: "missing_title", title: "" },
      { row: 3, reason: "short_content", title: "售后" },
    ],
    missingRequiredFields: ["title", "content"],
    acceptance: { blockers: ["没有可导入知识", "缺少标题"] },
  };

  const first = await service.recordKnowledgeImportFailure(parsed, {
    ...identity,
    operationKey: "knowledge-import-failure:44444444-4444-4444-8444-444444444444",
    source: "official-sop.csv",
    phase: "parse_failed",
  });
  const replay = await service.recordKnowledgeImportFailure(parsed, {
    ...identity,
    operationKey: "knowledge-import-failure:44444444-4444-4444-8444-444444444444",
    source: "official-sop.csv",
    phase: "parse_failed",
  });

  assert.equal(first.id, replay.id);
  assert.equal(state.calls.reviewCreate, 1);
  assert.equal(first.decision, "import_manual_knowledge_failed");
  assert.equal(first.afterStatus, "failed");
  assert.equal(first.metadata.count, 0);
  assert.equal(first.metadata.skippedCount, 2);
  assert.equal(first.metadata.failure.phase, "parse_failed");
  assert.deepEqual(first.metadata.failure.missingRequiredFields, ["title", "content"]);
  assert.deepEqual(first.metadata.knowledgeEntryIds, []);
  assert.equal(first.metadata.wechatAccountId, identity.wechatAccountId);

  await assert.rejects(
    service.recordKnowledgeImportFailure({ ...parsed, errors: parsed.errors.slice(0, 1) }, {
      ...identity,
      operationKey: "knowledge-import-failure:44444444-4444-4444-8444-444444444444",
      source: "official-sop.csv",
      phase: "parse_failed",
    }),
    /operationKey was already used with different identity or payload/,
  );
});

test("Prisma knowledge entry review enforces identity, ready blockers and operation replay", async () => {
  const identity = {
    conversationId: "conversation_knowledge",
    customerId: "customer_knowledge",
    wechatAccountId: "wechat_knowledge",
  };
  const { service, state } = createPrismaKnowledgeHarness({
    knowledgeEntries: [
      {
        id: "knowledge_ready_candidate",
        agentId: "agent_shipping",
        trainingSampleId: null,
        sourceType: "manual_knowledge_import",
        sourceId: "official-sop.csv",
        ...identity,
        identityBinding: { status: "passed", ...identity },
        title: "补发处理 SOP",
        content: "客户要求补发时，先核对订单和缺件图片，再登记补发原因、物流单号和复核说明。",
        tags: ["补发", "售后", "shipping"],
        qualityScore: 82,
        status: "review",
        reviewer: null,
        reviewNote: "",
        reviewedAt: null,
        reviewHistory: [],
      },
      {
        id: "knowledge_incomplete",
        agentId: null,
        trainingSampleId: null,
        sourceType: "manual_knowledge_import",
        sourceId: "official-sop.csv",
        ...identity,
        identityBinding: { status: "passed", ...identity },
        title: "",
        content: "太短",
        tags: [],
        qualityScore: 20,
        status: "review",
        reviewer: null,
        reviewNote: "",
        reviewedAt: null,
        reviewHistory: [],
      },
    ],
  });
  const payload = {
    status: "ready",
    reviewer: "operator_knowledge",
    note: "确认 SOP 完整，可进入回复检索。",
    operationKey: "knowledge-review:55555555-5555-4555-8555-555555555555",
    expectedWechatAccountId: identity.wechatAccountId,
    expectedConversationId: identity.conversationId,
    expectedCustomerId: identity.customerId,
  };

  const first = await service.reviewKnowledgeEntry("knowledge_ready_candidate", payload);
  const replay = await service.reviewKnowledgeEntry("knowledge_ready_candidate", payload);

  assert.equal(first.knowledgeEntry.status, "ready");
  assert.equal(first.knowledgeEntry.reviewer, "operator_knowledge");
  assert.equal(first.reviewLog.decision, "approve_knowledge_entry");
  assert.equal(first.reviewLog.beforeStatus, "review");
  assert.equal(first.reviewLog.afterStatus, "ready");
  assert.equal(first.reviewLog.metadata.wechatAccountId, identity.wechatAccountId);
  assert.equal(replay.reviewLog.id, first.reviewLog.id);
  assert.equal(state.calls.knowledgeUpdate, 1);
  assert.equal(state.calls.reviewCreate, 1);

  await assert.rejects(
    service.reviewKnowledgeEntry("knowledge_ready_candidate", { ...payload, note: "同 key 改复核说明" }),
    /operationKey was already used with different identity or payload/,
  );
  await assert.rejects(
    service.reviewKnowledgeEntry("knowledge_ready_candidate", {
      status: "ready",
      reviewer: "operator_knowledge",
      note: "身份不匹配不能复核。",
      expectedCustomerId: "customer_other",
    }),
    /knowledge entry identity mismatch: customerId/,
  );
  await assert.rejects(
    service.reviewKnowledgeEntry("knowledge_incomplete", {
      status: "ready",
      reviewer: "operator_knowledge",
      note: "不完整知识不能标记可用。",
      expectedWechatAccountId: identity.wechatAccountId,
      expectedConversationId: identity.conversationId,
      expectedCustomerId: identity.customerId,
    }),
    /knowledge entry cannot be marked ready: missing_agent, missing_title, short_content, low_quality_score, missing_tags/,
  );
  assert.equal(state.calls.knowledgeUpdate, 1);
  assert.equal(state.calls.reviewCreate, 1);
});

test("conversation identity uses record id only for conversationId and audit lists synchronously", async () => {
  const conversation = { id: "conversation_a", wechatAccountId: "wechat_a", customerId: "customer_a" };
  const identity = { conversationId: conversation.id, wechatAccountId: conversation.wechatAccountId, customerId: conversation.customerId };
  const prisma = {
    conversation: {
      findMany: async () => [{ ...conversation, customer: {}, wechatAccount: {}, _count: { messages: 0 } }],
      findUnique: async () => ({ ...conversation, customer: {}, wechatAccount: {}, _count: { messages: 0 } }),
    },
    $queryRaw: async () => [],
    reviewLog: { findMany: async () => [
      { id: "review_1", metadata: { auditType: "conversation_operations" }, createdAt: new Date("2026-07-19T00:00:00Z") },
      { id: "review_2", metadata: { auditType: "other" }, createdAt: new Date("2026-07-19T00:00:00Z") },
    ] },
  };
  const service = new PrismaOperationsService(prisma);
  const rows = await service.listConversationAudit(identity, 100);
  assert.deepEqual(rows.map((row) => row.id), ["review_1"]);
  await assert.rejects(
    service.getConversation({ ...identity, wechatAccountId: "conversation_a" }),
    /identity mismatch: wechatAccountId/,
  );
});

test("conversation operation rejects invalid dates before any update", async () => {
  let updateCalled = false;
  const identity = { conversationId: "conversation_a", wechatAccountId: "wechat_a", customerId: "customer_a" };
  const tx = {
    conversation: {
      findUnique: async () => ({ id: identity.conversationId, wechatAccountId: identity.wechatAccountId, customerId: identity.customerId }),
      update: async () => (updateCalled = true),
    },
  };
  const service = new PrismaOperationsService(transactional(tx));
  await assert.rejects(
    service.updateConversationOperations(identity.conversationId, identity, { slaDueAt: "not-a-date" }, { reviewer: "operator" }),
    /slaDueAt must be a valid ISO date/,
  );
  assert.equal(updateCalled, false);
});

test("conversation reads are bounded and database DISTINCT ON preserves evidence per conversation", async () => {
  const rows = ["conversation_a", "conversation_b"].map((id) => ({
    id,
    wechatAccountId: "wechat_a",
    customerId: `customer_${id.at(-1)}`,
    customer: {},
    wechatAccount: {},
    _count: { messages: 0 },
  }));
  let listQuery;
  const prisma = {
    conversation: { findMany: async (query) => (listQuery = query, rows) },
    $queryRaw: async (query) => {
      const sql = query.strings.join(" ");
      if (sql.includes('FROM "Message"') && sql.includes("DESC")) return [
        { id: "message_a_latest", conversationId: "conversation_a", text: "A latest", createdAt: new Date("2026-07-19T02:00:00Z") },
        { id: "message_b_latest", conversationId: "conversation_b", text: "B latest", createdAt: new Date("2026-07-19T03:00:00Z") },
      ];
      if (sql.includes('FROM "Message"')) return [];
      return [];
    },
  };
  const service = new PrismaOperationsService(prisma);
  const result = await service.listConversations("wechat_a");
  assert.equal(listQuery.take, 501);
  assert.equal(result.scopeLimit, 500);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.records.map((row) => row.lastMessagePreview), ["A latest", "B latest"]);
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "prisma", "prisma-operations.service.ts"), "utf8");
  assert.match(source, /SELECT DISTINCT ON \("conversationId"\)/);
  assert.doesNotMatch(source, /distinct: \["conversationId"\]/);
});

test("getConversation queries by id even when target is older than the bounded queue", async () => {
  let listCalled = false;
  const identity = { conversationId: "conversation_older_than_500", wechatAccountId: "wechat_a", customerId: "customer_a" };
  const prisma = {
    conversation: {
      findMany: async () => (listCalled = true, []),
      findUnique: async ({ where }) => ({ id: where.id, wechatAccountId: "wechat_a", customerId: "customer_a", customer: {}, wechatAccount: {}, _count: { messages: 0 } }),
    },
    $queryRaw: async () => [],
  };
  const service = new PrismaOperationsService(prisma);
  assert.equal((await service.getConversation(identity)).id, identity.conversationId);
  assert.equal(listCalled, false);
});

test("Prisma conversation queue labels capped totals and summaries as partial", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const service = new ConversationOperationsService({}, {
      listConversations: async () => ({
        records: [{ id: "conversation_a", customerId: "customer_a", wechatAccountId: "wechat_a", priority: "normal", status: "open" }],
        truncated: true,
        scopeLimit: 500,
      }),
    });
    const result = await service.listQueue({});
    assert.equal(result.total, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.scopeLimit, 500);
    assert.equal(result.totalIsCapped, true);
    assert.equal(result.summary.partial, true);
    assert.equal(result.summary.scopeLimit, 500);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("explicit Agent initializer maps existing ids and performs zero writes on the second run", async () => {
  const state = {
    agents: [{ id: "database_agent_id", key: "general", name: "General", scene: "Fallback", description: "Safe", valueLevel: "review", enabled: true, sortOrder: 99 }],
    skills: [],
    audits: [],
    writes: [],
  };
  const tx = {
    customerServiceAgent: {
      findUnique: async ({ where }) => state.agents.find((agent) => agent.key === where.key) || null,
      create: async ({ data }) => (state.writes.push("agent.create"), state.agents.push({ ...data }), data),
      update: async ({ where, data }) => {
        state.writes.push("agent.update");
        const row = state.agents.find((agent) => agent.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    agentSkill: {
      findMany: async ({ where }) => state.skills.filter((skill) => skill.agentId === where.agentId),
      create: async ({ data }) => {
        state.writes.push("skill.create");
        const row = { id: `database_skill_${state.skills.length + 1}`, ...data };
        state.skills.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        state.writes.push("skill.update");
        const row = state.skills.find((skill) => skill.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    reviewLog: { create: async ({ data }) => (state.writes.push("audit.create"), state.audits.push(data), data) },
  };
  const prisma = transactional(tx);
  const seeded = {
    agents: [{ id: "agent_general", key: "general", name: "General", scene: "Fallback", description: "Safe", valueLevel: "review", enabled: true, sortOrder: 99 }],
    agentSkills: [{ agentId: "agent_general", name: "防乱回复", description: "Fail closed", enabled: true }],
  };
  const first = await initializePrismaAgentData(prisma, seeded, "operator");
  assert.equal(first.createdSkills, 1);
  assert.equal(state.skills[0].agentId, "database_agent_id");
  assert.equal(Object.hasOwn(state.skills[0], "id") && state.skills[0].id === "skill_1", false);
  const writesAfterFirst = state.writes.length;
  const second = await initializePrismaAgentData(prisma, seeded, "operator");
  assert.equal(second.status, "UNCHANGED");
  assert.equal(second.changed, false);
  assert.equal(state.writes.length, writesAfterFirst);
  assert.equal(state.audits.length, 1);
  const initializerSource = fs.readFileSync(path.join(__dirname, "..", "tools", "initialize-prisma-agent-data.ts"), "utf8");
  assert.doesNotMatch(initializerSource, /create\(\{ data: \{ id: agent\.id/);
});

test("migration contains identity isolation, route metadata and conversation operation columns", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260719190000_prisma_operations", "migration.sql"), "utf8");
  for (const fragment of [
    'ADD COLUMN "assignee" TEXT',
    'ADD COLUMN "firstResponseDueAt" TIMESTAMP(3)',
    'ALTER TABLE "AgentSkill"',
    'ADD COLUMN "identityBinding" JSONB',
    'ADD COLUMN "sourceRouteId" TEXT',
    'ADD COLUMN "sceneDecision" JSONB',
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
