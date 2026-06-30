import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";

const {
  diagnoseWechatWindowSnapshot,
  evaluateTrainingSampleQuality,
  isSceneClarificationReply,
  isTrainingSampleReady,
  normalizeTrainingSampleStatus,
  trainingSampleReviewNote,
  validateDesignAssetBinding,
  validateDesignJobIdentity,
  validateInboundConversationBinding,
  validateOrderDraftQuoteBinding,
  validateQuoteDraftIdentity,
  validateSendTaskBinding,
} = require(path.join(process.cwd(), "packages", "rules"));

type StoreData = {
  wechatAccounts: any[];
  customers: any[];
  conversations: any[];
  messages: any[];
  wechatWindowSnapshots: any[];
  skus: any[];
  skuChangeLogs: any[];
  designAssets: any[];
  designJobs: any[];
  designImages: any[];
  designRevisions: any[];
  notifications: any[];
  sendTasks: any[];
  sendAttempts: any[];
  quoteDrafts: any[];
  orderDrafts: any[];
  reviewLogs: any[];
  agents: any[];
  agentSkills: any[];
  chatImports: any[];
  trainingSamples: any[];
  knowledgeEntries: any[];
  routeEvaluations: any[];
  automationRuns: any[];
};

type IdentityListFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

function normalizePathKey(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.normalize(text).replace(/\\/g, "/").toLowerCase();
}

function localStoreCanonicalSkillName(name: string) {
  return String(name || "").trim().replace(/\s+/g, "").toLowerCase();
}

function localStoreIsSceneClarificationDerivedBusinessSkill(data: StoreData, skill: any) {
  if (!skill || localStoreCanonicalSkillName(skill.name) === localStoreCanonicalSkillName("防乱回复")) return false;
  const sourceSampleIds = Array.isArray(skill.sourceSampleIds) ? skill.sourceSampleIds : [];
  if (!sourceSampleIds.length) return false;
  const samples = sourceSampleIds
    .map((sampleId: string) => data.trainingSamples.find((sample) => sample.id === sampleId))
    .filter(Boolean);
  return Boolean(samples.length) && samples.every((sample: any) => isSceneClarificationReply(sample.idealReply));
}

function localStoreIsSceneClarificationKnowledgeEntry(data: StoreData, entry: any) {
  const sample = entry?.sourceId ? data.trainingSamples.find((item) => item.id === entry.sourceId) : null;
  return Boolean(sample && isSceneClarificationReply(sample.idealReply));
}

@Injectable()
export class LocalStoreService {
  private readonly filePath = path.join(process.cwd(), ".runtime", "local-store.json");

  listSkus(options: { includeInactive?: boolean } = {}) {
    return this.read().skus.filter((sku) => options.includeInactive || sku.isActive !== false);
  }

