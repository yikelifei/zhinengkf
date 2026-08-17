import { Injectable, Optional } from "@nestjs/common";
import axios, {
  AxiosAdapter,
  AxiosHeaders,
  AxiosInstance,
  AxiosRequestTransformer,
  AxiosResponse,
  AxiosResponseTransformer,
  InternalAxiosRequestConfig,
} from "axios";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { appConfig } from "../../shared/app-config";
import { rules } from "../../shared/rules";
import {
  ZhenxiMcpClientService,
  ZhenxiMcpToolError,
} from "../zhenxi-mcp/zhenxi-mcp-client.service";
import { DesignPlatformJobPayload } from "./design-platform.types";

const { CUSTOMER_DESIGN_CANDIDATE_COUNT, inspectRealDesignReferences } = rules;

const trustedValidateStatus = (status: number) => status >= 200 && status < 300;

function copyTransform<T>(value: T | T[] | undefined): T | T[] | undefined {
  return Array.isArray(value) ? [...value] : value;
}

const trustedTransformRequest = copyTransform<AxiosRequestTransformer>(axios.defaults.transformRequest);
const trustedTransformResponse = copyTransform<AxiosResponseTransformer>(axios.defaults.transformResponse);

type DesignImageResult = {
  imageId: string;
  downloadUrl: string;
  width?: number;
  height?: number;
};

export type ArtImageLocalGenerationOutcome =
  | {
      status: "completed";
      images: DesignImageResult[];
      refundStatus: "not_required" | "credit_bypass" | "refunded" | "failed" | "unknown";
      refundSummary?: Record<string, unknown>;
      httpStatus: number;
    }
  | {
      status: "failed";
      images: [];
      refundStatus: "refunded" | "not_required" | "credit_bypass" | "failed" | "unknown";
      refundSummary?: Record<string, unknown>;
      errorCode: string;
      errorMessage: string;
      httpStatus: number;
    }
  | {
      status: "outcome_unknown";
      images: [];
      refundStatus: "unknown";
      errorCode: string;
      errorMessage: string;
      httpStatus?: number;
    };

export type ZhenxiCopyGenerationOutcome =
  | { status: "completed"; prompts: string[]; selectedPrompt: string; requestId: string }
  | { status: "failed" | "outcome_unknown"; prompts: []; errorCode: string; errorMessage: string; requestId: string };

type ArtImageLocalResult = {
  url?: string | null;
  status?: "success" | "failed" | string;
  error?: string;
  prompt?: string;
};

type ArtImageLocalSlotOutcome =
  | {
      status: "completed";
      slot: number;
      image: DesignImageResult;
      refundStatus: "not_required" | "credit_bypass" | "refunded" | "failed" | "unknown";
      refundSummary?: Record<string, unknown>;
      httpStatus: number;
    }
  | {
      status: "failed";
      slot: number;
      refundStatus: "refunded" | "not_required" | "credit_bypass" | "failed" | "unknown";
      refundSummary?: Record<string, unknown>;
      errorCode: string;
      errorMessage: string;
      httpStatus: number;
    }
  | {
      status: "outcome_unknown";
      slot: number;
      refundStatus: "unknown";
      errorCode: string;
      errorMessage: string;
      httpStatus?: number;
    };

type ZhenxiExternalMultipartFile = {
  fieldName: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  localPath?: string;
};

type ArtImageLocalActivationStatus = {
  required?: boolean;
  active?: boolean;
  reason?: string;
  deviceIdSuffix?: string;
  activation?: unknown;
};

type ArtImageLocalAuthSession = {
  required: boolean;
  authenticated: boolean;
  reason?: string;
  user?: unknown;
  profile?: unknown;
  activation?: unknown;
  refreshed?: boolean;
};

type ArtImageLocalLoginPayload = {
  email: string;
  password: string;
  deviceId: string;
};

type ArtImageLocalActivationRedeemPayload = {
  code: string;
  deviceId: string;
  deviceLabel?: string;
};

type ArtImageLocalLoginResult = {
  accessToken: string;
  cookie: string;
  deviceId: string;
  user?: unknown;
};

const imageMimeByExtension: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function designPlatformRedirectError(response: AxiosResponse) {
  const error = new Error("design platform redirect response blocked") as Error & {
    code: string;
    config: AxiosResponse["config"];
    isAxiosError: boolean;
    request: AxiosResponse["request"];
    response: AxiosResponse;
  };
  error.name = "AxiosError";
  error.code = "DESIGN_PLATFORM_REDIRECT_BLOCKED";
  error.config = response.config;
  error.isAxiosError = true;
  error.request = response.request;
  error.response = response;
  return error;
}

@Injectable()
export class DesignPlatformClient {
  private readonly http: AxiosInstance;
  private readonly publicHttp: AxiosInstance;
  private transport: AxiosAdapter;
  private readonly guardedAdapter: AxiosAdapter;

  constructor(@Optional() private readonly zhenxiMcp?: ZhenxiMcpClientService) {
    this.transport = axios.getAdapter(axios.defaults.adapter);
    this.guardedAdapter = async (config) => {
      this.applyTrustedRequestBoundary(config);
      this.applyTrustedCredentialHeaders(config);
      assertTrustedDesignPlatformTarget(config.baseURL, config.url);
      return this.transport(config);
    };
    this.http = axios.create({
      baseURL: trustedDesignPlatformBaseUrl().toString(),
      timeout: appConfig.designPlatformTimeoutMs,
      maxRedirects: 0,
      adapter: this.guardedAdapter,
      proxy: false,
      validateStatus: trustedValidateStatus,
    });
    this.publicHttp = axios.create({
      baseURL: trustedDesignPlatformBaseUrl().toString(),
      timeout: appConfig.designPlatformTimeoutMs,
      maxRedirects: 0,
      adapter: async (config) => {
        this.applyTrustedRequestBoundary(config);
        this.removeCredentialHeaders(config);
        assertTrustedDesignPlatformTarget(config.baseURL, config.url);
        return this.transport(config);
      },
      proxy: false,
      validateStatus: trustedValidateStatus,
    });
    this.http.interceptors.request.use((config) => {
      assertTrustedDesignPlatformTarget(appConfig.designPlatformBaseUrl, config.url);
      this.applyTrustedRequestBoundary(config);
      this.applyTrustedCredentialHeaders(config);
      return config;
    });
    this.http.interceptors.response.use((response) => {
      if (response.status >= 300 && response.status < 400) {
        throw designPlatformRedirectError(response);
      }
      return response;
    });
  }

  async generateZhenxiCopy(input: {
    prompt: string;
    requestId: string;
    module: "poster_copy" | "xiaohongshu" | "detail_page" | "video_script";
    ratio?: string;
  }): Promise<ZhenxiCopyGenerationOutcome> {
    if (!this.zhenxiMcp?.enabled()) {
      return {
        status: "failed",
        prompts: [],
        requestId: input.requestId,
        errorCode: "ZHENXI_MCP_DISABLED",
        errorMessage: "Zhenxi MCP is disabled",
      };
    }
    try {
      const health = await this.zhenxiMcp.health();
      if (health.reachable !== true) {
        throw new ZhenxiMcpToolError("Zhenxi AI is not ready", { code: "ZHENXI_HEALTH_NOT_READY" });
      }
      const result = await this.zhenxiMcp.generateCopy({
        brief: input.prompt,
        requestId: input.requestId,
        module: input.module,
        ratio: input.ratio || appConfig.designPlatformImageRatio,
      });
      const prompts = Array.isArray(result.prompts)
        ? result.prompts.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      if (!prompts.length) {
        return {
          status: "outcome_unknown",
          prompts: [],
          requestId: input.requestId,
          errorCode: "ZHENXI_COPY_RESULT_INVALID",
          errorMessage: "Zhenxi AI returned no usable copy result",
        };
      }
      return {
        status: "completed",
        prompts,
        selectedPrompt: String(result.selectedPrompt || prompts[0]),
        requestId: String(result.requestId || input.requestId),
      };
    } catch (error) {
      const known = error instanceof ZhenxiMcpToolError ? error : null;
      return {
        status: known?.outcomeUnknown ? "outcome_unknown" : "failed",
        prompts: [],
        requestId: input.requestId,
        errorCode: known?.code || "ZHENXI_COPY_FAILED",
        errorMessage: known?.message || this.publicErrorMessage(error),
      };
    }
  }

