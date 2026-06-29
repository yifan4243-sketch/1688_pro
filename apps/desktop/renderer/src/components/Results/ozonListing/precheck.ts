import type { ProgressOfferCardItem } from '../ProgressOfferCard';

type Row = Record<string, unknown>;

const MISSING_FIELD_LABELS: Record<string, string> = {
  ai_api_key: 'AI Key',
  offer_id: 'Offer ID',
  detail_url: '1688 详情链接',
  product_title: '商品标题',
  main_image_url: '主图',
  sku_price: 'SKU 价格',
  length_cm: '长',
  width_cm: '宽',
  height_cm: '高',
  weight_g: '重量',
};

export type OzonPrecheckResult = {
  offerId: string;
  missingFields: string[];
  warnings: string[];
};

export function precheckProgressCardForOzon(item: ProgressOfferCardItem): OzonPrecheckResult {
  const raw = objectOf(item.raw);
  const offerId = text(raw.offerId) || text(raw.offer_id) || item.offerId || '';
  const title = text(raw.title) || text(raw.subject) || text(raw.name) || item.title || '';
  const image = text(raw.mainImage) || text(raw.image) || imageFromList(raw.images) || item.image || '';
  const price = text(raw.priceRange) || text(raw.priceText) || text(raw.priceMin) || item.price || '';
  const missingFields: string[] = [];
  const warnings: string[] = [];

  if (!offerId) missingFields.push('offer_id');
  if (!title) missingFields.push('product_title');
  if (!image) missingFields.push('main_image_url');
  if (!price) missingFields.push('sku_price');
  if (item.status !== 'deep-success') warnings.push('商品尚未深度采集');

  return {
    offerId,
    missingFields: unique(missingFields),
    warnings,
  };
}

export function collectRowMissingFields(rows: Array<Record<string, unknown>>): string[] {
  return unique(rows.flatMap((row) => {
    const missing = row.missing_fields;
    return Array.isArray(missing) ? missing.map(String).filter(Boolean) : [];
  }));
}

export function formatMissingFields(fields: string[]): string {
  return unique(fields)
    .map((field) => MISSING_FIELD_LABELS[field] || field)
    .join('、');
}

export function isAiKeyMissingMessage(message: string): boolean {
  return /api key|apikey|deepseek|ai key|未配置|密钥/i.test(message);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function objectOf(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function imageFromList(value: unknown): string {
  if (!Array.isArray(value)) return '';

  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim();

    const obj = objectOf(item);
    const url = text(obj.url) || text(obj.src) || text(obj.image);
    if (url) return url;
  }

  return '';
}
