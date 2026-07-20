import { BadRequestException, Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";
import { WechatPersistence } from "../wechat/wechat-persistence";
import { WechatWorkApiClient, WechatWorkApiError, WechatWorkKfMessage } from "./wechat-work-api.client";
import { storeWechatWorkInboundImage } from "./wechat-work-inbound-media";
import { resolveWechatWorkImageFile } from "./wechat-work-media";
import { buildWechatWorkProductionReadiness } from "./wechat-work-readiness";
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
};

const WECHAT_WORK_INBOUND_MAX_ATTEMPTS = 3;

@Injectable()
export class WechatWorkService {
  private readonly inflightInbound = new Set<string>();
  private readonly scheduledSyncs = new Map<string, Promise<unknown>>();
  private readonly activeCursorSyncs = new Map<string, Promise<unknown>>();
  private readonly persistence: WechatPersistence;

  constructor(
    private readonly wechat: WechatDispatchService,
    private readonly localStore: LocalStoreService,
    private readonly api: WechatWorkApiClient,
    prisma: PrismaService,
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
    const readiness = buildWechatWorkProductionReadiness({ mappedAccounts: bindings, auditRecords: audit.length });
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
    const mappedAccounts = await this.persistence.countWechatWorkBindings();
    const auditRecords = (await this.persistence.listWechatWorkAuditLogs(500)).length;
    return buildWechatWorkProductionReadiness({ mappedAccounts, auditRecords });
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

  private async runCustomerServiceSync(
    payload: { token?: string; cursor?: string; limit?: number; openKfid: string },
  ) {
    const token = requiredText(payload.token, "token");
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

  private scheduleCustomerServiceSync(payload: { token: string; openKfid?: string }) {
    const key = payload.openKfid || appConfig.wechatWorkOpenKfid || "missing_open_kfid";
    if (this.scheduledSyncs.has(key)) return;
    const pending = this.syncCustomerServiceMessages(payload)
      .catch((error) => {
        return this.persistence.recordWechatWorkAudit({
          action: "callback_sync_failed",
          status: "failed",
          openKfid: payload.openKfid || null,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => this.scheduledSyncs.delete(key));
    this.scheduledSyncs.set(key, pending);
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
      const normalized = await normalizeInbound(message, msgid, openKfid, externalUserId, this.api);
      const binding = await this.persistence.upsertWechatWorkBinding({
        openKfid: normalized.openKfid,
        externalUserId: normalized.externalUserId,
        sendTime: message.send_time,
      });
      const duplicate = await this.persistence.findMessageByExternalId(binding.conversationId, msgid);
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
      const result = await this.wechat.processInboundMessage({
        wechatAccountId: binding.wechatAccountId,
        conversationId: binding.conversationId,
        customerId: binding.customerId,
        text: normalized.text,
        externalId: msgid,
        createdAt: normalized.createdAt,
        attachments: normalized.attachments,
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
      });
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
      return { status: "processed", msgid, binding, result };
    } finally {
      this.inflightInbound.delete(msgid);
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
        await this.persistence.updateSendAttempt(attempt.id, {
          status: "failed",
          errorMessage,
          completedAt: new Date().toISOString(),
          metadata: {
            bridgeState: "async_delivery_failed",
            finalDeliveryPendingFailureEvent: false,
            failureEventMsgId: msgid,
            failType: event.fail_type ?? null,
          },
        });
        await this.persistence.updateSendTask(attempt.sendTaskId, {
          status: "failed",
          errorMessage,
          guardSnapshot: {
            ...(attempt.sendTask?.guardSnapshot || {}),
            wechatWorkAsyncFailureMsgId: msgid,
            wechatWorkAsyncFailType: event.fail_type ?? null,
            wechatWorkAsyncFailedAt: new Date().toISOString(),
          },
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
  if (msgtype === "image") {
    const mediaId = requiredText(body.media_id, "image.media_id");
    try {
      const media = await api.downloadMedia({ mediaId });
      const stored = await storeWechatWorkInboundImage({ msgid, mediaId, media });
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
          width: stored.width,
          height: stored.height,
          fingerprint: stored.fingerprint,
          fingerprintAlgorithm: "dhash64:v1",
          status: stored.status,
          reviewRequired: false,
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

function clampLimit(value: unknown) {
  const limit = Math.floor(Number(value || 1000));
  if (!Number.isFinite(limit) || limit <= 0) return 1000;
  return Math.min(limit, 1000);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
