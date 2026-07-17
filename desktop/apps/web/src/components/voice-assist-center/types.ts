export type VoiceAssistStage = "record" | "review" | "preview" | "approved";

export type OperatorRecordingStatus = "idle" | "recording" | "paused" | "stopped";

export type OperatorRecordingState = {
  status: OperatorRecordingStatus;
  elapsedSeconds: number;
  inputDeviceLabel: string;
  waveform: number[];
};
export type SpeechTranscriptState = {
  value: string;
  status: "empty" | "transcribing" | "draft" | "reviewed" | "error";
  confidence?: number;
  languageLabel: string;
  revisedByOperator: boolean;
  helperText?: string;
};

export type NeutralTtsPreviewState = {
  status: "unavailable" | "ready" | "playing" | "paused" | "stopped" | "approved";
  authorization: "pending" | "authorized" | "blocked";
  voiceStyle: "neutral-synthetic";
  voiceLabel: string;
  elapsedSeconds: number;
  durationSeconds: number;
};

export type VoiceAssistAudit = {
  operatorLabel: string;
  lastActionLabel: string;
  lastActionAt?: string;
};

export type VoiceAssistCenterModel = {
  stage: VoiceAssistStage;
  recording: OperatorRecordingState;
  transcript: SpeechTranscriptState;
  preview: NeutralTtsPreviewState;
  audit: VoiceAssistAudit;
  approvalNote?: string;
};

export type VoiceAssistCenterActions = {
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onStopRecording: () => void;
  onTranscriptChange: (value: string) => void;
  onApproveTranscript: () => void;
  onStartPreview: () => void;
  onPausePreview: () => void;
  onStopPreview: () => void;
  onApproveVoice: () => void;
  onRevokeApproval: () => void;
};

export type VoiceAssistCenterProps = {
  model: VoiceAssistCenterModel;
  actions: VoiceAssistCenterActions;
  disabled?: boolean;
  className?: string;
};
