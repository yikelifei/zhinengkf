"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { AssetsService } = require("../apps/api/src/assets/assets.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function forbiddenLocalStore() {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(`production attempted LocalStore fallback: ${String(property)}`);
    },
  });
}

function identity(overrides = {}) {
  return {
    expectedWechatAccountId: "account-1",
    expectedConversationId: "conversation-1",
    expectedCustomerId: "customer-1",
    ...overrides,
  };
}

function normalizeWindows(value) {
  return path.win32.resolve(value).replace(/[\\]+$/g, "").replace(/\\/g, "/").toLowerCase();
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-prisma-identity-"));
  const customerDir = path.join(root, "assets", "customer", "customer-1");
  const skuDir = path.join(root, "assets", "sku", "SKU-001");
  fs.mkdirSync(customerDir, { recursive: true });
  fs.mkdirSync(skuDir, { recursive: true });
  const customerFile = path.join(customerDir, "CustomerLogo.png");
  const unknownCustomerFile = path.join(customerDir, "Unknown.png");
  const skuFile = path.join(skuDir, "Sku.png");
  fs.writeFileSync(customerFile, "customer", "utf8");
  fs.writeFileSync(unknownCustomerFile, "unknown", "utf8");
  fs.writeFileSync(skuFile, "sku", "utf8");
  const state = {
    assets: [{
      id: "asset-1",
      ownerType: "customer",
      ownerId: "customer-1",
      localPath: customerFile,
      normalizedLocalPath: normalizeWindows(customerFile),
      wechatAccountId: "account-1",
      conversationId: "conversation-1",
      customerId: "customer-1",
    }],
    conversationQueries: [],
    assetQueries: [],
    creates: [],
    storageReads: [],
    storageWrites: 0,
  };
  const prisma = {
    conversation: {
      async findFirst(query) {
        state.conversationQueries.push(query);
        const where = query.where;
        if (where.id !== "conversation-1" || where.wechatAccountId !== "account-1") return null;
        return { id: "conversation-1", wechatAccountId: "account-1", customerId: "customer-1" };
      },
    },
    designAsset: {
      async findUnique(query) {
        state.assetQueries.push(query);
        return state.assets.find((asset) => asset.id === query.where.id) || null;
      },
      async findMany(query) {
        state.assetQueries.push(query);
        if (query.where?.normalizedLocalPath) {
          return state.assets.filter((asset) => asset.normalizedLocalPath === query.where.normalizedLocalPath).slice(0, query.take);
        }
        return state.assets.filter((asset) =>
          (!query.where.ownerType || asset.ownerType === query.where.ownerType) &&
          (!query.where.ownerId || asset.ownerId === query.where.ownerId) &&
          (!query.where.wechatAccountId || asset.wechatAccountId === query.where.wechatAccountId) &&
          (!query.where.conversationId || asset.conversationId === query.where.conversationId) &&
          (!query.where.customerId || asset.customerId === query.where.customerId)
        );
      },
      async create({ data }) {
        const row = { id: `asset-${state.assets.length + 1}`, ...data };
        state.creates.push(row);
        state.assets.push(row);
        return row;
      },
    },
  };
  const storage = {
    async readLocalAsset(localPath) {
      state.storageReads.push(localPath);
      return { stream: null, mimeType: "image/png", sizeBytes: 1 };
    },
    async saveAssetFromBase64({ ownerType, ownerId, fileName }) {
      state.storageWrites += 1;
      const target = path.join(root, "assets", ownerType, ownerId, fileName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "uploaded", "utf8");
      return { localPath: target, sizeBytes: 8 };
    },
  };
  const service = new AssetsService(prisma, forbiddenLocalStore(), storage);
  return { service, state, root, customerFile, unknownCustomerFile, skuFile };
}

test("Windows case, slash, dot segments and extended prefix variants resolve to the same authorized asset", async () => {
  const previousLocal = appConfig.useLocalStore;
  const previousRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = false;
  try {
    const fixture = setup();
    appConfig.localStorageRoot = fixture.root;
    const variants = [
      fixture.customerFile.toUpperCase().replace(/\\/g, "/"),
      path.join(path.dirname(fixture.customerFile), ".", "nested", "..", path.basename(fixture.customerFile)),
      `\\\\?\\${fixture.customerFile}`,
    ];
    for (const variant of variants) {
      await fixture.service.readLocalAsset(variant, identity());
    }
    assert.equal(fixture.state.storageReads.length, variants.length);
    assert.ok(fixture.state.assetQueries.every((query) => query.where.normalizedLocalPath === normalizeWindows(fixture.customerFile)));
  } finally {
    appConfig.useLocalStore = previousLocal;
    appConfig.localStorageRoot = previousRoot;
  }
});

test("wrong identity and unknown customer-directory paths fail closed before file streaming", async () => {
  const previousLocal = appConfig.useLocalStore;
  const previousRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = false;
  try {
    const fixture = setup();
    appConfig.localStorageRoot = fixture.root;
    await assert.rejects(
      fixture.service.readLocalAsset(fixture.customerFile, identity({ expectedCustomerId: "customer-other" })),
      /identity mismatch/,
    );
    await assert.rejects(
      fixture.service.readLocalAsset(fixture.unknownCustomerFile, identity()),
      /no unambiguous persisted identity/,
    );
    assert.equal(fixture.state.storageReads.length, 0);
  } finally {
    appConfig.useLocalStore = previousLocal;
    appConfig.localStorageRoot = previousRoot;
  }
});

