import path from "node:path";
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { assertExpectedIdentity, ExpectedIdentityPayload } from "../shared/identity-expectation";
import { routingCorrectionRequestKey } from "../shared/routing-correction";
import {
  assertExactOperationReplay,
  assertStoredOperationIdentityReplay,
  createChatImportOperationFingerprint,
  createOperationFingerprint,
  deterministicOperationId,
  isUniqueConstraintError,
  normalizeOperationKey,
  readRequestOperationMetadata,
  requestOperationMetadata,
  type RequestOperationMetadata,
} from "../shared/operation-idempotency";

const rules = require(path.join(process.cwd(), "packages", "rules"));
const {
  buildConversationLearningInsight,
  evaluateTrainingSampleQuality,
  isSceneClarificationReply,
  normalizeTrainingSampleStatus,
  trainingSampleReviewNote,
} = rules;

export type OperationsIdentity = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type PrismaLike = PrismaService | any;

@Injectable()
export class PrismaOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAgents(filter: OperationsIdentity = {}) {
    const [agents, samples] = await Promise.all([
      this.prisma.customerServiceAgent.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] }),
      this.prisma.trainingSample.findMany({ where: identityWhere(filter), orderBy: { createdAt: "desc" } }),
    ]);
    const visibleSamples = samples.filter((sample: any) => recordVisibleForIdentity(sample, filter));
    const skills = await this.listAgentSkills(undefined, filter);
    return agents.map((agent: any) => {
      const agentSamples = visibleSamples.filter((sample: any) => sample.agentId === agent.id);
      const averageTrainingScore = agentSamples.length
        ? round(agentSamples.reduce((sum: number, sample: any) => sum + Number(sample.score || 0), 0) / agentSamples.length)
        : 0;
      return serialize({
        ...agent,
        skills: skills.filter((skill: any) => skill.agentId === agent.id),
        trainingSampleCount: agentSamples.length,
        averageTrainingScore,
      });
    });
  }

  async listAgentSkills(agentId?: string, filter: OperationsIdentity = {}) {
    const rows = await this.prisma.agentSkill.findMany({
      where: agentId ? { agentId } : undefined,
      orderBy: { name: "asc" },
    });
    const sourceIds = unique(rows.flatMap((row: any) => jsonStrings(row.sourceSampleIds)));
    const samples = sourceIds.length
      ? await this.prisma.trainingSample.findMany({ where: { id: { in: sourceIds } } })
      : [];
    const samplesById = new Map(samples.map((sample: any) => [sample.id, sample]));
    return rows
      .filter((row: any) => skillVisibleForIdentity(row, samplesById, filter))
      .filter((row: any) => !isClarificationDerivedSkill(row, samplesById))
      .map((row: any) => serialize({ ...row, scope: skillScope(row, samplesById) }))
      .sort((left: any, right: any) => String(left.name).localeCompare(String(right.name), "zh-Hans-CN"));
  }

  async getAgentByKey(agentKey: string, client: PrismaLike = this.prisma) {
    return (
      (await client.customerServiceAgent.findUnique({ where: { key: agentKey } })) ||
      (await client.customerServiceAgent.findUnique({ where: { key: "general" } })) ||
      null
    );
  }

  async resolveKnowledgeImportAgent(client: PrismaLike, row: any) {
    const agentId = String(row?.agentId || "").trim();
    const agentKey = String(row?.agentKey || "").trim();
    if (agentId) return client.customerServiceAgent.findUnique({ where: { id: agentId } });
    if (agentKey) {
      return (
        (await client.customerServiceAgent.findUnique({ where: { key: agentKey } })) ||
        (await client.customerServiceAgent.findUnique({ where: { id: agentKey } }))
      );
    }
    return null;
  }

  async listChatImports(filter: OperationsIdentity = {}) {
    const rows = await this.prisma.chatImport.findMany({
      where: identityWhere(filter),
      orderBy: { createdAt: "desc" },
    });
    return serialize(rows);
  }

  async listTrainingSamples(filter: OperationsIdentity & { agentId?: string } = {}) {
    const rows = await this.prisma.trainingSample.findMany({
      where: { ...identityWhere(filter), ...(filter.agentId ? { agentId: filter.agentId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((sample: any) => serialize({ ...sample, quality: evaluateTrainingSampleQuality(sample) }));
  }

  async getTrainingSample(id: string, filter: OperationsIdentity & { agentId?: string } = {}) {
    const sample = await this.prisma.trainingSample.findFirst({
      where: { id, ...identityWhere(filter), ...(filter.agentId ? { agentId: filter.agentId } : {}) },
    });
    return sample ? serialize({ ...sample, quality: evaluateTrainingSampleQuality(sample) }) : null;
  }

  async listKnowledgeEntries(filter: OperationsIdentity & { agentId?: string; includeReview?: boolean } = {}) {
    const rows = await this.prisma.knowledgeEntry.findMany({
      where: { ...(filter.agentId ? { agentId: filter.agentId } : {}) },
      include: { trainingSample: true },
      orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }],
    });
    return rows
      .filter((row: any) => knowledgeVisibleForIdentity(row, filter))
      .filter((row: any) => filter.includeReview || !row.trainingSample || String(row.trainingSample.status || "ready") === "ready")
      .filter((row: any) => filter.includeReview || normalizeKnowledgeEntryStatus(row) === "ready")
      .filter((row: any) => !row.trainingSample || !isSceneClarificationReply(row.trainingSample.idealReply))
      .map(({ trainingSample: _sample, ...row }: any) => serialize(row));
  }

  async importKnowledgeEntries(rows: any[] = [], context: OperationsIdentity & { operationKey?: string; source?: string } = {}) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const identity = await this.resolveIdentity(tx, context, "knowledge import");
      const source = String(context.source || "manual_knowledge_import").trim() || "manual_knowledge_import";
      const operationKey = context.operationKey ? normalizeOperationKey(context.operationKey, "knowledge import operationKey") : "";
      const importOperation = operationKey
        ? buildPrismaKnowledgeImportOperation(operationKey, identity.fields, source, rows)
        : null;
      const existingImportLog = importOperation ? await findPrismaReviewLogByEffectKey(tx, importOperation.effectKey) : null;
      if (existingImportLog) {
        assertExactOperationReplay(
          readRequestOperationMetadata(existingImportLog.metadata),
          importOperation!.operation,
          "knowledge import",
        );
        const importedIds = Array.isArray(existingImportLog.metadata?.knowledgeEntryIds)
          ? existingImportLog.metadata.knowledgeEntryIds.map((item: unknown) => String(item || "").trim()).filter(Boolean)
          : [];
        const existingEntries = importedIds.length
          ? await tx.knowledgeEntry.findMany({ where: { id: { in: importedIds } } })
          : [];
        const byId = new Map(existingEntries.map((entry: any) => [entry.id, entry]));
        return serialize({
          count: importedIds.filter((id: string) => byId.has(id)).length,
          results: importedIds.map((id: string) => byId.get(id)).filter(Boolean),
          skipped: Array.isArray(existingImportLog.metadata?.skipped) ? existingImportLog.metadata.skipped : [],
          reviewLog: existingImportLog,
          failed: String(existingImportLog.afterStatus || "") === "failed",
        });
      }
      const results: any[] = [];
      const skipped: any[] = [];
      for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
        const agent = await this.resolveKnowledgeImportAgent(tx, row);
        if ((row.agentId || row.agentKey) && !agent) {
          skipped.push({ index, title: row.title, reason: "agent_not_found" });
          continue;
        }
        const entryId = operationKey ? deterministicOperationId("knowledge_manual", operationKey, index) : undefined;
        const createData = {
          ...(entryId ? { id: entryId } : {}),
          agentId: agent?.id || null,
          trainingSampleId: null,
          sourceType: "manual_knowledge_import",
          sourceId: source,
          ...identity.fields,
          identityBinding: identity.binding,
          title: String(row.title || "").trim(),
          content: String(row.content || "").trim(),
          tags: jsonValue(normalizeKnowledgeImportTags(row.tags, agent?.key)),
          qualityScore: Number.isFinite(Number(row.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(row.qualityScore)))) : 70,
          status: "review",
          reviewer: null,
          reviewNote: "manual knowledge import requires human review before reply use",
          reviewedAt: null,
          reviewHistory: jsonValue([]),
        };
        const updateData = { ...createData };
        delete (updateData as any).id;
        delete (updateData as any).status;
        delete (updateData as any).reviewer;
        delete (updateData as any).reviewNote;
        delete (updateData as any).reviewedAt;
        delete (updateData as any).reviewHistory;
        const saved = entryId
          ? await tx.knowledgeEntry.upsert({ where: { id: entryId }, create: createData, update: updateData })
          : await tx.knowledgeEntry.create({ data: createData });
        results.push(saved);
      }
      let reviewLog: any = null;
      if (results.length || skipped.length) {
        const failed = results.length === 0;
        reviewLog = await tx.reviewLog.create({ data: {
          ...(importOperation ? { id: deterministicOperationId("review", importOperation.effectKey) } : {}),
          targetType: "knowledge_import",
          targetId: operationKey || results[0]?.id || `failed:${source}:${new Date().toISOString()}`,
          decision: failed ? "import_manual_knowledge_failed" : "import_manual_knowledge",
          reviewer: "operator",
          note: failed
            ? `Manual knowledge import from ${source} did not save any entries; fix skipped rows and retry.`
            : `Imported ${results.length} manual knowledge entries from ${source}; low score entries still need review before skill application.`,
          beforeStatus: "",
          afterStatus: failed ? "failed" : "imported",
          metadata: jsonValue({
            source,
            count: results.length,
            skippedCount: skipped.length,
            skipped,
            ...(failed ? { failure: { phase: "write_failed", reason: "no_importable_rows" } } : {}),
            knowledgeEntryIds: results.map((entry) => entry.id),
            ...identity.fields,
            ...(importOperation ? { effectKey: importOperation.effectKey, requestOperation: importOperation.operation } : {}),
          }),
        }});
      }
      return serialize({ count: results.length, results, skipped, ...(reviewLog ? { reviewLog, failed: results.length === 0 } : {}) });
    });
  }

  async recordKnowledgeImportFailure(parsed: any = {}, context: OperationsIdentity & { operationKey?: string; source?: string; phase?: string } = {}) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const identity = await this.resolveIdentity(tx, context, "knowledge import failure");
      const source = String(context.source || "manual_knowledge_import").trim() || "manual_knowledge_import";
      const operationKey = context.operationKey ? normalizeOperationKey(context.operationKey, "knowledge import operationKey") : "";
      const importOperation = operationKey
        ? buildPrismaKnowledgeImportFailureOperation(operationKey, identity.fields, source, parsed, context.phase || "parse_failed")
        : null;
      const existingImportLog = importOperation ? await findPrismaReviewLogByEffectKey(tx, importOperation.effectKey) : null;
      if (existingImportLog) {
        assertExactOperationReplay(
          readRequestOperationMetadata(existingImportLog.metadata),
          importOperation!.operation,
          "knowledge import failure",
        );
        return serialize(existingImportLog);
      }
      const now = new Date();
      const failure = normalizeKnowledgeImportFailure(parsed, context.phase || "parse_failed");
      const reviewLog = await tx.reviewLog.create({ data: {
        ...(importOperation ? { id: deterministicOperationId("review", importOperation.effectKey) } : {}),
        targetType: "knowledge_import",
        targetId: operationKey || `failed:${source}:${now.toISOString()}`,
        decision: "import_manual_knowledge_failed",
        reviewer: "operator",
        note: `Manual knowledge import from ${source} failed before saving entries; fix the source file and retry.`,
        beforeStatus: "",
        afterStatus: "failed",
        metadata: jsonValue({
          source,
          count: 0,
          skippedCount: failure.errors.length,
          skipped: failure.errors,
          failure,
          knowledgeEntryIds: [],
          ...identity.fields,
          ...(importOperation ? { effectKey: importOperation.effectKey, requestOperation: importOperation.operation } : {}),
        }),
      }});
      return serialize(reviewLog);
    });
  }

  async listRouteEvaluations(filter: OperationsIdentity = {}) {
    return serialize(await this.prisma.routeEvaluation.findMany({
      where: identityWhere(filter),
      include: { agent: true },
      orderBy: { createdAt: "desc" },
    }));
  }

  async createRouteEvaluation(payload: any, result: any) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const identity = await this.resolveIdentity(tx, payload, "route evaluation");
      const agent = await this.getAgentByKey(result.agentKey, tx);
      const route = await tx.routeEvaluation.create({ data: {
        channel: payload.channel || "wechat",
        text: payload.text || "",
        ...identity.fields,
        identityBinding: identity.binding,
        agentId: agent?.id || null,
        agentKey: result.agentKey,
        scene: result.scene,
        sceneScore: Number(result.sceneScore || 0),
        sceneScores: jsonValue(result.sceneScores || []),
        matchedKeywords: jsonValue(result.matchedKeywords || []),
        sceneDecision: jsonValue(result.sceneDecision),
        sceneClarification: jsonValue(result.sceneClarification),
        clarificationResolution: jsonValue(result.clarificationResolution),
        sceneMemory: jsonValue(result.sceneMemory),
        sceneAudit: jsonValue(result.sceneAudit),
        action: result.action,
        confidence: Number(result.confidence || 0),
        isHighValue: Boolean(result.isHighValue),
        budget: jsonValue(result.budget),
        missingFields: jsonValue(result.missingFields || []),
        riskFlags: jsonValue(result.riskFlags || []),
        routingPolicy: jsonValue(result.routingPolicy),
        suggestedReply: result.suggestedReply || null,
        appliedSkills: jsonValue(result.appliedSkills || []),
        knowledgeMatches: jsonValue(result.knowledgeMatches || []),
        replyDraft: jsonValue(result.replyDraft),
        learningInsight: jsonValue(result.learningInsight || buildConversationLearningInsight({
          text: payload.text || "",
          route: result,
          messageId: payload.messageId || null,
        })),
        conversionAssessment: jsonValue(result.conversionAssessment),
      }});
      return serialize({ ...route, agent });
    });
  }

  async correctRouteEvaluation(id: string, payload: any = {}) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const before = await tx.routeEvaluation.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`route evaluation not found: ${id}`);
      assertExpectedIdentity(before, payload, "route evaluation");
      const agent = await tx.customerServiceAgent.findUnique({ where: { key: payload.agentKey } });
      if (!agent) throw new BadRequestException(`agent not found: ${payload.agentKey}`);
      const requestKey = routingCorrectionRequestKey(id, payload);
      if (before.correction?.requestKey === requestKey) {
        const sample = await tx.trainingSample.findFirst({
          where: { sourceType: "route_correction", sourceRouteId: id },
          orderBy: { createdAt: "desc" },
        });
        const knowledge = sample
          ? await tx.knowledgeEntry.findFirst({ where: { trainingSampleId: sample.id } })
          : null;
        const reviewLog = await tx.reviewLog.findFirst({
          where: { targetType: "route_evaluation", targetId: id, decision: "correct_scene" },
          orderBy: { createdAt: "desc" },
        });
        if (sample && knowledge && reviewLog) {
          return serialize({
            route: { ...before, agent },
            trainingSample: { ...sample, quality: evaluateTrainingSampleQuality(sample) },
            knowledgeEntry: knowledge,
            reviewLog,
          });
        }
        throw new InternalServerErrorException("route correction artifacts are incomplete");
      }
      const now = new Date();
      const scene = payload.scene || agent.scene || before.scene || "未分类";
      const reviewer = payload.reviewer || "人工客服";
      const note = payload.note || "人工纠正场景归属，用于后续训练。";
      const missingFields = jsonStrings(before.missingFields).filter((field) => field !== "scene_clarification");
      const corrected = await tx.routeEvaluation.update({ where: { id }, data: {
        agentId: agent.id,
        agentKey: agent.key,
        scene,
        sceneScore: 100,
        sceneDecision: jsonValue({ status: "clear", reason: "human_corrected_scene", topScene: { scene, agentKey: agent.key, score: 100, matchedKeywords: ["human_correction"] }, secondaryScene: null, scoreGap: 100 }),
        sceneClarification: jsonValue(null),
        clarificationResolution: jsonValue({ type: "human_scene_correction", text: before.text, agentKey: agent.key, scene, label: scene, matchedKeywords: ["human_correction"], confidence: "human_reviewed" }),
        sceneMemory: jsonValue(null),
        sceneAudit: jsonValue({ level: "pass", label: "人工已纠正", summary: `已由人工纠正为「${scene}」。`, nextStep: "后续同类消息会作为场景记忆参考。", evidence: ["human_correction"], warnings: [] }),
        action: before.action === "collect_info" && missingFields.length === 0 ? "auto_agent" : before.action,
        confidence: 100,
        missingFields: jsonValue(missingFields),
        correction: jsonValue({ corrected: true, requestKey, reviewer, note, correctedAt: now.toISOString(), before: { agentKey: before.agentKey, scene: before.scene, sceneDecision: before.sceneDecision || null, action: before.action, confidence: before.confidence } }),
      }});
      const idealReply = payload.idealReply || before.suggestedReply || `已人工确认该问题应由「${agent.name || agent.key}」处理。`;
      const sample = await tx.trainingSample.create({ data: {
        agentId: agent.id,
        agentKey: agent.key,
        customerId: before.customerId,
        conversationId: before.conversationId,
        wechatAccountId: before.wechatAccountId,
        identityBinding: jsonValue(before.identityBinding),
        scene,
        customerText: before.text,
        idealReply,
        score: 95,
        status: "ready",
        skillHints: jsonValue(inferSkillHints({ question: before.text, answer: idealReply })),
        sourceType: "route_correction",
        sourceRouteId: before.id,
      }});
      const knowledge = await tx.knowledgeEntry.create({ data: {
        agentId: agent.id,
        trainingSampleId: sample.id,
        sourceType: "route_correction",
        sourceId: sample.id,
        customerId: before.customerId,
        conversationId: before.conversationId,
        wechatAccountId: before.wechatAccountId,
        identityBinding: jsonValue(before.identityBinding),
        title: `场景纠正：${scene}：${String(before.text || "").slice(0, 28)}`,
        content: `客户：${before.text}\n正确场景：${scene}\n正确 Agent：${agent.name || agent.key}\n备注：${note}`,
        tags: jsonValue([scene, agent.key, "场景纠正", ...inferSkillHints({ question: before.text, answer: idealReply })]),
        qualityScore: 95,
        status: "ready",
        reviewer,
        reviewNote: note,
        reviewedAt: now,
        reviewHistory: jsonValue([{ status: "ready", reviewer, note, reviewedAt: now.toISOString() }]),
      }});
      const reviewLog = await tx.reviewLog.create({ data: {
        targetType: "route_evaluation", targetId: id, decision: "correct_scene", reviewer, note,
        beforeStatus: before.agentKey, afterStatus: agent.key,
        metadata: jsonValue({ source: "routing_correction", correctionRequestKey: requestKey, beforeScene: before.scene, afterScene: scene, trainingSampleId: sample.id, knowledgeEntryId: knowledge.id, ...identityFields(before) }),
      }});
      return serialize({ route: { ...corrected, agent }, trainingSample: { ...sample, quality: evaluateTrainingSampleQuality(sample) }, knowledgeEntry: knowledge, reviewLog });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createChatImport(payload: any, parsed: any) {
    const operationKey = normalizeOperationKey(payload?.operationKey, "chat import operationKey");
    const importId = deterministicOperationId("import", operationKey);
    let operation: RequestOperationMetadata | null = null;
    try {
      return await this.prisma.$transaction(async (tx: PrismaLike) => {
        const existing = await tx.chatImport.findUnique({ where: { id: importId }, include: { samples: true } });
        if (existing) {
          const storedIdentity = assertStoredOperationIdentityReplay(
            identityFields(existing),
            payload || {},
            "chat import create",
          );
          operation = requestOperationMetadata(
            operationKey,
            createChatImportOperationFingerprint(payload || {}, storedIdentity),
          );
          return this.replayChatImport(existing, operation);
        }
        const identity = await this.resolveIdentity(tx, payload, "chat import");
        operation = requestOperationMetadata(
          operationKey,
          createChatImportOperationFingerprint(payload || {}, identity.fields),
        );
        const requestedAgent = payload.agentId
          ? await tx.customerServiceAgent.findUnique({ where: { id: payload.agentId } })
          : null;
        if (payload.agentId && !requestedAgent) throw new BadRequestException(`agent not found: ${payload.agentId}`);
        const pairs = Array.isArray(parsed.pairs) ? parsed.pairs : [];
        const identityBinding = jsonValue({
          ...(identity.fields.conversationId ? { status: "passed" } : {}),
          ...identity.fields,
          requestOperation: operation,
        });
        const record = await tx.chatImport.create({ data: {
          id: importId,
          name: payload.name || `聊天记录导入 ${new Date().toLocaleString("zh-CN")}`,
          source: payload.source || "manual_text", channel: payload.channel || "wechat", agentId: payload.agentId || null,
          rawText: payload.text || "", messageCount: Number(parsed.messageCount || 0), pairCount: Number(parsed.pairCount || 0),
          warnings: jsonValue(parsed.warnings || []), ...identity.fields, identityBinding,
        }});
        const importedSamples: any[] = [];
        const reviewRequired = String(payload?.reviewMode || "score_based") === "required";
        for (const [pairIndex, pair] of pairs.entries()) {
          const agent = requestedAgent || await this.getAgentByKey(pair.agentKey || "general", tx);
          const customerText = String(pair.customerText || pair.question || "").trim();
          const idealReply = String(pair.idealReply || pair.agentReply || pair.answer || "").trim();
          const score = Number.isFinite(Number(pair.score)) ? Number(pair.score) : 0;
          const sample = await tx.trainingSample.create({ data: {
            id: deterministicOperationId("sample", operationKey, pairIndex),
            importId: record.id, agentId: agent?.id || null, agentKey: agent?.key || pair.agentKey || "general",
            ...identity.fields, identityBinding, scene: pair.scene || "未分类",
            sceneScore: Number(pair.sceneScore || 0), sceneScores: jsonValue(pair.sceneScores || []), matchedKeywords: jsonValue(pair.matchedKeywords || []),
            sceneCheck: jsonValue(pair.sceneCheck), customerText, idealReply, score, status: reviewRequired ? "review" : score >= 70 ? "ready" : "review",
            skillHints: jsonValue(inferSkillHints(pair)), sourceType: "chat_import",
            sourceLineStart: integerOrNull(pair.sourceLineStart), sourceLineEnd: integerOrNull(pair.sourceLineEnd),
          }});
          importedSamples.push(sample);
          const knowledgeStatus = String(sample.status || "review") === "ready" ? "ready" : "review";
          const knowledgeReviewedAt = knowledgeStatus === "ready" ? new Date() : null;
          const knowledgeEntryReviewNote =
            knowledgeStatus === "ready"
              ? "chat import score met auto-ready threshold"
              : reviewRequired
                ? "chat import requires human review before reply use"
                : "chat import score requires human review before reply use";
          await tx.knowledgeEntry.create({ data: {
            id: deterministicOperationId("knowledge", operationKey, pairIndex),
            agentId: sample.agentId, trainingSampleId: sample.id, sourceType: "chat_import", sourceId: sample.id,
            ...identity.fields, identityBinding, title: `${sample.scene}：${customerText.slice(0, 28)}`,
            content: `客户：${customerText}\n客服：${idealReply}`, tags: jsonValue([sample.scene, sample.agentKey, ...inferSkillHints(pair)]), qualityScore: score,
            status: knowledgeStatus,
            reviewer: knowledgeStatus === "ready" ? "system" : null,
            reviewNote: knowledgeEntryReviewNote,
            reviewedAt: knowledgeReviewedAt,
            reviewHistory: jsonValue(
              knowledgeReviewedAt
                ? [{ status: knowledgeStatus, reviewer: "system", note: knowledgeEntryReviewNote, reviewedAt: knowledgeReviewedAt.toISOString() }]
                : [],
            ),
          }});
        }
        const sceneSummary = summarizeSceneChecks(importedSamples);
        const updated = await tx.chatImport.update({ where: { id: record.id }, data: { sceneSummary: jsonValue(sceneSummary) } });
        return serialize({ ...updated, samples: importedSamples.map((sample) => ({ ...sample, quality: evaluateTrainingSampleQuality(sample) })) });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || !operation) throw error;
      const concurrent = await this.prisma.chatImport.findUnique({
        where: { id: importId },
        include: { samples: true },
      });
      if (!concurrent) throw error;
      return this.replayChatImport(concurrent, operation);
    }
  }

  async reviewTrainingSample(id: string, payload: any = {}) {
    return this.prisma.$transaction((tx: PrismaLike) => this.reviewTrainingSampleTx(tx, id, payload));
  }

  async listConversationLearningBundles(filter: OperationsIdentity = {}, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit || 50)), 100));
    if (filter.conversationId && (!filter.wechatAccountId || !filter.customerId)) {
      throw new BadRequestException("conversation learning requires complete conversation identity");
    }
    const conversations = await this.prisma.conversation.findMany({
      where: {
        ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
        ...(filter.conversationId ? { id: filter.conversationId } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      include: {
        customer: true,
        wechatAccount: true,
        messages: {
          where: { direction: { in: ["inbound", "outbound"] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 500,
        },
        orderDrafts: true,
        designJobs: { include: { quoteDrafts: true } },
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: safeLimit,
    });
    const conversationIds = conversations.map((item: any) => item.id);
    const routes = conversationIds.length
      ? await this.prisma.routeEvaluation.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
      : [];
    return serialize(conversations.map((conversation: any) => ({
      conversation: {
        ...conversation,
        messages: undefined,
        orderDrafts: undefined,
        designJobs: undefined,
      },
      messages: [...conversation.messages].reverse(),
      routes: routes.filter((route: any) => route.conversationId === conversation.id),
      quotes: conversation.designJobs.flatMap((job: any) => job.quoteDrafts || []),
      orders: conversation.orderDrafts || [],
    })));
  }

  async confirmConversationOutcome(conversationId: string, payload: any = {}) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const conversation = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new NotFoundException(`conversation not found: ${conversationId}`);
      const identity = {
        wechatAccountId: String(payload.expectedWechatAccountId || payload.wechatAccountId || ""),
        conversationId,
        customerId: String(payload.expectedCustomerId || payload.customerId || ""),
      };
      assertCompleteIdentity(conversation, identity, "conversation outcome confirmation");
      if (payload.expectedConversationId && payload.expectedConversationId !== conversationId) {
        throw new BadRequestException("conversation outcome confirmation identity mismatch: conversationId");
      }
      const outcome = normalizeConversationOutcome(payload.outcome);
      const reviewOperation = buildPrismaReviewOperation(
        "conversation-outcome",
        conversationId,
        payload,
        "conversation outcome operationKey",
      );
      if (!reviewOperation) throw new BadRequestException("conversation outcome operationKey is required");
      const existingReviewLog = await findPrismaReviewLogByEffectKey(tx, reviewOperation.effectKey);
      const route = await tx.routeEvaluation.findFirst({
        where: { conversationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!route) throw new NotFoundException(`conversation route evaluation not found: ${conversationId}`);
      if (existingReviewLog) {
        assertExactOperationReplay(
          readRequestOperationMetadata(existingReviewLog.metadata),
          reviewOperation.operation,
          "conversation outcome confirmation",
        );
        return serialize({ route, reviewLog: existingReviewLog, confirmedOutcome: route.conversionAssessment?.confirmedOutcome || null });
      }
      const now = new Date();
      const confirmedOutcome = {
        outcome,
        reasonCode: String(payload.reasonCode || "").trim() || null,
        note: String(payload.note || "").trim() || null,
        reviewer: String(payload.reviewer || "operator").trim() || "operator",
        confirmedAt: now.toISOString(),
      };
      const updatedRoute = await tx.routeEvaluation.update({
        where: { id: route.id },
        data: {
          conversionAssessment: jsonValue({
            ...(route.conversionAssessment || {}),
            schema: "conversion_assessment_confirmation_v1",
            confirmedOutcome,
          }),
        },
      });
      const reviewLog = await tx.reviewLog.create({ data: {
        id: deterministicOperationId("review", reviewOperation.effectKey),
        targetType: "conversation",
        targetId: conversationId,
        decision: "confirm_conversion_outcome",
        reviewer: confirmedOutcome.reviewer,
        note: confirmedOutcome.note,
        beforeStatus: "unconfirmed",
        afterStatus: outcome,
        metadata: jsonValue({
          effectKey: reviewOperation.effectKey,
          requestOperation: reviewOperation.operation,
          routeEvaluationId: route.id,
          reasonCode: confirmedOutcome.reasonCode,
          ...identity,
        }),
      }});
      return serialize({ route: updatedRoute, reviewLog, confirmedOutcome });
    });
  }

  async reviewKnowledgeEntry(id: string, payload: any = {}) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const before = await tx.knowledgeEntry.findUnique({ where: { id } });
      if (!before) throw new NotFoundException(`knowledge entry not found: ${id}`);
      assertExpectedIdentity(before, payload, "knowledge entry");
      const status = normalizeKnowledgeReviewStatus(payload.status);
      const reviewer = String(payload.reviewer || "人工客服").trim() || "人工客服";
      const note = String(payload.note || knowledgeReviewNote(status)).trim();
      const reviewOperation = buildPrismaReviewOperation(
        "knowledge-entry-review",
        id,
        payload,
        "knowledge entry review operationKey",
      );
      const existingReviewLog = reviewOperation ? await findPrismaReviewLogByEffectKey(tx, reviewOperation.effectKey) : null;
      if (existingReviewLog) {
        assertExactOperationReplay(
          readRequestOperationMetadata(existingReviewLog.metadata),
          reviewOperation!.operation,
          "knowledge entry review",
        );
        return serialize({ knowledgeEntry: before, reviewLog: existingReviewLog });
      }
      let agent = before.agentId ? await tx.customerServiceAgent.findUnique({ where: { id: before.agentId } }) : null;
      if (payload.agentId) agent = await tx.customerServiceAgent.findUnique({ where: { id: payload.agentId } });
      if (payload.agentKey) agent = await tx.customerServiceAgent.findUnique({ where: { key: payload.agentKey } });
      if ((payload.agentId || payload.agentKey) && !agent) {
        throw new BadRequestException(`knowledge entry agent not found: ${payload.agentId || payload.agentKey}`);
      }
      const now = new Date();
      const nextTags = payload.tags !== undefined
        ? normalizeKnowledgeImportTags(payload.tags, agent?.key)
        : normalizeKnowledgeImportTags(before.tags);
      const nextEntry = {
        ...before,
        agentId: agent?.id || before.agentId || null,
        title: payload.title !== undefined ? textOr(payload.title, before.title || "") : before.title || "",
        content: payload.content !== undefined ? textOr(payload.content, before.content || "") : before.content || "",
        tags: nextTags,
        qualityScore: payload.qualityScore !== undefined ? clampKnowledgeScore(payload.qualityScore, before.qualityScore) : clampKnowledgeScore(before.qualityScore, 70),
        status,
      };
      assertKnowledgeEntryReadyForReview(nextEntry, status);
      const data: any = {
        status,
        reviewer,
        reviewNote: note,
        reviewedAt: now,
        reviewHistory: jsonValue(appendKnowledgeReviewHistory(before.reviewHistory, { status, reviewer, note, reviewedAt: now.toISOString() })),
      };
      if (agent) data.agentId = agent.id;
      if (payload.title !== undefined) data.title = nextEntry.title;
      if (payload.content !== undefined) data.content = nextEntry.content;
      if (payload.tags !== undefined) data.tags = jsonValue(nextTags);
      if (payload.qualityScore !== undefined) data.qualityScore = nextEntry.qualityScore;
      const knowledgeEntry = await tx.knowledgeEntry.update({ where: { id }, data });
      const reviewLog = await tx.reviewLog.create({ data: {
        ...(reviewOperation ? { id: deterministicOperationId("review", reviewOperation.effectKey) } : {}),
        targetType: "knowledge_entry",
        targetId: id,
        decision: status === "ready" ? "approve_knowledge_entry" : status === "rejected" ? "reject_knowledge_entry" : "mark_knowledge_entry_review",
        reviewer,
        note,
        beforeStatus: normalizeKnowledgeEntryStatus(before),
        afterStatus: status,
        metadata: jsonValue({
          source: "knowledge_entry_review",
          sourceType: knowledgeEntry.sourceType,
          sourceId: knowledgeEntry.sourceId,
          agentId: knowledgeEntry.agentId,
          ...identityFields(knowledgeEntry),
          ...(reviewOperation ? { effectKey: reviewOperation.effectKey, requestOperation: reviewOperation.operation } : {}),
        }),
      }});
      return serialize({ knowledgeEntry, reviewLog });
    });
  }

  private replayChatImport(record: any, operation: RequestOperationMetadata) {
    assertExactOperationReplay(
      readRequestOperationMetadata(record?.identityBinding),
      operation,
      "chat import create",
    );
    return serialize({
      ...record,
      samples: (record.samples || []).map((sample: any) => ({
        ...sample,
        quality: evaluateTrainingSampleQuality(sample),
      })),
    });
  }

  async reviewTrainingSamplesBatch(ids: string[], payload: any, expectedBySampleId: Record<string, ExpectedIdentityPayload> = {}) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const results = [];
      for (const id of ids) results.push(await this.reviewTrainingSampleTx(tx, id, { ...payload, ...(expectedBySampleId[id] || {}) }));
      return results;
    });
  }

  private async reviewTrainingSampleTx(tx: PrismaLike, id: string, payload: any) {
    const before = await tx.trainingSample.findUnique({ where: { id } });
    if (!before) throw new NotFoundException(`training sample not found: ${id}`);
    assertExpectedIdentity(before, payload, "training sample");
    const status = normalizeTrainingSampleStatus(payload.status);
    const reviewer = payload.reviewer || "人工客服";
    const note = payload.note || trainingSampleReviewNote(status);
    let agent = before.agentId ? await tx.customerServiceAgent.findUnique({ where: { id: before.agentId } }) : null;
    if (payload.agentId) agent = await tx.customerServiceAgent.findUnique({ where: { id: payload.agentId } });
    if (payload.agentKey) agent = await tx.customerServiceAgent.findUnique({ where: { key: payload.agentKey } });
    if ((payload.agentId || payload.agentKey) && !agent) throw new BadRequestException(`training sample agent not found: ${payload.agentId || payload.agentKey}`);
    const reviewOperation = buildPrismaReviewOperation(
      "training-sample-review",
      id,
      payload,
      "training sample review operationKey",
    );
    const existingReviewLog = reviewOperation ? await findPrismaReviewLogByEffectKey(tx, reviewOperation.effectKey) : null;
    if (existingReviewLog) {
      assertExactOperationReplay(
        readRequestOperationMetadata(existingReviewLog.metadata),
        reviewOperation!.operation,
        "training sample review",
      );
      return serialize({ sample: { ...before, quality: evaluateTrainingSampleQuality(before) }, reviewLog: existingReviewLog });
    }
    const now = new Date();
    const history = Array.isArray(before.reviewHistory) ? before.reviewHistory : [];
    const data: any = {
      status, reviewer, reviewNote: note, reviewedAt: now,
      reviewHistory: jsonValue([...history, { status, reviewer, note, reviewedAt: now.toISOString() }]),
    };
    if (agent) { data.agentId = agent.id; data.agentKey = agent.key; }
    if (payload.scene !== undefined) data.scene = textOr(payload.scene, before.scene || "未分类");
    if (payload.customerText !== undefined) data.customerText = textOr(payload.customerText, before.customerText || "");
    if (payload.idealReply !== undefined) data.idealReply = textOr(payload.idealReply, before.idealReply || "");
    if (payload.score !== undefined) data.score = clampScore(payload.score, before.score);
    if (payload.skillHints !== undefined) data.skillHints = jsonValue(normalizeSkillHints(payload.skillHints));
    if ((before.sourceType || (before.importId ? "chat_import" : "")) === "chat_import" && status === "ready") {
      data.sceneCheck = jsonValue({ status: "clear", reason: "human_confirmed_scene", needsReview: false, topScene: { scene: data.scene || before.scene, agentKey: data.agentKey || before.agentKey, score: Math.max(30, Number(before.sceneScore || 0)), matchedKeywords: jsonStrings(before.matchedKeywords) }, secondaryScene: (before.sceneCheck as any)?.secondaryScene || null, scoreGap: Math.max(30, Number(before.sceneScore || 0)) });
    }
    const sample = await tx.trainingSample.update({ where: { id }, data });
    const entries = await tx.knowledgeEntry.findMany({
      where: { OR: [{ trainingSampleId: id }, { sourceType: { in: ["chat_import", "route_correction"] }, sourceId: id }] },
    });
    for (const entry of entries) await tx.knowledgeEntry.update({ where: { id: entry.id }, data: {
      agentId: sample.agentId, title: `${sample.scene || "未分类"}：${String(sample.customerText || "").slice(0, 28)}`,
      content: `客户：${sample.customerText}\n客服：${sample.idealReply}`,
      tags: jsonValue([sample.scene, sample.agentKey, ...jsonStrings(sample.skillHints)].filter(Boolean)), qualityScore: sample.score,
      status,
      reviewer,
      reviewNote: note,
      reviewedAt: now,
      reviewHistory: jsonValue(appendKnowledgeReviewHistory(entry.reviewHistory, { status, reviewer, note, reviewedAt: now.toISOString() })),
    }});
    const reviewLog = await tx.reviewLog.create({ data: {
      ...(reviewOperation ? { id: deterministicOperationId("review", reviewOperation.effectKey) } : {}),
      targetType: "training_sample", targetId: id,
      decision: status === "ready" ? "approve_training_sample" : status === "rejected" ? "reject_training_sample" : "mark_training_sample_review",
      reviewer, note, beforeStatus: before.status || "ready", afterStatus: status,
      metadata: jsonValue({
        source: "training_sample_review",
        agentKey: sample.agentKey,
        scene: sample.scene,
        sourceType: sample.sourceType || (sample.sourceRouteId ? "route_correction" : sample.importId ? "chat_import" : "manual"),
        ...identityFields(sample),
        ...(reviewOperation ? { effectKey: reviewOperation.effectKey, requestOperation: reviewOperation.operation } : {}),
      }),
    }});
    if (sample.importId) await this.refreshImportSummary(tx, sample.importId);
    return serialize({ sample: { ...sample, quality: evaluateTrainingSampleQuality(sample) }, reviewLog });
  }

  async applyAgentSkillSuggestions(suggestions: any[]) {
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const result = { suggested: Array.isArray(suggestions) ? suggestions.length : 0, created: [] as any[], updated: [] as any[], skipped: [] as any[] };
      for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
        if (!suggestion?.agentId || !suggestion?.name) { result.skipped.push({ ...suggestion, reason: "missing_agent_or_name" }); continue; }
        const sampleIds = unique(jsonStrings(suggestion.sampleIds));
        const samples = sampleIds.length ? await tx.trainingSample.findMany({ where: { id: { in: sampleIds } } }) : [];
        if (samples.length !== sampleIds.length) { result.skipped.push({ ...suggestion, reason: "missing_source_sample" }); continue; }
        const scope = sharedIdentity(samples);
        if (scope === null) { result.skipped.push({ ...suggestion, reason: "mixed_source_identity" }); continue; }
        const candidates = await tx.agentSkill.findMany({ where: { agentId: suggestion.agentId } });
        const existing = candidates.find((skill: any) => canonicalSkillName(skill.name) === canonicalSkillName(suggestion.name) && sameIdentity(skill, scope));
        const patch = {
          name: suggestion.name, description: suggestion.description || "", enabled: true,
          sampleCount: Number(suggestion.sampleCount || 0), confidence: Number(suggestion.confidence || 0), sourceType: "training_compiler",
          sourceSampleIds: jsonValue(sampleIds), ...scope, identityBinding: jsonValue(hasIdentity(scope) ? { status: "passed", ...scope, sourceSampleIds: sampleIds } : null),
          lastCompiledAt: new Date(),
        };
        if (existing) {
          const changed = existing.name !== patch.name || existing.description !== patch.description || Number(existing.sampleCount || 0) !== patch.sampleCount || Number(existing.confidence || 0) !== patch.confidence;
          if (!changed) { result.skipped.push({ ...serialize(existing), reason: "unchanged" }); continue; }
          result.updated.push(serialize(await tx.agentSkill.update({ where: { id: existing.id }, data: { ...patch, version: Number(existing.version || 1) + 1 } })));
        } else {
          result.created.push(serialize(await tx.agentSkill.create({ data: { agentId: suggestion.agentId, version: 1, ...patch } })));
        }
      }
      return result;
    });
  }

  async listConversations(wechatAccountId?: string) {
    const scopeLimit = 500;
    const fetched = await this.prisma.conversation.findMany({
      where: wechatAccountId ? { wechatAccountId } : undefined,
      include: {
        customer: true,
        wechatAccount: true,
        _count: { select: { messages: { where: { direction: "inbound", readAt: null } } } },
      },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: scopeLimit + 1,
    });
    const truncated = fetched.length > scopeLimit;
    const records = await this.hydrateConversationRows(fetched.slice(0, scopeLimit));
    return { records, truncated, scopeLimit };
  }

  async wechatAccountExists(id: string) {
    return Boolean(await this.prisma.wechatAccount.findUnique({ where: { id }, select: { id: true } }));
  }

  async getConversation(identity: Required<OperationsIdentity>) {
    const raw = await this.prisma.conversation.findUnique({
      where: { id: identity.conversationId },
      include: {
        customer: true,
        wechatAccount: true,
        _count: { select: { messages: { where: { direction: "inbound", readAt: null } } } },
      },
    });
    if (!raw) throw new NotFoundException(`conversation not found: ${identity.conversationId}`);
    assertCompleteIdentity(raw, identity, "conversation operations query");
    return (await this.hydrateConversationRows([raw]))[0];
  }

  private async hydrateConversationRows(rows: any[]) {
    const conversationIds = rows.map((row: any) => row.id);
    const [latestMessages, firstOutboundMessages, firstSentTasks] = conversationIds.length
      ? await Promise.all([
          this.prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT DISTINCT ON ("conversationId") "id", "conversationId", "text", "createdAt"
            FROM "Message"
            WHERE "conversationId" IN (${Prisma.join(conversationIds)})
            ORDER BY "conversationId", "createdAt" DESC, "id" DESC
          `),
          this.prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT DISTINCT ON ("conversationId") "id", "conversationId", "createdAt"
            FROM "Message"
            WHERE "conversationId" IN (${Prisma.join(conversationIds)}) AND "direction" = 'outbound'::"MessageDirection"
            ORDER BY "conversationId", "createdAt" ASC, "id" ASC
          `),
          this.prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT DISTINCT ON ("conversationId") "id", "conversationId", "sentAt", "createdAt"
            FROM "WechatSendTask"
            WHERE "conversationId" IN (${Prisma.join(conversationIds)}) AND "status" = 'sent'::"SendTaskStatus"
            ORDER BY "conversationId", COALESCE("sentAt", "createdAt") ASC, "id" ASC
          `),
        ])
      : [[], [], []];
    const latestByConversation = new Map(latestMessages.map((row: any) => [row.conversationId, row]));
    const outboundByConversation = new Map(firstOutboundMessages.map((row: any) => [row.conversationId, row]));
    const taskByConversation = new Map(firstSentTasks.map((row: any) => [row.conversationId, row]));
    return rows.map((row: any) => {
      const latest: any = latestByConversation.get(row.id) || null;
      const firstOutboundMessage: any = outboundByConversation.get(row.id) || null;
      const firstSentTask: any = taskByConversation.get(row.id) || null;
      const firstResponseAt = [firstOutboundMessage?.createdAt, firstSentTask?.sentAt || firstSentTask?.createdAt].filter(Boolean).sort((a: any, b: any) => Number(new Date(a)) - Number(new Date(b)))[0] || null;
      return serialize({ ...row, _count: undefined, unreadCount: Number(row._count?.messages || 0), lastMessagePreview: String(latest?.text || ""), firstResponseAt });
    });
  }

  async listConversationAudit(identity: Required<OperationsIdentity>, limit = 100) {
    await this.getConversation(identity);
    const rows = serialize(await this.prisma.reviewLog.findMany({
      where: { targetType: "conversation", targetId: identity.conversationId },
      orderBy: { createdAt: "desc" }, take: Math.max(1, Math.min(Number(limit || 100), 300)),
    }));
    return rows.filter((row: any) => row.metadata?.auditType === "conversation_operations");
  }

  async updateConversationOperations(id: string, identity: Required<OperationsIdentity>, patch: Record<string, unknown>, audit: any) {
    if (identity.conversationId !== id) throw new BadRequestException("conversation operations identity mismatch: conversationId");
    return this.prisma.$transaction(async (tx: PrismaLike) => {
      const current = await tx.conversation.findUnique({ where: { id }, include: { customer: true, wechatAccount: true } });
      if (!current) throw new NotFoundException(`conversation not found: ${id}`);
      assertCompleteIdentity(current, identity, "conversation operations update");
      const allowed = ["assignee", "priority", "status", "slaDueAt", "firstResponseDueAt"];
      const safePatch: any = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
      if (!Object.keys(safePatch).length) throw new BadRequestException("conversation operations update has no mutable fields");
      for (const key of ["slaDueAt", "firstResponseDueAt"]) {
        if (!safePatch[key]) continue;
        const parsed = new Date(String(safePatch[key]));
        if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${key} must be a valid ISO date`);
        safePatch[key] = parsed;
      }
      const conversation = await tx.conversation.update({ where: { id }, data: safePatch, include: { customer: true, wechatAccount: true } });
      const reviewLog = await tx.reviewLog.create({ data: {
        targetType: "conversation", targetId: id, decision: audit.decision || "conversation_operations_update", reviewer: audit.reviewer,
        note: audit.note || "", beforeStatus: audit.beforeStatus || "", afterStatus: audit.afterStatus || "",
        metadata: jsonValue({ ...(audit.metadata || {}), ...identity, identityBinding: { status: "passed", ...identity } }),
      }});
      return serialize({ conversation, audit: reviewLog });
    });
  }

  private async resolveIdentity(client: PrismaLike, payload: any, label: string) {
    const requested = identityFields(payload);
    if (!requested.conversationId) {
      if (requested.customerId || requested.wechatAccountId) {
        throw new BadRequestException(`${label} identity binding requires conversationId`);
      }
      const fields = { customerId: null, conversationId: null, wechatAccountId: null };
      return { fields, binding: jsonValue(null) };
    }
    const conversation = await client.conversation.findUnique({ where: { id: requested.conversationId }, select: { id: true, customerId: true, wechatAccountId: true } });
    if (!conversation) throw new NotFoundException(`${label} conversation not found: ${requested.conversationId}`);
    if (requested.customerId && requested.customerId !== conversation.customerId) throw new BadRequestException(`${label} identity mismatch: customerId`);
    if (requested.wechatAccountId && requested.wechatAccountId !== String(conversation.wechatAccountId || "")) throw new BadRequestException(`${label} identity mismatch: wechatAccountId`);
    const fields = { conversationId: conversation.id, customerId: conversation.customerId, wechatAccountId: conversation.wechatAccountId };
    return { fields, binding: jsonValue({ status: "passed", ...fields }) };
  }

  private async refreshImportSummary(client: PrismaLike, importId: string) {
    const samples = await client.trainingSample.findMany({ where: { importId } });
    await client.chatImport.update({ where: { id: importId }, data: { sceneSummary: jsonValue(summarizeSceneChecks(samples)) } });
  }
}

