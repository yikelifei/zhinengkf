"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { acquireAccountLock, acquireNamedLock, writeFileAtomic } = require("./wechat-bridge-durable-fs");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR ? path.resolve(process.env.DESKTOP_RUNTIME_DIR) : path.join(desktopRoot, ".runtime");
const defaultDispatchDir = path.join(runtimeDir, "wechat-dispatch");
const defaultInboxDir = path.join(runtimeDir, "wechat-inbox");
const defaultLockDir = path.join(runtimeDir, "wechat-bridge-locks");
const defaultBlockedDir = path.join(runtimeDir, "personal-wechat-blocked");
const defaultStatusFile = path.join(runtimeDir, "personal-wechat-bridge-status.json");
const defaultAccountsConfigFile = path.join(runtimeDir, "personal-wechat-accounts.json");
const defaultRpaConfigFile = path.join(runtimeDir, "personal-wechat-rpa.json");
const defaultLocalStorageRoot = path.join(desktopRoot, "storage");
const powershellHelper = path.join(__dirname, "personal-wechat-window.ps1");
const defaultApiBase = `http://127.0.0.1:${process.env.API_PORT || "3200"}/api`;
const BRIDGE_DISPATCH_VERSION = "wechat_bridge_dispatch_v1";
const BRIDGE_ACK_VERSION = "wechat_bridge_ack_v1";
const ACCOUNTS_CONFIG_VERSION = "personal_wechat_accounts_v1";

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    printHelp();
    return;
  }
  const config = readConfig();
  if (hasArg("--status")) {
    printStatus(config);
    return;
  }
  const probeAccountId = valueArg("--probe-account");
  if (probeAccountId) {
    const account = resolveProbeAccount(probeAccountId, config);
    const result = await executeBoundWechatActions({ binding: account }, config, "probe");
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
    return;
  }

  while (true) {
    const startedAt = new Date().toISOString();
    try {
      const result = await runOnce(config);
      writeStatus(config.statusFile, buildStatus(result, config, startedAt));
      printSummary(result);
    } catch (error) {
      writeStatus(config.statusFile, buildStatus(null, config, startedAt, error));
      console.error(error?.stack || error);
      if (!config.watch) throw error;
    }
    if (!config.watch) break;
    await sleep(config.intervalMs);
  }
}

async function runOnce(config = readConfig()) {
  for (const directory of [config.dispatchDir, config.inboxDir, config.lockDir, config.blockedDir]) {
    if (directory) fs.mkdirSync(directory, { recursive: true });
  }
  const ackRecovery = await recoverPendingAcks(config);
  const files = selectDispatchFiles(listDispatchFiles(config.dispatchDir), config.limit);
  const groups = groupDispatchFilesByAccount(files);
  const sessionQueues = groupAccountQueuesByWindowsSession(groups, config);
  const sessionResults = await Promise.all(
    [...sessionQueues.values()].map(async (accountQueues) => {
      const results = [];
      for (const [accountId, accountFiles] of accountQueues) {
        results.push(...await processAccountQueue(accountId, accountFiles, config));
      }
      return results;
    }),
  );
  const items = sessionResults.flat();
  return {
    scanned: files.length,
    processed: items.filter((item) => ["sent_ack_written", "ack_scan_completed", "delivery_unknown"].includes(item.status)),
    skipped: items.filter((item) => ["skipped", "account_lock_busy", "ack_pending_scan"].includes(item.status)),
    blocked: items.filter((item) => ["blocked", "blocked_existing"].includes(item.status)),
    failed: items.filter((item) => item.status === "failed"),
    ackRecovery,
    dispatchDir: config.dispatchDir,
    inboxDir: config.inboxDir,
  };
}

function groupDispatchFilesByAccount(files) {
  const groups = new Map();
  for (const filePath of files) {
    let accountId = "__invalid__";
    try {
      accountId = String(readJsonFile(filePath)?.wechatAccountId || "__invalid__").trim() || "__invalid__";
    } catch {
      // Invalid JSON remains isolated from valid account queues.
    }
    const current = groups.get(accountId) || [];
    current.push(filePath);
    groups.set(accountId, current);
  }
  return groups;
}

function selectDispatchFiles(files, limit) {
  const groups = groupDispatchFilesByAccount(files);
  const queues = [...groups.values()].map((items) => [...items]);
  const selected = [];
  while (selected.length < limit && queues.some((items) => items.length)) {
    for (const items of queues) {
      if (selected.length >= limit) break;
      const item = items.shift();
      if (item) selected.push(item);
    }
  }
  return selected;
}

function groupAccountQueuesByWindowsSession(groups, config) {
  const sessions = new Map();
  for (const entry of groups.entries()) {
    const [accountId] = entry;
    const account = config.accountsConfig?.accounts?.find((item) => String(item.wechatAccountId) === String(accountId));
    const sessionKey = account && Number.isInteger(Number(account.windowsSessionId))
      ? `windows-session-${Number(account.windowsSessionId)}`
      : `unbound-${safeFileSegment(accountId)}`;
    const current = sessions.get(sessionKey) || [];
    current.push(entry);
    sessions.set(sessionKey, current);
  }
  return sessions;
}

