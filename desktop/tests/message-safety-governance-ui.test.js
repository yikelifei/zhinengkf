"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const componentPath = path.join(root, "apps/web/src/components/message-safety-governance/message-safety-governance.tsx");
const typesPath = path.join(root, "apps/web/src/components/message-safety-governance/types.ts");
const indexPath = path.join(root, "apps/web/src/components/message-safety-governance/index.ts");
const cssPath = path.join(root, "apps/web/src/components/message-safety-governance/message-safety-governance.module.css");
const component = fs.readFileSync(componentPath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

test("message safety governance is a caller-controlled UI contract without transport side effects", () => {
  assert.match(types, /export type MessageSafetyGovernanceProps = \{/);
  assert.match(types, /globallyStopped: boolean;/);
  assert.match(types, /onRequestGlobalStop: \(\) => void;/);
  assert.match(types, /onRequestResume: \(\) => void;/);
  assert.match(types, /onReviewApproval: \(approvalId: string\) => void;/);
  assert.match(types, /onResolveQuarantine: \(deliveryId: string\) => void;/);
  assert.match(types, /onExportAudit: \(\) => void;/);
  assert.match(index, /export \{ MessageSafetyGovernance \}/);
  assert.doesNotMatch(component, /\bfetch\s*\(|\baxios\b|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(component, /setTimeout|setInterval|Math\.random/);
});

test("governance exposes identity, consent, deterministic account budgets and human review", () => {
  assert.match(component, /当前操作身份/);
  assert.match(component, /所属主体/);
  assert.match(component, /业务目的/);
  assert.match(component, /客户同意与退订/);
  assert.match(component, /缺失、过期或已退订的客户不可进入外发队列/);
  assert.match(component, /每账号业务预算/);
  assert.match(component, /按明确周期和固定额度执行/);
  assert.match(component, /人工审批/);
  assert.match(component, /onClick=\{\(\) => onReview\(item\.id\)\}/);
  assert.match(component, /Math\.max\(0, budget\.limit - budget\.used - budget\.reserved\)/);
});

test("sensitive content, uncertain delivery, audit and global stop are fail-closed surfaces", () => {
  assert.match(component, /敏感内容阻断/);
  assert.match(component, /不确定状态隔离/);
  assert.match(component, /审计事件/);
  assert.match(component, /全部账号的外发操作已停止/);
  assert.match(component, /等待有权限的操作员审核后恢复/);
  assert.match(component, /onClick=\{onRequestGlobalStop\}/);
  assert.match(component, /onClick=\{onRequestResume\}/);
  assert.match(component, /onClick=\{\(\) => onResolveQuarantine\(item\.id\)\}/);
  assert.match(component, /onClick=\{onExportAudit\}/);
});

test("governance language contains no evasion or impersonation promises", () => {
  assert.doesNotMatch(component, /养号|防封|规避检测|模拟真人|随机延迟/);
  assert.doesNotMatch(component, /bypass|evade|stealth|anti[- ]?ban/i);
});

test("server rendering includes supplied governance evidence and no invented records", () => {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
  });
  require.extensions[".css"] = (module) => {
    module.exports = new Proxy({}, {
      get: (_target, property) => property === "__esModule" ? false : String(property),
    });
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { MessageSafetyGovernance } = require(componentPath);
  const noop = () => undefined;
  const markup = renderToStaticMarkup(React.createElement(MessageSafetyGovernance, {
    identity: {
      operatorName: "张三",
      operatorRole: "客服主管",
      organizationName: "臻希礼业",
      businessPurpose: "已购客户订单服务",
      activeAccountId: "account_service_1",
    },
    globallyStopped: true,
    globalStopReason: "合规复核中",
    consentRecords: [{
      customerId: "customer_1",
      customerLabel: "客户甲",
      state: "unsubscribed",
      source: "会话内明确退订",
      recordedAt: "2026-07-17 10:00",
      unsubscribedAt: "2026-07-17 10:05",
    }],
    accountBudgets: [{
      accountId: "account_service_1",
      accountLabel: "客服一号",
      periodLabel: "自然日",
      limit: 100,
      used: 40,
      reserved: 5,
      resetAt: "次日 00:00",
      enabled: true,
    }],
    approvalQueue: [{
      id: "approval_1",
      accountId: "account_service_1",
      customerLabel: "客户乙",
      contentSummary: "售后处理方案",
      reason: "涉及退款承诺",
      requestedBy: "客服一号",
      requestedAt: "2026-07-17 10:08",
      state: "pending",
    }],
    sensitiveContent: {
      policyVersion: "policy-2026-07",
      activeRuleCount: 12,
      blockedToday: 2,
      lastEvaluatedAt: "2026-07-17 10:10",
      protectedCategories: ["隐私信息", "付款承诺"],
    },
    quarantinedDeliveries: [{
      id: "delivery_1",
      accountId: "account_service_1",
      customerLabel: "客户丙",
      contentDigest: "发送结果未得到确定确认",
      reason: "结果不确定",
      detectedAt: "2026-07-17 10:12",
      state: "isolated",
    }],
    auditEvents: [{
      id: "audit_1",
      occurredAt: "2026-07-17 10:12",
      actor: "系统治理",
      action: "隔离发送结果",
      target: "delivery_1",
      outcome: "recorded",
      detail: "等待人工复核",
    }],
    onRequestGlobalStop: noop,
    onRequestResume: noop,
    onOpenConsentRecord: noop,
    onReviewApproval: noop,
    onResolveQuarantine: noop,
    onExportAudit: noop,
  }));

  assert.match(markup, /张三/);
  assert.match(markup, /臻希礼业/);
  assert.match(markup, /客户甲/);
  assert.match(markup, /已退订/);
  assert.match(markup, /客服一号/);
  assert.match(markup, /55 可用/);
  assert.match(markup, /合规复核中/);
  assert.match(markup, /delivery_1/);
});

test("responsive CSS keeps the governance panel within a 390px viewport", () => {
  assert.match(css, /\.panel\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
  assert.doesNotMatch(css, /min-width:\s*(?:[4-9]\d\d|\d{4,})px/);
  const mobile = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)(?=\n@media|$)/)?.[1] || "";
  assert.match(mobile, /\.summaryGrid,[\s\S]*?\.contentGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(mobile, /\.identityList,[\s\S]*?\.auditRow\s*\{\s*grid-template-columns:\s*1fr;/);
});
