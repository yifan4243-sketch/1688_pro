import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emit,
  isJsonV2,
  makeEnvelope,
  setOutputFlags,
} from '../src/io/output.js';

let stdout = '';
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdout = '';
  setOutputFlags({ json: false, jsonV2: false, pretty: false });
  writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    });
});

afterEach(() => {
  writeSpy.mockRestore();
  setOutputFlags({ json: false, jsonV2: false, pretty: false });
});

describe('output envelopes', () => {
  it('keeps existing JSON output unchanged', () => {
    setOutputFlags({ json: true, cmd: 'search' });

    emit({ human: () => {}, data: { offers: [] } });

    expect(JSON.parse(stdout)).toEqual({ offers: [] });
  });

  it('wraps data in an opt-in JSON v2 envelope', () => {
    setOutputFlags({ jsonV2: true, cmd: 'search' });

    emit({ human: () => {}, data: { offers: [] } });

    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      cmd: 'search',
      requestId: null,
      durationMs: null,
      data: { offers: [] },
    });
    expect(isJsonV2()).toBe(true);
  });

  it('builds error envelopes', () => {
    setOutputFlags({ jsonV2: true, cmd: 'cart-list' });

    expect(
      makeEnvelope({
        error: {
          code: 'NO_CART_DATA',
          message: 'missing',
          details: { artifactDir: '/tmp/artifact' },
        },
        artifactDir: '/tmp/artifact',
      }),
    ).toEqual({
      ok: false,
      cmd: 'cart-list',
      requestId: null,
      durationMs: null,
      error: {
        code: 'NO_CART_DATA',
        message: 'missing',
        details: { artifactDir: '/tmp/artifact' },
      },
      artifactDir: '/tmp/artifact',
    });
  });

  it('rejects json-v2 with path shaping', () => {
    setOutputFlags({ jsonV2: true, get: 'offers', cmd: 'search' });

    expect(() => emit({ human: () => {}, data: { offers: [] } })).toThrow(
      '--json-v2 cannot be combined with --get or --pick yet',
    );
  });
});
