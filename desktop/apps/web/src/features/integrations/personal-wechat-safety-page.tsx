"use client";

import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { getPersonalWechatRpaRegistry, getSendTasks, type SendTask } from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function PersonalWechatSafetyPage() {
  const registry = useAsyncResource(getPersonalWechatRpaRegistry, "个人微信实例读取失败");
  const sendTasks = useAsyncResource(getSendTasks, "发送任务读取失败");
  const personalAccountIds = new Set(registry.data?.instances.map((instance) => instance.wechatAccountId) || []);
  const tasks = (sendTasks.data || []).filter((task) => {
    const accountId = task.wechatAccountId;
    return typeof accountId === "string" && personalAccountIds.has(accountId);
  });
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const quarantinedTasks = tasks.filter(isUncertainDelivery);
  const errors = [registry.error, sendTasks.error].filter(Boolean).join("；");
  const busy = registry.busy || sendTasks.busy;

  async function refreshSafetyEvidence() {
    await Promise.all([registry.refresh(), sendTasks.refresh()]);
  }

  return (
    <FeaturePage
      id="personal-wechat-safety-page"
      title="个人微信发送安全"
      description="只审阅阻断与不确定投递证据；发送、实例编辑和治理配置由各自页面负责。"
      icon={<ShieldAlert size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.personal-wechat.safety.refresh"
          aria-label="刷新个人微信发送安全证据"
          onClick={() => void refreshSafetyEvidence()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新安全证据
        </button>
      )}
    >
      {errors ? <FeatureNotice tone="error" title="安全证据读取不完整">{errors}</FeatureNotice> : null}
      <FeatureNotice tone="warning" title="恢复外发保持关闭">
        当前没有客户同意、预算、敏感策略版本或恢复发送写接口；页面不伪造这些能力，不确定投递继续禁止自动重试。
      </FeatureNotice>
      <dl className={styles.summaryGrid} aria-label="个人微信安全摘要">
        <Summary label="启用实例" value={registry.data?.activeCount ?? "—"} />
        <Summary label="被阻断任务" value={blockedTasks.length} />
        <Summary label="隔离投递" value={quarantinedTasks.length} />
        <Summary label="自动重试" value="禁止" />
      </dl>
      <SafetyTaskSection
        id="blocked-send-tasks"
        title="服务端阻断任务"
        detail="身份、人工锁或安全守卫未通过的任务。"
        tasks={blockedTasks}
        emptyTitle="当前没有被阻断任务"
      />
      <SafetyTaskSection
        id="uncertain-send-tasks"
        title="不确定投递隔离"
        detail="缺少明确 ACK 或结果未知的投递，必须人工核对。"
        tasks={quarantinedTasks}
        emptyTitle="当前没有不确定投递"
      />
    </FeaturePage>
  );
}

function SafetyTaskSection({
  id,
  title,
  detail,
  tasks,
  emptyTitle,
}: {
  id: string;
  title: string;
  detail: string;
  tasks: SendTask[];
  emptyTitle: string;
}) {
  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.panelHeader}>
        <div><h2 id={`${id}-title`}>{title}</h2><p>{detail}</p></div>
      </header>
      {tasks.length ? (
        <ul className={styles.safetyTaskList}>
          {tasks.slice(0, 30).map((task) => (
            <li key={task.id}>
              <div>
                <strong>{customerLabel(task)}</strong>
                <span>{taskSummary(task)}</span>
                <small>{task.guardSnapshot?.reason || task.errorMessage || "需要人工核对服务端证据"}</small>
              </div>
              <Link
                className={styles.actionLink}
                href={`/send/blocked?taskId=${encodeURIComponent(task.id)}`}
                aria-label={`查看安全任务 ${task.id}`}
              >
                查看阻断详情
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState title={emptyTitle} detail="页面只展示真实服务端任务。" />}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.summaryItem}><dt>{label}</dt><dd>{value}</dd></div>;
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
