"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { ReviewsService } = require("../apps/api/src/reviews/reviews.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("prisma review center is scoped by selected conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const calls = [];
  const prisma = {
    designJob: {
      findMany: async (options) => {
        calls.push({ model: "designJob", options });
        return [
          {
            id: "design_current",
            status: "manual_review",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
          },
        ];
      },
    },
    quoteDraft: {
      findMany: async (options) => {
        calls.push({ model: "quoteDraft", options });
        return [
          {
            id: "quote_current",
            status: "manual_review",
            customerId: "customer_demo_1",
            designJob: {
              id: "design_current",
              wechatAccountId: "wechat_demo_1",
              conversationId: "conversation_demo_1",
              customerId: "customer_demo_1",
            },
          },
        ];
      },
    },
    orderDraft: {
      findMany: async (options) => {
        calls.push({ model: "orderDraft", options });
        return [
          {
            id: "order_current",
            status: "manual_review",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
          },
        ];
      },
    },
    wechatSendTask: {
      findMany: async (options) => {
        calls.push({ model: "wechatSendTask", options });
        return [
          {
            id: "send_current",
            status: "blocked",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
            guardSnapshot: {
              blockedByHighValueReview: true,
              reason: "manual_review_required",
            },
          },
          {
            id: "send_other_blocked",
            status: "blocked",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
            guardSnapshot: {
              blockedByManualLock: true,
              reason: "conversation_manual_locked",
            },
          },
          {
            id: "send_high_value_automation",
            status: "blocked",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
            guardSnapshot: {
              automation: {
                valueLevel: "high",
                queuedBy: "manual_review_flow",
              },
            },
          },
          {
            id: "send_high_value_approved",
            status: "blocked",
            wechatAccountId: "wechat_demo_1",
            conversationId: "conversation_demo_1",
            customerId: "customer_demo_1",
            guardSnapshot: {
              automation: {
                valueLevel: "high",
                queuedBy: "manual_review_flow",
                manualApproved: true,
              },
            },
          },
        ];
      },
    },
    reviewLog: {
      findMany: async (options) => {
        calls.push({ model: "reviewLog", options });
        return [
          { id: "log_design_current", targetType: "design_job", targetId: "design_current", decision: "manual_review" },
          { id: "log_quote_current", targetType: "quote", targetId: "quote_current", decision: "manual_review" },
          { id: "log_order_current", targetType: "order_draft", targetId: "order_current", decision: "manual_review" },
          { id: "log_send_current", targetType: "send_task", targetId: "send_current", decision: "manual_review_required" },
          {
            id: "log_metadata_current",
            targetType: "conversation",
            targetId: "conversation_demo_1",
            decision: "manual_lock",
            metadata: {
              wechatAccountId: "wechat_demo_1",
              conversationId: "conversation_demo_1",
              customerId: "customer_demo_1",
            },
          },
          {
            id: "log_other",
            targetType: "conversation",
            targetId: "conversation_demo_2",
            decision: "manual_lock",
            metadata: {
              wechatAccountId: "wechat_demo_2",
              conversationId: "conversation_demo_2",
              customerId: "customer_demo_2",
            },
          },
        ];
      },
    },
  };
  const service = new ReviewsService(prisma, {}, {}, {}, {});

  try {
    const result = await service.list({
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    });

    assert.deepEqual(result.designJobs.map((item) => item.id), ["design_current"]);
    assert.deepEqual(result.quoteDrafts.map((item) => item.id), ["quote_current"]);
    assert.deepEqual(result.orderDrafts.map((item) => item.id), ["order_current"]);
    assert.deepEqual(result.sendTasks.map((item) => item.id), ["send_current", "send_high_value_automation"]);
    assert.deepEqual(
      result.logs.map((item) => item.id),
      ["log_design_current", "log_quote_current", "log_order_current", "log_send_current", "log_metadata_current"],
    );
    assert.deepEqual(calls.find((call) => call.model === "designJob").options.where.wechatAccountId, "wechat_demo_1");
    assert.deepEqual(calls.find((call) => call.model === "designJob").options.where.conversationId, "conversation_demo_1");
    assert.deepEqual(calls.find((call) => call.model === "quoteDraft").options.where.designJob.conversationId, "conversation_demo_1");
    assert.deepEqual(calls.find((call) => call.model === "orderDraft").options.where.customerId, "customer_demo_1");
    assert.deepEqual(calls.find((call) => call.model === "wechatSendTask").options.where.conversationId, "conversation_demo_1");
    assert.equal(calls.find((call) => call.model === "reviewLog").options.take, 300);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
