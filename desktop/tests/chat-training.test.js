"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyScene, evaluateSceneClassification, parseChatTranscript, scoreTrainingPair } = require("../packages/rules");

test("parses chat transcript into customer-service training pairs", () => {
  const result = parseChatTranscript(`
客户：我想做端午礼盒，每盒预算180，能先看效果图吗？
客服：可以的，我先按员工福利场景给您搭一套礼盒，再出几张真实摆拍效果图给您挑。
客户：快递一直不动怎么办？
客服：我帮您查一下物流状态，如果确实停滞会同步安排催件或补发方案。
`);

  assert.equal(result.messageCount, 4);
  assert.equal(result.pairCount, 2);
  assert.equal(result.pairs[0].scene, "礼盒设计");
  assert.equal(result.pairs[0].agentKey, "gift_design");
  assert.equal(result.pairs[0].sceneCheck.status, "clear");
  assert.equal(result.pairs[0].sceneScore > 0, true);
  assert.equal(result.pairs[0].matchedKeywords.length > 0, true);
  assert.equal(result.pairs[1].scene, "物流异常");
  assert.equal(result.warnings.length, 0);
});

test("classifies scene by weighted keyword hits", () => {
  const result = classifyScene("客户说礼盒预算和 logo 定制效果图");
  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.matchedKeywords.includes("礼盒"), true);
  assert.equal(result.scores[0].agentKey, "gift_design");
});

test("explains weak and ambiguous scene classification for imported chat samples", () => {
  const weak = evaluateSceneClassification({
    scene: "pre_sales",
    agentKey: "pre_sales",
    score: 8,
    scores: [{ scene: "pre_sales", agentKey: "pre_sales", score: 8, matchedKeywords: ["recommend"] }],
  });
  const ambiguous = evaluateSceneClassification({
    scene: "after_sales",
    agentKey: "after_sales",
    score: 22,
    scores: [
      { scene: "after_sales", agentKey: "after_sales", score: 22, matchedKeywords: ["refund"] },
      { scene: "order_payment", agentKey: "order_payment", score: 18, matchedKeywords: ["order"] },
    ],
  });

  assert.equal(weak.status, "weak");
  assert.equal(weak.needsReview, true);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.needsReview, true);
  assert.equal(ambiguous.scoreGap, 4);
});

test("classifies order and payment scene", () => {
  const result = classifyScene("我已经付定金了，订单能不能改地址并开发票");
  assert.equal(result.agentKey, "order_payment");
  assert.equal(result.scene, "下单支付");
});

test("scores high-empathy answer higher than cold answer", () => {
  const warm = scoreTrainingPair("为什么还没发货？", "亲，我这边马上帮您核对发货进度，如果仓库还没出库会优先催一下。");
  const cold = scoreTrainingPair("为什么还没发货？", "不知道，自己看。");
  assert.equal(warm > cold, true);
});
