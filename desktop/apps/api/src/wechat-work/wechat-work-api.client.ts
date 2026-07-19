import { BadRequestException, Injectable } from "@nestjs/common";
import fs from "node:fs";
import { appConfig } from "../shared/app-config";
import { MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES } from "./wechat-work-inbound-media";
import { resolveWechatWorkImageFile } from "./wechat-work-media";

export type WechatWorkKfMessage = {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  send_time?: number;
  origin?: number;
  servicer_userid?: string;
  msgtype?: string;
  text?: { content?: string; menu_id?: string };
  image?: { media_id?: string };
  voice?: { media_id?: string };
  video?: { media_id?: string };
  file?: { media_id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  link?: { title?: string; desc?: string; url?: string; pic_url?: string };
  business_card?: { userid?: string };
  miniprogram?: Record<string, unknown>;
  event?: Record<string, unknown>;
  [key: string]: unknown;
};

export type WechatWorkSyncResponse = {
  errcode?: number;
  errmsg?: string;
  next_cursor?: string;
  has_more?: number;
  msg_list?: WechatWorkKfMessage[];
};

export class WechatWorkApiError extends Error {
  readonly operation: string;
  readonly errcode?: number;
  readonly httpStatus?: number;
  readonly response?: Record<string, unknown>;
  readonly disposition?: "permanent" | "retry_exhausted" | "manual_review" | "delayed_blocked";
  readonly retryAfterSeconds?: number;

  constructor(
    operation: string,
    message: string,
    details: {
      errcode?: number;
      httpStatus?: number;
      response?: Record<string, unknown>;
      disposition?: "permanent" | "retry_exhausted" | "manual_review" | "delayed_blocked";
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "WechatWorkApiError";
    this.operation = operation;
    this.errcode = details.errcode;
    this.httpStatus = details.httpStatus;
    this.response = details.response;
    this.disposition = details.disposition;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

@Injectable()
export class WechatWorkApiClient {
  private accessTokenCache: { token: string; expiresAt: number } | null = null;

  async syncMessages(payload: { token: string; cursor?: string; limit?: number; openKfid?: string }) {
    return this.withAccessToken("sync_msg", (accessToken) =>
      this.postJson<WechatWorkSyncResponse>(
        `/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`,
        {
          token: requiredText(payload.token, "token"),
          cursor: String(payload.cursor || ""),
          limit: clampLimit(payload.limit),
          voice_format: 0,
          ...(payload.openKfid ? { open_kfid: payload.openKfid } : {}),
        },
        "sync_msg",
      ),
    );
  }

  async downloadMedia(payload: { mediaId: string }) {
    const mediaId = requiredText(payload.mediaId, "mediaId");
    let tokenRefreshed = false;
    let transientAttempt = 0;

    while (true) {
      const accessToken = await this.getAccessToken();
      let response: Response;
      try {
        response = await fetch(
          `${appConfig.wechatWorkApiBaseUrl}/cgi-bin/media/get?access_token=${encodeURIComponent(accessToken)}&media_id=${encodeURIComponent(mediaId)}`,
          { method: "GET" },
        );
      } catch {
        transientAttempt += 1;
        if (transientAttempt < 3) continue;
        throw new WechatWorkApiError("media_get", "wechat work media download network retries exhausted", {
          disposition: "retry_exhausted",
        });
      }

      if (response.status >= 500) {
        await discardResponse(response);
        transientAttempt += 1;
        if (transientAttempt < 3) continue;
        throw new WechatWorkApiError("media_get", "wechat work media download server retries exhausted", {
          httpStatus: response.status,
          disposition: "retry_exhausted",
        });
      }

      let bytes: Buffer;
      try {
        bytes = await readLimitedBytes(response, MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES);
      } catch (error) {
        if (error instanceof WechatWorkApiError && error.disposition === "permanent") throw error;
        transientAttempt += 1;
        if (transientAttempt < 3) continue;
        throw new WechatWorkApiError("media_get", "wechat work media download stream retries exhausted", {
          httpStatus: response.status,
          disposition: "retry_exhausted",
        });
      }

      const contentType = String(response.headers.get("content-type") || "application/octet-stream")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (contentType === "application/json" || contentType.endsWith("+json") || looksLikeJson(bytes) || !response.ok) {
        const data = parseDownloadError(bytes);
        const errcode = finiteNumber(data.errcode);
        if ((errcode === 40014 || errcode === 42001) && !tokenRefreshed) {
          tokenRefreshed = true;
          this.clearAccessToken();
          continue;
        }
        throw downloadApiError(errcode, response.status);
      }

      return {
        bytes,
        contentType,
        size: bytes.length,
      };
    }
  }

  async sendText(payload: { externalUserId: string; openKfid: string; text: string; msgid: string }) {
    return this.withAccessToken("send_msg", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; msgid?: string }>(
        `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
        {
          touser: requiredText(payload.externalUserId, "externalUserId"),
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          msgid: requiredText(payload.msgid, "msgid"),
          msgtype: "text",
          text: { content: requiredText(payload.text, "text") },
        },
        "send_msg",
      ),
    );
  }

  async uploadImage(payload: { filePath: string }) {
    const image = resolveWechatWorkImageFile(payload.filePath);
    return this.withAccessToken("media_upload", async (accessToken) => {
      const form = new FormData();
      const bytes = fs.readFileSync(image.filePath);
      form.append("media", new Blob([new Uint8Array(bytes)], { type: image.contentType }), image.fileName);
      let response: Response;
      try {
        response = await fetch(
          `${appConfig.wechatWorkApiBaseUrl}/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=image`,
          { method: "POST", body: form },
        );
      } catch (error) {
        throw new WechatWorkApiError(
          "media_upload",
          error instanceof Error ? error.message : "wechat work media_upload network error",
        );
      }
      const data = await readJson(response, "media_upload");
      if (!response.ok || Number(data.errcode || 0) !== 0 || !data.media_id) {
        throw new WechatWorkApiError("media_upload", `wechat work media_upload failed: ${data.errmsg || response.status}`, {
          errcode: finiteNumber(data.errcode),
          httpStatus: response.status,
          response: data,
        });
      }
      return {
        errcode: Number(data.errcode || 0),
        errmsg: String(data.errmsg || ""),
        type: String(data.type || "image"),
        media_id: String(data.media_id),
        created_at: data.created_at == null ? undefined : String(data.created_at),
      };
    });
  }

  async sendImage(payload: { externalUserId: string; openKfid: string; mediaId: string; msgid: string }) {
    return this.withAccessToken("send_msg", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; msgid?: string }>(
        `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
        {
          touser: requiredText(payload.externalUserId, "externalUserId"),
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          msgid: requiredText(payload.msgid, "msgid"),
          msgtype: "image",
          image: { media_id: requiredText(payload.mediaId, "mediaId") },
        },
        "send_msg",
      ),
    );
  }

  clearAccessToken() {
    this.accessTokenCache = null;
  }

  private async withAccessToken<T>(operation: string, action: (accessToken: string) => Promise<T>) {
    try {
      return await action(await this.getAccessToken());
    } catch (error) {
      if (!(error instanceof WechatWorkApiError)) throw error;
      throw error;
    }
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > now + 60_000) return this.accessTokenCache.token;
    const corpId = requiredText(appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID");
    const secret = requiredText(appConfig.wechatWorkSecret, "WECHAT_WORK_SECRET");
    const url = `${appConfig.wechatWorkApiBaseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new WechatWorkApiError("gettoken", "wechat work gettoken network error");
    }
    const data = await readJson(response, "gettoken");
    if (!response.ok || Number(data.errcode || 0) !== 0 || !data.access_token) {
      throw new WechatWorkApiError("gettoken", `wechat work gettoken failed: ${data.errmsg || response.status}`, {
        errcode: finiteNumber(data.errcode),
        httpStatus: response.status,
        response: data,
      });
    }
    this.accessTokenCache = {
      token: String(data.access_token),
      expiresAt: now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000,
    };
    return this.accessTokenCache.token;
  }

  private async postJson<T extends Record<string, unknown>>(
    pathAndQuery: string,
    body: Record<string, unknown>,
    operation: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${appConfig.wechatWorkApiBaseUrl}${pathAndQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new WechatWorkApiError(operation, error instanceof Error ? error.message : `wechat work ${operation} network error`);
    }
    const data = (await readJson(response, operation)) as T;
    if (!response.ok || Number(data.errcode || 0) !== 0) {
      throw new WechatWorkApiError(operation, `wechat work ${operation} failed: ${data.errmsg || response.status}`, {
        errcode: finiteNumber(data.errcode),
        httpStatus: response.status,
        response: data,
      });
    }
    return data;
  }
}

async function readJson(response: Response, operation: string): Promise<Record<string, any>> {
  try {
    return (await response.json()) as Record<string, any>;
  } catch {
    throw new WechatWorkApiError(operation, `wechat work ${operation} returned invalid JSON`, {
      httpStatus: response.status,
    });
  }
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

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardResponse(response);
    throw new WechatWorkApiError("media_get", "wechat work image exceeds the 2 MB inbound limit", {
      httpStatus: response.status,
      disposition: "permanent",
    });
  }
  if (!response.body) throw new Error("response body is missing");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      size += chunk.length;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new WechatWorkApiError("media_get", "wechat work image exceeds the 2 MB inbound limit", {
          httpStatus: response.status,
          disposition: "permanent",
        });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("response body is empty");
  return Buffer.concat(chunks, size);
}

async function discardResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort only. No response bytes are logged.
  }
}

function parseDownloadError(bytes: Buffer): Record<string, unknown> {
  try {
    const data = JSON.parse(bytes.toString("utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function looksLikeJson(bytes: Buffer) {
  const first = bytes.subarray(0, Math.min(bytes.length, 32)).toString("utf8").trimStart()[0];
  return first === "{" || first === "[";
}

function downloadApiError(errcode: number | undefined, httpStatus: number) {
  const response = {
    ...(errcode == null ? {} : { errcode }),
  };
  if (errcode === 40007 || errcode === 41006) {
    return new WechatWorkApiError("media_get", `wechat work media download permanently rejected (${errcode})`, {
      errcode,
      httpStatus,
      response,
      disposition: "permanent",
    });
  }
  if (errcode === 45009) {
    return new WechatWorkApiError("media_get", "wechat work media download is rate limited and requires delayed review", {
      errcode,
      httpStatus,
      response,
      disposition: "delayed_blocked",
      retryAfterSeconds: 60,
    });
  }
  return new WechatWorkApiError("media_get", "wechat work media download requires manual review", {
    errcode,
    httpStatus,
    response,
    disposition: "manual_review",
  });
}
