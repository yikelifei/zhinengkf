"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  identityExpectation,
  importKnowledgeText,
  previewTrainingRag,
  reviewTrainingKnowledgeEntry,
  type Agent,
  type IdentityFilters,
  type TrainingRagPreview,
} from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import { useTrustedOperator } from "../governance/trusted-operator";
import { TrainingIdentityScopeNotice, trainingHref } from "./training-identity-navigation";
import { EMPTY_KNOWLEDGE_CREATE_DRAFT, TRAINING_KNOWLEDGE_EDIT_ACTION_CONTRACTS, shouldBlockReady, type KnowledgeCreateDraft, type KnowledgeEntryRecord, type KnowledgeReviewDraft, type KnowledgeReviewStatus, type TrainingKnowledgePageProps } from "./training-knowledge-page-model";
import {
  ALL_AGENTS,
  ALL_SOURCES,
  ALL_STATUSES,
  ALL_TAGS,
  KnowledgeList,
  KnowledgeReviewEditor,
  REVIEW_STATUSES,
  filterKnowledgeEntries,
  knowledgeDraftFromEntry,
  knowledgeReadyBlockers,
  knowledgeReviewPayloadFromDraft,
  knowledgeSourceLabel,
  knowledgeStatusLabel,
  normalizeTags,
  summarizeKnowledgeEntries,
  unique,
} from "./training-knowledge-list";
import { useTrainingKnowledgeRead } from "./use-training-knowledge-read";
import { TrainingKnowledgeCreatePanel, TrainingKnowledgeRagPanel } from "./training-knowledge-workspace-panels";
export function TrainingKnowledgePage({ identityFilters }: TrainingKnowledgePageProps) {
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [sourceFilter, setSourceFilter] = useState(ALL_SOURCES);
  const [tagFilter, setTagFilter] = useState(ALL_TAGS);
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [expandedId, setExpandedId] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [editDrafts, setEditDrafts] = useState<Record<string, KnowledgeReviewDraft>>({});
  const [notice, setNotice] = useState("");
  const [pendingReview, setPendingReview] = useState<{ entry: KnowledgeEntryRecord; status: KnowledgeReviewStatus; draft: KnowledgeReviewDraft } | null>(null);
  const [createDraft, setCreateDraft] = useState<KnowledgeCreateDraft>(EMPTY_KNOWLEDGE_CREATE_DRAFT);
  const [createBusy, setCreateBusy] = useState(false);
  const [createConfirming, setCreateConfirming] = useState(false);
  const [ragQuery, setRagQuery] = useState("好贵，我再看看吧");
  const [ragBusy, setRagBusy] = useState(false);
  const [ragError, setRagError] = useState("");
  const [ragResult, setRagResult] = useState<TrainingRagPreview | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const createOperationRef = useRef<PendingClientOperation | null>(null);
  const trustedOperator = useTrustedOperator();
  const operator = trustedOperator.reviewer;
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const {
    agents,
    agentsReadState,
    busy,
    entries,
    entriesReadState,
    error: readError,
    invalidate,
    refresh,
    scopeKey,
  } = useTrainingKnowledgeRead(stableIdentityFilters);
  const loaded = entriesReadState !== "unknown";

  useEffect(() => {
    void refresh();
    return invalidate;
  }, [invalidate, refresh]);

  useEffect(() => {
    setPendingReview(null);
    setCreateConfirming(false);
    setCreateDraft(EMPTY_KNOWLEDGE_CREATE_DRAFT);
    setReviewNote("");
    setEditDrafts({});
    setExpandedId("");
    setRagResult(null);
  }, [scopeKey]);

  useEffect(() => {
    if (stableIdentityFilters.agentId) setAgentFilter(stableIdentityFilters.agentId);
  }, [stableIdentityFilters.agentId]);

  const updateEditDraft = (entry: KnowledgeEntryRecord, patch: Partial<KnowledgeReviewDraft>) => {
    setEditDrafts((current) => {
      const draft = current[entry.id] || knowledgeDraftFromEntry(entry);
      return { ...current, [entry.id]: { ...draft, ...patch } };
    });
  };

  const requestReview = (entry: KnowledgeEntryRecord, status: KnowledgeReviewStatus) => {
    setError("");
    setNotice("");
    if (entriesReadState !== "ready") {
      setError("当前身份范围的知识条目未完成可信读取，不能提交复核。");
      return;
    }
    const draft = editDrafts[entry.id] || knowledgeDraftFromEntry(entry);
    if (!operator || !reviewNote.trim()) {
      setError("可信复核人未绑定或复核说明为空，操作未进入确认步骤。");
      return;
    }
    const blockers = knowledgeReadyBlockers(draft, status);
    if (blockers.length) {
      setError(`知识条目不能标记可用：${blockers.join("、")}`);
      return;
    }
    setPendingReview({ entry, status, draft });
  };

  const confirmReview = useCallback(async () => {
    if (!pendingReview) return;
    if (entriesReadState !== "ready" || !entries.some((entry) => entry.id === pendingReview.entry.id)) {
      setError("确认前知识条目读取状态或列表已变化，已阻止提交；请刷新后重试。");
      setPendingReview(null);
      return;
    }
    setReviewBusy(true);
    setError("");
    try {
      const requestPayload = {
        status: pendingReview.status,
        reviewer: operator,
        note: reviewNote.trim(),
        ...knowledgeReviewPayloadFromDraft(pendingReview.draft),
        ...identityExpectation(pendingReview.entry),
      };
      const operation = reserveClientOperation("review-action", { id: pendingReview.entry.id, ...requestPayload }, pendingOperationRef.current);
      pendingOperationRef.current = operation;
      await reviewTrainingKnowledgeEntry(pendingReview.entry.id, { ...requestPayload, operationKey: operation.key });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setNotice(`已提交“${knowledgeStatusLabel(pendingReview.status)}”复核结果。`);
      setPendingReview(null);
      setReviewNote("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "知识复核失败，服务端未确认结果。");
    } finally {
      setReviewBusy(false);
    }
  }, [entries, entriesReadState, operator, pendingReview, refresh, reviewNote]);

  const requestCreateKnowledge = () => {
    setError("");
    setNotice("");
    if (agentsReadState !== "ready") {
      setError("Agent 目录尚未完成可信读取，不能新增知识。");
      return;
    }
    const blockers = knowledgeCreateBlockers(createDraft);
    if (blockers.length) {
      setError(`新增知识尚未完成：${blockers.join("、")}`);
      return;
    }
    setCreateConfirming(true);
  };

  const confirmCreateKnowledge = useCallback(async () => {
    if (agentsReadState !== "ready") {
      setError("确认前 Agent 目录状态已变化，已阻止写入；请刷新后重试。");
      setCreateConfirming(false);
      return;
    }
    const row = knowledgeCreateRow(createDraft, agents);
    setCreateBusy(true);
    setError("");
    try {
      const requestPayload = {
        source: "knowledge_console_manual",
        text: JSON.stringify([row]),
        customerId: stableIdentityFilters.customerId,
        conversationId: stableIdentityFilters.conversationId,
        wechatAccountId: stableIdentityFilters.wechatAccountId,
      };
      const operation = reserveClientOperation("knowledge-import", requestPayload, createOperationRef.current);
      createOperationRef.current = operation;
      const result = await importKnowledgeText({ ...requestPayload, operationKey: operation.key });
      const savedCount = Number(result.saved?.count || 0);
      if (!savedCount || result.saved?.failed) {
        throw new Error("知识条目未写入；请检查 Agent、标题、正文和标签后重试。");
      }
      createOperationRef.current = completeClientOperation(createOperationRef.current, operation.key);
      setCreateDraft(EMPTY_KNOWLEDGE_CREATE_DRAFT);
      setCreateConfirming(false);
      setNotice(`已新增 ${savedCount} 条知识并进入人工复核；标记可用后才会参与企微回复。`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新增知识失败，服务端未确认写入。" );
    } finally {
      setCreateBusy(false);
    }
  }, [agents, agentsReadState, createDraft, refresh, stableIdentityFilters.conversationId, stableIdentityFilters.customerId, stableIdentityFilters.wechatAccountId]);

  const runRagPreview = useCallback(async () => {
    const text = ragQuery.trim();
    if (!text) {
      setRagError("请先输入一条客户问题。");
      return;
    }
    setRagBusy(true);
    setRagError("");
    try {
      setRagResult(await previewTrainingRag(text, stableIdentityFilters));
    } catch (caught) {
      setRagResult(null);
      setRagError(caught instanceof Error ? caught.message : "RAG 检索测试失败。");
    } finally {
      setRagBusy(false);
    }
  }, [ragQuery, stableIdentityFilters]);

  const agentNameById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name || agent.key || agent.id])), [agents]);
  const sourceOptions = useMemo(() => unique(entries.map((entry) => entry.sourceType || "manual_knowledge_import")), [entries]);
  const tagOptions = useMemo(() => unique(entries.flatMap((entry) => normalizeTags(entry.tags))).slice(0, 40), [entries]);
  const filteredEntries = useMemo(() => filterKnowledgeEntries(entries, {
    query,
    agentFilter,
    sourceFilter,
    tagFilter,
    statusFilter,
  }), [agentFilter, entries, query, sourceFilter, statusFilter, tagFilter]);
  const summary = useMemo(() => summarizeKnowledgeEntries(entries, filteredEntries), [entries, filteredEntries]);

  return (
    <section className={styles.page} aria-labelledby="training-knowledge-title" aria-busy={busy || reviewBusy || createBusy || ragBusy || trustedOperator.busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Knowledge</span>
          <h1 id="training-knowledge-title">知识库运营</h1>
          <p className={styles.description}>按 Agent、来源、标签、状态和正文检索知识条目；复核标记可用后才会进入回复检索。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href={trainingHref("/training/import", stableIdentityFilters)}>导入知识</Link>
          <Link className={styles.button} href={trainingHref("/training/overview", stableIdentityFilters)}>训练总览</Link>
          <Link className={styles.button} href={trainingHref("/training/skills", stableIdentityFilters)}>Skill 应用</Link>
          <button type="button" className={styles.button} data-action-id="training-knowledge-refresh" onClick={() => void refresh()} disabled={busy}>刷新知识库</button>
        </div>
      </header>

      {readError || error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{[readError, error].filter(Boolean).join("；")}</div> : null}
      {entriesReadState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">知识条目来自同一身份范围上次成功读取的结果；刷新成功前复核操作保持禁用。</div> : null}
      {agentsReadState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">Agent 目录来自同一身份范围上次成功读取的结果；刷新成功前新增知识保持禁用。</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      {!operator ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信复核人，知识启用与停用保持只读。</div> : null}
      <TrainingIdentityScopeNotice identityFilters={stableIdentityFilters} />

      <TrainingKnowledgeRagPanel
        busy={ragBusy}
        error={ragError}
        onQueryChange={setRagQuery}
        onRun={() => void runRagPreview()}
        query={ragQuery}
        result={ragResult}
      />

      <TrainingKnowledgeCreatePanel
        agents={agents}
        busy={createBusy}
        confirming={createConfirming}
        draft={createDraft}
        onCancel={() => setCreateConfirming(false)}
        onConfirm={() => void confirmCreateKnowledge()}
        onDraftChange={(patch) => setCreateDraft((current) => ({ ...current, ...patch }))}
        onRequest={requestCreateKnowledge}
        operatorPresent={Boolean(operator)}
        readState={agentsReadState}
      />

      <section className={styles.summaryGrid} aria-label="知识库摘要">
        <Metric label="知识条目" value={loaded ? summary.total : undefined} />
        <Metric label="当前筛选" value={loaded ? summary.visible : undefined} />
        <Metric label="可用于回复" value={loaded ? summary.ready : undefined} />
        <Metric label="待复核" value={loaded ? summary.review : undefined} />
        <Metric label="已停用" value={loaded ? summary.rejected : undefined} />
        <Metric label="Starter SOP" value={loaded ? summary.starter : undefined} />
      </section>

      <section className={styles.panel} aria-labelledby="training-knowledge-filter-title">
        <header className={styles.panelHeader}><div><h2 id="training-knowledge-filter-title">知识检索</h2><p>筛选只影响当前页面；启用、停用必须经过可信复核人和二次确认。</p></div></header>
        <div className={styles.panelBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}><span>搜索标题 / 正文 / 标签</span><input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="报价、发货、售后、Logo..." /></label>
            <label className={styles.field}><span>Agent</span><select className={styles.select} value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value={ALL_AGENTS}>全部 Agent</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name || agent.key || agent.id}</option>)}</select></label>
            <label className={styles.field}><span>来源</span><select className={styles.select} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value={ALL_SOURCES}>全部来源</option>{sourceOptions.map((source) => <option value={source} key={source}>{knowledgeSourceLabel(source)}</option>)}</select></label>
            <label className={styles.field}><span>标签</span><select className={styles.select} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value={ALL_TAGS}>全部标签</option>{tagOptions.map((tag) => <option value={tag} key={tag}>{tag}</option>)}</select></label>
            <label className={styles.field}><span>复核状态</span><select className={styles.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value={ALL_STATUSES}>全部状态</option>{REVIEW_STATUSES.map((status) => <option value={status} key={status}>{knowledgeStatusLabel(status)}</option>)}</select></label>
            <label className={styles.field}><span>复核说明</span><textarea className={styles.textarea} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="说明判断依据，提交启用、停用或保持复核前必须填写" /></label>
          </div>
        </div>
      </section>

      {pendingReview ? (
        <section className={styles.confirmation} role="region" aria-live="polite">
          <strong>确认提交“{knowledgeStatusLabel(pendingReview.status)}”</strong>
          <p>复核人：{operator}。知识：{pendingReview.entry.title || pendingReview.entry.id}。说明：{reviewNote.trim()}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={pendingReview.status === "rejected" ? styles.dangerButton : styles.primaryButton} data-action-id="training.knowledge.review.confirm" onClick={() => void confirmReview()} disabled={entriesReadState !== "ready" || reviewBusy}>确认提交</button>
            <button type="button" className={styles.button} data-action-id="training.knowledge.review.cancel" onClick={() => setPendingReview(null)} disabled={reviewBusy}>取消</button>
          </div>
        </section>
      ) : null}

      <KnowledgeList
        entries={entries}
        filteredEntries={filteredEntries}
        agents={agents}
        agentNameById={agentNameById}
        loaded={loaded}
        expandedId={expandedId}
        expandLabel="查看正文"
        editDrafts={editDrafts}
        reviewBusy={reviewBusy || entriesReadState !== "ready"}
        operator={operator}
        reviewNote={reviewNote}
        actionContracts={TRAINING_KNOWLEDGE_EDIT_ACTION_CONTRACTS}
        shouldBlockReady={shouldBlockReady}
        ReviewEditor={KnowledgeReviewEditor}
        onExpandedIdChange={setExpandedId}
        onDraftChange={updateEditDraft}
        onRequestReview={requestReview}
      />
    </section>
  );
}

