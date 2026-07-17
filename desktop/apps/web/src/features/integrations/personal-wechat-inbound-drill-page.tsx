"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { useState } from "react";
import {
  getPersonalWechatRpaRegistry,
  identityExpectation,
  testWechatChannelInbound,
} from "../../lib/api";
import { FeatureNotice, FeaturePage, errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function PersonalWechatInboundDrillPage() {
  const registry = useAsyncResource(getPersonalWechatRpaRegistry, "个人微信实例读取失败");
  const [wechatAccountId, setWechatAccountId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const busy = registry.busy || submitting;
  const ready = Boolean(
    wechatAccountId.trim() && conversationId.trim() && customerId.trim() && text.trim() && confirmed,
  );

  async function runInboundDrill() {
    if (!ready || busy) return;
    const identity = {
      wechatAccountId: wechatAccountId.trim(),
      conversationId: conversationId.trim(),
      customerId: customerId.trim(),
    };
    setSubmitting(true);
    setError("");
    setFeedback("");
    try {
      await testWechatChannelInbound("personal_wechat", {
        ...identity,
        ...identityExpectation(identity),
        text: text.trim(),
      });
      setConfirmed(false);
      setFeedback("受控入站演练已提交；请到对应会话核对真实记录与身份绑定。");
    } catch (submitError) {
      setError(errorMessage(submitError, "个人微信入站演练失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FeaturePage
      id="personal-wechat-inbound-drill-page"
      title="个人微信入站演练"
      description="只提交带完整账号、会话和客户身份的受控入站记录，不执行窗口采集。"
      icon={<Inbox size={20} />}
      busy={busy}
      actions={(
        <Link className={styles.actionLink} href="/integrations/personal-wechat/window-inbound" aria-label="返回个人微信窗口证据页面">
          返回窗口证据
        </Link>
      )}
    >
      {registry.error ? <FeatureNotice tone="error" title="个人微信实例读取失败">{registry.error}</FeatureNotice> : null}
      {error ? <FeatureNotice tone="error" title="入站演练未完成">{error}</FeatureNotice> : null}
      {feedback ? <FeatureNotice tone="success" title="入站演练已提交">{feedback}</FeatureNotice> : null}
      <FeatureNotice tone="warning" title="此操作会写入真实演练记录">
        页面不会预填客户身份，也不会把测试结果冒充为正式通道验收。
      </FeatureNotice>
      <section className={styles.panel} aria-labelledby="personal-wechat-inbound-form-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="personal-wechat-inbound-form-title">演练身份</h2>
            <p>全部身份字段必须由操作员核对后填写。</p>
          </div>
        </header>
        <div className={styles.formGrid}>
          <label className={styles.field} htmlFor="inbound-drill-account">
            <span>个人微信账号 ID</span>
            <input
              id="inbound-drill-account"
              list="personal-wechat-account-options"
              value={wechatAccountId}
              onChange={(event) => setWechatAccountId(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <datalist id="personal-wechat-account-options">
              {registry.data?.instances.map((instance) => (
                <option value={instance.wechatAccountId} key={instance.wechatAccountId}>{instance.accountNickname}</option>
              ))}
            </datalist>
          </label>
          <label className={styles.field} htmlFor="inbound-drill-conversation">
            <span>会话 ID</span>
            <input id="inbound-drill-conversation" value={conversationId} onChange={(event) => setConversationId(event.target.value)} autoComplete="off" disabled={busy} />
          </label>
          <label className={styles.field} htmlFor="inbound-drill-customer">
            <span>客户 ID</span>
            <input id="inbound-drill-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} autoComplete="off" disabled={busy} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="inbound-drill-text">
            <span>演练消息内容</span>
            <textarea id="inbound-drill-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} disabled={busy} />
          </label>
          <label className={styles.checkboxField} htmlFor="inbound-drill-confirm">
            <input id="inbound-drill-confirm" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
            <span>我已核对账号、会话和客户身份<small>确认后才允许写入受控演练记录。</small></span>
          </label>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="integrations.personal-wechat.inbound-drill.submit"
            aria-label="提交已确认身份的个人微信入站演练"
            onClick={() => void runInboundDrill()}
            disabled={!ready || busy}
          >
            <Inbox size={15} aria-hidden="true" /> {submitting ? "提交中" : "提交入站演练"}
          </button>
        </div>
      </section>
    </FeaturePage>
  );
}
