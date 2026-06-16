import net from 'node:net';
import fs from 'node:fs/promises';
import {
  defaultProfileName,
  socketPath,
  pidFile,
  daemonVersionFile,
  ensureRoot,
  ensureProfileRuntimeDir,
} from '../session/paths.js';
import {
  getSharedContext,
  getSharedContextStatus,
  releaseSharedContext,
  runOnSharedCtx,
} from '../session/shared.js';
import { loadExecutor } from '../session/dispatch.js';
import { CliError } from '../io/errors.js';
import { throttle } from './throttle.js';
import type { Request, Response } from './protocol.js';
import pkg from '../../package.json' with { type: 'json' };

interface ServerOpts {
  profile?: string;
  idleTimeoutMs?: number;
  prewarm?: boolean;
}

interface DaemonHealth {
  lastPageState: string | null;
  lastFailureKind: string | null;
  lastRecoveryAction: string | null;
  consecutiveFailures: number;
  consecutiveRateLimits: number;
  lastSuccessfulActionAt: string | null;
  contextRecreatedAt: string | null;
  pausedUntil: string | null;
}

interface ServerStats {
  profile: string;
  version: string;
  startedAt: string;
  pid: number;
  commandCount: number;
  lastRequestAt: string | null;
  lastError: string | null;
  health: DaemonHealth;
}

const stats: ServerStats = {
  profile: 'default',
  version: pkg.version,
  startedAt: new Date().toISOString(),
  pid: process.pid,
  commandCount: 0,
  lastRequestAt: null,
  lastError: null,
  health: {
    lastPageState: null,
    lastFailureKind: null,
    lastRecoveryAction: null,
    consecutiveFailures: 0,
    consecutiveRateLimits: 0,
    lastSuccessfulActionAt: null,
    contextRecreatedAt: null,
    pausedUntil: null,
  },
};

const DAEMON_BLOCKED_COMMANDS = new Set(['checkout-confirm']);

let activeClients = 0;
let lastActivityMs = Date.now();
let server: net.Server | null = null;
let shuttingDown = false;

export async function start(opts: ServerOpts = {}): Promise<void> {
  const profile = defaultProfileName(opts.profile);
  const idleMs = opts.idleTimeoutMs ?? 30 * 60 * 1000;
  await ensureRoot();
  await ensureProfileRuntimeDir(profile);
  stats.profile = profile;

  // Clean any stale socket. If pidfile points to a live process, refuse.
  await refuseIfAlive(profile);
  // Windows named pipes have no filesystem entry — skip the unlink.
  if (process.platform !== 'win32') {
    try {
      await fs.unlink(socketPath(profile));
    } catch {
      /* not present, fine */
    }
  }

  await fs.writeFile(pidFile(profile), String(process.pid));
  await fs.writeFile(daemonVersionFile(profile), pkg.version);

  log(`profile ${profile}, pid ${process.pid}, socket ${socketPath(profile)}`);

  if (opts.prewarm) {
    log('prewarming Chromium...');
    await getSharedContext(profile);
    log('Chromium ready');
  }

  server = net.createServer((sock) => handleClient(sock));
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(socketPath(profile), () => {
      server!.off('error', reject);
      resolve();
    });
  });
  log('listening');

  const idleTimer = setInterval(() => {
    if (
      !shuttingDown &&
      activeClients === 0 &&
      Date.now() - lastActivityMs > idleMs
    ) {
      log(`idle for ${Math.round(idleMs / 60000)}min — shutting down`);
      void shutdown(profile);
    }
  }, 10_000);
  idleTimer.unref();

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log(`received ${sig}`);
      void shutdown(profile);
    });
  }
}

function handleClient(sock: net.Socket): void {
  activeClients++;
  lastActivityMs = Date.now();
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req: Request;
      try {
        req = JSON.parse(line) as Request;
      } catch {
        sock.write(
          JSON.stringify({
            id: '?',
            ok: false,
            exitCode: 1,
            code: 'BAD_REQUEST',
            message: 'invalid JSON',
          }) + '\n',
        );
        continue;
      }
      void handleRequest(req).then((resp) => {
        if (!sock.writable) return;
        sock.write(JSON.stringify(resp) + '\n');
      });
    }
  });
  sock.on('error', () => {
    /* swallow client errors */
  });
  sock.on('close', () => {
    activeClients--;
    lastActivityMs = Date.now();
  });
}

