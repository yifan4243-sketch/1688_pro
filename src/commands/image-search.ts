import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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

export interface ImageSearchOpts {
  imagePath: string;
  max?: string;
  profile?: string;
  headed?: boolean;
}

export interface ImageSearchArgs {
  imagePath: string;
  max: number;
  headed?: boolean;
}

export interface ImageSearchResult {
  imageId: string;
  total: number;
  offers: Offer[];
}

const UPLOAD_PAGE = 'https://s.1688.com/youyuan/index.htm';
const RESULT_URL = (imageId: string) =>
  `https://s.1688.com/selloffer/offer_search.htm?imageId=${imageId}`;

export async function execute(
  ctx: BrowserContext,
  args: ImageSearchArgs,
): Promise<ImageSearchResult> {
  try {
    await fs.access(args.imagePath, fs.constants.R_OK);
  } catch {
    throw new CliError(2, 'BAD_INPUT', `Cannot read image: ${args.imagePath}`);
  }

  return withRecovery(
    ctx,
    { cmd: 'image-search', args },
    () => executeImageSearch(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

async function executeImageSearch(
  ctx: BrowserContext,
  args: ImageSearchArgs,
): Promise<ImageSearchResult> {
  info('Uploading image to 1688...');
  const imageId = await uploadAndGetImageId(ctx, args.imagePath);
  info(`Image uploaded (imageId=${imageId}). Fetching results...`);

  const offers = await searchByImageId(ctx, imageId);
  return {
    imageId,
    total: offers.length,
    offers: offers.slice(0, args.max),
  };
}

async function uploadAndGetImageId(
  ctx: BrowserContext,
  imagePath: string,
): Promise<string> {
  const page = await ctx.newPage();
  try {
    page.on('filechooser', async (chooser) => {
      try {
        await chooser.setFiles(imagePath);
      } catch {
        /* ignore — handled by waitForURL timeout */
      }
    });

    await page.goto(UPLOAD_PAGE, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
      throw new CliError(
        3,
        'NOT_LOGGED_IN',
        'Session expired. Run `1688 login`.',
      );
    }

    // Click the upload button — filechooser handler picks up the file.
    await page
      .locator('.image-upload-button-container')
      .first()
      .click({ force: true, timeout: 8000 });

    // Upload happens silently in background; "搜索图片" button appears only
    // after the image is processed. Wait up to 20s for it.
    const searchBtn = page.locator('text=搜索图片').first();
    try {
      await searchBtn.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      // Diagnostic: snapshot the page state to help debug
      const state = await page
        .evaluate(() => ({
          url: location.href,
          title: document.title,
          bodyHead: (document.body?.innerText ?? '').slice(0, 300),
        }))
        .catch(() => null);
      throw new CliError(
        13,
        'UPLOAD_FAILED',
        `Upload appeared to fail — "搜索图片" button never showed.\n` +
          (state
            ? `URL: ${state.url}\nTitle: ${state.title}\nBody: ${state.bodyHead}`
            : ''),
      );
    }
    await Promise.all([
      page
        .waitForURL(/imageId=\d+/, { timeout: 20000 })
        .catch(() => undefined),
      searchBtn.click({ force: true }),
    ]);

    const match = page.url().match(/imageId=(\d+)/);
    if (!match) {
      throw new CliError(
        13,
        'UPLOAD_FAILED',
        'No imageId in URL after upload. Try again or use --headed.',
      );
    }
    return match[1]!;
  } finally {
    await page.close().catch(() => {});
  }
}

async function searchByImageId(
  ctx: BrowserContext,
  imageId: string,
): Promise<Offer[]> {
  const page = await ctx.newPage();

  // Same mtop interception pattern as text `search` — image-search and
  // keyword-search share the WirelessRecommend.recommend endpoint (appId=32517).
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
    await page.goto(RESULT_URL(imageId), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new CliError(130, 'CANCELED', 'Browser closed.');
      }
      if (captured.length > 0) break;
      if (/\/punish|x5secdata=/.test(page.url())) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    page.off('response', onResp);
    return captured;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function run(opts: ImageSearchOpts): Promise<void> {
  if (!opts.imagePath) {
    throw new CliError(2, 'BAD_INPUT', 'Image path or URL required.');
  }
  const max = Math.max(1, parseInt(opts.max ?? '20', 10));

  let abs: string;
  let cleanup: (() => Promise<void>) | null = null;
  if (/^https?:\/\//i.test(opts.imagePath)) {
    info(`Downloading image from URL...`);
    const t = await downloadToTemp(opts.imagePath);
    abs = t.path;
    cleanup = t.cleanup;
  } else {
    abs = path.resolve(opts.imagePath);
  }

  try {
    const data = await dispatch<ImageSearchArgs, ImageSearchResult>(
      'image-search',
      { imagePath: abs, max, headed: opts.headed },
      { headed: opts.headed, profile: opts.profile },
    );
    emit({
      human: () => printResults(data),
      data,
    });
  } finally {
    if (cleanup) await cleanup().catch(() => {});
  }
}

interface TempFile {
  path: string;
  cleanup: () => Promise<void>;
}

async function downloadToTemp(url: string): Promise<TempFile> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      `Failed to download image: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      `Download failed: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new CliError(9, 'NETWORK_ERROR', 'Downloaded image is empty.');
  }
  if (buf.length > 20 * 1024 * 1024) {
    throw new CliError(
      2,
      'BAD_INPUT',
      `Image too large (${(buf.length / 1024 / 1024).toFixed(1)}MB > 20MB).`,
    );
  }
  const ext = guessExt(url, res.headers.get('content-type'));
  const tmpPath = path.join(
    os.tmpdir(),
    `bb1688-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
  );
  await fs.writeFile(tmpPath, buf);
  return {
    path: tmpPath,
    cleanup: () => fs.rm(tmpPath, { force: true }),
  };
}

function guessExt(url: string, contentType: string | null): string {
  const m = url.match(/\.(jpe?g|png|webp|bmp)(\?|$|#)/i);
  if (m) return '.' + m[1]!.toLowerCase().replace('jpeg', 'jpg');
  if (contentType) {
    if (/jpeg/i.test(contentType)) return '.jpg';
    if (/png/i.test(contentType)) return '.png';
    if (/webp/i.test(contentType)) return '.webp';
    if (/bmp/i.test(contentType)) return '.bmp';
  }
  return '.jpg';
}

function printResults(r: ImageSearchResult): void {
  if (r.offers.length === 0) {
    process.stdout.write(`No offers found (imageId=${r.imageId}).\n`);
    return;
  }
  process.stdout.write(`Image search (imageId=${r.imageId}):\n\n`);
  const w = String(r.offers.length).length;
  r.offers.forEach((o, i) => {
    const idx = String(i + 1).padStart(w, ' ');
    const price = o.price.text || '(n/a)';
    process.stdout.write(`${idx}. ${o.title}\n`);
    const pad = ' '.repeat(w + 2);
    process.stdout.write(`${pad}${price}`);
    if (o.turnover) process.stdout.write(`  ·  ${o.turnover}`);
    process.stdout.write('\n');
    const supplierBits = [
      o.supplier.name,
      o.supplier.years ? `${o.supplier.years}年` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (supplierBits) process.stdout.write(`${pad}${supplierBits}\n`);
    process.stdout.write(`${pad}${o.url}\n`);
    if (i < r.offers.length - 1) process.stdout.write('\n');
  });
}
