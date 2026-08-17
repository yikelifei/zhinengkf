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
    paymentEvents: [],
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

function isOperationKeyReuseError(error) {
  const response = typeof error?.getResponse === "function" ? error.getResponse() : null;
  return response?.code === "OPERATION_KEY_REUSED";
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

test("chat import can require human review even for high-scoring verbatim samples", () => {
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_pre_sales", key: "pre_sales", name: "Pre Sales Agent" }],
    }),
  );

  const result = store.createChatImport(
    {
      name: "Xiaoshi sanitized verbatim chat",
      text: "客户：公司周年庆要伴手礼\n客服：咱们是什么类型的公司，预算多少呢",
      reviewMode: "required",
    },
    {
      messageCount: 2,
      pairCount: 1,
      warnings: [],
      pairs: [{
        question: "公司周年庆要伴手礼",
        answer: "咱们是什么类型的公司，预算多少呢",
        scene: "售前转化",
        agentKey: "pre_sales",
        sceneScore: 30,
        matchedKeywords: ["伴手礼"],
        sceneScores: [],
        sceneCheck: { status: "clear", reason: "top_scene_confident", needsReview: false },
        score: 96,
      }],
    },
  );

  assert.equal(result.samples[0].status, "review");
  assert.equal(result.sceneSummary.readyCount, 0);
  assert.equal(result.sceneSummary.reviewCount, 1);
  const knowledge = store.listKnowledgeEntries({ includeReview: true })
    .find((entry) => entry.content.includes("公司周年庆要伴手礼"));
  assert.ok(knowledge);
  assert.equal(knowledge.status, "review");
  assert.equal(knowledge.reviewNote, "chat import requires human review before reply use");
  assert.equal(
    store.listKnowledgeEntries().some((entry) => entry.content.includes("公司周年庆要伴手礼")),
    false,
  );
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

  const currentIds = store
    .listKnowledgeEntries({
      agentId: "agent_logistics_exception",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    })
    .map((entry) => entry.id);
  assert.ok(currentIds.includes("knowledge_starter_delivery"), "global knowledge remains visible in a scoped lookup");
  assert.ok(currentIds.includes("knowledge_legacy_current"));
  assert.equal(currentIds.includes("knowledge_conflict"), false);

  const otherCustomerIds = store.listKnowledgeEntries({
    agentId: "agent_logistics_exception",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_2",
  }).map((entry) => entry.id);
  assert.ok(otherCustomerIds.includes("knowledge_starter_delivery"));
  assert.equal(otherCustomerIds.includes("knowledge_legacy_current"), false);
  assert.equal(otherCustomerIds.includes("knowledge_conflict"), false);
});

