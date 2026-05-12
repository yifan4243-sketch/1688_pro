#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const KW = process.argv[2] ?? '机械键盘';
const PROFILE = path.join(os.homedir(), '.yibaba/profiles/default');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();
const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(KW)}`;
console.log('Goto:', url);

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('After goto: url=', page.url(), 'title=', await page.title());

try {
  await page.waitForSelector('.search-offer-item a[href*="detail.m.1688.com"]', { timeout: 15000 });
  console.log('Selector hit');
} catch {
  console.log('Selector NOT hit within 15s');
}

await page.evaluate(() => window.scrollBy(0, 2000));
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(() => window.scrollBy(0, 2000));
await new Promise(r => setTimeout(r, 1500));

const stats = await page.evaluate(() => ({
  cards: document.querySelectorAll('.search-offer-item').length,
  links: document.querySelectorAll('a[href]').length,
  detailLinks: document.querySelectorAll('a[href*="detail.m.1688.com"]').length,
  bodyLen: document.body?.innerText?.length ?? 0,
  bodyHead: (document.body?.innerText ?? '').slice(0, 300),
}));
console.log('Stats:', stats);

await fs.writeFile('/tmp/yibaba-probe/search2.html', await page.content());
console.log('Saved /tmp/yibaba-probe/search2.html');

await ctx.close();
