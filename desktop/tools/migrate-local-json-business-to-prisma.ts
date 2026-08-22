import { Prisma, PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const sourceArg = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length);
const sourcePath = path.resolve(sourceArg || process.env.LOCAL_STORE_FILE || path.join(process.cwd(), ".runtime", "local-store.json"));
const dryRun = args.includes("--dry-run");

function rows(data: any, key: string): any[] {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function asDate(value: unknown): Date | undefined {
  return value ? new Date(String(value)) : undefined;
}

function asNullableDate(value: unknown): Date | null {
  return value ? new Date(String(value)) : null;
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

async function batch(actions: Array<Prisma.PrismaPromise<unknown>>, size = 100) {
  for (let index = 0; index < actions.length; index += size) {
    await prisma.$transaction(actions.slice(index, index + size));
  }
}

function mappedAgentId(agentIdMap: Map<string, string>, value: unknown): string | null {
  if (!value) return null;
  return agentIdMap.get(String(value)) || null;
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`local store not found: ${sourcePath}`);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, ""));
  const collectionNames = [
    "skus", "skuChangeLogs", "designAssets", "designRevisions", "designPlatformExecutions",
    "orderDrafts", "paymentEvents", "notifications", "reviewLogs", "agents", "agentSkills",
    "chatImports", "trainingSamples", "knowledgeEntries", "routeEvaluations",
    "personalWechatRpaBindings", "personalWechatRpaAuditLogs", "inboundMessageOperations",
    "wechatWorkSyncCursors", "wechatWorkCustomerUpgrades",
  ];
  const summary = Object.fromEntries(collectionNames.map((name) => [name, rows(data, name).length]));
  const skuIdsNormalizedByCode = rows(data, "skuChangeLogs").filter((item) =>
    rows(data, "skus").some((sku) => sku.skuCode === item.skuCode && sku.id !== item.skuId),
  ).length;
  const currentSkuCodes = new Set(rows(data, "skus").map((item) => String(item.skuCode)));
  const archivedHistoricalSkuCodes = new Set(rows(data, "skuChangeLogs")
    .filter((item) => !currentSkuCodes.has(String(item.skuCode)))
    .map((item) => String(item.skuCode)));
  const sourceDesignAssetIds = new Set(rows(data, "designAssets").map((item) => String(item.id)));
  const missingHistoricalDesignAssetIds = new Set(rows(data, "designJobs")
    .flatMap((item) => Array.isArray(item.assetIds) ? item.assetIds : [])
    .map(String)
    .filter((id) => id && !sourceDesignAssetIds.has(id)));
  console.log(JSON.stringify({
    sourcePath,
    dryRun,
    summary,
    normalizations: {
      skuIdsNormalizedByCode,
      archivedHistoricalSkus: archivedHistoricalSkuCodes.size,
      missingHistoricalDesignAssetIdsPreservedInJob: missingHistoricalDesignAssetIds.size,
    },
  }, null, 2));
  if (dryRun) return;

  await batch(rows(data, "skus").map((item) => {
    const values = {
      skuCode: item.skuCode,
      name: item.name,
      type: item.type,
      category: item.category || null,
      sceneTags: json(item.sceneTags),
      costPrice: new Prisma.Decimal(item.costPrice || 0),
      salePrice: new Prisma.Decimal(item.salePrice || 0),
      profitRate: item.profitRate === undefined || item.profitRate === null ? null : new Prisma.Decimal(item.profitRate),
      stock: Number(item.stock || 0),
      dimensions: json(item.dimensions),
      weightGram: item.weightGram === undefined || item.weightGram === null ? null : Number(item.weightGram),
      material: item.material || null,
      supplier: item.supplier || null,
      leadTimeDays: item.leadTimeDays === undefined || item.leadTimeDays === null ? null : Number(item.leadTimeDays),
      mainImagePath: item.mainImagePath || null,
      angleImages: json(item.angleImages),
      matchingRules: json(item.matchingRules),
      replacementSkuCodes: json(item.replacementSkuCodes),
      isActive: item.isActive !== false,
    };
    return prisma.sku.upsert({
      where: { skuCode: item.skuCode },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  // Change logs are intentionally retained after demo/test SKUs are removed
  // from the active catalog. PostgreSQL requires a parent row for each log, so
  // restore one disabled archival SKU from the latest durable after/before
  // snapshot. It remains invisible to normal active-catalog queries.
  const historicalSkuByCode = new Map<string, any>();
  for (const item of rows(data, "skuChangeLogs")) {
    if (currentSkuCodes.has(String(item.skuCode))) continue;
    const existing = historicalSkuByCode.get(String(item.skuCode));
    if (!existing || String(item.createdAt || "") > String(existing.createdAt || "")) {
      historicalSkuByCode.set(String(item.skuCode), item);
    }
  }
  await batch([...historicalSkuByCode.values()].map((item) => {
    const snapshot = item.after || item.before || {};
    const values = {
      skuCode: item.skuCode,
      name: snapshot.name || item.name || item.skuCode,
      type: snapshot.type || "item",
      category: snapshot.category || null,
      sceneTags: json(snapshot.sceneTags),
      costPrice: new Prisma.Decimal(snapshot.costPrice || 0),
      salePrice: new Prisma.Decimal(snapshot.salePrice || 0),
      profitRate: snapshot.profitRate === undefined || snapshot.profitRate === null ? null : new Prisma.Decimal(snapshot.profitRate),
      stock: Number(snapshot.stock || 0),
      dimensions: json(snapshot.dimensions),
      weightGram: snapshot.weightGram === undefined || snapshot.weightGram === null ? null : Number(snapshot.weightGram),
      material: snapshot.material || null,
      supplier: snapshot.supplier || null,
      leadTimeDays: snapshot.leadTimeDays === undefined || snapshot.leadTimeDays === null ? null : Number(snapshot.leadTimeDays),
      mainImagePath: snapshot.mainImagePath || null,
      angleImages: json(snapshot.angleImages),
      matchingRules: json(snapshot.matchingRules),
      replacementSkuCodes: json(snapshot.replacementSkuCodes),
      isActive: false,
    };
    return prisma.sku.upsert({
      where: { skuCode: item.skuCode },
      create: { id: item.skuId, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  const skuByCode = new Map((await prisma.sku.findMany({ select: { id: true, skuCode: true } })).map((sku) => [sku.skuCode, sku.id]));
  await batch(rows(data, "skuChangeLogs").map((item) => {
    const skuId = skuByCode.get(String(item.skuCode));
    if (!skuId) throw new Error(`sku change log ${item.id} references missing skuCode ${item.skuCode}`);
    const values = {
      skuId,
      skuCode: item.skuCode,
      name: item.name,
      action: item.action,
      source: item.source,
      operator: item.operator,
      reason: item.reason,
      changedFields: json(item.changedFields),
      before: json(item.before),
      after: json(item.after),
    };
    return prisma.skuChangeLog.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  await batch(rows(data, "designAssets").map((item) => {
    const values = {
      ownerType: item.ownerType,
      ownerId: item.ownerId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      localPath: item.localPath,
      normalizedLocalPath: item.normalizedLocalPath || null,
      sizeBytes: item.sizeBytes === undefined || item.sizeBytes === null ? null : Number(item.sizeBytes),
      role: item.role || null,
      source: item.source || "local_json_import",
      wechatAccountId: item.wechatAccountId || null,
      conversationId: item.conversationId || null,
      customerId: item.customerId || null,
    };
    return prisma.designAsset.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  const designAssetIds = new Set(rows(data, "designAssets").map((item) => String(item.id)));
  await batch(rows(data, "designJobs").filter((item) => Array.isArray(item.assetIds)).map((item) => {
    const assetIds = item.assetIds.map(String).filter(Boolean);
    const missing = assetIds.filter((id: string) => !designAssetIds.has(id));
    const existing = assetIds.filter((id: string) => designAssetIds.has(id));
    const requirements = {
      ...(item.requirements && typeof item.requirements === "object" && !Array.isArray(item.requirements) ? item.requirements : {}),
      ...(missing.length ? { localImportMissingAssetIds: missing } : {}),
    };
    return prisma.designJob.update({
      where: { id: item.id },
      data: {
        assets: { set: existing.map((id: string) => ({ id })) },
        requirements: json(requirements),
      },
    });
  }));

  await batch(rows(data, "designRevisions").map((item) => {
    const values = {
      designJobId: item.designJobId,
      selectedImageId: item.selectedImageId || null,
      revisionNumber: Number(item.revisionNumber || 0),
      instruction: item.instruction || "",
      sourceText: item.sourceText || null,
      policyAction: item.policyAction || "manual_review",
      status: item.status || "requested",
      retryCount: Number(item.retryCount || 0),
      chargeRequired: Boolean(item.chargeRequired),
      manualReviewRequired: Boolean(item.manualReviewRequired),
      externalJobId: item.externalJobId || null,
      operationKey: item.operationKey || null,
      requestFingerprint: item.requestFingerprint || null,
      operationIdentity: json(item.operationIdentity),
      externalRequestId: item.externalRequestId || null,
      dispatchStatus: item.dispatchStatus || null,
      dispatchError: item.dispatchError || item.errorMessage || null,
      waitMessageSentAt: asNullableDate(item.waitMessageSentAt),
      resultImageIds: json(item.resultImageIds),
    };
    return prisma.designRevision.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "designPlatformExecutions").map((item) => {
    const values = {
      operationKey: item.operationKey,
      externalJobId: item.externalJobId,
      requestId: item.requestId,
      scopeKey: item.scopeKey,
      adapter: item.adapter || "art_image_local",
      designJobId: item.designJobId,
      designRevisionId: item.designRevisionId || null,
      attemptNo: Number(item.attemptNo || 1),
      processRunId: item.processRunId,
      status: item.status || "prepared",
      acceptanceStatus: item.acceptanceStatus || "pending",
      refundStatus: item.refundStatus || "pending",
      imageCount: Number(item.imageCount || 0),
      images: json(item.images),
      refundSummary: json(item.refundSummary),
      errorCode: item.errorCode || null,
      errorCategory: item.errorCategory || null,
      errorMessage: item.errorMessage || null,
      responseHttpStatus: item.responseHttpStatus === undefined || item.responseHttpStatus === null ? null : Number(item.responseHttpStatus),
      dispatchedAt: asNullableDate(item.dispatchedAt),
      acceptedAt: asNullableDate(item.acceptedAt),
      completedAt: asNullableDate(item.completedAt),
      resolvedAt: asNullableDate(item.resolvedAt),
    };
    return prisma.designPlatformExecution.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "orderDrafts").map((item) => {
    const values = {
      quoteDraftId: item.quoteDraftId,
      designJobId: item.designJobId,
      customerId: item.customerId,
      conversationId: item.conversationId,
      wechatAccountId: item.wechatAccountId,
      selectedImageId: item.selectedImageId || null,
      quantity: Number(item.quantity || 0),
      unitPrice: new Prisma.Decimal(item.unitPrice || 0),
      totalPrice: new Prisma.Decimal(item.totalPrice || 0),
      totalCost: new Prisma.Decimal(item.totalCost || 0),
      profit: new Prisma.Decimal(item.profit || 0),
      status: item.status || "draft",
      paymentStatus: item.paymentStatus || "unpaid",
      productionStatus: item.productionStatus || "not_started",
      productionDueAt: item.productionDueAt || null,
      carrier: item.carrier || null,
      trackingNo: item.trackingNo || null,
      shippedAt: item.shippedAt || null,
      deliveredAt: item.deliveredAt || null,
      bundleSnapshot: json(item.bundleSnapshot),
      selectedImageSnapshot: json(item.selectedImageSnapshot),
      customerNotes: item.customerNotes || null,
      owner: item.owner || null,
    };
    return prisma.orderDraft.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "paymentEvents").map((item) => {
    const values = {
      quoteDraftId: item.quoteDraftId,
      orderDraftId: item.orderDraftId || null,
      customerId: item.customerId,
      conversationId: item.conversationId || null,
      wechatAccountId: item.wechatAccountId || null,
      paymentStatus: item.paymentStatus,
      amountCny: item.amountCny === undefined || item.amountCny === null ? null : new Prisma.Decimal(item.amountCny),
      method: item.method || null,
      proofReference: item.proofReference || null,
      reviewer: item.reviewer || null,
      note: item.note || null,
      source: item.source || "manual_payment_proof",
      idempotencyKey: item.idempotencyKey || item.id,
    };
    return prisma.paymentEvent.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  await batch(rows(data, "notifications").map((item) => prisma.notification.upsert({
    where: { id: item.id },
    create: {
      id: item.id, level: item.level, title: item.title, body: item.body || null,
      target: json(item.target), readAt: asNullableDate(item.readAt), createdAt: asDate(item.createdAt),
    },
    update: { level: item.level, title: item.title, body: item.body || null, target: json(item.target), readAt: asNullableDate(item.readAt) },
  })));

  await batch(rows(data, "reviewLogs").map((item) => {
    const values = {
      targetType: item.targetType,
      targetId: item.targetId,
      decision: item.decision,
      reviewer: item.reviewer,
      note: item.note || null,
      beforeStatus: item.beforeStatus || null,
      afterStatus: item.afterStatus || null,
      metadata: json(item.metadata),
    };
    return prisma.reviewLog.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  const agentIdMap = new Map<string, string>();
  for (const item of rows(data, "agents")) {
    const existing = await prisma.customerServiceAgent.findUnique({ where: { key: item.key }, select: { id: true } });
    const values = {
      name: item.name,
      scene: item.scene,
      description: item.description || null,
      valueLevel: item.valueLevel || null,
      enabled: item.enabled !== false,
      sortOrder: Number(item.sortOrder || 0),
    };
    const saved = existing
      ? await prisma.customerServiceAgent.update({ where: { id: existing.id }, data: values, select: { id: true } })
      : await prisma.customerServiceAgent.create({
          data: { id: item.id, key: item.key, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
          select: { id: true },
        });
    agentIdMap.set(String(item.id), saved.id);
  }

  const existingSkills = await prisma.agentSkill.findMany({ select: { id: true, agentId: true, name: true } });
  const skillByBusinessKey = new Map(existingSkills.map((skill) => [`${skill.agentId}\u0000${skill.name}`, skill.id]));
  for (const item of rows(data, "agentSkills")) {
    const agentId = mappedAgentId(agentIdMap, item.agentId);
    if (!agentId) throw new Error(`agent skill ${item.id} references missing agent ${item.agentId}`);
    const existingId = skillByBusinessKey.get(`${agentId}\u0000${item.name}`);
    const values = {
      agentId,
      name: item.name,
      description: item.description || null,
      enabled: item.enabled !== false,
      version: Number(item.version || 1),
      sourceType: item.sourceType || null,
      sourceSampleIds: json(item.sourceSampleIds),
      sampleCount: Number(item.sampleCount || 0),
      confidence: Number(item.confidence || 0),
      lastCompiledAt: asNullableDate(item.lastCompiledAt),
      wechatAccountId: item.wechatAccountId || null,
      conversationId: item.conversationId || null,
      customerId: item.customerId || null,
      identityBinding: json(item.identityBinding),
    };
    if (existingId) {
      await prisma.agentSkill.update({ where: { id: existingId }, data: values });
    } else {
      await prisma.agentSkill.upsert({
        where: { id: item.id },
        create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
        update: values,
      });
      skillByBusinessKey.set(`${agentId}\u0000${item.name}`, item.id);
    }
  }

  await batch(rows(data, "chatImports").map((item) => {
    const values = {
      name: item.name,
      source: item.source,
      channel: item.channel,
      agentId: mappedAgentId(agentIdMap, item.agentId),
      rawText: item.rawText || "",
      messageCount: Number(item.messageCount || 0),
      pairCount: Number(item.pairCount || 0),
      warnings: json(item.warnings),
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      wechatAccountId: item.wechatAccountId || null,
      identityBinding: json(item.identityBinding),
      sceneSummary: json(item.sceneSummary),
    };
    return prisma.chatImport.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "trainingSamples").map((item) => {
    const values = {
      importId: item.importId || null,
      agentId: mappedAgentId(agentIdMap, item.agentId),
      agentKey: item.agentKey,
      scene: item.scene,
      customerText: item.customerText || "",
      idealReply: item.idealReply || "",
      score: Number(item.score || 0),
      status: item.status || "review",
      skillHints: json(item.skillHints),
      sourceLineStart: item.sourceLineStart === undefined || item.sourceLineStart === null ? null : Number(item.sourceLineStart),
      sourceLineEnd: item.sourceLineEnd === undefined || item.sourceLineEnd === null ? null : Number(item.sourceLineEnd),
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      wechatAccountId: item.wechatAccountId || null,
      identityBinding: json(item.identityBinding),
      sceneScore: Number(item.sceneScore || 0),
      sceneScores: json(item.sceneScores),
      matchedKeywords: json(item.matchedKeywords),
      sceneCheck: json(item.sceneCheck),
      sourceType: item.sourceType || null,
      sourceRouteId: item.sourceRouteId || null,
      reviewer: item.reviewer || null,
      reviewNote: item.reviewNote || null,
      reviewedAt: asNullableDate(item.reviewedAt),
      reviewHistory: json(item.reviewHistory),
    };
    return prisma.trainingSample.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "knowledgeEntries").map((item) => {
    const values = {
      agentId: mappedAgentId(agentIdMap, item.agentId),
      trainingSampleId: item.trainingSampleId || null,
      sourceType: item.sourceType,
      sourceId: item.sourceId || null,
      title: item.title,
      content: item.content || "",
      tags: json(item.tags),
      qualityScore: item.qualityScore === undefined || item.qualityScore === null ? null : Number(item.qualityScore),
      status: item.status || "review",
      reviewer: item.reviewer || null,
      reviewNote: item.reviewNote || null,
      reviewedAt: asNullableDate(item.reviewedAt),
      reviewHistory: json(item.reviewHistory),
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      wechatAccountId: item.wechatAccountId || null,
      identityBinding: json(item.identityBinding),
      metadata: json(item.metadata),
    };
    return prisma.knowledgeEntry.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "routeEvaluations").map((item) => {
    const values = {
      channel: item.channel,
      text: item.text || "",
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      wechatAccountId: item.wechatAccountId || null,
      agentId: mappedAgentId(agentIdMap, item.agentId),
      agentKey: item.agentKey,
      scene: item.scene,
      action: item.action,
      confidence: Number(item.confidence || 0),
      isHighValue: Boolean(item.isHighValue),
      budget: json(item.budget),
      missingFields: json(item.missingFields),
      riskFlags: json(item.riskFlags),
      identityBinding: json(item.identityBinding),
      sceneScore: Number(item.sceneScore || 0),
      sceneScores: json(item.sceneScores),
      matchedKeywords: json(item.matchedKeywords),
      sceneDecision: json(item.sceneDecision),
      sceneClarification: json(item.sceneClarification),
      clarificationResolution: json(item.clarificationResolution),
      sceneMemory: json(item.sceneMemory),
      sceneAudit: json(item.sceneAudit),
      routingPolicy: json(item.routingPolicy),
      correction: json(item.correction),
      suggestedReply: item.suggestedReply || null,
      appliedSkills: json(item.appliedSkills),
      knowledgeMatches: json(item.knowledgeMatches),
      replyDraft: json(item.replyDraft),
      learningInsight: json(item.learningInsight),
      conversionAssessment: json(item.conversionAssessment),
      operationKey: item.operationKey || null,
    };
    return prisma.routeEvaluation.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "personalWechatRpaBindings").map((item) => {
    const values = {
      bindingKey: item.bindingKey,
      ownerWxId: item.ownerWxId,
      accountNickname: item.accountNickname,
      chatTitle: item.chatTitle,
      conversationType: item.conversationType,
      senderName: item.senderName || null,
      wechatAccountId: item.wechatAccountId,
      customerId: item.customerId,
      conversationId: item.conversationId,
      lastInboundAt: asNullableDate(item.lastInboundAt),
    };
    return prisma.personalWechatRpaBinding.upsert({
      where: { bindingKey: item.bindingKey },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "personalWechatRpaAuditLogs").map((item) => {
    const values = {
      direction: item.direction,
      status: item.status,
      reason: item.reason || null,
      accountNickname: item.accountNickname || null,
      ownerWxId: item.ownerWxId || null,
      chatTitle: item.chatTitle || null,
      externalId: item.externalId || null,
      wechatAccountId: item.wechatAccountId || null,
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      messageId: item.messageId || null,
      sendTaskId: item.sendTaskId || null,
      errorMessage: item.errorMessage || null,
    };
    return prisma.personalWechatRpaAuditLog.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt) },
      update: values,
    });
  }));

  await batch(rows(data, "inboundMessageOperations").map((item) => {
    const values = {
      source: item.source,
      wechatAccountId: item.wechatAccountId,
      externalId: item.externalId,
      requestFingerprint: item.requestFingerprint,
      normalizedPayload: json(item.normalizedPayload),
      status: item.status || "processing",
      stage: item.stage || "reserved",
      bindingKey: item.bindingKey || null,
      customerId: item.customerId || null,
      conversationId: item.conversationId || null,
      messageId: item.messageId || null,
      routeEvaluationId: item.routeEvaluationId || null,
      sendTaskId: item.sendTaskId || null,
      result: json(item.result),
      claimToken: item.claimToken || null,
      leaseExpiresAt: asNullableDate(item.leaseExpiresAt),
      attemptCount: Number(item.attemptCount || 1),
      lastError: item.lastError || null,
      completedAt: asNullableDate(item.completedAt),
    };
    return prisma.inboundMessageOperation.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "wechatWorkSyncCursors").map((item) => {
    const values = {
      openKfid: item.openKfid,
      nextCursor: item.nextCursor || "",
      terminalMessageCount: Number(item.terminalMessageCount || 0),
      batchFingerprint: item.batchFingerprint || null,
      committedAt: asDate(item.committedAt) || new Date(),
    };
    return prisma.wechatWorkSyncCursor.upsert({
      where: { openKfid: item.openKfid },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  await batch(rows(data, "wechatWorkCustomerUpgrades").map((item) => {
    const values = {
      corpId: item.corpId,
      openKfid: item.openKfid,
      externalUserId: item.externalUserId,
      wechatAccountId: item.wechatAccountId,
      conversationId: item.conversationId,
      customerId: item.customerId,
      memberUserId: item.memberUserId,
      state: item.state,
      configId: item.configId || null,
      qrCodeUrl: item.qrCodeUrl || null,
      localPath: item.localPath || null,
      status: item.status,
      claimToken: item.claimToken || null,
      claimExpiresAt: asNullableDate(item.claimExpiresAt),
      textStatus: item.textStatus || "pending",
      imageStatus: item.imageStatus || "pending",
      textMsgId: item.textMsgId || null,
      imageMsgId: item.imageMsgId || null,
      sendTaskId: item.sendTaskId || null,
      sendAttemptId: item.sendAttemptId || null,
      apiAcceptedAt: asNullableDate(item.apiAcceptedAt),
      asyncFailedAt: asNullableDate(item.asyncFailedAt),
      sourceUnionId: item.sourceUnionId || null,
      addedExternalUserId: item.addedExternalUserId || null,
      halfAddedAt: asNullableDate(item.halfAddedAt),
      identityVerifiedAt: asNullableDate(item.identityVerifiedAt),
      addedAt: asNullableDate(item.addedAt),
      errorMessage: item.errorMessage || null,
      version: Number(item.version || 1),
    };
    return prisma.wechatWorkCustomerUpgrade.upsert({
      where: { id: item.id },
      create: { id: item.id, ...values, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) },
      update: values,
    });
  }));

  console.log(JSON.stringify({ imported: summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
