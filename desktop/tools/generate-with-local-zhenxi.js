#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const defaultBaseUrl = "http://127.0.0.1:3000";
const allowedModules = new Set(["poster_copy", "xiaohongshu", "detail_page"]);
const imageMimeByExtension = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ZHENXI_AI_LOCAL_BASE_URL || defaultBaseUrl,
    prompt: "",
    promptFile: "",
    count: 1,
    size: "1024x1024",
    ratio: "1:1",
    module: "poster_copy",
    category: "blank",
    templateGroupKey: "blank",
    cardType: "空白模板",
    transparent: false,
    styleRefs: [],
    objectRefs: [],
    outDir: "",
    noDownload: false,
    check: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--prompt") args.prompt = nextValue();
    else if (arg.startsWith("--prompt=")) args.prompt = arg.slice("--prompt=".length);
    else if (arg === "--prompt-file") args.promptFile = nextValue();
    else if (arg.startsWith("--prompt-file=")) args.promptFile = arg.slice("--prompt-file=".length);
    else if (arg === "--base-url") args.baseUrl = nextValue();
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--count") args.count = Number(nextValue());
    else if (arg.startsWith("--count=")) args.count = Number(arg.slice("--count=".length));
    else if (arg === "--size") args.size = nextValue();
    else if (arg.startsWith("--size=")) args.size = arg.slice("--size=".length);
    else if (arg === "--ratio") args.ratio = nextValue();
    else if (arg.startsWith("--ratio=")) args.ratio = arg.slice("--ratio=".length);
    else if (arg === "--module") args.module = nextValue();
    else if (arg.startsWith("--module=")) args.module = arg.slice("--module=".length);
    else if (arg === "--category") args.category = nextValue();
    else if (arg.startsWith("--category=")) args.category = arg.slice("--category=".length);
    else if (arg === "--template-group") args.templateGroupKey = nextValue();
    else if (arg.startsWith("--template-group=")) args.templateGroupKey = arg.slice("--template-group=".length);
    else if (arg === "--card-type") args.cardType = nextValue();
    else if (arg.startsWith("--card-type=")) args.cardType = arg.slice("--card-type=".length);
    else if (arg === "--style-ref") args.styleRefs.push(nextValue());
    else if (arg.startsWith("--style-ref=")) args.styleRefs.push(arg.slice("--style-ref=".length));
    else if (arg === "--object-ref") args.objectRefs.push(nextValue());
    else if (arg.startsWith("--object-ref=")) args.objectRefs.push(arg.slice("--object-ref=".length));
    else if (arg === "--out-dir") args.outDir = nextValue();
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--transparent") args.transparent = true;
    else if (arg === "--no-download") args.noDownload = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.baseUrl = normalizeLoopbackBaseUrl(args.baseUrl);
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 6) {
    throw new Error("count must be an integer between 1 and 6");
  }
  if (!/^(?:\d{2,5}x\d{2,5}|[124]K)$/i.test(args.size)) {
    throw new Error("size must be a pixel size such as 1024x1024 or 1K/2K/4K");
  }
  if (!/^\d{1,2}(?:\.\d+)?:\d{1,2}(?:\.\d+)?$/.test(args.ratio)) {
    throw new Error("ratio must use W:H format such as 1:1, 3:4, or 16:9");
  }
  if (!allowedModules.has(args.module)) {
    throw new Error("module must be poster_copy, xiaohongshu, or detail_page");
  }
  if (args.styleRefs.length > 12 || args.objectRefs.length > 12) {
    throw new Error("at most 12 style references and 12 object references are allowed");
  }
  return args;
}

function normalizeLoopbackBaseUrl(value) {
  const parsed = new URL(String(value || "").trim());
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Zhenxi AI base URL must be an HTTP(S) loopback origin");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Zhenxi AI base URL must be an origin without credentials, path, query, or fragment");
  }
  return parsed.origin;
}

