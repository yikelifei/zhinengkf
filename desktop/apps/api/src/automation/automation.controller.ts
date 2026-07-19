import { Body, Controller, Get, Post } from "@nestjs/common";
import { AutomationSchedulerService } from "./automation-scheduler.service";
import { AutomationService } from "./automation.service";

@Controller("automation")
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
  runOnce(@Body() payload: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.automation.runOnce("manual", payload || {});
  }

  @Post("start")
  start() {
    return this.scheduler.start();
  }

  @Post("stop")
  stop() {
    return this.scheduler.stop();
  }
}