async function processAccountQueue(accountId, files, config) {
  if (accountId === "__invalid__") {
    const results = [];
    for (const filePath of files) results.push(await processDispatchFile(filePath, config));
    return results;
  }
  const lock = acquireAccountLock(accountId, config);
  if (!lock) {
    return files.map((filePath) => ({
      fileName: path.basename(filePath),
      taskId: "",
      wechatAccountId: accountId,
      status: "account_lock_busy",
      reason: "account_lock_busy",
    }));
  }
  const account = config.accountsConfig?.accounts?.find((item) => String(item.wechatAccountId) === String(accountId));
  const sessionLock = config.sendEnabled && account
    ? acquireNamedLock(`windows-session-${Number(account.windowsSessionId)}`, config, {
      owner: "personal-wechat-session",
      metadata: { windowsSessionId: Number(account.windowsSessionId) },
    })
    : null;
  if (config.sendEnabled && account && !sessionLock) {
    lock.release();
    return files.map((filePath) => ({
      fileName: path.basename(filePath),
      taskId: "",
      wechatAccountId: accountId,
      status: "account_lock_busy",
      reason: "windows_session_input_lock_busy",
    }));
  }
  try {
    const results = [];
    for (const filePath of files) {
      let claimedPath = filePath;
      if (config.sendEnabled) {
        claimedPath = claimDispatchFile(filePath, config.dispatchDir);
        if (!claimedPath) {
          results.push({
            fileName: path.basename(filePath),
            taskId: "",
            wechatAccountId: accountId,
            status: "skipped",
            reason: "dispatch_already_claimed",
          });
          continue;
        }
      }
      try {
        const result = await processDispatchFile(claimedPath, config);
        if (config.sendEnabled && result.archiveOutcome) {
          result.archivedDispatchPath = archiveDispatchFile(claimedPath, config.dispatchDir, result.archiveOutcome);
        } else if (claimedPath !== filePath) {
          result.restoredDispatchPath = restoreClaimedDispatchFile(claimedPath, config.dispatchDir);
        }
        results.push(result);
      } catch (error) {
        const result = {
          fileName: path.basename(filePath),
          taskId: "",
          wechatAccountId: accountId,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        if (claimedPath !== filePath && fs.existsSync(claimedPath)) {
          result.archivedDispatchPath = archiveDispatchFile(claimedPath, config.dispatchDir, "uncertain");
        }
        results.push(result);
      }
    }
    return results;
  } finally {
    sessionLock?.release();
    lock.release();
  }
}

async function processDispatchFile(filePath, config) {
  let dispatch;
  try {
    dispatch = readJsonFile(filePath);
  } catch (error) {
    return blockDispatch(filePath, {}, config, `invalid dispatch json: ${error.message}`, "invalid_dispatch_json");
  }

  const validation = validateDispatchPayload(dispatch, filePath);
  if (!validation.ok) return blockDispatch(filePath, dispatch, config, `invalid dispatch: ${validation.reason}`, "invalid_dispatch");
  if (!config.sendEnabled) {
    return summarizeDispatch(filePath, dispatch, "skipped", "PERSONAL_WECHAT_SEND is not 1; dispatch observed only");
  }
  if (!config.scanAckInbox) {
    return blockDispatch(filePath, dispatch, config, "ack inbox scanning must stay enabled for real personal WeChat sends", "ack_scan_required");
  }

  const blockedFile = blockedMarkerPath(config.blockedDir, dispatch, filePath);
  if (fs.existsSync(blockedFile)) {
    const marker = readJsonIfExists(blockedFile) || {};
    return { ...summarizeDispatch(filePath, dispatch, "blocked_existing", marker.errorMessage || "dispatch is blocked"), blockedFile };
  }
  if (dispatchExpired(dispatch)) return blockDispatch(filePath, dispatch, config, `dispatch expired at ${dispatch.expiresAt}`, "dispatch_expired");

  let sourceOutbox;
  try {
    sourceOutbox = loadSourceOutbox(dispatch);
  } catch (error) {
    return blockDispatch(filePath, dispatch, config, `source outbox unavailable: ${error.message}`, "source_outbox_unavailable");
  }
  const outboxValidation = validateSourceOutbox(dispatch, sourceOutbox, config);
  if (!outboxValidation.ok) {
    return blockDispatch(filePath, dispatch, config, `invalid source outbox: ${outboxValidation.reason}`, "invalid_source_outbox");
  }

  const pendingAck = findPendingSentAck(config.inboxDir, dispatch, sourceOutbox.payload);
  if (pendingAck) {
    const scanResult = await safeScanAckInbox(config);
    return {
      ...summarizeDispatch(filePath, dispatch, "ack_scan_completed", "existing sent ack remains durable"),
      ackFile: pendingAck,
      scanResult,
      archiveOutcome: "processed",
    };
  }

  const pendingVerification = await verifyPendingDispatch(dispatch, sourceOutbox.payload, config);
  if (!pendingVerification.ok) {
    return {
      fileName: path.basename(filePath),
      taskId: dispatch.taskId || "",
      status: "delivery_unknown",
      reason: `dispatch is no longer a trusted pending item: ${pendingVerification.reason}`,
      archiveOutcome: "uncertain",
    };
  }

  const binding = resolveAccountBinding(dispatch, config);
  if (!binding.ok) return blockDispatch(filePath, dispatch, config, binding.reason, binding.code || "account_binding_invalid");
  const actionPlan = buildActionPlan(dispatch.sendPlan.actions, config);
  if (!actionPlan.ok) return blockDispatch(filePath, dispatch, config, actionPlan.reason, "action_plan_invalid");

  const operationPayload = buildOperationPayload(dispatch, binding, actionPlan.actions, config);
  let sendResult;
  try {
    const executor = typeof config.operationExecutor === "function" ? config.operationExecutor : executeBoundWechatActions;
    sendResult = await Promise.resolve(executor(operationPayload, config, "send"));
  } catch (error) {
    return deliveryUnknown(filePath, dispatch, `personal WeChat operation failed after dispatch claim: ${error.message}`);
  }
  if (!sendResult?.ok) {
    return deliveryUnknown(
      filePath,
      dispatch,
      sendResult?.errorMessage || "personal WeChat operation could not be verified after dispatch claim",
      sendResult?.code || "operation_unverified",
    );
  }
  const operationVerified =
    sendResult.operationVerified === true &&
    sendResult.accountVerified === true &&
    sendResult.chatVerified === true &&
    sendResult.recentMessageVerified === true &&
    Number(sendResult.actionCount) === actionPlan.actions.length;
  if (!operationVerified) {
    return deliveryUnknown(
      filePath,
      dispatch,
      "personal WeChat operation returned incomplete verification proof after dispatch claim",
      "operation_proof_incomplete",
    );
  }

  const ackPayload = buildAckPayload(dispatch, sourceOutbox.payload, "sent", {
    source: "personal_wechat_bridge",
    automation: config.driver === "wechatauto_rpa" ? "wechatauto_rpa" : "bound_windows_uia",
    sessionId: binding.account.sessionId,
    actionCount: actionPlan.actions.length,
    operationVerified: true,
  });
  const ackFile = writeAckFile(config.inboxDir, ackPayload);
  const scanResult = await safeScanAckInbox(config);
  return {
    fileName: path.basename(filePath),
    taskId: dispatch.taskId || "",
    status: "sent_ack_written",
    ackFile,
    scanResult,
    archiveOutcome: "processed",
  };
}

async function verifyPendingDispatch(dispatch, outboxPayload, config) {
  if (typeof config.verifyPendingDispatch === "function") {
    try {
      const result = await config.verifyPendingDispatch({ dispatch, outboxPayload });
      return result?.ok ? { ok: true, source: result.source || "external_verifier" } : { ok: false, reason: String(result?.reason || "pending verifier rejected dispatch") };
    } catch (error) {
      return { ok: false, reason: `pending verifier failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  try {
    const url = new URL(`${config.apiBase}/wechat/bridge/outbox`);
    url.searchParams.set("wechatAccountId", String(dispatch.wechatAccountId || ""));
    url.searchParams.set("conversationId", String(dispatch.conversationId || ""));
    const customerId = String(outboxPayload?.target?.customerId || "");
    if (customerId) url.searchParams.set("customerId", customerId);
    const response = await getJson(url.toString());
    const pending = Array.isArray(response?.pending) ? response.pending : [];
    const match = pending.find((entry) =>
      String(entry?.taskId || "") === String(dispatch.taskId || "") &&
      String(entry?.attemptId || "") === String(dispatch.attemptId || "") &&
      String(entry?.wechatAccountId || "") === String(dispatch.wechatAccountId || "") &&
      String(entry?.conversationId || "") === String(dispatch.conversationId || "") &&
      String(entry?.customerId || "") === customerId &&
      String(entry?.fileName || "") === String(dispatch.sourceOutboxFileName || ""),
    );
    return match ? { ok: true, source: "bridge_outbox_api" } : { ok: false, reason: "matching task and attempt are absent from bridge outbox pending" };
  } catch (error) {
    return { ok: false, reason: `bridge outbox pending check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function deliveryUnknown(filePath, dispatch, reason, code = "delivery_unknown") {
  return {
    fileName: path.basename(filePath),
    taskId: String(dispatch?.taskId || ""),
    wechatAccountId: String(dispatch?.wechatAccountId || ""),
    conversationId: String(dispatch?.conversationId || ""),
    status: "delivery_unknown",
    code,
    reason: singleLine(reason),
    archiveOutcome: "uncertain",
  };
}

function validateDispatchPayload(dispatch, filePath) {
  if (!isPlainObject(dispatch)) return { ok: false, reason: "payload must be an object" };
  if (dispatch.version !== BRIDGE_DISPATCH_VERSION) return { ok: false, reason: "unsupported dispatch version" };
  for (const key of ["taskId", "attemptId", "wechatAccountId", "conversationId", "sourceOutboxFileName", "sourceOutboxFilePath"]) {
    if (!String(dispatch[key] || "").trim()) return { ok: false, reason: `${key} is required` };
  }
  if (path.basename(String(dispatch.sourceOutboxFilePath)) !== String(dispatch.sourceOutboxFileName)) {
    return { ok: false, reason: "source outbox basename mismatch" };
  }
  if (!isPlainObject(dispatch.target)) return { ok: false, reason: "target is required" };
  if (String(dispatch.target.wechatAccountId || "") !== String(dispatch.wechatAccountId)) return { ok: false, reason: "target account mismatch" };
  if (String(dispatch.target.conversationId || "") !== String(dispatch.conversationId)) return { ok: false, reason: "target conversation mismatch" };
  if (!String(dispatch.target.customerId || "").trim()) return { ok: false, reason: "target customerId is required" };
  if (!String(dispatch.target.conversationTitle || "").trim()) return { ok: false, reason: "target conversationTitle is required" };
  const recentMessageText = String(dispatch.preflight?.expectedRecentMessageText || dispatch.target.recentMessageText || "").trim();
  if (!recentMessageText) return { ok: false, reason: "expected recent message text is required" };
  const preflight = dispatch.preflight || {};
  if (
    String(preflight.expectedWechatAccountId || "") !== String(dispatch.wechatAccountId) ||
    String(preflight.expectedConversationId || "") !== String(dispatch.conversationId) ||
    String(preflight.expectedCustomerId || "") !== String(dispatch.target.customerId) ||
    String(preflight.expectedConversationTitle || "").trim() !== String(dispatch.target.conversationTitle).trim() ||
    preflight.rejectIfAnyCheckFails !== true ||
    preflight.rejectIfWindowChanged !== true ||
    preflight.rejectIfExpired !== true ||
    preflight.rejectIfOutboxMissing !== true
  ) return { ok: false, reason: "strict preflight identity and rejection policy are required" };
  if (!Array.isArray(dispatch.sendPlan?.actions) || dispatch.sendPlan.actions.length < 1) {
    return { ok: false, reason: "sendPlan.actions must not be empty" };
  }
  const constraints = dispatch.sendPlan?.constraints || {};
  if (
    constraints.singleAccountLock !== true ||
    constraints.requireActiveWindowMatch !== true ||
    constraints.requireRecentCustomerMatch !== true ||
    constraints.doNotMarkSentWithoutAck !== true
  ) return { ok: false, reason: "strict send constraints are required" };
  if (path.basename(path.resolve(filePath)) !== path.basename(filePath)) return { ok: false, reason: "dispatch file must be a direct file" };
  return { ok: true };
}

function validateSourceOutbox(dispatch, sourceOutbox, config = {}) {
  const payload = sourceOutbox?.payload || {};
  const target = isPlainObject(payload.target) ? payload.target : {};
  const sendPlan = isPlainObject(payload.sendPlan) ? payload.sendPlan : {};
  const sendTarget = isPlainObject(sendPlan.target) ? sendPlan.target : {};
  if (payload.version !== "wechat_bridge_outbox_v1") return { ok: false, reason: "unsupported outbox version" };
  if (!/^[a-f0-9]{64}$/i.test(String(payload.ackToken || ""))) return { ok: false, reason: "ackToken is missing or invalid" };
  for (const key of ["taskId", "wechatAccountId", "conversationId"]) {
    if (String(payload[key] || "") !== String(dispatch[key] || "")) return { ok: false, reason: `${key} mismatch` };
  }
  const customerId = String(dispatch.target?.customerId || "");
  if (
    String(target.wechatAccountId || "") !== String(dispatch.wechatAccountId) ||
    String(target.conversationId || "") !== String(dispatch.conversationId) ||
    String(target.customerId || "") !== customerId ||
    String(target.conversationTitle || "").trim() !== String(dispatch.target?.conversationTitle || "").trim() ||
    String(target.recentMessageText || "").trim() !== String(dispatch.preflight?.expectedRecentMessageText || "").trim()
  ) return { ok: false, reason: "outbox target identity mismatch" };
  if (
    String(sendTarget.wechatAccountId || "") !== String(dispatch.wechatAccountId) ||
    String(sendTarget.conversationId || "") !== String(dispatch.conversationId) ||
    String(sendTarget.customerId || "") !== customerId
  ) return { ok: false, reason: "outbox sendPlan target identity mismatch" };
  const sourcePlan = buildActionPlan(sendPlan.actions, config);
  const dispatchPlan = buildActionPlan(dispatch.sendPlan?.actions, config);
  if (!sourcePlan.ok) return { ok: false, reason: sourcePlan.reason };
  if (!dispatchPlan.ok) return { ok: false, reason: dispatchPlan.reason };
  if (JSON.stringify(sourcePlan.actions) !== JSON.stringify(dispatchPlan.actions)) return { ok: false, reason: "dispatch actions differ from source outbox" };
  if (Number(sendPlan.actionCount) !== sourcePlan.actions.length) return { ok: false, reason: "outbox actionCount mismatch" };
  const sourceConstraints = sendPlan.constraints || {};
  if (
    sourceConstraints.singleAccountLock !== true ||
    sourceConstraints.requireActiveWindowMatch !== true ||
    sourceConstraints.requireRecentCustomerMatch !== true ||
    sourceConstraints.doNotMarkSentWithoutAck !== true
  ) return { ok: false, reason: "outbox strict send constraints are required" };
  const guardPassed = payload.guardSnapshot?.status === "passed" || payload.guardSnapshot?.ok === true || payload.context?.guardStatus === "passed";
  if (!guardPassed) return { ok: false, reason: "outbox guard snapshot did not pass" };
  if (!String(target.windowSnapshotId || "") || String(target.windowSnapshotId) !== String(payload.context?.windowSnapshotId || "")) {
    return { ok: false, reason: "outbox window snapshot identity mismatch" };
  }
  return { ok: true };
}

function buildActionPlan(actions, config = {}) {
  if (!Array.isArray(actions) || !actions.length) return { ok: false, reason: "actions are required", actions: [] };
  const normalized = [];
  for (const action of actions) {
    if (!isPlainObject(action)) return { ok: false, reason: "action must be an object", actions: [] };
    const type = String(action.type || "").trim();
    if (type === "text") {
      const text = String(action.text || "").trim();
      if (!text) return { ok: false, reason: "text action must not be empty", actions: [] };
      normalized.push({ type, text });
      continue;
    }
    if (type === "image") {
      const filePath = resolveLocalImage(action.filePath, config.localStorageRoot || defaultLocalStorageRoot);
      if (!filePath) return { ok: false, reason: "image action must use an existing regular file inside local storage", actions: [] };
      normalized.push({ type, filePath });
      continue;
    }
    return { ok: false, reason: `unsupported action type: ${type || "empty"}`, actions: [] };
  }
  return { ok: true, reason: "action plan is valid", actions: normalized };
}

function resolveLocalImage(value, storageRootValue) {
  const raw = String(value || "").trim();
  if (!raw || /^[a-z]+:\/\//i.test(raw)) return "";
  const storageRoot = path.resolve(storageRootValue || defaultLocalStorageRoot);
  const candidates = path.isAbsolute(raw) ? [path.resolve(raw)] : [path.resolve(desktopRoot, raw), path.resolve(storageRoot, raw)];
  for (const candidate of candidates) {
    const relative = path.relative(storageRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      if (!fs.lstatSync(candidate).isFile()) continue;
      const realRoot = fs.realpathSync(storageRoot);
      const realFile = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realFile);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) continue;
      return realFile;
    } catch {
      // Continue checking candidates.
    }
  }
  return "";
}

function normalizeRpaInstances(value) {
  if (!Array.isArray(value)) return [];
  return value.map((instance) => ({
    wechatAccountId: String(instance?.wechatAccountId || "").trim(),
    endpoint: String(instance?.endpoint || "").trim(),
    token: String(instance?.token || "").trim(),
    accountNickname: String(instance?.accountNickname || "").trim(),
  }));
}

function normalizeLoopbackRpaEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    if (
      url.protocol !== "http:" ||
      !isLoopback ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== "/")
    ) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function rpaResolutionFailure(code, message) {
  return { ok: false, code, reason: message, errorMessage: message };
}

function resolveRpaInstance(binding, config, options = {}) {
  const instances = Array.isArray(config.rpaInstances) ? config.rpaInstances : [];
  const wechatAccountId = String(binding?.wechatAccountId || "").trim();
  const boundNickname = String(binding?.accountNickname || "").trim();

  if (instances.length > 0) {
    const matches = instances.filter((instance) => String(instance?.wechatAccountId || "").trim() === wechatAccountId);
    if (matches.length === 0) {
      return rpaResolutionFailure("rpa_instance_missing", `no RPA instance is registered for wechatAccountId ${wechatAccountId || "<empty>"}`);
    }
    if (matches.length !== 1) {
      return rpaResolutionFailure("rpa_instance_duplicate", `wechatAccountId ${wechatAccountId} must map to exactly one RPA instance`);
    }
    const instance = matches[0];
    const accountNickname = String(instance.accountNickname || "").trim();
    const token = String(instance.token || "").trim();
    const endpoint = normalizeLoopbackRpaEndpoint(instance.endpoint);
    if (!accountNickname || !token || !String(instance.endpoint || "").trim()) {
      return rpaResolutionFailure("rpa_instance_invalid", `RPA instance ${wechatAccountId} requires endpoint, token and accountNickname`);
    }
    if (!endpoint) {
      return rpaResolutionFailure("rpa_endpoint_invalid", `RPA instance ${wechatAccountId} endpoint must be loopback-only HTTP`);
    }
    if (!boundNickname || boundNickname !== accountNickname) {
      return rpaResolutionFailure("account_nickname_mismatch", `RPA instance ${wechatAccountId} nickname does not match the bound WeChat account`);
    }
    return { ok: true, instance: { wechatAccountId, endpoint, token, accountNickname } };
  }

  const endpoint = normalizeLoopbackRpaEndpoint(config.rpaEndpoint);
  const token = String(config.rpaToken || "").trim();
  const accountNickname = String(config.rpaAccountNickname || "").trim();
  if (!endpoint) return rpaResolutionFailure("rpa_endpoint_invalid", "personal WeChat RPA endpoint must be loopback-only HTTP");
  if (!token) return rpaResolutionFailure("rpa_config_invalid", "personal WeChat RPA token is required");
  if (options.requireConfiguredNickname && !accountNickname) {
    return rpaResolutionFailure("account_nickname_mismatch", "configured RPA account nickname is required for the bound WeChat account");
  }
  if (accountNickname && boundNickname !== accountNickname) {
    return rpaResolutionFailure("account_nickname_mismatch", "configured RPA account nickname does not match the bound WeChat account");
  }
  return { ok: true, instance: { wechatAccountId, endpoint, token, accountNickname: accountNickname || boundNickname } };
}

function resolveAccountBinding(dispatch, config) {
  const accountsValidation = validateAccountsConfig(config.accountsConfig, config.driver);
  if (!accountsValidation.ok) return accountsValidation;
  const matches = config.accountsConfig.accounts.filter((item) => String(item.wechatAccountId) === String(dispatch.wechatAccountId));
  if (matches.length !== 1) return { ok: false, code: "account_binding_missing", reason: "wechatAccountId must map to exactly one configured process/window/session" };
  const account = matches[0];
  if (config.driver === "wechatauto_rpa") {
    const rpaInstance = resolveRpaInstance(account, config, { requireConfiguredNickname: true });
    if (!rpaInstance.ok) return rpaInstance;
  }
  const conversations = Array.isArray(account.conversations) ? account.conversations : [];
  const conversationMatches = conversations.filter((item) => String(item.conversationId) === String(dispatch.conversationId));
  if (conversationMatches.length !== 1) return { ok: false, code: "conversation_binding_missing", reason: "conversationId must map to exactly one conversation in the bound account" };
  const conversation = conversationMatches[0];
  if (String(conversation.customerId || "") !== String(dispatch.target.customerId || "")) {
    return { ok: false, code: "customer_binding_mismatch", reason: "configured conversation customerId does not match dispatch target" };
  }
  if (String(conversation.chatTitle || "").trim() !== String(dispatch.target.conversationTitle || "").trim()) {
    return { ok: false, code: "chat_binding_mismatch", reason: "configured conversation chatTitle does not match dispatch target" };
  }
  return { ok: true, account, conversation };
}

function validateAccountsConfig(accountsConfig, driver = "windows_uia") {
  if (!isPlainObject(accountsConfig) || accountsConfig.version !== ACCOUNTS_CONFIG_VERSION || !Array.isArray(accountsConfig.accounts)) {
    return { ok: false, code: "accounts_config_invalid", reason: `accounts config must use version ${ACCOUNTS_CONFIG_VERSION}` };
  }
  const accountIds = new Set();
  const processWindows = new Set();
  const sessions = new Set();
  for (const account of accountsConfig.accounts) {
    const ui = account?.ui || {};
    const requiredText = ["wechatAccountId", "sessionId", "windowHandle", "processName", "accountText"];
    if (requiredText.some((key) => !String(account?.[key] || "").trim())) {
      return { ok: false, code: "accounts_config_invalid", reason: `account binding is missing required identity fields` };
    }
    if (!Number.isInteger(Number(account.processId)) || Number(account.processId) <= 0 || !Number.isInteger(Number(account.windowsSessionId)) || Number(account.windowsSessionId) < 0) {
      return { ok: false, code: "accounts_config_invalid", reason: "account binding requires processId and windowsSessionId" };
    }
    if (driver === "wechatauto_rpa" && !String(account.accountNickname || "").trim()) {
      return { ok: false, code: "accounts_config_invalid", reason: "RPA account binding requires accountNickname" };
    }
    if (driver !== "wechatauto_rpa") {
      for (const key of ["accountAutomationId", "chatTitleAutomationId", "messageListAutomationId", "inputAutomationId"]) {
        if (!String(ui[key] || "").trim()) return { ok: false, code: "accounts_config_invalid", reason: `account ui.${key} is required` };
      }
    }
    const accountId = String(account.wechatAccountId);
    const processWindow = `${Number(account.processId)}:${String(account.windowHandle).toLowerCase()}`;
    const session = String(account.sessionId);
    if (accountIds.has(accountId) || processWindows.has(processWindow) || sessions.has(session)) {
      return { ok: false, code: "accounts_config_duplicate", reason: "account, process/window and session bindings must be unique" };
    }
    accountIds.add(accountId);
    processWindows.add(processWindow);
    sessions.add(session);
    const conversationIds = new Set();
    for (const conversation of Array.isArray(account.conversations) ? account.conversations : []) {
      if (!String(conversation?.conversationId || "").trim() || !String(conversation?.customerId || "").trim() || !String(conversation?.chatTitle || "").trim()) {
        return { ok: false, code: "accounts_config_invalid", reason: "each conversation binding requires conversationId, customerId and chatTitle" };
      }
      if (conversationIds.has(String(conversation.conversationId))) {
        return { ok: false, code: "accounts_config_duplicate", reason: "conversation bindings must be unique inside an account" };
      }
      conversationIds.add(String(conversation.conversationId));
    }
  }
  return { ok: true };
}

function buildOperationPayload(dispatch, binding, actions, config) {
  return {
    binding: {
      wechatAccountId: binding.account.wechatAccountId,
      sessionId: binding.account.sessionId,
      processId: Number(binding.account.processId),
      processName: String(binding.account.processName),
      executablePath: String(binding.account.executablePath || ""),
      windowHandle: String(binding.account.windowHandle),
      windowsSessionId: Number(binding.account.windowsSessionId),
      accountNickname: String(binding.account.accountNickname || binding.account.accountText || ""),
      ownerWxId: String(binding.account.ownerWxId || ""),
    },
    ui: {
      accountAutomationId: String(binding.account.ui?.accountAutomationId || ""),
      chatTitleAutomationId: String(binding.account.ui?.chatTitleAutomationId || ""),
      messageListAutomationId: String(binding.account.ui?.messageListAutomationId || ""),
      inputAutomationId: String(binding.account.ui?.inputAutomationId || ""),
      recentMessageMatch: binding.account.ui?.recentMessageMatch === "contains" ? "contains" : "exact",
      sentTextMatch: binding.account.ui?.sentTextMatch === "contains" ? "contains" : "exact",
    },
    expected: {
      accountText: String(binding.account.accountText),
      chatTitle: String(binding.conversation.chatTitle),
      recentMessageText: String(dispatch.preflight?.expectedRecentMessageText || dispatch.target?.recentMessageText || "").trim(),
    },
    actions,
    timing: {
      pasteDelayMs: config.pasteDelayMs,
      confirmDelayMs: config.confirmDelayMs,
    },
  };
}

async function executeBoundWechatActions(payload, config, mode = "send") {
  if (config.driver === "wechatauto_rpa") {
    const resolution = resolveRpaInstance(payload?.binding, config);
    if (!resolution.ok) return { ok: false, code: resolution.code, errorMessage: resolution.errorMessage };
    const endpoint = `${resolution.instance.endpoint}/${mode === "probe" ? "probe" : "send"}`;
    try {
      return await postJson(endpoint, payload, {
        timeoutMs: Number(config.sendTimeoutMs || 30000),
        headers: { "x-personal-wechat-rpa-token": resolution.instance.token },
      });
    } catch (error) {
      return { ok: false, code: "rpa_operation_failed", errorMessage: singleLine(error?.message || error) };
    }
  }
  if (process.platform !== "win32") return { ok: false, code: "windows_required", errorMessage: "personal WeChat bridge supports Windows only" };
  if (!fs.existsSync(powershellHelper)) return { ok: false, code: "helper_missing", errorMessage: "personal WeChat PowerShell helper is missing" };
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", powershellHelper, "-Mode", mode],
    {
      encoding: "utf8",
      timeout: Number(config.sendTimeoutMs || 30000),
      windowsHide: true,
      env: { ...process.env, PERSONAL_WECHAT_OPERATION_JSON: JSON.stringify(payload) },
    },
  );
  const output = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
  try {
    const parsed = JSON.parse(output);
    if (result.status === 0 && parsed.ok === true) return parsed;
    return { ok: false, code: parsed.code || "operation_failed", errorMessage: parsed.errorMessage || "personal WeChat operation failed" };
  } catch {
    return {
      ok: false,
      code: "operation_invalid_output",
      errorMessage: singleLine(result.stderr || result.stdout || result.error?.message || `powershell exited with ${result.status}`),
    };
  }
}

function buildAckPayload(dispatch, outboxPayload, status, metadata = {}) {
  return {
    version: BRIDGE_ACK_VERSION,
    ackToken: typeof outboxPayload?.ackToken === "string" ? outboxPayload.ackToken : undefined,
    taskId: String(dispatch.taskId || ""),
    attemptId: dispatch.attemptId || undefined,
    wechatAccountId: String(dispatch.wechatAccountId || ""),
    conversationId: String(dispatch.conversationId || ""),
    customerId: String(dispatch.target?.customerId || outboxPayload?.target?.customerId || ""),
    outboxFileName: String(dispatch.sourceOutboxFileName || ""),
    status: status === "sent" ? "sent" : "failed",
    sentAt: status === "sent" ? new Date().toISOString() : undefined,
    metadata,
  };
}

function writeAckFile(inboxDir, ackPayload) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const fileName = `${Date.now()}-${safeFileSegment(ackPayload.wechatAccountId)}-${safeFileSegment(ackPayload.taskId)}-${safeFileSegment(ackPayload.attemptId || "attempt")}-${ackPayload.status}.ack.json`;
  const filePath = path.join(inboxDir, fileName);
  writeFileAtomic(filePath, `${JSON.stringify(ackPayload, null, 2)}\n`, "utf8");
  return filePath;
}

function findPendingSentAck(inboxDir, dispatch, outboxPayload) {
  if (!fs.existsSync(inboxDir)) return "";
  const customerId = String(dispatch.target?.customerId || outboxPayload?.target?.customerId || "");
  for (const entry of fs.readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".ack.json")) continue;
    const filePath = path.join(inboxDir, entry.name);
    const ack = readJsonIfExists(filePath);
    if (
      ack?.status === "sent" &&
      String(ack.taskId || "") === String(dispatch.taskId || "") &&
      String(ack.attemptId || "") === String(dispatch.attemptId || "") &&
      String(ack.wechatAccountId || "") === String(dispatch.wechatAccountId || "") &&
      String(ack.conversationId || "") === String(dispatch.conversationId || "") &&
      String(ack.customerId || "") === customerId &&
      String(ack.outboxFileName || "") === String(dispatch.sourceOutboxFileName || "") &&
      String(ack.ackToken || "") === String(outboxPayload?.ackToken || "")
    ) return filePath;
  }
  return "";
}

