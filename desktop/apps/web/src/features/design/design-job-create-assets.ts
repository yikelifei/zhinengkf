import type { Conversation, DesignAsset } from "../../lib/api";
import { uploadAsset } from "./api";
import { mimeFromUrl, type DesignJobCreateFormState } from "./design-job-create-model";

export async function ensureCustomerReferenceAsset(
  form: DesignJobCreateFormState,
  conversation: Conversation,
): Promise<Pick<DesignAsset, "id" | "localPath" | "fileName">> {
  const existing = form.customerAssetId.trim();
  if (existing) {
    return {
      id: existing,
      localPath: form.customerAssetUrl,
      fileName: form.customerAssetName,
    };
  }

  const source = form.customerAssetUrl.trim();
  const mimeType = mimeFromUrl(source);
  const fileName = imageFileName(form.customerAssetName, source, mimeType);
  const expected = {
    expectedWechatAccountId: conversation.wechatAccountId,
    expectedConversationId: conversation.id,
    expectedCustomerId: conversation.customerId,
  };
  const basePayload = {
    ownerType: "customer",
    ownerId: conversation.customerId,
    role: "reference",
    fileName,
    mimeType,
    ...expected,
  };

  const asset = source.startsWith("data:image/")
    ? await uploadAsset({ ...basePayload, source: "operator_web_create_data_url", base64: source })
    : /^https?:\/\//i.test(source)
      ? await uploadAsset({ ...basePayload, source: "operator_web_create_url", url: source })
      : null;
  if (!asset?.id) {
    throw new Error("客户参考图请先在客户素材页上传，或填写可下载的 https 图片 URL。");
  }
  return asset;
}

function imageFileName(name: string, source: string, mimeType: string) {
  const trimmed = name.trim() || "customer-reference";
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(trimmed)) return trimmed;
  const sourceExtension = /\.(png|jpe?g|webp|gif|bmp)(?:[?#].*)?$/i.exec(source)?.[1];
  const extension = sourceExtension || (mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png");
  return `${trimmed}.${extension}`;
}
