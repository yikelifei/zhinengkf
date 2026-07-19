"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatWorkApiClient, WechatWorkApiError } = require("../apps/api/src/wechat-work/wechat-work-api.client");

function configure() {
  appConfig.wechatWorkCorpId = "corp-download";
  appConfig.wechatWorkSecret = "secret-download";
  appConfig.wechatWorkApiBaseUrl = "https://qyapi.weixin.qq.com";
}

function tokenResponse(token) {
  return new Response(JSON.stringify({ errcode: 0, access_token: token, expires_in: 7200 }), {
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(errcode, errmsg = "error", status = 200) {
  return new Response(JSON.stringify({ errcode, errmsg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("downloadMedia URL-encodes media_id and returns bounded binary bytes", async (t) => {
  configure();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("/gettoken?")) return tokenResponse("access-download");
    return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { "content-type": "image/jpeg", "content-length": "4" },
    });
  };
  const result = await new WechatWorkApiClient().downloadMedia({ mediaId: "media/a?b=c+d" });
  assert.deepEqual(result.bytes, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.equal(result.contentType, "image/jpeg");
  assert.match(urls[1], /media_id=media%2Fa%3Fb%3Dc%2Bd$/);
});

test("downloadMedia refreshes an invalid access token once only", async (t) => {
  configure();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let tokenCalls = 0;
  let mediaCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/gettoken?")) return tokenResponse(`access-${++tokenCalls}`);
    mediaCalls += 1;
    return mediaCalls === 1
      ? errorResponse(40014, "invalid token")
      : new Response(Buffer.from([1, 2, 3]), { headers: { "content-type": "image/png" } });
  };
  const result = await new WechatWorkApiClient().downloadMedia({ mediaId: "media-refresh" });
  assert.equal(result.size, 3);
  assert.equal(tokenCalls, 2);
  assert.equal(mediaCalls, 2);

  tokenCalls = 0;
  mediaCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/gettoken?")) return tokenResponse(`second-${++tokenCalls}`);
    mediaCalls += 1;
    return errorResponse(mediaCalls === 1 ? 40014 : 42001, "expired token");
  };
  await assert.rejects(
    () => new WechatWorkApiClient().downloadMedia({ mediaId: "media-refresh-twice" }),
    (error) => error instanceof WechatWorkApiError && error.disposition === "manual_review",
  );
  assert.equal(tokenCalls, 2);
  assert.equal(mediaCalls, 2);
});

test("downloadMedia retries network, 5xx, and interrupted reads only three times without leaking URL or token", async (t) => {
  configure();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  for (const mode of ["network", "server", "stream"]) {
    let mediaCalls = 0;
    global.fetch = async (url) => {
      if (String(url).includes("/gettoken?")) return tokenResponse(`sensitive-${mode}-token`);
      mediaCalls += 1;
      if (mode === "network") throw new Error(`failed ${url}`);
      if (mode === "server") return new Response("temporary", { status: 503 });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]));
          controller.error(new Error(`interrupted ${url}`));
        },
      }), { headers: { "content-type": "image/png" } });
    };
    let captured;
    await assert.rejects(
      () => new WechatWorkApiClient().downloadMedia({ mediaId: `media-${mode}` }),
      (error) => {
        captured = error;
        return error instanceof WechatWorkApiError && error.disposition === "retry_exhausted";
      },
    );
    assert.equal(mediaCalls, 3, mode);
    assert.doesNotMatch(String(captured.message), /qyapi|access_token|sensitive-|media-/i);
    assert.equal(JSON.stringify(captured.response || {}).includes("sensitive-"), false);
  }
});

test("downloadMedia classifies permanent media errors and delayed rate limiting without retry", async (t) => {
  configure();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const [errcode, disposition] of [[40007, "permanent"], [41006, "permanent"], [45009, "delayed_blocked"]]) {
    let mediaCalls = 0;
    global.fetch = async (url) => {
      if (String(url).includes("/gettoken?")) return tokenResponse("classified-token");
      mediaCalls += 1;
      return errorResponse(errcode, `classified ${errcode}`);
    };
    await assert.rejects(
      () => new WechatWorkApiClient().downloadMedia({ mediaId: `classified-${errcode}` }),
      (error) => error instanceof WechatWorkApiError && error.errcode === errcode && error.disposition === disposition,
    );
    assert.equal(mediaCalls, 1);
  }

  global.fetch = async (url) => {
    if (String(url).includes("/gettoken?")) return tokenResponse("wrong-content-type-token");
    return new Response(JSON.stringify({ errcode: 45009, errmsg: "rate limited" }), {
      headers: { "content-type": "text/plain" },
    });
  };
  await assert.rejects(
    () => new WechatWorkApiClient().downloadMedia({ mediaId: "wrong-content-type" }),
    (error) => error instanceof WechatWorkApiError && error.disposition === "delayed_blocked",
  );
});

test("downloadMedia rejects declared and streamed bodies above 2 MB", async (t) => {
  configure();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const declared of [true, false]) {
    global.fetch = async (url) => {
      if (String(url).includes("/gettoken?")) return tokenResponse(`limit-${declared}`);
      const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
      return new Response(bytes, {
        headers: {
          "content-type": "image/png",
          ...(declared ? { "content-length": String(bytes.length) } : {}),
        },
      });
    };
    await assert.rejects(
      () => new WechatWorkApiClient().downloadMedia({ mediaId: `limit-${declared}` }),
      (error) => error instanceof WechatWorkApiError && error.disposition === "permanent" && /2 MB/.test(error.message),
    );
  }
});
