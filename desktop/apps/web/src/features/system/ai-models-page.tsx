"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, RefreshCw, Zap } from "lucide-react";
import { getAiProviderStatus, probeAiProviderStatus, saveAiProviderCredential, type AiProviderStatus } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useOperatorCapability } from "../access/use-operator-capability";
import { aiProviderPresentation } from "./ai-provider-presentation";
import { AiProviderCredentialSetup } from "./ai-provider-credential-setup";

type LoadMode = "config" | "probe";

export function AiModelsPage() {
  const manageAccess = useOperatorCapability("manage_channels");
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadMode, setLoadMode] = useState<LoadMode>("config");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState("");
  const [readState, setReadState] = useState<"loading" | "ready" | "stale" | "unknown">("loading");
  const [probeConfirmationOpen, setProbeConfirmationOpen] = useState(false);
  const statusRef = useRef<AiProviderStatus | null>(null);

  const refresh = useCallback(async (probe = false) => {
    setBusy(true);
    setLoadMode(probe ? "probe" : "config");
    setError("");
    if (!statusRef.current) setReadState("loading");
    try {
      const nextStatus = probe ? await probeAiProviderStatus() : await getAiProviderStatus();
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      setReadState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "大模型配置状态读取失败。");
      setReadState(statusRef.current ? "stale" : "unknown");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const saveProvider = useCallback(async (provider: AiProviderStatus["providers"][number], enabled: boolean) => {
    if (readState !== "ready" || manageAccess.readState !== "ready" || !manageAccess.allowed) {
      setError("供应商配置或 manage_channels 权限不是最新可信结果；请先刷新，再保存密钥或变更启用状态。");
      return;
    }
    setSavingProvider(provider.name);
    setError("");
    setNotice("");
    try {
      const result = await saveAiProviderCredential(provider.name, {
        apiKey: keyDrafts[provider.name] || undefined,
        enabled,
      });
      setKeyDrafts((current) => ({ ...current, [provider.name]: "" }));
      setNotice(result.detail);
      await refresh(false);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "模型供应商配置保存失败。";
      setError(`配置写入结果未确认；请先刷新配置核对供应商状态，不要立即重复提交。${detail}`);
    } finally {
      setSavingProvider("");
    }
  }, [keyDrafts, manageAccess.allowed, manageAccess.readState, readState, refresh]);

  const configuredProviders = useMemo(
    () => status?.providers.filter((provider) => provider.enabled && provider.configured) || [],
    [status],
  );
  const keyOnlyProviders = useMemo(
    () => status?.providers.filter((provider) => provider.keyOnlySetup) || [],
    [status],
  );
  const primaryProvider = status?.providers.find((provider) => provider.isPrimary);
  const ready = Boolean(readState === "ready" && status?.enabled && configuredProviders.length > 0);
  const fallbackText = status?.fallbackChain.length ? status.fallbackChain.join(" -> ") : "未设置";
  const economyText = status?.routing.economyChain.length
    ? status.routing.economyChain.map(providerLabel).join(" -> ")
    : "未设置";
  const qualityText = status?.routing.qualityChain.length
    ? status.routing.qualityChain.map(providerLabel).join(" -> ")
    : "未设置";
  const adaptiveEconomyText = status?.adaptiveRouting.economyOrder.length
    ? status.adaptiveRouting.economyOrder.map(providerLabel).join(" → ")
    : "暂无可用快速模型";
  const adaptiveQualityText = status?.adaptiveRouting.qualityOrder.length
    ? status.adaptiveRouting.qualityOrder.map(providerLabel).join(" → ")
    : "暂无可用高质量模型";
  const reusesZhenxiAi = primaryProvider?.credentialSource === "zhenxi_ai_shared";
  const pageBusy = busy || manageAccess.busy;
  const configurationTrusted = readState === "ready" && manageAccess.readState === "ready" && manageAccess.allowed && !pageBusy;

  return (
    <section className={styles.page} aria-labelledby="ai-models-page-title" aria-busy={pageBusy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>AI Models</span>
          <h1 id="ai-models-page-title">大模型中心</h1>
          <p className={styles.description}>按问题复杂度、实时响应速度和成功率自主选择模型，慢模型或故障模型会自动降级切换。</p>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            data-action-id="ai-models-refresh"
            onClick={() => void Promise.all([refresh(false), manageAccess.refresh()])}
            disabled={pageBusy}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新配置
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="ai-models-probe"
            onClick={() => setProbeConfirmationOpen(true)}
            disabled={pageBusy || readState !== "ready" || manageAccess.readState !== "ready" || !manageAccess.allowed}
          >
            <Zap size={16} aria-hidden="true" />
            请求实时探活
          </button>
        </div>
      </header>

      <div className={`${styles.notice} ${reusesZhenxiAi ? styles.noticeSuccess : styles.noticeInfo}`} role="note">
        <strong>{reusesZhenxiAi ? "已复用臻希AI模型" : "模型来源检查"}</strong>
        <p>
          {reusesZhenxiAi
            ? "客服软件直接读取臻希AI同一份模型地址、模型名和密钥配置，不复制密钥，也不会在页面或日志中显示密钥。"
            : "当前主模型尚未标记为臻希AI共享来源；配置刷新只读本机设置，探活会发送一次最小化测试请求。"}
        </p>
      </div>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {manageAccess.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">模型配置权限未确认：{manageAccess.error}</div> : null}
      {manageAccess.readState === "ready" && !manageAccess.allowed ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">当前可信操作员未获 manage_channels 权限；离线状态仍可查看，实时探活与配置写入保持禁用。</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      {readState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">最新刷新失败，当前仅展示上次成功读取的旧配置；可用性结论和配置写入均已暂停。</div> : null}

      {probeConfirmationOpen ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="ai-models-probe-confirm-title">
          <strong id="ai-models-probe-confirm-title">确认向已启用供应商发送实时探活请求</strong>
          <p>这不是离线检查：服务端会向已启用且配置完整的上游模型发送最小请求，可能产生费用、配额消耗和外部审计记录。探活失败也不会自动重试。</p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="ai-models-probe-confirm" onClick={() => { if (!configurationTrusted) return; setProbeConfirmationOpen(false); void refresh(true); }} disabled={!configurationTrusted}>确认实时探活</button>
            <button type="button" className={styles.button} data-action-id="ai-models-probe-cancel" onClick={() => setProbeConfirmationOpen(false)} disabled={pageBusy}>取消</button>
          </div>
        </section>
      ) : null}

      {status ? (
        <>
          <AiProviderCredentialSetup
            providers={keyOnlyProviders}
            keyDrafts={keyDrafts}
            savingProvider={savingProvider}
            onKeyChange={(provider, value) => setKeyDrafts((current) => ({ ...current, [provider]: value }))}
            onSave={(provider, enabled) => void saveProvider(provider, enabled)}
            configurationTrusted={configurationTrusted}
          />

          <section className={styles.panel} aria-labelledby="ai-models-summary-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="ai-models-summary-title">运行判断</h2>
                <p>自动客服回复建议只有在引擎启用且至少一个供应商配置完整时才可用。</p>
              </div>
              <span className={`${styles.badge} ${ready ? styles.toneOk : styles.toneError}`}>
                {ready ? "可用于自动建议" : "不可用于自动建议"}
              </span>
            </header>
            <div className={styles.panelBody}>
              <div className={styles.summaryGrid}>
                <SummaryCard label="AI 引擎" value={status.enabled ? "已启用" : "已停用"} />
                <SummaryCard label="可用供应商" value={`${configuredProviders.length}/${status.providers.length}`} />
                <SummaryCard label="模型来源" value={reusesZhenxiAi ? "臻希AI共享配置" : "客服独立配置"} />
                <SummaryCard label="主供应商" value={providerLabel(primaryProvider?.name || status.primary)} />
                <SummaryCard label="当前模型" value={primaryProvider?.model || "未设置"} />
                <SummaryCard label="请求超时" value={`${status.timeoutSeconds}s`} />
                <SummaryCard label="自动切换" value={status.adaptiveRouting.enabled ? "速度与稳定性优先" : "未启用"} />
              </div>
              <dl className={styles.definitionList}>
                <div>
                  <dt>当前快速顺序</dt>
                  <dd>{adaptiveEconomyText}</dd>
                </div>
                <div>
                  <dt>当前高质量顺序</dt>
                  <dd>{adaptiveQualityText}</dd>
                </div>
                <div>
                  <dt>低成本模型链</dt>
                  <dd>{economyText}</dd>
                </div>
                <div>
                  <dt>高质量模型链</dt>
                  <dd>{qualityText}</dd>
                </div>
                <div>
                  <dt>Fallback 链</dt>
                  <dd>{fallbackText}</dd>
                </div>
                <div>
                  <dt>最大重试</dt>
                  <dd>{status.maxRetries}</dd>
                </div>
                <div>
                  <dt>最近读取</dt>
                  <dd>{status.probe ? "已执行探活" : loadMode === "probe" ? "探活未完成" : "离线配置检查"}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="ai-models-providers-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="ai-models-providers-title">供应商状态</h2>
                <p>密钥只在服务端读取，前端仅展示脱敏后的配置完整性和探活结果。</p>
              </div>
              <span className={`${styles.badge} ${status.providers.length ? styles.toneMuted : styles.toneWarning}`}>
                {status.providers.length ? `${status.providers.length} 个供应商` : "未声明供应商"}
              </span>
            </header>
            <div className={styles.panelBody}>
              {status.providers.length ? (
                <div className={styles.recordList}>
                  {status.providers.map((provider) => {
                    const presentation = aiProviderPresentation(provider);
                    return (
                    <article className={styles.record} key={provider.name}>
                      <header className={styles.recordHeader}>
                        <div>
                          <h3>{provider.label || providerLabel(provider.name)}</h3>
                          <p>{provider.model || "模型未设置"} · {provider.name}</p>
                        </div>
                        <span className={`${styles.badge} ${providerToneClass(presentation.tone)}`}>
                          {presentation.label}
                        </span>
                      </header>
                      <div className={styles.recordMeta}>
                        {provider.isPrimary ? <span>主供应商</span> : null}
                        {provider.inFallbackChain ? <span>Fallback</span> : null}
                        {provider.inEconomyChain ? <span>低成本层</span> : null}
                        {provider.inQualityChain ? <span>高质量层</span> : null}
                        <span>{credentialSourceLabel(provider)}</span>
                        <span>{provider.enabled ? "已启用" : "已停用"}</span>
                        <span>{provider.requestFormat}</span>
                        <span>{performanceLabel(provider)}</span>
                        <span>{circuitLabel(provider)}</span>
                        <span className={liveToneClass(provider)}>{liveLabel(provider)}</span>
                      </div>
                      {presentation.actionableIssues.length ? (
                        <ul className={styles.taskList} aria-label={`${provider.name} 配置问题`}>
                          {presentation.actionableIssues.map((issue) => (
                            <li className={styles.taskLink} key={issue}>
                              <span>
                                <strong>{issueLabel(issue)}</strong>
                                <small>{issue}</small>
                              </span>
                              <b>待处理</b>
                            </li>
                          ))}
                        </ul>
                      ) : provider.enabled ? (
                        <div className={`${styles.notice} ${styles.noticeSuccess}`}>
                          <CheckCircle2 size={16} aria-hidden="true" />
                          <p>供应商配置已满足统一模型路由要求。</p>
                        </div>
                      ) : (
                        <div className={`${styles.notice} ${styles.noticeInfo}`}>
                          <CircleAlert size={16} aria-hidden="true" />
                          <p>该供应商已停用，不参与当前主备路由，无需补齐密钥或模型配置。</p>
                        </div>
                      )}
                      {presentation.showRuntimeError ? (
                        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
                          <CircleAlert size={16} aria-hidden="true" />
                          <p>{provider.error}</p>
                        </div>
                      ) : null}
                    </article>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.empty}>
                  <Bot size={22} aria-hidden="true" />
                  <span>尚未在配置文件中声明 AI 供应商，自动建议会保持关闭。</span>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className={styles.panel} aria-label="大模型状态不可用">
          <div className={styles.empty}>尚未取得服务端 AI 供应商状态，自动建议不能据此判定为可用。</div>
        </section>
      )}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function issueLabel(issue: string) {
  return {
    provider_disabled: "供应商未启用",
    api_key_unset: "API Key 未配置",
    base_url_unset: "Base URL 未配置",
    base_url_invalid: "Base URL 格式无效",
    model_unset: "模型未配置",
    request_format_not_openai: "请求格式不兼容",
    request_format_unsupported: "请求格式不受支持",
    credential_source_invalid: "密钥来源配置无效",
    shared_env_missing: "臻希AI共享配置不可读取",
  }[issue] || "未知配置问题";
}

function providerLabel(name?: string) {
  if (!name) return "未设置";
  if (name === "zhenxi_ai") return "臻希AI共享模型";
  if (name === "custom_api_1") return "客服备用模型";
  if (name === "zhipu") return "智谱备用模型";
  if (name === "siliconflow") return "硅基流动";
  if (name === "dashscope") return "阿里云百炼";
  if (name === "volcengine") return "火山方舟";
  if (name === "moonshot") return "Kimi API";
  if (name === "deepseek") return "DeepSeek";
  if (name === "openai") return "OpenAI";
  if (name === "anthropic") return "Anthropic Claude";
  if (name === "gemini") return "Google Gemini";
  if (name === "xai") return "xAI Grok";
  if (name === "groq") return "Groq";
  if (name === "mistral") return "Mistral AI";
  if (name === "together") return "Together AI";
  if (name === "openrouter") return "OpenRouter";
  if (name === "qianfan") return "百度千帆";
  if (name === "hunyuan") return "腾讯混元";
  if (name === "minimax") return "MiniMax";
  if (name === "stepfun") return "阶跃星辰";
  return name;
}

function credentialSourceLabel(provider: AiProviderStatus["providers"][number]) {
  if (provider.credentialSource === "zhenxi_ai_shared") {
    return provider.sharedSourceConfigured ? "复用臻希AI密钥" : "臻希AI共享配置缺失";
  }
  return "客服独立密钥来源";
}

function liveLabel(provider: AiProviderStatus["providers"][number]) {
  if (!provider.enabled) return "停用，不参与探活";
  if (provider.available === true) return `探活成功 ${provider.latencyMs || 0}ms`;
  if (provider.available === false) return `探活失败 ${provider.latencyMs || 0}ms`;
  return "未探活";
}

function performanceLabel(provider: AiProviderStatus["providers"][number]) {
  const performance = provider.performance;
  if (!performance.sampleCount || performance.averageLatencyMs === null) return "响应速度待学习";
  const successRate = performance.successRate === null ? "--" : `${Math.round(performance.successRate * 100)}%`;
  return `平均 ${performance.averageLatencyMs}ms · 成功率 ${successRate}`;
}

function circuitLabel(provider: AiProviderStatus["providers"][number]) {
  const performance = provider.performance;
  if (performance.circuitState === "open") {
    return `已自动避让 ${Math.ceil(performance.cooldownRemainingMs / 1000)}s`;
  }
  if (performance.circuitState === "half_open") return "等待恢复试跑";
  if (performance.circuitState === "closed") return "自适应路由正常";
  return "尚未积累样本";
}

function liveToneClass(provider: AiProviderStatus["providers"][number]) {
  if (!provider.enabled) return styles.toneMuted;
  if (provider.available === true) return styles.toneOk;
  if (provider.available === false) return styles.toneError;
  return styles.toneMuted;
}

function providerToneClass(tone: "muted" | "ok" | "error") {
  if (tone === "ok") return styles.toneOk;
  if (tone === "error") return styles.toneError;
  return styles.toneMuted;
}
