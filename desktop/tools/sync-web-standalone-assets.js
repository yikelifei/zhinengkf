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

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source directory: ${path.relative(root, source)}`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourceEntry, targetEntry);
    } else if (entry.isFile()) {
      copyFile(sourceEntry, targetEntry);
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function syncStandaloneNextBuild() {
  const standaloneNextRoot = path.join(standaloneWebRoot, ".next");
  fs.mkdirSync(standaloneNextRoot, { recursive: true });

  for (const entry of fs.readdirSync(nextRoot, { withFileTypes: true })) {
    if (excludedNextEntries.has(entry.name)) continue;
    const source = path.join(nextRoot, entry.name);
    const target = path.join(standaloneNextRoot, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target);
    } else if (entry.isFile()) {
      copyFile(source, target);
    }
  }
}

if (!fs.existsSync(standaloneWebRoot)) {
  throw new Error("Missing standalone output. Run `next build apps/web` first.");
}
if (!fs.existsSync(standaloneServer)) {
  throw new Error(`Missing standalone server entry: ${path.relative(root, standaloneServer)}`);
}

copyDirectory(path.join(webRoot, "public"), path.join(standaloneWebRoot, "public"));
syncStandaloneNextBuild();

console.log("Synced web standalone public and production build assets.");
