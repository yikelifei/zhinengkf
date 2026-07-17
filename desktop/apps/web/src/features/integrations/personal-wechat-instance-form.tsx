"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import type {
  PersonalWechatRpaInstance,
  PersonalWechatRpaInstanceInput,
  PersonalWechatRpaInstanceValidation,
} from "../../lib/api";
import { errorMessage } from "./feature-page";
import styles from "./integration-pages.module.css";

type InstanceFormProps = {
  instance: PersonalWechatRpaInstance | null;
  busy?: boolean;
  onValidate: (draft: PersonalWechatRpaInstanceInput) => Promise<PersonalWechatRpaInstanceValidation>;
  onSave: (draft: PersonalWechatRpaInstanceInput) => Promise<void>;
};

type PendingAction = "validate" | "save" | null;

export function PersonalWechatInstanceForm({ instance, busy = false, onValidate, onSave }: InstanceFormProps) {
  const editing = Boolean(instance);
  const [wechatAccountId, setWechatAccountId] = useState(instance?.wechatAccountId || "");
  const [accountNickname, setAccountNickname] = useState(instance?.accountNickname || "");
  const [endpoint, setEndpoint] = useState(instance?.endpoint || "http://127.0.0.1:3211");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(instance?.enabled ?? true);
  const [validation, setValidation] = useState<PersonalWechatRpaInstanceValidation | null>(null);
  const [localError, setLocalError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const operationBusy = busy || pendingAction !== null;

  function buildDraft(): PersonalWechatRpaInstanceInput {
    return {
      wechatAccountId: wechatAccountId.trim(),
      accountNickname: accountNickname.trim(),
      endpoint: endpoint.trim(),
      token: token.trim() || undefined,
      enabled,
    };
  }

  function changeField(setter: (value: string) => void, value: string) {
    setter(value);
    setValidation(null);
    setLocalError("");
  }

  async function validateDraft() {
    if (operationBusy) return;
    setPendingAction("validate");
    setLocalError("");
    try {
      setValidation(await onValidate(buildDraft()));
    } catch (validationError) {
      setValidation(null);
      setLocalError(errorMessage(validationError, "验证实例失败"));
    } finally {
      setPendingAction(null);
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
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
    } catch (saveError) {
      setToken("");
      setLocalError(errorMessage(saveError, "保存实例失败，请重新输入令牌后再试"));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <form className={styles.panel} aria-label={editing ? "编辑个人微信实例" : "新增个人微信实例"} onSubmit={saveDraft}>
      <header className={styles.panelHeader}>
        <div>
          <h2>{editing ? "编辑实例配置" : "新增实例配置"}</h2>
          <p>{editing ? "令牌留空时保留服务端已有令牌。" : "所有连接信息只用于本机 RPA。"}</p>
        </div>
      </header>
      <div className={styles.formGrid}>
        <label className={styles.field} htmlFor="personal-wechat-account-id">
          <span>微信账号 ID</span>
          <input
            id="personal-wechat-account-id"
            value={wechatAccountId}
            onChange={(event) => changeField(setWechatAccountId, event.target.value)}
            disabled={operationBusy || editing}
            autoComplete="off"
            required
          />
        </label>
        <label className={styles.field} htmlFor="personal-wechat-nickname">
          <span>微信昵称</span>
          <input
            id="personal-wechat-nickname"
            value={accountNickname}
            onChange={(event) => changeField(setAccountNickname, event.target.value)}
            disabled={operationBusy}
            autoComplete="off"
            required
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="personal-wechat-endpoint">
          <span>本机 RPA Endpoint</span>
          <input
            id="personal-wechat-endpoint"
            value={endpoint}
            onChange={(event) => changeField(setEndpoint, event.target.value)}
            disabled={operationBusy}
            inputMode="url"
            autoComplete="off"
            required
          />
          <small>仅接受带端口的 127.0.0.1、localhost 或 ::1 HTTP 地址。</small>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="personal-wechat-token">
          <span><KeyRound size={13} aria-hidden="true" /> 实例令牌</span>
          <input
            id="personal-wechat-token"
            type="password"
            value={token}
            onChange={(event) => changeField(setToken, event.target.value)}
            disabled={operationBusy}
            placeholder={editing ? "留空则保留现有令牌" : "输入本机实例令牌"}
            autoComplete="new-password"
            required={!editing}
          />
        </label>
      </div>
      <label className={styles.checkboxField} htmlFor="personal-wechat-enabled">
        <input
          id="personal-wechat-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(event) => { setEnabled(event.target.checked); setValidation(null); }}
          disabled={operationBusy}
        />
        <span>保存后启用此实例<small>启用后仍需通过身份与窗口安全校验才允许发送。</small></span>
      </label>
      {validation ? (
        <div className={`${styles.validation} ${validation.ok ? styles.validationSuccess : styles.validationError}`} role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{validation.ok ? "配置校验通过，可以保存。" : validation.errors.join("；")}</span>
        </div>
      ) : null}
      {localError ? <p className={styles.formError} role="alert">{localError}</p> : null}
      <div className={styles.buttonRow}>
        <button
          type="button"
          data-action-id="integrations.personal-wechat.instance-config.validate"
          aria-label="验证个人微信实例配置"
          onClick={() => void validateDraft()}
          disabled={operationBusy}
        >
          {pendingAction === "validate" ? <LoaderCircle size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
          验证配置
        </button>
        <button
          type="submit"
          className={styles.primaryButton}
          data-action-id="integrations.personal-wechat.instance-config.save"
          aria-label="保存个人微信实例配置"
          disabled={operationBusy}
        >
          {pendingAction === "save" ? <LoaderCircle size={15} aria-hidden="true" /> : null}
          {pendingAction === "save" ? "保存中" : "保存实例"}
        </button>
      </div>
    </form>
  );
}