function assertScanAcceptedAck(scanResult, dispatch) {
  const processed = Array.isArray(scanResult?.processed) ? scanResult.processed : [];
  const failed = Array.isArray(scanResult?.failed) ? scanResult.failed : [];
  const matches = (item) =>
    item?.taskId === dispatch.taskId ||
    item?.result?.task?.id === dispatch.taskId ||
    item?.attemptId === dispatch.attemptId ||
    item?.result?.attempt?.id === dispatch.attemptId;
  const failedItem = failed.find(matches);
  if (failedItem) throw new Error(failedItem.errorMessage || failedItem.result?.errorMessage || "bridge inbox scan rejected sent ack");
  if (!processed.some(matches)) throw new Error("bridge inbox scan did not process the sent ack");
  return scanResult;
}

function blockDispatch(filePath, dispatch, config, errorMessage, code) {
  fs.mkdirSync(config.blockedDir, { recursive: true });
  const blockedFile = blockedMarkerPath(config.blockedDir, dispatch, filePath);
  if (!fs.existsSync(blockedFile)) {
    fs.writeFileSync(
      blockedFile,
      `${JSON.stringify({
        version: "personal_wechat_block_v1",
        code,
        taskId: String(dispatch?.taskId || ""),
        attemptId: String(dispatch?.attemptId || ""),
        wechatAccountId: String(dispatch?.wechatAccountId || ""),
        conversationId: String(dispatch?.conversationId || ""),
        dispatchFileName: path.basename(filePath),
        errorMessage: singleLine(errorMessage),
        blockedAt: new Date().toISOString(),
        retryRequiresMarkerRemoval: true,
      }, null, 2)}\n`,
      "utf8",
    );
  }
  return { ...summarizeDispatch(filePath, dispatch, "blocked", errorMessage), code, blockedFile };
}

