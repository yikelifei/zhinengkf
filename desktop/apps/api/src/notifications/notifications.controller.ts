import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("notifications")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query("unreadOnly") unreadOnly?: string,
    @Query("limit") limit?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.notifications.list({
      unreadOnly: unreadOnly === "true",
      limit: Number(limit || 80),
      wechatAccountId,
      conversationId,
      customerId,
    });
  }

  @Post("read-all")
  markAllRead(@Body() body: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    return this.notifications.markAllRead({
      wechatAccountId: body?.wechatAccountId,
      conversationId: body?.conversationId,
      customerId: body?.customerId,
    });
  }

  @Post(":id/read")
  markRead(@Param("id") id: string, @Body() body: ExpectedIdentityPayload = {}) {
    return this.notifications.markRead(id, body || {});
  }

  @Post("demo")
  @RequireOperatorCapability("manage_training")
  createDemo(@Body() body: { level?: string; title?: string; body?: string }) {
    return this.notifications.createDemo(
      body?.level || "info",
      body?.title || "演示提醒",
      body?.body || "这是一条站内提醒演示，用来验证提醒中心的读取和已读流程。",
    );
  }
}
