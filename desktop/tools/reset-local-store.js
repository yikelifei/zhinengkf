"use strict";

const fs = require("node:fs");
const path = require("node:path");

const filePath = path.join(process.cwd(), ".runtime", "local-store.json");

if (fs.existsSync(filePath)) {
  fs.rmSync(filePath, { force: true });
  console.log(`removed ${filePath}`);
} else {
  console.log(`local store does not exist: ${filePath}`);
}

console.log("local demo data will be recreated on next API start.");