export type { KnowledgeCreateDraft, KnowledgeEntryRecord, KnowledgeReviewDraft, KnowledgeReviewStatus, TrainingKnowledgePageProps } from "./training-knowledge-page-model";

function Metric({ label, value }: { label: string; value?: number }) {
  return <div className={styles.summaryCard}><span>{label}</span><strong>{typeof value === "number" ? value : "-"}</strong></div>;
}

export function knowledgeCreateBlockers(draft: KnowledgeCreateDraft) {
  const blockers: string[] = [];
  if (!draft.agentId.trim()) blockers.push("请选择 Agent");
  if (!draft.title.trim()) blockers.push("请填写标题");
  if (draft.content.trim().length < 20) blockers.push("正文至少 20 个字");
  if (!draft.tags.split(/[,;|\u3001\uff0c\uff1b]/).map((tag) => tag.trim()).filter(Boolean).length) blockers.push("请填写场景标签");
  const score = Number(draft.qualityScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) blockers.push("质量分必须为 0-100");
  return blockers;
}

export function knowledgeCreateRow(draft: KnowledgeCreateDraft, agents: Agent[]) {
  const agent = agents.find((item) => item.id === draft.agentId);
  return {
    title: draft.title.trim(),
    content: draft.content.trim(),
    agentId: draft.agentId.trim(),
    agentKey: agent?.key || "",
    tags: draft.tags.split(/[,;|\u3001\uff0c\uff1b]/).map((tag) => tag.trim()).filter(Boolean),
    qualityScore: Math.round(Number(draft.qualityScore)),
  };
}
