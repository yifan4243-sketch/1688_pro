import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  collectDraftMissing,
  submitOzonDraft,
} = require('../apps/desktop/ozon-draft.cjs') as {
  collectDraftMissing: (items: Array<Record<string, unknown>>, draft?: Record<string, unknown>) => string[];
  submitOzonDraft: (
    settings: Record<string, any>,
    draft: Record<string, any>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

const settings = {
  ozon: {
    clientId: 'client',
    apiKey: 'key',
    currencyCode: 'CNY',
    defaultWarehouseId: '12345',
  },
};

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Russian product title',
    offer_id: 'offer-1',
    price: '100',
    old_price: '0',
    vat: '0',
    currency_code: 'CNY',
    description_category_id: 1700,
    type_id: 9300,
    primary_image: 'https://example.com/1.jpg',
    images: ['https://example.com/1.jpg'],
    depth: 10,
    width: 8,
    height: 6,
    weight: 200,
    attributes: [{ id: 9048, values: [{ value: 'model' }] }],
    ...overrides,
  };
}

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    sourceRows: [{ sku_stock: 7 }],
    generated: {},
    items: [baseItem()],
    ...overrides,
  };
}

function endpointOf(call: unknown[]) {
  return String(call[0]).replace('https://api-seller.ozon.ru', '');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ozon draft submit helper', () => {
  it('imports product, polls task_id, then updates price and stock', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response)
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: [] }) as Response);

    const result = await submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 });

    expect(result.importStatus).toBe('listing_ready');
    expect(result.taskId).toBe('8844');
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
      '/v1/description-category/attribute',
      '/v3/product/import',
      '/v1/product/import/info',
      '/v1/product/import/prices',
      '/v2/products/stocks',
    ]);
  });

  it('returns pending when import info does not finish in time', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValue(ok({ result: { items: [{ offer_id: 'offer-1', status: 'processing' }] } }) as Response);

    const result = await submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0, pollAttempts: 2 });

    expect(result.importStatus).toBe('pending');
    expect(result.warnings).toContain('Ozon 导入结果仍在处理中，尚未执行价格和库存更新。');
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
      '/v1/description-category/attribute',
      '/v3/product/import',
      '/v1/product/import/info',
      '/v1/product/import/info',
    ]);
  });

  it('rejects failed import info instead of reporting success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'failed', errors: [{ message: 'bad category' }] }] } }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/Ozon 导入失败.*bad category/);
  });

  it('rejects price update errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response)
      .mockResolvedValueOnce(ok({ result: { errors: [{ message: 'bad price' }] } }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/价格更新失败.*bad price/);
  });

  it('skips stock update and warns when stock exists but warehouse is missing', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response)
      .mockResolvedValueOnce(ok({ result: [] }) as Response);

    const result = await submitOzonDraft(
      { ozon: { ...settings.ozon, defaultWarehouseId: '' } },
      baseDraft(),
      { pollDelayMs: 0 },
    );

    expect(result.importStatus).toBe('imported');
    expect(result.warnings).toContain('库存待配置：未设置 Ozon 仓库 ID，已跳过库存更新。');
    expect(fetchMock.mock.calls.map(endpointOf)).not.toContain('/v2/products/stocks');
  });

  it('blocks submit when required category attributes are absent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({
      result: [{ id: 85, name: '品牌', is_required: true }],
    }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/草稿缺少类目必填属性：品牌/);
  });

  it('marks multi-sku drafts as manual when variant mapping is not confirmed', () => {
    const missing = collectDraftMissing([baseItem(), baseItem({ offer_id: 'offer-2' })], {
      sourceRows: [{}, {}],
      generated: {},
    });

    expect(missing).toContain('规格属性映射');
  });
});
