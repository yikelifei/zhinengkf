"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { Conversation, DesignJob, IdentityFilters } from "../../lib/api";
import { DesignJobCreateAssetPicker, type DesignJobCreateAssetSelection, type DesignJobCreateAssetTarget } from "./design-job-create-asset-picker";
import { DesignJobCreateCatalogPicker } from "./design-job-create-catalog-picker";
import type { DesignJobCatalogSelection, DesignJobCreateFormState, DesignJobCreateReadiness } from "./design-job-create-model";
import { DesignJobCreateReadinessPanel } from "./design-job-create-readiness-panel";
import { designIdentityHref } from "./design-commerce-state";
import styles from "./design-pages.module.css";
import { DesignNotice } from "./design-ui";

type Props = {
  conversations: Conversation[];
  loaded: boolean;
  form: DesignJobCreateFormState;
  busy: boolean;
  identityReady: boolean;
  selectedConversation: Conversation | null;
  initialIdentityFilters: IdentityFilters;
  readiness: DesignJobCreateReadiness;
  canPrepare: boolean;
  createdJob: DesignJob | null;
  onApplyAsset: (target: DesignJobCreateAssetTarget, selection: DesignJobCreateAssetSelection) => void;
  onApplyCatalog: (selection: DesignJobCatalogSelection) => void;
  onChangeConversation: (conversationId: string) => void;
  onUpdate: <K extends keyof DesignJobCreateFormState>(key: K, value: DesignJobCreateFormState[K]) => void;
  onPrepare: () => void;
};

export function DesignJobCreateForm({
  conversations,
  loaded,
  form,
  busy,
  identityReady,
  selectedConversation,
  initialIdentityFilters,
  readiness,
  canPrepare,
  createdJob,
  onApplyAsset,
  onApplyCatalog,
  onChangeConversation,
  onUpdate,
  onPrepare,
}: Props) {
  return (
    <form className={styles.card} onSubmit={(event) => { event.preventDefault(); onPrepare(); }}>
      <div className={styles.cardHeader}>
        <div><h2>任务信息</h2><p>{loaded ? `${conversations.length} 条会话可选` : "会话状态未确认"}</p></div>
      </div>
      <DesignJobCreateAssetPicker
        conversation={selectedConversation}
        identityReady={identityReady}
        busy={busy}
        selectedCustomerAssetId={form.customerAssetId}
        selectedProductAssetId={form.productAssetId}
        initialAssetId={initialIdentityFilters.assetId}
        initialAssetRole={initialIdentityFilters.assetRole}
        onApply={onApplyAsset}
      />
      <DesignJobCreateReadinessPanel readiness={readiness} />
      <DesignJobCreateCatalogPicker
        scene={form.scene}
        quantity={form.quantity}
        perUnitAmount={form.perUnitAmount}
        totalAmount={form.totalAmount}
        busy={busy}
        onApply={onApplyCatalog}
      />
      <div className={styles.formGrid}>
        <label className={styles.fullField}>
          <span>绑定会话</span>
          <select value={form.conversationId} data-action-id="design-job-create-conversation" disabled={busy || !conversations.length} onChange={(event) => onChangeConversation(event.target.value)}>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {(conversation.customer?.name || conversation.title || conversation.id)} / {conversation.wechatAccount?.displayName || conversation.wechatAccountId || "账号缺失"}
              </option>
            ))}
          </select>
        </label>
        <label><span>场景</span><input value={form.scene} disabled={busy} onChange={(event) => onUpdate("scene", event.target.value)} /></label>
        <label><span>出图数量（固定）</span><input value={form.outputCount} disabled readOnly aria-label="每轮固定生成 4 张候选稿" /></label>
        <label><span>数量</span><input value={form.quantity} disabled={busy} inputMode="decimal" onChange={(event) => onUpdate("quantity", event.target.value)} /></label>
        <label><span>单价预算</span><input value={form.perUnitAmount} disabled={busy} inputMode="decimal" onChange={(event) => onUpdate("perUnitAmount", event.target.value)} /></label>
        <label><span>总预算</span><input value={form.totalAmount} disabled={busy} inputMode="decimal" onChange={(event) => onUpdate("totalAmount", event.target.value)} /></label>
        <label><span>客户参考图 URL</span><input value={form.customerAssetUrl} disabled={busy} placeholder="https://... 或 data:image/..." onChange={(event) => onUpdate("customerAssetUrl", event.target.value)} /></label>
        <label><span>参考图名称</span><input value={form.customerAssetName} disabled={busy} onChange={(event) => onUpdate("customerAssetName", event.target.value)} /></label>
        <label><span>商品名称</span><input value={form.productName} disabled={busy} onChange={(event) => onUpdate("productName", event.target.value)} /></label>
        <label><span>SKU 编码</span><input value={form.skuCode} disabled={busy} onChange={(event) => onUpdate("skuCode", event.target.value)} /></label>
        <label><span>商品图片 URL</span><input value={form.productImageUrl} disabled={busy} placeholder="https://... 或 /local-assets/..." onChange={(event) => onUpdate("productImageUrl", event.target.value)} /></label>
        <label><span>商品售价</span><input value={form.productSalePrice} disabled={busy} inputMode="decimal" onChange={(event) => onUpdate("productSalePrice", event.target.value)} /></label>
        <label><span>商品成本</span><input value={form.productCostPrice} disabled={busy} inputMode="decimal" onChange={(event) => onUpdate("productCostPrice", event.target.value)} /></label>
        <label className={styles.fullField}><span>客户需求</span><textarea rows={4} value={form.customerText} disabled={busy} onChange={(event) => onUpdate("customerText", event.target.value)} /></label>
      </div>
      {!identityReady ? <DesignNotice tone="danger">请选择包含企业微信账号、客户和会话身份的记录。</DesignNotice> : null}
      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryButton} data-action-id="design-job-create-submit-request" disabled={busy || !canPrepare}>
          <Plus size={16} aria-hidden="true" />
          准备创建任务
        </button>
      </div>
      {createdJob ? <Link className={styles.backLink} href={designIdentityHref(`/design/jobs/${encodeURIComponent(createdJob.id)}`, createdJob)} data-action-id="design-job-create-open-created">打开已创建任务</Link> : null}
      <Link className={styles.backLink} href={selectedConversation ? conversationIdentityHref("/design/jobs", selectedConversation) : "/design/jobs"} data-action-id="design-job-create-back-list">返回当前客户任务</Link>
    </form>
  );
}

function conversationIdentityHref(path: string, conversation: Conversation) {
  const params = new URLSearchParams({
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
  });
  return `${path}?${params.toString()}`;
}
