"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("design job detail exposes a dedicated quote creation route", () => {
  const detail = read("apps/web/src/features/design/design-job-detail-page.tsx");
  const api = read("apps/web/src/features/design/api.ts");
  const css = read("apps/web/src/features/design/design-pages.module.css");
  const route = read("apps/web/src/app/design/jobs/[id]/quote/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");

  assert.match(detail, /\/quote/);
  assert.match(detail, /data-action-id="design-job-open-quote"/);
  assert.match(detail, /selectDesignImage\(selected\.id, \{ referencedImageId: imageKey \}, expected\)/);
  assert.match(detail, /data-action-id=\{`design-image-select-customer-choice-\$\{imageActionKey\}`\}/);
  assert.match(detail, /selectionNotice\.quoteId/);
  assert.match(detail, /客户已选/);
  assert.match(api, /selectDesignImage/);
  assert.match(css, /\.imageSelectionBadge/);
  assert.match(css, /\.imageSelectButton/);
  assert.match(route, /routeId="designJobQuote"/);
  assert.match(route, /<DesignJobQuotePage key=\{id\} jobId=\{id\}/);
  assert.match(manifest, /designJobQuote/);
  assert.match(manifest, /不发送客户消息/);
});

test("design quote action page uses the existing design quote API only", () => {
  const page = read("apps/web/src/features/design/design-job-quote-page.tsx");
  const css = read("apps/web/src/features/design/design-pages.module.css");
  const api = read("apps/web/src/features/design/api.ts");
  const clientApi = read("apps/web/src/lib/api.ts");
  const operationKey = read("apps/web/src/lib/client-operation-key.ts");

  assert.match(page, /identityExpectation\(selected\)/);
  assert.match(page, /DesignQuoteImagePreview/);
  assert.match(page, /designImagePreviewSrc\(job, previewImage\)/);
  assert.match(page, /firstSkuImage\(item\)/);
  assert.match(page, /localAssetUrl\(reference\)/);
  assert.match(page, /safeRenderableImageSrc\(reference\)/);
  assert.match(page, /aria-label="报价图片预览"/);
  assert.match(css, /\.quoteImagePreviewPanel/);
  assert.match(css, /\.quoteSelectedPreview/);
  assert.match(css, /\.quoteBundlePreviewGrid/);
  assert.match(css, /\.quoteBundlePreviewTile/);
  assert.match(page, /reserveClientOperation\(\s*"quote-create"/);
  assert.match(page, /createQuote\(selected\.id, expected\)/);
  assert.match(page, /下一步：核对报价/);
  assert.match(page, /className=\{styles\.handoffPanel\}/);
  assert.match(page, /data-action-id="design-job-quote-open-created"/);
  assert.match(page, /designIdentityHref\(`\/sales\/quotes\/\$\{encodeURIComponent\(quote\.id\)\}`/);
  assert.doesNotMatch(page, /design-job-quote-open-(?:send|payment|order)/);
  assert.doesNotMatch(page, /\/sales\/quotes\/\$\{encodeURIComponent\(quote\.id\)\}\/(?:send|verify-payment|create-order)/);
  assert.match(css, /\.handoffPanel\s*\{[\s\S]*?border-top:\s*1px solid var\(--wk-color-border\);/);
  assert.match(api, /createQuote/);
  assert.match(clientApi, /postJson<QuoteDraft>\(`\/design-jobs\/\$\{id\}\/quote`, expected\)/);
  assert.match(operationKey, /"quote-create"/);
  assert.doesNotMatch(page, /queueQuoteSend|verifyQuotePaymentProofAndQueueConfirmation|createOrderDraftFromQuote/);
});

test("sales quote and order details keep design images and bundle products visible", () => {
  const quoteDetail = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const orderDetail = read("apps/web/src/features/sales/sales-order-detail-page.tsx");
  const visualSummary = read("apps/web/src/features/sales/sales-design-visual-summary.tsx");
  const css = read("apps/web/src/features/sales/sales-pages.module.css");
  const api = read("apps/web/src/lib/api.ts");
  const imageSrc = read("apps/web/src/lib/renderable-image-src.ts");

  assert.match(quoteDetail, /<SalesDesignVisualSummary record=\{selected\}/);
  assert.match(orderDetail, /<SalesDesignVisualSummary record=\{selected\}/);
  assert.match(visualSummary, /aria-label="设计效果与搭配商品"/);
  assert.match(visualSummary, /localDesignImageUrl/);
  assert.match(visualSummary, /localAssetUrl/);
  assert.match(visualSummary, /VisualFigure/);
  assert.match(visualSummary, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(visualSummary, /designImageLocalFileUnavailable\(image\)/);
  assert.match(visualSummary, /selectedImageSnapshot/);
  assert.match(visualSummary, /bundleSnapshot/);
  assert.match(visualSummary, /isOrderRecord\(record\) && record\.selectedImageSnapshot/);
  assert.match(visualSummary, /const bundle = snapshotBundle \|\| liveBundle/);
  assert.match(visualSummary, /record\.designJob\?\.bundle/);
  assert.match(visualSummary, /record\.quoteDraft\?\.designJob\?\.bundle|orderQuoteDraft\(record\)\?\.designJob\?\.bundle/);
  assert.match(visualSummary, /data-image-state=\{ready \? "ready" : "missing"\}/);
  assert.match(visualSummary, /safeRenderableImageSrc/);
  assert.match(imageSrc, /\^data:image/);
  assert.match(imageSrc, /\^https:/);
  assert.match(imageSrc, /src\.startsWith\("\/api\/"\)/);
  assert.match(imageSrc, /src\.startsWith\("\/local-assets\/"\)/);
  assert.match(imageSrc, /src\.startsWith\("\/generated\/"\)/);
  assert.match(imageSrc, /isTrustedLoopbackGeneratedImageSrc/);
  assert.match(imageSrc, /url\.pathname\.startsWith\("\/local-assets\/"\)/);
  assert.match(imageSrc, /url\.pathname\.startsWith\("\/generated\/"\)/);
  assert.doesNotMatch(imageSrc, /pathname\.startsWith\("\/files\/"\)/);
  assert.doesNotMatch(visualSummary, /image\.downloadUrl \|\| image\.localPath/);
  assert.doesNotMatch(visualSummary, /\^data:\//);
  assert.match(visualSummary, /mainImagePath/);
  assert.match(visualSummary, /mainImageUrl/);
  assert.match(visualSummary, /imagePath/);
  assert.match(visualSummary, /productImage/);
  assert.match(visualSummary, /skuImageUrl/);
  assert.match(visualSummary, /primaryImage/);
  assert.match(visualSummary, /imageRefs/);
  assert.match(visualSummary, /gallery/);
  assert.match(css, /\.visualSummary/);
  assert.match(css, /\.selectedDesignImage/);
  assert.match(css, /\.bundleImageGrid/);
  assert.match(css, /\.bundleImageTile/);
  assert.match(css, /\.visualSummaryGrid,[\s\S]*?\.stageGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(api, /selectedImageSnapshot\?: Record<string, unknown> \| null/);
  assert.match(api, /bundleSnapshot\?: Record<string, unknown> \| null/);
});

test("sales quote detail exposes read-only payment event ledger", () => {
  const quoteDetail = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const css = read("apps/web/src/features/sales/sales-pages.module.css");
  const api = read("apps/web/src/lib/api.ts");

  assert.match(quoteDetail, /type PaymentEvent/);
  assert.match(quoteDetail, /<QuotePaymentLedger events=\{selected\.paymentEvents \|\| \[\]\}/);
  assert.match(quoteDetail, /aria-label="报价付款事件流水"/);
  assert.match(quoteDetail, /events\.map\(\(event\) => <QuotePaymentEventRow event=\{event\}/);
  assert.match(quoteDetail, /paymentStatusLabel\(event\.paymentStatus\)/);
  assert.match(quoteDetail, /paymentAmount\(event\.amountCny\)/);
  assert.match(quoteDetail, /data-payment-field="method"[\s\S]*?event\.method/);
  assert.match(quoteDetail, /data-payment-field="proof"[\s\S]*?event\.proofReference/);
  assert.match(quoteDetail, /data-payment-field="reviewer"[\s\S]*?event\.reviewer/);
  assert.match(quoteDetail, /data-payment-field="createdAt"[\s\S]*?event\.createdAt/);
  assert.match(quoteDetail, /还没有付款核验事件/);
  assert.match(css, /\.paymentLedgerFields/);
  assert.match(api, /paymentEvents\?: PaymentEvent\[\]/);
  assert.match(api, /reviewer\?: string \| null/);
  assert.match(api, /proofReference\?: string \| null/);
});

test("sales quote and order lists expose image thumbnails before opening details", () => {
  const quoteList = read("apps/web/src/features/sales/sales-quotes-page.tsx");
  const orderList = read("apps/web/src/features/sales/sales-orders-page.tsx");
  const visualSummary = read("apps/web/src/features/sales/sales-design-visual-summary.tsx");
  const css = read("apps/web/src/features/sales/sales-pages.module.css");

  assert.match(quoteList, /SalesRecordVisualStrip/);
  assert.match(quoteList, /<SalesRecordVisualStrip record=\{quote\}/);
  assert.match(orderList, /SalesRecordVisualStrip/);
  assert.match(orderList, /<SalesRecordVisualStrip record=\{order\}/);
  assert.match(visualSummary, /export function SalesRecordVisualStrip/);
  assert.match(visualSummary, /recordVisualStrip/);
  assert.match(visualSummary, /recordDesignThumb/);
  assert.match(visualSummary, /recordBundleThumbs/);
  assert.match(visualSummary, /data-image-state=\{ready \? "ready" : "missing"\}/);
  assert.match(visualSummary, /bundleItems\.slice\(0,\s*3\)/);
  assert.match(visualSummary, /missingCount/);
  for (const selector of [
    ".recordVisualStrip",
    ".recordDesignThumb",
    ".recordBundleThumbs",
    ".recordBundleThumb",
    ".recordVisualStatus",
  ]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /width:\s*54px/);
  assert.match(css, /width:\s*34px/);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /recordVisualStrip[\s\S]*?flex-wrap:\s*wrap/);
});
