"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { TrainingService } = require("../apps/api/src/training/training.service");

function createTrainingService(samples) {
  const calls = [];
  const rows = samples.map((sample) => ({ ...sample }));
  const localStore = {
    listTrainingSamples: (filter = {}) => {
      const options = typeof filter === "string" ? { agentId: filter } : filter;
      calls.push({ method: "listTrainingSamples", ...options });
      return rows
        .filter((sample) => !options.agentId || sample.agentId === options.agentId)
        .filter((sample) => !options.wechatAccountId || sample.wechatAccountId === options.wechatAccountId)
        .filter((sample) => !options.conversationId || sample.conversationId === options.conversationId)
        .filter((sample) => !options.customerId || sample.customerId === options.customerId);
    },
    reviewTrainingSample: (sampleId, payload) => {
      calls.push({ method: "reviewTrainingSample", sampleId, payload });
      const index = rows.findIndex((sample) => sample.id === sampleId);
      if (index < 0) throw new Error(`training sample not found: ${sampleId}`);
      rows[index] = {
        ...rows[index],
        status: payload.status,
        reviewer: payload.reviewer,
        reviewNote: payload.note,
      };
      return {
        sample: rows[index],
        reviewLog: {
          id: `review_${sampleId}`,
          targetId: sampleId,
          afterStatus: payload.status,
          note: payload.note,
        },
      };
    },
    listAgentSkills: (agentId, filter = {}) => {
      calls.push({ method: "listAgentSkills", agentId, ...filter });
      return [];
    },
    applyAgentSkillSuggestions: (suggestions) => {
      calls.push({ method: "applyAgentSkillSuggestions", suggestionCount: suggestions.length });
      return { created: [], updated: [], skipped: [] };
    },
    createChatImport: (payload, parsed) => {
      calls.push({ method: "createChatImport", payload, parsed });
      return {
        id: "import_test",
        ...payload,
        messageCount: parsed.messageCount || 0,
        pairCount: parsed.pairCount || 0,
        samples: [],
      };
    },
  };
  return {
    calls,
    rows,
    service: new TrainingService(localStore, { create: () => ({}) }),
  };
}

const samples = [
  {
    id: "safe_1",
    agentId: "agent_gift",
    status: "ready",
    sourceType: "chat_import",
    quality: {
      level: "safe",
      trainable: true,
      flags: [],
      usage: { routeMemory: true, replySkill: true, scope: "route_and_reply" },
    },
  },
  {
    id: "anti_1",
    agentId: "agent_gift",
    status: "ready",
    sourceType: "route_correction",
    quality: {
      level: "review",
      trainable: true,
      flags: ["scene_clarification_reply", "anti_wrong_reply_only"],
      usage: { routeMemory: false, replySkill: false, antiWrongReply: true, scope: "anti_wrong_reply" },
    },
  },
  {
    id: "review_1",
    agentId: "agent_after_sales",
    status: "review",
    sourceType: "chat_import",
    quality: {
      level: "review",
      trainable: false,
      flags: ["manual_review_required"],
      usage: { routeMemory: false, replySkill: false, scope: "review" },
    },
  },
  {
    id: "risk_1",
    agentId: "agent_after_sales",
    status: "ready",
    sourceType: "chat_import",
    quality: {
      level: "risk",
      trainable: false,
      flags: ["low_score"],
      usage: { routeMemory: false, replySkill: true, scope: "reply_only" },
    },
  },
  {
    id: "blocked_1",
    agentId: "agent_after_sales",
    status: "rejected",
    sourceType: "manual",
    quality: {
      level: "blocked",
      trainable: false,
      flags: ["rejected"],
      usage: { routeMemory: false, replySkill: false, scope: "none" },
    },
  },
];

