import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./design-pages.module.css";

export function DesignPageHeader({ eyebrow, title, detail, actions }: { eyebrow: string; title: string; detail: string; actions?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}

export function DesignNotice({ tone, children }: { tone: "success" | "warning" | "danger"; children: ReactNode }) {
  return (
    <div className={`${styles.notice} ${styles[`notice-${tone}`]}`} role={tone === "danger" ? "alert" : "status"}>
      {tone === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}

export function DesignEmpty({ title, detail, busy = false }: { title: string; detail: string; busy?: boolean }) {
  return (
    <div className={styles.empty} role="status" aria-busy={busy || undefined}>
      <RefreshCw size={22} aria-hidden="true" /><strong>{title}</strong><p>{detail}</p>
    </div>
  );
}

export function DesignConfirmation({
  title,
  detail,
  confirmLabel,
  confirmActionId,
  cancelActionId,
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  confirmActionId: string;
  cancelActionId: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
      <div className={styles.confirmation} role="region" aria-live="polite" aria-labelledby={`${confirmActionId}-title`} aria-describedby={`${confirmActionId}-detail`}>
      <AlertTriangle size={20} aria-hidden="true" />
      <div><strong id={`${confirmActionId}-title`}>{title}</strong><p id={`${confirmActionId}-detail`}>{detail}</p></div>
      <div className={styles.confirmationActions}>
        <button type="button" data-action-id={cancelActionId} aria-label="取消当前操作" disabled={busy} onClick={onCancel}><X size={15} aria-hidden="true" />取消</button>
        <button type="button" className={danger ? styles.dangerButton : styles.primaryButton} data-action-id={confirmActionId} aria-label={confirmLabel} disabled={busy} onClick={onConfirm}>{busy ? "处理中" : confirmLabel}</button>
      </div>
    </div>
  );
}

export function formatDesignDate(value?: string) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function errorText(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  const message = detail ? `${fallback}：${detail}` : fallback;
  const hint = designPlatformActionHint(`${fallback} ${detail}`);
  return hint ? `${message}。${hint}` : message;
}

function designPlatformActionHint(value: string) {
  const text = value.toLowerCase();
  if (!/(设计|臻希|design|zhenxi|formal|activation|device|template|credit|api\s*(401|403)|http\s*(401|403))/.test(text)) {
    return "";
  }
  if (/trusted_local_session|trusted desktop|可信会话/.test(text)) return "";
  if (/device_binding_conflict|device binding conflict|设备.*(冲突|不匹配|已绑定)/.test(text)) {
    return "处理：到 /design/activation 使用当前客服设备 ID 重新激活，或确认臻希 AI 后台的设备绑定";
  }
  if (/activation_required|activation|device.*required|missing device|设备.*(未激活|激活|required|不能为空|缺少)/.test(text)) {
    return "处理：先到 /design/activation 生成或填写设备 ID，并用臻希 AI 管理员激活码完成激活";
  }
  if (/formal_auth_required|unauthorized|not logged in|auth|login|token|cookie|api\s*401|http\s*401|未登录|登录态|凭证/.test(text)) {
    return "处理：设备激活后到 /design/account 登录臻希 AI 账号，再回到当前页面刷新";
  }
  if (/template_access_denied|template|模板/.test(text)) {
    return "处理：在臻希 AI 后台给当前账号开通对应模板权限，再重新预检";
  }
  if (/insufficient|credit|quota|balance|积分|额度|余额/.test(text)) {
    return "处理：在臻希 AI 后台检查账号额度和扣费记录，额度恢复后重新提交";
  }
  if (/api\s*403|http\s*403|forbidden|permission|权限/.test(text)) {
    return "处理：确认当前是臻希智能客服桌面端窗口，并检查操作员权限、设备激活和臻希 AI 登录状态";
  }
  return "";
}
