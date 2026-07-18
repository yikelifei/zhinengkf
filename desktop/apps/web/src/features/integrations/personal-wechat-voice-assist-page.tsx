"use client";

import type { ReactNode } from "react";
import {
  Check,
  FileCheck2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Volume2,
} from "lucide-react";
import { FeatureNotice, FeaturePage } from "./feature-page";
import styles from "./integration-pages.module.css";

export const PERSONAL_WECHAT_AI_VOICE_DISCLOSURE = "AI 合成语音";

export type PersonalWechatVoiceAssistModel = {
  recordingAuthorization: "missing" | "authorized" | "revoked";
  recordingStatus: "idle" | "recording" | "paused" | "stopped";
  transcript: string;
  transcriptReviewed: boolean;
  neutralVoiceAuthorization: "pending" | "authorized" | "blocked";
  previewStatus: "unavailable" | "ready" | "playing" | "paused" | "stopped";
  previewListened: boolean;
  approvalStatus: "pending" | "approved";
};

export type PersonalWechatVoiceAssistActions = {
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  onTranscriptChange: (value: string) => void;
  onApproveTranscript: () => void;
  onStartPreview: () => void;
  onPausePreview: () => void;
  onStopPreview: () => void;
  onApproveVoice: () => void;
  onRevokeApproval: () => void;
};

export type PersonalWechatVoiceAssistPageProps = {
  model?: PersonalWechatVoiceAssistModel;
  actions?: Partial<PersonalWechatVoiceAssistActions>;
  enabled?: boolean;
  disabledReason?: string;
};

export const DEFAULT_PERSONAL_WECHAT_VOICE_ASSIST_MODEL: PersonalWechatVoiceAssistModel = {
  recordingAuthorization: "missing",
  recordingStatus: "idle",
  transcript: "",
  transcriptReviewed: false,
  neutralVoiceAuthorization: "pending",
  previewStatus: "unavailable",
  previewListened: false,
  approvalStatus: "pending",
};

const ACTION_NOT_CONNECTED = "受控动作尚未接入";