function blockedMarkerPath(blockedDir, dispatch, filePath) {
  const name = `${safeFileSegment(dispatch?.wechatAccountId || "invalid")}-${safeFileSegment(dispatch?.taskId || path.basename(filePath))}-${safeFileSegment(dispatch?.attemptId || "attempt")}.blocked.json`;
  return path.join(blockedDir, name);
}

function loadSourceOutbox(dispatch) {
  const sourcePath = resolveSourceOutboxPath(dispatch);
  return { filePath: sourcePath, payload: readJsonFile(sourcePath) };
}

function resolveSourceOutboxPath(dispatch) {
  const fileName = String(dispatch.sourceOutboxFileName || "").trim();
  const filePath = path.resolve(String(dispatch.sourceOutboxFilePath || "").trim());
  if (!fileName || path.basename(filePath) !== fileName) throw new Error("source outbox basename mismatch");
  if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) throw new Error("source outbox file is missing or not a regular file");
  const root = path.dirname(filePath);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(filePath);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative !== fileName) {
    throw new Error("source outbox file must be a direct child of its directory");
  }
  return filePath;
}

function dispatchExpired(dispatch) {
  const expiresAt = Date.parse(String(dispatch.expiresAt || ""));
  return !Number.isFinite(expiresAt) || Date.now() > expiresAt;
}