  static createForTesting(transport: AxiosAdapter) {
    if (typeof transport !== "function") {
      throw new TypeError("design platform test transport must be an Axios adapter function");
    }
    const client = new DesignPlatformClient();
    client.transport = transport;
    return client;
  }

  async health() {
    if (this.useZhenxiExternalAdapter()) {
      if (!this.zhenxiMcp?.enabled()) {
        throw new Error("Zhenxi MCP is disabled; release generation cannot use a direct external API fallback");
      }
      return {
        adapter: appConfig.designPlatformAdapter,
        ...(await this.zhenxiMcp.health()),
        transport: "mcp_stdio",
      };
    }
    if (this.useZhenxiAiLoopbackAdapter()) {
      const response = await this.http.get("api/health");
      const unwrapped = this.unwrapApiData(response.data);
      const data = this.useArtImageLocalAdapter()
        ? await this.enrichArtImageLocalHealth(unwrapped, this.http)
        : unwrapped;
      return {
        adapter: appConfig.designPlatformAdapter,
        ...(isRecord(data) ? data : { data }),
      };
    }

    const response = await this.http.get("v1/health");
    return response.data;
  }

  async publicHealth() {
    if (this.useZhenxiExternalAdapter()) {
      if (!this.zhenxiMcp?.enabled()) {
        throw new Error("Zhenxi MCP is disabled; release generation cannot use a direct external API fallback");
      }
      return {
        adapter: appConfig.designPlatformAdapter,
        ...(await this.zhenxiMcp.health()),
        transport: "mcp_stdio",
      };
    }
    if (this.useZhenxiAiLoopbackAdapter()) {
      const response = await this.publicHttp.get("api/health");
      const unwrapped = this.unwrapApiData(response.data);
      const data = this.useArtImageLocalAdapter()
        ? await this.enrichArtImageLocalHealth(unwrapped, this.publicHttp)
        : unwrapped;
      return {
        adapter: appConfig.designPlatformAdapter,
        ...(isRecord(data) ? data : { data }),
      };
    }

    const response = await this.publicHttp.get("v1/health");
    return response.data;
  }

  async getArtImageLocalAuthSession(deviceId = ""): Promise<ArtImageLocalAuthSession> {
    if (!this.useArtImageLocalAdapter()) {
      return { required: false, authenticated: true, reason: "not_required" };
    }

    try {
      const response = await this.http.get("api/auth/session", artImageLocalDeviceHeaders(deviceId));
      const data = this.unwrapApiData(response.data) as Record<string, unknown>;
      return {
        required: true,
        authenticated: true,
        user: data.user,
        profile: data.profile,
        activation: data.activation,
        refreshed: Boolean(data.refreshed),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const responseData = error.response?.data as any;
        return {
          required: true,
          authenticated: false,
          reason: responseData?.error?.code || responseData?.code || responseData?.error?.message || "UNAUTHORIZED",
        };
      }
      throw error;
    }
  }

  async getArtImageLocalActivationStatus(deviceId = ""): Promise<ArtImageLocalActivationStatus> {
    if (!this.useArtImageLocalAdapter()) {
      return { required: false, active: true, reason: "not_required" };
    }

    const response = await this.http.get("api/activation/status", artImageLocalDeviceHeaders(deviceId));
    return this.unwrapApiData(response.data) as ArtImageLocalActivationStatus;
  }

  async loginArtImageLocal(payload: ArtImageLocalLoginPayload): Promise<ArtImageLocalLoginResult> {
    if (!this.useArtImageLocalAdapter()) {
      throw new Error("design platform login is only available for art_image_local adapter");
    }

    const email = payload.email.trim().toLowerCase();
    const password = payload.password;
    const deviceId = payload.deviceId.trim();
    if (!email || !password || !deviceId) {
      throw new Error("email, password and deviceId are required for design platform login");
    }

    const response = await this.http.post(
      "api/auth/login",
      { email, password, deviceId },
      {
        headers: artImageLocalServerHeaders(deviceId),
      },
    );
    const data = this.unwrapApiData(response.data) as Record<string, unknown>;
    const accessToken = typeof data.accessToken === "string" ? data.accessToken.trim() : "";
    if (!accessToken) {
      throw new Error("design platform login did not return accessToken");
    }

    return {
      accessToken,
      cookie: cookieHeaderFromSetCookie(response.headers["set-cookie"]),
      deviceId,
      user: data.user,
    };
  }

  async redeemArtImageLocalActivation(payload: ArtImageLocalActivationRedeemPayload) {
    if (!this.useArtImageLocalAdapter()) {
      throw new Error("design platform activation is only available for art_image_local adapter");
    }

    const code = payload.code.trim();
    const deviceId = payload.deviceId.trim();
    const deviceLabel = String(payload.deviceLabel || "智能客服工作台").trim();
    if (!code || !deviceId) {
      throw new Error("activation code and deviceId are required for design platform activation");
    }

    const response = await this.http.post(
      "api/activation/redeem",
      { code, deviceId, deviceLabel },
      {
        headers: artImageLocalServerHeaders(deviceId),
      },
    );
    return this.unwrapApiData(response.data);
  }

  async createDesignJob(payload: DesignPlatformJobPayload) {
    if (this.useDurableGenerationAdapter()) {
      throw new Error(`${appConfig.designPlatformAdapter} generation must be dispatched through DesignPlatformExecutionService`);
    }

    const response = await this.http.post("v1/design-jobs", payload);
    return response.data;
  }

  async uploadAsset(payload: Record<string, unknown>) {
    if (this.useArtImageLocalAdapter()) {
      return this.uploadArtImageLocalAsset(payload);
    }
    if (this.useZhenxiExternalAdapter()) {
      return this.prepareZhenxiExternalAsset(payload);
    }

    const response = await this.http.post("v1/assets/upload", payload);
    return response.data;
  }

  async getDesignJob(externalJobId: string) {
    if (this.useDurableGenerationAdapter()) {
      throw new Error(`${appConfig.designPlatformAdapter} status must be read from durable execution: ${externalJobId}`);
    }

    const response = await this.http.get(`v1/design-jobs/${encodeURIComponent(externalJobId)}`);
    return response.data;
  }

  async getDesignJobResults(externalJobId: string) {
    if (this.useArtImageLocalAdapter()) {
      throw new Error(`art_image_local results must be read from durable execution: ${externalJobId}`);
    }
    if (this.useZhenxiExternalAdapter()) {
      throw new Error(`zhenxi_external results must be read from durable execution: ${externalJobId}`);
    }

    const response = await this.http.get(`v1/design-jobs/${encodeURIComponent(externalJobId)}/results`);
    return response.data;
  }

  async cancelDesignJob(externalJobId: string) {
    if (this.useDurableGenerationAdapter()) {
      return {
        externalJobId,
        status: "cancelled",
        cancellationMode: "reject_late_result",
      };
    }

    const response = await this.http.post(`v1/design-jobs/${encodeURIComponent(externalJobId)}/cancel`);
    return response.data;
  }

  isArtImageLocalAdapter() {
    return this.useArtImageLocalAdapter();
  }

  isDurableGenerationAdapter() {
    return this.useDurableGenerationAdapter();
  }

