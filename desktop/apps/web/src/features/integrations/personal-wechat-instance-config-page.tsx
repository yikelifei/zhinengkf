"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  disablePersonalWechatRpaInstance,
  getPersonalWechatRpaRegistry,
  savePersonalWechatRpaInstance,
  validatePersonalWechatRpaInstance,
  type PersonalWechatRpaInstanceInput,
} from "../../lib/api";
import { EmptyState, FeatureNotice, FeaturePage } from "./feature-page";
import styles from "./integration-pages.module.css";
import { PersonalWechatInstanceDangerZone } from "./personal-wechat-instance-danger-zone";
import { PersonalWechatInstanceForm } from "./personal-wechat-instance-form";
import { useAsyncResource } from "./use-async-resource";

type PersonalWechatInstanceConfigPageProps = { accountId?: string };

export function PersonalWechatInstanceConfigPage({ accountId = "" }: PersonalWechatInstanceConfigPageProps) {
  const router = useRouter();
  const registryResource = useAsyncResource(getPersonalWechatRpaRegistry, "个人微信实例读取失败");
  const [operationBusy, setOperationBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [operationError, setOperationError] = useState("");
  const instance = accountId
    ? registryResource.data?.instances.find((candidate) => candidate.wechatAccountId === accountId) || null
    : null;
  const missingInstance = Boolean(accountId && registryResource.data && !instance);

  async function saveInstance(draft: PersonalWechatRpaInstanceInput) {
    setOperationBusy(true);
    setOperationError("");
    setFeedback("");
    try {
      const result = await savePersonalWechatRpaInstance(draft);
      registryResource.replace(result.registry);
      setFeedback(result.operation === "created" ? "个人微信实例已新增。" : "个人微信实例配置已更新。");
      router.replace(`/integrations/personal-wechat/instances/configure?accountId=${encodeURIComponent(result.instance.wechatAccountId)}`);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "个人微信实例保存失败");
      throw error;
    } finally {
      setOperationBusy(false);
    }
  }

  async function disableInstance(wechatAccountId: string) {
    setOperationBusy(true);
    setOperationError("");
    setFeedback("");
    try {
      const result = await disablePersonalWechatRpaInstance(wechatAccountId);
      registryResource.replace(result.registry);
      setFeedback(result.operation === "disabled" ? "实例已停用并保留配置记录。" : "实例已经处于停用状态。");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "个人微信实例停用失败");
      throw error;
    } finally {
      setOperationBusy(false);
    }
  }

  return (
    <FeaturePage
      id="personal-wechat-instance-config-page"
      title={accountId ? "配置个人微信实例" : "新增个人微信实例"}
      description="只负责一个实例的校验与保存；停用操作隔离在页面底部的独立确认区。"
      icon={<Settings2 size={20} />}
      busy={registryResource.busy || operationBusy}
      actions={(
        <Link className={styles.actionLink} href="/integrations/personal-wechat/instances" aria-label="返回个人微信实例列表">
          返回实例列表
        </Link>
      )}
    >
      {registryResource.error ? <FeatureNotice tone="error" title="个人微信实例读取失败">{registryResource.error}</FeatureNotice> : null}
      {operationError ? <FeatureNotice tone="error" title="实例操作未完成">{operationError}</FeatureNotice> : null}
      {feedback ? <FeatureNotice tone="success" title="实例配置已更新">{feedback}</FeatureNotice> : null}
      {missingInstance ? (
        <EmptyState title={`未找到实例 ${accountId}`} detail="返回实例列表后重新选择，页面不会回退到其他账号。" />
      ) : null}
      {!registryResource.error && !missingInstance && (!accountId || instance) ? (
        <>
          <PersonalWechatInstanceForm
            key={accountId || "new"}
            instance={instance}
            busy={operationBusy}
            onValidate={validatePersonalWechatRpaInstance}
            onSave={saveInstance}
          />
          {instance ? (
            <PersonalWechatInstanceDangerZone
              key={`${instance.wechatAccountId}:${instance.enabled}`}
              instance={instance}
              busy={operationBusy}
              onDisable={disableInstance}
            />
          ) : null}
        </>
      ) : null}
    </FeaturePage>
  );
}
