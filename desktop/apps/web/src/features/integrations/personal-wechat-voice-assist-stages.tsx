"use client";

import { Check, FileCheck2, Mic, Pause, Play, RotateCcw, ShieldCheck, Square, Volume2 } from "lucide-react";
import {
  PERSONAL_WECHAT_AI_VOICE_DISCLOSURE,
  previewStageHint,
  previewStatusLabel,
  recordingStageHint,
  recordingStatusLabel,
  type PersonalWechatVoiceAssistActions,
  type PersonalWechatVoiceAssistModel,
  type PersonalWechatVoiceAssistState,
} from "./personal-wechat-voice-assist-model";
import { VoiceActionButton, VoiceStageHeading } from "./personal-wechat-voice-assist-primitives";
import styles from "./integration-pages.module.css";

type VoiceStageProps = {
  model: PersonalWechatVoiceAssistModel;
  actions: Partial<PersonalWechatVoiceAssistActions>;
  state: PersonalWechatVoiceAssistState;
};

export function VoiceRecordingStage({ model, actions, state }: VoiceStageProps) {
  return (
    <li>
      <VoiceStageHeading
        icon={<Mic size={16} />}
        step="1"
        title="授权录音"
        status={recordingStatusLabel(model)}
        ready={state.recordingAuthorized}
      />
      <small id="voice-recording-action-reason">{recordingStageHint(model, state)}</small>
      <div className={styles.buttonRow}>
        {state.recordingActive ? (
          <>
            <VoiceActionButton
              actionId="integrations.personal-wechat.voice.record.pause"
              label="暂停当前操作员录音"
              reasonId="voice-recording-action-reason"
              disabledReason={state.pauseRecordingBlock}
              onAction={actions.onPauseRecording}
            ><Pause size={15} aria-hidden="true" /> 暂停</VoiceActionButton>
            <StopRecordingButton actions={actions} state={state} />
          </>
        ) : state.recordingPaused ? (
          <>
            <VoiceActionButton
              actionId="integrations.personal-wechat.voice.record.resume"
              label="继续当前操作员录音"
              reasonId="voice-recording-action-reason"
              disabledReason={state.resumeRecordingBlock}
              onAction={actions.onResumeRecording}
              primary
            ><Play size={15} aria-hidden="true" /> 继续录音</VoiceActionButton>
            <StopRecordingButton actions={actions} state={state} />
          </>
        ) : (
          <VoiceActionButton
            actionId="integrations.personal-wechat.voice.record.start"
            label="开始当前操作员授权录音"
            reasonId="voice-recording-action-reason"
            disabledReason={state.startRecordingBlock}
            onAction={actions.onStartRecording}
            primary
          ><Mic size={15} aria-hidden="true" /> 开始授权录音</VoiceActionButton>
        )}
      </div>
    </li>
  );
}

export function VoiceTranscriptStage({ model, actions, state }: VoiceStageProps) {
  return (
    <li>
      <VoiceStageHeading
        icon={<FileCheck2 size={16} />}
        step="2"
        title="人工校对"
        status={model.transcriptReviewed ? "已确认" : state.transcriptPresent ? "待确认" : "无草稿"}
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
          data-disabled-reason={state.transcriptEditBlock ?? "无"}
          title={state.transcriptEditBlock ?? "转写草稿可以人工编辑"}
          disabled={Boolean(state.transcriptEditBlock)}
        />
      </label>
      <small id="voice-transcript-action-reason">
        {state.transcriptReviewBlock ? `禁用原因：${state.transcriptReviewBlock}` : "草稿已具备人工确认条件。"}
      </small>
      <div className={styles.buttonRow}>
        <VoiceActionButton
          actionId="integrations.personal-wechat.voice.transcript.approve"
          label="确认人工校对完成"
          reasonId="voice-transcript-action-reason"
          disabledReason={state.transcriptReviewBlock}
          onAction={actions.onApproveTranscript}
          primary
        ><Check size={15} aria-hidden="true" /> 确认校对</VoiceActionButton>
      </div>
    </li>
  );
}

