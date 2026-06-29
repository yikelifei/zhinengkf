import { Controller, Get, Post } from "@nestjs/common";
import { AutomationService } from "./automation.service";

@Controller("automation")
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get("status")
  status() {
    return this.automation.status();
  }

  @Get("readiness")
  readiness() {
    return this.automation.readiness();
  }

  @Post("run-once")
  runOnce() {
    return this.automation.runOnce("manual");
  }

  @Post("start")
  start() {
    return this.automation.start();
  }

  @Post("stop")
  stop() {
    return this.automation.stop();
  }
}
