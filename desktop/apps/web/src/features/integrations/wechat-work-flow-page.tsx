"use client";

import { RefreshCw, Route } from "lucide-react";
import {
  CustomerServiceJourney,
  type CustomerServiceJourneyStep,
} from "../../components/customer-service-journey";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState } from "./feature-page";
import { loadWechatChannelStatus } from "./integration-loaders";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function WechatWorkFlowPage() {
  const { data: status, busy, error, refresh } = useAsyncResource(
    loadWechatChannelStatus,
    "企业微信接入流程读取失败",
  );
  const workWechat = status?.channels.find((channel) => channel.key === "work_wechat") || null;
  const conversationCount = Number(workWechat?.metrics.conversations || 0);
  const pendingSendTasks = Number(status?.summary.pendingSendTasks || 0);
  const journeySteps: CustomerServiceJourneyStep[] = [
    {
      id: "customer-entry",
      label: "客户扫码咨询",
      detail: "生成官方客服链接或二维码，让真实测试客户发送第一句话。",
      statusLabel: workWechat ? workWechat.ready ? "入口可用" : "需要配置" : "正在读取",
      tone: workWechat ? workWechat.ready ? "ready" : "danger" : "muted",
      href: "/integrations/wechat-work/customers",
      actionLabel: "客户入口",
    },
    {
      id: "conversation",
      label: "智能客服接待",
      detail: "读取真实身份和历史消息，使用知识库生成有依据的建议回复。",
      statusLabel: status ? conversationCount ? `${conversationCount} 个会话` : "等待首条咨询" : "正在同步",
      tone: status ? conversationCount ? "ready" : "warning" : "muted",
      href: "/integrations/wechat-work/workspace",
      actionLabel: "处理会话",
    },
    {
      id: "solution",
      label: "搭品与设计",
      detail: "从会话需求进入真实 SKU 搭配，再生成绑定当前客户的设计方案。",
      statusLabel: "从会话推进",
      tone: "muted",
      href: "/catalog/bundles",
      actionLabel: "开始搭品",
    },
    {
      id: "review",
      label: "人工审核",
      detail: "核对商品、Logo、数量、价格和候选图，不让高价值动作自动越权。",
      statusLabel: "高价值必审",
      tone: "muted",
      href: "/reviews/inbox",
      actionLabel: "审核中心",
    },
    {
      id: "sales",
      label: "报价与成交",
      detail: "发送核准报价，人工核验付款后创建订单并记录履约事实。",
      statusLabel: "人工确认成交",
      tone: "muted",
      href: "/sales/quotes",
      actionLabel: "销售管理",
    },
    {
      id: "delivery",
      label: "发送与复盘",
      detail: "追踪官方发送回执；服务完成后把有效对话沉淀为知识和 Skill。",
      statusLabel: status ? pendingSendTasks ? `${pendingSendTasks} 个待发送` : "队列已清" : "正在读取",
      tone: status ? pendingSendTasks ? "warning" : "ready" : "muted",
      href: "/send/queue",
      actionLabel: "发送队列",
    },
  ];
  const recommended = !workWechat?.ready
    ? {
        label: "先完成企业微信接入",
        detail: "客服账号、回调和官方发送通道未确认前，不应邀请客户正式使用。",
        href: "/integrations/wechat-work/settings",
        actionLabel: "去配置",
        tone: "danger" as const,
      }
    : !conversationCount
      ? {
          label: "完成首条真实客户咨询",
          detail: "让测试客户扫码并发送第一句话，再确认工作台出现对应会话。",
          href: "/integrations/wechat-work/customers",
          actionLabel: "生成入口",
          tone: "warning" as const,
        }
      : pendingSendTasks
        ? {
            label: `处理 ${pendingSendTasks} 个待发送任务`,
            detail: "检查目标客户、内容和官方回执，不能只确认任务已入队。",
            href: "/send/queue",
            actionLabel: "立即处理",
            tone: "warning" as const,
          }
        : {
            label: "从企业微信会话开始处理客户",
            detail: "当前通道已有真实会话，后续商品、设计、审核和成交都从会话上下文推进。",
            href: "/integrations/wechat-work/workspace",
            actionLabel: "打开工作台",
            tone: "ready" as const,
          };

  return (
    <FeaturePage
      id="wechat-work-flow-page"
      title="企业微信业务流程"
      description="先按客户业务主链路完成接待、方案、审核与成交；下方技术链路只用于核对回调、入站、路由和发送。"
      icon={<Route size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.wechat-work.flow.refresh"
          aria-label="刷新企业微信接入流程"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新流程
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="企业微信流程读取失败">{error}</FeatureNotice> : null}
      {busy && !status ? <LoadingState label="正在读取企业微信接入流程" /> : null}
      {!busy && !status ? <EmptyState title="暂无接入流程" detail="恢复本机 API 后重新读取。" /> : null}
      <CustomerServiceJourney steps={journeySteps} recommended={recommended} busy={busy} />
      {status ? (
        <section className={styles.panel} aria-labelledby="wechat-work-flow-title">
          <header className={styles.panelHeader}>
            <div>
              <h2 id="wechat-work-flow-title">正式接入技术链路</h2>
              <p>{workWechat?.description || "服务端尚未返回企业微信通道说明。"}</p>
            </div>
            <span className={`${styles.statusBadge} ${workWechat?.ready ? styles.statusReady : ""}`}>
              {workWechat?.ready ? "通道已就绪" : "通道待处理"}
            </span>
          </header>
          {status.visualFlow.length ? (
            <ol className={styles.flowList}>
              {status.visualFlow.map((step) => (
                <li key={step.key}><strong>{step.label}</strong><small>{step.detail}</small></li>
              ))}
            </ol>
          ) : <EmptyState title="服务端未返回链路步骤" detail="页面不会补造流程节点。" />}
        </section>
      ) : null}
    </FeaturePage>
  );
}