export function VoicePreviewStage({ model, actions, state }: VoiceStageProps) {
  return (
    <li>
      <VoiceStageHeading
        icon={<Volume2 size={16} />}
        step="3"
        title="人工试听"
        status={previewStatusLabel(model)}
        ready={model.previewListened}
      />
      <p><strong>{PERSONAL_WECHAT_AI_VOICE_DISCLOSURE}</strong> · 仅授权中性音色</p>
      <small id="voice-preview-action-reason">{previewStageHint(model, state)}</small>
      <div className={styles.buttonRow}>
        {state.previewPlaying ? (
          <VoiceActionButton
            actionId="integrations.personal-wechat.voice.preview.pause"
            label="暂停 AI 合成语音试听"
            reasonId="voice-preview-action-reason"
            disabledReason={state.pausePreviewBlock}
            onAction={actions.onPausePreview}
          ><Pause size={15} aria-hidden="true" /> 暂停试听</VoiceActionButton>
        ) : (
          <VoiceActionButton
            actionId="integrations.personal-wechat.voice.preview.play"
            label="播放 AI 合成语音试听"
            reasonId="voice-preview-action-reason"
            disabledReason={state.startPreviewBlock}
            onAction={actions.onStartPreview}
            primary
          ><Play size={15} aria-hidden="true" /> 播放试听</VoiceActionButton>
        )}
        {(state.previewPlaying || model.previewStatus === "paused") ? (
          <VoiceActionButton
            actionId="integrations.personal-wechat.voice.preview.stop"
            label="停止 AI 合成语音试听"
            reasonId="voice-preview-action-reason"
            disabledReason={state.stopPreviewBlock}
            onAction={actions.onStopPreview}
          ><Square size={14} aria-hidden="true" /> 停止试听</VoiceActionButton>
        ) : null}
      </div>
    </li>
  );
}

export function VoiceApprovalStage({ model, actions, state }: VoiceStageProps) {
  return (
    <li>
      <VoiceStageHeading
        icon={<ShieldCheck size={16} />}
        step="4"
        title="人工审批"
        status={state.voiceApproved ? "已审批" : "待审批"}
        ready={state.voiceApproved}
      />
      <small id="voice-approval-action-reason">
        {state.voiceApproved
          ? "审批仅形成可交接草稿；本页没有发送按钮。"
          : state.approveVoiceBlock
            ? `禁用原因：${state.approveVoiceBlock}`
            : "已完成人工试听，可以审批语音草稿。"}
      </small>
      <div className={styles.buttonRow}>
        {state.voiceApproved ? (
          <VoiceActionButton
            actionId="integrations.personal-wechat.voice.approval.revoke"
            label="撤销语音草稿审批"
            reasonId="voice-approval-action-reason"
            disabledReason={state.revokeApprovalBlock}
            onAction={actions.onRevokeApproval}
          ><RotateCcw size={15} aria-hidden="true" /> 撤销审批</VoiceActionButton>
        ) : (
          <VoiceActionButton
            actionId="integrations.personal-wechat.voice.approval.approve"
            label="审批已人工试听的语音草稿"
            reasonId="voice-approval-action-reason"
            disabledReason={state.approveVoiceBlock}
            onAction={actions.onApproveVoice}
            primary
          ><Check size={15} aria-hidden="true" /> 审批语音草稿</VoiceActionButton>
        )}
      </div>
    </li>
  );
}

function StopRecordingButton({
  actions,
  state,
}: Pick<VoiceStageProps, "actions" | "state">) {
  return (
    <VoiceActionButton
      actionId="integrations.personal-wechat.voice.record.stop"
      label="停止当前操作员录音"
      reasonId="voice-recording-action-reason"
      disabledReason={state.stopRecordingBlock}
      onAction={actions.onStopRecording}
    ><Square size={14} aria-hidden="true" /> 停止</VoiceActionButton>
  );
}
