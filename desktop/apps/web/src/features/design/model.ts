import {
  identityExpectation,
  localDesignImageUrl,
  type DesignJob,
} from "../../lib/api";

export function createDesignPlatformDeviceId() {
  const runtimeCrypto = globalThis.crypto;
  const randomId = runtimeCrypto?.randomUUID
    ? runtimeCrypto.randomUUID()
    : randomHexToken(16, runtimeCrypto);
  return `smart-kefu-${randomId}`.toLowerCase();
}

export function designImagePreviewSrc(
  job: DesignJob,
  image?: NonNullable<DesignJob["images"]>[number] | null,
) {
  if (!image) return "";
  return localDesignImageUrl(job.id, image, identityExpectation(job)) || image.downloadUrl || "";
}

function randomHexToken(byteLength: number, runtimeCrypto?: Crypto) {
  if (runtimeCrypto?.getRandomValues) {
    const bytes = new Uint8Array(byteLength);
    runtimeCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
