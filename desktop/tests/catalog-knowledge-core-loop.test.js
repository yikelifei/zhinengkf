"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const {
  knowledgeCreateBlockers,
  knowledgeCreateRow,
} = require("../apps/web/src/features/training/training-knowledge-page");
const {
  validateImageFile,
} = require("../apps/web/src/features/catalog/catalog-product-editor-page");
const {
  buildBundleDesignJobPayload,
} = require("../apps/web/src/features/catalog/catalog-bundle-design-handoff");

test("knowledge console creates one reviewed row through the existing import contract", () => {
  const draft = {
    agentId: "agent-pre-sales",
    title: "报价前确认信息",
    content: "客户咨询报价时，先确认商品、数量、预算、交期和是否需要企业定制，再由人工确认正式价格。",
    tags: "报价、预算、交期",
    qualityScore: "88",
  };
  const agents = [{ id: "agent-pre-sales", key: "pre_sales", name: "售前转化 Agent" }];

  assert.deepEqual(knowledgeCreateBlockers(draft), []);
  assert.deepEqual(knowledgeCreateRow(draft, agents), {
    title: draft.title,
    content: draft.content,
    agentId: "agent-pre-sales",
    agentKey: "pre_sales",
    tags: ["报价", "预算", "交期"],
    qualityScore: 88,
  });

  const source = read("apps/web/src/features/training/training-knowledge-page.tsx");
  assert.match(source, /importKnowledgeText/);
  assert.match(source, /training\.knowledge\.create\.confirm/);
  assert.match(source, /先进入复核状态/);
});

test("knowledge console blocks incomplete business knowledge", () => {
  const blockers = knowledgeCreateBlockers({
    agentId: "",
    title: "",
    content: "太短",
    tags: "",
    qualityScore: "120",
  });
  assert.deepEqual(blockers, ["请选择 Agent", "请填写标题", "正文至少 20 个字", "请填写场景标签", "质量分必须为 0-100"]);
});

test("catalog editor accepts only bounded raster product images", () => {
  assert.equal(validateImageFile({ name: "product.webp", type: "image/webp", size: 1024 }), "");
  assert.match(validateImageFile({ name: "product.svg", type: "image/svg+xml", size: 1024 }), /不是支持的/);
  assert.match(validateImageFile({ name: "huge.jpg", type: "image/jpeg", size: 11 * 1024 * 1024 }), /不超过 10 MB/);

  const source = read("apps/web/src/features/catalog/catalog-product-editor-page.tsx");
  assert.match(source, /uploadAsset/);
  assert.match(source, /ownerType:\s*"sku"/);
  assert.match(source, /catalog-product-editor-main-image-file/);
  assert.match(source, /mainAsset\?\.localPath/);
});

test("bundle recommendation can be persisted as a real conversation-bound design draft", () => {
  const payload = buildBundleDesignJobPayload(
    {
      scene: "员工福利",
      quantity: "50",
      perUnitAmount: "200",
      totalAmount: "10000",
      maxItems: "6",
      selectedSkuCodes: ["BOX-1", "TEA-1"],
    },
    {
      status: "ready",
      items: [
        { skuCode: "BOX-1", name: "礼盒", type: "gift_box", salePrice: 80 },
        { skuCode: "TEA-1", name: "茶叶", type: "item", salePrice: 120 },
      ],
      totals: { cost: 100, salePrice: 200, profit: 100, profitRate: 0.5 },
      warnings: [],
    },
    {
      id: "conversation-1",
      title: "客户会话",
      channel: "work_wechat",
      customerId: "customer-1",
      wechatAccountId: "account-1",
    },
    "operation-1",
    "asset-customer-1",
  );

  assert.equal(payload.operationKey, "operation-1");
  assert.equal(payload.conversationId, "conversation-1");
  assert.equal(payload.customerId, "customer-1");
  assert.equal(payload.wechatAccountId, "account-1");
  assert.equal(payload.bundle.giftBox.skuCode, "BOX-1");
  assert.deepEqual(payload.bundle.selectedSkuCodes, ["BOX-1", "TEA-1"]);
  assert.equal(payload.budget.totalAmount, 10000);
  assert.deepEqual(payload.assetIds, ["asset-customer-1"]);

  const source = read("apps/web/src/features/catalog/catalog-bundle-design-handoff.tsx");
  assert.match(source, /getWechatConversations/);
  assert.match(source, /createDesignJob/);
  assert.match(source, /catalog-bundles-save-design-draft/);
  assert.match(source, /catalog-bundles-customer-asset/);
  assert.match(source, /getAssets\("customer", conversation\.customerId/);
  assert.match(source, /uploadAsset\(\{/);
  assert.match(source, /source: "catalog_bundle_handoff"/);
  assert.match(source, /catalog-bundles-upload-customer-asset/);
  assert.match(source, /不会自动出图、报价或发送/);
});
