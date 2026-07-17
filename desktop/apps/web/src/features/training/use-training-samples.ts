"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTrainingSamples, type IdentityFilters, type TrainingSample, type TrainingSampleQualityApiFilter } from "../../lib/api";

export function useTrainingSamples(identityFilters?: IdentityFilters, quality: TrainingSampleQualityApiFilter = "all") {
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    try {
      const nextSamples = await getTrainingSamples({ ...stableIdentityFilters, quality, limit: 200 });
      if (sequence !== refreshSequence.current) return;
      setSamples(nextSamples);
      if (!nextSamples.length) {
        setError("训练样本接口返回空结果；当前客户端无法区分真实空列表与读取失败，未将其视为无需复核。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "训练样本读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [quality, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  return { samples, busy, error, refresh };
}
