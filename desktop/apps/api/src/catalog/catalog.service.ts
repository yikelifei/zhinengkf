import fs from "node:fs/promises";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { createDemoPngBase64 } from "../shared/demo-png";
import { StorageService } from "../storage/storage.service";
import { BundleRecommendPayload, SkuBatchUpdatePayload, SkuPayload } from "./catalog.types";
import { rules } from "../shared/rules";

const {
  auditSkuCatalog,
  buildSkuImportTemplateCsv,
  buildSkuImportTemplateXlsx,
  getSkuImportFieldGuide,
  parseSkuImportFile,
  parseSkuImportText,
  isLikelyImageBuffer,
  recommendBundle,
} = rules;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly storage: StorageService,
  ) {}

  async listSkus(options: { includeInactive?: boolean } = {}) {
    if (appConfig.useLocalStore) return this.localStore.listSkus(options);
    return this.prisma.sku.findMany({
      where: options.includeInactive ? undefined : { isActive: true },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
    });
  }

  async auditSkus() {
    const skus = await this.listSkus();
    return auditSkuCatalog(
      await Promise.all(skus.map((sku) => this.toAuditSku({
        ...sku,
        costPrice: Number(sku.costPrice),
        salePrice: Number(sku.salePrice),
        sceneTags: Array.isArray(sku.sceneTags) ? sku.sceneTags : [],
        dimensions: sku.dimensions || {},
      }))),
    );
  }

  async listSkuChangeLogs(filter: { skuCode?: string; limit?: number } = {}) {
    if (appConfig.useLocalStore) return this.localStore.listSkuChangeLogs(filter);
    return [];
  }

  getSkuImportFields() {
    return getSkuImportFieldGuide();
  }

  getSkuImportTemplate(format: "xlsx" | "csv" = "xlsx") {
    const fields = getSkuImportFieldGuide();
    if (format === "csv") {
      const csv = buildSkuImportTemplateCsv();
      return {
        fileName: "sku-import-template.csv",
        mimeType: "text/csv;charset=utf-8",
        dataBase64: Buffer.from(csv, "utf8").toString("base64"),
        fields,
      };
    }
    const workbook = buildSkuImportTemplateXlsx();
    return {
      fileName: "sku-import-template.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dataBase64: workbook.toString("base64"),
      fields,
    };
  }

  async createDemoSkuImages() {
    const skus = await this.listSkus({ includeInactive: true });
    const updated = [];
    for (const sku of skus) {
      const saved = await this.storage.saveAssetFromBase64({
        ownerType: "sku",
        ownerId: sku.skuCode,
        fileName: `${sku.skuCode}-demo.png`,
        base64: createDemoPngBase64({
          label: `${sku.skuCode}-${sku.name}-${sku.type}`,
          width: 640,
          height: sku.type === "gift_box" ? 420 : 520,
        }),
      });
      const merged = {
        ...sku,
        mainImagePath: saved.localPath,
        angleImages: Array.isArray(sku.angleImages) && sku.angleImages.length ? sku.angleImages : [saved.localPath],
      };
      if (appConfig.useLocalStore) {
        updated.push(
          this.localStore.upsertSku(merged, {
            source: "demo_sku_images",
            operator: "system",
            reason: "prepare real design demo materials",
          }),
        );
      } else {
        updated.push(
          await this.prisma.sku.update({
            where: { skuCode: sku.skuCode },
            data: this.toPrismaSku(merged as SkuPayload) as any,
          }),
        );
      }
    }
    return {
      count: updated.length,
      updated,
      note: "Demo images are only for local smoke testing. Replace them with real SKU photos before commercial use.",
    };
  }

  async upsertSku(payload: SkuPayload) {
    this.assertSkuPayload(payload);
    if (appConfig.useLocalStore) return this.localStore.upsertSku(payload, { source: "manual_form", operator: "客服工作台" });
    const data = this.toPrismaSku(payload) as any;
    return this.prisma.sku.upsert({
      where: { skuCode: payload.skuCode },
      update: data,
      create: data,
    });
  }

  async bulkUpsert(rows: SkuPayload[]) {
    if (appConfig.useLocalStore) return this.localStore.bulkUpsertSkus(rows, { source: "import_confirm", operator: "客服工作台" });
    const results = [];
    for (const row of rows) {
      results.push(await this.upsertSku(row));
    }
    return { count: results.length, results };
  }

  async updateSkuStatus(skuCode: string, isActive: boolean) {
    const code = String(skuCode || "").trim();
    if (!code) throw new BadRequestException("skuCode is required");
    if (appConfig.useLocalStore) return this.localStore.updateSkuStatus(code, isActive, { source: "manual_status", operator: "客服工作台" });

    const current = await this.prisma.sku.findUnique({ where: { skuCode: code } });
    if (!current) throw new NotFoundException(`sku not found: ${code}`);
    return this.prisma.sku.update({
      where: { skuCode: code },
      data: { isActive },
    });
  }

  async batchUpdate(payload: SkuBatchUpdatePayload) {
    const skuCodes = [...new Set((payload.skuCodes || []).map((code) => String(code || "").trim()).filter(Boolean))];
    if (!skuCodes.length) throw new BadRequestException("skuCodes is required");
    const patch = this.normalizeSkuPatch(payload.patch || {});
    if (!Object.keys(patch).length) throw new BadRequestException("patch is required");

    if (appConfig.useLocalStore) {
      return this.localStore.batchUpdateSkus(skuCodes, patch, { source: "batch_update", operator: "客服工作台" });
    }

    const updated = [];
    const skipped = [];
    for (const skuCode of skuCodes) {
      const current = await this.prisma.sku.findUnique({ where: { skuCode } });
      if (!current) {
        skipped.push({ skuCode, reason: "not_found" });
        continue;
      }
      const merged = {
        skuCode: current.skuCode,
        name: current.name,
        type: current.type as any,
        category: current.category || undefined,
        sceneTags: Array.isArray(current.sceneTags) ? (current.sceneTags as string[]) : [],
        costPrice: Number(current.costPrice),
        salePrice: Number(current.salePrice),
        stock: current.stock,
        dimensions: (current.dimensions as Record<string, unknown>) || {},
        weightGram: current.weightGram || undefined,
        material: current.material || undefined,
        supplier: current.supplier || undefined,
        leadTimeDays: current.leadTimeDays || undefined,
        mainImagePath: current.mainImagePath || undefined,
        angleImages: Array.isArray(current.angleImages) ? (current.angleImages as string[]) : [],
        matchingRules: (current.matchingRules as Record<string, unknown>) || {},
        replacementSkuCodes: Array.isArray(current.replacementSkuCodes) ? (current.replacementSkuCodes as string[]) : [],
        isActive: current.isActive,
        ...patch,
      };
      updated.push(
        await this.prisma.sku.update({
          where: { skuCode },
          data: this.toPrismaSku(merged) as any,
        }),
      );
    }
    return { count: updated.length, updated, skipped };
  }

  async previewImportText(text: string) {
    return this.withImportAudit(parseSkuImportText(text));
  }

  async previewImportFile(payload: { fileName?: string; dataBase64?: string }) {
    return this.withImportAudit(parseSkuImportFile(payload));
  }

  async importText(text: string) {
    const parsed = parseSkuImportText(text);
    if (!parsed.rows.length) {
      return {
        ...parsed,
        saved: { count: 0, results: [] },
      };
    }
    const saved = await this.bulkUpsert(parsed.rows as SkuPayload[]);
    return {
      ...parsed,
      saved,
    };
  }

  async importFile(payload: { fileName?: string; dataBase64?: string }) {
    const parsed = parseSkuImportFile(payload);
    if (!parsed.rows.length) {
      return {
        ...parsed,
        saved: { count: 0, results: [] },
      };
    }
    const saved = await this.bulkUpsert(parsed.rows as SkuPayload[]);
    return {
      ...parsed,
      saved,
    };
  }

  async recommend(payload: BundleRecommendPayload) {
    const skus = await this.listSkus();
    return recommendBundle({
      skus: skus.map((sku) => ({
        ...sku,
        costPrice: Number(sku.costPrice),
        salePrice: Number(sku.salePrice),
        sceneTags: Array.isArray(sku.sceneTags) ? sku.sceneTags : [],
        replacementSkuCodes: Array.isArray(sku.replacementSkuCodes) ? sku.replacementSkuCodes : [],
      })) as any,
      budget: payload.budget,
      scene: payload.scene || "",
      maxItems: payload.maxItems || 8,
    });
  }

  private toPrismaSku(payload: SkuPayload) {
    return {
      skuCode: payload.skuCode,
      name: payload.name,
      type: payload.type,
      category: payload.category,
      sceneTags: payload.sceneTags || [],
      costPrice: payload.costPrice,
      salePrice: payload.salePrice,
      profitRate: payload.salePrice ? (payload.salePrice - payload.costPrice) / payload.salePrice : 0,
      stock: payload.stock || 0,
      dimensions: payload.dimensions || {},
      weightGram: payload.weightGram,
      material: payload.material,
      supplier: payload.supplier,
      leadTimeDays: payload.leadTimeDays,
      mainImagePath: payload.mainImagePath,
      angleImages: payload.angleImages || [],
      matchingRules: payload.matchingRules || {},
      replacementSkuCodes: payload.replacementSkuCodes || [],
      isActive: payload.isActive !== false,
    };
  }

  private async toAuditSku(payload: Partial<SkuPayload>) {
    const mainImageCheck = await this.inspectImageReference(payload.mainImagePath);
    const angleImageIssues = await Promise.all(
      (Array.isArray(payload.angleImages) ? payload.angleImages : []).map(async (imagePath, index) => {
        const check = await this.inspectImageReference(imagePath);
        return {
          index,
          path: check.path,
          fileMissing: check.localFileMissing,
          invalidType: check.invalidImageType,
        };
      }),
    );
    return {
      ...payload,
      costPrice: Number(payload.costPrice || 0),
      salePrice: Number(payload.salePrice || 0),
      stock: Number(payload.stock || 0),
      sceneTags: Array.isArray(payload.sceneTags) ? payload.sceneTags : [],
      dimensions: payload.dimensions || {},
      mainImageFileMissing: mainImageCheck.localFileMissing,
      mainImageInvalidType: mainImageCheck.invalidImageType,
      angleImageIssues: angleImageIssues.filter((issue) => issue.fileMissing || issue.invalidType),
    };
  }

  private async withImportAudit(parsed: any) {
    return {
      ...parsed,
      audit: auditSkuCatalog(await Promise.all((parsed.rows || []).map((sku: Partial<SkuPayload>) => this.toAuditSku(sku)))),
    };
  }

  private async inspectImageReference(imagePath?: string) {
    const value = String(imagePath || "").trim();
    if (!value) return { path: value, localFileMissing: false, invalidImageType: false };
    const invalidImageType = this.isUnsupportedImageReference(value);
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) {
      return { path: value, localFileMissing: false, invalidImageType };
    }
    try {
      const resolvedPath = path.resolve(value);
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) return { path: value, localFileMissing: true, invalidImageType };
      const invalidContent = !(await this.isLikelyLocalImageFile(resolvedPath));
      return { path: value, localFileMissing: false, invalidImageType: invalidImageType || invalidContent };
    } catch {
      return { path: value, localFileMissing: true, invalidImageType };
    }
  }

  private async isLikelyLocalImageFile(resolvedPath: string) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(resolvedPath, "r");
      const buffer = Buffer.alloc(512);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      return isLikelyImageBuffer(buffer.subarray(0, result.bytesRead));
    } catch {
      return false;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private isUnsupportedImageReference(imagePath: string) {
    const value = String(imagePath || "").trim();
    if (!value) return false;
    if (/^data:/i.test(value)) return !/^data:image\//i.test(value);
    const clean = value.split(/[?#]/)[0] || "";
    const fileName = clean.split(/[\\/]/).filter(Boolean).pop() || clean;
    const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
    if (!extension) return false;
    return ![".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".avif"].includes(extension);
  }

  private assertSkuPayload(payload: SkuPayload) {
    if (!payload?.skuCode?.trim()) throw new BadRequestException("skuCode is required");
    if (!payload?.name?.trim()) throw new BadRequestException("name is required");
    if (!["gift_box", "item", "accessory"].includes(payload.type)) throw new BadRequestException("type is invalid");
    if (!(Number(payload.salePrice) > 0)) throw new BadRequestException("salePrice must be greater than 0");
    if (!(Number(payload.costPrice) >= 0)) throw new BadRequestException("costPrice must be greater than or equal to 0");
  }

  private normalizeSkuPatch(patch: SkuBatchUpdatePayload["patch"]) {
    const normalized: SkuBatchUpdatePayload["patch"] = {};
    if (patch.costPrice !== undefined) normalized.costPrice = Math.max(0, Number(patch.costPrice || 0));
    if (patch.salePrice !== undefined) {
      const salePrice = Number(patch.salePrice || 0);
      if (!(salePrice > 0)) throw new BadRequestException("salePrice must be greater than 0");
      normalized.salePrice = salePrice;
    }
    if (patch.stock !== undefined) normalized.stock = Math.max(0, Math.floor(Number(patch.stock || 0)));
    if (patch.supplier !== undefined) normalized.supplier = String(patch.supplier || "").trim();
    if (patch.leadTimeDays !== undefined) normalized.leadTimeDays = Math.max(0, Math.floor(Number(patch.leadTimeDays || 0)));
    if (patch.sceneTags !== undefined) normalized.sceneTags = Array.isArray(patch.sceneTags) ? patch.sceneTags.filter(Boolean) : [];
    if (patch.isActive !== undefined) normalized.isActive = patch.isActive !== false;
    return normalized;
  }
}
