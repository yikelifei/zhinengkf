import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";
import { AutomationSchedulerService } from "./automation-scheduler.service";
import { AutomationService } from "./automation.service";

@Controller("automation")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AutomationController {
  constructor(
    private readonly automation: AutomationService,
    private readonly scheduler: AutomationSchedulerService,
  ) {}

  @Get("status")
  status() {
    return this.scheduler.status();
  }

  @Get("readiness")
  readiness() {
    return this.scheduler.readiness();
  }

  @Post("run-once")
  @RequireOperatorCapability("approve_send")
  runOnce(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.automation.runOnce("manual", payload || {});
  }

  @Post("start")
  @RequireOperatorCapability("approve_send")
  start() {
    return this.scheduler.start();
  }

  @Post("stop")
  @RequireOperatorCapability("approve_send")
  stop() {
    return this.scheduler.stop();
  }
}
