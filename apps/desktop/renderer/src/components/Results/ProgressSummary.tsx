import React from 'react';
import { ProgressOfferCardItem } from './ProgressOfferCard';

interface Props {
  cards: ProgressOfferCardItem[];
  running: boolean;
}

export default function ProgressSummary({ cards, running }: Props) {
  const total = cards.length;
  if (total === 0) return null;

  const ready = cards.filter((c) => c.status === 'basic-ready').length;
  const collecting = cards.filter((c) => c.status === 'deep-collecting').length;
  const deepOk = cards.filter((c) => c.status === 'deep-success').length;
  const deepFail = cards.filter((c) => c.status === 'deep-failed').length;
  const waiting = cards.filter((c) => c.status === 'waiting').length;

  const hasCard = ready + collecting + deepOk + deepFail;
  const deepDone = deepOk + deepFail;
  const pct = total > 0 ? Math.round((deepDone / total) * 100) : 0;

  const hasDeepActivity = deepOk > 0 || deepFail > 0 || collecting > 0;

  return (
    <div className="progress-summary">
      <div className="progress-stats">
        <span>共 <strong>{total}</strong> 个商品</span>
        {hasCard > 0 && <span>｜ 已生成卡片 <strong>{hasCard}</strong></span>}
        {hasDeepActivity && (
          <>
            {deepOk > 0 && <span>｜ 深采完成 <strong>{deepOk}</strong></span>}
            {collecting > 0 && <span>｜ 深采中 <strong>{collecting}</strong></span>}
            {deepFail > 0 && <span>｜ 失败 <strong style={{ color: '#dc2626' }}>{deepFail}</strong></span>}
          </>
        )}
        {waiting > 0 && <span>｜ 等待 <strong>{waiting}</strong></span>}
      </div>
      {hasDeepActivity && (
        <>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-pct">{pct}%</div>
        </>
      )}
    </div>
  );
}
