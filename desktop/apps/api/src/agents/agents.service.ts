import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { appConfig } from "../shared/app-config";

@Injectable()
export class AgentsService {
  constructor(private readonly localStore: LocalStoreService) {}

  listAgents() {
    if (!appConfig.useLocalStore) throw new Error("agents prisma mode is not implemented yet");
    return this.localStore.listAgents();
  }

  listSkills(agentId?: string) {
    if (!appConfig.useLocalStore) throw new Error("agent skills prisma mode is not implemented yet");
    return this.localStore.listAgentSkills(agentId);
  }
}
