"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySkillSuggestions,
  getSkillSuggestions,
  type ApplySkillSuggestionsResult,
  type IdentityFilters,
  type SkillSuggestion,
} from "../../lib/api";
import styles from "../governance-pages.module.css";
import { TrainingIdentityScopeNotice, trainingIdentityScopeLabel } from "./training-identity-navigation";

const MINIMUM_SCORE = 70;

export type TrainingSkillsPageProps = {
  identityFilters?: IdentityFilters;
};

export function TrainingSkillsPage({ identityFilters }: TrainingSkillsPageProps) {
  const [storedSuggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const [staleScopeKey, setStaleScopeKey] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [includeNeedsReview, setIncludeNeedsReview] = useState(false);
  const [lastResult, setLastResult] = useState<ApplySkillSuggestionsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const refreshSequence = useRef(0);
  const loadedScopeKeyRef = useRef("");
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const scopeKey = useMemo(() => JSON.stringify(stableIdentityFilters), [stableIdentityFilters]);
  const scopeLoaded = loadedScopeKey === scopeKey;
  const readState = !scopeLoaded ? "unknown" : staleScopeKey === scopeKey ? "stale" : "ready";
  const suggestions = scopeLoaded ? storedSuggestions : [];
  const suggestionsLoaded = readState !== "unknown";

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const requestScopeKey = scopeKey;
    setBusy(true);
    setError("");
    try {
      const nextSuggestions = await getSkillSuggestions({ ...stableIdentityFilters, minScore: MINIMUM_SCORE });
      if (sequence !== refreshSequence.current) return;
      setSuggestions(nextSuggestions);
      loadedScopeKeyRef.current = requestScopeKey;
      setLoadedScopeKey(requestScopeKey);
      setStaleScopeKey("");
      setSelectedKeys(new Set());
      setPendingConfirmation(false);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      if (loadedScopeKeyRef.current === requestScopeKey) setStaleScopeKey(requestScopeKey);
      setError(caught instanceof Error ? caught.message : "技能建议读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [scopeKey, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const selectedSuggestions = useMemo(
    () => suggestions.filter((suggestion) => selectedKeys.has(suggestion.suggestionKey)),
    [selectedKeys, suggestions],
  );

  const toggleSelection = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const requestApply = () => {
    setError("");
    setNotice("");
    if (readState !== "ready") {
      setError("技能建议不是当前身份范围的最新可信结果，已阻止应用；请刷新成功后重试。");
      return;
    }
    if (!selectedSuggestions.length) {
      setError("请先勾选需要应用的技能建议。");
      return;
    }
    const blocked = selectedSuggestions.filter((suggestion) => suggestionBlocked(suggestion, stableIdentityFilters));
    if (blocked.length) {
      setError(`有 ${blocked.length} 条建议被质量或身份范围阻断，不能进入应用确认。`);
      return;
    }
    const needsReview = selectedSuggestions.filter((suggestion) => suggestion.quality?.needsReview === true);
    if (needsReview.length && !includeNeedsReview) {
      setError(`有 ${needsReview.length} 条建议需要人工复核。请明确勾选“包含需复核建议”后重新确认。`);
      return;
    }
    const agents = new Set(selectedSuggestions.map((suggestion) => suggestion.agentId).filter(Boolean));
    if (agents.size > 1) {
      setError("所选建议属于多个智能体，已阻止跨智能体批量应用。请分批处理。");
      return;
    }
    setPendingConfirmation(true);
  };

  const confirmApply = useCallback(async () => {
    if (readState !== "ready") {
      setError("确认前技能建议已过期或身份范围已变化，应用操作已阻止。");
      setPendingConfirmation(false);
      return;
    }
    const selected = suggestions.filter((suggestion) => selectedKeys.has(suggestion.suggestionKey));
    if (!selected.length || selected.some((suggestion) => suggestionBlocked(suggestion, stableIdentityFilters))) {
      setError("建议状态或身份范围已经变化，应用操作已阻止。");
      setPendingConfirmation(false);
      return;
    }
    if (selected.some((suggestion) => suggestion.quality?.needsReview === true) && !includeNeedsReview) {
      setError("需复核建议未获得明确包含确认，应用操作已阻止。");
      setPendingConfirmation(false);
      return;
    }
    const agentIds = [...new Set(selected.map((suggestion) => suggestion.agentId).filter((value): value is string => Boolean(value)))];
    if (agentIds.length > 1) {
      setError("确认前发现多个智能体，应用操作已阻止。");
      setPendingConfirmation(false);
      return;
    }
    const targetAgentId = stableIdentityFilters.agentId || agentIds[0];

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await applySkillSuggestions({
        ...stableIdentityFilters,
        agentId: targetAgentId,
        minScore: MINIMUM_SCORE,
        suggestionKeys: selected.map((suggestion) => suggestion.suggestionKey),
        includeNeedsReview,
      });
      setLastResult(result);
      setNotice(`服务端已应用 ${result.applied ?? result.created.length + result.updated.length} 条技能建议。`);
      setPendingConfirmation(false);
      setSelectedKeys(new Set());
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "技能建议应用失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [includeNeedsReview, readState, refresh, selectedKeys, stableIdentityFilters, suggestions]);

  return (
    <section className={styles.page} aria-labelledby="training-skills-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Training</span>
          <h1 id="training-skills-title">Agent Skill 建议</h1>
          <p className={styles.description}>从已复核样本提炼可应用 Skill；应用后写入智能客服 Agent，回复草稿会读取这些 Skill 来更像真人客服。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="training-skills-refresh"
          aria-label="刷新技能建议"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新建议
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {readState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">刷新失败，当前仅展示同一身份范围上次成功读取的建议；应用操作已禁用。</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      <TrainingIdentityScopeNotice identityFilters={stableIdentityFilters} />

      <section className={styles.summaryGrid} aria-label="Agent Skill 建议摘要">
        <div className={styles.summaryCard}><span>建议总数</span><strong>{suggestionsLoaded ? suggestions.length : "—"}</strong></div>
        <div className={styles.summaryCard}><span>已选择</span><strong>{suggestionsLoaded ? selectedSuggestions.length : "—"}</strong></div>
        <div className={styles.summaryCard}><span>需复核</span><strong>{suggestionsLoaded ? suggestions.filter((item) => item.quality?.needsReview).length : "—"}</strong></div>
        <div className={styles.summaryCard}><span>已阻断</span><strong>{suggestionsLoaded ? suggestions.filter((item) => suggestionBlocked(item, stableIdentityFilters)).length : "—"}</strong></div>
      </section>

      <section className={styles.panel} aria-labelledby="skill-suggestion-list-title">
        <header className={styles.panelHeader}><div><h2 id="skill-suggestion-list-title">待写入 Agent 的 Skill</h2><p>最低样本评分阈值为 {MINIMUM_SCORE}，每条 Skill 仍需人工勾选后才会应用。</p></div></header>
        <div className={styles.panelBody}>
          <div className={styles.actionBar}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={includeNeedsReview} disabled={busy || readState !== "ready"} onChange={(event) => setIncludeNeedsReview(event.target.checked)} />
              明确包含需复核建议
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="training-skills-apply-request"
              aria-label="请求应用所选技能建议"
              onClick={requestApply}
              disabled={busy || readState !== "ready" || !selectedSuggestions.length}
            >
              核对所选并应用
            </button>
          </div>

          {suggestions.length ? (
            <div className={styles.recordList}>
              {suggestions.map((suggestion) => {
                const blocked = suggestionBlocked(suggestion, stableIdentityFilters);
                const needsReview = suggestion.quality?.needsReview === true;
                const mixed = suggestion.scope?.level === "mixed";
                return (
                  <article className={styles.record} key={suggestion.suggestionKey}>
                    <div className={styles.recordHeader}>
                      <label className={styles.checkLabel}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(suggestion.suggestionKey)}
                          onChange={(event) => toggleSelection(suggestion.suggestionKey, event.target.checked)}
                          disabled={blocked || busy || readState !== "ready"}
                          aria-label={`选择技能建议${suggestion.name}`}
                        />
                        <span><strong>{suggestion.name}</strong><small> · {suggestion.agentKey}</small></span>
                      </label>
                      <span className={`${styles.badge} ${blocked ? styles.toneError : needsReview ? styles.toneWarning : styles.toneOk}`}>
                        {mixed ? "身份混合" : blocked ? "已阻断" : needsReview ? "需复核" : "可确认"}
                      </span>
                    </div>
                    <p>{suggestion.description}</p>
                    <div className={styles.recordMeta}>
                      <span>{suggestion.action === "create" ? "新建 Skill" : "更新 Skill"}</span>
                      <span>{suggestion.sampleCount} 条证据</span>
                      <span>置信度 {formatScore(suggestion.confidence)}</span>
                      <span>{suggestion.scope?.label || "全局范围"}</span>
                    </div>
                    <p className={styles.helpText}>{suggestion.quality?.reason || suggestion.scope?.reason || "服务端未提供补充判断。"}</p>
                  </article>
                );
              })}
            </div>
          ) : <div className={styles.empty}>{suggestionsLoaded
            ? "读取成功，当前没有符合阈值的技能建议。"
            : "技能建议尚未成功读取，当前状态未确认。"}</div>}
        </div>
      </section>

      {pendingConfirmation ? (
          <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="training-skills-confirm-title">
          <strong id="training-skills-confirm-title">确认应用技能建议</strong>
          <p>将把 {selectedSuggestions.length} 条人工勾选的建议写入 Agent Skill；{includeNeedsReview ? "其中允许包含已明确复核的风险建议" : "不包含需复核建议"}。</p>
          <p>身份范围：{trainingIdentityScopeLabel(stableIdentityFilters)}</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="training-skills-apply-confirm"
              aria-label="确认应用所选技能建议"
              onClick={() => void confirmApply()}
              disabled={busy || readState !== "ready"}
            >
              确认应用
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="training-skills-apply-cancel"
              aria-label="取消应用技能建议"
              onClick={() => setPendingConfirmation(false)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </section>
      ) : null}

      {lastResult ? (
        <section className={styles.notice} aria-label="最近一次应用结果">
          <strong>最近结果</strong>
          <p>新建 {lastResult.created.length}，更新 {lastResult.updated.length}，跳过 {lastResult.skipped.length}，阻断 {lastResult.blocked?.length || 0}。</p>
        </section>
      ) : null}
    </section>
  );
}

function suggestionBlocked(suggestion: SkillSuggestion, filters: IdentityFilters) {
  if (filters.agentId && suggestion.agentId && suggestion.agentId !== filters.agentId) return true;
  if (suggestion.quality?.blocked || suggestion.quality?.level === "blocked") return true;
  if (suggestion.scope?.level === "mixed") return true;
  const scope = suggestion.scope;
  if (!scope) return false;
  if (scope.wechatAccountId && scope.wechatAccountId !== filters.wechatAccountId) return true;
  if (scope.conversationId && scope.conversationId !== filters.conversationId) return true;
  if (scope.customerId && scope.customerId !== filters.customerId) return true;
  return false;
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}
