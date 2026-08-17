import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";
import { AgentSkillExecutorService } from "./agent-skill-executor.service";

@Controller("agents")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly skillExecutor: AgentSkillExecutorService,
  ) {}

  @Get()
  listAgents(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.agents.listAgents({ wechatAccountId, conversationId, customerId });
  }

  @Get(":id/skills")
  listSkills(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.agents.listSkills(id, { wechatAccountId, conversationId, customerId });
  }

  @Get(":id/skills/:skillId/executions")
  listSkillExecutions(
    @Param("id") id: string,
    @Param("skillId") skillId: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.skillExecutor.listExecutions(
      id,
      skillId,
      { wechatAccountId, conversationId, customerId },
    );
  }

  @Post(":id/skills/:skillId/execute")
  @RequireOperatorCapability("execute_agent_skills")
  executeSkill(
    @Param("id") id: string,
    @Param("skillId") skillId: string,
    @Body() payload: Record<string, unknown>,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.skillExecutor.execute(id, skillId, payload, principal.id);
  }
}
