import React, { useState } from 'react';
import { OfferCardViewModel } from '../../services/offer-adapter';

interface Props {
  offer: OfferCardViewModel;
}

export default function OfferCard({ offer }: Props) {
  const [toast, setToast] = useState('');

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`已复制${label}`);
      setTimeout(() => setToast(''), 1500);
    } catch { setToast('复制失败'); }
  };

  const openShop = (url: string) => {
    try {
      window.open(url, '_blank');
    } catch { /* electron may not expose window.open */ }
  };

  const fallback = !offer.imageUrl;

  return (
    <article className="offer-card">
      <div className="card-image-wrap">
        {fallback ? (
          <div className="card-image-fallback">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>
        ) : (
          <img src={offer.imageUrl!} alt={offer.title} loading="lazy" />
        )}
      </div>

      <div className="card-body">
        <h4 className="card-title">{offer.title}</h4>

        <div className="card-price">
          <span className="price-value">{offer.priceText || '价格未显示'}</span>
          {offer.turnover && <span className="turnover">{offer.turnover}</span>}
        </div>

        <div className="card-meta">
          {offer.supplierName && <span className="meta-item supplier">{offer.supplierName}</span>}
          {offer.supplierYears != null && <span className="meta-item">{offer.supplierYears}年</span>}
          {(offer.province || offer.city) && (
            <span className="meta-item">{[offer.province, offer.city].filter(Boolean).join(' ')}</span>
          )}
        </div>

        <div className="card-id-row">
          <span className="offer-id">Offer ID: {offer.offerId}</span>
          <button className="chip-btn" onClick={() => copy(offer.offerId, 'Offer ID')}>复制 ID</button>
          <button className="chip-btn" onClick={() => copy(offer.title, '标题')}>复制标题</button>
        </div>

        {(offer.verifiedTags.length > 0 || offer.tags.length > 0) && (
          <div className="card-tags">
            {offer.verifiedTags.map((t) => <span key={t} className="tag-chip verified">{t}</span>)}
            {offer.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
          </div>
        )}

        <div className="card-actions">
          {offer.shopUrl && (
            <button className="ghost-button-sm" onClick={() => openShop(offer.shopUrl!)}>打开店铺</button>
          )}
          <button className="ghost-button-sm" onClick={() => copy(JSON.stringify(offer.raw, null, 2), '原始 JSON')}>
            查看 JSON
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </article>
  );
}
