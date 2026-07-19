import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
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
  scanTimeouts(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.scanTimeouts(payload || {});
  }

  @Post("poll-active-results")
  pollActiveResults(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.pollActiveResults(undefined, payload || {});
  }

  @Post("auto-submit-drafts")
  autoSubmitDrafts(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.scanAutoSubmitDrafts(payload || {});
  }

  @Post("auto-process-low-value")
  autoProcessLowValue(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.runLowValueAutomation(payload || {});
  }

  @Post("scan-high-value-handoffs")
  scanHighValueHandoffs(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.scanHighValueHandoffs(payload || {});
  }

  @Post("demo-timeout")
  createTimeoutDemo(@Body() payload: { conversationId?: string } & ExpectedIdentityPayload) {
    return this.designJobs.createTimeoutDemo(payload || {});
  }

  @Post("demo-failure")
  createFailureDemo(@Body() payload: { conversationId?: string } & ExpectedIdentityPayload) {
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

  @Get(":id/images/:imageId/local-file")
  async localImageFile(
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @Query("wechatAccountId") wechatAccountId: string,
    @Query("conversationId") conversationId: string,
    @Query("customerId") customerId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.designJobs.readLocalDesignImage(id, imageId, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
    reply.header("Content-Type", file.mimeType);
    reply.header("Content-Length", String(file.sizeBytes));
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(file.stream);
  }

  @Get(":id/images/:imageId/local-file-status")
  localImageFileStatus(
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @Query("wechatAccountId") wechatAccountId: string,
    @Query("conversationId") conversationId: string,
    @Query("customerId") customerId: string,
  ) {
    return this.designJobs.inspectLocalDesignImage(id, imageId, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Post(":id/images/:imageId/repair-local-file")
  repairLocalImageFile(
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @Body() body: ExpectedIdentityPayload = {},
  ) {
    return this.designJobs.repairLocalDesignImage(id, imageId, body || {});
  }

  @Get(":id/revisions")
  listRevisions(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.designJobs.listRevisions(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
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
