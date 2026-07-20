import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

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
    @Body() payload: { status?: string; customerNotes?: string; owner?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.orders.update(id, { ...trustedPayload, owner: principal.id });
  }

  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  reviseSelection(
    @Param("id") id: string,
    @Body() payload: { selectedImageId?: string; owner?: string; note?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.orders.reviseSelectedImage(id, { ...trustedPayload, owner: principal.id });
  }
}
