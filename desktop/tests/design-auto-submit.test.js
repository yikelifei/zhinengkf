"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { evaluateDesignAutoSubmit } = require("../packages/rules");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("allows complete low-value draft to auto submit", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "员工福利",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "submit");
});

test("skips high-value draft", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: true,
    budget: { totalAmount: 30000, quantity: 100 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "企业礼赠",
    assets: [{ id: "asset_1" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("skips high-value budget draft even when flag is stale", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { totalAmount: 12000, quantity: 80 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "enterprise gift",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("skips draft when conversation is manually locked", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    conversation: { manualLocked: true },
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    scene: "员工福利",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "conversation_manual_locked");
});

test("skips draft without real assets", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    scene: "员工福利",
    assets: [],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.missing.includes("assets"), true);
});

test("skips draft when customer asset has no usable image reference", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "employee gift",
    assets: [{ id: "asset_1", fileName: "logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_usable_real_images");
  assert.equal(decision.missing.includes("customer_assets"), true);
});

test("skips draft when bundle sku image is missing", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    scene: "employee gift",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_usable_real_images");
  assert.equal(decision.missing.includes("complete_sku_images"), true);
});

test("skips draft when recommended bundle is not automation ready", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: {
      items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }],
      automation: { ready: false, blockers: ["low_margin", "size_unknown"] },
    },
    designType: "bundle_render",
    scene: "employee gift",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "bundle_automation_not_ready");
  assert.deepEqual(decision.missing, ["low_margin", "size_unknown"]);
});

test("low-value automation submits complete draft to design platform with customer and sku assets", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.useLocalStore = true;
  appConfig.designPlatformAdapter = "standard_v1";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhinengkefu-auto-submit-"));
  const customerLogoPath = path.join(tmpDir, "customer-logo.png");
  const giftBoxPath = path.join(tmpDir, "gift-box.png");
  const teaPath = path.join(tmpDir, "tea.png");
  fs.writeFileSync(customerLogoPath, Buffer.from("customer logo"));
  fs.writeFileSync(giftBoxPath, Buffer.from("gift box"));
  fs.writeFileSync(teaPath, Buffer.from("tea"));

  const createPayloads = [];
  const uploadedAssets = [];
  const textMessages = [];
  let scheduledPoll = null;
  let job = {
    id: "design_low_value_submit",
    requestId: "request_low_value_submit",
    status: "draft",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    orderId: "order_draft_1",
    isHighValue: false,
    conversation: { id: "conversation_1", manualLocked: false },
    budget: {
      mode: "per_box",
      perUnitAmount: 180,
      quantity: 20,
      totalAmount: 3600,
    },
    scene: "员工福利",
    customerText: "想看一套公司员工福利礼盒效果图，要显得有品质但不要太贵。",
    designType: "bundle_render",
    outputCount: 6,
    renderStyle: "真实产品摆拍",
    requirements: {
      useRealSkuImages: true,
      showAllItems: true,
      noWatermark: true,
      highResolution: true,
    },
    bundle: {
      giftBox: {
        skuCode: "BOX-A",
        name: "红色商务礼盒",
        mainImagePath: giftBoxPath,
      },
      items: [
        {
          skuCode: "TEA-A",
          name: "精品茶叶",
          mainImagePath: teaPath,
          salePrice: 98,
          costPrice: 45,
          stock: 100,
        },
      ],
      automation: {
        ready: true,
        blockers: [],
      },
    },
    assets: [
      {
        id: "asset_customer_logo",
        fileName: "customer-logo.png",
        mimeType: "image/png",
        localPath: customerLogoPath,
        role: "customer_logo",
        ownerType: "customer",
        ownerId: "customer_1",
      },
    ],
    images: [],
  };

  const localStore = {
    getDesignJob: (id) => (id === job.id ? job : null),
    listDesignJobs: () => [job],
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
  };

  const service = new DesignJobsService(
    {},
    {
      uploadAsset: async (asset) => {
        uploadedAssets.push(asset);
        return {
          assetId: `remote_${asset.assetId}`,
          url: `https://design-platform.test/assets/${asset.fileName}`,
        };
      },
      createDesignJob: async (payload) => {
        createPayloads.push(payload);
        return { externalJobId: "external_low_value_1" };
      },
    },
    localStore,
    { create: async () => ({}) },
    {},
    {
      enqueueTextMessage: async (payload) => {
        textMessages.push(payload);
        return { id: "send_waiting_1", payload };
      },
      scanLowValueOrderConfirmations: async () => ({ scanned: 0, queued: [], skipped: [], failed: [] }),
      scanLowValueOrderFollowups: async () => ({ scanned: 0, queued: [], skipped: [], failed: [] }),
    },
    {
      scanLowValueAutoQuoteSends: async () => ({ scanned: 0, queued: [], skipped: [], failed: [] }),
    },
    {
      scanLowValueAutoOrderDrafts: async () => ({ scanned: 0, created: [], skipped: [], failed: [] }),
    },
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.scheduleResultPoll = (requestId, externalJobId) => {
    scheduledPoll = { requestId, externalJobId };
  };

  try {
    const result = await service.runLowValueAutomation();

    assert.equal(result.autoSubmit.submitted.length, 1);
    assert.equal(result.autoSubmit.failed.length, 0);
    assert.equal(job.status, "submitted");
    assert.equal(job.externalJobId, "external_low_value_1");
    assert.equal(createPayloads.length, 1);
    assert.equal(createPayloads[0].requestId, "request_low_value_submit");
    assert.equal(createPayloads[0].wechatAccountId, "wechat_1");
    assert.equal(createPayloads[0].customerId, "customer_1");
    assert.equal(createPayloads[0].conversationId, "conversation_1");
    assert.equal(createPayloads[0].outputCount, 6);
    assert.equal(createPayloads[0].requirements.useRealSkuImages, true);
    assert.deepEqual(
      uploadedAssets.map((asset) => asset.role).sort(),
      ["customer_logo", "gift_box", "sku_image"],
    );
    assert.deepEqual(
      createPayloads[0].assets.map((asset) => asset.role).sort(),
      ["customer_logo", "gift_box", "sku_image"],
    );
    assert.equal(textMessages.length, 1);
    assert.equal(textMessages[0].wechatAccountId, "wechat_1");
    assert.equal(textMessages[0].conversationId, "conversation_1");
    assert.equal(textMessages[0].reason, "design-waiting-message");
    assert.deepEqual(scheduledPoll, {
      requestId: "request_low_value_submit",
      externalJobId: "external_low_value_1",
    });
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.designPlatformAdapter = previousAdapter;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
