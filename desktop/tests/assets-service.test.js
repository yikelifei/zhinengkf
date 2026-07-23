"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { AssetsService } = require("../apps/api/src/assets/assets.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function createPrismaHarness() {
  const calls = [];
  const conversations = new Map([
    ["conversation_demo_1", { id: "conversation_demo_1", wechatAccountId: "wechat_demo_1", customerId: "customer_demo_1" }],
    ["conversation_demo_2", { id: "conversation_demo_2", wechatAccountId: "wechat_demo_2", customerId: "customer_demo_2" }],
  ]);
  const prisma = {
    conversation: {
      findUnique: async ({ where }) => {
        calls.push({ model: "conversation", where });
        return conversations.get(where.id) || null;
      },
    },
    designAsset: {
      findMany: async (options) => {
        calls.push({ model: "designAsset.findMany", options });
        return [];
      },
      create: async ({ data }) => {
        calls.push({ model: "designAsset.create", data });
        return { id: "asset_created", ...data };
      },
      findFirst: async ({ where }) => {
        calls.push({ model: "designAsset.findFirst", where });
        return {
          id: "asset_current",
          ownerType: "customer",
          ownerId: "customer_demo_1",
          localPath: where.localPath,
        };
      },
    },
  };
  return { prisma, calls };
}

function createStorageHarness() {
  return {
    saveAssetFromBase64: async () => ({ localPath: "C:\\storage\\customer-logo.png", sizeBytes: 12 }),
    readLocalAsset: async () => ({ stream: {}, mimeType: "image/png", sizeBytes: 12 }),
  };
}

test("prisma customer assets are scoped by selected conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const { prisma, calls } = createPrismaHarness();
  const assets = new AssetsService(prisma, {}, createStorageHarness());

  try {
    await assets.list({
      ownerType: "customer",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    });

    const listCall = calls.find((call) => call.model === "designAsset.findMany");
    assert.deepEqual(listCall.options.where, {
      ownerType: "customer",
      ownerId: "customer_demo_1",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    });
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("prisma customer asset upload persists selected conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const { prisma, calls } = createPrismaHarness();
  const assets = new AssetsService(prisma, {}, createStorageHarness());

  try {
    await assets.upload({
      ownerType: "customer",
      ownerId: "customer_demo_1",
      role: "customer_logo",
      expectedWechatAccountId: "wechat_demo_1",
      expectedConversationId: "conversation_demo_1",
      expectedCustomerId: "customer_demo_1",
      fileName: "logo.png",
      mimeType: "image/png",
      base64: "AAAA",
    });

    const createCall = calls.find((call) => call.model === "designAsset.create");
    assert.deepEqual(createCall.data, {
      ownerType: "customer",
      ownerId: "customer_demo_1",
      role: "customer_logo",
      fileName: "logo.png",
      mimeType: "image/png",
      localPath: "C:\\storage\\customer-logo.png",
      sizeBytes: 12,
      source: "manual_upload",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    });
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("prisma customer asset upload rejects mismatched conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const { prisma } = createPrismaHarness();
  const assets = new AssetsService(prisma, {}, createStorageHarness());

  try {
    await assert.rejects(
      () =>
        assets.upload({
          ownerType: "customer",
          ownerId: "customer_demo_1",
          expectedWechatAccountId: "wechat_demo_1",
          expectedConversationId: "conversation_demo_2",
          expectedCustomerId: "customer_demo_1",
          fileName: "logo.png",
          mimeType: "image/png",
          base64: "AAAA",
        }),
      /customer asset conversation identity mismatch/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("prisma local customer asset read rejects another conversation identity", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  const { prisma } = createPrismaHarness();
  const assets = new AssetsService(prisma, {}, createStorageHarness());

  try {
    await assert.rejects(
      () =>
        assets.readLocalAsset("C:\\storage\\customer-logo.png", {
          expectedWechatAccountId: "wechat_demo_2",
          expectedConversationId: "conversation_demo_2",
          expectedCustomerId: "customer_demo_2",
        }),
      /local asset owner identity mismatch/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
