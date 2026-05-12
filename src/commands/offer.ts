import type { BrowserContext, Page, Response as PWResponse } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';

export interface OfferOpts {
  offerId: string;
  profile?: string;
  headed?: boolean;
}

export interface OfferArgs {
  offerId: string;
}

export interface OfferResult {
  offerId: string;
  title: string;
  url: string;
  priceRange: string | null;
  priceMin: number | null;
  priceMax: number | null;
  unitName: string | null;
  supplier: { name: string | null; userId: string | null };
  freight: {
    receiveAddress: string | null;
    sendArea: string | null;
    unitWeight: number | null;
  };
  options: SkuOption[];
  skus: SkuVariant[];
  mainImage: string | null;
}

export interface SkuOption {
  prop: string;
  values: { name: string; imageUrl: string | null }[];
}

export interface SkuVariant {
  skuId: string;
  specs: string;
  price: number | null;
  stock: number | null;
}

const SKU_API_RE = /wosc\.queryofferskuselectormodel/i;

export async function execute(
  ctx: BrowserContext,
  args: OfferArgs,
): Promise<OfferResult> {
  if (!/^\d+$/.test(args.offerId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid offerId: ${args.offerId}`);
  }
  const page = await ctx.newPage();

  let resolveSku!: (v: unknown) => void;
  const skuPromise = new Promise<unknown>((r) => {
    resolveSku = r;
  });
  const onResp = async (resp: PWResponse) => {
    if (!SKU_API_RE.test(resp.url())) return;
    try {
      const text = await resp.text();
      const json = parseMtop(text) as {
        data?: { skuSelectorBizModel?: unknown };
      };
      if (json?.data?.skuSelectorBizModel) resolveSku(json.data.skuSelectorBizModel);
    } catch {
      /* ignore parse errors */
    }
  };
  page.on('response', onResp);

  const url = `https://detail.1688.com/offer/${args.offerId}.html`;
  info(`Fetching offer ${args.offerId}...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      `Failed to load offer page: ${(e as Error).message}`,
    );
  }
  if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
    throw new CliError(
      3,
      'NOT_LOGGED_IN',
      'Session expired. Run `1688 login`.',
    );
  }

  const sku = (await Promise.race([
    skuPromise,
    new Promise<null>((res) => setTimeout(() => res(null), 18000)),
  ])) as SkuBizModel | null;
  page.off('response', onResp);

  const dom = await scrapeDom(page);
  return assemble(args.offerId, url, sku, dom);
}

function parseMtop(text: string): unknown {
  const t = text.trim();
  const m = t.match(/^\s*mtopjsonp\d+\(([\s\S]*)\)\s*$/);
  return JSON.parse(m ? m[1]! : t);
}

interface SkuBizModel {
  skuProps?: { prop?: string; value?: { name?: string; imageUrl?: string }[] }[];
  skuInfoMap?: Record<
    string,
    {
      skuId?: string;
      specAttrs?: string;
      price?: string;
      discountPrice?: string;
      canBookCount?: string;
    }
  >;
  skuPriceScale?: string;
  extraInfo?: {
    freightInfo?: {
      unitWeight?: number;
      receiveAddress?: string;
      sendAddressCode?: string;
    };
  };
}

interface DomInfo {
  title: string;
  supplierName: string | null;
  mainImage: string | null;
  sendArea: string | null;
}

async function scrapeDom(page: Page): Promise<DomInfo> {
  const raw = await page.title();
  const title = raw.replace(/\s*-\s*阿里巴巴\s*$/, '').trim();
  const info = await page.evaluate(() => {
    function txt(sel: string): string | null {
      const e = document.querySelector(sel);
      return e?.textContent?.trim() ?? null;
    }
    function imgSrc(sel: string): string | null {
      const e = document.querySelector(sel) as HTMLImageElement | null;
      return e?.src ?? e?.getAttribute('data-src') ?? null;
    }
    return {
      supplierName: txt('h1') ?? null,
      // Try common image carousel selectors
      mainImage:
        imgSrc('.v-image-wrap img') ??
        imgSrc('.ant-image-img') ??
        imgSrc('img[alt*="主图"]'),
      sendArea: null as string | null,
    };
  });
  return { title, ...info };
}

function assemble(
  offerId: string,
  url: string,
  sku: SkuBizModel | null,
  dom: DomInfo,
): OfferResult {
  const priceRange = sku?.skuPriceScale ?? null;
  const { min: priceMin, max: priceMax } = parseRange(priceRange);

  const options: SkuOption[] = (sku?.skuProps ?? []).map((p) => ({
    prop: p.prop ?? '',
    values: (p.value ?? []).map((v) => ({
      name: v.name ?? '',
      imageUrl: v.imageUrl ?? null,
    })),
  }));

  const skus: SkuVariant[] = Object.entries(sku?.skuInfoMap ?? {}).map(
    ([k, v]) => ({
      skuId: v.skuId ?? '',
      specs: v.specAttrs ?? k,
      price: parseFloatOrNull(v.discountPrice ?? v.price),
      stock: parseIntOrNull(v.canBookCount),
    }),
  );

  const freight = {
    receiveAddress: sku?.extraInfo?.freightInfo?.receiveAddress ?? null,
    sendArea: dom.sendArea,
    unitWeight: sku?.extraInfo?.freightInfo?.unitWeight ?? null,
  };

  const fallbackImage =
    options[0]?.values[0]?.imageUrl ?? dom.mainImage ?? null;

  return {
    offerId,
    title: dom.title,
    url,
    priceRange,
    priceMin,
    priceMax,
    unitName: null,
    supplier: { name: dom.supplierName, userId: null },
    freight,
    options,
    skus,
    mainImage: fallbackImage,
  };
}

function parseRange(s: string | null): { min: number | null; max: number | null } {
  if (!s) return { min: null, max: null };
  const matches = Array.from(s.matchAll(/([\d.]+)/g)).map((m) => parseFloat(m[1]!));
  if (matches.length === 0) return { min: null, max: null };
  return {
    min: matches[0] ?? null,
    max: matches.length > 1 ? matches[1]! : matches[0]!,
  };
}

function parseFloatOrNull(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export async function run(opts: OfferOpts): Promise<void> {
  if (!opts.offerId) {
    throw new CliError(2, 'BAD_INPUT', 'offerId required.');
  }
  const data = await dispatch<OfferArgs, OfferResult>(
    'offer',
    { offerId: opts.offerId },
    { headed: opts.headed, profile: opts.profile },
  );
  emit({
    human: () => printOffer(data),
    data,
  });
}

function printOffer(o: OfferResult): void {
  process.stdout.write(`${o.title}\n`);
  process.stdout.write(`  offerId:  ${o.offerId}\n`);
  if (o.priceRange) {
    process.stdout.write(`  price:    ${o.priceRange}\n`);
  } else if (o.priceMin !== null) {
    const range =
      o.priceMax !== null && o.priceMax !== o.priceMin
        ? `¥${o.priceMin.toFixed(2)} - ¥${o.priceMax.toFixed(2)}`
        : `¥${o.priceMin.toFixed(2)}`;
    process.stdout.write(`  price:    ${range}\n`);
  }
  if (o.supplier.name) {
    process.stdout.write(`  supplier: ${o.supplier.name}\n`);
  }
  if (o.freight.receiveAddress) {
    process.stdout.write(
      `  freight:  to ${o.freight.receiveAddress}` +
        (o.freight.unitWeight ? `, ${o.freight.unitWeight}kg/unit` : '') +
        '\n',
    );
  }
  process.stdout.write(`  url:      ${o.url}\n`);
  if (o.options.length) {
    process.stdout.write(`\nOptions (${o.options.length}):\n`);
    for (const opt of o.options) {
      process.stdout.write(
        `  ${opt.prop}: ${opt.values.map((v) => v.name).slice(0, 5).join(' | ')}`,
      );
      if (opt.values.length > 5)
        process.stdout.write(` ... (+${opt.values.length - 5})`);
      process.stdout.write('\n');
    }
  }
  if (o.skus.length) {
    const sample = o.skus.slice(0, 5);
    process.stdout.write(`\nSKUs (${o.skus.length} total, showing ${sample.length}):\n`);
    for (const s of sample) {
      const price = s.price !== null ? `¥${s.price.toFixed(2)}` : '?';
      const stock = s.stock !== null ? `${s.stock} in stock` : '';
      process.stdout.write(`  ${price.padEnd(10)} ${stock.padEnd(15)} ${s.specs}\n`);
    }
  }
}
