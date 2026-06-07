#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

export async function fixBinMode({
  platform = process.platform,
  target = path.join('dist', 'cli.js'),
} = {}) {
  if (platform === 'win32') {
    return { changed: false, reason: 'windows-noop', target };
  }
  await fs.chmod(target, 0o755);
  return { changed: true, reason: 'chmod-755', target };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fixBinMode();
}
