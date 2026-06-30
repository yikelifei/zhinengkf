import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { DesignJobsService } from "./design-jobs.service";
import { CreateDesignJobPayload, CreateDesignRevisionPayload, SelectDesignImagePayload } from "./design-jobs.types";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("design-jobs")
export class DesignJobsController {
  constructor(private readonly designJobs: DesignJobsService) {}

  @Get()
  list(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.designJobs.list({ wechatAccountId, conversationId, customerId });
  }

  @Post()
  create(@Body() payload: CreateDesignJobPayload) {
    return this.designJobs.create(payload);
  }

  @Post("scan-timeouts")
  scanTimeouts() {
    return this.designJobs.scanTimeouts();
  }

  @Post("poll-active-results")
  pollActiveResults() {
    return this.designJobs.pollActiveResults();
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
  submit(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.submit(id, body || {});
  }

  @Post(":id/preflight")
  preflight(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.preflight(id, body || {});
  }

  @Post(":id/poll")
  pollResult(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.pollResult(id, body || {});
  }

  @Post(":id/retry")
  retry(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.retry(id, body || {});
  }

  @Post(":id/assets")
  attachAssets(@Param("id") id: string, @Body() body: { assetIds: string[] } & ExpectedIdentityPayload) {
    return this.designJobs.attachAssets(id, body?.assetIds || [], body || {});
  }

  @Get(":id/revisions")
  listRevisions(@Param("id") id: string) {
    return this.designJobs.listRevisions(id);
  }

  @Post(":id/revisions")
  requestRevision(@Param("id") id: string, @Body() payload: CreateDesignRevisionPayload & ExpectedIdentityPayload) {
    return this.designJobs.requestRevision(id, payload);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.cancel(id, body || {});
  }

  @Post(":id/quick-confirm-send")
  quickConfirmSend(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.quickConfirmAndQueueSend(id, {
      ...(body || {}),
      releaseManualLock: true,
      reviewer: "人工客服",
      releaseReason: "manual_quick_confirm_send",
    });
  }

  @Post(":id/select-image")
  selectImage(@Param("id") id: string, @Body() body: SelectDesignImagePayload & ExpectedIdentityPayload) {
    return this.designJobs.selectImage(id, body || {});
  }

  @Post(":id/quote")
  createQuote(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.createQuote(id, body || {});
  }

  @Post(":id/manual-review")
  markManualReview(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.markManualReview(id, body || {});
  }
}
