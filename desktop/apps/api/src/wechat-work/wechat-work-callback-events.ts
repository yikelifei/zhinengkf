import { Injectable, MessageEvent } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Observable } from "rxjs";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const CALLBACK_EVENT_SCHEMA = "smart_kefu_wechat_work_callback_event_v1";
const CALLBACK_EVENT_PATH = "/api/wechat-work/events/stream";

export const WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER = "x-wechat-work-event-stream-token";

export type WechatWorkCallbackEvent = {
  schema: typeof CALLBACK_EVENT_SCHEMA;
  type: "callback";
  eventId: string;
  openKfid: string | null;
  occurredAt: string;
};

export function callbackEventTokenMatches(configured: unknown, supplied: unknown) {
  const configuredToken = String(configured || "").trim();
  const suppliedToken = String(supplied || "").trim();
  if (!TOKEN_PATTERN.test(configuredToken) || !TOKEN_PATTERN.test(suppliedToken)) return false;
  const configuredBytes = Buffer.from(configuredToken, "utf8");
  const suppliedBytes = Buffer.from(suppliedToken, "utf8");
  return configuredBytes.length === suppliedBytes.length && timingSafeEqual(configuredBytes, suppliedBytes);
}

export function validateRemoteCallbackEventUrl(value: unknown) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("WECHAT_WORK_REMOTE_EVENT_URL must be an absolute HTTPS URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.search
    || parsed.pathname !== CALLBACK_EVENT_PATH
  ) {
    throw new Error(`WECHAT_WORK_REMOTE_EVENT_URL must use the exact HTTPS path ${CALLBACK_EVENT_PATH}`);
  }
  return parsed;
}

export function validCallbackEventToken(value: unknown) {
  return TOKEN_PATTERN.test(String(value || "").trim());
}

export function parseWechatWorkCallbackEvent(value: unknown): WechatWorkCallbackEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.schema !== CALLBACK_EVENT_SCHEMA
    || record.type !== "callback"
    || typeof record.eventId !== "string"
    || !record.eventId
    || (record.openKfid !== null && typeof record.openKfid !== "string")
    || typeof record.occurredAt !== "string"
  ) return null;
  return record as WechatWorkCallbackEvent;
}

@Injectable()
export class WechatWorkCallbackEventRelay {
  private sequence = 0;
  private readonly listeners = new Set<(event: WechatWorkCallbackEvent) => void>();

  publish(openKfid?: string) {
    const event: WechatWorkCallbackEvent = {
      schema: CALLBACK_EVENT_SCHEMA,
      type: "callback",
      eventId: `${Date.now()}-${++this.sequence}`,
      openKfid: String(openKfid || "").trim() || null,
      occurredAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(event);
    return event;
  }

  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener = (event: WechatWorkCallbackEvent) => subscriber.next({
        type: "wechat_work_callback",
        id: event.eventId,
        data: event,
      });
      this.listeners.add(listener);
      subscriber.next({
        type: "ready",
        data: { schema: CALLBACK_EVENT_SCHEMA, connectedAt: new Date().toISOString() },
      });
      const heartbeat = setInterval(() => subscriber.next({
        type: "heartbeat",
        data: { at: new Date().toISOString() },
      }), 15_000);
      heartbeat.unref?.();
      return () => {
        clearInterval(heartbeat);
        this.listeners.delete(listener);
      };
    });
  }
}