test("filters training samples by quality without mixing anti-wrong-reply into review", () => {
  const { service } = createTrainingService(samples);

  assert.deepEqual(service.listSamples({ quality: "safe" }).map((sample) => sample.id), ["safe_1"]);
  assert.deepEqual(service.listSamples({ quality: "anti_wrong_reply" }).map((sample) => sample.id), ["anti_1"]);
  assert.deepEqual(service.listSamples({ quality: "review" }).map((sample) => sample.id), ["review_1"]);
  assert.deepEqual(service.listSamples({ quality: "risk" }).map((sample) => sample.id), ["risk_1"]);
  assert.deepEqual(service.listSamples({ quality: "blocked" }).map((sample) => sample.id), ["blocked_1"]);
  assert.deepEqual(service.listSamples({ quality: "needs_attention" }).map((sample) => sample.id), ["review_1", "risk_1"]);
});

test("filters training samples by usage target", () => {
  const { service } = createTrainingService(samples);

  assert.deepEqual(service.listSamples({ quality: "route_memory" }).map((sample) => sample.id), ["safe_1"]);
  assert.deepEqual(service.listSamples({ quality: "reply_skill" }).map((sample) => sample.id), ["safe_1", "risk_1"]);
  assert.deepEqual(service.listSamples({ quality: "route_and_reply" }).map((sample) => sample.id), ["safe_1"]);
});

test("filters imported samples that need scene confirmation before route memory", () => {
  const { service } = createTrainingService([
    {
      id: "scene_weak_1",
      agentId: "agent_after_sales",
      status: "ready",
      sourceType: "chat_import",
      sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
      quality: {
        level: "safe",
        trainable: true,
        flags: [],
        usage: { routeMemory: false, replySkill: true, scope: "reply_only", flags: ["scene_weak"] },
      },
    },
    {
      id: "scene_clear_1",
      agentId: "agent_after_sales",
      status: "ready",
      sourceType: "chat_import",
      sceneCheck: { status: "clear", reason: "human_confirmed_scene", needsReview: false },
      quality: {
        level: "safe",
        trainable: true,
        flags: [],
        usage: { routeMemory: true, replySkill: true, scope: "route_and_reply", flags: [] },
      },
    },
    {
      id: "route_correction_1",
      agentId: "agent_after_sales",
      status: "ready",
      sourceType: "route_correction",
      sceneCheck: { status: "weak", reason: "legacy", needsReview: true },
      quality: {
        level: "safe",
        trainable: true,
        flags: [],
        usage: { routeMemory: true, replySkill: false, scope: "route_memory", flags: [] },
      },
    },
  ]);

  assert.deepEqual(service.listSamples({ quality: "scene_uncertain" }).map((sample) => sample.id), ["scene_weak_1"]);
});

  test("filters training samples by trainability, status, source, agent and limit", () => {
    const { service, calls } = createTrainingService(samples);

  assert.equal(service.listSamples({ quality: "all" }).length, samples.length);
  assert.deepEqual(service.listSamples({ quality: "trainable" }).map((sample) => sample.id), ["safe_1", "anti_1"]);
  assert.deepEqual(service.listSamples({ quality: "not_trainable" }).map((sample) => sample.id), [
    "review_1",
    "risk_1",
    "blocked_1",
  ]);
  assert.deepEqual(service.listSamples({ status: "ready", sourceType: "chat_import" }).map((sample) => sample.id), [
    "safe_1",
    "risk_1",
  ]);
  assert.deepEqual(service.listSamples({ quality: "trainable", limit: 1 }).map((sample) => sample.id), ["safe_1"]);
  assert.deepEqual(service.listSamples("agent_gift").map((sample) => sample.id), ["safe_1", "anti_1"]);
    assert.equal(calls.at(-1).agentId, "agent_gift");
  });

