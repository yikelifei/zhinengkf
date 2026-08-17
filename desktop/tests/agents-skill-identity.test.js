"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { AgentsService } = require("../apps/api/src/agents/agents.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("agent skill list forwards selected identity filters", (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
  });
  const calls = [];
  const localStore = {
    listAgents: (filter = {}) => {
      calls.push({ method: "listAgents", filter });
      return [];
    },
    listAgentSkills: (agentId, filter = {}) => {
      calls.push({ method: "listAgentSkills", agentId, filter });
      return [
        {
          id: "skill_private_one",
          agentId,
          name: "预算澄清",
          wechatAccountId: filter.wechatAccountId,
          conversationId: filter.conversationId,
          customerId: filter.customerId,
        },
      ];
    },
  };
  const service = new AgentsService(localStore);

  const agents = service.listAgents({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });
  const result = service.listSkills("agent_gift_design", {
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });

  assert.deepEqual(calls, [
    {
      method: "listAgents",
      filter: {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      },
    },
    {
      method: "listAgentSkills",
      agentId: "agent_gift_design",
      filter: {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      },
    },
  ]);
  assert.deepEqual(agents, []);
  assert.equal(result[0].wechatAccountId, "wechat_demo_1");
  assert.equal(result[0].conversationId, "conversation_demo_1");
  assert.equal(result[0].customerId, "customer_demo_1");
});

test("agent skill controller declares identity query filters", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const controller = fs.readFileSync(path.join(__dirname, "../apps/api/src/agents/agents.controller.ts"), "utf8");

  assert.match(controller, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(controller, /@Query\("conversationId"\) conversationId\?: string/);
  assert.match(controller, /@Query\("customerId"\) customerId\?: string/);
  assert.match(controller, /this\.agents\.listAgents\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(controller, /this\.agents\.listSkills\(id, \{ wechatAccountId, conversationId, customerId \}\)/);
});
