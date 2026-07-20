"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const {
  buildApiServiceEnvironment,
  buildWebServiceEnvironment,
  desktopSessionCookieHeader,
  resolvePackagedPaths,
  validateApiHealthResponse,
  validateWebOverviewResponse,
  waitForHttp,
} = require("../apps/electron/packaged-runtime");
const { waitForUrl } = require("../tools/smoke-packaged-api");
const {
  SCHEMA_VERSION,
  isForbiddenArchivePath,
  isForbiddenResourcePath,
  validatePackageProvenance,
  verifyWindowsPackage,
} = require("../tools/verify-windows-package");
const { PACKAGE_PROVENANCE_SCHEMA_VERSION } = require("../tools/repository-provenance");

test("Windows verification report schema requires repository provenance", () => {
  const source = fs.readFileSync(path.join(root, "tools", "verify-windows-package.js"), "utf8");
  assert.equal(SCHEMA_VERSION, "smart_kefu_windows_package_verification_v3");
  assert.match(source, /repositoryRevision/);
  assert.match(source, /repositoryClean/);
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
    repositoryClean: true,
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
    repositoryClean: true,
  }), /revision unavailable/);
});

test("package provenance binds a clean revision and package version", () => {
  const expected = {
    repositoryRevision: "f".repeat(40),
    repositoryClean: true,
    packageVersion: "0.1.0",
  };
  const manifest = {
    schemaVersion: PACKAGE_PROVENANCE_SCHEMA_VERSION,
    repositoryRevision: expected.repositoryRevision,
    repositoryClean: true,
    packageVersion: expected.packageVersion,
    generatedAt: new Date().toISOString(),
  };
  assert.equal(validatePackageProvenance(manifest, expected).valid, true);
  assert.equal(validatePackageProvenance({ ...manifest, repositoryRevision: "e".repeat(40) }, expected).valid, false);
  assert.equal(validatePackageProvenance({ ...manifest, repositoryClean: false }, expected).valid, false);
  assert.equal(validatePackageProvenance(manifest, { ...expected, repositoryClean: false }).valid, false);
  assert.equal(validatePackageProvenance({ ...manifest, packageVersion: "9.9.9" }, expected).valid, false);
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

test("packaged API and Web receive isolated environments and one trusted token", () => {
  const token = "a".repeat(64);
  const env = buildApiServiceEnvironment({
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
  const web = buildWebServiceEnvironment({
    resourcesPath: "C:\\Program Files\\Smart Kefu\\resources",
    appPath: "C:\\Program Files\\Smart Kefu\\resources\\app.asar",
    userDataPath: "C:\\Users\\operator\\AppData\\Roaming\\Smart Kefu",
    baseEnv: { PATH: "safe", DATABASE_URL: "database-secret", WECHAT_WORK_SECRET: "wecom-secret" },
    token,
    webSessionProof: "proof",
  });
  assert.equal(web.INTERNAL_API_TOKEN, token);
  assert.equal(web.DESKTOP_WEB_SESSION_PROOF, "proof");
  assert.equal(web.DATABASE_URL, undefined);
  assert.equal(web.WECHAT_WORK_SECRET, undefined);
});

test("electron-builder uses explicit application and service whitelists", () => {
  const config = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  assert.match(config, /asar: true/);
  assert.match(config, /apps\/electron\/packaged-runtime\.js/);
  assert.match(config, /\.package-provenance\.json/);
  assert.match(config, /packages\/runtime\/service-environment\.js/);
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
  assert.match(buildScript, /assertCleanRepository/);
  assert.match(buildScript, /writePackageProvenance/);
  assert.match(buildScript, /Repository HEAD changed/);
});

test("packaged smoke waits for child shutdown before another build can replace resources", () => {
  const smoke = fs.readFileSync(path.join(root, "tools", "smoke-packaged-api.js"), "utf8");
  assert.match(smoke, /await Promise\.all\(processes\.reverse\(\)\.map\(stopChild\)\)/);
  assert.match(smoke, /child\.once\("exit"/);
  assert.match(smoke, /require\(\"sharp\"\)/);
  assert.match(smoke, /dhash64:v1:0000000000000000/);
  assert.match(smoke, /apiHealth\.statusCode !== 200/);
  assert.match(smoke, /overview\.statusCode !== 200/);
  assert.match(smoke, /desktopSessionCookieHeader\(desktopWebSessionProof\)/);
  assert.match(smoke, /authenticatedProxyHealth\.statusCode !== 200/);
  assert.match(smoke, /external_no_cookie_fail_closed/);
  assert.match(smoke, /verified_electron_cookie/);
});

test("packaged readiness rejects preoccupied 3xx, auth, not-found and unrelated HTTP listeners", async (t) => {
  let response = {
    statusCode: 404,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, service: "unrelated-listener" }),
  };
  const server = http.createServer((_request, outgoing) => {
    outgoing.writeHead(response.statusCode, { "content-type": response.contentType });
    outgoing.end(response.body);
  });
  await listenOnLoopback(server);
  t.after(() => closeServer(server));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/health`;
  const child = { exitCode: null, killed: false, serviceName: "api" };

  for (const statusCode of [302, 401, 403, 404]) {
    response = { ...response, statusCode };
    await assert.rejects(waitForHttp(url, child, 35, validateApiHealthResponse), /Timed out waiting/);
    await assert.rejects(waitForUrl(child, url, 35, validateApiHealthResponse), /timed out waiting/);
  }

  response = { statusCode: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "other-api" }) };
  await assert.rejects(waitForHttp(url, child, 35, validateApiHealthResponse), /Timed out waiting/);
  await assert.rejects(waitForUrl(child, url, 35, validateApiHealthResponse), /timed out waiting/);
});

test("packaged readiness accepts exact API health and Web overview truth", async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, service: "smart-kefu-desktop-api" }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html lang="zh-CN"><body><main id="overview-center"></main><script src="/_next/static/app.js"></script></body></html>');
  });
  await listenOnLoopback(server);
  t.after(() => closeServer(server));
  const address = server.address();
  const child = { exitCode: null, killed: false, serviceName: "fixture" };

  const api = await waitForHttp(`http://127.0.0.1:${address.port}/api/health`, child, 500, validateApiHealthResponse);
  assert.equal(api.statusCode, 200);
  const overview = await waitForUrl(child, `http://127.0.0.1:${address.port}/overview`, 500, validateWebOverviewResponse);
  assert.equal(overview.statusCode, 200);
});

test("packaged readiness rejects matching service content from a foreign desktop session", async (t) => {
  const launchProof = "a".repeat(64);
  const foreignProof = "b".repeat(64);
  const server = http.createServer((request, response) => {
    if (request.headers.cookie === desktopSessionCookieHeader(foreignProof)) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, service: "smart-kefu-desktop-api" }));
      return;
    }
    response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: "desktop_session_proof_mismatch" }));
  });
  await listenOnLoopback(server);
  t.after(() => closeServer(server));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/health`;
  const child = { exitCode: null, killed: false, serviceName: "web" };

  await assert.rejects(
    waitForHttp(url, child, 35, validateApiHealthResponse, {
      headers: { Cookie: desktopSessionCookieHeader(launchProof) },
    }),
    /Timed out waiting/,
  );
  const accepted = await waitForHttp(url, child, 500, validateApiHealthResponse, {
    headers: { Cookie: desktopSessionCookieHeader(foreignProof) },
  });
  assert.equal(accepted.statusCode, 200);

  const runtime = fs.readFileSync(path.join(root, "apps", "electron", "packaged-runtime.js"), "utf8");
  assert.match(runtime, /waitForHttp\(PROXY_HEALTH_URL, web, 45_000, validateApiHealthResponse/);
  assert.match(runtime, /Cookie: desktopSessionCookieHeader\(this\.webSessionProof\)/);
});

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

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
