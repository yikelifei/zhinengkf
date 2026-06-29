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
  const localStore = {
    listTrainingSamples: (agentId) => {
      calls.push({ method: "listTrainingSamples", agentId });
      return agentId ? samples.filter((sample) => sample.agentId === agentId) : samples;
    },
  };
  return {
    calls,
    service: new TrainingService(localStore, { create: () => ({}) }),
  };
}

const samples = [
  {
    id: "safe_1",
    agentId: "agent_gift",
    status: "ready",
    sourceType: "chat_import",
    quality: { level: "safe", trainable: true, flags: [] },
  },
  {
    id: "anti_1",
    agentId: "agent_gift",
    status: "ready",
    sourceType: "route_correction",
    quality: { level: "review", trainable: true, flags: ["scene_clarification_reply", "anti_wrong_reply_only"] },
  },
  {
    id: "review_1",
    agentId: "agent_after_sales",
    status: "review",
    sourceType: "chat_import",
    quality: { level: "review", trainable: false, flags: ["manual_review_required"] },
  },
  {
    id: "risk_1",
    agentId: "agent_after_sales",
    status: "ready",
    sourceType: "chat_import",
    quality: { level: "risk", trainable: false, flags: ["low_score"] },
  },
  {
    id: "blocked_1",
    agentId: "agent_after_sales",
    status: "rejected",
    sourceType: "manual",
    quality: { level: "blocked", trainable: false, flags: ["rejected"] },
  },
];

test("filters training samples by quality without mixing anti-wrong-reply into review", () => {
  const { service } = createTrainingService(samples);

  assert.deepEqual(service.listSamples({ quality: "safe" }).map((sample) => sample.id), ["safe_1"]);
  assert.deepEqual(service.listSamples({ quality: "anti_wrong_reply" }).map((sample) => sample.id), ["anti_1"]);
  assert.deepEqual(service.listSamples({ quality: "review" }).map((sample) => sample.id), ["review_1"]);
  assert.deepEqual(service.listSamples({ quality: "risk" }).map((sample) => sample.id), ["risk_1"]);
  assert.deepEqual(service.listSamples({ quality: "blocked" }).map((sample) => sample.id), ["blocked_1"]);
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
    /quality must be one of safe, review, risk, blocked, anti_wrong_reply, trainable, not_trainable, all/,
  );
});
