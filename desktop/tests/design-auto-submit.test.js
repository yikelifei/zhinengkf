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

test("allows a reference-free Zhenxi image request and still requires four outputs", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_zhenxi_image",
    status: "draft",
    isHighValue: false,
    budget: {},
    bundle: {},
    designType: "zhenxi_image",
    customerText: "生成一套夏日饮品活动海报设计",
    outputCount: 4,
    requirements: { useRealSkuImages: false, zhenxi: { module: "image" } },
    assets: [],
  }, { zhenxiGenerationEnabled: true });
  assert.equal(decision.ok, true);
  assert.equal(decision.action, "submit");
});

test("blocks a real-product Zhenxi poster before paid generation when no real product source exists", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_zhenxi_product_missing",
    status: "draft",
    isHighValue: false,
    budget: {},
    bundle: { items: [] },
    designType: "zhenxi_image",
    customerText: "生成酒店开业伴手礼商品海报",
    outputCount: 4,
    requirements: {
      useRealSkuImages: true,
      zhenxi: { module: "image", visualContentMode: "real_product" },
    },
    assets: [],
  }, { zhenxiGenerationEnabled: true });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_usable_real_images");
  assert.deepEqual(decision.missing, ["product_assets_or_selection"]);
});

test("allows a real-product Zhenxi poster only when the selected bundle has usable product images", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_zhenxi_product_ready",
    status: "draft",
    isHighValue: false,
    budget: {},
    bundle: { items: [{ skuCode: "GIFT-01", imageUrl: "https://assets.example.test/gift-01.png" }] },
    designType: "zhenxi_image",
    customerText: "生成酒店开业伴手礼商品海报",
    outputCount: 4,
    requirements: {
      useRealSkuImages: true,
      zhenxi: { module: "image", visualContentMode: "real_product" },
    },
    assets: [],
  }, { zhenxiGenerationEnabled: true });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "submit");
});

test("keeps Zhenxi image jobs queued while the Zhenxi adapter is not ready", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_zhenxi_waiting",
    status: "draft",
    designType: "zhenxi_image",
    outputCount: 4,
    customerText: "做四张海报",
    requirements: { useRealSkuImages: false },
    assets: [],
  }, { zhenxiGenerationEnabled: false });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "zhenxi_generation_not_ready");
});

test("keeps Zhenxi copy jobs out of the image submitter", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_zhenxi_copy",
    status: "draft",
    designType: "zhenxi_copy_video_script",
    customerText: "写一份短视频脚本",
    outputCount: 1,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "handled_by_zhenxi_copy_automation");
});

test("Zhenxi copy automation persists and queues the generated customer reply", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.useLocalStore = true;
  appConfig.designPlatformAdapter = "zhenxi_external";
  let job = {
    id: "zhenxi_copy_job_1",
    requestId: "zhenxi_copy_request_1",
    status: "draft",
    designType: "zhenxi_copy_video_script",
    conversationId: "conversation_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    customerText: "写一份30秒新品介绍视频脚本",
    requirements: { zhenxi: { module: "video_script", prompt: "写一份30秒新品介绍视频脚本" } },
  };
  const sent = [];
  const localStore = {
    listDesignJobs: () => [job],
    listConversations: () => [{ id: "conversation_1", manualLocked: false }],
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
  };
  const service = new DesignJobsService(
    {},
    { generateZhenxiCopy: async (input) => ({ status: "completed", prompts: ["真实视频脚本"], selectedPrompt: "真实视频脚本", requestId: input.requestId }) },
    localStore,
    { create: async () => ({}) },
    {},
    { enqueueTextMessage: async (payload) => { sent.push(payload); return payload; } },
    {},
    {},
    {},
  );
  try {
    const result = await service.scanZhenxiCopyDrafts();
    assert.equal(result.completed.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(job.status, "completed");
    assert.equal(job.requirements.zhenxi.result.selectedPrompt, "真实视频脚本");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, "真实视频脚本");
    assert.equal(sent[0].reason, "zhenxi-copy-result");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.designPlatformAdapter = previousAdapter;
  }
});

test("outcome-unknown Zhenxi copy is fenced from automatic retry", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.useLocalStore = true;
  appConfig.designPlatformAdapter = "zhenxi_external";
  let calls = 0;
  let job = {
    id: "zhenxi_copy_job_unknown",
    requestId: "zhenxi_copy_request_unknown",
    status: "draft",
    designType: "zhenxi_copy_xiaohongshu",
    conversationId: "conversation_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    customerText: "写一篇小红书文案",
    requirements: { zhenxi: { module: "xiaohongshu", prompt: "写一篇小红书文案" } },
  };
  const localStore = {
    listDesignJobs: () => [job],
    listConversations: () => [{ id: "conversation_1", manualLocked: false }],
    updateDesignJob: (id, patch) => { job = { ...job, ...patch }; return job; },
  };
  const service = new DesignJobsService(
    {},
    { generateZhenxiCopy: async (input) => { calls += 1; return { status: "outcome_unknown", prompts: [], requestId: input.requestId, errorCode: "TRANSPORT", errorMessage: "unknown" }; } },
    localStore,
    { create: async () => ({}) },
    {},
    { enqueueTextMessage: async () => assert.fail("unknown copy must not be sent") },
    {},
    {},
    {},
  );
  try {
    const first = await service.scanZhenxiCopyDrafts();
    const second = await service.scanZhenxiCopyDrafts();
    assert.equal(first.outcomeUnknown.length, 1);
    assert.equal(second.scanned, 0);
    assert.equal(calls, 1);
    assert.equal(job.status, "manual_review");
    assert.equal(job.submitDispatchStatus, "outcome_unknown");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.designPlatformAdapter = previousAdapter;
  }
});

