import React, { useEffect, useRef, useState, useMemo } from 'react';
import { getApi, CommandRecord } from '../../services/api';
import { shouldDefaultCard } from '../../services/offer-adapter';
import ProgressOfferCard, { toProgressCards, ProgressOfferCardItem } from './ProgressOfferCard';
import OfferDetailModal from './OfferDetailModal';
import ProgressSummary from './ProgressSummary';

interface Props {
  record: CommandRecord | null;
  resultType?: string;
  placeholderCards?: number;
  running?: boolean;
  activeProfile?: string;
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

function normalizeSingleDeepError(error: unknown): { code: string; message: string } {
  const msg = error instanceof Error ? error.message : String(error || '');
  if (/profile_busy|LOCK_BUSY|正在运行|busy/i.test(msg)) return { code: 'PROFILE_BUSY', message: '当前账号正在执行其他采集任务，已停止本次深采。请稍后重试。' };
  if (/cancelled|canceled|已取消/i.test(msg)) return { code: 'CANCELLED', message: '采集任务被取消，可能是浏览器被关闭或命令被中断。' };
  if (/captcha|验证码|滑块|风控/i.test(msg)) return { code: 'CAPTCHA_OR_RISK', message: '页面被验证码、滑块或风控拦截。' };
  return { code: 'SINGLE_DEEP_COLLECT_FAILED', message: msg || '深度采集失败' };
}

export default function ResultRenderer({ record, resultType, placeholderCards, running, activeProfile }: Props) {
  const api = getApi();
  const [viewMode, setViewMode] = useState<ViewMode>(
    shouldDefaultCard(resultType) ? 'card' : 'json',
  );
  const [toast, setToast] = useState('');
  const [detailItem, setDetailItem] = useState<ProgressOfferCardItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [cardOverrides, setCardOverrides] = useState<Record<string, Partial<ProgressOfferCardItem>>>({});

  const data = record?.stdoutJson as Record<string, unknown> | undefined;

  // Build progress cards from result data, applying per-card overrides
  const progressCards = useMemo<ProgressOfferCardItem[]>(() => {
    const baseCards = normalizeCards(data, placeholderCards, running);
    return baseCards.map((card) => {
      const key = card.offerId ? `offer:${card.offerId}` : `slot:${card.slotIndex}`;
      const override = cardOverrides[key];
      return override ? { ...card, ...override } : card;
    });
  }, [data, placeholderCards, running, cardOverrides]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setCardOverrides({});
  }, [record?.runId, resultType]);

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

  // ----- per-card deep collect queue -----
  const deepQueueRef = useRef<Array<{ key: string; item: ProgressOfferCardItem }>>([]);
  const deepRunningRef = useRef(false);

  const runSingleDeepCollectNow = async (item: ProgressOfferCardItem, key: string) => {
    const offerRecord = await api.commands.run({
      commandId: 'offer',
      args: { offerIds: item.offerId },
      options: { pro: true },
      profile: activeProfile || record?.profile || 'default',
      confirmed: true,
    });
    if (offerRecord.status !== 'success') {
      const msg = offerRecord.error?.message || offerRecord.stderrText || `深度采集失败：${offerRecord.status}`;
      throw new Error(msg);
    }
    const deep = offerRecord.stdoutJson as Record<string, unknown> | undefined;
    if (!deep || !deep.title || /captcha|验证码|滑块|风控/i.test(String(deep.title))) {
      throw new Error('深度采集结果不完整，可能被验证码或风控拦截');
    }
    const images = Array.isArray(deep.images) ? deep.images : [];
    const mainImage = String(deep.mainImage || images[0] || item.image || '');
    const price = String(deep.priceRange || deep.priceText || item.price || '');
    setCardOverrides((prev) => ({ ...prev, [key]: { title: String(deep.title || item.title || ''), price, image: mainImage, status: 'deep-success', raw: deep, message: '', code: '' } }));
  };

  const processDeepQueue = async () => {
    if (deepRunningRef.current) return;
    const next = deepQueueRef.current[0];
    if (!next) return;
    deepRunningRef.current = true;
    const { key, item } = next;
    setCardOverrides((prev) => ({ ...prev, [key]: { status: 'deep-collecting', message: '', code: '' } }));
    try {
      await runSingleDeepCollectNow(item, key);
      setToast('深度采集完成');
      setTimeout(() => setToast(''), 1600);
    } catch (error) {
      const n = normalizeSingleDeepError(error);
      setCardOverrides((prev) => ({ ...prev, [key]: { status: 'deep-failed', message: n.message, code: n.code } }));
      setToast(n.message);
      setTimeout(() => setToast(''), 2200);
    } finally {
      deepQueueRef.current = deepQueueRef.current.slice(1);
      deepRunningRef.current = false;
      setTimeout(() => processDeepQueue(), 300);
    }
  };

  const enqueueSingleDeepCollect = (item: ProgressOfferCardItem) => {
    if (!item.offerId) { setToast('缺少 Offer ID'); setTimeout(() => setToast(''), 1600); return; }
    const key = item.offerId ? `offer:${item.offerId}` : `slot:${item.slotIndex}`;
    const curOverride = cardOverrides[key];
    const curStatus = curOverride?.status || item.status;
    if (curStatus === 'deep-queued' || curStatus === 'deep-collecting') return;
    deepQueueRef.current = [...deepQueueRef.current, { key, item }];
    setCardOverrides((prev) => ({ ...prev, [key]: { status: 'deep-queued', message: '', code: '' } }));
    processDeepQueue();
  };

  useEffect(() => {
    setSelectedKeys(new Set());
    setCardOverrides({});
    deepQueueRef.current = [];
    deepRunningRef.current = false;
  }, [record?.runId, resultType]);

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
              onDeepCollect={enqueueSingleDeepCollect}
              onOzonPlaceholder={() => {
                setToast('上架至 OZON 暂未接入');
                setTimeout(() => setToast(''), 1600);
              }}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
