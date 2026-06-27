const fs = require('fs');
const path = require('path');

const ACCOUNTS_FILE = 'accounts.json';

const PROFILE_RE = /^[a-zA-Z0-9_-]+$/;

const DEFAULT_ACCOUNTS = {
  activeProfile: 'default',
  accounts: [
    {
      profile: 'default',
      alias: '默认账号',
      note: '',
      createdAt: new Date(0).toISOString(),
      lastUsedAt: new Date(0).toISOString(),
      lastLoginAt: null,
      status: 'unknown',
    },
  ],
};

function accountsPath(userDataPath) {
  return path.join(userDataPath, ACCOUNTS_FILE);
}

function loadAccounts(userDataPath) {
  const file = accountsPath(userDataPath);
  if (!fs.existsSync(file)) {
    return JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) {
      throw new Error('Invalid accounts.json structure');
    }
    if (data.accounts.length === 0) {
      data.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS.accounts));
    }
    if (!data.activeProfile || !data.accounts.some((a) => a.profile === data.activeProfile)) {
      data.activeProfile = data.accounts[0].profile;
    }
    return data;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
  }
}

function saveAccounts(userDataPath, data) {
  const file = accountsPath(userDataPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function listAccounts(userDataPath) {
  return loadAccounts(userDataPath);
}

function addAccount(userDataPath, params) {
  const profile = String(params.profile || '').trim();
  const alias = String(params.alias || '').trim();
  const note = String(params.note || '').trim();

  if (!profile) throw new Error('Profile ID 不能为空');
  if (!PROFILE_RE.test(profile)) throw new Error('Profile ID 只能包含字母、数字、下划线和中划线');
  if (!alias) throw new Error('账号备注名不能为空');

  const data = loadAccounts(userDataPath);
  if (data.accounts.some((a) => a.profile === profile)) {
    throw new Error(`Profile “${profile}” 已存在`);
  }

  const now = new Date().toISOString();
  data.accounts.push({
    profile,
    alias,
    note,
    createdAt: now,
    lastUsedAt: now,
    lastLoginAt: null,
    status: 'unknown',
  });
  saveAccounts(userDataPath, data);
  return data;
}

function updateAccount(userDataPath, profile, params) {
  const data = loadAccounts(userDataPath);
  const account = data.accounts.find((a) => a.profile === profile);
  if (!account) throw new Error(`未找到 profile: ${profile}`);

  if (params.alias !== undefined) {
    const alias = String(params.alias || '').trim();
    if (!alias) throw new Error('账号备注名不能为空');
    account.alias = alias;
  }
  if (params.note !== undefined) {
    account.note = String(params.note || '').trim();
  }
  if (params.status !== undefined) {
    account.status = String(params.status || 'unknown');
  }
  if (params.lastLoginAt !== undefined) {
    account.lastLoginAt = params.lastLoginAt;
  }
  saveAccounts(userDataPath, data);
  return data;
}

function removeAccount(userDataPath, profile) {
  if (profile === 'default') {
    throw new Error('不能删除默认账号');
  }
  const data = loadAccounts(userDataPath);
  const index = data.accounts.findIndex((a) => a.profile === profile);
  if (index === -1) throw new Error(`未找到 profile: ${profile}`);

  data.accounts.splice(index, 1);

  if (data.activeProfile === profile) {
    data.activeProfile = 'default';
    const defaultAccount = data.accounts.find((a) => a.profile === 'default');
    if (defaultAccount) defaultAccount.lastUsedAt = new Date().toISOString();
  }
  saveAccounts(userDataPath, data);
  return data;
}

function setActiveAccount(userDataPath, profile) {
  const data = loadAccounts(userDataPath);
  const account = data.accounts.find((a) => a.profile === profile);
  if (!account) throw new Error(`未找到 profile: ${profile}`);

  data.activeProfile = profile;
  account.lastUsedAt = new Date().toISOString();
  saveAccounts(userDataPath, data);
  return data;
}

function suggestProfileName(userDataPath) {
  const data = loadAccounts(userDataPath);
  const existing = new Set(data.accounts.map((a) => a.profile));
  for (let i = 1; i <= 99; i++) {
    const candidate = `buyer_${String(i).padStart(2, '0')}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `buyer_${Date.now()}`;
}

module.exports = {
  ACCOUNTS_FILE,
  PROFILE_RE,
  DEFAULT_ACCOUNTS,
  loadAccounts,
  saveAccounts,
  listAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  setActiveAccount,
  suggestProfileName,
};
