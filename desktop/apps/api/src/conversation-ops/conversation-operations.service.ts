import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LocalStoreService } from "../local-store/local-store.service";
import { PrismaOperationsService } from "../prisma/prisma-operations.service";
import { appConfig } from "../shared/app-config";
import {
  CONVERSATION_PRIORITIES,
  CONVERSATION_SLA_STATES,
  CONVERSATION_STATUSES,
  ConversationOperationsIdentity,
  ConversationOperationsQuery,
  ConversationOperationsUpdatePayload,
  ConversationPriority,
  ConversationSlaState,
  ConversationStatus,
} from "./conversation-operations.types";

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

@Injectable()
export class ConversationOperationsService {
  constructor(
    private readonly localStore: LocalStoreService,
    private readonly prismaOperations?: PrismaOperationsService,
  ) {}

  listQueue(query: ConversationOperationsQuery = {}) {
    if (!appConfig.useLocalStore) return this.listQueuePrisma(query);
    const normalized = this.normalizeQuery(query);
    const records = this.filteredRecords(normalized);
    const limit = positiveInteger(normalized.limit, 100, 500);
    const offset = nonNegativeInteger(normalized.offset, 0);
    return {
      records: records.slice(offset, offset + limit),
      total: records.length,
      limit,
      offset,
      summary: summarize(records),
    };
  }

  getQueueSummary(query: ConversationOperationsQuery = {}) {
    if (!appConfig.useLocalStore) return this.getQueueSummaryPrisma(query);
    const normalized = this.normalizeQuery(query);
    return summarize(this.filteredRecords(normalized));
  }

  getConversation(identity: ConversationOperationsIdentity) {
    if (!appConfig.useLocalStore) return this.getConversationPrisma(identity);
    const record = this.requireConversationIdentity(identity, "conversation operations query");
    return this.hydrate(record);
  }

  listAudit(identity: ConversationOperationsIdentity, limit = 100) {
    if (!appConfig.useLocalStore) return this.listAuditPrisma(identity, limit);
    const record = this.requireConversationIdentity(identity, "conversation operations audit query");
    return this.localStore
      .listReviewLogs({
        wechatAccountId: record.wechatAccountId,
        conversationId: record.id,
        customerId: record.customerId,
        limit: positiveInteger(limit, 100, 300),
      })
      .filter(
        (log: any) =>
          log.targetType === "conversation" &&
          log.targetId === record.id &&
          log.metadata?.auditType === "conversation_operations",
      );
  }

