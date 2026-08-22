import { Clipboard, FileKey2, ShieldCheck } from "lucide-react";
import type { AiProviderServerEnvBundle, AiProviderStatus } from "../../lib/api";
import styles from "./ai-models-page.module.css";

type Props = {
  status: AiProviderStatus;
  bundle: AiProviderServerEnvBundle | null;
  busy: boolean;
  trusted: boolean;
  onGenerate: () => void;
  onCopy: () => void;
};

export function AiModelServerView({ status, bundle, busy, trusted, onGenerate, onCopy }: Props) {
  return (
    <div className={styles.globalView}>
      <section className={styles.globalCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2><FileKey2 size={16} aria-hidden="true" /> 服务器密钥文件</h2>
            <p>把桌面端已经保存的供应商配置导出为受保护的 server-ai-provider.env；页面只显示生成结果，不回显任何密钥。</p>
          </div>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primaryButton} data-action-id="ai-models-server-env-generate" onClick={onGenerate} disabled={!trusted || busy}>
              <FileKey2 size={15} aria-hidden="true" /> {busy ? "正在生成" : "生成服务器配置"}
            </button>
            <button type="button" className={styles.secondaryButton} data-action-id="ai-models-server-env-copy" onClick={onCopy} disabled={!bundle?.envText}>
              <Clipboard size={15} aria-hidden="true" /> 复制内容
            </button>
          </div>
        </div>
        <div className={styles.inlineNotice}>
          <strong><ShieldCheck size={14} aria-hidden="true" /> 安全边界</strong>
          <p>密钥只在受保护的本地接口与文件中流转；实时测试和模型同步均不自动重试。</p>
        </div>
        {bundle ? (
          <>
            <div className={styles.metricGrid}>
              <Metric label="配置总数" value={String(bundle.providerCount)} />
              <Metric label="已保存密钥" value={String(bundle.configuredProviderCount)} />
              <Metric label="缺少密钥" value={String(bundle.missingProviders.length)} />
              <Metric label="文件名" value={bundle.fileName} />
            </div>
            <textarea className={styles.envText} rows={14} readOnly value={bundle.envText} aria-label="服务器模型配置" />
          </>
        ) : (
          <div className={styles.emptyState}>当前已识别 {status.providers.length} 个服务商。点击上方按钮后生成服务器配置。</div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>;
}
