import { Injectable } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { NotificationsService } from "../notifications/notifications.service";
import { appConfig } from "../shared/app-config";
import { rules } from "../shared/rules";

const {
  canonicalSkillName,
  classifySkillSuggestionQuality,
  compileAgentSkillSuggestions,
  isSkillSuggestionSafeToApply,
  parseChatTranscript,
  summarizeTrainingSamples,
} = rules;

type ChatImportPayload = {
  name?: string;
  source?: string;
  channel?: "wechat" | "xiaohongshu" | "douyin" | "manual";
  agentId?: string;
  text: string;
};

type TrainingSampleReviewPayload = {
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

type ApplySkillSuggestionsPayload = {
  agentId?: string;
  minScore?: number;
  suggestionKeys?: string[];
  includeNeedsReview?: boolean;
};

@Injectable()
export class TrainingService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly notifications: NotificationsService,
  ) {}

  listChatImports() {
    if (!appConfig.useLocalStore) throw new Error("training prisma mode is not implemented yet");
    return this.localStore.listChatImports();
  }

  listSamples(agentId?: string) {
    if (!appConfig.useLocalStore) throw new Error("training samples prisma mode is not implemented yet");
    return this.localStore.listTrainingSamples(agentId);
  }

  getOverview(options: { agentId?: string; minScore?: number } = {}) {
    if (!appConfig.useLocalStore) throw new Error("training overview prisma mode is not implemented yet");
    const samples = this.localStore.listTrainingSamples(options.agentId);
    const agents = this.localStore.listAgents();
    const suggestions = this.listSkillSuggestions(options);
    return summarizeTrainingSamples(samples, agents, suggestions);
  }

  importChat(payload: ChatImportPayload) {
    if (!appConfig.useLocalStore) throw new Error("chat import prisma mode is not implemented yet");
    const parsed = parseChatTranscript(payload.text || "");
    return this.localStore.createChatImport(payload, parsed);
  }

  reviewSample(id: string, payload: TrainingSampleReviewPayload) {
    if (!appConfig.useLocalStore) throw new Error("training sample review prisma mode is not implemented yet");
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

  listSkillSuggestions(options: { agentId?: string; minScore?: number } = {}) {
    if (!appConfig.useLocalStore) throw new Error("skill suggestion prisma mode is not implemented yet");
    const samples = this.localStore.listTrainingSamples(options.agentId);
    const existingSkills = this.localStore.listAgentSkills(options.agentId);
    return compileAgentSkillSuggestions(samples, {
      agentId: options.agentId,
      minScore: options.minScore,
      existingSkills,
    });
  }

  applySkillSuggestions(options: ApplySkillSuggestionsPayload = {}) {
    if (!appConfig.useLocalStore) throw new Error("skill apply prisma mode is not implemented yet");
    const allSuggestions = this.listSkillSuggestions(options);
    const selectedKeys = normalizeSuggestionKeySet(options.suggestionKeys);
    const selectedSuggestions = selectedKeys.size
      ? allSuggestions.filter((suggestion: any) => selectedKeys.has(skillSuggestionKey(suggestion)))
      : allSuggestions;
    const blocked: any[] = [];
    const suggestions: any[] = [];
    for (const suggestion of selectedSuggestions) {
      if (options.includeNeedsReview || isSkillSuggestionSafeToApply(suggestion)) {
        suggestions.push(suggestion);
      } else {
        blocked.push({
          ...suggestion,
          reason: "needs_review",
          quality: classifySkillSuggestionQuality(suggestion),
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
}

function normalizeSuggestionKeySet(value?: string[]) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

function skillSuggestionKey(suggestion: any) {
  return String(
    suggestion?.suggestionKey ||
      `${suggestion?.agentId || suggestion?.agentKey || "general"}::${canonicalSkillName(suggestion?.name || "")}`,
  );
}
