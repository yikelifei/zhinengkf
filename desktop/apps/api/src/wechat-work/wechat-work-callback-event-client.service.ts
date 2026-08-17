import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { appConfig } from "../shared/app-config";
import { WechatWorkService } from "./wechat-work.service";
import {
  parseWechatWorkCallbackEvent,
  validateRemoteCallbackEventUrl,
  validCallbackEventToken,
  WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER,
} from "./wechat-work-callback-events";

type EventClientStatus = {
  configured: boolean;
  connected: boolean;
  endpoint: string | null;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  reconnects: number;
};

@Injectable()
export class WechatWorkCallbackEventClientService implements OnModuleInit, OnModuleDestroy {
  private controller: AbortController | null = null;
  private stopping = false;
  private runPromise: Promise<void> | null = null;
  private state: EventClientStatus = {
    configured: false,
    connected: false,
    endpoint: null,
    lastConnectedAt: null,
    lastEventAt: null,
    lastError: null,
    reconnects: 0,
  };

  constructor(private readonly wechatWork: WechatWorkService) {}

  onModuleInit() {
    const desktopRuntime = String(process.env.SMART_KEFU_RUNTIME_TARGET || "").trim().toLowerCase() === "desktop";
    if (!desktopRuntime || !appConfig.wechatWorkRemoteEventUrl || !appConfig.wechatWorkRemoteEventToken) return;
    this.state.configured = true;
    this.runPromise = this.run();
  }

  async onModuleDestroy() {
    this.stopping = true;
    this.controller?.abort();
    await this.runPromise;
  }

  status() {
    return { ...this.state };
  }

  private async run() {
    let delayMs = 1000;
    while (!this.stopping) {
      try {
        await this.connectOnce();
        delayMs = 1000;
      } catch (error) {
        if (this.stopping) break;
        this.state.connected = false;
        this.state.lastError = safeErrorCode(error);
        this.state.reconnects += 1;
      }
      if (this.stopping) break;
      await abortableDelay(delayMs, () => this.stopping);
      delayMs = Math.min(delayMs * 2, 15_000);
    }
  }

  private async connectOnce() {
    const endpoint = validateRemoteCallbackEventUrl(appConfig.wechatWorkRemoteEventUrl);
    const token = String(appConfig.wechatWorkRemoteEventToken || "").trim();
    if (!validCallbackEventToken(token)) throw new Error("remote_event_token_invalid");
    this.controller = new AbortController();
    this.state.endpoint = endpoint.origin;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        [WECHAT_WORK_CALLBACK_EVENT_TOKEN_HEADER]: token,
      },
      cache: "no-store",
      redirect: "error",
      signal: this.controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`remote_event_http_${response.status}`);
    this.state.connected = true;
    this.state.lastConnectedAt = new Date().toISOString();
    this.state.lastError = null;
    await consumeCallbackEventStream(response.body, async (event) => {
      this.state.lastEventAt = new Date().toISOString();
      await this.wechatWork.handleRemoteCallbackSignal({
        openKfid: event.openKfid || undefined,
        eventId: event.eventId,
      });
    });
    if (!this.stopping) throw new Error("remote_event_stream_ended");
  }
}

export async function consumeCallbackEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: NonNullable<ReturnType<typeof parseWechatWorkCallbackEvent>>) => Promise<void> | void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          const event = parseWechatWorkCallbackEvent(JSON.parse(data));
          if (event) await onEvent(event);
        } catch {
          // Ignore malformed or non-callback frames; transport failures still trigger reconnect.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "remote_event_aborted";
  const message = error instanceof Error ? error.message : String(error);
  return /^remote_event_[a-z0-9_]+$/i.test(message) ? message : "remote_event_unavailable";
}

async function abortableDelay(ms: number, stopped: () => boolean) {
  const step = 250;
  let remaining = ms;
  while (remaining > 0 && !stopped()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, remaining)));
    remaining -= step;
  }
}
