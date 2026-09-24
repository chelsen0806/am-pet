'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reminderAPI', {
  get: () => ipcRenderer.invoke('reminders:get'),
  update: (patch) => ipcRenderer.invoke('reminders:update', patch),
  close: () => ipcRenderer.send('reminders:close'),
  onChanged: (cb) => ipcRenderer.on('reminders:changed', (_event, payload) => cb(payload))
});