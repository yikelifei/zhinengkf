"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeConversationConversion,
  buildConversationLearningInsight,
} = require("../packages/rules");

test("creates a review-gated learning observation from every inbound customer turn", () => {
  const insight = buildConversationLearningInsight({
    text: "教师节要300份，单份预算25元，能定制Logo吗？",
    messageId: "msg_1",
    observedAt: "2026-08-16T01:00:00.000Z",
    route: {
      agentKey: "pre_sales",
      action: "auto_agent",
      budget: { quantity: 300, perUnitAmount: 25 },
      missingFields: ["style_preference"],
    },
  });

  assert.equal(insight.schema, "conversation_learning_v1");
  assert.equal(insight.sourceMessageId, "msg_1");
  assert.equal(insight.customerIntent, "询价或预算匹配");
  assert.equal(insight.knownFacts.find((item) => item.field === "quantity").value, 300);
  assert.equal(insight.knownFacts.find((item) => item.field === "per_unit_budget").value, 25);
  assert.equal(insight.knownFacts.find((item) => item.field === "occasion").value, "教师节");
  assert.equal(insight.learningPolicy.autoPromote, false);
  assert.equal(insight.learningPolicy.status, "review_required");
  assert.ok(insight.learningPolicy.blockedMutableFactCategories.includes("price"));
  assert.ok(insight.learningPolicy.blockedMutableFactCategories.includes("stock"));
});

test("grounds price comparison feedback in customer messages", () => {
  const result = analyzeConversationConversion({
    conversation: { id: "conv_1", status: "open" },
    messages: [
      { id: "m1", direction: "inbound", text: "我们要500份，1688上看着便宜很多", createdAt: "2026-08-15T01:00:00.000Z" },
      { id: "m2", direction: "outbound", text: "我们的价格包含包装和定制", createdAt: "2026-08-15T01:01:00.000Z" },
    ],
    quotes: [],
    orders: [],
    now: "2026-08-15T02:00:00.000Z",
  });

  assert.equal(result.outcome, "ongoing");
  assert.equal(result.primaryReason.code, "platform_price_comparison");
  assert.equal(result.primaryReason.inference, false);
  assert.match(result.primaryReason.evidence[0].excerpt, /1688/);
});

test("marks explicit cancellation as lost but does not treat silence alone as loss", () => {
  const cancelled = analyzeConversationConversion({
    conversation: { id: "conv_cancel", status: "open" },
    messages: [{ id: "m1", direction: "inbound", text: "不用了，我们已经定别家了", createdAt: "2026-08-15T01:00:00.000Z" }],
    now: "2026-08-16T03:00:00.000Z",
  });
  assert.equal(cancelled.outcome, "lost");
  assert.equal(cancelled.primaryReason.code, "explicit_cancel");

  const silent = analyzeConversationConversion({
    conversation: { id: "conv_silent", status: "open" },
    messages: [
      { id: "m1", direction: "inbound", text: "发个报价看看", createdAt: "2026-08-14T01:00:00.000Z" },
      { id: "m2", direction: "outbound", text: "报价发您了", createdAt: "2026-08-14T01:05:00.000Z" },
    ],
    quotes: [{ id: "q1", status: "sent", paymentStatus: "unpaid" }],
    now: "2026-08-16T03:00:00.000Z",
  });
  assert.equal(silent.outcome, "ongoing");
  assert.equal(silent.state, "stalled");
  assert.equal(silent.primaryReason.code, "customer_silent_after_followup");
  assert.equal(silent.primaryReason.inference, true);
});

test("uses commerce truth and operator confirmation ahead of text inference", () => {
  const won = analyzeConversationConversion({
    conversation: { id: "conv_order", status: "open" },
    messages: [{ id: "m1", direction: "inbound", text: "有点贵", createdAt: "2026-08-15T01:00:00.000Z" }],
    orders: [{ id: "order_1", status: "draft" }],
  });
  assert.equal(won.outcome, "won");
  assert.equal(won.primaryReason.code, "converted");

  const confirmed = analyzeConversationConversion({
    conversation: { id: "conv_confirmed", status: "open" },
    routes: [{
      updatedAt: "2026-08-16T01:00:00.000Z",
      conversionAssessment: {
        confirmedOutcome: {
          outcome: "lost",
          reasonCode: "delivery_timeline_mismatch",
          note: "客户要求明天到货，供应链无法确认",
          reviewer: "operator_1",
        },
      },
    }],
  });
  assert.equal(confirmed.outcome, "lost");
  assert.equal(confirmed.outcomeSource, "operator_confirmed");
  assert.equal(confirmed.primaryReason.code, "delivery_timeline_mismatch");
  assert.equal(confirmed.primaryReason.confidence, 1);
});

test("source wiring persists observations and exposes grounded conversion feedback", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const dispatch = read("apps/api/src/wechat/wechat-dispatch.service.ts");
  const localStore = read("apps/api/src/local-store/local-store.service.ts");
  const prismaStore = read("apps/api/src/prisma/prisma-operations.service.ts");
  const service = read("apps/api/src/training/training.service.ts");
  const controller = read("apps/api/src/training/training.controller.ts");
  const page = [
    read("apps/web/src/features/training/training-overview-page.tsx"),
    read("apps/web/src/features/training/conversation-feedback-record.tsx"),
  ].join("\n");

  assert.match(dispatch, /buildConversationLearningInsight/);
  assert.match(localStore, /learningInsight:/);
  assert.match(prismaStore, /learningInsight:/);
  assert.match(service, /analyzeConversationConversion/);
  assert.match(controller, /@Get\("conversation-learning"\)/);
  assert.match(controller, /confirmConversationOutcome/);
  assert.match(page, /每轮学习与未成交反馈/);
  assert.match(page, /客户沉默只标记为“停滞”/);
  assert.match(page, /标为成交/);
  assert.match(page, /标为未成交/);
});