export function PersonalWechatVoiceAssistPage({
  model = DEFAULT_PERSONAL_WECHAT_VOICE_ASSIST_MODEL,
  actions = {},
  enabled = false,
  disabledReason = "语音辅助尚未由管理员明确启用",
}: PersonalWechatVoiceAssistPageProps = {}) {
  const globalBlock = enabled ? undefined : disabledReason;
  const recordingAuthorized = model.recordingAuthorization === "authorized";
  const recordingActive = model.recordingStatus === "recording";
  const recordingPaused = model.recordingStatus === "paused";
  const transcriptPresent = Boolean(model.transcript.trim());
  const neutralVoiceAuthorized = model.neutralVoiceAuthorization === "authorized";
  const previewPlaying = model.previewStatus === "playing";
  const voiceApproved = model.approvalStatus === "approved";

  const startRecordingBlock = firstBlock(
    globalBlock,
    !recordingAuthorized && "必须先取得当前操作员本次录音授权",
    recordingActive && "录音已经开始",
    !actions.onStartRecording && ACTION_NOT_CONNECTED,
  );
  const pauseRecordingBlock = firstBlock(
    globalBlock,
    !recordingActive && "只有正在录音时才能暂停",
    !actions.onPauseRecording && ACTION_NOT_CONNECTED,
  );
  const resumeRecordingBlock = firstBlock(
    globalBlock,
    !recordingPaused && "只有已暂停的录音才能继续",
    !actions.onResumeRecording && ACTION_NOT_CONNECTED,
  );
  const stopRecordingBlock = firstBlock(
    globalBlock,
    !(recordingActive || recordingPaused) && "当前没有可停止的录音",
    !actions.onStopRecording && ACTION_NOT_CONNECTED,
  );
  const transcriptEditBlock = firstBlock(
    globalBlock,
    !transcriptPresent && model.recordingStatus === "idle" && "完成授权录音后才会出现转写草稿",
    model.transcriptReviewed && "人工校对已确认；需撤回上游草稿后再编辑",
    !actions.onTranscriptChange && ACTION_NOT_CONNECTED,
  );
  const transcriptReviewBlock = firstBlock(
    globalBlock,
    !transcriptPresent && "转写草稿为空",
    model.transcriptReviewed && "转写草稿已经人工确认",
    !actions.onApproveTranscript && ACTION_NOT_CONNECTED,
  );
  const startPreviewBlock = firstBlock(
    globalBlock,
    !model.transcriptReviewed && "必须先完成人工校对",
    !neutralVoiceAuthorized && "只允许使用已授权的中性合成音色",
    model.previewStatus === "unavailable" && "试听文件尚未准备好",
    previewPlaying && "试听正在播放",
    !actions.onStartPreview && ACTION_NOT_CONNECTED,
  );
  const pausePreviewBlock = firstBlock(
    globalBlock,
    !previewPlaying && "只有正在播放时才能暂停",
    !actions.onPausePreview && ACTION_NOT_CONNECTED,
  );
  const stopPreviewBlock = firstBlock(
    globalBlock,
    !(previewPlaying || model.previewStatus === "paused") && "当前没有可停止的试听",
    !actions.onStopPreview && ACTION_NOT_CONNECTED,
  );
  const approveVoiceBlock = firstBlock(
    globalBlock,
    !model.transcriptReviewed && "必须先完成人工校对",
    !neutralVoiceAuthorized && "中性合成音色尚未授权",
    !model.previewListened && "操作员必须完整人工试听后才能审批",
    voiceApproved && "此语音已经人工审批",
    !actions.onApproveVoice && ACTION_NOT_CONNECTED,
  );
  const revokeApprovalBlock = firstBlock(
    globalBlock,
    !voiceApproved && "当前没有可撤销的语音审批",
    !actions.onRevokeApproval && ACTION_NOT_CONNECTED,
  );

  return (
    <FeaturePage
      id="personal-wechat-voice-assist-page"
      title="个人微信语音辅助"
      description="只处理授权录音、人工校对、试听与审批；真实发送由独立发送页面负责。"
      icon={<Volume2 size={20} />}
    >
      <FeatureNotice tone="warning" title="录音授权边界">
        只能录制当前操作员主动口述，且必须取得本次明确授权；禁止后台采集客户通话、克隆第三方声音或冒充真人。
      </FeatureNotice>
      <FeatureNotice tone="info" title={`固定披露：${PERSONAL_WECHAT_AI_VOICE_DISCLOSURE}`}>
        合成内容只使用已授权的中性音色，披露标识不可隐藏；操作员必须人工试听并确认，页面不会自动发送消息。
      </FeatureNotice>

      <section className={styles.panel} aria-labelledby="personal-wechat-voice-flow-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="personal-wechat-voice-flow-title">受控语音草稿流程</h2>
            <p>一次只处理一个语音草稿；任一步缺少授权、人工确认或回调时都会保持禁用。</p>
          </div>
          <span className={`${styles.statusBadge} ${styles.statusDanger}`}>真实发送关闭</span>
        </header>

        <ol className={styles.flowList} aria-label="个人微信语音辅助四步流程">
          <li>
            <StageHeading
              icon={<Mic size={16} />}
              step="1"
              title="授权录音"
              status={recordingStatusLabel(model)}
              ready={recordingAuthorized}
            />
            <small id="voice-recording-action-reason">
              {recordingStageHint(model, startRecordingBlock, pauseRecordingBlock, resumeRecordingBlock)}
            </small>
            <div className={styles.buttonRow}>
              {recordingActive ? (
                <>
                  <VoiceActionButton
                    actionId="integrations.personal-wechat.voice.record.pause"
                    label="暂停当前操作员录音"
                    reasonId="voice-recording-action-reason"
                    disabledReason={pauseRecordingBlock}
                    onAction={actions.onPauseRecording}
                  ><Pause size={15} aria-hidden="true" /> 暂停</VoiceActionButton>
                  <VoiceActionButton
                    actionId="integrations.personal-wechat.voice.record.stop"
                    label="停止当前操作员录音"
                    reasonId="voice-recording-action-reason"
                    disabledReason={stopRecordingBlock}
                    onAction={actions.onStopRecording}
                  ><Square size={14} aria-hidden="true" /> 停止</VoiceActionButton>
                </>
              ) : recordingPaused ? (
                <>
                  <VoiceActionButton
                    actionId="integrations.personal-wechat.voice.record.resume"
                    label="继续当前操作员录音"
                    reasonId="voice-recording-action-reason"
                    disabledReason={resumeRecordingBlock}
                    onAction={actions.onResumeRecording}
                    primary
                  ><Play size={15} aria-hidden="true" /> 继续录音</VoiceActionButton>
                  <VoiceActionButton
                    actionId="integrations.personal-wechat.voice.record.stop"
                    label="停止当前操作员录音"
                    reasonId="voice-recording-action-reason"
                    disabledReason={stopRecordingBlock}
                    onAction={actions.onStopRecording}
                  ><Square size={14} aria-hidden="true" /> 停止</VoiceActionButton>
                </>
              ) : (
                <VoiceActionButton
                  actionId="integrations.personal-wechat.voice.record.start"
                  label="开始当前操作员授权录音"
                  reasonId="voice-recording-action-reason"
                  disabledReason={startRecordingBlock}
                  onAction={actions.onStartRecording}
                  primary
                ><Mic size={15} aria-hidden="true" /> 开始授权录音</VoiceActionButton>
              )}
            </div>
          </li>

          <li>
            <StageHeading
              icon={<FileCheck2 size={16} />}
              step="2"
              title="人工校对"
              status={model.transcriptReviewed ? "已确认" : transcriptPresent ? "待确认" : "无草稿"}
              ready={model.transcriptReviewed}
            />
            <label className={styles.field}>
              <span>转写草稿</span>
              <textarea
                value={model.transcript}
                onChange={(event) => actions.onTranscriptChange?.(event.target.value)}
                rows={4}
                placeholder="完成授权录音后，在此人工校对转写草稿。"
                aria-describedby="voice-transcript-action-reason"
                data-disabled-reason={transcriptEditBlock ?? "无"}
                title={transcriptEditBlock ?? "转写草稿可以人工编辑"}
                disabled={Boolean(transcriptEditBlock)}
              />
            </label>
            <small id="voice-transcript-action-reason">
              {transcriptReviewBlock ? `禁用原因：${transcriptReviewBlock}` : "草稿已具备人工确认条件。"}
            </small>
            <div className={styles.buttonRow}>
              <VoiceActionButton
                actionId="integrations.personal-wechat.voice.transcript.approve"
                label="确认人工校对完成"
                reasonId="voice-transcript-action-reason"
                disabledReason={transcriptReviewBlock}
                onAction={actions.onApproveTranscript}
                primary
              ><Check size={15} aria-hidden="true" /> 确认校对</VoiceActionButton>
            </div>
          </li>

          <li>
            <StageHeading
              icon={<Volume2 size={16} />}
              step="3"
              title="人工试听"
              status={previewStatusLabel(model)}
              ready={model.previewListened}
            />
            <p><strong>{PERSONAL_WECHAT_AI_VOICE_DISCLOSURE}</strong> · 仅授权中性音色</p>
            <small id="voice-preview-action-reason">
              {previewStageHint(model, startPreviewBlock, pausePreviewBlock)}
            </small>
            <div className={styles.buttonRow}>
              {previewPlaying ? (
                <VoiceActionButton
                  actionId="integrations.personal-wechat.voice.preview.pause"
                  label="暂停 AI 合成语音试听"
                  reasonId="voice-preview-action-reason"
                  disabledReason={pausePreviewBlock}
                  onAction={actions.onPausePreview}
                ><Pause size={15} aria-hidden="true" /> 暂停试听</VoiceActionButton>
              ) : (
                <VoiceActionButton
                  actionId="integrations.personal-wechat.voice.preview.play"
                  label="播放 AI 合成语音试听"
                  reasonId="voice-preview-action-reason"
                  disabledReason={startPreviewBlock}
                  onAction={actions.onStartPreview}
                  primary
                ><Play size={15} aria-hidden="true" /> 播放试听</VoiceActionButton>
              )}
              {(previewPlaying || model.previewStatus === "paused") ? (
                <VoiceActionButton
                  actionId="integrations.personal-wechat.voice.preview.stop"
                  label="停止 AI 合成语音试听"
                  reasonId="voice-preview-action-reason"
                  disabledReason={stopPreviewBlock}
                  onAction={actions.onStopPreview}
                ><Square size={14} aria-hidden="true" /> 停止试听</VoiceActionButton>
              ) : null}
            </div>
          </li>

          <li>
            <StageHeading
              icon={<ShieldCheck size={16} />}
              step="4"
              title="人工审批"
              status={voiceApproved ? "已审批" : "待审批"}
              ready={voiceApproved}
            />
            <small id="voice-approval-action-reason">
              {voiceApproved
                ? "审批仅形成可交接草稿；本页没有发送按钮。"
                : approveVoiceBlock
                  ? `禁用原因：${approveVoiceBlock}`
                  : "已完成人工试听，可以审批语音草稿。"}
            </small>
            <div className={styles.buttonRow}>
              {voiceApproved ? (
                <VoiceActionButton
                  actionId="integrations.personal-wechat.voice.approval.revoke"
                  label="撤销语音草稿审批"
                  reasonId="voice-approval-action-reason"
                  disabledReason={revokeApprovalBlock}
                  onAction={actions.onRevokeApproval}
                ><RotateCcw size={15} aria-hidden="true" /> 撤销审批</VoiceActionButton>
              ) : (
                <VoiceActionButton
                  actionId="integrations.personal-wechat.voice.approval.approve"
                  label="审批已人工试听的语音草稿"
                  reasonId="voice-approval-action-reason"
                  disabledReason={approveVoiceBlock}
                  onAction={actions.onApproveVoice}
                  primary
                ><Check size={15} aria-hidden="true" /> 审批语音草稿</VoiceActionButton>
              )}
            </div>
          </li>
        </ol>
      </section>

      <FeatureNotice tone="success" title="审批与发送已物理分离">
        本页不导入发送 API、不创建发送任务，也没有真实发送按钮；审批完成后仍需到独立发送页面重新核对客户、账号和窗口身份。
      </FeatureNotice>
    </FeaturePage>
  );
}

