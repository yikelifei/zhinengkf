#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultCandidateBaseUrls = [
  ...buildLoopbackPortCandidates(31870, 10),
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
];

function parseArgs(argv) {
  const envBaseUrl = process.env.ZHENXI_AI_LOCAL_BASE_URL || process.env.DESIGN_PLATFORM_BASE_URL || "";
  const envDeviceId = process.env.ZHENXI_AI_DEVICE_ID || process.env.DESIGN_PLATFORM_DEVICE_ID || "";
  const args = {
    baseUrl: envBaseUrl,
    deviceId: envDeviceId,
    deviceIdSource: envDeviceId ? (process.env.ZHENXI_AI_DEVICE_ID ? "env:ZHENXI_AI_DEVICE_ID" : "env:DESIGN_PLATFORM_DEVICE_ID") : "",
    strict: false,
    json: false,
    outDir: path.join(root, ".runtime", "zhenxi-ai-connection"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") args.strict = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--base-url") args.baseUrl = argv[++index] || "";
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--device-id") {
      args.deviceId = argv[++index] || "";
      args.deviceIdSource = "cli";
    } else if (arg.startsWith("--device-id=")) {
      args.deviceId = arg.slice("--device-id=".length);
      args.deviceIdSource = "cli";
    }
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++index] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(arg.slice("--out-dir=".length));
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  args.candidateBaseUrls = buildCandidateBaseUrls(args.baseUrl);
  args.baseUrl = args.candidateBaseUrls[0];
  args.deviceId = String(args.deviceId || "").trim();
  if (!args.deviceId) args.deviceIdSource = "";
  return args;
}

function printHelp() {
  console.log([
    "Usage: node tools/check-zhenxi-ai-connection.js [--base-url http://127.0.0.1:3000] [--device-id DEVICE_ID] [--strict] [--json]",
    "",
    "Runs a read-only Zhenxi AI connector probe through Smart Kefu's DesignPlatformClient.",
    "Default candidates cover Zhenxi AI dev ports 3000/3001 and packaged desktop ports 31870-31879.",
    "It checks health, device id binding, activation status, and auth session.",
    "Passing --device-id only affects the read-only /api/activation/status and /api/auth/session probes.",
    "It never calls /api/local-generate.",
  ].join("\n"));
}

function buildLoopbackPortCandidates(startPort, count) {
  return Array.from({ length: count }, (_, index) => `http://127.0.0.1:${startPort + index}`);
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Zhenxi AI base URL must be an absolute HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Zhenxi AI base URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Zhenxi AI base URL must be an origin without credentials, path, query, or fragment");
  }
  return parsed.origin;
}

function buildCandidateBaseUrls(baseUrl) {
  const configured = String(baseUrl || "").trim() ? [baseUrl] : [];
  const envCandidates = String(process.env.ZHENXI_AI_LOCAL_CANDIDATES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = [...configured, ...envCandidates, ...defaultCandidateBaseUrls].map(normalizeBaseUrl);
  return [...new Set(candidates)];
}

function statusFromChecks(checks) {
  if (checks.some((check) => check.status === "FAIL")) return "FAILED";
  if (checks.some((check) => check.status === "BLOCKED")) return "CONNECTED_BLOCKED";
  return "READY";
}

function readyForFormalGeneration(checks) {
  const required = ["zhenxi.health", "zhenxi.device_id", "zhenxi.activation", "zhenxi.auth"];
  return required.every((id) => checks.some((check) => check.id === id && check.status === "PASS"));
}

function redactAuth(auth) {
  return {
    required: Boolean(auth?.required),
    authenticated: Boolean(auth?.authenticated),
    reason: auth?.reason || "",
    refreshed: Boolean(auth?.refreshed),
  };
}

function redactActivation(activation) {
  return {
    required: Boolean(activation?.required),
    active: Boolean(activation?.active),
    reason: activation?.reason || "",
    deviceIdSuffix: activation?.deviceIdSuffix || "",
  };
}

function publicErrorReason(error) {
  const responseData = error?.response?.data;
  const nested = isRecord(responseData?.error) ? responseData.error : null;
  return sanitizePublicText(
    nested?.code ||
      nested?.message ||
      responseData?.code ||
      responseData?.message ||
      (error instanceof Error ? error.message : String(error || "unknown_error")),
  );
}

function sanitizePublicText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|authorization|cookie|password|passwd|secret)\b\s*[:=]\s*[^,\s;}]+/gi, "$1=[redacted]")
    .slice(0, 600);
}

