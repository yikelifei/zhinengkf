"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  PencilLine,
  Plus,
  Power,
  ShieldCheck,
  X,
} from "lucide-react";
import styles from "./personal-wechat-instances-panel.module.css";

export type PersonalWechatRegistryMode = "registry" | "legacy_single" | "unconfigured";

export type PersonalWechatInstanceView = {
  wechatAccountId: string;
  endpoint: string;
  port: number | null;
  accountNickname: string;
  enabled: boolean;
  tokenConfigured: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  errors?: string[];
};

export type PersonalWechatRegistryReadiness = {
  version: string;
  ready: boolean;
  mode: PersonalWechatRegistryMode;
  activeCount: number;
  disabledCount: number;
  instances: PersonalWechatInstanceView[];
  checks?: Array<{ key: string; ok: boolean; detail: string }>;
  errors?: string[];
  legacy?: {
    present: boolean;
    used: boolean;
    ready: boolean;
    endpoint: string;
    port: number | null;
    accountNickname: string | null;
    tokenConfigured: boolean;
  };
};

export type PersonalWechatInstanceDraft = {
  wechatAccountId: string;
  endpoint: string;
  accountNickname: string;
  enabled: boolean;
  token?: string;
};

export type PersonalWechatInstanceValidation = {
  ok: boolean;
  errors: string[];
  instance?: PersonalWechatInstanceView | null;
};

export type PersonalWechatInstancesPanelProps = {
  registry: PersonalWechatRegistryReadiness | null;
  initialAccountId?: string;
  busy?: boolean;
  error?: string;
  onValidate: (draft: PersonalWechatInstanceDraft) => Promise<PersonalWechatInstanceValidation>;
  onSave: (draft: PersonalWechatInstanceDraft) => Promise<void>;
  onDisable: (wechatAccountId: string) => Promise<void>;
};

type PendingAction = "validate" | "save" | `disable:${string}` | null;

