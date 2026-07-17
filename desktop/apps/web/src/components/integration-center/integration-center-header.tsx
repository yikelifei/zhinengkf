"use client";

import { Network, RefreshCw } from "lucide-react";
import styles from "./integration-center-header.module.css";

export type IntegrationCenterView = "channels" | "flow" | "config";

export type IntegrationSummaryItem = {
  id: string;
  label: string;
  value: string | number;
  tone?: "default" | "ready" | "warning" | "danger";
};

type IntegrationCenterHeaderProps = {
  activeView: IntegrationCenterView;
  summary: IntegrationSummaryItem[];
  busy?: boolean;
  onViewChange: (view: IntegrationCenterView) => void;
  onRefresh: () => void;
};

const views: Array<{ value: IntegrationCenterView; label: string }> = [
  { value: "channels", label: "接入通道" },
  { value: "flow", label: "客服链路" },
  { value: "config", label: "配置检查" },
];

export function IntegrationCenterHeader({
  activeView,
  summary,
  busy = false,
  onViewChange,
  onRefresh,
}: IntegrationCenterHeaderProps) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.titleIcon} aria-hidden="true">
            <Network size={18} />
          </span>
          <div>
            <h2>微信接入中心</h2>
            <p>个人微信、企业微信和小程序统一接入客服管线</p>
          </div>
        </div>

        <div className={styles.views} role="group" aria-label="微信接入中心视图">
          {views.map((view) => (
            <button
              type="button"
              className={activeView === view.value ? styles.selected : undefined}
              aria-pressed={activeView === view.value}
              key={view.value}
              onClick={() => onViewChange(view.value)}
            >
              {view.label}
            </button>
          ))}
        </div>

        <button type="button" className={styles.refresh} onClick={onRefresh} disabled={busy}>
          <RefreshCw size={14} aria-hidden="true" />
          刷新状态
        </button>
      </header>

      <dl className={styles.summary} aria-label="微信接入摘要">
        {summary.map((item) => (
          <div className={item.tone ? styles[item.tone] : undefined} key={item.id}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
