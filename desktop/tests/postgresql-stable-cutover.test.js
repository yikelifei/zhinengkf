"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("stable runtime uses PostgreSQL and the full local JSON migration remains repeatable", () => {
  const launcher = read("tools/stable-runtime-launcher.js");
  const coreImporter = read("tools/migrate-wechat-local-json-to-prisma.ts");
  const businessImporter = read("tools/migrate-local-json-business-to-prisma.ts");
  const verifier = read("tools/verify-local-json-prisma-parity.ts");
  const migration = read("prisma/migrations/20260820060000_local_json_business_parity/migration.sql");
  const dispatch = read("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(launcher, /USE_LOCAL_STORE: "false"/);
  assert.doesNotMatch(launcher, /USE_LOCAL_STORE: "true"/);
  assert.match(coreImporter, /prisma\.message\.upsert/);
  assert.match(coreImporter, /readAt: asDate\(item\.readAt\)/);
  assert.match(businessImporter, /prisma\.sku\.upsert/);
  assert.match(businessImporter, /isActive: false/);
  assert.match(businessImporter, /localImportMissingAssetIds/);
  assert.match(businessImporter, /prisma\.knowledgeEntry\.upsert/);
  assert.match(businessImporter, /prisma\.routeEvaluation\.upsert/);
  assert.match(verifier, /trackedQueuedTask/);
  assert.match(verifier, /normalizedCancelledAttempts/);
  assert.match(verifier, /--allow-operational-drift/);
  assert.match(migration, /"KnowledgeEntry" ADD COLUMN "metadata" JSONB/);
  assert.match(migration, /"RouteEvaluation" ADD COLUMN "operationKey" TEXT/);
  assert.match(dispatch, /resolution === "abandoned_unknown"[\s\S]*\? "blocked"[\s\S]*attemptPatch: \{[\s\S]*status: attemptStatus/);
  assert.match(dispatch, /validateSendTask\(id: string[\s\S]*!adapter\.capabilities\.requiresWindowGuard[\s\S]*validatePrismaWechatWorkKfSendTask/);
});
