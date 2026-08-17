"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getOrderDraft,
  getOrderDrafts,
  getQuoteDraft,
  getQuotes,
  type IdentityFilters,
  type OrderDraft,
  type QuoteDraft,
} from "../../lib/api";
import { salesError } from "./sales-ui";

export function useSalesQuotes(quoteId = "", filters: IdentityFilters = {}) {
  const [records, setRecords] = useState<QuoteDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);
  const hasSuccessfulRead = useRef(false);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const rows = quoteId ? [await getQuoteDraft(quoteId)] : await getQuotes(filters);
      if (sequence !== requestSequence.current) return;
      setRecords(rows);
      setLoaded(true);
      hasSuccessfulRead.current = true;
    } catch (cause) {
      if (sequence === requestSequence.current) {
        if (!hasSuccessfulRead.current) {
          setRecords([]);
          setLoaded(false);
        }
        setError(salesError(cause, hasSuccessfulRead.current ? "报价刷新失败，仍显示上次成功结果" : "报价读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [filters.conversationId, filters.customerId, filters.wechatAccountId, quoteId]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);

  const selected = useMemo(
    () => records.find((record) => record.id === quoteId) || null,
    [quoteId, records],
  );

  function replace(next: QuoteDraft) {
    setRecords((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  }

  return { records, selected, loading, loaded, error, refresh, replace };
}

export function useSalesOrders(orderId = "", filters: IdentityFilters = {}) {
  const [records, setRecords] = useState<OrderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);
  const hasSuccessfulRead = useRef(false);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const rows = orderId ? [await getOrderDraft(orderId)] : await getOrderDrafts(filters);
      if (sequence !== requestSequence.current) return;
      setRecords(rows);
      setLoaded(true);
      hasSuccessfulRead.current = true;
    } catch (cause) {
      if (sequence === requestSequence.current) {
        if (!hasSuccessfulRead.current) {
          setRecords([]);
          setLoaded(false);
        }
        setError(salesError(cause, hasSuccessfulRead.current ? "订单刷新失败，仍显示上次成功结果" : "订单读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [filters.conversationId, filters.customerId, filters.wechatAccountId, orderId]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);

  const selected = useMemo(
    () => records.find((record) => record.id === orderId) || null,
    [orderId, records],
  );

  function replace(next: OrderDraft) {
    setRecords((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  }

  return { records, selected, loading, loaded, error, refresh, replace };
}
