import type { DesignPlatformHealth, DesignPlatformReadiness } from "../../lib/api";
import styles from "./design-pages.module.css";

export function DesignInternalConnectionStatus({
  health,
  readiness,
  recommendedBaseUrl,
}: {
  health: DesignPlatformHealth | null;
  readiness: DesignPlatformReadiness;
  recommendedBaseUrl: string;
}) {
  const ai = recordValue(readiness.data?.ai);
  const imageModel = String(ai?.imageModel || "已配置");
  const serviceUrl = recommendedBaseUrl || readiness.baseUrl;
  const visibleCheckKeys = new Set([
    "design_platform_health",
    "art_image_local_generate",
    "art_image_model",
  ]);
  const visibleChecks = readiness.checks.filter((check) => visibleCheckKeys.has(check.key));

  return (
    <div className={styles.twoColumn} data-view-mode="internal-workspace-status">
      <article className={styles.card}>
        <div className={styles.cardHeader}><div><h2>内置连接正常</h2><p>客服直接使用本机臻希 AI；账号会话和设备授权由内置工作台自动复用。</p></div></div>
        <dl className={styles.factGrid}>
          <div><dt>界面服务</dt><dd>{health?.ok ? "已连接" : "未确认"}</dd></div>
          <div><dt>正式出图</dt><dd>{readiness.canSubmitFormalGeneration ? "可用" : "不可用"}</dd></div>
          <div><dt>图像模型</dt><dd>{imageModel}</dd></div>
          <div><dt>授权方式</dt><dd>本机内部会话</dd></div>
        </dl>
        <div className={styles.endpoint}>
          <strong>当前服务</strong>
          <code>{serviceUrl}</code>
          <span>授权与连接由内置工作台自动管理，无需额外配置。</span>
        </div>
        <div className={styles.actionRow}>
          <a className={styles.endpointLink} href="/design/zhenxi-ai" data-action-id="design-settings-return-workspace">返回臻希 AI 工作台</a>
        </div>
      </article>
      <article className={styles.card}>
        <div className={styles.cardHeader}><div><h2>运行检查</h2><p>只显示会影响内置工作台的必要项目。</p></div></div>
        <ul className={styles.checkList}>
          {visibleChecks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><strong>{check.label}</strong><span>{check.detail}</span></li>)}
        </ul>
      </article>
    </div>
  );
}

export function isInternalWorkspaceReadiness(readiness: DesignPlatformReadiness | null) {
  const runtime = recordValue(readiness?.data?.runtime);
  return runtime?.channel === "internal" && runtime.localWorkspace === true;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
