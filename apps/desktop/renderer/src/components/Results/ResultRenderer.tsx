import React, { useState, useMemo } from 'react';
import { CommandRecord } from '../../services/api';
import { toOfferCardViewModels, shouldDefaultCard } from '../../services/offer-adapter';
import OfferCard from './OfferCard';

interface Props {
  record: CommandRecord;
  resultType?: string;
}

type ViewMode = 'card' | 'json';

export default function ResultRenderer({ record, resultType }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    shouldDefaultCard(resultType) ? 'card' : 'json',
  );
  const [toast, setToast] = useState('');

  const data = record.stdoutJson as Record<string, unknown> | undefined;
  const offers = useMemo(() => toOfferCardViewModels(data), [data]);
  const hasOffers = offers.length > 0;

  const handleViewJson = () => setViewMode('json');

  const failureMessageZh = (f: Record<string, unknown>): string => {
    const msg = String(f.message ?? '').trim();
    if (msg) return msg;
    const code = String(f.code ?? '');
    const map: Record<string, string> = {
      CAPTCHA_INTERCEPTION: '页面被验证码或滑块拦截，重试后仍未采集成功。',
      MISSING_PRICE: '详情页缺少价格信息，可能 SKU 或价格接口未加载成功。',
      MISSING_IMAGES: '详情页缺少商品图片，可能图片数据未加载成功。',
      MISSING_TITLE: '详情页缺少商品标题，可能页面加载不完整或被拦截。',
      RISK_OR_CAPTCHA_TITLE: '详情页标题显示风控、验证码或访问受限。',
      EMPTY_OFFER_RESULT: '详情采集结果为空，可能页面未正常返回商品数据。',
    };
    return map[code] || '采集失败，原因未识别。';
  };

  const copyFullJson = async () => {
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setToast('已复制完整 JSON');
      setTimeout(() => setToast(''), 1600);
    } catch { setToast('复制失败'); }
  };

  const keyword = data?.keyword as string | undefined;
  const sort = data?.sort as string | undefined;
  const deeppro = data?.deeppro as Record<string, unknown> | undefined;
  const deepproFailures = (deeppro?.failures as Array<Record<string, unknown>>) || [];
  const sortMap: Record<string, string> = { relevance: '综合排序', 'best-selling': '销量优先', 'price-asc': '价格从低到高', 'price-desc': '价格从高到低' };

  return (
    <div className="result-renderer">
      {/* Result summary */}
      <div className="result-summary">
        <strong>{hasOffers ? `${offers.length} 个商品` : '已执行'}</strong>
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
        <button className="glass-toolbar-button" onClick={copyFullJson}>
          <span className="toolbar-btn-icon">⧉</span>
          <span>复制完整 JSON</span>
        </button>
      </div>

      {/* Card view */}
      {viewMode === 'card' && hasOffers && (
        <div className="offer-card-grid">
          {offers.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} onViewJson={handleViewJson} />
          ))}
        </div>
      )}

      {/* JSON view */}
      {viewMode === 'json' && (
        <div className="result-preview">
          <pre className="json-output">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}

      {/* Fallback: no card data */}
      {viewMode === 'card' && !hasOffers && (
        <div className="result-preview">
          <pre className="json-output">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}

      {/* DEEPPRO failures warning */}
      {deepproFailures.length > 0 && (
        <div className="result-preview error-detail" style={{ marginTop: 12 }}>
          <h4>DEEPPRO 失败项</h4>
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
      {record.stderrText && /DEEPPRO/i.test(record.stderrText) && (
        <details className="advanced-section" style={{ marginTop: 12 }}>
          <summary className="advanced-toggle">DEEPPRO 进度日志</summary>
          <div className="error-stderr" style={{ marginTop: 8 }}>
            <pre>{record.stderrText}</pre>
          </div>
        </details>
      )}

      {/* Error detail */}
      {record.status !== 'success' && (
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
