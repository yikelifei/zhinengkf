import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("orders")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
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

  @Get(":id/confirmation-preview")
  confirmationPreview(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.orders.confirmationPreview(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Post("from-quote/:quoteId")
  @RequireOperatorCapability("manage_design_executions")
  createFromQuote(@Param("quoteId") quoteId: string, @Body() payload: ExpectedIdentityPayload = {}) {
    return this.orders.createFromQuote(quoteId, payload || {});
  }

  @Post(":id/update")
  @RequireOperatorCapability("manage_design_executions")
  update(
    @Param("id") id: string,
    @Body() payload: { status?: string; paymentStatus?: string; customerNotes?: string; owner?: string } & ExpectedIdentityPayload,
  ) {
    return this.orders.update(id, payload || {});
  }

  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  reviseSelection(
    @Param("id") id: string,
    @Body() payload: { selectedImageId?: string; owner?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    return this.orders.reviseSelectedImage(id, payload || {});
  }
}
