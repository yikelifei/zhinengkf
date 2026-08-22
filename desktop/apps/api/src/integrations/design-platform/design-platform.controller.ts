import { timingSafeEqual } from "node:crypto";
import axios from "axios";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { DesignJobsService } from "../../design-jobs/design-jobs.service";
import { isTrustedInternalZhenxiWorkspaceHealth } from "./design-platform-readiness";
import {
  appConfig,
  getDesignPlatformRuntimeConfigSummary,
  hasIndependentDesignPlatformCallbackApiKey,
  updateDesignPlatformRuntimeConfig,
} from "../../shared/app-config";
import { rules } from "../../shared/rules";
import { DesignPlatformClient } from "./design-platform.client";
import { DesignPlatformCallbackPayload } from "./design-platform.types";
import { OperatorAccessGuard, RequireOperatorCapability } from "../../operator-access/operator-access.guard";

const { evaluateArtImageLocalHealthReadiness, evaluateDesignPlatformActivationStatus } = rules;

function isZhenxiDurableAdapter(adapter = appConfig.designPlatformAdapter) {
  return adapter === "art_image_local" || adapter === "zhenxi_external";
}

function hasBoundZhenxiExternalApiKey() {
  try {
    const baseOrigin = new URL(appConfig.designPlatformBaseUrl).origin;
    return Boolean(
      (appConfig.designPlatformApiKey && appConfig.designPlatformApiKeyOrigin === baseOrigin) ||
      (appConfig.designPlatformAccessToken && appConfig.designPlatformAccessTokenOrigin === baseOrigin),
    );
  } catch {
    return false;
  }
}

type DesignPlatformCandidateProbeRequest = (
  url: string,
  timeoutMs: number,
) => Promise<{ statusCode: number; data: unknown }>;

type DesignPlatformCandidateProbe = {
  baseUrl: string;
  ok: boolean;
  generationReady: boolean;
  selected: boolean;
  latencyMs: number;
  statusCode?: number;
  service?: string;
  status?: string;
  version?: string;
  runtimeChannel?: string;
  generationBackend?: string;
  localWorkspace?: boolean;
  imageConfigured?: boolean;
  imageModel?: string;
  imageApiType?: string;
  gptImageModel?: boolean;
  errorMessage?: string;
};

@Controller("integrations/design-platform")
export class DesignPlatformController {
  constructor(
    private readonly designJobs: DesignJobsService,
    private readonly designPlatform: DesignPlatformClient,
  ) {}

