import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { RoutingService } from "./routing.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("routing")
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
  evaluate(@Body() payload: { text: string; channel?: "wechat" | "xiaohongshu" | "douyin"; customerId?: string; conversationId?: string; wechatAccountId?: string }) {
    return this.routing.evaluate(payload);
  }

  @Post("evaluations/:id/correct")
  correctEvaluation(
    @Param("id") id: string,
    @Body() payload: { agentKey: string; scene?: string; reviewer?: string; note?: string; idealReply?: string } & ExpectedIdentityPayload,
  ) {
    return this.routing.correctEvaluation(id, payload);
  }
}
