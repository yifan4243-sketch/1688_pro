import { describe, expect, it } from 'vitest';
import { buildSearchUrl } from '../src/commands/search.js';

describe('search options', () => {
  it('encodes keywords as GBK and appends remote sort hints', () => {
    const url = buildSearchUrl('雨伞', 'best-selling');

    expect(url).toContain('keywords=%D3%EA%C9%A1');
    expect(url).toContain('sortType=va_rmdarkgmv30');
  });

  it('does not add a sortType for relevance', () => {
    expect(buildSearchUrl('hat', 'relevance')).toBe(
      'https://s.1688.com/selloffer/offer_search.htm?keywords=%68%61%74',
    );
  });
});

