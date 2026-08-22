"use client";

import { CircleAlert, CircleCheck, MonitorUp, RefreshCw, Settings2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesignPlatformCandidates, getDesignPlatformConfig } from "./api";
import {
  configuredLocalZhenxiUrl,
  embeddedBounds,
  embeddedModeLabel,
  isZhenxiReleaseDesktopUrl,
  normalizeLocalZhenxiUrl,
  preferredHealthyLocalUrl,
  type EmbeddedStatus,
} from "./design-zhenxi-embedded-model";
import styles from "./design-zhenxi-workspace-page.module.css";

const BROWSER_EMBED_BOOTSTRAP_URL = "http://127.0.0.1:3710/__smart_kefu_embed_bootstrap";
const BROWSER_EMBED_HEALTH_URL = "http://127.0.0.1:3710/__smart_kefu_embed_health";

type BrowserProxyHealth = {
  ok?: boolean;
  upstreamOk?: boolean;
  sharedSession?: {
    checked?: boolean;
    authenticated?: boolean;
    errorMessage?: string;
  };
};

export function DesignZhenxiWorkspacePage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [embeddedStatus, setEmbeddedStatus] = useState<EmbeddedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [desktopBridgeAvailable, setDesktopBridgeAvailable] = useState<boolean | null>(null);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [browserProxyReady, setBrowserProxyReady] = useState(false);
  const [browserFrameLoaded, setBrowserFrameLoaded] = useState(false);
  const [browserSessionChecked, setBrowserSessionChecked] = useState(false);
  const [browserExternalAuthenticated, setBrowserExternalAuthenticated] = useState(false);
  const [browserEmbedError, setBrowserEmbedError] = useState("");
  const [browserFrameRevision, setBrowserFrameRevision] = useState(0);

  const refreshConnection = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    setConnectionLoaded(false);
    const bridge = window.smartKefu?.zhenxiEmbedded;
    try {
      const [configResult, discovery, candidatesResult] = await Promise.all([
        getDesignPlatformConfig().catch(() => null),
        bridge ? bridge.discoverDesktop().catch(() => ({ ok: false, url: "", checkedCount: 0 })) : null,
        getDesignPlatformCandidates().catch(() => null),
      ]);
      const configuredLocal = configResult ? configuredLocalZhenxiUrl(configResult) : "";
      const discoveredDesktop = normalizeLocalZhenxiUrl(discovery?.url || "");
      const releaseDesktop = discoveredDesktop && isZhenxiReleaseDesktopUrl(discoveredDesktop) ? discoveredDesktop : "";
      const healthyLocal = candidatesResult ? preferredHealthyLocalUrl(candidatesResult) : "";
      const nextUrl = releaseDesktop || healthyLocal || configuredLocal;
      setSelectedUrl(nextUrl);
      if (nextUrl) {
        setNotice("已连接外部臻希 AI 的本机工作台；界面与登录状态都以外部软件为准。");
      } else {
        setError("没有检测到正在运行的臻希 AI。请先打开外部臻希 AI 软件，再重新检测。");
      }
    } catch (cause) {
      setSelectedUrl("");
      setError(cause instanceof Error ? cause.message : "臻希 AI 本机连接读取失败。");
    } finally {
      setConnectionLoaded(true);
      setConnectionRevision((current) => current + 1);
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
    let opening = false;
    const syncBounds = async () => {
      const bounds = embeddedBounds(hostRef.current);
      if (!bounds) return;
      try {
        const nextStatus = await bridge.setBounds(bounds);
        if (!cancelled) setEmbeddedStatus(nextStatus);
      } catch {}
    };
    const open = async () => {
      if (opening) return;
      const bounds = embeddedBounds(hostRef.current);
      if (!bounds) return;
      opening = true;
      try {
        const nextStatus = await bridge.open({ url: selectedUrl, bounds });
        if (!cancelled) setEmbeddedStatus(nextStatus);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "无法打开臻希 AI 本机镜像。");
      } finally {
        opening = false;
      }
    };

    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(hostRef.current);
    window.addEventListener("resize", syncBounds);
    void open();
    const statusTimer = window.setInterval(() => {
      void bridge.status().then((nextStatus) => {
        if (cancelled) return;
        setEmbeddedStatus(nextStatus);
        if (nextStatus.sharedSession.authenticated && (!nextStatus.ok || !nextStatus.attached)) void open();
      }).catch(() => undefined);
    }, 1500);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.clearInterval(statusTimer);
      void bridge.hide().catch(() => undefined);
    };
  }, [connectionRevision, selectedUrl]);

  useEffect(() => {
    if (desktopBridgeAvailable !== false || !selectedUrl) {
      setBrowserProxyReady(false);
      setBrowserFrameLoaded(false);
      setBrowserSessionChecked(false);
      setBrowserExternalAuthenticated(false);
      setBrowserEmbedError("");
      return;
    }

    let cancelled = false;
    const refreshBrowserMirror = async () => {
      try {
        const response = await fetch(BROWSER_EMBED_HEALTH_URL, { cache: "no-store", credentials: "omit" });
        const result = await response.json().catch(() => null) as BrowserProxyHealth | null;
        if (!response.ok || result?.ok !== true || result.upstreamOk !== true) {
          throw new Error("本机臻希 AI 镜像通道未就绪。");
        }
        if (cancelled) return;
        setBrowserProxyReady(true);
        setBrowserSessionChecked(Boolean(result.sharedSession?.checked));
        setBrowserExternalAuthenticated(result.sharedSession?.authenticated === true);
        setBrowserEmbedError("");
        if (result.sharedSession?.authenticated !== true) setBrowserFrameLoaded(false);
      } catch (cause) {
        if (cancelled) return;
        setBrowserProxyReady(false);
        setBrowserSessionChecked(true);
        setBrowserExternalAuthenticated(false);
        setBrowserFrameLoaded(false);
        setBrowserEmbedError(cause instanceof Error ? cause.message : "本机臻希 AI 镜像连接失败。");
      }
    };
    void refreshBrowserMirror();
    const timer = window.setInterval(() => void refreshBrowserMirror(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connectionRevision, desktopBridgeAvailable, selectedUrl]);

  const refreshSharedWorkspace = async () => {
    const bridge = window.smartKefu?.zhenxiEmbedded;
    setBusy(true);
    setError("");
    try {
      if (bridge) {
        let status = await bridge.reload();
        if (status.sharedSession.authenticated && (!status.ok || !status.attached) && hostRef.current && selectedUrl) {
          const bounds = embeddedBounds(hostRef.current);
          if (bounds) status = await bridge.open({ url: selectedUrl, bounds });
        }
        setEmbeddedStatus(status);
      } else if (desktopBridgeAvailable === false) {
        setBrowserFrameLoaded(false);
        setBrowserFrameRevision((current) => current + 1);
      }
      setNotice("已重新读取外部臻希 AI 当前界面与登录状态；不会重新提交生成任务。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜像刷新失败。");
    } finally {
      setBusy(false);
    }
  };

  const serviceOnline = Boolean(selectedUrl);
  const desktopExternalAuthenticated = embeddedStatus?.sharedSession.authenticated === true;
  const externalAuthenticated = desktopBridgeAvailable === false
    ? browserExternalAuthenticated
    : desktopExternalAuthenticated;
  const sharedSessionChecked = desktopBridgeAvailable === false
    ? browserSessionChecked
    : embeddedStatus?.sharedSession.checked === true;
  const browserEmbedReady = Boolean(browserProxyReady && browserExternalAuthenticated && browserFrameLoaded);
  const desktopEmbedReady = Boolean(
    serviceOnline
    && desktopBridgeAvailable
    && embeddedStatus?.ok
    && embeddedStatus.attached
    && !embeddedStatus.loading
    && !embeddedStatus.errorMessage
    && desktopExternalAuthenticated,
  );
  const embeddedReady = desktopEmbedReady || browserEmbedReady;
  const externalLoginRequired = Boolean(connectionLoaded && serviceOnline && sharedSessionChecked && !externalAuthenticated);
  const interfaceMode = browserEmbedReady
    ? "浏览器内置 · 外部会话镜像"
    : embeddedModeLabel(embeddedStatus, desktopBridgeAvailable, serviceOnline);
  const statusLabel = !connectionLoaded || embeddedStatus?.loading
    ? "正在载入"
    : embeddedReady
      ? "外部会话已镜像"
      : externalLoginRequired
        ? "等待外部软件登录"
        : serviceOnline
          ? "正在读取外部状态"
          : "外部软件未连接";

  return (
    <section className={styles.page} aria-labelledby="zhenxi-workspace-title">
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 id="zhenxi-workspace-title">臻希 AI 工作台</h1>
            <span className={styles.status} data-tone={embeddedReady ? "ready" : serviceOnline ? "warning" : "danger"}>
              {embeddedReady ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
              {statusLabel}
            </span>
          </div>
          <p>这里直接镜像本机臻希 AI：外部软件是什么界面、什么账号、什么数据，内置工作台就使用同一份状态。</p>
        </div>
        <div className={styles.actions}>
          <button type="button" data-action-id="zhenxi-workspace-refresh-connection" onClick={() => void refreshConnection()} disabled={busy}>
            <MonitorUp size={15} aria-hidden="true" />重新检测
          </button>
          <button type="button" data-action-id="zhenxi-workspace-refresh-sync" onClick={() => void refreshSharedWorkspace()} disabled={busy || !serviceOnline}>
            <RefreshCw size={15} aria-hidden="true" />刷新镜像
          </button>
          <Link href="/design/settings" data-action-id="zhenxi-workspace-open-settings">
            <Settings2 size={15} aria-hidden="true" />连接状态
          </Link>
        </div>
      </header>

      <div className={styles.syncStrip}>
        <span><b>镜像来源</b> {selectedUrl || "未连接"}</span>
        <span><b>登录来源</b> 外部臻希 AI 软件</span>
        <span><b>共享内容</b> 账号、项目、素材、任务与生成结果</span>
        <span><b>界面模式</b> {interfaceMode}</span>
      </div>

      <div className={styles.feedback}>
        {externalLoginRequired ? (
          <div className={styles.activationNotice} role="status">
            请在外部臻希 AI 软件完成登录。登录成功后，这里会自动读取同一登录状态，不需要在智能客服里再次登录或验证。
          </div>
        ) : null}
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {embeddedStatus?.errorMessage ? <div className={styles.error} role="alert">{embeddedStatus.errorMessage}</div> : null}
      </div>

      <div ref={hostRef} className={styles.embeddedHost} data-embedded-ready={embeddedReady ? "true" : "false"}>
        {!connectionLoaded ? (
          <div className={styles.loadingState} role="status">
            <RefreshCw size={24} aria-hidden="true" />正在连接外部臻希 AI…
          </div>
        ) : !serviceOnline ? (
          <div className={styles.emptyState}>
            <MonitorUp size={34} aria-hidden="true" />
            <h2>请先打开外部臻希 AI 软件</h2>
            <p>智能客服只镜像正在运行的本机臻希 AI，不会切换到另一套云端或独立登录页。</p>
            <button type="button" data-action-id="zhenxi-workspace-retry-connection" onClick={() => void refreshConnection()} disabled={busy}>重新检测</button>
          </div>
        ) : externalLoginRequired ? (
          <div className={styles.emptyState}>
            <CircleAlert size={34} aria-hidden="true" />
            <h2>请在外部臻希 AI 登录</h2>
            <p>外部登录完成后，本页会自动进入同一个工作台；智能客服内不会再要求账号登录或设备验证。</p>
            <button type="button" onClick={() => void refreshSharedWorkspace()} disabled={busy}>我已在外部登录</button>
          </div>
        ) : desktopBridgeAvailable === false && browserEmbedError ? (
          <div className={styles.emptyState} role="alert">
            <CircleAlert size={34} aria-hidden="true" />
            <h2>臻希 AI 本机镜像未就绪</h2>
            <p>{browserEmbedError}</p>
            <button type="button" onClick={() => void refreshConnection()} disabled={busy}>重新连接</button>
          </div>
        ) : desktopBridgeAvailable === false ? (
          <>
            {browserProxyReady && browserExternalAuthenticated ? (
              <iframe
                key={browserFrameRevision}
                className={styles.browserFrame}
                data-action-id="zhenxi-browser-embedded-frame"
                src={BROWSER_EMBED_BOOTSTRAP_URL}
                title="臻希 AI 本机镜像工作台"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => setBrowserFrameLoaded(true)}
              />
            ) : null}
            <div className={styles.loadingState} aria-hidden={browserEmbedReady ? "true" : undefined}>
              <RefreshCw size={24} aria-hidden="true" />正在读取外部臻希 AI 工作台…
            </div>
          </>
        ) : (
          <div className={styles.loadingState} aria-hidden={desktopEmbedReady ? "true" : undefined}>
            <RefreshCw size={24} aria-hidden="true" />正在镜像外部臻希 AI…
          </div>
        )}
      </div>
    </section>
  );
}
