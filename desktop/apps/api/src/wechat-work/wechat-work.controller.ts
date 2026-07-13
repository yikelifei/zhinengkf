import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { WechatWorkService } from "./wechat-work.service";

@Controller("wechat-work")
export class WechatWorkController {
  constructor(private readonly wechatWork: WechatWorkService) {}

  @Get("status")
  getStatus() {
    return this.wechatWork.getStatus();
  }

  @Get("callback")
  verifyCallback(@Query() query: Record<string, string>) {
    return this.wechatWork.verifyCallback(query);
  }

  @Post("callback")
  handleCallback(@Query() query: Record<string, string>, @Body() body: unknown) {
    return this.wechatWork.handleCallback(query, body);
  }

  @Post("kf/sync")
  syncCustomerServiceMessages(@Body() payload: { token?: string; cursor?: string; limit?: number }) {
    return this.wechatWork.syncCustomerServiceMessages(payload || {});
  }

  @Post("kf/send-text")
  sendCustomerServiceText(@Body() payload: { externalUserId?: string; openKfid?: string; text?: string }) {
    return this.wechatWork.sendCustomerServiceText(payload || {});
  }
}
