// Add to cart — Route B: hijack window.lib.mtop.request, click any 加采购车
// button, intercept the page's own addCargo call and rewrite the payload to
// our target specId + quantity.
//
// This sidesteps all SKU-selection UI (color buttons, size rows, qty inputs).
// 1688's anti-creep middleware passes because the click came from a real
// button (BX fingerprint was warmed during page interaction).
//
// Wall time: ~6s for ANY SKU layout — single-attr, multi-attr, hidden rows,
// new layouts 1688 may ship next month — all work identically.
import type { BrowserContext, Page } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import { sleep } from '../session/wait.js';
import { parseMtopJsonp } from '../session/mtop.js';
import {
  startResponseCapture,
  type ResponseCaptureDiagnostics,
} from '../session/response-capture.js';
import { clickConfirmDialogButton } from '../session/cart-locators.js';
import {
  clickAddCartButton,
  fillFirstSkuQuantityInput,
} from '../session/offer-locators.js';
import {
  executeRaw as cartListExecute,
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
  headed?: boolean;
}

export interface CartAddResult {
  ok: boolean;
  confirmationStatus: 'confirmed';
  added: CartItem;
  /** True when a brand-new cart row was created. False when the SKU was
   *  already in cart and quantity was merged into the existing row. */
  isNewRow: boolean;
  /** Actual quantity added by this call. For a new row it equals
   *  `added.quantity`; for a merged row it equals `after.qty - before.qty`. */
  addedQuantity: number;
}

const SKU_API_RE = /wosc\.queryofferskuselectormodel/i;

interface SkuInfo {
  skuId: string;
  specId: string;
  specAttrs: string;
  price: string;
  canBookCount: string;
}

interface SkuMapCaptureResult {
  skuMap: Map<string, SkuInfo>;
  responseCapture: ResponseCaptureDiagnostics;
}