  private useArtImageLocalAdapter() {
    return appConfig.designPlatformAdapter === "art_image_local";
  }

  private useZhenxiExternalAdapter() {
    return appConfig.designPlatformAdapter === "zhenxi_external";
  }

  private useZhenxiAiLoopbackAdapter() {
    return this.useArtImageLocalAdapter() || this.useZhenxiExternalAdapter();
  }

  private useDurableGenerationAdapter() {
    return this.useArtImageLocalAdapter() || this.useZhenxiExternalAdapter();
  }

  private applyTrustedRequestBoundary(config: InternalAxiosRequestConfig) {
    config.baseURL = trustedDesignPlatformBaseUrl().toString();
    config.timeout = appConfig.designPlatformTimeoutMs;
    config.maxRedirects = 0;
    config.adapter = this.guardedAdapter;
    config.proxy = false;
    config.validateStatus = trustedValidateStatus;
    config.transformRequest = copyTransform(trustedTransformRequest);
    config.transformResponse = copyTransform(trustedTransformResponse);
    config.allowAbsoluteUrls = false;
    delete config.transport;
    delete config.socketPath;
    delete config.allowedSocketPaths;
    delete config.httpAgent;
    delete config.httpsAgent;
    delete config.beforeRedirect;
    delete config.auth;
    delete config.lookup;
    delete config.family;
    delete config.insecureHTTPParser;
    delete config.fetchOptions;
    delete config.httpVersion;
    delete config.http2Options;
  }

  private applyTrustedCredentialHeaders(config: InternalAxiosRequestConfig) {
    const headers = AxiosHeaders.from(config.headers);
    const explicitDeviceId = acceptsExplicitDeviceId(config.url)
      ? String(headers.get("x-art-device-id") || "")
      : "";
    const credentials = designPlatformCredentialsForTarget(config.baseURL, config.url, explicitDeviceId);
    headers.delete("Authorization");
    headers.delete("Cookie");
    headers.delete("x-art-device-id");
    headers.delete("Proxy-Authorization");
    headers.delete("Host");
    if (credentials.authorization) headers.set("Authorization", credentials.authorization);
    if (credentials.cookie) headers.set("Cookie", credentials.cookie);
    if (credentials.deviceId) headers.set("x-art-device-id", credentials.deviceId);
    config.headers = headers;
  }

  private removeCredentialHeaders(config: InternalAxiosRequestConfig) {
    const headers = AxiosHeaders.from(config.headers);
    headers.delete("Authorization");
    headers.delete("Cookie");
    headers.delete("x-art-device-id");
    headers.delete("Proxy-Authorization");
    headers.delete("Host");
    config.headers = headers;
  }

  private async uploadArtImageLocalAsset(payload: Record<string, unknown>) {
    const localPath = typeof payload.localPath === "string" ? payload.localPath : "";
    if (!localPath) {
      throw new Error("asset localPath is required for art_image_local adapter");
    }

    const fileName = sanitizeMultipartFileName(
      String(payload.fileName || path.basename(localPath) || `${randomUUID()}.png`),
    );
    const mimeType = inferMimeType(String(payload.mimeType || ""), fileName, localPath);
    const buffer = await readFile(localPath);
    const body = buildMultipartBody("file", fileName, mimeType, buffer);
    const response = await this.http.post("api/local-assets", body.buffer, {
      headers: {
        "Content-Type": `multipart/form-data; boundary=${body.boundary}`,
        "Content-Length": String(body.buffer.length),
      },
    });
    const data = this.unwrapApiData(response.data) as { url?: string; fileName?: string; mimeType?: string; size?: number };
    if (!data.url) {
      throw new Error("design platform did not return uploaded asset url");
    }

    return {
      assetId: data.url,
      remoteAssetId: data.url,
      url: data.url,
      fileName: data.fileName || fileName,
      mimeType: data.mimeType || mimeType,
      size: data.size,
    };
  }

  private async prepareZhenxiExternalAsset(payload: Record<string, unknown>) {
    const localPath = typeof payload.localPath === "string" ? payload.localPath : "";
    if (!localPath || !path.isAbsolute(localPath)) {
      throw new Error("asset localPath is required for zhenxi_external adapter");
    }

    const fileName = sanitizeMultipartFileName(
      String(payload.fileName || path.basename(localPath) || `${randomUUID()}.png`),
    );
    const mimeType = inferMimeType(String(payload.mimeType || ""), fileName, localPath);
    const buffer = await readFile(localPath);
    return {
      assetId: localPath,
      remoteAssetId: localPath,
      url: localPath,
      localPath,
      fileName,
      mimeType,
      size: buffer.length,
    };
  }

  private async enrichArtImageLocalHealth(data: unknown, http: AxiosInstance) {
    if (!isRecord(data)) return data;
    const localDemo = isRecord(data.localDemo) ? data.localDemo : {};
    if (typeof localDemo.localGenerateEnabled === "boolean") return data;

    const localGenerateEnabled = await this.probeArtImageLocalGenerateEndpoint(http);
    if (typeof localGenerateEnabled !== "boolean") return data;
    return {
      ...data,
      localDemo: {
        ...localDemo,
        localGenerateEnabled,
      },
    };
  }

  private async probeArtImageLocalGenerateEndpoint(http: AxiosInstance): Promise<boolean | null> {
    try {
      const response = await http.request({ method: "OPTIONS", url: "api/local-generate" });
      return artImageLocalGenerateAvailabilityFromHeaders(response.headers);
    } catch (error) {
      if (!axios.isAxiosError(error) || !error.response) return null;
      const availability = artImageLocalGenerateAvailabilityFromHeaders(error.response.headers);
      if (typeof availability === "boolean") return availability;
      if (error.response.status === 404) return false;
      return null;
    }
  }

  async executeArtImageLocalGeneration(
    payload: DesignPlatformJobPayload,
    externalJobId: string,
  ): Promise<ArtImageLocalGenerationOutcome> {
    let requestBody: Awaited<ReturnType<DesignPlatformClient["buildArtImageLocalRequest"]>>;
    try {
      requestBody = await this.buildArtImageLocalRequest({ ...payload, requestId: externalJobId });
    } catch (error) {
      return {
        status: "failed",
        images: [],
        refundStatus: "not_required",
        errorCode: "LOCAL_REQUEST_BUILD_FAILED",
        errorMessage: this.publicErrorMessage(error),
        httpStatus: 0,
      };
    }

    const slotOutcomes = await Promise.all(
      Array.from({ length: CUSTOMER_DESIGN_CANDIDATE_COUNT }, (_, index) =>
        this.executeArtImageLocalSlot(requestBody, externalJobId, index + 1),
      ),
    );
    const unknown = slotOutcomes.find((outcome) => outcome.status === "outcome_unknown");
    if (unknown?.status === "outcome_unknown") {
      return {
        status: "outcome_unknown",
        images: [],
        refundStatus: "unknown",
        errorCode: unknown.errorCode,
        errorMessage: `candidate slot ${unknown.slot} outcome is unknown; automatic retry is blocked: ${unknown.errorMessage}`,
        ...(unknown.httpStatus ? { httpStatus: unknown.httpStatus } : {}),
      };
    }

    const knownOutcomes = slotOutcomes.filter(
      (outcome): outcome is Exclude<ArtImageLocalSlotOutcome, { status: "outcome_unknown" }> =>
        outcome.status !== "outcome_unknown",
    );
    const refund = aggregateArtImageSlotRefunds(knownOutcomes);
    const successful = knownOutcomes.filter(
      (outcome): outcome is Extract<ArtImageLocalSlotOutcome, { status: "completed" }> => outcome.status === "completed",
    );
    const httpStatus = Math.max(0, ...knownOutcomes.map((outcome) => Number(outcome.httpStatus || 0)));
    if (!successful.length) {
      const failed = knownOutcomes.filter(
        (outcome): outcome is Extract<ArtImageLocalSlotOutcome, { status: "failed" }> => outcome.status === "failed",
      );
      return {
        status: "failed",
        images: [],
        refundStatus: refund.status,
        refundSummary: refund.summary,
        errorCode: "MACHINE_TERMINAL_ALL_FAILED",
        errorMessage: failed.map((outcome) => `slot ${outcome.slot}: ${outcome.errorMessage}`).join("; "),
        httpStatus,
      };
    }

    return {
      status: "completed",
      images: successful.map((outcome) => outcome.image),
      refundStatus: refund.status,
      refundSummary: refund.summary,
      httpStatus,
    };
  }

