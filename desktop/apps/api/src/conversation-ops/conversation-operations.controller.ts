import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";
import { ConversationOperationsService } from "./conversation-operations.service";
import { ConversationOperationsQuery, ConversationOperationsUpdatePayload } from "./conversation-operations.types";

@Controller("conversation-ops")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class ConversationOperationsController {
  constructor(private readonly operations: ConversationOperationsService) {}

  @Get("queue")
  listQueue(@Query() query: ConversationOperationsQuery = {}) {
    return this.operations.listQueue(query);
  }

  @Get("queue/summary")
  getQueueSummary(@Query() query: ConversationOperationsQuery = {}) {
    return this.operations.getQueueSummary(query);
  }

  @Get("conversations/:id")
  getConversation(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.operations.getConversation({ wechatAccountId: wechatAccountId || "", conversationId: id, customerId: customerId || "" });
  }

  @Get("conversations/:id/audit")
  listAudit(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("customerId") customerId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.operations.listAudit(
      { wechatAccountId: wechatAccountId || "", conversationId: id, customerId: customerId || "" },
      Number(limit || 100),
    );
  }

  @Patch("conversations/:id")
  @RequireOperatorCapability("manage_assignments")
  @UseGuards(OperatorAccessGuard)
  updateConversation(
    @Param("id") id: string,
    @Body() payload: ConversationOperationsUpdatePayload = {},
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.operations.updateConversation(id, { ...payload, operator: principal.id });
  }
}