test("manual knowledge import stays in review until human approval enables reply retrieval", () => {
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_general", key: "general", name: "General Agent" }],
      wechatAccounts: [{ id: "wechat_demo_1", name: "Demo account" }],
      customers: [{ id: "customer_demo_1", name: "Demo customer" }],
      conversations: [{
        id: "conversation_demo_1",
        customerId: "customer_demo_1",
        wechatAccountId: "wechat_demo_1",
        channel: "wechat",
        title: "Demo conversation",
      }],
    }),
  );

  const saved = store.importKnowledgeEntries(
    [{
      agentKey: "general",
      title: "发货 SOP",
      content: "客户问发货时间时，先确认订单号，再回复预计发货日。",
      tags: "发货,SOP",
      qualityScore: 92,
    }],
    {
      operationKey: "knowledge-review-test:33333333-3333-4333-8333-333333333333",
      source: "manual_knowledge_import",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    },
  );
  const entry = saved.results[0];

  assert.equal(entry.status, "review");
  assert.equal(entry.reviewNote, "manual knowledge import requires human review before reply use");
  assert.equal(
    store.listKnowledgeEntries({ agentId: "agent_general", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1" }).some((item) => item.id === entry.id),
    false,
  );
  assert.equal(
    store.listKnowledgeEntries({ agentId: "agent_general", includeReview: true, wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1" }).some((item) => item.id === entry.id),
    true,
  );

  const approved = store.reviewKnowledgeEntry(entry.id, {
    status: "ready",
    reviewer: "local_admin",
    note: "人工确认可用于发货回复。",
  });
  assert.equal(approved.knowledgeEntry.status, "ready");
  assert.equal(approved.reviewLog.decision, "approve_knowledge_entry");
  assert.equal(
    store.listKnowledgeEntries({ agentId: "agent_general", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1" }).some((item) => item.id === entry.id),
    true,
  );

  const rejected = store.reviewKnowledgeEntry(entry.id, {
    status: "rejected",
    reviewer: "local_admin",
    note: "旧 SOP 不再使用。",
  });
  assert.equal(rejected.knowledgeEntry.status, "rejected");
  assert.equal(
    store.listKnowledgeEntries({ agentId: "agent_general", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1" }).some((item) => item.id === entry.id),
    false,
  );
});

test("training sample review replays by operationKey without duplicating history or audit", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_after_sales", key: "after_sales", name: "After Sales Agent" }],
      trainingSamples: [{
        id: "sample_review_replay",
        sourceType: "chat_import",
        status: "review",
        agentId: "agent_after_sales",
        agentKey: "after_sales",
        scene: "after_sales",
        customerText: "package arrived broken",
        idealReply: "Please send the package photo and waybill so I can arrange a replacement.",
        score: 91,
        skillHints: ["after_sales"],
        reviewHistory: [],
        createdAt: now,
        updatedAt: now,
      }],
    }),
  );
  const payload = {
    operationKey: "training-review:55555555-5555-4555-8555-555555555555",
    status: "ready",
    reviewer: "local_admin",
    note: "confirmed useful after-sales sample",
  };

  const first = store.reviewTrainingSample("sample_review_replay", payload);
  const replay = store.reviewTrainingSample("sample_review_replay", payload);
  const sample = store.listTrainingSamples({ agentId: "agent_after_sales" }).find((item) => item.id === "sample_review_replay");

  assert.equal(first.reviewLog.id, replay.reviewLog.id);
  assert.equal(sample.status, "ready");
  assert.equal(sample.reviewHistory.length, 1);
  assert.equal(store.listReviewLogs().filter((log) => log.targetId === "sample_review_replay").length, 1);
  assert.throws(
    () => store.reviewTrainingSample("sample_review_replay", { ...payload, note: "changed payload" }),
    isOperationKeyReuseError,
  );
});

test("knowledge entry review replays by operationKey without duplicating history or audit", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_general", key: "general", name: "General Agent" }],
      knowledgeEntries: [{
        id: "knowledge_review_replay",
        agentId: "agent_general",
        sourceType: "manual_knowledge_import",
        status: "review",
        title: "Shipping evidence SOP",
        content: "Confirm carrier, tracking number, shipping time, and customer-visible delivery evidence before closing the order.",
        tags: ["shipping", "audit"],
        qualityScore: 88,
        reviewHistory: [],
        createdAt: now,
        updatedAt: now,
      }],
    }),
  );
  const payload = {
    operationKey: "knowledge-review:66666666-6666-4666-8666-666666666666",
    status: "ready",
    reviewer: "local_admin",
    note: "approved for delivery replies",
  };

  const first = store.reviewKnowledgeEntry("knowledge_review_replay", payload);
  const replay = store.reviewKnowledgeEntry("knowledge_review_replay", payload);
  const entry = store.listKnowledgeEntries({ agentId: "agent_general", includeReview: true }).find((item) => item.id === "knowledge_review_replay");

  assert.equal(first.reviewLog.id, replay.reviewLog.id);
  assert.equal(entry.status, "ready");
  assert.equal(entry.reviewHistory.length, 1);
  assert.equal(store.listReviewLogs().filter((log) => log.targetId === "knowledge_review_replay").length, 1);
  assert.throws(
    () => store.reviewKnowledgeEntry("knowledge_review_replay", { ...payload, status: "rejected" }),
    isOperationKeyReuseError,
  );
});

