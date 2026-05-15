import { EventEmitter } from 'node:events';
import type { Page, Response as PWResponse } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { startResponseCapture } from '../src/session/response-capture.js';

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

function response(url: string, body = ''): PWResponse {
  return {
    url: () => url,
    text: async () => body,
  } as unknown as PWResponse;
}

describe('startResponseCapture', () => {
  it('returns parsed values from matching responses', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: /api/,
      parse: async (resp) => JSON.parse(await resp.text()) as { ok: boolean },
    });

    const wait = capture.wait();
    mockPage.emitResponse(response('https://example.com/api', '{"ok":true}'));

    expect(await wait).toEqual({ ok: true });
  });

  it('returns null on timeout', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 5,
      matcher: /api/,
      parse: async () => ({ ok: true }),
    });

    expect(await capture.wait()).toBeNull();
  });

  it('ignores non-matching responses', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 5,
      matcher: /api/,
      parse: async () => ({ ok: true }),
    });

    const wait = capture.wait();
    mockPage.emitResponse(response('https://example.com/other'));

    expect(await wait).toBeNull();
  });

  it('ignores null parser results and waits for the next match', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: /api/,
      parse: async (resp) => {
        const text = await resp.text();
        return text === 'ready' ? { ok: true } : null;
      },
    });

    const wait = capture.wait();
    mockPage.emitResponse(response('https://example.com/api', 'not-yet'));
    mockPage.emitResponse(response('https://example.com/api', 'ready'));

    expect(await wait).toEqual({ ok: true });
  });

  it('ignores parser errors and waits for the next match', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: /api/,
      parse: async (resp) => JSON.parse(await resp.text()) as { ok: boolean },
    });

    const wait = capture.wait();
    mockPage.emitResponse(response('https://example.com/api', 'not json'));
    mockPage.emitResponse(response('https://example.com/api', '{"ok":true}'));

    expect(await wait).toEqual({ ok: true });
  });

  it('supports function matchers', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: (resp) => resp.url().includes('/wanted'),
      parse: async () => ({ ok: true }),
    });

    const wait = capture.wait();
    mockPage.emitResponse(response('https://example.com/other'));
    mockPage.emitResponse(response('https://example.com/wanted'));

    expect(await wait).toEqual({ ok: true });
  });

  it('removes the listener after success', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: /api/,
      parse: async () => ({ ok: true }),
    });

    const wait = capture.wait();
    expect(mockPage.listenerCount('response')).toBe(1);
    mockPage.emitResponse(response('https://example.com/api'));
    await wait;

    expect(mockPage.listenerCount('response')).toBe(0);
  });

  it('removes the listener after timeout', async () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 5,
      matcher: /api/,
      parse: async () => ({ ok: true }),
    });

    expect(await capture.wait()).toBeNull();
    expect(mockPage.listenerCount('response')).toBe(0);
  });

  it('allows dispose to be called repeatedly', () => {
    const mockPage = page();
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: /api/,
      parse: async () => ({ ok: true }),
    });

    capture.dispose();
    capture.dispose();

    expect(mockPage.listenerCount('response')).toBe(0);
  });

  it('reuses the same wait promise', async () => {
    const mockPage = page();
    const parse = vi.fn(async () => ({ ok: true }));
    const capture = startResponseCapture({
      page: mockPage,
      timeoutMs: 50,
      matcher: /api/,
      parse,
    });

    const first = capture.wait();
    const second = capture.wait();
    mockPage.emitResponse(response('https://example.com/api'));

    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(mockPage.listenerCount('response')).toBe(0);
  });
});
