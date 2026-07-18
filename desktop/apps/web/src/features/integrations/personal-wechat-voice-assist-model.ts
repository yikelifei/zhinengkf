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

export type PersonalWechatVoiceAssistState = {
  recordingAuthorized: boolean;
  recordingActive: boolean;
  recordingPaused: boolean;
  transcriptPresent: boolean;
  neutralVoiceAuthorized: boolean;
  previewPlaying: boolean;
  voiceApproved: boolean;
  startRecordingBlock?: string;
  pauseRecordingBlock?: string;
  resumeRecordingBlock?: string;
  stopRecordingBlock?: string;
  transcriptEditBlock?: string;
  transcriptReviewBlock?: string;
  startPreviewBlock?: string;
  pausePreviewBlock?: string;
  stopPreviewBlock?: string;
  approveVoiceBlock?: string;
  revokeApprovalBlock?: string;
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

export function derivePersonalWechatVoiceAssistState({
  model,
  actions,
  enabled,
  disabledReason,
}: {
  model: PersonalWechatVoiceAssistModel;
  actions: Partial<PersonalWechatVoiceAssistActions>;
  enabled: boolean;
  disabledReason: string;
}): PersonalWechatVoiceAssistState {
  const globalBlock = enabled ? undefined : disabledReason;
  const recordingAuthorized = model.recordingAuthorization === "authorized";
  const recordingActive = model.recordingStatus === "recording";
  const recordingPaused = model.recordingStatus === "paused";
  const transcriptPresent = Boolean(model.transcript.trim());
  const neutralVoiceAuthorized = model.neutralVoiceAuthorization === "authorized";
  const previewPlaying = model.previewStatus === "playing";
  const voiceApproved = model.approvalStatus === "approved";

  return {
    recordingAuthorized,
    recordingActive,
    recordingPaused,
    transcriptPresent,
    neutralVoiceAuthorized,
    previewPlaying,
    voiceApproved,
    startRecordingBlock: firstBlock(
      globalBlock,
      !recordingAuthorized && "必须先取得当前操作员本次录音授权",
      recordingActive && "录音已经开始",
      !actions.onStartRecording && ACTION_NOT_CONNECTED,
    ),
    pauseRecordingBlock: firstBlock(
      globalBlock,
      !recordingActive && "只有正在录音时才能暂停",
      !actions.onPauseRecording && ACTION_NOT_CONNECTED,
    ),
    resumeRecordingBlock: firstBlock(
      globalBlock,
      !recordingPaused && "只有已暂停的录音才能继续",
      !actions.onResumeRecording && ACTION_NOT_CONNECTED,
    ),
    stopRecordingBlock: firstBlock(
      globalBlock,
      !(recordingActive || recordingPaused) && "当前没有可停止的录音",
      !actions.onStopRecording && ACTION_NOT_CONNECTED,
    ),
    transcriptEditBlock: firstBlock(
      globalBlock,
      !transcriptPresent && model.recordingStatus === "idle" && "完成授权录音后才会出现转写草稿",
      model.transcriptReviewed && "人工校对已确认；需撤回上游草稿后再编辑",
      !actions.onTranscriptChange && ACTION_NOT_CONNECTED,
    ),
    transcriptReviewBlock: firstBlock(
      globalBlock,
      !transcriptPresent && "转写草稿为空",
      model.transcriptReviewed && "转写草稿已经人工确认",
      !actions.onApproveTranscript && ACTION_NOT_CONNECTED,
    ),
    startPreviewBlock: firstBlock(
      globalBlock,
      !model.transcriptReviewed && "必须先完成人工校对",
      !neutralVoiceAuthorized && "只允许使用已授权的中性合成音色",
      model.previewStatus === "unavailable" && "试听文件尚未准备好",
      previewPlaying && "试听正在播放",
      !actions.onStartPreview && ACTION_NOT_CONNECTED,
    ),
    pausePreviewBlock: firstBlock(
      globalBlock,
      !previewPlaying && "只有正在播放时才能暂停",
      !actions.onPausePreview && ACTION_NOT_CONNECTED,
    ),
    stopPreviewBlock: firstBlock(
      globalBlock,
      !(previewPlaying || model.previewStatus === "paused") && "当前没有可停止的试听",
      !actions.onStopPreview && ACTION_NOT_CONNECTED,
    ),
    approveVoiceBlock: firstBlock(
      globalBlock,
      !model.transcriptReviewed && "必须先完成人工校对",
      !neutralVoiceAuthorized && "中性合成音色尚未授权",
      !model.previewListened && "操作员必须完整人工试听后才能审批",
      voiceApproved && "此语音已经人工审批",
      !actions.onApproveVoice && ACTION_NOT_CONNECTED,
    ),
    revokeApprovalBlock: firstBlock(
      globalBlock,
      !voiceApproved && "当前没有可撤销的语音审批",
      !actions.onRevokeApproval && ACTION_NOT_CONNECTED,
    ),
  };
}

export function recordingStatusLabel(model: PersonalWechatVoiceAssistModel) {
  if (model.recordingAuthorization === "revoked") return "授权已撤销";
  if (model.recordingAuthorization === "missing") return "待授权";
  return {
    idle: "已授权",
    recording: "录音中",
    paused: "已暂停",
    stopped: "已停止",
  }[model.recordingStatus];
}

export function recordingStageHint(
  model: PersonalWechatVoiceAssistModel,
  state: PersonalWechatVoiceAssistState,
) {
  const block = model.recordingStatus === "recording"
    ? state.pauseRecordingBlock
    : model.recordingStatus === "paused"
      ? state.resumeRecordingBlock
      : state.startRecordingBlock;
  return block ? `禁用原因：${block}` : "只录制当前操作员本次主动口述。";
}

export function previewStatusLabel(model: PersonalWechatVoiceAssistModel) {
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

export function previewStageHint(
  model: PersonalWechatVoiceAssistModel,
  state: PersonalWechatVoiceAssistState,
) {
  const block = model.previewStatus === "playing"
    ? state.pausePreviewBlock
    : state.startPreviewBlock;
  if (block) return `禁用原因：${block}`;
  return model.previewListened
    ? "操作员已人工试听；AI 合成语音标识仍不可隐藏。"
    : "必须人工播放试听，不能跳过试听直接审批。";
}

function firstBlock(...reasons: Array<string | false | undefined>) {
  return reasons.find((reason): reason is string => typeof reason === "string" && Boolean(reason));
}
