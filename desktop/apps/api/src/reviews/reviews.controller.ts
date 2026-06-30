import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("reviews")
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

  @Post("design-jobs/:id")
  reviewDesignJob(
    @Param("id") id: string,
    @Body() payload: { decision: string; reviewer?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    return this.reviews.reviewDesignJob(id, payload || { decision: "approve_images" });
  }

  @Post("quotes/:id")
  reviewQuote(
    @Param("id") id: string,
    @Body() payload: { decision: string; reviewer?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    return this.reviews.reviewQuote(id, payload || { decision: "approve_quote" });
  }
}
