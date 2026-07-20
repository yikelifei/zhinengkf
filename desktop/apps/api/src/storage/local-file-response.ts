const LOCAL_FILE_CSP = "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'none'";

type LocalFileResponse = {
  mimeType: string;
  sizeBytes: number;
  fileName?: string;
  inlineSafe?: boolean;
};

type HeaderReply = {
  header(name: string, value: string): unknown;
};

export function applySafeLocalFileHeaders(reply: HeaderReply, file: LocalFileResponse) {
  const fileName = sanitizeFileName(file.fileName || "asset");
  const disposition = file.inlineSafe === true && isSafeInlineMime(file.mimeType) ? "inline" : "attachment";
  reply.header("Content-Type", file.mimeType);
  reply.header("Content-Length", String(file.sizeBytes));
  reply.header("Cache-Control", "private, max-age=3600");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", LOCAL_FILE_CSP);
  reply.header("Content-Disposition", `${disposition}; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
}

function isSafeInlineMime(mimeType: string) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "application/pdf"].includes(
    String(mimeType || "").toLowerCase(),
  );
}

function sanitizeFileName(value: string) {
  return String(value || "asset").replace(/[\r\n\0"\\/]/g, "_").slice(0, 180) || "asset";
}

function asciiFileName(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "_");
}
