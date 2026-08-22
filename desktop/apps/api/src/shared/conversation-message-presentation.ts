import path from "node:path";

const MEDIA_MESSAGE_TYPES = new Set(["image", "voice", "video", "file"]);
const STRUCTURED_MESSAGE_TYPES = new Set([
  "location",
  "link",
  "business_card",
  "miniprogram",
  "msgmenu",
  "product",
]);

type JsonRecord = Record<string, unknown>;

export function normalizeConversationTimelineAttachments(value: unknown, fallbackStatus: string) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRenderableMediaAttachment)
    .map((attachment, index) => normalizeMediaAttachment(attachment, index, fallbackStatus));
}

export function conversationTimelineMessagePresentation(message: any) {
  const metadataMessage = isPlainObject(message?.metadata?.wechatWorkMessage)
    ? message.metadata.wechatWorkMessage as JsonRecord
    : null;
  const legacyMessage = Array.isArray(message?.attachments)
    ? message.attachments.find((attachment: unknown) => (
        isPlainObject(attachment) && Boolean(normalizedMessageType(attachment.msgtype))
      )) as JsonRecord | undefined
    : undefined;
  const attachmentType = normalizeConversationTimelineAttachments(message?.attachments, "received")[0]?.kind;
  const messageType = normalizedMessageType(
    metadataMessage?.type || metadataMessage?.msgtype || legacyMessage?.msgtype || attachmentType,
  );
  const rawContent = metadataMessage?.content
    ?? legacyMessage?.payload
    ?? (messageType === "text" && isPlainObject(legacyMessage?.raw)
      ? (legacyMessage?.raw as JsonRecord).text
      : undefined);
  const content = normalizeWechatWorkMessageContent(messageType, rawContent);
  const configuredDisplayText = metadataMessage && Object.prototype.hasOwnProperty.call(metadataMessage, "displayText")
    ? String(metadataMessage.displayText || "")
    : undefined;
  const storedText = String(message?.text || "");
  const displayText = configuredDisplayText === undefined
    ? defaultDisplayText(messageType, storedText)
    : defaultDisplayText(messageType, configuredDisplayText);
  return {
    ...(messageType ? { messageType } : {}),
    ...(content ? { content } : {}),
    displayText,
  };
}

export function normalizeWechatWorkMessageContent(messageTypeValue: unknown, value: unknown) {
  const messageType = normalizedMessageType(messageTypeValue);
  const content = isPlainObject(value) ? value as JsonRecord : {};
  if (messageType === "text") {
    const text = cleanText(content.content);
    return text ? { content: text } : null;
  }
  if (messageType === "location") {
    return compactRecord({
      latitude: finiteNumber(content.latitude),
      longitude: finiteNumber(content.longitude),
      name: cleanText(content.name),
      address: cleanText(content.address),
    });
  }
  if (messageType === "link") {
    return compactRecord({
      title: cleanText(content.title),
      description: cleanText(content.desc || content.description),
      url: safeHttpUrl(content.url),
      imageUrl: safeHttpUrl(content.pic_url || content.imageUrl),
    });
  }
  if (messageType === "business_card") {
    return compactRecord({ userId: cleanText(content.userid || content.userId) });
  }
  if (messageType === "miniprogram") {
    return compactRecord({
      title: cleanText(content.title),
      appId: cleanText(content.appid || content.appId),
      pagePath: cleanText(content.pagepath || content.pagePath),
      thumbMediaId: cleanText(content.thumb_media_id || content.thumbMediaId),
    });
  }
  if (messageType === "msgmenu") {
    return compactRecord({
      headContent: cleanText(content.head_content || content.headContent),
      tailContent: cleanText(content.tail_content || content.tailContent),
      items: Array.isArray(content.list)
        ? content.list.slice(0, 20).map(normalizeMenuItem).filter(Boolean)
        : [],
    });
  }
  if (messageType === "product") {
    return compactRecord({
      title: cleanText(content.title || content.name),
      description: cleanText(content.desc || content.description),
      price: cleanText(content.price),
      skuCode: cleanText(content.skuCode || content.sku_code),
      imageUrl: safeHttpUrl(content.imageUrl || content.image_url || content.pic_url),
      url: safeHttpUrl(content.url),
    });
  }
  return null;
}

export function conversationTimelineTaskParts(payloadValue: unknown) {
  const payload = isPlainObject(payloadValue) ? payloadValue as JsonRecord : {};
  let messages: unknown[] = [];
  if (payload.kind === "wechat_work_messages" && Array.isArray(payload.messages)) {
    messages = payload.messages;
  } else if (payload.kind === "wechat_work_event_text") {
    messages = [{ msgtype: "text", message: { content: payload.text } }];
  } else if (payload.kind === "wechat_work_event_msgmenu") {
    messages = [{ msgtype: "msgmenu", message: payload.msgmenu }];
  }
  return messages.flatMap((value, index) => {
    if (!isPlainObject(value)) return [];
    const messageType = normalizedMessageType(value.msgtype);
    const messageBody = isPlainObject(value.message)
      ? value.message as JsonRecord
      : isPlainObject(value[messageType]) ? value[messageType] as JsonRecord : {};
    if (!messageType) return [];
    const text = messageType === "text" ? cleanText(messageBody.content) : "";
    const content = normalizeWechatWorkMessageContent(messageType, messageBody);
    const attachments = MEDIA_MESSAGE_TYPES.has(messageType)
      ? [{
          id: `message-part-${index + 1}`,
          kind: messageType,
          msgtype: messageType,
          name: cleanText(value.fileName) || mediaMessageLabel(messageType),
          localPath: cleanText(value.mediaPath) || undefined,
        }]
      : [];
    return [{ messageType, text, content, attachments }];
  });
}

