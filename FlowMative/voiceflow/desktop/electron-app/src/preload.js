const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

function subscribe(channel, handler) {
  const listener = (_event, payload) => {
    handler(payload);
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("flowmative", {
  settings: {
    get: () => invoke("settings:get"),
    update: (payload) => invoke("settings:update", payload)
  },
  audio: {
    listDevices: (forceRefresh = false) => invoke("audio:devices:list", { forceRefresh })
  },
  macros: {
    get: () => invoke("macros:get"),
    add: (payload) => invoke("macros:add", payload),
    delete: (phrase) => invoke("macros:delete", phrase)
  },
  history: {
    list: () => invoke("history:list"),
    copyResult: (result) => invoke("history:copy-result", result),
    retryInsert: (entryId) => invoke("history:retry-insert", entryId),
    deleteEntry: (entryId) => invoke("history:delete-entry", entryId),
    clear: () => invoke("history:clear")
  },
  dictionary: {
    list: () => invoke("dictionary:list"),
    add: (entries) => invoke("dictionary:add", entries),
    replace: (entries) => invoke("dictionary:replace", entries),
    deleteEntry: (entry) => invoke("dictionary:delete-entry", entry),
    clear: () => invoke("dictionary:clear")
  },
  diagnostics: {
    getStatus: () => invoke("diagnostics:status"),
    exportLogs: () => invoke("diagnostics:export")
  },
  voice: {
    getStatus: () => invoke("voice:status")
  },
  controlCenter: {
    setSection: (section) => invoke("control-center:set-section", section)
  },
  onOverlayUpdate: (handler) => subscribe("overlay:update", handler),
  onBubbleUpdate: (handler) => subscribe("bubble:update", handler),
  onHistoryUpdated: (handler) => subscribe("history:updated", handler),
  onVoiceStatus: (handler) => subscribe("voice:status-updated", handler),
  onControlCenterSection: (handler) => subscribe("control-center:section", handler)
});
