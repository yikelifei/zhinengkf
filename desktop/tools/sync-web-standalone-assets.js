const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "apps", "web");
const nextRoot = path.join(webRoot, ".next");
const standaloneWebRoot = path.join(nextRoot, "standalone", "apps", "web");
const excludedNextEntries = new Set(["cache", "dev", "diagnostics", "standalone", "trace"]);

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source directory: ${path.relative(root, source)}`);
  }
  fs.rmSync(target, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function syncStandaloneNextBuild() {
  const standaloneNextRoot = path.join(standaloneWebRoot, ".next");
  fs.rmSync(standaloneNextRoot, { force: true, recursive: true });
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

copyDirectory(path.join(webRoot, "public"), path.join(standaloneWebRoot, "public"));
syncStandaloneNextBuild();

console.log("Synced web standalone public and production build assets.");
