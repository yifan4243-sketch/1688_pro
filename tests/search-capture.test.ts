import { EventEmitter } from 'node:events';
import type { Page, Response as PWResponse } from 'playwright';
import { describe, expect, it } from 'vitest';
import { SEARCH_APP_ID, SEARCH_MTOP_API } from '../src/session/search-mtop.js';
import {
  captureSearchOffersForAction,
  startSearchOfferCapture,
} from '../src/session/search-capture.js';

class MockPage extends EventEmitter {
  on(event: 'response', listener: (response: PWResponse) => void): this {
    return super.on(event, listener);
  }

  off(event: 'response', listener: (response: PWResponse) => void): this {
    return super.off(event, listener);
  }

  emitResponse(response: PWResponse): void {
    this.emit('response', response);
  }
}

function page(): Page & MockPage {
  return new MockPage() as Page & MockPage;
}

function response(url: string, body: string): PWResponse {
  return {
    url: () => url,
    text: async () => body,
  } as unknown as PWResponse;
}

function searchUrl(params: { appId?: string; method?: string; beginPage?: number | string }): string {
  return `https://h5api.m.1688.com/h5/${SEARCH_MTOP_API}/1.0/?data=${encodeURIComponent(
    JSON.stringify({
      appId: params.appId ?? SEARCH_APP_ID,
      params: JSON.stringify({ method: params.method, beginPage: params.beginPage }),
    }),
  )}`;
}

function body(...offerIds: string[]): string {
  return `mtopjsonp1(${JSON.stringify({
    data: {
      data: {
        OFFER: {
          items: offerIds.map((offerId) => ({
            data: { offerId, title: `Offer ${offerId}` },
          })),
        },
      },
    },
  })})`;
}

describe('startSearchOfferCapture', () => {
  it('captures offers matching appId, method, and target page', async () => {
    const mockPage = page();
    let targetPage = 2;
    const capture = startSearchOfferCapture({
      page: mockPage,
      requireMethod: 'getOfferList',
      targetPage: () => targetPage,
    });

    const wait = capture.wait({ timeoutMs: 50, intervalMs: 1 });
    mockPage.emitResponse(response(searchUrl({ method: 'other', beginPage: 2 }), body('ignore-method')));
    mockPage.emitResponse(response(searchUrl({ method: 'getOfferList', beginPage: 1 }), body('ignore-page')));
    mockPage.emitResponse(response(searchUrl({ method: 'getOfferList', beginPage: 2 }), body('ok')));

    const result = await wait;
    expect(result.status).toBe('captured');
    expect(result.offers.map((o) => o.offerId)).toEqual(['ok']);
    expect(capture.diagnostics().matchedCount).toBe(1);
    targetPage = 3;
  });

  it('keeps the largest matching response when requested', async () => {
    const mockPage = page();
    const capture = startSearchOfferCapture({
      page: mockPage,
      keep: 'largest',
    });

    const result = await capture.waitForAction(
      async () => {
        mockPage.emitResponse(response(searchUrl({}), body('one')));
        mockPage.emitResponse(response(searchUrl({}), body('one', 'two')));
      },
      { timeoutMs: 5, intervalMs: 1 },
    );

    expect(result.status).toBe('captured');
    expect(result.offers.map((o) => o.offerId)).toEqual(['one', 'two']);
  });

  it('returns timeout when no matching offer response arrives', async () => {
    const capture = startSearchOfferCapture({ page: page() });

    const result = await capture.wait({ timeoutMs: 1, intervalMs: 1 });

    expect(result.status).toBe('timeout');
    expect(result.offers).toEqual([]);
  });

  it('returns blocked when the blocked predicate becomes true', async () => {
    const capture = startSearchOfferCapture({ page: page() });

    const result = await capture.wait({
      timeoutMs: 50,
      intervalMs: 1,
      isBlocked: () => true,
    });

    expect(result.status).toBe('blocked');
    expect(result.offers).toEqual([]);
  });

  it('returns browser_closed when the page is closed', async () => {
    const capture = startSearchOfferCapture({ page: page() });

    const result = await capture.wait({
      timeoutMs: 50,
      intervalMs: 1,
      isClosed: () => true,
    });

    expect(result.status).toBe('browser_closed');
    expect(result.offers).toEqual([]);
  });

  it('returns stream_closed when the capture is disposed before a response arrives', async () => {
    const capture = startSearchOfferCapture({ page: page() });

    capture.dispose();
    const result = await capture.wait({ timeoutMs: 50, intervalMs: 1 });

    expect(result.status).toBe('stream_closed');
    expect(result.offers).toEqual([]);
  });

  it('scopes listener cleanup around an action', async () => {
    const mockPage = page();

    const result = await captureSearchOffersForAction(
      { page: mockPage },
      async () => {
        mockPage.emitResponse(response(searchUrl({}), body('scoped')));
      },
      { timeoutMs: 50, intervalMs: 1 },
    );

    expect(result.status).toBe('captured');
    expect(result.offers.map((o) => o.offerId)).toEqual(['scoped']);
    expect(mockPage.listenerCount('response')).toBe(0);
  });

  it('cleans up scoped listeners when the action fails', async () => {
    const mockPage = page();

    await expect(
      captureSearchOffersForAction(
        { page: mockPage },
        async () => {
          throw new Error('navigation failed');
        },
        { timeoutMs: 50, intervalMs: 1 },
      ),
    ).rejects.toThrow('navigation failed');

    expect(mockPage.listenerCount('response')).toBe(0);
  });
});
