import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { RoutingService } from "./routing.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

@Controller("routing")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get("evaluations")
  list(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.routing.list({ wechatAccountId, conversationId, customerId });
  }

  @Post("evaluate")
  @RequireOperatorCapability("manage_training")
  evaluate(@Body() payload: { text: string; channel?: "wechat" | "xiaohongshu" | "douyin"; customerId?: string; conversationId?: string; wechatAccountId?: string }) {
    return this.routing.evaluate(payload);
  }

  @Post("evaluations/:id/correct")
  @RequireOperatorCapability("manage_training")
  correctEvaluation(
    @Param("id") id: string,
    @Body() payload: { agentKey: string; scene?: string; reviewer?: string; note?: string; idealReply?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload;
    return this.routing.correctEvaluation(id, { ...trustedPayload, reviewer: principal.id });
  }
}
