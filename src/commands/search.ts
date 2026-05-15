import type { BrowserContext, Page } from 'playwright';
import iconv from 'iconv-lite';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import { clickSearchNextPage } from '../session/search-locators.js';
import { startSearchOfferCapture } from '../session/search-capture.js';
import {
  SEARCH_APP_ID,
  SEARCH_MTOP_API,
  mapOffer,
  parseOfferItemsFromMtopText,
  readSearchMtopRequestMeta,
  type Offer,
  type RawOfferItem,
} from '../session/search-mtop.js';
import { parseMtopJsonp } from '../session/mtop.js';
import { sleep, waitWithDeadline } from '../session/wait.js';

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

export type { Offer };

export async function execute(
  ctx: BrowserContext,
  args: SearchArgs,
): Promise<SearchResult> {
  return withRecovery(
    ctx,
    { cmd: 'search', args },
    async () => {
      const offers = await fetchSearch(
        ctx,
        args.keyword,
        args.headed === true,
        args.max,
      );
      const slice = offers.slice(0, args.max);
      return { keyword: args.keyword, total: slice.length, offers: slice };
    },
    { headed: args.headed === true, maxRetries: 1 },
  );
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

let HTML_SEQ = 0;
let MTOP_SEQ = 0;

export { SEARCH_APP_ID, SEARCH_MTOP_API, mapOffer };
// 1688 search returns 60 offers per page. `--max` auto-paginates by
// clicking the in-page "next" arrow (which keeps the search-context
// `pageId` stable — see fetchSearch for why that matters). MAX_PAGES caps
// it: each extra page is another click + mtop round-trip (~3-5s) and a bit
// more WAF exposure, so we stop at 10 pages (600 results) even if --max
// asks for more.
const PAGE_SIZE = 60;
const MAX_PAGES = 10;

export { parseMtopJsonp };

export type { RawOfferItem };

async function fetchSearch(
  ctx: BrowserContext,
  keyword: string,
  headed: boolean,
  maxResults: number,
): Promise<Offer[]> {
  const page = await ctx.newPage();

  // s.1688.com is GBK-encoded — UTF-8 percent-encoding makes the server
  // search for mojibake. Encode the keyword as GBK bytes first.
  const gbkBytes = iconv.encode(keyword, 'gbk');
  const gbkQs = Array.from(gbkBytes)
    .map((b) => '%' + b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  const baseUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${gbkQs}`;
  const pagesWanted = Math.min(
    Math.max(1, Math.ceil(maxResults / PAGE_SIZE)),
    MAX_PAGES,
  );

  // The search capture must only attach AFTER warmup: the warmup homepage fires
  // the same WirelessRecommend endpoint/appId for recommendations. The capture
  // also checks beginPage so stale page-1 responses cannot poison later pages.
  let currentTargetPage = 1;

  async function warmup(delayMs: number): Promise<void> {
    try {
      await page.goto('https://s.1688.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await sleep(delayMs);
    } catch {
      /* best-effort */
    }
  }

  async function navigateTo(targetUrl: string): Promise<void> {
    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (e) {
      throw new CliError(
        9,
        'NETWORK_ERROR',
        `Failed to load search page: ${(e as Error).message}`,
      );
    }
  }

  // Diagnostic: log every plausible data-bearing call fired during search,
  // plus inline-JSON markers in the HTML response. Set BB1688_PROBE=1.
  // Writes directly to stderr — `info()` is silenced in piped/JSON mode.
  if (process.env.BB1688_PROBE === '1') {
    const log = (line: string) => process.stderr.write(line + '\n');
    log('[probe] active');
    HTML_SEQ = 0;
    MTOP_SEQ = 0;
    page.on('response', async (resp) => {
      const u = resp.url();
      const ct = resp.headers()['content-type'] ?? '';
      if (
        /\.(png|jpg|jpeg|gif|webp|css|woff2?|svg|ico|mp4|ttf|otf|js|map)(\?|$)/i.test(
          u,
        )
      )
        return;
      // Skip well-known analytics noise.
      if (/google-analytics|baidu\.com\/hm\.js|alicdn\.com\/sufei/i.test(u))
        return;
      try {
        const path = new URL(u).pathname;
        const m = path.match(/mtop[.\/][^/?&]+/);
        if (m) {
          // For each mtop call, also extract appId (URL param) + response size.
          // Different appIds in WirelessRecommend.recommend separate
          // main-search vs related-products vs banner content.
          const qs = new URL(u).search;
          const dataParam =
            new URLSearchParams(qs).get('data') ?? '';
          let appId = '';
          try {
            const dataObj = JSON.parse(dataParam);
            appId = String(dataObj.appId ?? '');
          } catch {
            /* ignore */
          }
          let body = '';
          try {
            body = await resp.text();
          } catch {
            /* ignore */
          }
          const offerHitCount = (body.match(/"offerId/g) ?? []).length;
          log(
            `[mtop] ${m[0]} appId=${appId} bodyLen=${body.length} offerId×${offerHitCount}`,
          );
          if (offerHitCount > 5) {
            try {
              const fs = await import('node:fs/promises');
              const seq = (++MTOP_SEQ).toString().padStart(2, '0');
              const file = `/tmp/1688-mtop-${seq}-${appId || 'unknown'}.json`;
              await fs.writeFile(file, body);
              log(`[mtop] saved → ${file}`);
            } catch {
              /* ignore */
            }
          }
          return;
        }
        // Broaden: ANY response after this point gets logged as [other].
        // 1688 may put search results in a non-mtop endpoint.
        const len = resp.headers()['content-length'] ?? '?';
        log(
          `[other] ${new URL(u).host}${path.slice(0, 60)} ct=${ct.slice(0, 30)} len=${len}`,
        );
        if (/json/i.test(ct) || /h5api|api\.|\.json|\/api\//i.test(path)) {
          // Already logged as [other]; skip the [xhr] line.
          return;
        }
        if (
          /offer_search\.htm|sou\/index\.htm/i.test(u) &&
          /text\/html/i.test(ct)
        ) {
          const body = await resp.text();
          // Save each response to a separate file so we don't overwrite
          // earlier ones (the actual results page may be one of several).
          try {
            const fs = await import('node:fs/promises');
            const seq = (++HTML_SEQ).toString().padStart(2, '0');
            const tag = /punish/.test(u)
              ? 'punish'
              : /\.html\b/.test(u)
              ? 'html'
              : 'htm';
            const tmpPath = `/tmp/1688-search-page-${seq}-${tag}.html`;
            await fs.writeFile(tmpPath, body);
            const offerHrefCount = (
              body.match(/detail\.[m.]*1688\.com\/offer\//g) ?? []
            ).length;
            log(
              `[html] saved → ${tmpPath} (${body.length} bytes, offerHref×${offerHrefCount})`,
            );
          } catch {
            /* ignore */
          }
          // Probe key patterns and print context where they appear.
          const probes = [
            'offerId":',
            '"offerId"',
            'data-offer-id',
            'data-offerid',
            '__INITIAL_STATE__',
            '__SSR_DATA__',
            'window.runParams',
            'window.cuPgcCache',
            'window.pageData',
            'window.context',
            'aliPangu',
            'i18nMtopApi',
            '"title":"',
            '"price":',
            'fullPathPrice',
            'priceRange',
          ];
          for (const p of probes) {
            const idx = body.indexOf(p);
            if (idx >= 0) {
              const ctx = body.slice(Math.max(0, idx - 20), idx + 80);
              log(
                `[hit ] "${p}" @${idx}  ...${ctx.replace(/\s+/g, ' ')}...`,
              );
            }
          }
          // Count interesting things.
          const offerIdCount = (body.match(/offerId/g) ?? []).length;
          const scriptCount = (body.match(/<script/g) ?? []).length;
          const dataIdCount = (body.match(/data-offer/gi) ?? []).length;
          log(
            `[stat] offerId×${offerIdCount} script×${scriptCount} data-offer×${dataIdCount}`,
          );
        }
      } catch {
        /* swallow */
      }
    });
  }

  const isSearchBlocked = () => !headed && /\/punish|x5secdata=/.test(page.url());

  // Stable strategy: always warm up before search. Cookie-presence checks
  // can't tell whether the WAF has invalidated the session, so we pay a
  // small constant overhead instead of betting on stale cookies.
  info('Warming up s.1688.com...');
  await warmup(1500);

  const allOffers: Offer[] = [];
  const seenIds = new Set<string>();

  class PageAdvanceStopped extends Error {}

  const capturePageAction = async (
    action: () => Promise<void>,
    timeoutMs: number,
  ) => {
    const capture = startSearchOfferCapture({
      page,
      requireMethod: 'getOfferList',
      targetPage: () => currentTargetPage,
    });
    try {
      await action();
      return await capture.wait({
        timeoutMs,
        isClosed: () => page.isClosed(),
        isBlocked: isSearchBlocked,
      });
    } finally {
      capture.dispose();
    }
  };

  for (let pageNum = 1; pageNum <= pagesWanted; pageNum++) {
    currentTargetPage = pageNum;

    let captureResult;
    if (pageNum === 1) {
      captureResult = await capturePageAction(async () => {
        info(`Searching 1688 for "${keyword}"...`);
        if (headed) {
          info('A Chrome window has opened — switch focus to it now.');
        }
        await navigateTo(baseUrl);
      }, headed ? 180000 : 12000);
    } else {
      try {
        captureResult = await capturePageAction(async () => {
          // Pages 2+ MUST stay in the same page session. Every fresh navigation
          // mints a new search-context `pageId`, and `beginPage=N` against a
          // fresh pageId returns near-duplicate top results (~75% overlap).
          // Clicking the in-page "next" arrow advances `beginPage` within the
          // SAME pageId, which is the only way to get a clean next 60.
          info(`Fetching page ${pageNum}/${pagesWanted}...`);
          const advanced = await clickSearchNextPage(page).catch(() => false);
          if (!advanced) {
            info(`Could not advance to page ${pageNum} — stopping at ${allOffers.length} results.`);
            throw new PageAdvanceStopped();
          }
        }, headed ? 180000 : 12000);
      } catch (e) {
        if (e instanceof PageAdvanceStopped) break;
        throw e;
      }
    }

    let capturedOffers = captureResult.offers;
    let got = captureResult.status === 'captured';
    if (captureResult.status === 'browser_closed') {
      throw new CliError(130, 'CANCELED', 'Browser closed.');
    }
    // Retry only on page 1 — first-contact WAF warmup. A page-2+ failure
    // just stops the loop with whatever has been collected so far.
    if (!got && !headed && pageNum === 1) {
      info('First attempt blocked or empty. Re-warming and retrying...');
      await warmup(3500);
      captureResult = await capturePageAction(
        async () => {
          await navigateTo(baseUrl);
        },
        15000,
      );
      capturedOffers = captureResult.offers;
      got = captureResult.status === 'captured';
      if (captureResult.status === 'browser_closed') {
        throw new CliError(130, 'CANCELED', 'Browser closed.');
      }
    }
    if (!got) {
      if (pageNum === 1) {
        throw riskControlError(headed);
      }
      info(
        `Page ${pageNum} blocked or empty — returning ${allOffers.length} ` +
          `results from ${pageNum - 1} page(s).`,
      );
      break;
    }
    if (pageNum === 1) await detectLoginRedirect(page);

    // Accumulate with cross-page dedup. 1688 occasionally repeats P4P ad
    // slots across pages; dedup keeps the result set clean.
    let added = 0;
    for (const o of capturedOffers) {
      if (seenIds.has(o.offerId)) continue;
      seenIds.add(o.offerId);
      allOffers.push(o);
      added++;
    }

    // Stop conditions:
    //  - collected enough for the caller's --max
    //  - short page (< 60) means we hit the last page of results
    //  - zero new items means pagination isn't advancing (bail rather than
    //    spin through identical pages)
    if (allOffers.length >= maxResults) break;
    if (capturedOffers.length < PAGE_SIZE) break;
    if (added === 0) break;

    // Human-like jitter between page clicks to keep the WAF score low.
    if (pageNum < pagesWanted) {
      await sleep(1500 + Math.random() * 2000);
    }
  }

  return allOffers;
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
    if (i < retries - 1) await sleep(800);
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

  let lastProgressAt = Date.now();
  let lastDebugAt = 0;
  const debug = process.env.BB1688_DEBUG === '1';
  return waitWithDeadline<boolean>(async ({ now, remainingMs }) => {
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

    if (debug && state && now - lastDebugAt > 1000) {
      info(
        `[poll] url=${state.url.slice(0, 80)} title="${state.title.slice(0, 40)}" anchors=${state.anchorCount} bodyLen=${state.bodyLen}`,
      );
      lastDebugAt = now;
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

    if (headed && now - lastProgressAt > 10000) {
      info(
        `Still waiting for results page (${Math.round(remainingMs / 1000)}s left)...`,
      );
      lastProgressAt = now;
    }

    return null;
  }, {
    timeoutMs: headed ? 180000 : 8000,
    intervalMs: 500,
    onTimeout: () => false,
  });
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
        location: { province: null, city: null },
        bizType: null,
        verified: { factory: false, business: false, superFactory: false },
        tags: [],
        isP4P: false,
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
