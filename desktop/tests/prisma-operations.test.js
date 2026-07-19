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
