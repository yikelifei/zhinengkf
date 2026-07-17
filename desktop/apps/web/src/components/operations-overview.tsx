"use client";

import {
  AlertTriangle,
  Bot,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Clock3,
  Gauge,
  MessageCircle,
  Radio,
  RefreshCw,
} from "lucide-react";
import styles from "./operations-overview.module.css";

export type OverviewTone = "ready" | "warning" | "danger" | "muted";

export type OverviewChannel = {
  id: string;
  label: string;
  detail: string;
  statusLabel: string;
  tone: OverviewTone;
  metrics?: string;
};

export type OverviewAction = {
  id: string;
  label: string;
  detail: string;
  count?: number;
  tone: OverviewTone;
  onClick: () => void;
};

export type OverviewMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone?: OverviewTone;
};

export type OverviewConversation = {
  id: string;
  customer: string;
  channel: string;
  account: string;
  state: string;
  stateTone: OverviewTone;
  preview: string;
  updatedAt: string;
  unreadCount: number;
  onOpen: () => void;
};

export type OperationsOverviewProps = {
  updatedAt?: string;
  channels: OverviewChannel[];
  actions: OverviewAction[];
  metrics: OverviewMetric[];
  conversations: OverviewConversation[];
  automationLabel: string;
  automationDetail: string;
  automationTone: OverviewTone;
  onRefresh: () => void;
  onOpenConversations: () => void;
  onOpenChannels: () => void;
  onRunAutomation: () => void;
  busy?: boolean;
};

const toneIcon = {
  ready: CircleCheck,
  warning: Clock3,
  danger: AlertTriangle,
  muted: CircleDot,
} as const;

