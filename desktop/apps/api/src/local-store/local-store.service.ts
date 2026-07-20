import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { routingCorrectionRequestKey } from "../shared/routing-correction";
import {
  assertExactOperationReplay,
  createChatImportOperationFingerprint,
  deterministicOperationId,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
} from "../shared/operation-idempotency";

const {
  diagnoseWechatWindowSnapshot,
  evaluateTrainingSampleQuality,
  inspectBundleAutomationReadiness,
  isHighValueBudget,
  isSceneClarificationReply,
  isTrainingSampleReady,
  latestCandidateRound,
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
  designPlatformExecutions: any[];
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
  wechatWorkBindings: any[];
  wechatWorkAuditLogs: any[];
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

  upsertWechatWorkBinding(payload: { openKfid: string; externalUserId: string; sendTime?: number }) {
    const openKfid = String(payload.openKfid || "").trim();
    const externalUserId = String(payload.externalUserId || "").trim();
    if (!openKfid || !externalUserId) throw new Error("wechat work binding requires openKfid and externalUserId");
    const data = this.read();
    const now = new Date().toISOString();
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
    if (!customer) {
      customer = {
        id: id("customer"),
        name: `企业微信客户 ${shortExternalId(externalUserId)}`,
        wechatId: null,
        source: "wechat_work_kf",
        wechatWorkExternalUserId: externalUserId,
        tags: ["企业微信客服"],
        createdAt: now,
        updatedAt: now,
      };
      data.customers.push(customer);
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
        lastMessageAt: payload.sendTime ? new Date(payload.sendTime * 1000).toISOString() : null,
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
      lastInboundAt: payload.sendTime ? new Date(payload.sendTime * 1000).toISOString() : current?.lastInboundAt || null,
    };
    if (bindingIndex >= 0) data.wechatWorkBindings[bindingIndex] = binding;
    else data.wechatWorkBindings.push(binding);
    this.write(data);
    return { ...binding, wechatAccount: account, customer, conversation };
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
    const record = {
      id: id("wechat_work_audit"),
      ...payload,
      createdAt: payload.createdAt || new Date().toISOString(),
    };
    data.wechatWorkAuditLogs.push(record);
    if (data.wechatWorkAuditLogs.length > 2000) {
      data.wechatWorkAuditLogs = data.wechatWorkAuditLogs
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 2000);
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
      conversation.lastMessageAt = receivedAt;
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
      lastInboundAt: receivedAt,
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
    const existing = payload.externalId
      ? data.messages.find(
          (message) => message.conversationId === conversation.id && message.externalId === payload.externalId,
        ) || null
      : null;
    if (existing) {
      return {
        ...existing,
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
      metadata: payload.metadata || {},
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
      lastMessageAt: record.createdAt,
      updatedAt: now,
    };
    this.write(data);
    return {
      ...record,
      conversation: this.hydrateConversation(data, data.conversations[conversationIndex]),
    };
  }

  listConversationTimeline(filter: IdentityListFilter & { limit?: number }) {
    const data = this.read();
    const identity = this.requireCompleteConversationIdentity(data, filter, "message history");
    const limit = Math.max(1, Math.min(Number(filter.limit || 300), 500));
    const messages = data.messages
      .filter((message) => message.conversationId === identity.conversationId)
      .map((message) => ({
        ...message,
        source: "message",
        customerId: identity.customerId,
        wechatAccountId: identity.wechatAccountId,
        status: message.direction === "inbound" ? (message.readAt ? "read" : "unread") : "sent",
        attachments: normalizeTimelineAttachments(message.attachments, message.readAt ? "read" : "received"),
      }));
    const outbound = data.sendTasks
      .filter((task) => task.conversationId === identity.conversationId)
      .map((task) => ({
        id: `send-task:${task.id}`,
        source: "send_task",
        sendTaskId: task.id,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
        wechatAccountId: identity.wechatAccountId,
        direction: "outbound",
        text: String(task.payload?.text || task.payload?.textBeforeImages || ""),
        attachments: timelineTaskAttachments(task),
        status: task.status || "queued",
        errorMessage: task.errorMessage || "",
        createdAt: task.queuedAt || task.createdAt,
        updatedAt: task.updatedAt || task.createdAt,
        sentAt: task.sentAt || null,
        metadata: {
          kind: task.payload?.kind || "text",
          manualReply: task.payload?.source === "manual_reply",
        },
      }));
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
      adapter: "art_image_local",
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

  listKnowledgeEntries(filter: string | ({ agentId?: string } & IdentityListFilter) = {}) {
    const data = this.read();
    const options = typeof filter === "string" ? { agentId: filter } : filter;
    return data.knowledgeEntries
      .filter((entry) => {
        const sample = entry.sourceId ? data.trainingSamples.find((item) => item.id === entry.sourceId) : null;
        return !sample || isTrainingSampleReady(sample);
      })
      .filter((entry) => !localStoreIsSceneClarificationKnowledgeEntry(data, entry))
      .filter((entry) => !options.agentId || entry.agentId === options.agentId)
      .filter((entry) => this.matchesIdentityFilter(entry, options))
      .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0));
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
      routingPolicy: result.routingPolicy || null,
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
    const identity = this.validateOptionalConversationBinding(data, payload, "chat import");
    const operationKey = payload?.operationKey
      ? normalizeOperationKey(payload.operationKey, "chat import operationKey")
      : `legacy:${randomUUID()}`;
    const operation = requestOperationMetadata(
      operationKey,
      createChatImportOperationFingerprint(payload || {}, {
        customerId: identity.customerId,
        conversationId: identity.conversationId,
        wechatAccountId: identity.wechatAccountId,
      }),
    );
    const importId = deterministicOperationId("import", operationKey);
    const existing = data.chatImports.find((item) => item.id === importId);
    if (existing) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existing.identityBinding),
        operation,
        "chat import create",
      );
      const existingSamples = data.trainingSamples
        .filter((sample) => sample.importId === existing.id)
        .map((sample) => this.decorateTrainingSample(sample));
      return { ...existing, samples: existingSamples };
    }
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
        status: score >= 70 ? "ready" : "review",
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
    const now = new Date().toISOString();
    const binding = this.validateSendTaskBinding(data, payload);
    const conversation = data.conversations.find((item) => item.id === payload.conversationId) || null;
    const normalizedPayload = {
      ...payload,
      customerId: payload.customerId || conversation?.customerId || null,
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

  findWechatWorkSendAttemptByMsgId(msgid: string) {
    const data = this.read();
    const attempt = data.sendAttempts
      .filter((item) => item.adapter === "wechat_work_kf")
      .find((item) =>
        item.metadata?.wechatWorkMsgId === msgid
        || item.metadata?.apiMsgId === msgid
        || (Array.isArray(item.metadata?.wechatWorkMsgIds) && item.metadata.wechatWorkMsgIds.includes(msgid))
        || (Array.isArray(item.metadata?.apiMsgIds) && item.metadata.apiMsgIds.includes(msgid))
      );
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
    const record = this.buildReviewLogRecord(data, payload, now);
    data.reviewLogs.push(record);
    this.write(data);
    return record;
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
    this.ensure();
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoreData;
    const normalized = normalizeData(data);
    if (normalized.changed) this.write(normalized.data);
    return normalized.data;
  }

  private write(data: StoreData) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileAtomic(this.filePath, `${JSON.stringify(data, null, 2)}\n`);
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

function isTerminalWechatWorkAudit(record: any) {
  const action = String(record?.action || "").trim();
  const status = String(record?.status || "").trim();
  return (
    (action === "inbound_processed" && status === "processed") ||
    (action === "inbound_ignored" && status === "ignored") ||
    (action === "inbound_duplicate" && status === "duplicate") ||
    (action === "event_processed" && status === "processed") ||
    (action === "send_async_failed" && status === "processed") ||
    (action === "inbound_failed" && status === "permanent_manual_review")
  );
}

function normalizeTimelineAttachments(value: unknown, fallbackStatus: string) {
  if (!Array.isArray(value)) return [];
  return value.filter((attachment) => {
    if (typeof attachment === "string") return Boolean(attachment.trim());
    if (!attachment || typeof attachment !== "object") return false;
    const item = attachment as Record<string, unknown>;
    return [
      item.kind,
      item.type,
      item.msgtype,
      item.mimeType,
      item.contentType,
      item.url,
      item.localPath,
      item.path,
      item.filePath,
      item.name,
      item.fileName,
    ].some((candidate) => Boolean(String(candidate || "").trim()));
  }).map((attachment, index) => {
    const item = attachment && typeof attachment === "object"
      ? attachment as Record<string, unknown>
      : { name: String(attachment || "") };
    const mimeType = String(item.mimeType || item.contentType || "");
    const source = String(item.url || item.localPath || item.path || item.filePath || item.name || "");
    const explicitKind = String(item.kind || item.type || item.msgtype || "").toLowerCase();
    const kind = explicitKind.includes("image") || mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(source)
      ? "image"
      : "file";
    return {
      ...item,
      id: String(item.id || `attachment-${index + 1}`),
      kind,
      name: String(item.name || item.fileName || (source ? path.basename(source) : kind === "image" ? "图片" : "附件")),
      mimeType,
      status: String(item.status || fallbackStatus),
    };
  });
}

function timelineTaskAttachments(task: any) {
  const imagePaths = Array.isArray(task?.payload?.imagePaths) ? task.payload.imagePaths : [];
  const attachments = Array.isArray(task?.payload?.attachments) ? task.payload.attachments : [];
  return normalizeTimelineAttachments(
    [
      ...imagePaths.map((filePath: unknown) => ({ kind: "image", path: String(filePath || "") })),
      ...attachments,
    ],
    String(task?.status || "queued"),
  );
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
    fs.renameSync(tempPath, resolved);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
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
    "reviewLogs",
    "agents",
    "agentSkills",
    "chatImports",
    "trainingSamples",
    "knowledgeEntries",
    "routeEvaluations",
    "automationRuns",
    "wechatWorkBindings",
    "wechatWorkAuditLogs",
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
  changed = pruneWechatWindowSnapshots(normalized) || changed;

  return { data: normalized, changed };
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
    designPlatformExecutions: [],
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
    wechatWorkBindings: [],
    wechatWorkAuditLogs: [],
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

export function seedAgentConfig(now: string) {
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
