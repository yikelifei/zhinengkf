"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("smartKefu", {
  notify(payload) {
    return ipcRenderer.invoke("notify", payload);
  },
  zhenxiEmbedded: {
    discoverDesktop() {
      return ipcRenderer.invoke("zhenxi-embedded:discover-desktop");
    },
    open(payload) {
      return ipcRenderer.invoke("zhenxi-embedded:open", payload);
    },
    setBounds(bounds) {
      return ipcRenderer.invoke("zhenxi-embedded:set-bounds", bounds);
    },
    reload() {
      return ipcRenderer.invoke("zhenxi-embedded:reload");
    },
    status() {
      return ipcRenderer.invoke("zhenxi-embedded:status");
    },
    hide() {
      return ipcRenderer.invoke("zhenxi-embedded:hide");
    },
  },
});
