"use client";

import Link from "next/link";
import { Plus, RefreshCw, Server } from "lucide-react";
import { getPersonalWechatRpaRegistry, type PersonalWechatRpaInstance } from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function PersonalWechatInstancesPage() {
  const { data: registry, busy, error, refresh } = useAsyncResource(
    getPersonalWechatRpaRegistry,
    "个人微信实例读取失败",
  );
  const readinessErrors = collectReadinessErrors(registry);

  return (
    <FeaturePage
      id="personal-wechat-instances-page"
      title="个人微信实例"
      description="只查看账号、端点、令牌状态与启停结果；新增和修改在独立配置页完成。"
      icon={<Server size={20} />}
      busy={busy}
      actions={(
        <>
          <Link
            className={styles.actionLink}
            href="/integrations/personal-wechat/instances/configure"
            aria-label="进入新增个人微信实例页面"
          >
            <Plus size={15} aria-hidden="true" /> 新增实例
          </Link>
          <button
            type="button"
            data-action-id="integrations.personal-wechat.instances.refresh"
            aria-label="刷新个人微信实例列表"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCw size={15} aria-hidden="true" /> 刷新实例
          </button>
        </>
      )}
    >
      {error ? <FeatureNotice tone="error" title="个人微信实例读取失败">{error}</FeatureNotice> : null}
      {readinessErrors.length ? (
        <FeatureNotice tone="warning" title="实例配置尚未就绪">{readinessErrors.join("；")}</FeatureNotice>
      ) : null}
      {busy && !registry ? <LoadingState label="正在读取个人微信实例" /> : null}
      {!busy && registry && !registry.instances.length ? (
        <EmptyState title="尚未配置个人微信实例" detail="使用“新增实例”进入独立配置页。" />
      ) : null}
      {registry ? (
        <>
          <dl className={styles.summaryGrid} aria-label="个人微信实例摘要">
            <Summary label="启用实例" value={registry.activeCount} />
            <Summary label="停用实例" value={registry.disabledCount} />
            <Summary label="配置模式" value={registryModeLabel(registry.mode)} />
            <Summary label="整体状态" value={registry.ready ? "已就绪" : "待处理"} />
          </dl>
          {registry.instances.length ? (
            <div className={styles.accountList} aria-label="个人微信实例列表">
              {registry.instances.map((instance) => <InstanceRow instance={instance} key={instance.wechatAccountId} />)}
            </div>
          ) : null}
        </>
      ) : null}
    </FeaturePage>
  );
}

function InstanceRow({ instance }: { instance: PersonalWechatRpaInstance }) {
  const instanceErrors = collectInstanceErrors(instance);
  const href = `/integrations/personal-wechat/instances/configure?accountId=${encodeURIComponent(instance.wechatAccountId)}`;
  return (
    <article className={styles.accountRow}>
      <div className={styles.accountIdentity}>
        <strong>{instance.accountNickname || "未命名微信"}</strong>
        <span>{instance.wechatAccountId}</span>
      </div>
      <div className={styles.accountEndpoint}>
        <code>{instance.endpoint || "无有效本机地址"}</code>
        <small>{instance.port ? `端口 ${instance.port}` : "端口未配置"}</small>
      </div>
      <div className={styles.accountState}>
        <span className={`${styles.statusBadge} ${instance.enabled ? styles.statusReady : ""}`}>
          {instance.enabled ? "已启用" : "已停用"}
        </span>
        <small>{instance.tokenConfigured ? "令牌已配置" : "令牌未配置"}</small>
      </div>
      <div className={styles.accountAction}>
        <Link className={styles.actionLink} href={href} aria-label={`配置个人微信实例 ${instance.accountNickname || instance.wechatAccountId}`}>
          配置实例
        </Link>
      </div>
      {instanceErrors.length ? <p className={styles.rowWarning}>{instanceErrors.join("；")}</p> : null}
    </article>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.summaryItem}><dt>{label}</dt><dd>{value}</dd></div>;
}

function collectReadinessErrors(registry: Awaited<ReturnType<typeof getPersonalWechatRpaRegistry>> | null) {
  if (!registry) return [];
  return [...registry.errors, ...registry.checks.filter((check) => !check.ok).map((check) => check.detail)].filter(Boolean);
}

function collectInstanceErrors(instance: PersonalWechatRpaInstance) {
  const errors: string[] = [];
  if (!instance.endpoint) errors.push("本机端点未配置");
  if (!instance.tokenConfigured) errors.push("令牌未配置");
  if (!instance.accountNickname) errors.push("微信昵称未配置");
  return errors;
}

function registryModeLabel(mode: "registry" | "legacy_single" | "unconfigured") {
  return ({ registry: "多实例", legacy_single: "旧版单实例", unconfigured: "未配置" } as const)[mode];
}
