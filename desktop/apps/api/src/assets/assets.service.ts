import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { createDemoPngBase64 } from "../shared/demo-png";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { StorageService } from "../storage/storage.service";
import { UploadAssetPayload } from "./assets.types";

type AssetIdentityFilter = {
  ownerType?: string;
  ownerId?: string;
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly storage: StorageService,
  ) {}

  list(filter: { ownerType?: string; ownerId?: string; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) {
      this.assertLocalCustomerAssetListIdentity(filter);
      return this.localStore.listDesignAssets(filter);
    }
    return this.listPrismaAssets(filter);
  }

  private async listPrismaAssets(filter: AssetIdentityFilter) {
    await this.assertCustomerAssetListIdentity(filter);
    return this.prisma.designAsset.findMany({
      where: designAssetWhere(filter),
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async upload(payload: UploadAssetPayload) {
    this.assertPayload(payload);
    await this.assertCustomerAssetIdentity(payload);
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
      wechatAccountId: payload.expectedWechatAccountId || null,
      conversationId: payload.expectedConversationId || null,
      customerId: payload.expectedCustomerId || (payload.ownerType === "customer" ? payload.ownerId : null),
    };
    if (appConfig.useLocalStore) return this.localStore.createDesignAsset(record);
    return this.prisma.designAsset.create({
      data: {
        ownerType: record.ownerType,
        ownerId: record.ownerId,
        role: record.role,
        fileName: record.fileName,
        mimeType: record.mimeType,
        localPath: record.localPath,
        sizeBytes: record.sizeBytes,
        source: record.source,
        wechatAccountId: record.wechatAccountId,
        conversationId: record.conversationId,
        customerId: record.customerId,
      },
    });
  }

  async createDemoCustomerLogo(customerId: string, expected: ExpectedIdentityPayload = {}) {
    return this.upload({
      ownerType: "customer",
      ownerId: customerId,
      ...expected,
      role: "customer_logo",
      fileName: "demo-customer-logo.png",
      mimeType: "image/png",
      source: "demo",
      base64: createDemoPngBase64({ label: `customer-logo-${customerId}`, width: 640, height: 240 }),
    });
  }

  async readLocalAsset(localPath: string, expected: ExpectedIdentityPayload = {}) {
    await this.assertLocalAssetReadIdentity(localPath, expected);
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

  private async assertCustomerAssetIdentity(payload: UploadAssetPayload & ExpectedIdentityPayload) {
    if (payload.ownerType !== "customer") return;
    const missing = [
      !payload.expectedWechatAccountId ? "expectedWechatAccountId" : "",
      !payload.expectedConversationId ? "expectedConversationId" : "",
      !payload.expectedCustomerId ? "expectedCustomerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`customer asset requires conversation identity: ${missing.join(", ")}`);
    }
    assertExpectedIdentity({ customerId: payload.ownerId }, { expectedCustomerId: payload.expectedCustomerId }, "customer asset");
    const conversation = await this.findConversationForIdentity({
      wechatAccountId: payload.expectedWechatAccountId,
      conversationId: payload.expectedConversationId,
    });
    assertExpectedIdentity(
      conversation ? { ...conversation, conversationId: conversation.id } : conversation,
      payload,
      "customer asset conversation",
    );
    assertExpectedIdentity(
      { customerId: conversation?.customerId },
      { expectedCustomerId: payload.expectedCustomerId },
      "customer asset conversation customer",
    );
  }

  private async assertCustomerAssetListIdentity(filter: AssetIdentityFilter) {
    if (filter.ownerType !== "customer" && !filter.customerId) return;
    const missing = [
      !filter.wechatAccountId ? "wechatAccountId" : "",
      !filter.conversationId ? "conversationId" : "",
      !filter.customerId ? "customerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`customer asset list requires conversation identity: ${missing.join(", ")}`);
    }
    if (filter.ownerId) {
      assertExpectedIdentity(
        { customerId: filter.ownerId },
        { expectedCustomerId: filter.customerId },
        "customer asset list owner",
      );
    }
    const conversation = await this.findConversationForIdentity({
      wechatAccountId: filter.wechatAccountId,
      conversationId: filter.conversationId,
    });
    assertExpectedIdentity(
      conversation ? { ...conversation, conversationId: conversation.id } : conversation,
      {
        expectedWechatAccountId: filter.wechatAccountId,
        expectedConversationId: filter.conversationId,
        expectedCustomerId: filter.customerId,
      },
      "customer asset list conversation",
    );
    assertExpectedIdentity(
      { customerId: conversation?.customerId },
      { expectedCustomerId: filter.customerId },
      "customer asset list conversation customer",
    );
  }

  private assertLocalCustomerAssetListIdentity(filter: AssetIdentityFilter) {
    if (filter.ownerType !== "customer") return;
    const missing = [
      !filter.wechatAccountId ? "wechatAccountId" : "",
      !filter.conversationId ? "conversationId" : "",
      !filter.customerId ? "customerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`customer asset list requires conversation identity: ${missing.join(", ")}`);
    }
    if (filter.ownerId) {
      assertExpectedIdentity(
        { customerId: filter.ownerId },
        { expectedCustomerId: filter.customerId },
        "customer asset list owner",
      );
    }
    const conversation =
      this.localStore.listConversations(filter.wechatAccountId).find((item: any) => item.id === filter.conversationId) ||
      this.localStore.listConversations().find((item: any) => item.id === filter.conversationId);
    const expected = {
      expectedWechatAccountId: filter.wechatAccountId,
      expectedConversationId: filter.conversationId,
      expectedCustomerId: filter.customerId,
    };
    assertExpectedIdentity(
      conversation ? { ...conversation, conversationId: conversation.id } : conversation,
      expected,
      "customer asset list conversation",
    );
    assertExpectedIdentity(
      { customerId: conversation?.customerId },
      { expectedCustomerId: filter.customerId },
      "customer asset list conversation customer",
    );
  }

  private async assertLocalAssetReadIdentity(localPath: string, expected: ExpectedIdentityPayload = {}) {
    const asset = await this.findDesignAssetByLocalPath(localPath);
    if (!asset) return;
    const scopedToCustomer =
      asset.ownerType === "customer" || Boolean(asset.wechatAccountId || asset.conversationId || asset.customerId);
    if (!scopedToCustomer) return;
    const missing = [
      !expected.expectedWechatAccountId ? "expectedWechatAccountId" : "",
      !expected.expectedConversationId ? "expectedConversationId" : "",
      !expected.expectedCustomerId ? "expectedCustomerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`local customer asset requires conversation identity: ${missing.join(", ")}`);
    }
    if (appConfig.useLocalStore) {
      assertExpectedIdentity(asset, expected, "local asset");
      return;
    }
    if (asset.ownerType === "customer") {
      const conversation = await this.findConversationForIdentity({
        wechatAccountId: expected.expectedWechatAccountId,
        conversationId: expected.expectedConversationId,
      });
      assertExpectedIdentity(
        conversation ? { ...conversation, conversationId: conversation.id } : conversation,
        expected,
        "local asset conversation",
      );
      assertExpectedIdentity(
        { customerId: conversation?.customerId },
        { expectedCustomerId: expected.expectedCustomerId },
        "local asset conversation customer",
      );
      assertExpectedIdentity(
        { customerId: asset.ownerId },
        { expectedCustomerId: expected.expectedCustomerId },
        "local asset owner",
      );
      return;
    }
    assertExpectedIdentity(asset, expected, "local asset");
  }

  private async findDesignAssetByLocalPath(localPath: string) {
    const normalized = this.normalizeLocalAssetPath(localPath);
    if (!normalized) return null;
    if (appConfig.useLocalStore) {
      return (
        this.localStore
          .listDesignAssets()
          .find((asset: any) => this.normalizeLocalAssetPath(asset.localPath) === normalized) || null
      );
    }
    const direct = await this.prisma.designAsset.findFirst({ where: { localPath } });
    if (direct) return direct;
    return null;
  }

  private async findConversationForIdentity(filter: { wechatAccountId?: string; conversationId?: string }) {
    if (appConfig.useLocalStore) {
      const conversations = this.localStore.listConversations(filter.wechatAccountId);
      return (
        conversations.find((item: any) => item.id === filter.conversationId) ||
        this.localStore.listConversations().find((item: any) => item.id === filter.conversationId) ||
        null
      );
    }
    if (!filter.conversationId) return null;
    return (this.prisma as any).conversation.findUnique({ where: { id: filter.conversationId } });
  }

  private normalizeLocalAssetPath(value?: string | null) {
    return String(value || "")
      .trim()
      .replace(/[\\/]+/g, "/")
      .toLowerCase();
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

function designAssetWhere(filter: AssetIdentityFilter = {}) {
  const customerOwnerId = filter.customerId || (filter.ownerType === "customer" ? filter.ownerId : "");
  return {
    ownerType: filter.ownerType || (customerOwnerId ? "customer" : undefined),
    ownerId: filter.ownerId || customerOwnerId || undefined,
    wechatAccountId: filter.wechatAccountId || undefined,
    conversationId: filter.conversationId || undefined,
    customerId: filter.customerId || undefined,
  };
}
