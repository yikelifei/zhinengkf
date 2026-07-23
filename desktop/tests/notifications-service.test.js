"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("prisma notification list is scoped by selected conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const findManyCalls = [];
  const rows = [
    {
      id: "notice_other",
      readAt: null,
      target: {
        wechatAccountId: "wechat_demo_2",
        conversationId: "conversation_demo_2",
        customerId: "customer_demo_2",
      },
    },
    {
      id: "notice_current",
      readAt: null,
      target: {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      },
    },
    {
      id: "notice_global",
      readAt: null,
      target: {},
    },
  ];
  const prisma = {
    notification: {
      findMany: async (options) => {
        findManyCalls.push(options);
        return rows;
      },
    },
  };
  const service = new NotificationsService(prisma, {});

  try {
    const result = await service.list({
      unreadOnly: true,
      limit: 1,
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    });

    assert.deepEqual(
      result.map((notice) => notice.id),
      ["notice_current"],
    );
    assert.equal(findManyCalls[0].where.readAt, null);
    assert.equal(findManyCalls[0].take, 300);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("mark all notifications read requires and scopes selected conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const updateManyCalls = [];
  const rows = [
    {
      id: "notice_other",
      target: {
        wechatAccountId: "wechat_demo_2",
        conversationId: "conversation_demo_2",
        customerId: "customer_demo_2",
      },
    },
    {
      id: "notice_current",
      target: {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      },
    },
    {
      id: "notice_global",
      target: {},
    },
  ];
  const prisma = {
    notification: {
      findMany: async () => rows,
      updateMany: async (options) => {
        updateManyCalls.push(options);
        return { count: options.where.id.in.length };
      },
    },
  };
  const service = new NotificationsService(prisma, {});

  try {
    await assert.rejects(
      () => service.markAllRead({ wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1" }),
      /notifications identity expectation required: customerId/,
    );

    const result = await service.markAllRead({
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    });

    assert.deepEqual(updateManyCalls[0].where.id.in, ["notice_current"]);
    assert.equal(result.count, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
