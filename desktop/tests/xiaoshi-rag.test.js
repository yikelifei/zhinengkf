"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const {
  buildAgentReplyDraft,
  evaluateAgentRoute,
  parseKnowledgeImportText,
  retrieveKnowledgeRag,
  xiaoshiSkillsForRoute,
} = require("../packages/rules");
const { TrainingService } = require("../apps/api/src/training/training.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

const approved = {
  id: "knowledge_xiaoshi_price",
  agentId: "agent_pre_sales",
  sourceType: "chat_import",
  title: "售前转化：客户认为价格高并表示再看看",
  content: "客户：好贵[捂脸]\n行，我再看看吧\n客服：咱这边预算多少，礼品可以调整",
  tags: ["售前转化", "预算异议", "pre_sales"],
  qualityScore: 70,
  status: "ready",
  reviewNote: "已核对为小石第二批脱敏原话；可用于真人语气学习。",
};

test("hybrid RAG retrieves a reviewed Xiaoshi near-match with explainable evidence", () => {
  const result = retrieveKnowledgeRag("好贵，我再看看吧", [approved], { max: 3 });

  assert.equal(result.trace.strategy, "hybrid_bm25_chargram_state_rerank_v3_context");
  assert.equal(result.trace.decision, "use_reviewed_verbatim");
  assert.equal(result.trace.confidence === "high" || result.trace.confidence === "medium", true);
  assert.equal(result.matches[0].allowVerbatim, true);
  assert.equal(result.matches[0].excerpt, "咱这边预算多少，礼品可以调整");
  assert.ok(result.matches[0].retrievalReasons.some((reason) => reason.includes("小石脱敏原话")));
  assert.ok(result.matches[0].matchedSignals.includes("intent:price_objection"));
});

test("reviewed Xiaoshi verbatim is rejected when it repeats facts the customer already supplied", () => {
  const redundantQuestion = {
    ...approved,
    id: "knowledge_xiaoshi_redundant_budget",
    title: "批量采购预算追问",
    content: "客户：我要500份，预算每份25元\n客服：咱们是什么类型的公司，预算多少呢",
  };
  const result = retrieveKnowledgeRag("我要500份，预算每份25元", [redundantQuestion]);

  assert.deepEqual(result.trace.knownFacts.sort(), ["budget", "quantity"]);
  assert.equal(result.trace.excludedByContextConflict, 1);
  assert.deepEqual(result.trace.contextConflictFields, ["budget"]);
  assert.equal(result.trace.decision, "fallback");
  assert.equal(result.matches.length, 0);

  const route = {
    text: "我要500份，预算每份25元",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 500, perUnitAmount: 25 },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, {
    agentId: "agent_pre_sales",
    skills: [],
    knowledgeEntries: [redundantQuestion],
  });
  assert.doesNotMatch(draft.suggestedReply, /预算多少|多少预算|预期价格/);
  assert.equal(draft.suggestedReply, "500份、单份25元左右收到。咱这个主要是什么场景用呀？");
  assert.equal(draft.rag.excludedByContextConflict, 1);
});

test("hybrid RAG excludes review knowledge and unrelated high-quality entries", () => {
  const review = { ...approved, id: "knowledge_review", status: "review" };
  const unrelated = {
    id: "knowledge_unrelated",
    agentId: "agent_pre_sales",
    sourceType: "manual_knowledge_import",
    title: "冬季物流签收",
    content: "核对快递单号和签收时间。",
    tags: ["物流"],
    qualityScore: 100,
    status: "ready",
  };
  const result = retrieveKnowledgeRag("开业伴手礼", [review, unrelated]);

  assert.equal(result.trace.excludedByReviewStatus, 1);
  assert.equal(result.matches.length, 0);
  assert.equal(result.trace.decision, "fallback");
});

test("contextual RAG uses the confirmed usage scene to rank a terse preference answer", () => {
  const teacher = {
    id: "knowledge_teacher_practical",
    agentId: "agent_pre_sales",
    sourceType: "manual_knowledge_import",
    title: "教师节实用礼赠沟通",
    content: "客户：想要实用一点\n客服：好呢，我按适合老师的实用款给您筛",
    tags: ["教师节", "老师", "实用"],
    qualityScore: 90,
    status: "ready",
  };
  const employee = {
    ...teacher,
    id: "knowledge_employee_practical",
    title: "员工福利实用礼赠沟通",
    content: "客户：想要实用一点\n客服：好呢，我按员工福利实用款给您筛",
    tags: ["员工福利", "实用"],
  };
  const result = retrieveKnowledgeRag("实用一点", [employee, teacher], {
    contextQuery: "教师节送老师 实用",
    knownFacts: ["usage_scene", "style_preference"],
  });

  assert.equal(result.matches[0].id, "knowledge_teacher_practical");
  assert.equal(result.trace.contextQuery, "教师节送老师 实用");
  assert.ok(result.matches[0].retrievalReasons.includes("已确认会话上下文相关"));
});

