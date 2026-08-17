import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AssetsService } from "../assets/assets.service";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";
import { WechatPersistence } from "../wechat/wechat-persistence";
import {
  WechatWorkApiClient,
  WechatWorkApiError,
  WechatWorkCustomerProfile,
  WechatWorkKfMessage,
} from "./wechat-work-api.client";
import {
  maxWechatWorkInboundMediaBytes,
  storeWechatWorkInboundImage,
  storeWechatWorkInboundMedia,
} from "./wechat-work-inbound-media";
import {
  WechatWorkInboundUnderstandingService,
  type WechatWorkMediaUnderstanding,
} from "./wechat-work-inbound-understanding.service";
import { resolveWechatWorkImageFile } from "./wechat-work-media";
import { buildWechatWorkProductionReadiness } from "./wechat-work-readiness";
import {
  fetchWechatWorkRemoteReadiness,
  remoteReadinessErrorCode,
  withWechatWorkReadinessSource,
} from "./wechat-work-readiness-remote";
import { WechatWorkAuthorizationService } from "./wechat-work-authorization.service";
import { WechatWorkCallbackEventRelay } from "./wechat-work-callback-events";
import { deterministicOperationId, normalizeOperationKey } from "../shared/operation-idempotency";

type CallbackQuery = {
  msg_signature?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
};

type NormalizedInbound = {
  msgid: string;
  openKfid: string;
  externalUserId: string;
  msgtype: string;
  text: string;
  createdAt?: string;
  attachments: Array<Record<string, unknown>>;
  raw: WechatWorkKfMessage;
  mediaReview?: { status: "manual_review"; mediaId: string; reason: string; apiErrcode?: number };
  understanding?: WechatWorkMediaUnderstanding;
};

const WECHAT_WORK_INBOUND_MAX_ATTEMPTS = 3;
const WECHAT_WORK_ACCOUNT_PERMISSION_RETRY_MS = 5 * 60 * 1000;
const WECHAT_WORK_CALLBACK_SYNC_RETRY_DELAYS_MS = [750, 2000, 5000];

export function callbackSyncRetryDelayMs(
  error: unknown,
  attempt: number,
  rateLimitDelayMs = 60 * 1000,
) {
  if (error instanceof WechatWorkApiError && error.errcode === 45009) {
    if (attempt > 0) return null;
    return Math.max(rateLimitDelayMs, Number(error.retryAfterSeconds || 0) * 1000);
  }
  const activeSyncConflict = error instanceof BadRequestException
    && /sync already active/i.test(String(error.message || ""));
  const transientApiFailure = error instanceof WechatWorkApiError
    && error.errcode === undefined
    && (error.httpStatus === undefined || error.httpStatus >= 500)
    && error.disposition !== "permanent"
    && error.disposition !== "manual_review";
  const transientNetworkFailure = error instanceof Error
    && !(error instanceof WechatWorkApiError)
    && !(error instanceof BadRequestException);
  if (!activeSyncConflict && !transientApiFailure && !transientNetworkFailure) return null;
  return WECHAT_WORK_CALLBACK_SYNC_RETRY_DELAYS_MS[attempt] ?? null;
}

@Injectable()
export class WechatWorkService {
  private readonly inflightInbound = new Set<string>();
  private readonly scheduledSyncs = new Map<string, Promise<unknown>>();
  private readonly callbackSyncRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingCallbackSyncs = new Map<string, { token?: string; openKfid?: string }>();
  private readonly activeCursorSyncs = new Map<string, Promise<unknown>>();
  private readonly accountPermissionRetryAt = new Map<string, number>();
  private autoSyncAccountCursor = 0;
  private autoSyncRateLimitRetryAt = 0;
  private lastKnownAutoSyncAccountCount = 0;
  private readonly persistence: WechatPersistence;
  private customerEntryCache: { openKfid: string; scene: string; url: string; generatedAt: string } | null = null;

  constructor(
    private readonly wechat: WechatDispatchService,
    private readonly localStore: LocalStoreService,
    private readonly api: WechatWorkApiClient,
    prisma: PrismaService,
    @Optional() private readonly authorization?: WechatWorkAuthorizationService,
    @Optional() private readonly callbackEvents?: WechatWorkCallbackEventRelay,
    @Optional() private readonly inboundUnderstanding?: WechatWorkInboundUnderstandingService,
    @Optional() private readonly assets?: AssetsService,
  ) {
    this.persistence = new WechatPersistence(prisma, localStore);
  }

