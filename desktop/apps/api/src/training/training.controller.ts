import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { TrainingService } from "./training.service";

@Controller("training")
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get("chat-imports")
  listChatImports() {
    return this.training.listChatImports();
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
    @Query("limit") limit?: string,
  ) {
    return this.training.listSamples({
      agentId,
      quality,
      status,
      sourceType,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("overview")
  getOverview(@Query("agentId") agentId?: string, @Query("minScore") minScore?: string) {
    return this.training.getOverview({
      agentId,
      minScore: minScore ? Number(minScore) : undefined,
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
    },
  ) {
    return this.training.reviewSample(id, payload);
  }

  @Get("skill-suggestions")
  listSkillSuggestions(@Query("agentId") agentId?: string, @Query("minScore") minScore?: string) {
    return this.training.listSkillSuggestions({
      agentId,
      minScore: minScore ? Number(minScore) : undefined,
    });
  }

  @Post("skill-suggestions/apply")
  applySkillSuggestions(@Body() payload: { agentId?: string; minScore?: number; suggestionKeys?: string[]; includeNeedsReview?: boolean }) {
    return this.training.applySkillSuggestions(payload || {});
  }
}
