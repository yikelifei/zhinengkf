const { buildAgentReplyDraft, evaluateAgentRoute } = require("../../packages/rules");

const API_BASE = process.env.XIAOSHI_EVAL_API_BASE || "http://127.0.0.1:3100/api";

const cases = [
  ["价格能优惠吗", "您什么时候需要呢，咱这边是哪里的"],
  ["这款怎么卖的", "您要多少份呀"],
  ["再便宜点", "多少份"],
  ["好贵，我再看看吧", "咱这边预算多少，礼品可以调整"],
  ["不定了，班费有点拮据", "好呢\n以后有需要再来找我哈"],
  ["要这种袋子，里面的东西可以更换一下吗", "您要多少呀"],
  ["这个做一份多少钱啊，有漫威主题吗，宝宝百日宴", "您要多少呀"],
  ["不想要这款笔记本，太可爱了", "哦哦要简单款哈"],
];

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const [health, readyKnowledge, allKnowledge] = await Promise.all([
    getJson("/health"),
    getJson("/training/knowledge"),
    getJson("/training/knowledge?includeReview=true"),
  ]);
  const batch2 = allKnowledge.filter((entry) => String(entry.reviewNote || "").includes("小石第二批"));
  const evaluations = cases.map(([question, expectedReply]) => {
    const route = evaluateAgentRoute({ text: question });
    const agentId = `agent_${route.agentKey}`;
    const knowledgeEntries = readyKnowledge.filter((entry) => entry.agentId === agentId);
    const draft = buildAgentReplyDraft(route, { agentId, knowledgeEntries, skills: [] });
    const top = draft.knowledgeMatches[0] || null;
    return {
      question,
      agentKey: route.agentKey,
      action: route.action,
      reply: draft.suggestedReply,
      expectedReply,
      exactHumanReply: draft.suggestedReply === expectedReply,
      topKnowledgeScore: top?.score || null,
      humanVerbatim: top?.humanVerbatim === true,
      knowledgeId: top?.id || null,
    };
  });
  const report = {
    verifiedAt: new Date().toISOString(),
    runtime: {
      apiBase: API_BASE,
      healthOk: health.ok === true,
      dataMode: health.dataMode,
      localStorePath: health.localStore?.path || null,
    },
    batch2RuntimeCounts: {
      ready: batch2.filter((entry) => entry.status === "ready").length,
      review: batch2.filter((entry) => entry.status === "review").length,
      total: batch2.length,
    },
    readyBatch2KnowledgeCount: readyKnowledge.filter((entry) =>
      String(entry.reviewNote || "").includes("小石第二批"),
    ).length,
    evaluations,
    allExactHumanReplies: evaluations.every((item) => item.exactHumanReply && item.humanVerbatim),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.runtime.healthOk || !report.allExactHumanReplies) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