  async getStatus() {
    const checks = [
      configCheck("corpId", "WECHAT_WORK_CORP_ID", appConfig.wechatWorkCorpId),
      configCheck("secret", "WECHAT_WORK_SECRET", appConfig.wechatWorkSecret),
      configCheck("token", "WECHAT_WORK_TOKEN", appConfig.wechatWorkToken),
      {
        key: "encodingAesKey",
        env: "WECHAT_WORK_ENCODING_AES_KEY",
        ok: validEncodingAesKey(appConfig.wechatWorkEncodingAesKey),
        detail: appConfig.wechatWorkEncodingAesKey ? "configured" : "missing",
      },
      configCheck("publicHttpsUrl", "CUSTOMER_SERVICE_PUBLIC_BASE_URL", appConfig.customerServicePublicBaseUrl, /^https:\/\//i),
      configCheck("apiHttpsUrl", "WECHAT_WORK_API_BASE_URL", appConfig.wechatWorkApiBaseUrl, /^https:\/\//i),
      { key: "persistence", env: "USE_LOCAL_STORE", ok: true, detail: appConfig.useLocalStore ? "local_store" : "prisma" },
      {
        key: "sendAdapter",
        env: "WECHAT_SEND_ADAPTER",
        ok: appConfig.wechatSendAdapter === "wechat_work_kf",
        detail: appConfig.wechatSendAdapter,
      },
    ];
    const bindings = await this.persistence.countWechatWorkBindings();
    const audit = await this.persistence.listWechatWorkAuditLogs(500);
    const readiness = buildWechatWorkProductionReadiness({
      mappedAccounts: bindings,
      auditRecords: audit.length,
      authorizedInstallation: this.authorization?.hasActiveAuthorization(),
      runtimeEvidence: summarizeRuntimeEvidence(audit),
    });
    return {
      ready: checks.every((item) => item.ok),
      productionReady: readiness.productionReady,
      productionStatus: readiness.status,
      checks,
      callbackUrl: `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/callback`,
      apiBaseUrl: appConfig.wechatWorkApiBaseUrl,
      configuredOpenKfid: appConfig.wechatWorkOpenKfid || null,
      persistence: {
        mode: appConfig.useLocalStore ? "local_store" : "prisma",
        mappedAccounts: bindings,
        auditRecords: audit.length,
      },
      send: {
        adapter: appConfig.wechatSendAdapter,
        maxAttempts: appConfig.wechatWorkSendMaxAttempts,
        retryDelaySeconds: appConfig.wechatWorkSendRetryDelaySeconds,
      },
      readiness,
    };
  }

  async getProductionPreflight() {
    const isDesktopRuntime = String(process.env.SMART_KEFU_RUNTIME_TARGET || "").trim().toLowerCase() === "desktop";
    const remoteReadinessUrl = String(process.env.WECHAT_WORK_REMOTE_READINESS_URL || "").trim();
    const remoteReadinessToken = String(process.env.WECHAT_WORK_REMOTE_READINESS_TOKEN || "").trim();
    if (
      isDesktopRuntime
      && remoteReadinessUrl
      && remoteReadinessToken
    ) {
      try {
        return await fetchWechatWorkRemoteReadiness({
          url: remoteReadinessUrl,
          token: remoteReadinessToken,
        });
      } catch (error) {
        return this.getLocalProductionPreflight({
          kind: "remote_unavailable",
          label: "生产状态暂不可用，当前显示桌面本机状态",
          checkedAt: new Date().toISOString(),
          endpoint: safeReadinessEndpointOrigin(remoteReadinessUrl),
          errorCode: remoteReadinessErrorCode(error),
        });
      }
    }
    return this.getLocalProductionPreflight({
      kind: isDesktopRuntime ? "desktop_local" : "production_server",
      label: isDesktopRuntime ? "桌面本机状态" : "生产服务器本机状态",
      checkedAt: new Date().toISOString(),
    });
  }

  async getProductionPreflightExport() {
    return this.getLocalProductionPreflight({
      kind: "production_server",
      label: "生产服务器实时状态",
      checkedAt: new Date().toISOString(),
    });
  }

  private async getLocalProductionPreflight(source: {
    kind: "desktop_local" | "production_server" | "remote_unavailable";
    label: string;
    checkedAt: string;
    endpoint?: string;
    errorCode?: string;
  }) {
    const mappedAccounts = await this.persistence.countWechatWorkBindings();
    const audit = await this.persistence.listWechatWorkAuditLogs(500);
    const report = buildWechatWorkProductionReadiness({
      mappedAccounts,
      auditRecords: audit.length,
      authorizedInstallation: this.authorization?.hasActiveAuthorization(),
      runtimeEvidence: summarizeRuntimeEvidence(audit),
    });
    return withWechatWorkReadinessSource(report, source);
  }

  async verifyCallback(query: CallbackQuery) {
    try {
      const encrypted = requiredText(query.echostr, "echostr");
      this.verifySignature(query, encrypted);
      const decrypted = this.decryptMessage(encrypted);
      this.assertReceiveId(decrypted.receiveId);
      await this.persistence.recordWechatWorkAudit({
        action: "callback_verification_accepted",
        status: "accepted",
      });
      return decrypted.message;
    } catch (error) {
      await this.recordOperationFailure("callback_verification_rejected", error, {
        signaturePresent: Boolean(query.msg_signature || query.signature),
      });
      throw error;
    }
  }

  async handleCallback(query: CallbackQuery, body: unknown) {
    try {
      const encrypted = this.extractEncryptedBody(body);
      this.verifySignature(query, encrypted);
      const decrypted = this.decryptMessage(encrypted);
      this.assertReceiveId(decrypted.receiveId);
      const callbackId = `callback_${crypto.createHash("sha256").update(decrypted.message).digest("hex")}`;
      if (await this.persistence.hasWechatWorkCallbackId(callbackId)) {
        await this.persistence.recordWechatWorkAudit({
          action: "callback_duplicate",
          status: "duplicate",
          callbackId,
        });
        return "success";
      }
      const xml = parseXml(decrypted.message);
      const event = xml.Event || "";
      if (event !== "kf_msg_or_event") {
        await this.persistence.recordWechatWorkAudit({
          action: "callback_ignored",
          status: "ignored",
          msgid: callbackId,
          callbackId,
          event: event || xml.MsgType || "unknown",
        });
        return "success";
      }

      const token = requiredText(xml.Token, "Token");
      const openKfid = String(xml.OpenKfId || appConfig.wechatWorkOpenKfid || "").trim();
      await this.persistence.recordWechatWorkAudit({
        action: "callback_accepted",
        status: "processed",
        msgid: callbackId,
        callbackId,
        event,
        openKfid: openKfid || null,
      });
      this.callbackEvents?.publish(openKfid);
      this.scheduleCustomerServiceSync({ token, openKfid });
      return "success";
    } catch (error) {
      await this.recordOperationFailure("callback_rejected", error, {
        signaturePresent: Boolean(query.msg_signature || query.signature),
      });
      throw error;
    }
  }

  async syncCustomerServiceMessages(
    payload: { token?: string; cursor?: string; limit?: number; openKfid?: string } = {},
  ) {
    const openKfid = requiredText(payload.openKfid || appConfig.wechatWorkOpenKfid, "openKfid");
    if (this.activeCursorSyncs.has(openKfid)) {
      throw new BadRequestException("wechat work sync already active for this openKfid");
    }
    const pending = this.runCustomerServiceSync({ ...payload, openKfid });
    this.activeCursorSyncs.set(openKfid, pending);
    try {
      return await pending;
    } finally {
      this.activeCursorSyncs.delete(openKfid);
    }
  }

  async syncAllCustomerServiceAccounts(payload: { limit?: number; maxAccounts?: number } = {}) {
    const startedAt = Date.now();
    if (this.autoSyncRateLimitRetryAt > startedAt) {
      return {
        ok: false,
        partial: true,
        throttled: true,
        blockerCode: "SYNC_RATE_LIMIT_BACKOFF_45009",
        retryAt: new Date(this.autoSyncRateLimitRetryAt).toISOString(),
        accountCount: this.lastKnownAutoSyncAccountCount,
        attemptedAccountCount: 0,
        synchronizedAccountCount: 0,
        skippedAccountCount: 0,
        deferredAccountCount: this.lastKnownAutoSyncAccountCount,
        receivedCount: 0,
        processedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
        accounts: [],
      };
    }

    let response;
    try {
      response = await this.api.listCustomerServiceAccounts();
    } catch (error) {
      if (!(error instanceof WechatWorkApiError) || error.errcode !== 45009) throw error;
      const retryAt = this.applyAutoSyncRateLimitBackoff(error, startedAt);
      return {
        ok: false,
        partial: true,
        throttled: true,
        blockerCode: "SYNC_RATE_LIMIT_BACKOFF_45009",
        retryAt: new Date(retryAt).toISOString(),
        accountCount: this.lastKnownAutoSyncAccountCount,
        attemptedAccountCount: 0,
        synchronizedAccountCount: 0,
        skippedAccountCount: 0,
        deferredAccountCount: this.lastKnownAutoSyncAccountCount,
        receivedCount: 0,
        processedCount: 0,
        duplicateCount: 0,
        failedCount: 0,
        accounts: [],
      };
    }
    const configuredOpenKfid = String(appConfig.wechatWorkOpenKfid || "").trim();
    const accounts = normalizeWechatWorkAccounts(response.account_list);
    if (configuredOpenKfid && !accounts.some((account) => account.openKfid === configuredOpenKfid)) {
      accounts.unshift({ openKfid: configuredOpenKfid, name: "configured", avatar: "", managePrivilege: false });
    }
    const ordered = accounts.sort((left, right) =>
      Number(right.openKfid === configuredOpenKfid) - Number(left.openKfid === configuredOpenKfid));
    this.lastKnownAutoSyncAccountCount = ordered.length;
    const requestedBatchSize = Number(payload.maxAccounts);
    const batchSize = Number.isFinite(requestedBatchSize)
      ? Math.max(1, Math.min(ordered.length || 1, Math.floor(requestedBatchSize)))
      : ordered.length;
    const cursor = ordered.length ? this.autoSyncAccountCursor % ordered.length : 0;
    const selectedAccounts = ordered.length
      ? Array.from({ length: batchSize }, (_, index) => ordered[(cursor + index) % ordered.length])
      : [];
    const results: any[] = [];
    const now = Date.now();
    let advancedAccounts = 0;
    let rateLimited = false;

    for (const account of selectedAccounts) {
      const mappedAccount = await this.persistence.upsertWechatWorkAccount({
        openKfid: account.openKfid,
        name: account.name === "configured" ? "" : account.name,
        avatar: account.avatar,
      });
      const retryAt = this.accountPermissionRetryAt.get(account.openKfid) || 0;
      if (retryAt > now) {
        results.push({
          openKfid: account.openKfid,
          name: account.name,
          wechatAccountId: mappedAccount.id,
          ok: false,
          skipped: true,
          blockerCode: "KFID_PERMISSION_MISSING_48007",
          retryAt: new Date(retryAt).toISOString(),
        });
        advancedAccounts += 1;
        continue;
      }
      try {
        const sync = await this.syncCustomerServiceMessages({
          openKfid: account.openKfid,
          limit: payload.limit,
        });
        this.accountPermissionRetryAt.delete(account.openKfid);
        results.push({ openKfid: account.openKfid, name: account.name, wechatAccountId: mappedAccount.id, ...sync });
        advancedAccounts += 1;
      } catch (error) {
        const apiError = error instanceof WechatWorkApiError ? error : null;
        const permissionDenied = apiError?.errcode === 48007;
        const rateLimitExceeded = apiError?.errcode === 45009;
        if (rateLimitExceeded) {
          const retryAt = this.applyAutoSyncRateLimitBackoff(apiError, now);
          results.push({
            openKfid: account.openKfid,
            name: account.name,
            wechatAccountId: mappedAccount.id,
            ok: false,
            skipped: true,
            blockerCode: "SYNC_RATE_LIMIT_BACKOFF_45009",
            retryAt: new Date(retryAt).toISOString(),
            errorMessage: "企业微信消息同步触发频率限制，已停止本轮并延迟重试",
          });
          rateLimited = true;
          break;
        }
        if (permissionDenied) {
          this.accountPermissionRetryAt.set(account.openKfid, now + WECHAT_WORK_ACCOUNT_PERMISSION_RETRY_MS);
        }
        results.push({
          openKfid: account.openKfid,
          name: account.name,
          wechatAccountId: mappedAccount.id,
          ok: false,
          skipped: permissionDenied,
          blockerCode: permissionDenied ? "KFID_PERMISSION_MISSING_48007" : "ACCOUNT_SYNC_FAILED",
          errorMessage: permissionDenied
            ? "当前微信客服 Secret 没有该客服账号的消息同步权限"
             : error instanceof Error ? error.message : "微信客服账号消息同步失败",
        });
        advancedAccounts += 1;
      }
    }
    if (ordered.length) this.autoSyncAccountCursor = (cursor + advancedAccounts) % ordered.length;

    const synchronized = results.filter((item) => item.ok);
    return {
      ok: synchronized.length > 0,
      partial: results.some((item) => !item.ok),
      throttled: rateLimited,
      ...(rateLimited ? {
        blockerCode: "SYNC_RATE_LIMIT_BACKOFF_45009",
        retryAt: new Date(this.autoSyncRateLimitRetryAt).toISOString(),
      } : {}),
      accountCount: accounts.length,
      attemptedAccountCount: results.length,
      synchronizedAccountCount: synchronized.length,
      skippedAccountCount: results.filter((item) => item.skipped).length,
      deferredAccountCount: Math.max(0, accounts.length - results.length),
      receivedCount: synchronized.reduce((sum, item) => sum + Number(item.receivedCount || 0), 0),
      processedCount: synchronized.reduce((sum, item) => sum + Number(item.processedCount || 0), 0),
      duplicateCount: synchronized.reduce((sum, item) => sum + Number(item.duplicateCount || 0), 0),
      failedCount: synchronized.reduce((sum, item) => sum + Number(item.failedCount || 0), 0),
      accounts: results,
    };
  }

  private applyAutoSyncRateLimitBackoff(error: WechatWorkApiError, now = Date.now()) {
    const retryAfterMs = Math.max(
      appConfig.wechatWorkAutoSyncRateLimitBackoffMs,
      Math.max(0, Number(error.retryAfterSeconds || 0)) * 1000,
    );
    this.autoSyncRateLimitRetryAt = Math.max(this.autoSyncRateLimitRetryAt, now + retryAfterMs);
    return this.autoSyncRateLimitRetryAt;
  }

  private async runCustomerServiceSync(
    payload: { token?: string; cursor?: string; limit?: number; openKfid: string },
  ) {
    const token = String(payload.token || "").trim() || undefined;
    const limit = clampLimit(payload.limit);
    const fallbackOpenKfid = payload.openKfid;
    const persistCursor = payload.cursor === undefined;
    const storedCursor = persistCursor
      ? await this.persistence.getWechatWorkSyncCursor(fallbackOpenKfid)
      : null;
    let cursor = persistCursor
      ? String(storedCursor?.nextCursor || "")
      : String(payload.cursor || "");
    let pageCount = 0;
    let receivedCount = 0;
    const processed: any[] = [];
    const duplicates: any[] = [];
    const ignored: any[] = [];
    const failed: any[] = [];
    let hasMore = false;
    let cursorCommitted = false;
    let retryRequired = false;

    while (pageCount < 50) {
      const response = await this.api.syncMessages({ token, cursor, limit, openKfid: fallbackOpenKfid });
      pageCount += 1;
      const messages = Array.isArray(response.msg_list) ? response.msg_list : [];
      receivedCount += messages.length;
      let pageTerminal = true;
      for (const message of messages) {
        try {
          const result = await this.processSyncedItem(message, fallbackOpenKfid);
          if (result.status === "processed") processed.push(result);
          else if (result.status === "duplicate") duplicates.push(result);
          else ignored.push(result);
        } catch (error) {
          const msgid = stableSyncedItemId(message);
          const previousFailures = await this.persistence.countWechatWorkInboundFailures(msgid);
          const observedOpenKfid = syncedItemOpenKfid(message);
          const scopeMismatch = Boolean(observedOpenKfid && observedOpenKfid !== fallbackOpenKfid);
          const transientMediaFailure = isTransientInboundMediaFailure(error);
          const permanent = !scopeMismatch && (
            previousFailures + 1 >= WECHAT_WORK_INBOUND_MAX_ATTEMPTS ||
            (!transientMediaFailure && error instanceof BadRequestException)
          );
          const failure = {
            status: scopeMismatch ? "scope_mismatch" : permanent ? "permanent_manual_review" : "transient_failed",
            msgid,
            msgtype: String(message.msgtype || "unknown"),
            errorMessage: error instanceof Error ? error.message : String(error),
            attempt: previousFailures + 1,
            retryable: scopeMismatch ? false : !permanent,
            manualInterventionRequired: scopeMismatch || permanent,
          };
          failed.push(failure);
          if (!permanent) pageTerminal = false;
          await this.persistence.recordWechatWorkAudit({
            action: "inbound_failed",
            ...failure,
            openKfid: fallbackOpenKfid,
            externalUserId: scopeMismatch ? null : message.external_userid || null,
            cursorScopeMismatch: scopeMismatch,
          });
        }
      }
      const nextCursor = String(response.next_cursor || "");
      hasMore = Boolean(response.has_more);
      if (!pageTerminal) {
        retryRequired = true;
        break;
      }
      if (hasMore && (!nextCursor || nextCursor === cursor)) {
        throw new BadRequestException("wechat work sync_msg returned has_more without a new next_cursor");
      }
      if (!nextCursor) {
        retryRequired = true;
        await this.persistence.recordWechatWorkAudit({
          action: "sync_cursor_not_advanced",
          status: "blocked",
          openKfid: fallbackOpenKfid,
          reason: "terminal sync_msg page did not return a non-empty next_cursor",
          terminalMessageCount: messages.length,
        });
        break;
      }
      if (persistCursor) {
        await this.persistence.commitWechatWorkSyncCursor({
          openKfid: fallbackOpenKfid,
          expectedCursor: cursor,
          nextCursor,
          terminalMessageCount: messages.length,
          batchFingerprint: syncBatchFingerprint(messages),
        });
        cursorCommitted = true;
      }
      cursor = nextCursor;
      if (!hasMore) {
        break;
      }
    }
    if (pageCount >= 50 && hasMore) throw new BadRequestException("wechat work sync_msg exceeded 50 pages in one run");

    return {
      ok: !retryRequired,
      pageCount,
      receivedCount,
      processedCount: processed.length,
      duplicateCount: duplicates.length,
      ignoredCount: ignored.length,
      failedCount: failed.length,
      nextCursor: cursor,
      cursorCommitted,
      retryRequired,
      processed,
      duplicates,
      ignored,
      failed,
    };
  }

  async listAuditLogs(limit?: number) {
    return {
      records: await this.persistence.listWechatWorkAuditLogs(limit),
    };
  }

  async diagnoseCustomerServiceConnection() {
    const configuredOpenKfid = String(appConfig.wechatWorkOpenKfid || "").trim();
    const audit = await this.persistence.listWechatWorkAuditLogs(500);
    const attempts = await this.persistence.listSendAttempts({ limit: 300 });
    const latestInbound = audit.find((record: any) => record.action === "inbound_processed" && record.status === "processed");
    const latestCallback = audit.find((record: any) => ["callback_accepted", "callback_verification_accepted"].includes(record.action));
    const latestOfficialSend = attempts.find((attempt: any) => attempt.adapter === "wechat_work_kf");
    const evidence = {
      latestCallbackAt: String(latestCallback?.createdAt || "") || null,
      latestInboundAt: String(latestInbound?.createdAt || "") || null,
      latestOfficialSendAt: String(latestOfficialSend?.completedAt || latestOfficialSend?.startedAt || latestOfficialSend?.createdAt || "") || null,
      latestOfficialSendStatus: latestOfficialSend?.status ? String(latestOfficialSend.status) : null,
    };
    try {
      const response = await this.api.listCustomerServiceAccounts();
      const accounts = await Promise.all((Array.isArray(response.account_list) ? response.account_list : []).map(async (account) => {
        const openKfid = String(account.open_kfid || "").trim();
        const customerEntry = openKfid ? await this.getStoredCustomerEntry(openKfid) : null;
        return {
        openKfid,
        name: String(account.name || "").trim(),
        avatar: String(account.avatar || "").trim(),
        managePrivilege: Boolean(account.manage_privilege),
        customerEntry,
        };
      }));
      const visibleAccounts = accounts.filter((account) => account.openKfid);
      const configuredAccount = visibleAccounts.find((account) => account.openKfid === configuredOpenKfid) || null;
      return {
        checkedAt: new Date().toISOString(),
        apiReachable: true,
        credentialCompatible: true,
        configuredOpenKfid,
        configuredOpenKfidFound: Boolean(configuredAccount),
        accounts: visibleAccounts,
        customerEntryAccountCount: visibleAccounts.filter((account) => account.customerEntry).length,
        evidence,
        ready: Boolean(configuredAccount && latestInbound && latestOfficialSend?.status === "sent"),
        detail: configuredAccount
          ? "已用当前凭证读取企业微信客服账号；仍需真实客户消息与成功回复证据完成互通验收。"
          : "当前凭证可以读取企业微信客服账号，但本机 OpenKfid 不在账号列表中。",
        blockerCode: configuredAccount ? "RUNTIME_EVIDENCE_PENDING" : "OPEN_KFID_MISMATCH",
      };
    } catch (error) {
      const apiError = error instanceof WechatWorkApiError ? error : null;
      const mismatch = apiError?.errcode === 95011
        ? {
            blockerCode: "CREDENTIAL_MODE_MISMATCH_95011",
            detail: "企业微信正在使用联合版微信客服，但本机是独立版 Secret。请在企业微信管理后台“微信客服 → API”复制当前企业的微信客服 Secret。",
          }
        : apiError?.errcode === 95012
          ? {
              blockerCode: "CREDENTIAL_MODE_MISMATCH_95012",
              detail: "企业微信正在使用独立版微信客服，但本机凭证属于联合版。请改用微信客服 Secret。",
            }
          : apiError?.errcode === 48002
            ? {
                blockerCode: "CUSTOMER_SERVICE_PERMISSION_MISSING",
                detail: "当前凭证没有“微信客服 → 获取基础信息”权限。",
              }
            : {
                blockerCode: "OFFICIAL_API_UNAVAILABLE",
                detail: apiError?.message || (error instanceof Error ? error.message : "企业微信官方接口连接失败"),
              };
      return {
        checkedAt: new Date().toISOString(),
        apiReachable: false,
        credentialCompatible: false,
        configuredOpenKfid,
        configuredOpenKfidFound: false,
        accounts: [],
        evidence,
        ready: false,
        ...mismatch,
      };
    }
  }

  async validateCustomerServiceCredential(payload: { secret?: string }) {
    const secret = normalizeWechatWorkSecret(payload.secret);
    let response;
    try {
      response = await this.api.listCustomerServiceAccountsWithSecret(secret);
    } catch (error) {
      throw customerServiceCredentialError(error);
    }
    const accounts = normalizeWechatWorkAccounts(response.account_list);
    if (!accounts.length) throw new BadRequestException("该 Secret 可以访问企业微信，但没有读取到任何微信客服账号");
    const configuredOpenKfid = String(appConfig.wechatWorkOpenKfid || "").trim();
    return {
      valid: true,
      configuredOpenKfid,
      suggestedOpenKfid: accounts.some((account) => account.openKfid === configuredOpenKfid)
        ? configuredOpenKfid
        : accounts.length === 1 ? accounts[0].openKfid : "",
      accounts,
      detail: "微信客服 Secret 验证成功，请确认要绑定的客服账号。",
    };
  }

  async saveCustomerServiceCredential(payload: { secret?: string; openKfid?: string }) {
    const secret = normalizeWechatWorkSecret(payload.secret);
    let response;
    try {
      response = await this.api.listCustomerServiceAccountsWithSecret(secret);
    } catch (error) {
      throw customerServiceCredentialError(error);
    }
    const accounts = normalizeWechatWorkAccounts(response.account_list);
    const openKfid = requiredText(payload.openKfid, "openKfid");
    const account = accounts.find((item) => item.openKfid === openKfid);
    if (!account) throw new BadRequestException("所选客服账号不属于当前 Secret 可访问的企业微信账号");
    persistWechatWorkDesktopCredential({ secret, openKfid });
    appConfig.wechatWorkSecret = secret;
    appConfig.wechatWorkOpenKfid = openKfid;
    this.api.clearAccessToken();
    this.customerEntryCache = null;
    this.autoSyncAccountCursor = 0;
    this.autoSyncRateLimitRetryAt = 0;

    let sync: {
      ok: boolean;
      receivedCount: number;
      processedCount: number;
      failedCount: number;
      errorMessage?: string;
    };
    try {
      const result = await this.syncCustomerServiceMessages({
        openKfid,
        limit: appConfig.wechatWorkAutoSyncLimit,
      });
      sync = {
        ok: result.ok,
        receivedCount: result.receivedCount,
        processedCount: result.processedCount,
        failedCount: result.failedCount,
        ...(!result.ok ? { errorMessage: "企业微信消息游标尚未推进，后台自动同步会继续重试" } : {}),
      };
    } catch (error) {
      sync = {
        ok: false,
        receivedCount: 0,
        processedCount: 0,
        failedCount: 0,
        errorMessage: error instanceof Error ? error.message : "企业微信消息即时同步失败",
      };
    }

    let customerEntry: {
      ok: boolean;
      entry: { openKfid: string; scene: string; url: string; generatedAt: string } | null;
      errorMessage?: string;
    };
    try {
      customerEntry = {
        ok: true,
        entry: await this.createCustomerEntryContactWay(),
      };
    } catch (error) {
      customerEntry = {
        ok: false,
        entry: null,
        errorMessage: error instanceof Error ? error.message : "企业微信客户入口生成失败",
      };
    }

    const activated = sync.ok && customerEntry.ok;
    return {
      saved: true,
      secretConfigured: true,
      account,
      restartRequired: false,
      activation: {
        activated,
        sync,
        customerEntry,
      },
      detail: activated
        ? "企业微信已连接：凭证已永久保存、消息已即时同步、客户入口已生成。"
        : `企业微信凭证已永久保存；${[
          !sync.ok ? `消息同步待重试：${sync.errorMessage}` : "",
          !customerEntry.ok ? `客户入口待处理：${customerEntry.errorMessage}` : "",
        ].filter(Boolean).join("；")}`,
    };
  }

  async createCustomerEntryContactWay() {
    const openKfid = requiredText(appConfig.wechatWorkOpenKfid, "openKfid");
    return this.createCustomerEntryContactWayForOpenKfid(openKfid);
  }

  async bindAllCustomerEntryContactWays() {
    const response = await this.api.listCustomerServiceAccounts();
    const accounts = normalizeWechatWorkAccounts(response.account_list);
    if (!accounts.length) throw new BadRequestException("当前凭证没有可绑定二维码的微信客服账号");

    const results: Array<{
      openKfid: string;
      name: string;
      ok: boolean;
      reused: boolean;
      entry: { openKfid: string; scene: string; url: string; generatedAt: string } | null;
      errorMessage?: string;
    }> = [];

    for (const account of accounts) {
      const existing = await this.getStoredCustomerEntry(account.openKfid);
      try {
        const entry = existing || await this.createCustomerEntryContactWayForOpenKfid(account.openKfid);
        results.push({
          openKfid: account.openKfid,
          name: account.name,
          ok: true,
          reused: Boolean(existing),
          entry,
        });
      } catch (error) {
        results.push({
          openKfid: account.openKfid,
          name: account.name,
          ok: false,
          reused: false,
          entry: null,
          errorMessage: error instanceof Error ? error.message : "客服二维码绑定失败",
        });
      }
    }

    const bound = results.filter((item) => item.ok);
    return {
      ok: bound.length === accounts.length,
      partial: bound.length > 0 && bound.length < accounts.length,
      accountCount: accounts.length,
      boundAccountCount: bound.length,
      createdAccountCount: bound.filter((item) => !item.reused).length,
      reusedAccountCount: bound.filter((item) => item.reused).length,
      failedAccountCount: results.filter((item) => !item.ok).length,
      accounts: results,
    };
  }

  private async createCustomerEntryContactWayForOpenKfid(openKfid: string) {
    const scene = "smart_kefu_customer_entry";
    if (this.customerEntryCache?.openKfid === openKfid) return this.customerEntryCache;
    const storedEntry = await this.getStoredCustomerEntry(openKfid);
    if (storedEntry) {
      this.customerEntryCache = storedEntry;
      return storedEntry;
    }

    let response;
    try {
      response = await this.api.createCustomerContactWay({ openKfid, scene });
    } catch (error) {
      if (error instanceof WechatWorkApiError && error.errcode === 95011) {
        throw new BadRequestException("当前企业微信使用联合版微信客服，但本机配置的是独立版 Secret；请改用联合版对应凭证或完成企业微信应用授权后再生成入口");
      }
      if (error instanceof WechatWorkApiError && error.errcode === 95012) {
        throw new BadRequestException("当前企业微信使用独立版微信客服，但本机配置的是联合版 Secret；请改用微信客服 Secret 后再生成入口");
      }
      if (error instanceof WechatWorkApiError && error.errcode === 48002) {
        throw new BadRequestException("当前企业微信凭证没有获取客服帐号链接的接口权限，请先开通“微信客服 → 获取基础信息”权限");
      }
      throw error;
    }
    const url = normalizeWechatWorkCustomerEntryUrl(
      requiredText(response.url, "wechat work customer contact url"),
      false,
    );
    const entry = { openKfid, scene, url, generatedAt: new Date().toISOString() };
    if (openKfid === String(appConfig.wechatWorkOpenKfid || "").trim()) this.customerEntryCache = entry;
    await this.persistence.upsertWechatWorkAudit({
      id: deterministicOperationId("wwentry", openKfid),
      action: "customer_entry_generated",
      status: "processed",
      openKfid,
      scene,
      url: entry.url,
      generatedAt: entry.generatedAt,
    });
    return entry;
  }

  async importCustomerEntryContactWay(payload: { url?: string }) {
    const openKfid = requiredText(appConfig.wechatWorkOpenKfid, "openKfid");
    const url = normalizeWechatWorkCustomerEntryUrl(requiredText(payload.url, "url"), true);
    const entry = {
      openKfid,
      scene: "wecom_admin_import",
      url,
      generatedAt: new Date().toISOString(),
    };
    await this.persistence.upsertWechatWorkAudit({
      id: deterministicOperationId("wwentry", openKfid),
      action: "customer_entry_generated",
      status: "processed",
      source: "wecom_admin_import",
      openKfid,
      scene: entry.scene,
      url: entry.url,
      generatedAt: entry.generatedAt,
    });
    this.customerEntryCache = entry;
    return entry;
  }

  async getCustomerEntryContactWay() {
    const openKfid = requiredText(appConfig.wechatWorkOpenKfid, "openKfid");
    if (this.customerEntryCache?.openKfid === openKfid) return this.customerEntryCache;
    const storedEntry = await this.getStoredCustomerEntry(openKfid);
    if (storedEntry) this.customerEntryCache = storedEntry;
    return storedEntry;
  }

  private async getStoredCustomerEntry(openKfid: string) {
    const record = await this.persistence.getWechatWorkAuditLog(deterministicOperationId("wwentry", openKfid));
    if (!record || record.action !== "customer_entry_generated" || record.status !== "processed" || record.openKfid !== openKfid) return null;
    const scene = String(record.scene || "").trim();
    const url = String(record.url || "").trim();
    const generatedAt = String(record.generatedAt || record.createdAt || "").trim();
    if (!scene || !url || !generatedAt) return null;
    try {
      return { openKfid, scene, url: normalizeWechatWorkCustomerEntryUrl(url, false), generatedAt };
    } catch {
      return null;
    }
  }

  async getUpgradeServiceConfig() {
    let response;
    try {
      response = await this.api.getUpgradeServiceConfig();
    } catch (error) {
      if (error instanceof WechatWorkApiError && error.errcode === 48002) {
        throw new BadRequestException("当前企业微信账号尚未开通微信客服“升级服务”接口权限，请先在企业微信管理后台配置升级服务专员");
      }
      throw error;
    }
    const memberUserIds = uniqueTextList(response.member_range?.userid_list);
    const departmentIds = [...new Set(
      (Array.isArray(response.member_range?.department_id_list) ? response.member_range.department_id_list : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    )];
    const groupChatIds = uniqueTextList(response.groupchat_range?.chat_id_list);
    return {
      ready: memberUserIds.length > 0,
      memberUserIds,
      departmentIds,
      groupChatIds,
      detail: memberUserIds.length
        ? "已读取企业微信升级服务专员，可将咨询客户邀请为长期企业微信客户。"
        : "企业微信尚未配置可用的升级服务专员。",
    };
  }

  async upgradeCustomerToMemberService(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    memberUserId?: string;
    wording?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const identity = {
      wechatAccountId: requiredText(payload.wechatAccountId, "wechatAccountId"),
      conversationId: requiredText(payload.conversationId, "conversationId"),
      customerId: requiredText(payload.customerId, "customerId"),
    };
    const binding = await this.persistence.findWechatWorkBindingByIdentity(identity);
    if (!binding) throw new BadRequestException("当前会话还没有企业微信客户身份，不能升级为长期客户");
    if (
      binding.wechatAccountId !== identity.wechatAccountId
      || binding.conversationId !== identity.conversationId
      || binding.customerId !== identity.customerId
    ) {
      throw new BadRequestException("企业微信客户、会话与客服账号身份不一致");
    }

    const memberUserId = requiredText(payload.memberUserId, "memberUserId");
    const config = await this.getUpgradeServiceConfig();
    if (!config.memberUserIds.includes(memberUserId)) {
      throw new BadRequestException("所选专员不在企业微信“升级服务”允许范围内");
    }
    const wording = String(payload.wording || "您好，我是您的专属服务专员。添加企业微信后，我可以继续为您提供长期服务。")
      .trim();
    if (!wording) throw new BadRequestException("升级服务推荐语不能为空");
    if (wording.length > 200) throw new BadRequestException("升级服务推荐语不能超过 200 个字符");

    const auditId = deterministicOperationId("wwaudit", `${operationKey}:customer-upgrade-recommended`);
    const existing = (await this.persistence.listWechatWorkAuditLogs(500))
      .find((record: any) => record.id === auditId && record.status === "processed");
    if (existing) {
      return {
        ok: true,
        recommended: true,
        alreadyRecommended: true,
        memberUserId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
      };
    }

    try {
      await this.api.upgradeCustomerToMember({
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        memberUserId,
        wording,
      });
      await this.persistence.recordWechatWorkAudit({
        id: auditId,
        action: "customer_upgrade_recommended",
        status: "processed",
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        memberUserId,
        operationKey,
      });
      return {
        ok: true,
        recommended: true,
        alreadyRecommended: false,
        memberUserId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
      };
    } catch (error) {
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${operationKey}:customer-upgrade-failed`),
        action: "customer_upgrade_recommend_failed",
        status: "failed",
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        memberUserId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof WechatWorkApiError && error.errcode === 95021) {
        throw new BadRequestException("请先在企业微信“微信客服 → 升级服务”中配置该专员");
      }
      throw error;
    }
  }

  async refreshCustomerProfile(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    const identity = {
      wechatAccountId: requiredText(payload.wechatAccountId, "wechatAccountId"),
      conversationId: requiredText(payload.conversationId, "conversationId"),
      customerId: requiredText(payload.customerId, "customerId"),
    };
    const binding = await this.persistence.findWechatWorkBindingByIdentity(identity);
    if (!binding) throw new BadRequestException("wechat work customer binding not found");
    if (
      binding.wechatAccountId !== identity.wechatAccountId
      || binding.conversationId !== identity.conversationId
      || binding.customerId !== identity.customerId
    ) {
      throw new BadRequestException("wechat work customer binding identity mismatch");
    }
    const refreshed = await this.refreshWechatWorkCustomerProfile(binding, true);
    return {
      refreshed: refreshed !== binding,
      customer: refreshed.customer,
      conversation: refreshed.conversation,
    };
  }

  async queueCustomerServiceText(payload: { externalUserId?: string; openKfid?: string; text?: string; requestId?: string }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const openKfid = requiredText(payload.openKfid || appConfig.wechatWorkOpenKfid, "openKfid");
    const externalUserId = requiredText(payload.externalUserId, "externalUserId");
    const text = requiredText(payload.text, "text");
    const binding = await this.persistence.getWechatWorkBinding(openKfid, externalUserId);
    if (!binding) throw new BadRequestException("wechat work customer is not mapped yet; sync an inbound message first");
    const task = await this.persistence.createSendTask({
      operationKey,
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      payload: { kind: "text", text },
      guardSnapshot: {
        source: "wechat_work_kf",
        requiredChecks: ["identityBinding", "wechatWorkBinding", "officialApiConfig"],
        policy: "safe-send-queue",
      },
    });
    await this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wwaudit", `${operationKey}:queued`),
      action: "send_queued",
      status: "queued",
      sendTaskId: task.id,
      openKfid,
      externalUserId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      wechatAccountId: binding.wechatAccountId,
    });
    return { ok: true, queued: true, task };
  }

  async queueCustomerServiceImages(payload: {
    externalUserId?: string;
    openKfid?: string;
    text?: string;
    imagePaths?: string[];
    designJobId?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const openKfid = requiredText(payload.openKfid || appConfig.wechatWorkOpenKfid, "openKfid");
    const externalUserId = requiredText(payload.externalUserId, "externalUserId");
    const text = String(payload.text || "").trim();
    const imagePaths = Array.isArray(payload.imagePaths)
      ? payload.imagePaths.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (!imagePaths.length) throw new BadRequestException("imagePaths must include at least one image");
    if ((text ? 1 : 0) + imagePaths.length > 5) {
      throw new BadRequestException("wechat work customer-service send exceeds the 5-message limit");
    }
    let validatedImages;
    try {
      validatedImages = imagePaths.map((filePath) => resolveWechatWorkImageFile(filePath));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "wechat work image validation failed");
    }
    const designJobId = requiredText(payload.designJobId, "designJobId");
    const binding = await this.persistence.getWechatWorkBinding(openKfid, externalUserId);
    if (!binding) throw new BadRequestException("wechat work customer is not mapped yet; sync an inbound message first");
    const designJob = await this.persistence.getDesignJob(designJobId);
    if (
      !designJob
      || designJob.wechatAccountId !== binding.wechatAccountId
      || designJob.conversationId !== binding.conversationId
      || designJob.customerId !== binding.customerId
    ) {
      throw new BadRequestException("design job is not bound to the selected WeChat Work customer and conversation");
    }
    const allowedImagePaths = new Set<string>();
    for (const image of Array.isArray(designJob.images) ? designJob.images : []) {
      try {
        allowedImagePaths.add(resolveWechatWorkImageFile(image.localPath).filePath.toLowerCase());
      } catch {
        // A stale design candidate is not eligible for sending.
      }
    }
    if (validatedImages.some((image) => !allowedImagePaths.has(image.filePath.toLowerCase()))) {
      throw new BadRequestException("image paths do not belong to the selected design job");
    }
    const task = await this.persistence.createSendTask({
      operationKey,
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      designJobId,
      payload: {
        kind: "design_images",
        ...(text ? { textBeforeImages: text } : {}),
        imagePaths: validatedImages.map((image) => image.filePath),
      },
      guardSnapshot: {
        source: "wechat_work_kf",
        requiredChecks: ["identityBinding", "wechatWorkBinding", "officialApiConfig", "localStorageImages"],
        policy: "safe-send-queue",
      },
    });
    await this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wwaudit", `${operationKey}:queued`),
      action: "send_images_queued",
      status: "queued",
      sendTaskId: task.id,
      openKfid,
      externalUserId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      wechatAccountId: binding.wechatAccountId,
      imageCount: validatedImages.length,
      designJobId,
      textIncluded: Boolean(text),
    });
    return { ok: true, queued: true, task };
  }

  async dispatchCustomerServiceText(id: string) {
    const sendTaskId = requiredText(id, "sendTaskId");
    const task = await this.persistence.getSendTask(sendTaskId);
    if (!task) throw new BadRequestException(`wechat work send task not found: ${sendTaskId}`);

    const binding = await this.persistence.findWechatWorkBindingByIdentity({
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.customerId || task.conversation?.customerId,
    });
    if (!binding) {
      throw new BadRequestException("send task is not bound to a WeChat Work customer");
    }

    await this.persistence.recordWechatWorkAudit({
      action: "send_dispatch_requested",
      status: "dispatching",
      sendTaskId,
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.customerId || task.conversation?.customerId || null,
    });

    try {
      return await this.wechat.executeQueuedSend(sendTaskId, {
        adapter: "wechat_work_kf",
        expectedWechatAccountId: task.wechatAccountId,
        expectedConversationId: task.conversationId,
        expectedCustomerId: task.customerId || task.conversation?.customerId,
      });
    } catch (error) {
      await this.recordOperationFailure("send_dispatch_rejected", error, {
        sendTaskId,
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
      });
      throw error;
    }
  }

  async handleRemoteCallbackSignal(payload: { openKfid?: string; eventId?: string }) {
    const openKfid = String(payload.openKfid || appConfig.wechatWorkOpenKfid || "").trim();
    if (!openKfid) throw new BadRequestException("openKfid is required for remote callback signal");
    await this.persistence.recordWechatWorkAudit({
      action: "remote_callback_signal_received",
      status: "processed",
      callbackId: String(payload.eventId || "").trim() || null,
      openKfid,
    });
    this.scheduleCustomerServiceSync({ openKfid });
    return { accepted: true, openKfid };
  }

  private scheduleCustomerServiceSync(payload: { token?: string; openKfid?: string }, attempt = 0) {
    const key = payload.openKfid || appConfig.wechatWorkOpenKfid || "missing_open_kfid";
    if (attempt === 0) {
      const retryTimer = this.callbackSyncRetryTimers.get(key);
      if (retryTimer) {
        clearTimeout(retryTimer);
        this.callbackSyncRetryTimers.delete(key);
      }
    }
    if (this.scheduledSyncs.has(key)) {
      this.pendingCallbackSyncs.set(key, payload);
      return;
    }
    const pending = this.syncCustomerServiceMessages(payload)
      .then(async (sync) => {
        const immediateReplies = sync.processedCount > 0
          ? await this.wechat.processSafeSendQueue({
            limit: appConfig.lowValueAutomationSendQueueLimit,
            automationOnly: true,
            inboundReplyOnly: true,
          })
          : { scanned: 0, processed: [], blocked: [], skipped: [], failed: [] };
        await this.persistence.recordWechatWorkAudit({
          action: "callback_sync_completed",
          status: "processed",
          openKfid: payload.openKfid || null,
          receivedCount: sync.receivedCount,
          processedCount: sync.processedCount,
          immediateReplyProcessedCount: immediateReplies.processed.length,
          immediateReplyBlockedCount: immediateReplies.blocked.length,
          immediateReplyFailedCount: immediateReplies.failed.length,
          retryAttempt: attempt,
        });
        return { sync, immediateReplies };
      })
      .catch(async (error) => {
        const retryDelayMs = callbackSyncRetryDelayMs(
          error,
          attempt,
          appConfig.wechatWorkAutoSyncRateLimitBackoffMs,
        );
        if (error instanceof WechatWorkApiError && error.errcode === 45009) {
          this.autoSyncRateLimitRetryAt = Math.max(
            this.autoSyncRateLimitRetryAt,
            Date.now() + Math.max(appConfig.wechatWorkAutoSyncRateLimitBackoffMs, retryDelayMs || 0),
          );
        }
        await this.persistence.recordWechatWorkAudit({
          action: "callback_sync_failed",
          status: "failed",
          openKfid: payload.openKfid || null,
          errorMessage: error instanceof Error ? error.message : String(error),
          retryAttempt: attempt,
          retryScheduled: retryDelayMs !== null,
          retryDelayMs,
        });
        if (retryDelayMs !== null) {
          this.scheduleCallbackSyncRetry(key, payload, attempt + 1, retryDelayMs);
        }
      })
      .finally(() => {
        this.scheduledSyncs.delete(key);
        const pendingSignal = this.pendingCallbackSyncs.get(key);
        if (pendingSignal) {
          this.pendingCallbackSyncs.delete(key);
          this.scheduleCustomerServiceSync(pendingSignal);
        }
      });
    this.scheduledSyncs.set(key, pending);
  }

  private scheduleCallbackSyncRetry(
    key: string,
    payload: { token?: string; openKfid?: string },
    attempt: number,
    delayMs: number,
  ) {
    if (this.callbackSyncRetryTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.callbackSyncRetryTimers.delete(key);
      this.scheduleCustomerServiceSync(payload, attempt);
    }, delayMs);
    timer.unref?.();
    this.callbackSyncRetryTimers.set(key, timer);
  }

  private async processSyncedItem(message: WechatWorkKfMessage, fallbackOpenKfid: string) {
    const msgid = requiredText(message.msgid, "sync_msg msgid");
    if (await this.persistence.hasWechatWorkAuditMsgId(msgid) || this.inflightInbound.has(msgid)) {
      return { status: "duplicate", msgid };
    }
    this.inflightInbound.add(msgid);
    try {
      const event = isPlainObject(message.event) ? message.event : {};
      const openKfid = String(message.open_kfid || event.open_kfid || fallbackOpenKfid || "").trim();
      const externalUserId = String(message.external_userid || event.external_userid || "").trim();
      if (openKfid !== fallbackOpenKfid) {
        throw new BadRequestException("sync_msg item open_kfid does not match the durable cursor scope");
      }
      if (message.msgtype === "event") {
        return this.processSyncedEvent(message, event, msgid, openKfid, externalUserId);
      }
      if (message.servicer_userid) {
        return this.auditIgnoredMessage(message, msgid, openKfid, externalUserId, "servicer_origin");
      }
      const existingBinding = await this.persistence.getWechatWorkBinding(openKfid, externalUserId);
      const existingDuplicate = existingBinding
        ? await this.persistence.findMessageByExternalId(existingBinding.conversationId, msgid)
        : null;
      const duplicate = existingDuplicate;
      if (duplicate) {
        await this.persistence.recordWechatWorkAudit({
          action: "inbound_duplicate",
          status: "duplicate",
          msgid,
          openKfid,
          externalUserId,
          messageId: duplicate.id,
        });
        return { status: "duplicate", msgid, messageId: duplicate.id };
      }
      const normalizedBase = await normalizeInbound(message, msgid, openKfid, externalUserId, this.api);
      const enriched = this.inboundUnderstanding
        ? await this.inboundUnderstanding.enrich(normalizedBase)
        : normalizedBase;
      const normalized: NormalizedInbound = {
        ...normalizedBase,
        ...enriched,
        ...(enriched.understanding?.status === "manual_review" ? {
          mediaReview: {
            status: "manual_review" as const,
            mediaId: String(enriched.attachments[0]?.mediaId || ""),
            reason: String(normalizedBase.mediaReview?.reason || enriched.understanding.reason || "media_understanding_failed"),
            ...(normalizedBase.mediaReview?.apiErrcode == null ? {} : { apiErrcode: normalizedBase.mediaReview.apiErrcode }),
          },
        } : {}),
      };
      const binding = await this.persistence.upsertWechatWorkBinding({
        openKfid,
        externalUserId,
        sendTime: message.send_time,
      });
      const attachments = await this.registerInboundDesignAssets(normalized, binding);
      const concurrentDuplicate = await this.persistence.findMessageByExternalId(binding.conversationId, msgid);
      if (concurrentDuplicate) {
        await this.persistence.recordWechatWorkAudit({
          action: "inbound_duplicate",
          status: "duplicate",
          msgid,
          openKfid,
          externalUserId,
          messageId: concurrentDuplicate.id,
        });
        return { status: "duplicate", msgid, messageId: concurrentDuplicate.id };
      }
      const result = await this.wechat.processInboundMessage({
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        text: normalized.text,
        externalId: msgid,
        createdAt: normalized.createdAt,
        attachments,
        mediaUnderstanding: normalized.understanding,
      });
      if (result.deduplicated) {
        await this.persistence.recordWechatWorkAudit({
          action: "inbound_duplicate",
          status: "duplicate",
          msgid,
          openKfid,
          externalUserId,
          messageId: result.message?.id || null,
          deduplicatedBy: "message_unique_constraint",
        });
        return { status: "duplicate", msgid, messageId: result.message?.id || null };
      }
      await this.persistence.recordWechatWorkAudit({
        action: "inbound_processed",
        status: "processed",
        msgid,
        msgtype: normalized.msgtype,
        openKfid,
        externalUserId,
        wechatAccountId: binding.wechatAccountId,
        customerId: binding.customerId,
        conversationId: binding.conversationId,
        messageId: result.message?.id || null,
        mediaUnderstandingStatus: normalized.understanding?.status || null,
      });
      if (normalized.understanding?.status === "understood") {
        await this.persistence.recordWechatWorkAudit({
          action: "inbound_media_understood",
          status: "understood",
          msgid,
          msgtype: normalized.msgtype,
          openKfid,
          externalUserId,
          messageId: result.message?.id || null,
          provider: normalized.understanding.provider || null,
          model: normalized.understanding.model || null,
          cacheHit: normalized.understanding.cacheHit,
          elapsedMs: normalized.understanding.elapsedMs,
        });
      }
      if (normalized.mediaReview) {
        await this.persistence.recordWechatWorkAudit({
          action: "inbound_media_manual_review",
          status: "manual_review",
          msgid,
          msgtype: normalized.msgtype,
          openKfid,
          externalUserId,
          messageId: result.message?.id || null,
          mediaId: normalized.mediaReview.mediaId,
          reason: normalized.mediaReview.reason,
          apiErrcode: normalized.mediaReview.apiErrcode ?? null,
        });
      }
      const profiledBinding = await this.refreshWechatWorkCustomerProfile(binding);
      return { status: "processed", msgid, binding: profiledBinding, result };
    } finally {
      this.inflightInbound.delete(msgid);
    }
  }

  private async refreshWechatWorkCustomerProfile(binding: any, force = false) {
    const existingName = String(binding?.customer?.name || "").trim();
    const existingAvatar = String(binding?.customer?.avatarUrl || "").trim();
    if (!force && existingAvatar && !isWechatWorkPlaceholderName(existingName)) return binding;
    try {
      const response = await this.api.getCustomerProfiles([binding.externalUserId]);
      const profile = (Array.isArray(response.customer_list) ? response.customer_list : [])
        .find((item) => String(item?.external_userid || "") === String(binding.externalUserId || ""));
      if (!profile) return binding;
      const normalized = normalizeWechatWorkCustomerProfile(profile);
      if (!normalized.nickname && !normalized.avatar) return binding;
      const refreshed = await this.persistence.upsertWechatWorkBinding({
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        customerProfile: normalized,
      });
      await this.persistence.recordWechatWorkAudit({
        action: "customer_profile_refreshed",
        status: "processed",
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: binding.wechatAccountId,
        customerId: binding.customerId,
        conversationId: binding.conversationId,
        nicknamePresent: Boolean(normalized.nickname),
        avatarPresent: Boolean(normalized.avatar),
      });
      return refreshed;
    } catch (error) {
      await this.persistence.recordWechatWorkAudit({
        action: "customer_profile_refresh_failed",
        status: "failed",
        openKfid: binding?.openKfid || null,
        externalUserId: binding?.externalUserId || null,
        customerId: binding?.customerId || null,
        conversationId: binding?.conversationId || null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return binding;
    }
  }

  private async processSyncedEvent(
    message: WechatWorkKfMessage,
    event: Record<string, unknown>,
    msgid: string,
    openKfid: string,
    externalUserId: string,
  ) {
    const eventType = String(event.event_type || "unknown");
    if (openKfid && externalUserId) {
      await this.persistence.upsertWechatWorkBinding({ openKfid, externalUserId, sendTime: message.send_time });
    }
    if (eventType === "msg_send_fail") {
      const failMsgid = requiredText(event.fail_msgid, "event.fail_msgid");
      const attempt = await this.persistence.findWechatWorkSendAttemptByMsgId(failMsgid);
      if (attempt) {
        const errorMessage = `wechat work reported send failure type ${String(event.fail_type ?? "unknown")}`;
        await this.wechat.settleWechatWorkAsyncFailure(attempt, errorMessage, {
          failureEventMsgId: msgid,
          failType: event.fail_type ?? null,
        });
      }
      await this.persistence.recordWechatWorkAudit({
        action: "send_async_failed",
        status: "processed",
        deliveryStatus: "failed",
        msgid,
        failMsgid,
        failType: event.fail_type ?? null,
        openKfid,
        externalUserId,
        sendAttemptId: attempt?.id || null,
        sendTaskId: attempt?.sendTaskId || null,
      });
      return { status: "processed", msgid, eventType, sendAttemptId: attempt?.id || null };
    }
    await this.persistence.recordWechatWorkAudit({
      action: "event_processed",
      status: "processed",
      msgid,
      eventType,
      openKfid: openKfid || null,
      externalUserId: externalUserId || null,
      event,
    });
    return { status: "processed", msgid, eventType };
  }

  private async auditIgnoredMessage(
    message: WechatWorkKfMessage,
    msgid: string,
    openKfid: string,
    externalUserId: string,
    reason: string,
  ) {
    await this.persistence.recordWechatWorkAudit({
      action: "inbound_ignored",
      status: "ignored",
      reason,
      msgid,
      msgtype: message.msgtype || "unknown",
      openKfid: openKfid || null,
      externalUserId: externalUserId || null,
    });
    return { status: "ignored", reason, msgid };
  }

  private extractEncryptedBody(body: unknown) {
    if (typeof body === "string") return requiredText(parseXml(body).Encrypt, "Encrypt");
    if (isPlainObject(body)) {
      const direct = body.Encrypt || body.encrypt || (isPlainObject(body.xml) ? body.xml.Encrypt || body.xml.encrypt : undefined);
      if (direct) return String(direct);
      if (typeof body.body === "string") return requiredText(parseXml(body.body).Encrypt, "Encrypt");
    }
    throw new BadRequestException("wechat work callback requires encrypted XML body");
  }

  private verifySignature(query: CallbackQuery, encrypted: string) {
    const signature = query.msg_signature || query.signature || "";
    const expected = sha1Sorted([
      requiredText(appConfig.wechatWorkToken, "WECHAT_WORK_TOKEN"),
      requiredText(query.timestamp, "timestamp"),
      requiredText(query.nonce, "nonce"),
      encrypted,
    ]);
    if (!safeEqual(signature, expected)) throw new BadRequestException("wechat work callback signature mismatch");
  }

  private decryptMessage(encrypted: string) {
    const aesKey = requiredText(appConfig.wechatWorkEncodingAesKey, "WECHAT_WORK_ENCODING_AES_KEY");
    const key = Buffer.from(`${aesKey}=`, "base64");
    if (key.length !== 32) throw new BadRequestException("WECHAT_WORK_ENCODING_AES_KEY must decode to 32 bytes");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);
    const unpadded = pkcs7Unpad(plain);
    if (unpadded.length < 20) throw new BadRequestException("wechat work callback plaintext is too short");
    const messageLength = unpadded.readUInt32BE(16);
    const messageStart = 20;
    const messageEnd = messageStart + messageLength;
    if (messageEnd > unpadded.length) throw new BadRequestException("wechat work callback message length is invalid");
    return {
      message: unpadded.subarray(messageStart, messageEnd).toString("utf8"),
      receiveId: unpadded.subarray(messageEnd).toString("utf8"),
    };
  }

  private assertReceiveId(receiveId: string) {
    const expected = requiredText(appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID");
    if (!safeEqual(receiveId, expected)) throw new BadRequestException("wechat work callback receive id mismatch");
  }

  private async registerInboundDesignAssets(normalized: NormalizedInbound, binding: {
    wechatAccountId: string;
    conversationId: string;
    customerId: string;
  }) {
    if (!this.assets || normalized.msgtype !== "image") return normalized.attachments;
    const understandingText = JSON.stringify(normalized.understanding || {});
    const role = /logo|标志|商标/i.test(understandingText) ? "customer_logo" : "customer_reference";
    const source = `wechat_work_kf:${normalized.msgid}`;
    const existing = await this.assets.list({
      ownerType: "customer",
      ownerId: binding.customerId,
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
    });
    const prior = (Array.isArray(existing) ? existing : []).find((item: any) => String(item.source || "") === source);
    return Promise.all(normalized.attachments.map(async (attachment) => {
      if (prior) return { ...attachment, assetId: prior.id, designAssetRole: prior.role || role };
      const localPath = String(attachment.localPath || "").trim();
      const mimeType = String(attachment.type || "").toLowerCase();
      if (!localPath || !["image/jpeg", "image/png"].includes(mimeType)) return attachment;
      try {
        const bytes = fs.readFileSync(localPath);
        const saved = await this.assets!.upload({
          ownerType: "customer",
          ownerId: binding.customerId,
          role,
          fileName: path.basename(localPath),
          mimeType,
          source,
          base64: bytes.toString("base64"),
          expectedWechatAccountId: binding.wechatAccountId,
          expectedConversationId: binding.conversationId,
          expectedCustomerId: binding.customerId,
        });
        return { ...attachment, assetId: saved.id, designAssetRole: saved.role || role };
      } catch (error) {
        await this.recordOperationFailure("inbound_design_asset_register_failed", error, {
          msgid: normalized.msgid,
          openKfid: normalized.openKfid,
          externalUserId: normalized.externalUserId,
          conversationId: binding.conversationId,
          customerId: binding.customerId,
        });
        return { ...attachment, designAssetStatus: "manual_review" };
      }
    }));
  }

  private recordOperationFailure(action: string, error: unknown, details: Record<string, unknown> = {}) {
    const apiError = error instanceof WechatWorkApiError ? error : null;
    return this.persistence.recordWechatWorkAudit({
      action,
      status: "failed",
      ...details,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: String(error instanceof Error ? error.message : error || "unknown error").slice(0, 500),
      apiOperation: apiError?.operation || null,
      apiErrcode: apiError?.errcode ?? null,
      httpStatus: apiError?.httpStatus ?? null,
    });
  }
}

async function normalizeInbound(
  message: WechatWorkKfMessage,
  msgid: string,
  openKfid: string,
  externalUserId: string,
  api: WechatWorkApiClient,
): Promise<NormalizedInbound> {
  const msgtype = String(message.msgtype || "").trim();
  if (!openKfid || !externalUserId) {
    throw new BadRequestException("sync_msg customer message requires open_kfid and external_userid");
  }
  const body = isPlainObject(message[msgtype]) ? message[msgtype] as Record<string, unknown> : {};
  const text = inboundText(msgtype, body);
  if (["image", "voice", "video", "file"].includes(msgtype)) {
    const kind = msgtype as "image" | "voice" | "video" | "file";
    const mediaId = requiredText(body.media_id, `${kind}.media_id`);
    try {
      const media = await api.downloadMedia({ mediaId, maxBytes: maxWechatWorkInboundMediaBytes(kind) });
      const stored = kind === "image"
        ? await storeWechatWorkInboundImage({ msgid, mediaId, media })
        : await storeWechatWorkInboundMedia({ msgid, mediaId, kind, media });
      return {
        msgid,
        openKfid,
        externalUserId,
        msgtype,
        text,
        createdAt: message.send_time ? new Date(Number(message.send_time) * 1000).toISOString() : undefined,
        attachments: [{
          source: "wechat_work_kf",
          msgid,
          msgtype,
          openKfid,
          externalUserId,
          mediaId: stored.mediaId,
          localPath: stored.localPath,
          size: stored.size,
          type: stored.type,
          ...(kind === "image" ? {
            width: "width" in stored ? stored.width : undefined,
            height: "height" in stored ? stored.height : undefined,
          } : {}),
          fingerprint: stored.fingerprint,
          fingerprintAlgorithm: kind === "image" ? "dhash64:v1" : "sha256:v1",
          status: stored.status,
          reviewRequired: false,
          ...(kind === "file" ? { fileName: String(body.filename || body.file_name || "").trim() } : {}),
        }],
        raw: message,
      };
    } catch (error) {
      const apiError = error instanceof WechatWorkApiError ? error : null;
      if (apiError && apiError.disposition !== "permanent") throw apiError;
      const reason = apiError?.disposition || "download_or_decode_failed";
      return {
        msgid,
        openKfid,
        externalUserId,
        msgtype,
        text,
        createdAt: message.send_time ? new Date(Number(message.send_time) * 1000).toISOString() : undefined,
        attachments: [{
          source: "wechat_work_kf",
          msgid,
          msgtype,
          openKfid,
          externalUserId,
          mediaId,
          status: "manual_review",
          reviewRequired: true,
          reason,
          ...(apiError?.errcode == null ? {} : { apiErrcode: apiError.errcode }),
        }],
        raw: message,
        mediaReview: {
          status: "manual_review",
          mediaId,
          reason,
          ...(apiError?.errcode == null ? {} : { apiErrcode: apiError.errcode }),
        },
      };
    }
  }
  return {
    msgid,
    openKfid,
    externalUserId,
    msgtype,
    text,
    createdAt: message.send_time ? new Date(Number(message.send_time) * 1000).toISOString() : undefined,
    attachments: [
      {
        source: "wechat_work_kf",
        msgid,
        msgtype,
        openKfid,
        externalUserId,
        payload: body,
        raw: message,
      },
    ],
    raw: message,
  };
}

function isTransientInboundMediaFailure(error: unknown) {
  return error instanceof WechatWorkApiError && error.operation === "media_get" && error.disposition !== "permanent";
}

function inboundText(msgtype: string, body: Record<string, unknown>) {
  if (msgtype === "text") return requiredText(body.content, "text.content");
  if (msgtype === "location") {
    return `[位置] ${[body.name, body.address].map((item) => String(item || "").trim()).filter(Boolean).join(" ")}`.trim();
  }
  if (msgtype === "link") {
    return `[链接] ${[body.title, body.desc, body.url].map((item) => String(item || "").trim()).filter(Boolean).join(" ")}`.trim();
  }
  if (msgtype === "miniprogram") return `[小程序] ${String(body.title || "").trim()}`.trim();
  if (msgtype === "business_card") return `[名片] ${String(body.userid || "").trim()}`.trim();
  const labels: Record<string, string> = { image: "图片", voice: "语音", video: "视频", file: "文件", msgmenu: "菜单" };
  if (labels[msgtype]) return `[${labels[msgtype]}]`;
  throw new BadRequestException(`unsupported wechat work inbound message type: ${msgtype || "unknown"}`);
}

function configCheck(key: string, env: string, value: string, pattern?: RegExp) {
  const present = Boolean(String(value || "").trim());
  return { key, env, ok: present && (!pattern || pattern.test(value)), detail: present ? "configured" : "missing" };
}

function normalizeWechatWorkCustomerEntryUrl(value: string, requireEncodedScene: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new BadRequestException("请输入企业微信后台复制的完整客服链接");
  }
  const isLegacySceneLink = /^\/kf\/[0-9A-Za-z_-]+\/?$/.test(parsed.pathname);
  const isStableKfidLink = /^\/kfid\/[0-9A-Za-z_-]+\/?$/.test(parsed.pathname);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "work.weixin.qq.com"
    || (!isLegacySceneLink && !isStableKfidLink)
  ) {
    throw new BadRequestException("只支持 https://work.weixin.qq.com/kf/ 或 /kfid/ 开头的企业微信官方客服链接");
  }
  if (
    requireEncodedScene
    && isLegacySceneLink
    && !parsed.searchParams.has("enc_scene")
    && !parsed.searchParams.has("encScene")
  ) {
    throw new BadRequestException("客服链接缺少企业微信签名参数，请从企业微信后台重新复制完整链接");
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeWechatWorkSecret(value: unknown) {
  const secret = String(value || "").trim();
  if (!/^[0-9A-Za-z_-]{16,256}$/.test(secret)) {
    throw new BadRequestException("请输入企业微信后台复制的完整微信客服 Secret");
  }
  return secret;
}

function normalizeWechatWorkAccounts(value: unknown) {
  return (Array.isArray(value) ? value : []).map((account: any) => ({
    openKfid: String(account?.open_kfid || "").trim(),
    name: String(account?.name || "").trim(),
    avatar: String(account?.avatar || "").trim(),
    managePrivilege: Boolean(account?.manage_privilege),
  })).filter((account) => account.openKfid);
}

function customerServiceCredentialError(error: unknown) {
  if (error instanceof WechatWorkApiError && error.errcode === 95011) {
    return new BadRequestException("这个 Secret 仍属于独立版微信客服；请复制企业微信联合版“微信客服 → API”页面显示的 Secret");
  }
  if (error instanceof WechatWorkApiError && error.errcode === 95012) {
    return new BadRequestException("这个 Secret 属于联合版，但当前微信客服处于独立版，请复制当前模式页面显示的微信客服 Secret");
  }
  if (error instanceof WechatWorkApiError && [40001, 40014, 41001, 42001].includes(Number(error.errcode))) {
    return new BadRequestException("企业微信拒绝了这个 Secret，请确认复制的是“微信客服”Secret，不是自建应用 Secret");
  }
  return new BadRequestException(error instanceof Error ? error.message : "微信客服 Secret 验证失败");
}

function persistWechatWorkDesktopCredential(payload: { secret: string; openKfid: string }) {
  const envPath = process.env.DESKTOP_ENV_FILE
    ? path.resolve(process.env.DESKTOP_ENV_FILE)
    : path.resolve(process.cwd(), ".env");
  let current = "";
  try {
    const stat = fs.lstatSync(envPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException("桌面配置文件不是安全的普通文件");
    current = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  const updates = {
    WECHAT_WORK_SECRET: payload.secret,
    WECHAT_WORK_OPEN_KFID: payload.openKfid,
  };
  const seen = new Set<string>();
  const lines = current.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(WECHAT_WORK_SECRET|WECHAT_WORK_OPEN_KFID)\s*=/);
    if (!match) return line;
    const key = match[1] as keyof typeof updates;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const temporaryPath = `${envPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch {}
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }

}

function safeReadinessEndpointOrigin(value: unknown) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return undefined;
  }
}

function summarizeRuntimeEvidence(audit: Array<Record<string, unknown>>) {
  const has = (action: string, statuses: string[]) => audit.some((record) =>
    String(record?.action || "") === action && statuses.includes(String(record?.status || "")),
  );
  return {
    callbackVerificationAccepted: has("callback_verification_accepted", ["accepted", "processed"]),
    callbackAccepted: has("callback_accepted", ["accepted", "processed"]),
    inboundProcessed: has("inbound_processed", ["processed"]),
    sendApiAccepted: has("send_api_accepted", ["accepted", "sent"]),
  };
}

function validEncodingAesKey(value: string) {
  const text = String(value || "").trim();
  if (text.length !== 43) return false;
  try {
    return Buffer.from(`${text}=`, "base64").length === 32;
  } catch {
    return false;
  }
}

function sha1Sorted(values: string[]) {
  return crypto.createHash("sha1").update([...values].sort().join("")).digest("hex");
}

function stableSyncedItemId(message: WechatWorkKfMessage) {
  const msgid = String(message?.msgid || "").trim();
  if (msgid) return msgid;
  return `sync_item_${crypto.createHash("sha256").update(JSON.stringify(message || {})).digest("hex")}`;
}

function syncedItemOpenKfid(message: WechatWorkKfMessage) {
  const event = isPlainObject(message?.event) ? message.event : {};
  return String(message?.open_kfid || event.open_kfid || "").trim();
}

function syncBatchFingerprint(messages: WechatWorkKfMessage[]) {
  return crypto
    .createHash("sha256")
    .update(messages.map((message) => stableSyncedItemId(message)).join("\n"))
    .digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function pkcs7Unpad(buffer: Buffer) {
  if (!buffer.length) throw new BadRequestException("invalid PKCS7 payload");
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 32 || pad > buffer.length) throw new BadRequestException("invalid PKCS7 padding");
  for (let index = buffer.length - pad; index < buffer.length; index += 1) {
    if (buffer[index] !== pad) throw new BadRequestException("invalid PKCS7 padding");
  }
  return buffer.subarray(0, buffer.length - pad);
}

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<([A-Za-z0-9_:-]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml))) result[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  return result;
}

function decodeXml(value: string) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function requiredText(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) throw new BadRequestException(`${label} is required`);
  return text;
}

function uniqueTextList(value: unknown) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
}

function normalizeWechatWorkCustomerProfile(profile: WechatWorkCustomerProfile) {
  return {
    nickname: String(profile.nickname || "").trim().slice(0, 120),
    avatar: safeWechatWorkAvatarUrl(profile.avatar),
  };
}

function safeWechatWorkAvatarUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isWechatWorkPlaceholderName(value: unknown) {
  return /^企业微信客户(?:\s|$)/.test(String(value || "").trim());
}

function clampLimit(value: unknown) {
  const limit = Math.floor(Number(value || 1000));
  if (!Number.isFinite(limit) || limit <= 0) return 1000;
  return Math.min(limit, 1000);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
