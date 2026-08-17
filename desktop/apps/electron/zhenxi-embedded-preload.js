"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopShell", {
  platform: process.platform,
  version: "smart-kefu-embedded",
  deviceId: readArgument("art-device-id"),
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
