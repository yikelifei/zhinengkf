"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateDesignAssetBinding,
  validateDesignCallbackBinding,
  validateDesignJobIdentity,
  validateInboundConversationBinding,
  validateOrderDraftQuoteBinding,
  validateQuoteDraftIdentity,
} = require("../packages/rules");

const conversation = {
  id: "conversation-1",
  customerId: "customer-1",
  wechatAccountId: "wechat-1",
};

test("passes inbound conversation binding when account and conversation match", () => {
  const result = validateInboundConversationBinding({
    requestedWechatAccountId: "wechat-1",
    requestedConversationId: "conversation-1",
    conversation,
  });

  assert.equal(result.ok, true);
});

test("blocks inbound conversation binding when account points to another conversation owner", () => {
  const result = validateInboundConversationBinding({
    requestedWechatAccountId: "wechat-2",
    requestedConversationId: "conversation-1",
    conversation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("requestedWechatAccountMatches"), true);
});

test("blocks inbound conversation binding without explicit conversation id", () => {
  const result = validateInboundConversationBinding({
    requestedWechatAccountId: "wechat-1",
    conversation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("requestedConversationProvided"), true);
});

test("passes design job identity when customer, account and conversation match", () => {
  const result = validateDesignJobIdentity({
    payload: {
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
  });

  assert.equal(result.ok, true);
});

test("blocks design job identity when customer belongs to another conversation", () => {
  const result = validateDesignJobIdentity({
    payload: {
      customerId: "customer-2",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("customerMatchesConversation"), true);
});

test("blocks design job identity when account belongs to another conversation", () => {
  const result = validateDesignJobIdentity({
    payload: {
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-2",
    },
    conversation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("wechatAccountMatchesConversation"), true);
});

test("passes design asset binding when all assets belong to design job customer", () => {
  const result = validateDesignAssetBinding({
    designJob: {
      id: "design-1",
      customerId: "customer-1",
    },
    requestedAssetIds: ["asset-1", "asset-2"],
    assets: [
      { id: "asset-1", ownerType: "customer", ownerId: "customer-1" },
      { id: "asset-2", ownerType: "customer", ownerId: "customer-1" },
    ],
  });

  assert.equal(result.ok, true);
});

test("blocks design asset binding when an asset belongs to another customer", () => {
  const result = validateDesignAssetBinding({
    designJob: {
      id: "design-1",
      customerId: "customer-1",
    },
    requestedAssetIds: ["asset-1", "asset-2"],
    assets: [
      { id: "asset-1", ownerType: "customer", ownerId: "customer-1" },
      { id: "asset-2", ownerType: "customer", ownerId: "customer-2" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("assetCustomerMatchesJob:asset-2"), true);
});

test("passes design callback binding when request and external job match", () => {
  const result = validateDesignCallbackBinding({
    payload: { requestId: "request-1", externalJobId: "external-1" },
    job: { id: "design-1", requestId: "request-1", externalJobId: "external-1" },
  });

  assert.equal(result.ok, true);
});

test("blocks design callback binding when external job differs", () => {
  const result = validateDesignCallbackBinding({
    payload: { requestId: "request-1", externalJobId: "external-2" },
    job: { id: "design-1", requestId: "request-1", externalJobId: "external-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("callbackExternalJobMatches"), true);
});

test("blocks design callback binding when callback has external job but task has none", () => {
  const result = validateDesignCallbackBinding({
    payload: { requestId: "request-1", externalJobId: "external-1" },
    job: { id: "design-1", requestId: "request-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("callbackExternalJobMatches"), true);
});

test("passes quote draft identity when quote, design job, conversation and image match", () => {
  const result = validateQuoteDraftIdentity({
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: {
      id: "image-1",
      designJobId: "design-1",
    },
  });

  assert.equal(result.ok, true);
});

test("blocks quote draft identity when quote customer differs from conversation", () => {
  const result = validateQuoteDraftIdentity({
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-2",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("quoteCustomerMatchesDesignJob"), true);
  assert.equal(result.failedKeys.includes("quoteCustomerMatchesConversation"), true);
});

test("blocks quote draft identity when quote design job differs from hydrated design job", () => {
  const result = validateQuoteDraftIdentity({
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-2",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: {
      id: "image-1",
      designJobId: "design-1",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("quoteDesignJobMatches"), true);
});

test("blocks quote draft identity when selected image record differs from quote selection", () => {
  const result = validateQuoteDraftIdentity({
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: {
      id: "image-2",
      designJobId: "design-1",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("selectedImageMatchesQuote"), true);
});

test("blocks quote draft identity when selected image belongs to another design job", () => {
  const result = validateQuoteDraftIdentity({
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-2",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: {
      id: "image-2",
      designJobId: "design-2",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("selectedImageBelongsToDesignJob"), true);
});

test("passes order draft quote binding when quote, design job, conversation and image match", () => {
  const result = validateOrderDraftQuoteBinding({
    orderDraft: {
      id: "order-1",
      quoteDraftId: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
      selectedImageId: "image-1",
    },
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: {
      id: "image-1",
      designJobId: "design-1",
    },
  });

  assert.equal(result.ok, true);
});

test("blocks order draft quote binding when order points to another quote", () => {
  const result = validateOrderDraftQuoteBinding({
    orderDraft: {
      id: "order-1",
      quoteDraftId: "quote-2",
      designJobId: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
      selectedImageId: "image-1",
    },
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: { id: "image-1", designJobId: "design-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("orderQuoteDraftMatches"), true);
});

test("blocks order draft quote binding when order design job differs from quote", () => {
  const result = validateOrderDraftQuoteBinding({
    orderDraft: {
      id: "order-1",
      quoteDraftId: "quote-1",
      designJobId: "design-2",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
      selectedImageId: "image-1",
    },
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: { id: "image-1", designJobId: "design-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("orderDesignJobMatchesQuote"), true);
  assert.equal(result.failedKeys.includes("orderDesignJobMatchesDesignJob"), true);
});

test("blocks order draft quote binding when customer or account differs", () => {
  const result = validateOrderDraftQuoteBinding({
    orderDraft: {
      id: "order-1",
      quoteDraftId: "quote-1",
      designJobId: "design-1",
      customerId: "customer-2",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-2",
      selectedImageId: "image-1",
    },
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: { id: "image-1", designJobId: "design-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("orderCustomerMatchesQuote"), true);
  assert.equal(result.failedKeys.includes("orderWechatAccountMatchesDesignJob"), true);
  assert.equal(result.failedKeys.includes("orderWechatAccountMatchesConversation"), true);
});

test("blocks order draft quote binding when selected image belongs to another design job", () => {
  const result = validateOrderDraftQuoteBinding({
    orderDraft: {
      id: "order-1",
      quoteDraftId: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
      selectedImageId: "image-1",
    },
    quoteDraft: {
      id: "quote-1",
      designJobId: "design-1",
      customerId: "customer-1",
      selectedImageId: "image-1",
    },
    designJob: {
      id: "design-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      wechatAccountId: "wechat-1",
    },
    conversation,
    selectedImage: { id: "image-1", designJobId: "design-2" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("selectedImageBelongsToDesignJob"), true);
});
