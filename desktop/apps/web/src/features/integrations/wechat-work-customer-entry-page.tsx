"use client";

import { ExternalLink, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  bindAllWechatWorkCustomerEntries,
  createWechatWorkCustomerEntry,
  diagnoseWechatWorkConnection,
  getOperatorAccessStatus,
  getWechatWorkCustomerEntry,
  getWechatWorkUpgradeServiceConfig,
  importWechatWorkCustomerEntry,
  saveWechatWorkCustomerContactCredential,
  saveWechatWorkCustomerServiceCredential,
  validateWechatWorkCustomerServiceSecret,
  type OperatorAccessStatus,
  type WechatWorkConnectionDiagnosis,
  type WechatWorkCredentialValidation,
  type WechatWorkCustomerEntry,
  type WechatWorkUpgradeServiceConfig,
} from "../../lib/api";
import { FeatureNotice, FeaturePage, errorMessage } from "./feature-page";
import { WechatWorkCustomerEntryJourney } from "./wechat-work-customer-entry-journey";
import styles from "./integration-pages.module.css";

export function WechatWorkCustomerEntryPage() {
  const [access, setAccess] = useState<OperatorAccessStatus | null>(null);
  const [entry, setEntry] = useState<WechatWorkCustomerEntry | null>(null);
  const [upgrade, setUpgrade] = useState<WechatWorkUpgradeServiceConfig | null>(null);
  const [diagnosis, setDiagnosis] = useState<WechatWorkConnectionDiagnosis | null>(null);
  const [credentialValidation, setCredentialValidation] = useState<WechatWorkCredentialValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(true);
  const [error, setError] = useState("");
  const [upgradeError, setUpgradeError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [importUrl, setImportUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [diagnosisBusy, setDiagnosisBusy] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [customerContactBusy, setCustomerContactBusy] = useState(false);
  const [entryBindingBusy, setEntryBindingBusy] = useState(false);
  const [customerServiceSecret, setCustomerServiceSecret] = useState("");
  const [customerContactSecret, setCustomerContactSecret] = useState("");
  const [selectedOpenKfid, setSelectedOpenKfid] = useState("");
  const qrHost = useRef<HTMLDivElement>(null);

  const refreshConfiguration = useCallback(async () => {
    setConfigBusy(true);
    setError("");
    setUpgradeError("");
    const [accessResult, entryResult, upgradeResult] = await Promise.allSettled([
      getOperatorAccessStatus(),
      getWechatWorkCustomerEntry(),
      getWechatWorkUpgradeServiceConfig(),
    ]);
    if (accessResult.status === "fulfilled") {
      setAccess(accessResult.value);
    } else {
      setAccess(null);
      setError(errorMessage(accessResult.reason, "账号权限读取失败"));
    }
    if (entryResult.status === "fulfilled") setEntry(entryResult.value);
    if (upgradeResult.status === "fulfilled") {
      setUpgrade(upgradeResult.value);
    } else {
      setUpgrade(null);
      setUpgradeError(errorMessage(upgradeResult.reason, "升级服务配置读取失败"));
    }
    setConfigBusy(false);
  }, []);

  const importEntry = useCallback(async () => {
    setImportBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await importWechatWorkCustomerEntry(importUrl);
      setEntry(result);
      setImportUrl("");
      setNoticeTone("success");
      setNotice("企业微信官方客服链接已保存，二维码已经生成；软件重启后仍会保留。");
    } catch (importError) {
      setError(errorMessage(importError, "企业微信客服链接导入失败"));
    } finally {
      setImportBusy(false);
    }
  }, [importUrl]);

  const diagnoseConnection = useCallback(async () => {
    setDiagnosisBusy(true);
    setError("");
    try {
      setDiagnosis(await diagnoseWechatWorkConnection());
    } catch (diagnosisError) {
      setError(errorMessage(diagnosisError, "企业微信真实连接检测失败"));
    } finally {
      setDiagnosisBusy(false);
    }
  }, []);

  const bindAllCustomerEntries = useCallback(async () => {
    setEntryBindingBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await bindAllWechatWorkCustomerEntries();
      setNoticeTone(result.ok ? "success" : "warning");
      setNotice(
        result.ok
          ? `已为 ${result.boundAccountCount} 个客服账号绑定二维码（新建 ${result.createdAccountCount} 个，复用 ${result.reusedAccountCount} 个）。`
          : `已绑定 ${result.boundAccountCount}/${result.accountCount} 个客服账号二维码；${result.failedAccountCount} 个需要处理。`,
      );
      const nextDiagnosis = await diagnoseWechatWorkConnection();
      setDiagnosis(nextDiagnosis);
      const selected = result.accounts.find((account) => account.openKfid === nextDiagnosis.configuredOpenKfid)?.entry;
      if (selected) setEntry(selected);
    } catch (bindingError) {
      setError(errorMessage(bindingError, "批量绑定客服二维码失败"));
    } finally {
      setEntryBindingBusy(false);
    }
  }, []);

  const validateCredential = useCallback(async () => {
    setCredentialBusy(true);
    setError("");
    try {
      const result = await validateWechatWorkCustomerServiceSecret(customerServiceSecret);
      setCredentialValidation(result);
      setSelectedOpenKfid(result.suggestedOpenKfid || result.accounts[0]?.openKfid || "");
      setNoticeTone("success");
      setNotice(result.detail);
    } catch (credentialError) {
      setCredentialValidation(null);
      setError(errorMessage(credentialError, "自建应用 Secret 验证失败"));
    } finally {
      setCredentialBusy(false);
    }
  }, [customerServiceSecret]);

  const saveCredential = useCallback(async () => {
    setCredentialBusy(true);
    setError("");
    try {
      const result = await saveWechatWorkCustomerServiceCredential(customerServiceSecret, selectedOpenKfid);
      setCustomerServiceSecret("");
      setCredentialValidation(null);
      if (result.activation.customerEntry.entry) setEntry(result.activation.customerEntry.entry);
      setNoticeTone(result.activation.activated ? "success" : "warning");
      setNotice(result.detail);
      setDiagnosis(await diagnoseWechatWorkConnection());
      await refreshConfiguration();
    } catch (credentialError) {
      setError(errorMessage(credentialError, "微信客服连接保存失败"));
    } finally {
      setCredentialBusy(false);
    }
  }, [customerServiceSecret, refreshConfiguration, selectedOpenKfid]);

  const saveCustomerContactCredential = useCallback(async () => {
    const secret = customerContactSecret.trim();
    if (!secret || customerContactBusy) return;
    setCustomerContactBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await saveWechatWorkCustomerContactCredential(secret);
      setCustomerContactSecret("");
      setNoticeTone("success");
      setNotice(result.detail);
      await refreshConfiguration();
    } catch (saveError) {
      setError(errorMessage(saveError, "客户联系应用凭证验证失败"));
    } finally {
      setCustomerContactBusy(false);
    }
  }, [customerContactBusy, customerContactSecret, refreshConfiguration]);

  useEffect(() => {
    void refreshConfiguration();
  }, [refreshConfiguration]);

  const canGenerate = Boolean(
    access?.enforcementReady && access.capabilities.includes("manage_channels"),
  );
  const hasInboundEvidence = Boolean(diagnosis?.evidence.latestInboundAt);

  const generateEntry = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createWechatWorkCustomerEntry();
      setEntry(result);
      setNoticeTone("success");
      setNotice("客户入口已生成。把二维码或链接发给客户，客户发送第一句话后会自动进入会话列表。");
    } catch (generateError) {
      setError(errorMessage(generateError, "客户入口生成失败"));
    } finally {
      setBusy(false);
    }
  }, []);

  const copyEntry = useCallback(async () => {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(entry.url);
      setNoticeTone("success");
      setNotice("客服链接已复制，可以直接发给客户。");
    } catch {
      setError("链接复制失败，请选中下方链接手工复制。");
    }
  }, [entry]);

  const downloadQrCode = useCallback(() => {
    const svg = qrHost.current?.querySelector("svg");
    if (!svg) {
      setError("二维码尚未生成，暂时不能下载。");
      return;
    }
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "企业微信客服入口二维码.svg";
    anchor.click();
    URL.revokeObjectURL(href);
    setNoticeTone("success");
    setNotice("二维码已下载，可以放到海报、网页或发给客户。");
  }, []);

  return (
    <FeaturePage
      id="wechat-work-customer-entry-page"
      title="客户入口"
      description="生成企业微信官方客服链接和二维码，让其他微信客户进入咨询；成交客户可继续升级为长期企业微信客户。"
      icon={<QrCode size={20} />}
      busy={busy || importBusy || diagnosisBusy || credentialBusy || customerContactBusy || entryBindingBusy || configBusy}
      actions={(
        <>
          <button type="button" data-action-id="wechat-work.customer-entry.bind-all" aria-label="绑定全部企业微信客服账号二维码" onClick={() => void bindAllCustomerEntries()} disabled={!canGenerate || entryBindingBusy || configBusy}>
            <QrCode size={15} aria-hidden="true" /> {entryBindingBusy ? "正在绑定二维码" : "绑定全部账号二维码"}
          </button>
          <button type="button" data-action-id="wechat-work.customer-entry.diagnose" aria-label="检测企业微信真实互通状态" onClick={() => void diagnoseConnection()} disabled={!canGenerate || diagnosisBusy || configBusy}>
            <RefreshCw size={15} aria-hidden="true" /> {diagnosisBusy ? "正在检测" : "检测真实互通"}
          </button>
          <button type="button" data-action-id="wechat-work.customer-entry.refresh-configuration" aria-label="刷新企业微信客服配置" onClick={() => void refreshConfiguration()} disabled={busy || configBusy}>
            <RefreshCw size={15} aria-hidden="true" /> 刷新配置
          </button>
          <button className={styles.primaryButton} type="button" data-action-id="wechat-work.customer-entry.generate"
            aria-label={entry ? "重新生成客户二维码" : "生成客户二维码"}
            onClick={() => void generateEntry()}
            disabled={!canGenerate || busy || configBusy}
          >
            <QrCode size={15} aria-hidden="true" /> {busy ? "正在生成" : entry ? "重新生成" : "生成客户二维码"}
          </button>
        </>
      )}
    >
      {error ? <FeatureNotice tone="error" title="当前操作未完成">{error}</FeatureNotice> : null}
      {notice ? (
        <FeatureNotice tone={noticeTone} title={noticeTone === "success" ? "操作成功" : "连接已保存，正在补齐"}>
          {notice}
        </FeatureNotice>
      ) : null}
      {!configBusy && !canGenerate ? (
        <FeatureNotice tone="warning" title="当前账号不能生成入口">
          请使用具有“管理通道”权限的管理员或主管账号打开本页。
        </FeatureNotice>
      ) : null}

      {upgrade?.customerContact ? (
        <section className={styles.panel} aria-labelledby="wechat-work-customer-contact-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="wechat-work-customer-contact-title">长期客户连接</h2>
              <p>{upgrade.customerContact.detail}</p>
            </div>
            <span className={`${styles.statusBadge} ${upgrade.customerContact.ready ? styles.statusReady : styles.statusDanger}`}>
              {upgrade.customerContact.ready ? "已授权" : "待授权"}
            </span>
          </div>
          <dl className={styles.runtimeMeta}>
            <div>
              <dt>应用凭证</dt>
              <dd>{upgrade.customerContact.credentialSource === "wechat_work_shared" ? "复用现有企业微信应用" : upgrade.customerContact.configured ? "已配置独立应用" : "未配置"}</dd>
            </div>
            <div>
              <dt>已识别应用</dt>
              <dd>{upgrade.customerContact.applications?.map((application) => application.name).join("、") || "等待企业微信返回"}</dd>
            </div>
            <div>
              <dt>客户联系 API</dt>
              <dd>{upgrade.customerContact.ready ? "可调用" : upgrade.customerContact.blockerCode || "未通过"}</dd>
            </div>
            <div>
              <dt>添加客户回调</dt>
              <dd>{upgrade.customerContact.callback?.locallyReady ? "本机配置已就绪" : "未就绪"}</dd>
            </div>
          </dl>
          {upgrade.customerContact.blockerCode === "CUSTOMER_CONTACT_PERMISSION_MISSING" ? (
            <>
              <FeatureNotice tone="warning" title="企业微信管理员需要完成一次授权">
                打开企业微信管理后台，进入“客户联系 → 客户 → API → 可调用接口的应用”，添加上方已识别的自建应用。保存后回到本页点击“刷新配置”，不需要重新填写 Secret。
              </FeatureNotice>
              <div className={styles.buttonRow}>
                <a className={styles.actionLink} href="https://work.weixin.qq.com/wework_admin/frame" target="_blank" rel="noreferrer">
                  <ExternalLink size={15} aria-hidden="true" /> 打开企业微信管理后台
                </a>
                <button type="button" data-action-id="wechat-work.customer-entry.refresh-after-auth" aria-label="授权后重新检测企业微信配置" onClick={() => void refreshConfiguration()} disabled={configBusy || customerContactBusy}>
                  <RefreshCw size={15} aria-hidden="true" /> 授权后重新检测
                </button>
              </div>
            </>
          ) : null}
          {!upgrade.customerContact.ready && upgrade.customerContact.credentialSource !== "wechat_work_shared" ? (
            <>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>已授权自建应用 Secret</span>
                <input
                  type="password"
                  value={customerContactSecret}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="粘贴已加入客户联系可调用应用的 Secret"
                  onChange={(event) => setCustomerContactSecret(event.currentTarget.value)}
                />
                <small>Secret 只提交给本机服务验证，不在浏览器回显。</small>
              </label>
              <div className={styles.buttonRow}>
                <button className={styles.primaryButton} type="button" data-action-id="wechat-work.customer-entry.save-customer-contact-secret" aria-label="验证并保存企业微信客户联系 Secret" onClick={() => void saveCustomerContactCredential()} disabled={!customerContactSecret.trim() || customerContactBusy}>
                  <ShieldCheck size={15} aria-hidden="true" /> {customerContactBusy ? "正在验证" : "验证并保存"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {diagnosis ? (
        <section className={styles.panel} aria-labelledby="wechat-work-live-diagnosis-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="wechat-work-live-diagnosis-title">企业微信真实互通</h2>
              <p>{diagnosis.detail}</p>
            </div>
            <span className={`${styles.statusBadge} ${diagnosis.ready ? styles.statusReady : styles.statusDanger}`}>
              {diagnosis.ready ? "真实互通已验证" : "尚未互通"}
            </span>
          </div>
          <dl className={styles.runtimeMeta}>
            <div><dt>官方客服接口</dt><dd>{diagnosis.apiReachable ? "可读取" : "未通过"}</dd></div>
            <div><dt>凭证模式</dt><dd>{diagnosis.credentialCompatible ? "匹配" : diagnosis.blockerCode}</dd></div>
            <div><dt>OpenKfid</dt><dd>{diagnosis.configuredOpenKfidFound ? "已匹配客服账号" : "未匹配"}</dd></div>
            <div><dt>最近客户来信</dt><dd>{diagnosis.evidence.latestInboundAt || "没有真实证据"}</dd></div>
            <div><dt>最近官方回复</dt><dd>{diagnosis.evidence.latestOfficialSendAt || "没有真实证据"}</dd></div>
            <div><dt>发送结果</dt><dd>{diagnosis.evidence.latestOfficialSendStatus || "未发生"}</dd></div>
          </dl>
          {diagnosis.accounts.length ? (
            <ul className={styles.checkList} aria-label="企业微信真实客服账号">
              {diagnosis.accounts.map((account) => (
                <li className={styles.checkItem} key={account.openKfid}>
                  <span><strong>{account.name || "未命名客服"}</strong><small>{account.openKfid}</small></span>
                  <div className={styles.buttonRow}>
                    <b className={account.customerEntry ? styles.passedText : styles.failedText}>
                      {account.customerEntry
                        ? account.openKfid === diagnosis.configuredOpenKfid ? "二维码已绑定 · 默认入口" : "二维码已绑定"
                        : "二维码未绑定"}
                    </b>
                    {account.customerEntry ? (
                      <button type="button" data-action-id={`wechat-work.customer-entry.account-${account.openKfid}.show-qr`} aria-label={`查看${account.name}的客户二维码`} onClick={() => setEntry(account.customerEntry)}>查看二维码</button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {diagnosis && !diagnosis.credentialCompatible ? (
        <section className={styles.panel} aria-labelledby="wechat-work-secret-connect-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="wechat-work-secret-connect-title">连接企业微信客服</h2>
              <p>先在“应用管理 → 应用 → 自建”创建或打开自建应用，再把该应用加入“应用管理 → 微信客服 → API → 可调用接口的应用”；这里填写的是自建应用详情页的 Secret。</p>
            </div>
          </div>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>已授权自建应用 Secret</span>
            <input
              type="password"
              value={customerServiceSecret}
              autoComplete="new-password"
              spellCheck={false}
              placeholder="粘贴自建应用详情页里的 Secret"
              onChange={(event) => {
                setCustomerServiceSecret(event.currentTarget.value);
                setCredentialValidation(null);
              }}
            />
            <small>请使用已加入微信客服“可调用接口的应用”的自建应用 Secret；软件会先调用官方账号列表验证，失败不会保存。</small>
          </label>
          {credentialValidation ? (
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>绑定客服账号</span>
              <select value={selectedOpenKfid} onChange={(event) => setSelectedOpenKfid(event.currentTarget.value)}>
                {credentialValidation.accounts.map((account) => (
                  <option key={account.openKfid} value={account.openKfid}>
                    {account.name || "未命名客服"}（{account.openKfid}）
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className={styles.buttonRow}>
            <button type="button" data-action-id="wechat-work.customer-entry.validate-secret" aria-label="验证自建应用 Secret" onClick={() => void validateCredential()} disabled={!customerServiceSecret.trim() || credentialBusy}>
              {credentialBusy ? "正在验证" : "验证 Secret"}
            </button>
            {credentialValidation ? (
              <button className={styles.primaryButton} type="button" data-action-id="wechat-work.customer-entry.save-secret"
                aria-label="保存自建应用 Secret 并一键开通"
                onClick={() => void saveCredential()}
                disabled={!selectedOpenKfid || credentialBusy}
              >
                保存并一键开通
              </button>
            ) : null}
          </div>
          <p className={styles.mutedText}>开通后软件会立即同步企业微信消息、自动生成客户二维码，并将连接永久保存到本机。</p>
        </section>
      ) : null}

      {!entry ? (
        <section className={styles.panel} aria-labelledby="customer-entry-import-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="customer-entry-import-title">已有企业微信客服链接</h2>
              <p>如果当前 Secret 模式不匹配，可先把企业微信后台已有的官方客服链接导入，立即生成可用二维码。</p>
            </div>
          </div>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>企业微信官方客服链接</span>
            <input
              type="url"
              value={importUrl}
              placeholder="https://work.weixin.qq.com/kf/...?..."
              onChange={(event) => setImportUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && importUrl.trim() && !importBusy && canGenerate) void importEntry();
              }}
            />
            <small>在企业微信管理后台进入“微信客服”，选择客服账号并复制客服链接；参数必须完整保留。</small>
          </label>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" data-action-id="wechat-work.customer-entry.import"
              aria-label="保存已导入的企业微信客服链接并生成二维码"
              onClick={() => void importEntry()}
              disabled={!canGenerate || !importUrl.trim() || importBusy}
            >
              <QrCode size={15} aria-hidden="true" />{importBusy ? "正在保存" : "保存并生成二维码"}
            </button>
          </div>
        </section>
      ) : null}

      <WechatWorkCustomerEntryJourney
        entry={entry}
        hasInboundEvidence={hasInboundEvidence}
        upgrade={upgrade}
        upgradeError={upgradeError}
        qrHost={qrHost}
        copyEntry={() => void copyEntry()}
        downloadQrCode={downloadQrCode}
      />
    </FeaturePage>
  );
}
