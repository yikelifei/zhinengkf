"use client";

import { FlaskConical, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DesignPlatformConfigResponse, DesignPlatformHealth, DesignPlatformReadiness, DesignPlatformSmokeTestResult } from "../../lib/api";
import { getDesignPlatformConfig, getDesignPlatformHealth, getDesignPlatformReadiness, runDesignPlatformSmokeTest, updateDesignPlatformConfig } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText } from "./design-ui";

export function DesignSettingsPage() {
  const [config, setConfig] = useState<DesignPlatformConfigResponse | null>(null);
  const [health, setHealth] = useState<DesignPlatformHealth | null>(null);
  const [readiness, setReadiness] = useState<DesignPlatformReadiness | null>(null);
  const [adapter, setAdapter] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [cookie, setCookie] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState<"" | "refresh" | "save" | "smoke">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [smoke, setSmoke] = useState<DesignPlatformSmokeTestResult | null>(null);

  const refresh = useCallback(async () => {
    setBusy("refresh"); setError(""); setNotice("");
    const [configResult, healthResult, readinessResult] = await Promise.allSettled([
      getDesignPlatformConfig(), getDesignPlatformHealth(), getDesignPlatformReadiness(),
    ]);
    const failures: string[] = [];
    if (configResult.status === "fulfilled") {
      setConfig(configResult.value); setAdapter(configResult.value.config.adapter); setBaseUrl(configResult.value.config.baseUrl);
    } else failures.push(errorText(configResult.reason, "配置读取失败"));
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    else failures.push(errorText(healthResult.reason, "健康状态读取失败"));
    if (readinessResult.status === "fulfilled") setReadiness(readinessResult.value);
    else failures.push(errorText(readinessResult.reason, "就绪状态读取失败"));
    setError(failures.join("；")); setBusy("");
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveConfiguration() {
    setPendingConfirmation(false); setBusy("save"); setError(""); setNotice("");
    try {
      const updated = await updateDesignPlatformConfig({
        adapter: adapter.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        accessToken: accessToken.trim() || undefined,
        cookie: cookie.trim() || undefined,
        deviceId: deviceId.trim() || undefined,
      });
      setConfig(updated); setReadiness(updated.readiness || null); setAccessToken(""); setCookie(""); setDeviceId("");
      setNotice("设计平台配置已保存；敏感字段已从表单清空。请重新检查健康状态。");
    } catch (cause) { setError(errorText(cause, "配置保存失败")); }
    finally { setBusy(""); }
  }

  async function runSmoke() {
    setBusy("smoke"); setError(""); setNotice(""); setSmoke(null);
    try {
      const result = await runDesignPlatformSmokeTest(); setSmoke(result);
      if (result.ok) setNotice(`联通测试通过，保存 ${result.savedImageCount} 张测试结果。`);
      else setError(result.errorMessage || "联通测试未通过，服务端未返回详细原因。");
    } catch (cause) { setError(errorText(cause, "联通测试失败")); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.page} aria-label="设计平台设置">
      <DesignPageHeader eyebrow="设计平台" title="连接设置" detail="只负责配置、健康检查和正式链路联通测试。" actions={<>
        <button type="button" data-action-id="design-settings-refresh" aria-label="刷新设计平台状态" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新</button>
        <button type="button" data-action-id="design-settings-smoke" aria-label="运行设计平台联通测试" disabled={Boolean(busy) || !readiness?.ok} onClick={() => void runSmoke()}><FlaskConical size={16} aria-hidden="true" />联通测试</button>
      </>} />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {!config && busy === "refresh" ? <DesignEmpty title="正在读取设计平台配置" detail="健康、就绪与配置状态并行读取。" busy /> : (
        <div className={styles.twoColumn}>
          <div className={styles.stack}>
            <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setPendingConfirmation(true); }}>
              <div className={styles.cardHeader}><div><h2>连接参数</h2><p>令牌、Cookie 和设备号不会从服务端回填。</p></div></div>
              <div className={styles.formGrid}>
                <label><span>适配器</span><input value={adapter} onChange={(event) => setAdapter(event.target.value)} placeholder="design-platform" /></label>
                <label><span>服务地址</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://..." /></label>
                <label><span>访问令牌（可选更新）</span><input type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} /></label>
                <label><span>会话 Cookie（可选更新）</span><input type="password" autoComplete="new-password" value={cookie} onChange={(event) => setCookie(event.target.value)} /></label>
                <label><span>设备号（可选更新）</span><input type="password" autoComplete="new-password" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} /></label>
              </div>
              <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-settings-save-request" aria-label="准备保存设计平台配置" disabled={Boolean(busy) || !adapter.trim() || !baseUrl.trim()}><Save size={16} aria-hidden="true" />保存配置</button></div>
            </form>
          </div>
          <div className={styles.stack}>
            <article className={styles.card}><div className={styles.cardHeader}><div><h2>实时状态</h2><p>来自独立健康与就绪接口。</p></div></div>
              <dl className={styles.factGrid}><div><dt>健康</dt><dd>{health ? (health.ok ? "正常" : "异常") : "不可用"}</dd></div><div><dt>延迟</dt><dd>{health ? `${health.latencyMs} ms` : "—"}</dd></div><div><dt>正式提交</dt><dd>{readiness?.canSubmitFormalGeneration ? "允许" : "不允许"}</dd></div><div><dt>适配器</dt><dd>{readiness?.adapter || config?.config.adapter || "—"}</dd></div><div><dt>回调签名</dt><dd>{config?.config.hasCallbackApiKey ? "已配置" : "未配置"}</dd></div><div><dt>设备绑定</dt><dd>{config?.config.hasDeviceId ? `已绑定${config.config.deviceIdSuffix ? ` · ${config.config.deviceIdSuffix}` : ""}` : "未绑定"}</dd></div></dl>
              {config?.config.callbackUrl ? <div className={styles.endpoint}><strong>出图完成回调地址</strong><code>{config.config.callbackUrl}</code><span>真实设计平台完成或失败后 POST 到这里；轮询仍会继续兜底。</span></div> : null}
              {readiness?.checks.length ? <ul className={styles.checkList}>{readiness.checks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul> : <p className={styles.muted}>未取得就绪检查明细。</p>}
            </article>
            {smoke ? <article className={styles.card}><div className={styles.cardHeader}><div><h2>最近联通测试</h2><p>{smoke.requestId} · {smoke.status}</p></div></div><dl className={styles.factGrid}><div><dt>候选图</dt><dd>{smoke.candidateCount}</dd></div><div><dt>已保存</dt><dd>{smoke.savedImageCount}</dd></div><div><dt>素材上传</dt><dd>{smoke.assetUploadCount}</dd></div><div><dt>耗时</dt><dd>{smoke.latencyMs} ms</dd></div></dl></article> : null}
          </div>
        </div>
      )}
      {pendingConfirmation ? <DesignConfirmation title="确认保存设计平台连接配置？" detail="这会修改运行时集成参数。敏感值不会在页面回显；留空表示不更新对应值。当前 API 不接受操作员身份字段，因此服务端审计能力取决于既有实现。" confirmLabel="确认保存" confirmActionId="design-settings-save-confirm" cancelActionId="design-settings-save-cancel" busy={busy === "save"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void saveConfiguration()} /> : null}
    </section>
  );
}
