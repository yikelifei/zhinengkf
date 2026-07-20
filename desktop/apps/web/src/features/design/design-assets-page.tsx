"use client";

import { RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { DesignAsset } from "../../lib/api";
import { getAssets, uploadAsset } from "./api";
import { createDesignAssetReadGuard, runGuardedDesignAssetRead, type DesignAssetReadIdentity } from "./design-asset-read-guard";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";

export function DesignAssetsPage() {
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [wechatAccountId, setWechatAccountId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [role, setRole] = useState("logo");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "upload">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const assetReadGuardRef = useRef<ReturnType<typeof createDesignAssetReadGuard> | null>(null);
  if (!assetReadGuardRef.current) {
    assetReadGuardRef.current = createDesignAssetReadGuard({ ownerId: "", wechatAccountId: "", conversationId: "", customerId: "" });
  }
  const assetReadGuard = assetReadGuardRef.current;

  const identityReady = Boolean(wechatAccountId.trim() && conversationId.trim() && customerId.trim());

  function assetReadIdentity(overrides: Partial<DesignAssetReadIdentity> = {}): DesignAssetReadIdentity {
    return { ownerId, wechatAccountId, conversationId, customerId, ...overrides };
  }

  function invalidateAssetRead(identity: DesignAssetReadIdentity) {
    assetReadGuard.setIdentity(identity);
    setAssets([]);
    setAssetsLoaded(false);
    setBusy((current) => current === "refresh" ? "" : current);
  }

  async function refreshAssets() {
    if (!ownerId.trim()) { setError("请先填写客户归属 ID。"); return; }
    const identity = assetReadIdentity();
    await runGuardedDesignAssetRead({
      guard: assetReadGuard,
      identity,
      load: () => getAssets("customer", ownerId.trim(), { wechatAccountId: wechatAccountId.trim() || undefined, conversationId: conversationId.trim() || undefined, customerId: customerId.trim() || undefined }),
      onStart: () => { setBusy("refresh"); setError(""); setNotice(""); setAssets([]); setAssetsLoaded(false); },
      onSuccess: (records) => { setAssets(records); setAssetsLoaded(true); },
      onError: (cause) => { setAssets([]); setAssetsLoaded(false); setError(errorText(cause, "素材读取失败")); },
      onFinally: () => setBusy(""),
    });
  }

  async function confirmUpload() {
    if (!file || !ownerId.trim() || !identityReady) return;
    setPendingConfirmation(false); setBusy("upload"); setError(""); setNotice("");
    try {
      const base64 = await fileBase64(file);
      const created = await uploadAsset({ ownerType: "customer", ownerId: ownerId.trim(), role, fileName: file.name, mimeType: file.type || "application/octet-stream", source: "operator_upload", base64, expectedWechatAccountId: wechatAccountId.trim(), expectedConversationId: conversationId.trim(), expectedCustomerId: customerId.trim() });
      setFile(null);
      await refreshAssets();
      setNotice(`素材 ${created.fileName} 已上传并绑定到所选客户身份。`);
    } catch (cause) { setError(errorText(cause, "素材上传失败")); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.page} aria-label="设计素材管理">
      <DesignPageHeader eyebrow="设计平台" title="客户素材" detail="只负责按客户身份读取和上传 Logo、参考图与附件。" actions={<button type="button" data-action-id="design-assets-refresh" aria-label="刷新客户素材" disabled={Boolean(busy) || !ownerId.trim()} onClick={() => void refreshAssets()}><RefreshCw size={16} aria-hidden="true" />刷新素材</button>} />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}{notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <div className={styles.twoColumn}>
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); if (!identityReady) { setError("上传前必须补齐微信账号、会话和客户三项身份。"); return; } if (!file) { setError("请先选择要上传的文件。"); return; } setPendingConfirmation(true); }}>
          <div className={styles.cardHeader}><div><h2>素材归属与上传</h2><p>写操作严格携带三项 expected identity。</p></div></div>
          <div className={styles.formGrid}><label><span>客户归属 ID</span><input value={ownerId} onChange={(event) => { const next = event.target.value; invalidateAssetRead(assetReadIdentity({ ownerId: next })); setOwnerId(next); }} /></label><label><span>微信账号 ID</span><input value={wechatAccountId} onChange={(event) => { const next = event.target.value; invalidateAssetRead(assetReadIdentity({ wechatAccountId: next })); setWechatAccountId(next); }} /></label><label><span>会话 ID</span><input value={conversationId} onChange={(event) => { const next = event.target.value; invalidateAssetRead(assetReadIdentity({ conversationId: next })); setConversationId(next); }} /></label><label><span>客户 ID</span><input value={customerId} onChange={(event) => { const next = event.target.value; invalidateAssetRead(assetReadIdentity({ customerId: next })); setCustomerId(next); }} /></label><label><span>素材角色</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="logo">客户 Logo</option><option value="reference">参考图</option><option value="attachment">附件</option></select></label><label><span>选择文件</span><input type="file" accept="image/*,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label></div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-assets-upload-request" aria-label="准备上传客户素材" disabled={Boolean(busy)}><Upload size={16} aria-hidden="true" />上传素材</button></div>
        </form>
        <section className={styles.card} aria-label="客户素材列表"><div className={styles.cardHeader}><div><h2>已登记素材</h2><p>{assetsLoaded ? `${assets.length} 个记录` : "读取未确认"}</p></div></div>{busy === "refresh" ? <DesignEmpty title="正在读取素材" detail="只读取当前客户归属。" busy /> : assetsLoaded && assets.length ? <ul className={styles.recordList}>{assets.map((asset) => <li key={asset.id}><div><strong>{asset.fileName}</strong><span>{asset.role || "未标注角色"} · {asset.mimeType}</span></div><small>{formatDesignDate(asset.createdAt)} · {asset.sizeBytes ? `${Math.ceil(asset.sizeBytes / 1024)} KB` : "大小未知"}</small></li>)}</ul> : assetsLoaded ? <DesignEmpty title="当前客户尚无素材" detail="读取成功；可以选择文件上传并绑定到当前客户身份。" /> : <DesignEmpty title="素材状态未确认" detail={ownerId.trim() ? "尚未成功读取当前客户素材，请刷新后再试。" : "填写客户归属 ID 后刷新素材。"} />}</section>
      </div>
      {pendingConfirmation ? <DesignConfirmation title="确认上传并绑定这份素材？" detail={`文件 ${file?.name || ""} 将绑定到账号 ${wechatAccountId}、会话 ${conversationId}、客户 ${customerId}。`} confirmLabel="确认上传" confirmActionId="design-assets-upload-confirm" cancelActionId="design-assets-upload-cancel" busy={busy === "upload"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void confirmUpload()} /> : null}
    </section>
  );
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("文件读取失败")); reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, "")); reader.readAsDataURL(file); });
}
