"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAgentReplyDraft, enforceCatalogDataReplyPolicy } = require("../packages/rules");

test("keeps the direct basic customer service answer instead of the generic fallback", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "你可以做什么？",
      agentKey: "general",
      action: "auto_agent",
      basicIntent: "capabilities",
      basicAnswer: "我可以协助商品推荐、预算搭配、设计、订单、物流和售后。",
      missingFields: [],
      riskFlags: [],
    },
    { skills: [], knowledgeEntries: [] },
  );

  assert.equal(draft.suggestedReply, "我可以协助商品推荐、预算搭配、设计、订单、物流和售后。");
  assert.equal(draft.replyDraft.nextAction, "agent_reply_draft");
});

test("unverified catalog facts auto-send only inside the explicit internal test allowlist", () => {
  const route = {
    action: "reply",
    riskFlags: [],
    routingPolicy: { lane: "low_value_agent", handler: "agent", manualRequired: false, canQueueAutoReply: true, autoSendAllowed: true, safeguards: [] },
  };
  const blocked = enforceCatalogDataReplyPolicy(
    route,
    { source: "catalog_enhanced" },
    { customerReplyReady: false },
    { internalTestAllowed: false },
  );
  const allowed = enforceCatalogDataReplyPolicy(
    route,
    { source: "catalog_enhanced" },
    { customerReplyReady: false },
    { internalTestAllowed: true },
  );

  assert.equal(blocked.routingPolicy.manualRequired, true);
  assert.equal(blocked.routingPolicy.autoSendAllowed, false);
  assert.ok(blocked.riskFlags.includes("unverified_catalog_data"));
  assert.equal(allowed.routingPolicy.manualRequired, false);
  assert.equal(allowed.routingPolicy.autoSendAllowed, true);
});

test("uses agent skills to enhance gift design reply draft", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "端午礼盒每盒 180，做 50 份，想看效果图，logo 已发",
      agentKey: "gift_design",
      action: "auto_agent",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      budget: { perUnitAmount: 180, quantity: 50 },
      missingFields: [],
      riskFlags: [],
      manualRequired: false,
    },
    {
      agentId: "agent_gift_design",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      skills: [
        {
          id: "skill_budget",
          name: "预算澄清",
          enabled: true,
          confidence: 80,
          sampleCount: 3,
          wechatAccountId: "wechat_1",
          conversationId: "conversation_1",
          customerId: "customer_1",
          identityBinding: {
            status: "passed",
            wechatAccountId: "wechat_1",
            conversationId: "conversation_1",
            customerId: "customer_1",
          },
        },
        { id: "skill_design", name: "设计需求确认", enabled: true, confidence: 80, sampleCount: 3 },
      ],
      knowledgeEntries: [],
    },
  );

  assert.equal(draft.replyDraft.source, "skill_enhanced");
  assert.equal(draft.appliedSkills.length, 3);
  assert.deepEqual(draft.appliedSkills[0].scope, {
    level: "conversation",
    label: "当前会话私有",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
    bindingStatus: "passed",
  });
  assert.deepEqual(draft.appliedSkills[1].scope, {
    level: "global",
    label: "全局 Skill",
    bindingStatus: "",
  });
  assert.equal(draft.appliedSkills[2].name, "小石式单点追问");
  assert.match(draft.suggestedReply, /每份 180 元/);
  assert.match(draft.suggestedReply, /不乱换商品/);
});

test("answers card redesign with box size before generic gift design copy", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "再设计一下这个卡片，盒子是 15*15*6的",
      agentKey: "gift_design",
      action: "auto_agent",
      missingFields: [],
      riskFlags: [],
      manualRequired: false,
    },
    { skills: [], knowledgeEntries: [] },
  );

  assert.equal(draft.replyDraft.directAnswer.applied, true);
  assert.equal(draft.replyDraft.directAnswer.intent, "packaging_adjustment");
  assert.match(draft.suggestedReply, /卡片可以重新调整/);
  assert.match(draft.suggestedReply, /盒子尺寸/);
  assert.match(draft.suggestedReply, /不乱改/);
});

