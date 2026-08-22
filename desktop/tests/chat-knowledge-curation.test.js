"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { curateStoreData, curatedKnowledge } = require("../tools/curate-chat-knowledge");

test("curates chat imports into ready knowledge and removes size lane", () => {
  const input = {
    agents: [
      { id: "agent_pre_sales", key: "pre_sales" },
      { id: "agent_general", key: "general" },
      { id: "agent_size_recommendation", key: "size_recommendation" },
    ],
    agentSkills: [
      { id: "skill_size", agentId: "agent_size_recommendation", name: "参数追问" },
      { id: "skill_general", agentId: "agent_general", name: "防乱回复" },
    ],
    trainingSamples: [
      { id: "sample_size", agentId: "agent_size_recommendation", agentKey: "size_recommendation", scene: "尺码推荐", status: "ready" },
    ],
    knowledgeEntries: [
      { id: "raw_chat_ready", agentId: "agent_pre_sales", sourceType: "chat_import", title: "售前：多少钱", content: "客户：多少钱\n客服：需要多少套", status: "ready", qualityScore: 85 },
      { id: "raw_chat_rejected", agentId: "agent_pre_sales", sourceType: "chat_import", title: "售前：旧单号", content: "客户：单号\n客服：DPK", status: "rejected", qualityScore: 50 },
    ],
    reviewLogs: [],
  };

  const { data, summary } = curateStoreData(input, "2026-08-19T12:00:00.000Z");

  assert.equal(data.agents.some((agent) => agent.key === "size_recommendation"), false);
  assert.equal(data.agentSkills.some((skill) => skill.agentId === "agent_size_recommendation"), false);
  assert.equal(data.trainingSamples[0].agentKey, "general");
  assert.equal(data.trainingSamples[0].status, "review");

  const raw = data.knowledgeEntries.find((entry) => entry.id === "raw_chat_ready");
  assert.equal(raw.status, "review");
  assert.match(raw.reviewNote, /curated knowledge/);

  const curated = data.knowledgeEntries.filter((entry) => entry.sourceType === "chat_curated_knowledge");
  assert.equal(curated.length, curatedKnowledge.length);
  assert.equal(curated.every((entry) => entry.status === "ready"), true);
  assert.equal(curated.some((entry) => entry.content.includes("不要凭聊天历史直接报固定价格")), true);

  assert.equal(summary.removedSizeAgents, 1);
  assert.equal(summary.removedSizeSkills, 1);
  assert.equal(summary.demotedRawChatKnowledge, 1);
  assert.equal(summary.insertedCuratedKnowledge, curatedKnowledge.length);
});
