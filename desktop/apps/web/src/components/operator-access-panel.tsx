import { Check, LockKeyhole, Minus, ShieldAlert, ShieldCheck } from "lucide-react";
import styles from "./operator-access-panel.module.css";

export type OperatorAccessBlocker = {
  code?: string;
  message: string;
};

export type OperatorAccessStatusView = {
  mode: string;
  policyLoaded: boolean;
  trustedPrincipal: boolean;
  enforcementReady: boolean;
  authenticationProvider?: string;
  roleBindingReady?: boolean;
  defaultDecision?: string;
  blockers?: OperatorAccessBlocker[];
  requiredNextSteps?: string[];
  notice?: string;
};

export type OperatorAccessPolicyView = {
  version?: string;
  mode?: string;
  defaultDecision?: string;
  roles: readonly string[];
  capabilities: readonly string[];
  matrix: Readonly<Record<string, readonly string[]>>;
  semantics?: {
    roleInput?: string;
    policyAllows?: string;
    authorizationGranted?: string;
  };
  notice?: string;
};

export type OperatorAccessReadinessView = {
  trustedPrincipal: boolean;
  enforcementReady: boolean;
  blockers?: OperatorAccessBlocker[];
  requiredNextSteps?: string[];
  reason?: string;
};

type OperatorAccessPanelProps = {
  status: OperatorAccessStatusView;
  policy: OperatorAccessPolicyView;
  readiness: OperatorAccessReadinessView;
};

const roleDefinitions = [
  { id: "admin", label: "管理员" },
  { id: "supervisor", label: "主管" },
  { id: "agent", label: "客服" },
  { id: "read_only", label: "只读" },
] as const;

const capabilityDefinitions = [
  { id: "view_console", label: "查看工作台" },
  { id: "manage_channels", label: "管理渠道" },
  { id: "manage_assignments", label: "管理会话分配" },
  { id: "reply_conversations", label: "回复客户会话" },
  { id: "approve_send", label: "审批发送" },
  { id: "manage_training", label: "管理训练" },
  { id: "manage_roles", label: "管理角色" },
] as const;