function deviceCheckDetail(configSummary, activation, args = {}) {
  if (activation?.reason === "missing_device" || !configSummary?.hasDeviceId) {
    return "missing device id; open /design/activation, bind a device id in /design/settings, or rerun with --device-id for a read-only status check";
  }
  const suffix = activation?.deviceIdSuffix || configSummary?.deviceIdSuffix || "";
  const source = args.deviceIdSource || "runtime";
  return suffix ? `device id configured (${source}, suffix ${suffix})` : `device id configured (${source})`;
}

function activationCheckDetail(activation, activationError) {
  if (activationError) return activationError;
  const reason = activation?.reason || "unknown";
  if (activation?.active) return "device active";
  const details = {
    missing_device: "missing device id; open /design/activation before login",
    not_activated: "device is not activated; redeem an admin activation code in /design/activation",
    expired: "device activation expired; redeem a new activation code in /design/activation",
    different_device: "account is already bound to a different device; contact the Zhenxi AI admin",
    device_bound: "this device is already bound to a different account; contact the Zhenxi AI admin",
  };
  return details[reason] || `device activation blocked: ${reason}`;
}

function authCheckDetail(auth, authError, activation) {
  if (authError) return authError;
  if (auth?.authenticated) return auth?.refreshed ? "authenticated; session refreshed" : "authenticated";
  if (activation && !activation.active) {
    return `not logged in; finish activation first in /design/activation, then sign in at /design/account (${auth?.reason || "UNAUTHORIZED"})`;
  }
  return `not logged in; sign in at /design/account (${auth?.reason || "UNAUTHORIZED"})`;
}

function internalNoLoginGenerationReady(health) {
  return health?.runtime?.channel === "internal" &&
    health?.runtime?.localWorkspace === true &&
    health?.localDemo?.localGenerateEnabled === true &&
    health?.ai?.imageConfigured === true;
}

