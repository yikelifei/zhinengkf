"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import {
  getBridgeOutbox,
  getBridgeStatus,
  getSendAdapter,
  getSendAttempts,
  getSendTasks,
  getWechatWindowSnapshots,
  getWindowObserverStatus,
  type BridgeOutboxResult,
  type BridgeStatusResult,
  type IdentityFilters,
  type SendAdapterInfo,
  type SendAttempt,
  type SendTask,
  type WechatWindowSnapshot,
  type WindowObserverStatus,
} from "../../lib/api";
import { SendEmpty, SendNotice, SendPageFrame, errorMessage } from "./send-page-frame";
import { sendStatusLabel } from "./send-policy";
import styles from "./send-pages.module.css";

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
  const [error, setError] = useState("");
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
    if (results[3].status === "fulfilled") setBridgeStatus(results[3].value); else errors.push(errorMessage(results[3].reason, "发送链路状态读取失败"));
    if (results[4].status === "fulfilled") setBridgeOutbox(results[4].value); else errors.push(errorMessage(results[4].reason, "发送发件箱读取失败"));
    if (results[5].status === "fulfilled") setObserver(results[5].value); else errors.push(errorMessage(results[5].reason, "身份校验观察器读取失败"));
    if (results[6].status === "fulfilled") setSnapshots(results[6].value); else errors.push(errorMessage(results[6].reason, "身份校验快照读取失败"));
    setError(errors.join("；"));
    setBusy(false);
  }, [accountFilter, conversationFilter, customerFilter]);

  useEffect(() => {
    void refreshDiagnostics();
    return () => { requestSequence.current += 1; };
  }, [refreshDiagnostics]);

  const failedAttempts = attempts.filter((attempt) => ["failed", "blocked", "uncertain", "unknown"].includes(attempt.status)).length;
  const uncertainTasks = tasks.filter((task) => task.status === "uncertain" || ["uncertain", "unknown"].includes(String(task.latestAttempt?.status || ""))).length;

  return (
    <SendPageFrame
      id="send-diagnostics-page"
      title="发送运行诊断"
      description="只查看真实发送适配器、发送任务、回执和身份校验证据；运行操作已移到独立页面。"
      icon={<Activity size={20} />}
      busy={busy}
      actions={(
        <>
          <Link className={styles.secondaryLink} href="/send/diagnostics/operations">运行诊断操作</Link>
          <button
            type="button"
            data-action-id="send.diagnostics.refresh"
            aria-label="刷新发送运行诊断"
            onClick={() => void refreshDiagnostics()}
            disabled={busy}
          >
            <RefreshCw size={15} aria-hidden="true" /> 刷新诊断
          </button>
        </>
      )}
    >
      {error ? <SendNotice tone="error" title="部分诊断来源不可用">{error}</SendNotice> : null}
      {uncertainTasks ? (
        <SendNotice tone="warning" title={`${uncertainTasks} 个任务投递状态不确定`}>
          不确定任务必须先核对企业微信发送回执；队列页和拦截页不会提供自动重试、取消或再次执行。
        </SendNotice>
      ) : null}

      <dl className={styles.metricGrid} aria-label="发送运行诊断摘要">
        <Metric label="发送任务" value={tasks.length} />
        <Metric label="异常尝试" value={failedAttempts} />
        <Metric label="待发任务" value={bridgeStatus?.outbox.pendingCount ?? bridgeOutbox?.pending.length ?? 0} />
        <Metric label="不确定投递" value={uncertainTasks} />
      </dl>

      <div className={styles.runtimeGrid}>
        <RuntimeCard
          title="发送适配器"
          status={adapter?.realSend ? "真实发送已启用" : "真实发送未启用"}
          ok={Boolean(adapter?.realSend)}
          detail={adapter?.description || "未取得发送适配器配置。"}
          rows={[
            ["适配器", adapter?.label || adapter?.name || "未连接"],
            ["发送前身份校验", adapter?.capabilities?.requiresWindowGuard ? "必须" : "未声明"],
          ]}
        />
        <RuntimeCard
          title="发送 Worker"
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
          title="身份校验观察器"
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
          title="发送发件箱"
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
          <header className={styles.runtimeHeader}><div><h2 id="recent-window-evidence-title">最近身份校验证据</h2><p>发送前身份校验使用的真实快照。</p></div></header>
          {snapshots.length ? (
            <ul className={styles.runtimeList}>
              {snapshots.slice(0, 10).map((snapshot) => (
                <li key={snapshot.id}>
                  <span><strong>{snapshot.accountDisplayName || snapshot.wechatAccountId || "账号未识别"}</strong><small>{snapshot.activeChatTitle || snapshot.chatTitle || "聊天对象未识别"} · {formatTime(snapshot.capturedAt)}</small></span>
                  <span className={snapshot.isOnline ? styles.passedText : styles.failedText}>{snapshot.isOnline ? "在线" : "离线"}</span>
                </li>
              ))}
            </ul>
          ) : <SendEmpty title="暂无身份校验证据" detail="发送前采集到的身份快照会显示在这里。" />}
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
