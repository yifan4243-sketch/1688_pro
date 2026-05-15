import { describe, expect, it } from 'vitest';
import { parseMtopJsonp } from '../src/session/mtop.js';

describe('parseMtopJsonp', () => {
  it('parses plain JSON', () => {
    expect(parseMtopJsonp('{"ok":true}')).toEqual({ ok: true });
  });

  it('parses numeric JSONP callbacks', () => {
    expect(parseMtopJsonp('mtopjsonp1({"ok":true})')).toEqual({ ok: true });
  });

  it('parses word JSONP callbacks', () => {
    expect(parseMtopJsonp('mtopjsonpABC_123({"ok":true})')).toEqual({ ok: true });
  });

  it('trims surrounding whitespace', () => {
    expect(parseMtopJsonp('  mtopjsonp1({"ok":true})  ')).toEqual({ ok: true });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseMtopJsonp('not json')).toThrow();
  });

  it('throws on invalid JSONP payloads', () => {
    expect(() => parseMtopJsonp('mtopjsonp1(not json)')).toThrow();
  });
});
