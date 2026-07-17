"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Save, UserRoundCheck } from "lucide-react";
import styles from "./conversation-operations-panel.module.css";

export type ConversationPriority = "low" | "normal" | "high" | "urgent";
export type ConversationLifecycleStatus = "open" | "pending" | "resolved" | "closed";
export type ConversationSlaState = "no_sla" | "on_track" | "overdue" | "closed" | "invalid";

export type ConversationOperationsView = {
  assignee: string | null;
  assignmentState: "assigned" | "unassigned";
  priority: ConversationPriority;
  status: ConversationLifecycleStatus;
  slaDueAt: string | null;
  firstResponseDueAt: string | null;
  firstResponseAt: string | null;
  firstResponseBreached: boolean;
  slaOverdue: boolean;
  firstResponseOverdue: boolean;
  isOverdue: boolean;
  slaState: ConversationSlaState;
  configurationIssues?: string[];
};

export type ConversationOperationsPatch = {
  assignee?: string | null;
  priority?: ConversationPriority;
  status?: ConversationLifecycleStatus;
  slaDueAt?: string | null;
  firstResponseDueAt?: string | null;
};

type ConversationOperationsPanelProps = {
  conversationTitle?: string;
  operations: ConversationOperationsView | null;
  currentOperator: string;
  busy?: boolean;
  error?: string;
  onSave: (patch: ConversationOperationsPatch) => Promise<void> | void;
};

const priorityOptions: Array<{ value: ConversationPriority; label: string }> = [
  { value: "low", label: "低" },
  { value: "normal", label: "普通" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
];

const lifecycleOptions: Array<{ value: ConversationLifecycleStatus; label: string }> = [
  { value: "open", label: "待处理" },
  { value: "pending", label: "等待客户" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
];

export function ConversationOperationsPanel({
  conversationTitle,
  operations,
  currentOperator,
  busy = false,
  error,
  onSave,
}: ConversationOperationsPanelProps) {
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<ConversationPriority>("normal");
  const [status, setStatus] = useState<ConversationLifecycleStatus>("open");
  const [slaDueAt, setSlaDueAt] = useState("");
  const [firstResponseDueAt, setFirstResponseDueAt] = useState("");

  useEffect(() => {
    setAssignee(operations?.assignee || "");
    setPriority(operations?.priority || "normal");
    setStatus(operations?.status || "open");
    setSlaDueAt(toLocalDateTime(operations?.slaDueAt));
    setFirstResponseDueAt(toLocalDateTime(operations?.firstResponseDueAt));
  }, [operations]);

  const changed = useMemo(() => {
    if (!operations) return false;
    return (
      assignee.trim() !== (operations.assignee || "") ||
      priority !== operations.priority ||
      status !== operations.status ||
      slaDueAt !== toLocalDateTime(operations.slaDueAt) ||
      firstResponseDueAt !== toLocalDateTime(operations.firstResponseDueAt)
    );
  }, [assignee, firstResponseDueAt, operations, priority, slaDueAt, status]);

  const state = operations ? slaStatePresentation(operations) : null;

  async function save() {
    if (!operations || !changed || busy) return;
    const patch: ConversationOperationsPatch = {};
    const nextAssignee = assignee.trim() || null;
    const nextSlaDueAt = fromLocalDateTime(slaDueAt);
    const nextFirstResponseDueAt = fromLocalDateTime(firstResponseDueAt);
    if (nextAssignee !== operations.assignee) patch.assignee = nextAssignee;
    if (priority !== operations.priority) patch.priority = priority;
    if (status !== operations.status) patch.status = status;
    if (slaDueAt !== toLocalDateTime(operations.slaDueAt)) patch.slaDueAt = nextSlaDueAt;
    if (firstResponseDueAt !== toLocalDateTime(operations.firstResponseDueAt)) {
      patch.firstResponseDueAt = nextFirstResponseDueAt;
    }
    await onSave(patch);
  }

  if (!operations) {
    return (
      <section className={styles.panel} aria-label="会话分配与服务时限">
        <div className={styles.header}>
          <div>
            <strong>会话分配与 SLA</strong>
            <span>选择客户会话后可设置负责人、优先级和处理时限。</span>
          </div>
        </div>
        <div className={styles.empty}>尚未载入会话运营状态。</div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="会话分配与服务时限">
      <div className={styles.header}>
        <div>
          <strong>会话分配与 SLA</strong>
          <span>{conversationTitle || "当前会话"}</span>
        </div>
        {state ? (
          <span className={`${styles.state} ${styles[state.tone]}`}>
            <state.Icon size={14} aria-hidden="true" />{state.label}
          </span>
        ) : null}
      </div>

      <div className={styles.assignmentRow}>
        <label>
          <span>接待客服</span>
          <input
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            placeholder="未分配"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className={styles.assignButton}
          onClick={() => setAssignee(currentOperator.trim())}
          disabled={busy || !currentOperator.trim()}
        >
          <UserRoundCheck size={15} aria-hidden="true" />分配给我
        </button>
      </div>

      <div className={styles.fieldGrid}>
        <label>
          <span>优先级</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value as ConversationPriority)} disabled={busy}>
            {priorityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>处理状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as ConversationLifecycleStatus)} disabled={busy}>
            {lifecycleOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>首次回复截止</span>
          <input type="datetime-local" value={firstResponseDueAt} onChange={(event) => setFirstResponseDueAt(event.target.value)} disabled={busy} />
        </label>
        <label>
          <span>会话处理截止</span>
          <input type="datetime-local" value={slaDueAt} onChange={(event) => setSlaDueAt(event.target.value)} disabled={busy} />
        </label>
      </div>

      <div className={styles.slaFacts}>
        <span><b>首次回复</b>{operations.firstResponseAt ? formatDateTime(operations.firstResponseAt) : "尚未回复"}</span>
        <span><b>时限状态</b>{state?.detail || "未设置"}</span>
      </div>

      {operations.configurationIssues?.length ? (
        <div className={styles.warning} role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          SLA 配置需要修复：{operations.configurationIssues.join("、")}
        </div>
      ) : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.footer}>
        <button type="button" className={styles.clearButton} onClick={() => setAssignee("")} disabled={busy || !assignee}>
          取消分配
        </button>
        <button type="button" className={styles.saveButton} onClick={() => void save()} disabled={busy || !changed}>
          <Save size={15} aria-hidden="true" />{busy ? "保存中" : "保存变更"}
        </button>
      </div>
    </section>
  );
}

function slaStatePresentation(operations: ConversationOperationsView) {
  if (operations.slaState === "invalid") {
    return { label: "配置异常", detail: "截止时间格式异常", tone: "danger", Icon: AlertTriangle } as const;
  }
  if (operations.slaState === "overdue") {
    const detail = operations.firstResponseOverdue ? "首次回复已超时" : "会话处理已超时";
    return { label: "已超时", detail, tone: "danger", Icon: AlertTriangle } as const;
  }
  if (operations.slaState === "closed") {
    return { label: "已完成", detail: "会话已解决或关闭", tone: "ready", Icon: CheckCircle2 } as const;
  }
  if (operations.slaState === "on_track") {
    return { label: "时限内", detail: "当前服务时限正常", tone: "ready", Icon: CheckCircle2 } as const;
  }
  return { label: "未设 SLA", detail: "尚未设置回复与处理截止时间", tone: "muted", Icon: Clock3 } as const;
}

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