test("passes identity filters when listing training samples", () => {
    const { service, calls } = createTrainingService([
      {
        id: "account_a_sample",
        agentId: "agent_gift",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_a",
        conversationId: "conv_a",
        customerId: "customer_a",
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
      {
        id: "account_b_sample",
        agentId: "agent_gift",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_b",
        conversationId: "conv_b",
        customerId: "customer_b",
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
    ]);

    assert.deepEqual(
      service
        .listSamples({
          agentId: "agent_gift",
          wechatAccountId: "wechat_a",
          conversationId: "conv_a",
          customerId: "customer_a",
        })
        .map((sample) => sample.id),
      ["account_a_sample"],
    );
    assert.deepEqual(calls.at(-1), {
      method: "listTrainingSamples",
      agentId: "agent_gift",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
    });
  });

  test("filters training samples by chat import id after identity filtering", () => {
    const { service, calls } = createTrainingService([
      {
        id: "import_a_sample",
        agentId: "agent_gift",
        status: "ready",
        sourceType: "chat_import",
        importId: "import_a",
        wechatAccountId: "wechat_a",
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
      {
        id: "import_b_sample",
        agentId: "agent_gift",
        status: "ready",
        sourceType: "chat_import",
        importId: "import_b",
        wechatAccountId: "wechat_a",
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
      {
        id: "other_account_import_a_sample",
        agentId: "agent_gift",
        status: "ready",
        sourceType: "chat_import",
        importId: "import_a",
        wechatAccountId: "wechat_b",
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
    ]);

    assert.deepEqual(
      service.listSamples({ wechatAccountId: "wechat_a", importId: "import_a" }).map((sample) => sample.id),
      ["import_a_sample"],
    );
    assert.deepEqual(calls.at(-1), {
      method: "listTrainingSamples",
      agentId: undefined,
      wechatAccountId: "wechat_a",
      conversationId: undefined,
      customerId: undefined,
    });
  });

  test("passes identity filters when compiling skill suggestions", () => {
    const { service, calls } = createTrainingService([
      {
        id: "account_a_skill_sample",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_a",
        conversationId: "conv_a",
        customerId: "customer_a",
        scene: "礼盒设计",
        customerText: "我要看礼盒效果图",
        idealReply: "我先按您的预算整理礼盒方案。",
        score: 92,
        skillHints: ["预算识别"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
      {
        id: "account_b_skill_sample",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_b",
        conversationId: "conv_b",
        customerId: "customer_b",
        scene: "售后",
        customerText: "我要退货",
        idealReply: "我帮您核对订单。",
        score: 92,
        skillHints: ["售后识别"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
    ]);

    const suggestions = service.listSkillSuggestions({
      agentId: "agent_gift",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
    });
    assert.equal(suggestions[0].scope.label, "当前会话私有");
    assert.equal(suggestions[0].scope.wechatAccountId, "wechat_a");
    assert.equal(suggestions[0].scope.conversationId, "conv_a");
    assert.equal(suggestions[0].scope.customerId, "customer_a");

    assert.deepEqual(calls.find((call) => call.method === "listTrainingSamples"), {
      method: "listTrainingSamples",
      agentId: "agent_gift",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
    });
    assert.deepEqual(calls.find((call) => call.method === "listAgentSkills"), {
      method: "listAgentSkills",
      agentId: "agent_gift",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
    });
  });

  test("keeps same-name private skill suggestions selectable per identity", () => {
    const { service } = createTrainingService([
      {
        id: "account_a_budget",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_a",
        conversationId: "conv_a",
        customerId: "customer_a",
        scene: "礼盒设计",
        customerText: "每盒 200，想看礼盒效果图",
        idealReply: "我先按您的预算整理礼盒方案。",
        score: 92,
        skillHints: ["预算澄清"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
      {
        id: "account_b_budget",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_b",
        conversationId: "conv_b",
        customerId: "customer_b",
        scene: "礼盒设计",
        customerText: "总预算 1 万，100 份",
        idealReply: "我先折算单份预算，再确认搭配。",
        score: 92,
        skillHints: ["预算澄清"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
    ]);

    const suggestions = service.listSkillSuggestions({ agentId: "agent_gift" });

    assert.equal(suggestions.length, 2);
    assert.deepEqual(
      suggestions.map((suggestion) => suggestion.scope.customerId).sort(),
      ["customer_a", "customer_b"],
    );
    assert.equal(new Set(suggestions.map((suggestion) => suggestion.suggestionKey)).size, 2);
    assert.equal(suggestions.some((suggestion) => suggestion.scope.label === "混合来源"), false);
  });

  test("does not apply mixed identity skill suggestions even when review is included", () => {
    const { service, calls } = createTrainingService([
      {
        id: "conflict_budget",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_top",
        conversationId: "conv_top",
        customerId: "customer_top",
        identityBinding: {
          status: "passed",
          wechatAccountId: "wechat_binding",
          conversationId: "conv_binding",
          customerId: "customer_binding",
        },
        scene: "礼盒设计",
        customerText: "每盒 200，想看礼盒效果图",
        idealReply: "我先按您的预算整理礼盒方案。",
        score: 95,
        skillHints: ["预算澄清"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
    ]);

    const result = service.applySkillSuggestions({
      agentId: "agent_gift",
      includeNeedsReview: true,
      wechatAccountId: "wechat_top",
      conversationId: "conv_top",
      customerId: "customer_top",
    });

    assert.equal(result.applied, 0);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].reason, "identity_scope_blocked");
    assert.equal(result.blocked[0].quality.level, "blocked");
    assert.deepEqual(calls.find((call) => call.method === "applyAgentSkillSuggestions"), {
      method: "applyAgentSkillSuggestions",
      suggestionCount: 0,
    });
  });

  test("reports needs-review and identity-blocked skill suggestions separately", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "apps/api/src/training/training.service.ts"),
      "utf8",
    );
    assert.match(source, /type SkillSuggestionApplyBlockedReason = "identity_scope_blocked" \| "needs_review"/);
    assert.match(source, /type SkillSuggestionApplyBlocked = Record<string, unknown> & \{/);
    assert.match(source, /const blocked: SkillSuggestionApplyBlocked\[\] = \[\]/);
    const { service, calls } = createTrainingService([
      {
        id: "review_budget",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_top",
        conversationId: "conv_top",
        customerId: "customer_top",
        scene: "礼盒设计",
        customerText: "预算还没确定",
        idealReply: "我先帮您确认预算和数量。",
        score: 95,
        skillHints: ["预算澄清"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
      {
        id: "conflict_scene",
        agentId: "agent_gift",
        agentKey: "gift_design",
        status: "ready",
        sourceType: "chat_import",
        wechatAccountId: "wechat_top",
        conversationId: "conv_top",
        customerId: "customer_top",
        identityBinding: {
          status: "passed",
          wechatAccountId: "wechat_binding",
          conversationId: "conv_binding",
          customerId: "customer_binding",
        },
        scene: "礼盒设计",
        customerText: "客户身份混在一起",
        idealReply: "我先核对客户来源。",
        score: 95,
        skillHints: ["场景确认"],
        quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
      },
    ]);

    const result = service.applySkillSuggestions({
      agentId: "agent_gift",
      includeNeedsReview: false,
      wechatAccountId: "wechat_top",
      conversationId: "conv_top",
      customerId: "customer_top",
    });

    assert.equal(result.selected, 2);
    assert.equal(result.applied, 0);
    assert.equal(result.requiresReview, 2);
    assert.deepEqual(
      result.blocked.map((item) => item.reason).sort(),
      ["identity_scope_blocked", "needs_review"],
    );
    assert.equal(result.blocked.find((item) => item.reason === "identity_scope_blocked").quality.blocked, true);
    assert.deepEqual(calls.find((call) => call.method === "applyAgentSkillSuggestions"), {
      method: "applyAgentSkillSuggestions",
      suggestionCount: 0,
    });
  });

  test("training controller reuses apply skill suggestions payload type", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const controller = fs.readFileSync(path.join(__dirname, "..", "apps/api/src/training/training.controller.ts"), "utf8");
    const service = fs.readFileSync(path.join(__dirname, "..", "apps/api/src/training/training.service.ts"), "utf8");

    assert.match(service, /export type ApplySkillSuggestionsPayload = \{/);
    assert.match(controller, /import \{ ApplySkillSuggestionsPayload, TrainingService \} from "\.\/training\.service"/);
    assert.match(controller, /payload: ApplySkillSuggestionsPayload/);
    assert.doesNotMatch(controller, /suggestionKeys\?: string\[\];[\s\S]*includeNeedsReview\?: boolean;[\s\S]*wechatAccountId\?: string;/);
  });

test("batch reviews visible training samples with de-duplicated ids", () => {
  const notifications = [];
  const scopedSamples = samples.map((sample) => ({
    ...sample,
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  }));
  const { service, calls, rows } = createTrainingService(scopedSamples);
  service["notifications"] = { create: (...args) => notifications.push(args) };

  const result = service.batchReviewSamples({
    sampleIds: ["safe_1", "safe_1", "risk_1"],
    status: "review",
    reviewer: "operator",
    expectedBySampleId: {
      safe_1: {
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      },
      risk_1: {
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      },
    },
    note: "批量退回复核",
  });

  assert.equal(result.updated, 2);
  assert.deepEqual(result.sampleIds, ["safe_1", "risk_1"]);
  assert.equal(rows.find((sample) => sample.id === "safe_1").status, "review");
  assert.equal(rows.find((sample) => sample.id === "risk_1").reviewNote, "批量退回复核");
  assert.deepEqual(
    calls.filter((call) => call.method === "reviewTrainingSample").map((call) => call.sampleId),
    ["safe_1", "risk_1"],
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][3].count, 2);
});

test("rejects empty or oversized training sample batch reviews", () => {
  const { service } = createTrainingService(samples);
  const tooManyIds = Array.from({ length: 101 }, (_, index) => `sample_${index}`);

  assert.throws(
    () => service.batchReviewSamples({ sampleIds: [], status: "review" }),
    /sampleIds must include at least one training sample id/,
  );
  assert.throws(
    () => service.batchReviewSamples({ sampleIds: tooManyIds, status: "rejected" }),
    /sampleIds cannot exceed 100 per batch/,
  );
});

test("filters legacy training samples by inferred source type", () => {
  const { service } = createTrainingService([
    {
      id: "legacy_chat_import",
      agentId: "agent_gift",
      status: "ready",
      importId: "import_1",
      quality: { level: "safe", trainable: true, flags: [] },
    },
    {
      id: "legacy_route_correction",
      agentId: "agent_after_sales",
      status: "ready",
      sourceRouteId: "route_1",
      quality: { level: "safe", trainable: true, flags: [] },
    },
  ]);

  assert.deepEqual(service.listSamples({ sourceType: "chat_import" }).map((sample) => sample.id), ["legacy_chat_import"]);
  assert.deepEqual(service.listSamples({ sourceType: "route_correction" }).map((sample) => sample.id), ["legacy_route_correction"]);
});

test("rejects unknown training sample quality filters", () => {
  const { service } = createTrainingService(samples);

  assert.throws(
    () => service.listSamples({ quality: "maybe" }),
    /quality must be one of safe, review, risk, blocked, needs_attention, scene_uncertain, anti_wrong_reply, trainable, not_trainable, route_memory, reply_skill, route_and_reply, all/,
  );
});

// Migrated from the former C-drive worktree (4 unique regression tests).

test("chat import requires complete conversation identity before training data is created", () => {
  const { service, calls } = createTrainingService(samples);

  assert.throws(
    () =>
      service.importChat({
        text: "客户：有现货吗\n客服：有的，我帮您确认库存",
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
      }),
    /chat import identity expectation required: customerId/,
  );
  assert.equal(calls.filter((call) => call.method === "createChatImport").length, 0);

  const result = service.importChat({
    text: "客户：有现货吗\n客服：有的，我帮您确认库存",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });

  assert.equal(result.id, "import_test");
  assert.equal(calls.filter((call) => call.method === "createChatImport").length, 1);
});

test("rejects applying skill suggestions without a complete active conversation identity", () => {
  const { service, calls } = createTrainingService([
    {
      id: "conv_a_budget",
      agentId: "agent_gift",
      agentKey: "gift_design",
      status: "ready",
      sourceType: "chat_import",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
      scene: "gift_design",
      customerText: "200 per box, want renderings",
      idealReply: "I will confirm the bundle by budget.",
      score: 95,
      skillHints: ["budget_clarify"],
      quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
    },
    {
      id: "conv_b_after_sales",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      status: "ready",
      sourceType: "chat_import",
      wechatAccountId: "wechat_b",
      conversationId: "conv_b",
      customerId: "customer_b",
      scene: "after_sales",
      customerText: "I want to return the order",
      idealReply: "I will check the order and after-sales rules.",
      score: 95,
      skillHints: ["after_sales_plan"],
      quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
    },
  ]);

  assert.throws(
    () => service.applySkillSuggestions({ includeNeedsReview: true, minScore: 70 }),
    /skill suggestion apply identity expectation required: wechatAccountId, conversationId, customerId/,
  );
  assert.equal(calls.filter((call) => call.method === "applyAgentSkillSuggestions").length, 0);
});

test("applies skill suggestions only inside the active conversation identity", () => {
  const { service, calls } = createTrainingService([
    {
      id: "conv_a_budget",
      agentId: "agent_gift",
      agentKey: "gift_design",
      status: "ready",
      sourceType: "chat_import",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
      scene: "gift_design",
      customerText: "200 per box, want renderings",
      idealReply: "I will confirm the bundle by budget.",
      score: 95,
      skillHints: ["budget_clarify"],
      quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
    },
    {
      id: "conv_b_after_sales",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      status: "ready",
      sourceType: "chat_import",
      wechatAccountId: "wechat_b",
      conversationId: "conv_b",
      customerId: "customer_b",
      scene: "after_sales",
      customerText: "I want to return the order",
      idealReply: "I will check the order and after-sales rules.",
      score: 95,
      skillHints: ["after_sales_plan"],
      quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
    },
  ]);

  service.applySkillSuggestions({
    includeNeedsReview: true,
    minScore: 70,
    wechatAccountId: "wechat_a",
    conversationId: "conv_a",
    customerId: "customer_a",
  });

  assert.deepEqual(calls.find((call) => call.method === "listTrainingSamples"), {
    method: "listTrainingSamples",
    agentId: undefined,
    wechatAccountId: "wechat_a",
    conversationId: "conv_a",
    customerId: "customer_a",
  });
  assert.equal(calls.filter((call) => call.method === "applyAgentSkillSuggestions").length, 1);
});

test("rejects mixed conversation identities in one training sample batch review", () => {
  const notifications = [];
  const { service, calls, rows } = createTrainingService([
    {
      id: "conv_a_sample",
      agentId: "agent_gift",
      status: "ready",
      sourceType: "chat_import",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
      quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
    },
    {
      id: "conv_b_sample",
      agentId: "agent_gift",
      status: "ready",
      sourceType: "chat_import",
      wechatAccountId: "wechat_a",
      conversationId: "conv_b",
      customerId: "customer_b",
      quality: { level: "safe", trainable: true, flags: [], usage: { routeMemory: true, replySkill: true } },
    },
  ]);
  service["notifications"] = { create: (...args) => notifications.push(args) };

  assert.throws(
    () =>
      service.batchReviewSamples({
        sampleIds: ["conv_a_sample", "conv_b_sample"],
        status: "review",
        expectedBySampleId: {
          conv_a_sample: {
            expectedWechatAccountId: "wechat_a",
            expectedConversationId: "conv_a",
            expectedCustomerId: "customer_a",
          },
          conv_b_sample: {
            expectedWechatAccountId: "wechat_a",
            expectedConversationId: "conv_b",
            expectedCustomerId: "customer_b",
          },
        },
      }),
    /training sample batch review cannot mix conversation identities/,
  );

  assert.equal(rows.find((sample) => sample.id === "conv_a_sample").status, "ready");
  assert.equal(rows.find((sample) => sample.id === "conv_b_sample").status, "ready");
  assert.equal(calls.filter((call) => call.method === "reviewTrainingSample").length, 0);
  assert.equal(notifications.length, 0);
});
