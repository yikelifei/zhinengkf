"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/legacy-workbench.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(desktopRoot, "apps/web/src/app/globals.css"), "utf8");

test("design workbench auto-polls active submitted and generating jobs", () => {
  assert.match(pageSource, /const \[designAutoRefreshSummary, setDesignAutoRefreshSummary\]/);
  assert.match(pageSource, /\["submitted", "generating"\]\.includes\(job\.status\) && Boolean\(job\.externalJobId\)/);
  assert.match(pageSource, /const result = await pollActiveDesignResults\(filters\)/);
  assert.match(pageSource, /mergeDesignActivePollResult\(result\)/);
  assert.match(pageSource, /setDesignAutoRefreshAt\(new Date\(\)\.toLocaleTimeString\("zh-CN"/);
  assert.match(pageSource, /className="design-auto-refresh-note"/);
});

test("single design polling updates local job state immediately", () => {
  assert.match(pageSource, /async function pollDesignJobIntoState\(job: DesignJob\)/);
  assert.match(pageSource, /upsertDesignJobState\(result\.job\)/);
  assert.match(pageSource, /upsertReviewDesignJobState\(result\.job\)/);
  assert.match(pageSource, /await runAction\("轮询设计结果", \(\) => pollDesignJobIntoState\(activeJob\)\)/);
});

test("current conversation exposes bound design task and local-first image preview", () => {
  assert.match(pageSource, /const activeConversationLatestDesignJob = activeConversationDesignJobs\[0\] \|\| null/);
  assert.match(pageSource, /className="conversation-design-brief"/);
  assert.match(pageSource, /className="conversation-design-thumbs"/);
  assert.match(pageSource, /designImagePreviewSrc\(activeConversationLatestDesignJob, image\)/);
  assert.match(pageSource, /pollDesignJobIntoState\(activeConversationLatestDesignJob\)/);
  assert.match(pageSource, /function designImagePreviewSrc\(job: DesignJob/);
  assert.match(pageSource, /localDesignImageUrl\(job\.id, image, identityExpectation\(job\)\) \|\| image\.downloadUrl/);
});

test("current conversation design card has stable thumbnail layout", () => {
  assert.match(cssSource, /\.conversation-design-brief/);
  assert.match(cssSource, /\.conversation-design-thumbs\s*\{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(cssSource, /\.conversation-design-thumb\s*\{[\s\S]*aspect-ratio: 1/);
  assert.match(cssSource, /\.design-auto-refresh-note/);
});
