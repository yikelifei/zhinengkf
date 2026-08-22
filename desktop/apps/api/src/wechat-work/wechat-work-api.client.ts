import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import fs from "node:fs";
import { appConfig } from "../shared/app-config";
import { MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES } from "./wechat-work-inbound-media";
import { resolveWechatWorkImageFile, resolveWechatWorkMaterialFile } from "./wechat-work-media";
import { WechatWorkAuthorizationService } from "./wechat-work-authorization.service";

export const WECHAT_WORK_API_RELAY_TOKEN_HEADER = "x-smart-kefu-wechat-api-relay-token";

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

export type WechatWorkCustomerProfile = {
  external_userid: string;
  nickname?: string;
  avatar?: string;
  gender?: number;
  unionid?: string;
};

export type WechatWorkExternalContactProfile = {
  external_userid: string;
  unionid?: string;
};

export type WechatWorkUpgradeServiceConfig = {
  errcode?: number;
  errmsg?: string;
  member_range?: {
    userid_list?: string[];
    department_id_list?: number[];
  };
  groupchat_range?: {
    chat_id_list?: string[];
  };
};

export type WechatWorkUserProfile = {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  alias?: string;
  avatar?: string;
  department?: number[];
  [key: string]: unknown;
};

export type WechatWorkCustomerServiceAccount = {
  open_kfid?: string;
  name?: string;
  avatar?: string;
  manage_privilege?: boolean;
};

export type WechatWorkCustomerServiceServicer = {
  userid?: string;
  status?: number;
};

export type WechatWorkCustomerServiceOperationResult = {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  department_id?: number;
};

export type WechatWorkCustomerServiceStatistic = {
  session_cnt?: number;
  customer_cnt?: number;
  customer_msg_cnt?: number;
  upgrade_service_customer_cnt?: number;
  ai_session_reply_cnt?: number;
  ai_transfer_rate?: number;
  ai_knowledge_hit_rate?: number;
  reply_rate?: number;
  first_reply_average_sec?: number;
  satisfaction_investgate_cnt?: number;
  satisfaction_participation_rate?: number;
  satisfied_rate?: number;
  middling_rate?: number;
  dissatisfied_rate?: number;
  upgrade_service_member_invite_cnt?: number;
  upgrade_service_member_customer_cnt?: number;
  upgrade_service_groupchat_invite_cnt?: number;
  upgrade_service_groupchat_customer_cnt?: number;
  msg_rejected_customer_cnt?: number;
};

export type WechatWorkCustomerServiceStatisticResponse = {
  errcode?: number;
  errmsg?: string;
  statistic_list?: Array<{
    stat_time?: number;
    statistic?: WechatWorkCustomerServiceStatistic;
  }>;
};

export type WechatWorkApplication = {
  agentid?: number;
  name?: string;
  square_logo_url?: string;
  [key: string]: unknown;
};

export type WechatWorkExternalContactWay = {
  errcode?: number;
  errmsg?: string;
  config_id?: string;
  qr_code?: string;
};

export type WechatWorkServiceState = {
  errcode?: number;
  errmsg?: string;
  service_state?: number;
  servicer_userid?: string;
  service_userid?: string;
  msg_code?: string;
};

export type WechatWorkSendMessagePayload = {
  externalUserId: string;
  openKfid: string;
  msgid: string;
  msgtype: string;
  message: Record<string, unknown>;
};

