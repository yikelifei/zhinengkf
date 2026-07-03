const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("sku editor exposes structured matching rule inputs while keeping advanced JSON", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function matchingRuleListText\(value: string, key: "mustWith" \| "preferWith" \| "cannotWith"\)/);
  assert.match(page, /function withMatchingRuleList\(value: string, key: "mustWith" \| "preferWith" \| "cannotWith", nextText: string\)/);
  assert.match(page, /value=\{matchingRuleListText\(skuForm\.matchingRules, "mustWith"\)\}/);
  assert.match(page, /value=\{matchingRuleListText\(skuForm\.matchingRules, "preferWith"\)\}/);
  assert.match(page, /value=\{matchingRuleListText\(skuForm\.matchingRules, "cannotWith"\)\}/);
  assert.match(page, /matchingRules: withMatchingRuleList\(skuForm\.matchingRules, "mustWith", event\.target\.value\)/);
  assert.match(page, /matchingRules: withMatchingRuleList\(skuForm\.matchingRules, "preferWith", event\.target\.value\)/);
  assert.match(page, /matchingRules: withMatchingRuleList\(skuForm\.matchingRules, "cannotWith", event\.target\.value\)/);
  assert.match(page, /高级规则 \/ 备注/);
  assert.match(page, /parseMatchingRulesText\(form\.matchingRules\)/);

  assert.match(css, /\.sku-matching-rule-editor/);
  assert.match(css, /\.sku-matching-rule-grid/);
  assert.match(css, /\.sku-matching-rule-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media[\s\S]+\.sku-matching-rule-grid \{\s+grid-template-columns: 1fr;/);
});

test("sku list shows per-item automation readiness summary", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuAutomationSummary\(sku: Sku, issues: SkuCatalogAudit\["issues"\]\)/);
  assert.match(page, /const automationSummary = skuAutomationSummary\(sku, issues\)/);
  assert.match(page, /className=\{`sku-automation-pill \$\{automationSummary\.tone\}`\}/);
  assert.match(page, /不能自动/);
  assert.match(page, /需复核/);
  assert.match(page, /可自动/);

  assert.match(css, /\.sku-row span \.sku-automation-pill \{/);
  assert.match(css, /\.sku-automation-pill\.ready/);
  assert.match(css, /\.sku-automation-pill\.review/);
  assert.match(css, /\.sku-automation-pill\.blocked/);
  assert.match(css, /\.sku-automation-pill\.muted/);
});

test("sku editor previews automation readiness before saving", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuFormAutomationPreview\(form: SkuForm, warnings: SkuFormReadinessWarning\[\]\)/);
  assert.match(page, /const skuFormAutomationStatus = useMemo\(\(\) => skuFormAutomationPreview\(skuForm, skuFormReadinessWarnings\)/);
  assert.match(page, /className=\{`sku-form-automation-preview \$\{skuFormAutomationStatus\.tone\}`\}/);
  assert.match(page, /保存后自动化预估/);
  assert.match(page, /保存后可参与自动搭配、真实出图预检和报价利润核算/);
  assert.match(page, /skuFormAutomationStatus\.chips\.map/);

  assert.match(css, /\.sku-form-automation-preview,\s+\.sku-form-pricing-preview,\s+\.sku-form-specification-preview \{/);
  assert.match(css, /\.sku-form-automation-preview\.ready/);
  assert.match(css, /\.sku-form-automation-preview\.review,/);
  assert.match(css, /\.sku-form-automation-preview\.blocked/);
});

