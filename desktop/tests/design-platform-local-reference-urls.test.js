"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignPlatformClient } = require("../apps/api/src/integrations/design-platform/design-platform.client");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("art image local status cannot use process memory and requires durable execution", async () => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";

  try {
    const client = new DesignPlatformClient();
    await assert.rejects(
      () => client.getDesignJobResults("art_lost_after_restart_1"),
      /must be read from durable execution/,
    );
  } finally {
    appConfig.designPlatformAdapter = previousAdapter;
  }
});

test("art image local request accepts loopback local asset references and enforces four candidates", async () => {
  const client = new DesignPlatformClient();
  const request = await client.buildArtImageLocalRequest({
    requestId: "request-loopback-refs",
    customerId: "customer-1",
    conversationId: "conversation-1",
    budget: { mode: "per_box", amount: 200, quantity: 50 },
    scene: "employee gifts",
    customerText: "need a real gift box render",
    bundle: {
      giftBox: {
        skuCode: "BOX-A",
        name: "Box A",
        mainImageUrl: "http://127.0.0.1:3000/local-assets/box-a.png",
      },
      items: [
        {
          skuCode: "TEA-A",
          name: "Tea A",
          imageUrl: "http://localhost:3000/generated/tea-a.png",
        },
      ],
    },
    assets: [
      {
        assetId: "customer-logo",
        remoteAssetId: "http://127.0.0.1:3000/local-assets/customer-logo.png",
      },
    ],
    outputCount: 6,
    renderStyle: "real product photo",
    requirements: { useRealSkuImages: true },
  });

  assert.equal(request.count, 4);
  assert.equal(request.concurrency, 4);
  assert.ok(request.objectRefs.includes("http://127.0.0.1:3000/local-assets/customer-logo.png"));
  assert.ok(request.objectRefs.includes("http://127.0.0.1:3000/local-assets/box-a.png"));
  assert.ok(request.objectRefs.includes("http://localhost:3000/generated/tea-a.png"));
});

test("art image local request still rejects non-loopback http references", async () => {
  const client = new DesignPlatformClient();

  await assert.rejects(
    () =>
      client.buildArtImageLocalRequest({
        requestId: "request-remote-http-refs",
        customerId: "customer-1",
        conversationId: "conversation-1",
        budget: { mode: "per_box", amount: 200, quantity: 50 },
        bundle: {
          giftBox: {
            skuCode: "BOX-A",
            mainImageUrl: "http://example.test/local-assets/box-a.png",
          },
          items: [
            {
              skuCode: "TEA-A",
              imageUrl: "http://example.test/generated/tea-a.png",
            },
          ],
        },
        assets: [{ assetId: "customer-logo", remoteAssetId: "http://example.test/local-assets/logo.png" }],
        outputCount: 6,
        renderStyle: "real product photo",
        requirements: { useRealSkuImages: true },
      }),
    /customer reference image is required|SKU or gift-box image is required|every SKU/,
  );
});
