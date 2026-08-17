"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.USE_LOCAL_STORE = "false";
process.env.DESIGN_PLATFORM_ADAPTER = "art_image_local";
process.env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3300";

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");

test("quick confirm persists only schema-backed fields in Prisma mode", async () => {
  const updates = [];
  const job = {
    id: "design_prisma_1",
    requestId: "request_prisma_1",
    status: "quick_confirm",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    images: [1, 2, 3, 4].map((position) => ({
      id: `image_prisma_${position}`,
      imageId: `candidate_${position}`,
      position,
      localPath: `C:\\storage\\design-jobs\\design_prisma_1\\candidate_${position}.png`,
    })),
  };
  const prisma = {
    designJob: {
      findUnique: async () => job,
      update: async (payload) => {
        updates.push(payload);
        return { ...job, ...payload.data };
      },
    },
  };
  const service = new DesignJobsService(
    prisma,
    {},
    {},
    { create: async () => ({}) },
    {},
    { enqueueDesignImages: async () => ({ id: "send_prisma_1" }) },
    {},
    {},
    {},
  );

  const sendTask = await service.quickConfirmAndQueueSend(job.id);

  assert.equal(sendTask.id, "send_prisma_1");
  assert.deepEqual(updates, [{ where: { id: job.id }, data: { status: "sent" } }]);
});
