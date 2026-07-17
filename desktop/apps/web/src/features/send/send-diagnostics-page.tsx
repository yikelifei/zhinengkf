"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Camera, Inbox, RefreshCw, ScanSearch } from "lucide-react";
import {
  captureWindowObserverOnce,
  getBridgeOutbox,
  getBridgeStatus,
  getSendAdapter,
  getSendAttempts,
  getSendTasks,
  getWechatWindowSnapshots,
  getWindowObserverStatus,
  scanBridgeInbox,
  scanSendOperations,
  scanWindowSnapshotInbox,
  type BridgeOutboxResult,
  type BridgeStatusResult,
  type IdentityFilters,
  type SendAdapterInfo,
  type SendAttempt,
  type SendTask,
  type WechatWindowSnapshot,
  type WindowObserverStatus,
} from "../../lib/api";
import { SendConfirmation } from "./send-task-card";
import { SendEmpty, SendNotice, SendPageFrame, errorMessage } from "./send-page-frame";
import { sendStatusLabel } from "./send-policy";
import styles from "./send-pages.module.css";

type DiagnosticOperation = "capture-window" | "scan-window-inbox" | "scan-bridge-inbox" | "scan-operations" | "";

export type SendDiagnosticsPageProps = {
  filters?: IdentityFilters;
};

