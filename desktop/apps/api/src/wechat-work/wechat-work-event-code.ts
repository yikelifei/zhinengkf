import crypto from "node:crypto";
import { appConfig } from "../shared/app-config";

export const WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS = 20_000;
export const WECHAT_WORK_EVENT_CODE_LONG_TTL_MS = 48 * 60 * 60 * 1000;

type SealedWechatWorkEventCode = {
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
};

export function wechatWorkEventCodeHash(code: unknown) {
  return crypto.createHash("sha256").update(requiredEventCode(code)).digest("hex");
}

export function sealWechatWorkEventCode(code: unknown): SealedWechatWorkEventCode {
  const plaintext = requiredEventCode(code);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", eventCodeEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    createdAt: new Date().toISOString(),
  };
}

export function openSealedWechatWorkEventCode(value: unknown) {
  const sealed = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (sealed.alg !== "aes-256-gcm") throw new Error("wechat work event credential algorithm is invalid");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    eventCodeEncryptionKey(),
    Buffer.from(requiredString(sealed.iv, "event credential iv"), "base64"),
  );
  decipher.setAuthTag(Buffer.from(requiredString(sealed.tag, "event credential tag"), "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(requiredString(sealed.ciphertext, "event credential ciphertext"), "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isWechatWorkEventTextTask(task: unknown) {
  const payload = task && typeof task === "object" ? (task as Record<string, unknown>).payload : null;
  const kind = payload && typeof payload === "object" ? (payload as Record<string, unknown>).kind : "";
  return kind === "wechat_work_event_text" || kind === "wechat_work_event_msgmenu";
}

function eventCodeEncryptionKey() {
  const material = [
    appConfig.wechatWorkCorpId,
    appConfig.wechatWorkSecret,
    appConfig.wechatWorkEncodingAesKey,
    "smart-kefu-wechat-work-event-code-v1",
  ].map((item) => String(item || "").trim()).join(":");
  return crypto.createHash("sha256").update(material || "smart-kefu-wechat-work-event-code-local").digest();
}

function requiredEventCode(value: unknown) {
  const text = requiredString(value, "event code");
  if (Buffer.byteLength(text, "utf8") > 1024) throw new Error("wechat work event code is too long");
  return text;
}

function requiredString(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`wechat work ${label} is required`);
  return text;
}
