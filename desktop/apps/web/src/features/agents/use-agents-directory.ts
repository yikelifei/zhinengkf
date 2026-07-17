"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAgents, type Agent, type IdentityFilters } from "../../lib/api";

export function useAgentsDirectory(identityFilters?: IdentityFilters) {
  const [agents, setAgents] = useState<Agent[]>([]);
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
      const nextAgents = await getAgents(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setAgents(nextAgents);
      if (!nextAgents.length) {
        setError("智能体接口返回空结果；当前客户端无法区分真实空目录与读取失败，目录状态保持未确认。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "智能体读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  return { agents, busy, error, refresh };
}
