"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Image as ImageIcon,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./conversation-thread-pane.module.css";
import type { ConversationWorkbenchActions, ConversationWorkbenchThread } from "./types";
import { ComposerToolIcon } from "./workbench-primitives";

type ConversationAssistantComposerProps = {
  thread: ConversationWorkbenchThread;
  actions: ConversationWorkbenchActions;
  variant: "default" | "wecom";
};

const QUICK_EMOJIS = ["😀", "😊", "好的", "谢谢", "👍", "🙏", "🎁", "✅"];

export function ConversationAssistantComposer({ thread, actions, variant }: ConversationAssistantComposerProps) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composer = thread.composer;
  const composerDisabled = Boolean(composer.disabled || composer.sending);
  const composerDisabledReason = composer.sending
    ? "人工回复正在安全入队，请稍候"
    : composer.disabled
      ? composer.placeholder || "当前会话暂不可人工回复"
      : undefined;
  const replyBytes = new TextEncoder().encode(composer.value.trim()).length;
  const replyEmpty = !composer.value.trim() && !(composer.attachments?.length);
  const replyTooLarge = replyBytes > 2048;
  const sendDisabled = composerDisabled || replyEmpty || replyTooLarge;
  const sendDisabledReason = composerDisabledReason
    || (replyEmpty ? "请先输入人工回复内容或添加附件" : undefined)
    || (replyTooLarge ? "企业微信单条文字最多 2048 个 UTF-8 字节" : undefined);
  const activeSuggestionTab = thread.suggestion.tabs.find((tab) => tab.value === thread.suggestion.activeTab)
    || thread.suggestion.tabs[0];

  useEffect(() => {
    setEmojiOpen(false);
  }, [thread.participant.name]);

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sendDisabled) actions.onSendReply();
  }

  function sendWithEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (variant !== "wecom" || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!sendDisabled) actions.onSendReply();
  }

  function insertQuickText(value: string) {
    const textarea = composerRef.current;
    const currentValue = composer.value;
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextValue = `${currentValue.slice(0, selectionStart)}${value}${currentValue.slice(selectionEnd)}`;
    if (nextValue.length > composer.maxLength) return;
    actions.onReplyChange(nextValue);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      const nextCursor = selectionStart + value.length;
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
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
          ref={composerRef}
          data-action-id="conversations.reply.edit"
          data-disabled-reason={composerDisabledReason}
          value={composer.value}
          maxLength={composer.maxLength}
          placeholder={composer.placeholder || "输入人工回复"}
          aria-label="输入人工回复"
          disabled={composerDisabled}
          onChange={(event) => actions.onReplyChange(event.target.value)}
          onKeyDown={sendWithEnter}
        />
        {variant === "wecom" && composer.attachments?.length ? (
          <div className={styles.pendingAttachments} aria-label="待发送附件">
            {composer.attachments.map((attachment) => (
              <span key={attachment.id}>
                {attachment.kind === "image" ? <ImageIcon size={14} aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
                <b>{attachment.name}</b>
                {attachment.detail ? <small>{attachment.detail}</small> : null}
                <button
                  type="button"
                  data-action-id={`conversations.attachment-${attachment.id}.remove`}
                  onClick={() => actions.onRemoveAttachment?.(attachment.id)}
                  aria-label={`移除附件 ${attachment.name}`}
                >
                  <CircleX size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className={styles.composerToolbar}>
          <div className={styles.composerTools}>
            {variant === "wecom" ? (
              <div className={styles.quickEmojiHost}>
                <button
                  type="button"
                  data-action-id="conversations.composer-tool-emoji.open"
                  aria-label="插入常用表情"
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((open) => !open)}
                >😊<span>表情</span></button>
                {emojiOpen ? (
                  <div className={styles.quickEmojiPanel} role="group" aria-label="常用表情和短语">
                    {QUICK_EMOJIS.map((emoji, index) => (
                      <button
                        type="button"
                        key={emoji}
                        data-action-id={`conversations.quick-text-${index}.insert`}
                        onClick={() => insertQuickText(emoji)}
                        aria-label={`插入 ${emoji}`}
                      >{emoji}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {variant === "wecom" ? (
              <button
                type="button"
                data-action-id="conversations.suggestion.use-compact"
                data-disabled-reason={thread.suggestion.loading ? "回复建议正在生成" : !thread.suggestion.text ? "尚无可用的回复建议" : undefined}
                disabled={!thread.suggestion.text || thread.suggestion.loading}
                onClick={actions.onUseSuggestion}
                aria-label="将 AI 回复建议填入输入框"
                title={thread.suggestion.error || thread.suggestion.sourceDetail || "将真实生成的 AI 建议填入输入框"}
              ><Sparkles size={14} aria-hidden="true" /><span>{thread.suggestion.loading ? "生成中" : "AI 建议"}</span></button>
            ) : null}
            {variant === "wecom" && actions.onAttachFiles ? (
              <>
                <button
                  type="button"
                  data-action-id="conversations.attachment-image.open-picker"
                  data-disabled-reason={composer.attachmentBusy ? "附件正在安全上传" : (composer.attachments?.length || 0) >= 4 ? "每次回复最多添加 4 个附件" : undefined}
                  onClick={() => imageInputRef.current?.click()}
                  disabled={composer.attachmentBusy || (composer.attachments?.length || 0) >= 4}
                  aria-label="添加待发送图片"
                >
                  <ImageIcon size={14} aria-hidden="true" /><span>图片</span>
                </button>
                <input
                  ref={imageInputRef}
                  className={styles.fileInput}
                  type="file"
                  accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                  multiple
                  onChange={(event) => {
                    actions.onAttachFiles?.(Array.from(event.target.files || []));
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  data-action-id="conversations.attachment-file.open-picker"
                  data-disabled-reason={composer.attachmentBusy ? "附件正在安全上传" : (composer.attachments?.length || 0) >= 4 ? "每次回复最多添加 4 个附件" : undefined}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={composer.attachmentBusy || (composer.attachments?.length || 0) >= 4}
                  aria-label="添加待发送文件"
                >
                  <Paperclip size={14} aria-hidden="true" /><span>文件</span>
                </button>
                <input
                  ref={fileInputRef}
                  className={styles.fileInput}
                  type="file"
                  accept="application/pdf,text/plain,.pdf,.txt"
                  multiple
                  onChange={(event) => {
                    actions.onAttachFiles?.(Array.from(event.target.files || []));
                    event.currentTarget.value = "";
                  }}
                />
              </>
            ) : null}
            {actions.onComposerTool ? composer.tools.map((tool) => (
              <button type="button" data-action-id={`conversations.composer-tool-${tool.id}.open`} onClick={() => actions.onComposerTool?.(tool.id)} aria-label={tool.label} title={tool.label} key={tool.id}>
                <ComposerToolIcon tool={tool} />{tool.iconOnly ? null : <span>{tool.label}</span>}
              </button>
            )) : null}
          </div>
          {variant === "wecom" ? <span className={styles.sendHint}>Enter 发送 · Shift+Enter 换行</span> : null}
          <span className={styles.characterCount} data-over-limit={replyTooLarge ? "true" : "false"}>
            {composer.value.length}/{composer.maxLength} · {replyBytes}/2048 字节
          </span>
          <button
            type="submit"
            className={styles.sendButton}
            data-action-id="conversations.reply.send-now"
            data-disabled-reason={sendDisabledReason}
            disabled={sendDisabled}
            aria-label="核对目标会话并发送人工回复到企业微信"
          >
            <Send size={15} aria-hidden="true" />
            {composer.sending ? "发送中" : variant === "wecom" ? "发送" : composer.sendLabel || "发送"}
            {variant === "default" ? <ChevronDown size={13} aria-hidden="true" /> : null}
          </button>
        </div>
        {composer.feedback ? (
          <div className={`${styles.composerFeedback} ${styles[`text-${composer.feedbackTone || "neutral"}`]}`} role="status">
            <span>{composer.feedback}</span>
            {composer.queuedTask ? (
              <Link
                data-action-id="conversations.reply.open-send-confirmation"
                href={composer.queuedTask.href}
                aria-label={`查看发送任务 ${composer.queuedTask.id}`}
              >
                <ShieldCheck size={13} aria-hidden="true" />
                {composer.queuedTask.actionLabel}
              </Link>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
