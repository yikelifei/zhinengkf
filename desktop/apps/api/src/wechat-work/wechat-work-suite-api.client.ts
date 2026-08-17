import { BadGatewayException, Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { appConfig } from "../shared/app-config";

type SuiteTokenResponse = {
  errcode?: number;
  errmsg?: string;
  suite_access_token?: string;
  expires_in?: number;
};

type PreAuthCodeResponse = {
  errcode?: number;
  errmsg?: string;
  pre_auth_code?: string;
  expires_in?: number;
};

export type PermanentCodeResponse = {
  errcode?: number;
  errmsg?: string;
  permanent_code?: string;
  auth_corp_info?: {
    corpid?: string;
    corp_name?: string;
    corp_type?: string;
    corp_square_logo_url?: string;
  };
};

@Injectable()
export class WechatWorkSuiteApiClient {
  private suiteTokenCache: { token: string; expiresAt: number; ticketDigest: string } | null = null;

  async getPreAuthCode(suiteTicket: string) {
    const suiteAccessToken = await this.getSuiteAccessToken(suiteTicket);
    const data = await this.requestJson<PreAuthCodeResponse>(
      `${appConfig.wechatWorkSuiteApiBaseUrl}/cgi-bin/service/get_pre_auth_code?suite_access_token=${encodeURIComponent(suiteAccessToken)}`,
      { method: "GET" },
      "get_pre_auth_code",
    );
    if (!data.pre_auth_code) throw new BadGatewayException("wechat work get_pre_auth_code returned no pre_auth_code");
    return {
      preAuthCode: String(data.pre_auth_code),
      expiresIn: Math.max(60, Number(data.expires_in || 1200)),
    };
  }

  async getPermanentCode(suiteTicket: string, authCode: string) {
    const suiteAccessToken = await this.getSuiteAccessToken(suiteTicket);
    const data = await this.requestJson<PermanentCodeResponse>(
      `${appConfig.wechatWorkSuiteApiBaseUrl}/cgi-bin/service/get_permanent_code?suite_access_token=${encodeURIComponent(suiteAccessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth_code: requiredText(authCode, "auth_code") }),
      },
      "get_permanent_code",
    );
    if (!data.permanent_code || !data.auth_corp_info?.corpid) {
      throw new BadGatewayException("wechat work get_permanent_code returned incomplete authorization");
    }
    return data;
  }

  async getCorpAccessToken(suiteTicket: string, authCorpId: string, permanentCode: string) {
    const suiteAccessToken = await this.getSuiteAccessToken(suiteTicket);
    const data = await this.requestJson<{
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    }>(
      `${appConfig.wechatWorkSuiteApiBaseUrl}/cgi-bin/service/get_corp_token?suite_access_token=${encodeURIComponent(suiteAccessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth_corpid: requiredText(authCorpId, "auth_corpid"),
          permanent_code: requiredText(permanentCode, "permanent_code"),
        }),
      },
      "get_corp_token",
    );
    if (!data.access_token) throw new BadGatewayException("wechat work get_corp_token returned no access_token");
    return {
      accessToken: String(data.access_token),
      expiresIn: Math.max(60, Number(data.expires_in || 7200)),
    };
  }

  clearSuiteToken() {
    this.suiteTokenCache = null;
  }

  private async getSuiteAccessToken(suiteTicket: string) {
    const ticket = requiredText(suiteTicket, "suite_ticket");
    const ticketDigest = crypto.createHash("sha256").update(ticket).digest("hex");
    const now = Date.now();
    if (
      this.suiteTokenCache &&
      this.suiteTokenCache.ticketDigest === ticketDigest &&
      this.suiteTokenCache.expiresAt > now + 60_000
    ) {
      return this.suiteTokenCache.token;
    }
    const data = await this.requestJson<SuiteTokenResponse>(
      `${appConfig.wechatWorkSuiteApiBaseUrl}/cgi-bin/service/get_suite_token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suite_id: requiredText(appConfig.wechatWorkSuiteId, "WECHAT_WORK_SUITE_ID"),
          suite_secret: requiredText(appConfig.wechatWorkSuiteSecret, "WECHAT_WORK_SUITE_SECRET"),
          suite_ticket: ticket,
        }),
      },
      "get_suite_token",
    );
    if (!data.suite_access_token) {
      throw new BadGatewayException("wechat work get_suite_token returned no suite_access_token");
    }
    this.suiteTokenCache = {
      token: String(data.suite_access_token),
      expiresAt: now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000,
      ticketDigest,
    };
    return this.suiteTokenCache.token;
  }

  private async requestJson<T extends { errcode?: number; errmsg?: string }>(
    url: string,
    init: RequestInit,
    operation: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new BadGatewayException(`wechat work ${operation} network error`);
    }
    let data: T;
    try {
      data = (await response.json()) as T;
    } catch {
      throw new BadGatewayException(`wechat work ${operation} returned invalid JSON`);
    }
    if (!response.ok || Number(data.errcode || 0) !== 0) {
      throw new BadGatewayException(`wechat work ${operation} failed: ${data.errmsg || response.status}`);
    }
    return data;
  }
}

function requiredText(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) throw new BadGatewayException(`${label} is required`);
  return text;
}
