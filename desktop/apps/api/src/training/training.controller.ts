import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApplySkillSuggestionsPayload, TrainingService } from "./training.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";

@Controller("training")
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
  importChat(
    @Body()
    payload: {
      name?: string;
      source?: string;
      channel?: "wechat" | "xiaohongshu" | "douyin" | "manual";
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

  @Post("samples/:id/review")
  reviewSample(
    @Param("id") id: string,
    @Body()
    payload: {
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
    } & ExpectedIdentityPayload,
  ) {
    return this.training.reviewSample(id, payload);
  }

  @Post("samples/batch-review")
  batchReviewSamples(
    @Body()
    payload: {
      sampleIds?: string[];
      status?: "ready" | "review" | "rejected";
      reviewer?: string;
      note?: string;
      expectedBySampleId?: Record<string, ExpectedIdentityPayload>;
    },
  ) {
    return this.training.batchReviewSamples(payload || {});
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
  applySkillSuggestions(
    @Body()
    payload: ApplySkillSuggestionsPayload,
  ) {
    return this.training.applySkillSuggestions(payload || {});
  }
}
