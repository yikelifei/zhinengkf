"use client";

import Link from "next/link";
import { Inbox, ScanSearch } from "lucide-react";
import { useState } from "react";
import {
  scanBridgeInbox,
  scanSendOperations,
  type IdentityFilters,
} from "../../lib/api";
import { SendNotice, SendPageFrame, errorMessage } from "./send-page-frame";
import { SendConfirmation } from "./send-task-card";
import styles from "./send-pages.module.css";

type Operation = "bridge" | "anomalies" | "";

export function SendDiagnosticsOperationsPage({ filters = {} }: { filters?: IdentityFilters }) {
  const [operation, setOperation] = useState<Operation>("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  async function run(kind: Exclude<Operation, "">, action: () => Promise<string>) {
    if (operation) return;
    setOperation(kind);
    setError("");
    setFeedback("");
    try {
      setFeedback(await action());
    } catch (caught) {
      setError(errorMessage(caught, "诊断操作失败"));
    } finally {
      setOperation("");
    }
  }

  async function scanBridgeAcknowledgements() {
    await run("bridge", async () => {
      const result = await scanBridgeInbox();
      return "企业微信发送回执扫描完成：处理 " + result.processed.length + "，失败 " + result.failed.length + "。";
    });
  }

  async function confirmAnomalyScan() {
    setConfirmationOpen(false);
    await run("anomalies", async () => {
      const result = await scanSendOperations({
        wechatAccountId: filters.wechatAccountId,
        conversationId: filters.conversationId,
        customerId: filters.customerId,
      });
      return "发送异常扫描完成：扫描 " + result.scanned + "，回执超时 " + result.bridgeTimedOut
        + "，队列滞留 " + result.staleQueued + "，已告警 " + result.alerted + "。";
    });
  }

  const busy = Boolean(operation);
  return (
    <SendPageFrame
      id="send-diagnostics-operations-page"
      title="发送诊断操作"
      description="只运行企业微信发送链路的回执入库与异常扫描；回调、入站与发送链路在企业微信接入流程核对。"
      icon={<ScanSearch size={20} />}
      busy={busy}
      actions={<Link className={styles.secondaryLink} href="/send/diagnostics">返回只读诊断</Link>}
    >
      {error ? <SendNotice tone="error" title="诊断操作未完成">{error}</SendNotice> : null}
      {feedback ? <SendNotice tone="success" title="诊断操作已完成">{feedback}</SendNotice> : null}
      <SendNotice tone="info" title="企业微信链路由接入页负责">
        <Link href="/integrations/wechat-work/flow">前往企业微信接入流程核对回调与发送链路</Link>
      </SendNotice>

      {confirmationOpen ? (
        <SendConfirmation
          actionIdPrefix="send.diagnostics.scan-operations"
          title="确认扫描发送异常"
          detail="扫描可能依据真实回执与超时规则更新任务阻断和告警状态，但不会创建任务或主动发送消息。"
          confirmLabel="确认扫描发送异常"
          busy={busy}
          onConfirm={() => void confirmAnomalyScan()}
          onCancel={() => setConfirmationOpen(false)}
        />
      ) : null}

      <section className={styles.panel} aria-labelledby="send-receipts-title">
        <header className={styles.panelHeader}>
          <div><h2 id="send-receipts-title">企业微信发送回执入库</h2><p>读取发送适配器回执并更新对应发送尝试。</p></div>
          <button
            type="button"
            data-action-id="send.diagnostics.scan-bridge-inbox"
            aria-label="扫描企业微信发送回执收件箱"
            onClick={() => void scanBridgeAcknowledgements()}
            disabled={busy}
          >
            <Inbox size={15} aria-hidden="true" />{operation === "bridge" ? "扫描中" : "扫描发送回执"}
          </button>
        </header>
      </section>

      <section className={styles.panel} aria-labelledby="send-anomaly-scan-title">
        <header className={styles.panelHeader}>
          <div><h2 id="send-anomaly-scan-title">异常状态扫描</h2><p>依据服务端超时规则识别回执超时、队列滞留和告警。</p></div>
          <button
            className={styles.primaryButton}
            type="button"
            data-action-id="send.diagnostics.request-scan-operations"
            aria-label="请求扫描真实发送异常"
            onClick={() => setConfirmationOpen(true)}
            disabled={busy}
          >
            <ScanSearch size={15} aria-hidden="true" />扫描发送异常
          </button>
        </header>
      </section>
    </SendPageFrame>
  );
}
