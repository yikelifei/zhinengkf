import { LifeBuoy, Save } from "lucide-react";
import Link from "next/link";
import type { AfterSalesCase, IdentityExpectation, OrderDraft } from "../../lib/api";
import { identityLabel, money, SalesEmpty, SalesNotice, textOrDash } from "./sales-ui";
import styles from "./sales-pages.module.css";

export type CreateForm = {
  type: string;
  reason: string;
  requestedAmountCny: string;
  evidenceReference: string;
  desiredResolution: string;
};

export type ResolveForm = {
  caseId: string;
  resolutionType: string;
  approvedAmountCny: string;
  refundMethod: string;
  refundReference: string;
  replacementCarrier: string;
  replacementTrackingNo: string;
  note: string;
};

export const EMPTY_CREATE_FORM: CreateForm = {
  type: "refund",
  reason: "",
  requestedAmountCny: "",
  evidenceReference: "",
  desiredResolution: "",
};

export const EMPTY_RESOLVE_FORM: ResolveForm = {
  caseId: "",
  resolutionType: "refund",
  approvedAmountCny: "",
  refundMethod: "",
  refundReference: "",
  replacementCarrier: "",
  replacementTrackingNo: "",
  note: "",
};

type PaymentSummary = NonNullable<AfterSalesCase["paymentSummary"]>;
type SalesOrderLike = {
  id: string;
  customerId?: string | null;
  customer?: { name?: string | null } | null;
  status?: string | null;
  totalPrice?: number | string | null;
  paymentStatus?: string | null;
};

export function resolutionNeedsAmount(type: string) {
  return type === "refund" || type === "compensation";
}

function afterSalesStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "待处理",
    resolved: "内部结论已记录",
    rejected: "已拒绝",
    cancelled: "已取消",
  };
  return labels[status] || status || "未知";
}

function moneyMaybe(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "无金额";
  const amount = Number(value);
  return Number.isFinite(amount) ? money(amount) : "无金额";
}

function paymentMoney(paymentSummary: PaymentSummary | null, field: keyof PaymentSummary) {
  return paymentSummary ? money(paymentSummary[field]) : "按提交时重新计算";
}

export function AfterSalesOrderSummary({
  expected,
  identityReady,
  openCaseCount,
  paymentSummary,
  selected,
}: {
  expected: IdentityExpectation;
  identityReady: boolean;
  openCaseCount: number | null;
  paymentSummary: PaymentSummary | null;
  selected: SalesOrderLike;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2>{selected.customer?.name || selected.customerId}</h2>
          <p>订单 {selected.id}</p>
        </div>
        <span className={styles.statusPill}>{selected.status}</span>
      </div>
      {identityReady ? (
        <SalesNotice tone="success">身份已绑定：{identityLabel(expected)}。</SalesNotice>
      ) : (
        <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。售后创建和处理已禁用。</SalesNotice>
      )}
      <dl className={styles.factGrid}>
        <div><dt>订单金额</dt><dd>{money(Number(selected.totalPrice || 0))}</dd></div>
        <div><dt>付款状态</dt><dd>{selected.paymentStatus}</dd></div>
        <div><dt>已核验付款</dt><dd>{paymentMoney(paymentSummary, "paidAmountCny")}</dd></div>
        <div><dt>已退款/补偿</dt><dd>{paymentMoney(paymentSummary, "refundedAmountCny")}</dd></div>
        <div><dt>当前可退</dt><dd>{paymentMoney(paymentSummary, "refundableAmountCny")}</dd></div>
        <div><dt>未关闭 case</dt><dd>{openCaseCount === null ? "未确认" : openCaseCount}</dd></div>
      </dl>
    </article>
  );
}

export function CreateAfterSalesForm({
  busy,
  canCreate,
  createForm,
  createNeedsAmount,
  identityReady,
  onSubmit,
  onUpdate,
}: {
  busy: boolean;
  canCreate: boolean;
  createForm: CreateForm;
  createNeedsAmount: boolean;
  identityReady: boolean;
  onSubmit: () => void | Promise<void>;
  onUpdate: (key: keyof CreateForm, value: string) => void;
}) {
  return (
    <form className={styles.card} data-action-id="sales-after-sales-create-form" onSubmit={(event) => { event.preventDefault(); if (canCreate) void onSubmit(); }}>
      <div className={styles.cardHeader}><div><h2>创建售后 case</h2><p>记录客户问题、金额和凭证，等待处理结论。</p></div><LifeBuoy size={22} aria-hidden="true" /></div>
      <div className={styles.formGrid}>
        <label><span>售后类型</span><select value={createForm.type} disabled={busy || !identityReady} data-action-id="sales-after-sales-create-type" onChange={(event) => onUpdate("type", event.target.value)}><option value="refund">退款</option><option value="replacement">补发</option><option value="return">退货</option><option value="compensation">补偿</option><option value="other">其他</option></select></label>
        <label><span>申请金额</span><input value={createForm.requestedAmountCny} disabled={busy || !identityReady} data-action-id="sales-after-sales-create-amount" inputMode="decimal" placeholder={createNeedsAmount ? "必填，例如 200" : "选填"} onChange={(event) => onUpdate("requestedAmountCny", event.target.value)} /></label>
        <label className={styles.fullField}><span>客户问题/处理原因</span><textarea rows={3} value={createForm.reason} disabled={busy || !identityReady} data-action-id="sales-after-sales-create-reason" onChange={(event) => onUpdate("reason", event.target.value)} /></label>
        <label><span>凭证/图片/聊天记录引用</span><input value={createForm.evidenceReference} disabled={busy || !identityReady} data-action-id="sales-after-sales-create-evidence" onChange={(event) => onUpdate("evidenceReference", event.target.value)} /></label>
        <label><span>期望处理方式</span><input value={createForm.desiredResolution} disabled={busy || !identityReady} data-action-id="sales-after-sales-create-desired" onChange={(event) => onUpdate("desiredResolution", event.target.value)} /></label>
      </div>
      <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy || !canCreate} data-action-id="sales-after-sales-create-submit"><Save size={16} aria-hidden="true" />创建售后 case</button></div>
    </form>
  );
}

