import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutputFlags } from '../src/io/output.js';
import { appendEvent } from '../src/session/events.js';
import { run } from '../src/commands/doctor.js';

let tmpHome: string;
let previousHome: string | undefined;
let stdout = '';
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-doctor-live-'));
  previousHome = process.env.BB1688_HOME;
  process.env.BB1688_HOME = tmpHome;
  stdout = '';
  setOutputFlags({ json: true, pretty: false });
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

describe('doctor --live', () => {
  it('adds read-only live checks to doctor output', async () => {
    await run({ launch: false, live: true });

    const out = JSON.parse(stdout) as { checks: Array<{ name: string; status: string }> };
    const checks = new Map(out.checks.map((check) => [check.name, check]));

    expect(checks.get('live daemon socket')?.status).toBe('warn');
    expect(checks.get('live event log')?.status).toBe('ok');
    expect(checks.get('live artifact write')?.status).toBe('ok');
    expect(checks.get('live recent risk')?.status).toBe('ok');
  });

  it('warns when recent events show risk control', async () => {
    await appendEvent({
      ts: new Date().toISOString(),
      requestId: 'risk-request',
      cmd: 'search',
      phase: 'error',
      status: 'error',
      errorCode: 'RISK_CONTROL',
      verification: { state: 'risk_control' },
    });

    await run({ launch: false, live: true });

    const out = JSON.parse(stdout) as { checks: Array<{ name: string; status: string; message: string }> };
    const risk = out.checks.find((check) => check.name === 'live recent risk');

    expect(risk).toMatchObject({
      status: 'warn',
      message: 'recent risk event in search (risk-request)',
    });
  });
});
