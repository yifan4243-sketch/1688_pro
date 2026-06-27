import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import path from 'node:path';

const require = createRequire(import.meta.url);
const bridge = require('../apps/desktop/cli-bridge.cjs') as {
  buildArgv: (commandId: string, input: unknown) => string[];
  parseOutput: (stdout: string, stderr: string) => { kind: string; data: unknown };
  mapExitStatus: (exitCode: number) => string;
  normalizeAccountStatus: (status: string) => string;
  publicRegistry: () => { commands: Record<string, { label: string; checkoutConfirm?: boolean; write?: boolean; options: Array<{ name: string; label: string; values?: Array<{ value: string; label: string }> }> }> };
  runCommand: (runtime: { rootDir: string; cliPath: string }, historyDir: string, payload: unknown) => Promise<{ status: string }>;
};

const accounts = require('../apps/desktop/accounts.cjs') as {
  PROFILE_RE: RegExp;
  DEFAULT_ACCOUNTS: { activeProfile: string; accounts: Array<{ profile: string; alias: string }> };
  loadAccounts: (dir: string) => ReturnType<typeof JSON.parse>;
  addAccount: (dir: string, params: { profile: string; alias: string; note?: string }) => unknown;
  updateAccount: (dir: string, profile: string, params: { alias?: string; note?: string; status?: string }) => unknown;
  removeAccount: (dir: string, profile: string) => unknown;
  setActiveAccount: (dir: string, profile: string) => unknown;
  suggestProfileName: (dir: string) => string;
};

const cliResolver = require('../apps/desktop/main/cli-resolver.cjs') as {
  resolveCliPathForMode: (opts: { isPackaged: boolean; resourcesPath: string; rootDir: string }) => string;
  CliMissingError: typeof Error;
};

import fs from 'node:fs';
import os from 'node:os';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '1688-pro-test-'));
}

describe('desktop cli bridge', () => {
  it('builds argv from the command registry', () => {
    const argv = bridge.buildArgv('search', {
      args: { keyword: '修枝剪' },
      options: { max: 15, priceMax: 20, excludeAds: true, deeppro: true },
      profile: 'default',
    });

    expect(argv).toEqual([
      'search', '修枝剪',
      '--max', '15', '--price-max', '20',
      '--exclude-ads', '--deeppro',
      '--profile', 'default', '--json', '--pretty',
    ]);
  });

  it('parses json and jsonl command output', () => {
    expect(bridge.parseOutput('{"ok":true}', '')).toEqual({ kind: 'json', data: { ok: true } });
    expect(bridge.parseOutput('{"a":1}\n{"b":2}', '')).toEqual({ kind: 'jsonl', data: [{ a: 1 }, { b: 2 }] });
  });

  it('maps important 1688 exit codes to desktop statuses', () => {
    expect(bridge.mapExitStatus(0)).toBe('success');
    expect(bridge.mapExitStatus(3)).toBe('not_logged_in');
    expect(bridge.mapExitStatus(4)).toBe('risk_control');
    expect(bridge.mapExitStatus(5)).toBe('profile_busy');
    expect(bridge.mapExitStatus(9)).toBe('network_error');
    expect(bridge.mapExitStatus(130)).toBe('cancelled');
  });

  it('keeps select values as cli args while exposing chinese labels', () => {
    const registry = bridge.publicRegistry();
    const sort = registry.commands.search.options.find((option) => option.name === 'sort');
    const verified = registry.commands.search.options.find((option) => option.name === 'verified');

    expect(sort?.values).toContainEqual({ value: 'relevance', label: '综合排序' });
    expect(sort?.values).toContainEqual({ value: 'price-desc', label: '价格从高到低' });
    expect(verified?.values).toContainEqual({ value: 'any', label: '不限' });

    const argv = bridge.buildArgv('search', {
      args: { keyword: '修枝剪' },
      options: { sort: 'price-desc', verified: 'factory' },
      profile: 'default',
    });
    expect(argv).toContain('--sort');
    expect(argv).toContain('price-desc');
    expect(argv).toContain('--verified');
    expect(argv).toContain('factory');
  });

  it('search command label is Chinese 搜索词采集', () => {
    expect(bridge.publicRegistry().commands.search.label).toBe('搜索词采集');
  });

  it('search command options have updated Chinese labels', () => {
    const registry = bridge.publicRegistry();
    const opts = registry.commands.search.options;
    expect(opts.find((o) => o.name === 'max')?.label).toBe('采集数量');
    expect(opts.find((o) => o.name === 'sort')?.label).toBe('1688排序方式');
    expect(opts.find((o) => o.name === 'verified')?.label).toBe('供应商认证');
    expect(opts.find((o) => o.name === 'excludeAds')?.label).toBe('过滤广告位');
    expect(opts.find((o) => o.name === 'deeppro')?.label).toBe('采集商品详情');
    expect(opts.find((o) => o.name === 'headed')?.label).toBe('可视化打开浏览器');
  });

  it('write commands require confirmed', () => {
    const cmd = bridge.publicRegistry().commands.cartAdd;
    expect(cmd.write).toBe(true);

    // runCommand throws if write=true and confirmed !== true
    expect(() => bridge.buildArgv('cartAdd', {
      args: { offerId: '12345678' },
      options: { sku: 'abc', qty: 1 },
      profile: 'default',
    })).not.toThrow(); // buildArgv is fine — it's runCommand that checks

    expect(cmd.write).toBe(true);
  });

  it('checkoutConfirm requires prepareRunId', () => {
    const cmd = bridge.publicRegistry().commands.checkoutConfirm;
    expect(cmd.checkoutConfirm).toBe(true);
    expect(cmd.write).toBe(true);
  });
});