export function OperationsOverview({
  updatedAt,
  channels,
  actions,
  metrics,
  conversations,
  automationLabel,
  automationDetail,
  automationTone,
  onRefresh,
  onOpenConversations,
  onOpenChannels,
  onRunAutomation,
  busy = false,
}: OperationsOverviewProps) {
  const pendingCount = actions.reduce((sum, item) => sum + Number(item.count || 0), 0);

  return (
    <section
      className={styles.page}
      id="overview-center"
      aria-labelledby="operations-overview-title"
      aria-busy={busy}
    >
      <header className={styles.pageHeader}>
        <div className={styles.headingLine}>
          <h1 id="operations-overview-title">运营总览</h1>
          <span>实时运营态势</span>
        </div>
        <div className={styles.headerActions}>
          {updatedAt ? <time dateTime={updatedAt}>更新于 {formatOverviewTime(updatedAt)}</time> : null}
          <button type="button" onClick={onRefresh} disabled={busy} aria-label="刷新运营总览">
            <RefreshCw size={15} aria-hidden="true" />
            <span>刷新</span>
          </button>
        </div>
      </header>

      <div className={styles.priorityGrid}>
        <article className={styles.panel} aria-labelledby="overview-channel-title">
          <div className={styles.panelHeader}>
            <div>
              <Radio size={16} aria-hidden="true" />
              <h3 id="overview-channel-title">渠道状态</h3>
            </div>
            <button type="button" className={styles.linkButton} onClick={onOpenChannels}>
              管理接入<ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.channelList}>
            {channels.length ? channels.map((channel) => {
              const ToneIcon = toneIcon[channel.tone];
              return (
                <div className={styles.channelRow} key={channel.id}>
                  <span className={`${styles.channelIcon} ${styles[channel.tone]}`}>
                    <ToneIcon size={15} aria-hidden="true" />
                  </span>
                  <span className={styles.channelCopy}>
                    <strong>{channel.label}</strong>
                    <small>{channel.detail}</small>
                  </span>
                  {channel.metrics ? <span className={styles.channelMetrics}>{channel.metrics}</span> : null}
                  <span className={`${styles.state} ${styles[channel.tone]}`}>{channel.statusLabel}</span>
                </div>
              );
            }) : (
              <div className={styles.inlineEmpty}>尚未取得渠道状态，刷新后再试。</div>
            )}
          </div>
        </article>

        <article className={styles.panel} aria-labelledby="overview-actions-title">
          <div className={styles.panelHeader}>
            <div>
              <AlertTriangle size={16} aria-hidden="true" />
              <h3 id="overview-actions-title">待处理事项</h3>
            </div>
            <span aria-live="polite">{pendingCount} 项</span>
          </div>
          <div className={styles.actionList}>
            {actions.length ? actions.map((action) => {
              const ToneIcon = toneIcon[action.tone];
              return (
                <button
                  type="button"
                  className={styles.actionRow}
                  key={action.id}
                  onClick={action.onClick}
                  disabled={busy}
                >
                  <span className={`${styles.actionIcon} ${styles[action.tone]}`}>
                    <ToneIcon size={15} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.detail}</small>
                  </span>
                  {action.count ? <b className={styles.actionCount}>{action.count}</b> : null}
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              );
            }) : (
              <div className={styles.inlineSuccess}>
                <CircleCheck size={17} aria-hidden="true" />当前没有必须立即处理的异常。
              </div>
            )}
          </div>
        </article>
      </div>

      <div className={styles.insightGrid}>
        <article className={`${styles.panel} ${styles.metricPanel}`} aria-labelledby="overview-metrics-title">
          <div className={styles.panelHeader}>
            <div>
              <Gauge size={16} aria-hidden="true" />
              <h3 id="overview-metrics-title">实时运营指标</h3>
            </div>
          </div>
          {metrics.length ? (
            <div className={styles.metricGrid} aria-label="实时运营指标">
              {metrics.map((metric) => (
                <div className={styles.metric} key={metric.id}>
                  <span>{metric.label}</span>
                  <strong className={metric.tone ? styles[metric.tone] : undefined}>{metric.value}</strong>
                  <small>{metric.detail}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.inlineEmpty}>暂无可展示的运营指标。</div>
          )}
        </article>

        <article className={`${styles.panel} ${styles.automationPanel}`} aria-labelledby="overview-automation-title">
          <div className={styles.panelHeader}>
            <div>
              <Bot size={16} aria-hidden="true" />
              <h3 id="overview-automation-title">自动化与训练</h3>
            </div>
          </div>
          <div className={styles.automationBody}>
            <span className={`${styles.automationIcon} ${styles[automationTone]}`}>
              <Bot size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{automationLabel}</strong>
              <small>{automationDetail}</small>
            </div>
            <button type="button" onClick={onRunAutomation} disabled={busy}>
              查看自动化<ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>

      <article className={`${styles.panel} ${styles.conversationPanel}`} aria-labelledby="overview-conversations-title">
        <div className={styles.panelHeader}>
          <div>
            <MessageCircle size={16} aria-hidden="true" />
            <h3 id="overview-conversations-title">最近会话</h3>
          </div>
          <button type="button" className={styles.linkButton} onClick={onOpenConversations}>
            全部会话<ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        {conversations.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th scope="col">客户</th>
                  <th scope="col">渠道与账号</th>
                  <th scope="col">当前状态</th>
                  <th scope="col">最后消息</th>
                  <th scope="col">更新时间</th>
                  <th scope="col"><span className={styles.srOnly}>操作</span></th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conversation) => (
                  <tr key={conversation.id}>
                    <td data-label="客户">
                      <strong>{conversation.customer}</strong>
                      {conversation.unreadCount ? <b className={styles.unread}>{conversation.unreadCount}</b> : null}
                    </td>
                    <td data-label="渠道与账号"><span>{conversation.channel}</span><small>{conversation.account}</small></td>
                    <td data-label="当前状态"><span className={`${styles.state} ${styles[conversation.stateTone]}`}>{conversation.state}</span></td>
                    <td data-label="最后消息" className={styles.preview}>{conversation.preview || "暂无消息摘要"}</td>
                    <td data-label="更新时间">{conversation.updatedAt}</td>
                    <td>
                      <button type="button" className={styles.tableAction} onClick={conversation.onOpen}>
                        打开<ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <MessageCircle size={22} aria-hidden="true" />
            <strong>还没有客户会话</strong>
            <span>完成微信通道接入后，新会话会出现在这里。</span>
            <button type="button" onClick={onOpenChannels}>检查微信接入</button>
          </div>
        )}
      </article>
    </section>
  );
}

function formatOverviewTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
