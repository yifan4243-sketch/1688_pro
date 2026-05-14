import net from 'node:net';
import fs from 'node:fs/promises';
import { socketPath } from '../session/paths.js';
import { CliError } from '../io/errors.js';
import { makeRequestId, type Response } from './protocol.js';

const PING_TIMEOUT_MS = 800;
const CALL_TIMEOUT_MS = 5 * 60 * 1000;

export async function isDaemonReachable(): Promise<boolean> {
  // On Unix the socket is a file we can stat; on Windows the named pipe
  // (`\\.\pipe\...`) has no filesystem entry, so skip the existence check
  // and just try to connect.
  if (process.platform !== 'win32') {
    try {
      await fs.access(socketPath());
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath());
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, PING_TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function daemonCall<T>(cmd: string, args: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sock = net.createConnection(socketPath());
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error('daemon call timed out'));
    }, CALL_TIMEOUT_MS);

    function succeed(data: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.end();
      resolve(data);
    }

    function fail(e: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      reject(e);
    }

    sock.on('connect', () => {
      const req = { id: makeRequestId(), cmd, args };
      sock.write(JSON.stringify(req) + '\n');
    });

    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      let resp: Response;
      try {
        resp = JSON.parse(line);
      } catch (e) {
        fail(new Error('daemon: malformed response'));
        return;
      }
      if (resp.ok) {
        succeed(resp.data as T);
      } else {
        fail(new CliError(resp.exitCode, resp.code, resp.message));
      }
    });

    sock.on('error', (e) => {
      fail(e);
    });
  });
}
