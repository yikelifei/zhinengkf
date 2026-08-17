"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isValidCarrier, isValidTrackingNo } from "../../../../../packages/rules/orderDraft";
import {
  createOrderAfterSalesCase,
  getOrderAfterSalesCases,
  identityExpectation,
  resolveOrderAfterSalesCase,
  type AfterSalesCase,
} from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import {
  AfterSalesCaseList,
  AfterSalesNextSteps,
  AfterSalesOrderSummary,
  CreateAfterSalesForm,
  EMPTY_CREATE_FORM,
  EMPTY_RESOLVE_FORM,
  ResolveAfterSalesForm,
  resolutionNeedsAmount,
  type CreateForm,
  type ResolveForm,
} from "./sales-order-after-sales-panels";
import { hasCompleteIdentity, SalesEmpty, SalesHeader, SalesNotice, salesError } from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesOrders } from "./use-sales-records";

export function SalesOrderAfterSalesPage({ orderId }: { orderId: string }) {
  const { selected, loading, loaded, error: orderError, refresh } = useSalesOrders(orderId);
  const expected = useMemo(() => selected ? identityExpectation(selected) : {}, [selected]);
  const identityReady = hasCompleteIdentity(expected);
  const [records, setRecords] = useState<AfterSalesCase[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [recordsFresh, setRecordsFresh] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [resolveForm, setResolveForm] = useState<ResolveForm>(EMPTY_RESOLVE_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0);
  const createOperationRef = useRef<PendingClientOperation | null>(null);
  const resolveOperationRef = useRef<PendingClientOperation | null>(null);

  const openCases = records.filter((item) => item.status === "open");
  const paymentSummary = records.find((item) => item.paymentSummary)?.paymentSummary || null;

  const refreshCases = useCallback(async () => {
    if (!selected || !identityReady) return;
    const sequence = ++requestSequence.current;
    setLoadingRecords(true);
    setRecordsFresh(false);
    setError("");
    try {
      const rows = await getOrderAfterSalesCases(selected.id, expected);
      if (sequence !== requestSequence.current) return;
      setRecords(rows);
      setRecordsLoaded(true);
      setRecordsFresh(true);
      setResolveForm((current) => ({
        ...current,
        caseId: current.caseId && rows.some((item) => item.id === current.caseId && item.status === "open")
          ? current.caseId
          : rows.find((item) => item.status === "open")?.id || "",
      }));
    } catch (cause) {
      if (sequence === requestSequence.current) setError(salesError(cause, "售后记录读取失败"));
    } finally {
      if (sequence === requestSequence.current) setLoadingRecords(false);
    }
  }, [expected, identityReady, selected]);

  useEffect(() => {
    void refreshCases();
    return () => { requestSequence.current += 1; };
  }, [refreshCases]);

  function updateCreate(key: keyof CreateForm, value: string) {
    setCreateForm((current) => ({ ...current, [key]: value }));
  }

  function updateResolve(key: keyof ResolveForm, value: string) {
    setResolveForm((current) => ({ ...current, [key]: value }));
  }

  async function submitCreate() {
    if (!selected || !identityReady) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const operation = reserveClientOperation("order-after-sales-create", { orderId: selected.id, createForm, expected }, createOperationRef.current);
      createOperationRef.current = operation;
      const created = await createOrderAfterSalesCase(selected.id, { ...expected, ...createForm, operationKey: operation.key });
      createOperationRef.current = completeClientOperation(createOperationRef.current, operation.key);
      setRecords((rows) => [created, ...rows.filter((item) => item.id !== created.id)]);
      setRecordsFresh(true);
      setResolveForm((current) => ({ ...current, caseId: created.id }));
      setCreateForm(EMPTY_CREATE_FORM);
      setNotice(`售后 case ${created.id} 已创建，处理前不会改动订单付款状态。`);
    } catch (cause) {
      setError(salesError(cause, "售后 case 创建失败"));
    } finally {
      setBusy(false);
    }
  }

  async function submitResolve() {
    if (!selected || !identityReady || !resolveForm.caseId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const operation = reserveClientOperation("order-after-sales-resolve", { orderId: selected.id, resolveForm, expected }, resolveOperationRef.current);
      resolveOperationRef.current = operation;
      const resolved = await resolveOrderAfterSalesCase(selected.id, resolveForm.caseId, { ...expected, ...resolveForm, operationKey: operation.key });
      resolveOperationRef.current = completeClientOperation(resolveOperationRef.current, operation.key);
      setRecords((rows) => rows.map((item) => item.id === resolved.id ? resolved : item));
      setRecordsFresh(true);
      setResolveForm(EMPTY_RESOLVE_FORM);
      setNotice(`售后 case ${resolved.id} 已记录内部处理结论；仍需回到客户会话确认回访结果。`);
    } catch (cause) {
      setError(salesError(cause, "售后 case 处理失败"));
    } finally {
      setBusy(false);
    }
  }

  const createNeedsAmount = createForm.type === "refund" || createForm.type === "compensation";
  const canCreate = Boolean(recordsFresh && identityReady && createForm.reason.trim() && (!createNeedsAmount || Number(createForm.requestedAmountCny) > 0));
  const canResolve = Boolean(
    recordsFresh
      && identityReady
      && resolveForm.caseId
      && (!resolutionNeedsAmount(resolveForm.resolutionType) || Number(resolveForm.approvedAmountCny) > 0)
      && (!resolutionNeedsAmount(resolveForm.resolutionType) || (resolveForm.refundMethod.trim() && resolveForm.refundReference.trim()))
      && (resolveForm.resolutionType !== "replacement" || (isValidCarrier(resolveForm.replacementCarrier) && isValidTrackingNo(resolveForm.replacementTrackingNo))),
  );

  return (
    <section className={styles.page} aria-label="订单售后处理">
      <SalesHeader
        eyebrow="销售 / 订单售后"
        title="售后/退款/补发处理"
        detail="先创建售后 case，再记录退款流水、补发物流或拒绝原因；不直接绕过审核修改订单状态。"
        actions={(
          <button type="button" data-action-id="sales-after-sales-refresh" disabled={loading || loadingRecords} onClick={() => { void refresh(); void refreshCases(); }}>
            <RefreshCw size={16} aria-hidden="true" />刷新
          </button>
        )}
      />
      {orderError || error ? <SalesNotice tone="danger">{error || orderError}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {loading ? (
        <SalesEmpty title="正在读取订单" detail={`订单 ${orderId}`} busy />
      ) : selected ? (
        <>
          <AfterSalesOrderSummary selected={selected} expected={expected} identityReady={identityReady} paymentSummary={paymentSummary} openCaseCount={recordsLoaded ? openCases.length : null} />
          {!recordsFresh && !loadingRecords ? <SalesNotice tone="danger">{recordsLoaded ? "售后记录最新刷新失败，已保留上次内容，但创建、处理和经验沉淀均保持禁用；请刷新恢复。" : "售后记录尚未成功读取，创建、处理和经验沉淀均已禁用；请刷新后再操作。"}</SalesNotice> : null}
          <CreateAfterSalesForm busy={busy || loadingRecords} canCreate={canCreate} createForm={createForm} createNeedsAmount={createNeedsAmount} identityReady={identityReady} onSubmit={submitCreate} onUpdate={updateCreate} />
          <ResolveAfterSalesForm busy={busy || loadingRecords} canResolve={canResolve} identityReady={identityReady} onSubmit={submitResolve} onUpdate={updateResolve} openCases={openCases} recordsLoaded={recordsFresh} resolveForm={resolveForm} />
          <AfterSalesCaseList loaded={recordsLoaded} loadingRecords={loadingRecords} orderId={selected.id} records={records} />
          <AfterSalesNextSteps loaded={recordsFresh} order={selected} records={records} />
        </>
      ) : (
        <SalesEmpty
          title={loaded ? "没有找到订单" : "订单状态未确认"}
          detail={loaded ? "读取成功，请返回订单列表重新选择。" : "订单列表尚未成功读取，已阻止售后操作。"}
        />
      )}
    </section>
  );
}
