import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DesignPlatformClient } from "../integrations/design-platform/design-platform.client";
import {
  DesignPlatformCallbackPayload,
  DesignPlatformJobPayload,
} from "../integrations/design-platform/design-platform.types";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { StorageService } from "../storage/storage.service";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";
import { QuotesService } from "../quotes/quotes.service";
import { OrdersService } from "../orders/orders.service";
import { rules } from "../shared/rules";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { fingerprintImageFile } from "../shared/image-fingerprint";

const SMOKE_TEST_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSmokeContract(
  checks: DesignPlatformSmokeContractCheck[],
  check: DesignPlatformSmokeContractCheck,
  errorMessage: string,
) {
  checks.push(check);
  if (!check.ok) {
    throw new Error(check.detail || errorMessage);
  }
}

const {
  buildWaitingMessage,
  decideRevisionPolicy,
  evaluateArtImageLocalHealthReadiness,
  evaluateDesignAutoSubmit,
  evaluateDesignPlatformActivationStatus,
  evaluateHighValueHandoff,
  evaluateLowValueDesignImageSend,
  inspectAssetReferences,
  inspectBundleAutomationReadiness,
  inspectBundleReferences,
  inspectDesignOutputCount,
  inspectRealDesignReferences,
  isHighValueBudget,
  latestCandidateRound,
  nextStatusAfterDesignCompleted,
  planCustomerImageSelection,
  shouldTimeout,
  validateDesignAssetBinding,
  validateDesignCallbackBinding,
  validateDesignJobIdentity,
  validateDesignRequest,
} = rules;
import { CreateDesignJobPayload, CreateDesignRevisionPayload, SelectDesignImagePayload } from "./design-jobs.types";

type DesignImageCandidateLike = {
  id: string;
  imageId: string;
  position: number;
  localPath?: string | null;
  downloadUrl?: string | null;
  fingerprint?: string | null;
  legacyIdentityHash?: string | null;
  selected?: boolean;
};

type DesignPreflightCheck = {
  key: string;
  label: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  detail?: string;
};

type DesignRevisionLike = {
  id: string;
  designJobId: string;
  selectedImageId?: string | null;
  revisionNumber: number;
  instruction: string;
  sourceText?: string | null;
  policyAction: string;
  status: string;
  retryCount?: number;
  chargeRequired?: boolean;
  manualReviewRequired?: boolean;
  externalJobId?: string | null;
};

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type DesignImageLocalFileState = "ready" | "not_saved" | "stale_record" | "missing_file";

type DesignImageLocalFileStatus = {
  state: DesignImageLocalFileState;
  code:
    | "DESIGN_IMAGE_LOCAL_FILE_READY"
    | "DESIGN_IMAGE_LOCAL_FILE_NOT_SAVED"
    | "DESIGN_IMAGE_LOCAL_FILE_STALE_RECORD"
    | "DESIGN_IMAGE_LOCAL_FILE_MISSING";
  message: string;
  canRepair: boolean;
};

type DesignPlatformSmokeStep = {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
};

type DesignPlatformSmokeContractCheck = DesignPlatformSmokeStep & {
  expected?: string | number;
  actual?: string | number;
};

type DesignPlatformSmokeTestResult = {
  ok: boolean;
  adapter: string;
  baseUrl: string;
  latencyMs: number;
  requestId: string;
  externalJobId?: string;
  status: string;
  expectedCandidateCount: number;
  assetUploadCount: number;
  candidateCount: number;
  savedImageCount: number;
  savedImagePaths: string[];
  savedImagePreviews: Array<{ imageId: string; dataUrl: string }>;
  contractChecks: DesignPlatformSmokeContractCheck[];
  steps: DesignPlatformSmokeStep[];
  errorMessage?: string;
};

