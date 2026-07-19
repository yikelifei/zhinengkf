const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatPersistence } = require("../apps/api/src/wechat/wechat-persistence");

const desktopRoot = path.resolve(__dirname, "..");
const service = fs.readFileSync(
  path.join(desktopRoot, "apps/api/src/wechat/wechat-dispatch.service.ts"),
  "utf8",
);
const persistence = fs.readFileSync(
  path.join(desktopRoot, "apps/api/src/wechat/wechat-persistence.ts"),
  "utf8",
);

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing section start: ${start}`);
  assert.ok(to > from, `missing section end: ${end}`);
  return source.slice(from, to);
}

test("Prisma queue honors retry due time, manual-reply exception and official WeCom completion", () => {
  const queue = section(service, "private async processPrismaSafeSendQueue", "createDemoSendTask(");
  assert.match(queue, /manualLockBlocksTask[\s\S]*!isManualReplySendTask\(freshTask\)/);
  assert.match(queue, /wechatWorkNextRetryAt[\s\S]*wechat_work_retry_not_due/);
  assert.match(queue, /seenAccounts[\s\S]*same_account_already_processed_this_cycle/);
  assert.match(queue, /await this\.executeQueuedSend\(freshTask\.id/);

  const execute = section(service, "private async executePrismaSend", "private validateExistingSendTaskBinding");
  assert.match(execute, /adapter\.name === "wechat_work_kf"[\s\S]*completePrismaWechatWorkKfSend/);
  assert.match(execute, /preClaimState[\s\S]*claimQueuedTaskAndCreateAttempt[\s\S]*preDispatchState/);
});

test("Prisma operations recovery dispatches by persisted attempt adapter without LocalStore state", () => {
  const scan = section(service, "private async scanPrismaSendOperations", "private async processPrismaSafeSendQueue");
  assert.match(scan, /getLatestSendAttempt\(task\.id, \{ status: "started" \}\)/);
  assert.match(scan, /pendingAttempt\.adapter !== "windows_bridge"/);
  assert.match(scan, /inspectPendingBridgeOutbox\(task, pendingAttempt\)/);
  assert.doesNotMatch(scan, /localStore/);
});

test("Prisma bridge ack resolves attempts durably and accepts only exact idempotent replay", () => {
  const ack = section(service, "private async acknowledgePrismaBridgeSend", "async requeueSendTask");
  assert.match(ack, /await this\.resolveBridgeAckAttempt\(task, payload\)/);
  assert.match(ack, /await this\.resolveIdempotentBridgeAckReplay/);
  assert.match(ack, /bridgeAckTokenHash: hashBridgeAckToken\(payload\)/);
  assert.match(ack, /validatePrismaLinkedSendState\(id\)/);
  assert.doesNotMatch(ack, /localStore/);

  const resolver = section(service, "private async resolveBridgeAckAttempt", "private resolveLocalBridgeAckAttempt");
  assert.match(resolver, /this\.persistence\.listSendAttempts/);
  assert.match(resolver, /this\.persistence\.getLatestSendAttempt/);
  assert.doesNotMatch(resolver, /localStore/);

  const replay = section(service, "private async resolveIdempotentBridgeAckReplay", "private async resolveBridgeAckAttempt");
  assert.match(replay, /bridgeAckTokenHash/);
  assert.match(replay, /bridgeAckIdentity/);
  assert.match(replay, /expectedOutboxFileName/);
});

test("bridge files move only after atomic durable completion and metadata is awaited", () => {
  const ack = section(service, "private async acknowledgePrismaBridgeSend", "async requeueSendTask");
  const commit = ack.indexOf("await this.persistence.completeAttemptAndTask");
  const archive = ack.indexOf("this.archiveBridgeOutboxFile");
  const metadata = ack.indexOf("await this.persistence.updateSendAttempt");
  assert.ok(commit >= 0 && archive > commit, "outbox must not move before DB commit");
  assert.ok(metadata > archive, "archive metadata must be awaited after file movement");
  assert.match(ack, /linkedTransition/);
});

test("task, attempt and linked quote/order state transition atomically with ownership guards", () => {
  const complete = section(persistence, "async completeAttemptAndTask", "async updateSendTaskWithLinkedTransition");
  assert.match(complete, /prisma\.\$transaction/);
  assert.match(complete, /tx\.wechatSendTask\.updateMany/);
  assert.match(complete, /tx\.wechatSendAttempt\.update/);
  assert.match(complete, /params\.linkedTransition/);
  assert.match(complete, /linked\.count !== 1/);

  const linked = section(service, "private async buildPrismaLinkedTransition", "acknowledgeBridgeSend");
  assert.match(linked, /sendTaskId: task\.id/);
  assert.match(linked, /wechatAccountId: task\.wechatAccountId/);
  assert.match(linked, /conversationId: task\.conversationId/);
  assert.match(linked, /status: "send_queued"/);
});

test("official API accepted plus DB guard drift is unknown and never automatically retried", () => {
  const official = section(service, "private async completePrismaWechatWorkKfSend", "private async createPrismaDemoSendTask");
  assert.match(official, /deliveryState: "unknown"/);
  assert.match(official, /retrySafe: false/);
  assert.match(official, /acceptedMessageIds: apiMsgIds/);
  assert.match(official, /automaticRetryBlocked: !deliveryFailure\.retrySafe/);
  assert.match(official, /deliveryFailure\.deliveryState === "failed"[\s\S]*buildPrismaLinkedTransition/);
});

test("production requeue revalidates order, quote and routing policy then commits atomically", () => {
  const requeue = section(service, "async requeueSendTask", "cancelSendTask(");
  assert.match(requeue, /validatePrismaLinkedSendState\(task, \{ requireQuoteQueued: false \}\)/);
  assert.match(requeue, /updateSendTaskWithLinkedTransition/);
  assert.match(requeue, /buildPrismaLinkedTransition\(task, "requeued"/);
});

function throwingLocalStore() {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(`LocalStore must not be used in Prisma test: ${String(property)}`);
    },
  });
}

test("completeAttemptAndTask commits task, attempt and linked row together or rolls everything back", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;

  function setup(linkedCount) {
    const committed = [];
    const task = {
      id: "task-atomic",
      status: "sent",
      wechatAccountId: "account-a",
      conversationId: "conversation-a",
      quoteDraftId: "quote-a",
      payload: {},
      guardSnapshot: {},
      attempts: [],
      conversation: { id: "conversation-a", customerId: "customer-a", wechatAccountId: "account-a" },
    };
    const attempt = { id: "attempt-atomic", sendTaskId: task.id, status: "sent", metadata: {} };
    const prisma = {
      async $transaction(callback) {
        const staged = [];
        const tx = {
          wechatSendTask: { async updateMany(query) { staged.push(["task", query]); return { count: 1 }; } },
          wechatSendAttempt: { async update(query) { staged.push(["attempt", query]); return attempt; } },
          quoteDraft: { async updateMany(query) { staged.push(["quote", query]); return { count: linkedCount }; } },
        };
        const result = await callback(tx);
        committed.push(...staged);
        return result;
      },
      wechatSendTask: { async findUnique() { return task; } },
      quoteDraft: { async findMany() { return [{ id: "quote-a", sendTaskId: task.id, status: "sent" }]; } },
      wechatSendAttempt: { async findUnique() { return attempt; } },
    };
    return { persistence: new WechatPersistence(prisma, throwingLocalStore()), committed };
  }

  const rejected = setup(0);
  await assert.rejects(
    () => rejected.persistence.completeAttemptAndTask({
      taskId: "task-atomic",
      attemptId: "attempt-atomic",
      expectedTaskStatus: "sending",
      taskPatch: { status: "sent" },
      attemptPatch: { status: "sent" },
      linkedTransition: { model: "quoteDraft", where: { id: "quote-a", sendTaskId: "task-atomic" }, data: { status: "sent" } },
    }),
    /linked send state changed/,
  );
  assert.deepEqual(rejected.committed, []);

  const accepted = setup(1);
  const result = await accepted.persistence.completeAttemptAndTask({
    taskId: "task-atomic",
    attemptId: "attempt-atomic",
    expectedTaskStatus: "sending",
    taskPatch: { status: "sent" },
    attemptPatch: { status: "sent" },
    linkedTransition: { model: "quoteDraft", where: { id: "quote-a", sendTaskId: "task-atomic" }, data: { status: "sent" } },
  });
  assert.equal(result.task.id, "task-atomic");
  assert.deepEqual(accepted.committed.map(([model]) => model), ["task", "attempt", "quote"]);
});

test("Prisma bridge ack DB failure never archives files and never reads LocalStore", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const task = {
    id: "task-ack",
    status: "sending",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    payload: {},
    guardSnapshot: {},
    conversation: { id: "conversation-a", customerId: "customer-a", wechatAccountId: "account-a", manualLocked: false },
  };
  const attempt = { id: "attempt-ack", sendTaskId: task.id, adapter: "windows_bridge", status: "started", metadata: {} };
  const archives = { outbox: 0, dispatch: 0 };
  const sendAdapter = {
    listBridgeDispatch() { return []; },
    moveBridgeOutboxFile() { archives.outbox += 1; },
    moveBridgeDispatchFile() { archives.dispatch += 1; },
  };
  const service = new WechatDispatchService({}, throwingLocalStore(), sendAdapter, {}, {});
  service.persistence = {
    async getSendTask() { return task; },
    async listSendAttempts() { return [attempt]; },
    async completeAttemptAndTask() { throw new Error("simulated database failure"); },
  };
  await assert.rejects(
    () => service.acknowledgePrismaBridgeSend(task.id, {
      status: "failed",
      taskId: task.id,
      attemptId: attempt.id,
      errorMessage: "bridge failed",
    }, { internal: true }),
    /simulated database failure/,
  );
  assert.deepEqual(archives, { outbox: 0, dispatch: 0 });
});

test("Prisma queue defers future retry and invokes the official delivery path once due", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  let deliverCalls = 0;
  const task = {
    id: "task-wecom-due",
    status: "queued",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    payload: {},
    guardSnapshot: { wechatWorkNextRetryAt: new Date(Date.now() + 60_000).toISOString() },
    conversation: { id: "conversation-a", customerId: "customer-a", wechatAccountId: "account-a", manualLocked: false },
    createdAt: new Date().toISOString(),
  };
  const service = new WechatDispatchService({}, throwingLocalStore(), {}, { async create() {} }, {});
  service.persistence = {
    async listSendTasks() { return [task]; },
    async getSendTask() { return task; },
    async listAccountQueueTaskIds() { return [task.id]; },
  };
  service.executeQueuedSend = async () => {
    deliverCalls += 1;
    return { task: { ...task, status: "sent" }, attempt: { adapter: "wechat_work_kf", status: "sent" } };
  };

  const deferred = await service.processPrismaSafeSendQueue({});
  assert.equal(deliverCalls, 0);
  assert.equal(deferred.skipped[0].reason, "wechat_work_retry_not_due");

  task.guardSnapshot.wechatWorkNextRetryAt = new Date(Date.now() - 1_000).toISOString();
  const delivered = await service.processPrismaSafeSendQueue({});
  assert.equal(deliverCalls, 1);
  assert.equal(delivered.processed.length, 1);
});

test("official API acceptance plus atomic DB rejection becomes non-retryable unknown with accepted ids", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const task = {
    id: "task-wecom-unknown",
    status: "sending",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    payload: { text: "safe fixture" },
    guardSnapshot: {},
    conversation: { id: "conversation-a", customerId: "customer-a", wechatAccountId: "account-a", manualLocked: false },
  };
  const attempt = { id: "attempt-wecom", sendTaskId: task.id, adapter: "wechat_work_kf", status: "started" };
  const completionCalls = [];
  const sendAdapter = {
    async deliverWechatWorkKf() { return { msgid: "accepted-1", apiMsgIds: ["accepted-1"] }; },
  };
  const service = new WechatDispatchService({}, throwingLocalStore(), sendAdapter, {}, {});
  service.persistence = {
    async getSendTask() { return task; },
    async findWechatWorkBindingByIdentity() {
      return { id: "binding-a", openKfid: "wk-a", externalUserId: "wm-a" };
    },
    async listSendAttempts() { return [attempt]; },
    async recordWechatWorkAudit() {},
    async completeAttemptAndTask(params) {
      completionCalls.push(params);
      if (completionCalls.length === 1) throw new Error("linked send state changed before durable completion");
      return {
        task: { ...task, ...params.taskPatch },
        attempt: { ...attempt, ...params.attemptPatch },
      };
    },
  };

  const result = await service.completePrismaWechatWorkKfSend({ task, attempt });
  assert.equal(completionCalls.length, 2);
  const recovery = completionCalls[1];
  assert.equal(recovery.taskPatch.status, "failed");
  assert.equal(recovery.taskPatch.guardSnapshot.wechatWorkDeliveryState, "unknown");
  assert.equal(recovery.taskPatch.guardSnapshot.automaticRetryBlocked, true);
  assert.deepEqual(recovery.attemptPatch.metadata.acceptedMessageIds, ["accepted-1"]);
  assert.equal(recovery.attemptPatch.metadata.automaticRetryBlocked, true);
  assert.equal(result.retryScheduled, false);
});

test("stale official started attempt becomes delivery-unknown while a fresh attempt stays active and its queue is released", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const oldTime = new Date(Date.now() - 10 * 60_000).toISOString();
  const freshTime = new Date().toISOString();
  const stale = {
    id: "task-stale-official",
    status: "sending",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    payload: {},
    guardSnapshot: {},
    conversation: { id: "conversation-a", customerId: "customer-a", wechatAccountId: "account-a", manualLocked: false },
    createdAt: oldTime,
  };
  const queued = {
    id: "task-after-stale",
    status: "queued",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    payload: {},
    guardSnapshot: {},
    conversation: stale.conversation,
    createdAt: freshTime,
  };
  const fresh = {
    ...stale,
    id: "task-fresh-official",
    wechatAccountId: "account-b",
    conversationId: "conversation-b",
    conversation: { id: "conversation-b", customerId: "customer-b", wechatAccountId: "account-b", manualLocked: false },
    createdAt: freshTime,
  };
  const attempts = {
    [stale.id]: { id: "attempt-stale", sendTaskId: stale.id, adapter: "wechat_work_kf", status: "started", startedAt: oldTime, metadata: {} },
    [fresh.id]: { id: "attempt-fresh", sendTaskId: fresh.id, adapter: "wechat_work_kf", status: "started", startedAt: freshTime, metadata: {} },
  };
  const audits = [];
  const notifications = [];
  let queuedExecutions = 0;
  const service = new WechatDispatchService({}, throwingLocalStore(), {}, {
    async create(...args) { notifications.push(args); },
  }, {});
  service.persistence = {
    async listSendTasks() { return [stale, queued, fresh]; },
    async getLatestSendAttempt(taskId) { return attempts[taskId] || null; },
    async completeAttemptAndTask(params) {
      assert.equal(params.taskId, stale.id);
      assert.equal(params.linkedTransition, null);
      Object.assign(stale, params.taskPatch);
      Object.assign(attempts[stale.id], params.attemptPatch);
      return { task: stale, attempt: attempts[stale.id] };
    },
    async recordWechatWorkAudit(entry) { audits.push(entry); },
    async getSendTask(taskId) { return [stale, queued, fresh].find((item) => item.id === taskId) || null; },
    async listAccountQueueTaskIds(accountId) {
      return [stale, queued, fresh]
        .filter((item) => item.wechatAccountId === accountId && ["queued", "sending"].includes(item.status))
        .map((item) => item.id);
    },
  };
  service.executeQueuedSend = async (taskId) => {
    assert.equal(taskId, queued.id);
    queuedExecutions += 1;
    queued.status = "sent";
    return { task: queued, attempt: { adapter: "wechat_work_kf", status: "sent" } };
  };

  const scan = await service.scanPrismaSendOperations({});
  assert.equal(scan.wechatWorkDeliveryUnknown, 1);
  assert.equal(stale.status, "failed");
  assert.equal(stale.guardSnapshot.wechatWorkDeliveryState, "unknown");
  assert.equal(stale.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(attempts[stale.id].metadata.deliveryState, "unknown");
  assert.equal(attempts[stale.id].metadata.automaticRetryBlocked, true);
  assert.equal(fresh.status, "sending");
  assert.equal(attempts[fresh.id].status, "started");
  assert.equal(audits.length, 1);
  assert.equal(notifications.length, 1);
  await assert.rejects(
    () => service.requeueSendTask(stale.id, { reason: "operator retry without resolving unknown delivery" }),
    /Delivery result is unknown/,
  );

  const queueResult = await service.processPrismaSafeSendQueue({});
  assert.equal(queuedExecutions, 1);
  assert.equal(queueResult.processed[0].task.id, queued.id);
  assert.equal(attempts[stale.id].status, "failed");
});

test("Prisma operations protect every uncertain Windows bridge recovery without marking failed", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const fixtures = [
    { recovery: "bridge_outbox_unavailable", counter: "bridgeOutboxBroken", outbox: { ok: false, reason: "outbox_file_missing" }, dispatch: null, timedOut: false },
    { recovery: "bridge_dispatch_expired", counter: "bridgeDispatchExpired", outbox: { ok: true }, dispatch: { expired: true, expiresAt: "2026-01-01T00:00:00.000Z" }, timedOut: false },
    { recovery: "bridge_ack_timeout", counter: "bridgeTimedOut", outbox: { ok: true }, dispatch: { expired: false }, timedOut: true },
  ];

  for (const fixture of fixtures) {
    const oldTime = new Date(Date.now() - 10 * 60_000).toISOString();
    const task = {
      id: `task-${fixture.recovery}`,
      status: "sending",
      wechatAccountId: "account-bridge",
      conversationId: "conversation-bridge",
      payload: {},
      guardSnapshot: {},
      conversation: { id: "conversation-bridge", customerId: "customer-bridge", wechatAccountId: "account-bridge", manualLocked: false },
      createdAt: oldTime,
    };
    const attempt = {
      id: `attempt-${fixture.recovery}`,
      sendTaskId: task.id,
      adapter: "windows_bridge",
      status: "started",
      startedAt: oldTime,
      metadata: {},
    };
    const notifications = [];
    const transitions = [];
    const dispatchService = new WechatDispatchService({}, throwingLocalStore(), {}, {
      async create(...args) { notifications.push(args); },
    }, {});
    dispatchService.persistence = {
      async listSendTasks() { return [task]; },
      async getLatestSendAttempt() { return attempt; },
      async completeAttemptAndTask(params) {
        transitions.push(params);
        Object.assign(task, params.taskPatch);
        Object.assign(attempt, params.attemptPatch);
        return { task, attempt };
      },
      async getSendTask() { return task; },
    };
    dispatchService.inspectPendingBridgeOutbox = () => fixture.outbox;
    dispatchService.findPendingBridgeDispatchForTask = () => fixture.dispatch;
    dispatchService.isBridgeAckTimedOut = () => fixture.timedOut;

    const scan = await dispatchService.scanPrismaSendOperations({});
    assert.equal(scan[fixture.counter], 1, fixture.recovery);
    assert.equal(transitions.length, 1, fixture.recovery);
    assert.equal(transitions[0].expectedTaskStatus, "sending", fixture.recovery);
    assert.equal(transitions[0].taskPatch.status, "sending", fixture.recovery);
    assert.equal(transitions[0].attemptPatch.status, "started", fixture.recovery);
    assert.equal(task.status, "sending", fixture.recovery);
    assert.equal(task.guardSnapshot.deliveryState, "unknown", fixture.recovery);
    assert.equal(task.guardSnapshot.deliveryUnknownReason, fixture.recovery);
    assert.equal(task.guardSnapshot.automaticRetryBlocked, true, fixture.recovery);
    assert.equal(task.guardSnapshot.manualReviewRequired, true, fixture.recovery);
    assert.equal(attempt.status, "started", fixture.recovery);
    assert.equal(attempt.metadata.deliveryState, "unknown", fixture.recovery);
    assert.equal(attempt.metadata.automaticRetryBlocked, true, fixture.recovery);
    assert.equal(notifications.length, 1, fixture.recovery);
    await assert.rejects(
      () => dispatchService.requeueSendTask(task.id, { reason: "unsafe retry" }),
      /Delivery result is unknown/,
      fixture.recovery,
    );
  }
});

test("exact Prisma ack replay compensates missing file archives once after durable completion", async (t) => {
  t.after(() => { appConfig.useLocalStore = true; });
  appConfig.useLocalStore = false;
  const ackToken = "ack-token-for-archive-recovery";
  const outboxFileName = "bridge-task-archive.json";
  const task = {
    id: "task-archive-recovery",
    status: "sent",
    wechatAccountId: "account-archive",
    conversationId: "conversation-archive",
    customerId: "customer-archive",
    payload: {},
    guardSnapshot: {},
    conversation: { id: "conversation-archive", customerId: "customer-archive", wechatAccountId: "account-archive", manualLocked: false },
  };
  const attempt = {
    id: "attempt-archive-recovery",
    sendTaskId: task.id,
    adapter: "windows_bridge",
    status: "sent",
    metadata: {
      bridgeAckIdentity: {
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        customerId: task.customerId,
      },
      bridgeAckOutboxFileName: outboxFileName,
      bridgeAckTokenHash: createHash("sha256").update(ackToken).digest("hex"),
      dispatchFileName: "bridge-task-archive.dispatch.json",
    },
  };
  const archiveCalls = [];
  let metadataUpdates = 0;
  const sendAdapter = {
    moveBridgeOutboxFile(filePath, outcome) {
      archiveCalls.push(["outbox", path.basename(filePath), outcome]);
      return "archive/processed/bridge-task-archive.json";
    },
    moveBridgeDispatchFile(filePath, outcome) {
      archiveCalls.push(["dispatch", path.basename(filePath), outcome]);
      return "archive/processed/bridge-task-archive.dispatch.json";
    },
  };
  const dispatchService = new WechatDispatchService({}, throwingLocalStore(), sendAdapter, {}, {});
  dispatchService.persistence = {
    async getSendTask() { return task; },
    async listSendAttempts() { return [attempt]; },
    async updateSendAttempt(_id, patch) {
      metadataUpdates += 1;
      attempt.metadata = { ...attempt.metadata, ...patch.metadata };
      return attempt;
    },
  };
  const payload = {
    status: "sent",
    version: "wechat_bridge_ack_v1",
    ackToken,
    taskId: task.id,
    attemptId: attempt.id,
    wechatAccountId: task.wechatAccountId,
    conversationId: task.conversationId,
    customerId: task.customerId,
    outboxFileName,
  };

  const recovered = await dispatchService.acknowledgePrismaBridgeSend(task.id, payload);
  assert.equal(recovered.idempotent, true);
  assert.deepEqual(archiveCalls, [
    ["outbox", outboxFileName, "processed"],
    ["dispatch", "bridge-task-archive.dispatch.json", "processed"],
  ]);
  assert.equal(metadataUpdates, 1);
  assert.equal(attempt.metadata.archivedOutboxPath, "archive/processed/bridge-task-archive.json");
  assert.equal(attempt.metadata.archivedDispatchPath, "archive/processed/bridge-task-archive.dispatch.json");
  assert.match(attempt.metadata.bridgeAckArchiveRecoveredAt, /^\d{4}-\d{2}-\d{2}T/);

  const replayedAgain = await dispatchService.acknowledgePrismaBridgeSend(task.id, payload);
  assert.equal(replayedAgain.idempotent, true);
  assert.equal(archiveCalls.length, 2);
  assert.equal(metadataUpdates, 1);
});
