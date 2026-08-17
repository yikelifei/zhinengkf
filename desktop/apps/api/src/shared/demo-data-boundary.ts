import { ForbiddenException } from "@nestjs/common";
import { appConfig } from "./app-config";

export const DEMO_DATA_MUTATION_BLOCKED_CODE = "demo_data_mutation_disabled";

export function assertDemoDataMutationAllowed(label = "demo data mutation") {
  if (appConfig.allowDemoDataMutations) return;
  throw new ForbiddenException({
    code: DEMO_DATA_MUTATION_BLOCKED_CODE,
    message: `${label} is disabled outside local demo or acceptance mode`,
  });
}
