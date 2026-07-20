"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node" },
});

const { getAssets, getDesignJobs, getSkus } = require("../apps/web/src/lib/api.ts");

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

const reads = [
  ["design jobs", () => getDesignJobs({})],
  ["SKUs", () => getSkus()],
  ["assets", () => getAssets()],
];

for (const [name, read] of reads) {
  test(`${name} exposes a rejected fetch instead of returning demo or empty data`, async () => {
    global.fetch = async () => {
      throw new TypeError("network unavailable");
    };

    await assert.rejects(read, /network unavailable/);
  });

  for (const status of [403, 500]) {
    test(`${name} exposes HTTP ${status} instead of returning demo or empty data`, async () => {
      global.fetch = async () => ({
        ok: false,
        status,
        async json() {
          throw new Error("error responses must not be decoded as successful data");
        },
      });

      await assert.rejects(read, new RegExp(`api ${status}`));
    });
  }
}

test("successful reads still return the API payload unchanged", async () => {
  const payload = [{ id: "real-api-row" }];
  global.fetch = async () => ({ ok: true, status: 200, async json() { return payload; } });

  assert.equal(await getDesignJobs({}), payload);
  assert.equal(await getSkus(), payload);
  assert.equal(await getAssets(), payload);
});
