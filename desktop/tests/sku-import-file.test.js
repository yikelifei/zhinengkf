const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const test = require("node:test");
const zlib = require("node:zlib");

const {
  SKU_IMPORT_LIMITS,
  buildSkuImportTemplateXlsx,
  parseSkuImportFile,
  parseSkuImportText,
} = require("../packages/rules");

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

test("parses deflated XLSX entries with and without a data descriptor", () => {
  const rows = [["sku", "name", "price"], ["DEFLATE-1", "deflated", "10"]];
  for (const dataDescriptor of [false, true]) {
    const entries = Object.entries(minimalXlsxEntries(rows)).map(([name, content]) => ({
      name,
      content,
      method: 8,
      dataDescriptor,
    }));
    const result = parseSkuImportFile(buildZipRecords(entries));
    assert.equal(result.ok, true);
    assert.equal(result.rows[0].skuCode, "DEFLATE-1");
  }
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

test("rejects non-canonical base64 and oversized input before parsing", () => {
  for (const dataBase64 of ["U0tV\n", "U0tV=", "U0tV-", "%%%%"]) {
    const result = parseSkuImportFile({ fileName: "skus.csv", dataBase64 });
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /SKU_IMPORT_INVALID_BASE64/);
  }

  const oversized = parseSkuImportFile(Buffer.alloc(SKU_IMPORT_LIMITS.maxInputBytes + 1));
  assert.equal(oversized.ok, false);
  assert.match(oversized.errors[0].message, /SKU_IMPORT_INPUT_TOO_LARGE/);

  const oversizedText = parseSkuImportText("x".repeat(SKU_IMPORT_LIMITS.maxFinalTextBytes + 1));
  assert.equal(oversizedText.ok, false);
  assert.match(oversizedText.errors[0].message, /SKU_IMPORT_TEXT_TOO_LARGE/);
});

test("rejects malformed ZIP bounds, unsafe paths, duplicates and excessive entry counts", () => {
  const workbook = buildMinimalXlsx([["sku", "name", "price"], ["SAFE-1", "safe", "10"]]);
  const corruptOffset = Buffer.from(workbook);
  corruptOffset.writeUInt32LE(corruptOffset.length + 100, corruptOffset.length - 22 + 16);
  assert.match(parseSkuImportFile(corruptOffset).errors[0].message, /SKU_IMPORT_ZIP_BOUNDS/);

  const unsafePath = buildZipRecords([{ name: "../xl/workbook.xml", content: "unsafe" }]);
  assert.match(parseSkuImportFile(unsafePath).errors[0].message, /SKU_IMPORT_ZIP_PATH/);

  const duplicate = buildZipRecords([
    { name: "xl/workbook.xml", content: "one" },
    { name: "XL/WORKBOOK.XML", content: "two" },
  ]);
  assert.match(parseSkuImportFile(duplicate).errors[0].message, /SKU_IMPORT_ZIP_DUPLICATE/);

  const excessiveEntries = buildZipRecords(Array.from(
    { length: SKU_IMPORT_LIMITS.maxZipEntries + 1 },
    (_, index) => ({ name: `safe/entry-${index}.xml`, content: "" }),
  ));
  assert.match(parseSkuImportFile(excessiveEntries).errors[0].message, /SKU_IMPORT_ZIP_ENTRY_LIMIT/);
});

test("rejects ZIP64, multi-disk, encrypted and inconsistent data descriptor archives", () => {
  const workbook = buildMinimalXlsx([["sku", "name", "price"], ["SAFE-1", "safe", "10"]]);
  const eocdOffset = workbook.length - 22;

  const zip64 = Buffer.from(workbook);
  zip64.writeUInt16LE(0xffff, eocdOffset + 8);
  zip64.writeUInt16LE(0xffff, eocdOffset + 10);
  assert.match(parseSkuImportFile(zip64).errors[0].message, /SKU_IMPORT_ZIP64_UNSUPPORTED/);

  const multiDisk = Buffer.from(workbook);
  multiDisk.writeUInt16LE(1, eocdOffset + 4);
  assert.match(parseSkuImportFile(multiDisk).errors[0].message, /SKU_IMPORT_ZIP_MULTIDISK/);

  const encrypted = Buffer.from(workbook);
  const centralOffset = encrypted.readUInt32LE(eocdOffset + 16);
  encrypted.writeUInt16LE(1, centralOffset + 8);
  encrypted.writeUInt16LE(1, 6);
  assert.match(parseSkuImportFile(encrypted).errors[0].message, /SKU_IMPORT_ZIP_ENCRYPTED/);

  const badDescriptor = buildZipRecords([{
    name: "xl/workbook.xml",
    content: "descriptor-data",
    method: 8,
    dataDescriptor: true,
    descriptorCompressedSizeDelta: 1,
  }]);
  assert.match(parseSkuImportFile(badDescriptor).errors[0].message, /SKU_IMPORT_ZIP_DESCRIPTOR/);
});

test("bounds deflate output even when ZIP declarations under-report actual data", () => {
  const bomb = buildZipRecords([{
    name: "xl/worksheets/sheet1.xml",
    content: Buffer.alloc(SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes + 1, 0x41),
    method: 8,
    declaredUncompressedSize: 1,
  }]);

  const result = parseSkuImportFile(bomb);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /SKU_IMPORT_ZIP_INFLATE_LIMIT/);

  const cumulativeEntrySize = Math.floor(SKU_IMPORT_LIMITS.maxZipTotalUncompressedBytes / 3) + 1;
  const cumulative = buildZipRecords(Array.from({ length: 3 }, (_, index) => ({
    name: `safe/large-${index}.xml`,
    content: Buffer.alloc(cumulativeEntrySize, 0x42 + index),
    method: 8,
  })));
  assert.match(parseSkuImportFile(cumulative).errors[0].message, /SKU_IMPORT_ZIP_TOTAL_LIMIT/);
});