test("sku editor checks replacement and matching rule references before save", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function validateSkuFormReferences\(form: SkuForm, knownSkuCodes: Set<string>\)/);
  assert.match(page, /const knownSkuCodeSet = useMemo\(\(\) => new Set\(skus\.map\(\(sku\) => sku\.skuCode\)\.filter\(Boolean\)\), \[skus\]\)/);
  assert.match(page, /const skuFormReferenceWarnings = useMemo\(\(\) => validateSkuFormReferences\(skuForm, knownSkuCodeSet\)/);
  assert.match(page, /替代 SKU/);
  assert.match(page, /找不到这个 SKU/);
  assert.match(page, /不能指向自己/);
  assert.match(page, /SKU 引用检查/);
  assert.match(page, /skuFormReferenceWarnings\.slice\(0, 3\)\.map/);

  assert.match(css, /\.sku-form-reference-warning \{/);
  assert.match(css, /\.sku-form-reference-warning div/);
  assert.match(css, /\.sku-form-reference-warning strong,/);
});

test("sku editor shows recognized valid references with product names", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuFormReferenceSummary\(form: SkuForm, skuNameByCode: Map<string, string>\)/);
  assert.match(page, /const skuNameByCode = useMemo\(\(\) => new Map\(skus\.map\(\(sku\) => \[sku\.skuCode, sku\.name\]\)\), \[skus\]\)/);
  assert.match(page, /const skuFormReferenceMatches = useMemo\(\(\) => skuFormReferenceSummary\(skuForm, skuNameByCode\)/);
  assert.match(page, /已识别引用/);
  assert.match(page, /skuFormReferenceMatches\.slice\(0, 8\)\.map/);
  assert.match(page, /match\.label.*match\.skuCode.*match\.name/);

  assert.match(css, /\.sku-form-reference-matches \{/);
  assert.match(css, /\.sku-form-reference-matches p span/);
  assert.match(css, /\.sku-form-reference-matches strong/);
});

