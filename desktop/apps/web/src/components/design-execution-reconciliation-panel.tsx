"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import type {
  DesignExecutionAvailableResolution,
  DesignPlatformExecutionView,
} from "../lib/api";
import styles from "./design-execution-reconciliation-panel.module.css";

export const DESIGN_EXECUTION_RESOLUTIONS = {
  unknown: "confirmed_not_generated_refunded",
  refund: "confirmed_refunded",
} as const;

type DesignExecutionReconciliationPanelProps = {
  executions: readonly DesignPlatformExecutionView[];
  loading: boolean;
  loaded?: boolean;
  error?: string;
  accessLoaded?: boolean;
  accessError?: string;
  canManageExecutions: boolean;
  onRefresh: () => Promise<void>;
  onResolveUnknown: (executionId: string) => Promise<void>;
  onResolveRefund: (executionId: string) => Promise<void>;
};

type PendingResolution = {
  executionId: string;
  resolution: Exclude<DesignExecutionAvailableResolution, null>;
};

export function DesignExecutionReconciliationPanel({
  executions,
  loading,
  loaded = true,
  error,
  accessLoaded = true,
  accessError,
  canManageExecutions,
  onRefresh,
  onResolveUnknown,
  onResolveRefund,
}: DesignExecutionReconciliationPanelProps) {
  const [pending, setPending] = useState<PendingResolution | null>(null);
  const [submittingId, setSubmittingId] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const submitLock = useRef(false);

  async function confirmResolution() {
    if (!pending || submitLock.current || submittingId || !canManageExecutions) return;
    submitLock.current = true;
    setSubmittingId(pending.executionId);
    setActionError("");
    setNotice("");
    let resolutionSaved = false;
    try {
      if (pending.resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown) {
        await onResolveUnknown(pending.executionId);
      } else if (pending.resolution === DESIGN_EXECUTION_RESOLUTIONS.refund) {
        await onResolveRefund(pending.executionId);
      } else {
        throw new Error("服务端未提供受支持的核销动作，已拒绝提交。");
      }
      resolutionSaved = true;
      setPending(null);
      await onRefresh();
      setNotice("人工核销已保存，执行记录已刷新。");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "人工核销失败";
      setActionError(resolutionSaved ? `核销已保存，但刷新失败：${detail}` : detail);
    } finally {
      submitLock.current = false;
      setSubmittingId("");
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="design-execution-reconciliation-title">
      <header className={styles.header}>
        <div>
          <h2 id="design-execution-reconciliation-title">设计执行人工核销</h2>
          <p>仅展示服务端脱敏摘要；核销只解除重试阻塞，不会自动重新生成。</p>
        </div>
        <button
          type="button"
          disabled={loading || Boolean(submittingId)}
          onClick={() => { void onRefresh().catch(() => undefined); }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {loading ? "读取中" : "刷新执行记录"}
        </button>
      </header>

      {!accessLoaded ? (
        <div className={styles.warning} role="status">
          <ShieldCheck size={18} aria-hidden="true" />
          执行管理权限尚未成功读取，核销操作保持禁用。
        </div>
      ) : !canManageExecutions ? (
        <div className={styles.warning} role="status">
          <ShieldCheck size={18} aria-hidden="true" />
          当前会话没有 manage_design_executions 能力，仅可查看执行摘要。
        </div>
      ) : null}
      {error || actionError ? <div className={styles.error} role="alert">{actionError || error}</div> : null}
      {accessError ? <div className={styles.error} role="alert">{accessError}</div> : null}
      {notice ? <div className={styles.success} role="status"><CheckCircle2 size={16} aria-hidden="true" />{notice}</div> : null}

      {loading && !executions.length ? <p className={styles.empty}>正在读取执行记录…</p> : null}
      {!loading && !executions.length ? <p className={styles.empty}>{loaded && !error ? "读取成功，当前任务没有持久化执行记录。" : "执行记录尚未成功读取，不能据此认定没有执行记录。"}</p> : null}

      {executions.length ? (
        <ol className={styles.executionList} aria-label="设计平台执行记录">
          {executions.map((execution) => {
            const action = resolutionAction(execution.availableResolution);
            const isSubmitting = submittingId === execution.id;
            return (
              <li className={styles.executionCard} key={execution.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <strong>第 {execution.attemptNo} 次执行</strong>
                    <span>记录 …{execution.id.slice(-8)}</span>
                  </div>
                  <span className={styles.status}>{statusLabel(execution.status)}</span>
                </div>
                <dl className={styles.facts}>
                  <div><dt>验收</dt><dd>{acceptanceLabel(execution.acceptanceStatus)}</dd></div>
                  <div><dt>退款</dt><dd>{refundLabel(execution.refundStatus)}</dd></div>
                  <div><dt>结果图</dt><dd>{execution.imageCount} 张</dd></div>
                  <div><dt>更新时间</dt><dd>{formatDate(execution.updatedAt)}</dd></div>
                  <div><dt>错误摘要</dt><dd>{errorSummary(execution.errorCategory, execution.responseHttpStatus)}</dd></div>
                  <div><dt>核销状态</dt><dd>{execution.resolvedAt ? `已核销 ${formatDate(execution.resolvedAt)}` : "未核销"}</dd></div>
                </dl>
                {action ? (
                  <button
                    className={styles.resolveButton}
                    type="button"
                    disabled={!canManageExecutions || Boolean(submittingId)}
                    onClick={() => {
                      setActionError("");
                      setNotice("");
                      setPending({ executionId: execution.id, resolution: action.resolution });
                    }}
                  >
                    <AlertTriangle size={15} aria-hidden="true" />
                    {isSubmitting ? "提交中" : action.label}
                  </button>
                ) : (
                  <p className={styles.noAction}>服务端未开放核销动作。</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      {pending ? (
        <div className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="execution-resolution-confirm-title">
          <AlertTriangle size={22} aria-hidden="true" />
          <div>
            <h3 id="execution-resolution-confirm-title">请二次确认线下核对结果</h3>
            <p>{confirmationText(pending.resolution)}</p>
            <p>该动作会写入可信操作员身份；页面不会提交 reviewer 字段，也不会自动重试或生成。</p>
            <div className={styles.confirmActions}>
              <button type="button" disabled={Boolean(submittingId)} onClick={() => setPending(null)}>返回检查</button>
              <button className={styles.dangerButton} type="button" disabled={Boolean(submittingId)} onClick={() => void confirmResolution()}>
                {submittingId ? "正在提交" : "确认已核对并提交"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function resolutionAction(resolution: DesignExecutionAvailableResolution) {
  if (resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown) {
    return { resolution, label: "确认未生成且已退款" };
  }
  if (resolution === DESIGN_EXECUTION_RESOLUTIONS.refund) {
    return { resolution, label: "确认退款已到账" };
  }
  return null;
}

function confirmationText(resolution: PendingResolution["resolution"]) {
  return resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown
    ? "只有在线下确认本次没有生成任何结果、且退款已经到账后，才能提交。"
    : "只有在线下确认本次失败执行的退款已经到账后，才能提交。";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    prepared: "已准备",
    dispatching: "派发中",
    generating: "生成中",
    completed: "已完成",
    explicit_failed: "明确失败",
    outcome_unknown: "结果不确定",
    cancel_requested: "取消处理中",
    cancelled: "已取消",
  };
  return labels[status] || "未知状态（原值已隐藏）";
}

function acceptanceLabel(status: string) {
  return ({ pending: "待验收", accepting: "验收中", accepted: "已验收", manual_review: "人工复核", rejected: "已拒绝" } as Record<string, string>)[status]
    || "未知";
}

function refundLabel(status: string) {
  return ({ pending: "处理中", refunded: "已退款", not_required: "无需退款", failed: "退款失败", unknown: "退款不确定", credit_bypass: "未扣减" } as Record<string, string>)[status]
    || "未知";
}

function errorSummary(category: string | null, httpStatus: number | null) {
  if (!category && !httpStatus) return "无";
  const labels: Record<string, string> = {
    explicit_remote_failure: "远端明确失败",
    local_pre_dispatch_failure: "本地派发前失败",
    timeout_unknown: "请求超时，结果不确定",
    connection_reset_unknown: "连接中断，结果不确定",
    remote_acceptance_unknown: "远端接收结果不确定",
    transport_outcome_unknown: "传输结果不确定",
    acceptance_failure: "本地验收失败",
  };
  const categoryText = category ? labels[category] || "其他错误（原值已隐藏）" : "未分类错误";
  return httpStatus ? `${categoryText} · HTTP ${httpStatus}` : categoryText;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "时间未知";
}
