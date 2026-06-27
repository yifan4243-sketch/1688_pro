import React, { useState } from 'react';
import { OfferCardViewModel } from '../../services/offer-adapter';
import OfferSkuTable from './OfferSkuTable';
import OfferAttributes from './OfferAttributes';
import OfferMetricGrid from './OfferMetricGrid';

const toast = (msg: string, setter: (v: string) => void) => {
  setter(msg);
  setTimeout(() => setter(''), 1600);
};

export default function OfferCard({ offer, onViewJson }: { offer: OfferCardViewModel; onViewJson?: (raw: unknown) => void }) {
  const [tip, setTip] = useState('');
  const [imgFailed, setImgFailed] = useState(false);
  const copy = (text: string, label: string) =>
    navigator.clipboard.writeText(text).then(() => toast(`已复制${label}`, setTip), () => toast('复制失败', setTip));

  const metrics = [
    ...(offer.turnover ? [{ label: '成交', value: offer.turnover }] : []),
    ...(offer.saledCount ? [{ label: '销量', value: offer.saledCount }] : []),
    ...(offer.orderCount ? [{ label: '订单', value: offer.orderCount }] : []),
    ...(offer.skuCount > 0 ? [{ label: 'SKU', value: offer.skuCount }] : []),
    ...(offer.totalStock !== null ? [{ label: '库存', value: offer.totalStock }] : []),
    ...(offer.minOrderQty !== null ? [{ label: '起订', value: `${offer.minOrderQty}${offer.unitName || ''}` }] : []),
    ...(offer.priceTiers.length > 0 ? [{ label: '价格档', value: offer.priceTiers.length }] : []),
    ...(offer.images.length > 0 ? [{ label: '图片', value: offer.images.length }] : []),
    ...(offer.attributes.length > 0 ? [{ label: '属性', value: offer.attributes.length }] : []),
  ];

  const fullTags = [
    ...offer.verifiedTags,
    ...offer.tags,
    ...(offer.repurchaseRateText ? [offer.repurchaseRateText] : []),
  ];

  const showImage = offer.imageUrl && !imgFailed;

  return (
    <article className="liquid-glass-card offer-card">
      {/* ── left media panel ── */}
      <div className="offer-media-panel">
        <div className="offer-main-image-shell">
          <div className="offer-main-image">
            {showImage ? (
              <img
                src={offer.imageUrl!}
                alt={offer.title}
                loading="lazy"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <div className="image-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                <span>{imgFailed ? '加载失败' : '暂无图片'}</span>
              </div>
            )}
            {offer.deepCollected && <span className="deep-badge">深采</span>}
          </div>
        </div>

        {offer.images.length > 1 && (
          <div className="offer-thumbnails">
            {offer.images.slice(0, 5).map((url, i) => (
              <img key={i} src={url} alt="" className="thumb" loading="lazy" />
            ))}
            {offer.images.length > 5 && <span className="thumb-more">+{offer.images.length - 5}</span>}
          </div>
        )}
      </div>

      {/* ── right info panel ── */}
      <div className="offer-info-panel">
        {/* title must be first and always visible */}
        <div className="offer-header-block">
          <h4 className="offer-title">{offer.title || '未识别商品标题'}</h4>
          <div className="offer-price-row">
            <span className="offer-price">{offer.priceText || '—'}</span>
            {offer.unitName && <span className="offer-unit">/ {offer.unitName}</span>}
            {offer.minOrderQty != null && (
              <span className="offer-moq">起订 {offer.minOrderQty} {offer.unitName || ''}</span>
            )}
          </div>
        </div>

        <OfferMetricGrid items={metrics} />

        <div className="offer-supplier">
          <span className="supplier-name">{offer.supplierName || '—'}</span>
          {offer.supplierYears != null && <span className="glass-chip">{offer.supplierYears}年</span>}
          {offer.supplierLoginId && <span className="glass-chip">ID: {offer.supplierLoginId}</span>}
          {(offer.province || offer.city) && <span className="glass-chip">{[offer.province, offer.city].filter(Boolean).join(' ')}</span>}
        </div>

        <div className="offer-id-line">
          <code>{offer.offerId}</code>
          <button className="glass-pill-button" onClick={() => copy(offer.offerId, 'Offer ID')}>复制 ID</button>
        </div>

        {fullTags.length > 0 && (
          <div className="offer-tags">
            {fullTags.map((t, i) => (
              <span key={i} className={`glass-chip ${offer.verifiedTags.includes(t) ? 'verified' : ''}`}>{t}</span>
            ))}
          </div>
        )}

        {offer.priceTiers.length > 0 && (
          <div className="tier-section">
            <span className="tier-label">价格阶梯</span>
            <div className="tier-list">
              {offer.priceTiers.map((t, i) => (
                <span key={i} className="tier-item">{t.minQty}件 ¥{t.price}</span>
              ))}
            </div>
          </div>
        )}

        <OfferSkuTable skus={offer.skus} />
        <OfferAttributes attrs={offer.attributes} />

        <div className="offer-actions">
          <button className="glass-pill-button" onClick={() => copy(offer.title, '标题')}>复制标题</button>
          <button className="glass-pill-button" onClick={() => copy(offer.url || '', '链接')}>复制链接</button>
          {offer.shopUrl && (
            <button className="glass-pill-button" onClick={() => window.open(offer.shopUrl!, '_blank')}>打开店铺</button>
          )}
          <button className="glass-pill-button" onClick={() => window.open(offer.url || `https://detail.1688.com/offer/${offer.offerId}.html`, '_blank')}>打开商品</button>
          {onViewJson && <button className="glass-pill-button" onClick={() => onViewJson(offer)}>JSON</button>}
        </div>
      </div>

      {tip && <div className="toast">{tip}</div>}
    </article>
  );
}
