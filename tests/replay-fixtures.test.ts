import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMtopJsonp } from '../src/session/mtop.js';
import { parseOfferItemsFromMtopText } from '../src/session/search-mtop.js';
import { classifyNavigation } from '../src/session/navigation-guard.js';

const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');

async function fixture(...parts: string[]): Promise<string> {
  return fs.readFile(path.join(fixturesDir, ...parts), 'utf8');
}

describe('replay fixtures', () => {
  it('parses search offer mtop fixtures', async () => {
    const offers = parseOfferItemsFromMtopText(await fixture('search', 'mtop-offers.jsonp'));

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      offerId: '1001',
      title: 'Sample Hat',
      price: { text: '¥3.50', min: 3.5, max: 3.5 },
      supplier: { name: '测试工厂', shopUrl: 'https://shop.example/current', years: 5 },
      verified: { factory: true, business: false, superFactory: true },
      tags: ['退货包运费'],
    });
  });

  it('parses cart addCargo success and failure fixtures', async () => {
    const success = parseMtopJsonp<{ ret?: string[] }>(
      await fixture('cart', 'addcargo-success.jsonp'),
    );
    const failed = parseMtopJsonp<{ ret?: string[] }>(
      await fixture('cart', 'addcargo-failed.jsonp'),
    );

    expect(success.ret?.[0]).toMatch(/SUCCESS/);
    expect(failed.ret?.[0]).toMatch(/FAIL/);
  });

  it('keeps risk-control navigation classification stable', () => {
    expect(classifyNavigation('https://punish.1688.com/?x5secdata=fixture')).toMatchObject({
      kind: 'risk_control',
      host: 'punish.1688.com',
    });
  });

  it('contains sanitized risk-control HTML fixture', async () => {
    const html = await fixture('page-state', 'risk-control.html');

    expect(html).toContain('验证码拦截');
    expect(html).not.toMatch(/cookie|token|password/i);
  });
});
