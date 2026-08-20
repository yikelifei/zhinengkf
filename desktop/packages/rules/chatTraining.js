"use strict";

const DEFAULT_SCENE_RULES = [
  {
    scene: "礼盒设计",
    agentKey: "gift_design",
    keywords: weighted([
      ["礼盒", 4],
      ["礼盒设计", 16],
      ["效果图", 12],
      ["摆拍", 10],
      ["logo", 8],
      ["Logo", 8],
      ["定制", 7],
      ["包装设计", 8],
      ["参考图", 7],
      ["素材", 6],
      ["出图", 9],
      ["腰封", 16],
      ["设计稿", 14],
      ["刀模", 14],
      ["出血", 14],
      ["试装", 16],
      ["装下", 14],
      ["装盒", 10],
      ["内衬", 16],
      ["按这个组合", 16],
      ["这几个单品", 10],
      ["盒子尺寸", 12],
      ["盒子的尺寸", 12],
      ["盒子是", 12],
      ["卡片", 8],
      ["贺卡", 14],
      ["方形贺卡", 16],
      ["方形的贺卡", 16],
      ["1:1", 10],
      ["1：1", 10],
      ["主题颜色", 10],
      ["主题色", 10],
      ["紫色主题", 12],
      ["祝福卡", 14],
      ["感谢卡", 14],
      ["心意卡", 14],
      ["卡片设计", 16],
      ["再设计", 12],
      ["重新设计", 12],
      ["重做", 12],
      ["调整卡片", 14],
      ["不要这个花", 16],
      ["不要花", 12],
      ["去掉花", 12],
      ["月饼盒", 14],
      ["混装", 12],
      ["一模一样", 12],
      ["照着", 6],
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
      ["微信付", 14],
      ["微信付款", 14],
      ["微信收款", 14],
      ["对公", 14],
      ["公户", 14],
      ["收款", 8],
      ["退微信", 14],
      ["原路退", 12],
      ["正式报价", 20],
      ["给我报价", 14],
      ["最低价", 14],
      ["全网最低", 16],
      ["成本", 14],
    ]),
  },
  {
    scene: "物流异常",
    agentKey: "logistics_exception",
    keywords: weighted([
      ["物流", 11],
      ["快递", 11],
      ["发货", 9],
      ["什么时候发货", 18],
      ["订单什么时候发货", 20],
      ["催发货", 16],
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
      ["退款", 14],
      ["退货", 14],
      ["换货", 14],
      ["破损", 16],
      ["破了", 14],
      ["补发", 9],
      ["售后", 9],
      ["质量", 8],
      ["坏了", 8],
      ["少件", 8],
      ["少了", 10],
      ["漏发", 8],
      ["不满意", 7],
      ["赔偿", 10],
      ["可以退吗", 16],
      ["能退吗", 16],
    ]),
  },
  {
    scene: "售前转化",
    agentKey: "pre_sales",
    keywords: weighted([
      ["推荐", 9],
      ["有什么推荐", 14],
      ["帮我推荐", 14],
      ["礼盒推荐", 14],
      ["直接推荐", 14],
      ["有哪些款式", 18],
      ["有哪几款", 18],
      ["有哪些款", 16],
      ["都有什么款", 16],
      ["什么款式", 14],
      ["看看款式", 14],
      ["发几个款", 14],
      ["款式", 10],
      ["商品组合", 12],
      ["库存", 10],
      ["现货", 10],
      ["价格", 8],
      ["优惠", 12],
      ["能优惠吗", 12],
      ["怎么买", 8],
      ["活动", 7],
      ["适合", 7],
      ["有货", 7],
      ["多少钱", 16],
      ["怎么卖", 16],
      ["再便宜", 14],
      ["让点", 14],
      ["好贵", 14],
      ["商品", 6],
      ["对比", 6],
      ["介绍", 6],
      ["伴手礼", 14],
      ["企业礼赠", 12],
      ["员工福利", 10],
      ["客户答谢", 12],
      ["商务拜访", 10],
      ["节礼", 9],
      ["教师节", 14],
      ["中秋", 12],
      ["医师节", 14],
      ["开业", 10],
      ["酒店", 14],
      ["民宿", 14],
      ["瑜伽", 12],
      ["普拉提", 12],
      ["服装店", 14],
      ["美容院", 14],
      ["样品", 16],
      ["寄样", 16],
      ["1688", 16],
      ["比价", 14],
      ["同款", 8],
      ["固定款", 14],
      ["小单", 10],
      ["风吕敷", 16],
      ["风铃", 14],
      ["新款", 14],
      ["还有什么新的", 14],
      ["上次方案", 14],
      ["每份", 6],
      ["预算", 8],
      ["商务一点", 14],
      ["商务礼", 12],
      ["图里的款", 14],
      ["喜欢这款", 12],
      ["选款", 10],
      ["不是我想要", 14],
      ["不喜欢这些", 14],
      ["不好看", 12],
      ["太可爱", 14],
      ["简单款", 14],
      ["东西可以更换", 14],
      ["扩香石", 14],
      ["领导出差", 16],
      ["先缓两天", 14],
      ["暂时还没决定", 16],
      ["考虑一下", 8],
      ["不定了", 14],
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

  const turns = [];
  for (const message of messages) {
    const previous = turns[turns.length - 1];
    if (previous?.role === message.role) {
      previous.messages.push(message);
      previous.lineEnd = message.lineNumber;
      continue;
    }
    turns.push({
      role: message.role,
      messages: [message],
      lineStart: message.lineNumber,
      lineEnd: message.lineNumber,
    });
  }

  const pairs = [];
  for (let index = 0; index < turns.length - 1; index += 1) {
    const customerTurn = turns[index];
    const serviceTurn = turns[index + 1];
    if (customerTurn.role === "customer" && serviceTurn.role === "service") {
      const questionMessages = customerTurn.messages.map((message) => message.text);
      const answerMessages = serviceTurn.messages.map((message) => message.text);
      const question = questionMessages.join("\n");
      const answer = answerMessages.join("\n");
      const scene = classifyScene(`${question}\n${answer}`, options.sceneRules);
      const sceneCheck = evaluateSceneClassification(scene);
      pairs.push({
        question,
        answer,
        questionMessages,
        answerMessages,
        scene: scene.scene,
        agentKey: scene.agentKey,
        sceneScore: scene.score || 0,
        matchedKeywords: scene.matchedKeywords || [],
        sceneScores: scene.scores || [],
        sceneCheck,
        score: scoreTrainingPair(question, answer),
        sourceLineStart: customerTurn.lineStart,
        sourceLineEnd: serviceTurn.lineEnd,
      });
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

function evaluateSceneClassification(classifiedScene = {}) {
  const positiveScores = (classifiedScene.scores || []).filter((item) => Number(item.score || 0) > 0);
  const top = positiveScores[0] || null;
  const second = positiveScores[1] || null;
  const topScore = Number(top?.score || classifiedScene.score || 0);
  const secondScore = Number(second?.score || 0);
  const scoreGap = topScore - secondScore;

  if (!top || topScore <= 0) {
    return {
      status: "unmatched",
      reason: "no_scene_keyword_hit",
      needsReview: true,
      topScene: null,
      secondaryScene: null,
      scoreGap: 0,
    };
  }

  if (topScore < 14) {
    return {
      status: "weak",
      reason: "only_weak_scene_signal",
      needsReview: true,
      topScene: top,
      secondaryScene: second,
      scoreGap,
    };
  }

  if (second && secondScore >= 14 && (scoreGap <= 8 || secondScore / topScore >= 0.72)) {
    return {
      status: "ambiguous",
      reason: "multiple_scene_signals_close",
      needsReview: true,
      topScene: top,
      secondaryScene: second,
      scoreGap,
    };
  }

  return {
    status: "clear",
    reason: "top_scene_confident",
    needsReview: false,
    topScene: top,
    secondaryScene: second,
    scoreGap,
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
  evaluateSceneClassification,
  parseChatTranscript,
  scoreTrainingPair,
};
