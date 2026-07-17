"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Network, RefreshCw, XCircle } from "lucide-react";
import { getWechatChannelStatus, type WechatChannelStatus } from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState, errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";

export function ChannelsStatusPage() {
  const [status, setStatus] = useState<WechatChannelStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const refreshStatus = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await getWechatChannelStatus();
      if (sequence !== requestSequence.current) return;
      if (!next) throw new Error("未取得微信通道状态，请确认本机 API 已启动后重试。");
      setStatus(next);
    } catch (refreshError) {
      if (sequence !== requestSequence.current) return;
      setError(errorMessage(refreshError, "微信通道状态读取失败"));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    return () => { requestSequence.current += 1; };
  }, [refreshStatus]);

  return (
    <FeaturePage
      id="integration-channels-status-page"
      title="接入通道状态"
      description="只负责查看个人微信、企业微信和小程序的真实接入状态与配置检查。"
      icon={<Network size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.channels.refresh"
          aria-label="刷新接入通道状态"
          onClick={() => void refreshStatus()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新状态
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="通道状态读取失败">{error}</FeatureNotice> : null}
      {busy && !status ? <LoadingState label="正在读取通道状态" /> : null}
      {!busy && !status ? <EmptyState title="暂无通道状态" detail="页面不会用演示数据代替真实结果，请先恢复本机 API。" /> : null}
      {status ? (
        <>
          <dl className={styles.summaryGrid} aria-label="通道状态摘要">
            <Summary label="通道总数" value={status.summary.total} />
            <Summary label="已就绪" value={status.summary.ready} />
            <Summary label="待配置" value={status.summary.needsConfig} />
            <Summary label="待发送任务" value={status.summary.pendingSendTasks} />
          </dl>
          <div className={styles.channelGrid} aria-label="微信通道列表">
            {status.channels.map((channel) => (
              <article className={styles.channelCard} key={channel.key}>
                <header className={styles.cardHeader}>
                  <div><h3>{channel.label}</h3><p>{channel.description}</p></div>
                  <span className={`${styles.statusBadge} ${channel.ready ? styles.statusReady : ""}`}>
                    {channel.ready ? "已就绪" : channelStatusLabel(channel.status)}
                  </span>
                </header>
                <ul className={styles.checkList} aria-label={`${channel.label}配置检查`}>
                  {channel.checks.map((check) => (
                    <li className={styles.checkItem} key={check.key}>
                      <span>
                        <strong>{check.label}</strong>
                        {check.detail ? <small>{check.detail}</small> : null}
                      </span>
                      <b className={check.passed ? styles.passedText : styles.failedText}>
                        {check.passed ? <CheckCircle2 size={15} aria-label="通过" /> : <XCircle size={15} aria-label="未通过" />}
                      </b>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {status.visualFlow.length ? (
            <section className={styles.panel} aria-labelledby="integration-flow-title">
              <h2 id="integration-flow-title">客服接入链路</h2>
              <p>链路只展示服务端返回的真实步骤，不在前端推断通道能力。</p>
              <ol className={styles.flowList}>
                {status.visualFlow.map((step) => <li key={step.key}><strong>{step.label}</strong><small>{step.detail}</small></li>)}
              </ol>
            </section>
          ) : null}
        </>
      ) : null}
    </FeaturePage>
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
