"use client";

import {
  Check,
  FileText,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Volume2,
} from "lucide-react";
import styles from "./voice-assist-center.module.css";
import type {
  NeutralTtsPreviewState,
  OperatorRecordingStatus,
  VoiceAssistCenterProps,
  VoiceAssistStage,
} from "./types";

export const AI_SYNTHETIC_VOICE_DISCLOSURE = "AI 合成语音";

const STAGES: Array<{ id: VoiceAssistStage; label: string; hint: string }> = [
  { id: "record", label: "真人口述", hint: "操作员本人录音" },
  { id: "review", label: "人工校对", hint: "转写仅生成草稿" },
  { id: "preview", label: "合成预览", hint: "授权中性音色" },
  { id: "approved", label: "审批完成", hint: "仍需人工发送" },
];

const STAGE_INDEX: Record<VoiceAssistStage, number> = {
  record: 0,
  review: 1,
  preview: 2,
  approved: 3,
};

const RECORDING_STATUS_LABEL: Record<OperatorRecordingStatus, string> = {
  idle: "等待口述",
  recording: "正在录音",
  paused: "录音已暂停",
  stopped: "录音已停止",
};

const PREVIEW_STATUS_LABEL: Record<NeutralTtsPreviewState["status"], string> = {
  unavailable: "等待校对",
  ready: "可以预览",
  playing: "正在播放",
  paused: "播放已暂停",
  stopped: "播放已停止",
  approved: "人工已审批",
};

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
function joinClassNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function VoiceAssistCenter({ model, actions, disabled = false, className }: VoiceAssistCenterProps) {
  const recordingActive = model.recording.status === "recording";
  const recordingPaused = model.recording.status === "paused";
  const transcriptReady = model.transcript.status === "draft" || model.transcript.status === "reviewed";
  const transcriptReviewed = model.transcript.status === "reviewed";
  const previewAuthorized = model.preview.authorization === "authorized";
  const previewPlaying = model.preview.status === "playing";
  const voiceApproved = model.preview.status === "approved" || model.stage === "approved";
  const progress = model.preview.durationSeconds > 0
    ? Math.min(100, Math.max(0, (model.preview.elapsedSeconds / model.preview.durationSeconds) * 100))
    : 0;

  return (
    <section className={joinClassNames(styles.center, className)} aria-labelledby="voice-assist-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden="true"><Mic size={18} /></span>
          <div>
            <h2 id="voice-assist-title">语音辅助工作台</h2>
            <p>真人口述、转写校对与合成预览分步处理，系统不会自动发送</p>
          </div>
        </div>
        <span className={styles.humanControl}><ShieldCheck size={14} aria-hidden="true" />人工全程控制</span>
      </header>

      <div className={styles.safetyNotice} role="note">
        <ShieldCheck size={17} aria-hidden="true" />
        <div>
          <strong>身份与声音安全规则</strong>
          <span>不支持声音克隆或冒充真人；合成内容只使用已授权的中性音色，并永久标识为“{AI_SYNTHETIC_VOICE_DISCLOSURE}”。</span>
        </div>
      </div>

      <ol className={styles.stageRail} aria-label="语音辅助流程">
        {STAGES.map((stage, index) => {
          const state = index < STAGE_INDEX[model.stage] ? "complete" : index === STAGE_INDEX[model.stage] ? "current" : "upcoming";
          return (
            <li key={stage.id} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className={styles.stageNumber}>{state === "complete" ? <Check size={13} /> : index + 1}</span>
              <span><strong>{stage.label}</strong><small>{stage.hint}</small></span>
            </li>
          );
        })}
      </ol>

      <div className={styles.workspace}>
        <article className={styles.panel} aria-labelledby="voice-record-heading">
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon} aria-hidden="true"><Mic size={16} /></span>
            <div><h3 id="voice-record-heading">操作员真人口述</h3><p>只采集当前操作员主动录制的语音</p></div>
            <span className={joinClassNames(styles.status, recordingActive && styles.live)}>{RECORDING_STATUS_LABEL[model.recording.status]}</span>
          </div>

          <div className={styles.recorder}>
            <div className={styles.timer} aria-label={`录音时长 ${formatDuration(model.recording.elapsedSeconds)}`}>
              <strong>{formatDuration(model.recording.elapsedSeconds)}</strong>
              <span>{model.recording.inputDeviceLabel}</span>
            </div>
            <div className={styles.waveform} aria-hidden="true">
              {model.recording.waveform.slice(0, 28).map((level, index) => (
                <i key={index} style={{ height: `${Math.min(100, Math.max(8, level))}%` }} />
              ))}
            </div>
          </div>

          <div className={styles.actions}>
            {!recordingActive && !recordingPaused ? (
              <button type="button" className={styles.primaryButton} onClick={actions.onStartRecording} disabled={disabled}>
                <Mic size={14} aria-hidden="true" />开始口述
              </button>
            ) : null}
            {recordingPaused ? (
              <button type="button" className={styles.primaryButton} onClick={actions.onStartRecording} disabled={disabled}>
                <Play size={14} aria-hidden="true" />继续录音
              </button>
            ) : null}
            {recordingActive ? (
              <button type="button" className={styles.secondaryButton} onClick={actions.onPauseRecording} disabled={disabled}>
                <Pause size={14} aria-hidden="true" />暂停
              </button>
            ) : null}
            {(recordingActive || recordingPaused) ? (
              <button type="button" className={styles.stopButton} onClick={actions.onStopRecording} disabled={disabled}>
                <Square size={13} aria-hidden="true" />停止录音
              </button>
            ) : null}
          </div>
        </article>

        <article className={styles.panel} aria-labelledby="voice-transcript-heading">
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon} aria-hidden="true"><FileText size={16} /></span>
            <div><h3 id="voice-transcript-heading">STT 转写草稿</h3><p>{model.transcript.languageLabel} · 必须人工校对</p></div>
            <span className={styles.status}>{model.transcript.status === "reviewed" ? "已校对" : "待校对"}</span>
          </div>

          <label className={styles.transcriptField}>
            <span>口述内容</span>
            <textarea
              value={model.transcript.value}
              onChange={(event) => actions.onTranscriptChange(event.target.value)}
              placeholder="停止录音后，转写草稿显示在这里……"
              disabled={disabled || model.transcript.status === "transcribing"}
              rows={5}
            />
          </label>

          <div className={styles.metaLine}>
            <span>{model.transcript.helperText ?? "转写结果不会自动发送或直接生成语音。"}</span>
            {typeof model.transcript.confidence === "number" ? <span>转写置信度 {Math.round(model.transcript.confidence * 100)}%</span> : null}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={actions.onApproveTranscript}
              disabled={disabled || !transcriptReady || !model.transcript.value.trim() || transcriptReviewed}
            >
              <Check size={14} aria-hidden="true" />{transcriptReviewed ? "人工已校对" : "确认校对完成"}
            </button>
            {model.transcript.revisedByOperator ? <span className={styles.reviewMark}>已由操作员修改</span> : null}
          </div>
        </article>

        <article className={joinClassNames(styles.panel, styles.previewPanel)} aria-labelledby="voice-preview-heading">
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon} aria-hidden="true"><Volume2 size={16} /></span>
            <div><h3 id="voice-preview-heading">中性 TTS 预览</h3><p>{model.preview.voiceLabel}</p></div>
            <span className={styles.aiDisclosure}><Volume2 size={13} aria-hidden="true" />{AI_SYNTHETIC_VOICE_DISCLOSURE}</span>
          </div>

          <div className={styles.authorization} data-state={model.preview.authorization}>
            <span>{model.preview.authorization === "authorized" ? "音色使用已授权" : model.preview.authorization === "blocked" ? "音色使用已阻止" : "等待音色授权"}</span>
            <strong>{PREVIEW_STATUS_LABEL[model.preview.status]}</strong>
          </div>

          <div className={styles.player}>
            <button
              type="button"
              className={styles.playButton}
              aria-label={previewPlaying ? "暂停 AI 合成语音预览" : "播放 AI 合成语音预览"}
              onClick={previewPlaying ? actions.onPausePreview : actions.onStartPreview}
              disabled={disabled || !transcriptReviewed || !previewAuthorized || model.preview.status === "unavailable"}
            >
              {previewPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            </button>
            <div className={styles.progressGroup}>
              <div className={styles.progressTrack} aria-label={`预览进度 ${Math.round(progress)}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <span>{formatDuration(model.preview.elapsedSeconds)} / {formatDuration(model.preview.durationSeconds)}</span>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="停止 AI 合成语音预览"
              onClick={actions.onStopPreview}
              disabled={disabled || !previewPlaying}
            ><Square size={13} aria-hidden="true" /></button>
          </div>

          <p className={styles.permanentDisclosure}><ShieldCheck size={14} aria-hidden="true" />该标识不可隐藏：{AI_SYNTHETIC_VOICE_DISCLOSURE}，禁止声音克隆和真人身份冒充。</p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={actions.onApproveVoice}
              disabled={disabled || !transcriptReviewed || !previewAuthorized || voiceApproved}
            ><Check size={14} aria-hidden="true" />{voiceApproved ? "人工已审批" : "审批此语音"}</button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={actions.onRevokeApproval}
              disabled={disabled || !voiceApproved}
            ><RotateCcw size={14} aria-hidden="true" />撤销审批</button>
          </div>
        </article>
      </div>

      <footer className={styles.auditBar}>
        <span><ShieldCheck size={14} aria-hidden="true" />{model.audit.operatorLabel}</span>
        <span>{model.audit.lastActionLabel}{model.audit.lastActionAt ? ` · ${model.audit.lastActionAt}` : ""}</span>
        <strong>{AI_SYNTHETIC_VOICE_DISCLOSURE} · 仅人工审批，不自动发送</strong>
      </footer>
    </section>
  );
}
