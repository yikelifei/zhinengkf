"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { CatalogService } = require("../apps/api/src/catalog/catalog.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function forbiddenLocalStore() {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(`production attempted LocalStore fallback: ${String(property)}`);
    },
  });
}

function skuPayload(overrides = {}) {
  return {
    skuCode: "SKU-001",
    name: "礼盒一号",
    type: "gift_box",
    category: "礼盒",
    sceneTags: ["商务"],
    costPrice: 20,
    salePrice: 50,
    stock: 8,
    dimensions: { width: 10 },
    angleImages: [],
    matchingRules: {},
    replacementSkuCodes: [],
    isActive: true,
    ...overrides,
  };
}

function cloneRows(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, structuredClone(value)]));
}

function buildFakePrisma(options = {}) {
  const state = { skus: new Map(), logs: [], mutations: [], logAttempts: 0 };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const client = {
    async $transaction(callback) {
      const snapshot = { skus: cloneRows(state.skus), logs: structuredClone(state.logs), mutations: structuredClone(state.mutations) };
      try {
        return await callback(client);
      } catch (error) {
        state.skus = snapshot.skus;
        state.logs = snapshot.logs;
        state.mutations = snapshot.mutations;
        throw error;
      }
    },
    sku: {
      async findUnique({ where }) {
        return state.skus.get(where.skuCode) || null;
      },
      async create({ data }) {
        const now = new Date(`2026-07-19T00:00:${String(sequence).padStart(2, "0")}.000Z`);
        const row = { id: nextId("sku"), ...structuredClone(data), createdAt: now, updatedAt: now };
        state.skus.set(row.skuCode, row);
        state.mutations.push({ type: "create", skuCode: row.skuCode });
        return row;
      },
      async update({ where, data }) {
        const current = state.skus.get(where.skuCode);
        const row = { ...current, ...structuredClone(data), updatedAt: new Date("2026-07-19T01:00:00.000Z") };
        state.skus.set(row.skuCode, row);
        state.mutations.push({ type: "update", skuCode: row.skuCode });
        return row;
      },
    },
    skuChangeLog: {
      async create({ data }) {
        state.logAttempts += 1;
        if (options.failLogAt === state.logAttempts) throw new Error("simulated audit insert failure");
        const row = { id: nextId("log"), ...structuredClone(data), createdAt: new Date(`2026-07-19T02:00:${String(sequence).padStart(2, "0")}.000Z`) };
        state.logs.push(row);
        return row;
      },
      async findMany({ where, take }) {
        return state.logs
          .filter((row) => !where?.skuCode || row.skuCode === where.skuCode)
          .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
          .slice(0, take);
      },
    },
  };
  return { prisma: client, state };
}

function createService(prisma) {
  return new CatalogService(prisma, forbiddenLocalStore(), {
    async saveAssetFromBase64() { throw new Error("storage is outside this contract test"); },
  });
}

