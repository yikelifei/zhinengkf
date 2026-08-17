"use client";

import { LogIn, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignPlatformConfigResponse, DesignPlatformReadiness } from "../../lib/api";
import { getDesignPlatformConfig, getDesignPlatformReadiness, loginDesignPlatform } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignNotice, DesignPageHeader, errorText } from "./design-ui";
import { readRememberedDesignPlatformDeviceId, rememberDesignPlatformDeviceId } from "./model";

export function DesignAccountPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [config, setConfig] = useState<DesignPlatformConfigResponse | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [readiness, setReadiness] = useState<DesignPlatformReadiness | null>(null);
  const [readinessLoaded, setReadinessLoaded] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitLockRef = useRef(false);
  const deviceIdRef = useRef("");

  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);

  const refreshStatus = useCallback(async () => {
    setStatusBusy(true);
    setStatusError("");
    const statusDeviceId = deviceIdRef.current.trim() || readRememberedDesignPlatformDeviceId();
    const [configResult, readinessResult] = await Promise.allSettled([
      getDesignPlatformConfig(),
      getDesignPlatformReadiness(statusDeviceId),
    ]);
    if (configResult.status === "fulfilled") {
      setConfig(configResult.value);
      setConfigLoaded(true);
    } else {
      setConfig(null);
      setConfigLoaded(false);
      setStatusError(errorText(configResult.reason, "设计平台配置读取失败"));
    }
    if (readinessResult.status === "fulfilled") {
      setReadiness(readinessResult.value);
      setReadinessLoaded(true);
    } else {
      setReadiness(null);
      setReadinessLoaded(false);
      setStatusError((current) => [current, errorText(readinessResult.reason, "设计平台就绪读取失败")].filter(Boolean).join("；"));
    }
    setStatusBusy(false);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const remembered = readRememberedDesignPlatformDeviceId();
    if (remembered) setDeviceId((current) => current || remembered);
  }, []);

  async function loginAccount() {
    if (submitLockRef.current || busy) return;
    setPendingConfirmation(false);
    const hasBoundDevice = Boolean(config?.config.hasDeviceId);
    if (!email.trim() || !password || (!hasBoundDevice && !deviceId.trim())) {
      setError(hasBoundDevice ? "邮箱和密码不能为空。" : "邮箱、密码和已激活设备 ID 都不能为空。");
      return;
    }
    const intent = { email: email.trim(), password, deviceId: deviceId.trim() };
    submitLockRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await loginDesignPlatform(intent);
      setConfig(result);
      setConfigLoaded(true);
      setReadiness(result.readiness || null);
      setReadinessLoaded(Boolean(result.readiness));
      setPassword(""); setDeviceId(""); rememberDesignPlatformDeviceId("");
      setNotice(result.user?.email ? `设计平台账号 ${result.user.email} 已登录。` : "设计平台账号已登录。敏感字段已从表单清空。");
    } catch (cause) { setError(errorText(cause, "设计平台账号登录失败")); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  function updateDeviceId(value: string) {
    setDeviceId(value);
    rememberDesignPlatformDeviceId(value);
  }

  const hasBoundDevice = Boolean(config?.config.hasDeviceId);
  const activationCheck = readiness?.checks.find((check) => check.key === "art_image_activation");
  const authCheck = readiness?.checks.find((check) => check.key === "art_image_auth_session");
  const loginDisabled = busy || !email.trim() || !password || (!hasBoundDevice && !deviceId.trim());
  const blockedChecks = readiness?.checks.filter((check) => !check.ok).slice(0, 4) || [];
  const publicServiceUrl =
    readiness?.config.zhenxiAi?.primaryAppUrl ||
    config?.config.zhenxiAi?.primaryAppUrl ||
    "未确认";

  return (
    <section className={styles.page} aria-label="设计平台账号登录">
      <DesignPageHeader eyebrow="设计平台" title="平台账号" detail="连接到当前臻希 AI 服务地址后完成账号登录；不会保存或回显密码。" actions={<button type="button" data-action-id="design-account-refresh-status" aria-label="刷新设计平台登录状态" disabled={busy || statusBusy} onClick={() => void refreshStatus()}><RefreshCw size={16} aria-hidden="true" />刷新状态</button>} />
      {statusError ? <DesignNotice tone="warning">{statusError}</DesignNotice> : null}
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <div className={styles.twoColumn}>
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); if (!loginDisabled) setPendingConfirmation(true); }}>
          <div className={styles.cardHeader}><div><h2>登录臻希 AI 账号</h2><p>{hasBoundDevice ? "当前运行时已有绑定设备，账号登录可直接复用该设备。" : "先完成设备激活，再使用同一个设备 ID 登录账号。"}</p></div></div>
          <div className={styles.formGrid}>
            <label><span>账号邮箱</span><input disabled={busy} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>账号密码</span><input disabled={busy} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label className={styles.fullField}><span>{hasBoundDevice ? "设备 ID（已有绑定时可留空）" : "已激活设备 ID"}</span><input disabled={busy} value={deviceId} onChange={(event) => updateDeviceId(event.target.value)} placeholder={hasBoundDevice ? "留空则使用当前绑定设备" : "smart-kefu-..."} /></label>
          </div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-account-login-request" aria-label="准备登录设计平台账号" disabled={loginDisabled}><LogIn size={16} aria-hidden="true" />登录账号</button></div>
        </form>
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>当前连接</h2><p>{statusBusy ? "正在读取臻希 AI 状态。" : "来自客服运行时和臻希 AI 就绪检查。"}</p></div></div>
          <dl className={styles.factGrid}>
            <div><dt>臻希 AI 地址</dt><dd>{publicServiceUrl}</dd></div>
            <div><dt>设备绑定</dt><dd>{configLoaded && config ? (hasBoundDevice ? `已绑定${config.config.deviceIdSuffix ? ` · ${config.config.deviceIdSuffix}` : ""}` : "未绑定") : "未确认"}</dd></div>
            <div><dt>设备激活</dt><dd>{activationCheck ? (activationCheck.ok ? "已激活" : "未完成") : "未确认"}</dd></div>
            <div><dt>登录态</dt><dd>{authCheck ? (authCheck.ok ? "已登录" : "未登录") : "未确认"}</dd></div>
          </dl>
          {blockedChecks.length ? <ul className={styles.checkList}>{blockedChecks.map((check) => <li className={styles.bad} key={check.key}><strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul> : <p className={styles.muted}>{readinessLoaded ? "账号与设备检查没有返回阻断项。" : "状态尚未读取完成。"}</p>}
          {!hasBoundDevice ? <div className={styles.actionRow}><a className={styles.endpointLink} href="/design/activation" data-action-id="design-account-open-activation">去激活设备</a></div> : null}
        </article>
      </div>
      {pendingConfirmation ? <DesignConfirmation title="确认登录这个设计平台账号？" detail={hasBoundDevice && !deviceId.trim() ? "账号凭据会提交到臻希 AI 登录接口，并复用当前运行时绑定设备；页面不会保存或回显密码。" : "账号凭据会提交到臻希 AI 登录接口；页面不会保存或回显密码。"} confirmLabel="确认登录" confirmActionId="design-account-login-confirm" cancelActionId="design-account-login-cancel" busy={busy} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void loginAccount()} /> : null}
    </section>
  );
}