export function PersonalWechatInstancesPanel({
  registry,
  initialAccountId = "",
  busy = false,
  error,
  onValidate,
  onSave,
  onDisable,
}: PersonalWechatInstancesPanelProps) {
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [wechatAccountId, setWechatAccountId] = useState("");
  const [accountNickname, setAccountNickname] = useState("");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:3211");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [validation, setValidation] = useState<PersonalWechatInstanceValidation | null>(null);
  const [localError, setLocalError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const initialSelectionHandled = useRef("");

  const operationBusy = busy || pendingAction !== null;
  const readinessErrors = collectReadinessErrors(registry);

  function openCreate() {
    setEditorMode("create");
    setWechatAccountId("");
    setAccountNickname("");
    setEndpoint("http://127.0.0.1:3211");
    setToken("");
    setEnabled(true);
    setValidation(null);
    setLocalError("");
    setConfirmDisableId(null);
  }

  function openEdit(instance: PersonalWechatInstanceView) {
    setEditorMode("edit");
    setWechatAccountId(instance.wechatAccountId);
    setAccountNickname(instance.accountNickname);
    setEndpoint(instance.endpoint);
    setToken("");
    setEnabled(instance.enabled);
    setValidation(null);
    setLocalError("");
    setConfirmDisableId(null);
  }

  useEffect(() => {
    if (!initialAccountId || !registry || initialSelectionHandled.current === initialAccountId) return;
    initialSelectionHandled.current = initialAccountId;
    const instance = registry.instances.find((candidate) => candidate.wechatAccountId === initialAccountId);
    if (!instance) {
      setLocalError(`未找到个人微信实例 ${initialAccountId}，请返回实例列表重新选择。`);
      return;
    }
    openEdit(instance);
  }, [initialAccountId, registry]);

  function closeEditor() {
    setEditorMode(null);
    setWechatAccountId("");
    setAccountNickname("");
    setEndpoint("http://127.0.0.1:3211");
    setToken("");
    setEnabled(true);
    setValidation(null);
    setLocalError("");
  }

  function buildDraft(): PersonalWechatInstanceDraft {
    return {
      wechatAccountId: wechatAccountId.trim(),
      endpoint: endpoint.trim(),
      accountNickname: accountNickname.trim(),
      enabled,
      token: token.trim() || undefined,
    };
  }

  async function validateDraft() {
    if (operationBusy) return;
    setPendingAction("validate");
    setLocalError("");
    try {
      const result = await onValidate(buildDraft());
      setValidation(result);
    } catch (validationError) {
      setValidation(null);
      setLocalError(errorMessage(validationError, "验证实例失败"));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationBusy) return;
    const draft = buildDraft();
    setPendingAction("save");
    setLocalError("");
    try {
      const result = await onValidate(draft);
      setValidation(result);
      if (!result.ok) return;
      setToken("");
      await onSave(draft);
      closeEditor();
    } catch (saveError) {
      setToken("");
      setLocalError(errorMessage(saveError, "保存实例失败，请重新输入令牌后再试"));
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmDisable() {
    const accountId = confirmDisableId;
    if (!accountId || operationBusy) return;
    setPendingAction(`disable:${accountId}`);
    setLocalError("");
    try {
      await onDisable(accountId);
      setConfirmDisableId(null);
      if (editorMode === "edit" && wechatAccountId === accountId) closeEditor();
    } catch (disableError) {
      setLocalError(errorMessage(disableError, "停用实例失败"));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="personal-wechat-instances-title"
      aria-busy={operationBusy}
    >
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 id="personal-wechat-instances-title">个人微信实例</h2>
          <p>每个微信账号使用独立的本机 RPA 端点与令牌。</p>
        </div>
        <div className={styles.headerActions}>
          <ReadinessState registry={registry} />
          <button
            type="button"
            className={styles.primaryButton}
            data-action-id="integrations.personal-wechat.instances.open-create"
            aria-label="新增个人微信实例"
            onClick={openCreate}
            disabled={operationBusy}
          >
            <Plus size={15} aria-hidden="true" />新增实例
          </button>
        </div>
      </header>

      <div className={styles.summary} aria-label="实例就绪情况">
        <span><b>{registry?.activeCount ?? 0}</b> 个启用</span>
        <span><b>{registry?.disabledCount ?? 0}</b> 个停用</span>
        <span>配置模式：<b>{registryModeLabel(registry?.mode)}</b></span>
      </div>

      {readinessErrors.length > 0 ? (
        <div className={styles.readinessAlert} role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>配置需要处理</strong>
            <ul>{readinessErrors.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
      ) : null}
      {error || localError ? <div className={styles.errorAlert} role="alert">{localError || error}</div> : null}

      {editorMode ? (
        <form className={styles.editor} aria-label={editorMode === "create" ? "新增个人微信实例" : "编辑个人微信实例"} onSubmit={saveDraft}>
          <div className={styles.editorHeader}>
            <div>
              <strong>{editorMode === "create" ? "新增实例" : "编辑实例"}</strong>
              <span>{editorMode === "edit" ? "令牌留空时保留当前令牌。" : "所有连接信息仅用于本机 RPA。"}</span>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              data-action-id="integrations.personal-wechat.instances.close-editor"
              onClick={closeEditor}
              disabled={operationBusy}
              aria-label="关闭实例表单"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className={styles.formGrid}>
            <label>
              <span>微信账号 ID</span>
              <input
                value={wechatAccountId}
                onChange={(event) => setWechatAccountId(event.target.value)}
                disabled={operationBusy || editorMode === "edit"}
                placeholder="例如 account_design_3"
                autoComplete="off"
                required
              />
            </label>
            <label>
              <span>微信昵称</span>
              <input
                value={accountNickname}
                onChange={(event) => setAccountNickname(event.target.value)}
                disabled={operationBusy}
                placeholder="必须与登录微信昵称一致"
                autoComplete="off"
                required
              />
            </label>
            <label className={styles.endpointField}>
              <span>本机 RPA Endpoint</span>
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                disabled={operationBusy}
                placeholder="http://127.0.0.1:3211"
                inputMode="url"
                autoComplete="off"
                required
              />
              <small>仅接受带端口的 127.0.0.1、localhost 或 ::1 HTTP 地址。</small>
            </label>
            <label className={styles.tokenField}>
              <span><KeyRound size={13} aria-hidden="true" />实例令牌</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={operationBusy}
                placeholder={editorMode === "edit" ? "留空则保留现有令牌" : "输入本机实例令牌"}
                autoComplete="new-password"
                required={editorMode === "create"}
              />
            </label>
          </div>

          <label className={styles.switchField}>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={operationBusy} />
            <span>保存后启用此实例</span>
          </label>

          {validation ? (
            <div className={validation.ok ? styles.validationSuccess : styles.validationError} role="status">
              {validation.ok ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
              <span>{validation.ok ? "配置校验通过，可以保存。" : validation.errors.join("；")}</span>
            </div>
          ) : null}

          <div className={styles.editorFooter}>
            <button
              type="button"
              className={styles.secondaryButton}
              data-action-id="integrations.personal-wechat.instances.cancel-edit"
              aria-label="取消编辑个人微信实例"
              onClick={closeEditor}
              disabled={operationBusy}
            >取消</button>
            <button
              type="button"
              className={styles.secondaryButton}
              data-action-id="integrations.personal-wechat.instances.validate"
              aria-label="验证个人微信实例配置"
              onClick={() => void validateDraft()}
              disabled={operationBusy}
            >
              {pendingAction === "validate" ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
              验证配置
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              data-action-id="integrations.personal-wechat.instances.save"
              aria-label="保存个人微信实例"
              disabled={operationBusy}
            >
              {pendingAction === "save" ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : null}
              {pendingAction === "save" ? "保存中" : "保存实例"}
            </button>
          </div>
        </form>
      ) : null}

      <div className={styles.listHeader} aria-hidden="true">
        <span>账号</span><span>本机端点</span><span>状态</span><span>操作</span>
      </div>

      <div className={styles.instanceList} aria-label="个人微信 RPA 实例列表">
        {registry?.instances.length ? registry.instances.map((instance) => {
          const instanceErrors = collectInstanceErrors(instance);
          const disabling = pendingAction === `disable:${instance.wechatAccountId}`;
          return (
            <article className={styles.instanceRow} key={instance.wechatAccountId}>
              <div className={styles.accountCell}>
                <strong>{instance.accountNickname || "未命名微信"}</strong>
                <span>{instance.wechatAccountId}</span>
              </div>
              <div className={styles.endpointCell}>
                <code title={instance.endpoint}>{instance.endpoint || "无有效本机地址"}</code>
                <small>{instance.port ? `端口 ${instance.port}` : "端口未配置"}</small>
              </div>
              <div className={styles.statusCell}>
                <span className={instance.enabled ? styles.enabledState : styles.disabledState}>
                  {instance.enabled ? "已启用" : "已停用"}
                </span>
                <small>{instance.tokenConfigured ? "令牌已配置" : "令牌未配置"}</small>
              </div>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.textButton}
                  data-action-id={`integrations.personal-wechat.instances.edit.${instance.wechatAccountId}`}
                  aria-label={`编辑个人微信实例 ${instance.accountNickname || instance.wechatAccountId}`}
                  onClick={() => openEdit(instance)}
                  disabled={operationBusy}
                >
                  <PencilLine size={14} aria-hidden="true" />编辑
                </button>
                {instance.enabled ? (
                  <button
                    type="button"
                    className={styles.dangerButton}
                    data-action-id={`integrations.personal-wechat.instances.request-disable.${instance.wechatAccountId}`}
                    aria-label={`请求停用个人微信实例 ${instance.accountNickname || instance.wechatAccountId}`}
                    onClick={() => setConfirmDisableId(instance.wechatAccountId)}
                    disabled={operationBusy}
                  >
                    <Power size={14} aria-hidden="true" />停用
                  </button>
                ) : null}
              </div>

              {instanceErrors.length ? (
                <div className={styles.instanceErrors} role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>{instanceErrors.join("；")}</span>
                </div>
              ) : null}

              {confirmDisableId === instance.wechatAccountId ? (
                <div
                  className={styles.disableConfirm}
                  role="region"
                  aria-live="polite"
                  aria-label={`确认停用 ${instance.accountNickname || instance.wechatAccountId}`}
                >
                  <span>停用后该账号将立即停止路由。确认停用？</span>
                  <div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      data-action-id={`integrations.personal-wechat.instances.cancel-disable.${instance.wechatAccountId}`}
                      aria-label={`取消停用个人微信实例 ${instance.accountNickname || instance.wechatAccountId}`}
                      onClick={() => setConfirmDisableId(null)}
                      disabled={operationBusy}
                    >取消</button>
                    <button
                      type="button"
                      className={styles.confirmDangerButton}
                      data-action-id={`integrations.personal-wechat.instances.confirm-disable.${instance.wechatAccountId}`}
                      aria-label={`确认停用个人微信实例 ${instance.accountNickname || instance.wechatAccountId}`}
                      onClick={() => void confirmDisable()}
                      disabled={operationBusy}
                    >
                      {disabling ? <LoaderCircle className={styles.spinner} size={14} aria-hidden="true" /> : null}
                      {disabling ? "停用中" : "确认停用"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        }) : (
          <div className={styles.emptyState}>
            <ShieldCheck size={22} aria-hidden="true" />
            <strong>{registry?.mode === "legacy_single" ? "当前仍使用旧版单实例配置" : "尚未配置个人微信实例"}</strong>
            <span>{registry?.mode === "legacy_single" ? "新增实例后即可按微信账号独立管理。" : "先新增一个本机 RPA 实例。"}</span>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="integrations.personal-wechat.instances.empty-create"
              aria-label="新增第一个个人微信实例"
              onClick={openCreate}
              disabled={operationBusy}
            >新增实例</button>
          </div>
        )}
      </div>
    </section>
  );
}

function ReadinessState({ registry }: { registry: PersonalWechatRegistryReadiness | null }) {
  if (!registry) return <span className={styles.loadingState}>载入中</span>;
  if (registry.ready) {
    return <span className={styles.readyState}><CheckCircle2 size={14} aria-hidden="true" />运行就绪</span>;
  }
  return <span className={styles.warningState}><AlertTriangle size={14} aria-hidden="true" />需要处理</span>;
}

function collectReadinessErrors(registry: PersonalWechatRegistryReadiness | null) {
  if (!registry) return [];
  const errors = [...(registry.errors || [])];
  for (const check of registry.checks || []) {
    if (!check.ok && check.detail && check.detail !== "missing") errors.push(check.detail);
  }
  return [...new Set(errors)];
}

function collectInstanceErrors(instance: PersonalWechatInstanceView) {
  const errors = [...(instance.errors || [])];
  if (instance.enabled && !instance.endpoint) errors.push("本机端点无效");
  if (instance.enabled && !instance.port) errors.push("端口未配置");
  if (instance.enabled && !instance.tokenConfigured) errors.push("令牌未配置");
  return [...new Set(errors)];
}

function registryModeLabel(mode?: PersonalWechatRegistryMode) {
  if (mode === "registry") return "多实例";
  if (mode === "legacy_single") return "旧版单实例";
  return "未配置";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
