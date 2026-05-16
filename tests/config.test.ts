import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../src/io/errors.js';
import { configFile } from '../src/session/paths.js';
import { readConfig, validateConfig } from '../src/session/config.js';

let tmpHome: string;
let previousHome: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-config-'));
  previousHome = process.env.BB1688_HOME;
  process.env.BB1688_HOME = tmpHome;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.BB1688_HOME;
  else process.env.BB1688_HOME = previousHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('config loader', () => {
  it('returns empty config when config file is absent', async () => {
    expect(await readConfig()).toEqual({});
  });

  it('reads a valid config file', async () => {
    await fs.writeFile(
      configFile(),
      JSON.stringify({
        defaultProfile: 'work',
        timeouts: { searchMtopMs: 12000 },
        artifacts: { retentionDays: 7 },
        daemon: { headed: false },
        writeActions: { confirmBeforeCheckout: true },
      }),
    );

    expect(await readConfig()).toMatchObject({
      defaultProfile: 'work',
      timeouts: { searchMtopMs: 12000 },
    });
  });

  it('rejects unknown and invalid config keys', () => {
    expect(() => validateConfig({ surprise: true })).toThrow(CliError);
    expect(() => validateConfig({ timeouts: { searchMtopMs: 'fast' } })).toThrow(
      /searchMtopMs must be a non-negative number/,
    );
    expect(() => validateConfig({ daemon: { headed: 'yes' } })).toThrow(
      /daemon.headed must be a boolean/,
    );
  });
});
