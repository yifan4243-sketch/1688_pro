const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getCommandRegistry: () => ipcRenderer.invoke('desktop:getCommandRegistry'),
  runCommand: (payload) => ipcRenderer.invoke('desktop:runCommand', payload),
  cancelCommand: (runId) => ipcRenderer.invoke('desktop:cancelCommand', runId),
  getHistory: (query) => ipcRenderer.invoke('desktop:getCommandHistory', query),
  getRuntimeStatus: (profile) => ipcRenderer.invoke('desktop:getRuntimeStatus', profile),
});
