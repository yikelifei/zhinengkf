import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { QuotesService } from "./quotes.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

@Controller("quotes")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.quotes.list({ wechatAccountId, conversationId, customerId });
  }

  @Get(":id/preview")
  preview(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.quotes.preview(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Post(":id/update")
  @RequireOperatorCapability("manage_design_executions")
  update(
    @Param("id") id: string,
    @Body()
    payload: {
      status?: string;
      customerNotes?: string;
      owner?: string;
      quantity?: number | string;
      unitPrice?: number | string;
      totalCost?: number | string;
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.quotes.update(id, { ...trustedPayload, owner: principal.id });
  }

  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  reviseSelection(
    @Param("id") id: string,
    @Body()
    payload: {
      selectedImageId?: string;
      owner?: string;
      note?: string;
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.quotes.reviseSelectedImage(id, { ...trustedPayload, owner: principal.id });
  }

  @Post(":id/queue-send")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  queueSend(
    @Param("id") id: string,
    @Body() payload: { owner?: string; note?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.quotes.queueSend(id, {
      ...trustedPayload,
      owner: principal.id,
      releaseManualLock: true,
      releaseReason: "manual_quote_send",
    });
  }

  @Post(":id/verify-payment-proof")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  verifyPaymentProof(
    @Param("id") id: string,
    @Body()
    payload: {
      paymentStatus?: "deposit_paid" | "paid";
      owner?: string;
      note?: string;
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const {
      owner: _untrustedOwner,
      actor: _untrustedActor,
      operator: _untrustedOperator,
      reviewer: _untrustedReviewer,
      ...trustedPayload
    } = (payload || {}) as typeof payload & { actor?: unknown; operator?: unknown; reviewer?: unknown };
    return this.quotes.verifyPaymentProofAndQueueConfirmation(id, { ...trustedPayload, owner: principal.id });
  }
}