function scanAckInbox(config) {
  if (typeof config.scanAckExecutor === "function") return Promise.resolve(config.scanAckExecutor());
  return postJson(`${config.apiBase}/wechat/bridge/inbox/scan`, {});
}

async function safeScanAckInbox(config) {
  try {
    return await scanAckInbox(config);
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
  }
}

async function recoverPendingAcks(config) {
  if (!config.scanAckInbox || !fs.existsSync(config.inboxDir)) return null;
  const pending = fs.readdirSync(config.inboxDir, { withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".ack.json"));
  return pending ? safeScanAckInbox(config) : null;
}

function listDispatchFiles(dispatchDir) {
  return fs.readdirSync(dispatchDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dispatch.json"))
    .map((entry) => path.join(dispatchDir, entry.name))
    .sort();
}

function claimDispatchFile(filePath, dispatchDir) {
  const source = path.resolve(filePath);
  const root = path.resolve(dispatchDir);
  if (path.dirname(source) !== root || !fs.existsSync(source)) return "";
  const processingDir = path.join(root, "processing");
  fs.mkdirSync(processingDir, { recursive: true });
  const claimed = path.join(processingDir, path.basename(source));
  if (fs.existsSync(claimed)) return "";
  try {
    fs.renameSync(source, claimed);
    return claimed;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST" || error?.code === "EPERM") return "";
    throw error;
  }
}

function archiveDispatchFile(filePath, dispatchDir, outcome) {
  const source = path.resolve(filePath);
  const root = path.resolve(dispatchDir);
  const relative = path.relative(root, source);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("dispatch archive source is outside dispatch directory");
  if (!fs.existsSync(source)) return "";
  const safeOutcome = ["processed", "failed", "uncertain"].includes(outcome) ? outcome : "uncertain";
  const targetDir = path.join(root, safeOutcome);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(source));
  if (fs.existsSync(target)) throw new Error(`dispatch archive already exists: ${path.basename(source)}`);
  fs.renameSync(source, target);
  return target;
}

