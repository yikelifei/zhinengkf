import type { Conversation } from "../../lib/api";
import type { DesignAssetReadIdentity } from "./design-asset-read-guard";

export function hasAssetIdentityScope(filters: {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
}) {
  return Boolean(filters.wechatAccountId || filters.conversationId || filters.customerId);
}

export function conversationIdentityHref(path: string, conversation: Conversation) {
  const params = new URLSearchParams({
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
  });
  return `${path}?${params.toString()}`;
}

export function isAssetIdentityReady(identity: DesignAssetReadIdentity) {
  return Boolean(identity.ownerId && identity.wechatAccountId && identity.conversationId && identity.customerId);
}

export function conversationLabel(conversation: Conversation) {
  const customer = conversation.customer?.name || conversation.customerId || "客户未知";
  const title = conversation.title || conversation.id;
  return `${customer} · ${title}`;
}

export function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}
