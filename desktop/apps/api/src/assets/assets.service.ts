import path from "node:path";
import fs from "node:fs/promises";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { appConfig } from "../shared/app-config";
import { createDemoPngBase64 } from "../shared/demo-png";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { StorageService } from "../storage/storage.service";
import { UploadAssetPayload } from "./assets.types";

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localStore: LocalStoreService,
    private readonly storage: StorageService,
  ) {}

  list(filter: { ownerType?: string; ownerId?: string; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (appConfig.useLocalStore) {
      this.assertCustomerAssetListIdentityLocal(filter);
      return this.localStore.listDesignAssets(filter);
    }
    return this.listPrisma(filter);
  }

  private async listPrisma(filter: { ownerType?: string; ownerId?: string; wechatAccountId?: string; conversationId?: string; customerId?: string }) {
    await this.assertCustomerAssetListIdentity(filter);
    return this.prisma.designAsset.findMany({
      where: {
        ownerType: filter.ownerType,
        ownerId: filter.ownerId,
        ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
        ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async upload(payload: UploadAssetPayload) {
    this.assertPayload(payload);
    await this.assertCustomerAssetIdentity(payload);
    const saved = await this.savePayload(payload);
    const canonicalSavedPath = await this.resolveCanonicalLocalAssetPath(saved.localPath, true);
    const record = {
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      role: payload.role || "reference",
      fileName: payload.fileName,
      mimeType: payload.mimeType || guessMimeType(payload.fileName),
      localPath: canonicalSavedPath,
      normalizedLocalPath: this.normalizeLocalAssetPath(canonicalSavedPath),
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
        fileName: record.fileName,
        mimeType: record.mimeType,
        localPath: record.localPath,
        normalizedLocalPath: record.normalizedLocalPath,
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
    const canonicalLocalPath = await this.resolveCanonicalLocalAssetPath(localPath);
    await this.assertLocalAssetReadIdentity(canonicalLocalPath, expected);
    return this.storage.readLocalAsset(canonicalLocalPath);
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
    const conversation = await this.findConversationForIdentity(
      payload.expectedConversationId || "",
      payload.expectedWechatAccountId || "",
    );
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

  private async assertCustomerAssetListIdentity(filter: {
    ownerType?: string;
    ownerId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    const expected = this.assertCustomerAssetListRequest(filter);
    if (!expected) return;
    const conversation = await this.findConversationForIdentity(filter.conversationId || "", filter.wechatAccountId || "");
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

  private assertCustomerAssetListIdentityLocal(filter: {
    ownerType?: string;
    ownerId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    const expected = this.assertCustomerAssetListRequest(filter);
    if (!expected) return;
    const conversation =
      this.localStore.listConversations(filter.wechatAccountId).find((item: any) => item.id === filter.conversationId) ||
      this.localStore.listConversations().find((item: any) => item.id === filter.conversationId) ||
      null;
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

  private assertCustomerAssetListRequest(filter: {
    ownerType?: string;
    ownerId?: string;
    wechatAccountId?: string;
    conversationId?: string;
    customerId?: string;
  }) {
    if (filter.ownerType !== "customer") return null;
    const expected = {
      expectedWechatAccountId: filter.wechatAccountId,
      expectedConversationId: filter.conversationId,
      expectedCustomerId: filter.customerId,
    };
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
    return expected;
  }

  private async assertLocalAssetReadIdentity(localPath: string, expected: ExpectedIdentityPayload = {}) {
    const normalized = this.normalizeLocalAssetPath(localPath);
    const asset = await this.findDesignAssetByLocalPath(localPath);
    if (!asset) {
      if (this.isCustomerAssetPath(normalized)) {
        throw new ForbiddenException("customer asset path has no unambiguous persisted identity");
      }
      return;
    }
    const scopedToCustomer =
      this.isCustomerAssetPath(normalized) ||
      asset.ownerType === "customer" ||
      Boolean(asset.wechatAccountId || asset.conversationId || asset.customerId);
    if (!scopedToCustomer) return;
    const missing = [
      !expected.expectedWechatAccountId ? "expectedWechatAccountId" : "",
      !expected.expectedConversationId ? "expectedConversationId" : "",
      !expected.expectedCustomerId ? "expectedCustomerId" : "",
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`local customer asset requires conversation identity: ${missing.join(", ")}`);
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
    const matches = await this.prisma.designAsset.findMany({
      where: { normalizedLocalPath: normalized },
      take: 2,
    });
    if (matches.length > 1) {
      throw new ForbiddenException("local asset path resolves to ambiguous persisted identities");
    }
    return matches[0] || null;
  }

  private normalizeLocalAssetPath(value?: string | null) {
    let input = String(value || "").trim();
    if (!input) return "";
    input = input
      .replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\/i, "")
      .replace(/\//g, "\\");
    if (!path.win32.isAbsolute(input)) {
      throw new BadRequestException("local asset path must be absolute");
    }
    return path.win32.resolve(input).replace(/[\\]+$/g, "").replace(/\\/g, "/").toLowerCase();
  }

  private async resolveCanonicalLocalAssetPath(value: string, allowTrustedRelative = false) {
    let input = String(value || "").trim();
    if (allowTrustedRelative && input && !path.win32.isAbsolute(input)) input = path.resolve(input);
    this.normalizeLocalAssetPath(input);
    try {
      return await fs.realpath(input);
    } catch {
      return input;
    }
  }

  private isCustomerAssetPath(normalizedLocalPath: string) {
    if (!normalizedLocalPath) return false;
    const customerRoot = `${this.normalizeLocalAssetPath(path.join(appConfig.localStorageRoot, "assets", "customer"))}/`;
    return normalizedLocalPath.startsWith(customerRoot);
  }

  private async findConversationForIdentity(conversationId: string, wechatAccountId: string) {
    if (appConfig.useLocalStore) {
      return (
        this.localStore.listConversations(wechatAccountId).find((item: any) => item.id === conversationId) ||
        this.localStore.listConversations().find((item: any) => item.id === conversationId) ||
        null
      );
    }
    return this.prisma.conversation.findFirst({
      where: { id: conversationId, wechatAccountId },
      select: { id: true, wechatAccountId: true, customerId: true },
    });
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
