"use client";

import type { FormEvent } from "react";
import { Upload } from "lucide-react";
import type { Conversation } from "../../lib/api";
import { DESIGN_ASSET_ROLE_OPTIONS, assetRoleLabel } from "./design-asset-role";
import type { DesignAssetReadIdentity } from "./design-asset-read-guard";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignNotice } from "./design-ui";

type DesignAssetsBusy = "" | "refresh" | "upload";

type DesignAssetsUploadPanelProps = {
  conversations: Conversation[];
  conversationsLoading: boolean;
  conversationsLoaded: boolean;
  selectedConversationId: string;
  selectedConversation: Conversation | null;
  identity: DesignAssetReadIdentity;
  identityReady: boolean;
  role: string;
  file: File | null;
  busy: DesignAssetsBusy;
  conversationLabel: (conversation: Conversation) => string;
  onFileChange: (file: File | null) => void;
  onRoleChange: (role: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onValidationError: (message: string) => void;
  onUploadRequest: () => void;
};

type DesignAssetUploadConfirmationProps = {
  pending: boolean;
  role: string;
  file: File | null;
  identity: DesignAssetReadIdentity;
  busy: DesignAssetsBusy;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DesignAssetsUploadPanel({
  conversations,
  conversationsLoading,
  conversationsLoaded,
  selectedConversationId,
  selectedConversation,
  identity,
  identityReady,
  role,
  file,
  busy,
  conversationLabel,
  onFileChange,
  onRoleChange,
  onSelectConversation,
  onValidationError,
  onUploadRequest,
}: DesignAssetsUploadPanelProps) {
  function submitUploadRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identityReady) {
      onValidationError("上传前必须选择具备企业微信账号、会话和客户身份的记录。");
      return;
    }
    if (!file) {
      onValidationError("请先选择要上传的文件。");
      return;
    }
    onUploadRequest();
  }

  return (
    <form className={styles.card} onSubmit={submitUploadRequest}>
      <div className={styles.cardHeader}>
        <div><h2>素材归属与上传</h2><p>{conversationsLoaded ? `${conversations.length} 条会话可选` : "会话状态未确认"}</p></div>
      </div>
      <div className={styles.formGrid}>
        <label className={styles.fullField}>
          <span>客户会话</span>
          <select value={selectedConversationId} disabled={conversationsLoading || Boolean(busy)} onChange={(event) => onSelectConversation(event.target.value)}>
            {conversations.map((conversation) => (
              <option value={conversation.id} key={conversation.id}>{conversationLabel(conversation)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>素材角色</span>
          <select value={role} disabled={Boolean(busy)} onChange={(event) => onRoleChange(event.target.value)}>
            {DESIGN_ASSET_ROLE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>选择文件</span>
          <input type="file" accept="image/*,.pdf" disabled={Boolean(busy)} onChange={(event) => onFileChange(event.target.files?.[0] || null)} />
        </label>
      </div>
      <dl className={styles.factGrid}>
        <div><dt>企业微信账号</dt><dd>{identity.wechatAccountId || "未绑定"}</dd></div>
        <div><dt>会话</dt><dd>{identity.conversationId || "未选择"}</dd></div>
        <div><dt>客户</dt><dd>{selectedConversation?.customer?.name || identity.customerId || "未绑定"}</dd></div>
        <div><dt>素材归属</dt><dd>{identity.ownerId || "未确定"}</dd></div>
      </dl>
      {!identityReady ? <DesignNotice tone="danger">请选择包含企业微信账号、会话和客户身份的记录。</DesignNotice> : null}
      {!conversationsLoading && conversationsLoaded && !conversations.length ? <DesignNotice tone="warning">当前没有可绑定的客户会话。</DesignNotice> : null}
      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryButton} data-action-id="design-assets-upload-request" aria-label="准备上传客户素材" disabled={Boolean(busy) || !identityReady || !file}>
          <Upload size={16} aria-hidden="true" />
          上传素材
        </button>
      </div>
    </form>
  );
}

export function DesignAssetUploadConfirmation({
  pending,
  role,
  file,
  identity,
  busy,
  onCancel,
  onConfirm,
}: DesignAssetUploadConfirmationProps) {
  if (!pending) return null;
  return (
    <DesignConfirmation
      title="确认上传并绑定这份素材？"
      detail={`文件 ${file?.name || ""} 将以 ${assetRoleLabel(role)} 角色绑定到账号 ${identity.wechatAccountId}、会话 ${identity.conversationId}、客户 ${identity.customerId}。`}
      confirmLabel="确认上传"
      confirmActionId="design-assets-upload-confirm"
      cancelActionId="design-assets-upload-cancel"
      busy={busy === "upload"}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
