"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  TestTube2,
  TriangleAlert,
} from "lucide-react";
import {
  AiProviderProtocol,
  AiProviderSettings,
  AiProviderSettingsPatch,
  AiProviderSettingsProvider,
  getAiProviderSettings,
  testAiProvider,
  updateAiProviderSettings,
} from "../lib/api";

type ProviderDraft = Omit<AiProviderSettingsProvider, "configured" | "issues" | "apiEndpoint"> & {
  apiKey: string;
  clearApiKey: boolean;
};

type SettingsDraft = {
  enabled: boolean;
  primary: string;
  fallbackChain: string[];
  timeoutSeconds: number;
  maxRetries: number;
  providers: ProviderDraft[];
};

type AiModelSettingsProps = {
  onStatusMessage?: (message: string) => void;
};

const protocolOptions: Array<{ value: AiProviderProtocol; label: string }> = [
  { value: "openai_chat", label: "OpenAI Chat Completions" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
];

const issueLabels: Record<string, string> = {
  provider_disabled: "尚未启用",
  api_key_unset: "缺少 API Key",
  base_url_unset: "缺少接口地址",
  base_url_invalid: "接口地址无效",
  model_unset: "缺少模型名称",
};

function settingsToDraft(settings: AiProviderSettings): SettingsDraft {
  return {
    enabled: settings.enabled,
    primary: settings.primary,
    fallbackChain: settings.fallbackChain,
    timeoutSeconds: settings.timeoutSeconds,
    maxRetries: settings.maxRetries,
    providers: settings.providers.map((provider) => ({
      ...provider,
      apiKey: "",
      clearApiKey: false,
    })),
  };
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "操作失败");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.message)) return parsed.message.join("；");
    if (parsed?.message) return String(parsed.message);
  } catch {
    // The API can also return a plain-text error.
  }
  return raw;
}

function providerReadiness(provider: ProviderDraft, serverProvider?: AiProviderSettingsProvider) {
  const hasKey = provider.hasApiKey || Boolean(provider.apiKey.trim());
  const ready =
    provider.enabled &&
    Boolean(provider.baseUrl.trim()) &&
    Boolean(provider.model.trim()) &&
    (!provider.apiKeyRequired || hasKey) &&
    !provider.clearApiKey;
  if (ready) return { label: serverProvider?.configured ? "已配置" : "待保存", tone: "ready" };
  if (!provider.enabled) return { label: "未启用", tone: "muted" };
  return { label: "待补全", tone: "warning" };
}

