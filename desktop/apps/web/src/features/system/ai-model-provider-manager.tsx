import { Check, CircleAlert, ExternalLink, KeyRound, Plus, RefreshCw, Search, ServerCog, WalletCards, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AiProviderBalanceResult, AiProviderModelSyncResult, AiProviderResponseTestResult, AiProviderStatus } from "../../lib/api";
import styles from "./ai-models-page.module.css";
import {
  balanceSummary,
  credentialSourceLabel,
  modelType,
  providerAvatar,
  providerSort,
  providerStatusText,
  providerStatusTone,
  type AiProvider,
  type ProviderFilter,
} from "./ai-model-center-utils";

export type ConnectionDraft = { apiKey?: string; baseUrl?: string; model?: string };
export type BillingDraft = { accessKeyId?: string; accessKeySecret?: string; adminKey?: string };

type Props = {
  status: AiProviderStatus;
  selectedProvider: string;
  trusted: boolean;
  savingProvider: string;
  syncingProvider: string;
  testingProvider: string;
  balanceProvider: string;
  connectionDrafts: Record<string, ConnectionDraft>;
  billingDrafts: Record<string, BillingDraft>;
  modelCatalogs: Record<string, AiProviderModelSyncResult["models"]>;
  tests: Record<string, AiProviderResponseTestResult>;
  balances: Record<string, AiProviderBalanceResult>;
  onSelectProvider: (provider: string) => void;
  onConnectionDraft: (provider: string, draft: ConnectionDraft) => void;
  onBillingDraft: (provider: string, draft: BillingDraft) => void;
  onSaveConnection: (provider: AiProvider, override?: ConnectionDraft) => void;
  onToggleProvider: (provider: AiProvider) => void;
  onEnableAllSaved: () => void;
  onSyncModels: (provider: AiProvider) => void;
  onTest: (provider: AiProvider) => void;
  onBalance: (provider: AiProvider) => void;
  onSaveBilling: (provider: AiProvider) => void;
};

