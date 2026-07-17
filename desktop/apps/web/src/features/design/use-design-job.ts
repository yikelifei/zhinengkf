"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignJob } from "../../lib/api";
import { getVerifiedDesignJobs } from "./api";
import { errorText } from "./design-ui";

export function useDesignJobs(jobId = "") {
  const [records, setRecords] = useState<DesignJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await getVerifiedDesignJobs();
      setRecords(next);
      if (jobId && !next.some((job) => job.id === jobId)) {
        setError(`未找到设计任务 ${jobId}，请返回任务列表重新选择。`);
      }
    } catch (cause) {
      setRecords([]); setError(errorText(cause, "设计任务读取失败"));
    } finally { setLoading(false); }
  }, [jobId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(
    () => records.find((record) => record.id === jobId) || null,
    [jobId, records],
  );

  function replace(next: DesignJob) {
    setRecords((rows) => rows.map((row) => row.id === next.id ? next : row));
  }

  return { records, selected, loading, error, refresh, replace };
}
