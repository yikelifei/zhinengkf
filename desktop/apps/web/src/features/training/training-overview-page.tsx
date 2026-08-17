"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmConversationOutcome,
  getConversationLearning,
  getTrainingKnowledgeEntries,
  getTrainingOverview,
  type ConversationLearningDashboard,
  type IdentityFilters,
  type TrainingOverview,
} from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import { ConversationFeedbackRecord } from "./conversation-feedback-record";
import { TrainingIdentityScopeNotice, trainingHref } from "./training-identity-navigation";

export type TrainingOverviewPageProps = {
  identityFilters?: IdentityFilters;
};

export type TrainingKnowledgeEntry = {
  id: string;
  agentId?: string | null;
  agentKey?: string;
  title?: string;
  content?: string;
  sourceType?: string;
  qualityScore?: number;
  tags?: string[];
};

export function TrainingOverviewPage({ identityFilters }: TrainingOverviewPageProps) {
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [knowledgeEntries, setKnowledgeEntries] = useState<TrainingKnowledgeEntry[]>([]);
  const [learning, setLearning] = useState<ConversationLearningDashboard | null>(null);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);
  const [learningLoaded, setLearningLoaded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const outcomeOperationRef = useRef<PendingClientOperation | null>(null);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    const results = await Promise.allSettled([
        getTrainingOverview(stableIdentityFilters),
        getTrainingKnowledgeEntries(stableIdentityFilters),
        getConversationLearning({ ...stableIdentityFilters, limit: stableIdentityFilters.conversationId ? 1 : 20 }),
      ] as const);
    if (sequence !== refreshSequence.current) return;
    const errors: string[] = [];
    if (results[0].status === "fulfilled") {
      setOverview(results[0].value);
      setLoaded(true);
    } else {
      errors.push(results[0].reason instanceof Error ? `训练指标：${results[0].reason.message}` : "训练指标读取失败");
    }
    if (results[1].status === "fulfilled") {
      setKnowledgeEntries(Array.isArray(results[1].value) ? results[1].value : []);
      setKnowledgeLoaded(true);
    } else {
      errors.push(results[1].reason instanceof Error ? `知识条目：${results[1].reason.message}` : "知识条目读取失败");
    }
    if (results[2].status === "fulfilled") {
      setLearning(results[2].value);
      setLearningLoaded(true);
    } else {
      errors.push(results[2].reason instanceof Error ? `会话学习：${results[2].reason.message}` : "会话学习读取失败");
    }
    setError(errors.length ? `部分训练数据未更新，已保留成功读取的内容。${errors.join("；")}` : "");
    setBusy(false);
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  const quality = overview?.qualitySummary;
  const readyRate = overview && overview.totalSamples > 0 ? overview.readySamples / overview.totalSamples : 0;
  const knowledgeAcceptance = useMemo(
    () => buildTrainingKnowledgeAcceptance(knowledgeEntries),
    [knowledgeEntries],
  );

  const confirmOutcome = useCallback(async (
    item: ConversationLearningDashboard["conversations"][number],
    outcome: "won" | "lost" | "ongoing",
    reasonCode: string,
    note: string,
  ) => {
    const conversation = item.conversation;
    if (!conversation.id || !conversation.wechatAccountId || !conversation.customerId) {
      setError("该会话缺少账号或客户身份，不能提交成交反馈。");
      return;
    }
    const payload = {
      outcome,
      reasonCode,
      note,
      expectedWechatAccountId: conversation.wechatAccountId,
      expectedConversationId: conversation.id,
      expectedCustomerId: conversation.customerId,
    };
    const operation = reserveClientOperation("conversation-outcome", payload, outcomeOperationRef.current);
    outcomeOperationRef.current = operation;
    setBusy(true);
    setError("");
    try {
      await confirmConversationOutcome(conversation.id, { ...payload, operationKey: operation.key });
      outcomeOperationRef.current = completeClientOperation(outcomeOperationRef.current, operation.key);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "成交结果反馈失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <section className={styles.page} aria-labelledby="training-overview-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="training-overview-title">Agent Skill 训练概览</h1>
          <p className={styles.description}>训练会把真实聊天样本和运营 SOP 沉淀成智能客服 Agent 的 Skill 与知识，让回复草稿更像真人客服。</p>
        </div>
        <div className={`${styles.buttonRow} ${styles.trainingOverviewActions}`}>
          <Link className={styles.button} href={trainingHref("/training/import", stableIdentityFilters)}>导入聊天记录</Link>
          <Link className={styles.button} href={trainingHref("/training/knowledge", stableIdentityFilters)}>知识库运营</Link>
          <Link className={styles.button} href={trainingHref("/training/review", stableIdentityFilters)}>复核样本</Link>
          <Link className={styles.button} href={trainingHref("/training/skills", stableIdentityFilters)}>技能建议</Link>
          <button type="button" className={styles.button} data-action-id="training-overview-refresh" aria-label="刷新训练概览" onClick={() => void refresh()} disabled={busy}>刷新概览</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      <TrainingIdentityScopeNotice identityFilters={stableIdentityFilters} />

      <section className={styles.summaryGrid} aria-label="训练资产摘要">
        <div className={styles.summaryCard}><span>样本总数</span><strong>{loaded && overview ? overview.totalSamples : "—"}</strong></div>
        <div className={styles.summaryCard}><span>可用样本</span><strong>{loaded && overview ? overview.readySamples : "—"}</strong></div>
        <div className={styles.summaryCard}><span>待复核</span><strong>{loaded && overview ? overview.reviewSamples : "—"}</strong></div>
        <div className={styles.summaryCard}><span>待应用 Skill</span><strong>{loaded && overview ? overview.suggestionCount : "—"}</strong></div>
        <div className={styles.summaryCard}><span>知识条目</span><strong>{loaded && overview ? overview.knowledgeEntryCount ?? 0 : "—"}</strong></div>
      </section>

      <section className={styles.panel} aria-labelledby="conversation-learning-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="conversation-learning-title">每轮学习与未成交反馈</h2>
            <p>每条客户来信形成一条会话观察；成交原因必须有聊天、报价、订单或人工确认作为证据。</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          <div className={styles.recordGrid} aria-label="会话学习指标">
            <Metric label="学习观察" value={learning?.summary.learningObservationCount} />
            <Metric label="已成交" value={learning?.summary.wonCount} />
            <Metric label="明确未成交" value={learning?.summary.lostCount} />
            <Metric label="进行中/停滞" value={learning ? learning.summary.ongoingCount : undefined} />
          </div>
          {learning?.summary.topReasons.length ? (
            <div className={styles.recordMeta} aria-label="未成交原因分布">
              {learning.summary.topReasons.slice(0, 6).map((reason) => <span key={reason.code}>{reason.label} {reason.count}</span>)}
            </div>
          ) : null}
          {learning?.conversations.length ? (
            <div className={styles.recordList}>
              {learning.conversations.slice(0, 10).map((item) => (
                <ConversationFeedbackRecord key={item.conversation.id} item={item} busy={busy} onConfirm={confirmOutcome} />
              ))}
            </div>
          ) : <div className={styles.empty}>{learningLoaded
            ? "当前范围还没有可分析的真实会话。收到客户消息后，这里会自动出现学习观察和成交反馈。"
            : "会话学习数据尚未成功读取，不能据此认定没有待沉淀结果。"}</div>}
          <p className={styles.helpText}>客户沉默只标记为“停滞”，不会自动判定丢单；价格、库存、运费和交期等临时事实必须人工复核后才能进入知识库或 Skill。</p>
        </div>
      </section>

      {overview ? (
        <>
          <section className={styles.panel} aria-labelledby="training-quality-title">
            <header className={styles.panelHeader}><div><h2 id="training-quality-title">样本质量与 Skill 上线判断</h2><p>可用率 {formatPercent(readyRate)} · 平均分 {formatScore(overview.averageScore)} · 只有可训练样本会沉淀为 Agent Skill</p></div></header>
            <div className={styles.panelBody}>
              <div className={styles.recordGrid}>
                <Metric label="安全样本" value={quality?.safeSamples} />
                <Metric label="可训练样本" value={quality?.trainableSamples} />
                <Metric label="风险样本" value={quality?.riskSamples} />
                <Metric label="已阻断样本" value={quality?.blockedSamples} />
                <Metric label="场景不确定" value={quality?.sceneUncertainSamples} />
                <Metric label="缺少技能提示" value={quality?.missingSkillHintSamples} />
              </div>
              {overview.recommendations.length ? (
                <ul className={styles.recordList} aria-label="训练改进建议">
                  {overview.recommendations.map((item) => <li className={styles.record} key={item}>{item}</li>)}
                </ul>
              ) : <div className={styles.empty}>当前没有服务端训练改进建议。</div>}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="training-knowledge-title">
            <header className={styles.panelHeader}><div><h2 id="training-knowledge-title">知识库覆盖</h2><p>启动 SOP {overview.starterKnowledgeEntryCount ?? 0} 条，当前可检索知识 {overview.knowledgeEntryCount ?? 0} 条。</p></div></header>
            <div className={styles.panelBody}>
              {overview.knowledgeByAgent?.length ? (
                <div className={styles.recordList}>
                  {overview.knowledgeByAgent.map((agent) => (
                    <article className={styles.record} key={agent.agentId || agent.agentKey || agent.name}>
                      <div className={styles.recordHeader}>
                        <div><h3>{agent.name}</h3><p>{agent.topTitles.length ? agent.topTitles.join("、") : "暂无高分知识条目"}</p></div>
                        <span className={`${styles.badge} ${agent.count ? styles.toneOk : styles.toneWarning}`}>{agent.count} 条</span>
                      </div>
                      <div className={styles.recordMeta}>
                        <span>启动 SOP {agent.starterCount}</span>
                        <span>总知识 {agent.count}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className={styles.empty}>当前知识库没有可用条目；请先导入聊天记录或补充运营 SOP。</div>}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="training-knowledge-acceptance-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="training-knowledge-acceptance-title">Skill 与知识运营验收</h2>
                <p>拆分 starter SOP、自定义沉淀、场景标签和 Agent 归属；已应用的建议会写入 Agent Skill，未应用前不声明已训练完成。</p>
              </div>
            </header>
            <div className={styles.panelBody}>
              <div className={styles.recordGrid} aria-label="知识库验收指标">
                <Metric label="内置 SOP" value={knowledgeLoaded ? knowledgeAcceptance.starterCount : undefined} />
                <Metric label="自定义知识" value={knowledgeLoaded ? knowledgeAcceptance.customCount : undefined} />
                <Metric label="场景标签" value={knowledgeLoaded ? knowledgeAcceptance.tagCount : undefined} />
                <Metric label="Agent 覆盖" value={knowledgeLoaded ? knowledgeAcceptance.agentCount : undefined} />
              </div>
              {knowledgeAcceptance.topTags.length ? (
                <div className={styles.recordMeta} aria-label="高频知识标签">
                  {knowledgeAcceptance.topTags.map((tag) => <span key={tag.name}>{tag.name} {tag.count}</span>)}
                </div>
              ) : <div className={styles.empty}>{knowledgeLoaded ? "当前知识条目缺少场景标签，后续纠错和导入需要补齐标签。" : "知识条目尚未成功读取。"}</div>}
              {knowledgeAcceptance.latestEntries.length ? (
                <div className={styles.recordList} aria-label="知识条目验收列表">
                  {knowledgeAcceptance.latestEntries.map((entry) => (
                    <article className={styles.record} key={entry.id}>
                      <div className={styles.recordHeader}>
                        <div><h3>{entry.title || "未命名知识"}</h3><p>{normalizeTags(entry.tags).join("、") || "未标注场景"}</p></div>
                        <span className={`${styles.badge} ${entry.sourceType === "starter_knowledge" ? styles.toneOk : styles.toneWarning}`}>
                          {knowledgeSourceLabel(entry.sourceType)}
                        </span>
                      </div>
                      <div className={styles.recordMeta}>
                        <span>{entry.agentKey || entry.agentId || "通用 Agent"}</span>
                        <span>质量 {formatScore(entry.qualityScore)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className={styles.empty}>{knowledgeLoaded ? "当前没有可验收知识条目，请先导入真实聊天或补充运营 SOP。" : "知识条目尚未成功读取。"}</div>}
              <div className={styles.actionBar}>
                <p className={styles.helpText}>知识与 Skill 都来自聊天导入、样本复核和纠错沉淀；Skill 应用仍在技能建议页人工确认。</p>
                <div className={styles.buttonRow}>
                  <Link className={styles.button} href={trainingHref("/training/import", stableIdentityFilters)}>导入沉淀</Link>
                  <Link className={styles.button} href={trainingHref("/training/knowledge", stableIdentityFilters)}>知识库运营</Link>
                  <Link className={styles.button} href={trainingHref("/training/review", stableIdentityFilters)}>复核纠错</Link>
                  <Link className={styles.button} href={trainingHref("/training/skills", stableIdentityFilters)}>技能应用</Link>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="training-agent-coverage-title">
            <header className={styles.panelHeader}><div><h2 id="training-agent-coverage-title">Agent Skill 覆盖度</h2><p>{overview.agentsWithSamples} 个智能体已有样本，可继续沉淀真人化回复 Skill。</p></div></header>
            <div className={styles.panelBody}>
              {overview.byAgent.length ? (
                <div className={styles.recordList}>
                  {overview.byAgent.map((agent) => (
                    <article className={styles.record} key={agent.agentId || agent.agentKey}>
                      <div className={styles.recordHeader}>
                        <div><h3>{agent.name}</h3><p>{agent.scene || "未配置场景"}</p></div>
                        <span className={`${styles.badge} ${agent.readyCount ? styles.toneOk : styles.toneWarning}`}>{agent.readyCount ? "已有可用样本" : "缺少可用样本"}</span>
                      </div>
                      <div className={styles.recordMeta}>
                        <span>{agent.sampleCount} 条样本</span>
                        <span>可用 {agent.readyCount}</span>
                        <span>待复核 {agent.reviewCount}</span>
                        <span>建议 {agent.suggestionCount}</span>
                        <span>均分 {formatScore(agent.averageScore)}</span>
                      </div>
                      <p className={styles.helpText}>{agent.topSkillHints.length ? `高频 Skill 提示：${agent.topSkillHints.map((hint) => `${hint.name} ${hint.count}`).join("、")}` : "暂无高频 Skill 提示。"}</p>
                    </article>
                  ))}
                </div>
              ) : <div className={styles.empty}>当前没有 Agent 训练覆盖记录。</div>}
            </div>
          </section>
        </>
      ) : <div className={styles.empty}>{loaded ? "读取成功，当前没有训练概览数据。" : "训练概览尚未成功读取，当前状态未确认。"}</div>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <div className={styles.summaryCard}><span>{label}</span><strong>{typeof value === "number" ? value : "—"}</strong></div>;
}

function formatScore(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "未知";
  return `${Math.round(value * 100)}%`;
}

export function buildTrainingKnowledgeAcceptance(entries: TrainingKnowledgeEntry[]) {
  const rows = Array.isArray(entries) ? entries : [];
  const topTags = [...countValues(rows.flatMap((entry) => normalizeTags(entry.tags))).entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"))
    .slice(0, 8);
  const agentIds = new Set(
    rows
      .map((entry) => entry.agentId || entry.agentKey || "agent_general")
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  return {
    total: rows.length,
    starterCount: rows.filter((entry) => entry.sourceType === "starter_knowledge").length,
    customCount: rows.filter((entry) => entry.sourceType !== "starter_knowledge").length,
    tagCount: topTags.length,
    agentCount: agentIds.size,
    topTags,
    latestEntries: rows.slice(0, 8),
  };
}

function normalizeTags(tags?: string[]) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

function countValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

function knowledgeSourceLabel(sourceType?: string) {
  if (sourceType === "starter_knowledge") return "内置 SOP";
  if (sourceType === "chat_import") return "聊天沉淀";
  if (sourceType === "route_correction") return "纠错沉淀";
  return "自定义知识";
}
