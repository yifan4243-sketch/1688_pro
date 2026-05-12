import { describe, it, expect } from 'vitest';
import type { Cookie } from 'playwright';
import { parseIdentity, decodeTracknick } from '../src/auth/cookies.js';

function c(
  name: string,
  value: string,
  domain = '.1688.com',
): Cookie {
  return {
    name,
    value,
    domain,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  };
}

describe('parseIdentity', () => {
  it('returns null when no cookies', () => {
    expect(parseIdentity([])).toBeNull();
  });

  it('returns null when only tracknick (no unb)', () => {
    expect(parseIdentity([c('tracknick', 'foo')])).toBeNull();
  });

  it('extracts memberId from unb on .1688.com', () => {
    const id = parseIdentity([c('unb', '1234567890')]);
    expect(id).toEqual({ memberId: '1234567890', nick: null });
  });

  it('falls back to unb on .taobao.com when 1688 absent', () => {
    const id = parseIdentity([c('unb', '999', '.taobao.com')]);
    expect(id?.memberId).toBe('999');
  });

  it('prefers .1688.com unb over .taobao.com unb', () => {
    const id = parseIdentity([
      c('unb', 'taobao', '.taobao.com'),
      c('unb', '1688', '.1688.com'),
    ]);
    expect(id?.memberId).toBe('1688');
  });

  it('decodes tracknick when present', () => {
    const id = parseIdentity([
      c('unb', '1'),
      c('tracknick', 'shop_owner_a', '.taobao.com'),
    ]);
    expect(id?.nick).toBe('shop_owner_a');
  });
});

describe('decodeTracknick', () => {
  it('passes ASCII through unchanged', () => {
    expect(decodeTracknick('hello123')).toBe('hello123');
  });

  it('decodes %XX percent encoding (UTF-8)', () => {
    // 张三
    expect(decodeTracknick('%E5%BC%A0%E4%B8%89')).toBe('张三');
  });

  it('decodes literal \\uXXXX escapes', () => {
    expect(decodeTracknick('\\u5f20\\u4e09')).toBe('张三');
  });

  it('tolerates malformed percent encoding', () => {
    expect(decodeTracknick('%E5%BC')).toBe('%E5%BC');
  });

  it('handles mixed escapes (percent first, then unicode)', () => {
    // %5C is backslash → "张" → 张
    expect(decodeTracknick('%5Cu5f20')).toBe('张');
  });
});