  listAutomationRuns(limit = 10) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 10), 50));
    return this.read()
      .automationRuns
      .filter(Boolean)
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
      .slice(0, safeLimit);
  }

  saveAutomationRun(run: any, limit = 10) {
    const data = this.read();
    const safeLimit = Math.max(1, Math.min(Number(limit || 10), 50));
    const key = automationRunKey(run);
    const withoutDuplicate = data.automationRuns.filter((item) => automationRunKey(item) !== key);
    data.automationRuns = [run, ...withoutDuplicate]
      .filter(Boolean)
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
      .slice(0, safeLimit);
    this.write(data);
    return run;
  }

  listSkuChangeLogs(filter: { skuCode?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(Number(filter.limit || 30), 200));
    return this.read()
      .skuChangeLogs
      .filter((log) => !filter.skuCode || log.skuCode === filter.skuCode)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  upsertSku(payload: any, context: Record<string, unknown> = {}) {
    const data = this.read();
    const now = new Date().toISOString();
    const index = data.skus.findIndex((sku) => sku.skuCode === payload.skuCode);
    const previous = index >= 0 ? data.skus[index] : null;
    const record: any = {
      id: index >= 0 ? data.skus[index].id : id("sku"),
      ...payload,
      stock: payload.stock || 0,
      isActive: payload.isActive !== false,
      createdAt: index >= 0 ? data.skus[index].createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) data.skus[index] = record;
    else data.skus.push(record);
    this.recordSkuChangeLog(data, previous, record, {
      action: previous ? "update" : "create",
      source: context.source || (previous ? "manual_upsert" : "manual_create"),
      operator: context.operator,
      reason: context.reason,
    });
    this.write(data);
    return record;
  }

  bulkUpsertSkus(rows: any[], context: Record<string, unknown> = {}) {
    const results = rows.map((row) => this.upsertSku(row, { source: "bulk_import", ...context }));
    return { count: results.length, results };
  }

  updateSkuStatus(skuCode: string, isActive: boolean, context: Record<string, unknown> = {}) {
    const data = this.read();
    const index = data.skus.findIndex((sku) => sku.skuCode === skuCode);
    if (index < 0) throw new Error(`local sku not found: ${skuCode}`);
    const previous = data.skus[index];
    data.skus[index] = {
      ...data.skus[index],
      isActive,
      updatedAt: new Date().toISOString(),
    };
    this.recordSkuChangeLog(data, previous, data.skus[index], {
      action: "status_change",
      source: context.source || "status_change",
      operator: context.operator,
      reason: context.reason || (isActive ? "恢复商品" : "下架商品"),
    });
    this.write(data);
    return data.skus[index];
  }

  batchUpdateSkus(skuCodes: string[], patch: Record<string, unknown>, context: Record<string, unknown> = {}) {
    const data = this.read();
    const updated = [];
    const skipped = [];
    const now = new Date().toISOString();
    for (const skuCode of skuCodes) {
      const index = data.skus.findIndex((sku) => sku.skuCode === skuCode);
      if (index < 0) {
        skipped.push({ skuCode, reason: "not_found" });
        continue;
      }
      const current = data.skus[index];
      const next = {
        ...current,
        ...patch,
        profitRate:
          patch.salePrice !== undefined || patch.costPrice !== undefined
            ? Number((patch.salePrice ?? current.salePrice) || 0) > 0
              ? (Number((patch.salePrice ?? current.salePrice) || 0) - Number((patch.costPrice ?? current.costPrice) || 0)) /
                Number((patch.salePrice ?? current.salePrice) || 0)
              : 0
            : current.profitRate,
        updatedAt: now,
      };
      data.skus[index] = next;
      this.recordSkuChangeLog(data, current, next, {
        action: "batch_update",
        source: context.source || "batch_update",
        operator: context.operator,
        reason: context.reason,
      });
      updated.push(next);
    }
    this.write(data);
    return { count: updated.length, updated, skipped };
  }

  listDesignAssets(filter: { ownerType?: string; ownerId?: string } = {}) {
    return this.read()
      .designAssets
      .filter((asset) => !filter.ownerType || asset.ownerType === filter.ownerType)
      .filter((asset) => !filter.ownerId || asset.ownerId === filter.ownerId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  getDesignAsset(assetId: string) {
    return this.read().designAssets.find((asset) => asset.id === assetId) || null;
  }

  createDesignAsset(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const record: any = {
      id: id("asset"),
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      role: payload.role || "reference",
      fileName: payload.fileName,
      mimeType: payload.mimeType || "application/octet-stream",
      localPath: payload.localPath,
      sizeBytes: payload.sizeBytes || 0,
      source: payload.source || "manual_upload",
      createdAt: now,
    };
    data.designAssets.push(record);
    this.write(data);
    return record;
  }

  attachDesignAssetsToJob(designJobId: string, assetIds: string[]) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === designJobId || item.requestId === designJobId);
    if (index < 0) throw new Error(`local design job not found: ${designJobId}`);
    const requestedAssetIds = [...new Set((assetIds || []).filter(Boolean).map(String))];
    const requestedAssets = data.designAssets.filter((asset) => requestedAssetIds.includes(asset.id));
    const binding = validateDesignAssetBinding({
      designJob: data.designJobs[index],
      assets: requestedAssets,
      requestedAssetIds,
    });
    if (!binding.ok) throw new Error(`design asset binding invalid: ${binding.reason}`);
    const existing = Array.isArray(data.designJobs[index].assetIds) ? data.designJobs[index].assetIds : [];
    data.designJobs[index] = {
      ...data.designJobs[index],
      assetIds: [...new Set([...existing, ...requestedAssetIds])],
      updatedAt: new Date().toISOString(),
    };
    this.write(data);
    return this.hydrateDesignJob(data, data.designJobs[index]);
  }

  listAgents() {
    const data = this.read();
    return data.agents
      .map((agent) => this.hydrateAgent(data, agent))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }

  listAgentSkills(agentId?: string) {
    const data = this.read();
    return data.agentSkills
      .filter((skill) => !agentId || skill.agentId === agentId)
      .filter((skill) => !localStoreIsSceneClarificationDerivedBusinessSkill(data, skill))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
  }

  applyAgentSkillSuggestions(suggestions: any[]) {
    const data = this.read();
    const now = new Date().toISOString();
    const result = {
      suggested: Array.isArray(suggestions) ? suggestions.length : 0,
      created: [] as any[],
      updated: [] as any[],
      skipped: [] as any[],
    };

    for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
      if (!suggestion?.agentId || !suggestion?.name) {
        result.skipped.push({ ...suggestion, reason: "missing_agent_or_name" });
        continue;
      }
      const existingIndex = data.agentSkills.findIndex(
        (skill) =>
          skill.agentId === suggestion.agentId &&
          canonicalSkillName(skill.name) === canonicalSkillName(suggestion.name),
      );
      const nextPatch = {
        name: suggestion.name,
        description: suggestion.description || "",
        enabled: true,
        sampleCount: Number(suggestion.sampleCount || 0),
        confidence: Number(suggestion.confidence || 0),
        sourceType: "training_compiler",
        sourceSampleIds: suggestion.sampleIds || [],
        lastCompiledAt: now,
        updatedAt: now,
      };

      if (existingIndex >= 0) {
        const current = data.agentSkills[existingIndex];
        const changed =
          current.name !== nextPatch.name ||
          current.description !== nextPatch.description ||
          Number(current.sampleCount || 0) !== nextPatch.sampleCount ||
          Number(current.confidence || 0) !== nextPatch.confidence;
        if (!changed) {
          result.skipped.push({ ...current, reason: "unchanged" });
          continue;
        }
        data.agentSkills[existingIndex] = {
          ...current,
          ...nextPatch,
          version: Number(current.version || 1) + 1,
        };
        result.updated.push(data.agentSkills[existingIndex]);
      } else {
        const record = {
          id: id("skill"),
          agentId: suggestion.agentId,
          version: 1,
          createdAt: now,
          ...nextPatch,
        };
        data.agentSkills.push(record);
        result.created.push(record);
      }
    }

    this.write(data);
    return result;
  }

  getAgentByKey(agentKey: string) {
    const data = this.read();
    return data.agents.find((agent) => agent.key === agentKey) || data.agents.find((agent) => agent.key === "general") || null;
  }

  listWechatAccounts() {
    return this.read().wechatAccounts.sort((a, b) =>
      String(a.displayName || "").localeCompare(String(b.displayName || ""), "zh-Hans-CN"),
    );
  }

  listConversations(wechatAccountId?: string) {
    const data = this.read();
    return data.conversations
      .filter((conversation) => !wechatAccountId || conversation.wechatAccountId === wechatAccountId)
      .map((conversation) => this.hydrateConversation(data, conversation))
      .sort((a, b) => String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt)));
  }

  updateConversation(id: string, patch: any, options: { skipIdentityValidation?: boolean } = {}) {
    const data = this.read();
    const index = data.conversations.findIndex((conversation) => conversation.id === id);
    if (index < 0) throw new Error(`local conversation not found: ${id}`);
    const current = data.conversations[index];
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (
      this.hasChangedField(current, patch, ["customerId", "wechatAccountId", "externalChatId"]) &&
      !options.skipIdentityValidation
    ) {
      next.identityBinding = this.validateConversationIdentity(data, next, id);
    }
    data.conversations[index] = next;
    this.write(data);
    return this.hydrateConversation(data, data.conversations[index]);
  }

  private validateConversationIdentity(data: StoreData, conversation: any, currentId?: string) {
    const customer = data.customers.find((item) => item.id === conversation.customerId) || null;
    const wechatAccount = conversation.wechatAccountId
      ? data.wechatAccounts.find((item) => item.id === conversation.wechatAccountId) || null
      : null;
    const duplicateExternalChat = conversation.externalChatId
      ? data.conversations.find(
          (item) =>
            item.id !== currentId &&
            item.wechatAccountId === conversation.wechatAccountId &&
            item.externalChatId === conversation.externalChatId,
        ) || null
      : null;
    const checks = [
      {
        key: "customerExists",
        label: "conversation customer exists",
        expected: conversation.customerId || "",
        actual: customer?.id || "",
        passed: Boolean(conversation.customerId && customer?.id === conversation.customerId),
      },
      {
        key: "wechatAccountExists",
        label: "conversation wechat account exists",
        expected: conversation.wechatAccountId || "",
        actual: wechatAccount?.id || "",
        passed: !conversation.wechatAccountId || Boolean(wechatAccount?.id === conversation.wechatAccountId),
      },
      {
        key: "externalChatUniqueInAccount",
        label: "conversation external chat id is unique in account",
        expected: conversation.externalChatId || "",
        actual: duplicateExternalChat?.id || "",
        passed: !duplicateExternalChat,
      },
    ];
    const failed = checks.filter((item) => !item.passed);
    if (failed.length) {
      throw new Error(`conversation binding invalid: ${failed.map((item) => item.label).join("、")}`);
    }
    return {
      ok: true,
      status: "passed",
      checks,
      failedKeys: [],
      reason: "conversation identity is valid",
      customerId: customer?.id || null,
      wechatAccountId: wechatAccount?.id || null,
      externalChatId: conversation.externalChatId || null,
    };
  }

  createMessage(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const conversationIndex = data.conversations.findIndex((conversation) => conversation.id === payload.conversationId);
    if (conversationIndex < 0) throw new Error(`local conversation not found: ${payload.conversationId}`);
    const conversation = data.conversations[conversationIndex];
    const requestedWechatAccountId = payload.wechatAccountId || payload.metadata?.wechatAccountId;
    const requestedCustomerId = payload.customerId || payload.metadata?.customerId;
    const binding = validateInboundConversationBinding({
      requestedWechatAccountId,
      requestedConversationId: payload.conversationId,
      conversation,
    });
    if (!binding.ok) throw new Error(`message conversation binding invalid: ${binding.reason}`);
    if (requestedCustomerId && requestedCustomerId !== conversation.customerId) {
      throw new Error("message customer binding invalid: requested customer does not match conversation");
    }
    const record: any = {
      id: id("msg"),
      conversationId: payload.conversationId,
      customerId: conversation.customerId || null,
      wechatAccountId: conversation.wechatAccountId || null,
      direction: payload.direction || "inbound",
      text: payload.text || "",
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      externalId: payload.externalId || null,
      metadata: payload.metadata || {},
      identityBinding: {
        status: "passed",
        conversationId: conversation.id,
        customerId: conversation.customerId || null,
        wechatAccountId: conversation.wechatAccountId || null,
      },
      createdAt: payload.createdAt || now,
    };
    data.messages.push(record);
    data.conversations[conversationIndex] = {
      ...data.conversations[conversationIndex],
      lastMessageAt: record.createdAt,
      updatedAt: now,
    };
    this.write(data);
    return {
      ...record,
      conversation: this.hydrateConversation(data, data.conversations[conversationIndex]),
    };
  }

  private validateOptionalConversationBinding(data: StoreData, payload: any, label: string) {
    const requestedConversationId = payload.conversationId || null;
    const requestedWechatAccountId = payload.wechatAccountId || null;
    const requestedCustomerId = payload.customerId || null;
    if (!requestedConversationId && !requestedWechatAccountId && !requestedCustomerId) {
      return {
        customerId: null,
        conversationId: null,
        wechatAccountId: null,
        binding: null,
      };
    }
    const conversation = requestedConversationId
      ? data.conversations.find((item) => item.id === requestedConversationId) || null
      : null;
    const binding = validateInboundConversationBinding({
      requestedWechatAccountId,
      requestedConversationId,
      conversation,
    });
    if (!binding.ok) throw new Error(`${label} conversation binding invalid: ${binding.reason}`);
    if (requestedCustomerId && requestedCustomerId !== conversation?.customerId) {
      throw new Error(`${label} customer binding invalid: requested customer does not match conversation`);
    }
    return {
      customerId: conversation?.customerId || null,
      conversationId: conversation?.id || null,
      wechatAccountId: conversation?.wechatAccountId || null,
      binding: {
        ...binding,
        customerId: conversation?.customerId || null,
        conversationId: conversation?.id || null,
        wechatAccountId: conversation?.wechatAccountId || null,
      },
    };
  }

  listWechatWindowSnapshots(filter: (IdentityListFilter & { limit?: number }) | number = {}) {
    const data = this.read();
    const options = typeof filter === "number" ? { limit: filter } : filter;
    return data.wechatWindowSnapshots
      .map((snapshot) => this.hydrateWechatWindowSnapshot(data, snapshot))
      .filter((snapshot) => this.matchesIdentityFilter(snapshot, options))
      .sort((a, b) => String(b.capturedAt || b.createdAt).localeCompare(String(a.capturedAt || a.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(options.limit || 50), 200)));
  }

  createWechatWindowSnapshot(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const account = payload.wechatAccountId
      ? data.wechatAccounts.find((item) => item.id === payload.wechatAccountId) || null
      : null;
    const record: any = {
      id: id("window"),
      source: payload.source || "manual",
      isOnline: payload.isOnline !== false,
      wechatAccountId: payload.wechatAccountId || null,
      accountDisplayName: payload.accountDisplayName || "",
      windowHandle: payload.windowHandle || "",
      processId: payload.processId || null,
      chatTitle: payload.chatTitle || payload.activeChatTitle || "",
      activeChatTitle: payload.activeChatTitle || payload.chatTitle || "",
      externalChatId: payload.externalChatId || "",
      recentCustomerId: payload.recentCustomerId || "",
      recentMessageText: payload.recentMessageText || "",
      confidence: payload.confidence ?? 1,
      raw: payload.raw || null,
      capturedAt: payload.capturedAt || now,
      createdAt: now,
    };
    record.diagnostic =
      payload.diagnostic ||
      diagnoseWechatWindowSnapshot({
        snapshot: record,
        account,
        conversations: data.conversations,
      });
    data.wechatWindowSnapshots.push(record);
    this.write(data);
    return this.hydrateWechatWindowSnapshot(data, record);
  }

  getLatestWechatWindowSnapshot(wechatAccountId?: string) {
    const data = this.read();
    const snapshot = data.wechatWindowSnapshots
      .filter((item) => !wechatAccountId || item.wechatAccountId === wechatAccountId)
      .sort((a, b) => String(b.capturedAt || b.createdAt).localeCompare(String(a.capturedAt || a.createdAt)))[0];
    return snapshot ? this.hydrateWechatWindowSnapshot(data, snapshot) : null;
  }

  listDesignJobs(filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.designJobs
      .map((job) => this.hydrateDesignJob(data, job))
      .filter((job) => this.matchesIdentityFilter(job, filter))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getDesignJob(idOrRequestId: string) {
    const data = this.read();
    const job = data.designJobs.find((item) => item.id === idOrRequestId || item.requestId === idOrRequestId);
    return job ? this.hydrateDesignJob(data, job) : null;
  }

  createDesignJob(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const identity = this.validateDesignJobIdentity(data, payload);
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || identity.customerId,
      wechatAccountId: payload.wechatAccountId || identity.wechatAccountId,
    };
    const job = {
      id: id("design"),
      requestId: normalizedPayload.requestId || randomUUID(),
      status: normalizedPayload.status || "draft",
      designType: normalizedPayload.designType || "bundle_render",
      renderStyle: payload.renderStyle || "真实产品摆拍",
      outputCount: normalizedPayload.outputCount || 6,
      budget: normalizedPayload.budget || {},
      bundle: normalizedPayload.bundle || {},
      requirements: normalizedPayload.requirements || {},
      assetIds: normalizeAssetIds(normalizedPayload.assetIds || normalizedPayload.assets),
      customerText: normalizedPayload.customerText || "",
      scene: normalizedPayload.scene || "",
      isHighValue: Boolean(normalizedPayload.isHighValue),
      manualQcRequired: normalizedPayload.manualQcRequired !== false,
      retryCount: 0,
      revisionCount: 0,
      revisionPolicy: null,
      errorMessage: "",
      submittedAt: null,
      completedAt: null,
      customerId: normalizedPayload.customerId,
      conversationId: normalizedPayload.conversationId,
      wechatAccountId: normalizedPayload.wechatAccountId || null,
      orderId: normalizedPayload.orderId || null,
      identityBinding: identity,
      createdAt: now,
      updatedAt: now,
    };
    data.designJobs.push(job);
    this.write(data);
    return this.hydrateDesignJob(data, job);
  }

  updateDesignJob(id: string, patch: any, options: { skipIdentityValidation?: boolean } = {}) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === id || item.requestId === id);
    if (index < 0) throw new Error(`local design job not found: ${id}`);
    const current = data.designJobs[index];
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    if (this.hasChangedField(current, patch, ["conversationId", "customerId", "wechatAccountId"]) && !options.skipIdentityValidation) {
      const identity = this.validateDesignJobIdentity(data, next);
      next.customerId = next.customerId || identity.customerId;
      next.wechatAccountId = next.wechatAccountId || identity.wechatAccountId;
      next.identityBinding = {
        ...identity,
        revalidatedAt: next.updatedAt,
      };
    }
    data.designJobs[index] = next;
    this.write(data);
    return this.hydrateDesignJob(data, data.designJobs[index]);
  }

  private validateDesignJobIdentity(data: StoreData, payload: any) {
    const conversation = data.conversations.find((item) => item.id === payload.conversationId) || null;
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || conversation?.customerId,
      wechatAccountId: payload.wechatAccountId || conversation?.wechatAccountId,
    };
    const result = validateDesignJobIdentity({
      payload: normalizedPayload,
      conversation,
    });
    if (!result.ok) {
      throw new Error(`design job identity invalid: ${result.reason}`);
    }
    return {
      ...result,
      customerId: normalizedPayload.customerId,
      wechatAccountId: normalizedPayload.wechatAccountId,
    };
  }

  private validateDesignRevisionBinding(data: StoreData, revision: any) {
    const designJob = data.designJobs.find((item) => item.id === revision.designJobId) || null;
    const selectedImage = revision.selectedImageId
      ? data.designImages.find(
          (item) =>
            item.designJobId === revision.designJobId &&
            (item.id === revision.selectedImageId || item.imageId === revision.selectedImageId),
        ) || null
      : null;
    const checks = [
      {
        key: "designJobExists",
        label: "设计修改任务存在",
        expected: revision.designJobId || "",
        actual: designJob?.id || "",
        passed: Boolean(designJob?.id && designJob.id === revision.designJobId),
      },
      {
        key: "selectedImageBelongsToDesignJob",
        label: "修改引用图片属于设计任务",
        expected: revision.designJobId || "",
        actual: selectedImage?.designJobId || "",
        passed: !revision.selectedImageId || Boolean(selectedImage?.designJobId === revision.designJobId),
      },
    ];
    const failed = checks.filter((item) => !item.passed);
    if (failed.length) {
      throw new Error(`design revision binding invalid: ${failed.map((item) => item.label).join("、")}`);
    }
    return {
      ok: true,
      status: "passed",
      checks,
      failedKeys: [],
      reason: "设计修改绑定关系正确",
      designJobId: revision.designJobId,
      selectedImageId: revision.selectedImageId || null,
    };
  }

  upsertDesignImages(designJobId: string, images: any[]) {
    const data = this.read();
    const job = data.designJobs.find((item) => item.id === designJobId);
    if (!job) throw new Error(`local design job not found: ${designJobId}`);
    for (const image of images) {
      const index = data.designImages.findIndex(
        (item) => item.designJobId === designJobId && item.imageId === image.imageId,
      );
      const record = {
        id: index >= 0 ? data.designImages[index].id : id("image"),
        selected: false,
        createdAt: index >= 0 ? data.designImages[index].createdAt : new Date().toISOString(),
        ...image,
        designJobId,
      };
      if (index >= 0) data.designImages[index] = record;
      else data.designImages.push(record);
    }
    this.write(data);
    return data.designImages.filter((item) => item.designJobId === designJobId);
  }

  selectDesignImage(designJobId: string, imageId: string, feedback: string) {
    const data = this.read();
    const job = data.designJobs.find((item) => item.id === designJobId);
    if (!job) throw new Error(`local design job not found: ${designJobId}`);
    const selected = data.designImages.find(
      (image) => image.designJobId === designJobId && (image.id === imageId || image.imageId === imageId),
    );
    if (!selected) throw new Error(`design image not found in design job: ${imageId}`);
    for (const image of data.designImages) {
      if (image.designJobId === designJobId) {
        image.selected = image.id === imageId || image.imageId === imageId;
        if (image.selected) image.customerFeedback = feedback;
      }
    }
    this.write(data);
  }

  listDesignRevisions(designJobId?: string) {
    return this.read()
      .designRevisions
      .filter((revision) => !designJobId || revision.designJobId === designJobId)
      .sort((a, b) => Number(a.revisionNumber || 0) - Number(b.revisionNumber || 0));
  }

  createDesignRevision(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const record: any = {
      id: id("revision"),
      designJobId: payload.designJobId,
      selectedImageId: payload.selectedImageId || null,
      revisionNumber: payload.revisionNumber || 1,
      instruction: payload.instruction || "",
      sourceText: payload.sourceText || "",
      policyAction: payload.policyAction || "manual_review",
      status: payload.status || "requested",
      chargeRequired: Boolean(payload.chargeRequired),
      manualReviewRequired: Boolean(payload.manualReviewRequired),
      externalJobId: payload.externalJobId || null,
      resultImageIds: payload.resultImageIds || [],
      createdAt: now,
      updatedAt: now,
    };
    record.identityBinding = this.validateDesignRevisionBinding(data, record);
    data.designRevisions.push(record);
    this.write(data);
    return record;
  }

  updateDesignRevision(idOrExternalJobId: string, patch: any, options: { skipIdentityValidation?: boolean } = {}) {
    const data = this.read();
    const index = data.designRevisions.findIndex(
      (item) => item.id === idOrExternalJobId || item.externalJobId === idOrExternalJobId,
    );
    if (index < 0) throw new Error(`local design revision not found: ${idOrExternalJobId}`);
    const current = data.designRevisions[index];
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (this.hasChangedField(current, patch, ["designJobId", "selectedImageId"]) && !options.skipIdentityValidation) {
      next.identityBinding = this.validateDesignRevisionBinding(data, next);
    }
    data.designRevisions[index] = next;
    this.write(data);
    return data.designRevisions[index];
  }

  getLatestActiveDesignRevision(designJobId: string) {
    return this.read()
      .designRevisions
      .filter((revision) => revision.designJobId === designJobId)
      .filter((revision) => ["submitted", "generating"].includes(revision.status))
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
  }

  createNotification(level: string, title: string, body?: string, target?: any) {
    const data = this.read();
    const identity = this.resolveTargetIdentity(data, target || {}, "notification target");
    const record = {
      id: id("notice"),
      level,
      title,
      body,
      target: {
        ...(target || {}),
        ...identity.identityFields,
        identityBinding: identity.binding,
      },
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    data.notifications.push(record);
    this.write(data);
    return record;
  }

  listNotifications(options: { unreadOnly?: boolean; limit?: number } & IdentityListFilter = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 300));
    return this.read()
      .notifications
      .filter((notice) => !options.unreadOnly || !notice.readAt)
      .filter((notice) => this.matchesIdentityFilter(notice, options))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  markNotificationRead(id: string, filter: IdentityListFilter = {}) {
    const data = this.read();
    const index = data.notifications.findIndex((notice) => notice.id === id);
    if (index < 0) throw new Error(`local notification not found: ${id}`);
    if (!this.matchesIdentityFilter(data.notifications[index], filter)) {
      throw new Error(`notification identity mismatch: ${id}`);
    }
    data.notifications[index] = { ...data.notifications[index], readAt: new Date().toISOString() };
    this.write(data);
    return data.notifications[index];
  }

  markAllNotificationsRead(filter: IdentityListFilter = {}) {
    const data = this.read();
    const now = new Date().toISOString();
    let count = 0;
    for (const notice of data.notifications) {
      if (!notice.readAt && this.matchesIdentityFilter(notice, filter)) {
        notice.readAt = now;
        count += 1;
      }
    }
    this.write(data);
    return { count };
  }

  listChatImports() {
    return this.read().chatImports.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  listTrainingSamples(agentId?: string) {
    const data = this.read();
    return data.trainingSamples
      .filter((sample) => !agentId || sample.agentId === agentId)
      .map((sample) => this.decorateTrainingSample(sample))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  reviewTrainingSample(sampleId: string, payload: any = {}) {
    const data = this.read();
    const index = data.trainingSamples.findIndex((sample) => sample.id === sampleId);
    if (index < 0) throw new Error(`local training sample not found: ${sampleId}`);

    const status = normalizeTrainingSampleStatus(payload.status);
    const now = new Date().toISOString();
    const reviewer = payload.reviewer || "人工客服";
    const note = payload.note || trainingSampleReviewNote(status);
    const before = data.trainingSamples[index];
    const agent = resolveTrainingSampleAgent(data, payload, before);
    const patch = buildTrainingSampleReviewPatch(payload, before, agent);
    const changedFields = buildTrainingSampleChangedFields(before, {
      ...before,
      ...patch,
      status,
    });
    const sample = {
      ...before,
      ...patch,
      status,
      reviewer,
      reviewNote: note,
      reviewedAt: now,
      reviewHistory: [
        ...(Array.isArray(before.reviewHistory) ? before.reviewHistory : []),
        {
          status,
          reviewer,
          note,
          reviewedAt: now,
        },
      ],
      updatedAt: now,
    };
    data.trainingSamples[index] = sample;
    for (const entry of data.knowledgeEntries.filter((item) => item.sourceId === sample.id)) {
      entry.agentId = sample.agentId;
      entry.title = `${sample.scene || "未分类"}：${String(sample.customerText || "").slice(0, 28)}`;
      entry.content = `客户：${sample.customerText}\n客服：${sample.idealReply}`;
      entry.tags = [sample.scene, sample.agentKey, ...(sample.skillHints || [])].filter(Boolean);
      entry.qualityScore = sample.score;
      entry.updatedAt = now;
    }

    const log = {
      id: id("review"),
      targetType: "training_sample",
      targetId: sample.id,
      decision: status === "ready" ? "approve_training_sample" : status === "rejected" ? "reject_training_sample" : "mark_training_sample_review",
      reviewer,
      note,
      beforeStatus: before.status || "ready",
      afterStatus: status,
      metadata: {
        source: "training_sample_review",
        agentKey: sample.agentKey,
        scene: sample.scene,
        sourceType: sample.sourceType || (sample.sourceRouteId ? "route_correction" : sample.importId ? "chat_import" : "manual"),
        changedFields,
      },
      createdAt: now,
    };
    data.reviewLogs.push(log);

    this.write(data);
    return { sample: this.decorateTrainingSample(sample), reviewLog: log };
  }

  listKnowledgeEntries(agentId?: string) {
    const data = this.read();
    return data.knowledgeEntries
      .filter((entry) => {
        const sample = entry.sourceId ? data.trainingSamples.find((item) => item.id === entry.sourceId) : null;
        return !sample || isTrainingSampleReady(sample);
      })
      .filter((entry) => !localStoreIsSceneClarificationKnowledgeEntry(data, entry))
      .filter((entry) => !agentId || entry.agentId === agentId)
      .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0));
  }

  listRouteEvaluations() {
    const data = this.read();
    return data.routeEvaluations
      .map((route) => ({
        ...route,
        agent: data.agents.find((agent) => agent.id === route.agentId) || null,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  createRouteEvaluation(payload: any, result: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const agent = data.agents.find((item) => item.key === result.agentKey) || data.agents.find((item) => item.key === "general");
    const identity = this.validateOptionalConversationBinding(
      data,
      {
        conversationId: payload.conversationId,
        wechatAccountId: payload.wechatAccountId,
        customerId: payload.conversationId ? payload.customerId : null,
      },
      "route evaluation",
    );
    const record = {
      id: id("route"),
      channel: payload.channel || "wechat",
      text: payload.text || "",
      customerId: identity.customerId || payload.customerId || null,
      conversationId: identity.conversationId || payload.conversationId || null,
      wechatAccountId: identity.wechatAccountId || payload.wechatAccountId || null,
      identityBinding: identity.binding,
      agentId: agent?.id || null,
      agentKey: result.agentKey,
      scene: result.scene,
      sceneScore: result.sceneScore || 0,
      sceneScores: result.sceneScores || [],
      matchedKeywords: result.matchedKeywords || [],
      sceneDecision: result.sceneDecision || null,
      sceneClarification: result.sceneClarification || null,
      clarificationResolution: result.clarificationResolution || null,
      sceneMemory: result.sceneMemory || null,
      sceneAudit: result.sceneAudit || null,
      action: result.action,
      confidence: result.confidence,
      isHighValue: result.isHighValue,
      budget: result.budget,
      missingFields: result.missingFields,
      riskFlags: result.riskFlags,
      suggestedReply: result.suggestedReply,
      appliedSkills: result.appliedSkills || [],
      knowledgeMatches: result.knowledgeMatches || [],
      replyDraft: result.replyDraft || null,
      createdAt: now,
      updatedAt: now,
    };
    data.routeEvaluations.push(record);
    this.write(data);
    return { ...record, agent: agent || null };
  }

  correctRouteEvaluation(routeEvaluationId: string, payload: any = {}) {
    const data = this.read();
    const index = data.routeEvaluations.findIndex((route) => route.id === routeEvaluationId);
    if (index < 0) throw new Error(`local route evaluation not found: ${routeEvaluationId}`);
    const before = data.routeEvaluations[index];
    const agent = data.agents.find((item) => item.key === payload.agentKey);
    if (!agent) throw new Error(`agent not found: ${payload.agentKey}`);

    const now = new Date().toISOString();
    const scene = payload.scene || agent.scene || before.scene || "未分类";
    const reviewer = payload.reviewer || "人工客服";
    const note = payload.note || "人工纠正场景归属，用于后续训练。";
    const nextMissingFields = (before.missingFields || []).filter((field: string) => field !== "scene_clarification");
    const nextAction = before.action === "collect_info" && nextMissingFields.length === 0 ? "auto_agent" : before.action;
    const corrected = {
      ...before,
      agentId: agent.id,
      agentKey: agent.key,
      scene,
      sceneScore: Math.max(Number(before.sceneScore || 0), 100),
      sceneDecision: {
        status: "clear",
        reason: "human_corrected_scene",
        topScene: {
          scene,
          agentKey: agent.key,
          score: 100,
          matchedKeywords: ["human_correction"],
        },
        secondaryScene: null,
        scoreGap: 100,
      },
      sceneClarification: null,
      clarificationResolution: {
        type: "human_scene_correction",
        text: before.text,
        agentKey: agent.key,
        scene,
        label: scene,
        matchedKeywords: ["human_correction"],
        confidence: "human_reviewed",
      },
      sceneMemory: null,
      sceneAudit: {
        level: "pass",
        label: "人工已纠正",
        summary: `已由人工纠正为「${scene}」。`,
        nextStep: "后续同类消息会作为场景记忆参考。",
        evidence: ["human_correction"],
        warnings: [],
      },
      action: nextAction,
      confidence: 100,
      missingFields: nextMissingFields,
      correction: {
        corrected: true,
        reviewer,
        note,
        correctedAt: now,
        before: {
          agentKey: before.agentKey,
          scene: before.scene,
          sceneDecision: before.sceneDecision || null,
          action: before.action,
          confidence: before.confidence,
        },
      },
      updatedAt: now,
    };
    data.routeEvaluations[index] = corrected;

    const sample = {
      id: id("sample"),
      importId: null,
      agentId: agent.id,
      agentKey: agent.key,
      customerId: before.customerId || null,
      conversationId: before.conversationId || null,
      wechatAccountId: before.wechatAccountId || null,
      identityBinding: before.identityBinding || null,
      scene,
      customerText: before.text,
      idealReply: payload.idealReply || before.suggestedReply || `已人工确认该问题应由「${agent.name || agent.key}」处理。`,
      score: 95,
      status: "ready",
      skillHints: inferSkillHints({
        question: before.text,
        answer: payload.idealReply || before.suggestedReply || "",
      }),
      sourceType: "route_correction",
      sourceRouteId: before.id,
      createdAt: now,
      updatedAt: now,
    };
    data.trainingSamples.push(sample);

    const knowledge = {
      id: id("knowledge"),
      agentId: sample.agentId,
      sourceType: "route_correction",
      sourceId: sample.id,
      customerId: before.customerId || null,
      conversationId: before.conversationId || null,
      wechatAccountId: before.wechatAccountId || null,
      identityBinding: before.identityBinding || null,
      title: `场景纠正：${scene}：${String(sample.customerText || "").slice(0, 28)}`,
      content: `客户：${sample.customerText}\n正确场景：${scene}\n正确 Agent：${agent.name || agent.key}\n备注：${note}`,
      tags: [scene, agent.key, "场景纠正", ...sample.skillHints],
      qualityScore: sample.score,
      createdAt: now,
      updatedAt: now,
    };
    data.knowledgeEntries.push(knowledge);

    const log = {
      id: id("review"),
      targetType: "route_evaluation",
      targetId: before.id,
      decision: "correct_scene",
      reviewer,
      note,
      beforeStatus: before.agentKey,
      afterStatus: agent.key,
      metadata: {
        source: "routing_correction",
        beforeScene: before.scene,
        afterScene: scene,
        trainingSampleId: sample.id,
        knowledgeEntryId: knowledge.id,
      },
      createdAt: now,
    };
    data.reviewLogs.push(log);

    this.write(data);
    return {
      route: { ...corrected, agent },
      trainingSample: sample,
      knowledgeEntry: knowledge,
      reviewLog: log,
    };
  }

  createChatImport(payload: any, parsed: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const identity = this.validateOptionalConversationBinding(data, payload, "chat import");
    const record: any = {
      id: id("import"),
      name: payload.name || `聊天记录导入 ${new Date().toLocaleString("zh-CN")}`,
      source: payload.source || "manual_text",
      channel: payload.channel || "wechat",
      agentId: payload.agentId || null,
      customerId: identity.customerId,
      conversationId: identity.conversationId,
      wechatAccountId: identity.wechatAccountId,
      identityBinding: identity.binding,
      rawText: payload.text || "",
      messageCount: parsed.messageCount || 0,
      pairCount: parsed.pairCount || 0,
      warnings: parsed.warnings || [],
      createdAt: now,
      updatedAt: now,
    };
    data.chatImports.push(record);

    for (const pair of parsed.pairs || []) {
      const agent = payload.agentId
        ? data.agents.find((item) => item.id === payload.agentId)
        : data.agents.find((item) => item.key === pair.agentKey) || data.agents.find((item) => item.key === "general");
      const sample = {
        id: id("sample"),
        importId: record.id,
        agentId: agent?.id || null,
        agentKey: agent?.key || pair.agentKey || "general",
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        wechatAccountId: identity.wechatAccountId,
        identityBinding: identity.binding,
        scene: pair.scene || "未分类",
        sceneScore: Number(pair.sceneScore || 0),
        sceneScores: Array.isArray(pair.sceneScores) ? pair.sceneScores : [],
        matchedKeywords: Array.isArray(pair.matchedKeywords) ? pair.matchedKeywords : [],
        sceneCheck: pair.sceneCheck || null,
        customerText: pair.question,
        idealReply: pair.answer,
        score: pair.score,
        status: pair.score >= 70 ? "ready" : "review",
        skillHints: inferSkillHints(pair),
        sourceType: "chat_import",
        sourceLineStart: pair.sourceLineStart,
        sourceLineEnd: pair.sourceLineEnd,
        createdAt: now,
        updatedAt: now,
      };
      data.trainingSamples.push(sample);
      data.knowledgeEntries.push({
        id: id("knowledge"),
        agentId: sample.agentId,
        sourceType: "chat_import",
        sourceId: sample.id,
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        wechatAccountId: identity.wechatAccountId,
        identityBinding: identity.binding,
        title: `${sample.scene}：${sample.customerText.slice(0, 28)}`,
        content: `客户：${sample.customerText}\n客服：${sample.idealReply}`,
        tags: [sample.scene, sample.agentKey, ...sample.skillHints],
        qualityScore: sample.score,
        createdAt: now,
        updatedAt: now,
      });
    }

    this.write(data);
    return {
      ...record,
      samples: data.trainingSamples.filter((sample) => sample.importId === record.id),
    };
  }

  createSendTask(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const binding = this.validateSendTaskBinding(data, payload);
    const normalizedPayload = {
      ...payload,
      designJobId: payload.designJobId || binding.designJobId,
    };
    const record = {
      id: id("send"),
      status: "queued",
      queuedAt: now,
      createdAt: now,
      updatedAt: now,
      ...normalizedPayload,
      guardSnapshot: {
        status: "pending",
        checks: [],
        binding,
        ...(normalizedPayload.guardSnapshot || {}),
      },
    };
    data.sendTasks.push(record);
    this.write(data);
    return this.hydrateSendTask(data, record);
  }

  listSendTasks(filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.sendTasks
      .map((task) => this.hydrateSendTask(data, task))
      .filter((task) => this.matchesIdentityFilter(task, filter))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  listSendAttempts(filter: { sendTaskId?: string; limit?: number } & IdentityListFilter = {}) {
    const data = this.read();
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 300));
    return data.sendAttempts
      .filter((attempt) => !filter.sendTaskId || attempt.sendTaskId === filter.sendTaskId)
      .map((attempt) => this.hydrateSendAttempt(data, attempt))
      .filter((attempt) => this.matchesIdentityFilter(attempt, filter))
      .sort((a, b) => String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt)))
      .slice(0, limit);
  }

  getSendTask(id: string) {
    const data = this.read();
    const task = data.sendTasks.find((item) => item.id === id);
    return task ? this.hydrateSendTask(data, task) : null;
  }

  updateSendTask(id: string, patch: any, options: { skipBindingValidation?: boolean } = {}) {
    const data = this.read();
    const index = data.sendTasks.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`local send task not found: ${id}`);
    const current = data.sendTasks[index];
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const bindingFields = ["wechatAccountId", "conversationId", "designJobId", "quoteDraftId", "payload"];
    const bindingChanged = bindingFields.some((field) =>
      Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== current[field],
    );
    if (bindingChanged && !options.skipBindingValidation) {
      const binding = this.validateSendTaskBinding(data, next);
      next.designJobId = next.designJobId || binding.designJobId;
      next.guardSnapshot = {
        ...(next.guardSnapshot && typeof next.guardSnapshot === "object" ? next.guardSnapshot : {}),
        binding,
        bindingRevalidatedAt: next.updatedAt,
      };
    }
    data.sendTasks[index] = next;
    this.write(data);
    return this.hydrateSendTask(data, data.sendTasks[index]);
  }

  private recordSkuChangeLog(
    data: StoreData,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    context: { action?: unknown; source?: unknown; operator?: unknown; reason?: unknown } = {},
  ) {
    const changedFields = buildSkuChangedFields(before, after);
    if (before && !changedFields.length) return;
    const now = new Date().toISOString();
    data.skuChangeLogs.push({
      id: id("sku_log"),
      skuId: after.id || before?.id || null,
      skuCode: after.skuCode || before?.skuCode || "",
      name: after.name || before?.name || "",
      action: String(context.action || (before ? "update" : "create")),
      source: String(context.source || "manual"),
      operator: String(context.operator || "system"),
      reason: String(context.reason || ""),
      changedFields,
      before: before ? pickSkuSnapshot(before) : null,
      after: pickSkuSnapshot(after),
      createdAt: now,
    });
    if (data.skuChangeLogs.length > 1000) {
      data.skuChangeLogs = data.skuChangeLogs
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 1000);
    }
  }

  private validateSendTaskBinding(data: StoreData, payload: any) {
    const conversation = data.conversations.find((item) => item.id === payload.conversationId) || null;
    const quoteDraft = payload.quoteDraftId
      ? data.quoteDrafts.find((item) => item.id === payload.quoteDraftId) || null
      : null;
    const designJobId = payload.designJobId || quoteDraft?.designJobId;
    const designJob = designJobId
      ? data.designJobs.find((item) => item.id === designJobId) || null
      : null;
    const result = validateSendTaskBinding({
      task: {
        ...payload,
        designJobId,
      },
      conversation,
      designJob,
      quoteDraft,
    });
    if (!result.ok) {
      throw new Error(`send task binding invalid: ${result.reason}`);
    }
    this.validateSendTaskImagePayload(data, { ...payload, designJobId });
    return {
      ...result,
      designJobId,
    };
  }

  private validateSendTaskImagePayload(data: StoreData, payload: any) {
    const imagePaths: string[] = Array.isArray(payload.payload?.imagePaths)
      ? payload.payload.imagePaths.filter(Boolean).map((item: any) => String(item))
      : [];
    if (!imagePaths.length) return;
    if (!payload.designJobId) throw new Error("send task image binding invalid: designJobId is required for image payload");
    const normalizedExpectedPaths = new Set(
      data.designImages
        .filter((image) => image.designJobId === payload.designJobId)
        .map((image) => normalizePathKey(image.localPath))
        .filter(Boolean),
    );
    const invalidPaths = imagePaths.filter((imagePath) => !normalizedExpectedPaths.has(normalizePathKey(imagePath)));
    if (invalidPaths.length) {
      throw new Error(`send task image binding invalid: image paths do not belong to design job`);
    }
  }

  private validateStoredOrderDraftBinding(data: StoreData, orderDraft: any) {
    const quoteDraft = data.quoteDrafts.find((item) => item.id === orderDraft.quoteDraftId) || null;
    const designJob = orderDraft.designJobId
      ? data.designJobs.find((item) => item.id === orderDraft.designJobId) || null
      : quoteDraft?.designJobId
        ? data.designJobs.find((item) => item.id === quoteDraft.designJobId) || null
        : null;
    const conversation = orderDraft.conversationId
      ? data.conversations.find((item) => item.id === orderDraft.conversationId) || null
      : designJob?.conversationId
        ? data.conversations.find((item) => item.id === designJob.conversationId) || null
        : null;
    const selectedImage = orderDraft.selectedImageId
      ? data.designImages.find((item) => item.id === orderDraft.selectedImageId || item.imageId === orderDraft.selectedImageId) || null
      : quoteDraft?.selectedImageId
        ? data.designImages.find((item) => item.id === quoteDraft.selectedImageId || item.imageId === quoteDraft.selectedImageId) || null
        : null;
    const result = validateOrderDraftQuoteBinding({
      orderDraft,
      quoteDraft,
      designJob,
      conversation,
      selectedImage,
    });
    if (!result.ok) {
      throw new Error(`order draft binding invalid: ${result.reason}`);
    }
    return result;
  }

  createSendAttempt(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const record = {
      id: id("attempt"),
      sendTaskId: payload.sendTaskId,
      adapter: payload.adapter || "dry_run",
      status: payload.status || "started",
      guardStatus: payload.guardStatus || "",
      windowSnapshotId: payload.windowSnapshotId || null,
      payloadSummary: payload.payloadSummary || {},
      errorMessage: payload.errorMessage || "",
      metadata: payload.metadata || {},
      startedAt: payload.startedAt || now,
      completedAt: payload.completedAt || null,
      createdAt: now,
    };
    this.validateSendAttemptBinding(data, record);
    data.sendAttempts.push(record);
    this.write(data);
    return this.hydrateSendAttempt(data, record);
  }

  updateSendAttempt(id: string, patch: any) {
    const data = this.read();
    const index = data.sendAttempts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`local send attempt not found: ${id}`);
    const next = {
      ...data.sendAttempts[index],
      ...patch,
      metadata: {
        ...(data.sendAttempts[index].metadata || {}),
        ...(patch.metadata || {}),
      },
    };
    this.validateSendAttemptBinding(data, next);
    data.sendAttempts[index] = next;
    this.write(data);
    return this.hydrateSendAttempt(data, data.sendAttempts[index]);
  }

  private validateSendAttemptBinding(data: StoreData, attempt: any) {
    const task = data.sendTasks.find((item) => item.id === attempt.sendTaskId) || null;
    if (!task) throw new Error(`send attempt binding invalid: send task not found`);
    const metadata = attempt.metadata && typeof attempt.metadata === "object" ? attempt.metadata : {};
    const identityValues = [
      ["wechatAccountId", attempt.wechatAccountId],
      ["conversationId", attempt.conversationId],
      ["designJobId", attempt.designJobId],
      ["quoteDraftId", attempt.quoteDraftId],
      ["metadata.sendTaskId", metadata.sendTaskId],
      ["metadata.taskId", metadata.taskId],
      ["metadata.wechatAccountId", metadata.wechatAccountId],
      ["metadata.conversationId", metadata.conversationId],
      ["metadata.designJobId", metadata.designJobId],
      ["metadata.quoteDraftId", metadata.quoteDraftId],
      ["metadata.target.wechatAccountId", metadata.target?.wechatAccountId],
      ["metadata.target.conversationId", metadata.target?.conversationId],
      ["metadata.sendPlan.target.wechatAccountId", metadata.sendPlan?.target?.wechatAccountId],
      ["metadata.sendPlan.target.conversationId", metadata.sendPlan?.target?.conversationId],
    ];
    const expectedByField: Record<string, unknown> = {
      sendTaskId: task.id,
      taskId: task.id,
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      designJobId: task.designJobId,
      quoteDraftId: task.quoteDraftId,
    };
    for (const [pathName, value] of identityValues) {
      if (value === undefined || value === null || value === "") continue;
      const field = String(pathName).split(".").pop() || "";
      if (String(value) !== String(expectedByField[field] || "")) {
        throw new Error(`send attempt binding invalid: ${pathName} does not match send task`);
      }
    }
    if (attempt.windowSnapshotId) {
      const snapshot = data.wechatWindowSnapshots.find((item) => item.id === attempt.windowSnapshotId) || null;
      if (!snapshot) throw new Error(`send attempt binding invalid: window snapshot not found`);
      if (snapshot.wechatAccountId && task.wechatAccountId && snapshot.wechatAccountId !== task.wechatAccountId) {
        throw new Error(`send attempt binding invalid: window snapshot account does not match send task`);
      }
    }
  }

  getLatestSendAttempt(sendTaskId: string, filter: { adapter?: string; status?: string } = {}) {
    const data = this.read();
    const attempt = data.sendAttempts
      .filter((item) => item.sendTaskId === sendTaskId)
      .filter((item) => !filter.adapter || item.adapter === filter.adapter)
      .filter((item) => !filter.status || item.status === filter.status)
      .sort((a, b) => String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt)))[0];
    return attempt ? this.hydrateSendAttempt(data, attempt) : null;
  }

  getRecentMessage(conversationId: string) {
    const data = this.read();
    const message = data.messages
      .filter((item) => item.conversationId === conversationId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!message) return null;
    const conversation = data.conversations.find((item) => item.id === message.conversationId);
    return { ...message, customerId: conversation?.customerId || null };
  }

  listAccountQueueTaskIds(wechatAccountId: string) {
    const data = this.read();
    return data.sendTasks
      .filter((task) => task.wechatAccountId === wechatAccountId && ["queued", "sending"].includes(task.status))
      .sort((a, b) => String(a.queuedAt || a.createdAt).localeCompare(String(b.queuedAt || b.createdAt)))
      .map((task) => task.id);
  }

  createQuoteFromDesignJob(designJobId: string, selectedImageId?: string) {
    const data = this.read();
    const job = data.designJobs.find((item) => item.id === designJobId);
    if (!job) throw new Error(`local design job not found: ${designJobId}`);
    const conversation = data.conversations.find((item) => item.id === job.conversationId) || null;
    const items = Array.isArray(job.bundle?.items) ? job.bundle.items : [];
    const totals = calculateTotals(items);
    const quantity = Number(job.budget?.quantity || 1);
    const selectedImage =
      data.designImages.find((image) => image.designJobId === designJobId && (image.id === selectedImageId || image.imageId === selectedImageId)) ||
      data.designImages.find((image) => image.designJobId === designJobId && image.selected) ||
      data.designImages.find((image) => image.designJobId === designJobId);
    const totalPrice = totals.salePrice * quantity;
    const totalCost = totals.cost * quantity;
    const quoteDraft = {
      designJobId,
      customerId: job.customerId,
      selectedImageId: selectedImage?.id || null,
    };
    const identity = this.validateQuoteDraftIdentity({
      quoteDraft,
      designJob: job,
      conversation,
      selectedImage,
    });
    const record = {
      id: id("quote"),
      ...quoteDraft,
      quantity,
      unitPrice: totals.salePrice,
      totalPrice,
      totalCost,
      profit: totalPrice - totalCost,
      status: job.isHighValue ? "manual_review" : "auto_sent",
      paymentStatus: "unpaid",
      sendTaskId: null,
      identityBinding: identity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.quoteDrafts.push(record);
    this.write(data);
    return this.hydrateQuoteDraft(data, record);
  }

  private validateQuoteDraftIdentity(input: any) {
    const result = validateQuoteDraftIdentity(input);
    if (!result.ok) {
      throw new Error(`quote draft identity invalid: ${result.reason}`);
    }
    return result;
  }

  private validateStoredQuoteDraftIdentity(data: StoreData, quoteDraft: any) {
    const designJob = data.designJobs.find((item) => item.id === quoteDraft.designJobId) || null;
    const conversation = designJob?.conversationId
      ? data.conversations.find((item) => item.id === designJob.conversationId) || null
      : null;
    const selectedImage = quoteDraft.selectedImageId
      ? data.designImages.find((item) => item.id === quoteDraft.selectedImageId || item.imageId === quoteDraft.selectedImageId) || null
      : null;
    return this.validateQuoteDraftIdentity({
      quoteDraft,
      designJob,
      conversation,
      selectedImage,
    });
  }

  listQuoteDrafts(filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.quoteDrafts
      .map((quote) => this.hydrateQuoteDraft(data, quote))
      .filter((quote) => this.matchesIdentityFilter(quote, filter))
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  getQuoteDraft(id: string) {
    const data = this.read();
    const quote = data.quoteDrafts.find((item) => item.id === id);
    return quote ? this.hydrateQuoteDraft(data, quote) : null;
  }

  private hasChangedField(current: Record<string, unknown>, patch: Record<string, unknown>, fields: string[]) {
    return fields.some(
      (field) => Object.prototype.hasOwnProperty.call(patch, field) && !sameValue(current?.[field], patch?.[field]),
    );
  }

  updateQuoteDraft(id: string, patch: any, options: { skipIdentityValidation?: boolean } = {}) {
    const data = this.read();
    const index = data.quoteDrafts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`local quote draft not found: ${id}`);
    const current = data.quoteDrafts[index];
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (this.hasChangedField(current, patch, ["designJobId", "customerId", "selectedImageId"]) && !options.skipIdentityValidation) {
      next.identityBinding = this.validateStoredQuoteDraftIdentity(data, next);
    }
    data.quoteDrafts[index] = next;
    this.write(data);
    return this.hydrateQuoteDraft(data, data.quoteDrafts[index]);
  }

  listOrderDrafts(filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.orderDrafts
      .map((order) => this.hydrateOrderDraft(data, order))
      .filter((order) => this.matchesIdentityFilter(order, filter))
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  getOrderDraft(id: string) {
    const data = this.read();
    const order = data.orderDrafts.find((item) => item.id === id);
    return order ? this.hydrateOrderDraft(data, order) : null;
  }

  upsertOrderDraftFromQuote(quoteId: string, draft: any) {
    const data = this.read();
    const quote = data.quoteDrafts.find((item) => item.id === quoteId);
    if (!quote) throw new Error(`local quote draft not found: ${quoteId}`);
    const now = new Date().toISOString();
    const index = data.orderDrafts.findIndex((item) => item.quoteDraftId === quoteId);
    const record = {
      id: index >= 0 ? data.orderDrafts[index].id : id("order"),
      ...draft,
      quoteDraftId: quoteId,
      createdAt: index >= 0 ? data.orderDrafts[index].createdAt : now,
      updatedAt: now,
    };
    record.identityBinding = this.validateStoredOrderDraftBinding(data, record);
    if (index >= 0) data.orderDrafts[index] = record;
    else data.orderDrafts.push(record);
    this.write(data);
    return this.hydrateOrderDraft(data, record);
  }

  updateOrderDraft(id: string, patch: any, options: { skipIdentityValidation?: boolean } = {}) {
    const data = this.read();
    const index = data.orderDrafts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`local order draft not found: ${id}`);
    const current = data.orderDrafts[index];
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (
      this.hasChangedField(current, patch, [
        "quoteDraftId",
        "designJobId",
        "customerId",
        "conversationId",
        "wechatAccountId",
        "selectedImageId",
      ]) &&
      !options.skipIdentityValidation
    ) {
      next.identityBinding = this.validateStoredOrderDraftBinding(data, next);
    }
    data.orderDrafts[index] = next;
    this.write(data);
    return this.hydrateOrderDraft(data, data.orderDrafts[index]);
  }

  listReviewLogs(filter: (IdentityListFilter & { limit?: number }) | number = 100) {
    const options = typeof filter === "number" ? { limit: filter } : filter;
    return this.read()
      .reviewLogs
      .filter((log) => this.matchesIdentityFilter(log, options))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(options.limit || 100), 300)));
  }

  createReviewLog(payload: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const identity = this.resolveTargetIdentity(
      data,
      this.buildReviewLogIdentityTarget(payload),
      "review log metadata",
    );
    const record = {
      id: id("review"),
      targetType: payload.targetType,
      targetId: payload.targetId,
      decision: payload.decision,
      reviewer: payload.reviewer || "人工客服",
      note: payload.note || "",
      beforeStatus: payload.beforeStatus || "",
      afterStatus: payload.afterStatus || "",
      metadata: {
        ...(payload.metadata || {}),
        ...identity.identityFields,
        identityBinding: identity.binding,
      },
      createdAt: now,
    };
    data.reviewLogs.push(record);
    this.write(data);
    return record;
  }

  private resolveTargetIdentity(data: StoreData, target: any, label: string) {
    const source = target && typeof target === "object" ? target : {};
    const related = this.resolveTargetIdentitySource(data, source);
    const conversationId = source.conversationId || related.conversationId || null;
    const customerId = source.customerId || related.customerId || null;
    const wechatAccountId = source.wechatAccountId || related.wechatAccountId || null;
    const identity = this.validateOptionalConversationBinding(
      data,
      {
        conversationId,
        customerId,
        wechatAccountId,
      },
      label,
    );
    if (related.conversationId && identity.conversationId !== related.conversationId) {
      throw new Error(`${label} conversation binding invalid: related record belongs to another conversation`);
    }
    if (related.customerId && identity.customerId !== related.customerId) {
      throw new Error(`${label} customer binding invalid: related record belongs to another customer`);
    }
    if (related.wechatAccountId && identity.wechatAccountId !== related.wechatAccountId) {
      throw new Error(`${label} wechat account binding invalid: related record belongs to another account`);
    }
    return {
      identityFields: identity.conversationId
        ? {
            conversationId: identity.conversationId,
            customerId: identity.customerId,
            wechatAccountId: identity.wechatAccountId,
          }
        : {},
      binding: identity.binding,
    };
  }

  private buildReviewLogIdentityTarget(payload: any) {
    const target = { ...(payload.metadata || {}) };
    if (payload.targetType === "conversation" && payload.targetId) target.conversationId = target.conversationId || payload.targetId;
    if (payload.targetType === "design_job" && payload.targetId) target.designJobId = target.designJobId || payload.targetId;
    if (payload.targetType === "quote" && payload.targetId) target.quoteDraftId = target.quoteDraftId || payload.targetId;
    if (payload.targetType === "send_task" && payload.targetId) target.sendTaskId = target.sendTaskId || payload.targetId;
    if (payload.targetType === "order_draft" && payload.targetId) target.orderDraftId = target.orderDraftId || payload.targetId;
    return target;
  }

  private resolveTargetIdentitySource(data: StoreData, target: any) {
    const sendTask = target.sendTaskId ? data.sendTasks.find((item) => item.id === target.sendTaskId) || null : null;
    const orderDraft = target.orderDraftId ? data.orderDrafts.find((item) => item.id === target.orderDraftId) || null : null;
    const quoteDraft =
      target.quoteDraftId || orderDraft?.quoteDraftId
        ? data.quoteDrafts.find((item) => item.id === (target.quoteDraftId || orderDraft?.quoteDraftId)) || null
        : null;
    const designJob =
      target.designJobId || sendTask?.designJobId || quoteDraft?.designJobId || orderDraft?.designJobId
        ? data.designJobs.find((item) => item.id === (target.designJobId || sendTask?.designJobId || quoteDraft?.designJobId || orderDraft?.designJobId)) ||
          null
        : null;
    const route = target.routeId ? data.routeEvaluations.find((item) => item.id === target.routeId) || null : null;
    return {
      conversationId: sendTask?.conversationId || orderDraft?.conversationId || designJob?.conversationId || route?.conversationId || null,
      customerId: orderDraft?.customerId || quoteDraft?.customerId || designJob?.customerId || route?.customerId || null,
      wechatAccountId: sendTask?.wechatAccountId || orderDraft?.wechatAccountId || designJob?.wechatAccountId || route?.wechatAccountId || null,
    };
  }

  private matchesIdentityFilter(record: any, filter: IdentityListFilter = {}) {
    const expectedWechatAccountId = String(filter.wechatAccountId || "").trim();
    const expectedConversationId = String(filter.conversationId || "").trim();
    const expectedCustomerId = String(filter.customerId || "").trim();
    if (!expectedWechatAccountId && !expectedConversationId && !expectedCustomerId) return true;
    const identity = this.recordIdentity(record);
    if (expectedWechatAccountId && identity.wechatAccountId !== expectedWechatAccountId) return false;
    if (expectedConversationId && identity.conversationId !== expectedConversationId) return false;
    if (expectedCustomerId && identity.customerId !== expectedCustomerId) return false;
    return true;
  }

  private recordIdentity(record: any) {
    const designJob = record?.designJob || null;
    const quoteDraft = record?.quoteDraft || null;
    const orderDraft = record?.orderDraft || null;
    const sendTask = record?.sendTask || null;
    const conversation = record?.conversation || record?.activeConversation || designJob?.conversation || quoteDraft?.designJob?.conversation || null;
    const target = record?.target || null;
    return {
      conversationId: String(
        record?.conversationId || target?.conversationId || conversation?.id || sendTask?.conversationId || designJob?.conversationId || quoteDraft?.designJob?.conversationId || orderDraft?.conversationId || "",
      ),
      customerId: String(
        record?.customerId || target?.customerId || conversation?.customerId || sendTask?.conversation?.customerId || designJob?.customerId || quoteDraft?.customerId || quoteDraft?.designJob?.customerId || orderDraft?.customerId || "",
      ),
      wechatAccountId: String(
        record?.wechatAccountId ||
          target?.wechatAccountId ||
          conversation?.wechatAccountId ||
          sendTask?.wechatAccountId ||
          designJob?.wechatAccountId ||
          quoteDraft?.designJob?.wechatAccountId ||
          orderDraft?.wechatAccountId ||
          "",
      ),
    };
  }

  health() {
    const data = this.read();
    return {
      ok: true,
      mode: "local-json",
      path: this.filePath,
      counts: {
        skus: data.skus.length,
        designAssets: data.designAssets.length,
        designJobs: data.designJobs.length,
        designRevisions: data.designRevisions.length,
        notifications: data.notifications.length,
        sendTasks: data.sendTasks.length,
        sendAttempts: data.sendAttempts.length,
        wechatWindowSnapshots: data.wechatWindowSnapshots.length,
        quoteDrafts: data.quoteDrafts.length,
        orderDrafts: data.orderDrafts.length,
        skuChangeLogs: data.skuChangeLogs.length,
        reviewLogs: data.reviewLogs.length,
        agents: data.agents.length,
        agentSkills: data.agentSkills.length,
        chatImports: data.chatImports.length,
        trainingSamples: data.trainingSamples.length,
        routeEvaluations: data.routeEvaluations.length,
      },
    };
  }

  private hydrateAgent(data: StoreData, agent: any) {
    const samples = data.trainingSamples.filter((sample) => sample.agentId === agent.id);
    const averageScore = samples.length
      ? round(samples.reduce((sum, sample) => sum + Number(sample.score || 0), 0) / samples.length)
      : 0;
    return {
      ...agent,
      skills: data.agentSkills.filter((skill) => skill.agentId === agent.id),
      trainingSampleCount: samples.length,
      averageTrainingScore: averageScore,
    };
  }

  private hydrateConversation(data: StoreData, conversation: any) {
    return {
      ...conversation,
      customer: data.customers.find((item) => item.id === conversation.customerId) || null,
      wechatAccount: data.wechatAccounts.find((item) => item.id === conversation.wechatAccountId) || null,
    };
  }

  private hydrateWechatWindowSnapshot(data: StoreData, snapshot: any) {
    const activeConversation =
      data.conversations.find((conversation) => {
        if (snapshot.wechatAccountId && conversation.wechatAccountId !== snapshot.wechatAccountId) return false;
        if (snapshot.externalChatId && conversation.externalChatId === snapshot.externalChatId) return true;
        if (snapshot.chatTitle && String(conversation.title || "").trim() === String(snapshot.chatTitle || "").trim()) return true;
        if (snapshot.recentCustomerId && conversation.customerId === snapshot.recentCustomerId) return true;
        return false;
      }) || null;
    return {
      ...snapshot,
      wechatAccount: data.wechatAccounts.find((item) => item.id === snapshot.wechatAccountId) || null,
      activeConversation: activeConversation ? this.hydrateConversation(data, activeConversation) : null,
    };
  }

  private hydrateDesignJob(data: StoreData, job: any) {
    return {
      ...job,
      customer: data.customers.find((item) => item.id === job.customerId) || null,
      conversation: data.conversations.find((item) => item.id === job.conversationId) || null,
      wechatAccount: data.wechatAccounts.find((item) => item.id === job.wechatAccountId) || null,
      assets: data.designAssets.filter((item) => (job.assetIds || []).includes(item.id)),
      images: data.designImages.filter((item) => item.designJobId === job.id).sort((a, b) => a.position - b.position),
      revisions: data.designRevisions
        .filter((item) => item.designJobId === job.id)
        .sort((a, b) => Number(a.revisionNumber || 0) - Number(b.revisionNumber || 0)),
    };
  }

  private hydrateSendTask(data: StoreData, task: any) {
    const conversation = data.conversations.find((item) => item.id === task.conversationId) || null;
    const attempts = data.sendAttempts
      .filter((attempt) => attempt.sendTaskId === task.id)
      .sort((a, b) => String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt)));
    return {
      ...task,
      wechatAccount: data.wechatAccounts.find((item) => item.id === task.wechatAccountId) || null,
      conversation: conversation ? this.hydrateConversation(data, conversation) : null,
      designJob: task.designJobId ? data.designJobs.find((item) => item.id === task.designJobId) || null : null,
      quoteDraft: data.quoteDrafts.find((item) => item.id === task.quoteDraftId || item.sendTaskId === task.id) || null,
      attempts,
      attemptCount: attempts.length,
      latestAttempt: attempts[0] || null,
    };
  }

  private hydrateSendAttempt(data: StoreData, attempt: any) {
    return {
      ...attempt,
      sendTask: data.sendTasks.find((item) => item.id === attempt.sendTaskId) || null,
      windowSnapshot: attempt.windowSnapshotId
        ? data.wechatWindowSnapshots.find((item) => item.id === attempt.windowSnapshotId) || null
        : null,
    };
  }

  private hydrateQuoteDraft(data: StoreData, quote: any) {
    const designJob = data.designJobs.find((item) => item.id === quote.designJobId) || null;
    const sendTask = quote.sendTaskId
      ? data.sendTasks.find((item) => item.id === quote.sendTaskId) || null
      : null;
    const selectedImage = quote.selectedImageId
      ? data.designImages.find((item) => item.id === quote.selectedImageId || item.imageId === quote.selectedImageId) || null
      : null;
    const totalPrice = Number(quote.totalPrice || 0);
    const profit = Number(quote.profit || 0);
    return {
      ...quote,
      profitRate: totalPrice > 0 ? round(profit / totalPrice) : 0,
      customer: data.customers.find((item) => item.id === quote.customerId) || null,
      designJob: designJob ? this.hydrateDesignJob(data, designJob) : null,
      selectedImage,
      sendTask: sendTask ? this.hydrateSendTask(data, sendTask) : null,
    };
  }

  private hydrateOrderDraft(data: StoreData, order: any) {
    const quoteDraft = data.quoteDrafts.find((item) => item.id === order.quoteDraftId) || null;
    const designJob = data.designJobs.find((item) => item.id === order.designJobId) || null;
    const selectedImage = order.selectedImageId
      ? data.designImages.find((item) => item.id === order.selectedImageId || item.imageId === order.selectedImageId) || null
      : null;
    const confirmationSendTask = this.findOrderConfirmationSendTask(data, order);
    const followupSendTasks = this.findOrderFollowupSendTasks(data, order);
    const followupSendTask = followupSendTasks[0] || null;
    const productionFollowupSendTask =
      followupSendTasks.find((task) => this.orderFollowupType(task) === "production") || null;
    const deliveryFollowupSendTask =
      followupSendTasks.find((task) => this.orderFollowupType(task) === "delivery") || null;
    const totalPrice = Number(order.totalPrice || 0);
    const profit = Number(order.profit || 0);
    return {
      ...order,
      profitRate: order.profitRate ?? (totalPrice > 0 ? round(profit / totalPrice) : 0),
      quoteDraft: quoteDraft ? this.hydrateQuoteDraft(data, quoteDraft) : null,
      customer: data.customers.find((item) => item.id === order.customerId) || null,
      conversation: data.conversations.find((item) => item.id === order.conversationId) || null,
      wechatAccount: data.wechatAccounts.find((item) => item.id === order.wechatAccountId) || null,
      designJob: designJob ? this.hydrateDesignJob(data, designJob) : null,
      selectedImage,
      confirmationSendTaskId: confirmationSendTask?.id || null,
      confirmationSendTask: confirmationSendTask ? this.hydrateSendTask(data, confirmationSendTask) : null,
      followupSendTaskId: followupSendTask?.id || null,
      followupSendTask: followupSendTask ? this.hydrateSendTask(data, followupSendTask) : null,
      followupSendTasks: followupSendTasks.map((task) => this.hydrateSendTask(data, task)),
      productionFollowupSendTaskId: productionFollowupSendTask?.id || null,
      productionFollowupSendTask: productionFollowupSendTask
        ? this.hydrateSendTask(data, productionFollowupSendTask)
        : null,
      deliveryFollowupSendTaskId: deliveryFollowupSendTask?.id || null,
      deliveryFollowupSendTask: deliveryFollowupSendTask ? this.hydrateSendTask(data, deliveryFollowupSendTask) : null,
    };
  }

  private findOrderConfirmationSendTask(data: StoreData, order: any) {
    return data.sendTasks
      .filter((task) => this.isOrderConfirmationSendTask(task, order))
      .sort((a, b) => String(b.createdAt || b.updatedAt).localeCompare(String(a.createdAt || a.updatedAt)))[0] || null;
  }

  private isOrderConfirmationSendTask(task: any, order: any) {
    const automation = task.guardSnapshot?.automation || {};
    const isConfirmation =
      automation.source === "order_confirmation" ||
      automation.source === "low_value_quote_acceptance" ||
      task.guardSnapshot?.reason === "order-confirmation" ||
      task.guardSnapshot?.reason === "low_value_order_confirmation";
    if (automation.orderDraftId === order.id) return isConfirmation;
    if (task.quoteDraftId !== order.quoteDraftId) return false;
    return isConfirmation;
  }

  private findOrderFollowupSendTasks(data: StoreData, order: any) {
    return data.sendTasks
      .filter((task) => this.isOrderFollowupSendTask(task, order))
      .sort((a, b) => String(b.createdAt || b.updatedAt).localeCompare(String(a.createdAt || a.updatedAt)));
  }

  private isOrderFollowupSendTask(task: any, order: any) {
    const automation = task.guardSnapshot?.automation || {};
    if (automation.orderDraftId !== order.id && task.quoteDraftId !== order.quoteDraftId) return false;
    return (
      automation.source === "order_followup" ||
      task.guardSnapshot?.reason === "order-followup" ||
      task.guardSnapshot?.reason === "low_value_order_followup"
    );
  }

  private orderFollowupType(task: any) {
    const type = task?.guardSnapshot?.automation?.followupType || task?.payload?.followupType;
    return type === "production" || type === "delivery" ? type : "any";
  }

  private read(): StoreData {
    this.ensure();
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoreData;
    const normalized = normalizeData(data);
    if (normalized.changed) this.write(normalized.data);
    return normalized.data;
  }

  private write(data: StoreData) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private ensure() {
    if (fs.existsSync(this.filePath)) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.write(seedData());
  }

  private decorateTrainingSample(sample: any) {
    return {
      ...sample,
      quality: evaluateTrainingSampleQuality(sample),
    };
  }
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

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
];

