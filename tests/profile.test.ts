import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutputFlags } from '../src/io/output.js';
import { appendEvent, endEvent } from '../src/session/events.js';
import { lockFile, profilePath } from '../src/session/paths.js';
import { writeState } from '../src/session/state.js';
import { list, status } from '../src/commands/profile.js';

let tmpHome: string;
let previousHome: string | undefined;
let stdout = '';
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-profile-'));
  previousHome = process.env.BB1688_HOME;
  process.env.BB1688_HOME = tmpHome;
  stdout = '';
  setOutputFlags({ json: true, pretty: false });
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  });
});

afterEach(async () => {
  writeSpy.mockRestore();
  setOutputFlags({ json: false, pretty: false });
  if (previousHome === undefined) delete process.env.BB1688_HOME;
  else process.env.BB1688_HOME = previousHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('profile inventory', () => {
  it('lists default and discovered profiles', async () => {
    await fs.mkdir(profilePath('work'), { recursive: true });
    await appendEvent(endEvent({ requestId: 'req-work', cmd: 'search', profile: 'work', startedAt: Date.now() - 1 }));

    await list();

    const out = JSON.parse(stdout) as { profiles: Array<{ name: string; recentRequestId: string | null }> };
    expect(out.profiles.map((p) => p.name)).toContain('default');
    expect(out.profiles).toContainEqual(expect.objectContaining({ name: 'work', recentRequestId: 'req-work' }));
  });

  it('shows status for default profile even before directory exists', async () => {
    await status('default');

    const out = JSON.parse(stdout) as { profile: { name: string; exists: boolean; daemon: { profile: string; running: boolean } } };
    expect(out.profile).toMatchObject({
      name: 'default',
      exists: false,
      daemon: { profile: 'default', running: false },
    });
  });

  it('reports lock and login state for the selected profile only', async () => {
    await fs.mkdir(profilePath('work'), { recursive: true });
    await fs.writeFile(lockFile('work'), '');
    await fs.mkdir(lockFile('work') + '.lock');
    await writeState({ version: 1, memberId: 'work-id', nick: 'work-nick' }, 'work');

    await status('work');

    const out = JSON.parse(stdout) as {
      profile: {
        name: string;
        locked: boolean;
        loggedIn: boolean;
        daemon: { profile: string; running: boolean };
      };
      state: { memberId?: string };
    };
    expect(out.profile).toMatchObject({
      name: 'work',
      locked: true,
      loggedIn: true,
      daemon: { profile: 'work', running: false },
    });
    expect(out.state.memberId).toBe('work-id');
  });
});
