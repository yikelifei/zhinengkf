import { BadRequestException, Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { LocalStoreService } from "../local-store/local-store.service";
import { appConfig } from "../shared/app-config";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";
import { WechatWorkApiClient, WechatWorkApiError, WechatWorkKfMessage } from "./wechat-work-api.client";
import { buildWechatWorkProductionReadiness } from "./wechat-work-readiness";

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
};

@Injectable()
export class WechatWorkService {
  private readonly inflightInbound = new Set<string>();
  private readonly scheduledSyncs = new Map<string, Promise<unknown>>();

  constructor(
    private readonly wechat: WechatDispatchService,
    private readonly localStore: LocalStoreService,
    private readonly api: WechatWorkApiClient,
  ) {}

  getStatus() {
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
      {
        key: "localStore",
        env: "USE_LOCAL_STORE",
        ok: appConfig.useLocalStore,
        detail: appConfig.useLocalStore ? "enabled" : "Prisma mode is not implemented for this integration",
      },
      {
        key: "sendAdapter",
        env: "WECHAT_SEND_ADAPTER",
        ok: appConfig.wechatSendAdapter === "wechat_work_kf",
        detail: appConfig.wechatSendAdapter,
      },
    ];
    const bindings = this.localStore.listWechatAccounts().filter((item: any) => item.platform === "wechat_work_kf").length;
    const audit = this.localStore.listWechatWorkAuditLogs(500);
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
        mode: appConfig.useLocalStore ? "local_store" : "unsupported",
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

  getProductionPreflight() {
    const mappedAccounts = this.localStore
      .listWechatAccounts()
      .filter((item: any) => item.platform === "wechat_work_kf").length;
    const auditRecords = this.localStore.listWechatWorkAuditLogs(500).length;
    return buildWechatWorkProductionReadiness({ mappedAccounts, auditRecords });
  }

  verifyCallback(query: CallbackQuery) {
    try {
      const encrypted = requiredText(query.echostr, "echostr");
      this.verifySignature(query, encrypted);
      const decrypted = this.decryptMessage(encrypted);
      this.assertReceiveId(decrypted.receiveId);
      this.localStore.recordWechatWorkAudit({
        action: "callback_verification_accepted",
        status: "accepted",
      });
      return decrypted.message;
    } catch (error) {
      this.recordOperationFailure("callback_verification_rejected", error, {
        signaturePresent: Boolean(query.msg_signature || query.signature),
      });
      throw error;
    }
  }

