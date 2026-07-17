"use client";

import { AudioLines, MessageSquareWarning, Settings2, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { MessageSafetyGovernance } from "../message-safety-governance";
import { PersonalWechatControlCenter } from "../personal-wechat-control-center";
import { VoiceAssistCenter } from "../voice-assist-center";
import type { PersonalWechatWorkspaceProps, PersonalWechatWorkspaceView } from "./types";
import styles from "./personal-wechat-workspace.module.css";

const NAVIGATION: Array<{ id: PersonalWechatWorkspaceView; label: string; icon: typeof Users }> = [
  { id: "accounts", label: "账号控制台", icon: Users },
  { id: "voice", label: "语音辅助", icon: AudioLines },
  { id: "safety", label: "发送治理", icon: ShieldCheck },
];

export function PersonalWechatWorkspace({
  accounts,
  tasks,
  updatedAtLabel,
  operatorLabel = "本机管理员",
  organizationLabel = "当前企业",
  busy = false,
  onRefresh,
  onOpenInstanceSettings,
  onOpenTask,
  onStatusMessage,
  fixedView,
  onOpenSafetyPolicy,
}: PersonalWechatWorkspaceProps) {
  const [selectedView, setSelectedView] = useState<PersonalWechatWorkspaceView>("accounts");
  const activeView = fixedView || selectedView;
  const [selectedAccountState, setSelectedAccountState] = useState<string | null>(null);
  const selectedAccountId = accounts.some((account) => account.id === selectedAccountState)
    ? selectedAccountState
    : accounts[0]?.id ?? null;
  const report = (message: string) => onStatusMessage?.(message);
  const pendingTasks = tasks.filter((task) => !["sent", "cancelled"].includes(task.status));
  const unknownTasks = pendingTasks.filter((task) => task.deliveryState === "unknown" || task.status === "uncertain");
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;

  function openView(view: PersonalWechatWorkspaceView) {
    if (fixedView) {
      if (view === "safety") onOpenSafetyPolicy?.();
      return;
    }
    setSelectedView(view);
  }

  const controlAccounts = accounts.map((account) => ({
    id: account.id,
    displayName: account.displayName,
    maskedAccount: account.id,
    avatarFallback: account.displayName.slice(0, 1) || "微",
    state: "offline" as const,
    stateLabel: account.enabled ? "待实时心跳" : "已停用",
    stateDetail: account.enabled
      ? "配置存在，但尚未取得实例在线、窗口和登录身份的实时证据"
      : "该实例已在注册表中停用",
    windowsSessionId: account.windowsSessionId || "unverified",
    windowsSessionLabel: account.windowsSessionId ? `Windows 会话 ${account.windowsSessionId}` : "Windows 会话待探测",
    endpoint: {
      url: account.endpoint || "未配置本机端点",
      state: account.enabled && account.tokenConfigured ? "stale" as const : "unavailable" as const,
      stateLabel: account.enabled && account.tokenConfigured ? "等待心跳" : "不可用",
      lastSeenLabel: account.updatedAt || null,
    },
    windowIdentity: {
      processId: null,
      windowHandle: null,
      title: null,
      verified: false,
      verifiedAtLabel: null,
    },
    pendingApprovalCount: pendingTasks.filter((task) => task.accountId === account.id).length,
    queuedReplyCount: pendingTasks.filter((task) => task.accountId === account.id && task.status === "queued").length,
    lastActivityLabel: account.updatedAt || "暂无实时活动",
  }));

  const approvals = pendingTasks.slice(0, 12).map((task) => ({
    id: task.id,
    accountId: task.accountId,
    customerLabel: task.customerLabel,
    summary: task.summary,
    requestedAtLabel: task.createdAt,
    priorityLabel: task.status === "blocked" ? "已阻断" : "待人工核验",
  }));

  return (
    <section className={styles.workspace} id="personal-wechat-center" aria-labelledby="personal-wechat-workspace-title">
      <header className={styles.header}>
        <div>
          <h2 id="personal-wechat-workspace-title">个人微信协同工作区</h2>
          <p>真实客户端作为独立伴随窗口；本工作区只负责状态、审批、人工接管和审计。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.lockedStatus}><MessageSquareWarning size={14} aria-hidden="true" />真实发送保持关闭</span>
          <button
            type="button"
            data-action-id="integrations.personal-wechat.workspace.open-instance-settings"
            aria-label="打开当前个人微信实例设置"
            onClick={() => onOpenInstanceSettings(selectedAccountId || undefined)}
          >
            <Settings2 size={14} aria-hidden="true" />实例设置
          </button>
        </div>
      </header>

      {!fixedView ? <nav className={styles.tabs} aria-label="个人微信工作区模块">
        {NAVIGATION.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            data-action-id={`integrations.personal-wechat.workspace.view.${id}`}
            aria-label={`打开个人微信${label}`}
            data-active={activeView === id}
            aria-current={activeView === id ? "page" : undefined}
            onClick={() => openView(id)}
          >
            <Icon size={15} aria-hidden="true" />{label}
          </button>
        ))}
      </nav> : null}

      {activeView === "accounts" ? (
        <PersonalWechatControlCenter
          accounts={controlAccounts}
          approvals={approvals}
          selectedAccountId={selectedAccountId}
          globalSendMode="disabled"
          voicePolicy="disabled"
          readOnly
          updatedAtLabel={updatedAtLabel}
          busy={busy}
          actions={{
            onRefresh,
            onSelectAccount: setSelectedAccountState,
            onGlobalSendModeChange: () => report("真实发送只能由服务端重新校验权限、实例身份和窗口证据后启用；本次未执行。"),
            onRequestManualTakeover: (accountId) => report(`账号 ${accountId} 的人工接管需要绑定到具体客户会话；本次未执行。`),
            onReleaseManualTakeover: (accountId) => report(`账号 ${accountId} 的解除接管需要服务端审计；本次未执行。`),
            onIsolateAccount: (accountId) => report(`账号 ${accountId} 的隔离需要有权限的操作员确认；本次未执行。`),
            onRequestReleaseIsolation: (accountId) => report(`账号 ${accountId} 需要重新探测身份后才能申请解除隔离。`),
            onOpenApproval: onOpenTask,
            onOpenSafetyPolicy: () => openView("safety"),
          }}
        />
      ) : null}

      {activeView === "voice" ? (
        <VoiceAssistCenter
          disabled
          model={{
            stage: "record",
            recording: { status: "idle", elapsedSeconds: 0, inputDeviceLabel: "麦克风与 STT 提供商尚未接入", waveform: [] },
            transcript: {
              value: "",
              status: "empty",
              languageLabel: "普通话",
              revisedByOperator: false,
              helperText: "当前只展示安全流程；接入麦克风和 STT 后仍必须人工校对。",
            },
            preview: {
              status: "unavailable",
              authorization: "blocked",
              voiceStyle: "neutral-synthetic",
              voiceLabel: "未配置授权中性音色",
              elapsedSeconds: 0,
              durationSeconds: 0,
            },
            audit: { operatorLabel, lastActionLabel: "语音能力未启用" },
          }}
          actions={{
            onStartRecording: () => report("尚未接入麦克风采集。"),
            onPauseRecording: () => undefined,
            onStopRecording: () => undefined,
            onTranscriptChange: () => undefined,
            onApproveTranscript: () => undefined,
            onStartPreview: () => undefined,
            onPausePreview: () => undefined,
            onStopPreview: () => undefined,
            onApproveVoice: () => undefined,
            onRevokeApproval: () => undefined,
          }}
        />
      ) : null}

      {activeView === "safety" ? (
        <MessageSafetyGovernance
          identity={{
            operatorName: operatorLabel,
            operatorRole: "管理员",
            organizationName: organizationLabel,
            businessPurpose: "回复已主动咨询的客户",
            activeAccountId: selectedAccount?.id || "未选择账号",
          }}
          globallyStopped
          globalStopReason="个人微信真实发送开关关闭；仅允许查看、整理草稿和人工核验。"
          consentRecords={[]}
          accountBudgets={accounts.map((account) => ({
            accountId: account.id,
            accountLabel: account.displayName,
            periodLabel: "未配置业务周期",
            limit: 0,
            used: 0,
            reserved: 0,
            resetAt: "待配置",
            enabled: false,
          }))}
          approvalQueue={pendingTasks.slice(0, 12).map((task) => ({
            id: task.id,
            accountId: task.accountId,
            customerLabel: task.customerLabel,
            contentSummary: task.summary,
            reason: task.status === "blocked" ? "发送安全检查未通过" : "需要人工审批",
            requestedBy: operatorLabel,
            requestedAt: task.createdAt,
            state: "pending" as const,
          }))}
          sensitiveContent={{
            policyVersion: "待接入服务端策略",
            activeRuleCount: 0,
            blockedToday: tasks.filter((task) => task.status === "blocked").length,
            lastEvaluatedAt: updatedAtLabel || "尚未执行",
            protectedCategories: ["付款与退款", "投诉与敏感信息", "陌生客户首次联系"],
          }}
          quarantinedDeliveries={unknownTasks.map((task) => ({
            id: task.id,
            accountId: task.accountId,
            customerLabel: task.customerLabel,
            contentDigest: task.summary,
            reason: "投递状态无法确认，禁止自动重试",
            detectedAt: task.createdAt,
            state: "isolated" as const,
          }))}
          auditEvents={[]}
          busy={busy}
          onRequestGlobalStop={() => report("真实发送已处于关闭状态。")}
          onRequestResume={() => report("恢复发送需要管理员、实例心跳、窗口身份和服务端策略共同通过；本次未执行。")}
          onOpenConsentRecord={() => report("当前没有可用的客户同意凭据记录。")}
          onReviewApproval={onOpenTask}
          onResolveQuarantine={onOpenTask}
          onExportAudit={() => report("当前没有真实审计事件可导出。")}
        />
      ) : null}
    </section>
  );
}
