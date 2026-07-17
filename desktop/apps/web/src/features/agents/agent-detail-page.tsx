"use client";

import Link from "next/link";
import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useAgentsDirectory } from "./use-agents-directory";

export function AgentDetailPage({ agentId, identityFilters }: { agentId: string; identityFilters?: IdentityFilters }) {
  const { agents, busy, error, refresh } = useAgentsDirectory(identityFilters);
  const agent = agents.find((item) => item.id === agentId) || null;
  const missing = !busy && agents.length > 0 && !agent;

  return (
    <section className={styles.page} aria-labelledby="agent-detail-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="agent-detail-title">{agent?.name || "智能体详情"}</h1>
          <p className={styles.description}>只查看一个智能体的职责、训练覆盖和技能状态。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href="/agents">返回目录</Link>
          <button type="button" className={styles.button} data-action-id="agent-detail-refresh" onClick={() => void refresh()} disabled={busy}>刷新详情</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {missing ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">地址中的智能体不存在，未回退展示其他记录。</div> : null}

      {agent ? (
        <>
          <dl className={styles.definitionList}>
            <div><dt>运行状态</dt><dd>{agent.enabled ? "已启用" : "已停用"}</dd></div>
            <div><dt>职责场景</dt><dd>{agent.scene || "未配置"}</dd></div>
            <div><dt>训练样本</dt><dd>{agent.trainingSampleCount}</dd></div>
          </dl>
          <section className={styles.panel} aria-labelledby="agent-skills-title">
            <header className={styles.panelHeader}><div><h2 id="agent-skills-title">技能清单</h2><p>{agent.description || "服务端未提供职责说明。"}</p></div></header>
            <div className={styles.panelBody}>
              {agent.skills.length ? <div className={styles.recordList}>{agent.skills.map((skill) => (
                <article className={styles.record} key={skill.id}>
                  <div className={styles.recordHeader}><div><h3>{skill.name}</h3><p>{skill.scope?.label || "未标注技能范围"}</p></div><span className={`${styles.badge} ${skill.enabled ? styles.toneOk : styles.toneMuted}`}>{skill.enabled ? "已启用" : "已停用"}</span></div>
                </article>
              ))}</div> : <div className={styles.empty}>尚未配置技能。</div>}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