  @Get("health")
  async health() {
    const startedAt = Date.now();
    try {
      const data = await this.designPlatform.publicHealth();
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        adapter: appConfig.designPlatformAdapter,
        baseUrl: appConfig.designPlatformBaseUrl,
        ...sanitizePublicDesignPlatformHealth(data),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        adapter: appConfig.designPlatformAdapter,
        baseUrl: appConfig.designPlatformBaseUrl,
        errorMessage: "design platform health check failed",
      };
    }
  }

  @Get("readiness")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  async readiness(@Query("deviceId") deviceIdQuery?: string) {
    const startedAt = Date.now();
    const explicitDeviceId = stringOrUndefined(deviceIdQuery)?.trim() || "";
    const checks: Array<{
      key: string;
      label: string;
      ok: boolean;
      severity: "info" | "warning" | "error";
      detail: string;
      action?: string;
    }> = [];
    let healthData: unknown = null;

    try {
      healthData = await this.designPlatform.health();
      checks.push({
        key: "design_platform_health",
        label: "设计平台连通",
        ok: true,
        severity: "error",
        detail: `${appConfig.designPlatformAdapter} ${appConfig.designPlatformBaseUrl}`,
      });
    } catch (error) {
      checks.push({
        key: "design_platform_health",
        label: "设计平台连通",
        ok: false,
        severity: "error",
        detail: error instanceof Error ? error.message : "设计平台健康检查失败",
        action: "打开 /design/settings，确认适配器为 art_image_local，并选择当前可连通的臻希 AI 本地端口。",
      });
    }

    if (appConfig.designPlatformAdapter === "art_image_local") {
      if (healthData && typeof healthData === "object") {
        const artImageHealth = evaluateArtImageLocalHealthReadiness(healthData);
        checks.push(...artImageHealth.checks);
      }

      if (isTrustedInternalZhenxiWorkspaceHealth(healthData)) {
        checks.push({
          key: "art_image_auth_session",
          label: "臻希 AI 本地内部会话",
          ok: true,
          severity: "info",
          detail: "复用本机臻希 AI 内部工作台会话，不保存或重复登录账号密码。",
        });
        checks.push({
          key: "art_image_activation",
          label: "臻希 AI 本机设备绑定",
          ok: true,
          severity: "info",
          detail: "生成请求在臻希 AI 已绑定的本机进程内执行，不创建第二个设备绑定。",
        });
      } else {
        try {
          const auth = await this.designPlatform.getArtImageLocalAuthSession(explicitDeviceId);
          checks.push({
            key: "art_image_auth_session",
            label: "设计平台登录态",
            ok: auth.authenticated,
            severity: "error",
            detail: auth.authenticated
              ? formatAuthSessionUser(auth)
              : "设计平台未登录，或客服平台没有拿到设计平台登录凭证。请先登录设计平台，或配置 DESIGN_PLATFORM_COOKIE / DESIGN_PLATFORM_ACCESS_TOKEN。",
            action: auth.authenticated
              ? undefined
              : "先到 /design/activation 完成设备激活，再到 /design/account 登录臻希 AI 账号。",
          });
        } catch (error) {
          checks.push({
            key: "art_image_auth_session",
            label: "设计平台登录态",
            ok: false,
            severity: "error",
            detail: error instanceof Error ? error.message : "设计平台登录态检查失败",
            action: "到 /design/account 重新登录臻希 AI；如果仍失败，先回 /design/activation 确认设备 ID 已激活。",
          });
        }

        try {
          const activationStatus = await this.designPlatform.getArtImageLocalActivationStatus(explicitDeviceId);
          const activation = evaluateDesignPlatformActivationStatus(activationStatus);
          checks.push({
            key: "art_image_activation",
            label: "设计平台设备激活",
            ok: Boolean(activation.ok),
            severity: "error",
            detail: String(activation.detail || activation.reason || "设计平台设备激活状态未知"),
            action: activation.ok
              ? undefined
              : "到 /design/activation 使用臻希 AI 管理员激活码激活当前客服设备。",
          });
        } catch (error) {
          checks.push({
            key: "art_image_activation",
            label: "设计平台设备激活",
            ok: false,
            severity: "error",
            detail: error instanceof Error ? error.message : "设计平台设备激活检查失败",
            action: "到 /design/activation 重新填写设备 ID 并激活；确认臻希 AI 本地服务仍在当前端口。",
          });
        }
      }
    } else if (appConfig.designPlatformAdapter === "zhenxi_external") {
      const mcpReady = isRecord(healthData)
        && healthData.transport === "mcp_stdio"
        && healthData.reachable === true;
      checks.push({
        key: "zhenxi_mcp_release",
        label: "臻希 AI 成品软件 MCP",
        ok: mcpReady,
        severity: "error",
        detail: mcpReady
          ? "智能客服已通过内置 MCP 连接本机臻希 AI 成品软件；生成顺序为先文案、后图片。"
          : "智能客服没有通过内置 MCP 连接到臻希 AI 成品软件。",
        action: mcpReady
          ? undefined
          : "先启动并登录臻希 AI 成品软件，再确认智能客服已启用 ZHENXI_MCP_ENABLED。",
      });
    } else {
      checks.push({
        key: "mock_adapter",
        label: "设计平台适配器",
        ok: true,
        severity: "info",
        detail: "当前是 mock / standard_v1 模式，不要求设计平台登录和设备激活。",
      });
      checks.push({
        key: "design_platform_callback_auth",
        label: "设计平台回调独立密钥",
        ok: hasIndependentDesignPlatformCallbackApiKey(),
        severity: "error",
        detail: hasIndependentDesignPlatformCallbackApiKey()
          ? "standard_v1 回调已配置独立密钥。"
          : "standard_v1 必须配置独立的 DESIGN_PLATFORM_CALLBACK_API_KEY，且不得复用内部/API/登录凭据。",
        action: hasIndependentDesignPlatformCallbackApiKey()
          ? undefined
          : "为 standard_v1 配置独立 DESIGN_PLATFORM_CALLBACK_API_KEY；art_image_local 本地臻希模式不需要 callback。",
      });
    }

    const failed = checks.filter((check) => !check.ok && check.severity === "error");
    const nextSteps = Array.from(new Set(failed.map((check) => check.action || check.detail).filter(Boolean)));
    return {
      ok: failed.length === 0,
      canSubmitFormalGeneration: failed.length === 0,
      adapter: appConfig.designPlatformAdapter,
      baseUrl: appConfig.designPlatformBaseUrl,
      latencyMs: Date.now() - startedAt,
      checks,
      nextSteps,
      config: {
        hasApiKey: Boolean(appConfig.designPlatformApiKey),
        hasAccessToken: Boolean(appConfig.designPlatformAccessToken),
        hasCookie: Boolean(appConfig.designPlatformCookie),
        hasDeviceId: Boolean(appConfig.designPlatformDeviceId),
        hasCallbackApiKey: hasIndependentDesignPlatformCallbackApiKey(),
        callbackUrl:
          appConfig.designPlatformCallbackUrl ||
          `${appConfig.customerServicePublicBaseUrl}/api/integrations/design-platform/callback`,
        zhenxiAi: appConfig.zhenxiAi,
      },
      data: healthData,
    };
  }

  @Get("config")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  config() {
    return {
      ok: true,
      config: getDesignPlatformRuntimeConfigSummary(),
    };
  }

  @Get("candidates")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  async candidates() {
    return probeDesignPlatformCandidates();
  }

  @Post("config")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  async updateConfig(@Body() payload: Record<string, unknown>) {
    try {
      const config = updateDesignPlatformRuntimeConfig({
        adapter: stringOrUndefined(payload.adapter),
        baseUrl: stringOrUndefined(payload.baseUrl),
        apiKey: stringOrUndefined(payload.apiKey),
        accessToken: stringOrUndefined(payload.accessToken),
        cookie: stringOrUndefined(payload.cookie),
        deviceId: stringOrUndefined(payload.deviceId),
      });
      return {
        ok: true,
        config,
        readiness: await this.readiness(),
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "invalid design platform config");
    }
  }

  @Post("login")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  async login(@Body() payload: Record<string, unknown>) {
    const email = requiredString(payload.email, "email");
    const password = requiredString(payload.password, "password");
    const deviceId = boundOrExplicitDesignPlatformDeviceId(payload.deviceId);

    try {
      const login = await this.designPlatform.loginArtImageLocal({
        email,
        password,
        deviceId,
      });
      const config = updateDesignPlatformRuntimeConfig({
        adapter: "art_image_local",
        accessToken: login.accessToken,
        cookie: login.cookie || "",
        deviceId: login.deviceId,
      });
      return {
        ok: true,
        config,
        user: sanitizeLoginUser(login.user),
        readiness: await this.readiness(login.deviceId),
      };
    } catch (error) {
      throw new BadRequestException(publicLoginErrorMessage(error));
    }
  }

  @Post("activation/redeem")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  async redeemActivation(@Body() payload: Record<string, unknown>) {
    const code = requiredString(payload.code, "activationCode");
    const deviceId = boundOrExplicitDesignPlatformDeviceId(payload.deviceId);
    const deviceLabel = stringOrUndefined(payload.deviceLabel) || "智能客服工作台";

    try {
      const activation = await this.designPlatform.redeemArtImageLocalActivation({
        code,
        deviceId,
        deviceLabel,
      });
      const config = updateDesignPlatformRuntimeConfig({
        adapter: "art_image_local",
        deviceId,
      });
      return {
        ok: true,
        activation,
        config,
        readiness: await this.readiness(deviceId),
      };
    } catch (error) {
      throw new BadRequestException(publicLoginErrorMessage(error));
    }
  }

  @Post("smoke-test")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  async smokeTest() {
    return this.designJobs.runDesignPlatformSmokeTest();
  }

  @Post("callback")
  async callback(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: DesignPlatformCallbackPayload,
  ) {
    if (isZhenxiDurableAdapter()) {
      throw new NotFoundException(`design platform callback is disabled for ${appConfig.designPlatformAdapter}`);
    }
    const callbackApiKey = String(appConfig.callbackApiKey || "").trim();
    if (!hasIndependentDesignPlatformCallbackApiKey()) {
      throw new ServiceUnavailableException("independent design platform callback api key is not configured");
    }
    if (!callbackAuthorizationMatches(authorization, callbackApiKey)) {
      throw new UnauthorizedException("invalid callback api key");
    }
    return this.designJobs.handleDesignPlatformCallback(payload);
  }
}

