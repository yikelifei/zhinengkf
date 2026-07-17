"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAgents, type Agent, type IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";

export type AgentsPageProps = {
  identityFilters?: IdentityFilters;
};

export function AgentsPage({ identityFilters }: AgentsPageProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
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
      const nextAgents = await getAgents(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setAgents(nextAgents);
      if (!nextAgents.length) {
        setError("智能体接口返回空结果；当前客户端无法区分真实空目录与读取失败，目录状态保持未确认。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "智能体读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const enabledCount = useMemo(() => agents.filter((agent) => agent.enabled).length, [agents]);
  const skillCount = useMemo(() => agents.reduce((sum, agent) => sum + agent.skills.filter((skill) => skill.enabled).length, 0), [agents]);

  return (
    <section className={styles.page} aria-labelledby="agents-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Agents</span>
          <h1 id="agents-title">智能体目录</h1>
          <p className={styles.description}>只负责查看智能体、职责场景、技能与训练覆盖，不在此页混入训练审核或自动化控制。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="agents-refresh"
          aria-label="刷新智能体目录"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新目录
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      <section className={styles.summaryGrid} aria-label="智能体摘要">
        <div className={styles.summaryCard}><span>智能体</span><strong>{agents.length}</strong></div>
        <div className={styles.summaryCard}><span>已启用</span><strong>{enabledCount}</strong></div>
        <div className={styles.summaryCard}><span>启用技能</span><strong>{skillCount}</strong></div>
        <div className={styles.summaryCard}><span>训练样本</span><strong>{agents.reduce((sum, agent) => sum + agent.trainingSampleCount, 0)}</strong></div>
      </section>

      <section className={styles.panel} aria-labelledby="agent-list-title">
        <header className={styles.panelHeader}><div><h2 id="agent-list-title">智能体与技能</h2><p>数据来自服务端智能体目录。</p></div></header>
        <div className={styles.panelBody}>
          {agents.length ? (
            <div className={styles.recordGrid}>
              {agents.map((agent) => (
                <article className={styles.record} key={agent.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{agent.name}</h3><p>{agent.description || "服务端未提供职责说明。"}</p></div>
                    <span className={`${styles.badge} ${agent.enabled ? styles.toneOk : styles.toneMuted}`}>{agent.enabled ? "已启用" : "已停用"}</span>
                  </div>
                  <dl className={styles.definitionList}>
                    <div><dt>场景</dt><dd>{agent.scene || "未配置"}</dd></div>
                    <div><dt>训练样本</dt><dd>{agent.trainingSampleCount}</dd></div>
                    <div><dt>平均评分</dt><dd>{formatScore(agent.averageTrainingScore)}</dd></div>
                  </dl>
                  <div className={styles.tagList} aria-label={`${agent.name}的技能`}>
                    {agent.skills.length ? agent.skills.map((skill) => (
                      <span className={`${styles.tag} ${skill.enabled ? styles.toneOk : styles.toneMuted}`} key={skill.id}>
                        {skill.name}{skill.scope?.label ? ` · ${skill.scope.label}` : ""}
                      </span>
                    )) : <span className={styles.muted}>尚未配置技能。</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>服务端没有返回智能体记录。</div>}
        </div>
      </section>
    </section>
  );
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}
