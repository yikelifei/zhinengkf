import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { appConfig } from "../shared/app-config";
import { rules } from "../shared/rules";

const { buildAgentReplyDraft, evaluateAgentRoute, findPendingSceneClarificationContext } = rules;

type RouteEvaluatePayload = {
  text: string;
  channel?: "wechat" | "xiaohongshu" | "douyin";
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
    const result = evaluateAgentRoute({ ...payload, clarificationContext }, {
      highValueAmountCny: appConfig.highValueAmountCny,
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

  async correctEvaluation(id: string, payload: { agentKey: string; scene?: string; reviewer?: string; note?: string; idealReply?: string }) {
    if (!appConfig.useLocalStore) throw new Error("routing correction prisma mode is not implemented yet");
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
}
