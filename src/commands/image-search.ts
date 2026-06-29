import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BrowserContext, Page } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import {
  clickImageSearchButton,
  clickImageUploadButton,
} from '../session/image-search-locators.js';
import { captureSearchOffersForAction } from '../session/search-capture.js';
import { type Offer } from './search.js';

export interface ImageSearchOpts {
  imagePath: string;
  max?: string;
  profile?: string;
  headed?: boolean;
  debugImage?: boolean;
}

export interface ImageSearchArgs {
  imagePath: string;
  max: number;
  headed?: boolean;
  debugImage?: boolean;
}

export interface ImageSearchResult {
  imageId: string;
  total: number;
  rawTotal: number;
  offers: Offer[];
  lowConfidence?: boolean;
  upload?: {
    finalUrl: string;
    previewSrc?: string | null;
  };
  usedResultUrl?: string;
  diagnostics?: unknown;
}

const UPLOAD_PAGE = 'https://s.1688.com/youyuan/index.htm';
const RESULT_URL = (imageId: string) =>
  `https://s.1688.com/selloffer/offer_search.htm?imageId=${imageId}`;

export function extractImageId(url: string): string | null {
  try {
    return new URL(url).searchParams.get('imageId');
  } catch {
    const match = url.match(/[?&]imageId=(\d+)/);
    return match?.[1] ?? null;
  }
}

export function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;

  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

  const png = buf
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const webp =
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP';

  const bmp = buf[0] === 0x42 && buf[1] === 0x4d;

  return jpg || png || webp || bmp;
}

interface UploadResult {
  imageId: string;
  uploadPageUrl: string;
  finalUrl: string;
  previewSrc?: string | null;
}

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
  const upload = await uploadAndGetImageId(ctx, args.imagePath);
  info(`Image uploaded (imageId=${upload.imageId}). Fetching results...`);

  const searched = await searchByImageId(ctx, upload.imageId, upload.finalUrl);

  const sliced = searched.offers.slice(0, args.max);
  return {
    imageId: upload.imageId,
    total: sliced.length,
    rawTotal: searched.offers.length,
    offers: sliced,
    lowConfidence: searched.lowConfidence,
    upload: {
      finalUrl: upload.finalUrl,
      previewSrc: upload.previewSrc,
    },
    usedResultUrl: searched.usedResultUrl,
    diagnostics: args.debugImage ? searched.diagnostics : undefined,
  };
}

async function uploadAndGetImageId(
  ctx: BrowserContext,
  imagePath: string,
): Promise<UploadResult> {
  const page = await ctx.newPage();
  try {
    const beforeUrl = page.url() || UPLOAD_PAGE;
    const beforeImageId = extractImageId(beforeUrl);

    // Navigate to upload page
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

    // Explicitly await filechooser — don't use page.on('filechooser')
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    await clickImageUploadButton(page);
    const chooser = await chooserPromise;
    await chooser.setFiles(imagePath);

    // Wait for upload preview to appear
    await waitForUploadReady(page);

    // Read preview image src for diagnostics
    const previewSrc = await readUploadPreviewSrc(page).catch(() => null);

    // Click search and wait for imageId to appear in URL
    await clickImageSearchButton(page);

    await page.waitForURL(
      (url) => {
        const currentImageId = extractImageId(url.toString());
        return !!currentImageId && currentImageId !== beforeImageId;
      },
      { timeout: 30000 },
    );

    const finalUrl = page.url();
    const match = finalUrl.match(/imageId=(\d+)/);
    if (!match) {
      throw new CliError(
        13,
        'UPLOAD_FAILED',
        'No imageId in URL after upload. Try again or use --headed.',
      );
    }
    return {
      imageId: match[1]!,
      uploadPageUrl: UPLOAD_PAGE,
      finalUrl,
      previewSrc,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function waitForUploadReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(800);

  await page
    .waitForFunction(
      () => {
        const imgs = Array.from(
          document.querySelectorAll('img'),
        ) as HTMLImageElement[];
        const hasLikelyPreview = imgs.some((img) => {
          const src =
            img.currentSrc || img.src || img.getAttribute('src') || '';
          const box = img.getBoundingClientRect();
          return src && box.width >= 40 && box.height >= 40;
        });

        const buttons = Array.from(
          document.querySelectorAll('button'),
        );
        const hasSearchButton = buttons.some((btn) => {
          const text = btn.textContent?.trim() ?? '';
          return (
            /搜索图片|开始搜索|搜同款/.test(text) &&
            !(btn as HTMLButtonElement).disabled
          );
        });

        return hasLikelyPreview || hasSearchButton;
      },
      { timeout: 15000 },
    )
    .catch(() => undefined);
}

async function readUploadPreviewSrc(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const imgs = Array.from(
      document.querySelectorAll('img'),
    ) as HTMLImageElement[];
    const candidates = imgs
      .map((img) => {
        const src =
          img.currentSrc || img.src || img.getAttribute('src') || '';
        const box = img.getBoundingClientRect();
        return { src, area: box.width * box.height };
      })
      .filter((x) => x.src && x.area > 1600)
      .sort((a, b) => b.area - a.area);

    return candidates[0]?.src ?? null;
  });
}

