"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateLowValueDesignImageSend,
  evaluateLowValueOrderConfirmationSend,
  evaluateLowValueOrderFollowupSend,
  evaluateLowValueOrderDraftFromQuote,
  evaluateLowValueQuoteSend,
} = require("../packages/rules");

test("queues low-value completed design images for safe sending", () => {
  const decision = evaluateLowValueDesignImageSend({
    id: "design_1",
    status: "quick_confirm",
    isHighValue: false,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [{ id: "image_1", localPath: "storage/results/1.png" }],
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "queue_design_images");
});

test("does not auto-send high-value design images", () => {
  const decision = evaluateLowValueDesignImageSend({
    id: "design_1",
    status: "quick_confirm",
    isHighValue: true,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [{ id: "image_1", localPath: "storage/results/1.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("does not auto-send design images when conversation is manually locked", () => {
  const decision = evaluateLowValueDesignImageSend({
    id: "design_1",
    status: "quick_confirm",
    isHighValue: false,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    conversation: { manualLocked: true },
    images: [{ id: "image_1", localPath: "storage/results/1.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "conversation_manual_locked");
});

test("does not queue design images without a send target", () => {
  const decision = evaluateLowValueDesignImageSend({
    id: "design_1",
    status: "quick_confirm",
    isHighValue: false,
    images: [{ id: "image_1", localPath: "storage/results/1.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_send_target");
});

test("does not queue design images without local file paths", () => {
  const decision = evaluateLowValueDesignImageSend({
    id: "design_1",
    status: "quick_confirm",
    isHighValue: false,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [{ id: "image_1", downloadUrl: "https://example.test/result.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_images");
});


test("queues low-value selected quote for safe sending", () => {
  const decision = evaluateLowValueQuoteSend({
    id: "quote_1",
    status: "auto_sent",
    selectedImageId: "image_1",
    totalPrice: 9000,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "queue_quote");
});

test("does not queue high-value quote automatically", () => {
  const decision = evaluateLowValueQuoteSend({
    id: "quote_1",
    status: "auto_sent",
    selectedImageId: "image_1",
    totalPrice: 12000,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("does not queue quote when conversation is manually locked", () => {
  const decision = evaluateLowValueQuoteSend({
    id: "quote_1",
    status: "auto_sent",
    selectedImageId: "image_1",
    totalPrice: 9000,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      conversation: { manualLocked: true },
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "conversation_manual_locked");
});

test("does not queue quote without selected image", () => {
  const decision = evaluateLowValueQuoteSend({
    id: "quote_1",
    status: "auto_sent",
    totalPrice: 9000,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_selected_image");
});

test("does not queue quote with negative profit", () => {
  const decision = evaluateLowValueQuoteSend({
    id: "quote_1",
    status: "auto_sent",
    selectedImageId: "image_1",
    totalPrice: 9000,
    profit: -100,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "negative_profit");
});

test("creates low-value order draft after quote is sent", () => {
  const decision = evaluateLowValueOrderDraftFromQuote({
    id: "quote_1",
    status: "sent",
    paymentStatus: "unpaid",
    selectedImageId: "image_1",
    totalPrice: 9000,
    profit: 3600,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "create_order_draft");
});

test("creates low-value order draft after deposit is marked", () => {
  const decision = evaluateLowValueOrderDraftFromQuote({
    id: "quote_1",
    status: "send_queued",
    paymentStatus: "deposit_paid",
    selectedImageId: "image_1",
    totalPrice: 9000,
    profit: 3600,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "create_order_draft");
});

test("does not create order draft for high-value quote automatically", () => {
  const decision = evaluateLowValueOrderDraftFromQuote({
    id: "quote_1",
    status: "sent",
    paymentStatus: "unpaid",
    selectedImageId: "image_1",
    totalPrice: 12000,
    profit: 5000,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("does not create order draft automatically when conversation is manually locked", () => {
  const decision = evaluateLowValueOrderDraftFromQuote({
    id: "quote_1",
    status: "sent",
    paymentStatus: "unpaid",
    selectedImageId: "image_1",
    totalPrice: 9000,
    profit: 3600,
    designJob: {
      id: "design_1",
      isHighValue: false,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      conversation: { manualLocked: true },
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "conversation_manual_locked");
});

test("does not create duplicate order draft automatically", () => {
  const decision = evaluateLowValueOrderDraftFromQuote(
    {
      id: "quote_1",
      status: "sent",
      paymentStatus: "unpaid",
      selectedImageId: "image_1",
      totalPrice: 9000,
      profit: 3600,
      designJob: {
        id: "design_1",
        isHighValue: false,
        wechatAccountId: "wechat_1",
        conversationId: "conversation_1",
      },
    },
    { existingOrderDraft: { id: "order_1" } },
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "already_has_order_draft");
});

test("queues low-value order confirmation only after customer acceptance", () => {
  const decision = evaluateLowValueOrderConfirmationSend({
    id: "order_1",
    status: "confirmed",
    paymentStatus: "unpaid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 9000,
    profit: 3600,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "unpaid",
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "queue_order_confirmation");
});

test("does not queue order confirmation for a merely sent quote", () => {
  const decision = evaluateLowValueOrderConfirmationSend({
    id: "order_1",
    status: "draft",
    paymentStatus: "unpaid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 9000,
    profit: 3600,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "sent",
      paymentStatus: "unpaid",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "quote_not_accepted");
});

test("does not queue duplicate order confirmation", () => {
  const decision = evaluateLowValueOrderConfirmationSend({
    id: "order_1",
    status: "confirmed",
    paymentStatus: "paid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 9000,
    profit: 3600,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    confirmationSendTaskId: "send_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "paid",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "already_queued");
});

test("does not queue high-value order confirmation automatically", () => {
  const decision = evaluateLowValueOrderConfirmationSend({
    id: "order_1",
    status: "confirmed",
    paymentStatus: "paid",
    selectedImageId: "image_1",
    unitPrice: 120,
    totalPrice: 12000,
    profit: 5000,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "paid",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("queues low-value production follow-up after paid order starts processing", () => {
  const decision = evaluateLowValueOrderFollowupSend({
    id: "order_1",
    status: "processing",
    paymentStatus: "deposit_paid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 9000,
    profit: 3600,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "deposit_paid",
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "queue_order_followup");
  assert.equal(decision.followupType, "production");
});

test("queues low-value delivery follow-up after paid order is fulfilled", () => {
  const decision = evaluateLowValueOrderFollowupSend({
    id: "order_1",
    status: "fulfilled",
    paymentStatus: "paid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 9000,
    profit: 3600,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "paid",
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.followupType, "delivery");
});

test("does not queue order follow-up before payment is ready", () => {
  const decision = evaluateLowValueOrderFollowupSend({
    id: "order_1",
    status: "processing",
    paymentStatus: "unpaid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 9000,
    profit: 3600,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "unpaid",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "payment_not_ready");
});

test("does not queue duplicate order follow-up for the same stage", () => {
  const decision = evaluateLowValueOrderFollowupSend(
    {
      id: "order_1",
      status: "processing",
      paymentStatus: "paid",
      selectedImageId: "image_1",
      unitPrice: 180,
      totalPrice: 9000,
      profit: 3600,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      designJob: {
        id: "design_1",
        isHighValue: false,
      },
      quoteDraft: {
        id: "quote_1",
        status: "accepted",
        paymentStatus: "paid",
      },
    },
    { existingFollowupTypes: ["production"] },
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "already_queued");
});

test("allows delivery follow-up after a previous production follow-up", () => {
  const decision = evaluateLowValueOrderFollowupSend(
    {
      id: "order_1",
      status: "fulfilled",
      paymentStatus: "paid",
      selectedImageId: "image_1",
      unitPrice: 180,
      totalPrice: 9000,
      profit: 3600,
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      designJob: {
        id: "design_1",
        isHighValue: false,
      },
      quoteDraft: {
        id: "quote_1",
        status: "accepted",
        paymentStatus: "paid",
      },
    },
    { existingFollowupTypes: ["production"] },
  );

  assert.equal(decision.ok, true);
  assert.equal(decision.followupType, "delivery");
});

test("does not queue high-value order follow-up automatically", () => {
  const decision = evaluateLowValueOrderFollowupSend({
    id: "order_1",
    status: "processing",
    paymentStatus: "paid",
    selectedImageId: "image_1",
    unitPrice: 180,
    totalPrice: 12000,
    profit: 5000,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    designJob: {
      id: "design_1",
      isHighValue: false,
    },
    quoteDraft: {
      id: "quote_1",
      status: "accepted",
      paymentStatus: "paid",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});
