import { timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const READINESS_SCHEMA = "smart_kefu_wechat_work_readiness_v1";

export const WECHAT_WORK_READINESS_TOKEN_HEADER = "x-wechat-work-readiness-token";

export type WechatWorkReadinessSource = {
  kind: "desktop_local" | "production_server" | "remote_unavailable";
  label: string;
  checkedAt: string;
  endpoint?: string;
  errorCode?: string;
};

export class WechatWorkRemoteReadinessError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WechatWorkRemoteReadinessError";
  }
}

export function readinessExportTokenMatches(configured: unknown, supplied: unknown) {
  const configuredToken = String(configured || "").trim();
  const suppliedToken = String(supplied || "").trim();
  if (!TOKEN_PATTERN.test(configuredToken) || !TOKEN_PATTERN.test(suppliedToken)) return false;
  const configuredBytes = Buffer.from(configuredToken, "utf8");
  const suppliedBytes = Buffer.from(suppliedToken, "utf8");
  return configuredBytes.length === suppliedBytes.length && timingSafeEqual(configuredBytes, suppliedBytes);
}

export async function fetchWechatWorkRemoteReadiness(input: {
  url: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  const endpoint = validateRemoteReadinessUrl(input.url);
  const token = String(input.token || "").trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new WechatWorkRemoteReadinessError(
      "remote_readiness_token_invalid",
      "WECHAT_WORK_REMOTE_READINESS_TOKEN must be a 64-character hexadecimal read-only token",
    );
  }

  const fetchImpl = input.fetchImpl || fetch;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        [WECHAT_WORK_READINESS_TOKEN_HEADER]: token,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1000, Math.min(30_000, Number(input.timeoutMs) || 8000))),
    });
  } catch {
    throw new WechatWorkRemoteReadinessError(
      "remote_readiness_unreachable",
      "The production readiness endpoint could not be reached",
    );
  }

  if (!response.ok) {
    throw new WechatWorkRemoteReadinessError(
      `remote_readiness_http_${response.status}`,
      "The production readiness endpoint rejected the request",
    );
  }

  let report: any;
  try {
    report = await response.json();
  } catch {
    throw new WechatWorkRemoteReadinessError(
      "remote_readiness_invalid_json",
      "The production readiness endpoint returned invalid JSON",
    );
  }
  if (
    report?.schema !== READINESS_SCHEMA
    || typeof report?.productionReady !== "boolean"
    || !report?.local
    || !report?.external
    || !report?.callback
    || !report?.identityPolicy
  ) {
    throw new WechatWorkRemoteReadinessError(
      "remote_readiness_invalid_schema",
      "The production readiness endpoint returned an unsupported schema",
    );
  }

  return withWechatWorkReadinessSource(report, {
    kind: "production_server",
    label: "生产服务器实时状态",
    endpoint: endpoint.origin,
    checkedAt: new Date().toISOString(),
  });
}

export function withWechatWorkReadinessSource<T extends Record<string, unknown>>(
  report: T,
  source: WechatWorkReadinessSource,
): T & { source: WechatWorkReadinessSource } {
  return { ...report, source };
}

export function remoteReadinessErrorCode(error: unknown) {
  return error instanceof WechatWorkRemoteReadinessError
    ? error.code
    : "remote_readiness_unavailable";
}

function validateRemoteReadinessUrl(value: unknown) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new WechatWorkRemoteReadinessError(
      "remote_readiness_url_invalid",
      "WECHAT_WORK_REMOTE_READINESS_URL must be an absolute HTTPS URL",
    );
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.search
    || parsed.pathname !== "/api/wechat-work/readiness/export"
  ) {
    throw new WechatWorkRemoteReadinessError(
      "remote_readiness_url_invalid",
      "WECHAT_WORK_REMOTE_READINESS_URL must use the exact HTTPS readiness export path",
    );
  }
  return parsed;
}
