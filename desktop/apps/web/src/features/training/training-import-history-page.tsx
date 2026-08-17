"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getChatImports,
  getReviewCenter,
  getTrainingKnowledgeEntries,
  type ChatImport,
  type IdentityFilters,
  type ReviewLog,
} from "../../lib/api";
import styles from "../governance-pages.module.css";
import { TrainingIdentityScopeNotice, trainingHref } from "./training-identity-navigation";
import {
  resolveTrainingHistoryRead,
  scopedTrainingHistoryKnown,
  scopedTrainingHistoryValue,
  unknownTrainingHistoryRead,
} from "./training-import-history-read-state";

const EMPTY_IMPORTS: ChatImport[] = [];
const EMPTY_KNOWLEDGE_ENTRIES: KnowledgeImportHistoryEntry[] = [];
const EMPTY_REVIEW_LOGS: ReviewLog[] = [];

export function TrainingImportHistoryPage({ identityFilters }: { identityFilters?: IdentityFilters }) {
  const [importsRead, setImportsRead] = useState(() => unknownTrainingHistoryRead(EMPTY_IMPORTS));
  const [knowledgeRead, setKnowledgeRead] = useState(() => unknownTrainingHistoryRead(EMPTY_KNOWLEDGE_ENTRIES));
  const [reviewLogsRead, setReviewLogsRead] = useState(() => unknownTrainingHistoryRead(EMPTY_REVIEW_LOGS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const scopeKey = useMemo(() => JSON.stringify(stableIdentityFilters), [stableIdentityFilters]);
  const imports = scopedTrainingHistoryValue(importsRead, scopeKey, EMPTY_IMPORTS);
  const knowledgeEntries = scopedTrainingHistoryValue(knowledgeRead, scopeKey, EMPTY_KNOWLEDGE_ENTRIES);
  const knowledgeImportLogs = scopedTrainingHistoryValue(reviewLogsRead, scopeKey, EMPTY_REVIEW_LOGS);
  const importsKnown = scopedTrainingHistoryKnown(importsRead, scopeKey);
  const knowledgeHistoryKnown = scopedTrainingHistoryKnown(knowledgeRead, scopeKey)
    && scopedTrainingHistoryKnown(reviewLogsRead, scopeKey);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    const results = await Promise.allSettled([
      getChatImports(stableIdentityFilters),
      getTrainingKnowledgeEntries(stableIdentityFilters),
      getReviewCenter(stableIdentityFilters),
    ] as const);
    if (sequence !== refreshSequence.current) return;
    const importsResult = results[0];
    const knowledgeResult = results[1].status === "fulfilled"
      ? { status: "fulfilled" as const, value: Array.isArray(results[1].value) ? results[1].value : EMPTY_KNOWLEDGE_ENTRIES }
      : results[1];
    const reviewResult = results[2].status === "fulfilled"
      ? {
          status: "fulfilled" as const,
          value: Array.isArray(results[2].value?.logs)
            ? results[2].value.logs.filter((log) => log.targetType === "knowledge_import")
            : EMPTY_REVIEW_LOGS,
        }
      : results[2];
    setImportsRead((current) => resolveTrainingHistoryRead(current, scopeKey, importsResult, EMPTY_IMPORTS));
    setKnowledgeRead((current) => resolveTrainingHistoryRead(current, scopeKey, knowledgeResult, EMPTY_KNOWLEDGE_ENTRIES));
    setReviewLogsRead((current) => resolveTrainingHistoryRead(current, scopeKey, reviewResult, EMPTY_REVIEW_LOGS));
    const failures = [
      importsResult.status === "rejected" ? "聊天记录历史读取失败；同一身份范围的上次成功内容会保留" : "",
      knowledgeResult.status === "rejected" ? "知识导入批次读取失败；同一身份范围的上次成功内容会保留" : "",
      reviewResult.status === "rejected" ? "知识导入审核日志读取失败；失败批次状态当前未知" : "",
    ].filter(Boolean);
    setError(failures.join("；"));
    setBusy(false);
  }, [scopeKey, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  const knowledgeHistory = useMemo(
    () => buildKnowledgeImportHistory(knowledgeEntries, knowledgeImportLogs),
    [knowledgeEntries, knowledgeImportLogs],
  );

  return (
    <section className={styles.page} aria-labelledby="training-import-history-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="training-import-history-title">导入历史</h1>
          <p className={styles.description}>只查看服务端已有导入、解析数量和警告；新建导入在独立页面完成。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href={trainingHref("/training/import", stableIdentityFilters)}>新建导入</Link>
          <button type="button" className={styles.button} data-action-id="training-import-history-refresh" onClick={() => void refresh()} disabled={busy}>刷新记录</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      <TrainingIdentityScopeNotice identityFilters={stableIdentityFilters} />

      {imports.length ? (
        <div className={styles.recordList} aria-label="聊天记录导入历史">
          {imports.map((item) => (
            <article className={styles.record} key={item.id}>
              <div className={styles.recordHeader}>
                <div><h2>{item.name || item.source || item.id}</h2><p>{item.source || "未标注来源"} · {item.channel || "未标注渠道"}</p></div>
                <span className={`${styles.badge} ${item.warnings.length ? styles.toneWarning : styles.toneOk}`}>{item.warnings.length ? `${item.warnings.length} 条警告` : "解析完成"}</span>
              </div>
              <div className={styles.recordMeta}><span>{item.messageCount} 条消息</span><span>{item.pairCount} 组对话</span><span>{formatDateTime(item.createdAt)}</span></div>
              {item.sceneSummary ? <div className={styles.recordMeta}><span>可用 {item.sceneSummary.readyCount ?? 0}</span><span>待复核 {item.sceneSummary.reviewCount ?? 0}</span><span>场景不确定 {item.sceneSummary.sceneUncertainCount}</span></div> : null}
              {item.warnings.length ? <ul className={styles.helpText}>{item.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            </article>
          ))}
        </div>
      ) : <div className={styles.empty}>{importsKnown
        ? "读取成功，当前没有聊天记录导入历史。"
        : "导入历史尚未成功读取，当前状态未确认。"}</div>}

      <section className={styles.panel} aria-labelledby="training-knowledge-import-history-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="training-knowledge-import-history-title">知识导入批次</h2>
            <p>按资料来源汇总手工知识导入，显示待复核、可用和停用数量；失败或内容不完整时从这里返回导入页重新提交修正版。</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          {knowledgeHistory.length ? (
            <div className={styles.recordList} aria-label="知识导入批次历史">
              {knowledgeHistory.map((group) => (
                <article className={styles.record} key={group.source}>
                  <div className={styles.recordHeader}>
                    <div>
                      <h3>{group.source}</h3>
                      <p>{group.sampleTitles.length ? group.sampleTitles.join("、") : "暂无可预览标题"}</p>
                    </div>
                    <span className={`${styles.badge} ${group.needsAction ? styles.toneWarning : styles.toneOk}`}>
                      {group.needsAction ? "需要复核或重试" : "可用于回复"}
                    </span>
                  </div>
                  <div className={styles.recordMeta}>
                    <span>总计 {group.total}</span>
                    <span>可用 {group.ready}</span>
                    <span>待复核 {group.review}</span>
                    <span>停用 {group.rejected}</span>
                    <span>失败 {group.failed}</span>
                    <span>{group.latestAt ? formatDateTime(group.latestAt) : "未记录时间"}</span>
                  </div>
                  <div className={styles.buttonRow}>
                    <Link className={styles.button} href={trainingHref("/training/knowledge", stableIdentityFilters)}>进入知识复核</Link>
                    <Link
                      className={styles.button}
                      href={trainingHref("/training/import", stableIdentityFilters)}
                      data-action-id={`training-knowledge-import-retry-${safeActionId(group.source)}`}
                    >
                      重新导入修正版
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>{knowledgeHistoryKnown
            ? "读取成功，当前没有知识导入批次。"
            : "知识导入批次尚未成功读取，当前状态未确认。"}</div>}
        </div>
      </section>
    </section>
  );
}

export type KnowledgeImportHistoryEntry = {
  id: string;
  sourceType?: string;
  sourceId?: string | null;
  title?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  reviewedAt?: string | null;
};

export type KnowledgeImportHistoryGroup = {
  source: string;
  total: number;
  ready: number;
  review: number;
  rejected: number;
  failed: number;
  latestAt: string;
  sampleTitles: string[];
  needsAction: boolean;
};

export function buildKnowledgeImportHistory(entries: KnowledgeImportHistoryEntry[], logs: ReviewLog[] = []): KnowledgeImportHistoryGroup[] {
  const groups = new Map<string, KnowledgeImportHistoryGroup>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry.sourceType !== "manual_knowledge_import") continue;
    const source = String(entry.sourceId || "manual_knowledge_import").trim() || "manual_knowledge_import";
    const status = normalizeKnowledgeHistoryStatus(entry.status);
    const current = knowledgeHistoryGroup(groups, source);
    current.total += 1;
    current[status] += 1;
    current.needsAction = current.review > 0 || current.rejected > 0 || current.failed > 0;
    const entryTime = latestKnowledgeEntryTime(entry);
    if (entryTime && (!current.latestAt || entryTime > current.latestAt)) current.latestAt = entryTime;
    const title = String(entry.title || "").trim();
    if (title && current.sampleTitles.length < 3 && !current.sampleTitles.includes(title)) current.sampleTitles.push(title);
    groups.set(source, current);
  }
  for (const log of Array.isArray(logs) ? logs : []) {
    if (log.targetType !== "knowledge_import") continue;
    const metadata = log.metadata || {};
    const source = String(metadata.source || log.targetId || "manual_knowledge_import").trim() || "manual_knowledge_import";
    const current = knowledgeHistoryGroup(groups, source);
    const failed = String(log.afterStatus || "") === "failed" || String(log.decision || "").includes("failed");
    if (failed) current.failed += 1;
    current.needsAction = current.review > 0 || current.rejected > 0 || current.failed > 0;
    const createdAt = String(log.createdAt || "").trim();
    if (createdAt && (!current.latestAt || createdAt > current.latestAt)) current.latestAt = createdAt;
    const failure = metadata.failure && typeof metadata.failure === "object" ? metadata.failure as Record<string, unknown> : null;
    const errors = Array.isArray(metadata.skipped) ? metadata.skipped : Array.isArray(failure?.errors) ? failure.errors : [];
    const firstError = errors.map((item) => typeof item === "string" ? item : String((item as Record<string, unknown>)?.message || "")).find(Boolean);
    if (firstError && current.sampleTitles.length < 3 && !current.sampleTitles.includes(firstError)) current.sampleTitles.push(firstError);
    groups.set(source, current);
  }
  return [...groups.values()].sort((left, right) =>
    String(right.latestAt || "").localeCompare(String(left.latestAt || "")) || left.source.localeCompare(right.source, "zh-CN"),
  );
}

function knowledgeHistoryGroup(groups: Map<string, KnowledgeImportHistoryGroup>, source: string) {
  return groups.get(source) || {
      source,
      total: 0,
      ready: 0,
      review: 0,
      rejected: 0,
      failed: 0,
      latestAt: "",
      sampleTitles: [],
      needsAction: false,
    };
}

function normalizeKnowledgeHistoryStatus(status?: string): "ready" | "review" | "rejected" {
  if (status === "ready" || status === "rejected") return status;
  return "review";
}

function latestKnowledgeEntryTime(entry: KnowledgeImportHistoryEntry) {
  return [entry.updatedAt, entry.reviewedAt || "", entry.createdAt]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function safeActionId(value: string) {
  return String(value || "knowledge-import").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "knowledge-import";
}
