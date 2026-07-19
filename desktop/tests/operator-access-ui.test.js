"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const { OperatorAccessPanel } = require("../apps/web/src/components/operator-access-panel");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const source = read("apps/web/src/components/operator-access-panel.tsx");
const css = read("apps/web/src/components/operator-access-panel.module.css");

const roles = ["admin", "supervisor", "agent", "read_only"];
const capabilities = [
  "view_console",
  "manage_channels",
  "manage_assignments",
  "reply_conversations",
  "approve_send",
  "manage_design_executions",
  "manage_training",
  "manage_roles",
];

function renderPanel(overrides = {}) {
  const status = {
    mode: "preflight_only",
    policyLoaded: true,
    trustedPrincipal: false,
    enforcementReady: false,
    authenticationProvider: "not_configured",
    roleBindingReady: false,
    defaultDecision: "deny",
    blockers: [{ code: "trusted_principal_missing", message: "尚未接入真实登录或 SSO。" }],
    requiredNextSteps: ["接入真实登录或企业 SSO。"],
    notice: "仅为策略预检。",
  };
  const policy = {
    version: "v1",
    mode: "preflight_only",
    defaultDecision: "deny",
    roles,
    capabilities,
    matrix: {
      admin: capabilities,
      supervisor: capabilities.filter((item) => item !== "manage_roles"),
      agent: ["view_console", "reply_conversations"],
      read_only: ["view_console"],
    },
  };
  const readiness = {
    trustedPrincipal: false,
    enforcementReady: false,
    requiredNextSteps: ["接入真实登录或企业 SSO。", "由服务端维护用户角色绑定。"],
  };
  return renderToStaticMarkup(
    OperatorAccessPanel({
      status: overrides.status || status,
      policy: overrides.policy || policy,
      readiness: overrides.readiness || readiness,
    }),
  );
}

test("panel renders four roles and eight capabilities as a semantic matrix", () => {
  const html = renderPanel();
  assert.match(html, /<table>/);
  assert.match(html, /<caption[^>]*>管理员、主管、客服和只读角色的八项能力矩阵<\/caption>/);
  for (const label of ["管理员", "主管", "客服", "只读"]) assert.match(html, new RegExp(label));
  for (const label of ["查看工作台", "管理渠道", "管理会话分配", "回复客户会话", "审批发送", "管理设计执行", "管理训练", "管理角色"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /aria-label="管理员：管理角色允许"/);
  assert.match(html, /aria-label="只读：管理角色拒绝"/);
});

test("untrusted readiness is prominent and never claims that policy preflight is authorization", () => {
  const html = renderPanel();
  assert.match(html, /role="alert"/);
  assert.match(html, /真实鉴权尚未启用/);
  assert.match(html, /trustedPrincipal=false/);
  assert.match(html, /当前只有策略预检/);
  assert.match(html, /不能证明操作员已经登录或获得授权/);
  assert.match(html, /客户端选项、请求体 role 或任意请求头都不能用来冒充管理员/);
  assert.match(html, /真实登录或企业 SSO/);
  assert.match(html, /鉴权执行<\/dt><dd[^>]*>未启用/);
  assert.doesNotMatch(html, /登录成功|授权成功|当前管理员/);
});

test("component fails closed unless both status and readiness confirm a trusted principal", () => {
  assert.match(source, /status\.trustedPrincipal === true && readiness\.trustedPrincipal === true/);
  assert.match(source, /trustedPrincipal && status\.enforcementReady === true && readiness\.enforcementReady === true/);
  assert.match(source, /declaredRoles\.has\(role\.id\)/);
  assert.match(source, /declaredCapabilities\.has\(capability\.id\)/);
  assert.match(source, /policy\.matrix\[role\.id\]\?\.includes\(capability\.id\)/);

  const statusClaimsReady = {
    mode: "enforced",
    policyLoaded: true,
    trustedPrincipal: true,
    enforcementReady: true,
    authenticationProvider: "sso",
    defaultDecision: "deny",
  };
  const html = renderPanel({
    status: statusClaimsReady,
    readiness: { trustedPrincipal: false, enforcementReady: true },
  });
  assert.match(html, /真实鉴权尚未启用/);
  assert.match(html, /未建立/);
  assert.doesNotMatch(html, /服务端鉴权已就绪/);
});

test("panel is pure props presentation and performs no API, storage, or authorization mutation", () => {
  assert.match(source, /type OperatorAccessPanelProps = \{[\s\S]*?status:[\s\S]*?policy:[\s\S]*?readiness:/);
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(source, /useEffect|useState|useReducer|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /authorizationGranted\s*[:=]\s*true|trustedPrincipal\s*[:=]\s*true/);
  assert.doesNotMatch(source, /<button|<input|<select|<form/);
});

test("true-white and blue visual tokens match the existing product language", () => {
  assert.match(css, /--access-brand:\s*var\(--wk-color-brand\)/);
  assert.match(css, /--access-surface:\s*var\(--wk-color-surface\)/);
  assert.match(css, /border:\s*1px solid var\(--access-border\)/);
  assert.match(css, /border-radius:\s*8px/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|backdrop-filter/);
});

test("responsive CSS covers 390px and converts the desktop table into readable role sections", () => {
  const media = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)(?=\n@media|$)/g)]
    .filter((match) => Number(match[1]) >= 390)
    .map((match) => match[2])
    .join("\n");
  assert.ok(media, "a responsive breakpoint must cover a 390px viewport");
  assert.match(media, /\.statusGrid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(media, /\.tableWrap table,[\s\S]*?\.tableWrap td\s*\{\s*display:\s*block/);
  assert.match(media, /\.tableWrap thead\s*\{\s*display:\s*none/);
  assert.match(media, /\.tableWrap td\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(media, /content:\s*attr\(data-label\)/);
});
