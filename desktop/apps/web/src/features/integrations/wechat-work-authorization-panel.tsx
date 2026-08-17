"use client";

import { ExternalLink, QrCode } from "lucide-react";
import type {
  WechatWorkAuthorizationInstallLink,
  WechatWorkAuthorizationStatus,
} from "../../lib/api";
import styles from "./integration-pages.module.css";
import {
  authorizationCheckLabel,
  flowStatusLabel,
  formatTime,
} from "./wechat-work-configuration-labels";

type WechatWorkAuthorizationPanelProps = {
  authorization: WechatWorkAuthorizationStatus;
  install: WechatWorkAuthorizationInstallLink | null;
  creating: boolean;
  providerAuthorizationOptional: boolean;
  onStart: () => void;
};

export function WechatWorkAuthorizationPanel({
  authorization,
  install,
  creating,
  providerAuthorizationOptional,
  onStart,
}: WechatWorkAuthorizationPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby="wechat-work-authorization-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="wechat-work-authorization-title">可选：服务商多企业扫码授权</h2>
          <p>仅当需要让多家企业通过官方安装页授权同一服务商应用时启用；单企业直连无需配置 Suite 参数。</p>
        </div>
        <span className={`${styles.statusBadge} ${authorizationBadgeClass(authorization, providerAuthorizationOptional)}`}>
          {authorizationBadgeText(authorization, providerAuthorizationOptional)}
        </span>
      </header>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.primaryButton}
          data-action-id="integrations.wechat-work.authorization.start"
          aria-label="打开企业微信官方扫码授权页"
          onClick={onStart}
          disabled={!authorization.readyForInstall || creating}
        >
          <QrCode size={16} aria-hidden="true" />
          {creating ? "正在生成…" : "打开官方扫码授权页"}
        </button>
        {install ? (
          <a className={styles.actionLink} href={install.installUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden="true" /> 弹窗未打开？点此继续
          </a>
        ) : null}
      </div>
      <ul className={styles.checkList} aria-label="企业微信服务商授权配置检查">
        {authorization.checks.map((check) => (
          <li className={styles.checkItem} key={check.key}>
            <span>
              <strong>{authorizationCheckLabel(check.key)}</strong>
              <small>{check.ok || !providerAuthorizationOptional ? check.detail : "单企业直连模式无需配置"}</small>
            </span>
            <b className={check.ok ? styles.passedText : providerAuthorizationOptional ? "" : styles.failedText}>
              {check.ok ? "已就绪" : providerAuthorizationOptional ? "未启用" : "待配置"}
            </b>
          </li>
        ))}
      </ul>
      {authorization.latestFlow ? (
        <dl className={styles.runtimeMeta}>
          <div><dt>最近授权流程</dt><dd>{flowStatusLabel(authorization.latestFlow.status)}</dd></div>
          <div><dt>流程有效期</dt><dd>{formatTime(authorization.latestFlow.expiresAt)}</dd></div>
        </dl>
      ) : null}
      {authorization.authorizations.length ? (
        <ul className={styles.authorizationList} aria-label="已授权企业">
          {authorization.authorizations.map((item) => (
            <li key={item.corpId}>
              <span><strong>{item.corpName}</strong><small>{item.corpId}</small></span>
              <b className={item.status === "active" ? styles.passedText : styles.failedText}>
                {item.status === "active" ? "授权有效" : "已取消"}
              </b>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function authorizationBadgeClass(
  authorization: WechatWorkAuthorizationStatus,
  optional: boolean,
) {
  if (authorization.activeAuthorizationCount > 0) return styles.statusReady;
  if (authorization.readyForInstall || optional) return "";
  return styles.statusDanger;
}

function authorizationBadgeText(
  authorization: WechatWorkAuthorizationStatus,
  optional: boolean,
) {
  if (authorization.activeAuthorizationCount > 0) return `已授权 ${authorization.activeAuthorizationCount} 家`;
  if (authorization.readyForInstall) return "可发起授权";
  return optional ? "未启用（可选）" : "配置未就绪";
}
