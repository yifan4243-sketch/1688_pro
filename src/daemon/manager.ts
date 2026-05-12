import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pidFile,
  socketPath,
  daemonLogFile,
  ensureRoot,
} from '../session/paths.js';
import { daemonCall, isDaemonReachable } from './client.js';
import { CliError } from '../io/errors.js';

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  reachable?: boolean;
  stats?: unknown;
}

export async function status(): Promise<DaemonStatus> {
  const pid = await readPid();
  if (pid === null) return { running: false };
  const alive = isProcessAlive(pid);
  if (!alive) return { running: false };
  const reachable = await isDaemonReachable();
  let stats: unknown = undefined;
  if (reachable) {
    try {
      stats = await daemonCall('status', {});
    } catch {
      /* ignore */
    }
  }
  return { running: true, pid, reachable, stats };
}

export async function start(): Promise<{ pid: number }> {
  await ensureRoot();
  const existing = await status();
  if (existing.running) {
    throw new CliError(
      5,
      'DAEMON_RUNNING',
      `Daemon already running (pid ${existing.pid}).`,
    );
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

  // Wait until socket is reachable (max ~15s).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isDaemonReachable()) {
      const pid = (await readPid()) ?? child.pid ?? -1;
      return { pid };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new CliError(
    9,
    'DAEMON_START_TIMEOUT',
    'Daemon did not start within 15s. Check ~/.1688/daemon.log.',
  );
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
  // Wait up to 10s for clean exit.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
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
  for (const p of [socketPath(), pidFile()]) {
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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
