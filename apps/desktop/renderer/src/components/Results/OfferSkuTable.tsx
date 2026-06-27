import React, { useState } from 'react';
import { SkuViewModel } from '../../services/offer-adapter';

export default function OfferSkuTable({ skus }: { skus: SkuViewModel[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? skus : skus.slice(0, 3);
  if (!skus.length) return null;

  return (
    <div className="sku-section">
      <div className="sku-header">
        <span className="sku-label">SKU ({skus.length})</span>
        {skus.length > 3 && (
          <button className="glass-pill-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : `展开全部 ${skus.length} 个`}
          </button>
        )}
      </div>
      <div className="sku-table">
        {visible.map((sku, i) => (
          <div key={i} className="sku-row">
            <span className="sku-specs">{sku.specs || '—'}</span>
            <span className="sku-price">{sku.price !== null ? `¥${sku.price}` : '—'}</span>
            <span className="sku-stock">{sku.stock !== null ? `库存 ${sku.stock}` : ''}</span>
            {sku.saleCount !== null && sku.saleCount > 0 && (
              <span className="sku-sales">售 {sku.saleCount}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
