"use client";

import type { Agent } from "../../lib/api";
import styles from "../governance-pages.module.css";
import type { KnowledgeEntryRecord, KnowledgeReviewDraft, KnowledgeReviewStatus } from "./training-knowledge-page-model";

export const ALL_SOURCES = "all";
export const ALL_AGENTS = "all";
export const ALL_TAGS = "all";
export const ALL_STATUSES = "all";
export const REVIEW_STATUSES: KnowledgeReviewStatus[] = ["ready", "review", "rejected"];

type ActionContracts = {
  agent: string;
  title: string;
  content: string;
  tags: string;
  quality: string;
};

export function KnowledgeList({
  entries,
  filteredEntries,
  agents,
  agentNameById,
  loaded,
  expandedId,
  expandLabel,
  editDrafts,
  reviewBusy,
  operator,
  reviewNote,
  actionContracts,
  shouldBlockReady,
  ReviewEditor,
  onExpandedIdChange,
  onDraftChange,
  onRequestReview,
}: {
  entries: KnowledgeEntryRecord[];
  filteredEntries: KnowledgeEntryRecord[];
  agents: Agent[];
  agentNameById: Map<string, string>;
  loaded: boolean;
  expandedId: string;
  expandLabel: string;
  editDrafts: Record<string, KnowledgeReviewDraft>;
  reviewBusy: boolean;
  operator?: string;
  reviewNote: string;
  actionContracts: ActionContracts;
  shouldBlockReady: (readyBlockers: string[]) => boolean;
  ReviewEditor: typeof KnowledgeReviewEditor;
  onExpandedIdChange: (id: string) => void;
  onDraftChange: (entry: KnowledgeEntryRecord, patch: Partial<KnowledgeReviewDraft>) => void;
  onRequestReview: (entry: KnowledgeEntryRecord, status: KnowledgeReviewStatus) => void;
}) {
  return (
    <section className={styles.panel} aria-labelledby="training-knowledge-list-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="training-knowledge-list-title">知识条目</h2>
          <p>{loaded ? `${filteredEntries.length} / ${entries.length} 条` : "尚未确认读取结果"}</p>
        </div>
      </header>
      <div className={styles.panelBody}>
        {filteredEntries.length ? (
          <div className={styles.recordList}>
            {filteredEntries.map((entry) => {
              const expanded = expandedId === entry.id;
              const draft = editDrafts[entry.id] || knowledgeDraftFromEntry(entry);
              const readyBlockers = knowledgeReadyBlockers(draft, "ready");
              return (
                <article className={styles.record} key={entry.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{entry.title || "未命名知识"}</h3><p>{normalizeTags(entry.tags).join("、") || "未标注标签"}</p></div>
                    <div className={styles.statusLine}>
                      <span className={`${styles.badge} ${knowledgeTone(entry)}`}>{knowledgeSourceLabel(entry.sourceType)}</span>
                      <span className={`${styles.badge} ${knowledgeStatusTone(entry)}`}>{knowledgeStatusLabel(entry.status)}</span>
                    </div>
                  </div>
                  <div className={styles.recordMeta}>
                    <span>{agentNameById.get(String(entry.agentId || "")) || entry.agentKey || entry.agentId || "通用 Agent"}</span>
                    <span>质量 {formatScore(entry.qualityScore)}</span>
                    <span>状态 {knowledgeStatusLabel(entry.status)}</span>
                    <span>{entry.reviewedAt ? `复核 ${entry.reviewedAt}` : entry.reviewNote || "尚未复核"}</span>
                    <span>{entry.updatedAt || entry.createdAt || "时间未记录"}</span>
                  </div>
                  <p className={styles.helpText}>{expanded ? entry.content || "暂无正文" : previewText(entry.content)}</p>
                  {expanded ? (
                    <ReviewEditor
                      entry={entry}
                      agents={agents}
                      draft={draft}
                      readyBlockers={readyBlockers}
                      actionContracts={actionContracts}
                      onChange={(patch) => onDraftChange(entry, patch)}
                    />
                  ) : null}
                  <div className={styles.buttonRow}>
                    <button type="button" className={styles.button} data-action-id={`training-knowledge-toggle-${entry.id}`} onClick={() => onExpandedIdChange(expanded ? "" : entry.id)}>
                      {expanded ? "收起正文" : expandLabel}
                    </button>
                    <button type="button" className={styles.primaryButton} data-action-id={`training.knowledge.ready.${entry.id}`} onClick={() => onRequestReview(entry, "ready")} disabled={reviewBusy || !operator || !reviewNote.trim() || shouldBlockReady(readyBlockers) || normalizeKnowledgeStatus(entry.status) === "ready"}>标记可用</button>
                    <button type="button" className={styles.button} data-action-id={`training.knowledge.review.${entry.id}`} onClick={() => onRequestReview(entry, "review")} disabled={reviewBusy || !operator || !reviewNote.trim() || normalizeKnowledgeStatus(entry.status) === "review"}>保持复核</button>
                    <button type="button" className={styles.dangerButton} data-action-id={`training.knowledge.reject.${entry.id}`} onClick={() => onRequestReview(entry, "rejected")} disabled={reviewBusy || !operator || !reviewNote.trim() || normalizeKnowledgeStatus(entry.status) === "rejected"}>停用知识</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>{loaded ? "当前筛选下没有知识条目，请调整 Agent、来源、标签或搜索词。" : "知识库尚未完成读取。"}</div>
        )}
      </div>
    </section>
  );
}

export function KnowledgeReviewEditor({
  entry,
  agents,
  draft,
  readyBlockers,
  actionContracts,
  onChange,
}: {
  entry: KnowledgeEntryRecord;
  agents: Agent[];
  draft: KnowledgeReviewDraft;
  readyBlockers: string[];
  actionContracts: ActionContracts;
  onChange: (patch: Partial<KnowledgeReviewDraft>) => void;
}) {
  const selectedAgentExists = !draft.agentId || agents.some((agent) => agent.id === draft.agentId);
  return (
    <div className={styles.recordGrid} aria-label={`knowledge review editor ${entry.title || entry.id}`}>
      <label className={styles.field}><span>所属 Agent</span><select className={styles.select} value={draft.agentId} data-action-id={`${actionContracts.agent}.${entry.id}`} onChange={(event) => onChange({ agentId: event.target.value })}><option value="">选择 Agent</option>{!selectedAgentExists ? <option value={draft.agentId}>{draft.agentId}</option> : null}{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name || agent.key || agent.id}</option>)}</select></label>
      <label className={styles.field}><span>标题</span><input className={styles.input} value={draft.title} data-action-id={`${actionContracts.title}.${entry.id}`} onChange={(event) => onChange({ title: event.target.value })} /></label>
      <label className={styles.field}><span>标签</span><input className={styles.input} value={draft.tags} data-action-id={`${actionContracts.tags}.${entry.id}`} onChange={(event) => onChange({ tags: event.target.value })} placeholder="发货、售后、报价" /></label>
      <label className={styles.field}><span>质量分</span><input className={styles.input} type="number" min="0" max="100" value={draft.qualityScore} data-action-id={`${actionContracts.quality}.${entry.id}`} onChange={(event) => onChange({ qualityScore: event.target.value })} /></label>
      <label className={styles.field}><span>正文</span><textarea className={styles.textarea} value={draft.content} data-action-id={`${actionContracts.content}.${entry.id}`} onChange={(event) => onChange({ content: event.target.value })} /></label>
      <p className={styles.helpText}>{readyBlockers.length ? `可用阻断项：${readyBlockers.join("、")}` : "可用检查已通过，提交复核后会进入回复检索。"}</p>
    </div>
  );
}

export function filterKnowledgeEntries(entries: KnowledgeEntryRecord[], filters: { query: string; agentFilter: string; sourceFilter: string; tagFilter: string; statusFilter: string }) {
  const query = filters.query.trim().toLowerCase();
  return entries
    .filter((entry) => filters.agentFilter === ALL_AGENTS || entry.agentId === filters.agentFilter || entry.agentKey === filters.agentFilter)
    .filter((entry) => filters.sourceFilter === ALL_SOURCES || (entry.sourceType || "manual_knowledge_import") === filters.sourceFilter)
    .filter((entry) => filters.tagFilter === ALL_TAGS || normalizeTags(entry.tags).includes(filters.tagFilter))
    .filter((entry) => filters.statusFilter === ALL_STATUSES || normalizeKnowledgeStatus(entry.status) === filters.statusFilter)
    .filter((entry) => !query || [entry.title, entry.content, entry.agentKey, entry.sourceType, ...normalizeTags(entry.tags)].join("\n").toLowerCase().includes(query));
}

export function summarizeKnowledgeEntries(entries: KnowledgeEntryRecord[], visibleEntries: KnowledgeEntryRecord[]) {
  return {
    total: entries.length,
    visible: visibleEntries.length,
    custom: entries.filter((entry) => entry.sourceType !== "starter_knowledge").length,
    starter: entries.filter((entry) => entry.sourceType === "starter_knowledge").length,
    ready: entries.filter((entry) => normalizeKnowledgeStatus(entry.status) === "ready").length,
    review: entries.filter((entry) => normalizeKnowledgeStatus(entry.status) === "review").length,
    rejected: entries.filter((entry) => normalizeKnowledgeStatus(entry.status) === "rejected").length,
  };
}

export function knowledgeDraftFromEntry(entry: KnowledgeEntryRecord): KnowledgeReviewDraft {
  return {
    agentId: String(entry.agentId || ""),
    title: String(entry.title || ""),
    content: String(entry.content || ""),
    tags: normalizeTags(entry.tags).join(", "),
    qualityScore: Number.isFinite(Number(entry.qualityScore)) ? String(Number(entry.qualityScore)) : "70",
  };
}

export function knowledgeReviewPayloadFromDraft(draft: KnowledgeReviewDraft) {
  const qualityScore = Number(draft.qualityScore);
  return {
    agentId: draft.agentId.trim() || undefined,
    title: draft.title.trim(),
    content: draft.content.trim(),
    tags: splitDraftTags(draft.tags),
    ...(Number.isFinite(qualityScore) ? { qualityScore } : {}),
  };
}

export function knowledgeReadyBlockers(draft: KnowledgeReviewDraft, status: KnowledgeReviewStatus) {
  if (status !== "ready") return [];
  const blockers: string[] = [];
  if (!draft.agentId.trim()) blockers.push("缺少 Agent");
  if (!draft.title.trim()) blockers.push("缺少标题");
  if (draft.content.trim().length < 20) blockers.push("正文少于 20 字");
  const score = Number(draft.qualityScore);
  if (!Number.isFinite(score) || score < 60) blockers.push("质量分低于 60");
  if (!splitDraftTags(draft.tags).length) blockers.push("缺少标签");
  return blockers;
}

function splitDraftTags(value: string) {
  return String(value || "").split(/[,;|\u3001\uff0c\uff1b]/).map((tag) => tag.trim()).filter(Boolean);
}

export function normalizeTags(tags?: string[]) {
  return (Array.isArray(tags) ? tags : []).map((tag) => String(tag || "").trim()).filter(Boolean);
}

export function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function previewText(value?: string) {
  const text = String(value || "").trim();
  return text.length > 140 ? `${text.slice(0, 140)}...` : text || "暂无正文";
}

function formatScore(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(0) : "未评分";
}

export function knowledgeSourceLabel(sourceType?: string) {
  if (sourceType === "starter_knowledge") return "内置 SOP";
  if (sourceType === "chat_import") return "聊天导入";
  if (sourceType === "route_correction") return "路由纠错";
  if (sourceType === "manual_knowledge_import") return "手工导入";
  return "自定义知识";
}

function knowledgeTone(entry: KnowledgeEntryRecord) {
  if (normalizeKnowledgeStatus(entry.status) === "rejected") return styles.toneError;
  return Number(entry.qualityScore || 0) < 80 ? styles.toneWarning : styles.toneOk;
}

function normalizeKnowledgeStatus(status?: string): KnowledgeReviewStatus {
  return status === "ready" || status === "rejected" ? status : "review";
}

export function knowledgeStatusLabel(status?: string) {
  const normalized = normalizeKnowledgeStatus(status);
  if (normalized === "ready") return "可用";
  if (normalized === "rejected") return "已停用";
  return "复核中";
}

function knowledgeStatusTone(entryOrStatus?: KnowledgeEntryRecord | string) {
  const status = typeof entryOrStatus === "string" ? entryOrStatus : entryOrStatus?.status;
  const normalized = normalizeKnowledgeStatus(status);
  if (normalized === "ready") return styles.toneOk;
  if (normalized === "rejected") return styles.toneError;
  return styles.toneWarning;
}
