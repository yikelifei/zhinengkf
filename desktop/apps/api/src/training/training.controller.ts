import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApplySkillSuggestionsPayload, TrainingService } from "./training.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import {
  OperatorAccessGuard,
  RequireOperatorCapability,
  TrustedOperator,
} from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

@Controller("training")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get("chat-imports")
  listChatImports(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.training.listChatImports({ wechatAccountId, conversationId, customerId });
  }

  @Post("chat-imports")
  @RequireOperatorCapability("manage_training")
  importChat(
    @Body()
    payload: {
      operationKey: string;
      name?: string;
      source?: string;
      channel?: "wechat" | "xiaohongshu" | "douyin" | "manual";
      reviewMode?: "required" | "score_based";
      agentId?: string;
      customerId?: string;
      conversationId?: string;
      wechatAccountId?: string;
      text: string;
    },
  ) {
    return this.training.importChat(payload);
  }

  @Get("samples")
  listSamples(
    @Query("agentId") agentId?: string,
    @Query("quality") quality?: string,
    @Query("status") status?: string,
    @Query("sourceType") sourceType?: string,
    @Query("importId") importId?: string,
    @Query("limit") limit?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.training.listSamples({
      agentId,
      quality,
      status,
      sourceType,
      importId,
      limit: limit ? Number(limit) : undefined,
      wechatAccountId,
      conversationId,
      customerId,
    });
  }

  @Get("samples/:id")
  getSample(
    @Param("id") id: string,
    @Query("agentId") agentId?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.training.getSample(id, { agentId, wechatAccountId, conversationId, customerId });
  }

  @Get("overview")
  getOverview(
    @Query("agentId") agentId?: string,
    @Query("minScore") minScore?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.training.getOverview({
      agentId,
      minScore: minScore ? Number(minScore) : undefined,
      wechatAccountId,
      conversationId,
      customerId,
    });
  }

  @Get("knowledge")
  listKnowledgeEntries(
    @Query("agentId") agentId?: string,
    @Query("includeReview") includeReview?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.training.listKnowledgeEntries({
      agentId,
      includeReview: includeReview === "1" || includeReview === "true",
      wechatAccountId,
      conversationId,
      customerId,
    });
  }

  @Get("conversation-learning")
  getConversationLearning(
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.training.getConversationLearning({
      wechatAccountId,
      conversationId,
      customerId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("conversation-learning/:conversationId/outcome")
  @RequireOperatorCapability("manage_training")
  confirmConversationOutcome(
    @Param("conversationId") conversationId: string,
    @Body()
    payload: {
      operationKey: string;
      outcome: "won" | "lost" | "ongoing";
      reasonCode?: string;
      note?: string;
      reviewer?: string;
      wechatAccountId?: string;
      customerId?: string;
      expectedWechatAccountId?: string;
      expectedConversationId?: string;
      expectedCustomerId?: string;
    },
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload || ({} as any);
    return this.training.confirmConversationOutcome(conversationId, { ...trustedPayload, reviewer: principal.id });
  }

  @Post("rag/preview")
  previewRag(
    @Body()
    payload: {
      query: string;
      agentId?: string;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
    },
  ) {
    return this.training.previewRag(payload || { query: "" });
  }

  @Get("knowledge/import-fields")
  getKnowledgeImportFields() {
    return this.training.getKnowledgeImportFields();
  }

  @Get("knowledge/import-template")
  getKnowledgeImportTemplate() {
    return this.training.getKnowledgeImportTemplate();
  }

  @Post("knowledge/import-preview")
  previewKnowledgeImport(
    @Body()
    payload: {
      operationKey?: string;
      source?: string;
      text: string;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
    },
  ) {
    return this.training.previewKnowledgeImport(payload || { text: "" });
  }

  @Post("knowledge/import")
  @RequireOperatorCapability("manage_training")
  importKnowledge(
    @Body()
    payload: {
      operationKey?: string;
      source?: string;
      text: string;
      wechatAccountId?: string;
      conversationId?: string;
      customerId?: string;
    },
  ) {
    return this.training.importKnowledge(payload);
  }

  @Post("knowledge/:id/review")
  @RequireOperatorCapability("manage_training")
  reviewKnowledgeEntry(
    @Param("id") id: string,
    @Body()
    payload: {
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
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload || {};
    return this.training.reviewKnowledgeEntry(id, { ...trustedPayload, reviewer: principal.id });
  }

  @Post("samples/:id/review")
  @RequireOperatorCapability("manage_training")
  reviewSample(
    @Param("id") id: string,
    @Body()
    payload: {
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
    } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload;
    return this.training.reviewSample(id, { ...trustedPayload, reviewer: principal.id });
  }

  @Post("samples/batch-review")
  @RequireOperatorCapability("manage_training")
  batchReviewSamples(
    @Body()
    payload: {
      sampleIds?: string[];
      status?: "ready" | "review" | "rejected";
      operationKey?: string;
      reviewer?: string;
      note?: string;
      expectedBySampleId?: Record<string, ExpectedIdentityPayload>;
    },
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { reviewer: _untrustedReviewer, ...trustedPayload } = payload || {};
    return this.training.batchReviewSamples({ ...trustedPayload, reviewer: principal.id });
  }

  @Get("skill-suggestions")
  listSkillSuggestions(
    @Query("agentId") agentId?: string,
    @Query("minScore") minScore?: string,
    @Query("wechatAccountId") wechatAccountId?: string,
    @Query("conversationId") conversationId?: string,
    @Query("customerId") customerId?: string,
  ) {
    return this.training.listSkillSuggestions({
      agentId,
      minScore: minScore ? Number(minScore) : undefined,
      wechatAccountId,
      conversationId,
      customerId,
    });
  }

  @Post("skill-suggestions/apply")
  @RequireOperatorCapability("manage_training")
  applySkillSuggestions(
    @Body()
    payload: ApplySkillSuggestionsPayload,
  ) {
    return this.training.applySkillSuggestions(payload || {});
  }
}
