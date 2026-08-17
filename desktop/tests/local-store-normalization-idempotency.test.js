"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");

test("starter knowledge normalization is stable after the first read", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-normalize-stable-"));
  const store = new LocalStoreService();
  store.filePath = path.join(root, "local-store.json");

  store.listSkus();
  const first = fs.readFileSync(store.filePath, "utf8");
  store.listSkus();
  const second = fs.readFileSync(store.filePath, "utf8");

  assert.equal(second, first);
});

test("local write transaction commits several synchronous mutations with one atomic replacement", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-write-transaction-"));
  const store = new LocalStoreService();
  store.filePath = path.join(root, "local-store.json");
  store.listSkus();

  let physicalWrites = 0;
  const writeWhileLocked = store.writeWhileLocked.bind(store);
  store.writeWhileLocked = (...args) => {
    physicalWrites += 1;
    return writeWhileLocked(...args);
  };

  store.withWriteTransaction(() => {
    store.upsertWechatWorkAccount({ openKfid: "wk-transaction-a", name: "事务账号A" });
    store.upsertWechatWorkAccount({ openKfid: "wk-transaction-b", name: "事务账号B" });
  });

  assert.equal(physicalWrites, 1);
  assert.ok(store.listWechatAccounts().some((item) => item.wechatWork?.openKfid === "wk-transaction-a"));
  assert.ok(store.listWechatAccounts().some((item) => item.wechatWork?.openKfid === "wk-transaction-b"));
});
