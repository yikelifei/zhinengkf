"use client";

import { Bot, CircleAlert, RefreshCw, Route, ServerCog, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateAiProviderServerEnv,
  getAiProviderBalance,
  getAiProviderStatus,
  probeAiProviderStatus,
  saveAiProviderBillingCredential,
  saveAiProviderCredential,
  syncAiProviderModels,
  testAiProviderResponse,
  type AiProviderBalanceResult,
  type AiProviderModelSyncResult,
  type AiProviderResponseTestResult,
  type AiProviderServerEnvBundle,
  type AiProviderStatus,
} from "../../lib/api";
import { useOperatorCapability } from "../access/use-operator-capability";
import { type AiProvider, type ModelWorkspace } from "./ai-model-center-utils";
import { AiModelProviderManager, type BillingDraft, type ConnectionDraft } from "./ai-model-provider-manager";
import { AiModelRoutingView } from "./ai-model-routing-view";
import { AiModelServerView } from "./ai-model-server-view";
import styles from "./ai-models-page.module.css";

const WORKSPACES: Array<{ key: ModelWorkspace; label: string; icon: typeof Bot }> = [
  { key: "providers", label: "模型服务商", icon: Bot },
  { key: "routing", label: "路由规则", icon: Route },
  { key: "server", label: "服务器配置", icon: ServerCog },
];