test("answers greeting-card ratio and color requirements before generic gift design copy", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "尺寸是盒子的尺寸，图片里面是方形的贺卡，也就是1：1的尺寸，主题颜色是紫色",
      agentKey: "gift_design",
      action: "auto_agent",
      missingFields: [],
      riskFlags: [],
      manualRequired: false,
    },
    { skills: [], knowledgeEntries: [] },
  );

  assert.equal(draft.replyDraft.directAnswer.applied, true);
  assert.equal(draft.replyDraft.directAnswer.intent, "greeting_card_requirements");
  assert.match(draft.suggestedReply, /盒子尺寸只作为包装适配参考/);
  assert.match(draft.suggestedReply, /贺卡按 1:1 正方形处理/);
  assert.match(draft.suggestedReply, /主题色用紫色/);
  assert.doesNotMatch(draft.suggestedReply, /预算|数量|用途/);
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

test("uses an approved sanitized verbatim reply for a strongly matched pre-sales question", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "公司20周年庆典给参会人员做伴手礼，大概200份",
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: { quantity: 200 },
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_pre_sales",
      skills: [],
      knowledgeEntries: [{
        id: "knowledge_xiaoshi_verbatim",
        agentId: "agent_pre_sales",
        sourceType: "chat_import",
        title: "售前转化：公司20周年庆典给参会人员的伴手礼 200份左右",
        content: "客户：公司20周年庆典给参会人员的伴手礼 200份左右\n客服：咱们是什么类型的公司，预算多少呢\n我给咱找找",
        tags: ["售前转化", "pre_sales"],
        qualityScore: 94,
        reviewNote: "已核对为小石脱敏原话；可用于真人语气学习。",
      }],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 1);
  assert.equal(draft.knowledgeMatches[0].humanVerbatim, true);
  assert.equal(draft.suggestedReply, "咱们是什么类型的公司，预算多少呢\n我给咱找找");
});

test("uses a reviewed Xiaoshi verbatim reply when the customer omits an emoji or one bubble", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "好贵，我再看看吧",
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_pre_sales",
      skills: [],
      knowledgeEntries: [{
        id: "knowledge_xiaoshi_batch2_budget",
        agentId: "agent_pre_sales",
        sourceType: "chat_import",
        title: "售前转化：客户认为价格高并表示再看看",
        content: "客户：好贵[捂脸]\n行，我再看看吧\n客服：咱这边预算多少，礼品可以调整",
        tags: ["售前转化", "预算异议", "pre_sales"],
        qualityScore: 70,
        reviewNote: "已核对为小石第二批脱敏原话；可用于真人语气学习。",
      }],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 1);
  assert.equal(draft.knowledgeMatches[0].humanVerbatim, true);
  assert.equal(draft.suggestedReply, "咱这边预算多少，礼品可以调整");
});

test("uses a reviewed Xiaoshi preference reply for a shorter paraphrase", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "不想要这款笔记本，太可爱了",
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_pre_sales",
      skills: [],
      knowledgeEntries: [{
        id: "knowledge_xiaoshi_batch2_style",
        agentId: "agent_pre_sales",
        sourceType: "chat_import",
        title: "售前转化：客户不想要可爱风笔记本",
        content: "客户：不想要这款笔记本\n这个太可爱了，不适合我们\n客服：哦哦要简单款哈",
        tags: ["售前转化", "风格偏好", "pre_sales"],
        qualityScore: 70,
        reviewNote: "已核对为小石第二批脱敏原话；可用于真人语气学习。",
      }],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 1);
  assert.equal(draft.knowledgeMatches[0].humanVerbatim, true);
  assert.equal(draft.suggestedReply, "哦哦要简单款哈");
});

test("answers the price question before using an attachment-bearing Xiaoshi sample", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "这个做一份多少钱啊，有漫威主题吗，宝宝百日宴",
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_pre_sales",
      skills: [],
      knowledgeEntries: [{
        id: "knowledge_xiaoshi_batch2_theme",
        agentId: "agent_pre_sales",
        sourceType: "chat_import",
        title: "售前转化：主题伴手礼询价",
        content: "客户：[附件]\n这个做一份多少钱啊\n你们有漫威主题的伴手礼\n娃百日宴的回礼\n客服：您要多少呀",
        tags: ["售前转化", "pre_sales"],
        qualityScore: 66,
        reviewNote: "已核对为小石第二批脱敏原话；主题伴手礼询价先问数量。",
      }],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 1);
  assert.equal(draft.knowledgeMatches[0].humanVerbatim, true);
  assert.match(draft.suggestedReply, /价格|单价/);
  assert.match(draft.suggestedReply, /多少份/);
  assert.equal(draft.replyDraft.directAnswer.applied, true);
  assert.doesNotMatch(draft.suggestedReply, /附件|引用/);
});

