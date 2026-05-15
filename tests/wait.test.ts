import { describe, expect, it } from 'vitest';
import {
  sleep,
  waitForTruthy,
  waitUntil,
  waitWithDeadline,
  withTimeout,
} from '../src/session/wait.js';

describe('sleep', () => {
  it('returns immediately for non-positive delays', async () => {
    const start = Date.now();
    await sleep(0);
    await sleep(-10);
    expect(Date.now() - start).toBeLessThan(30);
  });
});

describe('withTimeout', () => {
  it('returns the promise value before timeout', async () => {
    const value = await withTimeout(Promise.resolve('ok'), {
      timeoutMs: 50,
      fallback: 'timeout',
    });

    expect(value).toBe('ok');
  });

  it('returns the fallback on timeout', async () => {
    const value = await withTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve('late'), 50)),
      { timeoutMs: 5, fallback: 'timeout' },
    );

    expect(value).toBe('timeout');
  });

  it('passes through promise rejections before timeout', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), {
        timeoutMs: 50,
        fallback: new Error('timeout'),
      }),
    ).rejects.toThrow('boom');
  });
});

describe('waitWithDeadline', () => {
  it('returns a poll result before timeout', async () => {
    const value = await waitWithDeadline(
      ({ attempt }) => (attempt === 2 ? 'ready' : null),
      { timeoutMs: 200, intervalMs: 1, onTimeout: () => 'timeout' },
    );

    expect(value).toBe('ready');
  });

  it('passes remaining time to each poll', async () => {
    const remaining: number[] = [];

    await waitWithDeadline(
      ({ remainingMs, attempt }) => {
        remaining.push(remainingMs);
        return attempt === 1 ? 'ready' : null;
      },
      { timeoutMs: 200, intervalMs: 1, onTimeout: () => 'timeout' },
    );

    expect(remaining[0]).toBeGreaterThan(0);
    expect(remaining[1]).toBeGreaterThan(0);
  });

  it('returns the timeout value when polling never succeeds', async () => {
    const value = await waitWithDeadline(() => null, {
      timeoutMs: 5,
      intervalMs: 1,
      onTimeout: () => 'timeout',
    });

    expect(value).toBe('timeout');
  });
});

describe('waitUntil', () => {
  it('returns true once the predicate passes', async () => {
    let attempts = 0;
    const ok = await waitUntil(
      () => {
        attempts++;
        return attempts >= 3;
      },
      { timeoutMs: 200, intervalMs: 1 },
    );

    expect(ok).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  it('supports async predicates', async () => {
    let attempts = 0;
    const ok = await waitUntil(
      async () => {
        attempts++;
        return attempts >= 2;
      },
      { timeoutMs: 200, intervalMs: 1 },
    );

    expect(ok).toBe(true);
  });

  it('returns false on timeout', async () => {
    const ok = await waitUntil(() => false, { timeoutMs: 5, intervalMs: 1 });
    expect(ok).toBe(false);
  });
});

describe('waitForTruthy', () => {
  it('returns the first truthy value', async () => {
    let attempts = 0;
    const value = await waitForTruthy(
      () => {
        attempts++;
        return attempts === 2 ? 'ready' : null;
      },
      { timeoutMs: 200, intervalMs: 1 },
    );

    expect(value).toBe('ready');
  });

  it('supports async probes', async () => {
    let attempts = 0;
    const value = await waitForTruthy(
      async () => {
        attempts++;
        return attempts === 2 ? 'ready' : null;
      },
      { timeoutMs: 200, intervalMs: 1 },
    );

    expect(value).toBe('ready');
  });

  it('returns null on timeout', async () => {
    const value = await waitForTruthy(() => null, {
      timeoutMs: 5,
      intervalMs: 1,
    });
    expect(value).toBeNull();
  });
});
