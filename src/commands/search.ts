import type { BrowserContext, Page } from 'playwright';
import iconv from 'iconv-lite';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';

export interface SearchOpts {
  max?: string;
  profile?: string;
  headed?: boolean;
}

export interface SearchArgs {
  keyword: string;
  max: number;
  headed?: boolean;
}

export interface SearchResult {
  keyword: string;
  total: number;
  offers: Offer[];
}

export interface Offer {
  offerId: string;
  title: string;
  price: { text: string; min: number | null; max: number | null };
  supplier: {
    name: string | null;
    shopUrl: string | null;
    years: number | null;
  };
  turnover: string | null;
  url: string;
  image: string | null;
}

export async function execute(
  ctx: BrowserContext,
  args: SearchArgs,
): Promise<SearchResult> {
  const offers = await fetchSearch(ctx, args.keyword, args.headed === true);
  const slice = offers.slice(0, args.max);
  return { keyword: args.keyword, total: slice.length, offers: slice };
}

export async function run(keyword: string, opts: SearchOpts): Promise<void> {
  const kw = (keyword ?? '').trim();
  if (!kw) {
    throw new CliError(2, 'BAD_INPUT', 'Search keyword is required.');
  }
  const max = Math.max(1, parseInt(opts.max ?? '20', 10));

  const data = await dispatch<SearchArgs, SearchResult>(
    'search',
    { keyword: kw, max, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );

  emit({
    human: () => printOffers(data.offers, data.keyword),
    data,
  });
}

async function fetchSearch(
  ctx: BrowserContext,
  keyword: string,
  headed: boolean,
): Promise<Offer[]> {
  const page = await ctx.newPage();

  // s.1688.com is GBK-encoded — UTF-8 percent-encoding makes the server
  // search for mojibake. Encode the keyword as GBK bytes first.
  const gbkBytes = iconv.encode(keyword, 'gbk');
  const gbkQs = Array.from(gbkBytes)
    .map((b) => '%' + b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${gbkQs}`;

  async function warmup(delayMs: number): Promise<void> {
    try {
      await page.goto('https://s.1688.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await new Promise((r) => setTimeout(r, delayMs));
    } catch {
      /* best-effort */
    }
  }

  async function navigateSearch(): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      throw new CliError(
        9,
        'NETWORK_ERROR',
        `Failed to load search page: ${(e as Error).message}`,
      );
    }
  }

  // Stable strategy: always warm up before search. Cookie-presence checks
  // can't tell whether the WAF has invalidated the session, so we pay a
  // small constant overhead instead of betting on stale cookies.
  info('Warming up s.1688.com...');
  await warmup(1500);

  info(`Searching 1688 for "${keyword}"...`);
  if (headed) {
    info('A Chrome window has opened — switch focus to it now.');
  }
  await navigateSearch();

  let passed = await waitPastBlocking(page, headed);
  if (!passed && !headed) {
    // Self-heal: warmup may have looked like a bot pattern, or the WAF
    // flagged this fingerprint once. A second warmup with a longer pause +
    // single retry recovers most of these cases without manual intervention.
    info('First attempt blocked. Re-warming and retrying...');
    await warmup(3500);
    await navigateSearch();
    passed = await waitPastBlocking(page, headed);
  }
  if (!passed) {
    throw riskControlError(headed);
  }

  await detectLoginRedirect(page);

  try {
    await page.waitForSelector(
      '.search-offer-item a[href*="detail.m.1688.com"]',
      { timeout: headed ? 180000 : 15000 },
    );
  } catch {
    if (await isBlocked(page)) throw riskControlError(headed);
  }

  // Scroll to trigger lazy-loaded cards.
  await page.evaluate(() => window.scrollBy(0, 2000));
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => window.scrollBy(0, 2000));
  await new Promise((r) => setTimeout(r, 1500));

  const offers = await extractOffers(page);

  if (process.env.BB1688_DEBUG === '1') {
    const stats = await page.evaluate(() => ({
      cards: document.querySelectorAll('.search-offer-item').length,
      linksToDetail: document.querySelectorAll(
        '.search-offer-item a[href*="detail.m.1688.com"]',
      ).length,
      totalDetailLinks: document.querySelectorAll(
        'a[href*="detail.m.1688.com"], a[href*="detail.1688.com"]',
      ).length,
      title: document.title,
      bodyHead: (document.body?.innerText ?? '').slice(0, 120),
    }));
    process.stderr.write(
      `[debug] url=${page.url()}\n` +
        `[debug] title=${stats.title}\n` +
        `[debug] cards=${stats.cards} linksToDetail=${stats.linksToDetail} totalDetailLinks=${stats.totalDetailLinks} extracted=${offers.length}\n` +
        `[debug] body=${stats.bodyHead}\n`,
    );
  }

  return offers;
}

async function isBlocked(page: Page, retries = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      // URL-based detection is reliable. Body-text matching produced false
      // positives on the search results page (product names / footer / ads
      // can contain "滑动" or "验证" substrings).
      if (/\/punish|x5secdata=|punish\.1688\.com/.test(page.url())) {
        return true;
      }
      // Only fall back to title check if URL isn't conclusive. Title is
      // small enough that matching it is safe.
      const title = await page.evaluate(() => document.title ?? '');
      if (/验证码拦截|风险|滑块验证|滑动验证/.test(title)) return true;
    } catch {
      return false;
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/**
 * Returns true once the page is past any risk-control gate.
 * Event-driven via waitForSelector — fires the moment cards render.
 * Headless: short timeout, fail fast. Headed: long timeout, user solves.
 */
async function waitPastBlocking(
  page: Page,
  headed: boolean,
): Promise<boolean> {
  const cardSelector = [
    '.search-offer-item',
    '.offer-list-row-offer',
    '[data-spm*="offer"]',
    'a[href*="detail.1688.com/offer/"]',
    'a[href*="detail.m.1688.com"]',
  ].join(', ');

  // Early WAF check — if we hit the punish page, fail fast (headless) or
  // prompt user (headed) without waiting for the selector timeout.
  if (await isBlocked(page, 1)) {
    if (!headed) return false;
    info('Verification page detected — drag the slider in the window.');
  }

  try {
    await page.waitForSelector(cardSelector, {
      state: 'attached',
      timeout: headed ? 180000 : 8000,
    });
    return true;
  } catch {
    // Selector never appeared. Recheck WAF (slow render or late punish).
    if (!headed && (await isBlocked(page, 1))) return false;
    return false;
  }
}

function riskControlError(triedHeaded: boolean): CliError {
  const msg = triedHeaded
    ? 'Slider verification not solved in time. Try again:\n' +
      '  1688 search "<keyword>" --headed'
    : 'Aliyun risk control triggered (slider verification). ' +
      'Run once with --headed to solve it manually; subsequent headless calls work for hours:\n' +
      '  1688 search "<keyword>" --headed';
  return new CliError(4, 'RISK_CONTROL', msg);
}

async function detectLoginRedirect(page: Page): Promise<void> {
  if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
    throw new CliError(
      3,
      'NOT_LOGGED_IN',
      'Session expired. Run `1688 login`.',
    );
  }
}

export async function extractOffers(page: Page): Promise<Offer[]> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('.search-offer-item');
    const seen = new Set<string>();
    const out: Offer[] = [];

    for (const card of Array.from(cards)) {
      let link =
        (card.closest(
          'a[href*="detail.m.1688.com"]',
        ) as HTMLAnchorElement | null) ??
        (card.querySelector(
          'a[href*="detail.m.1688.com"]',
        ) as HTMLAnchorElement | null);
      if (!link) continue;
      const m = link.href.match(/[?&]offerId=(\d+)/);
      if (!m) continue;
      const offerId = m[1]!;
      if (seen.has(offerId)) continue;
      seen.add(offerId);

      const titleEl =
        card.querySelector('.offer-title-row .title-text') ??
        card.querySelector('.offer-title-row');
      const title = (titleEl?.textContent ?? '').replace(/\s+/g, ' ').trim();

      const priceItem = card.querySelector('.price-item');
      const priceText = priceItem
        ? (priceItem.textContent ?? '').replace(/\s+/g, '')
        : '';
      const pm = priceText.match(
        /([¥￥])?\s*([\d.]+)(?:\s*[~\-–]\s*([\d.]+))?/,
      );
      const priceMin = pm ? parseFloat(pm[2]!) : null;
      const priceMax = pm && pm[3] ? parseFloat(pm[3]) : priceMin;

      const img =
        (card.querySelector('img.main-img') as HTMLImageElement | null) ??
        (card.querySelector('img') as HTMLImageElement | null);
      const image =
        img?.getAttribute('src') ??
        img?.getAttribute('data-src') ??
        null;

      const shopRow = card.querySelector('.offer-shop-row');
      const supplierLink = shopRow?.querySelector(
        'a[href*=".1688.com"]',
      ) as HTMLAnchorElement | null;
      const supplierName =
        shopRow?.querySelector('.desc-text')?.textContent?.trim() ?? null;
      const shopUrl = supplierLink?.href ?? null;

      const cardText = (card.textContent ?? '').replace(/\s+/g, ' ');
      const yearMatch = cardText.match(/(\d{1,2})\s*年/);
      const years = yearMatch ? parseInt(yearMatch[1]!, 10) : null;

      const turnover =
        card.querySelector('.col-desc_after .desc-text')?.textContent?.trim() ??
        null;

      out.push({
        offerId,
        title,
        price: {
          text: priceText.replace(/[¥￥]/g, '¥'),
          min: priceMin,
          max: priceMax,
        },
        supplier: { name: supplierName, shopUrl, years },
        turnover,
        url: `https://detail.m.1688.com/page/index.html?offerId=${offerId}`,
        image,
      });
    }

    return out;
  });
}

function printOffers(offers: Offer[], keyword: string): void {
  if (offers.length === 0) {
    process.stdout.write(`No offers found for "${keyword}".\n`);
    return;
  }
  const w = String(offers.length).length;
  offers.forEach((o, i) => {
    const idx = String(i + 1).padStart(w, ' ');
    const price = o.price.text || '(n/a)';
    process.stdout.write(`${idx}. ${o.title}\n`);
    const pad = ' '.repeat(w + 2);
    process.stdout.write(`${pad}${price}`);
    if (o.turnover) process.stdout.write(`  ·  ${o.turnover}`);
    process.stdout.write('\n');
    const supBits = [
      o.supplier.name,
      o.supplier.years ? `${o.supplier.years}年` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (supBits) process.stdout.write(`${pad}${supBits}\n`);
    process.stdout.write(`${pad}${o.url}\n`);
    if (i < offers.length - 1) process.stdout.write('\n');
  });
}
