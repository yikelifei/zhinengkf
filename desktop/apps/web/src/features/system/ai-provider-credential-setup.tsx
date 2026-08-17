import { KeyRound } from "lucide-react";
import { useState } from "react";
import type { AiProviderStatus } from "../../lib/api";
import styles from "../governance-pages.module.css";

type Provider = AiProviderStatus["providers"][number];

export function AiProviderCredentialSetup({
  providers,
  keyDrafts,
  savingProvider,
  onKeyChange,
  onSave,
  configurationTrusted,
}: {
  providers: Provider[];
  keyDrafts: Record<string, string>;
  savingProvider: string;
  onKeyChange: (provider: string, value: string) => void;
  onSave: (provider: Provider, enabled: boolean) => void;
  configurationTrusted: boolean;
}) {
  const [pendingChange, setPendingChange] = useState<{ provider: Provider; enabled: boolean } | null>(null);
  return (
    <section className={styles.panel} aria-labelledby="ai-models-quick-connect-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="ai-models-quick-connect-title">只填密钥，立即接入</h2>
          <p>接口地址、请求协议、默认模型和快速/高质量路由都已预置。密钥只保存在本机私有配置文件中，页面和日志都不会回显。</p>
        </div>
        <span className={`${styles.badge} ${styles.toneMuted}`}>{providers.length} 个供应商预设</span>
      </header>
      <div className={styles.panelBody}>
        <div className={styles.recordList}>
          {providers.map((provider) => (
            <article className={styles.record} key={`setup-${provider.name}`}>
              <header className={styles.recordHeader}>
                <div>
                  <h3>{provider.label || provider.name}</h3>
                  <p>{provider.description}</p>
                </div>
                <span className={`${styles.badge} ${provider.configured ? styles.toneOk : styles.toneMuted}`}>
                  {provider.configured ? "已接入" : provider.apiKeyConfigured ? "密钥已保存 / 未启用" : "等待密钥"}
                </span>
              </header>
              <div className={styles.recordMeta}>
                <span>{provider.region === "china" ? "国内服务" : provider.region === "global" ? "国际服务" : "聚合路由"}</span>
                <span>{provider.routingTier === "economy" ? "快速模型链" : "高质量模型链"}</span>
                <span>{provider.model}</span>
                <span>{provider.requestFormat === "anthropic" ? "Claude Messages" : "OpenAI Chat"}</span>
              </div>
              <div className={styles.formGrid}>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>API Key</span>
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    value={keyDrafts[provider.name] || ""}
                    placeholder={provider.apiKeyConfigured ? "已安全保存；留空不会覆盖" : `填写 ${provider.label} API Key`}
                    onChange={(event) => onKeyChange(provider.name, event.target.value)}
                    disabled={!configurationTrusted || savingProvider === provider.name}
                  />
                </label>
              </div>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-action-id={`ai-models-provider-${provider.name}-save`}
                  onClick={() => onSave(provider, provider.enabled)}
                  disabled={!configurationTrusted || savingProvider === provider.name || (!provider.apiKeyConfigured && !keyDrafts[provider.name]?.trim())}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  {savingProvider === provider.name ? "正在保存" : provider.apiKeyConfigured ? "更新密钥" : "仅保存密钥"}
                </button>
                {provider.enabled ? (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    data-action-id={`ai-models-provider-${provider.name}-disable`}
                    onClick={() => setPendingChange({ provider, enabled: false })}
                    disabled={!configurationTrusted || savingProvider === provider.name}
                  >
                    请求停用
                  </button>
                ) : provider.apiKeyConfigured ? (
                  <button
                    type="button"
                    className={styles.button}
                    data-action-id={`ai-models-provider-${provider.name}-enable-request`}
                    onClick={() => setPendingChange({ provider, enabled: true })}
                    disabled={!configurationTrusted || savingProvider === provider.name}
                  >请求启用</button>
                ) : null}
                {provider.docsUrl ? <a className={styles.button} href={provider.docsUrl} target="_blank" rel="noreferrer">获取密钥</a> : null}
              </div>
            </article>
          ))}
        </div>
        {pendingChange ? (
          <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="ai-provider-change-confirm-title">
            <strong id="ai-provider-change-confirm-title">确认{pendingChange.enabled ? "启用" : "停用"} {pendingChange.provider.label || pendingChange.provider.name}</strong>
            <p>{pendingChange.enabled
              ? "启用后该供应商会进入既有模型路由并可能承接真实请求；本操作不执行探活，但会改变后续流量去向。"
              : "停用后该供应商不会再承接新请求；正在进行或已经提交的上游请求不会被撤销。"}</p>
            <div className={styles.buttonRow}>
              <button type="button" className={pendingChange.enabled ? styles.primaryButton : styles.dangerButton} data-action-id={`ai-models-provider-${pendingChange.provider.name}-${pendingChange.enabled ? "enable" : "disable"}-confirm`} disabled={!configurationTrusted || savingProvider === pendingChange.provider.name} onClick={() => { if (!configurationTrusted) return; onSave(pendingChange.provider, pendingChange.enabled); setPendingChange(null); }}>确认{pendingChange.enabled ? "启用" : "停用"}</button>
              <button type="button" className={styles.button} data-action-id="ai-models-provider-change-cancel" onClick={() => setPendingChange(null)}>取消</button>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
