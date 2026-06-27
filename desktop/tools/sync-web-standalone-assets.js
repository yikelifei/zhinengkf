const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "apps", "web");
const nextRoot = path.join(webRoot, ".next");
const standaloneWebRoot = path.join(nextRoot, "standalone", "apps", "web");

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source directory: ${path.relative(root, source)}`);
  }
  fs.rmSync(target, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

if (!fs.existsSync(standaloneWebRoot)) {
  throw new Error("Missing standalone output. Run `next build apps/web` first.");
}

copyDirectory(path.join(webRoot, "public"), path.join(standaloneWebRoot, "public"));
copyDirectory(path.join(nextRoot, "static"), path.join(standaloneWebRoot, ".next", "static"));

console.log("Synced web standalone public and static assets.");
