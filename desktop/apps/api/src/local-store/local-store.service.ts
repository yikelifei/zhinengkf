import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { routingCorrectionRequestKey } from "../shared/routing-correction";
import {
  assertExactOperationReplay,
  assertStoredOperationIdentityReplay,
  createChatImportOperationFingerprint,
  createOperationFingerprint,
  createInboundMessageOperationFingerprint,
  createSendTaskOperationFingerprint,
  deterministicOperationId,
  InboundLeaseLostError,
  monotonicInboundOperationStage,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
} from "../shared/operation-idempotency";
import { assertNotificationEffectReplay } from "../shared/notification-idempotency";
import { appConfig } from "../shared/app-config";
import {
  conversationTimelineTaskPartStatus,
  conversationTimelineTaskParts,
  conversationTimelineMessagePresentation,
  normalizeConversationTimelineAttachments,
} from "../shared/conversation-message-presentation";

const {
  buildOrderDraftFromQuote,
  diagnoseWechatWindowSnapshot,
  evaluateTrainingSampleQuality,
  inspectBundleAutomationReadiness,
  isHighValueBudget,
  isSceneClarificationReply,
  isTrainingSampleReady,
  latestCandidateRound,
  normalizeBundleSnapshot,
  normalizeDesignImageSnapshot,
  normalizeTrainingSampleStatus,
  buildConversationLearningInsight,
  trainingSampleReviewNote,
  validateDesignAssetBinding,
  validateDesignJobIdentity,
  validateInboundConversationBinding,
  validateOrderDraftQuoteBinding,
  validateQuoteDraftIdentity,
  validateSendTaskBinding,
  validateCustomerSelectionPageProofs,
  getToolDefinition,
} = require(path.join(process.cwd(), "packages", "rules"));

type StoreData = {
  wechatAccounts: any[];
  customers: any[];
  conversations: any[];
  messages: any[];
  inboundMessageOperations: any[];
  wechatWindowSnapshots: any[];
  skus: any[];
  skuChangeLogs: any[];
  designAssets: any[];
  designJobs: any[];
  designImages: any[];
  designRevisions: any[];
  designPlatformExecutions: any[];
  notifications: any[];
  sendTasks: any[];
  sendAttempts: any[];
  quoteDrafts: any[];
  orderDrafts: any[];
  paymentEvents: any[];
  reviewLogs: any[];
  agents: any[];
  agentSkills: any[];
  chatImports: any[];
  trainingSamples: any[];
  knowledgeEntries: any[];
  routeEvaluations: any[];
  agentTasks: any[];
  agentTaskSteps: any[];
  agentTaskApprovals: any[];
  agentTaskToolExecutions: any[];
  automationRuns: any[];
  wechatWorkBindings: any[];
  wechatWorkAuditLogs: any[];
  wechatWorkCustomerUpgrades: any[];
  wechatWorkSyncCursors: any[];
  personalWechatRpaBindings: any[];
  personalWechatRpaAuditLogs: any[];
};

type IdentityListFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

function localStoreNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const MAX_WECHAT_WINDOW_SNAPSHOTS = localStoreNumberEnv("LOCAL_STORE_MAX_WECHAT_WINDOW_SNAPSHOTS", 500);
const DESIGN_CALLBACK_CLAIM_LEASE_MS = 15 * 60 * 1000;
const LOCAL_STORE_LOCK_STALE_MS = Math.max(5_000, localStoreNumberEnv("LOCAL_STORE_LOCK_STALE_MS", 30_000));
const LOCAL_STORE_LOCK_WAIT_MS = localStoreNumberEnv("LOCAL_STORE_LOCK_WAIT_MS", 3_000);
const LOCAL_STORE_LOCK_RETRY_MS = 20;
const LOCAL_STORE_WRITE_RENAME_WAIT_MS = localStoreNumberEnv("LOCAL_STORE_WRITE_RENAME_WAIT_MS", 1_000);
const LOCAL_STORE_WRITE_RENAME_RETRY_MS = 25;
const INBOUND_LEASE_RENEWAL_WRITE_THRESHOLD_MS = 5_000;

class LocalStoreConcurrentWriteError extends ConflictException {
  constructor(message = "local store changed before the transaction could commit") {
    super({ code: "LOCAL_STORE_CONCURRENT_WRITE", message });
    this.name = "LocalStoreConcurrentWriteError";
  }
}

function localDesignCallbackClaimIsFresh(value: unknown) {
  const claimedAt = Date.parse(String(value || ""));
  return Number.isFinite(claimedAt) && Date.now() - claimedAt <= DESIGN_CALLBACK_CLAIM_LEASE_MS;
}

function resolveLocalStoreFilePath() {
  if (process.env.LOCAL_STORE_FILE) return path.resolve(process.env.LOCAL_STORE_FILE);
  const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
    ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
    : path.join(process.cwd(), ".runtime");
  return path.join(runtimeDir, "local-store.json");
}

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

function resolveSkillSuggestionSourceScope(data: StoreData, suggestion: any) {
  const sampleIds = Array.isArray(suggestion?.sampleIds) ? suggestion.sampleIds.map(String).filter(Boolean) : [];
  if (!sampleIds.length) return { ok: true, identityFields: {}, binding: null };
  const samples = sampleIds.map((sampleId: string) => data.trainingSamples.find((sample) => sample.id === sampleId)).filter(Boolean);
  if (samples.length !== sampleIds.length) return { ok: false, reason: "missing_source_sample", identityFields: {}, binding: null };
  const identityFields = sharedIdentityFields(samples);
  if (!identityFields) return { ok: false, reason: "mixed_source_identity", identityFields: {}, binding: null };
  const hasIdentity = Boolean(identityFields.wechatAccountId || identityFields.conversationId || identityFields.customerId);
  return {
    ok: true,
    identityFields,
    binding: hasIdentity
      ? {
          status: "passed",
          ...identityFields,
          sourceSampleIds: sampleIds,
        }
      : null,
  };
}

function sharedIdentityFields(records: any[]) {
  const fields: IdentityListFilter = {};
  for (const key of ["wechatAccountId", "conversationId", "customerId"] as const) {
    const values = [
      ...new Set(
        records.flatMap((record) => [
          String(record?.[key] || "").trim(),
          String(record?.identityBinding?.[key] || "").trim(),
        ]).filter(Boolean),
      ),
    ];
    if (values.length > 1) return null;
    if (values.length === 1) fields[key] = values[0];
  }
  return fields;
}

function skillIdentityFields(data: StoreData, skill: any) {
  const direct = sharedIdentityFields([skill]);
  if (direct && (direct.wechatAccountId || direct.conversationId || direct.customerId)) return direct;
  const sampleIds = Array.isArray(skill?.sourceSampleIds) ? skill.sourceSampleIds.map(String).filter(Boolean) : [];
  if (!sampleIds.length) return {};
  const samples = sampleIds.map((sampleId: string) => data.trainingSamples.find((sample) => sample.id === sampleId)).filter(Boolean);
  return sharedIdentityFields(samples) || {};
}

function skillIdentityHasConflict(data: StoreData, skill: any) {
  if (sharedIdentityFields([skill]) === null) return true;
  const sampleIds = Array.isArray(skill?.sourceSampleIds) ? skill.sourceSampleIds.map(String).filter(Boolean) : [];
  if (!sampleIds.length) return false;
  const samples = sampleIds.map((sampleId: string) => data.trainingSamples.find((sample) => sample.id === sampleId)).filter(Boolean);
  return Boolean(samples.length && sharedIdentityFields(samples) === null);
}

function skillScopeMetadata(data: StoreData, skill: any) {
  if (skillIdentityHasConflict(data, skill)) {
    return {
      level: "mixed",
      label: "混合来源",
      reason: "Skill 身份字段或来源样本身份不一致，自动回复会拒绝使用。",
    };
  }
  const identityFields = skillIdentityFields(data, skill);
  if (identityFields.conversationId) {
    return {
      level: "conversation",
      label: "当前会话私有",
      reason: "只在同一微信账号、同一客户、同一会话下使用。",
      ...identityFields,
    };
  }
  if (identityFields.customerId) {
    return {
      level: "customer",
      label: "客户私有",
      reason: "只在同一客户下使用。",
      ...identityFields,
    };
  }
  if (identityFields.wechatAccountId) {
    return {
      level: "wechat_account",
      label: "微信账号内共享",
      reason: "只在同一微信账号下使用。",
      ...identityFields,
    };
  }
  return {
    level: "global",
    label: "全局 Skill",
    reason: "没有客户或账号绑定，作为该 Agent 的通用能力使用。",
  };
}

function hydrateAgentSkill(data: StoreData, skill: any) {
  return {
    ...skill,
    scope: skillScopeMetadata(data, skill),
  };
}

function sameSkillIdentityScope(left: IdentityListFilter = {}, right: IdentityListFilter = {}) {
  return (
    String(left.wechatAccountId || "") === String(right.wechatAccountId || "") &&
    String(left.conversationId || "") === String(right.conversationId || "") &&
    String(left.customerId || "") === String(right.customerId || "")
  );
}

@Injectable()
export class LocalStoreService {
  private readonly filePath = resolveLocalStoreFilePath();
  private readonly readFingerprints = new WeakMap<StoreData, string>();
  private storeLockDepth = 0;
  private storeLockOwnershipCheck: (() => void) | null = null;
  private readSnapshotDepth = 0;
  private readSnapshotData: StoreData | null = null;
  private readSnapshotFilePath = "";
  private writeTransactionData: StoreData | null = null;
  private writeTransactionDirty = false;

  withReadSnapshot<T>(operation: () => T): T {
    if (this.readSnapshotDepth > 0) return operation();
    const data = this.read();
    this.readSnapshotDepth = 1;
    this.readSnapshotData = data;
    this.readSnapshotFilePath = this.filePath;
    try {
      return operation();
    } finally {
      this.readSnapshotDepth = 0;
      this.readSnapshotData = null;
      this.readSnapshotFilePath = "";
    }
  }

  withWriteTransaction<T>(operation: () => T): T {
    if (this.writeTransactionData) return operation();
    if (this.readSnapshotDepth > 0) {
      throw new InternalServerErrorException("local store write transaction cannot start inside a read snapshot");
    }
    return this.withStoreLock(() => {
      const data = this.read();
      this.writeTransactionData = data;
      this.writeTransactionDirty = false;
      try {
        const result = operation();
        if (result && typeof (result as any).then === "function") {
          throw new InternalServerErrorException("local store write transaction must be synchronous");
        }
        if (this.writeTransactionDirty) this.writeWhileLocked(data);
        return result;
      } finally {
        this.writeTransactionData = null;
        this.writeTransactionDirty = false;
      }
    });
  }

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

  deleteSku(skuCode: string, context: Record<string, unknown> = {}) {
    const data = this.read();
    const index = data.skus.findIndex((sku) => sku.skuCode === skuCode);
    if (index < 0) throw new Error(`local sku not found: ${skuCode}`);
    const previous = data.skus[index];
    data.skus.splice(index, 1);
    const assetCountBefore = data.designAssets.length;
    data.designAssets = data.designAssets.filter((asset) =>
      !(asset.ownerType === "sku" && asset.ownerId === skuCode),
    );
    this.recordSkuDeleteLog(data, previous, {
      source: context.source || "manual_delete",
      operator: context.operator,
      reason: context.reason || "删除商品",
    });
    this.write(data);
    return {
      deletedSku: previous,
      removedAssetCount: assetCountBefore - data.designAssets.length,
    };
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

  listDesignAssets(filter: { ownerType?: string; ownerId?: string } & IdentityListFilter = {}) {
    return this.read()
      .designAssets
      .filter((asset) => !filter.ownerType || asset.ownerType === filter.ownerType)
      .filter((asset) => !filter.ownerId || asset.ownerId === filter.ownerId)
      .filter((asset) => this.matchesIdentityFilter(asset, filter))
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
      normalizedLocalPath: payload.normalizedLocalPath || null,
      sizeBytes: payload.sizeBytes || 0,
      source: payload.source || "manual_upload",
      wechatAccountId: payload.wechatAccountId || null,
      conversationId: payload.conversationId || null,
      customerId: payload.customerId || (payload.ownerType === "customer" ? payload.ownerId : null),
      createdAt: now,
    };
    data.designAssets.push(record);
    this.write(data);
    return record;
  }

