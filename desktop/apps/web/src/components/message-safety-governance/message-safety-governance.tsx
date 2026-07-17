"use client";

import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileClock,
  Gauge,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import styles from "./message-safety-governance.module.css";
import type {
  AccountBusinessBudget,
  ApprovalItem,
  AuditOutcome,
  ConsentState,
  MessageSafetyGovernanceProps,
  QuarantineState,
  ReviewState,
} from "./types";

export function MessageSafetyGovernance({
  identity,
  globallyStopped,
  globalStopReason,
  consentRecords,
  accountBudgets,
  approvalQueue,
  sensitiveContent,
  quarantinedDeliveries,
  auditEvents,
  busy = false,
  readOnly = false,
  onRequestGlobalStop,
  onRequestResume,
  onOpenConsentRecord,
  onReviewApproval,
  onResolveQuarantine,
  onExportAudit,
}: MessageSafetyGovernanceProps) {
  const pendingApprovals = approvalQueue.filter((item) => item.state === "pending").length;
  const isolatedDeliveries = quarantinedDeliveries.filter((item) => item.state !== "resolved").length;
  const unsubscribedCustomers = consentRecords.filter((record) => record.state === "unsubscribed").length;

  return (
    <section className={styles.panel} aria-labelledby="message-safety-governance-title" aria-busy={busy}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 id="message-safety-governance-title">合规控制与审计</h2>
          <p>所有外发动作先经过身份、客户授权、业务预算、内容规则与人工审核检查。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={globallyStopped ? styles.stoppedBadge : styles.runningBadge} role="status">
            {globallyStopped ? <PauseCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {globallyStopped ? "全局已停止" : "治理已启用"}
          </span>
          {globallyStopped ? (
            <button
              type="button"
              className={styles.secondaryButton}
              data-action-id="integrations.personal-wechat.safety.request-resume"
              aria-label="申请恢复个人微信发送治理"
              onClick={onRequestResume}
              disabled={busy || readOnly}
            >
              <PlayCircle size={15} aria-hidden="true" />申请恢复
            </button>
          ) : (
            <button
              type="button"
              className={styles.stopButton}
              data-action-id="integrations.personal-wechat.safety.global-stop"
              aria-label="停止全部个人微信外发操作"
              onClick={onRequestGlobalStop}
              disabled={busy || readOnly}
            >
              <PauseCircle size={15} aria-hidden="true" />全局停止
            </button>
          )}
        </div>
      </header>

      {globallyStopped ? (
        <div className={styles.stopNotice} role="alert">
          <AlertOctagon size={17} aria-hidden="true" />
          <div><strong>全部账号的外发操作已停止</strong><span>{globalStopReason || "等待有权限的操作员审核后恢复。"}</span></div>
        </div>
      ) : null}

      <div className={styles.summaryGrid} aria-label="治理摘要">
        <SummaryCard icon={<UserCheck size={17} />} label="明确退订" value={unsubscribedCustomers} tone="danger" />
        <SummaryCard icon={<ClipboardCheck size={17} />} label="待人工审批" value={pendingApprovals} tone="warning" />
        <SummaryCard icon={<Ban size={17} />} label="内容阻断" value={sensitiveContent.blockedToday ?? "未接通"} tone="danger" />
        <SummaryCard icon={<FileClock size={17} />} label="隔离待处理" value={isolatedDeliveries} tone="warning" />
      </div>

      <div className={styles.contentGrid}>
        <section className={styles.card} aria-labelledby="operator-identity-title">
          <CardHeader icon={<UserCheck size={16} />} title="当前操作身份" id="operator-identity-title" />
          <dl className={styles.identityList}>
            <div><dt>操作员</dt><dd>{identity.operatorName} · {identity.operatorRole}</dd></div>
            <div><dt>所属主体</dt><dd>{identity.organizationName}</dd></div>
            <div><dt>当前账号</dt><dd><code>{identity.activeAccountId}</code></dd></div>
            <div><dt>业务目的</dt><dd>{identity.businessPurpose}</dd></div>
          </dl>
        </section>

        <section className={styles.card} aria-labelledby="content-control-title">
          <CardHeader icon={<ShieldCheck size={16} />} title="敏感内容阻断" id="content-control-title" />
          <div className={styles.policySummary}>
            <div><span>策略版本</span><strong>{sensitiveContent.policyVersion}</strong></div>
            <div><span>启用规则</span><strong>{sensitiveContent.activeRuleCount ?? "未接通"}</strong></div>
            <div><span>最近检查</span><strong>{sensitiveContent.lastEvaluatedAt}</strong></div>
          </div>
          <div className={styles.chipList} aria-label="受保护内容类别">
            {sensitiveContent.protectedCategories.map((category) => <span key={category}>{category}</span>)}
          </div>
        </section>

        <section className={`${styles.card} ${styles.wideCard}`} aria-labelledby="account-budget-title">
          <CardHeader icon={<Gauge size={16} />} title="每账号业务预算" id="account-budget-title" subtitle="按明确周期和固定额度执行；达到额度后停止进入外发队列。" />
          <div className={styles.budgetList}>
            {accountBudgets.length ? accountBudgets.map((budget) => <BudgetRow key={budget.accountId} budget={budget} />) : <EmptyRow text="尚未配置账号业务预算" />}
          </div>
        </section>

        <section className={`${styles.card} ${styles.wideCard}`} aria-labelledby="consent-title">
          <CardHeader icon={<UserCheck size={16} />} title="客户同意与退订" id="consent-title" subtitle="缺失、过期或已退订的客户不可进入外发队列。" />
          <div className={styles.table} role="table" aria-label="客户同意记录">
            <div className={styles.tableHead} role="row"><span>客户</span><span>状态</span><span>记录来源</span><span>记录时间</span><span>操作</span></div>
            {consentRecords.length ? consentRecords.map((record) => (
              <div className={styles.tableRow} role="row" key={record.customerId}>
                <strong>{record.customerLabel}</strong>
                <StatusBadge kind={record.state} label={consentLabel(record.state)} />
                <span>{record.source}</span>
                <span>{record.unsubscribedAt || record.recordedAt}</span>
                <button
                  type="button"
                  className={styles.textButton}
                  data-action-id={`integrations.personal-wechat.safety.consent.${record.customerId}`}
                  aria-label={`查看客户 ${record.customerLabel} 的同意凭据`}
                  onClick={() => onOpenConsentRecord(record.customerId)}
                  disabled={busy || readOnly}
                >查看凭据</button>
              </div>
            )) : <EmptyRow text="暂无客户同意记录" />}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="approval-title">
          <CardHeader icon={<ClipboardCheck size={16} />} title="人工审批" id="approval-title" />
          <div className={styles.stackList}>
            {approvalQueue.length ? approvalQueue.map((item) => (
              <ApprovalRow key={item.id} item={item} busy={busy || readOnly} onReview={onReviewApproval} />
            )) : <EmptyRow text="暂无待审批内容" />}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="quarantine-title">
          <CardHeader icon={<FileClock size={16} />} title="不确定状态隔离" id="quarantine-title" />
          <div className={styles.stackList}>
            {quarantinedDeliveries.length ? quarantinedDeliveries.map((item) => (
              <article className={styles.stackItem} key={item.id}>
                <div className={styles.stackItemHeader}><strong>{item.customerLabel}</strong><StatusBadge kind={item.state} label={quarantineLabel(item.state)} /></div>
                <p>{item.contentDigest}</p><small>{item.accountId} · {item.reason} · {item.detectedAt}</small>
                {item.state !== "resolved" ? (
                  <button
                    type="button"
                    className={styles.textButton}
                    data-action-id={`integrations.personal-wechat.safety.quarantine.${item.id}`}
                    aria-label={`人工处理隔离投递 ${item.id}`}
                    onClick={() => onResolveQuarantine(item.id)}
                    disabled={busy || readOnly}
                  >进入人工处理</button>
                ) : null}
              </article>
            )) : <EmptyRow text="当前没有隔离记录" />}
          </div>
        </section>

        <section className={`${styles.card} ${styles.wideCard}`} aria-labelledby="audit-title">
          <CardHeader
            icon={<FileClock size={16} />}
            title="审计事件"
            id="audit-title"
            action={(
              <button
                type="button"
                className={styles.secondaryButton}
                data-action-id="integrations.personal-wechat.safety.export-audit"
                aria-label="导出个人微信发送治理审计"
                onClick={onExportAudit}
                disabled={busy || readOnly}
              ><Download size={14} aria-hidden="true" />导出审计</button>
            )}
          />
          <div className={styles.auditList}>
            {auditEvents.length ? auditEvents.map((event) => (
              <div className={styles.auditRow} key={event.id}>
                <span className={styles.auditTime}>{event.occurredAt}</span>
                <strong>{event.actor}</strong>
                <span>{event.action}</span>
                <span>{event.target}</span>
                <StatusBadge kind={event.outcome} label={auditOutcomeLabel(event.outcome)} />
                <small>{event.detail}</small>
              </div>
            )) : <EmptyRow text="暂无审计事件" />}
          </div>
        </section>
      </div>
    </section>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone: "warning" | "danger" }) {
  return <div className={`${styles.summaryCard} ${styles[tone]}`}>{icon}<div><strong>{value}</strong><span>{label}</span></div></div>;
}

function CardHeader({ icon, title, id, subtitle, action }: { icon: React.ReactNode; title: string; id: string; subtitle?: string; action?: React.ReactNode }) {
  return <header className={styles.cardHeader}><div className={styles.cardTitle}>{icon}<div><h3 id={id}>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div></div>{action}</header>;
}

function BudgetRow({ budget }: { budget: AccountBusinessBudget }) {
  const available = Math.max(0, budget.limit - budget.used - budget.reserved);
  const ratio = budget.limit > 0 ? Math.min(100, Math.round(((budget.used + budget.reserved) / budget.limit) * 100)) : 100;
  return (
    <article className={styles.budgetRow}>
      <div><strong>{budget.accountLabel}</strong><code>{budget.accountId}</code></div>
      <div className={styles.budgetMetric}><span>{budget.periodLabel}</span><strong>{budget.used} 已用 · {budget.reserved} 预留 · {available} 可用</strong></div>
      <div className={styles.progressTrack} aria-label={`${budget.accountLabel} 已使用 ${ratio}%`}><span style={{ width: `${ratio}%` }} /></div>
      <div className={styles.budgetStatus}><StatusBadge kind={budget.enabled && available > 0 ? "allowed" : "blocked"} label={budget.enabled && available > 0 ? "额度有效" : "已停止"} /><small>{budget.resetAt} 重置</small></div>
    </article>
  );
}

function ApprovalRow({ item, busy, onReview }: { item: ApprovalItem; busy: boolean; onReview: (approvalId: string) => void }) {
  return (
    <article className={styles.stackItem}>
      <div className={styles.stackItemHeader}><strong>{item.customerLabel}</strong><StatusBadge kind={item.state} label={reviewLabel(item.state)} /></div>
      <p>{item.contentSummary}</p><small>{item.accountId} · {item.reason} · {item.requestedBy} · {item.requestedAt}</small>
      {item.state === "pending" ? (
        <button
          type="button"
          className={styles.textButton}
          data-action-id={`integrations.personal-wechat.safety.approval.${item.id}`}
          aria-label={`复核个人微信发送任务 ${item.id}`}
          onClick={() => onReview(item.id)}
          disabled={busy}
        >进入审批</button>
      ) : null}
    </article>
  );
}

function StatusBadge({ kind, label }: { kind: ConsentState | ReviewState | QuarantineState | AuditOutcome; label: string }) {
  return <span className={`${styles.statusBadge} ${statusClass(kind)}`}>{label}</span>;
}

function EmptyRow({ text }: { text: string }) {
  return <div className={styles.emptyRow}>{text}</div>;
}

function statusClass(kind: ConsentState | ReviewState | QuarantineState | AuditOutcome) {
  if (["granted", "approved", "resolved", "allowed"].includes(kind)) return styles.successState;
  if (["unsubscribed", "rejected", "blocked"].includes(kind)) return styles.dangerState;
  if (["missing", "expired", "isolated", "reviewing", "pending"].includes(kind)) return styles.warningState;
  return styles.neutralState;
}

function consentLabel(state: ConsentState) {
  return { granted: "已同意", unsubscribed: "已退订", missing: "缺少凭据", expired: "授权已过期" }[state];
}

function reviewLabel(state: ReviewState) {
  return { pending: "待审批", approved: "已批准", rejected: "已拒绝" }[state];
}

function quarantineLabel(state: QuarantineState) {
  return { isolated: "已隔离", reviewing: "人工处理中", resolved: "已解决" }[state];
}

function auditOutcomeLabel(outcome: AuditOutcome) {
  return { allowed: "已允许", blocked: "已阻断", pending: "待处理", recorded: "已记录" }[outcome];
}
