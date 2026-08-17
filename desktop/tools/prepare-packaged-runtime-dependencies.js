"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const lockFile = path.join(root, "package-lock.json");
const sourceNodeModules = path.join(root, "node_modules");
const outputRoot = path.join(root, ".package-runtime");
const outputNodeModules = path.join(outputRoot, "node_modules");
const manifestFile = path.join(outputRoot, "manifest.json");

if (require.main === module) {
  try {
    const manifest = preparePackagedRuntimeDependencies();
    console.log(`[package-runtime] copied ${manifest.packages.length} production dependency package(s)`);
    console.log(`[package-runtime] manifest=${path.relative(root, manifestFile)}`);
  } catch (error) {
    console.error(`[package-runtime] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}

function preparePackagedRuntimeDependencies(options = {}) {
  const packageLock = readPackageLock(options.lockFile || lockFile);
  const packageRoot = packageLock.packages?.[""];
  if (!packageRoot) throw new Error("package-lock.json is missing the root package entry");
  const rootDependencies = Object.keys(packageRoot.dependencies || {}).sort();
  if (!rootDependencies.length) throw new Error("package-lock.json root dependencies are empty");

  const output = path.resolve(options.outputNodeModules || outputNodeModules);
  const sourceRoot = path.resolve(options.sourceNodeModules || sourceNodeModules);
  assertInsideRoot(output, path.resolve(options.outputRoot || outputRoot), "output node_modules");

  fs.rmSync(path.dirname(output), { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  const visited = new Set();
  const queue = rootDependencies.map((name) => ({ name, key: `node_modules/${name}`, optional: false }));
  const missing = [];
  const copied = [];

  while (queue.length) {
    const item = queue.shift();
    const name = item?.name;
    const lockKey = item?.key;
    if (!name || !lockKey || visited.has(lockKey)) continue;
    visited.add(lockKey);
    const lockEntry = packageLock.packages?.[lockKey];
    if (!lockEntry) {
      if (!item.optional) missing.push(`${name} (missing from package-lock)`);
      continue;
    }
    const dependencyPath = lockKey.replace(/^node_modules\//, "");
    const source = path.join(sourceRoot, ...dependencyPath.split("/"));
    if (!directoryExists(source)) {
      if (!item.optional) missing.push(`${name} (missing from node_modules)`);
      continue;
    }
    const target = path.join(output, ...dependencyPath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    copyDependencyDirectory(source, target);
    copied.push({ key: lockKey, name, version: lockEntry.version || "" });
    for (const dependency of Object.keys(lockEntry.dependencies || {}).sort()) {
      queue.push({ name: dependency, key: findDependencyPackageKey(packageLock, lockKey, dependency), optional: false });
    }
    for (const dependency of Object.keys(lockEntry.optionalDependencies || {}).sort()) {
      queue.push({ name: dependency, key: findDependencyPackageKey(packageLock, lockKey, dependency), optional: true });
    }
    for (const dependency of Object.keys(lockEntry.peerDependencies || {}).sort()) {
      queue.push({ name: dependency, key: findDependencyPackageKey(packageLock, lockKey, dependency), optional: true });
    }
  }

  if (missing.length) {
    throw new Error(`runtime dependencies could not be staged:\n${missing.join("\n")}`);
  }

  const manifest = {
    schemaVersion: "smart_kefu_packaged_runtime_dependencies_v1",
    generatedAt: new Date().toISOString(),
    packageCount: copied.length,
    packages: copied.sort((left, right) => left.key.localeCompare(right.key)),
  };
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function readPackageLock(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`package-lock.json is unreadable: ${error.message}`);
  }
}

function directoryExists(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function assertInsideRoot(target, rootPath, label) {
  const relative = path.relative(rootPath, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${rootPath}`);
  }
}

function isIgnoredDependencyEntry(item) {
  const normalized = item.replace(/\\/g, "/");
  return /(^|\/)(\.cache|\.bin|test|tests|__tests__|coverage)(\/|$)/i.test(normalized)
    || /\.(map|tsbuildinfo)$/i.test(normalized);
}

function findDependencyPackageKey(packageLock, parentKey, dependencyName) {
  const nestedKey = `${parentKey}/node_modules/${dependencyName}`;
  if (packageLock.packages?.[nestedKey]) return nestedKey;
  const topLevelKey = `node_modules/${dependencyName}`;
  if (packageLock.packages?.[topLevelKey]) return topLevelKey;
  return topLevelKey;
}

function copyDependencyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    if (isIgnoredDependencyEntry(sourceEntry)) continue;
    const targetEntry = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDependencyDirectory(sourceEntry, targetEntry);
    } else if (entry.isFile()) {
      linkOrCopyFile(sourceEntry, targetEntry);
    }
  }
}

function linkOrCopyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.linkSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
  }
}

module.exports = {
  preparePackagedRuntimeDependencies,
};
