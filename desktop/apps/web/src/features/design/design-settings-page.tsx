"use client";

import { FlaskConical, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignPlatformCandidateProbeResponse, DesignPlatformConfigResponse, DesignPlatformHealth, DesignPlatformReadiness, DesignPlatformSmokeTestResult } from "../../lib/api";
import { getDesignPlatformCandidates, getDesignPlatformConfig, getDesignPlatformHealth, getDesignPlatformReadiness, runDesignPlatformSmokeTest, updateDesignPlatformConfig } from "./api";
import { createDesignRequestGuard, runGuardedDesignRequest } from "./design-request-guard";
import { DesignInternalConnectionStatus, isInternalWorkspaceReadiness } from "./design-internal-connection-status";
import { settingsSaveIntent, type DesignSettingsSaveIntent } from "./design-settings-model";
import { DesignSettingsStatusPanel } from "./design-settings-status-panel";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText } from "./design-ui";

const SETTINGS_SCOPE_KEY = "design-settings";

type PendingSettingsConfirmation = {
  generation: number;
  intent: DesignSettingsSaveIntent;
};

export function DesignSettingsPage() {
  const [config, setConfig] = useState<DesignPlatformConfigResponse | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState("");
  const [health, setHealth] = useState<DesignPlatformHealth | null>(null);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [readiness, setReadiness] = useState<DesignPlatformReadiness | null>(null);
  const [readinessLoaded, setReadinessLoaded] = useState(false);
  const [readinessError, setReadinessError] = useState("");
  const [candidates, setCandidates] = useState<DesignPlatformCandidateProbeResponse | null>(null);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [candidatesError, setCandidatesError] = useState("");
  const [adapter, setAdapter] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [cookie, setCookie] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState<"" | "refresh" | "save" | "smoke">("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingSettingsConfirmation | null>(null);
  const [smoke, setSmoke] = useState<DesignPlatformSmokeTestResult | null>(null);
  const requestGuardRef = useRef<ReturnType<typeof createDesignRequestGuard> | null>(null);
  const actionLockRef = useRef(false);
  const confirmationGenerationRef = useRef(0);
  if (!requestGuardRef.current) requestGuardRef.current = createDesignRequestGuard(SETTINGS_SCOPE_KEY);
  const requestGuard = requestGuardRef.current;

  useEffect(() => {
    requestGuard.activate();
    return () => requestGuard.dispose();
  }, [requestGuard]);

  const refresh = useCallback(async () => {
    confirmationGenerationRef.current += 1;
    setPendingConfirmation(null);
    await runGuardedDesignRequest({
      guard: requestGuard,
      scopeKey: SETTINGS_SCOPE_KEY,
      load: () => Promise.allSettled([
        getDesignPlatformConfig(), getDesignPlatformHealth(), getDesignPlatformReadiness(), getDesignPlatformCandidates(),
      ]),
      onStart: () => {
        setBusy("refresh"); setActionError(""); setNotice("");
        setConfig(null); setConfigLoaded(false); setConfigError("");
        setAdapter(""); setBaseUrl(""); setApiKey("");
        setHealth(null); setHealthLoaded(false); setHealthError("");
        setReadiness(null); setReadinessLoaded(false); setReadinessError("");
        setCandidates(null); setCandidatesLoaded(false); setCandidatesError("");
      },
      onSuccess: ([configResult, healthResult, readinessResult, candidatesResult]) => {
        if (configResult.status === "fulfilled") {
          setConfig(configResult.value); setConfigLoaded(true); setConfigError("");
          setAdapter(configResult.value.config.adapter); setBaseUrl(configResult.value.config.baseUrl);
        } else {
          setConfig(null); setConfigLoaded(false); setConfigError(errorText(configResult.reason, "配置读取失败"));
          setAdapter(""); setBaseUrl("");
        }
        if (healthResult.status === "fulfilled") {
          setHealth(healthResult.value); setHealthLoaded(true); setHealthError("");
        } else {
          setHealth(null); setHealthLoaded(false); setHealthError(errorText(healthResult.reason, "健康状态读取失败"));
        }
        if (readinessResult.status === "fulfilled") {
          setReadiness(readinessResult.value); setReadinessLoaded(true); setReadinessError("");
        } else {
          setReadiness(null); setReadinessLoaded(false); setReadinessError(errorText(readinessResult.reason, "就绪状态读取失败"));
        }
        if (candidatesResult.status === "fulfilled") {
          setCandidates(candidatesResult.value); setCandidatesLoaded(true); setCandidatesError("");
        } else {
          setCandidates(null); setCandidatesLoaded(false); setCandidatesError(errorText(candidatesResult.reason, "臻希 AI 候选端口读取失败"));
        }
      },
      onError: (cause) => {
        const message = errorText(cause, "设计平台状态读取失败");
        setConfig(null); setConfigLoaded(false); setConfigError(message);
        setHealth(null); setHealthLoaded(false); setHealthError(message);
          setReadiness(null); setReadinessLoaded(false); setReadinessError(message);
          setCandidates(null); setCandidatesLoaded(false); setCandidatesError(message);
          setApiKey("");
        },
      onFinally: () => setBusy(""),
    });
  }, [requestGuard]);

  useEffect(() => {
    void refresh();
    return () => requestGuard.invalidate(SETTINGS_SCOPE_KEY);
  }, [refresh, requestGuard]);

  function invalidateSaveConfirmation() {
    confirmationGenerationRef.current += 1;
    setPendingConfirmation(null);
  }

  function requestConfigurationSave() {
    const intent = settingsSaveIntent(adapter, baseUrl, apiKey, accessToken, cookie, deviceId);
    if (!intent) return;
    const generation = confirmationGenerationRef.current + 1;
    confirmationGenerationRef.current = generation;
    setPendingConfirmation({ generation, intent });
  }

  async function saveConfiguration() {
    const confirmation = pendingConfirmation;
    if (
      actionLockRef.current || busy
      || !confirmation
      || confirmation.generation !== confirmationGenerationRef.current
    ) return;
    const intent = confirmation.intent;
    actionLockRef.current = true;
    confirmationGenerationRef.current += 1;
    setPendingConfirmation(null);
    try {
      await runGuardedDesignRequest({
        guard: requestGuard,
        scopeKey: SETTINGS_SCOPE_KEY,
        load: () => updateDesignPlatformConfig(intent),
        onStart: () => { setBusy("save"); setActionError(""); setNotice(""); },
        onSuccess: (updated) => {
          setConfig(updated); setConfigLoaded(true); setConfigError("");
          setHealth(null); setHealthLoaded(false); setHealthError("");
          if (updated.readiness) {
            setReadiness(updated.readiness); setReadinessLoaded(true); setReadinessError("");
          } else {
            setReadiness(null); setReadinessLoaded(false); setReadinessError("");
          }
          setAdapter(updated.config.adapter); setBaseUrl(updated.config.baseUrl);
          setApiKey(""); setAccessToken(""); setCookie(""); setDeviceId("");
          setSmoke(null);
          setNotice("设计平台配置已保存；敏感字段已从表单清空。请重新检查健康状态。");
        },
        onError: (cause) => setActionError(errorText(cause, "配置保存失败")),
        onFinally: () => setBusy(""),
      });
    } finally {
      actionLockRef.current = false;
    }
  }

  async function runSmoke() {
    if (actionLockRef.current || busy || !readinessLoaded || !readiness?.ok) return;
    invalidateSaveConfirmation();
    actionLockRef.current = true;
    try {
      await runGuardedDesignRequest({
        guard: requestGuard,
        scopeKey: SETTINGS_SCOPE_KEY,
        load: () => runDesignPlatformSmokeTest(),
        onStart: () => { setBusy("smoke"); setActionError(""); setNotice(""); setSmoke(null); },
        onSuccess: (result) => {
          setSmoke(result);
          if (result.ok) setNotice(`联通测试通过，保存 ${result.savedImageCount} 张测试结果。`);
          else setActionError(result.errorMessage || "联通测试未通过，服务端未返回详细原因。");
        },
        onError: (cause) => setActionError(errorText(cause, "联通测试失败")),
        onFinally: () => setBusy(""),
      });
    } finally {
      actionLockRef.current = false;
    }
  }

  const error = [configError, healthError, readinessError, candidatesError, actionError].filter(Boolean).join("；");
  const controlsDisabled = Boolean(busy);
  const useZhenxiLocal = (url: string) => {
    invalidateSaveConfirmation();
    setAdapter("art_image_local");
    setBaseUrl(url);
  };
  const useZhenxiExternal = (url: string) => {
    invalidateSaveConfirmation();
    setAdapter("zhenxi_external");
    setBaseUrl(url);
  };
  const activeAdapter = (adapter || readiness?.adapter || config?.config.adapter || "").trim();
  const isArtImageLocal = activeAdapter === "art_image_local";
  const isZhenxiExternal = activeAdapter === "zhenxi_external";
  const isZhenxiDurable = isArtImageLocal || isZhenxiExternal;
  const smokeDisabled = controlsDisabled || !readinessLoaded || !readiness?.ok || isZhenxiDurable;
  const internalWorkspace = isInternalWorkspaceReadiness(readiness);

  return (
    <section className={styles.page} aria-label="设计平台设置">
      <DesignPageHeader
        eyebrow="臻希 AI"
        title={internalWorkspace ? "连接状态" : "连接设置"}
        detail={internalWorkspace ? "内置模式会自动复用本机工作台，不需要重复登录、激活或填写密钥。" : "只负责配置、健康检查和正式链路联通测试。"}
        actions={<>
        <button type="button" data-action-id="design-settings-refresh" aria-label="刷新设计平台状态" disabled={controlsDisabled} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新</button>
        {!internalWorkspace ? <button type="button" data-action-id="design-settings-smoke" aria-label="运行设计平台联通测试" title={isZhenxiDurable ? "臻希 AI 真实生成模式不会用设置页联通测试消耗额度；请通过正式设计任务触发出图。" : undefined} disabled={smokeDisabled} onClick={() => void runSmoke()}><FlaskConical size={16} aria-hidden="true" />{isZhenxiDurable ? "生成保护" : "联通测试"}</button> : null}
      </>}
      />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {busy === "refresh" && !configLoaded && !healthLoaded && !readinessLoaded && !candidatesLoaded ? <DesignEmpty title="正在检测臻希 AI" detail="正在确认内置服务和正式出图能力。" busy /> : internalWorkspace && readiness ? (
        <DesignInternalConnectionStatus
          health={health}
          readiness={readiness}
          recommendedBaseUrl={candidates?.recommendedBaseUrl || ""}
        />
      ) : (
        <div className={styles.twoColumn}>
          <div className={styles.stack}>
            <form className={styles.card} onSubmit={(event) => { event.preventDefault(); requestConfigurationSave(); }}>
              <div className={styles.cardHeader}><div><h2>连接参数</h2><p>{configLoaded ? "配置读取成功；令牌、Cookie 和设备号不会从服务端回填。" : "配置读取尚未确认；保存前请核对错误提示。"}</p></div></div>
              <div className={styles.formGrid}>
                <label><span>适配器</span><input disabled={controlsDisabled} value={adapter} onChange={(event) => { invalidateSaveConfirmation(); setAdapter(event.target.value); }} placeholder="design-platform" /></label>
                <label><span>服务地址</span><input disabled={controlsDisabled} value={baseUrl} onChange={(event) => { invalidateSaveConfirmation(); setBaseUrl(event.target.value); }} placeholder="https://..." /></label>
                <label><span>{isZhenxiExternal ? "API 密钥（MCP 模式不需要）" : "API 密钥（可选更新）"}</span><input disabled={controlsDisabled || isZhenxiExternal} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { invalidateSaveConfirmation(); setApiKey(event.target.value); }} /></label>
                <label><span>{isZhenxiExternal ? "访问令牌（MCP 复用臻希登录态，不在这里填写）" : "访问令牌（可选更新）"}</span><input disabled={controlsDisabled || isZhenxiExternal} type="password" autoComplete="new-password" value={accessToken} onChange={(event) => { invalidateSaveConfirmation(); setAccessToken(event.target.value); }} /></label>
                <label><span>会话 Cookie（可选更新）</span><input disabled={controlsDisabled} type="password" autoComplete="new-password" value={cookie} onChange={(event) => { invalidateSaveConfirmation(); setCookie(event.target.value); }} /></label>
                <label><span>设备号（可选更新）</span><input disabled={controlsDisabled} type="password" autoComplete="new-password" value={deviceId} onChange={(event) => { invalidateSaveConfirmation(); setDeviceId(event.target.value); }} /></label>
              </div>
              <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-settings-save-request" aria-label="准备保存设计平台配置" disabled={controlsDisabled || !adapter.trim() || !baseUrl.trim()}><Save size={16} aria-hidden="true" />保存配置</button></div>
            </form>
          </div>
          <DesignSettingsStatusPanel config={config} configLoaded={configLoaded} health={health} healthLoaded={healthLoaded} readiness={readiness} readinessLoaded={readinessLoaded} candidateProbe={candidates} candidatesLoaded={candidatesLoaded} adapter={adapter} baseUrl={baseUrl} controlsDisabled={controlsDisabled} isArtImageLocal={isArtImageLocal} smoke={smoke} onUseLocal={useZhenxiLocal} onUseExternal={useZhenxiExternal} />
        </div>
      )}
      {pendingConfirmation && pendingConfirmation.generation === confirmationGenerationRef.current ? <DesignConfirmation title="确认保存设计平台连接配置？" detail={`将保存适配器 ${pendingConfirmation.intent.adapter} 与服务地址 ${pendingConfirmation.intent.baseUrl}。敏感值不会在页面回显；留空表示不更新对应值。当前 API 不接受操作员身份字段，因此服务端审计能力取决于既有实现。`} confirmLabel="确认保存" confirmActionId="design-settings-save-confirm" cancelActionId="design-settings-save-cancel" busy={Boolean(busy)} onCancel={invalidateSaveConfirmation} onConfirm={() => void saveConfiguration()} /> : null}
    </section>
  );
}
