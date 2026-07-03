import { Controller, Get, Param, Query } from "@nestjs/common";
import { AgentsService } from "./agents.service";

@Controller("agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

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
}
