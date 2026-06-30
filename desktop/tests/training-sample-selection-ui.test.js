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
  assert.match(actionSection, /clearSelectedTrainingSamples/);
  assert.match(actionSection, /batchUpdateTrainingSampleStatus\(status: "ready" \| "review" \| "rejected", scope: "selected" \| "visible"\)/);
  assert.match(actionSection, /batchReviewTrainingSamples/);
  assert.match(page, /function isTrainingSampleNeedingManualReview\(sample: TrainingSample\)/);
  assert.match(page, /\| "needs_attention"/);
  assert.match(page, /changeTrainingSampleQualityFilter\("needs_attention"\)/);
  assert.match(page, /filter === "needs_attention"/);
  assert.match(page, /isAntiWrongReplyTrainingSample\(sample\) && sample\.status !== "review"/);
  assert.match(page, /className="training-attention-reasons"/);
  assert.match(page, /sampleAttentionReasons\(sample\)/);
  assert.match(page, /sampleSceneEvidence\(sample\)/);
  assert.match(page, /className="sample-scene-check"/);
  assert.match(page, /className="sample-attention-reasons"/);
  assert.match(page, /attentionReasonLabel\(reason\)/);
  assert.match(listSection, /已选 \{selectedVisibleTrainingSamples\.length\} 条/);
  assert.match(listSection, /已选确认/);
  assert.match(listSection, /已选退回复核/);
  assert.match(listSection, /已选禁用/);
  assert.match(rowSection, /className="sample-check"/);
  assert.match(rowSection, /toggleTrainingSampleSelection\(sample\.id, event\.target\.checked\)/);
  assert.match(css, /\.sample-selection-summary/);
  assert.match(css, /\.sample-check input/);
  assert.match(css, /\.training-attention-reasons/);
  assert.match(css, /\.sample-scene-check/);
  assert.match(css, /\.sample-attention-reasons/);
});
