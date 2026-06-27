import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import OfferDetailModal from '../Results/OfferDetailModal';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';

interface ProductItem {
  offerId: string;
  title: string;
  price: string;
  image: string;
  url: string;
  collectedAt: string;
  raw?: unknown;
}

interface Props {
  items: ProductItem[];
  open: boolean;
  onClose: () => void;
}

function toOfferCardItem(p: ProductItem): ProgressOfferCardItem {
  return {
    slotIndex: 0,
    offerId: p.offerId,
    title: p.title || '',
    price: p.price || '',
    image: p.image,
    status: 'basic-ready',
    raw: p.raw || p,
  };
}

export default function ProductHistoryModal({ items, open, onClose }: Props) {
  const [selected, setSelected] = useState<ProductItem | null>(null);
  if (!open) return null;

  return createPortal(
    <div className="product-history-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="product-history-shell">
        <header className="product-history-header">
          <div>
            <h3>历史记录</h3>
            <p>最近采集商品，最多保留 50 个</p>
          </div>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </header>
        <div className="product-history-body custom-scrollbar">
          {items.length === 0 ? (
            <div className="empty-product-history">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(15,23,42,0.15)" strokeWidth="1.2">
                <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
              <p style={{ marginTop: 12, fontSize: 14 }}>暂无采集记录</p>
              <p style={{ fontSize: 12 }}>执行搜索采集后，商品图会出现在这里。</p>
            </div>
          ) : (
            <div className="product-history-grid">
              {items.map((item) => (
                <button
                  key={item.offerId}
                  className="product-history-tile"
                  onClick={() => setSelected(item)}
                  title={item.title}
                >
                  <img src={item.image} alt={item.title} loading="lazy" />
                  {item.price && <span className="product-history-price">{item.price}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <OfferDetailModal item={toOfferCardItem(selected)} onClose={() => setSelected(null)} />
      )}
    </div>,
    document.body,
  );
}