async function captureSkuMap(
  page: Page,
  timeoutMs: number,
): Promise<SkuMapCaptureResult> {
  const capture = startResponseCapture<Map<string, SkuInfo>>({
    page,
    timeoutMs,
    matcher: SKU_API_RE,
    parse: async (resp) => {
      const json = parseMtopJsonp<{
        data?: {
          skuSelectorBizModel?: {
            skuInfoMap?: Record<
              string,
              {
                skuId?: string;
                specId?: string;
                specAttrs?: string;
                price?: string;
                canBookCount?: string;
              }
            >;
          };
        };
      }>(await resp.text());
      const raw = json?.data?.skuSelectorBizModel?.skuInfoMap;
      if (!raw) return null;
      const m = new Map<string, SkuInfo>();
      for (const [, v] of Object.entries(raw)) {
        if (v.skuId && v.specId) {
          m.set(v.skuId, {
            skuId: v.skuId,
            specId: v.specId,
            specAttrs: v.specAttrs ?? '',
            price: v.price ?? '',
            canBookCount: v.canBookCount ?? '',
          });
        }
      }
      return m.size > 0 ? m : null;
    },
  });
  return {
    skuMap: (await capture.wait()) ?? new Map(),
    responseCapture: capture.diagnostics(),
  };
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

  return withRecovery(
    ctx,
    { cmd: 'cart-add', args },
    () => executeCartAdd(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

async function executeCartAdd(
  ctx: BrowserContext,
  args: CartAddArgs,
): Promise<CartAddResult> {
  // Snapshot cart BEFORE add so we can diff to find the affected row reliably,
  // even when the same SKU was already in cart (server merges into the
  // existing row instead of creating a new cartId).
  info('Snapshotting cart...');
  const before = await cartListExecute(ctx);
  const beforeQty = new Map<string, number>();
  for (const it of before.items) beforeQty.set(it.cartId, it.quantity);

  const page = await ctx.newPage();

  // Install the hijack BEFORE any navigation. Polls until lib.mtop.request
  // shows up (it's loaded async), then wraps it. The wrapper detects the
  // addCargo call and rewrites goodsParams to our target SKU.
  await page.addInitScript(
    ([offerId, quantity]: [string, number]) => {
      const win = window as unknown as {
        lib?: {
          mtop?: {
            request?: (...args: unknown[]) => unknown;
            _bbPatched?: boolean;
          };
        };
        __bb1688Target__?: { specId: string; offerId: string; quantity: number };
        __bb1688AddCargoFired__?: boolean;
      };

      // Default target — execute() updates this once it has the specId.
      win.__bb1688Target__ = { specId: '', offerId, quantity };
      win.__bb1688AddCargoFired__ = false;

      function patch(): boolean {
        const mtop = win.lib?.mtop;
        if (!mtop?.request || mtop._bbPatched) return !!mtop?._bbPatched;
        const orig = mtop.request.bind(mtop);
        mtop.request = function (...args: unknown[]): unknown {
          const opts = args[0] as
            | {
                api?: string;
                data?: Record<string, unknown>;
              }
            | undefined;
          if (
            opts?.api?.includes('addCargo') ||
            opts?.api?.includes('MtopPurchaseService')
          ) {
            const target = win.__bb1688Target__;
            if (target && target.specId && opts.data) {
              opts.data.goodsParams = JSON.stringify([
                {
                  specId: target.specId,
                  offerId: Number(target.offerId),
                  quantity: target.quantity,
                  flow: 'general',
                  ext: { sceneCode: '' },
                  selectedTradeServices: [],
                },
              ]);
              win.__bb1688AddCargoFired__ = true;
            }
          }
          return orig(...args);
        };
        mtop._bbPatched = true;
        return true;
      }
      const iv = setInterval(() => {
        if (patch()) clearInterval(iv);
      }, 30);
      // Stop polling after 30s (mtop should be loaded well before).
      setTimeout(() => clearInterval(iv), 30000);
    },
    [args.offerId, args.quantity] as [string, number],
  );

  try {
    info(`Opening offer ${args.offerId}...`);
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

    // Look up the specId for the requested skuId by intercepting the SKU
    // mtop response, then push it into the page's hijack state.
    info('Resolving specId...');
    const { skuMap, responseCapture } = await captureSkuMap(page, 18000);
    if (skuMap.size === 0) {
      throw new CliError(
        11,
        'NO_SKU_DATA',
        'Could not capture SKU mapping (page may be risk-controlled).',
        {
          category: 'response_capture',
          retryable: true,
          responseCapture,
        },
      );
    }
    const sku = skuMap.get(args.skuId);
    if (!sku) {
      const available = Array.from(skuMap.keys()).slice(0, 5).join(', ');
      throw new CliError(
        12,
        'SKU_NOT_FOUND',
        `SKU ${args.skuId} not in offer ${args.offerId}.\n` +
          `Available (first 5): ${available}`,
      );
    }
    const stockN = parseInt(sku.canBookCount, 10);
    if (Number.isFinite(stockN) && args.quantity > stockN) {
      throw new CliError(
        2,
        'OUT_OF_STOCK',
        `Quantity ${args.quantity} > stock (${stockN}).`,
      );
    }

    // Update the in-page target so the hijack rewrites payload correctly.
    await page.evaluate(
      ([specId, quantity]: [string, number]) => {
        const w = window as unknown as {
          __bb1688Target__?: {
            specId: string;
            offerId: string;
            quantity: number;
          };
        };
        if (w.__bb1688Target__) {
          w.__bb1688Target__.specId = specId;
          w.__bb1688Target__.quantity = quantity;
        }
      },
      [sku.specId, args.quantity] as [string, number],
    );

    // Trigger condition: 1688 won't fire addCargo unless at least one qty
    // input has a positive value (otherwise the click shows a "请选择规格"
    // popup). Fill the FIRST visible qty input — our hijack will rewrite
    // the actual specId, so which input we fill doesn't matter.
    info('Setting trigger qty...');
    await fillFirstSkuQuantityInput(page, 1);
    await sleep(600);

    info('Clicking 加采购车...');

    // Listen for the addCargo response so we can detect success quickly.
    const addCargoCapture = startResponseCapture<{ ok: boolean; ret?: string[] }>({
      page,
      timeoutMs: 10000,
      matcher: /addcargo/i,
      parse: async (resp) => {
        const json = parseMtopJsonp<{ ret?: string[] }>(await resp.text());
        const ret = json?.ret ?? [];
        const ok =
          Array.isArray(ret) &&
          ret.length > 0 &&
          /SUCCESS/i.test(ret[0]!);
        return { ok, ret };
      },
    });

    const { response: addCargoResult, diagnostics: addCargoCaptureDiagnostics } =
      await addCargoCapture.waitForAction(async () => {
        await clickAddCartButton(page);

        await sleep(600);
        await clickConfirmDialogButton(page).catch(() => undefined);
      });

    // Also check that our hijack actually fired (sanity).
    const hijackFired = await page.evaluate(() => {
      const w = window as unknown as { __bb1688AddCargoFired__?: boolean };
      return w.__bb1688AddCargoFired__ === true;
    });

    if (process.env.BB1688_DEBUG === '1') {
      process.stderr.write(
        `[debug] hijackFired=${hijackFired} addCargoResult=${JSON.stringify(addCargoResult)}\n`,
      );
    }

    if (!hijackFired) {
      throw new CliError(
        17,
        'HIJACK_NOT_FIRED',
        'mtop.request hijack did not intercept addCargo. The page may use a different code path now.',
        { category: 'response_capture', responseCapture: addCargoCaptureDiagnostics },
      );
    }
    if (!addCargoResult) {
      throw new CliError(
        17,
        'ADD_AMBIGUOUS',
        'addCargo response was not captured, so the add-to-cart result could not be confirmed.',
        {
          category: 'response_capture',
          retryable: true,
          responseCapture: addCargoCaptureDiagnostics,
        },
      );
    }
    if (!addCargoResult.ok) {
      const r = addCargoResult.ret?.[0] ?? 'unknown';
      throw new CliError(17, 'ADD_FAILED', `addCargo failed: ${r}`, {
        responseCapture: addCargoCaptureDiagnostics,
      });
    }
  } finally {
    await page.close().catch(() => {});
  }

  // Diff before/after to locate the affected row.
  //   1. New cartId present in `after` but not in `before` → fresh row.
  //   2. Existing cartId with higher quantity in `after` → server merged
  //      into the pre-existing row (same offer + skuId already in cart).
  info('Verifying...');
  const after = await cartListExecute(ctx);

  let added: CartItem | undefined;
  let isNewRow = false;
  let addedQuantity = 0;

  // Restrict the search to this offerId+skuId for safety — concurrent edits
  // on other rows shouldn't confuse us.
  const matching = after.items.filter(
    (i) => i.offerId === args.offerId && i.skuId === args.skuId,
  );
  for (const it of matching) {
    const prevQty = beforeQty.get(it.cartId);
    if (prevQty === undefined) {
      // New cartId — fresh row.
      added = it;
      isNewRow = true;
      addedQuantity = it.quantity;
      break;
    }
    if (it.quantity > prevQty) {
      // Existing cartId, quantity grew — merged row.
      added = it;
      isNewRow = false;
      addedQuantity = it.quantity - prevQty;
      break;
    }
  }
  if (!added) {
    throw new CliError(
      17,
      'ADD_NOT_REFLECTED',
      'addCargo returned success but no new/grown row found in cart (cache lag?). Try `1688 cart list`.',
    );
  }
  return { ok: true, confirmationStatus: 'confirmed', added, isNewRow, addedQuantity };
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
    { offerId: opts.offerId, skuId: opts.sku, quantity: qty, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );
  emit({
    human: () => {
      const a = data.added;
      const verb = data.isNewRow
        ? 'Added (new row)'
        : `Merged (+${data.addedQuantity} into existing row)`;
      process.stdout.write(
        `${verb}: ${a.productTitle.slice(0, 60)}\n` +
          `  cartId: ${a.cartId}\n` +
          `  spec:   ${a.skuTitle ?? '(none)'}\n` +
          `  total:  ${a.quantity}×¥${a.unitPrice.toFixed(
            2,
          )} = ¥${a.amount.toFixed(2)}\n`,
      );
    },
    data,
  });
}
