"use client";

import Link from "next/link";
import { ExternalLink, UserRoundPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, WechatWorkCustomerUpgradeStatus } from "../../lib/api";
import {
  completeClientOperation,
  reserveClientOperation,
  type PendingClientOperation,
} from "../../lib/client-operation-key";
import type { ConversationsFeatureApi } from "./api";
import { conversationIdentity } from "./model";
import styles from "./conversation-pages.module.css";

const DEFAULT_WORDING = "您好，我是您的专属服务专员。确认添加企业微信后，我可以继续为您提供长期服务。";

type UpgradeMemberOption = {
  userId: string;
  displayName: string;
  resolution?: string;
  errorCode?: number | null;
};

type CustomerContactReadiness = {
  configured: boolean;
  ready: boolean;
  credentialSource?: "external_contact_override" | "wechat_work_shared" | "none";
  applications?: Array<{ agentId: number; name: string }>;
  eligibleMemberUserIds: string[];
  blockerCode?: string | null;
  errcode?: number | null;
  detail: string;
  callback?: {
    locallyReady: boolean;
    url: string | null;
    detail: string;
  };
};

export function useCustomerUpgradeAction(input: {
  api: ConversationsFeatureApi;
  conversation: Conversation;
  allowed: boolean;
  canManageChannels?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memberUserIds, setMemberUserIds] = useState<string[]>([]);
  const [memberOptions, setMemberOptions] = useState<UpgradeMemberOption[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [wording, setWording] = useState(DEFAULT_WORDING);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [customerContact, setCustomerContact] = useState<CustomerContactReadiness | null>(null);
  const [customerContactSecret, setCustomerContactSecret] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [upgradeStatus, setUpgradeStatus] = useState<WechatWorkCustomerUpgradeStatus | null>(null);
  const pendingOperation = useRef<PendingClientOperation | null>(null);

  useEffect(() => {
    setOpen(false);
    setMemberUserIds([]);
    setMemberOptions([]);
    setMemberUserId("");
    setWording(DEFAULT_WORDING);
    setError("");
    setNotice("");
    setSubmitted(false);
    setCustomerContact(null);
    setCustomerContactSecret("");
    setCredentialBusy(false);
    setUpgradeStatus(null);
    pendingOperation.current = null;
  }, [input.conversation.id]);

  useEffect(() => {
    if (!open || !memberUserId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await input.api.getWechatWorkCustomerUpgradeStatus(
          conversationIdentity(input.conversation),
          memberUserId,
        );
        if (cancelled) return;
        setUpgradeStatus(status);
        const locked = status.exists
          && !["not_started", "resource_failed"].includes(status.status)
          && !status.qrRecoveryAvailable
          && !customerUpgradeSupportsManualResend(status);
        setSubmitted(locked);
        if (status.exists && status.detail) setNotice(status.detail);
      } catch {
        // The primary action surfaces API errors; polling is best-effort and must not interrupt the conversation.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [input.api, input.conversation, memberUserId, open]);

  const openPanel = useCallback(async () => {
    setOpen(true);
    setError("");
    setNotice("");
    setCustomerContact(null);
    if (!input.allowed) {
      setError("当前操作员没有企业微信发送审批权限，不能提交升级服务提示。");
      return;
    }
    setBusy(true);
    try {
      const config = await input.api.getWechatWorkUpgradeServiceConfig();
      const options = normalizeUpgradeMemberOptions(config.memberUserIds, config.memberOptions);
      setMemberUserIds(config.memberUserIds);
      setMemberOptions(options);
      setCustomerContact(config.customerContact || {
        configured: false,
        ready: false,
        eligibleMemberUserIds: [],
        detail: "尚未配置企业微信客户联系权限。",
      });
      setMemberUserId((current) =>
        options.some((option) => option.userId === current) ? current : options[0]?.userId || "",
      );
      if (!config.ready) setError("企业微信还没有配置升级服务专员，请先完成配置。 ");
    } catch (loadError) {
      setError(errorMessage(loadError, "升级服务配置读取失败"));
    } finally {
      setBusy(false);
    }
  }, [input.allowed, input.api]);

  const saveCustomerContactCredential = useCallback(async () => {
    const secret = customerContactSecret.trim();
    if (!secret || credentialBusy) return;
    setCredentialBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await input.api.saveWechatWorkCustomerContactCredential(secret);
      const config = await input.api.getWechatWorkUpgradeServiceConfig();
      setCustomerContact(config.customerContact || null);
      setCustomerContactSecret("");
      setNotice(result.detail);
    } catch (saveError) {
      setError(errorMessage(saveError, "客户联系 Secret 配置失败"));
    } finally {
      setCredentialBusy(false);
    }
  }, [credentialBusy, customerContactSecret, input.api]);

  const selectMemberUserId = useCallback((nextMemberUserId: string) => {
    setMemberUserId(nextMemberUserId);
    setUpgradeStatus(null);
    setSubmitted(false);
    setError("");
    setNotice("");
    pendingOperation.current = null;
  }, []);

  const confirm = useCallback(async () => {
    if (!input.allowed || !memberUserId || busy || (submitted && !customerUpgradeSupportsManualResend(upgradeStatus))) return;
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
      let currentStatus = upgradeStatus?.memberUserId === memberUserId ? upgradeStatus : null;
      if (!currentStatus) {
        currentStatus = await input.api.getWechatWorkCustomerUpgradeStatus(identity, memberUserId);
        setUpgradeStatus(currentStatus);
      }
      if (
        !customerUpgradeSupportsManualResend(currentStatus)
        && !customerContact?.eligibleMemberUserIds.includes(memberUserId)
      ) {
        setError(customerContact?.detail || "请先配置企业微信客户联系权限，再发送专员二维码。");
        return;
      }
      if (customerUpgradeSupportsManualResend(currentStatus)) {
        const result = await input.api.resendWechatWorkCustomerUpgradeQr(
          identity,
          memberUserId,
          wording,
          operation.key,
        );
        pendingOperation.current = completeClientOperation(pendingOperation.current, operation.key);
        setSubmitted(false);
        const refreshed = await input.api.getWechatWorkCustomerUpgradeStatus(identity, memberUserId)
          .catch(() => null);
        if (refreshed) setUpgradeStatus(refreshed);
        const taskEvidence = result.sendTaskId ? ` 发送任务：${result.sendTaskId}。` : "";
        setNotice(`${result.deliveryNote || "本次人工发送已提交。"}${taskEvidence}`.trim());
        return;
      }
      if (currentStatus?.qrRecoveryAvailable) {
        const recovery = await input.api.retryWechatWorkCustomerUpgradeQr(identity, memberUserId);
        setUpgradeStatus(recovery.status);
        setSubmitted(
          !recovery.status.qrRecoveryAvailable
          && recovery.status.status !== "resource_failed"
          && !customerUpgradeSupportsManualResend(recovery.status),
        );
        setNotice(recovery.recovered
          ? "已接续发送现有专员二维码；企业微信接口已受理，客户手机实际显示仍需客户侧确认。"
          : recovery.status.detail || "二维码发送仍在处理中，系统不会重复提交。");
        return;
      }
      const result = await input.api.upgradeWechatWorkCustomerService(
        identity,
        memberUserId,
        wording,
        operation.key,
      );
      pendingOperation.current = completeClientOperation(pendingOperation.current, operation.key);
      const refreshed = await input.api.getWechatWorkCustomerUpgradeStatus(identity, memberUserId)
        .catch(() => null);
      if (refreshed) setUpgradeStatus(refreshed);
      setSubmitted(Boolean(result.recommendationPending || (result.deliveryPending && !refreshed)));
      const deliveryNote = result.deliveryNote || "";
      if (result.recommendationPending) {
        setNotice(`相同客户和专员的升级服务提示正在提交中${formatRecommendedAt(result.recommendedAt)}，系统不会重复调用。${deliveryNote}`);
      } else if (result.deliveryPending) {
        setNotice(`专员二维码正在通过企业微信客服发送，系统不会重复提交。${deliveryNote}`);
      } else {
        const taskEvidence = result.sendTaskId ? ` 发送任务：${result.sendTaskId}。` : "";
        setNotice(`${deliveryNote}${taskEvidence}`.trim());
      }
    } catch (submitError) {
      if (pendingOperation.current) {
        pendingOperation.current = completeClientOperation(pendingOperation.current, pendingOperation.current.key);
      }
      setSubmitted(false);
      setError(errorMessage(submitError, "长期服务专员二维码发送失败"));
    } finally {
      setBusy(false);
    }
  }, [busy, customerContact, input, memberUserId, submitted, upgradeStatus, wording]);

  return {
    open,
    busy,
    memberUserIds,
    memberOptions,
    memberUserId,
    wording,
    error,
    notice,
    submitted,
    customerContact,
    customerContactSecret,
    credentialBusy,
    upgradeStatus,
    allowed: input.allowed,
    canManageChannels: Boolean(input.canManageChannels),
    openPanel,
    closePanel: () => setOpen(false),
    setMemberUserId: selectMemberUserId,
    setWording,
    setCustomerContactSecret,
    saveCustomerContactCredential,
    confirm,
  };
}

export type CustomerUpgradeAction = ReturnType<typeof useCustomerUpgradeAction>;

export function CustomerUpgradeActionCard(input: {
  api: ConversationsFeatureApi;
  conversation: Conversation;
  allowed: boolean;
  canManageChannels?: boolean;
}) {
  const action = useCustomerUpgradeAction(input);
  return (
    <>
      {!action.open ? (
        <section className={styles.upgradeEntryBar} aria-label="长期客户服务">
          <div><strong>需要长期跟进这个客户？</strong><span>生成专员“联系我”二维码，并通过企业微信客服直接发送给当前客户。</span></div>
          <button
            className={styles.primaryButton}
            type="button"
            data-action-id="conversations.customer-upgrade.open"
            onClick={() => void action.openPanel()}
            disabled={!action.allowed}
          >
            <UserRoundPlus size={15} aria-hidden="true" />发送专员二维码
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
          <strong id="long-term-customer-title"><UserRoundPlus size={17} aria-hidden="true" /> 发送长期服务专员二维码</strong>
          <p>系统会提交升级服务提示、生成专员真实“联系我”二维码并通过当前客服会话发送；接口受理后仍需客户侧确认手机实际显示。</p>
        </div>
        <button className={styles.button} type="button" data-action-id="conversations.customer-upgrade.close" onClick={action.closePanel} aria-label="关闭长期客户升级"><X size={15} aria-hidden="true" /></button>
      </div>
      {action.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{action.error}</div> : null}
      {action.notice && !action.error ? <div className={`${styles.notice} ${upgradeStatusIsFailure(action.upgradeStatus) ? styles.noticeError : styles.noticeSuccess}`} role="status">{action.notice}</div> : null}
      {action.customerContact && !action.customerContact.ready && action.canManageChannels && action.customerContact.credentialSource === "wechat_work_shared" ? (
        <div className={styles.upgradeCredentialSetup}>
          <div>
            <strong>给同一个自建应用开通客户联系 API</strong>
            <span>{action.customerContact.detail}</span>
          </div>
          <a
            className={styles.button}
            href="https://work.weixin.qq.com/wework_admin/frame"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} aria-hidden="true" /> 打开企业微信后台
          </a>
        </div>
      ) : action.customerContact && !action.customerContact.ready && action.canManageChannels ? (
        <div className={styles.upgradeCredentialSetup}>
          <div>
            <strong>先创建自建应用，再授权两个 API</strong>
            <span>{action.customerContact?.detail || "先到“应用管理 → 应用 → 自建”创建或打开一个自建应用并查看 Secret；再把同一个应用分别加入“应用管理 → 微信客服 → API → 可调用接口的应用”和“客户联系 → 客户 → API → 可调用接口的应用”。"}</span>
          </div>
          <label className={styles.upgradeSecretField}>
            <span>上述自建应用的 Secret</span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="粘贴自建应用详情页里的 Secret"
              value={action.customerContactSecret}
              onChange={(event) => action.setCustomerContactSecret(event.target.value)}
              disabled={action.credentialBusy}
            />
          </label>
          <button
            className={styles.button}
            type="button"
            data-action-id="conversations.customer-upgrade.save-customer-contact-secret"
            onClick={() => void action.saveCustomerContactCredential()}
            disabled={action.credentialBusy || !action.customerContactSecret.trim()}
          >
            {action.credentialBusy ? "正在验证" : "验证并保存"}
          </button>
        </div>
      ) : action.customerContact && !action.customerContact.ready ? (
        <div className={styles.upgradeCredentialSetup}>
          <div>
            <strong>客户联系权限尚未配置</strong>
            <span>{action.customerContact?.detail || "需要具备渠道管理权限的管理员完成一次性配置。"}</span>
          </div>
        </div>
      ) : null}
      {action.customerContact?.ready && action.customerContact.callback ? (
        <div className={styles.upgradeCredentialSetup}>
          <div>
            <strong>客户添加回执</strong>
            <span>{action.customerContact.callback.detail}</span>
          </div>
        </div>
      ) : null}
      {action.memberOptions.length ? (
        <div className={styles.upgradeForm}>
          <label className={styles.upgradeField}>
            <span>长期服务专员</span>
            <select value={action.memberUserId} onChange={(event) => action.setMemberUserId(event.target.value)} disabled={action.busy}>
              {action.memberOptions.map((option) => (
                <option key={option.userId} value={option.userId}>{formatUpgradeMemberLabel(option)}</option>
              ))}
            </select>
          </label>
          <label className={styles.upgradeField}>
            <span>给客户的长期服务说明</span>
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
          aria-label="确认发送企业微信长期服务专员二维码"
          onClick={() => void action.confirm()}
          disabled={
            !action.allowed
            || !action.memberUserId
            || action.busy
            || (action.submitted && !customerUpgradeSupportsManualResend(action.upgradeStatus))
            || !action.wording.trim()
            || (
              !customerUpgradeSupportsManualResend(action.upgradeStatus)
              && !action.customerContact?.eligibleMemberUserIds.includes(action.memberUserId)
            )
          }
        >
          <UserRoundPlus size={15} aria-hidden="true" />{upgradeButtonLabel(action)}
        </button>
      </div>
    </section>
  );
}

function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? `${fallback}：${message}` : fallback;
}

function normalizeUpgradeMemberOptions(
  memberUserIds: string[],
  memberOptions: UpgradeMemberOption[] | undefined,
) {
  const optionsByUserId = new Map(
    (Array.isArray(memberOptions) ? memberOptions : [])
      .filter((option) => option?.userId)
      .map((option) => [option.userId, option] as const),
  );
  return memberUserIds.map((userId) => optionsByUserId.get(userId) || {
    userId,
    displayName: userId,
    resolution: "userid_fallback",
  });
}

function formatUpgradeMemberLabel(option: UpgradeMemberOption) {
  const displayName = String(option.displayName || "").trim();
  if (displayName && displayName !== option.userId) return `${displayName}（${option.userId}）`;
  return option.userId;
}

function formatRecommendedAt(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `（${date.toLocaleString("zh-CN", { hour12: false })}）`;
}

function upgradeStatusIsFailure(status: WechatWorkCustomerUpgradeStatus | null) {
  return ["partial", "async_failed", "identity_unverified", "failed", "resource_failed"].includes(String(status?.status || ""));
}

function customerUpgradeSupportsManualResend(status: WechatWorkCustomerUpgradeStatus | null) {
  return Boolean(status?.exists && status.manualResendAvailable);
}

function upgradeButtonLabel(action: CustomerUpgradeAction) {
  if (action.busy) return "正在发送";
  const status = String(action.upgradeStatus?.status || "");
  if (customerUpgradeSupportsManualResend(action.upgradeStatus)) return "再次发送二维码";
  if (status === "added_confirmed") return "客户已添加专员";
  if (status === "half_added_pending") return "等待专员确认添加";
  if (status === "identity_unverified") return "联系人身份待核验";
  if (status === "api_accepted") return "企微接口已受理";
  if (status === "partial") return "部分受理待处理";
  if (status === "async_failed") return "异步回执失败";
  if (status === "failed") return "发送失败待处理";
  if (status === "ready" && action.upgradeStatus?.qrRecoveryAvailable) return "继续发送现有二维码";
  if (["creating", "remote_created", "ready", "queued", "sending"].includes(status)) return "升级处理中";
  return "发送专员二维码";
}
