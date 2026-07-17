"use client";

import { RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { redeemDesignPlatformActivation } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignNotice, DesignPageHeader, errorText } from "./design-ui";
import { createDesignPlatformDeviceId } from "./model";

export function DesignActivationPage() {
  const [deviceId, setDeviceId] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("智能客服工作台");
  const [activationCode, setActivationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function generateDeviceId() {
    setDeviceId(createDesignPlatformDeviceId());
    setError("");
    setNotice("设备 ID 已生成。请在设计平台后台为该设备生成激活码，再回来完成激活。");
  }

  async function activateDevice() {
    const code = activationCode.trim();
    const targetDeviceId = deviceId.trim();
    setPendingConfirmation(false);
    if (!targetDeviceId || !code) {
      setError("设备 ID 和设计平台激活码都不能为空。");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await redeemDesignPlatformActivation({
        code,
        deviceId: targetDeviceId,
        deviceLabel: deviceLabel.trim() || "智能客服工作台",
      });
      setActivationCode(""); setDeviceId("");
      setNotice(result.readiness?.canSubmitFormalGeneration
        ? "设备已激活，设计平台已可正式出图。"
        : "设备激活已提交；请前往连接设置查看尚未完成的就绪检查。");
    } catch (cause) { setError(errorText(cause, "设计平台设备激活失败")); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label="设计平台设备激活">
      <DesignPageHeader eyebrow="设计平台" title="设备激活" detail="只负责生成本机设备 ID，并使用设计平台后台签发的激活码完成绑定。" />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setPendingConfirmation(true); }}>
        <div className={styles.cardHeader}><div><h2>绑定这台客服设备</h2><p>激活码必须来自设计平台后台，并与下方设备 ID 一一对应。</p></div></div>
        <div className={styles.formGrid}>
          <label><span>设备 ID</span><input value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="smart-kefu-..." /></label>
          <label><span>设备名称</span><input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} /></label>
          <label><span>激活码</span><input type="password" autoComplete="one-time-code" value={activationCode} onChange={(event) => setActivationCode(event.target.value)} placeholder="设计平台后台生成的激活码" /></label>
        </div>
        <div className={styles.formActions}>
          <button type="button" data-action-id="design-activation-device-id-generate" aria-label="生成设计平台设备 ID" disabled={busy} onClick={generateDeviceId}><RefreshCw size={16} aria-hidden="true" />生成设备 ID</button>
          <button type="submit" className={styles.primaryButton} data-action-id="design-activation-request" aria-label="准备激活设计平台设备" disabled={busy || !deviceId.trim() || !activationCode.trim()}><Save size={16} aria-hidden="true" />激活设备</button>
        </div>
      </form>
      {pendingConfirmation ? <DesignConfirmation title="确认激活这台设备？" detail="激活码会提交到设计平台，并把设备 ID 绑定到当前客服运行时。请确认两者属于同一台设备。" confirmLabel="确认激活" confirmActionId="design-activation-confirm" cancelActionId="design-activation-cancel" busy={busy} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void activateDevice()} /> : null}
    </section>
  );
}
