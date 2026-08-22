import { appConfig } from "../shared/app-config";

export type WechatWorkReadinessStatus = "ready" | "blocked" | "missing";

type ReadinessCheck = {
  key: string;
  status: WechatWorkReadinessStatus;
  detail: string;
  external: boolean;
  reason: string;
  fix: string;
  evidence?: string;
};

type ReadinessPlanPhase = "during_icp" | "after_icp";

type ReadinessPlanItem = {
  key: string;
  title: string;
  detail: string;
  status: WechatWorkReadinessStatus;
  phase: ReadinessPlanPhase;
  owner: "developer" | "operator" | "wechat_admin";
  action: string;
};

type CallbackConsoleField = {
  key: string;
  label: string;
  sourceEnv: string;
  status: WechatWorkReadinessStatus;
  detail: string;
  secret: boolean;
  copyValue?: string;
};

type PreLiveChecklistItem = {
  key: string;
  title: string;
  detail: string;
  status: WechatWorkReadinessStatus;
  phase: "during_icp" | "before_external_joint_test";
  owner: "developer" | "operator" | "wechat_admin";
  verify: string;
  blockedBy?: string;
};

export function buildWechatWorkProductionReadiness(metrics: {
  mappedAccounts: number;
  auditRecords: number;
  authorizedInstallation?: boolean;
  runtimeEvidence?: {
    callbackVerificationAccepted?: boolean;
    callbackAccepted?: boolean;
    inboundProcessed?: boolean;
    sendApiAccepted?: boolean;
  };
}) {
  const baseUrl = String(appConfig.customerServicePublicBaseUrl || "").replace(/\/+$/, "");
  const publicCallbackConfigured = isPublicHttpsBaseUrl(baseUrl);
  const callbackUrl = publicCallbackConfigured ? `${baseUrl}/api/wechat-work/callback` : "";
  const authorizedInstallation = Boolean(metrics.authorizedInstallation);
  const tokenReady = Boolean(String(appConfig.wechatWorkToken || "").trim());
  const aesKeyReady = validEncodingAesKey(appConfig.wechatWorkEncodingAesKey);
  const corpReady = authorizedInstallation || Boolean(String(appConfig.wechatWorkCorpId || "").trim());
  const secretReady = authorizedInstallation || Boolean(String(appConfig.wechatWorkSecret || "").trim());
  const openKfidReady = Boolean(String(appConfig.wechatWorkOpenKfid || "").trim());
  const apiBaseReady = isHttpsUrl(appConfig.wechatWorkApiBaseUrl);
  const adapterReady = appConfig.wechatSendAdapter === "wechat_work_kf";
  const persistenceReady = !appConfig.useLocalStore;
  const callbackVerificationAccepted = Boolean(metrics.runtimeEvidence?.callbackVerificationAccepted);
  const callbackAccepted = Boolean(metrics.runtimeEvidence?.callbackAccepted);
  const inboundProcessed = Boolean(metrics.runtimeEvidence?.inboundProcessed);
  const sendApiAccepted = Boolean(metrics.runtimeEvidence?.sendApiAccepted);
  const callbackRegistrationReady = callbackVerificationAccepted || callbackAccepted;
  const apiPermissionsReady = inboundProcessed && sendApiAccepted;
  const liveCloseLoopReady = callbackAccepted && inboundProcessed && sendApiAccepted;

  const localChecks: ReadinessCheck[] = [
    {
      key: "corp_id",
      status: corpReady ? "ready" : "missing",
      detail: authorizedInstallation
        ? "using an active WeCom suite authorization as the enterprise identity source"
        : appConfig.wechatWorkCorpId
          ? "WECHAT_WORK_CORP_ID is configured"
          : "WECHAT_WORK_CORP_ID is missing",
      reason: corpReady
        ? "Callback decrypt receive-id and official API identity have an enterprise source."
        : "The callback verifier cannot prove which enterprise sent the encrypted message.",
      fix: "Fill WECHAT_WORK_CORP_ID for a static enterprise, or complete the official suite authorization flow before live callback acceptance.",
      external: false,
      evidence: "GET /api/wechat-work/preflight local.checks[corp_id]",
    },
    {
      key: "customer_service_secret",
      status: secretReady ? "ready" : "missing",
      detail: authorizedInstallation
        ? "active suite authorization can exchange an enterprise access token"
        : appConfig.wechatWorkSecret
          ? "WECHAT_WORK_SECRET is configured"
          : "WECHAT_WORK_SECRET is missing",
      reason: secretReady
        ? "Outbound kf/send_msg can obtain an official access token."
        : "The server cannot call sync_msg, media/upload or kf/send_msg without an official token source.",
      fix: "Use the WeCom customer-service Secret, or complete official suite authorization and keep the encrypted permanent_code store available.",
      external: false,
      evidence: "GET /api/wechat-work/status checks",
    },
    {
      key: "callback_token",
      status: tokenReady ? "ready" : "missing",
      detail: tokenReady ? "WECHAT_WORK_TOKEN is configured" : "WECHAT_WORK_TOKEN is missing",
      reason: tokenReady
        ? "The callback signature can be recomputed locally without exposing the Token."
        : "Enterprise WeChat callback verification will fail before decrypting the message.",
      fix: "Generate a Token, put it in WECHAT_WORK_TOKEN, and enter the same value in the WeCom callback page.",
      external: false,
      evidence: "callback msg_signature validation",
    },
    {
      key: "encoding_aes_key",
      status: aesKeyReady ? "ready" : "missing",
      detail: aesKeyReady
        ? "WECHAT_WORK_ENCODING_AES_KEY is 43 characters and decodes to 32 bytes"
        : "WECHAT_WORK_ENCODING_AES_KEY is missing or invalid",
      reason: aesKeyReady
        ? "Encrypted callback bodies can be decrypted with AES-256-CBC."
        : "A wrong EncodingAESKey causes every callback verification and message callback to fail.",
      fix: "Use the 43-character EncodingAESKey generated in the WeCom admin console and keep it only in server env.",
      external: false,
      evidence: "local AES key length and base64 decode check",
    },
    {
      key: "open_kfid",
      status: openKfidReady ? "ready" : "blocked",
      detail: openKfidReady
        ? "WECHAT_WORK_OPEN_KFID is configured for controlled local sync/send checks"
        : "WECHAT_WORK_OPEN_KFID is not configured; live callbacks may carry OpenKfId, but local controlled sync/send cannot target a default customer-service account",
      reason: openKfidReady
        ? "Operators can run a scoped sync/send acceptance against the intended customer-service account."
        : "Before live joint testing, the team must identify which WeCom customer-service account is in scope.",
      fix: "After the customer-service account is created in WeCom, copy its OpenKfId into WECHAT_WORK_OPEN_KFID or pass openKfid explicitly in controlled tests.",
      external: false,
      evidence: "sync_msg cursor scope is per open_kfid",
    },
    {
      key: "official_api_base_url",
      status: apiBaseReady ? "ready" : "missing",
      detail: apiBaseReady ? "WECHAT_WORK_API_BASE_URL uses HTTPS" : "WECHAT_WORK_API_BASE_URL must use HTTPS",
      reason: apiBaseReady
        ? "Official customer-service API calls are pointed at an HTTPS origin."
        : "The official API client refuses an unsafe or malformed WeCom API base URL.",
      fix: "Use https://qyapi.weixin.qq.com unless a verified WeCom-compatible gateway is explicitly required.",
      external: false,
      evidence: "WechatWorkApiClient base URL",
    },
    {
      key: "official_send_adapter",
      status: adapterReady ? "ready" : "missing",
      detail: adapterReady
        ? "WECHAT_SEND_ADAPTER is fixed to wechat_work_kf"
        : "WECHAT_SEND_ADAPTER must be wechat_work_kf for production WeCom sending",
      reason: adapterReady
        ? "Manual reply tasks route through the official WeCom customer-service adapter."
        : "Production sending would fall back to dry-run or a disabled legacy adapter.",
      fix: "Set WECHAT_SEND_ADAPTER=wechat_work_kf before live send acceptance.",
      external: false,
      evidence: "identityPolicy.adapter",
    },
    {
      key: "persistence",
      status: persistenceReady ? "ready" : "missing",
      detail: persistenceReady
        ? "Prisma persistence enabled for bindings, messages, send tasks, attempts and audit logs"
        : "local_store is limited to local/demo mode; production requires USE_LOCAL_STORE=false",
      reason: persistenceReady
        ? "Callback idempotency, customer binding and send audit survive restarts."
        : "JSON local-store cannot be the source of truth for production callback and send records.",
      fix: "Run migrations and set USE_LOCAL_STORE=false in the production/pre-staging runtime.",
      external: false,
      evidence: "WechatPersistence mode",
    },
  ];

  const externalChecks: ReadinessCheck[] = [
    {
      key: "public_callback_url",
      status: callbackRegistrationReady ? "ready" : publicCallbackConfigured ? "blocked" : "missing",
      detail: callbackRegistrationReady
        ? `${callbackUrl} has persisted WeCom callback acceptance evidence`
        : publicCallbackConfigured
          ? `${callbackUrl} is formatted for WeCom admin verification after ICP approval`
        : "ICP-approved public HTTPS callback URL is pending; this is an external launch step, not a local config failure",
      reason: callbackRegistrationReady
        ? "WeCom reached this configured callback URL and the server accepted its encrypted verification or callback."
        : publicCallbackConfigured
        ? "The URL shape is ready, but WeCom must still reach and verify it from the public internet."
        : "Enterprise WeChat will not accept 127.0.0.1, localhost, intranet IPs or non-HTTPS callbacks for production.",
      fix: "After ICP approval, point CUSTOMER_SERVICE_PUBLIC_BASE_URL to the public HTTPS domain and register the callback in WeCom.",
      external: true,
      evidence: "CUSTOMER_SERVICE_PUBLIC_BASE_URL + /api/wechat-work/callback",
    },
    {
      key: "public_https_reachability",
      status: callbackRegistrationReady ? "ready" : publicCallbackConfigured ? "blocked" : "missing",
      detail: callbackRegistrationReady
        ? "persisted callback acceptance proves WeCom reached the HTTPS endpoint"
        : publicCallbackConfigured
        ? "offline preflight does not contact the public callback URL"
        : "wait for ICP approval, then expose the API through a stable public HTTPS origin",
      reason: callbackRegistrationReady
        ? "The readiness report reuses a successful callback audit record instead of probing the public endpoint again."
        : "Local preflight is intentionally read-only and does not prove internet reachability.",
      fix: "Run the WeCom admin callback verification and a controlled public GET/POST callback check after the domain is live.",
      external: true,
      evidence: "external network acceptance required",
    },
    {
      key: "callback_registration",
      status: callbackRegistrationReady
        ? "ready"
        : publicCallbackConfigured && tokenReady && aesKeyReady && corpReady ? "blocked" : "missing",
      detail: callbackRegistrationReady
        ? "WeCom callback verification or a live encrypted callback was accepted and persisted"
        : "verify URL, Token, EncodingAESKey and enterprise receive-id in the WeCom admin console",
      reason: callbackRegistrationReady
        ? "A persisted acceptance record proves the platform accepted the callback configuration."
        : "Only the WeCom admin console can prove the platform accepts the callback configuration.",
      fix: "Use the callback.consoleFields values from this report, then submit verification in the WeCom admin console.",
      external: true,
      evidence: "WeCom admin callback verification",
    },
    {
      key: "customer_service_api_permissions",
      status: apiPermissionsReady ? "ready" : "blocked",
      detail: apiPermissionsReady
        ? "persisted inbound_processed and send_api_accepted records prove sync_msg and send_msg access"
        : "confirm the customer-service account is API-managed and has receive/send permissions",
      reason: apiPermissionsReady
        ? "Both official receive synchronization and official sending have succeeded."
        : "Credential presence does not prove the WeCom customer-service account is allowed to call sync_msg or send_msg.",
      fix: "In WeCom, enable API management for the target customer-service account and grant receive/send permissions.",
      external: true,
      evidence: "controlled sync_msg and send_msg acceptance",
    },
    {
      key: "live_callback_sync_and_send",
      status: liveCloseLoopReady ? "ready" : "blocked",
      detail: liveCloseLoopReady
        ? "persisted callback_accepted, inbound_processed and send_api_accepted records prove the controlled close-loop"
        : inboundProcessed && sendApiAccepted
          ? "sync_msg and send_msg are proven; a persisted live callback_accepted record is still required"
          : "requires a controlled production callback, sync_msg and send_msg acceptance run",
      reason: liveCloseLoopReady
        ? "A real callback, synchronized inbound message and manually approved official reply are all present in audit history."
        : "A production close-loop needs one real inbound customer message and one manually approved official reply.",
      fix: "After callback verification, send a test customer message, confirm sync_msg creates the conversation, then send one approved reply through wechat_work_kf.",
      external: true,
      evidence: "callback -> sync_msg -> send_msg -> audit logs",
    },
  ];

  const localStatus = aggregateStatus(localChecks);
  const externalStatus = aggregateStatus(externalChecks);
  const status: WechatWorkReadinessStatus = localStatus === "missing" ? "missing" : externalStatus;
  const launchPlan = buildLaunchPlan({
    localChecks,
    externalChecks,
    publicCallbackConfigured,
    localStatus,
    status,
  });

  return {
    schema: "smart_kefu_wechat_work_readiness_v1",
    mode: "offline_preflight",
    networkCalls: false,
    status,
    productionReady: status === "ready",
    local: {
      status: localStatus,
      ready: localStatus === "ready",
      checks: localChecks,
    },
    external: {
      status: externalStatus,
      ready: externalStatus === "ready",
      checks: externalChecks,
      blockers: externalChecks.filter((item) => item.status !== "ready").map((item) => item.key),
    },
    callback: {
      path: "/api/wechat-work/callback",
      url: callbackUrl,
      publicHttpsFormatReady: publicCallbackConfigured,
      consoleFields: buildCallbackConsoleFields({
        callbackUrl,
        publicCallbackConfigured,
        tokenReady,
        aesKeyReady,
        corpReady,
        openKfidReady,
        authorizedInstallation,
        callbackRegistrationReady,
      }),
      localVerification: [
        "GET /api/wechat-work/preflight returns schema smart_kefu_wechat_work_readiness_v1",
        "Token and EncodingAESKey are present but never returned as plaintext",
        "WECHAT_SEND_ADAPTER is wechat_work_kf before official send acceptance",
        "No personal-WeChat RPA endpoint is used as the production send path",
      ],
      externalVerification: [
        "WeCom admin verifies callback URL + Token + EncodingAESKey after ICP approval",
        "A test customer message triggers callback and sync_msg for the configured OpenKfId",
        "One manually approved reply is accepted by kf/send_msg and audited",
      ],
    },
    identityPolicy: {
      channel: "work_wechat",
      accountPlatform: "wechat_work_kf",
      adapter: "wechat_work_kf",
      requiresPersistentBinding: true,
      callerSelectableAdapter: false,
    },
    codeContracts: [
      "encrypted_callback_signature_and_receive_id",
      "persistent_msgid_and_callback_deduplication",
      "work_wechat_identity_bound_send",
      "sync_send_retry_and_async_failure_audit",
      "enterprise_wechat_only_no_personal_rpa_production_send",
    ],
    launchPlan,
    preLiveChecklist: buildPreLiveChecklist({
      localStatus,
      publicCallbackConfigured,
      tokenReady,
      aesKeyReady,
      corpReady,
      secretReady,
      openKfidReady,
      adapterReady,
      persistenceReady,
      callbackRegistrationReady,
      liveCloseLoopReady,
    }),
    metrics: {
      mappedAccounts: Math.max(0, Number(metrics.mappedAccounts || 0)),
      auditRecords: Math.max(0, Number(metrics.auditRecords || 0)),
      runtimeEvidence: {
        callbackVerificationAccepted,
        callbackAccepted,
        inboundProcessed,
        sendApiAccepted,
      },
    },
  };
}

