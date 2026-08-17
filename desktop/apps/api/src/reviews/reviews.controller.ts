import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

@Controller("reviews")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.reviews.list({ wechatAccountId, conversationId, customerId });
  }

  @Get("design-jobs/:id")
  getDesignJob(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.reviews.getDesignJob(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Get("quotes/:id")
  getQuote(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.reviews.getQuote(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Get("orders/:id")
  getOrder(
    @Param("id") id: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.reviews.getOrder(id, {
      expectedWechatAccountId: wechatAccountId,
      expectedConversationId: conversationId,
      expectedCustomerId: customerId,
    });
  }

  @Post("design-jobs/:id")
  @RequireOperatorCapability("approve_send")
  reviewDesignJob(
    @Param("id") id: string,
    @Body() payload: { decision: string; reviewer?: string; note?: string; operationKey?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload || { decision: "approve_images" };
    return this.reviews.reviewDesignJob(id, { ...trustedPayload, reviewer: principal.id });
  }

  @Post("quotes/:id")
  @RequireOperatorCapability("approve_send")
  reviewQuote(
    @Param("id") id: string,
    @Body() payload: { decision: string; reviewer?: string; note?: string; operationKey?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload || { decision: "approve_quote" };
    return this.reviews.reviewQuote(id, { ...trustedPayload, reviewer: principal.id });
  }

  @Post("orders/:id")
  @RequireOperatorCapability("approve_send")
  reviewOrder(
    @Param("id") id: string,
    @Body()
    payload: {
      decision: "approve_confirmation" | "approve_followup" | "request_followup" | "reject_order";
      reviewer?: string;
      note?: string;
      followupType?: "production" | "delivery";
      operationKey?: string;
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload || { decision: "request_followup" as const };
    return this.reviews.reviewOrder(id, { ...trustedPayload, reviewer: principal.id });
  }
}
