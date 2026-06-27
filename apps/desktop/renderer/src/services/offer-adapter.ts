// Full card view model: merges result.offers + result.deeppro.offers by offerId.
// Gracefully degrades when deep info is absent.

export interface SkuViewModel {
  skuId: string | number | null;
  specs: string | null;
  price: number | null;
  stock: number | null;
  saleCount: number | null;
  image: string | null;
}

export interface PriceTier {
  minQty: number | null;
  price: number | null;
}

export interface OfferCardViewModel {
  offerId: string;
  title: string;
  url: string | null;

  imageUrl: string | null;
  images: string[];

  priceText: string;
  priceMin: number | null;
  priceMax: number | null;
  priceRange: string | null;
  unitName: string | null;
  minOrderQty: number | null;

  supplierName: string | null;
  supplierYears: number | null;
  supplierLoginId: string | null;
  shopUrl: string | null;

  province: string | null;
  city: string | null;

  turnover: string | null;
  orderCount: number | null;
  saledCount: number | null;
  repurchaseRateText: string | null;

  verifiedTags: string[];
  tags: string[];

  priceTiers: PriceTier[];

  skus: SkuViewModel[];
  skuCount: number;
  totalStock: number | null;

  attributes: Array<{ name: string; value: string }>;
  categoryId: string | null;

  freight: {
    receiveAddress: string | null;
    unitWeight: number | null;
    province: string | null;
    city: string | null;
  } | null;

  deepCollected: boolean;
}

// ── helpers ──

function s(v: unknown, fb = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fb;
}

function n(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : null; }
  return null;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ── image resolver ──

export function getOfferImage(raw: Record<string, unknown>): string | null {
  const img = raw.mainImage || raw.image || raw.imageUrl || raw.img || raw.picUrl || raw.photo || raw.thumb;
  if (typeof img === 'string' && img.length > 0) return img;
  const gallery = raw.images;
  if (Array.isArray(gallery) && gallery.length > 0) {
    const first = gallery[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first !== null) {
      return s((first as Record<string, unknown>).url) || s((first as Record<string, unknown>).src) || null;
    }
  }
  return null;
}

function imageList(raw: Record<string, unknown>): string[] {
  const imgs = raw.images;
  if (Array.isArray(imgs)) return imgs.filter((v): v is string => typeof v === 'string');
  return [];
}

// ── data extraction ──

const VI = { factory: '工厂', business: '商家', superFactory: '超级工厂' };

function verified(o: Record<string, unknown>): string[] {
  const v = obj(o.verified);
  if (!v) return [];
  return Object.entries(VI).filter(([k]) => v[k] === true).map(([, lb]) => lb);
}

function tags(o: Record<string, unknown>): string[] {
  return arr(o.tags).filter((v): v is string => typeof v === 'string');
}

function supplier(o: Record<string, unknown>) {
  const sup = obj(o.supplier);
  return {
    name: s(sup?.name) || null,
    years: n(sup?.years),
    loginId: s(sup?.loginId) || null,
    shopUrl: s(sup?.shopUrl) || null,
  };
}

function location(o: Record<string, unknown>) {
  const loc = obj(o.location);
  return { province: s(loc?.province) || null, city: s(loc?.city) || null };
}

function priceText(o: Record<string, unknown>): string {
  const pr = s(o.priceRange);
  if (pr) return pr;
  const pt = obj(o.price);
  if (pt?.text) return s(pt.text);
  const min = n(o.priceMin ?? pt?.min);
  const max = n(o.priceMax ?? pt?.max);
  if (min !== null && max !== null && min !== max) return `¥${min} - ¥${max}`;
  if (min !== null) return `¥${min}`;
  if (max !== null) return `¥${max}`;
  return '';
}

function skusFromDeep(deep: Record<string, unknown>): SkuViewModel[] {
  return arr(deep.skus).map((item) => {
    const sk = obj(item);
    return {
      skuId: sk?.skuId ?? null,
      specs: s(sk?.specs) || s(sk?.skuId) || null,
      price: n(sk?.price ?? sk?.multiPrice),
      stock: n(sk?.stock),
      saleCount: n(sk?.saleCount) ?? 0,
      image: s(sk?.image) || null,
    };
  });
}

function attributesFromDeep(deep: Record<string, unknown>) {
  return arr(deep.attributes).map((a) => {
    const at = obj(a);
    return { name: s(at?.name), value: s(at?.value) };
  }).filter((a) => a.name && a.value);
}

function priceTiersFromDeep(deep: Record<string, unknown>): PriceTier[] {
  return arr(deep.priceTiers).map((t) => {
    const tier = obj(t);
    return { minQty: n(tier?.minQty), price: n(tier?.price) };
  }).filter((t) => t.price !== null);
}

