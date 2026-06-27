import { Injectable } from "@nestjs/common";
import { DesignJobsService } from "../design-jobs/design-jobs.service";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { QuotesService } from "../quotes/quotes.service";
import { appConfig } from "../shared/app-config";

type ReviewPayload = {
  decision: string;
  reviewer?: string;
  note?: string;
};

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly designJobs: DesignJobsService,
    private readonly quotes: QuotesService,
    private readonly notifications: NotificationsService,
  ) {}

  async list() {
    if (appConfig.useLocalStore) {
      const designJobs = this.localStore
        .listDesignJobs()
        .filter((job: any) => ["manual_review", "failed", "timeout"].includes(job.status))
        .slice(0, 80);
      const quoteDrafts = this.localStore
        .listQuoteDrafts()
        .filter((quote: any) => quote.status === "manual_review")
        .slice(0, 80);
      return {
        designJobs,
        quoteDrafts,
        logs: this.localStore.listReviewLogs(80),
      };
    }

    const prisma = this.prisma as any;
    const [designJobs, quoteDrafts, logs] = await Promise.all([
      this.prisma.designJob.findMany({
        where: { status: { in: ["manual_review", "failed", "timeout"] } },
        include: { customer: true, conversation: true, images: true, assets: true },
        orderBy: { updatedAt: "desc" },
        take: 80,
      }),
      this.prisma.quoteDraft.findMany({
        where: { status: "manual_review" },
        include: { customer: true, designJob: true, selectedImage: true },
        orderBy: { updatedAt: "desc" },
        take: 80,
      }),
      prisma.reviewLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
    ]);
    return { designJobs, quoteDrafts, logs };
  }

  async reviewDesignJob(id: string, payload: ReviewPayload) {
    const job = appConfig.useLocalStore
      ? this.localStore.getDesignJob(id)
      : await this.prisma.designJob.findUnique({ where: { id }, include: { images: true } });
    if (!job) throw new Error(`design job not found: ${id}`);
    const beforeStatus = job.status;
    const decision = payload.decision || "approve_images";
    let result: any;

    if (decision === "approve_send") {
      result = await this.designJobs.quickConfirmAndQueueSend(id, {
        releaseManualLock: true,
        reviewer: payload.reviewer || "人工客服",
        releaseReason: "manual_approve_send",
      });
      await this.notifications.create("info", "人工审核已批准发送", payload.note || "图片已通过人工审核，已进入安全发送队列。", {
        designJobId: id,
      });
    } else if (decision === "request_revision") {
      result = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(id, {
            status: "manual_review",
            manualQcRequired: true,
            errorMessage: payload.note || "人工审核要求继续改图",
          })
        : await this.prisma.designJob.update({
            where: { id },
            data: {
              status: "manual_review",
              manualQcRequired: true,
              errorMessage: payload.note || "人工审核要求继续改图",
            },
          });
      await this.notifications.create("warning", "人工审核要求改图", payload.note || "需要继续调整效果图。", {
        designJobId: id,
      });
    } else if (decision === "reject") {
      result = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(id, {
            status: "manual_review",
            manualQcRequired: true,
            errorMessage: payload.note || "人工审核未通过",
          })
        : await this.prisma.designJob.update({
            where: { id },
            data: {
              status: "manual_review",
              manualQcRequired: true,
              errorMessage: payload.note || "人工审核未通过",
            },
          });
      await this.notifications.create("error", "人工审核未通过", payload.note || "该设计任务仍需人工处理。", {
        designJobId: id,
      });
    } else {
      result = appConfig.useLocalStore
        ? this.localStore.updateDesignJob(id, {
            status: "quick_confirm",
            manualQcRequired: false,
            errorMessage: "",
          })
        : await this.prisma.designJob.update({
            where: { id },
            data: {
              status: "quick_confirm",
              manualQcRequired: false,
              errorMessage: "",
            },
          });
      await this.notifications.create("info", "人工审核已通过", payload.note || "图片可进入快速确认或发送。", {
        designJobId: id,
      });
    }

    const afterStatus = result?.status || (decision === "approve_send" ? "sent" : "quick_confirm");
    const log = await this.createLog({
      targetType: "design_job",
      targetId: id,
      decision,
      reviewer: payload.reviewer,
      note: payload.note,
      beforeStatus,
      afterStatus,
    });
    return { result, log };
  }

  async reviewQuote(id: string, payload: ReviewPayload) {
    const quote = appConfig.useLocalStore
      ? this.localStore.getQuoteDraft(id)
      : await this.prisma.quoteDraft.findUnique({ where: { id } });
    if (!quote) throw new Error(`quote draft not found: ${id}`);
    const beforeStatus = quote.status;
    const decision = payload.decision || "approve_quote";
    let result: any;
    let customerNotes: string;
    if (decision === "reject_quote") {
      customerNotes = payload.note || "人工审核驳回报价";
      result = await this.quotes.update(id, {
        status: "rejected",
        owner: payload.reviewer || "人工客服",
        customerNotes,
      });
    } else if (decision === "request_followup") {
      customerNotes = payload.note || "需要继续跟进客户";
      result = await this.quotes.update(id, {
        status: "manual_review",
        owner: payload.reviewer || "人工客服",
        customerNotes,
      });
    } else {
      customerNotes = payload.note || "人工审核通过，报价已进入微信安全发送队列";
      result = await this.quotes.queueSend(id, {
        owner: payload.reviewer || "人工客服",
        note: customerNotes,
        releaseManualLock: true,
        releaseReason: "manual_approve_quote",
      });
    }
    const resultQuote = result?.quote || result;
    await this.notifications.create(
      decision === "reject_quote" ? "warning" : "info",
      decision === "reject_quote" ? "报价审核未通过" : "报价审核已处理",
      customerNotes,
      { quoteDraftId: id, sendTaskId: result?.sendTask?.id },
    );
    const log = await this.createLog({
      targetType: "quote",
      targetId: id,
      decision,
      reviewer: payload.reviewer,
      note: payload.note,
      beforeStatus,
      afterStatus: resultQuote.status,
    });
    return { result, log };
  }

  private async createLog(payload: {
    targetType: string;
    targetId: string;
    decision: string;
    reviewer?: string;
    note?: string;
    beforeStatus?: string;
    afterStatus?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (appConfig.useLocalStore) return this.localStore.createReviewLog(payload);
    const prisma = this.prisma as any;
    return prisma.reviewLog.create({ data: payload });
  }
}