function internalWorkspaceReady(health) {
  return health?.service === "zhenxi-ai" &&
    health?.status === "ok" &&
    health?.runtime?.channel === "internal" &&
    health?.runtime?.localWorkspace === true &&
    health?.localDemo?.localGenerateEnabled === true &&
    health?.ai?.imageConfigured === true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (args.promptFile) args.prompt = await fs.readFile(path.resolve(args.promptFile), "utf8");
  args.prompt = String(args.prompt || "").trim();

  const healthPayload = await requestJson(`${args.baseUrl}/api/health`, { method: "GET" }, 15_000);
  const health = unwrapApiData(healthPayload);
  if (!internalWorkspaceReady(health)) {
    throw new Error("Local Zhenxi AI is not ready in internal local-workspace image mode");
  }

  if (args.check) {
    return printResult({
      ok: true,
      mode: "check",
      baseUrl: args.baseUrl,
      provider: health.ai.provider,
      imageModel: health.ai.imageModel,
      imageApiType: health.ai.imageApiType,
      accountCredentialsUsed: false,
      secondDeviceBindingCreated: false,
    }, args.json);
  }
  if (args.prompt.length < 4 || args.prompt.length > 8000) {
    throw new Error("prompt must contain 4 to 8000 characters");
  }

  const [styleRefs, objectRefs] = await Promise.all([
    uploadReferenceList(args.baseUrl, args.styleRefs),
    uploadReferenceList(args.baseUrl, args.objectRefs),
  ]);
  const requestId = `codex-local:${crypto.randomUUID()}`;
  const body = {
    requestId,
    type: "image",
    module: args.module,
    projectName: "Codex 本地臻希 AI 生图",
    prompt: args.prompt,
    count: args.count,
    size: args.size,
    ratio: args.ratio,
    category: args.category,
    templateGroupKey: args.templateGroupKey,
    cardType: args.cardType,
    transparent: args.transparent,
    styleRefs,
    objectRefs,
    concurrency: args.count,
  };
  const generatedPayload = await requestJson(`${args.baseUrl}/api/local-generate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-art-image-delivery": "local_file" },
    body: JSON.stringify(body),
  }, 30 * 60_000);
  const generated = unwrapApiData(generatedPayload);
  const results = Array.isArray(generated?.results) ? generated.results : [];
  if (!results.length) throw new Error("Local Zhenxi AI returned no image result slots");

  const outDir = path.resolve(args.outDir || path.join(
    __dirname,
    "..",
    ".runtime",
    "zhenxi-local-images",
    new Date().toISOString().replace(/[:.]/g, "-"),
  ));
  if (!args.noDownload) await fs.mkdir(outDir, { recursive: true });
  const delivered = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index] || {};
    if (result.status !== "success" || !result.url) {
      delivered.push({ slot: index + 1, status: "failed", error: sanitizeText(result.error || "image generation failed") });
      continue;
    }
    const sourceUrl = resolveGeneratedUrl(args.baseUrl, result.url);
    const filePath = args.noDownload ? "" : await downloadImage(sourceUrl, outDir, index + 1);
    delivered.push({
      slot: index + 1,
      status: "success",
      filePath,
      sourceUrl: publicUrl(sourceUrl),
      warning: sanitizeText(result.warning || ""),
      retryCount: Number(result.retryCount || 0),
    });
  }

  const report = {
    ok: delivered.some((item) => item.status === "success"),
    mode: "generate",
    requestId,
    baseUrl: args.baseUrl,
    provider: health.ai.provider,
    imageModel: health.ai.imageModel,
    imageApiType: health.ai.imageApiType,
    requestedCount: args.count,
    successCount: delivered.filter((item) => item.status === "success").length,
    failedCount: delivered.filter((item) => item.status === "failed").length,
    accountCredentialsUsed: false,
    secondDeviceBindingCreated: false,
    outputDirectory: args.noDownload ? "" : outDir,
    results: delivered,
  };
  if (!args.noDownload) {
    await fs.writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  printResult(report, args.json);
  if (!report.ok) process.exitCode = 2;
}

async function uploadReferenceList(baseUrl, references) {
  const uploaded = [];
  for (const reference of references) uploaded.push(await uploadReference(baseUrl, reference));
  return uploaded;
}

async function uploadReference(baseUrl, reference) {
  const value = String(reference || "").trim();
  if (/^https:\/\//i.test(value) || value.startsWith("/")) return value;
  const filePath = path.resolve(value);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = imageMimeByExtension.get(extension);
  if (!mimeType) throw new Error(`unsupported reference image type: ${extension || "unknown"}`);
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), path.basename(filePath));
  const payload = await requestJson(`${baseUrl}/api/local-assets`, { method: "POST", body: form }, 60_000);
  const data = unwrapApiData(payload);
  if (!data?.url) throw new Error("Local Zhenxi AI did not return an uploaded reference URL");
  return String(data.url);
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || payload?.code || `HTTP ${response.status}`;
      throw new Error(sanitizeText(message));
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImage(url, outDir, slot) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`generated image download failed with HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("generated result is not an image response");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 60 * 1024 * 1024) throw new Error("generated image size is invalid");
  const extension = contentType === "image/jpeg" ? ".jpg" : contentType === "image/webp" ? ".webp" : ".png";
  const filePath = path.join(outDir, `zhenxi-${String(slot).padStart(2, "0")}${extension}`);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

function resolveGeneratedUrl(baseUrl, value) {
  const text = String(value || "").trim();
  if (/^https:\/\//i.test(text)) return text;
  if (!text.startsWith("/")) throw new Error("generated image URL is invalid");
  return new URL(text, `${baseUrl}/`).toString();
}

function unwrapApiData(value) {
  return value && typeof value === "object" && value.ok === true && "data" in value ? value.data : value;
}

function publicUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:token|key|secret|password|cookie)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .slice(0, 600);
}

function printResult(value, compact) {
  console.log(JSON.stringify(value, null, compact ? 0 : 2));
}

function printHelp() {
  console.log([
    "Usage: npm.cmd run zhenxi:image -- --prompt \"image description\" [options]",
    "",
    "Options:",
    "  --check                         Check local Zhenxi AI without generating",
    "  --count 1..6                    Exact concurrent image slots (default 1)",
    "  --size 1024x1024|1K|2K|4K       Requested saved pixel size or tier",
    "  --ratio 1:1|3:4|16:9            Composition ratio",
    "  --module poster_copy|xiaohongshu|detail_page",
    "  --category VALUE --template-group VALUE --card-type VALUE",
    "  --style-ref FILE                Repeatable style reference image",
    "  --object-ref FILE               Repeatable product/logo/person reference image",
    "  --transparent                   Request transparent background",
    "  --out-dir DIR                   Download result files to DIR",
    "  --no-download                   Keep returned URLs only",
    "",
    "This command only calls a loopback Zhenxi AI internal workspace. It does not accept or store account credentials or provider keys.",
  ].join("\n"));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizeText(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}

module.exports = {
  internalWorkspaceReady,
  normalizeLoopbackBaseUrl,
  parseArgs,
  publicUrl,
  sanitizeText,
};