test("sku editor offers existing SKU codes as reference suggestions", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.match(page, /const skuReferenceOptions = useMemo\(/);
  assert.match(page, /\.map\(\(sku\) => \(\{\s+skuCode: sku\.skuCode,\s+label: \[sku\.name, sku\.category \|\| sku\.type\]/);
  assert.match(page, /<datalist id="sku-reference-options">/);
  assert.match(page, /<option key=\{option\.skuCode\} value=\{option\.skuCode\} label=\{option\.label\} \/>/);
  assert.match(page, /<input list="sku-reference-options" value=\{skuForm\.replacementSkuCodes\}/);
  assert.match(page, /list="sku-reference-options"[\s\S]*?matchingRuleListText\(skuForm\.matchingRules, "mustWith"\)/);
  assert.match(page, /list="sku-reference-options"[\s\S]*?matchingRuleListText\(skuForm\.matchingRules, "preferWith"\)/);
  assert.match(page, /list="sku-reference-options"[\s\S]*?matchingRuleListText\(skuForm\.matchingRules, "cannotWith"\)/);
});

test("sku editor can append existing SKU references without duplicate typing", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function appendSkuCodeTextList\(value: string, skuCode: string\)/);
  assert.match(page, /if \(!items\.includes\(nextCode\)\) items\.push\(nextCode\)/);
  assert.match(page, /function withAppendedMatchingRuleSku\(value: string, key: "mustWith" \| "preferWith" \| "cannotWith", skuCode: string\)/);
  assert.match(page, /const skuReferenceQuickOptions = useMemo\(/);
  assert.match(page, /option\.skuCode !== skuForm\.skuCode\.trim\(\)\)\.slice\(0, 6\)/);
  assert.match(page, /aria-label="快速追加替代 SKU"/);
  assert.match(page, /replacementSkuCodes: appendSkuCodeTextList\(skuForm\.replacementSkuCodes, option\.skuCode\)/);
  assert.match(page, /aria-label="快速追加必须同搭 SKU"/);
  assert.match(page, /withAppendedMatchingRuleSku\(skuForm\.matchingRules, "mustWith", option\.skuCode\)/);
  assert.match(page, /withAppendedMatchingRuleSku\(skuForm\.matchingRules, "preferWith", option\.skuCode\)/);
  assert.match(page, /withAppendedMatchingRuleSku\(skuForm\.matchingRules, "cannotWith", option\.skuCode\)/);

  assert.match(css, /\.sku-reference-quick-picks \{/);
  assert.match(css, /\.sku-reference-quick-picks button \{/);
});

test("sku editor previews price margin before saving", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuFormPricingPreview\(form: SkuForm\)/);
  assert.match(page, /const marginRate = salePrice > 0 \? profit \/ salePrice : 0/);
  assert.match(page, /label: "亏损风险"/);
  assert.match(page, /label: "低毛利"/);
  assert.match(page, /label: "利润健康"/);
  assert.match(page, /const skuFormPricingStatus = useMemo\(\(\) => skuFormPricingPreview\(skuForm\), \[skuForm\]\)/);
  assert.match(page, /className=\{`sku-form-pricing-preview \$\{skuFormPricingStatus\.tone\}`\}/);
  assert.match(page, /价格利润预览/);
  assert.match(page, /售价 \{formatMoney\(skuFormPricingStatus\.salePrice\)\} 元/);
  assert.match(page, /毛利率 \{Math\.round\(skuFormPricingStatus\.marginRate \* 100\)\}%/);

  assert.match(css, /\.sku-form-automation-preview,\s+\.sku-form-pricing-preview,\s+\.sku-form-specification-preview \{/);
  assert.match(css, /\.sku-form-pricing-preview\.ready/);
  assert.match(css, /\.sku-form-pricing-preview\.review/);
  assert.match(css, /\.sku-form-pricing-preview\.blocked/);
});

test("sku editor previews specification and delivery readiness before saving", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuFormSpecificationPreview\(form: SkuForm\)/);
  assert.match(page, /const dimensionValues = \[dimensions\.lengthCm, dimensions\.widthCm, dimensions\.heightCm\]/);
  assert.ok(page.includes('label: "\u89c4\u683c\u4e0d\u5b8c\u6574"'));
  assert.ok(page.includes('label: "\u91cd\u91cf\u5f02\u5e38"'));
  assert.ok(page.includes('label: "\u4ea4\u671f\u5f02\u5e38"'));
  assert.ok(page.includes('label: "\u4ea4\u4ed8\u8d44\u6599\u5f85\u8865"'));
  assert.ok(page.includes('label: "\u4ea4\u671f\u504f\u957f"'));
  assert.ok(page.includes('label: "\u89c4\u683c\u53ef\u7528"'));
  assert.match(page, /const skuFormSpecificationStatus = useMemo\(\(\) => skuFormSpecificationPreview\(skuForm\), \[skuForm\]\)/);
  assert.match(page, /className=\{`sku-form-specification-preview \$\{skuFormSpecificationStatus\.tone\}`\}/);
  assert.ok(page.includes("\u89c4\u683c\u4ea4\u4ed8\u9884\u89c8"));
  assert.match(page, /skuFormSpecificationStatus\.chips\.map/);

  assert.match(css, /\.sku-form-specification-preview\.ready/);
  assert.match(css, /\.sku-form-specification-preview\.review/);
  assert.match(css, /\.sku-form-specification-preview\.blocked/);
});