function aggregateStatus(checks: ReadinessCheck[]): WechatWorkReadinessStatus {
  if (checks.some((item) => item.status === "missing")) return "missing";
  if (checks.some((item) => item.status === "blocked")) return "blocked";
  return "ready";
}

function buildCallbackConsoleFields(input: {
  callbackUrl: string;
  publicCallbackConfigured: boolean;
  tokenReady: boolean;
  aesKeyReady: boolean;
  corpReady: boolean;
  openKfidReady: boolean;
  authorizedInstallation: boolean;
  callbackRegistrationReady: boolean;
}): CallbackConsoleField[] {
  return [
    {
      key: "callback_url",
      label: "URL",
      sourceEnv: "CUSTOMER_SERVICE_PUBLIC_BASE_URL",
      status: input.callbackRegistrationReady ? "ready" : input.publicCallbackConfigured ? "blocked" : "missing",
      detail: input.callbackRegistrationReady
        ? "WeCom callback acceptance is recorded for this configured URL"
        : input.publicCallbackConfigured
          ? "copy this URL to the WeCom customer-service callback page after ICP approval"
        : "waiting for an ICP-approved public HTTPS domain",
      secret: false,
      copyValue: input.callbackUrl || "{CUSTOMER_SERVICE_PUBLIC_BASE_URL}/api/wechat-work/callback",
    },
    {
      key: "callback_token",
      label: "Token",
      sourceEnv: "WECHAT_WORK_TOKEN",
      status: input.tokenReady ? "ready" : "missing",
      detail: input.tokenReady ? "configured locally; value is intentionally hidden" : "missing locally",
      secret: true,
    },
    {
      key: "encoding_aes_key",
      label: "EncodingAESKey",
      sourceEnv: "WECHAT_WORK_ENCODING_AES_KEY",
      status: input.aesKeyReady ? "ready" : "missing",
      detail: input.aesKeyReady ? "43-character key format is valid; value is intentionally hidden" : "missing or not a valid 43-character key",
      secret: true,
    },
    {
      key: "corp_id",
      label: "CorpId / ReceiveId",
      sourceEnv: input.authorizedInstallation ? "suite authorization" : "WECHAT_WORK_CORP_ID",
      status: input.corpReady ? "ready" : "missing",
      detail: input.corpReady ? "enterprise identity source is present" : "missing enterprise identity source",
      secret: false,
    },
    {
      key: "open_kfid",
      label: "OpenKfid",
      sourceEnv: "WECHAT_WORK_OPEN_KFID",
      status: input.openKfidReady ? "ready" : "blocked",
      detail: input.openKfidReady
        ? "default customer-service account is available for controlled local sync/send checks"
        : "not a secret, but still needed before scoped live joint testing",
      secret: false,
    },
  ];
}

