"use strict";

const fs = require("node:fs");
const path = require("node:path");

const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(process.cwd(), ".runtime");
const filePath = process.env.LOCAL_STORE_FILE ? path.resolve(process.env.LOCAL_STORE_FILE) : path.join(runtimeDir, "local-store.json");

if (fs.existsSync(filePath)) {
  fs.rmSync(filePath, { force: true });
  console.log(`removed ${filePath}`);
} else {
  console.log(`local store does not exist: ${filePath}`);
}

console.log("local demo data will be recreated on next API start.");
