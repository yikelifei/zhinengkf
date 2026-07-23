import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AiProviderSettingsPatch } from "./ai-provider-config";
import { AiProviderService, publicError } from "./ai-provider.service";

@Controller("ai/providers")
export class AiProviderController {
  constructor(private readonly providers: AiProviderService) {}

  @Get("config")
  getConfig() {
    return this.providers.getConfig();
  }

  @Post("config")
  updateConfig(@Body() body: AiProviderSettingsPatch) {
    try {
      return this.providers.updateConfig(body || {});
    } catch (error) {
      throw new BadRequestException(publicError(error));
    }
  }

  @Post(":id/test")
  async testProvider(@Param("id") id: string) {
    try {
      return await this.providers.testProvider(id);
    } catch (error) {
      throw new BadRequestException(publicError(error));
    }
  }

  @Get("status")
  getStatus(@Query("probe") probe?: string) {
    return this.providers.getStatus(["1", "true", "yes"].includes(String(probe || "").toLowerCase()));
  }
}
