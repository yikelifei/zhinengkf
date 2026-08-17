import {
  identityExpectation,
  localDesignImageUrl,
  type DesignJob,
} from "../../lib/api";
import { safeRenderableImageSrc } from "../../lib/renderable-image-src";

export function createDesignPlatformDeviceId() {
  const runtimeCrypto = globalThis.crypto;
  const randomId = runtimeCrypto?.randomUUID
    ? runtimeCrypto.randomUUID()
    : randomHexToken(16, runtimeCrypto);
  return `smart-kefu-${randomId}`.toLowerCase();
}

const DESIGN_PLATFORM_DEVICE_ID_STORAGE_KEY = "smart-kefu.design-platform.device-id";

export function readRememberedDesignPlatformDeviceId() {
  try {
    return globalThis.localStorage?.getItem(DESIGN_PLATFORM_DEVICE_ID_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function rememberDesignPlatformDeviceId(deviceId: string) {
  const normalized = deviceId.trim();
  try {
    if (normalized) globalThis.localStorage?.setItem(DESIGN_PLATFORM_DEVICE_ID_STORAGE_KEY, normalized);
    else globalThis.localStorage?.removeItem(DESIGN_PLATFORM_DEVICE_ID_STORAGE_KEY);
  } catch {}
}

export function designImagePreviewSrc(
  job: DesignJob,
  image?: NonNullable<DesignJob["images"]>[number] | null,
) {
  if (!image) return "";
  return localDesignImageUrl(job.id, image, identityExpectation(job)) || safeRenderableImageSrc(image.downloadUrl);
}

function randomHexToken(byteLength: number, runtimeCrypto?: Crypto) {
  if (runtimeCrypto?.getRandomValues) {
    const bytes = new Uint8Array(byteLength);
    runtimeCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
