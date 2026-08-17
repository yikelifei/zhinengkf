import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DesignPlatformClient } from "../integrations/design-platform/design-platform.client";
import {
  isTrustedInternalZhenxiWorkspaceHealth,
  supportsZhenxiCustomerCopyGeneration,
  supportsZhenxiCustomerImageGeneration,
} from "../integrations/design-platform/design-platform-readiness";
import {
  DesignPlatformCallbackPayload,
  DesignPlatformJobPayload,
} from "../integrations/design-platform/design-platform.types";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig, hasIndependentDesignPlatformCallbackApiKey } from "../shared/app-config";
import { assertDemoDataMutationAllowed } from "../shared/demo-data-boundary";
import { StorageService } from "../storage/storage.service";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";
import { QuotesService } from "../quotes/quotes.service";
import { OrdersService } from "../orders/orders.service";
import { AiProviderService } from "../ai/ai-provider.service";
import { rules } from "../shared/rules";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import {
  fingerprintImageBytes,
  fingerprintImageFile,
  MAX_IMAGE_DECODE_PIXELS,
  MAX_IMAGE_FINGERPRINT_BYTES,
  readBoundedRegularFile,
} from "../shared/image-fingerprint";
import {
  assertExactOperationReplay,
  assertStoredOperationIdentityReplay,
  createOperationFingerprint,
  deterministicOperationId,
  isUniqueConstraintError,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
  stableOperationKey,
  type RequestOperationMetadata,
} from "../shared/operation-idempotency";

const SMOKE_TEST_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

