"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import {
  PersonalWechatInstancesPanel,
  type PersonalWechatInstanceDraft,
  type PersonalWechatInstanceValidation,
} from "../../components/personal-wechat-instances-panel";
import {
  disablePersonalWechatRpaInstance,
  getPersonalWechatRpaRegistry,
  savePersonalWechatRpaInstance,
  validatePersonalWechatRpaInstance,
  type PersonalWechatRpaRegistry,
} from "../../lib/api";
import { FeatureNotice, FeaturePage, errorMessage } from "./feature-page";

export function PersonalWechatInstancesPage() {
  const [registry, setRegistry] = useState<PersonalWechatRpaRegistry | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const requestSequence = useRef(0);

  const refreshRegistry = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await getPersonalWechatRpaRegistry();
      if (sequence === requestSequence.current) setRegistry(next);
    } catch (refreshError) {
      if (sequence === requestSequence.current) setError(errorMessage(refreshError, "个人微信实例读取失败"));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshRegistry();
    return () => { requestSequence.current += 1; };
  }, [refreshRegistry]);

  async function validateInstance(draft: PersonalWechatInstanceDraft): Promise<PersonalWechatInstanceValidation> {
    const result = await validatePersonalWechatRpaInstance(draft);
    if (result.registry) setRegistry(result.registry);
    return { ok: result.ok, errors: result.errors, instance: result.instance };
  }

  async function saveInstance(draft: PersonalWechatInstanceDraft) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const result = await savePersonalWechatRpaInstance(draft);
      setRegistry(result.registry);
      setFeedback(result.operation === "created" ? "个人微信实例已新增。" : "个人微信实例已更新。");
    } catch (saveError) {
      setError(errorMessage(saveError, "个人微信实例保存失败"));
      throw saveError;
    } finally {
      setBusy(false);
    }
  }

  async function disableInstance(wechatAccountId: string) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const result = await disablePersonalWechatRpaInstance(wechatAccountId);
      setRegistry(result.registry);
      setFeedback(result.operation === "disabled" ? "实例已停用并保留配置记录。" : "实例已经处于停用状态。");
    } catch (disableError) {
      setError(errorMessage(disableError, "个人微信实例停用失败"));
      throw disableError;
    } finally {
      setBusy(false);
    }
  }

  return (
    <FeaturePage
      id="personal-wechat-instances-page"
      title="个人微信实例设置"
      description="只负责本机 RPA 实例的验证、保存和停用；令牌仍由服务端安全存储。"
      icon={<Settings2 size={20} />}
      busy={busy}
      actions={(
        <button
          type="button"
          data-action-id="integrations.personal-wechat.instances.refresh"
          aria-label="刷新个人微信实例列表"
          onClick={() => void refreshRegistry()}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新实例
        </button>
      )}
    >
      {error ? <FeatureNotice tone="error" title="实例操作未完成">{error}</FeatureNotice> : null}
      {feedback ? <FeatureNotice tone="success" title="实例配置已更新">{feedback}</FeatureNotice> : null}
      <PersonalWechatInstancesPanel
        registry={registry}
        busy={busy}
        error={error}
        onValidate={validateInstance}
        onSave={saveInstance}
        onDisable={disableInstance}
      />
    </FeaturePage>
  );
}
