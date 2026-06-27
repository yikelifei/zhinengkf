import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";

@Controller("reviews")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list() {
    return this.reviews.list();
  }

  @Post("design-jobs/:id")
  reviewDesignJob(
    @Param("id") id: string,
    @Body() payload: { decision: string; reviewer?: string; note?: string },
  ) {
    return this.reviews.reviewDesignJob(id, payload || { decision: "approve_images" });
  }

  @Post("quotes/:id")
  reviewQuote(
    @Param("id") id: string,
    @Body() payload: { decision: string; reviewer?: string; note?: string },
  ) {
    return this.reviews.reviewQuote(id, payload || { decision: "approve_quote" });
  }
}