test("context-only RAG evidence cannot be replayed as Xiaoshi verbatim", () => {
  const contextOnly = {
    ...approved,
    id: "knowledge_context_only_teacher",
    title: "教师节送老师",
    content: "客户：教师节送老师\n客服：您要多少份呀",
    tags: ["教师节", "老师"],
  };
  const result = retrieveKnowledgeRag("嗯呢", [contextOnly], {
    contextQuery: "教师节送老师",
    knownFacts: ["usage_scene"],
    minScore: 20,
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].allowVerbatim, false);
  assert.equal(result.trace.decision, "fallback");
});

test("contextual RAG excludes replies that ask for known usage and style again", () => {
  const conflicting = {
    id: "knowledge_context_conflict",
    agentId: "agent_pre_sales",
    sourceType: "manual_knowledge_import",
    title: "教师节风格确认",
    content: "客户：教师节礼物\n客服：主要送给谁呀？咱偏实用还是氛围感一点？",
    tags: ["教师节", "风格"],
    qualityScore: 90,
    status: "ready",
  };
  const result = retrieveKnowledgeRag("实用一点", [conflicting], {
    contextQuery: "教师节送老师 实用",
    knownFacts: ["usage_scene", "style_preference"],
  });

  assert.equal(result.matches.length, 0);
  assert.equal(result.trace.excludedByContextConflict, 1);
  assert.deepEqual(result.trace.contextConflictFields.sort(), ["style_preference", "usage_scene"]);
});

test("Xiaoshi answers a price question before asking only the current key field", () => {
  const route = {
    text: "这款怎么卖",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: {},
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(draft.suggestedReply, "具体价格要按款式、数量和定制内容核，数量不同单价也会变。我先不报虚价，您大概需要多少份呀？");
  assert.deepEqual(draft.replyDraft.directAnswer, { applied: true, intent: "price_explanation" });
  assert.equal(draft.replyDraft.style, "xiaoshi_concise_sales");
  assert.equal(draft.rag.decision, "fallback");
  assert.ok(draft.appliedSkills.some((skill) => skill.name === "小石式单点追问"));
  assert.ok(draft.appliedSkills.some((skill) => skill.name === "小石式价格异议承接"));
  assert.equal(xiaoshiSkillsForRoute(route).length, 2);
});

test("answer-first policy outranks an old human sample that only repeats a field question", () => {
  const route = {
    text: "这款怎么卖",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: {},
    missingFields: [],
    riskFlags: [],
  };
  const oldQuestionOnlySample = {
    id: "knowledge_old_price_question_only",
    agentId: "agent_pre_sales",
    sourceType: "chat_import",
    title: "售前转化：这款怎么卖",
    content: "客户：这款怎么卖\n客服：您要多少份呀",
    tags: ["售前转化", "pre_sales", "价格询问"],
    qualityScore: 90,
    status: "ready",
    reviewNote: "已核对为小石脱敏原话；可用于真人语气学习。",
  };
  const draft = buildAgentReplyDraft(route, {
    agentId: "agent_pre_sales",
    skills: [],
    knowledgeEntries: [oldQuestionOnlySample],
  });

  assert.equal(draft.rag.decision, "use_reviewed_verbatim");
  assert.equal(draft.replyDraft.directAnswer.intent, "price_explanation");
  assert.equal(draft.replyDraft.preserveHumanVerbatim, false);
  assert.match(draft.suggestedReply, /具体价格要按款式、数量和定制内容核/);
  assert.notEqual(draft.suggestedReply, "您要多少份呀");
});

test("Xiaoshi browsing question selects single-question skill without leaking price-objection skill", () => {
  const route = {
    text: "都有哪些款式啊",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: {},
    missingFields: [],
    riskFlags: [],
  };
  const skills = [
    { id: "stored-single", name: "小石式单点追问", enabled: true },
    { id: "stored-price", name: "小石式价格异议承接", enabled: true },
    { id: "stored-change", name: "小石式搭配变更确认", enabled: true },
  ];

  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills, knowledgeEntries: [] });

  assert.deepEqual(draft.appliedSkills.map((skill) => skill.name), ["小石式单点追问"]);
  assert.equal(draft.suggestedReply, "有简约实用、商务礼赠和节日氛围这几类，我先按数量帮您筛。您大概需要多少份呀？");
  assert.equal(draft.replyDraft.directAnswer.intent, "style_options");
  const singleQuestion = draft.appliedSkills.find((skill) => skill.name === "小石式单点追问");
  assert.equal(singleQuestion.version, 4);
  assert.match(singleQuestion.description, /结合最近对话判断客户|同一字段最多问一次/);
});

