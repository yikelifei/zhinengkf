"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const {
  buildServiceEnvironment,
  resolvePackagedPaths,
} = require("../apps/electron/packaged-runtime");
const {
  SCHEMA_VERSION,
  isForbiddenArchivePath,
  isForbiddenResourcePath,
  verifyWindowsPackage,
} = require("../tools/verify-windows-package");

test("Windows verification report schema requires repository provenance", () => {
  const source = fs.readFileSync(path.join(root, "tools", "verify-windows-package.js"), "utf8");
  assert.equal(SCHEMA_VERSION, "smart_kefu_windows_package_verification_v2");
  assert.match(source, /repositoryRevision/);
  assert.match(source, /verificationProfile/);
});

test("Windows verification binds even failed local content evidence to an exact revision", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-win-evidence-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const revision = "a".repeat(40);
  const report = verifyWindowsPackage({
    outputDir,
    expectUnsigned: true,
    requireSigned: false,
    directoryOnly: false,
    repositoryRevision: revision,
  });
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.repositoryRevision, revision);
  assert.equal(report.verificationProfile, "unsigned-test");
  assert.equal(report.status, "FAIL");
  assert.throws(() => verifyWindowsPackage({
    outputDir,
    expectUnsigned: true,
    requireSigned: false,
    directoryOnly: false,
    repositoryRevision: "short",
  }), /revision unavailable/);
});

test("packaged services resolve from resources while mutable data resolves under userData", () => {
  const paths = resolvePackagedPaths({
    resourcesPath: "C:\\Program Files\\Smart Kefu\\resources",
    appPath: "C:\\Program Files\\Smart Kefu\\resources\\app.asar",
    userDataPath: "C:\\Users\\operator\\AppData\\Roaming\\Smart Kefu",
  });

  assert.match(paths.apiEntry, /resources[\\/]services[\\/]api[\\/]main\.js$/);
  assert.match(paths.webEntry, /resources[\\/]services[\\/]web[\\/]apps[\\/]web[\\/]server\.js$/);
  assert.match(paths.storageDir, /AppData[\\/]Roaming[\\/]Smart Kefu[\\/]storage$/);
  assert.match(paths.readOnlyRoot, /resources[\\/]services[\\/]runtime-root$/);
  assert.doesNotMatch(paths.storageDir, /Program Files[\\/]Smart Kefu[\\/]storage$/);
});

test("packaged API and Web receive one trusted token and no source-workspace runtime paths", () => {
  const token = "a".repeat(64);
  const env = buildServiceEnvironment({
    resourcesPath: "C:\\Program Files\\Smart Kefu\\resources",
    appPath: "C:\\Program Files\\Smart Kefu\\resources\\app.asar",
    userDataPath: "C:\\Users\\operator\\AppData\\Roaming\\Smart Kefu",
    baseEnv: { PATH: "C:\\Windows\\System32" },
    token,
  });

  assert.equal(env.INTERNAL_API_TOKEN, token);
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.NODE_ENV, "production");
  assert.match(env.DESKTOP_RUNTIME_DIR, /AppData[\\/]Roaming[\\/]Smart Kefu[\\/]runtime$/);
  assert.match(env.DESKTOP_ENV_FILE, /AppData[\\/]Roaming[\\/]Smart Kefu[\\/]config[\\/]runtime\.env$/);
  assert.match(env.NODE_PATH, /app\.asar[\\/]node_modules/);
  assert.match(env.NODE_PATH, /runtime-root[\\/]node_modules/);
});

test("electron-builder uses explicit application and service whitelists", () => {
  const config = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  assert.match(config, /asar: true/);
  assert.match(config, /apps\/electron\/packaged-runtime\.js/);
  assert.match(config, /from: dist\/apps\/api/);
  assert.match(config, /from: apps\/web\/\.next\/standalone/);
  assert.match(config, /from: packages\/rules/);
  assert.match(config, /from: tools\/wechat-window-observer\.js/);
  assert.match(config, /from: \.\.\/config\/settings\.yaml/);
  assert.match(config, /to: services\/runtime-root\/config\/settings\.yaml/);
  assert.match(config, /from: node_modules\/@prisma\/client/);
  assert.match(config, /from: node_modules\/\.prisma\/client/);
  assert.match(config, /from: node_modules\/sharp/);
  assert.match(config, /from: node_modules\/@img\/sharp-win32-x64/);
  for (const exclusion of ["!.env", "!.runtime/**", "!storage/**", "!logs/**", "!*.log"]) {
    assert.ok(config.includes(exclusion), `missing exclusion ${exclusion}`);
  }
  assert.match(config, /from: dist\/apps\/api[\s\S]*?filter:\s*\n\s*- '\*\*\/\*\.js'/);
  assert.doesNotMatch(config, /^\s*- \*\*\/\*\s*$/m);
});

test("package scripts pin the official builder and separate unsigned test from signed release", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.devDependencies["electron-builder"], "26.15.3");
  assert.equal(packageJson.devDependencies.electron, "42.5.0");
  assert.match(packageJson.scripts["package:win:test"], /build-windows-package\.js$/);
  assert.match(packageJson.scripts["package:win:signed"], /--signed$/);

  const buildScript = fs.readFileSync(path.join(root, "tools", "build-windows-package.js"), "utf8");
  assert.match(buildScript, /prisma:generate/);
  assert.match(buildScript, /build:api/);
  assert.match(buildScript, /build:web/);
  assert.match(buildScript, /process\.env\.npm_execpath/);
  assert.match(buildScript, /smoke-packaged-api\.js/);
  assert.match(buildScript, /sharp-win32-x64\.node/);
  assert.match(buildScript, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(buildScript, /ELECTRON_BUILDER_CACHE/);
  assert.match(buildScript, /CSC_LINK or WIN_CSC_SUBJECT_NAME/);
});

test("packaged smoke waits for child shutdown before another build can replace resources", () => {
  const smoke = fs.readFileSync(path.join(root, "tools", "smoke-packaged-api.js"), "utf8");
  assert.match(smoke, /await Promise\.all\(processes\.reverse\(\)\.map\(stopChild\)\)/);
  assert.match(smoke, /child\.once\("exit"/);
  assert.match(smoke, /require\(\"sharp\"\)/);
  assert.match(smoke, /dhash64:v1:0000000000000000/);
});

test("packaged service startup preserves the Electron window activation lifecycle", () => {
  const main = fs.readFileSync(path.join(root, "apps", "electron", "main.js"), "utf8");
  assert.match(main, /app\.on\("activate", \(\) =>/);
  assert.match(main, /BrowserWindow\.getAllWindows\(\)\.length === 0/);
  assert.match(main, /if \(app\.isPackaged\)/);
  assert.match(main, /await packagedServices\.start\(\)/);
});

test("verification rejects packaged secrets and client-data roots", () => {
  for (const value of ["/.env", "/.env.production", "/.runtime/state.json", "/storage/customer.json", "/logs/api.log", "/secret.pfx"]) {
    assert.equal(isForbiddenArchivePath(value), true, value);
  }
  assert.equal(isForbiddenArchivePath("/node_modules/dotenv/lib/main.js"), false);
  assert.equal(isForbiddenResourcePath("/services/api/.env"), true);
  assert.equal(isForbiddenResourcePath("/storage/customer.json"), true);
  assert.equal(isForbiddenResourcePath("/services/api/storage/storage.service.js"), false);
  assert.equal(isForbiddenResourcePath("/services/web/node_modules/example/index.js"), false);
});
