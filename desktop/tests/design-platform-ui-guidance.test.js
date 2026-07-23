"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/page.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/globals.css"), "utf8");
const workbenchShellCss = fs.readFileSync(
  path.join(desktopRoot, "apps/web/src/components/workbench-shell/workbench-shell.module.css"),
  "utf8",
);
const workbenchSidebarSource = fs.readFileSync(
  path.join(desktopRoot, "apps/web/src/components/workbench-shell/app-sidebar.tsx"),
  "utf8",
);
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
  assert.match(cssSource, /Iteration 96 Design center mobile command density/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \.top-actions \.toolbar-group\.context-toolbar/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \{[\s\S]*display: grid !important[\s\S]*width: min\(100%, 100dvw\) !important[\s\S]*overflow-x: hidden !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \.top-actions \{[\s\S]*width: min\(100%, calc\(100dvw - 28px\)\) !important[\s\S]*align-self: stretch !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] > \.main-grid,[\s\S]*\.workspace\[data-active-section="design-center"\] #design-center \{[\s\S]*width: min\(100%, 100dvw\) !important[\s\S]*overflow-x: hidden !important/);
  assert.match(cssSource, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \.top-actions \.toolbar-group\.status-group[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \.top-actions \.toolbar-group\.context-toolbar\.design-platform-toolbar[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] \.topbar \.top-actions \.toolbar-group\.context-toolbar\.design-workspace-toolbar[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(cssSource, /\.toolbar-group\.status-group \.platform-pill[\s\S]*min-width: 0 !important/);
  assert.match(cssSource, /font-size: 10\.5px !important/);
  assert.match(cssSource, /min-height: 33px !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] #design-center \.job-row \{[\s\S]*grid-template-columns: 12px minmax\(0, 1fr\) !important[\s\S]*overflow: hidden !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] #design-center \.job-row em \{[\s\S]*grid-column: 2 !important[\s\S]*text-overflow: ellipsis !important/);
  assert.match(cssSource, /\.workspace\[data-active-section="design-center"\] #design-center \.empty\.empty-cta \.empty-actions/);
  assert.match(cssSource, /min-height: 154px !important/);
  assert.match(cssSource, /max-height: 188px !important/);
  assert.match(cssSource, /-webkit-line-clamp: 2/);
  assert.match(cssSource, /width: min\(100%, 210px\) !important/);
  assert.match(cssSource, /min-height: 31px !important/);
  assert.match(cssSource, /overflow-x: hidden !important/);
  assert.match(cssSource, /text-overflow: ellipsis !important/);
});

test("mobile global navigation uses a bottom app dock instead of a stacked top rail", () => {
  assert.match(workbenchSidebarSource, /<nav className=\{styles\.mobileNav\}/);
  assert.match(workbenchSidebarSource, /primaryMobileItems\.map/);
  assert.match(workbenchSidebarSource, /aria-expanded=\{mobileNavigationOpen\}/);
  assert.match(workbenchSidebarSource, /aria-controls=\{MOBILE_NAVIGATION_ID\}/);
  assert.match(workbenchSidebarSource, /role="dialog"/);
  assert.match(workbenchShellCss, /@media \(max-width: 760px\)/);
  assert.match(workbenchShellCss, /\.sidebarRail \{\s*display: none/);
  assert.match(workbenchShellCss, /\.mobileNav \{[\s\S]*position: fixed[\s\S]*bottom: 0[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(workbenchShellCss, /min-height: calc\(58px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(workbenchShellCss, /\.shellContent \{\s*padding-bottom: calc\(58px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(workbenchShellCss, /@media \(max-width: 390px\)/);
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
