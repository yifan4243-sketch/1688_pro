import React, { useEffect, useState, useMemo } from 'react';
import { CommandRecord } from '../../services/api';
import { shouldDefaultCard } from '../../services/offer-adapter';
import ProgressOfferCard, { toProgressCards, ProgressOfferCardItem } from './ProgressOfferCard';
import OfferDetailModal from './OfferDetailModal';
import ProgressSummary from './ProgressSummary';
import OzonDraftModal from '../Ozon/OzonDraftModal';

interface Props {
  record: CommandRecord | null;
  resultType?: string;
  placeholderCards?: number;
  running?: boolean;
}

type ViewMode = 'card' | 'json';

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function priceText(raw: Record<string, unknown>): string {
  const direct = text(raw.priceRange) || text(raw.priceText);
  if (direct) return direct;
  const price = objectOf(raw.price);
  if (price?.text) return text(price.text);
  const min = raw.priceMin ?? price?.min;
  const max = raw.priceMax ?? price?.max;
  if (min != null && max != null && Number(min) !== Number(max)) return `¥${min}-${max}`;
  if (min != null) return `¥${min}`;
  if (max != null) return `¥${max}`;
  return '';
}

function imageOf(raw: Record<string, unknown>): string {
  const direct = text(raw.image) || text(raw.mainImage) || text(raw.imageUrl) || text(raw.picUrl) || text(raw.thumb);
  if (direct) return direct;
  const images = raw.images || raw.gallery || raw.imageList;
  if (Array.isArray(images)) {
    const first = images[0];
    if (typeof first === 'string') return first;
    const obj = objectOf(first);
    return text(obj?.url) || text(obj?.src) || text(obj?.image);
  }
  return '';
}

function offerIdOf(raw: Record<string, unknown>): string {
  return text(raw.offerId) || text(raw.offer_id) || text(raw.id);
}

function cardFromRaw(raw: Record<string, unknown>, index: number, status: ProgressOfferCardItem['status'] = 'basic-ready'): ProgressOfferCardItem {
  const offerId = offerIdOf(raw);
  return {
    slotIndex: index,
    offerId,
    title: text(raw.title) || text(raw.subject) || text(raw.name) || text(raw.productTitle) || (offerId ? `商品 ${offerId}` : ''),
    price: priceText(raw),
    image: imageOf(raw),
    status,
    raw,
  };
}

function normalizeCards(data: Record<string, unknown> | undefined, placeholderCards?: number, running?: boolean): ProgressOfferCardItem[] {
  if (!data) {
    if (placeholderCards && placeholderCards > 0) {
      return Array.from({ length: placeholderCards }, (_, i) => ({
        slotIndex: i,
        status: i === 0 && running ? 'collecting' as const : 'waiting' as const,
      }));
    }
    return [];
  }

  const rootOffers = Array.isArray(data.offers) ? data.offers.map(objectOf).filter(Boolean) as Record<string, unknown>[] : [];
  if (rootOffers.length > 0) {
    const deeppro = objectOf(data.deeppro);
    const deepOffers = Array.isArray(deeppro?.offers) ? deeppro.offers as Array<Record<string, unknown>> : [];
    const deepFailures = Array.isArray(deeppro?.failures) ? deeppro.failures as Array<Record<string, unknown>> : [];
    const deepMap = new Map<string, unknown>();
    for (const d of deepOffers) deepMap.set(offerIdOf(d), d);
    return toProgressCards(
      Math.max(rootOffers.length, placeholderCards || 0, deepOffers.length + deepFailures.length),
      rootOffers,
      deepMap,
      deepFailures,
      { isDeepPro: Boolean(deeppro?.enabled) },
    );
  }

  const items = Array.isArray(data.items) ? data.items.map(objectOf).filter(Boolean) as Record<string, unknown>[] : [];
  if (items.length > 0) {
    return items.map((item, index) => {
      const offer = objectOf(item.offer);
      const summary = objectOf(item.summary);
      if (offer) return cardFromRaw(offer, index);
      if (summary) return cardFromRaw(summary, index, item.ok === false ? 'deep-failed' : 'deep-success');
      return cardFromRaw(item, index);
    });
  }

  if (offerIdOf(data) || text(data.title) || text(data.mainImage) || Array.isArray(data.skus)) {
    return [cardFromRaw(data, 0, Array.isArray(data.skus) ? 'deep-success' : 'basic-ready')];
  }

  return [];
}

function cardKey(card: ProgressOfferCardItem): string {
  return card.offerId ? `offer:${card.offerId}` : `slot:${card.slotIndex}`;
}

