import { AlertTriangle, CheckCircle2, Cloud, ListChecks, RefreshCw, Server, ShieldCheck } from "lucide-react";
import type {
  WechatWorkCallbackConsoleField,
  WechatWorkLaunchPlanItem,
  WechatWorkPreLiveChecklistItem,
  WechatWorkProductionReadiness,
  WechatWorkReadinessCheck,
} from "../lib/api";
import styles from "./wechat-work-readiness-panel.module.css";

type WechatWorkReadinessPanelProps = {
  readiness: WechatWorkProductionReadiness | null;
  busy?: boolean;
  error?: string;
  onRefresh: () => void;
};

export function WechatWorkReadinessPanel({
  readiness,
  busy = false,
  error,
  onRefresh,
}: WechatWorkReadinessPanelProps) {
  const presentation = readinessPresentation(readiness);
  const StatusIcon = presentation.Icon;

  return (
    <section className={styles.panel} aria-labelledby="wechat-work-readiness-title">
      <header className={styles.header}>
        <div>
          <span className={styles.channelIcon} aria-hidden="true"><Cloud size={18} /></span>
          <div>
            <h3 id="wechat-work-readiness-title">企业微信正式接入</h3>
            <p>本机代码检查与公网验收分开呈现，不把外部阻塞误报为失败或成功。</p>
          </div>
        </div>
        <button
          type="button"
          data-action-id="integrations.wechat-work.preflight.refresh"
          aria-label="刷新企业微信生产预检"
          onClick={onRefresh}
          disabled={busy}
        >
          <RefreshCw size={14} aria-hidden="true" />刷新预检
        </button>
      </header>

      <div className={`${styles.summary} ${styles[presentation.tone]}`} role="status">
        <StatusIcon size={19} aria-hidden="true" />
        <div>
          <strong>{presentation.label}</strong>
          <span>{presentation.detail}</span>
        </div>
      </div>

      {readiness?.source ? (
        <div className={styles.callbackRow} data-testid="wechat-work-readiness-source">
          <div>
            <span>状态来源</span>
            <code>{readiness.source.label}</code>
          </div>
          <span className={readiness.source.kind === "remote_unavailable" ? styles.missingText : styles.readyText}>
            {readiness.source.kind === "production_server"
              ? "已连接生产服务器"
              : readiness.source.kind === "remote_unavailable"
                ? "生产状态连接失败"
                : "仅检查当前桌面"}
          </span>
        </div>
      ) : null}

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {readiness ? (
        <>
          <dl className={styles.identityBar}>
            <div><dt>入站渠道</dt><dd>{readiness.identityPolicy.channel}</dd></div>
            <div><dt>账号平台</dt><dd>{readiness.identityPolicy.accountPlatform}</dd></div>
            <div><dt>发送适配器</dt><dd>{readiness.identityPolicy.adapter}</dd></div>
            <div><dt>调用方可切换</dt><dd>{readiness.identityPolicy.callerSelectableAdapter ? "允许" : "禁止"}</dd></div>
          </dl>

          <div className={styles.checkColumns}>
            <ReadinessGroup
              title="本机代码与配置"
              detail="离线检查，不访问企业微信外网"
              Icon={Server}
              checks={readiness.local.checks}
            />
            <ReadinessGroup
              title="公网与管理后台验收"
              detail="需要公网 HTTPS 和企业微信管理员操作"
              Icon={Cloud}
              checks={readiness.external.checks}
            />
          </div>

          <div className={styles.callbackRow}>
            <div>
              <span>回调地址</span>
              <code>{readiness.callback.url}</code>
            </div>
            <span className={readiness.callback.publicHttpsFormatReady ? styles.readyText : styles.missingText}>
              {readiness.callback.publicHttpsFormatReady ? "公网 HTTPS 格式已配置" : "缺少非本机公网 HTTPS 地址"}
            </span>
          </div>

          <CallbackConsoleFields fields={readiness.callback.consoleFields} />

          <div className={styles.verificationColumns}>
            <ChecklistGroup title="备案期间本地验收" items={readiness.preLiveChecklist.duringIcp} />
            <ChecklistGroup title="外部联调前置清单" items={readiness.preLiveChecklist.beforeExternalJointTest} />
          </div>

          <section className={styles.launchPlan} aria-labelledby="wechat-work-launch-plan-title">
            <header>
              <ListChecks size={16} aria-hidden="true" />
              <div>
                <strong id="wechat-work-launch-plan-title">{phaseLabel(readiness.launchPlan.currentPhase)}</strong>
                <span>{readiness.launchPlan.recommendedNextAction}</span>
              </div>
            </header>
            <div className={styles.planColumns}>
              <LaunchPlanGroup title="备案期间先完成" items={readiness.launchPlan.duringIcp} />
              <LaunchPlanGroup title="备案通过后验收" items={readiness.launchPlan.afterIcp} />
            </div>
          </section>

          <footer className={styles.footer}>
            <span><b>{readiness.metrics.mappedAccounts}</b> 个持久化客服账号映射</span>
            <span><b>{readiness.metrics.auditRecords}</b> 条企业微信审计记录</span>
            <span><ShieldCheck size={14} aria-hidden="true" />发送身份由服务端固定为 work_wechat</span>
          </footer>
        </>
      ) : (
        <div className={styles.empty}>
          <Cloud size={22} aria-hidden="true" />
          <strong>尚未取得企业微信预检结果</strong>
          <span>刷新后会读取本机真实配置；此动作不会调用企业微信外网。</span>
        </div>
      )}
    </section>
  );
}