async function searchByImageId(
  ctx: BrowserContext,
  imageId: string,
  resultUrl?: string,
): Promise<{
  offers: Offer[];
  diagnostics: unknown;
  lowConfidence: boolean;
  usedResultUrl: string;
}> {
  const page = await ctx.newPage();
  const usedResultUrl = resultUrl || RESULT_URL(imageId);

  try {
    const captureResult = await captureSearchOffersForAction(
      {
        page,
        keep: 'largest',
        requireImageId: imageId,
      },
      async () => {
        await page.goto(usedResultUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      },
      {
        timeoutMs: 20000,
        isClosed: () => page.isClosed(),
        isBlocked: () => /\/punish|x5secdata=/.test(page.url()),
      },
    );

    if (captureResult.status === 'browser_closed') {
      throw new CliError(130, 'CANCELED', 'Browser closed.');
    }

    if (captureResult.status === 'blocked') {
      throw new CliError(
        4,
        'RISK_CONTROL',
        '1688 image search was blocked by risk control. Retry with --headed.',
      );
    }

    if (
      captureResult.status !== 'captured' ||
      captureResult.offers.length === 0
    ) {
      return {
        offers: [],
        diagnostics: captureResult.diagnostics,
        lowConfidence: true,
        usedResultUrl,
      };
    }

    return {
      offers: captureResult.offers,
      diagnostics: captureResult.diagnostics,
      lowConfidence: false,
      usedResultUrl,
    };
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
      {
        imagePath: abs,
        max,
        headed: opts.headed,
        debugImage: opts.debugImage,
      },
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
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: 'https://detail.1688.com/',
      },
    });
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
  if (buf.length < 1024) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      'Downloaded image is too small (< 1KB).',
    );
  }
  if (buf.length > 20 * 1024 * 1024) {
    throw new CliError(
      2,
      'BAD_INPUT',
      `Image too large (${(buf.length / 1024 / 1024).toFixed(1)}MB > 20MB).`,
    );
  }
  if (!looksLikeImage(buf)) {
    throw new CliError(
      2,
      'BAD_INPUT',
      'Downloaded content is not a valid image (wrong magic bytes). The URL may point to an HTML page or error page.',
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
  process.stdout.write(`Image search (imageId=${r.imageId}):\n`);
  process.stdout.write(`  raw: ${r.rawTotal}\n`);
  process.stdout.write(`  shown: ${r.total}\n`);

  if (r.lowConfidence) {
    process.stdout.write(
      'Warning: low-confidence image search. The CLI could not confirm that captured offers belong to the uploaded imageId. No unrelated recommendation stream was used.\n\n',
    );
  } else {
    process.stdout.write('\n');
  }

  if (r.offers.length === 0) {
    process.stdout.write(
      'No trusted image-search offers found. Retry with --headed or inspect with --debug-image.\n',
    );
    return;
  }

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
