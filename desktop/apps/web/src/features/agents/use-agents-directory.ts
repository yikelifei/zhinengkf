"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAgents, type Agent, type IdentityFilters } from "../../lib/api";
import { agentDirectoryReadState, agentDirectoryScopeKey } from "./agent-directory-read-state";

export function useAgentsDirectory(identityFilters?: IdentityFilters) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [staleScopeKey, setStaleScopeKey] = useState("");
  const loadedScopeKeyRef = useRef(loadedScopeKey);
  loadedScopeKeyRef.current = loadedScopeKey;
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const scopeKey = useMemo(() => agentDirectoryScopeKey(stableIdentityFilters), [stableIdentityFilters]);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const requestScopeKey = scopeKey;
    setBusy(true);
    setError("");
    try {
      const nextAgents = await getAgents(stableIdentityFilters);
      if (sequence !== refreshSequence.current || scopeKeyRef.current !== requestScopeKey) return;
      setAgents(nextAgents);
      setLoadedScopeKey(requestScopeKey);
      setStaleScopeKey("");
    } catch (caught) {
      if (sequence !== refreshSequence.current || scopeKeyRef.current !== requestScopeKey) return;
      const detail = caught instanceof Error ? caught.message : "智能体读取失败。";
      if (loadedScopeKeyRef.current === requestScopeKey) {
        setStaleScopeKey(requestScopeKey);
        setError(`智能体目录刷新失败，当前保留同一身份范围上次成功读取的结果；执行技能前请重新刷新。${detail}`);
      } else {
        setError(detail);
      }
    } finally {
      if (sequence === refreshSequence.current && scopeKeyRef.current === requestScopeKey) setBusy(false);
    }
  }, [scopeKey, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  const readState = agentDirectoryReadState({ busy, currentScopeKey: scopeKey, loadedScopeKey, staleScopeKey });
  const scopedAgents = loadedScopeKey === scopeKey ? agents : [];

  return {
    agents: scopedAgents,
    loaded: readState === "ready" || readState === "stale",
    readState,
    busy,
    error,
    refresh,
  };
}