function buildSkuChangedFields(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  if (!before) {
    return SKU_TRACKED_FIELDS
      .filter((field) => after[field] !== undefined && after[field] !== "")
      .map((field) => ({ field, before: null, after: after[field] }));
  }
  return SKU_TRACKED_FIELDS
    .filter((field) => !sameValue(before[field], after[field]))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

function pickSkuSnapshot(value: Record<string, unknown>) {
  return Object.fromEntries(
    ["skuCode", ...SKU_TRACKED_FIELDS]
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  );
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeAssetIds(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item : item?.id || item?.assetId))
        .filter(Boolean)
        .map(String),
    ),
  ];
}

function calculateTotals(items: any[]) {
  return items.reduce(
    (acc, item) => {
      acc.cost = round(acc.cost + Number(item.costPrice || item.cost || 0));
      acc.salePrice = round(acc.salePrice + Number(item.salePrice || item.price || 0));
      acc.profit = round(acc.salePrice - acc.cost);
      acc.profitRate = acc.salePrice > 0 ? round(acc.profit / acc.salePrice) : 0;
      return acc;
    },
    { cost: 0, salePrice: 0, profit: 0, profitRate: 0 },
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function canonicalSkillName(name: string) {
  return normalizeSkillName(name).replace(/\s+/g, "").toLowerCase();
}

function normalizeSkillName(name: string) {
  const text = String(name || "").trim();
  const aliases: Record<string, string> = {
    "棰勭畻婢勬竻": "预算澄清",
    "闇€姹傛緞娓?": "需求澄清",
    "璁捐闇€姹傜‘璁?": "设计需求确认",
    "鐗╂祦瀹夋姎": "物流安抚",
    "鍞悗鏂规": "售后方案",
    "楂樻儏鍟嗚瘽鏈?": "高情商话术",
  };
  if (aliases[text]) return aliases[text];
  return text;
}

function inferSkillHints(pair: any) {
  const text = `${pair.question || ""}\n${pair.answer || ""}`;
  if (isSceneClarificationReply(pair.answer)) return ["防乱回复"];
  const hints = [];
  if (/预算|价格|总预算|每盒|每份/.test(text)) hints.push("预算澄清");
  if (/效果图|设计|logo|摆拍/.test(text)) hints.push("设计需求确认");
  if (/发货|快递|物流|签收/.test(text)) hints.push("物流安抚");
  if (/退款|退货|换货|补发/.test(text)) hints.push("售后方案");
  if (/亲|您|帮您|这边|建议|麻烦/.test(text)) hints.push("高情商话术");
  return [...new Set(hints)];
}

function isSceneClarificationDerivedBusinessSkill(data: StoreData, skill: any) {
  if (!skill || canonicalSkillName(skill.name) === canonicalSkillName("防乱回复")) return false;
  const sourceSampleIds = Array.isArray(skill.sourceSampleIds) ? skill.sourceSampleIds : [];
  if (!sourceSampleIds.length) return false;
  const samples = sourceSampleIds
    .map((sampleId: string) => data.trainingSamples.find((sample) => sample.id === sampleId))
    .filter(Boolean);
  return Boolean(samples.length) && samples.every((sample: any) => isSceneClarificationReply(sample.idealReply));
}

function isSceneClarificationKnowledgeEntry(data: StoreData, entry: any) {
  const sample = entry?.sourceId ? data.trainingSamples.find((item) => item.id === entry.sourceId) : null;
  return Boolean(sample && isSceneClarificationReply(sample.idealReply));
}

function resolveTrainingSampleAgent(data: StoreData, payload: any, before: any) {
  const agentId = payload.agentId ? String(payload.agentId) : "";
  const agentKey = payload.agentKey ? String(payload.agentKey) : "";
  const agent =
    (agentId ? data.agents.find((item) => item.id === agentId) : null) ||
    (agentKey ? data.agents.find((item) => item.key === agentKey) : null) ||
    data.agents.find((item) => item.id === before.agentId) ||
    data.agents.find((item) => item.key === before.agentKey) ||
    null;
  if ((agentId || agentKey) && !agent) throw new Error(`training sample agent not found: ${agentId || agentKey}`);
  return agent;
}

function buildTrainingSampleReviewPatch(payload: any, before: any, agent: any) {
  const patch: Record<string, unknown> = {};
  if (agent) {
    patch.agentId = agent.id;
    patch.agentKey = agent.key;
  }
  if (payload.scene !== undefined) patch.scene = nonEmptyOrFallback(payload.scene, before.scene || "未分类");
  if (payload.customerText !== undefined) patch.customerText = nonEmptyOrFallback(payload.customerText, before.customerText || "");
  if (payload.idealReply !== undefined) patch.idealReply = nonEmptyOrFallback(payload.idealReply, before.idealReply || "");
  if (payload.score !== undefined) patch.score = clampScore(payload.score, before.score);
  if (payload.skillHints !== undefined) patch.skillHints = normalizeSkillHintsInput(payload.skillHints);
  return patch;
}

function buildTrainingSampleChangedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return ["agentKey", "scene", "customerText", "idealReply", "score", "skillHints", "status"]
    .filter((field) => !sameValue(before[field], after[field]))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

function nonEmptyOrFallback(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clampScore(value: unknown, fallback: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return Number(fallback || 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeSkillHintsInput(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\u3001;；|]/);
  return [...new Set(raw.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeData(data: Partial<StoreData>): { data: StoreData; changed: boolean } {
  let changed = false;
  const normalized = data as StoreData;
  const keys: Array<keyof StoreData> = [
    "wechatAccounts",
    "customers",
    "conversations",
    "messages",
    "wechatWindowSnapshots",
    "skus",
    "skuChangeLogs",
    "designAssets",
    "designJobs",
    "designImages",
    "designRevisions",
    "notifications",
    "sendTasks",
    "sendAttempts",
    "quoteDrafts",
    "orderDrafts",
    "reviewLogs",
    "agents",
    "agentSkills",
    "chatImports",
    "trainingSamples",
    "knowledgeEntries",
    "routeEvaluations",
    "automationRuns",
  ];
  for (const key of keys) {
    if (!Array.isArray(normalized[key])) {
      (normalized[key] as any[]) = [];
      changed = true;
    }
  }

  const now = new Date().toISOString();
  const seeded = seedAgentConfig(now);
  if (!normalized.agents.length) {
    normalized.agents = seeded.agents;
    normalized.agentSkills = seeded.agentSkills;
    changed = true;
  }
  changed = syncSeedAgentConfig(normalized, seeded, now) || changed;

  if (!normalized.wechatAccounts.some((account) => account.id === "wechat_demo_2")) {
    applyMultiAccountSeed(normalized, now);
    changed = true;
  }

  return { data: normalized, changed };
}

function syncSeedAgentConfig(data: StoreData, seeded: ReturnType<typeof seedAgentConfig>, now: string) {
  let changed = false;
  for (const seededAgent of seeded.agents) {
    const existing = data.agents.find((agent) => agent.key === seededAgent.key);
    if (!existing) {
      data.agents.push(seededAgent);
      changed = true;
      continue;
    }
    const patch = {
      name: seededAgent.name,
      scene: seededAgent.scene,
      description: seededAgent.description,
      valueLevel: seededAgent.valueLevel,
      sortOrder: seededAgent.sortOrder,
    };
    if (
      existing.name !== patch.name ||
      existing.scene !== patch.scene ||
      existing.description !== patch.description ||
      existing.valueLevel !== patch.valueLevel ||
      existing.sortOrder !== patch.sortOrder
    ) {
      Object.assign(existing, patch, { updatedAt: now });
      changed = true;
    }
  }

  for (const seededSkill of seeded.agentSkills) {
    const exists = data.agentSkills.some(
      (skill) =>
        skill.agentId === seededSkill.agentId &&
        canonicalSkillName(skill.name) === canonicalSkillName(seededSkill.name),
    );
    if (!exists) {
      data.agentSkills.push({
        ...seededSkill,
        id: id("skill"),
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
  }
  return changed;
}

function seedData(): StoreData {
  const now = new Date().toISOString();
  const wechatAccount = { id: "wechat_demo_1", displayName: "微信客服1号", alias: "demo", isActive: true, createdAt: now, updatedAt: now };
  const wechatAccount2 = { id: "wechat_demo_2", displayName: "微信客服2号", alias: "demo2", isActive: true, createdAt: now, updatedAt: now };
  const customer = { id: "customer_demo_1", name: "王总", wechatId: "demo_wang", tags: ["低预算快审"], source: "wechat", createdAt: now, updatedAt: now };
  const customer2 = { id: "customer_demo_2", name: "李经理", wechatId: "demo_li", tags: ["高价值人工"], source: "wechat", createdAt: now, updatedAt: now };
  const conversation = {
    id: "conversation_demo_1",
    channel: "wechat",
    title: "王总-端午礼盒",
    customerId: customer.id,
    wechatAccountId: wechatAccount.id,
    lastMessageAt: now,
    manualLocked: false,
    createdAt: now,
    updatedAt: now,
  };
  const conversation2 = {
    id: "conversation_demo_2",
    channel: "wechat",
    title: "李经理-企业伴手礼",
    customerId: customer2.id,
    wechatAccountId: wechatAccount2.id,
    lastMessageAt: now,
    manualLocked: true,
    createdAt: now,
    updatedAt: now,
  };
  const skus = [
    { id: "sku_box_a", skuCode: "BOX-A", name: "红金礼盒A", type: "gift_box", category: "礼盒", sceneTags: ["员工福利", "节日礼赠"], costPrice: 30, salePrice: 60, stock: 120, dimensions: { width: 320, height: 90, depth: 240 }, replacementSkuCodes: [], isActive: true, createdAt: now, updatedAt: now },
    { id: "sku_tea_a", skuCode: "TEA-A", name: "茶叶礼品A", type: "item", category: "内搭", sceneTags: ["员工福利"], costPrice: 65, salePrice: 110, stock: 42, dimensions: { width: 90, height: 160, depth: 60 }, replacementSkuCodes: ["TEA-B"], isActive: true, createdAt: now, updatedAt: now },
    { id: "sku_tea_b", skuCode: "TEA-B", name: "茶叶礼品B", type: "item", category: "内搭", sceneTags: ["员工福利"], costPrice: 60, salePrice: 105, stock: 80, dimensions: { width: 90, height: 160, depth: 60 }, replacementSkuCodes: [], isActive: true, createdAt: now, updatedAt: now },
    { id: "sku_card_a", skuCode: "CARD-A", name: "定制贺卡A", type: "accessory", category: "贺卡", sceneTags: ["节日礼赠", "客户拜访"], costPrice: 5, salePrice: 20, stock: 500, dimensions: { width: 120, height: 80 }, replacementSkuCodes: [], isActive: true, createdAt: now, updatedAt: now },
  ];
  const agentConfig = seedAgentConfig(now);
  return {
    wechatAccounts: [wechatAccount, wechatAccount2],
    customers: [customer, customer2],
    conversations: [conversation, conversation2],
    messages: [
      { id: "msg_demo_1", conversationId: conversation.id, direction: "inbound", text: "我想看端午礼盒效果图", createdAt: now },
      { id: "msg_demo_2", conversationId: conversation2.id, direction: "inbound", text: "我们要做一批企业伴手礼，预算比较高", createdAt: now },
    ],
    wechatWindowSnapshots: [],
    skus,
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    reviewLogs: [],
    agents: agentConfig.agents,
    agentSkills: agentConfig.agentSkills,
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
  };
}

function automationRunKey(run: any) {
  return [run?.startedAt || "", run?.trigger || "", run?.completedAt || "", run?.reason || ""].join("|");
}

function applyMultiAccountSeed(data: StoreData, now: string) {
  if (!data.wechatAccounts.some((item) => item.id === "wechat_demo_2")) {
    data.wechatAccounts.push({
      id: "wechat_demo_2",
      displayName: "微信客服2号",
      alias: "demo2",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!data.customers.some((item) => item.id === "customer_demo_2")) {
    data.customers.push({
      id: "customer_demo_2",
      name: "李经理",
      wechatId: "demo_li",
      tags: ["高价值人工"],
      source: "wechat",
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!data.conversations.some((item) => item.id === "conversation_demo_2")) {
    data.conversations.push({
      id: "conversation_demo_2",
      channel: "wechat",
      title: "李经理-企业伴手礼",
      customerId: "customer_demo_2",
      wechatAccountId: "wechat_demo_2",
      lastMessageAt: now,
      manualLocked: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!data.messages.some((item) => item.id === "msg_demo_1")) {
    data.messages.push({
      id: "msg_demo_1",
      conversationId: "conversation_demo_1",
      direction: "inbound",
      text: "我想看端午礼盒效果图",
      createdAt: now,
    });
  }
  if (!data.messages.some((item) => item.id === "msg_demo_2")) {
    data.messages.push({
      id: "msg_demo_2",
      conversationId: "conversation_demo_2",
      direction: "inbound",
      text: "我们要做一批企业伴手礼，预算比较高",
      createdAt: now,
    });
  }
}

function seedAgentConfig(now: string) {
  const agents = [
    {
      id: "agent_pre_sales",
      key: "pre_sales",
      name: "售前转化 Agent",
      scene: "售前咨询、商品推荐、价格解释",
      description: "识别客户需求和预算，用自然话术推动客户确认方案。",
      valueLevel: "low_auto_high_review",
      enabled: true,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_gift_design",
      key: "gift_design",
      name: "礼盒设计 Agent",
      scene: "礼盒搭配、效果图、Logo 定制",
      description: "收集预算、数量、用途、素材和风格，联动设计平台生成候选图。",
      valueLevel: "high_review",
      enabled: true,
      sortOrder: 20,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_order_payment",
      key: "order_payment",
      name: "下单支付 Agent",
      scene: "下单、付款、改地址、发票、订单状态",
      description: "核对订单和付款信息，处理下单、支付、地址、发票等问题。",
      valueLevel: "low_auto_high_review",
      enabled: true,
      sortOrder: 25,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_logistics_exception",
      key: "logistics_exception",
      name: "物流异常 Agent",
      scene: "催发货、查物流、签收异常",
      description: "先安抚客户，再核对订单状态，必要时转人工跟进。",
      valueLevel: "low_auto",
      enabled: true,
      sortOrder: 30,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_after_sales",
      key: "after_sales",
      name: "售后安抚 Agent",
      scene: "退款、退货、换货、破损补发",
      description: "判断售后类型，保持高情商沟通，复杂争议转人工。",
      valueLevel: "review_sensitive",
      enabled: true,
      sortOrder: 40,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_size_recommendation",
      key: "size_recommendation",
      name: "尺码推荐 Agent",
      scene: "尺码、身高体重、适配建议",
      description: "根据客户身体信息和商品规则推荐尺码，不确定时追问关键参数。",
      valueLevel: "low_auto",
      enabled: true,
      sortOrder: 50,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_general",
      key: "general",
      name: "未分类兜底 Agent",
      scene: "无法归类的问题",
      description: "识别风险和缺失信息，避免乱回复，优先转人工确认。",
      valueLevel: "review",
      enabled: true,
      sortOrder: 99,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const skillSeeds = [
    ["agent_pre_sales", "需求澄清", "先问用途、预算、数量和交期，不急着推商品。"],
    ["agent_pre_sales", "转化推进", "在客户意向明确时给出下一步确认动作。"],
    ["agent_gift_design", "预算澄清", "识别每份预算或总预算加数量，并折算单份预算。"],
    ["agent_gift_design", "设计需求确认", "收集 Logo、参考图、文案、风格、礼盒搭配和出图数量。"],
    ["agent_gift_design", "高价值转人工", "总额或单份金额达到阈值时要求人工审核报价和图片。"],
    ["agent_order_payment", "订单信息核对", "先确认订单号、付款状态、地址和发票信息，不跨会话处理订单。"],
    ["agent_order_payment", "付款说明", "说明定金、尾款、支付状态和下一步处理，不承诺未核实的到账结果。"],
    ["agent_logistics_exception", "物流安抚", "先承接情绪，再说明核查和处理动作。"],
    ["agent_after_sales", "售后方案", "区分退款、退货、换货、补发，敏感争议不自动承诺赔付。"],
    ["agent_after_sales", "高情商话术", "避免机械模板，使用自然、负责、明确下一步的表达。"],
    ["agent_size_recommendation", "参数追问", "缺少身高、体重、版型或穿着偏好时先追问。"],
    ["agent_general", "防乱回复", "客户、账号、会话不匹配时不回复，交给人工确认。"],
  ];

  const agentSkills = skillSeeds.map(([agentId, name, description], index) => ({
    id: `skill_${index + 1}`,
    agentId,
    name,
    description,
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }));

  return { agents, agentSkills };
}
