"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const base = "apps/web/src/components/workbench-shell";
const sidebar = read(`${base}/app-sidebar.tsx`);
const topbar = read(`${base}/app-topbar.tsx`);
const shell = read(`${base}/workbench-shell.tsx`);
const navigation = read(`${base}/navigation.ts`);
const types = read(`${base}/types.ts`);
const index = read(`${base}/index.ts`);
const css = read(`${base}/workbench-shell.module.css`);

test("workbench shell exports modular sidebar, topbar, shell, navigation, and shared types", () => {
  assert.match(index, /export \{ AppSidebar \} from "\.\/app-sidebar";/);
  assert.match(index, /export \{ AppTopbar \} from "\.\/app-topbar";/);
  assert.match(index, /export \{ WorkbenchShell \} from "\.\/workbench-shell";/);
  assert.match(index, /export \{ DEFAULT_WORKBENCH_NAVIGATION \} from "\.\/navigation";/);
  assert.match(index, /WorkspaceSectionId/);
  assert.match(types, /className\?: string;/);
});

test("default navigation uses the seven required groups and only existing page section IDs", () => {
  const groupLabels = [...navigation.matchAll(/\r?\n\s+label: "([^"]+)",\r?\n\s+items:/g)].map((match) => match[1]);
  assert.deepEqual(groupLabels, [
    "工作台",
    "消息",
    "微信接入",
    "设计中心",
    "商品与订单",
    "自动化与训练",
    "系统管理",
  ]);

  const expectedIds = [
    "overview-center",
    "conversation-center",
    "routing-center",
    "send-center",
    "wechat-channel-center",
    "design-platform-config",
    "asset-center",
    "design-center",
    "review-center",
    "sku-library",
    "catalog-center",
    "quote-center",
    "notice-center",
    "agent-center",
    "training-center",
    "account-center",
  ];
  for (const id of expectedIds) assert.match(navigation, new RegExp(`id: "${id}"`));

  assert.doesNotMatch(navigation, /customer-center|order-center|after-sales-center|knowledge-center/);
  assert.doesNotMatch(navigation, /客户管理|订单管理|售后管理|知识库/);
});

test("sidebar stays caller-controlled and provides keyboard-accessible desktop and mobile navigation", () => {
  assert.match(sidebar, /activeSectionId,/);
  assert.match(sidebar, /onSelect\?\.\(sectionId\);/);
  assert.match(sidebar, /<nav id="workbench-desktop-navigation" className=\{styles\.sidebarNav\} aria-label="工作台主导航">/);
  assert.match(sidebar, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(sidebar, /aria-expanded=\{mobileNavigationOpen\}/);
  assert.match(sidebar, /aria-controls=\{MOBILE_NAVIGATION_ID\}/);
  assert.match(sidebar, /role="dialog"/);
  assert.match(sidebar, /aria-modal="true"/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(sidebar, /event\.key !== "Tab"/);
  assert.match(sidebar, /firstMobileItemRef\.current\?\.focus\(\)/);
  assert.match(sidebar, /mobileTriggerRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(sidebar, /location\.hash|history\.|scrollIntoView/);
  assert.doesNotMatch(sidebar, /aria-controls=\{item\.controlsId\}/);
  assert.doesNotMatch(sidebar, /role="menu"|role="tablist"/);
});

test("topbar exposes optional real search, refresh, and text-labelled health status contracts", () => {
  assert.match(topbar, /searchEnabled = Boolean\(onSearchChange \|\| onSearchSubmit\)/);
  assert.match(topbar, /<form className=\{styles\.topbarSearch\} role="search"/);
  assert.match(topbar, /<label className=\{styles\.srOnly\} htmlFor="workbench-global-search">全局搜索<\/label>/);
  assert.match(topbar, /aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(topbar, /onSearchSubmit\?\.\(internalSearchValue\)/);
  assert.match(topbar, /onRefresh/);
  assert.match(topbar, /\{item\.label\}/);
  assert.match(topbar, /data-tone=\{item\.tone\}/);
});

test("shell provides one composable main landmark and accepts legacy compatibility classes", () => {
  assert.match(shell, /\[styles\.shellFrame, className\]\.filter\(Boolean\)\.join\(" "\)/);
  assert.match(shell, /data-has-topbar=\{topbar \? "true" : "false"\}/);
  assert.match(shell, /<main className=\{styles\.shellContent\} aria-label=\{contentLabel\}>/);
  assert.doesNotMatch(shell, /<main[\s\S]*<main/);
  assert.doesNotMatch(shell, /<section className=\{styles\.shellContent\}/);
});

test("shared CSS uses compact Tencent tokens and a complete 390px mobile bottom-navigation path", () => {
  assert.match(css, /--workbench-brand:\s*var\(--wk-color-brand\);/);
  assert.match(css, /--workbench-surface:\s*var\(--wk-color-surface\);/);
  assert.match(css, /grid-template-columns:\s*var\(--wk-sidebar-width\) minmax\(0, 1fr\);/);
  assert.match(css, /grid-template-rows:\s*60px minmax\(0, 1fr\);/);
  assert.match(css, /\.mainColumn\[data-has-topbar="false"\]\s*\{\s*grid-template-rows:\s*minmax\(0, 1fr\);/);
  assert.match(css, /min-height:\s*34px;/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/i);

  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile, /\.sidebarRail\s*\{\s*display:\s*none;/);
  assert.match(mobile, /\.mobileNav\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(mobile, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(mobile, /env\(safe-area-inset-bottom\)/);
  assert.match(mobile, /\.mobileDrawerLayer\s*\{[\s\S]*?display:\s*block;/);
  assert.match(mobile, /\.topbarActions\s*\{\s*display:\s*none;/);
  assert.match(css, /@media \(max-width: 390px\)/);
});
