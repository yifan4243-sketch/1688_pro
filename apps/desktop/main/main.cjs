const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { resolveCliPath, getRootDir } = require('./cli-resolver.cjs');

// Reuse existing modules (placed in apps/desktop/ for backward compat).
const {
  cancelCommand,
  publicRegistry,
  readHistory,
  runCommand: runCliCommand,
  normalizeAccountStatus,
} = require('../cli-bridge.cjs');

const {
  listAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  setActiveAccount,
  suggestProfileName,
} = require('../accounts.cjs');

const {
  listProductHistory,
  addProductsToHistory,
  clearProductHistory,
} = require('../product-history.cjs');

const {
  loadSettings: loadOzonSettings,
  saveSettings: saveOzonSettings,
  getStoreStats: getOzonStoreStats,
} = require('../ozon-settings.cjs');

const {
  generateOzonDraft,
  submitOzonDraft,
} = require('../ozon-draft.cjs');

// ---------- runtime ----------

/** @type {{ rootDir: string, cliPath: string }} */
let runtime = { rootDir: '', cliPath: '' };

function historyDir() {
  return path.join(app.getPath('userData'), 'history');
}

function userDataDir() {
  return app.getPath('userData');
}

/** Shorthand: run a CLI command with the shared runtime and history dir. */
function exec(payload) {
  return runCliCommand(runtime, historyDir(), payload);
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
  ipcMain.handle('desktop:runCommand', (_event, payload) => exec(payload));
  ipcMain.handle('desktop:cancelCommand', (_event, runId) => cancelCommand(runId));

  // --- history ---
  ipcMain.handle('desktop:getCommandHistory', (_event, query) => readHistory(historyDir(), query));

  // --- runtime ---
  ipcMain.handle('desktop:getRuntimeStatus', async (_event, profile = 'default') => {
    const [daemon, whoami] = await Promise.allSettled([
      exec({ commandId: 'daemonStatus', profile, saveHistory: false, timeoutMs: 8000 }),
      exec({ commandId: 'whoami', profile, saveHistory: false, timeoutMs: 8000 }),
    ]);
    return {
      profile,
      daemon: daemon.status === 'fulfilled' ? daemon.value : null,
      account: whoami.status === 'fulfilled' ? whoami.value : null,
    };
  });

  ipcMain.handle('desktop:getCliInfo', () => ({
    cliPath: runtime.cliPath,
    cliExists: true,
    rootDir: runtime.rootDir,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('desktop:doctor', async (_event, profile) => {
    try {
      const record = await exec({
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
  ipcMain.handle('desktop:listAccounts', () => listAccounts(userDataDir()));

  ipcMain.handle('desktop:addAccount', (_event, params) => addAccount(userDataDir(), params));

  ipcMain.handle('desktop:updateAccount', (_event, profile, params) => updateAccount(userDataDir(), profile, params));

  ipcMain.handle('desktop:removeAccount', (_event, profile) => removeAccount(userDataDir(), profile));

  ipcMain.handle('desktop:setActiveAccount', (_event, profile) => setActiveAccount(userDataDir(), profile));

  ipcMain.handle('desktop:suggestProfileName', () => suggestProfileName(userDataDir()));

  ipcMain.handle('desktop:loginAccount', async (_event, profile) => {
    const record = await exec({
      commandId: 'login',
      profile,
      confirmed: true,
      options: { headed: true, force: true, timeout: 300 },
    });
    const status = normalizeAccountStatus(record.status);
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
      const whoami = await exec({
        commandId: 'whoami',
        profile,
        saveHistory: false,
        timeoutMs: 15000,
        options: { verify: true },
      });
      status = normalizeAccountStatus(whoami.status);
    } catch {
      status = 'error';
    }
    try {
      updateAccount(userDataDir(), profile, { status });
    } catch { /* ignore */ }
    return { profile, status };
  });

  // --- product history ---
  ipcMain.handle('desktop:listProductHistory', (_event, limit) =>
    listProductHistory(userDataDir(), limit),
  );
  ipcMain.handle('desktop:addProductsToHistory', (_event, products, meta) =>
    addProductsToHistory(userDataDir(), products, meta),
  );
  ipcMain.handle('desktop:clearProductHistory', () =>
    clearProductHistory(userDataDir()),
  );

  // --- Ozon draft / AI / submit ---
  ipcMain.handle('desktop:getOzonSettings', () =>
    loadOzonSettings(userDataDir()),
  );
  ipcMain.handle('desktop:saveOzonSettings', (_event, patch) =>
    saveOzonSettings(userDataDir(), patch),
  );
  ipcMain.handle('desktop:getOzonStoreStats', () =>
    getOzonStoreStats(userDataDir()),
  );
  ipcMain.handle('desktop:generateOzonDraft', async (_event, rows) =>
    generateOzonDraft(loadOzonSettings(userDataDir(), { includeSecrets: true }), rows),
  );
  ipcMain.handle('desktop:submitOzonDraft', async (_event, draft, confirmed) => {
    if (confirmed !== true) {
      throw new Error('提交 Ozon 前必须确认。');
    }
    return submitOzonDraft(loadOzonSettings(userDataDir(), { includeSecrets: true }), draft);
  });

  // --- terminal login (detached pwsh windows) ---
  ipcMain.handle('desktop:loginAccountInTerminal', async (_event, profile) => {
    console.log('[login-terminal] opening', profile);
    return openLoginTerminal(profile);
  });
  ipcMain.handle('desktop:loginAccountsInTerminal', async (_event, profiles) => {
    const uniqueProfiles = Array.from(new Set(
      (profiles || []).map(String).map((s) => s.trim()).filter(Boolean),
    )).slice(0, 3);
    console.log('[login-terminal] requested profiles', uniqueProfiles);
    const opened = [];
    for (const profile of uniqueProfiles) {
      opened.push(openLoginTerminal(profile).profile);
      await new Promise((r) => setTimeout(r, 800));
    }
    return { ok: true, requestedProfiles: uniqueProfiles, openedProfiles: opened, openedCount: opened.length };
  });
}

function quotePowerShell(value) {
  return String(value).replace(/`/g, '``').replace(/"/g, '`"');
}
function openLoginTerminal(profile) {
  const root = runtime.rootDir;
  const p = String(profile).trim();
  if (!p) throw new Error('profile 不能为空');
  const command = [
    `$Host.UI.RawUI.WindowTitle = "1688 登录 - ${quotePowerShell(p)}"`,
    `cd "${quotePowerShell(root)}"`,
    `Write-Host "正在登录 profile: ${quotePowerShell(p)}" -ForegroundColor Cyan`,
    `node .\\dist\\cli.js daemon stop --profile "${quotePowerShell(p)}"`,
    `node .\\dist\\cli.js login --profile "${quotePowerShell(p)}" --force --headed --timeout 300 --no-daemon --json --pretty`,
    `Write-Host ""`,
    `Write-Host "登录流程结束：${quotePowerShell(p)}。请回到桌面端点击刷新状态。" -ForegroundColor Cyan`,
  ].join('; ');
  const args = ['-NoExit', '-Command', command];
  let child;
  try {
    child = spawn('pwsh.exe', args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: false });
  } catch {
    child = spawn('powershell.exe', args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: false });
  }
  child.unref();
  return { ok: true, profile: p, mode: 'terminal' };
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  try {
    runtime.cliPath = resolveCliPath();
    runtime.rootDir = getRootDir();
  } catch (error) {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'CLI 缺失',
      (error && error.message) || '找不到内置 CLI，请联系管理员。',
    );
    app.quit();
    return;
  }

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