export function SendDiagnosticsPage({ filters = {} }: SendDiagnosticsPageProps) {
  const [tasks, setTasks] = useState<SendTask[]>([]);
  const [attempts, setAttempts] = useState<SendAttempt[]>([]);
  const [adapter, setAdapter] = useState<SendAdapterInfo | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusResult | null>(null);
  const [bridgeOutbox, setBridgeOutbox] = useState<BridgeOutboxResult | null>(null);
  const [observer, setObserver] = useState<WindowObserverStatus | null>(null);
  const [snapshots, setSnapshots] = useState<WechatWindowSnapshot[]>([]);
  const [busy, setBusy] = useState(true);
  const [operation, setOperation] = useState<DiagnosticOperation>("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [scanConfirmation, setScanConfirmation] = useState(false);
  const requestSequence = useRef(0);
  const accountFilter = filters.wechatAccountId;
  const conversationFilter = filters.conversationId;
  const customerFilter = filters.customerId;

  const refreshDiagnostics = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    const scopedFilters = { wechatAccountId: accountFilter, conversationId: conversationFilter, customerId: customerFilter };
    const results = await Promise.allSettled([
      getSendTasks(scopedFilters),
      getSendAttempts(undefined, scopedFilters),
      getSendAdapter(),
      getBridgeStatus(scopedFilters),
      getBridgeOutbox(scopedFilters),
      getWindowObserverStatus(),
      getWechatWindowSnapshots(scopedFilters),
    ] as const);
    if (sequence !== requestSequence.current) return;

    const errors: string[] = [];
    if (results[0].status === "fulfilled") setTasks(results[0].value); else errors.push(errorMessage(results[0].reason, "发送任务读取失败"));
    if (results[1].status === "fulfilled") setAttempts(results[1].value); else errors.push(errorMessage(results[1].reason, "发送尝试读取失败"));
    if (results[2].status === "fulfilled") setAdapter(results[2].value); else errors.push(errorMessage(results[2].reason, "发送适配器读取失败"));
    if (results[3].status === "fulfilled") setBridgeStatus(results[3].value); else errors.push(errorMessage(results[3].reason, "桥接状态读取失败"));
    if (results[4].status === "fulfilled") setBridgeOutbox(results[4].value); else errors.push(errorMessage(results[4].reason, "桥接发件箱读取失败"));
    if (results[5].status === "fulfilled") setObserver(results[5].value); else errors.push(errorMessage(results[5].reason, "窗口观察器读取失败"));
    if (results[6].status === "fulfilled") setSnapshots(results[6].value); else errors.push(errorMessage(results[6].reason, "窗口快照读取失败"));
    setError(errors.join("；"));
    setBusy(false);
  }, [accountFilter, conversationFilter, customerFilter]);

  useEffect(() => {
    void refreshDiagnostics();
    return () => { requestSequence.current += 1; };
  }, [refreshDiagnostics]);

  async function runDiagnostic(kind: DiagnosticOperation, action: () => Promise<string>) {
    if (operation) return;
    setOperation(kind);
    setError("");
    setFeedback("");
    try {
      setFeedback(await action());
      await refreshDiagnostics();
    } catch (operationError) {
      setError(errorMessage(operationError, "运行诊断操作失败"));
    } finally {
      setOperation("");
    }
  }

  async function captureWindow() {
    await runDiagnostic("capture-window", async () => {
      const result = await captureWindowObserverOnce();
      return `当前窗口采集完成：入库处理 ${result.scan.processed.length}，失败 ${result.scan.failed.length}。`;
    });
  }

  async function scanWindowInbox() {
    await runDiagnostic("scan-window-inbox", async () => {
      const result = await scanWindowSnapshotInbox();
      return `窗口快照收件箱扫描完成：处理 ${result.processed.length}，失败 ${result.failed.length}。`;
    });
  }

  async function scanBridgeAckInbox() {
    await runDiagnostic("scan-bridge-inbox", async () => {
      const result = await scanBridgeInbox();
      return `桥接回执扫描完成：处理 ${result.processed.length}，失败 ${result.failed.length}。`;
    });
  }

  async function confirmOperationsScan() {
    if (!scanConfirmation) return;
    setScanConfirmation(false);
    await runDiagnostic("scan-operations", async () => {
      const result = await scanSendOperations({
        wechatAccountId: accountFilter,
        conversationId: conversationFilter,
        customerId: customerFilter,
      });
      return `发送异常扫描完成：扫描 ${result.scanned}，桥接超时 ${result.bridgeTimedOut}，队列滞留 ${result.staleQueued}，已告警 ${result.alerted}。`;
    });
  }

  const operationBusy = Boolean(operation);
  const failedAttempts = attempts.filter((attempt) => ["failed", "blocked", "uncertain", "unknown"].includes(attempt.status)).length;
  const uncertainTasks = tasks.filter((task) => task.status === "uncertain" || ["uncertain", "unknown"].includes(String(task.latestAttempt?.status || ""))).length;

  return (
    <SendPageFrame
      id="send-diagnostics-page"
      title="发送运行诊断"
      description="只查看真实适配器、桥接、窗口和回执证据，并提供受控扫描操作。"
      icon={<Activity size={20} />}
      busy={busy || operationBusy}
      actions={(
        <button
          type="button"
          data-action-id="send.diagnostics.refresh"
          aria-label="刷新发送运行诊断"
          onClick={() => void refreshDiagnostics()}
          disabled={busy || operationBusy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新诊断
        </button>
      )}
    >
      {error ? <SendNotice tone="error" title="部分诊断来源不可用">{error}</SendNotice> : null}
      {feedback ? <SendNotice tone="success" title="诊断操作已完成">{feedback}</SendNotice> : null}
      {uncertainTasks ? (
        <SendNotice tone="warning" title={`${uncertainTasks} 个任务投递状态不确定`}>
          不确定任务必须先核对桥接回执；队列页和拦截页不会提供自动重试、取消或再次执行。
        </SendNotice>
      ) : null}
      {scanConfirmation ? (
        <SendConfirmation
          actionIdPrefix="send.diagnostics.scan-operations"
          title="确认扫描发送异常"
          detail="扫描可能依据真实回执与超时规则更新任务阻断和告警状态，但不会创建任务或主动发送消息。"
          confirmLabel="确认扫描发送异常"
          busy={operationBusy}
          onConfirm={() => void confirmOperationsScan()}
          onCancel={() => setScanConfirmation(false)}
        />
      ) : null}

      <dl className={styles.metricGrid} aria-label="发送运行诊断摘要">
        <Metric label="发送任务" value={tasks.length} />
        <Metric label="异常尝试" value={failedAttempts} />
        <Metric label="桥接待发" value={bridgeStatus?.outbox.pendingCount ?? bridgeOutbox?.pending.length ?? 0} />
        <Metric label="不确定投递" value={uncertainTasks} />
      </dl>

      <section className={styles.panel} aria-labelledby="send-diagnostics-actions-title">
        <header className={styles.panelHeader}>
          <div><h2 id="send-diagnostics-actions-title">受控运行操作</h2><p>不提供错误窗口、失败回执或超时故障注入。</p></div>
        </header>
        <div className={styles.toolbar}>
          <button
            type="button"
            data-action-id="send.diagnostics.capture-window"
            aria-label="采集当前真实微信窗口用于发送诊断"
            onClick={() => void captureWindow()}
            disabled={busy || operationBusy}
          >
            <Camera size={15} aria-hidden="true" /> {operation === "capture-window" ? "采集中" : "采集当前窗口"}
          </button>
          <button
            type="button"
            data-action-id="send.diagnostics.scan-window-inbox"
            aria-label="扫描真实窗口快照收件箱"
            onClick={() => void scanWindowInbox()}
            disabled={busy || operationBusy}
          >
            <Inbox size={15} aria-hidden="true" /> {operation === "scan-window-inbox" ? "扫描中" : "扫描窗口快照"}
          </button>
          <button
            type="button"
            data-action-id="send.diagnostics.scan-bridge-inbox"
            aria-label="扫描真实微信桥接回执收件箱"
            onClick={() => void scanBridgeAckInbox()}
            disabled={busy || operationBusy}
          >
            <Inbox size={15} aria-hidden="true" /> {operation === "scan-bridge-inbox" ? "扫描中" : "扫描桥接回执"}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="send.diagnostics.request-scan-operations"
            aria-label="请求扫描真实发送异常"
            onClick={() => setScanConfirmation(true)}
            disabled={busy || operationBusy}
          >
            <ScanSearch size={15} aria-hidden="true" /> 扫描发送异常
          </button>
        </div>
      </section>

      <div className={styles.runtimeGrid}>
        <RuntimeCard
          title="发送适配器"
          status={adapter?.realSend ? "真实发送已启用" : "真实发送未启用"}
          ok={Boolean(adapter?.realSend)}
          detail={adapter?.description || "未取得发送适配器配置。"}
          rows={[
            ["适配器", adapter?.label || adapter?.name || "未连接"],
            ["窗口守卫", adapter?.capabilities?.requiresWindowGuard ? "必须" : "未声明"],
          ]}
        />
        <RuntimeCard
          title="桥接 Worker"
          status={bridgeStatus?.worker?.ok ? "运行正常" : "需检查"}
          ok={Boolean(bridgeStatus?.worker?.ok)}
          detail={bridgeStatus?.worker?.errorMessage || bridgeStatus?.worker?.message || "等待真实 Worker 状态。"}
          rows={[
            ["状态", bridgeStatus?.worker?.status || "未知"],
            ["最后更新", bridgeStatus?.worker?.ageSeconds == null ? "未知" : `${bridgeStatus.worker.ageSeconds} 秒前`],
            ["待回执", bridgeStatus?.inbox.pendingCount ?? 0],
            ["账号锁", bridgeStatus?.locks.activeCount ?? 0],
          ]}
        />
        <RuntimeCard
          title="窗口观察器"
          status={observer?.ok ? "运行正常" : "需检查"}
          ok={Boolean(observer?.ok)}
          detail={observer?.errorMessage || observer?.message || "等待真实观察器状态。"}
          rows={[
            ["状态", observer?.status || "未知"],
            ["最后更新", observer?.ageSeconds == null ? "未知" : `${observer.ageSeconds} 秒前`],
            ["识别账号", observer?.result?.wechatAccountId || "未识别"],
            ["置信度", observer?.result?.confidence ?? "未提供"],
          ]}
        />
        <RuntimeCard
          title="桥接发件箱"
          status={(bridgeStatus?.outbox.pendingCount ?? 0) > 0 ? "等待 Worker 处理" : "当前无待发"}
          ok={(bridgeStatus?.locks.staleCount ?? 0) === 0 && (bridgeStatus?.dispatch?.staleCount ?? 0) === 0}
          detail="只展示真实发件箱、调度和锁状态，不生成故障记录。"
          rows={[
            ["待发", bridgeStatus?.outbox.pendingCount ?? bridgeOutbox?.pending.length ?? 0],
            ["已忽略", bridgeStatus?.outbox.ignoredCount ?? bridgeOutbox?.ignored.length ?? 0],
            ["待调度回执", bridgeStatus?.dispatch?.pendingCount ?? 0],
            ["过期调度", bridgeStatus?.dispatch?.staleCount ?? 0],
          ]}
        />
      </div>

      <div className={styles.runtimeGrid}>
        <section className={styles.runtimeCard} aria-labelledby="recent-send-attempts-title">
          <header className={styles.runtimeHeader}><div><h2 id="recent-send-attempts-title">最近发送尝试</h2><p>用于核对任务、适配器和回执状态。</p></div></header>
          {attempts.length ? (
            <ul className={styles.attemptList}>
              {attempts.slice(0, 10).map((attempt) => (
                <li key={attempt.id}>
                  <span><strong>{attempt.sendTaskId}</strong><small>{attempt.adapter} · {formatTime(attempt.createdAt)}</small></span>
                  <span className={["failed", "blocked", "uncertain", "unknown"].includes(attempt.status) ? styles.failedText : styles.passedText}>{attempt.status}</span>
                </li>
              ))}
            </ul>
          ) : <SendEmpty title="暂无发送尝试" detail="真实发送任务执行后会在这里显示审计记录。" />}
        </section>
        <section className={styles.runtimeCard} aria-labelledby="recent-window-evidence-title">
          <header className={styles.runtimeHeader}><div><h2 id="recent-window-evidence-title">最近窗口证据</h2><p>发送前身份校验使用的真实快照。</p></div></header>
          {snapshots.length ? (
            <ul className={styles.runtimeList}>
              {snapshots.slice(0, 10).map((snapshot) => (
                <li key={snapshot.id}>
                  <span><strong>{snapshot.accountDisplayName || snapshot.wechatAccountId || "账号未识别"}</strong><small>{snapshot.activeChatTitle || snapshot.chatTitle || "聊天对象未识别"} · {formatTime(snapshot.capturedAt)}</small></span>
                  <span className={snapshot.isOnline ? styles.passedText : styles.failedText}>{snapshot.isOnline ? "在线" : "离线"}</span>
                </li>
              ))}
            </ul>
          ) : <SendEmpty title="暂无窗口证据" detail="采集当前真实微信窗口后再进行任务校验。" />}
        </section>
      </div>
    </SendPageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.metricCard}><dt>{label}</dt><dd>{value}</dd></div>;
}

function RuntimeCard({
  title,
  status,
  ok,
  detail,
  rows,
}: {
  title: string;
  status: string;
  ok: boolean;
  detail: string;
  rows: Array<[string, string | number]>;
}) {
  const titleId = `runtime-${title.replace(/\s+/g, "-")}`;
  return (
    <section className={styles.runtimeCard} aria-labelledby={titleId}>
      <header className={styles.runtimeHeader}>
        <div><h2 id={titleId}>{title}</h2><p>{detail}</p></div>
        <span className={`${styles.statusBadge} ${ok ? styles.statusSuccess : styles.statusDanger}`}>{status}</span>
      </header>
      <ul className={styles.runtimeList}>
        {rows.map(([label, value]) => <li key={label}><span>{label}</span><strong>{value}</strong></li>)}
      </ul>
    </section>
  );
}

function formatTime(value?: string | null) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
