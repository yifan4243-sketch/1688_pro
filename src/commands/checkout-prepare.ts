import type { BrowserContext } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { execute as cartListExecute } from './cart-list.js';

export interface CheckoutPrepareOpts {
  cartIds: string[];
  profile?: string;
  headed?: boolean;
}

export interface CheckoutPrepareArgs {
  cartIds: string[];
}

export interface CheckoutPrepareResult {
  ok: boolean;
  url: string;
  totalAmount: number;
  productAmount: number;
  shippingAmount: number;
  taxAmount: number;
  receiveAddress: {
    fullName: string | null;
    mobile: string | null;
    address: string | null;
    region: string | null;
  };
  orders: PrepareOrder[];
}

export interface PrepareOrder {
  seller: {
    memberId: string | null;
    loginId: string | null;
    companyName: string | null;
  };
  totalAmount: number;
  productAmount: number;
  shippingAmount: number;
  items: PrepareItem[];
}

export interface PrepareItem {
  cartId: string;
  offerId: string;
  productNumber: string | null;
  skuNumber: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export async function execute(
  ctx: BrowserContext,
  args: CheckoutPrepareArgs,
): Promise<CheckoutPrepareResult> {
  if (!Array.isArray(args.cartIds) || args.cartIds.length === 0) {
    throw new CliError(2, 'BAD_INPUT', 'cartIds required.');
  }
  for (const id of args.cartIds) {
    if (!/^\d+$/.test(id)) {
      throw new CliError(2, 'BAD_INPUT', `Invalid cartId: ${id}`);
    }
  }

  // Verify cartIds exist in current cart.
  info('Verifying cart items...');
  const cart = await cartListExecute(ctx, {});
  const wanted = new Set(args.cartIds);
  const missing = args.cartIds.filter(
    (id) => !cart.items.some((i) => i.cartId === id),
  );
  if (missing.length > 0) {
    throw new CliError(
      12,
      'CART_ITEM_NOT_FOUND',
      `cartId(s) not found: ${missing.join(', ')}`,
    );
  }

  // Open cart page, uncheck all, check only the wanted items, click 结算.
  info('Selecting items in cart...');
  const page = await ctx.newPage();
  try {
    await page.goto('https://cart.1688.com/', {
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
    try {
      await page.waitForSelector('input[type="checkbox"].next-checkbox-input', {
        timeout: 15000,
      });
    } catch {
      throw new CliError(11, 'CART_NOT_LOADED', 'Cart page did not load.');
    }
    await new Promise((r) => setTimeout(r, 1500));

    // For each wanted cartId, find its row by product title and check it.
    // For SAFETY, we won't uncheck others — we just toggle the targets to checked.
    // 1688's 结算 only acts on currently checked items.
    // First: uncheck everything via the master select-all (if checked) so only
    //  our targets end up checked.
    await uncheckAll(page);
    await new Promise((r) => setTimeout(r, 1000));

    for (const cartId of args.cartIds) {
      const item = cart.items.find((i) => i.cartId === cartId)!;
      const titleHint = item.productTitle.slice(0, 12);
      const skuHint = item.skuTitle?.trim() ?? null;
      const result = await page.evaluate(
        ({ titleHint, skuHint }) => {
          const probe = skuHint && skuHint.length >= 3 ? skuHint : titleHint;
          const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
          const candidates = all.filter(
            (el) =>
              el.children.length === 0 &&
              el.textContent !== null &&
              el.textContent.includes(probe),
          );
          for (const c of candidates) {
            let row: HTMLElement | null = c;
            for (let d = 0; d < 10 && row; d++) {
              row = row.parentElement;
              if (!row) break;
              const txt = row.textContent ?? '';
              if (!txt.includes(titleHint)) continue;
              const cb = row.querySelector<HTMLElement>(
                '.next-checkbox-wrapper',
              );
              if (cb) {
                const aria = cb.querySelector('[aria-checked]');
                const checked = aria?.getAttribute('aria-checked') === 'true';
                if (!checked) cb.click();
                return { ok: true, alreadyChecked: checked };
              }
            }
          }
          return { ok: false, reason: 'row-not-found' };
        },
        { titleHint, skuHint },
      );
      if (!result.ok) {
        throw new CliError(
          14,
          'UI_ELEMENT_NOT_FOUND',
          `Could not select cartId ${cartId} (${result.reason}, sku="${item.skuTitle ?? ''}").`,
        );
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    info('Clicking 结算...');
    const [_nav] = await Promise.all([
      page
        .waitForURL(/smart_make_order|order\.1688\.com\/order/i, {
          timeout: 25000,
        })
        .catch(() => undefined),
      page
        .locator('button:has-text("结算"):not([disabled])')
        .first()
        .click({ force: true, timeout: 5000 }),
    ]);
    if (!/smart_make_order/i.test(page.url())) {
      // Sometimes the page renders inline rather than navigating.
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!/order\.1688\.com/i.test(page.url())) {
      throw new CliError(
        18,
        'PREVIEW_NAV_FAILED',
        `Did not reach checkout preview page. URL: ${page.url()}`,
      );
    }
    info('Reading order preview...');
    await new Promise((r) => setTimeout(r, 5000));

    const html = await page.content();
    return parsePreview(html, page.url());
  } finally {
    await page.close().catch(() => {});
  }
}

async function uncheckAll(
  page: Awaited<ReturnType<BrowserContext['newPage']>>,
): Promise<void> {
  // Try to find a master "全选" checkbox that's currently checked, and click it
  // to uncheck everything. Fallback: walk all checkboxes and click each that is checked.
  await page.evaluate(() => {
    const wrappers = Array.from(
      document.querySelectorAll<HTMLElement>('.next-checkbox-wrapper'),
    );
    for (const w of wrappers) {
      const aria = w.querySelector('[aria-checked]');
      if (aria?.getAttribute('aria-checked') === 'true') {
        w.click();
      }
    }
  });
}

interface RawPreview {
  source?: string;
  from?: string;
  orders?: RawOrder[];
}
interface RawOrder {
  sumPayment?: number;
  sumPaymentNoCarriage?: number;
  sumCarriage?: number;
  sumTaxAmount?: number;
  receiveAddress?: {
    fullName?: string;
    mobile?: string;
    address?: string;
    addressCodeText?: string;
  };
  simpleSeller?: {
    memberId?: string;
    loginId?: string;
    companyName?: string;
  };
  cargoGroupedByLogistics?: RawCargoGroup[];
}
interface RawCargoGroup {
  cargoList?: RawCargo[];
  totalFreightFee?: number;
}
interface RawCargo {
  offerId?: number | string;
  orderCargos?: RawCargoItem[];
}
interface RawCargoItem {
  cartId?: number | string;
  cargoNumber?: string;
  cargoSkuNumber?: string;
  commonQuantity?: number;
  finalUnitPrice?: number;
  amount?: number;
}

function parsePreview(rawHtml: string, url: string): CheckoutPrepareResult {
  const match = rawHtml.match(
    /data-source="([^"]+sumPayment[^"]+)"/,
  );
  if (!match) {
    throw new CliError(
      19,
      'PREVIEW_NOT_FOUND',
      'Could not locate preview data in page.',
    );
  }
  const unescaped = decodeHtmlEntities(match[1]!);
  let raw: RawPreview;
  try {
    raw = JSON.parse(unescaped) as RawPreview;
  } catch (e) {
    throw new CliError(
      19,
      'PREVIEW_PARSE_FAILED',
      `Could not parse preview JSON: ${(e as Error).message}`,
    );
  }
  const orders = raw.orders ?? [];
  if (orders.length === 0) {
    throw new CliError(19, 'PREVIEW_EMPTY', 'No orders in preview.');
  }

  // Total = sum of per-seller order sums.
  let totalAmount = 0;
  let productAmount = 0;
  let shippingAmount = 0;
  let taxAmount = 0;
  const out: PrepareOrder[] = [];
  let firstAddress: RawOrder['receiveAddress'] | undefined;

  for (const o of orders) {
    totalAmount += cents(o.sumPayment);
    productAmount += cents(o.sumPaymentNoCarriage);
    shippingAmount += cents(o.sumCarriage);
    taxAmount += cents(o.sumTaxAmount);
    if (!firstAddress) firstAddress = o.receiveAddress;
    const items: PrepareItem[] = [];
    for (const cg of o.cargoGroupedByLogistics ?? []) {
      for (const cargo of cg.cargoList ?? []) {
        for (const oc of cargo.orderCargos ?? []) {
          items.push({
            cartId: oc.cartId !== undefined ? String(oc.cartId) : '',
            offerId: cargo.offerId !== undefined ? String(cargo.offerId) : '',
            productNumber: oc.cargoNumber ?? null,
            skuNumber: oc.cargoSkuNumber ?? null,
            quantity: oc.commonQuantity ?? 0,
            unitPrice: oc.finalUnitPrice ?? 0,
            amount: oc.amount ?? 0,
          });
        }
      }
    }
    out.push({
      seller: {
        memberId: o.simpleSeller?.memberId ?? null,
        loginId: o.simpleSeller?.loginId ?? null,
        companyName: o.simpleSeller?.companyName ?? null,
      },
      totalAmount: cents(o.sumPayment),
      productAmount: cents(o.sumPaymentNoCarriage),
      shippingAmount: cents(o.sumCarriage),
      items,
    });
  }

  return {
    ok: true,
    url,
    totalAmount,
    productAmount,
    shippingAmount,
    taxAmount,
    receiveAddress: {
      fullName: firstAddress?.fullName ?? null,
      mobile: firstAddress?.mobile ?? null,
      address: firstAddress?.address ?? null,
      region: firstAddress?.addressCodeText ?? null,
    },
    orders: out,
  };
}

function cents(v: number | undefined): number {
  if (v === undefined || v === null) return 0;
  return Math.round(v) / 100;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export async function run(opts: CheckoutPrepareOpts): Promise<void> {
  if (!opts.cartIds || opts.cartIds.length === 0) {
    throw new CliError(2, 'BAD_INPUT', 'At least one cartId is required.');
  }
  const data = await dispatch<CheckoutPrepareArgs, CheckoutPrepareResult>(
    'checkout-prepare',
    { cartIds: opts.cartIds },
    { headed: opts.headed, profile: opts.profile },
  );
  emit({
    human: () => printPreview(data),
    data,
  });
}

function printPreview(r: CheckoutPrepareResult): void {
  process.stdout.write('=== Checkout Preview ===\n');
  process.stdout.write(`  total:   ¥${r.totalAmount.toFixed(2)}`);
  process.stdout.write(
    `  (items ¥${r.productAmount.toFixed(2)} + shipping ¥${r.shippingAmount.toFixed(
      2,
    )}`,
  );
  if (r.taxAmount > 0) process.stdout.write(` + tax ¥${r.taxAmount.toFixed(2)}`);
  process.stdout.write(')\n');
  if (r.receiveAddress.fullName) {
    process.stdout.write(
      `  ship to: ${r.receiveAddress.fullName} (${
        r.receiveAddress.mobile ?? '-'
      })\n           ${r.receiveAddress.region ?? ''} ${
        r.receiveAddress.address ?? ''
      }\n`,
    );
  }
  process.stdout.write('\n');
  r.orders.forEach((o, i) => {
    process.stdout.write(
      `Seller ${i + 1}: ${o.seller.companyName ?? '?'} (${o.seller.loginId ?? '-'})\n`,
    );
    process.stdout.write(
      `  subtotal: ¥${o.totalAmount.toFixed(2)} = items ¥${o.productAmount.toFixed(
        2,
      )} + shipping ¥${o.shippingAmount.toFixed(2)}\n`,
    );
    for (const it of o.items) {
      process.stdout.write(
        `    * cartId=${it.cartId}  ${it.quantity}×¥${it.unitPrice.toFixed(
          2,
        )} = ¥${it.amount.toFixed(2)}\n`,
      );
    }
  });
  process.stdout.write(
    '\nThis is a PREVIEW only. To actually place the order, you must do it manually in 1688 or via `1688 checkout confirm` (not yet implemented).\n',
  );
}
