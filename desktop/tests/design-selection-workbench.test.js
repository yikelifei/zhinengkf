"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/page.tsx"), "utf8");
const apiSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/lib/api.ts"), "utf8");
const cssSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/globals.css"), "utf8");
const quoteServiceSource = fs.readFileSync(path.join(desktopRoot, "apps/api/src/quotes/quotes.service.ts"), "utf8");

test("design image selection has a typed result and updates local workbench state", () => {
  assert.match(apiSource, /export type DesignImageSelectionResult = \{/);
  assert.match(apiSource, /selectDesignImage\(id: string, input: SelectImagePayload, expected: IdentityExpectation = \{\}\): Promise<DesignImageSelectionResult>/);
  assert.match(pageSource, /function applyDesignImageSelectionResult\(job: DesignJob, result: DesignImageSelectionResult\)/);
  assert.match(pageSource, /upsertDesignJobState\(nextJob\)/);
  assert.match(pageSource, /upsertQuoteState\(result\.quote\)/);
  assert.match(pageSource, /function designImageSelectionSummary\(result: DesignImageSelectionResult\)/);
});

test("current customer design card can select an image without jumping away first", () => {
  assert.match(pageSource, /selectDesignImageForJob\(\s*activeConversationLatestDesignJob,[\s\S]*\{ referencedImageId: image\.id \}/);
  assert.match(pageSource, /"当前客户选图"/);
  assert.match(pageSource, /onClick=\{\(\) => void selectDesignImageForJob\(activeJob, \{ referencedImageId: image\.id \}\)\}/);
});

test("quote and order selected thumbnails use scoped local design preview when job context exists", () => {
  assert.match(pageSource, /<SelectedImageThumb job=\{quote\.designJob\} image=\{selectedImage\} label="报价选图" \/>/);
  assert.match(pageSource, /<SelectedImageThumb job=\{order\.designJob \|\| order\.quoteDraft\?\.designJob \|\| null\} image=\{selectedImage\} label="订单选图" \/>/);
  assert.match(pageSource, /const src = job \? designImagePreviewSrc\(job, image\) : image\?\.downloadUrl \|\| ""/);
  assert.match(pageSource, /<img src=\{src\} alt=\{title\}/);
});

test("current customer design card exposes quote and order next steps", () => {
  assert.match(pageSource, /const activeConversationLatestQuote = activeConversationLatestDesignJob/);
  assert.match(pageSource, /const activeConversationLatestOrderDraft = activeConversationLatestQuote/);
  assert.match(pageSource, /function runActiveConversationDealNextStep\(\)/);
  assert.match(pageSource, /await createQuoteForJob\(activeConversationLatestDesignJob\)/);
  assert.match(pageSource, /className=\{`conversation-design-deal \$\{activeConversationDealNextStep\.tone\}`\}/);
  assert.match(pageSource, /focusQuoteCenter\(activeConversationLatestQuote\.id\)/);
  assert.match(pageSource, /focusOrderDraft\(activeConversationLatestOrderDraft\)/);
  assert.match(cssSource, /\.conversation-design-deal\s*\{/);
  assert.match(cssSource, /\.conversation-design-deal-actions\s*\{/);
  assert.match(cssSource, /conversation-design-thumbs,\s*[\s\S]*conversation-design-deal/);
});

test("quick image send and quote creation ask for human confirmation", () => {
  assert.match(pageSource, /function confirmDesignImageQuickSend\(job: DesignJob\)/);
  assert.match(pageSource, /系统会继续通过账号、聊天对象、最近消息三重校验后再发送/);
  assert.match(pageSource, /if \(!confirmDesignImageQuickSend\(activeJob\)\) return/);
  assert.match(pageSource, /quickConfirmSend\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(pageSource, /function confirmDesignJobQuoteCreation\(job: DesignJob\)/);
  assert.match(pageSource, /系统会按当前礼盒组合、数量、售价、成本和利润生成报价草稿/);
  assert.match(pageSource, /if \(!confirmDesignJobQuoteCreation\(job\)\) return/);
  assert.match(pageSource, /createQuote\(job\.id, identityExpectation\(job\)\)/);
  assert.match(pageSource, /async function quoteActiveJob\(\)[\s\S]*await createQuoteForJob\(activeJob\)/);
});

test("current customer design card can submit revision requests through the existing design job API", () => {
  assert.match(pageSource, /async function requestRevisionForJob\(job: DesignJob(?: \| null \| undefined)?, label = /);
  assert.match(pageSource, /const result = await requestDesignRevision\(job\.id,/);
  assert.match(pageSource, /upsertDesignJobState\(result\.job\)/);
  assert.match(pageSource, /upsertReviewDesignJobState\(result\.job\)/);
  assert.match(pageSource, /const activeConversationLatestRevision = activeConversationLatestDesignJob\?\.revisions/);
  assert.match(pageSource, /const activeConversationCanSubmitRevision = Boolean\(/);
  assert.match(pageSource, /className=\{`conversation-design-revision/);
  assert.match(pageSource, /className="conversation-design-revision-input"/);
  assert.match(pageSource, /requestRevisionForJob\(activeConversationLatestDesignJob,\s*"[^"]+"\)/);
  assert.match(cssSource, /\.conversation-design-revision\s*\{/);
  assert.match(cssSource, /\.conversation-design-revision-input\s*\{/);
  assert.match(cssSource, /\.conversation-design-revision-actions\s*\{/);
  assert.match(cssSource, /conversation-design-deal,\s*[\s\S]*\.conversation-design-revision-head\s*\{/);
});

test("revision candidate images are grouped by latest round and selected by stable image id", () => {
  assert.match(pageSource, /function designImageRevisionRound\(image\?: DesignImageCandidate \| null\)/);
  assert.match(pageSource, /const imageIdMatch = \/\^r\(\\d\+\)-\//);
  assert.match(pageSource, /return position >= 100 \? Math\.floor\(position \/ 100\) : 0/);
  assert.match(pageSource, /function latestDesignRoundImages\(images: DesignImageCandidate\[\]\)/);
  assert.match(pageSource, /function componentLatestDesignImageRound\(images\?: NonNullable<DesignJob\["images"\]> \| null\)/);
  assert.match(pageSource, /function componentDesignImagesForRound\(images: NonNullable<DesignJob\["images"\]>, round: number\)/);
  assert.match(pageSource, /const activeConversationLatestImageRound = componentLatestDesignImageRound\(activeConversationLatestDesignImages\)/);
  assert.match(pageSource, /const activeConversationVisibleDesignImages = componentDesignImagesForRound\(/);
  assert.match(pageSource, /activeConversationOlderDesignImageCount/);
  assert.match(pageSource, /activeConversationVisibleDesignImages\.slice\(0, 4\)\.map/);
  assert.match(pageSource, /designImageSelectionRoundSummary\(image\)/);
  assert.match(pageSource, /await selectDesignImageForJob\(activeJob, \{ referencedImageId: target\.id \}, "模拟客户选图"\)/);
});

test("quote creation does not silently reuse old revision images", () => {
  assert.match(quoteServiceSource, /latestCandidateRound/);
  assert.match(quoteServiceSource, /const latestImages = latestCandidateRound\(job\.images \|\| \[\]\)/);
  assert.match(quoteServiceSource, /selectedImageId[\s\S]*job\.images\.find[\s\S]*latestImages\.find/);
  assert.doesNotMatch(quoteServiceSource, /job\.images\.find\(\(item\) => item\.selected\) \|\| job\.images\[0\]/);
});
