'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoroAPI', {
  get: () => ipcRenderer.invoke('pomodoro:get'),
  start: () => ipcRenderer.invoke('pomodoro:start'),
  pause: () => ipcRenderer.invoke('pomodoro:pause'),
  reset: () => ipcRenderer.invoke('pomodoro:reset'),
  skip: () => ipcRenderer.invoke('pomodoro:skip'),
  close: () => ipcRenderer.send('pomodoro:close'),
  onChanged: (cb) => ipcRenderer.on('pomodoro:changed', (_event, payload) => cb(payload))
});