function sumStock(skus: SkuViewModel[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const sk of skus) {
    if (sk.stock !== null) { total += sk.stock; hasAny = true; }
  }
  return hasAny ? total : null;
}

// ── main merge function ──

/** Merge base search offers with deeppro deep offers by offerId. */
export function toOfferCardViewModels(resultJson: unknown): OfferCardViewModel[] {
  if (!resultJson || typeof resultJson !== 'object') return [];
  const root = resultJson as Record<string, unknown>;

  const baseOffers = arr(root.offers) as Record<string, unknown>[];
  const deepMap = new Map<string, Record<string, unknown>>();
  const deeppro = obj(root.deeppro);
  if (deeppro?.enabled) {
    for (const item of arr(deeppro.offers)) {
      const d = obj(item);
      if (d) deepMap.set(s(d.offerId) || s(d.offer_id), d);
    }
  }

  return baseOffers.map((base) => {
    const id = s(base.offerId) || s(base.offer_id);
    const deep = deepMap.get(id) || {};

    const deepObj = deep && Object.keys(deep).length > 0 ? deep : undefined;
    const deepCollected = !!deepObj;

    const sup = supplier(base);
    const deepSup = deepObj ? supplier(deepObj) : { name: null, years: null, loginId: null, shopUrl: null };
    const loc = location(base);
    const deepLoc = deepObj ? location(deepObj) : { province: null, city: null };
    const deepFreight = deepObj ? obj(deepObj.freight) : undefined;

    const mergedPriceText = deepObj ? (priceText(deepObj) || priceText(base)) : priceText(base);
    const mergedPriceMin = deepObj ? (n(deepObj.priceMin) ?? n(base.priceMin)) : n(base.priceMin);
    const mergedPriceMax = deepObj ? (n(deepObj.priceMax) ?? n(base.priceMax)) : n(base.priceMax);
    const mergedPriceRange = deepObj ? s(deepObj.priceRange) || null : null;
    const mergedUnitName = deepObj ? s(deepObj.unitName) || null : null;
    const mergedMinOrderQty = deepObj ? n(deepObj.minOrderQty) : null;
    const mergedSaledCount = deepObj ? n(deepObj.saledCount) : null;
    const mergedCategoryId = deepObj ? s(deepObj.categoryId) || null : null;

    const mergedImages = deepObj ? imageList(deepObj) : imageList(base);
    const mergedImageUrl = deepObj
      ? (s(deepObj.mainImage) || mergedImages[0] || getOfferImage(base))
      : getOfferImage(base);

    const skuList = deepObj ? skusFromDeep(deepObj) : [];
    const attrList = deepObj ? attributesFromDeep(deepObj) : [];
    const tiers = deepObj ? priceTiersFromDeep(deepObj) : [];

    return {
      offerId: id,
      title: s(base.title || deepObj?.title, '未识别商品'),
      url: s(base.url) || `https://detail.1688.com/offer/${id}.html`,

      imageUrl: mergedImageUrl,
      images: mergedImages,

      priceText: mergedPriceText || '—',
      priceMin: mergedPriceMin,
      priceMax: mergedPriceMax,
      priceRange: mergedPriceRange,
      unitName: mergedUnitName,
      minOrderQty: mergedMinOrderQty,

      supplierName: sup.name || deepSup.name,
      supplierYears: sup.years ?? deepSup.years,
      supplierLoginId: deepSup.loginId || sup.loginId,
      shopUrl: sup.shopUrl || deepSup.shopUrl,

      province: loc.province || deepLoc.province,
      city: loc.city || deepLoc.city,

      turnover: s(base.turnover) || null,
      orderCount: n(obj(base.demand)?.orderCount),
      saledCount: mergedSaledCount,
      repurchaseRateText: s(obj(base.demand)?.repurchaseRateText) || null,

      verifiedTags: verified(base),
      tags: tags(base),

      priceTiers: tiers,

      skus: skuList,
      skuCount: skuList.length,
      totalStock: sumStock(skuList),

      attributes: attrList,
      categoryId: mergedCategoryId,

      freight: deepFreight ? {
        receiveAddress: s(deepFreight.receiveAddress) || null,
        unitWeight: n(deepFreight.unitWeight),
        province: s(deepFreight.province) || null,
        city: s(deepFreight.city) || null,
      } : null,

      deepCollected,
    };
  });
}

export function shouldDefaultCard(resultType: string | undefined): boolean {
  return resultType === 'products' || resultType === 'offers' || resultType === 'research' || resultType === 'comparison';
}
