#!/usr/bin/env node
// Probe the search result page reached via form-fill (production path).
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const KW = process.argv[2] ?? '机械键盘';
const PROFILE = path.join(os.homedir(), '.yibaba/profiles/default');
const OUT = '/tmp/yibaba-probe';
await fs.mkdir(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();

await page.goto('https://www.1688.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
console.log('Home URL:', page.url(), '| Title:', await page.title());

// Wait for search input, then fill + submit
const sel = 'input[name="keywords"], #alisearch-keywords, input[placeholder*="搜"]';
try {
  await page.waitForSelector(sel, { state: 'visible', timeout: 15000 });
  console.log('Input found');
} catch {
  console.log('No input — body[0:300]:', (await page.evaluate(() => document.body?.innerText?.slice(0, 300))) || '');
  await ctx.close();
  process.exit(1);
}
await page.locator(sel).first().fill(KW);
await page.locator(sel).first().press('Enter');
try {
  await page.waitForURL(/offer_search/, { timeout: 20000 });
} catch {}
await new Promise(r => setTimeout(r, 3000));

console.log('\nAfter search:');
console.log('  URL:  ', page.url());
console.log('  Title:', await page.title());

await page.evaluate(() => window.scrollBy(0, 2000));
await new Promise(r => setTimeout(r, 1500));

// Inspect what's actually there
const inspect = await page.evaluate(() => {
  const out = {
    searchOfferItems: document.querySelectorAll('.search-offer-item').length,
    cardCandidates: [],
    detailLinks: {
      'detail.m.1688.com': document.querySelectorAll('a[href*="detail.m.1688.com"]').length,
      'detail.1688.com':   document.querySelectorAll('a[href*="detail.1688.com"]').length,
      'offer.1688.com':    document.querySelectorAll('a[href*="offer.1688.com"]').length,
    },
    linkPatternsTop10: [],
  };
  // Card-like classes
  const cm = new Map();
  document.querySelectorAll('[class]').forEach(el => {
    for (const c of el.classList) {
      if (/offer|card|item|product|sku|search/i.test(c)) cm.set(c, (cm.get(c) ?? 0) + 1);
    }
  });
  out.cardCandidates = Array.from(cm.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // Top link patterns
  const lm = new Map();
  document.querySelectorAll('a[href]').forEach(a => {
    try {
      const u = new URL(a.href);
      const key = u.hostname + u.pathname.replace(/\d+/g, '<n>');
      lm.set(key, (lm.get(key) ?? 0) + 1);
    } catch {}
  });
  out.linkPatternsTop10 = Array.from(lm.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return out;
});

console.log('\n.search-offer-item count:', inspect.searchOfferItems);
console.log('\nDetail-domain link counts:');
for (const [d, n] of Object.entries(inspect.detailLinks)) console.log(`  ${String(n).padStart(4)} × ${d}`);
console.log('\nTop link patterns:');
for (const [p, n] of inspect.linkPatternsTop10) console.log(`  ${String(n).padStart(4)} × ${p}`);
console.log('\nTop card-class candidates:');
for (const [c, n] of inspect.cardCandidates) console.log(`  ${String(n).padStart(4)} × ${c}`);

const html = await page.content();
await fs.writeFile(`${OUT}/results.html`, html);
console.log(`\nSaved ${OUT}/results.html (${(html.length/1024).toFixed(1)} KB)`);

await ctx.close();
