"use client";

import { useCallback, useEffect, useState } from "react";
import { OperatorAccessPanel } from "../../components/operator-access-panel";
import {
  getOperatorAccessPolicy,
  getOperatorAccessStatus,
  type OperatorAccessPolicy,
  type OperatorAccessStatus,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

export function AccessPage() {
  const [status, setStatus] = useState<OperatorAccessStatus | null>(null);
  const [policy, setPolicy] = useState<OperatorAccessPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    const [statusResult, policyResult] = await Promise.allSettled([
      getOperatorAccessStatus(),
      getOperatorAccessPolicy(),
    ]);
    const nextStatus = statusResult.status === "fulfilled" ? statusResult.value : null;
    const nextPolicy = policyResult.status === "fulfilled" ? policyResult.value : null;
    setStatus(nextStatus);
    setPolicy(nextPolicy);
    if (!nextStatus || !nextPolicy) {
      const reasons = [statusResult, policyResult]
        .filter((result) => result.status === "rejected")
        .map((result) => result.status === "rejected" && result.reason instanceof Error ? result.reason.message : "服务端状态不可用")
        .filter(Boolean);
      setError(reasons.join("；") || "权限状态或策略读取失败。当前页面保持只读且默认拒绝。");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className={styles.page} aria-labelledby="access-page-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Access</span>
          <h1 id="access-page-title">操作员权限</h1>
          <p className={styles.description}>读取服务端策略、可信身份与执行状态。前端展示不授予任何后端权限。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="access-refresh"
          aria-label="刷新服务端权限状态与策略"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新权限状态
        </button>
      </header>

      <div className={`${styles.notice} ${styles.noticeInfo}`} role="note">
        <strong>只读安全边界</strong>
        <p>本页没有角色修改或能力变更入口，所有业务接口仍由服务端逐项校验。</p>
      </div>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      {status && policy ? (
        <OperatorAccessPanel
          status={status}
          policy={policy}
          readiness={{
            trustedPrincipal: status.trustedPrincipal,
            enforcementReady: status.enforcementReady,
            blockers: status.blockers,
            requiredNextSteps: status.requiredNextSteps,
            reason: status.enforcementReady
              ? "服务端已报告可信身份与执行边界就绪。"
              : "服务端尚未同时确认可信身份与权限执行，本页保持默认拒绝。",
          }}
        />
      ) : (
        <section className={styles.panel} aria-label="权限状态不可用">
          <div className={styles.empty}>尚未取得完整服务端权限状态与策略，不能据此判断任何操作可执行。</div>
        </section>
      )}
    </section>
  );
}
