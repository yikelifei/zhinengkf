const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "apps", "web");
const nextRoot = path.join(webRoot, ".next");
const standaloneWebRoot = path.join(nextRoot, "standalone", "apps", "web");
const standaloneServer = path.join(standaloneWebRoot, "server.js");
const excludedNextEntries = new Set(["cache", "dev", "diagnostics", "standalone", "trace"]);
const transientFsErrorCodes = new Set(["EBUSY", "EMFILE", "ENFILE", "EPERM"]);

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retryFsOperation(label, operation) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (!transientFsErrorCodes.has(error?.code) || attempt === 7) break;
      const delayMs = 250 + attempt * 250;
      console.log(`[warn] ${label} failed with ${error.code}; retrying in ${delayMs}ms...`);
      sleepMs(delayMs);
    }
  }
  throw lastError;
}

function copyDirectory(source, target, options = {}) {
  if (!fs.existsSync(source)) {
    if (options.optional) {
      console.log(`[warn] Optional source directory disappeared during sync: ${path.relative(root, source)}`);
      return;
    }
    throw new Error(`Missing source directory: ${path.relative(root, source)}`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourceEntry, targetEntry, options);
    } else if (entry.isFile()) {
      copyFile(sourceEntry, targetEntry);
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  retryFsOperation(`copy ${path.relative(root, source)}`, () => {
    if (!fs.existsSync(source)) return;
    try {
      fs.copyFileSync(source, target);
    } catch (error) {
      if (error?.code === "ENOENT" && !fs.existsSync(source)) return;
      throw error;
    }
  });
}

function syncStandaloneNextBuild() {
  const standaloneNextRoot = path.join(standaloneWebRoot, ".next");
  fs.mkdirSync(standaloneNextRoot, { recursive: true });

  for (const entry of fs.readdirSync(nextRoot, { withFileTypes: true })) {
    if (excludedNextEntries.has(entry.name)) continue;
    const source = path.join(nextRoot, entry.name);
    const target = path.join(standaloneNextRoot, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target, { optional: true });
    } else if (entry.isFile()) {
      copyFile(source, target);
    }
  }
}

function productionBuildReady() {
  const buildId = readBuildId();
  if (!buildId) return false;
  return [
    "BUILD_ID",
    "build-manifest.json",
    "prerender-manifest.json",
    "required-server-files.json",
    "routes-manifest.json",
    path.join("server", "app-paths-manifest.json"),
    path.join("server", "pages-manifest.json"),
    path.join("static", buildId, "_buildManifest.js"),
    path.join("static", buildId, "_ssgManifest.js"),
  ].every((item) => fs.existsSync(path.join(nextRoot, item)));
}

function readBuildId() {
  try {
    return fs.readFileSync(path.join(nextRoot, "BUILD_ID"), "utf8").trim();
  } catch {
    return "";
  }
}

function writeStableStandaloneServer() {
  fs.mkdirSync(standaloneWebRoot, { recursive: true });
  fs.writeFileSync(
    standaloneServer,
    `"use strict";\n` +
      `const path = require("node:path");\n` +
      `const root = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");\n` +
      `const requiredServerFiles = require(path.join(root, "apps", "web", ".next", "required-server-files.json"));\n` +
      `const dir = __dirname;\n` +
      `const currentPort = parseInt(process.env.PORT, 10) || 3100;\n` +
      `const hostname = process.env.HOSTNAME || "127.0.0.1";\n` +
      `let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);\n` +
      `const keepAlive = setInterval(() => undefined, 60000);\n` +
      `keepAlive.ref();\n` +
      `process.env.NODE_ENV = "production";\n` +
      `process.chdir(__dirname);\n` +
      `const nextConfig = { ...requiredServerFiles.config, distDir: "./.next" };\n` +
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);\n` +
      `require("next");\n` +
      `const { startServer } = require("next/dist/server/lib/start-server");\n` +
      `if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) keepAliveTimeout = undefined;\n` +
      `startServer({ dir, isDev: false, config: nextConfig, hostname, port: currentPort, allowRetry: false, keepAliveTimeout })\n` +
      `  .catch((error) => { console.error(error); clearInterval(keepAlive); process.exit(1); });\n`,
    "utf8",
  );
  console.log(`[warn] Native Next standalone output was not emitted; wrote stable startServer wrapper: ${path.relative(root, standaloneServer)}`);
}

if (!fs.existsSync(standaloneWebRoot) && productionBuildReady()) {
  writeStableStandaloneServer();
}
if (!fs.existsSync(standaloneWebRoot)) {
  throw new Error("Missing standalone output. Run `next build apps/web` first.");
}
if (!fs.existsSync(standaloneServer)) {
  if (productionBuildReady()) {
    writeStableStandaloneServer();
  } else {
    throw new Error(`Missing standalone server entry: ${path.relative(root, standaloneServer)}`);
  }
}

copyDirectory(path.join(webRoot, "public"), path.join(standaloneWebRoot, "public"));
syncStandaloneNextBuild();
if (!fs.existsSync(standaloneServer) && productionBuildReady()) {
  writeStableStandaloneServer();
}

console.log("Synced web standalone public and production build assets.");
