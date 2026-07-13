import { BadRequestException, Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { appConfig } from "../shared/app-config";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

type CallbackQuery = {
  msg_signature?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
};

type KfMessage = {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  msgtype?: string;
  text?: { content?: string };
};

@Injectable()
export class WechatWorkService {
  private accessTokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly wechat: WechatDispatchService) {}

  getStatus() {
    return {
      configured: {
        corpId: Boolean(appConfig.wechatWorkCorpId),
        agentId: Boolean(appConfig.wechatWorkAgentId),
        secret: Boolean(appConfig.wechatWorkSecret),
        token: Boolean(appConfig.wechatWorkToken),
        encodingAesKey: Boolean(appConfig.wechatWorkEncodingAesKey),
        openKfid: Boolean(appConfig.wechatWorkOpenKfid),
        defaultConversation: Boolean(appConfig.wechatWorkDefaultConversationId),
      },
      callbackUrl: `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/callback`,
      apiBaseUrl: appConfig.wechatWorkApiBaseUrl,
      defaultWechatAccountId: appConfig.wechatWorkDefaultWechatAccountId,
      defaultConversationId: appConfig.wechatWorkDefaultConversationId,
      defaultCustomerId: appConfig.wechatWorkDefaultCustomerId,
    };
  }

  verifyCallback(query: CallbackQuery) {
    const encrypted = requiredText(query.echostr, "echostr");
    this.verifySignature(query, encrypted);
    return this.decryptMessage(encrypted).message;
  }

  async handleCallback(query: CallbackQuery, body: unknown) {
    const encrypted = this.extractEncryptedBody(body);
    this.verifySignature(query, encrypted);
    const decrypted = this.decryptMessage(encrypted);
    const xml = parseXml(decrypted.message);
    const event = xml.Event || "";

    if (event === "kf_msg_or_event" && xml.Token) {
      const synced = await this.syncCustomerServiceMessages({ token: xml.Token });
      return { ok: true, source: "callback", event, synced };
    }

    const content = xml.Content || xml.Text || "";
    if (!content) {
      return { ok: true, source: "callback", event: event || xml.MsgType || "unknown", processedCount: 0 };
    }

    const result = await this.processTextInbound({
      text: content,
      externalId: xml.MsgId || xml.MsgID || "",
      externalUserId: xml.FromUserName || xml.ExternalUserID || "",
      openKfid: xml.ToUserName || "",
      raw: xml,
    });
    return { ok: true, source: "callback", event: event || xml.MsgType || "message", processedCount: 1, result };
  }

  async syncCustomerServiceMessages(payload: { token?: string; cursor?: string; limit?: number } = {}) {
    const token = requiredText(payload.token, "token");
    const accessToken = await this.getAccessToken();
    const response = await this.postJson<{ errcode?: number; errmsg?: string; next_cursor?: string; has_more?: number; msg_list?: KfMessage[] }>(
      `/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`,
      {
        token,
        cursor: payload.cursor || "",
        limit: clampLimit(payload.limit),
        voice_format: 0,
      },
    );
    if (Number(response.errcode || 0) !== 0) {
      throw new BadRequestException(`wechat work sync_msg failed: ${response.errmsg || response.errcode}`);
    }

    const messages = Array.isArray(response.msg_list) ? response.msg_list : [];
    const processed = [];
    for (const message of messages) {
      if (message.msgtype !== "text") continue;
      const text = String(message.text?.content || "").trim();
      if (!text) continue;
      processed.push(
        await this.processTextInbound({
          text,
          externalId: message.msgid || "",
          externalUserId: message.external_userid || "",
          openKfid: message.open_kfid || "",
          raw: message,
        }),
      );
    }

    return {
      ok: true,
      receivedCount: messages.length,
      processedCount: processed.length,
      nextCursor: response.next_cursor || "",
      hasMore: Boolean(response.has_more),
      processed,
    };
  }

  async sendCustomerServiceText(payload: { externalUserId?: string; openKfid?: string; text?: string }) {
    const accessToken = await this.getAccessToken();
    const response = await this.postJson<Record<string, unknown>>(
      `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
      {
        touser: requiredText(payload.externalUserId, "externalUserId"),
        open_kfid: requiredText(payload.openKfid || appConfig.wechatWorkOpenKfid, "openKfid"),
        msgtype: "text",
        text: { content: requiredText(payload.text, "text") },
      },
    );
    return response;
  }

  private async processTextInbound(payload: {
    text: string;
    externalId?: string;
    externalUserId?: string;
    openKfid?: string;
    raw?: Record<string, unknown>;
  }) {
    const conversationId = requiredText(appConfig.wechatWorkDefaultConversationId, "WECHAT_WORK_DEFAULT_CONVERSATION_ID");
    const wechatAccountId = appConfig.wechatWorkDefaultWechatAccountId || undefined;
    const customerId = appConfig.wechatWorkDefaultCustomerId || undefined;
    return this.wechat.processInboundMessage({
      wechatAccountId,
      conversationId,
      customerId,
      text: payload.text,
      externalId: payload.externalId || payload.externalUserId || `wechat-work-${Date.now()}`,
      attachments: [
        {
          source: "wechat_work",
          externalUserId: payload.externalUserId || "",
          openKfid: payload.openKfid || "",
          raw: payload.raw || {},
        },
      ],
    });
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > now + 60_000) return this.accessTokenCache.token;
    const corpId = requiredText(appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID");
    const secret = requiredText(appConfig.wechatWorkSecret, "WECHAT_WORK_SECRET");
    const url = `${appConfig.wechatWorkApiBaseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    const response = await fetch(url);
    const data = (await response.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
    if (!response.ok || Number(data.errcode || 0) !== 0 || !data.access_token) {
      throw new BadRequestException(`wechat work gettoken failed: ${data.errmsg || response.status}`);
    }
    this.accessTokenCache = {
      token: data.access_token,
      expiresAt: now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000,
    };
    return this.accessTokenCache.token;
  }

  private async postJson<T>(pathAndQuery: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${appConfig.wechatWorkApiBaseUrl}${pathAndQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as T;
  }

  private extractEncryptedBody(body: unknown) {
    if (typeof body === "string") return requiredText(parseXml(body).Encrypt, "Encrypt");
    if (isPlainObject(body)) {
      const direct = body.Encrypt || body.encrypt || body.xml?.Encrypt || body.xml?.encrypt;
      if (direct) return String(direct);
      if (typeof body.body === "string") return requiredText(parseXml(body.body).Encrypt, "Encrypt");
    }
    throw new BadRequestException("wechat work callback requires encrypted XML body");
  }

  private verifySignature(query: CallbackQuery, encrypted: string) {
    const signature = query.msg_signature || query.signature || "";
    const expected = sha1Sorted([requiredText(appConfig.wechatWorkToken, "WECHAT_WORK_TOKEN"), requiredText(query.timestamp, "timestamp"), requiredText(query.nonce, "nonce"), encrypted]);
    if (signature !== expected) throw new BadRequestException("wechat work callback signature mismatch");
  }

  private decryptMessage(encrypted: string) {
    const aesKey = requiredText(appConfig.wechatWorkEncodingAesKey, "WECHAT_WORK_ENCODING_AES_KEY");
    const key = Buffer.from(`${aesKey}=`, "base64");
    if (key.length !== 32) throw new BadRequestException("WECHAT_WORK_ENCODING_AES_KEY must decode to 32 bytes");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);
    const unpadded = pkcs7Unpad(plain);
    const messageLength = unpadded.readUInt32BE(16);
    const messageStart = 20;
    const messageEnd = messageStart + messageLength;
    return {
      message: unpadded.subarray(messageStart, messageEnd).toString("utf8"),
      receiveId: unpadded.subarray(messageEnd).toString("utf8"),
    };
  }
}

function sha1Sorted(values: string[]) {
  return crypto.createHash("sha1").update(values.sort().join("")).digest("hex");
}

function pkcs7Unpad(buffer: Buffer) {
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 32) throw new BadRequestException("invalid PKCS7 padding");
  return buffer.subarray(0, buffer.length - pad);
}

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<([A-Za-z0-9_:-]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml))) {
    result[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
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
