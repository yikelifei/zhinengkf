"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, ShieldCheck, X } from "lucide-react";
import {
  executeAgentSkill,
  type Agent,
  type AgentSkillExecutionResult,
  type IdentityFilters,
} from "../../lib/api";
import { createClientOperationKey } from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import { useOperatorCapability } from "../access/use-operator-capability";
import { trainingHref } from "../training/training-identity-navigation";
import { useAgentsDirectory } from "./use-agents-directory";

export function AgentDetailPage({ agentId, identityFilters }: { agentId: string; identityFilters?: IdentityFilters }) {
  const { agents, readState, busy, error, refresh: refreshDirectory } = useAgentsDirectory(identityFilters);
  const executionAccess = useOperatorCapability("execute_agent_skills");
  const [confirmingSkillId, setConfirmingSkillId] = useState<string | null>(null);
  const [executingSkillId, setExecutingSkillId] = useState<string | null>(null);
  const [executionStates, setExecutionStates] = useState<Record<string, {
    result?: AgentSkillExecutionResult;
    error?: string;
  }>>({});
  const agent = agents.find((item) => item.id === agentId) || null;
  const trainingScope = agent ? { ...identityFilters, agentId: agent.id } : identityFilters;
  const missing = !busy && readState === "ready" && !agent;
  const executionAllowed = readState === "ready" && executionAccess.readState === "ready" && executionAccess.allowed;

  async function runSkill(skill: AgentSkill) {
    if (!agent || !executionAllowed || !skill.executionPolicy?.canExecute || executingSkillId) return;
    setExecutingSkillId(skill.id);
    setExecutionStates((current) => ({
      ...current,
      [skill.id]: {},
    }));
    try {
      const result = await executeAgentSkill(agent.id, skill.id, {
        operationKey: createClientOperationKey("agent-skill"),
        confirmation: skill.executionPolicy.confirmationText,
        ...identityFilters,
      });
      setExecutionStates((current) => ({
        ...current,
        [skill.id]: { result },
      }));
      setConfirmingSkillId(null);
    } catch (executionError) {
      setExecutionStates((current) => ({
        ...current,
        [skill.id]: {
          error: executionError instanceof Error
            ? executionError.message
            : "安全执行失败，请检查服务状态后重试。",
        },
      }));
    } finally {
      setExecutingSkillId(null);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="agent-detail-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="agent-detail-title">{agent?.name || "智能体详情"}</h1>
          <p className={styles.description}>只查看一个智能体的职责、训练覆盖和技能状态。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href={trainingHref("/agents", identityFilters)}>返回目录</Link>
          <button type="button" className={styles.button} data-action-id="agent-detail-refresh" onClick={() => void Promise.all([refreshDirectory(), executionAccess.refresh()])} disabled={busy || executionAccess.busy}>刷新详情</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {executionAccess.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">执行权限未确认：{executionAccess.error}</div> : null}
      {executionAccess.readState === "ready" && !executionAccess.allowed ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">当前可信操作员未获 execute_agent_skills 权限；可以查看指令，但执行入口保持禁用。</div> : null}
      {readState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">当前详情来自同一身份范围内上次成功读取的旧目录；刷新成功前技能执行保持禁用。</div> : null}
      {missing ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">目录读取成功，但地址中的智能体不存在，未回退展示其他记录。</div> : null}

      {agent ? (
        <>
          <dl className={styles.definitionList}>
            <div><dt>运行状态</dt><dd>{agent.enabled ? "已启用" : "已停用"}</dd></div>
            <div><dt>职责场景</dt><dd>{agent.scene || "未配置"}</dd></div>
            <div><dt>训练样本</dt><dd>{agent.trainingSampleCount}</dd></div>
          </dl>
          <section className={styles.panel} aria-labelledby="agent-training-handoff-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="agent-training-handoff-title">训练运营</h2>
                <p>按当前 Agent 打开导入、复核和技能建议流程。</p>
              </div>
            </header>
            <div className={styles.buttonRow}>
              <Link className={styles.button} href={trainingHref("/training/overview", trainingScope)} data-action-id="agent-detail-open-training-overview">训练概览</Link>
              <Link className={styles.button} href={trainingHref("/training/import", trainingScope)} data-action-id="agent-detail-open-training-import">导入样本</Link>
              <Link className={styles.button} href={trainingHref("/training/review", trainingScope)} data-action-id="agent-detail-open-training-review">复核样本</Link>
              <Link className={styles.button} href={trainingHref("/training/skills", trainingScope)} data-action-id="agent-detail-open-training-skills">技能建议</Link>
            </div>
          </section>
          <section className={styles.panel} aria-labelledby="agent-skills-title">
            <header className={styles.panelHeader}><div><h2 id="agent-skills-title">Agent Skill 指令</h2><p>{agent.description || "服务端未提供职责说明。"}</p></div></header>
            <div className={styles.panelBody}>
              {agent.skills.length ? <div className={styles.recordList}>{agent.skills.map((skill) => (
                <article className={styles.record} key={skill.id}>
                  <div className={styles.recordHeader}><div><h3>{skill.name}</h3><p>{skill.scope?.label || "未标注技能范围"}</p></div><span className={`${styles.badge} ${skill.enabled ? styles.toneOk : styles.toneMuted}`}>{skill.enabled ? "已启用" : "已停用"}</span></div>
                  <pre className={styles.codeBlock}>{skill.description || "服务端未提供 Skill 指令正文。"}</pre>
                  <div className={styles.recordMeta}>
                    <span>证据样本 {formatSkillNumber(skill.sampleCount)}</span>
                    <span>置信度 {formatSkillScore(skill.confidence)}</span>
                    <span>版本 v{formatSkillNumber(skill.version || 1)}</span>
                    <span>{skillSourceLabel(skill.sourceType)}</span>
                  </div>
                  <p className={styles.helpText}>{skill.scope?.reason || "这条 Skill 会在该 Agent 生成回复草稿时作为话术指令被读取，用来让回复更像真人客服。"}</p>
                  {skill.executionPolicy ? (
                    <>
                      <div className={styles.recordMeta}>
                        <span>动作：{skill.executionPolicy.label}</span>
                        <span>风险：只读</span>
                        <span>副作用：无</span>
                        <span>回滚：无需回滚</span>
                      </div>
                      <div className={styles.buttonRow}>
                        <button
                          type="button"
                          className={styles.button}
                          data-action-id={`agent-skill-execute-${skill.id}`}
                          title={skill.executionPolicy.description}
                          disabled={!executionAllowed || !skill.executionPolicy.canExecute || Boolean(executingSkillId)}
                          onClick={() => setConfirmingSkillId(skill.id)}
                        >
                          <ShieldCheck aria-hidden="true" size={16} />
                          安全执行
                        </button>
                      </div>
                      {confirmingSkillId === skill.id ? (
                        <div className={styles.confirmation} role="alert">
                          <strong>确认执行“{skill.executionPolicy.label}”</strong>
                          <p>{skill.executionPolicy.description}</p>
                          <p>系统只允许服务端固定白名单动作，不接收命令、脚本、文件路径或任意参数。</p>
                          <div className={styles.buttonRow}>
                            <button
                              type="button"
                              className={styles.primaryButton}
                              data-action-id={`agent-skill-confirm-${skill.id}`}
                              disabled={!executionAllowed || executingSkillId === skill.id}
                              onClick={() => void runSkill(skill)}
                            >
                              <Play aria-hidden="true" size={16} />
                              {executingSkillId === skill.id ? "执行中" : "确认执行"}
                            </button>
                            <button
                              type="button"
                              className={styles.button}
                              data-action-id={`agent-skill-cancel-${skill.id}`}
                              disabled={executingSkillId === skill.id}
                              onClick={() => setConfirmingSkillId(null)}
                            >
                              <X aria-hidden="true" size={16} />
                              取消
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {executionStates[skill.id]?.error ? (
                        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
                          {executionStates[skill.id].error}
                        </div>
                      ) : null}
                      {executionStates[skill.id]?.result ? (
                        <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">
                          <strong>执行完成，审计编号 {executionStates[skill.id].result?.executionId}</strong>
                          <pre className={styles.codeBlock}>
                            {formatExecutionResult(executionStates[skill.id].result?.result)}
                          </pre>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </article>
              ))}</div> : <div className={styles.empty}>尚未配置技能。</div>}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

type AgentSkill = Agent["skills"][number];

function formatSkillNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatSkillScore(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(0);
}

function skillSourceLabel(sourceType?: AgentSkill["sourceType"]) {
  if (sourceType === "training_compiler") return "训练沉淀";
  if (sourceType === "manual") return "人工维护";
  return "内置 Skill";
}

function formatExecutionResult(result?: Record<string, unknown>) {
  if (!result) return "未返回结果。";
  return Object.entries(result)
    .map(([key, value]) => `${executionResultLabel(key)}：${formatExecutionValue(value)}`)
    .join("\n");
}

function executionResultLabel(key: string) {
  const labels: Record<string, string> = {
    healthy: "连接正常",
    adapter: "连接方式",
    service: "服务",
    version: "版本",
    localGenerateEnabled: "本地生成接口",
    total: "商品总数",
    readyCount: "可用商品",
    issueCount: "问题总数",
    errorCount: "错误",
    warningCount: "提醒",
    missingImageCount: "缺图",
    lowStockCount: "低库存",
    blockingRepairCount: "阻断项",
    ready: "自动化就绪",
    tone: "状态",
    summary: "说明",
    blockerCount: "阻断项",
    blockers: "阻断明细",
    warnings: "提醒明细",
    agentId: "Agent 编号",
    agentName: "Agent",
    skillId: "Skill 编号",
    skillName: "Skill",
    instruction: "指令",
  };
  return labels[key] || key;
}

function formatExecutionValue(value: unknown) {
  if (value === true) return "是";
  if (value === false) return "否";
  if (value === null || value === undefined || value === "") return "未提供";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
