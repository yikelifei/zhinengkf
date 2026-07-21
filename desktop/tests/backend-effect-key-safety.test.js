"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { acquireLocalStoreLock, LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

const identity = {
  wechatAccountId: "wechat_demo_1",
  conversationId: "conversation_demo_1",
  customerId: "customer_demo_1",
};

function createStore(filePath) {
  const store = new LocalStoreService();
  store.filePath = filePath;
  return store;
}

function createOrderFixture(store) {
  const job = store.createDesignJob({
    ...identity,
    requestId: `effect-key-job-${Date.now()}-${Math.random()}`,
    status: "sent",
    budget: { quantity: 1 },
    bundle: { items: [{ skuCode: "SAFE", costPrice: 10, salePrice: 20 }] },
  });
  const [image] = store.upsertDesignImages(job.id, [{ imageId: "effect-key-image", position: 1 }]);
  const quote = store.createQuoteFromDesignJob(job.id, image.id);
  const order = store.upsertOrderDraftFromQuote(quote.id, {
    quoteDraftId: quote.id,
    designJobId: job.id,
    customerId: identity.customerId,
    conversationId: identity.conversationId,
    wechatAccountId: identity.wechatAccountId,
    selectedImageId: image.id,
    quantity: 1,
    unitPrice: 20,
    totalPrice: 20,
    totalCost: 10,
    profit: 10,
    status: "draft",
    paymentStatus: "unpaid",
  });
  return { job, image, quote, order };
}

test("stale lock takeover never lets the old owner remove the new owner's lock", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-owner-lock-"));
  const filePath = path.join(tempDir, "local-store.json");
  const lockPath = `${filePath}.lock`;
  const lockA = acquireLocalStoreLock(filePath);
  const oldTime = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, oldTime, oldTime);

  const lockB = acquireLocalStoreLock(filePath);
  const ownerBeforeStaleRelease = fs.readdirSync(lockPath);
  assert.equal(ownerBeforeStaleRelease.length, 1);
  assert.throws(() => lockA.assertOwned(), /lock ownership was lost/);
  lockA.release();
  assert.equal(fs.existsSync(lockPath), true);
  assert.deepEqual(fs.readdirSync(lockPath), ownerBeforeStaleRelease);
  lockB.assertOwned();
  lockB.release();
  assert.equal(fs.existsSync(lockPath), false);
});

test("two LocalStore instances fence owner A after owner B reclaims the inbound lease", () => {
  appConfig.useLocalStore = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-stale-writer-"));
  const filePath = path.join(tempDir, "local-store.json");
  const storeA = createStore(filePath);
  const { quote } = createOrderFixture(storeA);
  const claimedA = storeA.claimInboundMessageOperation({
    id: "two-instance-stale-writer-operation",
    source: "wechat",
    wechatAccountId: identity.wechatAccountId,
    conversationId: identity.conversationId,
    customerId: identity.customerId,
    externalId: "two-instance-stale-writer-event",
    requestFingerprint: "two-instance-stale-writer-fingerprint",
    normalizedPayload: { text: "accept quote" },
    claimToken: "owner-a",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).operation;

  const expired = JSON.parse(fs.readFileSync(filePath, "utf8"));
  expired.inboundMessageOperations.find((item) => item.id === claimedA.id).leaseExpiresAt =
    new Date(Date.now() - 1_000).toISOString();
  fs.writeFileSync(filePath, JSON.stringify(expired, null, 2));

  const storeB = createStore(filePath);
  const claimedB = storeB.claimInboundMessageOperation({
    source: "wechat",
    wechatAccountId: identity.wechatAccountId,
    conversationId: identity.conversationId,
    customerId: identity.customerId,
    externalId: "two-instance-stale-writer-event",
    requestFingerprint: "two-instance-stale-writer-fingerprint",
    normalizedPayload: { text: "accept quote" },
    claimToken: "owner-b",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).operation;
  assert.equal(claimedB.claimToken, "owner-b");

  assert.throws(
    () => storeA.commitInboundQuoteAcceptance({
      operationId: claimedA.id,
      claimToken: "owner-a",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      quoteDraftId: quote.id,
      quotePatch: { status: "accepted" },
      action: "accept_quote_and_create_order",
      recoveryEffect: { action: "accept_quote_and_create_order" },
    }),
    /lease changed before quote acceptance commit/,
  );
  const finalStore = createStore(filePath);
  const finalOperation = finalStore.getInboundMessageOperation(identity.wechatAccountId, "two-instance-stale-writer-event");
  assert.equal(finalOperation.claimToken, "owner-b");
  assert.notEqual(finalStore.getQuoteDraft(quote.id).status, "accepted");
});

test("public order update rejects notification effect-key injection and exact local replay rejects a victim payload", async () => {
  appConfig.useLocalStore = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notification-victim-key-"));
  const store = createStore(path.join(tempDir, "local-store.json"));
  const notifications = new NotificationsService({}, store);
  const orders = new OrdersService({}, store, notifications);
  const { order } = createOrderFixture(store);
  const victimKey = "victim-notification-effect-key-0001";
  const victim = notifications.create("warning", "victim", "must survive", {
    effectKey: victimKey,
    ...identity,
    orderDraftId: "another-order",
  });

  await assert.rejects(
    () => orders.update(order.id, {
      ...{
        expectedWechatAccountId: identity.wechatAccountId,
        expectedConversationId: identity.conversationId,
        expectedCustomerId: identity.customerId,
      },
      customerNotes: "attempted injection",
      notificationEffectKey: victimKey,
    }),
    /notificationEffectKey is reserved for trusted automation/,
  );
  assert.equal(store.getOrderDraft(order.id).customerNotes || "", "");
  assert.equal(store.listNotifications().find((item) => item.id === victim.id).body, "must survive");
  assert.throws(
    () => notifications.create("warning", "victim", "changed payload", {
      effectKey: victimKey,
      ...identity,
      orderDraftId: order.id,
    }),
    /notification effectKey replay changed identity or business payload/,
  );
});

test("order controller forwards only its explicit public update whitelist", () => {
  const source = fs.readFileSync(path.join(__dirname, "../apps/api/src/orders/orders.controller.ts"), "utf8");
  const updateSection = source.slice(source.indexOf('  @Post(":id/update")'), source.indexOf('  @Post(":id/revise-selection")'));
  assert.match(updateSection, /status: payload\?\.status/);
  assert.match(updateSection, /customerNotes: payload\?\.customerNotes/);
  assert.match(updateSection, /expectedWechatAccountId: payload\?\.expectedWechatAccountId/);
  assert.match(updateSection, /expectedConversationId: payload\?\.expectedConversationId/);
  assert.match(updateSection, /expectedCustomerId: payload\?\.expectedCustomerId/);
  assert.doesNotMatch(updateSection, /\.\.\.payload|notificationEffectKey/);
});

test("Prisma notification effect-key hit validates identity and business payload without a database", async () => {
  const previousLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const existing = {
      id: "notice-existing",
      level: "info",
      title: "order updated",
      body: "original body",
      target: { effectKey: "prisma-effect-key-0001", ...identity, orderDraftId: "order-a" },
    };
    const service = new NotificationsService(
      { notification: { findUnique: async () => existing, create: async () => { throw new Error("must not create"); } } },
      {},
    );
    await assert.rejects(
      () => service.create("info", "order updated", "changed body", {
        effectKey: "prisma-effect-key-0001",
        ...identity,
        orderDraftId: "order-b",
      }),
      /notification effectKey replay changed identity or business payload/,
    );
  } finally {
    appConfig.useLocalStore = previousLocalStore;
  }
});
