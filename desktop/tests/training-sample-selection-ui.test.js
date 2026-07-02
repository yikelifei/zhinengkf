"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("training sample review center supports selected batch actions", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const stateSection = page.slice(
    page.indexOf("const [trainingSamples"),
    page.indexOf("const [wechatAccounts"),
  );
  const actionSection = page.slice(
    page.indexOf("function toggleTrainingSampleSelection"),
    page.indexOf("function startSampleEdit"),
  );
  const listSection = page.slice(
    page.indexOf("<strong>训练样本复核</strong>"),
    page.indexOf("<div className=\"sample-list\">"),
  );
  const rowSection = page.slice(
    page.indexOf("visibleTrainingSamples.map"),
    page.indexOf("{editingSampleId === sample.id"),
  );

  assert.match(stateSection, /selectedTrainingSampleIds/);
  assert.match(page, /selectedVisibleTrainingSamples/);
  assert.match(actionSection, /selectVisibleTrainingSamples/);
  assert.match(actionSection, /selectTrainingSamplesNeedingReview/);
  assert.match(actionSection, /selectSceneUncertainTrainingSamples/);
  assert.match(actionSection, /clearSelectedTrainingSamples/);
  assert.match(page, /let importSummary = ""/);
  assert.match(page, /let importedChatId = ""/);
  assert.match(page, /sceneUncertainCount = \(result\.samples \|\| \[\]\)\.filter\(\(sample\) => isSceneUncertainTrainingSample\(sample\)\)\.length/);
  assert.match(page, /importSummary = chatImportSceneSummary\(result\)/);
  assert.match(page, /void changeTrainingSampleQualityFilter\("scene_uncertain", importedChatId\)/);
  assert.match(page, /setMessage\(importSummary \|\|/);
  assert.match(page, /trainingSampleImportFilterId/);
  assert.match(page, /setTrainingSampleImportFilterId\(importId\)/);
  assert.match(page, /importId: trainingSampleImportFilterId \|\| undefined/);
  assert.match(page, /function changeTrainingSampleQualityFilterInReviewScope\(filter: TrainingSampleQualityFilter\)/);
  assert.match(page, /changeTrainingSampleQualityFilter\(filter, trainingSampleImportFilterId\)/);
  assert.match(page, /className="training-import-history"/);
  assert.match(page, /chatImports\.slice\(0, 4\)\.map/);
  assert.match(page, /changeTrainingSampleQualityFilter\(chatImportPreferredQualityFilter\(item\), item\.id\)/);
  assert.match(page, /chatImportSceneSummaryLabel\(item\)/);
  assert.match(page, /function chatImportReviewCount\(item: ChatImport\)/);
  assert.match(page, /function chatImportRejectedCount\(item: ChatImport\)/);
  assert.match(page, /function chatImportNeedsReview\(item: ChatImport\)/);
  assert.match(page, /function chatImportPreferredQualityFilter\(item: ChatImport\): TrainingSampleQualityFilter/);
  assert.match(page, /if \(chatImportReviewCount\(item\) > 0\) return "review"/);
  assert.match(page, /activeTrainingImport/);
  assert.match(page, /scopedTrainingOverview/);
  assert.match(listSection, /导入批次：\$\{activeTrainingImport\.name\}/);
  assert.match(listSection, /清除批次/);
  assert.match(actionSection, /batchUpdateTrainingSampleStatus\(status: "ready" \| "review" \| "rejected", scope: "selected" \| "visible"\)/);
  assert.match(actionSection, /batchReviewTrainingSamples/);
  assert.match(actionSection, /trainingSampleSceneBatchWarning\(sceneUncertainCount\)/);
  assert.match(actionSection, /trainingSampleBatchReviewNote\(status, scopeLabel, sceneUncertainCount\)/);
  assert.match(page, /function isTrainingSampleNeedingManualReview\(sample: TrainingSample\)/);
  assert.match(page, /\| "needs_attention"/);
  assert.match(page, /changeTrainingSampleQualityFilter\("needs_attention"\)/);
  assert.match(page, /changeTrainingSampleQualityFilter\("scene_uncertain"\)/);
  assert.match(page, /changeTrainingSampleQualityFilter\(attentionReasonQualityFilter\(reason\)\)/);
  assert.match(page, /function attentionReasonQualityFilter\(reason: \{ code\?: string \}\): TrainingSampleQualityFilter/);
  assert.match(page, /filter === "needs_attention"/);
  assert.match(page, /filter === "scene_uncertain"/);
  assert.match(page, /isSceneUncertainTrainingSample\(sample\)/);
  assert.match(page, /function chatImportSceneSummary\(result: ChatImport\)/);
  assert.match(page, /function chatImportSceneUncertainCount\(item: ChatImport\)/);
  assert.match(page, /function chatImportSceneSummaryLabel\(item: ChatImport\)/);
  assert.match(page, /clearSceneCount = samples\.filter\(\(sample\) => sample\.sceneCheck\?\.status === "clear"\)\.length/);
  assert.match(page, /summary\.sceneUncertainSamples \?\? fallbackCount/);
  assert.match(page, /visibleTrainingRecommendations\(trainingOverview\.recommendations\)/);
  assert.doesNotMatch(page, /trainingOverview\.recommendations\.slice\(0, 2\)/);
  assert.match(page, /function trainingRecommendationPriority\(text: string\)/);
  assert.match(page, /聊天导入样本的场景不够确定\|自动分流记忆/);
  assert.match(page, /className="training-summary-action"/);
  assert.match(page, /setTrainingWorkbenchView\("review"\)/);
  assert.match(page, /查看场景待确认/);
  assert.match(page, /选择场景待确认/);
  assert.match(page, /当前显示样本里没有场景待确认的导入样本/);
  assert.match(page, /请逐条核对 Agent 和场景后再确认训练/);
  assert.match(page, /避免把 A 客户场景训练给 B 智能体/);
  assert.match(page, /已按当前 Agent 和场景人工确认/);
  assert.match(page, /场景待确认/);
  assert.match(page, /isAntiWrongReplyTrainingSample\(sample\) && sample\.status !== "review"/);
  assert.match(page, /className="training-attention-reasons"/);
  assert.match(page, /sampleAttentionReasons\(sample\)/);
  assert.match(page, /sampleSceneEvidence\(sample\)/);
  assert.match(page, /className="sample-scene-check"/);
  assert.match(page, /sampleSceneRouteMemoryBadge\(sample\)/);
  assert.match(page, /人工已确认/);
  assert.match(page, /确认后才分流/);
  assert.match(page, /可训练分流/);
  assert.match(page, /className="sample-attention-reasons"/);
  assert.match(page, /attentionReasonLabel\(reason\)/);
  assert.match(page, /title=\{attentionReasonTitle\(reason\)\}/);
  assert.match(rowSection, /<button\s+type="button"\s+key=\{reason\.code\}/);
  assert.match(rowSection, /onClick=\{\(\) => changeTrainingSampleQualityFilterInReviewScope\(attentionReasonQualityFilter\(reason\)\)\}/);
  assert.match(page, /sceneReasonCodes\.has\(reason\.code \|\| ""\)\) return "scene_uncertain"/);
  assert.match(listSection, /已选 \{selectedVisibleTrainingSamples\.length\} 条/);
  assert.match(listSection, /已选确认/);
  assert.match(listSection, /已选退回复核/);
  assert.match(listSection, /已选禁用/);
  assert.match(listSection, /changeTrainingSampleQualityFilterInReviewScope\(option\.key\)/);
  assert.match(rowSection, /className="sample-check"/);
  assert.match(rowSection, /toggleTrainingSampleSelection\(sample\.id, event\.target\.checked\)/);
  assert.match(css, /\.sample-selection-summary/);
  assert.match(css, /\.sample-check input/);
  assert.match(css, /\.training-attention-reasons/);
  assert.match(css, /\.training-summary-action/);
  assert.match(css, /\.training-summary-action:disabled/);
  assert.match(css, /\.training-import-history/);
  assert.match(css, /\.training-import-row\.needs-review/);
  assert.match(css, /\.training-import-row\.clear/);
  assert.match(css, /\.sample-scene-check/);
  assert.match(css, /\.sample-scene-check span\.route-memory-ok/);
  assert.match(css, /\.sample-scene-check span\.route-memory-blocked/);
  assert.match(css, /\.sample-attention-reasons/);
  assert.match(css, /\.sample-attention-reasons button/);
  assert.match(css, /\.sample-attention-reasons button:disabled/);
  assert.match(api, /sceneUncertainSamples\?: number/);
  assert.match(api, /\| "scene_uncertain"/);
  assert.match(api, /importId\?: string/);
  assert.match(api, /params\.set\("importId", filters\.importId\)/);
  assert.match(api, /sceneSummary\?: \{/);
  assert.match(api, /sceneUncertainCount: number/);
  assert.match(api, /reviewCount\?: number/);
  assert.match(api, /rejectedCount\?: number/);
});
