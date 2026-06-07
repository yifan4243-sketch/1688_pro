import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

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
  return socketPathForPlatform(process.platform, root());
}

export function socketPathForPlatform(platform: NodeJS.Platform, rootPath: string): string {
  // Windows: Node's net.listen()/createConnection() can't bind a Unix-style
  // filesystem path on win32 (EACCES). Use a named pipe instead. Include a
  // stable root hash so different users, BB1688_HOME values, and tests do not
  // collide on one global pipe name.
  if (platform === 'win32') {
    return `\\\\.\\pipe\\1688-cli-daemon-${rootHash(rootPath)}`;
  }
  return path.join(rootPath, 'daemon.sock');
}

export function rootHash(rootPath: string): string {
  return crypto
    .createHash('sha1')
    .update(path.resolve(rootPath).toLowerCase())
    .digest('hex')
    .slice(0, 12);
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

export function eventsFile(): string {
  return path.join(root(), 'events.jsonl');
}

export function configFile(): string {
  return path.join(root(), 'config.json');
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