test("sku import preview shows commercial automation readiness before saving", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /skuImportPreview\.audit\?\.commercialReadiness/);
  assert.match(page, /className=\{`import-commercial-readiness \$\{skuImportPreview\.audit\.commercialReadiness\.level\}`\}/);
  assert.ok(page.includes("\u5165\u5e93\u540e\u81ea\u52a8\u5316\u9884\u4f30"));
  assert.ok(page.includes("\u81ea\u52a8\u642d\u914d"));
  assert.ok(page.includes("\u8bbe\u8ba1\u51fa\u56fe"));
  assert.ok(page.includes("\u81ea\u52a8\u62a5\u4ef7"));
  assert.match(page, /skuImportPreview\.audit\.readyCount/);
  assert.match(page, /skuImportPreview\.audit\.basicBundleCapacity/);
  assert.match(page, /skuImportPreview\.audit\.minBundleBudget/);
  assert.match(page, /skuImportPreview\.audit\.negativeMarginCount/);
  assert.match(page, /skuImportPreview\.audit\.leadTimeIssueCount/);
  assert.match(page, /skuImportPreview\.audit\.specificationIssueCount/);
  assert.match(page, /setMessage\(\[\s+\.\.\.\(skuImportPreview\.audit\?\.commercialReadiness\?\.blockers/);

  assert.match(css, /\.import-commercial-readiness \{/);
  assert.match(css, /\.import-commercial-readiness\.ready/);
  assert.match(css, /\.import-commercial-readiness\.blocked/);
  assert.match(css, /\.import-commercial-flags span\.ok/);
});

test("sku import preview shows row-level readiness before saving", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuImportRowReadiness\(row: SkuPayload, issues: SkuCatalogAudit\["issues"\] = \[\]\)/);
  assert.match(page, /function skuImportIssuesForRow\(row: SkuPayload, issues: SkuCatalogAudit\["issues"\] = \[\]\)/);
  assert.match(page, /const rowIssues = skuImportIssuesForRow\(row, skuImportPreview\.audit\?\.issues \|\| \[\]\)/);
  assert.match(page, /const rowReadiness = skuImportRowReadiness\(row, rowIssues\)/);
  assert.match(page, /className=\{`preview-row \$\{rowReadiness\.tone\}`\}/);
  assert.match(page, /className=\{`preview-row-readiness \$\{rowReadiness\.tone\}`\}/);
  assert.ok(page.includes('label: "\u5165\u5e93\u4f1a\u963b\u585e"'));
  assert.ok(page.includes('label: "\u5165\u5e93\u540e\u590d\u6838"'));
  assert.ok(page.includes('label: "\u53ef\u5165\u5e93\u81ea\u52a8\u7528"'));
  assert.ok(page.includes("\u5c3a\u5bf8\u5b8c\u6574"));
  assert.ok(page.includes("\u5229\u6da6\u5f85\u6838"));
  assert.match(page, /rowReadiness\.chips\.map/);

  assert.match(css, /\.preview-row\.ready/);
  assert.match(css, /\.preview-row\.review/);
  assert.match(css, /\.preview-row\.blocked/);
  assert.match(css, /\.preview-row-readiness \{/);
  assert.match(css, /\.preview-row-readiness\.ready/);
  assert.match(css, /\.preview-row-readiness\.review/);
  assert.match(css, /\.preview-row-readiness\.blocked/);
});

test("sku import preview summarizes batch row readiness before saving", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuImportPreviewReadinessSummary\(rows: SkuPayload\[\] = \[\], issues: SkuCatalogAudit\["issues"\] = \[\]\)/);
  assert.match(page, /const skuImportReadinessSummary = useMemo\(/);
  assert.match(page, /skuImportPreviewReadinessSummary\(skuImportPreview\.rows, skuImportPreview\.audit\?\.issues \|\| \[\]\)/);
  assert.match(page, /className=\{`import-readiness-summary \$\{skuImportReadinessSummary\.tone\}`\}/);
  assert.ok(page.includes("\u672c\u6279\u5165\u5e93\u98ce\u9669"));
  assert.ok(page.includes("\u53ef\u81ea\u52a8\u7528"));
  assert.ok(page.includes("\u9700\u590d\u6838"));
  assert.ok(page.includes("\u963b\u585e"));
  assert.match(page, /skuImportReadinessSummary\.ready/);
  assert.match(page, /skuImportReadinessSummary\.review/);
  assert.match(page, /skuImportReadinessSummary\.blocked/);

  assert.match(css, /\.import-readiness-summary \{/);
  assert.match(css, /\.import-readiness-summary\.review/);
  assert.match(css, /\.import-readiness-summary\.blocked/);
  assert.match(css, /\.import-readiness-summary p span\.ready/);
  assert.match(css, /\.import-readiness-summary p span\.review/);
  assert.match(css, /\.import-readiness-summary p span\.blocked/);
});
