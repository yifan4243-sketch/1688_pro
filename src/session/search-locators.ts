import type { Page } from 'playwright';

async function scrollToPagination(page: Page): Promise<void> {
  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); }).catch(() => {});
  await page.waitForTimeout(800).catch(() => {});
}

async function clickTargetPageItem(page: Page, targetPage: number): Promise<boolean> {
  return await page.evaluate((targetPage) => {
    const roots = Array.from(document.querySelectorAll(
      '.fui-paging-list.pagin-2024, .fui-paging-list, .pagination-container',
    ));
    for (const root of roots) {
      const items = Array.from(root.querySelectorAll('.fui-page-item'));
      const target = items.find((el) => {
        const text = (el.textContent || '').trim();
        const className = el.getAttribute('class') || '';
        return (
          text === String(targetPage) &&
          !className.includes('fui-current') &&
          !className.includes('disabled')
        );
      }) as HTMLElement | undefined;
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      const style = window.getComputedStyle(target);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    }
    return false;
  }, targetPage).catch(() => false);
}

const NEXT_PAGE_SELECTORS = [
  '.fui-paging-list.pagin-2024 .fui-arrow.fui-next:not(.fui-next-disabled)',
  '.fui-paging-list .fui-arrow.fui-next:not(.fui-next-disabled)',
  '.pagination-container .fui-arrow.fui-next:not(.fui-next-disabled)',
  '.fui-arrow.fui-next:not(.fui-next-disabled)',
  '.fui-next:not(.fui-next-disabled)',
  '[class*="next"]:not([class*="disabled"])',
];

async function clickNextArrow(page: Page): Promise<boolean> {
  for (const selector of NEXT_PAGE_SELECTORS) {
    const clicked = await page.evaluate((selector) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return false;
      const className = el.getAttribute('class') || '';
      if (className.includes('disabled')) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return true;
    }, selector).catch(() => false);
    if (clicked) { await page.waitForTimeout(1200).catch(() => {}); return true; }
  }
  return false;
}

export async function clickSearchNextPage(page: Page, targetPage?: number): Promise<boolean> {
  await scrollToPagination(page);
  if (targetPage && Number.isFinite(targetPage)) {
    const clickedTarget = await clickTargetPageItem(page, targetPage);
    if (clickedTarget) { await page.waitForTimeout(1200).catch(() => {}); return true; }
  }
  return await clickNextArrow(page);
}
