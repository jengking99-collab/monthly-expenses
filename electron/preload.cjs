const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openCalculator: () => ipcRenderer.send('open-calculator'),
});
