import { Body, Controller, ForbiddenException, Get, Header, Headers, Optional, Param, Post, Query, Sse, UseGuards } from "@nestjs/common";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";
import { WechatWorkService } from "./wechat-work.service";
import { readinessExportTokenMatches, WECHAT_WORK_READINESS_TOKEN_HEADER } from "./wechat-work-readiness-remote";
import { WechatWorkCallbackEventClientService } from "./wechat-work-callback-event-client.service";
import {
  callbackEventTokenMatches,
  WechatWorkCallbackEventRelay,
  WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER,
} from "./wechat-work-callback-events";

@Controller("wechat-work")
export class WechatWorkController {
  constructor(
    private readonly wechatWork: WechatWorkService,
    @Optional() private readonly callbackEvents?: WechatWorkCallbackEventRelay,
    @Optional() private readonly callbackEventClient?: WechatWorkCallbackEventClientService,
  ) {}

  @Get("status")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  getStatus() {
    return this.wechatWork.getStatus();
  }

  @Get("preflight")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  getProductionPreflight() {
    return this.wechatWork.getProductionPreflight();
  }

  @Get("readiness/export")
  @Header("cache-control", "no-store")
  getProductionPreflightExport(@Headers(WECHAT_WORK_READINESS_TOKEN_HEADER) token?: string) {
    if (!readinessExportTokenMatches(process.env.WECHAT_WORK_READINESS_EXPORT_TOKEN, token)) {
      throw new ForbiddenException("invalid readiness export token");
    }
    return this.wechatWork.getProductionPreflightExport();
  }

  @Sse("events/stream")
  streamCallbackEvents(@Headers(WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER) token?: string) {
    if (!callbackEventTokenMatches(process.env.WECHAT_WORK_EVENT_STREAM_EXPORT_TOKEN, token)) {
      throw new ForbiddenException("invalid callback event stream token");
    }
    if (!this.callbackEvents) throw new ForbiddenException("callback event stream unavailable");
    return this.callbackEvents.stream();
  }

  @Get("events/status")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  getCallbackEventStatus() {
    return this.callbackEventClient?.status() || {
      configured: false,
      connected: false,
      endpoint: null,
    };
  }

  @Get("callback")
  @Header("content-type", "text/plain; charset=utf-8")
  verifyCallback(@Query() query: Record<string, string>) {
    return this.wechatWork.verifyCallback(query);
  }

  @Post("callback")
  @Header("content-type", "text/plain; charset=utf-8")
  handleCallback(@Query() query: Record<string, string>, @Body() body: unknown) {
    return this.wechatWork.handleCallback(query, body);
  }

  @Post("kf/sync")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  syncCustomerServiceMessages(@Body() payload: { token?: string; cursor?: string; limit?: number; openKfid?: string }) {
    return this.wechatWork.syncCustomerServiceMessages(payload || {});
  }

  @Post("kf/connection/diagnose")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  diagnoseCustomerServiceConnection() {
    return this.wechatWork.diagnoseCustomerServiceConnection();
  }

  @Post("kf/connection/validate-credential")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  validateCustomerServiceCredential(@Body() payload: { secret?: string }) {
    return this.wechatWork.validateCustomerServiceCredential(payload || {});
  }

  @Post("kf/connection/save-credential")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  saveCustomerServiceCredential(@Body() payload: { secret?: string; openKfid?: string }) {
    return this.wechatWork.saveCustomerServiceCredential(payload || {});
  }

  @Post("kf/contact-way")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  createCustomerEntryContactWay() {
    return this.wechatWork.createCustomerEntryContactWay();
  }

  @Post("kf/contact-ways/bind-all")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  bindAllCustomerEntryContactWays() {
    return this.wechatWork.bindAllCustomerEntryContactWays();
  }

  @Post("kf/contact-way/import")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  importCustomerEntryContactWay(@Body() payload: { url?: string }) {
    return this.wechatWork.importCustomerEntryContactWay(payload || {});
  }

  @Get("kf/contact-way")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  getCustomerEntryContactWay() {
    return this.wechatWork.getCustomerEntryContactWay();
  }

  @Get("kf/upgrade-service/config")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  getUpgradeServiceConfig() {
    return this.wechatWork.getUpgradeServiceConfig();
  }

  @Post("kf/customers/upgrade-service")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  upgradeCustomerToMemberService(@Body() payload: {
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
    memberUserId?: string;
    wording?: string;
    requestId?: string;
  }) {
    return this.wechatWork.upgradeCustomerToMemberService(payload || {});
  }

  @Post("kf/send-text")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  sendCustomerServiceText(
    @Body() payload: { externalUserId?: string; openKfid?: string; text?: string; requestId?: string },
  ) {
    return this.wechatWork.queueCustomerServiceText(payload || {});
  }

  @Post("kf/customers/refresh-profile")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  refreshCustomerProfile(
    @Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string },
  ) {
    return this.wechatWork.refreshCustomerProfile(payload || {});
  }

  @Post("kf/send-images")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  sendCustomerServiceImages(
    @Body() payload: { externalUserId?: string; openKfid?: string; text?: string; imagePaths?: string[]; designJobId?: string; requestId?: string },
  ) {
    return this.wechatWork.queueCustomerServiceImages(payload || {});
  }

  @Post("kf/send-tasks/:id/dispatch")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  dispatchCustomerServiceText(@Param("id") id: string) {
    return this.wechatWork.dispatchCustomerServiceText(id);
  }

  @Get("kf/audit")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  listAuditLogs(@Query("limit") limit?: string) {
    return this.wechatWork.listAuditLogs(limit ? Number(limit) : undefined);
  }
}