  upsertDesignAsset(payload: any) {
    const data = this.read();
    const normalizedLocalPath = String(payload.normalizedLocalPath || "").trim() || null;
    const existingIndex = data.designAssets.findIndex((asset) =>
      normalizedLocalPath
        ? asset.normalizedLocalPath === normalizedLocalPath
        : asset.ownerType === payload.ownerType &&
          asset.ownerId === payload.ownerId &&
          asset.role === (payload.role || "reference") &&
          asset.localPath === payload.localPath,
    );
    if (existingIndex < 0) {
      const now = new Date().toISOString();
      const record: any = {
        id: id("asset"),
        ownerType: payload.ownerType,
        ownerId: payload.ownerId,
        role: payload.role || "reference",
        fileName: payload.fileName,
        mimeType: payload.mimeType || "application/octet-stream",
        localPath: payload.localPath,
        normalizedLocalPath,
        sizeBytes: payload.sizeBytes || 0,
        source: payload.source || "manual_upload",
        wechatAccountId: payload.wechatAccountId || null,
        conversationId: payload.conversationId || null,
        customerId: payload.customerId || (payload.ownerType === "customer" ? payload.ownerId : null),
        createdAt: now,
      };
      data.designAssets.push(record);
      this.write(data);
      return record;
    }
    const current = data.designAssets[existingIndex];
    const updated = {
      ...current,
      ownerType: payload.ownerType,
      ownerId: payload.ownerId,
      role: payload.role || current.role || "reference",
      fileName: payload.fileName || current.fileName,
      mimeType: payload.mimeType || current.mimeType || "application/octet-stream",
      localPath: payload.localPath || current.localPath,
      normalizedLocalPath,
      sizeBytes: payload.sizeBytes || current.sizeBytes || 0,
      source: payload.source || current.source || "manual_upload",
      wechatAccountId: payload.wechatAccountId || current.wechatAccountId || null,
      conversationId: payload.conversationId || current.conversationId || null,
      customerId: payload.customerId || current.customerId || (payload.ownerType === "customer" ? payload.ownerId : null),
    };
    data.designAssets[existingIndex] = updated;
    this.write(data);
    return updated;
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

  listAgents(filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.agents
      .map((agent) => this.hydrateAgent(data, agent, filter))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }

  listAgentSkills(agentId?: string, filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.agentSkills
      .filter((skill) => !agentId || skill.agentId === agentId)
      .filter((skill) => !localStoreIsSceneClarificationDerivedBusinessSkill(data, skill))
      .filter((skill) => this.matchesSkillIdentityFilter(data, skill, filter))
      .map((skill) => hydrateAgentSkill(data, skill))
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
      const sourceScope = resolveSkillSuggestionSourceScope(data, suggestion);
      if (!sourceScope.ok) {
        result.skipped.push({ ...suggestion, reason: sourceScope.reason });
        continue;
      }
      const existingIndex = data.agentSkills.findIndex(
        (skill) =>
          skill.agentId === suggestion.agentId &&
          canonicalSkillName(skill.name) === canonicalSkillName(suggestion.name) &&
          !skillIdentityHasConflict(data, skill) &&
          sameSkillIdentityScope(skillIdentityFields(data, skill), sourceScope.identityFields),
      );
      const nextPatch = {
        name: suggestion.name,
        description: suggestion.description || "",
        enabled: true,
        sampleCount: Number(suggestion.sampleCount || 0),
        confidence: Number(suggestion.confidence || 0),
        sourceType: "training_compiler",
        sourceSampleIds: suggestion.sampleIds || [],
        ...sourceScope.identityFields,
        identityBinding: sourceScope.binding,
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

  upsertWechatWorkAccount(payload: { openKfid: string; name?: string; avatar?: string }) {
    const openKfid = String(payload.openKfid || "").trim();
    if (!openKfid) throw new Error("wechat work account requires openKfid");
    const officialName = String(payload.name || "").trim();
    const officialAvatar = String(payload.avatar || "").trim();
    const data = this.read();
    const now = new Date().toISOString();
    let account = data.wechatAccounts.find((item) => item.wechatWork?.openKfid === openKfid) || null;
    if (!account) {
      account = {
        id: id("wechat_work"),
        displayName: officialName || `企业微信客服 ${shortExternalId(openKfid)}`,
        alias: shortExternalId(openKfid),
        platform: "wechat_work_kf",
        isActive: true,
        avatarUrl: officialAvatar || null,
        wechatWork: { openKfid, name: officialName || null, avatar: officialAvatar || null },
        createdAt: now,
        updatedAt: now,
      };
      data.wechatAccounts.push(account);
    } else {
      const nextDisplayName = officialName || account.displayName || `企业微信客服 ${shortExternalId(openKfid)}`;
      const nextAlias = account.alias || shortExternalId(openKfid);
      const nextAvatarUrl = officialAvatar || account.avatarUrl || null;
      const nextWechatWork = {
        ...(account.wechatWork || {}),
        openKfid,
        ...(officialName ? { name: officialName } : {}),
        ...(officialAvatar ? { avatar: officialAvatar } : {}),
      };
      const changed =
        account.displayName !== nextDisplayName
        || account.alias !== nextAlias
        || account.platform !== "wechat_work_kf"
        || account.isActive !== true
        || account.avatarUrl !== nextAvatarUrl
        || JSON.stringify(account.wechatWork || {}) !== JSON.stringify(nextWechatWork);
      if (!changed) return account;
      account.displayName = nextDisplayName;
      account.alias = nextAlias;
      account.platform = "wechat_work_kf";
      account.isActive = true;
      account.avatarUrl = nextAvatarUrl;
      account.wechatWork = nextWechatWork;
      account.updatedAt = now;
    }
    this.write(data);
    return account;
  }

  upsertWechatWorkBinding(payload: {
    openKfid: string;
    externalUserId: string;
    sendTime?: number;
    customerProfile?: { nickname?: string; avatar?: string };
  }) {
    const openKfid = String(payload.openKfid || "").trim();
    const externalUserId = String(payload.externalUserId || "").trim();
    if (!openKfid || !externalUserId) throw new Error("wechat work binding requires openKfid and externalUserId");
    const data = this.read();
    const now = new Date().toISOString();
    const incomingLastInboundAt = this.normalizeWechatWorkInboundAt(payload.sendTime);
    const bindingIndex = data.wechatWorkBindings.findIndex(
      (item) => item.openKfid === openKfid && item.externalUserId === externalUserId,
    );
    const current = bindingIndex >= 0 ? data.wechatWorkBindings[bindingIndex] : null;

    let account = current?.wechatAccountId
      ? data.wechatAccounts.find((item) => item.id === current.wechatAccountId) || null
      : null;
    account ||= data.wechatAccounts.find((item) => item.wechatWork?.openKfid === openKfid) || null;
    if (!account) {
      account = {
        id: id("wechat_work"),
        displayName: `企业微信客服 ${shortExternalId(openKfid)}`,
        alias: shortExternalId(openKfid),
        platform: "wechat_work_kf",
        isActive: true,
        wechatWork: { openKfid },
        createdAt: now,
        updatedAt: now,
      };
      data.wechatAccounts.push(account);
    } else if (account.wechatWork?.openKfid !== openKfid) {
      account.wechatWork = { ...(account.wechatWork || {}), openKfid };
      account.platform = account.platform || "wechat_work_kf";
      account.updatedAt = now;
    }

    let customer = current?.customerId
      ? data.customers.find((item) => item.id === current.customerId) || null
      : null;
    customer ||= data.customers.find((item) => item.wechatWorkExternalUserId === externalUserId) || null;
    const profileName = String(payload.customerProfile?.nickname || "").trim();
    const profileAvatar = String(payload.customerProfile?.avatar || "").trim();
    if (!customer) {
      customer = {
        id: id("customer"),
        name: profileName || `企业微信客户 ${shortExternalId(externalUserId)}`,
        wechatId: null,
        source: "wechat_work_kf",
        wechatWorkExternalUserId: externalUserId,
        avatarUrl: profileAvatar || null,
        tags: ["企业微信客服"],
        createdAt: now,
        updatedAt: now,
      };
      data.customers.push(customer);
    } else if (profileName || profileAvatar) {
      const previousName = String(customer.name || "");
      customer.name = profileName || customer.name;
      customer.avatarUrl = profileAvatar || customer.avatarUrl || null;
      customer.updatedAt = now;
      const linkedConversation = data.conversations.find((item) => item.id === current?.conversationId);
      if (linkedConversation && profileName && (
        linkedConversation.title === previousName
        || isWechatWorkPlaceholderName(linkedConversation.title)
      )) {
        linkedConversation.title = profileName;
        linkedConversation.updatedAt = now;
      }
    }

    const externalChatId = `wechat_work_kf:${openKfid}:${externalUserId}`;
    let conversation = current?.conversationId
      ? data.conversations.find((item) => item.id === current.conversationId) || null
      : null;
    conversation ||= data.conversations.find(
      (item) => item.wechatAccountId === account.id && item.externalChatId === externalChatId,
    ) || null;
    if (!conversation) {
      conversation = {
        id: id("conversation"),
        channel: "work_wechat",
        externalChatId,
        title: customer.name,
        customerId: customer.id,
        wechatAccountId: account.id,
        lastMessageAt: incomingLastInboundAt,
        manualLocked: false,
        wechatWork: { openKfid, externalUserId },
        createdAt: now,
        updatedAt: now,
      };
      conversation.identityBinding = this.validateConversationIdentity(data, conversation);
      data.conversations.push(conversation);
    }

    const binding = {
      id: current?.id || id("wechat_work_binding"),
      openKfid,
      externalUserId,
      wechatAccountId: account.id,
      customerId: customer.id,
      conversationId: conversation.id,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      lastInboundAt: this.monotonicWechatWorkInboundAt(current?.lastInboundAt, incomingLastInboundAt),
    };
    if (bindingIndex >= 0) data.wechatWorkBindings[bindingIndex] = binding;
    else data.wechatWorkBindings.push(binding);
    this.write(data);
    return { ...binding, wechatAccount: account, customer, conversation };
  }

  private normalizeWechatWorkInboundAt(sendTime?: number) {
    if (!sendTime) return null;
    const lastInboundAt = new Date(sendTime * 1000);
    if (Number.isNaN(lastInboundAt.getTime())) {
      throw new BadRequestException("wechat work binding sendTime is invalid");
    }
    return lastInboundAt.toISOString();
  }

  private monotonicWechatWorkInboundAt(current: unknown, incoming: string | null) {
    const currentValue = normalizeInstant(current);
    const incomingValue = normalizeInstant(incoming);
    if (!incomingValue) return currentValue;
    if (!currentValue) return incomingValue;
    return Date.parse(currentValue) >= Date.parse(incomingValue) ? currentValue : incomingValue;
  }

  getWechatWorkBinding(openKfid: string, externalUserId: string) {
    const data = this.read();
    const binding = data.wechatWorkBindings.find(
      (item) => item.openKfid === String(openKfid || "") && item.externalUserId === String(externalUserId || ""),
    );
    return binding ? this.hydrateWechatWorkBinding(data, binding) : null;
  }

  findWechatWorkBindingByIdentity(identity: IdentityListFilter = {}) {
    const data = this.read();
    const binding = data.wechatWorkBindings.find(
      (item) =>
        (!identity.wechatAccountId || item.wechatAccountId === identity.wechatAccountId) &&
        (!identity.conversationId || item.conversationId === identity.conversationId) &&
        (!identity.customerId || item.customerId === identity.customerId),
    );
    return binding ? this.hydrateWechatWorkBinding(data, binding) : null;
  }

  findMessageByExternalId(conversationId: string, externalId: string) {
    const data = this.read();
    return data.messages.find(
      (message) => message.conversationId === conversationId && message.externalId === externalId,
    ) || null;
  }

  recordWechatWorkAudit(payload: Record<string, unknown>) {
    const data = this.read();
    if (payload.id) {
      const existing = data.wechatWorkAuditLogs.find((item) => item.id === payload.id);
      if (existing) return existing;
    }
    const record = {
      id: id("wechat_work_audit"),
      ...payload,
      createdAt: payload.createdAt || new Date().toISOString(),
    };
    data.wechatWorkAuditLogs.push(record);
    if (data.wechatWorkAuditLogs.length > 2000) {
      const permanentCustomerEntries = data.wechatWorkAuditLogs
        .filter((item) => item.action === "customer_entry_generated" && item.status === "processed");
      const recentRecords = data.wechatWorkAuditLogs
        .filter((item) => !permanentCustomerEntries.includes(item))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, Math.max(0, 2000 - permanentCustomerEntries.length));
      data.wechatWorkAuditLogs = [...permanentCustomerEntries, ...recentRecords];
    }
    this.write(data);
    return record;
  }

  listWechatWorkAuditLogs(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 100), 500));
    return this.read().wechatWorkAuditLogs
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, safeLimit);
  }

  hasWechatWorkAuditMsgId(msgid: string) {
    return this.read().wechatWorkAuditLogs.some(
      (item) => item.msgid === msgid && isTerminalWechatWorkAudit(item),
    );
  }

  hasWechatWorkCallbackId(callbackId: string) {
    return this.read().wechatWorkAuditLogs.some(
      (item) =>
        item.callbackId === callbackId &&
        ["callback_accepted", "callback_ignored", "callback_duplicate"].includes(String(item.action || "")),
    );
  }

  countWechatWorkInboundFailures(msgid: string) {
    return this.read().wechatWorkAuditLogs.filter(
      (item) => item.msgid === msgid && item.action === "inbound_failed" && !isTerminalWechatWorkAudit(item),
    ).length;
  }

  getWechatWorkSyncCursor(openKfid: string) {
    const key = String(openKfid || "").trim();
    if (!key) return null;
    return this.read().wechatWorkSyncCursors.find((item) => item.openKfid === key) || null;
  }

  commitWechatWorkSyncCursor(payload: {
    openKfid: string;
    expectedCursor: string;
    nextCursor: string;
    terminalMessageCount?: number;
    batchFingerprint?: string;
  }) {
    const openKfid = String(payload.openKfid || "").trim();
    if (!openKfid) throw new Error("wechat work sync cursor requires openKfid");
    const data = this.read();
    const now = new Date().toISOString();
    const index = data.wechatWorkSyncCursors.findIndex((item) => item.openKfid === openKfid);
    const current = index >= 0 ? data.wechatWorkSyncCursors[index] : null;
    const actualCursor = String(current?.nextCursor || "");
    if (actualCursor !== String(payload.expectedCursor || "")) {
      throw new Error("wechat work sync cursor changed concurrently; refusing stale cursor commit");
    }
    const record = {
      id: current?.id || id("wechat_work_cursor"),
      openKfid,
      nextCursor: String(payload.nextCursor || ""),
      terminalMessageCount: Number(payload.terminalMessageCount || 0),
      batchFingerprint: String(payload.batchFingerprint || "") || null,
      committedAt: now,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    if (index >= 0) data.wechatWorkSyncCursors[index] = record;
    else data.wechatWorkSyncCursors.push(record);
    this.write(data);
    return record;
  }

  upsertPersonalWechatRpaBinding(payload: {
    wechatAccountId: string;
    accountNickname: string;
    ownerWxId: string;
    chatTitle: string;
    conversationType?: string;
    senderName?: string;
    receivedAt?: string;
  }) {
    const wechatAccountId = String(payload.wechatAccountId || "").trim();
    const accountNickname = String(payload.accountNickname || "").trim();
    const ownerWxId = String(payload.ownerWxId || "").trim();
    const chatTitle = String(payload.chatTitle || "").trim();
    const conversationType = String(payload.conversationType || "direct").trim().toLowerCase();
    if (!wechatAccountId || !accountNickname || !ownerWxId || !chatTitle) {
      throw new Error("personal WeChat RPA binding requires wechatAccountId, accountNickname, ownerWxId and chatTitle");
    }

    const data = this.read();
    const now = new Date().toISOString();
    const receivedAt = payload.receivedAt || now;
    const bindingKey = personalWechatRpaBindingKey(ownerWxId, chatTitle);
    const bindingIndex = data.personalWechatRpaBindings.findIndex((item) => item.bindingKey === bindingKey);
    const current = bindingIndex >= 0 ? data.personalWechatRpaBindings[bindingIndex] : null;

    const accountById = data.wechatAccounts.find((item) => item.id === wechatAccountId) || null;
    const accountByOwner = data.wechatAccounts.find(
      (item) => item.platform === "personal_wechat_rpa" && item.personalWechatRpa?.ownerWxId === ownerWxId,
    ) || null;
    if (accountByOwner && accountByOwner.id !== wechatAccountId) {
      throw new Error("personal WeChat RPA ownerWxId is already bound to another WeChat account");
    }
    let account = accountById || accountByOwner;
    if (!account) {
      account = {
        id: wechatAccountId,
        displayName: accountNickname,
        alias: ownerWxId,
        platform: "personal_wechat_rpa",
        isActive: true,
        personalWechatRpa: { ownerWxId, accountNickname },
        createdAt: now,
        updatedAt: now,
      };
      data.wechatAccounts.push(account);
    } else {
      const boundOwnerWxId = String(account.personalWechatRpa?.ownerWxId || "").trim();
      const boundNickname = String(account.personalWechatRpa?.accountNickname || account.displayName || "").trim();
      if (
        account.id !== wechatAccountId ||
        account.platform !== "personal_wechat_rpa" ||
        boundOwnerWxId !== ownerWxId ||
        boundNickname !== accountNickname
      ) {
        throw new Error("personal WeChat RPA registry account identity conflicts with the persisted WeChat account");
      }
      account.displayName = accountNickname;
      account.platform = "personal_wechat_rpa";
      account.personalWechatRpa = { ...(account.personalWechatRpa || {}), ownerWxId, accountNickname };
      account.updatedAt = now;
    }

    const sameTitleCollision = data.personalWechatRpaBindings.find(
      (item) =>
        item.wechatAccountId === wechatAccountId &&
        item.chatTitle === chatTitle &&
        item.bindingKey !== bindingKey,
    );
    if (sameTitleCollision) throw new Error("duplicate personal WeChat chat title requires manual rebind");
    if (
      current &&
      conversationType === "direct" &&
      current.senderName &&
      payload.senderName &&
      String(current.senderName).trim() !== String(payload.senderName).trim()
    ) {
      throw new Error("direct chat sender changed; duplicate chat title requires manual rebind");
    }

    let customer = current?.customerId
      ? data.customers.find((item) => item.id === current.customerId) || null
      : null;
    customer ||= data.customers.find((item) => item.personalWechatRpaBindingKey === bindingKey) || null;
    if (!customer) {
      customer = {
        id: id("customer"),
        name: chatTitle,
        wechatId: null,
        source: "personal_wechat_rpa",
        personalWechatRpaBindingKey: bindingKey,
        tags: [conversationType === "group" ? "个人微信群聊" : "个人微信好友"],
        createdAt: now,
        updatedAt: now,
      };
      data.customers.push(customer);
    } else if (customer.name !== chatTitle) {
      throw new Error("personal WeChat RPA chat title changed; manual rebind is required");
    }

    const externalChatId = `personal_wechat_rpa:${bindingKey}`;
    let conversation = current?.conversationId
      ? data.conversations.find((item) => item.id === current.conversationId) || null
      : null;
    conversation ||= data.conversations.find(
      (item) => item.wechatAccountId === account.id && item.externalChatId === externalChatId,
    ) || null;
    if (!conversation) {
      conversation = {
        id: id("conversation"),
        channel: "personal_wechat",
        externalChatId,
        title: chatTitle,
        customerId: customer.id,
        wechatAccountId: account.id,
        lastMessageAt: receivedAt,
        manualLocked: false,
        personalWechatRpa: { ownerWxId, chatTitle, conversationType },
        createdAt: now,
        updatedAt: now,
      };
      conversation.identityBinding = this.validateConversationIdentity(data, conversation);
      data.conversations.push(conversation);
    } else {
      if (conversation.title !== chatTitle) {
        throw new Error("personal WeChat RPA conversation title changed; manual rebind is required");
      }
      conversation.lastMessageAt = this.monotonicWechatWorkInboundAt(conversation.lastMessageAt, receivedAt);
      conversation.updatedAt = now;
      conversation.personalWechatRpa = {
        ...(conversation.personalWechatRpa || {}),
        ownerWxId,
        chatTitle,
        conversationType,
      };
    }

    const binding = {
      id: current?.id || id("personal_wechat_rpa_binding"),
      bindingKey,
      ownerWxId,
      accountNickname,
      chatTitle,
      conversationType,
      senderName: String(payload.senderName || current?.senderName || "").trim() || null,
      wechatAccountId: account.id,
      customerId: customer.id,
      conversationId: conversation.id,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      lastInboundAt: this.monotonicWechatWorkInboundAt(current?.lastInboundAt, receivedAt),
    };
    if (bindingIndex >= 0) data.personalWechatRpaBindings[bindingIndex] = binding;
    else data.personalWechatRpaBindings.push(binding);
    this.write(data);
    return { ...binding, wechatAccount: account, customer, conversation };
  }

  getPersonalWechatRpaBinding(ownerWxId: string, chatTitle: string) {
    const data = this.read();
    const bindingKey = personalWechatRpaBindingKey(ownerWxId, chatTitle);
    const binding = data.personalWechatRpaBindings.find((item) => item.bindingKey === bindingKey);
    return binding ? this.hydratePersonalWechatRpaBinding(data, binding) : null;
  }

  findPersonalWechatRpaBindingByIdentity(identity: IdentityListFilter = {}) {
    const data = this.read();
    const binding = data.personalWechatRpaBindings.find(
      (item) =>
        (!identity.wechatAccountId || item.wechatAccountId === identity.wechatAccountId) &&
        (!identity.conversationId || item.conversationId === identity.conversationId) &&
        (!identity.customerId || item.customerId === identity.customerId),
    );
    return binding ? this.hydratePersonalWechatRpaBinding(data, binding) : null;
  }

  listPersonalWechatRpaBindings(options: { wechatAccountId?: string; take?: number; cursor?: string } = {}) {
    const data = this.read();
    const take = Math.max(1, Math.min(Number(options.take || 500), 500));
    const sorted = data.personalWechatRpaBindings
      .filter((binding) => !options.wechatAccountId || binding.wechatAccountId === options.wechatAccountId)
      .map((binding) => this.hydratePersonalWechatRpaBinding(data, binding))
      .sort((a, b) => String(b.lastInboundAt || b.updatedAt).localeCompare(String(a.lastInboundAt || a.updatedAt)));
    const cursorIndex = options.cursor ? sorted.findIndex((item) => item.id === options.cursor) : -1;
    if (options.cursor && cursorIndex < 0) {
      throw new Error("pagination cursor does not belong to the authenticated WeChat account");
    }
    return sorted.slice(cursorIndex >= 0 ? cursorIndex + 1 : 0, (cursorIndex >= 0 ? cursorIndex + 1 : 0) + take);
  }

  recordPersonalWechatRpaAudit(payload: Record<string, unknown>) {
    const data = this.read();
    const record = {
      id: id("personal_wechat_rpa_audit"),
      ...payload,
      createdAt: payload.createdAt || new Date().toISOString(),
    };
    data.personalWechatRpaAuditLogs.push(record);
    if (data.personalWechatRpaAuditLogs.length > 2000) {
      data.personalWechatRpaAuditLogs = data.personalWechatRpaAuditLogs
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 2000);
    }
    this.write(data);
    return record;
  }

  listPersonalWechatRpaAuditLogs(input: number | { wechatAccountId?: string; take?: number; cursor?: string } = 100) {
    const options = typeof input === "number" ? { take: input } : input;
    const safeLimit = Math.max(1, Math.min(Number(options.take || 100), 500));
    const sorted = this.read().personalWechatRpaAuditLogs
      .filter((item) => !options.wechatAccountId || item.wechatAccountId === options.wechatAccountId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const cursorIndex = options.cursor ? sorted.findIndex((item) => item.id === options.cursor) : -1;
    if (options.cursor && cursorIndex < 0) {
      throw new Error("pagination cursor does not belong to the authenticated WeChat account");
    }
    return sorted.slice(cursorIndex >= 0 ? cursorIndex + 1 : 0, (cursorIndex >= 0 ? cursorIndex + 1 : 0) + safeLimit);
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

  updateConversationOperations(
    id: string,
    identity: { wechatAccountId: string; conversationId: string; customerId: string },
    patch: Record<string, unknown>,
    audit: {
      reviewer: string;
      note?: string;
      decision?: string;
      beforeStatus?: string;
      afterStatus?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    if (identity.conversationId !== id) throw new Error("conversation operations identity mismatch: conversationId");
    const data = this.read();
    const validatedIdentity = this.requireCompleteConversationIdentity(data, identity, "conversation operations update");
    const index = data.conversations.findIndex((conversation) => conversation.id === id);
    if (index < 0) throw new Error(`local conversation not found: ${id}`);
    const allowedFields = ["assignee", "priority", "status", "slaDueAt", "firstResponseDueAt"];
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowedFields.includes(key)));
    if (!Object.keys(safePatch).length) throw new Error("conversation operations update has no mutable fields");
    const now = new Date().toISOString();
    const next = {
      ...data.conversations[index],
      ...safePatch,
      updatedAt: now,
    };
    const reviewLog = this.buildReviewLogRecord(
      data,
      {
        targetType: "conversation",
        targetId: id,
        decision: audit.decision || "conversation_operations_update",
        reviewer: audit.reviewer,
        note: audit.note || "",
        beforeStatus: audit.beforeStatus || "",
        afterStatus: audit.afterStatus || "",
        metadata: {
          ...(audit.metadata || {}),
          wechatAccountId: validatedIdentity.wechatAccountId,
          conversationId: validatedIdentity.conversationId,
          customerId: validatedIdentity.customerId,
        },
      },
      now,
    );
    data.conversations[index] = next;
    data.reviewLogs.push(reviewLog);
    this.write(data);
    return { conversation: this.hydrateConversation(data, next), audit: reviewLog };
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
    const requestOperation = payload.externalId
      ? requestOperationMetadata(
          String(payload.externalId),
          createInboundMessageOperationFingerprint(payload || {}, {
            conversationId: conversation.id,
            customerId: conversation.customerId,
            wechatAccountId: conversation.wechatAccountId,
          }),
        )
      : null;
    const existing = payload.externalId
      ? data.messages.find(
          (message) => {
            if (message.externalId !== payload.externalId) return false;
            const storedConversation = data.conversations.find((item) => item.id === message.conversationId);
            return storedConversation?.wechatAccountId === conversation.wechatAccountId;
          },
        ) || null
      : null;
    if (existing) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existing.metadata),
        requestOperation!,
        "inbound message create",
      );
      assertStoredOperationIdentityReplay(
        {
          conversationId: existing.conversationId,
          customerId: existing.customerId,
          wechatAccountId: existing.wechatAccountId,
        },
        {
          conversationId: conversation.id,
          customerId: conversation.customerId,
          wechatAccountId: conversation.wechatAccountId,
        },
        "inbound message create",
      );
      return {
        ...existing,
        deduplicated: true,
        customerId: conversation.customerId || null,
        wechatAccountId: conversation.wechatAccountId || null,
        conversation: this.hydrateConversation(data, conversation),
      };
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
      metadata: {
        ...(payload.metadata || {}),
        ...(requestOperation ? { requestOperation } : {}),
      },
      readAt: payload.direction === "outbound" ? payload.readAt || now : payload.readAt || null,
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
      lastMessageAt: this.monotonicWechatWorkInboundAt(
        data.conversations[conversationIndex].lastMessageAt,
        record.createdAt,
      ),
      updatedAt: now,
    };
    this.write(data);
    return {
      ...record,
      conversation: this.hydrateConversation(data, data.conversations[conversationIndex]),
    };
  }

  claimInboundMessageOperation(payload: any) {
    const data = this.read();
    const wechatAccountId = String(payload?.wechatAccountId || "").trim();
    const externalId = String(payload?.externalId || "").trim();
    const requestFingerprint = String(payload?.requestFingerprint || "").trim();
    const source = String(payload?.source || "wechat").trim();
    const claimToken = String(payload?.claimToken || "").trim();
    const leaseExpiresAt = normalizeInstant(payload?.leaseExpiresAt);
    if (!wechatAccountId || !externalId || !requestFingerprint || !claimToken || !leaseExpiresAt) {
      throw new BadRequestException("inbound operation identity, fingerprint, claim token and lease are required");
    }
    const index = data.inboundMessageOperations.findIndex(
      (item) => item.wechatAccountId === wechatAccountId && item.externalId === externalId,
    );
    const now = new Date().toISOString();
    if (index >= 0) {
      const existing = data.inboundMessageOperations[index];
      if (existing.requestFingerprint !== requestFingerprint || existing.source !== source) {
        throw new BadRequestException("duplicate inbound externalId conflict: request fingerprint changed");
      }
      if (existing.status === "completed") return { operation: existing, claimed: false, completed: true };
      const leaseActive = existing.status === "processing" && Date.parse(String(existing.leaseExpiresAt || "")) > Date.now();
      if (leaseActive && existing.claimToken !== claimToken) {
        return { operation: existing, claimed: false, completed: false, inProgress: true };
      }
      const operation = {
        ...existing,
        status: "processing",
        claimToken,
        leaseExpiresAt,
        attemptCount: Number(existing.attemptCount || 0) + 1,
        lastError: null,
        updatedAt: now,
      };
      data.inboundMessageOperations[index] = operation;
      this.write(data);
      return { operation, claimed: true, completed: false };
    }
    const operation = {
      id: String(payload.id || deterministicOperationId("inbound", `${wechatAccountId}:${externalId}`)),
      source,
      wechatAccountId,
      externalId,
      requestFingerprint,
      normalizedPayload: payload.normalizedPayload || null,
      status: "processing",
      stage: "reserved",
      bindingKey: payload.bindingKey || null,
      customerId: null,
      conversationId: null,
      messageId: null,
      routeEvaluationId: null,
      sendTaskId: null,
      result: null,
      claimToken,
      leaseExpiresAt,
      attemptCount: 1,
      lastError: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    data.inboundMessageOperations.push(operation);
    this.write(data);
    return { operation, claimed: true, completed: false };
  }

  getInboundMessageOperation(wechatAccountId: string, externalId: string) {
    return this.read().inboundMessageOperations.find(
      (item) => item.wechatAccountId === String(wechatAccountId || "").trim() && item.externalId === String(externalId || "").trim(),
    ) || null;
  }

  updateInboundMessageOperation(id: string, claimToken: string, patch: any) {
    const data = this.read();
    const index = data.inboundMessageOperations.findIndex((item) => item.id === id);
    if (index < 0) throw new NotFoundException(`inbound operation not found: ${id}`);
    const current = data.inboundMessageOperations[index];
    if (
      current.status !== "processing" ||
      current.claimToken !== claimToken ||
      Date.parse(String(current.leaseExpiresAt || "")) <= Date.now()
    ) {
      throw new InboundLeaseLostError("inbound operation claim changed before stage commit");
    }
    const nextPatch = { ...patch };
    if ("stage" in nextPatch) {
      nextPatch.stage = monotonicInboundOperationStage(current.stage, nextPatch.stage);
    }
    const operation = { ...current, ...nextPatch, updatedAt: new Date().toISOString() };
    data.inboundMessageOperations[index] = operation;
    this.write(data);
    return operation;
  }

  renewInboundMessageOperationLease(id: string, claimToken: string, leaseExpiresAt: string) {
    const data = this.read();
    const index = data.inboundMessageOperations.findIndex((item) => item.id === id);
    if (index < 0) throw new NotFoundException(`inbound operation not found: ${id}`);
    const current = data.inboundMessageOperations[index];
    const now = Date.now();
    if (
      current.status !== "processing" ||
      current.claimToken !== claimToken ||
      !Number.isFinite(Date.parse(String(current.leaseExpiresAt || ""))) ||
      Date.parse(String(current.leaseExpiresAt)) <= now
    ) {
      throw new InboundLeaseLostError("inbound operation lease is no longer owned by this claim");
    }
    const nextLease = normalizeInstant(leaseExpiresAt);
    if (!nextLease || Date.parse(nextLease) <= now) {
      throw new BadRequestException("inbound operation lease renewal must expire in the future");
    }
    if (Date.parse(String(current.leaseExpiresAt)) >= Date.parse(nextLease) - INBOUND_LEASE_RENEWAL_WRITE_THRESHOLD_MS) {
      return current;
    }
    const operation = { ...current, leaseExpiresAt: nextLease, updatedAt: new Date(now).toISOString() };
    data.inboundMessageOperations[index] = operation;
    this.write(data);
    return operation;
  }

  commitInboundHighValueSelection(payload: {
    operationId: string;
    claimToken: string;
    leaseExpiresAt: string;
    designJobId: string;
    selectedImageId: string;
    feedback: string;
    recoveryEffect: Record<string, unknown>;
  }) {
    const data = this.read();
    const operationIndex = data.inboundMessageOperations.findIndex((item) => item.id === payload.operationId);
    if (operationIndex < 0) throw new NotFoundException(`inbound operation not found: ${payload.operationId}`);
    const operation = data.inboundMessageOperations[operationIndex];
    if (
      operation.status !== "processing" ||
      operation.claimToken !== payload.claimToken ||
      Date.parse(String(operation.leaseExpiresAt || "")) <= Date.now()
    ) {
      throw new InboundLeaseLostError("inbound operation lease changed before high-value selection commit");
    }
    const jobIndex = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (jobIndex < 0) throw new NotFoundException(`local design job not found: ${payload.designJobId}`);
    const selected = data.designImages.find(
      (image) => image.designJobId === payload.designJobId &&
        (image.id === payload.selectedImageId || image.imageId === payload.selectedImageId),
    );
    if (!selected) throw new NotFoundException(`design image not found in design job: ${payload.selectedImageId}`);
    for (const image of data.designImages) {
      if (image.designJobId !== payload.designJobId) continue;
      image.selected = image.id === payload.selectedImageId || image.imageId === payload.selectedImageId;
      if (image.selected) image.customerFeedback = payload.feedback;
    }
    const now = new Date().toISOString();
    data.designJobs[jobIndex] = {
      ...data.designJobs[jobIndex],
      status: "manual_review",
      manualQcRequired: true,
      updatedAt: now,
    };
    data.inboundMessageOperations[operationIndex] = {
      ...operation,
      result: { ...(operation.result || {}), recoveryEffect: payload.recoveryEffect },
      leaseExpiresAt: normalizeInstant(payload.leaseExpiresAt),
      updatedAt: now,
    };
    this.write(data);
    return this.hydrateDesignJob(data, data.designJobs[jobIndex]);
  }

  commitInboundLowValueSelection(payload: {
    operationId: string;
    claimToken: string;
    leaseExpiresAt: string;
    designJobId: string;
    selectedImageId: string;
    feedback: string;
    recoveryEffect: Record<string, unknown>;
    highValueAmountCny?: number;
    businessRiskControlsDisabled?: boolean;
  }) {
    return this.withStoreLock(() => {
    const data = this.read();
    const operationIndex = data.inboundMessageOperations.findIndex((item) => item.id === payload.operationId);
    if (operationIndex < 0) throw new NotFoundException(`inbound operation not found: ${payload.operationId}`);
    const operation = data.inboundMessageOperations[operationIndex];
    if (
      operation.status !== "processing" ||
      operation.claimToken !== payload.claimToken ||
      Date.parse(String(operation.leaseExpiresAt || "")) <= Date.now()
    ) {
      throw new InboundLeaseLostError("inbound operation lease changed before low-value selection commit");
    }
    const jobIndex = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (jobIndex < 0) throw new NotFoundException(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[jobIndex];
    if (
      String(job.wechatAccountId || "") !== String(operation.wechatAccountId || "") ||
      String(job.conversationId || "") !== String(operation.conversationId || "") ||
      String(job.customerId || "") !== String(operation.customerId || "")
    ) {
      throw new BadRequestException("low-value inbound selection design job identity changed before commit");
    }
    const selected = data.designImages.find(
      (image) => image.designJobId === payload.designJobId &&
        (image.id === payload.selectedImageId || image.imageId === payload.selectedImageId),
    );
    if (!selected) throw new NotFoundException(`design image not found in design job: ${payload.selectedImageId}`);
    const existingQuoteIndex = data.quoteDrafts.findIndex((item) => item.designJobId === payload.designJobId);
    const existingQuote = existingQuoteIndex >= 0 ? data.quoteDrafts[existingQuoteIndex] : null;
    if (existingQuote?.sendTaskId || existingQuote?.status === "sent") {
      throw new BadRequestException("low-value inbound selection quote changed before commit");
    }
    for (const image of data.designImages) {
      if (image.designJobId !== payload.designJobId) continue;
      image.selected = image.id === selected.id;
      if (image.selected) image.customerFeedback = payload.feedback;
    }
    const now = new Date().toISOString();
    let quote: any;
    if (existingQuote) {
      quote = {
        ...existingQuote,
        selectedImageId: selected.id,
        status: "auto_sent",
        customerNotes: "客户在会话中选择了这张效果图，系统已绑定为报价图片。",
        updatedAt: now,
      };
      quote.identityBinding = this.validateStoredQuoteDraftIdentity(data, quote);
      data.quoteDrafts[existingQuoteIndex] = quote;
    } else {
      const conversation = data.conversations.find((item) => item.id === job.conversationId) || null;
      const items = Array.isArray(job.bundle?.items) ? job.bundle.items : [];
      const totals = calculateTotals(items);
      const quantity = Number(job.budget?.quantity || 1);
      const totalPrice = totals.salePrice * quantity;
      const totalCost = totals.cost * quantity;
      const businessRiskDisabled = payload.businessRiskControlsDisabled === true;
      const highValueAmount = Number(payload.highValueAmountCny || 10000);
      const highValueQuote =
        !businessRiskDisabled && (
          job.isHighValue ||
          isHighValueBudget(job.budget, highValueAmount) ||
          (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
          (Number.isFinite(totals.salePrice) && totals.salePrice >= highValueAmount)
        );
      const bundleAutomationReady = businessRiskDisabled || inspectBundleAutomationReadiness(job.bundle || {}).ok;
      quote = {
        id: id("quote"),
        designJobId: job.id,
        customerId: job.customerId,
        selectedImageId: selected.id,
        quantity,
        unitPrice: totals.salePrice,
        totalPrice,
        totalCost,
        profit: totalPrice - totalCost,
        status: highValueQuote || !bundleAutomationReady ? "manual_review" : "auto_sent",
        paymentStatus: "unpaid",
        sendTaskId: null,
        customerNotes: "客户在会话中选择了这张效果图，系统已绑定为报价图片。",
        createdAt: now,
        updatedAt: now,
      };
      quote.identityBinding = this.validateQuoteDraftIdentity({ quoteDraft: quote, designJob: job, conversation, selectedImage: selected });
      data.quoteDrafts.push(quote);
    }
    data.designJobs[jobIndex] = { ...job, status: "quote_created", updatedAt: now };
    const recoveryEffect = { ...payload.recoveryEffect, quoteDraftId: quote.id };
    data.inboundMessageOperations[operationIndex] = {
      ...operation,
      result: { ...(operation.result || {}), recoveryEffect },
      leaseExpiresAt: normalizeInstant(payload.leaseExpiresAt),
      updatedAt: now,
    };
    this.write(data);
    return {
      designJob: this.hydrateDesignJob(data, data.designJobs[jobIndex]),
      quote: this.hydrateQuoteDraft(data, quote),
    };
    });
  }

  commitInboundQuoteAcceptance(payload: {
    operationId: string;
    claimToken: string;
    leaseExpiresAt: string;
    quoteDraftId: string;
    quotePatch: Record<string, unknown>;
    action: "accept_quote_and_create_order" | "update_existing_order_payment";
    orderDraftId?: string;
    orderPatch?: Record<string, unknown>;
    recoveryEffect: Record<string, unknown>;
  }) {
    return this.withStoreLock(() => {
    const data = this.read();
    const operationIndex = data.inboundMessageOperations.findIndex((item) => item.id === payload.operationId);
    if (operationIndex < 0) throw new NotFoundException(`inbound operation not found: ${payload.operationId}`);
    const operation = data.inboundMessageOperations[operationIndex];
    if (
      operation.status !== "processing" ||
      operation.claimToken !== payload.claimToken ||
      Date.parse(String(operation.leaseExpiresAt || "")) <= Date.now()
    ) {
      throw new InboundLeaseLostError("inbound operation lease changed before quote acceptance commit");
    }
    const quoteIndex = data.quoteDrafts.findIndex((item) => item.id === payload.quoteDraftId);
    if (quoteIndex < 0) throw new NotFoundException(`local quote draft not found: ${payload.quoteDraftId}`);
    const currentQuote = data.quoteDrafts[quoteIndex];
    const designJob = data.designJobs.find((item) => item.id === currentQuote.designJobId) || null;
    if (
      !designJob ||
      String(designJob.wechatAccountId || "") !== String(operation.wechatAccountId || "") ||
      String(designJob.conversationId || "") !== String(operation.conversationId || "") ||
      String(currentQuote.customerId || "") !== String(operation.customerId || "")
    ) {
      throw new BadRequestException("inbound quote acceptance identity changed before commit");
    }
    const now = new Date().toISOString();
    const quote = { ...currentQuote, ...payload.quotePatch, updatedAt: now };
    quote.identityBinding = this.validateStoredQuoteDraftIdentity(data, quote);
    data.quoteDrafts[quoteIndex] = quote;

    let order: any;
    if (payload.action === "update_existing_order_payment") {
      const orderIndex = data.orderDrafts.findIndex((item) => item.id === payload.orderDraftId);
      if (orderIndex < 0) throw new NotFoundException(`local order draft not found: ${payload.orderDraftId}`);
      const currentOrder = data.orderDrafts[orderIndex];
      if (currentOrder.quoteDraftId !== quote.id) {
        throw new BadRequestException("inbound quote acceptance order binding changed before commit");
      }
      order = { ...currentOrder, ...(payload.orderPatch || {}), updatedAt: now };
      order.identityBinding = this.validateStoredOrderDraftBinding(data, order);
      data.orderDrafts[orderIndex] = order;
    } else {
      const existingOrder = data.orderDrafts.find((item) => item.quoteDraftId === quote.id);
      if (existingOrder) throw new BadRequestException("inbound quote acceptance order changed before commit");
      const decision = buildOrderDraftFromQuote(this.hydrateQuoteDraft(data, quote));
      if (!decision.ok) {
        throw new BadRequestException(`quote cannot create order draft: ${decision.reason}`);
      }
      order = {
        id: id("order"),
        ...decision.orderDraft,
        quoteDraftId: quote.id,
        createdAt: now,
        updatedAt: now,
      };
      order.identityBinding = this.validateStoredOrderDraftBinding(data, order);
      data.orderDrafts.push(order);
    }
    const recoveryEffect = {
      ...payload.recoveryEffect,
      quoteDraftId: quote.id,
      orderDraftId: order.id,
    };
    data.inboundMessageOperations[operationIndex] = {
      ...operation,
      result: { ...(operation.result || {}), recoveryEffect },
      leaseExpiresAt: normalizeInstant(payload.leaseExpiresAt),
      updatedAt: now,
    };
    this.write(data);
    return {
      quote: this.hydrateQuoteDraft(data, quote),
      orderDraft: this.hydrateOrderDraft(data, order),
    };
    });
  }

  listConversationTimeline(filter: IdentityListFilter & { limit?: number }) {
    const data = this.read();
    const identity = this.requireCompleteConversationIdentity(data, filter, "message history");
    const limit = Math.max(1, Math.min(Number(filter.limit || 300), 500));
    const rpaMessageIds = new Set(
      data.personalWechatRpaAuditLogs
        .filter((item) => item.messageId)
        .map((item) => String(item.messageId)),
    );
    const messages = data.messages
      .filter((message) => message.conversationId === identity.conversationId)
      .filter((message) => isTrustedConversationMessage(message, rpaMessageIds))
      .map((message) => {
        const presentation = conversationTimelineMessagePresentation(message);
        return {
          ...message,
          source: "message",
          customerId: identity.customerId,
          wechatAccountId: identity.wechatAccountId,
          text: presentation.displayText,
          messageType: presentation.messageType,
          content: presentation.content,
          status: message.direction === "inbound" ? (message.readAt ? "read" : "unread") : "sent",
          attachments: normalizeConversationTimelineAttachments(message.attachments, message.readAt ? "read" : "received"),
        };
      });
    const outbound = data.sendTasks
      .filter((task) => task.conversationId === identity.conversationId)
      .filter((task) => !isSyntheticConversationText(task.payload?.text || task.payload?.textBeforeImages))
      .flatMap((task) => {
        const parts = conversationTimelineTaskParts(task.payload);
        const latestAttempt = data.sendAttempts
          .filter((attempt) => attempt.sendTaskId === task.id)
          .sort((left, right) => String(right.startedAt || right.createdAt || "").localeCompare(String(left.startedAt || left.createdAt || "")))[0];
        const base = {
          source: "send_task",
          sendTaskId: task.id,
          conversationId: identity.conversationId,
          customerId: identity.customerId,
          wechatAccountId: identity.wechatAccountId,
          direction: "outbound",
          status: task.status || "queued",
          errorMessage: task.errorMessage || "",
          createdAt: task.queuedAt || task.createdAt,
          updatedAt: task.updatedAt || task.createdAt,
          sentAt: task.sentAt || null,
          metadata: { kind: task.payload?.kind || "text", manualReply: task.payload?.source === "manual_reply" },
        };
        if (!parts.length) return [{
          ...base,
          id: `send-task:${task.id}`,
          text: String(task.payload?.text || task.payload?.textBeforeImages || ""),
          attachments: timelineTaskAttachments(task, data.designAssets),
        }];
        return parts.map((part, index) => {
          const partStatus = conversationTimelineTaskPartStatus(task.status, latestAttempt?.metadata, index);
          return {
            ...base,
            id: `send-task:${task.id}:${String(index + 1).padStart(2, "0")}`,
            text: part.text,
            messageType: part.messageType,
            content: part.content,
            status: partStatus,
            errorMessage: partStatus === "sent" ? "" : base.errorMessage,
            attachments: normalizeConversationTimelineAttachments(part.attachments, partStatus),
          };
        });
      });
    return [...messages, ...outbound]
      .sort((left, right) => {
        const byTime = String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
        return byTime || String(left.id || "").localeCompare(String(right.id || ""));
      })
      .slice(-limit);
  }

  markConversationMessagesRead(filter: IdentityListFilter) {
    const data = this.read();
    const identity = this.requireCompleteConversationIdentity(data, filter, "mark messages read");
    const readAt = new Date().toISOString();
    let updatedCount = 0;
    data.messages = data.messages.map((message) => {
      if (message.conversationId !== identity.conversationId || message.direction !== "inbound" || message.readAt) {
        return message;
      }
      updatedCount += 1;
      return { ...message, readAt };
    });
    if (updatedCount) this.write(data);
    return { ...identity, updatedCount, readAt };
  }

  private requireCompleteConversationIdentity(data: StoreData, filter: IdentityListFilter, label: string) {
    const missing = [
      !String(filter.wechatAccountId || "").trim() ? "wechatAccountId" : "",
      !String(filter.conversationId || "").trim() ? "conversationId" : "",
      !String(filter.customerId || "").trim() ? "customerId" : "",
    ].filter(Boolean);
    if (missing.length) throw new Error(`${label} requires complete conversation identity: ${missing.join(", ")}`);
    return this.validateOptionalConversationBinding(data, filter, label);
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
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    const sortedSnapshots = data.wechatWindowSnapshots
      .filter((snapshot) => !options.wechatAccountId || snapshot.wechatAccountId === options.wechatAccountId)
      .sort((a, b) => String(b.capturedAt || b.createdAt).localeCompare(String(a.capturedAt || a.createdAt)));
    if (options.conversationId || options.customerId) {
      return sortedSnapshots
        .map((snapshot) => this.hydrateWechatWindowSnapshot(data, snapshot))
        .filter((snapshot) => this.matchesIdentityFilter(snapshot, options))
        .slice(0, limit);
    }
    return sortedSnapshots.slice(0, limit).map((snapshot) => this.hydrateWechatWindowSnapshot(data, snapshot));
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
    const conversations = record.wechatAccountId
      ? data.conversations.filter((conversation) => conversation.wechatAccountId === record.wechatAccountId)
      : [];
    record.diagnostic =
      payload.diagnostic ||
      diagnoseWechatWindowSnapshot({
        snapshot: record,
        account,
        conversations,
      });
    data.wechatWindowSnapshots.push(record);
    pruneWechatWindowSnapshots(data);
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
    const requestedOperation = readRequestOperationMetadata(payload?.requirements);
    const requestedRequestId = String(payload?.requestId || "").trim();
    const existing = requestedRequestId
      ? data.designJobs.find((item) => item.requestId === requestedRequestId)
      : null;
    if (existing) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existing.requirements),
        requestedOperation || { key: requestedRequestId, fingerprint: "" },
        "local design job create",
      );
      return this.hydrateDesignJob(data, existing);
    }
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

  beginDesignJobSubmitOperation(payload: {
    designJobId: string;
    operationKey: string;
    requestFingerprint: string;
    operationIdentity: Record<string, unknown>;
  }) {
    const data = this.read();
    const operationOwner = data.designJobs.find((item) => item.submitOperationKey === payload.operationKey);
    if (operationOwner) return { job: this.hydrateDesignJob(data, operationOwner), created: false };
    const index = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (index < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[index];
    if (job.submitOperationKey) return { job: this.hydrateDesignJob(data, job), created: false };
    const now = new Date().toISOString();
    data.designJobs[index] = {
      ...job,
      submitOperationKey: payload.operationKey,
      submitRequestFingerprint: payload.requestFingerprint,
      submitOperationIdentity: payload.operationIdentity,
      submitDispatchStatus: "prepared",
      submitDispatchError: null,
      updatedAt: now,
    };
    this.write(data);
    return { job: this.hydrateDesignJob(data, data.designJobs[index]), created: true };
  }

  claimDesignJobCallback(payload: {
    designJobId: string;
    externalJobId: string;
    operationKey: string;
    requestFingerprint: string;
  }) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (index < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[index];
    if (job.callbackOperationKey) {
      if (job.callbackOperationKey !== payload.operationKey) {
        return { mode: "replay", job: this.hydrateDesignJob(data, job) };
      }
      if (job.callbackStatus === "failure_settled" && job.callbackRequestFingerprint === payload.requestFingerprint) {
        return { mode: "resume_failure", job: this.hydrateDesignJob(data, job) };
      }
      if (["processing", "retry_dispatching"].includes(job.callbackStatus)) {
        return {
          mode: localDesignCallbackClaimIsFresh(job.callbackClaimedAt) ? "in_progress" : "outcome_unknown",
          job: this.hydrateDesignJob(data, job),
        };
      }
      return { mode: "replay", job: this.hydrateDesignJob(data, job) };
    }
    if (
      String(job.externalJobId || "") !== payload.externalJobId
      || !["submitted", "generating"].includes(String(job.status || ""))
    ) {
      return { mode: "replay", job: this.hydrateDesignJob(data, job) };
    }
    const now = new Date().toISOString();
    data.designJobs[index] = {
      ...job,
      callbackOperationKey: payload.operationKey,
      callbackRequestFingerprint: payload.requestFingerprint,
      callbackStatus: "processing",
      callbackClaimedAt: now,
      callbackSettledAt: null,
      updatedAt: now,
    };
    this.write(data);
    return { mode: "claimed", job: this.hydrateDesignJob(data, data.designJobs[index]) };
  }

  settleDesignJobCallbackFailure(payload: {
    designJobId: string;
    externalJobId: string;
    operationKey: string;
    requestFingerprint: string;
    errorMessage: string;
  }) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (index < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[index];
    if (
      job.callbackOperationKey === payload.operationKey
      && job.callbackRequestFingerprint === payload.requestFingerprint
      && job.callbackStatus === "failure_settled"
    ) {
      const revision = latestActiveLocalDesignRevision(data, job.id, ["failed"]);
      return { settled: true, resumed: true, job: this.hydrateDesignJob(data, job), revision };
    }
    if (
      job.callbackOperationKey !== payload.operationKey
      || job.callbackRequestFingerprint !== payload.requestFingerprint
      || job.callbackStatus !== "processing"
      || String(job.externalJobId || "") !== payload.externalJobId
      || !["submitted", "generating"].includes(String(job.status || ""))
    ) {
      return { settled: false, resumed: false, job: this.hydrateDesignJob(data, job), revision: null };
    }
    const now = new Date().toISOString();
    const revisionIndex = latestActiveLocalDesignRevisionIndex(data, job.id);
    let revision = null;
    if (revisionIndex >= 0) {
      data.designRevisions[revisionIndex] = {
        ...data.designRevisions[revisionIndex],
        status: "failed",
        resultImageIds: [],
        errorMessage: payload.errorMessage,
        updatedAt: now,
      };
      revision = data.designRevisions[revisionIndex];
    }
    data.designJobs[index] = {
      ...job,
      status: "failed",
      errorMessage: payload.errorMessage,
      callbackStatus: "failure_settled",
      callbackSettledAt: now,
      updatedAt: now,
    };
    this.write(data);
    return { settled: true, resumed: false, job: this.hydrateDesignJob(data, data.designJobs[index]), revision };
  }

  beginDesignJobCallbackRetry(payload: { designJobId: string; operationKey: string; requestFingerprint: string }) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (index < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[index];
    if (
      job.callbackOperationKey !== payload.operationKey
      || job.callbackRequestFingerprint !== payload.requestFingerprint
      || job.callbackStatus !== "failure_settled"
      || job.status !== "failed"
    ) return { started: false, job: this.hydrateDesignJob(data, job) };
    const now = new Date().toISOString();
    data.designJobs[index] = { ...job, callbackStatus: "retry_dispatching", callbackClaimedAt: now, updatedAt: now };
    this.write(data);
    return { started: true, job: this.hydrateDesignJob(data, data.designJobs[index]) };
  }

  markDesignJobCallbackOutcomeUnknown(payload: { designJobId: string; operationKey: string }) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (index < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[index];
    if (job.callbackOperationKey !== payload.operationKey || !["processing", "retry_dispatching"].includes(job.callbackStatus)) {
      return this.hydrateDesignJob(data, job);
    }
    const now = new Date().toISOString();
    data.designJobs[index] = {
      ...job,
      status: "manual_review",
      manualQcRequired: true,
      errorMessage: "设计平台回调处理结果未知，禁止自动重放，必须人工核对。",
      callbackStatus: "outcome_unknown",
      callbackSettledAt: now,
      updatedAt: now,
    };
    this.write(data);
    return this.hydrateDesignJob(data, data.designJobs[index]);
  }

  commitDesignJobCallbackCompletion(payload: {
    designJobId: string;
    externalJobId: string;
    operationKey: string;
    requestFingerprint: string;
    status: string;
    completedAt: string;
    images: any[];
    resultImageIds: string[];
  }) {
    const data = this.read();
    const jobIndex = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (jobIndex < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[jobIndex];
    if (
      job.callbackOperationKey !== payload.operationKey
      || job.callbackRequestFingerprint !== payload.requestFingerprint
      || job.callbackStatus !== "processing"
      || String(job.externalJobId || "") !== payload.externalJobId
      || !["submitted", "generating"].includes(String(job.status || ""))
    ) return { committed: false, job: this.hydrateDesignJob(data, job) };
    const now = payload.completedAt;
    for (const image of payload.images) {
      const imageIndex = data.designImages.findIndex(
        (item) => item.designJobId === job.id && item.imageId === image.imageId,
      );
      const existing = imageIndex >= 0 ? data.designImages[imageIndex] : null;
      const record = {
        ...(existing || {}),
        id: existing?.id || id("image"),
        createdAt: existing?.createdAt || now,
        ...image,
        selected: typeof image.selected === "boolean" ? image.selected : Boolean(existing?.selected),
        customerFeedback: image.customerFeedback !== undefined ? image.customerFeedback : existing?.customerFeedback,
        designJobId: job.id,
      };
      if (imageIndex >= 0) data.designImages[imageIndex] = record;
      else data.designImages.push(record);
    }
    const revisionIndex = latestActiveLocalDesignRevisionIndex(data, job.id);
    if (revisionIndex >= 0) {
      data.designRevisions[revisionIndex] = {
        ...data.designRevisions[revisionIndex],
        status: "completed",
        resultImageIds: payload.resultImageIds,
        errorMessage: "",
        updatedAt: now,
      };
    }
    data.designJobs[jobIndex] = {
      ...job,
      status: payload.status,
      completedAt: now,
      callbackStatus: "settled",
      callbackSettledAt: now,
      updatedAt: now,
    };
    this.write(data);
    return { committed: true, job: this.hydrateDesignJob(data, data.designJobs[jobIndex]) };
  }

  cancelDesignJobIfCurrent(payload: { designJobId: string; status: string; externalJobId?: string | null }) {
    const data = this.read();
    const index = data.designJobs.findIndex((item) => item.id === payload.designJobId);
    if (index < 0) throw new Error(`local design job not found: ${payload.designJobId}`);
    const job = data.designJobs[index];
    if (
      String(job.status || "") !== payload.status
      || String(job.externalJobId || "") !== String(payload.externalJobId || "")
      || job.callbackStatus === "retry_dispatching"
    ) return { cancelled: false, job: this.hydrateDesignJob(data, job) };
    const now = new Date().toISOString();
    data.designJobs[index] = {
      ...job,
      status: "cancelled",
      ...(job.callbackStatus === "processing" || job.callbackStatus === "failure_settled"
        ? { callbackStatus: "rejected", callbackSettledAt: now }
        : {}),
      updatedAt: now,
    };
    this.write(data);
    return { cancelled: true, job: this.hydrateDesignJob(data, data.designJobs[index]) };
  }

  listDesignPlatformExecutions(filter: { designJobId?: string; status?: string; acceptanceStatus?: string } = {}) {
    return this.read()
      .designPlatformExecutions
      .filter((item) => !filter.designJobId || item.designJobId === filter.designJobId)
      .filter((item) => !filter.status || item.status === filter.status)
      .filter((item) => !filter.acceptanceStatus || item.acceptanceStatus === filter.acceptanceStatus)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  getDesignPlatformExecution(idOrKey: string) {
    return this.read().designPlatformExecutions.find(
      (item) => item.id === idOrKey || item.operationKey === idOrKey || item.externalJobId === idOrKey,
    ) || null;
  }

  beginDesignPlatformExecution(payload: any) {
    const data = this.read();
    const existing = data.designPlatformExecutions.find((item) => item.operationKey === payload.operationKey);
    if (existing) return { execution: existing, created: false };

    const job = data.designJobs.find((item) => item.id === payload.designJobId);
    if (!job) throw new Error(`local design job not found: ${payload.designJobId}`);
    if (job.status === "cancelled") throw new Error("cancelled design job cannot start a platform execution");
    const retryBlocker = data.designPlatformExecutions.find(
      (item) =>
        item.designJobId === job.id &&
        (["prepared", "dispatching", "generating", "cancel_requested", "outcome_unknown"].includes(item.status) ||
          (item.status === "completed" && !["accepted", "rejected"].includes(item.acceptanceStatus)) ||
          (item.status === "explicit_failed" &&
            !["refunded", "not_required", "credit_bypass"].includes(item.refundStatus))),
    );
    if (retryBlocker) {
      if (["prepared", "dispatching", "generating", "cancel_requested"].includes(retryBlocker.status)) {
        throw new Error("active design platform execution is still in progress; retry would risk duplicate generation and charging");
      }
      if (retryBlocker.status === "explicit_failed") {
        throw new Error("design platform refund outcome requires explicit manual verification before retry");
      }
      throw new Error("design platform execution outcome requires explicit manual resolution before retry");
    }

    const revision = payload.designRevisionId
      ? data.designRevisions.find((item) => item.id === payload.designRevisionId) || null
      : null;
    if (payload.designRevisionId && (!revision || revision.designJobId !== job.id)) {
      throw new Error("design platform execution revision binding invalid");
    }
    if (
      revision &&
      Number(revision.revisionNumber || 0) !== Number(job.revisionCount || 0) &&
      Number(revision.revisionNumber || 0) !== Number(job.revisionCount || 0) + 1
    ) {
      throw new Error("stale design revision cannot start a platform execution");
    }

    const now = new Date().toISOString();
    const execution = {
      id: id("design_execution"),
      operationKey: String(payload.operationKey),
      externalJobId: String(payload.externalJobId),
      requestId: String(payload.requestId),
      scopeKey: String(payload.scopeKey),
      adapter: String(payload.adapter || "art_image_local"),
      designJobId: job.id,
      designRevisionId: revision?.id || null,
      attemptNo: Number(payload.attemptNo),
      processRunId: String(payload.processRunId),
      status: "prepared",
      acceptanceStatus: "pending",
      refundStatus: "pending",
      imageCount: 0,
      images: null,
      refundSummary: null,
      errorCode: null,
      errorCategory: null,
      errorMessage: null,
      responseHttpStatus: null,
      dispatchedAt: null,
      acceptedAt: null,
      completedAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    data.designPlatformExecutions.push(execution);
    Object.assign(job, {
      externalJobId: execution.externalJobId,
      status: "submitted",
      submittedAt: now,
      errorMessage: "",
      ...(payload.retryCount !== undefined ? { retryCount: Number(payload.retryCount) } : {}),
      ...(payload.revisionNumber !== undefined ? { revisionCount: Number(payload.revisionNumber) } : {}),
      updatedAt: now,
    });
    if (revision) {
      Object.assign(revision, {
        externalJobId: execution.externalJobId,
        status: "submitted",
        ...(payload.revisionRetryCount !== undefined ? { retryCount: Number(payload.revisionRetryCount) } : {}),
        updatedAt: now,
      });
    }
    this.write(data);
    return { execution, created: true };
  }

  claimDesignPlatformExecution(executionId: string, processRunId: string) {
    const data = this.read();
    const execution = data.designPlatformExecutions.find((item) => item.id === executionId);
    if (!execution || execution.status !== "prepared" || execution.processRunId !== processRunId) return null;
    const job = data.designJobs.find(
      (item) => item.id === execution.designJobId && item.externalJobId === execution.externalJobId,
    );
    if (!job || job.status === "cancelled") return null;
    const now = new Date().toISOString();
    job.updatedAt = now;
    Object.assign(execution, { status: "dispatching", dispatchedAt: now, updatedAt: now });
    this.write(data);
    return execution;
  }

  takeoverPreparedDesignPlatformExecutions(processRunId: string, limit = 50) {
    const data = this.read();
    const now = new Date().toISOString();
    const claimed: any[] = [];
    for (const execution of data.designPlatformExecutions) {
      if (claimed.length >= limit) break;
      if (
        execution.status !== "prepared" ||
        execution.processRunId === processRunId
      ) continue;
      execution.processRunId = processRunId;
      execution.updatedAt = now;
      claimed.push(execution);
    }
    if (claimed.length) this.write(data);
    return claimed;
  }

  transitionDesignPlatformExecution(
    executionId: string,
    expected: { status?: string; acceptanceStatus?: string },
    patch: Record<string, unknown>,
    jobPatch?: Record<string, unknown>,
  ) {
    const data = this.read();
    const execution = data.designPlatformExecutions.find((item) => item.id === executionId);
    if (!execution) return null;
    if (expected.status && execution.status !== expected.status) return null;
    if (expected.acceptanceStatus && execution.acceptanceStatus !== expected.acceptanceStatus) return null;
    const job = data.designJobs.find((item) => item.id === execution.designJobId);
    if (!job) throw new Error(`local design job not found: ${execution.designJobId}`);
    if (jobPatch && (job.externalJobId !== execution.externalJobId || job.status === "cancelled")) return null;
    const now = new Date().toISOString();
    if (jobPatch) Object.assign(job, jobPatch, { updatedAt: now });
    Object.assign(execution, patch, { updatedAt: now });
    this.write(data);
    return execution;
  }

  commitAcceptedDesignPlatformExecution(payload: any) {
    const data = this.read();
    const execution = data.designPlatformExecutions.find((item) => item.id === payload.executionId);
    if (!execution || execution.status !== "completed" || execution.acceptanceStatus !== "accepting") {
      throw new Error("design platform execution is not accepting");
    }
    const job = data.designJobs.find((item) => item.id === execution.designJobId);
    if (!job || job.status === "cancelled" || job.externalJobId !== execution.externalJobId) {
      throw new Error("design platform acceptance job binding changed");
    }
    const revision = execution.designRevisionId
      ? data.designRevisions.find((item) => item.id === execution.designRevisionId) || null
      : null;
    if (
      execution.designRevisionId &&
      (!revision || revision.designJobId !== job.id || Number(revision.revisionNumber || 0) !== Number(job.revisionCount || 0))
    ) {
      throw new Error("design platform acceptance revision binding changed");
    }
    if (!execution.designRevisionId && Number(job.revisionCount || 0) !== 0) {
      throw new Error("initial design platform result became stale");
    }
    for (const image of payload.images || []) {
      const index = data.designImages.findIndex(
        (item) => item.designJobId === job.id && item.imageId === image.imageId,
      );
      const current = index >= 0 ? data.designImages[index] : null;
      const record = {
        ...(current || {}),
        id: current?.id || id("image"),
        createdAt: current?.createdAt || new Date().toISOString(),
        ...image,
        designJobId: job.id,
        selected: Boolean(current?.selected),
      };
      if (index >= 0) data.designImages[index] = record;
      else data.designImages.push(record);
    }
    const now = new Date().toISOString();
    if (revision) {
      Object.assign(revision, {
        status: "completed",
        resultImageIds: payload.resultImageIds || [],
        errorMessage: "",
        updatedAt: now,
      });
    }
    Object.assign(job, {
      status: payload.nextStatus,
      completedAt: now,
      errorMessage: "",
      updatedAt: now,
    });
    Object.assign(execution, {
      acceptanceStatus: "accepted",
      acceptedAt: now,
      resolvedAt: now,
      updatedAt: now,
    });
    this.write(data);
    return this.hydrateDesignJob(data, job);
  }

  recoverStaleDesignPlatformExecutions(processRunId: string, leaseCutoff: string) {
    const data = this.read();
    const now = new Date().toISOString();
    const recovered: any[] = [];
    for (const execution of data.designPlatformExecutions) {
      if (
        !["dispatching", "generating", "cancel_requested"].includes(execution.status) ||
        execution.processRunId === processRunId ||
        String(execution.updatedAt) >= leaseCutoff
      ) continue;
      const wasCancelled = execution.status === "cancel_requested";
      const job = data.designJobs.find((item) => item.id === execution.designJobId);
      if (
        !wasCancelled &&
        (!job || job.externalJobId !== execution.externalJobId || job.status === "cancelled")
      ) continue;
      const executionPatch = {
        status: "outcome_unknown",
        acceptanceStatus: wasCancelled ? "rejected" : "manual_review",
        refundStatus: "unknown",
        errorCode: wasCancelled ? "CANCELLED_EXECUTION_OUTCOME_UNKNOWN" : "PROCESS_RESTARTED_DURING_DISPATCH",
        errorCategory: wasCancelled ? "cancelled_late_outcome_unknown" : "process_restart_unknown",
        errorMessage: wasCancelled
          ? "cancelled design platform execution has no late outcome evidence after recovery lease"
          : "design platform generation may have been accepted before process restart",
        completedAt: now,
        ...(wasCancelled ? { resolvedAt: now } : {}),
        updatedAt: now,
      };
      if (!wasCancelled && job && job.externalJobId === execution.externalJobId && job.status !== "cancelled") {
        Object.assign(job, {
          status: "manual_review",
          manualQcRequired: true,
          errorMessage: "设计平台生成结果未知，必须人工核对扣费和出图结果，禁止普通重试。",
          updatedAt: now,
        });
      }
      Object.assign(execution, executionPatch);
      recovered.push(execution);
    }
    let resetAcceptance = false;
    for (const execution of data.designPlatformExecutions) {
      if (
        execution.status === "completed" &&
        execution.acceptanceStatus === "accepting" &&
        execution.processRunId !== processRunId &&
        String(execution.updatedAt) < leaseCutoff
      ) {
        execution.acceptanceStatus = "pending";
        execution.processRunId = processRunId;
        execution.updatedAt = now;
        resetAcceptance = true;
      }
    }
    if (recovered.length || resetAcceptance) this.write(data);
    return recovered;
  }

  requestDesignPlatformExecutionCancellation(externalJobId: string) {
    const data = this.read();
    const execution = data.designPlatformExecutions.find((item) => item.externalJobId === externalJobId);
    const now = new Date().toISOString();
    const job = execution
      ? data.designJobs.find((item) => item.id === execution.designJobId && item.externalJobId === execution.externalJobId)
      : data.designJobs.find((item) => item.externalJobId === externalJobId);
    if (job) Object.assign(job, { status: "cancelled", updatedAt: now });
    if (!execution) {
      if (job) this.write(data);
      return null;
    }
    if (execution.status === "prepared") {
      Object.assign(execution, {
        status: "cancelled",
        acceptanceStatus: "rejected",
        refundStatus: "not_required",
        imageCount: 0,
        images: [],
        errorCategory: "cancelled_before_dispatch",
        errorCode: "LOCAL_CANCELLED_BEFORE_DISPATCH",
        completedAt: now,
        resolvedAt: now,
        updatedAt: now,
      });
    } else if (["dispatching", "generating"].includes(execution.status)) {
      Object.assign(execution, {
        status: "cancel_requested",
        acceptanceStatus: "rejected",
        errorCategory: "cancel_requested",
        errorCode: "LOCAL_CANCEL_REQUESTED",
        updatedAt: now,
      });
    } else if (
      execution.status === "completed" &&
      ["pending", "accepting", "manual_review"].includes(execution.acceptanceStatus)
    ) {
      Object.assign(execution, {
        acceptanceStatus: "rejected",
        errorCategory: "cancelled_before_acceptance",
        errorCode: "LOCAL_CANCELLED_BEFORE_ACCEPTANCE",
        resolvedAt: now,
        updatedAt: now,
      });
    }
    this.write(data);
    return execution;
  }

  resolveUnknownDesignPlatformExecution(executionId: string, resolution: string, reviewer: string) {
    const data = this.read();
    const execution = data.designPlatformExecutions.find((item) => item.id === executionId);
    if (!execution || execution.status !== "outcome_unknown" || execution.resolvedAt) {
      throw new Error("only unresolved outcome_unknown execution can be resolved");
    }
    if (resolution !== "confirmed_not_generated_refunded" || !String(reviewer || "").trim()) {
      throw new Error("explicit confirmed_not_generated_refunded resolution and reviewer are required");
    }
    const now = new Date().toISOString();
    Object.assign(execution, {
      status: "explicit_failed",
      acceptanceStatus: "manual_review",
      refundStatus: "refunded",
      refundSummary: mergeLocalRefundResolution(execution.refundSummary, resolution, reviewer),
      resolvedAt: now,
      updatedAt: now,
    });
    this.write(data);
    return execution;
  }

  resolveUnsafeDesignPlatformRefund(executionId: string, resolution: string, reviewer: string) {
    const data = this.read();
    const execution = data.designPlatformExecutions.find((item) => item.id === executionId);
    const resumableCompleted = execution?.status === "completed" && execution?.acceptanceStatus === "manual_review";
    if (
      !execution ||
      (execution.status !== "explicit_failed" && !resumableCompleted) ||
      !["failed", "unknown"].includes(execution.refundStatus)
    ) {
      throw new Error("only an eligible unsafe refund can be resolved");
    }
    if (resolution !== "confirmed_refunded" || !String(reviewer || "").trim()) {
      throw new Error("explicit confirmed_refunded resolution and reviewer are required");
    }
    const now = new Date().toISOString();
    Object.assign(execution, {
      refundStatus: "refunded",
      ...(resumableCompleted ? { acceptanceStatus: "pending" } : {}),
      refundSummary: mergeLocalRefundResolution(execution.refundSummary, resolution, reviewer),
      resolvedAt: resumableCompleted ? null : now,
      updatedAt: now,
    });
    this.write(data);
    return execution;
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
      const existing = index >= 0 ? data.designImages[index] : null;
      const record = {
        ...(existing || {}),
        id: existing?.id || id("image"),
        createdAt: existing?.createdAt || new Date().toISOString(),
        ...image,
        selected: typeof image.selected === "boolean" ? image.selected : Boolean(existing?.selected),
        customerFeedback:
          image.customerFeedback !== undefined ? image.customerFeedback : existing?.customerFeedback,
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
    if (payload.operationKey) {
      const existing = data.designRevisions.find((item) => item.operationKey === payload.operationKey);
      if (existing) return existing;
    }
    const numberOwner = data.designRevisions.find(
      (item) => item.designJobId === payload.designJobId && Number(item.revisionNumber) === Number(payload.revisionNumber),
    );
    if (numberOwner) throw Object.assign(new Error("design revision number changed concurrently"), { code: "P2002" });
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
      retryCount: Number(payload.retryCount || 0),
      chargeRequired: Boolean(payload.chargeRequired),
      manualReviewRequired: Boolean(payload.manualReviewRequired),
      externalJobId: payload.externalJobId || null,
      operationKey: payload.operationKey || null,
      requestFingerprint: payload.requestFingerprint || null,
      operationIdentity: payload.operationIdentity || null,
      externalRequestId: payload.externalRequestId || null,
      dispatchStatus: payload.dispatchStatus || null,
      dispatchError: payload.dispatchError || null,
      waitMessageSentAt: payload.waitMessageSentAt || null,
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
      (item) => item.id === idOrExternalJobId || item.externalJobId === idOrExternalJobId || item.externalRequestId === idOrExternalJobId,
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
    const effectKey = String(target?.effectKey || "").trim();
    const identity = this.resolveTargetIdentity(data, target || {}, "notification target");
    const normalizedTarget = {
      ...(target || {}),
      ...identity.identityFields,
      identityBinding: identity.binding,
    };
    if (effectKey) {
      const existing = data.notifications.find((notification) => String(notification?.target?.effectKey || "") === effectKey);
      if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target: normalizedTarget });
    }
    const record = {
      id: effectKey ? deterministicOperationId("notice", effectKey) : id("notice"),
      level,
      title,
      body,
      target: normalizedTarget,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    data.notifications.push(record);
    this.write(data);
    return record;
  }

  getNotification(id: string) {
    return this.read().notifications.find((notification) => notification.id === id) || null;
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

  listChatImports(filter: IdentityListFilter = {}) {
    return this.read()
      .chatImports
      .filter((chatImport) => this.matchesIdentityFilter(chatImport, filter))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  listTrainingSamples(filter: string | ({ agentId?: string } & IdentityListFilter) = {}) {
    const data = this.read();
    const options = typeof filter === "string" ? { agentId: filter } : filter;
    return data.trainingSamples
      .filter((sample) => !options.agentId || sample.agentId === options.agentId)
      .map((sample) => this.decorateTrainingSample(sample))
      .filter((sample) => this.matchesIdentityFilter(sample, options))
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
    const reviewedSceneCheck = buildReviewedSceneCheck(status, before, patch);
    const changedFields = buildTrainingSampleChangedFields(before, {
      ...before,
      ...patch,
      status,
      sceneCheck: reviewedSceneCheck,
    });
    const reviewOperation = buildLocalReviewOperation(
      "training-sample-review",
      sampleId,
      payload,
      "training sample review operationKey",
    );
    const existingReviewLog = reviewOperation ? findLocalReviewLogByEffectKey(data, reviewOperation.effectKey) : null;
    if (existingReviewLog) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existingReviewLog.metadata),
        reviewOperation!.operation,
        "training sample review",
      );
      return { sample: this.decorateTrainingSample(data.trainingSamples[index]), reviewLog: existingReviewLog };
    }
    const sample = {
      ...before,
      ...patch,
      status,
      sceneCheck: reviewedSceneCheck,
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
    refreshChatImportSceneSummary(data, sample.importId, now);
    for (const entry of data.knowledgeEntries.filter((item) => item.sourceId === sample.id)) {
      entry.agentId = sample.agentId;
      entry.title = `${sample.scene || "未分类"}：${String(sample.customerText || "").slice(0, 28)}`;
      entry.content = `客户：${sample.customerText}\n客服：${sample.idealReply}`;
      entry.tags = [sample.scene, sample.agentKey, ...(sample.skillHints || [])].filter(Boolean);
      entry.qualityScore = sample.score;
      entry.status = status;
      entry.reviewer = reviewer;
      entry.reviewNote = note;
      entry.reviewedAt = now;
      entry.reviewHistory = appendKnowledgeReviewHistory(entry.reviewHistory, { status, reviewer, note, reviewedAt: now });
      entry.updatedAt = now;
    }

    const log = {
      id: reviewOperation ? deterministicOperationId("review", reviewOperation.effectKey) : id("review"),
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
        ...(reviewOperation ? { effectKey: reviewOperation.effectKey, requestOperation: reviewOperation.operation } : {}),
      },
      createdAt: now,
    };
    data.reviewLogs.push(log);

    this.write(data);
    return { sample: this.decorateTrainingSample(sample), reviewLog: log };
  }

  listKnowledgeEntries(filter: string | ({ agentId?: string; includeReview?: boolean } & IdentityListFilter) = {}) {
    const data = this.read();
    const options = typeof filter === "string" ? { agentId: filter } : filter;
    const includeReview = Boolean(options.includeReview);
    return data.knowledgeEntries
      .filter((entry) => {
        const sample = entry.sourceId ? data.trainingSamples.find((item) => item.id === entry.sourceId) : null;
        return includeReview || !sample || isTrainingSampleReady(sample);
      })
      .filter((entry) => includeReview || normalizeKnowledgeEntryStatus(entry, data) === "ready")
      .filter((entry) => !localStoreIsSceneClarificationKnowledgeEntry(data, entry))
      .filter((entry) => !options.agentId || entry.agentId === options.agentId)
      .filter((entry) => this.matchesKnowledgeIdentityFilter(entry, options))
      .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0));
  }

  getWechatWorkAuditLog(idValue: string) {
    const recordId = String(idValue || "").trim();
    if (!recordId) return null;
    return this.read().wechatWorkAuditLogs.find((item) => item.id === recordId) || null;
  }

  reviewKnowledgeEntry(entryId: string, payload: any = {}) {
    const data = this.read();
    const index = data.knowledgeEntries.findIndex((entry) => entry.id === entryId);
    if (index < 0) throw new NotFoundException(`knowledge entry not found: ${entryId}`);
    const before = data.knowledgeEntries[index];
    const status = normalizeKnowledgeReviewStatus(payload.status);
    const now = new Date().toISOString();
    const reviewer = String(payload.reviewer || "operator").trim() || "operator";
    const note = String(payload.note || knowledgeReviewNote(status)).trim();
    const agent = payload.agentId || payload.agentKey ? resolveKnowledgeReviewAgent(data, payload) : null;
    if ((payload.agentId || payload.agentKey) && !agent) {
      throw new BadRequestException(`knowledge entry agent not found: ${payload.agentId || payload.agentKey}`);
    }
    const reviewOperation = buildLocalReviewOperation(
      "knowledge-entry-review",
      entryId,
      payload,
      "knowledge entry review operationKey",
    );
    const existingReviewLog = reviewOperation ? findLocalReviewLogByEffectKey(data, reviewOperation.effectKey) : null;
    if (existingReviewLog) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existingReviewLog.metadata),
        reviewOperation!.operation,
        "knowledge entry review",
      );
      return { knowledgeEntry: data.knowledgeEntries[index], reviewLog: existingReviewLog };
    }
    const existingAgent = before.agentId ? data.agents.find((item) => item.id === before.agentId) : null;
    const effectiveAgent = agent || existingAgent || null;
    const updated = {
      ...before,
      ...(agent ? { agentId: agent.id } : {}),
      ...(payload.title !== undefined ? { title: String(payload.title || "").trim() || before.title } : {}),
      ...(payload.content !== undefined ? { content: String(payload.content || "").trim() || before.content } : {}),
      ...(payload.tags !== undefined ? { tags: normalizeKnowledgeImportTags(payload.tags, effectiveAgent?.key) } : {}),
      ...(payload.qualityScore !== undefined ? { qualityScore: clampKnowledgeScore(payload.qualityScore, before.qualityScore) } : {}),
      status,
      reviewer,
      reviewNote: note,
      reviewedAt: now,
      reviewHistory: appendKnowledgeReviewHistory(before.reviewHistory, { status, reviewer, note, reviewedAt: now }),
      updatedAt: now,
    };
    assertKnowledgeEntryReadyForReview(updated, status);
    data.knowledgeEntries[index] = updated;
    const log = {
      id: reviewOperation ? deterministicOperationId("review", reviewOperation.effectKey) : id("review"),
      targetType: "knowledge_entry",
      targetId: updated.id,
      decision: status === "ready" ? "approve_knowledge_entry" : status === "rejected" ? "reject_knowledge_entry" : "mark_knowledge_entry_review",
      reviewer,
      note,
      beforeStatus: normalizeKnowledgeEntryStatus(before, data),
      afterStatus: status,
      metadata: {
        source: "knowledge_entry_review",
        sourceType: updated.sourceType,
        sourceId: updated.sourceId,
        agentId: updated.agentId,
        customerId: updated.customerId,
        conversationId: updated.conversationId,
        wechatAccountId: updated.wechatAccountId,
        ...(reviewOperation ? { effectKey: reviewOperation.effectKey, requestOperation: reviewOperation.operation } : {}),
      },
      createdAt: now,
    };
    data.reviewLogs.push(log);
    this.write(data);
    return { knowledgeEntry: updated, reviewLog: log };
  }

  importKnowledgeEntries(rows: any[] = [], context: any = {}) {
    const data = this.read();
    const now = new Date().toISOString();
    const identity = this.validateOptionalConversationBinding(data, context, "knowledge import");
    const source = String(context.source || "manual_knowledge_import").trim() || "manual_knowledge_import";
    const operationKey = context.operationKey ? normalizeOperationKey(context.operationKey, "knowledge import operationKey") : "";
    const importOperation = operationKey
      ? buildLocalKnowledgeImportOperation(operationKey, identity, source, rows)
      : null;
    const existingImportLog = importOperation ? findLocalReviewLogByEffectKey(data, importOperation.effectKey) : null;
    if (existingImportLog) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existingImportLog.metadata),
        importOperation!.operation,
        "knowledge import",
      );
      const importedIds = Array.isArray(existingImportLog.metadata?.knowledgeEntryIds)
        ? existingImportLog.metadata.knowledgeEntryIds.map((item: unknown) => String(item || "").trim()).filter(Boolean)
        : [];
      const replayedResults = importedIds
        .map((entryId: string) => data.knowledgeEntries.find((entry) => entry.id === entryId))
        .filter(Boolean);
      return {
        count: replayedResults.length,
        results: replayedResults,
        skipped: Array.isArray(existingImportLog.metadata?.skipped) ? existingImportLog.metadata.skipped : [],
        reviewLog: existingImportLog,
        failed: String(existingImportLog.afterStatus || "") === "failed",
      };
    }
    const results: any[] = [];
    const skipped: any[] = [];
    for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
      const agent = resolveKnowledgeImportAgent(data, row);
      if ((row.agentId || row.agentKey) && !agent) {
        skipped.push({ index, title: row.title, reason: "agent_not_found" });
        continue;
      }
      const entryId = operationKey ? deterministicOperationId("knowledge_manual", operationKey, index) : id("knowledge");
      const existingIndex = data.knowledgeEntries.findIndex((entry) => entry.id === entryId);
      let entry = {
        id: entryId,
        agentId: agent?.id || null,
        sourceType: "manual_knowledge_import",
        sourceId: source,
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        wechatAccountId: identity.wechatAccountId,
        identityBinding: identity.binding,
        title: String(row.title || "").trim(),
        content: String(row.content || "").trim(),
        tags: normalizeKnowledgeImportTags(row.tags, agent?.key),
        qualityScore: Number.isFinite(Number(row.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(row.qualityScore)))) : 70,
        status: "review",
        reviewer: null,
        reviewNote: "manual knowledge import requires human review before reply use",
        reviewedAt: null,
        reviewHistory: [],
        createdAt: existingIndex >= 0 ? data.knowledgeEntries[existingIndex].createdAt || now : now,
        updatedAt: now,
      };
      if (existingIndex >= 0) entry = preserveKnowledgeImportReviewState(data.knowledgeEntries[existingIndex], entry);
      if (existingIndex >= 0) data.knowledgeEntries[existingIndex] = entry;
      else data.knowledgeEntries.push(entry);
      results.push(entry);
    }
    let reviewLog: any = null;
    if (results.length || skipped.length) {
      const failed = results.length === 0;
      reviewLog = {
        id: importOperation ? deterministicOperationId("review", importOperation.effectKey) : id("review"),
        targetType: "knowledge_import",
        targetId: operationKey || results[0]?.id || `failed:${source}:${now}`,
        decision: failed ? "import_manual_knowledge_failed" : "import_manual_knowledge",
        reviewer: "operator",
        note: failed
          ? `Manual knowledge import from ${source} did not save any entries; fix skipped rows and retry.`
          : `Imported ${results.length} manual knowledge entries from ${source}; low score entries still need review before skill application.`,
        beforeStatus: "",
        afterStatus: failed ? "failed" : "imported",
        metadata: {
          source,
          count: results.length,
          skippedCount: skipped.length,
          skipped,
          ...(failed ? { failure: { phase: "write_failed", reason: "no_importable_rows" } } : {}),
          knowledgeEntryIds: results.map((entry) => entry.id),
          customerId: identity.customerId,
          conversationId: identity.conversationId,
          wechatAccountId: identity.wechatAccountId,
          ...(importOperation ? { effectKey: importOperation.effectKey, requestOperation: importOperation.operation } : {}),
        },
        createdAt: now,
      };
      data.reviewLogs.push(reviewLog);
    }
    this.write(data);
    return { count: results.length, results, skipped, ...(reviewLog ? { reviewLog, failed: results.length === 0 } : {}) };
  }

  recordKnowledgeImportFailure(parsed: any = {}, context: any = {}) {
    const data = this.read();
    const now = new Date().toISOString();
    const identity = this.validateOptionalConversationBinding(data, context, "knowledge import failure");
    const source = String(context.source || "manual_knowledge_import").trim() || "manual_knowledge_import";
    const operationKey = context.operationKey ? normalizeOperationKey(context.operationKey, "knowledge import operationKey") : "";
    const importOperation = operationKey
      ? buildLocalKnowledgeImportFailureOperation(operationKey, identity, source, parsed, context.phase || "parse_failed")
      : null;
    const existingImportLog = importOperation ? findLocalReviewLogByEffectKey(data, importOperation.effectKey) : null;
    if (existingImportLog) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existingImportLog.metadata),
        importOperation!.operation,
        "knowledge import failure",
      );
      return existingImportLog;
    }
    const failure = normalizeKnowledgeImportFailure(parsed, context.phase || "parse_failed");
    const log = {
      id: importOperation ? deterministicOperationId("review", importOperation.effectKey) : id("review"),
      targetType: "knowledge_import",
      targetId: operationKey || `failed:${source}:${now}`,
      decision: "import_manual_knowledge_failed",
      reviewer: "operator",
      note: `Manual knowledge import from ${source} failed before saving entries; fix the source file and retry.`,
      beforeStatus: "",
      afterStatus: "failed",
      metadata: {
        source,
        count: 0,
        skippedCount: failure.errors.length,
        skipped: failure.errors,
        failure,
        knowledgeEntryIds: [],
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        wechatAccountId: identity.wechatAccountId,
        ...(importOperation ? { effectKey: importOperation.effectKey, requestOperation: importOperation.operation } : {}),
      },
      createdAt: now,
    };
    data.reviewLogs.push(log);
    this.write(data);
    return log;
  }

  listRouteEvaluations(filter: IdentityListFilter = {}) {
    const data = this.read();
    return data.routeEvaluations
      .map((route) => ({
        ...route,
        agent: data.agents.find((agent) => agent.id === route.agentId) || null,
      }))
      .filter((route) => this.matchesIdentityFilter(route, filter))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  createRouteEvaluation(payload: any, result: any) {
    const data = this.read();
    const now = new Date().toISOString();
    const operationKey = String(payload?.operationKey || "").trim();
    const routeId = operationKey ? deterministicOperationId("route", operationKey) : id("route");
    const existing = operationKey ? data.routeEvaluations.find((route) => route.id === routeId) : null;
    if (existing) {
      if (
        String(existing.conversationId || "") !== String(payload.conversationId || "") ||
        String(existing.customerId || "") !== String(payload.customerId || "") ||
        String(existing.text || "") !== String(payload.text || "")
      ) {
        throw new BadRequestException("inbound route operation replay changed identity or text");
      }
      return { ...existing, agent: data.agents.find((item) => item.id === existing.agentId) || null };
    }
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
      id: routeId,
      operationKey: operationKey || null,
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
      routingPolicy: result.routingPolicy || null,
      suggestedReply: result.suggestedReply,
      appliedSkills: result.appliedSkills || [],
      knowledgeMatches: result.knowledgeMatches || [],
      replyDraft: result.replyDraft || null,
      learningInsight: result.learningInsight || buildConversationLearningInsight({
        text: payload.text || "",
        route: result,
        messageId: payload.messageId || null,
        observedAt: now,
      }),
      conversionAssessment: result.conversionAssessment || null,
      createdAt: now,
      updatedAt: now,
    };
    data.routeEvaluations.push(record);
    this.write(data);
    return { ...record, agent: agent || null };
  }

  listAgentTasks(filter: IdentityListFilter & { status?: string; limit?: number } = {}) {
    const status = String(filter.status || "").trim();
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 500));
    const data = this.read();
    return data.agentTasks
      .filter((task) => this.matchesIdentityFilter(task, filter))
      .filter((task) => !status || String(task.status || "") === status)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, limit)
      .map((task) => this.hydrateAgentTask(data, task));
  }

  getAgentTask(taskId: string) {
    const data = this.read();
    const task = data.agentTasks.find((item) => item.id === String(taskId || ""));
    return task ? this.hydrateAgentTask(data, task) : null;
  }

  createAgentTask(payload: any = {}) {
    const data = this.read();
    const operationKey = normalizeOperationKey(payload.operationKey || payload.id || "agent-task", "agent task operationKey");
    const taskId = String(payload.id || deterministicOperationId("agent_task", operationKey));
    const existing = data.agentTasks.find((task) => task.id === taskId || task.operationKey === operationKey);
    if (existing) {
      if (String(existing.operationKey || "") !== operationKey) {
        throw new BadRequestException(`agent task replay changed operationKey: ${operationKey}`);
      }
      assertAgentTaskReplay(existing, payload, operationKey);
      return this.hydrateAgentTask(data, existing);
    }
    const now = new Date().toISOString();
    const record = {
      id: taskId,
      operationKey,
      status: String(payload.status || "created"),
      taskType: String(payload.taskType || "customer_service"),
      lane: payload.lane || null,
      routeAction: payload.routeAction || null,
      planType: payload.planType || null,
      reason: payload.reason || null,
      objective: payload.objective || null,
      wechatAccountId: payload.identity?.wechatAccountId || payload.wechatAccountId || null,
      conversationId: payload.identity?.conversationId || payload.conversationId || null,
      customerId: payload.identity?.customerId || payload.customerId || null,
      routeId: payload.createdFrom?.routeId || payload.routeId || null,
      inboundMessageId: payload.createdFrom?.inboundMessageId || payload.inboundMessageId || null,
      currentStep: payload.nextStep || payload.currentStep || null,
      payload: payload.payload || payload,
      handoff: payload.handoff || null,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    data.agentTasks.push(record);
    for (const step of Array.isArray(payload.steps) ? payload.steps : []) {
      data.agentTaskSteps.push({
        id: deterministicOperationId("agent_step", `${taskId}:${String(step.key || "step")}`),
        taskId,
        stepKey: String(step.key || "step"),
        status: String(step.status || "planned"),
        mode: step.mode || null,
        toolName: step.tool || step.toolName || null,
        idempotencyKey: step.idempotencyKey || null,
        input: step.input || null,
        output: step.output || null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const toolName = String(step.tool || step.toolName || "").trim();
      if (toolName) {
        const definition = getToolDefinition(toolName) || {};
        const toolOperationKey = `${operationKey}:${String(step.key || "step")}:tool`;
        data.agentTaskToolExecutions.push({
          id: deterministicOperationId("agent_tool_execution", toolOperationKey),
          taskId,
          stepKey: String(step.key || "step"),
          operationKey: toolOperationKey,
          toolName,
          toolVersion: String(definition.version || "1"),
          effect: String(definition.effect || "unknown"),
          capability: definition.requiredCapability || null,
          status: String(step.status || "planned") === "completed" ? "succeeded" : "planned",
          idempotencyKey: step.idempotencyKey || null,
          input: step.input || null,
          output: step.output || null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (record.status === "awaiting_approval") {
      data.agentTaskApprovals.push({
        id: deterministicOperationId("agent_approval", taskId),
        taskId,
        status: "pending",
        policy: String(payload.approvalPolicy || payload.approval?.policy || "human"),
        requestedBy: String(payload.approval?.requestedBy || "agent"),
        reviewer: null,
        decisionNote: null,
        metadata: payload.approval?.metadata || { reason: record.reason, lane: record.lane },
        requestedAt: now,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.write(data);
    return this.hydrateAgentTask(data, record);
  }

  updateAgentTask(taskId: string, patch: any = {}) {
    const data = this.read();
    const index = data.agentTasks.findIndex((task) => task.id === String(taskId || ""));
    if (index < 0) throw new NotFoundException(`agent task not found: ${taskId}`);
    const current = data.agentTasks[index];
    const next = {
      ...current,
      ...patch,
      id: current.id,
      operationKey: current.operationKey,
      updatedAt: new Date().toISOString(),
    };
    if (patch.status && ["succeeded", "failed", "unknown_outcome"].includes(String(patch.status))) {
      next.completedAt = next.completedAt || next.updatedAt;
    }
    data.agentTasks[index] = next;
    this.write(data);
    return this.hydrateAgentTask(data, next);
  }

  createAgentTaskApproval(taskId: string, payload: any = {}) {
    return this.withWriteTransaction(() => {
      const data = this.read();
      const task = data.agentTasks.find((item) => item.id === String(taskId || ""));
      if (!task) throw new NotFoundException(`agent task not found: ${taskId}`);
      const approvalKey = normalizeOperationKey(
        payload.operationKey || `${task.id}:${String(payload.toolExecutionId || "tool")}`,
        "agent task approval operationKey",
      );
      const approvalId = String(payload.id || deterministicOperationId("agent_approval", approvalKey));
      const existing = data.agentTaskApprovals.find((item) => item.id === approvalId);
      if (existing) return this.hydrateAgentTask(data, task);
      const now = new Date().toISOString();
      data.agentTaskApprovals.push({
        id: approvalId,
        taskId: task.id,
        status: "pending",
        policy: String(payload.policy || "human"),
        requestedBy: String(payload.requestedBy || "agent"),
        reviewer: null,
        decisionNote: null,
        metadata: payload.metadata || {},
        requestedAt: now,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      task.status = "awaiting_approval";
      task.currentStep = String(payload.currentStep || `approval.${String(payload.toolExecutionId || "tool")}`);
      task.completedAt = null;
      task.errorCode = null;
      task.errorMessage = null;
      task.updatedAt = now;
      this.write(data);
      return this.hydrateAgentTask(data, task);
    });
  }

  decideAgentTaskApproval(taskId: string, approvalId: string, payload: any = {}) {
    return this.withWriteTransaction(() => {
      const data = this.read();
      const task = data.agentTasks.find((item) => item.id === String(taskId || ""));
      if (!task) throw new NotFoundException(`agent task not found: ${taskId}`);
      const approval = data.agentTaskApprovals.find(
        (item) => item.id === String(approvalId || "") && item.taskId === task.id,
      );
      if (!approval) throw new NotFoundException(`agent task approval not found: ${approvalId}`);
      const decision = String(payload.decision || "").trim().toLowerCase();
      if (!["approved", "rejected"].includes(decision)) {
        throw new BadRequestException("agent task approval decision must be approved or rejected");
      }
      if (approval.status !== "pending") {
        if (approval.status === decision) return this.hydrateAgentTask(data, task);
        throw new ConflictException("agent task approval has already been decided");
      }
      const now = new Date().toISOString();
      approval.status = decision;
      approval.reviewer = String(payload.reviewer || "人工客服");
      approval.decisionNote = String(payload.note || "").trim() || null;
      approval.decidedAt = now;
      approval.updatedAt = now;
      for (const step of data.agentTaskSteps.filter((item) => item.taskId === task.id && item.mode === "approval" && item.status === "pending")) {
        step.status = decision;
        step.updatedAt = now;
        step.completedAt = now;
      }
      task.status = decision === "approved" ? "ready" : "failed";
      task.currentStep = decision === "approved" ? "reply.compose" : "approval.rejected";
      task.errorMessage = decision === "rejected" ? `审批拒绝${approval.decisionNote ? `：${approval.decisionNote}` : ""}` : null;
      task.updatedAt = now;
      if (decision === "rejected") task.completedAt = now;
      this.write(data);
      return this.hydrateAgentTask(data, task);
    });
  }

  listAgentTaskToolExecutions(filter: IdentityListFilter & { taskId?: string; status?: string; limit?: number } = {}) {
    const data = this.read();
    const status = String(filter.status || "").trim();
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 500));
    const taskIds = data.agentTasks
      .filter((task) => this.matchesIdentityFilter(task, filter))
      .map((task) => task.id);
    return data.agentTaskToolExecutions
      .filter((execution) => (!filter.taskId || execution.taskId === filter.taskId) && taskIds.includes(execution.taskId))
      .filter((execution) => !status || String(execution.status || "") === status)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, limit);
  }

  getAgentTaskToolExecution(id: string) {
    return this.read().agentTaskToolExecutions.find((execution) => execution.id === String(id || "")) || null;
  }

  updateAgentTaskToolExecution(id: string, patch: any = {}) {
    const data = this.read();
    const index = data.agentTaskToolExecutions.findIndex((execution) => execution.id === String(id || ""));
    if (index < 0) throw new NotFoundException(`agent task tool execution not found: ${id}`);
    const current = data.agentTaskToolExecutions[index];
    const next = { ...current, ...patch, id: current.id, operationKey: current.operationKey, updatedAt: new Date().toISOString() };
    if (patch.status && ["succeeded", "failed", "unknown_outcome", "previewed", "verified"].includes(String(patch.status))) {
      next.completedAt = next.completedAt || next.updatedAt;
    }
    data.agentTaskToolExecutions[index] = next;
    this.write(data);
    return next;
  }

  private hydrateAgentTask(data: StoreData, task: any) {
    return {
      ...task,
      steps: data.agentTaskSteps
        .filter((step) => step.taskId === task.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
      approvals: data.agentTaskApprovals
        .filter((approval) => approval.taskId === task.id)
        .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))),
      toolExecutions: data.agentTaskToolExecutions
        .filter((execution) => execution.taskId === task.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    };
  }

  getRouteEvaluation(id: string) {
    const data = this.read();
    const route = data.routeEvaluations.find((item) => item.id === id);
    return route ? { ...route, agent: data.agents.find((item) => item.id === route.agentId) || null } : null;
  }

  correctRouteEvaluation(routeEvaluationId: string, payload: any = {}) {
    const data = this.read();
    const index = data.routeEvaluations.findIndex((route) => route.id === routeEvaluationId);
    if (index < 0) throw new NotFoundException(`route evaluation not found: ${routeEvaluationId}`);
    const before = data.routeEvaluations[index];
    const agent = data.agents.find((item) => item.key === payload.agentKey);
    if (!agent) throw new BadRequestException(`agent not found: ${payload.agentKey}`);

    const requestKey = routingCorrectionRequestKey(routeEvaluationId, payload);
    if (before.correction?.requestKey === requestKey) {
      const log = data.reviewLogs.find(
        (item) => item.targetType === "route_evaluation"
          && item.targetId === routeEvaluationId
          && item.metadata?.correctionRequestKey === requestKey,
      );
      const sample = log?.metadata?.trainingSampleId
        ? data.trainingSamples.find((item) => item.id === log.metadata.trainingSampleId)
        : null;
      const knowledge = log?.metadata?.knowledgeEntryId
        ? data.knowledgeEntries.find((item) => item.id === log.metadata.knowledgeEntryId)
        : null;
      if (sample && knowledge && log) {
        return {
          route: { ...before, agent },
          trainingSample: sample,
          knowledgeEntry: knowledge,
          reviewLog: log,
        };
      }
      throw new InternalServerErrorException("route correction artifacts are incomplete");
    }

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
        requestKey,
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
      status: "ready",
      reviewer,
      reviewNote: note,
      reviewedAt: now,
      reviewHistory: [{ status: "ready", reviewer, note, reviewedAt: now }],
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
        correctionRequestKey: requestKey,
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
    const operationKey = payload?.operationKey
      ? normalizeOperationKey(payload.operationKey, "chat import operationKey")
      : `legacy:${randomUUID()}`;
    const importId = deterministicOperationId("import", operationKey);
    const existing = data.chatImports.find((item) => item.id === importId);
    if (existing) {
      const storedIdentity = assertStoredOperationIdentityReplay(
        {
          customerId: existing.customerId,
          conversationId: existing.conversationId,
          wechatAccountId: existing.wechatAccountId,
        },
        payload || {},
        "chat import create",
      );
      const replayOperation = requestOperationMetadata(
        operationKey,
        createChatImportOperationFingerprint(payload || {}, storedIdentity),
      );
      assertExactOperationReplay(
        readRequestOperationMetadata(existing.identityBinding),
        replayOperation,
        "chat import create",
      );
      const existingSamples = data.trainingSamples
        .filter((sample) => sample.importId === existing.id)
        .map((sample) => this.decorateTrainingSample(sample));
      return { ...existing, samples: existingSamples };
    }
    const identity = this.validateOptionalConversationBinding(data, payload, "chat import");
    const operation = requestOperationMetadata(
      operationKey,
      createChatImportOperationFingerprint(payload || {}, {
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        wechatAccountId: identity.wechatAccountId,
      }),
    );
    const record: any = {
      id: importId,
      name: payload.name || `聊天记录导入 ${new Date().toLocaleString("zh-CN")}`,
      source: payload.source || "manual_text",
      channel: payload.channel || "wechat",
      agentId: payload.agentId || null,
      customerId: identity.customerId,
      conversationId: identity.conversationId,
      wechatAccountId: identity.wechatAccountId,
      identityBinding: { ...(identity.binding || {}), requestOperation: operation },
      rawText: payload.text || "",
      messageCount: parsed.messageCount || 0,
      pairCount: parsed.pairCount || 0,
      warnings: parsed.warnings || [],
      createdAt: now,
      updatedAt: now,
    };
    data.chatImports.push(record);

    const importedSamples: any[] = [];
    const reviewRequired = String(payload?.reviewMode || "score_based") === "required";
    for (const [pairIndex, pair] of (parsed.pairs || []).entries()) {
      const customerText = String(pair.customerText || pair.question || "").trim();
      const idealReply = String(pair.idealReply || pair.agentReply || pair.answer || "").trim();
      const score = Number.isFinite(Number(pair.score)) ? Number(pair.score) : 0;
      const agent = payload.agentId
        ? data.agents.find((item) => item.id === payload.agentId)
        : data.agents.find((item) => item.key === pair.agentKey) || data.agents.find((item) => item.key === "general");
      const sample = {
        id: deterministicOperationId("sample", operationKey, pairIndex),
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
        customerText,
        idealReply,
        score,
        status: reviewRequired ? "review" : score >= 70 ? "ready" : "review",
        skillHints: inferSkillHints(pair),
        sourceType: "chat_import",
        sourceLineStart: pair.sourceLineStart,
        sourceLineEnd: pair.sourceLineEnd,
        createdAt: now,
        updatedAt: now,
      };
      data.trainingSamples.push(sample);
      importedSamples.push(sample);
      data.knowledgeEntries.push({
        id: deterministicOperationId("knowledge", operationKey, pairIndex),
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
        status: sample.status,
        reviewNote: reviewRequired ? "chat import requires human review before reply use" : null,
        createdAt: now,
        updatedAt: now,
      });
    }
    record.sceneSummary = summarizeChatImportSceneChecks(importedSamples);

    this.write(data);
    return {
      ...record,
      samples: importedSamples.map((sample) => this.decorateTrainingSample(sample)),
    };
  }

  createSendTask(payload: any) {
    const data = this.read();
    if (payload.id) {
      const existing = data.sendTasks.find((item) => item.id === payload.id);
      if (existing) {
        assertExactOperationReplay(
          readRequestOperationMetadata(existing.guardSnapshot),
          readRequestOperationMetadata(payload.guardSnapshot) || { key: String(payload.id), fingerprint: "" },
          "local send task",
        );
        return this.hydrateSendTask(data, existing);
      }
    }
    const now = new Date().toISOString();
    const operationKey = payload.operationKey ? normalizeOperationKey(payload.operationKey) : null;
    const taskId = operationKey ? deterministicOperationId("send", operationKey) : payload.id || id("send");
    const conversationBeforeValidation = data.conversations.find((item) => item.id === payload.conversationId) || null;
    const existing = data.sendTasks.find((item) => item.id === taskId) || null;
    if (existing && operationKey) {
      const storedBinding = existing.guardSnapshot?.binding || {};
      const storedIdentity = {
        conversationId: storedBinding.conversationId || existing.conversationId,
        customerId: storedBinding.customerId || existing.customerId,
        wechatAccountId: storedBinding.wechatAccountId || existing.wechatAccountId,
      };
      const requestOperation = requestOperationMetadata(
        operationKey,
        createSendTaskOperationFingerprint(payload || {}, storedIdentity),
      );
      assertExactOperationReplay(
        readRequestOperationMetadata(existing.guardSnapshot),
        requestOperation,
        "send task create",
      );
      assertStoredOperationIdentityReplay(
        {
          ...storedIdentity,
        },
        {
          conversationId: payload.conversationId,
          customerId: payload.customerId,
          wechatAccountId: payload.wechatAccountId,
        },
        "send task create",
      );
      return this.hydrateSendTask(data, existing);
    }
    const binding = this.validateSendTaskBinding(data, payload);
    const conversation = data.conversations.find((item) => item.id === payload.conversationId) || null;
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || conversation?.customerId || null,
      designJobId: payload.designJobId || binding.designJobId,
    };
    const requestOperation = operationKey
      ? requestOperationMetadata(
          operationKey,
          createSendTaskOperationFingerprint(payload || {}, {
            conversationId: payload.conversationId,
            customerId: normalizedPayload.customerId,
            wechatAccountId: payload.wechatAccountId,
          }),
        )
      : null;
    const record = {
      id: taskId,
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
        ...(requestOperation ? { requestOperation } : {}),
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
      const conversation = data.conversations.find((item) => item.id === next.conversationId) || null;
      next.customerId = next.customerId || conversation?.customerId || null;
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

  claimQueuedSendTaskAndCreateAttempt(params: {
    taskId: string;
    taskPatch: any;
    attempt: any;
    claimGuard?: {
      requireAccountQueueHead?: boolean;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
      latestInboundMessageId?: string;
    };
  }) {
    return this.withWriteTransaction(() => {
      const data = this.read();
      const taskIndex = data.sendTasks.findIndex((item) => item.id === params.taskId);
      if (taskIndex < 0 || data.sendTasks[taskIndex].status !== "queued") return null;

      const currentTask = data.sendTasks[taskIndex];
      const guard = params.claimGuard || {};
      const conversation = data.conversations.find((item) => item.id === currentTask.conversationId) || null;
      if (
        (guard.wechatAccountId && currentTask.wechatAccountId !== guard.wechatAccountId)
        || (guard.conversationId && currentTask.conversationId !== guard.conversationId)
        || (guard.customerId && String(conversation?.customerId || "") !== guard.customerId)
      ) return null;
      if (guard.requireAccountQueueHead) {
        const anotherSendingTask = data.sendTasks.find((item) => (
          item.id !== currentTask.id
          && item.wechatAccountId === currentTask.wechatAccountId
          && item.status === "sending"
        ));
        if (anotherSendingTask) return null;
        const queueHead = data.sendTasks
          .filter((item) => item.wechatAccountId === currentTask.wechatAccountId && item.status === "queued")
          .sort((left, right) => (
            String(left.queuedAt || left.createdAt || "").localeCompare(String(right.queuedAt || right.createdAt || ""))
            || String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
            || String(left.id || "").localeCompare(String(right.id || ""))
          ))[0];
        if (!queueHead || queueHead.id !== currentTask.id) return null;
      }
      if (guard.latestInboundMessageId) {
        const latestInbound = data.messages
          .map((message, index) => ({ message, index }))
          .filter(({ message }) => message.conversationId === currentTask.conversationId && message.direction === "inbound")
          .sort((left, right) => (
            Date.parse(String(right.message.createdAt || "")) - Date.parse(String(left.message.createdAt || ""))
            || right.index - left.index
          ))[0]?.message;
        if (!latestInbound || String(latestInbound.id || "") !== guard.latestInboundMessageId) return null;
      }

      const now = new Date().toISOString();
      const nextTask = {
        ...currentTask,
        ...params.taskPatch,
        updatedAt: now,
      };
      const attempt = this.buildSendAttemptRecord({
        ...params.attempt,
        sendTaskId: params.taskId,
      }, now);
      this.validateSendAttemptBinding(data, attempt);

      data.sendTasks[taskIndex] = nextTask;
      data.sendAttempts.push(attempt);
      this.write(data);
      return {
        task: this.hydrateSendTask(data, nextTask),
        attempt: this.hydrateSendAttempt(data, attempt),
      };
    });
  }

  completeSendAttemptAndTask(params: {
    taskId: string;
    attemptId: string;
    taskPatch: any;
    attemptPatch: any;
    expectedTaskStatus?: string;
    expectedTaskUpdatedAt?: string | Date;
    expectedAttemptStatus?: string;
  }) {
    const data = this.read();
    const taskIndex = data.sendTasks.findIndex((item) => item.id === params.taskId);
    const attemptIndex = data.sendAttempts.findIndex((item) => item.id === params.attemptId);
    if (taskIndex < 0 || attemptIndex < 0) return null;

    const currentTask = data.sendTasks[taskIndex];
    const currentAttempt = data.sendAttempts[attemptIndex];
    if (currentAttempt.sendTaskId !== params.taskId) return null;
    if (params.expectedTaskStatus && currentTask.status !== params.expectedTaskStatus) return null;
    if (
      params.expectedTaskUpdatedAt &&
      new Date(currentTask.updatedAt || 0).getTime() !== new Date(params.expectedTaskUpdatedAt).getTime()
    ) return null;
    if (params.expectedAttemptStatus && currentAttempt.status !== params.expectedAttemptStatus) return null;

    const nextAttempt = {
      ...currentAttempt,
      ...params.attemptPatch,
      metadata: {
        ...(currentAttempt.metadata || {}),
        ...(params.attemptPatch?.metadata || {}),
      },
    };
    const nextTask = {
      ...currentTask,
      ...params.taskPatch,
      updatedAt: new Date().toISOString(),
    };
    this.validateSendAttemptBinding(data, nextAttempt);

    data.sendAttempts[attemptIndex] = nextAttempt;
    data.sendTasks[taskIndex] = nextTask;
    this.write(data);
    return {
      task: this.hydrateSendTask(data, nextTask),
      attempt: this.hydrateSendAttempt(data, nextAttempt),
    };
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
    const sourceImagePaths: string[] = Array.isArray(payload.payload?.sourceImagePaths)
      ? payload.payload.sourceImagePaths.filter(Boolean).map((item: any) => String(item))
      : imagePaths;
    if (sourceImagePaths.length !== imagePaths.length) {
      throw new Error("send task image binding invalid: source and send image counts differ");
    }
    const isManualAttachmentReply = payload.payload?.source === "manual_reply"
      && payload.payload?.manualReply === true
      && payload.guardSnapshot?.manualReply === true;
    const isCustomerSelectionPageReply = payload.payload?.kind === "material_page_recommendations"
      && payload.guardSnapshot?.customerSelectionDelivery?.kind === "material_page_images";
    let normalizedExpectedPaths: Set<string>;
    if (isManualAttachmentReply) {
      const assetIds = Array.isArray(payload.payload?.assetIds)
        ? [...new Set(payload.payload.assetIds.map((item: any) => String(item || "").trim()).filter(Boolean))]
        : [];
      const assets = assetIds.map((assetId) => data.designAssets.find((asset) => asset.id === assetId) || null);
      if (!assetIds.length || assets.some((asset) => !asset)) {
        throw new Error("send task image binding invalid: manual reply assets are missing");
      }
      if (assets.some((asset: any) =>
        asset.ownerType !== "customer"
        || asset.ownerId !== payload.customerId
        || asset.customerId !== payload.customerId
        || asset.conversationId !== payload.conversationId
        || asset.wechatAccountId !== payload.wechatAccountId
      )) {
        throw new Error("send task image binding invalid: manual reply asset identity mismatch");
      }
      normalizedExpectedPaths = new Set(assets.map((asset: any) => normalizePathKey(asset.localPath)).filter(Boolean));
      const filePaths = Array.isArray(payload.payload?.filePaths) ? payload.payload.filePaths.map(String) : [];
      if (filePaths.some((filePath: string) => !normalizedExpectedPaths.has(normalizePathKey(filePath)))) {
        throw new Error("send task file binding invalid: file paths do not belong to manual reply assets");
      }
    } else if (isCustomerSelectionPageReply) {
      const pageProofs = Array.isArray(payload.payload?.customerSelectionPageProofs)
        ? payload.payload.customerSelectionPageProofs
        : [];
      const registered = validateCustomerSelectionPageProofs({ sourceImagePaths, proofs: pageProofs });
      if (!registered?.ok) {
        throw new Error(`send task image binding invalid: ${registered?.reason || "customer selection page proof failed"}`);
      }
      const storageRoot = fs.realpathSync(path.resolve(appConfig.localStorageRoot));
      sourceImagePaths.forEach((sourcePath, index) => {
        if (!fs.existsSync(sourcePath) || !fs.lstatSync(sourcePath).isFile()) {
          throw new Error("send task image binding invalid: customer selection page source is missing");
        }
        const realSourcePath = fs.realpathSync(sourcePath);
        const relative = path.relative(storageRoot, realSourcePath);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new Error("send task image binding invalid: customer selection page escaped local storage");
        }
        const fingerprint = createHash("sha256").update(fs.readFileSync(realSourcePath)).digest("hex");
        if (fingerprint !== String(pageProofs[index]?.imageSha256 || "").toLowerCase()) {
          throw new Error("send task image binding invalid: customer selection page fingerprint changed");
        }
      });
      normalizedExpectedPaths = new Set(sourceImagePaths.map((imagePath) => normalizePathKey(imagePath)));
    } else {
      if (!payload.designJobId) throw new Error("send task image binding invalid: designJobId is required for image payload");
      normalizedExpectedPaths = new Set(
        data.designImages
          .filter((image) => image.designJobId === payload.designJobId)
          .map((image) => normalizePathKey(image.localPath))
          .filter(Boolean),
      );
    }
    const invalidSourcePaths = sourceImagePaths.filter((imagePath) => !normalizedExpectedPaths.has(normalizePathKey(imagePath)));
    if (invalidSourcePaths.length) {
      throw new Error(`send task image binding invalid: image paths do not belong to their approved source`);
    }
    const proofs = Array.isArray(payload.guardSnapshot?.imageOptimization)
      ? payload.guardSnapshot.imageOptimization
      : [];
    imagePaths.forEach((imagePath, index) => {
      const sourcePath = sourceImagePaths[index];
      if (normalizePathKey(imagePath) === normalizePathKey(sourcePath)) return;
      const proof = proofs[index];
      const derivedDirectory = path.resolve(path.dirname(sourcePath), ".wechat-work-send");
      const resolvedImagePath = path.resolve(imagePath);
      const relative = path.relative(derivedDirectory, resolvedImagePath);
      if (
        !proof
        || proof.optimized !== true
        || Number(proof.position) !== index + 1
        || normalizePathKey(proof.sourcePath) !== normalizePathKey(sourcePath)
        || normalizePathKey(proof.sendPath) !== normalizePathKey(imagePath)
        || !/^[a-f0-9]{64}$/i.test(String(proof.fingerprint || ""))
        || !relative
        || relative.startsWith("..")
        || path.isAbsolute(relative)
        || !fs.existsSync(resolvedImagePath)
        || !fs.lstatSync(resolvedImagePath).isFile()
      ) {
        throw new Error("send task image binding invalid: optimized image proof is invalid");
      }
      const realDerivedDirectory = fs.realpathSync(derivedDirectory);
      const realImagePath = fs.realpathSync(resolvedImagePath);
      const realRelative = path.relative(realDerivedDirectory, realImagePath);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new Error("send task image binding invalid: optimized image escaped its design job");
      }
      const fingerprint = createHash("sha256").update(fs.readFileSync(realImagePath)).digest("hex");
      if (fingerprint !== String(proof.fingerprint).toLowerCase()) {
        throw new Error("send task image binding invalid: optimized image fingerprint changed");
      }
    });
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
    const record = this.buildSendAttemptRecord(payload, now);
    this.validateSendAttemptBinding(data, record);
    data.sendAttempts.push(record);
    this.write(data);
    return this.hydrateSendAttempt(data, record);
  }

  private buildSendAttemptRecord(payload: any, now = new Date().toISOString()) {
    return {
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

  private recordSkuDeleteLog(
    data: StoreData,
    before: Record<string, unknown>,
    context: { source?: unknown; operator?: unknown; reason?: unknown } = {},
  ) {
    const now = new Date().toISOString();
    data.skuChangeLogs.push({
      id: id("sku_log"),
      skuId: before.id || null,
      skuCode: before.skuCode || "",
      name: before.name || "",
      action: "delete",
      source: String(context.source || "manual_delete"),
      operator: String(context.operator || "system"),
      reason: String(context.reason || "删除商品"),
      changedFields: SKU_TRACKED_FIELDS
        .filter((field) => before[field] !== undefined)
        .map((field) => ({ field, before: before[field] ?? null, after: null })),
      before: pickSkuSnapshot(before),
      after: {
        skuCode: before.skuCode || "",
        deleted: true,
      },
      createdAt: now,
    });
    if (data.skuChangeLogs.length > 1000) {
      data.skuChangeLogs = data.skuChangeLogs
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 1000);
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

  findWechatWorkSendAttemptByMsgId(msgid: string) {
    const data = this.read();
    const attempt = data.sendAttempts
      .filter((item) => item.adapter === "wechat_work_kf")
      .find((item) =>
        item.metadata?.wechatWorkMsgId === msgid
        || item.metadata?.apiMsgId === msgid
        || (Array.isArray(item.metadata?.wechatWorkMsgIds) && item.metadata.wechatWorkMsgIds.includes(msgid))
        || (Array.isArray(item.metadata?.apiMsgIds) && item.metadata.apiMsgIds.includes(msgid))
        || (Array.isArray(item.metadata?.acceptedMessageIds) && item.metadata.acceptedMessageIds.includes(msgid))
      );
    return attempt ? this.hydrateSendAttempt(data, attempt) : null;
  }

  getRecentMessage(conversationId: string) {
    const data = this.read();
    const rpaMessageIds = new Set(
      data.personalWechatRpaAuditLogs
        .filter((item) => item.messageId)
        .map((item) => String(item.messageId)),
    );
    const message = data.messages
      .filter((item) => item.conversationId === conversationId)
      .filter((item) => isTrustedConversationMessage(item, rpaMessageIds))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!message) return null;
    const conversation = data.conversations.find((item) => item.id === message.conversationId);
    return { ...message, customerId: conversation?.customerId || null };
  }

  findInboundMessageByExternalId(wechatAccountId: string, externalId: string) {
    const safeAccountId = String(wechatAccountId || "").trim();
    const safeExternalId = String(externalId || "").trim();
    if (!safeAccountId || !safeExternalId) return null;
    const data = this.read();
    const message = data.messages.find((item) =>
      item.direction === "inbound" &&
      String(item.wechatAccountId || "") === safeAccountId &&
      String(item.externalId || "") === safeExternalId,
    );
    if (!message) return null;
    const conversation = data.conversations.find((item) => item.id === message.conversationId);
    return { ...message, customerId: conversation?.customerId || message.customerId || null };
  }

  listAccountQueueTaskIds(wechatAccountId: string) {
    const data = this.read();
    return data.sendTasks
      .filter((task) => task.wechatAccountId === wechatAccountId && ["queued", "sending"].includes(task.status))
      .sort((a, b) => String(a.queuedAt || a.createdAt).localeCompare(String(b.queuedAt || b.createdAt)))
      .map((task) => task.id);
  }

  createQuoteFromDesignJob(designJobId: string, selectedImageId?: string, options: { highValueAmountCny?: number } = {}) {
    const data = this.read();
    const job = data.designJobs.find((item) => item.id === designJobId);
    if (!job) throw new Error(`local design job not found: ${designJobId}`);
    const conversation = data.conversations.find((item) => item.id === job.conversationId) || null;
    const items = Array.isArray(job.bundle?.items) ? job.bundle.items : [];
    const totals = calculateTotals(items);
    const quantity = Number(job.budget?.quantity || 1);
    const designImages = data.designImages.filter((image) => image.designJobId === designJobId);
    const latestImages = latestCandidateRound(designImages);
    const selectedImage = selectedImageId
      ? designImages.find((image) => image.id === selectedImageId || image.imageId === selectedImageId)
      : latestImages.find((image: any) => image.selected) || null;
    const totalPrice = totals.salePrice * quantity;
    const totalCost = totals.cost * quantity;
    const bundleAutomation = inspectBundleAutomationReadiness(job.bundle || {});
    const highValueAmount = Number(options.highValueAmountCny || 10000);
    const highValueQuote =
      job.isHighValue ||
      isHighValueBudget(job.budget, highValueAmount) ||
      (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
      (Number.isFinite(totals.salePrice) && totals.salePrice >= highValueAmount);
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
      status: highValueQuote || !bundleAutomation.ok ? "manual_review" : "auto_sent",
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

  listPaymentEvents(filter: IdentityListFilter & { quoteDraftId?: string; orderDraftId?: string } = {}) {
    const data = this.read();
    return data.paymentEvents
      .map((event) => this.hydratePaymentEvent(data, event))
      .filter((event) => this.matchesIdentityFilter(event, filter))
      .filter((event) => !filter.quoteDraftId || event.quoteDraftId === filter.quoteDraftId)
      .filter((event) => !filter.orderDraftId || event.orderDraftId === filter.orderDraftId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  listConversationLearningBundles(filter: IdentityListFilter = {}, limit = 50) {
    const data = this.read();
    if (filter.conversationId) {
      this.requireCompleteConversationIdentity(data, {
        wechatAccountId: String(filter.wechatAccountId || ""),
        conversationId: String(filter.conversationId || ""),
        customerId: String(filter.customerId || ""),
      }, "conversation learning");
    }
    const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit || 50)), 100));
    const conversations = data.conversations
      .filter((conversation) => !filter.wechatAccountId || conversation.wechatAccountId === filter.wechatAccountId)
      .filter((conversation) => !filter.conversationId || conversation.id === filter.conversationId)
      .filter((conversation) => !filter.customerId || conversation.customerId === filter.customerId)
      .sort((left, right) => String(right.lastMessageAt || right.updatedAt || "").localeCompare(String(left.lastMessageAt || left.updatedAt || "")))
      .slice(0, safeLimit);
    return conversations.map((conversation) => {
      const designJobIds = new Set(
        data.designJobs.filter((job) => job.conversationId === conversation.id).map((job) => job.id),
      );
      return {
        conversation: this.hydrateConversation(data, conversation),
        messages: data.messages
          .filter((message) => message.conversationId === conversation.id)
          .filter((message) => ["inbound", "outbound"].includes(String(message.direction || "")))
          .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
          .slice(-500),
        routes: data.routeEvaluations
          .filter((route) => route.conversationId === conversation.id)
          .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))),
        quotes: data.quoteDrafts
          .filter((quote) => designJobIds.has(quote.designJobId))
          .map((quote) => this.hydrateQuoteDraft(data, quote)),
        orders: data.orderDrafts
          .filter((order) => order.conversationId === conversation.id)
          .map((order) => this.hydrateOrderDraft(data, order)),
      };
    });
  }

  confirmConversationOutcome(conversationId: string, payload: any = {}) {
    const data = this.read();
    const identity = this.requireCompleteConversationIdentity(data, {
      wechatAccountId: String(payload.expectedWechatAccountId || payload.wechatAccountId || ""),
      conversationId,
      customerId: String(payload.expectedCustomerId || payload.customerId || ""),
    }, "conversation outcome confirmation");
    if (payload.expectedConversationId && payload.expectedConversationId !== conversationId) {
      throw new BadRequestException("conversation outcome confirmation identity mismatch: conversationId");
    }
    const outcome = normalizeConversationOutcome(payload.outcome);
    const reviewOperation = buildLocalReviewOperation(
      "conversation-outcome",
      conversationId,
      payload,
      "conversation outcome operationKey",
    );
    if (!reviewOperation) throw new BadRequestException("conversation outcome operationKey is required");
    const existingReviewLog = findLocalReviewLogByEffectKey(data, reviewOperation.effectKey);
    const route = data.routeEvaluations
      .filter((item) => item.conversationId === conversationId)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0];
    if (!route) throw new NotFoundException(`conversation route evaluation not found: ${conversationId}`);
    if (existingReviewLog) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existingReviewLog.metadata),
        reviewOperation.operation,
        "conversation outcome confirmation",
      );
      return { route, reviewLog: existingReviewLog, confirmedOutcome: route.conversionAssessment?.confirmedOutcome || null };
    }
    const now = new Date().toISOString();
    const confirmedOutcome = {
      outcome,
      reasonCode: String(payload.reasonCode || "").trim() || null,
      note: String(payload.note || "").trim() || null,
      reviewer: String(payload.reviewer || "operator").trim() || "operator",
      confirmedAt: now,
    };
    route.conversionAssessment = {
      ...(route.conversionAssessment || {}),
      schema: "conversion_assessment_confirmation_v1",
      confirmedOutcome,
    };
    route.updatedAt = now;
    const reviewLog = {
      id: deterministicOperationId("review", reviewOperation.effectKey),
      targetType: "conversation",
      targetId: conversationId,
      decision: "confirm_conversion_outcome",
      reviewer: confirmedOutcome.reviewer,
      note: confirmedOutcome.note,
      beforeStatus: "unconfirmed",
      afterStatus: outcome,
      metadata: {
        effectKey: reviewOperation.effectKey,
        requestOperation: reviewOperation.operation,
        routeEvaluationId: route.id,
        reasonCode: confirmedOutcome.reasonCode,
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
      },
      createdAt: now,
    };
    data.reviewLogs.push(reviewLog);
    this.write(data);
    return { route, reviewLog, confirmedOutcome };
  }

  recordPaymentEvent(payload: any) {
    const data = this.read();
    const idempotencyKey = String(payload?.idempotencyKey || "").trim();
    if (!idempotencyKey) throw new BadRequestException("payment event requires an idempotency key");
    const existing = data.paymentEvents.find((event) => event.idempotencyKey === idempotencyKey);
    if (existing) {
      assertLocalPaymentEventReplay(existing, payload);
      return this.hydratePaymentEvent(data, existing);
    }

    const quote = data.quoteDrafts.find((item) => item.id === payload.quoteDraftId);
    if (!quote) throw new BadRequestException(`payment event quote not found: ${payload.quoteDraftId}`);
    const order = payload.orderDraftId
      ? data.orderDrafts.find((item) => item.id === payload.orderDraftId)
      : data.orderDrafts.find((item) => item.quoteDraftId === quote.id) || null;
    if (payload.orderDraftId && !order) throw new BadRequestException(`payment event order not found: ${payload.orderDraftId}`);
    if (order && order.quoteDraftId !== quote.id) throw new BadRequestException("payment event order does not belong to quote");

    const now = new Date().toISOString();
    const record = {
      id: id("payment_event"),
      quoteDraftId: quote.id,
      orderDraftId: order?.id || null,
      customerId: String(payload.customerId || order?.customerId || quote.customerId || ""),
      conversationId: cleanOptionalString(payload.conversationId || order?.conversationId || quote.designJob?.conversationId),
      wechatAccountId: cleanOptionalString(payload.wechatAccountId || order?.wechatAccountId || quote.designJob?.wechatAccountId),
      paymentStatus: payload.paymentStatus,
      amountCny: normalizePaymentEventAmount(payload.amountCny),
      method: cleanOptionalString(payload.method),
      proofReference: cleanOptionalString(payload.proofReference),
      reviewer: cleanOptionalString(payload.reviewer),
      note: cleanOptionalString(payload.note),
      source: cleanOptionalString(payload.source) || "manual_payment_proof",
      idempotencyKey,
      createdAt: now,
    };
    if (!["deposit_paid", "paid", "refunded"].includes(String(record.paymentStatus || ""))) {
      throw new BadRequestException("payment event only records verified deposit, full payment, or refund");
    }
    if (!record.customerId) throw new BadRequestException("payment event requires a customer identity");
    data.paymentEvents.push(record);
    this.write(data);
    return this.hydratePaymentEvent(data, record);
  }

  listReviewLogs(filter: (IdentityListFilter & { limit?: number }) | number = 100) {
    const options = typeof filter === "number" ? { limit: filter } : filter;
    return this.read()
      .reviewLogs
      .filter((log) => this.matchesIdentityFilter(log, options))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(Number(options.limit || 100), 300)));
  }

  getReviewLog(id: string) {
    const data = this.read();
    return data.reviewLogs.find((log) => log.id === id) || null;
  }

  createReviewLog(payload: any) {
    const data = this.read();
    const effectKey = String(payload?.metadata?.effectKey || "").trim();
    if (effectKey) {
      const existing = data.reviewLogs.find((log) => String(log?.metadata?.effectKey || "") === effectKey);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const record = this.buildReviewLogRecord(data, payload, now);
    if (effectKey) record.id = deterministicOperationId("review", effectKey);
    data.reviewLogs.push(record);
    this.write(data);
    return record;
  }

  getWechatWorkCustomerUpgrade(idValue: string) {
    const recordId = String(idValue || "").trim();
    if (!recordId) return null;
    return this.read().wechatWorkCustomerUpgrades.find((item) => item.id === recordId) || null;
  }

  findWechatWorkCustomerUpgradeByState(stateValue: string) {
    const state = String(stateValue || "").trim();
    if (!state) return null;
    return this.read().wechatWorkCustomerUpgrades.find((item) => item.state === state) || null;
  }

  findWechatWorkCustomerUpgradeByMsgId(msgidValue: string) {
    const msgid = String(msgidValue || "").trim();
    if (!msgid) return null;
    return this.read().wechatWorkCustomerUpgrades.find(
      (item) => item.textMsgId === msgid || item.imageMsgId === msgid,
    ) || null;
  }

  findPendingWechatWorkCustomerUpgrade(openKfidValue: string, externalUserIdValue: string) {
    const openKfid = String(openKfidValue || "").trim();
    const externalUserId = String(externalUserIdValue || "").trim();
    if (!openKfid || !externalUserId) return null;
    return this.read().wechatWorkCustomerUpgrades
      .filter((item) => (
        item.openKfid === openKfid
        && item.externalUserId === externalUserId
        && ["partial", "failed", "async_failed"].includes(String(item.status || ""))
        && String(item.imageStatus || "") !== "api_accepted"
      ))
      .sort((left, right) => Date.parse(String(right.updatedAt || right.createdAt || 0))
        - Date.parse(String(left.updatedAt || left.createdAt || 0)))[0] || null;
  }

  claimWechatWorkCustomerUpgrade(payload: Record<string, unknown>) {
    return this.withWriteTransaction(() => {
      const recordId = String(payload.id || "").trim();
      const claimToken = String(payload.claimToken || "").trim();
      if (!recordId || !claimToken) throw new BadRequestException("customer upgrade claim requires id and claimToken");
      const data = this.read();
      const index = data.wechatWorkCustomerUpgrades.findIndex((item) => item.id === recordId);
      const existing = index >= 0 ? data.wechatWorkCustomerUpgrades[index] : null;
      if (existing && ["ready", "queued", "sending", "partial", "api_accepted", "async_failed", "half_added_pending", "identity_unverified", "added_confirmed"].includes(String(existing.status || ""))) {
        return { mode: "resume", record: existing };
      }
      const now = new Date();
      if (
        existing?.status === "creating"
        && String(existing.claimToken || "") !== claimToken
        && Date.parse(String(existing.claimExpiresAt || "")) > now.getTime()
      ) {
        return { mode: "in_progress", record: existing };
      }
      for (const item of data.wechatWorkCustomerUpgrades) {
        if (
          item.id !== recordId
          && String(item.openKfid || "") === String(payload.openKfid || "")
          && String(item.externalUserId || "") === String(payload.externalUserId || "")
          && ["creating", "ready", "queued", "sending", "partial", "failed", "async_failed", "api_accepted", "half_added_pending"].includes(String(item.status || ""))
        ) {
          item.status = "superseded";
          item.errorMessage = "客户已选择新的长期服务专员，此二维码不再自动恢复。";
          item.claimToken = null;
          item.claimExpiresAt = null;
          item.version = Math.max(0, Number(item.version || 0)) + 1;
          item.updatedAt = now.toISOString();
        }
      }
      const record = {
        ...(existing || {}),
        ...payload,
        id: recordId,
        status: "creating",
        claimToken,
        claimExpiresAt: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
        version: Math.max(0, Number(existing?.version || 0)) + 1,
        createdAt: existing?.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (index >= 0) data.wechatWorkCustomerUpgrades[index] = record;
      else data.wechatWorkCustomerUpgrades.push(record);
      this.write(data);
      return { mode: "claimed", record };
    });
  }

  updateWechatWorkCustomerUpgrade(
    idValue: string,
    patch: Record<string, unknown>,
    expected: { claimToken?: string; version?: number } = {},
  ) {
    return this.withWriteTransaction(() => {
      const recordId = String(idValue || "").trim();
      const data = this.read();
      const index = data.wechatWorkCustomerUpgrades.findIndex((item) => item.id === recordId);
      if (index < 0) return null;
      const current = data.wechatWorkCustomerUpgrades[index];
      if (expected.claimToken && current.claimToken !== expected.claimToken) return null;
      if (expected.version != null && Number(current.version || 0) !== Number(expected.version)) return null;
      const keepConfirmed = current.status === "added_confirmed" && patch.status !== "added_confirmed";
      const record = {
        ...current,
        ...patch,
        ...(keepConfirmed ? { status: "added_confirmed" } : {}),
        id: current.id,
        corpId: current.corpId,
        openKfid: current.openKfid,
        externalUserId: current.externalUserId,
        wechatAccountId: current.wechatAccountId,
        conversationId: current.conversationId,
        customerId: current.customerId,
        memberUserId: current.memberUserId,
        state: current.state,
        version: Math.max(0, Number(current.version || 0)) + 1,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      data.wechatWorkCustomerUpgrades[index] = record;
      this.write(data);
      return record;
    });
  }

  upsertWechatWorkAudit(payload: Record<string, unknown>) {
    const recordId = String(payload.id || "").trim();
    if (!recordId) return this.recordWechatWorkAudit(payload);
    const data = this.read();
    const existingIndex = data.wechatWorkAuditLogs.findIndex((item) => item.id === recordId);
    const existing = existingIndex >= 0 ? data.wechatWorkAuditLogs[existingIndex] : null;
    const record = {
      ...(existing || {}),
      ...payload,
      id: recordId,
      createdAt: existing?.createdAt || payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      data.wechatWorkAuditLogs[existingIndex] = record;
    } else {
      data.wechatWorkAuditLogs.push(record);
    }
    this.write(data);
    return record;
  }

  createWechatWorkEventSendTaskFromCredential(params: {
    credentialId: string;
    operationKey: string;
    identity: { wechatAccountId: string; conversationId: string; customerId: string };
    binding: { openKfid: string; externalUserId: string };
    payload: Record<string, unknown>;
    guardSnapshot: Record<string, unknown>;
  }) {
    const data = this.read();
    const operationKey = normalizeOperationKey(params.operationKey, "operationKey");
    const taskId = deterministicOperationId("send", operationKey);
    const existingTask = data.sendTasks.find((item) => item.id === taskId) || null;
    if (existingTask) {
      throw new BadRequestException("企业微信事件响应发送任务已存在，不能重复创建");
    }
    const credentialIndex = data.wechatWorkAuditLogs.findIndex((item) => item.id === String(params.credentialId || "").trim());
    if (credentialIndex < 0) return null;
    const credential = data.wechatWorkAuditLogs[credentialIndex];
    if (credential.action !== "event_reply_credential") {
      throw new BadRequestException("企业微信事件响应凭证不存在或已不可用");
    }
    if (
      credential.wechatAccountId !== params.identity.wechatAccountId ||
      credential.conversationId !== params.identity.conversationId ||
      credential.customerId !== params.identity.customerId ||
      credential.openKfid !== params.binding.openKfid ||
      credential.externalUserId !== params.binding.externalUserId
    ) {
      throw new BadRequestException("企业微信事件响应凭证与当前客户身份不一致");
    }
    if (credential.status !== "pending") return null;
    const originalSecret = credential.eventCodeSecret;
    if (!originalSecret || !credential.eventCodeHash) {
      throw new BadRequestException("企业微信事件响应凭证缺少加密体");
    }
    const now = new Date().toISOString();
    const expiresAt = Date.parse(String(credential.expiresAt || ""));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      const expired = {
        ...credential,
        status: "expired",
        expiredAt: now,
        eventCredentialSecretClearedAt: now,
        eventCredentialSecretStored: false,
        updatedAt: now,
      };
      delete expired.eventCodeSecret;
      data.wechatWorkAuditLogs[credentialIndex] = expired;
      this.write(data);
      throw new BadRequestException("企业微信事件响应凭证已过期，请等待客户新事件后再发送");
    }
    const eventGuardSnapshot = {
      ...params.guardSnapshot,
      eventCredentialId: credential.id,
      eventCodeHash: credential.eventCodeHash,
      eventCredentialExpiresAt: credential.expiresAt,
    };
    const taskInput = {
      operationKey,
      wechatAccountId: params.identity.wechatAccountId,
      conversationId: params.identity.conversationId,
      customerId: params.identity.customerId,
      payload: {
        ...params.payload,
        eventCredentialId: credential.id,
        eventCodeHash: credential.eventCodeHash,
        eventCodeSecret: originalSecret,
        eventCredentialExpiresAt: credential.expiresAt,
      },
      guardSnapshot: eventGuardSnapshot,
    };
    const binding = this.validateSendTaskBinding(data, taskInput);
    const conversation = data.conversations.find((item) => item.id === taskInput.conversationId) || null;
    const normalizedPayload = {
      ...taskInput,
      customerId: taskInput.customerId || conversation?.customerId || null,
      designJobId: binding.designJobId,
    };
    const requestOperation = requestOperationMetadata(
      operationKey,
      createSendTaskOperationFingerprint(taskInput || {}, {
        conversationId: taskInput.conversationId,
        customerId: normalizedPayload.customerId,
        wechatAccountId: taskInput.wechatAccountId,
      }),
    );
    const consumed = {
      ...credential,
      status: "consumed",
      consumedAt: now,
      sendTaskId: taskId,
      consumedOperationKey: operationKey,
      eventCredentialSecretClearedAt: now,
      eventCredentialSecretStored: false,
      updatedAt: now,
    };
    delete consumed.eventCodeSecret;
    const taskRecord = {
      id: taskId,
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
        requestOperation,
      },
    };
    data.wechatWorkAuditLogs[credentialIndex] = consumed;
    data.sendTasks.push(taskRecord);
    this.write(data);
    return {
      credential: { ...consumed, eventCodeSecret: originalSecret },
      task: this.hydrateSendTask(data, taskRecord),
    };
  }

  updateReviewLog(id: string, patch: any) {
    const data = this.read();
    const index = data.reviewLogs.findIndex((log) => log.id === id);
    if (index < 0) throw new NotFoundException(`review log not found: ${id}`);
    const current = data.reviewLogs[index];
    const next = {
      ...current,
      ...patch,
      id: current.id,
      targetType: current.targetType,
      targetId: current.targetId,
      createdAt: current.createdAt,
      metadata: patch?.metadata === undefined ? current.metadata : patch.metadata,
    };
    data.reviewLogs[index] = next;
    this.write(data);
    return next;
  }

  private buildReviewLogRecord(data: StoreData, payload: any, now: string) {
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
    if (sharedIdentityFields([record]) === null) return false;
    const identity = this.recordIdentity(record);
    if (expectedWechatAccountId && identity.wechatAccountId !== expectedWechatAccountId) return false;
    if (expectedConversationId && identity.conversationId !== expectedConversationId) return false;
    if (expectedCustomerId && identity.customerId !== expectedCustomerId) return false;
    return true;
  }

  private matchesKnowledgeIdentityFilter(record: any, filter: IdentityListFilter = {}) {
    const expectedWechatAccountId = String(filter.wechatAccountId || "").trim();
    const expectedConversationId = String(filter.conversationId || "").trim();
    const expectedCustomerId = String(filter.customerId || "").trim();
    if (!expectedWechatAccountId && !expectedConversationId && !expectedCustomerId) return true;
    if (sharedIdentityFields([record]) === null) return false;
    const identity = this.recordIdentity(record);
    if (!identity.wechatAccountId && !identity.conversationId && !identity.customerId) return true;
    if (identity.wechatAccountId && identity.wechatAccountId !== expectedWechatAccountId) return false;
    if (identity.conversationId && identity.conversationId !== expectedConversationId) return false;
    if (identity.customerId && identity.customerId !== expectedCustomerId) return false;
    return true;
  }

  private matchesSkillIdentityFilter(data: StoreData, skill: any, filter: IdentityListFilter = {}) {
    const expectedWechatAccountId = String(filter.wechatAccountId || "").trim();
    const expectedConversationId = String(filter.conversationId || "").trim();
    const expectedCustomerId = String(filter.customerId || "").trim();
    if (!expectedWechatAccountId && !expectedConversationId && !expectedCustomerId) return true;
    if (skillIdentityHasConflict(data, skill)) return false;
    const skillIdentity = skillIdentityFields(data, skill);
    if (skillIdentity.wechatAccountId || skillIdentity.conversationId || skillIdentity.customerId) {
      if (skillIdentity.wechatAccountId && skillIdentity.wechatAccountId !== expectedWechatAccountId) return false;
      if (skillIdentity.conversationId && skillIdentity.conversationId !== expectedConversationId) return false;
      if (skillIdentity.customerId && skillIdentity.customerId !== expectedCustomerId) return false;
      return true;
    }
    const sourceSampleIds = Array.isArray(skill?.sourceSampleIds) ? skill.sourceSampleIds.map(String).filter(Boolean) : [];
    if (!sourceSampleIds.length) return true;
    const samples = sourceSampleIds
      .map((sampleId: string) => data.trainingSamples.find((sample) => sample.id === sampleId))
      .filter(Boolean);
    if (!samples.length) return false;
    return samples.every((sample: any) => this.matchesIdentityFilter(sample, filter));
  }

  private recordIdentity(record: any) {
    const designJob = record?.designJob || null;
    const quoteDraft = record?.quoteDraft || null;
    const orderDraft = record?.orderDraft || null;
    const sendTask = record?.sendTask || null;
    const conversation = record?.conversation || record?.activeConversation || designJob?.conversation || quoteDraft?.designJob?.conversation || null;
    const target = record?.target || null;
    const metadata = record?.metadata || null;
    return {
      conversationId: String(
        record?.conversationId ||
          record?.identityBinding?.conversationId ||
          metadata?.conversationId ||
          metadata?.identityBinding?.conversationId ||
          target?.conversationId ||
          conversation?.id ||
          sendTask?.conversationId ||
          designJob?.conversationId ||
          quoteDraft?.designJob?.conversationId ||
          orderDraft?.conversationId ||
          "",
      ),
      customerId: String(
        record?.customerId ||
          record?.identityBinding?.customerId ||
          metadata?.customerId ||
          metadata?.identityBinding?.customerId ||
          target?.customerId ||
          conversation?.customerId ||
          sendTask?.conversation?.customerId ||
          designJob?.customerId ||
          quoteDraft?.customerId ||
          quoteDraft?.designJob?.customerId ||
          orderDraft?.customerId ||
          "",
      ),
      wechatAccountId: String(
        record?.wechatAccountId ||
          record?.identityBinding?.wechatAccountId ||
          metadata?.wechatAccountId ||
          metadata?.identityBinding?.wechatAccountId ||
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
    this.ensure();
    const stat = fs.statSync(this.filePath);
    return {
      ok: true,
      mode: "local-json",
      path: this.filePath,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
      countsAvailable: false,
      maxWechatWindowSnapshots: MAX_WECHAT_WINDOW_SNAPSHOTS,
    };
  }

  private hydrateAgent(data: StoreData, agent: any, filter: IdentityListFilter = {}) {
    const samples = data.trainingSamples
      .filter((sample) => sample.agentId === agent.id)
      .filter((sample) => this.matchesIdentityFilter(sample, filter));
    const averageScore = samples.length
      ? round(samples.reduce((sum, sample) => sum + Number(sample.score || 0), 0) / samples.length)
      : 0;
    return {
      ...agent,
      skills: data.agentSkills
        .filter((skill) => skill.agentId === agent.id)
        .filter((skill) => !localStoreIsSceneClarificationDerivedBusinessSkill(data, skill))
        .filter((skill) => this.matchesSkillIdentityFilter(data, skill, filter))
        .map((skill) => hydrateAgentSkill(data, skill)),
      trainingSampleCount: samples.length,
      averageTrainingScore: averageScore,
    };
  }

  private hydrateConversation(data: StoreData, conversation: any) {
    const inbound = data.messages.filter(
      (message) => message.conversationId === conversation.id && message.direction === "inbound",
    );
    const latestMessage = data.messages
      .filter((message) => message.conversationId === conversation.id)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || null;
    return {
      ...conversation,
      customer: data.customers.find((item) => item.id === conversation.customerId) || null,
      wechatAccount: data.wechatAccounts.find((item) => item.id === conversation.wechatAccountId) || null,
      unreadCount: inbound.filter((message) => !message.readAt).length,
      lastMessagePreview: String(latestMessage?.text || ""),
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
      bundle: this.bundleSnapshotWithSkuImages(data, job.bundle),
      customer: data.customers.find((item) => item.id === job.customerId) || null,
      conversation: data.conversations.find((item) => item.id === job.conversationId) || null,
      wechatAccount: data.wechatAccounts.find((item) => item.id === job.wechatAccountId) || null,
      assets: data.designAssets
        .filter((item) => (job.assetIds || []).includes(item.id))
        .filter((item) => this.designAssetMatchesJobIdentity(item, job)),
      images: data.designImages.filter((item) => item.designJobId === job.id).sort((a, b) => a.position - b.position),
      revisions: data.designRevisions
        .filter((item) => item.designJobId === job.id)
        .sort((a, b) => Number(a.revisionNumber || 0) - Number(b.revisionNumber || 0)),
    };
  }

  private designAssetMatchesJobIdentity(asset: any, job: any) {
    if (asset?.ownerType !== "customer") return false;
    if (asset?.ownerId && job?.customerId && asset.ownerId !== job.customerId) return false;
    if (asset?.customerId && job?.customerId && asset.customerId !== job.customerId) return false;
    if (asset?.conversationId && job?.conversationId && asset.conversationId !== job.conversationId) return false;
    if (asset?.wechatAccountId && job?.wechatAccountId && asset.wechatAccountId !== job.wechatAccountId) return false;
    return Boolean(asset?.id && job?.id);
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
      owner: readableTextOrFallback(quote.owner, "人工客服"),
      customerNotes: readableTextOrFallback(quote.customerNotes, "历史备注不可读，请人工复核。"),
      profitRate: totalPrice > 0 ? round(profit / totalPrice) : 0,
      bundleSnapshot: normalizeBundleSnapshot(this.bundleSnapshotWithSkuImages(data, quote.bundleSnapshot || designJob?.bundle)),
      selectedImageSnapshot: normalizeDesignImageSnapshot(quote.selectedImageSnapshot || selectedImage),
      customer: data.customers.find((item) => item.id === quote.customerId) || null,
      designJob: designJob ? this.hydrateDesignJob(data, designJob) : null,
      selectedImage,
      sendTask: sendTask ? this.hydrateSendTask(data, sendTask) : null,
      paymentEvents: data.paymentEvents
        .filter((event) => event.quoteDraftId === quote.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
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
      owner: readableTextOrFallback(order.owner, "人工客服"),
      customerNotes: readableTextOrFallback(order.customerNotes, "历史备注不可读，请人工复核。"),
      profitRate: order.profitRate ?? (totalPrice > 0 ? round(profit / totalPrice) : 0),
      bundleSnapshot: normalizeBundleSnapshot(this.bundleSnapshotWithSkuImages(data, order.bundleSnapshot || designJob?.bundle || quoteDraft?.bundleSnapshot)),
      selectedImageSnapshot: normalizeDesignImageSnapshot(order.selectedImageSnapshot || selectedImage),
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
      paymentEvents: data.paymentEvents
        .filter((event) => event.orderDraftId === order.id || event.quoteDraftId === order.quoteDraftId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }

  private bundleSnapshotWithSkuImages(data: StoreData, bundle: any) {
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return bundle;
    const next: Record<string, unknown> = { ...bundle };
    if (Array.isArray(bundle.items)) {
      next.items = bundle.items.map((item: any) => this.bundleItemWithSkuImages(data, item));
    }
    if (bundle.giftBox && typeof bundle.giftBox === "object" && !Array.isArray(bundle.giftBox)) {
      next.giftBox = this.bundleItemWithSkuImages(data, bundle.giftBox);
    }
    return next;
  }

  private bundleItemWithSkuImages(data: StoreData, item: any) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const skuCode = String(item.skuCode || "").trim();
    if (!skuCode) return item;
    const sku = data.skus.find((candidate) => String(candidate?.skuCode || "").trim() === skuCode);
    if (!sku) return item;
    const next: Record<string, unknown> = { ...item };
    for (const field of ["name", "type", "category", "mainImagePath", "mainImageUrl", "imagePath", "imageUrl", "downloadUrl", "publicUrl", "url", "localPath"]) {
      const shouldReplaceUnreadableName = field === "name" && isUnreadableText(next[field]);
      if ((!hasNonEmptyText(next[field]) || shouldReplaceUnreadableName) && hasNonEmptyText(sku[field])) next[field] = sku[field];
    }
    for (const field of ["angleImages", "imageUrls", "imagePaths", "gallery"]) {
      if (!hasNonEmptyArray(next[field]) && hasNonEmptyArray(sku[field])) next[field] = sku[field];
    }
    return next;
  }

  private hydratePaymentEvent(data: StoreData, event: any) {
    return {
      ...event,
      quoteDraft: data.quoteDrafts.find((item) => item.id === event.quoteDraftId) || null,
      orderDraft: data.orderDrafts.find((item) => item.id === event.orderDraftId) || null,
    };
  }

  private hydrateWechatWorkBinding(data: StoreData, binding: any) {
    return {
      ...binding,
      wechatAccount: data.wechatAccounts.find((item) => item.id === binding.wechatAccountId) || null,
      customer: data.customers.find((item) => item.id === binding.customerId) || null,
      conversation: data.conversations.find((item) => item.id === binding.conversationId) || null,
    };
  }

  private hydratePersonalWechatRpaBinding(data: StoreData, binding: any) {
    return {
      ...binding,
      wechatAccount: data.wechatAccounts.find((item) => item.id === binding.wechatAccountId) || null,
      customer: data.customers.find((item) => item.id === binding.customerId) || null,
      conversation: data.conversations.find((item) => item.id === binding.conversationId) || null,
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
    if (this.writeTransactionData) return this.writeTransactionData;
    if (
      this.readSnapshotDepth > 0
      && this.readSnapshotData
      && this.readSnapshotFilePath === this.filePath
    ) return this.readSnapshotData;
    this.ensure();
    let contents = fs.readFileSync(this.filePath, "utf8");
    let data: StoreData;
    try {
      data = JSON.parse(contents) as StoreData;
    } catch {
      const recovered = this.recoverNullByteCorruption();
      contents = recovered.contents;
      data = recovered.data;
    }
    const normalized = normalizeData(data);
    this.readFingerprints.set(normalized.data, localStoreContentsFingerprint(contents));
    if (normalized.changed) this.write(normalized.data);
    return normalized.data;
  }

  private recoverNullByteCorruption() {
    return this.withStoreLock(() => {
      this.storeLockOwnershipCheck?.();
      const corruptContents = fs.readFileSync(this.filePath, "utf8");
      try {
        return {
          contents: corruptContents,
          data: JSON.parse(corruptContents) as StoreData,
        };
      } catch (parseError) {
        if (!corruptContents.includes("\0")) throw parseError;

        const repairedContents = corruptContents.replace(/\0/g, "");
        let repairedData: StoreData;
        try {
          repairedData = JSON.parse(repairedContents) as StoreData;
        } catch {
          throw parseError;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${this.filePath}.before-null-byte-repair-${timestamp}-${randomUUID()}.bak`;
        writeFileAtomic(backupPath, corruptContents);
        this.storeLockOwnershipCheck?.();
        writeFileAtomic(this.filePath, repairedContents);
        console.warn(`[local-store] repaired raw null-byte corruption; backup=${backupPath}`);
        return { contents: repairedContents, data: repairedData };
      }
    });
  }

  private write(data: StoreData) {
    if (this.writeTransactionData) {
      if (data !== this.writeTransactionData) {
        throw new InternalServerErrorException("local store write transaction received a foreign snapshot");
      }
      this.writeTransactionDirty = true;
      return;
    }
    if (this.readSnapshotDepth > 0) {
      throw new InternalServerErrorException("local store read snapshot cannot perform writes");
    }
    return this.withStoreLock(() => this.writeWhileLocked(data));
  }

  private writeWhileLocked(data: StoreData) {
    this.storeLockOwnershipCheck?.();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const expectedFingerprint = this.readFingerprints.get(data) || "";
    const exists = fs.existsSync(this.filePath);
    if (exists) {
      const currentContents = fs.readFileSync(this.filePath, "utf8");
      const currentFingerprint = localStoreContentsFingerprint(currentContents);
      if (!expectedFingerprint || currentFingerprint !== expectedFingerprint) {
        throw new LocalStoreConcurrentWriteError();
      }
    } else if (expectedFingerprint) {
      throw new LocalStoreConcurrentWriteError("local store disappeared before the transaction could commit");
    }
    const contents = `${JSON.stringify(data)}\n`;
    this.storeLockOwnershipCheck?.();
    writeFileAtomic(this.filePath, contents);
    this.readFingerprints.set(data, localStoreContentsFingerprint(contents));
  }

  private withStoreLock<T>(operation: () => T): T {
    if (this.storeLockDepth > 0) return operation();
    const lock = acquireLocalStoreLock(this.filePath);
    this.storeLockOwnershipCheck = lock.assertOwned;
    this.storeLockDepth += 1;
    try {
      return operation();
    } finally {
      this.storeLockDepth -= 1;
      this.storeLockOwnershipCheck = null;
      lock.release();
    }
  }

  private ensure() {
    if (fs.existsSync(this.filePath)) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      this.write(seedData());
    } catch (error) {
      if (!(error instanceof LocalStoreConcurrentWriteError) || !fs.existsSync(this.filePath)) throw error;
    }
  }

  private decorateTrainingSample(sample: any) {
    return {
      ...sample,
      quality: evaluateTrainingSampleQuality(sample),
    };
  }
}

export function acquireLocalStoreLock(filePath: string) {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCAL_STORE_LOCK_WAIT_MS;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  while (true) {
    const ownerToken = randomUUID();
    const ownerFileName = `owner-${ownerToken}.json`;
    const pendingPath = `${lockPath}.pending-${process.pid}-${ownerToken}`;
    fs.mkdirSync(pendingPath);
    fs.writeFileSync(
      path.join(pendingPath, ownerFileName),
      JSON.stringify({ ownerToken, pid: process.pid, acquiredAt: new Date().toISOString() }),
      { encoding: "utf8", flag: "wx" },
    );
    try {
      // The directory is populated before the rename, so another owner never observes an empty acquired lock.
      fs.renameSync(pendingPath, lockPath);
      return ownedLocalStoreLockHandle(lockPath, ownerFileName);
    } catch (error: any) {
      removeOwnedLockDirectory(pendingPath, ownerFileName);
      if (!localStoreLockAlreadyExists(error)) throw error;
    }

    const stale = localStoreLockIsStale(lockPath);
    if (stale) {
      const abandonedPath = `${lockPath}.abandoned-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(lockPath, abandonedPath);
        removeAbandonedLockDirectory(abandonedPath);
        continue;
      } catch (error: any) {
        if (!localStoreLockRace(error)) throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new LocalStoreConcurrentWriteError("local store transaction lock timed out");
    }
    const waitMs = Math.max(1, Math.min(LOCAL_STORE_LOCK_RETRY_MS, deadline - Date.now()));
    localStoreSleepSync(waitMs);
  }
}

function ownedLocalStoreLockHandle(lockPath: string, ownerFileName: string) {
  let released = false;
  const ownerPath = path.join(lockPath, ownerFileName);
  return {
    assertOwned: () => {
      if (released || !fs.existsSync(ownerPath)) {
        throw new LocalStoreConcurrentWriteError("local store transaction lock ownership was lost");
      }
    },
    release: () => {
      if (released) return;
      released = true;
      try {
        // A stale owner cannot remove a replacement lock because its unique owner file is absent there.
        fs.unlinkSync(ownerPath);
      } catch (error: any) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      try {
        fs.rmdirSync(lockPath);
      } catch (error: any) {
        if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error?.code || ""))) return;
        throw error;
      }
    },
  };
}

function localStoreLockIsStale(lockPath: string) {
  try {
    return fs.statSync(lockPath).mtimeMs < Date.now() - LOCAL_STORE_LOCK_STALE_MS;
  } catch (error: any) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function localStoreLockAlreadyExists(error: any) {
  return ["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(String(error?.code || ""));
}

function localStoreLockRace(error: any) {
  return ["ENOENT", "EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(String(error?.code || ""));
}

function removeOwnedLockDirectory(directoryPath: string, ownerFileName: string) {
  try {
    fs.unlinkSync(path.join(directoryPath, ownerFileName));
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    fs.rmdirSync(directoryPath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function removeAbandonedLockDirectory(directoryPath: string) {
  let entries: string[];
  try {
    entries = fs.readdirSync(directoryPath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!/^owner-[0-9a-f-]+\.json$/i.test(entry)) continue;
    try {
      fs.unlinkSync(path.join(directoryPath, entry));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  try {
    fs.rmdirSync(directoryPath);
  } catch (error: any) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error?.code || ""))) throw error;
  }
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function latestActiveLocalDesignRevisionIndex(data: StoreData, designJobId: string) {
  return data.designRevisions
    .map((revision, index) => ({ revision, index }))
    .filter(({ revision }) => revision.designJobId === designJobId)
    .filter(({ revision }) => ["submitted", "generating"].includes(revision.status))
    .sort((a, b) => String(b.revision.updatedAt || b.revision.createdAt).localeCompare(String(a.revision.updatedAt || a.revision.createdAt)))[0]?.index ?? -1;
}

function latestActiveLocalDesignRevision(data: StoreData, designJobId: string, statuses = ["submitted", "generating"]) {
  return data.designRevisions
    .filter((revision) => revision.designJobId === designJobId)
    .filter((revision) => statuses.includes(revision.status))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
}

function isTerminalWechatWorkAudit(record: any) {
  const action = String(record?.action || "").trim();
  const status = String(record?.status || "").trim();
  return (
    (action === "inbound_processed" && status === "processed") ||
    (action === "inbound_ignored" && status === "ignored") ||
    (action === "event_processed" && status === "processed") ||
    (action === "send_async_failed" && status === "processed") ||
    (action === "inbound_failed" && status === "permanent_manual_review")
  );
}

function timelineTaskAttachments(task: any, designAssets: any[] = []) {
  const imagePaths = Array.isArray(task?.payload?.imagePaths) ? task.payload.imagePaths : [];
  const filePaths = Array.isArray(task?.payload?.filePaths) ? task.payload.filePaths : [];
  const attachments = Array.isArray(task?.payload?.attachments) ? task.payload.attachments : [];
  const assetIds = Array.isArray(task?.payload?.assetIds) ? task.payload.assetIds.map(String) : [];
  const assetsById = new Map(designAssets.map((asset: any) => [String(asset?.id || ""), asset]));
  const orderedAssets = assetIds.map((assetId: string) => assetsById.get(assetId)).filter(Boolean) as any[];
  const imageAssets = orderedAssets.filter((asset: any) => ["image/jpeg", "image/png"].includes(String(asset?.mimeType || "").toLowerCase()));
  const fileAssets = orderedAssets.filter((asset: any) => !imageAssets.includes(asset));
  return normalizeConversationTimelineAttachments(
    [
      ...imagePaths.map((filePath: unknown, index: number) => ({
        kind: "image",
        path: String(filePath || ""),
        assetId: imageAssets[index]?.id,
        name: imageAssets[index]?.fileName,
        mimeType: imageAssets[index]?.mimeType,
      })),
      ...filePaths.map((filePath: unknown, index: number) => ({
        kind: "file",
        path: String(filePath || ""),
        assetId: fileAssets[index]?.id,
        name: fileAssets[index]?.fileName,
        mimeType: fileAssets[index]?.mimeType,
      })),
      ...attachments,
    ],
    String(task?.status || "queued"),
  );
}

function localStoreContentsFingerprint(contents: string) {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function writeFileAtomic(filePath: string, contents: string) {
  const resolved = path.resolve(filePath);
  const tempPath = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tempPath, contents, "utf8");
    const fd = fs.openSync(tempPath, "r");
    try {
      bestEffortFsync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameAtomicTempFile(tempPath, resolved);
  } catch (error) {
    removeAtomicTempFile(tempPath);
    throw error;
  }
}

function renameAtomicTempFile(tempPath: string, resolved: string) {
  const deadline = Date.now() + LOCAL_STORE_WRITE_RENAME_WAIT_MS;
  while (true) {
    try {
      fs.renameSync(tempPath, resolved);
      return;
    } catch (error: any) {
      if (!localStoreAtomicRenameRetryable(error) || Date.now() >= deadline) throw error;
      const waitMs = Math.max(1, Math.min(LOCAL_STORE_WRITE_RENAME_RETRY_MS, deadline - Date.now()));
      localStoreSleepSync(waitMs);
    }
  }
}

function localStoreAtomicRenameRetryable(error: any) {
  return ["EPERM", "EACCES", "EBUSY"].includes(String(error?.code || ""));
}

function removeAtomicTempFile(tempPath: string) {
  try {
    fs.rmSync(tempPath, { force: true });
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function localStoreSleepSync(waitMs: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
}

function bestEffortFsync(fd: number) {
  try {
    fs.fsyncSync(fd);
  } catch (error: any) {
    if (!["EPERM", "EINVAL", "ENOTSUP"].includes(error?.code)) throw error;
  }
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

function hasNonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isUnreadableText(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (text.includes("\uFFFD")) return true;
  const questionMarks = text.match(/\?/g)?.length || 0;
  return questionMarks >= 3 && questionMarks >= Math.ceil(text.length / 2);
}

function readableTextOrFallback(value: unknown, fallback: string) {
  return isUnreadableText(value) ? fallback : value;
}

function hasNonEmptyArray(value: unknown) {
  return Array.isArray(value) && value.some((item) => hasNonEmptyText(item) || (item && typeof item === "object"));
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

function resolveKnowledgeImportAgent(data: StoreData, row: any) {
  const agentId = String(row?.agentId || "").trim();
  const agentKey = String(row?.agentKey || "").trim();
  if (agentId) return data.agents.find((agent) => agent.id === agentId) || null;
  if (agentKey) return data.agents.find((agent) => agent.key === agentKey || agent.id === agentKey) || null;
  return null;
}

function resolveKnowledgeReviewAgent(data: StoreData, row: any) {
  return resolveKnowledgeImportAgent(data, row);
}

function normalizeKnowledgeReviewStatus(value: unknown) {
  const status = String(value || "").trim();
  if (status === "ready" || status === "review" || status === "rejected") return status;
  throw new BadRequestException("knowledge status must be one of ready, review, rejected");
}

function normalizeKnowledgeEntryStatus(entry: any, data?: StoreData) {
  const explicit = String(entry?.status || "").trim();
  if (explicit === "ready" || explicit === "review" || explicit === "rejected") return explicit;
  if (entry?.sourceType === "starter_knowledge") return "ready";
  const sampleId = entry?.trainingSampleId || entry?.sourceId;
  const sample = sampleId && data ? data.trainingSamples.find((item) => item.id === sampleId) : null;
  if (sample) return isTrainingSampleReady(sample) ? "ready" : String(sample.status || "review");
  if (entry?.sourceType === "chat_import" || entry?.sourceType === "route_correction") return "ready";
  return "review";
}

function knowledgeReviewNote(status: string) {
  if (status === "ready") return "knowledge entry approved for reply retrieval";
  if (status === "rejected") return "knowledge entry disabled from reply retrieval";
  return "knowledge entry kept in review";
}

function normalizeConversationOutcome(value: unknown) {
  const outcome = String(value || "").trim().toLowerCase();
  if (outcome === "won" || outcome === "lost" || outcome === "ongoing") return outcome;
  throw new BadRequestException("outcome must be one of won, lost, ongoing");
}

function appendKnowledgeReviewHistory(value: unknown, item: Record<string, unknown>) {
  const history = Array.isArray(value) ? value : [];
  return [...history, item].slice(-50);
}

function buildLocalReviewOperation(scope: string, targetId: string, payload: any, label: string) {
  if (!payload?.operationKey) return null;
  const operationKey = normalizeOperationKey(payload.operationKey, label);
  const effectKey = `${scope}:${operationKey}:${targetId}`;
  const { operationKey: _operationKey, ...reviewPayload } = payload || {};
  return {
    effectKey,
    operation: requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        scope,
        {
          targetId,
          expectedWechatAccountId: reviewPayload.expectedWechatAccountId || null,
          expectedConversationId: reviewPayload.expectedConversationId || null,
          expectedCustomerId: reviewPayload.expectedCustomerId || null,
        },
        reviewPayload,
      ),
    ),
  };
}

function buildLocalKnowledgeImportOperation(operationKey: string, identity: any, source: string, rows: any[] = []) {
  const effectKey = `knowledge-import:${operationKey}`;
  return {
    effectKey,
    operation: requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "knowledge-import",
        {
          source,
          customerId: identity?.customerId || null,
          conversationId: identity?.conversationId || null,
          wechatAccountId: identity?.wechatAccountId || null,
        },
        {
          rows: normalizeKnowledgeImportOperationRows(rows),
        },
      ),
    ),
  };
}

function buildLocalKnowledgeImportFailureOperation(operationKey: string, identity: any, source: string, parsed: any, phase: string) {
  const effectKey = `knowledge-import:${operationKey}`;
  return {
    effectKey,
    operation: requestOperationMetadata(
      operationKey,
      createOperationFingerprint(
        "knowledge-import",
        {
          source,
          customerId: identity?.customerId || null,
          conversationId: identity?.conversationId || null,
          wechatAccountId: identity?.wechatAccountId || null,
        },
        {
          failure: normalizeKnowledgeImportFailure(parsed, phase),
        },
      ),
    ),
  };
}

function normalizeKnowledgeImportFailure(parsed: any = {}, phase = "parse_failed") {
  return {
    phase: String(phase || "parse_failed"),
    ok: Boolean(parsed?.ok),
    importedCount: Number(parsed?.importedCount || 0),
    skippedCount: Number(parsed?.skippedCount || 0),
    errors: normalizeKnowledgeImportErrors(parsed?.errors),
    missingRequiredFields: normalizeKnowledgeImportFields(parsed?.missingRequiredFields),
    blockers: Array.isArray(parsed?.acceptance?.blockers)
      ? parsed.acceptance.blockers.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, 20)
      : [],
  };
}

function normalizeKnowledgeImportErrors(value: any) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 50)
    .map((item) => ({
      line: Number.isFinite(Number(item?.line)) ? Number(item.line) : null,
      message: String(item?.message || item || "").trim(),
    }))
    .filter((item) => item.message);
}

function normalizeKnowledgeImportFields(value: any) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 20)
    .map((item) => typeof item === "string" ? item : String(item?.field || item?.label || "").trim())
    .filter(Boolean);
}

function normalizeKnowledgeImportOperationRows(rows: any[] = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    agentId: String(row?.agentId || "").trim() || null,
    agentKey: String(row?.agentKey || "").trim() || null,
    title: String(row?.title || "").trim(),
    content: String(row?.content || "").trim(),
    tags: normalizeKnowledgeImportTags(row?.tags),
    qualityScore: Number.isFinite(Number(row?.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(row.qualityScore)))) : null,
  }));
}