test("Prisma create, update, status and batch changes write complete audit records without LocalStore fallback", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma();
    const service = createService(prisma);

    await service.upsertSku(skuPayload());
    await service.upsertSku(skuPayload({ name: "礼盒一号升级版", salePrice: 58 }));
    await service.updateSkuStatus("SKU-001", false);
    await service.upsertSku(skuPayload({ skuCode: "SKU-002", name: "礼盒二号" }));
    const batch = await service.batchUpdate({ skuCodes: ["SKU-001", "SKU-002", "MISSING"], patch: { stock: 20 } });

    assert.equal(batch.count, 2);
    assert.deepEqual(batch.skipped, [{ skuCode: "MISSING", reason: "not_found" }]);
    assert.deepEqual(state.logs.map((row) => row.action), ["create", "update", "status_change", "create", "batch_update", "batch_update"]);
    assert.equal(state.logs[0].source, "manual_form");
    assert.equal(state.logs[0].operator, "客服工作台");
    assert.equal(state.logs[0].before, undefined);
    assert.equal(state.logs[1].before.name, "礼盒一号");
    assert.equal(state.logs[1].after.name, "礼盒一号升级版");
    assert.deepEqual(state.logs[1].changedFields.map((item) => item.field), ["name", "salePrice"]);
    assert.equal(state.logs[2].reason, "下架商品");
    assert.deepEqual(state.logs[2].changedFields, [{ field: "isActive", before: true, after: false }]);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma no-op mutations do not update the SKU or manufacture audit history", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma();
    const service = createService(prisma);
    await service.upsertSku(skuPayload());
    const mutationCount = state.mutations.length;
    const logCount = state.logs.length;

    await service.upsertSku(skuPayload());
    await service.updateSkuStatus("SKU-001", true);
    const batch = await service.batchUpdate({ skuCodes: ["SKU-001"], patch: { stock: 8 } });

    assert.equal(state.mutations.length, mutationCount);
    assert.equal(state.logs.length, logCount);
    assert.equal(batch.count, 0);
    assert.deepEqual(batch.skipped, [{ skuCode: "SKU-001", reason: "no_change" }]);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("Prisma log list preserves array response, sku filter and bounded limit semantics", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma } = buildFakePrisma();
    const service = createService(prisma);
    await service.upsertSku(skuPayload());
    await service.upsertSku(skuPayload({ skuCode: "SKU-002", name: "礼盒二号" }));
    await service.upsertSku(skuPayload({ name: "礼盒一号升级版" }));

    const logs = await service.listSkuChangeLogs({ skuCode: " SKU-001 ", limit: 1 });
    assert.equal(Array.isArray(logs), true);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].skuCode, "SKU-001");
    await assert.rejects(service.listSkuChangeLogs({ limit: Number.NaN }), /limit must be a positive number/);
    await assert.rejects(service.listSkuChangeLogs({ limit: 0 }), /limit must be a positive number/);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("SKU write rolls back when the audit insert fails in the same Prisma transaction", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma({ failLogAt: 1 });
    const service = createService(prisma);
    await assert.rejects(service.upsertSku(skuPayload()), /simulated audit insert failure/);
    assert.equal(state.skus.size, 0);
    assert.equal(state.logs.length, 0);
    assert.equal(state.mutations.length, 0);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("bulk import is one transaction and rolls back earlier rows when a later audit insert fails", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma({ failLogAt: 2 });
    const service = createService(prisma);
    await assert.rejects(service.bulkUpsert([
      skuPayload(),
      skuPayload({ skuCode: "SKU-002", name: "礼盒二号" }),
    ]), /simulated audit insert failure/);
    assert.equal(state.skus.size, 0);
    assert.equal(state.logs.length, 0);
    assert.equal(state.mutations.length, 0);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("bulk import creates new SKUs inactive while preserving an existing SKU status", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    const { prisma, state } = buildFakePrisma();
    const service = createService(prisma);
    await service.upsertSku(skuPayload({ skuCode: "SKU-EXISTING", isActive: true }));
    await service.bulkUpsert([
      skuPayload({ skuCode: "SKU-EXISTING", name: "已有商品更新", isActive: undefined }),
      skuPayload({ skuCode: "SKU-NEW-DRAFT", name: "新导入草稿", isActive: undefined }),
    ]);
    assert.equal(state.skus.get("SKU-EXISTING").isActive, true);
    assert.equal(state.skus.get("SKU-NEW-DRAFT").isActive, false);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("LocalStore bulk import also preserves existing inactive status and drafts new SKUs", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  let capturedRows = [];
  try {
    const localStore = {
      listSkus() { return [{ skuCode: "SKU-EXISTING-INACTIVE", isActive: false }]; },
      bulkUpsertSkus(rows) {
        capturedRows = rows;
        return { count: rows.length, results: rows.map((row, index) => ({ id: `sku-${index + 1}`, ...row })) };
      },
    };
    const service = new CatalogService({}, localStore, {});
    await service.bulkUpsert([
      skuPayload({ skuCode: "SKU-EXISTING-INACTIVE", isActive: undefined, mainImagePath: undefined }),
      skuPayload({ skuCode: "SKU-NEW-LOCAL-DRAFT", isActive: undefined, mainImagePath: undefined }),
    ]);
    assert.equal(capturedRows[0].isActive, false);
    assert.equal(capturedRows[1].isActive, false);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("catalog audit exposes staged inactive SKUs without counting them as automation-ready", async () => {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  let includeInactiveSeen = false;
  try {
    const localStore = {
      listSkus(options) {
        includeInactiveSeen = options?.includeInactive === true;
        return [skuPayload({ isActive: false, mainImagePath: undefined })];
      },
      listSkuChangeLogs() { return []; },
    };
    const service = new CatalogService({}, localStore, {});
    const result = await service.auditSkus();
    assert.equal(includeInactiveSeen, true);
    assert.equal(result.total, 1);
    assert.equal(result.activeCount, 0);
    assert.equal(result.inactiveCount, 1);
    assert.equal(result.stagedCount, 1);
    assert.equal(result.readyCount, 0);
  } finally {
    appConfig.useLocalStore = previous;
  }
});

test("catalog audit migration retains history by restricting SKU deletion", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const migration = fs.readFileSync(path.resolve(
    __dirname,
    "../prisma/migrations/20260719230000_catalog_asset_prisma_parity/migration.sql",
  ), "utf8");
  const schema = fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
  assert.match(migration, /CREATE TABLE "SkuChangeLog"/);
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(schema, /model SkuChangeLog[\s\S]*onDelete: Restrict/);
  assert.doesNotMatch(migration, /SkuChangeLog[\s\S]*ON DELETE CASCADE/);
});
