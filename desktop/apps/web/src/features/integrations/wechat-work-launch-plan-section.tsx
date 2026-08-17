"use client";

import type { WechatWorkLaunchPlanItem, WechatWorkProductionReadiness } from "../../lib/api";
import styles from "./integration-pages.module.css";

type WechatWorkLaunchPlan = WechatWorkProductionReadiness["launchPlan"];

export function WechatWorkLaunchPlanSection({ launchPlan }: { launchPlan: WechatWorkLaunchPlan }) {
  return (
    <section className={styles.panel} aria-labelledby="wechat-work-launch-plan-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="wechat-work-launch-plan-title">备案期间准备清单</h2>
          <p>{launchPlan.recommendedNextAction}</p>
        </div>
        <span className={`${styles.statusBadge} ${launchPlan.currentPhase === "production_ready" ? styles.statusReady : ""}`}>
          {phaseLabel(launchPlan.currentPhase)}
        </span>
      </header>
      <div className={styles.planColumns}>
        <LaunchPlanGroup title="备案期间先完成" items={launchPlan.duringIcp} />
        <LaunchPlanGroup title="备案通过后验收" items={launchPlan.afterIcp} />
      </div>
    </section>
  );
}

function LaunchPlanGroup({ title, items }: { title: string; items: WechatWorkLaunchPlanItem[] }) {
  return (
    <section className={styles.planGroup}>
      <h3>{title}</h3>
      <ol>
        {items.map((item) => (
          <li key={item.key}>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <small>{item.action}</small>
            </span>
            <em>{ownerLabel(item.owner)} · {readinessStatusLabel(item.status)}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}

function readinessStatusLabel(status: string) {
  return ({ ready: "已就绪", blocked: "被阻断", missing: "缺少配置" } as Record<string, string>)[status] || "需检查";
}

function phaseLabel(phase: string) {
  return ({
    local_configuring: "本机配置中",
    icp_waiting: "等待备案",
    external_acceptance: "公网验收中",
    production_ready: "可上线",
  } as Record<string, string>)[phase] || "需检查";
}

function ownerLabel(owner: string) {
  return ({
    wechat_admin: "企业微信管理员",
    operator: "运营",
    developer: "开发",
  } as Record<string, string>)[owner] || owner;
}