test("Xiaoshi acknowledges the customer's terse quantity before asking budget", () => {
  const route = {
    text: "10份呀",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 10 },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(draft.suggestedReply, "好呢，10份我记下了，咱单份预算大概多少呢？");
});

test("Xiaoshi asks for usage only after quantity and budget are known", () => {
  const route = {
    text: "单份20元左右",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: null, stylePreference: null, currentField: "budget" },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(draft.suggestedReply, "12份、单份20元左右收到。咱这个主要是什么场景用呀？");
  assert.equal(draft.replyDraft.salesContext.currentField, "budget");
});

test("Xiaoshi acknowledges usage without asking for quantity or budget again", () => {
  const route = {
    text: "教师节送老师",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: null, currentField: "usage_scene" },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(draft.suggestedReply, "教师节送老师，12份、单份20元左右收到。咱偏实用还是氛围感一点？");
  assert.doesNotMatch(draft.suggestedReply, /要多少份|预算大概多少/);
});

test("Xiaoshi accepts a terse style answer and moves forward", () => {
  const route = {
    text: "实用一点",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: "实用", currentField: "style_preference" },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(draft.suggestedReply, "教师节送老师，12份、单份20元左右收到，我先按实用一点给您挑几款哈");
  assert.doesNotMatch(draft.suggestedReply, /实用还是氛围感/);
});

test("Xiaoshi keeps a terse request for alternatives in the current preference", () => {
  const route = {
    text: "还有别的吗",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: "简约", currentFields: [], currentField: null },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(draft.suggestedReply, "可以，我按简约这个方向再给您换几款哈");
});

test("Xiaoshi does not present incomplete accessory-only catalog matches as a gift set", () => {
  const route = {
    text: "实用一点",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: "实用", currentField: "style_preference" },
    missingFields: [],
    riskFlags: [],
  };
  const draft = buildAgentReplyDraft(route, {
    agentId: "agent_pre_sales",
    skills: [],
    knowledgeEntries: [],
    bundleRecommendation: {
      status: "needs_review",
      items: [
        { skuCode: "CARD-A", name: "定制贺卡A", type: "accessory", salePrice: 8, stock: 500 },
        { skuCode: "CARD-C", name: "祝福卡C", type: "accessory", salePrice: 8, stock: 800 },
      ],
      totals: { salePrice: 16 },
      fulfillment: { requestedQuantity: 12, capacity: 500, enough: true },
      warnings: ["没有找到可用礼盒 SKU。"],
    },
  });

  assert.match(draft.suggestedReply, /不拿零散配件凑/);
  assert.doesNotMatch(draft.suggestedReply, /定制贺卡A|祝福卡C/);

  const repeated = buildAgentReplyDraft(route, {
    agentId: "agent_pre_sales",
    skills: [],
    knowledgeEntries: [],
    bundleRecommendation: {
      status: "needs_review",
      items: [
        { skuCode: "CARD-A", name: "定制贺卡A", type: "accessory", salePrice: 8, stock: 500 },
        { skuCode: "CARD-C", name: "祝福卡C", type: "accessory", salePrice: 8, stock: 800 },
      ],
      totals: { salePrice: 16 },
      fulfillment: { requestedQuantity: 12, capacity: 500, enough: true },
      warnings: ["没有找到可用礼盒 SKU。"],
    },
    previousReplies: [draft.suggestedReply],
  });
  assert.match(repeated.suggestedReply, /完整搭配还在补/);
  assert.doesNotMatch(repeated.suggestedReply, /什么场景|送客户、员工|定制贺卡A|祝福卡C/);
});

test("Xiaoshi avoids sending the same reply twice in a row", () => {
  const route = {
    text: "都有哪些款式啊",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: {},
    missingFields: [],
    riskFlags: [],
  };
  const repeated = "款式挺多的，我先按数量给您筛，您大概需要多少份呀？";
  const draft = buildAgentReplyDraft(route, {
    agentId: "agent_pre_sales",
    skills: [],
    knowledgeEntries: [],
    previousReplies: [repeated],
  });

  assert.notEqual(draft.suggestedReply, repeated);
  assert.equal(draft.replyDraft.repetitionGuard.applied, true);
  assert.equal(draft.replyDraft.repetitionGuard.reason, "repeated_question_suppressed");
  assert.doesNotMatch(draft.suggestedReply, /多少份|要多少/);
  assert.match(draft.suggestedReply, /先给您看几款合适的/);
});

