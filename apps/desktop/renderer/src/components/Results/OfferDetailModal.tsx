import React from 'react';
import { ProgressOfferCardItem } from './ProgressOfferCard';

interface Props {
  item: ProgressOfferCardItem;
  onClose: () => void;
}

export default function OfferDetailModal({ item, onClose }: Props) {
  const raw = item.raw as Record<string, unknown> | undefined;
  const skus = (raw?.skus as Array<Record<string, unknown>>) || [];
  const attrs = (raw?.attributes as Array<{ name: string; value: string }>) || [];
  const images = (raw?.images as string[]) || (item.image ? [item.image] : []);
  const supplier = raw?.supplier as Record<string, unknown> | undefined;
  const freight = raw?.freight as Record<string, unknown> | undefined;
  const saledCount = raw?.saledCount as number | undefined;
  const priceTiers = (raw?.priceTiers as Array<Record<string, unknown>>) || [];

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal detail-modal glass-panel-card" style={{ width: 640, maxHeight: '85vh', overflow: 'auto' }}>
        <div className="modal-actions" style={{ marginBottom: 8 }}>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </div>

        {/* Images */}
        {images.length > 0 && (
          <div className="detail-images">
            <img src={images[0]} alt={item.title || ''} className="detail-main-image" />
            {images.length > 1 && (
              <div className="detail-thumbs">
                {images.slice(0, 6).map((url, i) => (
                  <img key={i} src={url} alt="" className="thumb" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Title & Price */}
        <h3 className="detail-title">{item.title || '未识别商品'}</h3>
        {item.price && <p className="detail-price">{item.price}</p>}

        {/* Status */}
        <div className="detail-meta">
          <span>Offer ID: <code>{item.offerId || '-'}</code></span>
          {item.status === 'success' && <span className="status-badge">已完成</span>}
          {item.status === 'failed' && <span className="status-badge warn">采集失败</span>}
        </div>

        {/* Failure info */}
        {item.status === 'failed' && (
          <div className="detail-failure">
            <p><strong>失败原因：</strong>{item.message || item.code || '未知'}</p>
            {item.code && <p>Code: {item.code}</p>}
            {item.attempts != null && <p>尝试次数：{item.attempts}</p>}
          </div>
        )}

        {/* Supplier */}
        {supplier && (
          <div className="detail-section">
            <h4>供应商信息</h4>
            <p>{supplier.name as string || '-'}</p>
            {supplier.loginId && <p>Login ID: {String(supplier.loginId)}</p>}
            {supplier.memberId && <p>Member ID: {String(supplier.memberId)}</p>}
          </div>
        )}

        {/* Freight */}
        {freight && (
          <div className="detail-section">
            <h4>发货信息</h4>
            {freight.receiveAddress && <p>收货地址：{String(freight.receiveAddress)}</p>}
            {freight.province && <p>省份：{String(freight.province)}{freight.city ? ` ${freight.city}` : ''}</p>}
            {freight.unitWeight != null && <p>单位重量：{String(freight.unitWeight)}</p>}
          </div>
        )}

        {/* Sales */}
        {saledCount != null && (
          <div className="detail-section">
            <h4>销量</h4>
            <p>{saledCount}</p>
          </div>
        )}

        {/* Price tiers */}
        {priceTiers.length > 0 && (
          <div className="detail-section">
            <h4>价格阶梯</h4>
            {priceTiers.map((t, i) => (
              <span key={i} className="glass-chip" style={{ marginRight: 6 }}>
                {String(t.minQty ?? '')}件 ¥{String(t.price ?? '')}
              </span>
            ))}
          </div>
        )}

        {/* SKUs */}
        {skus.length > 0 && (
          <div className="detail-section">
            <h4>SKU ({skus.length})</h4>
            {skus.slice(0, 10).map((sku, i) => (
              <div key={i} className="sku-row">
                <span className="sku-specs">{String(sku.specs || sku.skuId || '-')}</span>
                <span className="sku-price">¥{String(sku.price ?? '-')}</span>
                <span className="sku-stock">库存 {String(sku.stock ?? '-')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Attributes */}
        {attrs.length > 0 && (
          <div className="detail-section">
            <h4>属性 ({attrs.length})</h4>
            <div className="attr-grid">
              {attrs.map((a, i) => (
                <div key={i} className="attr-item">
                  <span className="attr-key">{a.name}</span>
                  <span className="attr-value">{a.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw JSON */}
        {raw && (
          <details className="advanced-section" style={{ marginTop: 12 }}>
            <summary className="advanced-toggle">原始 JSON</summary>
            <pre className="json-output" style={{ maxHeight: 300, overflow: 'auto', fontSize: 11, marginTop: 8 }}>
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
