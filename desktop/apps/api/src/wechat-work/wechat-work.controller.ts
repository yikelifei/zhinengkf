import { Body, Controller, Get, Header, Param, Post, Query } from "@nestjs/common";
import { WechatWorkService } from "./wechat-work.service";

@Controller("wechat-work")
export class WechatWorkController {
  constructor(private readonly wechatWork: WechatWorkService) {}

  @Get("status")
  getStatus() {
    return this.wechatWork.getStatus();
  }

  @Get("preflight")
  getProductionPreflight() {
    return this.wechatWork.getProductionPreflight();
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
  syncCustomerServiceMessages(@Body() payload: { token?: string; cursor?: string; limit?: number; openKfid?: string }) {
    return this.wechatWork.syncCustomerServiceMessages(payload || {});
  }

  @Post("kf/send-text")
  sendCustomerServiceText(
    @Body() payload: { externalUserId?: string; openKfid?: string; text?: string; requestId?: string },
  ) {
    return this.wechatWork.queueCustomerServiceText(payload || {});
  }

  @Post("kf/send-images")
  sendCustomerServiceImages(
    @Body() payload: { externalUserId?: string; openKfid?: string; text?: string; imagePaths?: string[]; designJobId?: string },
  ) {
    return this.wechatWork.queueCustomerServiceImages(payload || {});
  }

  @Post("kf/send-tasks/:id/dispatch")
  dispatchCustomerServiceText(@Param("id") id: string) {
    return this.wechatWork.dispatchCustomerServiceText(id);
  }

  @Get("kf/audit")
  listAuditLogs(@Query("limit") limit?: string) {
    return this.wechatWork.listAuditLogs(limit ? Number(limit) : undefined);
  }
}
