"use client";

import type { Agent, TrainingRagPreview } from "../../lib/api";
import styles from "../governance-pages.module.css";
import type { KnowledgeCreateDraft } from "./training-knowledge-page-model";

type ReadState = "unknown" | "ready" | "stale";

export function TrainingKnowledgeRagPanel({
  busy,
  error,
  onQueryChange,
  onRun,
  query,
  result,
}: {
  busy: boolean;
  error: string;
  onQueryChange: (value: string) => void;
  onRun: () => void;
  query: string;
  result: TrainingRagPreview | null;
}) {
  return (
    <section className={styles.panel} aria-labelledby="training-rag-preview-title">
      <header className={styles.panelHeader}><div><h2 id="training-rag-preview-title">小石 RAG 测试台</h2><p>输入客户原话，检查场景、Skill、知识命中依据和最终回复；只读取已启用知识，不发送消息。</p></div></header>
      <div className={styles.panelBody}>
        <label className={styles.field}><span>模拟客户消息</span><textarea className={styles.textarea} value={query} data-action-id="training.rag.preview.query" onChange={(event) => onQueryChange(event.target.value)} placeholder="例如：好贵，我再看看吧" /></label>
        <div className={styles.buttonRow}><button type="button" className={styles.primaryButton} data-action-id="training.rag.preview.run" onClick={onRun} disabled={busy}>{busy ? "检索中…" : "测试小石回答"}</button></div>
        {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
        {result ? (
          <div className={styles.recordList} data-training-rag-preview-result>
            <div className={styles.recordGrid}>
              <div className={styles.summaryCard}><span>路由场景</span><strong>{result.route.scene || "未分类"}</strong></div>
              <div className={styles.summaryCard}><span>RAG 决策</span><strong>{ragDecisionLabel(result.rag.decision)}</strong></div>
              <div className={styles.summaryCard}><span>最高分</span><strong>{result.rag.topScore ?? 0}</strong></div>
              <div className={styles.summaryCard}><span>小石原话保护</span><strong>{result.styleProfile?.preserveHumanVerbatim ? "开启" : "未触发"}</strong></div>
            </div>
            <div><strong>建议回复</strong><pre className={styles.codeBlock}>{result.reply}</pre></div>
            <div><strong>已应用 Skill</strong><p>{result.appliedSkills.length ? result.appliedSkills.map((skill) => skill.name).filter(Boolean).join("、") : "未命中 Skill"}</p></div>
            <div><strong>知识命中解释</strong>{result.knowledgeMatches.length ? <ul className={styles.recordList}>{result.knowledgeMatches.map((match) => <li className={styles.record} key={match.id || match.title}><div className={styles.recordMeta}><span className={`${styles.badge} ${match.allowVerbatim ? styles.toneOk : styles.toneMuted}`}>{match.allowVerbatim ? "真人原话" : "参考知识"}</span><span>得分 {match.score ?? 0}</span><span>{match.ragConfidence || "none"}</span></div><strong>{match.title || match.id}</strong><p>{match.retrievalReasons?.join("；") || "无额外解释"}</p><pre className={styles.codeBlock}>{match.excerpt || ""}</pre></li>)}</ul> : <p>没有达到检索阈值，系统使用小石安全兜底话术。</p>}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function TrainingKnowledgeCreatePanel({
  agents,
  busy,
  confirming,
  draft,
  onCancel,
  onConfirm,
  onDraftChange,
  onRequest,
  operatorPresent,
  readState,
}: {
  agents: Agent[];
  busy: boolean;
  confirming: boolean;
  draft: KnowledgeCreateDraft;
  onCancel: () => void;
  onConfirm: () => void;
  onDraftChange: (patch: Partial<KnowledgeCreateDraft>) => void;
  onRequest: () => void;
  operatorPresent: boolean;
  readState: ReadState;
}) {
  return (
    <>
      <section className={styles.panel} aria-labelledby="training-knowledge-create-title">
        <header className={styles.panelHeader}><div><h2 id="training-knowledge-create-title">直接新增知识</h2><p>单条新增会复用现有知识导入与审计链，先进入复核状态，不会绕过人工确认直接用于回复。</p></div></header>
        <div className={styles.panelBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}><span>所属 Agent</span><select className={styles.select} value={draft.agentId} data-action-id="training.knowledge.create.agent" disabled={readState !== "ready" || busy} onChange={(event) => onDraftChange({ agentId: event.target.value })}><option value="">选择 Agent</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name || agent.key || agent.id}</option>)}</select></label>
            <label className={styles.field}><span>知识标题</span><input className={styles.input} value={draft.title} data-action-id="training.knowledge.create.title" onChange={(event) => onDraftChange({ title: event.target.value })} placeholder="例如：报价前需要确认哪些信息" /></label>
            <label className={styles.field}><span>场景标签</span><input className={styles.input} value={draft.tags} data-action-id="training.knowledge.create.tags" onChange={(event) => onDraftChange({ tags: event.target.value })} placeholder="报价、预算、交期" /></label>
            <label className={styles.field}><span>质量分</span><input className={styles.input} type="number" min="0" max="100" value={draft.qualityScore} data-action-id="training.knowledge.create.quality" onChange={(event) => onDraftChange({ qualityScore: event.target.value })} /></label>
            <label className={styles.field}><span>知识正文</span><textarea className={styles.textarea} value={draft.content} data-action-id="training.knowledge.create.content" onChange={(event) => onDraftChange({ content: event.target.value })} placeholder="填写明确、可执行且已经确认的业务规则或回复口径，至少 20 个字。" /></label>
          </div>
          <div className={styles.buttonRow}><button type="button" className={styles.primaryButton} data-action-id="training.knowledge.create.request" onClick={onRequest} disabled={readState !== "ready" || busy || !operatorPresent}>准备新增知识</button></div>
        </div>
      </section>

      {confirming ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="training-knowledge-create-confirm-title">
          <strong id="training-knowledge-create-confirm-title">确认新增知识？</strong>
          <p>知识“{draft.title.trim()}”将写入复核队列；必须再次人工标记可用后才参与企微回复。</p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="training.knowledge.create.confirm" onClick={onConfirm} disabled={readState !== "ready" || busy}>确认写入复核队列</button>
            <button type="button" className={styles.button} data-action-id="training.knowledge.create.cancel" onClick={onCancel} disabled={busy}>取消</button>
          </div>
        </section>
      ) : null}
    </>
  );
}

function ragDecisionLabel(value?: string) {
  if (value === "use_reviewed_verbatim") return "使用真人原话";
  if (value === "grounded_synthesis") return "依据知识生成";
  return "安全兜底";
}
