import React from 'react';

export default function OfferMetricGrid({ items }: { items: Array<{ label: string; value: string | number | null }> }) {
  const visible = items.filter((i) => i.value !== null && i.value !== '' && i.value !== 0);
  if (!visible.length) return null;

  return (
    <div className="metric-grid-glass">
      {visible.map((m, i) => (
        <div key={i} className="metric-tile">
          <span className="metric-value">{String(m.value)}</span>
          <span className="metric-label">{m.label}</span>
        </div>
      ))}
    </div>
  );
}
