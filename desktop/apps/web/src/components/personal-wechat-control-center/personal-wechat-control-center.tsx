"use client";

import {
  AudioLines,
  ChevronRight,
  CirclePause,
  Hand,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AccountFleetPane } from "./account-fleet-pane";
import { AccountInspectorPane } from "./account-inspector-pane";
import type {
  PersonalWechatControlCenterProps,
  PersonalWechatGlobalSendMode,
  PersonalWechatVoicePolicy,
} from "./types";
import styles from "./personal-wechat-control-center.module.css";

const SEND_MODE_COPY: Record<PersonalWechatGlobalSendMode, { label: string; detail: string }> = {
  disabled: { label: "全局发送已禁用", detail: "仅观察与整理队列，不会发出消息" },
  approval_only: { label: "逐条审批后发送", detail: "每条回复都必须经过人工确认" },
  operator_assisted: { label: "人工接管时发送", detail: "仅当前接管账号可由操作员发送" },
};

const VOICE_POLICY_COPY: Record<PersonalWechatVoicePolicy, { label: string; detail: string }> = {
  disabled: { label: "语音回复已禁用", detail: "不采集、不生成也不发送语音" },
  human_recording: { label: "仅使用真实录音", detail: "由操作员本人录制并确认后发送" },
  ai_disclosed: { label: "AI 语音需明确标注", detail: "禁止冒充真人或仿冒特定个人声纹" },
};

export function PersonalWechatControlCenter({
  accounts,
  approvals,
  selectedAccountId,
  globalSendMode = "disabled",
  voicePolicy = "disabled",
  updatedAtLabel,
  busy = false,
  readOnly = false,
  actions,
  className,
}: PersonalWechatControlCenterProps) {
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || null;
  const onlineCount = accounts.filter((account) => account.state === "online").length;
  const isolatedCount = accounts.filter((account) => account.state === "isolated").length;
  const manualCount = accounts.filter((account) => account.state === "manual").length;
  const sendModeCopy = SEND_MODE_COPY[globalSendMode];
  const voicePolicyCopy = VOICE_POLICY_COPY[voicePolicy];

  return (
    <section
      className={`${styles.controlCenter} ${className || ""}`}
      id="personal-wechat-control-center"
      aria-labelledby="personal-wechat-control-title"
      aria-busy={busy}
    >
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.titleIcon}><Users size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="personal-wechat-control-title">个人微信多账号控制台</h2>
            <p>一个账号对应一个受核验的 Windows 会话与微信窗口</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          {updatedAtLabel ? <span>更新于 {updatedAtLabel}</span> : null}
          <button
            type="button"
            data-action-id="integrations.personal-wechat.control.refresh"
            aria-label="刷新个人微信账号控制状态"
            onClick={actions.onRefresh}
            disabled={busy}
          >
            <RefreshCw size={15} aria-hidden="true" />刷新状态
          </button>
        </div>
      </header>

      <dl className={styles.summary} aria-label="个人微信实例概况">
        <div><dt>账号总数</dt><dd>{accounts.length}</dd></div>
        <div className={styles.online}><dt>在线</dt><dd>{onlineCount}</dd></div>
        <div className={styles.manual}><dt>人工接管</dt><dd>{manualCount}</dd></div>
        <div className={styles.isolated}><dt>隔离</dt><dd>{isolatedCount}</dd></div>
        <div className={styles.approval}><dt>待审批</dt><dd>{approvals.length}</dd></div>
      </dl>

      <section className={styles.policyBar} aria-labelledby="personal-wechat-send-policy-title">
        <div className={styles.policyCopy}>
          <span className={`${styles.policyIcon} ${globalSendMode === "disabled" ? styles.paused : ""}`}>
            {globalSendMode === "disabled" ? <CirclePause size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
          </span>
          <div>
            <strong id="personal-wechat-send-policy-title">{sendModeCopy.label}</strong>
            <span>{sendModeCopy.detail}</span>
          </div>
        </div>
        <label className={styles.modeField}>
          <span>全局发送模式</span>
          <select
            aria-label="个人微信全局发送模式"
            value={globalSendMode}
            onChange={(event) => actions.onGlobalSendModeChange(event.target.value as PersonalWechatGlobalSendMode)}
            disabled={busy || readOnly}
          >
            <option value="disabled">禁用发送（默认）</option>
            <option value="approval_only">逐条人工审批</option>
            <option value="operator_assisted">仅人工接管</option>
          </select>
        </label>
        <button
          type="button"
          className={styles.policyLink}
          data-action-id="integrations.personal-wechat.control.open-safety-policy"
          aria-label="打开个人微信发送安全治理页"
          onClick={actions.onOpenSafetyPolicy}
          disabled={!actions.onOpenSafetyPolicy}
        >
          查看安全边界<ChevronRight size={14} aria-hidden="true" />
        </button>
      </section>

      <div className={styles.workspace}>
        <AccountFleetPane
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          busy={busy}
          onSelectAccount={actions.onSelectAccount}
        />
        <AccountInspectorPane
          account={selectedAccount}
          busy={busy || readOnly}
          onRequestManualTakeover={actions.onRequestManualTakeover}
          onReleaseManualTakeover={actions.onReleaseManualTakeover}
          onIsolateAccount={actions.onIsolateAccount}
          onRequestReleaseIsolation={actions.onRequestReleaseIsolation}
        />
      </div>

      <div className={styles.lowerGrid}>
        <section className={styles.approvalPane} aria-labelledby="personal-wechat-approval-title">
          <div className={styles.panelHeading}>
            <div>
              <h3 id="personal-wechat-approval-title">待审批回复</h3>
              <span>仅展示调用方提供的真实队列</span>
            </div>
            <b>{approvals.length}</b>
          </div>
          {approvals.length ? (
            <div className={styles.approvalList}>
              {approvals.map((approval) => (
                <button
                  type="button"
                  key={approval.id}
                  data-action-id={`integrations.personal-wechat.control.open-approval.${approval.id}`}
                  aria-label={`打开个人微信发送审批 ${approval.id}`}
                  onClick={() => actions.onOpenApproval(approval.id)}
                  disabled={busy}
                >
                  <span>
                    <strong>{approval.customerLabel}</strong>
                    <small>{approval.summary}</small>
                  </span>
                  <span className={styles.approvalMeta}>
                    {approval.priorityLabel ? <b>{approval.priorityLabel}</b> : null}
                    <small>{approval.requestedAtLabel}</small>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.inlineEmpty}>当前没有等待人工审核的回复。</div>
          )}
        </section>

        <aside className={styles.voicePane} aria-labelledby="personal-wechat-voice-title">
          <span className={styles.voiceIcon}><AudioLines size={18} aria-hidden="true" /></span>
          <div>
            <h3 id="personal-wechat-voice-title">语音回复边界</h3>
            <strong>{voicePolicyCopy.label}</strong>
            <p>{voicePolicyCopy.detail}</p>
          </div>
          <div className={styles.voiceRules}>
            <span><ShieldCheck size={13} aria-hidden="true" />发送前由人工试听确认</span>
            <span><Hand size={13} aria-hidden="true" />不模拟真人节奏规避平台治理</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