function VoiceActionButton({
  actionId,
  label,
  reasonId,
  disabledReason,
  onAction,
  primary = false,
  children,
}: {
  actionId: string;
  label: string;
  reasonId: string;
  disabledReason?: string;
  onAction?: () => void;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-action-id={actionId}
      data-disabled-reason={disabledReason ?? "无"}
      aria-label={label}
      aria-describedby={reasonId}
      title={disabledReason ?? `${label}已就绪`}
      className={primary ? styles.primaryButton : undefined}
      onClick={onAction}
      disabled={Boolean(disabledReason)}
    >
      {children}
    </button>
  );
}

function StageHeading({
  icon,
  step,
  title,
  status,
  ready,
}: {
  icon: ReactNode;
  step: string;
  title: string;
  status: string;
  ready: boolean;
}) {
  return (
    <div className={styles.cardHeader}>
      <div>
        <span aria-hidden="true">{icon}</span>
        <strong>{step}. {title}</strong>
      </div>
      <span className={`${styles.statusBadge} ${ready ? styles.statusReady : ""}`}>{status}</span>
    </div>
  );
}

function firstBlock(...reasons: Array<string | false | undefined>) {
  return reasons.find((reason): reason is string => typeof reason === "string" && Boolean(reason));
}

function recordingStatusLabel(model: PersonalWechatVoiceAssistModel) {
  if (model.recordingAuthorization === "revoked") return "授权已撤销";
  if (model.recordingAuthorization === "missing") return "待授权";
  return {
    idle: "已授权",
    recording: "录音中",
    paused: "已暂停",
    stopped: "已停止",
  }[model.recordingStatus];
}

