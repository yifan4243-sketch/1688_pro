import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  daemonVersionFile,
  runsDir,
  stateFile,
} from '../src/session/paths.js';
import { readState, writeState, clearState } from '../src/session/state.js';

let tmpHome: string;
let origBb1688Home: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'yibaba-test-'));
  origBb1688Home = process.env.BB1688_HOME;
  process.env.BB1688_HOME = tmpHome;
});

afterEach(async () => {
  if (origBb1688Home === undefined) delete process.env.BB1688_HOME;
  else process.env.BB1688_HOME = origBb1688Home;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('state read/write', () => {
  it('returns empty state when file missing', async () => {
    expect(stateFile()).toBe(path.join(tmpHome, 'state.json'));
    expect(daemonVersionFile()).toBe(path.join(tmpHome, 'daemon.version'));
    expect(runsDir()).toBe(path.join(tmpHome, 'runs'));
    const s = await readState();
    expect(s).toEqual({ version: 1 });
  });

  it('stores non-default profile state separately', async () => {
    await writeState({ version: 1, memberId: 'default' });
    await writeState({ version: 1, memberId: 'work', nick: 'work-nick' }, 'work');

    expect(stateFile('work')).toBe(path.join(tmpHome, 'profiles', 'work', 'state.json'));
    expect((await readState()).memberId).toBe('default');
    expect(await readState('work')).toMatchObject({
      memberId: 'work',
      nick: 'work-nick',
    });
  });

  it('round-trips data', async () => {
    await writeState({
      version: 1,
      memberId: 'abc',
      nick: 'foo',
      loggedInAt: '2026-01-01T00:00:00Z',
    });
    const got = await readState();
    expect(got.memberId).toBe('abc');
    expect(got.nick).toBe('foo');
  });

  it('clearState empties identity', async () => {
    await writeState({ version: 1, memberId: 'abc' });
    await clearState();
    const got = await readState();
    expect(got.memberId).toBeUndefined();
  });
});
