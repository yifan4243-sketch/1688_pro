import net from 'node:net';
import fs from 'node:fs/promises';
import {
  socketPath,
  pidFile,
  ensureRoot,
} from '../session/paths.js';
import {
  getSharedContext,
  releaseSharedContext,
  runOnSharedCtx,
} from '../session/shared.js';
import { loadExecutor } from '../session/dispatch.js';
import { CliError } from '../io/errors.js';
import { throttle } from './throttle.js';
import type { Request, Response } from './protocol.js';

interface ServerOpts {
  idleTimeoutMs?: number;
  prewarm?: boolean;
}

interface ServerStats {
  startedAt: string;
  pid: number;
  commandCount: number;
  lastRequestAt: string | null;
  lastError: string | null;
}

const stats: ServerStats = {
  startedAt: new Date().toISOString(),
  pid: process.pid,
  commandCount: 0,
  lastRequestAt: null,
  lastError: null,
};

let activeClients = 0;
let lastActivityMs = Date.now();
let server: net.Server | null = null;
let shuttingDown = false;

export async function start(opts: ServerOpts = {}): Promise<void> {
  const idleMs = opts.idleTimeoutMs ?? 30 * 60 * 1000;
  await ensureRoot();

  // Clean any stale socket. If pidfile points to a live process, refuse.
  await refuseIfAlive();
  try {
    await fs.unlink(socketPath());
  } catch {
    /* not present, fine */
  }

  await fs.writeFile(pidFile(), String(process.pid));

  log(`pid ${process.pid}, socket ${socketPath()}`);

  if (opts.prewarm) {
    log('prewarming Chromium...');
    await getSharedContext();
    log('Chromium ready');
  }

  server = net.createServer((sock) => handleClient(sock));
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(socketPath(), () => {
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
      void shutdown();
    }
  }, 10_000);
  idleTimer.unref();

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log(`received ${sig}`);
      void shutdown();
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
      return {
        id: req.id,
        ok: true,
        data: {
          ...stats,
          uptimeMs: Date.now() - new Date(stats.startedAt).getTime(),
          activeClients,
        },
      };
    }
    if (req.cmd === 'shutdown') {
      setTimeout(() => void shutdown(), 50);
      return { id: req.id, ok: true, data: { stopping: true } };
    }
    await throttle(req.cmd);
    const fn = await loadExecutor<unknown, unknown>(req.cmd);
    const data = await runOnSharedCtx((ctx) => fn(ctx, req.args));
    return { id: req.id, ok: true, data };
  } catch (e) {
    stats.lastError = (e as Error).message ?? String(e);
    if (e instanceof CliError) {
      return {
        id: req.id,
        ok: false,
        exitCode: e.exitCode,
        code: e.code,
        message: e.message,
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

async function refuseIfAlive(): Promise<void> {
  let pidStr: string;
  try {
    pidStr = await fs.readFile(pidFile(), 'utf8');
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
      `Daemon already running (pid ${pid}). Use \`1688 daemon stop\` first.`,
    );
  } catch (e) {
    if ((e as CliError).code === 'DAEMON_RUNNING') throw e;
    // ESRCH — stale pidfile, ignore.
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down');
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
  }
  await releaseSharedContext();
  try {
    await fs.unlink(socketPath());
  } catch {
    /* ignore */
  }
  try {
    await fs.unlink(pidFile());
  } catch {
    /* ignore */
  }
  log('bye');
  process.exit(0);
}

function log(msg: string): void {
  process.stderr.write(`[daemon ${new Date().toISOString()}] ${msg}\n`);
}