const DESIGN_CALLBACK_CLAIM_LEASE_MS = 15 * 60 * 1000;

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
  CUSTOMER_DESIGN_CANDIDATE_COUNT,
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
import {
  CreateDesignJobPayload,
  CreateDesignRevisionPayload,
  ForwardExistingDesignImagesPayload,
  RecoverCompletedDesignExecutionPayload,
  ResolveDesignExecutionRefundPayload,
  ResolveUnknownDesignExecutionPayload,
  SelectDesignImagePayload,
  SubmitDesignJobPayload,
} from "./design-jobs.types";
import { DesignPlatformExecutionService } from "./design-platform-execution.service";

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
  action?: string;
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
export class DesignJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DesignJobsService.name);
  private readonly activeResultPolls = new Set<string>();
  private readonly activeExecutionPromises = new Map<string, Promise<void>>();
  private readonly activeCreateEffectPromises = new Map<string, Promise<any>>();
  private readonly activeExternalOperationPromises = new Map<string, Promise<any>>();
  private readonly activeDesignCallbackPromises = new Map<string, Promise<any>>();
  private readonly activeZhenxiCopyTasks = new Set<string>();
  private readonly activeCustomerCreativeVisualQc = new Set<string>();
  private readonly customerCreativeVisualQcClaimToken = Symbol("customer-creative-visual-qc-claim");
  private activeRecoveryReconciliation: Promise<void> | null = null;
  private recoveryStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly designPlatform: DesignPlatformClient,
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly wechatDispatch: WechatDispatchService,
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
    private readonly platformExecutions: DesignPlatformExecutionService,
    @Optional() private readonly aiProviders?: AiProviderService,
  ) {}

  onApplicationBootstrap() {
    if (!this.usesDurableArtImageExecutions()) return;
    const intervalMs = Math.max(1000, Number(appConfig.designExecutionRecoveryIntervalMs || 15000));
    this.recoveryInterval = setInterval(() => {
      void this.reconcileDurableArtImageExecutions().catch(() => this.reportRecoveryReconciliationFailure("interval"));
    }, intervalMs);
    this.recoveryInterval.unref?.();
    this.recoveryStartupTimer = setTimeout(() => {
      this.recoveryStartupTimer = null;
      void this.reconcileDurableArtImageExecutions().catch(() => this.reportRecoveryReconciliationFailure("startup"));
    }, 0);
    this.recoveryStartupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.recoveryStartupTimer) clearTimeout(this.recoveryStartupTimer);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    this.recoveryStartupTimer = null;
    this.recoveryInterval = null;
  }

  private async reportRecoveryReconciliationFailure(source: "startup" | "interval") {
    try {
      await this.notifications.create(
        "error",
        "设计平台恢复协调失败",
        "持久化设计执行本轮恢复未完成；系统不会自动创建新的尝试，请保留 execution 状态并继续下一轮协调。",
        { source },
      );
    } catch {
      // The durable execution rows remain the source of truth even if notification storage is unavailable.
    }
  }

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

  async listExecutions(id: string, expected: ExpectedIdentityPayload = {}) {
    if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) {
      throw new BadRequestException("complete expected design job identity is required");
    }
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    return this.platformExecutions.listPublicForDesignJob(job.id);
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

    if (this.usesDurableArtImageExecutions()) {
      const errorMessage =
        "Zhenxi AI smoke generation is disabled because every real generation must start from a persisted DesignJob and durable execution";
      steps.push({ key: "durable_execution_required", label: "持久化执行要求", ok: false, detail: errorMessage });
      return {
        ok: false,
        adapter: appConfig.designPlatformAdapter,
        baseUrl: appConfig.designPlatformBaseUrl,
        latencyMs: Date.now() - startedAt,
        requestId,
        status: "blocked",
        expectedCandidateCount,
        assetUploadCount,
        candidateCount,
        savedImageCount: 0,
        savedImagePaths,
        savedImagePreviews,
        contractChecks,
        steps,
        errorMessage,
      };
    }

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
      const decision = evaluateDesignAutoSubmit(job, {
        highValueAmountCny: appConfig.highValueAmountCny,
        zhenxiGenerationEnabled: this.zhenxiImageGenerationEnabled(),
      });
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
        submitted.push(await this.submit(job.id, {
          operationKey: stableOperationKey("design-auto-submit", job.id),
        }));
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

  async runLowValueAutomation(
    filter: IdentityFilter = {},
    options: { includeCustomerTools?: boolean } = {},
  ) {
    const customerTools = options.includeCustomerTools === false
      ? {}
      : await this.runCustomerToolAutomation(filter);
    const quoteSend = await this.quotes.scanLowValueAutoQuoteSends(filter);
    const orderDraft = await this.orders.scanLowValueAutoOrderDrafts(filter);
    const orderConfirmation = await this.wechatDispatch.scanLowValueOrderConfirmations(filter);
    const orderFollowup = await this.wechatDispatch.scanLowValueOrderFollowups(filter);

    return {
      ...customerTools,
      quoteSend,
      orderDraft,
      orderConfirmation,
      orderFollowup,
    };
  }

  async runCustomerToolAutomation(filter: IdentityFilter = {}) {
    const zhenxiCopy = await this.scanZhenxiCopyDrafts(filter);
    const autoSubmit = await this.scanAutoSubmitDrafts(filter);
    const imageSend = await this.scanLowValueDesignImageSends(filter);

    return { zhenxiCopy, autoSubmit, imageSend };
  }

  async scanLowValueDesignImageSends(filter: IdentityFilter = {}) {
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
      if (this.activeCustomerCreativeVisualQc.has(job.id)) {
        imageSend.skipped.push({
          designJobId: job.id,
          requestId: job.requestId,
          reason: "visual_qc_already_processing",
        });
        continue;
      }
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

    return imageSend;
  }

  async scanZhenxiCopyDrafts(filter: IdentityFilter = {}) {
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs(filter).filter((job: any) => job.status === "draft" && String(job.designType || "").startsWith("zhenxi_copy_"))
      : await (this.prisma as any).designJob.findMany({
          where: { status: "draft", designType: { startsWith: "zhenxi_copy_" }, ...cleanIdentityWhere(filter) },
          include: { conversation: true },
          orderBy: { updatedAt: "asc" },
          take: 100,
        });
    const completed: any[] = [];
    const failed: any[] = [];
    const outcomeUnknown: any[] = [];
    const skipped: any[] = [];

    if (!this.zhenxiCopyGenerationEnabled()) {
      return {
        scanned: jobs.length,
        completed,
        failed,
        outcomeUnknown,
        skipped: jobs.map((job: any) => ({
          designJobId: job.id,
          requestId: job.requestId,
          reason: "zhenxi_generation_not_ready",
        })),
      };
    }

    for (const job of jobs as any[]) {
      if (this.activeZhenxiCopyTasks.has(job.id)) {
        skipped.push({ designJobId: job.id, reason: "already_processing" });
        continue;
      }
      if (job.conversation?.manualLocked || await this.isConversationManualLocked(job.conversationId)) {
        skipped.push({ designJobId: job.id, reason: "conversation_manual_locked" });
        continue;
      }
      this.activeZhenxiCopyTasks.add(job.id);
      try {
        const claimed = appConfig.useLocalStore
          ? this.localStore.updateDesignJob(job.id, {
              status: "generating",
              submitDispatchStatus: "dispatching",
              submittedAt: new Date().toISOString(),
            })
          : await this.claimPrismaZhenxiCopyJob(job.id);
        if (!claimed) {
          skipped.push({ designJobId: job.id, reason: "claim_lost" });
          continue;
        }
        const requirements = isPlainObject(job.requirements) ? job.requirements : {};
        const zhenxi = isPlainObject(requirements.zhenxi) ? requirements.zhenxi : {};
        const module = normalizeZhenxiCopyModule(zhenxi.module || String(job.designType || "").replace(/^zhenxi_copy_/, ""));
        const prompt = String(zhenxi.prompt || job.customerText || "").trim();
        const requestId = stableOperationKey("zhenxi-copy", job.requestId || job.id).slice(0, 80);
        const outcome = await this.designPlatform.generateZhenxiCopy({
          prompt,
          requestId,
          module,
          ratio: String(zhenxi.ratio || "") || undefined,
        });
        if (outcome.status === "completed") {
          const updatedRequirements = {
            ...requirements,
            zhenxi: {
              ...zhenxi,
              requestId: outcome.requestId,
              status: "completed",
              result: { prompts: outcome.prompts, selectedPrompt: outcome.selectedPrompt },
              completedAt: new Date().toISOString(),
            },
          };
          const updated = await this.updateDesignRevisionJob(job.id, {
            status: "completed",
            submitDispatchStatus: "accepted",
            requirements: updatedRequirements,
            errorMessage: null,
          });
          await this.queueDesignTextMessage(
            updated,
            outcome.selectedPrompt,
            "zhenxi-copy-result",
            stableOperationKey("zhenxi-copy-send", job.id),
          );
          completed.push(updated);
          continue;
        }

        const unknown = outcome.status === "outcome_unknown";
        const updated = await this.updateDesignRevisionJob(job.id, {
          status: unknown ? "manual_review" : "failed",
          submitDispatchStatus: unknown ? "outcome_unknown" : "explicit_failed",
          errorMessage: outcome.errorMessage,
          requirements: {
            ...requirements,
            zhenxi: {
              ...zhenxi,
              requestId: outcome.requestId,
              status: outcome.status,
              errorCode: outcome.errorCode,
            },
          },
        });
        await this.notifications.create(
          "warning",
          unknown ? "臻希 AI 文案结果未知" : "臻希 AI 文案生成失败",
          unknown ? "可能已经生成或扣费，系统已禁止自动重试，请按请求号人工核对。" : outcome.errorMessage,
          { designJobId: job.id, requestId: outcome.requestId, errorCode: outcome.errorCode },
        );
        (unknown ? outcomeUnknown : failed).push(updated);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown Zhenxi copy automation error";
        await this.updateDesignRevisionJob(job.id, {
          status: "manual_review",
          submitDispatchStatus: "outcome_unknown",
          errorMessage,
        }).catch(() => null);
        outcomeUnknown.push({ designJobId: job.id, errorMessage });
      } finally {
        this.activeZhenxiCopyTasks.delete(job.id);
      }
    }

    return { scanned: jobs.length, completed, failed, outcomeUnknown, skipped };
  }

  private async claimPrismaZhenxiCopyJob(id: string) {
    const changed = await (this.prisma as any).designJob.updateMany({
      where: { id, status: "draft", designType: { startsWith: "zhenxi_copy_" } },
      data: { status: "generating", submitDispatchStatus: "dispatching", submittedAt: new Date() },
    });
    if (changed.count !== 1) return null;
    return (this.prisma as any).designJob.findUnique({ where: { id } });
  }

  private zhenxiImageGenerationEnabled() {
    return supportsZhenxiCustomerImageGeneration(
      appConfig.designPlatformAdapter,
      process.env.ZHENXI_MCP_ENABLED !== "0",
    );
  }

  private zhenxiCopyGenerationEnabled() {
    return supportsZhenxiCustomerCopyGeneration(
      appConfig.designPlatformAdapter,
      process.env.ZHENXI_MCP_ENABLED !== "0",
    );
  }

  async pollActiveResults(limit = appConfig.lowValueAutomationPollLimit, filter: IdentityFilter = {}) {
    if (this.usesDurableArtImageExecutions()) await this.reconcileDurableArtImageExecutions();
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
      outcomeUnknown: [] as any[],
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
        else if (remoteStatus === "outcome_unknown") result.outcomeUnknown.push(polled.job);
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
    const protectedByDurableExecution = [];

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

      if (this.usesDurableArtImageExecutions()) {
        const blocker = await this.platformExecutions!.findRetryBlocker(job.id);
        if (blocker) {
          protectedByDurableExecution.push({
            designJobId: job.id,
            executionId: blocker.id,
            executionStatus: blocker.status,
            acceptanceStatus: blocker.acceptanceStatus,
          });
          continue;
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
      protectedByDurableExecution: protectedByDurableExecution.length,
      pollErrors,
      protectedExecutions: protectedByDurableExecution,
      recoveredJobs,
      jobs: updatedJobs,
    };
  }

  createTimeoutDemo(payload: { conversationId?: string } & ExpectedIdentityPayload = {}) {
    assertDemoDataMutationAllowed("timeout design demo");
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
    assertDemoDataMutationAllowed("failure design demo");
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
    const requestId = normalizeOperationKey(payload?.operationKey, "design job operationKey");
    const existing = appConfig.useLocalStore
      ? this.localStore.getDesignJob(requestId)
      : await this.prisma.designJob.findUnique({ where: { requestId } });
    if (existing) {
      const storedIdentity = assertStoredOperationIdentityReplay(
        {
          customerId: existing.customerId,
          conversationId: existing.conversationId,
          wechatAccountId: existing.wechatAccountId,
        },
        payload as any,
        "design job create",
      );
      const replayPayload = {
        ...payload,
        customerId: String(storedIdentity.customerId || ""),
        conversationId: String(storedIdentity.conversationId || payload.conversationId || ""),
        wechatAccountId: storedIdentity.wechatAccountId || undefined,
        outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
      } as CreateDesignJobPayload;
      const replayAssets = this.normalizeRequestedAssets(replayPayload);
      const replayOperation = requestOperationMetadata(
        requestId,
        createOperationFingerprint(
          "design-job-create",
          storedIdentity,
          this.normalizeDesignCreateOperationPayload(replayPayload, replayAssets),
        ),
      );
      const replayReadiness = validateDesignRequest({
        ...replayPayload,
        designType: replayPayload.designType || "bundle_render",
        assets: replayAssets,
      });
      return this.completeDesignJobCreateEffects(existing, replayOperation, replayReadiness);
    }

    const identity = await this.validateCreateIdentity(payload);
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || identity.customerId,
      wechatAccountId: payload.wechatAccountId || identity.wechatAccountId,
      outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
    };
    const isHighValue = isHighValueBudget(normalizedPayload.budget, appConfig.highValueAmountCny);
    const requestedAssets = this.normalizeRequestedAssets(normalizedPayload);
    const operation = requestOperationMetadata(
      requestId,
      createOperationFingerprint(
        "design-job-create",
        {
          customerId: normalizedPayload.customerId,
          conversationId: normalizedPayload.conversationId,
          wechatAccountId: normalizedPayload.wechatAccountId || null,
        },
        this.normalizeDesignCreateOperationPayload(normalizedPayload, requestedAssets),
      ),
    );
    const check = validateDesignRequest({
      ...normalizedPayload,
      designType: normalizedPayload.designType || "bundle_render",
      assets: requestedAssets,
    });
    const requirements = {
      useRealSkuImages: true,
      showAllItems: true,
      noWatermark: true,
      highResolution: true,
      requestOperation: operation,
    };

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
        requirements,
        isHighValue,
        status: !check.ok || isHighValue ? "manual_review" : "draft",
        manualQcRequired: true,
      });
      return this.completeDesignJobCreateEffects(job, operation, check);
    }

    let job: any;
    try {
      job = await this.prisma.designJob.create({
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
          requirements: requirements as any,
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
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await this.prisma.designJob.findUnique({ where: { requestId } });
      if (!concurrent) {
        throw new ConflictException({
          code: "OPERATION_IN_PROGRESS",
          message: "design job operation is still being committed; retry with the same operationKey",
        });
      }
      return this.completeDesignJobCreateEffects(concurrent, operation, check);
    }
    return this.completeDesignJobCreateEffects(job, operation, check);
  }

  async submit(id: string, expected: SubmitDesignJobPayload & ExpectedIdentityPayload) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    const operation = this.designSubmitOperation(job, expected.operationKey);
    const begun = await this.beginDesignSubmitOperation(job, operation);
    this.assertDesignSubmitOperationReplay(begun.job, operation, job.id);
    return this.runExternalOperationOnce(operation.key, () => this.completeDesignSubmitOperation(begun.job, operation));
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

    const designType = String(job.designType || "");
    const usesStandaloneZhenxiDesign = designType === "zhenxi_image" || designType.startsWith("zhenxi_copy_");
    const requiresRealImages = (job.requirements as any)?.useRealSkuImages !== false;
    const realRefs = inspectRealDesignReferences({
      assets: job.assets || [],
      bundle: job.bundle || {},
      requireCustomerAssets: requiresRealImages,
      requireCompleteBundle: requiresRealImages && !usesStandaloneZhenxiDesign,
    });
    const bundleRefs = realRefs.bundleRefs || inspectBundleReferences(job.bundle || {});
    const assetRefs = realRefs.assetRefs || inspectAssetReferences(job.assets || []);
    const usableRefs = [...assetRefs, ...bundleRefs].filter((item) => item.ok);
    const unusableRefs = [...assetRefs, ...bundleRefs].filter((item) => !item.ok);
    const bundleAutomation = usesStandaloneZhenxiDesign
      ? { ok: true, reason: "standalone_zhenxi_design", blockers: [] }
      : inspectBundleAutomationReadiness(job.bundle || {});
    const outputCount = inspectDesignOutputCount(job.outputCount, {
      fallback: CUSTOMER_DESIGN_CANDIDATE_COUNT,
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
      action: !requiresRealImages || realRefs.ok
        ? undefined
        : "回到 /design/jobs/new 或商品库，为客户参考图、礼盒和全部 SKU 补齐可读取的本地/HTTPS/data:image 图片。",
    });

    checks.push({
      key: "bundle_automation",
      label: "商品组合自动化",
      ok: bundleAutomation.ok,
      severity: "error",
      detail: bundleAutomation.ok
        ? usesStandaloneZhenxiDesign
          ? "独立物料设计不依赖礼盒商品组合。"
          : "商品组合满足自动出图/报价前置规则。"
        : `商品组合需要人工确认：${(bundleAutomation.blockers || []).join(", ") || "unknown"}`,
      action: bundleAutomation.ok
        ? undefined
        : "回到 /catalog/bundles 或任务创建页，选择包含礼盒和内搭商品且有图、有价、有库存的搭配。",
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

    if (appConfig.designPlatformAdapter === "standard_v1") {
      const callbackAuthReady = hasIndependentDesignPlatformCallbackApiKey();
      checks.push({
        key: "design_platform_callback_auth",
        label: "设计平台回调独立密钥",
        ok: callbackAuthReady,
        severity: "error",
        detail: callbackAuthReady
          ? "standard_v1 回调已配置独立密钥。"
          : "standard_v1 必须配置独立的 DESIGN_PLATFORM_CALLBACK_API_KEY，且不得复用内部/API/登录凭据。",
      });
    }

    if (appConfig.designPlatformAdapter === "zhenxi_external") {
      const mcpReady = health?.transport === "mcp_stdio" && health?.reachable === true;
      checks.push({
        key: "zhenxi_mcp_release",
        label: "臻希 AI 成品软件 MCP",
        ok: mcpReady,
        severity: "error",
        detail: mcpReady
          ? "已连接本机臻希 AI 成品软件；正式生成将严格先生成文案，再流式生成图片。"
          : "未通过内置 MCP 连接到臻希 AI 成品软件。",
        action: mcpReady
          ? undefined
          : "先启动并登录臻希 AI 成品软件，再确认智能客服已启用 ZHENXI_MCP_ENABLED。",
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
    }

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

      if (isTrustedInternalZhenxiWorkspaceHealth(health)) {
        checks.push({
          key: "art_image_auth_session",
          label: "臻希 AI 本地内部会话",
          ok: true,
          severity: "info",
          detail: "复用本机臻希 AI 内部工作台生成入口，不重复登录或创建第二个设备绑定。",
        });
        checks.push({
          key: "art_image_activation",
          label: "臻希 AI 本机执行绑定",
          ok: true,
          severity: "info",
          detail: "当前内部工作台已明确开启本机生成，并配置 GPT 图片模型。",
        });
      } else {
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
            detail: error instanceof Error ? error.message : "无法读取设计平台登录状态",
            action: "到 /design/account 重新登录臻希 AI；如果仍失败，先回 /design/activation 确认设备 ID 已激活。",
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
            detail: error instanceof Error ? error.message : "无法读取设计平台设备激活状态",
            action: "到 /design/activation 重新填写设备 ID 并激活；确认臻希 AI 本地服务仍在当前端口。",
          });
        }
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

    if (this.usesDurableArtImageExecutions()) return this.pollDurableArtImageResult(job);

    const result = await this.designPlatform.getDesignJobResults(job.externalJobId);
    this.logger.log(
      `design platform poll result jobId=${job.id} externalJobId=${job.externalJobId} status=${String(result.status || "unknown")} images=${Array.isArray(result.images) ? result.images.length : 0}`,
    );
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
    if (this.usesDurableArtImageExecutions()) await this.platformExecutions!.assertRetryAllowed(job.id);
    const revision = await this.findLatestRevisionForRetry(job.id);
    return this.retryDesignJob(id, "manual", undefined, expected, revision);
  }

  async resolveUnknownExecution(
    id: string,
    executionId: string,
    payload: ResolveUnknownDesignExecutionPayload & ExpectedIdentityPayload,
    trustedReviewer: string,
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`design job not found: ${id}`);
    assertExpectedIdentity(job, payload || {}, "design job");
    if (payload?.resolution !== "confirmed_not_generated_refunded") {
      throw new BadRequestException("resolution must be confirmed_not_generated_refunded");
    }
    const reviewer = String(trustedReviewer || "").trim();
    if (!reviewer || !/^[\p{L}\p{N}_.@-]{1,80}$/u.test(reviewer)) {
      throw new BadRequestException("reviewer must be a non-empty operator identifier");
    }
    const execution = await this.platformExecutions.get(executionId);
    if (!execution || execution.designJobId !== job.id) {
      throw new BadRequestException("design platform execution does not belong to this design job");
    }
    const resolved = await this.platformExecutions.resolveUnknownPublic(execution.id, payload.resolution, reviewer);
    await this.createReviewLog({
      targetType: "design_platform_execution",
      targetId: execution.id,
      decision: payload.resolution,
      reviewer,
      note: "人工已确认未生成且退款完成，允许后续显式重试。",
      beforeStatus: "outcome_unknown",
      afterStatus: "explicit_failed",
      metadata: { designJobId: job.id, externalJobId: execution.externalJobId },
    });

    await this.notifications.create(
      "warning",
      "设计平台未知结果已人工核销",
      "已确认该次尝试没有生成且退款完成；系统仅解除重试阻塞，不会自动重新生成。",
      { designJobId: job.id, externalJobId: execution.externalJobId },
    );
    return resolved;
  }

  async recoverCompletedExecution(
    id: string,
    executionId: string,
    payload: RecoverCompletedDesignExecutionPayload & ExpectedIdentityPayload,
    trustedReviewer: string,
  ) {
    if (!this.usesDurableArtImageExecutions()) {
      throw new BadRequestException("verified completion recovery is only available for the durable Zhenxi adapter");
    }
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`design job not found: ${id}`);
    assertExpectedIdentity(job, payload || {}, "design job");
    if (payload?.resolution !== "confirmed_generated") {
      throw new BadRequestException("resolution must be confirmed_generated");
    }
    const reviewer = String(trustedReviewer || "").trim();
    if (!reviewer || !/^[\p{L}\p{N}_.@-]{1,80}$/u.test(reviewer)) {
      throw new BadRequestException("reviewer must be a non-empty operator identifier");
    }
    const evidence = String(payload?.evidence || "").trim();
    if (evidence.length < 8 || evidence.length > 500) {
      throw new BadRequestException("evidence must contain 8 to 500 characters");
    }
    const execution = await this.platformExecutions.get(executionId);
    if (!execution || execution.designJobId !== job.id) {
      throw new BadRequestException("design platform execution does not belong to this design job");
    }
    const images = this.normalizeCallbackImages(payload?.images || []);
    const imageMetadataCheck = this.validateCallbackImages(job, images);
    if (!imageMetadataCheck.ok) {
      throw new BadRequestException(`verified completion image metadata is invalid: ${imageMetadataCheck.reasons.join("; ")}`);
    }
    const requiredCount = this.minimumRequiredInitialImageCount(job);
    if (images.length !== requiredCount) {
      throw new BadRequestException(`verified completion must contain exactly ${requiredCount} images`);
    }

    await this.platformExecutions.recoverVerifiedCompletion({
      executionId: execution.id,
      images,
      refundStatus: payload.refundStatus,
    });
    await this.createReviewLog({
      targetType: "design_platform_execution",
      targetId: execution.id,
      decision: payload.resolution,
      reviewer,
      note: evidence,
      beforeStatus: `${execution.status}:${execution.acceptanceStatus}`,
      afterStatus: "completed:pending",
      metadata: {
        designJobId: job.id,
        externalJobId: execution.externalJobId,
        recoveredImageCount: images.length,
        source: "verified_completed_execution_recovery",
      },
    });
    const acceptedJob = await this.acceptDurableArtImageExecution(execution.id);
    const publicExecution = (await this.platformExecutions.listPublicForDesignJob(job.id))
      .find((item) => item.id === execution.id) || null;
    return { job: acceptedJob || await this.findDesignJobForExecution(job.id), execution: publicExecution };
  }

  async resolveExecutionRefund(
    id: string,
    executionId: string,
    payload: ResolveDesignExecutionRefundPayload & ExpectedIdentityPayload,
    trustedReviewer: string,
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`design job not found: ${id}`);
    assertExpectedIdentity(job, payload || {}, "design job");
    if (payload?.resolution !== "confirmed_refunded") {
      throw new BadRequestException("resolution must be confirmed_refunded");
    }
    const reviewer = String(trustedReviewer || "").trim();
    if (!reviewer || !/^[\p{L}\p{N}_.@-]{1,80}$/u.test(reviewer)) {
      throw new BadRequestException("reviewer must be a non-empty operator identifier");
    }
    const execution = await this.platformExecutions.get(executionId);
    if (!execution || execution.designJobId !== job.id) {
      throw new BadRequestException("design platform execution does not belong to this design job");
    }
    const resumesLocalAcceptance =
      execution.status === "completed" && execution.acceptanceStatus === "manual_review";
    const resolved = await this.platformExecutions.resolveUnsafeRefundPublic(execution.id, payload.resolution, reviewer);
    await this.createReviewLog({
      targetType: "design_platform_execution_refund",
      targetId: execution.id,
      decision: payload.resolution,
      reviewer,
      note: resumesLocalAcceptance
        ? "人工已核对退款到账，执行已恢复本地验收；不会再次生成，也不会再次调用远端 POST。"
        : "人工已核对退款到账，允许后续显式重试。",
      beforeStatus: resumesLocalAcceptance
        ? `${execution.status}:manual_review:${execution.refundStatus}`
        : `${execution.status}:${execution.refundStatus}`,
      afterStatus: resumesLocalAcceptance
        ? `${execution.status}:pending:refunded`
        : `${execution.status}:refunded`,
      metadata: {
        designJobId: job.id,
        externalJobId: execution.externalJobId,
        resolutionEffect: resumesLocalAcceptance ? "resume_local_acceptance" : "unblock_explicit_retry",
      },
    });
    await this.notifications.create(
      "warning",
      "设计平台退款结果已人工核销",
      resumesLocalAcceptance
        ? "已确认该次部分成功执行退款完成；系统已恢复本地验收，不会再次生成，也不会再次调用远端 POST。"
        : "已确认该次失败尝试退款完成；系统仅解除重试阻塞，不会自动重新生成。",
      { designJobId: job.id, externalJobId: execution.externalJobId },
    );
    return resolved;
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
    const operationKey = normalizeOperationKey(payload.operationKey, "design revision operationKey");
    const selectedImageId = payload.selectedImageId || this.findSelectedImageId(job);
    const operation = requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "design-revision-request",
        this.designOperationIdentity(job),
        {
          designJobId: job.id,
          requestId: job.requestId,
          instruction: String(payload.instruction || "").trim(),
          sourceText: String(payload.sourceText || payload.instruction || "").trim(),
          selectedImageId: selectedImageId || null,
        },
      ),
    );
    const existingOperation = appConfig.useLocalStore
      ? this.localStore.listDesignRevisions().find((revision: any) => revision.operationKey === operation.key)
      : await prisma.designRevision.findUnique({ where: { operationKey: operation.key } });
    if (existingOperation) {
      this.assertDesignRevisionOperationReplay(existingOperation, operation, job);
      const replayDecision = decideRevisionPolicy({
        instruction: existingOperation.instruction,
        revisionCount: Math.max(0, Number(existingOperation.revisionNumber || 1) - 1),
        isHighValue: job.isHighValue,
        budget: job.budget,
        highValueAmountCny: appConfig.highValueAmountCny,
      });
      return this.runExternalOperationOnce(operation.key, () =>
        this.completeDesignRevisionOperation(job, existingOperation, replayDecision, operation),
      );
    }
    this.assertDesignJobCanRequestRevision(job);
    if (this.usesDurableArtImageExecutions()) await this.platformExecutions!.assertRetryAllowed(job.id);

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
        effectKey: stableOperationKey("design-revision-invalid", operation.key),
        designJobId: job.id,
      });
      return { decision, revision: null, job };
    }
    let revision: DesignRevisionLike;
    const revisionData = {
      id: deterministicOperationId("revision", operation.key),
      designJobId: job.id,
      selectedImageId,
      revisionNumber: decision.revisionNumber,
      instruction: String(payload.instruction || "").trim(),
      sourceText: payload.sourceText || payload.instruction,
      policyAction: decision.action,
      status: decision.submitAllowed ? "requested" : "manual_review",
      chargeRequired: decision.chargeRequired,
      manualReviewRequired: decision.manualReviewRequired,
      operationKey: operation.key,
      requestFingerprint: operation.fingerprint,
      operationIdentity: this.designOperationIdentity(job),
      externalRequestId: stableOperationKey("design-revision-request", `${job.id}:${operation.key}`),
      dispatchStatus: decision.submitAllowed ? "prepared" : "not_required",
    };
    if (appConfig.useLocalStore) {
      revision = this.localStore.createDesignRevision(revisionData);
    } else {
      try {
        revision = await prisma.designRevision.create({ data: revisionData });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const winner = await prisma.designRevision.findUnique({ where: { operationKey: operation.key } });
        if (!winner) {
          throw new ConflictException({
            code: "DESIGN_REVISION_CONCURRENT_CHANGE",
            message: "another revision was allocated concurrently; refresh before creating a different operation",
          });
        }
        revision = winner;
      }
    }
    this.assertDesignRevisionOperationReplay(revision, operation, job);
    return this.runExternalOperationOnce(operation.key, () =>
      this.completeDesignRevisionOperation(job, revision, decision, operation),
    );
  }

  async cancel(id: string, expected: ExpectedIdentityPayload = {}) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");
    const durableExecution = this.usesDurableArtImageExecutions() && job.externalJobId
      ? await this.platformExecutions!.get(job.externalJobId)
      : null;
    this.assertDesignJobCanCancel(job, durableExecution);
    let cancelled: { cancelled: boolean; job: any };
    if (appConfig.useLocalStore) {
      cancelled = typeof (this.localStore as any).cancelDesignJobIfCurrent === "function"
        ? this.localStore.cancelDesignJobIfCurrent({
            designJobId: job.id,
            status: String(job.status || ""),
            externalJobId: job.externalJobId,
          })
        : {
            cancelled: job.callbackStatus !== "retry_dispatching",
            job: job.callbackStatus === "retry_dispatching"
              ? job
              : this.localStore.updateDesignJob(job.id, { status: "cancelled" }),
          };
    } else {
      const prisma = this.prisma as any;
      const changed = await prisma.designJob.updateMany({
        where: {
          id: job.id,
          status: job.status,
          externalJobId: job.externalJobId || null,
          OR: [{ callbackStatus: null }, { callbackStatus: { not: "retry_dispatching" } }],
        },
        data: {
          status: "cancelled",
          ...(job.callbackStatus === "processing" || job.callbackStatus === "failure_settled"
            ? { callbackStatus: "rejected", callbackSettledAt: new Date() }
            : {}),
        },
      });
      cancelled = {
        cancelled: changed.count === 1,
        job: await prisma.designJob.findUnique({ where: { id: job.id }, include: { assets: true } }),
      };
    }
    if (!cancelled.cancelled) {
      throw new ConflictException({
        code: "DESIGN_JOB_CONCURRENT_CHANGE",
        message: "design job changed while cancellation was being claimed; refresh before retrying",
      });
    }
    let remoteResult: Record<string, unknown> | null = null;
    if (job.externalJobId) {
      try {
        let durableCancellation: any = null;
        if (this.usesDurableArtImageExecutions()) {
          durableCancellation = await this.platformExecutions!.requestCancellation(job.externalJobId);
        }
        if (!this.usesDurableArtImageExecutions() || durableCancellation?.status === "cancel_requested") {
          remoteResult = await this.designPlatform.cancelDesignJob(job.externalJobId);
        }
      } catch (error) {
        await this.notifications.create("warning", "设计平台取消失败", "设计任务已在本地取消，但远端取消请求未确认；迟到结果仍会被拒收并保留对账证据。", {
          designJobId: job.id,
          externalJobId: job.externalJobId,
        });
      }
    }
    await this.notifications.create("info", "设计任务已取消", "该任务不会继续出图或自动发送。", {
      designJobId: job.id,
      externalJobId: job.externalJobId,
    });
    return { job: cancelled.job, remoteResult };
  }

  private async findDesignCallbackOperation(requestId: string) {
    if (appConfig.useLocalStore) {
      const direct = this.localStore.getDesignJob(requestId);
      if (direct) return { job: direct, revision: null, operationRequestId: direct.requestId };
      const revision = this.localStore.listDesignRevisions().find((item: any) => item.externalRequestId === requestId);
      const job = revision ? this.localStore.getDesignJob(revision.designJobId) : null;
      return job ? { job, revision, operationRequestId: revision.externalRequestId } : null;
    }
    const prisma = this.prisma as any;
    const direct = await prisma.designJob.findUnique({ where: { requestId }, include: { images: true } });
    if (direct) return { job: direct, revision: null, operationRequestId: direct.requestId };
    const revision = await prisma.designRevision.findUnique({
      where: { externalRequestId: requestId },
      include: { designJob: { include: { images: true } } },
    });
    return revision?.designJob
      ? { job: revision.designJob, revision, operationRequestId: revision.externalRequestId }
      : null;
  }

  private designCallbackOperation(payload: DesignPlatformCallbackPayload) {
    const externalJobId = String(payload.externalJobId || "").trim();
    const requestId = String(payload.requestId || "").trim();
    return requestOperationMetadata(
      stableOperationKey("design-callback", `${requestId}:${externalJobId}`),
      createOperationFingerprint(
        "design-platform-callback",
        { requestId, externalJobId },
        {
          status: payload.status,
          errorMessage: String(payload.errorMessage || "").trim(),
          images: this.normalizeCallbackImages(payload.images || []).map((image: any) => ({
            imageId: image.imageId,
            downloadUrl: image.downloadUrl,
            width: image.width || null,
            height: image.height || null,
          })),
        },
      ),
    );
  }

  private callbackClaimMode(job: any, operation: RequestOperationMetadata) {
    if (!job?.callbackOperationKey) return null;
    if (job.callbackOperationKey !== operation.key) return "replay";
    if (job.callbackStatus === "failure_settled" && job.callbackRequestFingerprint === operation.fingerprint) {
      return "resume_failure";
    }
    if (["processing", "retry_dispatching"].includes(String(job.callbackStatus || ""))) {
      const claimedAt = Date.parse(String(job.callbackClaimedAt || ""));
      if (Number.isFinite(claimedAt) && Date.now() - claimedAt <= DESIGN_CALLBACK_CLAIM_LEASE_MS) {
        return "in_progress";
      }
      return "outcome_unknown";
    }
    return "replay";
  }

  private async claimDesignCallback(job: any, payload: DesignPlatformCallbackPayload, operation: RequestOperationMetadata) {
    const existingMode = this.callbackClaimMode(job, operation);
    if (existingMode) return { mode: existingMode, job };
    const externalJobId = String(payload.externalJobId || "").trim();
    if (appConfig.useLocalStore) {
      if (typeof (this.localStore as any).claimDesignJobCallback !== "function") {
        if (String(job.externalJobId || "") !== externalJobId || !["submitted", "generating"].includes(job.status)) {
          return { mode: "replay", job };
        }
        return {
          mode: "claimed",
          job: this.localStore.updateDesignJob(job.id, {
            callbackOperationKey: operation.key,
            callbackRequestFingerprint: operation.fingerprint,
            callbackStatus: "processing",
            callbackClaimedAt: new Date().toISOString(),
            callbackSettledAt: null,
          }),
        };
      }
      return this.localStore.claimDesignJobCallback({
        designJobId: job.id,
        externalJobId,
        operationKey: operation.key,
        requestFingerprint: operation.fingerprint,
      });
    }
    const prisma = this.prisma as any;
    try {
      const changed = await prisma.designJob.updateMany({
        where: {
          id: job.id,
          externalJobId,
          status: { in: ["submitted", "generating"] },
          callbackOperationKey: null,
        },
        data: {
          callbackOperationKey: operation.key,
          callbackRequestFingerprint: operation.fingerprint,
          callbackStatus: "processing",
          callbackClaimedAt: new Date(),
          callbackSettledAt: null,
        },
      });
      if (changed.count === 1) {
        return {
          mode: "claimed",
          job: await prisma.designJob.findUnique({ where: { id: job.id }, include: { images: true } }),
        };
      }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    const current = await prisma.designJob.findUnique({ where: { id: job.id }, include: { images: true } });
    return { mode: this.callbackClaimMode(current, operation) || "replay", job: current };
  }

  private async markDesignCallbackOutcomeUnknown(designJobId: string, operationKey: string) {
    if (appConfig.useLocalStore) {
      if (typeof (this.localStore as any).markDesignJobCallbackOutcomeUnknown !== "function") {
        const current = this.localStore.getDesignJob(designJobId);
        if (current?.callbackOperationKey !== operationKey) return current;
        return this.localStore.updateDesignJob(designJobId, {
          status: "manual_review",
          manualQcRequired: true,
          errorMessage: "设计平台回调处理结果未知，禁止自动重放，必须人工核对。",
          callbackStatus: "outcome_unknown",
          callbackSettledAt: new Date().toISOString(),
        });
      }
      return this.localStore.markDesignJobCallbackOutcomeUnknown({ designJobId, operationKey });
    }
    const prisma = this.prisma as any;
    await prisma.designJob.updateMany({
      where: {
        id: designJobId,
        callbackOperationKey: operationKey,
        callbackStatus: { in: ["processing", "retry_dispatching"] },
      },
      data: {
        status: "manual_review",
        manualQcRequired: true,
        errorMessage: "设计平台回调处理结果未知，禁止自动重放，必须人工核对。",
        callbackStatus: "outcome_unknown",
        callbackSettledAt: new Date(),
      },
    });
    return prisma.designJob.findUnique({ where: { id: designJobId }, include: { images: true } });
  }

  private async beginDesignCallbackRetry(
    designJobId: string,
    operation: RequestOperationMetadata,
  ) {
    if (appConfig.useLocalStore) {
      if (typeof (this.localStore as any).beginDesignJobCallbackRetry !== "function") {
        const current = this.localStore.getDesignJob(designJobId);
        if (
          current?.status !== "failed"
          || current?.callbackOperationKey !== operation.key
          || current?.callbackRequestFingerprint !== operation.fingerprint
          || current?.callbackStatus !== "failure_settled"
        ) return { started: false, job: current };
        return {
          started: true,
          job: this.localStore.updateDesignJob(designJobId, {
            callbackStatus: "retry_dispatching",
            callbackClaimedAt: new Date().toISOString(),
          }),
        };
      }
      return this.localStore.beginDesignJobCallbackRetry({
        designJobId,
        operationKey: operation.key,
        requestFingerprint: operation.fingerprint,
      });
    }
    const prisma = this.prisma as any;
    const changed = await prisma.designJob.updateMany({
      where: {
        id: designJobId,
        status: "failed",
        callbackOperationKey: operation.key,
        callbackRequestFingerprint: operation.fingerprint,
        callbackStatus: "failure_settled",
      },
      data: { callbackStatus: "retry_dispatching", callbackClaimedAt: new Date() },
    });
    return {
      started: changed.count === 1,
      job: await prisma.designJob.findUnique({ where: { id: designJobId }, include: { assets: true, revisions: true } }),
    };
  }

  private async settleDesignCallbackFailure(
    job: any,
    payload: DesignPlatformCallbackPayload,
    operation: RequestOperationMetadata | undefined,
    errorMessage: string,
  ) {
    if (!operation) {
      return {
        settled: true,
        resumed: false,
        job,
        revision: await this.finishLatestRevision(job.id, "failed", [], errorMessage),
      };
    }
    const externalJobId = String(payload.externalJobId || "").trim();
    if (appConfig.useLocalStore) {
      if (typeof (this.localStore as any).settleDesignJobCallbackFailure !== "function") {
        const current = this.localStore.getDesignJob(job.id);
        if (
          current?.callbackOperationKey === operation.key
          && current?.callbackRequestFingerprint === operation.fingerprint
          && current?.callbackStatus === "failure_settled"
        ) {
          return { settled: true, resumed: true, job: current, revision: null };
        }
        if (
          current?.callbackOperationKey !== operation.key
          || current?.callbackRequestFingerprint !== operation.fingerprint
          || current?.callbackStatus !== "processing"
          || String(current?.externalJobId || "") !== externalJobId
          || !["submitted", "generating"].includes(String(current?.status || ""))
        ) return { settled: false, resumed: false, job: current, revision: null };
        const revision = (this.localStore as any).getLatestActiveDesignRevision?.(job.id) || null;
        const failedRevision = revision && typeof (this.localStore as any).updateDesignRevision === "function"
          ? (this.localStore as any).updateDesignRevision(revision.id, {
              status: "failed",
              resultImageIds: [],
              errorMessage,
            })
          : revision;
        const failedJob = this.localStore.updateDesignJob(job.id, {
          status: "failed",
          errorMessage,
          callbackStatus: "failure_settled",
          callbackSettledAt: new Date().toISOString(),
        });
        return { settled: true, resumed: false, job: failedJob, revision: failedRevision };
      }
      return this.localStore.settleDesignJobCallbackFailure({
        designJobId: job.id,
        externalJobId,
        operationKey: operation.key,
        requestFingerprint: operation.fingerprint,
        errorMessage,
      });
    }
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const current = await tx.designJob.findUnique({ where: { id: job.id } });
      if (
        current?.callbackOperationKey === operation.key
        && current?.callbackRequestFingerprint === operation.fingerprint
        && current?.callbackStatus === "failure_settled"
      ) {
        const revision = await tx.designRevision.findFirst({
          where: { designJobId: job.id, status: "failed" },
          orderBy: { updatedAt: "desc" },
        });
        return { settled: true, resumed: true, job: current, revision };
      }
      const changed = await tx.designJob.updateMany({
        where: {
          id: job.id,
          externalJobId,
          status: { in: ["submitted", "generating"] },
          callbackOperationKey: operation.key,
          callbackRequestFingerprint: operation.fingerprint,
          callbackStatus: "processing",
        },
        data: {
          status: "failed",
          errorMessage,
          callbackStatus: "failure_settled",
          callbackSettledAt: new Date(),
        },
      });
      if (changed.count !== 1) {
        return {
          settled: false,
          resumed: false,
          job: await tx.designJob.findUnique({ where: { id: job.id } }),
          revision: null,
        };
      }
      const revision = await tx.designRevision.findFirst({
        where: { designJobId: job.id, status: { in: ["submitted", "generating"] } },
        orderBy: { updatedAt: "desc" },
      });
      const failedRevision = revision
        ? await tx.designRevision.update({
            where: { id: revision.id },
            data: { status: "failed", resultImageIds: [], errorMessage },
          })
        : null;
      return {
        settled: true,
        resumed: false,
        job: await tx.designJob.findUnique({ where: { id: job.id } }),
        revision: failedRevision,
      };
    });
  }

  private async commitDesignCallbackCompletion(input: {
    job: any;
    payload: DesignPlatformCallbackPayload;
    operation: RequestOperationMetadata;
    nextStatus: string;
    images: any[];
    resultImageIds: string[];
  }) {
    const externalJobId = String(input.payload.externalJobId || "").trim();
    if (appConfig.useLocalStore) {
      if (typeof (this.localStore as any).commitDesignJobCallbackCompletion !== "function") {
        const current = this.localStore.getDesignJob(input.job.id);
        if (
          current?.callbackOperationKey !== input.operation.key
          || current?.callbackRequestFingerprint !== input.operation.fingerprint
          || current?.callbackStatus !== "processing"
          || String(current?.externalJobId || "") !== externalJobId
          || !["submitted", "generating"].includes(String(current?.status || ""))
        ) return { committed: false, job: current };
        this.localStore.upsertDesignImages(input.job.id, input.images);
        await this.finishLatestRevision(input.job.id, "completed", input.resultImageIds);
        return {
          committed: true,
          job: this.localStore.updateDesignJob(input.job.id, {
            status: input.nextStatus,
            completedAt: new Date().toISOString(),
            callbackStatus: "settled",
            callbackSettledAt: new Date().toISOString(),
          }),
        };
      }
      return this.localStore.commitDesignJobCallbackCompletion({
        designJobId: input.job.id,
        externalJobId,
        operationKey: input.operation.key,
        requestFingerprint: input.operation.fingerprint,
        status: input.nextStatus,
        completedAt: new Date().toISOString(),
        images: input.images,
        resultImageIds: input.resultImageIds,
      });
    }
    const prisma = this.prisma as any;
    return prisma.$transaction(async (tx: any) => {
      const changed = await tx.designJob.updateMany({
        where: {
          id: input.job.id,
          externalJobId,
          status: { in: ["submitted", "generating"] },
          callbackOperationKey: input.operation.key,
          callbackRequestFingerprint: input.operation.fingerprint,
          callbackStatus: "processing",
        },
        data: {
          status: input.nextStatus,
          completedAt: new Date(),
          callbackStatus: "settled",
          callbackSettledAt: new Date(),
        },
      });
      if (changed.count !== 1) {
        return {
          committed: false,
          job: await tx.designJob.findUnique({ where: { id: input.job.id }, include: { images: true } }),
        };
      }
      for (const image of input.images) {
        await tx.designImageCandidate.upsert({
          where: { designJobId_imageId: { designJobId: input.job.id, imageId: image.imageId } },
          update: {
            downloadUrl: image.downloadUrl,
            localPath: image.localPath,
            width: image.width,
            height: image.height,
            fingerprint: image.fingerprint,
            legacyIdentityHash: image.legacyIdentityHash,
            position: image.position,
          },
          create: { designJobId: input.job.id, ...image },
        });
      }
      const revision = await tx.designRevision.findFirst({
        where: { designJobId: input.job.id, status: { in: ["submitted", "generating"] } },
        orderBy: { updatedAt: "desc" },
      });
      if (revision) {
        await tx.designRevision.update({
          where: { id: revision.id },
          data: { status: "completed", resultImageIds: input.resultImageIds, errorMessage: "" },
        });
      }
      return {
        committed: true,
        job: await tx.designJob.findUnique({ where: { id: input.job.id }, include: { images: true } }),
      };
    });
  }

  private async cleanupUncommittedDesignCallbackFiles(jobId: string, savedImages: Array<{ localPath?: string }>) {
    for (const item of savedImages) {
      if (item.localPath) await this.removeUnusableDownloadedDesignImage(jobId, item.localPath);
    }
  }

  async handleDesignPlatformCallback(payload: DesignPlatformCallbackPayload) {
    if (this.usesDurableArtImageExecutions()) return this.processDesignPlatformCallback(payload);
    const operation = this.designCallbackOperation(payload);
    const active = this.activeDesignCallbackPromises.get(operation.key);
    if (active) return active;
    const promise = this.processDesignPlatformCallback(payload, operation);
    this.activeDesignCallbackPromises.set(operation.key, promise);
    try {
      return await promise;
    } finally {
      if (this.activeDesignCallbackPromises.get(operation.key) === promise) {
        this.activeDesignCallbackPromises.delete(operation.key);
      }
    }
  }

  private async processDesignPlatformCallback(
    payload: DesignPlatformCallbackPayload,
    callbackOperation?: RequestOperationMetadata,
  ) {
    const binding = await this.findDesignCallbackOperation(payload.requestId);
    const job = binding?.job;
    if (!job) throw new Error(`design job not found by requestId: ${payload.requestId}`);
    const callbackBinding = validateDesignCallbackBinding({
      payload,
      job,
      operationRequestId: binding.operationRequestId,
    });
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
    if (callbackOperation) {
      const claim = await this.claimDesignCallback(job, payload, callbackOperation);
      if (claim.mode === "replay") return claim.job;
      if (claim.mode === "in_progress") return claim.job;
      if (claim.mode === "outcome_unknown") {
        const blocked = await this.markDesignCallbackOutcomeUnknown(job.id, callbackOperation.key);
        await this.notifications.create(
          "error",
          "设计平台回调处理结果未知",
          "检测到未完成的回调处理，系统已禁止自动重放，必须人工核对。",
          {
            effectKey: stableOperationKey("design-callback-outcome-unknown", callbackOperation.key),
            designJobId: job.id,
            externalJobId: payload.externalJobId,
          },
        );
        throw new ConflictException({
          code: "DESIGN_CALLBACK_OUTCOME_UNKNOWN",
          message: "design callback processing outcome is unknown; automatic replay is blocked",
          designJobId: blocked.id,
        });
      }
    }
    const automaticRetryAllowed = await this.designCallbackAllowsAutomaticRetry(payload);

    if (payload.status === "failed") {
      const errorMessage = payload.errorMessage || "设计平台返回失败";
      const failure = await this.settleDesignCallbackFailure(job, payload, callbackOperation, errorMessage);
      if (!failure.settled) return failure.job;
      const failedRevision = failure.revision;
      const retryCount = this.designResultRetryCount(failure.job, failedRevision);
      await this.notifications.create(retryCount < 1 ? "warning" : "error", "设计平台出图失败", payload.errorMessage || "未返回失败原因", {
        ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-failed", callbackOperation.key) } : {}),
        designJobId: job.id,
      });
      if (automaticRetryAllowed && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision, callbackOperation);
      }
      await this.notifications.create("error", "设计任务已转人工", "自动重试后仍失败，需要客服人工处理。", {
        ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-failed-manual", callbackOperation.key) } : {}),
        designJobId: job.id,
      });
      return this.failDesignJobForManualReview(failure.job, {
        reason: "design_platform_failed_after_retry",
        source: "design_platform_callback",
        errorMessage,
      });
    }

    const images = this.normalizeCallbackImages(payload.images || []);
    this.logger.log(
      `design platform callback jobId=${job.id} externalJobId=${payload.externalJobId || job.externalJobId || ""} status=${payload.status} images=${images.length}`,
    );
    if (!images.length) {
      const errorMessage = "design platform completed without images";
      const failure = await this.settleDesignCallbackFailure(job, payload, callbackOperation, errorMessage);
      if (!failure.settled) return failure.job;
      const failedRevision = failure.revision;
      const retryCount = this.designResultRetryCount(failure.job, failedRevision);
      await this.notifications.create(retryCount < 1 ? "warning" : "error", "设计平台未返回图片", errorMessage, {
        ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-empty", callbackOperation.key) } : {}),
        designJobId: job.id,
        externalJobId: payload.externalJobId || job.externalJobId,
      });
      if (automaticRetryAllowed && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision, callbackOperation);
      }
      return this.failDesignJobForManualReview(failure.job, {
        reason: "design_platform_completed_without_images",
        source: "design_platform_callback",
        errorMessage,
      });
    }
    const imageMetadataCheck = this.validateCallbackImages(job, images);
    if (!imageMetadataCheck.ok) {
      const errorMessage = `design platform returned invalid image metadata: ${imageMetadataCheck.reasons.join("; ")}`;
      const failure = await this.settleDesignCallbackFailure(job, payload, callbackOperation, errorMessage);
      if (!failure.settled) return failure.job;
      const failedRevision = failure.revision;
      const retryCount = this.designResultRetryCount(failure.job, failedRevision);
      const retryableFailure = this.isInitialDesignResult(job) || Boolean(failedRevision);
      await this.notifications.create(
        retryCount < 1 && retryableFailure ? "warning" : "error",
        "设计平台图片数据无效",
        imageMetadataCheck.reasons.join("；"),
        {
          ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-invalid-images", callbackOperation.key) } : {}),
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
          invalidImageReasons: imageMetadataCheck.reasons,
        },
      );
      if (automaticRetryAllowed && retryableFailure && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision, callbackOperation);
      }
      return this.failDesignJobForManualReview(failure.job, {
        reason: "design_platform_invalid_image_metadata",
        source: "design_platform_callback",
        errorMessage,
      });
    }
    const requiredCandidateImageCount = this.minimumRequiredInitialImageCount(job);
    if (images.length !== requiredCandidateImageCount) {
      const errorMessage = images.length < requiredCandidateImageCount
        ? `design platform returned only ${images.length} candidate images; expected exactly ${requiredCandidateImageCount}`
        : `design platform returned ${images.length} candidate images; expected exactly ${requiredCandidateImageCount}`;
      const failure = await this.settleDesignCallbackFailure(job, payload, callbackOperation, errorMessage);
      if (!failure.settled) return failure.job;
      const retryCount = this.designResultRetryCount(failure.job, failure.revision);
      await this.notifications.create(
        retryCount < 1 ? "warning" : "error",
        "设计平台候选图数量不符合要求",
        `本轮返回 ${images.length} 张候选图，必须固定返回 ${requiredCandidateImageCount} 张。`,
        {
          ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-insufficient-images", callbackOperation.key) } : {}),
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
          returnedImageCount: images.length,
          requiredImageCount: requiredCandidateImageCount,
        },
      );
      if (automaticRetryAllowed && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failure.revision, callbackOperation);
      }
      return this.failDesignJobForManualReview(failure.job, {
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
        this.logger.warn(
          `design image save failed jobId=${job.id} externalJobId=${payload.externalJobId || job.externalJobId || ""} imageId=${imageId} position=${position} downloadUrl=${this.safeLogUrl(image.downloadUrl)} error=${this.errorMessage(error)}`,
        );
        localPath = undefined;
        fingerprint = undefined;
      }
      savedImages.push({ image, imageId, position, fingerprint, legacyIdentityHash, localPath });
    }

    const downloadFailureCount = savedImages.filter((item) => !item.localPath).length;
    const localSavedCount = savedImages.length - downloadFailureCount;
    const requiredLocalImageCount = this.minimumRequiredLocalImageCount(job);
    this.logger.log(
      `design callback local image save summary jobId=${job.id} saved=${localSavedCount} failed=${downloadFailureCount} required=${requiredLocalImageCount}`,
    );
    if (localSavedCount < requiredLocalImageCount) {
      const errorMessage = `design platform saved only ${localSavedCount} local image files; expected at least ${requiredLocalImageCount}`;
      const failure = await this.settleDesignCallbackFailure(job, payload, callbackOperation, errorMessage);
      if (callbackOperation) await this.cleanupUncommittedDesignCallbackFiles(job.id, savedImages);
      if (!failure.settled) return failure.job;
      const failedRevision = failure.revision;
      const retryCount = this.designResultRetryCount(failure.job, failedRevision);
      const retryableFailure = this.isInitialDesignResult(job) || Boolean(failedRevision);
      await this.notifications.create(
        retryCount < 1 && retryableFailure ? "warning" : "error",
        "设计图本地保存不足",
        `只有 ${localSavedCount} 张候选图保存到本地，至少需要 ${requiredLocalImageCount} 张才能安全发给客户。`,
        {
          ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-local-save-failed", callbackOperation.key) } : {}),
          designJobId: job.id,
          externalJobId: payload.externalJobId || job.externalJobId,
          localSavedCount,
          requiredLocalImageCount,
          downloadFailureCount,
        },
      );
      if (automaticRetryAllowed && retryableFailure && retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage, {}, failedRevision, callbackOperation);
      }
      return this.failDesignJobForManualReview(failure.job, {
        reason: "design_platform_local_image_save_failed",
        source: "design_platform_callback",
        errorMessage,
      });
    }

    if (downloadFailureCount && !callbackOperation) {
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

    const nextStatus = nextStatusAfterDesignCompleted({
      isHighValue: job.isHighValue,
      budget: job.budget,
      highValueAmountCny: appConfig.highValueAmountCny,
      manualQcRequired: job.manualQcRequired,
    });
    if (this.usesDurableArtImageExecutions() && payload.externalJobId) {
      const execution = await this.platformExecutions.get(payload.externalJobId);
      if (execution?.status === "completed" && execution.acceptanceStatus === "accepting") {
        const accepted = await this.platformExecutions.commitAcceptedResult({
          executionId: execution.id,
          images: savedImages.map(({ image, imageId, position, fingerprint, legacyIdentityHash, localPath }) => ({
            imageId,
            downloadUrl: sanitizePersistedImageUrl(image.downloadUrl),
            width: image.width,
            height: image.height,
            localPath,
            fingerprint,
            legacyIdentityHash,
            position,
          })),
          resultImageIds: images.map((image) => this.versionedImageId(job, image.imageId)),
          nextStatus,
        });
        await this.notifications.create("info", "设计图已生成", `已生成 ${images.length} 张候选图`, {
          designJobId: job.id,
        });
        return { ...accepted, durableAcceptanceCommitted: true };
      }
    }

    const persistedImages = savedImages.map(({ image, imageId, position, fingerprint, legacyIdentityHash, localPath }) => ({
      imageId,
      downloadUrl: sanitizePersistedImageUrl(image.downloadUrl),
      width: image.width,
      height: image.height,
      localPath,
      fingerprint,
      legacyIdentityHash,
      position,
    }));
    if (callbackOperation) {
      const committed = await this.commitDesignCallbackCompletion({
        job,
        payload,
        operation: callbackOperation,
        nextStatus,
        images: persistedImages,
        resultImageIds: images.map((image) => this.versionedImageId(job, image.imageId)),
      });
      if (!committed.committed) {
        await this.cleanupUncommittedDesignCallbackFiles(job.id, savedImages);
        return committed.job;
      }
      if (downloadFailureCount) {
        await this.notifications.create(
          "warning",
          "设计图本地保存失败",
          `有 ${downloadFailureCount} 张候选图没有保存到本地文件，自动微信发图会等待人工确认。`,
          {
            effectKey: stableOperationKey("design-callback-download-warning", callbackOperation.key),
            designJobId: job.id,
            externalJobId: payload.externalJobId || job.externalJobId,
          },
        );
      }
      await this.notifications.create("info", "设计图已生成", `已生成 ${images.length} 张候选图`, {
        effectKey: stableOperationKey("design-callback-completed", callbackOperation.key),
        designJobId: job.id,
      });
      return committed.job;
    }

    if (appConfig.useLocalStore) {
      this.localStore.upsertDesignImages(
        job.id,
        savedImages.map(({ image, imageId, position, fingerprint, legacyIdentityHash, localPath }) => ({
          imageId,
          downloadUrl: sanitizePersistedImageUrl(image.downloadUrl),
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
            downloadUrl: sanitizePersistedImageUrl(image.downloadUrl),
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
            downloadUrl: sanitizePersistedImageUrl(image.downloadUrl),
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

  private assertDesignJobCanCancel(job: any, durableExecution: any = null) {
    const status = String(job?.status || "");
    const executionStatus = String(durableExecution?.status || "");
    const generationStarted = durableExecution
      ? !["prepared", "cancelled"].includes(executionStatus)
      : Boolean(job?.externalJobId || ["submitted", "generating"].includes(status));
    if (this.usesDurableArtImageExecutions() && generationStarted) {
      throw new ConflictException({
        code: "DESIGN_GENERATION_ALREADY_STARTED",
        message: "臻希 AI 任务发起后即进入计费且无法取消；请等待结果，禁止再次提交或自动重试。",
        designJobId: job?.id,
        externalJobId: job?.externalJobId || null,
      });
    }
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
    return CUSTOMER_DESIGN_CANDIDATE_COUNT;
  }

  private minimumRequiredLocalImageCount(job: any) {
    return this.minimumRequiredInitialImageCount(job);
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
    options: {
      operationKey?: string;
      releaseManualLock?: boolean;
      reviewer?: string;
      releaseReason?: string;
      visualQcClaimToken?: symbol;
    } & ExpectedIdentityPayload = {},
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({
          where: { id },
          include: { images: true },
    });
    if (!job) throw new Error(`design job not found: ${id}`);
    const operationKey = options.releaseManualLock
      ? normalizeOperationKey(options.operationKey, "operationKey")
      : options.operationKey
        ? normalizeOperationKey(options.operationKey, "operationKey")
        : stableOperationKey("design-send", `${job.id}:quick-confirm`);
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
    if (images.length !== CUSTOMER_DESIGN_CANDIDATE_COUNT) {
      await this.notifications.create(
        "warning",
        "候选图数量不完整",
        `当前轮次只有 ${images.length} 张可发送候选图，客服设计 SOP 要求每轮固定 ${CUSTOMER_DESIGN_CANDIDATE_COUNT} 张。`,
        {
          designJobId: job.id,
          requestId: job.requestId,
          candidateCount: images.length,
          requiredCandidateCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
        },
      );
      throw new BadRequestException(
        `design job must have exactly ${CUSTOMER_DESIGN_CANDIDATE_COUNT} candidate images before sending; received ${images.length}`,
      );
    }
    const imagePaths = images.map((image) => image.localPath).filter(Boolean) as string[];
    if (!options.releaseManualLock) {
      const decision = evaluateLowValueDesignImageSend({ ...job, images }, { highValueAmountCny: appConfig.highValueAmountCny });
      if (!decision.ok) {
        throw new BadRequestException(`design image send is not allowed without manual approval: ${decision.reason}`);
      }
      await this.assertCustomerCreativeVisualQc(job, imagePaths, options.visualQcClaimToken);
    }

    if (options.releaseManualLock) {
      assertManualReleaseReason(options.releaseReason, "design send manual release");
      await this.wechatDispatch.setConversationManualLock(job.conversationId, {
        effectKey: `${operationKey}:manual-unlock`,
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
        operationKey,
        wechatAccountId: job.wechatAccountId,
        conversationId: job.conversationId,
        customerId: job.customerId,
        designJobId: job.id,
        imagePaths,
        textBeforeImages: designImageDeliveryText(job),
        automation: {
          source: "low_value_design_image_send",
          valueLevel: "low",
          queuedBy: "low_value_automation",
        },
      });
      if (appConfig.useLocalStore) this.localStore.updateDesignJob(id, { status: "sent", sendTaskId: sendTask.id });
      else await this.prisma.designJob.update({ where: { id }, data: { status: "sent" } });
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
            effectKey: `${operationKey}:review-log`,
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
          effectKey: `${operationKey}:manual-relock`,
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
    const effectKey = String(payload.metadata?.effectKey || "").trim();
    const effectId = effectKey ? deterministicOperationId("review", effectKey) : "";
    if (effectId && typeof prisma.reviewLog.findUnique === "function") {
      const existing = await prisma.reviewLog.findUnique({ where: { id: effectId } });
      if (existing) return existing;
    }
    try {
      return await prisma.reviewLog.create({ data: effectId ? { id: effectId, ...payload } : payload });
    } catch (error) {
      if (!effectId || !isUniqueConstraintError(error) || typeof prisma.reviewLog.findUnique !== "function") throw error;
      const winner = await prisma.reviewLog.findUnique({ where: { id: effectId } });
      if (!winner) throw error;
      return winner;
    }
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

  private async queueDesignTextMessage(job: any, text: string, reason: string, operationKey?: string) {
    if (!job.wechatAccountId || !job.conversationId) return null;
    const resolvedOperationKey = operationKey || stableOperationKey("design-message", `${job.id}:${reason}:${text}`);
    try {
      return await this.wechatDispatch.enqueueTextMessage({
        operationKey: resolvedOperationKey,
        wechatAccountId: job.wechatAccountId,
        conversationId: job.conversationId,
        designJobId: job.id,
        text,
        reason,
        ...(!job.isHighValue && !isHighValueBudget(job.budget, appConfig.highValueAmountCny)
          ? {
              automation: {
                source: String(reason || "design-message").replace(/-/g, "_"),
                valueLevel: "low",
                queuedBy: "customer_tool_automation",
              },
            }
          : {}),
      });
    } catch (error) {
      if (await this.isConversationManualLocked(job.conversationId)) {
        await this.notifications.create(
          "warning",
          "自动话术已暂停",
          "该会话已人工接管，系统没有创建新的自动发送任务。",
          {
            ...(operationKey ? { effectKey: stableOperationKey("design-wait-paused", operationKey) } : {}),
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
    callbackOperation?: RequestOperationMetadata,
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await (this.prisma as any).designJob.findUnique({ where: { id }, include: { assets: true, revisions: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    assertExpectedIdentity(job, expected, "design job");

    try {
      await this.assertDesignPlatformPreflight(job.id);
      const payload = await this.buildDesignPlatformPayload(job, revision);
      if (callbackOperation && !this.usesDurableArtImageExecutions()) {
        const retryClaim = await this.beginDesignCallbackRetry(job.id, callbackOperation);
        if (!retryClaim.started) return retryClaim.job;
      }
      const retryCount = Number(job.retryCount || 0) + 1;
      const revisionRetryCount = revision?.id ? Number(revision.retryCount || 0) + 1 : undefined;
      if (this.usesDurableArtImageExecutions()) {
        const updated = await this.beginDurableArtImageExecution(
          job,
          payload,
          revision || null,
          mode,
          retryCount,
          revisionRetryCount,
        );
        await this.notifications.create(
          mode === "automatic" ? "warning" : "info",
          mode === "automatic" ? "设计任务已自动重试" : "设计任务已重新提交",
          reason || "已重新提交到设计平台，等待新的出图结果。",
          { designJobId: job.id, externalJobId: updated.externalJobId },
        );
        return updated;
      }
      const remote = await this.designPlatform.createDesignJob(payload);
      const externalJobId = remote.externalJobId || remote.jobId || remote.id;
      if (revision?.id) {
        await this.updateRevision(revision.id, {
          externalJobId,
          status: "submitted",
          retryCount: revisionRetryCount!,
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
            callbackOperationKey: null,
            callbackRequestFingerprint: null,
            callbackStatus: null,
            callbackClaimedAt: null,
            callbackSettledAt: null,
          })
        : await this.prisma.designJob.update({
            where: { id: job.id },
            data: {
              externalJobId,
              status: "submitted",
              retryCount,
              submittedAt: new Date(),
              errorMessage: "",
              callbackOperationKey: null,
              callbackRequestFingerprint: null,
              callbackStatus: null,
              callbackClaimedAt: null,
              callbackSettledAt: null,
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
      if (callbackOperation) await this.markDesignCallbackOutcomeUnknown(job.id, callbackOperation.key);
      await this.notifications.create("error", "设计任务重试失败", errorMessage, {
        ...(callbackOperation ? { effectKey: stableOperationKey("design-callback-retry-failed", callbackOperation.key) } : {}),
        designJobId: job.id,
        externalJobId: job.externalJobId,
      });
      if (callbackOperation) return this.loadDesignJobWithAssets(job.id);
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_retry_submit_failed",
        source: "retry_design_job",
        errorMessage,
      });
    }
  }

  private assertDesignRevisionOperationReplay(
    revision: any,
    operation: RequestOperationMetadata,
    job: any,
  ) {
    if (revision?.designJobId !== job.id) {
      throw new ConflictException({
        code: "OPERATION_KEY_REUSED",
        message: "design revision operationKey belongs to another design job",
      });
    }
    assertStoredOperationIdentityReplay(
      revision.operationIdentity || {},
      this.designOperationIdentity(job),
      "design revision",
    );
    assertExactOperationReplay(
      revision.operationKey && revision.requestFingerprint
        ? { key: revision.operationKey, fingerprint: revision.requestFingerprint }
        : null,
      operation,
      "design revision",
    );
  }

  private async completeDesignRevisionOperation(
    originalJob: any,
    storedRevision: any,
    decision: any,
    operation: RequestOperationMetadata,
  ) {
    let job = await this.loadDesignJobWithAssets(originalJob.id);
    let revision = await this.loadDesignRevision(storedRevision.id);
    this.assertDesignRevisionOperationReplay(revision, operation, job);

    if (!decision.submitAllowed) {
      return this.completeManualDesignRevision(job, revision, decision, operation);
    }
    if (revision.dispatchStatus === "accepted") {
      return this.completeDesignRevisionEffects(job, revision, decision, operation);
    }
    if (revision.dispatchStatus === "outcome_unknown") throw this.designDispatchOutcomeUnknown("revision");
    if (revision.dispatchStatus === "explicit_failed") throw this.designDispatchExplicitFailure("revision");
    if (revision.dispatchStatus === "dispatching") {
      await this.markDesignRevisionDispatchFailure(job, revision, "outcome_unknown", "dispatch claim survived without a verifiable response");
      throw this.designDispatchOutcomeUnknown("revision");
    }

    let platformPayload: DesignPlatformJobPayload;
    try {
      await this.assertDesignPlatformPreflight(job.id);
      platformPayload = await this.buildDesignPlatformPayload(job, revision, revision.externalRequestId);
    } catch (error) {
      await this.updateRevision(revision.id, { dispatchStatus: "local_failed", dispatchError: this.errorMessage(error) });
      throw error;
    }

    const claimed = await this.claimDesignRevisionDispatch(revision.id, operation.key);
    if (!claimed) {
      revision = await this.loadDesignRevision(revision.id);
      if (revision.dispatchStatus === "accepted") {
        return this.completeDesignRevisionEffects(job, revision, decision, operation);
      }
      await this.markDesignRevisionDispatchFailure(job, revision, "outcome_unknown", "dispatch claim could not be recovered safely");
      throw this.designDispatchOutcomeUnknown("revision");
    }

    try {
      let externalJobId: string;
      if (this.usesDurableArtImageExecutions()) {
        const updated = await this.beginDurableArtImageExecution(job, platformPayload, revision, "initial");
        externalJobId = String(updated.externalJobId || "").trim();
      } else {
        const remote = await this.designPlatform.createDesignJob(platformPayload);
        externalJobId = String(remote?.externalJobId || remote?.jobId || remote?.id || "").trim();
      }
      if (!externalJobId) throw Object.assign(new Error("design platform response did not contain an external job id"), { code: "MALFORMED_SUCCESS_RESPONSE" });
      revision = await this.updateRevision(revision.id, {
        externalJobId,
        status: "submitted",
        dispatchStatus: "accepted",
        dispatchError: null,
      });
      job = await this.updateDesignRevisionJob(job.id, {
        externalJobId,
        status: "submitted",
        submittedAt: new Date(),
        revisionCount: revision.revisionNumber,
        revisionPolicy: decision,
        errorMessage: null,
        callbackOperationKey: null,
        callbackRequestFingerprint: null,
        callbackStatus: null,
        callbackClaimedAt: null,
        callbackSettledAt: null,
      });
    } catch (error) {
      const status = this.isExplicitDesignDispatchFailure(error) ? "explicit_failed" : "outcome_unknown";
      await this.markDesignRevisionDispatchFailure(job, revision, status, this.errorMessage(error));
      if (status === "outcome_unknown") throw this.designDispatchOutcomeUnknown("revision");
      throw this.designDispatchExplicitFailure("revision");
    }
    return this.completeDesignRevisionEffects(job, revision, decision, operation);
  }

  private async completeManualDesignRevision(job: any, revision: any, decision: any, operation: RequestOperationMetadata) {
    const effectRoot = stableOperationKey("design-revision-manual", operation.key);
    const manualLock = job.conversationId
      ? await this.wechatDispatch.setConversationManualLock(job.conversationId, {
          expectedWechatAccountId: job.wechatAccountId,
          expectedConversationId: job.conversationId,
          expectedCustomerId: job.customerId,
          locked: true,
          reviewer: "system",
          reason: decision.reason,
          note: decision.reason,
          effectKey: effectRoot,
        })
      : null;
    const blockedSendTasks = manualLock?.blockedSendTasks || [];
    const inFlightSendTasks = manualLock?.inFlightSendTasks || [];
    await this.notifications.create(
      decision.chargeRequired ? "warning" : "info",
      decision.chargeRequired ? "改图已超出自动处理范围" : "高价值客户改图待人工审核",
      blockedSendTasks.length ? `${decision.reason} 已暂停 ${blockedSendTasks.length} 个待发送任务。` : decision.reason,
      {
        effectKey: stableOperationKey("design-revision-manual-notice", operation.key),
        designJobId: job.id,
        revisionId: revision.id,
        conversationId: job.conversationId,
        customerId: job.customerId,
        wechatAccountId: job.wechatAccountId,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
      },
    );
    const updated = await this.updateDesignRevisionJob(job.id, {
      status: "manual_review",
      manualQcRequired: true,
      revisionCount: revision.revisionNumber,
      revisionPolicy: decision,
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
        effectKey: stableOperationKey("design-revision-manual-review", operation.key),
        source: "design_revision_policy",
        designJobId: job.id,
        wechatAccountId: job.wechatAccountId,
        conversationId: job.conversationId,
        customerId: job.customerId,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        chargeRequired: decision.chargeRequired,
        blockedSendTaskIds: blockedSendTasks.map((task: any) => task.id),
        inFlightSendTaskIds: inFlightSendTasks.map((task: any) => task.id),
      },
    });
    return { decision, revision, job: updated };
  }

  private async completeDesignRevisionEffects(job: any, revision: any, decision: any, operation: RequestOperationMetadata) {
    job = await this.loadDesignJobWithAssets(job.id);
    revision = await this.loadDesignRevision(revision.id);
    await this.notifications.create("info", "改图已提交设计平台", decision.reason, {
      effectKey: stableOperationKey("design-revision-submitted", operation.key),
      designJobId: job.id,
      revisionId: revision.id,
      externalJobId: revision.externalJobId,
      conversationId: job.conversationId,
      customerId: job.customerId,
      wechatAccountId: job.wechatAccountId,
    });
    if (job.wechatAccountId) {
      const text = `收到，我按您说的“${String(revision.instruction || "").trim()}”重新处理一版，出来后再发您确认。`;
      await this.queueDesignTextMessage(
        job,
        text,
        "design-revision-waiting-message",
        stableOperationKey("design-revision-wait", operation.key),
      );
      if (!revision.waitMessageSentAt) {
        revision = await this.updateRevision(revision.id, { waitMessageSentAt: appConfig.useLocalStore ? new Date().toISOString() : new Date() });
      }
    }
    if (!this.usesDurableArtImageExecutions() && revision.externalJobId) {
      this.scheduleResultPoll(revision.externalRequestId || job.requestId, revision.externalJobId);
    }
    return { decision, revision, job: await this.loadDesignJobWithAssets(job.id) };
  }

  private async loadDesignRevision(id: string) {
    return appConfig.useLocalStore
      ? this.localStore.listDesignRevisions().find((revision: any) => revision.id === id)
      : (this.prisma as any).designRevision.findUnique({ where: { id } });
  }

  private async claimDesignRevisionDispatch(id: string, operationKey: string) {
    if (appConfig.useLocalStore) {
      const revision = await this.loadDesignRevision(id);
      if (!revision || revision.operationKey !== operationKey || !["prepared", "local_failed"].includes(revision.dispatchStatus)) return null;
      return this.localStore.updateDesignRevision(id, { dispatchStatus: "dispatching", dispatchError: null });
    }
    const changed = await (this.prisma as any).designRevision.updateMany({
      where: { id, operationKey, dispatchStatus: { in: ["prepared", "local_failed"] } },
      data: { dispatchStatus: "dispatching", dispatchError: null },
    });
    return changed.count === 1;
  }

  private async updateDesignRevisionJob(id: string, patch: Record<string, unknown>) {
    if (appConfig.useLocalStore) {
      const localPatch = { ...patch };
      if (localPatch.submittedAt instanceof Date) localPatch.submittedAt = (localPatch.submittedAt as Date).toISOString();
      return this.localStore.updateDesignJob(id, localPatch);
    }
    return (this.prisma as any).designJob.update({
      where: { id },
      data: patch,
      include: { images: true, assets: true, revisions: true },
    });
  }

  private async markDesignRevisionDispatchFailure(job: any, revision: any, dispatchStatus: string, dispatchError: string) {
    const message = dispatchStatus === "outcome_unknown"
      ? "设计平台可能已接受改图任务，但本地没有可验证响应；禁止再次提交，必须人工核对。"
      : "设计平台明确拒绝了改图任务，已转人工处理。";
    const updatedRevision = await this.updateRevision(revision.id, {
      dispatchStatus,
      dispatchError: dispatchStatus === "outcome_unknown" ? "design platform acceptance outcome is unknown" : dispatchError,
      status: "manual_review",
      manualReviewRequired: true,
    });
    const updatedJob = await this.updateDesignRevisionJob(job.id, {
      status: "manual_review",
      manualQcRequired: true,
      errorMessage: message,
    });
    await this.notifications.create("error", dispatchStatus === "outcome_unknown" ? "改图提交结果未知" : "改图提交失败", message, {
      effectKey: stableOperationKey("design-revision-dispatch-failure", `${revision.operationKey}:${dispatchStatus}`),
      designJobId: job.id,
      revisionId: revision.id,
      conversationId: job.conversationId,
      customerId: job.customerId,
      wechatAccountId: job.wechatAccountId,
    });
    return { revision: updatedRevision, job: updatedJob };
  }

  private designSubmitOperation(job: any, rawOperationKey: unknown): RequestOperationMetadata {
    const key = normalizeOperationKey(rawOperationKey, "design submit operationKey");
    return requestOperationMetadata(
      key,
      createOperationFingerprint(
        "design-job-submit",
        this.designOperationIdentity(job),
        {
          requestId: job.requestId,
          designType: job.designType,
          renderStyle: job.renderStyle,
          outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
          budget: job.budget,
          bundle: job.bundle,
          requirements: job.requirements,
          customerText: job.customerText || null,
          scene: job.scene || null,
          orderId: job.orderId || null,
          assetIds: (job.assets || []).map((asset: any) => String(asset.id || asset.assetId || "")).filter(Boolean).sort(),
        },
      ),
    );
  }

  private designOperationIdentity(job: any) {
    return {
      customerId: job.customerId || null,
      conversationId: job.conversationId || null,
      wechatAccountId: job.wechatAccountId || null,
    };
  }

  private async beginDesignSubmitOperation(job: any, operation: RequestOperationMetadata) {
    if (
      !job.submitOperationKey
      && job.externalJobId
      && ["submitted", "generating", "completed", "ready_to_send", "selected"].includes(String(job.status || ""))
    ) {
      throw new ConflictException({
        code: "DESIGN_ALREADY_SUBMITTED",
        message: "design job already has an external submission and cannot start another operation",
      });
    }
    const operationIdentity = this.designOperationIdentity(job);
    if (appConfig.useLocalStore) {
      return this.localStore.beginDesignJobSubmitOperation({
        designJobId: job.id,
        operationKey: operation.key,
        requestFingerprint: operation.fingerprint,
        operationIdentity,
      });
    }
    const prisma = this.prisma as any;
    const owner = await prisma.designJob.findUnique({
      where: { submitOperationKey: operation.key },
      include: { assets: true },
    });
    if (owner) return { job: owner, created: false };
    try {
      const changed = await prisma.designJob.updateMany({
        where: { id: job.id, submitOperationKey: null },
        data: {
          submitOperationKey: operation.key,
          submitRequestFingerprint: operation.fingerprint,
          submitOperationIdentity: operationIdentity,
          submitDispatchStatus: "prepared",
          submitDispatchError: null,
        },
      });
      if (changed.count === 1) {
        return {
          job: await prisma.designJob.findUnique({ where: { id: job.id }, include: { assets: true } }),
          created: true,
        };
      }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    const concurrent = await prisma.designJob.findFirst({
      where: { OR: [{ id: job.id }, { submitOperationKey: operation.key }] },
      include: { assets: true },
    });
    if (!concurrent) {
      throw new ConflictException({ code: "OPERATION_IN_PROGRESS", message: "design submit operation is being committed" });
    }
    return { job: concurrent, created: false };
  }

  private assertDesignSubmitOperationReplay(job: any, operation: RequestOperationMetadata, designJobId: string) {
    if (job?.id !== designJobId) {
      throw new ConflictException({
        code: "OPERATION_KEY_REUSED",
        message: "design submit operationKey belongs to another design job",
      });
    }
    assertStoredOperationIdentityReplay(job.submitOperationIdentity || {}, this.designOperationIdentity(job), "design submit");
    assertExactOperationReplay(
      job.submitOperationKey && job.submitRequestFingerprint
        ? { key: job.submitOperationKey, fingerprint: job.submitRequestFingerprint }
        : null,
      operation,
      "design submit",
    );
  }

  private async runExternalOperationOnce<T>(operationKey: string, action: () => Promise<T>): Promise<T> {
    const active = this.activeExternalOperationPromises.get(operationKey);
    if (active) return active as Promise<T>;
    const promise = action();
    this.activeExternalOperationPromises.set(operationKey, promise);
    try {
      return await promise;
    } finally {
      if (this.activeExternalOperationPromises.get(operationKey) === promise) {
        this.activeExternalOperationPromises.delete(operationKey);
      }
    }
  }

  private async completeDesignSubmitOperation(storedJob: any, operation: RequestOperationMetadata) {
    let job = await this.loadDesignJobWithAssets(storedJob.id);
    this.assertDesignSubmitOperationReplay(job, operation, storedJob.id);
    if (job.submitDispatchStatus === "accepted") return this.completeDesignSubmitEffects(job, operation);
    if (job.submitDispatchStatus === "outcome_unknown") throw this.designDispatchOutcomeUnknown("submit");
    if (job.submitDispatchStatus === "explicit_failed") throw this.designDispatchExplicitFailure("submit");
    if (job.submitDispatchStatus === "dispatching") {
      await this.markDesignSubmitDispatchFailure(job.id, "outcome_unknown", "dispatch claim survived without a verifiable response");
      throw this.designDispatchOutcomeUnknown("submit");
    }

    let platformPayload: DesignPlatformJobPayload;
    try {
      await this.assertDesignPlatformPreflight(job.id);
      platformPayload = await this.buildDesignPlatformPayload(job, null, job.requestId);
    } catch (error) {
      await this.updateDesignSubmitOperation(job.id, { submitDispatchStatus: "local_failed", submitDispatchError: this.errorMessage(error) });
      throw error;
    }

    const claimed = await this.claimDesignSubmitDispatch(job.id, operation.key);
    if (!claimed) {
      job = await this.loadDesignJobWithAssets(job.id);
      if (job.submitDispatchStatus === "accepted") return this.completeDesignSubmitEffects(job, operation);
      await this.markDesignSubmitDispatchFailure(job.id, "outcome_unknown", "dispatch claim could not be recovered safely");
      throw this.designDispatchOutcomeUnknown("submit");
    }

    try {
      if (this.usesDurableArtImageExecutions()) {
        await this.beginDurableArtImageExecution(job, platformPayload, null, "initial");
      } else {
        const remote = await this.designPlatform.createDesignJob(platformPayload);
        const externalJobId = String(remote?.externalJobId || remote?.jobId || remote?.id || "").trim();
        if (!externalJobId) throw Object.assign(new Error("design platform response did not contain an external job id"), { code: "MALFORMED_SUCCESS_RESPONSE" });
        await this.updateDesignSubmitOperation(job.id, {
          externalJobId,
          status: "submitted",
          submittedAt: new Date(),
          errorMessage: null,
          callbackOperationKey: null,
          callbackRequestFingerprint: null,
          callbackStatus: null,
          callbackClaimedAt: null,
          callbackSettledAt: null,
        });
      }
      job = await this.updateDesignSubmitOperation(job.id, {
        submitDispatchStatus: "accepted",
        submitDispatchError: null,
      });
    } catch (error) {
      const status = this.isExplicitDesignDispatchFailure(error) ? "explicit_failed" : "outcome_unknown";
      await this.markDesignSubmitDispatchFailure(job.id, status, this.errorMessage(error));
      if (status === "outcome_unknown") throw this.designDispatchOutcomeUnknown("submit");
      throw this.designDispatchExplicitFailure("submit");
    }
    return this.completeDesignSubmitEffects(job, operation);
  }

  private async completeDesignSubmitEffects(job: any, operation: RequestOperationMetadata) {
    const latest = await this.loadDesignJobWithAssets(job.id);
    const customerAgent = isPlainObject(latest.requirements?.customerAgent) ? latest.requirements.customerAgent : {};
    if (latest.wechatAccountId && customerAgent.suppressWaitingMessage !== true) {
      const waitMessage = buildWaitingMessage({
        scene: latest.scene || "",
        outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
      });
      await this.queueDesignTextMessage(
        latest,
        waitMessage,
        "design-waiting-message",
        stableOperationKey("design-wait", operation.key),
      );
      if (!latest.waitMessageSentAt) {
        await this.updateDesignSubmitOperation(latest.id, { waitMessageSentAt: new Date() });
      }
    }
    if (!this.usesDurableArtImageExecutions() && latest.externalJobId) {
      this.scheduleResultPoll(latest.requestId, latest.externalJobId);
    }
    return this.loadDesignJobWithAssets(latest.id);
  }

  private async loadDesignJobWithAssets(id: string) {
    return appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : (this.prisma as any).designJob.findUnique({ where: { id }, include: { assets: true, images: true, revisions: true } });
  }

  private async claimDesignSubmitDispatch(id: string, operationKey: string) {
    if (appConfig.useLocalStore) {
      const job = this.localStore.getDesignJob(id);
      if (!job || job.submitOperationKey !== operationKey || !["prepared", "local_failed"].includes(job.submitDispatchStatus)) return null;
      return this.localStore.updateDesignJob(id, { submitDispatchStatus: "dispatching", submitDispatchError: null });
    }
    const changed = await (this.prisma as any).designJob.updateMany({
      where: { id, submitOperationKey: operationKey, submitDispatchStatus: { in: ["prepared", "local_failed"] } },
      data: { submitDispatchStatus: "dispatching", submitDispatchError: null },
    });
    return changed.count === 1;
  }

  private async updateDesignSubmitOperation(id: string, patch: Record<string, unknown>) {
    if (appConfig.useLocalStore) {
      const localPatch = { ...patch };
      for (const key of ["submittedAt", "waitMessageSentAt"]) {
        if (localPatch[key] instanceof Date) localPatch[key] = (localPatch[key] as Date).toISOString();
      }
      return this.localStore.updateDesignJob(id, localPatch);
    }
    return (this.prisma as any).designJob.update({
      where: { id },
      data: patch,
      include: { assets: true, images: true, revisions: true },
    });
  }

  private async markDesignSubmitDispatchFailure(id: string, dispatchStatus: string, dispatchError: string) {
    const job = await this.updateDesignSubmitOperation(id, {
      submitDispatchStatus: dispatchStatus,
      submitDispatchError: dispatchStatus === "outcome_unknown" ? "design platform acceptance outcome is unknown" : dispatchError,
      status: "manual_review",
      manualQcRequired: true,
      errorMessage: dispatchStatus === "outcome_unknown"
        ? "设计平台可能已接受任务，但本地没有可验证响应；禁止再次提交，必须人工核对。"
        : "设计平台明确拒绝了任务，已转人工处理。",
    });
    await this.notifications.create(
      "error",
      dispatchStatus === "outcome_unknown" ? "设计平台提交结果未知" : "设计平台提交失败",
      job.errorMessage,
      {
        effectKey: stableOperationKey("design-dispatch-failure", `${job.submitOperationKey}:${dispatchStatus}`),
        designJobId: id,
        conversationId: job.conversationId,
        customerId: job.customerId,
        wechatAccountId: job.wechatAccountId,
      },
    );
    return job;
  }

  private designDispatchOutcomeUnknown(kind: "submit" | "revision") {
    return new ConflictException({
      code: "DESIGN_DISPATCH_OUTCOME_UNKNOWN",
      message: `${kind} may have been accepted by the design platform; automatic retry is blocked pending manual verification`,
    });
  }

  private designDispatchExplicitFailure(kind: "submit" | "revision") {
    return new ConflictException({
      code: "DESIGN_DISPATCH_EXPLICIT_FAILED",
      message: `${kind} was explicitly rejected by the design platform and requires manual review`,
    });
  }

  private isExplicitDesignDispatchFailure(error: unknown) {
    const status = Number((error as any)?.response?.status || 0);
    return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "unknown design platform error";
  }

  async forwardExistingImages(
    id: string,
    payload: ForwardExistingDesignImagesPayload & { reviewer?: string },
  ) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "operationKey");
    const requiredIdentity = [
      "expectedWechatAccountId",
      "expectedConversationId",
      "expectedCustomerId",
      "targetWechatAccountId",
      "targetConversationId",
      "targetCustomerId",
    ] as const;
    const missingIdentity = requiredIdentity.filter((key) => !String(payload?.[key] || "").trim());
    if (missingIdentity.length) {
      throw new BadRequestException(`forward existing images requires complete identity: ${missingIdentity.join(", ")}`);
    }

    return this.runExternalOperationOnce(`forward-existing-images:${operationKey}`, async () => {
      const sourceJob = appConfig.useLocalStore
        ? this.localStore.getDesignJob(id)
        : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
      if (!sourceJob) throw new NotFoundException(`design job not found: ${id}`);
      assertExpectedIdentity(sourceJob, payload, "source design job");
      this.assertDesignJobHasCompleteSendIdentity(sourceJob);

      const targetConversation = appConfig.useLocalStore
        ? this.localStore.listConversations().find((item: any) => item.id === payload.targetConversationId) || null
        : await this.prisma.conversation.findUnique({
            where: { id: payload.targetConversationId },
            select: { id: true, customerId: true, wechatAccountId: true },
          });
      if (!targetConversation) {
        throw new NotFoundException(`target conversation not found: ${payload.targetConversationId}`);
      }
      assertExpectedIdentity(
        { ...targetConversation, conversationId: targetConversation.id },
        {
          expectedWechatAccountId: payload.targetWechatAccountId,
          expectedConversationId: payload.targetConversationId,
          expectedCustomerId: payload.targetCustomerId,
        },
        "target conversation",
      );
      if (String(sourceJob.customerId) !== String(payload.targetCustomerId)) {
        throw new BadRequestException("existing design images may only be forwarded to another conversation for the same customer");
      }

      const sourceImages = latestCandidateRound(
        [...((sourceJob.images || []) as DesignImageCandidateLike[])].sort((a, b) => a.position - b.position),
      ).sort((a: DesignImageCandidateLike, b: DesignImageCandidateLike) => a.position - b.position);
      if (sourceImages.length !== CUSTOMER_DESIGN_CANDIDATE_COUNT) {
        throw new BadRequestException(
          `source design job must have exactly ${CUSTOMER_DESIGN_CANDIDATE_COUNT} current candidate images; received ${sourceImages.length}`,
        );
      }
      if (sourceImages.some((image: DesignImageCandidateLike) => !String(image.localPath || "").trim())) {
        throw new BadRequestException("source design job contains candidate images without local files");
      }

      const preparedSources = [] as Array<{
        source: DesignImageCandidateLike;
        bytes: Buffer;
        sha256: string;
        fingerprint: string;
        format: "jpeg" | "png";
        width: number;
        height: number;
      }>;
      for (const image of sourceImages) {
        const bytes = await readBoundedRegularFile(String(image.localPath), MAX_IMAGE_FINGERPRINT_BYTES);
        const fingerprint = await fingerprintImageBytes(bytes);
        preparedSources.push({
          source: image,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          ...fingerprint,
        });
      }

      const operation = requestOperationMetadata(
        operationKey,
        createOperationFingerprint(
          "design-forward-existing-images",
          {
            sourceDesignJobId: sourceJob.id,
            sourceWechatAccountId: sourceJob.wechatAccountId,
            sourceConversationId: sourceJob.conversationId,
            customerId: sourceJob.customerId,
            targetWechatAccountId: payload.targetWechatAccountId,
            targetConversationId: payload.targetConversationId,
          },
          { images: preparedSources.map((item) => ({ position: item.source.position, sha256: item.sha256 })) },
        ),
      );
      const forwardedRequestId = deterministicOperationId("design_forward", operation.key);
      const destinationDirectory = path.join(
        appConfig.localStorageRoot,
        "design-jobs",
        "forwarded",
        createHash("sha256").update(operation.key).digest("hex").slice(0, 24),
      );
      await fs.mkdir(destinationDirectory, { recursive: true });
      const copiedImages = [] as Array<Record<string, unknown>>;
      for (const [index, item] of preparedSources.entries()) {
        const extension = item.format === "jpeg" ? ".jpg" : ".png";
        const localPath = path.join(destinationDirectory, `candidate_${index + 1}${extension}`);
        try {
          await fs.writeFile(localPath, item.bytes, { flag: "wx" });
        } catch (error) {
          if (!isNodeErrorCode(error, "EEXIST")) throw error;
          const existingBytes = await readBoundedRegularFile(localPath, MAX_IMAGE_FINGERPRINT_BYTES);
          const existingSha256 = createHash("sha256").update(existingBytes).digest("hex");
          if (existingSha256 !== item.sha256) {
            throw new ConflictException("forwarded image destination already exists with different content");
          }
        }
        copiedImages.push({
          id: deterministicOperationId("image", operation.key, index + 1),
          imageId: `forwarded_candidate_${index + 1}`,
          position: index + 1,
          localPath,
          downloadUrl: null,
          width: item.width,
          height: item.height,
          fingerprint: item.fingerprint,
          legacyIdentityHash: item.sha256,
          selected: false,
        });
      }

      const sourceRequirements = isPlainObject(sourceJob.requirements) ? sourceJob.requirements : {};
      const requirements = {
        ...(isPlainObject(sourceRequirements.customerAgent)
          ? { customerAgent: sourceRequirements.customerAgent }
          : {}),
        requestOperation: operation,
        forwardedExistingImages: {
          sourceDesignJobId: sourceJob.id,
          sourceRequestId: sourceJob.requestId,
          sourceWechatAccountId: sourceJob.wechatAccountId,
          sourceConversationId: sourceJob.conversationId,
          targetWechatAccountId: payload.targetWechatAccountId,
          targetConversationId: payload.targetConversationId,
          sameCustomerValidated: true,
          regenerated: false,
          imageSha256: preparedSources.map((item) => item.sha256),
        },
      };

      let forwardedJob: any;
      if (appConfig.useLocalStore) {
        forwardedJob = this.localStore.createDesignJob({
          requestId: forwardedRequestId,
          customerId: payload.targetCustomerId,
          conversationId: payload.targetConversationId,
          wechatAccountId: payload.targetWechatAccountId,
          budget: sourceJob.budget || {},
          bundle: sourceJob.bundle || {},
          scene: sourceJob.scene || "",
          customerText: sourceJob.customerText || "",
          designType: sourceJob.designType || "bundle_render",
          outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
          renderStyle: sourceJob.renderStyle || "",
          requirements,
          isHighValue: Boolean(sourceJob.isHighValue),
          status: "quick_confirm",
          manualQcRequired: true,
        });
        assertExactOperationReplay(readRequestOperationMetadata(forwardedJob.requirements), operation, "forwarded design job");
        this.localStore.upsertDesignImages(forwardedJob.id, copiedImages);
        if (!["sent", "customer_selected", "quote_created"].includes(String(forwardedJob.status || ""))) {
          forwardedJob = this.localStore.updateDesignJob(forwardedJob.id, {
            status: "quick_confirm",
            completedAt: forwardedJob.completedAt || new Date().toISOString(),
          });
        } else {
          forwardedJob = this.localStore.getDesignJob(forwardedJob.id);
        }
      } else {
        const prisma = this.prisma as any;
        const existing = await prisma.designJob.findUnique({
          where: { requestId: forwardedRequestId },
          include: { images: true },
        });
        if (existing) {
          assertExactOperationReplay(readRequestOperationMetadata(existing.requirements), operation, "forwarded design job");
          assertExpectedIdentity(existing, {
            expectedWechatAccountId: payload.targetWechatAccountId,
            expectedConversationId: payload.targetConversationId,
            expectedCustomerId: payload.targetCustomerId,
          }, "forwarded design job");
          forwardedJob = existing;
        } else {
          try {
            forwardedJob = await prisma.designJob.create({
              data: {
                id: deterministicOperationId("design", operation.key),
                requestId: forwardedRequestId,
                customerId: payload.targetCustomerId,
                conversationId: payload.targetConversationId,
                wechatAccountId: payload.targetWechatAccountId,
                budget: sourceJob.budget || {},
                bundle: sourceJob.bundle || {},
                requirements,
                customerText: sourceJob.customerText || "",
                scene: sourceJob.scene || "",
                designType: sourceJob.designType || "bundle_render",
                renderStyle: sourceJob.renderStyle || "",
                outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
                isHighValue: Boolean(sourceJob.isHighValue),
                manualQcRequired: true,
                status: "quick_confirm",
                completedAt: new Date(),
                images: {
                  create: copiedImages.map(({ id: imageId, ...image }) => ({ ...image, id: imageId })),
                },
              },
              include: { images: true },
            });
          } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
            forwardedJob = await prisma.designJob.findUnique({
              where: { requestId: forwardedRequestId },
              include: { images: true },
            });
            if (!forwardedJob) throw error;
            assertExactOperationReplay(readRequestOperationMetadata(forwardedJob.requirements), operation, "forwarded design job");
          }
        }
      }

      const sendTask = await this.quickConfirmAndQueueSend(forwardedJob.id, {
        operationKey: stableOperationKey("design-forward-send", operation.key),
        expectedWechatAccountId: payload.targetWechatAccountId,
        expectedConversationId: payload.targetConversationId,
        expectedCustomerId: payload.targetCustomerId,
        releaseManualLock: true,
        reviewer: payload.reviewer || "manual operator",
        releaseReason: "manual_forward_existing_images",
      });
      return {
        sourceDesignJobId: sourceJob.id,
        forwardedDesignJobId: forwardedJob.id,
        targetWechatAccountId: payload.targetWechatAccountId,
        targetConversationId: payload.targetConversationId,
        customerId: payload.targetCustomerId,
        imageCount: copiedImages.length,
        regenerated: false,
        sendTask,
      };
    });
  }

  async retryCustomerCreativeVisualQc(
    id: string,
    options: { operationKey?: string; reviewer?: string } & ExpectedIdentityPayload = {},
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new NotFoundException(`design job not found: ${id}`);
    assertExpectedIdentity(job, options, "design job");
    if (!["manual_review", "quick_confirm"].includes(String(job.status || ""))) {
      throw new BadRequestException("visual QC retry requires a manual_review or quick_confirm design job");
    }
    if (job.isHighValue) throw new BadRequestException("high-value design jobs require manual approval");
    const requirements = job.requirements && typeof job.requirements === "object" ? job.requirements : {};
    if (!requirements.customerAgent) throw new BadRequestException("design job is not a customer creative visual task");
    const images = latestCandidateRound([...(job.images || [])]).sort((a: any, b: any) => a.position - b.position);
    if (images.length !== CUSTOMER_DESIGN_CANDIDATE_COUNT || images.some((image: any) => !image.localPath)) {
      throw new BadRequestException(`visual QC retry requires exactly ${CUSTOMER_DESIGN_CANDIDATE_COUNT} local images`);
    }
    const operationKey = options.operationKey
      ? normalizeOperationKey(options.operationKey, "operationKey")
      : stableOperationKey("design-visual-qc-retry", job.id);
    if (this.activeCustomerCreativeVisualQc.has(job.id)) {
      throw new ConflictException("customer creative visual QC is already processing");
    }
    this.activeCustomerCreativeVisualQc.add(job.id);
    try {
      await this.wechatDispatch.setConversationManualLock(job.conversationId, {
        effectKey: `${operationKey}:manual-unlock`,
        expectedWechatAccountId: job.wechatAccountId,
        expectedConversationId: job.conversationId,
        expectedCustomerId: job.customerId,
        locked: false,
        reviewer: options.reviewer || "local_admin",
        reason: "manual_retry_creative_visual_qc",
        note: "已修复多模态质检链路，仅重新质检现有图片，不重新调用出图模型。",
      });
      if (appConfig.useLocalStore) this.localStore.updateDesignJob(job.id, { status: "quick_confirm", errorMessage: "" });
      else await this.prisma.designJob.update({ where: { id: job.id }, data: { status: "quick_confirm", errorMessage: "" } });
      return await this.quickConfirmAndQueueSend(job.id, {
        operationKey,
        expectedWechatAccountId: job.wechatAccountId,
        expectedConversationId: job.conversationId,
        expectedCustomerId: job.customerId,
        releaseManualLock: false,
        visualQcClaimToken: this.customerCreativeVisualQcClaimToken,
      });
    } finally {
      this.activeCustomerCreativeVisualQc.delete(job.id);
    }
  }

  private async assertCustomerCreativeVisualQc(job: any, imagePaths: string[], claimToken?: symbol) {
    const requirements = job?.requirements && typeof job.requirements === "object" ? job.requirements : {};
    const customerAgent = requirements.customerAgent && typeof requirements.customerAgent === "object"
      ? requirements.customerAgent
      : null;
    if (!customerAgent) return;
    const label = String(customerAgent.deliverableLabel || customerAgent.deliverable || "客户设计物料").trim();
    const zhenxi = requirements.zhenxi && typeof requirements.zhenxi === "object" ? requirements.zhenxi : {};
    const expectedCopy = String(zhenxi.copyText || "").trim();
    const visualContentMode = String(zhenxi.visualContentMode || "").trim();
    const exactCopyOnly = zhenxi.exactCopyOnly === true;
    const forbidInventedProducts = zhenxi.forbidInventedProducts !== false;
    if (!this.aiProviders) {
      await this.handoffDesignJobToManual(job, {
        reason: "creative_visual_qc_unavailable",
        source: "customer_tool_agent_visual_qc",
        note: `${label}生成完成，但多模态质检服务不可用，已阻止自动发送。`,
        title: "客户设计物料待人工质检",
      });
      throw new BadRequestException("customer creative visual QC is unavailable; automatic send is blocked");
    }

    const ownsExistingClaim = claimToken === this.customerCreativeVisualQcClaimToken;
    if (this.activeCustomerCreativeVisualQc.has(job.id) && !ownsExistingClaim) {
      throw new ConflictException("customer creative visual QC is already processing");
    }
    if (!ownsExistingClaim) this.activeCustomerCreativeVisualQc.add(job.id);
    try {
      const images = await Promise.all(imagePaths.map(async (filePath) => {
        const source = await fs.readFile(filePath);
        const bytes = await sharp(source, {
          failOn: "warning",
          limitInputPixels: MAX_IMAGE_DECODE_PIXELS,
          sequentialRead: true,
        })
          .rotate()
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(768, 768, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
          .jpeg({ quality: 82, progressive: true, chromaSubsampling: "4:4:4" })
          .toBuffer();
        return { bytes, mimeType: "image/jpeg" as const };
      }));
      const response = await this.aiProviders.understandImages({
        images,
        prompt: [
          "你是印刷设计交付前的严格质检员。检查全部候选图，必须只返回 JSON，不要 Markdown。",
          `客户只要求的物料：${label}。不得混入其他未要求物料。`,
          expectedCopy ? `客户要求原样出现的文字：${expectedCopy}。逐字检查简繁体、标点、错字和乱码。` : "客户没有指定必须出现的文案，不得虚构品牌或错误文字。",
          expectedCopy ? "指定中文必须是结构正确、清楚可读的标准字形；偏旁、笔画、字形被艺术化到易误读也判不合格。" : "",
          exactCopyOnly ? "画面只能出现指定文案；任何额外汉字、英文、数字、占位文字或伪文字都判不合格。" : "",
          String(zhenxi.logoMode || "") === "none" ? "客户明确不要 Logo，图中不得自行增加品牌 Logo。" : "如图中有 Logo，检查其清晰度、完整性和是否被重绘变形。",
          visualContentMode === "graphic_only"
            ? "这是纯平面视觉，出现商品、礼盒、包装、杯子、雨伞、毛巾、文具或其他实物即不合格。"
            : "",
          visualContentMode === "real_product"
            ? "这是真实商品展示，商品外观、颜色、数量和包装关系必须与参考素材及商品清单一致。"
            : "",
          forbidInventedProducts && visualContentMode !== "real_product" ? "没有获准展示商品，不得擅自补画商品或包装。" : "",
          "还要逐张检查图像破损、明显拼接错误、商品畸变、文字超出安全区、主体被裁切、手机缩略图不可读，以及只有通用占位背景而不具备商业交付价值。",
          "四张候选图必须全部符合要求；问题中要注明第几张，任意一张不合格则整体不通过。",
          '返回格式：{"pass":true或false,"issues":["具体问题"],"checkedCount":数字}。任意一张不合格，pass 必须为 false。',
        ].join("\n"),
      });
      const result = parseCustomerCreativeVisualQc(response.text);
      if (!result.pass || result.checkedCount !== imagePaths.length) {
        const issues = result.issues.length ? result.issues.join("；") : "多模态质检未确认全部候选图合格";
        await this.handoffDesignJobToManual(job, {
          reason: "creative_visual_qc_failed",
          source: "customer_tool_agent_visual_qc",
          note: `${label}自动质检未通过：${issues}`,
          title: "客户设计物料质检未通过",
        });
        throw new BadRequestException(`customer creative visual QC failed: ${issues}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      await this.handoffDesignJobToManual(job, {
        reason: "creative_visual_qc_unavailable",
        source: "customer_tool_agent_visual_qc",
        note: `${label}多模态质检未能完成：${error instanceof Error ? error.message : "unknown error"}`,
        title: "客户设计物料待人工质检",
      });
      throw new BadRequestException("customer creative visual QC could not be completed; automatic send is blocked");
    } finally {
      if (!ownsExistingClaim) this.activeCustomerCreativeVisualQc.delete(job.id);
    }
  }

  private safeLogUrl(value: unknown) {
    try {
      const url = new URL(String(value || ""));
      return `${url.origin}${url.pathname}`;
    } catch {
      return String(value || "").slice(0, 120);
    }
  }

  private async buildDesignPlatformPayload(
    job: any,
    revision?: DesignRevisionLike | null,
    requestIdOverride?: string,
  ): Promise<DesignPlatformJobPayload> {
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
      requestId: requestIdOverride || job.requestId,
      wechatAccountId: job.wechatAccountId,
      customerId: job.customerId,
      conversationId: job.conversationId,
      orderId: job.orderId,
      budget: job.budget as Record<string, unknown>,
      scene: job.scene,
      bundle: job.bundle as Record<string, unknown>,
      assets,
      designType: job.designType,
      outputCount: Number(job.outputCount || CUSTOMER_DESIGN_CANDIDATE_COUNT),
      renderStyle: job.renderStyle,
      requirements: job.requirements as Record<string, unknown>,
      customerText: job.customerText,
      callback: this.buildDesignPlatformCallback(requestIdOverride || job.requestId),
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
    const headers = hasIndependentDesignPlatformCallbackApiKey()
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
          localPath: remote.localPath || asset.localPath,
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

  private normalizeDesignCreateOperationPayload(payload: CreateDesignJobPayload, requestedAssets: Array<Record<string, unknown>>) {
    return {
      orderId: payload.orderId || null,
      budget: payload.budget || {},
      bundle: payload.bundle || {},
      assets: requestedAssets,
      scene: payload.scene || "",
      customerText: payload.customerText || "",
      designType: payload.designType || "bundle_render",
      outputCount: CUSTOMER_DESIGN_CANDIDATE_COUNT,
    };
  }

  private async completeDesignJobCreateEffects(job: any, operation: RequestOperationMetadata, readiness: any): Promise<any> {
    assertExactOperationReplay(readRequestOperationMetadata(job?.requirements), operation, "design job create");
    const active = this.activeCreateEffectPromises.get(job.id);
    if (active) {
      try {
        return await active;
      } catch {
        if (this.activeCreateEffectPromises.get(job.id) === active) {
          this.activeCreateEffectPromises.delete(job.id);
        }
        return this.completeDesignJobCreateEffects(job, operation, readiness);
      }
    }
    const promise = this.runDesignJobCreateEffects(job, operation, readiness);
    this.activeCreateEffectPromises.set(job.id, promise);
    try {
      return await promise;
    } finally {
      if (this.activeCreateEffectPromises.get(job.id) === promise) {
        this.activeCreateEffectPromises.delete(job.id);
      }
    }
  }

  private async runDesignJobCreateEffects(job: any, operation: RequestOperationMetadata, readiness: any) {
    let current = await this.loadDesignJobForCreateEffects(job.id);
    assertExactOperationReplay(readRequestOperationMetadata(current?.requirements), operation, "design job create");
    let effects = this.readDesignJobCreateEffects(current);
    if (effects.completedAt) return { ...current, readiness };
    const effectRoot = `design-job-create:${operation.key}`;

    if (!readiness.ok && effects.readinessNotification !== "completed") {
      await this.notifications.create(
        "warning",
        "设计任务资料不完整",
        `缺少字段：${readiness.missing.join(", ")}`,
        {
          effectKey: `${effectRoot}:readiness-notification`,
          designJobId: current.id,
          requestId: current.requestId,
          conversationId: current.conversationId,
          customerId: current.customerId,
          wechatAccountId: current.wechatAccountId,
        },
      );
      current = await this.markDesignJobCreateEffects(current.id, operation, { readinessNotification: "completed" });
      effects = this.readDesignJobCreateEffects(current);
    }

    if (current.isHighValue) {
      if (effects.manualStatus !== "completed") {
        current = await this.markDesignJobCreateEffects(
          current.id,
          operation,
          { manualStatus: "completed" },
          { status: "manual_review", manualQcRequired: true },
        );
        effects = this.readDesignJobCreateEffects(current);
      }

      if (effects.manualLock !== "completed") {
        const manualLock = await this.wechatDispatch.setConversationManualLock(current.conversationId, {
          expectedWechatAccountId: current.wechatAccountId,
          expectedConversationId: current.conversationId,
          expectedCustomerId: current.customerId,
          locked: true,
          reviewer: "system",
          reason: "high_value_customer",
          note: "金额达到高价值线，需要人工确认方案、报价和跟进节奏。",
          effectKey: `${effectRoot}:manual-lock`,
        });
        current = await this.markDesignJobCreateEffects(current.id, operation, {
          manualLock: "completed",
          blockedSendTaskIds: (manualLock?.blockedSendTasks || []).map((task: any) => task.id),
          inFlightSendTaskIds: (manualLock?.inFlightSendTasks || []).map((task: any) => task.id),
        });
        effects = this.readDesignJobCreateEffects(current);
      }

      const blockedSendTaskIds = Array.isArray(effects.blockedSendTaskIds) ? effects.blockedSendTaskIds : [];
      const inFlightSendTaskIds = Array.isArray(effects.inFlightSendTaskIds) ? effects.inFlightSendTaskIds : [];
      if (effects.handoffNotification !== "completed") {
        const note = "金额达到高价值线，需要人工确认方案、报价和跟进节奏。";
        await this.notifications.create(
          "warning",
          "设计任务已转人工",
          blockedSendTaskIds.length ? `${note} 已暂停 ${blockedSendTaskIds.length} 个待发送任务。` : note,
          {
            effectKey: `${effectRoot}:handoff-notification`,
            designJobId: current.id,
            requestId: current.requestId,
            conversationId: current.conversationId,
            customerId: current.customerId,
            wechatAccountId: current.wechatAccountId,
            blockedSendTaskIds,
            inFlightSendTaskIds,
          },
        );
        current = await this.markDesignJobCreateEffects(current.id, operation, { handoffNotification: "completed" });
        effects = this.readDesignJobCreateEffects(current);
      }

      if (effects.handoffReviewLog !== "completed") {
        await this.createReviewLog({
          targetType: "design_job",
          targetId: current.id,
          decision: "high_value_customer",
          reviewer: "system",
          note: "金额达到高价值线，需要人工确认方案、报价和跟进节奏。",
          beforeStatus: "created",
          afterStatus: "manual_review",
          metadata: {
            effectKey: `${effectRoot}:handoff-review`,
            ...this.buildManualHandoffMetadata(current, {
              reason: "high_value_customer",
              source: "create_design_job",
            }),
            blockedSendTaskIds,
            inFlightSendTaskIds,
          },
        });
        current = await this.markDesignJobCreateEffects(current.id, operation, { handoffReviewLog: "completed" });
      }
    }

    current = await this.markDesignJobCreateEffects(current.id, operation, { completedAt: new Date().toISOString() });
    return { ...current, readiness };
  }

  private async loadDesignJobForCreateEffects(id: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`design job not found while completing create effects: ${id}`);
    return job;
  }

  private readDesignJobCreateEffects(job: any): Record<string, any> {
    const requirements = isPlainObject(job?.requirements) ? job.requirements : {};
    return isPlainObject(requirements.createEffects) ? requirements.createEffects : {};
  }

  private async markDesignJobCreateEffects(
    id: string,
    operation: RequestOperationMetadata,
    effectPatch: Record<string, unknown>,
    jobPatch: Record<string, unknown> = {},
  ) {
    const latest = await this.loadDesignJobForCreateEffects(id);
    assertExactOperationReplay(readRequestOperationMetadata(latest?.requirements), operation, "design job create");
    const requirements = isPlainObject(latest.requirements) ? latest.requirements : {};
    const createEffects = this.readDesignJobCreateEffects(latest);
    const patch = {
      ...jobPatch,
      requirements: {
        ...requirements,
        createEffects: {
          version: 1,
          ...createEffects,
          ...effectPatch,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    return appConfig.useLocalStore
      ? this.localStore.updateDesignJob(id, patch)
      : this.prisma.designJob.update({ where: { id }, data: patch as any });
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

  private usesDurableArtImageExecutions() {
    return Boolean(
      this.designPlatform.isDurableGenerationAdapter?.() ||
      this.designPlatform.isArtImageLocalAdapter?.(),
    );
  }

  private async beginDurableArtImageExecution(
    job: any,
    payload: DesignPlatformJobPayload,
    revision: DesignRevisionLike | null,
    mode: "initial" | "automatic" | "manual",
    retryCount?: number,
    revisionRetryCount?: number,
  ) {
    const attemptNo = retryCount === undefined ? 1 : retryCount + 1;
    const begun = await this.platformExecutions!.begin({
      designJobId: job.id,
      designRevisionId: revision?.id || null,
      adapter: appConfig.designPlatformAdapter,
      attemptNo,
      ...(retryCount !== undefined ? { retryCount } : {}),
      ...(revisionRetryCount !== undefined ? { revisionRetryCount } : {}),
      ...(revision?.revisionNumber !== undefined ? { revisionNumber: Number(revision.revisionNumber) } : {}),
    });
    const execution = begun.execution;
    if (begun.created) {
      const promise = this.runDurableArtImageExecution(execution, payload, mode).finally(() => {
        this.activeExecutionPromises.delete(execution.id);
      });
      this.activeExecutionPromises.set(execution.id, promise);
      void promise.catch(async (error) => {
        await this.notifications.create(
          "error",
          "设计平台执行持久化处理失败",
          "设计平台执行处理未完成，已保留持久化状态，请按 execution 状态恢复或人工核对。",
          { designJobId: job.id, externalJobId: execution.externalJobId },
        );
      });
    }
    const updated = appConfig.useLocalStore
      ? this.localStore.getDesignJob(job.id)
      : await this.prisma.designJob.findUnique({ where: { id: job.id } });
    return updated;
  }

  private async runDurableArtImageExecution(execution: any, payload: DesignPlatformJobPayload, mode: string) {
    const claimed = await this.platformExecutions!.claimDispatch(execution.id);
    if (!claimed) return;
    const generating = await this.platformExecutions!.markGenerating(execution.id);
    if (!generating) return;
    let outcome: any;
    try {
      const executeDurable = this.designPlatform.executeDurableGeneration?.bind(this.designPlatform);
      outcome = executeDurable
        ? await executeDurable(payload, execution.externalJobId)
        : await this.designPlatform.executeArtImageLocalGeneration(payload, execution.externalJobId);
    } catch (error) {
      outcome = {
        status: "outcome_unknown",
        images: [],
        refundStatus: "unknown",
        errorCode: "UNCLASSIFIED_EXECUTION_ERROR",
        errorMessage: error instanceof Error ? error.message : "unknown design platform execution error",
      };
    }
    const stored = await this.platformExecutions!.recordOutcome(execution.id, outcome);
    if (!stored) return;

    if (outcome.status === "outcome_unknown") {
      const job = await this.findDesignJobForExecution(execution.designJobId);
      if (job && job.status !== "cancelled") {
        await this.handoffDesignJobToManual(job, {
          reason: "design_platform_outcome_unknown",
          source: `durable_${mode}_execution`,
          beforeStatus: job.status,
          note: "网络中断或服务重启后无法确认设计平台是否已生成和扣费；必须人工核对，普通重试已禁用。",
          title: "设计平台执行结果未知",
        });
      }
      return;
    }

    if (outcome.status === "failed") {
      await this.handleDesignPlatformCallback({
        requestId: payload.requestId,
        externalJobId: execution.externalJobId,
        status: "failed",
        errorMessage: stored.errorMessage || "design platform reported an explicit terminal failure",
      });
      return;
    }

    if (["failed", "unknown"].includes(outcome.refundStatus)) {
      const job = await this.findDesignJobForExecution(execution.designJobId);
      if (job && job.status !== "cancelled") {
        await this.handoffDesignJobToManual(job, {
          reason: "design_platform_refund_unresolved",
          source: `durable_${mode}_execution`,
          beforeStatus: job.status,
          note: "设计平台已返回图片，但失败项的退款状态未安全闭环；必须人工核对后再验收。",
        });
      }
      const claimedAcceptance = await this.platformExecutions!.claimAcceptance(execution.id);
      if (claimedAcceptance) {
        await this.platformExecutions!.finishAcceptance(
          execution.id,
          "manual_review",
          "design platform refund requires manual review",
        );
      }
      return;
    }

    await this.acceptDurableArtImageExecution(execution.id, outcome.images);
  }

  private async acceptDurableArtImageExecution(executionId: string, transientImages?: any[]) {
    const execution = await this.platformExecutions!.claimAcceptance(executionId);
    if (!execution) return null;
    try {
      const job = await this.findDesignJobForExecution(execution.designJobId);
      if (!job?.requestId) throw new Error("design execution job binding is missing during acceptance");
      const updated = await this.handleDesignPlatformCallback({
        requestId: job.requestId,
        externalJobId: execution.externalJobId,
        status: "completed",
        images: Array.isArray(transientImages) ? transientImages : Array.isArray(execution.images) ? execution.images : [],
      });
      if (updated?.durableAcceptanceCommitted) return updated;
      const accepted = !["failed", "manual_review", "cancelled"].includes(String(updated?.status || ""));
      await this.platformExecutions!.finishAcceptance(
        execution.id,
        accepted ? "accepted" : "manual_review",
        accepted ? undefined : String(updated?.errorMessage || "design result requires manual acceptance"),
      );
      return updated;
    } catch (error) {
      await this.platformExecutions!.finishAcceptance(
        execution.id,
        "pending",
        error instanceof Error ? error.message : "design result acceptance failed",
      );
      await this.notifications.create(
        "warning",
        "设计结果待继续验收",
        "设计平台已完成出图，但本地验收尚未完成；重启后只会继续验收，不会重新生成。",
        { designJobId: execution.designJobId, externalJobId: execution.externalJobId },
      );
      return null;
    }
  }

  async reconcileDurableArtImageExecutions() {
    if (!this.usesDurableArtImageExecutions()) return;
    if (this.activeRecoveryReconciliation) return this.activeRecoveryReconciliation;
    const reconciliation = this.recoverDurableArtImageExecutions();
    this.activeRecoveryReconciliation = reconciliation;
    try {
      await reconciliation;
    } finally {
      if (this.activeRecoveryReconciliation === reconciliation) this.activeRecoveryReconciliation = null;
    }
  }

  private async recoverDurableArtImageExecutions() {
    const recovered = await this.platformExecutions!.recoverStaleExecutions();
    for (const execution of recovered) {
      await this.notifications.create(
        "warning",
        "设计平台重启恢复需人工核对",
        "进程重启时任务可能已被真实设计平台接受；系统已标记 outcome_unknown 并禁止自动重试。",
        { designJobId: execution.designJobId, externalJobId: execution.externalJobId },
      );
    }
    const prepared = await this.platformExecutions!.takeoverPreparedExecutions(50);
    for (const execution of prepared) {
      try {
        const job = await this.findDesignJobForExecution(execution.designJobId);
        if (!job) throw new Error(`design job not found: ${execution.designJobId}`);
        const revision = execution.designRevisionId
          ? appConfig.useLocalStore
            ? this.localStore.listDesignRevisions(job.id).find((item: any) => item.id === execution.designRevisionId) || null
            : await (this.prisma as any).designRevision.findUnique({ where: { id: execution.designRevisionId } })
          : null;
        const payload = await this.buildDesignPlatformPayload(job, revision);
        const promise = this.runDurableArtImageExecution(execution, payload, "restart_prepared").finally(() => {
          this.activeExecutionPromises.delete(execution.id);
        });
        this.activeExecutionPromises.set(execution.id, promise);
        void promise.catch(() => undefined);
      } catch (error) {
        await this.platformExecutions!.failPrepared(execution.id, error);
        await this.notifications.create(
          "error",
          "设计平台待提交任务恢复失败",
          "待提交任务无法重建设计请求，未调用生成接口，已转人工处理。",
          { designJobId: execution.designJobId, externalJobId: execution.externalJobId },
        );
      }
    }
    const pending = await this.platformExecutions!.listCompletedPending(50);
    for (const execution of pending) await this.acceptDurableArtImageExecution(execution.id);
  }

  private async pollDurableArtImageResult(job: any) {
    const execution = await this.platformExecutions!.get(job.externalJobId);
    if (!execution) {
      const updated = await this.handoffDesignJobToManual(job, {
        reason: "design_platform_execution_missing",
        source: "poll_durable_design_result",
        beforeStatus: job.status,
        note: "旧任务没有可核验的持久化执行记录，不能判断是否生成或扣费，禁止自动重试。",
      });
      return { remoteStatus: "outcome_unknown", autoRetried: false, job: updated, result: { status: "outcome_unknown" } };
    }
    if (execution.status === "completed" && execution.acceptanceStatus === "pending") {
      await this.acceptDurableArtImageExecution(execution.id);
    }
    const updated = await this.findDesignJobForExecution(job.id);
    const remoteStatus = ["dispatching", "prepared", "generating"].includes(execution.status)
      ? "generating"
      : execution.status;
    return {
      remoteStatus,
      autoRetried: false,
      job: updated,
      result: {
        status: remoteStatus,
        images: execution.status === "completed" ? execution.images || [] : [],
        errorMessage: execution.errorMessage || undefined,
        refundStatus: execution.refundStatus,
      },
    };
  }

  private async designCallbackAllowsAutomaticRetry(payload: DesignPlatformCallbackPayload) {
    void payload;
    // Zhenxi requests are billed when dispatch starts and cannot be cancelled. A second
    // model call must therefore require an explicit human retry, even after a known failure.
    if (this.usesDurableArtImageExecutions()) return false;
    return true;
  }

  private async findDesignJobForExecution(designJobId: string) {
    return appConfig.useLocalStore
      ? this.localStore.getDesignJob(designJobId)
      : this.prisma.designJob.findUnique({ where: { id: designJobId }, include: { images: true } });
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

function isNodeErrorCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === code);
}

function designImageDeliveryText(job: any) {
  const requirements = isPlainObject(job?.requirements) ? job.requirements : {};
  const customerAgent = isPlainObject(requirements.customerAgent) ? requirements.customerAgent : {};
  const label = String(customerAgent.deliverableLabel || "").trim();
  if (label) return `我把${label}的 4 版效果发您了，您直接回复喜欢第几张，或者告诉我想改哪里。`;
  return "我先把几版礼盒效果图发您，您可以直接引用喜欢的那张告诉我。";
}

function parseCustomerCreativeVisualQc(value: unknown) {
  const text = String(value || "").trim();
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || "";
  try {
    const parsed = JSON.parse(jsonText);
    return {
      pass: parsed?.pass === true,
      checkedCount: Number.isFinite(Number(parsed?.checkedCount)) ? Number(parsed.checkedCount) : 0,
      issues: (Array.isArray(parsed?.issues) ? parsed.issues : [])
        .map((item: unknown) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 20),
    };
  } catch {
    return { pass: false, checkedCount: 0, issues: ["质检模型未返回有效 JSON 结果"] };
  }
}

function normalizeZhenxiCopyModule(value: unknown): "poster_copy" | "xiaohongshu" | "detail_page" | "video_script" {
  const module = String(value || "");
  if (["xiaohongshu", "detail_page", "video_script"].includes(module)) {
    return module as "xiaohongshu" | "detail_page" | "video_script";
  }
  return "poster_copy";
}

function sanitizePersistedImageUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
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
