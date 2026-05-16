import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../src/io/errors.js';
import { setOutputFlags } from '../src/io/output.js';
import { appendEvent, endEvent, startEvent } from '../src/session/events.js';
import { list, last, parseLimit, show } from '../src/commands/debug.js';

let tmpHome: string;
let previousHome: string | undefined;
let stdout = '';
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-debug-'));
  previousHome = process.env.BB1688_HOME;
  process.env.BB1688_HOME = tmpHome;
  stdout = '';
  setOutputFlags({ json: false, pretty: false });
  writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
});

afterEach(async () => {
  writeSpy.mockRestore();
  setOutputFlags({ json: false, pretty: false });
  if (previousHome === undefined) delete process.env.BB1688_HOME;
  else process.env.BB1688_HOME = previousHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('debug command helpers', () => {
  it('parses limits defensively', () => {
    expect(parseLimit('3')).toBe(3);
    expect(parseLimit('0')).toBe(20);
    expect(parseLimit('999')).toBe(200);
    expect(parseLimit('nope')).toBe(20);
  });

  it('lists recent request summaries', async () => {
    await appendEvent(startEvent({ requestId: 'req-1', cmd: 'search' }));
    await appendEvent(endEvent({ requestId: 'req-1', cmd: 'search', startedAt: Date.now() - 1 }));
    await appendEvent(startEvent({ requestId: 'req-2', cmd: 'cart-list' }));

    await list({ limit: '2' });

    const out = JSON.parse(stdout) as { requests: Array<{ requestId: string; cmd: string; status: string }> };
    expect(out.requests).toMatchObject([
      { requestId: 'req-1', cmd: 'search', status: 'ok' },
      { requestId: 'req-2', cmd: 'cart-list', status: 'running' },
    ]);
  });

  it('filters failed requests', async () => {
    await appendEvent(startEvent({ requestId: 'req-ok', cmd: 'search' }));
    await appendEvent(endEvent({ requestId: 'req-ok', cmd: 'search', startedAt: Date.now() - 1 }));
    await appendEvent({
      ts: new Date().toISOString(),
      requestId: 'req-fail',
      cmd: 'search',
      phase: 'error',
      status: 'error',
      errorCode: 'RISK_CONTROL',
    });

    await list({ failed: true });

    const out = JSON.parse(stdout) as { requests: Array<{ requestId: string; errorCode?: string }> };
    expect(out.requests).toMatchObject([
      { requestId: 'req-fail', errorCode: 'RISK_CONTROL' },
    ]);
    expect(JSON.stringify(out)).not.toContain('req-ok');
  });

  it('shows the last failed request', async () => {
    await appendEvent(endEvent({ requestId: 'req-ok', cmd: 'search', startedAt: Date.now() - 1 }));
    await appendEvent({
      ts: new Date().toISOString(),
      requestId: 'req-fail',
      cmd: 'offer',
      phase: 'error',
      status: 'error',
      errorCode: 'NO_OFFER_DATA',
      durationMs: 12,
    });

    await last({ failed: true });

    const out = JSON.parse(stdout) as { request: { requestId: string; cmd: string; errorCode?: string } };
    expect(out.request).toMatchObject({
      requestId: 'req-fail',
      cmd: 'offer',
      errorCode: 'NO_OFFER_DATA',
    });
  });

  it('shows a request artifact location when present', async () => {
    await appendEvent({
      ts: new Date().toISOString(),
      requestId: 'req-artifact',
      cmd: 'cart-list',
      phase: 'error',
      status: 'error',
      artifactDir: path.join(tmpHome, 'runs', 'req-artifact'),
    });
    await fs.mkdir(path.join(tmpHome, 'runs', 'req-artifact'), { recursive: true });

    await show({ requestId: 'req-artifact' });

    const out = JSON.parse(stdout) as {
      request: { requestId: string; events: unknown[] };
      artifactDir: string | null;
      artifactExists: boolean;
    };
    expect(out.request.requestId).toBe('req-artifact');
    expect(out.artifactDir).toContain('req-artifact');
    expect(out.artifactExists).toBe(true);
    expect(out.request.events).toHaveLength(1);
  });

  it('throws when showing an unknown request', async () => {
    await expect(show({ requestId: 'missing' })).rejects.toMatchObject(
      new CliError(2, 'NOT_FOUND', 'No debug events found for missing.'),
    );
  });
});
