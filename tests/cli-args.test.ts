import { describe, expect, it } from 'vitest';
import { sanitiseCliArgs } from '../src/util/cli-args.js';

describe('sanitiseCliArgs', () => {
  it('strips node.exe and dist/cli.js for normal invocation', () => {
    expect(sanitiseCliArgs(['node.exe', 'dist/cli.js', 'doctor', '--json']))
      .toEqual(['doctor', '--json']);
  });

  it('strips electron exe and resources/cli/dist/cli.js', () => {
    expect(sanitiseCliArgs([
      '1688 to Ozon Studio.exe',
      'resources/cli/dist/cli.js',
      'doctor',
      '--json',
    ])).toEqual(['doctor', '--json']);
  });

  it('handles standard bin invocation (1688 doctor --json)', () => {
    expect(sanitiseCliArgs(['node.exe', '1688', 'doctor', '--json']))
      .toEqual(['doctor', '--json']);
  });

  it('handles search with multiple args', () => {
    expect(sanitiseCliArgs([
      'node.exe',
      'dist/cli.js',
      'search',
      '修枝剪',
      '--max',
      '10',
      '--deeppro',
      '--json',
      '--pretty',
    ])).toEqual(['search', '修枝剪', '--max', '10', '--deeppro', '--json', '--pretty']);
  });

  it('handles Windows backslash path separators', () => {
    expect(sanitiseCliArgs([
      'node.exe',
      'release\\win-unpacked\\resources\\cli\\dist\\cli.js',
      'offer',
      '12345678',
      '--pro',
    ])).toEqual(['offer', '12345678', '--pro']);
  });

  it('returns empty if no args after cli.js', () => {
    expect(sanitiseCliArgs(['node.exe', 'dist/cli.js'])).toEqual([]);
  });

  it('handles empty input', () => {
    expect(sanitiseCliArgs([])).toEqual([]);
  });
});
