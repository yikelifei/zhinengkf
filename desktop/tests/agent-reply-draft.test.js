"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAgentReplyDraft } = require("../packages/rules");

test("uses agent skills to enhance gift design reply draft", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "端午礼盒每盒 180，做 50 份，想看效果图，logo 已发",
      agentKey: "gift_design",
      action: "auto_agent",
      budget: { perUnitAmount: 180, quantity: 50 },
      missingFields: [],
      riskFlags: [],
      manualRequired: false,
    },
    {
      agentId: "agent_gift_design",
      skills: [
        { id: "skill_budget", name: "预算澄清", enabled: true, confidence: 80, sampleCount: 3 },
        { id: "skill_design", name: "设计需求确认", enabled: true, confidence: 80, sampleCount: 3 },
      ],
      knowledgeEntries: [],
    },
  );

  assert.equal(draft.replyDraft.source, "skill_enhanced");
  assert.equal(draft.appliedSkills.length, 2);
  assert.match(draft.suggestedReply, /每份 180 元/);
  assert.match(draft.suggestedReply, /不乱换商品/);
});

test("keeps high value route on manual handoff", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "企业礼盒总预算 3 万",
      agentKey: "gift_design",
      action: "manual_review",
      isHighValue: true,
      manualRequired: true,
      budget: { totalAmount: 30000 },
      missingFields: [],
      riskFlags: [],
    },
    {
      skills: [{ id: "skill_design", name: "设计需求确认", enabled: true }],
      knowledgeEntries: [],
    },
  );

  assert.equal(draft.replyDraft.nextAction, "handoff_to_human");
  assert.match(draft.suggestedReply, /专人审核/);
});

test("uses customer friendly scene clarification reply", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "推荐一下",
      agentKey: "pre_sales",
      action: "collect_info",
      missingFields: ["scene_clarification"],
      sceneDecision: { status: "weak" },
      sceneClarification: {
        question: "我先确认一下，您是想让我先处理「售前咨询/商品推荐」这个方向吗？",
      },
      riskFlags: [],
    },
    { skills: [], knowledgeEntries: [] },
  );

  assert.equal(draft.replyDraft.nextAction, "clarify_scene");
  assert.match(draft.suggestedReply, /售前咨询/);
  assert.doesNotMatch(draft.suggestedReply, /scene_clarification/);
});

test("labels scene clarification fallback without leaking internal field name", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "推荐一下",
      agentKey: "pre_sales",
      action: "collect_info",
      missingFields: ["scene_clarification"],
      riskFlags: [],
    },
    { skills: [], knowledgeEntries: [] },
  );

  assert.match(draft.suggestedReply, /要优先处理的问题/);
  assert.doesNotMatch(draft.suggestedReply, /scene_clarification/);
});

test("matches useful knowledge examples for logistics replies", () => {
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
      skills: [{ id: "skill_logistics", name: "物流安抚", enabled: true, confidence: 66, sampleCount: 1 }],
      knowledgeEntries: [
        {
          id: "knowledge_1",
          agentId: "agent_logistics_exception",
          title: "物流异常：快递不动",
          content: "客户：快递一直不动怎么办？\n客服：我帮您核对物流进度，如果停滞会同步催件或安排补发方案。",
          tags: ["物流异常", "物流安抚"],
          qualityScore: 85,
        },
      ],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 1);
  assert.match(draft.suggestedReply, /核对物流进度/);
});