  private async executeArtImageLocalSlot(
    requestBody: Awaited<ReturnType<DesignPlatformClient["buildArtImageLocalRequest"]>>,
    externalJobId: string,
    slot: number,
  ): Promise<ArtImageLocalSlotOutcome> {
    const prompts = Array.isArray(requestBody.prompts) ? requestBody.prompts : [];
    const prompt = String(prompts[slot - 1] || requestBody.prompt || "").trim();
    const slotRequest = {
      ...requestBody,
      requestId: `${externalJobId}:slot:${slot}`,
      prompt,
      prompts: [prompt],
      count: 1,
      concurrency: 1,
    };
    try {
      const response = await this.http.post("api/local-generate", slotRequest);
      const data = this.unwrapApiData(response.data) as { results?: ArtImageLocalResult[]; credits?: unknown; refund?: unknown };
      if (!isRecord(data) || !Array.isArray(data.results) || data.results.length !== 1) {
        return {
          status: "outcome_unknown",
          slot,
          refundStatus: "unknown",
          errorCode: "MALFORMED_SLOT_SUCCESS_RESPONSE",
          errorMessage: "design platform did not return exactly one result for the dispatched candidate slot",
          httpStatus: Number(response.status || 200),
        };
      }
      // Run the existing recursive sanitizer as a defense-in-depth assertion; durable storage uses a stricter field whitelist.
      void sanitizeArtImageLocalRaw(data);
      const [result] = data.results;
      const refund = artImageRefundOutcome(data);
      if (result.status === "success" && result.url) {
        const dimensions = parseImageSize(appConfig.designPlatformImageSize);
        return {
          status: "completed",
          slot,
          image: {
            imageId: `candidate_${slot}`,
            downloadUrl: this.absoluteDesignPlatformUrl(String(result.url)),
            width: dimensions.width,
            height: dimensions.height,
          },
          refundStatus: refund.status === "unknown" ? "not_required" : refund.status,
          refundSummary: refund.summary,
          httpStatus: Number(response.status || 200),
        };
      }
      if (result.status === "failed") {
        return {
          status: "failed",
          slot,
          refundStatus: refund.status,
          refundSummary: refund.summary,
          errorCode: "MACHINE_TERMINAL_SLOT_FAILED",
          errorMessage: result.error || "design platform returned no generated image for this candidate slot",
          httpStatus: Number(response.status || 200),
        };
      }
      return {
        status: "outcome_unknown",
        slot,
        refundStatus: "unknown",
        errorCode: "MALFORMED_SLOT_SUCCESS_RESPONSE",
        errorMessage: "design platform returned a candidate result without a verifiable terminal status and URL",
        httpStatus: Number(response.status || 200),
      };
    } catch (error) {
      const uncertainTransport = isUncertainArtImageDispatchError(error);
      if (!uncertainTransport && axios.isAxiosError(error) && error.response) {
        const responseData = isRecord(error.response.data) ? error.response.data : {};
        const refund = artImageRefundOutcome(responseData);
        return {
          status: "failed",
          slot,
          refundStatus: refund.status,
          ...(refund.summary ? { refundSummary: refund.summary } : {}),
          errorCode: artImageErrorCode(error),
          errorMessage: this.publicErrorMessage(error),
          httpStatus: Number(error.response.status || 0),
        };
      }
      return {
        status: "outcome_unknown",
        slot,
        refundStatus: "unknown",
        errorCode: axios.isAxiosError(error) ? artImageErrorCode(error) : "LOCAL_GENERATION_DISPATCH_OUTCOME_UNKNOWN",
        errorMessage: this.publicErrorMessage(error),
        ...(axios.isAxiosError(error) && error.response?.status ? { httpStatus: error.response.status } : {}),
      };
    }
  }

  async executeDurableGeneration(
    payload: DesignPlatformJobPayload,
    externalJobId: string,
  ): Promise<ArtImageLocalGenerationOutcome> {
    if (this.useZhenxiExternalAdapter()) return this.executeZhenxiExternalGeneration(payload, externalJobId);
    return this.executeArtImageLocalGeneration(payload, externalJobId);
  }

  private async executeZhenxiExternalGeneration(
    payload: DesignPlatformJobPayload,
    externalJobId: string,
  ): Promise<ArtImageLocalGenerationOutcome> {
    if (!this.zhenxiMcp?.enabled()) {
      return {
        status: "failed",
        images: [],
        refundStatus: "not_required",
        errorCode: "ZHENXI_MCP_DISABLED",
        errorMessage: "Zhenxi MCP is disabled; direct external API fallback is prohibited",
        httpStatus: 0,
      };
    }
    return this.executeZhenxiExternalGenerationViaMcp(payload, externalJobId);
  }

  private async executeZhenxiExternalGenerationViaMcp(
    payload: DesignPlatformJobPayload,
    externalJobId: string,
  ): Promise<ArtImageLocalGenerationOutcome> {
    try {
      if (payload.designType === "zhenxi_image" && payload.requirements?.useRealSkuImages === false) {
        const settings = zhenxiImageSettings(payload);
        const data = await this.zhenxiMcp!.generateNativeImages({
          prompt: buildDesignPrompt(payload),
          count: CUSTOMER_DESIGN_CANDIDATE_COUNT,
          size: settings.size,
          ratio: settings.ratio,
          requestId: externalJobId,
          cardType: "空白模板",
          templateGroupKey: "blank",
        });
        return this.zhenxiNativeOutcome(data, settings.size);
      }
      const request = await this.buildZhenxiExternalMcpRequest({ ...payload, requestId: externalJobId });
      const data = await this.zhenxiMcp!.generateDesign(request);
      return this.zhenxiExternalOutcome(data, 200, request.size);
    } catch (error) {
      if (error instanceof ZhenxiMcpToolError) {
        if (error.outcomeUnknown) {
          return {
            status: "outcome_unknown",
            images: [],
            refundStatus: "unknown",
            errorCode: error.code,
            errorMessage: error.message,
            ...(error.status ? { httpStatus: error.status } : {}),
          };
        }
        return {
          status: "failed",
          images: [],
          refundStatus: "not_required",
          errorCode: error.code,
          errorMessage: error.message,
          httpStatus: error.status,
        };
      }
      return {
        status: "failed",
        images: [],
        refundStatus: "not_required",
        errorCode: "ZHENXI_MCP_REQUEST_BUILD_FAILED",
        errorMessage: this.publicErrorMessage(error),
        httpStatus: 0,
      };
    }
  }