function buildPreLiveChecklist(input: {
  localStatus: WechatWorkReadinessStatus;
  publicCallbackConfigured: boolean;
  tokenReady: boolean;
  aesKeyReady: boolean;
  corpReady: boolean;
  secretReady: boolean;
  openKfidReady: boolean;
  adapterReady: boolean;
  persistenceReady: boolean;
  callbackRegistrationReady: boolean;
  liveCloseLoopReady: boolean;
}) {
  const callbackCryptoReady = combineStatuses(
    input.tokenReady ? "ready" : "missing",
    input.aesKeyReady ? "ready" : "missing",
    input.corpReady ? "ready" : "missing",
  );
  const officialSendReady = combineStatuses(
    input.secretReady ? "ready" : "missing",
    input.openKfidReady ? "ready" : "blocked",
    input.adapterReady ? "ready" : "missing",
    input.persistenceReady ? "ready" : "missing",
  );
  return {
    duringIcp: [
      checklistItem({
        key: "offline_preflight_endpoint",
        title: "Read-only preflight endpoint",
        status: input.localStatus === "missing" ? "missing" : "ready",
        phase: "during_icp",
        owner: "developer",
        detail: "The workbench can read the local WeCom readiness report without calling the WeCom internet API.",
        verify: "GET /api/wechat-work/preflight",
      }),
      checklistItem({
        key: "callback_crypto_material",
        title: "Callback Token and AES material",
        status: callbackCryptoReady,
        phase: "during_icp",
        owner: "operator",
        detail: "Token, EncodingAESKey and enterprise receive-id are ready for later WeCom admin submission.",
        verify: "local.checks callback_token + encoding_aes_key + corp_id",
      }),
      checklistItem({
        key: "official_send_contract",
        title: "Official send contract",
        status: officialSendReady,
        phase: "during_icp",
        owner: "developer",
        detail: "Production send stays on wechat_work_kf, uses durable persistence, and is scoped by OpenKfId.",
        verify: "identityPolicy.adapter and local.checks open_kfid/persistence",
      }),
      checklistItem({
        key: "enterprise_wechat_only_guard",
        title: "Enterprise WeChat only guard",
        status: "ready",
        phase: "during_icp",
        owner: "developer",
        detail: "Personal-WeChat RPA is not exposed as the production send path.",
        verify: "tests/enterprise-wechat-only-api-surface.test.js",
      }),
    ],
    beforeExternalJointTest: [
      checklistItem({
        key: "public_https_callback",
        title: "Public HTTPS callback",
        status: input.callbackRegistrationReady ? "ready" : input.publicCallbackConfigured ? "blocked" : "missing",
        phase: "before_external_joint_test",
        owner: "operator",
        detail: "The API must be reachable through the ICP-approved HTTPS domain before WeCom callback verification.",
        verify: "CUSTOMER_SERVICE_PUBLIC_BASE_URL + /api/wechat-work/callback",
        ...(input.callbackRegistrationReady
          ? {}
          : { blockedBy: input.publicCallbackConfigured ? "WeCom admin verification not run" : "ICP/domain setup pending" }),
      }),
      checklistItem({
        key: "wecom_admin_callback_submission",
        title: "WeCom admin callback submission",
        status: input.callbackRegistrationReady
          ? "ready"
          : input.publicCallbackConfigured && callbackCryptoReady === "ready" ? "blocked" : "missing",
        phase: "before_external_joint_test",
        owner: "wechat_admin",
        detail: "Submit URL, Token and EncodingAESKey in the WeCom customer-service admin console.",
        verify: "WeCom callback verification succeeds",
        ...(input.callbackRegistrationReady ? {} : { blockedBy: "WeCom admin console action required" }),
      }),
      checklistItem({
        key: "controlled_inbound_outbound_acceptance",
        title: "Controlled inbound and outbound acceptance",
        status: input.liveCloseLoopReady ? "ready" : "blocked",
        phase: "before_external_joint_test",
        owner: "developer",
        detail: "Use one test customer message and one manually approved reply to prove callback -> sync_msg -> send_msg.",
        verify: "WeChat Work audit contains callback_accepted, inbound_processed and send_api_accepted or async failure record",
        ...(input.liveCloseLoopReady ? {} : { blockedBy: "public callback verification and WeCom permissions required" }),
      }),
    ],
  };
}

