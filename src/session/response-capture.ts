import type { Page, Response as PWResponse } from 'playwright';
import { withTimeout } from './wait.js';

export type ResponseMatcher = RegExp | ((response: PWResponse) => boolean);
export type ResponseParser<T> = (
  response: PWResponse,
) => Promise<T | null | undefined | false>;

export interface StartResponseCaptureOptions<T> {
  page: Page;
  timeoutMs: number;
  matcher: ResponseMatcher;
  parse: ResponseParser<T>;
}

export interface ResponseCapture<T> {
  wait(): Promise<T | null>;
  dispose(): void;
}

export function startResponseCapture<T>(
  opts: StartResponseCaptureOptions<T>,
): ResponseCapture<T> {
  let disposed = false;
  let settled = false;
  let waitPromise: Promise<T | null> | null = null;
  let resolveCaptured!: (value: T) => void;
  const captured = new Promise<T>((resolve) => {
    resolveCaptured = resolve;
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    opts.page.off('response', onResponse);
  };

  const matches = (response: PWResponse): boolean => {
    if (opts.matcher instanceof RegExp) return opts.matcher.test(response.url());
    return opts.matcher(response);
  };

  const onResponse = async (response: PWResponse) => {
    if (disposed || settled) return;
    try {
      if (!matches(response)) return;
      const value = await opts.parse(response);
      if (!value || settled || disposed) return;
      settled = true;
      resolveCaptured(value);
    } catch {
      /* ignore parse and matcher failures */
    }
  };

  opts.page.on('response', onResponse);

  return {
    wait() {
      waitPromise ??= withTimeout(captured, {
        timeoutMs: opts.timeoutMs,
        fallback: null,
      }).finally(dispose);
      return waitPromise;
    },
    dispose,
  };
}
