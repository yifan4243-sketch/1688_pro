import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressCardToOzonRows } from '../apps/desktop/renderer/src/services/ozon-source-adapter';

const require = createRequire(import.meta.url);
const {
  DEFAULT_PRICING_SETTINGS,
  buildPricingSummary,
  calculateSkuPrice,
  pricingData,
  resolveRfbsCommission,
  validatePricingSettings,
} = require('../apps/desktop/ozon-pricing.cjs') as Record<string, any>;
const { resolveRussianCategoryPathForPricing, stableOfferId } = require('../apps/desktop/ozon-draft.cjs') as {
  resolveRussianCategoryPathForPricing: (settings: Record<string, unknown>, category: Record<string, unknown>) => Promise<Record<string, any>>;
  stableOfferId: (row: Record<string, unknown>, index: number, rows: Array<Record<string, unknown>>) => string;
};

const MOUSEPAD_PATH = 'Электроника / Устройства ручного ввода / Аксессуары для клавиатуры, мыши';

function price(overrides: Record<string, unknown> = {}) {
  return calculateSkuPrice({
    settings: DEFAULT_PRICING_SETTINGS,
    purchaseCostCny: 20,
    weightG: 200,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 10,
    commissionRate: 0.5,
    ...overrides,
  });
}

describe('Ozon RFBS pricing data', () => {
  it('ships all 9308 unique exact Russian paths with non-empty RFBS rates', () => {
    const rows = pricingData.commission.rows as Array<Record<string, any>>;
    expect(rows).toHaveLength(9308);
    expect(new Set(rows.map((row) => row.match_key)).size).toBe(9308);
    expect(rows.every((row) => Number.isFinite(row.rfbs_rate) && row.rfbs_rate > 0)).toBe(true);
    expect(pricingData.cel.groups).toHaveLength(6);
    expect(pricingData.cel.rates).toHaveLength(18);
  });

  it('matches the mousepad category exactly at 50% RFBS', () => {
    expect(resolveRfbsCommission(MOUSEPAD_PATH)).toMatchObject({
      ok: true,
      rate: 0.5,
      sourceRow: 8184,
    });
  });

  it('never falls back to a duplicated leaf category name', () => {
    expect(resolveRfbsCommission('Светоотражатель')).toMatchObject({
      ok: false,
      code: 'commission_category_path_incomplete',
    });
    expect(resolveRfbsCommission('Автотовары / Автоаксессуары / Светоотражатель').rate).toBe(0.5);
    expect(resolveRfbsCommission('Детские товары / Безопасность ребенка / Светоотражатель').rate).toBe(0.55);
  });

  it('blocks a non-unique Russian path for the same Ozon category IDs', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ozon-pricing-ambiguous-'));
    try {
      const categoryDir = path.join(userDataPath, 'categories');
      await fs.mkdir(categoryDir, { recursive: true });
      await fs.writeFile(path.join(categoryDir, 'ozon_category_tree.ru.json'), JSON.stringify({
        result: [
          {
            description_category_id: 99,
            category_name: 'Автотовары',
            children: [{ description_category_id: 99, category_name: 'Автоаксессуары', children: [{ description_category_id: 99, type_id: 77, type_name: 'Светоотражатель' }] }],
          },
          {
            description_category_id: 99,
            category_name: 'Детские товары',
            children: [{ description_category_id: 99, category_name: 'Безопасность ребенка', children: [{ description_category_id: 99, type_id: 77, type_name: 'Светоотражатель' }] }],
          },
        ],
      }), 'utf8');

      const result = await resolveRussianCategoryPathForPricing(
        { userDataPath },
        { description_category_id: 99, type_id: 77 },
      );
      expect(result).toMatchObject({ path: '', error: { code: 'commission_category_ambiguous' } });
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });
});