function findLocalReviewLogByEffectKey(data: StoreData, effectKey: string) {
  const expectedId = deterministicOperationId("review", effectKey);
  return data.reviewLogs.find((log) => log.id === expectedId || String(log?.metadata?.effectKey || "") === effectKey) || null;
}

function preserveKnowledgeImportReviewState(existing: any, incoming: any) {
  return {
    ...incoming,
    status: existing?.status ?? incoming.status,
    reviewer: existing?.reviewer ?? incoming.reviewer,
    reviewNote: existing?.reviewNote ?? incoming.reviewNote,
    reviewedAt: existing?.reviewedAt ?? incoming.reviewedAt,
    reviewHistory: Array.isArray(existing?.reviewHistory) ? existing.reviewHistory : incoming.reviewHistory,
  };
}

function clampKnowledgeScore(value: unknown, fallback: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return Number.isFinite(Number(fallback)) ? Number(fallback) : 70;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function assertKnowledgeEntryReadyForReview(entry: any, status: string) {
  if (status !== "ready") return;
  const blockers: string[] = [];
  if (!String(entry?.agentId || "").trim()) blockers.push("missing_agent");
  if (!String(entry?.title || "").trim()) blockers.push("missing_title");
  if (String(entry?.content || "").trim().length < 20) blockers.push("short_content");
  if (Number(entry?.qualityScore || 0) < 60) blockers.push("low_quality_score");
  if (!normalizeKnowledgeImportTags(entry?.tags).length) blockers.push("missing_tags");
  if (blockers.length) {
    throw new BadRequestException(`knowledge entry cannot be marked ready: ${blockers.join(", ")}`);
  }
}

function normalizeKnowledgeImportTags(value: any, agentKey?: string) {
  const tags = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "").split(/[,、;；|]/).map((item) => item.trim()).filter(Boolean);
  if (agentKey) tags.push(agentKey);
  return [...new Set(tags)];
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

function buildReviewedSceneCheck(status: string, before: any, patch: Record<string, unknown>) {
  const sourceType = String(before.sourceType || (before.importId ? "chat_import" : before.sourceRouteId ? "route_correction" : ""));
  if (sourceType !== "chat_import") return before.sceneCheck || null;
  if (status !== "ready") return before.sceneCheck || null;
  const scene = String(patch.scene || before.scene || "");
  const agentKey = String(patch.agentKey || before.agentKey || "");
  if (!scene || !agentKey) return before.sceneCheck || null;
  const score = Math.max(30, Number(before.sceneScore || 0));
  return {
    status: "clear",
    reason: "human_confirmed_scene",
    needsReview: false,
    topScene: {
      scene,
      agentKey,
      score,
      matchedKeywords: Array.isArray(before.matchedKeywords) ? before.matchedKeywords : [],
    },
    secondaryScene: before.sceneCheck?.secondaryScene || null,
    scoreGap: Math.max(score, Number(before.sceneCheck?.scoreGap || 0)),
  };
}

function summarizeChatImportSceneChecks(samples: any[] = []) {
  const summary = {
    sampleCount: samples.length,
    clearCount: 0,
    weakCount: 0,
    ambiguousCount: 0,
    unmatchedCount: 0,
    sceneUncertainCount: 0,
    readyCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
  };
  for (const sample of samples) {
    const status = String(sample?.sceneCheck?.status || "");
    if (status === "clear") summary.clearCount += 1;
    if (status === "weak") summary.weakCount += 1;
    if (status === "ambiguous") summary.ambiguousCount += 1;
    if (status === "unmatched") summary.unmatchedCount += 1;
    const sampleStatus = String(sample?.status || "ready");
    if (sampleStatus === "ready") summary.readyCount += 1;
    if (sampleStatus === "review") summary.reviewCount += 1;
    if (sampleStatus === "rejected") summary.rejectedCount += 1;
  }
  summary.sceneUncertainCount = summary.weakCount + summary.ambiguousCount + summary.unmatchedCount;
  return summary;
}

function refreshChatImportSceneSummary(data: any, importId?: string, updatedAt?: string) {
  const idValue = String(importId || "");
  if (!idValue) return;
  const record = data.chatImports.find((item: any) => item.id === idValue);
  if (!record) return;
  const samples = data.trainingSamples.filter((sample: any) => sample.importId === idValue);
  record.sceneSummary = summarizeChatImportSceneChecks(samples);
  record.updatedAt = updatedAt || new Date().toISOString();
}

function buildTrainingSampleChangedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return ["agentKey", "scene", "sceneCheck", "customerText", "idealReply", "score", "skillHints", "status"]
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
    "inboundMessageOperations",
    "wechatWindowSnapshots",
    "skus",
    "skuChangeLogs",
    "designAssets",
    "designJobs",
    "designImages",
    "designRevisions",
    "designPlatformExecutions",
    "notifications",
    "sendTasks",
    "sendAttempts",
    "quoteDrafts",
    "orderDrafts",
    "paymentEvents",
    "reviewLogs",
    "agents",
    "agentSkills",
    "chatImports",
    "trainingSamples",
    "knowledgeEntries",
    "routeEvaluations",
    "agentTasks",
    "agentTaskSteps",
    "agentTaskApprovals",
    "agentTaskToolExecutions",
    "automationRuns",
    "wechatWorkBindings",
    "wechatWorkAuditLogs",
    "wechatWorkCustomerUpgrades",
    "wechatWorkSyncCursors",
    "personalWechatRpaBindings",
    "personalWechatRpaAuditLogs",
  ];
  for (const key of keys) {
    if (!Array.isArray(normalized[key])) {
      (normalized[key] as any[]) = [];
      changed = true;
    }
  }

  for (const image of normalized.designImages) {
    const fingerprint = String(image?.fingerprint || "").trim();
    if (!fingerprint || /^dhash64:v1:[a-f0-9]{16}$/i.test(fingerprint)) continue;
    if (!String(image?.legacyIdentityHash || "").trim()) image.legacyIdentityHash = fingerprint;
    delete image.fingerprint;
    changed = true;
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
  changed = syncDemoSkuCatalog(normalized, now) || changed;
  changed = syncStarterKnowledgeBase(normalized, now) || changed;
  changed = pruneWechatWindowSnapshots(normalized) || changed;

  return { data: normalized, changed };
}