test("unregistered SKU/global assets remain readable but non-absolute paths are rejected", async () => {
  const previousLocal = appConfig.useLocalStore;
  const previousRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = false;
  try {
    const fixture = setup();
    appConfig.localStorageRoot = fixture.root;
    await fixture.service.readLocalAsset(fixture.skuFile);
    await assert.rejects(fixture.service.readLocalAsset("storage/assets/customer/customer-1/logo.png", identity()), /must be absolute/);
    assert.equal(fixture.state.storageReads.length, 1);
  } finally {
    appConfig.useLocalStore = previousLocal;
    appConfig.localStorageRoot = previousRoot;
  }
});

test("Prisma customer upload and list validate exact conversation/account/customer identity without LocalStore", async () => {
  const previousLocal = appConfig.useLocalStore;
  const previousRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = false;
  try {
    const fixture = setup();
    appConfig.localStorageRoot = fixture.root;
    const uploaded = await fixture.service.upload({
      ownerType: "customer",
      ownerId: "customer-1",
      role: "customer_logo",
      fileName: "Uploaded.png",
      base64: Buffer.from("x").toString("base64"),
      ...identity(),
    });
    assert.equal(uploaded.normalizedLocalPath, normalizeWindows(uploaded.localPath));
    assert.equal(uploaded.role, "customer_logo");
    assert.equal(fixture.state.creates[0].role, "customer_logo");
    assert.deepEqual(
      fixture.state.conversationQueries[0].where,
      { id: "conversation-1", wechatAccountId: "account-1" },
    );
    const listed = await fixture.service.list({
      ownerType: "customer",
      ownerId: "customer-1",
      wechatAccountId: "account-1",
      conversationId: "conversation-1",
      customerId: "customer-1",
    });
    assert.ok(listed.every((asset) => asset.customerId === "customer-1"));
    const writesBeforeMismatch = fixture.state.storageWrites;
    await assert.rejects(fixture.service.upload({
      ownerType: "customer",
      ownerId: "customer-other",
      fileName: "Forbidden.png",
      base64: "eA==",
      ...identity(),
    }), /identity mismatch/);
    assert.equal(fixture.state.storageWrites, writesBeforeMismatch);
    await assert.rejects(fixture.service.list({
      ownerType: "customer",
      ownerId: "customer-other",
      wechatAccountId: "account-1",
      conversationId: "conversation-1",
      customerId: "customer-1",
    }), /identity mismatch/);
  } finally {
    appConfig.useLocalStore = previousLocal;
    appConfig.localStorageRoot = previousRoot;
  }
});

test("ambiguous normalized path rows fail closed even if the database uniqueness invariant is violated", async () => {
  const previousLocal = appConfig.useLocalStore;
  const previousRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = false;
  try {
    const fixture = setup();
    appConfig.localStorageRoot = fixture.root;
    fixture.state.assets.push({ ...fixture.state.assets[0], id: "asset-duplicate" });
    await assert.rejects(fixture.service.readLocalAsset(fixture.customerFile, identity()), /ambiguous persisted identities/);
    assert.equal(fixture.state.storageReads.length, 0);
  } finally {
    appConfig.useLocalStore = previousLocal;
    appConfig.localStorageRoot = previousRoot;
  }
});

test("source contract realpaths before identity lookup to cover Windows trailing-dot, space and 8.3 aliases when the filesystem resolves them", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../apps/api/src/assets/assets.service.ts"), "utf8");
  assert.match(source, /resolveCanonicalLocalAssetPath\(localPath\)/);
  assert.match(source, /await fs\.realpath\(input\)/);
  assert.match(source, /assertLocalAssetReadIdentity\(canonicalLocalPath/);
  assert.match(source, /storage\.readLocalAsset\(canonicalLocalPath\)/);
});

test("asset migration nulls every ambiguous legacy key before a Prisma-compatible ordinary unique index", () => {
  const migration = fs.readFileSync(path.resolve(
    __dirname,
    "../prisma/migrations/20260719230000_catalog_asset_prisma_parity/migration.sql",
  ), "utf8");
  const roleMigration = fs.readFileSync(path.resolve(
    __dirname,
    "../prisma/migrations/20260726161000_design_asset_role/migration.sql",
  ), "utf8");
  const schema = fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
  const service = fs.readFileSync(path.resolve(__dirname, "../apps/api/src/assets/assets.service.ts"), "utf8");
  assert.match(migration, /ADD COLUMN "normalizedLocalPath" TEXT/);
  assert.match(migration, /count\(\*\) OVER \(PARTITION BY normalized_path\)/);
  assert.match(migration, /classified\.normalized_count > 1 THEN NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX "DesignAsset_normalizedLocalPath_key"/);
  assert.doesNotMatch(migration, /DesignAsset_normalizedLocalPath_key"[\s\S]*\bWHERE\b/);
  assert.match(schema, /normalizedLocalPath\s+String\?\s+@unique/);
  assert.match(schema, /role\s+String\?/);
  assert.match(roleMigration, /ADD COLUMN "role" TEXT/);
  assert.match(service, /role: record\.role/);
});

test("asset-id preview requires the exact persisted conversation identity", async () => {
  const previousLocal = appConfig.useLocalStore;
  const previousRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = false;
  try {
    const fixture = setup();
    appConfig.localStorageRoot = fixture.root;
    await fixture.service.readLocalAssetById("asset-1", identity());
    await assert.rejects(
      fixture.service.readLocalAssetById("asset-1", identity({ expectedConversationId: "conversation-other" })),
      /identity mismatch/,
    );
    await assert.rejects(
      fixture.service.readLocalAssetById("asset-1", {}),
      /requires conversation identity/,
    );
    assert.equal(fixture.state.storageReads.length, 1);
  } finally {
    appConfig.useLocalStore = previousLocal;
    appConfig.localStorageRoot = previousRoot;
  }
});
