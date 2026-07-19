"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const axios = require("axios");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignPlatformClient } = require("../apps/api/src/integrations/design-platform/design-platform.client");
const { DesignPlatformExecutionService } = require("../apps/api/src/design-jobs/design-platform-execution.service");
const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function artPayload() {
  return {
    requestId: "business-request-must-not-reach-remote",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    assets: [],
    outputCount: 1,
    renderStyle: "real product photo",
    requirements: { useRealSkuImages: false },
    customerText: "sensitive customer prompt",
  };
}

function localFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-execution-"));
  const previousFile = process.env.LOCAL_STORE_FILE;
  const previousMode = appConfig.useLocalStore;
  process.env.LOCAL_STORE_FILE = path.join(root, "local-store.json");
  appConfig.useLocalStore = true;
  const localStore = new LocalStoreService();
  const job = localStore.createDesignJob({
    requestId: `request-${Date.now()}-${Math.random()}`,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    outputCount: 1,
    status: "draft",
  });
  t.after(() => {
    appConfig.useLocalStore = previousMode;
    if (previousFile === undefined) delete process.env.LOCAL_STORE_FILE;
    else process.env.LOCAL_STORE_FILE = previousFile;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, localStore, job };
}

test("client uses stable execution requestId and classifies timeout, reset, 5xx and malformed 2xx as outcome_unknown", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
  const client = new DesignPlatformClient();
  const seen = [];
  const failures = [
    new axios.AxiosError("timeout", "ECONNABORTED"),
    new axios.AxiosError("reset", "ECONNRESET"),
    new axios.AxiosError("server", "ERR_BAD_RESPONSE", undefined, undefined, { status: 503, data: {} }),
  ];
  client.http.post = async (_url, body) => {
    seen.push(body.requestId);
    const failure = failures.shift();
    if (failure) throw failure;
    return { status: 200, data: { ok: true, data: { unexpected: true } } };
  };

  for (let index = 0; index < 4; index += 1) {
    const result = await client.executeArtImageLocalGeneration(artPayload(), "art_stable_request_1");
    assert.equal(result.status, "outcome_unknown");
    assert.equal(result.refundStatus, "unknown");
  }
  assert.deepEqual(seen, Array(4).fill("art_stable_request_1"));
});

test("local request build failure is pre-dispatch and cannot invent a refund obligation", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
  const client = new DesignPlatformClient();
  let postCount = 0;
  client.buildArtImageLocalRequest = async () => { throw new Error("invalid local reference metadata"); };
  client.http.post = async () => { postCount += 1; };
  const result = await client.executeArtImageLocalGeneration(artPayload(), "art_pre_dispatch_failure");
  assert.equal(result.status, "failed");
  assert.equal(result.refundStatus, "not_required");
  assert.equal(result.errorCode, "LOCAL_REQUEST_BUILD_FAILED");
  assert.equal(postCount, 0);
});

test("machine-terminal all-failed response is explicit only when refund outcome is safe", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
  const client = new DesignPlatformClient();
  client.http.post = async () => ({
    status: 200,
    data: { ok: true, data: { results: [{ status: "failed", error: "generator rejected" }], refund: { status: "succeeded", requestedCredits: 1, alreadyRefunded: false } } },
  });
  const result = await client.executeArtImageLocalGeneration(artPayload(), "art_explicit_failure_1");
  assert.equal(result.status, "failed");
  assert.equal(result.refundStatus, "refunded");
  assert.equal(result.errorCode, "MACHINE_TERMINAL_ALL_FAILED");
});

test("real refund shapes map succeeded, failed and credit bypass without inventing settlement", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
  const client = new DesignPlatformClient();
  const refunds = [
    { status: "succeeded", requestedCredits: 2, alreadyRefunded: true, reason: "all_failed" },
    { status: "failed", requestedCredits: 2, alreadyRefunded: false, reason: "rpc_failed" },
    { status: "not_required", requestedCredits: 0, alreadyRefunded: false, reason: "credit_bypass" },
  ];
  const expected = ["refunded", "failed", "credit_bypass"];
  for (let index = 0; index < refunds.length; index += 1) {
    client.http.post = async () => ({
      status: 200,
      data: { ok: true, data: { results: [{ status: "failed", error: "no image" }], refund: refunds[index] } },
    });
    const result = await client.executeArtImageLocalGeneration(artPayload(), `art_refund_${index}`);
    assert.equal(result.refundStatus, expected[index]);
    assert.equal(result.refundSummary.requestedCredits, refunds[index].requestedCredits);
    assert.equal(result.refundSummary.alreadyRefunded, refunds[index].alreadyRefunded);
  }

  client.http.post = async () => ({
    status: 200,
    data: { ok: true, data: {
      results: [{ status: "success", url: "/generated/one.png" }, { status: "failed", error: "second failed" }],
      refund: { status: "failed", requestedCredits: 1, reason: "rpc_failed" },
    } },
  });
  const partial = await client.executeArtImageLocalGeneration(artPayload(), "art_partial_refund_failed");
  assert.equal(partial.status, "completed");
  assert.equal(partial.refundStatus, "failed");
});

test("LocalStore durable begin is atomic, idempotent, restart-safe and contains no prompt or credentials", async (t) => {
  const { root, localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  const duplicate = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  assert.equal(begun.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(localStore.listDesignPlatformExecutions({ designJobId: job.id }).length, 1);
  assert.equal(localStore.getDesignJob(job.id).status, "submitted");
  assert.equal(begun.execution.requestId, begun.execution.externalJobId);
  assert.equal(begun.execution.scopeKey, `${job.id}:initial`);

  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  const restarted = new DesignPlatformExecutionService({}, localStore);
  assert.equal((await restarted.recoverStaleExecutions()).length, 0, "fresh live execution must not be stolen");
  const storePath = path.join(root, "local-store.json");
  const expired = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const row = expired.designPlatformExecutions.find((item) => item.id === begun.execution.id);
  row.updatedAt = "2000-01-01T00:00:00.000Z";
  row.dispatchedAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(storePath, `${JSON.stringify(expired, null, 2)}\n`, "utf8");
  const recovered = await restarted.recoverStaleExecutions();
  assert.equal(recovered.length, 1);
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).status, "outcome_unknown");
  assert.equal(localStore.getDesignJob(job.id).status, "manual_review");
  await assert.rejects(() => restarted.assertRetryAllowed(job.id), /explicit manual resolution/);

  const serialized = fs.readFileSync(path.join(root, "local-store.json"), "utf8");
  for (const secret of ["sensitive customer prompt", "Authorization", "cookie", "password", "token"]) {
    assert.equal(serialized.toLowerCase().includes(secret.toLowerCase()), false);
  }
});