  handleCallback(query: CallbackQuery, body: unknown) {
    try {
      const encrypted = this.extractEncryptedBody(body);
      this.verifySignature(query, encrypted);
      const decrypted = this.decryptMessage(encrypted);
      this.assertReceiveId(decrypted.receiveId);
      const callbackId = `callback_${crypto.createHash("sha256").update(decrypted.message).digest("hex")}`;
      if (this.localStore.hasWechatWorkAuditMsgId(callbackId)) {
        this.localStore.recordWechatWorkAudit({
          action: "callback_duplicate",
          status: "duplicate",
          callbackId,
        });
        return "success";
      }
      const xml = parseXml(decrypted.message);
      const event = xml.Event || "";
      if (event !== "kf_msg_or_event") {
        this.localStore.recordWechatWorkAudit({
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
      this.localStore.recordWechatWorkAudit({
        action: "callback_accepted",
        status: "accepted",
        msgid: callbackId,
        callbackId,
        event,
        openKfid: openKfid || null,
      });
      this.scheduleCustomerServiceSync({ token, openKfid });
      return "success";
    } catch (error) {
      this.recordOperationFailure("callback_rejected", error, {
        signaturePresent: Boolean(query.msg_signature || query.signature),
      });
      throw error;
    }
  }

  async syncCustomerServiceMessages(
    payload: { token?: string; cursor?: string; limit?: number; openKfid?: string } = {},
  ) {
    const token = requiredText(payload.token, "token");
    const limit = clampLimit(payload.limit);
    const fallbackOpenKfid = String(payload.openKfid || appConfig.wechatWorkOpenKfid || "").trim();
    let cursor = String(payload.cursor || "");
    let pageCount = 0;
    let receivedCount = 0;
    const processed: any[] = [];
    const duplicates: any[] = [];
    const ignored: any[] = [];
    const failed: any[] = [];
    let hasMore = false;

    while (pageCount < 50) {
      const response = await this.api.syncMessages({ token, cursor, limit, openKfid: fallbackOpenKfid || undefined });
      pageCount += 1;
      const messages = Array.isArray(response.msg_list) ? response.msg_list : [];
      receivedCount += messages.length;
      for (const message of messages) {
        try {
          const result = await this.processSyncedItem(message, fallbackOpenKfid);
          if (result.status === "processed") processed.push(result);
          else if (result.status === "duplicate") duplicates.push(result);
          else ignored.push(result);
        } catch (error) {
          const failure = {
            status: "failed",
            msgid: String(message.msgid || ""),
            msgtype: String(message.msgtype || "unknown"),
            errorMessage: error instanceof Error ? error.message : String(error),
          };
          failed.push(failure);
          this.localStore.recordWechatWorkAudit({
            action: "inbound_failed",
            ...failure,
            openKfid: message.open_kfid || fallbackOpenKfid || null,
            externalUserId: message.external_userid || null,
          });
        }
      }
      const nextCursor = String(response.next_cursor || "");
      hasMore = Boolean(response.has_more);
      if (!hasMore) {
        cursor = nextCursor;
        break;
      }
      if (!nextCursor || nextCursor === cursor) {
        throw new BadRequestException("wechat work sync_msg returned has_more without a new next_cursor");
      }
      cursor = nextCursor;
    }
    if (pageCount >= 50 && hasMore) throw new BadRequestException("wechat work sync_msg exceeded 50 pages in one run");

    return {
      ok: true,
      pageCount,
      receivedCount,
      processedCount: processed.length,
      duplicateCount: duplicates.length,
      ignoredCount: ignored.length,
      failedCount: failed.length,
      nextCursor: cursor,
      processed,
      duplicates,
      ignored,
      failed,
    };
  }

  listAuditLogs(limit?: number) {
    return {
      records: this.localStore.listWechatWorkAuditLogs(limit),
    };
  }

  queueCustomerServiceText(payload: { externalUserId?: string; openKfid?: string; text?: string }) {
    const openKfid = requiredText(payload.openKfid || appConfig.wechatWorkOpenKfid, "openKfid");
    const externalUserId = requiredText(payload.externalUserId, "externalUserId");
    const text = requiredText(payload.text, "text");
    const binding = this.localStore.getWechatWorkBinding(openKfid, externalUserId);
    if (!binding) throw new BadRequestException("wechat work customer is not mapped yet; sync an inbound message first");
    const task = this.localStore.createSendTask({
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
    this.localStore.recordWechatWorkAudit({
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

  async dispatchCustomerServiceText(id: string) {
    const sendTaskId = requiredText(id, "sendTaskId");
    const task = this.localStore.getSendTask(sendTaskId);
    if (!task) throw new BadRequestException(`wechat work send task not found: ${sendTaskId}`);

    const binding = this.localStore.findWechatWorkBindingByIdentity({
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      customerId: task.customerId || task.conversation?.customerId,
    });
    if (!binding) {
      throw new BadRequestException("send task is not bound to a WeChat Work customer");
    }

    this.localStore.recordWechatWorkAudit({
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
      this.recordOperationFailure("send_dispatch_rejected", error, {
        sendTaskId,
        openKfid: binding.openKfid,
        externalUserId: binding.externalUserId,
      });
      throw error;
    }
  }

  private scheduleCustomerServiceSync(payload: { token: string; openKfid?: string }) {
    const key = `${payload.openKfid || "all"}:${payload.token}`;
    if (this.scheduledSyncs.has(key)) return;
    const pending = this.syncCustomerServiceMessages(payload)
      .catch((error) => {
        this.localStore.recordWechatWorkAudit({
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
    if (this.localStore.hasWechatWorkAuditMsgId(msgid) || this.inflightInbound.has(msgid)) {
      return { status: "duplicate", msgid };
    }
    this.inflightInbound.add(msgid);
    try {
      const event = isPlainObject(message.event) ? message.event : {};
      const openKfid = String(message.open_kfid || event.open_kfid || fallbackOpenKfid || "").trim();
      const externalUserId = String(message.external_userid || event.external_userid || "").trim();
      if (message.msgtype === "event") {
        return this.processSyncedEvent(message, event, msgid, openKfid, externalUserId);
      }
      if (message.servicer_userid) {
        return this.auditIgnoredMessage(message, msgid, openKfid, externalUserId, "servicer_origin");
      }
      const normalized = normalizeInbound(message, msgid, openKfid, externalUserId);
      const binding = this.localStore.upsertWechatWorkBinding({
        openKfid: normalized.openKfid,
        externalUserId: normalized.externalUserId,
        sendTime: message.send_time,
      });
      const duplicate = this.localStore.findMessageByExternalId(binding.conversationId, msgid);
      if (duplicate) {
        this.localStore.recordWechatWorkAudit({
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
      this.localStore.recordWechatWorkAudit({
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
      return { status: "processed", msgid, binding, result };
    } finally {
      this.inflightInbound.delete(msgid);
    }
  }

  private processSyncedEvent(
    message: WechatWorkKfMessage,
    event: Record<string, unknown>,
    msgid: string,
    openKfid: string,
    externalUserId: string,
  ) {
    const eventType = String(event.event_type || "unknown");
    if (openKfid && externalUserId) {
      this.localStore.upsertWechatWorkBinding({ openKfid, externalUserId, sendTime: message.send_time });
    }
    if (eventType === "msg_send_fail") {
      const failMsgid = requiredText(event.fail_msgid, "event.fail_msgid");
      const attempt = this.localStore.findWechatWorkSendAttemptByMsgId(failMsgid);
      if (attempt) {
        const errorMessage = `wechat work reported send failure type ${String(event.fail_type ?? "unknown")}`;
        this.localStore.updateSendAttempt(attempt.id, {
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
        this.localStore.updateSendTask(attempt.sendTaskId, {
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
      this.localStore.recordWechatWorkAudit({
        action: "send_async_failed",
        status: "failed",
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
    this.localStore.recordWechatWorkAudit({
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

  private auditIgnoredMessage(
    message: WechatWorkKfMessage,
    msgid: string,
    openKfid: string,
    externalUserId: string,
    reason: string,
  ) {
    this.localStore.recordWechatWorkAudit({
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
    return this.localStore.recordWechatWorkAudit({
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

function normalizeInbound(
  message: WechatWorkKfMessage,
  msgid: string,
  openKfid: string,
  externalUserId: string,
): NormalizedInbound {
  const msgtype = String(message.msgtype || "").trim();
  if (!openKfid || !externalUserId) {
    throw new BadRequestException("sync_msg customer message requires open_kfid and external_userid");
  }
  const body = isPlainObject(message[msgtype]) ? message[msgtype] as Record<string, unknown> : {};
  const text = inboundText(msgtype, body);
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
