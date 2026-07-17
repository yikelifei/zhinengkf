"use client";

import { RefreshCw, Route } from "lucide-react";
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

  return (
    <FeaturePage
      id="wechat-work-flow-page"
      title="企业微信接入流程"
      description="只核对服务端返回的回调、入站、路由与发送链路，不混入配置编辑。"
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
      {status ? (
        <section className={styles.panel} aria-labelledby="wechat-work-flow-title">
          <header className={styles.panelHeader}>
            <div>
              <h2 id="wechat-work-flow-title">正式接入链路</h2>
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
