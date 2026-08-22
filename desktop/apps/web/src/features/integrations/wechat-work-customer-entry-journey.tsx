import { QRCode } from "antd";
import { ArrowRight, CheckCircle2, Copy, Download, ExternalLink, MessageSquareText, QrCode as QrCodeIcon, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import type { WechatWorkCustomerEntry, WechatWorkUpgradeServiceConfig } from "../../lib/api";
import styles from "./integration-pages.module.css";

export function WechatWorkCustomerEntryJourney({
  entry,
  hasInboundEvidence,
  upgrade,
  upgradeError,
  qrHost,
  copyEntry,
  downloadQrCode,
}: {
  entry: WechatWorkCustomerEntry | null;
  hasInboundEvidence: boolean;
  upgrade: WechatWorkUpgradeServiceConfig | null;
  upgradeError: string;
  qrHost: RefObject<HTMLDivElement | null>;
  copyEntry: () => void;
  downloadQrCode: () => void;
}) {
  const upgradeMemberLabels = formatUpgradeMemberLabels(upgrade);
  return (
    <>
      {entry ? (
        <section className={styles.customerEntryNextStep} data-ready={hasInboundEvidence ? "true" : "false"} aria-labelledby="customer-entry-next-step-title">
          <div className={styles.customerEntryNextIcon}><MessageSquareText size={20} aria-hidden="true" /></div>
          <div>
            <span className={styles.eyebrow}>入口之后的下一步</span>
            <strong id="customer-entry-next-step-title">
              {hasInboundEvidence ? "已收到真实客户来信，可以开始接待" : "让测试客户扫码并发送第一句话"}
            </strong>
            <p>
              {hasInboundEvidence
                ? "官方来信证据已出现。进入工作台核对客户身份、真实消息和人工补充状态。"
                : "生成二维码只代表入口可用，不代表消息链路已打通；客户发言后，再到工作台确认会话已入库。"}
            </p>
          </div>
          <Link className={styles.primaryActionLink} data-action-id="wechat-work.customer-entry.open-workspace" href="/integrations/wechat-work/workspace">
            {hasInboundEvidence ? "接待客户" : "去会话工作台等待"}<ArrowRight size={15} aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      <div className={styles.customerEntryGrid}>
        <section className={styles.panel} aria-labelledby="customer-entry-qr-title">
          <div className={styles.panelHeader}>
            <div><h2 id="customer-entry-qr-title">客服二维码</h2><p>客户用普通微信扫码，并发送第一句话。</p></div>
          </div>
          {entry ? (
            <div className={styles.qrResult}>
              <div className={styles.qrCanvas} ref={qrHost} aria-label="企业微信客服入口二维码">
                <QRCode value={entry.url} type="svg" size={236} bordered={false} color="#111827" bgColor="#ffffff" />
              </div>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>客服链接</span>
                <input value={entry.url} readOnly onFocus={(event) => event.currentTarget.select()} />
              </label>
              <div className={styles.buttonRow}>
                <button type="button" data-action-id="wechat-work.customer-entry.copy-link" aria-label="复制企业微信客服链接" onClick={copyEntry}><Copy size={15} aria-hidden="true" />复制链接</button>
                <button type="button" data-action-id="wechat-work.customer-entry.download-qr" aria-label="下载企业微信客服二维码" onClick={downloadQrCode}><Download size={15} aria-hidden="true" />下载二维码</button>
                <a className={styles.actionLink} data-action-id="wechat-work.customer-entry.open-test" href={entry.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} aria-hidden="true" />打开测试
                </a>
              </div>
            </div>
          ) : (
            <div className={styles.entryPlaceholder}>
              <QrCodeIcon size={44} aria-hidden="true" />
              <strong>还没有生成客户入口</strong>
              <span>可自动生成，也可导入企业微信后台已有客服链接。</span>
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="permanent-customer-title">
          <div className={styles.panelHeader}>
            <div><h2 id="permanent-customer-title">长期客户</h2><p>咨询客户添加企业微信专员后，才形成可长期跟进的客户关系。</p></div>
            <UserRoundPlus size={22} aria-hidden="true" />
          </div>
          <ol className={styles.customerFlow}>
            <li><span>1</span><div><strong>客户扫码咨询</strong><small>发送第一句话后，自动进入“企业微信会话”。</small></div></li>
            <li><span>2</span><div><strong>智能客服接待</strong><small>保存客户身份、会话和后续业务资料。</small></div></li>
            <li><span>3</span><div><strong>升级长期服务</strong><small>在<Link href="/integrations/wechat-work/workspace">会话工作台</Link>进入完整处理页，发送企业微信专员推荐。</small></div></li>
            <li><span>4</span><div><strong>客户确认添加</strong><small>客户添加成功后，才能长期主动跟进。</small></div></li>
          </ol>
          <div className={styles.upgradeReadiness} data-ready={upgrade?.ready ? "true" : "false"}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              <strong>{upgradeError ? "需要开通企业微信升级服务" : upgrade?.ready ? "升级服务专员已配置" : "还没有配置升级服务专员"}</strong>
              <p>{upgradeError || upgrade?.detail || "正在读取企业微信升级服务配置。"}</p>
              {upgradeMemberLabels.length ? <small>可用专员：{upgradeMemberLabels.join("、")}</small> : null}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function formatUpgradeMemberLabels(upgrade: WechatWorkUpgradeServiceConfig | null) {
  if (!upgrade?.memberUserIds.length) return [];
  const optionsByUserId = new Map(
    (Array.isArray(upgrade.memberOptions) ? upgrade.memberOptions : [])
      .filter((option) => option?.userId)
      .map((option) => [option.userId, option] as const),
  );
  return upgrade.memberUserIds.map((userId) => {
    const option = optionsByUserId.get(userId);
    const displayName = String(option?.displayName || "").trim();
    return displayName && displayName !== userId ? `${displayName}（${userId}）` : userId;
  });
}
