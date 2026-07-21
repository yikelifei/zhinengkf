import { BadRequestException } from "@nestjs/common";
import { createOperationFingerprint } from "./operation-idempotency";

export function assertNotificationEffectReplay(
  existing: any,
  expected: { level: string; title: string; body?: string; target?: Record<string, unknown> },
) {
  const actualFingerprint = notificationEffectFingerprint({
    level: existing?.level,
    title: existing?.title,
    body: existing?.body,
    target: existing?.target,
  });
  const expectedFingerprint = notificationEffectFingerprint(expected);
  if (actualFingerprint !== expectedFingerprint) {
    throw new BadRequestException("notification effectKey replay changed identity or business payload");
  }
  return existing;
}

function notificationEffectFingerprint(value: {
  level?: unknown;
  title?: unknown;
  body?: unknown;
  target?: unknown;
}) {
  return createOperationFingerprint("notification-effect", {}, {
    level: String(value.level || ""),
    title: String(value.title || ""),
    body: value.body === undefined || value.body === null ? null : String(value.body),
    target: notificationBusinessTarget(value.target),
  });
}

function notificationBusinessTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { identityBinding: _derivedIdentityBinding, ...businessTarget } = value as Record<string, unknown>;
  return businessTarget;
}
