"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { RoutingService } = require("../apps/api/src/routing/routing.service");

function createRoutingService() {
  const calls = [];
  const localStore = {
    listRouteEvaluations: (filter = {}) => {
      calls.push({ method: "listRouteEvaluations", filter });
      return [];
    },
    listTrainingSamples: (filter = {}) => {
      calls.push({ method: "listTrainingSamples", filter });
      return [];
    },
    getAgentByKey: (key) => {
      calls.push({ method: "getAgentByKey", key });
      return { id: "agent_general", key: "general", name: "通用客服" };
    },
    listAgentSkills: (agentId, filter = {}) => {
      calls.push({ method: "listAgentSkills", agentId, filter });
      return [];
    },
    listKnowledgeEntries: (filter = {}) => {
      calls.push({ method: "listKnowledgeEntries", filter });
      return [];
    },
    createRouteEvaluation: (payload, result) => {
      calls.push({ method: "createRouteEvaluation", payload, result });
      return { id: "route_test", ...payload, ...result };
    },
  };
  return {
    calls,
    service: new RoutingService(localStore, { create: () => ({}) }),
  };
}

test("route evaluation requires complete conversation identity before route data is created", () => {
  const { service, calls } = createRoutingService();

  assert.throws(
    () =>
      service.evaluate({
        text: "客户想看礼盒效果图",
        channel: "wechat",
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
      }),
    /route evaluation identity expectation required: customerId/,
  );
  assert.equal(calls.filter((call) => call.method === "createRouteEvaluation").length, 0);

  const result = service.evaluate({
    text: "客户想看礼盒效果图",
    channel: "wechat",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });

  assert.equal(result.id, "route_test");
  assert.equal(calls.filter((call) => call.method === "createRouteEvaluation").length, 1);
});
