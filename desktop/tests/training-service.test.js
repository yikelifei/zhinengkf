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
    listTrainingSamples: (agentId) => {
      calls.push({ method: "listTrainingSamples", agentId });
      return agentId ? rows.filter((sample) => sample.agentId === agentId) : rows;
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
    /quality must be one of safe, review, risk, blocked, needs_attention, anti_wrong_reply, trainable, not_trainable, route_memory, reply_skill, route_and_reply, all/,
  );
});
