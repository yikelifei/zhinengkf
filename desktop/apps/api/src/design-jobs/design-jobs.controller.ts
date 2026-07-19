import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DesignJobsService } from "./design-jobs.service";
import {
  CreateDesignJobPayload,
  CreateDesignRevisionPayload,
  ResolveDesignExecutionRefundPayload,
  ResolveUnknownDesignExecutionPayload,
  SelectDesignImagePayload,
} from "./design-jobs.types";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

@Controller("design-jobs")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
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

  @Get(":id/executions")
  listExecutions(
    @Param("id") id: string,
    @Query("expectedWechatAccountId") expectedWechatAccountId?: string,
    @Query("expectedConversationId") expectedConversationId?: string,
    @Query("expectedCustomerId") expectedCustomerId?: string,
  ) {
    return this.designJobs.listExecutions(id, {
      expectedWechatAccountId,
      expectedConversationId,
      expectedCustomerId,
    });
  }

  @Post()
  @RequireOperatorCapability("manage_design_executions")
  create(@Body() payload: CreateDesignJobPayload) {
    return this.designJobs.create(payload);
  }

  @Post("scan-timeouts")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  scanTimeouts(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.scanTimeouts(payload || {});
  }

  @Post("poll-active-results")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  pollActiveResults(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.pollActiveResults(undefined, payload || {});
  }

  @Post("auto-submit-drafts")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  autoSubmitDrafts(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.scanAutoSubmitDrafts(payload || {});
  }

  @Post("auto-process-low-value")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  autoProcessLowValue(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.runLowValueAutomation(payload || {});
  }

  @Post("scan-high-value-handoffs")
  @RequireOperatorCapability("manage_design_executions")
  scanHighValueHandoffs(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.designJobs.scanHighValueHandoffs(payload || {});
  }

  @Post("demo-timeout")
  @RequireOperatorCapability("manage_design_executions")
  createTimeoutDemo(@Body() payload: { conversationId?: string } & ExpectedIdentityPayload) {
    return this.designJobs.createTimeoutDemo(payload || {});
  }

  @Post("demo-failure")
  @RequireOperatorCapability("manage_design_executions")
  createFailureDemo(@Body() payload: { conversationId?: string } & ExpectedIdentityPayload) {
    return this.designJobs.createFailureDemo(payload || {});
  }

  @Post(":id/submit")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  submit(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.submit(id, body || {});
  }

  @Post(":id/preflight")
  @RequireOperatorCapability("view_console")
  preflight(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.preflight(id, body || {});
  }

  @Post(":id/poll")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  pollResult(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.pollResult(id, body || {});
  }

  @Post(":id/retry")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  retry(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.retry(id, body || {});
  }

  @Post(":id/executions/:executionId/resolve-unknown")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  resolveUnknownExecution(
    @Param("id") id: string,
    @Param("executionId") executionId: string,
    @Body() body: ResolveUnknownDesignExecutionPayload & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedBody } = body as typeof body & { reviewer?: unknown };
    return this.designJobs.resolveUnknownExecution(id, executionId, trustedBody, principal.id);
  }

  @Post(":id/executions/:executionId/resolve-refund")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  resolveExecutionRefund(
    @Param("id") id: string,
    @Param("executionId") executionId: string,
    @Body() body: ResolveDesignExecutionRefundPayload & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedBody } = body as typeof body & { reviewer?: unknown };
    return this.designJobs.resolveExecutionRefund(id, executionId, trustedBody, principal.id);
  }

  @Post(":id/assets")
  @RequireOperatorCapability("manage_design_executions")
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
  @RequireOperatorCapability("manage_design_executions")
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
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  requestRevision(@Param("id") id: string, @Body() payload: CreateDesignRevisionPayload & ExpectedIdentityPayload) {
    return this.designJobs.requestRevision(id, payload);
  }

  @Post(":id/cancel")
  @RequireOperatorCapability("manage_design_executions")
  @UseGuards(OperatorAccessGuard)
  cancel(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.cancel(id, body || {});
  }

  @Post(":id/quick-confirm-send")
  @RequireOperatorCapability("approve_send")
  quickConfirmSend(
    @Param("id") id: string,
    @Body() body: ExpectedIdentityPayload = {},
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.designJobs.quickConfirmAndQueueSend(id, {
      ...(body || {}),
      releaseManualLock: true,
      reviewer: `${principal.displayName} [${principal.id}]`,
      releaseReason: "manual_quick_confirm_send",
    });
  }

  @Post(":id/select-image")
  @RequireOperatorCapability("manage_design_executions")
  selectImage(@Param("id") id: string, @Body() body: SelectDesignImagePayload & ExpectedIdentityPayload) {
    return this.designJobs.selectImage(id, body || {});
  }

  @Post(":id/quote")
  @RequireOperatorCapability("manage_design_executions")
  createQuote(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.createQuote(id, body || {});
  }

  @Post(":id/manual-review")
  @RequireOperatorCapability("manage_design_executions")
  markManualReview(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.designJobs.markManualReview(id, body || {});
  }
}
