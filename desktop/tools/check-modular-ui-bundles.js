"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_REFERENCED_CHUNK_BYTES = 300 * 1024;
const REPORT_SCHEMA = "smart_kefu_modular_ui_bundle_isolation_v1";

const featureDomainByRouteRoot = {
  agents: "agents",
  automation: "automation",
  catalog: "catalog",
  conversations: "conversations",
  design: "design",
  integrations: "integrations",
  notifications: "notifications",
  overview: "overview",
  reviews: "reviews",
  routing: "routing",
  sales: "sales",
  send: "send",
  training: "training",
};

if (require.main === module) {
  try {
    const { buildDir, output } = parseArgs(process.argv.slice(2));
    const report = inspectModularBundles(buildDir);
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`modular-bundle-routes=${report.routes.length}\n`);
    process.stdout.write(`modular-bundle-max-chunk-bytes=${report.maxReferencedChunkBytes}\n`);
    process.stdout.write(`modular-bundle-isolation=${report.ok ? "PASS" : "FAIL"}\n`);
    if (!report.ok) {
      for (const violation of report.violations) {
        process.stderr.write(`${violation.route}: ${violation.reason}\n`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  let buildDir = path.resolve(__dirname, "../apps/web/.next");
  let output = "";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--build-dir") buildDir = path.resolve(readValue());
    else if (argument === "--output") output = path.resolve(readValue());
    else throw new Error(`Unknown option: ${argument}`);
  }
  return { buildDir, output };
}

function inspectModularBundles(buildDir) {
  const serverAppDir = path.join(buildDir, "server", "app");
  const staticDir = path.join(buildDir, "static");
  if (!fs.existsSync(serverAppDir)) throw new Error(`Next server app build was not found: ${serverAppDir}`);
  if (!fs.existsSync(staticDir)) throw new Error(`Next static build was not found: ${staticDir}`);

  const manifestFiles = collectFiles(serverAppDir)
    .filter((file) => file.endsWith("page_client-reference-manifest.js"));
  if (!manifestFiles.length) throw new Error("No page client-reference manifests were found.");

  const violations = [];
  const routes = manifestFiles.map((manifestFile) => {
    const route = routeFromManifestPath(serverAppDir, manifestFile);
    const source = fs.readFileSync(manifestFile, "utf8");
    const manifest = parseClientReferenceManifest(source, manifestFile);
    const clientModules = manifest.clientModules || {};
    const referencedModules = Object.entries(clientModules)
      .filter(([, module]) => Array.isArray(module?.chunks) && module.chunks.length > 0);
    const modulePaths = referencedModules.map(([modulePath]) => modulePath);
    const featureDomains = Array.from(new Set(modulePaths.map(featureDomainFromModulePath).filter(Boolean))).sort();
    const allowedFeatureDomain = allowedFeatureDomainForRoute(route);
    const unexpectedFeatureDomains = featureDomains.filter((domain) => domain !== allowedFeatureDomain);
    const legacyReferenced = modulePaths.some((modulePath) => /legacy-workbench/i.test(modulePath));

    if (unexpectedFeatureDomains.length) {
      violations.push({
        route,
        reason: `unexpected feature domains: ${unexpectedFeatureDomains.join(", ")}`,
      });
    }
    if (featureDomains.length > 1) {
      violations.push({ route, reason: `multiple feature domains share one route: ${featureDomains.join(", ")}` });
    }
    if (legacyReferenced) violations.push({ route, reason: "legacy workbench is referenced by the client manifest" });

    const chunkPaths = Array.from(new Set(referencedModules
      .map(([, module]) => module)
      .flatMap((module) => Array.isArray(module?.chunks) ? module.chunks : [])
      .filter((chunk) => typeof chunk === "string" && chunk.endsWith(".js"))));
    const chunks = chunkPaths.map((chunk) => {
      const absolute = path.join(buildDir, chunk.replace(/^static[\\/]/, `static${path.sep}`));
      const bytes = fs.existsSync(absolute) ? fs.statSync(absolute).size : null;
      if (bytes !== null && bytes > MAX_REFERENCED_CHUNK_BYTES) {
        violations.push({ route, reason: `referenced chunk exceeds ${MAX_REFERENCED_CHUNK_BYTES} bytes: ${chunk} (${bytes})` });
      }
      return { file: chunk.replaceAll("\\", "/"), bytes };
    });

    return {
      route,
      allowedFeatureDomain,
      featureDomains,
      unexpectedFeatureDomains,
      legacyReferenced,
      chunks,
      referencedJsBytes: chunks.reduce((total, chunk) => total + (chunk.bytes || 0), 0),
    };
  }).sort((left, right) => left.route.localeCompare(right.route, "en"));

  return {
    schemaVersion: REPORT_SCHEMA,
    ok: violations.length === 0,
    buildDir: "<build-dir>",
    maxAllowedReferencedChunkBytes: MAX_REFERENCED_CHUNK_BYTES,
    maxReferencedChunkBytes: Math.max(0, ...routes.flatMap((route) => route.chunks.map((chunk) => chunk.bytes || 0))),
    routes,
    violations,
  };
}

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function parseClientReferenceManifest(source, manifestFile = "manifest") {
  const assignment = source.indexOf("={\"moduleLoading\"");
  const end = source.lastIndexOf(";");
  if (assignment < 0 || end <= assignment) throw new Error(`Invalid client-reference manifest: ${manifestFile}`);
  return JSON.parse(source.slice(assignment + 1, end));
}

function routeFromManifestPath(serverAppDir, manifestFile) {
  const relative = path.relative(serverAppDir, manifestFile).replaceAll("\\", "/");
  const route = relative.replace(/\/?page_client-reference-manifest\.js$/, "");
  return route ? `/${route}` : "/";
}

function featureDomainFromModulePath(modulePath) {
  const match = String(modulePath).replaceAll("\\", "/").match(/\/src\/features\/([^/]+)\//);
  return match?.[1] || null;
}

function allowedFeatureDomainForRoute(route) {
  const segments = route.split("/").filter(Boolean);
  if (segments[0] === "settings" && segments[1] === "access") return "access";
  return featureDomainByRouteRoot[segments[0]] || null;
}

module.exports = {
  MAX_REFERENCED_CHUNK_BYTES,
  allowedFeatureDomainForRoute,
  featureDomainFromModulePath,
  inspectModularBundles,
  parseArgs,
  parseClientReferenceManifest,
  routeFromManifestPath,
};
