import type { Page, Response as PWResponse } from 'playwright';
import { sleep } from './wait.js';
import {
  SEARCH_APP_ID,
  parseOfferItemsFromMtopText,
  readSearchMtopRequestMeta,
  type Offer,
} from './search-mtop.js';

export interface SearchOfferCaptureOptions {
  page: Page;
  requireMethod?: string;
  targetPage?: () => number;
  keep?: 'first' | 'largest';
}

export interface SearchOfferCaptureDiagnostics {
  seenCount: number;
  matchedCount: number;
  parsedCount: number;
  failureCount: number;
  lastSeenUrl?: string;
  lastMatchedUrl?: string;
  lastParsedUrl?: string;
}

export interface SearchOfferCaptureResult<TResult> {
  actionResult: TResult;
  offers: Offer[];
  diagnostics: SearchOfferCaptureDiagnostics;
}

export function startSearchOfferCapture(opts: SearchOfferCaptureOptions) {
  let disposed = false;
  let offers: Offer[] = [];
  let seenCount = 0;
  let matchedCount = 0;
  let parsedCount = 0;
  let failureCount = 0;
  let lastSeenUrl: string | undefined;
  let lastMatchedUrl: string | undefined;
  let lastParsedUrl: string | undefined;

  const diagnostics = (): SearchOfferCaptureDiagnostics => ({
    seenCount,
    matchedCount,
    parsedCount,
    failureCount,
    lastSeenUrl,
    lastMatchedUrl,
    lastParsedUrl,
  });

  const reset = () => {
    offers = [];
    seenCount = 0;
    matchedCount = 0;
    parsedCount = 0;
    failureCount = 0;
    lastSeenUrl = undefined;
    lastMatchedUrl = undefined;
    lastParsedUrl = undefined;
  };

  const onResponse = async (resp: PWResponse) => {
    if (disposed) return;
    const url = resp.url();
    seenCount++;
    lastSeenUrl = url;
    try {
      const meta = readSearchMtopRequestMeta(url);
      if (!meta || meta.appId !== SEARCH_APP_ID) return;
      if (opts.requireMethod && meta.method !== opts.requireMethod) return;
      const targetPage = opts.targetPage?.();
      if (targetPage !== undefined && (meta.beginPage ?? 1) !== targetPage) return;
      matchedCount++;
      lastMatchedUrl = url;
      const parsed = parseOfferItemsFromMtopText(await resp.text());
      if (parsed.length === 0) return;
      if (opts.keep === 'largest') {
        if (parsed.length > offers.length) offers = parsed;
      } else {
        offers = parsed;
      }
      parsedCount++;
      lastParsedUrl = url;
    } catch {
      failureCount++;
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    opts.page.off('response', onResponse);
  };

  const wait = async (optsWait: {
    timeoutMs: number;
    intervalMs?: number;
    isBlocked?: () => boolean | Promise<boolean>;
    isClosed?: () => boolean;
  }): Promise<Offer[]> => {
    const deadline = Date.now() + optsWait.timeoutMs;
    const intervalMs = optsWait.intervalMs ?? 300;
    while (Date.now() < deadline) {
      if (optsWait.isClosed?.()) break;
      if (offers.length > 0) break;
      if (await optsWait.isBlocked?.()) break;
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
    return offers;
  };

  const waitForAction = async <TResult>(
    action: () => Promise<TResult>,
    optsWait: {
      timeoutMs: number;
      intervalMs?: number;
      isBlocked?: () => boolean | Promise<boolean>;
      isClosed?: () => boolean;
    },
  ): Promise<SearchOfferCaptureResult<TResult>> => {
    try {
      const actionResult = await action();
      const responseOffers = await wait(optsWait);
      return {
        actionResult,
        offers: responseOffers,
        diagnostics: diagnostics(),
      };
    } finally {
      dispose();
    }
  };

  opts.page.on('response', onResponse);

  return {
    reset,
    wait,
    waitForAction,
    dispose,
    diagnostics,
    offers: () => offers,
  };
}
