"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const smoke = require("../tools/smoke-dev-stack");

test("dev stack smoke refuses endpoints that already respond before startup", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await listen(server);
  t.after(() => close(server));
  const { port } = server.address();

  await assert.rejects(
    smoke.assertNoPreexistingListeners([
      { label: "Fixture service", url: `http://127.0.0.1:${port}/health` },
    ]),
    /already responds before smoke start/,
  );
});

test("dev stack smoke fails when the child exits before readiness", async () => {
  const health = await smoke.waitForServiceHealth(
    { label: "Fixture service", url: "http://127.0.0.1:1/health" },
    { exitCode: 1 },
    1000,
  );
  assert.deepEqual(health, { ok: false, reason: "process exited with code 1" });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