  private zhenxiExternalOutcome(
    data: Record<string, unknown>,
    httpStatus: number,
    imageSize = appConfig.designPlatformImageSize,
  ): ArtImageLocalGenerationOutcome {
    if (!isRecord(data) || !Array.isArray(data.images)) {
      return {
        status: "outcome_unknown",
        images: [],
        refundStatus: "unknown",
        errorCode: "MALFORMED_SUCCESS_RESPONSE",
        errorMessage: "zhenxi external API returned malformed 2xx response; acceptance and refund are unknown",
        httpStatus,
      };
    }

    void sanitizeArtImageLocalRaw(data);
    const results = data.images as ArtImageLocalResult[];
    const successful = results.filter((item) => item.status === "success" && item.url);
    const refund = artImageRefundOutcome(data);
    if (!successful.length) {
      const firstError = results.find((item) => item.error)?.error || "zhenxi external API returned no generated images";
      return {
        status: "failed",
        images: [],
        refundStatus: refund.status,
        refundSummary: refund.summary,
        errorCode: "MACHINE_TERMINAL_ALL_FAILED",
        errorMessage: firstError,
        httpStatus,
      };
    }

    return {
      status: "completed",
      images: successful.map((item, index) => ({
        imageId: `candidate_${index + 1}`,
        downloadUrl: this.absoluteDesignPlatformUrl(String(item.url)),
        width: parseImageSize(imageSize).width,
        height: parseImageSize(imageSize).height,
      })),
      refundStatus:
        successful.length === results.length && refund.status === "unknown"
          ? "not_required"
          : refund.status,
      refundSummary: refund.summary,
      httpStatus,
    };
  }

  private zhenxiNativeOutcome(data: Record<string, unknown>, imageSize: string): ArtImageLocalGenerationOutcome {
    const responses = Array.isArray(data.results)
      ? data.results.map((entry) => isRecord(entry) ? entry : {})
      : [{ status: 201, body: data }];
    const urls = responses
      .filter((entry) => Number(entry.status || 0) >= 200 && Number(entry.status || 0) < 300)
      .map((entry) => firstGeneratedImageUrl(isRecord(entry.body) ? entry.body : entry))
      .filter((value): value is string => Boolean(value));
    if (!urls.length) {
      return {
        status: "outcome_unknown",
        images: [],
        refundStatus: "unknown",
        errorCode: "ZHENXI_NATIVE_RESULT_INVALID",
        errorMessage: "Zhenxi native MCP returned no verifiable image URL; automatic retry is blocked",
        httpStatus: 200,
      };
    }
    const dimensions = parseImageSize(imageSize);
    return {
      status: "completed",
      images: urls.map((url, index) => ({
        imageId: `candidate_${index + 1}`,
        downloadUrl: this.absoluteDesignPlatformUrl(url),
        width: dimensions.width,
        height: dimensions.height,
      })),
      refundStatus: "not_required",
      httpStatus: 200,
    };
  }

  private async buildZhenxiExternalRequest(payload: DesignPlatformJobPayload) {
    const prompt = buildDesignPrompt(payload);
    const count = CUSTOMER_DESIGN_CANDIDATE_COUNT;
    const settings = zhenxiImageSettings(payload);
    const failedAssets = payload.assets.filter((asset) => asset.uploadError);
    if (failedAssets.length) {
      throw new Error(`design asset upload failed: ${failedAssets.map((asset) => asset.fileName || asset.assetId).join(", ")}`);
    }

    const requiresRealImages = payload.requirements?.useRealSkuImages !== false;
    if (requiresRealImages) {
      const realRefs = inspectRealDesignReferences({
        assets: payload.assets,
        bundle: payload.bundle,
        requireCustomerAssets: true,
        requireCompleteBundle: payload.designType !== "zhenxi_image",
      });
      if (!realRefs.usableAssetCount) {
        throw new Error("customer reference image is required for real design generation");
      }
      if (payload.designType !== "zhenxi_image" && !realRefs.bundleRefs.length) {
        throw new Error("SKU or gift-box image is required for real design generation");
      }
      if (payload.designType !== "zhenxi_image" && realRefs.unusableBundleImageCount) {
        throw new Error("every SKU and gift-box item must have a usable PNG/JPG/WebP image before design generation");
      }
    }

    const files = await this.zhenxiExternalFiles(payload.assets);
    if (!files.length) {
      throw new Error("zhenxi external API requires at least one uploaded reference image file");
    }
    if (files.length > 10) {
      throw new Error("zhenxi external API accepts at most 10 reference image files; reduce SKU/gift-box/customer images before generation");
    }

    return {
      body: buildMultipartFormData(
        {
          requestId: payload.requestId,
          prompt,
          count: String(count),
          size: settings.size,
          ratio: settings.ratio,
          cardType: "空白模板",
          templateGroupKey: "blank",
        },
        files,
      ),
      count,
      referencePaths: files.map((file) => file.localPath).filter((value): value is string => Boolean(value)),
    };
  }

  private async buildZhenxiExternalMcpRequest(payload: DesignPlatformJobPayload) {
    const request = await this.buildZhenxiExternalRequest(payload);
    const settings = zhenxiImageSettings(payload);
    return {
      prompt: buildDesignPrompt(payload),
      count: request.count,
      size: settings.size,
      ratio: settings.ratio,
      referencePaths: request.referencePaths,
      requestId: payload.requestId,
      cardType: "空白模板",
      templateGroupKey: "blank",
      copyModule: zhenxiCopyModule(payload),
    };
  }

  private async zhenxiExternalFiles(assets: Array<Record<string, unknown>>): Promise<ZhenxiExternalMultipartFile[]> {
    const files: ZhenxiExternalMultipartFile[] = [];
    const seen = new Set<string>();
    for (const asset of assets) {
      const localPath = String(asset.localPath || asset.filePath || asset.path || "").trim();
      if (!localPath || !path.isAbsolute(localPath)) continue;
      const normalized = path.resolve(localPath);
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const fileName = sanitizeMultipartFileName(String(asset.fileName || path.basename(normalized) || `${randomUUID()}.png`));
      const mimeType = inferMimeType(String(asset.mimeType || ""), fileName, normalized);
      files.push({
        fieldName: "files",
        fileName,
        mimeType,
        buffer: await readFile(normalized),
        localPath: normalized,
      });
    }
    return files;
  }

  private async buildArtImageLocalRequest(payload: DesignPlatformJobPayload) {
    const prompt = buildGiftBoxPrompt(payload);
    const count = CUSTOMER_DESIGN_CANDIDATE_COUNT;
    const failedAssets = payload.assets.filter((asset) => asset.uploadError);
    if (failedAssets.length) {
      throw new Error(`design asset upload failed: ${failedAssets.map((asset) => asset.fileName || asset.assetId).join(", ")}`);
    }

    const assetRefs = artImageObjectRefs(payload.assets);
    const bundleRefs = await this.bundleImageRefs(payload.bundle);
    const requiresRealImages = payload.requirements?.useRealSkuImages !== false;
    if (requiresRealImages) {
      const realRefs = inspectRealDesignReferences({
        assets: assetRefs.map((url, index) => ({ id: `uploaded_asset_${index + 1}`, url })),
        bundle: payload.bundle,
      });
      if (!realRefs.usableAssetCount) {
        throw new Error("customer reference image is required for real design generation");
      }
      if (!realRefs.bundleRefs.length) {
        throw new Error("SKU or gift-box image is required for real design generation");
      }
      if (realRefs.unusableBundleImageCount) {
        throw new Error("every SKU and gift-box item must have a usable PNG/JPG/WebP image before design generation");
      }
      if (!bundleRefs.length) {
        throw new Error("no uploadable SKU or gift-box images were found for real design generation");
      }
    }
    const objectRefs = uniqueRefs([...assetRefs, ...bundleRefs]).slice(0, 12);

    return {
      requestId: payload.requestId,
      type: "image",
      module: "poster_copy",
      projectId: payload.orderId || payload.requestId,
      projectName: `客服礼盒出图-${payload.customerId}`,
      prompt,
      prompts: Array.from({ length: count }, (_, index) => `${prompt}\n\n候选图 ${index + 1}：构图、角度和背景要和其他候选图不同，但商品、礼盒和素材必须一致。`),
      count,
      concurrency: count,
      size: appConfig.designPlatformImageSize,
      ratio: appConfig.designPlatformImageRatio,
      category: "gift_box",
      templateGroupKey: "gift_box_render",
      cardType: appConfig.designPlatformCardType,
      objectRefs,
      expert:
        "你是礼盒产品摆拍设计师。只生成真实产品摆拍效果图，不生成海报排版，不添加营销标题，不更换商品，不虚构包装。",
    };
  }

