import { BadRequestException, Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { appConfig } from "../shared/app-config";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { rules } from "../shared/rules";
import { PrismaOperationsService } from "../prisma/prisma-operations.service";

const {
  canonicalSkillName,
  classifySkillSuggestionQuality,
  compileAgentSkillSuggestions,
  isTrainingSampleNeedingAttention,
  isSkillSuggestionSafeToApply,
  parseChatTranscript,
  summarizeTrainingSamples,
} = rules;

type ChatImportPayload = {
  name?: string;
  source?: string;
  channel?: "wechat" | "xiaohongshu" | "douyin" | "manual";
  agentId?: string;
  customerId?: string;
  conversationId?: string;
  wechatAccountId?: string;
  text: string;
};

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type TrainingSampleReviewPayload = ExpectedIdentityPayload & {
  status: "ready" | "review" | "rejected";
  reviewer?: string;
  note?: string;
  agentId?: string;
  agentKey?: string;
  scene?: string;
  customerText?: string;
  idealReply?: string;
  score?: number;
  skillHints?: string[] | string;
};

type TrainingSampleBatchReviewPayload = {
  sampleIds?: string[];
  status?: "ready" | "review" | "rejected";
  reviewer?: string;
  note?: string;
  expectedBySampleId?: Record<string, ExpectedIdentityPayload>;
};

export type ApplySkillSuggestionsPayload = {
  agentId?: string;
  minScore?: number;
  suggestionKeys?: string[];
  includeNeedsReview?: boolean;
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type SkillSuggestionApplyBlockedReason = "identity_scope_blocked" | "needs_review";

type SkillSuggestionApplyBlocked = Record<string, unknown> & {
  reason: SkillSuggestionApplyBlockedReason;
  quality: {
    level?: string;
    blocked?: boolean;
    needsReview?: boolean;
    reason?: string;
  };
};

type TrainingSampleQualityFilter =
  | "safe"
  | "review"
  | "risk"
  | "blocked"
  | "needs_attention"
  | "scene_uncertain"
  | "anti_wrong_reply"
  | "trainable"
  | "not_trainable"
  | "route_memory"
  | "reply_skill"
  | "route_and_reply";

type ListTrainingSamplesOptions = {
  agentId?: string;
  quality?: string;
  status?: string;
  sourceType?: string;
  importId?: string;
  limit?: number;
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

const MAX_BATCH_REVIEW_SAMPLES = 100;

@Injectable()
export class TrainingService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
    private readonly prismaOperations?: PrismaOperationsService,
  ) {}

  listChatImports(filter: IdentityFilter = {}) {
    if (appConfig.useLocalStore) return this.localStore.listChatImports(filter);
    return this.requirePrisma().listChatImports(filter);
  }

  listSamples(options: string | ListTrainingSamplesOptions = {}) {
    if (!appConfig.useLocalStore) return this.listSamplesPrisma(options);
    const filters = typeof options === "string" ? { agentId: options } : options;
    const quality = normalizeTrainingSampleQualityFilter(filters.quality);
    const status = String(filters.status || "").trim();
    const sourceType = String(filters.sourceType || "").trim();
    const importId = String(filters.importId || "").trim();
    const limit = clampTrainingSampleLimit(filters.limit);
    let samples = this.localStore.listTrainingSamples({
      agentId: filters.agentId,
      wechatAccountId: filters.wechatAccountId,
      conversationId: filters.conversationId,
      customerId: filters.customerId,
    });

    if (quality) samples = samples.filter((sample: any) => matchesTrainingSampleQuality(sample, quality));
    if (status) samples = samples.filter((sample: any) => String(sample.status || "ready") === status);
    if (sourceType) samples = samples.filter((sample: any) => trainingSampleSourceType(sample) === sourceType);
    if (importId) samples = samples.filter((sample: any) => String(sample.importId || "") === importId);
    return limit ? samples.slice(0, limit) : samples;
  }

  getOverview(options: { agentId?: string; minScore?: number; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (!appConfig.useLocalStore) return this.getOverviewPrisma(options);
    const samples = this.localStore.listTrainingSamples(options);
    const agents = this.localStore.listAgents();
    const suggestions = this.listSkillSuggestions(options);
    return summarizeTrainingSamples(samples, agents, suggestions);
  }

  importChat(payload: ChatImportPayload) {
    const parsed = parseChatTranscript(payload.text || "");
    return appConfig.useLocalStore
      ? this.localStore.createChatImport(payload, parsed)
      : this.requirePrisma().createChatImport(payload, parsed);
  }

  reviewSample(id: string, payload: TrainingSampleReviewPayload) {
    if (!appConfig.useLocalStore) return this.reviewSamplePrisma(id, payload);
    const sample = this.localStore.listTrainingSamples().find((item: any) => item.id === id);
    if (!sample) throw new Error(`training sample not found: ${id}`);
    assertExpectedIdentity(sample, payload, "training sample");
    const result = this.localStore.reviewTrainingSample(id, payload || {});
    const statusLabel = result.sample.status === "ready" ? "已确认训练" : result.sample.status === "rejected" ? "已禁用" : "待复核";
    this.notifications.create(
      result.sample.status === "rejected" ? "warning" : "info",
      "训练样本状态已更新",
      `样本「${String(result.sample.customerText || "").slice(0, 24)}」${statusLabel}。`,
      { source: "training_sample_review", trainingSampleId: result.sample.id, status: result.sample.status },
    );
    return result;
  }

  batchReviewSamples(payload: TrainingSampleBatchReviewPayload = {}) {
    const sampleIds = normalizeTrainingSampleIds(payload.sampleIds);
    const status = normalizeTrainingSampleBatchStatus(payload.status);
    if (!sampleIds.length) throw new BadRequestException("sampleIds must include at least one training sample id");
    if (sampleIds.length > MAX_BATCH_REVIEW_SAMPLES) {
      throw new BadRequestException(`sampleIds cannot exceed ${MAX_BATCH_REVIEW_SAMPLES} per batch`);
    }
    const reviewPayload: { status: "ready" | "review" | "rejected"; reviewer: string; note: string } = {
      status,
      reviewer: payload.reviewer || "人工客服",
      note: payload.note || trainingSampleBatchReviewNote(status, sampleIds.length),
    };
    if (!appConfig.useLocalStore) {
      return this.batchReviewSamplesPrisma(sampleIds, reviewPayload, payload.expectedBySampleId || {});
    }
    const samplesById = new Map(this.localStore.listTrainingSamples().map((sample: any) => [sample.id, sample]));
    for (const sampleId of sampleIds) {
      const sample = samplesById.get(sampleId);
      if (!sample) throw new BadRequestException(`training sample not found: ${sampleId}`);
      assertExpectedIdentity(sample, payload.expectedBySampleId?.[sampleId] || {}, "training sample");
    }
    const results = sampleIds.map((sampleId) => this.localStore.reviewTrainingSample(sampleId, reviewPayload));
    this.notifications.create(
      status === "rejected" ? "warning" : "info",
      "训练样本批量状态已更新",
      `已${trainingSampleBatchReviewVerb(status)} ${results.length} 条训练样本。`,
      {
        source: "training_sample_batch_review",
        status,
        count: results.length,
        sampleIds,
      },
    );
    return {
      updated: results.length,
      status,
      sampleIds,
      samples: results.map((result: any) => result.sample),
      reviewLogs: results.map((result: any) => result.reviewLog),
    };
  }

  listSkillSuggestions(options: { agentId?: string; minScore?: number } & IdentityFilter = {}) {
    if (!appConfig.useLocalStore) return this.listSkillSuggestionsPrisma(options);
    const samples = this.localStore.listTrainingSamples({
      agentId: options.agentId,
      wechatAccountId: options.wechatAccountId,
      conversationId: options.conversationId,
      customerId: options.customerId,
    });
    const existingSkills = this.localStore.listAgentSkills(options.agentId, {
      wechatAccountId: options.wechatAccountId,
      conversationId: options.conversationId,
      customerId: options.customerId,
    });
    return compileAgentSkillSuggestions(samples, {
      agentId: options.agentId,
      minScore: options.minScore,
      existingSkills,
    });
  }

  applySkillSuggestions(options: ApplySkillSuggestionsPayload = {}) {
    if (!appConfig.useLocalStore) return this.applySkillSuggestionsPrisma(options);
    const allSuggestions = this.listSkillSuggestions(options);
    const selectedKeys = normalizeSuggestionKeySet(options.suggestionKeys);
    const selectedSuggestions = selectedKeys.size
      ? allSuggestions.filter((suggestion: any) => selectedKeys.has(skillSuggestionKey(suggestion)))
      : allSuggestions;
    const blocked: SkillSuggestionApplyBlocked[] = [];
    const suggestions: any[] = [];
    for (const suggestion of selectedSuggestions) {
      const quality = classifySkillSuggestionQuality(suggestion);
      if (quality.blocked) {
        blocked.push({
          ...suggestion,
          reason: "identity_scope_blocked",
          quality,
        });
      } else if (options.includeNeedsReview || isSkillSuggestionSafeToApply(suggestion)) {
        suggestions.push(suggestion);
      } else {
        blocked.push({
          ...suggestion,
          reason: "needs_review",
          quality,
        });
      }
    }
    const result: any = this.localStore.applyAgentSkillSuggestions(suggestions);
    result.selected = selectedSuggestions.length;
    result.applied = suggestions.length;
    result.filtered = allSuggestions.length - selectedSuggestions.length;
    result.blocked = blocked;
    result.requiresReview = blocked.length;
    const changedCount = result.created.length + result.updated.length;
    if (changedCount > 0) {
      this.notifications.create(
        "info",
        "Agent Skill 已更新",
        `已根据训练样本新增 ${result.created.length} 个 Skill，更新 ${result.updated.length} 个 Skill。`,
        { source: "training", created: result.created.length, updated: result.updated.length },
      );
    }
    return result;
  }

  private async listSamplesPrisma(options: string | ListTrainingSamplesOptions = {}) {
    const filters = typeof options === "string" ? { agentId: options } : options;
    const quality = normalizeTrainingSampleQualityFilter(filters.quality);
    const status = String(filters.status || "").trim();
    const sourceType = String(filters.sourceType || "").trim();
    const importId = String(filters.importId || "").trim();
    const limit = clampTrainingSampleLimit(filters.limit);
    let samples = await this.requirePrisma().listTrainingSamples({
      agentId: filters.agentId,
      wechatAccountId: filters.wechatAccountId,
      conversationId: filters.conversationId,
      customerId: filters.customerId,
    });
    if (quality) samples = samples.filter((sample: any) => matchesTrainingSampleQuality(sample, quality));
    if (status) samples = samples.filter((sample: any) => String(sample.status || "ready") === status);
    if (sourceType) samples = samples.filter((sample: any) => trainingSampleSourceType(sample) === sourceType);
    if (importId) samples = samples.filter((sample: any) => String(sample.importId || "") === importId);
    return limit ? samples.slice(0, limit) : samples;
  }

  private async getOverviewPrisma(options: { agentId?: string; minScore?: number } & IdentityFilter = {}) {
    const [samples, agents, suggestions] = await Promise.all([
      this.requirePrisma().listTrainingSamples(options),
      this.requirePrisma().listAgents(options),
      this.listSkillSuggestionsPrisma(options),
    ]);
    return summarizeTrainingSamples(samples, agents, suggestions);
  }

  private async reviewSamplePrisma(id: string, payload: TrainingSampleReviewPayload) {
    const result = await this.requirePrisma().reviewTrainingSample(id, payload || {});
    const statusLabel = result.sample.status === "ready" ? "已确认训练" : result.sample.status === "rejected" ? "已禁用" : "待复核";
    await this.notifications.create(
      result.sample.status === "rejected" ? "warning" : "info",
      "训练样本状态已更新",
      `样本「${String(result.sample.customerText || "").slice(0, 24)}」${statusLabel}。`,
      { source: "training_sample_review", trainingSampleId: result.sample.id, status: result.sample.status, ...sampleIdentity(result.sample) },
    );
    return result;
  }

  private async batchReviewSamplesPrisma(
    sampleIds: string[],
    reviewPayload: { status: "ready" | "review" | "rejected"; reviewer: string; note: string },
    expectedBySampleId: Record<string, ExpectedIdentityPayload>,
  ) {
    const results = await this.requirePrisma().reviewTrainingSamplesBatch(sampleIds, reviewPayload, expectedBySampleId);
    await this.notifications.create(
      reviewPayload.status === "rejected" ? "warning" : "info",
      "训练样本批量状态已更新",
      `已${trainingSampleBatchReviewVerb(reviewPayload.status)} ${results.length} 条训练样本。`,
      { source: "training_sample_batch_review", status: reviewPayload.status, count: results.length, sampleIds },
    );
    return {
      updated: results.length,
      status: reviewPayload.status,
      sampleIds,
      samples: results.map((result: any) => result.sample),
      reviewLogs: results.map((result: any) => result.reviewLog),
    };
  }

  private async listSkillSuggestionsPrisma(options: { agentId?: string; minScore?: number } & IdentityFilter = {}) {
    const [samples, existingSkills] = await Promise.all([
      this.requirePrisma().listTrainingSamples(options),
      this.requirePrisma().listAgentSkills(options.agentId, options),
    ]);
    return compileAgentSkillSuggestions(samples, {
      agentId: options.agentId,
      minScore: options.minScore,
      existingSkills,
    });
  }

  private async applySkillSuggestionsPrisma(options: ApplySkillSuggestionsPayload = {}) {
    const allSuggestions = await this.listSkillSuggestionsPrisma(options);
    const selectedKeys = normalizeSuggestionKeySet(options.suggestionKeys);
    const selectedSuggestions = selectedKeys.size
      ? allSuggestions.filter((suggestion: any) => selectedKeys.has(skillSuggestionKey(suggestion)))
      : allSuggestions;
    const blocked: SkillSuggestionApplyBlocked[] = [];
    const suggestions: any[] = [];
    for (const suggestion of selectedSuggestions) {
      const quality = classifySkillSuggestionQuality(suggestion);
      if (quality.blocked) blocked.push({ ...suggestion, reason: "identity_scope_blocked", quality });
      else if (options.includeNeedsReview || isSkillSuggestionSafeToApply(suggestion)) suggestions.push(suggestion);
      else blocked.push({ ...suggestion, reason: "needs_review", quality });
    }
    const result: any = await this.requirePrisma().applyAgentSkillSuggestions(suggestions);
    result.selected = selectedSuggestions.length;
    result.applied = suggestions.length;
    result.filtered = allSuggestions.length - selectedSuggestions.length;
    result.blocked = blocked;
    result.requiresReview = blocked.length;
    if (result.created.length + result.updated.length > 0) {
      await this.notifications.create("info", "Agent Skill 已更新", `已根据训练样本新增 ${result.created.length} 个 Skill，更新 ${result.updated.length} 个 Skill。`, { source: "training", created: result.created.length, updated: result.updated.length });
    }
    return result;
  }

  private requirePrisma() {
    if (!this.prismaOperations) throw new Error("PrismaOperationsService is required when USE_LOCAL_STORE=false");
    return this.prismaOperations;
  }
}

function sampleIdentity(sample: any) {
  return {
    wechatAccountId: sample?.wechatAccountId || undefined,
    conversationId: sample?.conversationId || undefined,
    customerId: sample?.customerId || undefined,
  };
}

function normalizeTrainingSampleIds(value?: string[]) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeTrainingSampleBatchStatus(value?: string) {
  if (value === "ready" || value === "review" || value === "rejected") return value;
  throw new BadRequestException("status must be one of ready, review, rejected");
}

function trainingSampleBatchReviewNote(status: "ready" | "review" | "rejected", count: number) {
  if (status === "ready") return `批量确认 ${count} 条训练样本进入训练。`;
  if (status === "rejected") return `批量禁用 ${count} 条训练样本，不参与训练和场景记忆。`;
  return `批量退回 ${count} 条训练样本，等待人工复核。`;
}

function trainingSampleBatchReviewVerb(status: "ready" | "review" | "rejected") {
  if (status === "ready") return "确认";
  if (status === "rejected") return "禁用";
  return "退回复核";
}

function normalizeSuggestionKeySet(value?: string[]) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

function normalizeTrainingSampleQualityFilter(value?: string): TrainingSampleQualityFilter | "" {
  const quality = String(value || "").trim();
  if (!quality || quality === "all") return "";
  if (
    quality === "safe" ||
    quality === "review" ||
    quality === "risk" ||
    quality === "blocked" ||
    quality === "needs_attention" ||
    quality === "scene_uncertain" ||
    quality === "anti_wrong_reply" ||
    quality === "trainable" ||
    quality === "not_trainable" ||
    quality === "route_memory" ||
    quality === "reply_skill" ||
    quality === "route_and_reply"
  ) {
    return quality;
  }
  throw new BadRequestException(
    "quality must be one of safe, review, risk, blocked, needs_attention, scene_uncertain, anti_wrong_reply, trainable, not_trainable, route_memory, reply_skill, route_and_reply, all",
  );
}

function matchesTrainingSampleQuality(sample: any, quality: TrainingSampleQualityFilter) {
  const sampleQuality = sample?.quality || {};
  const usage = sampleQuality.usage || {};
  const level = String(sampleQuality.level || "");
  const flags = Array.isArray(sampleQuality.flags) ? sampleQuality.flags : [];
  if (quality === "needs_attention") return isTrainingSampleNeedingAttention(sample);
  if (quality === "scene_uncertain") return isSceneUncertainTrainingSample(sample);
  if (quality === "anti_wrong_reply") return flags.includes("anti_wrong_reply_only");
  if (quality === "trainable") return sampleQuality.trainable === true;
  if (quality === "not_trainable") return sampleQuality.trainable === false;
  if (quality === "route_memory") return usage.routeMemory === true;
  if (quality === "reply_skill") return usage.replySkill === true;
  if (quality === "route_and_reply") return usage.routeMemory === true && usage.replySkill === true;
  if (quality === "review") return level === "review" && !flags.includes("anti_wrong_reply_only");
  return level === quality;
}

function isSceneUncertainTrainingSample(sample: any) {
  const sourceType = trainingSampleSourceType(sample);
  if (sourceType !== "chat_import") return false;
  const flags = [
    ...(Array.isArray(sample?.quality?.flags) ? sample.quality.flags : []),
    ...(Array.isArray(sample?.quality?.usage?.flags) ? sample.quality.usage.flags : []),
  ];
  if (flags.some((flag) => /^scene_(weak|ambiguous|unmatched)$/.test(String(flag)))) return true;
  const sceneCheckStatus = String(sample?.sceneCheck?.status || "");
  return sceneCheckStatus === "weak" || sceneCheckStatus === "ambiguous" || sceneCheckStatus === "unmatched";
}

function trainingSampleSourceType(sample: any) {
  const sourceType = String(sample?.sourceType || "").trim();
  if (sourceType) return sourceType;
  if (sample?.sourceRouteId) return "route_correction";
  if (sample?.importId) return "chat_import";
  return "";
}

function clampTrainingSampleLimit(value?: number) {
  const limit = Math.floor(Number(value || 0));
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(limit, 500);
}

function skillSuggestionKey(suggestion: any) {
  return String(
    suggestion?.suggestionKey ||
      `${suggestion?.agentId || suggestion?.agentKey || "general"}::${canonicalSkillName(suggestion?.name || "")}`,
  );
}
