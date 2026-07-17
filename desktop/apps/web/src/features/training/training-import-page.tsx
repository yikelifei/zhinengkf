"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  getAgents,
  getChatImports,
  importChatTranscript,
  type Agent,
  type ChatImport,
  type IdentityFilters,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

export type TrainingImportPageProps = {
  identityFilters?: IdentityFilters;
};

export function TrainingImportPage({ identityFilters }: TrainingImportPageProps) {
  const [imports, setImports] = useState<ChatImport[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [agentId, setAgentId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    const [importResult, agentResult] = await Promise.allSettled([
      getChatImports(stableIdentityFilters),
      getAgents(stableIdentityFilters),
    ]);
    if (sequence !== refreshSequence.current) return;
    const nextImports = importResult.status === "fulfilled" ? importResult.value : [];
    const nextAgents = agentResult.status === "fulfilled" ? agentResult.value : [];
    setImports(nextImports);
    setAgents(nextAgents);
    if (importResult.status === "rejected" || agentResult.status === "rejected") {
      setError("训练导入页未取得完整服务端数据，请检查服务后重试。");
    } else if (!nextImports.length || !nextAgents.length) {
      setError("导入记录或智能体接口返回空结果；当前客户端无法区分真实空数据与读取失败，状态保持未确认。");
    }
    if (sequence === refreshSequence.current) setBusy(false);
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const requestImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (transcript.trim().length < 10) {
      setError("聊天记录内容过短，未提交导入。");
      return;
    }
    setPendingConfirmation(true);
  };

  const confirmImport = useCallback(async () => {
    const text = transcript.trim();
    if (text.length < 10) {
      setError("待导入内容已经变化，请重新核对。");
      setPendingConfirmation(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await importChatTranscript({
        name: name.trim() || undefined,
        source: source.trim() || undefined,
        channel: channel.trim() || undefined,
        agentId: agentId || undefined,
        text,
      });
      setImports((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setTranscript("");
      setPendingConfirmation(false);
      setNotice(`导入完成：解析 ${result.messageCount} 条消息，生成 ${result.pairCount} 组训练对话。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "聊天记录导入失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [agentId, channel, name, source, transcript]);

  return (
    <section className={styles.page} aria-labelledby="training-import-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Training</span>
          <h1 id="training-import-title">聊天记录导入</h1>
          <p className={styles.description}>这里只负责提交真实聊天记录并查看导入结果；样本复核在独立页面完成。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="training-import-refresh"
          aria-label="刷新训练导入记录"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新记录
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

      <section className={styles.panel} aria-labelledby="training-import-form-title">
        <header className={styles.panelHeader}><div><h2 id="training-import-form-title">导入内容</h2><p>来源字段用于后续审计，不会改变身份绑定。</p></div></header>
        <form className={styles.panelBody} onSubmit={requestImport}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>记录名称</span>
              <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="可选，便于查找" />
            </label>
            <label className={styles.field}>
              <span>来源</span>
              <input className={styles.input} value={source} onChange={(event) => setSource(event.target.value)} placeholder="可选，如导出文件名" />
            </label>
            <label className={styles.field}>
              <span>渠道</span>
              <input className={styles.input} value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="可选，如个人微信" />
            </label>
            <label className={styles.field}>
              <span>目标智能体</span>
              <select className={styles.select} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">由服务端按场景识别</option>
                {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.scene}</option>)}
              </select>
            </label>
            <label className={`${styles.field} ${styles.wideField}`}>
              <span>聊天记录正文</span>
              <textarea
                className={styles.textarea}
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="粘贴需要解析的真实聊天记录"
                required
              />
            </label>
          </div>
          <div className={styles.actionBar}>
            <p className={styles.helpText}>提交后仅生成待复核数据，不会在本页直接将样本用于训练。</p>
            <button
              type="submit"
              className={styles.primaryButton}
              data-action-id="training-import-request"
              aria-label="核对并请求导入聊天记录"
              disabled={busy || transcript.trim().length < 10}
            >
              核对并导入
            </button>
          </div>
        </form>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="training-import-confirm-title">
          <strong id="training-import-confirm-title">确认导入聊天记录</strong>
          <p>将向服务端提交 {transcript.trim().length} 个字符，并由服务端生成可追溯的导入记录与待复核样本。</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="training-import-confirm"
              aria-label="确认导入聊天记录"
              onClick={() => void confirmImport()}
              disabled={busy}
            >
              确认导入
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="training-import-cancel"
              aria-label="取消导入聊天记录"
              onClick={() => setPendingConfirmation(false)}
              disabled={busy}
            >
              返回检查
            </button>
          </div>
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="training-import-history-title">
        <header className={styles.panelHeader}><div><h2 id="training-import-history-title">导入历史</h2><p>展示服务端已有导入及解析警告。</p></div></header>
        <div className={styles.panelBody}>
          {imports.length ? (
            <div className={styles.recordList}>
              {imports.map((item) => (
                <article className={styles.record} key={item.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{item.name || item.source || item.id}</h3><p>{item.source || "未标注来源"} · {item.channel || "未标注渠道"}</p></div>
                    <span className={`${styles.badge} ${item.warnings.length ? styles.toneWarning : styles.toneOk}`}>{item.warnings.length ? `${item.warnings.length} 条警告` : "解析完成"}</span>
                  </div>
                  <div className={styles.recordMeta}><span>{item.messageCount} 条消息</span><span>{item.pairCount} 组对话</span><span>{formatDateTime(item.createdAt)}</span></div>
                  {item.sceneSummary ? (
                    <div className={styles.recordMeta}>
                      <span>可用 {item.sceneSummary.readyCount ?? 0}</span>
                      <span>待复核 {item.sceneSummary.reviewCount ?? 0}</span>
                      <span>场景不确定 {item.sceneSummary.sceneUncertainCount}</span>
                    </div>
                  ) : null}
                  {item.warnings.length ? <ul className={styles.helpText}>{item.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>服务端没有返回导入记录。</div>}
        </div>
      </section>
    </section>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
