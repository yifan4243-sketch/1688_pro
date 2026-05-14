export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitUntilOptions {
  timeoutMs: number;
  intervalMs?: number;
}

export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  opts: WaitUntilOptions,
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  const intervalMs = opts.intervalMs ?? 250;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

export async function waitForTruthy<T>(
  probe: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  opts: WaitUntilOptions,
): Promise<T | null> {
  const deadline = Date.now() + opts.timeoutMs;
  const intervalMs = opts.intervalMs ?? 250;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}
