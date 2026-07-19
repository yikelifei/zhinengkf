import { timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { DesignJobsService } from "../../design-jobs/design-jobs.service";
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
      const data = await this.designPlatform.health();
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
  async readiness() {
    const startedAt = Date.now();
    const checks: Array<{
      key: string;
      label: string;
      ok: boolean;
      severity: "info" | "warning" | "error";
      detail: string;
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
      });
    }

    if (appConfig.designPlatformAdapter === "art_image_local") {
      if (healthData && typeof healthData === "object") {
        const artImageHealth = evaluateArtImageLocalHealthReadiness(healthData);
        checks.push(...artImageHealth.checks);
      }

      try {
        const auth = await this.designPlatform.getArtImageLocalAuthSession();
        checks.push({
          key: "art_image_auth_session",
          label: "设计平台登录态",
          ok: auth.authenticated,
          severity: "error",
          detail: auth.authenticated
            ? formatAuthSessionUser(auth)
            : "设计平台未登录，或客服平台没有拿到设计平台登录凭证。请先登录设计平台，或配置 DESIGN_PLATFORM_COOKIE / DESIGN_PLATFORM_ACCESS_TOKEN。",
        });
      } catch (error) {
        checks.push({
          key: "art_image_auth_session",
          label: "设计平台登录态",
          ok: false,
          severity: "error",
          detail: error instanceof Error ? error.message : "设计平台登录态检查失败",
        });
      }

      try {
        const activationStatus = await this.designPlatform.getArtImageLocalActivationStatus();
        const activation = evaluateDesignPlatformActivationStatus(activationStatus);
        checks.push({
          key: "art_image_activation",
          label: "设计平台设备激活",
          ok: Boolean(activation.ok),
          severity: "error",
          detail: String(activation.detail || activation.reason || "设计平台设备激活状态未知"),
        });
      } catch (error) {
        checks.push({
          key: "art_image_activation",
          label: "设计平台设备激活",
          ok: false,
          severity: "error",
          detail: error instanceof Error ? error.message : "设计平台设备激活检查失败",
        });
      }
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
      });
    }

    const failed = checks.filter((check) => !check.ok && check.severity === "error");
    const nextSteps = Array.from(new Set(failed.map((check) => check.detail).filter(Boolean)));
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

  @Post("config")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  async updateConfig(@Body() payload: Record<string, unknown>) {
    try {
      const config = updateDesignPlatformRuntimeConfig({
        adapter: stringOrUndefined(payload.adapter),
        baseUrl: stringOrUndefined(payload.baseUrl),
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
        readiness: await this.readiness(),
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
        readiness: await this.readiness(),
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
    if (appConfig.designPlatformAdapter === "art_image_local") {
      throw new NotFoundException("design platform callback is disabled for art_image_local");
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
