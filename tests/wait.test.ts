import { describe, expect, it } from 'vitest';
import { sleep, waitForTruthy, waitUntil } from '../src/session/wait.js';

describe('sleep', () => {
  it('returns immediately for non-positive delays', async () => {
    const start = Date.now();
    await sleep(0);
    await sleep(-10);
    expect(Date.now() - start).toBeLessThan(30);
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

  it('returns null on timeout', async () => {
    const value = await waitForTruthy(() => null, {
      timeoutMs: 5,
      intervalMs: 1,
    });
    expect(value).toBeNull();
  });
});
