"use client";

import { RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import type { DesignAsset } from "../../lib/api";
import { getAssets, uploadAsset } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";

export function DesignAssetsPage() {
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [wechatAccountId, setWechatAccountId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [role, setRole] = useState("logo");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "upload">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ambiguousEmpty, setAmbiguousEmpty] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  const identityReady = Boolean(wechatAccountId.trim() && conversationId.trim() && customerId.trim());

  async function refreshAssets() {
    if (!ownerId.trim()) { setError("请先填写客户归属 ID。"); return; }
    setBusy("refresh"); setError(""); setNotice(""); setAmbiguousEmpty(false);
    try {
      const records = await getAssets("customer", ownerId.trim(), { wechatAccountId: wechatAccountId.trim() || undefined, conversationId: conversationId.trim() || undefined, customerId: customerId.trim() || undefined });
      setAssets(records); setAmbiguousEmpty(records.length === 0);
    } catch (cause) { setError(errorText(cause, "素材读取失败")); }
    finally { setBusy(""); }
  }

  async function confirmUpload() {
    if (!file || !ownerId.trim() || !identityReady) return;
    setPendingConfirmation(false); setBusy("upload"); setError(""); setNotice("");
    try {
      const base64 = await fileBase64(file);
      const created = await uploadAsset({ ownerType: "customer", ownerId: ownerId.trim(), role, fileName: file.name, mimeType: file.type || "application/octet-stream", source: "operator_upload", base64, expectedWechatAccountId: wechatAccountId.trim(), expectedConversationId: conversationId.trim(), expectedCustomerId: customerId.trim() });
      setAssets((current) => [created, ...current.filter((asset) => asset.id !== created.id)]); setFile(null); setNotice(`素材 ${created.fileName} 已上传并绑定到所选客户身份。`); setAmbiguousEmpty(false);
    } catch (cause) { setError(errorText(cause, "素材上传失败")); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.page} aria-label="设计素材管理">
      <DesignPageHeader eyebrow="设计平台" title="客户素材" detail="只负责按客户身份读取和上传 Logo、参考图与附件。" actions={<button type="button" data-action-id="design-assets-refresh" aria-label="刷新客户素材" disabled={Boolean(busy) || !ownerId.trim()} onClick={() => void refreshAssets()}><RefreshCw size={16} aria-hidden="true" />刷新素材</button>} />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}{notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {ambiguousEmpty ? <DesignNotice tone="warning">现有 getAssets 客户端会把请求失败折叠为空数组；当前空结果不能证明服务端确实没有素材。</DesignNotice> : null}
      <div className={styles.twoColumn}>
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); if (!identityReady) { setError("上传前必须补齐微信账号、会话和客户三项身份。"); return; } if (!file) { setError("请先选择要上传的文件。"); return; } setPendingConfirmation(true); }}>
          <div className={styles.cardHeader}><div><h2>素材归属与上传</h2><p>写操作严格携带三项 expected identity。</p></div></div>
          <div className={styles.formGrid}><label><span>客户归属 ID</span><input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} /></label><label><span>微信账号 ID</span><input value={wechatAccountId} onChange={(event) => setWechatAccountId(event.target.value)} /></label><label><span>会话 ID</span><input value={conversationId} onChange={(event) => setConversationId(event.target.value)} /></label><label><span>客户 ID</span><input value={customerId} onChange={(event) => setCustomerId(event.target.value)} /></label><label><span>素材角色</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="logo">客户 Logo</option><option value="reference">参考图</option><option value="attachment">附件</option></select></label><label><span>选择文件</span><input type="file" accept="image/*,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label></div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="design-assets-upload-request" aria-label="准备上传客户素材" disabled={Boolean(busy)}><Upload size={16} aria-hidden="true" />上传素材</button></div>
        </form>
        <section className={styles.card} aria-label="客户素材列表"><div className={styles.cardHeader}><div><h2>已登记素材</h2><p>{assets.length} 个记录</p></div></div>{busy === "refresh" ? <DesignEmpty title="正在读取素材" detail="只读取当前客户归属。" busy /> : assets.length ? <ul className={styles.recordList}>{assets.map((asset) => <li key={asset.id}><div><strong>{asset.fileName}</strong><span>{asset.role || "未标注角色"} · {asset.mimeType}</span></div><small>{formatDesignDate(asset.createdAt)} · {asset.sizeBytes ? `${Math.ceil(asset.sizeBytes / 1024)} KB` : "大小未知"}</small></li>)}</ul> : <DesignEmpty title="尚无可信素材结果" detail="填写归属后刷新；若仍为空，请结合上方契约提示判断。" />}</section>
      </div>
      {pendingConfirmation ? <DesignConfirmation title="确认上传并绑定这份素材？" detail={`文件 ${file?.name || ""} 将绑定到账号 ${wechatAccountId}、会话 ${conversationId}、客户 ${customerId}。`} confirmLabel="确认上传" confirmActionId="design-assets-upload-confirm" cancelActionId="design-assets-upload-cancel" busy={busy === "upload"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void confirmUpload()} /> : null}
    </section>
  );
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("文件读取失败")); reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, "")); reader.readAsDataURL(file); });
}
