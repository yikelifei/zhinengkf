"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getOrderDrafts,
  getQuotes,
  type OrderDraft,
  type QuoteDraft,
} from "../../lib/api";
import { salesError } from "./sales-ui";

export function useSalesQuotes(quoteId = "") {
  const [records, setRecords] = useState<QuoteDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ambiguousEmpty, setAmbiguousEmpty] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await getQuotes();
      setRecords(rows);
      setAmbiguousEmpty(rows.length === 0);
      if (quoteId && !rows.some((row) => row.id === quoteId)) {
        setError(`未找到报价 ${quoteId}，请返回报价列表重新选择。`);
      }
    } catch (cause) {
      setRecords([]);
      setAmbiguousEmpty(false);
      setError(salesError(cause, "报价读取失败"));
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(
    () => records.find((record) => record.id === quoteId) || null,
    [quoteId, records],
  );

  function replace(next: QuoteDraft) {
    setRecords((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  }

  return { records, selected, loading, error, ambiguousEmpty, refresh, replace };
}

export function useSalesOrders(orderId = "") {
  const [records, setRecords] = useState<OrderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ambiguousEmpty, setAmbiguousEmpty] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await getOrderDrafts();
      setRecords(rows);
      setAmbiguousEmpty(rows.length === 0);
      if (orderId && !rows.some((row) => row.id === orderId)) {
        setError(`未找到订单 ${orderId}，请返回订单列表重新选择。`);
      }
    } catch (cause) {
      setRecords([]);
      setAmbiguousEmpty(false);
      setError(salesError(cause, "订单读取失败"));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(
    () => records.find((record) => record.id === orderId) || null,
    [orderId, records],
  );

  function replace(next: OrderDraft) {
    setRecords((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  }

  return { records, selected, loading, error, ambiguousEmpty, refresh, replace };
}
