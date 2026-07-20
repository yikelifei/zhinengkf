"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    setLoaded(false);
    try {
      const rows = await getQuotes();
      if (sequence !== requestSequence.current) return;
      setRecords(rows);
      setLoaded(true);
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setRecords([]);
        setLoaded(false);
        setError(salesError(cause, "报价读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [quoteId]);

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

export function useSalesOrders(orderId = "") {
  const [records, setRecords] = useState<OrderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    setLoaded(false);
    try {
      const rows = await getOrderDrafts();
      if (sequence !== requestSequence.current) return;
      setRecords(rows);
      setLoaded(true);
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setRecords([]);
        setLoaded(false);
        setError(salesError(cause, "订单读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [orderId]);

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
