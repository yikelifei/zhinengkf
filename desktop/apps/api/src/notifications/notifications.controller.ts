import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query("unreadOnly") unreadOnly?: string, @Query("limit") limit?: string) {
    return this.notifications.list({
      unreadOnly: unreadOnly === "true",
      limit: Number(limit || 80),
    });
  }

  @Post("read-all")
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(":id/read")
  markRead(@Param("id") id: string) {
    return this.notifications.markRead(id);
  }

  @Post("demo")
  createDemo(@Body() body: { level?: string; title?: string; body?: string }) {
    return this.notifications.create(
      body?.level || "info",
      body?.title || "演示提醒",
      body?.body || "这是一条站内提醒演示，用来验证提醒中心的读取和已读流程。",
      { source: "demo" },
    );
  }
}
