"use client";

import { RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignPlatformConfigResponse, DesignPlatformReadiness } from "../../lib/api";
import { getDesignPlatformConfig, getDesignPlatformReadiness, redeemDesignPlatformActivation } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignNotice, DesignPageHeader, errorText } from "./design-ui";
import { createDesignPlatformDeviceId, readRememberedDesignPlatformDeviceId, rememberDesignPlatformDeviceId } from "./model";

export function DesignActivationPage() {
  const [deviceId, setDeviceId] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("智能客服工作台");
  const [activationCode, setActivationCode] = useState("");
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

  function generateDeviceId() {
    const generated = createDesignPlatformDeviceId();
    setDeviceId(generated);
    rememberDesignPlatformDeviceId(generated);
    setError("");
    setNotice("设备 ID 已生成。请在设计平台后台为该设备生成激活码，再回来完成激活。");
  }

  function updateDeviceId(value: string) {
    setDeviceId(value);
    rememberDesignPlatformDeviceId(value);
  }

  async function activateDevice() {
    if (submitLockRef.current || busy) return;
    const code = activationCode.trim();
    const targetDeviceId = deviceId.trim();
    const targetDeviceLabel = deviceLabel.trim() || "智能客服工作台";
    setPendingConfirmation(false);
    if (!targetDeviceId || !code) {
      setError("设备 ID 和设计平台激活码都不能为空。");
      return;
    }
    submitLockRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await redeemDesignPlatformActivation({
        code,
        deviceId: targetDeviceId,
        deviceLabel: targetDeviceLabel,
      });
      setConfig(result);
      setConfigLoaded(true);
      setReadiness(result.readiness || null);
      setReadinessLoaded(Boolean(result.readiness));
      setActivationCode(""); setDeviceId(targetDeviceId); rememberDesignPlatformDeviceId(targetDeviceId);
      setNotice(result.readiness?.canSubmitFormalGeneration
        ? "设备已激活，设计平台已可正式出图。"
        : "设备激活已提交；账号登录或其他就绪检查仍需继续完成。");
    } catch (cause) { setError(errorText(cause, "设计平台设备激活失败")); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  const hasBoundDevice = Boolean(config?.config.hasDeviceId || readiness?.config.hasDeviceId);
  const activationCheck = readiness?.checks.find((check) => check.key === "art_image_activation");
  const authCheck = readiness?.checks.find((check) => check.key === "art_image_auth_session");
  const blockedChecks = readiness?.checks.filter((check) => !check.ok).slice(0, 4) || [];
  const publicServiceUrl =
    readiness?.config.zhenxiAi?.primaryAppUrl ||
    config?.config.zhenxiAi?.primaryAppUrl ||
    "未确认";

  return (
    <section className={styles.page} aria-label="设计平台设备激活">
      <DesignPageHeader eyebrow="设计平台" title="设备激活" detail="绑定当前客服设备到臻希 AI；后续所有客服出图都复用这条授权链路。" actions={<button type="button" data-action-id="design-activation-refresh-status" aria-label="刷新设计平台激活状态" disabled={busy || statusBusy} onClick={() => void refreshStatus()}><RefreshCw size={16} aria-hidden="true" />刷新状态</button>} />
      {statusError ? <DesignNotice tone="warning">{statusError}</DesignNotice> : null}
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <div className={styles.twoColumn}>
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setPendingConfirmation(true); }}>
          <div className={styles.cardHeader}><div><h2>绑定这台客服设备</h2><p>激活码必须来自臻希 AI 后台，并与下方设备 ID 一一对应。</p></div></div>
          <div className={styles.formGrid}>
            <label><span>设备 ID</span><input disabled={busy} value={deviceId} onChange={(event) => updateDeviceId(event.target.value)} placeholder="smart-kefu-..." /></label>
            <label><span>设备名称</span><input disabled={busy} value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} /></label>
            <label className={styles.fullField}><span>激活码</span><input disabled={busy} type="password" autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} placeholder="臻希 AI 设计平台后台生成的激活码" /></label>
          </div>
          <div className={styles.formActions}>
            <button type="button" data-action-id="design-activation-device-id-generate" aria-label="生成设计平台设备 ID" disabled={busy} onClick={generateDeviceId}><RefreshCw size={16} aria-hidden="true" />生成设备 ID</button>
            <button type="submit" className={styles.primaryButton} data-action-id="design-activation-request" aria-label="准备激活设计平台设备" disabled={busy || !deviceId.trim() || !activationCode.trim()}><Save size={16} aria-hidden="true" />激活设备</button>
          </div>
        </form>
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>当前连接</h2><p>{statusBusy ? "正在读取臻希 AI 状态。" : "先看地址和设备状态，再提交激活码。"}</p></div></div>
          <dl className={styles.factGrid}>
            <div><dt>臻希 AI 地址</dt><dd>{publicServiceUrl}</dd></div>
            <div><dt>设备绑定</dt><dd>{configLoaded && config ? (hasBoundDevice ? `已绑定${config.config.deviceIdSuffix ? ` · ${config.config.deviceIdSuffix}` : ""}` : "未绑定") : hasBoundDevice ? "已绑定" : "未确认"}</dd></div>
            <div><dt>设备激活</dt><dd>{activationCheck ? (activationCheck.ok ? "已激活" : "未完成") : "未确认"}</dd></div>
            <div><dt>账号登录</dt><dd>{authCheck ? (authCheck.ok ? "已登录" : "未登录") : "未确认"}</dd></div>
          </dl>
          {blockedChecks.length ? <ul className={styles.checkList}>{blockedChecks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><strong>{check.label}</strong><span>{check.detail}</span></li>)}</ul> : <p className={styles.muted}>{readinessLoaded ? "设备激活检查没有返回阻断项。" : "状态尚未读取完成。"}</p>}
          {hasBoundDevice ? <div className={styles.actionRow}><a className={styles.endpointLink} href="/design/account" data-action-id="design-activation-open-account">去登录账号</a></div> : null}
        </article>
      </div>
      {pendingConfirmation ? <DesignConfirmation title="确认激活这台设备？" detail="激活码会提交到设计平台，并把设备 ID 绑定到当前客服运行时。请确认两者属于同一台设备。" confirmLabel="确认激活" confirmActionId="design-activation-confirm" cancelActionId="design-activation-cancel" busy={busy} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void activateDevice()} /> : null}
    </section>
  );
}
