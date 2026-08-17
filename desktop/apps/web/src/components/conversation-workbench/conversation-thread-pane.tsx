"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  CircleX,
  MoreHorizontal,
  Image as ImageIcon,
  Paperclip,
  PanelRightOpen,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./conversation-thread-pane.module.css";
import { ConversationAssistantComposer } from "./conversation-assistant-composer";
import { ConversationWorkflowRail } from "./conversation-workflow-rail";
import type {
  ConversationWorkbenchActions,
  ConversationWorkbenchAttachment,
  ConversationWorkbenchMessage,
  ConversationWorkbenchThread,
} from "./types";
import { WorkbenchAvatar, WorkbenchToneTag } from "./workbench-primitives";
import { IncidentCard } from "./conversation-thread-incident";

type ConversationThreadPaneProps = {
  thread: ConversationWorkbenchThread | null;
  actions: ConversationWorkbenchActions;
  showBackButton?: boolean;
  showContextButton?: boolean;
  showTransferButton?: boolean;
  variant?: "default" | "wecom";
};

export function ConversationThreadPane({
  thread,
  actions,
  showBackButton = true,
  showContextButton = true,
  showTransferButton = true,
  variant = "default",
}: ConversationThreadPaneProps) {
  const timelineRef = useRef<HTMLElement | null>(null);
  const stickToLatestRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const messageSnapshotRef = useRef({ participantKey: "", latestMessageId: "", messageCount: 0 });
  const participantKey = thread?.participant.name || "";
  const latestMessageId = thread?.messages.at(-1)?.id || "";
  const messageCount = thread?.messages.length || 0;

  useEffect(() => {
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    setNewMessageCount(0);
  }, [participantKey]);

  useEffect(() => {
    const timeline = timelineRef.current;
    const previous = messageSnapshotRef.current;
    const sameParticipant = previous.participantKey === participantKey;
    const addedMessages = sameParticipant && previous.latestMessageId && previous.latestMessageId !== latestMessageId
      ? Math.max(1, messageCount - previous.messageCount)
      : 0;
    messageSnapshotRef.current = { participantKey, latestMessageId, messageCount };
    if (!timeline) return;
    if (!stickToLatestRef.current) {
      if (addedMessages) {
        setNewMessageCount((current) => current + addedMessages);
        setShowJumpToLatest(true);
      }
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
      setShowJumpToLatest(false);
      setNewMessageCount(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageId, messageCount, participantKey]);

  if (!thread) {
    return (
      <section className={styles.threadPane} data-variant={variant} aria-label="会话详情">
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

  function scrollToLatest() {
    const timeline = timelineRef.current;
    if (!timeline) return;
    stickToLatestRef.current = true;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
    setShowJumpToLatest(false);
    setNewMessageCount(0);
  }

  return (
    <section className={styles.threadPane} data-variant={variant} aria-label={`与 ${thread.participant.name} 的会话`}>
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

      {variant === "default" && thread.safetyNotice ? (
        <div className={styles.safetyNotice} role="note">
          <ShieldCheck size={14} aria-hidden="true" />{thread.safetyNotice}
        </div>
      ) : null}
      {thread.workflowActions?.length ? <ConversationWorkflowRail actions={thread.workflowActions} /> : null}

      <section
        ref={timelineRef}
        className={styles.timeline}
        aria-label="会话消息时间线"
        aria-busy={thread.loading || undefined}
        onScroll={(event) => {
          const target = event.currentTarget;
          const nearLatest = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
          stickToLatestRef.current = nearLatest;
          setShowJumpToLatest(!nearLatest);
          if (nearLatest) setNewMessageCount(0);
        }}
      >
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
        {thread.loading && !thread.messages.length ? <div className={styles.threadLoading} role="status">正在读取消息记录…</div> : null}
        {!thread.loading && !thread.error && !thread.messages.length ? (
          <div className={styles.threadEmptyCompact} role="status">
            <strong>{thread.emptyTitle || "还没有消息"}</strong>
            <span>{thread.emptyDetail || "客户发送消息后，会显示在这里。"}</span>
          </div>
        ) : null}
        {thread.messages.map((message) => <TimelineMessage message={message} key={message.id} />)}

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
        {showJumpToLatest ? (
          <button
            type="button"
            className={styles.jumpToLatest}
            data-action-id="conversations.timeline.jump-latest"
            onClick={scrollToLatest}
            aria-label="回到最新消息"
          >
            <ChevronDown size={15} aria-hidden="true" />
            {newMessageCount ? `${newMessageCount} 条新消息` : "回到最新"}
          </button>
        ) : null}
      </section>

      <ConversationAssistantComposer thread={thread} actions={actions} variant={variant} />
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
              {message.attachments.map((attachment) => <TimelineAttachment attachment={attachment} key={attachment.id} />)}
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

function TimelineAttachment({ attachment }: { attachment: ConversationWorkbenchAttachment }) {
  if (attachment.previewUrl) {
    return (
      <a className={styles.imageAttachment} href={attachment.href || attachment.previewUrl} target="_blank" rel="noreferrer" aria-label={`查看图片 ${attachment.name}`}>
        <img src={attachment.previewUrl} alt={attachment.name} loading="lazy" />
        <span><b>{attachment.name}</b>{attachment.detail ? <small>{attachment.detail}</small> : null}</span>
      </a>
    );
  }
  const content = (
    <>
      {attachment.kind === "image" ? <ImageIcon size={14} aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
      <span><b>{attachment.name}</b>{attachment.detail ? <small>{attachment.detail}</small> : null}</span>
    </>
  );
  return attachment.href ? (
    <a href={attachment.href} target="_blank" rel="noreferrer" aria-label={`打开附件 ${attachment.name}`}>{content}</a>
  ) : <span>{content}</span>;
}
