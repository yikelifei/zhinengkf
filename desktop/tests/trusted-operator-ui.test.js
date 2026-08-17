"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("review and training writes resolve reviewer from the trusted operator status", () => {
  const trustedOperator = read("apps/web/src/features/governance/trusted-operator.ts");
  assert.match(trustedOperator, /getOperatorAccessStatus/);
  assert.match(trustedOperator, /trustedPrincipal/);
  assert.match(trustedOperator, /enforcementReady/);
  assert.match(trustedOperator, /status\.principal\?\.id/);
  assert.match(trustedOperator, /resolveTrustedOperator/);
  assert.match(trustedOperator, /useTrustedOperator/);

  for (const page of [
    "apps/web/src/features/reviews/review-design-page.tsx",
    "apps/web/src/features/reviews/review-quotes-page.tsx",
    "apps/web/src/features/reviews/review-orders-page.tsx",
  ]) {
    const source = read(page);
    assert.match(source, /useTrustedOperator\(reviewer\)/, `${page} should load the server-trusted operator status`);
    assert.match(
      source,
      /trustedReviewer\(reviewer,\s*trustedOperator\.status\)/,
      `${page} should not depend only on a route-provided reviewer`,
    );
  }

  for (const page of [
    "apps/web/src/features/training/training-review-page.tsx",
    "apps/web/src/features/training/training-review-detail-page.tsx",
  ]) {
    const source = read(page);
    assert.match(source, /useTrustedOperator\(reviewer\)/, `${page} should load the server-trusted operator status`);
    assert.match(source, /trustedOperator\.reviewer/, `${page} should use the resolved trusted reviewer`);
  }
});

test("mutation pages do not hard-code the local desktop administrator", () => {
  const mutationPages = [
    "apps/web/src/features/reviews/review-design-page.tsx",
    "apps/web/src/features/reviews/review-quotes-page.tsx",
    "apps/web/src/features/reviews/review-orders-page.tsx",
    "apps/web/src/features/training/training-review-page.tsx",
    "apps/web/src/features/training/training-review-detail-page.tsx",
    "apps/web/src/app/reviews/design/[id]/page.tsx",
    "apps/web/src/app/reviews/quotes/[id]/page.tsx",
    "apps/web/src/app/reviews/orders/[id]/page.tsx",
    "apps/web/src/app/training/review/batch/page.tsx",
    "apps/web/src/app/training/review/[id]/page.tsx",
  ].map(read).join("\n");

  assert.doesNotMatch(mutationPages, /local_admin/);
  assert.doesNotMatch(mutationPages, /reviewer=["']local_admin["']/);
});

test("trusted operator status is backed by the desktop API proxy token boundary", () => {
  const proxy = read("apps/web/src/app/api/[...path]/route.ts");
  const service = read("apps/api/src/operator-access/operator-access.service.ts");

  assert.match(proxy, /INTERNAL_API_TOKEN_HEADER/);
  assert.match(proxy, /buildDesktopApiUpstreamHeaders/);
  assert.match(proxy, /RESPONSE_HEADERS_TO_REMOVE[\s\S]*INTERNAL_API_TOKEN_HEADER/);
  assert.match(service, /LOCAL_ADMIN_PRINCIPAL/);
  assert.match(service, /authenticateTrustedPrincipal/);
  assert.match(service, /trustedPrincipal:\s*true/);
});

test("review pages surface trusted desktop session failures instead of only disabling actions", () => {
  const trustedOperator = read("apps/web/src/features/governance/trusted-operator.ts");
  const reviewShared = read("apps/web/src/features/reviews/review-page-shared.tsx");
  assert.match(trustedOperator, /isTrustedDesktopSessionError/);
  assert.match(trustedOperator, /sessionBlocked/);
  assert.match(reviewShared, /isTrustedDesktopSessionError/);
  assert.match(reviewShared, /sessionBlocked/);

  for (const page of [
    "apps/web/src/features/reviews/review-inbox-page.tsx",
    "apps/web/src/features/reviews/review-queue-pages.tsx",
    "apps/web/src/features/reviews/review-design-page.tsx",
    "apps/web/src/features/reviews/review-quotes-page.tsx",
    "apps/web/src/features/reviews/review-orders-page.tsx",
  ]) {
    const source = read(page);
    assert.match(source, /需要可信桌面会话/, `${page} should explain the desktop session requirement`);
    assert.match(source, /重启客服启动器/, `${page} should give a concrete recovery action`);
  }

  for (const page of [
    "apps/web/src/features/reviews/review-design-page.tsx",
    "apps/web/src/features/reviews/review-quotes-page.tsx",
    "apps/web/src/features/reviews/review-orders-page.tsx",
  ]) {
    const source = read(page);
    assert.match(source, /reviewSessionBlocked/, `${page} should merge load, operator, and mutation session failures`);
    assert.match(source, /!operator && !reviewSessionBlocked/, `${page} should not hide the real session failure behind a generic operator message`);
  }
});
