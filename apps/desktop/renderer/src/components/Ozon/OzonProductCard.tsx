import React, { useState } from 'react';
import type { OzonListingTask, OzonListingTaskStatus } from '../Results/ozonListing/types';
import { formatMissingFields } from '../Results/ozonListing/precheck';
import { formatOzonTaskDisplayMessage } from './ozonError';

export type OzonProductStatusGroup = 'success' | 'processing' | 'manual' | 'failed';

type Props = {
  task: OzonListingTask;
  onInspect: (task: OzonListingTask) => void;
  onCopyDraft: (task: OzonListingTask) => void;
  onBackTo1688: () => void;
};

export function isOzonTaskProcessingStatus(status: OzonListingTaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'waiting_deep_collect' ||
    status === 'deep_collecting' ||
    status === 'generating_draft'
  );
}

export function isOzonTaskFailedStatus(status: OzonListingTaskStatus): boolean {
  return status === 'failed' || status === 'deep_failed';
}

export function statusGroupOf(status: OzonListingTaskStatus): OzonProductStatusGroup {
  if (status === 'draft_ready') return 'success';
  if (status === 'needs_manual') return 'manual';
  if (isOzonTaskFailedStatus(status)) return 'failed';
  return 'processing';
}

export function statusLabelOf(status: OzonListingTaskStatus): string {
  const map: Record<OzonListingTaskStatus, string> = {
    queued: '排队中',
    waiting_deep_collect: '等待深采',
    deep_collecting: '深采中',
    generating_draft: '生成草稿中',
    draft_ready: '草稿已生成',
    needs_manual: '需人工补充',
    deep_failed: '深采失败',
    failed: '失败',
  };

  return map[status];
}

function firstRow(task: OzonListingTask): Record<string, unknown> {
  const row = task.draft?.sourceRows?.[0];
  return row && typeof row === 'object' && !Array.isArray(row) ? row : {};
}

function firstItem(task: OzonListingTask): Record<string, unknown> {
  const item = task.draft?.items?.[0];
  return item && typeof item === 'object' && !Array.isArray(item) ? item : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function priceOf(task: OzonListingTask): string {
  const row = firstRow(task);
  const item = firstItem(task);
  const value = task.price || text(row.sku_price) || text(item.price);
  if (!value) return '暂无价格';
  if (/^[\d.]+$/.test(value)) return `¥${value}`;
  return value;
}

function categoryOf(task: OzonListingTask): string {
  const generated = task.draft?.generated || {};
  const matched = generated.matched_category as Record<string, unknown> | undefined;
  return text(matched?.path) || text(firstItem(task)._category_path) || '未匹配类目';
}

function updateTimeOf(task: OzonListingTask): string {
  const value = task.updatedAt || task.finishedAt || task.createdAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function missingSummaryOf(task: OzonListingTask): string {
  const fields = task.missingFields || [];
  if (fields.length > 0) return formatMissingFields(fields);
  const draftMissing = task.draft?.missing || [];
  if (draftMissing.length > 0) return formatMissingFields(draftMissing);
  return '';
}

export default function OzonProductCard({ task, onInspect, onCopyDraft, onBackTo1688 }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const statusGroup = statusGroupOf(task.status);
  const missingSummary = missingSummaryOf(task);
  const message = formatOzonTaskDisplayMessage(task);
  const sourceUrl = task.sourceUrl || text(firstRow(task).detail_url);
  const hasDraft = Boolean(task.draft);
  const showManualAction = task.status === 'needs_manual';
  const title = task.title || text(firstRow(task).product_title) || text(firstItem(task).name) || task.offerId || '未命名商品';

  return (
    <article className={`ozon-product-card ozon-product-card--${statusGroup}`}>
      <div className="ozon-product-thumb-wrap">
        {task.image && !imageFailed ? (
          <img className="ozon-product-thumb" src={task.image} alt="" onError={() => setImageFailed(true)} />
        ) : (
          <div className="ozon-product-thumb placeholder">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <rect x="9" y="10" width="30" height="28" rx="8" fill="rgba(219,234,254,0.78)" />
              <path d="M16 29l7-7 5 5 3-3 6 6" fill="none" stroke="rgba(37,99,235,0.58)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="18" cy="18" r="3" fill="rgba(37,99,235,0.45)" />
            </svg>
          </div>
        )}
      </div>

      <div className="ozon-product-main">
        <div className="ozon-product-title-row">
          <h3>{title}</h3>
          <span className={`ozon-product-status ozon-product-status--${statusGroup}`}>
            {statusLabelOf(task.status)}
          </span>
        </div>

        <div className="ozon-product-meta">
          <span>{priceOf(task)}</span>
          <span>更新 {updateTimeOf(task)}</span>
          <span>{categoryOf(task)}</span>
        </div>

        <div className="ozon-product-source">
          <span>来源：1688</span>
          <strong>{task.offerId || text(firstRow(task).offer_id) || '无 Offer ID'}</strong>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
              打开源链接
            </a>
          )}
        </div>

        {missingSummary && (
          <div className="ozon-product-missing">
            需人工补充：{missingSummary}
          </div>
        )}

        {message && (
          <div className={`ozon-product-message ozon-product-message--${statusGroup}`} title={message}>
            {message}
          </div>
        )}

        <div className="ozon-product-actions">
          <button type="button" onClick={() => onInspect(task)}>
            {showManualAction ? '去补充' : '查看草稿'}
          </button>
          <button type="button" disabled={!hasDraft} onClick={() => onCopyDraft(task)}>
            复制草稿 JSON
          </button>
          <button type="button" onClick={onBackTo1688}>
            返回 1688
          </button>
        </div>
      </div>
    </article>
  );
}
