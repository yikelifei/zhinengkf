"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function assertPrivateRegularFileOrMissing(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsafe runtime file target: ${filePath}`);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readPrivateJsonFile(filePath, fallback = null) {
  if (!assertPrivateRegularFileOrMissing(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWritePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  assertPrivateRegularFileOrMissing(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    assertPrivateRegularFileOrMissing(filePath);
    fs.renameSync(temporaryPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function removePrivateRegularFile(filePath) {
  if (assertPrivateRegularFileOrMissing(filePath)) fs.rmSync(filePath, { force: true });
}

module.exports = { assertPrivateRegularFileOrMissing, readPrivateJsonFile, atomicWritePrivateJson, removePrivateRegularFile };