function checklistItem(item: PreLiveChecklistItem): PreLiveChecklistItem {
  return item;
}

function buildLaunchPlan(input: {
  localChecks: ReadinessCheck[];
  externalChecks: ReadinessCheck[];
  publicCallbackConfigured: boolean;
  localStatus: WechatWorkReadinessStatus;
  status: WechatWorkReadinessStatus;
}) {
  const localCheck = (key: string) => input.localChecks.find((item) => item.key === key);
  const externalCheck = (key: string) => input.externalChecks.find((item) => item.key === key);
  const localReady = input.localStatus === "ready";
  const currentPhase = !localReady
    ? "local_configuring"
    : input.status === "ready"
      ? "production_ready"
      : input.publicCallbackConfigured
        ? "external_acceptance"
        : "icp_waiting";
  const recommendedNextAction = !localReady
    ? "先补齐本机企业微信配置、OpenKfid、持久化和官方发送适配器；这些不需要等待备案。"
    : currentPhase === "icp_waiting"
      ? "备案等待期间继续完成本机配置验收、授权状态页和客服发送闭环；备案通过后再做公网回调验收。"
      : currentPhase === "external_acceptance"
        ? "公网 HTTPS 已具备格式条件，下一步到企业微信后台配置回调，并做受控收发验收。"
        : "企业微信本机配置和外部验收均已通过，可以进入生产发布检查。";

  const duringIcp: ReadinessPlanItem[] = [
    {
      key: "credentials_ready",
      title: "企业微信凭证准备",
      detail: "静态企业凭证或服务商扫码授权二选一；页面不保存明文永久授权码。",
      status: combineChecks(localCheck("corp_id"), localCheck("customer_service_secret")),
      phase: "during_icp",
      owner: "operator",
      action: "在 .env 或授权页补齐企业微信身份来源。",
    },
    {
      key: "callback_crypto_ready",
      title: "回调加密参数准备",
      detail: "Token 和 43 位 EncodingAESKey 可以先生成并写入运行环境，备案后再提交企业微信后台。",
      status: combineChecks(localCheck("callback_token"), localCheck("encoding_aes_key")),
      phase: "during_icp",
      owner: "operator",
      action: "生成并记录 WECHAT_WORK_TOKEN 与 WECHAT_WORK_ENCODING_AES_KEY。",
    },
    {
      key: "open_kfid_ready",
      title: "客服账号 OpenKfid 准备",
      detail: "OpenKfid 用于限定 sync_msg 游标和受控发送验收范围，不是个人微信账号。",
      status: localCheck("open_kfid")?.status || "missing",
      phase: "during_icp",
      owner: "operator",
      action: "在企业微信客服账号创建后，把 OpenKfid 写入 WECHAT_WORK_OPEN_KFID。",
    },
    {
      key: "server_contract_ready",
      title: "服务端发送与持久化契约",
      detail: "人工回复固定走 wechat_work_kf，生产数据必须落到 Prisma 持久化。",
      status: combineChecks(localCheck("official_send_adapter"), localCheck("persistence")),
      phase: "during_icp",
      owner: "developer",
      action: localCheck("persistence")?.status === "ready"
        ? "确认 WECHAT_SEND_ADAPTER=wechat_work_kf，并通过数据库迁移状态与 API dataMode=prisma 验收。"
        : "先准备 PostgreSQL、执行 Prisma 生产迁移和本地 JSON 数据导入，再在生产/预发布进程设置 USE_LOCAL_STORE=false；不能只修改 .env。",
    },
    {
      key: "operator_preflight_ready",
      title: "运营预检页面",
      detail: "工作台可离线读取真实配置状态，不调用企业微信外网。",
      status: "ready",
      phase: "during_icp",
      owner: "developer",
      action: "通过 /integrations/wechat-work 刷新并核对预检结果。",
    },
  ];

  const afterIcp: ReadinessPlanItem[] = [
    {
      key: "public_https_callback",
      title: "备案域名与 HTTPS 回调",
      detail: "企业微信正式回调必须使用稳定公网 HTTPS 域名。",
      status: externalCheck("public_callback_url")?.status || (input.publicCallbackConfigured ? "blocked" : "missing"),
      phase: "after_icp",
      owner: "operator",
      action: input.publicCallbackConfigured
        ? "公网 HTTPS URL 已配置；下一步在企业微信后台提交回调校验，让服务端持久化 callback_accepted 证据。"
        : "将 CUSTOMER_SERVICE_PUBLIC_BASE_URL 指向已备案的公网 HTTPS 域名。",
    },
    {
      key: "wecom_callback_registration",
      title: "企业微信后台回调校验",
      detail: "在企业微信后台填写 URL、Token、EncodingAESKey 并通过校验。",
      status: externalCheck("callback_registration")?.status || "blocked",
      phase: "after_icp",
      owner: "wechat_admin",
      action: "备案通过后在企业微信后台提交回调配置。",
    },
    {
      key: "live_receive_send_acceptance",
      title: "受控收发验收",
      detail: "用测试客户消息完成 callback、sync_msg、send_msg 和审计记录闭环。",
      status: externalCheck("live_callback_sync_and_send")?.status || "blocked",
      phase: "after_icp",
      owner: "developer",
      action: "用测试会话执行一次真实入站和人工回复。",
    },
  ];

  return {
    currentPhase,
    recommendedNextAction,
    duringIcp,
    afterIcp,
  };
}

function combineChecks(...checks: Array<ReadinessCheck | undefined>): WechatWorkReadinessStatus {
  return combineStatuses(...checks.map((item) => item?.status || "missing"));
}

function combineStatuses(...statuses: WechatWorkReadinessStatus[]): WechatWorkReadinessStatus {
  if (statuses.some((status) => status === "missing")) return "missing";
  if (statuses.some((status) => status === "blocked")) return "blocked";
  return "ready";
}

function isHttpsUrl(value: string) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

function isPublicHttpsBaseUrl(value: string) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return false;
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return hostname.includes(".");
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((item) => item < 0 || item > 255)) return false;
    if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) return false;
    if (octets[0] === 169 && octets[1] === 254) return false;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
    if (octets[0] === 192 && octets[1] === 168) return false;
    return true;
  } catch {
    return false;
  }
}

function validEncodingAesKey(value: string) {
  const text = String(value || "").trim();
  if (text.length !== 43) return false;
  try {
    return Buffer.from(`${text}=`, "base64").length === 32;
  } catch {
    return false;
  }
}
