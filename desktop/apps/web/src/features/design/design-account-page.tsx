"use client";

import { LogIn } from "lucide-react";
import { useRef, useState } from "react";
import { loginDesignPlatform } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignNotice, DesignPageHeader, errorText } from "./design-ui";

export function DesignAccountPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitLockRef = useRef(false);

  async function loginAccount() {
    if (submitLockRef.current || busy) return;
    setPendingConfirmation(false);
    if (!email.trim() || !password || !deviceId.trim()) {
      setError("邮箱、密码和已激活设备 ID 都不能为空。");
      return;
    }
    const intent = { email: email.trim(), password, deviceId: deviceId.trim() };
    submitLockRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await loginDesignPlatform(intent);
      setPassword(""); setDeviceId("");
      setNotice(result.user?.email ? `设计平台账号 ${result.user.email} 已登录。` : "设计平台账号已登录。敏感字段已从表单清空。");
    } catch (cause) { setError(errorText(cause, "设计平台账号登录失败")); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label="设计平台账号登录">
      <DesignPageHeader eyebrow="设计平台" title="平台账号" detail="只负责在设备激活后登录设计平台账号；不会保存或回显密码。" />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setPendingConfirmation(true); }}>
        <div className={styles.cardHeader}><div><h2>登录设计平台</h2><p>先完成设备激活，再使用该设备 ID 登录账号。</p></div></div>
        <div className={styles.formGrid}>
          <label><span>账号邮箱</span><input disabled={busy} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>账号密码</span><input disabled={busy} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label><span>已激活设备 ID</span><input disabled={busy} value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="smart-kefu-..." /></label>
        </div>
        <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-account-login-request" aria-label="准备登录设计平台账号" disabled={busy || !email.trim() || !password || !deviceId.trim()}><LogIn size={16} aria-hidden="true" />登录账号</button></div>
      </form>
      {pendingConfirmation ? <DesignConfirmation title="确认登录这个设计平台账号？" detail="账号凭据会提交到现有设计平台登录接口；页面不会保存或回显密码。" confirmLabel="确认登录" confirmActionId="design-account-login-confirm" cancelActionId="design-account-login-cancel" busy={busy} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void loginAccount()} /> : null}
    </section>
  );
}
