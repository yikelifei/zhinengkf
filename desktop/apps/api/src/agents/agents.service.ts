import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { appConfig } from "../shared/app-config";
import { PrismaOperationsService } from "../prisma/prisma-operations.service";

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

@Injectable()
export class AgentsService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly prismaOperations?: PrismaOperationsService,
  ) {}

  listAgents(filter: IdentityFilter = {}) {
    return appConfig.useLocalStore
      ? this.localStore.listAgents(filter)
      : this.requirePrisma().listAgents(filter);
  }

  listSkills(agentId?: string, filter: IdentityFilter = {}) {
    return appConfig.useLocalStore
      ? this.localStore.listAgentSkills(agentId, filter)
      : this.requirePrisma().listAgentSkills(agentId, filter);
  }

  private requirePrisma() {
    if (!this.prismaOperations) throw new Error("PrismaOperationsService is required when USE_LOCAL_STORE=false");
    return this.prismaOperations;
  }
}
