const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getCommandRegistry: () => ipcRenderer.invoke('desktop:getCommandRegistry'),
  runCommand: (payload) => ipcRenderer.invoke('desktop:runCommand', payload),
  cancelCommand: (runId) => ipcRenderer.invoke('desktop:cancelCommand', runId),
  getHistory: (query) => ipcRenderer.invoke('desktop:getCommandHistory', query),
  getRuntimeStatus: (profile) => ipcRenderer.invoke('desktop:getRuntimeStatus', profile),

  // Account management
  listAccounts: () => ipcRenderer.invoke('desktop:listAccounts'),
  addAccount: (params) => ipcRenderer.invoke('desktop:addAccount', params),
  updateAccount: (profile, params) => ipcRenderer.invoke('desktop:updateAccount', profile, params),
  removeAccount: (profile) => ipcRenderer.invoke('desktop:removeAccount', profile),
  setActiveAccount: (profile) => ipcRenderer.invoke('desktop:setActiveAccount', profile),
  loginAccount: (profile) => ipcRenderer.invoke('desktop:loginAccount', profile),
  suggestProfileName: () => ipcRenderer.invoke('desktop:suggestProfileName'),
  refreshAccountStatus: (profile) => ipcRenderer.invoke('desktop:refreshAccountStatus', profile),
});
