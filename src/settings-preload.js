'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch),
  setSearchShortcut: (accelerator) => ipcRenderer.invoke('settings:set-search-shortcut', accelerator),
  getAiConfig: () => ipcRenderer.invoke('ai:get-config'),
  setAiConfig: (patch) => ipcRenderer.invoke('ai:set-config', patch),
  setAiApiKey: (value) => ipcRenderer.invoke('ai:set-api-key', value),
  clearAiApiKey: () => ipcRenderer.invoke('ai:clear-api-key'),
  testAi: (input) => ipcRenderer.invoke('ai:test', input),
  openAiChat: () => ipcRenderer.invoke('settings:open-chat'),
  close: () => ipcRenderer.send('settings:close'),
  openReminders: () => ipcRenderer.send('settings:open-reminders'),
  onChanged: (cb) => ipcRenderer.on('settings:changed', (_event, settings) => cb(settings)),
  onFocusAi: (cb) => ipcRenderer.on('settings:focus-ai', () => cb())
});