const assert = require("node:assert/strict");
const test = require("node:test");

const { buildSkuImportTemplateXlsx, parseSkuImportFile } = require("../packages/rules");

test("parses SKU rows from uploaded CSV file payload", () => {
  const csv = "SKU编号,商品名称,商品类型,分类,成本价,售价,库存\nFILE-CARD,文件感谢卡,配件,贺卡,2,10,100";
  const result = parseSkuImportFile({
    fileName: "skus.csv",
    dataBase64: Buffer.from(csv, "utf8").toString("base64"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceType, "text");
  assert.equal(result.rows[0].skuCode, "FILE-CARD");
  assert.equal(result.rows[0].type, "accessory");
  assert.equal(result.rows[0].salePrice, 10);
});

test("parses SKU rows from uploaded XLSX file payload", () => {
  const workbook = buildMinimalXlsx([
    ["SKU编号", "商品名称", "商品类型", "分类", "成本价", "售价", "库存", "场景标签", "主图"],
    ["FILE-BOX", "文件礼盒", "礼盒", "礼盒", "20", "58", "12", "员工福利、客户拜访", "C:\\products\\file-box.jpg"],
  ]);

  const result = parseSkuImportFile({
    fileName: "skus.xlsx",
    dataBase64: workbook.toString("base64"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceType, "xlsx");
  assert.equal(result.rows[0].skuCode, "FILE-BOX");
  assert.equal(result.rows[0].type, "gift_box");
  assert.equal(result.rows[0].sceneTags.length, 2);
  assert.equal(result.rows[0].mainImagePath, "C:\\products\\file-box.jpg");
});

test("parses the standard SKU import xlsx template", () => {
  const workbook = buildSkuImportTemplateXlsx();
  const result = parseSkuImportFile({
    fileName: "sku-import-template.xlsx",
    dataBase64: workbook.toString("base64"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].skuCode, "BOX-001");
  assert.equal(result.fieldMapping.filter((field) => field.matched).length, 17);
  assert.deepEqual(result.missingRequiredFields, []);
});

function buildMinimalXlsx(rows) {
  return buildZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="商品" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/worksheets/sheet1.xml": worksheetXml(rows),
  });
}

function worksheetXml(rows) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function buildZip(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    fileRecords.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const centralStart = offset;
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...fileRecords, central, end]);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