function recordingStageHint(
  model: PersonalWechatVoiceAssistModel,
  startBlock?: string,
  pauseBlock?: string,
  resumeBlock?: string,
) {
  const block = model.recordingStatus === "recording"
    ? pauseBlock
    : model.recordingStatus === "paused"
      ? resumeBlock
      : startBlock;
  return block ? `禁用原因：${block}` : "只录制当前操作员本次主动口述。";
}

function previewStatusLabel(model: PersonalWechatVoiceAssistModel) {
  if (model.neutralVoiceAuthorization === "blocked") return "音色已阻止";
  if (model.neutralVoiceAuthorization === "pending") return "待音色授权";
  if (model.previewListened) return "已人工试听";
  return {
    unavailable: "未生成",
    ready: "待试听",
    playing: "试听中",
    paused: "已暂停",
    stopped: "已停止",
  }[model.previewStatus];
}

function previewStageHint(
  model: PersonalWechatVoiceAssistModel,
  startBlock?: string,
  pauseBlock?: string,
) {
  const block = model.previewStatus === "playing" ? pauseBlock : startBlock;
  if (block) return `禁用原因：${block}`;
  return model.previewListened
    ? "操作员已人工试听；AI 合成语音标识仍不可隐藏。"
    : "必须人工播放试听，不能跳过试听直接审批。";
}