function identityWhere(filter: OperationsIdentity = {}) {
  return {
    ...(filter.wechatAccountId ? { wechatAccountId: filter.wechatAccountId } : {}),
    ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
  };
}

function recordVisibleForIdentity(record: any, filter: OperationsIdentity = {}) {
  const scope = sharedIdentity([record]);
  if (scope === null) return false;
  if (!hasIdentity(scope)) return !hasIdentity(filter);
  if (!hasIdentity(filter)) return false;
  return (scope.wechatAccountId ? scope.wechatAccountId === filter.wechatAccountId : true)
    && (scope.conversationId ? scope.conversationId === filter.conversationId : true)
    && (scope.customerId ? scope.customerId === filter.customerId : true);
}

function identityFields(value: any): any {
  return { wechatAccountId: value?.wechatAccountId || null, conversationId: value?.conversationId || null, customerId: value?.customerId || null };
}

function assertCompleteIdentity(record: any, expected: Required<OperationsIdentity>, label: string) {
  const missing = Object.entries(expected).filter(([, value]) => !String(value || "").trim()).map(([key]) => key);
  if (missing.length) throw new BadRequestException(`${label} requires complete identity: ${missing.join(", ")}`);
  for (const key of ["wechatAccountId", "conversationId", "customerId"] as const) {
    const actual = key === "conversationId" ? record?.id : record?.[key];
    if (String(actual || "") !== String(expected[key])) throw new BadRequestException(`${label} identity mismatch: ${key}`);
  }
}

