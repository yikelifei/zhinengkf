import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const sourceArg = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length);
const sourcePath = path.resolve(sourceArg || process.env.LOCAL_STORE_FILE || path.join(process.cwd(), ".runtime", "local-store.json"));
const allowOperationalDrift = args.includes("--allow-operational-drift");

function rows(data: any, key: string): any[] {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(String).filter(Boolean))];
}

async function existingIds(delegateName: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const delegate = (prisma as any)[delegateName];
  for (let index = 0; index < ids.length; index += 500) {
    const batch = await delegate.findMany({
      where: { id: { in: ids.slice(index, index + 500) } },
      select: { id: true },
    });
    for (const item of batch) found.add(String(item.id));
  }
  return found;
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`local store not found: ${sourcePath}`);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, ""));
  const specs = [
    ["wechatAccounts", "wechatAccount"],
    ["customers", "customer"],
    ["conversations", "conversation"],
    ["messages", "message"],
    ["wechatWindowSnapshots", "wechatWindowSnapshot"],
    ["designJobs", "designJob"],
    ["designImages", "designImageCandidate"],
    ["quoteDrafts", "quoteDraft"],
    ["sendTasks", "wechatSendTask"],
    ["sendAttempts", "wechatSendAttempt"],
    ["wechatWorkBindings", "wechatWorkBinding"],
    ["wechatWorkAuditLogs", "wechatWorkAuditLog"],
    ["skuChangeLogs", "skuChangeLog"],
    ["designAssets", "designAsset"],
    ["designRevisions", "designRevision"],
    ["designPlatformExecutions", "designPlatformExecution"],
    ["orderDrafts", "orderDraft"],
    ["paymentEvents", "paymentEvent"],
    ["notifications", "notification"],
    ["reviewLogs", "reviewLog"],
    ["chatImports", "chatImport"],
    ["trainingSamples", "trainingSample"],
    ["knowledgeEntries", "knowledgeEntry"],
    ["routeEvaluations", "routeEvaluation"],
    ["personalWechatRpaBindings", "personalWechatRpaBinding"],
    ["personalWechatRpaAuditLogs", "personalWechatRpaAuditLog"],
    ["inboundMessageOperations", "inboundMessageOperation"],
    ["wechatWorkSyncCursors", "wechatWorkSyncCursor"],
    ["wechatWorkCustomerUpgrades", "wechatWorkCustomerUpgrade"],
  ] as const;

  const collections: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const [sourceName, delegateName] of specs) {
    const ids = uniqueStrings(rows(data, sourceName).map((item) => item.id));
    const found = await existingIds(delegateName, ids);
    const missing = ids.filter((id) => !found.has(id));
    const databaseCount = await (prisma as any)[delegateName].count();
    const extra = databaseCount - ids.length;
    collections[sourceName] = { sourceIds: ids.length, foundIds: found.size, databaseCount, extra };
    if (missing.length) failures.push(`${sourceName}: missing ${missing.length} id(s)`);
    if (!allowOperationalDrift && sourceName !== "reviewLogs" && databaseCount !== ids.length) {
      failures.push(`${sourceName}: expected database count ${ids.length}, found ${databaseCount}`);
    }
    if (sourceName === "reviewLogs" && databaseCount < ids.length) {
      failures.push(`${sourceName}: database count ${databaseCount} is smaller than source ${ids.length}`);
    }
  }

  const sourceSkuIds = uniqueStrings(rows(data, "skus").map((item) => item.id));
  const sourceSkuCodes = new Set(rows(data, "skus").map((item) => String(item.skuCode)));
  const historicalSkuIds = uniqueStrings(rows(data, "skuChangeLogs")
    .filter((item) => !sourceSkuCodes.has(String(item.skuCode)))
    .map((item) => item.skuId));
  const expectedSkuIds = uniqueStrings([...sourceSkuIds, ...historicalSkuIds]);
  const foundSkuIds = await existingIds("sku", expectedSkuIds);
  const skuCount = await prisma.sku.count();
  const archivedSkuCount = await prisma.sku.count({ where: { id: { in: historicalSkuIds }, isActive: false } });
  collections.skus = {
    sourceCurrent: sourceSkuIds.length,
    archivedHistorical: historicalSkuIds.length,
    archivedInactive: archivedSkuCount,
    foundIds: foundSkuIds.size,
    databaseCount: skuCount,
  };
  if (
    foundSkuIds.size !== expectedSkuIds.length
    || (!allowOperationalDrift && skuCount !== expectedSkuIds.length)
    || archivedSkuCount !== historicalSkuIds.length
  ) {
    failures.push("skus: current and archived SKU parity failed");
  }

  const databaseAgents = await prisma.customerServiceAgent.findMany({ select: { id: true, key: true } });
  const sourceAgentKeys = new Set(rows(data, "agents").map((item) => String(item.key)));
  const agentIdByLocalId = new Map<string, string>();
  for (const sourceAgent of rows(data, "agents")) {
    const databaseAgent = databaseAgents.find((item) => item.key === sourceAgent.key);
    if (databaseAgent) agentIdByLocalId.set(String(sourceAgent.id), databaseAgent.id);
  }
  collections.agents = { sourceKeys: sourceAgentKeys.size, foundKeys: agentIdByLocalId.size, databaseCount: databaseAgents.length };
  if ((!allowOperationalDrift && databaseAgents.length !== sourceAgentKeys.size) || agentIdByLocalId.size !== sourceAgentKeys.size) {
    failures.push("agents: business-key parity failed");
  }

  const databaseSkills = await prisma.agentSkill.findMany({
    select: { name: true, agent: { select: { key: true } } },
  });
  const sourceAgentKeyById = new Map(rows(data, "agents").map((item) => [String(item.id), String(item.key)]));
  const sourceSkillKeys = new Set(rows(data, "agentSkills").map((item) => `${sourceAgentKeyById.get(String(item.agentId))}\u0000${item.name}`));
  const databaseSkillKeys = new Set(databaseSkills.map((item) => `${item.agent.key}\u0000${item.name}`));
  const missingSkillKeys = [...sourceSkillKeys].filter((key) => !databaseSkillKeys.has(key));
  collections.agentSkills = { sourceBusinessKeys: sourceSkillKeys.size, databaseBusinessKeys: databaseSkillKeys.size, missing: missingSkillKeys.length };
  if ((!allowOperationalDrift && databaseSkillKeys.size !== sourceSkillKeys.size) || missingSkillKeys.length) {
    failures.push("agentSkills: business-key parity failed");
  }

  const sourceAssetIds = new Set(rows(data, "designAssets").map((item) => String(item.id)));
  const databaseJobs = await prisma.designJob.findMany({ select: { id: true, requirements: true, assets: { select: { id: true } } } });
  let assetRelationMismatches = 0;
  let preservedMissingAssetReferences = 0;
  for (const sourceJob of rows(data, "designJobs")) {
    const databaseJob = databaseJobs.find((item) => item.id === sourceJob.id);
    if (!databaseJob) continue;
    const sourceIds = uniqueStrings(Array.isArray(sourceJob.assetIds) ? sourceJob.assetIds : []);
    const expectedExisting = sourceIds.filter((id) => sourceAssetIds.has(id)).sort();
    const expectedMissing = sourceIds.filter((id) => !sourceAssetIds.has(id)).sort();
    const actual = databaseJob.assets.map((item) => item.id).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expectedExisting)) assetRelationMismatches += 1;
    const requirements = databaseJob.requirements as Record<string, unknown> | null;
    const preserved = uniqueStrings(Array.isArray(requirements?.localImportMissingAssetIds) ? requirements.localImportMissingAssetIds : []).sort();
    if (expectedMissing.length && JSON.stringify(preserved) === JSON.stringify(expectedMissing)) preservedMissingAssetReferences += expectedMissing.length;
  }
  collections.designJobAssets = { relationMismatches: assetRelationMismatches, preservedMissingAssetReferences };
  if (assetRelationMismatches) failures.push(`designJobAssets: ${assetRelationMismatches} relation mismatch(es)`);

  const localCancelledAttempts = rows(data, "sendAttempts").filter((item) => item.status === "cancelled");
  const normalizedAttempts = await prisma.wechatSendAttempt.count({
    where: {
      id: { in: localCancelledAttempts.map((item) => item.id) },
      status: "blocked",
      metadata: { path: ["localImportOriginalStatus"], equals: "cancelled" },
    },
  });
  collections.normalizedCancelledAttempts = { source: localCancelledAttempts.length, normalized: normalizedAttempts };
  if (normalizedAttempts !== localCancelledAttempts.length) failures.push("sendAttempts: cancelled normalization parity failed");

  const trackedTaskId = "send_c09fab197cd68b38ea7b84f8d495ed11";
  const sourceTrackedTask = rows(data, "sendTasks").find((item) => item.id === trackedTaskId);
  const databaseTrackedTask = await prisma.wechatSendTask.findUnique({
    where: { id: trackedTaskId },
    select: { status: true, sentAt: true, errorMessage: true },
  });
  collections.trackedQueuedTask = { sourceStatus: sourceTrackedTask?.status || null, database: databaseTrackedTask };
  if (sourceTrackedTask && (
    !databaseTrackedTask
    || databaseTrackedTask.sentAt
    || (!allowOperationalDrift && databaseTrackedTask.status !== sourceTrackedTask.status)
  )) {
    failures.push("trackedQueuedTask: queued task changed during migration");
  }

  const result = { sourcePath, allowOperationalDrift, ok: failures.length === 0, failures, collections };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
