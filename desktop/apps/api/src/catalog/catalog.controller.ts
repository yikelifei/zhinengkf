import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { BundleRecommendPayload, SkuBatchUpdatePayload, SkuPayload } from "./catalog.types";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("skus")
  listSkus(@Query("includeInactive") includeInactive?: string) {
    return this.catalog.listSkus({ includeInactive: includeInactive === "true" });
  }

  @Get("skus/audit")
  auditSkus() {
    return this.catalog.auditSkus();
  }

  @Get("skus/change-logs")
  listSkuChangeLogs(@Query("skuCode") skuCode?: string, @Query("limit") limit?: string) {
    return this.catalog.listSkuChangeLogs({
      skuCode,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("skus/import-fields")
  getSkuImportFields() {
    return this.catalog.getSkuImportFields();
  }

  @Get("skus/import-template")
  getSkuImportTemplate(@Query("format") format?: string) {
    return this.catalog.getSkuImportTemplate(format === "csv" ? "csv" : "xlsx");
  }

  @Post("skus/demo-images")
  createDemoSkuImages() {
    return this.catalog.createDemoSkuImages();
  }

  @Post("skus")
  upsertSku(@Body() payload: SkuPayload) {
    return this.catalog.upsertSku(payload);
  }

  @Post("skus/batch-update")
  batchUpdateSkus(@Body() payload: SkuBatchUpdatePayload) {
    return this.catalog.batchUpdate(payload);
  }

  @Post("skus/:skuCode/deactivate")
  deactivateSku(@Param("skuCode") skuCode: string) {
    return this.catalog.updateSkuStatus(skuCode, false);
  }

  @Post("skus/:skuCode/restore")
  restoreSku(@Param("skuCode") skuCode: string) {
    return this.catalog.updateSkuStatus(skuCode, true);
  }

  @Post("skus/bulk")
  bulkUpsert(@Body() payload: { rows: SkuPayload[] }) {
    return this.catalog.bulkUpsert(payload.rows || []);
  }

  @Post("skus/import-preview")
  previewImportText(@Body() payload: { text: string }) {
    return this.catalog.previewImportText(payload.text || "");
  }

  @Post("skus/import-file-preview")
  previewImportFile(@Body() payload: { fileName?: string; dataBase64?: string }) {
    return this.catalog.previewImportFile(payload);
  }

  @Post("skus/import-text")
  importText(@Body() payload: { text: string }) {
    return this.catalog.importText(payload.text || "");
  }

  @Post("skus/import-file")
  importFile(@Body() payload: { fileName?: string; dataBase64?: string }) {
    return this.catalog.importFile(payload);
  }

  @Post("bundle/recommend")
  recommend(@Body() payload: BundleRecommendPayload) {
    return this.catalog.recommend(payload);
  }
}
