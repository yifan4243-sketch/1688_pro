// Lightweight adapter: raw search/offer JSON → UI-friendly card view models.

export interface OfferCardViewModel {
  offerId: string;
  title: string;
  imageUrl: string | null;
  priceText: string;
  priceMin: number | null;
  priceMax: number | null;
  supplierName: string | null;
  supplierYears: number | null;
  shopUrl: string | null;
  province: string | null;
  city: string | null;
  verifiedTags: string[];
  tags: string[];
  turnover: string | null;
  url: string;
  raw: Record<string, unknown>;
}

/** Best-effort image URL from an offer-like object. */
export function getOfferImage(raw: Record<string, unknown>): string | null {
  const img = raw.image || raw.mainImage || raw.imageUrl || raw.img || raw.picUrl || raw.photo || raw.thumb;
  if (typeof img === 'string' && img.length > 0) return img;
  const gallery = raw.gallery || raw.images;
  if (Array.isArray(gallery) && gallery.length > 0) {
    const first = gallery[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first !== null) {
      return (first as Record<string, unknown>).url as string ||
             (first as Record<string, unknown>).src as string || null;
    }
  }
  return null;
}

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  return null;
}

function priceText(raw: Record<string, unknown>): string {
  const p = raw.price as Record<string, unknown> | undefined;
  if (p?.text) return str(p.text);
  const priceRange = raw.priceRange;
  if (typeof priceRange === 'string') return priceRange;
  const min = num(raw.priceMin ?? p?.min);
  const max = num(raw.priceMax ?? p?.max);
  if (min !== null && max !== null && min !== max) return `¥${min} - ¥${max}`;
  if (min !== null) return `¥${min}`;
  if (max !== null) return `¥${max}`;
  return '';
}

const VI_KEYS: Record<string, string> = { factory: '工厂', business: '商家', superFactory: '超级工厂' };

function verifiedTags(raw: Record<string, unknown>): string[] {
  const v = raw.verified as Record<string, boolean | string> | undefined;
  if (!v) return [];
  return Object.entries(VI_KEYS).filter(([k]) => v[k] === true || v[k] === 'true').map(([, label]) => label);
}

function supplier(raw: Record<string, unknown>) {
  const s = raw.supplier as Record<string, unknown> | undefined;
  return {
    name: str(s?.name) || null,
    shopUrl: str(s?.shopUrl) || null,
    years: num(s?.years),
  };
}

function location(raw: Record<string, unknown>) {
  const loc = raw.location as Record<string, unknown> | undefined;
  return {
    province: str(loc?.province) || null,
    city: str(loc?.city) || null,
  };
}

function flatTags(raw: Record<string, unknown>): string[] {
  const t = raw.tags;
  if (Array.isArray(t)) return t.filter((v): v is string => typeof v === 'string');
  return [];
}

/** Convert a single raw offer-like object into a card view model. */
export function toOfferCard(raw: Record<string, unknown>): OfferCardViewModel {
  const sup = supplier(raw);
  const loc = location(raw);
  return {
    offerId: str(raw.offerId || raw.offer_id || raw.id),
    title: str(raw.title || raw.name || raw.subject, '未识别商品'),
    imageUrl: getOfferImage(raw),
    priceText: priceText(raw),
    priceMin: num(raw.priceMin ?? (raw.price as Record<string, unknown>)?.min),
    priceMax: num(raw.priceMax ?? (raw.price as Record<string, unknown>)?.max),
    supplierName: sup.name,
    supplierYears: sup.years,
    shopUrl: sup.shopUrl,
    province: loc.province,
    city: loc.city,
    verifiedTags: verifiedTags(raw),
    tags: flatTags(raw),
    turnover: str(raw.turnover) || null,
    url: str(raw.url || raw.detailUrl || `https://detail.1688.com/offer/${raw.offerId}.html`),
    raw,
  };
}

/** Given a command result JSON, extract offer card view models. */
export function toOfferCardViewModels(resultJson: unknown): OfferCardViewModel[] {
  if (!resultJson || typeof resultJson !== 'object') return [];
  const data = resultJson as Record<string, unknown>;

  // Direct offers array (search, similar, image-search)
  if (Array.isArray(data.offers)) {
    return data.offers.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null).map(toOfferCard);
  }

  // Single offer object (offer detail)
  if (data.offerId || data.title) {
    return [toOfferCard(data)];
  }

  // Research items
  if (Array.isArray(data.items)) {
    return data.items
      .map((item) => {
        if (typeof item !== 'object' || item === null) return null;
        const it = item as Record<string, unknown>;
        return toOfferCard((it.offer || it.summary || it.enriched || it) as Record<string, unknown>);
      })
      .filter((v): v is OfferCardViewModel => v !== null);
  }

  return [];
}

/** Detect whether a command result type should default to card mode. */
export function shouldDefaultCard(resultType: string | undefined): boolean {
  return resultType === 'products' || resultType === 'offers' || resultType === 'research' || resultType === 'comparison';
}