  private async bundleImageRefs(bundle: Record<string, unknown>) {
    const refs = normalizeBundleImageRefs(bundle);
    const uploadedRefs: string[] = [];
    for (const ref of refs) {
      if (isAcceptedReferenceUrl(ref)) {
        uploadedRefs.push(ref);
        continue;
      }

      if (!path.isAbsolute(ref)) continue;
      const fileName = path.basename(ref);
      const mimeType = inferMimeType("", fileName, ref);
      const uploaded = await this.uploadArtImageLocalAsset({
        assetId: `bundle_${safeIdPart(fileName)}`,
        fileName,
        mimeType,
        localPath: ref,
        role: "sku_image",
        source: "bundle",
      });
      if (uploaded.remoteAssetId) uploadedRefs.push(String(uploaded.remoteAssetId));
    }
    return uploadedRefs;
  }

  private absoluteDesignPlatformUrl(url: string) {
    if (/^https?:\/\//i.test(url)) return url;
    const base = appConfig.designPlatformBaseUrl.replace(/\/+$/, "");
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  private unwrapApiData(data: unknown) {
    if (data && typeof data === "object" && "ok" in data && "data" in data) {
      return (data as { data: unknown }).data;
    }
    return data;
  }

  private publicErrorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      const responseData = error.response?.data as any;
      const platformMessage = responseData?.error?.message || responseData?.message;
      if (platformMessage) return String(platformMessage);
      if (error.response?.status) return `design platform request failed with HTTP ${error.response.status}`;
    }
    return error instanceof Error ? error.message : "unknown design platform error";
  }
}

function buildDesignPrompt(payload: DesignPlatformJobPayload) {
  if (payload.designType !== "zhenxi_image") return buildGiftBoxPrompt(payload);
  const zhenxi = isRecord(payload.requirements?.zhenxi) ? payload.requirements.zhenxi : {};
  const prompt = String(zhenxi.prompt || payload.customerText || "").trim();
  const capability = String(zhenxi.capability || payload.scene || "图片设计").trim();
  const deliverableLabel = String(zhenxi.deliverableLabel || zhenxi.deliverable || "").trim();
  const exactCopy = String(zhenxi.copyText || "").trim();
  const physicalSize = String(zhenxi.physicalSize || "").trim();
  const logoMode = String(zhenxi.logoMode || "").trim();
  const visualContentMode = String(zhenxi.visualContentMode || "").trim();
  const exactCopyOnly = zhenxi.exactCopyOnly === true;
  const forbidInventedProducts = zhenxi.forbidInventedProducts !== false;
  const settings = zhenxiImageSettings(payload);
  const assetCount = payload.assets.filter((asset) => !asset.uploadError).length;
  return [
    `设计类型：${capability}`,
    deliverableLabel ? `交付物：${deliverableLabel}，只制作这一项，不要擅自增加贺卡、吊牌、腰封或其他物料。` : "",
    `客户原始需求：${prompt}`,
    exactCopy ? `必须逐字使用以下客户文案，不得改写、增删、转繁体或生成乱码：${exactCopy}` : "",
    exactCopy ? "指定中文必须使用端正、清晰、结构正确的印刷字形；不得用会改变偏旁、笔画或字义的变形艺术字。" : "",
    exactCopyOnly ? "除上述指定文案外，画面中禁止出现任何其他汉字、英文、数字、占位文字或装饰性伪文字。" : "",
    physicalSize ? `实际成品尺寸：${physicalSize}；构图和文字安全边距必须适配这个尺寸。` : "",
    logoMode === "none" ? "客户明确不放 Logo，禁止添加任何 Logo 或虚构品牌标识。" : "",
    assetCount ? `参考素材：共 ${assetCount} 张。必须保留素材中的真实产品、人物、Logo、包装和文字，不得擅自替换。` : "本次没有参考素材，只按客户明确描述创作。",
    visualContentMode === "graphic_only"
      ? "画面内容模式：纯平面视觉。不得出现或虚构商品、礼盒、包装、杯子、雨伞、毛巾、文具及其他实物产品。"
      : "",
    visualContentMode === "real_product"
      ? "画面内容模式：真实商品展示。只能使用参考素材和已选商品库中的商品，外观、颜色、数量、包装关系必须一致。"
      : "",
    forbidInventedProducts && visualContentMode !== "real_product"
      ? "未提供真实商品素材，禁止为了丰富画面自行增加任何商品或包装。"
      : "",
    `输出尺寸：${settings.size}；画幅比例：${settings.ratio}。`,
    zhenxi.transparent === true ? "背景必须透明。" : "背景按客户需求处理。",
    "必须高清、无水印。",
    "成品必须达到可直接发客户确认的商业设计条件：主体完整、文字在安全区内、手机缩略图可读、不得只是无信息的通用占位背景。",
    "不得虚构客户未提供的 Logo、品牌或组织名、行动号召、预约或联系方式区域、二维码、电话、微信号或网址。",
    "一次生成 4 张彼此可区分、但都严格符合上述需求的候选设计稿。",
    payload.revision ? `修改要求：${JSON.stringify(payload.revision)}` : "",
  ].filter(Boolean).join("\n");
}

function zhenxiImageSettings(payload: DesignPlatformJobPayload) {
  const zhenxi = isRecord(payload.requirements?.zhenxi) ? payload.requirements.zhenxi : {};
  const requestedSize = String(zhenxi.size || "").trim();
  const requestedRatio = String(zhenxi.ratio || "").trim();
  return {
    size: /^\d{2,5}x\d{2,5}$/i.test(requestedSize) ? requestedSize : appConfig.designPlatformImageSize,
    ratio: /^\d{1,2}:\d{1,2}$/i.test(requestedRatio) ? requestedRatio : appConfig.designPlatformImageRatio,
  };
}

function zhenxiCopyModule(payload: DesignPlatformJobPayload): "poster_copy" | "xiaohongshu" | "detail_page" {
  const zhenxi = isRecord(payload.requirements?.zhenxi) ? payload.requirements.zhenxi : {};
  const module = String(zhenxi.copyModule || "poster_copy");
  return ["xiaohongshu", "detail_page"].includes(module) ? module as "xiaohongshu" | "detail_page" : "poster_copy";
}

