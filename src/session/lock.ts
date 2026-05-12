import fs from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { lockFile, ensureRoot } from './paths.js';
import { CliError } from '../io/errors.js';

export async function acquireLock(): Promise<() => Promise<void>> {
  await ensureRoot();
  // proper-lockfile requires the target file to exist
  await fs.writeFile(lockFile(), '', { flag: 'a' });
  try {
    const release = await lockfile.lock(lockFile(), {
      retries: 0,
      stale: 5 * 60 * 1000,
    });
    return release;
  } catch (e) {
    if ((e as { code?: string }).code === 'ELOCKED') {
      throw new CliError(
        5,
        'LOCK_BUSY',
        'Another 1688 command is running. Close it and retry.',
      );
    }
    throw e;
  }
}
