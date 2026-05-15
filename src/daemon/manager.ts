import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pidFile,
  socketPath,
  daemonLogFile,
  daemonVersionFile,
  ensureRoot,
} from '../session/paths.js';
import { daemonCall, isDaemonReachable } from './client.js';
import { CliError } from '../io/errors.js';
import { waitUntil } from '../session/wait.js';
import pkg from '../../package.json' with { type: 'json' };

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  reachable?: boolean;
  version?: string | null;
  expectedVersion?: string;
  versionMatches?: boolean;
  stats?: unknown;
}

export async function status(): Promise<DaemonStatus> {
  const pid = await readPid();
  const version = await readDaemonVersion();
  const expectedVersion = pkg.version;
  if (pid === null) {
    return {
      running: false,
      version,
      expectedVersion,
      versionMatches: version === expectedVersion,
    };
  }
  const alive = isProcessAlive(pid);
  if (!alive) {
    return {
      running: false,
      version,
      expectedVersion,
      versionMatches: version === expectedVersion,
    };
  }
  const reachable = await isDaemonReachable();
  let stats: unknown = undefined;
  if (reachable) {
    try {
      stats = await daemonCall('status', {});
    } catch {
      /* ignore */
    }
  }
  const statsVersion =
    stats && typeof stats === 'object'
      ? (stats as { version?: unknown }).version
      : undefined;
  const resolvedVersion =
    typeof statsVersion === 'string' ? statsVersion : version;
  return {
    running: true,
    pid,
    reachable,
    version: resolvedVersion,
    expectedVersion,
    versionMatches: resolvedVersion === expectedVersion,
    stats,
  };
}

export async function start(): Promise<{ pid: number }> {
  await ensureRoot();
  const existing = await status();
  if (existing.running) {
    if (existing.versionMatches === false) {
      await stop();
    } else {
      throw new CliError(
        5,
        'DAEMON_RUNNING',
        `Daemon already running (pid ${existing.pid}).`,
      );
    }
  }

  // Locate the CLI entrypoint to re-exec as "1688 serve".
  // When installed via npm link, this module sits at dist/daemon/manager.js,
  // and the CLI is at dist/cli.js.
  const here = fileURLToPath(import.meta.url);
  const cliPath = path.join(path.dirname(here), '..', 'cli.js');

  // Detach from the parent; redirect output to a log file.
  const logFd = await fs.open(daemonLogFile(), 'a');
  const child = spawn(process.execPath, [cliPath, 'serve'], {
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    env: { ...process.env, BB1688_DAEMON_BG: '1' },
  });
  child.unref();
  await logFd.close();

  const reachable = await waitUntil(isDaemonReachable, {
    timeoutMs: 15000,
    intervalMs: 250,
  });
  if (reachable) {
    const pid = (await readPid()) ?? child.pid ?? -1;
    return { pid };
  }
  throw new CliError(
    9,
    'DAEMON_START_TIMEOUT',
    'Daemon did not start within 15s. Check ~/.1688/daemon.log.',
  );
}

export async function ensureFreshDaemon(): Promise<{
  pid: number;
  restarted: boolean;
}> {
  const existing = await status();
  if (!existing.running) {
    const started = await start();
    return { ...started, restarted: false };
  }

  if (existing.versionMatches === false) {
    await stop();
    const started = await start();
    return { ...started, restarted: true };
  }

  return { pid: existing.pid ?? -1, restarted: false };
}

export async function stop(): Promise<{ stopped: boolean }> {
  const pid = await readPid();
  if (pid === null || !isProcessAlive(pid)) {
    await cleanupArtifacts();
    return { stopped: false };
  }
  // Prefer asking via socket; fall back to SIGTERM.
  if (await isDaemonReachable()) {
    try {
      await daemonCall('shutdown', {});
    } catch {
      /* will fall through to SIGTERM */
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already dead */
    }
  }
  await waitUntil(() => !isProcessAlive(pid), {
    timeoutMs: 10000,
    intervalMs: 200,
  });
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  await cleanupArtifacts();
  return { stopped: true };
}

async function cleanupArtifacts(): Promise<void> {
  // Windows named pipes have no filesystem entry — skip the socket path.
  const targets =
    process.platform === 'win32'
      ? [pidFile(), daemonVersionFile()]
      : [socketPath(), pidFile(), daemonVersionFile()];
  for (const p of targets) {
    try {
      await fs.unlink(p);
    } catch {
      /* ignore */
    }
  }
}

async function readPid(): Promise<number | null> {
  try {
    const s = await fs.readFile(pidFile(), 'utf8');
    const n = parseInt(s.trim(), 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

async function readDaemonVersion(): Promise<string | null> {
  try {
    const s = await fs.readFile(daemonVersionFile(), 'utf8');
    return s.trim() || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
