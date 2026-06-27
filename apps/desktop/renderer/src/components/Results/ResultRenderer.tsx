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

  const data = record.stdoutJson;
  const offers = useMemo(() => toOfferCardViewModels(data), [data]);
  const hasOffers = offers.length > 0;

  const handleViewJson = () => setViewMode('json');

  const copyFullJson = async () => {
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setToast('已复制完整 JSON');
      setTimeout(() => setToast(''), 1600);
    } catch { setToast('复制失败'); }
  };

  return (
    <div className="result-renderer">
      {/* Toolbar */}
      <div className="result-toolbar">
        <div className="mode-toggle">
          {hasOffers && (
            <button className={`mode-btn ${viewMode === 'card' ? 'active' : ''}`} onClick={() => setViewMode('card')}>卡片模式</button>
          )}
          <button className={`mode-btn ${viewMode === 'json' ? 'active' : ''}`} onClick={() => setViewMode('json')}>JSON 模式</button>
        </div>
        <button className="ghost-button-sm" onClick={copyFullJson}>复制完整 JSON</button>
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
