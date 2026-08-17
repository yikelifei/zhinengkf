"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { identityExpectation, localAssetUrl, type DesignAsset } from "../../lib/api";
import {
  DESIGN_ASSET_ROLE_FILTERS,
  assetRoleLabel,
  assetRoleSummary,
  filterDesignAssetsByRole,
  type DesignAssetRoleFilter,
} from "./design-asset-role";
import styles from "./design-pages.module.css";
import { DesignEmpty, formatDesignDate } from "./design-ui";

type DesignAssetsListPanelProps = {
  assets: DesignAsset[];
  assetsLoaded: boolean;
  busy: "" | "refresh" | "upload";
  identityReady: boolean;
  selectedRoleFilter: DesignAssetRoleFilter;
  onRoleFilterChange: (role: DesignAssetRoleFilter) => void;
};

export function DesignAssetsListPanel({
  assets,
  assetsLoaded,
  busy,
  identityReady,
  selectedRoleFilter,
  onRoleFilterChange,
}: DesignAssetsListPanelProps) {
  const visibleAssets = filterDesignAssetsByRole(assets, selectedRoleFilter);
  const roleSummary = assetRoleSummary(assets);
  const libraryHealth = buildDesignAssetLibraryHealth(assets);

  return (
    <section className={styles.card} aria-label="客户素材列表">
      <div className={styles.cardHeader}>
        <div>
          <h2>已登记素材</h2>
          <p>{assetsLoaded ? assetListSummary(assets.length, visibleAssets.length, roleSummary) : "读取未确认"}</p>
        </div>
        {assetsLoaded && assets.length ? (
          <select className={styles.compactSelect} value={selectedRoleFilter} disabled={Boolean(busy)} onChange={(event) => onRoleFilterChange(event.target.value as DesignAssetRoleFilter)}>
            {DESIGN_ASSET_ROLE_FILTERS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        ) : null}
      </div>
      {assetsLoaded ? (
        <>
          <dl className={styles.factGrid} aria-label="素材库健康摘要" data-asset-health-summary>
            <div data-asset-health-id="asset-total"><dt>素材总数</dt><dd>{libraryHealth.total}</dd></div>
            <div data-asset-health-id="asset-images"><dt>图片素材</dt><dd>{libraryHealth.imageCount}</dd></div>
            <div data-asset-health-id="asset-missing-local"><dt>缺本地文件</dt><dd>{libraryHealth.missingLocalCount}</dd></div>
            <div data-asset-health-id="asset-duplicate-paths"><dt>重复路径</dt><dd>{libraryHealth.duplicatePathCount}</dd></div>
          </dl>
          {libraryHealth.warnings.length ? (
            <ul className={styles.recordList} aria-label="素材库待治理事项" data-asset-health-issues>
              {libraryHealth.warnings.map((warning) => <li key={warning}><strong>待治理</strong><span>{warning}</span></li>)}
            </ul>
          ) : null}
        </>
      ) : null}
      {busy === "refresh" ? <DesignEmpty title="正在读取素材" detail="只读取当前客户会话绑定的素材。" busy /> : assetsLoaded && visibleAssets.length ? (
        <ul className={styles.recordList}>{visibleAssets.map((asset) => {
          const expected = identityExpectation(asset);
          const previewUrl = asset.mimeType?.startsWith("image/") ? localAssetUrl(asset.localPath, expected) : "";
          return (
            <li className={styles.assetLibraryItem} key={asset.id}>
              <AssetPreview asset={asset} previewUrl={previewUrl} />
              <div>
                <strong>{asset.fileName}</strong>
                <span>{assetRoleLabel(asset.role)} · {asset.mimeType}</span>
                <small>{asset.localPath ? "本地文件已绑定" : "缺少本地文件"} · {formatDesignDate(asset.createdAt)} · {asset.sizeBytes ? `${Math.ceil(asset.sizeBytes / 1024)} KB` : "大小未知"}</small>
              </div>
              <Link href={designJobCreateHref(asset)} data-action-id="design-assets-use-in-new-job" aria-label={`使用 ${asset.fileName} 新建设计任务`}>
                <ArrowUpRight size={15} aria-hidden="true" />
                新建设计任务
              </Link>
            </li>
          );
        })}</ul>
      ) : assetsLoaded && assets.length ? (
        <DesignEmpty title="当前角色没有素材" detail="切换角色筛选或上传对应素材后再用。" />
      ) : assetsLoaded ? <DesignEmpty title="当前客户尚无素材" detail="读取成功；可以选择文件上传并绑定到当前客户身份。" /> : <DesignEmpty title="素材状态未确认" detail={identityReady ? "尚未成功读取当前客户素材，请刷新后再试。" : "选择客户会话后刷新素材。"} />}
    </section>
  );
}

function assetListSummary(total: number, visible: number, summary: Array<{ label: string; count: number }>) {
  const roleText = summary.map((item) => `${item.label} ${item.count}`).join(" / ");
  return roleText ? `${visible}/${total} 个记录 · ${roleText}` : `${visible}/${total} 个记录`;
}

export function buildDesignAssetLibraryHealth(assets: DesignAsset[]) {
  const normalizedPaths = assets.map((asset) => normalizeAssetPath(asset.localPath)).filter(Boolean);
  const duplicatePathSet = duplicateValues(normalizedPaths);
  const missingLocalCount = assets.filter((asset) => !String(asset.localPath || "").trim()).length;
  const imageCount = assets.filter((asset) => String(asset.mimeType || "").startsWith("image/")).length;
  const productBoundCount = assets.filter((asset) => ["product", "sku"].includes(String(asset.ownerType || "")) || ["product_image", "sku_image"].includes(String(asset.role || ""))).length;
  const customerBoundCount = assets.filter((asset) => String(asset.ownerType || "") === "customer").length;
  const warnings = [
    ...(missingLocalCount ? [`${missingLocalCount} 个素材缺少本地文件路径，不能稳定用于设计任务`] : []),
    ...(duplicatePathSet.size ? [`${duplicatePathSet.size} 个本地路径被重复登记，建议合并或删除重复素材`] : []),
    ...(assets.length && !imageCount ? ["当前客户没有可预览图片，设计任务只能依赖文字附件"] : []),
    ...(assets.length && !customerBoundCount ? ["当前列表没有客户归属素材，无法证明会话素材分区"] : []),
    ...(assets.length && !productBoundCount ? ["当前列表没有商品素材；商品图仍应从商品库 SKU 图片进入搭配"] : []),
  ];
  return {
    total: assets.length,
    imageCount,
    nonImageCount: assets.length - imageCount,
    missingLocalCount,
    duplicatePathCount: assets.filter((asset) => duplicatePathSet.has(normalizeAssetPath(asset.localPath))).length,
    duplicatePathSet,
    customerBoundCount,
    productBoundCount,
    warnings,
  };
}

function designJobCreateHref(asset: DesignAsset) {
  const params = new URLSearchParams();
  if (asset.wechatAccountId) params.set("wechatAccountId", asset.wechatAccountId);
  if (asset.conversationId) params.set("conversationId", asset.conversationId);
  if (asset.customerId) params.set("customerId", asset.customerId);
  if (asset.id) params.set("assetId", asset.id);
  if (asset.role) params.set("assetRole", asset.role);
  return `/design/jobs/new${params.toString() ? `?${params.toString()}` : ""}`;
}

function AssetPreview({ asset, previewUrl }: { asset: DesignAsset; previewUrl: string }) {
  const [failed, setFailed] = useState(false);
  const isImage = String(asset.mimeType || "").startsWith("image/");
  if (previewUrl && !failed) {
    return (
      <img
        className={styles.assetPreviewImage}
        src={previewUrl}
        alt={asset.fileName}
        data-asset-preview-state="ready"
        onError={() => setFailed(true)}
      />
    );
  }
  const state = isImage ? (previewUrl ? "failed" : "missing") : "non_image";
  return <span className={styles.assetPreviewMissing} data-asset-preview-state={state}>{isImage ? (previewUrl ? "预览失败" : "无预览") : "非图片"}</span>;
}

function normalizeAssetPath(value?: string | null) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function duplicateValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}
