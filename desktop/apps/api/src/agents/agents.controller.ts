import { Controller, Get, Param } from "@nestjs/common";
import { AgentsService } from "./agents.service";

@Controller("agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  listAgents() {
    return this.agents.listAgents();
  }

  @Get(":id/skills")
  listSkills(@Param("id") id: string) {
    return this.agents.listSkills(id);
  }
}
