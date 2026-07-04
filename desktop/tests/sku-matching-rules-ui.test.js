const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("sku repair queue can be filtered by operational issue type", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /const skuRepairFilterOptions = \[/);
  assert.match(page, /const skuRepairSortOptions = \[/);
  assert.match(page, /const \[skuRepairFilter, setSkuRepairFilter\] = useState<string>\("all"\)/);
  assert.match(page, /const \[skuRepairSearch, setSkuRepairSearch\] = useState<string>\(""\)/);
  assert.match(page, /const \[skuRepairSort, setSkuRepairSort\] = useState<string>\("priority"\)/);
  assert.match(page, /function skuRepairItemMatchesFilter\(item: SkuRepairQueueItem, filter: string\)/);
  assert.match(page, /function skuRepairItemMatchesSearch\(item: SkuRepairQueueItem, query: string\)/);
  assert.match(page, /function sortSkuRepairQueue\(items: SkuRepairQueueItem\[\], sortBy: string\)/);
  assert.match(page, /const visibleSkuRepairQueue = useMemo\(/);
  assert.match(page, /skuRepairItemMatchesFilter\(item, skuRepairFilter\) &&/);
  assert.match(page, /skuRepairItemMatchesSearch\(item, skuRepairSearch\)/);
  assert.match(page, /return sortSkuRepairQueue\(filtered, skuRepairSort\)/);
  assert.match(page, /\[skuRepairFilter, skuRepairQueue, skuRepairSearch, skuRepairSort\]/);
  assert.match(page, /const skuRepairFilterCounts = useMemo\(/);
  assert.match(page, /skuRepairFilterOptions\.map\(\(option\) =>/);
  assert.match(page, /function resetSkuRepairView\(\)/);
  assert.match(page, /setSkuRepairFilter\("all"\)/);
  assert.match(page, /setSkuRepairSearch\(""\)/);
  assert.match(page, /setSkuRepairSort\("priority"\)/);
  assert.match(page, /const skuRepairViewCustomized = skuRepairFilter !== "all" \|\| skuRepairSearch\.trim\(\) !== "" \|\| skuRepairSort !== "priority"/);
  assert.ok(page.includes('if (sortBy === "issue_count")'));
  assert.ok(page.includes('if (sortBy === "name")'));
  assert.match(page, /aria-label="商品补齐任务筛选"/);
  assert.match(page, /aria-label="搜索待补齐商品"/);
  assert.match(page, /placeholder="搜索 SKU \/ 商品 \/ 待补字段 \/ 问题"/);
  assert.match(page, /onChange=\{\(event\) => setSkuRepairSearch\(event\.target\.value\)\}/);
  assert.match(page, /aria-label="待补齐商品排序"/);
  assert.match(page, /value=\{skuRepairSort\}/);
  assert.match(page, /onChange=\{\(event\) => setSkuRepairSort\(event\.target\.value\)\}/);
  assert.match(page, /skuRepairSortOptions\.map\(\(option\) =>/);
  assert.match(page, /onClick=\{resetSkuRepairView\}/);
  assert.match(page, /disabled=\{!skuRepairViewCustomized \|\| Boolean\(busy\)\}/);
  assert.ok(page.includes("重置视图"));
  assert.ok(page.includes("已重置商品补齐视图：显示全部待补商品，并按优先级排序。"));
  assert.match(page, /setSkuRepairFilter\("blocking"\)/);
  assert.match(page, /setSkuRepairFilter\("image"\)/);
  assert.match(page, /visibleSkuRepairQueue\.slice\(0, 8\)\.map/);
  assert.match(page, /visibleSkuRepairQueue\.length > 8/);
  assert.match(page, /const exportableSkuRepairQueue = visibleSkuRepairQueue/);
  assert.match(page, /\.\.\.exportableSkuRepairQueue\.map\(\(item\) =>/);
  assert.ok(page.includes("当前搜索下没有待补齐商品，换个关键词或清空搜索。"));
  assert.ok(page.includes("当前筛选下没有待补齐商品，可以切换其它补齐类型。"));

  assert.match(css, /\.sku-repair-filter \{/);
  assert.match(css, /\.sku-repair-filter button\.selected/);
  assert.match(css, /\.sku-repair-filter strong/);
  assert.match(css, /\.sku-repair-search \{/);
  assert.match(css, /\.sku-repair-search input/);
  assert.match(css, /\.sku-repair-sort,/);
  assert.match(css, /\.sku-repair-sort select,/);
});

test("sku image problems can be searched and exported as the visible repair list", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /const \[skuImageProblemSearch, setSkuImageProblemSearch\] = useState<string>\(""\)/);
  assert.match(page, /const \[skuImageProblemSeverityFilter, setSkuImageProblemSeverityFilter\] = useState<string>\("all"\)/);
  assert.match(page, /const \[skuImageProblemSort, setSkuImageProblemSort\] = useState<string>\("severity"\)/);
  assert.match(page, /const skuImageProblemSeverityOptions = \[/);
  assert.match(page, /const skuImageProblemSortOptions = \[/);
  assert.match(page, /function skuImageProblemMatchesSearch\(problem: SkuImageProblem, query: string\)/);
  assert.match(page, /function skuImageProblemMatchesSeverity\(problem: SkuImageProblem, filter: string\)/);
  assert.match(page, /function sortSkuImageProblems\(problems: SkuImageProblem\[\], sortBy: string, countByProduct = new Map<string, number>\(\)\)/);
  assert.match(page, /skuImageProblemAction\(problem\)/);
  assert.match(page, /const visibleSkuImageProblems = useMemo\(/);
  assert.match(page, /skuImageProblemMatchesSeverity\(problem, skuImageProblemSeverityFilter\) &&/);
  assert.match(page, /skuImageProblemMatchesSearch\(problem, skuImageProblemSearch\)/);
  assert.match(page, /return sortSkuImageProblems\(filtered, skuImageProblemSort, skuImageProblemCountByProduct\)/);
  assert.match(page, /\[skuImageProblemCountByProduct, skuImageProblemSearch, skuImageProblemSeverityFilter, skuImageProblemSort, skuImageProblems\]/);
  assert.match(page, /const skuImageProblemSeverityCounts = useMemo\(/);
  assert.match(page, /const skuImageProblemCountByProduct = useMemo\(/);
  assert.match(page, /counts\.set\(key, \(counts\.get\(key\) \|\| 0\) \+ 1\)/);
  assert.match(page, /const visibleSkuImageProblemProductCount = useMemo\(/);
  assert.match(page, /for \(const problem of visibleSkuImageProblems\)/);
  assert.match(page, /return keys\.size/);
  assert.match(page, /skuImageProblemSeverityOptions\.map\(\(option\) =>/);
  assert.ok(page.includes('{ value: "product_issue_count", label: "同商品问题数" }'));
  assert.ok(page.includes('if (sortBy === "product_issue_count")'));
  assert.match(page, /countByProduct\.get\(right\.skuCode \|\| right\.name\)/);
  assert.ok(page.includes('if (sortBy === "image_role")'));
  assert.ok(page.includes('if (sortBy === "name")'));
  assert.match(page, /function resetSkuImageProblemView\(\)/);
  assert.match(page, /setSkuImageProblemSeverityFilter\("all"\)/);
  assert.match(page, /setSkuImageProblemSearch\(""\)/);
  assert.match(page, /setSkuImageProblemSort\("severity"\)/);
  assert.match(page, /const skuImageProblemViewCustomized = skuImageProblemSeverityFilter !== "all" \|\| skuImageProblemSearch\.trim\(\) !== "" \|\| skuImageProblemSort !== "severity"/);
  assert.match(page, /const exportableSkuImageProblems = visibleSkuImageProblems/);
  assert.ok(page.includes('"同商品图片问题数"'));
  assert.match(page, /\.\.\.exportableSkuImageProblems\.map\(\(problem\) =>/);
  assert.match(page, /String\(skuImageProblemCountByProduct\.get\(problem\.skuCode \|\| problem\.name\) \|\| 1\)/);
  assert.match(page, /\$\{visibleSkuImageProblemProductCount\} 个商品/);
  assert.match(page, /已导出 \$\{exportableSkuImageProblems\.length\} 个图片问题/);
  assert.match(page, /function editSkuImageProblem\(problem: SkuImageProblem\)/);
  assert.match(page, /function focusSkuImageProblemProduct\(problem: SkuImageProblem\)/);
  assert.match(page, /const keyword = problem\.skuCode \|\| problem\.name/);
  assert.match(page, /setSkuImageProblemSearch\(keyword\)/);
  assert.match(page, /setSkuImageProblemSeverityFilter\("all"\)/);
  assert.match(page, /setSkuImageProblemSort\("image_role"\)/);
  assert.ok(page.includes("已聚焦 ${keyword} 的全部图片问题，并按图片位置排序。"));
  assert.match(page, /function stageSkuImageProblemFix\(problem: SkuImageProblem\)/);
  assert.match(page, /setSkuIssueFilter\("missing_image"\)/);
  assert.match(page, /const confirmed = window\.confirm\(/);
  assert.ok(page.includes("确认从 ${sku.skuCode} 移除${skuImageRoleLabel(problem)}路径吗？"));
  assert.ok(page.includes("这一步只会先改到商品表单里，确认无误后还需要点击“保存商品”才会生效。"));
  assert.ok(page.includes("已取消移除 ${sku.skuCode} 的${skuImageRoleLabel(problem)}路径。"));
  assert.match(page, /setSkuWorkbenchView\("editor"\)/);
  assert.match(page, /window\.setTimeout\(\(\) => \{/);
  assert.match(page, /focusSkuFormField\(problem\.imageRole === "main" \? "mainImagePath" : "angleImages", skuImageRoleLabel\(problem\)\)/);
  assert.ok(page.includes("已在表单中处理 ${sku.skuCode} 的${skuImageRoleLabel(problem)}，确认无误后点击“保存商品”生效。"));
  assert.match(page, /aria-label="搜索图片问题"/);
  assert.match(page, /placeholder="搜索 SKU \/ 图片位置 \/ 路径 \/ 问题"/);
  assert.match(page, /onChange=\{\(event\) => setSkuImageProblemSearch\(event\.target\.value\)\}/);
  assert.match(page, /aria-label="图片问题排序"/);
  assert.match(page, /value=\{skuImageProblemSort\}/);
  assert.match(page, /onChange=\{\(event\) => setSkuImageProblemSort\(event\.target\.value\)\}/);
  assert.match(page, /skuImageProblemSortOptions\.map\(\(option\) =>/);
  assert.match(page, /aria-label="图片问题严重程度筛选"/);
  assert.match(page, /setSkuImageProblemSeverityFilter\(option\.value\)/);
  assert.match(page, /skuImageProblemSeverityCounts\[option\.value\]/);
  assert.match(page, /disabled=\{!visibleSkuImageProblems\.length \|\| Boolean\(busy\)\}/);
  assert.match(page, /onClick=\{resetSkuImageProblemView\}/);
  assert.match(page, /disabled=\{!skuImageProblemViewCustomized \|\| Boolean\(busy\)\}/);
  assert.ok(page.includes("重置图片"));
  assert.ok(page.includes("已重置图片问题清单：显示全部图片问题，并按严重程度排序。"));
  assert.match(page, /visibleSkuImageProblems\.slice\(0, 5\)\.map/);
  assert.match(page, /className="sku-image-problem-count"/);
  assert.match(page, /涉及商品 \{skuImageProblemCountByProduct\.size\} 个/);
  assert.match(page, /当前涉及商品 \{visibleSkuImageProblemProductCount\} 个/);
  assert.match(page, /skuImageProblemCountByProduct\.get\(problem\.skuCode \|\| problem\.name\) \|\| 1/);
  assert.match(page, /className=\{`sku-image-problem-advice \$\{problem\.severity\}`\}/);
  assert.match(page, /<span>\{skuSeverityLabel\(problem\.severity\)\}<\/span>/);
  assert.match(page, /<strong>\{skuImageProblemAction\(problem\)\}<\/strong>/);
  assert.match(page, /onClick=\{\(\) => focusSkuImageProblemProduct\(problem\)\}/);
  assert.ok(page.includes("只看此商品"));
  assert.match(page, /visibleSkuImageProblems\.length > 5/);
  assert.ok(page.includes("当前搜索下没有图片问题，换个关键词或清空搜索。"));
  assert.ok(page.includes("当前筛选下没有图片问题，切换严重程度查看其它补图任务。"));
  assert.ok(page.includes("当前搜索还有 {visibleSkuImageProblems.length - 5} 个图片问题"));

  assert.match(css, /\.sku-image-problem-search \{/);
  assert.match(css, /\.sku-image-problem-search input/);
  assert.match(css, /\.sku-image-problem-head-actions \{/);
  assert.match(css, /\.sku-image-problem-sort/);
  assert.match(css, /\.sku-image-problem-sort select/);
  assert.match(css, /\.sku-image-problem-filter \{/);
  assert.match(css, /\.sku-image-problem-filter button\.selected/);
  assert.match(css, /\.sku-image-problem-count \{/);
  assert.match(css, /color: var\(--blue\)/);
  assert.match(css, /\.sku-image-problem-advice \{/);
  assert.match(css, /\.sku-image-problem-advice\.error/);
  assert.match(css, /\.sku-image-problem-empty \{/);
});

test("sku editor shows active repair guidance for the selected product", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /const activeSkuRepairItem = useMemo\(\(\) => \{/);
  assert.match(page, /skuRepairQueue\.find\(\(item\) =>/);
  assert.match(page, /className=\{`sku-active-repair-brief \$\{activeSkuRepairItem\.severity\}`\}/);
  assert.match(page, /aria-label="当前商品补齐说明"/);
  assert.match(page, /activeSkuRepairItem\.recommendedAction/);
  assert.match(page, /activeSkuRepairItem\.blocking \? "补齐后才建议进入自动搭配、真实出图和自动报价。"/);
  assert.match(page, /activeSkuRepairItem\.missingFields\.slice\(0, 6\)\.map/);
  assert.match(page, /activeSkuRepairItem\.issues\.slice\(0, 4\)\.map/);
  assert.match(page, /setSkuWorkbenchView\("repair"\)/);

  assert.match(css, /\.sku-active-repair-brief \{/);
  assert.match(css, /\.sku-active-repair-brief\.error/);
  assert.match(css, /\.sku-active-repair-fields,/);
  assert.match(css, /\.sku-active-repair-issues span\.error/);
});

test("sku repair guidance can focus the exact editor field", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuFormFieldTargetId\(field: string\)/);
  assert.match(page, /function focusSkuFormField\(field: string, label\?: string\)/);
  assert.match(page, /document\.getElementById\(skuFormFieldTargetId\(field\)\)/);
  assert.match(page, /element\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(page, /onClick=\{\(\) => focusSkuFormField\(field\.field, field\.label\)\}/);
  assert.match(page, /id="sku-form-skuCode"/);
  assert.match(page, /id="sku-form-mainImagePath"/);
  assert.match(page, /id="sku-form-replacementSkuCodes"/);
  assert.match(page, /id="sku-form-matching-rules"/);
  assert.match(page, /id="sku-form-matching-must-with"/);

  assert.match(css, /\.sku-active-repair-fields button,/);
  assert.match(css, /\.sku-active-repair-fields button:hover,/);
  assert.match(css, /\.sku-active-repair-fields button:focus-visible/);
});

test("sku editor shows live repair progress after field edits", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuFormFieldHasUsableValue\(form: SkuForm, field: string\)/);
  assert.match(page, /const activeSkuRepairProgress = useMemo\(\(\) => \{/);
  assert.match(page, /skuFormReadinessWarnings\.map\(\(warning\) => warning\.field\)/);
  assert.match(page, /for \(const warning of skuFormReferenceWarnings\)/);
  assert.match(page, /const resolvedFields = activeSkuRepairItem\.missingFields\.filter/);
  assert.match(page, /const unresolvedFields = activeSkuRepairItem\.missingFields\.filter/);
  assert.match(page, /skuFormFieldHasUsableValue\(skuForm, field\.field\)/);
  assert.match(page, /className=\{`sku-active-repair-progress \$\{activeSkuRepairProgress\.tone\}`\}/);
  assert.match(page, /activeSkuRepairProgress\.resolvedFields\.length/);
  assert.match(page, /activeSkuRepairProgress\.unresolvedFields\.length/);
  assert.match(page, /保存后 \{skuFormAutomationStatus\.label\}/);

  assert.match(css, /\.sku-active-repair-progress \{/);
  assert.match(css, /\.sku-active-repair-progress\.ready/);
  assert.match(css, /\.sku-active-repair-progress\.blocked/);
  assert.match(css, /\.sku-active-repair-progress p span\.done/);
  assert.match(css, /\.sku-active-repair-progress p span\.pending/);
});

test("sku save blocks invalid references and confirms review risks", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.match(page, /const readinessWarnings = validateSkuFormReadiness\(skuForm\)/);
  assert.match(page, /const blockingWarnings = readinessWarnings\.filter\(\(warning\) => warning\.severity === "error"\)/);
  assert.match(page, /setMessage\(`商品还不能保存：\$\{blockingWarnings\[0\]\.message\}`\)/);
  assert.match(page, /const referenceWarnings = validateSkuFormReferences\(skuForm, knownSkuCodeSet\)/);
  assert.match(page, /setMessage\(`SKU 引用还不能保存：\$\{referenceWarnings\[0\]\.message\}`\)/);
  assert.match(page, /const reviewWarnings = readinessWarnings\.filter\(\(warning\) => warning\.severity === "warning"\)/);
  assert.match(page, /window\.confirm\(/);
  assert.match(page, /这个商品保存后需要人工复核/);
  assert.match(page, /已取消保存，请先补齐会影响自动搭配、报价或采购追踪的资料/);
});

test("sku save success message includes automation outcome and next actions", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.match(page, /function skuSavedOutcomeMessage\(/);
  assert.match(page, /const automationStatus = skuFormAutomationPreview\(skuForm, readinessWarnings\)/);
  assert.match(page, /const saveOutcomeMessage = skuSavedOutcomeMessage\(payload\.skuCode, automationStatus, readinessWarnings\)/);
  assert.match(page, /setMessage\(saveOutcomeMessage\)/);
  assert.ok(page.includes("保存后状态：${automationStatus.label}"));
  assert.ok(page.includes("可进入自动搭配、真实出图预检和报价利润核算"));
  assert.ok(page.includes("已标记为需复核"));
  assert.ok(page.includes("下一步补齐："));
});

test("sku change log shows operational impact for real catalog audit", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function skuChangeImpactSummary\(log: SkuChangeLog\)/);
  assert.match(page, /const impact = skuChangeImpactSummary\(log\)/);
  assert.match(page, /className=\{`sku-change-item \$\{impact\.tone\}`\}/);
  assert.match(page, /className=\{`sku-change-impact \$\{impact\.tone\}`\}/);
  assert.ok(page.includes('"salePrice", "costPrice", "stock", "supplier", "leadTimeDays", "sceneTags", "matchingRules", "replacementSkuCodes"'));
  assert.ok(page.includes('"mainImagePath", "angleImages"'));
  assert.ok(page.includes("影响报价/搭配"));
  assert.ok(page.includes("影响真实出图"));
  assert.ok(page.includes("影响包装/物流"));

  assert.match(css, /\.sku-change-item\.commercial::before/);
  assert.match(css, /\.sku-change-item\.image::before/);
  assert.match(css, /\.sku-change-impact\.commercial/);
  assert.match(css, /\.sku-change-impact\.image/);
  assert.match(css, /\.sku-change-impact\.inactive/);
});

test("sku change log impact can route operators to the right repair workflow", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function handleSkuChangeImpact\(log: SkuChangeLog, impact: ReturnType<typeof skuChangeImpactSummary>\)/);
  assert.match(page, /setSelectedSkuCodes\(\[sku\.skuCode\]\)/);
  assert.match(page, /setSkuRepairFilter\(impact\.repairFilter\)/);
  assert.match(page, /impact\.repairFilter === "image" \? "missing_image" : "problem"/);
  assert.match(page, /onClick=\{\(\) => handleSkuChangeImpact\(log, impact\)\}/);
  assert.match(page, /<Search size=\{14\} aria-hidden="true" \/>\{impact\.nextAction\}/);
  assert.ok(page.includes('nextAction: "处理报价风险"'));
  assert.ok(page.includes('repairFilter: "price_stock"'));
  assert.ok(page.includes('nextAction: "处理图片"'));
  assert.ok(page.includes('repairFilter: "image"'));
  assert.ok(page.includes('nextAction: "处理规格交期"'));
  assert.ok(page.includes('repairFilter: "spec_delivery"'));

  assert.match(css, /\.sku-change-impact-row \.compact-button/);
});

test("sku change logs can be exported for operational handoff", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /function exportSkuChangeLogs\(\)/);
  assert.match(page, /const impact = skuChangeImpactSummary\(log\)/);
  assert.ok(page.includes('"变更时间", "SKU编号", "商品名称", "动作", "来源", "操作者", "影响类型", "影响说明", "建议下一步", "变更字段", "变更前", "变更后", "备注"'));
  assert.ok(page.includes("sku-change-logs-${formatDateForFile(new Date())}.csv"));
  assert.match(page, /downloadTextFile\(fileName, "text\/csv;charset=utf-8", `\\uFEFF\$\{toCsv\(rows\)\}`\)/);
  assert.match(page, /onClick=\{exportSkuChangeLogs\}/);
  assert.match(page, /disabled=\{!visibleSkuChangeLogs\.length \|\| Boolean\(busy\)\}/);
  assert.ok(page.includes("导出变更"));

  assert.match(css, /\.sku-change-log-head > div/);
  assert.match(css, /\.sku-change-log-head \.compact-button/);
});

test("sku change logs can be filtered by operational impact", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");

  assert.match(page, /const skuChangeImpactFilterOptions = \[/);
  assert.match(page, /const \[skuChangeImpactFilter, setSkuChangeImpactFilter\] = useState<string>\("all"\)/);
  assert.match(page, /const \[skuChangeSearch, setSkuChangeSearch\] = useState<string>\(""\)/);
  assert.match(page, /function skuChangeImpactMatchesFilter\(log: SkuChangeLog, filter: string\)/);
  assert.match(page, /function skuChangeMatchesSearch\(log: SkuChangeLog, query: string\)/);
  assert.match(page, /const visibleSkuChangeLogs = useMemo\(/);
  assert.match(page, /skuChangeImpactMatchesFilter\(log, skuChangeImpactFilter\) &&/);
  assert.match(page, /skuChangeMatchesSearch\(log, skuChangeSearch\)/);
  assert.match(page, /const skuChangeImpactFilterCounts = useMemo\(/);
  assert.match(page, /skuChangeImpactFilterOptions\.map\(\(option\) =>/);
  assert.match(page, /aria-label="商品变更影响筛选"/);
  assert.match(page, /aria-label="搜索商品变更"/);
  assert.match(page, /placeholder="搜索 SKU \/ 商品 \/ 操作者 \/ 来源"/);
  assert.match(page, /onChange=\{\(event\) => setSkuChangeSearch\(event\.target\.value\)\}/);
  assert.match(page, /setSkuChangeImpactFilter\(option\.value\)/);
  assert.match(page, /visibleSkuChangeLogs\.slice\(0, 6\)\.map/);
  assert.match(page, /disabled=\{!visibleSkuChangeLogs\.length \|\| Boolean\(busy\)\}/);
  assert.match(page, /const exportableSkuChangeLogs = visibleSkuChangeLogs/);
  assert.ok(page.includes("当前筛选下没有商品变更可导出。"));
  assert.ok(page.includes("当前筛选下没有变更"));
  assert.ok(page.includes("换个关键词，或清空搜索查看全部变更。"));
  assert.ok(page.includes('if (filter === "active") return impact.tone === "active" || impact.tone === "inactive";'));

  assert.match(css, /\.sku-change-filter \{/);
  assert.match(css, /\.sku-change-filter button\.selected/);
  assert.match(css, /\.sku-change-filter button strong/);
  assert.match(css, /\.sku-change-search \{/);
  assert.match(css, /\.sku-change-search input/);
});

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

test("sku import preview can export blocking rows for spreadsheet repair", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.match(page, /function exportSkuImportBlockedRows\(\)/);
  assert.match(page, /const blockedRows = rows[\s\S]*?\.filter\(\(item\) => item\.readiness\.tone === "blocked"\)/);
  assert.ok(page.includes('const fileName = `sku-import-blocked-${formatDateForFile(new Date())}.csv`;'));
  assert.ok(page.includes('downloadTextFile(fileName, "text/csv;charset=utf-8", `\\uFEFF${toCsv(csvRows)}`);'));
  assert.ok(page.includes('"预览行"'));
  assert.ok(page.includes('"SKU编号"'));
  assert.ok(page.includes('"阻塞原因"'));
  assert.ok(page.includes('"体检问题"'));
  assert.ok(page.includes('"场景标签"'));
  assert.match(page, /onClick=\{exportSkuImportBlockedRows\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| !skuImportReadinessSummary\?\.blocked\}/);
  assert.ok(page.includes("导出阻塞清单"));
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
  assert.match(page, /<input[\s\S]*?id="sku-form-replacementSkuCodes"[\s\S]*?list="sku-reference-options"[\s\S]*?value=\{skuForm\.replacementSkuCodes\}/);
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

test("sku import confirmation is blocked when preview has blocking rows", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.match(page, /if \(\(skuImportReadinessSummary\?\.blocked \|\| 0\) > 0\) \{/);
  assert.ok(page.includes("\u5148\u4fee\u6b63\u56fe\u7247\u3001\u4ef7\u683c\u3001\u5e93\u5b58\u3001\u89c4\u683c\u6216\u4ea4\u671f\u540e\u518d\u5165\u5e93"));
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| !skuImportPreview\.rows\.length \|\| Boolean\(skuImportReadinessSummary\?\.blocked\)\}/);
  assert.match(page, /title=\{skuImportReadinessSummary\?\.blocked \? `还有 \$\{skuImportReadinessSummary\.blocked\} 个阻塞项，先修正后再入库` : "确认把这批商品写入商品库"\}/);
});