test("duplicate submit persists prepared/dispatching/generating before one POST and unknown blocks retry", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  let postCount = 0;
  const designPlatform = {
    isArtImageLocalAdapter: () => true,
    executeArtImageLocalGeneration: async (_payload, requestId) => {
      postCount += 1;
      const persisted = localStore.getDesignPlatformExecution(requestId);
      assert.equal(persisted.status, "generating");
      assert.equal(persisted.requestId, requestId);
      return { status: "outcome_unknown", images: [], refundStatus: "unknown", errorCode: "ECONNRESET", errorMessage: "reset" };
    },
  };
  const notifications = { create: async () => ({}) };
  const wechat = {
    enqueueTextMessage: async () => ({}),
    setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
  };
  const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, wechat, {}, {}, executions);
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.buildDesignPlatformPayload = async () => ({ ...artPayload(), requestId: job.requestId });

  await Promise.all([service.submit(job.id), service.submit(job.id)]);
  await Promise.all([...service.activeExecutionPromises.values()]);
  assert.equal(postCount, 1);
  assert.equal(localStore.listDesignPlatformExecutions({ designJobId: job.id }).length, 1);
  assert.equal(localStore.getDesignJob(job.id).status, "manual_review");
  await assert.rejects(() => service.retry(job.id), /explicit manual resolution/);
});

test("21 minute timeout scan protects a live durable execution and never permits a second POST", async (t) => {
  const previousTimeoutMinutes = appConfig.designTimeoutMinutes;
  appConfig.designTimeoutMinutes = 20;
  t.after(() => { appConfig.designTimeoutMinutes = previousTimeoutMinutes; });
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  let postCount = 0;
  let finishRemote;
  const remoteOutcome = new Promise((resolve) => { finishRemote = resolve; });
  const designPlatform = {
    isArtImageLocalAdapter: () => true,
    executeArtImageLocalGeneration: async () => {
      postCount += 1;
      return remoteOutcome;
    },
  };
  const service = new DesignJobsService(
    {}, designPlatform, localStore, { create: async () => ({}) }, {},
    {
      enqueueTextMessage: async () => ({}),
      setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
    },
    {}, {}, executions,
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.buildDesignPlatformPayload = async () => ({ ...artPayload(), requestId: job.requestId });

  await service.submit(job.id);
  const active = localStore.listDesignPlatformExecutions({ designJobId: job.id })[0];
  assert.equal(active.status, "generating");
  assert.equal(postCount, 1);

  localStore.updateDesignJob(job.id, {
    status: "generating",
    submittedAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
  });
  const scan = await service.scanTimeouts();
  assert.equal(scan.candidates, 1);
  assert.equal(scan.timedOut, 0);
  assert.equal(scan.protectedByDurableExecution, 1);
  assert.equal(localStore.getDesignJob(job.id).status, "generating");
  await assert.rejects(() => service.retry(job.id), /cannot be retried from status: generating/);

  localStore.updateDesignJob(job.id, { status: "timeout", errorMessage: "legacy scanner race" });
  await assert.rejects(() => service.retry(job.id), /active design platform execution is still in progress/);
  await assert.rejects(
    () => executions.begin({ designJobId: job.id, attemptNo: 2, retryCount: 1 }),
    /active design platform execution is still in progress/,
  );

  localStore.updateDesignJob(job.id, { status: "quick_confirm", errorMessage: null });
  const revisionCount = localStore.listDesignRevisions(job.id).length;
  await assert.rejects(
    () => service.requestRevision(job.id, { instruction: "make it brighter" }),
    /active design platform execution is still in progress/,
  );
  assert.equal(localStore.listDesignRevisions(job.id).length, revisionCount);

  localStore.updateDesignJob(job.id, { status: "generating" });
  finishRemote({
    status: "outcome_unknown",
    images: [],
    refundStatus: "unknown",
    errorCode: "ECONNABORTED",
    errorMessage: "request exceeded the 30 minute transport timeout",
  });
  await Promise.all([...service.activeExecutionPromises.values()]);
  assert.equal(localStore.getDesignPlatformExecution(active.id).status, "outcome_unknown");
  assert.equal(localStore.getDesignJob(job.id).status, "manual_review");
  await assert.rejects(() => service.retry(job.id), /explicit manual resolution/);
  assert.equal(postCount, 1);
  assert.equal(localStore.listDesignPlatformExecutions({ designJobId: job.id }).length, 1);

  await service.resolveUnknownExecution(job.id, active.id, {
    resolution: "confirmed_not_generated_refunded",
    expectedWechatAccountId: job.wechatAccountId,
    expectedConversationId: job.conversationId,
    expectedCustomerId: job.customerId,
  }, "operator_timeout_audit");
  await executions.assertRetryAllowed(job.id);
  assert.equal(postCount, 1);
});

test("prepared execution is reclaimed by an already-running peer and competing runners POST once", async (t) => {
  const { localStore, job } = localFixture(t);
  const owner = new DesignPlatformExecutionService({}, localStore);
  const peer = new DesignPlatformExecutionService({}, localStore);
  const begun = await owner.begin({ designJobId: job.id, attemptNo: 1 });
  const reclaimed = await peer.takeoverPreparedExecutions();
  assert.equal(reclaimed.length, 1);
  let postCount = 0;
  const designPlatform = {
    isArtImageLocalAdapter: () => true,
    executeArtImageLocalGeneration: async (_payload, requestId) => {
      postCount += 1;
      assert.equal(requestId, begun.execution.requestId);
      return { status: "outcome_unknown", images: [], refundStatus: "unknown", errorCode: "ECONNRESET", errorMessage: "reset" };
    },
  };
  const deps = [{}, designPlatform, localStore, { create: async () => ({}) }, {}, {
    setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
  }, {}, {}];
  const ownerJobs = new DesignJobsService(...deps, owner);
  const peerJobs = new DesignJobsService(...deps, peer);
  await Promise.all([
    ownerJobs.runDurableArtImageExecution(begun.execution, artPayload(), "owner_after_crash"),
    peerJobs.runDurableArtImageExecution(reclaimed[0], artPayload(), "peer_recovery"),
  ]);
  assert.equal(postCount, 1);
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).status, "outcome_unknown");
});