export function AiModelSettings({ onStatusMessage }: AiModelSettingsProps) {
  const [settings, setSettings] = useState<AiProviderSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [selectedId, setSelectedId] = useState("geeknow");
  const [busy, setBusy] = useState<"load" | "save" | "test" | null>(null);
  const [notice, setNotice] = useState("正在读取本机模型配置…");
  const [showSecret, setShowSecret] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function load() {
    setBusy("load");
    try {
      const result = await getAiProviderSettings();
      setSettings(result);
      setDraft(settingsToDraft(result));
      if (!result.providers.some((provider) => provider.id === selectedId)) {
        setSelectedId(result.primary || result.providers[0]?.id || "geeknow");
      }
      setNotice(`已读取 ${result.providers.length} 个模型供应商`);
    } catch (error) {
      setNotice(`读取失败：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(
    () => draft?.providers.find((provider) => provider.id === selectedId) || draft?.providers[0] || null,
    [draft, selectedId],
  );
  const serverProvider = settings?.providers.find((provider) => provider.id === selected?.id);
  const enabledCount = draft?.providers.filter((provider) => provider.enabled).length || 0;
  const configuredCount = settings?.providers.filter((provider) => provider.configured).length || 0;

  function updateGlobal(patch: Partial<Omit<SettingsDraft, "providers">>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function updateProvider(providerId: string, patch: Partial<ProviderDraft>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider) =>
              provider.id === providerId ? { ...provider, ...patch } : provider,
            ),
          }
        : current,
    );
  }

  function buildPatch(current: SettingsDraft): AiProviderSettingsPatch {
    return {
      enabled: current.enabled,
      primary: current.primary,
      fallbackChain: current.fallbackChain,
      timeoutSeconds: current.timeoutSeconds,
      maxRetries: current.maxRetries,
      providers: Object.fromEntries(
        current.providers.map((provider) => [
          provider.id,
          {
            enabled: provider.enabled,
            ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
            ...(provider.clearApiKey ? { clearApiKey: true } : {}),
            baseUrl: provider.baseUrl.trim(),
            model: provider.model.trim(),
            protocol: provider.protocol,
            temperature: provider.temperature,
            maxTokens: provider.maxTokens,
          },
        ]),
      ),
    };
  }

  async function persist(options: { silent?: boolean } = {}) {
    if (!draft) throw new Error("模型配置尚未加载");
    setBusy("save");
    try {
      const result = await updateAiProviderSettings(buildPatch(draft));
      setSettings(result);
      setDraft(settingsToDraft(result));
      const text = `大模型设置已保存，本机已配置 ${result.providers.filter((provider) => provider.configured).length} 个供应商`;
      setNotice(text);
      if (!options.silent) onStatusMessage?.(text);
      return result;
    } catch (error) {
      const text = `保存失败：${errorMessage(error)}`;
      setNotice(text);
      onStatusMessage?.(text);
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function saveAndTest(providerId: string) {
    try {
      await persist({ silent: true });
      setBusy("test");
      setNotice("正在向供应商发送最小连通性测试…");
      const result = await testAiProvider(providerId);
      const text = `${result.model} 连接成功，耗时 ${result.latencyMs} ms`;
      setTestStates((current) => ({ ...current, [providerId]: { ok: true, text } }));
      setNotice(text);
      onStatusMessage?.(text);
    } catch (error) {
      const text = `连接失败：${errorMessage(error)}`;
      setTestStates((current) => ({ ...current, [providerId]: { ok: false, text } }));
      setNotice(text);
      onStatusMessage?.(text);
    } finally {
      setBusy(null);
    }
  }

  function toggleFallback(providerId: string) {
    if (!draft || providerId === draft.primary) return;
    updateGlobal({
      fallbackChain: draft.fallbackChain.includes(providerId)
        ? draft.fallbackChain.filter((id) => id !== providerId)
        : [...draft.fallbackChain, providerId],
    });
  }

  function moveFallback(providerId: string, direction: -1 | 1) {
    if (!draft) return;
    const next = [...draft.fallbackChain];
    const index = next.indexOf(providerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateGlobal({ fallbackChain: next });
  }

  if (!draft || !settings || !selected) {
    return (
      <section className="ai-model-settings ai-model-loading" id="ai-model-settings" aria-label="大模型设置">
        <Loader2 size={24} className="ai-model-spin" />
        <strong>正在加载大模型中心</strong>
        <span>{notice}</span>
        {busy !== "load" ? (
          <button type="button" onClick={() => void load()}>
            重新读取
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="ai-model-settings" id="ai-model-settings" aria-label="大模型设置">
      <header className="ai-model-hero">
        <div>
          <span className="ai-model-eyebrow">
            <Cpu size={15} /> AI MODEL GATEWAY
          </span>
          <h2>大模型中心</h2>
          <p>统一管理客服回复所使用的模型、API Key、主备顺序和失败降级。</p>
        </div>
        <div className="ai-model-hero-actions">
          <button type="button" className="secondary" onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw size={16} className={busy === "load" ? "ai-model-spin" : ""} /> 刷新
          </button>
          <button type="button" className="primary" onClick={() => void persist()} disabled={Boolean(busy)}>
            {busy === "save" ? <Loader2 size={16} className="ai-model-spin" /> : <Save size={16} />} 保存全部
          </button>
        </div>
      </header>

      <div className="ai-model-summary">
        <label className="ai-model-engine-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => updateGlobal({ enabled: event.target.checked })}
          />
          <span aria-hidden="true" />
          <div>
            <strong>启用大模型回复</strong>
            <small>关闭后仍使用现有规则与知识库回复</small>
          </div>
        </label>
        <div className="ai-model-stat">
          <span>已启用供应商</span>
          <strong>{enabledCount}</strong>
          <small>其中 {configuredCount} 个配置完整</small>
        </div>
        <div className="ai-model-stat">
          <span>主模型</span>
          <strong>{draft.providers.find((provider) => provider.id === draft.primary)?.label || "未选择"}</strong>
          <small>失败后按备用顺序自动切换</small>
        </div>
        <div className="ai-model-security">
          <ShieldCheck size={20} />
          <div>
            <strong>密钥仅保存在本机 API 运行目录</strong>
            <small>页面只显示是否已配置，不会读取或回显完整密钥</small>
          </div>
        </div>
      </div>

      <div className="ai-model-layout">
        <aside className="ai-model-catalog" aria-label="模型供应商列表">
          <div className="ai-model-catalog-title">
            <div>
              <strong>模型供应商</strong>
              <span>{draft.providers.length} 个预置接入</span>
            </div>
            <Cloud size={18} />
          </div>
          <div className="ai-model-provider-list">
            {draft.providers.map((provider) => {
              const readiness = providerReadiness(
                provider,
                settings.providers.find((item) => item.id === provider.id),
              );
              return (
                <button
                  key={provider.id}
                  type="button"
                  className={`ai-model-provider-card${provider.id === selected.id ? " active" : ""}`}
                  onClick={() => {
                    setSelectedId(provider.id);
                    setShowSecret(false);
                  }}
                >
                  <span className="ai-model-provider-icon">{provider.isLocal ? <Server size={17} /> : <Cloud size={17} />}</span>
                  <span className="ai-model-provider-copy">
                    <strong>{provider.label}</strong>
                    <small>{provider.model || "等待填写模型"}</small>
                  </span>
                  <span className={`ai-model-provider-state ${readiness.tone}`}>{readiness.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="ai-model-editor">
          <div className="ai-model-editor-head">
            <div>
              <span>{selected.vendor}</span>
              <h3>{selected.label}</h3>
              <p>{selected.description}</p>
            </div>
            <label className="ai-model-enable-control">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(event) => updateProvider(selected.id, { enabled: event.target.checked })}
              />
              <span>{selected.enabled ? "已启用" : "启用此供应商"}</span>
            </label>
          </div>

          <div className="ai-model-form-grid">
            <label className="ai-model-field ai-model-field-wide">
              <span>API 地址</span>
              <input
                value={selected.baseUrl}
                onChange={(event) => updateProvider(selected.id, { baseUrl: event.target.value })}
                placeholder={selected.isLocal ? "http://127.0.0.1:11434/v1" : "https://api.example.com/v1"}
                spellCheck={false}
              />
              <small>只允许 HTTPS；本机 localhost / 127.0.0.1 可使用 HTTP</small>
            </label>

            <label className="ai-model-field">
              <span>协议</span>
              <select
                value={selected.protocol}
                onChange={(event) => updateProvider(selected.id, { protocol: event.target.value as AiProviderProtocol })}
              >
                {protocolOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ai-model-field">
              <span>模型 / 推理接入点</span>
              <input
                value={selected.model}
                onChange={(event) => updateProvider(selected.id, { model: event.target.value })}
                list={`ai-model-options-${selected.id}`}
                placeholder="输入模型 ID"
                spellCheck={false}
              />
              <datalist id={`ai-model-options-${selected.id}`}>
                {selected.modelSuggestions.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>

            <label className="ai-model-field ai-model-field-wide">
              <span>API Key {selected.apiKeyRequired ? "" : "（可不填）"}</span>
              <div className="ai-model-secret-input">
                <KeyRound size={16} />
                <input
                  type={showSecret ? "text" : "password"}
                  value={selected.apiKey}
                  onChange={(event) =>
                    updateProvider(selected.id, { apiKey: event.target.value, clearApiKey: false })
                  }
                  placeholder={selected.hasApiKey ? "已安全保存；留空表示保持不变" : "输入新的 API Key"}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button type="button" onClick={() => setShowSecret((current) => !current)} aria-label="显示或隐藏 API Key">
                  {showSecret ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div className="ai-model-key-meta">
                <span className={selected.hasApiKey && !selected.clearApiKey ? "saved" : ""}>
                  {selected.clearApiKey
                    ? "保存后删除现有密钥"
                    : selected.hasApiKey
                      ? "现有密钥已保存"
                      : selected.apiKeyRequired
                        ? "尚未配置密钥"
                        : "此供应商无需密钥"}
                </span>
                {selected.hasApiKey ? (
                  <button
                    type="button"
                    onClick={() => updateProvider(selected.id, { apiKey: "", clearApiKey: !selected.clearApiKey })}
                  >
                    {selected.clearApiKey ? "取消删除" : "删除密钥"}
                  </button>
                ) : null}
              </div>
            </label>

            <label className="ai-model-field">
              <span>温度</span>
              <div className="ai-model-range-row">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={selected.temperature}
                  onChange={(event) => updateProvider(selected.id, { temperature: Number(event.target.value) })}
                />
                <output>{selected.temperature.toFixed(1)}</output>
              </div>
            </label>

            <label className="ai-model-field">
              <span>最大输出 Token</span>
              <input
                type="number"
                min="32"
                max="32000"
                value={selected.maxTokens}
                onChange={(event) => updateProvider(selected.id, { maxTokens: Number(event.target.value) })}
              />
            </label>
          </div>

          {serverProvider?.issues.length ? (
            <div className="ai-model-issues">
              <TriangleAlert size={17} />
              <span>{serverProvider.issues.map((issue) => issueLabels[issue] || issue).join("；")}</span>
            </div>
          ) : null}

          <div className="ai-model-test-row">
            <div className={testStates[selected.id]?.ok ? "success" : testStates[selected.id] ? "failure" : ""}>
              {testStates[selected.id]?.ok ? <CheckCircle2 size={17} /> : <TestTube2 size={17} />}
              <span>{testStates[selected.id]?.text || "测试会先保存当前设置，再发送一条最小请求"}</span>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => void saveAndTest(selected.id)}
              disabled={Boolean(busy) || !selected.enabled}
            >
              {busy === "test" ? <Loader2 size={16} className="ai-model-spin" /> : <TestTube2 size={16} />}
              保存并测试
            </button>
          </div>
        </main>
      </div>

      <section className="ai-model-routing" aria-label="主备模型路由">
        <div className="ai-model-routing-head">
          <div>
            <strong>主备模型与故障切换</strong>
            <span>只会调用已启用且配置完整的供应商</span>
          </div>
          <div className="ai-model-routing-limits">
            <label>
              超时（秒）
              <input
                type="number"
                min="2"
                max="120"
                value={draft.timeoutSeconds}
                onChange={(event) => updateGlobal({ timeoutSeconds: Number(event.target.value) })}
              />
            </label>
            <label>
              单模型重试
              <select
                value={draft.maxRetries}
                onChange={(event) => updateGlobal({ maxRetries: Number(event.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value} 次
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="ai-model-routing-grid">
          <label className="ai-model-primary-select">
            <span>主模型</span>
            <select
              value={draft.primary}
              onChange={(event) =>
                updateGlobal({
                  primary: event.target.value,
                  fallbackChain: draft.fallbackChain.filter((id) => id !== event.target.value),
                })
              }
            >
              {draft.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}{provider.enabled ? "" : "（未启用）"}
                </option>
              ))}
            </select>
          </label>
          <div className="ai-model-fallback-picker">
            <span>备用顺序</span>
            <div>
              {draft.providers
                .filter((provider) => provider.id !== draft.primary)
                .map((provider) => {
                  const order = draft.fallbackChain.indexOf(provider.id);
                  return (
                    <label key={provider.id} className={order >= 0 ? "selected" : ""}>
                      <input
                        type="checkbox"
                        checked={order >= 0}
                        onChange={() => toggleFallback(provider.id)}
                      />
                      <span className="ai-model-fallback-check">{order >= 0 ? <Check size={13} /> : null}</span>
                      <span>{order >= 0 ? `${order + 1}. ` : ""}{provider.label}</span>
                      {order >= 0 ? (
                        <span className="ai-model-order-buttons">
                          <button type="button" onClick={(event) => { event.preventDefault(); moveFallback(provider.id, -1); }} disabled={order === 0} aria-label="上移">
                            <ChevronUp size={14} />
                          </button>
                          <button type="button" onClick={(event) => { event.preventDefault(); moveFallback(provider.id, 1); }} disabled={order === draft.fallbackChain.length - 1} aria-label="下移">
                            <ChevronDown size={14} />
                          </button>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
            </div>
          </div>
        </div>
      </section>

      <footer className="ai-model-footer" role="status" aria-live="polite">
        <span>{notice}</span>
        <span>大模型不可用或输出未通过安全校验时，自动回退规则回复</span>
      </footer>
    </section>
  );
}
