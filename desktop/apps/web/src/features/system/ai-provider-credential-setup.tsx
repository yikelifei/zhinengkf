import { KeyRound, Power } from "lucide-react";
import type { AiProviderStatus } from "../../lib/api";
import styles from "../governance-pages.module.css";

type Provider = AiProviderStatus["providers"][number];

export function AiProviderCredentialSetup({
  providers,
  keyDrafts,
  savingProvider,
  onKeyChange,
  onSave,
  onEnableAllSaved,
  configurationTrusted,
}: {
  providers: Provider[];
  keyDrafts: Record<string, string>;
  savingProvider: string;
  onKeyChange: (provider: string, value: string) => void;
  onSave: (provider: Provider, enabled: boolean) => void;
  onEnableAllSaved: () => void;
  configurationTrusted: boolean;
}) {
  const savingAll = savingProvider === "__all__";
  const savedDisabledProviders = providers.filter((provider) => provider.apiKeyConfigured && !provider.enabled);
  return (
    <section className={styles.panel} aria-labelledby="ai-models-quick-connect-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="ai-models-quick-connect-title">只填密钥，立即接入</h2>
          <p>接口地址、请求协议、默认模型和快速/高质量路由都已预置。密钥只保存在本机私有配置文件中，页面和日志都不会回显。</p>
        </div>
        <div className={styles.buttonRow}>
          <span className={`${styles.badge} ${styles.toneMuted}`}>{providers.length} 个供应商预设</span>
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="ai-models-provider-enable-all-saved"
            onClick={() => onEnableAllSaved()}
            disabled={!configurationTrusted || savingAll || savedDisabledProviders.length === 0}
          >
            <Power size={16} aria-hidden="true" />
            {savingAll ? "正在启用" : "启用全部已保存"}
          </button>
        </div>
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
                    disabled={!configurationTrusted || savingAll || savingProvider === provider.name || (!provider.apiKeyConfigured && !keyDrafts[provider.name]?.trim())}
                  >
                  <KeyRound size={16} aria-hidden="true" />
                  {savingProvider === provider.name ? "正在保存" : provider.apiKeyConfigured ? "更新密钥" : "仅保存密钥"}
                </button>
                {provider.enabled ? (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    data-action-id={`ai-models-provider-${provider.name}-disable`}
                    onClick={() => onSave(provider, false)}
                    disabled={!configurationTrusted || savingAll || savingProvider === provider.name}
                  >
                    停用
                  </button>
                ) : provider.apiKeyConfigured ? (
                  <button
                    type="button"
                    className={styles.button}
                    data-action-id={`ai-models-provider-${provider.name}-enable`}
                    onClick={() => onSave(provider, true)}
                    disabled={!configurationTrusted || savingAll || savingProvider === provider.name}
                  >启用</button>
                ) : null}
                {provider.docsUrl ? <a className={styles.button} href={provider.docsUrl} target="_blank" rel="noreferrer">获取密钥</a> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
