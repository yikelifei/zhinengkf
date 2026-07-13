import { Controller, Get, Query } from "@nestjs/common";
import { AiProviderService } from "./ai-provider.service";

@Controller("ai/providers")
export class AiProviderController {
  constructor(private readonly providers: AiProviderService) {}

  @Get("status")
  getStatus(@Query("probe") probe?: string) {
    return this.providers.getStatus(["1", "true", "yes", "on"].includes(String(probe || "").toLowerCase()));
  }
}