  updateConversation(id: string, payload: ConversationOperationsUpdatePayload = {}) {
    if (!appConfig.useLocalStore) return this.updateConversationPrisma(id, payload);
    const identity = this.expectedIdentity(id, payload);
    const currentRecord = this.requireConversationIdentity(identity, "conversation operations update");
    const before = this.hydrate(currentRecord);
    const operator = requiredText(payload.operator, "conversation operations update requires operator");
    const patch: Record<string, unknown> = {};

    if (hasOwn(payload, "assignee")) patch.assignee = nullableText(payload.assignee);
    if (hasOwn(payload, "priority")) patch.priority = parsePriority(payload.priority);
    if (hasOwn(payload, "status")) patch.status = parseStatus(payload.status);
    if (hasOwn(payload, "slaDueAt")) patch.slaDueAt = nullableIsoDate(payload.slaDueAt, "slaDueAt");
    if (hasOwn(payload, "firstResponseDueAt")) {
      patch.firstResponseDueAt = nullableIsoDate(payload.firstResponseDueAt, "firstResponseDueAt");
    }

    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        "conversation operations update requires at least one of assignee, priority, status, slaDueAt, firstResponseDueAt",
      );
    }

    const comparableBefore = operationFields(before);
    const comparableAfter = { ...comparableBefore, ...patch };
    const changedFields = Object.keys(patch).filter((key) => comparableBefore[key] !== comparableAfter[key]);
    if (!changedFields.length) {
      return { conversation: before, audit: null, changedFields: [] };
    }

    const result = this.localStore.updateConversationOperations(
      id,
      identity,
      Object.fromEntries(changedFields.map((key) => [key, patch[key]])),
      {
        reviewer: operator,
        note: String(payload.reason || "").trim(),
        decision: "conversation_operations_update",
        beforeStatus: String(before.status),
        afterStatus: String(comparableAfter.status),
        metadata: {
          auditType: "conversation_operations",
          changedFields,
          before: comparableBefore,
          after: comparableAfter,
        },
      },
    );

    return {
      conversation: this.hydrate(result.conversation),
      audit: result.audit,
      changedFields,
    };
  }

  private filteredRecords(query: ConversationOperationsQuery) {
    this.validateListIdentity(query);
    let records = this.localStore.listConversations(query.wechatAccountId).map((record: any) => this.hydrate(record));

    if (query.conversationId) records = records.filter((record: any) => record.id === query.conversationId);
    if (query.customerId) records = records.filter((record: any) => record.customerId === query.customerId);
    if (query.assignee) {
      const requested = query.assignee === "unassigned" ? null : query.assignee;
      records = records.filter((record: any) => record.assignee === requested);
    }
    if (query.priority) records = records.filter((record: any) => record.priority === query.priority);
    if (query.status) records = records.filter((record: any) => record.status === query.status);
    if (query.slaState) records = records.filter((record: any) => record.slaState === query.slaState);
    if (query.overdue !== undefined) {
      const requested = parseBoolean(query.overdue, "overdue");
      records = records.filter((record: any) => record.isOverdue === requested);
    }
    if (query.slaDueAt) records = records.filter((record: any) => record.slaDueAt === query.slaDueAt);
    if (query.firstResponseDueAt) {
      records = records.filter((record: any) => record.firstResponseDueAt === query.firstResponseDueAt);
    }
    if (query.slaDueBefore) {
      records = records.filter((record: any) => Boolean(record.slaDueAt && record.slaDueAt <= query.slaDueBefore!));
    }
    if (query.firstResponseDueBefore) {
      records = records.filter(
        (record: any) => Boolean(record.firstResponseDueAt && record.firstResponseDueAt <= query.firstResponseDueBefore!),
      );
    }

    return records.sort((left: any, right: any) =>
      String(right.lastMessageAt || right.updatedAt || "").localeCompare(String(left.lastMessageAt || left.updatedAt || "")),
    );
  }

  private normalizeQuery(query: ConversationOperationsQuery) {
    const normalized: ConversationOperationsQuery = {
      ...query,
      wechatAccountId: optionalText(query.wechatAccountId),
      conversationId: optionalText(query.conversationId),
      customerId: optionalText(query.customerId),
      assignee: optionalText(query.assignee),
      priority: optionalText(query.priority),
      status: optionalText(query.status),
      slaState: optionalText(query.slaState),
    };
    if (normalized.priority) normalized.priority = parsePriority(normalized.priority);
    if (normalized.status) normalized.status = parseStatus(normalized.status);
    if (normalized.slaState && !CONVERSATION_SLA_STATES.includes(normalized.slaState as ConversationSlaState)) {
      throw new BadRequestException(`invalid slaState: ${normalized.slaState}`);
    }
    for (const key of ["slaDueAt", "firstResponseDueAt", "slaDueBefore", "firstResponseDueBefore"] as const) {
      if (query[key]) normalized[key] = requiredIsoDate(query[key], key);
    }
    return normalized;
  }

  private validateListIdentity(query: ConversationOperationsQuery) {
    const hasConversationScope = Boolean(query.conversationId || query.customerId);
    if (hasConversationScope) {
      this.requireConversationIdentity(
        {
          wechatAccountId: String(query.wechatAccountId || ""),
          conversationId: String(query.conversationId || ""),
          customerId: String(query.customerId || ""),
        },
        "conversation operations queue query",
      );
      return;
    }
    if (
      query.wechatAccountId &&
      !this.localStore.listWechatAccounts().some((account: any) => account.id === query.wechatAccountId)
    ) {
      throw new NotFoundException(`wechat account not found: ${query.wechatAccountId}`);
    }
  }

  private expectedIdentity(id: string, payload: ConversationOperationsUpdatePayload): ConversationOperationsIdentity {
    const identity = {
      wechatAccountId: String(payload.expectedWechatAccountId || "").trim(),
      conversationId: String(payload.expectedConversationId || "").trim(),
      customerId: String(payload.expectedCustomerId || "").trim(),
    };
    if (identity.conversationId && identity.conversationId !== id) {
      throw new BadRequestException("conversation operations identity mismatch: expectedConversationId must match path id");
    }
    return { ...identity, conversationId: identity.conversationId || "" };
  }

  private requireConversationIdentity(identity: ConversationOperationsIdentity, label: string) {
    const normalized = {
      wechatAccountId: String(identity.wechatAccountId || "").trim(),
      conversationId: String(identity.conversationId || "").trim(),
      customerId: String(identity.customerId || "").trim(),
    };
    const missing = Object.entries(normalized).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new BadRequestException(`${label} requires complete identity: ${missing.join(", ")}`);
    const record = this.localStore.listConversations().find((item: any) => item.id === normalized.conversationId);
    if (!record) throw new NotFoundException(`conversation not found: ${normalized.conversationId}`);
    if (record.wechatAccountId !== normalized.wechatAccountId) {
      throw new BadRequestException(`${label} identity mismatch: wechatAccountId`);
    }
    if (record.customerId !== normalized.customerId) {
      throw new BadRequestException(`${label} identity mismatch: customerId`);
    }
    return record;
  }

  private hydrate(record: any) {
    const configurationIssues: string[] = [];
    const assignee = nullableText(record.assignee);
    const priority = CONVERSATION_PRIORITIES.includes(record.priority) ? record.priority : "normal";
    const status = CONVERSATION_STATUSES.includes(record.status) ? record.status : "open";
    if (record.priority && !CONVERSATION_PRIORITIES.includes(record.priority)) configurationIssues.push("invalid_priority");
    if (record.status && !CONVERSATION_STATUSES.includes(record.status)) configurationIssues.push("invalid_status");
    const slaDueAt = storedIsoDate(record.slaDueAt, "invalid_sla_due_at", configurationIssues);
    const firstResponseDueAt = storedIsoDate(
      record.firstResponseDueAt,
      "invalid_first_response_due_at",
      configurationIssues,
    );
    const firstResponseAt = this.firstResponseAt(record);
    const now = Date.now();
    const closed = status === "resolved" || status === "closed";
    const slaOverdue = Boolean(!closed && slaDueAt && new Date(slaDueAt).getTime() < now);
    const firstResponseOverdue = Boolean(
      !closed && !firstResponseAt && firstResponseDueAt && new Date(firstResponseDueAt).getTime() < now,
    );
    const firstResponseBreached = Boolean(
      firstResponseAt && firstResponseDueAt && new Date(firstResponseAt).getTime() > new Date(firstResponseDueAt).getTime(),
    );
    const noSla = !record.slaDueAt && !record.firstResponseDueAt;
    const slaState: ConversationSlaState = configurationIssues.some((issue) => issue.startsWith("invalid_"))
      ? "invalid"
      : noSla
        ? "no_sla"
        : closed
          ? "closed"
          : slaOverdue || firstResponseOverdue
            ? "overdue"
            : "on_track";
    const {
      assignee: _storedAssignee,
      priority: _storedPriority,
      status: _storedStatus,
      slaDueAt: _storedSlaDueAt,
      firstResponseDueAt: _storedFirstResponseDueAt,
      ...baseRecord
    } = record;

    return {
      ...baseRecord,
      assignee,
      assignmentState: assignee ? "assigned" : "unassigned",
      priority,
      status,
      slaDueAt,
      firstResponseDueAt,
      firstResponseAt,
      firstResponseBreached,
      slaOverdue,
      firstResponseOverdue,
      isOverdue: slaOverdue || firstResponseOverdue,
      slaState,
      configurationIssues,
    };
  }

  private firstResponseAt(record: any) {
    if (!appConfig.useLocalStore) return storedIsoDate(record?.firstResponseAt, "", []);
    if (!record?.id || !record?.wechatAccountId || !record?.customerId) return null;
    const timeline = this.localStore.listConversationTimeline({
      wechatAccountId: record.wechatAccountId,
      conversationId: record.id,
      customerId: record.customerId,
      limit: 500,
    });
    const first = timeline
      .filter((item: any) => item.direction === "outbound" && item.status === "sent")
      .sort((left: any, right: any) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))[0];
    return first?.createdAt ? storedIsoDate(first.createdAt, "", []) : null;
  }

  private async listQueuePrisma(query: ConversationOperationsQuery = {}) {
    const normalized = this.normalizeQuery(query);
    const scoped = await this.filteredPrismaRecords(normalized);
    const records = scoped.records;
    const limit = positiveInteger(normalized.limit, 100, 500);
    const offset = nonNegativeInteger(normalized.offset, 0);
    return {
      records: records.slice(offset, offset + limit),
      total: records.length,
      limit,
      offset,
      truncated: scoped.truncated,
      scopeLimit: scoped.scopeLimit,
      totalIsCapped: scoped.truncated,
      summary: { ...summarize(records), partial: scoped.truncated, scopeLimit: scoped.scopeLimit },
    };
  }

  private async getQueueSummaryPrisma(query: ConversationOperationsQuery = {}) {
    const normalized = this.normalizeQuery(query);
    const scoped = await this.filteredPrismaRecords(normalized);
    return { ...summarize(scoped.records), partial: scoped.truncated, scopeLimit: scoped.scopeLimit };
  }

  private async getConversationPrisma(identity: ConversationOperationsIdentity) {
    const normalized = completeIdentity(identity, "conversation operations query");
    const record = await this.requirePrisma().getConversation(normalized);
    return this.hydrate(record);
  }

  private async listAuditPrisma(identity: ConversationOperationsIdentity, limit = 100) {
    const normalized = completeIdentity(identity, "conversation operations audit query");
    return this.requirePrisma().listConversationAudit(normalized, positiveInteger(limit, 100, 300));
  }

  private async updateConversationPrisma(id: string, payload: ConversationOperationsUpdatePayload = {}) {
    const identity = this.expectedIdentity(id, payload);
    const normalized = completeIdentity(identity, "conversation operations update");
    const currentRecord = await this.requirePrisma().getConversation(normalized);
    const before = this.hydrate(currentRecord);
    const operator = requiredText(payload.operator, "conversation operations update requires operator");
    const patch: Record<string, unknown> = {};
    if (hasOwn(payload, "assignee")) patch.assignee = nullableText(payload.assignee);
    if (hasOwn(payload, "priority")) patch.priority = parsePriority(payload.priority);
    if (hasOwn(payload, "status")) patch.status = parseStatus(payload.status);
    if (hasOwn(payload, "slaDueAt")) patch.slaDueAt = nullableIsoDate(payload.slaDueAt, "slaDueAt");
    if (hasOwn(payload, "firstResponseDueAt")) patch.firstResponseDueAt = nullableIsoDate(payload.firstResponseDueAt, "firstResponseDueAt");
    if (!Object.keys(patch).length) throw new BadRequestException("conversation operations update requires at least one of assignee, priority, status, slaDueAt, firstResponseDueAt");
    const comparableBefore = operationFields(before);
    const comparableAfter = { ...comparableBefore, ...patch };
    const changedFields = Object.keys(patch).filter((key) => comparableBefore[key] !== comparableAfter[key]);
    if (!changedFields.length) return { conversation: before, audit: null, changedFields: [] };
    const result = await this.requirePrisma().updateConversationOperations(
      id,
      normalized,
      Object.fromEntries(changedFields.map((key) => [key, patch[key]])),
      {
        reviewer: operator,
        note: String(payload.reason || "").trim(),
        decision: "conversation_operations_update",
        beforeStatus: String(before.status),
        afterStatus: String(comparableAfter.status),
        metadata: { auditType: "conversation_operations", changedFields, before: comparableBefore, after: comparableAfter },
      },
    );
    return { conversation: this.hydrate(result.conversation), audit: result.audit, changedFields };
  }

  private async filteredPrismaRecords(query: ConversationOperationsQuery) {
    await this.validatePrismaListIdentity(query);
    const scoped = await this.requirePrisma().listConversations(query.wechatAccountId);
    let records = scoped.records.map((record: any) => this.hydrate(record));
    if (query.conversationId) records = records.filter((record: any) => record.id === query.conversationId);
    if (query.customerId) records = records.filter((record: any) => record.customerId === query.customerId);
    if (query.assignee) { const requested = query.assignee === "unassigned" ? null : query.assignee; records = records.filter((record: any) => record.assignee === requested); }
    if (query.priority) records = records.filter((record: any) => record.priority === query.priority);
    if (query.status) records = records.filter((record: any) => record.status === query.status);
    if (query.slaState) records = records.filter((record: any) => record.slaState === query.slaState);
    if (query.overdue !== undefined) { const requested = parseBoolean(query.overdue, "overdue"); records = records.filter((record: any) => record.isOverdue === requested); }
    if (query.slaDueAt) records = records.filter((record: any) => record.slaDueAt === query.slaDueAt);
    if (query.firstResponseDueAt) records = records.filter((record: any) => record.firstResponseDueAt === query.firstResponseDueAt);
    if (query.slaDueBefore) records = records.filter((record: any) => Boolean(record.slaDueAt && record.slaDueAt <= query.slaDueBefore!));
    if (query.firstResponseDueBefore) records = records.filter((record: any) => Boolean(record.firstResponseDueAt && record.firstResponseDueAt <= query.firstResponseDueBefore!));
    return {
      records: records.sort((left: any, right: any) => String(right.lastMessageAt || right.updatedAt || "").localeCompare(String(left.lastMessageAt || left.updatedAt || ""))),
      truncated: scoped.truncated,
      scopeLimit: scoped.scopeLimit,
    };
  }

  private async validatePrismaListIdentity(query: ConversationOperationsQuery) {
    if (query.conversationId || query.customerId) {
      await this.requirePrisma().getConversation(completeIdentity({
        wechatAccountId: String(query.wechatAccountId || ""),
        conversationId: String(query.conversationId || ""),
        customerId: String(query.customerId || ""),
      }, "conversation operations queue query"));
      return;
    }
    if (query.wechatAccountId && !(await this.requirePrisma().wechatAccountExists(query.wechatAccountId))) {
      throw new NotFoundException(`wechat account not found: ${query.wechatAccountId}`);
    }
  }

  private requirePrisma() {
    if (!this.prismaOperations) throw new Error("PrismaOperationsService is required when USE_LOCAL_STORE=false");
    return this.prismaOperations;
  }
}

