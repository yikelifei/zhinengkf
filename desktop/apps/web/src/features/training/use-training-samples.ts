"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTrainingSamples, type IdentityFilters, type TrainingSample, type TrainingSampleQualityApiFilter } from "../../lib/api";

export function useTrainingSamples(identityFilters?: IdentityFilters, quality: TrainingSampleQualityApiFilter = "all") {
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    setLoaded(false);
    try {
      const nextSamples = await getTrainingSamples({ ...stableIdentityFilters, quality, limit: 200 });
      if (sequence !== refreshSequence.current) return;
      setSamples(nextSamples);
      setLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setSamples([]);
      setError(caught instanceof Error ? caught.message : "训练样本读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [quality, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  return { samples, loaded, busy, error, refresh };
}