export function conversationTimelineTaskPartStatus(
  taskStatusValue: unknown,
  attemptMetadataValue: unknown,
  partIndex: number,
) {
  const taskStatus = cleanText(taskStatusValue) || "queued";
  const metadata = isPlainObject(attemptMetadataValue) ? attemptMetadataValue as JsonRecord : {};
  const deliveryState = cleanText(metadata.deliveryState || metadata.wechatWorkDeliveryState).toLowerCase();
  if (deliveryState !== "partial") return taskStatus;
  const responseMessages = isPlainObject(metadata.apiResponse) && Array.isArray(metadata.apiResponse.messages)
    ? metadata.apiResponse.messages
    : [];
  const acceptedMessageIds = Array.isArray(metadata.acceptedMessageIds)
    ? metadata.acceptedMessageIds
    : Array.isArray(metadata.apiMsgIds)
      ? metadata.apiMsgIds
      : responseMessages.map((message) => isPlainObject(message) ? message.msgid : null).filter(Boolean);
  return partIndex < acceptedMessageIds.length ? "sent" : "failed";
}

function isRenderableMediaAttachment(attachment: unknown) {
  if (typeof attachment === "string") return looksLikeFileReference(attachment);
  if (!isPlainObject(attachment)) return false;
  const explicitMessageType = normalizedMessageType(attachment.msgtype);
  if (explicitMessageType && !MEDIA_MESSAGE_TYPES.has(explicitMessageType)) return false;
  const explicitKind = normalizedMessageType(attachment.kind);
  if (explicitKind && MEDIA_MESSAGE_TYPES.has(explicitKind)) return true;
  if (explicitMessageType && MEDIA_MESSAGE_TYPES.has(explicitMessageType)) return true;
  const mimeType = String(attachment.mimeType || attachment.contentType || attachment.type || "").toLowerCase();
  if (/^(image|audio|video)\//.test(mimeType) || mimeType === "application/octet-stream") return true;
  return [attachment.url, attachment.localPath, attachment.path, attachment.filePath, attachment.name, attachment.fileName]
    .some((candidate) => looksLikeFileReference(String(candidate || "")));
}

function normalizeMediaAttachment(attachment: unknown, index: number, fallbackStatus: string) {
  const item = isPlainObject(attachment) ? attachment as JsonRecord : { name: String(attachment || "") };
  const mimeType = String(item.mimeType || item.contentType || (String(item.type || "").includes("/") ? item.type : "") || "");
  const source = String(item.url || item.localPath || item.path || item.filePath || item.name || item.fileName || "");
  const explicitKind = normalizedMessageType(item.kind || item.msgtype);
  const kind = MEDIA_MESSAGE_TYPES.has(explicitKind)
    ? explicitKind
    : mediaKindFromMimeOrName(mimeType, source);
  const labels: Record<string, string> = { image: "图片", voice: "语音", video: "视频", file: "文件" };
  return {
    ...item,
    id: String(item.id || `attachment-${index + 1}`),
    kind,
    name: String(item.name || item.fileName || (source ? path.basename(source) : labels[kind])),
    mimeType,
    sizeBytes: finiteNumber(item.sizeBytes ?? item.size),
    status: String(item.status || fallbackStatus),
  };
}

function normalizeMenuItem(value: unknown) {
  if (!isPlainObject(value)) return null;
  const type = cleanText(value.type);
  const detail = type && isPlainObject(value[type]) ? value[type] as JsonRecord : value;
  if (type === "view") {
    return compactRecord({ type, label: cleanText(detail.content), url: safeHttpUrl(detail.url) });
  }
  if (type === "miniprogram") {
    return compactRecord({
      type,
      label: cleanText(detail.content),
      appId: cleanText(detail.appid),
      pagePath: cleanText(detail.pagepath),
    });
  }
  if (type === "click") {
    return compactRecord({ type, label: cleanText(detail.content), id: cleanText(detail.id) });
  }
  return null;
}

function defaultDisplayText(messageType: string, value: string) {
  if (MEDIA_MESSAGE_TYPES.has(messageType) || STRUCTURED_MESSAGE_TYPES.has(messageType)) return "";
  return value;
}

function mediaKindFromMimeOrName(mimeType: string, source: string) {
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(source)) return "image";
  if (mimeType.startsWith("audio/") || /\.(amr|mp3|wav|ogg|m4a)$/i.test(source)) return "voice";
  if (mimeType.startsWith("video/") || /\.(mp4|mov|avi|webm|mkv)$/i.test(source)) return "video";
  return "file";
}

function mediaMessageLabel(messageType: string) {
  return ({ image: "图片", voice: "语音", video: "视频", file: "文件" } as Record<string, string>)[messageType] || "文件";
}

function looksLikeFileReference(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return true;
  return /(^|[\\/])[^\\/]+\.[a-z0-9]{1,10}$/i.test(normalized) || /^[^\\/]+\.[a-z0-9]{1,10}$/i.test(normalized);
}

function normalizedMessageType(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown) {
  return String(value || "").trim().slice(0, 2000);
}

function finiteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function safeHttpUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function compactRecord(value: JsonRecord) {
  const entries = Object.entries(value).filter(([, item]) => (
    item !== undefined && item !== null && item !== "" && (!Array.isArray(item) || item.length > 0)
  ));
  return entries.length ? Object.fromEntries(entries) : null;
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
