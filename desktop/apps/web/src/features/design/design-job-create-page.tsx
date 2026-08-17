"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWechatConversations, type BundleRecommendation, type Conversation, type DesignJob, type IdentityFilters } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import { createDesignJob } from "./api";
import { ensureCustomerReferenceAsset } from "./design-job-create-assets";
import type { DesignJobCreateAssetSelection, DesignJobCreateAssetTarget } from "./design-job-create-asset-picker";
import { DesignJobCreateForm } from "./design-job-create-form";
import {
  DEFAULT_DESIGN_JOB_FORM,
  designJobCreateReadiness,
  designJobBundleFromForm,
  initialConversation,
  positiveNumber,
  type DesignJobCatalogSelection,
  type DesignJobCreateFormState,
} from "./design-job-create-model";
import { hasIdentityScope, identityMatchesConversation } from "../catalog/catalog-journey-state";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText } from "./design-ui";

export function DesignJobCreatePage({ initialIdentityFilters = {} }: { initialIdentityFilters?: IdentityFilters }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<DesignJobCreateFormState>(DEFAULT_DESIGN_JOB_FORM);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [createdJob, setCreatedJob] = useState<DesignJob | null>(null);
  const [bundleRecommendation, setBundleRecommendation] = useState<BundleRecommendation | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);

  async function refreshConversations() {
    setLoading(true);
    setLoadError("");
    try {
      const rows = await getWechatConversations();
      const identityScoped = hasIdentityScope(initialIdentityFilters);
      const scopedRows = identityScoped
        ? rows.filter((conversation) => identityMatchesConversation(conversation, initialIdentityFilters))
        : rows;
      setConversations(scopedRows);
      setLoaded(true);
      const preferredConversation = initialConversation(scopedRows, initialIdentityFilters) || (identityScoped ? undefined : scopedRows[0]);
      setForm((current) => {
        if (current.conversationId && scopedRows.some((conversation) => conversation.id === current.conversationId)) return current;
        return {
          ...current,
          conversationId: preferredConversation?.id || "",
          customerAssetId: "",
          customerAssetUrl: "",
          customerAssetName: "客户参考图",
        };
      });
      if (identityScoped && !preferredConversation) {
        setLoadError("当前企业微信账号、客户和会话身份未能匹配，已阻止回退到其他客户。请返回原会话重试。");
      }
    } catch (cause) {
      setLoaded(conversations.length > 0);
      setLoadError(`${errorText(cause, "会话读取失败")}${conversations.length ? "；已保留上一次可信会话，提交前请核对客户身份。" : ""}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refreshConversations(); }, [initialIdentityFilters.wechatAccountId, initialIdentityFilters.conversationId, initialIdentityFilters.customerId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === form.conversationId) || null,
    [conversations, form.conversationId],
  );
  const identityReady = Boolean(selectedConversation?.wechatAccountId && selectedConversation.customerId && selectedConversation.id);
  const readiness = useMemo(
    () => designJobCreateReadiness(form, bundleRecommendation, identityReady),
    [form, bundleRecommendation, identityReady],
  );
  const dataFresh = !loadError;
  const requiredReady = readiness.ok && dataFresh;

  function update<K extends keyof DesignJobCreateFormState>(key: K, value: DesignJobCreateFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (["scene", "quantity", "perUnitAmount", "totalAmount"].includes(String(key))) setBundleRecommendation(null);
    setCreatedJob(null);
  }

  function changeConversation(conversationId: string) {
    setForm((current) => ({
      ...current,
      conversationId,
      customerAssetId: "",
      customerAssetUrl: "",
      customerAssetName: "客户参考图",
    }));
    setCreatedJob(null);
    setConfirming(false);
    setError("");
  }

  function applyCustomerAsset(target: DesignJobCreateAssetTarget, selection: DesignJobCreateAssetSelection) {
    setForm((current) => ({
      ...current,
      customerAssetId: target === "customer" ? selection.id : current.customerAssetId,
      customerAssetUrl: target === "customer" ? selection.localPath || selection.url : current.customerAssetUrl,
      customerAssetName: target === "customer" ? selection.fileName : current.customerAssetName,
      productAssetId: target === "product" ? selection.id : current.productAssetId,
      productImageUrl: target === "product" ? selection.localPath || selection.url : current.productImageUrl,
    }));
    setCreatedJob(null);
  }

  function applyCatalogSelection(selection: DesignJobCatalogSelection) {
    setForm((current) => ({ ...current, ...selection.form }));
    setBundleRecommendation(selection.recommendation);
    setCreatedJob(null);
  }

  async function createJob() {
    if (!selectedConversation || !requiredReady) {
      setConfirming(false);
      setError(readiness.issues[0]?.detail || "请先补齐设计任务创建条件。");
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError("");
    setCreatedJob(null);
    const payloadSignature = {
      conversationId: selectedConversation.id,
      customerId: selectedConversation.customerId,
      wechatAccountId: selectedConversation.wechatAccountId,
      scene: form.scene,
      customerText: form.customerText,
      quantity: form.quantity,
      perUnitAmount: form.perUnitAmount,
      totalAmount: form.totalAmount,
      outputCount: form.outputCount,
      customerAssetUrl: form.customerAssetUrl,
      customerAssetId: form.customerAssetId,
      productName: form.productName,
      productImageUrl: form.productImageUrl,
      productAssetId: form.productAssetId,
      bundleSkuCodes: bundleRecommendation?.items?.map((item) => item.skuCode || item.type || "").filter(Boolean) || [],
    };
    const operation = reserveClientOperation("design-job", payloadSignature, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      const customerAsset = await ensureCustomerReferenceAsset(form, selectedConversation);
      const selectedAssetIds = [...new Set([customerAsset.id, form.productAssetId].map((item) => item.trim()).filter(Boolean))];
      const job = await createDesignJob({
        operationKey: operation.key,
        wechatAccountId: selectedConversation.wechatAccountId,
        customerId: selectedConversation.customerId,
        conversationId: selectedConversation.id,
        budget: {
          mode: "per_box",
          quantity: positiveNumber(form.quantity),
          perUnitAmount: positiveNumber(form.perUnitAmount),
          totalAmount: positiveNumber(form.totalAmount),
        },
        scene: form.scene.trim(),
        customerText: form.customerText.trim(),
        designType: "bundle_render",
        outputCount: Number(form.outputCount),
        assetIds: selectedAssetIds,
        assets: [],
        bundle: designJobBundleFromForm(form, bundleRecommendation),
      });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setForm((current) => ({
        ...current,
        customerAssetId: customerAsset.id,
        customerAssetUrl: customerAsset.localPath || current.customerAssetUrl,
        customerAssetName: customerAsset.fileName || current.customerAssetName,
      }));
      setCreatedJob(job);
    } catch (cause) {
      setError(errorText(cause, "设计任务创建失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label="新建设计任务">
      <DesignPageHeader
        eyebrow="设计平台 / 新建任务"
        title="新建设计任务"
        detail="从真实会话创建设计任务草稿；创建后仍需进入任务详情做预检和正式提交。"
        actions={<button type="button" data-action-id="design-job-create-refresh-conversations" disabled={loading || busy} onClick={() => void refreshConversations()}><RefreshCw size={16} aria-hidden="true" />刷新会话</button>}
      />
      {loadError || error ? <DesignNotice tone="danger">{error || loadError}</DesignNotice> : null}
      {createdJob ? <DesignNotice tone="success">设计任务 {createdJob.requestId} 已创建。</DesignNotice> : null}
      {loading ? <DesignEmpty title="正在读取会话" detail="正在加载可绑定的客户会话。" busy /> : (
        <DesignJobCreateForm
          conversations={conversations} loaded={loaded} form={form} busy={busy}
          identityReady={identityReady} selectedConversation={selectedConversation}
          initialIdentityFilters={initialIdentityFilters} readiness={readiness} canPrepare={requiredReady} createdJob={createdJob}
          onApplyAsset={applyCustomerAsset} onApplyCatalog={applyCatalogSelection}
          onChangeConversation={changeConversation} onUpdate={update}
          onPrepare={() => { setError(""); requiredReady ? setConfirming(true) : setError(readiness.issues[0]?.detail || "请先补齐设计任务创建条件。"); }}
        />
      )}
      {confirming ? (
        <DesignConfirmation
          title="确认创建设计任务？"
          detail="系统只创建任务草稿，不会直接提交到设计平台；提交前还需要进入任务详情做预检。"
          confirmLabel="确认创建"
          confirmActionId="design-job-create-submit-confirm"
          cancelActionId="design-job-create-submit-cancel"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void createJob()}
        />
      ) : null}
    </section>
  );
}
