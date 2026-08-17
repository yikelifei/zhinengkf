"use client";

import { ImageIcon, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  createDesignJob,
  getAssets,
  getWechatConversations,
  localAssetUrl,
  uploadAsset,
  type BundleRecommendation,
  type Conversation,
  type DesignAsset,
  type IdentityFilters,
} from "../../lib/api";
import {
  completeClientOperation,
  reserveClientOperation,
  type PendingClientOperation,
} from "../../lib/client-operation-key";
import styles from "./catalog-pages.module.css";
import { CatalogNotice, catalogError } from "./catalog-ui";
import {
  bundleRecommendationHandoffReadiness,
  hasIdentityScope,
  identityMatchesConversation,
} from "./catalog-journey-state";
import { assetRoleSupportsTarget } from "../design/design-asset-role";
import { DesignCommerceJourney } from "../design/design-commerce-journey";

export type BundleDesignDraft = {
  scene: string;
  quantity: string;
  perUnitAmount: string;
  totalAmount: string;
  maxItems: string;
  selectedSkuCodes: string[];
};

export function CatalogBundleDesignHandoff({
  intentKey,
  draft,
  result,
  initialIdentityFilters = {},
}: {
  intentKey: string;
  draft: BundleDesignDraft;
  result: BundleRecommendation | null;
  initialIdentityFilters?: IdentityFilters;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdJobId, setCreatedJobId] = useState("");
  const [customerAssets, setCustomerAssets] = useState<DesignAsset[]>([]);
  const [selectedCustomerAssetId, setSelectedCustomerAssetId] = useState("");
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const [assetUploadFile, setAssetUploadFile] = useState<File | null>(null);
  const [assetUploading, setAssetUploading] = useState(false);
  const operationRef = useRef<PendingClientOperation | null>(null);
  const assetRequestRef = useRef(0);
  const identityScoped = hasIdentityScope(initialIdentityFilters);

  useEffect(() => {
    let active = true;
    setError("");
    void getWechatConversations()
      .then((records) => {
        if (!active) return;
        const allRecords = Array.isArray(records) ? records : [];
        const next = identityScoped
          ? allRecords.filter((conversation) => identityMatchesConversation(conversation, initialIdentityFilters))
          : allRecords;
        const preferred = initialBundleConversation(next, initialIdentityFilters);
        setConversations(next);
        setSelectedConversationId((current) => {
          if (current && next.some((conversation) => conversation.id === current)) return current;
          if (identityScoped) return preferred?.id || "";
          return next[0]?.id || "";
        });
        if (identityScoped && !preferred) {
          setError("当前企微会话身份未能匹配，已阻止把搭品方案保存到其他客户。请刷新会话或返回原会话重试。");
        }
        setLoaded(true);
      })
      .catch((cause) => {
        if (!active) return;
        setConversations([]);
        setLoaded(true);
        setError(catalogError(cause, "企微客户会话读取失败"));
      });
    return () => { active = false; };
  }, [initialIdentityFilters.wechatAccountId, initialIdentityFilters.conversationId, initialIdentityFilters.customerId]);

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) || null;
  const selectedCustomerAsset = customerAssets.find((asset) => asset.id === selectedCustomerAssetId) || null;
  const recommendationReadiness = bundleRecommendationHandoffReadiness(result);

  async function refreshCustomerAssets(conversation = selectedConversation) {
    const requestId = assetRequestRef.current + 1;
    assetRequestRef.current = requestId;
    setCustomerAssets([]);
    setSelectedCustomerAssetId("");
    setAssetsLoaded(false);
    setAssetsError("");
    if (!conversation?.wechatAccountId || !conversation.customerId || !conversation.id) {
      setAssetsLoading(false);
      return;
    }
    setAssetsLoading(true);
    try {
      const records = await getAssets("customer", conversation.customerId, {
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
      });
      if (assetRequestRef.current !== requestId) return;
      setCustomerAssets(records.filter((asset) => asset.mimeType?.startsWith("image/") && assetRoleSupportsTarget(asset, "customer")));
      setAssetsLoaded(true);
    } catch (cause) {
      if (assetRequestRef.current !== requestId) return;
      setAssetsError(catalogError(cause, "客户参考图读取失败"));
    } finally {
      if (assetRequestRef.current === requestId) setAssetsLoading(false);
    }
  }

  useEffect(() => {
    void refreshCustomerAssets(selectedConversation);
  }, [selectedConversationId, conversations]);

  async function uploadCustomerAsset() {
    const conversation = selectedConversation;
    const selectedFile = assetUploadFile;
    if (!conversation || !selectedFile) {
      setAssetsError("请先选择当前客户的参考图片。");
      return;
    }
    if (!selectedFile.type.startsWith("image/")) {
      setAssetsError("客户参考图必须是图片文件。");
      return;
    }
    setAssetUploading(true);
    setAssetsError("");
    setNotice("");
    try {
      const created = await uploadAsset({
        ownerType: "customer",
        ownerId: conversation.customerId,
        role: "reference",
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        source: "catalog_bundle_handoff",
        base64: await fileBase64(selectedFile),
        expectedWechatAccountId: conversation.wechatAccountId,
        expectedConversationId: conversation.id,
        expectedCustomerId: conversation.customerId,
      });
      setCustomerAssets((current) => [created, ...current.filter((asset) => asset.id !== created.id)]);
      setSelectedCustomerAssetId(created.id);
      setAssetUploadFile(null);
      setAssetsLoaded(true);
      setNotice(`客户参考图 ${created.fileName} 已上传并选中，可继续保存出图草稿。`);
    } catch (cause) {
      setAssetsError(catalogError(cause, "客户参考图上传失败"));
    } finally {
      setAssetUploading(false);
    }
  }

  useEffect(() => {
    setError("");
    setNotice("");
    setCreatedJobId("");
    operationRef.current = null;
  }, [intentKey]);

  async function save() {
    if (!recommendationReadiness.ok || !result) {
      setError(recommendationReadiness.reason);
      return;
    }
    const conversation = selectedConversation;
    if (!conversation) {
      setError("请选择真实企微客户会话后再保存方案。");
      return;
    }
    if (!selectedCustomerAssetId) {
      setError("请选择当前客户的真实参考图；设计平台预检要求客户参考图和全部搭配商品图都可读取。");
      return;
    }
    const pendingPayload = buildBundleDesignJobPayload(draft, result, conversation, "pending", selectedCustomerAssetId);
    const operation = reserveClientOperation("design-job", pendingPayload, operationRef.current);
    operationRef.current = operation;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const job = await createDesignJob({ ...pendingPayload, operationKey: operation.key });
      operationRef.current = completeClientOperation(operationRef.current, operation.key);
      setCreatedJobId(job.id);
      setNotice(`组合方案已保存为客户“${conversation.customer?.name || conversation.title || conversation.id}”的出图草稿。`);
    } catch (cause) {
      setError(catalogError(cause, "组合方案保存失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-label="保存客户搭品方案" aria-busy={busy || undefined}>
      <div className={styles.cardHeader}><div><h2>保存为客户方案</h2><p>选择真实企微会话后，把当前组合保存为设计任务草稿；不会自动出图、报价或发送。</p></div></div>
      <DesignCommerceJourney
        active={createdJobId ? "design" : "bundle"}
        title="本次客户方案"
        recommendation={createdJobId ? "设计草稿已经创建，请打开任务完成预检；当前尚未出图。" : "先绑定客户会话与参考图，再保存为设计任务草稿。"}
        blockedReason={!recommendationReadiness.ok ? recommendationReadiness.reason : !selectedConversation ? "尚未选择真实客户会话" : !selectedCustomerAssetId ? "尚未选择当前客户参考图" : undefined}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      {assetsError ? <CatalogNotice tone="warning">{assetsError}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      <div className={styles.formGrid}>
        <label className={styles.fullField}><span>关联企微客户会话</span><select value={selectedConversationId} disabled={busy || !loaded} data-action-id="catalog-bundles-conversation" onChange={(event) => { setSelectedConversationId(event.target.value); setError(""); setNotice(""); setCreatedJobId(""); operationRef.current = null; }}><option value="">{loaded ? "请选择客户会话" : "正在读取客户会话"}</option>{conversations.map((conversation) => <option value={conversation.id} key={conversation.id}>{conversation.customer?.name || conversation.title || conversation.id} / {conversation.lastMessagePreview || "暂无消息摘要"}</option>)}</select></label>
        <label className={styles.fullField}>
          <span>客户参考图（出图必需）</span>
          <select
            value={selectedCustomerAssetId}
            disabled={busy || assetsLoading || !selectedConversation}
            data-action-id="catalog-bundles-customer-asset"
            onChange={(event) => { setSelectedCustomerAssetId(event.target.value); setError(""); setNotice(""); setCreatedJobId(""); operationRef.current = null; }}
          >
            <option value="">{assetsLoading ? "正在读取客户素材" : assetsLoaded ? "请选择真实客户参考图" : "客户素材尚未读取"}</option>
            {customerAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.fileName} / {asset.role || "reference"}</option>)}
          </select>
        </label>
        <label className={styles.fullField}>
          <span>没有可用参考图时直接上传</span>
          <input
            type="file"
            accept="image/*"
            disabled={busy || assetUploading || !selectedConversation}
            data-action-id="catalog-bundles-customer-asset-file"
            onChange={(event) => { setAssetUploadFile(event.target.files?.[0] || null); setAssetsError(""); }}
          />
        </label>
      </div>
      {selectedCustomerAsset && selectedConversation ? (
        <figure className={styles.handoffAssetPreview}>
          <img src={localAssetUrl(selectedCustomerAsset.localPath, {
            expectedWechatAccountId: selectedConversation.wechatAccountId,
            expectedConversationId: selectedConversation.id,
            expectedCustomerId: selectedConversation.customerId,
          })} alt={selectedCustomerAsset.fileName} />
          <figcaption><ImageIcon size={15} aria-hidden="true" />{selectedCustomerAsset.fileName}</figcaption>
        </figure>
      ) : assetsLoaded && selectedConversation ? (
        <CatalogNotice tone="warning">当前客户还没有选定可用参考图。请先到素材管理上传并绑定客户图片，再刷新本页。</CatalogNotice>
      ) : null}
      <div className={styles.formActions}>
        <button type="button" data-action-id="catalog-bundles-upload-customer-asset" disabled={busy || assetUploading || !selectedConversation || !assetUploadFile} onClick={() => void uploadCustomerAsset()}><ImageIcon size={16} aria-hidden="true" />{assetUploading ? "上传中" : "上传并选中参考图"}</button>
        <button type="button" data-action-id="catalog-bundles-refresh-customer-assets" disabled={busy || assetUploading || assetsLoading || !selectedConversation} onClick={() => void refreshCustomerAssets()}><RefreshCw size={16} aria-hidden="true" />刷新客户素材</button>
        <Link className={styles.buttonLink} href={selectedConversation ? conversationIdentityHref("/design/assets", selectedConversation) : "/design/assets"} data-action-id="catalog-bundles-open-assets">上传 / 管理素材</Link>
        <button type="button" className={styles.primaryButton} data-action-id="catalog-bundles-save-design-draft" disabled={busy || assetUploading || !recommendationReadiness.ok || !selectedConversationId || !selectedCustomerAssetId} title={!recommendationReadiness.ok ? recommendationReadiness.reason : undefined} onClick={() => void save()}><Save size={16} aria-hidden="true" />{busy ? "保存中" : "保存为出图草稿"}</button>
        {createdJobId && selectedConversation ? <Link className={styles.buttonLink} href={conversationIdentityHref(`/design/jobs/${encodeURIComponent(createdJobId)}`, selectedConversation)} data-action-id="catalog-bundles-open-design-draft">打开出图草稿</Link> : null}
      </div>
    </section>
  );
}

