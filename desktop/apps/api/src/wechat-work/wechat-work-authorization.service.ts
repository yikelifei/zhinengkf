import { BadRequestException, Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../shared/app-config";
import { WechatWorkSuiteApiClient } from "./wechat-work-suite-api.client";

type CallbackQuery = {
  msg_signature?: string;
  signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
  auth_code?: string;
  state?: string;
};

type EncryptedValue = {
  iv: string;
  tag: string;
  ciphertext: string;
};

type AuthorizationFlow = {
  id: string;
  stateHash: string;
  status: "pending" | "exchanging" | "completed" | "failed" | "expired";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  corpId?: string;
  error?: string;
};

type AuthorizedCorp = {
  corpId: string;
  corpName: string;
  corpType: string;
  logoUrl: string;
  status: "active" | "revoked";
  permanentCode: EncryptedValue;
  authorizedAt: string;
  updatedAt: string;
};

type AuthorizationStore = {
  schema: "smart_kefu_wechat_work_suite_authorization_v1";
  suiteTicket?: EncryptedValue;
  suiteTicketUpdatedAt?: string;
  flows: AuthorizationFlow[];
  authorizations: AuthorizedCorp[];
  processedAuthCodes: Array<{ hash: string; corpId: string; processedAt: string }>;
};

const EMPTY_STORE: AuthorizationStore = {
  schema: "smart_kefu_wechat_work_suite_authorization_v1",
  flows: [],
  authorizations: [],
  processedAuthCodes: [],
};
const INSTALL_STATE_TTL_MS = 10 * 60 * 1000;
const SUITE_TICKET_FRESH_MS = 30 * 60 * 1000;

@Injectable()
export class WechatWorkAuthorizationService {
  private corpTokenCache: { corpId: string; token: string; expiresAt: number } | null = null;
  private readonly authCodeExchanges = new Map<string, Promise<{ corpId: string; corpName: string; status: "active" }>>();

  constructor(private readonly suiteApi: WechatWorkSuiteApiClient) {}

  getStatus() {
    const checks = suiteConfigurationChecks();
    let store = EMPTY_STORE;
    let storeError = "";
    try {
      store = this.readStore();
      if (store.suiteTicket) void decryptValue(store.suiteTicket);
      for (const authorization of store.authorizations) void decryptValue(authorization.permanentCode);
    } catch (error) {
      storeError = safeError(error);
    }
    const now = Date.now();
    const ticketUpdatedAt = Date.parse(String(store.suiteTicketUpdatedAt || ""));
    const ticketFresh = Boolean(store.suiteTicket && Number.isFinite(ticketUpdatedAt) && now - ticketUpdatedAt < SUITE_TICKET_FRESH_MS);
    const flows = store.flows
      .map((flow) => normalizeExpiredFlow(flow, now))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 10)
      .map(publicFlow);
    const authorizations = store.authorizations
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ permanentCode: _secret, ...authorization }) => authorization);
    const configured = checks.every((item) => item.ok);
    return {
      schema: "smart_kefu_wechat_work_suite_authorization_status_v1" as const,
      configured,
      readyForInstall: configured && ticketFresh && !storeError,
      checks: [
        ...checks,
        {
          key: "suite_ticket",
          ok: ticketFresh,
          detail: ticketFresh
            ? `最近接收于 ${store.suiteTicketUpdatedAt}`
            : store.suiteTicket
              ? "suite_ticket 已超过 30 分钟，请检查指令回调"
              : "尚未收到企业微信推送的 suite_ticket",
        },
        ...(storeError ? [{ key: "encrypted_store", ok: false, detail: storeError }] : []),
      ],
      callbacks: {
        command: `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/suite/callback`,
        authorization: `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/authorization/callback`,
      },
      latestFlow: flows[0] || null,
      flows,
      authorizations,
      activeAuthorizationCount: authorizations.filter((item) => item.status === "active").length,
      credentialMode: authorizations.some((item) => item.status === "active")
        ? "suite_authorization"
        : appConfig.wechatWorkSecret
          ? "static_secret"
          : "unavailable",
    };
  }

  hasActiveAuthorization() {
    try {
      return this.readStore().authorizations.some((item) => item.status === "active");
    } catch {
      return false;
    }
  }

  async createInstallLink() {
    assertSuiteConfiguration();
    const store = this.readStore();
    const suiteTicket = this.requireFreshSuiteTicket(store);
    const preAuth = await this.suiteApi.getPreAuthCode(suiteTicket);
    const state = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = new Date(now + Math.min(INSTALL_STATE_TTL_MS, preAuth.expiresIn * 1000)).toISOString();
    const flow: AuthorizationFlow = {
      id: `wwauth_${crypto.randomUUID()}`,
      stateHash: hashState(state),
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt,
    };
    const currentStore = this.readStore();
    currentStore.flows = [flow, ...currentStore.flows].slice(0, 50);
    this.writeStore(currentStore);
    const installUrl = new URL(appConfig.wechatWorkSuiteInstallBaseUrl);
    installUrl.searchParams.set("suite_id", appConfig.wechatWorkSuiteId);
    installUrl.searchParams.set("pre_auth_code", preAuth.preAuthCode);
    installUrl.searchParams.set("redirect_uri", `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/authorization/callback`);
    installUrl.searchParams.set("state", state);
    return {
      flow: publicFlow(flow),
      installUrl: installUrl.toString(),
    };
  }

  async handleAuthorizationRedirect(query: CallbackQuery) {
    const authCode = requiredText(query.auth_code, "auth_code");
    const state = requiredText(query.state, "state");
    const store = this.readStore();
    const flow = store.flows.find((item) => constantTimeEqual(item.stateHash, hashState(state)));
    if (!flow) throw new BadRequestException("invalid or unknown authorization state");
    if (flow.status !== "pending") throw new BadRequestException("authorization state was already consumed");
    if (Date.parse(flow.expiresAt) <= Date.now()) {
      flow.status = "expired";
      this.writeStore(store);
      throw new BadRequestException("authorization state expired");
    }
    flow.status = "exchanging";
    this.writeStore(store);
    try {
      const authorization = await this.exchangeAuthorization(authCode, flow.id);
      return authorization;
    } catch (error) {
      const failedStore = this.readStore();
      const failedFlow = failedStore.flows.find((item) => item.id === flow.id);
      if (failedFlow) {
        failedFlow.status = "failed";
        failedFlow.error = safeError(error);
        this.writeStore(failedStore);
      }
      throw error;
    }
  }

  verifySuiteCallback(query: CallbackQuery) {
    const encrypted = requiredText(query.echostr, "echostr");
    this.verifySuiteSignature(query, encrypted);
    const decrypted = decryptWechatWorkMessage(encrypted, appConfig.wechatWorkSuiteEncodingAesKey);
    assertReceiveId(decrypted.receiveId, appConfig.wechatWorkSuiteId);
    return decrypted.message;
  }

  async handleSuiteCallback(query: CallbackQuery, body: unknown) {
    const encrypted = extractEncryptedBody(body);
    this.verifySuiteSignature(query, encrypted);
    const decrypted = decryptWechatWorkMessage(encrypted, appConfig.wechatWorkSuiteEncodingAesKey);
    assertReceiveId(decrypted.receiveId, appConfig.wechatWorkSuiteId);
    const message = parseXml(decrypted.message);
    const infoType = String(message.InfoType || "");
    if (infoType === "suite_ticket") {
      const ticket = requiredText(message.SuiteTicket, "SuiteTicket");
      const store = this.readStore();
      store.suiteTicket = encryptValue(ticket);
      store.suiteTicketUpdatedAt = new Date().toISOString();
      this.writeStore(store);
      this.suiteApi.clearSuiteToken();
      return "success";
    }
    if (infoType === "create_auth" && message.AuthCode) {
      await this.exchangeAuthorization(String(message.AuthCode));
      return "success";
    }
    if (infoType === "cancel_auth" && message.AuthCorpId) {
      const store = this.readStore();
      const authorization = store.authorizations.find((item) => item.corpId === String(message.AuthCorpId));
      if (authorization) {
        authorization.status = "revoked";
        authorization.updatedAt = new Date().toISOString();
        this.writeStore(store);
        if (this.corpTokenCache?.corpId === authorization.corpId) this.corpTokenCache = null;
      }
    }
    return "success";
  }

  async getPrimaryAuthorizedCorpAccessToken() {
    const store = this.readStore();
    const authorization = store.authorizations
      .filter((item) => item.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!authorization) throw new BadRequestException("no active WeCom suite authorization");
    const now = Date.now();
    if (
      this.corpTokenCache &&
      this.corpTokenCache.corpId === authorization.corpId &&
      this.corpTokenCache.expiresAt > now + 60_000
    ) {
      return this.corpTokenCache.token;
    }
    const suiteTicket = this.requireFreshSuiteTicket(store);
    const result = await this.suiteApi.getCorpAccessToken(
      suiteTicket,
      authorization.corpId,
      decryptValue(authorization.permanentCode),
    );
    this.corpTokenCache = {
      corpId: authorization.corpId,
      token: result.accessToken,
      expiresAt: now + Math.max(60, result.expiresIn - 120) * 1000,
    };
    return result.accessToken;
  }

  clearCorpAccessToken() {
    this.corpTokenCache = null;
  }

  private async exchangeAuthorization(authCode: string, flowId?: string) {
    const codeHash = hashState(requiredText(authCode, "auth_code"));
    const alreadyProcessed = this.readStore().processedAuthCodes.find((item) => item.hash === codeHash);
    if (alreadyProcessed) {
      const authorization = this.readStore().authorizations.find((item) => item.corpId === alreadyProcessed.corpId);
      if (authorization) {
        this.completeFlow(flowId, authorization.corpId);
        return { corpId: authorization.corpId, corpName: authorization.corpName, status: "active" as const };
      }
    }
    const inflight = this.authCodeExchanges.get(codeHash);
    if (inflight) {
      const result = await inflight;
      this.completeFlow(flowId, result.corpId);
      return result;
    }
    const exchange = this.runAuthorizationExchange(authCode, codeHash, flowId);
    this.authCodeExchanges.set(codeHash, exchange);
    try {
      return await exchange;
    } finally {
      this.authCodeExchanges.delete(codeHash);
    }
  }

  private async runAuthorizationExchange(authCode: string, codeHash: string, flowId?: string) {
    const store = this.readStore();
    const result = await this.suiteApi.getPermanentCode(this.requireFreshSuiteTicket(store), authCode);
    const corpId = requiredText(result.auth_corp_info?.corpid, "auth_corp_info.corpid");
    const now = new Date().toISOString();
    const existing = store.authorizations.find((item) => item.corpId === corpId);
    const authorization: AuthorizedCorp = {
      corpId,
      corpName: String(result.auth_corp_info?.corp_name || corpId),
      corpType: String(result.auth_corp_info?.corp_type || ""),
      logoUrl: String(result.auth_corp_info?.corp_square_logo_url || ""),
      status: "active",
      permanentCode: encryptValue(requiredText(result.permanent_code, "permanent_code")),
      authorizedAt: existing?.authorizedAt || now,
      updatedAt: now,
    };
    store.authorizations = [authorization, ...store.authorizations.filter((item) => item.corpId !== corpId)];
    store.processedAuthCodes = [
      { hash: codeHash, corpId, processedAt: now },
      ...store.processedAuthCodes.filter((item) => item.hash !== codeHash),
    ].slice(0, 100);
    const flow = flowId
      ? store.flows.find((item) => item.id === flowId)
      : store.flows.find((item) => item.status === "pending" || item.status === "exchanging");
    if (flow) {
      flow.status = "completed";
      flow.completedAt = now;
      flow.corpId = corpId;
      delete flow.error;
    }
    this.writeStore(store);
    this.corpTokenCache = null;
    return { corpId, corpName: authorization.corpName, status: "active" as const };
  }

  private completeFlow(flowId: string | undefined, corpId: string) {
    if (!flowId) return;
    const store = this.readStore();
    const flow = store.flows.find((item) => item.id === flowId);
    if (!flow || flow.status === "completed") return;
    flow.status = "completed";
    flow.completedAt = new Date().toISOString();
    flow.corpId = corpId;
    delete flow.error;
    this.writeStore(store);
  }

  private requireFreshSuiteTicket(store: AuthorizationStore) {
    if (!store.suiteTicket || !store.suiteTicketUpdatedAt) {
      throw new BadRequestException("suite_ticket has not been received");
    }
    if (Date.now() - Date.parse(store.suiteTicketUpdatedAt) >= SUITE_TICKET_FRESH_MS) {
      throw new BadRequestException("suite_ticket is stale; check the WeCom command callback");
    }
    return decryptValue(store.suiteTicket);
  }

  private verifySuiteSignature(query: CallbackQuery, encrypted: string) {
    const signature = requiredText(query.msg_signature || query.signature, "msg_signature");
    const timestamp = requiredText(query.timestamp, "timestamp");
    const nonce = requiredText(query.nonce, "nonce");
    const expected = crypto
      .createHash("sha1")
      .update([appConfig.wechatWorkSuiteToken, timestamp, nonce, encrypted].sort().join(""))
      .digest("hex");
    if (!constantTimeEqual(signature, expected)) throw new BadRequestException("invalid suite callback signature");
  }

  private readStore(): AuthorizationStore {
    if (!fs.existsSync(appConfig.wechatWorkSuiteAuthorizationStoreFile)) return structuredClone(EMPTY_STORE);
    const stat = fs.lstatSync(appConfig.wechatWorkSuiteAuthorizationStoreFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new BadRequestException("unsafe authorization store target");
    const parsed = JSON.parse(fs.readFileSync(appConfig.wechatWorkSuiteAuthorizationStoreFile, "utf8")) as AuthorizationStore;
    if (parsed.schema !== EMPTY_STORE.schema) throw new BadRequestException("unsupported authorization store schema");
    return {
      ...parsed,
      flows: Array.isArray(parsed.flows) ? parsed.flows : [],
      authorizations: Array.isArray(parsed.authorizations) ? parsed.authorizations : [],
      processedAuthCodes: Array.isArray(parsed.processedAuthCodes) ? parsed.processedAuthCodes : [],
    };
  }

  private writeStore(store: AuthorizationStore) {
    const filePath = appConfig.wechatWorkSuiteAuthorizationStoreFile;
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temporaryPath, filePath);
      try { fs.chmodSync(filePath, 0o600); } catch {}
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    }
  }
}