test("bounds shared strings, worksheet rows, worksheet cells and decoded cell text", () => {
  const sharedEntries = minimalXlsxEntries([["sku", "name", "price"], ["SAFE-1", "safe", "10"]]);
  sharedEntries["xl/sharedStrings.xml"] = `<sst>${"<si><t>x</t></si>".repeat(SKU_IMPORT_LIMITS.maxSharedStrings + 1)}</sst>`;
  assert.match(parseSkuImportFile(buildZip(sharedEntries)).errors[0].message, /SKU_IMPORT_SHARED_STRING_LIMIT/);

  const rows = Array.from(
    { length: SKU_IMPORT_LIMITS.maxWorksheetRows + 1 },
    (_, index) => [index === 0 ? "sku" : `SKU-${index}`],
  );
  assert.match(parseSkuImportFile(buildMinimalXlsx(rows)).errors[0].message, /SKU_IMPORT_ROW_LIMIT/);

  const cellsPerRow = 250;
  const cellRows = Array.from(
    { length: Math.ceil((SKU_IMPORT_LIMITS.maxWorksheetCells + 1) / cellsPerRow) },
    () => Array.from({ length: cellsPerRow }, () => "x"),
  );
  assert.match(parseSkuImportFile(buildMinimalXlsx(cellRows)).errors[0].message, /SKU_IMPORT_CELL_LIMIT/);

  const oversizedCell = "x".repeat(SKU_IMPORT_LIMITS.maxCellTextBytes + 1);
  assert.match(parseSkuImportFile(buildMinimalXlsx([[oversizedCell]])).errors[0].message, /SKU_IMPORT_CELL_TEXT_LIMIT/);

  const cumulativeCells = Array.from(
    { length: Math.floor(SKU_IMPORT_LIMITS.maxFinalTextBytes / SKU_IMPORT_LIMITS.maxCellTextBytes) + 1 },
    () => "x".repeat(SKU_IMPORT_LIMITS.maxCellTextBytes),
  );
  assert.match(parseSkuImportFile(buildMinimalXlsx([cumulativeCells])).errors[0].message, /SKU_IMPORT_TEXT_TOO_LARGE/);

  const textRunEntries = minimalXlsxEntries([["sku", "name", "price"]]);
  textRunEntries["xl/sharedStrings.xml"] = `<sst><si>${"<t/>".repeat(SKU_IMPORT_LIMITS.maxTextRunsPerCell + 1)}</si></sst>`;
  assert.match(parseSkuImportFile(buildDeflatedXlsx(textRunEntries)).errors[0].message, /SKU_IMPORT_TEXT_RUN_LIMIT/);

  const tagEntries = minimalXlsxEntries([["sku", "name", "price"]]);
  tagEntries["xl/sharedStrings.xml"] = `<sst><si data="${"界".repeat(Math.floor(SKU_IMPORT_LIMITS.maxXmlTagBytes / 3) + 1)}"></si></sst>`;
  assert.match(parseSkuImportFile(buildDeflatedXlsx(tagEntries)).errors[0].message, /SKU_IMPORT_XML_TAG_LIMIT/);
});

test("preserves sharedStrings rich text and inlineStr workbook compatibility", () => {
  const entries = minimalXlsxEntries([]);
  entries["xl/sharedStrings.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>SKU编号</t></si>
  <si><t>商品名称</t></si>
  <si><t>售价</t></si>
  <si><t>SHARED-1</t></si>
  <si><r><t>共享</t></r><r><t>礼盒&amp;套装</t></r></si>
  <si><t>88</t></si>
</sst>`;
  entries["xl/worksheets/sheet1.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>
</sheetData></worksheet>`;

  const result = parseSkuImportFile(buildZip(entries));
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].skuCode, "SHARED-1");
  assert.equal(result.rows[0].name, "共享礼盒&套装");
  assert.equal(result.rows[0].salePrice, 88);
});

test("stops at shared string N+1 before scanning its malformed tag body", () => {
  const entries = minimalXlsxEntries([["sku", "name", "price"], ["SAFE-1", "safe", "10"]]);
  entries["xl/sharedStrings.xml"] = `<sst>${"<si/>".repeat(SKU_IMPORT_LIMITS.maxSharedStrings)}<si ${"x".repeat(SKU_IMPORT_LIMITS.maxXmlTagBytes + 1)}</sst>`;
  const result = parseSkuImportFile(buildDeflatedXlsx(entries));
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /SKU_IMPORT_SHARED_STRING_LIMIT/);
  assert.doesNotMatch(result.errors[0].message, /SKU_IMPORT_XML_TAG_LIMIT|SKU_IMPORT_XML_MALFORMED/);
});

