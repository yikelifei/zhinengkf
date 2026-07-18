import { appConfig } from "../shared/app-config";

export type WechatWorkReadinessStatus = "ready" | "blocked" | "missing";

type ReadinessCheck = {
  key: string;
  status: WechatWorkReadinessStatus;
  detail: string;
  external: boolean;
};

export function buildWechatWorkProductionReadiness(metrics: { mappedAccounts: number; auditRecords: number }) {
  const publicCallbackConfigured = isPublicHttpsBaseUrl(appConfig.customerServicePublicBaseUrl);
  const localChecks: ReadinessCheck[] = [
    presentCheck("corp_id", appConfig.wechatWorkCorpId, "WECHAT_WORK_CORP_ID"),
    presentCheck("customer_service_secret", appConfig.wechatWorkSecret, "WECHAT_WORK_SECRET"),
    presentCheck("callback_token", appConfig.wechatWorkToken, "WECHAT_WORK_TOKEN"),
    {
      key: "encoding_aes_key",
      status: validEncodingAesKey(appConfig.wechatWorkEncodingAesKey) ? "ready" : "missing",
      detail: validEncodingAesKey(appConfig.wechatWorkEncodingAesKey)
        ? "43-character key decodes to 32 bytes"
        : "WECHAT_WORK_ENCODING_AES_KEY is missing or invalid",
      external: false,
    },
    {
      key: "public_callback_url",
      status: publicCallbackConfigured ? "ready" : "missing",
      detail: publicCallbackConfigured
        ? `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/callback`
        : "CUSTOMER_SERVICE_PUBLIC_BASE_URL must be a non-local public HTTPS URL",
      external: false,
    },
    {
      key: "official_api_base_url",
      status: isHttpsUrl(appConfig.wechatWorkApiBaseUrl) ? "ready" : "missing",
      detail: isHttpsUrl(appConfig.wechatWorkApiBaseUrl)
        ? "HTTPS API base configured"
        : "WECHAT_WORK_API_BASE_URL must use HTTPS",
      external: false,
    },
    {
      key: "official_send_adapter",
      status: appConfig.wechatSendAdapter === "wechat_work_kf" ? "ready" : "missing",
      detail: appConfig.wechatSendAdapter === "wechat_work_kf"
        ? "work_wechat identities route through wechat_work_kf"
        : "WECHAT_SEND_ADAPTER must be wechat_work_kf",
      external: false,
    },
    {
      key: "persistence",
      status: appConfig.useLocalStore ? "ready" : "missing",
      detail: appConfig.useLocalStore ? "local_store enabled" : "wechat-work Prisma persistence is not implemented",
      external: false,
    },
  ];

  const externalChecks: ReadinessCheck[] = [
    {
      key: "public_https_reachability",
      status: publicCallbackConfigured ? "blocked" : "missing",
      detail: publicCallbackConfigured
        ? "offline preflight does not contact the public callback URL"
        : "configure a public HTTPS callback URL before external verification",
      external: true,
    },
    {
      key: "callback_registration",
      status: publicCallbackConfigured ? "blocked" : "missing",
      detail: "verify URL, Token and EncodingAESKey in the WeCom admin console",
      external: true,
    },
    {
      key: "customer_service_api_permissions",
      status: "blocked",
      detail: "confirm the customer-service account is API-managed and has receive/send permissions",
      external: true,
    },
    {
      key: "live_callback_sync_and_send",
      status: "blocked",
      detail: "requires a controlled production callback, sync_msg and send_msg acceptance run",
      external: true,
    },
  ];

  const localStatus = aggregateStatus(localChecks);
  const externalStatus = aggregateStatus(externalChecks);
  const status: WechatWorkReadinessStatus = localStatus === "missing" ? "missing" : externalStatus;

  return {
    schema: "smart_kefu_wechat_work_readiness_v1",
    mode: "offline_preflight",
    networkCalls: false,
    status,
    productionReady: status === "ready",
    local: {
      status: localStatus,
      ready: localStatus === "ready",
      checks: localChecks,
    },
    external: {
      status: externalStatus,
      ready: externalStatus === "ready",
      checks: externalChecks,
      blockers: externalChecks.filter((item) => item.status !== "ready").map((item) => item.key),
    },
    callback: {
      path: "/api/wechat-work/callback",
      url: `${appConfig.customerServicePublicBaseUrl}/api/wechat-work/callback`,
      publicHttpsFormatReady: publicCallbackConfigured,
    },
    identityPolicy: {
      channel: "work_wechat",
      accountPlatform: "wechat_work_kf",
      adapter: "wechat_work_kf",
      requiresPersistentBinding: true,
      callerSelectableAdapter: false,
    },
    codeContracts: [
      "encrypted_callback_signature_and_receive_id",
      "persistent_msgid_and_callback_deduplication",
      "work_wechat_identity_bound_send",
      "sync_send_retry_and_async_failure_audit",
    ],
    metrics: {
      mappedAccounts: Math.max(0, Number(metrics.mappedAccounts || 0)),
      auditRecords: Math.max(0, Number(metrics.auditRecords || 0)),
    },
  };
}

function presentCheck(key: string, value: unknown, env: string): ReadinessCheck {
  const configured = Boolean(String(value || "").trim());
  return {
    key,
    status: configured ? "ready" : "missing",
    detail: configured ? "configured" : `${env} is missing`,
    external: false,
  };
}

function aggregateStatus(checks: ReadinessCheck[]): WechatWorkReadinessStatus {
  if (checks.some((item) => item.status === "missing")) return "missing";
  if (checks.some((item) => item.status === "blocked")) return "blocked";
  return "ready";
}

function isHttpsUrl(value: string) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

function isPublicHttpsBaseUrl(value: string) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return false;
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return hostname.includes(".");
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((item) => item < 0 || item > 255)) return false;
    if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) return false;
    if (octets[0] === 169 && octets[1] === 254) return false;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
    if (octets[0] === 192 && octets[1] === 168) return false;
    return true;
  } catch {
    return false;
  }
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