function firstGeneratedImageUrl(value: unknown, depth = 0): string {
  if (depth > 6 || value === null || value === undefined) return "";
  if (typeof value === "string") return /^https?:\/\//i.test(value) || value.startsWith("/") ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstGeneratedImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isRecord(value)) return "";
  for (const key of ["file_url", "fileUrl", "image_url", "imageUrl", "url"]) {
    const found = firstGeneratedImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const key of ["result", "data", "content", "images", "outputs"]) {
    const found = firstGeneratedImageUrl(value[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function buildGiftBoxPrompt(payload: DesignPlatformJobPayload) {
  const budget = payload.budget || {};
  const bundle = payload.bundle || {};
  const items = normalizeBundleItems(bundle);
  const assetCount = payload.assets.filter((asset) => !asset.uploadError).length;
  const revision = payload.revision ? `\n修改要求：${JSON.stringify(payload.revision)}` : "";

  return [
    "生成企业客户礼盒真实产品摆拍效果图。",
    `客户场景：${payload.scene || "未注明，按商务礼赠处理"}`,
    `客户原话/用途：${payload.customerText || "未提供"}`,
    `预算信息：${JSON.stringify(budget)}`,
    `礼盒组合：${items.length ? items.join("；") : JSON.stringify(bundle)}`,
    `已上传参考素材数量：${assetCount}，这些素材包含客户 Logo、参考图或 SKU 商品图时必须优先遵守。`,
    "硬性要求：",
    "- 必须是高清、无水印、真实产品摆拍风格。",
    "- 必须展示礼盒和全部 SKU 商品，不允许凭空替换商品、包装、品牌或数量。",
    "- 不要做电商详情页、九宫格、营销海报、硬广排版或大段文字。",
    "- 可以使用自然桌面、门店、会议室、企业福利发放、礼盒开箱等真实场景。",
    "- 画面要像客服可以直接发给客户确认的候选效果图。",
    revision,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeBundleItems(bundle: Record<string, unknown>) {
  const items = Array.isArray((bundle as any).items) ? ((bundle as any).items as any[]) : [];
  return items.map((item, index) => {
    const name = item.name || item.productName || item.skuName || item.skuCode || `商品${index + 1}`;
    const price = item.salePrice || item.price || item.unitPrice;
    const quantity = item.quantity || item.count || 1;
    const category = item.category || item.type || "";
    return [name, category ? `分类:${category}` : "", price ? `售价:${price}` : "", quantity ? `数量:${quantity}` : ""]
      .filter(Boolean)
      .join(" ");
  });
}

function artImageObjectRefs(assets: Array<Record<string, unknown>>) {
  return assets
    .map((asset) => String(asset.remoteAssetId || asset.url || ""))
    .filter(isAcceptedReferenceUrl)
    .slice(0, 12);
}

function normalizeBundleImageRefs(bundle: Record<string, unknown>) {
  const refs: string[] = [];
  const items = Array.isArray((bundle as any).items) ? ((bundle as any).items as any[]) : [];
  for (const item of items) {
    collectBundleEntryImageRefs(refs, item);
  }
  if ((bundle as any).giftBox) collectBundleEntryImageRefs(refs, (bundle as any).giftBox);
  return uniqueRefs(refs).slice(0, 12);
}

function collectBundleEntryImageRefs(refs: string[], entry: Record<string, unknown>) {
  const directKeys = [
    "localPath",
    "downloadUrl",
    "url",
    "publicUrl",
    "path",
    "filePath",
    "mainImage",
    "mainImageUrl",
    "mainImagePath",
    "imageUrl",
    "imagePath",
    "productImage",
    "skuImage",
    "primaryImage",
  ];
  for (const key of directKeys) {
    collectStringRef(refs, entry?.[key]);
  }
  const arrayKeys = ["images", "imageUrls", "imagePaths", "angleImages", "multiAngleImages", "gallery"];
  for (const key of arrayKeys) {
    collectStringArrayRefs(refs, entry?.[key]);
  }
}

function collectStringRef(refs: string[], value: unknown) {
  if (typeof value === "string" && value.trim()) refs.push(value.trim());
}

function collectStringArrayRefs(refs: string[], value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      collectStringRef(refs, item);
      continue;
    }
    if (item && typeof item === "object") collectBundleEntryImageRefs(refs, item as Record<string, unknown>);
  }
}

function uniqueRefs(refs: string[]) {
  return [...new Set(refs.filter(Boolean))];
}

function sanitizeArtImageLocalRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeArtImageLocalRaw);
  if (!isRecord(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes("prompt")) continue;
    sanitized[key] = sanitizeArtImageLocalRaw(nested);
  }
  return sanitized;
}

function isAcceptedReferenceUrl(value: string) {
  if (value.startsWith("/local-assets/") || value.startsWith("/generated/")) return true;
  if (isLoopbackDesignReferenceUrl(value)) return true;
  return /^https:\/\/[^\s]+$/i.test(value);
}

function isLoopbackDesignReferenceUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    if (!url.pathname.startsWith("/local-assets/") && !url.pathname.startsWith("/generated/")) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127\./.test(hostname);
  } catch {
    return false;
  }
}

function inferMimeType(input: string, fileName: string, localPath: string) {
  if (input.startsWith("image/")) return input;
  const extension = path.extname(fileName || localPath).toLowerCase();
  return imageMimeByExtension[extension] || "image/png";
}

function sanitizeMultipartFileName(fileName: string) {
  return fileName.replace(/[\r\n"\\]/g, "_").slice(0, 180) || `${randomUUID()}.png`;
}

function cookieHeaderFromSetCookie(value: unknown) {
  const cookies = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim() || "")
    .filter(Boolean)
    .join("; ");
}

function buildMultipartBody(fieldName: string, fileName: string, mimeType: string, file: Buffer) {
  return buildMultipartFormData({}, [{ fieldName, fileName, mimeType, buffer: file }]);
}

function buildMultipartFormData(fields: Record<string, string>, files: ZhenxiExternalMultipartFile[]) {
  const boundary = `----smart-kefu-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        [
          `--${boundary}`,
          `Content-Disposition: form-data; name="${sanitizeMultipartFieldName(name)}"`,
          "",
          value,
          "",
        ].join("\r\n"),
      ),
    );
  }
  for (const file of files) {
    chunks.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${sanitizeMultipartFieldName(file.fieldName)}"; filename="${file.fileName}"`,
      `Content-Type: ${file.mimeType}`,
      "",
      "",
    ].join("\r\n")));
    chunks.push(file.buffer);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    boundary,
    buffer: Buffer.concat(chunks),
  };
}

