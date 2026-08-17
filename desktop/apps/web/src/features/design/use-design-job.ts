"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignJob, IdentityFilters } from "../../lib/api";
import { getVerifiedDesignJobs } from "./api";
import { errorText } from "./design-ui";

export function useDesignJobs(jobId = "", filters: IdentityFilters = {}) {
  const [records, setRecords] = useState<DesignJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);
  const hasSuccessfulRead = useRef(false);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const next = await getVerifiedDesignJobs(filters);
      if (sequence !== requestSequence.current) return;
      setRecords(next);
      setLoaded(true);
      hasSuccessfulRead.current = true;
      if (jobId && !next.some((job) => job.id === jobId)) {
        setError(`未找到设计任务 ${jobId}，请返回任务列表重新选择。`);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        if (!hasSuccessfulRead.current) {
          setRecords([]);
          setLoaded(false);
        }
        setError(errorText(cause, hasSuccessfulRead.current ? "设计任务刷新失败，仍显示上次成功结果" : "设计任务读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [filters.conversationId, filters.customerId, filters.wechatAccountId, jobId]);

  useEffect(() => {
    void refresh();
    return () => { requestSequence.current += 1; };
  }, [refresh]);

  const selected = useMemo(
    () => records.find((record) => record.id === jobId) || null,
    [jobId, records],
  );

  function replace(next: DesignJob) {
    setRecords((rows) => rows.map((row) => row.id === next.id ? next : row));
  }

  return { records, selected, loading, loaded, error, refresh, replace };
}
