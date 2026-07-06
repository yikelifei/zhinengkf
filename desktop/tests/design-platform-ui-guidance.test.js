"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/page.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/globals.css"), "utf8");
const apiSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/lib/api.ts"), "utf8");
const controllerSource = fs.readFileSync(
  path.join(desktopRoot, "apps/api/src/integrations/design-platform/design-platform.controller.ts"),
  "utf8",
);
const serviceSource = fs.readFileSync(path.join(desktopRoot, "apps/api/src/design-jobs/design-jobs.service.ts"), "utf8");

test("design platform UI explains mock mode and real startup path", () => {
  assert.match(pageSource, /当前是流程联调模式/);
  assert.match(pageSource, /不会调用真实设计平台/);
  assert.match(pageSource, /run_desktop_real_design\.bat/);
  assert.match(pageSource, /npm\.cmd run ports:launch:real:confirmed/);
});

test("design platform adapter switch resets known default base urls", () => {
  assert.match(pageSource, /ART_IMAGE_LOCAL_DEFAULT_BASE_URL = "http:\/\/127\.0\.0\.1:3000"/);
  assert.match(pageSource, /STANDARD_V1_DEFAULT_BASE_URL = "http:\/\/127\.0\.0\.1:3700"/);
  assert.match(pageSource, /shouldUseDesignPlatformDefaultBaseUrl\(current\.baseUrl\)/);
  assert.match(pageSource, /designPlatformDefaultBaseUrl\(option\.value\)/);
});

test("design platform guidance is visible in config summary without moving form panels", () => {
  const summaryIndex = pageSource.indexOf('className="config-summary"');
  const guideIndex = pageSource.indexOf("config-mode-guide", summaryIndex);
  const formIndex = pageSource.indexOf('className="config-form-grid"');

  assert.ok(summaryIndex > 0, "config summary should exist");
  assert.ok(guideIndex > summaryIndex, "guide should live inside the summary area");
  assert.ok(guideIndex < formIndex, "guide should not change the form grid child order");
  assert.match(cssSource, /\.config-mode-guide/);
  assert.match(cssSource, /grid-template-rows: minmax\(94px, 156px\) minmax\(0, 1fr\)/);
});

test("design task failure guidance is visible and supports safe retry", () => {
  assert.match(pageSource, /const activeDesignEscalationNotice = activeJob \? designJobEscalationNotice\(activeJob\) : null/);
  assert.match(pageSource, /className=\{`design-escalation-notice \$\{activeDesignEscalationNotice\.tone\}`\}/);
  assert.match(pageSource, /失败原因：\$\{readableError\}/);
  assert.match(pageSource, /canRetryDesignJobFromUi\(activeJob\)/);
  assert.match(pageSource, /job\.status === "manual_review" && Boolean\(job\.errorMessage\)/);
  assert.match(pageSource, /setReviewWorkbenchView\("design"\)/);
  assert.match(pageSource, /className="job-next-action"/);
  assert.match(cssSource, /\.design-escalation-notice/);
  assert.match(cssSource, /\.design-escalation-actions/);
  assert.match(cssSource, /\.job-row \.job-next-action/);
});

test("design polling explains terminal jobs without implying a remote status change", () => {
  const pollSection = pageSource.slice(
    pageSource.indexOf("async function pollDesignJobIntoState"),
    pageSource.indexOf("async function pollActiveJob"),
  );
  assert.match(pollSection, /result\.remoteStatus === "terminal"/);
  assert.match(pollSection, /任务已进入客户确认后的终态/);
  assert.match(pollSection, /已跳过轮询/);
});

test("design task preflight shows output count and result delivery fallback", () => {
  assert.match(apiSource, /requiredOutputCountRange/);
  assert.match(apiSource, /fallbackPolling/);
  assert.match(pageSource, /候选图：\{outputCountText\}/);
  assert.match(pageSource, /结果回传：\{callbackText\}/);
});

test("design submit action runs task preflight before calling submit", () => {
  const submitSection = pageSource.slice(
    pageSource.indexOf("async function submitActiveJob"),
    pageSource.indexOf("async function runDesignJobPreflight"),
  );
  assert.match(submitSection, /const preflight = await runDesignJobPreflight\(job\)/);
  assert.match(submitSection, /if \(!preflight\.ok\)/);
  assert.match(submitSection, /提交已停止/);
  assert.match(submitSection, /await submitDesignJob\(job\.id, identityExpectation\(job\)\)/);
  assert.ok(
    submitSection.indexOf("runDesignJobPreflight(job)") < submitSection.indexOf("submitDesignJob(job.id"),
    "submit should only run after task preflight",
  );
});

test("design center active view hides sibling panels instead of clipping them", () => {
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] > \.main-grid \{/);
  assert.match(cssSource, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] > \.main-grid > \.panel:not\(#design-center\)/);
  assert.match(cssSource, /display: none !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] #design-center/);
  assert.match(cssSource, /grid-column: 1 \/ -1/);
});

test("design center mobile commands and empty actions fit one app viewport", () => {
  assert.match(cssSource, /Iteration 89 Design center mobile containment/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \.top-actions \.toolbar-group\.context-toolbar/);
  assert.match(cssSource, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] #design-center \.empty\.empty-cta \.empty-actions/);
  assert.match(cssSource, /min-height: 154px !important/);
  assert.match(cssSource, /max-height: 188px !important/);
  assert.match(cssSource, /-webkit-line-clamp: 2/);
  assert.match(cssSource, /width: min\(100%, 210px\) !important/);
  assert.match(cssSource, /min-height: 31px !important/);
  assert.match(cssSource, /overflow-x: hidden !important/);
  assert.match(cssSource, /text-overflow: ellipsis !important/);
});

test("design platform config exposes a real one-click smoke test path", () => {
  assert.match(pageSource, /smokeTestDesignPlatform/);
  assert.match(pageSource, /试跑出图/);
  assert.match(pageSource, /platform-smoke-result/);
  assert.match(pageSource, /platform-smoke-gallery/);
  assert.match(pageSource, /platform-smoke-contract/);
  assert.match(pageSource, /设计平台接口契约检查/);
  assert.match(pageSource, /expectedCandidateCount/);
  assert.match(pageSource, /savedImagePreviews/);
  assert.match(apiSource, /runDesignPlatformSmokeTest/);
  assert.match(apiSource, /savedImagePreviews/);
  assert.match(apiSource, /contractChecks/);
  assert.match(apiSource, /expectedCandidateCount/);
  assert.match(apiSource, /\/integrations\/design-platform\/smoke-test/);
  assert.match(controllerSource, /@Post\("smoke-test"\)/);
  assert.match(controllerSource, /runDesignPlatformSmokeTest/);
  assert.match(serviceSource, /prepareSmokeAssets/);
  assert.match(serviceSource, /waitForSmokeDesignResult/);
  assert.match(serviceSource, /assertSmokeContract/);
  assert.match(serviceSource, /image_metadata/);
  assert.match(serviceSource, /localImagePreviewDataUrl/);
  assert.match(cssSource, /\.platform-smoke-gallery/);
  assert.match(cssSource, /\.platform-smoke-contract/);
});
