import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { DesignJobsService } from "./design-jobs.service";
import { CreateDesignJobPayload, CreateDesignRevisionPayload, SelectDesignImagePayload } from "./design-jobs.types";

@Controller("design-jobs")
export class DesignJobsController {
  constructor(private readonly designJobs: DesignJobsService) {}

  @Get()
  list() {
    return this.designJobs.list();
  }

  @Post()
  create(@Body() payload: CreateDesignJobPayload) {
    return this.designJobs.create(payload);
  }

  @Post("scan-timeouts")
  scanTimeouts() {
    return this.designJobs.scanTimeouts();
  }

  @Post("auto-submit-drafts")
  autoSubmitDrafts() {
    return this.designJobs.scanAutoSubmitDrafts();
  }

  @Post("auto-process-low-value")
  autoProcessLowValue() {
    return this.designJobs.runLowValueAutomation();
  }

  @Post("scan-high-value-handoffs")
  scanHighValueHandoffs() {
    return this.designJobs.scanHighValueHandoffs();
  }

  @Post("demo-timeout")
  createTimeoutDemo(@Body() payload: { conversationId?: string }) {
    return this.designJobs.createTimeoutDemo(payload || {});
  }

  @Post("demo-failure")
  createFailureDemo(@Body() payload: { conversationId?: string }) {
    return this.designJobs.createFailureDemo(payload || {});
  }

  @Post(":id/submit")
  submit(@Param("id") id: string) {
    return this.designJobs.submit(id);
  }

  @Post(":id/preflight")
  preflight(@Param("id") id: string) {
    return this.designJobs.preflight(id);
  }

  @Post(":id/poll")
  pollResult(@Param("id") id: string) {
    return this.designJobs.pollResult(id);
  }

  @Post(":id/retry")
  retry(@Param("id") id: string) {
    return this.designJobs.retry(id);
  }

  @Post(":id/assets")
  attachAssets(@Param("id") id: string, @Body() body: { assetIds: string[] }) {
    return this.designJobs.attachAssets(id, body.assetIds || []);
  }

  @Get(":id/revisions")
  listRevisions(@Param("id") id: string) {
    return this.designJobs.listRevisions(id);
  }

  @Post(":id/revisions")
  requestRevision(@Param("id") id: string, @Body() payload: CreateDesignRevisionPayload) {
    return this.designJobs.requestRevision(id, payload);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string) {
    return this.designJobs.cancel(id);
  }

  @Post(":id/quick-confirm-send")
  quickConfirmSend(@Param("id") id: string) {
    return this.designJobs.quickConfirmAndQueueSend(id, {
      releaseManualLock: true,
      reviewer: "人工客服",
      releaseReason: "manual_quick_confirm_send",
    });
  }

  @Post(":id/select-image")
  selectImage(@Param("id") id: string, @Body() body: SelectDesignImagePayload) {
    return this.designJobs.selectImage(id, body || {});
  }

  @Post(":id/quote")
  createQuote(@Param("id") id: string) {
    return this.designJobs.createQuote(id);
  }

  @Post(":id/manual-review")
  markManualReview(@Param("id") id: string) {
    return this.designJobs.markManualReview(id);
  }
}