@Injectable()
export class DesignJobsService {
  private readonly activeResultPolls = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly designPlatform: DesignPlatformClient,
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly wechatDispatch: WechatDispatchService,
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
  ) {}

  async list(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs(filter)
      : await this.prisma.designJob.findMany({
          where: cleanIdentityWhere(filter),
          include: { images: true, customer: true, conversation: true, assets: true },
          orderBy: { updatedAt: "desc" },
          take: 200,
        });
    return Promise.all(jobs.map((job: any) => this.decorateDesignJobLocalFileStatuses(job)));
  }

  async runDesignPlatformSmokeTest(): Promise<DesignPlatformSmokeTestResult> {
    const startedAt = Date.now();
    const requestId = `smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const steps: DesignPlatformSmokeStep[] = [];
    const contractChecks: DesignPlatformSmokeContractCheck[] = [];
    const expectedCandidateCount = 1;
    let externalJobId = "";
    let status = "created";
    let assetUploadCount = 0;
    let candidateCount = 0;
    const savedImagePaths: string[] = [];
    const savedImagePreviews: Array<{ imageId: string; dataUrl: string }> = [];

    try {
      await this.designPlatform.health();
      steps.push({
        key: "health",
        label: "设计平台连通",
        ok: true,
        detail: `${appConfig.designPlatformAdapter} ${appConfig.designPlatformBaseUrl}`,
      });

      const smokeAssets = await this.prepareSmokeAssets(requestId);
      const uploadedAssets = [];
      for (const asset of smokeAssets.assets) {
        const remote = await this.designPlatform.uploadAsset(asset);
        uploadedAssets.push({
          assetId: asset.assetId,
          remoteAssetId: remote.assetId || remote.remoteAssetId || remote.id || remote.url,
          url: remote.url,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          role: asset.role,
          source: asset.source,
          skuCode: asset.skuCode,
          name: asset.name,
        });
      }
      assetUploadCount = uploadedAssets.length;
      assertSmokeContract(
        contractChecks,
        {
          key: "asset_remote_reference",
          label: "素材可被设计平台引用",
          ok: uploadedAssets.every((asset) => Boolean(asset.remoteAssetId || asset.url)),
          expected: smokeAssets.assets.length,
          actual: uploadedAssets.filter((asset) => Boolean(asset.remoteAssetId || asset.url)).length,
          detail: `上传 ${smokeAssets.assets.length} 个素材，${uploadedAssets.filter((asset) => Boolean(asset.remoteAssetId || asset.url)).length} 个返回可引用 ID 或 URL。`,
        },
        "design platform asset upload did not return remoteAssetId or url for every asset",
      );
      steps.push({
        key: "asset_upload",
        label: "试跑素材上传",
        ok: true,
        detail: `已上传 ${assetUploadCount} 个测试素材`,
      });

      const remote = await this.designPlatform.createDesignJob({
        requestId,
        wechatAccountId: null,
        customerId: "smoke_customer",
        conversationId: "smoke_conversation",
        orderId: null,
        budget: { mode: "per_box", amount: 200, quantity: 20, totalAmount: 4000 },
        scene: "员工福利礼盒试跑",
        bundle: smokeAssets.bundle,
        assets: uploadedAssets,
        outputCount: 1,
        renderStyle: "真实产品摆拍",
        requirements: {
          useRealSkuImages: true,
          showAllItems: true,
          noWatermark: true,
          highResolution: true,
        },
        customerText: "客服平台联调试跑：请生成一张包含礼盒、内搭商品和客户 Logo 的真实摆拍效果图。",
      });
      externalJobId = String(remote.externalJobId || remote.jobId || remote.id || "");
      assertSmokeContract(
        contractChecks,
        {
          key: "external_job_id",
          label: "任务 ID 返回",
          ok: Boolean(externalJobId),
          expected: "externalJobId/jobId/id",
          actual: externalJobId || "",
          detail: externalJobId || "创建设计任务接口必须返回 externalJobId、jobId 或 id。",
        },
        "design platform did not return externalJobId",
      );
      status = String(remote.status || "submitted");
      steps.push({
        key: "job_submit",
        label: "试跑任务提交",
        ok: true,
        detail: externalJobId,
      });

      const completed = await this.waitForSmokeDesignResult(externalJobId);
      status = String(completed.status || "completed");
      const images = Array.isArray(completed.images) ? completed.images : [];
      candidateCount = images.length;
      assertSmokeContract(
        contractChecks,
        {
          key: "candidate_count",
          label: "候选图数量",
          ok: candidateCount >= expectedCandidateCount,
          expected: expectedCandidateCount,
          actual: candidateCount,
          detail: `需要至少 ${expectedCandidateCount} 张候选图，实际返回 ${candidateCount} 张。`,
        },
        "design platform completed but returned no images",
      );
      const invalidImages: Array<{ index: number; imageId: string; downloadUrl: string }> = images
        .map((image: any, index: number) => ({
          index,
          imageId: String(image?.imageId || ""),
          downloadUrl: String(image?.downloadUrl || ""),
        }))
        .filter((image: { imageId: string; downloadUrl: string }) => !image.imageId || !image.downloadUrl);
      assertSmokeContract(
        contractChecks,
        {
          key: "image_metadata",
          label: "图片元数据完整",
          ok: invalidImages.length === 0,
          expected: "imageId + downloadUrl",
          actual: invalidImages.length ? `${invalidImages.length} invalid` : "valid",
          detail: invalidImages.length
            ? `第 ${invalidImages.map((image) => image.index + 1).join("、")} 张缺少 imageId 或 downloadUrl。`
            : "每张候选图都有 imageId 和 downloadUrl。",
        },
        `design platform returned invalid candidate image metadata: ${invalidImages
          .map((image) => `#${image.index + 1}`)
          .join(", ")}`,
      );
      steps.push({
        key: "job_result",
        label: "候选图返回",
        ok: true,
        detail: `收到 ${candidateCount} 张候选图`,
      });

      for (const image of images) {
        const imageId = String(image.imageId || `candidate_${savedImagePaths.length + 1}`);
        const downloadUrl = String(image.downloadUrl || "");
        if (!downloadUrl) throw new Error(`candidate image ${imageId} has no downloadUrl`);
        const localPath = await this.storage.saveDesignImage(requestId, imageId, downloadUrl);
        savedImagePaths.push(localPath);
        const preview = await localImagePreviewDataUrl(localPath);
        if (preview) savedImagePreviews.push({ imageId, dataUrl: preview });
      }
      steps.push({
        key: "image_save",
        label: "候选图保存",
        ok: true,
        detail: `已保存 ${savedImagePaths.length} 张本地图片`,
      });
      assertSmokeContract(
        contractChecks,
        {
          key: "local_image_save_count",
          label: "候选图本地保存完整",
          ok: savedImagePaths.length === candidateCount,
          expected: candidateCount,
          actual: savedImagePaths.length,
          detail: `返回 ${candidateCount} 张候选图，本地保存 ${savedImagePaths.length} 张。`,
        },
        "design platform smoke test did not save every candidate image locally",
      );

      return {
        ok: true,
        adapter: appConfig.designPlatformAdapter,
        baseUrl: appConfig.designPlatformBaseUrl,
        latencyMs: Date.now() - startedAt,
        requestId,
        externalJobId,
        status,
        expectedCandidateCount,
        assetUploadCount,
        candidateCount,
        savedImageCount: savedImagePaths.length,
        savedImagePaths,
        savedImagePreviews,
        contractChecks,
        steps,
        errorMessage: "",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown design platform smoke test error";
      steps.push({
        key: "error",
        label: "试跑失败",
        ok: false,
        detail: errorMessage,
      });
      return {
        ok: false,
        adapter: appConfig.designPlatformAdapter,
        baseUrl: appConfig.designPlatformBaseUrl,
        latencyMs: Date.now() - startedAt,
        requestId,
        externalJobId: externalJobId || undefined,
        status: status === "created" ? "failed" : status,
        expectedCandidateCount,
        assetUploadCount,
        candidateCount,
        savedImageCount: savedImagePaths.length,
        savedImagePaths,
        savedImagePreviews,
        contractChecks,
        steps,
        errorMessage,
      };
    }
  }

  async scanHighValueHandoffs(filter: IdentityFilter = {}) {
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs(filter)
      : await this.prisma.designJob.findMany({
          where: cleanIdentityWhere(filter),
          include: { customer: true, conversation: true },
          orderBy: { updatedAt: "desc" },
          take: 300,
        });
    const handedOff: any[] = [];
    const skipped: any[] = [];

    for (const job of jobs as any[]) {
      const decision = evaluateHighValueHandoff(job, { highValueAmountCny: appConfig.highValueAmountCny });
      if (!decision.ok) {
        skipped.push({
          designJobId: job.id,
          requestId: job.requestId,
          status: job.status,
          reason: decision.reason,
        });
        continue;
      }

      const updated = await this.handoffDesignJobToManual(job, {
        reason: "high_value_customer",
        source: "scan_high_value_handoffs",
        note: "金额达到高价值线，需要人工确认方案、报价和跟进节奏。",
      });
      handedOff.push(updated);
    }

    return {
      scanned: jobs.length,
      handedOff,
      skipped,
    };
  }

  async scanAutoSubmitDrafts(filter: IdentityFilter = {}) {
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs(filter)
      : await this.prisma.designJob.findMany({
          where: { status: "draft", ...cleanIdentityWhere(filter) },
          include: { assets: true, customer: true, conversation: true },
          orderBy: { updatedAt: "desc" },
          take: 300,
        });
    const submitted: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];

    for (const job of jobs as any[]) {
      const decision = evaluateDesignAutoSubmit(job, { highValueAmountCny: appConfig.highValueAmountCny });
      if (!decision.ok) {
        skipped.push({
          designJobId: job.id,
          requestId: job.requestId,
          reason: decision.reason,
          missing: decision.missing || [],
        });
        continue;
      }

      try {
        submitted.push(await this.submit(job.id));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        failed.push({
          designJobId: job.id,
          requestId: job.requestId,
          errorMessage,
        });
        await this.notifications.create("error", "设计草稿自动提交失败", errorMessage, {
          designJobId: job.id,
          requestId: job.requestId,
        });
      }
    }

    return {
      scanned: jobs.length,
      submitted,
      skipped,
      failed,
    };
  }

  async runLowValueAutomation(filter: IdentityFilter = {}) {
    const autoSubmit = await this.scanAutoSubmitDrafts(filter);
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs(filter)
      : await this.prisma.designJob.findMany({
          where: { status: "quick_confirm", isHighValue: false, ...cleanIdentityWhere(filter) },
          include: { images: true, customer: true, conversation: true },
          orderBy: { updatedAt: "desc" },
          take: 300,
        });
    const imageSend = {
      scanned: jobs.length,
      queued: [] as any[],
      skipped: [] as any[],
      failed: [] as any[],
    };

    for (const job of jobs as any[]) {
      const decision = evaluateLowValueDesignImageSend(job, { highValueAmountCny: appConfig.highValueAmountCny });
      if (!decision.ok) {
        imageSend.skipped.push({
          designJobId: job.id,
          requestId: job.requestId,
          reason: decision.reason,
          missing: decision.missing || [],
        });
        continue;
      }

      try {
        imageSend.queued.push(await this.quickConfirmAndQueueSend(job.id));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        imageSend.failed.push({
          designJobId: job.id,
          requestId: job.requestId,
          errorMessage,
        });
        await this.notifications.create("error", "低价值任务自动处理失败", errorMessage, {
          designJobId: job.id,
          requestId: job.requestId,
        });
      }
    }

    const quoteSend = await this.quotes.scanLowValueAutoQuoteSends(filter);
    const orderDraft = await this.orders.scanLowValueAutoOrderDrafts(filter);
    const orderConfirmation = await this.wechatDispatch.scanLowValueOrderConfirmations(filter);
    const orderFollowup = await this.wechatDispatch.scanLowValueOrderFollowups(filter);

    return {
      autoSubmit,
      imageSend,
      quoteSend,
      orderDraft,
      orderConfirmation,
      orderFollowup,
    };
  }

  async pollActiveResults(limit = appConfig.lowValueAutomationPollLimit, filter: IdentityFilter = {}) {
    const max = Math.max(1, Math.min(Number(limit || 50), 200));
    const jobs = appConfig.useLocalStore
      ? this.localStore
          .listDesignJobs(filter)
          .filter((job: any) => ["submitted", "generating"].includes(job.status) && job.externalJobId)
          .slice(0, max)
      : await this.prisma.designJob.findMany({
          where: {
            status: { in: ["submitted", "generating"] },
            externalJobId: { not: null },
            ...cleanIdentityWhere(filter),
          },
          include: { images: true },
          orderBy: { updatedAt: "asc" },
          take: max,
        });
    const result = {
      scanned: jobs.length,
      completed: [] as any[],
      failed: [] as any[],
      retried: [] as any[],
      generating: [] as any[],
      cancelled: [] as any[],
      errors: [] as any[],
    };

    for (const job of jobs as any[]) {
      try {
        const polled = await this.pollResult(job.id);
        const remoteStatus = polled.remoteStatus || "generating";
        if (polled.autoRetried || this.wasAutoRetried(job, polled.job)) result.retried.push(polled.job);
        else if (remoteStatus === "completed") result.completed.push(polled.job);
        else if (remoteStatus === "failed") result.failed.push(polled.job);
        else if (remoteStatus === "cancelled") result.cancelled.push(polled.job);
        else result.generating.push(polled.job);
      } catch (error) {
        result.errors.push({
          designJobId: job.id,
          requestId: job.requestId,
          externalJobId: job.externalJobId,
          errorMessage: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return result;
  }

  async scanTimeouts(filter: IdentityFilter = {}) {
    const now = new Date();
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs(filter)
      : await this.prisma.designJob.findMany({
          where: { status: { in: ["submitted", "generating"] }, ...cleanIdentityWhere(filter) },
          include: { customer: true, conversation: true },
          take: 300,
        });
    const candidates = jobs.filter((job: any) =>
      ["submitted", "generating"].includes(job.status) &&
      shouldTimeout(job.submittedAt || job.createdAt, now, appConfig.designTimeoutMinutes),
    );
    const updatedJobs = [];
    const recoveredJobs = [];
    const pollErrors = [];

    for (const job of candidates as any[]) {
      if (job.externalJobId) {
        try {
          const polled = await this.pollResult(job.id);
          const remoteStatus = String(polled.remoteStatus || "").toLowerCase();
          const recovered =
            polled.autoRetried ||
            ["completed", "failed", "cancelled"].includes(remoteStatus) ||
            !["submitted", "generating"].includes(String(polled.job?.status || "").toLowerCase());
          if (recovered) {
            recoveredJobs.push(polled.job);
            continue;
          }
        } catch (error) {
          pollErrors.push({
            designJobId: job.id,
            requestId: job.requestId,
            externalJobId: job.externalJobId,
            errorMessage: error instanceof Error ? error.message : "unknown poll error",
          });
        }
      }

      const body = `任务 ${job.requestId} 已超过 ${appConfig.designTimeoutMinutes} 分钟未完成，需要客服关注。`;
      await this.notifications.create("warning", "设计任务出图超时", body, {
        designJobId: job.id,
        requestId: job.requestId,
        conversationId: job.conversationId,
      });

      if (job.wechatAccountId) {
        await this.queueDesignTextMessage(
          job,
          this.buildTimeoutCustomerMessage(job),
          "design-timeout-customer-explain",
        );
      }

      const updated = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(job.id, {
            status: "timeout",
            errorMessage: `出图超过 ${appConfig.designTimeoutMinutes} 分钟未完成`,
          })
        : await this.prisma.designJob.update({
            where: { id: job.id },
            data: {
              status: "timeout",
              errorMessage: `出图超过 ${appConfig.designTimeoutMinutes} 分钟未完成`,
            },
          });
      updatedJobs.push(updated);
    }

    return {
      scanned: jobs.length,
      candidates: candidates.length,
      recovered: recoveredJobs.length,
      timedOut: updatedJobs.length,
      pollErrors,
      recoveredJobs,
      jobs: updatedJobs,
    };
  }

  createTimeoutDemo(payload: { conversationId?: string } & ExpectedIdentityPayload = {}) {
    if (!appConfig.useLocalStore) throw new Error("timeout demo is only available in local-json mode");
    if (!payload.conversationId) {
      throw new BadRequestException("conversationId is required for timeout demo");
    }
    const conversation = this.localStore.listConversations().find((item) => item.id === payload.conversationId);
    if (!conversation) throw new BadRequestException("conversation not found for timeout demo");
    this.assertDemoConversationIdentity(conversation, payload, "timeout demo");
    const oldSubmittedAt = new Date(Date.now() - (appConfig.designTimeoutMinutes + 1) * 60 * 1000).toISOString();
    const job = this.localStore.createDesignJob({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      wechatAccountId: conversation.wechatAccountId,
      budget: { mode: "per_box", perUnitAmount: 180, quantity: 50, totalAmount: 9000 },
      scene: "员工福利",
      customerText: "客户想看礼盒效果图，演示超时提醒流程。",
      designType: "bundle_render",
      outputCount: appConfig.defaultOutputCount,
      bundle: {
        items: [
          { skuCode: "BOX-A", name: "红金礼盒A", type: "gift_box", salePrice: 60, costPrice: 30 },
          { skuCode: "TEA-A", name: "茶叶礼品A", type: "item", salePrice: 110, costPrice: 65 },
        ],
      },
      requirements: {
        useRealSkuImages: true,
        showAllItems: true,
        noWatermark: true,
        highResolution: true,
      },
      assets: [{ assetId: "demo-logo" }],
      status: "submitted",
    });
    return this.localStore.updateDesignJob(job.id, {
      externalJobId: `timeout_demo_${Date.now()}`,
      submittedAt: oldSubmittedAt,
      status: "submitted",
    });
  }

  createFailureDemo(payload: { conversationId?: string } & ExpectedIdentityPayload = {}) {
    if (!appConfig.useLocalStore) throw new Error("failure demo is only available in local-json mode");
    if (!payload.conversationId) {
      throw new BadRequestException("conversationId is required for failure demo");
    }
    const conversation = this.localStore.listConversations().find((item) => item.id === payload.conversationId);
    if (!conversation) throw new BadRequestException("conversation not found for failure demo");
    this.assertDemoConversationIdentity(conversation, payload, "failure demo");
    const job = this.localStore.createDesignJob({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      wechatAccountId: conversation.wechatAccountId,
      budget: { mode: "per_box", perUnitAmount: 180, quantity: 50, totalAmount: 9000 },
      scene: "员工福利",
      customerText: "客户想看礼盒效果图，演示失败后人工重试流程。",
      designType: "bundle_render",
      outputCount: appConfig.defaultOutputCount,
      bundle: {
        items: [
          { skuCode: "BOX-A", name: "红金礼盒A", type: "gift_box", salePrice: 60, costPrice: 30 },
          { skuCode: "TEA-A", name: "茶叶礼品A", type: "item", salePrice: 110, costPrice: 65 },
        ],
      },
      requirements: {
        useRealSkuImages: true,
        showAllItems: true,
        noWatermark: true,
        highResolution: true,
      },
      status: "failed",
    });
    return this.localStore.updateDesignJob(job.id, {
      retryCount: 1,
      status: "failed",
      errorMessage: "演示：设计平台返回失败，等待人工重试。",
    });
  }

  private assertDemoConversationIdentity(conversation: any, expected: ExpectedIdentityPayload = {}, label = "design demo") {
    const missing = [
      !expected.expectedWechatAccountId ? "expectedWechatAccountId" : "",
      !expected.expectedConversationId ? "expectedConversationId" : "",
      !expected.expectedCustomerId ? "expectedCustomerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`${label} requires conversation identity: ${missing.join(", ")}`);
    }
    assertExpectedIdentity({ ...conversation, conversationId: conversation.id }, expected, label);
  }

  async create(payload: CreateDesignJobPayload) {
    const requestId = randomUUID();
    const identity = await this.validateCreateIdentity(payload);
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || identity.customerId,
      wechatAccountId: payload.wechatAccountId || identity.wechatAccountId,
    };
    const isHighValue = isHighValueBudget(normalizedPayload.budget, appConfig.highValueAmountCny);
    const requestedAssets = this.normalizeRequestedAssets(normalizedPayload);
    const check = validateDesignRequest({
      ...normalizedPayload,
      designType: normalizedPayload.designType || "bundle_render",
      assets: requestedAssets,
    });

    if (appConfig.useLocalStore) {
      const job = this.localStore.createDesignJob({
        requestId,
        customerId: normalizedPayload.customerId,
        conversationId: normalizedPayload.conversationId,
        wechatAccountId: normalizedPayload.wechatAccountId,
        orderId: normalizedPayload.orderId,
        budget: normalizedPayload.budget,
        bundle: normalizedPayload.bundle,
        assetIds: normalizedPayload.assetIds || [],
        scene: normalizedPayload.scene,
        customerText: normalizedPayload.customerText,
        designType: normalizedPayload.designType || "bundle_render",
        outputCount: normalizedPayload.outputCount || appConfig.defaultOutputCount,
        renderStyle: "真实产品摆拍",
        requirements: {
          useRealSkuImages: true,
          showAllItems: true,
          noWatermark: true,
          highResolution: true,
        },
        isHighValue,
        status: !check.ok || isHighValue ? "manual_review" : "draft",
        manualQcRequired: true,
      });
      if (!check.ok) {
        await this.notifications.create("warning", "设计任务资料不完整", `缺少字段：${check.missing.join(", ")}`, {
          designJobId: job.id,
        });
      }
      const resultJob = isHighValue
        ? await this.handoffDesignJobToManual(job, {
            reason: "high_value_customer",
            source: "create_design_job",
            beforeStatus: "created",
            note: "金额达到高价值线，需要人工确认方案、报价和跟进节奏。",
          })
        : job;
      return { ...resultJob, readiness: check };
    }

    const job = await this.prisma.designJob.create({
      data: {
        requestId,
        customerId: normalizedPayload.customerId,
        conversationId: normalizedPayload.conversationId,
        wechatAccountId: normalizedPayload.wechatAccountId,
        orderId: normalizedPayload.orderId,
        budget: normalizedPayload.budget as any,
        bundle: normalizedPayload.bundle as any,
        scene: normalizedPayload.scene,
        customerText: normalizedPayload.customerText,
        designType: normalizedPayload.designType || "bundle_render",
        outputCount: normalizedPayload.outputCount || appConfig.defaultOutputCount,
        renderStyle: "真实产品摆拍",
        requirements: {
          useRealSkuImages: true,
          showAllItems: true,
          noWatermark: true,
          highResolution: true,
        } as any,
        assets: normalizedPayload.assetIds?.length
          ? {
              connect: normalizedPayload.assetIds.map((id) => ({ id })),
            }
          : undefined,
        isHighValue,
        status: !check.ok || isHighValue ? "manual_review" : "draft",
        manualQcRequired: true,
      },
    });

    if (!check.ok) {
      await this.notifications.create("warning", "设计任务资料不完整", `缺少字段：${check.missing.join(", ")}`, {
        designJobId: job.id,
      });
    }
    const resultJob = isHighValue
      ? await this.handoffDesignJobToManual(job, {
          reason: "high_value_customer",
          source: "create_design_job",
          beforeStatus: "created",
          note: "金额达到高价值线，需要人工确认方案、报价和跟进节奏。",
        })
      : job;
    return { ...resultJob, readiness: check };
  }

  async submit(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");

    let remote: any;
    try {
      await this.assertDesignPlatformPreflight(id);
      const payload = await this.buildDesignPlatformPayload(job);
      remote = await this.designPlatform.createDesignJob(payload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown design submit error";
      await this.failDesignJobForManualReview(job, {
        reason: "design_platform_submit_failed",
        source: "submit_design_job",
        errorMessage,
      });
      throw error;
    }

    const externalJobId = remote.externalJobId || remote.jobId || remote.id;
    const waitMessage = buildWaitingMessage({
      scene: job.scene || "",
      outputCount: job.outputCount,
    });

    const updated = appConfig.useLocalStore
      ? this.localStore.updateDesignJob(id, {
          externalJobId,
          status: "submitted",
          submittedAt: new Date().toISOString(),
          waitMessageSentAt: new Date().toISOString(),
        })
      : await this.prisma.designJob.update({
          where: { id },
          data: {
            externalJobId,
            status: "submitted",
            submittedAt: new Date(),
            waitMessageSentAt: new Date(),
          },
        });

    if (job.wechatAccountId) {
      await this.queueDesignTextMessage(job, waitMessage, "design-waiting-message");
    }
    this.scheduleResultPoll(job.requestId, externalJobId);
    return updated;
  }

  async preflight(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");

    const checks: DesignPreflightCheck[] = [];
    let health: Record<string, unknown> | null = null;
    try {
      health = await this.designPlatform.health();
      checks.push({
        key: "design_platform_health",
        label: "设计平台连通",
        ok: true,
        severity: "info",
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

    const requiresRealImages = (job.requirements as any)?.useRealSkuImages !== false;
    const realRefs = inspectRealDesignReferences({
      assets: job.assets || [],
      bundle: job.bundle || {},
      requireCustomerAssets: requiresRealImages,
      requireCompleteBundle: requiresRealImages,
    });
    const bundleRefs = realRefs.bundleRefs || inspectBundleReferences(job.bundle || {});
    const assetRefs = realRefs.assetRefs || inspectAssetReferences(job.assets || []);
    const usableRefs = [...assetRefs, ...bundleRefs].filter((item) => item.ok);
    const unusableRefs = [...assetRefs, ...bundleRefs].filter((item) => !item.ok);
    const bundleAutomation = inspectBundleAutomationReadiness(job.bundle || {});
    const outputCount = inspectDesignOutputCount(job.outputCount, {
      fallback: appConfig.defaultOutputCount || 6,
    });
    const callback = this.buildDesignPlatformCallback(job.requestId || id);
    const callbackSummary = {
      url: callback.url,
      method: callback.method,
      events: callback.events,
      hasAuthorization: Boolean(callback.headers?.Authorization),
      fallbackPolling: callback.fallbackPolling,
    };

    checks.push({
      key: "request_identity",
      label: "任务绑定",
      ok: Boolean(job.requestId && job.customerId && job.conversationId),
      severity: "error",
      detail: `request=${job.requestId || "-"} customer=${job.customerId || "-"} conversation=${job.conversationId || "-"}`,
    });

    checks.push({
      key: "design_brief",
      label: "出图需求",
      ok: Boolean(job.scene && job.budget && job.bundle),
      severity: "error",
      detail: `scene=${job.scene || "-"} outputCount=${job.outputCount || 0}`,
    });

    checks.push({
      key: "design_output_count",
      label: "候选图数量",
      ok: outputCount.ok,
      severity: "error",
      detail: outputCount.detail,
    });

    checks.push({
      key: "real_image_refs",
      label: "真实商品/客户图片",
      ok: !requiresRealImages || realRefs.ok,
      severity: "error",
      detail: requiresRealImages
        ? `可用图片 ${usableRefs.length} 个，不可用 ${unusableRefs.length} 个`
        : `未强制要求真实图片，可用图片 ${usableRefs.length} 个`,
    });

    checks.push({
      key: "bundle_automation",
      label: "商品组合自动化",
      ok: bundleAutomation.ok,
      severity: "error",
      detail: bundleAutomation.ok
        ? "商品组合满足自动出图/报价前置规则。"
        : `商品组合需要人工确认：${(bundleAutomation.blockers || []).join(", ") || "unknown"}`,
    });

    checks.push({
      key: "design_result_delivery",
      label: "结果回传兜底",
      ok: Boolean(callbackSummary.url || callbackSummary.fallbackPolling),
      severity: "info",
      detail: `回调${callbackSummary.url ? "已配置" : "未配置"}，${
        callbackSummary.hasAuthorization ? "已启用签名" : "未启用签名"
      }，${callbackSummary.fallbackPolling ? "已启用轮询兜底" : "未启用轮询兜底"}`,
    });

    if (appConfig.designPlatformAdapter === "art_image_local") {
      checks.push({
        key: "art_image_adapter",
        label: "真实设计平台适配",
        ok: true,
        severity: "info",
        detail: "将调用 /api/local-assets 和 /api/local-generate，不调用 /v1/design-jobs。",
      });
      const unsupported = unusableRefs.slice(0, 5).map((item) => `${item.source}:${item.reason}`).join("; ");
      if (unsupported) {
        checks.push({
          key: "unsupported_refs",
          label: "不可用图片引用",
          ok: false,
          severity: requiresRealImages && !realRefs.ok ? "error" : "warning",
          detail: unsupported,
        });
      }
      if (health && typeof health === "object") {
        const artImageHealth = evaluateArtImageLocalHealthReadiness(health);
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
            ? `已登录 ${formatAuthSessionUser(auth)}`
            : "设计平台未登录，或客服平台没有拿到设计平台登录凭证。请先登录设计平台，或配置 DESIGN_PLATFORM_COOKIE / DESIGN_PLATFORM_ACCESS_TOKEN。",
        });
      } catch (error) {
        checks.push({
          key: "art_image_auth_session",
          label: "设计平台登录态",
          ok: false,
          severity: "error",
          detail: error instanceof Error ? error.message : "无法读取设计平台登录状态",
        });
      }

      try {
        const activationStatus = await this.designPlatform.getArtImageLocalActivationStatus();
        const activation = evaluateDesignPlatformActivationStatus(activationStatus);
        checks.push({
          key: "art_image_activation",
          label: "设计平台设备激活",
          ok: activation.ok,
          severity: activation.ok ? "info" : "error",
          detail: activation.detail,
        });
      } catch (error) {
        checks.push({
          key: "art_image_activation",
          label: "设计平台设备激活",
          ok: false,
          severity: "error",
          detail: error instanceof Error ? error.message : "无法读取设计平台设备激活状态",
        });
      }
    }

    const errorCount = checks.filter((check) => !check.ok && check.severity === "error").length;
    return {
      ok: errorCount === 0,
      adapter: appConfig.designPlatformAdapter,
      baseUrl: appConfig.designPlatformBaseUrl,
      designJobId: job.id,
      requestId: job.requestId,
      status: job.status,
      isHighValue: this.isHighValueDesignJob(job),
      outputCount: outputCount.requested,
      requiredOutputCountRange: { min: outputCount.min, max: outputCount.max },
      usableReferenceCount: usableRefs.length,
      unusableReferenceCount: unusableRefs.length,
      callback: callbackSummary,
      checks,
      health,
    };
  }

  private async assertDesignPlatformPreflight(id: string) {
    const preflight = await this.preflight(id);
    if (preflight.ok) return preflight;

    const failed = preflight.checks
      .filter((check) => !check.ok && check.severity === "error")
      .map((check) => check.detail || check.label)
      .join("; ");
    throw new BadRequestException(`design job preflight failed: ${failed || "unknown preflight error"}`);
  }

  async pollResult(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    if (!job.externalJobId) throw new Error("design job has no externalJobId");
    const terminalStatusLabel = this.designJobTerminalStatusLabel(job.status);
    if (terminalStatusLabel) {
      await this.notifications.create("info", "已跳过终态任务轮询", `设计任务已${terminalStatusLabel}，不会再用设计平台状态覆盖客户已确认内容。`, {
        designJobId: job.id,
        externalJobId: job.externalJobId,
        designJobStatus: job.status,
      });
      return {
        remoteStatus: "terminal",
        job,
        result: {
          status: "terminal",
          designJobStatus: job.status,
          reason: "terminal_design_job",
        },
      };
    }

    const result = await this.designPlatform.getDesignJobResults(job.externalJobId);
    if (result.status === "completed") {
      const updated = await this.handleDesignPlatformCallback({
        requestId: job.requestId,
        externalJobId: job.externalJobId,
        status: "completed",
        images: result.images || [],
      });
      return { remoteStatus: result.status, autoRetried: this.wasAutoRetried(job, updated), job: updated, result };
    }
    if (result.status === "failed") {
      const updated = await this.handleDesignPlatformCallback({
        requestId: job.requestId,
        externalJobId: job.externalJobId,
        status: "failed",
        errorMessage: result.errorMessage || "设计平台轮询返回失败",
      });
      return { remoteStatus: result.status, autoRetried: this.wasAutoRetried(job, updated), job: updated, result };
    }
    if (result.status === "cancelled") {
      const updated = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(job.id, { status: "cancelled" })
        : await this.prisma.designJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
      return { remoteStatus: result.status, job: updated, result };
    }

    const updated = appConfig.useLocalStore
      ? this.localStore.updateDesignJob(job.id, { status: "generating" })
      : await this.prisma.designJob.update({ where: { id: job.id }, data: { status: "generating" } });
    return { remoteStatus: result.status || "generating", job: updated, result };
  }

  async retry(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await (this.prisma as any).designJob.findUnique({
          where: { id },
          select: { id: true, customerId: true, conversationId: true, wechatAccountId: true, status: true, errorMessage: true },
        });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    this.assertDesignJobCanManualRetry(job);
    const revision = await this.findLatestRevisionForRetry(job.id);
    return this.retryDesignJob(id, "manual", undefined, expected, revision);
  }

  async attachAssets(id: string, assetIds: string[], expected: ExpectedIdentityPayload = {}) {
    const uniqueAssetIds = [...new Set((assetIds || []).filter(Boolean))];
    if (!uniqueAssetIds.length) throw new Error("assetIds is required");
    if (appConfig.useLocalStore) {
      const job = this.localStore.getDesignJob(id);
      if (!job) throw new Error(`design job not found: ${id}`);
      assertExpectedIdentity(job, expected, "design job");
      return this.localStore.attachDesignAssetsToJob(id, uniqueAssetIds);
    }
    const [designJob, assets] = await Promise.all([
      this.prisma.designJob.findUnique({ where: { id }, select: { id: true, requestId: true, customerId: true, conversationId: true, wechatAccountId: true } }),
      this.prisma.designAsset.findMany({ where: { id: { in: uniqueAssetIds } } }),
    ]);
    assertExpectedIdentity(designJob, expected, "design job");
    const binding = validateDesignAssetBinding({
      designJob,
      assets,
      requestedAssetIds: uniqueAssetIds,
    });
    if (!binding.ok) throw new BadRequestException(`design asset binding invalid: ${binding.reason}`);
    return this.prisma.designJob.update({
      where: { id },
      data: {
        assets: {
          connect: uniqueAssetIds.map((assetId) => ({ id: assetId })),
        },
      },
      include: { assets: true, images: true, customer: true, conversation: true },
    });
  }

  async readLocalDesignImage(id: string, imageId: string, expected: ExpectedIdentityPayload = {}) {
    const inspection = await this.inspectLocalDesignImage(id, imageId, expected);
    if (inspection.localFile.state !== "ready") {
      throw this.localDesignImageStatusException(inspection.localFile);
    }
    const image = inspection.image;
    return this.storage.readLocalAsset(image.localPath);
  }

  async inspectLocalDesignImage(id: string, imageId: string, expected: ExpectedIdentityPayload = {}) {
    const job = await this.findDesignJobWithImages(id);
    if (!job) {
      throw new NotFoundException({
        code: "DESIGN_JOB_NOT_FOUND",
        state: "record_missing",
        message: `design job not found: ${id}`,
      });
    }
    try {
      assertExpectedIdentity(job, expected, "design job image");
    } catch (error) {
      const message = error instanceof Error ? error.message : "design job image identity mismatch";
      throw new ForbiddenException({
        code: "DESIGN_IMAGE_IDENTITY_MISMATCH",
        state: "identity_mismatch",
        message,
      });
    }

    const image = (job.images || []).find((item: any) => item.id === imageId || item.imageId === imageId);
    if (!image) {
      throw new NotFoundException({
        code: "DESIGN_IMAGE_NOT_FOUND",
        state: "record_missing",
        message: `design image not found in design job: ${imageId}`,
      });
    }
    return {
      designJobId: job.id,
      imageId: image.imageId || image.id,
      image,
      localFile: await this.inspectDesignImageLocalFile(job, image),
    };
  }

  async repairLocalDesignImage(id: string, imageId: string, expected: ExpectedIdentityPayload = {}) {
    const inspection = await this.inspectLocalDesignImage(id, imageId, expected);
    if (inspection.localFile.state === "ready") {
      return {
        repaired: false,
        image: { ...inspection.image, localFile: inspection.localFile },
        job: await this.decorateDesignJobLocalFileStatuses(await this.findDesignJobWithImages(id)),
      };
    }

    const downloadUrl = String(inspection.image.downloadUrl || "").trim();
    if (!downloadUrl) {
      throw new ConflictException({
        code: "DESIGN_IMAGE_REPAIR_SOURCE_UNAVAILABLE",
        state: inspection.localFile.state,
        message: "design image has no download source; poll the design result or regenerate it",
      });
    }

    let localPath = "";
    let fingerprint = "";
    try {
      localPath = await this.storage.saveDesignImage(
        inspection.designJobId,
        String(inspection.image.imageId || inspection.image.id),
        downloadUrl,
      );
      fingerprint = (await fingerprintImageFile(localPath)).fingerprint;
    } catch (error) {
      if (localPath) await this.removeUnusableDownloadedDesignImage(inspection.designJobId, localPath);
      throw new ConflictException({
        code: "DESIGN_IMAGE_REPAIR_DOWNLOAD_FAILED",
        state: inspection.localFile.state,
        message: error instanceof Error ? error.message : "design image download failed",
      });
    }

    if (appConfig.useLocalStore) {
      this.localStore.upsertDesignImages(inspection.designJobId, [{
        ...inspection.image,
        localPath,
        fingerprint,
        legacyIdentityHash: this.resolveLegacyIdentityHash(inspection.image),
      }]);
    } else {
      await this.prisma.designImageCandidate.upsert({
        where: {
          designJobId_imageId: {
            designJobId: inspection.designJobId,
            imageId: String(inspection.image.imageId || inspection.image.id),
          },
        },
        update: {
          localPath,
          fingerprint,
          legacyIdentityHash: this.resolveLegacyIdentityHash(inspection.image),
        } as any,
        create: {
          designJobId: inspection.designJobId,
          imageId: String(inspection.image.imageId || inspection.image.id),
          downloadUrl,
          localPath,
          position: Number(inspection.image.position || 0),
          fingerprint,
          legacyIdentityHash: this.resolveLegacyIdentityHash(inspection.image),
        } as any,
      });
    }

    const job = await this.findDesignJobWithImages(id);
    const decoratedJob = await this.decorateDesignJobLocalFileStatuses(job);
    const image = (decoratedJob?.images || []).find(
      (item: any) => item.id === inspection.image.id || item.imageId === inspection.image.imageId,
    );
    return { repaired: true, image, job: decoratedJob };
  }

  async listRevisions(id: string, expected: ExpectedIdentityPayload = {}) {
    if (appConfig.useLocalStore) {
      const job = this.localStore.getDesignJob(id);
      if (!job) throw new Error(`design job not found: ${id}`);
      assertExpectedIdentity(job, expected, "design job");
      return this.localStore.listDesignRevisions(id);
    }
    const prisma = this.prisma as any;
    const job = await prisma.designJob.findUnique({
      where: { id },
      select: { id: true, customerId: true, conversationId: true, wechatAccountId: true },
    });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    return prisma.designRevision.findMany({
      where: { designJobId: id },
      orderBy: { revisionNumber: "asc" },
    });
  }

  async requestRevision(id: string, payload: CreateDesignRevisionPayload & ExpectedIdentityPayload) {
    const prisma = this.prisma as any;
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await prisma.designJob.findUnique({
          where: { id },
          include: { images: true, assets: true, revisions: true },
        });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, payload, "design job");
    this.assertDesignJobCanRequestRevision(job);

    const existingRevisions = appConfig.useLocalStore
      ? this.localStore.listDesignRevisions(job.id)
      : ((job as any).revisions || []);
    const decision = decideRevisionPolicy({
      instruction: payload.instruction,
      revisionCount: existingRevisions.length,
      isHighValue: job.isHighValue,
      budget: job.budget,
      highValueAmountCny: appConfig.highValueAmountCny,
    });

    if (!decision.ok) {
      await this.notifications.create("warning", "改图要求不完整", decision.reason, {
        designJobId: job.id,
      });
      return { decision, revision: null, job };
    }

    const selectedImageId = payload.selectedImageId || this.findSelectedImageId(job);
    let revision: DesignRevisionLike;
    if (appConfig.useLocalStore) {
      revision = this.localStore.createDesignRevision({
        designJobId: job.id,
        selectedImageId,
        revisionNumber: decision.revisionNumber,
        instruction: String(payload.instruction || "").trim(),
        sourceText: payload.sourceText || payload.instruction,
        policyAction: decision.action,
        status: decision.submitAllowed ? "requested" : "manual_review",
        chargeRequired: decision.chargeRequired,
        manualReviewRequired: decision.manualReviewRequired,
      });
    } else {
      revision = await prisma.designRevision.create({
        data: {
          designJobId: job.id,
          selectedImageId,
          revisionNumber: decision.revisionNumber,
          instruction: String(payload.instruction || "").trim(),
          sourceText: payload.sourceText || payload.instruction,
          policyAction: decision.action,
          status: decision.submitAllowed ? "requested" : "manual_review",
          chargeRequired: decision.chargeRequired,
          manualReviewRequired: decision.manualReviewRequired,
        },
      });
    }

    if (!decision.submitAllowed) {
      const manualLock = job.conversationId
        ? await this.wechatDispatch.setConversationManualLock(job.conversationId, {
            expectedWechatAccountId: job.wechatAccountId,
            expectedConversationId: job.conversationId,
            expectedCustomerId: job.customerId,
            locked: true,
            reviewer: "system",
            reason: decision.reason,
            note: decision.reason,
          })
        : null;
      const blockedSendTasks = manualLock?.blockedSendTasks || [];
      const inFlightSendTasks = manualLock?.inFlightSendTasks || [];
      await this.notifications.create(
        decision.chargeRequired ? "warning" : "info",
        decision.chargeRequired ? "改图已超出自动处理范围" : "高价值客户改图待人工审核",
        blockedSendTasks.length
          ? `${decision.reason} 已暂停 ${blockedSendTasks.length} 个待发送任务。`
          : decision.reason,
        {
          designJobId: job.id,
          revisionId: revision.id,
          conversationId: job.conversationId,
          blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
          inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        },
      );
      const updated = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(job.id, {
            status: "manual_review",
            manualQcRequired: true,
            revisionCount: decision.revisionNumber,
            revisionPolicy: decision,
          })
        : await prisma.designJob.update({
            where: { id: job.id },
            data: {
              status: "manual_review",
              manualQcRequired: true,
              revisionCount: decision.revisionNumber,
              revisionPolicy: decision as any,
            },
            include: { images: true, assets: true, revisions: true },
          });
      await this.createReviewLog({
        targetType: "design_revision",
        targetId: revision.id,
        decision: decision.action,
        reviewer: "system",
        note: decision.reason,
        beforeStatus: job.status || "",
        afterStatus: "manual_review",
        metadata: {
          source: "design_revision_policy",
          designJobId: job.id,
          wechatAccountId: job.wechatAccountId,
          conversationId: job.conversationId,
          customerId: job.customerId,
          revisionId: revision.id,
          revisionNumber: decision.revisionNumber,
          chargeRequired: decision.chargeRequired,
          blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
          inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
        },
      });
      return { decision, revision, job: updated };
    }

    await this.assertDesignPlatformPreflight(job.id);

    let remote: any;
    try {
      const payloadForPlatform = await this.buildDesignPlatformPayload(job, revision);
      remote = await this.designPlatform.createDesignJob(payloadForPlatform);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown design revision submit error";
      revision = await this.updateRevision(revision.id, { status: "failed" });
      await this.notifications.create("error", "改图提交设计平台失败", errorMessage, {
        designJobId: job.id,
        revisionId: revision.id,
      });
      const updated = await this.failDesignJobForManualReview(job, {
        reason: "design_revision_submit_failed",
        source: "design_revision",
        errorMessage,
      });
      return { decision, revision, job: updated, errorMessage };
    }
    const externalJobId = remote.externalJobId || remote.jobId || remote.id;
    revision = await this.updateRevision(revision.id, {
      externalJobId,
      status: "submitted",
    });

    const updated = appConfig.useLocalStore
      ? this.localStore.updateDesignJob(job.id, {
          externalJobId,
          status: "submitted",
          submittedAt: new Date().toISOString(),
          revisionCount: decision.revisionNumber,
          revisionPolicy: decision,
          errorMessage: "",
        })
      : await prisma.designJob.update({
          where: { id: job.id },
          data: {
            externalJobId,
            status: "submitted",
            submittedAt: new Date(),
            revisionCount: decision.revisionNumber,
            revisionPolicy: decision as any,
            errorMessage: "",
          },
          include: { images: true, assets: true, revisions: true },
        });

    await this.notifications.create("info", "改图已提交设计平台", decision.reason, {
      designJobId: job.id,
      revisionId: revision.id,
      externalJobId,
    });

    if (job.wechatAccountId) {
      const text = `收到，我按您说的“${String(payload.instruction || "").trim()}”重新处理一版，出来后再发您确认。`;
      await this.queueDesignTextMessage(job, text, "design-revision-waiting-message");
    }

    this.scheduleResultPoll(job.requestId, externalJobId);
    return { decision, revision, job: updated };
  }

  async cancel(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    this.assertDesignJobCanCancel(job);
    let remoteResult: Record<string, unknown> | null = null;
    if (job.externalJobId) {
      try {
        remoteResult = await this.designPlatform.cancelDesignJob(job.externalJobId);
      } catch (error) {
        await this.notifications.create("warning", "设计平台取消失败", error instanceof Error ? error.message : "未知错误", {
          designJobId: job.id,
          externalJobId: job.externalJobId,
        });
      }
    }
    await this.notifications.create("info", "设计任务已取消", "该任务不会继续出图或自动发送。", {
      designJobId: job.id,
      externalJobId: job.externalJobId,
    });
    const updated = appConfig.useLocalStore
      ? this.localStore.updateDesignJob(job.id, { status: "cancelled" })
      : await this.prisma.designJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
    return { job: updated, remoteResult };
  }

  async handleDesignPlatformCallback(payload: DesignPlatformCallbackPayload) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(payload.requestId)
      : await this.prisma.designJob.findUnique({
          where: { requestId: payload.requestId },
          include: { images: true },
    });
    if (!job) throw new Error(`design job not found by requestId: ${payload.requestId}`);
    const callbackBinding = validateDesignCallbackBinding({ payload, job });
    if (!callbackBinding.ok) {
      throw new BadRequestException(`design callback binding invalid: ${callbackBinding.reason}`);
    }
    const terminalStatusLabel = this.designJobTerminalStatusLabel(job.status);
    if (terminalStatusLabel) {
      const notificationTitle = String(job.status || "") === "cancelled" ? "已忽略取消任务回调" : "已忽略终态任务回调";
      await this.notifications.create("info", notificationTitle, `设计任务已${terminalStatusLabel}，迟到的设计平台结果不会再保存或触发发送。`, {
        designJobId: job.id,
        externalJobId: payload.externalJobId || job.externalJobId,
        callbackStatus: payload.status,
        designJobStatus: job.status,
      });
      return job;
    }

    if (payload.status === "failed") {
      const failedRevision = await this.finishLatestRevision(job.id, "failed", [], payload.errorMessage);
      const retryCount = this.designResultRetryCount(job, failedRevision);
      await this.notifications.create(retryCount < 1 ? "warning" : "error", "设计平台出图失败", payload.errorMessage || "未返回失败原因", {
        designJobId: job.id,
      });
      if (retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", payload.errorMessage || "设计平台返回失败", {}, failedRevision);
      }
      await this.notifications.create("error", "设计任务已转人工", "自动重试后仍失败，需要客服人工处理。", {
        designJobId: job.id,
      });
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_failed_after_retry",
        source: "design_platform_callback",
        errorMessage: payload.errorMessage || "设计平台返回失败",
      });
    }

    const images = this.normalizeCallbackImages(payload.images || []);
    if (!images.length) {
      const errorMessage = "design platform completed without images";
      const failedRevision = await this.finishLatestRevision(job.id, "failed", [], errorMessage);
      const retryCount = this.designResultRetryCount(job, failedRevision);
      await this.notifications.create(retryCount < 1 ? "warning" : "error", "设计平台未返回图片", errorMessage, {
        designJobId: job.id,
        externalJobId: payload.externalJobId || job.externalJobId,
      });
      if (retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision);
      }
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_completed_without_images",
        source: "design_platform_callback",
        errorMessage,
      });
    }
    const imageMetadataCheck = this.validateCallbackImages(job, images);
    if (!imageMetadataCheck.ok) {
      const errorMessage = `design platform returned invalid image metadata: ${imageMetadataCheck.reasons.join("; ")}`;
      const failedRevision = await this.finishLatestRevision(job.id, "failed", [], errorMessage);
      const retryCount = this.designResultRetryCount(job, failedRevision);
      const retryableFailure = this.isInitialDesignResult(job) || Boolean(failedRevision);
      await this.notifications.create(
        retryCount < 1 && retryableFailure ? "warning" : "error",
        "设计平台图片数据无效",
        imageMetadataCheck.reasons.join("；"),
        {
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
          invalidImageReasons: imageMetadataCheck.reasons,
        },
      );
      if (retryableFailure && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision);
      }
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_invalid_image_metadata",
        source: "design_platform_callback",
        errorMessage,
      });
    }
    const minimumInitialImageCount = this.minimumRequiredInitialImageCount(job);
    if (this.isInitialDesignResult(job) && images.length < minimumInitialImageCount) {
      const errorMessage = `design platform returned only ${images.length} candidate images; expected at least ${minimumInitialImageCount}`;
      await this.finishLatestRevision(job.id, "failed", [], errorMessage);
      const retryCount = Number(job.retryCount || 0);
      await this.notifications.create(
        retryCount < 1 ? "warning" : "error",
        "设计平台候选图不足",
        `只返回 ${images.length} 张候选图，至少需要 ${minimumInitialImageCount} 张。`,
        {
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
          returnedImageCount: images.length,
          requiredImageCount: minimumInitialImageCount,
        },
      );
      if (retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage);
      }
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_insufficient_images",
        source: "design_platform_callback",
        errorMessage,
      });
    }

    const savedImages: Array<{
      image: any;
      imageId: string;
      position: number;
      fingerprint?: string;
      legacyIdentityHash: string;
      localPath?: string;
    }> = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const imageId = this.versionedImageId(job, image.imageId);
      const position = this.versionedImagePosition(job, index + 1);
      const legacyIdentityHash = this.buildLegacyImageIdentityHash(job, image, imageId, position);
      let localPath: string | undefined;
      let fingerprint: string | undefined;
      try {
        localPath = await this.storage.saveDesignImage(job.id, imageId, image.downloadUrl);
        fingerprint = (await fingerprintImageFile(localPath)).fingerprint;
      } catch (error) {
        if (localPath) await this.removeUnusableDownloadedDesignImage(job.id, localPath);
        localPath = undefined;
        fingerprint = undefined;
      }
      savedImages.push({ image, imageId, position, fingerprint, legacyIdentityHash, localPath });
    }

    const downloadFailureCount = savedImages.filter((item) => !item.localPath).length;
    const localSavedCount = savedImages.length - downloadFailureCount;
    const requiredLocalImageCount = this.minimumRequiredLocalImageCount(job);
    if (localSavedCount < requiredLocalImageCount) {
      const errorMessage = `design platform saved only ${localSavedCount} local image files; expected at least ${requiredLocalImageCount}`;
      const failedRevision = await this.finishLatestRevision(job.id, "failed", [], errorMessage);
      const retryCount = this.designResultRetryCount(job, failedRevision);
      const retryableFailure = this.isInitialDesignResult(job) || Boolean(failedRevision);
      await this.notifications.create(
        retryCount < 1 && retryableFailure ? "warning" : "error",
        "设计图本地保存不足",
        `只有 ${localSavedCount} 张候选图保存到本地，至少需要 ${requiredLocalImageCount} 张才能安全发给客户。`,
        {
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
          localSavedCount,
          requiredLocalImageCount,
          downloadFailureCount,
        },
      );
      if (retryableFailure && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision);
      }
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_local_image_save_failed",
        source: "design_platform_callback",
        errorMessage,
      });
    }

    if (downloadFailureCount) {
      await this.notifications.create(
        "warning",
        "设计图本地保存失败",
        `有 ${downloadFailureCount} 张候选图没有保存到本地文件，自动微信发图会等待人工确认。`,
        {
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
        },
      );
    }

    if (appConfig.useLocalStore) {
      this.localStore.upsertDesignImages(
        job.id,
        savedImages.map(({ image, imageId, position, fingerprint, legacyIdentityHash, localPath }) => ({
          imageId,
          downloadUrl: image.downloadUrl,
          width: image.width,
          height: image.height,
          localPath,
          fingerprint,
          legacyIdentityHash,
          position,
        })),
      );
    } else {
      for (const { image, imageId, position, fingerprint, legacyIdentityHash, localPath } of savedImages) {
        await this.prisma.designImageCandidate.upsert({
          where: {
            designJobId_imageId: {
              designJobId: job.id,
              imageId,
            },
          },
          update: {
            downloadUrl: image.downloadUrl,
            localPath,
            width: image.width,
            height: image.height,
            fingerprint,
            legacyIdentityHash,
            position,
          } as any,
          create: {
            designJobId: job.id,
            imageId,
            downloadUrl: image.downloadUrl,
            localPath,
            width: image.width,
            height: image.height,
            fingerprint,
            legacyIdentityHash,
            position,
          } as any,
        });
      }
    }

    await this.finishLatestRevision(
      job.id,
      "completed",
      images.map((image) => this.versionedImageId(job, image.imageId)),
    );

    const nextStatus = nextStatusAfterDesignCompleted({
      isHighValue: job.isHighValue,
      budget: job.budget,
      highValueAmountCny: appConfig.highValueAmountCny,
      manualQcRequired: job.manualQcRequired,
    });
    await this.notifications.create("info", "设计图已生成", `已生成 ${images.length} 张候选图`, {
      designJobId: job.id,
    });
    if (appConfig.useLocalStore) {
      return this.localStore.updateDesignJob(job.id, {
        externalJobId: payload.externalJobId || job.externalJobId,
        status: nextStatus,
        completedAt: new Date().toISOString(),
      });
    }
    return this.prisma.designJob.update({
      where: { id: job.id },
      data: {
        externalJobId: payload.externalJobId || job.externalJobId,
        status: nextStatus,
        completedAt: new Date(),
      },
      include: { images: true },
    });
  }

  private assertDesignJobCanCancel(job: any) {
    const status = String(job?.status || "");
    const label = this.designJobTerminalStatusLabel(status);
    if (!label) return;
    throw new BadRequestException(`design job cannot be cancelled: ${label}`);
  }

  private assertDesignJobCanManualRetry(job: any) {
    const status = String(job?.status || "");
    if (status === "failed" || status === "timeout") return;
    if (status === "manual_review" && Boolean(job?.errorMessage)) return;
    const terminalLabel = this.designJobTerminalStatusLabel(status);
    if (terminalLabel) {
      throw new BadRequestException(`design job cannot be retried: ${terminalLabel}`);
    }
    throw new BadRequestException(`design job cannot be retried from status: ${status || "unknown"}`);
  }

  private assertDesignJobCanRequestRevision(job: any) {
    const status = String(job?.status || "");
    const label = this.designJobRevisionBlockedStatusLabel(status);
    if (!label) return;
    throw new BadRequestException(`design job cannot request revision: ${label}`);
  }

  private designJobRevisionBlockedStatusLabel(status: string) {
    const labels: Record<string, string> = {
      quote_created: "已生成报价草稿",
      cancelled: "任务已经取消",
    };
    return labels[String(status || "")] || "";
  }

  private designJobTerminalStatusLabel(status: string) {
    const labels: Record<string, string> = {
      sent: "候选图已发送给客户",
      customer_selected: "客户已经选图",
      quote_created: "已生成报价草稿",
      cancelled: "任务已经取消",
    };
    return labels[String(status || "")] || "";
  }

  private isInitialDesignResult(job: any) {
    return Number(job.revisionCount || 0) <= 0;
  }

  private minimumRequiredInitialImageCount(job: any) {
    const requestedCount = Number(job.outputCount || appConfig.defaultOutputCount || 6);
    if (!Number.isFinite(requestedCount) || requestedCount <= 0) return 4;
    return Math.min(Math.max(Math.trunc(requestedCount), 1), 4);
  }

  private minimumRequiredLocalImageCount(job: any) {
    return this.isInitialDesignResult(job) ? this.minimumRequiredInitialImageCount(job) : 1;
  }

  private normalizeCallbackImages(images: any[]) {
    return images.map((image) => {
      const record = isPlainObject(image) ? image : {};
      return {
        ...record,
        imageId: typeof record.imageId === "string" ? record.imageId.trim() : "",
        downloadUrl: typeof record.downloadUrl === "string" ? record.downloadUrl.trim() : "",
      };
    });
  }

  private validateCallbackImages(job: any, images: any[]) {
    const reasons: string[] = [];
    const seenImageIds = new Set<string>();
    const seenDownloadUrls = new Set<string>();
    images.forEach((image, index) => {
      if (!image.imageId) {
        reasons.push(`image[${index}].imageId is required`);
        return;
      }
      const versionedImageId = this.versionedImageId(job, image.imageId);
      if (seenImageIds.has(versionedImageId)) {
        reasons.push(`duplicate imageId: ${versionedImageId}`);
      }
      seenImageIds.add(versionedImageId);

      if (!image.downloadUrl) {
        reasons.push(`image[${index}].downloadUrl is required`);
        return;
      }
      if (seenDownloadUrls.has(image.downloadUrl)) {
        reasons.push(`duplicate downloadUrl: ${image.downloadUrl}`);
      }
      seenDownloadUrls.add(image.downloadUrl);
    });
    return { ok: reasons.length === 0, reasons };
  }

  async quickConfirmAndQueueSend(
    id: string,
    options: { releaseManualLock?: boolean; reviewer?: string; releaseReason?: string } & ExpectedIdentityPayload = {},
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({
          where: { id },
          include: { images: true },
    });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, options, "design job");
    this.assertDesignJobHasCompleteSendIdentity(job);

    const allImages = [...((job.images || []) as DesignImageCandidateLike[])].sort((a, b) => a.position - b.position);
    const images: DesignImageCandidateLike[] = latestCandidateRound(allImages).sort(
      (a: DesignImageCandidateLike, b: DesignImageCandidateLike) => a.position - b.position,
    );
    if (!images.length) throw new BadRequestException("design job has no sendable images");
    const remoteOnlyImages = images.filter((image) => !image.localPath && image.downloadUrl);
    const missingLocalImages = images.filter((image) => !image.localPath);
    if (remoteOnlyImages.length) {
      await this.notifications.create(
        "warning",
        "候选图未保存到本地",
        `有 ${remoteOnlyImages.length} 张候选图只有远程链接，已阻止进入微信发送队列。`,
        {
          designJobId: job.id,
          requestId: job.requestId,
        },
      );
    }
    if (missingLocalImages.length) {
      throw new BadRequestException(
        `design job has ${missingLocalImages.length} candidate images without local files; poll results again or retry generation before sending`,
      );
    }
    const imagePaths = images.map((image) => image.localPath).filter(Boolean) as string[];
    if (!options.releaseManualLock) {
      const decision = evaluateLowValueDesignImageSend({ ...job, images }, { highValueAmountCny: appConfig.highValueAmountCny });
      if (!decision.ok) {
        throw new BadRequestException(`design image send is not allowed without manual approval: ${decision.reason}`);
      }
    }

    if (options.releaseManualLock) {
      assertManualReleaseReason(options.releaseReason, "design send manual release");
      await this.wechatDispatch.setConversationManualLock(job.conversationId, {
        expectedWechatAccountId: job.wechatAccountId,
        expectedConversationId: job.conversationId,
        expectedCustomerId: job.customerId,
        locked: false,
        reviewer: options.reviewer || "人工客服",
        reason: options.releaseReason,
        note: "人工已审核通过发送，恢复该会话的发送队列。",
      });
    }

    try {
      const sendTask = await this.wechatDispatch.enqueueDesignImages({
        wechatAccountId: job.wechatAccountId,
        conversationId: job.conversationId,
        designJobId: job.id,
        imagePaths,
        textBeforeImages: "我先把几版礼盒效果图发您，您可以直接引用喜欢的那张告诉我。",
        automation: {
          source: "low_value_design_image_send",
          valueLevel: "low",
          queuedBy: "low_value_automation",
        },
      });
      if (appConfig.useLocalStore) this.localStore.updateDesignJob(id, { status: "sent", sendTaskId: sendTask.id });
      else await this.prisma.designJob.update({ where: { id }, data: { status: "sent", sendTaskId: sendTask.id } as any });
      if (options.releaseManualLock) {
        await this.createReviewLog({
          targetType: "design_job",
          targetId: job.id,
          decision: options.releaseReason || "manual_approve_send",
          reviewer: options.reviewer || "人工客服",
          note: "人工审核通过并已创建微信发送任务。",
          beforeStatus: job.status || "",
          afterStatus: "sent",
          metadata: {
            source: "manual_release_design_send",
            conversationId: job.conversationId,
            wechatAccountId: job.wechatAccountId,
            customerId: job.customerId,
            requestId: job.requestId,
            sendTaskId: sendTask.id,
            releaseReason: options.releaseReason,
          },
        });
      }
      return sendTask;
    } catch (error) {
      if (options.releaseManualLock) {
        await this.wechatDispatch.setConversationManualLock(job.conversationId, {
          expectedWechatAccountId: job.wechatAccountId,
          expectedConversationId: job.conversationId,
          expectedCustomerId: job.customerId,
          locked: true,
          reviewer: options.reviewer || "人工客服",
          reason: "manual_approve_send_queue_failed",
          note: `人工审核发送未能入队，已重新接管会话：${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
      throw error;
    }
  }

  async selectImage(id: string, input: string | (SelectDesignImagePayload & ExpectedIdentityPayload)) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    const expected = typeof input === "string" ? {} : input || {};
    assertExpectedIdentity(job, expected, "design job");
    const orderedImages = [...((job.images || []) as DesignImageCandidateLike[])].sort(
      (a, b) => a.position - b.position,
    );
    const selectionInput = typeof input === "string" ? { text: input } : input || {};
    const selectionPlan = planCustomerImageSelection({
      ...selectionInput,
      candidates: orderedImages,
    });
    const result = selectionPlan.result || {};
    if (selectionPlan.reason && !result.reason) result.reason = selectionPlan.reason;
    if (!selectionPlan.ok || selectionPlan.reviewRequired || !selectionPlan.result?.candidate) {
      await this.notifications.create("warning", "客户选图需要人工确认", result.reason || "未识别到明确候选图", {
        designJobId: job.id,
        selection: selectionInput,
        plan: selectionPlan,
      });
      return {
        matched: false,
        reviewRequired: Boolean(selectionPlan.reviewRequired),
        reason: selectionPlan.reason,
        plan: selectionPlan,
        result: selectionPlan.result || null,
      };
    }

    const feedback = this.selectionFeedback(selectionInput, result);
    if (appConfig.useLocalStore) {
      this.localStore.selectDesignImage(job.id, result.candidate.id, feedback);
      const followUp = await this.afterImageSelected(job, result.candidate.id);
      return { matched: true, result, ...followUp };
    }

    await this.prisma.designImageCandidate.updateMany({
      where: { designJobId: job.id },
      data: { selected: false },
    });
    await this.prisma.designImageCandidate.update({
      where: { id: result.candidate.id },
      data: { selected: true, customerFeedback: feedback },
    });
    const followUp = await this.afterImageSelected(job, result.candidate.id);
    return { matched: true, result, ...followUp };
  }

  private async afterImageSelected(job: any, selectedImageId: string) {
    if (this.isHighValueDesignJob(job)) {
      const updated = await this.handoffDesignJobToManual(job, {
        reason: "high_value_customer_selected_image",
        source: "customer_image_selection",
        selectedImageId,
        note: "高价值客户已选图，请人工确认报价、交期和后续跟进话术。",
      });
      return {
        reviewRequired: true,
        autoQuoteCreated: false,
        quote: null,
        nextStatus: updated.status,
      };
    }

    try {
      const quote = await this.quotes.createFromDesignJob(job.id, selectedImageId);
      const updated = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(job.id, { status: "quote_created" })
        : await this.prisma.designJob.update({ where: { id: job.id }, data: { status: "quote_created" } });
      await this.notifications.create("info", "已自动生成报价草稿", "客户选图明确，低风险任务已生成报价草稿，等待发送或人工复核。", {
        designJobId: job.id,
        quoteDraftId: quote.id,
        selectedImageId,
      });
      return {
        reviewRequired: false,
        autoQuoteCreated: true,
        quote,
        nextStatus: updated.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      await this.notifications.create("error", "自动生成报价草稿失败", errorMessage, {
        designJobId: job.id,
        selectedImageId,
      });
      const updated = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(job.id, { status: "customer_selected" })
        : await this.prisma.designJob.update({ where: { id: job.id }, data: { status: "customer_selected" } });
      return {
        reviewRequired: true,
        autoQuoteCreated: false,
        quote: null,
        nextStatus: updated.status,
        errorMessage,
      };
    }
  }

  async createQuote(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");

    const quote = await this.quotes.createFromDesignJob(id);
    if (appConfig.useLocalStore) this.localStore.updateDesignJob(id, { status: "quote_created" });
    else await this.prisma.designJob.update({ where: { id }, data: { status: "quote_created" } });
    return quote;
  }

  async markManualReview(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");

    return this.handoffDesignJobToManual(job, {
      reason: "manual_requested",
      source: "manual_review_button",
      note: "需要客服确认图片、报价或客户意图。",
    });
  }

  private async failDesignJobForManualReview(
    job: any,
    options: {
      reason: string;
      source: string;
      errorMessage: string;
    },
  ) {
    const failedJob = appConfig.useLocalStore
      ? this.localStore.updateDesignJob(job.id, {
          status: "failed",
          errorMessage: options.errorMessage,
        })
      : await this.prisma.designJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorMessage: options.errorMessage,
          },
        });
    return this.handoffDesignJobToManual(failedJob, {
      reason: options.reason,
      source: options.source,
      beforeStatus: "failed",
      note: `${options.errorMessage} 已转人工处理。`,
      title: "设计任务失败已转人工",
    });
  }

  private async handoffDesignJobToManual(
    job: any,
    options: {
      reason: string;
      source: string;
      beforeStatus?: string;
      selectedImageId?: string | null;
      note?: string;
      title?: string;
      reviewer?: string;
    },
  ) {
    const beforeStatus = options.beforeStatus || job.status || "";
    const updated = appConfig.useLocalStore
      ? this.localStore.updateDesignJob(job.id, { status: "manual_review", manualQcRequired: true })
      : await this.prisma.designJob.update({
          where: { id: job.id },
          data: { status: "manual_review", manualQcRequired: true },
        });

    const manualLock = job.conversationId
      ? await this.wechatDispatch.setConversationManualLock(job.conversationId, {
          expectedWechatAccountId: job.wechatAccountId,
          expectedConversationId: job.conversationId,
          expectedCustomerId: job.customerId,
          locked: true,
          reviewer: options.reviewer || "system",
          reason: options.reason,
          note: options.note || "设计任务已转人工，自动回复和自动发送暂停。",
        })
      : null;
    const blockedSendTasks = manualLock?.blockedSendTasks || [];
    const inFlightSendTasks = manualLock?.inFlightSendTasks || [];
    await this.notifications.create(
      "warning",
      options.title || "设计任务已转人工",
      blockedSendTasks.length
        ? `${options.note || "需要客服确认图片、报价或客户意图。"} 已暂停 ${blockedSendTasks.length} 个待发送任务。`
        : options.note || "需要客服确认图片、报价或客户意图。",
      {
        designJobId: job.id,
        requestId: job.requestId,
        conversationId: job.conversationId,
        selectedImageId: options.selectedImageId || undefined,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
      },
    );
    await this.createReviewLog({
      targetType: "design_job",
      targetId: job.id,
      decision: options.reason,
      reviewer: options.reviewer || "system",
      note: options.note || "",
      beforeStatus,
      afterStatus: "manual_review",
      metadata: {
        ...this.buildManualHandoffMetadata(job, options),
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
      },
    });

    return updated;
  }

  private async createReviewLog(payload: {
    targetType: string;
    targetId: string;
    decision: string;
    reviewer: string;
    note?: string;
    beforeStatus?: string;
    afterStatus?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (appConfig.useLocalStore) return this.localStore.createReviewLog(payload);
    const prisma = this.prisma as any;
    return prisma.reviewLog.create({ data: payload });
  }

  private buildManualHandoffMetadata(
    job: any,
    options: {
      reason: string;
      source: string;
      selectedImageId?: string | null;
    },
  ) {
    const metadata: Record<string, unknown> = {
      reason: options.reason,
      source: options.source,
    };
    if (job.requestId) metadata.requestId = job.requestId;
    if (job.conversationId) metadata.conversationId = job.conversationId;
    if (job.wechatAccountId) metadata.wechatAccountId = job.wechatAccountId;
    if (job.customerId) metadata.customerId = job.customerId;
    if (options.selectedImageId) metadata.selectedImageId = options.selectedImageId;
    return metadata;
  }

  private async queueDesignTextMessage(job: any, text: string, reason: string) {
    if (!job.wechatAccountId || !job.conversationId) return null;
    try {
      return await this.wechatDispatch.enqueueTextMessage({
        wechatAccountId: job.wechatAccountId,
        conversationId: job.conversationId,
        designJobId: job.id,
        text,
        reason,
      });
    } catch (error) {
      if (await this.isConversationManualLocked(job.conversationId)) {
        await this.notifications.create(
          "warning",
          "自动话术已暂停",
          "该会话已人工接管，系统没有创建新的自动发送任务。",
          {
            designJobId: job.id,
            requestId: job.requestId,
            conversationId: job.conversationId,
            reason,
          },
        );
        return null;
      }
      throw error;
    }
  }

  private async isConversationManualLocked(conversationId: string) {
    const conversation = appConfig.useLocalStore
      ? this.localStore.listConversations().find((item: any) => item.id === conversationId)
      : await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    return Boolean(conversation?.manualLocked);
  }

  private async retryDesignJob(
    id: string,
    mode: "automatic" | "manual",
    reason?: string,
    expected: ExpectedIdentityPayload = {},
    revision?: DesignRevisionLike | null,
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await (this.prisma as any).designJob.findUnique({ where: { id }, include: { assets: true, revisions: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");

    try {
      await this.assertDesignPlatformPreflight(job.id);
      const payload = await this.buildDesignPlatformPayload(job, revision);
      const remote = await this.designPlatform.createDesignJob(payload);
      const externalJobId = remote.externalJobId || remote.jobId || remote.id;
      const retryCount = Number(job.retryCount || 0) + 1;
      if (revision?.id) {
        const revisionRetryCount = Number(revision.retryCount || 0) + 1;
        await this.updateRevision(revision.id, {
          externalJobId,
          status: "submitted",
          retryCount: revisionRetryCount,
          errorMessage: "",
        });
      }
      const updated = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(job.id, {
            externalJobId,
            status: "submitted",
            retryCount,
            submittedAt: new Date().toISOString(),
            errorMessage: "",
          })
        : await this.prisma.designJob.update({
            where: { id: job.id },
            data: {
              externalJobId,
              status: "submitted",
              retryCount,
              submittedAt: new Date(),
              errorMessage: "",
            },
          });
      await this.notifications.create(
        mode === "automatic" ? "warning" : "info",
        mode === "automatic" ? "设计任务已自动重试" : "设计任务已重新提交",
        reason || "已重新提交到设计平台，等待新的出图结果。",
        { designJobId: job.id, externalJobId },
      );
      this.scheduleResultPoll(job.requestId, externalJobId);
      return updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      await this.notifications.create("error", "设计任务重试失败", errorMessage, {
        designJobId: job.id,
        externalJobId: job.externalJobId,
      });
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_retry_submit_failed",
        source: "retry_design_job",
        errorMessage,
      });
    }
  }

  private async buildDesignPlatformPayload(job: any, revision?: DesignRevisionLike | null): Promise<DesignPlatformJobPayload> {
    const requestedAssets = [
      ...(job.assets || []),
      ...this.bundleImageAssetsForDesignPlatform(job.bundle || {}, job.assets || []),
    ];
    const assets = await this.uploadAssetsForDesignPlatform(requestedAssets);
    const failedAssets = assets.filter((asset: any) => asset.uploadError);
    if (failedAssets.length) {
      const failedNames = failedAssets.map((asset: any) => asset.fileName || asset.assetId || "asset").join(", ");
      throw new BadRequestException(`design asset upload failed: ${failedNames}`);
    }
    return {
      requestId: job.requestId,
      wechatAccountId: job.wechatAccountId,
      customerId: job.customerId,
      conversationId: job.conversationId,
      orderId: job.orderId,
      budget: job.budget as Record<string, unknown>,
      scene: job.scene,
      bundle: job.bundle as Record<string, unknown>,
      assets,
      outputCount: job.outputCount,
      renderStyle: job.renderStyle,
      requirements: job.requirements as Record<string, unknown>,
      customerText: job.customerText,
      callback: this.buildDesignPlatformCallback(job.requestId),
      revision: revision
        ? {
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            instruction: revision.instruction,
            selectedImageId: revision.selectedImageId,
            sourceText: revision.sourceText,
          }
        : null,
      };
  }

  private buildDesignPlatformCallback(requestId: string) {
    const configuredUrl = String(appConfig.designPlatformCallbackUrl || "").trim();
    const baseUrl = String(appConfig.customerServicePublicBaseUrl || `http://127.0.0.1:${appConfig.apiPort}`).replace(
      /\/+$/,
      "",
    );
    const url = configuredUrl || `${baseUrl}/api/integrations/design-platform/callback`;
    const headers = appConfig.callbackApiKey
      ? {
          Authorization: `Bearer ${appConfig.callbackApiKey}`,
        }
      : undefined;
    return {
      url,
      method: "POST" as const,
      events: ["completed", "failed"] as Array<"completed" | "failed">,
      headers,
      requestId,
      fallbackPolling: true,
    };
  }

  private async updateRevision(id: string, patch: Record<string, unknown>) {
    if (appConfig.useLocalStore) return this.localStore.updateDesignRevision(id, patch);
    const prisma = this.prisma as any;
    return prisma.designRevision.update({ where: { id }, data: patch });
  }

  private async finishLatestRevision(
    designJobId: string,
    status: "completed" | "failed",
    resultImageIds: string[] = [],
    errorMessage?: string,
  ) {
    const revision = appConfig.useLocalStore
      ? this.localStore.getLatestActiveDesignRevision(designJobId)
      : await (this.prisma as any).designRevision.findFirst({
          where: { designJobId, status: { in: ["submitted", "generating"] } },
          orderBy: { updatedAt: "desc" },
        });
    if (!revision) return null;
    return this.updateRevision(revision.id, {
      status,
      resultImageIds,
      errorMessage: errorMessage || "",
    });
  }

  private designResultRetryCount(job: any, revision?: DesignRevisionLike | null) {
    return revision ? Number(revision.retryCount || 0) : Number(job.retryCount || 0);
  }

  private async findLatestRevisionForRetry(designJobId: string): Promise<DesignRevisionLike | null> {
    const retryableStatuses = ["submitted", "generating"];
    if (appConfig.useLocalStore) {
      const revisions = this.localStore.listDesignRevisions(designJobId) || [];
      return (
        this.latestRevisionByUpdatedAt(revisions.filter((revision: any) => retryableStatuses.includes(revision.status))) ||
        this.latestRevisionByUpdatedAt(revisions.filter((revision: any) => revision.status === "failed"))
      );
    }
    const prisma = this.prisma as any;
    const active = await prisma.designRevision.findFirst({
      where: { designJobId, status: { in: retryableStatuses } },
      orderBy: { updatedAt: "desc" },
    });
    if (active) return active;
    return prisma.designRevision.findFirst({
      where: { designJobId, status: "failed" },
      orderBy: { updatedAt: "desc" },
    });
  }

  private latestRevisionByUpdatedAt(revisions: DesignRevisionLike[]) {
    return (
      [...revisions].sort((a: any, b: any) =>
        String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")),
      )[0] || null
    );
  }

  private findSelectedImageId(job: any) {
    const selected = (job.images || []).find((image: any) => image.selected);
    return selected?.id || selected?.imageId || null;
  }

  private versionedImageId(job: any, imageId: string) {
    const revisionCount = Number(job.revisionCount || 0);
    if (/^r\d+-/.test(String(imageId || ""))) return imageId;
    return revisionCount > 0 ? `r${revisionCount}-${imageId}` : imageId;
  }

  private versionedImagePosition(job: any, position: number) {
    const revisionCount = Number(job.revisionCount || 0);
    return revisionCount > 0 ? revisionCount * 100 + position : position;
  }

  private buildLegacyImageIdentityHash(job: any, image: any, imageId: string, position: number) {
    return createHash("sha256")
      .update([job.id, job.requestId, imageId, position, image.downloadUrl || ""].join("|"))
      .digest("hex")
      .slice(0, 32);
  }

  private resolveLegacyIdentityHash(image: any) {
    const explicit = String(image?.legacyIdentityHash || "").trim();
    if (explicit) return explicit;
    const oldFingerprint = String(image?.fingerprint || "").trim();
    return /^dhash64:v1:[a-f0-9]{16}$/i.test(oldFingerprint) ? undefined : oldFingerprint || undefined;
  }

  private async removeUnusableDownloadedDesignImage(designJobId: string, localPath: string) {
    const expectedDirectory = path.resolve(appConfig.localStorageRoot, "design-jobs", String(designJobId));
    const resolved = path.resolve(String(localPath || ""));
    const relative = path.relative(expectedDirectory, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
    await fs.unlink(resolved).catch(() => undefined);
  }

  private selectionFeedback(input: SelectDesignImagePayload, result: any) {
    if (input.text) return input.text;
    if (input.referencedImageId || input.quotedImageId || input.attachmentImageId) {
      return `客户引用候选图：${input.referencedImageId || input.quotedImageId || input.attachmentImageId}`;
    }
    if (input.screenshotFingerprint || input.attachmentFingerprint) {
      return `客户截图匹配候选图：${result.imageId || result.candidate?.imageId || result.candidate?.id}`;
    }
    return `客户选择候选图：${result.imageId || result.candidate?.imageId || result.candidate?.id}`;
  }

  private async uploadAssetsForDesignPlatform(assets: any[]) {
    const uploaded = [];
    for (const asset of assets) {
      try {
        const remote = await this.designPlatform.uploadAsset({
          assetId: asset.id,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          localPath: asset.localPath,
          sizeBytes: asset.sizeBytes,
          role: asset.role || "reference",
          ownerType: asset.ownerType,
          ownerId: asset.ownerId,
          source: asset.source,
          sourceRef: asset.sourceRef,
          skuCode: asset.skuCode,
          name: asset.name,
        });
        uploaded.push({
          assetId: asset.id,
          remoteAssetId: remote.assetId || remote.remoteAssetId || remote.id || remote.url,
          url: remote.url,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          role: asset.role || "reference",
          source: asset.source,
          sourceRef: asset.sourceRef,
          skuCode: asset.skuCode,
          name: asset.name,
        });
      } catch (error) {
        uploaded.push({
          assetId: asset.id,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          role: asset.role || "reference",
          source: asset.source,
          sourceRef: asset.sourceRef,
          skuCode: asset.skuCode,
          name: asset.name,
          uploadError: error instanceof Error ? error.message : "unknown asset upload error",
        });
      }
    }
    return uploaded;
  }

  private bundleImageAssetsForDesignPlatform(bundle: Record<string, unknown>, existingAssets: any[] = []) {
    if (appConfig.designPlatformAdapter === "art_image_local") return [];

    const existingLocalRefs = new Set(
      existingAssets.map((asset) => this.normalizedLocalRef(asset?.localPath)).filter(Boolean),
    );

    return inspectBundleReferences(bundle)
      .filter((ref: any) => ref.ok && typeof ref.ref === "string" && path.isAbsolute(ref.ref))
      .filter((ref: any) => {
        const normalized = this.normalizedLocalRef(ref.ref);
        if (!normalized || existingLocalRefs.has(normalized)) return false;
        existingLocalRefs.add(normalized);
        return true;
      })
      .map((ref: any) => ({
        id: `bundle_${createHash("sha1")
          .update([ref.skuCode || "", ref.name || "", ref.ref || ""].join("|"))
          .digest("hex")
          .slice(0, 16)}`,
        fileName: path.basename(ref.ref),
        mimeType: mimeTypeFromImagePath(ref.ref),
        localPath: ref.ref,
        role: ref.role || "sku_image",
        source: "bundle",
        sourceRef: ref.source,
        skuCode: ref.skuCode || undefined,
        name: ref.name || undefined,
      }));
  }

  private normalizedLocalRef(value: unknown) {
    if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) return "";
    return path.resolve(value).toLowerCase();
  }

  private async prepareSmokeAssets(requestId: string) {
    const dir = path.join(appConfig.localStorageRoot, "smoke", "design-platform", requestId);
    await fs.mkdir(dir, { recursive: true });

    const files = [
      { key: "customer_logo", fileName: "customer-logo.png", role: "customer_logo", source: "smoke_customer", skuCode: "", name: "测试客户 Logo" },
      { key: "gift_box", fileName: "gift-box.png", role: "gift_box", source: "smoke_bundle", skuCode: "SMOKE-BOX", name: "试跑礼盒" },
      { key: "sku_image", fileName: "tea-sku.png", role: "sku_image", source: "smoke_bundle", skuCode: "SMOKE-TEA", name: "试跑内搭商品" },
    ];

    const assets = [];
    const paths: Record<string, string> = {};
    for (const file of files) {
      const localPath = path.join(dir, file.fileName);
      await fs.writeFile(localPath, SMOKE_TEST_PNG_BYTES);
      paths[file.key] = localPath;
      assets.push({
        assetId: `${requestId}_${file.key}`,
        fileName: file.fileName,
        mimeType: "image/png",
        localPath,
        sizeBytes: SMOKE_TEST_PNG_BYTES.length,
        role: file.role,
        ownerType: "smoke",
        ownerId: requestId,
        source: file.source,
        skuCode: file.skuCode || undefined,
        name: file.name,
      });
    }

    return {
      assets,
      bundle: {
        giftBox: {
          skuCode: "SMOKE-BOX",
          name: "试跑礼盒",
          localPath: paths.gift_box,
          salePrice: 60,
          cost: 30,
          stock: 999,
        },
        items: [
          {
            skuCode: "SMOKE-TEA",
            name: "试跑内搭商品",
            localPath: paths.sku_image,
            salePrice: 80,
            cost: 40,
            stock: 999,
          },
        ],
      },
    };
  }

  private async waitForSmokeDesignResult(externalJobId: string): Promise<any> {
    const timeoutMs = Math.min(Math.max(Number(appConfig.designPlatformTimeoutMs || 0), 5000), 90_000);
    const intervalMs = Math.min(Math.max(Number(appConfig.designResultPollIntervalMs || 0), 500), 3000);
    const deadline = Date.now() + timeoutMs;
    let lastResult: any = null;

    while (Date.now() < deadline) {
      lastResult = await this.designPlatform.getDesignJobResults(externalJobId);
      const status = String(lastResult?.status || "");
      if (status === "completed") return lastResult;
      if (status === "failed" || status === "cancelled") {
        throw new Error(String(lastResult?.errorMessage || `design platform returned ${status}`));
      }
      await sleep(intervalMs);
    }

    throw new Error(`design platform smoke test timed out after ${timeoutMs}ms: ${String(lastResult?.status || "unknown")}`);
  }

  private async validateCreateIdentity(payload: CreateDesignJobPayload) {
    const conversation = appConfig.useLocalStore
      ? this.localStore.listConversations().find((item: any) => item.id === payload.conversationId) || null
      : await this.prisma.conversation.findUnique({
          where: { id: payload.conversationId },
          select: { id: true, customerId: true, wechatAccountId: true },
        });
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || conversation?.customerId,
      wechatAccountId: payload.wechatAccountId || conversation?.wechatAccountId,
    };
    const identity = validateDesignJobIdentity({
      payload: normalizedPayload,
      conversation,
    });
    if (!identity.ok) throw new BadRequestException(`design job identity invalid: ${identity.reason}`);
    return {
      ...identity,
      customerId: normalizedPayload.customerId,
      wechatAccountId: normalizedPayload.wechatAccountId,
    };
  }

  private normalizeRequestedAssets(payload: CreateDesignJobPayload) {
    const assetIds = Array.isArray(payload.assetIds) ? payload.assetIds.map((assetId) => ({ assetId })) : [];
    return [...(payload.assets || []), ...assetIds];
  }

  private async findDesignJobWithImages(id: string) {
    return appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : this.prisma.designJob.findUnique({
          where: { id },
          include: { images: true },
        });
  }

  private async decorateDesignJobLocalFileStatuses(job: any) {
    if (!job) return job;
    const images = await Promise.all(
      (job.images || []).map(async (image: any) => ({
        ...image,
        localFile: await this.inspectDesignImageLocalFile(job, image),
      })),
    );
    return { ...job, images };
  }

  private async inspectDesignImageLocalFile(job: any, image: any): Promise<DesignImageLocalFileStatus> {
    const canRepair = Boolean(String(image?.downloadUrl || "").trim());
    if (!image?.localPath) {
      return {
        state: "not_saved",
        code: "DESIGN_IMAGE_LOCAL_FILE_NOT_SAVED",
        message: canRepair ? "本地文件尚未保存，可从原始出图地址重新下载。" : "本地文件尚未保存，且原始出图地址不可用。",
        canRepair,
      };
    }

    const binding = this.designImageLocalPathBinding(job, image.localPath);
    if (binding !== "valid") {
      return {
        state: "stale_record",
        code: "DESIGN_IMAGE_LOCAL_FILE_STALE_RECORD",
        message:
          binding === "outside_storage"
            ? "图片记录仍指向旧的运行目录，可重新下载到当前存储目录。"
            : "图片记录指向其他设计任务目录，可重新下载并修复绑定。",
        canRepair,
      };
    }

    try {
      const stat = await fs.stat(path.resolve(String(image.localPath)));
      if (stat.isFile()) {
        return {
          state: "ready",
          code: "DESIGN_IMAGE_LOCAL_FILE_READY",
          message: "本地文件可用。",
          canRepair: false,
        };
      }
    } catch {
      // The record is valid but the file has been removed from disk.
    }
    return {
      state: "missing_file",
      code: "DESIGN_IMAGE_LOCAL_FILE_MISSING",
      message: canRepair ? "图片记录有效，但磁盘文件已缺失，可重新下载。" : "图片记录有效，但磁盘文件已缺失。",
      canRepair,
    };
  }

  private localDesignImageStatusException(status: DesignImageLocalFileStatus) {
    const body = { code: status.code, state: status.state, message: status.message, canRepair: status.canRepair };
    if (status.state === "not_saved") return new GoneException(body);
    if (status.state === "stale_record") return new ConflictException(body);
    return new NotFoundException(body);
  }

  private designImageLocalPathBinding(job: any, localPath: string): "valid" | "outside_storage" | "wrong_job" {
    const resolved = path.resolve(String(localPath || ""));
    const root = path.resolve(appConfig.localStorageRoot);
    const relativeToRoot = path.relative(root, resolved);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return "outside_storage";

    const allowedDirs = [job.id, job.requestId]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => path.resolve(root, "design-jobs", value));
    const belongsToJob = allowedDirs.some((dir) => {
      const relative = path.relative(dir, resolved);
      return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    return belongsToJob ? "valid" : "wrong_job";
  }

  private assertDesignImageLocalPathBelongsToJob(job: any, localPath: string) {
    const binding = this.designImageLocalPathBinding(job, localPath);
    if (binding === "outside_storage") {
      throw new BadRequestException("design image file is outside local storage");
    }
    if (binding === "wrong_job") throw new BadRequestException("design image file is not bound to this design job");
  }

  private scheduleResultPoll(requestId: string, externalJobId: string) {
    const pollKey = `${requestId}:${externalJobId}`;
    if (this.activeResultPolls.has(pollKey)) return;
    this.activeResultPolls.add(pollKey);

    const startedAt = Date.now();
    let lastErrorMessage = "";
    const intervalMs = Math.max(1000, appConfig.designResultPollIntervalMs);
    const maxMs = Math.max(intervalMs, appConfig.designResultPollMaxMs);

    const poll = async () => {
      try {
        const result = await this.designPlatform.getDesignJobResults(externalJobId);
        if (result.status === "completed") {
          await this.handleDesignPlatformCallback({
            requestId,
            externalJobId,
            status: "completed",
            images: result.images || [],
          });
          this.activeResultPolls.delete(pollKey);
          return;
        }

        if (result.status === "failed") {
          await this.handleDesignPlatformCallback({
            requestId,
            externalJobId,
            status: "failed",
            errorMessage: result.errorMessage || "design platform returned failed status",
          });
          this.activeResultPolls.delete(pollKey);
          return;
        }

        if (result.status === "cancelled") {
          this.activeResultPolls.delete(pollKey);
          return;
        }
      } catch (error) {
        lastErrorMessage = error instanceof Error ? error.message : "design platform result polling failed";
      }

      if (Date.now() - startedAt >= maxMs) {
        this.activeResultPolls.delete(pollKey);
        await this.notifications.create(
          "warning",
          "设计结果轮询超时",
          lastErrorMessage || "超过配置等待时间，请客服手动刷新或检查设计平台。",
          {
            requestId,
            externalJobId,
          },
        );
        return;
      }

      setTimeout(poll, intervalMs);
    };

    setTimeout(poll, Math.min(2500, intervalMs));
  }

  private scheduleOneShotResultPoll(requestId: string, externalJobId: string) {
    setTimeout(async () => {
      try {
        const result = await this.designPlatform.getDesignJobResults(externalJobId);
        if (result.status !== "completed") return;
        await this.handleDesignPlatformCallback({
          requestId,
          externalJobId,
          status: "completed",
          images: result.images || [],
        });
      } catch {
        await this.notifications.create("warning", "设计结果轮询失败", "等待设计平台回调或人工刷新。", {
          requestId,
          externalJobId,
        });
      }
    }, 2500);
  }

  private buildTimeoutCustomerMessage(job: any) {
    const sceneName = job.scene ? `这组${job.scene}效果图` : "这组效果图";
    return `${sceneName}我这边还在帮您盯着生成进度，时间比平时稍久一点。为了不耽误您确认方案，我先同步跟进一下，出图后马上发您挑选。`;
  }
  private isHighValueDesignJob(job: any) {
    return Boolean(job?.isHighValue) || isHighValueBudget(job?.budget, Number(appConfig.highValueAmountCny || 10000));
  }

  private assertDesignJobHasCompleteSendIdentity(job: any) {
    const wechatAccountId = String(job?.wechatAccountId || "").trim();
    const customerId = String(job?.customerId || "").trim();
    const conversationId = String(job?.conversationId || "").trim();
    if (wechatAccountId && customerId && conversationId) return;
    throw new BadRequestException("设计任务缺少微信账号、客户或会话绑定，不能进入微信发送队列。");
  }

  private wasAutoRetried(before: any, after: any) {
    const beforeRetryCount = Number(before?.retryCount || 0);
    const afterRetryCount = Number(after?.retryCount || 0);
    return afterRetryCount > beforeRetryCount && ["submitted", "generating"].includes(String(after?.status || ""));
  }
}

function formatAuthSessionUser(auth: { user?: unknown; profile?: unknown }) {
  const user = isPlainObject(auth.user) ? auth.user : {};
  const profile = isPlainObject(auth.profile) ? auth.profile : {};
  return String(user.email || profile.displayName || profile.display_name || user.id || "设计平台账号");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mimeTypeFromImagePath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".bmp") return "image/bmp";
  return "image/png";
}

async function localImagePreviewDataUrl(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return "";
    const data = await fs.readFile(filePath);
    return `data:${mimeTypeFromImagePath(filePath)};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

function cleanIdentityWhere(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
  return {
    ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
    ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
  };
}

function assertManualReleaseReason(reason: unknown, context: string) {
  const text = String(reason || "").trim();
  if (!text || !text.startsWith("manual_")) {
    throw new BadRequestException(`${context} 需要填写明确的人工处理原因，原因编码必须以 manual_ 开头。`);
  }
}
