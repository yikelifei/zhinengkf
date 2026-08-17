export function isTrustedInternalZhenxiWorkspaceHealth(value: unknown) {
  if (!isRecord(value)) return false;
  const runtime = isRecord(value.runtime) ? value.runtime : {};
  const localDemo = isRecord(value.localDemo) ? value.localDemo : {};
  const ai = isRecord(value.ai) ? value.ai : {};
  return runtime.channel === "internal"
    && runtime.localWorkspace === true
    && localDemo.localGenerateEnabled === true
    && ai.imageConfigured === true;
}

export function supportsZhenxiCustomerImageGeneration(adapter: unknown, mcpEnabled = true) {
  const value = String(adapter || "").trim();
  return value === "art_image_local" || (value === "zhenxi_external" && mcpEnabled);
}

export function supportsZhenxiCustomerCopyGeneration(adapter: unknown, mcpEnabled = true) {
  return String(adapter || "").trim() === "zhenxi_external" && mcpEnabled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