export function initialBundleConversation(rows: Conversation[], filters: IdentityFilters) {
  return rows.find((conversation) => identityMatchesConversation(conversation, filters));
}

function conversationIdentityHref(path: string, conversation: Conversation) {
  const params = new URLSearchParams({
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
  });
  return `${path}?${params.toString()}`;
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片文件读取失败"));
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

export function buildBundleDesignJobPayload(
  draft: BundleDesignDraft,
  recommendation: BundleRecommendation,
  conversation: Conversation,
  operationKey: string,
  customerAssetId = "",
) {
  const quantity = Number(draft.quantity);
  const perUnitAmount = Number(draft.perUnitAmount);
  const totalAmount = Number(draft.totalAmount);
  return {
    operationKey,
    wechatAccountId: conversation.wechatAccountId,
    customerId: conversation.customerId,
    conversationId: conversation.id,
    budget: { mode: "per_box", quantity, perUnitAmount, totalAmount },
    scene: draft.scene.trim(),
    bundle: {
      giftBox: recommendation.items.find((item) => item.type === "gift_box") || null,
      items: recommendation.items,
      totals: recommendation.totals,
      fulfillment: recommendation.fulfillment || null,
      automation: recommendation.automation || null,
      warnings: recommendation.warnings,
      selectedSkuCodes: [...draft.selectedSkuCodes],
    },
    assetIds: customerAssetId ? [customerAssetId] : [],
    assets: [],
    customerText: `客户搭品需求：${draft.scene.trim()}，数量 ${quantity}，单份预算 ${perUnitAmount}，总预算 ${totalAmount}。`,
    designType: "bundle_render",
    outputCount: 4,
  };
}
