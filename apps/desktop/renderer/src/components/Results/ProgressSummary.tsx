import React from 'react';
import { ProgressOfferCardItem } from './ProgressOfferCard';

interface Props {
  cards: ProgressOfferCardItem[];
  running: boolean;
}

export default function ProgressSummary({ cards, running }: Props) {
  const total = cards.length;
  if (total === 0) return null;

  const basic = cards.filter((c) => c.status === 'basic').length;
  const success = cards.filter((c) => c.status === 'success').length;
  const failed = cards.filter((c) => c.status === 'failed').length;
  const collecting = cards.filter((c) => c.status === 'collecting' || c.status === 'searching').length;
  const waiting = cards.filter((c) => c.status === 'waiting').length;
  const done = basic + success + failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const hasDeep = success > 0 || failed > 0;

  return (
    <div className="progress-summary">
      <div className="progress-stats">
        <span>共 <strong>{total}</strong> 个商品</span>
        {basic > 0 && <span>｜ 基础信息 <strong>{basic}</strong></span>}
        {hasDeep && <span>｜ 深采完成 <strong>{success}</strong></span>}
        {failed > 0 && <span>｜ 失败 <strong style={{ color: '#dc2626' }}>{failed}</strong></span>}
        {running && collecting > 0 && <span>｜ 采集中 <strong>{collecting}</strong></span>}
        {running && waiting > 0 && <span>｜ 等待中 <strong>{waiting}</strong></span>}
      </div>
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="progress-pct">{pct}%</div>
    </div>
  );
}
