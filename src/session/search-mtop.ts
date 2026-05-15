import { parseMtopJsonp } from './mtop.js';

export const SEARCH_MTOP_API = 'mtop.relationrecommend.wirelessrecommend.recommend';
export const SEARCH_APP_ID = '32517';

export interface Offer {
  offerId: string;
  title: string;
  price: { text: string; min: number | null; max: number | null };
  supplier: {
    name: string | null;
    shopUrl: string | null;
    years: number | null;
  };
  location: { province: string | null; city: string | null };
  bizType: string | null;
  verified: { factory: boolean; business: boolean; superFactory: boolean };
  tags: string[];
  isP4P: boolean;
  turnover: string | null;
  url: string;
  image: string | null;
}

export interface RawOfferItem {
  cellType?: string;
  data?: {
    offerId?: string;
    title?: string;
    priceInfo?: { price?: string };
    offerPicUrl?: string;
    loginId?: string;
    memberId?: string;
    province?: string;
    city?: string;
    bookedCount?: string;
    isP4P?: string;
    bizType?: string;
    factoryInspection?: string;
    businessInspection?: string;
    superFactory?: string;
    tags?: { text?: string }[];
    winPortUrl?: string;
    shop?: { text?: string; tpYear?: string };
    shopAddition?: { shopLinkUrl?: string };
  };
}

export interface SearchMtopRequestMeta {
  appId?: string;
  method?: string;
  beginPage?: number;
}

function bool(s?: string): boolean {
  return s === 'true';
}

export function mapOffer(item: RawOfferItem): Offer | null {
  const d = item.data;
  if (!d?.offerId) return null;
  const title = (d.title ?? '').replace(/<\/?font[^>]*>/g, '').trim();
  const priceRaw = d.priceInfo?.price;
  const price = priceRaw ? parseFloat(priceRaw) : null;
  const yearsRaw = d.shop?.tpYear;
  const years = yearsRaw ? parseInt(yearsRaw, 10) : null;
  const tags = (d.tags ?? [])
    .map((t) => t?.text?.trim() ?? '')
    .filter((s): s is string => !!s);
  return {
    offerId: d.offerId,
    title,
    price: {
      text: priceRaw ? `¥${priceRaw}` : '',
      min: price,
      max: price,
    },
    supplier: {
      name: d.shop?.text ?? null,
      shopUrl: d.shopAddition?.shopLinkUrl ?? d.winPortUrl ?? null,
      years,
    },
    location: {
      province: d.province ?? null,
      city: d.city ?? null,
    },
    bizType: d.bizType ?? null,
    verified: {
      factory: bool(d.factoryInspection),
      business: bool(d.businessInspection),
      superFactory: bool(d.superFactory),
    },
    tags,
    isP4P: bool(d.isP4P),
    turnover: d.bookedCount ?? null,
    url: `https://detail.1688.com/offer/${d.offerId}.html`,
    image: d.offerPicUrl ?? null,
  };
}

export function readSearchMtopRequestMeta(url: string): SearchMtopRequestMeta | null {
  if (!url.includes(SEARCH_MTOP_API)) return null;
  const dataParam = new URLSearchParams(new URL(url).search).get('data') ?? '';
  const dataObj = JSON.parse(dataParam) as {
    appId?: unknown;
    params?: string;
  };
  const params = JSON.parse(dataObj.params ?? '{}') as {
    method?: string;
    beginPage?: number | string;
  };
  const beginPage = params.beginPage === undefined ? undefined : Number(params.beginPage);
  return {
    appId: String(dataObj.appId),
    method: params.method,
    beginPage,
  };
}

export function parseOfferItemsFromMtopText(text: string): Offer[] {
  const json = parseMtopJsonp<{
    data?: { data?: { OFFER?: { items?: RawOfferItem[] } } };
  }>(text);
  const items = json?.data?.data?.OFFER?.items ?? [];
  return items.map(mapOffer).filter((o): o is Offer => o !== null);
}
