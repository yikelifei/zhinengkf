"use client";

import Link from "next/link";
import { UserRoundPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation } from "../../lib/api";
import {
  completeClientOperation,
  reserveClientOperation,
  type PendingClientOperation,
} from "../../lib/client-operation-key";
import type { ConversationsFeatureApi } from "./api";
import { conversationIdentity } from "./model";
import styles from "./conversation-pages.module.css";

const DEFAULT_WORDING = "您好，我是您的专属服务专员。添加企业微信后，我可以继续为您提供长期服务。";

export function useCustomerUpgradeAction(input: {
  api: ConversationsFeatureApi;
  conversation: Conversation;
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memberUserIds, setMemberUserIds] = useState<string[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [wording, setWording] = useState(DEFAULT_WORDING);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingOperation = useRef<PendingClientOperation | null>(null);

  useEffect(() => {
    setOpen(false);
    setMemberUserIds([]);
    setMemberUserId("");
    setWording(DEFAULT_WORDING);
    setError("");
    setNotice("");
    pendingOperation.current = null;
  }, [input.conversation.id]);

  const openPanel = useCallback(async () => {
    setOpen(true);
    setError("");
    setNotice("");
    if (!input.allowed) {
      setError("当前操作员没有企业微信发送审批权限，不能发起长期客户升级。");
      return;
    }
    setBusy(true);
    try {
      const config = await input.api.getWechatWorkUpgradeServiceConfig();
      setMemberUserIds(config.memberUserIds);
      setMemberUserId((current) => current || config.memberUserIds[0] || "");
      if (!config.ready) setError("企业微信还没有配置升级服务专员，请先完成配置。 ");
    } catch (loadError) {
      setError(errorMessage(loadError, "升级服务配置读取失败"));
    } finally {
      setBusy(false);
    }
  }, [input.allowed, input.api]);

  const confirm = useCallback(async () => {
    if (!input.allowed || !memberUserId || busy) return;
    const identity = conversationIdentity(input.conversation);
    const operation = reserveClientOperation(
      "customer-upgrade",
      { identity, memberUserId, wording },
      pendingOperation.current,
    );
    pendingOperation.current = operation;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await input.api.upgradeWechatWorkCustomerService(
        identity,
        memberUserId,
        wording,
        operation.key,
      );
      pendingOperation.current = completeClientOperation(pendingOperation.current, operation.key);
      setNotice(result.alreadyRecommended
        ? "该客户已经收到相同的长期服务推荐，请等待客户确认添加。"
        : "长期服务推荐已提交。客户确认添加企业微信专员后，才会成为可长期跟进的客户。",
      );
    } catch (submitError) {
      setError(errorMessage(submitError, "长期客户升级失败"));
    } finally {
      setBusy(false);
    }
  }, [busy, input, memberUserId, wording]);

  return {
    open,
    busy,
    memberUserIds,
    memberUserId,
    wording,
    error,
    notice,
    allowed: input.allowed,
    openPanel,
    closePanel: () => setOpen(false),
    setMemberUserId,
    setWording,
    confirm,
  };
}

export type CustomerUpgradeAction = ReturnType<typeof useCustomerUpgradeAction>;

export function CustomerUpgradeActionCard(input: {
  api: ConversationsFeatureApi;
  conversation: Conversation;
  allowed: boolean;
}) {
  const action = useCustomerUpgradeAction(input);
  return (
    <>
      {!action.open ? (
        <section className={styles.upgradeEntryBar} aria-label="长期客户服务">
          <div><strong>需要长期跟进这个客户？</strong><span>邀请客户添加企业微信专员，建立长期客户关系。</span></div>
          <button
            className={styles.primaryButton}
            type="button"
            data-action-id="conversations.customer-upgrade.open"
            onClick={() => void action.openPanel()}
            disabled={!action.allowed}
          >
            <UserRoundPlus size={15} aria-hidden="true" />升级长期客户
          </button>
        </section>
      ) : null}
      <CustomerUpgradePanel action={action} />
    </>
  );
}

export function CustomerUpgradePanel({ action }: { action: CustomerUpgradeAction }) {
  if (!action.open) return null;
  return (
    <section
      className={`${styles.confirmation} ${styles.upgradePanel}`}
      id="long-term-customer-upgrade"
      role="region"
      aria-live="polite"
      aria-labelledby="long-term-customer-title"
    >
      <div className={styles.upgradePanelHeader}>
        <div>
          <strong id="long-term-customer-title"><UserRoundPlus size={17} aria-hidden="true" /> 升级为长期客户</strong>
          <p>向当前客户推荐企业微信专员。客户仍需确认添加，系统不会把一次客服咨询冒充成永久好友关系。</p>
        </div>
        <button className={styles.button} type="button" data-action-id="conversations.customer-upgrade.close" onClick={action.closePanel} aria-label="关闭长期客户升级"><X size={15} aria-hidden="true" /></button>
      </div>
      {action.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{action.error}</div> : null}
      {action.notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{action.notice}</div> : null}
      {action.memberUserIds.length ? (
        <div className={styles.upgradeForm}>
          <label className={styles.upgradeField}>
            <span>长期服务专员</span>
            <select value={action.memberUserId} onChange={(event) => action.setMemberUserId(event.target.value)} disabled={action.busy}>
              {action.memberUserIds.map((userId) => <option key={userId} value={userId}>{userId}</option>)}
            </select>
          </label>
          <label className={styles.upgradeField}>
            <span>给客户的推荐语</span>
            <textarea maxLength={200} value={action.wording} onChange={(event) => action.setWording(event.target.value)} disabled={action.busy} />
          </label>
        </div>
      ) : (
        <p>请先到企业微信管理后台配置“微信客服 → 升级服务 → 专员”，然后在<Link href="/integrations/wechat-work/customers">客户入口</Link>页刷新配置。</p>
      )}
      <div className={styles.confirmationActions}>
        <button className={styles.button} type="button" data-action-id="conversations.customer-upgrade.cancel" aria-label="取消长期客户升级" onClick={action.closePanel}>取消</button>
        <button
          className={styles.primaryButton}
          type="button"
          data-action-id="conversations.customer-upgrade.confirm"
          aria-label="确认向当前客户发送长期服务推荐"
          onClick={() => void action.confirm()}
          disabled={!action.allowed || !action.memberUserId || action.busy || !action.wording.trim()}
        >
          <UserRoundPlus size={15} aria-hidden="true" />{action.busy ? "正在提交" : "发送长期服务推荐"}
        </button>
      </div>
    </section>
  );
}

function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? `${fallback}：${message}` : fallback;
}
