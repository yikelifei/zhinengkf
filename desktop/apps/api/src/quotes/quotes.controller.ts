import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { QuotesService } from "./quotes.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("quotes")
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
  preview(@Param("id") id: string) {
    return this.quotes.preview(id);
  }

  @Post(":id/update")
  update(
    @Param("id") id: string,
    @Body()
    payload: {
      status?: string;
      paymentStatus?: string;
      customerNotes?: string;
      owner?: string;
      quantity?: number | string;
      unitPrice?: number | string;
      totalCost?: number | string;
    } & ExpectedIdentityPayload,
  ) {
    return this.quotes.update(id, payload || {});
  }

  @Post(":id/revise-selection")
  reviseSelection(
    @Param("id") id: string,
    @Body()
    payload: {
      selectedImageId?: string;
      owner?: string;
      note?: string;
    } & ExpectedIdentityPayload,
  ) {
    return this.quotes.reviseSelectedImage(id, payload || {});
  }

  @Post(":id/queue-send")
  queueSend(
    @Param("id") id: string,
    @Body() payload: { owner?: string; note?: string } & ExpectedIdentityPayload,
  ) {
    return this.quotes.queueSend(id, {
      ...(payload || {}),
      releaseManualLock: true,
      releaseReason: "manual_quote_send",
    });
  }
}
