import { useEffect, useRef } from 'react';
import type { getApi } from '../../../services/api';
import { progressCardToOzonRows } from '../../../services/ozon-source-adapter';
import type { ProgressOfferCardItem } from '../ProgressOfferCard';
import { ozonListingLog } from './debug';
import {
  collectRowMissingFields,
  formatMissingFields,
  isAiKeyMissingMessage,
  precheckProgressCardForOzon,
  unique,
} from './precheck';
import type {
  OzonListingQueueEntry,
  OzonListingTask,
  OzonListingTaskPatch,
  OzonListingTasksChangeHandler,
} from './types';

type DesktopApi = ReturnType<typeof getApi>;

type UseOzonListingQueueArgs = {
  api: DesktopApi;
  cards: ProgressOfferCardItem[];
  enqueueSingleDeepCollect: (item: ProgressOfferCardItem) => void;
  onOzonTasksChange?: OzonListingTasksChangeHandler;
  showToast: (message: string, timeout?: number) => void;
};

type DeepWaitResult =
  | { status: 'success'; item: ProgressOfferCardItem }
  | { status: 'failed'; item: ProgressOfferCardItem; message: string }
  | { status: 'timeout'; item: ProgressOfferCardItem | null };

const DEEP_COLLECT_TIMEOUT_MS = 12 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardKey(item: ProgressOfferCardItem): string {
  return item.offerId ? `offer:${item.offerId}` : `slot:${item.slotIndex}`;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isDeepSuccess(item: ProgressOfferCardItem): boolean {
  const raw = objectOf(item.raw);

  return (
    item.status === 'deep-success' ||
    raw.deepCollected === true ||
    raw.deepCollectStatus === 'success' ||
    Boolean(raw.deepOffer)
  );
}

function isDeepFailure(item: ProgressOfferCardItem): boolean {
  const raw = objectOf(item.raw);

  return (
    item.status === 'deep-failed' ||
    item.status === 'failed' ||
    raw.deepCollectStatus === 'failed'
  );
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Ozon 草稿生成失败');
}

function taskMessageForMissing(fields: string[]): string {
  return fields.length ? `需人工补充：${formatMissingFields(fields)}` : '需人工补充';
}

export function useOzonListingQueue({
  api,
  cards,
  enqueueSingleDeepCollect,
  onOzonTasksChange,
  showToast,
}: UseOzonListingQueueArgs) {
  const cardsRef = useRef(cards);
  const enqueueDeepRef = useRef(enqueueSingleDeepCollect);
  const ozonQueueRef = useRef<OzonListingQueueEntry[]>([]);
  const ozonRunningRef = useRef(false);
  const ozonQueueStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ozonTaskMapRef = useRef<Record<string, OzonListingTask>>({});
  const runSessionIdRef = useRef<string>(`ozon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    enqueueDeepRef.current = enqueueSingleDeepCollect;
  }, [enqueueSingleDeepCollect]);

  function publishOzonTasks(): void {
    const tasks = Object.values(ozonTaskMapRef.current)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    onOzonTasksChange?.(tasks);
  }

  function upsertOzonTask(key: string, patch: OzonListingTaskPatch): void {
    const prev = ozonTaskMapRef.current[key];

    ozonTaskMapRef.current[key] = {
      key,
      sidebarKey: prev?.sidebarKey || `${runSessionIdRef.current}::${key}`,
      offerId: patch.offerId ?? prev?.offerId,
      title: patch.title ?? prev?.title,
      image: patch.image ?? prev?.image,
      status: patch.status ?? prev?.status ?? 'queued',
      message: patch.message ?? prev?.message,
      missingFields: patch.missingFields ?? prev?.missingFields,
      draftId: patch.draftId ?? prev?.draftId,
      draft: patch.draft ?? prev?.draft,
      createdAt: prev?.createdAt || patch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: patch.finishedAt ?? prev?.finishedAt,
    };

    publishOzonTasks();
  }

  function latestCardFor(item: ProgressOfferCardItem): ProgressOfferCardItem | null {
    if (item.offerId) {
      const byOfferId = cardsRef.current.find((card) => card.offerId === item.offerId);
      if (byOfferId) return byOfferId;
    }

    const key = cardKey(item);
    return cardsRef.current.find((card) => cardKey(card) === key) || null;
  }

  async function waitForDeepResult(item: ProgressOfferCardItem): Promise<DeepWaitResult> {
    const startedAt = Date.now();
    let latest: ProgressOfferCardItem | null = latestCardFor(item) || item;

    while (Date.now() - startedAt < DEEP_COLLECT_TIMEOUT_MS) {
      latest = latestCardFor(item) || latest;

      if (latest && isDeepSuccess(latest)) {
        return { status: 'success', item: latest };
      }

      if (latest && isDeepFailure(latest)) {
        return {
          status: 'failed',
          item: latest,
          message: latest.message || latest.code || '深度采集失败，无法生成 Ozon 草稿',
        };
      }

      await sleep(1000);
    }

    return { status: 'timeout', item: latest };
  }

  async function ensureDeepCollected(entry: OzonListingQueueEntry): Promise<ProgressOfferCardItem | null> {
    const latest = latestCardFor(entry.item) || entry.item;
    const precheck = precheckProgressCardForOzon(latest);

    if (!precheck.offerId) {
      const missingFields = unique([...precheck.missingFields, 'offer_id']);
      upsertOzonTask(entry.key, {
        status: 'needs_manual',
        missingFields,
        message: taskMessageForMissing(missingFields),
        finishedAt: new Date().toISOString(),
      });
      return null;
    }

    if (isDeepSuccess(latest)) {
      return latest;
    }

    upsertOzonTask(entry.key, {
      status: 'waiting_deep_collect',
      message: '等待先完成 1688 深度采集',
    });

    ozonListingLog('enqueue dependency deep collect', {
      offerId: latest.offerId,
      title: latest.title,
    });

    enqueueDeepRef.current(latest);

    upsertOzonTask(entry.key, {
      status: 'deep_collecting',
      message: '已加入深度采集队列，采集成功后生成 Ozon 草稿',
    });

    const deepResult = await waitForDeepResult(latest);

    if (deepResult.status === 'success') {
      return deepResult.item;
    }

    if (deepResult.status === 'failed') {
      upsertOzonTask(entry.key, {
        title: deepResult.item.title || latest.title,
        image: deepResult.item.image || latest.image,
        status: 'deep_failed',
        message: deepResult.message,
        finishedAt: new Date().toISOString(),
      });
      return null;
    }

    upsertOzonTask(entry.key, {
      status: 'failed',
      message: '等待深度采集超时，未生成 Ozon 草稿',
      finishedAt: new Date().toISOString(),
    });
    return null;
  }

  async function generateDraftForEntry(entry: OzonListingQueueEntry): Promise<void> {
    const deepItem = await ensureDeepCollected(entry);

    if (!deepItem) return;

    const precheck = precheckProgressCardForOzon(deepItem);
    const rows = progressCardToOzonRows(deepItem);
    const sourceMissingFields = unique([
      ...precheck.missingFields,
      ...collectRowMissingFields(rows),
    ]);

    upsertOzonTask(entry.key, {
      title: deepItem.title,
      image: deepItem.image,
      offerId: deepItem.offerId,
      status: 'generating_draft',
      missingFields: sourceMissingFields,
      message: '正在生成 Ozon 草稿',
    });

    try {
      ozonListingLog('generateDraft start', {
        offerId: deepItem.offerId,
        rowCount: rows.length,
        sourceMissingFields,
      });

      const draft = await api.ozon.generateDraft(rows);
      const missingFields = unique([
        ...sourceMissingFields,
        ...(Array.isArray(draft.missing) ? draft.missing.map(String) : []),
      ]);
      const status = missingFields.length ? 'needs_manual' : 'draft_ready';

      upsertOzonTask(entry.key, {
        status,
        draftId: draft.draftId,
        draft,
        missingFields,
        message: status === 'draft_ready' ? '草稿已生成' : taskMessageForMissing(missingFields),
        finishedAt: new Date().toISOString(),
      });

      ozonListingLog('generateDraft done', {
        offerId: deepItem.offerId,
        draftId: draft.draftId,
        status,
        missingFields,
      });
    } catch (error) {
      const message = errorMessageOf(error);

      if (isAiKeyMissingMessage(message)) {
        const missingFields = unique([...sourceMissingFields, 'ai_api_key']);
        upsertOzonTask(entry.key, {
          status: 'needs_manual',
          missingFields,
          message: taskMessageForMissing(missingFields),
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      upsertOzonTask(entry.key, {
        status: 'failed',
        message,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  async function processOzonQueue(): Promise<void> {
    if (ozonRunningRef.current) return;

    if (ozonQueueStartTimerRef.current) {
      clearTimeout(ozonQueueStartTimerRef.current);
      ozonQueueStartTimerRef.current = null;
    }

    if (ozonQueueRef.current.length === 0) return;

    ozonRunningRef.current = true;

    ozonListingLog('process queue start', {
      queueSize: ozonQueueRef.current.length,
      offerIds: ozonQueueRef.current.map((entry) => entry.item.offerId),
    });

    try {
      while (ozonQueueRef.current.length > 0) {
        const entry = ozonQueueRef.current.shift();

        if (!entry) break;

        upsertOzonTask(entry.key, {
          status: 'queued',
          message: `等待生成草稿，剩余 ${ozonQueueRef.current.length} 个任务`,
        });

        await generateDraftForEntry(entry);

        if (ozonQueueRef.current.length > 0) {
          await sleep(300);
        }
      }
    } finally {
      ozonRunningRef.current = false;

      if (ozonQueueRef.current.length > 0) {
        scheduleOzonQueueProcess(500);
      }
    }
  }

  function scheduleOzonQueueProcess(delayMs = 500): void {
    if (ozonRunningRef.current) return;

    if (ozonQueueStartTimerRef.current) {
      clearTimeout(ozonQueueStartTimerRef.current);
    }

    ozonQueueStartTimerRef.current = setTimeout(() => {
      ozonQueueStartTimerRef.current = null;
      void processOzonQueue();
    }, delayMs);
  }

  function enqueueMultipleOzonListing(items: ProgressOfferCardItem[]): void {
    const validItems = items.filter((item) => Boolean(item.offerId || item.raw || item.title || item.image));

    if (validItems.length === 0) {
      showToast('请选择可上架的商品');
      return;
    }

    let added = 0;

    for (const item of validItems) {
      const key = cardKey(item);
      const existing = ozonTaskMapRef.current[key];
      const existingIsActive = existing && (
        existing.status === 'queued' ||
        existing.status === 'waiting_deep_collect' ||
        existing.status === 'deep_collecting' ||
        existing.status === 'generating_draft'
      );

      if (existingIsActive) {
        continue;
      }

      if (ozonQueueRef.current.some((queueItem) => queueItem.key === key)) {
        continue;
      }

      ozonQueueRef.current = [
        ...ozonQueueRef.current,
        {
          key,
          item,
        },
      ];

      upsertOzonTask(key, {
        offerId: item.offerId,
        title: item.title,
        image: item.image,
        status: 'queued',
        message: '排队等待生成 Ozon 草稿',
        missingFields: [],
        createdAt: new Date().toISOString(),
      });

      added += 1;
    }

    if (added === 0) {
      showToast('选中的商品已在 Ozon 草稿队列中');
      return;
    }

    ozonListingLog('enqueue done', {
      added,
      queueSize: ozonQueueRef.current.length,
      offerIds: validItems.map((item) => item.offerId),
    });

    showToast(`已加入 ${added} 个商品到 Ozon 草稿队列`, 1600);
    scheduleOzonQueueProcess(500);
  }

  function enqueueSingleOzonListing(item: ProgressOfferCardItem): void {
    enqueueMultipleOzonListing([item]);
  }

  function resetOzonListingQueue(): void {
    if (ozonQueueStartTimerRef.current) {
      clearTimeout(ozonQueueStartTimerRef.current);
      ozonQueueStartTimerRef.current = null;
    }

    ozonQueueRef.current = [];
    ozonRunningRef.current = false;
    ozonTaskMapRef.current = {};
    runSessionIdRef.current = `ozon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    enqueueSingleOzonListing,
    enqueueMultipleOzonListing,
    resetOzonListingQueue,
  };
}
