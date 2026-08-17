"use client";

import { CircleAlert, CircleCheck, ExternalLink, MonitorUp, RefreshCw, Settings2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignPlatformCandidateProbeResponse, DesignPlatformConfigResponse } from "../../lib/api";
import { getDesignPlatformCandidates, getDesignPlatformConfig } from "./api";
import { configuredLocalZhenxiUrl, embeddedBounds, isZhenxiReleaseDesktopUrl, normalizeLocalZhenxiUrl, preferredHealthyLocalUrl, type EmbeddedStatus } from "./design-zhenxi-embedded-model";
import styles from "./design-zhenxi-workspace-page.module.css";

export function DesignZhenxiWorkspacePage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [config, setConfig] = useState<DesignPlatformConfigResponse | null>(null);
  const [candidates, setCandidates] = useState<DesignPlatformCandidateProbeResponse | null>(null);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [embeddedStatus, setEmbeddedStatus] = useState<EmbeddedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [desktopBridgeAvailable, setDesktopBridgeAvailable] = useState<boolean | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);

  const refreshConnection = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    setConnectionLoaded(false);
    try {
      const nextConfig = await getDesignPlatformConfig();
      setConfig(nextConfig);
      const configuredLocal = configuredLocalZhenxiUrl(nextConfig);
      const bridge = window.smartKefu?.zhenxiEmbedded;
      const configuredReleaseDesktop = configuredLocal && isZhenxiReleaseDesktopUrl(configuredLocal) ? configuredLocal : "";
      if (configuredReleaseDesktop) setSelectedUrl(configuredReleaseDesktop);

      const discovery = bridge
        ? await bridge.discoverDesktop().catch(() => ({ ok: false, url: "", checkedCount: 0 }))
        : null;
      const discoveredDesktop = normalizeLocalZhenxiUrl(discovery?.url || "");
      if (discoveredDesktop && isZhenxiReleaseDesktopUrl(discoveredDesktop)) {
        setSelectedUrl(discoveredDesktop);
        setNotice("已连接正在运行的臻希 AI 桌面端；客服不再使用手机或平板界面。");
        return;
      }
      if (configuredLocal) setSelectedUrl(configuredLocal);

      try {
        const nextCandidates = await getDesignPlatformCandidates();
        setCandidates(nextCandidates);
        const healthyLocal = preferredHealthyLocalUrl(nextCandidates);
        if (healthyLocal) {
          setSelectedUrl(healthyLocal);
        } else if (configuredLocal) {
          setNotice("候选端口探测暂未完成，已按当前真实设计通道打开臻希 AI。");
        } else {
          setSelectedUrl("");
          setError("没有检测到正在运行的臻希 AI 桌面服务。请先打开臻希 AI，再刷新连接。");
        }
      } catch (cause) {
        setCandidates(null);
        if (configuredLocal) {
          setNotice("候选端口探测较慢，已按当前真实设计通道打开臻希 AI。");
        } else {
          throw cause;
        }
      }
    } catch (cause) {
      setConfig(null);
      setCandidates(null);
      setSelectedUrl("");
      setError(cause instanceof Error ? cause.message : "臻希 AI 连接状态读取失败。");
    } finally {
      setConnectionLoaded(true);
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    const bridge = window.smartKefu?.zhenxiEmbedded;
    setDesktopBridgeAvailable(Boolean(bridge));
    if (!bridge || !selectedUrl || !hostRef.current) {
      setEmbeddedStatus(null);
      return;
    }

    let cancelled = false;
    const syncBounds = async () => {
      const bounds = embeddedBounds(hostRef.current);
      if (!bounds) return;
      try {
        const nextStatus = await bridge.setBounds(bounds);
        if (!cancelled) setEmbeddedStatus(nextStatus);
      } catch {}
    };
    const open = async () => {
      const bounds = embeddedBounds(hostRef.current);
      if (!bounds) return;
      try {
        const nextStatus = await bridge.open({ url: selectedUrl, bounds });
        if (!cancelled) setEmbeddedStatus(nextStatus);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "无法打开内置臻希 AI。");
      }
    };

    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(hostRef.current);
    window.addEventListener("resize", syncBounds);
    void open();
    const statusTimer = window.setInterval(() => {
      void bridge.status().then((nextStatus) => {
        if (!cancelled) setEmbeddedStatus(nextStatus);
      }).catch(() => undefined);
    }, 1500);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.clearInterval(statusTimer);
      void bridge.hide().catch(() => undefined);
    };
  }, [selectedUrl]);

  const refreshSharedWorkspace = async () => {
    const bridge = window.smartKefu?.zhenxiEmbedded;
    if (!bridge) return;
    setBusy(true);
    setError("");
    try {
      const status = await bridge.reload();
      setEmbeddedStatus(status);
      setNotice("已刷新同源工作区；此操作只重新读取项目、素材和结果，不会重新提交生成任务。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同步刷新失败。");
    } finally {
      setBusy(false);
    }
  };

  const serviceOnline = Boolean(selectedUrl);
  const activationRequired = Boolean(embeddedStatus?.activation.checked && !embeddedStatus.activation.active);
  const embeddedReady = Boolean(
    serviceOnline &&
    desktopBridgeAvailable &&
    embeddedStatus?.ok &&
    !embeddedStatus.errorMessage &&
    embeddedStatus.activation.active,
  );
  const primaryAppUrl = config?.config.zhenxiAi?.primaryAppUrl || "https://app.zhenxiai.cloud";

  return (
    <section className={styles.page} aria-labelledby="zhenxi-workspace-title">
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 id="zhenxi-workspace-title">臻希 AI 工作台</h1>
            <span className={styles.status} data-tone={embeddedReady ? "ready" : serviceOnline ? "warning" : "danger"}>
              {embeddedReady ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
              {!connectionLoaded || embeddedStatus?.loading
                ? "正在载入"
                : embeddedReady
                  ? "已激活 · 数据同源"
                  : activationRequired
                    ? "设备待激活"
                  : serviceOnline
                    ? desktopBridgeAvailable === false ? "仅桌面端支持内置" : "服务在线，等待内置视图"
                    : "桌面服务未连接"}
            </span>
          </div>
          <p>直接使用臻希 AI 桌面端的完整界面；固定按桌面视口渲染，不会切换成手机或平板导航。</p>
        </div>
        <div className={styles.actions}>
          <button type="button" data-action-id="zhenxi-workspace-refresh-connection" onClick={() => void refreshConnection()} disabled={busy}>
            <MonitorUp size={15} aria-hidden="true" />刷新连接
          </button>
          <button type="button" data-action-id="zhenxi-workspace-refresh-sync" onClick={() => void refreshSharedWorkspace()} disabled={busy || !embeddedReady}>
            <RefreshCw size={15} aria-hidden="true" />刷新同步
          </button>
          <Link href="/design/settings" data-action-id="zhenxi-workspace-open-settings">
            <Settings2 size={15} aria-hidden="true" />平台配置
          </Link>
        </div>
      </header>

      <div className={styles.syncStrip}>
        <span><b>共享范围</b> 项目、素材、提示词、任务和生成结果</span>
        <span><b>当前服务</b> {selectedUrl || "未连接"}</span>
        <span>
          <b>界面模式</b>{" "}
          {embeddedStatus?.layout.mode === "desktop"
            ? `桌面端 · ${embeddedStatus.layout.logicalViewportWidth}px`
            : "检测中"}
        </span>
        <span>
          <b>设备状态</b>{" "}
          {embeddedStatus?.activation.active
            ? `已激活 · ${embeddedStatus.activation.deviceIdSuffix}`
            : embeddedStatus?.activation.checked
              ? `待激活 · ${embeddedStatus.activation.deviceIdSuffix}`
              : "检测中"}
        </span>
      </div>

      <div className={styles.feedback}>
        {activationRequired ? (
          <div className={styles.activationNotice} role="status">
            已复用臻希桌面设备身份；请在下方内置页面完成一次激活。激活后，独立臻希桌面端与客服会识别为同一台设备。
          </div>
        ) : null}
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {embeddedStatus?.errorMessage ? <div className={styles.error} role="alert">{embeddedStatus.errorMessage}</div> : null}
      </div>

      <div ref={hostRef} className={styles.embeddedHost} data-embedded-ready={embeddedReady ? "true" : "false"}>
        {!connectionLoaded ? (
          <div className={styles.loadingState} role="status">
            <RefreshCw size={24} aria-hidden="true" />正在读取臻希 AI 连接状态…
          </div>
        ) : !serviceOnline ? (
          <div className={styles.emptyState}>
            <MonitorUp size={34} aria-hidden="true" />
            <h2>请先打开臻希 AI 桌面端</h2>
            <p>客服会优先连接成品端口 31870–31879；开发环境可连接 127.0.0.1:3000。</p>
            <button type="button" data-action-id="zhenxi-workspace-retry-connection" onClick={() => void refreshConnection()} disabled={busy}>重新检测</button>
          </div>
        ) : desktopBridgeAvailable === false ? (
          <div className={styles.emptyState}>
            <ExternalLink size={34} aria-hidden="true" />
            <h2>浏览器预览不能承载桌面内置视图</h2>
            <p>请在智能客服桌面端打开本页。也可以暂时在新窗口打开臻希 AI。</p>
            <a href={primaryAppUrl} target="_blank" rel="noreferrer">打开臻希 AI</a>
          </div>
        ) : (
          <div className={styles.loadingState} aria-hidden={embeddedReady ? "true" : undefined}>
            <RefreshCw size={24} aria-hidden="true" />正在安全载入臻希 AI…
          </div>
        )}
      </div>
    </section>
  );
}