export function AiModelsPage() {
  const manageAccess = useOperatorCapability("manage_channels");
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const statusRef = useRef<AiProviderStatus | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "stale" | "unknown">("loading");
  const [workspace, setWorkspace] = useState<ModelWorkspace>("providers");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingProvider, setSavingProvider] = useState("");
  const [syncingProvider, setSyncingProvider] = useState("");
  const [testingProvider, setTestingProvider] = useState("");
  const [balanceProvider, setBalanceProvider] = useState("");
  const [billingProvider, setBillingProvider] = useState("");
  const [serverBusy, setServerBusy] = useState(false);
  const [probeConfirmation, setProbeConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionDrafts, setConnectionDrafts] = useState<Record<string, ConnectionDraft>>({});
  const [billingDrafts, setBillingDrafts] = useState<Record<string, BillingDraft>>({});
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, AiProviderModelSyncResult["models"]>>({});
  const [tests, setTests] = useState<Record<string, AiProviderResponseTestResult>>({});
  const [balances, setBalances] = useState<Record<string, AiProviderBalanceResult>>({});
  const [serverBundle, setServerBundle] = useState<AiProviderServerEnvBundle | null>(null);

  const refresh = useCallback(async (probe = false) => {
    setBusy(true);
    setError("");
    if (!statusRef.current) setReadState("loading");
    try {
      const next = probe ? await probeAiProviderStatus() : await getAiProviderStatus();
      const latestTests: Record<string, AiProviderResponseTestResult> = {};
      const latestBalances: Record<string, AiProviderBalanceResult> = {};
      for (const provider of next.providers) {
        if (provider.latestTest) latestTests[provider.name] = provider.latestTest;
        if (provider.latestBalance) latestBalances[provider.name] = provider.latestBalance;
      }
      statusRef.current = next;
      setStatus(next);
      setTests(latestTests);
      setBalances(latestBalances);
      setReadState("ready");
      setSelectedProvider((current) => current || next.primary || next.providers[0]?.name || "");
    } catch (reason) {
      setError(errorText(reason, "大模型配置状态读取失败。"));
      setReadState(statusRef.current ? "stale" : "unknown");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(false); }, [refresh]);

  const pageBusy = busy || manageAccess.busy || Boolean(savingProvider || syncingProvider || testingProvider || balanceProvider || billingProvider || serverBusy);
  const trusted = readState === "ready" && manageAccess.readState === "ready" && manageAccess.allowed && !pageBusy;
  const primary = status?.providers.find((provider) => provider.isPrimary);
  const readyCount = status?.providers.filter((provider) => provider.enabled && provider.configured).length || 0;

  const guard = useCallback((message: string) => {
    if (readState === "ready" && manageAccess.readState === "ready" && manageAccess.allowed) return true;
    setError(`供应商配置或 manage_channels 权限不是最新可信结果；请先刷新，${message}`);
    return false;
  }, [manageAccess.allowed, manageAccess.readState, readState]);

  const saveConnection = useCallback(async (provider: AiProvider, override: ConnectionDraft = {}) => {
    if (!guard("再保存模型配置。")) return;
    const draft = { ...(connectionDrafts[provider.name] || {}), ...override };
    setSavingProvider(provider.name);
    setError(""); setNotice("");
    try {
      const result = await saveAiProviderCredential(
        provider.name,
        provider.credentialSource === "zhenxi_ai_shared"
          ? { model: (draft.model ?? provider.model).trim() }
          : {
              apiKey: draft.apiKey?.trim() || undefined,
              baseUrl: (draft.baseUrl ?? provider.baseUrl).trim(),
              model: (draft.model ?? provider.model).trim(),
              enabled: provider.enabled,
            },
      );
      setConnectionDrafts((current) => ({ ...current, [provider.name]: {} }));
      setNotice(result.detail);
      await refresh(false);
    } catch (reason) {
      setError(`配置写入结果未确认；请刷新后核对，不要立即重复提交。${errorText(reason)}`);
    } finally { setSavingProvider(""); }
  }, [connectionDrafts, guard, refresh]);

  const toggleProvider = useCallback(async (provider: AiProvider) => {
    if (!guard("再变更启用状态。")) return;
    setSavingProvider(provider.name); setError(""); setNotice("");
    try {
      const result = await saveAiProviderCredential(provider.name, { enabled: !provider.enabled });
      setNotice(result.detail);
      await refresh(false);
    } catch (reason) {
      setError(`启用状态写入结果未确认；请刷新后核对。${errorText(reason)}`);
    } finally { setSavingProvider(""); }
  }, [guard, refresh]);

  const enableAllSaved = useCallback(async () => {
    if (!status || !guard("再批量启用。")) return;
    const targets = status.providers.filter((provider) => provider.keyOnlySetup && provider.apiKeyConfigured && !provider.enabled);
    if (!targets.length) { setNotice("没有需要启用的已保存密钥服务商。"); return; }
    setSavingProvider("__all__"); setError(""); setNotice("");
    try {
      for (const provider of targets) await saveAiProviderCredential(provider.name, { enabled: true });
      setNotice(`已启用 ${targets.map((provider) => provider.label).join("、")}。`);
      await refresh(false);
    } catch (reason) {
      setError(`批量启用结果未确认；请刷新后逐项核对。${errorText(reason)}`);
    } finally { setSavingProvider(""); }
  }, [guard, refresh, status]);

  const syncModels = useCallback(async (provider: AiProvider) => {
    if (!guard("再获取模型列表。")) return;
    setSyncingProvider(provider.name); setError(""); setNotice("");
    try {
      const result = await syncAiProviderModels(provider.name);
      setModelCatalogs((current) => ({ ...current, [provider.name]: result.models }));
      setNotice(`已从 ${provider.label} 获取 ${result.models.length} 个模型；本次请求没有自动重试。`);
    } catch (reason) {
      setError(`模型列表获取失败；本次没有自动重试。${errorText(reason)}`);
    } finally { setSyncingProvider(""); }
  }, [guard]);

  const testProvider = useCallback(async (provider: AiProvider) => {
    if (!guard("再测试模型回应。")) return;
    setTestingProvider(provider.name); setError(""); setNotice("");
    try {
      const result = await testAiProviderResponse(provider.name);
      setTests((current) => ({ ...current, [provider.name]: result }));
      setBalances((current) => ({ ...current, [provider.name]: result.balance }));
      setNotice(result.available ? `${provider.label} 客服连接测试通过：${result.latencyMs}ms。` : `${provider.label} 测试未通过：${result.error || "上游未返回可用结果"}`);
      await refresh(false);
    } catch (reason) {
      setError(`回应测试结果未确认；请勿立即重复测试。${errorText(reason)}`);
    } finally { setTestingProvider(""); }
  }, [guard, refresh]);

  const queryBalance = useCallback(async (provider: AiProvider) => {
    if (!guard("再查询余额或费用。")) return;
    setBalanceProvider(provider.name); setError(""); setNotice("");
    try {
      const result = await getAiProviderBalance(provider.name);
      setBalances((current) => ({ ...current, [provider.name]: result }));
      setNotice(`${provider.label}：${result.display || result.error || "查询完成"}`);
    } catch (reason) {
      setError(`余额或费用查询结果未确认。${errorText(reason)}`);
    } finally { setBalanceProvider(""); }
  }, [guard]);

  const saveBilling = useCallback(async (provider: AiProvider) => {
    if (!guard("再保存财务查询凭证。")) return;
    setBillingProvider(provider.name); setError(""); setNotice("");
    try {
      const result = await saveAiProviderBillingCredential(provider.name, billingDrafts[provider.name] || {});
      setBillingDrafts((current) => ({ ...current, [provider.name]: {} }));
      setNotice(result.detail);
      await refresh(false);
    } catch (reason) {
      setError(`财务凭证写入结果未确认。${errorText(reason)}`);
    } finally { setBillingProvider(""); }
  }, [billingDrafts, guard, refresh]);

  const generateServerEnv = useCallback(async () => {
    if (!guard("再生成服务器密钥文件。")) return;
    setServerBusy(true); setError(""); setNotice("");
    try {
      const bundle = await generateAiProviderServerEnv();
      setServerBundle(bundle);
      setNotice(`已生成服务器密钥文件：${bundle.fileName}`);
    } catch (reason) {
      setError(`服务器配置生成结果未确认。${errorText(reason)}`);
    } finally { setServerBusy(false); }
  }, [guard]);

  const copyServerEnv = useCallback(async () => {
    if (!serverBundle?.envText) return;
    try { await navigator.clipboard.writeText(serverBundle.envText); setNotice("服务器配置已复制。"); }
    catch { setError("剪贴板写入失败，请手动选中配置文本复制。"); }
  }, [serverBundle]);

  const selectedProviderExists = useMemo(() => status?.providers.some((provider) => provider.name === selectedProvider), [selectedProvider, status]);
  useEffect(() => {
    if (status && !selectedProviderExists) setSelectedProvider(status.primary || status.providers[0]?.name || "");
  }, [selectedProviderExists, status]);

  return (
    <section className={styles.page} aria-labelledby="ai-models-page-title" aria-busy={pageBusy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <div className={styles.titleLine}><Bot size={22} aria-hidden="true" /><h1 id="ai-models-page-title">模型管理</h1></div>
          <p>按 Cherry Studio 的方式集中管理服务商、连接地址和模型，同时沿用客服的快速智能路由。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.statusPill} ${readyCount ? styles.statusPillOk : styles.statusPillWarning}`}>{readyCount} 个可用服务商{primary ? ` · 主模型 ${primary.label}` : ""}</span>
          <button type="button" className={styles.secondaryButton} data-action-id="ai-models-refresh" onClick={() => void Promise.all([refresh(false), manageAccess.refresh()])} disabled={pageBusy}><RefreshCw size={14} /> 刷新配置</button>
          <button type="button" className={styles.primaryButton} data-action-id="ai-models-probe" onClick={() => setProbeConfirmation(true)} disabled={!trusted}><Zap size={14} /> 请求实时探活</button>
        </div>
      </header>

      <nav className={styles.workspaceTabs} aria-label="模型管理视图">
        {WORKSPACES.map(({ key, label, icon: Icon }) => <button key={key} type="button" className={workspace === key ? styles.workspaceTabActive : styles.workspaceTab} data-action-id={`ai-models-workspace-${key}`} onClick={() => setWorkspace(key)}><Icon size={14} /> {label}</button>)}
      </nav>

      {readState === "stale" ? <div className={`${styles.banner} ${styles.bannerWarning}`}><CircleAlert size={15} /> 当前展示的是旧配置；所有写入与付费测试均已禁用，请先刷新。</div> : null}
      {manageAccess.error ? <div className={`${styles.banner} ${styles.bannerError}`}><CircleAlert size={15} /> 权限状态未确认：{manageAccess.error}</div> : null}
      {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert"><CircleAlert size={15} /> {error}</div> : null}
      {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">{notice}</div> : null}

      {probeConfirmation ? (
        <div className={styles.confirmation} role="alertdialog" aria-label="确认实时探活">
          <div><strong>确认向已启用服务商发送实时探活请求</strong><p>服务端会发送最小真实请求，可能产生费用、配额消耗和外部审计记录；探活失败也不会自动重试。</p></div>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primaryButton} data-action-id="ai-models-probe-confirm" onClick={() => { setProbeConfirmation(false); if (trusted) void refresh(true); }} disabled={!trusted}>确认实时探活</button>
            <button type="button" className={styles.secondaryButton} data-action-id="ai-models-probe-cancel" onClick={() => setProbeConfirmation(false)}>取消</button>
          </div>
        </div>
      ) : null}

      {!status ? <div className={styles.skeleton} aria-label="正在读取模型配置"><span /><span /><span /></div> : workspace === "providers" ? (
        <AiModelProviderManager
          status={status} selectedProvider={selectedProvider} trusted={trusted} savingProvider={savingProvider}
          syncingProvider={syncingProvider} testingProvider={testingProvider} balanceProvider={balanceProvider}
          connectionDrafts={connectionDrafts} billingDrafts={billingDrafts} modelCatalogs={modelCatalogs} tests={tests} balances={balances}
          onSelectProvider={setSelectedProvider}
          onConnectionDraft={(provider, draft) => setConnectionDrafts((current) => ({ ...current, [provider]: draft }))}
          onBillingDraft={(provider, draft) => setBillingDrafts((current) => ({ ...current, [provider]: draft }))}
          onSaveConnection={(provider, override) => void saveConnection(provider, override)} onToggleProvider={(provider) => void toggleProvider(provider)}
          onEnableAllSaved={() => void enableAllSaved()} onSyncModels={(provider) => void syncModels(provider)} onTest={(provider) => void testProvider(provider)}
          onBalance={(provider) => void queryBalance(provider)} onSaveBilling={(provider) => void saveBilling(provider)}
        />
      ) : workspace === "routing" ? <AiModelRoutingView status={status} /> : (
        <AiModelServerView status={status} bundle={serverBundle} busy={serverBusy} trusted={trusted} onGenerate={() => void generateServerEnv()} onCopy={() => void copyServerEnv()} />
      )}
    </section>
  );
}

function errorText(reason: unknown, fallback = "操作失败。") {
  return reason instanceof Error ? reason.message : fallback;
}