test("API lifecycle recovery is non-blocking and independent from disabled automation or catalog readiness", async (t) => {
  const previousAutomationEnabled = appConfig.lowValueAutomationEnabled;
  const previousTimeoutMs = appConfig.designPlatformTimeoutMs;
  const previousRecoveryIntervalMs = appConfig.designExecutionRecoveryIntervalMs;
  appConfig.lowValueAutomationEnabled = false;
  appConfig.designPlatformTimeoutMs = 1000;
  appConfig.designExecutionRecoveryIntervalMs = 60_000;
  t.after(() => {
    appConfig.lowValueAutomationEnabled = previousAutomationEnabled;
    appConfig.designPlatformTimeoutMs = previousTimeoutMs;
    appConfig.designExecutionRecoveryIntervalMs = previousRecoveryIntervalMs;
  });

  const { root, localStore, job: preparedJob } = localFixture(t);
  const createJob = (suffix) => localStore.createDesignJob({
    requestId: `request-recovery-${suffix}`,
    customerId: preparedJob.customerId,
    conversationId: preparedJob.conversationId,
    wechatAccountId: preparedJob.wechatAccountId,
    budget: {}, bundle: {}, requirements: { useRealSkuImages: false }, status: "draft",
  });
  const inflightJob = createJob("inflight");
  const completedJob = createJob("completed");
  const crashedProcess = new DesignPlatformExecutionService({}, localStore);
  const prepared = await crashedProcess.begin({ designJobId: preparedJob.id, attemptNo: 1 });
  const inflight = await crashedProcess.begin({ designJobId: inflightJob.id, attemptNo: 1 });
  await crashedProcess.claimDispatch(inflight.execution.id);
  await crashedProcess.markGenerating(inflight.execution.id);
  const completed = await crashedProcess.begin({ designJobId: completedJob.id, attemptNo: 1 });
  await crashedProcess.claimDispatch(completed.execution.id);
  await crashedProcess.markGenerating(completed.execution.id);
  await crashedProcess.recordOutcome(completed.execution.id, {
    status: "completed",
    images: [{ imageId: "candidate_recovered", downloadUrl: "http://127.0.0.1/generated/recovered.png" }],
    refundStatus: "not_required",
    httpStatus: 200,
  });

  const storePath = path.join(root, "local-store.json");
  const persisted = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const staleInflight = persisted.designPlatformExecutions.find((item) => item.id === inflight.execution.id);
  staleInflight.updatedAt = "2000-01-01T00:00:00.000Z";
  staleInflight.dispatchedAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(storePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  let postCount = 0;
  let finishPreparedRemote;
  const pendingRemote = new Promise((resolve) => { finishPreparedRemote = resolve; });
  const recoveryExecutions = new DesignPlatformExecutionService({}, localStore);
  const service = new DesignJobsService(
    {},
    {
      isArtImageLocalAdapter: () => true,
      executeArtImageLocalGeneration: async () => { postCount += 1; return pendingRemote; },
    },
    localStore,
    { create: async () => ({}) },
    {},
    { setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }) },
    {}, {}, recoveryExecutions,
  );
  service.buildDesignPlatformPayload = async () => artPayload();
  service.assertDesignPlatformPreflight = async () => { throw new Error("catalog readiness blocked"); };
  service.runLowValueAutomation = async () => { assert.fail("lifecycle recovery must not invoke low-value automation"); };
  let acceptanceCount = 0;
  service.acceptDurableArtImageExecution = async (executionId) => {
    acceptanceCount += 1;
    const claimed = await recoveryExecutions.claimAcceptance(executionId);
    if (claimed) await recoveryExecutions.finishAcceptance(executionId, "accepted");
  };

  const bootstrapResult = service.onApplicationBootstrap();
  assert.equal(bootstrapResult, undefined, "bootstrap must not await a long-running generation");
  for (let index = 0; index < 20 && postCount === 0; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all([
    service.reconcileDurableArtImageExecutions(),
    service.reconcileDurableArtImageExecutions(),
  ]);
  assert.equal(postCount, 1);
  assert.equal(acceptanceCount, 1);
  assert.equal(localStore.getDesignPlatformExecution(inflight.execution.id).status, "outcome_unknown");
  assert.equal(localStore.getDesignPlatformExecution(completed.execution.id).acceptanceStatus, "accepted");
  assert.equal(localStore.listDesignPlatformExecutions({ designJobId: preparedJob.id }).length, 1);

  finishPreparedRemote({
    status: "outcome_unknown", images: [], refundStatus: "unknown",
    errorCode: "ECONNRESET", errorMessage: "reset after startup recovery",
  });
  await Promise.all([...service.activeExecutionPromises.values()]);
  assert.equal(localStore.getDesignPlatformExecution(prepared.execution.id).status, "outcome_unknown");
  assert.equal(postCount, 1);
  service.onModuleDestroy();
});

test("Prisma P2002 duplicate begin returns the winner execution instead of manual-review failure", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const existing = { id: "execution-winner", operationKey: "job-p2002:initial:1", externalJobId: "art_winner" };
  let calls = 0;
  const prisma = {
    $transaction: async () => {
      calls += 1;
      if (calls === 1) return { execution: existing, created: true };
      throw Object.assign(new Error("unique conflict"), { code: "P2002" });
    },
    designPlatformExecution: { findUnique: async () => existing },
  };
  const first = new DesignPlatformExecutionService(prisma, {});
  const second = new DesignPlatformExecutionService(prisma, {});
  const [winner, loser] = await Promise.all([
    first.begin({ designJobId: "job-p2002", attemptNo: 1 }),
    second.begin({ designJobId: "job-p2002", attemptNo: 1 }),
  ]);
  assert.equal(winner.execution.id, existing.id);
  assert.equal(loser.execution.id, existing.id);
  assert.equal(loser.created, false);
});

