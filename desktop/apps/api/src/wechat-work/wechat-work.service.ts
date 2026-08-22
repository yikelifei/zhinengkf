import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
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
  sealWechatWorkEventCode,
  WECHAT_WORK_EVENT_CODE_LONG_TTL_MS,
  WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS,
  wechatWorkEventCodeHash,
} from "./wechat-work-event-code";
import {
  WechatWorkInboundUnderstandingService,
  type WechatWorkMediaUnderstanding,
} from "./wechat-work-inbound-understanding.service";
import { resolveWechatWorkImageFile } from "./wechat-work-media";
import {
  isWechatWorkEventReplyPayloadKind,
  normalizeWechatWorkCustomerServiceMessages,
  normalizeWechatWorkEventMsgMenu,
} from "./wechat-work-outbound-message";
import { buildWechatWorkProductionReadiness } from "./wechat-work-readiness";
import {
  fetchWechatWorkRemoteReadiness,
  remoteReadinessErrorCode,
  withWechatWorkReadinessSource,
} from "./wechat-work-readiness-remote";
import { WechatWorkAuthorizationService } from "./wechat-work-authorization.service";
import { WechatWorkCallbackEventRelay } from "./wechat-work-callback-events";
import { deterministicOperationId, normalizeOperationKey } from "../shared/operation-idempotency";
import { normalizeWechatWorkMessageContent } from "../shared/conversation-message-presentation";

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
  messageContent?: Record<string, unknown> | null;
  createdAt?: string;
  attachments: Array<Record<string, unknown>>;
  raw: WechatWorkKfMessage;
  mediaReview?: { status: "manual_review"; mediaId: string; reason: string; apiErrcode?: number };
  understanding?: WechatWorkMediaUnderstanding;
};

type UpgradeServiceMemberOption = {
  userId: string;
  displayName: string;
  resolution: "user_get" | "user_get_alias" | "userid_fallback";
  errorCode?: number | null;
};