function completeIdentity(identity: ConversationOperationsIdentity, label: string) {
  const normalized = {
    wechatAccountId: String(identity.wechatAccountId || "").trim(),
    conversationId: String(identity.conversationId || "").trim(),
    customerId: String(identity.customerId || "").trim(),
  };
  const missing = Object.entries(normalized).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new BadRequestException(`${label} requires complete identity: ${missing.join(", ")}`);
  return normalized;
}

function operationFields(record: any): Record<string, unknown> {
  return {
    assignee: record.assignee ?? null,
    priority: record.priority,
    status: record.status,
    slaDueAt: record.slaDueAt ?? null,
    firstResponseDueAt: record.firstResponseDueAt ?? null,
  };
}

function summarize(records: any[]) {
  const priorities = Object.fromEntries(CONVERSATION_PRIORITIES.map((priority) => [priority, 0])) as Record<string, number>;
  const statuses = Object.fromEntries(CONVERSATION_STATUSES.map((status) => [status, 0])) as Record<string, number>;
  for (const record of records) {
    priorities[record.priority] = Number(priorities[record.priority] || 0) + 1;
    statuses[record.status] = Number(statuses[record.status] || 0) + 1;
  }
  return {
    total: records.length,
    assigned: records.filter((record) => record.assignmentState === "assigned").length,
    unassigned: records.filter((record) => record.assignmentState === "unassigned").length,
    overdue: records.filter((record) => record.isOverdue).length,
    needsAttention: records.filter(
      (record) => record.isOverdue || record.assignmentState === "unassigned",
    ).length,
    slaOverdue: records.filter((record) => record.slaOverdue).length,
    firstResponseOverdue: records.filter((record) => record.firstResponseOverdue).length,
    firstResponseBreached: records.filter((record) => record.firstResponseBreached).length,
    noSla: records.filter((record) => record.slaState === "no_sla").length,
    invalidConfiguration: records.filter((record) => record.slaState === "invalid").length,
    priorities,
    statuses,
  };
}