function buildChecks({ fatalError, health, healthError, auth, authError, activation, activationError, configSummary, args }) {
  const checks = [];
  if (fatalError) {
    checks.push({
      id: "zhenxi.health",
      label: "Zhenxi AI health",
      status: "FAIL",
      detail: sanitizePublicText(fatalError),
    });
    checks.push({
      id: "zhenxi.device_id",
      label: "Zhenxi AI device id",
      status: "NOT_RUN",
      detail: "not checked because health is not reachable",
    });
    checks.push({
      id: "zhenxi.activation",
      label: "Zhenxi AI device activation",
      status: "NOT_RUN",
      detail: "not checked because health is not reachable",
    });
    checks.push({
      id: "zhenxi.auth",
      label: "Zhenxi AI auth session",
      status: "NOT_RUN",
      detail: "not checked because health is not reachable",
    });
  } else {
    const healthOk = !healthError && health?.service === "zhenxi-ai" && health?.status === "ok";
    checks.push({
      id: "zhenxi.health",
      label: "Zhenxi AI health",
      status: healthOk ? "PASS" : "FAIL",
      detail: healthError || `${health?.service || "unknown"} ${health?.status || "unknown"}`,
    });
    if (internalNoLoginGenerationReady(health)) {
      checks.push({
        id: "zhenxi.device_id",
        label: "Zhenxi AI device id",
        status: "PASS",
        detail: "same-device internal workspace; no second device binding is created",
      });
      checks.push({
        id: "zhenxi.activation",
        label: "Zhenxi AI device activation",
        status: "PASS",
        detail: "generation executes inside the already-bound local Zhenxi AI process",
      });
      checks.push({
        id: "zhenxi.auth",
        label: "Zhenxi AI auth session",
        status: "PASS",
        detail: "reuses the local internal workspace session without storing account credentials",
      });
    } else {
      const hasDeviceId = Boolean(configSummary?.hasDeviceId) && activation?.reason !== "missing_device";
      checks.push({
        id: "zhenxi.device_id",
        label: "Zhenxi AI device id",
        status: hasDeviceId ? "PASS" : "BLOCKED",
        detail: deviceCheckDetail(configSummary, activation, args),
      });
      checks.push({
        id: "zhenxi.activation",
        label: "Zhenxi AI device activation",
        status: activationError ? "FAIL" : activation?.active ? "PASS" : "BLOCKED",
        detail: activationCheckDetail(activation, activationError),
      });
      checks.push({
        id: "zhenxi.auth",
        label: "Zhenxi AI auth session",
        status: authError ? "FAIL" : auth?.authenticated ? "PASS" : "BLOCKED",
        detail: authCheckDetail(auth, authError, activation),
      });
    }
  }
  checks.push({
    id: "zhenxi.generation",
    label: "Formal generation",
    status: "NOT_RUN",
    detail: "not run by this read-only probe; this tool does not call /api/local-generate; formal generation requires explicit approval after the preflight is READY",
  });
  return checks.map((check) => ({
    ...check,
    detail: sanitizePublicText(check.detail),
  }));
}

function buildNextSteps(checks) {
  const steps = [];
  const find = (id) => checks.find((check) => check.id === id);
  const health = find("zhenxi.health");
  const device = find("zhenxi.device_id");
  const activation = find("zhenxi.activation");
  const auth = find("zhenxi.auth");

  if (health?.status !== "PASS") {
    steps.push({
      route: "/design/settings",
      title: "Fix Zhenxi AI connection",
      action: "Start Zhenxi AI, confirm the base URL, then rerun npm.cmd run zhenxi:connection.",
    });
  }
  if (device?.status === "BLOCKED") {
    steps.push({
      route: "/design/activation",
      title: "Bind device ID",
      action: "Create or paste the desktop device ID, save it, then rerun the read-only probe.",
    });
  }
  if (activation?.status === "BLOCKED") {
    steps.push({
      route: "/design/activation",
      title: "Redeem activation code",
      action: "Use an admin-generated activation code for this device before account login.",
    });
  }
  if (auth?.status === "BLOCKED") {
    steps.push({
      route: "/design/account",
      title: "Sign in to Zhenxi AI",
      action: "Log in after the device is active; the desktop runtime will store only the returned token/cookie summary.",
    });
  }
  if (readyForFormalGeneration(checks)) {
    steps.push({
      route: "/design/settings",
      title: "Preflight ready",
      action: "Confirm readiness is green, then run a real design task with manual approval. This probe still does not call /api/local-generate.",
    });
  }
  return dedupeSteps(steps);
}

