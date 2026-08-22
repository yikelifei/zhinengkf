import { BadRequestException } from "@nestjs/common";
import { resolveWechatWorkImageFile, resolveWechatWorkMaterialFile } from "./wechat-work-media";

export type WechatWorkCustomerServiceMsgType =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "file"
  | "link"
  | "miniprogram"
  | "msgmenu"
  | "location";

export type WechatWorkQueuedMessage = {
  msgtype: WechatWorkCustomerServiceMsgType;
  message: Record<string, unknown>;
  mediaPath?: string | null;
  fileName?: string | null;
};

const CUSTOMER_SERVICE_MESSAGE_TYPES = new Set<string>([
  "text",
  "image",
  "voice",
  "video",
  "file",
  "link",
  "miniprogram",
  "msgmenu",
  "location",
]);

const MEDIA_MESSAGE_TYPES = new Set<string>(["image", "voice", "video", "file"]);

export function normalizeWechatWorkCustomerServiceMessages(value: unknown): WechatWorkQueuedMessage[] {
  const rawMessages = Array.isArray(value) ? value : [value];
  const messages = rawMessages.map((item, index) => normalizeWechatWorkCustomerServiceMessage(item, index));
  if (!messages.length) throw new BadRequestException("messages must include at least one Enterprise WeChat message");
  if (messages.length > 5) throw new BadRequestException("wechat work customer-service send exceeds the 5-message limit");
  return messages;
}

export function normalizeWechatWorkQueuedMessagesFromTaskPayload(payload: unknown): WechatWorkQueuedMessage[] {
  const data = plainObject(payload, "send task payload");
  if (data.kind === "wechat_work_messages") {
    return normalizeWechatWorkCustomerServiceMessages(data.messages);
  }
  const legacyMessages: unknown[] = [];
  const text = String(data.textBeforeImages || data.textBeforeFiles || data.text || "").trim();
  if (text) legacyMessages.push({ msgtype: "text", text: { content: text } });
  for (const filePath of Array.isArray(data.imagePaths) ? data.imagePaths : []) {
    legacyMessages.push({ msgtype: "image", mediaPath: filePath });
  }
  for (const filePath of Array.isArray(data.filePaths) ? data.filePaths : []) {
    legacyMessages.push({ msgtype: "file", mediaPath: filePath });
  }
  return normalizeWechatWorkCustomerServiceMessages(legacyMessages);
}

export function normalizeWechatWorkEventMsgMenu(value: unknown) {
  return normalizeWechatWorkMsgMenu(value, "msgmenu");
}

export function isWechatWorkEventReplyPayloadKind(kind: unknown) {
  return kind === "wechat_work_event_text" || kind === "wechat_work_event_msgmenu";
}

function normalizeWechatWorkCustomerServiceMessage(value: unknown, index: number): WechatWorkQueuedMessage {
  const item = plainObject(value, `messages[${index}]`);
  const msgtype = normalizeMsgType(item.msgtype, `messages[${index}].msgtype`);
  if (msgtype === "text") {
    const source = typeof item.text === "string" && !item.message ? { content: item.text } : bodyFor(item, "text");
    const content = requiredBoundedText(source.content ?? item.content ?? item.text, "text.content", 1, 2048);
    return { msgtype, message: { content } };
  }
  if (MEDIA_MESSAGE_TYPES.has(msgtype)) {
    return normalizeMediaMessage(item, msgtype as "image" | "voice" | "video" | "file");
  }
  if (msgtype === "link") return { msgtype, message: normalizeLinkMessage(bodyFor(item, "link")) };
  if (msgtype === "miniprogram") return { msgtype, message: normalizeMiniProgramMessage(bodyFor(item, "miniprogram")) };
  if (msgtype === "msgmenu") return { msgtype, message: normalizeWechatWorkMsgMenu(bodyFor(item, "msgmenu"), "msgmenu") };
  if (msgtype === "location") return { msgtype, message: normalizeLocationMessage(bodyFor(item, "location")) };
  throw new BadRequestException(`unsupported wechat work customer-service msgtype: ${msgtype}`);
}

function normalizeMediaMessage(
  item: Record<string, unknown>,
  msgtype: "image" | "voice" | "video" | "file",
): WechatWorkQueuedMessage {
  const source = optionalBodyFor(item, msgtype);
  const mediaId = String(source?.media_id || item.media_id || item.mediaId || "").trim();
  if (mediaId) return { msgtype, message: { media_id: mediaId } };

  const mediaPath = String(item.mediaPath || item.filePath || item.localPath || source?.mediaPath || source?.filePath || "").trim();
  if (!mediaPath) throw new BadRequestException(`${msgtype}.media_id is required`);
  if (msgtype === "voice" || msgtype === "video") {
    throw new BadRequestException(`${msgtype} sends require an existing Enterprise WeChat media_id`);
  }

  const resolved = msgtype === "image"
    ? resolveWechatWorkImageFile(mediaPath)
    : resolveWechatWorkMaterialFile(mediaPath);
  return {
    msgtype,
    message: {},
    mediaPath: resolved.filePath,
    fileName: resolved.fileName,
  };
}

function normalizeLinkMessage(value: Record<string, unknown>) {
  const title = requiredBoundedText(value.title, "link.title", 1, 512);
  const url = requiredHttpsUrl(value.url, "link.url", 2048);
  const desc = optionalBoundedText(value.desc, "link.desc", 1024);
  const picUrl = optionalHttpsUrl(value.pic_url ?? value.picUrl, "link.pic_url", 2048);
  return {
    title,
    ...(desc ? { desc } : {}),
    url,
    ...(picUrl ? { pic_url: picUrl } : {}),
  };
}

