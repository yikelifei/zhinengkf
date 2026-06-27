import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list() {
    return this.orders.list();
  }

  @Post("from-quote/:quoteId")
  createFromQuote(@Param("quoteId") quoteId: string) {
    return this.orders.createFromQuote(quoteId);
  }

  @Post(":id/update")
  update(
    @Param("id") id: string,
    @Body() payload: { status?: string; paymentStatus?: string; customerNotes?: string; owner?: string },
  ) {
    return this.orders.update(id, payload || {});
  }
}
