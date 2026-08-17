"use client";

import { ImagePlus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { localAssetUrl, type Conversation, type DesignAsset } from "../../lib/api";
import { getAssets } from "./api";
import {
  DESIGN_ASSET_ROLE_FILTERS,
  assetRoleLabel,
  assetRoleSupportsTarget,
  filterDesignAssetsByRole,
  type DesignAssetApplyTarget,
  type DesignAssetRoleFilter,
} from "./design-asset-role";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, errorText } from "./design-ui";

export type DesignJobCreateAssetTarget = DesignAssetApplyTarget;
export type DesignJobCreateAssetSelection = {
  id: string;
  url: string;
  localPath: string;
  fileName: string;
  mimeType: string;
  role?: string | null;
};

type DesignJobCreateAssetPickerProps = {
  conversation: Conversation | null;
  identityReady: boolean;
  busy: boolean;
  selectedCustomerAssetId?: string;
  selectedProductAssetId?: string;
  initialAssetId?: string;
  initialAssetRole?: string;
  onApply: (target: DesignJobCreateAssetTarget, selection: DesignJobCreateAssetSelection) => void;
};

export function DesignJobCreateAssetPicker({
  conversation,
  identityReady,
  busy,
  selectedCustomerAssetId = "",
  selectedProductAssetId = "",
  initialAssetId = "",
  initialAssetRole = "",
  onApply,
}: DesignJobCreateAssetPickerProps) {
  const [customerAssets, setCustomerAssets] = useState<DesignAsset[]>([]);
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<DesignAssetRoleFilter>("all");
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const assetRequestRef = useRef(0);
  const appliedInitialAssetRef = useRef("");
  const identityExpectation = useMemo(() => ({
    expectedWechatAccountId: conversation?.wechatAccountId || "",
    expectedConversationId: conversation?.id || "",
    expectedCustomerId: conversation?.customerId || "",
  }), [conversation]);
  const visibleAssets = useMemo(() => filterDesignAssetsByRole(customerAssets, selectedRoleFilter), [customerAssets, selectedRoleFilter]);
  const customerReadyCount = customerAssets.filter((asset) => assetRoleSupportsTarget(asset, "customer")).length;
  const productReadyCount = customerAssets.filter((asset) => assetRoleSupportsTarget(asset, "product")).length;

  async function refreshCustomerAssets(targetConversation = conversation) {
    const requestId = assetRequestRef.current + 1;
    assetRequestRef.current = requestId;
    setCustomerAssets([]);
    setAssetsLoaded(false);
    setAssetsError("");
    if (!targetConversation?.wechatAccountId || !targetConversation.customerId || !targetConversation.id) {
      setAssetsLoading(false);
      return;
    }
    setAssetsLoading(true);
    try {
      const records = await getAssets("customer", targetConversation.customerId, {
        wechatAccountId: targetConversation.wechatAccountId,
        conversationId: targetConversation.id,
        customerId: targetConversation.customerId,
      });
      if (assetRequestRef.current !== requestId) return;
      setCustomerAssets(records.filter((asset) => asset.mimeType?.startsWith("image/")));
      setAssetsLoaded(true);
    } catch (cause) {
      if (assetRequestRef.current !== requestId) return;
      setAssetsError(errorText(cause, "客户素材读取失败"));
      setAssetsLoaded(false);
    } finally {
      if (assetRequestRef.current === requestId) setAssetsLoading(false);
    }
  }

  useEffect(() => {
    setSelectedRoleFilter("all");
    void refreshCustomerAssets(conversation);
  }, [conversation]);

  useEffect(() => {
    const requestedAssetId = initialAssetId.trim();
    if (!requestedAssetId || !assetsLoaded || assetsLoading || !conversation?.id) return;
    const applyKey = `${conversation.id}:${requestedAssetId}:${initialAssetRole.trim()}`;
    if (appliedInitialAssetRef.current === applyKey) return;
    const asset = customerAssets.find((candidate) => candidate.id === requestedAssetId);
    if (!asset) return;
    const target = initialAssetTarget(asset, initialAssetRole);
    if (!target) return;
    appliedInitialAssetRef.current = applyKey;
    applyAsset(asset, target);
  }, [initialAssetId, initialAssetRole, assetsLoaded, assetsLoading, customerAssets, conversation]);

  function applyAsset(asset: DesignAsset, target: DesignJobCreateAssetTarget) {
    const url = localAssetUrl(asset.localPath, identityExpectation);
    if (!url) {
      setAssetsError("这个素材缺少可用的本地文件路径，请重新上传后再用。");
      return;
    }
    onApply(target, {
      id: asset.id,
      url,
      localPath: asset.localPath,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      role: asset.role,
    });
  }

  return (
    <section className={styles.assetPicker} aria-label="客户素材选择">
      {assetsError ? <DesignNotice tone="warning">{assetsError}</DesignNotice> : null}
      <div className={styles.assetPickerHeader}>
        <div>
          <h3>客户素材</h3>
          <p>{assetsLoading ? "正在读取客户素材" : assetsLoaded ? `${visibleAssets.length}/${customerAssets.length} 张可用图片 · 参考 ${customerReadyCount} · 商品 ${productReadyCount}` : "切换会话后自动刷新"}</p>
        </div>
        {assetsLoaded && customerAssets.length ? (
          <select className={styles.compactSelect} value={selectedRoleFilter} disabled={assetsLoading || busy} onChange={(event) => setSelectedRoleFilter(event.target.value as DesignAssetRoleFilter)}>
            {DESIGN_ASSET_ROLE_FILTERS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        ) : null}
        <button type="button" data-action-id="design-job-create-refresh-assets" disabled={assetsLoading || busy || !identityReady} onClick={() => void refreshCustomerAssets()}>
          <RefreshCw size={16} aria-hidden="true" />
          刷新素材
        </button>
      </div>
      {assetsLoaded && visibleAssets.length ? (
        <ul className={styles.assetPickerList}>
          {visibleAssets.map((asset) => {
            const customerAllowed = assetRoleSupportsTarget(asset, "customer");
            const productAllowed = assetRoleSupportsTarget(asset, "product");
            const previewUrl = localAssetUrl(asset.localPath, identityExpectation);
            const selectedAsCustomer = asset.id === selectedCustomerAssetId;
            const selectedAsProduct = asset.id === selectedProductAssetId;
            const selected = selectedAsCustomer || selectedAsProduct;
            return (
              <li key={asset.id} data-selected={selected || undefined}>
                <div className={styles.assetPickerItem}>
                  {previewUrl ? <img className={styles.assetPreviewImage} src={previewUrl} alt={asset.fileName} /> : <span className={styles.assetPreviewMissing}>无预览</span>}
                  <span>
                    <strong>{asset.fileName}</strong>
                    <span>{assetRoleLabel(asset.role)} / {asset.mimeType}</span>
                  </span>
                </div>
                <span className={styles.assetPickerActions}>
                  <button type="button" data-action-id="design-job-create-use-customer-asset" aria-pressed={selectedAsCustomer} disabled={busy || !customerAllowed} title={customerAllowed ? "用作客户参考图" : "该角色不适合作为客户参考图"} onClick={() => applyAsset(asset, "customer")}>
                    <ImagePlus size={15} aria-hidden="true" />
                    {selectedAsCustomer ? "已用作参考图" : "参考图"}
                  </button>
                  <button type="button" data-action-id="design-job-create-use-product-asset" aria-pressed={selectedAsProduct} disabled={busy || !productAllowed} title={productAllowed ? "用作商品图" : "该角色不适合作为商品图"} onClick={() => applyAsset(asset, "product")}>
                    <ImagePlus size={15} aria-hidden="true" />
                    {selectedAsProduct ? "已用作商品图" : "商品图"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : assetsLoaded && customerAssets.length ? (
        <DesignEmpty
          title="当前角色没有可用图片"
          detail="切换角色筛选，或先把素材标注为参考图、商品图后再创建设计任务。"
        />
      ) : (
        <DesignEmpty
          title={identityReady ? "当前客户没有可用图片素材" : "请先选择客户会话"}
          detail={identityReady ? "可以先在客户素材页上传参考图，也可以继续手动填 URL。" : "素材读取只使用当前会话的企业微信账号、会话和客户身份。"}
          busy={assetsLoading}
        />
      )}
    </section>
  );
}

function initialAssetTarget(asset: DesignAsset, initialRole: string): DesignJobCreateAssetTarget | null {
  const normalized = String(initialRole || asset.role || "").trim();
  if ((normalized === "product" || normalized === "product_image" || normalized === "sku_image") && assetRoleSupportsTarget(asset, "product")) {
    return "product";
  }
  if ((normalized === "customer" || normalized === "customer_logo" || normalized === "reference" || normalized === "attachment") && assetRoleSupportsTarget(asset, "customer")) {
    return "customer";
  }
  if (assetRoleSupportsTarget(asset, "customer")) return "customer";
  if (assetRoleSupportsTarget(asset, "product")) return "product";
  return null;
}
