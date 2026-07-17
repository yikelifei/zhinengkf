"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Inbox, RefreshCw, ScanLine } from "lucide-react";
import {
  captureWindowObserverOnce,
  getWechatAccounts,
  getWechatWindowSnapshots,
  getWindowObserverStatus,
  identityExpectation,
  scanWindowSnapshotInbox,
  testWechatChannelInbound,
  type WechatAccount,
  type WechatChannelKey,
  type WechatWindowSnapshot,
  type WindowObserverStatus,
} from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage, LoadingState, errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";

type Operation = "capture" | "scan" | "inbound" | null;

export function WindowInboundOperationsPage() {
  const [observer, setObserver] = useState<WindowObserverStatus | null>(null);
  const [snapshots, setSnapshots] = useState<WechatWindowSnapshot[]>([]);
  const [accounts, setAccounts] = useState<WechatAccount[]>([]);
  const [busy, setBusy] = useState(true);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [channel, setChannel] = useState<WechatChannelKey>("personal_wechat");
  const [wechatAccountId, setWechatAccountId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [text, setText] = useState("");
  const [drillConfirmed, setDrillConfirmed] = useState(false);
  const requestSequence = useRef(0);

  const refreshRuntime = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    const results = await Promise.allSettled([
      getWindowObserverStatus(),
      getWechatWindowSnapshots(),
      getWechatAccounts(),
    ] as const);
    if (sequence !== requestSequence.current) return;

    const errors: string[] = [];
    if (results[0].status === "fulfilled") setObserver(results[0].value);
    else errors.push(errorMessage(results[0].reason, "窗口观察器状态读取失败"));
    if (results[1].status === "fulfilled") setSnapshots(results[1].value);
    else errors.push(errorMessage(results[1].reason, "窗口快照读取失败"));
    if (results[2].status === "fulfilled") setAccounts(results[2].value);
    else errors.push(errorMessage(results[2].reason, "微信账号读取失败"));
    setError(errors.join("；"));
    setBusy(false);
  }, []);

  useEffect(() => {
    void refreshRuntime();
    return () => { requestSequence.current += 1; };
  }, [refreshRuntime]);

  async function runOperation(kind: Exclude<Operation, null>, action: () => Promise<string>) {
    if (operation) return;
    setOperation(kind);
    setError("");
    setFeedback("");
    try {
      const message = await action();
      setFeedback(message);
      await refreshRuntime();
    } catch (operationError) {
      setError(errorMessage(operationError, "操作失败"));
    } finally {
      setOperation(null);
    }
  }

  async function captureCurrentWindow() {
    await runOperation("capture", async () => {
      const result = await captureWindowObserverOnce();
      const processed = result.scan?.processed?.length ?? 0;
      return `窗口采集已完成，入库处理 ${processed} 份真实快照文件。`;
    });
  }

  async function scanSnapshotInbox() {
    await runOperation("scan", async () => {
      const result = await scanWindowSnapshotInbox();
      return `窗口快照收件箱扫描完成：处理 ${result.processed.length}，失败 ${result.failed.length}。`;
    });
  }

  async function runInboundDrill() {
    const identity = {
      wechatAccountId: wechatAccountId.trim(),
      conversationId: conversationId.trim(),
      customerId: customerId.trim(),
    };
    if (!identity.wechatAccountId || !identity.conversationId || !identity.customerId || !text.trim() || !drillConfirmed) {
      setError("执行入站演练前必须填写完整身份、消息内容并确认会写入受控演练记录。");
      return;
    }
    await runOperation("inbound", async () => {
      await testWechatChannelInbound(channel, {
        ...identity,
        ...identityExpectation(identity),
        text: text.trim(),
      });
      setDrillConfirmed(false);
      return "受控入站演练已提交；请到对应会话页核对实际入站记录与身份绑定。";
    });
  }

  const operationBusy = Boolean(operation);
  const drillReady = Boolean(
    wechatAccountId.trim() && conversationId.trim() && customerId.trim() && text.trim() && drillConfirmed,
  );

  return (
    <FeaturePage
      id="window-inbound-operations-page"
      title="窗口采集与入站演练"
      description="只处理真实窗口采集、快照入库和带完整身份的受控入站验证。"
      icon={<ScanLine size={20} />}
      busy={busy || operationBusy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.window.refresh"
          aria-label="刷新窗口采集运行状态"
          onClick={() => void refreshRuntime()}
          disabled={busy || operationBusy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新状态
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="窗口或入站操作未完成">{error}</FeatureNotice> : null}
      {feedback ? <FeatureNotice tone="success" title="操作已完成">{feedback}</FeatureNotice> : null}
      {busy && !observer ? <LoadingState label="正在读取窗口观察器" /> : null}

      <div className={styles.runtimeGrid}>
        <section className={styles.runtimeCard} aria-labelledby="window-observer-card-title">
          <header className={styles.cardHeader}>
            <div><h2 id="window-observer-card-title">当前窗口采集</h2><p>读取本机观察器，不生成错误窗口或离线故障数据。</p></div>
            <span className={`${styles.statusBadge} ${observer?.ok ? styles.statusReady : styles.statusDanger}`}>
              {observer ? (observer.ok ? "运行正常" : "需检查") : "无状态"}
            </span>
          </header>
          {observer ? (
            <dl className={styles.runtimeMeta}>
              <div><dt>运行状态</dt><dd>{observer.status}</dd></div>
              <div><dt>更新时间</dt><dd>{observer.ageSeconds == null ? "未知" : `${observer.ageSeconds} 秒前`}</dd></div>
              <div><dt>账号</dt><dd>{observer.result?.wechatAccountId || "未识别"}</dd></div>
              <div><dt>置信度</dt><dd>{observer.result?.confidence == null ? "未提供" : observer.result.confidence}</dd></div>
            </dl>
          ) : <EmptyState title="观察器状态不可用" detail="恢复本机安全服务后再采集窗口。" />}
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="integrations.window.capture-current"
              aria-label="采集当前真实微信窗口"
              onClick={() => void captureCurrentWindow()}
              disabled={busy || operationBusy}
            >
              <Camera size={15} aria-hidden="true" /> {operation === "capture" ? "采集中" : "采集当前窗口"}
            </button>
            <button
              type="button"
              data-action-id="integrations.window.scan-inbox"
              aria-label="扫描真实窗口快照收件箱"
              onClick={() => void scanSnapshotInbox()}
              disabled={busy || operationBusy}
            >
              <Inbox size={15} aria-hidden="true" /> {operation === "scan" ? "扫描中" : "扫描快照收件箱"}
            </button>
          </div>
        </section>

        <section className={styles.runtimeCard} aria-labelledby="latest-window-snapshots-title">
          <h2 id="latest-window-snapshots-title">最近真实快照</h2>
          <p>仅展示服务端已入库的窗口证据，前端不补齐缺失身份。</p>
          {snapshots.length ? (
            <ul className={styles.snapshotList}>
              {snapshots.slice(0, 6).map((snapshot) => (
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
          ) : <EmptyState title="暂无真实窗口快照" detail="先确认窗口观察器运行，再采集当前窗口。" />}
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="inbound-drill-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="inbound-drill-title">受控入站演练</h2>
            <p>此操作会写入真实演练记录；不预填客户身份，不自动生成示例会话。</p>
          </div>
        </header>
        <div className={styles.formGrid}>
          <label className={styles.field} htmlFor="inbound-drill-channel">
            <span>通道</span>
            <select id="inbound-drill-channel" value={channel} onChange={(event) => setChannel(event.target.value as WechatChannelKey)} disabled={operationBusy}>
              <option value="personal_wechat">个人微信</option>
              <option value="work_wechat">企业微信</option>
              <option value="mini_program">小程序</option>
            </select>
          </label>
          <label className={styles.field} htmlFor="inbound-drill-account">
            <span>微信账号 ID</span>
            <input id="inbound-drill-account" list="inbound-drill-account-options" value={wechatAccountId} onChange={(event) => setWechatAccountId(event.target.value)} autoComplete="off" disabled={operationBusy} />
            <datalist id="inbound-drill-account-options">{accounts.map((account) => <option value={account.id} key={account.id}>{account.displayName}</option>)}</datalist>
          </label>
          <label className={styles.field} htmlFor="inbound-drill-conversation">
            <span>会话 ID</span>
            <input id="inbound-drill-conversation" value={conversationId} onChange={(event) => setConversationId(event.target.value)} autoComplete="off" disabled={operationBusy} />
          </label>
          <label className={styles.field} htmlFor="inbound-drill-customer">
            <span>客户 ID</span>
            <input id="inbound-drill-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} autoComplete="off" disabled={operationBusy} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="inbound-drill-text">
            <span>演练消息内容</span>
            <textarea id="inbound-drill-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} disabled={operationBusy} />
          </label>
          <label className={styles.checkboxField} htmlFor="inbound-drill-confirm">
            <input id="inbound-drill-confirm" type="checkbox" checked={drillConfirmed} onChange={(event) => setDrillConfirmed(event.target.checked)} disabled={operationBusy} />
            <span>我已核对账号、会话和客户身份<small>确认后才允许写入受控入站演练记录；执行结果仍需到对应会话核验。</small></span>
          </label>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="integrations.inbound.run-controlled-drill"
            aria-label="执行已确认身份的受控入站演练"
            onClick={() => void runInboundDrill()}
            disabled={busy || operationBusy || !drillReady}
          >
            <Inbox size={15} aria-hidden="true" /> {operation === "inbound" ? "提交中" : "执行入站演练"}
          </button>
        </div>
      </section>
    </FeaturePage>
  );
}
