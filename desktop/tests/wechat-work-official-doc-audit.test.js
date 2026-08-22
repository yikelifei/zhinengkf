"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("official Enterprise WeChat API audit is resumable and preserves proof boundaries", () => {
  const source = fs.readFileSync(path.join(root, "tools", "audit-wechat-work-official-api.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["wechat-work:docs:audit"], "node tools/audit-wechat-work-official-api.js");
  assert.match(source, /developer\.work\.weixin\.qq\.com\/docFetch\/fetchCnt/);
  assert.match(source, /const serverApiCategoryId = 90135/);
  assert.match(source, /const relevantCategoryIds = new Set\(\[94637, 92108\]\)/);
  assert.match(source, /previousAudit/);
  assert.match(source, /OfficialRateLimitError/);
  assert.match(source, /WECOM_DOC_AUDIT_DELAY_MS/);
  assert.match(source, /WECOM_DOC_AUDIT_MAX_FETCHES/);
  assert.match(source, /Documentation and source coverage do not prove Enterprise WeChat acceptance or customer-phone receipt/);
  assert.match(source, /!endpoint\.startsWith\("\/cgi-bin\/crm\/"\)/);
});
