import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleX,
  MoreHorizontal,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import type { FormEvent } from "react";
import styles from "./conversation-thread-pane.module.css";
import type {
  ConversationWorkbenchActions,
  ConversationWorkbenchIncident,
  ConversationWorkbenchMessage,
  ConversationWorkbenchThread,
} from "./types";
import { ComposerToolIcon, WorkbenchAvatar, WorkbenchToneTag } from "./workbench-primitives";

type ConversationThreadPaneProps = {
  thread: ConversationWorkbenchThread | null;
  actions: ConversationWorkbenchActions;
  showBackButton?: boolean;
  showContextButton?: boolean;
  showTransferButton?: boolean;
};

export function ConversationThreadPane({
  thread,
  actions,
  showBackButton = true,
  showContextButton = true,
  showTransferButton = true,
}: ConversationThreadPaneProps) {
  if (!thread) {
    return (
      <section className={styles.threadPane} aria-label="会话详情">
        <div className={styles.threadEmpty} role="status">
          <Sparkles size={25} aria-hidden="true" />
          <strong>请选择客户会话</strong>
          <span>从会话列表选择客户后，这里会显示真实消息和人工回复工具。</span>
          <button
            type="button"
            data-action-id="conversations.inbox.open-empty"
            onClick={() => actions.onPaneChange("inbox")}
            aria-label="打开会话列表"
          >打开会话列表</button>
        </div>
      </section>
    );
  }

  const composer = thread.composer;
  const composerDisabled = Boolean(composer.disabled || composer.sending);
  const composerDisabledReason = composer.sending
    ? "人工回复正在安全入队，请稍候"
    : composer.disabled
      ? composer.placeholder || "当前会话暂不可人工回复"
      : undefined;
  const replyEmpty = !composer.value.trim();
  const sendDisabled = composerDisabled || replyEmpty;
  const sendDisabledReason = composerDisabledReason || (replyEmpty ? "请先输入人工回复内容" : undefined);
  const activeSuggestionTab = thread.suggestion.tabs.find((tab) => tab.value === thread.suggestion.activeTab)
    || thread.suggestion.tabs[0];

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composerDisabled && composer.value.trim()) actions.onSendReply();
  }

  return (
    <section className={styles.threadPane} aria-label={`与 ${thread.participant.name} 的会话`}>
      <header className={styles.threadHeader}>
        {showBackButton ? <button type="button" className={`${styles.iconButton} ${styles.mobileOnly}`} data-action-id="conversations.inbox.open-mobile" onClick={() => actions.onPaneChange("inbox")} aria-label="返回会话列表">
          <ArrowLeft size={17} aria-hidden="true" />
        </button> : null}
        <WorkbenchAvatar avatar={thread.participant.avatar} size="large" />
        <div className={styles.participantCopy}>
          <div>
            <h2>{thread.participant.name}</h2>
            <WorkbenchToneTag className={styles.channelTag} tone={thread.participant.channelTone}>{thread.participant.channelLabel}</WorkbenchToneTag>
          </div>
          <span>账号：{thread.participant.accountLabel}</span>
          {thread.participant.onlineLabel ? (
            <span className={thread.participant.online ? styles.onlineState : styles.offlineState}>
              <i aria-hidden="true" />{thread.participant.onlineLabel}
            </span>
          ) : null}
        </div>
        <div className={styles.threadHeaderActions}>
          {thread.manualTakeoverLabel ? <WorkbenchToneTag className={styles.headerStatus} tone="brand">{thread.manualTakeoverLabel}</WorkbenchToneTag> : null}
          <WorkbenchToneTag className={styles.headerStatus} tone={thread.serviceStatusTone}>{thread.serviceStatusLabel}</WorkbenchToneTag>
          {showTransferButton ? <button type="button" className={styles.headerButton} data-action-id="conversations.assignment.open-transfer" onClick={actions.onTransfer} aria-label="转接当前会话">
            <UserRoundCheck size={14} aria-hidden="true" />转接
          </button> : null}
          {actions.onEndConversation ? (
            <button type="button" className={styles.headerButton} data-action-id="conversations.thread.end" onClick={actions.onEndConversation} aria-label="结束当前会话">
              <CircleX size={14} aria-hidden="true" />结束会话
            </button>
          ) : null}
          {actions.onMore ? (
            <button type="button" className={styles.iconButton} data-action-id="conversations.thread.open-more" onClick={actions.onMore} aria-label="更多会话操作">
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          ) : null}
          {showContextButton ? <button type="button" className={`${styles.iconButton} ${styles.contextButton}`} data-action-id="conversations.context.open" onClick={() => actions.onPaneChange("context")} aria-label="打开客户资料">
            <PanelRightOpen size={16} aria-hidden="true" />
          </button> : null}
        </div>
      </header>

      {thread.safetyNotice ? (
        <div className={styles.safetyNotice} role="note">
          <ShieldCheck size={14} aria-hidden="true" />{thread.safetyNotice}
        </div>
      ) : null}

      <section className={styles.timeline} aria-label="会话消息时间线" aria-busy={thread.loading || undefined}>
        <div className={styles.timelineBar}>
          <span>{thread.timelineLabel || "会话记录"}</span>
          <button
            type="button"
            data-action-id="conversations.timeline.refresh"
            data-disabled-reason={thread.loading ? "正在读取消息记录，请稍候" : undefined}
            onClick={actions.onRefresh}
            disabled={thread.loading}
            aria-label="刷新会话消息记录"
          >
            <RefreshCw size={14} aria-hidden="true" />刷新
          </button>
        </div>
        {thread.error ? <div className={styles.threadError} role="alert">{thread.error}</div> : null}
        {thread.loading ? <div className={styles.threadLoading} role="status">正在读取消息记录…</div> : null}
        {!thread.loading && !thread.error && !thread.messages.length ? (
          <div className={styles.threadEmptyCompact} role="status">
            <strong>{thread.emptyTitle || "还没有消息"}</strong>
            <span>{thread.emptyDetail || "客户发送消息后，会显示在这里。"}</span>
          </div>
        ) : null}
        {!thread.loading && !thread.error ? thread.messages.map((message) => <TimelineMessage message={message} key={message.id} />) : null}

        {thread.incidents.map((incident) => (
          <IncidentCard incident={incident} actions={actions} key={incident.id} />
        ))}
        {thread.notices.map((notice) => (
          <div className={`${styles.threadNotice} ${styles[`notice-${notice.tone}`]}`} role={notice.tone === "danger" ? "alert" : "status"} key={notice.id}>
            <AlertTriangle size={15} aria-hidden="true" />
            <span><strong>{notice.text}</strong>{notice.detail ? <small>{notice.detail}</small> : null}</span>
            {notice.dismissible && actions.onDismissNotice ? (
              <button type="button" data-action-id={`conversations.notice-${notice.id}.dismiss`} onClick={() => actions.onDismissNotice?.(notice.id)} aria-label="关闭提示">
                <CircleX size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
      </section>

      <section className={styles.assistantComposer} aria-label="AI 建议与人工回复">
        <div className={styles.suggestionTabs} role="status" aria-label="当前回复辅助视图">
          <span className={styles.activeSuggestionTab}>{activeSuggestionTab?.label || "AI 回复建议"}</span>
        </div>

        <div className={styles.assistantGrid}>
          <div className={styles.suggestionPanel}>
            <div className={styles.subpanelHeader}>
              <strong>{thread.suggestion.title}</strong>
              {thread.suggestion.verificationLabel ? <span>{thread.suggestion.verificationLabel}</span> : null}
            </div>
            {thread.suggestion.loading ? <p className={styles.mutedCopy} role="status">正在生成建议回复…</p> : null}
            {thread.suggestion.error ? <p className={styles.inlineError} role="alert">{thread.suggestion.error}</p> : null}
            {!thread.suggestion.loading && !thread.suggestion.error && thread.suggestion.text ? (
              <p className={styles.suggestionText}>{thread.suggestion.text}</p>
            ) : null}
            {thread.suggestion.sourceDetail ? <small className={styles.sourceDetail}>{thread.suggestion.sourceDetail}</small> : null}
            <div className={styles.suggestionActions}>
              <button
                type="button"
                data-action-id="conversations.suggestion.use"
                data-disabled-reason={thread.suggestion.loading ? "正在生成回复建议，请稍候" : !thread.suggestion.text ? "尚无可用的回复建议" : undefined}
                onClick={actions.onUseSuggestion}
                disabled={!thread.suggestion.text || thread.suggestion.loading}
                aria-label={thread.suggestion.useActionLabel || "使用此回复建议"}
              >
                <Sparkles size={14} aria-hidden="true" />{thread.suggestion.useActionLabel || "使用此回复"}
              </button>
              <button
                type="button"
                data-action-id="conversations.suggestion.regenerate"
                data-disabled-reason={thread.suggestion.loading ? "回复建议正在生成，请稍候" : undefined}
                onClick={actions.onRegenerateSuggestion}
                disabled={thread.suggestion.loading}
                aria-label={thread.suggestion.regenerateActionLabel || "重新生成回复建议"}
              >
                <RotateCcw size={14} aria-hidden="true" />{thread.suggestion.regenerateActionLabel || "重新生成"}
              </button>
            </div>
          </div>

          <div className={styles.safetyPanel}>
            <div className={styles.subpanelHeader}>
              <strong>发送前安全体检</strong>
              <button type="button" data-action-id="conversations.safety.refresh" onClick={actions.onRefresh} aria-label="重新检测发送安全状态"><RefreshCw size={13} aria-hidden="true" />重新检测</button>
            </div>
            <ul>
              {thread.safetyChecks.map((check) => (
                <li className={styles[`text-${check.tone}`]} key={check.id}>
                  {check.tone === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                  <span>{check.label}</span><b>{check.statusLabel}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <form className={styles.composer} onSubmit={submitReply}>
          <textarea
            data-action-id="conversations.reply.edit"
            data-disabled-reason={composerDisabledReason}
            value={thread.composer.value}
            maxLength={thread.composer.maxLength}
            placeholder={thread.composer.placeholder || "输入人工回复"}
            aria-label="输入人工回复"
            disabled={composerDisabled}
            onChange={(event) => actions.onReplyChange(event.target.value)}
          />
          <div className={styles.composerToolbar}>
            <div className={styles.composerTools}>
              {actions.onComposerTool ? thread.composer.tools.map((tool) => (
                <button type="button" data-action-id={`conversations.composer-tool-${tool.id}.open`} onClick={() => actions.onComposerTool?.(tool.id)} aria-label={tool.label} title={tool.label} key={tool.id}>
                  <ComposerToolIcon tool={tool} />{tool.iconOnly ? null : <span>{tool.label}</span>}
                </button>
              )) : null}
            </div>
            <span className={styles.characterCount}>{thread.composer.value.length}/{thread.composer.maxLength}</span>
            <button
              type="submit"
              className={styles.sendButton}
              data-action-id="conversations.reply.enqueue"
              data-disabled-reason={sendDisabledReason}
              disabled={sendDisabled}
              aria-label="将人工回复提交到安全发送队列"
            >
              <Send size={15} aria-hidden="true" />{thread.composer.sending ? "发送中" : thread.composer.sendLabel || "发送"}<ChevronDown size={13} aria-hidden="true" />
            </button>
          </div>
          {thread.composer.feedback ? (
            <small className={`${styles.composerFeedback} ${styles[`text-${thread.composer.feedbackTone || "neutral"}`]}`} role="status">
              {thread.composer.feedback}
            </small>
          ) : null}
        </form>
      </section>
    </section>
  );
}

function TimelineMessage({ message }: { message: ConversationWorkbenchMessage }) {
  if (message.direction === "system") {
    return (
      <div className={styles.systemMessage} role="note">
        <ShieldCheck size={13} aria-hidden="true" /><span>{message.text}</span><time>{message.createdAtLabel}</time>
      </div>
    );
  }
  return (
    <article className={`${styles.messageRow} ${message.direction === "outbound" ? styles.outboundMessage : ""}`.trim()}>
      {message.avatar ? <WorkbenchAvatar avatar={message.avatar} size="small" /> : null}
      <div className={styles.messageBlock}>
        <div className={styles.messageBubble}>
          {message.senderName ? <strong>{message.senderName}</strong> : null}
          {message.text ? <p>{message.text}</p> : null}
          {message.attachments?.length ? (
            <div className={styles.attachmentList}>
              {message.attachments.map((attachment) => (
                <span key={attachment.id}>
                  {attachment.kind === "image" ? <Sparkles size={14} aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}
                  <b>{attachment.name}</b>{attachment.detail ? <small>{attachment.detail}</small> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span className={styles.messageMeta}>
          <time>{message.createdAtLabel}</time>
          {message.statusLabel ? <em className={styles[`text-${message.statusTone || "neutral"}`]}>{message.statusLabel}</em> : null}
        </span>
      </div>
    </article>
  );
}

function IncidentCard({ incident, actions }: { incident: ConversationWorkbenchIncident; actions: ConversationWorkbenchActions }) {
  return (
    <article className={`${styles.incidentCard} ${styles[`incident-${incident.tone}`]}`}>
      <AlertTriangle size={17} aria-hidden="true" />
      <div>
        <div className={styles.incidentHeader}>
          <strong>{incident.title}</strong>{incident.occurredAtLabel ? <time>{incident.occurredAtLabel}</time> : null}
        </div>
        <p>{incident.detail}</p>
        {incident.reason ? <small>原因：{incident.reason}</small> : null}
      </div>
      <div className={styles.incidentActions}>
        {incident.policyActionLabel && actions.onOpenIncidentPolicy ? <button type="button" data-action-id={`conversations.incident-${incident.id}.open-policy`} onClick={() => actions.onOpenIncidentPolicy?.(incident.id)} aria-label={`查看异常处理策略：${incident.title}`}>{incident.policyActionLabel}</button> : null}
        {incident.retryActionLabel && actions.onRetryIncident ? <button type="button" data-action-id={`conversations.incident-${incident.id}.retry`} data-disabled-reason={incident.retryDisabled ? "当前异常不允许重试" : undefined} onClick={() => actions.onRetryIncident?.(incident.id)} disabled={incident.retryDisabled} aria-label={`重试异常处理：${incident.title}`}>{incident.retryActionLabel}</button> : null}
      </div>
    </article>
  );
}
