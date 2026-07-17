"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { PersonalWechatWorkspace } from "../../components/personal-wechat-workspace";
import {
  getPersonalWechatRpaRegistry,
  getSendTasks,
  type PersonalWechatRpaRegistry,
  type SendTask,
} from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, errorMessage } from "./feature-page";

export type PersonalWechatControlPageProps = {
  operatorLabel?: string;
  organizationLabel?: string;
  onOpenInstances?: (wechatAccountId?: string) => void;
  onOpenSendTask?: (sendTaskId: string) => void;
  onOpenSafetyPolicy?: () => void;
};

export function PersonalWechatControlPage({
  operatorLabel = "可信操作员身份未接入",
  organizationLabel = "组织身份未接入",
  onOpenInstances,
  onOpenSendTask,
  onOpenSafetyPolicy,
}: PersonalWechatControlPageProps) {
  const [registry, setRegistry] = useState<PersonalWechatRpaRegistry | null>(null);
  const [tasks, setTasks] = useState<SendTask[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refreshControl = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    const results = await Promise.allSettled([getPersonalWechatRpaRegistry(), getSendTasks()] as const);
    if (sequence !== requestSequence.current) return;
    const errors: string[] = [];
    if (results[0].status === "fulfilled") setRegistry(results[0].value);
    else errors.push(errorMessage(results[0].reason, "个人微信实例读取失败"));
    if (results[1].status === "fulfilled") setTasks(results[1].value);
    else errors.push(errorMessage(results[1].reason, "发送任务读取失败"));
    setError(errors.join("；"));
    setUpdatedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    setBusy(false);
  }, []);

  useEffect(() => {
    void refreshControl();
    return () => { requestSequence.current += 1; };
  }, [refreshControl]);

  const accounts = (registry?.instances || []).map((instance) => ({
    id: instance.wechatAccountId,
    displayName: instance.accountNickname || instance.wechatAccountId,
    endpoint: instance.endpoint,
    enabled: instance.enabled,
    tokenConfigured: instance.tokenConfigured,
    updatedAt: instance.updatedAt,
  }));
  const workspaceTasks = tasks.map((task) => ({
    id: task.id,
    accountId: task.wechatAccountId,
    customerLabel: task.conversation?.customer?.name || task.conversation?.title || task.conversationId,
    summary: taskSummary(task),
    status: task.status,
    createdAt: task.createdAt,
    deliveryState: deliveryState(task),
  }));

  return (
    <FeaturePage
      id="personal-wechat-control-page"
      title="个人微信账号控制"
      description="只负责实例状态、待处理发送任务和人工接管边界；真实发送保持服务端复核。"
      icon={<Users size={20} />}
      busy={busy}
    >
      {error ? <FeatureNotice tone="error" title="个人微信控制数据不完整">{error}</FeatureNotice> : null}
      {feedback ? <FeatureNotice tone="info" title="操作说明">{feedback}</FeatureNotice> : null}
      <FeatureNotice tone="info" title="控制写操作未接入">
        账号隔离、人工接管和全局发送模式尚无真实写 API，本页将相关控件保持禁用，只允许刷新、选择账号和跳转查看。
      </FeatureNotice>
      <FeatureNotice tone="warning" title="语音能力未接入">
        当前没有真实麦克风采集、STT、授权音色或语音发送 API，本页不提供启动、录制或发送按钮。
      </FeatureNotice>
      {!busy && !accounts.length ? (
        <EmptyState title="尚未配置个人微信实例" detail="请由路由层进入独立的个人微信实例设置页完成真实端点配置。" />
      ) : (
        <PersonalWechatWorkspace
          fixedView="accounts"
          accounts={accounts}
          tasks={workspaceTasks}
          updatedAtLabel={updatedAt}
          operatorLabel={operatorLabel}
          organizationLabel={organizationLabel}
          busy={busy}
          onRefresh={() => void refreshControl()}
          onOpenInstanceSettings={(accountId) => {
            if (onOpenInstances) onOpenInstances(accountId);
            else setFeedback("实例设置已拆为独立页面；请由上层路由连接该页面后再打开。");
          }}
          onOpenTask={(taskId) => {
            if (onOpenSendTask) onOpenSendTask(taskId);
            else setFeedback(`发送任务 ${taskId} 应由上层路由打开独立发送页面；本页未执行发送。`);
          }}
          onOpenSafetyPolicy={() => {
            if (onOpenSafetyPolicy) onOpenSafetyPolicy();
            else setFeedback("发送安全治理已拆为独立页面；请由上层路由连接后查看。");
          }}
          onStatusMessage={setFeedback}
        />
      )}
    </FeaturePage>
  );
}

function taskSummary(task: SendTask) {
  const text = typeof task.payload?.text === "string" ? task.payload.text.trim() : "";
  if (!text) return `发送任务 ${task.id}`;
  return text.length > 96 ? `${text.slice(0, 96)}…` : text;
}

function deliveryState(task: SendTask) {
  if (task.status === "uncertain") return "unknown";
  const attemptStatus = String(task.latestAttempt?.status || task.attempts?.[0]?.status || "").toLowerCase();
  return ["unknown", "uncertain"].includes(attemptStatus) ? "unknown" : attemptStatus || null;
}
