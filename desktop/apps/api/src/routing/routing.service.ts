import { Injectable, NotFoundException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { appConfig } from "../shared/app-config";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { rules } from "../shared/rules";
import { PrismaOperationsService } from "../prisma/prisma-operations.service";

const {
  buildAgentReplyDraft,
  classifyTrainingSampleUsage,
  evaluateAgentRoute,
  findPendingSceneClarificationContext,
  recommendBundle,
} = rules;

type RouteEvaluatePayload = {
  text: string;
  channel?: "wechat" | "xiaohongshu" | "douyin";
  wechatAccountId?: string;
  customerId?: string;
  conversationId?: string;
  clarificationContext?: Record<string, unknown>;
};

type IdentityFilter = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

@Injectable()
export class RoutingService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
    private readonly prismaOperations?: PrismaOperationsService,
  ) {}

  list(filter: IdentityFilter = {}) {
    if (appConfig.useLocalStore) return this.localStore.listRouteEvaluations(filter);
    return this.requirePrisma().listRouteEvaluations(filter);
  }

  evaluate(payload: RouteEvaluatePayload) {
    if (!appConfig.useLocalStore) return this.evaluatePrisma(payload);
    const clarificationContext = payload.clarificationContext || this.findLatestSceneClarification(payload.conversationId);
    const identityFilter = {
      wechatAccountId: payload.wechatAccountId,
      conversationId: payload.conversationId,
      customerId: payload.customerId,
    };
    const sceneMemory = this.listSceneMemorySamples(identityFilter);
    const result = evaluateAgentRoute({ ...payload, clarificationContext }, {
      highValueAmountCny: appConfig.highValueAmountCny,
      sceneMemory,
    });
    const agent = this.localStore.getAgentByKey(result.agentKey);
    const skills = agent?.id
      ? this.localStore.listAgentSkills(agent.id, {
          wechatAccountId: payload.wechatAccountId,
          conversationId: payload.conversationId,
          customerId: payload.customerId,
        })
      : [];
    const knowledgeEntries = agent?.id
      ? this.localStore.listKnowledgeEntries({
          agentId: agent.id,
          ...identityFilter,
        })
      : [];
    const catalogSkus = this.localStore.listSkus();
    const bundleRecommendation = buildReplyBundleRecommendation(result, catalogSkus);
    const draft = buildAgentReplyDraft(result, {
      agentId: agent?.id,
      wechatAccountId: payload.wechatAccountId,
      conversationId: payload.conversationId,
      customerId: payload.customerId,
      skills,
      knowledgeEntries,
      catalogSkus,
      bundleRecommendation,
    });
    return this.localStore.createRouteEvaluation(payload, {
      ...result,
      suggestedReply: draft.suggestedReply,
      appliedSkills: draft.appliedSkills,
      knowledgeMatches: draft.knowledgeMatches,
      replyDraft: draft.replyDraft,
    });
  }

  async correctEvaluation(id: string, payload: { agentKey: string; scene?: string; reviewer?: string; note?: string; idealReply?: string } & ExpectedIdentityPayload) {
    if (!appConfig.useLocalStore) {
      const result = await this.requirePrisma().correctRouteEvaluation(id, payload || {});
      await this.notifyCorrectionBestEffort(id, result);
      return result;
    }
    const route = this.localStore.listRouteEvaluations().find((item: any) => item.id === id);
    if (!route) throw new NotFoundException(`route evaluation not found: ${id}`);
    assertExpectedIdentity(route, payload, "route evaluation");
    const result = this.localStore.correctRouteEvaluation(id, payload || {});
    await this.notifyCorrectionBestEffort(id, result);
    return result;
  }

  private async evaluatePrisma(payload: RouteEvaluatePayload) {
    const operations = this.requirePrisma();
    const identityFilter = {
      wechatAccountId: payload.wechatAccountId,
      conversationId: payload.conversationId,
      customerId: payload.customerId,
    };
    const previousRoutes = await operations.listRouteEvaluations(payload.conversationId ? { conversationId: payload.conversationId } : {});
    const clarificationContext = payload.clarificationContext || findPendingSceneClarificationContext(previousRoutes, payload.conversationId);
    const sceneMemory = (await operations.listTrainingSamples(identityFilter))
      .filter((sample: any) => isSceneMemorySample(sample))
      .sort((a: any, b: any) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 200);
    const result = evaluateAgentRoute({ ...payload, clarificationContext }, {
      highValueAmountCny: appConfig.highValueAmountCny,
      sceneMemory,
    });
    const agent = await operations.getAgentByKey(result.agentKey);
    const skills = agent?.id ? await operations.listAgentSkills(agent.id, identityFilter) : [];
    const knowledgeEntries = agent?.id ? await operations.listKnowledgeEntries({ agentId: agent.id, ...identityFilter }) : [];
    const draft = buildAgentReplyDraft(result, {
      agentId: agent?.id,
      ...identityFilter,
      skills,
      knowledgeEntries,
    });
    return operations.createRouteEvaluation(payload, {
      ...result,
      suggestedReply: draft.suggestedReply,
      appliedSkills: draft.appliedSkills,
      knowledgeMatches: draft.knowledgeMatches,
      replyDraft: draft.replyDraft,
    });
  }

  private async notifyCorrection(id: string, result: any) {
    await this.notifications.create(
      "info",
      "场景纠正已记录",
      `已把这条客户消息纠正到「${result.route.agent?.name || result.route.agentKey}」，并沉淀为训练样本。`,
      {
        routeId: id,
        agentKey: result.route.agentKey,
        trainingSampleId: result.trainingSample.id,
      },
    );
  }

  private async notifyCorrectionBestEffort(id: string, result: any) {
    try {
      await this.notifyCorrection(id, result);
    } catch {
      // The correction and its training artifacts are already durable; notification delivery is non-authoritative.
    }
  }

  private requirePrisma() {
    if (!this.prismaOperations) throw new Error("PrismaOperationsService is required when USE_LOCAL_STORE=false");
    return this.prismaOperations;
  }

  private findLatestSceneClarification(conversationId?: string) {
    return findPendingSceneClarificationContext(
      this.localStore.listRouteEvaluations(conversationId ? { conversationId } : {}),
      conversationId,
    );
  }

  private listSceneMemorySamples(filter: IdentityFilter = {}) {
    return this.localStore
      .listTrainingSamples(filter)
      .filter((sample: any) => isSceneMemorySample(sample))
      .sort((a: any, b: any) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 200);
  }
}

