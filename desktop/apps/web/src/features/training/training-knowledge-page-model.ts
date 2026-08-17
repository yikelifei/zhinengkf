import type { IdentityFilters } from "../../lib/api";

export type TrainingKnowledgePageProps = {
  identityFilters?: IdentityFilters;
};

export type KnowledgeEntryRecord = {
  id: string;
  agentId?: string | null;
  agentKey?: string;
  wechatAccountId?: string | null;
  conversationId?: string | null;
  customerId?: string | null;
  title?: string;
  content?: string;
  sourceType?: string;
  sourceId?: string | null;
  qualityScore?: number;
  status?: "ready" | "review" | "rejected" | string;
  reviewer?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type KnowledgeReviewStatus = "ready" | "review" | "rejected";

export type KnowledgeReviewDraft = {
  agentId: string;
  title: string;
  content: string;
  tags: string;
  qualityScore: string;
};

export type KnowledgeCreateDraft = {
  agentId: string;
  title: string;
  content: string;
  tags: string;
  qualityScore: string;
};

export const EMPTY_KNOWLEDGE_CREATE_DRAFT: KnowledgeCreateDraft = {
  agentId: "",
  title: "",
  content: "",
  tags: "",
  qualityScore: "80",
};

export const TRAINING_KNOWLEDGE_EDIT_ACTION_CONTRACTS = {
  agent: "training.knowledge.edit.agent",
  title: "training.knowledge.edit.title",
  content: "training.knowledge.edit.content",
  tags: "training.knowledge.edit.tags",
  quality: "training.knowledge.edit.quality",
  rejectLabel: "停用知识",
} as const;

export const shouldBlockReady = (readyBlockers: string[]) => readyBlockers.length > 0;