function skillVisibleForIdentity(skill: any, samples: Map<string, any>, filter: OperationsIdentity) {
  const scope = skillIdentity(skill, samples);
  if (scope === null) return false;
  if (!hasIdentity(scope)) return true;
  if (!hasIdentity(filter)) return false;
  return (scope.wechatAccountId ? scope.wechatAccountId === filter.wechatAccountId : true)
    && (scope.conversationId ? scope.conversationId === filter.conversationId : true)
    && (scope.customerId ? scope.customerId === filter.customerId : true);
}

function skillIdentity(skill: any, samples: Map<string, any>) {
  const sourceIds = jsonStrings(skill.sourceSampleIds);
  const sourceRows = sourceIds.map((id) => samples.get(id)).filter(Boolean);
  if (sourceRows.length !== sourceIds.length) return null;
  const direct = sharedIdentity([skill]);
  if (direct === null) return null;
  if (hasIdentity(direct)) return direct;
  return sourceRows.length ? sharedIdentity(sourceRows) : {};
}

function skillScope(skill: any, samples: Map<string, any>) {
  const scope = skillIdentity(skill, samples);
  if (scope === null) return { level: "mixed", label: "混合来源", reason: "Skill 身份字段或来源样本身份不一致，自动回复会拒绝使用。" };
  if (scope.conversationId) return { level: "conversation", label: "当前会话私有", reason: "只在同一微信账号、同一客户、同一会话下使用。", ...scope };
  if (scope.customerId) return { level: "customer", label: "客户私有", reason: "只在同一客户下使用。", ...scope };
  if (scope.wechatAccountId) return { level: "wechat_account", label: "微信账号内共享", reason: "只在同一微信账号下使用。", ...scope };
  return { level: "global", label: "全局 Skill", reason: "没有客户或账号绑定，作为该 Agent 的通用能力使用。" };
}

