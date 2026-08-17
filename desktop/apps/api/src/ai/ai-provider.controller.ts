import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AiProviderService } from "./ai-provider.service";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("ai/providers")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AiProviderController {
  constructor(private readonly providers: AiProviderService) {}

  @Get("status")
  getStatus() {
    return this.providers.getStatus(false);
  }

  @Post("status/probe")
  @RequireOperatorCapability("manage_channels")
  probeStatus() {
    return this.providers.getStatus(true);
  }

  @Post(":provider/credential")
  @RequireOperatorCapability("manage_channels")
  saveProviderCredential(
    @Param("provider") provider: string,
    @Body() payload: { apiKey?: string; model?: string; enabled?: boolean } = {},
  ) {
    return this.providers.saveProviderCredential({ provider, ...(payload || {}) });
  }
}
