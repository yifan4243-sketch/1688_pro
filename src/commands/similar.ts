// Find similar offers — uses 1688's "找同款 / 找相似" page which renders
// results from the same WirelessRecommend.recommend mtop API (appId=32517)
// that search uses, just seeded by an offerId instead of a keyword.
import type { BrowserContext, Response as PWResponse } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import {
  type Offer,
  type RawOfferItem,
  SEARCH_MTOP_API,
  SEARCH_APP_ID,
  parseMtopJsonp,
  mapOffer,
} from './search.js';

export interface SimilarOpts {
  offerId: string;
  max?: string;
  profile?: string;
  headed?: boolean;
}

export interface SimilarArgs {
  offerId: string;
  max: number;
  headed?: boolean;
}

export interface SimilarResult {
  offerId: string;
  total: number;
  offers: Offer[];
}

const SIMILAR_URL = (offerId: string) =>
  `https://s.1688.com/selloffer/similar_search.html?offerIds=${encodeURIComponent(
    offerId,
  )}&scene=similar_search`;

export async function execute(
  ctx: BrowserContext,
  args: SimilarArgs,
): Promise<SimilarResult> {
  if (!/^\d+$/.test(args.offerId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid offerId: ${args.offerId}`);
  }
  return withRecovery(
    ctx,
    { cmd: 'similar', args },
    () => executeSimilar(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

async function executeSimilar(
  ctx: BrowserContext,
  args: SimilarArgs,
): Promise<SimilarResult> {
  const headed = args.headed === true;
  const page = await ctx.newPage();

  let captured: Offer[] = [];
  const onResp = async (resp: PWResponse) => {
    const u = resp.url();
    if (!u.includes(SEARCH_MTOP_API)) return;
    try {
      const dataParam =
        new URLSearchParams(new URL(u).search).get('data') ?? '';
      const dataObj = JSON.parse(dataParam);
      if (String(dataObj.appId) !== SEARCH_APP_ID) return;
    } catch {
      return;
    }
    try {
      const body = await resp.text();
      const json = parseMtopJsonp(body) as {
        data?: { data?: { OFFER?: { items?: RawOfferItem[] } } };
      };
      const items = json?.data?.data?.OFFER?.items ?? [];
      const offers = items
        .map(mapOffer)
        .filter((o): o is Offer => o !== null);
      if (offers.length > captured.length) captured = offers;
    } catch {
      /* malformed — skip */
    }
  };
  page.on('response', onResp);

  try {
    info('Warming up s.1688.com...');
    await page.goto('https://s.1688.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await new Promise((r) => setTimeout(r, 1500));

    info(`Finding similar offers for ${args.offerId}...`);
    if (headed) info('A Chrome window has opened — switch focus to it now.');
    await page.goto(SIMILAR_URL(args.offerId), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const deadline = Date.now() + (headed ? 180000 : 15000);
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new CliError(130, 'CANCELED', 'Browser closed.');
      }
      if (captured.length > 0) break;
      if (!headed && /\/punish|x5secdata=/.test(page.url())) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    page.off('response', onResp);

    if (captured.length === 0) {
      throw new CliError(
        4,
        'NO_RESULTS',
        'No similar offers returned. Run once with --headed to solve any slider; subsequent calls work for hours.',
      );
    }

    // Filter out the seed offer itself from the results.
    const filtered = captured.filter((o) => o.offerId !== args.offerId);
    return {
      offerId: args.offerId,
      total: filtered.length,
      offers: filtered.slice(0, args.max),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function run(opts: SimilarOpts): Promise<void> {
  if (!opts.offerId) {
    throw new CliError(2, 'BAD_INPUT', 'offerId is required.');
  }
  const max = Math.max(1, parseInt(opts.max ?? '20', 10));

  const data = await dispatch<SimilarArgs, SimilarResult>(
    'similar',
    { offerId: opts.offerId, max, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );

  emit({
    human: () => printSimilar(data),
    data,
  });
}

function printSimilar(r: SimilarResult): void {
  if (r.offers.length === 0) {
    process.stdout.write(`No similar offers found for ${r.offerId}.\n`);
    return;
  }
  // Sort by price ascending for quick price-comparison view.
  const sorted = [...r.offers].sort((a, b) => {
    const ap = a.price.min ?? Number.POSITIVE_INFINITY;
    const bp = b.price.min ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  process.stdout.write(
    `Similar offers to ${r.offerId} (${sorted.length}, by price asc):\n\n`,
  );
  const w = String(sorted.length).length;
  sorted.forEach((o, i) => {
    const idx = String(i + 1).padStart(w, ' ');
    const ad = o.isP4P ? ' [广告]' : '';
    const verified = o.verified.superFactory
      ? ' [超级工厂]'
      : o.verified.factory
      ? ' [验厂]'
      : '';
    process.stdout.write(
      `${idx}. ${o.price.text || '(n/a)'}${ad}${verified}  ${o.title.slice(
        0,
        50,
      )}\n`,
    );
    const supplier = o.supplier.name ?? '?';
    const years = o.supplier.years ? ` · ${o.supplier.years}年` : '';
    const loc = [o.location.province, o.location.city]
      .filter(Boolean)
      .join(' ');
    process.stdout.write(
      `   ${supplier}${years}${loc ? ` · ${loc}` : ''}  (${o.offerId})\n`,
    );
  });
}
