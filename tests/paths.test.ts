import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  rootHash,
  socketPathForPlatform,
} from '../src/session/paths.js';

describe('platform paths', () => {
  it('uses Unix socket files outside Windows', () => {
    expect(socketPathForPlatform('darwin', '/Users/me/.1688')).toBe(
      path.join('/Users/me/.1688', 'daemon.sock'),
    );
    expect(socketPathForPlatform('linux', '/home/me/.1688')).toBe(
      path.join('/home/me/.1688', 'daemon.sock'),
    );
  });

  it('uses root-scoped named pipes on Windows', () => {
    const first = socketPathForPlatform('win32', 'C:\\Users\\alice\\.1688');
    const second = socketPathForPlatform('win32', 'C:\\Users\\bob\\.1688');

    expect(first).toMatch(/^\\\\\.\\pipe\\1688-cli-daemon-[a-f0-9]{12}$/);
    expect(second).toMatch(/^\\\\\.\\pipe\\1688-cli-daemon-[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it('normalizes root hash casing', () => {
    expect(rootHash('C:\\Users\\Alice\\.1688')).toBe(
      rootHash('c:\\users\\alice\\.1688'),
    );
  });
});
