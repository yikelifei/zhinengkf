import { ChevronRight, Monitor, ShieldAlert } from "lucide-react";
import type { PersonalWechatAccount } from "./types";
import styles from "./personal-wechat-control-center.module.css";

type AccountFleetPaneProps = {
  accounts: PersonalWechatAccount[];
  selectedAccountId?: string | null;
  busy: boolean;
  onSelectAccount: (accountId: string) => void;
};

export function AccountFleetPane({
  accounts,
  selectedAccountId,
  busy,
  onSelectAccount,
}: AccountFleetPaneProps) {
  return (
    <section className={styles.fleetPane} aria-labelledby="personal-wechat-fleet-title">
      <div className={styles.panelHeading}>
        <div>
          <h3 id="personal-wechat-fleet-title">微信账号与 Windows 会话</h3>
          <span>{accounts.length} 个已登记账号</span>
        </div>
      </div>

      {accounts.length ? (
        <div className={styles.accountList} role="list">
          {accounts.map((account) => {
            const selected = account.id === selectedAccountId;
            return (
              <button
                type="button"
                role="listitem"
                key={account.id}
                className={`${styles.accountRow} ${selected ? styles.selected : ""}`}
                aria-pressed={selected}
                onClick={() => onSelectAccount(account.id)}
                disabled={busy}
              >
                <span className={styles.avatar} aria-hidden="true">{account.avatarFallback}</span>
                <span className={styles.accountCopy}>
                  <span className={styles.accountTitle}>
                    <strong>{account.displayName}</strong>
                    <span className={`${styles.state} ${styles[account.state]}`}>{account.stateLabel}</span>
                  </span>
                  <small>{account.maskedAccount || "账号标识未提供"}</small>
                  <span className={styles.sessionLine}>
                    <Monitor size={13} aria-hidden="true" />
                    {account.windowsSessionLabel} · {account.windowsSessionId}
                  </span>
                  {account.stateDetail ? (
                    <span className={styles.stateDetail}>
                      {account.state === "isolated" ? <ShieldAlert size={13} aria-hidden="true" /> : null}
                      {account.stateDetail}
                    </span>
                  ) : null}
                </span>
                <span className={styles.rowMeta}>
                  {account.pendingApprovalCount ? <b>{account.pendingApprovalCount} 待审批</b> : <span>无待审批</span>}
                  <small>{account.lastActivityLabel || "暂无活动记录"}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <Monitor size={22} aria-hidden="true" />
          <strong>尚未登记个人微信实例</strong>
          <span>先完成独立 Windows 会话、端点和窗口身份绑定，再启用受监督的客服流程。</span>
        </div>
      )}
    </section>
  );
}
