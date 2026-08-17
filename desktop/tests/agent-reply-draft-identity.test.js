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

test("knowledge identity rejects private entries when current identity is missing", () => {
  assert.equal(knowledgeIdentityMatches({ wechatAccountId: "wechat_1" }, {}), false);
  assert.equal(knowledgeIdentityMatches({ conversationId: "conversation_1" }, {}), false);
  assert.equal(knowledgeIdentityMatches({ customerId: "customer_1" }, {}), false);
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

test("reply draft respects identityBinding on legacy private knowledge", () => {
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
          id: "knowledge_legacy_other",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: other private handling.",
          tags: ["logistics"],
          qualityScore: 100,
          identityBinding: {
            status: "passed",
            wechatAccountId: "wechat_1",
            conversationId: "conversation_2",
            customerId: "customer_2",
          },
        },
        {
          id: "knowledge_legacy_current",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: current private handling.",
          tags: ["logistics"],
          qualityScore: 70,
          identityBinding: {
            status: "passed",
            wechatAccountId: "wechat_1",
            conversationId: "conversation_1",
            customerId: "customer_1",
          },
        },
      ],
    },
  );

  assert.deepEqual(
    draft.knowledgeMatches.map((item) => item.id),
    ["knowledge_legacy_current"],
  );
});

test("reply draft ignores private knowledge when no identity is available", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "logistics stuck",
      agentKey: "logistics_exception",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_logistics_exception",
      skills: [],
      knowledgeEntries: [
        {
          id: "knowledge_private",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: private handling.",
          tags: ["logistics"],
          qualityScore: 100,
          conversationId: "conversation_1",
        },
        {
          id: "knowledge_global",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: global handling.",
          tags: ["logistics"],
          qualityScore: 70,
        },
      ],
    },
  );

  assert.deepEqual(
    draft.knowledgeMatches.map((item) => item.id),
    ["knowledge_global"],
  );
});

test("reply draft rejects knowledge with conflicting identity fields", () => {
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
          id: "knowledge_conflict",
          agentId: "agent_logistics_exception",
          title: "logistics stuck",
          content: "Customer: logistics stuck\nAgent: conflicted private handling.",
          tags: ["logistics"],
          qualityScore: 100,
          conversationId: "conversation_1",
          identityBinding: {
            status: "passed",
            conversationId: "conversation_2",
          },
        },
      ],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 0);
});

test("reply draft does not apply private skills from another conversation", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "快递一直不动怎么办",
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
      skills: [
        {
          id: "skill_other",
          name: "物流安抚",
          enabled: true,
          confidence: 99,
          sampleCount: 9,
          wechatAccountId: "wechat_2",
          conversationId: "conversation_2",
          customerId: "customer_2",
        },
        {
          id: "skill_current",
          name: "物流安抚",
          enabled: true,
          confidence: 60,
          sampleCount: 1,
          wechatAccountId: "wechat_1",
          conversationId: "conversation_1",
          customerId: "customer_1",
        },
      ],
      knowledgeEntries: [],
    },
  );

  assert.deepEqual(
    draft.appliedSkills.map((skill) => skill.id),
    ["skill_current", "skill_builtin_xiaoshi_single_question"],
  );
  assert.equal(draft.appliedSkills[0].scope.label, "当前会话私有");
});

test("reply draft ignores private skills when no conversation identity is available", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "快递一直不动怎么办",
      agentKey: "logistics_exception",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_logistics_exception",
      skills: [
        {
          id: "skill_private",
          name: "物流安抚",
          enabled: true,
          confidence: 99,
          sampleCount: 9,
          conversationId: "conversation_1",
        },
        {
          id: "skill_global",
          name: "物流安抚",
          enabled: true,
          confidence: 50,
          sampleCount: 1,
        },
      ],
      knowledgeEntries: [],
    },
  );

  assert.deepEqual(
    draft.appliedSkills.map((skill) => skill.id),
    ["skill_global", "skill_builtin_xiaoshi_single_question"],
  );
  assert.equal(draft.appliedSkills[0].scope.label, "全局 Skill");
});

test("reply draft rejects skills with conflicting identity fields", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "快递一直不动怎么办",
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
      skills: [
        {
          id: "skill_conflict",
          name: "物流安抚",
          enabled: true,
          confidence: 99,
          sampleCount: 9,
          conversationId: "conversation_1",
          identityBinding: {
            status: "passed",
            conversationId: "conversation_2",
          },
        },
      ],
      knowledgeEntries: [],
    },
  );

  assert.deepEqual(
    draft.appliedSkills.map((skill) => skill.id),
    ["skill_builtin_xiaoshi_single_question"],
  );
});

test("reply draft respects computed scope on legacy private skills", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "快递一直不动怎么办",
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
      skills: [
        {
          id: "skill_legacy_other",
          name: "物流安抚",
          enabled: true,
          confidence: 99,
          sampleCount: 9,
          scope: {
            level: "conversation",
            label: "当前会话私有",
            wechatAccountId: "wechat_1",
            conversationId: "conversation_2",
            customerId: "customer_2",
          },
        },
        {
          id: "skill_legacy_current",
          name: "物流安抚",
          enabled: true,
          confidence: 60,
          sampleCount: 1,
          scope: {
            level: "conversation",
            label: "当前会话私有",
            wechatAccountId: "wechat_1",
            conversationId: "conversation_1",
            customerId: "customer_1",
          },
        },
      ],
      knowledgeEntries: [],
    },
  );

  assert.deepEqual(
    draft.appliedSkills.map((skill) => skill.id),
    ["skill_legacy_current", "skill_builtin_xiaoshi_single_question"],
  );
  assert.equal(draft.appliedSkills[0].scope.label, "当前会话私有");
  assert.equal(draft.appliedSkills[0].scope.conversationId, "conversation_1");
});

test("reply draft blocks ambiguous mixed scope skills", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "快递一直不动怎么办",
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
      skills: [
        {
          id: "skill_mixed",
          name: "物流安抚",
          enabled: true,
          confidence: 99,
          sampleCount: 9,
          scope: {
            level: "mixed",
            label: "混合来源",
          },
        },
      ],
      knowledgeEntries: [],
    },
  );

  assert.deepEqual(
    draft.appliedSkills.map((skill) => skill.id),
    ["skill_builtin_xiaoshi_single_question"],
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
