"use client";

import { FlaskConical, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignPlatformConfigResponse, DesignPlatformHealth, DesignPlatformReadiness, DesignPlatformSmokeTestResult } from "../../lib/api";
import { getDesignPlatformConfig, getDesignPlatformHealth, getDesignPlatformReadiness, runDesignPlatformSmokeTest, updateDesignPlatformConfig } from "./api";
import { createDesignRequestGuard, runGuardedDesignRequest } from "./design-request-guard";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText } from "./design-ui";

const SETTINGS_SCOPE_KEY = "design-settings";

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
  const [adapter, setAdapter] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [cookie, setCookie] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState<"" | "refresh" | "save" | "smoke">("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [smoke, setSmoke] = useState<DesignPlatformSmokeTestResult | null>(null);
  const requestGuardRef = useRef<ReturnType<typeof createDesignRequestGuard> | null>(null);
  const actionLockRef = useRef(false);
  if (!requestGuardRef.current) requestGuardRef.current = createDesignRequestGuard(SETTINGS_SCOPE_KEY);
  const requestGuard = requestGuardRef.current;

  useEffect(() => {
    requestGuard.activate();
    return () => requestGuard.dispose();
  }, [requestGuard]);

  const refresh = useCallback(async () => {
    await runGuardedDesignRequest({
      guard: requestGuard,
      scopeKey: SETTINGS_SCOPE_KEY,
      load: () => Promise.allSettled([
        getDesignPlatformConfig(), getDesignPlatformHealth(), getDesignPlatformReadiness(),
      ]),
      onStart: () => {
        setBusy("refresh"); setActionError(""); setNotice("");
        setConfig(null); setConfigLoaded(false); setConfigError("");
        setAdapter(""); setBaseUrl("");
        setHealth(null); setHealthLoaded(false); setHealthError("");
        setReadiness(null); setReadinessLoaded(false); setReadinessError("");
      },
      onSuccess: ([configResult, healthResult, readinessResult]) => {
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
      },
      onError: (cause) => {
        const message = errorText(cause, "设计平台状态读取失败");
        setConfig(null); setConfigLoaded(false); setConfigError(message);
        setHealth(null); setHealthLoaded(false); setHealthError(message);
        setReadiness(null); setReadinessLoaded(false); setReadinessError(message);
      },
      onFinally: () => setBusy(""),
    });
  }, [requestGuard]);

  useEffect(() => {
    void refresh();
    return () => requestGuard.invalidate(SETTINGS_SCOPE_KEY);
  }, [refresh, requestGuard]);

  async function saveConfiguration() {
    if (actionLockRef.current || busy) return;
    const intent = {
      adapter: adapter.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      accessToken: accessToken.trim() || undefined,
      cookie: cookie.trim() || undefined,
      deviceId: deviceId.trim() || undefined,
    };
    actionLockRef.current = true;
    setPendingConfirmation(false);
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
          setAccessToken(""); setCookie(""); setDeviceId("");
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

  const error = [configError, healthError, readinessError, actionError].filter(Boolean).join("；");
  const controlsDisabled = Boolean(busy);

  return (
    <section className={styles.page} aria-label="设计平台设置">
      <DesignPageHeader eyebrow="设计平台" title="连接设置" detail="只负责配置、健康检查和正式链路联通测试。" actions={<>
        <button type="button" data-action-id="design-settings-refresh" aria-label="刷新设计平台状态" disabled={controlsDisabled} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新</button>
        <button type="button" data-action-id="design-settings-smoke" aria-label="运行设计平台联通测试" disabled={controlsDisabled || !readinessLoaded || !readiness?.ok} onClick={() => void runSmoke()}><FlaskConical size={16} aria-hidden="true" />联通测试</button>
      </>} />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {busy === "refresh" && !configLoaded && !healthLoaded && !readinessLoaded ? <DesignEmpty title="正在读取设计平台配置" detail="健康、就绪与配置状态并行读取。" busy /> : (
        <div className={styles.twoColumn}>
          <div className={styles.stack}>
            <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setPendingConfirmation(true); }}>
              <div className={styles.cardHeader}><div><h2>连接参数</h2><p>{configLoaded ? "配置读取成功；令牌、Cookie 和设备号不会从服务端回填。" : "配置读取尚未确认；保存前请核对错误提示。"}</p></div></div>
              <div className={styles.formGrid}>
                <label><span>适配器</span><input disabled={controlsDisabled} value={adapter} onChange={(event) => setAdapter(event.target.value)} placeholder="design-platform" /></label>
                <label><span>服务地址</span><input disabled={controlsDisabled} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://..." /></label>
                <label><span>访问令牌（可选更新）</span><input disabled={controlsDisabled} type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} /></label>
                <label><span>会话 Cookie（可选更新）</span><input disabled={controlsDisabled} type="password" autoComplete="new-password" value={cookie} onChange={(event) => setCookie(event.target.value)} /></label>
                <label><span>设备号（可选更新）</span><input disabled={controlsDisabled} type="password" autoComplete="new-password" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} /></label>
              </div>
              <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-settings-save-request" aria-label="准备保存设计平台配置" disabled={controlsDisabled || !adapter.trim() || !baseUrl.trim()}><Save size={16} aria-hidden="true" />保存配置</button></div>
            </form>
          </div>
          <div className={styles.stack}>
            <article className={styles.card}><div className={styles.cardHeader}><div><h2>实时状态</h2><p>来自独立健康与就绪接口。</p></div></div>
              <dl className={styles.factGrid}><div><dt>健康</dt><dd>{healthLoaded && health ? (health.ok ? "正常" : "异常") : "未确认"}</dd></div><div><dt>延迟</dt><dd>{healthLoaded && health ? `${health.latencyMs} ms` : "—"}</dd></div><div><dt>正式提交</dt><dd>{readinessLoaded && readiness ? (readiness.canSubmitFormalGeneration ? "允许" : "不允许") : "未确认"}</dd></div><div><dt>适配器</dt><dd>{readinessLoaded && readiness ? readiness.adapter : configLoaded && config ? config.config.adapter : "未确认"}</dd></div><div><dt>回调签名</dt><dd>{configLoaded && config ? (config.config.hasCallbackApiKey ? "已配置" : "未配置") : "未确认"}</dd></div><div><dt>设备绑定</dt><dd>{configLoaded && config ? (config.config.hasDeviceId ? `已绑定${config.config.deviceIdSuffix ? ` · ${config.config.deviceIdSuffix}` : ""}` : "未绑定") : "未确认"}</dd></div></dl>
              {configLoaded && config?.config.callbackUrl ? <div className={styles.endpoint}><strong>出图完成回调地址</strong><code>{config.config.callbackUrl}</code><span>真实设计平台完成或失败后 POST 到这里；轮询仍会继续兜底。</span></div> : null}
              {readinessLoaded && readiness?.checks.length ? <ul className={styles.checkList}>{readiness.checks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul> : <p className={styles.muted}>{readinessLoaded ? "读取成功，未返回就绪检查明细。" : "就绪检查明细尚未成功读取。"}</p>}
            </article>
            {smoke ? <article className={styles.card}><div className={styles.cardHeader}><div><h2>最近联通测试</h2><p>{smoke.requestId} · {smoke.status}</p></div></div><dl className={styles.factGrid}><div><dt>候选图</dt><dd>{smoke.candidateCount}</dd></div><div><dt>已保存</dt><dd>{smoke.savedImageCount}</dd></div><div><dt>素材上传</dt><dd>{smoke.assetUploadCount}</dd></div><div><dt>耗时</dt><dd>{smoke.latencyMs} ms</dd></div></dl></article> : null}
          </div>
        </div>
      )}
      {pendingConfirmation ? <DesignConfirmation title="确认保存设计平台连接配置？" detail="这会修改运行时集成参数。敏感值不会在页面回显；留空表示不更新对应值。当前 API 不接受操作员身份字段，因此服务端审计能力取决于既有实现。" confirmLabel="确认保存" confirmActionId="design-settings-save-confirm" cancelActionId="design-settings-save-cancel" busy={busy === "save"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void saveConfiguration()} /> : null}
    </section>
  );
}