function restoreClaimedDispatchFile(filePath, dispatchDir) {
  const source = path.resolve(filePath);
  const root = path.resolve(dispatchDir);
  const processingDir = path.join(root, "processing");
  if (path.dirname(source) !== processingDir || !fs.existsSync(source)) return "";
  const target = path.join(root, path.basename(source));
  if (fs.existsSync(target)) return "";
  fs.renameSync(source, target);
  return target;
}

function readConfig() {
  const accountsConfigFile = path.resolve(valueArg("--accounts-config") || process.env.PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE || defaultAccountsConfigFile);
  const accountsConfig = readJsonIfExists(accountsConfigFile) || {};
  const rpaConfigFile = path.resolve(process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE || defaultRpaConfigFile);
  const rpaConfig = readJsonIfExists(rpaConfigFile) || {};
  const rpaInstances = normalizeRpaInstances(rpaConfig.instances);
  const lockStaleMs = numberValue(valueArg("--lock-stale-ms") || process.env.BRIDGE_LOCK_STALE_MS, 5 * 60 * 1000, 1000, 60 * 60 * 1000);
  const rpaPort = numberValue(rpaConfig.port, 3211, 1, 65535);
  const rpaEndpoint = String(
    process.env.PERSONAL_WECHAT_RPA_ENDPOINT ||
      rpaConfig.endpoint ||
      `http://127.0.0.1:${rpaPort}`,
  ).replace(/\/$/, "");
  return {
    driver: String(process.env.PERSONAL_WECHAT_DRIVER || (rpaConfig.token || rpaInstances.length > 0 ? "wechatauto_rpa" : "windows_uia")).trim().toLowerCase(),
    apiBase: String(valueArg("--api-base") || process.env.PERSONAL_WECHAT_API_BASE || process.env.BRIDGE_API_BASE || defaultApiBase).replace(/\/$/, ""),
    dispatchDir: path.resolve(valueArg("--dispatch-dir") || process.env.WECHAT_BRIDGE_DISPATCH_DIR || defaultDispatchDir),
    inboxDir: path.resolve(valueArg("--inbox-dir") || process.env.WECHAT_BRIDGE_INBOX_DIR || defaultInboxDir),
    lockDir: path.resolve(valueArg("--lock-dir") || process.env.WECHAT_BRIDGE_LOCK_DIR || defaultLockDir),
    blockedDir: path.resolve(valueArg("--blocked-dir") || process.env.PERSONAL_WECHAT_BLOCKED_DIR || defaultBlockedDir),
    statusFile: path.resolve(valueArg("--status-file") || process.env.PERSONAL_WECHAT_BRIDGE_STATUS_FILE || defaultStatusFile),
    localStorageRoot: path.resolve(process.env.LOCAL_STORAGE_ROOT || defaultLocalStorageRoot),
    accountsConfigFile,
    accountsConfig,
    rpaConfigFile,
    rpaEndpoint,
    rpaToken: String(process.env.PERSONAL_WECHAT_RPA_TOKEN || rpaConfig.token || "").trim(),
    rpaAccountNickname: String(process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME || rpaConfig.accountNickname || "").trim(),
    rpaInstances,
    limit: numberValue(valueArg("--limit") || process.env.PERSONAL_WECHAT_BRIDGE_LIMIT, 20, 1, 100),
    intervalMs: numberValue(valueArg("--interval-ms") || process.env.PERSONAL_WECHAT_BRIDGE_INTERVAL_MS, 3000, 500, 60000),
    sendTimeoutMs: numberValue(valueArg("--send-timeout-ms") || process.env.PERSONAL_WECHAT_SEND_TIMEOUT_MS, 60000, 5000, 5 * 60 * 1000),
    pasteDelayMs: numberValue(process.env.PERSONAL_WECHAT_PASTE_DELAY_MS, 500, 100, 5000),
    confirmDelayMs: numberValue(process.env.PERSONAL_WECHAT_CONFIRM_DELAY_MS, 1500, 300, 10000),
    lockStaleMs,
    sendEnabled: envFlag("PERSONAL_WECHAT_SEND"),
    scanAckInbox: !envFlag("PERSONAL_WECHAT_DISABLE_ACK_SCAN"),
    watch: hasArg("--watch"),
  };
}

