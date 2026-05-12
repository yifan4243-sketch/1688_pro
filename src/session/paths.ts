import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export function root(): string {
  return process.env.BB1688_HOME ?? path.join(os.homedir(), '.1688');
}

export function profilesDir(): string {
  return path.join(root(), 'profiles');
}

export function stateFile(): string {
  return path.join(root(), 'state.json');
}

export function lockFile(): string {
  return path.join(root(), '.lock');
}

export function socketPath(): string {
  return path.join(root(), 'daemon.sock');
}

export function pidFile(): string {
  return path.join(root(), 'daemon.pid');
}

export function daemonLogFile(): string {
  return path.join(root(), 'daemon.log');
}

export function profilePath(name = 'default'): string {
  return path.join(profilesDir(), name);
}

export async function ensureRoot(): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
}
