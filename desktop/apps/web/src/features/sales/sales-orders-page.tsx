"use client";

import { BellRing, RefreshCw, Save, Search, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getOrderDrafts,
  identityExpectation,
  queueOrderConfirmation,
  queueOrderFollowup,
  updateOrderDraft,
  type OrderDraft,
} from "../../lib/api";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesConfirmation,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  salesError,
} from "./sales-ui";
import styles from "./sales-pages.module.css";

type OrderConfirmation = {
  kind: "save" | "queue-confirmation" | "queue-production" | "queue-delivery";
  order: OrderDraft;
  draft?: OrderForm;
};

type OrderForm = {
  status: string;
  paymentStatus: string;
  owner: string;
  customerNotes: string;
};

function orderForm(order: OrderDraft): OrderForm {
  return {
    status: order.status,
    paymentStatus: order.paymentStatus,
    owner: order.owner || "",
    customerNotes: order.customerNotes || "",
  };
}

function replaceOrder(rows: OrderDraft[], next: OrderDraft) {
  return rows.map((row) => (row.id === next.id ? next : row));
}

export function SalesOrdersPage() {
  const [orders, setOrders] = useState<OrderDraft[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<OrderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [uncertainEmpty, setUncertainEmpty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<OrderConfirmation | null>(null);

  const refreshOrders = useCallback(async () => {
    setInitializing(true);
    setError("");
    try {
      const rows = await getOrderDrafts();
      setOrders(rows);
      setUncertainEmpty(rows.length === 0);
      setSelectedId((current) => (
        rows.some((row) => row.id === current) ? current : rows[0]?.id || ""
      ));
    } catch (cause) {
      setOrders([]);
      setSelectedId("");
      setUncertainEmpty(false);
      setError(salesError(cause, "订单读取失败"));
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  const selectedOrder = orders.find((order) => order.id === selectedId) || null;

  useEffect(() => {
    setForm(selectedOrder ? orderForm(selectedOrder) : null);
  }, [selectedOrder]);

  const visibleOrders = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return orders;
    return orders.filter((order) => [
      order.id,
      order.customerId,
      order.customer?.name,
      order.status,
      order.paymentStatus,
      order.owner,
    ].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(keyword)));
  }, [orders, query]);

  const selectedIdentity = selectedOrder ? identityExpectation(selectedOrder) : {};
  const identityReady = hasCompleteIdentity(selectedIdentity);
  const formDirty = Boolean(selectedOrder && form && (
    form.status !== selectedOrder.status
      || form.paymentStatus !== selectedOrder.paymentStatus
      || form.owner !== (selectedOrder.owner || "")
      || form.customerNotes !== (selectedOrder.customerNotes || "")
  ));

  function updateForm<K extends keyof OrderForm>(key: K, value: OrderForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function executeConfirmedAction() {
    const pending = pendingConfirmation;
    if (!pending) return;
    const expected = identityExpectation(pending.order);
    if (!hasCompleteIdentity(expected)) {
      setError("已拒绝操作：订单缺少微信账号、会话或客户身份，不能安全写入或发送。");
      setPendingConfirmation(null);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (pending.kind === "save") {
        if (!pending.draft) throw new Error("订单编辑快照不可用");
        const updated = await updateOrderDraft(pending.order.id, {
          ...pending.draft,
          ...expected,
        });
        setOrders((rows) => replaceOrder(rows, updated));
        setNotice(`订单 ${updated.id} 已保存。`);
      } else if (pending.kind === "queue-confirmation") {
        const result = await queueOrderConfirmation(pending.order.id, expected);
        setOrders((rows) => replaceOrder(rows, result.orderDraft));
        setNotice(`订单 ${pending.order.id} 的确认消息已入队；入队成功不等于客户已收到。`);
      } else {
        const followupType = pending.kind === "queue-production" ? "production" : "delivery";
        const result = await queueOrderFollowup(pending.order.id, followupType, expected);
        setOrders((rows) => replaceOrder(rows, result.orderDraft));
        setNotice(`订单 ${pending.order.id} 的${followupType === "production" ? "生产" : "发货"}跟进已入队；入队成功不等于客户已收到。`);
      }
      setPendingConfirmation(null);
    } catch (cause) {
      setError(salesError(cause, pending.kind === "save" ? "订单保存失败" : "订单消息入队失败"));
    } finally {
      setBusy(false);
    }
  }

  function confirmationCopy(pending: OrderConfirmation) {
    const identity = identityLabel(identityExpectation(pending.order));
    if (pending.kind === "save") {
      return {
        title: "确认保存订单字段？",
        detail: `${identity}。仅保存当前状态、付款状态、负责人和备注，不发送消息。`,
        label: "确认保存",
      };
    }
    const label = pending.kind === "queue-confirmation"
      ? "订单确认"
      : pending.kind === "queue-production"
        ? "生产跟进"
        : "发货跟进";
    return {
      title: `确认把${label}加入发送队列？`,
      detail: `${identity}。系统会创建真实微信发送任务，且不会自动解除人工接管锁。`,
      label: "确认入队",
    };
  }

  const confirmation = pendingConfirmation ? confirmationCopy(pendingConfirmation) : null;

  return (
    <section className={styles.page} aria-label="订单跟进">
      <SalesHeader
        eyebrow="销售 · 订单"
        title="订单跟进"
        detail="只负责维护订单草稿状态，并明确触发订单确认、生产跟进或发货跟进。每次发送都需要二次确认。"
        actions={(
          <button
            type="button"
            data-action-id="sales-orders-refresh"
            aria-label="刷新订单列表"
            disabled={initializing || busy}
            onClick={() => void refreshOrders()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        )}
      />

      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {uncertainEmpty ? (
        <SalesNotice tone="warning">
          当前客户端把“接口失败”和“真实空列表”都返回为空数组，因此无法确认是否真的没有订单；请先检查服务状态再重试。
        </SalesNotice>
      ) : null}
      {pendingConfirmation && confirmation ? (
        <SalesConfirmation
          title={confirmation.title}
          detail={confirmation.detail}
          confirmLabel={confirmation.label}
          confirmActionId={`sales-orders-confirm-${pendingConfirmation.kind}`}
          cancelActionId="sales-orders-cancel-confirmation"
          busy={busy}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => void executeConfirmedAction()}
        />
      ) : null}

      <div className={styles.masterDetail}>
        <article className={styles.card} aria-label="订单列表">
          <div className={styles.cardHeader}>
            <div>
              <h2>选择订单</h2>
              <p>按客户、状态或订单编号查找。</p>
            </div>
            <span className={styles.countPill}>{visibleOrders.length}</span>
          </div>
          <label className={styles.searchField}>
            <span><Search size={14} aria-hidden="true" />搜索订单</span>
            <input
              value={query}
              aria-label="搜索订单"
              placeholder="客户、状态或编号"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {initializing ? (
            <SalesEmpty title="正在读取订单" detail="正在连接销售服务。" busy />
          ) : visibleOrders.length ? (
            <ul className={styles.selectionList}>
              {visibleOrders.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    className={order.id === selectedId ? styles.selected : undefined}
                    data-action-id={`sales-orders-select-${order.id}`}
                    aria-label={`查看订单 ${order.id}`}
                    aria-pressed={order.id === selectedId}
                    onClick={() => setSelectedId(order.id)}
                  >
                    <span>
                      <strong>{order.customer?.name || order.customerId}</strong>
                      <small>{order.id}</small>
                      <em>{order.status} · {order.paymentStatus}</em>
                    </span>
                    <span className={styles.rowMeta}>{money(order.totalPrice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <SalesEmpty
              title={query.trim() ? "没有匹配订单" : "没有可确认的订单"}
              detail={query.trim() ? "清除搜索词后重试。" : "空结果可能是服务失败，请根据上方状态提示处理。"}
            />
          )}
        </article>

        <article className={styles.card} aria-label="订单编辑与发送">
          {selectedOrder && form ? (
            <>
              <div className={styles.cardHeader}>
                <div>
                  <h2>{selectedOrder.customer?.name || selectedOrder.customerId}</h2>
                  <p>订单 {selectedOrder.id}</p>
                </div>
                <span className={styles.statusPill}>{selectedOrder.status}</span>
              </div>
              {!identityReady ? (
                <SalesNotice tone="danger">
                  身份不完整：{identityLabel(selectedIdentity)}。已禁用所有写入与发送操作。
                </SalesNotice>
              ) : (
                <SalesNotice tone="success">身份已绑定：{identityLabel(selectedIdentity)}。</SalesNotice>
              )}
              <dl className={styles.factGrid}>
                <div><dt>总价</dt><dd>{money(selectedOrder.totalPrice)}</dd></div>
                <div><dt>数量</dt><dd>{selectedOrder.quantity}</dd></div>
                <div><dt>报价草稿</dt><dd>{selectedOrder.quoteDraftId}</dd></div>
                <div><dt>设计任务</dt><dd>{selectedOrder.designJobId}</dd></div>
              </dl>
              <div className={styles.formGrid}>
                <label>
                  <span>订单状态</span>
                  <input
                    value={form.status}
                    aria-label="订单状态"
                    disabled={busy || !identityReady}
                    onChange={(event) => updateForm("status", event.target.value)}
                  />
                </label>
                <label>
                  <span>付款状态</span>
                  <input
                    value={form.paymentStatus}
                    aria-label="付款状态"
                    disabled={busy || !identityReady}
                    onChange={(event) => updateForm("paymentStatus", event.target.value)}
                  />
                </label>
                <label>
                  <span>负责人</span>
                  <input
                    value={form.owner}
                    aria-label="订单负责人"
                    disabled={busy || !identityReady}
                    onChange={(event) => updateForm("owner", event.target.value)}
                  />
                </label>
                <label className={styles.fullField}>
                  <span>客户备注</span>
                  <textarea
                    value={form.customerNotes}
                    aria-label="订单客户备注"
                    rows={4}
                    disabled={busy || !identityReady}
                    onChange={(event) => updateForm("customerNotes", event.target.value)}
                  />
                </label>
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  data-action-id="sales-orders-save"
                  aria-label="保存当前订单字段"
                  disabled={busy || !identityReady || !formDirty}
                  onClick={() => setPendingConfirmation({
                    kind: "save",
                    order: selectedOrder,
                    draft: { ...form },
                  })}
                >
                  <Save size={16} aria-hidden="true" />
                  保存字段
                </button>
                <button
                  type="button"
                  data-action-id="sales-orders-queue-confirmation"
                  aria-label="把订单确认加入微信发送队列"
                  disabled={busy || !identityReady}
                  onClick={() => setPendingConfirmation({ kind: "queue-confirmation", order: selectedOrder })}
                >
                  <BellRing size={16} aria-hidden="true" />
                  订单确认入队
                </button>
                <button
                  type="button"
                  data-action-id="sales-orders-queue-production"
                  aria-label="把生产跟进加入微信发送队列"
                  disabled={busy || !identityReady}
                  onClick={() => setPendingConfirmation({ kind: "queue-production", order: selectedOrder })}
                >
                  <BellRing size={16} aria-hidden="true" />
                  生产跟进入队
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-action-id="sales-orders-queue-delivery"
                  aria-label="把发货跟进加入微信发送队列"
                  disabled={busy || !identityReady}
                  onClick={() => setPendingConfirmation({ kind: "queue-delivery", order: selectedOrder })}
                >
                  <Truck size={16} aria-hidden="true" />
                  发货跟进入队
                </button>
              </div>
            </>
          ) : (
            <SalesEmpty title="先选择一条订单" detail="这里仅维护订单字段，并将三种客户消息拆成独立、可确认的动作。" />
          )}
        </article>
      </div>
    </section>
  );
}