export type WechatWorkSendOnEventPayload = {
  code: string;
  msgid?: string;
  msgtype: "text" | "msgmenu";
  message: Record<string, unknown>;
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
  private externalContactAccessTokenCache: { token: string; expiresAt: number } | null = null;

  constructor(@Optional() private readonly authorization?: WechatWorkAuthorizationService) {}

  private fetchOfficialApi(pathAndQuery: string, init: RequestInit = {}) {
    const baseUrl = String(appConfig.wechatWorkApiBaseUrl || "").trim();
    const relayToken = String(appConfig.wechatWorkApiRelayToken || "").trim();
    const headers = new Headers(init.headers || {});
    if (relayToken) {
      const endpoint = new URL(baseUrl);
      const loopback = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost" || endpoint.hostname === "::1";
      if (endpoint.hostname === "qyapi.weixin.qq.com") {
        throw new WechatWorkApiError(
          "official_api_relay",
          "WECHAT_WORK_API_RELAY_TOKEN cannot be sent directly to qyapi.weixin.qq.com",
          { disposition: "permanent" },
        );
      }
      if (endpoint.protocol !== "https:" && !loopback) {
        throw new WechatWorkApiError(
          "official_api_relay",
          "WECHAT_WORK_API_BASE_URL must use HTTPS when the fixed-egress relay is enabled",
          { disposition: "permanent" },
        );
      }
      headers.set(WECHAT_WORK_API_RELAY_TOKEN_HEADER, relayToken);
    }
    return fetch(`${baseUrl}${pathAndQuery}`, { ...init, headers });
  }

  async syncMessages(payload: { token?: string; cursor?: string; limit?: number; openKfid?: string }) {
    const token = String(payload.token || "").trim();
    return this.withAccessToken("sync_msg", async (accessToken) => {
      const pathAndQuery = `/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`;
      const body = {
        cursor: String(payload.cursor || ""),
        limit: clampLimit(payload.limit),
        voice_format: 0,
        ...(payload.openKfid ? { open_kfid: payload.openKfid } : {}),
      };
      try {
        return await this.postJson<WechatWorkSyncResponse>(
          pathAndQuery,
          { ...(token ? { token } : {}), ...body },
          "sync_msg",
        );
      } catch (error) {
        if (!token || !(error instanceof WechatWorkApiError) || error.errcode !== 95012) throw error;
        return this.postJson<WechatWorkSyncResponse>(pathAndQuery, body, "sync_msg");
      }
    });
  }

  async getCustomerProfiles(externalUserIds: string[]) {
    const ids = [...new Set(
      externalUserIds
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )];
    if (!ids.length) throw new BadRequestException("externalUserIds is required");
    if (ids.length > 100) throw new BadRequestException("externalUserIds exceeds 100 customers");
    return this.withAccessToken("customer_batchget", (accessToken) =>
      this.postJson<{
        errcode?: number;
        errmsg?: string;
        customer_list?: WechatWorkCustomerProfile[];
        invalid_external_userid?: string[];
      }>(
        `/cgi-bin/kf/customer/batchget?access_token=${encodeURIComponent(accessToken)}`,
        {
          external_userid_list: ids,
          need_enter_session_context: 0,
        },
        "customer_batchget",
      ),
    );
  }

  async createCustomerContactWay(payload: { openKfid: string; scene: string }) {
    const scene = requiredText(payload.scene, "scene");
    if (!/^[0-9A-Za-z_-]{1,32}$/.test(scene)) {
      throw new BadRequestException("scene must be 1-32 characters using letters, numbers, underscore, or hyphen");
    }
    return this.withAccessToken("add_contact_way", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; url?: string }>(
        `/cgi-bin/kf/add_contact_way?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          scene,
        },
        "add_contact_way",
      ),
    );
  }

  async listExternalContactFollowUsers(secret?: string) {
    return this.withExternalContactAccessToken("externalcontact_get_follow_user_list", secret, (accessToken) =>
      this.getJson<{
        errcode?: number;
        errmsg?: string;
        follow_user?: string[];
      }>(
        `/cgi-bin/externalcontact/get_follow_user_list?access_token=${encodeURIComponent(accessToken)}`,
        "externalcontact_get_follow_user_list",
      ),
    );
  }

  async createExternalContactWay(payload: { memberUserId: string; remark: string; state: string }) {
    return this.withExternalContactAccessToken("externalcontact_add_contact_way", undefined, (accessToken) =>
      this.postJson<WechatWorkExternalContactWay>(
        `/cgi-bin/externalcontact/add_contact_way?access_token=${encodeURIComponent(accessToken)}`,
        {
          type: 1,
          scene: 2,
          remark: requiredText(payload.remark, "remark").slice(0, 30),
          skip_verify: true,
          state: requiredText(payload.state, "state").slice(0, 30),
          user: [requiredText(payload.memberUserId, "memberUserId")],
        },
        "externalcontact_add_contact_way",
      ),
    );
  }

  async getExternalContactWay(configId: string) {
    return this.withExternalContactAccessToken("externalcontact_get_contact_way", undefined, (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; contact_way?: WechatWorkExternalContactWay }>(
        `/cgi-bin/externalcontact/get_contact_way?access_token=${encodeURIComponent(accessToken)}`,
        { config_id: requiredText(configId, "configId") },
        "externalcontact_get_contact_way",
      ),
    );
  }

  async getExternalContact(externalUserId: string) {
    return this.withExternalContactAccessToken("externalcontact_get", undefined, (accessToken) =>
      this.getJson<{
        errcode?: number;
        errmsg?: string;
        external_contact?: WechatWorkExternalContactProfile;
      }>(
        `/cgi-bin/externalcontact/get?access_token=${encodeURIComponent(accessToken)}&external_userid=${encodeURIComponent(requiredText(externalUserId, "externalUserId"))}`,
        "externalcontact_get",
      ),
    );
  }

  async updateExternalContactWay(payload: { configId: string; memberUserId: string; remark: string; state: string }) {
    return this.withExternalContactAccessToken("externalcontact_update_contact_way", undefined, (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string }>(
        `/cgi-bin/externalcontact/update_contact_way?access_token=${encodeURIComponent(accessToken)}`,
        {
          config_id: requiredText(payload.configId, "configId"),
          type: 1,
          scene: 2,
          remark: requiredText(payload.remark, "remark").slice(0, 30),
          skip_verify: true,
          state: requiredText(payload.state, "state").slice(0, 30),
          user: [requiredText(payload.memberUserId, "memberUserId")],
        },
        "externalcontact_update_contact_way",
      ),
    );
  }

  async deleteExternalContactWay(configId: string) {
    return this.withExternalContactAccessToken("externalcontact_del_contact_way", undefined, (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string }>(
        `/cgi-bin/externalcontact/del_contact_way?access_token=${encodeURIComponent(accessToken)}`,
        { config_id: requiredText(configId, "configId") },
        "externalcontact_del_contact_way",
      ),
    );
  }

  async listCustomerServiceAccounts() {
    return this.withAccessToken("account_list", (accessToken) =>
      this.getJson<{
        errcode?: number;
        errmsg?: string;
        account_list?: WechatWorkCustomerServiceAccount[];
      }>(
        `/cgi-bin/kf/account/list?access_token=${encodeURIComponent(accessToken)}&offset=0&limit=100`,
        "account_list",
      ),
    );
  }

  async listApplications() {
    return this.withAccessToken("agent_list", (accessToken) =>
      this.getJson<{
        errcode?: number;
        errmsg?: string;
        agentlist?: WechatWorkApplication[];
      }>(
        `/cgi-bin/agent/list?access_token=${encodeURIComponent(accessToken)}`,
        "agent_list",
      ),
    );
  }

  async addCustomerServiceAccount(payload: { name: string; mediaId: string }) {
    return this.withAccessToken("account_add", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; open_kfid?: string }>(
        `/cgi-bin/kf/account/add?access_token=${encodeURIComponent(accessToken)}`,
        {
          name: requiredText(payload.name, "name"),
          media_id: requiredText(payload.mediaId, "mediaId"),
        },
        "account_add",
      ),
    );
  }

  async updateCustomerServiceAccount(payload: { openKfid: string; name?: string; mediaId?: string }) {
    const name = String(payload.name || "").trim();
    const mediaId = String(payload.mediaId || "").trim();
    if (!name && !mediaId) throw new BadRequestException("name or mediaId is required");
    return this.withAccessToken("account_update", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string }>(
        `/cgi-bin/kf/account/update?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          ...(name ? { name } : {}),
          ...(mediaId ? { media_id: mediaId } : {}),
        },
        "account_update",
      ),
    );
  }

  async deleteCustomerServiceAccount(openKfid: string) {
    return this.withAccessToken("account_delete", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string }>(
        `/cgi-bin/kf/account/del?access_token=${encodeURIComponent(accessToken)}`,
        { open_kfid: requiredText(openKfid, "openKfid") },
        "account_delete",
      ),
    );
  }

  async listCustomerServiceServicers(openKfid: string) {
    return this.withAccessToken("servicer_list", (accessToken) =>
      this.getJson<{
        errcode?: number;
        errmsg?: string;
        servicer_list?: WechatWorkCustomerServiceServicer[];
      }>(
        `/cgi-bin/kf/servicer/list?access_token=${encodeURIComponent(accessToken)}&open_kfid=${encodeURIComponent(requiredText(openKfid, "openKfid"))}`,
        "servicer_list",
      ),
    );
  }

  async getCustomerServiceCorpStatistic(payload: { openKfid: string; startTime: number; endTime: number }) {
    return this.withAccessToken("get_corp_statistic", (accessToken) =>
      this.postJson<WechatWorkCustomerServiceStatisticResponse>(
        `/cgi-bin/kf/get_corp_statistic?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          start_time: requiredUnixTimestamp(payload.startTime, "startTime"),
          end_time: requiredUnixTimestamp(payload.endTime, "endTime"),
        },
        "get_corp_statistic",
      ),
    );
  }

  async getCustomerServiceServicerStatistic(payload: {
    openKfid: string;
    startTime: number;
    endTime: number;
    servicerUserId?: string;
  }) {
    const servicerUserId = String(payload.servicerUserId || "").trim();
    return this.withAccessToken("get_servicer_statistic", (accessToken) =>
      this.postJson<WechatWorkCustomerServiceStatisticResponse>(
        `/cgi-bin/kf/get_servicer_statistic?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          ...(servicerUserId ? { servicer_userid: servicerUserId } : {}),
          start_time: requiredUnixTimestamp(payload.startTime, "startTime"),
          end_time: requiredUnixTimestamp(payload.endTime, "endTime"),
        },
        "get_servicer_statistic",
      ),
    );
  }

  async addCustomerServiceServicers(payload: { openKfid: string; userIds: string[] }) {
    return this.withAccessToken("servicer_add", (accessToken) =>
      this.postJson<{
        errcode?: number;
        errmsg?: string;
        result_list?: WechatWorkCustomerServiceOperationResult[];
      }>(
        `/cgi-bin/kf/servicer/add?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          userid_list: requiredTextList(payload.userIds, "userIds"),
        },
        "servicer_add",
      ),
    );
  }

  async deleteCustomerServiceServicers(payload: { openKfid: string; userIds: string[] }) {
    return this.withAccessToken("servicer_delete", (accessToken) =>
      this.postJson<{
        errcode?: number;
        errmsg?: string;
        result_list?: WechatWorkCustomerServiceOperationResult[];
      }>(
        `/cgi-bin/kf/servicer/del?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          userid_list: requiredTextList(payload.userIds, "userIds"),
        },
        "servicer_delete",
      ),
    );
  }

  async listCustomerServiceAccountsWithSecret(secretValue: string, corpIdValue?: string) {
    const corpId = requiredText(corpIdValue || appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID");
    const secret = requiredText(secretValue, "微信客服 Secret");
    const tokenPath = `/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    let response: Response;
    try {
      response = await this.fetchOfficialApi(tokenPath, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (error instanceof WechatWorkApiError) throw error;
      throw new WechatWorkApiError("gettoken", "企业微信凭证验证网络连接失败");
    }
    const tokenResponse = await readJson(response, "gettoken");
    if (!response.ok || Number(tokenResponse.errcode || 0) !== 0 || !tokenResponse.access_token) {
      throw new WechatWorkApiError("gettoken", `企业微信拒绝了当前 CorpID 与 Secret：${tokenResponse.errmsg || response.status}`, {
        errcode: finiteNumber(tokenResponse.errcode),
        httpStatus: response.status,
      });
    }
    return this.getJson<{
      errcode?: number;
      errmsg?: string;
      account_list?: WechatWorkCustomerServiceAccount[];
    }>(
      `/cgi-bin/kf/account/list?access_token=${encodeURIComponent(String(tokenResponse.access_token))}&offset=0&limit=100`,
      "account_list",
    );
  }

  async getUpgradeServiceConfig() {
    return this.withAccessToken("get_upgrade_service_config", (accessToken) =>
      this.getJson<WechatWorkUpgradeServiceConfig>(
        `/cgi-bin/kf/customer/get_upgrade_service_config?access_token=${encodeURIComponent(accessToken)}`,
        "get_upgrade_service_config",
      ),
    );
  }

  async getUserProfile(userId: string) {
    const userid = requiredText(userId, "userid");
    return this.withAccessToken("user_get", (accessToken) =>
      this.getJson<WechatWorkUserProfile>(
        `/cgi-bin/user/get?access_token=${encodeURIComponent(accessToken)}&userid=${encodeURIComponent(userid)}`,
        "user_get",
      ),
    );
  }

  async listVisibleUserIds(cursor = "") {
    return this.withAccessToken("user_list_id", (accessToken) =>
      this.postJson<{
        errcode?: number;
        errmsg?: string;
        next_cursor?: string;
        dept_user?: Array<{ userid?: string; department?: number }>;
      }>(
        `/cgi-bin/user/list_id?access_token=${encodeURIComponent(accessToken)}`,
        {
          cursor: String(cursor || ""),
          limit: 10_000,
        },
        "user_list_id",
      ),
    );
  }

  async upgradeCustomerToMember(payload: {
    openKfid: string;
    externalUserId: string;
    memberUserId: string;
    wording: string;
  }) {
    return this.withAccessToken("upgrade_service", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string }>(
        `/cgi-bin/kf/customer/upgrade_service?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          external_userid: requiredText(payload.externalUserId, "externalUserId"),
          type: 1,
          member: {
            userid: requiredText(payload.memberUserId, "memberUserId"),
            wording: requiredText(payload.wording, "wording"),
          },
        },
        "upgrade_service",
      ),
    );
  }

  async cancelCustomerUpgrade(payload: { openKfid: string; externalUserId: string }) {
    return this.withAccessToken("cancel_upgrade_service", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string }>(
        `/cgi-bin/kf/customer/cancel_upgrade_service?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          external_userid: requiredText(payload.externalUserId, "externalUserId"),
        },
        "cancel_upgrade_service",
      ),
    );
  }

  async getServiceState(payload: { openKfid: string; externalUserId: string }) {
    return this.withAccessToken("service_state_get", (accessToken) =>
      this.postJson<WechatWorkServiceState>(
        `/cgi-bin/kf/service_state/get?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          external_userid: requiredText(payload.externalUserId, "externalUserId"),
        },
        "service_state_get",
      ),
    );
  }

  async transferServiceState(payload: {
    openKfid: string;
    externalUserId: string;
    serviceState: number;
    servicerUserId?: string;
  }) {
    const serviceState = normalizeServiceState(payload.serviceState);
    return this.withAccessToken("service_state_trans", (accessToken) =>
      this.postJson<WechatWorkServiceState>(
        `/cgi-bin/kf/service_state/trans?access_token=${encodeURIComponent(accessToken)}`,
        {
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          external_userid: requiredText(payload.externalUserId, "externalUserId"),
          service_state: serviceState,
          ...(payload.servicerUserId ? { servicer_userid: requiredText(payload.servicerUserId, "servicerUserId") } : {}),
        },
        "service_state_trans",
      ),
    );
  }

  async downloadMedia(payload: { mediaId: string; maxBytes?: number }) {
    const mediaId = requiredText(payload.mediaId, "mediaId");
    const maxBytes = Number.isFinite(Number(payload.maxBytes))
      ? Math.max(1, Math.min(200 * 1024 * 1024, Math.floor(Number(payload.maxBytes))))
      : MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES;
    let tokenRefreshed = false;
    let transientAttempt = 0;

    while (true) {
      const accessToken = await this.getAccessToken();
      let response: Response;
      try {
        response = await this.fetchOfficialApi(
          `/cgi-bin/media/get?access_token=${encodeURIComponent(accessToken)}&media_id=${encodeURIComponent(mediaId)}`,
          { method: "GET", signal: AbortSignal.timeout(15_000) },
        );
      } catch (error) {
        if (error instanceof WechatWorkApiError) throw error;
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
        bytes = await readLimitedBytes(response, maxBytes);
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

  async downloadExternalContactQrCode(url: string) {
    let current = normalizeExternalContactQrUrl(url);
    for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
      let response: Response;
      try {
        response = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (error instanceof WechatWorkApiError) throw error;
        throw new WechatWorkApiError(
          "externalcontact_qr_download",
          error instanceof Error ? error.message : "external contact QR download network error",
        );
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await discardResponse(response);
        if (!location || redirectCount === 4) {
          throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR redirect is invalid", {
            httpStatus: response.status,
          });
        }
        current = normalizeExternalContactQrUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) {
        await discardResponse(response);
        throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR download failed", {
          httpStatus: response.status,
        });
      }
      normalizeExternalContactQrUrl(response.url || current);
      const bytes = await readExternalContactQrBytes(response, 2 * 1024 * 1024);
      return {
        bytes,
        contentType: String(response.headers.get("content-type") || "application/octet-stream"),
        size: bytes.length,
      };
    }
    throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR redirects exceeded the limit");
  }

  async sendMessage(payload: WechatWorkSendMessagePayload) {
    const msgtype = normalizeCustomerServiceMessageType(payload.msgtype);
    return this.withAccessToken("send_msg", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; msgid?: string }>(
        `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
        {
          touser: requiredText(payload.externalUserId, "externalUserId"),
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          msgid: requiredText(payload.msgid, "msgid"),
          msgtype,
          [msgtype]: normalizeMessageBody(payload.message, msgtype),
        },
        "send_msg",
      ),
    );
  }

  async sendTextOnEvent(payload: { code: string; text: string; msgid?: string }) {
    return this.sendMessageOnEvent({
      code: payload.code,
      msgid: payload.msgid,
      msgtype: "text",
      message: { content: requiredText(payload.text, "text") },
    });
  }

  async sendMessageOnEvent(payload: WechatWorkSendOnEventPayload) {
    const msgtype = normalizeEventMessageType(payload.msgtype);
    return this.withAccessToken("send_msg_on_event", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; msgid?: string }>(
        `/cgi-bin/kf/send_msg_on_event?access_token=${encodeURIComponent(accessToken)}`,
        {
          code: requiredText(payload.code, "code"),
          ...(payload.msgid ? { msgid: requiredText(payload.msgid, "msgid") } : {}),
          msgtype,
          [msgtype]: normalizeMessageBody(payload.message, msgtype),
        },
        "send_msg_on_event",
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
        response = await this.fetchOfficialApi(
          `/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=image`,
          { method: "POST", body: form, signal: AbortSignal.timeout(15_000) },
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
    this.authorization?.clearCorpAccessToken();
  }

  clearExternalContactAccessToken() {
    this.externalContactAccessTokenCache = null;
  }

  async uploadFile(payload: { filePath: string }) {
    const file = resolveWechatWorkMaterialFile(payload.filePath);
    return this.withAccessToken("media_upload", async (accessToken) => {
      const form = new FormData();
      const bytes = fs.readFileSync(file.filePath);
      form.append("media", new Blob([new Uint8Array(bytes)], { type: file.contentType }), file.fileName);
      let response: Response;
      try {
        response = await this.fetchOfficialApi(
          `/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=file`,
          { method: "POST", body: form, signal: AbortSignal.timeout(15_000) },
        );
      } catch (error) {
        if (error instanceof WechatWorkApiError) throw error;
        throw new WechatWorkApiError(
          "media_upload",
          error instanceof Error ? error.message : "wechat work file media_upload network error",
        );
      }
      const data = await readJson(response, "media_upload");
      if (!response.ok || Number(data.errcode || 0) !== 0 || !data.media_id) {
        throw new WechatWorkApiError("media_upload", `wechat work file media_upload failed: ${data.errmsg || response.status}`, {
          errcode: finiteNumber(data.errcode),
          httpStatus: response.status,
          response: data,
        });
      }
      return {
        errcode: Number(data.errcode || 0),
        errmsg: String(data.errmsg || ""),
        type: String(data.type || "file"),
        media_id: String(data.media_id),
        created_at: data.created_at == null ? undefined : String(data.created_at),
      };
    });
  }

  async sendFile(payload: { externalUserId: string; openKfid: string; mediaId: string; msgid: string }) {
    return this.withAccessToken("send_msg", (accessToken) =>
      this.postJson<{ errcode?: number; errmsg?: string; msgid?: string }>(
        `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
        {
          touser: requiredText(payload.externalUserId, "externalUserId"),
          open_kfid: requiredText(payload.openKfid, "openKfid"),
          msgid: requiredText(payload.msgid, "msgid"),
          msgtype: "file",
          file: { media_id: requiredText(payload.mediaId, "mediaId") },
        },
        "send_msg",
      ),
    );
  }

  private async withAccessToken<T>(operation: string, action: (accessToken: string) => Promise<T>) {
    try {
      return await action(await this.getAccessToken());
    } catch (error) {
      if (!(error instanceof WechatWorkApiError)) throw error;
      throw error;
    }
  }

  private async withExternalContactAccessToken<T>(
    operation: string,
    secret: string | undefined,
    action: (accessToken: string) => Promise<T>,
  ) {
    try {
      return await action(await this.getExternalContactAccessToken(secret));
    } catch (error) {
      if (!(error instanceof WechatWorkApiError)) throw error;
      throw error;
    }
  }

  private async getExternalContactAccessToken(secretOverride?: string) {
    const secret = requiredText(
      secretOverride || appConfig.wechatWorkExternalContactSecret || appConfig.wechatWorkSecret,
      "WECHAT_WORK_EXTERNAL_CONTACT_SECRET or WECHAT_WORK_SECRET",
    );
    if (secretOverride) {
      return (await this.fetchAccessToken(secret, "externalcontact_gettoken")).token;
    }
    const now = Date.now();
    const cached = this.externalContactAccessTokenCache;
    if (cached && cached.expiresAt > now + 60_000) {
      return cached.token;
    }
    this.externalContactAccessTokenCache = await this.fetchAccessToken(secret, "externalcontact_gettoken");
    return this.externalContactAccessTokenCache.token;
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > now + 60_000) return this.accessTokenCache.token;
    if (this.authorization?.hasActiveAuthorization()) {
      const token = await this.authorization.getPrimaryAuthorizedCorpAccessToken();
      this.accessTokenCache = { token, expiresAt: now + 60 * 60 * 1000 };
      return token;
    }
    const secret = requiredText(appConfig.wechatWorkSecret, "WECHAT_WORK_SECRET");
    this.accessTokenCache = await this.fetchAccessToken(secret, "gettoken");
    return this.accessTokenCache.token;
  }

  private async fetchAccessToken(secret: string, operation: string) {
    const now = Date.now();
    const corpId = requiredText(appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID");
    const pathAndQuery = `/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    let response: Response;
    try {
      response = await this.fetchOfficialApi(pathAndQuery, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (error instanceof WechatWorkApiError) throw error;
      throw new WechatWorkApiError(operation, `wechat work ${operation} network error`);
    }
    const data = await readJson(response, operation);
    if (!response.ok || Number(data.errcode || 0) !== 0 || !data.access_token) {
      throw new WechatWorkApiError(operation, `wechat work ${operation} failed: ${data.errmsg || response.status}`, {
        errcode: finiteNumber(data.errcode),
        httpStatus: response.status,
        response: data,
      });
    }
    return {
      token: String(data.access_token),
      expiresAt: now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000,
    };
  }

  private async postJson<T extends Record<string, unknown>>(
    pathAndQuery: string,
    body: Record<string, unknown>,
    operation: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchOfficialApi(pathAndQuery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
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

  private async getJson<T extends Record<string, unknown>>(
    pathAndQuery: string,
    operation: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchOfficialApi(pathAndQuery, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
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

function requiredTextList(values: unknown[], label: string) {
  const items = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!items.length) throw new BadRequestException(`${label} is required`);
  if (items.length > 100) throw new BadRequestException(`${label} exceeds 100 items`);
  return items;
}

function requiredUnixTimestamp(value: unknown, label: string) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new BadRequestException(`${label} must be a positive Unix timestamp`);
  }
  return timestamp;
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

function normalizeServiceState(value: unknown) {
  const state = Math.floor(Number(value));
  if (![1, 2, 3, 4].includes(state)) {
    throw new BadRequestException("serviceState must be one of 1, 2, 3, or 4");
  }
  return state;
}

function normalizeCustomerServiceMessageType(value: unknown) {
  const msgtype = String(value || "").trim();
  const allowed = new Set([
    "text",
    "image",
    "voice",
    "video",
    "file",
    "link",
    "miniprogram",
    "msgmenu",
    "location",
  ]);
  if (!allowed.has(msgtype)) throw new BadRequestException(`unsupported wechat work customer-service msgtype: ${msgtype || "missing"}`);
  return msgtype;
}

function normalizeExternalContactQrUrl(value: unknown) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new BadRequestException("external contact QR URL is invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  const trustedHost = hostname === "qpic.cn"
    || hostname.endsWith(".qpic.cn")
    || hostname === "weixin.qq.com"
    || hostname.endsWith(".weixin.qq.com");
  if (!["http:", "https:"].includes(parsed.protocol) || !trustedHost || parsed.username || parsed.password) {
    throw new BadRequestException("external contact QR URL is not trusted");
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeEventMessageType(value: unknown) {
  const msgtype = String(value || "").trim();
  if (!["text", "msgmenu"].includes(msgtype)) {
    throw new BadRequestException("send_msg_on_event only supports text or msgmenu");
  }
  return msgtype as "text" | "msgmenu";
}

function normalizeMessageBody(value: unknown, msgtype: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${msgtype} message body is required`);
  }
  return value as Record<string, unknown>;
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const limitLabel = Number.isInteger(maxBytes / (1024 * 1024))
    ? `${maxBytes / (1024 * 1024)} MB`
    : `${maxBytes} bytes`;
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardResponse(response);
    throw new WechatWorkApiError("media_get", `wechat work media exceeds the ${limitLabel} inbound limit`, {
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
        throw new WechatWorkApiError("media_get", `wechat work media exceeds the ${limitLabel} inbound limit`, {
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

async function readExternalContactQrBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardResponse(response);
    throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR exceeds the 2 MB limit", {
      httpStatus: response.status,
      disposition: "permanent",
    });
  }
  if (!response.body) throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR response body is missing");
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
        throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR exceeds the 2 MB limit", {
          httpStatus: response.status,
          disposition: "permanent",
        });
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new WechatWorkApiError("externalcontact_qr_download", "external contact QR response body is empty");
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
