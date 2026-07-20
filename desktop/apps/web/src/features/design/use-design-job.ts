"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignJob } from "../../lib/api";
import { getVerifiedDesignJobs } from "./api";
import { errorText } from "./design-ui";

export function useDesignJobs(jobId = "") {
  const [records, setRecords] = useState<DesignJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setLoaded(false);
    try {
      const next = await getVerifiedDesignJobs();
      if (sequence !== requestSequence.current) return;
      setRecords(next);
      setLoaded(true);
      if (jobId && !next.some((job) => job.id === jobId)) {
        setError(`未找到设计任务 ${jobId}，请返回任务列表重新选择。`);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setRecords([]); setLoaded(false); setError(errorText(cause, "设计任务读取失败"));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [jobId]);

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