export function AiModelProviderManager(props: Props) {
  const [providerSearch, setProviderSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [modelSearch, setModelSearch] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [manualModels, setManualModels] = useState<Record<string, string[]>>({});

  const providers = useMemo(() => {
    const query = providerSearch.trim().toLowerCase();
    return providerSort(props.status.providers).filter((provider) => {
      if (providerFilter === "enabled" && !provider.enabled) return false;
      if (providerFilter === "disabled" && provider.enabled) return false;
      return !query || [provider.name, provider.label, provider.model, provider.description].some((value) => value.toLowerCase().includes(query));
    });
  }, [props.status.providers, providerFilter, providerSearch]);

  const selected = props.status.providers.find((provider) => provider.name === props.selectedProvider) || providers[0] || props.status.providers[0];
  const draft = selected ? props.connectionDrafts[selected.name] || {} : {};
  const connectionEditable = Boolean(selected?.keyOnlySetup && selected.credentialSource !== "zhenxi_ai_shared");
  const modelSelectable = connectionEditable || Boolean(
    selected?.credentialSource === "zhenxi_ai_shared" && selected.sharedSourceConfigured,
  );
  const models = useMemo(() => {
    if (!selected) return [];
    const all = [selected.model, ...(props.modelCatalogs[selected.name] || []).map((item) => item.id), ...(manualModels[selected.name] || [])];
    return [...new Set(all.filter(Boolean))].filter((model) => model.toLowerCase().includes(modelSearch.trim().toLowerCase()));
  }, [manualModels, modelSearch, props.modelCatalogs, selected]);

  if (!selected) return <div className={styles.emptyState}>没有可管理的模型服务商。</div>;

  const patchDraft = (patch: ConnectionDraft) => props.onConnectionDraft(selected.name, { ...draft, ...patch });
  const addManualModel = () => {
    const model = manualModel.trim();
    if (!model) return;
    setManualModels((current) => ({ ...current, [selected.name]: [...new Set([...(current[selected.name] || []), model])] }));
    setManualModel("");
  };

  return (
    <div className={styles.manager}>
      <aside className={styles.providerSidebar} aria-label="模型服务商">
        <div className={styles.sidebarTop}>
          <label className={styles.searchBox}>
            <Search size={14} aria-hidden="true" />
            <input value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder="搜索服务商或模型" aria-label="搜索模型服务商" />
            {providerSearch ? <button type="button" data-action-id="ai-models-provider-search-clear" onClick={() => setProviderSearch("")} aria-label="清空搜索"><X size={13} /></button> : null}
          </label>
          <div className={styles.filterRow}>
            {(["all", "enabled", "disabled"] as ProviderFilter[]).map((filter) => (
              <button key={filter} type="button" className={filter === providerFilter ? styles.filterActive : styles.filterButton} data-action-id={`ai-models-provider-filter-${filter}`} onClick={() => setProviderFilter(filter)}>
                {{ all: "全部", enabled: "已启用", disabled: "已停用" }[filter]}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.providerList}>
          {providers.map((provider) => {
            const tone = providerStatusTone(provider);
            return (
              <button key={provider.name} type="button" className={provider.name === selected.name ? styles.providerItemSelected : styles.providerItem} data-action-id={`ai-models-provider-${provider.name}-select`} onClick={() => props.onSelectProvider(provider.name)}>
                <span className={`${styles.avatar} ${styles[`avatar_${provider.region}`]}`}>{providerAvatar(provider)}</span>
                <span className={styles.providerItemBody}>
                  <span className={styles.providerItemTitle}><strong>{provider.label}</strong>{provider.isPrimary ? <em>主</em> : null}</span>
                  <span className={styles.providerItemModel}>{provider.model || providerStatusText(provider)}</span>
                </span>
                <span className={`${styles.statusDot} ${tone === "ok" ? styles.dotOk : tone === "muted" ? styles.dotMuted : styles.dotError}`} aria-label={providerStatusText(provider)} />
              </button>
            );
          })}
          {!providers.length ? <div className={styles.emptyState}>没有匹配的服务商。</div> : null}
        </div>
        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.secondaryButton} data-action-id="ai-models-provider-enable-all-saved" onClick={props.onEnableAllSaved} disabled={!props.trusted || Boolean(props.savingProvider)}>
            <Check size={14} aria-hidden="true" /> 启用全部已保存
          </button>
          <button type="button" className={styles.textButton} data-action-id="ai-models-provider-custom-select" onClick={() => props.onSelectProvider("custom_api_1")}>
            <Plus size={14} aria-hidden="true" /> 配置自定义接口
          </button>
        </div>
      </aside>

      <main className={styles.providerDetail}>
        <div className={styles.detailContent}>
          <header className={styles.detailHeader}>
            <div className={styles.detailIdentity}>
              <span className={`${styles.avatar} ${styles.avatarLarge} ${styles[`avatar_${selected.region}`]}`}>{providerAvatar(selected)}</span>
              <div>
                <div className={styles.detailTitleLine}>
                  <h2>{selected.label}</h2>
                  <span className={styles.regionBadge}>{regionLabel(selected.region)}</span>
                  {selected.isPrimary ? <span className={styles.primaryBadge}>当前主服务商</span> : null}
                </div>
                <p>{selected.description}</p>
              </div>
            </div>
            <label className={styles.switchWrap}>
              {selected.enabled ? "已启用" : "已停用"}
              <button type="button" role="switch" aria-checked={selected.enabled} aria-label={`${selected.enabled ? "停用" : "启用"}${selected.label}`} className={selected.enabled ? styles.switchOn : styles.switchOff} data-action-id={`ai-models-provider-${selected.name}-${selected.enabled ? "disable" : "enable"}`} onClick={() => props.onToggleProvider(selected)} disabled={!connectionEditable || !props.trusted || props.savingProvider === selected.name}><span /></button>
            </label>
          </header>

          <section className={styles.detailSection}>
            <div className={styles.sectionHeader}>
              <div><h3><KeyRound size={15} aria-hidden="true" /> 连接配置</h3><p>与 Cherry Studio 一样按服务商维护密钥、API 地址和当前模型；已保存密钥永不回显。</p></div>
              <span className={`${styles.statusPill} ${selected.configured ? styles.statusPillOk : styles.statusPillWarning}`}>{credentialSourceLabel(selected)}</span>
            </div>
            {connectionEditable ? (
              <div className={styles.formGrid}>
                <label className={styles.fieldWide}>
                  <span>API Key</span>
                  <input type="password" autoComplete="off" value={draft.apiKey || ""} onChange={(event) => patchDraft({ apiKey: event.target.value })} placeholder={selected.apiKeyConfigured ? "已安全保存；留空不会覆盖" : "请输入供应商 API Key"} />
                  <small>只会提交到受保护的本地 API，不写入浏览器存储。</small>
                </label>
                <label className={styles.fieldWide}>
                  <span>API 地址</span>
                  <input type="url" value={draft.baseUrl ?? selected.baseUrl} onChange={(event) => patchDraft({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
                </label>
                <label className={styles.fieldWide}>
                  <span>当前模型</span>
                  <input value={draft.model ?? selected.model} onChange={(event) => patchDraft({ model: event.target.value })} placeholder="model-id" />
                </label>
                <div className={styles.formActions}>
                  <button type="button" className={styles.primaryButton} data-action-id={`ai-models-provider-${selected.name}-save`} onClick={() => props.onSaveConnection(selected)} disabled={!props.trusted || props.savingProvider === selected.name}>保存连接配置</button>
                  {selected.docsUrl ? <a className={styles.secondaryButton} href={selected.docsUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 官方文档</a> : null}
                </div>
              </div>
            ) : (
              <div className={selected.configured ? styles.inlineNotice : styles.inlineNoticeWarning}>
                <strong>{selected.credentialSource === "zhenxi_ai_shared" ? "臻希AI共享配置" : "服务器配置文件"}</strong>
                <p>{selected.credentialSource === "zhenxi_ai_shared" ? "客服直接复用臻希AI的密钥和 API 地址；连接信息保持只读，获取到的模型仍可在下方设为当前。" : "该服务商不属于可写预设，请在服务器配置文件中维护。"}</p>
              </div>
            )}
            {selected.issues.length ? <div className={styles.issueList}>{selected.issues.map((issue) => <span key={issue}><CircleAlert size={12} /> {issue}</span>)}</div> : null}
          </section>

          <section className={styles.detailSection}>
            <div className={styles.sectionHeader}>
              <div><h3><ServerCog size={15} aria-hidden="true" /> 模型列表</h3><p>点击“获取模型列表”读取服务商真实 /models 接口，也可手动添加模型 ID；获取只请求一次，不自动重试。</p></div>
              <button type="button" className={styles.primaryButton} title={selected.apiKeyConfigured ? "从当前 API 地址获取模型列表" : "请先保存该服务商的 API Key"} data-action-id={`ai-models-provider-${selected.name}-models-sync`} onClick={() => props.onSyncModels(selected)} disabled={!props.trusted || !selected.apiKeyConfigured || props.syncingProvider === selected.name}>
                <RefreshCw size={14} aria-hidden="true" /> {props.syncingProvider === selected.name ? "正在获取" : "获取模型列表"}
              </button>
            </div>
            {!selected.apiKeyConfigured ? <div className={styles.inlineNoticeWarning}><strong>暂时不能获取</strong><p>请先在上方保存该服务商的 API Key，按钮会自动恢复可用。</p></div> : null}
            <div className={styles.inlineEditor}>
              <input value={manualModel} onChange={(event) => setManualModel(event.target.value)} placeholder="手动输入模型 ID" aria-label="手动模型 ID" />
              <button type="button" className={styles.secondaryButton} data-action-id={`ai-models-provider-${selected.name}-model-add`} onClick={addManualModel}>添加</button>
              <label className={styles.modelSearch}><Search size={13} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="筛选模型" aria-label="筛选模型" /></label>
            </div>
            <div className={styles.modelList}>
              {models.map((model) => {
                const active = model === selected.model;
                return (
                  <div key={model} className={active ? styles.modelRowActive : styles.modelRow}>
                    <div><strong>{model}</strong><small>{selected.label} · {modelType(model)}</small></div>
                    <span className={styles.modelType}>{modelType(model)}</span>
                    {active ? <span className={styles.currentModel}><Check size={12} /> 当前模型</span> : modelSelectable ? <button type="button" className={styles.textButton} data-action-id={`ai-models-provider-${selected.name}-model-select`} onClick={() => props.onSaveConnection(selected, { model })} disabled={!props.trusted || props.savingProvider === selected.name}>设为当前</button> : null}
                  </div>
                );
              })}
              {!models.length ? <div className={styles.emptyState}>没有匹配的模型。可先同步或手动添加。</div> : null}
            </div>
          </section>

          <ProviderHealth {...props} provider={selected} />
        </div>
      </main>
    </div>
  );
}

function ProviderHealth(props: Props & { provider: AiProvider }) {
  const { provider } = props;
  const test = props.tests[provider.name];
  const balance = props.balances[provider.name];
  const billing = props.billingDrafts[provider.name] || {};
  const canQueryBalance = Boolean(provider.balanceProbeSupported);
  return (
    <section className={styles.detailSection}>
      <div className={styles.sectionHeader}>
        <div><h3><WalletCards size={15} aria-hidden="true" /> 真实速度与余额</h3><p>真实测速只发送一次固定短回复且不重试；余额或费用来自供应商官方财务接口，并保留最近一次实测结果。</p></div>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.secondaryButton} data-action-id={`ai-models-provider-${provider.name}-response-test`} onClick={() => props.onTest(provider)} disabled={!props.trusted || !provider.configured || props.testingProvider === provider.name}>{props.testingProvider === provider.name ? "测速中" : "真实测速"}</button>
          <button type="button" className={styles.secondaryButton} data-action-id={`ai-models-provider-${provider.name}-balance-refresh`} onClick={() => props.onBalance(provider)} disabled={!props.trusted || !provider.configured || !canQueryBalance || props.balanceProvider === provider.name}>{props.balanceProvider === provider.name ? "查询中" : "刷新余额 / 费用"}</button>
        </div>
      </div>
      <div className={styles.metricGrid}>
        <Metric label="连接状态" value={providerStatusText(provider)} />
        <Metric label="真实响应耗时" value={test ? `${test.latencyMs}ms` : provider.performance.lastLatencyMs == null ? "尚未实测" : `${provider.performance.lastLatencyMs}ms`} />
        <Metric label="实测输出速度" value={test ? `${test.charactersPerSecond} 字/秒` : "尚未实测"} />
        <Metric label={balance?.metric === "cost" ? "本月实际费用" : "真实可用余额"} value={balanceSummary(balance)} />
      </div>
      {test || balance ? <div className={styles.observationMeta}><span>测速时间：{formatObservationTime(test?.testedAt)}</span><span>余额更新时间：{formatObservationTime(balance?.checkedAt)}</span></div> : null}
      {test ? <div className={`${styles.testResult} ${test.available ? styles.testResultOk : styles.testResultError}`}><strong>{test.available ? "真实测速通过" : "真实测速未通过"}</strong><span>模型：{test.model}</span><p>固定测试回应：{test.responsePreview || test.error || "无可用回应"}</p></div> : null}
      <BillingEditor provider={provider} draft={billing} trusted={props.trusted} onDraft={(patch) => props.onBillingDraft(provider.name, { ...billing, ...patch })} onSave={() => props.onSaveBilling(provider)} />
    </section>
  );
}

function BillingEditor({ provider, draft, trusted, onDraft, onSave }: { provider: AiProvider; draft: BillingDraft; trusted: boolean; onDraft: (patch: BillingDraft) => void; onSave: () => void }) {
  if (provider.billingCredentialKind === "console_only") {
    return <div className={styles.billingEditor}><div><strong>官方财务查询接入</strong><p>{provider.balanceProbeLabel || "该供应商只支持控制台查询"}</p></div>{provider.billingConsoleUrl ? <a className={styles.secondaryButton} href={provider.billingConsoleUrl} target="_blank" rel="noreferrer">打开官方控制台 <ExternalLink size={13} /></a> : null}</div>;
  }
  if (provider.billingCredentialKind === "alibaba_bss") {
    return <div className={styles.billingEditor}><div><strong>阿里云 BSS 只读凭证</strong><p>{provider.billingCredentialConfigured ? "已安全保存；留空不会覆盖。" : "建议只授予 AliyunBSSReadOnlyAccess。"}</p></div><div className={styles.billingFields}><input type="password" autoComplete="off" value={draft.accessKeyId || ""} onChange={(event) => onDraft({ accessKeyId: event.target.value })} placeholder={provider.billingCredentialConfigured ? "AccessKey ID 已保存" : "AccessKey ID"} /><input type="password" autoComplete="off" value={draft.accessKeySecret || ""} onChange={(event) => onDraft({ accessKeySecret: event.target.value })} placeholder={provider.billingCredentialConfigured ? "AccessKey Secret 已保存" : "AccessKey Secret"} /></div><button type="button" className={styles.secondaryButton} data-action-id={`ai-models-provider-${provider.name}-billing-save`} onClick={onSave} disabled={!trusted}>保存财务凭证</button></div>;
  }
  if (provider.billingCredentialKind === "openai_admin") {
    return <div className={styles.billingEditor}><div><strong>OpenAI Admin Key</strong><p>{provider.billingCredentialConfigured ? "已安全保存；留空不会覆盖。" : "只用于 organization costs 查询。"}</p></div><div className={styles.billingFields}><input type="password" autoComplete="off" value={draft.adminKey || ""} onChange={(event) => onDraft({ adminKey: event.target.value })} placeholder={provider.billingCredentialConfigured ? "Admin Key 已保存" : "Admin Key"} /></div><button type="button" className={styles.secondaryButton} data-action-id={`ai-models-provider-${provider.name}-billing-save`} onClick={onSave} disabled={!trusted}>保存财务凭证</button></div>;
  }
  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}

function formatObservationTime(value?: string | null) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function regionLabel(region: AiProvider["region"]) {
  return { china: "国内服务商", global: "海外服务商", aggregator: "聚合服务", custom: "自定义接口" }[region];
}
