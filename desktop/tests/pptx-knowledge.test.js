"use strict";

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS", moduleResolution: "Node" } });

const assert = require("node:assert/strict");
const test = require("node:test");
const { strToU8, zipSync } = require("fflate");
const { extractPptxKnowledgeJson } = require("../apps/web/src/features/training/pptx-knowledge.ts");

test("extracts ordered slide text from a PPTX into searchable knowledge rows", () => {
  const archive = zipSync({
    "ppt/slides/slide2.xml": strToU8(slideXml(["产品价格", "数量达到500份时，请根据成本、定制内容和交期重新核价。"])),
    "ppt/slides/slide1.xml": strToU8(slideXml(["商务伴手礼", "适合企业活动、客户答谢和员工福利，推荐时先确认用途、数量与单份预算。"])),
    "ppt/theme/theme1.xml": strToU8("<xml>ignored</xml>"),
  });

  const rows = JSON.parse(extractPptxKnowledgeJson(archive, "企业伴手礼.pptx"));
  assert.equal(rows.length, 2);
  assert.match(rows[0].title, /第1页/);
  assert.match(rows[0].content, /用途、数量与单份预算/);
  assert.match(rows[1].title, /第2页/);
  assert.deepEqual(rows[0].tags, ["PPT", "产品资料", "伴手礼"]);
  assert.equal(rows[0].agentKey, "pre_sales");
});

test("rejects an archive without usable slide text", () => {
  const archive = zipSync({ "ppt/slides/slide1.xml": strToU8(slideXml(["太短"])) });
  assert.throws(() => extractPptxKnowledgeJson(archive, "空资料.pptx"), /文字过少/);
});

function slideXml(texts) {
  return `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><a:p>${texts.map((value) => `<a:r><a:t>${value}</a:t></a:r>`).join("")}</a:p></p:cSld></p:sld>`;
}
