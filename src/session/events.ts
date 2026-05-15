import fs from 'node:fs/promises';
import path from 'node:path';
import { eventsFile } from './paths.js';
import type { CliErrorDetails } from '../io/errors.js';

export type CommandEventPhase = 'start' | 'end' | 'error';
export type CommandEventStatus = 'running' | 'ok' | 'error';

export interface CommandEvent {
  ts: string;
  requestId: string;
  cmd: string;
  phase: CommandEventPhase;
  status: CommandEventStatus;
  durationMs?: number;
  profile?: string;
  artifactDir?: string;
  errorCode?: string;
  pageState?: string;
  verification?: { state: string; reason?: string; currentUrl?: string };
  warnings?: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  retryable?: boolean;
}

interface ErrorLike {
  code?: string;
  details?: CliErrorDetails;
}

const SENSITIVE_KEY_RE = /cookie|token|password|passwd|secret|authorization|headers|body|message/i;

export function sanitizeForEvent(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeForEvent);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeForEvent(raw);
    }
  }
  return out;
}

export function eventFromError(input: {
  requestId: string;
  cmd: string;
  startedAt: number;
  error: unknown;
  profile?: string;
}): CommandEvent {
  const err = input.error as ErrorLike;
  const details = err?.details;
  return {
    ts: new Date().toISOString(),
    requestId: input.requestId,
    cmd: input.cmd,
    phase: 'error',
    status: 'error',
    durationMs: Date.now() - input.startedAt,
    profile: input.profile,
    artifactDir: details?.artifactDir,
    errorCode: err?.code,
    pageState: details?.pageState,
    verification: verificationFromDetails(details),
    retryable: details?.retryable,
  };
}

export function startEvent(input: {
  requestId: string;
  cmd: string;
  profile?: string;
}): CommandEvent {
  return {
    ts: new Date().toISOString(),
    requestId: input.requestId,
    cmd: input.cmd,
    phase: 'start',
    status: 'running',
    profile: input.profile,
  };
}

export function endEvent(input: {
  requestId: string;
  cmd: string;
  startedAt: number;
  profile?: string;
}): CommandEvent {
  return {
    ts: new Date().toISOString(),
    requestId: input.requestId,
    cmd: input.cmd,
    phase: 'end',
    status: 'ok',
    durationMs: Date.now() - input.startedAt,
    profile: input.profile,
  };
}

export async function appendEvent(event: CommandEvent): Promise<void> {
  const file = eventsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(sanitizeForEvent(event)) + '\n');
}

export async function appendEventBestEffort(event: CommandEvent): Promise<void> {
  await appendEvent(event).catch(() => {});
}

export async function readRecentEvents(limit = 100): Promise<CommandEvent[]> {
  const file = eventsFile();
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter(Boolean).slice(-Math.max(1, limit));
  const events: CommandEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as CommandEvent);
    } catch {
      /* skip malformed historical line */
    }
  }
  return events;
}

function verificationFromDetails(
  details: CliErrorDetails | undefined,
): CommandEvent['verification'] | undefined {
  if (!details) return undefined;
  if (details.pageState === 'not_logged_in') {
    return {
      state: 'login_required',
      currentUrl: details.currentUrl,
    };
  }
  if (details.category === 'risk_control' || details.pageState === 'rate_limited') {
    return {
      state: 'risk_control',
      reason: details.pageState,
      currentUrl: details.currentUrl,
    };
  }
  if (details.currentUrl || details.pageState) {
    return {
      state: 'unknown',
      reason: details.pageState,
      currentUrl: details.currentUrl,
    };
  }
  return undefined;
}