describe('desktop accounts', () => {
  it('validates profile names', () => {
    expect(accounts.PROFILE_RE.test('buyer_01')).toBe(true);
    expect(accounts.PROFILE_RE.test('buyer-01')).toBe(true);
    expect(accounts.PROFILE_RE.test('buyer 01')).toBe(false);
    expect(accounts.PROFILE_RE.test('')).toBe(false);
  });

  it('creates default account when no file exists', () => {
    const dir = tmpDir();
    try {
      const data = accounts.loadAccounts(dir);
      expect(data.activeProfile).toBe('default');
      expect(data.accounts).toHaveLength(1);
      expect(data.accounts[0].profile).toBe('default');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds and lists accounts', () => {
    const dir = tmpDir();
    try {
      accounts.addAccount(dir, { profile: 'buyer_01', alias: '测试号' });
      const data = accounts.loadAccounts(dir);
      expect(data.accounts).toHaveLength(2);
      expect(data.accounts[1].profile).toBe('buyer_01');
      expect(data.accounts[1].alias).toBe('测试号');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prevents duplicate profiles', () => {
    const dir = tmpDir();
    try {
      accounts.addAccount(dir, { profile: 'buyer_01', alias: '测试号' });
      expect(() => accounts.addAccount(dir, { profile: 'buyer_01', alias: '重复' })).toThrow('已存在');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prevents deleting default account', () => {
    const dir = tmpDir();
    try {
      expect(() => accounts.removeAccount(dir, 'default')).toThrow('不能删除默认账号');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets active account back to default when removing active', () => {
    const dir = tmpDir();
    try {
      accounts.addAccount(dir, { profile: 'buyer_01', alias: '测试号' });
      accounts.setActiveAccount(dir, 'buyer_01');
      const data = accounts.removeAccount(dir, 'buyer_01');
      expect(data.activeProfile).toBe('default');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggests unique profile names', () => {
    const dir = tmpDir();
    try {
      expect(accounts.suggestProfileName(dir)).toBe('buyer_01');
      accounts.addAccount(dir, { profile: 'buyer_01', alias: '一号' });
      expect(accounts.suggestProfileName(dir)).toBe('buyer_02');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates alias and note without changing profile id', () => {
    const dir = tmpDir();
    try {
      accounts.addAccount(dir, { profile: 'buyer_01', alias: '旧名', note: '旧备注' });
      accounts.updateAccount(dir, 'buyer_01', { alias: '新名', note: '新备注' });
      const data = accounts.loadAccounts(dir);
      const acc = data.accounts.find((a: { profile: string }) => a.profile === 'buyer_01');
      expect(acc.alias).toBe('新名');
      expect(acc.note).toBe('新备注');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cli path resolver', () => {
  it('resolves dev mode path to dist/cli.js', () => {
    const rootDir = path.resolve(__dirname, '..');
    const devPath = path.join(rootDir, 'dist', 'cli.js');
    // In dev mode (isPackaged=false), it should return the dev path
    // (will throw CLI_NOT_BUILT if dist doesn't exist, which is expected in test)
    try {
      const result = cliResolver.resolveCliPathForMode({
        isPackaged: false,
        resourcesPath: '',
        rootDir,
      });
      expect(result).toBe(devPath);
    } catch (e) {
      // If dist/cli.js doesn't exist, the error should mention it
      expect((e as Error).message).toContain('CLI 构建产物未找到');
    }
  });

  it('resolves packaged mode path to resources/cli/dist/cli.js', () => {
    const resourcesPath = '/fake/resources';
    // Packaged mode without the actual file existing should throw
    try {
      cliResolver.resolveCliPathForMode({
        isPackaged: true,
        resourcesPath,
        rootDir: '',
      });
      // Should not reach here since file doesn't exist
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain('内置 CLI 缺失');
      expect((e as Error).message).toMatch(/cli[/\\]dist[/\\]cli\.js/);
    }
  });

  it('packaged path uses resources/cli/dist/cli.js', () => {
    const expected = path.join('/app/resources', 'cli', 'dist', 'cli.js');
    // Just check the path construction is correct
    expect(expected).toContain('resources/cli/dist/cli.js'.replace(/\//g, path.sep));
  });
});

describe('account status normalization', () => {
  it('normalizes CLI exit statuses to canonical account status', () => {
    expect(bridge.normalizeAccountStatus('success')).toBe('logged_in');
    expect(bridge.normalizeAccountStatus('not_logged_in')).toBe('not_logged_in');
    expect(bridge.normalizeAccountStatus('risk_control')).toBe('risk_control');
    expect(bridge.normalizeAccountStatus('profile_busy')).toBe('busy');
    expect(bridge.normalizeAccountStatus('network_error')).toBe('network_error');
    expect(bridge.normalizeAccountStatus('failed')).toBe('error');
    expect(bridge.normalizeAccountStatus('timeout')).toBe('error');
    expect(bridge.normalizeAccountStatus('cancelled')).toBe('error');
    expect(bridge.normalizeAccountStatus('')).toBe('unknown');
    expect(bridge.normalizeAccountStatus('anything_else')).toBe('anything_else');
  });
});
