import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const bridge = require('../apps/desktop/cli-bridge.cjs') as {
  buildArgv: (commandId: string, input: unknown) => string[];
  parseOutput: (stdout: string, stderr: string) => { kind: string; data: unknown };
  mapExitStatus: (exitCode: number) => string;
  publicRegistry: () => { commands: Record<string, { options: Array<{ name: string; values?: Array<{ value: string; label: string }> }> }> };
};

describe('desktop cli bridge', () => {
  it('builds argv from the command registry without accepting raw shell strings', () => {
    const argv = bridge.buildArgv('search', {
      args: { keyword: '修枝剪' },
      options: { max: 15, priceMax: 20, excludeAds: true, deeppro: true },
      profile: 'default',
    });

    expect(argv).toEqual([
      'search',
      '修枝剪',
      '--max',
      '15',
      '--price-max',
      '20',
      '--exclude-ads',
      '--deeppro',
      '--profile',
      'default',
      '--json',
      '--pretty',
    ]);
  });

  it('parses json and jsonl command output', () => {
    expect(bridge.parseOutput('{"ok":true}', '')).toEqual({
      kind: 'json',
      data: { ok: true },
    });
    expect(bridge.parseOutput('{"a":1}\n{"b":2}', '')).toEqual({
      kind: 'jsonl',
      data: [{ a: 1 }, { b: 2 }],
    });
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
});