test("does not match unrelated knowledge only because it has a high quality score", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "开业伴手礼",
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    {
      agentId: "agent_pre_sales",
      skills: [],
      knowledgeEntries: [{
        id: "knowledge_unrelated",
        agentId: "agent_pre_sales",
        title: "冬季物流签收",
        content: "核对快递单号和签收时间。",
        tags: ["物流"],
        qualityScore: 100,
      }],
    },
  );

  assert.equal(draft.knowledgeMatches.length, 0);
  assert.equal(draft.suggestedReply, "您要多少份呀");
});

test("answers a matched product with registered public catalog facts", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "红金商务礼盒多少钱？要100套",
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: { quantity: 100, perUnitAmount: null, totalAmount: null },
      missingFields: [],
      riskFlags: [],
    },
    {
      skills: [],
      knowledgeEntries: [],
      catalogSkus: [
        {
          id: "sku_1",
          skuCode: "BOX-REAL-1",
          name: "红金商务礼盒",
          category: "礼盒",
          salePrice: 88,
          stock: 80,
          leadTimeDays: 3,
          costPrice: 50,
          supplier: "secret supplier",
        },
      ],
    },
  );

  assert.equal(draft.replyDraft.source, "catalog_enhanced");
  assert.match(draft.suggestedReply, /红金商务礼盒/);
  assert.match(draft.suggestedReply, /BOX-REAL-1/);
  assert.match(draft.suggestedReply, /88/);
  assert.match(draft.suggestedReply, /还差 20/);
  assert.doesNotMatch(draft.suggestedReply, /secret supplier|成本|毛利/);
});

test("writes a safe catalog bundle into a pre-sales reply", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "100份员工福利礼盒，每份预算150元，有什么推荐？",
      agentKey: "pre_sales",
      action: "auto_agent",
      isHighValue: true,
      budget: { quantity: 100, perUnitAmount: 150, totalAmount: 15000 },
      missingFields: [],
      riskFlags: [],
    },
    {
      skills: [],
      knowledgeEntries: [],
      catalogSkus: [],
      bundleRecommendation: {
        items: [
          { skuCode: "BOX-A", name: "红金礼盒A", salePrice: 40, stock: 150 },
          { skuCode: "TEA-B", name: "茶叶礼品B", salePrice: 45, stock: 220 },
        ],
        totals: { salePrice: 85 },
        fulfillment: { requestedQuantity: 100, capacity: 150, enough: true },
        warnings: [],
      },
    },
  );

  assert.equal(draft.replyDraft.source, "catalog_enhanced");
  assert.match(draft.suggestedReply, /红金礼盒A/);
  assert.match(draft.suggestedReply, /茶叶礼品B/);
  assert.match(draft.suggestedReply, /85/);
  assert.match(draft.suggestedReply, /100/);
  assert.match(draft.suggestedReply, /最终优惠.*正式报价/);
});

test("asks for order and photo evidence for damaged after-sales goods", () => {
  const draft = buildAgentReplyDraft(
    {
      text: "收到的礼盒破损了，怎么处理？",
      agentKey: "after_sales",
      action: "auto_agent",
      budget: {},
      missingFields: [],
      riskFlags: [],
    },
    { skills: [], knowledgeEntries: [] },
  );

  assert.match(draft.suggestedReply, /订单号/);
  assert.match(draft.suggestedReply, /外包装/);
  assert.match(draft.suggestedReply, /照片/);
  assert.match(draft.suggestedReply, /补发/);
  assert.match(draft.suggestedReply, /退款/);
});

test("labels a truncated bundle before showing the complete combination total", () => {
  const items = [
    ["BOX-A", "礼盒", 40],
    ["ITEM-A", "茶点", 29],
    ["CARD-A", "贺卡", 8],
    ["CARD-B", "祝福卡", 8],
    ["CARD-C", "感谢卡", 15],
    ["TEA-B", "茶叶", 45],
  ].map(([skuCode, name, salePrice]) => ({ skuCode, name, salePrice, stock: 200 }));
  const draft = buildAgentReplyDraft(
    {
      text: "100份员工福利礼盒，每份预算150元",
      agentKey: "pre_sales",
      action: "auto_agent",
      isHighValue: true,
      budget: { quantity: 100, perUnitAmount: 150, totalAmount: 15000 },
      missingFields: [],
      riskFlags: [],
    },
    {
      bundleRecommendation: {
        items,
        totals: { salePrice: 145 },
        fulfillment: { requestedQuantity: 100, capacity: 200, enough: true },
      },
    },
  );

  assert.match(draft.suggestedReply, /等 6 件/);
  assert.match(draft.suggestedReply, /完整组合.*145/);
});