function sanitizeMultipartFieldName(fieldName: string) {
  return fieldName.replace(/[\r\n"\\]/g, "_").slice(0, 80) || "field";
}

function parseImageSize(size: string) {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return { width: 1024, height: 1024 };
  return {
    width: Number(match[1]) || 1024,
    height: Number(match[2]) || 1024,
  };
}

function artImageRefundOutcome(data: Record<string, unknown>): {
  status: "refunded" | "not_required" | "credit_bypass" | "failed" | "unknown";
  summary?: Record<string, unknown>;
} {
  const refund = isRecord(data.refund)
    ? data.refund
    : isRecord(data.credits) && isRecord(data.credits.refund)
      ? data.credits.refund
      : {};
  const rawStatus = String(refund.status || "").trim().toLowerCase();
  const reason = String(refund.reason || "").trim().toLowerCase();
  const status = rawStatus === "succeeded" || rawStatus === "refunded"
    ? "refunded"
    : rawStatus === "not_required" && reason === "credit_bypass"
      ? "credit_bypass"
      : rawStatus === "not_required"
        ? "not_required"
        : rawStatus === "failed"
          ? "failed"
          : "unknown";
  const summary: Record<string, unknown> = {};
  if (reason) summary.reason = reason.slice(0, 120);
  for (const source of ["requestedCredits", "refundedCredits", "chargedCredits"] as const) {
    const value = Number(refund[source]);
    if (Number.isFinite(value)) summary[source] = value;
  }
  if (typeof refund.alreadyRefunded === "boolean") summary.alreadyRefunded = refund.alreadyRefunded;
  if (isRecord(data.credits)) {
    for (const source of ["requestedCredits", "refundedCredits", "chargedCredits"] as const) {
      const value = Number(data.credits[source]);
      if (Number.isFinite(value) && summary[source] === undefined) summary[source] = value;
    }
  }
  return { status, ...(Object.keys(summary).length ? { summary } : {}) };
}

function aggregateArtImageSlotRefunds(
  outcomes: Array<Exclude<ArtImageLocalSlotOutcome, { status: "outcome_unknown" }>>,
): {
  status: "refunded" | "not_required" | "credit_bypass" | "failed" | "unknown";
  summary?: Record<string, unknown>;
} {
  const statuses = outcomes.map((outcome) => outcome.refundStatus);
  const status = statuses.includes("failed")
    ? "failed"
    : statuses.includes("unknown")
      ? "unknown"
      : statuses.includes("refunded")
        ? "refunded"
        : statuses.includes("credit_bypass")
          ? "credit_bypass"
          : "not_required";
  const summaries: Array<Record<string, unknown> & { slot: number }> = outcomes.flatMap((outcome) =>
    outcome.refundSummary ? [{ slot: outcome.slot, ...outcome.refundSummary }] : [],
  );
  if (!summaries.length) return { status };

  const summary: Record<string, unknown> = {
    slotRefunds: summaries.map((item) => ({
      slot: item.slot,
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
      ...(typeof item.alreadyRefunded === "boolean" ? { alreadyRefunded: item.alreadyRefunded } : {}),
    })),
  };
  for (const field of ["requestedCredits", "refundedCredits", "chargedCredits"] as const) {
    const values = summaries.map((item) => Number(item[field])).filter(Number.isFinite);
    if (values.length) summary[field] = values.reduce((total, value) => total + value, 0);
  }
  const alreadyRefunded = summaries
    .map((item) => item.alreadyRefunded)
    .filter((value): value is boolean => typeof value === "boolean");
  if (alreadyRefunded.length) summary.alreadyRefunded = alreadyRefunded.every(Boolean);
  const reasons = [...new Set(summaries.map((item) => String(item.reason || "").trim()).filter(Boolean))];
  if (reasons.length) summary.reason = reasons.length === 1 ? reasons[0] : "mixed_slot_outcomes";
  return { status, summary };
}

function artImageErrorCode(error: unknown) {
  if (!axios.isAxiosError(error)) return "LOCAL_REQUEST_BUILD_FAILED";
  const responseData = error.response?.data as any;
  const platformCode = String(responseData?.error?.code || responseData?.code || "").trim();
  if (platformCode) return platformCode.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  const code = String(error.code || "").trim();
  if (code) return code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  if (error.response?.status) return `HTTP_${error.response.status}`;
  return "DESIGN_PLATFORM_REQUEST_FAILED";
}

function isUncertainArtImageDispatchError(error: unknown) {
  if (!axios.isAxiosError(error)) return true;
  const code = String(error.code || "").trim().toUpperCase();
  if (code === "ECONNABORTED" || code === "ECONNRESET") return true;
  if (!error.response) return true;
  return Number(error.response?.status || 0) >= 500;
}

export function designPlatformCredentialsForTarget(
  baseUrl: string | undefined,
  requestUrl: string | undefined,
  explicitDeviceId = "",
) {
  try {
    const targetOrigin = new URL(String(requestUrl || ""), String(baseUrl || appConfig.designPlatformBaseUrl)).origin;
    const configuredBaseOrigin = new URL(appConfig.designPlatformBaseUrl).origin;
    if (appConfig.designPlatformAdapter === "zhenxi_external") {
      const apiKey =
        appConfig.designPlatformApiKey && targetOrigin === appConfig.designPlatformApiKeyOrigin
          ? appConfig.designPlatformApiKey
          : "";
      const compatibleAccessToken =
        appConfig.designPlatformAccessToken && targetOrigin === appConfig.designPlatformAccessTokenOrigin
          ? appConfig.designPlatformAccessToken
          : "";
      return {
        authorization: apiKey || compatibleAccessToken ? `Bearer ${apiKey || compatibleAccessToken}` : "",
        cookie: "",
        deviceId: "",
      };
    }
    const accessToken =
      appConfig.designPlatformAccessToken && targetOrigin === appConfig.designPlatformAccessTokenOrigin
        ? appConfig.designPlatformAccessToken
        : "";
    const apiKey =
      appConfig.designPlatformApiKey && targetOrigin === appConfig.designPlatformApiKeyOrigin
        ? appConfig.designPlatformApiKey
        : "";
    return {
      authorization: accessToken || apiKey ? `Bearer ${accessToken || apiKey}` : "",
      cookie:
        appConfig.designPlatformCookie && targetOrigin === appConfig.designPlatformCookieOrigin
          ? appConfig.designPlatformCookie
          : "",
      deviceId:
        targetOrigin === configuredBaseOrigin && String(explicitDeviceId || "").trim()
          ? String(explicitDeviceId).trim()
          : appConfig.designPlatformDeviceId && targetOrigin === appConfig.designPlatformDeviceIdOrigin
            ? appConfig.designPlatformDeviceId
            : "",
    };
  } catch {
    return { authorization: "", cookie: "", deviceId: "" };
  }
}

function trustedDesignPlatformBaseUrl() {
  const base = new URL(appConfig.designPlatformBaseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw designPlatformBoundaryError("configured base URL must use HTTP or HTTPS");
  }
  if (base.username || base.password || base.search || base.hash) {
    throw designPlatformBoundaryError("configured base URL must not contain credentials, query or fragment");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
  return base;
}

function artImageLocalDeviceHeaders(deviceId: string) {
  const explicitDeviceId = String(deviceId || "").trim();
  return explicitDeviceId
    ? {
        headers: {
          "x-art-device-id": explicitDeviceId,
        },
      }
    : undefined;
}

function artImageLocalServerHeaders(deviceId: string) {
  return {
    "x-art-client": "zhenxi-ai",
    "x-art-device-id": deviceId,
  };
}

function acceptsExplicitDeviceId(requestUrl: string | undefined) {
  return (
    requestUrl === "api/auth/login" ||
    requestUrl === "api/auth/session" ||
    requestUrl === "api/activation/redeem" ||
    requestUrl === "api/activation/status"
  );
}

function artImageLocalGenerateAvailabilityFromHeaders(headers: unknown): boolean | null {
  const allow = responseHeaderValue(headers, "allow");
  if (!allow) return null;
  return /\bPOST\b/i.test(allow);
}

function responseHeaderValue(headers: unknown, name: string) {
  if (!headers) return "";
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, name);
    if (value !== undefined && value !== null) return stringifyHeaderValue(value);
  }
  if (!isRecord(headers)) return "";
  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) return stringifyHeaderValue(value);
  }
  return "";
}

function stringifyHeaderValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return String(value || "");
}

function assertTrustedDesignPlatformTarget(baseUrl: string | undefined, requestUrl: string | undefined) {
  const trustedBase = trustedDesignPlatformBaseUrl();
  const rawUrl = String(requestUrl || "");
  if (!rawUrl || rawUrl !== rawUrl.trim()) {
    throw designPlatformBoundaryError("request URL must be a non-empty fixed relative path");
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(rawUrl) || /^[\\/]/.test(rawUrl) || rawUrl.includes("\\")) {
    throw designPlatformBoundaryError("absolute and protocol-relative request URLs are blocked");
  }
  if (rawUrl.includes("#")) {
    throw designPlatformBoundaryError("request URL fragments are blocked");
  }

  const rawPath = rawUrl.split("?", 1)[0];
  for (const segment of rawPath.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw designPlatformBoundaryError("request URL contains malformed escaping");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw designPlatformBoundaryError("request URL path traversal is blocked");
    }
  }

  if (baseUrl) {
    const configuredBase = new URL(baseUrl);
    configuredBase.pathname = `${configuredBase.pathname.replace(/\/+$/, "")}/`;
    if (
      configuredBase.origin !== trustedBase.origin ||
      configuredBase.pathname !== trustedBase.pathname ||
      configuredBase.search ||
      configuredBase.hash ||
      configuredBase.username ||
      configuredBase.password
    ) {
      throw designPlatformBoundaryError("request base URL is outside the configured trusted base");
    }
  }

  const finalUrl = new URL(rawUrl, trustedBase);
  if (finalUrl.origin !== trustedBase.origin || !finalUrl.pathname.startsWith(trustedBase.pathname)) {
    throw designPlatformBoundaryError("request URL is outside the configured trusted origin and base path");
  }
  return finalUrl;
}

function designPlatformBoundaryError(message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = "DESIGN_PLATFORM_REQUEST_TARGET_BLOCKED";
  return error;
}

function safeIdPart(value: string) {
  return String(value || "request").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60) || randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
