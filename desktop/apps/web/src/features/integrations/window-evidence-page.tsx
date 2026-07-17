"use client";

import Link from "next/link";
import { Camera, RefreshCw, ScanLine } from "lucide-react";
import { useState } from "react";
import {
  captureWindowObserverOnce,
  getWechatWindowSnapshots,
  getWindowObserverStatus,
} from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState, errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";
import { useAsyncResource } from "./use-async-resource";

export function WindowEvidencePage() {
  const observer = useAsyncResource(getWindowObserverStatus, "窗口观察器状态读取失败");
  const snapshots = useAsyncResource(getWechatWindowSnapshots, "窗口快照读取失败");
  const [capturing, setCapturing] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [feedback, setFeedback] = useState("");
  const busy = observer.busy || snapshots.busy || capturing;
  const errors = [observer.error, snapshots.error, operationError].filter(Boolean).join("；");

  async function refreshEvidence() {
    await Promise.all([observer.refresh(), snapshots.refresh()]);
  }

  async function captureCurrentWindow() {
    if (busy) return;
    setCapturing(true);
    setOperationError("");
    setFeedback("");
    try {
      const result = await captureWindowObserverOnce();
      const processed = result.scan?.processed?.length ?? 0;
      setFeedback(`窗口采集已完成，入库处理 ${processed} 份真实快照文件。`);
      await refreshEvidence();
    } catch (captureError) {
      setOperationError(errorMessage(captureError, "窗口采集失败"));
    } finally {
      setCapturing(false);
    }
  }

  return (
    <FeaturePage
      id="window-evidence-page"
      title="个人微信窗口证据"
      description="只采集当前真实微信窗口并查看已入库快照；入站写入演练在独立页面完成。"
      icon={<ScanLine size={20} />}
      busy={busy}
      actions={(
        <>
          <Link className={styles.actionLink} href="/integrations/personal-wechat/inbound-drill" aria-label="进入个人微信入站演练页面">
            进入入站演练
          </Link>
          <button
            type="button"
            data-action-id="integrations.window.refresh"
            aria-label="刷新个人微信窗口证据"
            onClick={() => void refreshEvidence()}
            disabled={busy}
          >
            <RefreshCw size={15} aria-hidden="true" /> 刷新证据
          </button>
        </>
      )}
    >
      {errors ? <FeatureNotice tone="error" title="窗口证据读取或采集未完成">{errors}</FeatureNotice> : null}
      {feedback ? <FeatureNotice tone="success" title="窗口采集已完成">{feedback}</FeatureNotice> : null}
      {observer.busy && !observer.data ? <LoadingState label="正在读取窗口观察器" /> : null}
      <section className={styles.panel} aria-labelledby="window-observer-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="window-observer-title">当前观察器</h2>
            <p>只显示本机观察器返回的真实进程、账号与置信度。</p>
          </div>
          <span className={`${styles.statusBadge} ${observer.data?.ok ? styles.statusReady : styles.statusDanger}`}>
            {observer.data ? (observer.data.ok ? "运行正常" : "需要检查") : "无状态"}
          </span>
        </header>
        {observer.data ? (
          <dl className={styles.runtimeMeta}>
            <div><dt>运行状态</dt><dd>{observer.data.status}</dd></div>
            <div><dt>状态年龄</dt><dd>{observer.data.ageSeconds == null ? "未知" : `${observer.data.ageSeconds} 秒`}</dd></div>
            <div><dt>识别账号</dt><dd>{observer.data.result?.wechatAccountId || "未识别"}</dd></div>
            <div><dt>识别置信度</dt><dd>{observer.data.result?.confidence ?? "未提供"}</dd></div>
          </dl>
        ) : <EmptyState title="观察器状态不可用" detail="恢复本机安全服务后再采集窗口。" />}
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="integrations.window.capture-current"
            aria-label="采集当前真实个人微信窗口"
            onClick={() => void captureCurrentWindow()}
            disabled={busy}
          >
            <Camera size={15} aria-hidden="true" /> {capturing ? "采集中" : "采集当前窗口"}
          </button>
        </div>
      </section>
      <section className={styles.panel} aria-labelledby="window-snapshots-title">
        <h2 id="window-snapshots-title">最近入库快照</h2>
        <p>缺少身份的快照不会由前端补齐。</p>
        {snapshots.data?.length ? (
          <ul className={styles.snapshotList}>
            {snapshots.data.slice(0, 8).map((snapshot) => (
              <li className={styles.snapshotItem} key={snapshot.id}>
                <span>
                  <strong>{snapshot.accountDisplayName || snapshot.wechatAccountId || "账号未识别"}</strong>
                  <small>{snapshot.activeChatTitle || snapshot.chatTitle || "聊天对象未识别"}</small>
                </span>
                <span className={snapshot.isOnline ? styles.passedText : styles.failedText}>
                  {snapshot.isOnline ? "在线" : "离线"}
                </span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="暂无真实窗口快照" detail="确认观察器运行后采集当前窗口。" />}
      </section>
    </FeaturePage>
  );
}
