import React, { useState } from 'react';

interface Attr { name: string; value: string }

export default function OfferAttributes({ attrs }: { attrs: Attr[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? attrs : attrs.slice(0, 8);
  if (!attrs.length) return null;

  return (
    <div className="attr-section">
      <div className="attr-header">
        <span className="attr-label">属性 ({attrs.length})</span>
        {attrs.length > 8 && (
          <button className="glass-pill-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : `展开全部 ${attrs.length} 项`}
          </button>
        )}
      </div>
      <div className="attr-grid">
        {visible.map((a, i) => (
          <div key={i} className="attr-item">
            <span className="attr-key">{a.name}</span>
            <span className="attr-value">{a.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
