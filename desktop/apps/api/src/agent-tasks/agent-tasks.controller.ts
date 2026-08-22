import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
} from "../operator-access/operator-access.guard";
import { WechatPersistence } from "../wechat/wechat-persistence";
import { AgentTaskToolExecutorService } from "./agent-task-tool-executor.service";
import { AgentTaskApprovalDecisionPayload, AgentTaskToolExecutionPayload } from "./agent-tasks.types";
import { TrustedOperator } from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

/**
 * Read-only operations contract for Agent task visibility.
 * Mutations stay inside the inbound workflow so console users cannot bypass
 * tool policies or approval gates by editing a task directly.
 */
@Controller("agent-tasks")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AgentTasksController {
  constructor(
    private readonly persistence: WechatPersistence,
    private readonly toolExecutor: AgentTaskToolExecutorService,
  ) {}

  @Get()
  list(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.persistence.listAgentTasks({
      status: status || undefined,
      limit: Number(limit || 100),
      wechatAccountId: wechatAccountId || undefined,
      conversationId: conversationId || undefined,
      customerId: customerId || undefined,
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.persistence.getAgentTask(id);
  }

  @Post(":id/approvals/:approvalId/decision")
  @RequireOperatorCapability("approve_send")
  decideApproval(
    @Param("id") id: string,
    @Param("approvalId") approvalId: string,
    @Body() payload: AgentTaskApprovalDecisionPayload = {},
  ) {
    return this.persistence.decideAgentTaskApproval(id, approvalId, payload);
  }

  @Post(":id/tool-executions/:executionId/execute")
  @RequireOperatorCapability("execute_agent_skills")
  executeReadTool(
    @Param("id") id: string,
    @Param("executionId") executionId: string,
    @Body() payload: AgentTaskToolExecutionPayload = {},
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.toolExecutor.execute(id, executionId, payload, principal.id);
  }

  @Post(":id/tool-executions/:executionId/preview")
  @RequireOperatorCapability("execute_agent_skills")
  previewWriteTool(
    @Param("id") id: string,
    @Param("executionId") executionId: string,
    @Body() payload: AgentTaskToolExecutionPayload = {},
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.toolExecutor.preview(id, executionId, payload, principal.id);
  }

  @Post(":id/tool-executions/:executionId/verify")
  @RequireOperatorCapability("execute_agent_skills")
  verifyTool(
    @Param("id") id: string,
    @Param("executionId") executionId: string,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.toolExecutor.verify(id, executionId, principal.id);
  }
}
