import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
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
const {
  buildWaitingMessage,
  decideRevisionPolicy,
  evaluateArtImageLocalHealthReadiness,
  evaluateDesignAutoSubmit,
  evaluateDesignPlatformActivationStatus,
  evaluateHighValueHandoff,
  evaluateLowValueDesignImageSend,
  inspectAssetReferences,
  inspectBundleReferences,
  inspectRealDesignReferences,
  isHighValueBudget,
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
  chargeRequired?: boolean;
  manualReviewRequired?: boolean;
  externalJobId?: string | null;
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

  list() {
    if (appConfig.useLocalStore) return this.localStore.listDesignJobs();
    return this.prisma.designJob.findMany({
      include: { images: true, customer: true, conversation: true, assets: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
  }

  async scanHighValueHandoffs() {
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs()
      : await this.prisma.designJob.findMany({
          where: { isHighValue: true },
          include: { customer: true, conversation: true },
          orderBy: { updatedAt: "desc" },
          take: 300,
        });
    const handedOff: any[] = [];
    const skipped: any[] = [];

    for (const job of jobs as any[]) {
      const decision = evaluateHighValueHandoff(job);
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

  async scanAutoSubmitDrafts() {
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs()
      : await this.prisma.designJob.findMany({
          where: { status: "draft" },
          include: { assets: true, customer: true, conversation: true },
          orderBy: { updatedAt: "desc" },
          take: 300,
        });
    const submitted: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];

    for (const job of jobs as any[]) {
      const decision = evaluateDesignAutoSubmit(job);
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

  async runLowValueAutomation() {
    const autoSubmit = await this.scanAutoSubmitDrafts();
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs()
      : await this.prisma.designJob.findMany({
          where: { status: "quick_confirm", isHighValue: false },
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
      const decision = evaluateLowValueDesignImageSend(job);
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

    const quoteSend = await this.quotes.scanLowValueAutoQuoteSends();
    const orderDraft = await this.orders.scanLowValueAutoOrderDrafts();
    const orderConfirmation = await this.wechatDispatch.scanLowValueOrderConfirmations();
    const orderFollowup = await this.wechatDispatch.scanLowValueOrderFollowups();

    return {
      autoSubmit,
      imageSend,
      quoteSend,
      orderDraft,
      orderConfirmation,
      orderFollowup,
    };
  }

  async pollActiveResults(limit = appConfig.lowValueAutomationPollLimit) {
    const max = Math.max(1, Math.min(Number(limit || 50), 200));
    const jobs = appConfig.useLocalStore
      ? this.localStore
          .listDesignJobs()
          .filter((job: any) => ["submitted", "generating"].includes(job.status) && job.externalJobId)
          .slice(0, max)
      : await this.prisma.designJob.findMany({
          where: {
            status: { in: ["submitted", "generating"] },
            externalJobId: { not: null },
          },
          include: { images: true },
          orderBy: { updatedAt: "asc" },
          take: max,
        });
    const result = {
      scanned: jobs.length,
      completed: [] as any[],
      failed: [] as any[],
      generating: [] as any[],
      cancelled: [] as any[],
      errors: [] as any[],
    };

    for (const job of jobs as any[]) {
      try {
        const polled = await this.pollResult(job.id);
        const remoteStatus = polled.remoteStatus || "generating";
        if (remoteStatus === "completed") result.completed.push(polled.job);
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

  async scanTimeouts() {
    const now = new Date();
    const jobs = appConfig.useLocalStore
      ? this.localStore.listDesignJobs()
      : await this.prisma.designJob.findMany({
          where: { status: { in: ["submitted", "generating"] } },
          include: { customer: true, conversation: true },
          take: 300,
        });
    const candidates = jobs.filter((job: any) =>
      ["submitted", "generating"].includes(job.status) &&
      shouldTimeout(job.submittedAt || job.createdAt, now, appConfig.designTimeoutMinutes),
    );
    const updatedJobs = [];

    for (const job of candidates as any[]) {
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
      timedOut: updatedJobs.length,
      jobs: updatedJobs,
    };
  }

  createTimeoutDemo(payload: { conversationId?: string } = {}) {
    if (!appConfig.useLocalStore) throw new Error("timeout demo is only available in local-json mode");
    if (!payload.conversationId) {
      throw new BadRequestException("conversationId is required for timeout demo");
    }
    const conversation = this.localStore.listConversations().find((item) => item.id === payload.conversationId);
    if (!conversation) throw new BadRequestException("conversation not found for timeout demo");
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

  createFailureDemo(payload: { conversationId?: string } = {}) {
    if (!appConfig.useLocalStore) throw new Error("failure demo is only available in local-json mode");
    if (!payload.conversationId) {
      throw new BadRequestException("conversationId is required for failure demo");
    }
    const conversation = this.localStore.listConversations().find((item) => item.id === payload.conversationId);
    if (!conversation) throw new BadRequestException("conversation not found for failure demo");
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

  async submit(id: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);

    await this.assertDesignPlatformPreflight(id);

    const payload = await this.buildDesignPlatformPayload(job);
    const remote = await this.designPlatform.createDesignJob(payload);
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

  async preflight(id: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);

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
      key: "real_image_refs",
      label: "真实商品/客户图片",
      ok: !requiresRealImages || realRefs.ok,
      severity: "error",
      detail: requiresRealImages
        ? `可用图片 ${usableRefs.length} 个，不可用 ${unusableRefs.length} 个`
        : `未强制要求真实图片，可用图片 ${usableRefs.length} 个`,
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
      isHighValue: Boolean(job.isHighValue),
      usableReferenceCount: usableRefs.length,
      unusableReferenceCount: unusableRefs.length,
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

  async pollResult(id: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    if (!job.externalJobId) throw new Error("design job has no externalJobId");

    const result = await this.designPlatform.getDesignJobResults(job.externalJobId);
    if (result.status === "completed") {
      const updated = await this.handleDesignPlatformCallback({
        requestId: job.requestId,
        externalJobId: job.externalJobId,
        status: "completed",
        images: result.images || [],
      });
      return { remoteStatus: result.status, job: updated, result };
    }
    if (result.status === "failed") {
      const updated = await this.handleDesignPlatformCallback({
        requestId: job.requestId,
        externalJobId: job.externalJobId,
        status: "failed",
        errorMessage: result.errorMessage || "设计平台轮询返回失败",
      });
      return { remoteStatus: result.status, job: updated, result };
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

  async retry(id: string) {
    return this.retryDesignJob(id, "manual");
  }

  async attachAssets(id: string, assetIds: string[]) {
    const uniqueAssetIds = [...new Set((assetIds || []).filter(Boolean))];
    if (!uniqueAssetIds.length) throw new Error("assetIds is required");
    if (appConfig.useLocalStore) return this.localStore.attachDesignAssetsToJob(id, uniqueAssetIds);
    const [designJob, assets] = await Promise.all([
      this.prisma.designJob.findUnique({ where: { id }, select: { id: true, requestId: true, customerId: true } }),
      this.prisma.designAsset.findMany({ where: { id: { in: uniqueAssetIds } } }),
    ]);
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

  async listRevisions(id: string) {
    if (appConfig.useLocalStore) return this.localStore.listDesignRevisions(id);
    const prisma = this.prisma as any;
    return prisma.designRevision.findMany({
      where: { designJobId: id },
      orderBy: { revisionNumber: "asc" },
    });
  }

  async requestRevision(id: string, payload: CreateDesignRevisionPayload) {
    const prisma = this.prisma as any;
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await prisma.designJob.findUnique({
          where: { id },
          include: { images: true, assets: true, revisions: true },
        });
    if (!job) throw new Error(`design job not found: ${id}`);

    const existingRevisions = appConfig.useLocalStore
      ? this.localStore.listDesignRevisions(job.id)
      : ((job as any).revisions || []);
    const decision = decideRevisionPolicy({
      instruction: payload.instruction,
      revisionCount: existingRevisions.length,
      isHighValue: job.isHighValue,
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
          conversationId: job.conversationId,
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

    const payloadForPlatform = await this.buildDesignPlatformPayload(job, revision);
    const remote = await this.designPlatform.createDesignJob(payloadForPlatform);
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

  async cancel(id: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { assets: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
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

    if (payload.status === "failed") {
      await this.finishLatestRevision(job.id, "failed", [], payload.errorMessage);
      const retryCount = Number(job.retryCount || 0);
      await this.notifications.create(retryCount < 1 ? "warning" : "error", "设计平台出图失败", payload.errorMessage || "未返回失败原因", {
        designJobId: job.id,
      });
      if (retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", payload.errorMessage || "设计平台返回失败");
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

    const images = payload.images || [];
    if (!images.length) {
      const errorMessage = "design platform completed without images";
      await this.finishLatestRevision(job.id, "failed", [], errorMessage);
      const retryCount = Number(job.retryCount || 0);
      await this.notifications.create(retryCount < 1 ? "warning" : "error", "设计平台未返回图片", errorMessage, {
        designJobId: job.id,
        externalJobId: payload.externalJobId || job.externalJobId,
      });
      if (retryCount < 1) {
        return this.retryDesignJob(job.id, "automatic", errorMessage);
      }
      return this.failDesignJobForManualReview(job, {
        reason: "design_platform_completed_without_images",
        source: "design_platform_callback",
        errorMessage,
      });
    }

    const savedImages: Array<{
      image: any;
      imageId: string;
      position: number;
      fingerprint: string;
      localPath?: string;
    }> = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const imageId = this.versionedImageId(job, image.imageId);
      const position = this.versionedImagePosition(job, index + 1);
      const fingerprint = this.buildImageFingerprint(job, image, imageId, position);
      let localPath: string | undefined;
      try {
        localPath = await this.storage.saveDesignImage(job.id, image.imageId, image.downloadUrl);
      } catch (error) {
        localPath = undefined;
      }
      savedImages.push({ image, imageId, position, fingerprint, localPath });
      if (appConfig.useLocalStore) {
        continue;
      }
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
          position,
        } as any,
      });
    }

    const downloadFailureCount = savedImages.filter((item) => !item.localPath).length;
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
        savedImages.map(({ image, imageId, position, fingerprint, localPath }) => ({
          imageId,
          downloadUrl: image.downloadUrl,
          width: image.width,
          height: image.height,
          localPath,
          fingerprint,
          position,
        })),
      );
    }

    await this.finishLatestRevision(
      job.id,
      "completed",
      images.map((image) => this.versionedImageId(job, image.imageId)),
    );

    const nextStatus = nextStatusAfterDesignCompleted({
      isHighValue: job.isHighValue,
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

  async quickConfirmAndQueueSend(
    id: string,
    options: { releaseManualLock?: boolean; reviewer?: string; releaseReason?: string } = {},
  ) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({
          where: { id },
          include: { images: true },
    });
    if (!job) throw new Error(`design job not found: ${id}`);
    if (!job.wechatAccountId) throw new Error("design job has no wechatAccountId");
    if (!job.conversationId) throw new Error("design job has no conversationId");

    const images = [...((job.images || []) as DesignImageCandidateLike[])].sort((a, b) => a.position - b.position);
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

    if (options.releaseManualLock) {
      assertManualReleaseReason(options.releaseReason, "design send manual release");
      await this.wechatDispatch.setConversationManualLock(job.conversationId, {
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
          locked: true,
          reviewer: options.reviewer || "人工客服",
          reason: "manual_approve_send_queue_failed",
          note: `人工审核发送未能入队，已重新接管会话：${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
      throw error;
    }
  }

  async selectImage(id: string, input: string | SelectDesignImagePayload) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
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
    if (job.isHighValue) {
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

  async createQuote(id: string) {
    const quote = await this.quotes.createFromDesignJob(id);
    if (appConfig.useLocalStore) this.localStore.updateDesignJob(id, { status: "quote_created" });
    else await this.prisma.designJob.update({ where: { id }, data: { status: "quote_created" } });
    return quote;
  }

  async markManualReview(id: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id } });
    if (!job) throw new Error(`design job not found: ${id}`);

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

  private async retryDesignJob(id: string, mode: "automatic" | "manual", reason?: string) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await (this.prisma as any).designJob.findUnique({ where: { id }, include: { assets: true, revisions: true } });
    if (!job) throw new Error(`design job not found: ${id}`);

    try {
      await this.assertDesignPlatformPreflight(job.id);
      const payload = await this.buildDesignPlatformPayload(job);
      const remote = await this.designPlatform.createDesignJob(payload);
      const externalJobId = remote.externalJobId || remote.jobId || remote.id;
      const retryCount = Number(job.retryCount || 0) + 1;
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
    const assets = await this.uploadAssetsForDesignPlatform(job.assets || []);
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

  private findSelectedImageId(job: any) {
    const selected = (job.images || []).find((image: any) => image.selected);
    return selected?.id || selected?.imageId || null;
  }

  private versionedImageId(job: any, imageId: string) {
    const revisionCount = Number(job.revisionCount || 0);
    return revisionCount > 0 ? `r${revisionCount}-${imageId}` : imageId;
  }

  private versionedImagePosition(job: any, position: number) {
    const revisionCount = Number(job.revisionCount || 0);
    return revisionCount > 0 ? revisionCount * 100 + position : position;
  }

  private buildImageFingerprint(job: any, image: any, imageId: string, position: number) {
    return createHash("sha256")
      .update([job.id, job.requestId, imageId, position, image.downloadUrl || ""].join("|"))
      .digest("hex")
      .slice(0, 32);
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
        });
        uploaded.push({
          assetId: asset.id,
          remoteAssetId: remote.assetId || remote.remoteAssetId || remote.id,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          role: asset.role || "reference",
          source: asset.source,
        });
      } catch (error) {
        uploaded.push({
          assetId: asset.id,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          role: asset.role || "reference",
          source: asset.source,
          uploadError: error instanceof Error ? error.message : "unknown asset upload error",
        });
      }
    }
    return uploaded;
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
}

function formatAuthSessionUser(auth: { user?: unknown; profile?: unknown }) {
  const user = isPlainObject(auth.user) ? auth.user : {};
  const profile = isPlainObject(auth.profile) ? auth.profile : {};
  return String(user.email || profile.displayName || profile.display_name || user.id || "设计平台账号");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertManualReleaseReason(reason: unknown, context: string) {
  const text = String(reason || "").trim();
  if (!text || !text.startsWith("manual_")) {
    throw new BadRequestException(`${context} requires an explicit manual release reason`);
  }
}
