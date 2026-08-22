"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { normalizeWechatWorkQueuedMessagesFromTaskPayload } = require("../apps/api/src/wechat-work/wechat-work-outbound-message");

function setup(t) {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "customer-selection-page-delivery-"));
  appConfig.useLocalStore = true;
  appConfig.localStorageRoot = path.join(__dirname, "..", ".runtime-stable", "storage");
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });
  const store = new LocalStoreService();
  store.filePath = path.join(temporaryRoot, "local-store.json");
  const notifications = new NotificationsService({}, store);
  const orders = new OrdersService({}, store, notifications);
  const service = new WechatDispatchService({}, store, {}, notifications, orders);
  const binding = store.upsertWechatWorkBinding({
    openKfid: "wk-customer-selection-pages",
    externalUserId: "wm-customer-selection-pages",
  });
  return { store, service, binding };
}

test("inbound flow sends one deck, then sends three real page screenshots on recommendation follow-up", async (t) => {
  const { service, binding } = setup(t);
  const identity = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  };
  const first = await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-deck-first",
    text: "美容院开业，每份60元，发我看看方案",
  });
  assert.equal(first.route.replyDraft.customerSelectionMaterial.material.id, "beauty_50_80_2026");
  assert.equal(first.sendTask.payload.kind, "customer_selection_material");
  assert.equal(first.sendTask.payload.filePaths.length, 1);
  assert.equal(fs.existsSync(first.sendTask.payload.filePaths[0]), true);

  const followup = await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-pages-followup",
    text: "帮我推荐三个有护手霜和香薰的精致款",
  });
  assert.equal(followup.route.replyDraft.customerSelectionPages.status, "matched");
  assert.equal(followup.route.replyDraft.customerSelectionPages.material.id, "beauty_50_80_2026");
  assert.equal(followup.sendTask.payload.kind, "material_page_recommendations");
  assert.equal(followup.sendTask.payload.imagePaths.length, 3);
  assert.equal(followup.sendTask.payload.imagePaths.every((filePath) => fs.existsSync(filePath)), true);
  assert.deepEqual(followup.sendTask.payload.customerSelectionPageNumbers.length, 3);

  const officialMessages = normalizeWechatWorkQueuedMessagesFromTaskPayload(followup.sendTask.payload);
  assert.equal(officialMessages.length, 4);
  assert.equal(officialMessages[0].msgtype, "text");
  assert.deepEqual(officialMessages.slice(1).map((message) => message.msgtype), ["image", "image", "image"]);
  assert.equal(officialMessages.slice(1).every((message) => fs.existsSync(message.mediaPath)), true);

  const quote = await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-page-quote",
    text: "第二个要200份，一共多少钱",
  });
  assert.equal(quote.route.replyDraft.customerSelectionPageQuote.status, "matched");
  assert.equal(quote.route.replyDraft.customerSelectionPageQuote.page.pageNumber, 14);
  assert.equal(quote.sendTask.payload.kind, "text");
  assert.match(quote.sendTask.payload.text, /56 元\/份/);
  assert.match(quote.sendTask.payload.text, /200 份合计 11200 元/);
  assert.equal(Array.isArray(quote.sendTask.payload.imagePaths), false);

  const quantityOnlyFollowup = await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-page-quote-chinese-quantity-followup",
    text: "那就两百份",
  });
  assert.equal(quantityOnlyFollowup.route.replyDraft.customerSelectionPageQuote.status, "matched");
  assert.equal(quantityOnlyFollowup.route.replyDraft.customerSelectionPageQuote.page.pageNumber, 14);
  assert.equal(quantityOnlyFollowup.route.replyDraft.customerSelectionPageQuote.quantity, 200);
  assert.match(quantityOnlyFollowup.sendTask.payload.text, /200 份合计 11200 元/);
});

test("multi-turn quote keeps only the two selected pages for a later shared quantity", async (t) => {
  const { service, binding } = setup(t);
  const identity = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  };
  await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-multi-deck",
    text: "美容院开业，每份60元，发我看看方案",
  });
  await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-multi-pages",
    text: "帮我推荐三个有护手霜和香薰的精致款",
  });
  const priceList = await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-multi-price-list",
    text: "第二个和第三个分别多少钱",
  });
  assert.equal(priceList.route.replyDraft.customerSelectionPageQuote.status, "matched_multiple");
  assert.deepEqual(priceList.route.replyDraft.customerSelectionPageQuote.pages.map((page) => page.pageNumber), [14, 6]);

  const sharedQuantity = await service.processInboundMessage({
    ...identity,
    externalId: "customer-selection-multi-shared-quantity",
    text: "各两百份",
  });
  assert.equal(sharedQuantity.route.replyDraft.customerSelectionPageQuote.status, "matched_multiple");
  assert.deepEqual(sharedQuantity.route.replyDraft.customerSelectionPageQuote.pages.map((page) => page.pageNumber), [14, 6]);
  assert.deepEqual(sharedQuantity.route.replyDraft.customerSelectionPageQuote.pages.map((page) => page.totalAmount), [11200, 10400]);
  assert.equal(sharedQuantity.sendTask.payload.kind, "text");
  assert.match(sharedQuantity.sendTask.payload.text, /11200 元/);
  assert.match(sharedQuantity.sendTask.payload.text, /10400 元/);
});
