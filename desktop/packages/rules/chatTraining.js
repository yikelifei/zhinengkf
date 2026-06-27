"use strict";

const DEFAULT_SCENE_RULES = [
  {
    scene: "礼盒设计",
    agentKey: "gift_design",
    keywords: weighted([
      ["礼盒", 12],
      ["伴手礼", 12],
      ["效果图", 12],
      ["摆拍", 10],
      ["logo", 8],
      ["Logo", 8],
      ["定制", 7],
      ["包装设计", 8],
      ["企业礼赠", 8],
      ["员工福利", 7],
      ["节礼", 7],
      ["参考图", 7],
      ["素材", 6],
      ["出图", 9],
    ]),
  },
  {
    scene: "下单支付",
    agentKey: "order_payment",
    keywords: weighted([
      ["下单", 10],
      ["订单", 10],
      ["支付", 10],
      ["付款", 10],
      ["尾款", 8],
      ["定金", 8],
      ["改地址", 8],
      ["发票", 8],
      ["开票", 8],
      ["收货地址", 8],
      ["订单号", 8],
      ["查单", 7],
      ["什么时候付款", 7],
    ]),
  },
  {
    scene: "物流异常",
    agentKey: "logistics_exception",
    keywords: weighted([
      ["物流", 11],
      ["快递", 11],
      ["发货", 9],
      ["到货", 8],
      ["签收", 8],
      ["派送", 8],
      ["单号", 7],
      ["催件", 9],
      ["一直不动", 10],
      ["运输", 6],
      ["丢件", 10],
      ["没收到", 8],
    ]),
  },
  {
    scene: "售后安抚",
    agentKey: "after_sales",
    keywords: weighted([
      ["退款", 11],
      ["退货", 11],
      ["换货", 10],
      ["破损", 10],
      ["补发", 9],
      ["售后", 9],
      ["质量", 8],
      ["坏了", 8],
      ["少件", 8],
      ["漏发", 8],
      ["不满意", 7],
      ["赔偿", 10],
    ]),
  },
  {
    scene: "尺码推荐",
    agentKey: "size_recommendation",
    keywords: weighted([
      ["尺码", 12],
      ["身高", 9],
      ["体重", 9],
      ["穿多大", 10],
      ["合身", 8],
      ["偏大", 8],
      ["偏小", 8],
      ["腰围", 8],
      ["胸围", 8],
      ["码数", 9],
    ]),
  },
  {
    scene: "售前转化",
    agentKey: "pre_sales",
    keywords: weighted([
      ["推荐", 9],
      ["价格", 8],
      ["优惠", 8],
      ["怎么买", 8],
      ["活动", 7],
      ["适合", 7],
      ["有货", 7],
      ["多少钱", 9],
      ["商品", 6],
      ["对比", 6],
      ["介绍", 6],
    ]),
  },
];

function parseChatTranscript(text, options = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), lineNumber: index + 1 }))
    .filter((line) => Boolean(line.text));
  const messages = [];
  for (const line of lines) {
    const parsed = parseMessageLine(line.text, line.lineNumber);
    if (parsed) messages.push(parsed);
  }

  const pairs = [];
  let lastCustomer = null;
  for (const message of messages) {
    if (message.role === "customer") {
      lastCustomer = message;
      continue;
    }
    if (message.role === "service" && lastCustomer) {
      const scene = classifyScene(`${lastCustomer.text}\n${message.text}`, options.sceneRules);
      pairs.push({
        question: lastCustomer.text,
        answer: message.text,
        scene: scene.scene,
        agentKey: scene.agentKey,
        score: scoreTrainingPair(lastCustomer.text, message.text),
        sourceLineStart: lastCustomer.lineNumber,
        sourceLineEnd: message.lineNumber,
      });
      lastCustomer = null;
    }
  }

  return {
    messageCount: messages.length,
    pairCount: pairs.length,
    messages,
    pairs,
    warnings: buildImportWarnings(lines.length, messages.length, pairs.length),
  };
}

function parseMessageLine(line, lineNumber = 0) {
  const match = String(line || "").match(
    /^(?:\[[^\]]+\]\s*)?(客户|买家|用户|顾客|客服|人工|店员|商家|助理|机器人|AI)[:：]\s*(.+)$/i,
  );
  if (!match) return null;
  const speaker = match[1];
  const text = cleanupMessage(match[2]);
  if (!text) return null;
  const role = ["客户", "买家", "用户", "顾客"].includes(speaker) ? "customer" : "service";
  return {
    role,
    speaker,
    text,
    lineNumber,
  };
}

function cleanupMessage(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\[(图片|表情|视频|语音|链接|商品卡片|订单卡片)\]/g, "[$1]")
    .trim();
}

function classifyScene(text, sceneRules = DEFAULT_SCENE_RULES) {
  const content = normalizeContent(text);
  const scores = sceneRules
    .map((rule) => scoreSceneRule(rule, content))
    .sort((a, b) => b.score - a.score || b.matchedKeywords.length - a.matchedKeywords.length);
  const best = scores[0];
  if (!best || best.score <= 0) {
    return {
      scene: "未分类",
      agentKey: "general",
      hits: 0,
      score: 0,
      matchedKeywords: [],
      scores,
    };
  }
  return {
    scene: best.scene,
    agentKey: best.agentKey,
    hits: best.matchedKeywords.length,
    score: best.score,
    matchedKeywords: best.matchedKeywords,
    scores: scores.slice(0, 5),
  };
}

function scoreSceneRule(rule, content) {
  const matched = [];
  let score = 0;
  for (const keyword of rule.keywords || []) {
    const value = normalizeContent(keyword.value);
    if (!value || !content.includes(value)) continue;
    matched.push(keyword.value);
    score += keyword.weight || 1;
  }
  if (matched.length >= 2) score += Math.min(matched.length * 2, 10);
  return {
    scene: rule.scene,
    agentKey: rule.agentKey,
    score,
    matchedKeywords: [...new Set(matched)],
  };
}

function scoreTrainingPair(question, answer) {
  let score = 50;
  const q = String(question || "");
  const a = String(answer || "");
  if (q.length >= 6) score += 10;
  if (a.length >= 15) score += 10;
  if (/[?？吗呢]$/.test(q)) score += 5;
  if (/亲|您|可以|帮您|这边|麻烦|建议|确认|理解|放心/.test(a)) score += 10;
  if (/不知道|不清楚|随便|自己看|不能|没办法/.test(a)) score -= 20;
  if (a.length > 220) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function buildImportWarnings(lineCount, messageCount, pairCount) {
  const warnings = [];
  if (!lineCount) warnings.push("没有读取到聊天文本。");
  if (lineCount && !messageCount) warnings.push("没有识别到“客户：/客服：”格式的消息。");
  if (messageCount && !pairCount) warnings.push("没有形成客户问题和客服回答的配对。");
  return warnings;
}

function normalizeContent(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?]/g, "");
}

function weighted(items) {
  return items.map(([value, weight]) => ({ value, weight }));
}

module.exports = {
  DEFAULT_SCENE_RULES,
  classifyScene,
  parseChatTranscript,
  scoreTrainingPair,
};
