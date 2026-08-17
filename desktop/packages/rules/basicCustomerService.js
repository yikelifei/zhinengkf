"use strict";

const BASIC_CUSTOMER_SERVICE_INTENTS = [
  {
    key: "repetition_feedback",
    patterns: [
      /只会.{0,8}(这一句|这句话|重复)/,
      /怎么又是/,
      /一直重复/,
      /不要.{0,10}(重复|一样|同一句|同样)/,
      /每次.{0,10}(重复|一样|同一句|同样)/,
      /回复.{0,10}(机械|生硬|没人味|不像人)/,
      /(回答|客服).{0,10}(机械|生硬|没人味|不像人)/,
      /(对话|回复|消息).{0,8}(太假|很假|像假的)/,
      /答非所问/,
      /(没有|没)回答/,
    ],
    answer:
      "刚才那段确实太像模板了。您接着说，我按前面的内容往下聊，不再让您重复。",
  },
  {
    key: "identity",
    patterns: [/(你|您|机器人|客服).{0,8}(是谁|叫什么|名称)/, /你们是做什么的/, /这是什么客服/],
    answer:
      "我是小石，主要帮您看伴手礼选款、预算搭配、定制和订单进度。您把用途、数量和单份预算发我，我先帮您把范围缩小。",
  },
  {
    key: "capabilities",
    patterns: [
      /(你|您).{0,5}(会|能|可以).{0,8}(做什么|干什么|帮什么|提供什么|解决什么)/,
      /能提供哪些帮助/,
      /有什么功能/,
      /服务范围/,
    ],
    answer:
      "我目前可以处理六类事情：商品和礼盒推荐、按预算搭配、设计效果图需求整理、报价与订单咨询、物流查询、售后问题。您可以直接告诉我用途、单份预算、数量和交期，我会先给出可执行的下一步。",
  },
  {
    key: "model",
    patterns: [/(背后|底层|使用|用的|接入).{0,8}(模型|大模型)/, /什么模型/, /哪个模型/],
    answer:
      "我是臻希智能客服，系统会使用当前配置的 AI 模型辅助理解问题和组织回复。业务答案以商品库、知识库和公司规则为准；遇到资料不足或重要承诺时，我会明确说明并转人工确认。",
  },
  {
    key: "usage",
    patterns: [/怎么用/, /如何使用/, /怎么咨询/, /(应该|要)怎么问/, /从哪里开始/],
    answer:
      "您可以直接描述需求。礼赠方案请告诉我用途、单份预算、数量、交期以及是否需要 Logo；订单、物流或售后问题请提供订单号和具体情况。我会先回答能确定的内容，只追问缺少的关键信息。",
  },
  {
    key: "greeting",
    patterns: [
      /^(你好|您好|在吗|哈[喽罗]|嗨|hello|hi)[!！?？。,.，\s]*$/i,
      /^\[(微笑|愉快|呲牙|嘿哈|抱拳|握手|玫瑰|咖啡|OK|好的)\]$/i,
    ],
    answer: "在的，您说。",
  },
];

function classifyBasicCustomerServiceQuestion(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  for (const intent of BASIC_CUSTOMER_SERVICE_INTENTS) {
    if (intent.patterns.some((pattern) => pattern.test(value))) {
      return { intent: intent.key, answer: intent.answer };
    }
  }
  return null;
}

function buildBasicCustomerServiceScene(result) {
  if (!result) return null;
  const marker = `basic_customer_service:${result.intent}`;
  const top = {
    scene: "通用问答",
    agentKey: "general",
    score: 40,
    matchedKeywords: [marker],
  };
  return {
    ...top,
    hits: 1,
    scores: [top],
    sceneMemory: null,
  };
}

module.exports = {
  BASIC_CUSTOMER_SERVICE_INTENTS,
  buildBasicCustomerServiceScene,
  classifyBasicCustomerServiceQuestion,
};
