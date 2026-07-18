"use client";

import { Volume2 } from "lucide-react";
import { FeatureNotice, FeaturePage } from "./feature-page";
import styles from "./integration-pages.module.css";
import {
  DEFAULT_PERSONAL_WECHAT_VOICE_ASSIST_MODEL,
  PERSONAL_WECHAT_AI_VOICE_DISCLOSURE,
  derivePersonalWechatVoiceAssistState,
  type PersonalWechatVoiceAssistPageProps,
} from "./personal-wechat-voice-assist-model";
import {
  VoiceApprovalStage,
  VoicePreviewStage,
  VoiceRecordingStage,
  VoiceTranscriptStage,
} from "./personal-wechat-voice-assist-stages";

export {
  DEFAULT_PERSONAL_WECHAT_VOICE_ASSIST_MODEL,
  PERSONAL_WECHAT_AI_VOICE_DISCLOSURE,
} from "./personal-wechat-voice-assist-model";
export type {
  PersonalWechatVoiceAssistActions,
  PersonalWechatVoiceAssistModel,
  PersonalWechatVoiceAssistPageProps,
} from "./personal-wechat-voice-assist-model";

export function PersonalWechatVoiceAssistPage({
  model = DEFAULT_PERSONAL_WECHAT_VOICE_ASSIST_MODEL,
  actions = {},
  enabled = false,
  disabledReason = "语音辅助尚未由管理员明确启用",
}: PersonalWechatVoiceAssistPageProps = {}) {
  const state = derivePersonalWechatVoiceAssistState({
    model,
    actions,
    enabled,
    disabledReason,
  });

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
          <VoiceRecordingStage model={model} actions={actions} state={state} />
          <VoiceTranscriptStage model={model} actions={actions} state={state} />
          <VoicePreviewStage model={model} actions={actions} state={state} />
          <VoiceApprovalStage model={model} actions={actions} state={state} />
        </ol>
      </section>

      <FeatureNotice tone="success" title="审批与发送已物理分离">
        本页不导入发送 API、不创建发送任务，也没有真实发送按钮；审批完成后仍需到独立发送页面重新核对客户、账号和窗口身份。
      </FeatureNotice>
    </FeaturePage>
  );
}
