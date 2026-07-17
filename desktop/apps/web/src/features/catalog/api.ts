import {
  batchUpdateSkus,
  bulkUpsertSkus,
  getSkuCatalogAudit,
  getSkus,
  previewSkuImportFile,
  previewSkuImportText,
  recommendBundle,
  upsertSku,
} from "../../lib/api";

export {
  batchUpdateSkus,
  bulkUpsertSkus,
  getSkuCatalogAudit,
  previewSkuImportFile,
  previewSkuImportText,
  recommendBundle,
  upsertSku,
};

export async function getVerifiedSkus(includeInactive = true) {
  const records = await getSkus(includeInactive);
  const fallbackCodes = new Set(["BOX-A", "CARD-A", "TEA-A"]);
  const embeddedFallback = records.length === 3 && records.every((record) =>
    fallbackCodes.has(record.skuCode) && /^sku-[123]$/.test(record.id),
  );
  if (embeddedFallback) {
    throw new Error("商品接口不可用，客户端返回了内置降级商品；本页已拒绝展示这些记录。");
  }
  return records;
}