test("completed pending acceptance survives client rebuild and recovery never POSTs again", async (t) => {
  const { localStore, job } = localFixture(t);
  const firstRun = new DesignPlatformExecutionService({}, localStore);
  const begun = await firstRun.begin({ designJobId: job.id, attemptNo: 1 });
  await firstRun.claimDispatch(begun.execution.id);
  await firstRun.markGenerating(begun.execution.id);
  await firstRun.recordOutcome(begun.execution.id, {
    status: "completed",
    images: [{ imageId: "candidate_1", downloadUrl: "http://127.0.0.1:3000/generated/one.png", width: 1024, height: 1024 }],
    refundStatus: "not_required",
    httpStatus: 200,
  });

  let postCount = 0;
  const rebuiltClient = { isArtImageLocalAdapter: () => true, executeArtImageLocalGeneration: async () => { postCount += 1; } };
  const secondRun = new DesignPlatformExecutionService({}, localStore);
  const service = new DesignJobsService(
    {}, rebuiltClient, localStore, { create: async () => ({}) }, {},
    { setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }) }, {}, {}, secondRun,
  );
  service.handleDesignPlatformCallback = async () => localStore.updateDesignJob(job.id, { status: "quick_confirm" });
  await service.pollActiveResults(10);
  const accepted = localStore.getDesignPlatformExecution(begun.execution.id);
  assert.equal(postCount, 0);
  assert.equal(accepted.acceptanceStatus, "accepted");
  assert.equal(localStore.getDesignJob(job.id).status, "quick_confirm");
});

test("cancelled or stale revision late completion is rejected without business acceptance", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  await executions.recordOutcome(begun.execution.id, {
    status: "completed",
    images: [{ imageId: "candidate_1", downloadUrl: "http://127.0.0.1/generated/one.png" }],
    refundStatus: "not_required",
    httpStatus: 200,
  });
  localStore.updateDesignJob(job.id, { status: "cancelled" });
  assert.equal(await executions.claimAcceptance(begun.execution.id), null);
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).acceptanceStatus, "rejected");
});

test("prepared cancellation through DesignJobsService is terminal locally and never reaches a remote POST", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  let postCount = 0;
  let remoteCancelCount = 0;
  const designPlatform = {
    isArtImageLocalAdapter: () => true,
    executeArtImageLocalGeneration: async () => {
      postCount += 1;
      return { status: "completed", images: [], refundStatus: "not_required", httpStatus: 200 };
    },
    cancelDesignJob: async () => { remoteCancelCount += 1; return { status: "cancelled" }; },
  };
  const service = new DesignJobsService(
    {}, designPlatform, localStore, { create: async () => ({}) }, {},
    { setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }) },
    {}, {}, executions,
  );

  await service.cancel(job.id);
  const cancelled = localStore.getDesignPlatformExecution(begun.execution.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.acceptanceStatus, "rejected");
  assert.equal(cancelled.refundStatus, "not_required");
  assert.ok(cancelled.resolvedAt);
  assert.equal(remoteCancelCount, 0);

  await service.runDurableArtImageExecution(begun.execution, artPayload(), "cancelled_before_dispatch");
  await service.reconcileDurableArtImageExecutions();
  assert.equal(postCount, 0);
  assert.equal(remoteCancelCount, 0);
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).status, "cancelled");
  service.onModuleDestroy();
});

test("cancellation rejects an already-claimed acceptance and prevents candidate commit", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  await executions.recordOutcome(begun.execution.id, {
    status: "completed",
    images: [{ imageId: "candidate_cancel_race", downloadUrl: "http://127.0.0.1/generated/cancel-race.png" }],
    refundStatus: "not_required",
    httpStatus: 200,
  });
  assert.ok(await executions.claimAcceptance(begun.execution.id));

  await executions.requestCancellation(begun.execution.externalJobId);
  assert.equal(localStore.getDesignJob(job.id).status, "cancelled");
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).acceptanceStatus, "rejected");
  await assert.rejects(
    () => executions.commitAcceptedResult({
      executionId: begun.execution.id,
      images: [{ imageId: "candidate_cancel_race", position: 1, downloadUrl: "http://127.0.0.1/generated/cancel-race.png" }],
      resultImageIds: ["candidate_cancel_race"],
      nextStatus: "quick_confirm",
    }),
    /not accepting/,
  );
  assert.equal(localStore.getDesignJob(job.id).images.length, 0);
});

