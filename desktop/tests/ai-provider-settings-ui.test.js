"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("AI model center provides key-only provider setup without rendering saved secrets", () => {
  const page = [
    read("apps/web/src/features/system/ai-models-page.tsx"),
    read("apps/web/src/features/system/ai-provider-credential-setup.tsx"),
  ].join("\n");
  const api = read("apps/web/src/lib/api.ts");
  const controller = read("apps/api/src/ai/ai-provider.controller.ts");
  const service = read("apps/api/src/ai/ai-provider.service.ts");

  assert.match(page, /只填密钥，立即接入/);
  assert.match(page, /type="password"/);
  assert.match(page, /autoComplete="off"/);
  assert.match(page, /仅保存密钥/);
  assert.match(page, /onSave\(provider, provider\.enabled\)/);
  assert.match(page, /请求启用/);
  assert.match(page, /enable-request/);
  assert.match(page, /enable" : "disable"}-confirm/);
  assert.match(page, /configurationTrusted/);
  assert.match(page, /确认向已启用供应商发送实时探活请求/);
  assert.match(page, /可能产生费用、配额消耗和外部审计记录/);
  assert.match(page, /探活失败也不会自动重试/);
  assert.match(page, /已安全保存；留空不会覆盖/);
  assert.match(page, /saveAiProviderCredential/);
  assert.match(page, /按问题复杂度、实时响应速度和成功率自主选择模型/);
  assert.match(page, /当前快速顺序/);
  assert.match(page, /平均 \$\{performance\.averageLatencyMs\}ms · 成功率/);
  assert.match(page, /已自动避让/);
  assert.match(api, /\/ai\/providers\/\$\{encodeURIComponent\(provider\)\}\/credential/);
  assert.match(api, /\/ai\/providers\/status\/probe/);
  assert.match(api, /method: "POST"/);
  assert.match(api, /latency_reliability_circuit_breaker/);
  assert.match(controller, /@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(controller, /@Post\("status\/probe"\)[\s\S]*@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(service, /apiKeyConfigured:/);
  assert.doesNotMatch(service, /providers\.push\(\{[\s\S]{0,500}\bapiKey\s*:/);
});
