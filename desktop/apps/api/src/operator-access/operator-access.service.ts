import { createHash, timingSafeEqual } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { appConfig } from "../shared/app-config";
import { OPERATOR_CAPABILITY_MATRIX } from "./operator-access.policy";
import {
  OPERATOR_CAPABILITIES,
  OPERATOR_ROLES,
  OperatorAccessEvaluation,
  OperatorAccessEvaluationInput,
  OperatorCapability,
  OperatorRole,
  TrustedOperatorPrincipal,
} from "./operator-access.types";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const PREFLIGHT_NOTICE =
  "策略评估仅供预检；客户端提交的角色不能建立身份，也不能获得授权。";
const LOCAL_SESSION_NOTICE =
  "受保护的桌面操作已由启动器创建的本机会话执行服务端鉴权；企业 SSO 与独立操作员身份尚未配置。";

export const LOCAL_ADMIN_PRINCIPAL: TrustedOperatorPrincipal = Object.freeze({
  id: "local_admin",
  displayName: "本机桌面管理员",
  role: "admin",
  authenticationProvider: "local_desktop_session",
});

@Injectable()
export class OperatorAccessService {
  authenticateTrustedPrincipal(token: unknown): TrustedOperatorPrincipal | null {
    return constantTimeTokenMatches(appConfig.internalApiToken, token) ? LOCAL_ADMIN_PRINCIPAL : null;
  }

  requireTrustedCapability(token: unknown, capability: OperatorCapability): TrustedOperatorPrincipal {
    const principal = this.authenticateTrustedPrincipal(token);
    if (!principal) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "trusted_local_session_required",
        message: "此操作需要可信的本机桌面会话。",
      });
    }
    if (!OPERATOR_CAPABILITY_MATRIX[principal.role].includes(capability)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "operator_capability_denied",
        capability,
        message: "当前可信操作员没有执行此操作所需的权限。",
      });
    }
    return principal;
  }

  getStatus(token?: unknown) {
    const principal = this.authenticateTrustedPrincipal(token);
    if (principal) {
      return {
        mode: "local_desktop_enforced",
        policyLoaded: true,
        trustedPrincipal: true,
        enforcementReady: true,
        authenticationProvider: "local_desktop_session",
        roleBindingReady: true,
        defaultDecision: "deny",
        principal: { ...principal },
        capabilities: [...OPERATOR_CAPABILITY_MATRIX[principal.role]],
        blockers: [],
        limitations: [
          {
            code: "enterprise_sso_not_configured",
            message: "企业 SSO 尚未配置；当前信任边界仅限启动器创建的本机桌面会话。",
          },
          {
            code: "multi_operator_identity_unavailable",
            message: "独立操作员账号、逐人审计归属和用户角色绑定尚未接入。",
          },
        ],
        requiredNextSteps: [
          "远程或多人部署前接入企业 SSO。",
          "由服务端保存操作员身份与角色绑定，以支持逐人审计。",
        ],
        notice: LOCAL_SESSION_NOTICE,
      } as const;
    }

    const runtimeSessionConfigured = TOKEN_PATTERN.test(String(appConfig.internalApiToken || ""));
    return {
      mode: "preflight_only",
      policyLoaded: true,
      trustedPrincipal: false,
      enforcementReady: false,
      authenticationProvider: "not_authenticated",
      roleBindingReady: false,
      defaultDecision: "deny",
      principal: null,
      capabilities: [],
      blockers: [
        {
          code: runtimeSessionConfigured ? "trusted_session_proof_missing" : "runtime_session_not_configured",
          message: runtimeSessionConfigured
            ? "请求未携带启动器创建的本机桌面会话有效凭证。"
            : "API 未通过受支持的启动器建立有效本机桌面会话。",
        },
      ],
      limitations: [
        {
          code: "enterprise_sso_not_configured",
          message: "企业 SSO 与服务端管理的多操作员角色绑定尚未配置。",
        },
      ],
      requiredNextSteps: ["通过受支持的桌面启动器同时启动 Web 与 API。"],
      notice: PREFLIGHT_NOTICE,
    } as const;
  }

  getPolicy() {
    return {
      version: "v2",
      mode: "local_desktop_enforced",
      defaultDecision: "deny",
      roles: [...OPERATOR_ROLES],
      capabilities: [...OPERATOR_CAPABILITIES],
      matrix: Object.fromEntries(
        OPERATOR_ROLES.map((role) => [role, [...OPERATOR_CAPABILITY_MATRIX[role]]]),
      ) as Record<OperatorRole, OperatorCapability[]>,
      semantics: {
        roleInput: "调用方提交的角色只用于策略预览，不能作为授权依据。",
        policyAllows: "静态角色能力匹配不等于请求已获授权。",
        authorizationGranted: "受保护路由只信任由启动器鉴权的固定本机主体。",
      },
      notice: LOCAL_SESSION_NOTICE,
    } as const;
  }

  evaluate(input: OperatorAccessEvaluationInput = {}): OperatorAccessEvaluation {
    const role = normalized(input.role);
    const capability = normalized(input.capability);
    const roleKnown = Boolean(role && OPERATOR_ROLES.includes(role as OperatorRole));
    const capabilityKnown = Boolean(capability && OPERATOR_CAPABILITIES.includes(capability as OperatorCapability));
    const policyAllows = Boolean(
      roleKnown &&
        capabilityKnown &&
        OPERATOR_CAPABILITY_MATRIX[role as OperatorRole].includes(capability as OperatorCapability),
    );

    return {
      mode: "preflight_only",
      role,
      capability,
      roleKnown,
      capabilityKnown,
      policyAllows,
      authorizationGranted: false,
      enforcementApplied: false,
      trustedPrincipal: false,
      decision: policyAllows ? "policy_match" : "policy_denied",
      reason: evaluationReason({ role, capability, roleKnown, capabilityKnown, policyAllows }),
      notice: PREFLIGHT_NOTICE,
    };
  }
}

export function constantTimeTokenMatches(expected: unknown, actual: unknown) {
  const expectedText = typeof expected === "string" ? expected : "";
  const actualText = typeof actual === "string" ? actual : "";
  const expectedDigest = createHash("sha256").update(expectedText).digest();
  const actualDigest = createHash("sha256").update(actualText).digest();
  const digestMatches = timingSafeEqual(expectedDigest, actualDigest);
  return TOKEN_PATTERN.test(expectedText) && TOKEN_PATTERN.test(actualText) && digestMatches;
}

function normalized(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return text || null;
}

function evaluationReason(input: {
  role: string | null;
  capability: string | null;
  roleKnown: boolean;
  capabilityKnown: boolean;
  policyAllows: boolean;
}) {
  if (!input.role) return "未提供角色，按默认拒绝处理。";
  if (!input.capability) return "未提供能力，按默认拒绝处理。";
  if (!input.roleKnown) return `未知角色 ${input.role}，按默认拒绝处理。`;
  if (!input.capabilityKnown) return `未知能力 ${input.capability}，按默认拒绝处理。`;
  if (!input.policyAllows) return `角色 ${input.role} 不包含能力 ${input.capability}。`;
  return "静态策略已匹配，但该预览不会授予实际权限。";
}