function CallbackConsoleFields({ fields }: { fields: WechatWorkCallbackConsoleField[] }) {
  return (
    <section className={styles.callbackFields} aria-labelledby="wechat-work-callback-fields-title">
      <header>
        <strong id="wechat-work-callback-fields-title">企业微信后台回调字段</strong>
        <span>只展示可复制 URL；Token 和 AESKey 只显示配置状态，不回显明文。</span>
      </header>
      <ul>
        {fields.map((field) => (
          <li className={styles[field.status]} key={field.key}>
            <span>
              <strong>{field.label}</strong>
              <small>{field.sourceEnv}</small>
              <small>{field.detail}</small>
            </span>
            <code>{field.secret ? "已隐藏" : field.copyValue || "待配置"}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChecklistGroup({ title, items }: { title: string; items: WechatWorkPreLiveChecklistItem[] }) {
  return (
    <section className={styles.checklistGroup}>
      <h4>{title}</h4>
      <ol>
        {items.map((item) => (
          <li className={styles[item.status]} key={item.key}>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <small>验证：{item.verify}</small>
              {item.blockedBy ? <small>阻塞：{item.blockedBy}</small> : null}
            </span>
            <em>{ownerLabel(item.owner)} · {readinessStatusLabel(item.status)}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LaunchPlanGroup({ title, items }: { title: string; items: WechatWorkLaunchPlanItem[] }) {
  return (
    <section className={styles.planGroup}>
      <h4>{title}</h4>
      <ol>
        {items.map((item) => (
          <li className={styles[item.status]} key={item.key}>
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

function ReadinessGroup({
  title,
  detail,
  Icon,
  checks,
}: {
  title: string;
  detail: string;
  Icon: typeof Server;
  checks: WechatWorkReadinessCheck[];
}) {
  return (
    <section className={styles.checkGroup}>
      <header>
        <Icon size={16} aria-hidden="true" />
        <div><strong>{title}</strong><span>{detail}</span></div>
      </header>
      <ul>
        {checks.map((check) => {
          const IconComponent = check.status === "ready" ? CheckCircle2 : AlertTriangle;
          return (
            <li className={styles[check.status]} key={check.key}>
              <IconComponent size={15} aria-hidden="true" />
              <span>
                <strong>{checkLabel(check.key)}</strong>
                <small>{check.detail}</small>
                <small>{check.reason}</small>
                <small>{check.fix}</small>
              </span>
              <em>{readinessStatusLabel(check.status)}</em>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function phaseLabel(phase: string) {
  if (phase === "production_ready") return "企业微信生产验收已完成";
  if (phase === "external_acceptance") return "进入公网回调验收";
  if (phase === "local_configuring") return "本机配置完善中";
  return "备案等待期进度";
}

function readinessPresentation(readiness: WechatWorkProductionReadiness | null) {
  if (!readiness) {
    return { tone: "muted", label: "等待预检", detail: "尚未读取企业微信正式接入状态。", Icon: AlertTriangle } as const;
  }
  if (readiness.source?.kind === "remote_unavailable") {
    return {
      tone: "danger",
      label: "生产状态连接失败",
      detail: "当前列表是桌面本机诊断，不能代表生产服务器；请检查只读预检通道。",
      Icon: AlertTriangle,
    } as const;
  }
  if (readiness.productionReady) {
    return { tone: "ready", label: "生产验收已完成", detail: "本机配置与外部验收均已通过。", Icon: CheckCircle2 } as const;
  }
  if (readiness.local.ready && readiness.external.status === "blocked") {
    return {
      tone: "warning",
      label: "本机已就绪，等待公网验收",
      detail: "当前阻塞在公网 HTTPS、企业微信后台回调校验和受控收发验收；没有备案时可先使用合规公网隧道或已备案域名。",
      Icon: AlertTriangle,
    } as const;
  }
  return {
    tone: "danger",
    label: "本机配置尚未完成",
    detail: `${readiness.local.checks.filter((check) => check.status !== "ready").length} 项本机检查需要处理。`,
    Icon: AlertTriangle,
  } as const;
}

function ownerLabel(owner: string) {
  if (owner === "wechat_admin") return "企业微信管理员";
  if (owner === "operator") return "运营";
  return "开发";
}

function checkLabel(key: string) {
  return ({
    corp_id: "企业 ID",
    customer_service_secret: "微信客服 Secret",
    callback_token: "回调 Token",
    encoding_aes_key: "EncodingAESKey",
    open_kfid: "客服账号 OpenKfid",
    public_callback_url: "公网回调 URL",
    official_api_base_url: "官方 API 基地址",
    official_send_adapter: "正式发送适配器",
    persistence: "账号映射持久化",
    public_https_reachability: "公网 HTTPS 可达性",
    callback_registration: "管理后台回调校验",
    customer_service_api_permissions: "微信客服 API 权限",
    live_callback_sync_and_send: "受控收发验收",
  } as Record<string, string>)[key] || key;
}

function readinessStatusLabel(status: string) {
  if (status === "ready") return "通过";
  if (status === "blocked") return "待外部验收";
  return "待配置";
}
