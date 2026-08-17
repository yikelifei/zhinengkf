"use strict";

const BUNDLE_SNAPSHOT_SCHEMA_VERSION = "bundle_snapshot_v1";
const DESIGN_IMAGE_SNAPSHOT_SCHEMA_VERSION = "design_image_snapshot_v1";

function normalizeBundleSnapshot(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return null;
  const items = Array.isArray(bundle.items)
    ? bundle.items.map(normalizeBundleItemSnapshot).filter(Boolean)
    : [];
  const giftBox = normalizeBundleItemSnapshot(bundle.giftBox || items.find((item) => item.type === "gift_box"));
  return pruneEmptyObject({
    schemaVersion: BUNDLE_SNAPSHOT_SCHEMA_VERSION,
    status: cleanString(bundle.status),
    giftBox,
    items,
    totals: normalizeTotals(bundle.totals),
    fulfillment: normalizeFulfillment(bundle.fulfillment),
    automation: normalizeAutomation(bundle.automation),
    warnings: cleanStringArray(bundle.warnings),
  });
}

function normalizeBundleItemSnapshot(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return pruneEmptyObject({
    id: cleanString(item.id),
    skuCode: cleanString(item.skuCode),
    name: cleanString(item.name || item.title),
    type: cleanString(item.type),
    category: cleanString(item.category),
    salePrice: finiteNumber(item.salePrice ?? item.price),
    costPrice: finiteNumber(item.costPrice ?? item.cost),
    stock: finiteNumber(item.stock),
    sceneTags: cleanStringArray(item.sceneTags),
    dimensions: plainObject(item.dimensions),
    weightGram: finiteNumber(item.weightGram),
    material: cleanString(item.material),
    supplier: cleanString(item.supplier),
    leadTimeDays: finiteNumber(item.leadTimeDays),
    mainImagePath: cleanString(item.mainImagePath),
    mainImageUrl: cleanString(item.mainImageUrl),
    imagePath: cleanString(item.imagePath),
    imageUrl: cleanString(item.imageUrl),
    downloadUrl: cleanString(item.downloadUrl),
    publicUrl: cleanString(item.publicUrl),
    url: cleanString(item.url),
    localPath: cleanString(item.localPath),
    angleImages: cleanStringArray(item.angleImages),
    imageRefs: uniqueStrings([
      item.localPath,
      item.mainImagePath,
      item.mainImageUrl,
      item.imagePath,
      item.imageUrl,
      item.downloadUrl,
      item.publicUrl,
      item.url,
      ...arrayValues(item.angleImages),
      ...arrayValues(item.imageUrls),
      ...arrayValues(item.imagePaths),
    ]),
    replacementSkuCodes: cleanStringArray(item.replacementSkuCodes),
    replacedBy: cleanString(item.replacedBy),
    replacedOriginalSkuCode: cleanString(item.replacedOriginalSkuCode),
    replacementReason: cleanString(item.replacementReason),
    stockWarning: item.stockWarning === true ? true : undefined,
  });
}

function normalizeDesignImageSnapshot(image) {
  if (!image || typeof image !== "object" || Array.isArray(image)) return null;
  return pruneEmptyObject({
    schemaVersion: DESIGN_IMAGE_SNAPSHOT_SCHEMA_VERSION,
    id: cleanString(image.id),
    imageId: cleanString(image.imageId),
    designJobId: cleanString(image.designJobId),
    revisionId: cleanString(image.revisionId),
    executionId: cleanString(image.executionId),
    position: finiteNumber(image.position),
    selected: image.selected === true ? true : undefined,
    localPath: cleanString(image.localPath),
    downloadUrl: cleanString(image.downloadUrl),
    publicUrl: cleanString(image.publicUrl),
    url: cleanString(image.url),
    fingerprint: cleanString(image.fingerprint),
    prompt: cleanString(image.prompt),
    customerFeedback: cleanString(image.customerFeedback),
    createdAt: cleanString(image.createdAt),
    updatedAt: cleanString(image.updatedAt),
  });
}

function normalizeTotals(totals) {
  if (!totals || typeof totals !== "object" || Array.isArray(totals)) return null;
  return pruneEmptyObject({
    cost: finiteNumber(totals.cost),
    salePrice: finiteNumber(totals.salePrice),
    profit: finiteNumber(totals.profit),
    profitRate: finiteNumber(totals.profitRate),
  });
}

function normalizeFulfillment(fulfillment) {
  if (!fulfillment || typeof fulfillment !== "object" || Array.isArray(fulfillment)) return null;
  return pruneEmptyObject({
    requestedQuantity: finiteNumber(fulfillment.requestedQuantity),
    capacity: finiteNumber(fulfillment.capacity),
    enough: typeof fulfillment.enough === "boolean" ? fulfillment.enough : undefined,
    bottleneckSkuCode: cleanString(fulfillment.bottleneckSkuCode),
  });
}

function normalizeAutomation(automation) {
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) return null;
  return pruneEmptyObject({
    ready: typeof automation.ready === "boolean" ? automation.ready : undefined,
    blockers: cleanStringArray(automation.blockers),
  });
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cleanString(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function cleanStringArray(value) {
  return uniqueStrings(arrayValues(value));
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanString).filter(Boolean))];
}

function pruneEmptyObject(value) {
  const output = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item === undefined || item === null) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) continue;
    output[key] = item;
  }
  return Object.keys(output).length ? output : null;
}

module.exports = {
  BUNDLE_SNAPSHOT_SCHEMA_VERSION,
  DESIGN_IMAGE_SNAPSHOT_SCHEMA_VERSION,
  normalizeBundleSnapshot,
  normalizeBundleItemSnapshot,
  normalizeDesignImageSnapshot,
};
