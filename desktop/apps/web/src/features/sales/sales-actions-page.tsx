"use client";

import { PlayCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getAutomationReadiness,
  getAutomationStatus,
  mergeAutomationStatusRun,
  runAutomationOnce,
  type AutomationReadiness,
  type AutomationRun,
  type AutomationStatus,
} from "../../lib/api";
import styles from "./sales-pages.module.css";
import { SalesEmpty, SalesHeader, SalesNotice, salesError } from "./sales-ui";

const SALES_STAGE_KEYS = new Set(["quote", "order", "orderConfirmation", "orderFollowup", "safeSend"]);

const SALES_STAGE_LABELS: Record<string, string> = {
  quote: "报价发送",
  order: "订单草稿",
  orderConfirmation: "订单确认",
  orderFollowup: "生产/发货跟进",
  safeSend: "安全发送",
};

export function SalesActionsPage() {
  const [readiness, setReadiness] = useState<AutomationReadiness | null>(null);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [lastRun, setLastRun] = useState<AutomationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stages = useMemo(() => {
    const source = lastRun?.stageSummary?.stages || status?.lastRun?.stageSummary?.stages || [];
    return source.filter((stage) => SALES_STAGE_KEYS.has(stage.key));
  }, [lastRun, status]);
  const stageSummary = lastRun?.stageSummary || status?.lastRun?.stageSummary || null;
  const ready = readiness?.ready === true;

  async function refreshDashboard() {
    setLoading(true);
    setError("");
    try {
      const [nextReadiness, nextStatus] = await Promise.all([getAutomationReadiness(), getAutomationStatus()]);
      setReadiness(nextReadiness);
      setStatus(nextStatus);
      setLastRun(nextStatus?.lastRun || null);
    } catch (cause) {
      setError(salesError(cause, "销售闭环状态读取失败"));
    } finally {
      setLoading(false);
    }
  }

  async function advanceSalesLoop() {
    setBusy(true);
    setError("");
    try {
      const run = await runAutomationOnce({});
      setLastRun(run);
      setStatus((current) => mergeAutomationStatusRun(current, run, { incrementRunCount: !run.skipped }) || current);
      setReadiness(await getAutomationReadiness());
    } catch (cause) {
      setError(salesError(cause, "销售闭环推进失败"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshDashboard();
  }, []);

  return (
    <section className={styles.page} aria-label="销售处理入口">
      <SalesHeader
        eyebrow="报价与订单"
        title="销售闭环驾驶台"
        detail="低价值线索从报价、订单确认到生产/发货跟进都在这里核对；入队不等于已送达，交付必须以付款台账、物流事实和回执为准。"
        actions={(
          <>
            <button type="button" data-action-id="sales-loop-refresh" disabled={loading || busy} onClick={() => void refreshDashboard()}>
              <RefreshCw size={16} aria-hidden="true" />
              刷新状态
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="sales-loop-run-once"
              disabled={loading || busy || !ready}
              onClick={() => void advanceSalesLoop()}
            >
              <PlayCircle size={16} aria-hidden="true" />
              推进一轮
            </button>
          </>
        )}
      />
      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      {readiness && !readiness.ready ? (
        <SalesNotice tone="warning">{readiness.summary} 请先处理阻塞项，再推进报价/订单/发货闭环。</SalesNotice>
      ) : null}
      {lastRun?.skipped ? (
        <SalesNotice tone="warning">本轮未执行：{lastRun.reason || "自动化未进入写入阶段"}。</SalesNotice>
      ) : null}
      {loading ? (
        <SalesEmpty title="正在读取销售闭环状态" detail="读取自动化就绪度、最近运行记录和阶段结果。" busy />
      ) : (
        <>
          <article className={styles.card} aria-label="销售闭环概览">
            <div className={styles.cardHeader}>
              <div>
                <h2>闭环概览</h2>
                <p>只统计低价值自动化链路；高价值、人工锁定、付款未核验都会被阻塞。</p>
              </div>
              <span className={styles.statusPill}>{readiness?.ready ? "可推进" : "有阻塞"}</span>
            </div>
            <div className={styles.metricGrid} aria-label="销售闭环关键指标">
              <Metric label="待处理报价" value={readiness?.metrics.lowValueQuotesReady ?? 0} />
              <Metric label="待处理订单" value={readiness?.metrics.lowValueOrdersReady ?? 0} />
              <Metric label="待发送队列" value={readiness?.metrics.pendingSendTasks ?? 0} />
              <Metric label="人工锁定会话" value={readiness?.metrics.manualLockedConversations ?? 0} />
              <Metric label="本轮推进" value={stageSummary?.progressed ?? 0} />
              <Metric label="本轮阻塞/失败" value={(stageSummary?.blocked ?? 0) + (stageSummary?.failed ?? 0)} />
            </div>
            {stageSummary?.nextAction ? <p className={styles.auditEmpty}>{stageSummary.nextAction}</p> : null}
          </article>

          <article className={styles.card} aria-label="销售闭环阶段">
            <div className={styles.cardHeader}>
              <div>
                <h2>阶段验收</h2>
                <p>按后端真实阶段展示，不把 queued、pending_ack 当作客户已收到或订单已交付。</p>
              </div>
              <span className={styles.countPill}>{stages.length}</span>
            </div>
            {stages.length ? (
              <div className={styles.stageGrid}>
                {stages.map((stage) => <StageCard stage={stage} key={stage.key} />)}
              </div>
            ) : (
              <SalesEmpty title="还没有销售阶段运行结果" detail="点击“推进一轮”或等待后台自动化运行后，这里会展示报价、订单和发货阶段。" />
            )}
          </article>
        </>
      )}
      <div className={styles.actionChoiceGrid}>
        <Link className={styles.actionChoice} href="/sales/quotes">
          <strong>处理报价</strong>
          <span>查看报价、发送报价、核验付款凭证，并在付款核验后生成订单确认任务。</span>
        </Link>
        <Link className={styles.actionChoice} href="/sales/orders">
          <strong>处理订单</strong>
          <span>核对付款、生产状态、物流事实和发货/签收跟进，避免残缺交付。</span>
        </Link>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StageCard({
  stage,
}: {
  stage: NonNullable<AutomationRun["stageSummary"]>["stages"][number];
}) {
  const blocked = stage.blocked + stage.failed;
  return (
    <section className={`${styles.stageCard} ${blocked ? styles.stageBlocked : styles.stageOk}`} aria-label={SALES_STAGE_LABELS[stage.key] || stage.label}>
      <div>
        <strong>{SALES_STAGE_LABELS[stage.key] || stage.label}</strong>
        <span>{stage.detail}</span>
      </div>
      <dl>
        <div><dt>完成</dt><dd>{stage.completed}</dd></div>
        <div><dt>阻塞</dt><dd>{stage.blocked}</dd></div>
        <div><dt>失败</dt><dd>{stage.failed}</dd></div>
      </dl>
      <p>{stage.action}</p>
    </section>
  );
}