export function OperatorAccessPanel({ status, policy, readiness }: OperatorAccessPanelProps) {
  const trustedPrincipal = status.trustedPrincipal === true && readiness.trustedPrincipal === true;
  const enforcementReady =
    trustedPrincipal && status.enforcementReady === true && readiness.enforcementReady === true;
  const declaredRoles = new Set(policy.roles);
  const declaredCapabilities = new Set(policy.capabilities);
  const blockers = mergeBlockers(status.blockers, readiness.blockers);
  const requiredNextSteps = readiness.requiredNextSteps?.length
    ? readiness.requiredNextSteps
    : status.requiredNextSteps || [];

  return (
    <section className={styles.panel} aria-labelledby="operator-access-title">
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.titleIcon} aria-hidden="true"><ShieldCheck size={18} /></span>
          <div>
            <h2 id="operator-access-title">操作员权限策略</h2>
            <p>查看角色能力矩阵与真实鉴权接入状态。</p>
          </div>
        </div>
        <span className={`${styles.mode} ${enforcementReady ? styles.ready : styles.preflight}`}>
          {enforcementReady ? "服务端鉴权已就绪" : "仅策略预检"}
        </span>
      </header>

      {!enforcementReady ? (
        <div className={styles.trustWarning} role="alert">
          <ShieldAlert size={21} aria-hidden="true" />
          <div>
            <strong>真实鉴权尚未启用</strong>
            <p>
              当前只有策略预检。trustedPrincipal=false 时，角色矩阵只能说明静态策略是否匹配，不能证明操作员已经登录或获得授权。
            </p>
            <p>客户端选项、请求体 role 或任意请求头都不能用来冒充管理员；启用前必须接入真实登录或企业 SSO。</p>
          </div>
        </div>
      ) : (
        <div className={styles.trustReady} role="status">
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <strong>可信身份与服务端守卫已就绪</strong>
            <p>该状态来自服务端鉴权结果；具体业务接口仍会按能力逐项校验。</p>
          </div>
        </div>
      )}

      <dl className={styles.statusGrid} aria-label="权限接入状态">
        <div>
          <dt>策略状态</dt>
          <dd className={status.policyLoaded ? styles.valueReady : styles.valueDanger}>
            {status.policyLoaded ? "已载入" : "未载入"}
          </dd>
        </div>
        <div>
          <dt>可信身份</dt>
          <dd className={trustedPrincipal ? styles.valueReady : styles.valueDanger}>
            {trustedPrincipal ? "已验证" : "未建立"}
          </dd>
        </div>
        <div>
          <dt>鉴权执行</dt>
          <dd className={enforcementReady ? styles.valueReady : styles.valueDanger}>
            {enforcementReady ? "已启用" : "未启用"}
          </dd>
        </div>
        <div>
          <dt>身份提供方</dt>
          <dd>{providerLabel(status.authenticationProvider)}</dd>
        </div>
        <div>
          <dt>默认决策</dt>
          <dd>{status.defaultDecision === "deny" || policy.defaultDecision === "deny" ? "拒绝" : "以服务端策略为准"}</dd>
        </div>
      </dl>

      <div className={styles.matrixSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>角色能力矩阵</h3>
            <p>“允许”仅表示静态策略匹配，不代表当前请求已经鉴权。</p>
          </div>
          {policy.version ? <span>策略版本 {policy.version}</span> : null}
        </div>

        <div className={styles.tableWrap}>
          <table>
            <caption className={styles.srOnly}>管理员、主管、客服和只读角色的七项能力矩阵</caption>
            <thead>
              <tr>
                <th scope="col">角色</th>
                {capabilityDefinitions.map((capability) => (
                  <th scope="col" key={capability.id}>{capability.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleDefinitions.map((role) => (
                <tr key={role.id}>
                  <th scope="row">
                    <strong>{role.label}</strong>
                    <code>{role.id}</code>
                  </th>
                  {capabilityDefinitions.map((capability) => {
                    const policyAllows = Boolean(
                      declaredRoles.has(role.id) &&
                        declaredCapabilities.has(capability.id) &&
                        policy.matrix[role.id]?.includes(capability.id),
                    );
                    return (
                      <td key={capability.id} data-label={capability.label}>
                        <span
                          className={`${styles.permission} ${policyAllows ? styles.allowed : styles.denied}`}
                          aria-label={`${role.label}：${capability.label}${policyAllows ? "允许" : "拒绝"}`}
                        >
                          {policyAllows ? <Check size={15} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}
                          <span>{policyAllows ? "允许" : "拒绝"}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!enforcementReady && (blockers.length || requiredNextSteps.length || readiness.reason) ? (
        <div className={styles.readinessSection}>
          <div className={styles.readinessTitle}>
            <LockKeyhole size={17} aria-hidden="true" />
            <h3>启用真实鉴权前仍需完成</h3>
          </div>
          {readiness.reason ? <p>{readiness.reason}</p> : null}
          {blockers.length ? (
            <ul>
              {blockers.map((blocker) => <li key={blocker.code || blocker.message}>{blocker.message}</li>)}
            </ul>
          ) : null}
          {requiredNextSteps.length ? (
            <ol>
              {requiredNextSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          ) : null}
        </div>
      ) : null}

      <footer className={styles.footerNote}>
        {status.notice || policy.notice || "此面板只展示策略与就绪状态，不执行登录、授权或业务写操作。"}
      </footer>
    </section>
  );
}

function providerLabel(provider?: string) {
  if (!provider || provider === "not_configured") return "未配置";
  return provider;
}

function mergeBlockers(...collections: Array<OperatorAccessBlocker[] | undefined>) {
  const seen = new Set<string>();
  return collections.flatMap((collection) => collection || []).filter((blocker) => {
    const key = blocker.code || blocker.message;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
