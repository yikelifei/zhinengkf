import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { BundleRecommendPayload, SkuBatchUpdatePayload, SkuPayload } from "./catalog.types";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("catalog")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
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
  @RequireOperatorCapability("manage_design_executions")
  createDemoSkuImages() {
    return this.catalog.createDemoSkuImages();
  }

  @Post("skus")
  @RequireOperatorCapability("manage_design_executions")
  upsertSku(@Body() payload: SkuPayload) {
    return this.catalog.upsertSku(payload);
  }

  @Post("skus/batch-update")
  @RequireOperatorCapability("manage_design_executions")
  batchUpdateSkus(@Body() payload: SkuBatchUpdatePayload) {
    return this.catalog.batchUpdate(payload);
  }

  @Post("skus/:skuCode/deactivate")
  @RequireOperatorCapability("manage_design_executions")
  deactivateSku(@Param("skuCode") skuCode: string) {
    return this.catalog.updateSkuStatus(skuCode, false);
  }

  @Post("skus/:skuCode/restore")
  @RequireOperatorCapability("manage_design_executions")
  restoreSku(@Param("skuCode") skuCode: string) {
    return this.catalog.updateSkuStatus(skuCode, true);
  }

  @Post("skus/bulk")
  @RequireOperatorCapability("manage_design_executions")
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
  @RequireOperatorCapability("manage_design_executions")
  importText(@Body() payload: { text: string }) {
    return this.catalog.importText(payload.text || "");
  }

  @Post("skus/import-file")
  @RequireOperatorCapability("manage_design_executions")
  importFile(@Body() payload: { fileName?: string; dataBase64?: string }) {
    return this.catalog.importFile(payload);
  }

  @Post("bundle/recommend")
  recommend(@Body() payload: BundleRecommendPayload) {
    return this.catalog.recommend(payload);
  }
}