async function handleRequest(req: Request): Promise<Response> {
  lastActivityMs = Date.now();
  stats.lastRequestAt = new Date().toISOString();
  stats.commandCount++;
  try {
    if (req.cmd === 'status') {
      const browser = await getSharedContextStatus();
      return {
        id: req.id,
        ok: true,
        data: {
          ...stats,
          uptimeMs: Date.now() - new Date(stats.startedAt).getTime(),
          activeClients,
          browser,
        },
      };
    }
    if (req.cmd === 'shutdown') {
      setTimeout(() => void shutdown(stats.profile), 50);
      return { id: req.id, ok: true, data: { stopping: true } };
    }
    if (DAEMON_BLOCKED_COMMANDS.has(req.cmd)) {
      throw new CliError(
        20,
        'DAEMON_COMMAND_DISABLED',
        `${req.cmd} must run through the CLI confirmation path, not the daemon socket.`,
      );
    }
    await enforceHealthPause();
    await throttle(req.cmd);
    const fn = await loadExecutor<unknown, unknown>(req.cmd);
    const data = await runOnSharedCtx((ctx) => fn(ctx, req.args), {
      requestId: req.id,
      cmd: req.cmd,
      args: req.args,
    }, stats.profile);
    recordSuccess();
    return { id: req.id, ok: true, data };
  } catch (e) {
    stats.lastError = (e as Error).message ?? String(e);
    recordFailure(e);
    if (e instanceof CliError) {
      return {
        id: req.id,
        ok: false,
        exitCode: e.exitCode,
        code: e.code,
        message: e.message,
        details: e.details,
      };
    }
    return {
      id: req.id,
      ok: false,
      exitCode: 1,
      code: 'INTERNAL',
      message: (e as Error).message ?? String(e),
    };
  }
}

async function enforceHealthPause(): Promise<void> {
  const pausedUntil = stats.health.pausedUntil;
  if (!pausedUntil) return;
  const until = new Date(pausedUntil).getTime();
  if (!Number.isFinite(until) || Date.now() >= until) {
    stats.health.pausedUntil = null;
    return;
  }
  throw new CliError(
    9,
    'DAEMON_PAUSED',
    `Daemon for profile "${stats.profile}" is paused until ${pausedUntil} after repeated 1688 failures.`,
    {
      category: 'daemon_health',
      recoverHint: `Wait for the pause to expire, or run \`1688 daemon reload --profile ${stats.profile}\` after manually resolving login/risk-control issues.`,
      retryable: true,
      pausedUntil,
      failureKind: stats.health.lastFailureKind,
      recoveryAction: stats.health.lastRecoveryAction,
    },
  );
}

function recordSuccess(): void {
  stats.health.consecutiveFailures = 0;
  stats.health.consecutiveRateLimits = 0;
  stats.health.lastSuccessfulActionAt = new Date().toISOString();
  stats.health.pausedUntil = null;
}

function detailString(e: unknown, key: string): string | null {
  if (!(e instanceof CliError)) return null;
  const v = e.details[key];
  return typeof v === 'string' ? v : null;
}

function recordFailure(e: unknown): void {
  if (e instanceof CliError && e.code === 'DAEMON_PAUSED') return;

  stats.health.consecutiveFailures++;
  const pageState = detailString(e, 'pageState');
  const failureKind = detailString(e, 'failureKind');
  const recoveryAction = detailString(e, 'recoveryAction');
  if (pageState) stats.health.lastPageState = pageState;
  if (failureKind) stats.health.lastFailureKind = failureKind;
  if (recoveryAction) stats.health.lastRecoveryAction = recoveryAction;

  if (failureKind === 'rate_limited' || (e instanceof CliError && e.code === 'RATE_LIMITED')) {
    stats.health.consecutiveRateLimits++;
  } else if (failureKind && failureKind !== 'rate_limited') {
    stats.health.consecutiveRateLimits = 0;
  }

  const now = Date.now();
  if (failureKind === 'rate_limited' && stats.health.consecutiveRateLimits >= 2) {
    stats.health.pausedUntil = new Date(now + 5 * 60_000).toISOString();
  } else if (failureKind === 'risk_challenge' || failureKind === 'not_logged_in') {
    stats.health.pausedUntil = new Date(now + 10 * 60_000).toISOString();
  } else if (stats.health.consecutiveFailures >= 5) {
    stats.health.pausedUntil = new Date(now + 2 * 60_000).toISOString();
  }
}

async function refuseIfAlive(profile: string): Promise<void> {
  let pidStr: string;
  try {
    pidStr = await fs.readFile(pidFile(profile), 'utf8');
  } catch {
    return;
  }
  const pid = parseInt(pidStr.trim(), 10);
  if (!Number.isInteger(pid)) return;
  try {
    process.kill(pid, 0); // probe — throws if not alive
    throw new CliError(
      5,
      'DAEMON_RUNNING',
      `Daemon already running for profile "${profile}" (pid ${pid}). Use \`1688 daemon stop --profile ${profile}\` first.`,
    );
  } catch (e) {
    if ((e as CliError).code === 'DAEMON_RUNNING') throw e;
    // ESRCH — stale pidfile, ignore.
  }
}

async function shutdown(profile = stats.profile): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down profile ${profile}`);
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
  }
  await releaseSharedContext();
  if (process.platform !== 'win32') {
    try {
      await fs.unlink(socketPath(profile));
    } catch {
      /* ignore */
    }
  }
  try {
    await fs.unlink(pidFile(profile));
  } catch {
    /* ignore */
  }
  try {
    await fs.unlink(daemonVersionFile(profile));
  } catch {
    /* ignore */
  }
  log('bye');
  process.exit(0);
}

function log(msg: string): void {
  process.stderr.write(`[daemon ${new Date().toISOString()}] ${msg}\n`);
}
