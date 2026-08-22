"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

if (require.main === module) {
  const result = verifyGeneratedPrismaClient();
  console.log(`[${result.valid ? "PASS" : "FAIL"}] ${result.detail}`);
  if (!result.valid) process.exitCode = 1;
}

function verifyGeneratedPrismaClient(options = {}) {
  const projectRoot = path.resolve(options.root || root);
  const sourceSchema = path.join(projectRoot, "prisma", "schema.prisma");
  const generatedRoot = path.join(projectRoot, "node_modules", ".prisma", "client");
  const generatedSchema = path.join(generatedRoot, "schema.prisma");
  const generatedEntry = path.join(generatedRoot, "default.js");
  const generatedEngine = path.join(generatedRoot, "query_engine-windows.dll.node");
  const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
  const required = [sourceSchema, generatedSchema, generatedEntry, generatedEngine, prismaCli];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) return { valid: false, detail: `generated Prisma client inputs are missing: ${missing.join(", ")}` };

  const runtimeRoot = path.join(projectRoot, ".runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const checkRoot = fs.mkdtempSync(path.join(runtimeRoot, "package-prisma-schema-check-"));
  const formattedSchema = path.join(checkRoot, "schema.prisma");
  try {
    fs.copyFileSync(sourceSchema, formattedSchema, fs.constants.COPYFILE_EXCL);
    const formatted = spawnSync(process.execPath, [prismaCli, "format", "--schema", formattedSchema], {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: 60_000,
    });
    if (formatted.error || formatted.status !== 0) {
      const detail = String(formatted.error?.message || formatted.stderr || formatted.stdout || "Prisma format failed").trim();
      return { valid: false, detail: `current Prisma schema could not be normalized: ${detail}` };
    }
    const current = normalizeText(fs.readFileSync(formattedSchema, "utf8"));
    const generated = normalizeText(fs.readFileSync(generatedSchema, "utf8"));
    if (current !== generated) {
      return { valid: false, detail: "generated Prisma client schema does not match the current normalized schema" };
    }
    return {
      valid: true,
      detail: "generated Prisma client schema and Windows query engine match the current normalized schema",
    };
  } finally {
    const resolved = path.resolve(checkRoot);
    if (path.dirname(resolved) === path.resolve(runtimeRoot)
      && path.basename(resolved).startsWith("package-prisma-schema-check-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

module.exports = {
  normalizeText,
  verifyGeneratedPrismaClient,
};