test("local Zhenxi customer tool lane submits and queues one four-image result exactly once", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.useLocalStore = true;
  appConfig.designPlatformAdapter = "art_image_local";
  let submitCalls = 0;
  let imageQueueCalls = 0;
  let job = {
    id: "zhenxi_image_fast_lane_1",
    requestId: "zhenxi_image_fast_lane_request_1",
    status: "draft",
    designType: "zhenxi_image",
    outputCount: 4,
    isHighValue: false,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
    customerText: "生成四张教师节贺卡效果图",
    budget: {},
    bundle: {},
    requirements: { useRealSkuImages: false, zhenxi: { module: "image" } },
    assets: [],
    images: [],
    conversation: { id: "conversation_1", manualLocked: false },
  };
  const localStore = {
    listDesignJobs: () => [job],
    listConversations: () => [job.conversation],
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {},
    {},
    {},
    {},
    {},
  );
  service.submit = async (id, payload) => {
    submitCalls += 1;
    assert.equal(id, job.id);
    assert.match(payload.operationKey, /^design-auto-submit:[a-f0-9]{64}$/);
    job = {
      ...job,
      status: "quick_confirm",
      images: Array.from({ length: 4 }, (_, index) => ({
        id: `image_${index + 1}`,
        localPath: `E:\\safe-test-output\\image_${index + 1}.png`,
      })),
    };
    return job;
  };
  service.quickConfirmAndQueueSend = async (id) => {
    imageQueueCalls += 1;
    assert.equal(id, job.id);
    job = { ...job, status: "completed", sendTaskId: "send_zhenxi_image_1" };
    return {
      designJob: job,
      sendTaskId: job.sendTaskId,
      wechatAccountId: job.wechatAccountId,
      conversationId: job.conversationId,
      customerId: job.customerId,
    };
  };

  try {
    const first = await service.runCustomerToolAutomation();
    const second = await service.runCustomerToolAutomation();

    assert.equal(first.autoSubmit.submitted.length, 1);
    assert.equal(first.imageSend.queued.length, 1);
    assert.equal(second.autoSubmit.submitted.length, 0);
    assert.equal(second.imageSend.queued.length, 0);
    assert.equal(submitCalls, 1);
    assert.equal(imageQueueCalls, 1);
    assert.equal(job.status, "completed");
    assert.equal(job.images.length, 4);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.designPlatformAdapter = previousAdapter;
  }
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

test("skips draft when formal output count is outside the safe range", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "employee gift",
    outputCount: 3,
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "output_count_below_minimum");
  assert.deepEqual(decision.missing, ["outputCount"]);
});

test("low-value automation submits complete draft to design platform with customer and sku assets", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  const previousPublicBaseUrl = appConfig.customerServicePublicBaseUrl;
  const previousCallbackApiKey = appConfig.callbackApiKey;
  const previousCallbackUrl = appConfig.designPlatformCallbackUrl;
  appConfig.useLocalStore = true;
  appConfig.designPlatformAdapter = "standard_v1";
  appConfig.customerServicePublicBaseUrl = "http://127.0.0.1:3200";
  appConfig.callbackApiKey = "callback-secret";
  appConfig.designPlatformCallbackUrl = "";

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
    outputCount: 4,
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
    beginDesignJobSubmitOperation: ({ operationKey, requestFingerprint, operationIdentity }) => {
      if (!job.submitOperationKey) {
        job = {
          ...job,
          submitOperationKey: operationKey,
          submitRequestFingerprint: requestFingerprint,
          submitOperationIdentity: operationIdentity,
          submitDispatchStatus: "prepared",
        };
        return { job, created: true };
      }
      return { job, created: false };
    },
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
    assert.equal(createPayloads[0].outputCount, 4);
    assert.equal(createPayloads[0].requirements.useRealSkuImages, true);
    assert.equal(createPayloads[0].callback.url, "http://127.0.0.1:3200/api/integrations/design-platform/callback");
    assert.equal(createPayloads[0].callback.method, "POST");
    assert.deepEqual(createPayloads[0].callback.events, ["completed", "failed"]);
    assert.equal(createPayloads[0].callback.requestId, "request_low_value_submit");
    assert.equal(createPayloads[0].callback.fallbackPolling, true);
    assert.equal(createPayloads[0].callback.headers.Authorization, "Bearer callback-secret");
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
    appConfig.customerServicePublicBaseUrl = previousPublicBaseUrl;
    appConfig.callbackApiKey = previousCallbackApiKey;
    appConfig.designPlatformCallbackUrl = previousCallbackUrl;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
