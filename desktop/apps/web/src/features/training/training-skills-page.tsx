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

const MINIMUM_SCORE = 70;

export type TrainingSkillsPageProps = {
  identityFilters?: IdentityFilters;
};

export function TrainingSkillsPage({ identityFilters }: TrainingSkillsPageProps) {
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [includeNeedsReview, setIncludeNeedsReview] = useState(false);
  const [lastResult, setLastResult] = useState<ApplySkillSuggestionsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
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
      const nextSuggestions = await getSkillSuggestions({ ...stableIdentityFilters, minScore: MINIMUM_SCORE });
      if (sequence !== refreshSequence.current) return;
      setSuggestions(nextSuggestions);
      setSelectedKeys(new Set());
      setPendingConfirmation(false);
      if (!nextSuggestions.length) {
        setError("技能建议接口返回空结果；当前客户端无法区分真实无建议与读取失败，状态保持未确认。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "技能建议读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

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

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await applySkillSuggestions({
        ...stableIdentityFilters,
        agentId: agentIds[0],
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
  }, [includeNeedsReview, refresh, selectedKeys, stableIdentityFilters, suggestions]);

  return (
    <section className={styles.page} aria-labelledby="training-skills-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Training</span>
          <h1 id="training-skills-title">技能建议</h1>
          <p className={styles.description}>只处理服务端从已复核样本生成的技能建议；身份混合或质量阻断项默认不可应用。</p>
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
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

      <section className={styles.summaryGrid} aria-label="技能建议摘要">
        <div className={styles.summaryCard}><span>建议总数</span><strong>{suggestions.length}</strong></div>
        <div className={styles.summaryCard}><span>已选择</span><strong>{selectedSuggestions.length}</strong></div>
        <div className={styles.summaryCard}><span>需复核</span><strong>{suggestions.filter((item) => item.quality?.needsReview).length}</strong></div>
        <div className={styles.summaryCard}><span>已阻断</span><strong>{suggestions.filter((item) => suggestionBlocked(item, stableIdentityFilters)).length}</strong></div>
      </section>

      <section className={styles.panel} aria-labelledby="skill-suggestion-list-title">
        <header className={styles.panelHeader}><div><h2 id="skill-suggestion-list-title">待应用建议</h2><p>最低样本评分阈值为 {MINIMUM_SCORE}，每条建议仍需人工勾选。</p></div></header>
        <div className={styles.panelBody}>
          <div className={styles.actionBar}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={includeNeedsReview} onChange={(event) => setIncludeNeedsReview(event.target.checked)} />
              明确包含需复核建议
            </label>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="training-skills-apply-request"
              aria-label="请求应用所选技能建议"
              onClick={requestApply}
              disabled={busy || !selectedSuggestions.length}
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
                          disabled={blocked}
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
                      <span>{suggestion.action === "create" ? "新建技能" : "更新技能"}</span>
                      <span>{suggestion.sampleCount} 条证据</span>
                      <span>置信度 {formatScore(suggestion.confidence)}</span>
                      <span>{suggestion.scope?.label || "全局范围"}</span>
                    </div>
                    <p className={styles.helpText}>{suggestion.quality?.reason || suggestion.scope?.reason || "服务端未提供补充判断。"}</p>
                  </article>
                );
              })}
            </div>
          ) : <div className={styles.empty}>服务端没有返回符合阈值的技能建议。</div>}
        </div>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="training-skills-confirm-title">
          <strong id="training-skills-confirm-title">确认应用技能建议</strong>
          <p>将应用 {selectedSuggestions.length} 条人工勾选的建议；{includeNeedsReview ? "其中允许包含已明确复核的风险建议" : "不包含需复核建议"}。</p>
          <p>身份范围：{identityScopeLabel(stableIdentityFilters)}</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="training-skills-apply-confirm"
              aria-label="确认应用所选技能建议"
              onClick={() => void confirmApply()}
              disabled={busy}
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
  if (suggestion.quality?.blocked || suggestion.quality?.level === "blocked") return true;
  if (suggestion.scope?.level === "mixed") return true;
  const scope = suggestion.scope;
  if (!scope) return false;
  if (scope.wechatAccountId && scope.wechatAccountId !== filters.wechatAccountId) return true;
  if (scope.conversationId && scope.conversationId !== filters.conversationId) return true;
  if (scope.customerId && scope.customerId !== filters.customerId) return true;
  return false;
}

function identityScopeLabel(filters: IdentityFilters) {
  const values = [filters.wechatAccountId, filters.conversationId, filters.customerId].filter(Boolean);
  return values.length ? values.join(" / ") : "全局范围";
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}