export function ResolveAfterSalesForm({
  busy,
  canResolve,
  identityReady,
  onSubmit,
  onUpdate,
  openCases,
  recordsLoaded,
  resolveForm,
}: {
  busy: boolean;
  canResolve: boolean;
  identityReady: boolean;
  onSubmit: () => void | Promise<void>;
  onUpdate: (key: keyof ResolveForm, value: string) => void;
  openCases: AfterSalesCase[];
  recordsLoaded: boolean;
  resolveForm: ResolveForm;
}) {
  return (
    <form className={styles.card} data-action-id="sales-after-sales-resolve-form" onSubmit={(event) => { event.preventDefault(); if (canResolve) void onSubmit(); }}>
      <div className={styles.cardHeader}><div><h2>处理未关闭 case</h2><p>退款会写入付款流水；补发完成必须记录可核验物流公司与单号。</p></div></div>
      {!recordsLoaded
        ? <SalesNotice tone="danger">售后记录未确认，不能判断是否存在待处理 case。</SalesNotice>
        : !openCases.length
          ? <SalesNotice tone="warning">当前没有待处理售后 case。</SalesNotice>
          : null}
      <div className={styles.formGrid}>
        <label><span>选择 case</span><select value={resolveForm.caseId} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-case" onChange={(event) => onUpdate("caseId", event.target.value)}><option value="">请选择</option>{openCases.map((item) => <option key={item.id} value={item.id}>{item.typeLabel || item.type} / {item.reason.slice(0, 28)}</option>)}</select></label>
        <label><span>处理结论</span><select value={resolveForm.resolutionType} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-type" onChange={(event) => onUpdate("resolutionType", event.target.value)}><option value="refund">已退款</option><option value="replacement">已补发</option><option value="compensation">已补偿</option><option value="reject">拒绝售后</option><option value="customer_cancelled">客户取消</option><option value="manual_resolution">人工处理</option></select></label>
        <label><span>实际退款/补偿金额</span><input value={resolveForm.approvedAmountCny} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-amount" inputMode="decimal" placeholder={resolutionNeedsAmount(resolveForm.resolutionType) ? "必填，例如 200" : "选填"} onChange={(event) => onUpdate("approvedAmountCny", event.target.value)} /></label>
        <label><span>退款方式{resolutionNeedsAmount(resolveForm.resolutionType) ? "（必填）" : ""}</span><input value={resolveForm.refundMethod} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-method" placeholder="原路退回 / 银行转账 / 线下" onChange={(event) => onUpdate("refundMethod", event.target.value)} /></label>
        <label><span>退款凭证号{resolutionNeedsAmount(resolveForm.resolutionType) ? "（必填）" : ""}</span><input value={resolveForm.refundReference} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-reference" placeholder="填写支付平台或银行可核验流水号" onChange={(event) => onUpdate("refundReference", event.target.value)} /></label>
        <label><span>补发物流公司{resolveForm.resolutionType === "replacement" ? "（必填）" : ""}</span><input value={resolveForm.replacementCarrier} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-carrier" placeholder="例如：顺丰速运" onChange={(event) => onUpdate("replacementCarrier", event.target.value)} /></label>
        <label><span>补发物流单号{resolveForm.resolutionType === "replacement" ? "（必填）" : ""}</span><input value={resolveForm.replacementTrackingNo} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-tracking" placeholder="填写承运方可核验单号" onChange={(event) => onUpdate("replacementTrackingNo", event.target.value)} /></label>
        <label className={styles.fullField}><span>处理说明</span><textarea rows={3} value={resolveForm.note} disabled={busy || !identityReady || !openCases.length} data-action-id="sales-after-sales-resolve-note" onChange={(event) => onUpdate("note", event.target.value)} /></label>
      </div>
      <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy || !canResolve} data-action-id="sales-after-sales-resolve-submit"><Save size={16} aria-hidden="true" />记录处理结论</button></div>
    </form>
  );
}