test("cancel request keeps the job cancelled while preserving rejected late outcome evidence", async (t) => {
  const { root, localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  await executions.requestCancellation(begun.execution.externalJobId);
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).status, "cancel_requested");
  assert.equal(localStore.getDesignJob(job.id).status, "cancelled");
  const late = await executions.recordOutcome(begun.execution.id, {
    status: "completed",
    images: [{ imageId: "candidate_1", downloadUrl: "http://127.0.0.1/generated/late.png" }],
    refundStatus: "not_required",
    httpStatus: 200,
  });
  assert.equal(late.status, "completed");
  assert.equal(late.acceptanceStatus, "rejected");
  assert.equal(late.refundStatus, "not_required");
  assert.equal(late.responseHttpStatus, 200);
  assert.equal(late.images[0].downloadUrl, "http://127.0.0.1/generated/late.png");
  assert.equal(localStore.getDesignJob(job.id).status, "cancelled");
  assert.equal(localStore.getDesignJob(job.id).images.length, 0);
  assert.equal(await executions.claimAcceptance(begun.execution.id), null);

  for (const [suffix, outcome, expectedStatus] of [
    ["failed", {
      status: "failed", images: [], refundStatus: "failed", errorCode: "REMOTE_REJECTED",
      refundSummary: { reason: "refund_rpc_failed", requestedCredits: 2 }, httpStatus: 422,
    }, "explicit_failed"],
    ["unknown", {
      status: "outcome_unknown", images: [], refundStatus: "unknown", errorCode: "ECONNRESET",
      errorMessage: "reset after cancel", httpStatus: 503,
    }, "outcome_unknown"],
  ]) {
    const extraJob = localStore.createDesignJob({
      requestId: `request-cancel-${suffix}`,
      customerId: job.customerId,
      conversationId: job.conversationId,
      wechatAccountId: job.wechatAccountId,
      budget: {}, bundle: {}, requirements: {}, status: "draft",
    });
    const extra = await executions.begin({ designJobId: extraJob.id, attemptNo: 1 });
    await executions.claimDispatch(extra.execution.id);
    await executions.markGenerating(extra.execution.id);
    await executions.requestCancellation(extra.execution.externalJobId);
    const stored = await executions.recordOutcome(extra.execution.id, outcome);
    assert.equal(stored.status, expectedStatus);
    assert.equal(stored.acceptanceStatus, "rejected");
    assert.equal(stored.responseHttpStatus, outcome.httpStatus);
    assert.equal(localStore.getDesignJob(extraJob.id).status, "cancelled");
    assert.equal(localStore.getDesignJob(extraJob.id).images.length, 0);
  }

  const orphanJob = localStore.createDesignJob({
    requestId: "request-cancel-restart",
    customerId: job.customerId,
    conversationId: job.conversationId,
    wechatAccountId: job.wechatAccountId,
    budget: {}, bundle: {}, requirements: {}, status: "draft",
  });
  const orphan = await executions.begin({ designJobId: orphanJob.id, attemptNo: 1 });
  await executions.claimDispatch(orphan.execution.id);
  await executions.markGenerating(orphan.execution.id);
  await executions.requestCancellation(orphan.execution.externalJobId);
  const storePath = path.join(root, "local-store.json");
  const persisted = JSON.parse(fs.readFileSync(storePath, "utf8"));
  persisted.designPlatformExecutions.find((item) => item.id === orphan.execution.id).updatedAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(storePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  const restarted = new DesignPlatformExecutionService({}, localStore);
  await restarted.recoverStaleExecutions();
  const recovered = localStore.getDesignPlatformExecution(orphan.execution.id);
  assert.equal(recovered.status, "outcome_unknown");
  assert.equal(recovered.acceptanceStatus, "rejected");
  assert.equal(recovered.errorCode, "CANCELLED_EXECUTION_OUTCOME_UNKNOWN");
  assert.equal(localStore.getDesignJob(orphanJob.id).status, "cancelled");
});

test("accepted candidates, revision/job status and execution acceptance commit in one LocalStore write", async (t) => {
  const { root, localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  await executions.recordOutcome(begun.execution.id, {
    status: "completed",
    images: [{ imageId: "candidate_1", downloadUrl: "http://127.0.0.1/generated/one.png" }],
    refundStatus: "not_required",
    httpStatus: 200,
  });
  await executions.claimAcceptance(begun.execution.id);
  const before = fs.readFileSync(path.join(root, "local-store.json"), "utf8");
  const originalWrite = localStore.write;
  localStore.write = () => { throw new Error("simulated atomic write failure"); };
  await assert.rejects(
    () => executions.commitAcceptedResult({
      executionId: begun.execution.id,
      images: [{ imageId: "candidate_1", position: 1, downloadUrl: "http://127.0.0.1/generated/one.png" }],
      resultImageIds: ["candidate_1"],
      nextStatus: "quick_confirm",
    }),
    /simulated atomic write failure/,
  );
  localStore.write = originalWrite;
  assert.equal(fs.readFileSync(path.join(root, "local-store.json"), "utf8"), before);
  assert.equal(localStore.getDesignJob(job.id).status, "generating");
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).acceptanceStatus, "accepting");

  await executions.commitAcceptedResult({
    executionId: begun.execution.id,
    images: [{ imageId: "candidate_1", position: 1, downloadUrl: "http://127.0.0.1/generated/one.png" }],
    resultImageIds: ["candidate_1"],
    nextStatus: "quick_confirm",
  });
  assert.equal(localStore.getDesignJob(job.id).status, "quick_confirm");
  assert.equal(localStore.getDesignPlatformExecution(begun.execution.id).acceptanceStatus, "accepted");
  assert.equal(localStore.getDesignJob(job.id).images.length, 1);
});

