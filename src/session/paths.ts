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
  // Windows: Node's net.listen()/createConnection() can't bind a Unix-style
  // filesystem path on win32 (EACCES). Use a named pipe instead.
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\1688-cli-daemon';
  }
  return path.join(root(), 'daemon.sock');
}

export function pidFile(): string {
  return path.join(root(), 'daemon.pid');
}

export function daemonVersionFile(): string {
  return path.join(root(), 'daemon.version');
}

export function daemonLogFile(): string {
  return path.join(root(), 'daemon.log');
}

export function runsDir(): string {
  return path.join(root(), 'runs');
}

export function loginQrFile(): string {
  return path.join(root(), 'login-qr.png');
}

export function profilePath(name = 'default'): string {
  return path.join(profilesDir(), name);
}

export async function ensureRoot(): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
}
