import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";

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

  list(options: { unreadOnly?: boolean; limit?: number; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 300));
    if (appConfig.useLocalStore) return this.localStore.listNotifications({ ...options, limit });
    return this.prisma.notification.findMany({
      where: options.unreadOnly ? { readAt: null } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async markRead(id: string, expected: ExpectedIdentityPayload = {}) {
    if (appConfig.useLocalStore) return this.localStore.markNotificationRead(id, {
      wechatAccountId: expected.expectedWechatAccountId,
      conversationId: expected.expectedConversationId,
      customerId: expected.expectedCustomerId,
    });
    const notice = await this.prisma.notification.findUnique({ where: { id } });
    if (!notice) throw new Error(`notification not found: ${id}`);
    assertExpectedIdentity(notice, expected, "notification");
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) return this.localStore.markAllNotificationsRead(filter);
    if (filter.wechatAccountId || filter.conversationId || filter.customerId) {
      const rows = await this.prisma.notification.findMany({
        where: { readAt: null },
        select: { id: true, target: true },
      });
      const ids = rows
        .filter((row) => this.matchesTargetIdentity(row.target, filter))
        .map((row) => row.id);
      if (!ids.length) return { count: 0 };
      const result = await this.prisma.notification.updateMany({
        where: { id: { in: ids } },
        data: { readAt: new Date() },
      });
      return { count: result.count };
    }
    const result = await this.prisma.notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  private matchesTargetIdentity(
    target: unknown,
    filter: { wechatAccountId?: string; conversationId?: string; customerId?: string } = {},
  ) {
    const record = target && typeof target === "object" ? (target as Record<string, unknown>) : {};
    if (filter.wechatAccountId && String(record.wechatAccountId || "") !== String(filter.wechatAccountId)) return false;
    if (filter.conversationId && String(record.conversationId || "") !== String(filter.conversationId)) return false;
    if (filter.customerId && String(record.customerId || "") !== String(filter.customerId)) return false;
    return true;
  }
}
