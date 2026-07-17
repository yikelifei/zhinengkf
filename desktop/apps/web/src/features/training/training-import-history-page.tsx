"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChatImports, type ChatImport, type IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";

export function TrainingImportHistoryPage({ identityFilters }: { identityFilters?: IdentityFilters }) {
  const [imports, setImports] = useState<ChatImport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    try {
      const nextImports = await getChatImports(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setImports(nextImports);
      if (!nextImports.length) {
        setError("导入记录接口返回空结果；当前客户端无法区分真实空历史与读取失败，状态保持未确认。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "训练导入历史读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  return (
    <section className={styles.page} aria-labelledby="training-import-history-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="training-import-history-title">导入历史</h1>
          <p className={styles.description}>只查看服务端已有导入、解析数量和警告；新建导入在独立页面完成。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href="/training/import">新建导入</Link>
          <button type="button" className={styles.button} data-action-id="training-import-history-refresh" onClick={() => void refresh()} disabled={busy}>刷新记录</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

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
      ) : <div className={styles.empty}>服务端没有返回导入记录。</div>}
    </section>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
