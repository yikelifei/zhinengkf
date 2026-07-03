import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { appConfig } from "../shared/app-config";

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

@Injectable()
export class AgentsService {
  constructor(private readonly localStore: LocalStoreService) {}

  listAgents(filter: IdentityFilter = {}) {
    if (!appConfig.useLocalStore) throw new Error("agents prisma mode is not implemented yet");
    return this.localStore.listAgents(filter);
  }

  listSkills(agentId?: string, filter: IdentityFilter = {}) {
    if (!appConfig.useLocalStore) throw new Error("agent skills prisma mode is not implemented yet");
    return this.localStore.listAgentSkills(agentId, filter);
  }
}
