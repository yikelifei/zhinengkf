import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { appConfig } from "../shared/app-config";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { rules } from "../shared/rules";
import { PrismaOperationsService } from "../prisma/prisma-operations.service";
import { normalizeOperationKey } from "../shared/operation-idempotency";

const {
  canonicalSkillName,
  classifySkillSuggestionQuality,
  compileAgentSkillSuggestions,
  buildKnowledgeImportTemplateCsv,
  getKnowledgeImportFieldGuide,
  isTrainingSampleNeedingAttention,
  isSkillSuggestionSafeToApply,
  parseKnowledgeImportText,
  parseChatTranscript,
  summarizeTrainingSamples,
  buildAgentReplyDraft,
  analyzeConversationConversion,
  buildConversationLearningInsight,
  evaluateAgentRoute,
} = rules;

type ChatImportPayload = {
  operationKey: string;
  name?: string;
  source?: string;
  channel?: "wechat" | "xiaohongshu" | "douyin" | "manual";
  agentId?: string;
  customerId?: string;
  conversationId?: string;
  wechatAccountId?: string;
  text: string;
};

type KnowledgeImportPayload = IdentityFilter & {
  operationKey?: string;
  source?: string;
  text: string;
};

type KnowledgeImportPreviewPayload = IdentityFilter & {
  operationKey?: string;
  source?: string;
  text: string;
};

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type RagPreviewPayload = IdentityFilter & {
  query: string;
  agentId?: string;
};

type ConversationLearningQuery = IdentityFilter & {
  limit?: number;
};

type ConversationOutcomePayload = ExpectedIdentityPayload & IdentityFilter & {
  operationKey: string;
  outcome: "won" | "lost" | "ongoing";
  reasonCode?: string;
  note?: string;
  reviewer?: string;
};