test("execution persistence strips signed URL queries and never stores remote secret-bearing errors", async (t) => {
  const { root, localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  await executions.recordOutcome(begun.execution.id, {
    status: "completed",
    images: [{
      imageId: "candidate_1",
      downloadUrl: "https://signed.example/image.png?X-Amz-Credential=AKIA_TEST&X-Amz-Signature=sig-secret&GoogleAccessId=secret@example",
    }],
    refundStatus: "not_required",
    httpStatus: 200,
  });
  const stored = localStore.getDesignPlatformExecution(begun.execution.id);
  assert.equal(stored.images[0].downloadUrl, "https://signed.example/image.png");

  const secondJob = localStore.createDesignJob({
    requestId: "request-sensitive-error",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: {}, bundle: {}, requirements: {}, status: "draft",
  });
  const failed = await executions.begin({ designJobId: secondJob.id, attemptNo: 1 });
  await executions.claimDispatch(failed.execution.id);
  await executions.markGenerating(failed.execution.id);
  await executions.recordOutcome(failed.execution.id, {
    status: "outcome_unknown", images: [], refundStatus: "unknown", errorCode: "ECONNRESET",
    errorMessage: "Authorization: Bearer sk-live-abc Cookie:sid=xyz password=qwerty https://x.test/a?sig=secret",
  });
  const serialized = fs.readFileSync(path.join(root, "local-store.json"), "utf8");
  for (const secret of ["AKIA_TEST", "sig-secret", "GoogleAccessId", "sk-live-abc", "sid=xyz", "qwerty", "sig=secret"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("refund failed never starts a second POST and persisted notification uses only public text", async (t) => {
  const { root, localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const notifications = new NotificationsService({}, localStore);
  let postCount = 0;
  const platform = {
    isArtImageLocalAdapter: () => true,
    executeArtImageLocalGeneration: async () => {
      postCount += 1;
      return {
        status: "failed", images: [], refundStatus: "failed", errorCode: "MACHINE_TERMINAL_ALL_FAILED",
        refundSummary: { reason: "rpc_failed", requestedCredits: 2, alreadyRefunded: false },
        errorMessage: "Authorization: Bearer sk-live-abc Cookie:sid=xyz password=qwerty",
        httpStatus: 200,
      };
    },
  };
  const wechat = {
    enqueueTextMessage: async () => ({}),
    setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
  };
  const service = new DesignJobsService({}, platform, localStore, notifications, {}, wechat, {}, {}, executions);
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.buildDesignPlatformPayload = async () => ({ ...artPayload(), requestId: job.requestId });
  await service.submit(job.id);
  await Promise.all([...service.activeExecutionPromises.values()]);
  assert.equal(postCount, 1);
  assert.equal(localStore.getDesignJob(job.id).retryCount, 0);
  const execution = localStore.listDesignPlatformExecutions({ designJobId: job.id })[0];
  assert.equal(execution.status, "explicit_failed");
  assert.equal(execution.refundStatus, "failed");
  await executions.assertRetryAllowed(job.id).then(
    () => assert.fail("unsafe refund must block retry"),
    (error) => assert.match(error.message, /refund outcome requires explicit manual verification/),
  );
  localStore.transitionDesignPlatformExecution(
    execution.id,
    { status: "explicit_failed" },
    { resolvedAt: new Date().toISOString() },
  );
  await assert.rejects(() => executions.assertRetryAllowed(job.id), /refund outcome requires explicit manual verification/);
  const resolved = await service.resolveExecutionRefund(job.id, execution.id, {
    resolution: "confirmed_refunded",
    expectedWechatAccountId: job.wechatAccountId,
    expectedConversationId: job.conversationId,
    expectedCustomerId: job.customerId,
  }, "operator_refund_audit");
  assert.equal(resolved.refundStatus, "refunded");
  assert.equal(resolved.refundSummary.reason, "rpc_failed");
  assert.equal(resolved.refundSummary.requestedCredits, 2);
  assert.equal(resolved.refundSummary.alreadyRefunded, false);
  assert.equal(resolved.refundSummary.resolution, "confirmed_refunded");
  assert.equal(resolved.refundSummary.reviewer, "operator_refund_audit");
  await executions.assertRetryAllowed(job.id);
  assert.equal(postCount, 1);
  const serialized = fs.readFileSync(path.join(root, "local-store.json"), "utf8");
  for (const secret of ["sk-live-abc", "sid=xyz", "qwerty"]) assert.equal(serialized.includes(secret), false);
});

test("partial success with unsafe refund resumes acceptance after trusted refund resolution without another POST", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  let postCount = 0;
  const service = new DesignJobsService(
    {},
    {
      isArtImageLocalAdapter: () => true,
      executeArtImageLocalGeneration: async () => {
        postCount += 1;
        return {
          status: "completed",
          images: [{ imageId: "partial_1", downloadUrl: "http://127.0.0.1/generated/partial.png" }],
          refundStatus: "failed",
          refundSummary: { reason: "partial_refund_rpc_failed", requestedCredits: 1, alreadyRefunded: false },
          httpStatus: 200,
        };
      },
    },
    localStore,
    { create: async () => ({}) },
    {},
    {
      enqueueTextMessage: async () => ({}),
      setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
    },
    {}, {}, executions,
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.buildDesignPlatformPayload = async () => ({ ...artPayload(), requestId: job.requestId });
  await service.submit(job.id);
  await Promise.all([...service.activeExecutionPromises.values()]);
  const execution = localStore.listDesignPlatformExecutions({ designJobId: job.id })[0];
  assert.equal(execution.status, "completed");
  assert.equal(execution.acceptanceStatus, "manual_review");
  assert.equal(execution.refundStatus, "failed");
  await assert.rejects(() => executions.assertRetryAllowed(job.id), /explicit manual resolution/);

  const resolved = await service.resolveExecutionRefund(job.id, execution.id, {
    resolution: "confirmed_refunded",
    expectedWechatAccountId: job.wechatAccountId,
    expectedConversationId: job.conversationId,
    expectedCustomerId: job.customerId,
  }, "operator_partial_refund");
  assert.equal(resolved.refundStatus, "refunded");
  assert.equal(resolved.acceptanceStatus, "pending");
  assert.equal(resolved.resolvedAt, null);
  assert.equal(resolved.refundSummary.reason, "partial_refund_rpc_failed");

  let acceptedCount = 0;
  service.acceptDurableArtImageExecution = async (executionId) => {
    acceptedCount += 1;
    const claimed = await executions.claimAcceptance(executionId);
    if (claimed) await executions.finishAcceptance(executionId, "accepted");
  };
  await service.reconcileDurableArtImageExecutions();
  assert.equal(acceptedCount, 1);
  assert.equal(localStore.getDesignPlatformExecution(execution.id).acceptanceStatus, "accepted");
  assert.ok(localStore.getDesignPlatformExecution(execution.id).resolvedAt);
  assert.equal(postCount, 1);
  assert.equal(localStore.listDesignPlatformExecutions({ designJobId: job.id }).length, 1);
});

test("safe refunded terminal failure retries at most once with a new stable execution", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  let postCount = 0;
  const platform = {
    isArtImageLocalAdapter: () => true,
    executeArtImageLocalGeneration: async () => {
      postCount += 1;
      return {
        status: "failed", images: [], refundStatus: "refunded", errorCode: "MACHINE_TERMINAL_ALL_FAILED",
        errorMessage: "remote failed", httpStatus: 200,
      };
    },
  };
  const service = new DesignJobsService(
    {}, platform, localStore, { create: async () => ({}) }, {},
    { enqueueTextMessage: async () => ({}), setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }) },
    {}, {}, executions,
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.buildDesignPlatformPayload = async () => ({ ...artPayload(), requestId: job.requestId });
  await service.submit(job.id);
  for (let index = 0; index < 10 && service.activeExecutionPromises.size; index += 1) {
    await Promise.all([...service.activeExecutionPromises.values()]);
  }
  assert.equal(postCount, 2);
  const rows = localStore.listDesignPlatformExecutions({ designJobId: job.id });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].requestId, rows[1].requestId);
  assert.equal(localStore.getDesignJob(job.id).retryCount, 1);
});

test("explicit unknown resolution enforces job identity and unblocks only manual retry", async (t) => {
  const { localStore, job } = localFixture(t);
  const executions = new DesignPlatformExecutionService({}, localStore);
  const begun = await executions.begin({ designJobId: job.id, attemptNo: 1 });
  await executions.claimDispatch(begun.execution.id);
  await executions.markGenerating(begun.execution.id);
  await executions.markOutcomeUnknown(begun.execution.id, "ECONNRESET", "secret remote error");
  const notifications = new NotificationsService({}, localStore);
  const service = new DesignJobsService(
    {}, { isArtImageLocalAdapter: () => true }, localStore, notifications, {},
    { setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }) }, {}, {}, executions,
  );
  await assert.rejects(
    () => service.resolveUnknownExecution(job.id, begun.execution.id, {
      resolution: "confirmed_not_generated_refunded",
      expectedWechatAccountId: job.wechatAccountId,
      expectedConversationId: job.conversationId,
      expectedCustomerId: job.customerId,
    }, ""),
    /reviewer/,
  );
  const resolved = await service.resolveUnknownExecution(job.id, begun.execution.id, {
    resolution: "confirmed_not_generated_refunded",
    expectedWechatAccountId: job.wechatAccountId,
    expectedConversationId: job.conversationId,
    expectedCustomerId: job.customerId,
  }, "operator_1");
  assert.equal(resolved.status, "explicit_failed");
  await executions.assertRetryAllowed(job.id);
  assert.equal(localStore.listNotifications().some((item) => item.title.includes("未知结果已人工核销")), true);
});

