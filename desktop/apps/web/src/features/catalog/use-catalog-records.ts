"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sku, SkuCatalogAudit } from "../../lib/api";
import { getSkuCatalogAudit, getVerifiedSkus } from "./api";
import { catalogError } from "./catalog-ui";

export function useCatalogProducts(skuCode = "") {
  const [records, setRecords] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setLoaded(false);
    try {
      const next = await getVerifiedSkus(true);
      if (sequence !== requestSequence.current) return;
      setRecords(next);
      setLoaded(true);
      if (skuCode && !next.some((sku) => sku.skuCode === skuCode)) {
        setError(`未找到商品 ${skuCode}，请返回商品列表重新选择。`);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setRecords([]); setLoaded(false); setError(catalogError(cause, "商品读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [skuCode]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);
  const selected = useMemo(
    () => records.find((record) => record.skuCode === skuCode) || null,
    [records, skuCode],
  );

  function replace(next: Sku) {
    setRecords((rows) => rows.some((row) => row.skuCode === next.skuCode)
      ? rows.map((row) => row.skuCode === next.skuCode ? next : row)
      : [next, ...rows]);
  }

  return { records, selected, loading, loaded, error, refresh, replace };
}

export function useCatalogRepairQueue(skuCode = "") {
  const [audit, setAudit] = useState<SkuCatalogAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setLoaded(false);
    try {
      const next = await getSkuCatalogAudit();
      if (sequence !== requestSequence.current) return;
      setAudit(next);
      setLoaded(true);
      if (skuCode && !next.repairQueue?.some((item) => item.skuCode === skuCode)) {
        setError(`未找到修复任务 ${skuCode}，它可能已完成或已从队列移除。`);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setAudit(null); setLoaded(false); setError(catalogError(cause, "商品审计读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [skuCode]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);
  const selected = useMemo(
    () => audit?.repairQueue?.find((item) => item.skuCode === skuCode) || null,
    [audit, skuCode],
  );

  return { audit, selected, loading, loaded, error, refresh };
}
