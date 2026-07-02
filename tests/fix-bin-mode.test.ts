import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
const execFileAsync = promisify(execFile);

async function runFixBinMode(platform: string, target: string): Promise<{ changed: boolean; reason: string; target: string }> {
  const scriptUrl = pathToFileURL(path.resolve('scripts/fix_bin_mode.mjs')).href;
  const runner = path.join(tmpDir, 'fix-bin-mode-runner.mjs');
  await fs.writeFile(runner, [
    `import { fixBinMode } from ${JSON.stringify(scriptUrl)};`,
    'const result = await fixBinMode({ platform: process.argv[2], target: process.argv[3] });',
    'console.log(JSON.stringify(result));',
  ].join('\n'));
  const { stdout } = await execFileAsync(process.execPath, [runner, platform, target], {
    cwd: path.resolve('.'),
  });
  return JSON.parse(stdout);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-bin-mode-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('fix_bin_mode', () => {
  it('is a no-op on Windows', async () => {
    const target = path.join(tmpDir, 'cli.js');
    const result = await runFixBinMode('win32', target);

    expect(result).toEqual({
      changed: false,
      reason: 'windows-noop',
      target,
    });
  });

  it('chmods the bin file on Unix-like platforms', async () => {
    const target = path.join(tmpDir, 'cli.js');
    await fs.writeFile(target, '#!/usr/bin/env node\n');

    const result = await runFixBinMode('linux', target);
    const mode = (await fs.stat(target)).mode & 0o777;

    expect(result).toEqual({
      changed: true,
      reason: 'chmod-755',
      target,
    });
    if (process.platform !== 'win32') {
      expect(mode).toBe(0o755);
    }
  });
});
