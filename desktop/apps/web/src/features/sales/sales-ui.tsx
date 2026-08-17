import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import type { IdentityExpectation } from "../../lib/api";
import styles from "./sales-pages.module.css";

export function SalesHeader({
  eyebrow,
  title,
  detail,
  actions,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}

export function SalesNotice({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={`${styles.notice} ${styles[`notice-${tone}`]}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      {tone === "success" ? (
        <CheckCircle2 size={16} aria-hidden="true" />
      ) : (
        <AlertTriangle size={16} aria-hidden="true" />
      )}
      <span>{children}</span>
    </div>
  );
}

export function SalesEmpty({
  title,
  detail,
  busy = false,
}: {
  title: string;
  detail: string;
  busy?: boolean;
}) {
  return (
    <div className={styles.empty} role="status" aria-busy={busy || undefined}>
      <RefreshCw size={22} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function SalesMessagePreview({
  title = "客户消息预览",
  message,
  warnings = [],
  loading = false,
  error = "",
}: {
  title?: string;
  message?: string;
  warnings?: string[];
  loading?: boolean;
  error?: string;
}) {
  const content = String(message || "").trim();
  return (
    <div className={styles.messagePreview} role="status" aria-busy={loading || undefined}>
      <strong>{title}</strong>
      {loading ? (
        <p>正在生成客户消息预览...</p>
      ) : error ? (
        <p className={styles.messagePreviewError}>{error}</p>
      ) : content ? (
        <p>{content}</p>
      ) : (
        <p>暂无可发送的客户消息预览。</p>
      )}
      {warnings.length ? (
        <ul className={styles.messagePreviewWarnings} aria-label="消息预览风险提醒">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SalesConfirmation({
  title,
  detail,
  confirmLabel,
  confirmActionId,
  cancelActionId,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  confirmActionId: string;
  cancelActionId: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className={styles.confirmation}
      role="region"
      aria-live="polite"
      aria-labelledby={`${confirmActionId}-title`}
      aria-describedby={`${confirmActionId}-detail`}
    >
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <strong id={`${confirmActionId}-title`}>{title}</strong>
        <p id={`${confirmActionId}-detail`}>{detail}</p>
      </div>
      <div className={styles.confirmationActions}>
        <button
          type="button"
          data-action-id={cancelActionId}
          aria-label="取消当前操作"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={15} aria-hidden="true" />
          取消
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          data-action-id={confirmActionId}
          aria-label={confirmLabel}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "处理中…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function salesError(error: unknown, fallback: string) {
  const detail = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : "";
  return detail ? `${fallback}：${detail}` : fallback;
}

export function money(value: number) {
  return Number.isFinite(value)
    ? `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`
    : "—";
}

export function fulfillmentStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    not_started: "未开始生产",
    in_production: "生产中",
    quality_check: "质检中",
    ready_to_ship: "待发货",
    shipped: "已发货",
    delivered: "已签收",
    blocked: "生产受阻",
  };
  return labels[String(value || "")] || "未记录";
}

export function textOrDash(value?: string | null) {
  const text = String(value || "").trim();
  return text || "—";
}

export function hasCompleteIdentity(expected: IdentityExpectation) {
  return Boolean(
    expected.expectedWechatAccountId
      && expected.expectedConversationId
      && expected.expectedCustomerId,
  );
}

export function identityLabel(expected: IdentityExpectation) {
  return [
    `微信账号 ${expected.expectedWechatAccountId || "缺失"}`,
    `会话 ${expected.expectedConversationId || "缺失"}`,
    `客户 ${expected.expectedCustomerId || "缺失"}`,
  ].join(" · ");
}
