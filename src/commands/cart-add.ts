import type { BrowserContext } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import {
  execute as offerExecute,
  type SkuVariant,
} from './offer.js';
import {
  execute as cartListExecute,
  type CartItem,
} from './cart-list.js';

export interface CartAddOpts {
  offerId: string;
  sku?: string;
  qty?: string;
  profile?: string;
  headed?: boolean;
}

export interface CartAddArgs {
  offerId: string;
  skuId: string;
  quantity: number;
}

export interface CartAddResult {
  ok: boolean;
  added: CartItem;
}

export async function execute(
  ctx: BrowserContext,
  args: CartAddArgs,
): Promise<CartAddResult> {
  if (!/^\d+$/.test(args.offerId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid offerId: ${args.offerId}`);
  }
  if (!/^\d+$/.test(args.skuId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid skuId: ${args.skuId}`);
  }
  if (!Number.isFinite(args.quantity) || args.quantity < 1) {
    throw new CliError(2, 'BAD_INPUT', `Invalid quantity: ${args.quantity}`);
  }

  // 1. Look up SKU spec text via offer execute (reuses cached daemon page).
  info('Looking up SKU spec...');
  const offer = await offerExecute(ctx, { offerId: args.offerId });
  const sku: SkuVariant | undefined = offer.skus.find(
    (s) => s.skuId === args.skuId,
  );
  if (!sku) {
    throw new CliError(
      12,
      'SKU_NOT_FOUND',
      `SKU ${args.skuId} not found in offer ${args.offerId}. ` +
        `Run \`1688 offer ${args.offerId}\` to list available SKUs.`,
    );
  }
  if (sku.stock !== null && args.quantity > sku.stock) {
    throw new CliError(
      2,
      'OUT_OF_STOCK',
      `Quantity ${args.quantity} exceeds available stock (${sku.stock}).`,
    );
  }

  // 2. Open detail page; find the row matching this SKU; fill qty; click 加采购车.
  info(
    `Adding ${args.quantity}× ${sku.specs.slice(0, 30)} (¥${
      sku.price?.toFixed(2) ?? '?'
    })...`,
  );
  const page = await ctx.newPage();
  try {
    await page.goto(`https://detail.1688.com/offer/${args.offerId}.html`, {
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
      await page.waitForSelector('input.ant-input-number-input', {
        timeout: 15000,
      });
    } catch {
      throw new CliError(
        11,
        'SKU_TABLE_NOT_LOADED',
        'SKU quantity inputs did not render.',
      );
    }
    await new Promise((r) => setTimeout(r, 1500));

    // Find the SMALLEST ancestor that contains both an input AND our exact
    // spec text. Tag that input so Playwright can drive it.
    const tagged = await page.evaluate((specHint: string) => {
      const cleanHint = specHint.replace(/\s+/g, '').slice(0, 20);
      // Find leaf elements with text matching our spec hint exactly.
      const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
      const specEls = all.filter(
        (el) =>
          el.children.length === 0 &&
          el.textContent !== null &&
          el.textContent.replace(/\s+/g, '').includes(cleanHint),
      );
      for (const specEl of specEls) {
        // Walk up; the FIRST ancestor that contains an input is our row.
        let cur: HTMLElement | null = specEl;
        for (let d = 0; d < 10 && cur; d++) {
          cur = cur.parentElement;
          if (!cur) break;
          const inp = cur.querySelector<HTMLInputElement>(
            'input.ant-input-number-input',
          );
          if (inp) {
            inp.setAttribute('data-bb-target', '1');
            return true;
          }
        }
      }
      return false;
    }, sku.specs);
    if (!tagged) {
      throw new CliError(
        14,
        'SKU_ROW_NOT_FOUND',
        `Could not locate qty input row for SKU "${sku.specs.slice(0, 30)}".`,
      );
    }

    // Zero out ALL other qty inputs so the bulk-add only picks up our row.
    await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input.ant-input-number-input',
        ),
      );
      for (const inp of inputs) {
        if (inp.dataset.bbTarget === '1') continue;
        if (!inp.value || inp.value === '0' || inp.value === '') continue;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(inp, '');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 500));

    // Drive the React-controlled input via fill() (proper event sequence).
    const qtyInput = page.locator('input[data-bb-target="1"]');
    await qtyInput.click({ timeout: 3000 });
    await qtyInput.fill(''); // clear first
    await qtyInput.fill(String(args.quantity));
    // Press Tab to blur + commit
    await page.keyboard.press('Tab');
    await new Promise((r) => setTimeout(r, 2500));

    if (process.env.BB1688_DEBUG === '1') {
      const valueNow = await qtyInput.inputValue();
      const cartButtons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).filter(b =>
          /加.*采购车/.test(b.textContent ?? ''),
        ).map(b => ({
          text: (b.textContent ?? '').trim(),
          disabled: b.disabled,
          cls: (b.className?.toString?.() || '').slice(0, 80),
          visible: (b as HTMLElement).offsetParent !== null,
        }));
      });
      process.stderr.write(
        `[debug] input value after typing: "${valueNow}"\n` +
          `[debug] 加采购车 buttons: ${JSON.stringify(cartButtons)}\n`,
      );
    }

    // Capture mtop calls during click
    const cartWrites: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /purchaseastoreservice|addcart|cart\.add/i.test(req.url())) {
        const m = req.url().match(/mtop\.[^/?]+/);
        if (m) cartWrites.push(m[0]);
      }
    });

    // Click "加采购车" button (the primary add-to-cart trigger).
    await page
      .locator('button:has-text("加采购车"):not([disabled])')
      .first()
      .click({ force: true, timeout: 5000 });
    await new Promise((r) => setTimeout(r, 2500));

    // 1688 typically pops a confirmation modal — find + click it.
    const dialogState = await page.evaluate(() => {
      const out: { cls: string; buttons: string[]; text: string }[] = [];
      document
        .querySelectorAll(
          'div[role="dialog"], div[class*="dialog"], div[class*="modal"], div[class*="popup"]',
        )
        .forEach((d) => {
          const el = d as HTMLElement;
          const r = el.getBoundingClientRect();
          if (r.width < 100 || r.height < 50) return;
          const clickables = Array.from(
            el.querySelectorAll('button, [role="button"], a, span[class*="btn"], div[class*="btn"]'),
          )
            .map((b) => (b.textContent ?? '').trim())
            .filter((t) => t && t.length < 20);
          out.push({
            cls: (el.className?.toString?.() || '').slice(0, 100),
            buttons: clickables.slice(0, 10),
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
          });
        });
      return out;
    });
    if (process.env.BB1688_DEBUG === '1') {
      process.stderr.write(
        `[debug] dialogs after add-cart click: ${JSON.stringify(dialogState)}\n`,
      );
    }

    // If there's a confirmation modal with a 加入 / 确认 button, click it.
    const confirmSelector =
      'div[role="dialog"] button:has-text("加入采购车"):visible, ' +
      'div[role="dialog"] button:has-text("确认加入"):visible, ' +
      'div[class*="dialog"] button:has-text("加入采购车"):visible, ' +
      'div[class*="dialog"] button:has-text("确认"):visible';
    const confirmBtn = page.locator(confirmSelector).first();
    if (await confirmBtn.count()) {
      await confirmBtn.click({ force: true });
    }
    await new Promise((r) => setTimeout(r, 4000));

    if (process.env.BB1688_DEBUG === '1') {
      process.stderr.write(
        `[debug] mtop POSTs after full flow: ${JSON.stringify(cartWrites)}\n`,
      );
    }
  } finally {
    await page.close().catch(() => {});
  }

  // 3. Verify by checking cart for the offerId + skuId combination.
  info('Verifying...');
  const after = await cartListExecute(ctx, {});
  const added = after.items.find(
    (i) => i.offerId === args.offerId && i.skuId === args.skuId,
  );
  if (!added) {
    throw new CliError(
      17,
      'ADD_NOT_REFLECTED',
      'Add-to-cart click did not result in a cart entry. The page may have changed.',
    );
  }
  return { ok: true, added };
}

export async function run(opts: CartAddOpts): Promise<void> {
  if (!opts.offerId) {
    throw new CliError(2, 'BAD_INPUT', 'offerId required.');
  }
  if (!opts.sku) {
    throw new CliError(2, 'BAD_INPUT', '--sku <skuId> required.');
  }
  const qty = parseInt(opts.qty ?? '1', 10);
  if (!Number.isFinite(qty) || qty < 1) {
    throw new CliError(2, 'BAD_INPUT', '--qty must be a positive integer.');
  }

  const data = await dispatch<CartAddArgs, CartAddResult>(
    'cart-add',
    { offerId: opts.offerId, skuId: opts.sku, quantity: qty },
    { headed: opts.headed, profile: opts.profile },
  );
  emit({
    human: () => {
      const a = data.added;
      process.stdout.write(
        `Added: ${a.productTitle.slice(0, 60)}\n` +
          `  cartId: ${a.cartId}\n` +
          `  spec:   ${a.skuTitle ?? '(none)'}\n` +
          `  qty:    ${a.quantity}×¥${a.unitPrice.toFixed(
            2,
          )} = ¥${a.amount.toFixed(2)}\n`,
      );
    },
    data,
  });
}
