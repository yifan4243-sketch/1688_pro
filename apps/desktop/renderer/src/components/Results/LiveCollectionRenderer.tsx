import React, { useState } from 'react';
import { ProgressOfferCardItem } from './ProgressOfferCard';
import ProgressOfferCard from './ProgressOfferCard';
import ProgressSummary from './ProgressSummary';
import OfferDetailModal from './OfferDetailModal';

interface Props {
  cards: ProgressOfferCardItem[];
  running: boolean;
  keyword?: string;
}

export default function LiveCollectionRenderer({ cards, running, keyword }: Props) {
  const [detailItem, setDetailItem] = useState<ProgressOfferCardItem | null>(null);

  if (!cards.length) return null;

  return (
    <div className="result-renderer">
      <ProgressSummary cards={cards} running={running} />

      <div className="result-summary">
        <strong>{cards.length} 个商品</strong>
        {keyword && <span>关键词：{keyword}</span>}
      </div>

      <div className="progress-card-grid">
        {cards.map((card) => (
          <ProgressOfferCard
            key={card.slotIndex}
            item={card}
            onOpen={(item) => {
              if (item.offerId || item.raw || item.title || item.image) setDetailItem(item);
            }}
          />
        ))}
      </div>

      {detailItem && (
        <OfferDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      )}
    </div>
  );
}
