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

    service.listSkillSuggestions({
      agentId: "agent_gift",
      wechatAccountId: "wechat_a",
      conversationId: "conv_a",
      customerId: "customer_a",
    });

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

  test("batch reviews visible training samples with de-duplicated ids", () => {
  const notifications = [];
  const { service, calls, rows } = createTrainingService(samples);
  service["notifications"] = { create: (...args) => notifications.push(args) };

  const result = service.batchReviewSamples({
    sampleIds: ["safe_1", "safe_1", "risk_1"],
    status: "review",
    reviewer: "operator",
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
