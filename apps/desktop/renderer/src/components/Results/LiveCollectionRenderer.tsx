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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(() => new Set());

  if (!cards.length) return null;

  const cardKey = (card: ProgressOfferCardItem): string => card.offerId ? `offer:${card.offerId}` : `slot:${card.slotIndex}`;
  const visibleCards = cards.filter((card) => !deletedKeys.has(cardKey(card)));
  const selectableCards = visibleCards.filter((card) => card.status !== 'waiting' || card.offerId || card.raw || card.title || card.image);
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

  const deleteSelected = () => {
    if (selectedCount === 0) return;
    setDeletedKeys((prev) => {
      const next = new Set(prev);
      selectableCards.forEach((card) => {
        const key = cardKey(card);
        if (selectedKeys.has(key)) next.add(key);
      });
      return next;
    });
    setSelectedKeys(new Set());
  };

  return (
    <div className="result-renderer">
      <div className="result-unified-toolbar">
        <div className="result-left-tools">
          <button type="button" className="selection-action-btn" onClick={toggleSelectAll} disabled={selectableCards.length === 0}>
            {allSelected ? '取消全选' : '全选'}
          </button>
          <button type="button" className="selection-action-btn danger" onClick={deleteSelected} disabled={selectedCount === 0}>
            删除{selectedCount > 0 ? ` ${selectedCount}` : ''}
          </button>
          <ProgressSummary cards={visibleCards} running={running} compact />
          {keyword && <span className="result-inline-meta">关键词：{keyword}</span>}
        </div>
      </div>

      <div className="progress-card-grid">
        {visibleCards.map((card) => (
          <ProgressOfferCard
            key={cardKey(card)}
            item={card}
            selected={selectedKeys.has(cardKey(card))}
            onSelectToggle={toggleSelect}
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
