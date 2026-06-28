import React from 'react';

export type ProgressOfferCardStatus =
  | 'waiting'
  | 'collecting'
  | 'basic-ready'
  | 'deep-collecting'
  | 'deep-success'
  | 'deep-failed'
  | 'failed';

export interface ProgressOfferCardItem {
  slotIndex: number;
  offerId?: string;
  title?: string;
  price?: string;
  image?: string;
  status: ProgressOfferCardStatus;
  message?: string;
  code?: string;
  attempts?: number;
  pendingDeep?: boolean;
  raw?: unknown;
}

interface Props {
  item: ProgressOfferCardItem;
  onOpen?: (item: ProgressOfferCardItem) => void;
  onOzon?: (item: ProgressOfferCardItem) => void;
  selected?: boolean;
  onSelectToggle?: (item: ProgressOfferCardItem) => void;
}

const overlayLabel: Record<string, string> = {
  'basic-ready': '等待深度采集',
  'collecting': '正在采集',
  'deep-collecting': '正在进行深度采集',
  'deep-failed': '深度采集失败',
  'failed': '采集失败',
};

const overlayDetail: Record<string, string> = {
  'basic-ready': '系统将采集 SKU、属性、详情图',
  'collecting': '正在读取 1688 商品信息',
  'deep-collecting': 'SKU / 属性 / 详情图采集中',
  'deep-failed': '页面被验证码拦截或详情异常',
  'failed': '页面被验证码拦截或详情异常',
};

function extractSearchPriceText(base: Record<string, unknown>): string {
  const price = base.price as Record<string, unknown> | undefined;
  if (price?.text) return String(price.text);
  if (price?.min != null && price?.max != null && Number(price.min) !== Number(price.max))
    return `¥${price.min}-¥${price.max}`;
  if (price?.min != null) return `¥${price.min}`;
  if (base.priceText) return String(base.priceText);
  return '';
}

interface ToCardsOpts {
  isDeepPro?: boolean;
}

export function toProgressCards(
  total: number,
  baseOffers: Array<Record<string, unknown>>,
  deepMap: Map<string, unknown>,
  deepFailures: Array<{ offerId?: unknown; code?: unknown; message?: unknown; attempts?: unknown }>,
  opts: ToCardsOpts = {},
): ProgressOfferCardItem[] {
  const { isDeepPro = false } = opts;
  const failMap = new Map<string, typeof deepFailures[number]>();
  for (const f of deepFailures) failMap.set(String(f.offerId ?? ''), f);

  return Array.from({ length: total }, (_, i) => {
    const base = baseOffers[i] || {};
    const oid = String(base.offerId ?? '');
    const deep = deepMap.get(oid) as Record<string, unknown> | undefined;
    const fail = failMap.get(oid);

    // Deep success — merged
    if (deep) {
      return {
        slotIndex: i,
        offerId: oid,
        title: String(deep.title || base.title || ''),
        price: String(deep.priceRange || deep.priceText || extractSearchPriceText(base)),
        image: String(deep.mainImage || (deep.images as string[])?.[0] || base.image || ''),
        status: 'deep-success' as const,
        raw: deep,
      };
    }
    // Deep failure
    if (fail) {
      return {
        slotIndex: i,
        offerId: oid,
        title: String(base.title || ''),
        price: extractSearchPriceText(base),
        image: String(base.image || ''),
        status: 'deep-failed' as const,
        message: String(fail.message || ''),
        code: String(fail.code || ''),
        attempts: Number(fail.attempts || 0),
        raw: base,
      };
    }
    // Base search has data — show card immediately with overlay
    if (oid && base.title) {
      return {
        slotIndex: i,
        offerId: oid,
        title: String(base.title || ''),
        price: extractSearchPriceText(base),
        image: String(base.image || ''),
        status: 'basic-ready',
        pendingDeep: isDeepPro,
        raw: base,
      };
    }
    return { slotIndex: i, status: 'waiting' as const };
  });
}

function failureReasonZh(code: string, fallback?: string): string {
  const map: Record<string, string> = {
    CAPTCHA_INTERCEPTION: '页面被验证码拦截',
    RISK_OR_CAPTCHA_TITLE: '页面疑似风控或验证码拦截',
    MISSING_TITLE: '商品标题缺失',
    MISSING_PRICE: '商品价格缺失',
    MISSING_IMAGES: '商品图片缺失',
    EMPTY_OFFER_RESULT: '页面返回为空',
    INVALID_DEEP_OFFER: '深度采集结果不完整',
    JSON_PARSE_FAILED: '结果解析失败',
  };
  return map[code] || fallback || code || '采集失败';
}

export default function ProgressOfferCard({ item, onOpen, onOzon, selected, onSelectToggle }: Props) {
  const showImage = Boolean(item.image);
  const hasOverlay = (item.status === 'basic-ready' && item.pendingDeep === true) || item.status === 'collecting' || item.status === 'deep-collecting' || item.status === 'deep-failed' || item.status === 'failed';
  const isFailed = item.status === 'deep-failed' || item.status === 'failed';
  const isClickable = Boolean(item.offerId || item.raw || item.title || item.image);
  const canSelect = isClickable || item.status !== 'waiting';

  return (
    <article
      className={`progress-offer-card card-status-${item.status} ${selected ? 'selected' : ''}`}
      onClick={() => { if (isClickable) onOpen?.(item); }}
      title={item.title || item.offerId || ''}
    >
      <button
        type="button"
        className={`progress-card-check ${selected ? 'checked' : ''}`}
        disabled={!canSelect}
        aria-label={selected ? '取消选择商品' : '选择商品'}
        onClick={(event) => {
          event.stopPropagation();
          if (canSelect) onSelectToggle?.(item);
        }}
      >
        {selected && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </button>
      {/* Image area 1:1 with optional overlay */}
      <div className="progress-card-image-wrap">
        {showImage ? (
          <img src={item.image} alt={item.title || ''} className="progress-card-img" loading="lazy" />
        ) : (
          <div className="progress-image-skeleton" />
        )}

        {hasOverlay && (
          <div className={`progress-card-overlay ${isFailed ? 'failed' : ''}`}>
            <div className="progress-card-overlay-inner">
              {(item.status === 'deep-collecting' || item.status === 'collecting') && <div className="progress-card-spinner" />}
              {isFailed && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.7)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                </svg>
              )}
              <p className="overlay-title">{overlayLabel[item.status] || item.status}</p>
              {isFailed && item.message ? (
                <p className="overlay-detail">{failureReasonZh(item.code || '', item.message)}</p>
              ) : (
                <p className="overlay-detail">{overlayDetail[item.status] || ''}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="progress-card-body">
        <p className="progress-card-title">{item.title || '加载中...'}</p>
        {item.price && <p className="progress-card-price">{item.price}</p>}
        <button
          className="progress-card-ozon-btn"
          disabled={!isClickable}
          onClick={(e) => {
            e.stopPropagation();
            if (isClickable) onOzon?.(item);
          }}
        >
          {item.status === 'deep-success' ? '上架至 Ozon' : 'Ozon 草稿'}
        </button>
      </div>
    </article>
  );
}
