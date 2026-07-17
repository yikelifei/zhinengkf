"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Sku, SkuCatalogAudit } from "../../lib/api";
import { getSkuCatalogAudit, getVerifiedSkus } from "./api";
import { catalogError } from "./catalog-ui";

export function useCatalogProducts(skuCode = "") {
  const [records, setRecords] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await getVerifiedSkus(true);
      setRecords(next);
      if (skuCode && !next.some((sku) => sku.skuCode === skuCode)) {
        setError(`未找到商品 ${skuCode}，请返回商品列表重新选择。`);
      }
    } catch (cause) {
      setRecords([]); setError(catalogError(cause, "商品读取失败"));
    } finally { setLoading(false); }
  }, [skuCode]);

  useEffect(() => { void refresh(); }, [refresh]);
  const selected = useMemo(
    () => records.find((record) => record.skuCode === skuCode) || null,
    [records, skuCode],
  );

  function replace(next: Sku) {
    setRecords((rows) => rows.some((row) => row.skuCode === next.skuCode)
      ? rows.map((row) => row.skuCode === next.skuCode ? next : row)
      : [next, ...rows]);
  }

  return { records, selected, loading, error, refresh, replace };
}

export function useCatalogRepairQueue(skuCode = "") {
  const [audit, setAudit] = useState<SkuCatalogAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await getSkuCatalogAudit();
      setAudit(next);
      if (skuCode && !next.repairQueue?.some((item) => item.skuCode === skuCode)) {
        setError(`未找到修复任务 ${skuCode}，它可能已完成或已从队列移除。`);
      }
    } catch (cause) {
      setAudit(null); setError(catalogError(cause, "修复队列读取失败"));
    } finally { setLoading(false); }
  }, [skuCode]);

  useEffect(() => { void refresh(); }, [refresh]);
  const selected = useMemo(
    () => audit?.repairQueue?.find((item) => item.skuCode === skuCode) || null,
    [audit, skuCode],
  );

  return { audit, selected, loading, error, refresh };
}