function resolveProbeAccount(accountId, config) {
  const validation = validateAccountsConfig(config.accountsConfig, config.driver);
  if (!validation.ok) throw new Error(validation.reason);
  const matches = config.accountsConfig.accounts.filter((item) => String(item.wechatAccountId) === String(accountId));
  if (matches.length !== 1) throw new Error(`account binding not found: ${accountId}`);
  return matches[0];
}

function buildStatus(result, config, startedAt, error) {
  const completedAt = new Date().toISOString();
  const hasFailures = Boolean(error) || Number(result?.failed?.length || 0) > 0 || Number(result?.blocked?.length || 0) > 0;
  const rpaInstances = (Array.isArray(config.rpaInstances) ? config.rpaInstances : []).map((instance) => ({
    wechatAccountId: String(instance?.wechatAccountId || ""),
    endpoint: normalizeLoopbackRpaEndpoint(instance?.endpoint),
    accountNickname: String(instance?.accountNickname || ""),
    tokenConfigured: Boolean(String(instance?.token || "").trim()),
  }));
  const usesRpaRegistry = rpaInstances.length > 0;
  return {
    ok: !hasFailures,
    status: error ? "failed" : hasFailures ? "blocked" : "completed",
    pid: process.pid,
    startedAt,
    completedAt,
    sendEnabled: config.sendEnabled,
    driver: config.driver,
    rpaEndpoint: config.driver === "wechatauto_rpa" && !usesRpaRegistry ? normalizeLoopbackRpaEndpoint(config.rpaEndpoint) : "",
    rpaTokenConfigured: config.driver === "wechatauto_rpa" ? Boolean(config.rpaToken) || rpaInstances.some((instance) => instance.tokenConfigured) : false,
    rpaAccountNickname: config.driver === "wechatauto_rpa" && !usesRpaRegistry ? config.rpaAccountNickname : "",
    rpaInstanceCount: config.driver === "wechatauto_rpa" ? rpaInstances.length : 0,
    rpaInstances: config.driver === "wechatauto_rpa" ? rpaInstances : [],
    rpaConfigFile: config.driver === "wechatauto_rpa" ? config.rpaConfigFile : "",
    accountsConfigFile: config.accountsConfigFile,
    activeWindowVerificationRequired: true,
    dispatchDir: config.dispatchDir,
    inboxDir: config.inboxDir,
    lockDir: config.lockDir,
    blockedDir: config.blockedDir,
    result: result ? {
      scanned: result.scanned,
      processedCount: result.processed.length,
      skippedCount: result.skipped.length,
      blockedCount: result.blocked.length,
      failedCount: result.failed.length,
    } : null,
    errorMessage: error ? singleLine(error.message || String(error)) : "",
  };
}

