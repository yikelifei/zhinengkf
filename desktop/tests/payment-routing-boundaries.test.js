"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { QuotesService } = require("../apps/api/src/quotes/quotes.service");
const { RoutingService } = require("../apps/api/src/routing/routing.service");
const { PrismaOperationsService } = require("../apps/api/src/prisma/prisma-operations.service");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function exportedFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("generic quote and order services fail closed on payment or proof-owned statuses", async () => {
  const quotes = new QuotesService({}, {}, {}, {});
  const orders = new OrdersService({}, {}, {});

  await assert.rejects(
    quotes.update("quote-1", { paymentStatus: "paid" }),
    (error) => error?.getStatus?.() === 400 && /付款凭证核验入口/.test(error.message),
  );
  await assert.rejects(
    quotes.update("quote-1", { status: "accepted" }),
    (error) => error?.getStatus?.() === 400 && /不允许推进/.test(error.message),
  );
  await assert.rejects(
    orders.update("order-1", { paymentStatus: "paid" }),
    (error) => error?.getStatus?.() === 400 && /付款凭证核验入口/.test(error.message),
  );
  await assert.rejects(
    orders.update("order-1", { status: "confirmed" }),
    (error) => error?.getStatus?.() === 400 && /不允许直接确认/.test(error.message),
  );
});

test("generic web update contracts cannot submit payment or browser-owned audit actors", () => {
  const api = read("apps/web/src/lib/api.ts");
  for (const name of ["updateQuote", "updateOrderDraft", "reviseQuoteSelection", "reviseOrderSelection"]) {
    const section = exportedFunction(api, name);
    assert.doesNotMatch(section, /paymentStatus\?:|owner\?:/, name);
  }

  const page = read("apps/web/src/features/sales/sales-order-edit-page.tsx");
  assert.match(page, /付款状态（只读）/);
  assert.match(page, /负责人（可信会话记录）/);
  assert.match(page, /需从报价页核验付款凭证/);
  assert.doesNotMatch(page, /update\("paymentStatus"|update\("owner"/);
});

test("routing correction success is not turned into an error by notification delivery", async () => {
  const originalUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  const result = {
    route: { id: "route-1", agentKey: "sales", agent: { name: "销售" } },
    trainingSample: { id: "sample-1" },
  };
  const localStore = {
    listRouteEvaluations: () => [{ id: "route-1" }],
    correctRouteEvaluation: () => result,
  };
  const notifications = { create: async () => { throw new Error("notification unavailable"); } };
  const service = new RoutingService(localStore, notifications);
  try {
    assert.equal(await service.correctEvaluation("route-1", { agentKey: "sales" }), result);
    await assert.rejects(
      service.correctEvaluation("missing", { agentKey: "sales" }),
      (error) => error?.getStatus?.() === 404,
    );
  } finally {
    appConfig.useLocalStore = originalUseLocalStore;
  }
});

test("Prisma route correction retry reuses committed training artifacts", async () => {
  const now = new Date("2026-07-20T00:00:00.000Z");
  let route = {
    id: "route-1",
    text: "我要咨询报价",
    agentKey: "general",
    scene: "未分类",
    action: "manual_review",
    confidence: 20,
    missingFields: [],
    suggestedReply: "请提供数量",
    correction: null,
    createdAt: now,
    updatedAt: now,
  };
  const agent = { id: "agent-sales", key: "sales", name: "销售", scene: "报价" };
  const samples = [];
  const knowledgeEntries = [];
  const reviewLogs = [];
  const tx = {
    routeEvaluation: {
      findUnique: async () => route,
      update: async ({ data }) => (route = { ...route, ...data, updatedAt: now }),
    },
    customerServiceAgent: { findUnique: async ({ where }) => where.key === agent.key ? agent : null },
    trainingSample: {
      create: async ({ data }) => {
        const row = { id: `sample-${samples.length + 1}`, ...data, createdAt: now, updatedAt: now };
        samples.push(row);
        return row;
      },
      findFirst: async () => samples.at(-1) || null,
    },
    knowledgeEntry: {
      create: async ({ data }) => {
        const row = { id: `knowledge-${knowledgeEntries.length + 1}`, ...data, createdAt: now, updatedAt: now };
        knowledgeEntries.push(row);
        return row;
      },
      findFirst: async ({ where }) => knowledgeEntries.find((item) => item.trainingSampleId === where.trainingSampleId) || null,
    },
    reviewLog: {
      create: async ({ data }) => {
        const row = { id: `review-${reviewLogs.length + 1}`, ...data, createdAt: now };
        reviewLogs.push(row);
        return row;
      },
      findFirst: async () => reviewLogs.at(-1) || null,
    },
  };
  let transactionOptions;
  const service = new PrismaOperationsService({
    $transaction: async (callback, options) => {
      transactionOptions = options;
      return callback(tx);
    },
  });
  const payload = { agentKey: "sales", reviewer: "local_admin", note: "人工纠正" };

  const first = await service.correctRouteEvaluation("route-1", payload);
  const retried = await service.correctRouteEvaluation("route-1", payload);

  assert.equal(samples.length, 1);
  assert.equal(knowledgeEntries.length, 1);
  assert.equal(reviewLogs.length, 1);
  assert.equal(transactionOptions.isolationLevel, "Serializable");
  assert.equal(retried.trainingSample.id, first.trainingSample.id);
  assert.equal(retried.knowledgeEntry.id, first.knowledgeEntry.id);
});
