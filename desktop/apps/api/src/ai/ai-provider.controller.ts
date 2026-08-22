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

  @Post("server-env")
  @RequireOperatorCapability("manage_channels")
  generateServerEnv() {
    return this.providers.generateServerEnvFile();
  }

  @Post(":provider/test")
  @RequireOperatorCapability("manage_channels")
  testProviderResponse(@Param("provider") provider: string) {
    return this.providers.testProviderResponse(provider);
  }

  @Post(":provider/balance")
  @RequireOperatorCapability("manage_channels")
  getProviderBalance(@Param("provider") provider: string) {
    return this.providers.getProviderBalance(provider);
  }

  @Post(":provider/models/sync")
  @RequireOperatorCapability("manage_channels")
  syncProviderModels(@Param("provider") provider: string) {
    return this.providers.syncProviderModels(provider);
  }

  @Post(":provider/credential")
  @RequireOperatorCapability("manage_channels")
  saveProviderCredential(
    @Param("provider") provider: string,
    @Body() payload: { apiKey?: string; baseUrl?: string; model?: string; enabled?: boolean } = {},
  ) {
    return this.providers.saveProviderCredential({ provider, ...(payload || {}) });
  }

  @Post(":provider/billing-credential")
  @RequireOperatorCapability("manage_channels")
  saveProviderBillingCredential(
    @Param("provider") provider: string,
    @Body() payload: { accessKeyId?: string; accessKeySecret?: string; adminKey?: string } = {},
  ) {
    return this.providers.saveProviderBillingCredential({ provider, ...(payload || {}) });
  }
}
