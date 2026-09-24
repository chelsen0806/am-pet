'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('searchAPI', {
  get: () => ipcRenderer.invoke('search:get'),
  setMode: (mode) => ipcRenderer.invoke('search:set-mode', mode),
  setEngine: (engine) => ipcRenderer.invoke('search:set-engine', engine),
  setTranslationLanguage: (patch) => ipcRenderer.invoke('search:set-translation-language', patch),
  submit: (query) => ipcRenderer.invoke('search:submit', query),
  translate: (input) => ipcRenderer.invoke('search:translate', input),
  readClipboard: () => ipcRenderer.invoke('search:read-clipboard'),
  close: () => ipcRenderer.send('search:close'),
  getPrefill: () => ipcRenderer.invoke('search:get-prefill'),
  ackPrefill: () => ipcRenderer.send('search:prefill-consumed'),
  openAiSettings: () => ipcRenderer.invoke('settings:open-ai'),
  getAiConfig: () => ipcRenderer.invoke('ai:get-config'),
  setAiConfig: (patch) => ipcRenderer.invoke('ai:set-config', patch),
  setAiApiKey: (value) => ipcRenderer.invoke('ai:set-api-key', value),
  clearAiApiKey: () => ipcRenderer.invoke('ai:clear-api-key'),
  testAi: (patch) => ipcRenderer.invoke('ai:test', patch),
  aiChat: (input) => ipcRenderer.invoke('ai:chat', input),
  onChanged: (cb) => ipcRenderer.on('search:changed', (_event, payload) => cb(payload)),
  onFocus: (cb) => ipcRenderer.on('search:focus', () => cb()),
  onPrefill: (cb) => ipcRenderer.on('search:prefill', (_event, payload) => cb(payload))
});
