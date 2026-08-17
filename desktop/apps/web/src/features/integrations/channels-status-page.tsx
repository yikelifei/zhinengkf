"use client";

import Link from "next/link";
import { Network, RefreshCw } from "lucide-react";
import { type WechatChannelKey } from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState } from "./feature-page";
import { loadWechatChannelStatus } from "./integration-loaders";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

const CHANNEL_DESTINATIONS: Partial<Record<WechatChannelKey, { href: string; label: string }>> = {
  work_wechat: { href: "/integrations/wechat-work", label: "进入企业微信预检" },
};

export function ChannelsStatusPage() {
  const { data: status, busy, error, refresh } = useAsyncResource(
    loadWechatChannelStatus,
    "微信通道状态读取失败",
  );
  const enterpriseChannels = status?.channels.filter((channel) => channel.key === "work_wechat") || [];
  const enterpriseSummary = status
    ? {
        total: enterpriseChannels.length,
        ready: enterpriseChannels.filter((channel) => channel.ready).length,
        needsConfig: enterpriseChannels.filter((channel) => channel.status === "needs_config").length,
        degraded: enterpriseChannels.filter((channel) => ["needs_runtime", "needs_send_adapter"].includes(channel.status)).length,
      }
    : null;

  return (
    <FeaturePage
      id="integration-channels-status-page"
      title="接入通道状态"
      description="只汇总企业微信官方客服通道的真实状态，并导航到企业微信预检和配置页面。"
      icon={<Network size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.channels.refresh"
          aria-label="刷新接入通道状态"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新状态
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="通道状态读取失败">{error}</FeatureNotice> : null}
      {busy && !status ? <LoadingState label="正在读取通道状态" /> : null}
      {!busy && !status ? <EmptyState title="暂无通道状态" detail="页面不会用演示数据代替真实结果，请先恢复本机 API。" /> : null}
      {enterpriseSummary ? (
        <>
          <dl className={styles.summaryGrid} aria-label="通道状态摘要">
            <Summary label="通道总数" value={enterpriseSummary.total} />
            <Summary label="已就绪" value={enterpriseSummary.ready} />
            <Summary label="待配置" value={enterpriseSummary.needsConfig} />
            <Summary label="异常或降级" value={enterpriseSummary.degraded} />
          </dl>
          <div className={styles.channelList} aria-label="微信通道列表">
            {enterpriseChannels.map((channel) => (
              <article className={styles.channelRow} key={channel.key}>
                <div className={styles.channelIdentity}>
                  <div><h2>{channel.label}</h2><p>{channel.description}</p></div>
                  <span className={`${styles.statusBadge} ${channel.ready ? styles.statusReady : ""}`}>
                    {channel.ready ? "已就绪" : channelStatusLabel(channel.status)}
                  </span>
                </div>
                <ChannelDestination channelKey={channel.key} label={channel.label} />
              </article>
            ))}
          </div>
        </>
      ) : null}
    </FeaturePage>
  );
}

function ChannelDestination({ channelKey, label }: { channelKey: WechatChannelKey; label: string }) {
  const destination = CHANNEL_DESTINATIONS[channelKey];
  if (!destination) {
    return <span className={styles.unavailableAction}>尚无独立操作页</span>;
  }
  return (
    <Link className={styles.actionLink} href={destination.href} aria-label={`${destination.label}：${label}`}>
      {destination.label}
    </Link>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.summaryItem}><dt>{label}</dt><dd>{value}</dd></div>;
}

function channelStatusLabel(status: string) {
  return ({
    needs_runtime: "待运行环境",
    needs_send_adapter: "待发送适配器",
    needs_config: "待配置",
  } as Record<string, string>)[status] || "需检查";
}