function normalizeMiniProgramMessage(value: Record<string, unknown>) {
  return {
    appid: requiredBoundedText(value.appid, "miniprogram.appid", 1, 64),
    title: requiredBoundedText(value.title, "miniprogram.title", 1, 512),
    thumb_media_id: requiredBoundedText(value.thumb_media_id ?? value.thumbMediaId, "miniprogram.thumb_media_id", 1, 256),
    pagepath: requiredBoundedText(value.pagepath ?? value.pagePath, "miniprogram.pagepath", 1, 1024),
  };
}

function normalizeLocationMessage(value: Record<string, unknown>) {
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new BadRequestException("location.latitude must be between -90 and 90");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new BadRequestException("location.longitude must be between -180 and 180");
  }
  const name = optionalBoundedText(value.name, "location.name", 1024);
  const address = optionalBoundedText(value.address, "location.address", 2048);
  return {
    latitude,
    longitude,
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
  };
}

function normalizeWechatWorkMsgMenu(value: unknown, label: string) {
  const menu = plainObject(value, label);
  const headContent = optionalBoundedText(menu.head_content ?? menu.headContent, `${label}.head_content`, 1024);
  const tailContent = optionalBoundedText(menu.tail_content ?? menu.tailContent, `${label}.tail_content`, 1024);
  const rawList = Array.isArray(menu.list) ? menu.list : [];
  if (!rawList.length) throw new BadRequestException(`${label}.list must include at least one menu item`);
  if (rawList.length > 10) throw new BadRequestException(`${label}.list cannot exceed 10 menu items`);
  return {
    ...(headContent ? { head_content: headContent } : {}),
    list: rawList.map((item, index) => normalizeMsgMenuItem(item, `${label}.list[${index}]`)),
    ...(tailContent ? { tail_content: tailContent } : {}),
  };
}

function normalizeMsgMenuItem(value: unknown, label: string) {
  const item = plainObject(value, label);
  const type = String(item.type || "").trim();
  if (type === "click") {
    const click = plainObject(item.click, `${label}.click`);
    return {
      type,
      click: {
        id: requiredBoundedText(click.id, `${label}.click.id`, 1, 64),
        content: requiredBoundedText(click.content, `${label}.click.content`, 1, 128),
      },
    };
  }
  if (type === "view") {
    const view = plainObject(item.view, `${label}.view`);
    return {
      type,
      view: {
        url: requiredHttpsUrl(view.url, `${label}.view.url`, 2048),
        content: requiredBoundedText(view.content, `${label}.view.content`, 1, 1024),
      },
    };
  }
  if (type === "miniprogram") {
    const miniprogram = plainObject(item.miniprogram, `${label}.miniprogram`);
    return {
      type,
      miniprogram: {
        appid: requiredBoundedText(miniprogram.appid, `${label}.miniprogram.appid`, 1, 64),
        pagepath: requiredBoundedText(miniprogram.pagepath ?? miniprogram.pagePath, `${label}.miniprogram.pagepath`, 1, 1024),
        content: requiredBoundedText(miniprogram.content, `${label}.miniprogram.content`, 1, 1024),
      },
    };
  }
  throw new BadRequestException(`${label}.type must be click, view, or miniprogram`);
}

function normalizeMsgType(value: unknown, label: string): WechatWorkCustomerServiceMsgType {
  const msgtype = String(value || "").trim();
  if (!CUSTOMER_SERVICE_MESSAGE_TYPES.has(msgtype)) {
    throw new BadRequestException(`${label} must be an official Enterprise WeChat customer-service message type`);
  }
  return msgtype as WechatWorkCustomerServiceMsgType;
}

function bodyFor(item: Record<string, unknown>, msgtype: string) {
  return optionalBodyFor(item, msgtype) || plainObject(item.message, `${msgtype} message`);
}

function optionalBodyFor(item: Record<string, unknown>, msgtype: string) {
  const direct = item[msgtype] ?? item.message;
  if (direct == null) return null;
  return plainObject(direct, `${msgtype} message`);
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredBoundedText(value: unknown, label: string, minBytes: number, maxBytes: number) {
  const text = String(value || "").trim();
  const length = Buffer.byteLength(text, "utf8");
  if (length < minBytes || length > maxBytes) {
    throw new BadRequestException(`${label} must be ${minBytes}-${maxBytes} UTF-8 bytes`);
  }
  return text;
}

function optionalBoundedText(value: unknown, label: string, maxBytes: number) {
  const text = String(value || "").trim();
  if (!text) return "";
  const length = Buffer.byteLength(text, "utf8");
  if (length > maxBytes) throw new BadRequestException(`${label} cannot exceed ${maxBytes} UTF-8 bytes`);
  return text;
}

function requiredHttpsUrl(value: unknown, label: string, maxBytes: number) {
  const text = requiredBoundedText(value, label, 1, maxBytes);
  return assertHttpUrl(text, label);
}

function optionalHttpsUrl(value: unknown, label: string, maxBytes: number) {
  const text = optionalBoundedText(value, label, maxBytes);
  if (!text) return "";
  return assertHttpUrl(text, label);
}

function assertHttpUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException(`${label} must be a valid http or https URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequestException(`${label} must be a valid http or https URL`);
  }
  return parsed.toString();
}