function optionalText(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function nullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function requiredText(value: unknown, message: string) {
  const text = String(value || "").trim();
  if (!text) throw new BadRequestException(message);
  return text;
}

function parsePriority(value: unknown): ConversationPriority {
  const normalized = String(value || "").trim() as ConversationPriority;
  if (!CONVERSATION_PRIORITIES.includes(normalized)) throw new BadRequestException(`invalid priority: ${normalized || "-"}`);
  return normalized;
}

function parseStatus(value: unknown): ConversationStatus {
  const normalized = String(value || "").trim() as ConversationStatus;
  if (!CONVERSATION_STATUSES.includes(normalized)) throw new BadRequestException(`invalid status: ${normalized || "-"}`);
  return normalized;
}

function nullableIsoDate(value: unknown, label: string) {
  if (value === null || value === "") return null;
  return requiredIsoDate(value, label);
}

function requiredIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${label} must be an ISO date or null`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${label} must be a valid ISO date`);
  return parsed.toISOString();
}

function storedIsoDate(value: unknown, issue: string, issues: string[]) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    if (issue) issues.push(issue);
    return null;
  }
  return parsed.toISOString();
}

function parseBoolean(value: unknown, label: string) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new BadRequestException(`${label} must be true or false`);
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException("limit must be a positive integer");
  return Math.min(parsed, max);
}

function nonNegativeInteger(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException("offset must be a non-negative integer");
  return parsed;
}
