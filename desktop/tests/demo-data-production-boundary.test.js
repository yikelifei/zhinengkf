"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { installIsolatedAppConfigEnv } = require("./isolated-app-config-env");

const isolatedConfig = installIsolatedAppConfigEnv("smart-kefu-demo-boundary-");
const testEnvPath = isolatedConfig.envPath;
test.after(() => isolatedConfig.cleanup());

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const root = path.resolve(__dirname, "..");

const { AssetsService } = require("../apps/api/src/assets/assets.service");
const { CatalogService } = require("../apps/api/src/catalog/catalog.service");
const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  DEMO_DATA_MUTATION_BLOCKED_CODE,
} = require("../apps/api/src/shared/demo-data-boundary");

function isDemoBlocked(error) {
  return error?.getStatus?.() === 403 && error?.getResponse?.()?.code === DEMO_DATA_MUTATION_BLOCKED_CODE;
}

function runConfigProbe(extraEnv) {
  const script = [
    "require('ts-node').register({transpileOnly:true,compilerOptions:{module:'CommonJS'}});",
    "const { appConfig } = require('./apps/api/src/shared/app-config');",
    "process.stdout.write(JSON.stringify({allow: appConfig.allowDemoDataMutations}));",
  ].join("");
  return spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DESKTOP_ENV_FILE: testEnvPath,
      ...extraEnv,
    },
  });
}

test("production defaults disable demo data mutations unless explicitly allowed", () => {
  const blocked = runConfigProbe({
    NODE_ENV: "production",
    ALLOW_DEMO_DATA_MUTATIONS: "",
  });
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.deepEqual(JSON.parse(blocked.stdout), { allow: false });

  const prismaLike = runConfigProbe({
    NODE_ENV: "development",
    USE_LOCAL_STORE: "false",
    ALLOW_DEMO_DATA_MUTATIONS: "",
  });
  assert.equal(prismaLike.status, 0, prismaLike.stderr);
  assert.deepEqual(JSON.parse(prismaLike.stdout), { allow: false });

  const allowed = runConfigProbe({
    NODE_ENV: "production",
    ALLOW_DEMO_DATA_MUTATIONS: "1",
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout), { allow: true });
});

test("demo write services fail closed before touching local store, storage or Prisma", async (t) => {
  const originalAllow = appConfig.allowDemoDataMutations;
  const originalUseLocalStore = appConfig.useLocalStore;
  appConfig.allowDemoDataMutations = false;
  appConfig.useLocalStore = true;
  t.after(() => {
    appConfig.allowDemoDataMutations = originalAllow;
    appConfig.useLocalStore = originalUseLocalStore;
  });

  const touched = [];
  const fail = (name) => () => {
    touched.push(name);
    throw new Error(`${name} should not be reached`);
  };
  const localStore = {
    listSkus: fail("localStore.listSkus"),
    createNotification: fail("localStore.createNotification"),
    listConversations: fail("localStore.listConversations"),
  };
  const storage = {
    saveAssetFromBase64: fail("storage.saveAssetFromBase64"),
  };
  const prisma = {
    notification: { create: fail("prisma.notification.create") },
  };

  const assets = new AssetsService(prisma, localStore, storage);
  await assert.rejects(
    assets.createDemoCustomerLogo("customer-1", {
      expectedWechatAccountId: "wechat-1",
      expectedConversationId: "conversation-1",
      expectedCustomerId: "customer-1",
    }),
    isDemoBlocked,
  );

  const catalog = new CatalogService(prisma, localStore, storage);
  await assert.rejects(catalog.createDemoSkuImages(), isDemoBlocked);

  const notifications = new NotificationsService(prisma, localStore);
  assert.throws(() => notifications.createDemo("info", "demo", "body"), isDemoBlocked);

  const design = new DesignJobsService(
    prisma,
    {},
    localStore,
    notifications,
    storage,
    {},
    {},
    {},
    {},
  );
  assert.throws(() => design.createTimeoutDemo({ conversationId: "conversation-1" }), isDemoBlocked);
  assert.throws(() => design.createFailureDemo({ conversationId: "conversation-1" }), isDemoBlocked);

  const wechat = new WechatDispatchService(prisma, localStore, {}, notifications, {});
  assert.throws(() => wechat.createDemoWindowSnapshot({ conversationId: "conversation-1" }), isDemoBlocked);
  assert.throws(
    () =>
      wechat.createDemoSendTask({
        operationKey: "demo-production-boundary-1",
        conversationId: "conversation-1",
      }),
    isDemoBlocked,
  );

  assert.deepEqual(touched, []);
});