describe('Ozon CEL price solver', () => {
  it('reproduces the fixed mousepad example with at least 20% purchase-cost profit', () => {
    const result = price();
    expect(result).toMatchObject({ ok: true, group: 'Extra Small', shippingCny: 7.4, finalPriceCny: 85.65 });
    expect(result.achievedProfitRate).toBeGreaterThanOrEqual(0.2);
  });

  it.each([
    ['Extra Small', 20, 200, 0.5],
    ['Budget', 20, 1000, 0.1],
    ['Small', 100, 1000, 0.2],
    ['Big', 100, 3000, 0.2],
    ['Premium Small', 500, 1000, 0.2],
    ['Premium Big', 500, 6000, 0.2],
  ])('resolves the %s CEL group by physical weight, dimensions and consistent price band', (group, purchaseCostCny, weightG, commissionRate) => {
    const result = price({ purchaseCostCny, weightG, commissionRate, lengthCm: 20, widthCm: 20, heightCm: 10 });
    expect(result.ok, result.reason).toBe(true);
    expect(result.group).toBe(group);
  });

  it.each(['express', 'standard', 'economy'])('uses the selected %s speed rate', (shippingSpeed) => {
    const result = price({ settings: { ...DEFAULT_PRICING_SETTINGS, shippingSpeed } });
    expect(result.ok, result.reason).toBe(true);
    expect(result.shippingCny).toBeGreaterThan(0);
  });

  it('supports door rates only where the source table defines them', () => {
    expect(price({ settings: { ...DEFAULT_PRICING_SETTINGS, handoffMode: 'door' } })).toMatchObject({
      ok: false,
      code: 'shipping_rate_unavailable',
    });
    const small = price({
      purchaseCostCny: 100,
      weightG: 1000,
      commissionRate: 0.2,
      settings: { ...DEFAULT_PRICING_SETTINGS, handoffMode: 'door' },
    });
    expect(small).toMatchObject({ ok: true, group: 'Small' });
  });

  it('fails closed for missing package data and invalid rate totals', () => {
    expect(price({ weightG: 0 })).toMatchObject({ ok: false, code: 'missing_package_data' });
    expect(price({ settings: { ...DEFAULT_PRICING_SETTINGS, otherFeeRate: 0.6 } })).toMatchObject({
      ok: false,
      code: 'invalid_variable_rate',
    });
    expect(validatePricingSettings({ ...DEFAULT_PRICING_SETTINGS, otherFeeRate: 1 })).not.toHaveLength(0);
  });

  it('sets every item price to zero when currency or commission matching blocks pricing', () => {
    for (const [currencyCode, path] of [['RUB', MOUSEPAD_PATH], ['CNY', '错误 / 类目 / 路径']]) {
      const items = [{ offer_id: '123', weight: 200, depth: 200, width: 200, height: 100, price: '20' }];
      const summary = buildPricingSummary({
        settings: DEFAULT_PRICING_SETTINGS,
        currencyCode,
        category: { description_category_id: 18262715, type_id: 96808, path: '电子 / 输入 / 鼠标垫' },
        russianCategoryPath: path,
        rows: [{ sku_price: '20', source_sku_ordinal: 1 }],
        items,
      });
      expect(summary.status).toBe('unresolved');
      expect(items[0].price).toBe('0');
      expect(summary.errors.length).toBeGreaterThan(0);
    }
  });

  it('prices each SKU from its own purchase price and package data', () => {
    const items = [
      { offer_id: '1688-1', weight: 200, depth: 200, width: 200, height: 100, price: '0' },
      { offer_id: '1688-2', weight: 1000, depth: 200, width: 200, height: 100, price: '0' },
    ];
    const summary = buildPricingSummary({
      settings: { ...DEFAULT_PRICING_SETTINGS, otherFeeRate: 0.05 },
      currencyCode: 'CNY',
      category: { description_category_id: 18262715, type_id: 96808 },
      russianCategoryPath: MOUSEPAD_PATH,
      rows: [{ sku_price: '20' }, { sku_price: '100' }],
      items,
    });
    expect(summary.status).toBe('priced');
    expect(summary.items).toHaveLength(2);
    expect(summary.items[0].purchaseCostCny).toBe(20);
    expect(summary.items[1].purchaseCostCny).toBe(100);
    expect(Number(items[1].price)).toBeGreaterThan(Number(items[0].price));
  });
});

describe('Ozon offer IDs', () => {
  it('uses the source Offer ID for a single SKU', () => {
    const rows = [{ offer_id: '16880001', source_sku_count: 1 }];
    expect(stableOfferId(rows[0], 0, rows)).toBe('16880001');
  });

  it('keeps original SKU ordinals when only a subset is selected', () => {
    const rows = [
      { offer_id: '16880001', source_sku_count: 4, source_sku_ordinal: 2 },
      { offer_id: '16880001', source_sku_count: 4, source_sku_ordinal: 4 },
    ];
    expect(rows.map((row, index) => stableOfferId(row, index, rows))).toEqual(['16880001-2', '16880001-4']);
  });

  it('preserves the original 1688 SKU ordinal before filtering selected SKUs', () => {
    const selected = new Set(['sku-b', 'sku-d']);
    const rows = progressCardToOzonRows({
      offerId: '16880001',
      title: '测试商品',
      image: 'https://example.com/main.jpg',
      price: '20',
      _selectedSkuIds: selected,
      raw: {
        offerId: '16880001',
        skus: [
          { skuId: 'sku-a', specs: 'A', price: '20' },
          { skuId: 'sku-b', specs: 'B', price: '21' },
          { skuId: 'sku-c', specs: 'C', price: '22' },
          { skuId: 'sku-d', specs: 'D', price: '23' },
        ],
      },
    } as any);
    expect(rows.map((row) => [row.sku_id, row.source_sku_ordinal, row.source_sku_count])).toEqual([
      ['sku-b', 2, 4],
      ['sku-d', 4, 4],
    ]);
  });
});
