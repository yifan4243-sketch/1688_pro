import type { Page } from 'playwright';
import { CliError } from '../io/errors.js';
import type { CartItem } from '../commands/cart-list.js';
import { clickStable } from './locator.js';

export async function waitForCartItems(page: Page, timeoutMs = 15000): Promise<void> {
  try {
    await page.waitForSelector('input[type="checkbox"].next-checkbox-input', {
      timeout: timeoutMs,
    });
  } catch {
    throw new CliError(11, 'CART_NOT_LOADED', 'Cart page did not load.');
  }
}

export async function uncheckAllCartRows(page: Page): Promise<void> {
  await page.evaluate(() => {
    const wrappers = Array.from(
      document.querySelectorAll<HTMLElement>('.next-checkbox-wrapper'),
    );
    for (const wrapper of wrappers) {
      const aria = wrapper.querySelector('[aria-checked]');
      if (aria?.getAttribute('aria-checked') === 'true') {
        wrapper.click();
      }
    }
  });
}

export async function clickCartRowCheckbox(
  page: Page,
  item: Pick<CartItem, 'productTitle' | 'skuTitle' | 'cartId'>,
): Promise<void> {
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
      for (const candidate of candidates) {
        let row: HTMLElement | null = candidate;
        for (let depth = 0; depth < 10 && row; depth++) {
          row = row.parentElement;
          if (!row) break;
          const text = row.textContent ?? '';
          if (!text.includes(titleHint)) continue;
          const checkbox = row.querySelector<HTMLElement>('.next-checkbox-wrapper');
          if (checkbox) {
            const aria = checkbox.querySelector('[aria-checked]');
            const checked = aria?.getAttribute('aria-checked') === 'true';
            if (!checked) checkbox.click();
            return { ok: true, checked };
          }
        }
      }
      return { ok: false, reason: 'row-not-found' };
    },
    {
      titleHint: item.productTitle.slice(0, 12),
      skuHint: item.skuTitle?.trim() ?? null,
    },
  );

  if (!result.ok) {
    throw new CliError(
      14,
      'STABLE_LOCATOR_NOT_FOUND',
      `Could not locate cart row checkbox for cartId ${item.cartId}.`,
      {
        category: 'locator',
        locatorDescription: 'cart row checkbox',
        locatorStrategies: [
          'skuTitle text within nearest row containing productTitle',
          'productTitle text within nearest row containing checkbox',
        ],
        cartId: item.cartId,
        productTitle: item.productTitle,
        skuTitle: item.skuTitle,
        currentUrl: page.url(),
        retryable: true,
      },
    );
  }
}

export async function clickCartDeleteButton(page: Page): Promise<void> {
  await clickStable(
    page,
    [
      { kind: 'role', role: 'button', name: /^删除$/ },
      { kind: 'css', selector: 'button:has-text("删除"):not([disabled])' },
      { kind: 'text', text: /^删除$/ },
    ],
    {
      description: 'cart delete button',
      timeoutMs: 5000,
    },
  );
}

export async function clickConfirmDialogButton(page: Page): Promise<void> {
  await clickStable(
    page,
    [
      { kind: 'role', role: 'button', name: /确认|确定|确认加入|加入采购车/ },
      { kind: 'css', selector: '[role="dialog"] button:has-text("确认"):visible' },
      { kind: 'css', selector: '[role="dialog"] button:has-text("确定"):visible' },
      { kind: 'css', selector: 'div[class*="dialog"] button.next-btn-primary:visible' },
    ],
    {
      description: 'confirmation dialog primary button',
      timeoutMs: 5000,
    },
  );
}

export async function clickCartCheckoutButton(page: Page): Promise<void> {
  await clickStable(
    page,
    [
      { kind: 'role', role: 'button', name: /^结算$/ },
      { kind: 'css', selector: 'button:has-text("结算"):not([disabled])' },
      { kind: 'text', text: /^结算$/ },
    ],
    {
      description: 'cart checkout button',
      timeoutMs: 5000,
    },
  );
}

export async function waitForAnyCartRowChecked(page: Page): Promise<void> {
  const checked = await page
    .waitForFunction(
      () => {
        const wrappers = Array.from(
          document.querySelectorAll<HTMLElement>('.next-checkbox-wrapper'),
        );
        return wrappers.some((wrapper) => {
          const aria = wrapper.querySelector('[aria-checked]');
          return aria?.getAttribute('aria-checked') === 'true';
        });
      },
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!checked) {
    throw new CliError(
      14,
      'STABLE_LOCATOR_NOT_FOUND',
      'Target cart item did not register as selected.',
      {
        category: 'locator',
        locatorDescription: 'checked cart row',
        locatorStrategies: ['any .next-checkbox-wrapper [aria-checked=true]'],
        currentUrl: page.url(),
        retryable: true,
      },
    );
  }
}
