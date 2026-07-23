import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AutomationService } from "./automation.service";

@Controller("automation")
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get("status")
  status() {
    return this.automation.status();
  }

  @Get("readiness")
  readiness(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.automation.readiness({ wechatAccountId, conversationId, customerId });
  }

  @Post("run-once")
  runOnce(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.automation.runOnce("manual", payload || {});
  }

  @Post("start")
  start(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.automation.start(payload || {});
  }

  @Post("stop")
  stop() {
    return this.automation.stop();
  }
}
