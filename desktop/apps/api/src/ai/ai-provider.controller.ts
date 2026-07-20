import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AiProviderService } from "./ai-provider.service";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("ai/providers")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AiProviderController {
  constructor(private readonly providers: AiProviderService) {}

  @Get("status")
  getStatus(@Query("probe") probe?: string) {
    return this.providers.getStatus(["1", "true", "yes", "on"].includes(String(probe || "").toLowerCase()));
  }
}
