import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { DesignJobsService } from "../../design-jobs/design-jobs.service";
import {
  appConfig,
  getDesignPlatformRuntimeConfigSummary,
  updateDesignPlatformRuntimeConfig,
} from "../../shared/app-config";
import { rules } from "../../shared/rules";
import { DesignPlatformClient } from "./design-platform.client";
import { DesignPlatformCallbackPayload } from "./design-platform.types";

const { evaluateDesignPlatformActivationStatus } = rules;

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
        data,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        adapter: appConfig.designPlatformAdapter,
        baseUrl: appConfig.designPlatformBaseUrl,
        errorMessage: error instanceof Error ? error.message : "unknown design platform health error",
      };
    }
  }

  @Get("readiness")
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
      },
      data: healthData,
    };
  }

  @Get("config")
  config() {
    return {
      ok: true,
      config: getDesignPlatformRuntimeConfigSummary(),
    };
  }

  @Post("config")
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

  @Post("callback")
  async callback(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: DesignPlatformCallbackPayload,
  ) {
    if (appConfig.callbackApiKey) {
      const expected = `Bearer ${appConfig.callbackApiKey}`;
      if (authorization !== expected) {
        throw new UnauthorizedException("invalid callback api key");
      }
    }
    return this.designJobs.handleDesignPlatformCallback(payload);
  }
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
