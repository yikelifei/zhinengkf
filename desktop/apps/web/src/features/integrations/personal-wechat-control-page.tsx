"use client";

import Link from "next/link";
import { RefreshCw, Users } from "lucide-react";
import { getPersonalWechatRpaRegistry } from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function PersonalWechatControlPage() {
  const { data: registry, busy, error, refresh } = useAsyncResource(
    getPersonalWechatRpaRegistry,
    "个人微信账号状态读取失败",
  );

  return (
    <FeaturePage
      id="personal-wechat-control-page"
      title="个人微信账号控制"
      description="只查看当前账号是否可用并进入对应操作页，不再混入发送任务、实例编辑或安全策略。"
      icon={<Users size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.personal-wechat.control.refresh"
          aria-label="刷新个人微信账号控制状态"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新账号
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="个人微信账号状态读取失败">{error}</FeatureNotice> : null}
      <FeatureNotice tone="info" title="控制写操作尚未接入">
        当前没有可信的账号隔离或人工接管写 API，因此本页不显示无效开关；发送继续由服务端身份和窗口校验兜底。
      </FeatureNotice>
      {busy && !registry ? <LoadingState label="正在读取个人微信账号状态" /> : null}
      {!busy && registry && !registry.instances.length ? (
        <EmptyState title="尚未配置个人微信实例" detail="先到实例页新增真实本机端点。" />
      ) : null}
      {registry?.instances.length ? (
        <section className={styles.panel} aria-labelledby="personal-wechat-control-list-title">
          <header className={styles.panelHeader}>
            <div>
              <h2 id="personal-wechat-control-list-title">账号可用状态</h2>
              <p>选择账号后进入独立配置页；本页不执行发送。</p>
            </div>
          </header>
          <div className={styles.controlList}>
            {registry.instances.map((instance) => (
              <article className={styles.controlRow} key={instance.wechatAccountId}>
                <div>
                  <strong>{instance.accountNickname || "未命名微信"}</strong>
                  <span>{instance.wechatAccountId}</span>
                </div>
                <div>
                  <span className={`${styles.statusBadge} ${instance.enabled && instance.tokenConfigured ? styles.statusReady : ""}`}>
                    {instance.enabled && instance.tokenConfigured ? "可进入安全校验" : "不可发送"}
                  </span>
                  <small>{instance.endpoint || "端点未配置"}</small>
                </div>
                <Link
                  className={styles.actionLink}
                  href={`/integrations/personal-wechat/instances/configure?accountId=${encodeURIComponent(instance.wechatAccountId)}`}
                  aria-label={`打开个人微信实例配置 ${instance.accountNickname || instance.wechatAccountId}`}
                >
                  打开实例配置
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <nav className={styles.operationLinks} aria-label="个人微信独立操作页">
        <Link href="/send/queue">发送队列</Link>
        <Link href="/integrations/personal-wechat/window-inbound">窗口证据</Link>
        <Link href="/integrations/personal-wechat/inbound-drill">入站演练</Link>
        <Link href="/integrations/personal-wechat/safety">安全治理</Link>
      </nav>
    </FeaturePage>
  );
}