function printStatus(config) {
  const status = readJsonIfExists(config.statusFile) || {};
  console.log(JSON.stringify({ statusFile: config.statusFile, status }, null, 2));
}

function printSummary(result) {
  console.log(`[personal-wechat] scanned=${result.scanned} processed=${result.processed.length} skipped=${result.skipped.length} blocked=${result.blocked.length} failed=${result.failed.length}`);
  for (const item of result.processed) console.log(`[processed] task=${item.taskId || ""} account=${item.wechatAccountId || ""} status=${item.status}`);
  for (const item of result.skipped) console.log(`[skipped] task=${item.taskId || ""} account=${item.wechatAccountId || ""} reason=${singleLine(item.reason || "")}`);
  for (const item of result.blocked) console.log(`[blocked] task=${item.taskId || ""} account=${item.wechatAccountId || ""} reason=${singleLine(item.reason || "")}`);
  for (const item of result.failed) console.log(`[failed] file=${item.fileName || ""} error=${singleLine(item.errorMessage || "")}`);
}

function summarizeDispatch(filePath, dispatch, status, reason) {
  return {
    fileName: path.basename(filePath),
    taskId: String(dispatch?.taskId || ""),
    attemptId: String(dispatch?.attemptId || ""),
    wechatAccountId: String(dispatch?.wechatAccountId || ""),
    conversationId: String(dispatch?.conversationId || ""),
    status,
    reason: singleLine(reason),
  };
}

function writeStatus(filePath, status) {
  writeFileAtomic(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

function postJson(url, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const request = http.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...(options.headers || {}) },
      timeout: Number(options.timeoutMs || 10000),
    }, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(data || `POST ${url} failed with ${response.statusCode}`));
        try { resolve(data ? JSON.parse(data) : null); } catch { resolve(data); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function readJsonFile(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (!isPlainObject(value)) throw new Error("json root must be an object");
  return value;
}

function readJsonIfExists(filePath) {
  try { return readJsonFile(filePath); } catch { return null; }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeFileSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "item";
}

function valueArg(name) {
  const equals = process.argv.find((item) => item.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "").trim();
}

function hasArg(name) { return process.argv.includes(name); }
function envFlag(name) { return String(process.env[name] || "").trim() === "1"; }
function numberValue(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function singleLine(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function printHelp() {
  console.log(`Usage: node tools/personal-wechat-bridge.js [--once|--watch|--status]
       node tools/personal-wechat-bridge.js --probe-account <wechatAccountId>

Required for real sending:
  PERSONAL_WECHAT_SEND=1
  PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE=.runtime/personal-wechat-accounts.json
  PERSONAL_WECHAT_DRIVER=windows_uia|wechatauto_rpa
  PERSONAL_WECHAT_RPA_CONFIG_FILE=.runtime/personal-wechat-rpa.json
  PERSONAL_WECHAT_RPA_ENDPOINT=http://127.0.0.1:3211

Safety behavior:
  Each wechatAccountId is bound to one process, window handle and Windows session.
  Account, chat title and recent-message UI Automation evidence are mandatory.
  Same-account dispatches are serialized; different account queues run in parallel.
  Text and local image actions are supported. A sent ack is written only after UI-observed success.
  The API pending identity is rechecked immediately before UI automation.
  Uncertain sends are quarantined and never retried automatically.
  Unsafe pre-send validation creates a blocked marker and requires manual review.`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: "GET", timeout: 10000 }, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(data || `GET ${url} failed with ${response.statusCode}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          reject(new Error(`GET ${url} returned invalid JSON`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

module.exports = {
  ACCOUNTS_CONFIG_VERSION,
  BRIDGE_ACK_VERSION,
  BRIDGE_DISPATCH_VERSION,
  buildAckPayload,
  buildActionPlan,
  buildStatus,
  buildOperationPayload,
  executeBoundWechatActions,
  groupDispatchFilesByAccount,
  groupAccountQueuesByWindowsSession,
  processDispatchFile,
  readConfig,
  resolveAccountBinding,
  runOnce,
  selectDispatchFiles,
  validateAccountsConfig,
  validateDispatchPayload,
  validateSourceOutbox,
};
