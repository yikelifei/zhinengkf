import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.orders.list({ wechatAccountId, conversationId, customerId });
  }

  @Post("from-quote/:quoteId")
  createFromQuote(@Param("quoteId") quoteId: string, @Body() payload: ExpectedIdentityPayload = {}) {
    return this.orders.createFromQuote(quoteId, payload || {});
  }

  @Post(":id/update")
  update(
    @Param("id") id: string,
    @Body() payload: { status?: string; paymentStatus?: string; customerNotes?: string; owner?: string } & ExpectedIdentityPayload,
  ) {
    return this.orders.update(id, payload || {});
  }
}
