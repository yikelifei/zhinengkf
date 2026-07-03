"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAgentReplyDraft, knowledgeIdentityMatches, matchKnowledge } = require("../packages/rules");

test("knowledge identity allows global entries and matching scoped entries", () => {
  assert.equal(knowledgeIdentityMatches({}, { wechatAccountId: "wechat_1", conversationId: "conversation_1" }), true);
  assert.equal(
    knowledgeIdentityMatches(
      { wechatAccountId: "wechat_1", conversationId: "conversation_1", customerId: "customer_1" },
      { wechatAccountId: "wechat_1", conversationId: "conversation_1", customerId: "customer_1" },
    ),
    true,
  );
});

test("knowledge identity rejects entries from another account conversation or customer", () => {
  assert.equal(knowledgeIdentityMatches({ wechatAccountId: "wechat_2" }, { wechatAccountId: "wechat_1" }), false);
  assert.equal(knowledgeIdentityMatches({ conversationId: "conversation_2" }, { conversationId: "conversation_1" }), false);
  assert.equal(knowledgeIdentityMatches({ customerId: "customer_2" }, { customerId: "customer_1" }), false);
});

test("reply draft does not match private knowledge from another conversation", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "logistics stuck",
      agentKey: "logistics_exception",
      action: "auto_agent",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_logistics_exception",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      skills: [],
      knowledgeEntries: [
        {
          id: "knowledge_other",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: other customer private handling.",
          tags: ["logistics"],
          qualityScore: 100,
          wechatAccountId: "wechat_2",
          conversationId: "conversation_2",
          customerId: "customer_2",
        },
        {
          id: "knowledge_current",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: check current tracking status first.",
          tags: ["logistics"],
          qualityScore: 70,
          wechatAccountId: "wechat_1",
          conversationId: "conversation_1",
          customerId: "customer_1",
        },
      ],
    },
  );

  assert.deepEqual(
    draft.knowledgeMatches.map((item) => item.id),
    ["knowledge_current"],
  );
});

test("direct knowledge matching applies identity guard before scoring", () => {
  const matches = matchKnowledge(
    "logistics stuck",
    [
      {
        id: "other",
        agentId: "agent_logistics_exception",
        title: "logistics stuck",
        content: "private answer",
        qualityScore: 100,
        conversationId: "conversation_2",
      },
      {
        id: "current",
        agentId: "agent_logistics_exception",
        title: "logistics stuck",
        content: "current answer",
        qualityScore: 50,
        conversationId: "conversation_1",
      },
    ],
    { agentId: "agent_logistics_exception", conversationId: "conversation_1" },
  );

  assert.deepEqual(
    matches.map((item) => item.id),
    ["current"],
  );
}
);