const WECHAT_WORK_INBOUND_MAX_ATTEMPTS = 3;
const WECHAT_WORK_ACCOUNT_PERMISSION_RETRY_MS = 5 * 60 * 1000;
const WECHAT_WORK_CALLBACK_SYNC_RETRY_DELAYS_MS = [750, 2000, 5000];
const WECHAT_WORK_CUSTOMER_UPGRADE_RECOVERY_LEASE_MS = 30 * 1000;

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
  private readonly customerUpgradeContactWayInFlight = new Map<string, Promise<any>>();
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

  async getCapabilityMatrix() {
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
      configCheck("openKfid", "WECHAT_WORK_OPEN_KFID", appConfig.wechatWorkOpenKfid),
      configCheck("publicHttpsUrl", "CUSTOMER_SERVICE_PUBLIC_BASE_URL", appConfig.customerServicePublicBaseUrl, /^https:\/\//i),
      configCheck("apiHttpsUrl", "WECHAT_WORK_API_BASE_URL", appConfig.wechatWorkApiBaseUrl, /^https:\/\//i),
    ];
    const audit = await this.persistence.listWechatWorkAuditLogs(500);
    const hasAudit = (action: string, statuses: string[]) => audit.some((record: any) =>
      record?.action === action && statuses.includes(String(record?.status || "")),
    );
    const qrPermissionFailure = latestExternalContactPermissionFailure(audit);
    const qrPermissionSuccess = latestExternalContactPermissionSuccess(audit);
    const qrPermissionFailureActive = Boolean(
      qrPermissionFailure
      && (!qrPermissionSuccess || auditTimestamp(qrPermissionFailure) >= auditTimestamp(qrPermissionSuccess)),
    );
    const qrPermissionLatestEvidence = [qrPermissionFailure, qrPermissionSuccess]
      .filter(Boolean)
      .sort((left, right) => auditTimestamp(right) - auditTimestamp(left))[0] || null;
    const sendAdapter = this.wechat.getSendAdapter();
    const capabilities = buildWechatWorkCapabilityMatrix({
      configured: checks.every((item) => item.ok),
      callbackEvidence: hasAudit("callback_accepted", ["processed", "accepted"]),
      inboundEvidence: hasAudit("inbound_processed", ["processed"]),
      sendAcceptedEvidence: hasAudit("send_api_accepted", ["accepted", "sent", "processed"]),
      externalContactConfigured: Boolean(
        appConfig.wechatWorkExternalContactSecret || appConfig.wechatWorkSecret,
      ),
      externalContactVerified: hasAudit("external_contact_credential_validated", ["processed"])
        || hasAudit("external_contact_way_created", ["processed"]),
      qrSendAcceptedEvidence: hasAudit("customer_upgrade_qr_api_accepted", ["sent"]),
      qrPermissionLastVerifiedAt: qrPermissionLatestEvidence?.createdAt || null,
      qrPermissionErrcode: qrPermissionFailureActive
        ? qrPermissionFailure?.apiErrcode ?? qrPermissionFailure?.errcode ?? null
        : null,
      sendAdapter,
    });
    return {
      checkedAt: new Date().toISOString(),
      configured: checks.every((item) => item.ok),
      checks,
      summary: summarizeWechatWorkCapabilities(capabilities),
      capabilities,
      proofBoundaries: [
        "API accepted 表示企业微信服务端接受请求，不等同于客户手机已显示。",
        "upgrade_service 只在接待人员侧产生升级服务提示，不会自动向客户发送专员二维码。",
        "专员二维码由已获得客户联系 API 权限的自建应用生成，再通过 kf/send_msg 发送；同一自建应用凭证可以复用，无需重复寻找第二个 Secret。",
      ],
    };
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
      if (event === "change_external_contact") {
        await this.handleExternalContactChangeCallback(xml, callbackId);
        return "success";
      }
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
      if (appConfig.wechatWorkCallbackProcessingMode === "signal_only") {
        await this.persistence.recordWechatWorkAudit({
          action: "callback_sync_delegated",
          status: "processed",
          msgid: callbackId,
          callbackId,
          openKfid: openKfid || null,
          reason: "fixed_egress_desktop_relay",
        });
      } else {
        this.scheduleCustomerServiceSync({ token, openKfid });
      }
      return "success";
    } catch (error) {
      await this.recordOperationFailure("callback_rejected", error, {
        signaturePresent: Boolean(query.msg_signature || query.signature),
      });
      throw error;
    }
  }

  private async handleExternalContactChangeCallback(xml: Record<string, string>, callbackId: string) {
    const changeType = String(xml.ChangeType || "").trim();
    if (!["add_external_contact", "add_half_external_contact"].includes(changeType)) {
      await this.persistence.recordWechatWorkAudit({
        action: "callback_ignored",
        status: "ignored",
        msgid: callbackId,
        callbackId,
        event: `change_external_contact:${changeType || "unknown"}`,
      });
      return;
    }
    const state = requiredText(xml.State, "State");
    const memberUserId = requiredText(xml.UserID || xml.UserId, "UserID");
    const addedExternalUserId = requiredText(xml.ExternalUserID || xml.ExternalUserId, "ExternalUserID");
    const upgrade = await this.persistence.findWechatWorkCustomerUpgradeByState(state);
    if (
      !upgrade
      || String(upgrade.memberUserId || "") !== memberUserId
      || String(upgrade.status || "") === "superseded"
    ) {
      await this.persistence.recordWechatWorkAudit({
        action: "external_contact_upgrade_callback_unmatched",
        status: "manual_review",
        msgid: callbackId,
        callbackId,
        event: changeType,
        memberUserId,
        state,
        externalUserId: addedExternalUserId,
        reason: String(upgrade?.status || "") === "superseded" ? "customer_upgrade_superseded" : "customer_upgrade_unmatched",
      });
      return;
    }
    if (changeType === "add_half_external_contact") {
      if (String(upgrade.status || "") === "added_confirmed") return;
      const halfAddedAt = new Date().toISOString();
      const updated = await this.persistence.updateWechatWorkCustomerUpgrade(upgrade.id, {
        status: "half_added_pending",
        addedExternalUserId,
        halfAddedAt,
        errorMessage: "客户已发起添加，但所选专员尚未确认，不能视为长期客户升级完成。",
      });
      if (!updated) {
        await this.recordCustomerUpgradeCallbackConflict(upgrade, callbackId, changeType, addedExternalUserId);
        return;
      }
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${upgrade.id}:half-added:${callbackId}`),
        action: "customer_upgrade_half_added_pending",
        status: "pending",
        msgid: callbackId,
        callbackId,
        event: changeType,
        openKfid: upgrade.openKfid,
        externalUserId: upgrade.externalUserId,
        conversationId: upgrade.conversationId,
        customerId: upgrade.customerId,
        memberUserId,
        state,
        addedExternalUserId,
        halfAddedAt,
      });
      return;
    }

    let addedUnionId = "";
    try {
      const profile = await this.api.getExternalContact(addedExternalUserId);
      addedUnionId = String(profile.external_contact?.unionid || "").trim();
    } catch (error) {
      await this.recordOperationFailure("external_contact_identity_lookup_failed", error, {
        callbackId,
        memberUserId,
        state,
        addedExternalUserId,
      });
    }
    const sourceUnionId = String(upgrade.sourceUnionId || "").trim();
    if (!sourceUnionId || !addedUnionId || sourceUnionId !== addedUnionId) {
      const identityError = !sourceUnionId
        ? "原微信客服客户缺少 unionid，无法确认新增联系人身份。"
        : !addedUnionId
          ? "新增外部联系人缺少 unionid，无法确认与原微信客服客户一致。"
          : "新增外部联系人与原微信客服客户 unionid 不一致，二维码可能被转发。";
      const updated = await this.persistence.updateWechatWorkCustomerUpgrade(upgrade.id, {
        status: "identity_unverified",
        addedExternalUserId,
        errorMessage: identityError,
      });
      if (!updated) {
        await this.recordCustomerUpgradeCallbackConflict(upgrade, callbackId, changeType, addedExternalUserId);
        return;
      }
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${upgrade.id}:identity-unverified:${callbackId}`),
        action: "customer_upgrade_identity_unverified",
        status: "manual_review",
        msgid: callbackId,
        callbackId,
        event: changeType,
        openKfid: upgrade.openKfid,
        externalUserId: upgrade.externalUserId,
        conversationId: upgrade.conversationId,
        customerId: upgrade.customerId,
        memberUserId,
        state,
        addedExternalUserId,
        reason: identityError,
      });
      return;
    }

    const addedAt = new Date().toISOString();
    const updated = await this.persistence.updateWechatWorkCustomerUpgrade(upgrade.id, {
      status: "added_confirmed",
      addedExternalUserId,
      identityVerifiedAt: addedAt,
      addedAt,
      errorMessage: null,
    });
    if (!updated) {
      await this.recordCustomerUpgradeCallbackConflict(upgrade, callbackId, changeType, addedExternalUserId);
      return;
    }
    await this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wwaudit", `${upgrade.id}:added-confirmed`),
      action: "customer_upgrade_added_confirmed",
      status: "processed",
      msgid: callbackId,
      callbackId,
      event: changeType,
      openKfid: upgrade.openKfid,
      externalUserId: upgrade.externalUserId,
      wechatAccountId: upgrade.wechatAccountId,
      conversationId: upgrade.conversationId,
      customerId: upgrade.customerId,
      memberUserId,
      state,
      addedExternalUserId,
      addedAt: updated?.addedAt || addedAt,
    });
    await this.persistence.recordWechatWorkAudit({
      action: "callback_accepted",
      status: "processed",
      msgid: callbackId,
      callbackId,
      event: changeType,
      externalUserId: upgrade.externalUserId,
    });
  }

  private async recordCustomerUpgradeCallbackConflict(
    upgrade: any,
    callbackId: string,
    changeType: string,
    addedExternalUserId: string,
  ) {
    await this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wwaudit", `${upgrade.id}:callback-write-conflict:${callbackId}`),
      action: "customer_upgrade_callback_write_conflict",
      status: "manual_review",
      msgid: callbackId,
      callbackId,
      event: changeType,
      openKfid: upgrade.openKfid,
      externalUserId: upgrade.externalUserId,
      conversationId: upgrade.conversationId,
      customerId: upgrade.customerId,
      memberUserId: upgrade.memberUserId,
      addedExternalUserId,
    });
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
      const pageOutcomes: any[] = new Array(messages.length);
      const customerLanes = new Map<string, Promise<void>>();
      messages.forEach((message, index) => {
        const laneKey = syncedItemCustomerLaneKey(message, fallbackOpenKfid);
        const previous = customerLanes.get(laneKey) || Promise.resolve();
        const current = previous.then(async () => {
          try {
            pageOutcomes[index] = { kind: "result", value: await this.processSyncedItem(message, fallbackOpenKfid) };
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
            await this.persistence.recordWechatWorkAudit({
              action: "inbound_failed",
              ...failure,
              openKfid: fallbackOpenKfid,
              externalUserId: scopeMismatch ? null : message.external_userid || null,
              cursorScopeMismatch: scopeMismatch,
            });
            pageOutcomes[index] = { kind: "failure", value: failure, permanent };
          }
        });
        customerLanes.set(laneKey, current);
      });
      await Promise.all(customerLanes.values());
      for (const outcome of pageOutcomes) {
        if (outcome?.kind === "failure") {
          failed.push(outcome.value);
          if (!outcome.permanent) pageTerminal = false;
          continue;
        }
        const result = outcome?.value;
        if (result?.status === "processed") processed.push(result);
        else if (result?.status === "duplicate") duplicates.push(result);
        else if (result) ignored.push(result);
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
    const records = await this.persistence.listWechatWorkAuditLogs(limit);
    return {
      records: records.map((record: any) => redactWechatWorkAuditRecord(record)),
    };
  }

  async getCustomerServiceOperations() {
    const response = await this.api.listCustomerServiceAccounts();
    const rawAccounts = Array.isArray(response.account_list) ? response.account_list : [];
    const servicerResults = await Promise.all(rawAccounts.map(async (account) => {
      const openKfid = String(account.open_kfid || "").trim();
      if (!openKfid) return { openKfid, servicers: [], error: "客服账号缺少 open_kfid" };
      try {
        const result = await this.api.listCustomerServiceServicers(openKfid);
        return {
          openKfid,
          servicers: Array.isArray(result.servicer_list) ? result.servicer_list : [],
          error: "",
        };
      } catch (error) {
        return {
          openKfid,
          servicers: [],
          error: error instanceof Error ? error.message : "接待人员读取失败",
        };
      }
    }));
    const directoryUsers: Array<{ userId: string; departments: number[] }> = [];
    let directoryError = "";
    let memberSource: "enterprise_directory" | "upgrade_service_members" | "assigned_servicers_only" = "enterprise_directory";
    try {
      let cursor = "";
      for (let page = 0; page < 20; page += 1) {
        const directory = await this.api.listVisibleUserIds(cursor);
        for (const item of Array.isArray(directory.dept_user) ? directory.dept_user : []) {
          const userId = String(item.userid || "").trim();
          if (!userId) continue;
          const existing = directoryUsers.find((member) => member.userId === userId);
          const department = Number(item.department);
          if (existing) {
            if (Number.isInteger(department) && department > 0 && !existing.departments.includes(department)) {
              existing.departments.push(department);
            }
          } else {
            directoryUsers.push({
              userId,
              departments: Number.isInteger(department) && department > 0 ? [department] : [],
            });
          }
        }
        const nextCursor = String(directory.next_cursor || "").trim();
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
    } catch (error) {
      directoryError = customerServiceDirectoryError(error);
      memberSource = "assigned_servicers_only";
      try {
        const upgrade = await this.api.getUpgradeServiceConfig();
        for (const userId of uniqueTextList(upgrade.member_range?.userid_list)) {
          if (!directoryUsers.some((member) => member.userId === userId)) {
            directoryUsers.push({ userId, departments: [] });
          }
        }
        if (directoryUsers.length) memberSource = "upgrade_service_members";
      } catch {
        // Assigned servicers remain readable even when directory and upgrade scopes are unavailable.
      }
    }
    const userIds = uniqueTextList([
      ...servicerResults.flatMap((result) => result.servicers.map((servicer) => servicer.userid)),
      ...directoryUsers.map((member) => member.userId),
    ]);
    const profiles = new Map<string, {
      displayName: string;
      avatar: string;
      departments: number[];
      resolution: "user_get" | "user_get_alias" | "userid_fallback";
    }>();
    await Promise.all(userIds.map(async (userId) => {
      try {
        const profile = await this.api.getUserProfile(userId);
        const name = String(profile.name || "").trim();
        const alias = String(profile.alias || "").trim();
        profiles.set(userId, {
          displayName: name || alias || userId,
          avatar: String(profile.avatar || "").trim(),
          departments: (Array.isArray(profile.department) ? profile.department : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0),
          resolution: name ? "user_get" : alias ? "user_get_alias" : "userid_fallback",
        });
      } catch {
        profiles.set(userId, {
          displayName: userId,
          avatar: "",
          departments: [],
          resolution: "userid_fallback",
        });
      }
    }));
    const accounts = rawAccounts.map((account) => {
      const openKfid = String(account.open_kfid || "").trim();
      const servicerResult = servicerResults.find((item) => item.openKfid === openKfid);
      return {
        openKfid,
        name: String(account.name || "").trim(),
        avatar: String(account.avatar || "").trim(),
        managePrivilege: Boolean(account.manage_privilege),
        configured: openKfid === String(appConfig.wechatWorkOpenKfid || "").trim(),
        servicerError: servicerResult?.error || null,
        servicers: (servicerResult?.servicers || []).map((servicer) => {
          const userId = String(servicer.userid || "").trim();
          const profile = profiles.get(userId);
          return {
            userId,
            displayName: profile?.displayName || userId,
            avatar: profile?.avatar || "",
            departments: profile?.departments || [],
            resolution: profile?.resolution || "userid_fallback",
            status: Number.isFinite(Number(servicer.status)) ? Number(servicer.status) : null,
            statusName: customerServiceServicerStatusName(servicer.status),
          };
        }).filter((servicer) => servicer.userId),
      };
    }).filter((account) => account.openKfid);
    return {
      checkedAt: new Date().toISOString(),
      accountCount: accounts.length,
      servicerCount: new Set(accounts.flatMap((account) => account.servicers.map((item) => item.userId))).size,
      manageableAccountCount: accounts.filter((account) => account.managePrivilege).length,
      directoryAvailable: !directoryError,
      directoryError: directoryError || null,
      memberSource,
      memberSourceDetail: memberSource === "enterprise_directory"
        ? "可选成员来自企业微信通讯录可见范围。"
        : memberSource === "upgrade_service_members"
          ? "微信客服 Secret 无完整通讯录权限，可选成员已回退为企业微信升级服务专员范围。"
          : "当前只能显示已分配的接待人员；请授权可读取通讯录的自建应用后再添加其他成员。",
      partial: accounts.some((account) => Boolean(account.servicerError)) || Boolean(directoryError),
      availableMembers: directoryUsers.map((member) => {
        const profile = profiles.get(member.userId);
        return {
          userId: member.userId,
          displayName: profile?.displayName || member.userId,
          avatar: profile?.avatar || "",
          departments: profile?.departments.length ? profile.departments : member.departments,
          resolution: profile?.resolution || "userid_fallback",
        };
      }).sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")),
      accounts,
      proofBoundary: "本页数据来自企业微信官方 API；写操作成功表示企业微信接受配置变更，不等同于客户侧消息送达。",
    };
  }

  async getCustomerServiceStatistics(payload: { openKfid?: string; startDate?: string; endDate?: string }) {
    const openKfid = requiredText(payload.openKfid, "openKfid");
    const period = normalizeCustomerServiceStatisticsPeriod(payload.startDate, payload.endDate);
    const checkedAt = new Date().toISOString();
    let accountName = "";

    try {
      const accountResponse = await this.api.listCustomerServiceAccounts();
      const account = (accountResponse.account_list || []).find(
        (item) => String(item.open_kfid || "").trim() === openKfid,
      );
      if (!account) throw new BadRequestException("企业微信中不存在该客服账号，或当前应用不可见");
      accountName = String(account.name || "").trim() || "未命名客服";

      const servicerResponse = await this.api.listCustomerServiceServicers(openKfid);
      const servicers = (servicerResponse.servicer_list || [])
        .map((item) => ({
          userId: String(item.userid || "").trim(),
          status: Number.isFinite(Number(item.status)) ? Number(item.status) : null,
        }))
        .filter((item) => item.userId);

      const corporateResponse = await this.api.getCustomerServiceCorpStatistic({
        openKfid,
        startTime: period.startTime,
        endTime: period.endTime,
      });
      const servicerSummaryResponse = await this.api.getCustomerServiceServicerStatistic({
        openKfid,
        startTime: period.startTime,
        endTime: period.endTime,
      });
      const corporateDaily = normalizeCustomerServiceStatisticDays(corporateResponse.statistic_list);
      const servicerSummaryDaily = normalizeCustomerServiceStatisticDays(servicerSummaryResponse.statistic_list);
      const individualResults = [];
      const errors: Array<{ userId: string; code: string; message: string; apiErrcode: number | null }> = [];

      for (let servicerIndex = 0; servicerIndex < servicers.length; servicerIndex += 1) {
        const servicer = servicers[servicerIndex];
        let displayName = servicer.userId;
        let nameResolution: "user_get" | "user_get_alias" | "userid_fallback" = "userid_fallback";
        try {
          const profile = await this.api.getUserProfile(servicer.userId);
          const name = String(profile.name || "").trim();
          const alias = String(profile.alias || "").trim();
          displayName = name || alias || servicer.userId;
          nameResolution = name ? "user_get" : alias ? "user_get_alias" : "userid_fallback";
        } catch {
          // The statistic remains usable when the directory scope cannot resolve a display name.
        }

        try {
          const response = await this.api.getCustomerServiceServicerStatistic({
            openKfid,
            servicerUserId: servicer.userId,
            startTime: period.startTime,
            endTime: period.endTime,
          });
          const daily = normalizeCustomerServiceStatisticDays(response.statistic_list);
          individualResults.push({
            ...servicer,
            displayName,
            nameResolution,
            statusName: customerServiceServicerStatusName(servicer.status),
            daily,
            summary: summarizeCustomerServiceStatisticDays(daily),
          });
        } catch (error) {
          const state = customerServiceStatisticsErrorState(error);
          errors.push({
            userId: servicer.userId,
            code: state.code,
            message: state.message,
            apiErrcode: state.apiErrcode,
          });
          if (state.status === "rate_limited") {
            for (const skipped of servicers.slice(servicerIndex + 1)) {
              errors.push({
                userId: skipped.userId,
                code: "WECHAT_WORK_STATISTICS_SKIPPED_AFTER_RATE_LIMIT",
                message: "本轮已在首次官方限流后停止后续接待人员查询。",
                apiErrcode: null,
              });
            }
            break;
          }
        }
      }

      const partial = errors.length > 0;
      const hasData = corporateDaily.length > 0 || servicerSummaryDaily.length > 0
        || individualResults.some((item) => item.daily.length > 0);
      await this.persistence.recordWechatWorkAudit({
        action: "kf_statistics_read",
        status: partial ? "partial" : "processed",
        openKfid,
        startDate: period.startDate,
        endDate: period.endDate,
        dayCount: period.dayCount,
        servicerCount: servicers.length,
        servicerStatisticCount: individualResults.length,
        failedServicerCount: errors.length,
      });
      return {
        schema: "smart_kefu_wechat_work_statistics_v1",
        status: hasData ? "ready" : "empty",
        checkedAt,
        period,
        account: { openKfid, name: accountName },
        corporate: {
          daily: corporateDaily,
          summary: summarizeCustomerServiceStatisticDays(corporateDaily),
        },
        servicerSummary: {
          daily: servicerSummaryDaily,
          summary: summarizeCustomerServiceStatisticDays(servicerSummaryDaily),
        },
        servicers: individualResults,
        partial,
        partialReason: errors.some((item) => item.code === "WECHAT_WORK_STATISTICS_RATE_LIMITED")
          ? "rate_limited"
          : partial ? "servicer_errors" : null,
        errors,
        error: null,
        proofBoundary: "统计数据来自企业微信官方 API；本页查询成功不等同于已与企业微信管理后台完成逐项对账。跨日客户数为官方日数据累计，比例和响应时长为有值日期的简单平均。",
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const state = customerServiceStatisticsErrorState(error);
      await this.persistence.recordWechatWorkAudit({
        action: "kf_statistics_read",
        status: "failed",
        openKfid,
        startDate: period.startDate,
        endDate: period.endDate,
        apiOperation: error instanceof WechatWorkApiError ? error.operation : null,
        apiErrcode: state.apiErrcode,
        errorCode: state.code,
      });
      return {
        schema: "smart_kefu_wechat_work_statistics_v1",
        status: state.status,
        checkedAt,
        period,
        account: { openKfid, name: accountName },
        corporate: null,
        servicerSummary: null,
        servicers: [],
        partial: false,
        partialReason: null,
        errors: [],
        error: state,
        proofBoundary: "本次未取得完整官方统计数据，不得据此判断企业微信后台经营指标。",
      };
    }
  }

  async addCustomerServiceAccount(payload: {
    name?: string;
    avatarBase64?: string;
    avatarFileName?: string;
    avatarMimeType?: string;
    requestId?: string;
  }) {
    const requestId = requiredText(payload.requestId, "requestId");
    const name = normalizeCustomerServiceAccountName(payload.name);
    const mediaId = await this.uploadCustomerServiceAccountAvatar({
      base64: payload.avatarBase64,
      fileName: payload.avatarFileName,
      mimeType: payload.avatarMimeType,
      requestId,
    });
    const response = await this.api.addCustomerServiceAccount({ name, mediaId });
    const openKfid = requiredText(response.open_kfid, "open_kfid");
    await this.persistence.recordWechatWorkAudit({
      action: "kf_account_created",
      status: "processed",
      operationKey: requestId,
      openKfid,
      accountName: name,
    });
    return { ok: true, openKfid, name };
  }

  async updateCustomerServiceAccount(payload: {
    openKfid?: string;
    name?: string;
    avatarBase64?: string;
    avatarFileName?: string;
    avatarMimeType?: string;
    requestId?: string;
  }) {
    const requestId = requiredText(payload.requestId, "requestId");
    const account = await this.requireManagedCustomerServiceAccount(payload.openKfid);
    const hasAvatar = Boolean(String(payload.avatarBase64 || "").trim());
    const name = String(payload.name || "").trim();
    if (!name && !hasAvatar) throw new BadRequestException("客服名称或头像至少修改一项");
    const normalizedName = name ? normalizeCustomerServiceAccountName(name) : undefined;
    const mediaId = hasAvatar ? await this.uploadCustomerServiceAccountAvatar({
      base64: payload.avatarBase64,
      fileName: payload.avatarFileName,
      mimeType: payload.avatarMimeType,
      requestId,
    }) : undefined;
    await this.api.updateCustomerServiceAccount({
      openKfid: account.openKfid,
      name: normalizedName,
      mediaId,
    });
    await this.persistence.recordWechatWorkAudit({
      action: "kf_account_updated",
      status: "processed",
      operationKey: requestId,
      openKfid: account.openKfid,
      accountName: normalizedName || account.name,
      avatarUpdated: Boolean(mediaId),
    });
    return { ok: true, openKfid: account.openKfid, name: normalizedName || account.name };
  }

  async deleteCustomerServiceAccount(payload: { openKfid?: string; confirmName?: string; requestId?: string }) {
    const requestId = requiredText(payload.requestId, "requestId");
    const account = await this.requireManagedCustomerServiceAccount(payload.openKfid);
    if (account.openKfid === String(appConfig.wechatWorkOpenKfid || "").trim()) {
      throw new BadRequestException("当前正在使用的客服账号不能删除，请先切换固定客服账号");
    }
    if (String(payload.confirmName || "").trim() !== account.name) {
      throw new BadRequestException("请输入完整客服账号名称确认删除");
    }
    await this.api.deleteCustomerServiceAccount(account.openKfid);
    await this.persistence.recordWechatWorkAudit({
      action: "kf_account_deleted",
      status: "processed",
      operationKey: requestId,
      openKfid: account.openKfid,
      accountName: account.name,
    });
    return { ok: true, deleted: true, openKfid: account.openKfid, name: account.name };
  }

  async addCustomerServiceServicers(payload: { openKfid?: string; userIds?: string[]; requestId?: string }) {
    const requestId = requiredText(payload.requestId, "requestId");
    const account = await this.requireManagedCustomerServiceAccount(payload.openKfid);
    const userIds = normalizeCustomerServiceUserIds(payload.userIds);
    const response = await this.api.addCustomerServiceServicers({ openKfid: account.openKfid, userIds });
    const results = normalizeCustomerServiceOperationResults(response.result_list, userIds);
    await this.persistence.recordWechatWorkAudit({
      action: "kf_servicers_added",
      status: results.every((result) => result.ok) ? "processed" : "partial",
      operationKey: requestId,
      openKfid: account.openKfid,
      requestedUserIds: userIds,
      results,
    });
    return summarizeCustomerServiceOperation(account.openKfid, results);
  }

  async deleteCustomerServiceServicers(payload: { openKfid?: string; userIds?: string[]; requestId?: string }) {
    const requestId = requiredText(payload.requestId, "requestId");
    const account = await this.requireManagedCustomerServiceAccount(payload.openKfid);
    const userIds = normalizeCustomerServiceUserIds(payload.userIds);
    const current = await this.api.listCustomerServiceServicers(account.openKfid);
    const currentUserIds = uniqueTextList((current.servicer_list || []).map((servicer) => servicer.userid));
    const remaining = currentUserIds.filter((userId) => !userIds.includes(userId));
    if (!remaining.length) throw new BadRequestException("每个客服账号至少保留一名接待人员");
    const response = await this.api.deleteCustomerServiceServicers({ openKfid: account.openKfid, userIds });
    const results = normalizeCustomerServiceOperationResults(response.result_list, userIds);
    await this.persistence.recordWechatWorkAudit({
      action: "kf_servicers_deleted",
      status: results.every((result) => result.ok) ? "processed" : "partial",
      operationKey: requestId,
      openKfid: account.openKfid,
      requestedUserIds: userIds,
      results,
    });
    return summarizeCustomerServiceOperation(account.openKfid, results);
  }

  private async requireManagedCustomerServiceAccount(openKfidValue?: string) {
    const openKfid = requiredText(openKfidValue, "openKfid");
    const response = await this.api.listCustomerServiceAccounts();
    const account = (response.account_list || []).find((item) => String(item.open_kfid || "").trim() === openKfid);
    if (!account) throw new BadRequestException("企业微信中不存在该客服账号");
    if (!account.manage_privilege) throw new BadRequestException("当前应用没有该客服账号的管理权限");
    return {
      openKfid,
      name: String(account.name || "").trim(),
    };
  }

  private async uploadCustomerServiceAccountAvatar(input: {
    base64?: string;
    fileName?: string;
    mimeType?: string;
    requestId: string;
  }) {
    if (!this.assets) throw new BadRequestException("本机素材服务不可用，不能上传客服头像");
    const fileName = requiredText(input.fileName, "avatarFileName");
    const mimeType = String(input.mimeType || "").trim().toLowerCase();
    if (!/^image\/(png|jpeg)$/.test(mimeType)) throw new BadRequestException("客服头像只支持 PNG 或 JPG");
    const base64 = String(input.base64 || "").trim().replace(/^data:image\/(?:png|jpeg);base64,/i, "");
    if (!base64) throw new BadRequestException("客服头像不能为空");
    const avatarBytes = Buffer.from(base64, "base64");
    if (!avatarBytes.length || avatarBytes.length > 2 * 1024 * 1024) {
      throw new BadRequestException("客服头像必须小于 2MB");
    }
    const asset = await this.assets.upload({
      ownerType: "wechat_work_account",
      ownerId: input.requestId,
      role: "account_avatar",
      fileName,
      mimeType,
      base64,
      source: "wechat_work_account_operation",
    }) as any;
    const uploaded = await this.api.uploadImage({ filePath: requiredText(asset.localPath, "avatar localPath") });
    return requiredText(uploaded.media_id, "avatar media_id");
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
            detail: "当前凭证模式与企业微信客服不兼容。请使用已加入“应用管理 → 微信客服 → API → 可调用接口的应用”的自建应用 Secret。",
          }
        : apiError?.errcode === 95012
          ? {
              blockerCode: "CREDENTIAL_MODE_MISMATCH_95012",
              detail: "当前凭证模式与企业微信客服不兼容。请重新确认同一个自建应用已获微信客服 API 权限，并使用该应用的 Secret。",
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

  async validateCustomerServiceCredential(payload: { corpId?: string; secret?: string }) {
    const corpId = normalizeWechatWorkCorpId(payload.corpId || appConfig.wechatWorkCorpId);
    const secret = normalizeWechatWorkSecret(payload.secret);
    let response;
    try {
      response = await this.api.listCustomerServiceAccountsWithSecret(secret, corpId);
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
      detail: "自建应用 Secret 验证成功，请确认要绑定的客服账号。",
    };
  }

  async saveCustomerServiceCredential(payload: {
    corpId?: string;
    secret?: string;
    openKfid?: string;
    callbackToken?: string;
    encodingAesKey?: string;
    publicBaseUrl?: string;
    enableAutomaticReplies?: boolean;
  }) {
    const corpId = normalizeWechatWorkCorpId(payload.corpId || appConfig.wechatWorkCorpId);
    const secret = normalizeWechatWorkSecret(payload.secret);
    const callbackToken = payload.callbackToken === undefined
      ? undefined
      : normalizeWechatWorkCallbackToken(payload.callbackToken);
    const encodingAesKey = payload.encodingAesKey === undefined
      ? undefined
      : normalizeWechatWorkEncodingAesKey(payload.encodingAesKey);
    const publicBaseUrl = payload.publicBaseUrl === undefined
      ? undefined
      : normalizeWechatWorkPublicBaseUrl(payload.publicBaseUrl);
    let response;
    try {
      response = await this.api.listCustomerServiceAccountsWithSecret(secret, corpId);
    } catch (error) {
      throw customerServiceCredentialError(error);
    }
    const accounts = normalizeWechatWorkAccounts(response.account_list);
    const openKfid = requiredText(payload.openKfid, "openKfid");
    const account = accounts.find((item) => item.openKfid === openKfid);
    if (!account) throw new BadRequestException("所选客服账号不属于当前 Secret 可访问的企业微信账号");
    persistWechatWorkDesktopCredential({
      corpId,
      secret,
      openKfid,
      callbackToken,
      encodingAesKey,
      publicBaseUrl,
      enableAutomaticReplies: payload.enableAutomaticReplies,
    });
    appConfig.wechatWorkCorpId = corpId;
    appConfig.wechatWorkSecret = secret;
    appConfig.wechatWorkOpenKfid = openKfid;
    appConfig.wechatSendAdapter = "wechat_work_kf";
    appConfig.wechatWorkAutoSyncEnabled = true;
    if (callbackToken !== undefined) appConfig.wechatWorkToken = callbackToken;
    if (encodingAesKey !== undefined) appConfig.wechatWorkEncodingAesKey = encodingAesKey;
    if (publicBaseUrl !== undefined) appConfig.customerServicePublicBaseUrl = publicBaseUrl;
    if (payload.enableAutomaticReplies !== undefined) {
      appConfig.lowValueAutomationEnabled = payload.enableAutomaticReplies;
    }
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
        throw new BadRequestException("当前凭证模式与企业微信客服不兼容；请使用已加入“应用管理 → 微信客服 → API → 可调用接口的应用”的自建应用 Secret 后再生成入口");
      }
      if (error instanceof WechatWorkApiError && error.errcode === 95012) {
        throw new BadRequestException("当前凭证模式与企业微信客服不兼容；请重新确认自建应用的微信客服 API 权限和 Secret 后再生成入口");
      }
      if (error instanceof WechatWorkApiError && error.errcode === 48002) {
        await this.persistence.recordWechatWorkAudit({
          action: "customer_entry_contact_way_permission_failed",
          status: "failed",
          openKfid,
          apiName: "add_contact_way",
          apiErrcode: 48002,
          errorMessage: error.message,
        });
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
      if (error instanceof WechatWorkApiError && error.errcode === 60020) {
        throw unsafeWechatWorkIpError(error, "wechat_customer_service");
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
    const memberOptions = await this.resolveUpgradeServiceMemberOptions(memberUserIds);
    const customerContact = await this.getCustomerContactReadiness(memberUserIds);
    return {
      ready: memberUserIds.length > 0,
      deliveryReady: memberUserIds.length > 0 && customerContact.ready,
      memberUserIds,
      memberOptions,
      departmentIds,
      groupChatIds,
      customerContact,
      detail: upgradeServiceConfigDetail(memberUserIds.length, memberOptions),
    };
  }

  async getCustomerUpgradeStatus(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    memberUserId?: string;
  }) {
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const memberUserId = requiredText(payload.memberUserId, "memberUserId");
    const upgradeId = deterministicOperationId(
      "wwupgrade",
      `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:${memberUserId}`,
    );
    const record = await this.persistence.getWechatWorkCustomerUpgrade(upgradeId);
    if (!record) {
      return {
        exists: false,
        memberUserId,
        status: "not_started",
        deliveryPending: false,
        manualResendAvailable: false,
        customerDeliveryApiAccepted: false,
        customerPhoneReceiptConfirmed: false,
        customerAddedSpecialistConfirmed: false,
      };
    }
    const status = String(record.status || "unknown");
    const manualResendAvailable = Boolean(
      record.configId
      && record.qrCodeUrl
      && record.state
      && record.localPath
      && fs.existsSync(String(record.localPath)),
    );
    let qrRecoveryAvailable = false;
    if (status === "ready" && !record.sendTaskId) {
      const recommendationAuditId = deterministicOperationId(
        "wwaudit",
        `customer-upgrade:${binding.externalUserId}:${memberUserId}`,
      );
      const recommendation = await this.persistence.getWechatWorkAuditLog(recommendationAuditId);
      qrRecoveryAvailable = isAuditLockStale(
        recommendation || record,
        WECHAT_WORK_CUSTOMER_UPGRADE_RECOVERY_LEASE_MS,
      );
    }
    return {
      exists: true,
      memberUserId,
      status,
      deliveryPending: ["creating", "remote_created", "ready", "queued", "sending"].includes(status)
        && !qrRecoveryAvailable,
      qrRecoveryAvailable,
      manualResendAvailable,
      customerDeliveryApiAccepted: ["api_accepted", "half_added_pending", "identity_unverified", "added_confirmed"].includes(status),
      customerPhoneReceiptConfirmed: false,
      customerAddedSpecialistConfirmed: status === "added_confirmed",
      textStatus: record.textStatus || "pending",
      imageStatus: record.imageStatus || "pending",
      sendTaskId: record.sendTaskId || null,
      sendAttemptId: record.sendAttemptId || null,
      apiAcceptedAt: record.apiAcceptedAt || null,
      asyncFailedAt: record.asyncFailedAt || null,
      halfAddedAt: record.halfAddedAt || null,
      identityVerifiedAt: record.identityVerifiedAt || null,
      addedAt: record.addedAt || null,
      errorMessage: record.errorMessage || null,
      detail: customerUpgradeStatusDetail(status, record, manualResendAvailable),
    };
  }

  async retryPendingCustomerUpgradeQr(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    memberUserId?: string;
  }) {
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const memberUserId = requiredText(payload.memberUserId, "memberUserId");
    const upgradeId = deterministicOperationId(
      "wwupgrade",
      `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:${memberUserId}`,
    );
    let upgrade = await this.persistence.getWechatWorkCustomerUpgrade(upgradeId);
    if (!upgrade) throw new BadRequestException("当前客户没有可恢复的长期服务二维码任务");
    const existingPreDispatchTask = upgrade.sendTaskId
      ? await this.persistence.getSendTask(String(upgrade.sendTaskId))
      : null;
    const manualLockPreDispatchFailure = isCustomerUpgradeManualLockPreDispatchFailure(upgrade)
      || isManualizedCustomerUpgradePreDispatchTask(upgrade, existingPreDispatchTask);
    if (manualLockPreDispatchFailure) {
      const sendTask = existingPreDispatchTask;
      if (
        !sendTask
        || String(sendTask.status || "") !== "queued"
        || String(sendTask.wechatAccountId || "") !== identity.wechatAccountId
        || String(sendTask.conversationId || "") !== identity.conversationId
        || String(sendTask.customerId || "") !== identity.customerId
      ) {
        throw new BadRequestException("原二维码任务已变化，不能按人工发送方式安全接续");
      }
      await this.persistence.updateSendTask(sendTask.id, {
        payload: {
          ...(sendTask.payload || {}),
          source: "manual_reply",
          manualReply: true,
          queuedBy: "customer_upgrade_operator",
        },
        guardSnapshot: {
          ...(sendTask.guardSnapshot || {}),
          manualReply: true,
          queuedBy: "customer_upgrade_operator",
          recoveredFromManualLockPreDispatch: true,
        },
        errorMessage: "",
      });
      upgrade = await this.persistence.updateWechatWorkCustomerUpgrade(upgradeId, {
        status: "ready",
        errorMessage: null,
      }) || upgrade;
    }
    if (String(upgrade.status || "") === "ready") {
      const recommendationAuditId = deterministicOperationId(
        "wwaudit",
        `customer-upgrade:${binding.externalUserId}:${memberUserId}`,
      );
      const recommendation = await this.persistence.getWechatWorkAuditLog(recommendationAuditId);
      if (!manualLockPreDispatchFailure && !isAuditLockStale(
        recommendation || upgrade,
        WECHAT_WORK_CUSTOMER_UPGRADE_RECOVERY_LEASE_MS,
      )) {
        return {
          ok: true,
          recovered: false,
          recoveryDeferred: true,
          triggerMsgid: null,
          status: await this.getCustomerUpgradeStatus({ ...identity, memberUserId }),
        };
      }
      const delivery = await this.deliverMemberExternalContactQr({
        binding,
        identity,
        memberUserId,
        wording: "您好，我是您的专属服务专员。添加企业微信后，我可以继续为您提供长期服务。",
        contactWay: {
          configId: requiredText(upgrade.configId, "customerUpgrade.configId"),
          qrCodeUrl: requiredText(upgrade.qrCodeUrl, "customerUpgrade.qrCodeUrl"),
          localPath: requiredText(upgrade.localPath, "customerUpgrade.localPath"),
          state: requiredText(upgrade.state, "customerUpgrade.state"),
          reused: true,
          upgrade,
        },
        operationKey: `customer-upgrade-recovery:${crypto.randomUUID()}`,
        upgradeId,
        ...(manualLockPreDispatchFailure ? { existingManualSendTaskId: String(upgrade.sendTaskId || "") } : {}),
      });
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${upgradeId}:ready-recovery`),
        action: "customer_upgrade_qr_ready_recovered",
        status: delivery.customerDeliveryApiAccepted ? "sent" : String(delivery.deliveryStatus || "pending"),
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        memberUserId,
        sendTaskId: delivery.sendTaskId || null,
        sendAttemptId: delivery.sendAttemptId || null,
        recoveryReason: manualLockPreDispatchFailure
          ? "operator_qr_send_migrated_to_manual_reply"
          : "ready_without_send_task_after_process_interruption",
      });
      return {
        ok: true,
        recovered: Boolean(delivery.customerDeliveryApiAccepted),
        recoveryDeferred: false,
        triggerMsgid: null,
        status: await this.getCustomerUpgradeStatus({ ...identity, memberUserId }),
      };
    }
    if (
      ["api_accepted", "half_added_pending", "identity_unverified", "added_confirmed"].includes(String(upgrade.status || ""))
      && String(upgrade.imageStatus || "") === "api_accepted"
    ) {
      await this.persistence.upsertWechatWorkAudit({
        id: deterministicOperationId(
          "wwaudit",
          `customer-upgrade-qr:${binding.externalUserId}:${memberUserId}`,
        ),
        action: "customer_upgrade_qr_api_accepted",
        status: "sent",
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        memberUserId,
        configId: upgrade.configId || null,
        operationKey: deterministicOperationId("upgrade-send", upgradeId),
        sendTaskId: upgrade.sendTaskId || null,
        sendAttemptId: upgrade.sendAttemptId || null,
        msgids: uniqueTextList([upgrade.textMsgId, upgrade.imageMsgId]),
        errorMessage: null,
      });
    }
    if (!["partial", "failed", "async_failed"].includes(String(upgrade.status || ""))) {
      return {
        ok: true,
        recovered: String(upgrade.imageStatus || "") === "api_accepted",
        triggerMsgid: null,
        status: await this.getCustomerUpgradeStatus({ ...identity, memberUserId }),
      };
    }

    const recentMessage = await this.persistence.getRecentMessage(identity.conversationId);
    const triggerMsgid = String(recentMessage?.externalId || "").trim();
    if (recentMessage?.direction !== "inbound" || !triggerMsgid) {
      throw new BadRequestException("没有找到可证明新发送窗口的客户入站消息，不能重试二维码");
    }
    const inboundAt = Date.parse(String(recentMessage.createdAt || ""));
    const failedAt = Date.parse(String(upgrade.updatedAt || upgrade.createdAt || ""));
    if (!Number.isFinite(inboundAt) || (Number.isFinite(failedAt) && inboundAt <= failedAt)) {
      throw new BadRequestException("客户尚未在二维码失败后发送新消息，不能占用旧发送窗口重试");
    }

    const recovery = await this.resumePendingCustomerUpgradeQrAfterInbound({
      binding,
      msgid: triggerMsgid,
      upgradeId,
    });
    return {
      ok: true,
      recovered: Boolean(recovery?.recovered),
      triggerMsgid,
      status: await this.getCustomerUpgradeStatus({ ...identity, memberUserId }),
    };
  }

  async resendCustomerUpgradeQr(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    memberUserId?: string;
    wording?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const memberUserId = requiredText(payload.memberUserId, "memberUserId");
    const wording = String(payload.wording || "您好，我是您的专属服务专员。添加企业微信后，我可以继续为您提供长期服务。")
      .trim();
    if (!wording) throw new BadRequestException("长期服务说明不能为空");
    if (wording.length > 200) throw new BadRequestException("长期服务说明不能超过 200 个字符");
    const upgradeId = deterministicOperationId(
      "wwupgrade",
      `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:${memberUserId}`,
    );
    const upgrade = await this.persistence.getWechatWorkCustomerUpgrade(upgradeId);
    if (!upgrade) throw new BadRequestException("当前客户还没有可再次发送的专员二维码");

    const delivery = await this.deliverMemberExternalContactQr({
      binding,
      identity,
      memberUserId,
      wording,
      contactWay: {
        configId: requiredText(upgrade.configId, "customerUpgrade.configId"),
        qrCodeUrl: requiredText(upgrade.qrCodeUrl, "customerUpgrade.qrCodeUrl"),
        localPath: requiredText(upgrade.localPath, "customerUpgrade.localPath"),
        state: requiredText(upgrade.state, "customerUpgrade.state"),
        reused: true,
        upgrade,
      },
      operationKey,
      upgradeId,
      forceManualResend: true,
    });
    return {
      ok: true,
      manualResend: true,
      recommended: true,
      alreadyRecommended: true,
      memberUserId,
      conversationId: identity.conversationId,
      customerId: identity.customerId,
      ...delivery,
    };
  }

  private async resolveCustomerServiceUnionId(binding: { openKfid: string; externalUserId: string }) {
    try {
      const response = await this.api.getCustomerProfiles([binding.externalUserId]);
      const profile = (Array.isArray(response.customer_list) ? response.customer_list : [])
        .find((item) => String(item?.external_userid || "") === String(binding.externalUserId || ""));
      return String(profile?.unionid || "").trim() || null;
    } catch (error) {
      await this.recordOperationFailure("customer_upgrade_source_identity_lookup_failed", error, {
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
      });
      return null;
    }
  }

  async validateCustomerContactCredential(payload: { secret?: string }) {
    const secret = normalizeWechatWorkSecret(payload.secret);
    let followUsers: string[];
    try {
      const response = await this.api.listExternalContactFollowUsers(secret);
      followUsers = uniqueTextList(response.follow_user);
    } catch (error) {
      throw customerContactCredentialError(error);
    }
    const upgradeResponse = await this.api.getUpgradeServiceConfig();
    const configuredMembers = uniqueTextList(upgradeResponse.member_range?.userid_list);
    const eligibleMemberUserIds = configuredMembers.filter((userId) => followUsers.includes(userId));
    if (!eligibleMemberUserIds.length) {
      throw new BadRequestException("该自建应用 Secret 可以访问企业微信，但升级服务专员都不在“客户联系 → 权限配置 → 使用范围”内");
    }
    return {
      valid: true,
      configuredMemberCount: configuredMembers.length,
      eligibleMemberCount: eligibleMemberUserIds.length,
      eligibleMemberUserIds,
      detail: `客户联系权限验证成功，${eligibleMemberUserIds.length} 位升级服务专员可以生成“联系我”二维码。`,
    };
  }

  async saveCustomerContactCredential(payload: { secret?: string }) {
    const secret = normalizeWechatWorkSecret(payload.secret);
    const validated = await this.validateCustomerContactCredential({ secret });
    persistWechatWorkCustomerContactCredential(secret);
    appConfig.wechatWorkExternalContactSecret = secret;
    this.api.clearExternalContactAccessToken();
    await this.persistence.recordWechatWorkAudit({
      action: "external_contact_credential_validated",
      status: "processed",
      eligibleMemberCount: validated.eligibleMemberCount,
    });
    return {
      saved: true,
      secretConfigured: true,
      ...validated,
    };
  }

  private async getCustomerContactReadiness(memberUserIds: string[]) {
    const publicBaseUrl = String(appConfig.customerServicePublicBaseUrl || "").replace(/\/+$/, "");
    const callbackUrl = /^https:\/\//i.test(publicBaseUrl) ? `${publicBaseUrl}/api/wechat-work/callback` : "";
    const callbackLocallyReady = Boolean(
      callbackUrl
      && appConfig.wechatWorkToken
      && validEncodingAesKey(appConfig.wechatWorkEncodingAesKey),
    );
    const callback = {
      locallyReady: callbackLocallyReady,
      url: callbackUrl || null,
      detail: callbackLocallyReady
        ? "请在企业微信“客户联系 → 接收事件服务器”使用此回调地址及现有 Token/AESKey；收到添加客户事件后才会标记完成。"
        : "客户联系回调缺少公网 HTTPS 地址、Token 或 EncodingAESKey，无法确认客户真实添加专员。",
    };
    const credentialSource = appConfig.wechatWorkExternalContactSecret
      ? "external_contact_override"
      : appConfig.wechatWorkSecret
        ? "wechat_work_shared"
        : "none";
    if (credentialSource === "none") {
      return {
        configured: false,
        ready: false,
        credentialSource,
        applications: [] as Array<{ agentId: number; name: string }>,
        eligibleMemberUserIds: [] as string[],
        blockerCode: "CUSTOMER_CONTACT_SECRET_MISSING",
        detail: "尚未配置企业微信自建应用凭证。请先到“应用管理 → 应用 → 自建”创建或打开一个自建应用并查看 Secret；再把同一个应用分别加入“应用管理 → 微信客服 → API → 可调用接口的应用”和“客户联系 → 客户 → API → 可调用接口的应用”。",
        callback,
      };
    }
    try {
      const response = await this.api.listExternalContactFollowUsers();
      const followUsers = uniqueTextList(response.follow_user);
      const eligibleMemberUserIds = memberUserIds.filter((userId) => followUsers.includes(userId));
      return {
        configured: true,
        ready: eligibleMemberUserIds.length > 0,
        credentialSource,
        applications: await this.getWechatWorkApplications(),
        eligibleMemberUserIds,
        blockerCode: eligibleMemberUserIds.length ? null : "UPGRADE_MEMBERS_OUTSIDE_CUSTOMER_CONTACT_SCOPE",
        detail: eligibleMemberUserIds.length
          ? `${eligibleMemberUserIds.length} 位升级服务专员可以生成并发送“联系我”二维码。`
          : "升级服务专员均不在企业微信“客户联系 → 使用范围”内。",
        callback,
      };
    } catch (error) {
      const apiError = error instanceof WechatWorkApiError ? error : null;
      const applications = await this.getWechatWorkApplications();
      const applicationNames = applications.map((item) => item.name).filter(Boolean).join("、");
      return {
        configured: true,
        ready: false,
        credentialSource,
        applications,
        eligibleMemberUserIds: [] as string[],
        blockerCode: apiError?.errcode === 48002
          ? "CUSTOMER_CONTACT_PERMISSION_MISSING"
          : "CUSTOMER_CONTACT_API_UNAVAILABLE",
        errcode: apiError?.errcode ?? null,
        detail: apiError?.errcode === 48002 && applicationNames
          ? `已识别自建应用“${applicationNames}”，但尚未获得客户联系 API 权限。请在企业微信“客户联系 → 客户 → API → 可调用接口的应用”中添加该应用；继续使用该自建应用的同一个 Secret。`
          : customerContactCredentialError(error).message,
        callback,
      };
    }
  }

  private async getWechatWorkApplications() {
    try {
      const response = await this.api.listApplications();
      return (Array.isArray(response.agentlist) ? response.agentlist : [])
        .map((item) => ({
          agentId: Number(item?.agentid || 0),
          name: String(item?.name || "").trim(),
        }))
        .filter((item) => item.agentId > 0 && item.name);
    } catch {
      return [] as Array<{ agentId: number; name: string }>;
    }
  }

  private async resolveUpgradeServiceMemberOptions(memberUserIds: string[]): Promise<UpgradeServiceMemberOption[]> {
    const options: UpgradeServiceMemberOption[] = [];
    for (const userId of memberUserIds) {
      try {
        const profile = await this.api.getUserProfile(userId);
        const name = String(profile.name || "").trim();
        const alias = String(profile.alias || "").trim();
        if (name) {
          options.push({ userId, displayName: name, resolution: "user_get" });
        } else if (alias) {
          options.push({ userId, displayName: alias, resolution: "user_get_alias" });
        } else {
          options.push({ userId, displayName: userId, resolution: "userid_fallback" });
        }
      } catch (error) {
        options.push({
          userId,
          displayName: userId,
          resolution: "userid_fallback",
          errorCode: error instanceof WechatWorkApiError ? error.errcode ?? null : null,
        });
      }
    }
    return options;
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
    if (!config.customerContact.configured) {
      throw new BadRequestException("请先配置具备客户联系 API 权限的自建应用 Secret；微信客服 Secret 只能提交接待提示，不能生成专员“联系我”二维码");
    }
    if (!config.customerContact.eligibleMemberUserIds.includes(memberUserId)) {
      throw new BadRequestException(config.customerContact.detail || "所选专员不在企业微信“客户联系 → 使用范围”内");
    }

    const upgradeId = deterministicOperationId(
      "wwupgrade",
      `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:${memberUserId}`,
    );
    const upgradeState = `lt_${crypto.createHash("sha256").update(upgradeId).digest("hex").slice(0, 20)}`;
    const sourceUnionId = await this.resolveCustomerServiceUnionId(binding);
    // Generate a customer-specific contact way before submitting the receptionist hint.
    // Its state value lets the external-contact callback prove which upgrade was completed.
    const contactWay = await this.ensureCustomerExternalContactWay({
      upgradeId,
      state: upgradeState,
      binding,
      identity,
      memberUserId,
      claimToken: operationKey,
      sourceUnionId,
    });

    const recommendationKey = `${binding.externalUserId}:${memberUserId}`;
    const auditId = deterministicOperationId("wwaudit", `customer-upgrade:${recommendationKey}`);
    const recommendationIdentity = {
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
      customerId: identity.customerId,
      memberUserId,
      auditId,
    };
    const existing = await this.findExistingCustomerUpgradeRecommendation(recommendationIdentity);
    let recommendation = existing;
    let alreadyRecommended = Boolean(existing);
    const direct = await this.persistence.getWechatWorkAuditLog(auditId);
    if (!recommendation && isPendingCustomerUpgradeRecommendation(direct, recommendationIdentity)) {
      return {
        ok: true,
        deliveryMode: "wechat_work_external_contact_qr",
        customerDeliveryApiAccepted: false,
        customerPhoneReceiptConfirmed: false,
        recommended: true,
        alreadyRecommended: true,
        recommendationPending: true,
        memberUserId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        recommendationAuditId: auditId,
        recommendedAt: direct.createdAt || null,
        duplicateScope: "customer_member",
      };
    }
    if (!recommendation) {
      const lockPayload = {
        id: auditId,
        action: "customer_upgrade_recommended",
        status: "pending",
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        memberUserId,
        operationKey,
        recommendationKey,
        lockStartedAt: new Date().toISOString(),
      };
      const lock = direct
        ? await this.persistence.upsertWechatWorkAudit(lockPayload)
        : await this.persistence.recordWechatWorkAudit(lockPayload);
      if (String(lock?.operationKey || "") !== operationKey) {
        return {
          ok: true,
          deliveryMode: "wechat_work_external_contact_qr",
          customerDeliveryApiAccepted: false,
          customerPhoneReceiptConfirmed: false,
          recommended: true,
          alreadyRecommended: true,
          recommendationPending: true,
          memberUserId,
          conversationId: identity.conversationId,
          customerId: identity.customerId,
          recommendationAuditId: auditId,
          recommendedAt: lock?.createdAt || null,
          duplicateScope: "customer_member",
        };
      }

      try {
        await this.api.upgradeCustomerToMember({
          openKfid: binding.openKfid,
          externalUserId: binding.externalUserId,
          memberUserId,
          wording,
        });
        recommendation = await this.persistence.upsertWechatWorkAudit({
          ...lockPayload,
          status: "processed",
        });
      } catch (error) {
        await this.persistence.upsertWechatWorkAudit({
          ...lockPayload,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
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

    const delivery = await this.deliverMemberExternalContactQr({
      binding,
      identity,
      memberUserId,
      wording,
      contactWay,
      operationKey,
      upgradeId,
    });
    return {
      ok: true,
      recommended: true,
      alreadyRecommended,
      memberUserId,
      conversationId: identity.conversationId,
      customerId: identity.customerId,
      recommendationAuditId: recommendation?.id || auditId,
      recommendedAt: recommendation?.createdAt || null,
      ...(alreadyRecommended ? { duplicateScope: "customer_member" as const } : {}),
      ...delivery,
    };
  }

  private ensureCustomerExternalContactWay(input: {
    upgradeId: string;
    state: string;
    binding: any;
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
    memberUserId: string;
    claimToken: string;
    sourceUnionId: string | null;
  }) {
    const existing = this.customerUpgradeContactWayInFlight.get(input.upgradeId);
    if (existing) return existing;
    const pending = this.ensureCustomerExternalContactWayInternal(input)
      .finally(() => {
        if (this.customerUpgradeContactWayInFlight.get(input.upgradeId) === pending) {
          this.customerUpgradeContactWayInFlight.delete(input.upgradeId);
        }
      });
    this.customerUpgradeContactWayInFlight.set(input.upgradeId, pending);
    return pending;
  }

  private async ensureCustomerExternalContactWayInternal(input: {
    upgradeId: string;
    state: string;
    binding: any;
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
    memberUserId: string;
    claimToken: string;
    sourceUnionId: string | null;
  }) {
    let stored = await this.persistence.getWechatWorkCustomerUpgrade(input.upgradeId);
    if (stored && input.sourceUnionId && !stored.sourceUnionId) {
      stored = await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
        sourceUnionId: input.sourceUnionId,
      }) || stored;
    }
    if (stored?.configId && stored?.qrCodeUrl) {
      try {
        const localPath = stored.localPath && fs.existsSync(String(stored.localPath))
          ? resolveWechatWorkImageFile(String(stored.localPath)).filePath
          : await this.downloadExternalContactQrCode(String(stored.qrCodeUrl), String(stored.configId));
        const updated = await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
          status: ["creating", "remote_created", "resource_failed"].includes(String(stored.status || ""))
            ? "ready"
            : stored.status,
          localPath,
          errorMessage: null,
          claimToken: null,
          claimExpiresAt: null,
        });
        return {
          configId: String(stored.configId),
          qrCodeUrl: String(stored.qrCodeUrl),
          localPath,
          state: String(stored.state),
          reused: true,
          upgrade: updated || stored,
        };
      } catch (downloadError) {
        try {
          const refreshed = await this.api.getExternalContactWay(String(stored.configId));
          const qrCodeUrl = normalizeExternalContactQrCodeUrl(refreshed.contact_way?.qr_code);
          const localPath = await this.downloadExternalContactQrCode(qrCodeUrl, String(stored.configId));
          const updated = await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
            status: ["creating", "remote_created", "resource_failed"].includes(String(stored.status || ""))
              ? "ready"
              : stored.status,
            qrCodeUrl,
            localPath,
            errorMessage: null,
            claimToken: null,
            claimExpiresAt: null,
          });
          return {
            configId: String(stored.configId),
            qrCodeUrl,
            localPath,
            state: String(stored.state),
            reused: true,
            upgrade: updated || stored,
          };
        } catch {
          await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
            status: "resource_failed",
            errorMessage: downloadError instanceof Error ? downloadError.message : String(downloadError),
          });
          throw downloadError;
        }
      }
    }

    const claimed = await this.persistence.claimWechatWorkCustomerUpgrade({
      id: input.upgradeId,
      corpId: requiredText(appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID"),
      openKfid: input.binding.openKfid,
      externalUserId: input.binding.externalUserId,
      wechatAccountId: input.identity.wechatAccountId,
      conversationId: input.identity.conversationId,
      customerId: input.identity.customerId,
      memberUserId: input.memberUserId,
      state: input.state,
      sourceUnionId: input.sourceUnionId,
      claimToken: input.claimToken,
    });
    if (claimed.mode === "in_progress") {
      throw new BadRequestException("该客户的专员二维码正在生成，系统已阻止重复创建，请稍后刷新");
    }

    try {
      const response = await this.api.createExternalContactWay({
        memberUserId: input.memberUserId,
        remark: "智能客服长期服务",
        state: input.state,
      });
      const configId = requiredText(response.config_id, "external contact config_id");
      const qrCodeUrl = normalizeExternalContactQrCodeUrl(response.qr_code);
      const remoteCreated = await this.persistence.updateWechatWorkCustomerUpgrade(
        input.upgradeId,
        {
          status: "remote_created",
          configId,
          qrCodeUrl,
          errorMessage: null,
        },
        { claimToken: input.claimToken },
      );
      if (!remoteCreated) {
        await this.recordOperationFailure("external_contact_way_orphaned", new Error("customer upgrade claim was lost after remote creation"), {
          memberUserId: input.memberUserId,
          configId,
          state: input.state,
        });
        throw new BadRequestException("专员二维码已在企业微信创建，但本地持久化抢占已失效；系统已记录孤儿配置，禁止再次创建");
      }
      const localPath = await this.downloadExternalContactQrCode(qrCodeUrl, configId);
      const ready = await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
        status: "ready",
        localPath,
        errorMessage: null,
        claimToken: null,
        claimExpiresAt: null,
      });
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${input.upgradeId}:contact-way-created`),
        action: "external_contact_way_created",
        status: "processed",
        openKfid: input.binding.openKfid,
        externalUserId: input.binding.externalUserId,
        conversationId: input.identity.conversationId,
        customerId: input.identity.customerId,
        memberUserId: input.memberUserId,
        configId,
        state: input.state,
      });
      return { configId, qrCodeUrl, localPath, state: input.state, reused: false, upgrade: ready || remoteCreated };
    } catch (error) {
      await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
        status: "resource_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        claimToken: null,
        claimExpiresAt: null,
      });
      await this.recordOperationFailure("external_contact_way_create_failed", error, {
        memberUserId: input.memberUserId,
        state: input.state,
      });
      throw customerContactCredentialError(error);
    }
  }

  private async downloadExternalContactQrCode(qrCodeUrl: string, configId: string) {
    const normalizedUrl = normalizeExternalContactQrCodeUrl(qrCodeUrl);
    const directory = path.join(appConfig.localStorageRoot, "wechat-work", "external-contact-qr");
    fs.mkdirSync(directory, { recursive: true });
    assertPathInsideStorageRoot(directory, appConfig.localStorageRoot);
    const digest = crypto.createHash("sha256").update(`${configId}:${normalizedUrl}`).digest("hex").slice(0, 32);
    const outputPath = path.join(directory, `${digest}.png`);
    if (fs.existsSync(outputPath)) {
      resolveWechatWorkImageFile(outputPath);
      return outputPath;
    }
    const downloaded = await this.api.downloadExternalContactQrCode(normalizedUrl);
    const sourceBytes = downloaded.bytes;
    const png = await sharp(sourceBytes, { failOn: "warning", limitInputPixels: 16_000_000 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (png.length > 2 * 1024 * 1024) throw new BadRequestException("企业微信专员二维码图片超过 2 MB，不能通过微信客服发送");
    const temporaryPath = `${outputPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, png, { flag: "wx", mode: 0o600 });
      fs.renameSync(temporaryPath, outputPath);
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    }
    resolveWechatWorkImageFile(outputPath);
    return outputPath;
  }

  private async deliverMemberExternalContactQr(input: {
    binding: any;
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
    memberUserId: string;
    wording: string;
    contactWay: { configId: string; qrCodeUrl: string; localPath: string; state: string; reused: boolean; upgrade?: any };
    operationKey: string;
    upgradeId: string;
    existingManualSendTaskId?: string;
    forceManualResend?: boolean;
  }) {
    const deliveryAuditId = deterministicOperationId(
      "wwaudit",
      input.forceManualResend
        ? `${input.upgradeId}:manual-resend:${input.operationKey}`
        : `customer-upgrade-qr:${input.binding.externalUserId}:${input.memberUserId}`,
    );
    const upgrade = await this.persistence.getWechatWorkCustomerUpgrade(input.upgradeId);
    if (!input.forceManualResend && ["api_accepted", "half_added_pending", "identity_unverified", "added_confirmed"].includes(String(upgrade?.status || ""))) {
      return {
        deliveryMode: "wechat_work_external_contact_qr",
        customerDeliveryApiAccepted: true,
        customerPhoneReceiptConfirmed: false,
        customerAddedSpecialistConfirmed: upgrade?.status === "added_confirmed",
        alreadyDelivered: true,
        deliveryPending: false,
        deliveryStatus: upgrade?.status,
        sendTaskId: upgrade?.sendTaskId || null,
        sendAttemptId: upgrade?.sendAttemptId || null,
        msgids: uniqueTextList([upgrade?.textMsgId, upgrade?.imageMsgId]),
        contactWayConfigId: input.contactWay.configId,
        deliveryNote: upgrade?.status === "added_confirmed"
          ? "企业微信客户联系回调与 unionid 已共同确认原客户添加了所选专员；客服消息在客户手机是否显示仍需客户侧确认。"
          : upgrade?.status === "half_added_pending"
            ? "客户已发起添加，但所选专员尚未确认；系统不会重复发送二维码。"
            : upgrade?.status === "identity_unverified"
              ? "收到添加回调，但新增联系人身份无法与原客服客户匹配，已转人工核验且不会重复发送。"
              : "专员二维码此前已被企业微信客服发送接口受理；客户手机实际显示仍需客户侧确认。",
      };
    }
    if (!input.forceManualResend && ["queued", "sending"].includes(String(upgrade?.status || ""))) {
      return {
        deliveryMode: "wechat_work_external_contact_qr",
        customerDeliveryApiAccepted: false,
        customerPhoneReceiptConfirmed: false,
        alreadyDelivered: false,
        deliveryPending: true,
        deliveryStatus: upgrade?.status,
        sendTaskId: upgrade?.sendTaskId || null,
        sendAttemptId: null,
        msgids: [],
        contactWayConfigId: input.contactWay.configId,
        deliveryNote: "专员二维码正在发送，系统不会重复提交。",
      };
    }
    if (!input.forceManualResend && ["partial", "async_failed", "failed"].includes(String(upgrade?.status || ""))) {
      const deliveryStatus = String(upgrade?.status || "failed");
      return {
        deliveryMode: "wechat_work_external_contact_qr",
        customerDeliveryApiAccepted: false,
        customerPhoneReceiptConfirmed: false,
        customerAddedSpecialistConfirmed: false,
        alreadyDelivered: false,
        deliveryPending: false,
        deliveryStatus,
        textStatus: upgrade?.textStatus || null,
        imageStatus: upgrade?.imageStatus || null,
        sendTaskId: upgrade?.sendTaskId || null,
        sendAttemptId: upgrade?.sendAttemptId || null,
        msgids: uniqueTextList([upgrade?.textMsgId, upgrade?.imageMsgId]),
        contactWayConfigId: input.contactWay.configId,
        deliveryNote: deliveryStatus === "partial"
          ? "发送发生部分成功，系统已锁定已受理消息，不会重复发送；请在原发送任务中处理失败部分。"
          : deliveryStatus === "async_failed"
            ? "企业微信异步回执报告发送失败，系统已锁定原任务，不会重复发送；请在原发送任务中处理。"
            : "原发送任务失败，系统已锁定该任务以避免重复触达；请在发送任务中检查失败原因。",
      };
    }

    await this.assertCustomerUpgradeQrSessionSendable({
      binding: input.binding,
      identity: input.identity,
      memberUserId: input.memberUserId,
    });

    const sendOperationKey = input.forceManualResend
      ? deterministicOperationId("upgrade-resend", `${input.upgradeId}:${input.operationKey}`)
      : deterministicOperationId("upgrade-send", input.upgradeId);
    await this.persistence.upsertWechatWorkAudit({
      id: deliveryAuditId,
      action: input.forceManualResend ? "customer_upgrade_qr_manual_resend" : "customer_upgrade_qr_delivery",
      status: "pending",
      openKfid: input.binding.openKfid,
      externalUserId: input.binding.externalUserId,
      wechatAccountId: input.identity.wechatAccountId,
      conversationId: input.identity.conversationId,
      customerId: input.identity.customerId,
      memberUserId: input.memberUserId,
      configId: input.contactWay.configId,
      operationKey: sendOperationKey,
    });
    try {
      const queued = input.existingManualSendTaskId
        ? { task: await this.requireCustomerUpgradeManualSendTask(input.existingManualSendTaskId, input.identity) }
        : await this.queueCustomerServiceMessage({
            openKfid: input.binding.openKfid,
            externalUserId: input.binding.externalUserId,
            requestId: sendOperationKey,
            manualReply: true,
            queuedBy: "customer_upgrade_operator",
            messages: [
              { msgtype: "image", mediaPath: input.contactWay.localPath },
              { msgtype: "text", text: { content: `${input.wording}\n请长按识别上方二维码添加专员企业微信。` } },
            ],
          });
      if (input.forceManualResend && !input.existingManualSendTaskId) {
        await this.cancelSupersededQueuedCustomerUpgradeTask({
          previousSendTaskId: String(upgrade?.sendTaskId || ""),
          replacementSendTaskId: queued.task.id,
          identity: input.identity,
        });
      }
      await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
        status: "queued",
        sendTaskId: queued.task.id,
        textStatus: "queued",
        imageStatus: "queued",
        errorMessage: null,
      });
      const dispatched = await this.dispatchCustomerServiceText(queued.task.id, { manualPriority: true });
      const status = String(dispatched?.task?.status || "");
      const metadata = dispatched?.attempt?.metadata || {};
      const messageState = resolveCustomerUpgradeMessageState(metadata, status);
      const deliveryStatus = messageState.imageStatus === "api_accepted"
        ? "api_accepted"
        : messageState.acceptedMsgids.length
          ? "partial"
          : ["queued", "sending"].includes(status)
            ? status
            : "failed";
      const msgids = uniqueTextList([messageState.textMsgId, messageState.imageMsgId]);
      const updated = await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
        status: deliveryStatus,
        sendTaskId: dispatched?.task?.id || queued.task.id,
        sendAttemptId: dispatched?.attempt?.id || null,
        textStatus: messageState.textStatus,
        imageStatus: messageState.imageStatus,
        textMsgId: messageState.textMsgId,
        imageMsgId: messageState.imageMsgId,
        apiAcceptedAt: deliveryStatus === "api_accepted" ? new Date().toISOString() : null,
        errorMessage: ["queued", "sending"].includes(deliveryStatus)
          || deliveryStatus === "api_accepted" && messageState.textStatus === "api_accepted"
          ? null
          : dispatched?.task?.errorMessage || `task status: ${status || "unknown"}`,
      });
      await this.persistence.upsertWechatWorkAudit({
        id: deliveryAuditId,
        action: deliveryStatus === "api_accepted"
          ? input.forceManualResend ? "customer_upgrade_qr_manual_resend_api_accepted" : "customer_upgrade_qr_api_accepted"
          : ["queued", "sending"].includes(deliveryStatus)
            ? input.forceManualResend ? "customer_upgrade_qr_manual_resend_queued" : "customer_upgrade_qr_delivery_queued"
            : input.forceManualResend ? "customer_upgrade_qr_manual_resend_incomplete" : "customer_upgrade_qr_delivery_incomplete",
        status: deliveryStatus === "api_accepted" ? "sent" : deliveryStatus,
        openKfid: input.binding.openKfid,
        externalUserId: input.binding.externalUserId,
        wechatAccountId: input.identity.wechatAccountId,
        conversationId: input.identity.conversationId,
        customerId: input.identity.customerId,
        memberUserId: input.memberUserId,
        configId: input.contactWay.configId,
        operationKey: sendOperationKey,
        sendTaskId: dispatched?.task?.id || queued.task.id,
        sendAttemptId: dispatched?.attempt?.id || null,
        msgids,
        errorMessage: null,
      });
      if (
        input.forceManualResend
        &&
        deliveryStatus === "failed"
        && isCustomerUpgradeSendQuotaExhausted(dispatched?.task?.errorMessage)
      ) {
        throw new BadRequestException(customerUpgradeSendQuotaExhaustedMessage());
      }
      return {
        deliveryMode: "wechat_work_external_contact_qr",
        customerDeliveryApiAccepted: deliveryStatus === "api_accepted",
        customerPhoneReceiptConfirmed: false,
        customerAddedSpecialistConfirmed: false,
        alreadyDelivered: false,
        deliveryPending: ["queued", "sending"].includes(deliveryStatus),
        deliveryStatus,
        textStatus: updated?.textStatus || messageState.textStatus,
        imageStatus: updated?.imageStatus || messageState.imageStatus,
        sendTaskId: dispatched?.task?.id || queued.task.id,
        sendAttemptId: dispatched?.attempt?.id || null,
        msgids,
        contactWayConfigId: input.contactWay.configId,
        deliveryNote: deliveryStatus === "api_accepted"
          ? messageState.textStatus === "api_accepted"
            ? input.forceManualResend
              ? "企业微信客服接口已再次受理专员二维码和说明文字；如需继续发送，可再次人工点击。客户手机实际显示仍需客户侧确认。"
              : "企业微信客服接口已受理专员二维码和说明文字；客户手机实际显示仍需客户侧确认。"
            : input.forceManualResend
              ? "企业微信客服接口已再次受理专员二维码；说明文字受企业微信会话条数限制未发送，仍可再次人工点击。"
              : "企业微信客服接口已受理专员二维码；说明文字受会话条数限制未发送，但系统不会重复发送二维码。"
          : deliveryStatus === "partial"
            ? input.forceManualResend
              ? "本次人工发送只有部分消息被企业微信受理；可检查发送任务，也可再次人工点击发送二维码。"
              : "发送发生部分成功，系统已锁定已受理消息，不会重复发送；请在发送任务中处理失败部分。"
            : input.forceManualResend
              ? "本次人工发送尚未被企业微信完整受理；可检查发送任务，也可再次人工点击。"
              : "专员二维码发送任务尚未被企业微信完整受理，系统不会用重复点击创建新任务。",
      };
    } catch (error) {
      const deliveryError = customerUpgradeDeliveryError(error);
      const deliveryErrorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      const current = await this.persistence.getWechatWorkCustomerUpgrade(input.upgradeId);
      await this.persistence.updateWechatWorkCustomerUpgrade(input.upgradeId, {
        status: current?.textMsgId || current?.imageMsgId ? "partial" : "failed",
        errorMessage: deliveryErrorMessage,
      });
      await this.persistence.upsertWechatWorkAudit({
        id: deliveryAuditId,
        action: input.forceManualResend ? "customer_upgrade_qr_manual_resend_failed" : "customer_upgrade_qr_send_failed",
        status: "failed",
        openKfid: input.binding.openKfid,
        externalUserId: input.binding.externalUserId,
        wechatAccountId: input.identity.wechatAccountId,
        conversationId: input.identity.conversationId,
        customerId: input.identity.customerId,
        memberUserId: input.memberUserId,
        configId: input.contactWay.configId,
        operationKey: sendOperationKey,
        errorMessage: deliveryErrorMessage,
      });
      throw deliveryError;
    }
  }

  private async assertCustomerUpgradeQrSessionSendable(input: {
    binding: { openKfid: string; externalUserId: string; lastInboundAt?: unknown };
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
    memberUserId: string;
  }) {
    const sendTasks = await this.persistence.listSendTasks(input.identity);
    const lastInboundAt = Date.parse(String(input.binding.lastInboundAt || ""));
    const quotaExhaustedTask = sendTasks.find((task: any) => {
      if (!isCustomerUpgradeSendQuotaExhausted(task?.errorMessage)) return false;
      if (!Number.isFinite(lastInboundAt)) return true;
      const failedAt = Date.parse(String(task?.updatedAt || task?.createdAt || ""));
      return !Number.isFinite(failedAt) || failedAt >= lastInboundAt;
    });
    if (quotaExhaustedTask) {
      throw new BadRequestException(customerUpgradeSendQuotaExhaustedMessage());
    }

    let state: { service_state?: number };
    try {
      state = await this.api.getServiceState({
        openKfid: input.binding.openKfid,
        externalUserId: input.binding.externalUserId,
      });
    } catch (error) {
      await this.recordOperationFailure("customer_upgrade_qr_service_state_check_failed", error, {
        openKfid: input.binding.openKfid,
        externalUserId: input.binding.externalUserId,
        wechatAccountId: input.identity.wechatAccountId,
        conversationId: input.identity.conversationId,
        customerId: input.identity.customerId,
        memberUserId: input.memberUserId,
      });
      return;
    }
    if (Number(state.service_state) === 4) {
      throw new BadRequestException(customerUpgradeSessionEndedMessage());
    }
  }

  private async cancelSupersededQueuedCustomerUpgradeTask(input: {
    previousSendTaskId: string;
    replacementSendTaskId: string;
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
  }) {
    if (!input.previousSendTaskId || input.previousSendTaskId === input.replacementSendTaskId) return;
    const previousTask = await this.persistence.getSendTask(input.previousSendTaskId);
    const isSameCustomerUpgradeQr = previousTask
      && String(previousTask.status || "") === "queued"
      && String(previousTask.wechatAccountId || "") === input.identity.wechatAccountId
      && String(previousTask.conversationId || "") === input.identity.conversationId
      && String(previousTask.customerId || "") === input.identity.customerId
      && String(previousTask.payload?.kind || "") === "wechat_work_messages"
      && Array.isArray(previousTask.payload?.messages)
      && previousTask.payload.messages.some((message: any) => String(message?.msgtype || "") === "image");
    if (!isSameCustomerUpgradeQr) return;
    try {
      await this.wechat.cancelSendTask(previousTask.id, {
        expectedWechatAccountId: input.identity.wechatAccountId,
        expectedConversationId: input.identity.conversationId,
        expectedCustomerId: input.identity.customerId,
        reason: "专员二维码已由人工重新发送，取消旧的待发送二维码任务以避免重复触达。",
      });
      await this.persistence.recordWechatWorkAudit({
        action: "customer_upgrade_qr_queued_task_superseded",
        status: "cancelled",
        wechatAccountId: input.identity.wechatAccountId,
        conversationId: input.identity.conversationId,
        customerId: input.identity.customerId,
        sendTaskId: previousTask.id,
        replacementSendTaskId: input.replacementSendTaskId,
      });
    } catch (error) {
      await this.recordOperationFailure("customer_upgrade_qr_queued_task_cancel_failed", error, {
        previousSendTaskId: previousTask.id,
        replacementSendTaskId: input.replacementSendTaskId,
        ...input.identity,
      });
    }
  }

  private async requireCustomerUpgradeManualSendTask(
    sendTaskId: string,
    identity: { wechatAccountId: string; conversationId: string; customerId: string },
  ) {
    const task = await this.persistence.getSendTask(requiredText(sendTaskId, "sendTaskId"));
    if (
      !task
      || String(task.status || "") !== "queued"
      || String(task.wechatAccountId || "") !== identity.wechatAccountId
      || String(task.conversationId || "") !== identity.conversationId
      || String(task.customerId || "") !== identity.customerId
      || task.payload?.source !== "manual_reply"
      || task.payload?.manualReply !== true
      || task.guardSnapshot?.manualReply !== true
    ) {
      throw new BadRequestException("原二维码任务不是可安全执行的人工发送任务");
    }
    return task;
  }

  private async resumePendingCustomerUpgradeQrAfterInbound(input: {
    binding: any;
    msgid: string;
    upgradeId?: string;
  }) {
    const upgrade = input.upgradeId
      ? await this.persistence.getWechatWorkCustomerUpgrade(input.upgradeId)
      : await this.persistence.findPendingWechatWorkCustomerUpgrade(
          String(input.binding.openKfid || ""),
          String(input.binding.externalUserId || ""),
        );
    if (
      upgrade
      && (
        String(upgrade.openKfid || "") !== String(input.binding.openKfid || "")
        || String(upgrade.externalUserId || "") !== String(input.binding.externalUserId || "")
        || !["partial", "failed", "async_failed"].includes(String(upgrade.status || ""))
      )
    ) {
      return null;
    }
    if (!upgrade?.localPath || String(upgrade.imageStatus || "") === "api_accepted") return null;

    const recoveryOperationKey = deterministicOperationId(
      "upgrade-recover",
      upgrade.id,
    );
    let recoverySendTaskId = "";
    try {
      const queued = await this.queueCustomerServiceMessage({
        openKfid: upgrade.openKfid,
        externalUserId: upgrade.externalUserId,
        requestId: recoveryOperationKey,
        messages: [{
          msgtype: "image",
          mediaPath: resolveWechatWorkImageFile(String(upgrade.localPath)).filePath,
        }],
      });
      recoverySendTaskId = String(queued.task?.id || "");
      const recoveryTask = String(queued.task?.status || "") === "failed"
        ? await this.requeueKnownFailedCustomerUpgradeQrTask(queued.task, upgrade, input.msgid)
        : queued.task;
      const dispatched = await this.dispatchCustomerServiceText(recoveryTask.id);
      const taskStatus = String(dispatched?.task?.status || "");
      const metadata = dispatched?.attempt?.metadata || {};
      const messageState = resolveCustomerUpgradeMessageState(metadata, taskStatus);
      const imageAccepted = messageState.imageStatus === "api_accepted";
      const deliveryPending = dispatched?.deferred === true || ["queued", "sending"].includes(taskStatus);
      const updated = await this.persistence.updateWechatWorkCustomerUpgrade(upgrade.id, {
        status: imageAccepted
          ? "api_accepted"
          : deliveryPending
            ? taskStatus || "queued"
            : String(upgrade.textStatus || "") === "api_accepted" ? "partial" : "failed",
        sendTaskId: dispatched?.task?.id || queued.task.id,
        sendAttemptId: dispatched?.attempt?.id || null,
        imageStatus: deliveryPending ? "queued" : messageState.imageStatus,
        imageMsgId: messageState.imageMsgId,
        apiAcceptedAt: imageAccepted ? new Date().toISOString() : upgrade.apiAcceptedAt || null,
        errorMessage: imageAccepted || deliveryPending
          ? null
          : dispatched?.task?.errorMessage || `task status: ${taskStatus || "unknown"}`,
      });
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${upgrade.id}:qr-recovery:${input.msgid}`),
        action: imageAccepted
          ? "customer_upgrade_qr_recovered"
          : deliveryPending ? "customer_upgrade_qr_recovery_queued" : "customer_upgrade_qr_recovery_failed",
        status: imageAccepted ? "sent" : deliveryPending ? "queued" : "failed",
        msgid: input.msgid,
        openKfid: upgrade.openKfid,
        externalUserId: upgrade.externalUserId,
        wechatAccountId: upgrade.wechatAccountId,
        conversationId: upgrade.conversationId,
        customerId: upgrade.customerId,
        memberUserId: upgrade.memberUserId,
        configId: upgrade.configId,
        sendTaskId: dispatched?.task?.id || queued.task.id,
        sendAttemptId: dispatched?.attempt?.id || null,
        imageMsgId: messageState.imageMsgId,
        operationKey: recoveryOperationKey,
        errorMessage: imageAccepted || deliveryPending ? null : dispatched?.task?.errorMessage || null,
      });
      return {
        handled: imageAccepted || deliveryPending,
        recovered: imageAccepted,
        pending: deliveryPending,
        upgrade: updated,
      };
    } catch (error) {
      const pendingTask = recoverySendTaskId
        ? await this.persistence.getSendTask(recoverySendTaskId)
        : null;
      if (["queued", "sending"].includes(String(pendingTask?.status || ""))) {
        const updated = await this.persistence.updateWechatWorkCustomerUpgrade(upgrade.id, {
          status: String(pendingTask.status),
          sendTaskId: pendingTask.id,
          imageStatus: "queued",
          errorMessage: null,
        });
        await this.persistence.recordWechatWorkAudit({
          action: "customer_upgrade_qr_recovery_queued_after_dispatch_race",
          status: String(pendingTask.status),
          msgid: input.msgid,
          openKfid: upgrade.openKfid,
          externalUserId: upgrade.externalUserId,
          wechatAccountId: upgrade.wechatAccountId,
          conversationId: upgrade.conversationId,
          customerId: upgrade.customerId,
          memberUserId: upgrade.memberUserId,
          sendTaskId: pendingTask.id,
          operationKey: recoveryOperationKey,
        });
        return { handled: true, recovered: false, pending: true, upgrade: updated };
      }
      await this.recordOperationFailure("customer_upgrade_qr_recovery_failed", error, {
        upgradeId: upgrade.id,
        triggerMsgid: input.msgid,
        openKfid: upgrade.openKfid,
        externalUserId: upgrade.externalUserId,
        conversationId: upgrade.conversationId,
        customerId: upgrade.customerId,
        memberUserId: upgrade.memberUserId,
      });
      return { recovered: false, errorMessage: error instanceof Error ? error.message : String(error) };
    }
  }

  private async requeueKnownFailedCustomerUpgradeQrTask(task: any, upgrade: any, triggerMsgid: string) {
    const attempt = await this.persistence.getLatestSendAttempt(task.id);
    const taskDeliveryState = String(task?.guardSnapshot?.deliveryState || task?.guardSnapshot?.wechatWorkDeliveryState || "");
    const attemptDeliveryState = String(attempt?.metadata?.deliveryState || "");
    const acceptedMessageIds = uniqueTextList([
      ...(Array.isArray(attempt?.metadata?.acceptedMessageIds) ? attempt.metadata.acceptedMessageIds : []),
      ...(Array.isArray(attempt?.metadata?.apiMsgIds) ? attempt.metadata.apiMsgIds : []),
      attempt?.metadata?.apiMsgId,
    ]);
    if (
      String(task?.status || "") !== "failed"
      || String(attempt?.status || "") !== "failed"
      || taskDeliveryState !== "failed"
      || attemptDeliveryState !== "failed"
      || acceptedMessageIds.length > 0
    ) {
      throw new BadRequestException("专员二维码发送结果未被证明为失败，不能自动重新排队。请先人工核查发送回执。");
    }
    const requeuedAt = new Date().toISOString();
    const requeued = await this.persistence.updateSendTaskWithLinkedTransition({
      taskId: task.id,
      expectedTaskStatus: "failed",
      taskPatch: {
        status: "queued",
        queuedAt: requeuedAt,
        sentAt: null,
        errorMessage: "",
        guardSnapshot: {
          ...(isPlainObject(task.guardSnapshot) ? task.guardSnapshot : {}),
          status: "pending",
          deliveryState: "not_started",
          automaticRetryBlocked: false,
          manualReviewRequired: false,
          customerUpgradeQrRequeuedAt: requeuedAt,
          customerUpgradeQrTriggerMsgid: triggerMsgid,
        },
      },
    });
    if (!requeued) throw new BadRequestException("专员二维码恢复任务状态已变化，未重复排队。");
    await this.persistence.recordWechatWorkAudit({
      action: "customer_upgrade_qr_recovery_requeued",
      status: "queued",
      msgid: triggerMsgid,
      openKfid: upgrade.openKfid,
      externalUserId: upgrade.externalUserId,
      wechatAccountId: upgrade.wechatAccountId,
      conversationId: upgrade.conversationId,
      customerId: upgrade.customerId,
      memberUserId: upgrade.memberUserId,
      sendTaskId: task.id,
      previousSendAttemptId: attempt.id,
    });
    return requeued;
  }

  private async findExistingCustomerUpgradeRecommendation(input: {
    openKfid: string;
    externalUserId: string;
    customerId: string;
    memberUserId: string;
    auditId: string;
  }) {
    const direct = await this.persistence.getWechatWorkAuditLog(input.auditId);
    if (isProcessedCustomerUpgradeRecommendation(direct, input)) return direct;
    return (await this.persistence.listWechatWorkAuditLogs(500))
      .find((record: any) => isProcessedCustomerUpgradeRecommendation(record, input)) || null;
  }

  async cancelCustomerUpgradeService(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    try {
      await this.api.cancelCustomerUpgrade({
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
      });
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${operationKey}:customer-upgrade-cancelled`),
        action: "customer_upgrade_cancelled",
        status: "processed",
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        operationKey,
      });
      return {
        ok: true,
        cancelled: true,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        customerVisibleDelivery: false,
        deliveryNote: "已调用企业微信取消升级服务推荐；这不会向客户发送或撤回二维码，只会取消接待人员侧升级提示。",
      };
    } catch (error) {
      await this.recordOperationFailure("customer_upgrade_cancel_failed", error, {
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
      });
      throw error;
    }
  }

  async getCustomerServiceState(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const state = await this.api.getServiceState({
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
    });
    const eventCredential = await this.createEventReplyCredentialFromCode({
      code: state.msg_code,
      codeKind: "msg_code",
      source: "service_state_get",
      sourceMsgid: null,
      eventType: "service_state",
      serviceState: state.service_state,
      binding,
    });
    await this.persistence.recordWechatWorkAudit({
      action: "service_state_checked",
      status: "processed",
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
      wechatAccountId: identity.wechatAccountId,
      conversationId: identity.conversationId,
      customerId: identity.customerId,
      serviceState: Number(state.service_state ?? 0),
      servicerUserId: state.servicer_userid || state.service_userid || null,
      eventCredentialId: eventCredential?.id || null,
      eventCodeHash: eventCredential?.eventCodeHash || null,
    });
    return normalizeServiceStateResponse(state, undefined, eventCredential);
  }

  async transferCustomerServiceState(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    serviceState?: number;
    servicerUserId?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const serviceState = normalizeCustomerServiceState(payload.serviceState);
    const servicerUserId = String(payload.servicerUserId || "").trim();
    if (serviceState === 3 && !servicerUserId) {
      throw new BadRequestException("转为人工接待时必须提供 servicerUserId");
    }
    const state = await this.api.transferServiceState({
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
      serviceState,
      ...(servicerUserId ? { servicerUserId } : {}),
    });
    const eventCredential = await this.createEventReplyCredentialFromCode({
      code: state.msg_code,
      codeKind: "msg_code",
      source: "service_state_trans",
      sourceMsgid: null,
      eventType: "service_state",
      serviceState: state.service_state ?? serviceState,
      operationKey,
      binding,
    });
    await this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wwaudit", `${operationKey}:service-state-trans`),
      action: "service_state_transferred",
      status: "processed",
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
      wechatAccountId: identity.wechatAccountId,
      conversationId: identity.conversationId,
      customerId: identity.customerId,
      operationKey,
      serviceState,
      servicerUserId: servicerUserId || null,
      eventCredentialId: eventCredential?.id || null,
      eventCodeHash: eventCredential?.eventCodeHash || null,
    });
    return normalizeServiceStateResponse(state, serviceState, eventCredential);
  }

  async sendCustomerServiceEventText(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    eventCredentialId?: string;
    text?: string;
    msgid?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const eventCredentialId = requiredText(payload.eventCredentialId, "eventCredentialId");
    const text = requiredText(payload.text, "text");
    if (Buffer.byteLength(text, "utf8") > 2048) {
      throw new BadRequestException("事件响应文本不能超过 2048 字节");
    }
    const created = await this.persistence.createWechatWorkEventSendTaskFromCredential({
      credentialId: eventCredentialId,
      operationKey,
      identity,
      binding,
      payload: {
        kind: "wechat_work_event_text",
        text,
        requestedMsgid: payload.msgid || null,
      },
      guardSnapshot: {
        source: "wechat_work_kf_event",
        requiredChecks: ["identityBinding", "wechatWorkBinding", "officialApiConfig", "eventCredential"],
        policy: "safe-send-queue",
        eventCredentialId,
        automaticRetryBlocked: true,
        eventCredentialSingleUse: true,
      },
    });
    if (!created) throw new BadRequestException("企业微信事件响应凭证已经使用或失效");
    const { credential, task } = created;
    let delivery: any;
    try {
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${operationKey}:send-msg-on-event-queued`),
        action: "send_msg_on_event_queued",
        status: "queued",
        operationKey,
        sendTaskId: task.id,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        eventCredentialId: credential.id,
        eventCodeHash: credential.eventCodeHash,
        eventCredentialExpiresAt: credential.expiresAt,
        msgtype: "text",
      });
      delivery = await this.wechat.executeQueuedSend(task.id, {
        adapter: "wechat_work_kf",
        expectedWechatAccountId: identity.wechatAccountId,
        expectedConversationId: identity.conversationId,
        expectedCustomerId: identity.customerId,
      });
    } finally {
      await this.clearEventCredentialSecretFromSendTask(task.id);
    }
    const apiMsgId = delivery?.attempt?.metadata?.apiMsgId || delivery?.attempt?.metadata?.wechatWorkMsgId || payload.msgid || null;
    return {
      ok: true,
      accepted: delivery?.task?.status === "sent",
      sendTaskId: delivery?.task?.id || task.id,
      sendAttemptId: delivery?.attempt?.id || null,
      status: delivery?.task?.status || task.status,
      msgid: apiMsgId,
      eventCredentialId: credential.id,
      proofBoundary: "send_msg_on_event 使用一次性事件凭证通过安全发送队列完成；sent/API accepted 仍只证明企业微信服务端接受事件响应消息，不证明客户手机已经展示。",
    };
  }

  async sendCustomerServiceEventMenu(payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    eventCredentialId?: string;
    msgmenu?: Record<string, unknown>;
    message?: Record<string, unknown>;
    msgid?: string;
    requestId?: string;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const identity = resolveRequiredWechatWorkIdentity(payload);
    const binding = await this.requireWechatWorkBinding(identity);
    const eventCredentialId = requiredText(payload.eventCredentialId, "eventCredentialId");
    const msgmenu = normalizeWechatWorkEventMsgMenu(payload.msgmenu || payload.message);
    const credentialPreview = await this.persistence.getWechatWorkAuditLog(eventCredentialId);
    if (credentialPreview && !eventCredentialAllowsMsgMenu(credentialPreview)) {
      throw new BadRequestException("企业微信事件菜单只支持用户进入会话欢迎语或结束会话场景，排队/接待中的 msg_code 只能发送文本。");
    }
    const created = await this.persistence.createWechatWorkEventSendTaskFromCredential({
      credentialId: eventCredentialId,
      operationKey,
      identity,
      binding,
      payload: {
        kind: "wechat_work_event_msgmenu",
        msgmenu,
        requestedMsgid: payload.msgid || null,
      },
      guardSnapshot: {
        source: "wechat_work_kf_event",
        requiredChecks: ["identityBinding", "wechatWorkBinding", "officialApiConfig", "eventCredential", "eventMsgMenu"],
        policy: "safe-send-queue",
        eventCredentialId,
        automaticRetryBlocked: true,
        eventCredentialSingleUse: true,
      },
    });
    if (!created) throw new BadRequestException("企业微信事件响应凭证已经使用或失效");
    const { credential, task } = created;
    let delivery: any;
    try {
      await this.persistence.recordWechatWorkAudit({
        id: deterministicOperationId("wwaudit", `${operationKey}:send-msg-on-event-queued`),
        action: "send_msg_on_event_queued",
        status: "queued",
        operationKey,
        sendTaskId: task.id,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        eventCredentialId: credential.id,
        eventCodeHash: credential.eventCodeHash,
        eventCredentialExpiresAt: credential.expiresAt,
        msgtype: "msgmenu",
        menuItemCount: Array.isArray(msgmenu.list) ? msgmenu.list.length : 0,
      });
      delivery = await this.wechat.executeQueuedSend(task.id, {
        adapter: "wechat_work_kf",
        expectedWechatAccountId: identity.wechatAccountId,
        expectedConversationId: identity.conversationId,
        expectedCustomerId: identity.customerId,
      });
    } finally {
      await this.clearEventCredentialSecretFromSendTask(task.id);
    }
    const apiMsgId = delivery?.attempt?.metadata?.apiMsgId || delivery?.attempt?.metadata?.wechatWorkMsgId || payload.msgid || null;
    return {
      ok: true,
      accepted: delivery?.task?.status === "sent",
      sendTaskId: delivery?.task?.id || task.id,
      sendAttemptId: delivery?.attempt?.id || null,
      status: delivery?.task?.status || task.status,
      msgid: apiMsgId,
      eventCredentialId: credential.id,
      proofBoundary: "send_msg_on_event 菜单消息仅用于企业微信允许的事件场景；sent/API accepted 仍只证明企业微信服务端接受事件响应消息，不证明客户手机已经展示。",
    };
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

  async queueCustomerServiceMessage(payload: {
    externalUserId?: string;
    openKfid?: string;
    messages?: unknown[];
    msgtype?: string;
    message?: Record<string, unknown>;
    requestId?: string;
    manualReply?: boolean;
    queuedBy?: string;
    [key: string]: unknown;
  }) {
    const operationKey = normalizeOperationKey(payload.requestId, "requestId");
    const openKfid = requiredText(payload.openKfid || appConfig.wechatWorkOpenKfid, "openKfid");
    const externalUserId = requiredText(payload.externalUserId, "externalUserId");
    const messages = normalizeWechatWorkCustomerServiceMessages(
      Array.isArray(payload.messages) ? payload.messages : [payload],
    );
    const binding = await this.persistence.getWechatWorkBinding(openKfid, externalUserId);
    if (!binding) throw new BadRequestException("wechat work customer is not mapped yet; sync an inbound message first");
    const manualReply = payload.manualReply === true;
    const queuedBy = String(payload.queuedBy || "manual_operator").trim() || "manual_operator";
    const task = await this.persistence.createSendTask({
      operationKey,
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      payload: {
        kind: "wechat_work_messages",
        messages,
        ...(manualReply ? {
          source: "manual_reply",
          manualReply: true,
          queuedBy,
          wechatAccountId: binding.wechatAccountId,
          conversationId: binding.conversationId,
          customerId: binding.customerId,
        } : {}),
      },
      guardSnapshot: {
        source: "wechat_work_kf",
        requiredChecks: ["identityBinding", "wechatWorkBinding", "officialApiConfig", "officialMessagePayload"],
        policy: "safe-send-queue",
        ...(manualReply ? { manualReply: true, queuedBy } : {}),
      },
    });
    await this.persistence.recordWechatWorkAudit({
      id: deterministicOperationId("wwaudit", `${operationKey}:rich-queued`),
      action: "send_rich_messages_queued",
      status: "queued",
      sendTaskId: task.id,
      openKfid,
      externalUserId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      wechatAccountId: binding.wechatAccountId,
      messageCount: messages.length,
      messageTypes: messages.map((item) => item.msgtype),
      manualReply,
      ...(manualReply ? { queuedBy } : {}),
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

  async dispatchCustomerServiceText(id: string, options: { manualPriority?: boolean } = {}) {
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
      const identity = {
        adapter: "wechat_work_kf",
        expectedWechatAccountId: task.wechatAccountId,
        expectedConversationId: task.conversationId,
        expectedCustomerId: task.customerId || task.conversation?.customerId,
      };
      return options.manualPriority
        ? await this.wechat.executeManualReplyNow(sendTaskId, identity)
        : await this.wechat.executeQueuedSend(sendTaskId, identity);
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

  private async requireWechatWorkBinding(identity: { wechatAccountId: string; conversationId: string; customerId: string }) {
    const binding = await this.persistence.findWechatWorkBindingByIdentity(identity);
    if (!binding) throw new BadRequestException("当前会话还没有企业微信客户身份");
    if (
      binding.wechatAccountId !== identity.wechatAccountId
      || binding.conversationId !== identity.conversationId
      || binding.customerId !== identity.customerId
    ) {
      throw new BadRequestException("企业微信客户、会话与客服账号身份不一致");
    }
    return binding;
  }

  private async createEventReplyCredentialFromCode(input: {
    code?: unknown;
    codeKind: string;
    source: string;
    sourceMsgid?: string | null;
    eventType?: string;
    serviceState?: unknown;
    operationKey?: string;
    binding: any;
  }) {
    const code = String(input.code || "").trim();
    if (!code) return null;
    const binding = input.binding || {};
    const eventCodeHash = wechatWorkEventCodeHash(code);
    const id = deterministicOperationId("wwevent", [
      binding.openKfid,
      binding.externalUserId,
      input.source,
      input.sourceMsgid || input.operationKey || eventCodeHash,
      input.codeKind,
      eventCodeHash,
    ].map((item) => String(item || "")).join(":"));
    const existing = await this.persistence.getWechatWorkAuditLog(id);
    if (existing) return normalizeEventReplyCredential(existing);
    const createdAt = new Date();
    const serviceState = normalizeEventCredentialServiceState(input.serviceState);
    const ttlMs = resolveWechatWorkEventCredentialTtlMs({
      codeKind: input.codeKind,
      eventType: input.eventType,
      serviceState,
    });
    const expiresAt = new Date(createdAt.getTime() + ttlMs).toISOString();
    const record = {
      id,
      action: "event_reply_credential",
      status: "pending",
      openKfid: binding.openKfid,
      externalUserId: binding.externalUserId,
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      source: input.source,
      sourceMsgid: input.sourceMsgid || null,
      eventType: input.eventType || "unknown",
      serviceState,
      codeKind: input.codeKind,
      eventCodeHash,
      eventCodeSecret: sealWechatWorkEventCode(code),
      expiresAt,
      ttlMs,
      operationKey: input.operationKey || null,
      createdAt: createdAt.toISOString(),
    };
    await this.persistence.upsertWechatWorkAudit(record);
    return record;
  }

  private async clearEventCredentialSecretFromSendTask(sendTaskId: string) {
    const task = await this.persistence.getSendTask(sendTaskId);
    const payload = task?.payload && typeof task.payload === "object"
      ? { ...task.payload }
      : null;
    if (!payload || !isWechatWorkEventReplyPayloadKind(payload.kind) || !("eventCodeSecret" in payload)) return task;
    delete payload.eventCodeSecret;
    payload.eventCredentialSecretClearedAt = new Date().toISOString();
    payload.eventCredentialSecretStored = false;
    return this.persistence.updateSendTask(sendTaskId, { payload });
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
        const immediateReplies = sync.processed
          .map((item: any) => item.immediateReply)
          .filter(Boolean);
        await this.persistence.recordWechatWorkAudit({
          action: "callback_sync_completed",
          status: "processed",
          openKfid: payload.openKfid || null,
          receivedCount: sync.receivedCount,
          processedCount: sync.processedCount,
          immediateReplyProcessedCount: immediateReplies.filter((item: any) => item.ok === true).length,
          immediateReplyBlockedCount: immediateReplies.filter((item: any) => item.task?.status === "blocked").length,
          immediateReplyFailedCount: immediateReplies.filter((item: any) => item.ok !== true).length,
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
      const existingInboundOperation = existingBinding
        ? await this.persistence.getInboundMessageOperation(existingBinding.wechatAccountId, msgid)
        : null;
      const duplicate = isRetryableInboundOperation(existingInboundOperation) ? null : existingDuplicate;
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
      const concurrentInboundOperation = concurrentDuplicate
        ? await this.persistence.getInboundMessageOperation(binding.wechatAccountId, msgid)
        : null;
      if (concurrentDuplicate && !isRetryableInboundOperation(concurrentInboundOperation)) {
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
      const upgradeQrRecovery = await this.resumePendingCustomerUpgradeQrAfterInbound({ binding, msgid });
      const result = await this.wechat.processInboundMessage({
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        text: normalized.text,
        messageType: normalized.msgtype,
        messageContent: normalized.messageContent,
        messageDisplayText: normalizedBase.text,
        externalId: msgid,
        createdAt: normalized.createdAt,
        attachments,
        mediaUnderstanding: normalized.understanding,
        ...(upgradeQrRecovery?.handled ? {
          handledServiceAction: {
            type: upgradeQrRecovery.recovered
              ? "customer_upgrade_qr_recovered"
              : "customer_upgrade_qr_queued",
            status: upgradeQrRecovery.recovered ? "completed" : "queued",
            referenceId: String(upgradeQrRecovery.upgrade?.id || ""),
          },
        } : {}),
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
      const immediateReply = result.sendTask
        ? await this.dispatchInboundReplyImmediately({
          task: result.sendTask,
          binding,
          inboundMsgid: msgid,
        })
        : null;
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
      return { status: "processed", msgid, binding: profiledBinding, result, immediateReply };
    } finally {
      this.inflightInbound.delete(msgid);
    }
  }

  private async dispatchInboundReplyImmediately(params: {
    task: any;
    binding: any;
    inboundMsgid: string;
  }) {
    const expectedCustomerId = String(params.binding.customerId || "");
    const identity = {
      expectedWechatAccountId: String(params.binding.wechatAccountId || ""),
      expectedConversationId: String(params.binding.conversationId || ""),
      expectedCustomerId,
    };
    try {
      const delivery = await this.wechat.executeQueuedSend(params.task.id, {
        adapter: "wechat_work_kf",
        ...identity,
      });
      const deliveryStatus = String(delivery?.task?.status || "unknown");
      const ok = deliveryStatus === "sent";
      await this.persistence.recordWechatWorkAudit({
        action: "inbound_reply_immediate_dispatch",
        status: ok ? "sent" : deliveryStatus,
        msgid: params.inboundMsgid,
        sendTaskId: params.task.id,
        openKfid: params.binding.openKfid,
        externalUserId: params.binding.externalUserId,
        wechatAccountId: identity.expectedWechatAccountId,
        conversationId: identity.expectedConversationId,
        customerId: expectedCustomerId,
        queueWaitMs: 0,
      });
      return { ...delivery, ok };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.persistence.recordWechatWorkAudit({
        action: "inbound_reply_immediate_dispatch",
        status: "failed",
        msgid: params.inboundMsgid,
        sendTaskId: params.task.id,
        openKfid: params.binding.openKfid,
        externalUserId: params.binding.externalUserId,
        wechatAccountId: identity.expectedWechatAccountId,
        conversationId: identity.expectedConversationId,
        customerId: expectedCustomerId,
        queueWaitMs: 0,
        errorMessage,
      });
      return { ok: false, task: await this.persistence.getSendTask(params.task.id), errorMessage };
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
    let binding: any = null;
    if (openKfid && externalUserId) {
      binding = await this.persistence.upsertWechatWorkBinding({ openKfid, externalUserId, sendTime: message.send_time });
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
      const customerUpgrade = await this.persistence.findWechatWorkCustomerUpgradeByMsgId(failMsgid);
      if (customerUpgrade) {
        const failedAt = new Date().toISOString();
        const failedPart = customerUpgrade.textMsgId === failMsgid ? "text" : "image";
        const updated = await this.persistence.updateWechatWorkCustomerUpgrade(customerUpgrade.id, {
          status: "async_failed",
          ...(failedPart === "text" ? { textStatus: "async_failed" } : { imageStatus: "async_failed" }),
          asyncFailedAt: failedAt,
          errorMessage: `企业微信异步回执报告${failedPart === "text" ? "推荐语" : "二维码图片"}发送失败，类型 ${String(event.fail_type ?? "unknown")}`,
        });
        await this.persistence.upsertWechatWorkAudit(updated ? {
          id: deterministicOperationId("wwaudit", `${customerUpgrade.id}:async-failed:${failMsgid}`),
          action: "customer_upgrade_qr_async_failed",
          status: "failed",
          msgid: failMsgid,
          sendTaskId: customerUpgrade.sendTaskId || attempt?.sendTaskId || null,
          sendAttemptId: customerUpgrade.sendAttemptId || attempt?.id || null,
          openKfid: customerUpgrade.openKfid,
          externalUserId: customerUpgrade.externalUserId,
          conversationId: customerUpgrade.conversationId,
          customerId: customerUpgrade.customerId,
          memberUserId: customerUpgrade.memberUserId,
          failedPart,
          failType: event.fail_type ?? null,
        } : {
          id: deterministicOperationId("wwaudit", `${customerUpgrade.id}:async-failed-write-conflict:${failMsgid}`),
          action: "customer_upgrade_async_failure_write_conflict",
          status: "manual_review",
          msgid: failMsgid,
          sendTaskId: customerUpgrade.sendTaskId || attempt?.sendTaskId || null,
          sendAttemptId: customerUpgrade.sendAttemptId || attempt?.id || null,
          openKfid: customerUpgrade.openKfid,
          externalUserId: customerUpgrade.externalUserId,
          conversationId: customerUpgrade.conversationId,
          customerId: customerUpgrade.customerId,
          memberUserId: customerUpgrade.memberUserId,
          failedPart,
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
    const eventReplyCode = eventReplyCodeFromEvent(event);
    const eventCredential = binding && eventReplyCode
      ? await this.createEventReplyCredentialFromCode({
          code: eventReplyCode.code,
          codeKind: eventReplyCode.codeKind,
          source: "sync_msg_event",
          sourceMsgid: msgid,
          eventType,
          serviceState: eventServiceState(event),
          binding,
        })
      : null;
    await this.persistence.recordWechatWorkAudit({
      action: "event_processed",
      status: "processed",
      msgid,
      eventType,
      openKfid: openKfid || null,
      externalUserId: externalUserId || null,
      wechatAccountId: binding?.wechatAccountId || null,
      conversationId: binding?.conversationId || null,
      customerId: binding?.customerId || null,
      eventCredentialId: eventCredential?.id || null,
      eventCodeHash: eventCredential?.eventCodeHash || null,
      event: eventType,
      eventPayload: sanitizeWechatWorkEvent(event),
    });
    return { status: "processed", msgid, eventType, eventCredentialId: eventCredential?.id || null };
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
  const messageContent = normalizeWechatWorkMessageContent(msgtype, body);
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
        messageContent,
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
        messageContent,
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
    messageContent,
    createdAt: message.send_time ? new Date(Number(message.send_time) * 1000).toISOString() : undefined,
    attachments: [],
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

function normalizeExternalContactQrCodeUrl(value: unknown) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new BadRequestException("企业微信没有返回有效的专员二维码地址");
  }
  const hostname = parsed.hostname.toLowerCase();
  const trustedHost = hostname === "qpic.cn"
    || hostname.endsWith(".qpic.cn")
    || hostname === "weixin.qq.com"
    || hostname.endsWith(".weixin.qq.com");
  if (!["http:", "https:"].includes(parsed.protocol) || !trustedHost || parsed.username || parsed.password) {
    throw new BadRequestException("企业微信返回了不受信任的专员二维码地址");
  }
  parsed.hash = "";
  return parsed.toString();
}

function assertPathInsideStorageRoot(targetDirectory: string, storageRoot: string) {
  fs.mkdirSync(storageRoot, { recursive: true });
  const resolvedRoot = fs.realpathSync(storageRoot);
  const resolvedTarget = fs.realpathSync(targetDirectory);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new BadRequestException("企业微信二维码目录被重定向到本地存储根目录之外，已拒绝写入");
}

function normalizeWechatWorkSecret(value: unknown) {
  const secret = String(value || "").trim();
  if (!/^[0-9A-Za-z_-]{16,256}$/.test(secret)) {
    throw new BadRequestException("请输入企业微信自建应用详情页复制的完整 Secret");
  }
  return secret;
}

function normalizeWechatWorkCorpId(value: unknown) {
  const corpId = String(value || "").trim();
  if (!/^[0-9A-Za-z_-]{4,128}$/.test(corpId)) {
    throw new BadRequestException("请输入企业微信管理后台复制的完整 CorpID");
  }
  return corpId;
}

function normalizeWechatWorkCallbackToken(value: unknown) {
  const token = String(value || "").trim();
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(token)) {
    throw new BadRequestException("回调 Token 只能包含字母、数字、下划线或短横线");
  }
  return token;
}

function normalizeWechatWorkEncodingAesKey(value: unknown) {
  const key = String(value || "").trim();
  let decoded = Buffer.alloc(0);
  try {
    decoded = Buffer.from(`${key}=`, "base64");
  } catch {}
  if (!/^[0-9A-Za-z+/]{43}$/.test(key) || decoded.length !== 32) {
    throw new BadRequestException("EncodingAESKey 必须是企业微信生成的 43 位有效密钥");
  }
  return key;
}

function normalizeWechatWorkPublicBaseUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestException("公网回调地址必须是有效的 HTTPS 域名");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new BadRequestException("公网回调地址必须使用可从企业微信访问的 HTTPS 域名");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
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
  if (error instanceof WechatWorkApiError && error.errcode === 60020) {
    return unsafeWechatWorkIpError(error, "wechat_customer_service");
  }
  if (error instanceof WechatWorkApiError && error.errcode === 95011) {
    return new BadRequestException("当前凭证模式与企业微信客服不兼容；请使用已加入“应用管理 → 微信客服 → API → 可调用接口的应用”的自建应用 Secret");
  }
  if (error instanceof WechatWorkApiError && error.errcode === 95012) {
    return new BadRequestException("当前凭证模式与企业微信客服不兼容；请重新确认自建应用的微信客服 API 权限和 Secret");
  }
  if (error instanceof WechatWorkApiError && [40001, 40014, 41001, 42001].includes(Number(error.errcode))) {
    return new BadRequestException("企业微信拒绝了这个 Secret；请确认复制的是已获微信客服 API 权限的自建应用 Secret");
  }
  return new BadRequestException(error instanceof Error ? error.message : "自建应用 Secret 验证失败");
}

function customerContactCredentialError(error: unknown) {
  if (error instanceof WechatWorkApiError && error.errcode === 60020) {
    return unsafeWechatWorkIpError(error, "customer_contact");
  }
  if (error instanceof WechatWorkApiError && error.errcode === 48002) {
    return new BadRequestException("当前自建应用没有客户联系 API 权限；请在“客户联系 → 客户 → API → 可调用接口的应用”中添加该应用");
  }
  if (error instanceof WechatWorkApiError && error.errcode === 40098) {
    return new BadRequestException(
      "所选专员尚未完成企业微信成员实名认证，企业微信不允许为该成员生成“联系我”二维码。请让该专员先完成实名认证，或改选已有二维码的专员。",
    );
  }
  if (error instanceof WechatWorkApiError && [40001, 40014, 41001, 42001].includes(Number(error.errcode))) {
    return new BadRequestException("企业微信拒绝了这个 Secret；请使用已加入客户联系“可调用接口的应用”的自建应用凭证");
  }
  return new BadRequestException(error instanceof Error ? error.message : "企业微信客户联系权限验证失败");
}

function unsafeWechatWorkIpError(
  error: WechatWorkApiError,
  scope: "wechat_customer_service" | "customer_contact",
) {
  const detail = String(error.response?.errmsg || error.message || "");
  const ip = detail.match(/from ip:\s*([0-9a-f:.]+)/i)?.[1] || "";
  const ipDetail = ip ? ` ${ip}` : "";
  const permissionStep = scope === "wechat_customer_service"
    ? "再到“应用管理 → 微信客服 → API → 可调用接口的应用”勾选同一个自建应用"
    : "再到“客户联系 → 客户 → API → 可调用接口的应用”勾选同一个自建应用";
  return new BadRequestException(
    `企业微信拒绝了当前出口 IP${ipDetail}（错误码 60020），这不是 Secret 缺失，也不是让你另找“微信客服 Secret”。请到“应用管理 → 应用 → 自建 → 对应应用 → 开发者接口 → 企业可信 IP”添加该地址，${permissionStep}；等待约 1 分钟后再刷新。`,
  );
}

function persistWechatWorkDesktopCredential(payload: {
  corpId: string;
  secret: string;
  openKfid: string;
  callbackToken?: string;
  encodingAesKey?: string;
  publicBaseUrl?: string;
  enableAutomaticReplies?: boolean;
}) {
  persistWechatWorkDesktopEnv({
    WECHAT_WORK_CORP_ID: payload.corpId,
    WECHAT_WORK_SECRET: payload.secret,
    WECHAT_WORK_OPEN_KFID: payload.openKfid,
    WECHAT_WORK_TOKEN: payload.callbackToken,
    WECHAT_WORK_ENCODING_AES_KEY: payload.encodingAesKey,
    CUSTOMER_SERVICE_PUBLIC_BASE_URL: payload.publicBaseUrl,
    WECHAT_SEND_ADAPTER: "wechat_work_kf",
    WECHAT_WORK_AUTO_SYNC_ENABLED: "1",
    LOW_VALUE_AUTOMATION_ENABLED: payload.enableAutomaticReplies === undefined
      ? undefined
      : payload.enableAutomaticReplies ? "1" : "0",
  });
}

function persistWechatWorkDesktopEnv(updates: Record<string, string | undefined>) {
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
  const normalizedUpdates = Object.fromEntries(
    Object.entries(updates).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const seen = new Set<string>();
  const lines = current.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !(match[1] in normalizedUpdates)) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${normalizedUpdates[key]}`;
  });
  for (const [key, value] of Object.entries(normalizedUpdates)) {
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

function persistWechatWorkCustomerContactCredential(secret: string) {
  persistWechatWorkDesktopEnv({ WECHAT_WORK_EXTERNAL_CONTACT_SECRET: secret });
}

function safeReadinessEndpointOrigin(value: unknown) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return undefined;
  }
}

function isRetryableInboundOperation(operation: any) {
  return Boolean(
    operation
    && ["retryable", "failed"].includes(String(operation.status || ""))
    && !operation.completedAt,
  );
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

function syncedItemCustomerLaneKey(message: WechatWorkKfMessage, fallbackOpenKfid: string) {
  const event = isPlainObject(message?.event) ? message.event : {};
  const openKfid = syncedItemOpenKfid(message) || fallbackOpenKfid;
  const externalUserId = String(message?.external_userid || event.external_userid || "").trim();
  return externalUserId
    ? `${openKfid}:${externalUserId}`
    : `${openKfid}:event:${stableSyncedItemId(message)}`;
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

function normalizeCustomerServiceAccountName(value: unknown) {
  const name = requiredText(value, "name");
  if ([...name].length > 64) throw new BadRequestException("客服账号名称不能超过 64 个字符");
  return name;
}

function normalizeCustomerServiceUserIds(value: unknown) {
  const userIds = uniqueTextList(value);
  if (!userIds.length) throw new BadRequestException("至少选择一名企业微信成员");
  if (userIds.length > 100) throw new BadRequestException("一次最多操作 100 名企业微信成员");
  return userIds;
}

function customerServiceServicerStatusName(value: unknown) {
  const status = Number(value);
  return Number.isFinite(status) ? `企业微信状态码 ${status}` : "企业微信未返回状态";
}

type CustomerServiceStatisticDay = {
  statTime: number;
  date: string;
  metrics: ReturnType<typeof normalizeCustomerServiceStatisticMetrics>;
};

const CUSTOMER_SERVICE_STATISTIC_DAY_SECONDS = 24 * 60 * 60;

function normalizeCustomerServiceStatisticsPeriod(startDateValue: unknown, endDateValue: unknown) {
  const startDate = requiredText(startDateValue, "startDate");
  const endDate = requiredText(endDateValue, "endDate");
  const startTime = customerServiceStatisticDateTimestamp(startDate, "startDate");
  const endTime = customerServiceStatisticDateTimestamp(endDate, "endDate");
  if (startTime > endTime) throw new BadRequestException("统计开始日期不能晚于结束日期");
  const dayCount = Math.floor((endTime - startTime) / CUSTOMER_SERVICE_STATISTIC_DAY_SECONDS) + 1;
  if (dayCount > 31) throw new BadRequestException("企业微信客服统计一次最多查询 31 个自然日");

  const todayTime = customerServiceStatisticDateTimestamp(shanghaiDate(Date.now()), "today");
  const availableThroughTime = todayTime - CUSTOMER_SERVICE_STATISTIC_DAY_SECONDS;
  const earliestTime = todayTime - (180 * CUSTOMER_SERVICE_STATISTIC_DAY_SECONDS);
  if (startTime < earliestTime || endTime > availableThroughTime) {
    throw new BadRequestException("企业微信客服统计只支持查询昨天至前 180 天的数据");
  }
  return {
    startDate,
    endDate,
    startTime,
    endTime,
    dayCount,
    availableThrough: shanghaiDate(availableThroughTime * 1000),
  };
}

function customerServiceStatisticDateTimestamp(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label} must use YYYY-MM-DD`);
  const timestamp = Date.parse(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(timestamp) || shanghaiDate(timestamp) !== value) {
    throw new BadRequestException(`${label} is not a valid calendar date`);
  }
  return Math.floor(timestamp / 1000);
}

function shanghaiDate(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeCustomerServiceStatisticDays(value: unknown): CustomerServiceStatisticDay[] {
  return (Array.isArray(value) ? value : [])
    .map((item: any) => {
      const statTime = Number(item?.stat_time);
      if (!Number.isSafeInteger(statTime) || statTime <= 0) return null;
      return {
        statTime,
        date: shanghaiDate(statTime * 1000),
        metrics: normalizeCustomerServiceStatisticMetrics(item?.statistic),
      };
    })
    .filter((item): item is CustomerServiceStatisticDay => Boolean(item))
    .sort((left, right) => left.statTime - right.statTime);
}

function normalizeCustomerServiceStatisticMetrics(value: unknown) {
  const statistic: any = value && typeof value === "object" ? value : {};
  const metric = (key: string) => {
    const number = Number(statistic[key]);
    return Number.isFinite(number) ? number : null;
  };
  return {
    sessionCount: metric("session_cnt"),
    customerCount: metric("customer_cnt"),
    customerMessageCount: metric("customer_msg_cnt"),
    upgradeServiceCustomerCount: metric("upgrade_service_customer_cnt"),
    aiSessionReplyCount: metric("ai_session_reply_cnt"),
    aiTransferRate: metric("ai_transfer_rate"),
    aiKnowledgeHitRate: metric("ai_knowledge_hit_rate"),
    replyRate: metric("reply_rate"),
    firstReplyAverageSec: metric("first_reply_average_sec"),
    satisfactionInvestigationCount: metric("satisfaction_investgate_cnt"),
    satisfactionParticipationRate: metric("satisfaction_participation_rate"),
    satisfiedRate: metric("satisfied_rate"),
    middlingRate: metric("middling_rate"),
    dissatisfiedRate: metric("dissatisfied_rate"),
    upgradeServiceMemberInviteCount: metric("upgrade_service_member_invite_cnt"),
    upgradeServiceMemberCustomerCount: metric("upgrade_service_member_customer_cnt"),
    upgradeServiceGroupchatInviteCount: metric("upgrade_service_groupchat_invite_cnt"),
    upgradeServiceGroupchatCustomerCount: metric("upgrade_service_groupchat_customer_cnt"),
    messageRejectedCustomerCount: metric("msg_rejected_customer_cnt"),
  };
}

function summarizeCustomerServiceStatisticDays(days: CustomerServiceStatisticDay[]) {
  const counts = [
    "sessionCount",
    "customerCount",
    "customerMessageCount",
    "upgradeServiceCustomerCount",
    "aiSessionReplyCount",
    "satisfactionInvestigationCount",
    "upgradeServiceMemberInviteCount",
    "upgradeServiceMemberCustomerCount",
    "upgradeServiceGroupchatInviteCount",
    "upgradeServiceGroupchatCustomerCount",
    "messageRejectedCustomerCount",
  ] as const;
  const averages = [
    "aiTransferRate",
    "aiKnowledgeHitRate",
    "replyRate",
    "firstReplyAverageSec",
    "satisfactionParticipationRate",
    "satisfiedRate",
    "middlingRate",
    "dissatisfiedRate",
  ] as const;
  const summary: Record<string, number | null> = {};
  for (const key of counts) {
    summary[key] = days.reduce((total, day) => total + Number(day.metrics[key] || 0), 0);
  }
  for (const key of averages) {
    const values = days.map((day) => day.metrics[key]).filter((item): item is number => item != null);
    summary[key] = values.length
      ? Math.round((values.reduce((total, item) => total + item, 0) / values.length) * 10_000) / 10_000
      : null;
  }
  return summary;
}

function customerServiceStatisticsErrorState(error: unknown) {
  const apiError = error instanceof WechatWorkApiError ? error : null;
  if (apiError?.errcode === 45009) {
    return {
      status: "rate_limited" as const,
      code: "WECHAT_WORK_STATISTICS_RATE_LIMITED",
      message: "企业微信统计接口当前触发频率限制，请稍后手动重试。",
      apiErrcode: apiError.errcode,
      retryAfterSeconds: apiError.retryAfterSeconds || 60,
    };
  }
  if (apiError && [48002, 48007].includes(Number(apiError.errcode))) {
    return {
      status: "permission_required" as const,
      code: "WECHAT_WORK_STATISTICS_PERMISSION_REQUIRED",
      message: "当前应用没有微信客服数据统计权限，或客服账号的接待人员不在应用可见范围内。请在企业微信后台补充权限后重试。",
      apiErrcode: apiError.errcode ?? null,
      retryAfterSeconds: null,
    };
  }
  return {
    status: "unavailable" as const,
    code: "WECHAT_WORK_STATISTICS_UNAVAILABLE",
    message: "企业微信客服统计暂时不可用，请检查应用配置、网络和官方接口状态后重试。",
    apiErrcode: apiError?.errcode ?? null,
    retryAfterSeconds: null,
  };
}

function customerServiceDirectoryError(error: unknown) {
  if (error instanceof WechatWorkApiError && error.errcode === 48002) {
    return "微信客服 Secret 没有读取完整企业通讯录的权限，成员选择器已回退到升级服务专员范围。";
  }
  return error instanceof Error ? error.message : "企业成员目录读取失败";
}

function normalizeCustomerServiceOperationResults(value: unknown, requestedUserIds: string[]) {
  const items = Array.isArray(value) ? value : [];
  if (!items.length) {
    return requestedUserIds.map((userId) => ({ userId, ok: true, errcode: 0, errmsg: "ok" }));
  }
  return requestedUserIds.map((userId) => {
    const item: any = items.find((candidate: any) => String(candidate?.userid || "").trim() === userId) || {};
    const errcode = Number(item.errcode || 0);
    return {
      userId,
      ok: errcode === 0,
      errcode,
      errmsg: String(item.errmsg || (errcode === 0 ? "ok" : "企业微信拒绝了该成员操作")),
    };
  });
}

function summarizeCustomerServiceOperation(openKfid: string, results: Array<{
  userId: string;
  ok: boolean;
  errcode: number;
  errmsg: string;
}>) {
  const succeeded = results.filter((result) => result.ok).length;
  return {
    ok: succeeded === results.length,
    partial: succeeded > 0 && succeeded < results.length,
    openKfid,
    requested: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

function resolveCustomerUpgradeMessageState(metadata: any, taskStatus: string) {
  const responseMessages = Array.isArray(metadata?.apiResponse?.messages)
    ? metadata.apiResponse.messages
    : [];
  const acceptedMsgids = uniqueTextList(
    responseMessages.length
      ? responseMessages.map((item: any) => item?.msgid)
      : metadata?.apiMsgIds || metadata?.wechatWorkMsgIds || metadata?.acceptedMessageIds || [metadata?.apiMsgId],
  );
  const failureStage = String(metadata?.failureStage || "");
  const typedTextMsgId = responseMessages.find(
    (item: any) => String(item?.type || "").includes("text"),
  )?.msgid;
  const typedImageMsgId = responseMessages.find(
    (item: any) => String(item?.type || "").includes("image"),
  )?.msgid;
  const fallbackTextMsgId = !responseMessages.length
    ? failureStage === "send_text"
      ? null
      : acceptedMsgids.length >= 2 ? acceptedMsgids[1] : null
    : null;
  const fallbackImageMsgId = !responseMessages.length
    ? failureStage === "send_text"
      ? acceptedMsgids[0]
      : acceptedMsgids.length >= 2 ? acceptedMsgids[0] : null
    : null;
  const textMsgId = String(typedTextMsgId || fallbackTextMsgId || "").trim() || null;
  const imageMsgId = String(typedImageMsgId || fallbackImageMsgId || "").trim() || null;
  const acceptedAll = taskStatus === "sent";
  const missingMessageStatus = String(metadata?.deliveryState || "") === "partial"
    ? "failed"
    : ["queued", "sending"].includes(taskStatus) ? taskStatus : "failed";
  const imageFailedFirst = ["upload_image", "send_image"].includes(failureStage) && !imageMsgId;
  return {
    acceptedMsgids,
    textMsgId,
    imageMsgId,
    textStatus: textMsgId || (
      acceptedAll
      && responseMessages.some((item: any) => String(item?.type || "").includes("text"))
    )
      ? "api_accepted"
      : imageFailedFirst ? "not_started" : missingMessageStatus,
    imageStatus: imageMsgId || acceptedAll
      ? "api_accepted"
      : missingMessageStatus,
  };
}

function customerUpgradeStatusDetail(status: string, record: any, manualResendAvailable = false) {
  if (manualResendAvailable && status === "superseded") {
    return "该专员的二维码仍已保存在本机；即使后来选择过其他专员，也可以人工再次发送。";
  }
  if (manualResendAvailable && status === "ready") {
    return "专员二维码已经生成并保存在本机，可以立即人工发送，无需等待升级推荐任务结束。";
  }
  if (status === "added_confirmed") return "客户联系回调与 unionid 已共同确认原客服客户添加了所选专员；这不等于已证明客服消息在客户手机显示。";
  if (status === "half_added_pending") return "客户已发起添加，但所选专员尚未确认，不能视为长期客户升级完成。";
  if (status === "identity_unverified") return record?.errorMessage || "收到添加回调，但新增联系人身份无法与原客服客户匹配，已转人工核验。";
  if (status === "api_accepted") return record?.textStatus === "api_accepted"
    ? "企业微信客服接口已受理专员二维码和说明文字，尚未收到客户添加专员回调。"
    : "企业微信客服接口已受理专员二维码；说明文字未受理不影响客户添加专员。";
  if (status === "partial") return "文字或二维码只有一部分被接口受理，已阻止重复发送已受理部分。";
  if (status === "async_failed") return record?.errorMessage || "企业微信异步回执报告发送失败。";
  if (manualResendAvailable && ["queued", "sending"].includes(status)) {
    return "已有人工发送任务正在处理；现有二维码仍可按需再次人工发送。";
  }
  if (["creating", "remote_created", "ready", "queued", "sending"].includes(status)) return "升级链路正在处理，尚未取得可发送的本机二维码。";
  if (status === "resource_failed" && /real name has not been verified|40098/i.test(String(record?.errorMessage || ""))) {
    return "所选专员尚未完成企业微信成员实名认证，企业微信不允许生成该专员的“联系我”二维码。请先完成实名认证，或改选已有二维码的专员。";
  }
  if (status === "failed" && /95018|send msg session status invalid/i.test(String(record?.errorMessage || ""))) {
    return customerUpgradeSessionEndedMessage();
  }
  if (status === "failed" && isCustomerUpgradeSendQuotaExhausted(record?.errorMessage)) {
    return customerUpgradeSendQuotaExhaustedMessage();
  }
  if (status === "failed" || status === "resource_failed") return record?.errorMessage || "升级链路未完成。";
  return "尚未取得可验收的长期客户升级证据。";
}

function customerUpgradeSessionEndedMessage() {
  return "该客户的微信客服会话已结束，企业微信不允许继续发送消息。请让客户在微信中重新进入该客服并发送一条消息，再点击“再次发送二维码”。";
}

function customerUpgradeSendQuotaExhaustedMessage() {
  return "企业微信已用完该客户本轮客服会话的可发送条数（95001）。这不是本系统的重复发送限制，继续点击也会被企业微信拒绝。请让客户先在微信中发送一条新消息；系统收到后会自动恢复二维码发送。";
}

function isCustomerUpgradeSendQuotaExhausted(error: unknown) {
  return /95001|send msg count limit/i.test(error instanceof Error ? error.message : String(error || ""));
}

function customerUpgradeDeliveryError(error: unknown) {
  if (
    error instanceof WechatWorkApiError && error.errcode === 95018
    || /95018|send msg session status invalid/i.test(error instanceof Error ? error.message : String(error))
  ) {
    return new BadRequestException(customerUpgradeSessionEndedMessage());
  }
  if (
    error instanceof WechatWorkApiError && error.errcode === 95001
    || isCustomerUpgradeSendQuotaExhausted(error)
  ) {
    return new BadRequestException(customerUpgradeSendQuotaExhaustedMessage());
  }
  return error;
}

function upgradeServiceConfigDetail(memberCount: number, memberOptions: UpgradeServiceMemberOption[]) {
  if (!memberCount) return "企业微信尚未配置可用的升级服务专员。";
  const resolvedCount = memberOptions.filter((option) => option.displayName !== option.userId).length;
  if (resolvedCount === memberCount) {
    return "已读取企业微信升级服务专员，并解析了成员姓名。";
  }
  if (resolvedCount > 0) {
    return `已读取企业微信升级服务专员，已解析 ${resolvedCount}/${memberCount} 个成员姓名；未解析成员仍显示 UserID。`;
  }
  return "已读取企业微信升级服务专员；当前凭证未能读取成员姓名，暂时显示 UserID。";
}

function isProcessedCustomerUpgradeRecommendation(
  record: any,
  input: {
    openKfid: string;
    externalUserId: string;
    customerId: string;
    memberUserId: string;
  },
) {
  if (!record || typeof record !== "object") return false;
  if (record.action !== "customer_upgrade_recommended" || record.status !== "processed") return false;
  if (String(record.memberUserId || "") !== input.memberUserId) return false;

  const sameExternalCustomer = String(record.externalUserId || "") === input.externalUserId;
  const sameInternalCustomer = String(record.customerId || "") === input.customerId;
  if (!sameExternalCustomer && !sameInternalCustomer) return false;

  const recordOpenKfid = String(record.openKfid || "");
  return !recordOpenKfid || recordOpenKfid === input.openKfid || sameInternalCustomer;
}

function resolveRequiredWechatWorkIdentity(payload: {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
}) {
  return {
    wechatAccountId: requiredText(payload.wechatAccountId, "wechatAccountId"),
    conversationId: requiredText(payload.conversationId, "conversationId"),
    customerId: requiredText(payload.customerId, "customerId"),
  };
}

function isAuditLockStale(record: any, maxAgeMs: number) {
  const timestamp = Date.parse(String(record?.lockStartedAt || record?.updatedAt || record?.createdAt || ""));
  return !Number.isFinite(timestamp) || Date.now() - timestamp > maxAgeMs;
}

function isCustomerUpgradeManualLockPreDispatchFailure(record: any) {
  return String(record?.status || "") === "failed"
    && Boolean(String(record?.sendTaskId || ""))
    && !String(record?.sendAttemptId || "")
    && !String(record?.textMsgId || "")
    && !String(record?.imageMsgId || "")
    && /manually locked|人工接管/i.test(String(record?.errorMessage || ""));
}

function isManualizedCustomerUpgradePreDispatchTask(record: any, task: any) {
  return String(record?.status || "") === "failed"
    && !String(record?.sendAttemptId || "")
    && !String(record?.textMsgId || "")
    && !String(record?.imageMsgId || "")
    && String(task?.status || "") === "queued"
    && task?.payload?.source === "manual_reply"
    && task?.payload?.manualReply === true
    && task?.guardSnapshot?.manualReply === true;
}

function normalizeCustomerServiceState(value: unknown) {
  const state = Math.floor(Number(value));
  if (![1, 2, 3, 4].includes(state)) {
    throw new BadRequestException("serviceState must be one of 1, 2, 3, or 4");
  }
  return state;
}

function resolveWechatWorkEventCredentialTtlMs(input: {
  codeKind?: string;
  eventType?: string;
  serviceState?: unknown;
}) {
  const codeKind = String(input.codeKind || "").trim().toLowerCase();
  const eventType = String(input.eventType || "").trim().toLowerCase();
  const serviceState = Number(input.serviceState);
  if (codeKind === "welcome_code" || eventType === "enter_session") {
    return WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS;
  }
  if (serviceState === 4) {
    return WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS;
  }
  if (serviceState === 2 || serviceState === 3) {
    return WECHAT_WORK_EVENT_CODE_LONG_TTL_MS;
  }
  if (codeKind === "msg_code") {
    return WECHAT_WORK_EVENT_CODE_LONG_TTL_MS;
  }
  return WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS;
}

function eventCredentialAllowsMsgMenu(record: any) {
  const codeKind = String(record?.codeKind || "").trim().toLowerCase();
  const eventType = String(record?.eventType || "").trim().toLowerCase();
  const serviceState = Number(record?.serviceState);
  return codeKind === "welcome_code" || eventType === "enter_session" || serviceState === 4;
}

function normalizeEventCredentialServiceState(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function normalizeServiceStateResponse(
  state: { service_state?: number; servicer_userid?: string; service_userid?: string; msg_code?: string },
  requestedState?: number,
  eventCredential?: any,
) {
  const rawState = state.service_state ?? requestedState;
  const numericState = Number(rawState);
  const serviceState = Number.isFinite(numericState) ? Math.floor(numericState) : null;
  return {
    ok: true,
    serviceState,
    serviceStateName: customerServiceStateName(serviceState),
    servicerUserId: state.servicer_userid || state.service_userid || null,
    msgCodePresent: Boolean(state.msg_code),
    eventCredentialId: eventCredential?.id || null,
    eventCredentialExpiresAt: eventCredential?.expiresAt || null,
    proofBoundary: "service_state 只反映企业微信当前接待状态；如返回 msg_code，系统只暴露一次性 eventCredentialId，不暴露企业微信原始 code。",
  };
}

function normalizeEventReplyCredential(record: any) {
  if (!record || typeof record !== "object") return null;
  return {
    ...record,
    id: String(record.id || ""),
    action: String(record.action || ""),
    status: String(record.status || ""),
    openKfid: String(record.openKfid || ""),
    externalUserId: String(record.externalUserId || ""),
    wechatAccountId: String(record.wechatAccountId || ""),
    conversationId: String(record.conversationId || ""),
    customerId: String(record.customerId || ""),
    eventCodeHash: String(record.eventCodeHash || ""),
    eventCodeSecret: record.eventCodeSecret || null,
    expiresAt: String(record.expiresAt || ""),
  };
}

function eventReplyCodeFromEvent(event: Record<string, unknown>) {
  for (const key of ["welcome_code", "msg_code", "code"]) {
    const value = String(event?.[key] || "").trim();
    if (value) return { codeKind: key, code: value };
  }
  return null;
}

function eventServiceState(event: Record<string, unknown>) {
  const raw = event?.service_state ?? event?.serviceState;
  const state = Math.floor(Number(raw));
  return Number.isFinite(state) ? state : null;
}

function redactWechatWorkAuditRecord(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => redactWechatWorkAuditRecord(item));
  const output: Record<string, unknown> = {};
  let redacted = false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveWechatWorkCredentialKey(key)) {
      redacted = true;
      continue;
    }
    const next = redactWechatWorkAuditRecord(item);
    if (next && typeof next === "object" && !Array.isArray(next) && (next as Record<string, unknown>).sensitiveCredentialRedacted) {
      redacted = true;
    }
    output[key] = next;
  }
  if (redacted) output.sensitiveCredentialRedacted = true;
  return output;
}

function isSensitiveWechatWorkCredentialKey(key: string) {
  return /^(eventCode|eventCodeSecret|code|msgCode|welcomeCode)$/i.test(key)
    || /_(code|secret)$/i.test(String(key || ""));
}

function sanitizeWechatWorkEvent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeWechatWorkEvent(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveWechatWorkEventCodeKey(key) && typeof item === "string" && item.trim()) {
      output[`${key}_present`] = true;
      output[`${key}_hash`] = wechatWorkEventCodeHash(item);
      continue;
    }
    output[key] = sanitizeWechatWorkEvent(item);
  }
  return output;
}

function isSensitiveWechatWorkEventCodeKey(key: string) {
  return ["welcome_code", "msg_code", "code"].includes(String(key || "").trim().toLowerCase());
}

function latestExternalContactPermissionFailure(audit: any[]) {
  return (Array.isArray(audit) ? audit : []).find((record) => {
    if (!record || typeof record !== "object") return false;
    const code = Number(record.apiErrcode ?? record.errcode ?? record.errorCode);
    return code === 48002 && /^external_contact_/.test(String(record.action || ""));
  }) || null;
}

function latestExternalContactPermissionSuccess(audit: any[]) {
  return (Array.isArray(audit) ? audit : []).find((record) => {
    if (!record || typeof record !== "object") return false;
    return ["external_contact_credential_validated", "external_contact_way_created"]
      .includes(String(record.action || ""))
      && ["processed", "sent", "accepted"].includes(String(record.status || ""));
  }) || null;
}

function auditTimestamp(record: any) {
  const timestamp = Date.parse(String(record?.createdAt || record?.updatedAt || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function customerServiceStateName(state: number | null) {
  if (state === 0) return "未处理";
  if (state === 1) return "由智能助手接待";
  if (state === 2) return "待接入池";
  if (state === 3) return "由人工接待";
  if (state === 4) return "已结束";
  return "未知";
}

function buildWechatWorkCapabilityMatrix(input: {
  configured: boolean;
  callbackEvidence: boolean;
  inboundEvidence: boolean;
  sendAcceptedEvidence: boolean;
  externalContactConfigured: boolean;
  externalContactVerified: boolean;
  qrSendAcceptedEvidence: boolean;
  qrPermissionLastVerifiedAt?: string | null;
  qrPermissionErrcode?: number | null;
  sendAdapter: any;
}) {
  const configured = Boolean(input.configured);
  const officialSendAdapter = input.sendAdapter?.name === "wechat_work_kf" && input.sendAdapter?.realSend === true;
  const apiStatus = configured ? "available_unverified" : "config_missing";
  const sendStatus = configured && officialSendAdapter
    ? (input.sendAcceptedEvidence ? "verified_api_accepted" : "available_unverified")
    : "config_missing";
  const callbackStatus = configured
    ? (input.callbackEvidence ? "verified" : "available_unverified")
    : "config_missing";
  const inboundStatus = configured
    ? (input.inboundEvidence ? "verified" : "available_unverified")
    : "config_missing";
  const externalContactStatus = !input.externalContactConfigured
    ? "config_missing"
    : input.qrPermissionErrcode === 48002
      ? "permission_blocked"
      : input.qrSendAcceptedEvidence
        ? "verified_api_accepted"
        : "available_unverified";
  return [
    capabilityItem("callback", "回调验证与事件接收", callbackStatus, "已接企业微信 callback 验签、解密与后台同步调度。"),
    capabilityItem("sync_msg", "客服消息拉取 sync_msg", inboundStatus, "已按 open_kfid/cursor 拉取并落库入站消息。"),
    capabilityItem("inbound_media", "入站文本和媒体解析", inboundStatus, "已处理文本、图片、语音、视频、文件、位置、链接、名片、小程序和事件的统一入站结构；媒体内容仍按安全上限审核。"),
    capabilityItem("send_text_image_file", "发送文本、图片、文件", sendStatus, `当前发送适配器：${input.sendAdapter?.label || input.sendAdapter?.name || "unknown"}。图片和文件支持受控本地素材上传后发送。`),
    capabilityItem("send_rich_messages", "富媒体消息安全发送", apiStatus, "安全发送队列已接入官方 kf/send_msg 的文本、图片、语音、视频、文件、图文链接、小程序、菜单和位置消息；语音/视频要求使用已取得的企业微信 media_id。逐类型未实测前不标记为 verified。"),
    capabilityItem("media_upload_get", "素材上传与下载", apiStatus, "已接入 image/file 上传和入站媒体下载。"),
    capabilityItem("customer_profile", "客户资料同步", apiStatus, "已接 customer/batchget，并会更新客户昵称和头像。"),
    capabilityItem("kf_account_management", "客服账号运营", apiStatus, "已接 kf/account/list、add、update、del；创建、改名和删除均要求管理通道权限并记录审计，当前固定账号禁止删除。"),
    capabilityItem("kf_servicer_management", "接待人员运营", apiStatus, "已接 kf/servicer/list、add、del；支持按客服账号增删接待人员，并强制至少保留一名接待人员。"),
    capabilityItem("corp_member_directory", "企业成员目录", apiStatus, "已接 user/list_id 与 user/get，用于成员选择和中文姓名、头像解析；读取权限不足时保留成员 ID 并明确显示部分可用。"),
    capabilityItem("upgrade_service_config", "升级服务配置", apiStatus, "已接 get_upgrade_service_config，并解析专员中文姓名。"),
    capabilityItem("upgrade_service", "升级服务推荐", apiStatus, "已接 upgrade_service；官方行为是给接待人员侧提示，不会自动向客户发送专员二维码。", {
      customerVisibleDelivery: false,
      requiresReceptionistAction: true,
    }),
    capabilityItem("cancel_upgrade_service", "取消升级服务推荐", apiStatus, "已接 cancel_upgrade_service，用于撤销接待人员侧升级提示。"),
    capabilityItem("service_state", "接待状态查询与转接", apiStatus, "已接 service_state/get 和 service_state/trans，支持转智能助手、转人工、结束会话。"),
    capabilityItem("send_msg_on_event", "事件响应消息", apiStatus, "已接 send_msg_on_event；文本和菜单事件响应都通过一次性事件凭证进入安全发送队列，菜单仅允许企业微信官方支持的用户进入会话欢迎语和结束会话场景。逐事件类型未实测前不标记为 verified。"),
    capabilityItem("external_contact_qr", "客户联系二维码自动发放", externalContactStatus, input.externalContactConfigured
      ? "已接 externalcontact/add_contact_way：为升级服务专员生成真实“联系我”二维码，并通过微信客服 kf/send_msg 自动发送。"
      : "尚未配置具备客户联系 API 权限的自建应用 Secret；微信客服 Secret 不能生成专员“联系我”二维码。", {
      errcode: input.qrPermissionErrcode || undefined,
      customerVisibleDelivery: false,
      customerDeliveryApiAccepted: Boolean(input.qrSendAcceptedEvidence),
      lastVerifiedAt: input.qrPermissionLastVerifiedAt || null,
    }),
  ];
}

function capabilityItem(
  key: string,
  label: string,
  status: string,
  detail: string,
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label,
    status,
    ready: ["available", "verified", "verified_api_accepted", "available_unverified"].includes(status),
    detail,
    ...extra,
  };
}

function summarizeWechatWorkCapabilities(capabilities: Array<{ status?: string }>) {
  const summary = {
    total: capabilities.length,
    verified: 0,
    available: 0,
    availableUnverified: 0,
    partial: 0,
    blocked: 0,
    configMissing: 0,
  };
  for (const capability of capabilities) {
    const status = String(capability.status || "");
    if (status === "verified" || status === "verified_api_accepted") summary.verified += 1;
    else if (status === "available") summary.available += 1;
    else if (status === "available_unverified") summary.availableUnverified += 1;
    else if (status === "partial") summary.partial += 1;
    else if (status === "config_missing") summary.configMissing += 1;
    else summary.blocked += 1;
  }
  return summary;
}

function isPendingCustomerUpgradeRecommendation(
  record: any,
  input: {
    openKfid: string;
    externalUserId: string;
    customerId: string;
    memberUserId: string;
  },
) {
  return isCustomerUpgradeRecommendationStatus(record, input, "pending");
}

function isCustomerUpgradeRecommendationStatus(
  record: any,
  input: {
    openKfid: string;
    externalUserId: string;
    customerId: string;
    memberUserId: string;
  },
  status: string,
) {
  if (!record || typeof record !== "object") return false;
  if (record.action !== "customer_upgrade_recommended" || record.status !== status) return false;
  if (String(record.memberUserId || "") !== input.memberUserId) return false;

  const sameExternalCustomer = String(record.externalUserId || "") === input.externalUserId;
  const sameInternalCustomer = String(record.customerId || "") === input.customerId;
  if (!sameExternalCustomer && !sameInternalCustomer) return false;

  const recordOpenKfid = String(record.openKfid || "");
  return !recordOpenKfid || recordOpenKfid === input.openKfid || sameInternalCustomer;
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
