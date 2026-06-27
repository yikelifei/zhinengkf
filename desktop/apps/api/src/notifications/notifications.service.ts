import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
  ) {}

  create(level: string, title: string, body?: string, target?: Record<string, unknown>) {
    if (appConfig.useLocalStore) return this.localStore.createNotification(level, title, body, target);
    return this.prisma.notification.create({
      data: {
        level,
        title,
        body,
        target: (target || {}) as any,
      },
    });
  }

  list(options: { unreadOnly?: boolean; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 300));
    if (appConfig.useLocalStore) return this.localStore.listNotifications({ ...options, limit });
    return this.prisma.notification.findMany({
      where: options.unreadOnly ? { readAt: null } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  markRead(id: string) {
    if (appConfig.useLocalStore) return this.localStore.markNotificationRead(id);
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead() {
    if (appConfig.useLocalStore) return this.localStore.markAllNotificationsRead();
    const result = await this.prisma.notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