function buildReplyBundleRecommendation(route: any, skus: any[]) {
  if (!["gift_design", "pre_sales"].includes(route.agentKey)) return null;
  if (!(Number(route.budget?.perUnitAmount || 0) > 0)) return null;
  return recommendBundle({
    skus: skus.map((sku: any) => ({
      ...sku,
      costPrice: Number(sku.costPrice || 0),
      salePrice: Number(sku.salePrice || 0),
      sceneTags: Array.isArray(sku.sceneTags) ? sku.sceneTags : [],
      replacementSkuCodes: Array.isArray(sku.replacementSkuCodes) ? sku.replacementSkuCodes : [],
    })),
    budget: route.budget || {},
    scene: route.scene || route.text || "",
    maxItems: 6,
  });
}

function isSceneMemorySample(sample: any) {
  if (!sample?.agentKey || !sample?.customerText) return false;
  if (String(sample.status || "ready") !== "ready") return false;
  const usage = sample.quality?.usage || classifyTrainingSampleUsage(sample);
  if (usage.routeMemory === false) return false;
  const sourceType = String(sample.sourceType || (sample.sourceRouteId ? "route_correction" : sample.importId ? "chat_import" : ""));
  if (sourceType === "route_correction") return Number(sample.score || 0) >= 70;
  if (sourceType !== "chat_import") return false;
  if (Number(sample.score || 0) < 85) return false;
  if (!isConfirmedChatImportScene(sample)) return false;
  if (sample.quality?.trainable === false) return false;
  if (["review", "risk", "blocked"].includes(String(sample.quality?.level || ""))) return false;
  return true;
}

function isConfirmedChatImportScene(sample: any) {
  const sceneCheck = sample.sceneCheck || sample.sceneDecision || null;
  if (sceneCheck?.status) return sceneCheck.status === "clear";
  if (sample.sceneScore === undefined || sample.sceneScore === null) return true;
  const sceneScore = Number(sample.sceneScore || 0);
  return Number.isFinite(sceneScore) && sceneScore >= 14;
}
