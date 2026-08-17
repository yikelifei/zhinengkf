"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { installIsolatedAppConfigEnv } = require("./isolated-app-config-env");

const isolatedConfig = installIsolatedAppConfigEnv("smart-kefu-wechat-work-callback-events-");
test.after(() => isolatedConfig.cleanup());

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const {
  callbackEventTokenMatches,
  parseWechatWorkCallbackEvent,
  validateRemoteCallbackEventUrl,
  WechatWorkCallbackEventRelay,
} = require("../apps/api/src/wechat-work/wechat-work-callback-events");
const {
  consumeCallbackEventStream,
} = require("../apps/api/src/wechat-work/wechat-work-callback-event-client.service");

const TOKEN = "c".repeat(64);

test("callback event stream uses a fixed-length independent token and exact HTTPS path", () => {
  assert.equal(callbackEventTokenMatches(TOKEN, TOKEN), true);
  assert.equal(callbackEventTokenMatches(TOKEN, "d".repeat(64)), false);
  assert.equal(callbackEventTokenMatches(TOKEN, "short"), false);
  assert.equal(
    validateRemoteCallbackEventUrl("https://kefu.example.com/api/wechat-work/events/stream").origin,
    "https://kefu.example.com",
  );
  assert.throws(
    () => validateRemoteCallbackEventUrl("https://kefu.example.com/api/wechat-work/callback"),
    /exact HTTPS path/,
  );
  assert.throws(
    () => validateRemoteCallbackEventUrl("http://kefu.example.com/api/wechat-work/events/stream"),
    /exact HTTPS path/,
  );
});

test("relay publishes only a callback hint without message content or callback credentials", async () => {
  const relay = new WechatWorkCallbackEventRelay();
  const framePromise = new Promise((resolve) => {
    const subscription = relay.stream().subscribe((frame) => {
      if (frame.type !== "wechat_work_callback") return;
      subscription.unsubscribe();
      resolve(frame);
    });
  });
  const published = relay.publish("wk-live");
  const frame = await framePromise;
  assert.equal(frame.data.openKfid, "wk-live");
  assert.equal(parseWechatWorkCallbackEvent(frame.data).eventId, published.eventId);
  assert.equal("token" in frame.data, false);
  assert.equal("message" in frame.data, false);
});

test("desktop SSE parser accepts callback events and ignores heartbeat or malformed frames", async () => {
  const event = {
    schema: "smart_kefu_wechat_work_callback_event_v1",
    type: "callback",
    eventId: "evt-1",
    openKfid: "wk-live",
    occurredAt: "2026-08-14T00:00:00.000Z",
  };
  const source = [
    "event: heartbeat\ndata: {\"at\":\"now\"}\n\n",
    "event: wechat_work_callback\ndata: not-json\n\n",
    `event: wechat_work_callback\ndata: ${JSON.stringify(event)}\n\n`,
  ].join("");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(source.slice(0, 35)));
      controller.enqueue(new TextEncoder().encode(source.slice(35)));
      controller.close();
    },
  });
  const received = [];
  await consumeCallbackEventStream(body, (item) => received.push(item));
  assert.deepEqual(received.map((item) => item.eventId), ["evt-1"]);
});
