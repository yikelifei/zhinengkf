import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { appConfig } from "../shared/app-config";
import { PrismaOperationsService } from "../prisma/prisma-operations.service";
import { agentSkillExecutionPolicy } from "./agent-skill-actions";

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
    const result = appConfig.useLocalStore
      ? this.localStore.listAgents(filter)
      : this.requirePrisma().listAgents(filter);
    return mapMaybePromise(result, (agents) =>
      agents.map((agent: any) => ({
        ...agent,
        skills: Array.isArray(agent.skills)
          ? agent.skills.map((skill: any) => decorateAgentSkill({
              ...skill,
              agentKey: agent.key,
            }))
          : [],
      })),
    );
  }

  listSkills(agentId?: string, filter: IdentityFilter = {}) {
    const result = appConfig.useLocalStore
      ? this.localStore.listAgentSkills(agentId, filter)
      : this.requirePrisma().listAgentSkills(agentId, filter);
    return mapMaybePromise(result, (skills) => skills.map(decorateAgentSkill));
  }

  private requirePrisma() {
    if (!this.prismaOperations) throw new Error("PrismaOperationsService is required when USE_LOCAL_STORE=false");
    return this.prismaOperations;
  }
}

function decorateAgentSkill<T extends {
  id: string;
  agentId?: string;
  agentKey?: string;
  name?: string;
  enabled?: boolean;
}>(skill: T) {
  return {
    ...skill,
    executionPolicy: agentSkillExecutionPolicy(skill),
  };
}

function mapMaybePromise<T, R>(value: T | Promise<T>, map: (resolved: T) => R): R | Promise<R> {
  return value instanceof Promise ? value.then(map) : map(value);
}