test("knowledge import replay preserves reviewed state and does not add audit logs", () => {
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_general", key: "general", name: "General Agent" }],
      wechatAccounts: [{ id: "wechat_demo_1", name: "Demo account" }],
      customers: [{ id: "customer_demo_1", name: "Demo customer" }],
      conversations: [{
        id: "conversation_demo_1",
        customerId: "customer_demo_1",
        wechatAccountId: "wechat_demo_1",
        channel: "wechat",
        title: "Demo conversation",
      }],
    }),
  );
  const row = {
    agentKey: "general",
    title: "Delivery close SOP",
    content: "Only close delivery after the payment ledger, shipment facts, customer message evidence, and sign-off facts are all present.",
    tags: "delivery,audit",
    qualityScore: 93,
  };
  const context = {
    operationKey: "knowledge-import:77777777-7777-4777-8777-777777777777",
    source: "manual_knowledge_import",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  };

  const imported = store.importKnowledgeEntries([row], context);
  const entryId = imported.results[0].id;
  store.reviewKnowledgeEntry(entryId, {
    operationKey: "knowledge-ready:88888888-8888-4888-8888-888888888888",
    status: "ready",
    reviewer: "local_admin",
    note: "approved after manual review",
  });
  const logCountAfterReview = store.listReviewLogs().length;

  const replay = store.importKnowledgeEntries([row], context);
  const reviewed = store.listKnowledgeEntries({ includeReview: true }).find((entry) => entry.id === entryId);

  assert.equal(replay.results[0].id, entryId);
  assert.equal(reviewed.status, "ready");
  assert.equal(reviewed.reviewer, "local_admin");
  assert.equal(reviewed.reviewHistory.length, 1);
  assert.equal(store.listReviewLogs().length, logCountAfterReview);
  assert.throws(
    () => store.importKnowledgeEntries([{ ...row, title: "Changed title" }], context),
    isOperationKeyReuseError,
  );
});

test("knowledge review blocks incomplete entries before ready retrieval", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_general", key: "general", name: "General Agent" }],
      knowledgeEntries: [{
        id: "knowledge_incomplete",
        sourceType: "manual_knowledge_import",
        status: "review",
        title: "",
        content: "too short",
        tags: [],
        qualityScore: 40,
        createdAt: now,
        updatedAt: now,
      }],
    }),
  );

  assert.throws(
    () => store.reviewKnowledgeEntry("knowledge_incomplete", {
      status: "ready",
      reviewer: "local_admin",
      note: "should not be ready yet",
    }),
    /missing_agent.*missing_title.*short_content.*low_quality_score.*missing_tags/,
  );
  assert.equal(store.listKnowledgeEntries({ includeReview: true }).find((entry) => entry.id === "knowledge_incomplete").status, "review");

  const approved = store.reviewKnowledgeEntry("knowledge_incomplete", {
    status: "ready",
    agentKey: "general",
    title: "Shipping SOP",
    content: "Confirm the order number first, then explain the estimated shipping date and next update point.",
    tags: ["shipping", "sop"],
    qualityScore: 88,
    reviewer: "local_admin",
    note: "complete enough for reply retrieval",
  });

  assert.equal(approved.knowledgeEntry.status, "ready");
  assert.equal(approved.knowledgeEntry.agentId, "agent_general");
  assert.equal(approved.knowledgeEntry.title, "Shipping SOP");
  assert.deepEqual(approved.knowledgeEntry.tags, ["shipping", "sop", "general"]);
  assert.equal(approved.knowledgeEntry.qualityScore, 88);
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

test("skill suggestion apply does not update existing skills with conflicting identity", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      agents: [{ id: "agent_gift_design", key: "gift_design", name: "Gift Design Agent" }],
      agentSkills: [
        {
          id: "skill_conflict_budget",
          agentId: "agent_gift_design",
          name: "预算澄清",
          description: "身份冲突的旧 Skill，不能被继续更新。",
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
    }),
  );

  const result = store.applyAgentSkillSuggestions([
    {
      agentId: "agent_gift_design",
      name: "预算澄清",
      description: "干净全局预算澄清。",
      sampleCount: 0,
      confidence: 80,
      sampleIds: [],
    },
  ]);

  assert.equal(result.updated.length, 0);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].description, "干净全局预算澄清。");
  const conflictSkill = store.listAgentSkills("agent_gift_design").find((skill) => skill.id === "skill_conflict_budget");
  assert.equal(conflictSkill.description, "身份冲突的旧 Skill，不能被继续更新。");
  assert.equal(conflictSkill.scope.label, "混合来源");
});