function suiteConfigurationChecks() {
  return [
    configCheck("suite_id", appConfig.wechatWorkSuiteId),
    configCheck("suite_secret", appConfig.wechatWorkSuiteSecret),
    configCheck("suite_token", appConfig.wechatWorkSuiteToken),
    {
      key: "suite_encoding_aes_key",
      ok: validEncodingAesKey(appConfig.wechatWorkSuiteEncodingAesKey),
      detail: validEncodingAesKey(appConfig.wechatWorkSuiteEncodingAesKey) ? "已配置" : "缺少或格式错误",
    },
    {
      key: "encrypted_store_key",
      ok: Boolean(storageKey()),
      detail: storageKey() ? "32 字节密钥已配置" : "WECHAT_WORK_SUITE_STORAGE_KEY 缺少或格式错误",
    },
    {
      key: "public_https_url",
      ok: isPublicHttpsUrl(appConfig.customerServicePublicBaseUrl),
      detail: isPublicHttpsUrl(appConfig.customerServicePublicBaseUrl) ? "公网 HTTPS 地址已配置" : "需要公网 HTTPS 地址",
    },
    {
      key: "suite_api_base_url",
      ok: isHttpsUrl(appConfig.wechatWorkSuiteApiBaseUrl),
      detail: isHttpsUrl(appConfig.wechatWorkSuiteApiBaseUrl) ? "企业微信服务商 API 使用 HTTPS" : "服务商 API 必须使用 HTTPS",
    },
    {
      key: "official_install_url",
      ok: isOfficialInstallUrl(appConfig.wechatWorkSuiteInstallBaseUrl),
      detail: isOfficialInstallUrl(appConfig.wechatWorkSuiteInstallBaseUrl)
        ? "使用企业微信官方安装域名"
        : "安装页必须使用 https://open.work.weixin.qq.com",
    },
  ];
}

