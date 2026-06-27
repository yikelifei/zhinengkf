import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { createDemoPngBase64 } from "../shared/demo-png";
import { StorageService } from "../storage/storage.service";
import { UploadAssetPayload } from "./assets.types";

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly storage: StorageService,
  ) {}

  list(filter: { ownerType?: string; ownerId?: string } = {}) {
    if (appConfig.useLocalStore) return this.localStore.listDesignAssets(filter);
    return this.prisma.designAsset.findMany({
      where: {
        ownerType: filter.ownerType,
        ownerId: filter.ownerId,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async upload(payload: UploadAssetPayload) {
    this.assertPayload(payload);
    const saved = await this.savePayload(payload);
    const record = {
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      role: payload.role || "reference",
      fileName: payload.fileName,
      mimeType: payload.mimeType || guessMimeType(payload.fileName),
      localPath: saved.localPath,
      sizeBytes: saved.sizeBytes,
      source: payload.source || (payload.url ? "url" : "manual_upload"),
    };
    if (appConfig.useLocalStore) return this.localStore.createDesignAsset(record);
    return this.prisma.designAsset.create({
      data: {
        ownerType: record.ownerType,
        ownerId: record.ownerId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        localPath: record.localPath,
        sizeBytes: record.sizeBytes,
        source: record.source,
      },
    });
  }

  async createDemoCustomerLogo(customerId: string) {
    return this.upload({
      ownerType: "customer",
      ownerId: customerId,
      role: "customer_logo",
      fileName: "demo-customer-logo.png",
      mimeType: "image/png",
      source: "demo",
      base64: createDemoPngBase64({ label: `customer-logo-${customerId}`, width: 640, height: 240 }),
    });
  }

  readLocalAsset(localPath: string) {
    return this.storage.readLocalAsset(localPath);
  }

  private assertPayload(payload: UploadAssetPayload) {
    if (!payload?.ownerType) throw new Error("ownerType is required");
    if (!payload?.ownerId) throw new Error("ownerId is required");
    if (!payload?.fileName) throw new Error("fileName is required");
    if (!payload.base64 && !payload.text && !payload.url) {
      throw new Error("one of base64, text or url is required");
    }
  }

  private savePayload(payload: UploadAssetPayload) {
    if (payload.base64) {
      return this.storage.saveAssetFromBase64({
        ownerType: payload.ownerType,
        ownerId: payload.ownerId,
        fileName: payload.fileName,
        base64: payload.base64,
      });
    }
    if (payload.text) {
      return this.storage.saveAssetFromText({
        ownerType: payload.ownerType,
        ownerId: payload.ownerId,
        fileName: payload.fileName,
        text: payload.text,
      });
    }
    return this.storage.saveAssetFromUrl({
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      fileName: payload.fileName,
      url: payload.url || "",
    });
  }
}

function guessMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