function dedupeSteps(steps) {
  const seen = new Set();
  const result = [];
  for (const step of steps) {
    const key = `${step.route}:${step.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const candidateResults = await probeCandidateHealth(args.candidateBaseUrls);
  const selectedProbe = candidateResults.find((item) => item.ok) || null;
  const selectedBaseUrl = selectedProbe?.baseUrl || args.baseUrl;

  process.env.DESIGN_PLATFORM_ADAPTER = "art_image_local";
  process.env.DESIGN_PLATFORM_BASE_URL = selectedBaseUrl;
  if (args.deviceId) process.env.DESIGN_PLATFORM_DEVICE_ID = args.deviceId;

  let health = selectedProbe?.health || null;
  let healthError = "";
  let auth = null;
  let authError = "";
  let activation = null;
  let activationError = "";
  let fatalError = "";
  let configSummary = null;

  if (!selectedProbe) {
    fatalError = `Zhenxi AI health is not reachable on configured candidates: ${args.candidateBaseUrls.join(", ")}`;
  } else {
    require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
    const { DesignPlatformClient } = require("../apps/api/src/integrations/design-platform/design-platform.client.ts");
    const { getDesignPlatformRuntimeConfigSummary } = require("../apps/api/src/shared/app-config.ts");
    const client = new DesignPlatformClient();

    try {
      configSummary = getDesignPlatformRuntimeConfigSummary();
    } catch (error) {
      configSummary = null;
      healthError = publicErrorReason(error);
    }
    try {
      health = await client.publicHealth();
    } catch (error) {
      healthError = publicErrorReason(error);
    }
    try {
      activation = await client.getArtImageLocalActivationStatus();
    } catch (error) {
      activationError = publicErrorReason(error);
    }
    try {
      auth = await client.getArtImageLocalAuthSession();
    } catch (error) {
      authError = publicErrorReason(error);
    }
  }

  const checks = buildChecks({
    fatalError,
    health,
    healthError,
    auth,
    authError,
    activation,
    activationError,
    configSummary,
    args,
  });

  const status = statusFromChecks(checks);
  const nextSteps = buildNextSteps(checks);
  const ready = readyForFormalGeneration(checks);
  const report = {
    schemaVersion: "smart_kefu_zhenxi_connection_probe_v2",
    generatedAt: new Date().toISOString(),
    status,
    readyForFormalGeneration: ready,
    strict: args.strict,
    baseUrl: selectedBaseUrl,
    candidateBaseUrls: args.candidateBaseUrls,
    candidateResults,
    latencyMs: Date.now() - startedAt,
    checks,
    nextSteps,
    pages: {
      settings: "/design/settings",
      activation: "/design/activation",
      account: "/design/account",
    },
    deviceIdInput: {
      provided: Boolean(args.deviceId),
      source: args.deviceId ? args.deviceIdSource || "cli" : "",
      effectiveConfigured: Boolean(configSummary?.hasDeviceId),
      persistedInRuntime: Boolean(configSummary?.hasDeviceId && !args.deviceId),
      suffix: activation?.deviceIdSuffix || configSummary?.deviceIdSuffix || "",
    },
    preflight: {
      healthOk: checks.some((check) => check.id === "zhenxi.health" && check.status === "PASS"),
      hasDeviceId: checks.some((check) => check.id === "zhenxi.device_id" && check.status === "PASS"),
      deviceActivated: checks.some((check) => check.id === "zhenxi.activation" && check.status === "PASS"),
      authenticated: checks.some((check) => check.id === "zhenxi.auth" && check.status === "PASS"),
      formalGenerationRun: false,
    },
    health: health ? {
      service: health.service || "",
      status: health.status || "",
      runtime: health.runtime || null,
    } : null,
    auth: auth ? redactAuth(auth) : null,
    activation: activation ? redactActivation(activation) : null,
  };

  fs.mkdirSync(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, "latest.json");
  const markdownPath = path.join(args.outDir, "latest.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[zhenxi-connection] ${report.status} base=${report.baseUrl}`);
    for (const check of checks) console.log(`[${check.status}] ${check.id} ${check.detail}`);
    for (const step of nextSteps) console.log(`[NEXT] ${step.route} ${step.action}`);
    console.log(`[zhenxi-connection] JSON ${jsonPath}`);
    console.log(`[zhenxi-connection] Markdown ${markdownPath}`);
  }

  const failed = checks.filter((check) => check.status === "FAIL");
  const blocked = checks.filter((check) => check.status === "BLOCKED");
  if (failed.length || (args.strict && blocked.length)) process.exit(1);
}

