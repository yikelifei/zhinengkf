import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { assertDemoDataMutationAllowed } from "../shared/demo-data-boundary";
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

const SKU_TRACKED_FIELDS = [
  "name",
  "type",
  "category",
  "costPrice",
  "salePrice",
  "stock",
  "supplier",
  "leadTimeDays",
  "sceneTags",
  "mainImagePath",
  "angleImages",
  "dimensions",
  "weightGram",
  "material",
  "matchingRules",
  "replacementSkuCodes",
  "isActive",
] as const;

type SkuChangeContext = {
  action?: string;
  source: string;
  operator?: string;
  reason?: string;
};

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
    const [auditSkus, changeLogs] = await Promise.all([
      Promise.all(skus.map((sku) => this.toAuditSku({
        ...sku,
        costPrice: Number(sku.costPrice),
        salePrice: Number(sku.salePrice),
        sceneTags: Array.isArray(sku.sceneTags) ? sku.sceneTags : [],
        dimensions: sku.dimensions || {},
      }))),
      this.listSkuChangeLogsForDataReadiness(skus),
    ]);
    return auditSkuCatalog(auditSkus, { includeDataReadiness: true, changeLogs });
  }

  private async listSkuChangeLogsForDataReadiness(skus: Array<{ skuCode?: string }>) {
    const skuCodes = [...new Set(skus.map((sku) => String(sku.skuCode || "").trim()).filter(Boolean))];
    if (!skuCodes.length) return [];
    if (appConfig.useLocalStore) {
      return skuCodes.flatMap((skuCode) => this.localStore.listSkuChangeLogs({ skuCode, limit: 200 }));
    }
    return this.prisma.skuChangeLog.findMany({
      where: { skuCode: { in: skuCodes } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async listSkuChangeLogs(filter: { skuCode?: string; limit?: number } = {}) {
    const limit = this.normalizeLogLimit(filter.limit);
    const skuCode = String(filter.skuCode || "").trim() || undefined;
    if (appConfig.useLocalStore) return this.localStore.listSkuChangeLogs({ skuCode, limit });
    return this.prisma.skuChangeLog.findMany({
      where: skuCode ? { skuCode } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
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
    assertDemoDataMutationAllowed("demo SKU images");
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
      let angleImages = this.customDemoSkuAngleImages(sku.angleImages);
      if (!angleImages.length) {
        const angleSaved = await this.storage.saveAssetFromBase64({
          ownerType: "sku",
          ownerId: sku.skuCode,
          fileName: `${sku.skuCode}-demo-angle.png`,
          base64: createDemoPngBase64({
            label: `${sku.skuCode}-${sku.name}-${sku.type}-angle`,
            width: 640,
            height: sku.type === "gift_box" ? 420 : 520,
          }),
        });
        angleImages = [angleSaved.localPath];
      }
      const merged = {
        ...sku,
        mainImagePath: saved.localPath,
        imageUrl: saved.localPath,
        angleImages,
      };
      await this.syncSkuImageAssets(merged as SkuPayload);
      if (appConfig.useLocalStore) {
        updated.push(
          this.localStore.upsertSku(merged, {
            source: "demo_sku_images",
            operator: "system",
            reason: "prepare real design demo materials",
          }),
        );
      } else {
        updated.push(await this.prisma.$transaction((tx) => this.persistSkuMutation(tx, merged as SkuPayload, {
          action: "update",
          source: "demo_sku_images",
          operator: "system",
          reason: "prepare real design demo materials",
        })));
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
    const normalized = await this.archiveSkuImageReferences(payload);
    if (appConfig.useLocalStore) {
      const saved = this.localStore.upsertSku(normalized, { source: "manual_form", operator: "客服工作台" });
      await this.syncSkuImageAssets(saved as SkuPayload);
      return saved;
    }
    return this.prisma.$transaction(async (tx) => {
      const saved = await this.persistSkuMutation(tx, normalized, {
        source: "manual_form",
        operator: "客服工作台",
      });
      await this.syncSkuImageAssets(saved as SkuPayload, tx);
      return saved;
    });
  }

  async bulkUpsert(rows: SkuPayload[]) {
    rows.forEach((row) => this.assertSkuPayload(row));
    const normalizedRows: SkuPayload[] = [];
    for (const row of rows) normalizedRows.push(await this.archiveSkuImageReferences(row));
    if (appConfig.useLocalStore) {
      const existingBySkuCode = new Map(this.localStore.listSkus({ includeInactive: true }).map((sku) => [String(sku.skuCode), sku]));
      const importRows = normalizedRows.map((row) => {
        if (row.isActive !== undefined) return row;
        const existing = existingBySkuCode.get(row.skuCode);
        return { ...row, isActive: existing ? existing.isActive !== false : false };
      });
      const saved = this.localStore.bulkUpsertSkus(importRows, { source: "import_confirm", operator: "客服工作台" });
      for (const sku of saved.results || []) await this.syncSkuImageAssets(sku as SkuPayload);
      return saved;
    }
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const row of normalizedRows) {
        const saved = await this.persistSkuMutation(tx, row, {
          source: "import_confirm",
          operator: "客服工作台",
        });
        await this.syncSkuImageAssets(saved as SkuPayload, tx);
        results.push(saved);
      }
      return { count: results.length, results };
    });
  }

  async updateSkuStatus(skuCode: string, isActive: boolean) {
    const code = String(skuCode || "").trim();
    if (!code) throw new BadRequestException("skuCode is required");
    if (appConfig.useLocalStore) return this.localStore.updateSkuStatus(code, isActive, { source: "manual_status", operator: "客服工作台" });

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.sku.findUnique({ where: { skuCode: code } });
      if (!current) throw new NotFoundException(`sku not found: ${code}`);
      if (current.isActive === isActive) return current;
      const updated = await tx.sku.update({ where: { skuCode: code }, data: { isActive } });
      await this.createSkuChangeLog(tx, current, updated, {
        action: "status_change",
        source: "manual_status",
        operator: "客服工作台",
        reason: isActive ? "恢复商品" : "下架商品",
      });
      return updated;
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

    return this.prisma.$transaction(async (tx) => {
      const updated = [];
      const skipped = [];
      for (const skuCode of skuCodes) {
        const current = await tx.sku.findUnique({ where: { skuCode } });
        if (!current) {
          skipped.push({ skuCode, reason: "not_found" });
          continue;
        }
        const merged = { ...this.toSkuPayload(current), ...patch } as SkuPayload;
        const changedFields = this.buildSkuChangedFields(current, merged);
        if (!changedFields.length) {
          skipped.push({ skuCode, reason: "no_change" });
          continue;
        }
        const next = await tx.sku.update({ where: { skuCode }, data: this.toPrismaSku(merged) as any });
        await this.createSkuChangeLog(tx, current, next, {
          action: "batch_update",
          source: "batch_update",
          operator: "客服工作台",
        }, changedFields);
        updated.push(next);
      }
      return { count: updated.length, updated, skipped };
    });
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
      selectedSkuCodes: payload.selectedSkuCodes || [],
      requireImages: payload.requireImages === true,
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

  private async persistSkuMutation(tx: any, payload: SkuPayload, context: SkuChangeContext) {
    const current = await tx.sku.findUnique({ where: { skuCode: payload.skuCode } });
    if (!current) {
      const creationPayload = context.source === "import_confirm" && payload.isActive === undefined
        ? { ...payload, isActive: false }
        : payload;
      const created = await tx.sku.create({ data: this.toPrismaSku(creationPayload) as any });
      await this.createSkuChangeLog(tx, null, created, {
        ...context,
        action: context.action || "create",
      });
      return created;
    }
    const merged = { ...this.toSkuPayload(current), ...payload } as SkuPayload;
    const changedFields = this.buildSkuChangedFields(current, merged);
    if (!changedFields.length) return current;
    const updated = await tx.sku.update({
      where: { skuCode: payload.skuCode },
      data: this.toPrismaSku(merged) as any,
    });
    await this.createSkuChangeLog(tx, current, updated, {
      ...context,
      action: context.action || "update",
    }, changedFields);
    return updated;
  }

  private customDemoSkuAngleImages(angleImages: unknown) {
    const refs = Array.isArray(angleImages)
      ? angleImages.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return refs.filter((reference) => this.shouldPreserveDemoSkuImageReference(reference));
  }

  private isStarterSkuImageReference(reference: string) {
    return /^https:\/\/app\.zhenxiai\.cloud\/smart-kefu\/starter-skus\//i.test(String(reference || "").trim());
  }

  private shouldPreserveDemoSkuImageReference(reference: string) {
    const value = String(reference || "").trim();
    if (!value || this.isStarterSkuImageReference(value)) return false;
    if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/")) return true;
    if (!path.isAbsolute(value)) return false;
    try {
      return fsSync.existsSync(value) && fsSync.statSync(value).isFile();
    } catch {
      return false;
    }
  }

  private async createSkuChangeLog(
    tx: any,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    context: SkuChangeContext,
    knownChanges?: Array<{ field: string; before: unknown; after: unknown }>,
  ) {
    const changedFields = knownChanges || this.buildSkuChangedFields(before, after);
    if (before && !changedFields.length) return null;
    const afterSnapshot = this.pickSkuSnapshot(after);
    return tx.skuChangeLog.create({
      data: {
        skuId: String(after.id || before?.id || ""),
        skuCode: String(after.skuCode || before?.skuCode || ""),
        name: String(after.name || before?.name || ""),
        action: context.action || (before ? "update" : "create"),
        source: context.source,
        operator: context.operator || "system",
        reason: context.reason || "",
        changedFields: this.toJsonValue(changedFields),
        before: before ? this.toJsonValue(this.pickSkuSnapshot(before)) : undefined,
        after: this.toJsonValue(afterSnapshot),
      },
    });
  }

  private buildSkuChangedFields(before: Record<string, unknown> | null, after: Record<string, unknown>) {
    const beforeSnapshot = before ? this.pickSkuSnapshot(before) : null;
    const afterSnapshot = this.pickSkuSnapshot(after);
    return SKU_TRACKED_FIELDS
      .filter((field) => !beforeSnapshot || !this.sameSkuValue(beforeSnapshot[field], afterSnapshot[field]))
      .filter((field) => beforeSnapshot || afterSnapshot[field] !== undefined && afterSnapshot[field] !== "")
      .map((field) => ({
        field,
        before: beforeSnapshot ? beforeSnapshot[field] ?? null : null,
        after: afterSnapshot[field] ?? null,
      }));
  }

  private pickSkuSnapshot(value: Record<string, unknown>) {
    const normalized = this.toSkuPayload(value);
    return Object.fromEntries(
      ["skuCode", ...SKU_TRACKED_FIELDS]
        .filter((field) => normalized[field as keyof SkuPayload] !== undefined)
        .map((field) => [field, this.toJsonValue(normalized[field as keyof SkuPayload])]),
    ) as Record<string, unknown>;
  }

  private toSkuPayload(value: Record<string, any>): SkuPayload {
    return {
      skuCode: String(value.skuCode || ""),
      name: String(value.name || ""),
      type: value.type,
      category: value.category ?? undefined,
      sceneTags: Array.isArray(value.sceneTags) ? value.sceneTags : [],
      costPrice: Number(value.costPrice || 0),
      salePrice: Number(value.salePrice || 0),
      stock: Number(value.stock || 0),
      dimensions: value.dimensions || {},
      weightGram: value.weightGram ?? undefined,
      material: value.material ?? undefined,
      supplier: value.supplier ?? undefined,
      leadTimeDays: value.leadTimeDays ?? undefined,
      mainImagePath: value.mainImagePath ?? undefined,
      angleImages: Array.isArray(value.angleImages) ? value.angleImages : [],
      matchingRules: value.matchingRules || {},
      replacementSkuCodes: Array.isArray(value.replacementSkuCodes) ? value.replacementSkuCodes : [],
      isActive: value.isActive !== false,
    };
  }

  private sameSkuValue(left: unknown, right: unknown) {
    return JSON.stringify(this.toJsonValue(left)) === JSON.stringify(this.toJsonValue(right));
  }

  private toJsonValue(value: any): any {
    if (value === undefined) return undefined;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value?.toNumber === "function") return value.toNumber();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => this.toJsonValue(item));
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, this.toJsonValue(value[key])]),
      );
    }
    return String(value);
  }

  private normalizeLogLimit(value?: number) {
    if (value === undefined) return 30;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) throw new BadRequestException("limit must be a positive number");
    return Math.min(Math.floor(numeric), 200);
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

  private async archiveSkuImageReferences(payload: SkuPayload): Promise<SkuPayload> {
    const archived: SkuPayload = {
      ...payload,
      angleImages: Array.isArray(payload.angleImages) ? [...payload.angleImages] : [],
    };
    const cache = new Map<string, string>();
    archived.mainImagePath = await this.archiveSkuImageReference(
      payload.mainImagePath,
      payload.skuCode,
      "main",
      0,
      cache,
    );
    archived.angleImages = [];
    for (const [index, reference] of (payload.angleImages || []).entries()) {
      const archivedReference = await this.archiveSkuImageReference(reference, payload.skuCode, "angle", index + 1, cache);
      if (archivedReference) archived.angleImages.push(archivedReference);
    }
    return archived;
  }

  private async archiveSkuImageReference(
    reference: string | undefined,
    skuCode: string,
    role: "main" | "angle",
    index: number,
    cache: Map<string, string>,
  ) {
    const value = String(reference || "").trim();
    if (!value) return "";
    if (!this.shouldArchiveSkuImageReference(value)) return value;
    const key = path.resolve(value).toLowerCase();
    const existing = cache.get(key);
    if (existing) return existing;
    const saved = await this.storage.saveAssetFromLocalFile({
      ownerType: "sku",
      ownerId: skuCode,
      filePath: value,
      fileName: this.skuImageArchiveFileName(skuCode, role, index, value),
    });
    cache.set(key, saved.localPath);
    return saved.localPath;
  }

  private async syncSkuImageAssets(payload: SkuPayload, tx?: any) {
    const records = await this.buildSkuImageAssetRecords(payload);
    for (const record of records) {
      if (appConfig.useLocalStore) {
        this.localStore.upsertDesignAsset(record);
        continue;
      }
      const normalizedLocalPath = String(record.normalizedLocalPath || "").trim();
      if (!normalizedLocalPath) continue;
      const data = {
        ownerType: record.ownerType,
        ownerId: record.ownerId,
        role: record.role,
        fileName: record.fileName,
        mimeType: record.mimeType,
        localPath: record.localPath,
        normalizedLocalPath,
        sizeBytes: record.sizeBytes,
        source: record.source,
        wechatAccountId: null,
        conversationId: null,
        customerId: null,
      };
      const client = tx || this.prisma;
      await client.designAsset.upsert({
        where: { normalizedLocalPath },
        create: data,
        update: data,
      });
    }
  }

  private async buildSkuImageAssetRecords(payload: SkuPayload) {
    const skuCode = String(payload.skuCode || "").trim();
    if (!skuCode) return [];
    const references = [
      { localPath: payload.mainImagePath, source: "sku_catalog_main" },
      ...(Array.isArray(payload.angleImages) ? payload.angleImages : []).map((localPath, index) => ({
        localPath,
        source: `sku_catalog_angle_${index + 1}`,
      })),
    ];
    const seen = new Set<string>();
    const records = [];
    for (const reference of references) {
      const localPath = String(reference.localPath || "").trim();
      if (!localPath || !this.isInsideLocalStorage(localPath)) continue;
      const normalizedLocalPath = this.normalizeLocalAssetPath(localPath);
      if (!normalizedLocalPath || seen.has(normalizedLocalPath)) continue;
      let file;
      try {
        file = await this.storage.readLocalAsset(localPath);
      } catch {
        continue;
      }
      seen.add(normalizedLocalPath);
      records.push({
        ownerType: "sku",
        ownerId: skuCode,
        role: "sku_image",
        fileName: file.fileName || path.basename(localPath),
        mimeType: file.mimeType || "application/octet-stream",
        localPath,
        normalizedLocalPath,
        sizeBytes: file.sizeBytes || 0,
        source: reference.source,
      });
    }
    return records;
  }

  private normalizeLocalAssetPath(value?: string | null) {
    let input = String(value || "").trim();
    if (!input) return "";
    input = input
      .replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\/i, "")
      .replace(/\//g, "\\");
    if (!path.win32.isAbsolute(input)) return "";
    return path.win32.resolve(input).replace(/[\\]+$/g, "").replace(/\\/g, "/").toLowerCase();
  }

  private shouldArchiveSkuImageReference(reference: string) {
    const value = String(reference || "").trim();
    if (!value) return false;
    if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/")) return false;
    if (!path.isAbsolute(value)) return false;
    return !this.isInsideLocalStorage(value);
  }

  private isInsideLocalStorage(reference: string) {
    const root = path.resolve(appConfig.localStorageRoot);
    const resolved = path.resolve(reference);
    const relative = path.relative(root, resolved);
    return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative)) || relative === "";
  }

  private skuImageArchiveFileName(skuCode: string, role: "main" | "angle", index: number, reference: string) {
    const originalName = path.basename(reference) || "image";
    const suffix = role === "main" ? "main" : `angle-${index}`;
    return `${skuCode}-${suffix}-${originalName}`;
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
