import React from 'react';

export type ProgressOfferCardStatus =
  | 'waiting'
  | 'searching'
  | 'collecting'
  | 'success'
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
  durationText?: string;
  raw?: unknown;
}

interface Props {
  item: ProgressOfferCardItem;
  onOpen?: (item: ProgressOfferCardItem) => void;
}

const statusLabel: Record<ProgressOfferCardStatus, string> = {
  waiting: '等待采集',
  searching: '等待详情采集',
  collecting: '正在采集详情',
  success: '已完成',
  failed: '采集失败',
};

const statusChipClass: Record<ProgressOfferCardStatus, string> = {
  waiting: '',
  searching: 'neutral',
  collecting: 'neutral',
  success: '',
  failed: 'warn',
};

export function toProgressCards(
  total: number,
  baseOffers: Array<{ offerId?: unknown; title?: unknown; price?: unknown; image?: unknown }>,
  deepMap: Map<string, unknown>,
  failures: Array<{ offerId?: unknown; code?: unknown; message?: unknown; attempts?: unknown }>,
): ProgressOfferCardItem[] {
  const failMap = new Map<string, typeof failures[number]>();
  for (const f of failures) failMap.set(String(f.offerId ?? ''), f);

  return Array.from({ length: total }, (_, i) => {
    const base = baseOffers[i] || {};
    const oid = String(base.offerId ?? '');
    const deep = deepMap.get(oid) as Record<string, unknown> | undefined;
    const fail = failMap.get(oid);

    if (deep) {
      return {
        slotIndex: i,
        offerId: oid,
        title: String(deep.title || base.title || ''),
        price: String(deep.priceRange || deep.priceText || base.price || ''),
        image: String(deep.mainImage || (deep.images as string[])?.[0] || base.image || ''),
        status: 'success' as const,
        raw: deep,
      };
    }
    if (fail) {
      return {
        slotIndex: i,
        offerId: oid,
        title: String(base.title || ''),
        image: String(base.image || ''),
        status: 'failed' as const,
        message: String(fail.message || ''),
        code: String(fail.code || ''),
        attempts: Number(fail.attempts || 0),
        raw: fail,
      };
    }
    if (oid && base.title) {
      return {
        slotIndex: i,
        offerId: oid,
        title: String(base.title || ''),
        image: String(base.image || ''),
        status: 'searching' as const,
      };
    }
    return { slotIndex: i, status: 'waiting' as const };
  });
}

export default function ProgressOfferCard({ item, onOpen }: Props) {
  const isPlaceholder = item.status === 'waiting' || item.status === 'collecting';
  const showImage = item.image && item.status === 'success';

  return (
    <article
      className={`progress-offer-card card-status-${item.status}`}
      onClick={() => onOpen?.(item)}
      title={item.status === 'waiting' ? '等待采集' : item.title || item.offerId || ''}
    >
      {/* Image area 1:1 */}
      <div className="progress-card-image">
        {showImage ? (
          <img src={item.image} alt={item.title || ''} loading="lazy" />
        ) : isPlaceholder ? (
          <div className="progress-image-skeleton">
            {item.status === 'collecting' && <span className="spinner" />}
          </div>
        ) : item.status === 'failed' ? (
          <div className="progress-image-failed">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.5)" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
          </div>
        ) : (
          <div className="progress-image-skeleton" />
        )}
        {(item.status === 'success' || item.status === 'failed') && (
          <span className={`progress-chip ${statusChipClass[item.status]}`}>
            {statusLabel[item.status]}
          </span>
        )}
      </div>

      {/* Info area */}
      <div className="progress-card-info">
        {item.status === 'waiting' ? (
          <p className="progress-card-placeholder">等待采集</p>
        ) : item.status === 'collecting' ? (
          <p className="progress-card-placeholder">正在采集详情...</p>
        ) : (
          <>
            <p className="progress-card-title">{item.title || '未识别商品'}</p>
            {item.price && <p className="progress-card-price">{item.price}</p>}
          </>
        )}

        {item.status === 'failed' && (
          <p className="progress-card-fail-reason">
            {item.message || item.code || '采集失败'}
          </p>
        )}

        <button
          className="progress-card-ozon-btn"
          disabled={item.status !== 'success'}
          onClick={(e) => {
            e.stopPropagation();
            if (item.status === 'success') alert('功能开发中');
          }}
        >
          上架至 Ozon
        </button>
      </div>
    </article>
  );
}
