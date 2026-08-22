"use strict";

const { contextBridge } = require("electron");

const deviceId = readArgument("art-device-id");
const activationStatus = readJsonArgument("art-activation-status", {
  required: false,
  active: true,
  reason: "not_required",
  deviceIdSuffix: "",
  activation: null,
});

contextBridge.executeInMainWorld({
  func: (mirroredDeviceId, mirroredActivationStatus) => {
    localStorage.setItem("art_token", "cookie-session");
    localStorage.removeItem("art_supabase_access_token");
    if (mirroredDeviceId) localStorage.setItem("art_device_id", mirroredDeviceId);

    const patchKey = "__smartKefuZhenxiExternalSessionMirror";
    if (globalThis[patchKey]) return;
    Object.defineProperty(globalThis, patchKey, { value: true, configurable: false });

    const nativeFetch = globalThis.fetch.bind(globalThis);
    const jsonResponse = (payload, response) => {
      const headers = new Headers(response?.headers || {});
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "no-store");
      headers.delete("content-encoding");
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      return new Response(JSON.stringify(payload), {
        status: response?.status || 200,
        statusText: response?.statusText || "OK",
        headers,
      });
    };
    const requestUrl = (input) => {
      try {
        const raw = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
        return new URL(raw, location.href);
      } catch {
        return null;
      }
    };

    globalThis.fetch = async (input, init) => {
      const target = requestUrl(input);
      const sameOrigin = target?.origin === location.origin;
      if (sameOrigin && target.pathname === "/api/activation/status") {
        return jsonResponse({ ok: true, data: mirroredActivationStatus });
      }

      const response = await nativeFetch(input, init);
      if (!sameOrigin || target.pathname !== "/api/auth/session" || !response.ok) return response;
      try {
        const payload = await response.clone().json();
        if (payload?.ok !== true || !payload?.data?.user) return response;
        return jsonResponse({
          ...payload,
          data: {
            ...payload.data,
            activation: mirroredActivationStatus,
          },
        }, response);
      } catch {
        return response;
      }
    };
  },
  args: [deviceId, activationStatus],
});

contextBridge.exposeInMainWorld("desktopShell", {
  platform: process.platform,
  version: "smart-kefu-embedded",
  deviceId,
  deviceLabel: readArgument("art-device-label"),
});

function readArgument(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return raw.slice(prefix.length);
  }
}

function readJsonArgument(name, fallback) {
  try {
    const parsed = JSON.parse(readArgument(name));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
