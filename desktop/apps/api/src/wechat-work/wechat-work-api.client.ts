import { BadRequestException, Injectable } from "@nestjs/common";
import { appConfig } from "../shared/app-config";

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

  constructor(
    operation: string,
    message: string,
    details: { errcode?: number; httpStatus?: number; response?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "WechatWorkApiError";
    this.operation = operation;
    this.errcode = details.errcode;
    this.httpStatus = details.httpStatus;
    this.response = details.response;
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
    } catch (error) {
      throw new WechatWorkApiError("gettoken", error instanceof Error ? error.message : "wechat work gettoken network error");
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
