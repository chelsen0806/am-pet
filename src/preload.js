'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  fit: (w, h) => ipcRenderer.send('window:fit', { w, h }),
  dragStart: (x, y) => ipcRenderer.send('drag:start', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('drag:move', { x, y }),
  dragEnd: () => ipcRenderer.send('drag:end'),
  setIgnore: (ignore) => ipcRenderer.send('hit:ignore', ignore),
  openMenu: () => ipcRenderer.send('menu:open'),
  openSearch: () => ipcRenderer.send('search:open'),
  interact: () => ipcRenderer.send('pet:interaction'),
  getState: () => ipcRenderer.invoke('app:get-state'),
  onCursor: (cb) => ipcRenderer.on('cursor:move', (_event, pos) => cb(pos)),
  onLock: (cb) => ipcRenderer.on('position:lock', (_event, locked) => cb(locked)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_event, settings) => cb(settings))
});