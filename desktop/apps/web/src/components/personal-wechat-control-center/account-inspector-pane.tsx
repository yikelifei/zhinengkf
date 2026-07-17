import {
  CircleCheck,
  CircleX,
  Hand,
  MonitorCog,
  Network,
  ShieldAlert,
} from "lucide-react";
import type { PersonalWechatAccount } from "./types";
import styles from "./personal-wechat-control-center.module.css";

type AccountInspectorPaneProps = {
  account: PersonalWechatAccount | null;
  busy: boolean;
  onRequestManualTakeover: (accountId: string) => void;
  onReleaseManualTakeover: (accountId: string) => void;
  onIsolateAccount: (accountId: string) => void;
  onRequestReleaseIsolation: (accountId: string) => void;
};

export function AccountInspectorPane({
  account,
  busy,
  onRequestManualTakeover,
  onReleaseManualTakeover,
  onIsolateAccount,
  onRequestReleaseIsolation,
}: AccountInspectorPaneProps) {
  if (!account) {
    return (
      <section className={styles.inspectorPane} aria-label="账号运行身份">
        <div className={styles.emptyState}>
          <MonitorCog size={22} aria-hidden="true" />
          <strong>请选择一个微信账号</strong>
          <span>查看它绑定的 Windows 会话、端点与窗口身份。</span>
        </div>
      </section>
    );
  }

  const identity = account.windowIdentity;
  const IdentityIcon = identity.verified ? CircleCheck : CircleX;

  return (
    <section className={styles.inspectorPane} aria-labelledby="personal-wechat-inspector-title">
      <div className={styles.panelHeading}>
        <div>
          <h3 id="personal-wechat-inspector-title">运行身份与控制边界</h3>
          <span>{account.displayName}</span>
        </div>
        <span className={`${styles.state} ${styles[account.state]}`}>{account.stateLabel}</span>
      </div>

      <dl className={styles.identityGrid}>
        <div>
          <dt><MonitorCog size={14} aria-hidden="true" />Windows 会话</dt>
          <dd>{account.windowsSessionLabel}</dd>
          <small>{account.windowsSessionId}</small>
        </div>
        <div>
          <dt><Network size={14} aria-hidden="true" />本机端点</dt>
          <dd className={styles[account.endpoint.state]}>{account.endpoint.stateLabel}</dd>
          <code>{account.endpoint.url || "未配置"}</code>
          <small>{account.endpoint.lastSeenLabel || "尚无心跳"}</small>
        </div>
        <div>
          <dt><IdentityIcon size={14} aria-hidden="true" />窗口身份</dt>
          <dd className={identity.verified ? styles.ready : styles.unavailable}>
            {identity.verified ? "已核验" : "未核验"}
          </dd>
          <small>{formatWindowIdentity(account)}</small>
          <small>{identity.verifiedAtLabel || "尚无核验时间"}</small>
        </div>
      </dl>

      <div className={styles.controlActions} aria-label="账号控制操作">
        {account.state === "manual" ? (
          <button
            type="button"
            data-action-id={`integrations.personal-wechat.control.release-takeover.${account.id}`}
            aria-label={`结束账号 ${account.displayName} 的人工接管`}
            onClick={() => onReleaseManualTakeover(account.id)}
            disabled={busy}
          >
            <Hand size={15} aria-hidden="true" />结束人工接管
          </button>
        ) : (
          <button
            type="button"
            data-action-id={`integrations.personal-wechat.control.request-takeover.${account.id}`}
            aria-label={`请求人工接管账号 ${account.displayName}`}
            onClick={() => onRequestManualTakeover(account.id)}
            disabled={busy || account.state === "isolated" || account.state === "offline"}
          >
            <Hand size={15} aria-hidden="true" />请求人工接管
          </button>
        )}

        {account.state === "isolated" ? (
          <button
            type="button"
            className={styles.secondaryAction}
            data-action-id={`integrations.personal-wechat.control.release-isolation.${account.id}`}
            aria-label={`申请解除账号 ${account.displayName} 的隔离`}
            onClick={() => onRequestReleaseIsolation(account.id)}
            disabled={busy}
          >
            <ShieldAlert size={15} aria-hidden="true" />申请解除隔离
          </button>
        ) : (
          <button
            type="button"
            className={styles.dangerAction}
            data-action-id={`integrations.personal-wechat.control.isolate-account.${account.id}`}
            aria-label={`隔离个人微信账号 ${account.displayName}`}
            onClick={() => onIsolateAccount(account.id)}
            disabled={busy}
          >
            <ShieldAlert size={15} aria-hidden="true" />隔离账号
          </button>
        )}
      </div>

      <p className={styles.boundaryNote}>
        批量运营只统一管理队列与审批，不允许跨 Windows 会话复用窗口身份，也不提供一键群发。
      </p>
    </section>
  );
}

function formatWindowIdentity(account: PersonalWechatAccount) {
  const parts = [
    account.windowIdentity.title || "窗口标题未知",
    account.windowIdentity.processId ? `PID ${account.windowIdentity.processId}` : null,
    account.windowIdentity.windowHandle ? `HWND ${account.windowIdentity.windowHandle}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
