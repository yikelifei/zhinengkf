"use strict";

const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const dependencyRoot = resolveWorktreeNodeModules(desktopRoot);

if (require.main === module) {
  if (!dependencyRoot) process.exit(1);
  process.stdout.write(`${dependencyRoot}\n`);
}

function resolveWorktreeNodeModules(root) {
  const candidates = [];
  let cursor = path.resolve(root);
  while (true) {
    candidates.push(path.join(cursor, "node_modules"));
    candidates.push(path.join(cursor, "desktop", "node_modules"));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const seen = new Set();
  return candidates.find((candidate) => {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return dependencyRootIsUsable(normalized);
  }) || "";
}

function dependencyRootIsUsable(candidate) {
  return [
    path.join(candidate, "next", "package.json"),
    path.join(candidate, "@nestjs", "core", "package.json"),
  ].every((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

module.exports = { resolveWorktreeNodeModules };
