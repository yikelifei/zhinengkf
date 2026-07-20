import { Controller, Get, Headers } from "@nestjs/common";
import { LocalStoreService } from "./local-store/local-store.service";
import { appConfig } from "./shared/app-config";

const {
  API_READINESS_PROOF_FIELD,
  READINESS_CHALLENGE_HEADER,
  createApiReadinessProof,
} = require("../../../packages/runtime/packaged-readiness-proof");

@Controller("health")
export class HealthController {
  constructor(private readonly localStore: LocalStoreService) {}

  @Get()
  health(@Headers(READINESS_CHALLENGE_HEADER) readinessChallenge?: string) {
    const apiReadinessProof = createApiReadinessProof(appConfig.internalApiToken, readinessChallenge);
    return {
      ok: true,
      service: "smart-kefu-desktop-api",
      dataMode: appConfig.useLocalStore ? "local-json" : "prisma",
      localStore: appConfig.useLocalStore ? this.localStore.health() : undefined,
      time: new Date().toISOString(),
      ...(apiReadinessProof ? { [API_READINESS_PROOF_FIELD]: apiReadinessProof } : {}),
    };
  }
}
