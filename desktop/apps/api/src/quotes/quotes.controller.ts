import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { QuotesService } from "./quotes.service";

@Controller("quotes")
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list() {
    return this.quotes.list();
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
    },
  ) {
    return this.quotes.update(id, payload || {});
  }

  @Post(":id/queue-send")
  queueSend(
    @Param("id") id: string,
    @Body() payload: { owner?: string; note?: string },
  ) {
    return this.quotes.queueSend(id, {
      ...(payload || {}),
      releaseManualLock: true,
      releaseReason: "manual_quote_send",
    });
  }
}
