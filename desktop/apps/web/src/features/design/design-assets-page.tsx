"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getWechatConversations, type Conversation, type DesignAsset, type IdentityFilters } from "../../lib/api";
import { getAssets, uploadAsset } from "./api";
import type { DesignAssetRoleFilter } from "./design-asset-role";
import { DesignAssetsListPanel } from "./design-assets-list-panel";
import {
  conversationIdentityHref,
  conversationLabel,
  fileBase64,
  hasAssetIdentityScope,
  isAssetIdentityReady,
} from "./design-assets-page-utils";
import { DesignAssetUploadConfirmation, DesignAssetsUploadPanel } from "./design-assets-upload-panel";
import {
  createDesignAssetOperationGuard,
  runGuardedDesignAssetMutation,
  runGuardedDesignAssetRead,
  type DesignAssetReadIdentity,
} from "./design-asset-read-guard";
import styles from "./design-pages.module.css";
import { DesignNotice, DesignPageHeader, errorText } from "./design-ui";

export function DesignAssetsPage({ initialIdentityFilters = {} }: { initialIdentityFilters?: IdentityFilters } = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetAutoRefreshTick, setAssetAutoRefreshTick] = useState(0);
  const [role, setRole] = useState("customer_logo");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<DesignAssetRoleFilter>("all");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "upload">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const assetOperationGuardRef = useRef<ReturnType<typeof createDesignAssetOperationGuard> | null>(null);
  if (!assetOperationGuardRef.current) {
    assetOperationGuardRef.current = createDesignAssetOperationGuard({ ownerId: "", wechatAccountId: "", conversationId: "", customerId: "" });
  }
  const assetOperationGuard = assetOperationGuardRef.current;
  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) || null;
  const identity = assetReadIdentity(selectedConversation);
  const identityReady = Boolean(identity.ownerId && identity.wechatAccountId && identity.conversationId && identity.customerId);

  useEffect(() => {
    assetOperationGuard.activate();
    void refreshConversations();
    return () => assetOperationGuard.dispose();
  }, [assetOperationGuard]);

  useEffect(() => {
    if (!assetAutoRefreshTick || !selectedConversation || !identityReady) return;
    void refreshAssets();
  }, [assetAutoRefreshTick, selectedConversationId]);

  function invalidateAssetOperations(identity: DesignAssetReadIdentity) {
    assetOperationGuard.invalidate(identity);
    setAssets([]);
    setAssetsLoaded(false);
    setSelectedRoleFilter("all");
    setBusy("");
    setError("");
    setNotice("");
    setPendingConfirmation(false);
  }

  function selectConversation(nextConversationId: string, source = conversations) {
    const nextConversation = source.find((item) => item.id === nextConversationId) || null;
    const nextIdentity = assetReadIdentity(nextConversation);
    setSelectedConversationId(nextConversationId);
    invalidateAssetOperations(nextIdentity);
    if (isAssetIdentityReady(nextIdentity)) {
      setAssetAutoRefreshTick((value) => value + 1);
    }
  }

  async function refreshConversations() {
    setConversationsLoading(true);
    setConversationsLoaded(false);
    setError("");
    try {
      const records = await getWechatConversations();
      setConversations(records);
      setConversationsLoaded(true);
      const preferredConversation = initialAssetConversation(records, initialIdentityFilters);
      const identityScoped = hasAssetIdentityScope(initialIdentityFilters);
      const nextConversationId = records.some((item) => item.id === selectedConversationId)
        ? selectedConversationId
        : identityScoped
          ? preferredConversation?.id || ""
          : records[0]?.id || "";
      selectConversation(nextConversationId, records);
      if (identityScoped && !preferredConversation) {
        setError("当前企微客户身份未能匹配，已阻止把素材上传到其他客户。请返回原会话重试。");
      }
    } catch (cause) {
      setConversations([]);
      setConversationsLoaded(false);
      selectConversation("", []);
      setError(errorText(cause, "会话读取失败"));
    } finally {
      setConversationsLoading(false);
    }
  }

  async function refreshAssets() {
    if (!selectedConversation) { setError("请先选择客户会话。"); return; }
    if (!identityReady) { setError("所选会话缺少企业微信账号、会话或客户身份。"); return; }
    await runGuardedDesignAssetRead({
      guard: assetOperationGuard,
      identity,
      load: () => getAssets("customer", identity.ownerId, {
        wechatAccountId: identity.wechatAccountId,
        conversationId: identity.conversationId,
        customerId: identity.customerId,
      }),
      onStart: () => { setBusy("refresh"); setError(""); setNotice(""); setAssets([]); setAssetsLoaded(false); },
      onSuccess: (records) => { setAssets(records); setAssetsLoaded(true); },
      onError: (cause) => { setAssets([]); setAssetsLoaded(false); setError(errorText(cause, "素材读取失败")); },
      onFinally: () => setBusy(""),
    });
  }

  async function confirmUpload() {
    if (!file || !selectedConversation || !identityReady) return;
    const selectedFile = file;
    const selectedRole = role;
    await runGuardedDesignAssetMutation({
      guard: assetOperationGuard,
      identity,
      prepare: () => fileBase64(selectedFile),
      mutate: (base64) => uploadAsset({
        ownerType: "customer",
        ownerId: identity.ownerId.trim(),
        role: selectedRole,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        source: "operator_upload",
        base64,
        expectedWechatAccountId: identity.wechatAccountId.trim(),
        expectedConversationId: identity.conversationId.trim(),
        expectedCustomerId: identity.customerId.trim(),
      }),
      refresh: () => getAssets("customer", identity.ownerId.trim(), {
        wechatAccountId: identity.wechatAccountId.trim(),
        conversationId: identity.conversationId.trim(),
        customerId: identity.customerId.trim(),
      }),
      onStart: () => { setPendingConfirmation(false); setBusy("upload"); setError(""); setNotice(""); },
      onMutationSuccess: () => { setFile(null); setBusy("refresh"); },
      onRefreshSuccess: (records) => { setAssets(records); setAssetsLoaded(true); },
      onRefreshError: (cause) => { setAssets([]); setAssetsLoaded(false); setError(errorText(cause, "素材读取失败")); },
      onSuccess: (created) => setNotice(`素材 ${created.fileName} 已上传并绑定到所选客户身份。`),
      onError: (cause) => setError(errorText(cause, "素材上传失败")),
      onFinally: () => setBusy(""),
    });
  }

  return (
    <section className={styles.page} aria-label="设计素材管理">
      <DesignPageHeader
        eyebrow="设计平台"
        title="客户素材"
        detail="按真实客户会话读取和上传 Logo、参考图与附件。"
        actions={(
          <>
            <button type="button" data-action-id="design-assets-refresh-conversations" aria-label="刷新客户会话" disabled={conversationsLoading || Boolean(busy)} onClick={() => void refreshConversations()}><RefreshCw size={16} aria-hidden="true" />刷新会话</button>
            <button type="button" data-action-id="design-assets-refresh" aria-label="刷新客户素材" disabled={Boolean(busy) || !identityReady} onClick={() => void refreshAssets()}><RefreshCw size={16} aria-hidden="true" />刷新素材</button>
          </>
        )}
      />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <div className={styles.twoColumn}>
        <DesignAssetsUploadPanel
          conversations={conversations}
          conversationsLoading={conversationsLoading}
          conversationsLoaded={conversationsLoaded}
          selectedConversationId={selectedConversationId}
          selectedConversation={selectedConversation}
          identity={identity}
          identityReady={identityReady}
          role={role}
          file={file}
          busy={busy}
          conversationLabel={conversationLabel}
          onFileChange={setFile}
          onRoleChange={setRole}
          onSelectConversation={selectConversation}
          onValidationError={setError}
          onUploadRequest={() => setPendingConfirmation(true)}
        />
        <DesignAssetsListPanel
          assets={assets}
          assetsLoaded={assetsLoaded}
          busy={busy}
          identityReady={identityReady}
          selectedRoleFilter={selectedRoleFilter}
          onRoleFilterChange={setSelectedRoleFilter}
        />
      </div>
      {selectedConversation ? (
        <Link className={styles.backLink} href={conversationIdentityHref("/catalog/bundles", selectedConversation)} data-action-id="design-assets-back-bundles">
          返回当前客户 AI 搭品
        </Link>
      ) : null}
      <DesignAssetUploadConfirmation
        pending={pendingConfirmation}
        role={role}
        file={file}
        identity={identity}
        busy={busy}
        onCancel={() => setPendingConfirmation(false)}
        onConfirm={() => void confirmUpload()}
      />
    </section>
  );
}

export function initialAssetConversation(rows: Conversation[], filters: IdentityFilters) {
  return rows.find((conversation) =>
    (!filters.wechatAccountId || conversation.wechatAccountId === filters.wechatAccountId)
    && (!filters.conversationId || conversation.id === filters.conversationId)
    && (!filters.customerId || conversation.customerId === filters.customerId),
  );
}

function assetReadIdentity(conversation: Conversation | null): DesignAssetReadIdentity {
  return {
    ownerId: conversation?.customerId?.trim() || "",
    wechatAccountId: conversation?.wechatAccountId?.trim() || "",
    conversationId: conversation?.id?.trim() || "",
    customerId: conversation?.customerId?.trim() || "",
  };
}
