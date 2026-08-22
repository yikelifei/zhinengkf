"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import {
  createWechatWorkAuthorizationInstallLink,
  getWechatWorkAuthorizationStatus,
  getWechatWorkProductionPreflight,
  type WechatWorkAuthorizationInstallLink,
} from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState, errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";
import { checkLabel, readinessStatusLabel } from "./wechat-work-configuration-labels";
import { WechatWorkAuthorizationPanel } from "./wechat-work-authorization-panel";
import { WechatWorkFirstSetupWizard } from "./wechat-work-first-setup-wizard";

async function loadWechatWorkConfiguration() {
  const [readiness, authorization] = await Promise.all([
    getWechatWorkProductionPreflight(),
    getWechatWorkAuthorizationStatus(),
  ]);
  return { readiness, authorization };
}

export function WechatWorkConfigurationPage() {
  const { data, busy, error, refresh, replace } = useAsyncResource(
    loadWechatWorkConfiguration,
    "企业微信配置读取失败",
  );
  const [creating, setCreating] = useState(false);
  const [install, setInstall] = useState<WechatWorkAuthorizationInstallLink | null>(null);
  const [actionError, setActionError] = useState("");
  const readiness = data?.readiness;
  const authorization = data?.authorization;
  const staticCredentialReady = Boolean(readiness && [
    "corp_id",
    "customer_service_secret",
    "callback_token",
    "encoding_aes_key",
    "open_kfid",
    "official_api_base_url",
    "official_send_adapter",
  ].every((key) => readiness.local.checks.some((check) => check.key === key && check.status === "ready")));
  const providerAuthorizationOptional = authorization?.credentialMode === "static_secret"
    && authorization.activeAuthorizationCount === 0;
  const productionPersistenceReady = Boolean(
    readiness?.local.checks.some((check) => check.key === "persistence" && check.status === "ready"),
  );
  const pendingFlow = authorization?.latestFlow?.status === "pending"
    || authorization?.latestFlow?.status === "exchanging";

  useEffect(() => {
    if (!pendingFlow) return;
    const timer = window.setInterval(() => {
      void getWechatWorkAuthorizationStatus().then((next) => {
        if (data) replace({ ...data, authorization: next });
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [data, pendingFlow, replace]);

  const startAuthorization = useCallback(async () => {
    setCreating(true);
    setActionError("");
    try {
      const next = await createWechatWorkAuthorizationInstallLink();
      setInstall(next);
      window.open(next.installUrl, "_blank", "noopener,noreferrer");
      await refresh();
    } catch (authorizationError) {
      setActionError(errorMessage(authorizationError, "企业微信授权页创建失败"));
    } finally {
      setCreating(false);
    }
  }, [refresh]);

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
      {actionError ? <FeatureNotice tone="error" title="扫码授权未启动">{actionError}</FeatureNotice> : null}
      {readiness && !productionPersistenceReady ? (
        <FeatureNotice tone="warning" title="生产持久化尚未接通">
          <span>当前桌面端使用本地 JSON 保存会话；正式服务器仍需 PostgreSQL、Prisma 迁移和持久化运行证据。</span>
          <Link href="/settings/delivery-readiness">打开生产交付检查</Link>
        </FeatureNotice>
      ) : null}
      <FeatureNotice tone="info" title="配置由本机安全环境维护">
        密钥只从本机安全环境读取，页面不显示任何密钥明文，也不在浏览器保存；启用服务商模式后，suite_ticket 与永久授权码只会加密落盘。
      </FeatureNotice>
      {busy && !data ? <LoadingState label="正在读取企业微信配置" /> : null}
      {!busy && !data ? <EmptyState title="暂无配置检查结果" detail="恢复本机 API 后重新读取。" /> : null}
      {readiness && authorization ? (
        <>
          <WechatWorkFirstSetupWizard
            configurationReady={staticCredentialReady}
            onComplete={async () => { await refresh(); }}
          />
          {staticCredentialReady && authorization.credentialMode === "static_secret" ? (
            <FeatureNotice tone="warning" title="单企业直连参数已填写，尚未证明互通">
              CorpID、Secret 与 OpenKfid 已有值，但只有官方接口检测、真实客户来信和成功回复才能证明互通；下方服务商扫码授权仅用于多企业安装。
            </FeatureNotice>
          ) : null}
          <WechatWorkAuthorizationPanel
            authorization={authorization}
            install={install}
            creating={creating}
            providerAuthorizationOptional={providerAuthorizationOptional}
            onStart={() => void startAuthorization()}
          />
          <section className={styles.panel} aria-labelledby="wechat-work-local-config-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="wechat-work-local-config-title">单企业直连配置检查</h2>
                <p>这里只核对桌面端直连参数；生产服务器持久化与真实收发由生产预检单独验收。</p>
              </div>
              <span className={`${styles.statusBadge} ${
                readiness.local.ready || staticCredentialReady ? styles.statusReady : styles.statusDanger
              }`}>
                {readiness.local.ready
                  ? "本机已就绪"
                  : staticCredentialReady
                    ? "直连配置已完成"
                    : readinessStatusLabel(readiness.local.status)}
              </span>
            </header>
            <ul className={styles.checkList} aria-label="企业微信本机配置检查" data-required-config-key="open_kfid">
              {readiness.local.checks.map((check) => {
                const configured = isDesktopConfigurationCheckReady(check.key, check.status, staticCredentialReady);
                return (
                  <li className={styles.checkItem} key={check.key}>
                    <span>
                      <strong>{check.key === "persistence" ? "桌面本地数据存储" : checkLabel(check.key)}</strong>
                      <small>{desktopConfigurationDetail(check.key, check.detail, configured)}</small>
                      {!configured ? <small>{check.reason}</small> : null}
                      {!configured ? <small>{check.fix}</small> : null}
                    </span>
                    <b className={configured ? styles.passedText : styles.failedText}>
                      {configured ? "已就绪" : readinessStatusLabel(check.status)}
                    </b>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className={styles.panel} aria-labelledby="wechat-work-callback-title">
            <h2 id="wechat-work-callback-title">回调与身份约束</h2>
            <dl className={styles.runtimeMeta}>
              <div><dt>回调路径</dt><dd>{readiness.callback.path}</dd></div>
              <div><dt>当前回调地址</dt><dd>{readiness.callback.url || "未配置"}</dd></div>
              <div><dt>服务商指令回调</dt><dd>{authorization.callbacks.command}</dd></div>
              <div><dt>安装完成回调</dt><dd>{authorization.callbacks.authorization}</dd></div>
              <div><dt>账号平台</dt><dd>{readiness.identityPolicy.accountPlatform}</dd></div>
              <div><dt>发送适配器</dt><dd>{readiness.identityPolicy.adapter}</dd></div>
            </dl>
            <ul className={styles.checkList} aria-label="企业微信后台回调字段">
              {readiness.callback.consoleFields.map((field) => {
                const configured = field.key === "callback_url"
                  ? readiness.callback.publicHttpsFormatReady
                  : field.status === "ready";
                return (
                  <li className={styles.checkItem} key={field.key}>
                    <span>
                      <strong>{field.label}</strong>
                      <small>{field.sourceEnv}</small>
                      {!configured ? <small>{field.detail}</small> : null}
                      {field.copyValue && !field.secret ? <small>{field.copyValue}</small> : null}
                    </span>
                    <b className={configured ? styles.passedText : styles.failedText}>
                      {field.secret
                        ? configured ? "已配置（明文隐藏）" : "缺少配置"
                        : configured ? "已配置" : readinessStatusLabel(field.status)}
                    </b>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}
    </FeaturePage>
  );
}

function isDesktopConfigurationCheckReady(key: string, status: string, staticCredentialReady: boolean) {
  if (key === "persistence") return staticCredentialReady;
  return status === "ready";
}

function desktopConfigurationDetail(key: string, fallback: string, configured: boolean) {
  if (key === "persistence" && configured) {
    return "桌面端本地存储已启用；生产服务器的数据持久化在生产预检中独立核验。";
  }
  if (!configured) return fallback;
  return ({
    corp_id: "企业 ID 已从本机安全环境读取。",
    customer_service_secret: "微信客服 Secret 已从本机安全环境读取，页面不显示明文。",
    callback_token: "回调 Token 已配置，页面不显示明文。",
    encoding_aes_key: "EncodingAESKey 格式正确，页面不显示明文。",
    open_kfid: "客服账号 OpenKfid 已配置。",
    official_api_base_url: "企业微信官方 API HTTPS 地址已配置。",
    official_send_adapter: "正式发送固定使用企业微信客服通道。",
  } as Record<string, string>)[key] || fallback;
}