type TrainingSampleReviewPayload = ExpectedIdentityPayload & {
  status: "ready" | "review" | "rejected";
  operationKey?: string;
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

type KnowledgeEntryReviewPayload = ExpectedIdentityPayload & {
  status: "ready" | "review" | "rejected";
  operationKey?: string;
  reviewer?: string;
  note?: string;
  agentId?: string;
  agentKey?: string;
  title?: string;
  content?: string;
  tags?: string[] | string;
  qualityScore?: number;
};

type TrainingSampleBatchReviewPayload = {
  sampleIds?: string[];
  status?: "ready" | "review" | "rejected";
  operationKey?: string;
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

  async getSample(id: string, filters: IdentityFilter & { agentId?: string } = {}) {
    const sample = appConfig.useLocalStore
      ? this.localStore.listTrainingSamples(filters).find((item: any) => item.id === id)
      : await this.requirePrisma().getTrainingSample(id, filters);
    if (!sample) throw new NotFoundException(`training sample not found: ${id}`);
    return sample;
  }

  getOverview(options: { agentId?: string; minScore?: number; wechatAccountId?: string; conversationId?: string; customerId?: string } = {}) {
    if (!appConfig.useLocalStore) return this.getOverviewPrisma(options);
    const samples = this.localStore.listTrainingSamples(options);
    const agents = this.localStore.listAgents();
    const suggestions = this.listSkillSuggestions(options);
    const knowledgeEntries = this.localStore.listKnowledgeEntries({ ...options, includeReview: true });
    return withKnowledgeSummary(summarizeTrainingSamples(samples, agents, suggestions), knowledgeEntries, agents);
  }

  listKnowledgeEntries(options: { agentId?: string; includeReview?: boolean } & IdentityFilter = {}) {
    if (appConfig.useLocalStore) return this.localStore.listKnowledgeEntries(options);
    return this.requirePrisma().listKnowledgeEntries(options);
  }

  async getConversationLearning(options: ConversationLearningQuery = {}) {
    const limit = Math.max(1, Math.min(Math.floor(Number(options.limit || 50)), 100));
    const bundles = await Promise.resolve(
      appConfig.useLocalStore
        ? this.localStore.listConversationLearningBundles(options, limit)
        : this.requirePrisma().listConversationLearningBundles(options, limit),
    );
    const conversations = bundles.map((bundle: any) => {
      const feedback = analyzeConversationConversion({
        conversation: bundle.conversation,
        messages: bundle.messages,
        routes: bundle.routes,
        quotes: bundle.quotes,
        orders: bundle.orders,
      });
      const learningInsights = (Array.isArray(bundle.routes) ? bundle.routes : []).map((route: any) => (
        route.learningInsight || buildConversationLearningInsight({
          text: route.text || "",
          route,
          observedAt: route.createdAt,
        })
      ));
      return {
        conversation: bundle.conversation,
        feedback,
        learningInsights: learningInsights.slice(-20).reverse(),
        learningObservationCount: learningInsights.length,
        reviewRequiredCount: learningInsights.filter((item: any) => item?.learningPolicy?.status === "review_required").length,
      };
    });
    const reasons = new Map<string, { code: string; label: string; count: number }>();
    for (const item of conversations) {
      if (item.feedback.outcome === "won") continue;
      const reason = item.feedback.primaryReason;
      const current = reasons.get(reason.code) || { code: reason.code, label: reason.label, count: 0 };
      current.count += 1;
      reasons.set(reason.code, current);
    }
    return {
      schema: "conversation_learning_dashboard_v1",
      generatedAt: new Date().toISOString(),
      summary: {
        conversationCount: conversations.length,
        wonCount: conversations.filter((item: any) => item.feedback.outcome === "won").length,
        lostCount: conversations.filter((item: any) => item.feedback.outcome === "lost").length,
        ongoingCount: conversations.filter((item: any) => item.feedback.outcome === "ongoing").length,
        stalledCount: conversations.filter((item: any) => item.feedback.state === "stalled").length,
        learningObservationCount: conversations.reduce((sum: number, item: any) => sum + item.learningObservationCount, 0),
        reviewRequiredCount: conversations.reduce((sum: number, item: any) => sum + item.reviewRequiredCount, 0),
        topReasons: [...reasons.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN")),
      },
      conversations,
      learningPolicy: {
        everyInboundCreatesObservation: true,
        silenceIsNotLoss: true,
        autoPromoteToKnowledge: false,
        reviewRequiredBeforeKnowledgeOrSkill: true,
      },
    };
  }

  async confirmConversationOutcome(conversationId: string, payload: ConversationOutcomePayload) {
    if (!payload?.operationKey) throw new BadRequestException("operationKey is required");
    const trustedPayload = {
      ...payload,
      expectedConversationId: payload.expectedConversationId || conversationId,
    };
    const result = await Promise.resolve(
      appConfig.useLocalStore
        ? this.localStore.confirmConversationOutcome(conversationId, trustedPayload)
        : this.requirePrisma().confirmConversationOutcome(conversationId, trustedPayload),
    );
    const dashboard = await this.getConversationLearning({
      wechatAccountId: payload.expectedWechatAccountId || payload.wechatAccountId,
      conversationId,
      customerId: payload.expectedCustomerId || payload.customerId,
      limit: 1,
    });
    return { ...result, feedback: dashboard.conversations[0]?.feedback || null };
  }

  async previewRag(payload: RagPreviewPayload) {
    const query = String(payload?.query || "").trim();
    if (!query) throw new BadRequestException("query is required");
    if (query.length > 500) throw new BadRequestException("query cannot exceed 500 characters");
    const route = evaluateAgentRoute({ text: query });
    const agents = await Promise.resolve(
      appConfig.useLocalStore ? this.localStore.listAgents() : this.requirePrisma().listAgents(),
    );
    const agent = payload.agentId
      ? agents.find((item: any) => item.id === payload.agentId)
      : agents.find((item: any) => item.key === route.agentKey);
    const identity = {
      wechatAccountId: payload.wechatAccountId,
      conversationId: payload.conversationId,
      customerId: payload.customerId,
    };
    const [knowledgeEntries, skills] = await Promise.all([
      Promise.resolve(this.listKnowledgeEntries({ agentId: agent?.id, includeReview: false, ...identity })),
      Promise.resolve(appConfig.useLocalStore
        ? this.localStore.listAgentSkills(agent?.id, identity)
        : this.requirePrisma().listAgentSkills(agent?.id, identity)),
    ]);
    const draft = buildAgentReplyDraft(route, {
      agentId: agent?.id,
      ...identity,
      knowledgeEntries,
      skills,
    });
    return {
      query,
      route: {
        scene: route.scene,
        agentKey: route.agentKey,
        agentId: agent?.id || null,
        agentName: agent?.name || null,
        action: route.action,
        confidence: route.confidence,
        riskFlags: route.riskFlags || [],
      },
      reply: draft.suggestedReply,
      appliedSkills: draft.appliedSkills,
      knowledgeMatches: draft.knowledgeMatches,
      rag: draft.rag,
      styleProfile: draft.replyDraft?.styleProfile,
      safetyChecks: draft.replyDraft?.safetyChecks || [],
    };
  }

  getKnowledgeImportFields() {
    return getKnowledgeImportFieldGuide();
  }

  getKnowledgeImportTemplate() {
    return {
      fileName: "knowledge-import-template.csv",
      mimeType: "text/csv;charset=utf-8",
      dataBase64: Buffer.from(buildKnowledgeImportTemplateCsv(), "utf8").toString("base64"),
      fields: getKnowledgeImportFieldGuide(),
    };
  }

  previewKnowledgeImport(payload: string | KnowledgeImportPreviewPayload) {
    const request = typeof payload === "string" ? { text: payload } : payload || { text: "" };
    const parsed = parseKnowledgeImportText(request.text || "");
    if ((!parsed.ok || !parsed.rows.length) && request.operationKey) {
      const history = this.recordKnowledgeImportFailure(parsed, request, "preview_failed");
      return { ...parsed, history };
    }
    return parsed;
  }

  async importKnowledge(payload: KnowledgeImportPayload) {
    const parsed = parseKnowledgeImportText(payload.text || "");
    if (!parsed.ok || !parsed.rows.length) {
      const history = payload.operationKey
        ? this.recordKnowledgeImportFailure(parsed, payload, "parse_failed")
        : null;
      return {
        ...parsed,
        saved: { count: 0, results: [], skipped: parsed.errors || [], ...(history ? { reviewLog: history, failed: true } : {}) },
      };
    }
    const context = {
      operationKey: payload.operationKey ? normalizeOperationKey(payload.operationKey, "knowledge import operationKey") : undefined,
      source: payload.source || "manual_knowledge_import",
      wechatAccountId: payload.wechatAccountId,
      conversationId: payload.conversationId,
      customerId: payload.customerId,
    };
    const saved = appConfig.useLocalStore
      ? this.localStore.importKnowledgeEntries(parsed.rows, context)
      : await this.requirePrisma().importKnowledgeEntries(parsed.rows, context);
    return {
      ...parsed,
      saved,
    };
  }

  private recordKnowledgeImportFailure(parsed: any, payload: KnowledgeImportPreviewPayload, phase: "preview_failed" | "parse_failed") {
    const context = {
      operationKey: payload.operationKey ? normalizeOperationKey(payload.operationKey, "knowledge import operationKey") : undefined,
      source: payload.source || "manual_knowledge_import",
      wechatAccountId: payload.wechatAccountId,
      conversationId: payload.conversationId,
      customerId: payload.customerId,
      phase,
    };
    return appConfig.useLocalStore
      ? this.localStore.recordKnowledgeImportFailure(parsed, context)
      : this.requirePrisma().recordKnowledgeImportFailure(parsed, context);
  }

  async reviewKnowledgeEntry(id: string, payload: KnowledgeEntryReviewPayload) {
    const result = appConfig.useLocalStore
      ? this.reviewKnowledgeEntryLocal(id, payload || {})
      : await this.requirePrisma().reviewKnowledgeEntry(id, payload || {});
    const entry = result.knowledgeEntry || {};
    const statusLabel = entry.status === "ready" ? "已启用" : entry.status === "rejected" ? "已停用" : "待复核";
    await this.notifications.create(
      entry.status === "rejected" ? "warning" : "info",
      "知识条目复核状态已更新",
      `知识“${String(entry.title || "").slice(0, 24)}”${statusLabel}。`,
      {
        source: "knowledge_entry_review",
        knowledgeEntryId: entry.id,
        status: entry.status,
        ...reviewNotificationEffect(result.reviewLog),
      },
    );
    return result;
  }

  importChat(payload: ChatImportPayload) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "chat import operationKey");
    const parsed = parseChatTranscript(payload.text || "");
    const normalizedPayload = { ...payload, operationKey };
    return appConfig.useLocalStore
      ? this.localStore.createChatImport(normalizedPayload, parsed)
      : this.requirePrisma().createChatImport(normalizedPayload, parsed);
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
      {
        source: "training_sample_review",
        trainingSampleId: result.sample.id,
        status: result.sample.status,
        ...reviewNotificationEffect(result.reviewLog),
      },
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
    const reviewPayload: { status: "ready" | "review" | "rejected"; operationKey?: string; reviewer: string; note: string } = {
      status,
      ...(payload.operationKey
        ? { operationKey: normalizeOperationKey(payload.operationKey, "training sample batch review operationKey") }
        : {}),
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
        ...batchReviewNotificationEffect(reviewPayload.operationKey),
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
    const [samples, agents, suggestions, knowledgeEntries] = await Promise.all([
      this.requirePrisma().listTrainingSamples(options),
      this.requirePrisma().listAgents(options),
      this.listSkillSuggestionsPrisma(options),
      this.requirePrisma().listKnowledgeEntries({ ...options, includeReview: true }),
    ]);
    return withKnowledgeSummary(summarizeTrainingSamples(samples, agents, suggestions), knowledgeEntries, agents);
  }

  private async reviewSamplePrisma(id: string, payload: TrainingSampleReviewPayload) {
    const result = await this.requirePrisma().reviewTrainingSample(id, payload || {});
    const statusLabel = result.sample.status === "ready" ? "已确认训练" : result.sample.status === "rejected" ? "已禁用" : "待复核";
    await this.notifications.create(
      result.sample.status === "rejected" ? "warning" : "info",
      "训练样本状态已更新",
      `样本「${String(result.sample.customerText || "").slice(0, 24)}」${statusLabel}。`,
      {
        source: "training_sample_review",
        trainingSampleId: result.sample.id,
        status: result.sample.status,
        ...sampleIdentity(result.sample),
        ...reviewNotificationEffect(result.reviewLog),
      },
    );
    return result;
  }

  private reviewKnowledgeEntryLocal(id: string, payload: KnowledgeEntryReviewPayload) {
    const entry = this.localStore.listKnowledgeEntries({ includeReview: true }).find((item: any) => item.id === id);
    if (!entry) throw new Error(`knowledge entry not found: ${id}`);
    assertExpectedIdentity(entry, payload, "knowledge entry");
    return this.localStore.reviewKnowledgeEntry(id, payload || {});
  }

  private async batchReviewSamplesPrisma(
    sampleIds: string[],
    reviewPayload: { status: "ready" | "review" | "rejected"; operationKey?: string; reviewer: string; note: string },
    expectedBySampleId: Record<string, ExpectedIdentityPayload>,
  ) {
    const results = await this.requirePrisma().reviewTrainingSamplesBatch(sampleIds, reviewPayload, expectedBySampleId);
    await this.notifications.create(
      reviewPayload.status === "rejected" ? "warning" : "info",
      "训练样本批量状态已更新",
      `已${trainingSampleBatchReviewVerb(reviewPayload.status)} ${results.length} 条训练样本。`,
      {
        source: "training_sample_batch_review",
        status: reviewPayload.status,
        count: results.length,
        sampleIds,
        ...batchReviewNotificationEffect(reviewPayload.operationKey),
      },
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

function withKnowledgeSummary(overview: any, knowledgeEntries: any[] = [], agents: any[] = []) {
  const rows = Array.isArray(knowledgeEntries) ? knowledgeEntries : [];
  const agentMap = new Map((Array.isArray(agents) ? agents : []).map((agent) => [agent.id, agent]));
  const buckets = new Map<string, any>();
  for (const entry of rows) {
    const agentId = entry?.agentId || "agent_general";
    const agent = agentMap.get(agentId) || {};
    if (!buckets.has(agentId)) {
      buckets.set(agentId, {
        agentId,
        agentKey: agent.key || entry?.agentKey || "general",
        name: agent.name || entry?.agentKey || "通用 Agent",
        count: 0,
        starterCount: 0,
        topTitles: [],
      });
    }
    const bucket = buckets.get(agentId);
    bucket.count += 1;
    if (entry?.sourceType === "starter_knowledge") bucket.starterCount += 1;
    if (bucket.topTitles.length < 3 && entry?.title) bucket.topTitles.push(String(entry.title));
  }
  return {
    ...overview,
    knowledgeEntryCount: rows.length,
    starterKnowledgeEntryCount: rows.filter((entry) => entry?.sourceType === "starter_knowledge").length,
    knowledgeByAgent: [...buckets.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))),
    topKnowledgeEntries: rows.slice(0, 8).map((entry) => ({
      id: entry.id,
      agentId: entry.agentId || null,
      title: entry.title || "",
      sourceType: entry.sourceType || "",
      qualityScore: Number(entry.qualityScore || 0),
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 6) : [],
    })),
  };
}

function reviewNotificationEffect(reviewLog: any) {
  const reviewEffectKey = String(reviewLog?.metadata?.effectKey || reviewLog?.id || "").trim();
  return reviewEffectKey ? { effectKey: `${reviewEffectKey}:notification` } : {};
}

function batchReviewNotificationEffect(operationKey?: string) {
  const key = String(operationKey || "").trim();
  return key ? { effectKey: `training-sample-batch-review:${key}:notification` } : {};
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