test("Xiaoshi repetition guard never asks for a usage scene that is already known", () => {
  const route = {
    text: "教师节送老师",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: { quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: null, currentField: "usage_scene" },
    missingFields: [],
    riskFlags: [],
  };
  const repeated = "教师节送老师，12份、单份20元左右收到。咱偏实用还是氛围感一点？";
  const draft = buildAgentReplyDraft(route, {
    agentId: "agent_pre_sales",
    skills: [],
    knowledgeEntries: [],
    previousReplies: [repeated],
  });

  assert.equal(draft.replyDraft.repetitionGuard.applied, true);
  assert.equal(draft.replyDraft.repetitionGuard.reason, "repeated_question_suppressed");
  assert.match(draft.suggestedReply, /几种不同方向|偏好确定后/);
  assert.doesNotMatch(draft.suggestedReply, /送客户、员工|什么场景|什么用途/);
});

test("Xiaoshi gives safe direct answers for stock and delivery questions without generic interrogation", () => {
  const stock = buildAgentReplyDraft({
    text: "这个有现货吗",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: {},
    missingFields: [],
    riskFlags: [],
  }, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });
  const delivery = buildAgentReplyDraft({
    text: "多久能发货",
    agentKey: "pre_sales",
    action: "auto_agent",
    budget: {},
    missingFields: [],
    riskFlags: [],
  }, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });

  assert.equal(stock.replyDraft.directAnswer.intent, "inventory");
  assert.match(stock.suggestedReply, /实时核|不乱报/);
  assert.doesNotMatch(stock.suggestedReply, /多少份|预算多少|什么场景/);
  assert.equal(delivery.replyDraft.directAnswer.intent, "lead_time");
  assert.match(delivery.suggestedReply, /款式、数量和是否定制|要货日期/);
  assert.doesNotMatch(delivery.suggestedReply, /预算多少|什么场景/);
});

test("Xiaoshi answers common customer questions even when routing also wants clarification", () => {
  const cases = [
    ["价格怎么算", /具体价格要按款式、数量和定制内容核/, "price_explanation"],
    ["现在有现货吗", /现货要按具体款式和数量实时核/, "inventory"],
    ["多久能发货", /发货时间要看款式、数量和是否定制/, "lead_time"],
    ["可以加Logo吗", /多数款可以加 Logo/, "logo_customization"],
  ];

  for (const [text, replyPattern, intent] of cases) {
    const route = evaluateAgentRoute({ text });
    assert.equal(route.action, "collect_info", text);
    const draft = buildAgentReplyDraft(route, { agentId: "agent_pre_sales", skills: [], knowledgeEntries: [] });
    assert.equal(draft.replyDraft.directAnswer.intent, intent, text);
    assert.match(draft.suggestedReply, replyPattern, text);
    assert.doesNotMatch(draft.suggestedReply, /我先确认一下|为了处理更准确/, text);
  }
});

test("Xiaoshi importable SOP knowledge passes the existing parser", () => {
  const file = path.resolve(__dirname, "../docs/knowledge-base/xiaoshi-knowledge-sop-v1-2026-08-15.json");
  const parsed = parseKnowledgeImportText(fs.readFileSync(file, "utf8"));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.importedCount, 8);
  assert.equal(parsed.skippedCount, 0);
  assert.equal(parsed.rows.every((row) => row.agentKey === "pre_sales"), true);
});

test("training RAG preview returns route, skills, trace and final Xiaoshi reply", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const localStore = {
    listAgents: () => [{ id: "agent_pre_sales", key: "pre_sales", name: "小石售前 Agent" }],
    listKnowledgeEntries: ({ includeReview }) => [approved, { ...approved, id: "review_only", status: "review" }]
      .filter((entry) => includeReview || entry.status === "ready"),
    listAgentSkills: () => [],
  };
  const service = new TrainingService(localStore, { create: () => ({}) });
  const result = await service.previewRag({ query: "好贵，我再看看吧" });

  assert.equal(result.route.agentName, "小石售前 Agent");
  assert.equal(result.rag.decision, "use_reviewed_verbatim");
  assert.equal(result.reply, "咱这边预算多少，礼品可以调整");
  assert.equal(result.styleProfile.preserveHumanVerbatim, true);
  assert.equal(result.knowledgeMatches.length, 1);
});
