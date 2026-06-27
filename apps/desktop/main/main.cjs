const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { resolveCliPath, getRootDir } = require('./cli-resolver.cjs');

// Reuse existing modules (placed in apps/desktop/ for backward compat).
const {
  cancelCommand,
  publicRegistry,
  readHistory,
  runCommand: runCliCommand,
} = require('../cli-bridge.cjs');

const {
  listAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  setActiveAccount,
  suggestProfileName,
} = require('../accounts.cjs');

// ---------- helpers ----------

let rootDir = '';
let cliPath = '';

function historyDir() {
  return path.join(app.getPath('userData'), 'history');
}

function userDataDir() {
  return app.getPath('userData');
}

// ---------- window ----------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: '1688 to Ozon Studio',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'dist', 'index.html'),
    );
  }
}

// ---------- IPC handlers ----------

function registerIpc() {
  // --- command registry ---
  ipcMain.handle('desktop:getCommandRegistry', () => publicRegistry());

  // --- command execution ---
  ipcMain.handle('desktop:runCommand', (_event, payload) =>
    runCliCommand(rootDir, historyDir(), payload),
  );
  ipcMain.handle('desktop:cancelCommand', (_event, runId) =>
    cancelCommand(runId),
  );

  // --- history ---
  ipcMain.handle('desktop:getCommandHistory', (_event, query) =>
    readHistory(historyDir(), query),
  );

  // --- runtime ---
  ipcMain.handle(
    'desktop:getRuntimeStatus',
    async (_event, profile = 'default') => {
      const [daemon, whoami] = await Promise.allSettled([
        runCliCommand(rootDir, historyDir(), {
          commandId: 'daemonStatus',
          profile,
          saveHistory: false,
          timeoutMs: 8000,
        }),
        runCliCommand(rootDir, historyDir(), {
          commandId: 'whoami',
          profile,
          saveHistory: false,
          timeoutMs: 8000,
        }),
      ]);
      return {
        profile,
        daemon:
          daemon.status === 'fulfilled' ? daemon.value : null,
        account:
          whoami.status === 'fulfilled' ? whoami.value : null,
      };
    },
  );

  ipcMain.handle('desktop:getCliInfo', () => ({
    cliPath,
    cliExists: true,
    rootDir,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('desktop:doctor', async (_event, profile) => {
    try {
      const record = await runCliCommand(rootDir, historyDir(), {
        commandId: 'doctor',
        profile,
        saveHistory: false,
        timeoutMs: 15000,
        options: { noLaunch: true },
      });
      return { ok: record.status === 'success', ...record };
    } catch (error) {
      return { ok: false, message: (error && error.message) || String(error) };
    }
  });

  // --- accounts ---
  ipcMain.handle('desktop:listAccounts', () =>
    listAccounts(userDataDir()),
  );

  ipcMain.handle('desktop:addAccount', (_event, params) =>
    addAccount(userDataDir(), params),
  );

  ipcMain.handle('desktop:updateAccount', (_event, profile, params) =>
    updateAccount(userDataDir(), profile, params),
  );

  ipcMain.handle('desktop:removeAccount', (_event, profile) =>
    removeAccount(userDataDir(), profile),
  );

  ipcMain.handle('desktop:setActiveAccount', (_event, profile) =>
    setActiveAccount(userDataDir(), profile),
  );

  ipcMain.handle('desktop:suggestProfileName', () =>
    suggestProfileName(userDataDir()),
  );

  ipcMain.handle('desktop:loginAccount', async (_event, profile) => {
    const record = await runCliCommand(rootDir, historyDir(), {
      commandId: 'login',
      profile,
      confirmed: true,
      options: { headed: true },
    });
    const status =
      record.status === 'success' ? 'logged_in' : record.status;
    try {
      updateAccount(userDataDir(), profile, {
        status,
        lastLoginAt: new Date().toISOString(),
      });
    } catch { /* account may not exist yet */ }
    return { ...record, accountStatus: status };
  });

  ipcMain.handle('desktop:refreshAccountStatus', async (_event, profile) => {
    let status = 'unknown';
    try {
      const whoami = await runCliCommand(rootDir, historyDir(), {
        commandId: 'whoami',
        profile,
        saveHistory: false,
        timeoutMs: 15000,
        options: { verify: true },
      });
      status =
        whoami.status === 'success' ? 'logged_in' : whoami.status;
    } catch {
      status = 'error';
    }
    try {
      updateAccount(userDataDir(), profile, { status });
    } catch { /* ignore */ }
    return { profile, status };
  });
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  try {
    cliPath = resolveCliPath();
  } catch (error) {
    // Fatal: CLI is required. Show dialog and quit.
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'CLI 缺失',
      (error && error.message) || '找不到内置 CLI，请联系管理员。',
    );
    app.quit();
    return;
  }

  rootDir = getRootDir();

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
