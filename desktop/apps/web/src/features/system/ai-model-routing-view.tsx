import { Activity, Route, ShieldCheck, Zap } from "lucide-react";
import type { AiProviderStatus } from "../../lib/api";
import styles from "./ai-models-page.module.css";
import { providerLabel, providerStatusText } from "./ai-model-center-utils";

export function AiModelRoutingView({ status }: { status: AiProviderStatus }) {
  const chain = (items: string[]) => items.map((name, index) => (
    <span key={name}>
      <em>{index + 1}</em>
      {providerLabel(name, status)}
    </span>
  ));

  return (
    <div className={styles.globalView}>
      <section className={styles.globalCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2><Route size={16} aria-hidden="true" /> 智能路由规则</h2>
            <p>保留客服原有的快速低成本优先策略，并按实时成功率与延迟自动避让故障服务商。</p>
          </div>
          <span className={`${styles.statusPill} ${status.adaptiveRouting.enabled ? styles.statusPillOk : styles.statusPillMuted}`}>
            {status.adaptiveRouting.enabled ? "自适应路由已启用" : "自适应路由已停用"}
          </span>
        </div>
        <div className={styles.routingGrid}>
          <article className={styles.routingChain}>
            <h3><Zap size={15} aria-hidden="true" /> 快速 / 低成本</h3>
            <p>用于普通咨询和追问，优先考虑响应速度与成本。</p>
            <div>{chain(status.adaptiveRouting.economyOrder)}</div>
          </article>
          <article className={styles.routingChain}>
            <h3><ShieldCheck size={15} aria-hidden="true" /> 复杂 / 高质量</h3>
            <p>用于复杂需求，质量模型异常时仍会回落到可用模型。</p>
            <div>{chain(status.adaptiveRouting.qualityOrder)}</div>
          </article>
        </div>
      </section>

      <section className={styles.globalCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2><Activity size={16} aria-hidden="true" /> 服务商实时表现</h2>
            <p>这里的数据来自真实请求与显式探活；没有样本时不会虚构速度。</p>
          </div>
        </div>
        <div className={styles.routingTable}>
          {status.providers.filter((provider) => provider.enabled).map((provider) => (
            <div key={provider.name}>
              <span className={`${styles.statusDot} ${provider.configured ? styles.dotOk : styles.dotError}`} />
              <strong>{provider.label}</strong>
              <span>{provider.model || "未设置模型"}</span>
              <span>{provider.performance.averageLatencyMs == null ? "暂无延迟样本" : `平均 ${provider.performance.averageLatencyMs}ms`}</span>
              <span>{providerStatusText(provider)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
