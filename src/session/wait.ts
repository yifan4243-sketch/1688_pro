export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitUntilOptions {
  timeoutMs: number;
  intervalMs?: number;
}

export interface WithTimeoutOptions<TFallback> {
  timeoutMs: number;
  fallback: TFallback;
}

export async function withTimeout<T, TFallback = T>(
  promise: Promise<T>,
  opts: WithTimeoutOptions<TFallback>,
): Promise<T | TFallback> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T | TFallback>([
      promise,
      new Promise<TFallback>((resolve) => {
        timer = setTimeout(() => resolve(opts.fallback), opts.timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
