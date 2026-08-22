"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, KeyRound, LoaderCircle } from "lucide-react";
import { useState } from "react";
import {
  saveWechatWorkCustomerServiceCredential,
  validateWechatWorkCustomerServiceSecret,
  type WechatWorkCredentialSaveResult,
  type WechatWorkCredentialValidation,
} from "../../lib/api";
import { errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";

type Props = {
  configurationReady: boolean;
  onComplete: () => Promise<void> | void;
};

export function WechatWorkFirstSetupWizard({ configurationReady, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(configurationReady ? 3 : 1);
  const [corpId, setCorpId] = useState("");
  const [secret, setSecret] = useState("");
  const [callbackToken, setCallbackToken] = useState("");
  const [encodingAesKey, setEncodingAesKey] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [enableAutomaticReplies, setEnableAutomaticReplies] = useState(false);
  const [validation, setValidation] = useState<WechatWorkCredentialValidation | null>(null);
  const [selectedOpenKfid, setSelectedOpenKfid] = useState("");
  const [saved, setSaved] = useState<WechatWorkCredentialSaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function validateEnterprise() {
    setBusy(true);
    setError("");
    try {
      const result = await validateWechatWorkCustomerServiceSecret(secret, corpId);
      setValidation(result);
      setSelectedOpenKfid(result.suggestedOpenKfid || result.accounts[0]?.openKfid || "");
      setStep(2);
    } catch (reason) {
      setValidation(null);
      setError(errorMessage(reason, "CorpID 与自建应用 Secret 验证失败"));
    } finally {
      setBusy(false);
    }
  }

  async function saveSetup() {
    if (!validation || !selectedOpenKfid) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveWechatWorkCustomerServiceCredential(secret, selectedOpenKfid, {
        corpId,
        callbackToken,
        encodingAesKey,
        publicBaseUrl: publicBaseUrl.trim() || undefined,
        enableAutomaticReplies,
      });
      setSaved(result);
      setSecret("");
      setCallbackToken("");
      setEncodingAesKey("");
      setStep(3);
      await onComplete();
    } catch (reason) {
      setError(errorMessage(reason, "首次企业配置保存失败"));
    } finally {
      setBusy(false);
    }
  }

  function restartWizard() {
    setValidation(null);
    setSaved(null);
    setSelectedOpenKfid("");
    setError("");
    setStep(1);
  }

  return (
    <section className={`${styles.panel} ${styles.setupWizard}`} aria-labelledby="wechat-work-first-setup-title" data-first-setup-wizard>
      <header className={styles.panelHeader}>
        <div>
          <h2 id="wechat-work-first-setup-title">首次企业配置向导</h2>
          <p>按顺序验证企业身份、绑定微信客服账号，再保存回调和自动回复设置。密钥只写入本机私有配置文件。</p>
        </div>
        <span className={`${styles.statusBadge} ${configurationReady ? styles.statusReady : styles.statusWarning}`}>
          {configurationReady ? "本机配置已保存" : `第 ${step} 步 / 3`}
        </span>
      </header>

      <ol className={styles.setupSteps} aria-label="首次企业配置进度">
        {([
          [1, "验证企业"],
          [2, "绑定与回调"],
          [3, "完成检查"],
        ] as const).map(([number, label]) => (
          <li key={number} data-active={step === number} data-complete={step > number || (number === 3 && configurationReady)}>
            <b>{number}</b><span>{label}</span>
          </li>
        ))}
      </ol>

      {error ? (
        <div className={`${styles.validation} ${styles.validationError}`} role="alert">
          <CircleAlert size={17} aria-hidden="true" /><span>{error}</span>
        </div>
      ) : null}

      {step === 1 ? (
        <div className={styles.setupBody}>
          <div className={styles.setupGuidance}>
            <KeyRound size={20} aria-hidden="true" />
            <div>
              <strong>先在企业微信后台确认同一个自建应用</strong>
              <p>复制“我的企业 → 企业信息”的 CorpID；再复制已加入“应用管理 → 微信客服 → API → 可调用接口的应用”的自建应用 Secret。</p>
              <a href="https://work.weixin.qq.com/wework_admin/frame" target="_blank" rel="noreferrer">打开企业微信管理后台</a>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>企业 CorpID</span>
              <input value={corpId} onChange={(event) => setCorpId(event.target.value.trim())} placeholder="例如 ww 开头的企业 ID" autoComplete="off" />
              <small>CorpID 不是客服名称，也不是员工账号。</small>
            </label>
            <label className={styles.field}>
              <span>自建应用 Secret</span>
              <input type="password" value={secret} onChange={(event) => setSecret(event.target.value.trim())} placeholder="只在本机内存中临时使用" autoComplete="new-password" />
              <small>页面不会回显、缓存或写入浏览器存储。</small>
            </label>
          </div>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" data-action-id="wechat-work.first-setup.validate" aria-label="验证企业微信 CorpID 和自建应用 Secret" onClick={() => void validateEnterprise()} disabled={busy || !corpId || !secret}>
              {busy ? <LoaderCircle size={16} className={styles.spinning} aria-hidden="true" /> : null}
              {busy ? "正在验证" : "验证并读取客服账号"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 && validation ? (
        <div className={styles.setupBody}>
          <div className={`${styles.validation} ${styles.validationSuccess}`}>
            <CheckCircle2 size={17} aria-hidden="true" /><span>{validation.detail}</span>
          </div>
          <div className={styles.formGrid}>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>绑定的微信客服账号</span>
              <select value={selectedOpenKfid} onChange={(event) => setSelectedOpenKfid(event.target.value)}>
                {validation.accounts.map((account) => (
                  <option key={account.openKfid} value={account.openKfid}>{account.name || "未命名客服"} · {account.openKfid}</option>
                ))}
              </select>
              <small>安装包绑定公司“臻希礼业”；这里选择的是企业微信客服账号，不会把客服名称当成公司名称。</small>
            </label>
            <label className={styles.field}>
              <span>回调 Token</span>
              <input type="password" value={callbackToken} onChange={(event) => setCallbackToken(event.target.value.trim())} autoComplete="new-password" />
              <small>与企业微信微信客服回调页面填写的 Token 完全一致。</small>
            </label>
            <label className={styles.field}>
              <span>EncodingAESKey</span>
              <input type="password" value={encodingAesKey} onChange={(event) => setEncodingAesKey(event.target.value.trim())} maxLength={43} autoComplete="new-password" />
              <small>粘贴企业微信生成的 43 位密钥。</small>
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>公网 HTTPS 服务地址（可暂不填）</span>
              <input type="url" value={publicBaseUrl} onChange={(event) => setPublicBaseUrl(event.target.value.trim())} placeholder="https://kefu.example.com" autoComplete="url" />
              <small>填写后，企业微信回调 URL 为“该地址 + /api/wechat-work/callback”；留空时本机配置可保存，但真实客户来信仍待公网回调接通。</small>
            </label>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={enableAutomaticReplies} onChange={(event) => setEnableAutomaticReplies(event.target.checked)} />
              <span>启用低风险自动回复<small>只影响自动回复；人工回复仍可直接发送。建议先完成模型探活和员工测试，再勾选。</small></span>
            </label>
          </div>
          <div className={styles.buttonRow}>
            <button type="button" data-action-id="wechat-work.first-setup.back" aria-label="返回修改企业微信凭证" onClick={() => setStep(1)} disabled={busy}>返回修改企业凭证</button>
            <button className={styles.primaryButton} type="button" data-action-id="wechat-work.first-setup.save" aria-label="保存首次企业微信配置并执行连接检测" onClick={() => void saveSetup()} disabled={busy || !selectedOpenKfid || !callbackToken || encodingAesKey.length !== 43}>
              {busy ? <LoaderCircle size={16} className={styles.spinning} aria-hidden="true" /> : null}
              {busy ? "正在保存并检测" : "保存到本机并执行连接检测"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className={styles.setupBody}>
          <div className={`${styles.validation} ${styles.validationSuccess}`}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{saved?.detail || "本机企业微信配置已存在；密钥明文保持隐藏。"}</span>
          </div>
          {saved ? (
            <dl className={styles.runtimeMeta}>
              <div><dt>绑定客服</dt><dd>{saved.account.name || saved.account.openKfid}</dd></div>
              <div><dt>即时消息同步</dt><dd>{saved.activation.sync.ok ? "已执行" : "待后台重试"}</dd></div>
              <div><dt>客户入口</dt><dd>{saved.activation.customerEntry.ok ? "已生成" : "待后续处理"}</dd></div>
              <div><dt>真实收发闭环</dt><dd>仍需客户来信与手机显示确认</dd></div>
            </dl>
          ) : null}
          <div className={styles.buttonRow}>
            <Link className={styles.actionLink} href="/settings/ai-models">继续配置与探活大模型</Link>
            <Link className={styles.actionLink} href="/automation/control">检查自动回复开关</Link>
            <Link className={styles.actionLink} href="/integrations/wechat-work/workspace">进入企业微信工作台</Link>
            <button type="button" data-action-id="wechat-work.first-setup.restart" aria-label="重新开始企业微信配置向导" onClick={restartWizard}>重新配置</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
