"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");

function emptyStoreData(overrides = {}) {
  return {
    wechatAccounts: [],
    customers: [],
    conversations: [],
    messages: [],
    wechatWindowSnapshots: [],
    skus: [],
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    reviewLogs: [],
    agents: [],
    agentSkills: [],
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
    ...overrides,
  };
}

function createStore(seed) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-training-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return { store, tempDir };
}

test("human approval confirms uncertain imported scene for route memory", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      trainingSamples: [
        {
          id: "sample_uncertain_import",
          importId: "import_1",
          sourceType: "chat_import",
          status: "review",
          agentId: "agent_general",
          agentKey: "general",
          scene: "unclassified",
          sceneScore: 8,
          matchedKeywords: ["refund"],
          sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
          customerText: "cup broken refund help",
          idealReply: "I can help confirm the issue and give the next step.",
          score: 96,
          skillHints: ["after sales"],
          createdAt: now,
          updatedAt: now,
        },
      ],
      chatImports: [
        {
          id: "import_1",
          name: "manual chat",
          pairCount: 1,
          sceneSummary: {
            sampleCount: 1,
            clearCount: 0,
            weakCount: 1,
            ambiguousCount: 0,
            unmatchedCount: 0,
            sceneUncertainCount: 1,
            readyCount: 0,
            reviewCount: 1,
            rejectedCount: 0,
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );

  const result = store.reviewTrainingSample("sample_uncertain_import", {
    status: "ready",
    agentKey: "after_sales",
    scene: "after_sales",
    reviewer: "operator",
    note: "confirmed after-sales scene",
  });

  assert.equal(result.sample.status, "ready");
  assert.equal(result.sample.agentKey, "after_sales");
  assert.equal(result.sample.sceneCheck.status, "clear");
  assert.equal(result.sample.sceneCheck.reason, "human_confirmed_scene");
  assert.equal(result.sample.sceneCheck.needsReview, false);
  assert.equal(result.sample.sceneCheck.topScene.agentKey, "after_sales");
  assert.equal(result.sample.sceneCheck.topScene.score, 30);
  assert.equal(
    result.reviewLog.metadata.changedFields.some((field) => field.field === "sceneCheck"),
    true,
  );
  assert.deepEqual(store.listChatImports()[0].sceneSummary, {
    sampleCount: 1,
    clearCount: 1,
    weakCount: 0,
    ambiguousCount: 0,
    unmatchedCount: 0,
    sceneUncertainCount: 0,
    readyCount: 1,
    reviewCount: 0,
    rejectedCount: 0,
  });
});

test("chat import stores scene summary for later review", () => {
  const { store } = createStore(
    emptyStoreData({
      agents: [
        { id: "agent_general", key: "general", name: "General Agent" },
        { id: "agent_after_sales", key: "after_sales", name: "After Sales Agent" },
      ],
    }),
  );

  const result = store.createChatImport(
    { name: "manual chat", text: "customer/service pairs" },
    {
      messageCount: 4,
      pairCount: 2,
      warnings: ["line ignored"],
      pairs: [
        {
          question: "broken cup refund",
          answer: "I will help check the issue.",
          scene: "after_sales",
          agentKey: "after_sales",
          sceneScore: 8,
          matchedKeywords: ["refund"],
          sceneScores: [],
          sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
          score: 96,
        },
        {
          question: "hello",
          answer: "I can help.",
          scene: "general",
          agentKey: "general",
          sceneScore: 20,
          matchedKeywords: ["hello"],
          sceneScores: [],
          sceneCheck: { status: "clear", reason: "top_scene_confident", needsReview: false },
          score: 62,
        },
      ],
    },
  );

  assert.deepEqual(result.sceneSummary, {
    sampleCount: 2,
    clearCount: 1,
    weakCount: 1,
    ambiguousCount: 0,
    unmatchedCount: 0,
    sceneUncertainCount: 1,
    readyCount: 1,
    reviewCount: 1,
    rejectedCount: 0,
  });
  assert.equal(result.samples.length, 2);
  assert.equal(Boolean(result.samples[0].quality), true);
  assert.deepEqual(store.listChatImports()[0].sceneSummary, result.sceneSummary);
});

test("knowledge entries with only identityBinding stay scoped in local store lists", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_logistics_exception", key: "logistics_exception", name: "Logistics Agent" }],
      knowledgeEntries: [
        {
          id: "knowledge_legacy_current",
          agentId: "agent_logistics_exception",
          sourceType: "chat_import",
          title: "物流异常",
          content: "客户：快递一直不动\n客服：我先帮您查下物流节点。",
          tags: ["物流"],
          qualityScore: 90,
          identityBinding: {
            status: "passed",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
          },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "knowledge_conflict",
          agentId: "agent_logistics_exception",
          sourceType: "chat_import",
          title: "物流异常冲突",
          content: "客户：快递一直不动\n客服：这条身份冲突，不能被使用。",
          tags: ["物流"],
          qualityScore: 100,
          wechatAccountId: "wechat_demo_1",
          conversationId: "conversation_demo_1",
          customerId: "customer_demo_1",
          identityBinding: {
            status: "passed",
            wechatAccountId: "wechat_demo_2",
            conversationId: "conversation_demo_2",
            customerId: "customer_demo_2",
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );

  assert.deepEqual(
    store
      .listKnowledgeEntries({
        agentId: "agent_logistics_exception",
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      })
      .map((entry) => entry.id),
    ["knowledge_legacy_current"],
  );
  assert.deepEqual(
    store.listKnowledgeEntries({
      agentId: "agent_logistics_exception",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_2",
    }),
    [],
  );
});

test("agent skills compiled from private samples stay scoped to matching identity", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_gift_design", key: "gift_design", name: "Gift Design Agent" }],
      agentSkills: [
        {
          id: "skill_global",
          agentId: "agent_gift_design",
          name: "高情商话术",
          description: "系统预置通用话术。",
          enabled: true,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "skill_private_one",
          agentId: "agent_gift_design",
          name: "预算澄清",
          description: "只来自一号微信客户的训练。",
          enabled: true,
          version: 1,
          sourceType: "training_compiler",
          sourceSampleIds: ["sample_one"],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "skill_private_two",
          agentId: "agent_gift_design",
          name: "设计需求确认",
          description: "只来自二号微信客户的训练。",
          enabled: true,
          version: 1,
          sourceType: "training_compiler",
          sourceSampleIds: ["sample_two"],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "skill_direct_private_two",
          agentId: "agent_gift_design",
          name: "私有补充话术",
          description: "直接绑定二号客户，不能在一号客户会话里出现。",
          enabled: true,
          version: 1,
          wechatAccountId: "wechat_demo_2",
          conversationId: "conversation_demo_2",
          customerId: "customer_demo_2",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "skill_conflict",
          agentId: "agent_gift_design",
          name: "冲突身份话术",
          description: "顶层身份和绑定身份冲突，不能进入客户可用 Skill。",
          enabled: true,
          version: 1,
          wechatAccountId: "wechat_demo_1",
          conversationId: "conversation_demo_1",
          customerId: "customer_demo_1",
          identityBinding: {
            status: "passed",
            wechatAccountId: "wechat_demo_2",
            conversationId: "conversation_demo_2",
            customerId: "customer_demo_2",
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
      trainingSamples: [
        {
          id: "sample_one",
          agentId: "agent_gift_design",
          agentKey: "gift_design",
          customerId: "customer_demo_1",
          conversationId: "conversation_demo_1",
          wechatAccountId: "wechat_demo_1",
          scene: "gift_design",
          customerText: "每盒 200，想看礼盒效果图",
          idealReply: "我先按预算帮您确认搭配。",
          score: 95,
          status: "ready",
          skillHints: ["预算澄清"],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "sample_two",
          agentId: "agent_gift_design",
          agentKey: "gift_design",
          customerId: "customer_demo_2",
          conversationId: "conversation_demo_2",
          wechatAccountId: "wechat_demo_2",
          scene: "gift_design",
          customerText: "需要把 logo 放进效果图",
          idealReply: "我会把 Logo 和参考图一起纳入设计需求。",
          score: 95,
          status: "ready",
          skillHints: ["设计需求确认"],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );

  const accountOneSkillIds = store
    .listAgentSkills("agent_gift_design", {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    })
    .map((skill) => skill.id);
  assert.equal(accountOneSkillIds.includes("skill_global"), true);
  assert.equal(accountOneSkillIds.includes("skill_private_one"), true);
  assert.equal(accountOneSkillIds.includes("skill_private_two"), false);
  assert.equal(accountOneSkillIds.includes("skill_direct_private_two"), false);
  assert.equal(accountOneSkillIds.includes("skill_conflict"), false);
  assert.equal(store.listAgentSkills("agent_gift_design").find((skill) => skill.id === "skill_conflict").scope.label, "混合来源");
  const accountOnePrivateSkill = store
    .listAgentSkills("agent_gift_design", {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    })
    .find((skill) => skill.id === "skill_private_one");
  assert.equal(accountOnePrivateSkill.scope.label, "当前会话私有");
  assert.equal(accountOnePrivateSkill.scope.conversationId, "conversation_demo_1");
  const accountOneAgent = store.listAgents({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  }).find((agent) => agent.id === "agent_gift_design");
  assert.ok(accountOneAgent);
  const accountOneAgentSkillIds = accountOneAgent.skills.map((skill) => skill.id);
  assert.equal(accountOneAgentSkillIds.includes("skill_global"), true);
  assert.equal(accountOneAgentSkillIds.includes("skill_private_one"), true);
  assert.equal(accountOneAgentSkillIds.includes("skill_private_two"), false);
  assert.equal(accountOneAgentSkillIds.includes("skill_direct_private_two"), false);
  assert.equal(accountOneAgentSkillIds.includes("skill_conflict"), false);
  assert.equal(accountOneAgent.skills.find((skill) => skill.id === "skill_global").scope.label, "全局 Skill");
  assert.equal(accountOneAgent.skills.find((skill) => skill.id === "skill_private_one").scope.label, "当前会话私有");
  assert.equal(accountOneAgent.trainingSampleCount, 1);

  const mismatchedSkillIds = store
    .listAgentSkills("agent_gift_design", {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_2",
    })
    .map((skill) => skill.id);
  assert.equal(mismatchedSkillIds.includes("skill_global"), true);
  assert.equal(mismatchedSkillIds.includes("skill_private_one"), false);
  assert.equal(mismatchedSkillIds.includes("skill_private_two"), false);
  assert.equal(mismatchedSkillIds.includes("skill_direct_private_two"), false);
  assert.equal(mismatchedSkillIds.includes("skill_conflict"), false);
  const mismatchedAgent = store.listAgents({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_2",
  }).find((agent) => agent.id === "agent_gift_design");
  assert.ok(mismatchedAgent);
  const mismatchedAgentSkillIds = mismatchedAgent.skills.map((skill) => skill.id);
  assert.equal(mismatchedAgentSkillIds.includes("skill_global"), true);
  assert.equal(mismatchedAgentSkillIds.includes("skill_private_one"), false);
  assert.equal(mismatchedAgentSkillIds.includes("skill_private_two"), false);
  assert.equal(mismatchedAgentSkillIds.includes("skill_direct_private_two"), false);
  assert.equal(mismatchedAgentSkillIds.includes("skill_conflict"), false);
  assert.equal(mismatchedAgent.trainingSampleCount, 0);
});

test("private skill suggestions do not overwrite global skills or mix customer identities", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_gift_design", key: "gift_design", name: "Gift Design Agent" }],
      agentSkills: [
        {
          id: "skill_global_budget",
          agentId: "agent_gift_design",
          name: "预算澄清",
          description: "系统预置全局预算澄清。",
          enabled: true,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      trainingSamples: [
        {
          id: "sample_one",
          agentId: "agent_gift_design",
          agentKey: "gift_design",
          customerId: "customer_demo_1",
          conversationId: "conversation_demo_1",
          wechatAccountId: "wechat_demo_1",
          scene: "gift_design",
          customerText: "每盒 200，想看礼盒效果图",
          idealReply: "我先按预算帮您确认搭配。",
          score: 95,
          status: "ready",
          skillHints: ["预算澄清"],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "sample_two",
          agentId: "agent_gift_design",
          agentKey: "gift_design",
          customerId: "customer_demo_2",
          conversationId: "conversation_demo_2",
          wechatAccountId: "wechat_demo_2",
          scene: "gift_design",
          customerText: "总预算 1 万，100 份",
          idealReply: "我先折算单份预算，再确认搭配。",
          score: 95,
          status: "ready",
          skillHints: ["预算澄清"],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );

  const scopedResult = store.applyAgentSkillSuggestions([
    {
      agentId: "agent_gift_design",
      name: "预算澄清",
      description: "来自一号客户的预算澄清训练。",
      sampleCount: 1,
      confidence: 95,
      sampleIds: ["sample_one"],
    },
  ]);

  assert.equal(scopedResult.created.length, 1);
  assert.equal(scopedResult.updated.length, 0);
  assert.equal(scopedResult.created[0].wechatAccountId, "wechat_demo_1");
  assert.equal(scopedResult.created[0].conversationId, "conversation_demo_1");
  assert.equal(scopedResult.created[0].customerId, "customer_demo_1");
  assert.equal(scopedResult.created[0].identityBinding.status, "passed");
  assert.deepEqual(scopedResult.created[0].identityBinding.sourceSampleIds, ["sample_one"]);

  const globalSkill = store.listAgentSkills("agent_gift_design").find((skill) => skill.id === "skill_global_budget");
  assert.equal(globalSkill.description, "系统预置全局预算澄清。");
  assert.equal(globalSkill.sourceType, undefined);

  const mixedResult = store.applyAgentSkillSuggestions([
    {
      agentId: "agent_gift_design",
      name: "预算澄清",
      description: "混合两个客户来源的预算澄清训练。",
      sampleCount: 2,
      confidence: 95,
      sampleIds: ["sample_one", "sample_two"],
    },
  ]);

  assert.equal(mixedResult.created.length, 0);
  assert.equal(mixedResult.updated.length, 0);
  assert.equal(mixedResult.skipped[0].reason, "mixed_source_identity");

  const spoofedScopeResult = store.applyAgentSkillSuggestions([
    {
      agentId: "agent_gift_design",
      name: "身份防伪测试",
      description: "前端传错身份时，后端必须按训练样本重新绑定。",
      sampleCount: 1,
      confidence: 95,
      sampleIds: ["sample_one"],
      wechatAccountId: "wechat_spoofed",
      conversationId: "conversation_spoofed",
      customerId: "customer_spoofed",
      identityBinding: {
        status: "passed",
        wechatAccountId: "wechat_spoofed",
        conversationId: "conversation_spoofed",
        customerId: "customer_spoofed",
      },
    },
  ]);

  assert.equal(spoofedScopeResult.created.length, 1);
  assert.equal(spoofedScopeResult.created[0].wechatAccountId, "wechat_demo_1");
  assert.equal(spoofedScopeResult.created[0].conversationId, "conversation_demo_1");
  assert.equal(spoofedScopeResult.created[0].customerId, "customer_demo_1");
  assert.deepEqual(spoofedScopeResult.created[0].identityBinding.sourceSampleIds, ["sample_one"]);

  const { store: conflictStore } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_gift_design", key: "gift_design", name: "Gift Design Agent" }],
      trainingSamples: [
        {
          id: "sample_conflict",
          agentId: "agent_gift_design",
          agentKey: "gift_design",
          customerId: "customer_top",
          conversationId: "conversation_top",
          wechatAccountId: "wechat_top",
          identityBinding: {
            status: "passed",
            customerId: "customer_binding",
            conversationId: "conversation_binding",
            wechatAccountId: "wechat_binding",
          },
          scene: "gift_design",
          customerText: "每盒 200，想看礼盒效果图",
          idealReply: "我先按预算帮您确认搭配。",
          score: 95,
          status: "ready",
          skillHints: ["预算澄清"],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
  const conflictResult = conflictStore.applyAgentSkillSuggestions([
    {
      agentId: "agent_gift_design",
      name: "预算澄清",
      description: "冲突身份样本不能应用。",
      sampleCount: 1,
      confidence: 95,
      sampleIds: ["sample_conflict"],
    },
  ]);

  assert.equal(conflictResult.created.length, 0);
  assert.equal(conflictResult.updated.length, 0);
  assert.equal(conflictResult.skipped[0].reason, "mixed_source_identity");
});