export function callbackAuthorizationMatches(authorization: string | undefined, callbackApiKey: string) {
  const key = String(callbackApiKey || "").trim();
  if (!key) return false;
  const actual = Buffer.from(String(authorization || ""), "utf8");
  const expected = Buffer.from(`Bearer ${key}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sanitizePublicDesignPlatformHealth(value: unknown) {
  return { upstreamOk: isRecord(value) && typeof value.ok === "boolean" ? value.ok : true };
}

export { isTrustedInternalZhenxiWorkspaceHealth } from "./design-platform-readiness";

export async function probeDesignPlatformCandidates(options: {
  candidateBaseUrls?: string[];
  selectedBaseUrl?: string;
  timeoutMs?: number;
  requestHealth?: DesignPlatformCandidateProbeRequest;
} = {}) {
  const selectedBaseUrl = normalizeCandidateOrigin(options.selectedBaseUrl || appConfig.designPlatformBaseUrl) || "";
  const candidateBaseUrls = trustedDesignPlatformCandidateBaseUrls([
    ...(options.candidateBaseUrls || appConfig.zhenxiAi.localCandidateBaseUrls || []),
    selectedBaseUrl,
  ]);
  const timeoutMs = Math.max(300, Math.min(Number(options.timeoutMs || appConfig.designPlatformTimeoutMs || 1200), 3000));
  const requestHealth = options.requestHealth || requestDesignPlatformCandidateHealth;
  const candidates = await Promise.all(
    candidateBaseUrls.map((baseUrl) => probeOneDesignPlatformCandidate(baseUrl, selectedBaseUrl, timeoutMs, requestHealth)),
  );
  const recommendedBaseUrl =
    candidates.find((candidate) => candidate.ok && candidate.generationReady)?.baseUrl ||
    candidates.find((candidate) => candidate.ok)?.baseUrl ||
    "";
  return {
    ok: candidates.some((candidate) => candidate.ok),
    adapter: appConfig.designPlatformAdapter,
    selectedBaseUrl,
    recommendedBaseUrl,
    candidateCount: candidates.length,
    candidates,
  };
}

async function probeOneDesignPlatformCandidate(
  baseUrl: string,
  selectedBaseUrl: string,
  timeoutMs: number,
  requestHealth: DesignPlatformCandidateProbeRequest,
): Promise<DesignPlatformCandidateProbe> {
  const startedAt = Date.now();
  try {
    const response = await requestHealth(`${baseUrl}/api/health`, timeoutMs);
    const health = unwrapCandidateHealth(response.data);
    const ok =
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      health.service === "zhenxi-ai" &&
      (health.status === "ok" || health.ok === true);
    const generationReady = candidateGenerationReady(health);
    return {
      baseUrl,
      ok,
      generationReady: ok && generationReady,
      selected: baseUrl === selectedBaseUrl,
      latencyMs: Date.now() - startedAt,
      statusCode: response.statusCode,
      service: health.service,
      status: health.status,
      version: health.version,
      runtimeChannel: health.runtimeChannel,
      generationBackend: health.generationBackend,
      localWorkspace: health.localWorkspace,
      imageConfigured: health.imageConfigured,
      imageModel: health.imageModel,
      imageApiType: health.imageApiType,
      gptImageModel: health.gptImageModel,
      errorMessage: ok
        ? generationReady ? undefined : "臻希 AI 本地服务在线，但图片模型未配置或不是 GPT 图片模型"
        : "未确认这是可用的臻希 AI 本地服务",
    };
  } catch (error) {
    return {
      baseUrl,
      ok: false,
      generationReady: false,
      selected: baseUrl === selectedBaseUrl,
      latencyMs: Date.now() - startedAt,
      errorMessage: safeCandidateProbeError(error),
    };
  }
}

async function requestDesignPlatformCandidateHealth(url: string, timeoutMs: number) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
    maxRedirects: 0,
    proxy: false,
    validateStatus: () => true,
  });
  return { statusCode: response.status, data: response.data };
}

function unwrapCandidateHealth(value: unknown) {
  const root = isRecord(value) ? value : {};
  const data = isRecord(root.data) ? root.data : root;
  const runtime = isRecord(data.runtime) ? data.runtime : {};
  const ai = isRecord(data.ai) ? data.ai : {};
  return {
    ok: typeof root.ok === "boolean" ? root.ok : typeof data.ok === "boolean" ? data.ok : undefined,
    service: stringOrUndefined(data.service) || stringOrUndefined(root.service) || "",
    status: stringOrUndefined(data.status) || stringOrUndefined(root.status) || "",
    version: stringOrUndefined(data.version) || stringOrUndefined(root.version) || "",
    runtimeChannel: stringOrUndefined(runtime.channel),
    generationBackend: stringOrUndefined(runtime.generationBackend),
    localWorkspace: typeof runtime.localWorkspace === "boolean" ? runtime.localWorkspace : undefined,
    imageConfigured: typeof ai.imageConfigured === "boolean" ? ai.imageConfigured : undefined,
    imageModel: stringOrUndefined(ai.imageModel),
    imageApiType: stringOrUndefined(ai.imageApiType),
    gptImageModel: typeof ai.gptImageModel === "boolean" ? ai.gptImageModel : undefined,
  };
}

function candidateGenerationReady(health: ReturnType<typeof unwrapCandidateHealth>) {
  if (health.imageConfigured === false || health.gptImageModel === false) return false;
  if (health.imageConfigured === true || health.gptImageModel === true) return true;
  return true;
}

function trustedDesignPlatformCandidateBaseUrls(values: string[]) {
  const seen = new Set<string>();
  const trusted: string[] = [];
  for (const value of values) {
    const origin = normalizeCandidateOrigin(value);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    trusted.push(origin);
  }
  return trusted;
}

function normalizeCandidateOrigin(value: string | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    if (!isLoopbackCandidateHost(parsed.hostname)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function isLoopbackCandidateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "::1" || host === "[::1]") return true;
  if (!/^127(?:\.\d{1,3}){3}$/.test(host)) return false;
  return host
    .split(".")
    .slice(1)
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function safeCandidateProbeError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNREFUSED") return "未启动或端口未监听";
    if (error.code === "ECONNABORTED" || String(error.message || "").includes("timeout")) return "探测超时";
    return error.response?.status ? `HTTP ${error.response.status}` : "健康检查请求失败";
  }
  return error instanceof Error && error.message ? error.message : "健康检查请求失败";
}

function formatAuthSessionUser(auth: { user?: unknown; profile?: unknown }) {
  const user = isRecord(auth.user) ? auth.user : {};
  const profile = isRecord(auth.profile) ? auth.profile : {};
  const email = typeof user.email === "string" ? user.email : "";
  const name =
    (typeof profile.displayName === "string" && profile.displayName) ||
    (typeof profile.name === "string" && profile.name) ||
    (typeof user.name === "string" && user.name) ||
    "";
  return ["设计平台已登录", name || email ? `账号 ${name || email}` : ""].filter(Boolean).join("，");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, name: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${name} is required`);
  return text;
}

export function boundOrExplicitDesignPlatformDeviceId(value: unknown) {
  const explicit = typeof value === "string" ? value.trim() : "";
  if (explicit) return explicit;
  const configured = String(appConfig.designPlatformDeviceId || "").trim();
  let baseOrigin = "";
  try {
    baseOrigin = new URL(appConfig.designPlatformBaseUrl).origin;
  } catch {}
  if (configured && appConfig.designPlatformDeviceIdOrigin === baseOrigin) return configured;
  throw new BadRequestException("deviceId is required for the current design platform origin");
}

function sanitizeLoginUser(user: unknown) {
  if (!isRecord(user)) return null;
  return {
    id: typeof user.id === "string" ? user.id : "",
    email: typeof user.email === "string" ? user.email : "",
  };
}

function publicLoginErrorMessage(error: unknown) {
  if (!isRecord(error)) return error instanceof Error ? error.message : "design platform login failed";
  const response = isRecord(error.response) ? error.response : null;
  const data = response && isRecord(response.data) ? response.data : null;
  const nestedError = data && isRecord(data.error) ? data.error : null;
  return String(
    nestedError?.message ||
      data?.message ||
      data?.code ||
      (error instanceof Error ? error.message : "") ||
      "design platform login failed",
  );
}
