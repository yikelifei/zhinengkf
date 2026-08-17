"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { automationIdentityHref, automationRunIssueHref } = require("../apps/web/src/features/automation/automation-identity-navigation");
const { automationIssueHref } = require("../apps/web/src/features/automation/automation-issue-routing");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("routing process uses the server contract, both mutation capabilities, and a replay-safe external id", () => {
  const controller = read("apps/web/src/features/routing/use-routing-controller.ts");
  const api = read("apps/web/src/lib/api.ts");
  const server = read("apps/api/src/wechat/wechat.controller.ts");
  assert.match(api, /processInboundMessage\(payload: \{[\s\S]*externalId: string/);
  assert.match(server, /if \(!String\(payload\?\.externalId \|\| ""\)\.trim\(\)\)/);
  assert.match(controller, /capabilityAllowed\(accessStatus, "reply_conversations"\)[\s\S]*capabilityAllowed\(accessStatus, "approve_send"\)/);
  assert.match(controller, /createClientOperationKey\("routing-inbound"\)/);
  assert.match(controller, /externalId: processExternalId/);
  assert.match(controller, /再次确认会复用同一操作标识/);
  assert.match(controller, /setConversationsLoaded\(false\)/);
  assert.match(controller, /setConversationsLoaded\(true\)/);
  assert.match(controller, /const canEvaluate = conversationsLoaded/);
  assert.match(controller, /会话列表尚未成功读取；为避免使用过期身份/);
});

test("automation mutations fail closed, expose recovery, and do not turn partial failures into success", () => {
  const operations = read("apps/web/src/features/automation/use-automation-operations.ts");
  const controlRoute = read("apps/web/src/app/automation/control/page.tsx");
  const issues = read("apps/web/src/features/automation/automation-issues-page.tsx");
  const issueRouting = read("apps/web/src/features/automation/automation-issue-routing.ts");
  assert.match(controlRoute, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(operations, /allowGlobalRun = false/);
  assert.match(operations, /allowGlobalSchedulerControl = false/);
  assert.match(operations, /pendingConfirmation === "start" && !schedulerControlAllowed/);
  assert.match(operations, /if \(result\.errors\.length\)/);
  assert.match(operations, /步骤失败；请先进入问题页核对后再决定是否重试/);
  assert.match(operations, /服务端仍报告周期调度未活动；不能认定已经启动/);
  assert.match(operations, /服务端结果未确认，请先刷新状态和运行历史，不要立即重复提交/);
  assert.match(issues, /data-action-id=\{`automation-issue-open-\$\{issue\.id\}`\}/);
  assert.match(issueRouting, /return "\/settings\/ai-models"/);
  assert.match(issueRouting, /return "\/send\/blocked"/);
});

test("integration recovery links exist, retain a single trusted identity, and choose one owning page", () => {
  const targets = {
    send: automationIssueHref("send_queue", "dispatch failed"),
    routing: automationIssueHref("routing", "route failed"),
    agent: automationIssueHref("agent_skill", "skill unavailable"),
    ai: automationIssueHref("provider", "model unavailable"),
    delivery: automationIssueHref("release_gate", "recovery report stale"),
  };
  assert.deepEqual(targets, {
    send: "/send/blocked",
    routing: "/routing",
    agent: "/agents",
    ai: "/settings/ai-models",
    delivery: "/settings/delivery-readiness",
  });
  assert.equal(automationIssueHref("agent_skill", "image model unavailable"), "/agents");
  assert.equal(automationIssueHref("send_queue", "provider model failed"), "/send/blocked");
  assert.equal(automationIssueHref("delivery_handoff", "handoff incomplete"), "/settings/delivery-readiness");
  for (const href of Object.values(targets)) {
    const pathname = href.split("?")[0];
    assert.equal(fs.existsSync(path.join(root, "apps/web/src/app", pathname.slice(1), "page.tsx")), true, `${href} must resolve to a real route`);
  }

  const identity = { wechatAccountId: "account-a", conversationId: "conversation-a", customerId: "customer-a" };
  assert.equal(
    automationIdentityHref("/automation/control", identity),
    "/automation/control?wechatAccountId=account-a&conversationId=conversation-a&customerId=customer-a",
  );
  assert.match(automationRunIssueHref("/agents", { errors: [], results: {}, startedAt: "2026-08-17T00:00:00.000Z", trigger: "manual", identityAudit: { status: "passed", identityCount: 1, identities: [{ key: "scope-a", ...identity, count: 1, steps: ["agent_skill"] }], warnings: [] } }), /\/agents\?wechatAccountId=account-a&conversationId=conversation-a&customerId=customer-a/);
  assert.equal(automationRunIssueHref("/agents", { errors: [], results: {}, startedAt: "2026-08-17T00:00:00.000Z", trigger: "manual", identityAudit: { status: "warning", identityCount: 2, identities: [{ key: "a", count: 1, steps: [] }, { key: "b", count: 1, steps: [] }], warnings: [] } }), "/agents");

  for (const route of ["automation/runs", "automation/history", "automation/issues", "agents", "agents/[id]", "routing", "routing/process"]) {
    assert.match(read(`apps/web/src/app/${route}/page.tsx`), /identityFiltersFromSearchParams/);
  }
});

test("dangerous provider actions need fresh state and two separate confirmations", () => {
  const page = read("apps/web/src/features/system/ai-models-page.tsx");
  const setup = read("apps/web/src/features/system/ai-provider-credential-setup.tsx");
  assert.match(page, /disabled=\{pageBusy \|\| readState !== "ready" \|\| manageAccess\.readState !== "ready" \|\| !manageAccess\.allowed\}/);
  assert.match(page, /可能产生费用、配额消耗和外部审计记录/);
  assert.match(page, /探活失败也不会自动重试/);
  assert.match(setup, /onSave\(provider, provider\.enabled\)/);
  assert.match(setup, /data-action-id=\{`ai-models-provider-\$\{provider\.name\}-enable-request`\}/);
  assert.match(setup, /disabled=\{!configurationTrusted \|\| savingProvider === pendingChange\.provider\.name\}/);
  assert.doesNotMatch(setup, /保存并启用/);
});

test("agent and delivery stale reads stay visible but block dangerous follow-up actions", () => {
  const agents = read("apps/web/src/features/agents/use-agents-directory.ts");
  const detail = read("apps/web/src/features/agents/agent-detail-page.tsx");
  const agentAccess = read("apps/web/src/features/access/use-operator-capability.ts");
  const deliveryHook = read("apps/web/src/features/system/use-delivery-readiness.ts");
  const deliveryPage = read("apps/web/src/features/system/delivery-readiness-page.tsx");
  assert.match(agents, /loadedScopeKeyRef\.current === requestScopeKey/);
  assert.match(agents, /const scopedAgents = loadedScopeKey === scopeKey \? agents : \[\]/);
  assert.match(agentAccess, /status\.enforcementReady && status\.capabilities\.includes\(capability\)/);
  assert.match(detail, /useOperatorCapability\("execute_agent_skills"\)/);
  assert.match(detail, /executionAllowed = readState === "ready" && executionAccess\.readState === "ready" && executionAccess\.allowed/);
  assert.match(detail, /disabled=\{!executionAllowed \|\| executingSkillId === skill\.id\}/);
  assert.match(deliveryHook, /trustedReadinessRef\.current \? "stale" : "unknown"/);
  assert.match(deliveryPage, /旧报告 \/ 待刷新/);
  assert.match(deliveryPage, /不得据此继续发布/);
});
