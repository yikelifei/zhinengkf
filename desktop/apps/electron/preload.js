"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("smartKefu", {
  notify(payload) {
    return ipcRenderer.invoke("notify", payload);
  },
});
