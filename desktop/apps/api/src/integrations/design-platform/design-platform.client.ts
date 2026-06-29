import { Injectable } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { appConfig } from "../../shared/app-config";
import { rules } from "../../shared/rules";
import { DesignPlatformJobPayload } from "./design-platform.types";

const { inspectRealDesignReferences } = rules;

type DesignImageResult = {
  imageId: string;
  downloadUrl: string;
  width?: number;
  height?: number;
};

type ArtImageLocalJob = {
  externalJobId: string;
  requestId: string;
  status: "submitted" | "generating" | "completed" | "failed" | "cancelled";
  images: DesignImageResult[];
  errorMessage?: string;
  raw?: unknown;
  startedAt: string;
  updatedAt: string;
};

type ArtImageLocalResult = {
  url?: string | null;
  status?: "success" | "failed" | string;
  error?: string;
  prompt?: string;
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

@Injectable()
export class DesignPlatformClient {
  private readonly http: AxiosInstance;
  private readonly artImageJobs = new Map<string, ArtImageLocalJob>();

  constructor() {
    this.http = axios.create({
      baseURL: appConfig.designPlatformBaseUrl,
      timeout: appConfig.designPlatformTimeoutMs,
    });
    this.http.interceptors.request.use((config) => {
      config.baseURL = appConfig.designPlatformBaseUrl;
      config.timeout = appConfig.designPlatformTimeoutMs;
      const headers = config.headers as Record<string, string>;
      const authToken = appConfig.designPlatformAccessToken || appConfig.designPlatformApiKey;
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      else delete headers.Authorization;
      if (appConfig.designPlatformCookie) headers.Cookie = appConfig.designPlatformCookie;
      else delete headers.Cookie;
      if (appConfig.designPlatformDeviceId) headers["x-art-device-id"] = appConfig.designPlatformDeviceId;
      else delete headers["x-art-device-id"];
      return config;
    });
  }

  async health() {
    if (this.useArtImageLocalAdapter()) {
      const response = await this.http.get("/api/health", { timeout: 10000 });
      const data = this.unwrapApiData(response.data);
      return {
        adapter: appConfig.designPlatformAdapter,
        ...(isRecord(data) ? data : { data }),
      };
    }

    const response = await this.http.get("/v1/health");
    return response.data;
  }

  async getArtImageLocalAuthSession(): Promise<ArtImageLocalAuthSession> {
    if (!this.useArtImageLocalAdapter()) {
      return { required: false, authenticated: true, reason: "not_required" };
    }

    try {
      const response = await this.http.get("/api/auth/session", { timeout: 10000 });
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

  async getArtImageLocalActivationStatus(): Promise<ArtImageLocalActivationStatus> {
    if (!this.useArtImageLocalAdapter()) {
      return { required: false, active: true, reason: "not_required" };
    }

    const response = await this.http.get("/api/activation/status", { timeout: 10000 });
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

    const base = appConfig.designPlatformBaseUrl.replace(/\/+$/, "");
    const response = await this.http.post(
      "/api/auth/login",
      { email, password, deviceId },
      {
        timeout: 30000,
        headers: {
          "x-art-client": "art-ai-studio",
          "x-art-device-id": deviceId,
          Origin: base,
          Referer: `${base}/`,
        },
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

    const base = appConfig.designPlatformBaseUrl.replace(/\/+$/, "");
    const response = await this.http.post(
      "/api/activation/redeem",
      { code, deviceId, deviceLabel },
      {
        timeout: 30000,
        headers: {
          "x-art-client": "art-ai-studio",
          "x-art-device-id": deviceId,
          Origin: base,
          Referer: `${base}/`,
        },
      },
    );
    return this.unwrapApiData(response.data);
  }

  async createDesignJob(payload: DesignPlatformJobPayload) {
    if (this.useArtImageLocalAdapter()) {
      return this.createArtImageLocalJob(payload);
    }

    const response = await this.http.post("/v1/design-jobs", payload);
    return response.data;
  }

  async uploadAsset(payload: Record<string, unknown>) {
    if (this.useArtImageLocalAdapter()) {
      return this.uploadArtImageLocalAsset(payload);
    }

    const response = await this.http.post("/v1/assets/upload", payload);
    return response.data;
  }

  async getDesignJob(externalJobId: string) {
    if (this.useArtImageLocalAdapter()) {
      const job = this.getArtImageLocalJob(externalJobId);
      return {
        externalJobId,
        jobId: externalJobId,
        status: job.status,
        requestId: job.requestId,
        errorMessage: job.errorMessage,
      };
    }

    const response = await this.http.get(`/v1/design-jobs/${encodeURIComponent(externalJobId)}`);
    return response.data;
  }

  async getDesignJobResults(externalJobId: string) {
    if (this.useArtImageLocalAdapter()) {
      const job = this.getArtImageLocalJob(externalJobId);
      return {
        externalJobId,
        jobId: externalJobId,
        status: job.status,
        images: job.images,
        errorMessage: job.errorMessage,
        raw: job.raw,
      };
    }

    const response = await this.http.get(`/v1/design-jobs/${encodeURIComponent(externalJobId)}/results`);
    return response.data;
  }

  async cancelDesignJob(externalJobId: string) {
    if (this.useArtImageLocalAdapter()) {
      const job = this.getArtImageLocalJob(externalJobId);
      job.status = "cancelled";
      job.updatedAt = new Date().toISOString();
      return {
        externalJobId,
        status: "cancelled",
      };
    }

    const response = await this.http.post(`/v1/design-jobs/${encodeURIComponent(externalJobId)}/cancel`);
    return response.data;
  }

  private useArtImageLocalAdapter() {
    return appConfig.designPlatformAdapter === "art_image_local";
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
    const response = await this.http.post("/api/local-assets", body.buffer, {
      timeout: appConfig.designPlatformTimeoutMs,
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

  private createArtImageLocalJob(payload: DesignPlatformJobPayload) {
    const externalJobId = `art_${safeIdPart(payload.requestId)}_${Date.now()}`;
    const now = new Date().toISOString();
    this.artImageJobs.set(externalJobId, {
      externalJobId,
      requestId: payload.requestId,
      status: "submitted",
      images: [],
      startedAt: now,
      updatedAt: now,
    });

    void this.runArtImageLocalGeneration(externalJobId, payload);

    return {
      id: externalJobId,
      jobId: externalJobId,
      externalJobId,
      status: "submitted",
    };
  }

  private async runArtImageLocalGeneration(externalJobId: string, payload: DesignPlatformJobPayload) {
    const job = this.getArtImageLocalJob(externalJobId);
    if (job.status === "cancelled") return;

    job.status = "generating";
    job.updatedAt = new Date().toISOString();

    try {
      const requestBody = await this.buildArtImageLocalRequest(payload);
      const response = await this.http.post("/api/local-generate", requestBody, {
        timeout: appConfig.designPlatformTimeoutMs,
      });
      const data = this.unwrapApiData(response.data) as { results?: ArtImageLocalResult[]; credits?: unknown };
      const results = Array.isArray(data.results) ? data.results : [];
      const successful = results.filter((item) => item.status === "success" && item.url);

      if (!successful.length) {
        const firstError = results.find((item) => item.error)?.error || "design platform returned no generated images";
        job.status = "failed";
        job.errorMessage = firstError;
        job.raw = sanitizeArtImageLocalRaw(data);
        job.updatedAt = new Date().toISOString();
        return;
      }

      job.status = "completed";
      job.images = successful.map((item, index) => ({
        imageId: `candidate_${index + 1}`,
        downloadUrl: this.absoluteDesignPlatformUrl(String(item.url)),
        width: parseImageSize(appConfig.designPlatformImageSize).width,
        height: parseImageSize(appConfig.designPlatformImageSize).height,
      }));
      job.raw = sanitizeArtImageLocalRaw(data);
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.errorMessage = this.publicErrorMessage(error);
      job.updatedAt = new Date().toISOString();
    }
  }

  private async buildArtImageLocalRequest(payload: DesignPlatformJobPayload) {
    const prompt = buildGiftBoxPrompt(payload);
    const count = clampInteger(payload.outputCount || appConfig.defaultOutputCount, 1, 6);
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

  private getArtImageLocalJob(externalJobId: string) {
    const job = this.artImageJobs.get(externalJobId);
    if (!job) throw new Error(`design platform job not found: ${externalJobId}`);
    return job;
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
  return /^https:\/\/[^\s]+$/i.test(value);
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
  const boundary = `----smart-kefu-${randomUUID()}`;
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"`,
      `Content-Type: ${mimeType}`,
      "",
      "",
    ].join("\r\n"),
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    buffer: Buffer.concat([head, file, tail]),
  };
}

function parseImageSize(size: string) {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return { width: 1024, height: 1024 };
  return {
    width: Number(match[1]) || 1024,
    height: Number(match[2]) || 1024,
  };
}

function clampInteger(value: number, min: number, max: number) {
  const normalized = Math.floor(Number(value));
  if (!Number.isFinite(normalized)) return min;
  return Math.min(Math.max(normalized, min), max);
}

function safeIdPart(value: string) {
  return String(value || "request").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60) || randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
