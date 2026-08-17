"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const {
  buildSuggestionMessages,
  validateSuggestion,
} = require("../apps/api/src/ai/ai-provider.service");

function input(overrides = {}) {
  return {
    customerMessage: "那个包装不太好看，能换一个吗？",
    ruleSuggestion: "可以的，我先帮您往下推进。为了方案更准确，还需要您补充预算和数量。",
    agentKey: "gift_design",
    scene: "礼盒包装调整",
    nextAction: "collect_info",
    conversationHistory: [
      { role: "customer", content: "月底要用，做会员礼。" },
      { role: "assistant", content: "收到，我先帮您看看。" },
    ],
    requireNaturalRewrite: true,
    ...overrides,
  };
}

test("natural-reply prompt treats the rule reply as facts instead of a copy template", () => {
  const messages = buildSuggestionMessages(input());
  const prompt = messages.map((message) => message.content).join("\n");
  assert.match(prompt, /不是让你照抄的文案模板/);
  assert.match(prompt, /不要每轮都机械套用/);
  assert.match(prompt, /最近客服已经用过这些开头/);
  assert.match(prompt, /客户表达特点/);
  assert.match(prompt, /只发问候时，只用一句短话自然应声/);
  assert.match(prompt, /不要一次罗列三四个问题让客户像填表/);
  assert.match(prompt, /“｜”表示客服原来分开发送的连续短消息/);
});

test("natural-reply prompt carries the Xiaoshi persona for grounded synthesis", () => {
  const messages = buildSuggestionMessages(input({
    styleProfile: {
      id: "xiaoshi_v1",
      name: "小石真人客服",
      evidence: "32 组已审核脱敏真人回复",
      preserveHumanVerbatim: false,
    },
  }));
  const prompt = messages.map((message) => message.content).join("\n");

  assert.match(prompt, /小石真人客服/);
  assert.match(prompt, /优先只问一个最关键缺口/);
  assert.match(prompt, /咱这边、呀、哈、好呢、哦哦/);
  assert.match(prompt, /不扩写、不润色/);
});

test("natural-reply validation rejects a copied rule template", () => {
  const request = input();
  const result = validateSuggestion(request.ruleSuggestion, request);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "template_copy");
});

test("natural-reply validation rejects an unfinished sentence", () => {
  const result = validateSuggestion("明白您的想法，我可以根据您的预算给您更合适的", input());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "incomplete_sentence");
});

test("natural-reply validation accepts a concise contextual rewrite", () => {
  const result = validateSuggestion("可以换。您更看重包装颜值还是预算？我按您的优先项重新搭配。", input());
  assert.equal(result.ok, true);
  assert.equal(result.text, "可以换。您更看重包装颜值还是预算？我按您的优先项重新搭配。");
});

test("natural-reply validation rejects scripted customer-service filler", () => {
  const result = validateSuggestion(
    "您好，请问有什么可以帮助您的？直接告诉我您的需求吧。",
    input(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "scripted_service_phrase");
});

test("pure greeting stays short and does not dump a service menu", () => {
  const request = input({
    customerMessage: "你好",
    ruleSuggestion: "在的，您说。",
  });
  const menu = validateSuggestion("您好，想看礼盒方案、问价格，还是查订单或物流？", request);
  assert.equal(menu.ok, false);
  assert.match(menu.reason, /^greeting_/);

  const natural = validateSuggestion("我在，您说。", request);
  assert.equal(natural.ok, true);
  assert.equal(natural.text, "我在，您说。");
});

test("natural-reply validation preserves verified required terms", () => {
  const request = input({ requiredTerms: ["事实礼盒", "88"] });
  const result = validateSuggestion("我先按现有商品资料帮您核对。", request);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_required_term:事实礼盒");
});

test("natural-reply validation rejects an invented urgency promise", () => {
  const request = input({
    customerMessage: "订单怎么还没发货？",
    ruleSuggestion: "订单已进入生产，交期仍待核实。",
    requiredTerms: ["生产", "交期"],
  });
  const result = validateSuggestion("订单已进入生产，我正在加紧核实交期，有结果会立刻同步。", request);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invented_commitment");
});

test("manual handoff wording is allowed when the verified route requires human confirmation", () => {
  const request = input({
    ruleSuggestion: "这个问题会交给人工确认后再回复。",
    nextAction: "handoff_to_human",
    requiredTerms: ["人工"],
  });
  const result = validateSuggestion("抱歉，前面的回复太重复了，我现在为您转人工继续处理。", request);
  assert.equal(result.ok, true);
});

test("manual handoff wording is still rejected when the route does not authorize it", () => {
  const result = validateSuggestion("我现在为您转人工继续处理。", input());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invented_manual_handoff");
});
