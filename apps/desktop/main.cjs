const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const {
  cancelCommand,
  publicRegistry,
  readHistory,
  runCommand,
} = require('./cli-bridge.cjs');

const rootDir = path.resolve(__dirname, '..', '..');

function historyDir() {
  return path.join(app.getPath('userData'), 'history');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: '1688 to Ozon Studio',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('desktop:getCommandRegistry', () => publicRegistry());
  ipcMain.handle('desktop:runCommand', (_event, payload) => runCommand(rootDir, historyDir(), payload));
  ipcMain.handle('desktop:cancelCommand', (_event, runId) => cancelCommand(runId));
  ipcMain.handle('desktop:getCommandHistory', (_event, query) => readHistory(historyDir(), query));
  ipcMain.handle('desktop:getRuntimeStatus', async (_event, profile = 'default') => {
    const [daemon, whoami] = await Promise.allSettled([
      runCommand(rootDir, historyDir(), { commandId: 'daemonStatus', profile, saveHistory: false, timeoutMs: 8000 }),
      runCommand(rootDir, historyDir(), { commandId: 'whoami', profile, saveHistory: false, timeoutMs: 8000 }),
    ]);
    return {
      profile,
      daemon: daemon.status === 'fulfilled' ? daemon.value : null,
      account: whoami.status === 'fulfilled' ? whoami.value : null,
    };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
