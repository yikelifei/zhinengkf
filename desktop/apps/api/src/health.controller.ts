import { Controller, Get } from "@nestjs/common";
import { LocalStoreService } from "./local-store/local-store.service";
import { appConfig } from "./shared/app-config";

@Controller("health")
export class HealthController {
  constructor(private readonly localStore: LocalStoreService) {}

  @Get()
  health() {
    return {
      ok: true,
      service: "smart-kefu-desktop-api",
      dataMode: appConfig.useLocalStore ? "local-json" : "prisma",
      localStore: appConfig.useLocalStore ? this.localStore.health() : undefined,
      time: new Date().toISOString(),
    };
  }
}
