import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";
import {
  PersonalWechatRpaInboundPayload,
  PersonalWechatRpaInstanceInput,
  PersonalWechatRpaService,
} from "./personal-wechat-rpa.service";

@Controller("personal-wechat-rpa")
export class PersonalWechatRpaController {
  constructor(private readonly personalWechatRpa: PersonalWechatRpaService) {}

  @Get("status")
  getStatus(@Headers("x-personal-wechat-rpa-token") token?: string) {
    return this.personalWechatRpa.getStatus(token);
  }

  @Get("instances")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  listInstances() {
    return this.personalWechatRpa.getRegistry();
  }

  @Post("instances/validate")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  validateInstance(@Body() payload: PersonalWechatRpaInstanceInput) {
    return this.personalWechatRpa.validateInstance(payload || {});
  }

  @Post("instances")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  upsertInstance(@Body() payload: PersonalWechatRpaInstanceInput) {
    return this.personalWechatRpa.upsertInstance(payload || {});
  }

  @Post("instances/:wechatAccountId/disable")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  disableInstance(@Param("wechatAccountId") wechatAccountId: string) {
    return this.personalWechatRpa.disableInstance(wechatAccountId);
  }

  @Post("inbound")
  processInbound(
    @Body() payload: PersonalWechatRpaInboundPayload,
    @Headers("x-personal-wechat-rpa-token") token?: string,
  ) {
    return this.personalWechatRpa.processInbound(payload || {}, token);
  }
}
