"use client";

import { useState } from "react";
import { Power } from "lucide-react";
import type { PersonalWechatRpaInstance } from "../../lib/api";
import { errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";

type DangerZoneProps = {
  instance: PersonalWechatRpaInstance;
  busy?: boolean;
  onDisable: (wechatAccountId: string) => Promise<void>;
};

export function PersonalWechatInstanceDangerZone({ instance, busy = false, onDisable }: DangerZoneProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const operationBusy = busy || pending;

  async function disableInstance() {
    if (!confirmed || operationBusy) return;
    setPending(true);
    setError("");
    try {
      await onDisable(instance.wechatAccountId);
      setConfirming(false);
      setConfirmed(false);
    } catch (disableError) {
      setError(errorMessage(disableError, "停用实例失败"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={`${styles.panel} ${styles.dangerZone}`} aria-labelledby="personal-wechat-danger-zone-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="personal-wechat-danger-zone-title">危险操作</h2>
          <p>停用会立即让该账号退出路由，但保留脱敏配置记录。</p>
        </div>
      </header>
      {!instance.enabled ? (
        <p className={styles.mutedText}>该实例已经停用，无需重复操作。</p>
      ) : confirming ? (
        <div className={styles.confirmation} role="region" aria-live="polite" aria-label={`确认停用 ${instance.wechatAccountId}`}>
          <strong>确认停用 {instance.accountNickname || instance.wechatAccountId}</strong>
          <label className={styles.checkboxField} htmlFor="confirm-disable-personal-wechat-instance">
            <input
              id="confirm-disable-personal-wechat-instance"
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={operationBusy}
            />
            <span>我已确认当前账号与实例 ID<small>{instance.wechatAccountId}</small></span>
          </label>
          <div className={styles.buttonRow}>
            <button
              type="button"
              data-action-id="integrations.personal-wechat.instance-config.cancel-disable"
              aria-label="取消停用个人微信实例"
              onClick={() => { setConfirming(false); setConfirmed(false); setError(""); }}
              disabled={operationBusy}
            >取消</button>
            <button
              type="button"
              className={styles.dangerButton}
              data-action-id="integrations.personal-wechat.instance-config.confirm-disable"
              aria-label={`确认停用个人微信实例 ${instance.wechatAccountId}`}
              onClick={() => void disableInstance()}
              disabled={operationBusy || !confirmed}
            >
              <Power size={15} aria-hidden="true" /> {pending ? "停用中" : "确认停用"}
            </button>
          </div>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        </div>
      ) : (
        <button
          type="button"
          className={styles.dangerButton}
          data-action-id="integrations.personal-wechat.instance-config.request-disable"
          aria-label={`准备停用个人微信实例 ${instance.wechatAccountId}`}
          onClick={() => setConfirming(true)}
          disabled={operationBusy}
        >
          <Power size={15} aria-hidden="true" /> 准备停用实例
        </button>
      )}
    </section>
  );
}
