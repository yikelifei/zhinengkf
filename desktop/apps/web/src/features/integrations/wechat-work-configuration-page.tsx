"use client";

import { RefreshCw, Settings2 } from "lucide-react";
import { getWechatWorkProductionPreflight } from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function WechatWorkConfigurationPage() {
  const { data: readiness, busy, error, refresh } = useAsyncResource(
    getWechatWorkProductionPreflight,
    "企业微信配置读取失败",
  );

  return (
    <FeaturePage
      id="wechat-work-configuration-page"
      title="企业微信配置"
      description="只核对本机配置、回调地址与固定身份策略；不在浏览器中保存密钥。"
      icon={<Settings2 size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.wechat-work.settings.refresh"
          aria-label="刷新企业微信配置"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新配置
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="企业微信配置读取失败">{error}</FeatureNotice> : null}
      <FeatureNotice tone="info" title="配置由本机安全环境维护">
        当前接口只提供脱敏只读检查；密钥、Token 与 EncodingAESKey 不在前端显示或写入。
      </FeatureNotice>
      {busy && !readiness ? <LoadingState label="正在读取企业微信配置" /> : null}
      {!busy && !readiness ? <EmptyState title="暂无配置检查结果" detail="恢复本机 API 后重新读取。" /> : null}
      {readiness ? (
        <>
          <section className={styles.panel} aria-labelledby="wechat-work-local-config-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="wechat-work-local-config-title">本机配置检查</h2>
                <p>每一项都来自只读预检接口，不由页面猜测。</p>
              </div>
              <span className={`${styles.statusBadge} ${readiness.local.ready ? styles.statusReady : styles.statusDanger}`}>
                {readiness.local.ready ? "本机已就绪" : readinessStatusLabel(readiness.local.status)}
              </span>
            </header>
            <ul className={styles.checkList} aria-label="企业微信本机配置检查">
              {readiness.local.checks.map((check) => (
                <li className={styles.checkItem} key={check.key}>
                  <span><strong>{checkLabel(check.key)}</strong><small>{check.detail}</small></span>
                  <b className={check.status === "ready" ? styles.passedText : styles.failedText}>
                    {readinessStatusLabel(check.status)}
                  </b>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.panel} aria-labelledby="wechat-work-callback-title">
            <h2 id="wechat-work-callback-title">回调与身份约束</h2>
            <dl className={styles.runtimeMeta}>
              <div><dt>回调路径</dt><dd>{readiness.callback.path}</dd></div>
              <div><dt>当前回调地址</dt><dd>{readiness.callback.url || "未配置"}</dd></div>
              <div><dt>账号平台</dt><dd>{readiness.identityPolicy.accountPlatform}</dd></div>
              <div><dt>发送适配器</dt><dd>{readiness.identityPolicy.adapter}</dd></div>
            </dl>
          </section>
        </>
      ) : null}
    </FeaturePage>
  );
}

function readinessStatusLabel(status: string) {
  return ({ ready: "已就绪", blocked: "被阻断", missing: "缺少配置" } as Record<string, string>)[status] || "需检查";
}

function checkLabel(key: string) {
  return ({
    corp_id: "企业 ID",
    customer_service_secret: "微信客服 Secret",
    callback_token: "回调 Token",
    encoding_aes_key: "EncodingAESKey",
    public_callback_url: "公网回调 URL",
    official_api_base_url: "官方 API 基地址",
    official_send_adapter: "正式发送适配器",
    persistence: "账号映射持久化",
  } as Record<string, string>)[key] || key;
}