function renderMarkdown(report) {
  const lines = [
    "# Zhenxi AI Connection Probe",
    "",
    `- Status: **${report.status}**`,
    `- Ready for formal generation: ${report.readyForFormalGeneration ? "yes" : "no"}`,
    `- Generated: ${report.generatedAt}`,
    `- Base URL: \`${report.baseUrl}\``,
    `- Strict: ${report.strict ? "yes" : "no"}`,
    `- Latency: ${report.latencyMs} ms`,
    `- Device ID provided: ${report.deviceIdInput?.provided ? "yes" : "no"}`,
    `- Device ID suffix: ${report.deviceIdInput?.suffix || "(none)"}`,
    "",
    "| Preflight | Result |",
    "| --- | --- |",
    `| Health OK | ${report.preflight?.healthOk ? "PASS" : "BLOCKED"} |`,
    `| Device ID | ${report.preflight?.hasDeviceId ? "PASS" : "BLOCKED"} |`,
    `| Device activated | ${report.preflight?.deviceActivated ? "PASS" : "BLOCKED"} |`,
    `| Authenticated | ${report.preflight?.authenticated ? "PASS" : "BLOCKED"} |`,
    `| Formal generation run | ${report.preflight?.formalGenerationRun ? "YES" : "NOT_RUN"} |`,
    "",
    "| Candidate | Result | Detail |",
    "| --- | --- | --- |",
  ];
  for (const candidate of report.candidateResults || []) {
    const detail = sanitizePublicText(candidate.error || `${candidate.service || "unknown"} ${candidate.status || candidate.statusCode || "unknown"}`);
    lines.push(`| \`${candidate.baseUrl}\` | ${candidate.ok ? "PASS" : "FAIL"} | ${String(detail).replace(/\|/g, "\\|")} |`);
  }
  lines.push(
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
  );
  for (const check of report.checks) {
    lines.push(`| ${check.status} | ${check.label} | ${String(check.detail || "").replace(/\|/g, "\\|")} |`);
  }
  lines.push(
    "",
    "## Next Steps",
    "",
  );
  for (const step of report.nextSteps || []) {
    lines.push(`- \`${step.route}\` - ${sanitizePublicText(step.action)}`);
  }
  lines.push(
    "",
    "## Pages",
    "",
    "- `/design/activation` - bind device id and redeem activation code.",
    "- `/design/account` - sign in to Zhenxi AI after device activation.",
    "- `/design/settings` - confirm adapter, base URL, and readiness.",
  );
  lines.push("");
  lines.push("This probe is intentionally read-only and does not call `/api/local-generate`.");
  lines.push("");
  return lines.join("\n");
}

async function probeCandidateHealth(baseUrls) {
  const results = [];
  for (const baseUrl of baseUrls) {
    const startedAt = Date.now();
    const result = await getJson(`${baseUrl}/api/health`, 1500);
    const health = normalizeHealthBody(result.body);
    results.push({
      baseUrl,
      ok: Boolean(health?.service === "zhenxi-ai" && health?.status === "ok"),
      statusCode: result.statusCode || null,
      service: health?.service || "",
      status: health?.status || "",
      error: result.error || "",
      latencyMs: Date.now() - startedAt,
      health,
    });
  }
  return results;
}

function normalizeHealthBody(body) {
  if (body?.data && typeof body.data === "object") return body.data;
  return body || null;
}

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(body);
        } catch {}
        resolve({ statusCode: res.statusCode, body: parsedBody, error: "" });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ statusCode: null, body: null, error: error.message || String(error) }));
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizePublicText(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}

module.exports = {
  buildCandidateBaseUrls,
  buildChecks,
  buildNextSteps,
  internalNoLoginGenerationReady,
  parseArgs,
  readyForFormalGeneration,
  redactActivation,
  redactAuth,
  renderMarkdown,
  sanitizePublicText,
  statusFromChecks,
};
