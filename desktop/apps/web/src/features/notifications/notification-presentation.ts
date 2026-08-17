import type { NotificationItem } from "../../lib/api";

export type NotificationDisplayGroup = {
  notification: NotificationItem;
  notifications: NotificationItem[];
  occurrenceCount: number;
  unreadCount: number;
  hasMixedTargets: boolean;
  oldestCreatedAt: string;
  newestCreatedAt: string;
};

const KNOWN_SEND_TASK_SCHEMA_ERROR = /Unknown argument\s+[`'"]?sendTaskId/i;
const STACK_TRACE_MARKERS = /PrismaClient(?:Validation|KnownRequest)?Error|Invalid\s+[`'"]?.+?\.\w+\(\)\s+invocation|\n\s*at\s+\S+/i;

export function notificationBodyForOperator(body?: string | null) {
  const value = String(body || "").replace(/\r\n?/g, "\n").trim();
  if (!value) return "服务端未提供补充说明。";
  if (KNOWN_SEND_TASK_SCHEMA_ERROR.test(value)) {
    return "旧版本任务状态写入失败：sendTaskId 字段与当时的数据库模型不兼容。服务端技术堆栈已隐藏，请根据通知时间和关联任务复核最新状态。";
  }
  if (STACK_TRACE_MARKERS.test(value)) {
    const summary = value
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !/^at\s+/.test(line) && !/Invalid\s+[`'"]?.+?\.\w+\(\)\s+invocation/i.test(line));
    const safeSummary = sanitizeTechnicalDetails(summary || "后台任务处理失败");
    return `${truncate(safeSummary, 180)}。服务端技术堆栈已隐藏，请进入关联责任页复核。`;
  }
  return truncate(sanitizeTechnicalDetails(value.replace(/\s+/g, " ")), 320);
}

export function groupNotificationsForDisplay(notifications: readonly NotificationItem[]): NotificationDisplayGroup[] {
  const groups = new Map<string, NotificationDisplayGroup>();
  for (const notification of notifications) {
    const key = notificationGroupKey(notification);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        notification,
        notifications: [notification],
        occurrenceCount: 1,
        unreadCount: notification.readAt ? 0 : 1,
        hasMixedTargets: false,
        oldestCreatedAt: notification.createdAt,
        newestCreatedAt: notification.createdAt,
      });
      continue;
    }
    current.notifications.push(notification);
    current.occurrenceCount += 1;
    current.unreadCount += notification.readAt ? 0 : 1;
    current.hasMixedTargets = current.hasMixedTargets
      || stableTarget(notification.target || {}) !== stableTarget(current.notification.target || {});
    if (dateValue(notification.createdAt) < dateValue(current.oldestCreatedAt)) current.oldestCreatedAt = notification.createdAt;
    if (dateValue(notification.createdAt) > dateValue(current.newestCreatedAt)) {
      current.newestCreatedAt = notification.createdAt;
      current.notification = notification;
    }
  }
  return [...groups.values()];
}

function notificationGroupKey(notification: NotificationItem) {
  const operatorBody = notificationBodyForOperator(notification.body);
  const knownRepeatedBackendError = KNOWN_SEND_TASK_SCHEMA_ERROR.test(String(notification.body || ""));
  return [
    notification.title.trim(),
    notification.level,
    operatorBody,
    knownRepeatedBackendError ? "known-backend-error" : stableTarget(notification.target || {}),
  ].join("|");
}

function stableTarget(target: Record<string, unknown>) {
  return Object.entries(target)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(",");
}

function sanitizeTechnicalDetails(value: string) {
  return value
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s:]+[\\/])+[^\s:]+/g, "[服务端路径]")
    .replace(/\b(?:file:\/\/)?[^\s]+\.(?:ts|js):\d+(?::\d+)?\b/g, "[服务端代码位置]")
    .replace(/\s+([，。！？；：])/g, "$1")
    .trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function dateValue(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
