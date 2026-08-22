"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const {
  COMPANY_PROFILE_SCHEMA_VERSION,
  loadCompanyProfile,
  validateCompanyProfile,
} = require("../packages/runtime/company-profile");
const {
  buildApiServiceEnvironment,
  buildWebServiceEnvironment,
  resolvePackagedPaths,
} = require("../apps/electron/packaged-runtime");

test("single-company profile is fixed to the company workspace without packaged credentials", () => {
  const profile = loadCompanyProfile({ filePath: path.join(root, "config", "company-profile.json") });
  assert.equal(profile.schemaVersion, COMPANY_PROFILE_SCHEMA_VERSION);
  assert.equal(profile.profileId, "zhenxi-liye-internal");
  assert.equal(profile.organization.displayName, "臻希礼业");
  assert.equal(profile.workspace.displayName, "臻希礼业企业工作台");
  assert.equal(profile.wechatWork.accountDisplayName, "禮想礼品");
  assert.notEqual(profile.organization.displayName, profile.wechatWork.accountDisplayName);
  assert.equal(profile.workspace.ownership, "company");
  assert.equal(profile.workspace.edition, "single_company_internal");
  assert.equal(profile.employeeAccess.directorySource, "wechat_work");
  assert.equal(profile.employeeAccess.desktopOperatorAccounts, "not_enabled");
  assert.equal(profile.deployment.runtimeCredentialPolicy, "external_private_runtime");
  assert.equal(profile.publicEndpoints.customerServiceBaseUrl, "https://kefu.zhenxiliye.cn");

  const fieldNames = collectFieldNames(profile).join("\n");
  assert.doesNotMatch(fieldNames, /(?:api.?key|password|corp.?id|open.?kfid|encoding.?aes|secret|token)/i);
});

function collectFieldNames(value) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectFieldNames(child)]);
}

test("company profile rejects unexpected credential fields and credential-bearing URLs", () => {
  const source = JSON.parse(fs.readFileSync(path.join(root, "config", "company-profile.json"), "utf8"));
  assert.throws(
    () => validateCompanyProfile({ ...source, wechatWorkSecret: "must-not-ship" }),
    /unsupported fields/,
  );
  assert.throws(
    () => validateCompanyProfile({
      ...source,
      publicEndpoints: { customerServiceBaseUrl: "https://employee:password@example.com" },
    }),
    /credential-free HTTPS origin/,
  );
});

test("company profile loader rejects symbolic links and oversized files", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-company-profile-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const oversized = path.join(temporaryRoot, "oversized.json");
  fs.writeFileSync(oversized, "x".repeat(64 * 1024 + 1));
  assert.throws(() => loadCompanyProfile({ filePath: oversized }), /size is invalid/);

  if (process.platform !== "win32") {
    const link = path.join(temporaryRoot, "profile-link.json");
    fs.symlinkSync(path.join(root, "config", "company-profile.json"), link);
    assert.throws(() => loadCompanyProfile({ filePath: link }), /regular file/);
  }
});

test("packaged API receives the embedded public profile while Web receives no file or credentials", () => {
  const options = {
    resourcesPath: "C:\\Program Files\\Smart Kefu\\resources",
    appPath: "C:\\Program Files\\Smart Kefu\\resources\\app.asar",
    userDataPath: "C:\\Users\\employee\\AppData\\Roaming\\Smart Kefu",
    baseEnv: { PATH: "safe", WECHAT_WORK_SECRET: "company-secret" },
    token: "internal-token",
  };
  const paths = resolvePackagedPaths(options);
  const api = buildApiServiceEnvironment(options);
  const web = buildWebServiceEnvironment({ ...options, webSessionProof: "session-proof" });

  assert.match(paths.companyProfilePath, /resources[\\/]company[\\/]company-profile\.json$/);
  assert.equal(api.SMART_KEFU_COMPANY_PROFILE_FILE, paths.companyProfilePath);
  assert.equal(web.SMART_KEFU_COMPANY_PROFILE_FILE, undefined);
  assert.equal(web.WECHAT_WORK_SECRET, undefined);

  const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "tools", "verify-windows-package.js"), "utf8");
  const fullStackSmoke = fs.readFileSync(path.join(root, "tools", "smoke-packaged-api.js"), "utf8");
  const desktopSmoke = fs.readFileSync(path.join(root, "tools", "smoke-packaged-desktop-launch.js"), "utf8");
  assert.match(builder, /from: config\/company-profile\.json[\s\S]*to: company\/company-profile\.json/);
  assert.match(verifier, /single-company package binding/);
  assert.match(fullStackSmoke, /packaged company profile was not bound safely/);
  assert.match(desktopSmoke, /desktop-launched company profile was not bound safely/);
});

test("company profile is visible as the workbench brand and registered by the API", () => {
  const shell = fs.readFileSync(path.join(root, "apps", "web", "src", "app", "modular-workbench-shell.tsx"), "utf8");
  const moduleSource = fs.readFileSync(path.join(root, "apps", "api", "src", "app.module.ts"), "utf8");
  assert.match(shell, /fetch\("\/api\/company-profile"/);
  assert.match(shell, /brandLabel: companyProfile\.organization\.displayName/);
  assert.match(moduleSource, /CompanyProfileController/);
});
