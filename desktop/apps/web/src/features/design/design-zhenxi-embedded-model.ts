import type { DesignPlatformCandidateProbeResponse, DesignPlatformConfigResponse } from "../../lib/api";

export type EmbeddedBounds = { x: number; y: number; width: number; height: number };
export type EmbeddedStatus = {
  ok: boolean;
  attached: boolean;
  loading: boolean;
  url: string;
  errorMessage: string;
  layout: {
    mode: "desktop";
    zoomFactor: number;
    logicalViewportWidth: number;
  };
  activation: {
    checked: boolean;
    active: boolean;
    reason: string;
    deviceIdSuffix: string;
    errorMessage: string;
  };
};

export type ZhenxiEmbeddedBridge = {
  discoverDesktop(): Promise<{ ok: boolean; url: string; checkedCount: number }>;
  open(payload: { url: string; bounds: EmbeddedBounds }): Promise<EmbeddedStatus>;
  setBounds(bounds: EmbeddedBounds): Promise<EmbeddedStatus>;
  reload(): Promise<EmbeddedStatus>;
  status(): Promise<EmbeddedStatus>;
  hide(): Promise<EmbeddedStatus>;
};

declare global {
  interface Window {
    smartKefu?: {
      notify?: (payload: { title?: string; body?: string }) => Promise<{ ok: boolean }>;
      zhenxiEmbedded?: ZhenxiEmbeddedBridge;
    };
  }
}
export function configuredLocalZhenxiUrl(response: DesignPlatformConfigResponse) {
  const adapter = String(response.config.adapter || "").trim();
  if (adapter !== "art_image_local" && adapter !== "zhenxi_external") return "";
  return normalizeLocalZhenxiUrl(response.config.baseUrl);
}

export function preferredHealthyLocalUrl(response: DesignPlatformCandidateProbeResponse) {
  for (const candidate of response.candidates) {
    const normalized = candidate.ok ? normalizeLocalZhenxiUrl(candidate.baseUrl) : "";
    if (normalized && isZhenxiReleaseDesktopUrl(normalized)) return normalized;
  }
  const recommended = normalizeLocalZhenxiUrl(response.recommendedBaseUrl);
  if (recommended && response.candidates.some((candidate) => candidate.ok && normalizeLocalZhenxiUrl(candidate.baseUrl) === recommended)) {
    return recommended;
  }
  for (const candidate of response.candidates) {
    const normalized = candidate.ok ? normalizeLocalZhenxiUrl(candidate.baseUrl) : "";
    if (normalized) return normalized;
  }
  return "";
}

export function isZhenxiReleaseDesktopUrl(value: string) {
  try {
    const port = Number(new URL(value).port || 80);
    return port >= 31870 && port <= 31879;
  } catch {
    return false;
  }
}

export function normalizeLocalZhenxiUrl(value: string) {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.toLowerCase();
    const port = Number(parsed.port || 80);
    const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
    if (parsed.protocol !== "http:" || !loopback) return "";
    if (port !== 3000 && (port < 31870 || port > 31879)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

export function embeddedBounds(element: HTMLDivElement | null): EmbeddedBounds | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 1 || height < 1) return null;
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width,
    height,
  };
}
