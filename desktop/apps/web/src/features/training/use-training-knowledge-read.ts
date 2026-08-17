"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  getAgents,
  getTrainingKnowledgeEntries,
  type Agent,
  type IdentityFilters,
} from "../../lib/api";
import {
  resolveTrainingHistoryRead,
  scopedTrainingHistoryValue,
  unknownTrainingHistoryRead,
} from "./training-import-history-read-state";
import type { KnowledgeEntryRecord } from "./training-knowledge-page-model";

const EMPTY_KNOWLEDGE_ENTRIES: KnowledgeEntryRecord[] = [];
const EMPTY_AGENTS: Agent[] = [];

export function useTrainingKnowledgeRead(stableIdentityFilters: IdentityFilters) {
  const [entriesRead, setEntriesRead] = useState(() => unknownTrainingHistoryRead(EMPTY_KNOWLEDGE_ENTRIES));
  const [agentsRead, setAgentsRead] = useState(() => unknownTrainingHistoryRead(EMPTY_AGENTS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const scopeKey = useMemo(() => JSON.stringify(stableIdentityFilters), [stableIdentityFilters]);
  const entries = scopedTrainingHistoryValue(entriesRead, scopeKey, EMPTY_KNOWLEDGE_ENTRIES);
  const agents = scopedTrainingHistoryValue(agentsRead, scopeKey, EMPTY_AGENTS);
  const entriesReadState = entriesRead.scopeKey === scopeKey ? entriesRead.status : "unknown";
  const agentsReadState = agentsRead.scopeKey === scopeKey ? agentsRead.status : "unknown";

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    try {
      const results = await Promise.allSettled([
        getTrainingKnowledgeEntries(stableIdentityFilters),
        getAgents(stableIdentityFilters),
      ] as const);
      if (sequence !== refreshSequence.current) return;
      const entriesResult = results[0].status === "fulfilled"
        ? { status: "fulfilled" as const, value: Array.isArray(results[0].value) ? results[0].value : EMPTY_KNOWLEDGE_ENTRIES }
        : results[0];
      const agentsResult = results[1].status === "fulfilled"
        ? { status: "fulfilled" as const, value: Array.isArray(results[1].value) ? results[1].value : EMPTY_AGENTS }
        : results[1];
      setEntriesRead((current) => resolveTrainingHistoryRead(current, scopeKey, entriesResult, EMPTY_KNOWLEDGE_ENTRIES));
      setAgentsRead((current) => resolveTrainingHistoryRead(current, scopeKey, agentsResult, EMPTY_AGENTS));
      const failures = [
        entriesResult.status === "rejected" ? "知识条目刷新失败；同一身份范围的上次成功内容仅供查看，复核已禁用" : "",
        agentsResult.status === "rejected" ? "Agent 目录刷新失败；新增知识已禁用" : "",
      ].filter(Boolean);
      setError(failures.join("；"));
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      const rejected = { status: "rejected" as const, reason: caught };
      setEntriesRead((current) => resolveTrainingHistoryRead(current, scopeKey, rejected, EMPTY_KNOWLEDGE_ENTRIES));
      setAgentsRead((current) => resolveTrainingHistoryRead(current, scopeKey, rejected, EMPTY_AGENTS));
      setError(caught instanceof Error ? caught.message : "知识库读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [scopeKey, stableIdentityFilters]);

  const invalidate = useCallback(() => {
    refreshSequence.current += 1;
  }, []);

  return {
    agents,
    agentsReadState,
    busy,
    entries,
    entriesReadState,
    error,
    invalidate,
    refresh,
    scopeKey,
  };
}
