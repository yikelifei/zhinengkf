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
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setLoaded(false);
    try {
      const rows = await getQuotes();
      setRecords(rows);
      setLoaded(true);
    } catch (cause) {
      setRecords([]);
      setLoaded(false);
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

  return { records, selected, loading, loaded, error, refresh, replace };
}

export function useSalesOrders(orderId = "") {
  const [records, setRecords] = useState<OrderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setLoaded(false);
    try {
      const rows = await getOrderDrafts();
      setRecords(rows);
      setLoaded(true);
    } catch (cause) {
      setRecords([]);
      setLoaded(false);
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

  return { records, selected, loading, loaded, error, refresh, replace };
}
