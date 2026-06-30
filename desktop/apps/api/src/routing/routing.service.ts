import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { appConfig } from "../shared/app-config";
import { ExpectedIdentityPayload, assertExpectedIdentity } from "../shared/identity-expectation";
import { rules } from "../shared/rules";

const { buildAgentReplyDraft, classifyTrainingSampleUsage, evaluateAgentRoute, findPendingSceneClarificationContext } = rules;

type RouteEvaluatePayload = {
  text: string;
  channel?: "wechat" | "xiaohongshu" | "douyin";
  wechatAccountId?: string;
  customerId?: string;
  conversationId?: string;
  clarificationContext?: Record<string, unknown>;
};

@Injectable()
export class RoutingService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
  ) {}

  list() {
    if (!appConfig.useLocalStore) throw new Error("routing prisma mode is not implemented yet");
    return this.localStore.listRouteEvaluations();
  }

  evaluate(payload: RouteEvaluatePayload) {
    if (!appConfig.useLocalStore) throw new Error("routing prisma mode is not implemented yet");
    const clarificationContext = payload.clarificationContext || this.findLatestSceneClarification(payload.conversationId);
    const sceneMemory = this.listSceneMemorySamples();
    const result = evaluateAgentRoute({ ...payload, clarificationContext }, {
      highValueAmountCny: appConfig.highValueAmountCny,
      sceneMemory,
    });
    const agent = this.localStore.getAgentByKey(result.agentKey);
    const skills = agent?.id ? this.localStore.listAgentSkills(agent.id) : [];
    const knowledgeEntries = agent?.id ? this.localStore.listKnowledgeEntries(agent.id) : [];
    const draft = buildAgentReplyDraft(result, {
      agentId: agent?.id,
      skills,
      knowledgeEntries,
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
    if (!appConfig.useLocalStore) throw new Error("routing correction prisma mode is not implemented yet");
    const route = this.localStore.listRouteEvaluations().find((item: any) => item.id === id);
    if (!route) throw new Error(`route evaluation not found: ${id}`);
    assertExpectedIdentity(route, payload, "route evaluation");
    const result = this.localStore.correctRouteEvaluation(id, payload || {});
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
    return result;
  }

  private findLatestSceneClarification(conversationId?: string) {
    return findPendingSceneClarificationContext(this.localStore.listRouteEvaluations(), conversationId);
  }

  private listSceneMemorySamples() {
    return this.localStore
      .listTrainingSamples()
      .filter((sample: any) => isSceneMemorySample(sample))
      .sort((a: any, b: any) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 200);
  }
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
  if (sample.quality?.trainable === false) return false;
  if (["review", "risk", "blocked"].includes(String(sample.quality?.level || ""))) return false;
  return true;
}