test("rejects a low-compression-ratio million-tag shared string attack with early stop", () => {
  const entries = minimalXlsxEntries([["sku", "name", "price"], ["SAFE-1", "safe", "10"]]);
  const millionTags = "<si></si>".repeat(1_000_000);
  entries["xl/sharedStrings.xml"] = `<sst>${millionTags}</sst>`;
  const workbook = buildDeflatedXlsx(entries);
  assert.ok(workbook.length < Buffer.byteLength(entries["xl/sharedStrings.xml"], "utf8") / 100);

  const startedAt = performance.now();
  const result = parseSkuImportFile(workbook);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /SKU_IMPORT_SHARED_STRING_LIMIT/);
  assert.ok(elapsedMs < 2000, `million-tag early stop took ${elapsedMs.toFixed(1)}ms`);
});

test("rejects unclosed 64KiB and multi-megabyte XML samples in bounded time", () => {
  const samples = [
    {
      sampleBytes: 64 * 1024,
      entry: "xl/sharedStrings.xml",
      content: (payload) => `<sst><si>${payload}</sst>`,
    },
    {
      sampleBytes: 512 * 1024,
      entry: "xl/worksheets/sheet1.xml",
      content: (payload) => `<worksheet><sheetData><row>${payload}</sheetData></worksheet>`,
    },
    {
      sampleBytes: 2 * 1024 * 1024,
      entry: "xl/worksheets/sheet1.xml",
      content: (payload) => `<worksheet><sheetData><row><c>${payload}</row></sheetData></worksheet>`,
    },
  ];
  for (const sample of samples) {
    const entries = minimalXlsxEntries([["sku", "name", "price"], ["SAFE-1", "safe", "10"]]);
    entries[sample.entry] = sample.content("x".repeat(sample.sampleBytes));
    const workbook = buildDeflatedXlsx(entries);
    const startedAt = performance.now();
    const result = parseSkuImportFile(workbook);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, /SKU_IMPORT_XML_MALFORMED/);
    assert.ok(elapsedMs < 2000, `${sample.sampleBytes}-byte unclosed XML took ${elapsedMs.toFixed(1)}ms`);
  }
});

test("stops million worksheet row and cell tags at their N+1 resource limits", () => {
  for (const attack of [
    {
      code: "SKU_IMPORT_ROW_LIMIT",
      xml: () => `<worksheet><sheetData>${"<row/>".repeat(1_000_000)}</sheetData></worksheet>`,
    },
    {
      code: "SKU_IMPORT_CELL_LIMIT",
      xml: () => {
        const row = `<row>${"<c/>".repeat(SKU_IMPORT_LIMITS.maxWorksheetColumns)}</row>`;
        return `<worksheet><sheetData>${row.repeat(Math.ceil(1_000_000 / SKU_IMPORT_LIMITS.maxWorksheetColumns))}</sheetData></worksheet>`;
      },
    },
  ]) {
    const entries = minimalXlsxEntries([]);
    entries["xl/worksheets/sheet1.xml"] = attack.xml();
    const workbook = buildDeflatedXlsx(entries);
    assert.ok(workbook.length < Buffer.byteLength(entries["xl/worksheets/sheet1.xml"], "utf8") / 100);
    const startedAt = performance.now();
    const result = parseSkuImportFile(workbook);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.ok, false);
    assert.match(result.errors[0].message, new RegExp(attack.code));
    assert.ok(elapsedMs < 2000, `${attack.code} million-tag early stop took ${elapsedMs.toFixed(1)}ms`);
  }
});

function buildMinimalXlsx(rows) {
  return buildZip(minimalXlsxEntries(rows));
}

function minimalXlsxEntries(rows) {
  return {
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
  };
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
  return buildZipRecords(Object.entries(entries).map(([name, content]) => ({ name, content })));
}

function buildDeflatedXlsx(entries) {
  return buildZipRecords(Object.entries(entries).map(([name, content]) => ({
    name,
    content,
    method: name === "xl/sharedStrings.xml" || name.startsWith("xl/worksheets/") ? 8 : 0,
  })));
}

function buildZipRecords(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name;
    const content = entry.content;
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const method = entry.method || 0;
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const declaredUncompressedSize = entry.declaredUncompressedSize ?? data.length;
    const checksum = crc32(data);
    const flags = entry.dataDescriptor ? 0x0008 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : checksum, 14);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : declaredUncompressedSize, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    const descriptor = entry.dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (entry.dataDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length + (entry.descriptorCompressedSizeDelta || 0), 8);
      descriptor.writeUInt32LE(declaredUncompressedSize, 12);
    }
    fileRecords.push(local, nameBuffer, compressed, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredUncompressedSize, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length + descriptor.length;
  }

  const centralStart = offset;
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