function assertSuiteConfiguration() {
  const missing = suiteConfigurationChecks().filter((item) => !item.ok).map((item) => item.key);
  if (missing.length) throw new BadRequestException(`WeCom suite authorization is not configured: ${missing.join(", ")}`);
}

function configCheck(key: string, value: string) {
  const ok = Boolean(String(value || "").trim());
  return { key, ok, detail: ok ? "已配置" : "缺少配置" };
}

function storageKey() {
  const raw = String(appConfig.wechatWorkSuiteStorageKey || "").trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function encryptValue(value: string): EncryptedValue {
  const key = storageKey();
  if (!key) throw new BadRequestException("WECHAT_WORK_SUITE_STORAGE_KEY must be 32-byte base64 or 64-character hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decryptValue(value: EncryptedValue) {
  const key = storageKey();
  if (!key) throw new BadRequestException("WECHAT_WORK_SUITE_STORAGE_KEY is unavailable");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new BadRequestException("encrypted WeCom authorization store cannot be decrypted");
  }
}

function decryptWechatWorkMessage(encrypted: string, encodingAesKey: string) {
  if (!validEncodingAesKey(encodingAesKey)) throw new BadRequestException("invalid suite EncodingAESKey");
  try {
    const key = Buffer.from(`${encodingAesKey}=`, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
    const bytes = pkcs7Unpad(padded);
    const length = bytes.readUInt32BE(16);
    const messageEnd = 20 + length;
    if (length <= 0 || messageEnd > bytes.length) throw new Error("invalid message length");
    return {
      message: bytes.subarray(20, messageEnd).toString("utf8"),
      receiveId: bytes.subarray(messageEnd).toString("utf8"),
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("invalid encrypted suite callback payload");
  }
}

function pkcs7Unpad(value: Buffer) {
  const padding = value[value.length - 1];
  if (!padding || padding > 32 || padding > value.length) throw new Error("invalid PKCS7 padding");
  for (let index = value.length - padding; index < value.length; index += 1) {
    if (value[index] !== padding) throw new Error("invalid PKCS7 padding");
  }
  return value.subarray(0, value.length - padding);
}

function extractEncryptedBody(body: unknown) {
  if (typeof body === "string") {
    return requiredText(parseXml(body).Encrypt, "Encrypt");
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    return requiredText(record.Encrypt || record.encrypt, "Encrypt");
  }
  throw new BadRequestException("encrypted callback body is required");
}

function parseXml(xml: string) {
  const output: Record<string, string> = {};
  const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) output[match[1]] = match[2] !== undefined ? match[2] : String(match[3] || "").trim();
  return output;
}

function assertReceiveId(receiveId: string, expected: string) {
  if (!expected || !constantTimeEqual(receiveId, expected)) throw new BadRequestException("suite callback receive id mismatch");
}

function requiredText(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) throw new BadRequestException(`${label} is required`);
  return text;
}

function validEncodingAesKey(value: string) {
  const text = String(value || "").trim();
  if (text.length !== 43) return false;
  try { return Buffer.from(`${text}=`, "base64").length === 32; } catch { return false; }
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function isOfficialInstallUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "open.work.weixin.qq.com";
  } catch {
    return false;
  }
}

function hashState(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeExpiredFlow(flow: AuthorizationFlow, now: number) {
  if (flow.status === "pending" && Date.parse(flow.expiresAt) <= now) return { ...flow, status: "expired" as const };
  return flow;
}

function publicFlow({ stateHash: _stateHash, ...flow }: AuthorizationFlow) {
  return flow;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}
