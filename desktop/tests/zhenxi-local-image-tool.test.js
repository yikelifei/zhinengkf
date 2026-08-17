"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const tool = require("../tools/generate-with-local-zhenxi.js");

test("local Zhenxi image command accepts exact slots, image controls, and references", () => {
  const args = tool.parseArgs([
    "--prompt", "真实产品棚拍",
    "--count", "3",
    "--size", "2048x2048",
    "--ratio", "1:1",
    "--module", "xiaohongshu",
    "--style-ref", "style.png",
    "--object-ref", "product.webp",
    "--transparent",
  ]);
  assert.equal(args.baseUrl, "http://127.0.0.1:3000");
  assert.equal(args.count, 3);
  assert.equal(args.size, "2048x2048");
  assert.equal(args.module, "xiaohongshu");
  assert.deepEqual(args.styleRefs, ["style.png"]);
  assert.deepEqual(args.objectRefs, ["product.webp"]);
  assert.equal(args.transparent, true);
});

test("local Zhenxi image command rejects remote targets and excessive image slots", () => {
  assert.throws(
    () => tool.parseArgs(["--base-url", "https://app.zhenxiai.cloud", "--prompt", "test image"]),
    /loopback origin/,
  );
  assert.throws(() => tool.parseArgs(["--prompt", "test image", "--count", "7"]), /between 1 and 6/);
});

test("local Zhenxi image command requires the internal same-device workspace", () => {
  assert.equal(tool.internalWorkspaceReady({
    service: "zhenxi-ai",
    status: "ok",
    runtime: { channel: "internal", localWorkspace: true },
    localDemo: { localGenerateEnabled: true },
    ai: { imageConfigured: true },
  }), true);
  assert.equal(tool.internalWorkspaceReady({
    service: "zhenxi-ai",
    status: "ok",
    runtime: { channel: "customer", localWorkspace: true },
    localDemo: { localGenerateEnabled: true },
    ai: { imageConfigured: true },
  }), false);
});

test("local Zhenxi image command contains no account or provider credential input", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../tools/generate-with-local-zhenxi.js"), "utf8");
  assert.match(source, /api\/local-generate/);
  assert.match(source, /api\/local-assets/);
  assert.doesNotMatch(source, /AI_API_KEY|ART_EXTERNAL_API_KEY|--password|--cookie|--access-token/);
  assert.equal(tool.publicUrl("https://images.example/a.png?signature=secret#fragment"), "https://images.example/a.png");
});