function isClarificationDerivedSkill(skill: any, samples: Map<string, any>) {
  if (canonicalSkillName(skill.name) === canonicalSkillName("防乱回复")) return false;
  const rows = jsonStrings(skill.sourceSampleIds).map((id) => samples.get(id)).filter(Boolean);
  return Boolean(rows.length) && rows.every((sample) => isSceneClarificationReply(sample.idealReply));
}

function sharedIdentity(records: any[]): any {
  const result: any = {};
  for (const key of ["wechatAccountId", "conversationId", "customerId"]) {
    const values = unique(records.flatMap((record) => [record?.[key], record?.identityBinding?.[key]]).map((value) => String(value || "").trim()).filter(Boolean));
    if (values.length > 1) return null;
    if (values.length === 1) result[key] = values[0];
  }
  return result;
}

function hasIdentity(value: any) { return Boolean(value?.wechatAccountId || value?.conversationId || value?.customerId); }
function sameIdentity(left: any, right: any) { return ["wechatAccountId", "conversationId", "customerId"].every((key) => String(left?.[key] || "") === String(right?.[key] || "")); }
function canonicalSkillName(value: any) { return String(value || "").trim().replace(/\s+/g, "").toLowerCase(); }
function jsonStrings(value: any): string[] { return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function jsonValue(value: any): Prisma.InputJsonValue | typeof Prisma.JsonNull { return value === undefined || value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue; }
function integerOrNull(value: any) { const number = Number(value); return Number.isInteger(number) ? number : null; }
function round(value: number) { return Math.round(value * 100) / 100; }
function textOr(value: any, fallback: string) { return String(value ?? "").trim() || fallback; }
function clampScore(value: any, fallback: any) { const score = Number(value); return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : Number(fallback || 0); }
function normalizeSkillHints(value: any) { const raw = Array.isArray(value) ? value : String(value || "").split(/[,、;；|]/); return unique(raw.map((item) => String(item || "").trim()).filter(Boolean)); }
function inferSkillHints(pair: any) { const text = `${pair.question || pair.customerText || ""}\n${pair.answer || pair.idealReply || ""}`; if (isSceneClarificationReply(pair.answer || pair.idealReply)) return ["防乱回复"]; const hints = []; if (/预算|价格|总预算|每盒|每份/.test(text)) hints.push("预算澄清"); if (/效果图|设计|logo|摆拍/i.test(text)) hints.push("设计需求确认"); if (/发货|快递|物流|签收/.test(text)) hints.push("物流安抚"); if (/退款|退货|换货|补发/.test(text)) hints.push("售后方案"); if (/亲|您|帮您|这边|建议|麻烦/.test(text)) hints.push("高情商话术"); return unique(hints); }
function summarizeSceneChecks(samples: any[]) { const summary: any = { sampleCount: samples.length, clearCount: 0, weakCount: 0, ambiguousCount: 0, unmatchedCount: 0, sceneUncertainCount: 0, readyCount: 0, reviewCount: 0, rejectedCount: 0 }; for (const sample of samples) { const sceneStatus = String(sample?.sceneCheck?.status || ""); if (sceneStatus === "clear") summary.clearCount += 1; if (sceneStatus === "weak") summary.weakCount += 1; if (sceneStatus === "ambiguous") summary.ambiguousCount += 1; if (sceneStatus === "unmatched") summary.unmatchedCount += 1; const status = String(sample.status || "ready"); if (status === "ready") summary.readyCount += 1; if (status === "review") summary.reviewCount += 1; if (status === "rejected") summary.rejectedCount += 1; } summary.sceneUncertainCount = summary.weakCount + summary.ambiguousCount + summary.unmatchedCount; return summary; }
function normalizeKnowledgeImportTags(value: any, agentKey?: string) { const raw = Array.isArray(value) ? value : String(value || "").split(/[,、;；|]/); const tags = unique(raw.map((item) => String(item || "").trim()).filter(Boolean)); if (agentKey) tags.push(agentKey); return unique(tags); }
function normalizeKnowledgeReviewStatus(value: any) { const status = String(value || "").trim(); if (status === "ready" || status === "review" || status === "rejected") return status; throw new BadRequestException("knowledge status must be one of ready, review, rejected"); }
function normalizeKnowledgeEntryStatus(entry: any) {
  const explicit = String(entry?.status || "").trim();
  if (explicit === "ready" || explicit === "review" || explicit === "rejected") return explicit;
  if (entry?.sourceType === "starter_knowledge") return "ready";
  if (entry?.trainingSample) return String(entry.trainingSample.status || "ready") === "ready" ? "ready" : String(entry.trainingSample.status || "review");
  if (entry?.sourceType === "chat_import" || entry?.sourceType === "route_correction") return "ready";
  return "review";
}

function knowledgeVisibleForIdentity(record: any, filter: OperationsIdentity = {}) {
  const scope = sharedIdentity([record]);
  if (scope === null) return false;
  if (!hasIdentity(scope)) return true;
  if (!hasIdentity(filter)) return false;
  return (scope.wechatAccountId ? scope.wechatAccountId === filter.wechatAccountId : true)
    && (scope.conversationId ? scope.conversationId === filter.conversationId : true)
    && (scope.customerId ? scope.customerId === filter.customerId : true);
}
function knowledgeReviewNote(status: string) { if (status === "ready") return "knowledge entry approved for reply retrieval"; if (status === "rejected") return "knowledge entry disabled from reply retrieval"; return "knowledge entry kept in review"; }
function normalizeConversationOutcome(value: unknown) { const outcome = String(value || "").trim().toLowerCase(); if (outcome === "won" || outcome === "lost" || outcome === "ongoing") return outcome; throw new BadRequestException("outcome must be one of won, lost, ongoing"); }
function appendKnowledgeReviewHistory(value: any, item: Record<string, unknown>) { return [...(Array.isArray(value) ? value : []), item].slice(-50); }
function clampKnowledgeScore(value: any, fallback: any) { const score = Number(value); if (!Number.isFinite(score)) return Number.isFinite(Number(fallback)) ? Number(fallback) : 70; return Math.max(0, Math.min(100, Math.round(score))); }
function assertKnowledgeEntryReadyForReview(entry: any, status: string) {
  if (status !== "ready") return;
  const blockers: string[] = [];
  if (!String(entry?.agentId || "").trim()) blockers.push("missing_agent");
  if (!String(entry?.title || "").trim()) blockers.push("missing_title");
  if (String(entry?.content || "").trim().length < 20) blockers.push("short_content");
  if (Number(entry?.qualityScore || 0) < 60) blockers.push("low_quality_score");
  if (!normalizeKnowledgeImportTags(entry?.tags).length) blockers.push("missing_tags");
  if (blockers.length) throw new BadRequestException(`knowledge entry cannot be marked ready: ${blockers.join(", ")}`);
}
async function findPrismaReviewLogByEffectKey(client: PrismaLike, effectKey: string) {
  const key = String(effectKey || "").trim();
  if (!key || typeof client?.reviewLog?.findFirst !== "function") return null;
  return client.reviewLog.findFirst({
    where: { metadata: { path: ["effectKey"], equals: key } },
    orderBy: { createdAt: "desc" },
  });
}
function buildPrismaReviewOperation(scope: string, targetId: string, payload: any, label: string) {
  if (!payload?.operationKey) return null;
  const operationKey = normalizeOperationKey(payload.operationKey, label);
  const effectKey = `${scope}:${operationKey}:${targetId}`;
  const { operationKey: _operationKey, ...reviewPayload } = payload || {};
  return {
    effectKey,
    operation: requestOperationMetadata(
      operationKey,
      createOperationFingerprint(scope, {
        targetId,
        expectedWechatAccountId: reviewPayload.expectedWechatAccountId || null,
        expectedConversationId: reviewPayload.expectedConversationId || null,
        expectedCustomerId: reviewPayload.expectedCustomerId || null,
      }, reviewPayload),
    ),
  };
}
function buildPrismaKnowledgeImportOperation(operationKey: string, identity: any, source: string, rows: any[] = []) {
  const key = normalizeOperationKey(operationKey, "knowledge import operationKey");
  const effectKey = `knowledge-import:${key}`;
  return {
    effectKey,
    operation: requestOperationMetadata(
      key,
      createOperationFingerprint("knowledge-import", {
        source,
        customerId: identity?.customerId || null,
        conversationId: identity?.conversationId || null,
        wechatAccountId: identity?.wechatAccountId || null,
      }, { rows: Array.isArray(rows) ? rows : [] }),
    ),
  };
}
function buildPrismaKnowledgeImportFailureOperation(operationKey: string, identity: any, source: string, parsed: any, phase: string) {
  const key = normalizeOperationKey(operationKey, "knowledge import operationKey");
  const effectKey = `knowledge-import:${key}`;
  return {
    effectKey,
    operation: requestOperationMetadata(
      key,
      createOperationFingerprint("knowledge-import", {
        source,
        customerId: identity?.customerId || null,
        conversationId: identity?.conversationId || null,
        wechatAccountId: identity?.wechatAccountId || null,
      }, { failure: normalizeKnowledgeImportFailure(parsed, phase) }),
    ),
  };
}
function normalizeKnowledgeImportFailure(parsed: any = {}, phase = "parse_failed") {
  return {
    phase: String(phase || "parse_failed"),
    ok: Boolean(parsed?.ok),
    importedCount: Number(parsed?.importedCount || 0),
    skippedCount: Number(parsed?.skippedCount || 0),
    errors: normalizeKnowledgeImportErrors(parsed?.errors),
    missingRequiredFields: normalizeKnowledgeImportFields(parsed?.missingRequiredFields),
    blockers: Array.isArray(parsed?.acceptance?.blockers)
      ? parsed.acceptance.blockers.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, 20)
      : [],
  };
}
function normalizeKnowledgeImportErrors(value: any) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 50)
    .map((item) => ({
      line: Number.isFinite(Number(item?.line)) ? Number(item.line) : null,
      message: String(item?.message || item || "").trim(),
    }))
    .filter((item) => item.message);
}
function normalizeKnowledgeImportFields(value: any) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 20)
    .map((item) => typeof item === "string" ? item : String(item?.field || item?.label || "").trim())
    .filter(Boolean);
}
function serialize(value: any): any { if (value instanceof Date) return value.toISOString(); if (Array.isArray(value)) return value.map(serialize); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, serialize(item)])); return value; }