function normalizePaymentEventAmount(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException("payment event amount must be a non-negative number");
  return Math.round(amount * 100) / 100;
}

function assertLocalPaymentEventReplay(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const stored = localPaymentEventReplaySnapshot(existing);
  const requested = localPaymentEventReplaySnapshot(incoming);
  const storedFingerprint = createOperationFingerprint("local-payment-event-replay", {}, stored);
  const requestedFingerprint = createOperationFingerprint("local-payment-event-replay", {}, requested);
  if (storedFingerprint === requestedFingerprint) return;
  throw new ConflictException({
    code: "OPERATION_KEY_REUSED",
    message: "payment event operationKey was already used with different payment proof details",
  });
}

function localPaymentEventReplaySnapshot(event: Record<string, unknown>) {
  return {
    quoteDraftId: cleanOptionalString(event.quoteDraftId),
    orderDraftId: cleanOptionalString(event.orderDraftId),
    customerId: cleanOptionalString(event.customerId),
    conversationId: cleanOptionalString(event.conversationId),
    wechatAccountId: cleanOptionalString(event.wechatAccountId),
    paymentStatus: cleanOptionalString(event.paymentStatus),
    amountCny: normalizePaymentEventAmount(event.amountCny),
    method: cleanOptionalString(event.method),
    proofReference: cleanOptionalString(event.proofReference),
    reviewer: cleanOptionalString(event.reviewer),
    note: cleanOptionalString(event.note),
    source: cleanOptionalString(event.source) || "manual_payment_proof",
    idempotencyKey: cleanOptionalString(event.idempotencyKey),
  };
}

function cleanOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function pruneWechatWindowSnapshots(data: StoreData) {
  const snapshots = Array.isArray(data.wechatWindowSnapshots) ? data.wechatWindowSnapshots : [];
  if (snapshots.length <= MAX_WECHAT_WINDOW_SNAPSHOTS) return false;

  const referencedIds = new Set(
    (Array.isArray(data.sendAttempts) ? data.sendAttempts : [])
      .map((attempt) => String(attempt?.windowSnapshotId || "").trim())
      .filter(Boolean),
  );
  const latestIds = new Set(
    [...snapshots]
      .sort((a, b) => String(b?.capturedAt || b?.createdAt || "").localeCompare(String(a?.capturedAt || a?.createdAt || "")))
      .slice(0, MAX_WECHAT_WINDOW_SNAPSHOTS)
      .map((snapshot) => String(snapshot?.id || "").trim())
      .filter(Boolean),
  );
  const next = snapshots.filter((snapshot) => {
    const snapshotId = String(snapshot?.id || "").trim();
    return latestIds.has(snapshotId) || referencedIds.has(snapshotId);
  });
  if (next.length === snapshots.length) return false;
  data.wechatWindowSnapshots = next;
  return true;
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

const DEMO_SKU_CODES = new Set([
  "BOX-A",
  "TEA-A",
  "TEA-B",
  "CARD-A",
  "BOX-C",
  "TEA-D",
  "CARD-C",
  "BOX-REAL-1",
  "TEA-REAL-1",
  "CARD-REAL-MANUAL",
  "OPS-REAL-1",
  "PREVIEW-ONLY-1",
  "IMG-REAL-1",
]);

function demoSkuImageUrl(skuCode: string) {
  return `https://app.zhenxiai.cloud/smart-kefu/starter-skus/${String(skuCode || "").toLowerCase()}.png`;
}

function buildDemoSkuCatalog(now: string) {
  return [
    {
      id: "sku_box_a",
      skuCode: "BOX-A",
      name: "红金礼盒A",
      type: "gift_box",
      category: "礼盒",
      sceneTags: ["员工福利", "节日礼赠", "客户拜访"],
      costPrice: 18,
      salePrice: 40,
      stock: 150,
      dimensions: { lengthCm: 32, widthCm: 24, heightCm: 9 },
      weightGram: 420,
      material: "特种纸板+烫金",
      supplier: "杭州礼盒厂",
      leadTimeDays: 3,
      mainImagePath: demoSkuImageUrl("BOX-A"),
      imageUrl: demoSkuImageUrl("BOX-A"),
      angleImages: [demoSkuImageUrl("BOX-A")],
      matchingRules: {},
      replacementSkuCodes: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_box_c",
      skuCode: "BOX-C",
      name: "商务礼盒C",
      type: "gift_box",
      category: "礼盒",
      sceneTags: ["员工福利", "节日礼赠", "客户拜访"],
      costPrice: 42,
      salePrice: 85,
      stock: 90,
      dimensions: { lengthCm: 34, widthCm: 24, heightCm: 10 },
      weightGram: 620,
      material: "硬质灰板+哑膜",
      supplier: "杭州礼盒厂",
      leadTimeDays: 5,
      mainImagePath: demoSkuImageUrl("BOX-C"),
      imageUrl: demoSkuImageUrl("BOX-C"),
      angleImages: [demoSkuImageUrl("BOX-C"), `${demoSkuImageUrl("BOX-C").replace(".png", "-open.png")}`],
      matchingRules: { preferWith: ["TEA-D", "CARD-C"] },
      replacementSkuCodes: ["BOX-REAL-1"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_box_real_1",
      skuCode: "BOX-REAL-1",
      name: "红金商务礼盒",
      type: "gift_box",
      category: "礼盒",
      sceneTags: ["员工福利", "客户拜访", "企业礼赠"],
      costPrice: 42,
      salePrice: 88,
      stock: 80,
      dimensions: { lengthCm: 30, widthCm: 22, heightCm: 9 },
      weightGram: 650,
      material: "特种纸板+红金烫印",
      supplier: "杭州礼盒厂",
      leadTimeDays: 5,
      mainImagePath: demoSkuImageUrl("BOX-REAL-1"),
      imageUrl: demoSkuImageUrl("BOX-REAL-1"),
      angleImages: [demoSkuImageUrl("BOX-REAL-1"), `${demoSkuImageUrl("BOX-REAL-1").replace(".png", "-side.png")}`],
      matchingRules: { preferWith: ["TEA-REAL-1", "CARD-REAL-MANUAL"] },
      replacementSkuCodes: ["BOX-C", "IMG-REAL-1"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_img_real_1",
      skuCode: "IMG-REAL-1",
      name: "深蓝商务礼盒",
      type: "gift_box",
      category: "礼盒",
      sceneTags: ["客户拜访", "企业礼赠"],
      costPrice: 40,
      salePrice: 98,
      stock: 55,
      dimensions: { lengthCm: 30, widthCm: 22, heightCm: 9 },
      weightGram: 650,
      material: "硬质礼盒+深蓝特种纸",
      supplier: "图片验证供应商",
      leadTimeDays: 4,
      mainImagePath: demoSkuImageUrl("IMG-REAL-1"),
      imageUrl: demoSkuImageUrl("IMG-REAL-1"),
      angleImages: [demoSkuImageUrl("IMG-REAL-1"), `${demoSkuImageUrl("IMG-REAL-1").replace(".png", "-open.png")}`],
      matchingRules: { preferWith: ["OPS-REAL-1", "CARD-REAL-MANUAL"] },
      replacementSkuCodes: ["BOX-REAL-1"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_tea_a",
      skuCode: "TEA-A",
      name: "茶叶礼品A",
      type: "item",
      category: "内搭",
      sceneTags: ["员工福利", "节日礼赠"],
      costPrice: 58,
      salePrice: 118,
      stock: 80,
      dimensions: { lengthCm: 16, widthCm: 9, heightCm: 6 },
      weightGram: 280,
      material: "罐装绿茶",
      supplier: "安吉茶礼供应商",
      leadTimeDays: 5,
      mainImagePath: demoSkuImageUrl("TEA-A"),
      imageUrl: demoSkuImageUrl("TEA-A"),
      angleImages: [demoSkuImageUrl("TEA-A")],
      matchingRules: { preferWith: ["CARD-A"] },
      replacementSkuCodes: ["TEA-B"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_tea_b",
      skuCode: "TEA-B",
      name: "茶叶礼品B",
      type: "item",
      category: "内搭",
      sceneTags: ["员工福利", "客户拜访"],
      costPrice: 20,
      salePrice: 45,
      stock: 220,
      dimensions: { lengthCm: 14, widthCm: 8, heightCm: 5 },
      weightGram: 180,
      material: "袋泡茶礼",
      supplier: "安吉茶礼供应商",
      leadTimeDays: 3,
      mainImagePath: demoSkuImageUrl("TEA-B"),
      imageUrl: demoSkuImageUrl("TEA-B"),
      angleImages: [demoSkuImageUrl("TEA-B")],
      matchingRules: { preferWith: ["CARD-A"] },
      replacementSkuCodes: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_tea_d",
      skuCode: "TEA-D",
      name: "红茶D",
      type: "item",
      category: "茶叶",
      sceneTags: ["员工福利", "节日礼赠"],
      costPrice: 50,
      salePrice: 90,
      stock: 120,
      dimensions: { lengthCm: 15, widthCm: 9, heightCm: 7 },
      weightGram: 260,
      material: "罐装红茶",
      supplier: "福建茶业供应商",
      leadTimeDays: 4,
      mainImagePath: demoSkuImageUrl("TEA-D"),
      imageUrl: demoSkuImageUrl("TEA-D"),
      angleImages: [demoSkuImageUrl("TEA-D"), `${demoSkuImageUrl("TEA-D").replace(".png", "-detail.png")}`],
      matchingRules: { preferWith: ["BOX-C", "CARD-C"] },
      replacementSkuCodes: ["TEA-A", "TEA-REAL-1"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_tea_real_1",
      skuCode: "TEA-REAL-1",
      name: "乌龙茶礼罐",
      type: "item",
      category: "茶叶",
      sceneTags: ["员工福利", "客户拜访", "企业礼赠"],
      costPrice: 55,
      salePrice: 120,
      stock: 90,
      dimensions: { lengthCm: 12, widthCm: 8, heightCm: 18 },
      weightGram: 300,
      material: "罐装乌龙茶",
      supplier: "福建茶业供应商",
      leadTimeDays: 3,
      mainImagePath: demoSkuImageUrl("TEA-REAL-1"),
      imageUrl: demoSkuImageUrl("TEA-REAL-1"),
      angleImages: [demoSkuImageUrl("TEA-REAL-1"), `${demoSkuImageUrl("TEA-REAL-1").replace(".png", "-detail.png")}`],
      matchingRules: { preferWith: ["BOX-REAL-1", "CARD-REAL-MANUAL"] },
      replacementSkuCodes: ["TEA-A", "TEA-D"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_ops_real_1",
      skuCode: "OPS-REAL-1",
      name: "混合坚果礼罐",
      type: "item",
      category: "坚果",
      sceneTags: ["员工福利", "客户拜访", "企业礼赠"],
      costPrice: 30,
      salePrice: 72,
      stock: 160,
      dimensions: { lengthCm: 12, widthCm: 12, heightCm: 16 },
      weightGram: 420,
      material: "混合坚果礼罐",
      supplier: "杭州坚果供应商",
      leadTimeDays: 3,
      mainImagePath: demoSkuImageUrl("OPS-REAL-1"),
      imageUrl: demoSkuImageUrl("OPS-REAL-1"),
      angleImages: [demoSkuImageUrl("OPS-REAL-1"), `${demoSkuImageUrl("OPS-REAL-1").replace(".png", "-side.png")}`],
      matchingRules: { preferWith: ["IMG-REAL-1", "CARD-REAL-MANUAL"] },
      replacementSkuCodes: ["TEA-B", "PREVIEW-ONLY-1"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_preview_only_1",
      skuCode: "PREVIEW-ONLY-1",
      name: "茶点小食礼罐",
      type: "item",
      category: "茶点",
      sceneTags: ["员工福利", "节日礼赠"],
      costPrice: 12,
      salePrice: 29,
      stock: 180,
      dimensions: { lengthCm: 10, widthCm: 10, heightCm: 8 },
      weightGram: 260,
      material: "烘焙小食礼罐",
      supplier: "杭州茶点供应商",
      leadTimeDays: 3,
      mainImagePath: demoSkuImageUrl("PREVIEW-ONLY-1"),
      imageUrl: demoSkuImageUrl("PREVIEW-ONLY-1"),
      angleImages: [demoSkuImageUrl("PREVIEW-ONLY-1"), `${demoSkuImageUrl("PREVIEW-ONLY-1").replace(".png", "-detail.png")}`],
      matchingRules: { preferWith: ["BOX-A", "CARD-A"] },
      replacementSkuCodes: ["TEA-B", "OPS-REAL-1"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_card_a",
      skuCode: "CARD-A",
      name: "定制贺卡A",
      type: "accessory",
      category: "贺卡",
      sceneTags: ["员工福利", "节日礼赠", "客户拜访"],
      costPrice: 2,
      salePrice: 8,
      stock: 500,
      dimensions: { lengthCm: 12, widthCm: 8, heightCm: 0.2 },
      weightGram: 15,
      material: "特种纸",
      supplier: "杭州礼盒厂",
      leadTimeDays: 2,
      mainImagePath: demoSkuImageUrl("CARD-A"),
      imageUrl: demoSkuImageUrl("CARD-A"),
      angleImages: [demoSkuImageUrl("CARD-A")],
      matchingRules: {},
      replacementSkuCodes: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_card_c",
      skuCode: "CARD-C",
      name: "祝福卡C",
      type: "accessory",
      category: "贺卡",
      sceneTags: ["员工福利", "节日礼赠", "客户拜访"],
      costPrice: 2,
      salePrice: 8,
      stock: 800,
      dimensions: { lengthCm: 12, widthCm: 8, heightCm: 0.2 },
      weightGram: 15,
      material: "特种纸",
      supplier: "杭州礼盒厂",
      leadTimeDays: 2,
      mainImagePath: demoSkuImageUrl("CARD-C"),
      imageUrl: demoSkuImageUrl("CARD-C"),
      angleImages: [demoSkuImageUrl("CARD-C")],
      matchingRules: { preferWith: ["BOX-C", "TEA-D"] },
      replacementSkuCodes: ["CARD-A", "CARD-REAL-MANUAL"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sku_card_real_manual",
      skuCode: "CARD-REAL-MANUAL",
      name: "手写感谢卡",
      type: "accessory",
      category: "贺卡",
      sceneTags: ["客户拜访", "员工福利", "企业礼赠"],
      costPrice: 4,
      salePrice: 15,
      stock: 600,
      dimensions: { lengthCm: 15, widthCm: 10, heightCm: 0.2 },
      weightGram: 25,
      material: "棉感卡纸+烫金",
      supplier: "本地印刷厂",
      leadTimeDays: 2,
      mainImagePath: demoSkuImageUrl("CARD-REAL-MANUAL"),
      imageUrl: demoSkuImageUrl("CARD-REAL-MANUAL"),
      angleImages: [demoSkuImageUrl("CARD-REAL-MANUAL"), `${demoSkuImageUrl("CARD-REAL-MANUAL").replace(".png", "-back.png")}`],
      matchingRules: { preferWith: ["BOX-REAL-1", "TEA-REAL-1"] },
      replacementSkuCodes: ["CARD-A", "CARD-C"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function syncDemoSkuCatalog(data: StoreData, now: string) {
  if (!Array.isArray(data.skus) || !data.skus.some((sku) => DEMO_SKU_CODES.has(String(sku?.skuCode || "")))) {
    return false;
  }

  let changed = false;
  const demoSkus = buildDemoSkuCatalog(now);
  for (const demoSku of demoSkus) {
    const index = data.skus.findIndex((sku) => sku.skuCode === demoSku.skuCode);
    if (index < 0) {
      data.skus.push(demoSku);
      changed = true;
      continue;
    }

    const current = data.skus[index];
    const next = mergeDemoSku(current, demoSku);

    if (!sameValue(current, next)) {
      data.skus[index] = { ...next, updatedAt: now };
      changed = true;
    }
  }
  return changed;
}

function mergeDemoSku(current: any, demoSku: any) {
  const next = {
    ...current,
    ...demoSku,
    id: current.id || demoSku.id,
    createdAt: current.createdAt || demoSku.createdAt,
    updatedAt: current.updatedAt || demoSku.updatedAt,
  };
  const mainImagePath = preservedCustomSkuImageReference(current.mainImagePath, demoSku.mainImagePath);
  if (mainImagePath) next.mainImagePath = mainImagePath;
  const imageUrl = preservedCustomSkuImageReference(current.imageUrl, demoSku.imageUrl);
  if (imageUrl) next.imageUrl = imageUrl;
  const angleImages = preservedCustomSkuAngleImages(current.angleImages);
  if (angleImages) next.angleImages = angleImages;
  return next;
}

function preservedCustomSkuAngleImages(value: unknown) {
  if (!Array.isArray(value)) return null;
  const refs = value.map((item) => String(item || "").trim()).filter(Boolean);
  const preserved = refs.filter((reference) => shouldPreserveCustomSkuImageReference(reference));
  return preserved.length ? preserved : null;
}

function preservedCustomSkuImageReference(current: unknown, fallback: unknown) {
  const value = String(current || "").trim();
  if (!value || value === String(fallback || "").trim()) return "";
  return shouldPreserveCustomSkuImageReference(value) ? value : "";
}

function shouldPreserveCustomSkuImageReference(value: unknown) {
  const reference = String(value || "").trim();
  if (!reference || isStarterSkuImageUrl(reference)) return false;
  if (isSafeLocalSkuImageReference(reference)) return true;
  if (/^https?:\/\//i.test(reference) || /^data:image\//i.test(reference) || reference.startsWith("/")) return true;
  if (!path.isAbsolute(reference)) return false;
  try {
    return fs.existsSync(reference) && fs.statSync(reference).isFile();
  } catch {
    return false;
  }
}

function isSafeLocalSkuImageReference(value: string) {
  return (
    /^storage\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(value)
    && !value.includes("..")
    && !value.includes("//")
  );
}

function isStarterSkuImageUrl(value: string) {
  return /^https:\/\/app\.zhenxiai\.cloud\/smart-kefu\/starter-skus\//i.test(String(value || "").trim());
}

function buildStarterKnowledgeEntries(now: string) {
  return [
    starterKnowledge("knowledge_starter_pre_sales_quote", "agent_pre_sales", "报价与预算澄清 SOP", [
      "客户只问价格时，先确认用途、数量、单盒预算、交付时间和是否需要企业 Logo 定制。",
      "低预算客户优先推荐 BOX-A + TEA-B + CARD-A 的组合；高预算或客户拜访场景优先推荐红金商务礼盒、乌龙茶礼罐和手写感谢卡。",
      "自动报价只能基于商品库中启用、库存充足、成本价和售价完整的 SKU；高价值订单需要人工复核后发送。",
    ], ["报价", "预算", "商品推荐"], now),
    starterKnowledge("knowledge_starter_design_material", "agent_gift_design", "臻希 AI 出图素材 SOP", [
      "所有生成图片任务必须调用臻希 AI，不允许接入其它图片生成后端。",
      "提交设计前必须收齐商品 SKU、客户 Logo 或品牌素材、主色、用途、预算和输出数量。",
      "缺真实商品图时不得进入正式自动出图，只能提示运营在商品库补图或使用本地 smoke/demo 图片做内部测试。",
    ], ["臻希AI", "出图", "素材"], now),
    starterKnowledge("knowledge_starter_review_policy", "agent_general", "人工审核与自动化边界", [
      "企业微信是唯一外部微信生产渠道；个人微信 RPA 只能作为本地人工确认辅助，默认关闭。",
      "金额高、客户身份不明确、素材缺失、报价异常、发货异常和售后争议都必须进入人工审核。",
      "自动发送前必须通过发送队列守卫，缺少适配器、身份凭证或人工确认时保持阻断。",
    ], ["审核", "企微", "自动化边界"], now),
    starterKnowledge("knowledge_starter_order_payment", "agent_order_payment", "下单支付核对 SOP", [
      "客户确认方案后，先复述 SKU 组合、数量、总价、交付时间、收货信息和发票需求。",
      "收款前不得承诺已排产；付款凭证和订单金额不一致时进入人工复核。",
      "订单变更需要记录变更前后字段，避免报价、出图和发货数据错位。",
    ], ["订单", "支付", "复核"], now),
    starterKnowledge("knowledge_starter_delivery", "agent_logistics_exception", "发货与物流异常 SOP", [
      "催发货先核对订单状态、预计交期、供应商交付节点和快递单号。",
      "物流超过 24 小时无更新时建立跟进任务；破损、少件、错发需要收集照片和包裹面单。",
      "无法确认原因时只承诺正在核实，不得编造物流状态。",
    ], ["发货", "物流", "异常"], now),
    starterKnowledge("knowledge_starter_after_sales", "agent_after_sales", "售后补发退款 SOP", [
      "售后先判断类型：破损、少件、错发、质量问题、退款退货或客户主观不满意。",
      "破损少件优先补发；质量争议和退款退货需要人工复核订单、照片和责任归属。",
      "安抚话术要先承认问题和给处理时效，再说明所需凭证。",
    ], ["售后", "补发", "退款"], now),
  ];
}

function starterKnowledge(idValue: string, agentId: string, title: string, paragraphs: string[], tags: string[], now: string) {
  return {
    id: idValue,
    agentId,
    sourceType: "starter_knowledge",
    sourceId: null,
    title,
    content: paragraphs.join("\n"),
    tags,
    qualityScore: 96,
    status: "ready",
    reviewer: "system",
    reviewNote: "starter knowledge is bundled product SOP",
    reviewedAt: now,
    reviewHistory: [{ status: "ready", reviewer: "system", note: "starter knowledge is bundled product SOP", reviewedAt: now }],
    createdAt: now,
    updatedAt: now,
  };
}

function syncStarterKnowledgeBase(data: StoreData, now: string) {
  const starterSeedPresent =
    data.knowledgeEntries.some((entry) => entry?.sourceType === "starter_knowledge") ||
    data.skus.some((sku) => DEMO_SKU_CODES.has(String(sku?.skuCode || ""))) ||
    data.wechatAccounts.some((account) => String(account?.id || "").startsWith("wechat_demo_"));
  if (!starterSeedPresent) return false;

  let changed = false;
  for (const starter of buildStarterKnowledgeEntries(now)) {
    const index = data.knowledgeEntries.findIndex((entry) => entry.id === starter.id);
    if (index < 0) {
      data.knowledgeEntries.push(starter);
      changed = true;
      continue;
    }
    const current = data.knowledgeEntries[index];
    const next = {
      ...current,
      ...starter,
      createdAt: current.createdAt || starter.createdAt,
      updatedAt: current.updatedAt || starter.updatedAt,
      reviewedAt: current.reviewedAt || starter.reviewedAt,
      reviewHistory: Array.isArray(current.reviewHistory) && current.reviewHistory.length
        ? current.reviewHistory
        : starter.reviewHistory,
    };
    if (!sameValue(current, next)) {
      const reviewHistory = Array.isArray(current.reviewHistory) ? current.reviewHistory : [];
      data.knowledgeEntries[index] = {
        ...next,
        reviewedAt: now,
        reviewHistory: [
          ...reviewHistory,
          { status: "ready", reviewer: "system", note: "starter knowledge bundle updated", reviewedAt: now },
        ],
        updatedAt: now,
      };
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
  const skus = buildDemoSkuCatalog(now);
  const agentConfig = seedAgentConfig(now);
  const knowledgeEntries = buildStarterKnowledgeEntries(now);
  return {
    wechatAccounts: [wechatAccount, wechatAccount2],
    customers: [customer, customer2],
    conversations: [conversation, conversation2],
    messages: [
      { id: "msg_demo_1", conversationId: conversation.id, direction: "inbound", text: "我想看端午礼盒效果图", createdAt: now },
      { id: "msg_demo_2", conversationId: conversation2.id, direction: "inbound", text: "我们要做一批企业伴手礼，预算比较高", createdAt: now },
    ],
    inboundMessageOperations: [],
    wechatWindowSnapshots: [],
    skus,
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    designPlatformExecutions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    paymentEvents: [],
    reviewLogs: [],
    agents: agentConfig.agents,
    agentSkills: agentConfig.agentSkills,
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries,
    routeEvaluations: [],
    agentTasks: [],
    agentTaskSteps: [],
    agentTaskApprovals: [],
    agentTaskToolExecutions: [],
    automationRuns: [],
    wechatWorkBindings: [],
    wechatWorkAuditLogs: [],
    wechatWorkCustomerUpgrades: [],
    wechatWorkSyncCursors: [],
    personalWechatRpaBindings: [],
    personalWechatRpaAuditLogs: [],
  };
}

function personalWechatRpaBindingKey(ownerWxId: string, chatTitle: string) {
  return createHash("sha256")
    .update(`${String(ownerWxId || "").trim()}\n${String(chatTitle || "").trim()}`, "utf8")
    .digest("hex");
}

function normalizeInstant(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new BadRequestException("timestamp must be a valid ISO date");
  return new Date(timestamp).toISOString();
}

function shortExternalId(value: string) {
  const text = String(value || "");
  return text.length <= 10 ? text : text.slice(-10);
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

function mergeLocalRefundResolution(value: unknown, resolution: string, reviewer: string) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const summary: Record<string, unknown> = {};
  for (const key of ["reason", "requestedCredits", "refundedCredits", "chargedCredits", "mode", "alreadyRefunded"]) {
    const item = source[key];
    if (typeof item === "number" && Number.isFinite(item)) summary[key] = item;
    else if (typeof item === "boolean") summary[key] = item;
    else if (typeof item === "string") summary[key] = item.slice(0, 120);
  }
  return {
    ...summary,
    resolution,
    reviewer: String(reviewer || "").trim().replace(/[^\p{L}\p{N}_.@-]/gu, "_").slice(0, 80),
  };
}

const TRUSTED_RPA_CAPTURE_SOURCES = new Set(["uia_accessibility", "ocr_verified_bubble"]);

function isTrustedConversationMessage(message: any, rpaMessageIds: Set<string>) {
  if (isSyntheticConversationText(message?.text)) return false;
  if (message?.direction !== "inbound" || !rpaMessageIds.has(String(message?.id || ""))) return true;
  return TRUSTED_RPA_CAPTURE_SOURCES.has(String(message?.metadata?.inboundCaptureSource || ""));
}

function isWechatWorkPlaceholderName(value: unknown) {
  return /^企业微信客户(?:\s|$)/.test(String(value || "").trim());
}

function isSyntheticConversationText(value: unknown) {
  const text = String(value || "").trim();
  return text === "你的回复内容" || /^RPA入站测试(?:-|$)/i.test(text);
}

export function seedAgentConfig(now: string) {
  const agents = [
    {
      id: "agent_pre_sales",
      key: "pre_sales",
      name: "小石售前 Agent",
      scene: "售前咨询、商品推荐、价格解释",
      description: "依据小石真人样本识别需求、数量、预算与偏好，用微信短句推进客户确认方案。",
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
    ["agent_pre_sales", "小石式单点追问", "根据客户已经给出的信息，只补问当前最关键的一项；短问短答，不把用途、预算、数量和交期一次问完。"],
    ["agent_pre_sales", "小石式价格异议承接", "客户询价或觉得贵时，先问数量或预算，再说明礼品可以调整；不承诺最低价。"],
    ["agent_pre_sales", "小石式搭配变更确认", "客户要删除或更换礼盒内容时，先确认保留项、数量或预期价格，再重新核价。"],
    ["agent_pre_sales", "小石式偏好翻译", "把太可爱、不喜欢、不好看等否定表达转成简单、商务、大气等正向偏好。"],
    ["agent_pre_sales", "小石式柔和收口", "客户明确不做、再看看或预算暂时不合适时，简短收口并保留以后再联系的空间。"],
    ["agent_gift_design", "预算澄清", "识别每份预算或总预算加数量，并折算单份预算。"],
    ["agent_gift_design", "设计需求确认", "收集 Logo、参考图、文案、风格、礼盒搭配和出图数量。"],
    ["agent_gift_design", "高价值转人工", "总额或单份金额达到阈值时要求人工审核报价和图片。"],
    ["agent_order_payment", "订单信息核对", "先确认订单号、付款状态、地址和发票信息，不跨会话处理订单。"],
    ["agent_order_payment", "付款说明", "说明定金、尾款、支付状态和下一步处理，不承诺未核实的到账结果。"],
    ["agent_logistics_exception", "物流安抚", "先承接情绪，再说明核查和处理动作。"],
    ["agent_after_sales", "售后方案", "区分退款、退货、换货、补发，敏感争议不自动承诺赔付。"],
    ["agent_after_sales", "高情商话术", "避免机械模板，使用自然、负责、明确下一步的表达。"],
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

function assertAgentTaskReplay(existing: any, payload: any, operationKey: string) {
  const expectedIdentity = payload.identity || payload;
  const storedIdentity = {
    wechatAccountId: String(existing.wechatAccountId || ""),
    conversationId: String(existing.conversationId || ""),
    customerId: String(existing.customerId || ""),
  };
  for (const key of ["wechatAccountId", "conversationId", "customerId"] as const) {
    const expected = String(expectedIdentity?.[key] || "");
    if (expected && storedIdentity[key] && expected !== storedIdentity[key]) {
      throw new BadRequestException(`agent task replay changed ${key}: ${operationKey}`);
    }
  }
  const expectedObjective = String(payload.objective || "");
  if (expectedObjective && String(existing.objective || "") && expectedObjective !== String(existing.objective)) {
    throw new BadRequestException(`agent task replay changed objective: ${operationKey}`);
  }
}