export default function ResultRenderer({ record, resultType, placeholderCards, running }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    shouldDefaultCard(resultType) ? 'card' : 'json',
  );
  const [toast, setToast] = useState('');
  const [detailItem, setDetailItem] = useState<ProgressOfferCardItem | null>(null);
  const [ozonItem, setOzonItem] = useState<ProgressOfferCardItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());

  const data = record?.stdoutJson as Record<string, unknown> | undefined;

  // Build progress cards from result data
  const progressCards = useMemo<ProgressOfferCardItem[]>(() => {
    return normalizeCards(data, placeholderCards, running);
  }, [data, placeholderCards, running]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [record?.runId, resultType]);

  const visibleCards = useMemo(() => progressCards, [progressCards]);
  const selectableCards = visibleCards.filter((card) => card.status !== 'waiting' || card.offerId || card.raw || card.title || card.image);
  const hasOffers = visibleCards.length > 0;
  const selectedCount = selectableCards.filter((card) => selectedKeys.has(cardKey(card))).length;
  const allSelected = selectableCards.length > 0 && selectedCount === selectableCards.length;

  const toggleSelect = (item: ProgressOfferCardItem) => {
    const key = cardKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      selectableCards.forEach((card) => next.add(cardKey(card)));
      return next;
    });
  };

  const clearSelected = () => {
    setSelectedKeys(new Set());
  };

  const deeppro = data?.deeppro as Record<string, unknown> | undefined;
  const deepproFailures = (deeppro?.failures as Array<Record<string, unknown>>) || [];

  const copyFullJson = async () => {
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setToast('已复制完整 JSON');
      setTimeout(() => setToast(''), 1600);
    } catch { setToast('复制失败'); }
  };

  const failureMessageZh = (f: Record<string, unknown>): string => {
    const msg = String(f.message ?? '').trim();
    if (msg) return msg;
    const code = String(f.code ?? '');
    const map: Record<string, string> = {
      CAPTCHA_INTERCEPTION: '验证码或滑块拦截',
      MISSING_PRICE: '商品价格缺失',
      MISSING_IMAGES: '商品图片缺失',
      MISSING_TITLE: '商品标题缺失',
      RISK_OR_CAPTCHA_TITLE: '页面被风控或验证码拦截',
      EMPTY_OFFER_RESULT: '采集结果为空',
    };
    return map[code] || '采集失败，原因未识别。';
  };

  return (
    <div className="result-renderer">
      <div className="result-unified-toolbar">
          <div className="result-left-tools">
            {hasOffers && (
              <>
                <button type="button" className="selection-action-btn" onClick={toggleSelectAll} disabled={selectableCards.length === 0}>
                  {allSelected ? '取消全选' : '全选'}
                </button>
                <button type="button" className="selection-action-btn" onClick={clearSelected} disabled={selectedCount === 0}>
                  取消勾选{selectedCount > 0 ? ` ${selectedCount}` : ''}
                </button>
                <ProgressSummary cards={visibleCards} running={!!running} compact />
              </>
            )}
          </div>
          <div className="result-top-actions">
            <div className="mode-toggle">
              {hasOffers && (
                <button className={`mode-btn ${viewMode === 'card' ? 'active' : ''}`} onClick={() => setViewMode('card')}>卡片模式</button>
              )}
              <button className={`mode-btn ${viewMode === 'json' ? 'active' : ''}`} onClick={() => setViewMode('json')}>JSON 模式</button>
            </div>
            {data && (
              <button className="glass-toolbar-button" onClick={copyFullJson}>
                <span className="toolbar-btn-icon">⧉</span>
                <span>复制完整 JSON</span>
              </button>
            )}
          </div>
        </div>

      {/* Progress card grid */}
      {viewMode === 'card' && hasOffers && (
        <div className="progress-card-grid">
          {visibleCards.map((card) => (
            <ProgressOfferCard
              key={cardKey(card)}
              item={card}
              selected={selectedKeys.has(cardKey(card))}
              onSelectToggle={toggleSelect}
              onOzon={(item) => setOzonItem(item)}
              onOpen={(item) => {
                if (item.offerId || item.raw || item.title || item.image) {
                  setDetailItem(item);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* JSON view */}
      {viewMode === 'json' && data && (
        <div className="result-preview">
          <pre className="json-output">{data ? JSON.stringify(data, null, 2) : '等待数据...'}</pre>
        </div>
      )}

      {/* DEEPPRO failures summary */}
      {deepproFailures.length > 0 && (
        <div className="result-preview error-detail" style={{ marginTop: 12 }}>
          <h4>DEEPPRO 失败详情</h4>
          {deepproFailures.map((f, i) => (
            <div key={i} className="error-grid" style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <div><span>Offer ID</span><strong>{String(f.offerId ?? '-')}</strong></div>
              <div><span>信息</span><strong>{failureMessageZh(f)}</strong></div>
              <div><span>尝试次数</span><strong>{String(f.attempts ?? '-')}</strong></div>
              {Array.isArray(f.flags) && <div><span>Flags</span><strong>{f.flags.map(String).join(', ')}</strong></div>}
            </div>
          ))}
        </div>
      )}

      {/* DEEPPRO progress log (collapsible) */}
      {record?.stderrText && /DEEPPRO/i.test(record.stderrText) && (
        <details className="advanced-section" style={{ marginTop: 12 }}>
          <summary className="advanced-toggle">DEEPPRO 进度日志</summary>
          <div className="error-stderr" style={{ marginTop: 8 }}>
            <pre>{record.stderrText}</pre>
          </div>
        </details>
      )}

      {/* Error detail */}
      {record && record.status !== 'success' && record.status !== 'running' && (
        <div className="result-preview error-detail">
          <h4>错误详情</h4>
          <div className="error-grid">
            <div><span>状态</span><strong>{record.status}</strong></div>
            <div><span>退出码</span><strong>{record.exitCode ?? '-'}</strong></div>
            <div><span>错误信息</span><strong>{record.error?.message || record.stderrText || '-'}</strong></div>
          </div>
          {record.argv?.length > 0 && (
            <div className="error-argv"><span>CLI 命令</span><code>{record.argv.join(' ')}</code></div>
          )}
          {record.stderrText && (
            <div className="error-stderr"><span>stderr</span><pre>{record.stderrText}</pre></div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {detailItem && (
        <OfferDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      )}

      {ozonItem && (
        <OzonDraftModal item={ozonItem} onClose={() => setOzonItem(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