test("production execution reads Prisma only and never falls back to LocalStore", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  let prismaReads = 0;
  const prisma = {
    designPlatformExecution: {
      findFirst: async () => { prismaReads += 1; return { id: "prisma-execution", status: "completed" }; },
    },
  };
  const localStore = new Proxy({}, { get: () => () => { throw new Error("LocalStore must not be called"); } });
  const executions = new DesignPlatformExecutionService(prisma, localStore);
  const row = await executions.get("prisma-execution");
  assert.equal(row.id, "prisma-execution");
  assert.equal(prismaReads, 1);
});

test("Prisma dispatch transitions fence job before execution and roll back the job patch on execution CAS loss", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const state = {
    execution: {
      id: "dispatch-exec", designJobId: "dispatch-job", externalJobId: "art_dispatch",
      status: "prepared", acceptanceStatus: "pending", processRunId: "",
    },
    job: { id: "dispatch-job", externalJobId: "art_dispatch", status: "submitted", updatedAt: new Date(0) },
  };
  let phase = "claim";
  const transactionOrders = [];
  const prisma = {
    $transaction: async (fn) => {
      const working = structuredClone(state);
      const order = [];
      const tx = {
        designJob: {
          updateMany: async ({ data }) => {
            order.push("job");
            if (working.job.status === "cancelled") return { count: 0 };
            Object.assign(working.job, data);
            return { count: 1 };
          },
        },
        designPlatformExecution: {
          findUnique: async () => working.execution,
          updateMany: async ({ where, data }) => {
            order.push("execution");
            if (phase === "mark_lost") return { count: 0 };
            if (where.status && working.execution.status !== where.status) return { count: 0 };
            if (where.processRunId && working.execution.processRunId !== where.processRunId) return { count: 0 };
            Object.assign(working.execution, data);
            return { count: 1 };
          },
        },
      };
      try {
        const result = await fn(tx);
        Object.assign(state, working);
        transactionOrders.push(order);
        return result;
      } catch (error) {
        transactionOrders.push(order);
        throw error;
      }
    },
  };
  const executions = new DesignPlatformExecutionService(prisma, {});
  state.execution.processRunId = executions.processRunId;

  assert.ok(await executions.claimDispatch(state.execution.id));
  assert.deepEqual(transactionOrders.at(-1), ["job", "execution"]);
  assert.equal(state.execution.status, "dispatching");
  assert.equal(state.job.status, "submitted");

  phase = "mark_lost";
  assert.equal(await executions.markGenerating(state.execution.id), null);
  assert.deepEqual(transactionOrders.at(-1), ["job", "execution"]);
  assert.equal(state.job.status, "submitted", "jobPatch must roll back when execution CAS loses");
  assert.equal(state.execution.status, "dispatching");

  phase = "mark_won";
  assert.ok(await executions.markGenerating(state.execution.id));
  assert.deepEqual(transactionOrders.at(-1), ["job", "execution"]);
  assert.equal(state.job.status, "generating");
  assert.equal(state.execution.status, "generating");
});

test("Prisma cancellation uses job-first broad CAS when a prepared read becomes generating", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const state = {
    execution: {
      id: "cancel-cas-exec", designJobId: "cancel-cas-job", externalJobId: "art_cancel_cas",
      status: "prepared", acceptanceStatus: "pending", refundStatus: "pending",
    },
    job: { id: "cancel-cas-job", externalJobId: "art_cancel_cas", status: "submitted" },
  };
  const order = [];
  const matchesStatus = (actual, expected) => {
    if (typeof expected === "string") return actual === expected;
    if (Array.isArray(expected?.in)) return expected.in.includes(actual);
    return true;
  };
  const prisma = {
    $transaction: async (fn) => fn({
      designJob: {
        updateMany: async ({ data }) => {
          order.push("job");
          state.execution.status = "generating";
          Object.assign(state.job, data);
          return { count: 1 };
        },
        findUnique: async () => state.job,
      },
      designPlatformExecution: {
        findUnique: async () => ({ ...state.execution, status: order.length ? state.execution.status : "prepared" }),
        updateMany: async ({ where, data }) => {
          order.push(`execution:${typeof where.status === "string" ? where.status : where.status.in.join("|")}`);
          if (!matchesStatus(state.execution.status, where.status)) return { count: 0 };
          if (where.acceptanceStatus && !matchesStatus(state.execution.acceptanceStatus, where.acceptanceStatus)) {
            return { count: 0 };
          }
          Object.assign(state.execution, data);
          return { count: 1 };
        },
      },
    }),
  };
  const executions = new DesignPlatformExecutionService(prisma, {});
  const cancelled = await executions.requestCancellation(state.execution.externalJobId);
  assert.deepEqual(order, ["job", "execution:prepared", "execution:dispatching|generating"]);
  assert.equal(state.job.status, "cancelled");
  assert.equal(cancelled.status, "cancel_requested");
  assert.equal(cancelled.acceptanceStatus, "rejected");
});

