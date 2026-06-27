import React, { useState, useMemo } from 'react';
import { CommandRecord } from '../../services/api';
import { shouldDefaultCard } from '../../services/offer-adapter';
import ProgressOfferCard, { toProgressCards, ProgressOfferCardItem } from './ProgressOfferCard';
import OfferDetailModal from './OfferDetailModal';
import ProgressSummary from './ProgressSummary';

interface Props {
  record: CommandRecord | null;
  resultType?: string;
  placeholderCards?: number;
  running?: boolean;
}

type ViewMode = 'card' | 'json';

export default function ResultRenderer({ record, resultType, placeholderCards, running }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    shouldDefaultCard(resultType) ? 'card' : 'json',
  );
  const [toast, setToast] = useState('');
  const [detailItem, setDetailItem] = useState<ProgressOfferCardItem | null>(null);

  const data = record?.stdoutJson as Record<string, unknown> | undefined;

  // Build progress cards from result data
  const progressCards = useMemo<ProgressOfferCardItem[]>(() => {
    if (!data) {
      // Still running — use placeholder count
      if (placeholderCards && placeholderCards > 0) {
        return Array.from({ length: placeholderCards }, (_, i) => ({
          slotIndex: i,
          status: (i === 0 ? 'collecting' as const : 'waiting' as const),
        }));
      }
      return [];
    }

    const baseOffers = (data.offers as Array<Record<string, unknown>>) || [];
    const deeppro = data.deeppro as Record<string, unknown> | undefined;
    const deepOffers = (deeppro?.offers as Array<Record<string, unknown>>) || [];
    const deepFailures = (deeppro?.failures as Array<Record<string, unknown>>) || [];

    // Mark all as collecting while running
    if (running && placeholderCards && placeholderCards > 0) {
      return Array.from({ length: placeholderCards }, (_, i) => ({
        slotIndex: i,
        offerId: String(baseOffers[i]?.offerId ?? ''),
        title: String(baseOffers[i]?.title ?? ''),
        image: String(baseOffers[i]?.image ?? ''),
        status: (i === 0 ? 'collecting' as const : 'waiting' as const),
      }));
    }

    // Build deep map and translate
    const deepMap = new Map<string, unknown>();
    for (const d of deepOffers) deepMap.set(String(d.offerId ?? ''), d);

    return toProgressCards(
      Math.max(baseOffers.length, placeholderCards || 0, deepOffers.length + deepFailures.length),
      baseOffers,
      deepMap,
      deepFailures,
    );
  }, [data, placeholderCards, running]);

  const hasOffers = progressCards.length > 0;

  const deeppro = data?.deeppro as Record<string, unknown> | undefined;
  const deepproFailures = (deeppro?.failures as Array<Record<string, unknown>>) || [];
  const keyword = data?.keyword as string | undefined;
  const sort = data?.sort as string | undefined;
  const sortMap: Record<string, string> = { relevance: '综合排序', 'best-selling': '销量优先', 'price-asc': '价格从低到高', 'price-desc': '价格从高到低' };

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
      {/* Progress summary */}
      {hasOffers && (
        <ProgressSummary cards={progressCards} running={!!running} />
      )}

      {/* Result summary text */}
      <div className="result-summary">
        <strong>{hasOffers ? `${progressCards.length} 个商品` : '已执行'}</strong>
        {keyword && <span>关键词：{keyword}</span>}
        {sort && sort !== 'relevance' && <span>排序：{sortMap[sort] || sort}</span>}
        {deeppro?.enabled && (
          <span>
            DEEPPRO：{deeppro.success}/{deeppro.total} 成功
            {deeppro.failed ? `，${deeppro.failed} 失败` : ''}
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="result-toolbar">
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

      {/* Progress card grid */}
      {viewMode === 'card' && hasOffers && (
        <div className="progress-card-grid">
          {progressCards.map((card) => (
            <ProgressOfferCard
              key={card.slotIndex}
              item={card}
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
      {viewMode === 'json' && (
        <div className="result-preview">
          <pre className="json-output">{data ? JSON.stringify(data, null, 2) : '等待数据...'}</pre>
        </div>
      )}

      {/* Fallback: no card data */}
      {viewMode === 'card' && !hasOffers && !running && (
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
              {f.flags && <div><span>Flags</span><strong>{String((f.flags as string[]).join(', '))}</strong></div>}
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
