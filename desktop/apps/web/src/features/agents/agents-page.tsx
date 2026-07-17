"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useAgentsDirectory } from "./use-agents-directory";

export type AgentsPageProps = { identityFilters?: IdentityFilters };

export function AgentsPage({ identityFilters }: AgentsPageProps) {
  const { agents, busy, error, refresh } = useAgentsDirectory(identityFilters);
  const summary = useMemo(() => ({
    enabled: agents.filter((agent) => agent.enabled).length,
    skills: agents.reduce((sum, agent) => sum + agent.skills.filter((skill) => skill.enabled).length, 0),
    samples: agents.reduce((sum, agent) => sum + agent.trainingSampleCount, 0),
  }), [agents]);

  return (
    <section className={styles.page} aria-labelledby="agents-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="agents-title">智能体目录</h1>
          <p className={styles.description}>目录只负责定位智能体；技能和训练覆盖在各自详情页查看。</p>
        </div>
        <button type="button" className={styles.button} data-action-id="agents-refresh" onClick={() => void refresh()} disabled={busy}>刷新目录</button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      <section className={styles.summaryGrid} aria-label="智能体摘要">
        <div className={styles.summaryCard}><span>智能体</span><strong>{agents.length}</strong></div>
        <div className={styles.summaryCard}><span>已启用</span><strong>{summary.enabled}</strong></div>
        <div className={styles.summaryCard}><span>启用技能</span><strong>{summary.skills}</strong></div>
        <div className={styles.summaryCard}><span>训练样本</span><strong>{summary.samples}</strong></div>
      </section>

      {agents.length ? (
        <div className={styles.recordList} aria-label="智能体列表">
          {agents.map((agent) => (
            <Link className={`${styles.record} ${styles.recordLink}`} href={`/agents/${encodeURIComponent(agent.id)}`} key={agent.id}>
              <div className={styles.recordHeader}>
                <div><h2>{agent.name}</h2><p>{agent.description || "服务端未提供职责说明。"}</p></div>
                <span className={`${styles.badge} ${agent.enabled ? styles.toneOk : styles.toneMuted}`}>{agent.enabled ? "已启用" : "已停用"}</span>
              </div>
              <div className={styles.recordMeta}><span>场景 {agent.scene || "未配置"}</span><span>{agent.skills.length} 项技能</span><span>{agent.trainingSampleCount} 条样本</span></div>
              <strong className={styles.openLabel}>查看职责与技能</strong>
            </Link>
          ))}
        </div>
      ) : <div className={styles.empty}>服务端没有返回智能体记录。</div>}
    </section>
  );
}