test("Prisma stale recovery is job-first with rollback, while cancel_requested recovery is execution-only", async (t) => {
  const previousMode = appConfig.useLocalStore;
  const previousTimeoutMs = appConfig.designPlatformTimeoutMs;
  appConfig.useLocalStore = false;
  appConfig.designPlatformTimeoutMs = 1;
  t.after(() => {
    appConfig.useLocalStore = previousMode;
    appConfig.designPlatformTimeoutMs = previousTimeoutMs;
  });
  const state = {
    normal: {
      id: "recover-normal", designJobId: "recover-job", externalJobId: "art_recover_normal",
      status: "generating", acceptanceStatus: "pending", processRunId: "crashed-run",
    },
    cancelled: {
      id: "recover-cancelled", designJobId: "cancelled-job", externalJobId: "art_recover_cancelled",
      status: "cancel_requested", acceptanceStatus: "rejected", processRunId: "crashed-run",
    },
    job: { id: "recover-job", externalJobId: "art_recover_normal", status: "generating" },
  };
  const transactionOrder = [];
  const directExecutionWrites = [];
  const prisma = {
    $transaction: async (fn) => {
      const working = structuredClone(state);
      const order = [];
      try {
        const result = await fn({
          designJob: {
            updateMany: async ({ data }) => {
              order.push("job");
              Object.assign(working.job, data);
              return { count: 1 };
            },
          },
          designPlatformExecution: {
            updateMany: async () => { order.push("execution"); return { count: 0 }; },
          },
        });
        Object.assign(state, working);
        transactionOrder.push(...order);
        return result;
      } catch (error) {
        transactionOrder.push(...order);
        throw error;
      }
    },
    designPlatformExecution: {
      findMany: async () => [state.normal, state.cancelled],
      updateMany: async ({ where, data }) => {
        if (!where.id) return { count: 0 };
        directExecutionWrites.push(where.id);
        if (where.id !== state.cancelled.id || state.cancelled.status !== where.status) return { count: 0 };
        Object.assign(state.cancelled, data);
        return { count: 1 };
      },
    },
  };
  const executions = new DesignPlatformExecutionService(prisma, {});
  const recovered = await executions.recoverStaleExecutions();
  assert.deepEqual(transactionOrder, ["job", "execution"]);
  assert.equal(state.job.status, "generating", "job mutation must roll back when stale execution CAS loses");
  assert.equal(state.normal.status, "generating");
  assert.deepEqual(directExecutionWrites, [state.cancelled.id]);
  assert.equal(state.cancelled.status, "outcome_unknown");
  assert.equal(state.cancelled.acceptanceStatus, "rejected");
  assert.deepEqual(recovered.map((item) => item.id), [state.cancelled.id]);
});

test("Prisma begin CAS refuses to revive a concurrently cancelled job and rolls back execution", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const state = { executions: [] };
  const prisma = {
    $transaction: async (fn) => fn({
      designPlatformExecution: {
        findUnique: async () => null,
        findFirst: async () => null,
        create: async ({ data }) => { state.executions.push(data); return { id: "race-execution", ...data }; },
      },
      designJob: {
        findUnique: async () => ({ id: "race-job", status: "draft", externalJobId: null, revisionCount: 0, updatedAt: new Date(0) }),
        updateMany: async () => ({ count: 0 }),
      },
    }),
    designPlatformExecution: { findUnique: async () => null },
  };
  const executions = new DesignPlatformExecutionService(prisma, {});
  await assert.rejects(
    () => executions.begin({ designJobId: "race-job", attemptNo: 1 }),
    /changed while beginning/,
  );
});

test("Prisma atomic acceptance rolls back candidates and job when execution CAS fails", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const state = {
    execution: {
      id: "accept-exec", designJobId: "accept-job", designRevisionId: null, externalJobId: "art_accept",
      status: "completed", acceptanceStatus: "accepting", processRunId: "other-run",
    },
    job: { id: "accept-job", status: "submitted", externalJobId: "art_accept", revisionCount: 0, updatedAt: new Date(0) },
    images: [],
  };
  const prisma = {
    $transaction: async (fn) => {
      const working = structuredClone(state);
      const tx = {
        designPlatformExecution: {
          findUnique: async () => working.execution,
          updateMany: async () => ({ count: 0 }),
        },
        designJob: {
          findUnique: async () => working.job,
          updateMany: async ({ data }) => { Object.assign(working.job, data); return { count: 1 }; },
        },
        designImageCandidate: {
          upsert: async ({ create }) => { working.images.push(create); return create; },
        },
      };
      const result = await fn(tx);
      Object.assign(state, working);
      return result;
    },
  };
  const executions = new DesignPlatformExecutionService(prisma, {});
  await assert.rejects(
    () => executions.commitAcceptedResult({
      executionId: "accept-exec",
      images: [{ imageId: "candidate_1", position: 1 }],
      resultImageIds: ["candidate_1"],
      nextStatus: "quick_confirm",
    }),
    /acceptance CAS failed/,
  );
  assert.deepEqual(state.images, []);
  assert.equal(state.job.status, "submitted");
  assert.equal(state.execution.acceptanceStatus, "accepting");
});

test("Prisma begin transaction rolls back execution if business state update fails", async (t) => {
  const previousMode = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  t.after(() => { appConfig.useLocalStore = previousMode; });
  const state = { executions: [], job: { id: "job-prisma-1", status: "draft", revisionCount: 0 } };
  const prisma = {
    $transaction: async (fn) => {
      const working = structuredClone(state);
      const tx = {
        designPlatformExecution: {
          findUnique: async () => null,
          findFirst: async () => null,
          create: async ({ data }) => {
            const row = { id: "execution-prisma-1", ...data, status: "prepared", acceptanceStatus: "pending" };
            working.executions.push(row);
            return row;
          },
        },
        designJob: {
          findUnique: async () => working.job,
          updateMany: async () => { throw new Error("simulated business update failure"); },
        },
      };
      const result = await fn(tx);
      Object.assign(state, working);
      return result;
    },
  };
  const executions = new DesignPlatformExecutionService(prisma, {});
  await assert.rejects(() => executions.begin({ designJobId: state.job.id, attemptNo: 1 }), /simulated business update failure/);
  assert.equal(state.executions.length, 0);
  assert.equal(state.job.status, "draft");
});
