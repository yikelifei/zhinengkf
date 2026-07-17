"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { MessageSafetyGovernance } from "../../components/message-safety-governance";
import {
  getPersonalWechatRpaRegistry,
  getSendTasks,
  type PersonalWechatRpaRegistry,
  type SendTask,
} from "../../lib/api";
import { FeatureNotice, FeaturePage, errorMessage } from "./feature-page";

export type PersonalWechatSafetyPageProps = {
  operatorLabel?: string;
  operatorRole?: string;
  organizationLabel?: string;
  businessPurpose?: string;
};

export function PersonalWechatSafetyPage({
  operatorLabel = "可信操作员身份未接入",
  operatorRole = "角色未接入",
  organizationLabel = "组织身份未接入",
  businessPurpose = "业务目的未声明",
}: PersonalWechatSafetyPageProps) {
  const [registry, setRegistry] = useState<PersonalWechatRpaRegistry | null>(null);
  const [tasks, setTasks] = useState<SendTask[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const refreshSafety = useCallback(async () => {
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
    setBusy(false);
  }, []);

  useEffect(() => {
    void refreshSafety();
    return () => { requestSequence.current += 1; };
  }, [refreshSafety]);

  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const quarantinedTasks = tasks.filter(isUncertainDelivery);
  const activeAccountId = registry?.instances.find((instance) => instance.enabled)?.wechatAccountId || "未选择账号";

  return (
    <FeaturePage
      id="personal-wechat-safety-page"
      title="个人微信发送安全治理"
      description="只展示真实实例与发送任务证据；治理写操作在服务端契约接通前保持关闭。"
      icon={<ShieldAlert size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.personal-wechat.safety.refresh"
          aria-label="刷新个人微信发送治理数据"
          onClick={() => void refreshSafety()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新治理数据
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="治理数据读取不完整">{error}</FeatureNotice> : null}
      <FeatureNotice tone="warning" title="治理能力只读且 fail-closed">
        当前 API 未提供客户同意凭据、账号业务预算、敏感策略版本、治理审计导出和恢复发送写接口；这些区域不伪造数据，相关按钮保持禁用。
      </FeatureNotice>
      <MessageSafetyGovernance
        identity={{
          operatorName: operatorLabel,
          operatorRole,
          organizationName: organizationLabel,
          businessPurpose,
          activeAccountId,
        }}
        globallyStopped
        globalStopReason="治理写接口与可信操作员授权尚未接通，本页面禁止恢复外发。"
        consentRecords={[]}
        accountBudgets={[]}
        approvalQueue={blockedTasks.slice(0, 30).map((task) => ({
          id: task.id,
          accountId: task.wechatAccountId,
          customerLabel: customerLabel(task),
          contentSummary: taskSummary(task),
          reason: task.guardSnapshot?.reason || task.errorMessage || "发送任务已被服务端安全守卫阻断",
          requestedBy: "服务端安全守卫",
          requestedAt: task.createdAt,
          state: "pending" as const,
        }))}
        sensitiveContent={{
          policyVersion: "服务端未提供",
          activeRuleCount: null,
          blockedToday: null,
          lastEvaluatedAt: "治理查询接口未接通",
          protectedCategories: [],
        }}
        quarantinedDeliveries={quarantinedTasks.slice(0, 30).map((task) => ({
          id: task.id,
          accountId: task.wechatAccountId,
          customerLabel: customerLabel(task),
          contentDigest: taskSummary(task),
          reason: "投递状态不确定，禁止自动重试",
          detectedAt: task.latestAttempt?.completedAt || task.latestAttempt?.createdAt || task.createdAt,
          state: "isolated" as const,
        }))}
        auditEvents={[]}
        busy={busy}
        readOnly
        onRequestGlobalStop={() => undefined}
        onRequestResume={() => undefined}
        onOpenConsentRecord={() => undefined}
        onReviewApproval={() => undefined}
        onResolveQuarantine={() => undefined}
        onExportAudit={() => undefined}
      />
    </FeaturePage>
  );
}

function customerLabel(task: SendTask) {
  return task.conversation?.customer?.name || task.conversation?.title || task.conversationId;
}

function taskSummary(task: SendTask) {
  const text = typeof task.payload?.text === "string" ? task.payload.text.trim() : "";
  return text ? (text.length > 96 ? `${text.slice(0, 96)}…` : text) : `发送任务 ${task.id}`;
}

function isUncertainDelivery(task: SendTask) {
  if (task.status === "uncertain") return true;
  const status = String(task.latestAttempt?.status || task.attempts?.[0]?.status || "").toLowerCase();
  return status === "unknown" || status === "uncertain";
}
