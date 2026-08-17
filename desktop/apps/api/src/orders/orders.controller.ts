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

  @Get(":id")
  getById(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.orders.getById(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
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

  @Get(":id/followup-preview")
  followupPreview(
    @Param("id") id: string,
    @Query("type") type?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.orders.followupPreview(id, type === "delivery" ? "delivery" : "production", {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Get(":id/after-sales")
  listAfterSales(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.orders.listAfterSalesCases(id, {
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
    @Body()
    payload: { status?: string; customerNotes?: string; owner?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.orders.update(id, {
      status: payload?.status,
      customerNotes: payload?.customerNotes,
      expectedWechatAccountId: payload?.expectedWechatAccountId,
      expectedConversationId: payload?.expectedConversationId,
      expectedCustomerId: payload?.expectedCustomerId,
      owner: principal.id,
    });
  }

  @Post(":id/fulfillment")
  @RequireOperatorCapability("manage_order_fulfillment")
  updateFulfillment(
    @Param("id") id: string,
    @Body()
    payload: { status?: string; productionStatus?: string; productionDueAt?: string; carrier?: string; trackingNo?: string; shippedAt?: string; deliveredAt?: string; customerNotes?: string; owner?: string; operationKey?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.orders.updateFulfillment(id, {
      status: payload?.status,
      productionStatus: payload?.productionStatus,
      productionDueAt: payload?.productionDueAt,
      carrier: payload?.carrier,
      trackingNo: payload?.trackingNo,
      shippedAt: payload?.shippedAt,
      deliveredAt: payload?.deliveredAt,
      customerNotes: payload?.customerNotes,
      expectedWechatAccountId: payload?.expectedWechatAccountId,
      expectedConversationId: payload?.expectedConversationId,
      expectedCustomerId: payload?.expectedCustomerId,
      operationKey: payload?.operationKey,
      owner: principal.id,
    });
  }

  @Post(":id/after-sales")
  @RequireOperatorCapability("manage_order_fulfillment")
  createAfterSales(
    @Param("id") id: string,
    @Body()
    payload: { operationKey?: string; type?: string; reason?: string; requestedAmountCny?: number | string; evidenceReference?: string; desiredResolution?: string; owner?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.orders.createAfterSalesCase(id, {
      operationKey: trustedPayload?.operationKey,
      type: trustedPayload?.type,
      reason: trustedPayload?.reason,
      requestedAmountCny: trustedPayload?.requestedAmountCny,
      evidenceReference: trustedPayload?.evidenceReference,
      desiredResolution: trustedPayload?.desiredResolution,
      expectedWechatAccountId: trustedPayload?.expectedWechatAccountId,
      expectedConversationId: trustedPayload?.expectedConversationId,
      expectedCustomerId: trustedPayload?.expectedCustomerId,
      owner: principal.id,
    });
  }

  @Post(":id/after-sales/:caseId/resolve")
  @RequireOperatorCapability("manage_order_fulfillment")
  resolveAfterSales(
    @Param("id") id: string,
    @Param("caseId") caseId: string,
    @Body()
    payload: { operationKey?: string; resolutionType?: string; approvedAmountCny?: number | string; refundMethod?: string; refundReference?: string; replacementCarrier?: string; replacementTrackingNo?: string; note?: string; owner?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.orders.resolveAfterSalesCase(id, caseId, {
      operationKey: trustedPayload?.operationKey,
      resolutionType: trustedPayload?.resolutionType,
      approvedAmountCny: trustedPayload?.approvedAmountCny,
      refundMethod: trustedPayload?.refundMethod,
      refundReference: trustedPayload?.refundReference,
      replacementCarrier: trustedPayload?.replacementCarrier,
      replacementTrackingNo: trustedPayload?.replacementTrackingNo,
      note: trustedPayload?.note,
      expectedWechatAccountId: trustedPayload?.expectedWechatAccountId,
      expectedConversationId: trustedPayload?.expectedConversationId,
      expectedCustomerId: trustedPayload?.expectedCustomerId,
      owner: principal.id,
    });
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
