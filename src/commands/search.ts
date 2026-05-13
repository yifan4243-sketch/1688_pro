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

  // Diagnostic: log every mtop call fired during search. Set BB1688_PROBE=1
  // to see which mtop endpoints 1688's search page actually hits — needed to
  // migrate search from DOM scraping to proper API interception.
  if (process.env.BB1688_PROBE === '1') {
    page.on('response', (resp) => {
      const u = resp.url();
      if (/mtop\.|\.mtop\./.test(u)) {
        try {
          const path = new URL(u).pathname;
          const api = path.split('/').find((s) => s.startsWith('mtop.'));
          info(`[mtop] ${api ?? path}`);
        } catch {
          info(`[mtop] ${u.slice(0, 100)}`);
        }
      }
    });
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

  // waitPastBlocking already confirmed the page loaded (anchor count + body
  // length). No need for a second class-bound waitForSelector — 1688
  // periodically reshuffles card class names and the old `.search-offer-item`
  // gate would hang for 15s (headless) / 180s (headed) on every search.

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
 *
 * Detection strategy — be liberal: 1688 reshuffles result-card class names
 * periodically, so we don't bind to specific selectors. We poll for two
 * resilient signals instead:
 *   (1) the page URL is NOT on a punish / verification host
 *   (2) the page has a lot of anchor tags (>= 30) — punish / slider pages
 *       have a few; loaded result pages have dozens to hundreds.
 *
 * Headless: 8s budget. Headed: 3min so the user has time to solve the slider.
 */
async function waitPastBlocking(
  page: Page,
  headed: boolean,
): Promise<boolean> {
  if (await isBlocked(page, 1)) {
    if (!headed) return false;
    info('Verification page detected — drag the slider in the window.');
  }

  const deadline = Date.now() + (headed ? 180000 : 8000);
  let lastProgressAt = Date.now();
  let lastDebugAt = 0;
  const debug = process.env.BB1688_DEBUG === '1';
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new CliError(130, 'CANCELED', 'Browser closed.');
    }

    const state = await page
      .evaluate(() => ({
        url: location.href,
        title: document.title ?? '',
        anchorCount: document.querySelectorAll('a').length,
        bodyLen: (document.body?.innerText ?? '').length,
      }))
      .catch(() => null);

    if (debug && state && Date.now() - lastDebugAt > 1000) {
      info(
        `[poll] url=${state.url.slice(0, 80)} title="${state.title.slice(0, 40)}" anchors=${state.anchorCount} bodyLen=${state.bodyLen}`,
      );
      lastDebugAt = Date.now();
    }

    if (state) {
      const onPunish = /\/punish|x5secdata=|punish\.1688\.com/.test(state.url);
      // Lowered thresholds — first paint may have fewer anchors/text than
      // the fully-hydrated SPA. 10 anchors + 500 chars beats 1688's loading
      // skeleton (a handful of nav anchors + boilerplate).
      if (
        !onPunish &&
        state.anchorCount >= 15 &&
        state.bodyLen >= 800
      ) {
        return true;
      }
    }

    if (headed && Date.now() - lastProgressAt > 10000) {
      info(
        `Still waiting for results page (${Math.round(
          (deadline - Date.now()) / 1000,
        )}s left)...`,
      );
      lastProgressAt = Date.now();
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
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
    // Selector list for offer-detail anchors. URL patterns are far more
    // stable than DOM class names.
    const ANCHOR_SEL =
      'a[href*="detail.1688.com/offer/"], a[href*="detail.m.1688.com"], a[href*="m.1688.com/offer"]';

    function getOfferId(href: string): string | null {
      const m =
        href.match(/[?&]offerId=(\d+)/) ?? href.match(/\/offer\/(\d+)\.html/);
      return m ? m[1] ?? null : null;
    }

    function findCardForAnchor(a: HTMLAnchorElement): HTMLElement {
      // Walk up until the parent contains MORE THAN ONE distinct offerId —
      // that means we've crossed into the card list container and the
      // current `card` is the correct per-card boundary.
      let card: HTMLElement = a;
      for (let depth = 0; depth < 15; depth++) {
        const parent = card.parentElement;
        if (!parent || parent === document.body) break;
        const otherAnchors = parent.querySelectorAll<HTMLAnchorElement>(
          ANCHOR_SEL,
        );
        const ids = new Set<string>();
        for (const oa of Array.from(otherAnchors)) {
          const id = getOfferId(oa.href);
          if (id) ids.add(id);
        }
        if (ids.size > 1) return card; // over-walking — keep previous card
        card = parent;
      }
      return card;
    }

    function extractTitle(
      card: HTMLElement,
      anchor: HTMLAnchorElement,
    ): string {
      const aTitle = anchor.getAttribute('title');
      if (aTitle && aTitle.length >= 4 && aTitle.length <= 200) {
        return aTitle.trim();
      }
      const imgInA = anchor.querySelector<HTMLImageElement>('img');
      const altA = imgInA?.getAttribute('alt');
      if (altA && altA.length >= 4 && altA.length <= 200) return altA.trim();

      // Look for the most-title-like element inside the card.
      const candidates = card.querySelectorAll<HTMLElement>(
        '[class*="title" i], [class*="Title"], [class*="name" i], h1, h2, h3, h4',
      );
      for (const el of Array.from(candidates)) {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t.length >= 6 && t.length <= 200 && !/^[¥￥\d]/.test(t)) {
          return t;
        }
      }
      // Last resort: any <img> alt anywhere in the card.
      const altAny = card.querySelector('img')?.getAttribute('alt');
      if (altAny && altAny.length >= 4) return altAny.trim().slice(0, 200);
      // Give up: return empty rather than the giant card-text blob.
      return '';
    }

    function extractPrice(card: HTMLElement): {
      text: string;
      min: number | null;
      max: number | null;
    } {
      // Look for leaf elements whose ENTIRE text is a price — avoids the
      // problem of innerText concatenating "¥0.01" with "1000000~4999999 起订量"
      // into a single regex-bait string.
      const leaves = Array.from(card.querySelectorAll<HTMLElement>('*')).filter(
        (el) => el.children.length === 0,
      );
      for (const el of leaves) {
        const raw = (el.textContent ?? '').replace(/\s+/g, '');
        const m = raw.match(/^[¥￥]?([\d.]+)(?:[~\-–]([\d.]+))?$/);
        if (!m) continue;
        const min = parseFloat(m[1]!);
        if (!Number.isFinite(min) || min <= 0 || min > 1e5) continue;
        const max = m[2] ? parseFloat(m[2]) : min;
        if (max !== null && (max > 1e5 || max < min)) continue;
        return {
          text: `¥${m[1]}${m[2] ? `~${m[2]}` : ''}`,
          min,
          max,
        };
      }
      return { text: '', min: null, max: null };
    }

    function extractSupplier(card: HTMLElement): {
      name: string | null;
      shopUrl: string | null;
      years: number | null;
    } {
      // 1688 supplier shops use subdomains like shop4c1183j536987.1688.com,
      // winportXXXX.1688.com, or qm.1688.com/winport/...
      const links = Array.from(
        card.querySelectorAll<HTMLAnchorElement>('a[href*="1688.com"]'),
      ).filter((a) => {
        const h = a.href ?? '';
        if (/detail\.1688\.com|detail\.m\.1688\.com|m\.1688\.com\/offer/.test(h))
          return false;
        return /shop\w*\.1688\.com|winport|1688\.com\/page\/c/.test(h);
      });
      const link = links[0] ?? null;
      const name = link?.textContent?.trim().slice(0, 80) ?? null;
      const shopUrl = link?.href ?? null;
      const text = card.textContent ?? '';
      const ym = text.match(/(\d{1,2})\s*年/);
      const years = ym ? parseInt(ym[1]!, 10) : null;
      return { name, shopUrl, years };
    }

    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(ANCHOR_SEL),
    );
    const seen = new Set<string>();
    const out: Offer[] = [];

    for (const a of anchors) {
      const offerId = getOfferId(a.href ?? '');
      if (!offerId || seen.has(offerId)) continue;
      seen.add(offerId);

      const card = findCardForAnchor(a);
      const title = extractTitle(card, a);
      const price = extractPrice(card);
      const supplier = extractSupplier(card);
      const img =
        a.querySelector<HTMLImageElement>('img') ??
        card.querySelector<HTMLImageElement>('img');
      const image =
        img?.getAttribute('src') ?? img?.getAttribute('data-src') ?? null;

      out.push({
        offerId,
        title,
        price,
        supplier,
        turnover: null,
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
