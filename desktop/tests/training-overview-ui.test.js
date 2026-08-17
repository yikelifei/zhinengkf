"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("training overview is the default read-only training entry", () => {
  const page = read("apps/web/src/features/training/training-overview-page.tsx");
  const route = read("apps/web/src/app/training/overview/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");
  const styles = read("apps/web/src/features/governance-pages.module.css");

  assert.match(page, /getTrainingOverview/);
  assert.match(page, /getTrainingKnowledgeEntries/);
  assert.match(page, /Agent Skill 训练概览/);
  assert.match(page, /回复草稿更像真人客服/);
  assert.match(page, /训练资产摘要/);
  assert.match(page, /知识库覆盖/);
  assert.match(page, /Skill 与知识运营验收/);
  assert.match(page, /内置 SOP/);
  assert.match(page, /自定义知识/);
  assert.match(page, /buildTrainingKnowledgeAcceptance\(knowledgeEntries\)/);
  assert.match(page, /knowledgeEntryCount/);
  assert.match(page, /knowledgeByAgent/);
  assert.match(page, /Agent Skill 覆盖度/);
  assert.match(page, /trainingHref\("\/training\/import", stableIdentityFilters\)/);
  assert.match(page, /trainingHref\("\/training\/knowledge", stableIdentityFilters\)/);
  assert.match(page, /trainingHref\("\/training\/review", stableIdentityFilters\)/);
  assert.match(page, /trainingHref\("\/training\/skills", stableIdentityFilters\)/);
  assert.match(page, /TrainingIdentityScopeNotice identityFilters=\{stableIdentityFilters\}/);
  assert.match(page, /styles\.trainingOverviewActions/);
  assert.match(styles, /\.trainingOverviewActions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.trainingOverviewActions > :last-child\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(page, /importChatTranscript|batchReviewTrainingSamples|applySkillSuggestions|postJson|fetch\(/);
  assert.match(route, /routeId="trainingOverview"/);
  assert.match(route, /<TrainingOverviewPage/);
  assert.match(manifest, /trainingOverview/);
  assert.match(manifest, /trainingKnowledge/);
  assert.match(manifest, /Agent Skill 训练/);
  assert.match(manifest, /"training-center": "trainingOverview"/);
  assert.match(navigation, /WORKBENCH_ROUTES\.trainingKnowledge\.href/);
  assert.match(navigation, /label: "知识库 \/ Skill"/);
  assert.doesNotMatch(navigation, /label: "模型训练"/);
});

test("web API exposes the existing training overview endpoint", () => {
  const api = read("apps/web/src/lib/api.ts");
  const controller = read("apps/api/src/training/training.controller.ts");

  assert.match(api, /export async function getTrainingOverview/);
  assert.match(api, /export async function getTrainingKnowledgeEntries/);
  assert.match(api, /export async function reviewTrainingKnowledgeEntry/);
  assert.match(api, /export async function previewTrainingRag/);
  assert.match(api, /\/training\/overview/);
  assert.match(api, /\/training\/knowledge/);
  assert.match(api, /\/training\/rag\/preview/);
  assert.match(api, /includeReview/);
  assert.match(api, /trainingQuery\(filters\)/);
  assert.match(api, /Promise<TrainingOverview>/);
  assert.match(controller, /@Get\("overview"\)/);
  assert.match(controller, /@Get\("knowledge"\)/);
  assert.match(controller, /@Query\("includeReview"\) includeReview\?: string/);
  assert.match(controller, /@Post\("knowledge\/:id\/review"\)/);
  assert.match(controller, /@Post\("rag\/preview"\)/);
  assert.match(controller, /reviewKnowledgeEntry\(id, \{ \.\.\.trustedPayload, reviewer: principal\.id \}\)/);
  assert.match(controller, /@Query\("agentId"\) agentId\?: string/);
  assert.match(controller, /this\.training\.getOverview/);
  assert.match(controller, /this\.training\.listKnowledgeEntries/);
  assert.match(controller, /this\.training\.previewRag/);
});

