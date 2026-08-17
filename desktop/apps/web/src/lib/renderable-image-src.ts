export function safeRenderableImageSrc(value: unknown) {
  const src = String(value || "").trim();
  if (!src) return "";
  if (hasUnsupportedRenderableImageExtension(src)) return "";
  if (/^data:image\//i.test(src)) return src;
  if (/^https:\/\/[^\s]+$/i.test(src)) return src;
  if (src.startsWith("/api/") || src.startsWith("/assets/") || src.startsWith("/local-assets/") || src.startsWith("/generated/")) {
    return src;
  }
  if (isTrustedLoopbackGeneratedImageSrc(src)) return src;
  return "";
}

export function hasUnsupportedRenderableImageExtension(value: unknown) {
  const src = String(value || "").trim();
  if (!src || /^data:image\//i.test(src)) return false;
  const candidatePath = renderableImagePathCandidate(src);
  const fileName = candidatePath.split(/[\\/]/).filter(Boolean).pop() || candidatePath;
  const cleanFileName = fileName.split(/[?#]/)[0] || "";
  if (!cleanFileName.includes(".")) return false;
  const extension = cleanFileName.slice(cleanFileName.lastIndexOf(".")).toLowerCase();
  return ![".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".avif"].includes(extension);
}

function isTrustedLoopbackGeneratedImageSrc(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    if (!url.pathname.startsWith("/local-assets/") && !url.pathname.startsWith("/generated/")) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127\./.test(hostname);
  } catch {
    return false;
  }
}

function renderableImagePathCandidate(value: string) {
  try {
    const url = value.startsWith("/") ? new URL(value, "http://local.invalid") : new URL(value);
    return url.searchParams.get("path") || url.pathname;
  } catch {
    return value;
  }
}
