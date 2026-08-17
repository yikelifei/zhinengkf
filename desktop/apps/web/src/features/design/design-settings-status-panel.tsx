import type {
  DesignPlatformCandidateProbeResponse,
  DesignPlatformConfigResponse,
  DesignPlatformHealth,
  DesignPlatformReadiness,
  DesignPlatformSmokeTestResult,
} from "../../lib/api";
import styles from "./design-pages.module.css";
import { DesignSettingsZhenxiQuickConnect } from "./design-settings-zhenxi-quick-connect";

export function DesignSettingsStatusPanel({
  config,
  configLoaded,
  health,
  healthLoaded,
  readiness,
  readinessLoaded,
  candidateProbe,
  candidatesLoaded,
  adapter,
  baseUrl,
  controlsDisabled,
  isArtImageLocal,
  smoke,
  onUseLocal,
  onUseExternal,
}: {
  config: DesignPlatformConfigResponse | null;
  configLoaded: boolean;
  health: DesignPlatformHealth | null;
  healthLoaded: boolean;
  readiness: DesignPlatformReadiness | null;
  readinessLoaded: boolean;
  candidateProbe: DesignPlatformCandidateProbeResponse | null;
  candidatesLoaded: boolean;
  adapter: string;
  baseUrl: string;
  controlsDisabled: boolean;
  isArtImageLocal: boolean;
  smoke: DesignPlatformSmokeTestResult | null;
  onUseLocal: (url: string) => void;
  onUseExternal: (url: string) => void;
}) {
  const activeAdapter = (adapter || readiness?.adapter || config?.config.adapter || "").trim();
  const isZhenxiExternal = activeAdapter === "zhenxi_external";
  const isZhenxiDurable = isArtImageLocal || isZhenxiExternal;
  return (
    <div className={styles.stack}>
      <article className={styles.card}>
        <div className={styles.cardHeader}><div><h2>实时状态</h2><p>来自独立健康与就绪接口。</p></div></div>
        <dl className={styles.factGrid}>
          <div><dt>健康</dt><dd>{healthLoaded && health ? (health.ok ? "正常" : "异常") : "未确认"}</dd></div>
          <div><dt>延迟</dt><dd>{healthLoaded && health ? `${health.latencyMs} ms` : "—"}</dd></div>
          <div><dt>正式提交</dt><dd>{readinessLoaded && readiness ? (readiness.canSubmitFormalGeneration ? "允许" : "不允许") : "未确认"}</dd></div>
          <div><dt>适配器</dt><dd>{readinessLoaded && readiness ? readiness.adapter : configLoaded && config ? config.config.adapter : "未确认"}</dd></div>
          <div><dt>{isZhenxiExternal ? "认证方式" : "API Key"}</dt><dd>{isZhenxiExternal ? "复用臻希登录会话" : configLoaded && config ? (config.config.hasApiKey ? "已配置" : "未配置") : "未确认"}</dd></div>
          <div><dt>{isZhenxiDurable ? "完成方式" : "回调签名"}</dt><dd>{isArtImageLocal ? "本地同步" : isZhenxiExternal ? "MCP：先文案后流式出图" : configLoaded && config ? (config.config.hasCallbackApiKey ? "已配置" : "未配置") : "未确认"}</dd></div>
          <div><dt>设备绑定</dt><dd>{configLoaded && config ? (config.config.hasDeviceId ? `已绑定${config.config.deviceIdSuffix ? ` · ${config.config.deviceIdSuffix}` : ""}` : "未绑定") : "未确认"}</dd></div>
        </dl>
        {configLoaded && config?.config.callbackUrl && !isZhenxiDurable ? <div className={styles.endpoint}><strong>出图完成回调地址</strong><code>{config.config.callbackUrl}</code><span>真实设计平台完成或失败后 POST 到这里；轮询仍会继续兜底。</span></div> : null}
        {isArtImageLocal ? <div className={styles.endpoint}><strong>臻希 AI 本地模式</strong><code>{baseUrl || readiness?.baseUrl || config?.config.baseUrl || "http://127.0.0.1:3000"}</code><span>客服会把本地商品图和搭配图上传到臻希 AI，再通过持久化设计任务同步调用出图；该模式不需要企业微信备案，也不需要配置设计平台 callback。</span></div> : null}
        {isZhenxiExternal ? <div className={styles.endpoint}><strong>臻希 AI 成品软件 MCP 模式</strong><code>{baseUrl || readiness?.baseUrl || config?.config.baseUrl || "http://127.0.0.1:31870"}</code><span>客服通过内置 MCP 复用臻希 AI 当前登录会话，先生成文案，再上传参考图并流式生成图片；不会回退到旧外部 API。</span></div> : null}
        {configLoaded && config?.config.zhenxiAi ? <DesignSettingsZhenxiQuickConnect links={config.config.zhenxiAi} adapter={adapter} baseUrl={baseUrl} candidateProbe={candidateProbe} candidatesLoaded={candidatesLoaded} disabled={controlsDisabled} onUseLocal={onUseLocal} onUseExternal={onUseExternal} /> : null}
        {readinessLoaded && readiness?.checks.length ? <ul className={styles.checkList}>{readiness.checks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><strong>{check.label}</strong><span>{check.detail}</span>{check.action ? <span>{check.action}</span> : null}</li>)}</ul> : <p className={styles.muted}>{readinessLoaded ? "读取成功，未返回就绪检查明细。" : "就绪检查明细尚未成功读取。"}</p>}
      </article>
      {smoke ? <article className={styles.card}><div className={styles.cardHeader}><div><h2>最近联通测试</h2><p>{smoke.requestId} · {smoke.status}</p></div></div><dl className={styles.factGrid}><div><dt>候选图</dt><dd>{smoke.candidateCount}</dd></div><div><dt>已保存</dt><dd>{smoke.savedImageCount}</dd></div><div><dt>素材上传</dt><dd>{smoke.assetUploadCount}</dd></div><div><dt>耗时</dt><dd>{smoke.latencyMs} ms</dd></div></dl></article> : null}
    </div>
  );
}
