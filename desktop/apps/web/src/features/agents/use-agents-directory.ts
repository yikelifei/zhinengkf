"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAgents, type Agent, type IdentityFilters } from "../../lib/api";

export function useAgentsDirectory(identityFilters?: IdentityFilters) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(false);
    try {
      const nextAgents = await getAgents(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setAgents(nextAgents);
      setLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setAgents([]);
      setError(caught instanceof Error ? caught.message : "智能体读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  return { agents, loaded, busy, error, refresh };
}