export function AfterSalesNextSteps({ loaded, order, records }: { loaded: boolean; order: OrderDraft; records: AfterSalesCase[] }) {
  const openCount = records.filter((item) => item.status === "open").length;
  const resolvedCount = records.filter((item) => item.status !== "open").length;
  const learning = afterSalesLearningReadiness(records);
  const params = new URLSearchParams({
    wechatAccountId: order.wechatAccountId,
    conversationId: order.conversationId,
    customerId: order.customerId,
  });
  return (
    <article className={styles.card} aria-label="售后闭环下一步">
      <div className={styles.cardHeader}>
        <div>
          <h2>售后闭环</h2>
          <p>{!loaded
            ? "售后记录未确认，不能推荐回访完成或开放经验复核。"
            : openCount
            ? `仍有 ${openCount} 个 case 未关闭；先完成处置和客户反馈，不进入知识沉淀。`
            : learning.ready
              ? "内部处理证据已留痕；下一步先回访客户，再把可复用规则送入人工复核。"
              : resolvedCount
                ? `内部结论存在但证据不足：${learning.blockers.join("、")}。先回访并补齐事实，不开放经验复核。`
              : "先创建售后 case，不能用普通备注替代正式售后记录。"}</p>
        </div>
        <span className={styles.statusPill}>{!loaded ? "状态未确认" : openCount ? `${openCount} 待处理` : learning.ready ? "待客户回访" : resolvedCount ? "证据待补齐" : "未开始"}</span>
      </div>
      <div className={styles.buttonRow}>
        {loaded ? (
          <>
            <Link className={styles.primaryButton} href={`/conversations/${encodeURIComponent(order.conversationId)}`} data-action-id="sales-after-sales-open-conversation">{openCount ? "回到会话补充证据" : "先回访客户"}</Link>
            <Link className={styles.button} href={`/sales/orders/${encodeURIComponent(order.id)}`} data-action-id="sales-after-sales-open-order">核对订单交付</Link>
            {!openCount && learning.ready ? (
              <Link className={styles.button} href={`/training/overview?${params.toString()}`} data-action-id="sales-after-sales-open-learning">进入结果复核</Link>
            ) : null}
          </>
        ) : <strong>请先使用页面顶部“刷新”恢复售后记录。</strong>}
      </div>
      <p className={styles.helpText}>退款流水、补发单号和客户原话属于事实证据；“进入结果复核”不是训练完成，复核通过前不会自动写成可用话术。</p>
    </article>
  );
}

export function afterSalesLearningReadiness(records: AfterSalesCase[]) {
  const blockers = new Set<string>();
  const closed = records.filter((item) => item.status !== "open");
  if (!closed.length) blockers.add("没有已记录结论的 case");
  for (const item of closed) {
    if (!String(item.evidenceReference || "").trim()) blockers.add("缺少客户问题凭证");
    if (!String(item.resolution?.note || "").trim()) blockers.add("缺少人工处理说明");
    const type = String(item.resolution?.type || "");
    if (["refund", "compensation"].includes(type)) {
      if (!item.resolution?.paymentEventId || !item.resolution?.refundMethod || !item.resolution?.refundReference) {
        blockers.add("退款或补偿流水证据不完整");
      }
    }
    if (type === "replacement" && (!item.resolution?.replacementCarrier || !item.resolution?.replacementTrackingNo)) {
      blockers.add("补发物流证据不完整");
    }
  }
  return { ready: closed.length > 0 && blockers.size === 0, blockers: [...blockers] };
}

export function AfterSalesCaseList({ loaded, loadingRecords, orderId, records }: { loaded: boolean; loadingRecords: boolean; orderId: string; records: AfterSalesCase[] }) {
  return (
    <>
      <article className={styles.card} data-action-id="sales-after-sales-case-list">
        <div className={styles.cardHeader}><div><h2>售后记录</h2><p>{loadingRecords ? "正在读取售后记录" : `共 ${records.length} 条`}</p></div></div>
        {records.length ? (
          <div className={styles.factGrid}>
            {records.map((item) => (
              <div key={item.id}>
                <dt>{item.typeLabel || item.type} · {afterSalesStatusLabel(item.status)}</dt>
                <dd>
                  {item.reason}<br />
                  申请：{moneyMaybe(item.requestedAmountCny)}；凭证：{textOrDash(item.evidenceReference)}
                  {item.resolution ? <><br />结论：{item.resolution.typeLabel || item.resolution.type}；金额：{moneyMaybe(item.resolution.approvedAmountCny)}；退款流水：{textOrDash(item.resolution.paymentEventId)}<br />补发：{textOrDash(item.resolution.replacementCarrier)} {textOrDash(item.resolution.replacementTrackingNo)}</> : null}
                </dd>
              </div>
            ))}
          </div>
        ) : loaded ? (
          <SalesEmpty title="还没有售后记录" detail="创建售后 case 后会显示在这里。" />
        ) : (
          <SalesEmpty title="售后记录状态未确认" detail="读取失败或尚未完成，不能据此认定没有待处理 case。" busy={loadingRecords} />
        )}
      </article>
      <Link className={styles.backLink} href={`/sales/orders/${encodeURIComponent(orderId)}`} data-action-id="sales-after-sales-back">返回订单详情</Link>
    </>
  );
}
