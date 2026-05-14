import type { BrowserContext } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import {
  executeRaw as cartListExecute,
  type CartItem,
} from './cart-list.js';

export interface CartRemoveOpts {
  cartId: string;
  profile?: string;
  headed?: boolean;
}

export interface CartRemoveArgs {
  cartId: string;
  headed?: boolean;
}

export interface CartRemoveResult {
  ok: boolean;
  removed: CartItem;
}

export async function execute(
  ctx: BrowserContext,
  args: CartRemoveArgs,
): Promise<CartRemoveResult> {
  if (!/^\d+$/.test(args.cartId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid cartId: ${args.cartId}`);
  }

  return withRecovery(
    ctx,
    { cmd: 'cart-remove', args },
    () => executeCartRemove(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

async function executeCartRemove(
  ctx: BrowserContext,
  args: CartRemoveArgs,
): Promise<CartRemoveResult> {
  // 1. Locate the target item in the current cart.
  info('Looking up cart item...');
  const before = await cartListExecute(ctx);
  const target = before.items.find((i) => i.cartId === args.cartId);
  if (!target) {
    throw new CliError(
      12,
      'CART_ITEM_NOT_FOUND',
      `Cart item ${args.cartId} not found. Run \`1688 cart list\` to see current items.`,
    );
  }

  // 2. Open cart page; check the matching row; click bulk-delete; confirm.
  //    NOTE: cart-remove stays on UI replay because the underlying API
  //    (mtop.1688.buycenter.MtopPurchaseAstoreService.async) uses 1688's
  //    compressed linkage protocol — payload is gzip+base64-encoded inside
  //    `queryParams`. Hijacking it would require decoding/re-encoding the
  //    linkage protocol (non-trivial), so we keep the UI flow that works.
  info(`Removing "${target.productTitle.slice(0, 30)}"...`);
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
    // Wait for cart items to render.
    try {
      await page.waitForSelector('input[type="checkbox"].next-checkbox-input', {
        timeout: 15000,
      });
    } catch {
      throw new CliError(
        11,
        'CART_NOT_LOADED',
        'Cart page did not finish loading.',
      );
    }
    // Slight pause for async hydration of item rows.
    await new Promise((r) => setTimeout(r, 1500));

    // Click the checkbox of the SKU-specific row (use skuTitle to disambiguate
    // multiple variants of the same product, which share productTitle).
    const titleHint = target.productTitle.slice(0, 12);
    const skuHint = target.skuTitle?.trim() ?? null;
    const clicked = await page.evaluate(
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
              const wasChecked = aria?.getAttribute('aria-checked') === 'true';
              if (!wasChecked) cb.click();
              return { ok: true, alreadyChecked: wasChecked };
            }
          }
        }
        return { ok: false, reason: 'row-not-found' };
      },
      { titleHint, skuHint },
    );
    if (!clicked.ok) {
      throw new CliError(
        14,
        'UI_ELEMENT_NOT_FOUND',
        `Could not locate cart row for "${target.productTitle}": ${clicked.reason}`,
      );
    }

    // Give server time to ack the selection.
    await new Promise((r) => setTimeout(r, 2000));

    // Click the bulk "删除" button at the cart footer.
    await page
      .locator('button:has-text("删除")')
      .first()
      .click({ force: true, timeout: 5000 });

    // Confirm dialog.
    await new Promise((r) => setTimeout(r, 1500));
    const confirmed = await page
      .locator(
        'div[class*="next-dialog"] button.next-btn-primary:visible, ' +
          '[role="dialog"] button:has-text("确认"):visible, ' +
          '[role="dialog"] button:has-text("确定"):visible',
      )
      .first()
      .click({ force: true, timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) {
      throw new CliError(
        15,
        'CONFIRM_FAILED',
        'Delete confirmation dialog not found or not clickable.',
      );
    }
    // Allow the server to process.
    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    await page.close().catch(() => {});
  }

  // 3. Verify removal by re-fetching cart.
  const after = await cartListExecute(ctx);
  if (after.items.some((i) => i.cartId === args.cartId)) {
    throw new CliError(
      16,
      'REMOVE_NOT_REFLECTED',
      'Item still present after delete. The UI flow may have failed silently.',
    );
  }
  return { ok: true, removed: target };
}

export async function run(opts: CartRemoveOpts): Promise<void> {
  if (!opts.cartId) {
    throw new CliError(2, 'BAD_INPUT', 'cartId required.');
  }
  const data = await dispatch<CartRemoveArgs, CartRemoveResult>(
    'cart-remove',
    { cartId: opts.cartId, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );
  emit({
    human: () => {
      process.stdout.write(
        `Removed: ${data.removed.productTitle.slice(0, 60)}\n` +
          `  cartId: ${data.removed.cartId}\n` +
          `  was:    ${data.removed.quantity}×¥${data.removed.unitPrice.toFixed(
            2,
          )} = ¥${data.removed.amount.toFixed(2)}\n`,
      );
    },
    data,
  });
}
