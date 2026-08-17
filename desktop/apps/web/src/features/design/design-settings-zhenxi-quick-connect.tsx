import { ExternalLink, FlaskConical } from "lucide-react";
import type { DesignPlatformCandidateProbeResponse, ZhenxiAiLinks } from "../../lib/api";
import styles from "./design-pages.module.css";

type CandidateProbe = DesignPlatformCandidateProbeResponse["candidates"][number];

export function DesignSettingsZhenxiQuickConnect({
  links,
  adapter,
  baseUrl,
  candidateProbe,
  candidatesLoaded,
  disabled,
  onUseLocal,
  onUseExternal,
}: {
  links: ZhenxiAiLinks;
  adapter: string;
  baseUrl: string;
  candidateProbe: DesignPlatformCandidateProbeResponse | null;
  candidatesLoaded: boolean;
  disabled: boolean;
  onUseLocal: (url: string) => void;
  onUseExternal: (url: string) => void;
}) {
  const candidateUrls = [
    ...new Set([
      ...(links.localCandidateBaseUrls || []),
      ...(candidateProbe?.candidates || []).map((candidate) => candidate.baseUrl),
    ].map(normalizeBaseUrl).filter(Boolean)),
  ];
  const selectedBase = normalizeBaseUrl(baseUrl);
  const recommendedBase = normalizeBaseUrl(candidateProbe?.recommendedBaseUrl || "");
  const probeByUrl = new Map((candidateProbe?.candidates || []).map((candidate) => [normalizeBaseUrl(candidate.baseUrl), candidate]));

  return (
    <div className={styles.endpoint}>
      <strong>臻希 AI 成品软件连接</strong>
      <code>{selectedBase || links.localDevUrl || links.primaryAppUrl}</code>
      <span>正式使用请选择成品 MCP；它只连接已安装并登录的臻希 AI，不调用源码开发版。</span>
      <span>先启动臻希 AI 客户端，再刷新本页并选择 31870-31879 中实际连通的端口。</span>
      {candidatesLoaded ? (
        recommendedBase ? <span>检测到可用臻希 AI 端口：{recommendedBase}。</span> : <span>当前未检测到可用本地端口；请先打开臻希 AI 开发版或桌面端。</span>
      ) : <span>候选端口正在由客服后台探测，不从浏览器直接扫端口。</span>}
      <div className={styles.presetGrid}>
        {candidateUrls.map((url) => {
          const probe = probeByUrl.get(url);
          const selectedLocal = adapter.trim() === "art_image_local" && selectedBase === url;
          const selectedExternal = adapter.trim() === "zhenxi_external" && selectedBase === url;
          const status = candidateStatus(probe, candidatesLoaded, selectedLocal || selectedExternal);
          return (
            <div className={styles.presetGroup} key={url}>
              <button
                type="button"
                className={selectedLocal ? styles.selectedPreset : undefined}
                data-action-id={`design-settings-use-zhenxi-local-${safeActionId(url)}`}
                disabled={disabled}
                onClick={() => onUseLocal(url)}
              >
                <FlaskConical size={15} aria-hidden="true" />
                {selectedLocal ? "正在使用" : "本地模式"} {url}
                <span>{status}</span>
              </button>
              <button
                type="button"
                className={selectedExternal ? styles.selectedPreset : undefined}
                data-action-id={`design-settings-use-zhenxi-external-${safeActionId(url)}`}
                disabled={disabled}
                onClick={() => onUseExternal(url)}
              >
                <FlaskConical size={15} aria-hidden="true" />
                {selectedExternal ? "正在使用" : "成品 MCP"} {url}
                <span>{status}</span>
              </button>
            </div>
          );
        })}
        <a className={styles.endpointLink} href={links.primaryAppUrl} target="_blank" rel="noreferrer" data-action-id="design-settings-open-zhenxi-ai-app">
          <ExternalLink size={16} aria-hidden="true" />打开主应用
        </a>
      </div>
    </div>
  );
}

function candidateStatus(candidate: CandidateProbe | undefined, loaded: boolean, selected: boolean) {
  const prefix = selected ? "当前 · " : "";
  if (!loaded) return `${prefix}待探测`;
  if (!candidate) return `${prefix}未探测`;
  if (candidate.ok) return `${prefix}在线${candidate.latencyMs ? ` · ${candidate.latencyMs}ms` : ""}`;
  return `${prefix}${candidate.errorMessage || "未启动"}`;
}

function normalizeBaseUrl(value: string | undefined) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function safeActionId(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "local";
}
