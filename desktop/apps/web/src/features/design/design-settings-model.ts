export type DesignSettingsSaveIntent = {
  adapter: string;
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  cookie?: string;
  deviceId?: string;
};

export function settingsSaveIntent(
  adapter: string,
  baseUrl: string,
  apiKey: string,
  accessToken: string,
  cookie: string,
  deviceId: string,
): DesignSettingsSaveIntent | null {
  const normalizedAdapter = adapter.trim();
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedApiKey = apiKey.trim();
  const normalizedAccessToken = accessToken.trim();
  if (!normalizedAdapter || !normalizedBaseUrl) return null;
  return {
    adapter: normalizedAdapter,
    baseUrl: normalizedBaseUrl,
    apiKey: normalizedApiKey || undefined,
    accessToken: normalizedAccessToken || undefined,
    cookie: cookie.trim() || undefined,
    deviceId: deviceId.trim() || undefined,
  };
}