test("training review actions use sticky operation keys", () => {
  const api = read("apps/web/src/lib/api.ts");
  const reviewPage = read("apps/web/src/features/training/training-review-page.tsx");
  const reviewDetailPage = read("apps/web/src/features/training/training-review-detail-page.tsx");
  const knowledgePage = read("apps/web/src/features/training/training-knowledge-page.tsx");

  assert.match(api, /export async function reviewTrainingKnowledgeEntry[\s\S]*operationKey\?: string/);
  assert.match(api, /export async function getTrainingSample/);
  assert.match(api, /export async function reviewTrainingSample[\s\S]*operationKey\?: string/);
  assert.match(api, /export async function batchReviewTrainingSamples[\s\S]*operationKey\?: string/);
  assert.match(reviewDetailPage, /getTrainingSample\(sampleId, stableIdentityFilters\)/);
  assert.doesNotMatch(reviewDetailPage, /useTrainingSamples/);
  assert.doesNotMatch(reviewDetailPage, /samples\.find\(\(item\) => item\.id === sampleId\)/);
  assert.match(reviewDetailPage, /单条样本复核/);
  assert.match(reviewDetailPage, /客户问题/);
  assert.match(reviewDetailPage, /理想回复/);
  assert.doesNotMatch(reviewDetailPage, /鍗曟|鏍锋|澶嶆牳|璁粌|�|\?\?/);
  for (const source of [reviewPage, reviewDetailPage, knowledgePage]) {
    assert.match(source, /reserveClientOperation\("review-action"/);
    assert.match(source, /completeClientOperation\(pendingOperationRef\.current, operation\.key\)/);
    assert.match(source, /operationKey:\s*operation\.key/);
  }
});

test("knowledge review ready validation is enforced by both store backends", () => {
  const localStore = read("apps/api/src/local-store/local-store.service.ts");
  const prismaStore = read("apps/api/src/prisma/prisma-operations.service.ts");

  for (const source of [localStore, prismaStore]) {
    assert.match(source, /function assertKnowledgeEntryReadyForReview/);
    assert.match(source, /missing_agent/);
    assert.match(source, /missing_title/);
    assert.match(source, /short_content/);
    assert.match(source, /low_quality_score/);
    assert.match(source, /missing_tags/);
    assert.match(source, /knowledge entry cannot be marked ready/);
  }
  assert.match(localStore, /assertKnowledgeEntryReadyForReview\(updated, status\)/);
  assert.match(prismaStore, /assertKnowledgeEntryReadyForReview\(nextEntry, status\)/);
});

test("training identity scope is preserved across import, review, and skill routes", () => {
  const helper = read("apps/web/src/features/training/training-identity-navigation.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const importPage = read("apps/web/src/features/training/training-import-page.tsx");
  const importHistoryPage = read("apps/web/src/features/training/training-import-history-page.tsx");
  const reviewQueuePage = read("apps/web/src/features/training/training-review-queue-page.tsx");
  const reviewPage = read("apps/web/src/features/training/training-review-page.tsx");
  const reviewDetailPage = read("apps/web/src/features/training/training-review-detail-page.tsx");
  const skillsPage = read("apps/web/src/features/training/training-skills-page.tsx");
  const knowledgePage = read("apps/web/src/features/training/training-knowledge-page.tsx");
  const samplesHook = read("apps/web/src/features/training/use-training-samples.ts");

  assert.match(helper, /export function trainingHref/);
  assert.match(helper, /agentId/);
  assert.match(helper, /wechatAccountId/);
  assert.match(helper, /conversationId/);
  assert.match(helper, /customerId/);
  assert.match(helper, /TrainingIdentityScopeNotice/);
  assert.match(api, /export type IdentityFilters = \{[\s\S]*agentId\?: string/);
  assert.match(api, /function trainingQuery/);

  for (const source of [importPage, importHistoryPage, reviewQueuePage, reviewPage, reviewDetailPage, skillsPage, knowledgePage]) {
    assert.match(source, /TrainingIdentityScopeNotice identityFilters=\{stableIdentityFilters\}/);
    assert.match(source, /agentId: identityFilters\?\.agentId/);
  }
  assert.match(samplesHook, /agentId: identityFilters\?\.agentId/);
  assert.match(importPage, /trainingHref\("\/training\/import\/history", stableIdentityFilters\)/);
  assert.match(importPage, /if \(stableIdentityFilters\.agentId\) setAgentId\(stableIdentityFilters\.agentId\)/);
  assert.match(importHistoryPage, /trainingHref\("\/training\/import", stableIdentityFilters\)/);
  assert.match(importHistoryPage, /getTrainingKnowledgeEntries\(stableIdentityFilters\)/);
  assert.match(importHistoryPage, /getReviewCenter\(stableIdentityFilters\)/);
  assert.match(importHistoryPage, /buildKnowledgeImportHistory\(knowledgeEntries, knowledgeImportLogs\)/);
  assert.match(importHistoryPage, /knowledgeImportLogs/);
  assert.match(importHistoryPage, /group\.failed/);
  assert.match(importHistoryPage, /manual_knowledge_import/);
  assert.match(importHistoryPage, /知识导入批次/);
  assert.match(importHistoryPage, /trainingHref\("\/training\/knowledge", stableIdentityFilters\)/);
  assert.match(importHistoryPage, /重新导入修正版/);
  assert.match(importHistoryPage, /training-knowledge-import-retry/);
  assert.match(reviewQueuePage, /trainingHref\("\/training\/review\/batch", stableIdentityFilters\)/);
  assert.match(reviewQueuePage, /trainingHref\(`\/training\/review\/\$\{encodeURIComponent\(sample\.id\)\}`, stableIdentityFilters\)/);
  assert.match(reviewDetailPage, /trainingHref\("\/training\/review", stableIdentityFilters\)/);
  assert.match(skillsPage, /trainingIdentityScopeLabel\(stableIdentityFilters\)/);
  assert.match(skillsPage, /targetAgentId = stableIdentityFilters\.agentId \|\| agentIds\[0\]/);
  assert.match(skillsPage, /filters\.agentId && suggestion\.agentId && suggestion\.agentId !== filters\.agentId/);
  assert.match(skillsPage, /写入智能客服 Agent/);
  assert.match(skillsPage, /回复草稿会读取这些 Skill/);

  for (const routePath of [
    "apps/web/src/app/training/overview/page.tsx",
    "apps/web/src/app/training/knowledge/page.tsx",
    "apps/web/src/app/training/import/page.tsx",
    "apps/web/src/app/training/import/history/page.tsx",
    "apps/web/src/app/training/review/page.tsx",
    "apps/web/src/app/training/review/batch/page.tsx",
    "apps/web/src/app/training/review/[id]/page.tsx",
    "apps/web/src/app/training/skills/page.tsx",
  ]) {
    const route = read(routePath);
    assert.match(route, /identityFiltersFromSearchParams/);
    assert.match(route, /identityFilters=\{identityFilters\}/);
  }
});

test("training review and skill writes fail closed on unknown or stale identity reads", () => {
  const reviewPage = read("apps/web/src/features/training/training-review-page.tsx");
  const skillsPage = read("apps/web/src/features/training/training-skills-page.tsx");
  const knowledgePage = read("apps/web/src/features/training/training-knowledge-page.tsx");
  const knowledgeRead = read("apps/web/src/features/training/use-training-knowledge-read.ts");

  for (const source of [reviewPage, skillsPage, knowledgeRead]) {
    assert.match(source, /const scopeKey = useMemo/);
  }

  assert.match(reviewPage, /readState !== "ready"/);
  assert.match(reviewPage, /readState === "stale"/);
  assert.match(reviewPage, /disabled=\{[^}]*readState !== "ready"/);
  assert.match(reviewPage, /scopedTrainingHistoryValue\(samplesRead, scopeKey/);
  assert.match(reviewPage, /当前身份范围的样本未完成可信读取，不能提交复核/);
  assert.match(skillsPage, /readState !== "ready"/);
  assert.match(skillsPage, /readState === "stale"/);
  assert.match(skillsPage, /disabled=\{[^}]*readState !== "ready"/);
  assert.match(skillsPage, /const suggestions = scopeLoaded \? storedSuggestions : \[\]/);
  assert.match(skillsPage, /技能建议不是当前身份范围的最新可信结果/);
  assert.match(knowledgeRead, /Promise\.allSettled/);
  assert.match(knowledgeRead, /scopedTrainingHistoryValue\(entriesRead, scopeKey/);
  assert.match(knowledgePage, /entriesReadState !== "ready"/);
  assert.match(knowledgePage, /agentsReadState !== "ready"/);
  assert.match(knowledgeRead, /同一身份范围的上次成功内容仅供查看，复核已禁用/);
});

test("training knowledge page gives operators a searchable reviewed knowledge library", () => {
  const page = [
    read("apps/web/src/features/training/training-knowledge-page.tsx"),
    read("apps/web/src/features/training/training-knowledge-page-model.ts"),
    read("apps/web/src/features/training/training-knowledge-workspace-panels.tsx"),
    read("apps/web/src/features/training/use-training-knowledge-read.ts"),
  ].join("\n");
  const route = read("apps/web/src/app/training/knowledge/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");
  const index = read("apps/web/src/features/training/index.ts");

  assert.match(page, /export function TrainingKnowledgePage/);
  assert.match(page, /getTrainingKnowledgeEntries/);
  assert.match(page, /reviewTrainingKnowledgeEntry/);
  assert.match(page, /useTrustedOperator/);
  assert.match(page, /getAgents/);
  assert.match(page, /知识库运营/);
  assert.match(page, /filterKnowledgeEntries/);
  assert.match(page, /sourceFilter/);
  assert.match(page, /tagFilter/);
  assert.match(page, /statusFilter/);
  assert.match(page, /复核说明/);
  assert.match(page, /标记可用/);
  assert.match(page, /停用知识/);
  assert.match(page, /training\.knowledge\.review\.confirm/);
  assert.match(page, /type KnowledgeReviewDraft/);
  assert.match(page, /KnowledgeReviewEditor/);
  assert.match(page, /knowledgeDraftFromEntry/);
  assert.match(page, /knowledgeReviewPayloadFromDraft/);
  assert.match(page, /knowledgeReadyBlockers/);
  assert.match(page, /training\.knowledge\.edit\.agent/);
  assert.match(page, /training\.knowledge\.edit\.title/);
  assert.match(page, /training\.knowledge\.edit\.content/);
  assert.match(page, /training\.knowledge\.edit\.tags/);
  assert.match(page, /training\.knowledge\.edit\.quality/);
  assert.match(page, /readyBlockers\.length > 0/);
  assert.match(page, /expandedId/);
  assert.match(page, /查看正文/);
  assert.match(page, /TrainingIdentityScopeNotice identityFilters=\{stableIdentityFilters\}/);
  assert.match(page, /trainingHref\("\/training\/import", stableIdentityFilters\)/);
  assert.match(page, /trainingHref\("\/training\/skills", stableIdentityFilters\)/);
  assert.match(page, /importKnowledgeText/);
  assert.match(page, /previewTrainingRag/);
  assert.match(page, /小石 RAG 测试台/);
  assert.match(page, /只读取已启用知识，不发送消息/);
  assert.match(page, /RAG 决策/);
  assert.match(page, /知识命中解释/);
  assert.match(page, /reserveClientOperation\("knowledge-import"/);
  assert.match(page, /training\.knowledge\.create\.confirm/);
  assert.doesNotMatch(page, /previewKnowledgeImportText|applySkillSuggestions|postJson|fetch\(/);
  assert.match(route, /routeId="trainingKnowledge"/);
  assert.match(route, /<TrainingKnowledgePage identityFilters=\{identityFilters\}/);
  assert.match(manifest, /href: "\/training\/knowledge"/);
  assert.match(manifest, /knowledge: "trainingKnowledge"/);
  assert.match(index, /TrainingKnowledgePage/);
});

test("training knowledge review editor uses Chinese operator-facing copy", () => {
  const list = read("apps/web/src/features/training/training-knowledge-list.tsx");
  const overview = read("apps/web/src/features/training/training-overview-page.tsx");
  const review = read("apps/web/src/features/training/training-review-page.tsx");

  for (const expected of [
    "所属 Agent",
    "选择 Agent",
    "标题",
    "标签",
    "质量分",
    "正文",
    "可用阻断项",
    "暂无正文",
    "未评分",
    "内置 SOP",
    "聊天导入",
    "路由纠错",
    "手工导入",
    "自定义知识",
    "可用",
    "已停用",
    "复核中",
  ]) {
    assert.match(list, new RegExp(expected));
  }

  for (const oldCopy of [
    "Select Agent",
    "Quality score",
    "Ready blockers",
    "No content",
    "Not scored",
    "Manual import",
    "Chat import",
    "Route correction",
    "Custom knowledge",
    "Disabled",
  ]) {
    assert.doesNotMatch(list, new RegExp(oldCopy));
  }

  assert.match(overview, /内置 SOP/);
  assert.doesNotMatch(overview, /Starter SOP/);
  assert.match(review, /所选样本包含需复核、已阻断或其他未明确安全的数据，不能标记为可用。/);
  assert.doesNotMatch(review, /所选样本包含 needsReview、blocked/);
});
