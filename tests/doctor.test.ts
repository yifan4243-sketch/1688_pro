import { describe, expect, it } from 'vitest';
import {
  removePathFix,
  writePermissionFix,
} from '../src/commands/doctor.js';

describe('doctor platform hints', () => {
  it('prints Unix permission and removal fixes', () => {
    expect(writePermissionFix('/home/me/.1688', 'linux')).toBe(
      'chmod u+w "/home/me/.1688"',
    );
    expect(removePathFix('/home/me/.1688/.lock.lock', 'linux', { recursive: true })).toBe(
      'rm -rf "/home/me/.1688/.lock.lock"',
    );
    expect(removePathFix('/home/me/.1688/state.json', 'linux')).toBe(
      'rm "/home/me/.1688/state.json"',
    );
  });

  it('prints Windows PowerShell-compatible fixes', () => {
    expect(writePermissionFix('C:\\Users\\me\\.1688', 'win32')).toBe(
      'Grant write permission to "C:\\Users\\me\\.1688" or set BB1688_HOME to a writable directory.',
    );
    expect(removePathFix('C:\\Users\\me\\.1688\\.lock.lock', 'win32', { recursive: true })).toBe(
      'PowerShell: Remove-Item -Recurse -Force "C:\\Users\\me\\.1688\\.lock.lock"',
    );
    expect(removePathFix('C:\\Users\\me\\.1688\\state.json', 'win32')).toBe(
      'PowerShell: Remove-Item -Force "C:\\Users\\me\\.1688\\state.json"',
    );
  });
});
